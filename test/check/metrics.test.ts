import { describe, expect, it } from 'vitest';
import { summarize, usefulnessFloor } from '../../src/core/check/index.js';
import { checkClaims } from '../../src/core/check/index.js';
import { claim, graph, manifest, node, prov } from './helpers.js';

function mixed() {
  // 2 confirmed, 1 absent, 1 undetermined → resolved 3/4 = 0.75 (passes).
  const g = graph({
    nodes: [
      node({ kind: 'route', name: 'GET /a', provenance: prov('app/a/route.ts', 1, 'routes/app-router-handler') }),
      node({ kind: 'dependency', name: 'zod', provenance: prov('package.json', 2, 'deps/package-json') }),
    ],
    stats: { 'routes/app-router-handler': 1, 'deps/package-json': 1 },
  });
  return checkClaims(
    g,
    manifest([
      claim({ category: 'route', predicate: 'exists', subject: '/a' }), // confirmed
      claim({ category: 'dep', predicate: 'installed', subject: 'zod' }), // confirmed
      claim({ category: 'dep', predicate: 'installed', subject: 'gone' }), // absent
      claim({ category: 'wiring', predicate: 'wired', subject: '/x' }), // undetermined (no rule)
    ]),
  );
}

describe('usefulnessFloor', () => {
  it('passes at ratio >= 0.7', () => {
    const r = usefulnessFloor(mixed());
    expect(r.resolved).toBe(3);
    expect(r.total).toBe(4);
    expect(r.ratio).toBeCloseTo(0.75);
    expect(r.passes).toBe(true);
  });

  it('fails below 0.7', () => {
    const g = graph({}); // nothing ran → all undetermined
    const verdicts = checkClaims(
      g,
      manifest([
        claim({ category: 'route', predicate: 'exists', subject: '/a' }),
        claim({ category: 'route', predicate: 'exists', subject: '/b' }),
      ]),
    );
    const r = usefulnessFloor(verdicts);
    expect(r.resolved).toBe(0);
    expect(r.passes).toBe(false);
  });

  it('empty verdict set ratio is 1 and passes', () => {
    const r = usefulnessFloor([]);
    expect(r.ratio).toBe(1);
    expect(r.passes).toBe(true);
  });
});

describe('summarize wrapper', () => {
  it('counts verdicts + coverage', () => {
    const s = summarize(mixed(), 2);
    expect(s.confirmed).toBe(2);
    expect(s.absent).toBe(1);
    expect(s.undetermined).toBe(1);
    expect(s.unverifiable).toBe(2);
    // coverage = 4 checkable / (4 + 2) = 0.666...
    expect(s.coverage).toBeCloseTo(4 / 6);
  });
});
