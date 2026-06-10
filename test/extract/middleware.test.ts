import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import type { FactsGraph, FactEdge } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

function attachedTo(g: FactsGraph): FactEdge[] {
  return g.edges.filter((e) => e.kind === 'attachedTo');
}

describe('middleware extraction', () => {
  it('emits exactly one middleware node from middleware.ts', () => {
    const mw = graph.nodes.filter((n) => n.kind === 'middleware');
    expect(mw).toHaveLength(1);
    expect(mw[0]!.name).toBe('middleware.ts');
    expect(mw[0]!.attrs.matcherDynamic).toBe(false);
  });

  it('detects the local withAuth guard wrapper', () => {
    const mw = graph.nodes.find((n) => n.kind === 'middleware')!;
    expect(String(mw.attrs.guards)).toContain('withAuth');
  });

  it('attaches to /api/login and /api/signup via the literal matcher', () => {
    const targets = attachedTo(graph).map((e) => e.to);
    expect(targets).toContain('route:POST /api/login');
    expect(targets).toContain('route:POST /api/signup');
  });

  it('does NOT attach to routes outside the matcher (/, /login, /about)', () => {
    const targets = attachedTo(graph).map((e) => e.to);
    expect(targets).not.toContain('route:GET /');
    expect(targets).not.toContain('route:GET /login');
    expect(targets).not.toContain('route:GET /about');
  });

  it('matched edges use the guard-wrapper tier (a recognized guard is present)', () => {
    for (const e of attachedTo(graph)) {
      expect(e.tier).toBe('guard-wrapper');
    }
  });

  it('attachment edges carry provenance + invalidatedBy on the middleware file', () => {
    for (const e of attachedTo(graph)) {
      expect(e.provenance).not.toBeNull();
      expect(e.provenance!.file).toBe('middleware.ts');
      expect(e.invalidatedBy).toContain('middleware.ts');
    }
  });
});
