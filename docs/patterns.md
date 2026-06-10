# Supported patterns

This page mirrors the recognized-pattern allowlist printed by
`program-design patterns`. The allowlist is the mechanism behind
*bias-to-undetermined*: **CONFIRMED and ABSENT are only ever emitted for
constructs on this list** and only when the graph shows the relevant extractor
rules actually ran. Everything off-list resolves UNDETERMINED by construction.

To see this list from the CLI:

```bash
npx program-design patterns
npx program-design patterns --category middleware
npx program-design patterns --json
```

## Allowlist by category

| Category | Predicate | Recognized | Extractor rules |
|---|---|---|---|
| route | exists | Next.js App Router: `app/**/page.tsx` or `app/**/route.ts` with a METHOD export | `routes/app-router-page`, `routes/app-router-handler` |
| middleware | attached | `middleware.ts` attachment via `config.matcher` or a recognized guard wrapper | `middleware/matcher`, `middleware/guard-wrapper` |
| schema | exists | Prisma model → `dbTable`, parsed from `schema.prisma` | `schema/prisma-model` |
| schema | has-column | Prisma model field → `dbColumn` + `hasColumn` edge | `schema/prisma-field` |
| env | reads | `process.env.NAME` read site → `envVar` node + `reads` edge | `env/process-env-read` |
| dep | installed | Dependency present in `package.json` | `deps/package-json` |
| wiring | wired | Client call whose URL resolves (literal / constant / helper) to a defined route | `wiring/literal-url`, `wiring/resolved-url` |

> Env extraction records variable **names only, never values** — the graph and
> reports are safe to share by construction.

## Middleware attachment tiers

Middleware attachment is not a boolean. The verdict maps conservatively across
four tiers; only the first two yield CONFIRMED/ABSENT, and "the middleware *works*"
is never claimable.

| Tier | Meaning | Maps to |
|---|---|---|
| `global-exists` | `middleware.ts` exists | structural fact, not attachment to a specific route |
| `matcher-includes` | `config.matcher` provably includes the route | CONFIRMED attachment; ABSENT if a complete matcher provably excludes it |
| `guard-wrapper` | a recognized auth/rate-limit wrapper is present (Clerk / NextAuth / Supabase helpers / `withAuth`, plus your `authGuards` config) | CONFIRMED a guard is present |
| `unconfirmed` | attachment semantics not confirmable (e.g. computed matcher) | UNDETERMINED |

You can widen recognized guard wrappers with `authGuards` in
`program-design.config.json`.

## Wiring confidence tiers

Frontend→backend wiring is also tiered. One boolean edge is forbidden — a match
records *how* it resolved.

| Tier | Example | Maps to |
|---|---|---|
| `literal` | `fetch("/api/login")` | CONFIRMED wire to a defined route |
| `constant-resolved` | `fetch(ROUTES.login)` where `ROUTES.login` is a literal const | CONFIRMED |
| `helper-resolved` | a recognized helper wrapper resolved to a literal URL | CONFIRMED |
| `sdk` | `supabase.from("users")` — an external SDK call | not a route wire; reported as SDK, not absence |
| `dynamic` | `` fetch(`/api/${name}`) `` — URL built at runtime | UNDETERMINED |

## What's not here (yet)

Anything not on the allowlist — Pages Router specifics beyond detection, Drizzle
or raw-SQL schema, dynamic route construction, runtime behavior — resolves
UNDETERMINED, never a false ABSENT. Next.js App Router + Prisma is the MVP stack;
local Supabase SQL migrations land second. If a pattern you rely on is missing,
that is a corpus contribution — see [CONTRIBUTING.md](../CONTRIBUTING.md).
