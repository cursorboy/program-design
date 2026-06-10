/**
 * Walkthrough — the screen-first, ultra-plain view of an app.
 *
 * This is the NON-TECHNICAL view. It organizes the app the way a person using
 * it experiences it, not the way an engineer builds it:
 *
 *   - Every SCREEN is a card with a real screenshot (when the app can be run)
 *     or a clean preview.
 *   - Screens nest into a HIERARCHY by what you can click: the entry screen at
 *     the top, and the screens you can reach from it as children.
 *   - When something you do on a screen kicks off work behind the scenes, that
 *     work unfolds as a plain-language STORY (a sequence of steps), not a box
 *     labelled "API". No GET/POST/cache/gateway jargon in the default text.
 *   - Every step can teach: tap "what's this really called?" to reveal the real
 *     term + a one-line explanation, so the view doubles as a gentle
 *     system-design teacher. Steps can carry a code receipt and a sensitivity
 *     warning ("this is stored in plain text").
 *   - "Behind the scenes" helpers that run on their own (bots, the reminder
 *     clock, the AI services, the app's memory) are shown in their own calm lane.
 *
 * Like the SystemMap, this is an LLM-organized, fact-anchored projection: the
 * plain stories are written by the organize pass over the deterministic facts +
 * real code, and every receipt points to a real line.
 */

export const WALKTHROUGH_VERSION = 1;

/** A gentle "the real word for this" reveal — the system-design teaching bit. */
export interface Teach {
  /** The real technical term, e.g. "SMS gateway", "background worker". */
  term: string;
  /** One plain sentence explaining the concept generally. */
  explain: string;
}

/** One step in a behind-the-scenes story. */
export interface Step {
  /** Plain-language sentence a non-coder fully understands. No jargon. */
  plain: string;
  /** Optional "what's this really called?" reveal. */
  teach?: Teach;
  /** Repo-relative file:line the user can open to verify this step. */
  receipt?: string;
  /** A plain-language safety warning, e.g. "Your code is stored in plain text." */
  warning?: string;
}

export type ActionKind = 'navigate' | 'backend';

/** Something a person can do on a screen. */
export interface ScreenAction {
  /** Plain label, e.g. "Tap 'Log in'" or "Type your phone number and send". */
  label: string;
  kind: ActionKind;
  /** For kind:'navigate' — the screen id you end up on. */
  toScreen?: string;
  /** For kind:'backend' — the plain-language story of what happens. */
  story?: Step[];
}

export interface Screen {
  id: string;
  /** Plain name, e.g. "The welcome page", "Your home screen". */
  name: string;
  /** The URL path (for the technical/learn layer). */
  path?: string;
  /**
   * How to picture it:
   *  - shot: a captured screenshot served at /api/shot?name=<shot>
   *  - preview: a clean stand-in (we couldn't run/auth this page)
   */
  shot?: string;
  preview?: boolean;
  /** Plain sentence: what you see on this screen. */
  whatYouSee: string;
  /** Things you can do here (clicks that go elsewhere, or kick off backend work). */
  actions: ScreenAction[];
  /** Screen ids reachable from here (drives the hierarchy/tree). */
  children: string[];
  /** Receipt for the screen itself. */
  receipt?: string;
}

/** An always-running helper the user never sees but should understand. */
export interface BehindTheScenes {
  /** Plain name, e.g. "The video helper", "The reminder clock". */
  name: string;
  /** Plain sentence of what it quietly does. */
  plain: string;
  teach?: Teach;
  receipt?: string;
  /** Is this actually running, or coded-but-not-deployed? */
  live?: boolean;
}

export interface Walkthrough {
  schemaVersion: number;
  generatedAt: string;
  repoRoot: string;
  /** Plain "what this app is", one or two sentences a 12-year-old gets. */
  what: string;
  /** The screen you start on (top of the tree). */
  entryScreenId: string;
  screens: Screen[];
  /** The calm lane of always-running helpers (bots, clock, memory, AI). */
  behindTheScenes: BehindTheScenes[];
}
