# program-design

**Every statement about your code points to a line you can open and check
yourself.**

**Website:** [cursorboy.github.io/program-design](https://cursorboy.github.io/program-design/)

`badge: verifies presence, not correctness`

program-design is a free, open-source reader for AI-built Next.js apps. When the
building agent says "done, I added login with rate limiting and saved the email
to the database," program-design parses the actual code, builds a facts graph
from raw source, and checks that claim against it — and puts a `file:line`
receipt under every statement. It also serves a live structure diagram you can
watch as the build proceeds.

It is **not** "a second AI that verifies the first" (a second model hallucinates
like the first). The verdict — CONFIRMED, ABSENT, or UNDETERMINED — is computed
deterministically from the code. The LLM only translates the claim in and
narrates the facts out, fenced by receipts.

## Quickstart

```bash
cd my-next-app
npx program-design live        # extracts, starts a local server, opens the diagram
```

No repo handy? Run it on the bundled sample app:

```bash
npx program-design demo        # same flow on a sample Next.js + Prisma repo
```

The Claude Code skill installs via `/plugin` (marketplace) or npx. The first
claim-time verification runs with **zero config and no API keys** — the narrator
runs inside your existing Claude Code session.

## How it works (three layers, one engine)

1. **Deterministic extractor (no LLM).** Parses raw source via the TypeScript
   compiler API into a structured facts graph: routes, middleware attachment,
   Prisma schema, env reads, dependencies, frontend→backend wiring. Honest by
   construction.
2. **Claim checker (deterministic verdict).** Translates a claim into a query
   over the graph and computes CONFIRMED / ABSENT / UNDETERMINED. The model never
   renders the verdict.
3. **Narrator (constrained, with receipts).** Writes facts in plain language;
   every statement is bound to a fact id that resolves to `file:line`. A
   statement with no fact to back it is dropped.

Read [docs/what-it-verifies.md](docs/what-it-verifies.md) first — it is the
headline.

## CLI

| Command | Does | Key flags |
|---|---|---|
| `live` | extract + serve + watch | `--port <n>`, `--no-open`, `--debounce <ms>`, `--ignore <glob...>` |
| `demo` | `live` on the bundled sample repo | `--port`, `--no-open`, `--debounce` |
| `check` | run claims against the graph | `--manifest <path>` (required), `--json` |
| `report` | render the last verdicts | `--json`, `--md <path>` |
| `export mermaid` | Mermaid diagram from the graph | `--out <path>` |
| `organize` | install an LLM-authored system map (fact-anchored) | `--from <map.json>`, `--tour <tour.json>`, `--reset` |
| `patterns` | show the recognized-pattern allowlist | `--category <cat>`, `--json` |
| `status` / `stop` / `restart` | daemon lifecycle | (`restart`: `--port`) |
| `doctor` | env / daemon / orphan checks, prints fixes | `--json` |

Global: `--repo <path>` (default cwd).

### Exit codes

`check` (and CI) follow:

| Code | Meaning |
|---|---|
| `0` | no ABSENT verdicts (no divergence) |
| `1` | at least one ABSENT verdict (a divergence) |
| `2` | tool error |

See [docs/ci.md](docs/ci.md) for a GitHub Actions example.

## Configuration

Drop a `program-design.config.json` at your repo root. Every field is optional:

```json
{
  "port": 4040,
  "debounce": 400,
  "ignoreGlobs": ["**/generated/**"],
  "authGuards": ["withMyAuth"],
  "daemon": { "autostart": true },
  "theme": { "--accent": "#5cc8ff" }
}
```

- `port` — server port (default 4040).
- `debounce` — watcher debounce in ms (default 400).
- `ignoreGlobs` — extra globs to ignore on top of the defaults
  (`node_modules`, `.next`, `dist`, generated).
- `authGuards` — extra auth-guard wrapper names to recognize for middleware.
- `daemon.autostart` — whether the skill auto-starts the daemon (default true).
  Set `false` to opt out of the local server.
- `theme` — CSS custom properties overriding the web view's visual defaults.

CLI flags always override config; config overrides defaults.

## Verify against your own spec

Agent claims define the audit scope, so omissions are invisible to them. To
check the code against **your** intent instead, hand-write a claim manifest
from your spec ("there is a POST /api/reset-password route", "the User model
has a resetToken column") and run it:

```bash
npx program-design check --manifest my-spec-claims.json
```

See [docs/claim-manifest.md](docs/claim-manifest.md) for the schema. Every
report footer reminds you the agent-claims mode is not a completeness audit.

## State & privacy

State lives in `~/.program-design/<repo-hash>/` (graph, ledger, port file,
verdicts) — **your repo is never polluted.** The server binds to **127.0.0.1
only**, requires a per-session token on every request, and records env variable
**names only, never values**. There is **no telemetry** — a trust tool does not
phone home.

## Docs

- [What it can and cannot verify](docs/what-it-verifies.md) — read this first.
- [Supported patterns](docs/patterns.md) — mirrors `program-design patterns`.
- [UNDETERMINED gallery](docs/undetermined-gallery.md) — worked examples of
  refused claims and why.
- [Claim-manifest schema](docs/claim-manifest.md) — drive the verifier from CI or
  a third-party agent.
- [CI usage](docs/ci.md) and [error catalog](docs/errors.md).
- [Contributing](CONTRIBUTING.md) — the corpus loop.

## FAQ

**Does it prevent hallucination?** No. It catches divergence between a claim and
the code, with a receipt you can open. It cannot stop an agent from claiming
things; it can stop you from believing the false ones.

**Is it a security scanner / linter / test runner?** No. Those check correctness
and quality. This checks presence and structure: does the claimed thing exist,
and where.

**What stacks?** Next.js App Router + Prisma at MVP. See
[docs/patterns.md](docs/patterns.md). Unsupported patterns resolve UNDETERMINED,
never a false ABSENT.

## License

MIT © 2026 piam.
