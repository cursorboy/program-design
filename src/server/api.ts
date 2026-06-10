/**
 * api.ts — request routing for the daemon.
 *
 * Reads ONLY state files (graph.json → FactsGraph, verdicts.json →
 * ClaimVerdict[], plan.json → PlanIntent, ledger.jsonl) via state.ts paths.
 * It never imports from core/extract|check|narrate (decoupling — the CLI writes
 * those files and POSTs a refresh).
 *
 * Endpoints (all tokened except the 401 page on /):
 *   GET  /                 → the SPA (served by daemon.ts; here for completeness)
 *   GET  /api/graph        → FactsGraph        (404 + emptyGraph shape if missing)
 *   GET  /api/verdicts     → ClaimVerdict[]    (404 + [] if missing)
 *   GET  /api/plan         → PlanIntent        (404 + empty plan if missing)
 *   GET  /api/system-map   → SystemMap         (404 + {} if missing)
 *   GET  /api/ledger       → LedgerEntry[]     (404 + [] if missing)
 *   GET  /api/mermaid      → text/plain mermaid source from the current graph
 *   GET  /api/snippet      → ±2 lines, jailed   (security.ts)
 *   GET  /api/health       → { ok, version, pid, lifecycleState }
 *   GET  /api/events       → long-poll: resolves when version > since or 25s
 *   POST /api/refresh      → bump in-memory version counter per kind
 *   POST /api/lifecycle    → set lifecycle state
 *   POST /api/shutdown     → graceful shutdown
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

import {
  emptyGraph,
  type FactsGraph,
  type ClaimVerdict,
  type PlanIntent,
  type LedgerEntry,
  SCHEMA_VERSION,
} from '../core/schema.js';
import type { SystemMap } from '../core/system-map.js';
import type { Tour } from '../core/tour.js';
import { statePath, stateDir } from '../core/state.js';
import { graphToMermaid } from './diagram.js';
import {
  deriveFlows,
  derivePages,
  deriveNavigation,
  deriveForms,
  computeNavDepths,
  type UserFlow,
  type PageEntry,
  type NavLink,
  type FormEntry,
} from './flows.js';

export function readGraph(repoRoot: string): FactsGraph | null {
  return readJson<FactsGraph>(statePath(repoRoot, 'graph'));
}
export function readVerdicts(repoRoot: string): ClaimVerdict[] | null {
  return readJson<ClaimVerdict[]>(statePath(repoRoot, 'verdicts'));
}
export function readPlan(repoRoot: string): PlanIntent | null {
  return readJson<PlanIntent>(statePath(repoRoot, 'plan'));
}
export function readSystemMap(repoRoot: string): SystemMap | null {
  return readJson<SystemMap>(statePath(repoRoot, 'systemMap'));
}
export function readTour(repoRoot: string): Tour | null {
  return readJson<Tour>(statePath(repoRoot, 'tour'));
}

// ---------------------------------------------------------------------------
// Screenshot serving — /api/shot?name=<n> reads <stateDir>/shots/<name>.png.
//
// SECURITY: this is the ONLY place we serve binary from the state dir, so it is
// jailed exactly like the snippet endpoint. The <name> is sanitized to a strict
// [a-z0-9_-] charset and the resolved path is asserted to live inside the shots
// dir — so "..", absolute paths, slashes, and NUL bytes can never escape. The
// caller decides the 404 for an absent file.
// ---------------------------------------------------------------------------
export interface ShotResult {
  ok: boolean;
  status: number;
  /** PNG bytes when ok. */
  bytes?: Buffer;
  error?: string;
}

/** True only for a clean shot name: lowercase letters, digits, dash, underscore. */
export function isSafeShotName(name: string): boolean {
  return /^[a-z0-9_-]+$/.test(name);
}

export function readShot(repoRoot: string, name: string): ShotResult {
  if (!name || !isSafeShotName(name)) {
    return { ok: false, status: 400, error: 'bad shot name' };
  }
  // name is jailed by construction (no slashes / dots / traversal possible).
  const dir = join(stateDir(repoRoot), 'shots');
  const file = join(dir, name + '.png');
  // Defense in depth: the resolved path must still sit inside the shots dir.
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  if (file !== join(dir, name + '.png') || !file.startsWith(prefix)) {
    return { ok: false, status: 403, error: 'outside shots dir' };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    return { ok: false, status: 404, error: 'not found' };
  }
  return { ok: true, status: 200, bytes };
}
export function readLedger(repoRoot: string): LedgerEntry[] | null {
  let text: string;
  try {
    text = readFileSync(statePath(repoRoot, 'ledger'), 'utf8');
  } catch {
    return null;
  }
  const out: LedgerEntry[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as LedgerEntry);
    } catch {
      // tolerate a partially-written trailing line during active appends
    }
  }
  return out;
}

function readJson<T>(path: string): T | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function emptyPlan(): PlanIntent {
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    source: 'plan-mode',
    nodes: [],
  };
}

export function mermaidForRepo(repoRoot: string): string {
  const g = readGraph(repoRoot) ?? emptyGraph(repoRoot);
  return graphToMermaid(g);
}

/**
 * The PLAIN-level projection served at GET /api/flows: deterministic plain-English
 * flow strips plus standalone visitable pages, both derived purely from the graph.
 */
export function flowsForRepo(repoRoot: string): {
  flows: UserFlow[];
  pages: PageEntry[];
  nav: NavLink[];
  forms: FormEntry[];
} {
  const g = readGraph(repoRoot) ?? emptyGraph(repoRoot);
  const pages = derivePages(g);
  const nav = deriveNavigation(g);
  const depths = computeNavDepths(pages, nav);
  for (const p of pages) p.depth = depths.get(p.path) ?? -1;
  return { flows: deriveFlows(g), pages, nav, forms: deriveForms(g) };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
}

export function sendPng(res: ServerResponse, status: number, bytes: Buffer): void {
  res.writeHead(status, {
    'content-type': 'image/png',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}
