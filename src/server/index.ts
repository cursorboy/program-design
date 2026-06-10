/**
 * index.ts — public API for the local server.
 *
 *   startDaemon(repoRoot, opts?)  → DaemonInfo  (idempotent; in-process start)
 *   stopDaemon(repoRoot)          → boolean
 *   daemonStatus(repoRoot)        → DaemonInfo | null  (validated liveness+owner)
 *   graphToMermaid(graph, opts?)  → string
 *   notifyRefresh(repoRoot, kind) → Promise<void>  (no-op if no daemon)
 *
 * Threading model (documented): startDaemon starts the server IN-PROCESS and
 * returns once it is listening. It does NOT detach/background itself — the CLI
 * decides whether to fork a backgrounded process (e.g. `program-design live`
 * spawning a detached child that calls startDaemon). This keeps the server
 * testable and the lifecycle decision in the CLI's hands.
 */
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

import {
  type DaemonInfo,
  ensureStateDir,
  statePath,
} from '../core/state.js';
import type { FactsGraph } from '../core/schema.js';
import { createDaemon, type RunningDaemon } from './daemon.js';

export { graphToMermaid } from './diagram.js';
export { setLifecycle, getLifecycle } from './lifecycle.js';

const DEFAULT_START_PORT = 4317;
const MAX_PORT_SCAN = 100;

/** Registry of daemons started in THIS process (so stop/idle can close them). */
const localRegistry = new Map<string, RunningDaemon>();

// ---------------------------------------------------------------------------
// startDaemon
// ---------------------------------------------------------------------------

export async function startDaemon(
  repoRoot: string,
  opts?: { port?: number; open?: boolean; version?: string },
): Promise<DaemonInfo> {
  const root = resolve(repoRoot);

  // Capture any prior port.json token BEFORE daemonStatus runs — daemonStatus
  // deletes a stale (dead-pid) port file, and (for back-compat) we still treat
  // its token as a reuse source.
  const prior = readPortFile(root);

  // Idempotent: if a live daemon already owns this repo, return its info.
  const existing = daemonStatus(root);
  if (existing) return existing;

  ensureStateDir(root);

  const port = opts?.port
    ? await ensureFree(opts.port)
    : await firstFreePort(DEFAULT_START_PORT);

  // ── STABLE TOKEN across restarts ──────────────────────────────────────────
  //
  // token.json is the DURABLE source of truth for the per-repo session token.
  // Unlike port.json (deleted on a clean stop), token.json survives stop→start,
  // so an open browser tab keeps authenticating across a daemon restart — the
  // recurring "Lost connection …" that never recovered was a fresh token 401ing
  // every existing tab forever. Reuse order:
  //   1. a valid token in token.json (the durable source), else
  //   2. a valid token carried in a leftover port.json (back-compat), else
  //   3. mint a fresh 32-hex token.
  // Whichever token we settle on is written back to token.json so the NEXT
  // start reuses it.
  //
  // Security tradeoff (deliberate): the token is still a localhost-bound secret
  // that never leaves the machine (127.0.0.1-only bind + Host check). We trade
  // per-start token freshness for tab stability across restarts — chosen so the
  // user's browser tab keeps working when the daemon restarts.
  const durable = readTokenFile(root);
  const token = isValidToken(durable)
    ? durable
    : prior && isValidToken(prior.token)
      ? prior.token
      : randomBytes(16).toString('hex'); // 32 hex chars
  // Persist the durable token (idempotent write; only re-writes when changed).
  if (durable !== token) {
    writeFileSync(
      statePath(root, 'token'),
      JSON.stringify({ token }, null, 2),
      'utf8',
    );
  }
  const info: DaemonInfo = {
    port,
    pid: process.pid,
    token,
    repoRoot: root,
    version: opts?.version ?? '0.0.0',
    startedAt: new Date().toISOString(),
  };

  const running = await createDaemon({
    repoRoot: root,
    port,
    token,
    info,
    onClose: () => {
      localRegistry.delete(root);
      // Only remove port.json if it still describes THIS daemon.
      const cur = readPortFile(root);
      if (cur && cur.pid === process.pid && cur.token === token) {
        safeRemove(statePath(root, 'port'));
      }
    },
  });

  localRegistry.set(root, running);
  writeFileSync(statePath(root, 'port'), JSON.stringify(info, null, 2), 'utf8');

  if (opts?.open) {
    // Best-effort; never throws into the caller.
    void openBrowser(`http://127.0.0.1:${port}/?t=${token}`);
  }

  return info;
}

// ---------------------------------------------------------------------------
// stopDaemon
// ---------------------------------------------------------------------------

