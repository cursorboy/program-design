/**
 * Append-only claim ledger (PLAN.md §7 scope expansion + DX state spec).
 *
 * Stored as JSONL at statePath(repoRoot, 'ledger') — one JSON object per line.
 * The ledger doubles as the audit trail and the regression source.
 *
 * readLedger tolerates corrupt lines: it skips them and reports the skipped
 * count via the optional out-param, so a single bad write can never poison the
 * whole audit trail.
 *
 * `dirOverride` (last, optional) bypasses state.ts's homedir()-based path. This
 * exists so tests can write the ledger into a mkdtemp dir without depending on
 * HOME being honored by os.homedir() (which it is not on every Node/macOS combo).
 * It is documented and intended for tests + advanced callers only.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type LedgerEntry } from '../schema.js';
import { STATE_FILES, statePath } from '../state.js';

function ledgerPath(repoRoot: string, dirOverride?: string): string {
  if (dirOverride !== undefined) {
    return join(dirOverride, STATE_FILES.ledger);
  }
  return statePath(repoRoot, 'ledger');
}

/** Append entries as JSONL. Creates the containing dir if needed. */
export function appendLedger(
  repoRoot: string,
  entries: LedgerEntry[],
  dirOverride?: string,
): void {
  if (entries.length === 0) return;
  const path = ledgerPath(repoRoot, dirOverride);
  mkdirSync(dirname(path), { recursive: true });
  const payload = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(path, payload, 'utf8');
}

export interface ReadLedgerResult {
  entries: LedgerEntry[];
  /** Count of lines that could not be parsed (skipped). */
  corruptLines: number;
}

/**
 * Read all ledger entries. Corrupt lines are skipped and counted, never thrown.
 * Returns an empty result if the file does not exist.
 */
export function readLedgerDetailed(
  repoRoot: string,
  dirOverride?: string,
): ReadLedgerResult {
  const path = ledgerPath(repoRoot, dirOverride);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { entries: [], corruptLines: 0 };
  }
  const entries: LedgerEntry[] = [];
  let corruptLines = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isLedgerEntry(parsed)) {
        entries.push(parsed);
      } else {
        corruptLines++;
      }
    } catch {
      corruptLines++;
    }
  }
  return { entries, corruptLines };
}

/** Convenience wrapper returning just the entries (corrupt lines skipped). */
export function readLedger(
  repoRoot: string,
  dirOverride?: string,
): LedgerEntry[] {
  return readLedgerDetailed(repoRoot, dirOverride).entries;
}

function isLedgerEntry(v: unknown): v is LedgerEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.type === 'claim-checked' ||
      o.type === 'regression-alert' ||
      o.type === 'session-start') &&
    typeof o.sessionId === 'string' &&
    typeof o.timestamp === 'string'
  );
}
