import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendLedger,
  checkClaims,
  readLedger,
  readLedgerDetailed,
  recheckLedger,
} from '../../src/core/check/index.js';
import { STATE_FILES } from '../../src/core/state.js';
import { type LedgerEntry } from '../../src/core/schema.js';
import { claim, graph, manifest, node, prov } from './helpers.js';

// We use the documented `dirOverride` last param so the ledger lands in a real
// mkdtemp dir, sidestepping homedir()/HOME flakiness across Node/macOS versions.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-ledger-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const REPO = '/tmp/repo';

function checkedEntry(verdict: ReturnType<typeof checkClaims>[number]): LedgerEntry {
  return {
    type: 'claim-checked',
    sessionId: 's1',
    timestamp: new Date().toISOString(),
    verdict,
  };
}

describe('appendLedger / readLedger', () => {
  it('round-trips entries through JSONL', () => {
    const e: LedgerEntry = { type: 'session-start', sessionId: 's1', timestamp: 't' };
    appendLedger(REPO, [e], dir);
    appendLedger(REPO, [e], dir);
    const back = readLedger(REPO, dir);
    expect(back.length).toBe(2);
    expect(back[0]!.type).toBe('session-start');
  });

  it('returns empty for a missing ledger', () => {
    expect(readLedger(REPO, dir)).toEqual([]);
  });

  it('skips and counts corrupt lines', () => {
    const good: LedgerEntry = { type: 'session-start', sessionId: 's1', timestamp: 't' };
    appendLedger(REPO, [good], dir);
    // Inject a corrupt line + a non-entry JSON.
    writeFileSync(
      join(dir, STATE_FILES.ledger),
      JSON.stringify(good) + '\n' + '{not json\n' + '{"foo":1}\n',
      'utf8',
    );
    const res = readLedgerDetailed(REPO, dir);
    expect(res.entries.length).toBe(1);
    expect(res.corruptLines).toBe(2);
  });
});

describe('recheckLedger regression', () => {
  it('appends a regression-alert when a confirmed claim now yields ABSENT', () => {
    const c = claim({ category: 'route', predicate: 'exists', subject: '/api/login', qualifiers: { method: 'GET' } });

    // Old graph: route present → CONFIRMED. Record it in the ledger.
    const oldGraph = graph({
      nodes: [node({ kind: 'route', name: 'GET /api/login', provenance: prov('app/api/login/route.ts', 1, 'routes/app-router-handler') })],
      stats: { 'routes/app-router-handler': 1 },
    });
    const [confirmed] = checkClaims(oldGraph, manifest([c]));
    expect(confirmed!.verdict).toBe('confirmed');
    appendLedger(REPO, [checkedEntry(confirmed!)], dir);

    // New graph: route gone, rule still ran → ABSENT now.
    const newGraph = graph({ stats: { 'routes/app-router-handler': 1 } });
    const alerts = recheckLedger(newGraph, REPO, 's1', dir);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.type).toBe('regression-alert');
    expect(alerts[0]!.previous!.verdict).toBe('confirmed');
    expect(alerts[0]!.current!.verdict).toBe('absent');

    // And it was appended to the ledger.
    const after = readLedger(REPO, dir);
    expect(after.some((e) => e.type === 'regression-alert')).toBe(true);
  });

  it('no alert when the confirmed claim still confirms', () => {
    const c = claim({ category: 'dep', predicate: 'installed', subject: 'zod' });
    const g = graph({
      nodes: [node({ kind: 'dependency', name: 'zod', provenance: prov('package.json', 5, 'deps/package-json') })],
      stats: { 'deps/package-json': 1 },
    });
    const [confirmed] = checkClaims(g, manifest([c]));
    appendLedger(REPO, [checkedEntry(confirmed!)], dir);
    const alerts = recheckLedger(g, REPO, 's1', dir);
    expect(alerts.length).toBe(0);
  });

  it('regression-alert also fires when a confirmed claim degrades to UNDETERMINED', () => {
    const c = claim({ category: 'route', predicate: 'exists', subject: '/api/x' });
    const oldGraph = graph({
      nodes: [node({ kind: 'route', name: 'GET /api/x', provenance: prov('app/api/x/route.ts', 1, 'routes/app-router-handler') })],
      stats: { 'routes/app-router-handler': 1 },
    });
    const [confirmed] = checkClaims(oldGraph, manifest([c]));
    appendLedger(REPO, [checkedEntry(confirmed!)], dir);

    // New graph: parse failure under app dir → UNDETERMINED.
    const newGraph = graph({
      stats: { 'routes/app-router-handler': 1 },
      parseFailures: [{ file: 'app/api/x/route.ts', reason: 'syntax error' }],
    });
    const alerts = recheckLedger(newGraph, REPO, 's1', dir);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.current!.verdict).toBe('undetermined');
  });
});
