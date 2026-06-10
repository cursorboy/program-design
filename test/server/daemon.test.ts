import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

import {
  startDaemon,
  stopDaemon,
  daemonStatus,
} from '../../src/server/index.js';
import { statePath, ensureStateDir, stateDir } from '../../src/core/state.js';
import { emptyGraph, makeNodeId, type FactsGraph } from '../../src/core/schema.js';

// A 1x1 transparent PNG (the smallest valid PNG) for /api/shot tests.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function shotsDir(repoRoot: string): string {
  const d = join(stateDir(repoRoot), 'shots');
  mkdirSync(d, { recursive: true });
  return d;
}

// Binary-aware GET: returns status, content-type, and the raw body Buffer.
function httpGetRaw(
  port: number,
  path: string,
): Promise<{ status: number; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// Unique high ports per test to avoid collisions across the suite.
let portCounter = 4801;
function nextPort(): number {
  return portCounter++;
}

const repos: string[] = [];
function tempRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'pd-daemon-'));
  repos.push(r);
  return r;
}

afterEach(async () => {
  for (const r of repos.splice(0)) {
    try {
      await stopDaemon(r);
    } catch {
      /* ignore */
    }
    rmSync(r, { recursive: true, force: true });
    rmSync(statePath(r, 'port'), { force: true });
    rmSync(statePath(r, 'token'), { force: true });
  }
});

function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('daemon lifecycle', () => {
  it('start → status → stop on a temp repo', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port, version: '1.2.3' });
    expect(info.port).toBe(port);
    expect(info.pid).toBe(process.pid);
    expect(info.token).toMatch(/^[0-9a-f]{32}$/);
    expect(existsSync(statePath(repo, 'port'))).toBe(true);

    const status = daemonStatus(repo);
    expect(status).not.toBeNull();
    expect(status?.port).toBe(port);

    // health endpoint works with the token
    const health = await httpGet(port, `/api/health?t=${info.token}`);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body).ok).toBe(true);
    expect(JSON.parse(health.body).lifecycleState).toBe('idle');

    const stopped = await stopDaemon(repo);
    expect(stopped).toBe(true);
    expect(daemonStatus(repo)).toBeNull();
    expect(existsSync(statePath(repo, 'port'))).toBe(false);
  });

  it('keeps a STABLE token across a clean stop→start (token.json is durable)', async () => {
    // This proves the recurring "Lost connection" fix: a clean stopDaemon
    // deletes port.json but LEAVES token.json, so the very next startDaemon
    // reuses the SAME token — no manual port.json restore needed. An open
    // browser tab holding the old token keeps authenticating across the restart.
    const repo = tempRepo();
    const port = nextPort();

    const first = await startDaemon(repo, { port });
    const firstToken = first.token;
    expect(firstToken).toMatch(/^[0-9a-f]{32}$/);
    // token.json is the durable source and holds the same token
    expect(existsSync(statePath(repo, 'token'))).toBe(true);
    expect(JSON.parse(readFileSync(statePath(repo, 'token'), 'utf8')).token).toBe(
      firstToken,
    );

    const stopped = await stopDaemon(repo);
    expect(stopped).toBe(true);
    // clean stop: port.json gone, but token.json survives
    expect(existsSync(statePath(repo, 'port'))).toBe(false);
    expect(existsSync(statePath(repo, 'token'))).toBe(true);

    // restart WITHOUT touching any state — token must be identical (reused)
    const second = await startDaemon(repo, { port });
    expect(second.token).toBe(firstToken);

    // and the reused token actually authenticates against the new daemon
    const health = await httpGet(port, `/api/health?t=${firstToken}`);
    expect(health.status).toBe(200);

    await stopDaemon(repo);
  });

  it('also reuses a token carried only in a leftover port.json (back-compat)', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const first = await startDaemon(repo, { port });
    const firstToken = first.token;
    await stopDaemon(repo);

    // Simulate a pre-token.json world: remove token.json, leave a stale port.json
    // with a dead pid carrying the token. The daemon must still reuse it.
    rmSync(statePath(repo, 'token'), { force: true });
    ensureStateDir(repo);
    writeFileSync(
      statePath(repo, 'port'),
      JSON.stringify({ ...first, pid: 999999 }),
      'utf8',
    );
    const second = await startDaemon(repo, { port });
    expect(second.token).toBe(firstToken);

    const health = await httpGet(port, `/api/health?t=${firstToken}`);
    expect(health.status).toBe(200);

    await stopDaemon(repo);
  });

  it('is idempotent: a second start returns the same info', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const a = await startDaemon(repo, { port });
    const b = await startDaemon(repo, { port });
    expect(b.token).toBe(a.token);
    expect(b.port).toBe(a.port);
    await stopDaemon(repo);
  });

  it('daemonStatus returns null for a stale port.json with a dead pid', () => {
    const repo = tempRepo();
    const fake = {
      port: 4999,
      pid: 999999, // not a live pid
      token: 'deadbeefdeadbeefdeadbeefdeadbeef',
      repoRoot: repo,
      version: '0.0.0',
      startedAt: new Date().toISOString(),
    };
    ensureStateDir(repo);
    writeFileSync(statePath(repo, 'port'), JSON.stringify(fake), 'utf8');
    expect(daemonStatus(repo)).toBeNull();
    // stale file cleaned
    expect(existsSync(statePath(repo, 'port'))).toBe(false);
  });

  it('daemonStatus returns null when repoRoot ownership mismatches', () => {
    const repo = tempRepo();
    const other = tempRepo();
    const fake = {
      port: 4998,
      pid: process.pid, // live pid, but wrong repo
      token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      repoRoot: other,
      version: '0.0.0',
      startedAt: new Date().toISOString(),
    };
    ensureStateDir(repo);
    writeFileSync(statePath(repo, 'port'), JSON.stringify(fake), 'utf8');
    expect(daemonStatus(repo)).toBeNull();
  });
});

