import { describe, expect, it } from 'vitest';
import { lintReport } from '../../src/core/narrate/index.js';
import { type ClaimVerdict, type NarratorStatement } from '../../src/core/schema.js';
import { claim, edge, graph, node, prov } from '../check/helpers.js';

function confirmedVerdict(): ClaimVerdict {
  return {
    claimId: 'c1',
    claim: claim({ id: 'c1', category: 'route', predicate: 'exists', subject: '/api/login' }),
    verdict: 'confirmed',
    receipts: [prov('app/api/login/route.ts', 1, 'routes/app-router-handler')],
    factIds: ['route:GET /api/login'],
    timestamp: 't',
  };
}

function absentVerdict(): ClaimVerdict {
  return {
    claimId: 'c2',
    claim: claim({ id: 'c2', category: 'dep', predicate: 'installed', subject: 'gone' }),
    verdict: 'absent',
    receipts: [],
    searchScope: ['package.json'],
    factIds: [],
    timestamp: 't',
  };
}

function undeterminedVerdict(): ClaimVerdict {
  return {
    claimId: 'c3',
    claim: claim({ id: 'c3', category: 'wiring', predicate: 'wired', subject: '/x' }),
    verdict: 'undetermined',
    receipts: [],
    explainer: { reason: "I can't safely confirm this from the code — dynamic URL.", pattern: 'wiring dynamic' },
    factIds: [],
    timestamp: 't',
  };
}

const g = graph({
  nodes: [node({ kind: 'route', name: 'GET /api/login', provenance: prov('app/api/login/route.ts', 1, 'routes/app-router-handler') })],
});

describe('lintReport', () => {
  it('keeps a valid statement whose facts resolve + carry provenance + verdict word matches', () => {
    const stmts: NarratorStatement[] = [
      { text: 'The login route is confirmed in the code.', factIds: ['route:GET /api/login'], claimId: 'c1' },
    ];
    const r = lintReport(stmts, g, [confirmedVerdict()]);
    expect(r.statements.length).toBe(1);
    expect(r.removedCount).toBe(0);
  });

  it('drops a statement that cites an unsupported (nonexistent) factId — whole', () => {
    const stmts: NarratorStatement[] = [
      { text: 'This route is confirmed.', factIds: ['route:GET /api/ghost'], claimId: 'c1' },
    ];
    const r = lintReport(stmts, g, [confirmedVerdict()]);
    expect(r.statements.length).toBe(0);
    expect(r.removedCount).toBe(1);
  });

  it('drops a statement whose cited fact has no provenance', () => {
    const g2 = graph({ nodes: [node({ kind: 'route', name: 'GET /np', provenance: null })] });
    const v: ClaimVerdict = { ...confirmedVerdict(), factIds: ['route:GET /np'] };
    const stmts: NarratorStatement[] = [{ text: 'It is confirmed.', factIds: ['route:GET /np'], claimId: 'c1' }];
    const r = lintReport(stmts, g2, [v]);
    expect(r.removedCount).toBe(1);
  });

  it('drops a verdict-word contradiction (says "absent" for a confirmed claim)', () => {
    const stmts: NarratorStatement[] = [
      { text: 'The login route is absent.', factIds: ['route:GET /api/login'], claimId: 'c1' },
    ];
    const r = lintReport(stmts, g, [confirmedVerdict()]);
    expect(r.statements.length).toBe(0);
    expect(r.removedCount).toBe(1);
  });

  it('meaning-inversion: statement claims "confirmed" for an ABSENT claimId → dropped whole', () => {
    const stmts: NarratorStatement[] = [
      { text: 'The dependency is confirmed and present.', factIds: [], claimId: 'c2' },
    ];
    const r = lintReport(stmts, g, [absentVerdict()]);
    expect(r.statements.length).toBe(0);
    expect(r.removedCount).toBe(1);
  });

  it('drops a statement missing the verdict word entirely', () => {
    const stmts: NarratorStatement[] = [
      { text: 'The login route exists somewhere.', factIds: ['route:GET /api/login'], claimId: 'c1' },
    ];
    const r = lintReport(stmts, g, [confirmedVerdict()]);
    expect(r.removedCount).toBe(1);
  });

  it('allows a zero-fact statement ONLY for an undetermined claim that says so', () => {
    const stmts: NarratorStatement[] = [
      { text: 'This wiring is undetermined — I cannot resolve the URL.', factIds: [], claimId: 'c3' },
    ];
    const r = lintReport(stmts, g, [undeterminedVerdict()]);
    expect(r.statements.length).toBe(1);
    expect(r.removedCount).toBe(0);
  });

  it('drops a zero-fact statement bound to a confirmed claim (no receipt derivable)', () => {
    const stmts: NarratorStatement[] = [
      { text: 'The route is confirmed.', factIds: [], claimId: 'c1' },
    ];
    const r = lintReport(stmts, g, [confirmedVerdict()]);
    expect(r.removedCount).toBe(1);
  });

  it('drops a statement bound to a claim with no verdict', () => {
    const stmts: NarratorStatement[] = [
      { text: 'Something is confirmed.', factIds: ['route:GET /api/login'], claimId: 'unknown' },
    ];
    const r = lintReport(stmts, g, [confirmedVerdict()]);
    expect(r.removedCount).toBe(1);
  });

  it('resolves edge factIds too (with provenance)', () => {
    const g2 = graph({
      nodes: [
        node({ kind: 'middleware', name: 'mw', provenance: prov('middleware.ts', 1, 'middleware/matcher') }),
        node({ kind: 'route', name: 'GET /d', provenance: prov('app/d/page.tsx', 1, 'routes/app-router-page') }),
      ],
      edges: [edge({ kind: 'attachedTo', from: 'middleware:mw', to: 'route:GET /d', tier: 'matcher-includes', provenance: prov('middleware.ts', 3, 'middleware/matcher') })],
    });
    const v: ClaimVerdict = {
      claimId: 'm1',
      claim: claim({ id: 'm1', category: 'middleware', predicate: 'attached', subject: '/d' }),
      verdict: 'confirmed',
      receipts: [prov('middleware.ts', 3, 'middleware/matcher')],
      factIds: ['attachedTo:middleware:mw->route:GET /d'],
      timestamp: 't',
    };
    const stmts: NarratorStatement[] = [
      { text: 'Middleware is confirmed as attached.', factIds: ['attachedTo:middleware:mw->route:GET /d'], claimId: 'm1' },
    ];
    const r = lintReport(stmts, g2, [v]);
    expect(r.statements.length).toBe(1);
  });
});
