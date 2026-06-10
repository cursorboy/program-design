import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import { invalidatedScope } from '../../src/core/invalidate.js';
import type { FactsGraph } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

describe('invalidatedScope', () => {
  it('package.json change → full rebuild', () => {
    const r = invalidatedScope(graph, ['package.json']);
    expect(r.fullRebuild).toBe(true);
  });

  it('prisma/schema.prisma change → full rebuild', () => {
    expect(invalidatedScope(graph, ['prisma/schema.prisma']).fullRebuild).toBe(true);
  });

  it('middleware.ts change → full rebuild', () => {
    expect(invalidatedScope(graph, ['middleware.ts']).fullRebuild).toBe(true);
  });

  it('next.config.* and tsconfig.json → full rebuild', () => {
    expect(invalidatedScope(graph, ['next.config.mjs']).fullRebuild).toBe(true);
    expect(invalidatedScope(graph, ['tsconfig.json']).fullRebuild).toBe(true);
  });

  it('a normal source file change → no full rebuild, scoped affected facts', () => {
    const r = invalidatedScope(graph, ['app/login/page.tsx']);
    expect(r.fullRebuild).toBe(false);
    expect(r.affectedFactIds).toContain('route:GET /login');
    expect(r.affectedFactIds).toContain('file:app/login/page.tsx');
  });

  it('affected facts are exactly those whose invalidatedBy intersects the change', () => {
    const r = invalidatedScope(graph, ['components/LoginForm.tsx']);
    expect(r.fullRebuild).toBe(false);
    // the literal clientCall lives in LoginForm.tsx
    const hasClientCall = r.affectedFactIds.some((id) =>
      id.startsWith('clientCall:components/LoginForm.tsx'),
    );
    expect(hasClientCall).toBe(true);
    // unrelated facts are not affected
    expect(r.affectedFactIds).not.toContain('route:GET /about');
  });

  it('an unknown changed file affects nothing', () => {
    const r = invalidatedScope(graph, ['some/random/unknown.ts']);
    expect(r.fullRebuild).toBe(false);
    expect(r.affectedFactIds).toHaveLength(0);
  });
});
