/**
 * SystemMap — the full live system breakdown.
 *
 * This is a DISPLAY-LAYER projection, not the deterministic facts IR. It is
 * produced by the "organize" pass: a separate, clean-context LLM that reads the
 * real source code + the deterministic facts and assembles a coherent,
 * plain-language map of the WHOLE system — frontend, servers, data stores,
 * hosting, external services, scheduled jobs, and the data flows between them.
 *
 * Trust model (PLAN.md + the 2026-06 pivot):
 *   - The deterministic extractor still owns the FACTS (nodes with file:line
 *     receipts). It cannot hallucinate.
 *   - The LLM ORGANIZES and EXPLAINS those facts; it may only reference nodes it
 *     can cite a real file for. Any node/edge whose `file` receipt does not
 *     resolve to a real path in the repo is DROPPED before render (validateMap).
 *   - Every assertion the user reads carries a receipt they can open.
 *
 * So the map is LLM-organized but fact-anchored: coherent like an LLM diagram,
 * checkable like a deterministic one.
 */

export const SYSTEM_MAP_VERSION = 1;

/** Which horizontal band a node lives in (the live-system layers). */
export type SystemLayer =
  | 'frontend' // what people see (pages, the API client)
  | 'servers' // the services doing the work (api, worker, scrapers, web)
  | 'data' // where data is stored (databases, caches, tables)
  | 'external' // third-party services the system calls out to
  | 'scheduled'; // cron / scheduled jobs

export type SystemNodeKind =
  | 'page' // a screen a person sees
  | 'server' // a service that runs code (api / web)
  | 'worker' // a background processor
  | 'scraper' // a bot/poller that pulls from an external surface
  | 'database' // a primary data store (Postgres, …)
  | 'cache' // a fast store / queue (Redis, …)
  | 'dataTable' // one table inside a database
  | 'externalService' // a third-party API (Stripe, OpenAI, Sendblue, …)
  | 'cron'; // a scheduled job

/**
 * A recognized hosting/infra PROVIDER — drives the little badge on a node so a
 * non-technical user recognizes "oh, that's on Railway / that's a Neon
 * database." 'unknown' renders a neutral chip.
 */
export type Provider =
  | 'railway'
  | 'vercel'
  | 'neon'
  | 'supabase'
  | 'postgres'
  | 'redis'
  | 'docker'
  | 'fly'
  | 'cloudflare'
  | 'aws'
  | 'openai'
  | 'anthropic'
  | 'stripe'
  | 'instagram'
  | 'tiktok'
  | 'unknown';

export interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  layer: SystemLayer;
  /** Plain-language name a non-coder understands ("Your main database"). */
  label: string;
  /** Precise technical identity ("Postgres + pgvector (neondb)"). */
  technical: string;
  /** Where it runs / who provides it, human-readable ("Neon AWS us-west-2"). */
  host?: string;
  /** Recognized provider for the badge. */
  provider?: Provider;
  /** For dataTable nodes: columns that hold sensitive/personal data. */
  sensitive?: string[];
  /** Repo-relative file:line receipt — the user can open this to verify. */
  file?: string;
  /** Optional plain-language note (e.g. "coded but not deployed"). */
  note?: string;
}

export interface SystemEdge {
  from: string;
  to: string;
  /** Plain/technical description of what crosses this edge. */
  flows: string;
  /** Receipt. */
  file?: string;
  /** True = the connection is intended/coded but NOT live (render dashed/grey). */
  intended?: boolean;
}

export interface DataFlow {
  /** Plain headline, e.g. "Save a video by text message". */
  title: string;
  /** The end-to-end story in plain language. */
  plain: string;
}

export interface SystemConcern {
  /** Plain-language label of what looks off. */
  label: string;
  detail: string;
  file?: string;
  severity?: 'high' | 'med' | 'low';
}

export interface SystemMap {
  schemaVersion: number;
  /** 'llm' = organize pass produced it; 'deterministic' = raw-facts fallback. */
  generatedBy: 'llm' | 'deterministic';
  /**
   * 'nextjs' = the full layered app map (pages → server → records → services),
   * available when Next.js routes/schema are detected. 'universal' = the
   * any-JS/TS-project map (your code areas → the packages + outside services
   * they use), shown when deep Next.js structure is absent. The UI relabels its
   * bands and shows an honest "deep checks are Next.js-only" note for universal.
   */
  mapKind?: 'nextjs' | 'universal';
  generatedAt: string;
  repoRoot: string;
  /** Plain "what this whole system is", 3-4 sentences. */
  what: string;
  nodes: SystemNode[];
  edges: SystemEdge[];
  /** The main end-to-end user/data journeys. */
  dataFlows: DataFlow[];
  /** Adversarial "what looks off" findings. */
  concerns: SystemConcern[];
}

// ---------------------------------------------------------------------------
// Layer + provider derivation (deterministic helpers used by the converter and
// as a backstop if the LLM omits them).
// ---------------------------------------------------------------------------

const LAYER_BY_KIND: Record<SystemNodeKind, SystemLayer> = {
  page: 'frontend',
  server: 'servers',
  worker: 'servers',
  scraper: 'servers',
  database: 'data',
  cache: 'data',
  dataTable: 'data',
  externalService: 'external',
  cron: 'scheduled',
};

export function layerForKind(kind: SystemNodeKind): SystemLayer {
  return LAYER_BY_KIND[kind] ?? 'servers';
}

/** Best-effort provider detection from a host/technical string. */
export function detectProvider(text: string | undefined): Provider {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (t.includes('railway')) return 'railway';
  if (t.includes('vercel')) return 'vercel';
  if (t.includes('neon')) return 'neon';
  if (t.includes('supabase')) return 'supabase';
  if (t.includes('redis')) return 'redis';
  if (t.includes('postgres') || t.includes('pgvector') || t.includes('psql')) return 'postgres';
  if (t.includes('docker')) return 'docker';
  if (t.includes('fly.io') || t.includes('fly ')) return 'fly';
  if (t.includes('cloudflare') || t.includes(' r2')) return 'cloudflare';
  if (t.includes('anthropic') || t.includes('claude')) return 'anthropic';
  if (t.includes('openai')) return 'openai';
  if (t.includes('stripe')) return 'stripe';
  if (t.includes('instagram')) return 'instagram';
  if (t.includes('tiktok')) return 'tiktok';
  if (t.includes('aws')) return 'aws';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Validation — drop anything the LLM asserted that isn't fact-anchored.
// ---------------------------------------------------------------------------

/**
 * Keep only nodes/edges the user can verify. A node survives if it has a `file`
 * receipt whose path (before any :line) exists in `realFiles` (repo-relative,
 * POSIX). Edges survive only if both endpoints survive. This is the guardrail
 * that keeps the LLM from inventing structure: no receipt → dropped.
 *
 * `realFiles` is the set of repo-relative paths the deterministic walker saw.
 * Pass an empty set to skip file validation (still prunes dangling edges).
 */
export function validateMap(map: SystemMap, realFiles: ReadonlySet<string>): SystemMap {
  const fileOk = (f: string | undefined): boolean => {
    if (realFiles.size === 0) return true; // validation disabled
    if (!f) return false;
    const path = f.split(':')[0]!.replace(/^\.\//, '');
    return realFiles.has(path);
  };
  const keptNodes = map.nodes.filter((n) => realFiles.size === 0 || fileOk(n.file));
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges = map.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));
  return { ...map, nodes: keptNodes, edges: keptEdges };
}
