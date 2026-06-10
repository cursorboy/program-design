/**
 * Regression re-verification (PLAN.md §7, ACCEPTED at final gate).
 *
 * recheckLedger re-runs every previously CONFIRMED claim from the ledger against
 * a new graph. Any claim that now yields ABSENT or UNDETERMINED is a regression:
 * a previously verified feature that no longer holds. Each such case becomes a
 * `regression-alert` LedgerEntry { previous, current }, which is appended to the
 * ledger and returned.
 *
 * We re-check by reconstructing a single-claim manifest from the recorded claim
 * and running the deterministic checker — verdicts stay deterministic.
 */
import {
  type ClaimManifest,
  type ClaimVerdict,
  type FactsGraph,
  type LedgerEntry,
  SCHEMA_VERSION,
} from '../schema.js';
import { checkClaims } from './checker.js';
import { appendLedger, readLedger } from './ledger.js';

/**
 * @param dirOverride - test/advanced hook; see ledger.ts. Forwarded to read+append.
 */
export function recheckLedger(
  graph: FactsGraph,
  repoRoot: string,
  sessionId: string,
  dirOverride?: string,
): LedgerEntry[] {
  const entries = readLedger(repoRoot, dirOverride);

  // Collect the latest CONFIRMED verdict per claimId from the ledger. Later
  // entries supersede earlier ones (a claim re-confirmed after a transient miss
  // should be re-checked from its confirmed state).
  const confirmedByClaim = new Map<string, ClaimVerdict>();
  for (const e of entries) {
    if (e.type !== 'claim-checked' || !e.verdict) continue;
    if (e.verdict.verdict === 'confirmed') {
      confirmedByClaim.set(e.verdict.claimId, e.verdict);
    } else {
      // A non-confirmed later entry for the same claim means it already changed;
      // drop it from the regression watch (it was not "confirmed" at HEAD).
      confirmedByClaim.delete(e.verdict.claimId);
    }
  }

  const alerts: LedgerEntry[] = [];
  for (const previous of confirmedByClaim.values()) {
    const manifest: ClaimManifest = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      source: previous.claim ? 'agent' : 'agent',
      claims: [previous.claim],
      unverifiable: [],
    };
    const [current] = checkClaims(graph, manifest);
    if (!current) continue;
    if (current.verdict === 'absent' || current.verdict === 'undetermined') {
      alerts.push({
        type: 'regression-alert',
        sessionId,
        timestamp: new Date().toISOString(),
        previous,
        current,
      });
    }
  }

  if (alerts.length > 0) {
    appendLedger(repoRoot, alerts, dirOverride);
  }
  return alerts;
}
