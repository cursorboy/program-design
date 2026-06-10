/**
 * Public API for the fenced narrator layer (PLAN.md Layer 3).
 */
export { lintReport } from './lint.js';
export { buildNarratorPrompt, buildTranslatorPrompt } from './prompt.js';
export { renderVerdictTable } from './table.js';
export {
  buildStatements,
  defaultStatementText,
  orderForNarration,
  VERDICT_WORD,
  ALL_VERDICT_WORDS,
} from './statements.js';