export async function stopDaemon(repoRoot: string): Promise<boolean> {
  const root = resolve(repoRoot);

  // If we own it in-process, close directly (fast path, deterministic in tests).
  const local = localRegistry.get(root);
  const info = readPortFile(root);

  if (local && info && info.pid === process.pid) {
    await local.close();
    // Delete port.json (this daemon is gone) but LEAVE token.json so the next
    // start reuses the same token → already-open browser tabs survive a clean
    // stop/start without a 401.
    safeRemove(statePath(root, 'port'));
    return true;
  }

  if (!info) return false;

  // Validate ownership (repoRoot) before signalling.
  if (resolve(info.repoRoot) !== root) {
    return false;
  }

  // If the pid is dead, just clean the stale file.
  if (!pidAlive(info.pid)) {
    safeRemove(statePath(root, 'port'));
    return false;
  }

  // Out-of-process: ask it to shut down, then wait for the pid to exit.
  try {
    await postShutdown(info);
  } catch {
    // fall through to signal-based stop
  }

  const exited = await waitForExit(info.pid, 5000);
  if (exited) {
    safeRemove(statePath(root, 'port'));
    return true;
  }

  // Last resort: SIGTERM.
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  const exited2 = await waitForExit(info.pid, 3000);
  if (exited2) safeRemove(statePath(root, 'port'));
  return exited2;
}

// ---------------------------------------------------------------------------
// daemonStatus
// ---------------------------------------------------------------------------

export function daemonStatus(repoRoot: string): DaemonInfo | null {
  const root = resolve(repoRoot);
  const info = readPortFile(root);
  if (!info) return null;

  // Ownership: the port file must describe THIS repo root.
  if (resolve(info.repoRoot) !== root) {
    safeRemove(statePath(root, 'port'));
    return null;
  }

  // Liveness: pid must exist.
  if (!pidAlive(info.pid)) {
    safeRemove(statePath(root, 'port'));
    return null;
  }

  return info;
}

// ---------------------------------------------------------------------------
// notifyRefresh
// ---------------------------------------------------------------------------

export async function notifyRefresh(
  repoRoot: string,
  kind: 'graph' | 'verdicts' | 'plan',
): Promise<void> {
  const root = resolve(repoRoot);
  const info = daemonStatus(root);
  if (!info) return; // no-op when no daemon

  await new Promise<void>((resolveP) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: `/api/refresh?kind=${encodeURIComponent(kind)}&t=${encodeURIComponent(info.token)}`,
        method: 'POST',
        headers: { 'X-PD-Token': info.token, 'content-length': '0' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolveP());
      },
    );
    req.on('error', () => resolveP()); // best-effort; never throws
    req.end();
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readPortFile(root: string): DaemonInfo | null {
  const p = statePath(root, 'port');
  if (!existsSync(p)) return null;
  try {
    const info = JSON.parse(readFileSync(p, 'utf8')) as DaemonInfo;
    if (
      typeof info.port === 'number' &&
      typeof info.pid === 'number' &&
      typeof info.token === 'string' &&
      typeof info.repoRoot === 'string'
    ) {
      return info;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the durable token from token.json. Returns the token string, or null if
 * the file is missing/corrupt. This is the stable source that survives a clean
 * stop (which deletes port.json but LEAVES token.json) so open tabs keep working.
 */
function readTokenFile(root: string): string | null {
  const p = statePath(root, 'token');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as { token?: unknown };
    return isValidToken(data.token) ? data.token : null;
  } catch {
    return null;
  }
}

/** A reusable token is a non-empty hex string of the minted shape (32 hex). */
function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{16,}$/.test(token);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it → still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function safeRemove(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await delay(50);
  }
  return !pidAlive(pid);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve the first free port at/after `start`, scanning up to MAX_PORT_SCAN. */
async function firstFreePort(start: number): Promise<number> {
  for (let p = start; p < start + MAX_PORT_SCAN; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`no free port found in ${start}..${start + MAX_PORT_SCAN}`);
}

/** Ensure a specific port is free; if not, throw a clear error. */
async function ensureFree(port: number): Promise<number> {
  if (await portFree(port)) return port;
  throw new Error(`port ${port} is already in use`);
}

/** True if a TCP connect to 127.0.0.1:port is refused (i.e. nothing listening). */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const done = (free: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolveP(free);
    };
    sock.setTimeout(400);
    sock.once('connect', () => done(false)); // something is listening
    sock.once('timeout', () => done(true));
    sock.once('error', (err: NodeJS.ErrnoException) => {
      // ECONNREFUSED → free; other errors → treat as not-free to be safe.
      done(err.code === 'ECONNREFUSED');
    });
  });
}

function postShutdown(info: DaemonInfo): Promise<void> {
  return new Promise<void>((resolveP, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: `/api/shutdown?t=${encodeURIComponent(info.token)}`,
        method: 'POST',
        headers: { 'X-PD-Token': info.token, 'content-length': '0' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolveP());
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Best-effort browser open across platforms. Never throws. */
async function openBrowser(url: string): Promise<void> {
  try {
    const { spawn } = await import('node:child_process');
    const platform = process.platform;
    const cmd =
      platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* ignore */
  }
}
