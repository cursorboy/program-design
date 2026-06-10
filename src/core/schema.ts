/**
 * Facts-graph IR — the contract between extractor, checker, narrator, and views.
 *
 * Design rules (see PLAN.md "Facts-graph IR requirements"):
 * - This is the CORE facts layer. Display projections (node shapes, LOD clusters,
 *   diff baselines) are computed in the server and NEVER stored here.
 * - Every fact carries provenance (file:line + extractor rule + confidence tier
 *   + invalidation sources). No provenance → the fact cannot back a receipt.
 * - Verdict logic depends only on this layer.
 *
 *   PLAN text ──(LLM, fenced)──▶ Claim[] ─┐
 *   SOURCE ──(extractor, no LLM)──▶ FactsGraph ──▶ checker ──▶ ClaimVerdict[]
 *                                                                │
 *                                              narrator (LLM, fenced, fact-ID
 *                                              bound statements, fail-closed lint)
 */

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind =
  | 'file'
  | 'route' // App Router route (page or route handler)
  | 'serverAction'
  | 'middleware'
  | 'function'
  | 'component'
  | 'dbTable'
  | 'dbColumn'
  | 'envVar'
  | 'dependency'
  | 'clientCall' // a frontend call site that may wire to a route
  | 'form' // a <form> / submit-handler that sends data somewhere
  // ── full-system-map entities (the live breakdown: servers, data, hosting) ──
  | 'server' // a deployable service that runs code (API, worker, scraper, web).
  // role lives in attrs.role: 'api' | 'worker' | 'scraper' | 'web' | 'cron' | 'service'
  | 'database' // a data store the system keeps data in (Postgres, Redis, …).
  // engine in attrs.engine: 'postgres' | 'redis' | 'mysql' | 'mongo' | 'sqlite' | …
  | 'host' // a hosting/managed provider (Railway, Vercel, Neon, Supabase, Fly, Docker).
  // provider in attrs.provider: 'railway' | 'vercel' | 'neon' | 'supabase' | 'fly' | 'docker' | …
  | 'externalService' // a third-party service the system calls out to (Stripe, OpenAI, …)
  | 'cron'; // a scheduled job (schedule in attrs.schedule)

/** Confidence tiers. One boolean edge is forbidden (PLAN.md eng hardening #5). */
export type WiringTier =
  | 'literal' // fetch("/api/x")
  | 'constant-resolved' // fetch(ROUTES.x) where ROUTES.x is a literal const
  | 'helper-resolved' // recognized helper wrapper resolved to a literal
  | 'sdk' // external SDK call (supabase-js etc.) — not a route wire
  | 'dynamic'; // URL built at runtime → UNDETERMINED territory

export type MiddlewareTier =
  | 'global-exists' // middleware.ts exists
  | 'matcher-includes' // config.matcher provably includes the route
  | 'guard-wrapper' // recognized auth/rate-limit wrapper present
  | 'unconfirmed'; // attachment semantics not confirmable

export type ConfidenceTier = WiringTier | MiddlewareTier;

export interface Provenance {
  /** Repo-relative path, POSIX separators. */
  file: string;
  /** 1-based. */
  line: number;
  endLine?: number;
  /** Extractor rule that produced this fact, e.g. "routes/app-router-page". */
  ruleId: string;
}

export interface FactNode {
  /** Stable id: `${kind}:${name}` (e.g. "route:GET /api/login"). */
  id: string;
  kind: EntityKind;
  name: string;
  provenance: Provenance | null;
  /** Small, JSON-safe attributes (e.g. { method: "GET", exposure: "client" }). */
  attrs: Record<string, string | number | boolean | null>;
  /** Repo-relative file paths whose change invalidates this fact. */
  invalidatedBy: string[];
  /**
   * Transient unresolved reference: referenced but target doesn't exist (yet).
   * During an active build this must resolve UNDETERMINED, never ABSENT.
   */
  unresolved?: boolean;
}

export type EdgeKind =
  | 'imports'
  | 'exports'
  | 'calls'
  | 'attachedTo' // middleware → route
  | 'wiredTo' // clientCall → route
  | 'reads' // file/function → envVar
  | 'dependsOn' // file → dependency
  | 'hasColumn' // dbTable → dbColumn
  | 'persistsTo' // route/function → dbTable
  | 'navigatesTo' // page/component → page (or external) link
  | 'submitsTo' // form → route (or external/unknown)
  // ── full-system-map edges (data + infra flow across the live system) ──
  | 'hostedOn' // server/database → host (which provider runs it)
  | 'callsServer' // frontend page/form/clientCall → server (a request to the backend)
  | 'queriesDb' // server/worker → database (this service talks to this store)
  | 'storesData' // server/route/worker → dbTable (writes/reads this data).
  // attrs.sensitive lists PII columns touched, e.g. "phone, login_token"
  | 'containsTable' // database → dbTable (this store holds this table)
  | 'runsCron'; // cron → server route (the scheduled job hits this endpoint)

export interface FactEdge {
  /** Stable id: `${kind}:${from}->${to}`. */
  id: string;
  kind: EdgeKind;
  from: string; // FactNode id
  to: string; // FactNode id
  provenance: Provenance | null;
  tier?: ConfidenceTier;
  invalidatedBy: string[];
  unresolved?: boolean;
}

export interface ParseFailure {
  file: string;
  reason: string;
}

export interface FactsGraph {
  schemaVersion: number;
  repoRoot: string;
  /** ISO timestamp of extraction. */
  generatedAt: string;
  /** True while the building agent is actively writing (hook lifecycle). */
  buildActive: boolean;
  /** Files that failed to parse → their scope is UNDETERMINED, never ABSENT. */
  parseFailures: ParseFailure[];
  nodes: FactNode[];
  edges: FactEdge[];
  /** Counts per category for progress display + doctor. */
  stats: Record<string, number>;
}

