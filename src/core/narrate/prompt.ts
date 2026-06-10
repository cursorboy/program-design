/**
 * Narrator + translator prompt builders (PLAN.md Layer 3 + translator fence).
 *
 * These build the FENCE around the one LLM surface — they do NOT call any model.
 * The narrator prompt hands the model the deterministic verdicts plus a compact
 * fact index, and forbids it from doing anything except emitting fact-ID-bound
 * statements. The translator prompt fences raw agent claims into ClaimManifest
 * JSON, refusing behavior claims and inferring nothing.
 */
import {
  type ClaimVerdict,
  type FactsGraph,
  SCHEMA_VERSION,
} from '../schema.js';
import { orderForNarration } from './statements.js';

// ---------------------------------------------------------------------------
// Narrator prompt.
// ---------------------------------------------------------------------------

interface FactIndexEntry {
  id: string;
  name: string;
  loc: string; // "file:line" or "(no location)"
}

function buildFactIndex(
  graph: FactsGraph,
  verdicts: ClaimVerdict[],
): FactIndexEntry[] {
  // Only expose facts the verdicts actually reference — the model may reference
  // ONLY these ids. Keeps the prompt compact and the surface tight.
  const referenced = new Set<string>();
  for (const v of verdicts) for (const id of v.factIds) referenced.add(id);

  const byId = new Map<string, FactIndexEntry>();
  for (const n of graph.nodes) {
    if (!referenced.has(n.id)) continue;
    byId.set(n.id, {
      id: n.id,
      name: n.name,
      loc: n.provenance
        ? `${n.provenance.file}:${n.provenance.line}`
        : '(no location)',
    });
  }
  for (const e of graph.edges) {
    if (!referenced.has(e.id)) continue;
    byId.set(e.id, {
      id: e.id,
      name: `${e.kind} ${e.from} → ${e.to}`,
      loc: e.provenance
        ? `${e.provenance.file}:${e.provenance.line}`
        : '(no location)',
    });
  }
  return [...byId.values()];
}

function serializeVerdicts(verdicts: ClaimVerdict[]): unknown[] {
  return orderForNarration(verdicts).map((v) => ({
    claimId: v.claimId,
    category: v.claim.category,
    predicate: v.claim.predicate,
    subject: v.claim.subject,
    qualifiers: v.claim.qualifiers,
    verdict: v.verdict,
    receipts: v.receipts.map((r) => `${r.file}:${r.line}`),
    searchScope: v.searchScope ?? [],
    explainer: v.explainer
      ? { reason: v.explainer.reason, pattern: v.explainer.pattern }
      : undefined,
    factIds: v.factIds,
  }));
}

export function buildNarratorPrompt(
  graph: FactsGraph,
  verdicts: ClaimVerdict[],
): string {
  const factIndex = buildFactIndex(graph, verdicts);
  const serialized = serializeVerdicts(verdicts);

  return [
    'You are the NARRATOR for a code-verification tool. You translate already-',
    'decided verdicts into plain language for a NON-TECHNICAL reader. You do not',
    'verify anything yourself.',
    '',
    'HARD RULES (violating any one causes your output to be discarded):',
    '1. Output ONLY a JSON array of statements. Each statement is an object:',
    '     { "text": string, "factIds": string[], "claimId": string }',
    '   Output nothing else — no prose, no markdown, no preamble.',
    '2. You may reference ONLY the fact IDs listed in FACT INDEX below. Any',
    '   statement citing an unknown ID will be dropped whole.',
    '3. You may NEVER change a verdict. Each statement must use the exact verdict',
    '   word for its claim: "confirmed", "absent", or "undetermined". Using a',
    '   different verdict word than the one given drops the statement whole.',
    '4. Write for someone who cannot read code. Lead with what it means.',
    '5. Put DIVERGENCES FIRST: absent claims, then undetermined, then confirmed.',
    '6. Do not invent file paths or line numbers; the renderer derives them from',
    '   the fact IDs you cite.',
    '7. If you have no fact to back a sentence, do not write the sentence.',
    '',
    'VERDICTS (already decided — narrate, never re-judge):',
    JSON.stringify(serialized, null, 2),
    '',
    'FACT INDEX (id → name + file:line — the ONLY IDs you may cite):',
    factIndex.length === 0
      ? '(no facts — only undetermined/absent claims with no evidence nodes)'
      : factIndex
          .map((f) => `  ${f.id}  —  ${f.name}  [${f.loc}]`)
          .join('\n'),
    '',
    'Return the JSON array now.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Translator prompt (raw claim text → ClaimManifest JSON).
// ---------------------------------------------------------------------------

export function buildTranslatorPrompt(
  rawClaimText: string,
  sessionId: string,
): string {
  return [
    'You are the CLAIM TRANSLATOR for a presence-only code-verification tool.',
    'Translate the building agent\'s raw claim text into a structured',
    'ClaimManifest JSON. You are a FENCE, not a verifier: you decide only HOW to',
    'express each claim, never whether it is true.',
    '',
    'OUTPUT: a single JSON object matching this shape exactly:',
    '  {',
    `    "schemaVersion": ${SCHEMA_VERSION},`,
    `    "sessionId": ${JSON.stringify(sessionId)},`,
    '    "source": "agent",',
    '    "claims": [',
    '      {',
    '        "id": "c1",',
    '        "category": "route" | "middleware" | "schema" | "env" | "dep" | "wiring",',
    '        "predicate": "exists" | "attached" | "has-column" | "reads" | "installed" | "wired",',
    '        "subject": "<normalized route path | table | env name | dep name>",',
    '        "qualifiers": { "method"?: "GET|POST|...", "column"?: "...", "middleware"?: "..." },',
    '        "rawText": "<the verbatim sentence this claim came from>"',
    '      }',
    '    ],',
    '    "unverifiable": [ { "rawText": "...", "reason": "..." } ]',
    '  }',
    '',
    'RULES:',
    '1. DECOMPOSE compound claims. "I added a POST /login route and saved the',
    '   email to the users table" becomes TWO claims (a route/exists and a',
    '   schema/has-column), each with its own id and rawText slice.',
    '2. REFUSE behavior/correctness claims into "unverifiable" with reason',
    '   "behavior claim — presence-only tool". Examples: "rate limiting works",',
    '   "the login is secure", "it validates the password", "emails actually send".',
    '   This tool checks PRESENCE and WIRING only, never runtime behavior.',
    '3. NEVER infer a claim the agent did not state. If the agent did not mention',
    '   a thing, do not add a claim for it. No helpful extrapolation.',
    '4. If a claim cannot be expressed in the categories/predicates above, put it',
    '   in "unverifiable" with a precise reason — never drop it silently.',
    '5. Normalize subjects: routes as "/path" (no host), env vars as the exact',
    '   NAME, deps as the package name, tables/columns as declared.',
    '6. Default method is GET for routes when unstated; set qualifiers.method only',
    '   when the agent named a method.',
    '7. Output ONLY the JSON object. No prose, no markdown fences.',
    '',
    'RAW CLAIM TEXT:',
    rawClaimText,
    '',
    'Return the ClaimManifest JSON now.',
  ].join('\n');
}
