/**
 * Deterministic claim checker (PLAN.md Layer 2).
 *
 * The checker consumes ONLY a structured ClaimManifest and a FactsGraph. Every
 * verdict is computed mechanically here — the model never renders a verdict.
 *
 * Discipline (PLAN.md §5 + Eng Hardening):
 *  - CONFIRMED / ABSENT are emitted only for (category, predicate) on the
 *    allowlist AND only when the graph shows the recognizing extractor rules ran.
 *  - ABSENT always carries a recorded searchScope (provable absence only).
 *  - Every UNDETERMINED carries an explainer: plain-language reason FIRST, the
 *    technical pattern second.
 *  - Transient unresolved references during an active build → UNDETERMINED,
 *    never ABSENT.
 *  - Every verdict carries the factIds of the evidence it used.
 */
import {
  type Claim,
  type ClaimManifest,
  type ClaimVerdict,
  type FactEdge,
  type FactNode,
  type FactsGraph,
  type Provenance,
  type UndeterminedExplainer,
  type Verdict,
  type VerdictSummary,
  makeNodeId,
  summarizeVerdicts,
} from '../schema.js';
import { findAllowlistEntry } from './allowlist.js';

// ---------------------------------------------------------------------------
// Graph index — O(1) lookups built once per check pass.
// ---------------------------------------------------------------------------

interface GraphIndex {
  nodesById: Map<string, FactNode>;
  edgesByFrom: Map<string, FactEdge[]>;
  edgesByTo: Map<string, FactEdge[]>;
  /** Rule ids seen in node/edge provenance. */
  ruleIdsSeen: Set<string>;
  /** All edges, for unresolved-edge scans. */
  allEdges(): FactEdge[];
}

interface RawIndex {
  nodesById: Map<string, FactNode>;
  edgesByFrom: Map<string, FactEdge[]>;
  edgesByTo: Map<string, FactEdge[]>;
  ruleIdsSeen: Set<string>;
}

function indexGraph(graph: FactsGraph): RawIndex {
  const nodesById = new Map<string, FactNode>();
  const edgesByFrom = new Map<string, FactEdge[]>();
  const edgesByTo = new Map<string, FactEdge[]>();
  const ruleIdsSeen = new Set<string>();

  for (const n of graph.nodes) {
    nodesById.set(n.id, n);
    if (n.provenance) ruleIdsSeen.add(n.provenance.ruleId);
  }
  for (const e of graph.edges) {
    (edgesByFrom.get(e.from) ?? setGet(edgesByFrom, e.from)).push(e);
    (edgesByTo.get(e.to) ?? setGet(edgesByTo, e.to)).push(e);
    if (e.provenance) ruleIdsSeen.add(e.provenance.ruleId);
  }
  return { nodesById, edgesByFrom, edgesByTo, ruleIdsSeen };
}

function setGet(map: Map<string, FactEdge[]>, key: string): FactEdge[] {
  const arr: FactEdge[] = [];
  map.set(key, arr);
  return arr;
}

