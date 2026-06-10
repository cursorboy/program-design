/**
 * daemon.ts — the node:http server (no frameworks).
 *
 * Security model (PLAN.md hardening, see security.ts):
 *  - binds 127.0.0.1 ONLY.
 *  - every request carries the per-session token (?t= or X-PD-Token); a
 *    tokenless request gets a friendly 401 HTML page.
 *  - Host header must be loopback → else 403 (anti-DNS-rebinding).
 *  - /api/snippet is jailed to realpath(repoRoot).
 *
 * In-memory state:
 *  - version counters per kind (graph/verdicts/plan), summed into a single
 *    monotonic `version` the long-poll /api/events compares against.
 *  - long-poll waiters resolved on bump or 25s timeout.
 *  - idle-shutdown timer: 2h with no requests → graceful exit (clearable).
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { URL } from 'node:url';

import type { DaemonInfo } from '../core/state.js';
import { emptyGraph } from '../core/schema.js';
import {
  isLoopbackHost,
  readSnippet,
  tokensMatch,
} from './security.js';
import {
  emptyPlan,
  flowsForRepo,
  mermaidForRepo,
  readGraph,
  readLedger,
  readPlan,
  readShot,
  readSystemMap,
  readTour,
  readVerdicts,
  sendHtml,
  sendJson,
  sendPng,
  sendText,
} from './api.js';
import { getLifecycle, resetLifecycle, setLifecycle } from './lifecycle.js';
import { renderAppHtml } from './views/app.js';
import type { LifecycleState } from '../core/schema.js';

const IDLE_SHUTDOWN_MS = 2 * 60 * 60 * 1000; // 2h
const LONGPOLL_TIMEOUT_MS = 25 * 1000;
const REFRESH_KINDS = ['graph', 'verdicts', 'plan'] as const;
type RefreshKind = (typeof REFRESH_KINDS)[number];

export interface RunningDaemon {
  server: Server;
  info: DaemonInfo;
  close(): Promise<void>;
}

interface Waiter {
  res: ServerResponse;
  timer: NodeJS.Timeout;
}

/**
 * Create and start the HTTP server bound to 127.0.0.1:port. Resolves once the
 * server is listening. The caller (index.startDaemon) is responsible for
 * writing port.json.
 */