export function makeNodeId(kind: EntityKind, name: string): string {
  return `${kind}:${name}`;
}

export function makeEdgeId(kind: EdgeKind, from: string, to: string): string {
  return `${kind}:${from}->${to}`;
}

export function emptyGraph(repoRoot: string): FactsGraph {
  return {
    schemaVersion: SCHEMA_VERSION,
    repoRoot,
    generatedAt: new Date().toISOString(),
    buildActive: false,
    parseFailures: [],
    nodes: [],
    edges: [],
    stats: {},
  };
}

// ---------------------------------------------------------------------------
// Claims (the structured manifest — the checker consumes ONLY this)
// ---------------------------------------------------------------------------

export type ClaimCategory =
  | 'route' // "there is a route handling X"
  | 'middleware' // "middleware M is attached to route X"
  | 'schema' // "table T (with column C) exists"
  | 'env' // "env var E is read"
  | 'dep' // "dependency D is installed"
  | 'wiring'; // "frontend calls route X"

export type ClaimPredicate =
  | 'exists'
  | 'attached'
  | 'has-column'
  | 'reads'
  | 'installed'
  | 'wired';

export interface Claim {
  id: string;
  category: ClaimCategory;
  predicate: ClaimPredicate;
  /** The thing claimed, normalized: route path, table name, env name, dep name. */
  subject: string;
  /** e.g. { method: "POST", middleware: "rate-limit", column: "email" } */
  qualifiers: Record<string, string>;
  /** Original natural-language claim text, verbatim. Untrusted input. */
  rawText: string;
}

/** A claim the translator could not express in manifest categories. */
export interface UnverifiableClaim {
  rawText: string;
  reason: string; // e.g. "behavior claim — presence-only tool"
}

export interface ClaimManifest {
  schemaVersion: number;
  sessionId: string;
  source: 'agent' | 'user' | 'file';
  claims: Claim[];
  unverifiable: UnverifiableClaim[];
}

// ---------------------------------------------------------------------------
// Verdicts (three states — computed deterministically, never by the model)
// ---------------------------------------------------------------------------

export type Verdict = 'confirmed' | 'absent' | 'undetermined';

export interface UndeterminedExplainer {
  /** Plain-language reason, written for a non-coder, leads the display. */
  reason: string;
  /** The exact defeating code pattern (technical disclosure, behind expand). */
  pattern?: string;
  provenance?: Provenance;
}

export interface ClaimVerdict {
  claimId: string;
  claim: Claim;
  verdict: Verdict;
  /** CONFIRMED: one or more receipts. Every receipt resolves to file:line. */
  receipts: Provenance[];
  /** ABSENT: provable absence requires the recorded search scope. */
  searchScope?: string[];
  /** UNDETERMINED: always carries an explainer. */
  explainer?: UndeterminedExplainer;
  /** Fact node/edge ids this verdict is grounded in (narrator binds to these). */
  factIds: string[];
  timestamp: string;
}

export interface VerdictSummary {
  confirmed: number;
  absent: number;
  undetermined: number;
  unverifiable: number;
  /** coverage = checkable / (checkable + unverifiable) */
  coverage: number;
}

export function summarizeVerdicts(
  verdicts: ClaimVerdict[],
  unverifiableCount: number,
): VerdictSummary {
  const s: VerdictSummary = {
    confirmed: 0,
    absent: 0,
    undetermined: 0,
    unverifiable: unverifiableCount,
    coverage: 0,
  };
  for (const v of verdicts) s[v.verdict]++;
  const checkable = verdicts.length;
  const total = checkable + unverifiableCount;
  s.coverage = total === 0 ? 1 : checkable / total;
  return s;
}

// ---------------------------------------------------------------------------
// Narrator statements (fact-ID bound; whole-statement drops only)
// ---------------------------------------------------------------------------

export interface NarratorStatement {
  /** Plain-language sentence. */
  text: string;
  /** Fact node/edge ids that must exist in the graph and support the claim. */
  factIds: string[];
  /** The verdict this statement describes — narrator may NEVER alter it. */
  claimId?: string;
}

export interface NarratorReport {
  statements: NarratorStatement[];
  /** Statements removed by the lint (shown as a count to the user). */
  removedCount: number;
}

// ---------------------------------------------------------------------------
// Ledger (append-only JSONL; doubles as the audit trail + regression source)
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  type: 'claim-checked' | 'regression-alert' | 'session-start';
  sessionId: string;
  timestamp: string;
  verdict?: ClaimVerdict;
  /** regression-alert: the previously confirmed claim that no longer holds. */
  previous?: ClaimVerdict;
  current?: ClaimVerdict;
}

// ---------------------------------------------------------------------------
// Hook lifecycle state machine (PLAN.md eng hardening)
// ---------------------------------------------------------------------------

export type LifecycleState =
  | 'idle'
  | 'plan-captured'
  | 'build-active'
  | 'extraction-pending'
  | 'extraction-stable'
  | 'claims-received'
  | 'verdicts-streamed'
  | 'report-finalized';

// ---------------------------------------------------------------------------
// Plan-intent view (NOT deterministic — LLM-mediated; carved out of the
// determinism guarantee, always labeled "PLANNED — not yet verified")
// ---------------------------------------------------------------------------

export interface PlannedNode {
  kind: EntityKind;
  name: string;
  /** Free-text description from the plan. */
  note?: string;
}

export interface PlanIntent {
  schemaVersion: number;
  capturedAt: string;
  source: 'plan-mode' | 'user';
  nodes: PlannedNode[];
}
