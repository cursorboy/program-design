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
