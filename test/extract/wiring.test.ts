import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import type { FactsGraph, FactNode } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

function clientCalls(g: FactsGraph): FactNode[] {
  return g.nodes.filter((n) => n.kind === 'clientCall');
}

describe('wiring extraction', () => {
  it('resolves a literal fetch to a wiredTo edge against the matching route', () => {
    const literal = clientCalls(graph).find((n) => n.attrs.tier === 'literal');
    expect(literal).toBeDefined();
    expect(literal!.attrs.url).toBe('/api/login');
    const wired = graph.edges.find(
      (e) => e.kind === 'wiredTo' && e.from === literal!.id,
    );
    expect(wired).toBeDefined();
    expect(wired!.to).toBe('route:POST /api/login');
    expect(wired!.tier).toBe('literal');
  });

  it('marks a template-literal fetch as dynamic + unresolved (UNDETERMINED territory)', () => {
    const dyn = clientCalls(graph).find((n) => n.attrs.tier === 'dynamic');
    expect(dyn).toBeDefined();
    expect(dyn!.unresolved).toBe(true);
    // A dynamic call gets ONLY an unresolved wiredTo edge to its static-prefix
    // route (so the checker → UNDETERMINED, never matched or absent). It must
    // never produce a confirming (resolved) edge.
    const wired = graph.edges.filter(
      (e) => e.kind === 'wiredTo' && e.from === dyn!.id,
    );
    expect(wired.length).toBe(1);
    expect(wired[0]!.unresolved).toBe(true);
    expect(wired[0]!.tier).toBe('dynamic');
    expect(wired[0]!.to).toBe('route:GET /api');
  });

  it('infers the POST method from the fetch options object', () => {
    const literal = clientCalls(graph).find((n) => n.attrs.tier === 'literal')!;
    expect(literal.attrs.method).toBe('POST');
  });
});

describe('unresolved imports (transient, mid-build)', () => {
  it('marks a file importing a non-existent module as unresolved', () => {
    const broken = graph.nodes.find(
      (n) => n.kind === 'file' && n.name === 'components/Broken.tsx',
    );
    expect(broken).toBeDefined();
    expect(broken!.unresolved).toBe(true);
  });

  it('keeps an unresolved import edge in the graph (never dropped)', () => {
    const edge = graph.edges.find(
      (e) => e.unresolved && e.from === 'file:components/Broken.tsx',
    );
    expect(edge).toBeDefined();
    expect(edge!.kind).toBe('imports');
  });

  it('does NOT mark a file with a valid relative import as unresolved', () => {
    const ok = graph.nodes.find(
      (n) => n.kind === 'file' && n.name === 'app/login/page.tsx',
    );
    expect(ok!.unresolved).toBeUndefined();
  });
});
