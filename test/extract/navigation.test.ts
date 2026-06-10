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

function navEdges(g: FactsGraph): FactEdge[] {
  return g.edges.filter((e) => e.kind === 'navigatesTo');
}

describe('navigation extraction', () => {
  it('extracts page-to-page <Link> nav edges', () => {
    const nav = navEdges(graph);
    expect(nav.length).toBeGreaterThan(0);
    // every nav edge from <Link>/<a> carries the nav/link rule.
    const links = nav.filter((e) => e.provenance?.ruleId === 'nav/link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('resolves an INTERNAL href to the matching page route node', () => {
    const nav = navEdges(graph);
    // Nav.tsx links to /login → resolves to route:GET /login (a real page).
    const toLogin = nav.find((e) => e.to === 'route:GET /login' && !e.unresolved);
    expect(toLogin).toBeDefined();
    expect(toLogin!.tier).toBe('literal');
    // the home page also resolves.
    expect(nav.some((e) => e.to === 'route:GET /' && !e.unresolved)).toBe(true);
  });

  it('marks an EXTERNAL href with an external marker target', () => {
    const nav = navEdges(graph);
    const ext = nav.find((e) => e.to.startsWith('component:external:'));
    expect(ext).toBeDefined();
    const node = graph.nodes.find((n) => n.id === ext!.to);
    expect(node).toBeDefined();
    expect(node!.attrs.external).toBe(true);
    expect(String(node!.attrs.url)).toMatch(/^https?:\/\//);
  });

  it('emits an UNRESOLVED edge for a link whose page we cannot place', () => {
    const nav = navEdges(graph);
    // <Link href="/blog/hello"> has no exact /blog/hello page (route is /blog/[slug])
    // → honest unresolved, never guessed.
    expect(nav.some((e) => e.unresolved)).toBe(true);
  });

  it('attributes a link inside a page file to that page route node', () => {
    const nav = navEdges(graph);
    // app/login/page.tsx has <Link href="/"> → from route:GET /login.
    const backHome = nav.find(
      (e) => e.from === 'route:GET /login' && e.to === 'route:GET /',
    );
    expect(backHome).toBeDefined();
  });

  it('never self-links a page to itself', () => {
    for (const e of navEdges(graph)) expect(e.from).not.toBe(e.to);
  });
});
