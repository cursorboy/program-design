/**
 * Regression: method-less claims must match routes of ANY method.
 *
 * Found in the first live smoke test (2026-06-07): "the login form calls the
 * API" (wiring, no qualifiers.method) returned ABSENT even though a literal
 * fetch('/api/login') wired to route:POST /api/login existed — the checker
 * defaulted the method to GET and missed. A false ABSENT is the product's
 * release-blocking failure class; per the corpus iron rule this case is now
 * permanent.
 */
import { describe, expect, it } from 'vitest';
import { checkClaims } from '../../src/core/check/index.js';
import {
  emptyGraph,
  makeEdgeId,
  makeNodeId,
  type Claim,
  type ClaimManifest,
  type FactsGraph,
} from '../../src/core/schema.js';

function manifest(claims: Claim[]): ClaimManifest {
  return { schemaVersion: 1, sessionId: 'test', source: 'user', claims, unverifiable: [] };
}

function graphWithPostLogin(): FactsGraph {
  const g = emptyGraph('/repo');
  const routeId = makeNodeId('route', 'POST /api/login');
  const callId = makeNodeId('clientCall', 'components/LoginForm.tsx#1');
  const mwId = makeNodeId('middleware', 'middleware.ts');
  g.nodes.push(
    {
      id: routeId,
      kind: 'route',
      name: 'POST /api/login',
      provenance: { file: 'app/api/login/route.ts', line: 3, ruleId: 'routes/app-router-handler' },
      attrs: { method: 'POST' },
      invalidatedBy: ['app/api/login/route.ts'],
    },
    {
      id: callId,
      kind: 'clientCall',
      name: 'components/LoginForm.tsx#1',
      provenance: { file: 'components/LoginForm.tsx', line: 8, ruleId: 'wiring/literal-url' },
      attrs: {},
      invalidatedBy: ['components/LoginForm.tsx'],
    },
    {
      id: mwId,
      kind: 'middleware',
      name: 'middleware.ts',
      provenance: { file: 'middleware.ts', line: 1, ruleId: 'middleware/file' },
      attrs: { matcher: '/api/:path*' },
      invalidatedBy: ['middleware.ts'],
    },
  );
  g.edges.push(
    {
      id: makeEdgeId('wiredTo', callId, routeId),
      kind: 'wiredTo',
      from: callId,
      to: routeId,
      provenance: { file: 'components/LoginForm.tsx', line: 8, ruleId: 'wiring/literal-url' },
      tier: 'literal',
      invalidatedBy: ['components/LoginForm.tsx'],
    },
    {
      id: makeEdgeId('attachedTo', mwId, routeId),
      kind: 'attachedTo',
      from: mwId,
      to: routeId,
      provenance: { file: 'middleware.ts', line: 2, ruleId: 'middleware/matcher' },
      tier: 'matcher-includes',
      invalidatedBy: ['middleware.ts'],
    },
  );
  g.stats = {
    'routes/app-router-handler': 1,
    'wiring/literal-url': 1,
    'middleware/matcher': 1,
  };
  return g;
}

describe('method-less claims match any-method routes (false-ABSENT regression)', () => {
  const g = graphWithPostLogin();

  it('wiring/wired with no method qualifier confirms against POST route', () => {
    const [v] = checkClaims(
      g,
      manifest([
        {
          id: 'c1',
          category: 'wiring',
          predicate: 'wired',
          subject: '/api/login',
          qualifiers: {},
          rawText: 'the login form calls the API',
        },
      ]),
    );
    expect(v!.verdict).toBe('confirmed');
    expect(v!.receipts[0]).toMatchObject({ file: 'components/LoginForm.tsx', line: 8 });
  });

  it('middleware/attached with no method qualifier confirms via matcher-includes', () => {
    const [v] = checkClaims(
      g,
      manifest([
        {
          id: 'c2',
          category: 'middleware',
          predicate: 'attached',
          subject: '/api/login',
          qualifiers: {},
          rawText: 'middleware protects the login route',
        },
      ]),
    );
    expect(v!.verdict).toBe('confirmed');
  });

  it('route/exists with no method qualifier confirms a POST-only route', () => {
    const [v] = checkClaims(
      g,
      manifest([
        {
          id: 'c3',
          category: 'route',
          predicate: 'exists',
          subject: '/api/login',
          qualifiers: {},
          rawText: 'there is a login endpoint',
        },
      ]),
    );
    expect(v!.verdict).toBe('confirmed');
  });

  it('explicit wrong method still resolves ABSENT (exact match preserved)', () => {
    const [v] = checkClaims(
      g,
      manifest([
        {
          id: 'c4',
          category: 'route',
          predicate: 'exists',
          subject: '/api/login',
          qualifiers: { method: 'GET' },
          rawText: 'there is a GET login endpoint',
        },
      ]),
    );
    expect(v!.verdict).toBe('absent');
    expect(v!.searchScope).toBeDefined();
  });

  it('path suffix does not false-match a longer path (/login vs /api/login)', () => {
    const [v] = checkClaims(
      g,
      manifest([
        {
          id: 'c5',
          category: 'route',
          predicate: 'exists',
          subject: '/login',
          qualifiers: {},
          rawText: 'there is a /login route',
        },
      ]),
    );
    // graph has POST /api/login only — "/login" must NOT match it
    expect(v!.verdict).toBe('absent');
  });

  it('confirmed receipts are deduped by file:line', () => {
    const g2 = graphWithPostLogin();
    // duplicate provenance on a second wiredTo edge to a second candidate
    const routeId = makeNodeId('route', 'POST /api/login');
    const callId = makeNodeId('clientCall', 'components/LoginForm.tsx#1');
    g2.edges.push({
      id: 'wiredTo:dup',
      kind: 'wiredTo',
      from: callId,
      to: routeId,
      provenance: { file: 'components/LoginForm.tsx', line: 8, ruleId: 'wiring/literal-url' },
      tier: 'literal',
      invalidatedBy: ['components/LoginForm.tsx'],
    });
    const [v] = checkClaims(
      g2,
      manifest([
        {
          id: 'c6',
          category: 'wiring',
          predicate: 'wired',
          subject: '/api/login',
          qualifiers: {},
          rawText: 'the login form calls the API',
        },
      ]),
    );
    expect(v!.verdict).toBe('confirmed');
    expect(v!.receipts).toHaveLength(1);
  });
});
