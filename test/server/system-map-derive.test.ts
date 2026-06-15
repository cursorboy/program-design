import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { extractGraph } from '../../src/core/extract/index.js';
import { emptyGraph, type FactsGraph } from '../../src/core/schema.js';
import {
  deriveSystemMap,
  deriveUniversalMap,
  deriveConcerns,
  deriveTour,
  SERVER_NODE_ID,
  DB_NODE_ID,
} from '../../src/server/system-map-derive.js';
import type { SystemMap } from '../../src/core/system-map.js';

/** Build a minimal non-Next.js JS/TS graph: files + dependencies + one import. */
function jsProjectGraph(): FactsGraph {
  const g = emptyGraph('/tmp/some-cli');
  const file = (name: string) => ({
    id: `file:${name}`, kind: 'file' as const, name,
    provenance: { file: name, line: 1, ruleId: 'files/source-file' },
    attrs: {}, invalidatedBy: [name],
  });
  const dep = (name: string, line: number) => ({
    id: `dependency:${name}`, kind: 'dependency' as const, name,
    provenance: { file: 'package.json', line, ruleId: 'deps/package-json' },
    attrs: {}, invalidatedBy: ['package.json'],
  });
  g.nodes.push(
    file('src/lib/payments.ts'), file('src/lib/ai.ts'),
    file('src/components/Button.tsx'), file('scripts/seed.ts'),
    dep('stripe', 3), dep('openai', 4), dep('lodash', 5),
  );
  g.edges.push({
    id: 'dependsOn:file:src/lib/payments.ts->dependency:stripe',
    kind: 'dependsOn', from: 'file:src/lib/payments.ts', to: 'dependency:stripe',
    provenance: { file: 'src/lib/payments.ts', line: 1, ruleId: 'imports/depends-on' },
    invalidatedBy: ['src/lib/payments.ts'],
  });
  return g;
}

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
let map: SystemMap;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
  map = deriveSystemMap(graph, { now: '2026-01-01T00:00:00.000Z' })!;
});

describe('deriveSystemMap (deterministic fallback)', () => {
  it('returns null on an empty graph instead of a hollow map', () => {
    expect(deriveSystemMap(emptyGraph('/tmp/nowhere'))).toBeNull();
  });

  it('tags the Next.js fixture map as mapKind nextjs', () => {
    expect(map.mapKind).toBe('nextjs');
  });

  it('marks itself deterministic and carries the plain summary', () => {
    expect(map.generatedBy).toBe('deterministic');
    expect(map.what.length).toBeGreaterThan(20);
    // The summary is plain language, not jargon-first.
    expect(map.what).toMatch(/People can visit/);
  });

  it('builds frontend page nodes, one server node, a database, and table clusters', () => {
    const kinds = new Set(map.nodes.map((n) => n.kind));
    expect(kinds.has('page')).toBe(true);
    expect(map.nodes.some((n) => n.id === SERVER_NODE_ID)).toBe(true);
    expect(map.nodes.some((n) => n.id === DB_NODE_ID)).toBe(true);
    const user = map.nodes.find((n) => n.id === 'table:User');
    expect(user).toBeDefined();
    expect(user!.kind).toBe('dataTable');
    // email/password-ish columns are flagged sensitive (display flag).
    expect(user!.sensitive && user!.sensitive.length).toBeTruthy();
  });

  it('anchors every node receipt to a real file in the repo', () => {
    for (const n of map.nodes) {
      if (!n.file) continue;
      const path = n.file.split(':')[0]!;
      expect(existsSync(join(SAMPLE, path)), `${n.id} → ${path}`).toBe(true);
    }
  });

  it('connects frontend callers to the server and the server to the database', () => {
    expect(map.edges.some((e) => e.to === SERVER_NODE_ID)).toBe(true);
    const dbEdge = map.edges.find((e) => e.from === SERVER_NODE_ID && e.to === DB_NODE_ID);
    expect(dbEdge).toBeDefined();
  });

  it('derives plain-language dataFlows from the graph (How it works)', () => {
    expect(map.dataFlows.length).toBeGreaterThan(0);
    for (const f of map.dataFlows) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.plain.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic: same graph + same timestamp → identical map', () => {
    const again = deriveSystemMap(graph, { now: '2026-01-01T00:00:00.000Z' });
    expect(again).toEqual(map);
  });
});

