/**
 * State-directory layout — shared contract for daemon, CLI, checker, views.
 *
 * State lives OUTSIDE the user's repo (PLAN.md DX spec): the repo is never
 * polluted. One state dir per repo root.
 *
 *   ~/.program-design/<sha256(repoRoot).slice(0,12)>/
 *     graph.json        — latest FactsGraph (disposable; rebuilt on mismatch)
 *     plan.json         — latest PlanIntent (if captured)
 *     ledger.jsonl      — append-only LedgerEntry lines
 *     port.json         — DaemonInfo (port, pid, token, repoRoot, version)
 *     token.json        — durable per-repo session token (survives stop/start so
 *                         open browser tabs keep authenticating across restarts)
 *     verdicts.json     — latest ClaimVerdict[] for the report view
 *     first-run         — marker file: daemon consent notice already shown
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface DaemonInfo {
  port: number;
  pid: number;
  /** Per-session token, required on every HTTP request (anti-rebinding). */
  token: string;
  repoRoot: string;
  version: string;
  startedAt: string;
}

export function repoHash(repoRoot: string): string {
  return createHash('sha256').update(resolve(repoRoot)).digest('hex').slice(0, 12);
}

export function stateDir(repoRoot: string): string {
  return join(homedir(), '.program-design', repoHash(repoRoot));
}

export function ensureStateDir(repoRoot: string): string {
  const dir = stateDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const STATE_FILES = {
  graph: 'graph.json',
  plan: 'plan.json',
  ledger: 'ledger.jsonl',
  port: 'port.json',
  token: 'token.json',
  verdicts: 'verdicts.json',
  firstRun: 'first-run',
  systemMap: 'system-map.json',
  tour: 'tour.json',
} as const;

export function statePath(
  repoRoot: string,
  file: keyof typeof STATE_FILES,
): string {
  return join(stateDir(repoRoot), STATE_FILES[file]);
}