// ---------------------------------------------------------------------------
// Verdict construction helpers.
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function confirmed(
  claim: Claim,
  receipts: Provenance[],
  factIds: string[],
): ClaimVerdict {
  // Dedupe receipts that resolve to the same file:line (e.g. a table node and
  // its column edge sharing one provenance) — the user should see each line once.
  const seen = new Set<string>();
  const deduped = receipts.filter((r) => {
    const key = `${r.file}:${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    claimId: claim.id,
    claim,
    verdict: 'confirmed',
    receipts: deduped,
    factIds: [...new Set(factIds)],
    timestamp: nowIso(),
  };
}

function absent(
  claim: Claim,
  searchScope: string[],
  factIds: string[],
): ClaimVerdict {
  return {
    claimId: claim.id,
    claim,
    verdict: 'absent',
    receipts: [],
    searchScope,
    factIds,
    timestamp: nowIso(),
  };
}

function undetermined(
  claim: Claim,
  explainer: UndeterminedExplainer,
  factIds: string[] = [],
): ClaimVerdict {
  return {
    claimId: claim.id,
    claim,
    verdict: 'undetermined',
    receipts: [],
    explainer,
    factIds,
    timestamp: nowIso(),
  };
}

/** Plain-language preamble, written for a non-coder (PLAN.md narrator contract). */
const CANT_CONFIRM = "I can't safely confirm this from the code — ";

// ---------------------------------------------------------------------------
// Evidence-of-rule gate (allowlist precondition).
// ---------------------------------------------------------------------------

/**
 * The recognizing pass "ran" if any of the entry's ruleIds appears in observed
 * provenance OR in graph.stats. Stats let an extractor record that a rule ran
 * even when it produced zero nodes (e.g. a parsed-but-empty prisma schema).
 */
function ruleRan(
  ruleIds: string[],
  index: GraphIndex,
  graph: FactsGraph,
): boolean {
  for (const id of ruleIds) {
    if (index.ruleIdsSeen.has(id)) return true;
    if (graph.stats[id] !== undefined) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Build-active transient-unresolved guard (PLAN.md Eng Hardening §3).
// ---------------------------------------------------------------------------

/**
 * Returns an explainer if, during an active build, a relevant unresolved fact
 * touches this subject — in which case the verdict must be UNDETERMINED, never
 * ABSENT. "Relevant" = an unresolved node/edge whose name or endpoints mention
 * the subject id, or any unresolved fact carrying the same category's rule.
 */
function transientUnresolved(
  graph: FactsGraph,
  index: GraphIndex,
  ...candidateIds: string[]
): { explainer: UndeterminedExplainer; factIds: string[] } | undefined {
  if (!graph.buildActive) return undefined;
  const ids = new Set(candidateIds);

  for (const n of graph.nodes) {
    if (!n.unresolved) continue;
    if (ids.has(n.id) || candidateIds.some((c) => idsTouch(c, n.id, n.name))) {
      return {
        explainer: {
          reason:
            CANT_CONFIRM +
            'the project is still being written and a reference this claim depends on points at something that does not exist yet. I will not call it absent mid-build.',
          pattern: `transient unresolved reference: ${n.id}`,
          ...(n.provenance ? { provenance: n.provenance } : {}),
        },
        factIds: [n.id],
      };
    }
  }
  for (const e of index.allEdges()) {
    if (!e.unresolved) continue;
    if (ids.has(e.from) || ids.has(e.to)) {
      return {
        explainer: {
          reason:
            CANT_CONFIRM +
            'the project is still being written and a reference this claim depends on is not yet resolved. I will not call it absent mid-build.',
          pattern: `transient unresolved edge: ${e.id}`,
          ...(e.provenance ? { provenance: e.provenance } : {}),
        },
        factIds: [e.id],
      };
    }
  }
  return undefined;
}

function idsTouch(candidate: string, nodeId: string, nodeName: string): boolean {
  // The candidate is a full node id like "route:GET /api/x". An unresolved node
  // is "relevant" when it shares the subject portion (after the kind prefix).
  const subj = candidate.includes(':')
    ? candidate.slice(candidate.indexOf(':') + 1)
    : candidate;
  return nodeName === subj || nodeId.endsWith(subj);
}

// ---------------------------------------------------------------------------
// Parse-failure scoping.
// ---------------------------------------------------------------------------

/** Returns the first parse failure whose file falls under any of the prefixes. */
function parseFailureUnder(
  graph: FactsGraph,
  prefixes: string[],
): { file: string; reason: string } | undefined {
  return graph.parseFailures.find((pf) =>
    prefixes.some((p) => underPrefix(pf.file, p)),
  );
}

function underPrefix(file: string, prefix: string): boolean {
  const f = file.replace(/^\.\//, '');
  const p = prefix.replace(/^\.\//, '');
  return f === p || f.startsWith(p.endsWith('/') ? p : p + '/') || f.startsWith(p);
}

// ---------------------------------------------------------------------------
// Per-category checkers.
// ---------------------------------------------------------------------------

const APP_SEARCH_SCOPE = [
  'app/**/page.tsx',
  'app/**/route.ts (METHOD exports)',
];
const APP_PREFIXES = ['app', 'src/app'];

/**
 * Route node ids matching a claim's subject path.
 * When qualifiers.method is given → exact "<METHOD> <path>" match.
 * When omitted → ANY method at that path (a translator saying "the login form
 * calls the API" rarely states the verb; defaulting to GET produced false
 * ABSENT/UNDETERMINED verdicts — the bug class this tool exists to prevent).
 * Falls back to the conventional GET id so transient/unresolved probing still
 * has a target when no route at that path exists.
 */
function candidateRouteIds(claim: Claim, graph: FactsGraph): string[] {
  const path = claim.subject;
  const explicit = claim.qualifiers.method;
  if (explicit) return [makeNodeId('route', `${explicit.toUpperCase()} ${path}`)];
  const ids = graph.nodes
    .filter((n) => n.kind === 'route' && n.name.endsWith(` ${path}`))
    .map((n) => n.id);
  return ids.length > 0 ? ids : [makeNodeId('route', `GET ${path}`)];
}

function checkRouteExists(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const candidates = candidateRouteIds(claim, graph);

  for (const nodeId of candidates) {
    const transient = transientUnresolved(graph, index, nodeId);
    if (transient)
      return undetermined(claim, transient.explainer, transient.factIds);
  }

  for (const nodeId of candidates) {
    const node = index.nodesById.get(nodeId);
    if (node && !node.unresolved) {
      return confirmed(claim, node.provenance ? [node.provenance] : [], [nodeId]);
    }
  }
  for (const nodeId of candidates) {
    const node = index.nodesById.get(nodeId);
    if (node && node.unresolved) {
      return undetermined(
        claim,
        {
          reason:
            CANT_CONFIRM +
            'the route is referenced but its definition has not resolved.',
          pattern: `unresolved route node: ${nodeId}`,
          ...(node.provenance ? { provenance: node.provenance } : {}),
        },
        [nodeId],
      );
    }
  }

  // No matching node. ABSENT only if: rule ran, no parse failures under the app
  // dir, and no unresolved route facts anywhere.
  const pf = parseFailureUnder(graph, APP_PREFIXES);
  if (pf) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        `a file under the app directory failed to parse, so I cannot be sure this route is missing rather than unreadable. (${pf.file})`,
      pattern: `parseFailure: ${pf.file} — ${pf.reason}`,
    });
  }
  const unresolvedRoute = graph.nodes.find(
    (n) => n.kind === 'route' && n.unresolved,
  );
  if (unresolvedRoute) {
    return undetermined(
      claim,
      {
        reason:
          CANT_CONFIRM +
          'there is an unresolved route reference in the project, so the route table is not yet trustworthy.',
        pattern: `unresolved route fact: ${unresolvedRoute.id}`,
        ...(unresolvedRoute.provenance
          ? { provenance: unresolvedRoute.provenance }
          : {}),
      },
      [unresolvedRoute.id],
    );
  }
  if (!ruleRan(['routes/app-router-page', 'routes/app-router-handler'], index, graph)) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'I have no evidence the route scanner ran on this project, so I cannot prove the route is missing.',
      pattern: 'no route-extractor rule observed in graph',
    });
  }
  return absent(claim, [...APP_SEARCH_SCOPE], []);
}

const MIDDLEWARE_SEARCH_SCOPE = ['middleware.ts', 'src/middleware.ts'];
const MIDDLEWARE_PREFIXES = ['middleware.ts', 'src/middleware.ts'];

function checkMiddlewareAttached(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const candidates = candidateRouteIds(claim, graph);

  for (const routeId of candidates) {
    const transient = transientUnresolved(graph, index, routeId);
    if (transient)
      return undetermined(claim, transient.explainer, transient.factIds);
  }

  const middlewareNodes = graph.nodes.filter((n) => n.kind === 'middleware');
  if (middlewareNodes.length === 0) {
    const pf = parseFailureUnder(graph, MIDDLEWARE_PREFIXES);
    if (pf) {
      return undetermined(claim, {
        reason:
          CANT_CONFIRM +
          'the middleware file failed to parse, so I cannot tell whether it is attached here.',
        pattern: `parseFailure: ${pf.file} — ${pf.reason}`,
      });
    }
    return absent(claim, [...MIDDLEWARE_SEARCH_SCOPE], []);
  }

  // Look for attachedTo edges from a middleware node to the subject route
  // (any method when the claim doesn't state one).
  const incoming = candidates.flatMap((id) => index.edgesByTo.get(id) ?? []);
  const attaches = incoming.filter(
    (e) =>
      e.kind === 'attachedTo' &&
      index.nodesById.get(e.from)?.kind === 'middleware',
  );

  const confirming = attaches.filter(
    (e) => e.tier === 'matcher-includes' || e.tier === 'guard-wrapper',
  );
  if (confirming.length > 0) {
    const receipts = confirming
      .map((e) => e.provenance)
      .filter((p): p is Provenance => p != null);
    return confirmed(
      claim,
      receipts,
      confirming.map((e) => e.id),
    );
  }

  // Middleware exists but only weak/dynamic attachment → UNDETERMINED.
  const matcherDynamic = middlewareNodes.some(
    (n) => n.attrs.matcherDynamic === true,
  );
  const globalOnly = attaches.filter((e) => e.tier === 'global-exists');
  if (globalOnly.length > 0 || matcherDynamic || attaches.length > 0) {
    const matcherPattern = firstMatcherPattern(middlewareNodes);
    return undetermined(
      claim,
      {
        reason:
          CANT_CONFIRM +
          'middleware exists but attachment to this route could not be confirmed.',
        pattern: matcherPattern
          ? `middleware present; matcher: ${matcherPattern}`
          : 'middleware present; attachment tier global-exists or matcher is dynamic',
        ...(middlewareNodes[0]?.provenance
          ? { provenance: middlewareNodes[0].provenance }
          : {}),
      },
      [
        ...middlewareNodes.map((n) => n.id),
        ...attaches.map((e) => e.id),
      ],
    );
  }

  // Middleware exists, but no attachment edge to this route at all, and the
  // matcher is statically known (not dynamic) → we can call attachment ABSENT.
  return undetermined(
    claim,
    {
      reason:
        CANT_CONFIRM +
        'middleware exists but attachment to this route could not be confirmed.',
      pattern: 'middleware present; no attachment edge to this route',
      ...(middlewareNodes[0]?.provenance
        ? { provenance: middlewareNodes[0].provenance }
        : {}),
    },
    middlewareNodes.map((n) => n.id),
  );
}

function firstMatcherPattern(nodes: FactNode[]): string | undefined {
  for (const n of nodes) {
    const m = n.attrs.matcher;
    if (typeof m === 'string') return m;
  }
  return undefined;
}

const SCHEMA_FILE = 'schema.prisma';
const SCHEMA_PREFIXES = ['schema.prisma', 'prisma/schema.prisma'];
const SCHEMA_SEARCH_SCOPE = ['prisma/schema.prisma (model declarations)'];

function checkSchemaExists(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const tableId = makeNodeId('dbTable', claim.subject);
  const transient = transientUnresolved(graph, index, tableId);
  if (transient) return undetermined(claim, transient.explainer, transient.factIds);

  const node = index.nodesById.get(tableId);
  if (node && !node.unresolved) {
    return confirmed(claim, node.provenance ? [node.provenance] : [], [tableId]);
  }
  return schemaAbsentOrUndetermined(claim, graph, index, tableId, [
    ...SCHEMA_SEARCH_SCOPE,
  ]);
}

function checkSchemaHasColumn(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const table = claim.subject;
  const column = claim.qualifiers.column ?? '';
  const tableId = makeNodeId('dbTable', table);
  const columnId = makeNodeId('dbColumn', `${table}.${column}`);

  const transient = transientUnresolved(graph, index, tableId, columnId);
  if (transient) return undetermined(claim, transient.explainer, transient.factIds);

  const colNode = index.nodesById.get(columnId);
  const edge = (index.edgesByTo.get(columnId) ?? []).find(
    (e) => e.kind === 'hasColumn' && e.from === tableId,
  );
  if (colNode && !colNode.unresolved && edge) {
    const receipts = [colNode.provenance, edge.provenance].filter(
      (p): p is Provenance => p != null,
    );
    return confirmed(claim, receipts, [columnId, edge.id]);
  }
  return schemaAbsentOrUndetermined(
    claim,
    graph,
    index,
    columnId,
    [`prisma/schema.prisma (field "${column}" on model "${table}")`],
  );
}

function schemaAbsentOrUndetermined(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
  factId: string,
  searchScope: string[],
): ClaimVerdict {
  const pf = parseFailureUnder(graph, SCHEMA_PREFIXES);
  if (pf) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'the Prisma schema failed to parse, so I cannot prove this is missing rather than unreadable.',
      pattern: `parseFailure: ${pf.file} — ${pf.reason}`,
    });
  }
  // ABSENT only when the schema was parsed successfully: either table nodes
  // exist (schema definitely read) or stats show the model rule ran.
  const hasTableNodes = graph.nodes.some((n) => n.kind === 'dbTable');
  const ran =
    hasTableNodes ||
    ruleRan(['schema/prisma-model', 'schema/prisma-field'], index, graph);
  if (!ran) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        `I have no evidence the database schema (${SCHEMA_FILE}) was parsed, so I cannot prove this is missing.`,
      pattern: 'no schema-extractor rule observed and no table nodes present',
    });
  }
  return absent(claim, searchScope, []);
}

function checkEnvReads(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const envId = makeNodeId('envVar', claim.subject);
  const transient = transientUnresolved(graph, index, envId);
  if (transient) return undetermined(claim, transient.explainer, transient.factIds);

  const node = index.nodesById.get(envId);
  if (node && !node.unresolved) {
    const reads = (index.edgesByTo.get(envId) ?? []).filter(
      (e) => e.kind === 'reads',
    );
    const receipts: Provenance[] = [];
    if (node.provenance) receipts.push(node.provenance);
    for (const e of reads) if (e.provenance) receipts.push(e.provenance);
    return confirmed(claim, receipts, [envId, ...reads.map((e) => e.id)]);
  }
  if (!ruleRan(['env/process-env-read'], index, graph)) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'I have no evidence the environment-variable scanner ran, so I cannot prove this var is never read.',
      pattern: 'no env-extractor rule observed in graph',
    });
  }
  return absent(claim, ['process.env.* reads across source files'], []);
}

function checkDepInstalled(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const depId = makeNodeId('dependency', claim.subject);
  const transient = transientUnresolved(graph, index, depId);
  if (transient) return undetermined(claim, transient.explainer, transient.factIds);

  const node = index.nodesById.get(depId);
  if (node && !node.unresolved) {
    return confirmed(claim, node.provenance ? [node.provenance] : [], [depId]);
  }
  const pf = parseFailureUnder(graph, ['package.json']);
  if (pf) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'package.json failed to parse, so I cannot prove this dependency is missing.',
      pattern: `parseFailure: ${pf.file} — ${pf.reason}`,
    });
  }
  if (!ruleRan(['deps/package-json'], index, graph)) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'I have no evidence package.json was parsed, so I cannot prove this dependency is missing.',
      pattern: 'no dependency-extractor rule observed in graph',
    });
  }
  return absent(claim, ['package.json (dependencies + devDependencies)'], []);
}

function checkWiringWired(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const candidates = candidateRouteIds(claim, graph);
  for (const routeId of candidates) {
    const transient = transientUnresolved(graph, index, routeId);
    if (transient)
      return undetermined(claim, transient.explainer, transient.factIds);
  }

  const incoming = candidates
    .flatMap((id) => index.edgesByTo.get(id) ?? [])
    .filter((e) => e.kind === 'wiredTo');
  const confirming = incoming.filter(
    (e) =>
      e.tier === 'literal' ||
      e.tier === 'constant-resolved' ||
      e.tier === 'helper-resolved',
  );
  if (confirming.length > 0) {
    const receipts = confirming
      .map((e) => e.provenance)
      .filter((p): p is Provenance => p != null);
    return confirmed(
      claim,
      receipts,
      confirming.map((e) => e.id),
    );
  }
  const dynamic = incoming.find(
    (e) => e.tier === 'dynamic' || e.tier === 'sdk' || e.unresolved,
  );
  if (dynamic) {
    return undetermined(
      claim,
      {
        reason:
          CANT_CONFIRM +
          'the frontend call to this route is built in a way I cannot resolve to a literal URL, so I cannot confirm the wiring.',
        pattern: `wiring tier "${dynamic.tier ?? 'unresolved'}" on edge ${dynamic.id}`,
        ...(dynamic.provenance ? { provenance: dynamic.provenance } : {}),
      },
      [dynamic.id],
    );
  }
  // No client-call edge resolved to this route. We can only prove absence if the
  // wiring rule actually ran.
  if (!ruleRan(['wiring/literal-url', 'wiring/resolved-url'], index, graph)) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'I have no evidence the frontend-wiring scanner ran, so I cannot prove this route is never called.',
      pattern: 'no wiring-extractor rule observed in graph',
    });
  }
  return absent(
    claim,
    ['client call sites with resolvable URLs (literal / constant / helper)'],
    [],
  );
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

function checkOne(
  claim: Claim,
  graph: FactsGraph,
  index: GraphIndex,
): ClaimVerdict {
  const entry = findAllowlistEntry(claim.category, claim.predicate);
  if (!entry) {
    return undetermined(claim, {
      reason:
        CANT_CONFIRM +
        'this kind of claim is not one of the patterns I am built to recognize, so I will not guess.',
      pattern: 'pattern not on the recognized-pattern allowlist',
    });
  }

  const key = `${claim.category}/${claim.predicate}`;
  switch (key) {
    case 'route/exists':
      return checkRouteExists(claim, graph, index);
    case 'middleware/attached':
      return checkMiddlewareAttached(claim, graph, index);
    case 'schema/exists':
      return checkSchemaExists(claim, graph, index);
    case 'schema/has-column':
      return checkSchemaHasColumn(claim, graph, index);
    case 'env/reads':
      return checkEnvReads(claim, graph, index);
    case 'dep/installed':
      return checkDepInstalled(claim, graph, index);
    case 'wiring/wired':
      return checkWiringWired(claim, graph, index);
    default:
      // On allowlist but no handler — defensive; treat as off-allowlist.
      return undetermined(claim, {
        reason:
          CANT_CONFIRM +
          'this claim shape is recognized but has no checker implementation.',
        pattern: 'pattern not on the recognized-pattern allowlist',
      });
  }
}

/**
 * Run every claim in the manifest against the graph, deterministically.
 */
export function checkClaims(
  graph: FactsGraph,
  manifest: ClaimManifest,
): ClaimVerdict[] {
  const index = buildIndex(graph);
  return manifest.claims.map((c) => checkOne(c, graph, index));
}

/** Build the indexed view (also used by regression). Exported for reuse. */
export function buildIndex(graph: FactsGraph): GraphIndex {
  const base = indexGraph(graph);
  const all: FactEdge[] = graph.edges.slice();
  return {
    ...base,
    allEdges: () => all,
  };
}

/** Re-export the summary so the index can wrap it. */
export function summarize(
  verdicts: ClaimVerdict[],
  unverifiable: number,
): VerdictSummary {
  return summarizeVerdicts(verdicts, unverifiable);
}
