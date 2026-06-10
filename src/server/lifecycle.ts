/**
 * lifecycle.ts — in-memory hook lifecycle state machine.
 *
 * The CLI/hooks drive this via POST /api/lifecycle; the views read it from
 * /api/health to show "Verifying claims…" / "build-active" affordances.
 * Transitions are logged to the console (operator visibility). This is a
 * single-process daemon, so module-level state is correct and intentional.
 */
import type { LifecycleState } from '../core/schema.js';

const ORDER: LifecycleState[] = [
  'idle',
  'plan-captured',
  'build-active',
  'extraction-pending',
  'extraction-stable',
  'claims-received',
  'verdicts-streamed',
  'report-finalized',
];

let current: LifecycleState = 'idle';

export function getLifecycle(): LifecycleState {
  return current;
}

/**
 * Set the lifecycle state. Any state is reachable (hooks can jump, e.g. a new
 * build after a finalized report). We log the transition for operator
 * visibility but do not reject "backwards" moves — the machine is descriptive,
 * not a gate.
 */
export function setLifecycle(s: LifecycleState): LifecycleState {
  if (!ORDER.includes(s)) {
    throw new Error(`unknown lifecycle state: ${s}`);
  }
  if (s !== current) {
    // eslint-disable-next-line no-console
    console.log(`[program-design] lifecycle: ${current} → ${s}`);
    current = s;
  }
  return current;
}

/** Reset to idle — used by tests and on a fresh daemon start. */
export function resetLifecycle(): void {
  current = 'idle';
}
