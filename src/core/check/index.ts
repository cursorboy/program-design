/**
 * Public API for the deterministic claim checker (PLAN.md Layer 2).
 *
 * Other packages (server, cli) compile against exactly these exports.
 */
export { checkClaims, summarize } from './checker.js';
export {
  getAllowlist,
  findAllowlistEntry,
  type AllowlistEntry,
} from './allowlist.js';
export { validateManifest } from './manifest.js';
export {
  appendLedger,
  readLedger,
  readLedgerDetailed,
  type ReadLedgerResult,
} from './ledger.js';
export { recheckLedger } from './regression.js';
export {
  usefulnessFloor,
  USEFULNESS_FLOOR_RATIO,
  type FloorResult,
} from './metrics.js';