export function createDaemon(args: {
  repoRoot: string;
  port: number;
  token: string;
  info: DaemonInfo;
  onClose?: () => void;
}): Promise<RunningDaemon> {
  const { repoRoot, port, token, info } = args;

  // ---- in-memory version state ----
  const versions: Record<RefreshKind, number> = { graph: 0, verdicts: 0, plan: 0 };
  let version = 0; // monotonic sum of bumps
  const waiters = new Set<Waiter>();

  function bump(kind: RefreshKind): void {
    versions[kind]++;
    version++;
    // wake long-poll waiters
    for (const w of [...waiters]) {
      clearTimeout(w.timer);
      waiters.delete(w);
      sendJson(w.res, 200, { version, versions });
    }
  }

  // ---- idle shutdown ----
  let idleTimer: NodeJS.Timeout | null = null;
  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // graceful self-exit after 2h of inactivity
      void close();
    }, IDLE_SHUTDOWN_MS);
    // do not keep the process alive solely for the idle timer
    idleTimer.unref?.();
  }

  resetLifecycle();

  const server = createServer((req, res) => {
    armIdle();
    handle(req, res).catch((err) => {
      try {
        sendJson(res, 500, { error: 'internal', detail: String(err && err.message) });
      } catch {
        /* response already sent */
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const host = req.headers.host;
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;

    // Host validation first (cheap, anti-rebinding).
    if (!isLoopbackHost(host, port)) {
      sendText(res, 403, 'Forbidden: invalid Host header.');
      return;
    }

    // Token: query ?t= (canonical, what the CLI prints) or ?token= (forgiving
    // alias — a hand-typed URL must not land on the 401 page) or X-PD-Token.
    const headerToken = headerStr(req.headers['x-pd-token']);
    const queryToken = url.searchParams.get('t') ?? url.searchParams.get('token') ?? undefined;
    const provided = queryToken ?? headerToken;
    const authed = tokensMatch(provided, token);

    // GET / without a valid token → friendly 401 page (never the app).
    if (path === '/' && method === 'GET') {
      if (!authed) {
        sendHtml(res, 401, unauthorizedPage());
        return;
      }
      sendHtml(res, 200, renderAppHtml({ token }));
      return;
    }

    // Everything else requires the token.
    if (!authed) {
      sendJson(res, 401, { error: 'unauthorized', hint: 'open via `program-design live`' });
      return;
    }

    // ---- authenticated routes ----
    if (path === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version,
        pid: info.pid,
        repoRoot: info.repoRoot,
        lifecycleState: getLifecycle(),
        schemaVersion: emptyGraph(repoRoot).schemaVersion,
      });
      return;
    }

    if (path === '/api/graph' && method === 'GET') {
      const g = readGraph(repoRoot);
      if (g) sendJson(res, 200, g);
      else sendJson(res, 404, emptyGraph(repoRoot));
      return;
    }

    if (path === '/api/verdicts' && method === 'GET') {
      const v = readVerdicts(repoRoot);
      if (v) sendJson(res, 200, v);
      else sendJson(res, 404, []);
      return;
    }

    if (path === '/api/plan' && method === 'GET') {
      const p = readPlan(repoRoot);
      if (p) sendJson(res, 200, p);
      else sendJson(res, 404, emptyPlan());
      return;
    }

    if (path === '/api/system-map' && method === 'GET') {
      const sm = readSystemMap(repoRoot);
      if (sm) sendJson(res, 200, sm);
      else sendJson(res, 404, {});
      return;
    }

    if (path === '/api/tour' && method === 'GET') {
      const t = readTour(repoRoot);
      if (t) sendJson(res, 200, t);
      else sendJson(res, 404, {});
      return;
    }

    if (path === '/api/shot' && method === 'GET') {
      const name = url.searchParams.get('name') ?? '';
      const r = readShot(repoRoot, name);
      if (r.ok && r.bytes) sendPng(res, 200, r.bytes);
      else sendJson(res, r.status, { error: r.error ?? 'not found' });
      return;
    }

    if (path === '/api/ledger' && method === 'GET') {
      const l = readLedger(repoRoot);
      if (l) sendJson(res, 200, l);
      else sendJson(res, 404, []);
      return;
    }

    if (path === '/api/mermaid' && method === 'GET') {
      sendText(res, 200, mermaidForRepo(repoRoot));
      return;
    }

    if (path === '/api/flows' && method === 'GET') {
      sendJson(res, 200, flowsForRepo(repoRoot));
      return;
    }

    if (path === '/api/snippet' && method === 'GET') {
      const file = url.searchParams.get('file') ?? '';
      const line = Number(url.searchParams.get('line') ?? '0');
      const r = readSnippet(repoRoot, file, line, 2);
      if (r.ok) {
        sendJson(res, 200, {
          file,
          lines: r.lines,
          startLine: r.startLine,
          endLine: r.endLine,
          centerLine: r.centerLine,
        });
      } else {
        sendJson(res, r.status, { error: r.error });
      }
      return;
    }

    if (path === '/api/events' && method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? '0');
      if (Number.isFinite(since) && version > since) {
        sendJson(res, 200, { version, versions });
        return;
      }
      // long-poll: park until a bump or timeout
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        sendJson(res, 200, { version, versions });
      }, LONGPOLL_TIMEOUT_MS);
      timer.unref?.();
      const waiter: Waiter = { res, timer };
      waiters.add(waiter);
      res.on('close', () => {
        clearTimeout(timer);
        waiters.delete(waiter);
      });
      return;
    }

    if (path === '/api/refresh' && method === 'POST') {
      const kind = url.searchParams.get('kind');
      if (kind && (REFRESH_KINDS as readonly string[]).includes(kind)) {
        bump(kind as RefreshKind);
        sendJson(res, 200, { ok: true, version });
      } else {
        sendJson(res, 400, { error: 'kind must be graph|verdicts|plan' });
      }
      return;
    }

    if (path === '/api/lifecycle' && method === 'POST') {
      const body = await readBody(req);
      let state: string | undefined;
      try {
        state = (JSON.parse(body || '{}') as { state?: string }).state;
      } catch {
        state = url.searchParams.get('state') ?? undefined;
      }
      try {
        const next = setLifecycle((state ?? '') as LifecycleState);
        sendJson(res, 200, { ok: true, lifecycleState: next });
      } catch {
        sendJson(res, 400, { error: 'unknown lifecycle state' });
      }
      return;
    }

    if (path === '/api/shutdown' && method === 'POST') {
      sendJson(res, 200, { ok: true, shuttingDown: true });
      // close after the response flushes
      setTimeout(() => void close(), 10);
      return;
    }

    sendJson(res, 404, { error: 'not found', path });
  }

  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    if (closing) return closing;
    closing = new Promise<void>((resolve) => {
      if (idleTimer) clearTimeout(idleTimer);
      // release parked long-pollers
      for (const w of [...waiters]) {
        clearTimeout(w.timer);
        waiters.delete(w);
        try {
          sendJson(w.res, 200, { version, versions, shuttingDown: true });
        } catch {
          /* ignore */
        }
      }
      server.close(() => {
        args.onClose?.();
        resolve();
      });
      // force-close idle keep-alive sockets so close() actually resolves
      server.closeIdleConnections?.();
    });
    return closing;
  }

  return new Promise<RunningDaemon>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      armIdle();
      resolve({ server, info, close });
    });
  });
}

function headerStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        req.destroy();
        resolve('');
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function unauthorizedPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>program-design — unauthorized</title>
<style>
  body { margin:0; background:#fafaf9; color:#1c1917; font-family: ui-sans-serif, system-ui, sans-serif; display:grid; place-items:center; min-height:100vh; }
  .card { max-width:440px; padding:32px; border:1px solid #e7e5e4; border-radius:10px; background:#ffffff; }
  h1 { font-size:18px; margin:0 0 10px; }
  code { font-family: ui-monospace, monospace; background:#f5f5f4; padding:2px 6px; border-radius:4px; color:#0f766e; }
  p { color:#44403c; line-height:1.55; }
</style></head><body>
<div class="card">
  <h1>This page needs a session token.</h1>
  <p>The local server protects your code structure with a per-session token.
  Open it the safe way:</p>
  <p><code>program-design live</code></p>
  <p>That command prints and opens the full link with the token included.</p>
</div></body></html>`;
}

/** Stop the running daemon (used by tests and index.stopDaemon in-process). */
export async function closeDaemon(d: RunningDaemon): Promise<void> {
  await d.close();
}
