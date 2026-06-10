import { describe, expect, it } from 'vitest';
import {
  buildNarratorPrompt,
  buildStatements,
  buildTranslatorPrompt,
  renderVerdictTable,
} from '../../src/core/narrate/index.js';
import { summarize } from '../../src/core/check/index.js';
import { type ClaimVerdict } from '../../src/core/schema.js';
import { claim, prov } from '../check/helpers.js';

const confirmed: ClaimVerdict = {
  claimId: 'c1',
  claim: claim({ id: 'c1', category: 'route', predicate: 'exists', subject: '/api/login', qualifiers: { method: 'POST' } }),
  verdict: 'confirmed',
  receipts: [prov('app/api/login/route.ts', 4, 'routes/app-router-handler', 9)],
  factIds: ['route:POST /api/login'],
  timestamp: 't',
};
const absent: ClaimVerdict = {
  claimId: 'c2',
  claim: claim({ id: 'c2', category: 'dep', predicate: 'installed', subject: 'left-pad' }),
  verdict: 'absent',
  receipts: [],
  searchScope: ['package.json (dependencies + devDependencies)'],
  factIds: [],
  timestamp: 't',
};
const undetermined: ClaimVerdict = {
  claimId: 'c3',
  claim: claim({ id: 'c3', category: 'wiring', predicate: 'wired', subject: '/api/data' }),
  verdict: 'undetermined',
  receipts: [],
  explainer: { reason: "I can't safely confirm this from the code — dynamic URL.", pattern: 'wiring tier "dynamic"' },
  factIds: [],
  timestamp: 't',
};

const all = [confirmed, absent, undetermined];

describe('renderVerdictTable', () => {
  const md = renderVerdictTable(all, summarize(all, 1));

  it('starts with a summary line in the prescribed format', () => {
    expect(md.split('\n')[0]).toMatch(/1 of 3 claims confirmed · 1 absent · 1 undetermined · coverage \d+%/);
  });

  it('orders sections ABSENT, then UNDETERMINED, then CONFIRMED', () => {
    const iAbsent = md.indexOf('## Diverged (absent)');
    const iUndet = md.indexOf('## Undetermined');
    const iConf = md.indexOf('## Confirmed');
    expect(iAbsent).toBeGreaterThanOrEqual(0);
    expect(iAbsent).toBeLessThan(iUndet);
    expect(iUndet).toBeLessThan(iConf);
  });

  it('absent shows searchScope, undetermined leads with plain-language reason', () => {
    expect(md).toContain('package.json (dependencies + devDependencies)');
    expect(md).toContain("I can't safely confirm this from the code");
  });

  it('confirmed shows file:line receipts (with end line range)', () => {
    expect(md).toContain('app/api/login/route.ts:4-9');
  });

  it('footer carries the standing caveat', () => {
    expect(md).toContain('Verifies presence, not correctness.');
    expect(md).toContain('Checked 3 claims the agent made; this is not a completeness audit.');
  });
});

describe('buildStatements', () => {
  it('emits one statement per verdict, divergences first', () => {
    const stmts = buildStatements(all);
    expect(stmts.length).toBe(3);
    // First should be the absent claim (c2).
    expect(stmts[0]!.claimId).toBe('c2');
    expect(stmts[0]!.text.toLowerCase()).toContain('absent');
    expect(stmts[2]!.claimId).toBe('c1');
    expect(stmts[2]!.text.toLowerCase()).toContain('confirmed');
  });
});

describe('buildNarratorPrompt', () => {
  const g = {
    schemaVersion: 1,
    repoRoot: '/r',
    generatedAt: 't',
    buildActive: false,
    parseFailures: [],
    nodes: [
      { id: 'route:POST /api/login', kind: 'route' as const, name: 'POST /api/login', provenance: prov('app/api/login/route.ts', 4, 'r'), attrs: {}, invalidatedBy: [] },
    ],
    edges: [],
    stats: {},
  };
  const prompt = buildNarratorPrompt(g, all);

  it('forbids verdict changes and constrains to JSON statements', () => {
    expect(prompt).toContain('You may NEVER change a verdict');
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('factIds');
  });

  it('includes serialized verdicts and a fact index with file:line', () => {
    expect(prompt).toContain('VERDICTS');
    expect(prompt).toContain('FACT INDEX');
    expect(prompt).toContain('route:POST /api/login');
    expect(prompt).toContain('app/api/login/route.ts:4');
  });

  it('instructs divergences-first, plain language', () => {
    expect(prompt).toContain('DIVERGENCES FIRST');
    expect(prompt.toLowerCase()).toContain('cannot read code');
  });
});

describe('buildTranslatorPrompt', () => {
  const p = buildTranslatorPrompt('I added POST /login and saved email to users; rate limiting works.', 'sess-9');

  it('embeds the session id and raw text', () => {
    expect(p).toContain('sess-9');
    expect(p).toContain('rate limiting works');
  });

  it('instructs decomposition, behavior-claim refusal, and no inference', () => {
    expect(p).toContain('DECOMPOSE');
    expect(p).toContain('behavior claim — presence-only tool');
    expect(p).toContain('NEVER infer a claim the agent did not state');
  });

  it('references the manifest schema shape', () => {
    expect(p).toContain('"category"');
    expect(p).toContain('"predicate"');
    expect(p).toContain('ClaimManifest');
  });
});
