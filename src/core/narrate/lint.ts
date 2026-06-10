/**
 * Fail-closed narrator lint (PLAN.md Layer 3 + Eng Hardening "statement binding").
 *
 * A statement SURVIVES only if ALL of:
 *  (a) every factId resolves to a node or edge that exists in the graph;
 *  (b) every resolved fact carries provenance (receipts must be derivable);
 *  (c) if claimId is set, the statement's text does not contradict the verdict —
 *      enforced mechanically: the text MUST contain the verdict's display word
 *      for its claim, and MUST NOT contain a different verdict word.
 *
 * Failed statements drop WHOLE (removedCount increments). There are no partial
 * edits — partial drops that could invert meaning are structurally impossible.
 */
import {
  type ClaimVerdict,
  type FactsGraph,
  type NarratorReport,
  type NarratorStatement,
} from '../schema.js';
import { ALL_VERDICT_WORDS, VERDICT_WORD } from './statements.js';

export function lintReport(
  statements: NarratorStatement[],
  graph: FactsGraph,
  verdicts: ClaimVerdict[],
): NarratorReport {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const provenanceById = buildProvenanceIndex(graph);
  const verdictByClaim = new Map(verdicts.map((v) => [v.claimId, v]));

  const survivors: NarratorStatement[] = [];
  let removedCount = 0;

  for (const stmt of statements) {
    if (survives(stmt, nodeIds, edgeIds, provenanceById, verdictByClaim)) {
      survivors.push(stmt);
    } else {
      removedCount++;
    }
  }

  return { statements: survivors, removedCount };
}

function survives(
  stmt: NarratorStatement,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  provenanceById: Map<string, boolean>,
  verdictByClaim: Map<string, ClaimVerdict>,
): boolean {
  // A statement must cite at least one fact (no free-floating prose).
  if (!stmt.factIds || stmt.factIds.length === 0) {
    // Exception: an UNDETERMINED claim may legitimately have zero evidence
    // facts (nothing in the graph to point at). Allow it ONLY when bound to an
    // undetermined verdict and the text is internally consistent.
    const v = stmt.claimId ? verdictByClaim.get(stmt.claimId) : undefined;
    if (!v || v.verdict !== 'undetermined') return false;
    return verdictWordConsistent(stmt.text, v);
  }

  // (a) every factId resolves to a node or edge in the graph; AND
  // (b) every resolved fact carries provenance (receipt derivable).
  for (const id of stmt.factIds) {
    const isNode = nodeIds.has(id);
    const isEdge = edgeIds.has(id);
    if (!isNode && !isEdge) return false;
    if (provenanceById.get(id) !== true) return false;
  }

  // (c) verdict-word consistency when bound to a claim.
  if (stmt.claimId) {
    const v = verdictByClaim.get(stmt.claimId);
    if (!v) return false; // bound to a claim with no verdict → drop.
    if (!verdictWordConsistent(stmt.text, v)) return false;
  }

  return true;
}

/**
 * Text must contain the verdict's own display word and must NOT contain any
 * OTHER verdict word. Case-insensitive, whole-word matched so "unconfirmed" does
 * not satisfy "confirmed" and "confirmed" inside "absent context" can't sneak in.
 */
function verdictWordConsistent(text: string, v: ClaimVerdict): boolean {
  const own = VERDICT_WORD[v.verdict];
  if (!containsWord(text, own)) return false;
  for (const word of ALL_VERDICT_WORDS) {
    if (word === own) continue;
    if (containsWord(text, word)) return false;
  }
  return true;
}

function containsWord(text: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  return re.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** id → true when the node/edge carries provenance, false otherwise. */
function buildProvenanceIndex(graph: FactsGraph): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const n of graph.nodes) m.set(n.id, n.provenance != null);
  for (const e of graph.edges) m.set(e.id, e.provenance != null);
  return m;
}
