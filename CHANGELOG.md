# Changelog

All notable changes to program-design are documented here. This project follows
[Semantic Versioning](https://semver.org/). The claim-manifest schema is stable
within a major version (see [docs/claim-manifest.md](docs/claim-manifest.md)).

## [0.1.1] — 2026-06-10

### Fixed

- **CLI did nothing when run via npx.** npm installs the bin as a
  `node_modules/.bin` symlink; Node realpaths `import.meta.url`, so the naive
  entry-point check (`argv[1] === fileURLToPath(import.meta.url)`) never
  matched and `main()` silently never ran. Both sides are realpathed now
  (`src/cli/entry.ts`), with symlink-shim regression tests.
- CI release job is idempotent: a re-run on an already-published version skips
  instead of failing.

## [0.2.0] — 2026-06-15

### Added

- **Universal map — works on any JavaScript/TypeScript project.** When a repo
  isn't Next.js, `live` no longer refuses; it draws a universal map: the areas
  of your code (top-level source directories) and the outside services + packages
  they pull in (Stripe, OpenAI, Redis, …), each anchored to a real file. The
  bands relabel to "YOUR CODE" / "OUTSIDE SERVICES & PACKAGES", and an honest
  banner says deep checks (routes, schema, claim verdicts) understand Next.js +
  Prisma so far. The gate broadened from Next.js-only to any JS/TS project
  (`looksLikeJsRepo`); the SessionStart hook activates on any JS/TS project too,
  tailoring its message. New `not-a-code-repo` error for non-JS/TS directories.
- **One-command Claude Code install.** program-design now ships as a Claude Code
  **plugin**: `/plugin marketplace add cursorboy/program-design` then
  `/plugin install program-design@program-design`. After that the skill
  auto-activates and the bundled hooks run hands-free — no downloads, no
  commands to remember. A `SessionStart` hook detects a Next.js project and
  tells the agent to offer the live map and verify its own claims; a `Stop`
  hook runs the deterministic verifier when a claim manifest is staged. The CLI
  is fetched by `npx` on first use, so the user installs nothing else.
- **Audience onboarding.** First visit asks "How should we explain your app?"
  with three plain choices — *Keep it simple* / *Show me & explain* / *I write
  code* — before anything is drawn. The choice is remembered (`pd-audience`)
  and changeable anytime from the menu. The guided tour waits for the answer.
- **The map adapts to the reader.** `body[data-audience]` gates the canvas:
  the two non-coder levels hide file paths and technical identifiers, enlarge
  labels, and **calm the wires** — idle connections recede to a faint single
  tone (no rainbow brand colors, no moving pulses) and light up only when you
  hover or focus a box. The *I write code* level keeps the full colored,
  pulsing, receipted wires. This is the fix for the dense "spaghetti" map.

### Changed

- The menu's "Detail level" control is now a human-language audience switch
  ("How should we explain your app?"), and the map is the home surface for
  every audience (the Technical tree stays reachable from the menu).

### Fixed

- **Dynamic route claims no longer false-ABSENT.** Claiming a route in
  Express/OpenAPI style (`/blog/:slug`) for a route that exists in Next.js
  filesystem form (`app/blog/[slug]`) resolved ABSENT — a false absent, the
  exact bug class this tool exists to prevent. The checker now canonicalizes
  `:param` → `[param]` (and `:param*` → `[...param]`) before matching
  (`src/core/check/checker.ts`). Surfaced by the corpus expansion below.

### Internal

- **Adversarial verdict corpus expanded 21 → 59 claims** (`fixtures/corpus/`),
  moving past the ≥50-claim release gate. New cases are deliberately adversarial
  — dynamic/route-group/method-qualifier route traps, HOF-guard and matcher
  middleware, Prisma `@map`/relation/`@@map` schema traps, destructured and
  bracket-access env reads, scoped and dev-only deps, and
  constant-resolved/dynamic-undetermined wiring — each chosen to provoke a false
  ABSENT if the checker were naive. Two residual false-ABSENT gaps the corpus
  exposed (computed-key env reads, helper-wrapped wiring) are documented in
  `TODOS.md` rather than papered over.

## [0.1.0] — 2026-06-10

Initial release. Next.js App Router + Prisma, MVP.

### Added

- **Deterministic system map + guided tour** — every extraction derives a
  layered, plain-language system map (screens → server → records → outside
  services) and a self-narrating guided tour straight from the facts graph — no
  LLM, no config. This lights up "How it works" (end-to-end stories), "What
  looks off" (presence-statement concerns with receipts: secret-named settings
  exposed to the browser, doors that save data with no security check found,
  untraceable calls, unreadable files), and the first-visit tour where the map
  assembles itself one beat at a time. An LLM- or hand-authored map is never
  overwritten.
- **"What am I looking at?" key** — an always-available plain-language key on
  the map explaining boxes, flow lines, locks, and the dashed/faded honesty
  markers. Ghost nodes explain themselves on hover.
- **`organize` command** — install an LLM-authored ("organize pass") system map
  and tour. Fact-anchor gated: any node/edge without a receipt resolving to a
  real repo file is dropped; fails closed if everything is. `--reset` returns
  to the deterministic map. The skill documents the authoring contract.
- **Deterministic extractor** — parses raw source into a facts graph (routes,
  middleware attachment, Prisma schema, env reads, dependencies, frontend→backend
  wiring) with no LLM. Every fact carries `file:line` provenance.
- **Three-state claim checker** — CONFIRMED / ABSENT / UNDETERMINED, computed
  deterministically against a recognized-pattern allowlist. Biased to
  UNDETERMINED: never a false ABSENT.
- **Constrained narrator** — plain-language statements bound to fact ids; a
  statement with no backing fact is dropped. Falls back to the raw verdict table
  when the Claude Code CLI is unavailable.
- **Live structure view** — local 127.0.0.1 server + file watcher; the diagram
  refreshes as the build proceeds. Regression re-verification over the claim
  ledger on each graph change.
- **CLI** — `live`, `demo`, `check`, `report`, `export mermaid`, `patterns`,
  `status`, `stop`, `restart`, `doctor`. `--json` on every read command. Exit
  codes: 0 (no divergence), 1 (ABSENT found), 2 (tool error).
- **Claude Code skill** — claim-time verification and live structure viewing,
  with the inline translator instruction (decompose compound claims, refuse
  behavior claims, never invent claims) and verbatim verdict presentation.
- **Config** — `program-design.config.json` (port, debounce, ignoreGlobs,
  authGuards, daemon.autostart, theme). CLI flags override config.
- **Error catalog** — every terminal error carries problem + cause + fix + docs
  link; codes match the anchors in `docs/errors.md`.
- **Docs** — what-it-verifies (the headline), patterns, UNDETERMINED gallery,
  claim-manifest schema, CI usage, errors, contributing.
- **State** — lives in `~/.program-design/<repo-hash>/`; the repo is never
  polluted. Append-only JSONL ledger. First-run daemon consent notice.
- **CI** — Node 20 + 22 matrix; typecheck + vitest; the corpus e2e is the
  false-ABSENT release gate (`corpus-gate`). Release publish job stubbed (dry-run).

### Notes

- Verifies **presence, not correctness.** No runtime/behavior claims.
- No telemetry. The server binds to 127.0.0.1 only and records env variable names,
  never values.
