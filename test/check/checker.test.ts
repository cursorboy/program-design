import { describe, expect, it } from 'vitest';
import { checkClaims } from '../../src/core/check/index.js';
import { claim, edge, graph, manifest, node, prov } from './helpers.js';

const ROUTE_RULES = { 'routes/app-router-handler': 1 };

describe('route/exists', () => {
  it('CONFIRMED when route node exists, with provenance receipts', () => {
    const g = graph({
      nodes: [
        node({
          kind: 'route',
          name: 'GET /api/login',
          provenance: prov('app/api/login/route.ts', 3, 'routes/app-router-handler'),
        }),
      ],
      stats: ROUTE_RULES,
    });
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'route', predicate: 'exists', subject: '/api/login', qualifiers: { method: 'GET' } })]),
    );
    expect(v!.verdict).toBe('confirmed');
    expect(v!.receipts[0]!.file).toBe('app/api/login/route.ts');
    expect(v!.factIds).toContain('route:GET /api/login');
  });

  it('defaults method to GET when no qualifier', () => {
    const g = graph({
      nodes: [
        node({ kind: 'route', name: 'GET /', provenance: prov('app/page.tsx', 1, 'routes/app-router-page') }),
      ],
      stats: { 'routes/app-router-page': 1 },
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'route', predicate: 'exists', subject: '/' })]));
    expect(v!.verdict).toBe('confirmed');
  });

  it('ABSENT when no node, rule ran, no parse failures — carries searchScope', () => {
    const g = graph({ stats: ROUTE_RULES });
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'route', predicate: 'exists', subject: '/api/missing' })]),
    );
    expect(v!.verdict).toBe('absent');
    expect(v!.searchScope).toBeDefined();
    expect(v!.searchScope!.length).toBeGreaterThan(0);
  });

  it('UNDETERMINED (not ABSENT) when the route rule never ran', () => {
    const g = graph({}); // no stats, no nodes
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'route', predicate: 'exists', subject: '/api/x' })]),
    );
    expect(v!.verdict).toBe('undetermined');
  });

  it('UNDETERMINED when a parse failure exists under the app directory', () => {
    const g = graph({
      stats: ROUTE_RULES,
      parseFailures: [{ file: 'app/api/x/route.ts', reason: 'SyntaxError: unexpected }' }],
    });
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'route', predicate: 'exists', subject: '/api/x' })]),
    );
    expect(v!.verdict).toBe('undetermined');
    expect(v!.explainer!.reason.startsWith("I can't safely confirm")).toBe(true);
    expect(v!.explainer!.pattern).toContain('app/api/x/route.ts');
  });
});

describe('transient unresolved during active build', () => {
  it('route/exists → UNDETERMINED never ABSENT (buildActive + unresolved route fact)', () => {
    const g = graph({
      buildActive: true,
      stats: ROUTE_RULES,
      nodes: [
        node({
          kind: 'route',
          name: 'GET /api/pending',
          unresolved: true,
          provenance: prov('app/api/pending/route.ts', 1, 'routes/app-router-handler'),
        }),
      ],
    });
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'route', predicate: 'exists', subject: '/api/other' })]),
    );
    expect(v!.verdict).toBe('undetermined');
    expect(v!.verdict).not.toBe('absent');
    expect(v!.explainer!.pattern).toContain('unresolved');
  });

  it('direct unresolved node for the claimed route → UNDETERMINED', () => {
    const g = graph({
      buildActive: true,
      stats: ROUTE_RULES,
      nodes: [
        node({ kind: 'route', name: 'GET /api/x', unresolved: true, provenance: prov('app/api/x/route.ts', 1, 'routes/app-router-handler') }),
      ],
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'route', predicate: 'exists', subject: '/api/x' })]));
    expect(v!.verdict).toBe('undetermined');
  });
});

describe('allowlist', () => {
  it('off-allowlist (category/predicate combo) → UNDETERMINED with allowlist explainer', () => {
    const g = graph({ stats: ROUTE_RULES });
    // route/installed is not a real allowlist combo.
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'route', predicate: 'installed', subject: '/api/x' })]),
    );
    expect(v!.verdict).toBe('undetermined');
    expect(v!.explainer!.pattern).toBe('pattern not on the recognized-pattern allowlist');
  });
});

