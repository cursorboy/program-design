/**
 * Deterministic extractor — public entry point.
 *
 * extractGraph(repoRoot) parses raw Next.js source (no LLM, ever) into a FactsGraph.
 * Engineering guarantees (PLAN.md):
 *   - A file that fails to parse → ParseFailure, NO partial facts for that file.
 *   - Never crashes extraction; every category is wrapped.
 *   - Unresolved references survive into the graph (→ UNDETERMINED, never ABSENT).
 *   - Works WITHOUT node_modules installed in the target repo.
 */
import {
  type FactsGraph,
  type FactNode,
  type FactEdge,
  type ParseFailure,
  SCHEMA_VERSION,
} from '../schema.js';
import {
  DEFAULT_IGNORE_DIRS,
  walkRepo,
  makeProject,
  loadSourceFiles,
} from './common.js';
import { extractRoutes } from './routes.js';
import { extractMiddleware } from './middleware.js';
import { extractPrisma } from './prisma.js';
import { extractEnv } from './env.js';
import { extractDeps } from './deps.js';
import { extractWiring } from './wiring.js';
import { extractFiles } from './files.js';
import { extractImports } from './imports.js';
import { extractPersists } from './persists.js';
import { extractNavigation } from './navigation.js';
import { extractForms } from './forms.js';

/** Public default ignore globs (directory names). */
export const DEFAULT_IGNORE_GLOBS: string[] = [...DEFAULT_IGNORE_DIRS];

