/**
 * system-map-derive.ts — the deterministic raw-facts fallback for the SystemMap.
 *
 * The SystemMap contract (core/system-map.ts) anticipates two producers:
 * an LLM "organize" pass (`generatedBy: 'llm'`) and a deterministic fallback
 * (`generatedBy: 'deterministic'`). This module IS that fallback: a pure
 * function from the FactsGraph to a SystemMap, so the layered comprehension
 * view ("WHAT PEOPLE SEE" → "SERVERS DOING THE WORK" → "WHERE DATA LIVES" →
 * "OUTSIDE SERVICES"), the How-it-works stories, the What-looks-off concerns,
 * and the guided tour all light up with zero LLM calls and zero config.
 *
 * Honesty rules (same discipline as the verdict layer):
 *   - Every node/edge carries a real file:line receipt from graph provenance.
 *   - Nothing is guessed: an external service appears only if its package is in
 *     package.json; a "talks to" edge is dashed (`intended`) unless a real
 *     import site was seen; concerns are presence statements ("I couldn't find
 *     a security check"), never behavior judgments ("this is insecure").
 */
import type { FactsGraph, FactNode, Provenance } from '../core/schema.js';
import {
  SYSTEM_MAP_VERSION,
  type SystemMap,
  type SystemNode,
  type SystemEdge,
  type SystemConcern,
  type Provider,
  layerForKind,
} from '../core/system-map.js';
import { TOUR_VERSION, type Tour, type Beat } from '../core/tour.js';
import { deriveFlows, derivePages, type UserFlow } from './flows.js';

export const SERVER_NODE_ID = 'server:app';
export const DB_NODE_ID = 'db:main';

/** Middleware attachment tiers that prove a guard runs before the route. */
const GUARD_TIERS: ReadonlySet<string> = new Set(['matcher-includes', 'guard-wrapper']);

/** Column names that read as personal/sensitive data (display flag only). */
const SENSITIVE_COLUMN = /^(email|e_?mail|password|pass(word)?_?hash|phone|phone_?number|token|secret|api_?key|ssn|address|card|credit_?card|dob|birth)/i;

/** Env-var names that read as secrets (for the client-exposure concern). */
const SECRETLIKE_ENV = /(secret|token|_key|key_|password|private|credential)/i;