describe('middleware/attached — all four tiers', () => {
  function withMiddleware(tier: string | undefined, extra: { matcherDynamic?: boolean; matcher?: string } = {}) {
    const mwAttrs: Record<string, string | boolean> = {};
    if (extra.matcherDynamic !== undefined) mwAttrs.matcherDynamic = extra.matcherDynamic;
    if (extra.matcher !== undefined) mwAttrs.matcher = extra.matcher;
    return graph({
      nodes: [
        node({ kind: 'middleware', name: 'middleware', provenance: prov('middleware.ts', 1, 'middleware/matcher'), attrs: mwAttrs }),
        node({ kind: 'route', name: 'GET /dashboard', provenance: prov('app/dashboard/page.tsx', 1, 'routes/app-router-page') }),
      ],
      edges:
        tier === undefined
          ? []
          : [
              edge({
                kind: 'attachedTo',
                from: 'middleware:middleware',
                to: 'route:GET /dashboard',
                tier: tier as never,
                provenance: prov('middleware.ts', 5, 'middleware/matcher'),
              }),
            ],
      stats: { 'middleware/matcher': 1, 'routes/app-router-page': 1 },
    });
  }

  const mwClaim = () => claim({ category: 'middleware', predicate: 'attached', subject: '/dashboard' });

  it('matcher-includes → CONFIRMED with edge provenance receipt', () => {
    const [v] = checkClaims(withMiddleware('matcher-includes'), manifest([mwClaim()]));
    expect(v!.verdict).toBe('confirmed');
    expect(v!.receipts[0]!.file).toBe('middleware.ts');
  });

  it('guard-wrapper → CONFIRMED', () => {
    const [v] = checkClaims(withMiddleware('guard-wrapper'), manifest([mwClaim()]));
    expect(v!.verdict).toBe('confirmed');
  });

  it('global-exists → UNDETERMINED (attachment not confirmed), includes matcher pattern', () => {
    const g = withMiddleware('global-exists', { matcher: '/admin/:path*' });
    const [v] = checkClaims(g, manifest([mwClaim()]));
    expect(v!.verdict).toBe('undetermined');
    expect(v!.explainer!.reason).toContain('middleware exists but attachment to this route could not be confirmed');
    expect(v!.explainer!.pattern).toContain('/admin/:path*');
  });

  it('matcherDynamic === true → UNDETERMINED', () => {
    const g = withMiddleware('global-exists', { matcherDynamic: true });
    const [v] = checkClaims(g, manifest([mwClaim()]));
    expect(v!.verdict).toBe('undetermined');
  });

  it('no middleware node at all → ABSENT with searchScope', () => {
    const g = graph({
      nodes: [node({ kind: 'route', name: 'GET /dashboard', provenance: prov('app/dashboard/page.tsx', 1, 'routes/app-router-page') })],
      stats: { 'routes/app-router-page': 1 },
    });
    const [v] = checkClaims(g, manifest([mwClaim()]));
    expect(v!.verdict).toBe('absent');
    expect(v!.searchScope).toEqual(['middleware.ts', 'src/middleware.ts']);
  });
});

describe('schema/exists + has-column', () => {
  it('table exists → CONFIRMED', () => {
    const g = graph({
      nodes: [node({ kind: 'dbTable', name: 'User', provenance: prov('prisma/schema.prisma', 10, 'schema/prisma-model') })],
      stats: { 'schema/prisma-model': 1 },
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'schema', predicate: 'exists', subject: 'User' })]));
    expect(v!.verdict).toBe('confirmed');
  });

  it('column via hasColumn edge → CONFIRMED with receipts deduped by file:line', () => {
    const g = graph({
      nodes: [
        node({ kind: 'dbTable', name: 'User', provenance: prov('prisma/schema.prisma', 10, 'schema/prisma-model') }),
        node({ kind: 'dbColumn', name: 'User.email', provenance: prov('prisma/schema.prisma', 12, 'schema/prisma-field') }),
      ],
      edges: [
        edge({ kind: 'hasColumn', from: 'dbTable:User', to: 'dbColumn:User.email', provenance: prov('prisma/schema.prisma', 12, 'schema/prisma-field') }),
      ],
      stats: { 'schema/prisma-model': 1, 'schema/prisma-field': 1 },
    });
    const [v] = checkClaims(
      g,
      manifest([claim({ category: 'schema', predicate: 'has-column', subject: 'User', qualifiers: { column: 'email' } })]),
    );
    expect(v!.verdict).toBe('confirmed');
    // column node and hasColumn edge share the field's file:line — the user
    // sees each line once (dedupe added after the 2026-06-07 smoke test).
    expect(v!.receipts.length).toBe(1);
    expect(v!.receipts[0]).toMatchObject({ file: 'prisma/schema.prisma', line: 12 });
  });

  it('table ABSENT only when schema parsed (table nodes present) → searchScope', () => {
    const g = graph({
      nodes: [node({ kind: 'dbTable', name: 'Post', provenance: prov('prisma/schema.prisma', 1, 'schema/prisma-model') })],
      stats: { 'schema/prisma-model': 1 },
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'schema', predicate: 'exists', subject: 'Missing' })]));
    expect(v!.verdict).toBe('absent');
    expect(v!.searchScope).toBeDefined();
  });

  it('schema parse failure → UNDETERMINED', () => {
    const g = graph({
      parseFailures: [{ file: 'prisma/schema.prisma', reason: 'datasource block malformed' }],
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'schema', predicate: 'exists', subject: 'User' })]));
    expect(v!.verdict).toBe('undetermined');
    expect(v!.explainer!.pattern).toContain('schema.prisma');
  });

  it('no schema evidence at all → UNDETERMINED not ABSENT', () => {
    const g = graph({});
    const [v] = checkClaims(g, manifest([claim({ category: 'schema', predicate: 'exists', subject: 'User' })]));
    expect(v!.verdict).toBe('undetermined');
  });
});

