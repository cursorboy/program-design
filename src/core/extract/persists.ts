/**
 * persistsTo extraction — deterministic "this endpoint saves to <Table>" facts.
 *
 * Allowlist-spirit: when in doubt, emit NOTHING (the display projection then
 * honestly says "I can't trace where this goes"). Coverage is never bought with
 * a guess.
 *
 * What counts (all must hold):
 *   - The containing file is under app/, src/app/, or lib/ (where route handlers
 *     and server actions — and the prisma client wrapper — live).
 *   - A property-access chain `<root>.<model>.<method>(...)` where:
 *       * <root> is an identifier that is EITHER imported from a local module
 *         whose path contains 'db' or 'prisma', OR literally named `db`/`prisma`.
 *       * <method> ∈ writes {create, createMany, update, updateMany, upsert,
 *         delete, deleteMany, save, insert}. Reads (findMany, …) are NOT
 *         persistence and emit nothing.
 *       * <model> case-insensitively matches a known dbTable node name.
 *   - <model> and <method> are plain identifier property names — computed access
 *     `db[model].create(...)` emits nothing.
 *
 * Edge: kind 'persistsTo', from the ROUTE node whose provenance.file is this file
 * (if any) else the file node; to `dbTable:<ModelName>` (exact table node name).
 * provenance = the call site, ruleId 'persists/prisma-write'. invalidatedBy =
 * [the file]. Deduped on (from,to); first provenance wins. Display-only edge —
 * the checker does not consume it yet.
 */
import type { SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  makeNodeId,
  makeEdgeId,
  type FactNode,
  type FactEdge,
} from '../schema.js';
import { toRel, lineOf } from './common.js';

export interface PersistsResult {
  edges: FactEdge[];
}

const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'save',
  'insert',
]);

const RULE_ID = 'persists/prisma-write';

/** Files that may host route handlers / server actions / the db client wrapper. */
function isCandidateFile(rel: string): boolean {
  return (
    rel.startsWith('app/') ||
    rel.startsWith('src/app/') ||
    rel.startsWith('lib/') ||
    rel.startsWith('src/lib/')
  );
}

/**
 * Extract persistsTo edges.
 *
 * @param tableNames  dbTable node names from the prisma extractor (exact case).
 * @param routeNodes  route nodes — a write inside a route file attributes to the
 *                    route node whose provenance.file matches that file.
 */
export function extractPersists(
  repoRoot: string,
  sourceFiles: SourceFile[],
  tableNames: string[],
  routeNodes: FactNode[],
): PersistsResult {
  const edges: FactEdge[] = [];

  // Case-insensitive model lookup → exact table name (preserves dbTable casing).
  const tableByLower = new Map<string, string>();
  for (const name of tableNames) tableByLower.set(name.toLowerCase(), name);

  // route file → route node ids that live in that file.
  const routeIdsByFile = new Map<string, string[]>();
  for (const r of routeNodes) {
    if (r.kind !== 'route') continue;
    const f = r.provenance?.file;
    if (!f) continue;
    if (!routeIdsByFile.has(f)) routeIdsByFile.set(f, []);
    routeIdsByFile.get(f)!.push(r.id);
  }

  // Dedupe on (from -> to); first provenance wins.
  const seen = new Set<string>();

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    if (!isCandidateFile(rel)) continue;

    const dbRoots = collectDbRoots(sf);
    if (dbRoots.size === 0) continue;

    const routeIds = routeIdsByFile.get(rel) ?? null;

    sf.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      // Shape: <root>.<model>.<method>(...)
      if (!Node.isPropertyAccessExpression(callee)) return;
      const method = callee.getName(); // identifier-only (computed → not matched here)
      if (!WRITE_METHODS.has(method)) return;

      const modelAccess = callee.getExpression();
      if (!Node.isPropertyAccessExpression(modelAccess)) return;
      const model = modelAccess.getName(); // computed db[model] → ElementAccess → skipped

      const root = modelAccess.getExpression();
      if (!Node.isIdentifier(root)) return;
      if (!dbRoots.has(root.getText())) return;

      const tableName = tableByLower.get(model.toLowerCase());
      if (!tableName) return; // unknown model → emit nothing

      const tableId = makeNodeId('dbTable', tableName);
      const line = lineOf(sf, node.getStart());

      const fromIds = routeIds && routeIds.length > 0 ? routeIds : [makeNodeId('file', rel)];
      for (const fromId of fromIds) {
        const key = `${fromId}->${tableId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          id: makeEdgeId('persistsTo', fromId, tableId),
          kind: 'persistsTo',
          from: fromId,
          to: tableId,
          provenance: { file: rel, line, ruleId: RULE_ID },
          invalidatedBy: [rel],
        });
      }
    });
  }

  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { edges };
}

/**
 * Identifiers in this file that are a prisma/db client root:
 *   - imported from a local module whose path contains 'db' or 'prisma', OR
 *   - literally named `db` or `prisma`.
 */
function collectDbRoots(sf: SourceFile): Set<string> {
  const roots = new Set<string>();

  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const isLocal = spec.startsWith('.') || spec.startsWith('/');
    const lower = spec.toLowerCase();
    const pathHints = lower.includes('db') || lower.includes('prisma');
    if (!isLocal || !pathHints) continue;

    // Default import: import db from './lib/db'
    const def = imp.getDefaultImport();
    if (def) roots.add(def.getText());
    // Namespace import: import * as db from './lib/db'
    const ns = imp.getNamespaceImport();
    if (ns) roots.add(ns.getText());
    // Named imports: import { db, prisma } from './lib/db'
    for (const named of imp.getNamedImports()) {
      roots.add(named.getNameNode().getText()); // local alias if present, else name
      const alias = named.getAliasNode();
      if (alias) roots.add(alias.getText());
    }
  }

  // Identifiers literally named db/prisma (covers same-file `const prisma = …`).
  roots.add('db');
  roots.add('prisma');

  return roots;
}
