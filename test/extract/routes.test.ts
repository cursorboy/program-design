import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import { dirToRoutePath } from '../../src/core/extract/routes.js';
import { matchesMatcher } from '../../src/core/extract/middleware.js';
import type { FactsGraph } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

function routeNames(g: FactsGraph): string[] {
  return g.nodes
    .filter((n) => n.kind === 'route')
    .map((n) => n.name)
    .sort();
}

describe('routes/app-router', () => {
  it('extracts the exact set of routes (golden)', () => {
    expect(routeNames(graph)).toEqual([
      'GET /',
      'GET /about',
      'GET /blog/[slug]',
      'GET /login',
      'POST /api/login',
      'POST /api/signup',
    ]);
  });

  it('drops route-group segments from the URL', () => {
    const about = graph.nodes.find((n) => n.name === 'GET /about');
    expect(about).toBeDefined();
    // came from app/(marketing)/about/page.tsx
    expect(about!.provenance!.file).toBe('app/(marketing)/about/page.tsx');
  });

  it('keeps dynamic segment bracket syntax in the path', () => {
    expect(routeNames(graph)).toContain('GET /blog/[slug]');
  });

  it('only emits the HTTP verbs that are actually exported (no GET for login API)', () => {
    expect(routeNames(graph)).toContain('POST /api/login');
    expect(routeNames(graph)).not.toContain('GET /api/login');
  });

  it('does NOT treat layout.tsx as a route', () => {
    const names = routeNames(graph);
    // there is no route for the layout file
    expect(names.every((n) => !n.includes('layout'))).toBe(true);
  });

  it('records the correct ruleIds', () => {
    const page = graph.nodes.find((n) => n.name === 'GET /login');
    expect(page!.provenance!.ruleId).toBe('routes/app-router-page');
    const handler = graph.nodes.find((n) => n.name === 'POST /api/login');
    expect(handler!.provenance!.ruleId).toBe('routes/app-router-handler');
  });

  it('every route node carries provenance with a repo-relative POSIX file + 1-based line', () => {
    for (const n of graph.nodes.filter((r) => r.kind === 'route')) {
      expect(n.provenance).not.toBeNull();
      expect(n.provenance!.file).not.toMatch(/^\//);
      expect(n.provenance!.file).not.toContain('\\');
      expect(n.provenance!.line).toBeGreaterThanOrEqual(1);
      expect(n.invalidatedBy.length).toBeGreaterThan(0);
    }
  });
});

describe('dirToRoutePath', () => {
  it('maps app root to /', () => {
    expect(dirToRoutePath('')).toBe('/');
    expect(dirToRoutePath('.')).toBe('/');
  });
  it('drops (group) segments', () => {
    expect(dirToRoutePath('(marketing)/about')).toBe('/about');
    expect(dirToRoutePath('(a)/(b)')).toBe('/');
  });
  it('keeps dynamic + catchall brackets', () => {
    expect(dirToRoutePath('blog/[slug]')).toBe('/blog/[slug]');
    expect(dirToRoutePath('docs/[...slug]')).toBe('/docs/[...slug]');
  });
});

describe('matchesMatcher (Next.js literal matcher semantics)', () => {
  it(':path* matches the prefix and anything below it', () => {
    expect(matchesMatcher('/api/:path*', '/api/login')).toBe(true);
    expect(matchesMatcher('/api/:path*', '/api/signup')).toBe(true);
    expect(matchesMatcher('/api/:path*', '/api')).toBe(true);
  });
  it(':path* does NOT match unrelated paths', () => {
    expect(matchesMatcher('/api/:path*', '/')).toBe(false);
    expect(matchesMatcher('/api/:path*', '/login')).toBe(false);
  });
  it('exact literal matches only itself', () => {
    expect(matchesMatcher('/about', '/about')).toBe(true);
    expect(matchesMatcher('/about', '/about/team')).toBe(false);
  });
  it('named single-segment param', () => {
    expect(matchesMatcher('/blog/:slug', '/blog/x')).toBe(true);
    expect(matchesMatcher('/blog/:slug', '/blog/x/y')).toBe(false);
  });
});
