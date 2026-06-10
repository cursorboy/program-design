/**
 * program-design core — public API barrel.
 * Layers: schema (IR contract) → extract (deterministic, no LLM) →
 * check (deterministic three-state verdicts) → narrate (fenced LLM surface).
 */
export * from './schema.js';
export * from './state.js';
export { extractGraph, DEFAULT_IGNORE_GLOBS } from './extract/index.js';
export { createWatcher } from './watch.js';
export { invalidatedScope } from './invalidate.js';
export {
  checkClaims,
  getAllowlist,
  findAllowlistEntry,
  validateManifest,
  appendLedger,
  readLedger,
  readLedgerDetailed,
  recheckLedger,
  summarize,
  usefulnessFloor,
  USEFULNESS_FLOOR_RATIO,
  type AllowlistEntry,
} from './check/index.js';
export {
  lintReport,
  buildNarratorPrompt,
  buildTranslatorPrompt,
  renderVerdictTable,
} from './narrate/index.js';
