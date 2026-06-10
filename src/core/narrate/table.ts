/**
 * Markdown verdict table (PLAN.md "Narrator degradation" + report hierarchy).
 *
 * This is the deterministic fallback rendered when no LLM narrator is available
 * (the CC CLI is down). It follows the report information hierarchy: a summary
 * line, then ABSENT claims first (each with receipts/searchScope), then
 * UNDETERMINED (plain-language reason first), then CONFIRMED (with file:line
 * receipts), then the standing footer caveat.
 */
import {
  type ClaimVerdict,
  type Provenance,
  type VerdictSummary,
} from '../schema.js';

export function renderVerdictTable(
  verdicts: ClaimVerdict[],
  summary: VerdictSummary,
): string {
  const lines: string[] = [];

  lines.push(summaryLine(summary));
  lines.push('');

  const absent = verdicts.filter((v) => v.verdict === 'absent');
  const undetermined = verdicts.filter((v) => v.verdict === 'undetermined');
  const confirmed = verdicts.filter((v) => v.verdict === 'confirmed');

  if (absent.length > 0) {
    lines.push('## Diverged (absent)');
    lines.push('');
    for (const v of absent) {
      lines.push(`- **${claimLabel(v)}** — absent`);
      const scope = v.searchScope ?? [];
      if (scope.length > 0) {
        lines.push(`  - searched: ${scope.map((s) => `\`${s}\``).join(', ')}`);
      }
    }
    lines.push('');
  }

  if (undetermined.length > 0) {
    lines.push('## Undetermined');
    lines.push('');
    for (const v of undetermined) {
      lines.push(`- **${claimLabel(v)}** — undetermined`);
      const reason = v.explainer?.reason;
      if (reason) lines.push(`  - ${reason}`);
      const pattern = v.explainer?.pattern;
      if (pattern) lines.push(`  - pattern: \`${pattern}\``);
    }
    lines.push('');
  }

  if (confirmed.length > 0) {
    lines.push('## Confirmed');
    lines.push('');
    for (const v of confirmed) {
      lines.push(`- **${claimLabel(v)}** — confirmed`);
      for (const r of v.receipts) {
        lines.push(`  - \`${receiptStr(r)}\``);
      }
    }
    lines.push('');
  }

  lines.push(footer(verdicts.length));
  return lines.join('\n');
}

function summaryLine(s: VerdictSummary): string {
  const coveragePct = Math.round(s.coverage * 100);
  const n = s.confirmed + s.absent + s.undetermined;
  return (
    `${s.confirmed} of ${n} claims confirmed · ${s.absent} absent · ` +
    `${s.undetermined} undetermined · coverage ${coveragePct}%`
  );
}

function claimLabel(v: ClaimVerdict): string {
  const c = v.claim;
  switch (c.category) {
    case 'route':
      return `route ${(c.qualifiers.method ?? 'GET').toUpperCase()} ${c.subject}`;
    case 'middleware':
      return `middleware on ${c.subject}`;
    case 'schema':
      return c.predicate === 'has-column'
        ? `column ${c.qualifiers.column ?? '?'} on ${c.subject}`
        : `table ${c.subject}`;
    case 'env':
      return `env ${c.subject}`;
    case 'dep':
      return `dependency ${c.subject}`;
    case 'wiring':
      return `wiring to ${c.subject}`;
    default:
      return c.subject;
  }
}

function receiptStr(r: Provenance): string {
  const end = r.endLine && r.endLine !== r.line ? `-${r.endLine}` : '';
  return `${r.file}:${r.line}${end}`;
}

function footer(n: number): string {
  return (
    'Verifies presence, not correctness. ' +
    `Checked ${n} claim${n === 1 ? '' : 's'} the agent made; ` +
    'this is not a completeness audit.'
  );
}