describe('deriveConcerns (presence statements with receipts)', () => {
  it('flags untraced calls honestly, with a receipt and low severity', () => {
    const concerns = deriveConcerns(graph);
    const untraced = concerns.filter((c) => /can’t trace/.test(c.label));
    // The sample app contains a dynamic-URL fetch (Dynamic.tsx).
    expect(untraced.length).toBeGreaterThan(0);
    expect(untraced[0]!.severity).toBe('low');
  });

  it('flags parse failures as invisible scope', () => {
    const concerns = deriveConcerns(graph);
    const unread = concerns.filter((c) => /couldn’t read/.test(c.label));
    // sample-app ships lib/brokenParse.ts on purpose.
    expect(unread.length).toBe(graph.parseFailures.length);
    for (const c of unread) expect(c.file).toBeTruthy();
  });

  it('never judges behavior — every label is a presence statement', () => {
    for (const c of deriveConcerns(graph)) {
      expect(c.label).toMatch(/couldn’t find|can’t trace|couldn’t read|visible to the browser/);
    }
  });
});

describe('deriveTour (the map assembles itself)', () => {
  it('builds an ordered story whose reveals all exist in the map', () => {
    const tour = deriveTour(map);
    expect(tour.generatedBy).toBe('deterministic');
    expect(tour.beats.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(map.nodes.map((n) => n.id));
    for (const beat of tour.beats) {
      for (const id of beat.reveal) expect(ids.has(id), `reveal ${id}`).toBe(true);
      expect(beat.caption.length).toBeGreaterThan(10);
    }
  });

  it('opens with a blank canvas and ends with the whole picture', () => {
    const tour = deriveTour(map);
    expect(tour.beats[0]!.reveal).toEqual([]);
    expect(tour.beats[tour.beats.length - 1]!.caption).toMatch(/whole picture/);
  });

  it('adds a concern beat only when concerns exist', () => {
    const tour = deriveTour(map);
    const hasConcernBeat = tour.beats.some((b) => b.concern);
    expect(hasConcernBeat).toBe(map.concerns.length > 0);
  });
});

describe('deriveUniversalMap (any JS/TS project)', () => {
  const uni = deriveUniversalMap(jsProjectGraph(), { now: '2026-01-01T00:00:00.000Z' })!;

  it('deriveSystemMap falls back to a universal map when there is no Next.js structure', () => {
    const m = deriveSystemMap(jsProjectGraph(), { now: '2026-01-01T00:00:00.000Z' })!;
    expect(m.mapKind).toBe('universal');
  });

  it('returns null only when there is genuinely no code or deps', () => {
    expect(deriveUniversalMap(emptyGraph('/tmp/nowhere'))).toBeNull();
  });

  it('groups files into code areas (servers layer) and labels them in plain words', () => {
    const areas = uni.nodes.filter((n) => n.kind === 'server' && n.layer === 'servers');
    const labels = areas.map((n) => n.label);
    expect(labels).toContain('Library');
    expect(labels).toContain('Components');
    expect(labels).toContain('Scripts');
  });

  it('surfaces recognized dependencies as branded outside services, skipping unknown ones', () => {
    const ext = uni.nodes.filter((n) => n.kind === 'externalService');
    const providers = ext.map((n) => n.provider);
    expect(providers).toContain('stripe');
    expect(providers).toContain('openai');
    // lodash is not a recognized service — it must NOT become an external node
    expect(uni.nodes.some((n) => /lodash/i.test(n.label))).toBe(false);
  });

  it('anchors a service edge to the code area that actually imports it', () => {
    const stripeEdge = uni.edges.find((e) => e.to === 'ext:stripe');
    expect(stripeEdge).toBeTruthy();
    // payments.ts lives in src/lib → the "lib" area imports stripe
    expect(stripeEdge!.from).toBe('area:lib');
    expect(stripeEdge!.file).toContain('payments.ts');
  });

  it('says plainly that deep checks are Next.js-only', () => {
    expect(uni.what).toMatch(/Next\.js \+ Prisma/);
  });

  it('builds a universal tour whose reveals all exist in the map', () => {
    const tour = deriveTour(uni);
    expect(tour.title).toMatch(/project/i);
    const ids = new Set(uni.nodes.map((n) => n.id));
    for (const beat of tour.beats) {
      for (const id of beat.reveal) expect(ids.has(id), `reveal ${id}`).toBe(true);
    }
  });

  it('is deterministic for the same graph + timestamp', () => {
    const again = deriveUniversalMap(jsProjectGraph(), { now: '2026-01-01T00:00:00.000Z' });
    expect(again).toEqual(uni);
  });
});
