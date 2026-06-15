# Error catalog

Every terminal error program-design prints carries four things: a one-line
**problem**, the **cause**, a **fix** (a command where one exists), and a link to
the matching anchor on this page. The anchors below are the error codes, so a
link like `docs/errors.md#port-conflict` resolves to the right section. Error
codes and their docs links are CI-linted.

A user-facing error always looks like:

```
program-design error [port-conflict]
  Problem: The requested port is already in use.
  Cause:   Another process is bound to the port you asked for.
  Fix:     Pass a different port with --port <n>, or set "port" in program-design.config.json.
  Docs:    https://github.com/program-design/program-design/blob/main/docs/errors.md#port-conflict
```

All user-facing errors exit with code `2`.

---

## not-a-nextjs-repo

**Problem.** This directory does not look like a Next.js app.

**Cause.** No `app/` or `pages/` directory and no `next` dependency in
`package.json` was found at the repo root.

**Fix.** `cd` into your Next.js project, or pass `--repo <path>`. Try
`npx program-design demo` to run on the bundled sample app.

---

## unsupported-stack

**Problem.** This stack variant is not supported yet.

**Cause.** program-design ships Next.js App Router + Prisma at MVP. The detected
stack uses a schema/router source it cannot parse.

**Fix.** See the supported patterns: `npx program-design patterns`. Open an issue
with your stack so it can join the corpus.

---

## narrator-unavailable

**Problem.** The narrator (Claude Code CLI) is unavailable — showing the raw
verdict table.

**Cause.** program-design renders prose through your existing Claude Code session.
The CLI was not reachable, so it falls back to the deterministic table.

**Fix.** No action needed — verdicts are deterministic and unaffected. Re-run
inside a Claude Code session for narrated prose.

---

## stale-daemon

**Problem.** A stale or orphaned daemon was found for this repo.

**Cause.** `port.json` points at a process id that is no longer alive (the daemon
crashed or the machine restarted).

**Fix.** Run `npx program-design doctor` to clean it, or
`npx program-design restart`.

---

## port-conflict

**Problem.** The requested port is already in use.

**Cause.** Another process (possibly another program-design daemon) is bound to
the port you asked for.

**Fix.** Pass a different port with `--port <n>`, or set `port` in
`program-design.config.json`. `npx program-design status` shows the running
daemon.

---

## node-version

**Problem.** Your Node.js version is too old.

**Cause.** program-design requires Node.js >= 20 (ESM, NodeNext, native `fetch`).

**Fix.** Install Node 20 or newer (https://nodejs.org), then re-run.
`node --version` shows your current version.

---

## manifest-invalid

**Problem.** The claim manifest could not be read or validated.

**Cause.** The `--manifest` file is not valid JSON, or does not match the
`ClaimManifest` / `Claim[]` shape.

**Fix.** Validate the file against [claim-manifest.md](claim-manifest.md). Each
claim needs `id`, `category`, `predicate`, `subject`, `qualifiers`, `rawText`.

---

## graph-corrupt

**Problem.** The facts graph on disk is corrupt or unreadable.

**Cause.** `graph.json` failed to parse, or its `schemaVersion` does not match
this build. The graph is disposable by design.

**Fix.** Re-extract: `npx program-design live` (or `check` will rebuild
automatically). `npx program-design doctor` reports the mismatch.

---

## map-invalid

**Problem.** The authored system map could not be installed.

**Cause.** The `--from` file is not valid JSON, does not match the `SystemMap`
shape, or no node carries a file receipt that resolves to a real repo file (the
fact-anchor gate drops unanchored nodes — the organize pass cannot invent
structure).

**Fix.** Give each node `id`, `kind`, `label`, and `file:
"<repo-relative-path>:<line>"` pointing at code that exists.
`npx program-design organize --reset` falls back to the deterministic map.

---

## not-a-code-repo

**Problem.** This directory does not look like a JavaScript/TypeScript project.

**Cause.** No `package.json`, `tsconfig`, common source directory (`src`, `app`,
`lib`, …), or `.js`/`.ts` file was found at the repo root. The universal map
needs JS/TS code to read; deep verification (routes, schema, claims) additionally
needs Next.js + Prisma.

**Fix.** `cd` into your project, or pass `--repo <path>`. Try
`npx program-design demo` to run on the bundled sample app.