describe('env/reads + dep/installed', () => {
  it('env CONFIRMED with node + reads-edge receipts', () => {
    const g = graph({
      nodes: [
        node({ kind: 'envVar', name: 'DATABASE_URL', provenance: prov('lib/db.ts', 2, 'env/process-env-read') }),
        node({ kind: 'file', name: 'lib/db.ts' }),
      ],
      edges: [edge({ kind: 'reads', from: 'file:lib/db.ts', to: 'envVar:DATABASE_URL', provenance: prov('lib/db.ts', 2, 'env/process-env-read') })],
      stats: { 'env/process-env-read': 1 },
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'env', predicate: 'reads', subject: 'DATABASE_URL' })]));
    expect(v!.verdict).toBe('confirmed');
    expect(v!.receipts.length).toBeGreaterThanOrEqual(1);
  });

  it('env ABSENT when rule ran but var not found', () => {
    const g = graph({ stats: { 'env/process-env-read': 1 } });
    const [v] = checkClaims(g, manifest([claim({ category: 'env', predicate: 'reads', subject: 'NOPE' })]));
    expect(v!.verdict).toBe('absent');
    expect(v!.searchScope).toBeDefined();
  });

  it('dep CONFIRMED', () => {
    const g = graph({
      nodes: [node({ kind: 'dependency', name: 'zod', provenance: prov('package.json', 20, 'deps/package-json') })],
      stats: { 'deps/package-json': 1 },
    });
    const [v] = checkClaims(g, manifest([claim({ category: 'dep', predicate: 'installed', subject: 'zod' })]));
    expect(v!.verdict).toBe('confirmed');
  });

  it('dep ABSENT when package.json parsed and dep absent', () => {
    const g = graph({ stats: { 'deps/package-json': 1 } });
    const [v] = checkClaims(g, manifest([claim({ category: 'dep', predicate: 'installed', subject: 'left-pad' })]));
    expect(v!.verdict).toBe('absent');
  });
});

describe('wiring/wired confidence tiers', () => {
  function withWire(tier: string | undefined) {
    return graph({
      nodes: [
        node({ kind: 'route', name: 'GET /api/data', provenance: prov('app/api/data/route.ts', 1, 'routes/app-router-handler') }),
        node({ kind: 'clientCall', name: 'fetch /api/data', provenance: prov('app/page.tsx', 5, 'wiring/literal-url') }),
      ],
      edges:
        tier === undefined
          ? []
          : [edge({ kind: 'wiredTo', from: 'clientCall:fetch /api/data', to: 'route:GET /api/data', tier: tier as never, provenance: prov('app/page.tsx', 5, 'wiring/literal-url') })],
      stats: { 'wiring/literal-url': 1 },
    });
  }
  const wireClaim = () => claim({ category: 'wiring', predicate: 'wired', subject: '/api/data' });

  it('literal → CONFIRMED', () => {
    const [v] = checkClaims(withWire('literal'), manifest([wireClaim()]));
    expect(v!.verdict).toBe('confirmed');
  });
  it('constant-resolved → CONFIRMED', () => {
    const [v] = checkClaims(withWire('constant-resolved'), manifest([wireClaim()]));
    expect(v!.verdict).toBe('confirmed');
  });
  it('helper-resolved → CONFIRMED', () => {
    const [v] = checkClaims(withWire('helper-resolved'), manifest([wireClaim()]));
    expect(v!.verdict).toBe('confirmed');
  });
  it('dynamic → UNDETERMINED with defeating pattern', () => {
    const [v] = checkClaims(withWire('dynamic'), manifest([wireClaim()]));
    expect(v!.verdict).toBe('undetermined');
    expect(v!.explainer!.pattern).toContain('dynamic');
  });
  it('sdk → UNDETERMINED', () => {
    const [v] = checkClaims(withWire('sdk'), manifest([wireClaim()]));
    expect(v!.verdict).toBe('undetermined');
  });
  it('no wire edge but rule ran → ABSENT', () => {
    const [v] = checkClaims(withWire(undefined), manifest([wireClaim()]));
    expect(v!.verdict).toBe('absent');
  });
});

describe('ABSENT always carries searchScope (invariant)', () => {
  it('every ABSENT verdict in a mixed run has a non-empty searchScope', () => {
    const g = graph({
      stats: { 'routes/app-router-handler': 1, 'deps/package-json': 1, 'env/process-env-read': 1 },
    });
    const verdicts = checkClaims(
      g,
      manifest([
        claim({ category: 'route', predicate: 'exists', subject: '/a' }),
        claim({ category: 'dep', predicate: 'installed', subject: 'x' }),
        claim({ category: 'env', predicate: 'reads', subject: 'Y' }),
      ]),
    );
    for (const v of verdicts) {
      expect(v.verdict).toBe('absent');
      expect(v.searchScope && v.searchScope.length > 0).toBe(true);
    }
  });
});