export async function extractGraph(
  repoRoot: string,
  opts?: { ignoreGlobs?: string[]; buildActive?: boolean },
): Promise<FactsGraph> {
  const ignore = opts?.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS;
  const buildActive = opts?.buildActive ?? false;

  const parseFailures: ParseFailure[] = [];
  const nodes: FactNode[] = [];
  const edges: FactEdge[] = [];
  const stats: Record<string, number> = {};

  // 1. Walk the repo (never crashes; unreadable dirs skipped).
  const { sourceFiles: sourcePaths, allFiles } = await walkRepo(repoRoot, ignore);

  // 2. Load source files into ts-morph, capturing parse failures. Broken files
  //    are excluded → no partial facts leak from them.
  const project = makeProject();
  const sourceFiles = loadSourceFiles(project, repoRoot, sourcePaths, parseFailures);

  // Helper: run a category, swallow any unexpected error into a parse-failure-free
  // safety net (extraction must never crash).
  const safe = <T>(label: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      parseFailures.push({
        file: `<${label}>`,
        reason: `extractor error: ${(e as Error).message}`,
      });
      return fallback;
    }
  };

  // 3. Files (also needed so env `reads` and `dependsOn` edges have file nodes).
  const filesRes = safe('files', () => extractFiles(repoRoot, allFiles), { nodes: [] });
  push(nodes, filesRes.nodes);
  stats.files = filesRes.nodes.length;

  // 4. Routes.
  const routesRes = safe(
    'routes',
    () => extractRoutes(repoRoot, sourceFiles),
    { nodes: [], edges: [], appDirFound: false, appDirs: [] },
  );
  push(nodes, routesRes.nodes);
  push(edges, routesRes.edges);
  const routeNodes = routesRes.nodes.filter((n) => n.kind === 'route');
  stats.routes = routeNodes.length;
  stats.serverActions = routesRes.nodes.filter((n) => n.kind === 'serverAction').length;
  stats.appDirFound = routesRes.appDirFound ? 1 : 0;

  // 5. Middleware (depends on routes for attachment edges).
  const mwRes = safe(
    'middleware',
    () => extractMiddleware(repoRoot, sourceFiles, routeNodes),
    { nodes: [], edges: [], searchScope: [], found: false },
  );
  push(nodes, mwRes.nodes);
  push(edges, mwRes.edges);
  stats.middleware = mwRes.nodes.length;

  // 6. Prisma schema.
  const prismaRes = safe(
    'prisma',
    () => extractPrisma(repoRoot),
    { nodes: [], edges: [], schemaSource: 'absent' as const, schemaFileRel: null },
  );
  push(nodes, prismaRes.nodes);
  push(edges, prismaRes.edges);
  stats.dbTables = prismaRes.nodes.filter((n) => n.kind === 'dbTable').length;
  stats.dbColumns = prismaRes.nodes.filter((n) => n.kind === 'dbColumn').length;
  stats.schemaSource = prismaRes.schemaSource === 'present' ? 1 : 0;

  // 6b. persistsTo (depends on prisma tables + routes). Display-only edge: shows
  //     "this endpoint saves to your <Table> records" as a deterministic fact.
  const tableNames = prismaRes.nodes
    .filter((n) => n.kind === 'dbTable')
    .map((n) => n.name);
  const persistsRes = safe(
    'persists',
    () => extractPersists(repoRoot, sourceFiles, tableNames, routeNodes),
    { edges: [] },
  );
  push(edges, persistsRes.edges);
  stats['persists/prisma-write'] = persistsRes.edges.length;

  // 7. Env vars.
  const envRes = safe('env', () => extractEnv(repoRoot, sourceFiles), {
    nodes: [],
    edges: [],
  });
  push(nodes, envRes.nodes);
  push(edges, envRes.edges);
  stats.envVars = envRes.nodes.length;

  // 8. Dependencies.
  const depsRes = safe('deps', () => extractDeps(repoRoot, parseFailures), {
    nodes: [],
    packageJsonRel: null,
  });
  push(nodes, depsRes.nodes);
  stats.dependencies = depsRes.nodes.length;
  const dependencyNames = new Set(depsRes.nodes.map((n) => n.name));

  // 9. Wiring (depends on routes).
  const wiringRes = safe(
    'wiring',
    () => extractWiring(repoRoot, sourceFiles, routeNodes),
    { nodes: [], edges: [] },
  );
  push(nodes, wiringRes.nodes);
  push(edges, wiringRes.edges);
  stats.clientCalls = wiringRes.nodes.length;

  // 9b. Navigation (page-to-page links; depends on routes for page targets).
  const navRes = safe(
    'navigation',
    () => extractNavigation(repoRoot, sourceFiles, routeNodes),
    { nodes: [], edges: [] },
  );
  push(nodes, navRes.nodes);
  push(edges, navRes.edges);
  stats['nav/link'] = navRes.edges.filter(
    (e) => e.kind === 'navigatesTo' && e.provenance?.ruleId === 'nav/link',
  ).length;
  stats['nav/router'] = navRes.edges.filter(
    (e) => e.kind === 'navigatesTo' && e.provenance?.ruleId === 'nav/router',
  ).length;
  stats['nav/redirect'] = navRes.edges.filter(
    (e) => e.kind === 'navigatesTo' && e.provenance?.ruleId === 'nav/redirect',
  ).length;
  stats.navigatesTo = navRes.edges.filter((e) => e.kind === 'navigatesTo').length;

  // 9c. Forms (form nodes + where they submit; depends on routes).
  const formsRes = safe(
    'forms',
    () => extractForms(repoRoot, sourceFiles, routeNodes),
    { nodes: [], edges: [] },
  );
  push(nodes, formsRes.nodes);
  push(edges, formsRes.edges);
  stats['forms/jsx-form'] = formsRes.nodes.filter((n) => n.kind === 'form').length;
  stats.forms = formsRes.nodes.filter((n) => n.kind === 'form').length;
  stats.submitsTo = formsRes.edges.filter((e) => e.kind === 'submitsTo').length;

  // 10. Imports + unresolved references (depends on file + dependency nodes).
  const importsRes = safe(
    'imports',
    () => extractImports(repoRoot, sourceFiles, dependencyNames),
    { unresolvedFiles: new Set<string>(), edges: [] },
  );
  push(edges, importsRes.edges);
  // Mark file nodes unresolved where an import target is missing.
  if (importsRes.unresolvedFiles.size > 0) {
    for (const n of nodes) {
      if (n.kind === 'file' && importsRes.unresolvedFiles.has(n.name)) {
        n.unresolved = true;
      }
    }
  }
  stats.unresolvedRefs = importsRes.edges.filter((e) => e.unresolved).length;
  stats.parseFailures = parseFailures.length;

  // Dedupe nodes by id (navigation + forms can both mint the same external
  // marker node) — first occurrence wins. Same for edges.
  const dedupedNodes = dedupeById(nodes);
  const dedupedEdges = dedupeById(edges);

  // Deterministic global ordering.
  dedupedNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  dedupedEdges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    schemaVersion: SCHEMA_VERSION,
    repoRoot,
    generatedAt: new Date().toISOString(),
    buildActive,
    parseFailures,
    nodes: dedupedNodes,
    edges: dedupedEdges,
    stats,
  };
}

function push<T>(target: T[], items: T[]): void {
  for (const it of items) target.push(it);
}

/** Keep the first occurrence of each id; preserve input order otherwise. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}
