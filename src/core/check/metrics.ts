/**
 * Usefulness floor (PLAN.md §7 floor precedence + CEO quality bars).
 *
 * The usefulness floor asks: of the claims the checker could reason about, what
 * fraction resolved to a decisive verdict (CONFIRMED or ABSENT) rather than
 * UNDETERMINED? ratio >= 0.7 passes.
 *
 * FLOOR PRECEDENCE (inviolable, PLAN.md Eng Hardening §7):
 *   The 0-false-ABSENT corpus gate is measured FIRST and is non-negotiable.
 *   This usefulness floor is measured ONLY AFTER that gate passes. The floor may
 *   only be lifted by legitimately WIDENING the allowlist (allowlist.ts) — never
 *   by relaxing the bias-to-undetermined to manufacture decisive verdicts. A
 *   higher resolved-ratio bought by false ABSENTs is a regression, not progress.
 */
import { type ClaimVerdict } from '../schema.js';

export interface FloorResult {
  /** CONFIRMED + ABSENT verdicts. */
  resolved: number;
  /** Total verdicts considered. */
  total: number;
  /** resolved / total (1 when total is 0). */
  ratio: number;
  passes: boolean;
}

export const USEFULNESS_FLOOR_RATIO = 0.7;

export function usefulnessFloor(verdicts: ClaimVerdict[]): FloorResult {
  let resolved = 0;
  for (const v of verdicts) {
    if (v.verdict === 'confirmed' || v.verdict === 'absent') resolved++;
  }
  const total = verdicts.length;
  const ratio = total === 0 ? 1 : resolved / total;
  return { resolved, total, ratio, passes: ratio >= USEFULNESS_FLOOR_RATIO };
}
