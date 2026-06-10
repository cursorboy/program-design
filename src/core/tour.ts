/**
 * Tour — the guided, self-narrating build-up of the system map.
 *
 * The comprehension fix for non-technical people: instead of showing the whole
 * diagram at once (overwhelming, no reading order), the map ASSEMBLES ITSELF one
 * beat at a time while a plain sentence narrates each step. The viewer watches
 * their app get drawn and explained — so by the end they understand a diagram
 * they could never have read cold.
 *
 * It is the SAME mechanic as the live build: as Claude writes code, nodes appear
 * exactly the way a tour beat reveals them. So "Walk me through it" and "watch it
 * build live" are one feature.
 *
 * A Tour is a projection of the SystemMap: every beat reveals real node/edge ids
 * that already exist in the map (so the tour can never show something the
 * deterministic facts don't contain). Captions are plain; the technical detail
 * lives on the node itself (click to learn).
 */

export const TOUR_VERSION = 1;

export interface Beat {
  /** Plain-language narration for this beat — one or two sentences, no jargon. */
  caption: string;
  /**
   * Node + edge ids (from the SystemMap) that become visible on this beat.
   * Earlier beats' reveals stay visible; the map grows.
   */
  reveal: string[];
  /** Optional node/edge ids to spotlight (focus) this beat without dimming reveals. */
  highlight?: string[];
  /**
   * Optional screenshot name (served at /api/shot?name=) to show large for this
   * beat — used for the opening "this is your app" beat.
   */
  shot?: string;
  /** True if this beat surfaces a claim-check concern (renders with the ⚠ tone). */
  concern?: boolean;
}

export interface Tour {
  schemaVersion: number;
  /** Plain title, e.g. "How theVault works". */
  title: string;
  /** The ordered story beats. */
  beats: Beat[];
  /**
   * 'deterministic' = derived from the facts graph (safe to regenerate on every
   * extraction). Absent or 'llm' = authored — never overwritten automatically.
   */
  generatedBy?: 'llm' | 'deterministic';
}
