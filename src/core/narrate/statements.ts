/**
 * Statement skeleton construction (PLAN.md Layer 3, narrator statement binding).
 *
 * The narrator's output is a list of fact-ID-bound NarratorStatements. These
 * helpers build the DETERMINISTIC skeleton the LLM fills in: one statement per
 * verdict, each pre-bound to the verdict's evidence factIds and claimId, with a
 * plain-language default text. The LLM may rewrite `text` (more readable prose)
 * but the lint (lint.ts) enforces that it cannot invert the verdict or cite
 * facts that do not exist.
 */
import {
  type ClaimVerdict,
  type NarratorStatement,
  type Verdict,
} from '../schema.js';

/** The display word every statement about a claim must contain (lint-enforced). */
export const VERDICT_WORD: Record<Verdict, string> = {
  confirmed: 'confirmed',
  absent: 'absent',
  undetermined: 'undetermined',
};

/** All verdict display words — used by the lint to detect contradictions. */
export const ALL_VERDICT_WORDS: readonly string[] = [
  'confirmed',
  'absent',
  'undetermined',
];

/** A deterministic, plain-language default sentence for a verdict. */
export function defaultStatementText(v: ClaimVerdict): string {
  const subject = v.claim.subject;
  const what = describeSubject(v);
  switch (v.verdict) {
    case 'confirmed':
      return `${what} is confirmed in the code${receiptHint(v)}.`;
    case 'absent':
      return `${what} is absent — I searched and did not find it${scopeHint(v)}.`;
    case 'undetermined':
      return `${what} is undetermined: ${v.explainer?.reason ?? "I can't safely confirm this from the code."}`;
    default:
      // exhaustive
      return `${subject} is undetermined.`;
  }
}

function describeSubject(v: ClaimVerdict): string {
  const c = v.claim;
  switch (c.category) {
    case 'route':
      return `The route ${(c.qualifiers.method ?? 'GET').toUpperCase()} ${c.subject}`;
    case 'middleware':
      return `Middleware on ${c.subject}`;
    case 'schema':
      return c.predicate === 'has-column'
        ? `Column ${c.qualifiers.column ?? '?'} on table ${c.subject}`
        : `Table ${c.subject}`;
    case 'env':
      return `Environment variable ${c.subject}`;
    case 'dep':
      return `Dependency ${c.subject}`;
    case 'wiring':
      return `The frontend wiring to ${c.subject}`;
    default:
      return c.subject;
  }
}

function receiptHint(v: ClaimVerdict): string {
  const first = v.receipts[0];
  if (!first) return '';
  return ` (${first.file}:${first.line})`;
}

function scopeHint(v: ClaimVerdict): string {
  if (!v.searchScope || v.searchScope.length === 0) return '';
  return ` (searched: ${v.searchScope.join(', ')})`;
}

/**
 * Build one statement per verdict, ordered divergences-first (ABSENT, then
 * UNDETERMINED, then CONFIRMED), matching the report hierarchy.
 */
export function buildStatements(verdicts: ClaimVerdict[]): NarratorStatement[] {
  const ordered = orderForNarration(verdicts);
  return ordered.map((v) => ({
    text: defaultStatementText(v),
    factIds: [...v.factIds],
    claimId: v.claimId,
  }));
}

const ORDER: Record<Verdict, number> = {
  absent: 0,
  undetermined: 1,
  confirmed: 2,
};

export function orderForNarration(verdicts: ClaimVerdict[]): ClaimVerdict[] {
  return verdicts
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const d = ORDER[a.v.verdict] - ORDER[b.v.verdict];
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.v);
}
