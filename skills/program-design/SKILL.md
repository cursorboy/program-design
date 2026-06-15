---
name: program-design
description: >-
  Verify completion claims against the actual code and view live project
  structure for AI-built Next.js apps. Use at claim time — whenever the building
  agent states it finished or added a feature ("I added login with rate
  limiting", "done, the signup route saves to the database") — to translate that
  summary into a structured claim manifest, run the deterministic verifier
  (`program-design check`), and present the verdict table verbatim with a
  receipt (file:line) under every statement. Also use to start the live
  structure view (`program-design live`) so the user can watch the diagram as
  the build proceeds. Verifies presence, not correctness.
---

# program-design

A deterministic, independent reader for AI-built Next.js apps. It parses raw
source into a facts graph and checks claims against it. **The verifier is
deterministic — the verdict (CONFIRMED / ABSENT / UNDETERMINED) is computed from
the code, never by an LLM.** Your job in this skill is to translate claims in and
narrate facts out. You must never write, edit, or soften a verdict.

> **verifies presence, not correctness.** This tool reports whether the thing the
> agent claimed exists in the code and how it is wired. It cannot say a feature
> "works" at runtime. Never imply otherwise to the user.

## When this skill activates

1. **Session start, Next.js repo (optional).** Offer to start the live structure
   view so the user can watch the build. Respect `daemon.autostart` in
   `program-design.config.json` (default true): if `false`, do not auto-start.
   Run: `npx program-design live` (it extracts, serves on 127.0.0.1, opens the
   diagram, and watches for changes).

2. **Plan mode finalized.** When a plan is locked in, emit the planned structure
   so the user sees the *intended* shape. See "Plan-time" below. The plan view is
   explicitly labeled "PLANNED — not yet verified"; it is NOT part of the
   determinism guarantee (plan parsing is LLM-mediated).

3. **Claim time — the core.** Whenever you (the building agent) state a completion
   claim, run the claim-time flow below before telling the user you are done.

## Plan-time: emit a PlanIntent

When a plan is finalized, write a `plan.json` to the state dir and refresh the
view. The state dir is `~/.program-design/<repo-hash>/`; you can resolve the path
with the CLI, or write directly. The shape:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-06-07T09:00:00.000Z",
  "source": "plan-mode",
  "nodes": [
    { "kind": "route", "name": "POST /api/login", "note": "authenticates a user" },
    { "kind": "dbTable", "name": "User", "note": "stores accounts" },
    { "kind": "middleware", "name": "rate-limit", "note": "on /api/login" }
  ]
}
```

`kind` is one of the EntityKind values (route, middleware, function, component,
dbTable, dbColumn, envVar, dependency, serverAction, clientCall, file). After
writing, the running daemon picks it up; if you have shell access you may also
trigger a refresh. The PLAN view is the agent's intention, not fact — say so.

## Claim time (the core flow)

When you are about to claim completion, do this BEFORE reporting done:

### Step 1 — Translate your own summary into a ClaimManifest

You are translating an UNTRUSTED summary (your own) into structured claims. The
verifier proves manifest-vs-code consistency; it does not know what you *should*
have built. Be honest and conservative.

**Translator instructions (follow exactly):**
- **Decompose compound claims.** "I added login with rate limiting and saved the
  email" → three claims: a login route exists; rate-limit middleware is attached
  to it; the schema has an email column.
- **Refuse behavior claims.** Anything about runtime correctness — "rate limiting
  works", "passwords are hashed correctly", "the form validates input" — is NOT
  expressible. Put it in `unverifiable` with a reason, never in `claims`.
- **Never invent claims.** Only claim what you actually stated you did. Do not add
  claims to look thorough. Coverage of what you *should* have built is not the
  job of this mode.
- Map each claim to a category + predicate:
  - route / exists — "there is a route handling X"
  - middleware / attached — "middleware M is attached to route X"
  - schema / exists — "table T exists"; schema / has-column — "T has column C"
  - env / reads — "env var E is read"
  - dep / installed — "dependency D is installed"
  - wiring / wired — "the frontend calls route X"
- Each claim: `{ id, category, predicate, subject, qualifiers, rawText }`.
  `subject` is normalized: for routes it is the **path only** (`/api/login`) with
  the HTTP method in `qualifiers.method`; for schema it is the table name; for env
  the variable name; for deps the package name. `rawText` is your original
  sentence verbatim.

Manifest shape:

```json
{
  "schemaVersion": 1,
  "sessionId": "<session id>",
  "source": "agent",
  "claims": [
    {
      "id": "c1",
      "category": "route",
      "predicate": "exists",
      "subject": "/api/login",
      "qualifiers": { "method": "POST" },
      "rawText": "I added a login route at /api/login"
    },
    {
      "id": "c2",
      "category": "middleware",
      "predicate": "attached",
      "subject": "/api/login",
      "qualifiers": { "middleware": "rate-limit" },
      "rawText": "with rate limiting on it"
    },
    {
      "id": "c3",
      "category": "schema",
      "predicate": "has-column",
      "subject": "User",
      "qualifiers": { "column": "email" },
      "rawText": "and saved the email to the database"
    }
  ],
  "unverifiable": [
    { "rawText": "rate limiting works", "reason": "behavior claim — presence-only tool" }
  ]
}
```

### Step 2 — Run the verifier

Write the manifest to a temp file and run:

```bash
npx program-design check --manifest /tmp/claims.json --json
```

Exit codes: `0` = no ABSENT, `1` = at least one ABSENT (a divergence), `2` =
tool error. The `--json` output has `{ summary, verdicts }`.

### Step 3 — Present the verdict table VERBATIM

Show the user the result without softening:
- Report ABSENT (diverged) claims first, with the search scope the verifier
  recorded. An ABSENT means the verifier searched the recognized patterns and the
  thing is provably not there.
- Show UNDETERMINED claims with the plain-language reason. UNDETERMINED means the
  parser hit something it cannot analyze (e.g. a dynamic route built from a
  string) — it is honesty, not failure. Never re-cast it as confirmed or absent.
- Show CONFIRMED claims with their receipts (`file:line`).
- Give the user the report URL (the running daemon serves it) so they can open
  every receipt themselves.
- Include the footer: "Checked N claims I made; this is not a completeness audit."

**You must never edit, soften, or re-interpret a verdict.** If the verifier says
ABSENT, you report ABSENT — even when it contradicts what you just claimed. That
contradiction is the entire value of the tool.

If the CLI is unavailable, `check` falls back to a raw verdict table; present
that table as-is and note the narrator was unavailable (verdicts are unaffected).

## Optional: the organize pass (a richer system map)

Every extraction already derives a deterministic system map (the layered
"screens → server → records → outside services" view, the How-it-works stories,
the What-looks-off concerns, and the guided tour). You can optionally upgrade it
with an authored map — better labels, hosting detail, richer stories.

1. Read the facts graph (`~/.program-design/<hash>/graph.json` or
   `GET /api/graph`) and the real source files. Work in clean context: read the
   code, not your own build transcript.
2. Write a `SystemMap` JSON (see `src/core/system-map.ts` for the shape):
   `what` (3-4 plain sentences), `nodes` (each with `id`, `kind`, `layer`,
   plain `label`, `technical`, and a **receipt** `file: "<path>:<line>"`),
   `edges` (`from`, `to`, plain `flows`, receipt), `dataFlows`
   (title + plain story), `concerns` (label, detail, receipt, severity).
   Optionally a `Tour` JSON (`beats` of `caption` + `reveal` node ids).
3. Install it:

   ```bash
   npx program-design organize --from map.json --tour tour.json
   ```

**Hard rules.** Every node and edge needs a receipt that resolves to a real
repo file — the installer **drops** anything unanchored (and fails closed if
everything is). Concerns must be presence statements ("I couldn't find…",
"I can't trace…"), never behavior judgments. `organize --reset` returns to the
deterministic map.

## Hooks

Live refresh is automatic via the file watcher started by `program-design live`,
so a PostToolUse hook is optional. A `Stop` hook can drive the claim-time flow
when you finish a turn. See `HOOKS.md` (next to this file) for examples and a
`hooks.json` snippet. When installed as a Claude Code plugin, the SessionStart
and Stop hooks are wired up automatically — nothing for the user to configure.

## Honest-claim disclaimer (always include)

- It verifies **presence, not correctness**. It says a route exists and what's
  wired to it; it never says the logic is right or the feature works.
- ABSENT is provable absence within recognized patterns, not "I didn't find it."
- UNDETERMINED is the honest state when analysis is defeated — and it is shown.
- This is not a completeness audit: it checks the claims the agent made, not the
  claims the agent should have made.
