/**
 * End-to-end corpus gate.
 *
 * extractGraph(sample-app) → checkClaims(graph, manifest) and assert every corpus
 * expectation. The HARD release gate: no expected-confirmed / expected-undetermined
 * case may resolve ABSENT (zero false absents).
 *
 * The checker (src/core/check) is built by another agent against the semantics
 * documented in the task spec. If it does not exist yet, this whole suite is
 * skipped (the extract suite is the standalone gate until integration).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { extractGraph } from '../../src/core/extract/index.js';
import {
  SCHEMA_VERSION,
  type FactsGraph,
  type Claim,
  type ClaimManifest,
  type ClaimVerdict,
  type Verdict,
} from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const SAMPLE = join(ROOT, 'fixtures', 'sample-app');
const CLAIMS = join(ROOT, 'fixtures', 'corpus', 'claims.json');

interface CorpusCase {
  claim: Claim;
  expected: Verdict;
  note: string;
}

// Try to load the checker. If it's not built yet, skip the suite (documented).
type CheckClaims = (
  graph: FactsGraph,
  manifest: ClaimManifest,
) => ClaimVerdict[] | Promise<ClaimVerdict[]>;

let checkClaims: CheckClaims | null = null;
try {
  // @ts-expect-error — module is provided by another agent at integration time.
  const mod = await import('../../src/core/check/index.js');
  checkClaims = (mod.checkClaims ?? mod.default) as CheckClaims;
} catch {
  checkClaims = null;
}

const corpus: CorpusCase[] = JSON.parse(readFileSync(CLAIMS, 'utf8'));

const maybe = checkClaims ? describe : describe.skip;

maybe('corpus e2e (checker present)', () => {
  let verdicts: Map<string, ClaimVerdict>;

  beforeAll(async () => {
    const graph = await extractGraph(SAMPLE);
    const manifest: ClaimManifest = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: 'corpus',
      source: 'file',
      claims: corpus.map((c) => c.claim),
      unverifiable: [],
    };
    const results = await checkClaims!(graph, manifest);
    verdicts = new Map(results.map((v) => [v.claimId, v]));
  });

  it('produces a verdict for every claim', () => {
    for (const c of corpus) {
      expect(verdicts.get(c.claim.id), `missing verdict for ${c.claim.id}`).toBeDefined();
    }
  });

  for (const c of corpus) {
    it(`${c.claim.id}: ${c.claim.rawText} → ${c.expected}`, () => {
      const v = verdicts.get(c.claim.id)!;
      expect(v.verdict, c.note).toBe(c.expected);
    });
  }

  it('RELEASE GATE: zero false ABSENT (no expected confirmed/undetermined is ABSENT)', () => {
    const falseAbsents: string[] = [];
    for (const c of corpus) {
      if (c.expected === 'confirmed' || c.expected === 'undetermined') {
        const v = verdicts.get(c.claim.id);
        if (v && v.verdict === 'absent') {
          falseAbsents.push(`${c.claim.id} (${c.claim.rawText})`);
        }
      }
    }
    expect(falseAbsents, `FALSE ABSENTS: ${falseAbsents.join('; ')}`).toHaveLength(0);
  });
});

// Always-on sanity: the corpus file itself is well-formed even before the checker
// exists, so the contract the checker must satisfy is locked in.
describe('corpus manifest sanity (checker-independent)', () => {
  it('every case has a valid Claim shape and a three-state expectation', () => {
    const states = new Set(['confirmed', 'absent', 'undetermined']);
    expect(corpus.length).toBeGreaterThanOrEqual(15);
    for (const c of corpus) {
      expect(typeof c.claim.id).toBe('string');
      expect(c.claim.category).toBeTruthy();
      expect(c.claim.predicate).toBeTruthy();
      expect(typeof c.claim.subject).toBe('string');
      expect(c.claim.rawText).toBeTruthy();
      expect(states.has(c.expected)).toBe(true);
    }
  });

  it('claim ids are unique', () => {
    const ids = corpus.map((c) => c.claim.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the mandated confirmed/absent/undetermined coverage', () => {
    const byState = (s: string) => corpus.filter((c) => c.expected === s).length;
    expect(byState('confirmed')).toBeGreaterThan(0);
    expect(byState('absent')).toBeGreaterThan(0);
    expect(byState('undetermined')).toBeGreaterThan(0);
  });
});