/** Recognized third-party packages → a friendly external-service card. */
const KNOWN_EXTERNAL: ReadonlyArray<{ test: RegExp; label: string; provider: Provider }> = [
  { test: /^stripe$/, label: 'Stripe — payments', provider: 'stripe' },
  { test: /^openai$/, label: 'OpenAI — AI', provider: 'openai' },
  { test: /^@anthropic-ai\//, label: 'Anthropic — AI', provider: 'anthropic' },
  { test: /^@supabase\//, label: 'Supabase — data & auth', provider: 'supabase' },
  { test: /^(resend|@sendgrid\/mail|postmark|nodemailer)$/, label: 'Email sending', provider: 'unknown' },
  { test: /^twilio$/, label: 'Twilio — texts & calls', provider: 'unknown' },
  { test: /^(@aws-sdk\/|aws-sdk$)/, label: 'AWS — cloud services', provider: 'aws' },
  { test: /^(@upstash\/redis|ioredis|redis)$/, label: 'Redis — fast storage', provider: 'redis' },
  { test: /^(firebase|firebase-admin)$/, label: 'Firebase', provider: 'unknown' },
  { test: /^@clerk\//, label: 'Clerk — sign-in', provider: 'unknown' },
];

function receiptOf(p: Provenance | null | undefined): string | undefined {
  if (!p || !p.file) return undefined;
  return `${p.file}:${p.line}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function listNames(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

export interface DeriveOptions {
  /** Injectable timestamp so derivation is fully deterministic in tests. */
  now?: string;
}

/**
 * Derive a deterministic SystemMap from the facts graph. Returns null when the
 * graph holds nothing worth mapping (no pages, no routes, no tables) so callers
 * can keep the empty state instead of writing a hollow map.
 */
export function deriveSystemMap(graph: FactsGraph, opts: DeriveOptions = {}): SystemMap | null {
  const pages = derivePages(graph);
  const flows = deriveFlows(graph);

  const routes = graph.nodes.filter((n) => n.kind === 'route');
  const apiRoutes = routes.filter((n) => /\/api(\/|$)/.test(n.name));
  const tables = graph.nodes
    .filter((n) => n.kind === 'dbTable' && !n.unresolved)
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  if (pages.length === 0 && routes.length === 0 && tables.length === 0) return null;

  const nodes: SystemNode[] = [];
  const edges: SystemEdge[] = [];
  const nodeIds = new Set<string>();
  const push = (n: SystemNode): void => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };

  // ---- frontend: visitable pages -----------------------------------------
  const pageIdByFile = new Map<string, string>();
  for (const p of pages) {
    const id = `page:${p.path}`;
    push({
      id,
      kind: 'page',
      layer: 'frontend',
      label: p.label,
      technical: p.path,
      file: p.receipt ? `${p.receipt.file}:${p.receipt.line}` : undefined,
    });
    if (p.receipt) pageIdByFile.set(p.receipt.file, id);
  }

  // ---- the server (the working part) -------------------------------------
  const serverReceiptSource = [...apiRoutes, ...routes].find((r) => r.provenance);
  push({
    id: SERVER_NODE_ID,
    kind: 'server',
    layer: 'servers',
    label: "Your app's server",
    technical: `Next.js App Router — ${plural(apiRoutes.length, 'API endpoint')}`,
    file: receiptOf(serverReceiptSource?.provenance),
  });

  // ---- frontend: flow callers (forms/components that send data) ----------
  // A flow's first step is the calling UI. If its file is already a page node,
  // reuse it; otherwise it gets its own card ("Login form") — it IS something
  // people see and use.
  const flowSourceId = new Map<string, string>(); // flow.id -> frontend node id
  for (const f of flows) {
    const first = f.steps[0];
    if (!first || first.kind !== 'page') continue;
    let srcId = first.receipt ? pageIdByFile.get(first.receipt.file) : undefined;
    if (!srcId) {
      srcId = `ui:${first.receipt ? first.receipt.file : f.id}`;
      push({
        id: srcId,
        kind: 'page',
        layer: 'frontend',
        label: first.label,
        technical: first.receipt ? first.receipt.file : 'frontend component',
        file: first.receipt ? `${first.receipt.file}:${first.receipt.line}` : undefined,
      });
    }
    flowSourceId.set(f.id, srcId);
  }

  // ---- frontend → server edges, one per traced relationship --------------
  const seenEdge = new Set<string>();
  for (const f of flows) {
    const from = flowSourceId.get(f.id);
    if (!from) continue;
    const key = `${from}->${SERVER_NODE_ID}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const endpoint = f.steps.find((s) => s.kind === 'endpoint');
    const guarded = f.steps.some((s) => s.kind === 'guard');
    const flowsText = f.traced
      ? `sends info to ${endpoint ? endpoint.label : 'the server'}${guarded ? ' (security-checked)' : ''}`
      : 'sends info somewhere I can’t fully trace';
    const rcpt = endpoint?.receipt ?? f.steps[0]?.receipt;
    edges.push({
      from,
      to: SERVER_NODE_ID,
      flows: flowsText,
      file: rcpt ? `${rcpt.file}:${rcpt.line}` : undefined,
      intended: f.traced ? undefined : true,
    });
  }

  // ---- data: database + table cluster -------------------------------------
  const persists = graph.edges.filter((e) => e.kind === 'persistsTo' && !e.unresolved);
  if (tables.length > 0) {
    const deps = graph.nodes.filter((n) => n.kind === 'dependency');
    const engineDep = deps.find((d) => /^(pg|postgres|@neondatabase\/serverless)$/.test(d.name));
    push({
      id: DB_NODE_ID,
      kind: 'database',
      layer: 'data',
      label: 'Your database',
      technical: `Prisma schema — ${plural(tables.length, 'model')}`,
      provider: engineDep ? 'postgres' : 'unknown',
      file: receiptOf(tables[0]!.provenance),
    });
    for (const t of tables) {
      const columns = graph.edges
        .filter((e) => e.kind === 'hasColumn' && e.from === t.id)
        .map((e) => graph.nodes.find((n) => n.id === e.to))
        .filter((n): n is FactNode => !!n);
      const sensitive = columns
        .map((c) => c.name.split('.').pop() ?? c.name)
        .filter((name) => SENSITIVE_COLUMN.test(name));
      push({
        id: `table:${t.name}`,
        kind: 'dataTable',
        layer: 'data',
        label: `${t.name} records`,
        technical: `model ${t.name} — ${plural(columns.length, 'field')}`,
        sensitive: sensitive.length > 0 ? sensitive : undefined,
        file: receiptOf(t.provenance),
      });
      edges.push({ from: DB_NODE_ID, to: `table:${t.name}`, flows: 'holds these records', file: receiptOf(t.provenance) });
    }
    const firstWrite = persists.find((e) => e.provenance);
    edges.push({
      from: SERVER_NODE_ID,
      to: DB_NODE_ID,
      flows: persists.length > 0 ? 'saves and reads your records' : 'set up, but I couldn’t see it being used yet',
      file: firstWrite ? receiptOf(firstWrite.provenance) : receiptOf(tables[0]!.provenance),
      intended: persists.length > 0 ? undefined : true,
    });
  }

  // ---- external services from real dependencies ---------------------------
  const extLabels: string[] = [];
  const depNodes = graph.nodes
    .filter((n) => n.kind === 'dependency')
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const dep of depNodes) {
    const known = KNOWN_EXTERNAL.find((k) => k.test.test(dep.name));
    if (!known) continue;
    const id = `ext:${dep.name}`;
    push({
      id,
      kind: 'externalService',
      layer: layerForKind('externalService'),
      label: known.label,
      technical: dep.name,
      provider: known.provider,
      file: receiptOf(dep.provenance),
    });
    extLabels.push(known.label.split(' — ')[0]!);
    // A solid edge only when an import site proves the code touches it.
    const usage = graph.edges.find((e) => e.kind === 'dependsOn' && e.to === dep.id && e.provenance);
    edges.push({
      from: SERVER_NODE_ID,
      to: id,
      flows: usage ? `your code talks to ${known.label.split(' — ')[0]}` : 'in package.json — I couldn’t see where it’s used',
      file: usage ? receiptOf(usage.provenance) : receiptOf(dep.provenance),
      intended: usage ? undefined : true,
    });
  }

  // ---- the plain "what this is" summary -----------------------------------
  const sentences: string[] = [];
  if (pages.length > 0) {
    sentences.push(
      `People can visit ${plural(pages.length, 'page')} — ${listNames(pages.map((p) => p.label))}.`,
    );
  }
  if (apiRoutes.length > 0) {
    sentences.push(`${plural(apiRoutes.length, 'door')} (API endpoints) do the work behind the scenes.`);
  }
  if (tables.length > 0) {
    sentences.push(
      `Information is saved in ${plural(tables.length, 'kind')} of records (${listNames(tables.map((t) => t.name))}).`,
    );
  }
  if (extLabels.length > 0) {
    sentences.push(`It also talks to outside services: ${listNames(extLabels)}.`);
  }

  return {
    schemaVersion: SYSTEM_MAP_VERSION,
    generatedBy: 'deterministic',
    generatedAt: opts.now ?? new Date().toISOString(),
    repoRoot: graph.repoRoot,
    what: sentences.join(' '),
    nodes,
    edges,
    dataFlows: flows.map((f) => ({ title: f.title, plain: f.plain })),
    concerns: deriveConcerns(graph, flows),
  };
}

/**
 * Deterministic "what looks off" findings. Every concern is a PRESENCE
 * statement with a receipt — "I couldn't find X" / "I can't trace Y" — never a
 * behavior judgment. Same three-state honesty as the verdict layer.
 */
export function deriveConcerns(graph: FactsGraph, flows?: UserFlow[]): SystemConcern[] {
  const concerns: SystemConcern[] = [];

  // 1. A secret-looking setting exposed to the browser (high).
  for (const n of graph.nodes) {
    if (n.kind !== 'envVar') continue;
    if (String(n.attrs?.exposure ?? '') !== 'client') continue;
    if (!SECRETLIKE_ENV.test(n.name)) continue;
    concerns.push({
      label: `A setting named like a secret is visible to the browser: ${n.name}`,
      detail:
        'Settings starting with NEXT_PUBLIC_ are shipped to everyone who opens the site. A name like this usually belongs server-side only.',
      file: receiptOf(n.provenance),
      severity: 'high',
    });
  }

  // 2. A door that saves information with no security check in front of it (med).
  const guardedRoutes = new Set(
    graph.edges
      .filter((e) => e.kind === 'attachedTo' && e.tier && GUARD_TIERS.has(e.tier))
      .map((e) => e.to),
  );
  const failedFiles = new Set(graph.parseFailures.map((p) => p.file));
  for (const e of graph.edges) {
    if (e.kind !== 'persistsTo' || e.unresolved) continue;
    if (guardedRoutes.has(e.from)) continue;
    const route = graph.nodes.find((n) => n.id === e.from);
    if (!route || route.kind !== 'route') continue;
    if (route.provenance && failedFiles.has(route.provenance.file)) continue;
    const table = graph.nodes.find((n) => n.id === e.to);
    concerns.push({
      label: `Information is saved at ${route.name} and I couldn’t find a security check in front of it`,
      detail: `This door writes to ${table ? table.name + ' records' : 'the database'}. I looked for middleware or a recognized guard covering it and found none — worth confirming that’s intentional.`,
      file: receiptOf(e.provenance) ?? receiptOf(route.provenance),
      severity: 'med',
    });
  }

  // 3. Calls whose destination can't be traced from the code (low).
  const flowList = flows ?? deriveFlows(graph);
  for (const f of flowList) {
    if (f.traced) continue;
    const first = f.steps[0];
    concerns.push({
      label: `${first ? first.label : 'A page'} sends information somewhere I can’t trace`,
      detail:
        'The destination is built at runtime, so I can’t follow it from the code alone. Not necessarily wrong — just invisible to this map.',
      file: first?.receipt ? `${first.receipt.file}:${first.receipt.line}` : undefined,
      severity: 'low',
    });
  }

  // 4. Files the reader couldn't parse — invisible scope (med).
  for (const p of graph.parseFailures) {
    concerns.push({
      label: `I couldn’t read ${p.file}`,
      detail: `Anything inside it is invisible to this map (${p.reason}). Usually a build-in-progress or a syntax error.`,
      file: `${p.file}:1`,
      severity: 'med',
    });
  }

  return concerns;
}

/**
 * Derive the guided tour from a deterministic SystemMap: the map assembles
 * itself one plain beat at a time. Reveal ids are node ids; edges appear on
 * their own once both endpoints are visible.
 */
export function deriveTour(map: SystemMap): Tour {
  const beats: Beat[] = [];
  const pageNodes = map.nodes.filter((n) => n.kind === 'page');
  const extNodes = map.nodes.filter((n) => n.kind === 'externalService');
  const db = map.nodes.find((n) => n.kind === 'database' || n.kind === 'cache');

  beats.push({
    caption: 'This is your app, drawn from the real code — let’s build the picture one piece at a time.',
    reveal: [],
  });
  if (pageNodes.length > 0) {
    const names = pageNodes.slice(0, 3).map((n) => n.label);
    beats.push({
      caption: `These are the screens people can open — ${listNames(names)}${pageNodes.length > 3 ? ` and ${pageNodes.length - 3} more` : ''}.`,
      reveal: pageNodes.map((n) => n.id),
    });
  }
  if (map.nodes.some((n) => n.id === SERVER_NODE_ID)) {
    beats.push({
      caption: 'Behind the screens sits the working part of your app. When a page sends something, it arrives here, and this part decides what happens.',
      reveal: [SERVER_NODE_ID],
    });
  }
  if (db) {
    beats.push({
      caption: 'Anything worth remembering is saved here — your records. Tap it later to see exactly what kinds.',
      reveal: [db.id],
    });
  }
  if (extNodes.length > 0) {
    beats.push({
      caption: `Your app also talks to services run by other companies: ${listNames(extNodes.map((n) => n.label.split(' — ')[0]!))}.`,
      reveal: extNodes.map((n) => n.id),
    });
  }
  if (map.concerns.length > 0) {
    beats.push({
      caption: `${plural(map.concerns.length, 'thing')} looked worth checking. None of them is a verdict — each points at the exact line of code, so you can see for yourself.`,
      reveal: [],
      concern: true,
    });
  }
  beats.push({
    caption: 'That’s the whole picture. Tap any piece to learn what it is in plain words — and to see the real code behind it.',
    reveal: [],
  });

  return { schemaVersion: TOUR_VERSION, title: 'How your app works', beats, generatedBy: 'deterministic' };
}