describe('daemon HTTP security', () => {
  it('serves a 401 page on GET / without a token, 200 with', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });

    const noToken = await httpGet(port, '/');
    expect(noToken.status).toBe(401);
    expect(noToken.body).toContain('program-design live');

    const withToken = await httpGet(port, `/?t=${info.token}`);
    expect(withToken.status).toBe(200);
    expect(withToken.body).toContain('verifies presence, not correctness');

    // forgiving alias: a hand-typed ?token= must not land on the 401 page
    const withAlias = await httpGet(port, `/?token=${info.token}`);
    expect(withAlias.status).toBe(200);

    await stopDaemon(repo);
  });

  it('401s API requests without a token, 200 with', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });

    const no = await httpGet(port, '/api/health');
    expect(no.status).toBe(401);

    const yes = await httpGet(port, `/api/health?t=${info.token}`);
    expect(yes.status).toBe(200);

    // header-based token also works
    const viaHeader = await httpGet(port, '/api/health', { 'X-PD-Token': info.token });
    expect(viaHeader.status).toBe(200);

    await stopDaemon(repo);
  });

  it('403s on a non-loopback Host header (anti-rebinding)', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });

    const evil = await httpGet(port, `/api/health?t=${info.token}`, {
      Host: 'evil.com',
    });
    expect(evil.status).toBe(403);

    await stopDaemon(repo);
  });

  it('serves graph/verdicts/plan with empty shapes (404) when files missing', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });

    const graph = await httpGet(port, `/api/graph?t=${info.token}`);
    expect(graph.status).toBe(404);
    expect(JSON.parse(graph.body).nodes).toEqual([]);

    const verdicts = await httpGet(port, `/api/verdicts?t=${info.token}`);
    expect(verdicts.status).toBe(404);
    expect(JSON.parse(verdicts.body)).toEqual([]);

    const plan = await httpGet(port, `/api/plan?t=${info.token}`);
    expect(plan.status).toBe(404);
    expect(JSON.parse(plan.body).nodes).toEqual([]);

    // system-map is absent → 404 + empty {} so the client can fall back.
    const sm = await httpGet(port, `/api/system-map?t=${info.token}`);
    expect(sm.status).toBe(404);
    expect(JSON.parse(sm.body)).toEqual({});

    await stopDaemon(repo);
  });

  it('serves the system map JSON when system-map.json exists', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const map = {
      schemaVersion: 1,
      generatedBy: 'llm',
      generatedAt: '2026-06-08T11:00:00Z',
      repoRoot: repo,
      what: 'A tiny example system.',
      nodes: [
        { id: 'p', kind: 'page', layer: 'frontend', label: 'Home', technical: '/', provider: 'vercel', file: 'app/page.tsx:1' },
        { id: 's', kind: 'server', layer: 'servers', label: 'API', technical: 'express', provider: 'railway', file: 'server.ts:1' },
        { id: 'db', kind: 'database', layer: 'data', label: 'Main database', technical: 'Postgres', provider: 'neon', file: 'db.ts:1' },
      ],
      edges: [{ from: 's', to: 'db', flows: 'read/write rows', file: 'db.ts:2' }],
      dataFlows: [{ title: 'Load home', plain: 'The page asks the API for data.' }],
      concerns: [{ label: 'A thing', detail: 'It is off.', file: 'server.ts:9', severity: 'high' }],
    };
    const info = await startDaemon(repo, { port });
    writeFileSync(statePath(repo, 'systemMap'), JSON.stringify(map), 'utf8');

    const sm = await httpGet(port, `/api/system-map?t=${info.token}`);
    expect(sm.status).toBe(200);
    const parsed = JSON.parse(sm.body);
    expect(parsed.nodes.length).toBe(3);
    expect(parsed.what).toContain('tiny example');
    expect(parsed.concerns[0].severity).toBe('high');

    await stopDaemon(repo);
  });

  it('requires a token for /api/system-map', async () => {
    const repo = tempRepo();
    const port = nextPort();
    await startDaemon(repo, { port });
    const noToken = await httpGet(port, `/api/system-map`);
    expect(noToken.status).toBe(401);
    await stopDaemon(repo);
  });

  it('serves the tour JSON when tour.json exists, empty {} when missing', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const tour = {
      schemaVersion: 1,
      title: 'How it works',
      beats: [
        { caption: 'This is your app.', reveal: ['p'] },
        { caption: 'It saves things.', reveal: ['db'], highlight: ['db'], concern: true },
      ],
    };
    const info = await startDaemon(repo, { port });

    // missing → 404 + {}
    const missing = await httpGet(port, `/api/tour?t=${info.token}`);
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body)).toEqual({});

    writeFileSync(statePath(repo, 'tour'), JSON.stringify(tour), 'utf8');
    const got = await httpGet(port, `/api/tour?t=${info.token}`);
    expect(got.status).toBe(200);
    const parsed = JSON.parse(got.body);
    expect(parsed.beats.length).toBe(2);
    expect(parsed.beats[1].concern).toBe(true);

    await stopDaemon(repo);
  });

  it('requires a token for /api/tour', async () => {
    const repo = tempRepo();
    const port = nextPort();
    await startDaemon(repo, { port });
    const noToken = await httpGet(port, `/api/tour`);
    expect(noToken.status).toBe(401);
    await stopDaemon(repo);
  });

  it('serves a screenshot at /api/shot?name= with image/png, 404 when absent', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });
    const dir = shotsDir(repo);
    writeFileSync(join(dir, 'home.png'), TINY_PNG);

    const ok = await httpGetRaw(port, `/api/shot?name=home&t=${info.token}`);
    expect(ok.status).toBe(200);
    expect(ok.contentType).toBe('image/png');
    expect(ok.body.length).toBe(TINY_PNG.length);
    // it is a real PNG (magic bytes)
    expect(ok.body.slice(0, 4).toString('hex')).toBe('89504e47');

    const absent = await httpGetRaw(port, `/api/shot?name=nope&t=${info.token}`);
    expect(absent.status).toBe(404);

    await stopDaemon(repo);
  });

  it('jails /api/shot: rejects traversal, slashes, and dots in the name', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });
    shotsDir(repo);
    // Plant a secret OUTSIDE the shots dir to prove it can never be reached.
    writeFileSync(join(stateDir(repo), 'token.json'), 'SECRET', 'utf8');

    // raw "../" — the name contains a slash + dots, fails the [a-z0-9_-] charset.
    const traversal = await httpGet(
      port,
      `/api/shot?name=${encodeURIComponent('../token')}&t=${info.token}`,
    );
    expect(traversal.status).toBe(400);

    // an absolute-ish path with slashes is also rejected.
    const slashed = await httpGet(
      port,
      `/api/shot?name=${encodeURIComponent('a/b')}&t=${info.token}`,
    );
    expect(slashed.status).toBe(400);

    // a dotted name (e.g. "home.png") is rejected — the handler appends .png itself.
    const dotted = await httpGet(
      port,
      `/api/shot?name=${encodeURIComponent('home.png')}&t=${info.token}`,
    );
    expect(dotted.status).toBe(400);

    // and it requires a token like every other endpoint.
    const noToken = await httpGet(port, `/api/shot?name=home`);
    expect(noToken.status).toBe(401);

    await stopDaemon(repo);
  });

  it('serves a populated graph and matching mermaid when graph.json exists', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const g: FactsGraph = emptyGraph(repo);
    g.nodes = [
      {
        id: makeNodeId('route', 'GET /api/x'),
        kind: 'route',
        name: 'GET /api/x',
        provenance: { file: 'app/api/x/route.ts', line: 1, ruleId: 't' },
        attrs: {},
        invalidatedBy: [],
      },
    ];
    // state dir exists after start, but write graph before to avoid race
    const info = await startDaemon(repo, { port });
    writeFileSync(statePath(repo, 'graph'), JSON.stringify(g), 'utf8');

    const graph = await httpGet(port, `/api/graph?t=${info.token}`);
    expect(graph.status).toBe(200);
    expect(JSON.parse(graph.body).nodes.length).toBe(1);

    const mermaid = await httpGet(port, `/api/mermaid?t=${info.token}`);
    expect(mermaid.status).toBe(200);
    expect(mermaid.body).toContain('flowchart LR');
    expect(mermaid.body).toContain('"GET /api/x"');

    await stopDaemon(repo);
  });

  it('snippet endpoint serves a file inside the repo and rejects traversal', async () => {
    const repo = tempRepo();
    const port = nextPort();
    writeFileSync(join(repo, 'hello.ts'), 'one\ntwo\nthree\n', 'utf8');
    const info = await startDaemon(repo, { port });

    const ok = await httpGet(port, `/api/snippet?file=hello.ts&line=2&t=${info.token}`);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).lines).toContain('two');

    const bad = await httpGet(
      port,
      `/api/snippet?file=${encodeURIComponent('../../etc/passwd')}&line=1&t=${info.token}`,
    );
    expect(bad.status).toBe(403);

    await stopDaemon(repo);
  });

  it('refresh bumps the version observed by events', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });

    // A fresh daemon is at version 0, so events?since=0 would long-poll. We
    // drive a refresh first, then read events?since=0 (returns immediately
    // because version is now > 0).

    // POST refresh
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: `/api/refresh?kind=graph&t=${info.token}`,
          method: 'POST',
          headers: { 'X-PD-Token': info.token, 'content-length': '0' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.end();
    });

    const after = await httpGet(port, `/api/events?since=0&t=${info.token}`);
    expect(after.status).toBe(200);
    expect(JSON.parse(after.body).version).toBeGreaterThan(0);

    await stopDaemon(repo);
  });

  it('sets lifecycle state via POST and reflects it in health', async () => {
    const repo = tempRepo();
    const port = nextPort();
    const info = await startDaemon(repo, { port });

    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ state: 'build-active' });
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: `/api/lifecycle?t=${info.token}`,
          method: 'POST',
          headers: {
            'X-PD-Token': info.token,
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(payload)),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.end(payload);
    });

    const health = await httpGet(port, `/api/health?t=${info.token}`);
    expect(JSON.parse(health.body).lifecycleState).toBe('build-active');

    await stopDaemon(repo);
  });
});
