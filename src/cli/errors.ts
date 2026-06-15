/**
 * User-facing error catalog (PLAN.md DX spec — "CI-linted like receipts").
 *
 * Every terminal error prints four things:
 *   problem — one line, what went wrong
 *   cause   — why it happened
 *   fix     — what to do, a command when one exists
 *   docs    — a deep link into docs/errors.md (anchor === error code)
 *
 * The anchors in DOCS_BASE + '#<code>' MUST exist in docs/errors.md. A test
 * (test/cli/errors.test.ts) reads that file and asserts every code is present.
 */

const DOCS_BASE =
  'https://github.com/program-design/program-design/blob/main/docs/errors.md';

export interface ErrorSpec {
  /** One-line problem statement. */
  problem: string;
  /** Why it happened. */
  cause: string;
  /** What to do — a runnable command where possible. */
  fix: string;
}

/**
 * The catalog. Keys are stable error codes; they double as the docs anchor
 * (docs/errors.md heading slug) and the exit-context identifier.
 */
export const ERROR_CATALOG = {
  'not-a-nextjs-repo': {
    problem: 'This directory does not look like a Next.js app.',
    cause:
      'No app/ or pages/ directory and no "next" dependency in package.json was found at the repo root.',
    fix: 'cd into your Next.js project, or pass --repo <path>. Try `npx program-design demo` to run on the bundled sample app.',
  },
  'not-a-code-repo': {
    problem: 'This directory does not look like a JavaScript/TypeScript project.',
    cause:
      'No package.json, tsconfig, common source directory (src/app/lib/…), or .js/.ts file was found at the repo root. The universal map needs JS/TS code to read; deep verification additionally needs Next.js + Prisma.',
    fix: 'cd into your project, or pass --repo <path>. Try `npx program-design demo` to run on the bundled sample app.',
  },
  'unsupported-stack': {
    problem: 'This stack variant is not supported yet.',
    cause:
      'program-design ships Next.js App Router + Prisma at MVP. The detected stack uses a schema/router source it cannot parse.',
    fix: 'See the supported patterns: `npx program-design patterns`. Open an issue with your stack so it can join the corpus.',
  },
  'narrator-unavailable': {
    problem: 'The narrator (Claude Code CLI) is unavailable — showing the raw verdict table.',
    cause:
      'program-design renders prose through your existing Claude Code session. The CLI was not reachable, so it falls back to the deterministic table.',
    fix: 'No action needed — verdicts are deterministic and unaffected. Re-run inside a Claude Code session for narrated prose.',
  },
  'stale-daemon': {
    problem: 'A stale or orphaned daemon was found for this repo.',
    cause:
      'port.json points at a process id that is no longer alive (the daemon crashed or the machine restarted).',
    fix: 'Run `npx program-design doctor` to clean it, or `npx program-design restart`.',
  },
  'port-conflict': {
    problem: 'The requested port is already in use.',
    cause:
      'Another process (possibly another program-design daemon) is bound to the port you asked for.',
    fix: 'Pass a different port with --port <n>, or set "port" in program-design.config.json. `npx program-design status` shows the running daemon.',
  },
  'node-version': {
    problem: 'Your Node.js version is too old.',
    cause: 'program-design requires Node.js >= 20 (ESM, NodeNext, native fetch).',
    fix: 'Install Node 20 or newer (https://nodejs.org), then re-run. `node --version` shows your current version.',
  },
  'manifest-invalid': {
    problem: 'The claim manifest could not be read or validated.',
    cause:
      'The --manifest file is not valid JSON, or does not match the ClaimManifest / Claim[] shape.',
    fix: 'Validate the file against docs/claim-manifest.md. Each claim needs id, category, predicate, subject, qualifiers, rawText.',
  },
  'graph-corrupt': {
    problem: 'The facts graph on disk is corrupt or unreadable.',
    cause:
      'graph.json failed to parse, or its schemaVersion does not match this build. The graph is disposable by design.',
    fix: 'Re-extract: `npx program-design live` (or `check` will rebuild automatically). `npx program-design doctor` reports the mismatch.',
  },
  'map-invalid': {
    problem: 'The authored system map could not be installed.',
    cause:
      'The --from file is not valid JSON, does not match the SystemMap shape, or no node carries a file receipt that resolves to a real repo file (the fact-anchor gate drops unanchored nodes).',
    fix: 'Give each node id, kind, label, and file: "<repo-relative-path>:<line>" pointing at code that exists. `npx program-design organize --reset` falls back to the deterministic map.',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

/** Build the canonical docs link for an error code. */
export function docsLink(code: ErrorCode): string {
  return `${DOCS_BASE}#${code}`;
}

/**
 * A user-facing program error. Always carries a full catalog entry. The CLI
 * top-level handler prints it and exits 2.
 */
export class PDError extends Error {
  readonly code: ErrorCode;
  readonly cause_: string;
  readonly fix: string;
  readonly docs: string;

  constructor(code: ErrorCode, detail?: string) {
    const spec = ERROR_CATALOG[code];
    super(detail ? `${spec.problem} ${detail}` : spec.problem);
    this.name = 'PDError';
    this.code = code;
    this.cause_ = spec.cause;
    this.fix = spec.fix;
    this.docs = docsLink(code);
  }
}

/** Throw a catalog error by code. */
export function fail(code: ErrorCode, detail?: string): never {
  throw new PDError(code, detail);
}

/** Render a PDError to a multi-line string for the terminal. */
export function formatError(err: PDError): string {
  const lines = [
    `  Problem: ${err.message}`,
    `  Cause:   ${err.cause_}`,
    `  Fix:     ${err.fix}`,
    `  Docs:    ${err.docs}`,
  ];
  return `program-design error [${err.code}]\n${lines.join('\n')}`;
}
