import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import type { FactsGraph, FactNode, FactEdge } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

function forms(g: FactsGraph): FactNode[] {
  return g.nodes.filter((n) => n.kind === 'form');
}
function submits(g: FactsGraph): FactEdge[] {
  return g.edges.filter((e) => e.kind === 'submitsTo');
}

describe('forms extraction', () => {
  it('creates a form node for a <form> element', () => {
    const fs = forms(graph);
    expect(fs.length).toBeGreaterThan(0);
    const login = fs.find((n) => n.name.startsWith('components/LoginForm.tsx'));
    expect(login).toBeDefined();
    expect(login!.provenance?.ruleId).toBe('forms/jsx-form');
  });

  it('TRACES a form onSubmit fetch to its matching route (submitsTo)', () => {
    const login = forms(graph).find((n) => n.name.startsWith('components/LoginForm.tsx'))!;
    const sub = submits(graph).find((e) => e.from === login.id);
    expect(sub).toBeDefined();
    expect(sub!.to).toBe('route:POST /api/login');
    expect(sub!.unresolved).toBeFalsy();
    expect(sub!.tier).toBe('literal');
  });

  it('attaches the form to the page that renders it (owner)', () => {
    const login = forms(graph).find((n) => n.name.startsWith('components/LoginForm.tsx'))!;
    // app/login/page.tsx imports + renders <LoginForm/> → owner is the login page.
    expect(login.attrs.owner).toBe('route:GET /login');
  });

  it('marks an UNTRACEABLE form submit as unresolved (honest ghost)', () => {
    const search = forms(graph).find((n) => n.name.startsWith('components/SearchForm.tsx'));
    expect(search).toBeDefined();
    expect(search!.unresolved).toBe(true);
    const sub = submits(graph).find((e) => e.from === search!.id);
    expect(sub).toBeDefined();
    expect(sub!.unresolved).toBe(true);
    expect(sub!.tier).toBe('dynamic');
  });

  it('records nav + form stats on the graph', () => {
    expect(graph.stats.navigatesTo).toBeGreaterThan(0);
    expect(graph.stats.submitsTo).toBeGreaterThan(0);
    expect(graph.stats.forms).toBeGreaterThan(0);
  });
});
