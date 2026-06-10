<!-- /autoplan restore point: /Users/piam/.gstack/projects/programdesign/HEAD-autoplan-restore-20260607-005411.md -->
# PLAN: Program Design

A free, open-source Claude Code skill with two connected capabilities:

1. **Live structure visualization** — view the project structure as Claude Code builds it.
   From plan mode, see the *planned* structure Claude Code is theorizing, at its own
   hosted/local link. As Claude Code actively builds, the diagram updates to show what
   the structure is becoming.
2. **Groundtruth verification layer** — an independent reader that, when the building
   agent claims it did something, parses the actual code, builds a facts graph from raw
   source, checks the agent's claims against it, and produces a plain-language report
   where every statement points to the line of code behind it.

The one-line claim: every statement about your code points to a line you can open and
check yourself. Not: "prevents hallucination."

> RESOLVED (premise gate, 2026-06-07): **One engine, two surfaces.** Claim-time
> verification is the trust core and the defensible market gap; the live structure
> view (plan-mode intent view + build-time actual view) ships in MVP as the adoption
> hook. Both surfaces render only the deterministic facts graph — the LLM never draws
> the diagram. The original PRD's "not a continuous live animation" is superseded for
> the display surface only; the *verifier* still runs at claim time.

---

## 1. The problem

People build with AI agents and cannot verify what got built. The agent says "done, I
added login with rate limiting and saved the email to the database," and the user
believes it. Sometimes it's true. Sometimes the rate limiting is missing, the email is
logged but never stored, or the route the agent described does not exist. A
non-technical or semi-technical builder has no way to catch this, because catching it
means reading the code, which is the thing they can't do.

This gap is real and money-backed. A YC company (Floot) is built on the same
observation: non-coders build with AI, hit something they don't understand, and abandon
the project. The difference here is the angle. Floot is a paid platform that owns the
whole build. Program Design is a free, separate verification layer that sits beside
whatever the agent built and tells the user what's actually there.

A second, related gap: builders cannot *see* what is being built while it is being
built. Plan mode produces a textual plan; the user has no structural picture of what
the agent intends, and no picture of the structure taking shape during execution.

## 2. What it is, and what it is not

It is an independent reader. It does not build, edit, or fix code. It reads finished or
in-progress code and reports on it. The separation is the point: a tool that both
builds and grades its own work is not a verifier.

Verification is triggered at claim time. When the building agent says it's done or
claims a specific feature, the verifier runs and checks that claim against the code.

Visualization is continuous-ish: the structure diagram refreshes as files change during
a build, and a planned-structure view renders from plan mode before any code exists.
The diagram of *actual* structure is generated only from the deterministic facts graph,
so it is honest by construction. The diagram of *planned* structure is clearly labeled
as the agent's intention, not as fact.

It is not a security scanner, a linter, or a test runner. Those check correctness and
quality. This checks existence and structure: does the thing the agent claimed actually
exist in the code, and where.

## 3. The honest claim, and the two overclaims to avoid

Overclaim one: "a second AI verifies the first." A second LLM reading code can
hallucinate exactly like the first. Stacking models does not produce truth. This is why
the ground-truth layer is not an LLM call (Section 4).

Overclaim two: "static analysis proves the code is correct." It does not. Parsing the
code tells you what is present and how it is wired. It cannot tell you whether the
logic is right or the feature actually works at runtime. The tool can say "there is no
rate-limit middleware attached to this route." It cannot say "rate limiting works
correctly."

The true claim: every statement the tool makes is backed by a specific line of code the
user can open. The user does not have to trust the tool. They can see the evidence.

## 4. Architecture

Three layers for verification, plus a display surface. The verdict is deterministic.
The model only translates in and narrates out, fenced in by facts.

### Layer 1: deterministic extractor (ground truth, no LLM)

Parses raw source and emits a structured facts graph. No model involved.

Extracts, all deterministically:
- File and folder structure.
- Routes and endpoints that are defined.
- Functions and classes, their exports and imports.
- The call graph, within the limits of static analysis.
- Database schema from migrations or ORM models: tables, columns, relations.
- Environment variables that are read.
- Dependencies from manifest and lock files.
- Which middleware is attached to which route.
- Frontend-to-backend wiring, where a client call's URL can be matched to a defined route.

Tooling: tree-sitter for uniform ASTs, plus native tooling where better (TypeScript
compiler API, Python ast). Do not hand-roll parsers.

### Layer 2: claim checker (deterministic verdict)

Takes a claim and checks it against the facts graph. The model's one job: translate the
claim into a structured query over the graph. The verdict — present, absent, or
undetermined — is computed deterministically from the graph. The model never renders
the verdict.

### Layer 3: narrator (constrained, with receipts)

Takes facts and verdicts and writes them in plain language. Hard constraints, enforced:
- It may only assert things that exist in the facts graph.
- Every statement carries a code reference: file and line.
- If it has no fact to back a statement, it does not make the statement.

### Display surface: live structure view

- A local web view (its own link, e.g. localhost) that renders the structure diagram.
- Plan-mode view: renders the planned structure parsed from the plan, labeled as plan.
- Build-time view: watches the working tree; on file change, re-runs the (incremental)
  extractor and refreshes the actual-structure diagram.
- Claim-time view: renders the verification report with receipts.

### Separation

The verifier reads the code cold. It sees the source files and the specific claim to
check. It does not see the building agent's chain of thought, because if it does, it
inherits the builder's bias. Implement as a Claude Code subagent with clean context, or
a separate process the skill invokes.

## 5. The three states

- Confirmed present, with a receipt.
- Confirmed absent: the extractor searched and the thing is deterministically not there.
- Undetermined: the parser hit something it cannot analyze — dynamic dispatch, a route
  built from a string, reflection, an unsupported pattern.

The tool must never report "absent" when it means "I did not find it." When in doubt,
the verdict is undetermined, and it says so plainly. Precision matters more than
coverage.

## 6. Output

- The claims that were checked.
- For each: confirmed, absent, or undetermined, in plain language.
- Divergences surfaced first.
- A structural diagram generated from the facts graph — honest by construction.
- Receipts under everything.

The diagram is how you show the facts. The product is the claim-versus-reality diff.

## 7. Scope

MVP:
- One stack, end to end: Next.js with Supabase or Prisma.
- Layer 1 extractor for that stack: structure, routes, schema, env, deps, middleware
  attachment, imports.
- Three-state claim checker.
- Constrained narrator with receipts.
- Readable report and structural diagram.
- Local web view serving the diagram (plan-mode view + build-time refresh + report view).
- Triggered as a Claude Code skill at claim time; visualization hooks for plan/build time.

Accepted scope expansions (CEO review, 2026-06-07):
- Claim ledger: append-only JSONL of every claim, verdict, and receipt per session.
- Graph diff in live view: show added/removed routes/files/tables since last refresh.
- Undetermined explainers: every "undetermined" verdict shows the exact code pattern
  that defeated analysis, so honesty is inspectable.
- Diagram export: Mermaid/SVG from the facts graph for READMEs and PRs.
- Regression re-verification (ACCEPTED at final gate, 2026-06-07): re-check
  previously confirmed claims on each graph change; alert in the live view when a
  previously verified feature disappears. Runs over the claim ledger.

Non-goals:
- Not language-agnostic. One stack first.
- Not a correctness, security, or quality checker.
- No runtime behavior claims. Presence and structure only.
- No fixing or editing. Read only.
- No persistence, accounts, or hosted service at MVP (the "hosted link" is a local
  server; cloud hosting is a later decision).

## 8. Tech stack

- Skill layer: a Claude Code skill that invokes the verifier as a clean-context
  subagent or separate CLI process; hooks for plan-mode and build-time visualization.
- Extractor: TypeScript, the TS compiler API via ts-morph (locked at final gate;
  tree-sitter re-enters with the second language).
- Facts graph: structured JSON IR. The contract between extractor and narrator. Define
  it before writing either side.
- Narrator: constrained Claude call consuming only the facts graph and the claim,
  required to emit line references.
- Display: markdown report, plus a simple local web view for the interactive diagram.

## 9. Build plan

- Phase 0: design the facts-graph schema.
- Phase 1: the extractor for one stack. JSON out. No LLM. Prove correctness on a real repo.
- Phase 2: the claim checker with three honest states.
- Phase 3: the narrator with the receipt constraint.
- Phase 4: the report and the diagram from the graph.
- Phase 5: wire into Claude Code as a claim-time skill in clean context.
- Phase 6: live view — local server, file watcher, plan-mode structure parse.

If Phase 1 doesn't produce a correct facts graph on a real Next.js repo, nothing
downstream matters.

## 10. Success metrics

- Precision on verdicts: near zero false "absent" calls.
- Real divergences caught.
- Honest undetermined rate.
- Adoption and repeat use among founders/builders coming off tools like Lovable.

Anti-metrics: coverage at the expense of precision; a high "confirmed" count.

## 11. Risks

- False "absent" verdicts — top risk. Mitigation: three-state model, bias to undetermined.
- Behavior overclaim. Mitigation: presence and wiring only, never "it works."
- Narrator drift. Mitigation: receipt constraint, enforced.
- Per-stack brittleness. Mitigation: one stack, deep; honest undetermined on unknowns.
- Scope creep to language-agnostic. Mitigation: resist a second stack.
- NEW: live-view scope creep — the visualization becoming the product and starving the
  verifier. Mitigation: the diagram renders only what the extractor emits; no separate
  "pretty" data path.

## 12. Open decisions

- Where claims come from: RESOLVED at final gate (2026-06-07) — agent claims for MVP
  (user's original direction stands over the models' intent-vs-code challenge), with
  two standing mitigations: `check --manifest` lets users hand-author claims against
  their own spec today, and every report footer discloses "this is not a completeness
  audit." Spec-vs-code mode is the first post-MVP move (TODOS.md, P2).
- Stack variant: RESOLVED at final gate (2026-06-07) — Prisma first (unambiguous DSL
  protects the 0-false-absent bar); Supabase narrowed to local SQL migrations lands
  second. Drizzle deferred.
- Plan-mode structure source: parse the plan text for intended files/routes, vs require
  the agent to emit a structured manifest.
- Output surface: RESOLVED — local web view with interactive diagram + markdown report.
- Live update mechanism: RESOLVED — Claude Code PostToolUse hooks as primary trigger,
  file-watcher as fallback, 300-500ms debounce, incremental per-file re-extraction.

---

## CEO Review Outputs (2026-06-07, via /autoplan)

### Canonical verdict states & quality bars
See the CEO plan artifact (~/.gstack/projects/programdesign/ceo-plans/2026-06-07-program-design.md)
for the canonical CONFIRMED / ABSENT / UNDETERMINED definitions, the claim input
contract (structured manifest, fenced translator), and the narrator contract
(fail-closed receipt lint). Two quality bars are release-governing:
- **0 false ABSENT verdicts** on the fixture corpus (≥50 claims, real Next.js repo,
  adversarial cases). A false absent is a release blocker, enforced in CI.
- **Usefulness floor:** ≥70% of corpus claims resolve CONFIRMED or ABSENT, measured
  at end of build Phase 2. Below the floor → stop, rethink extraction before
  building the narrator and live view.

### Hardening decisions (auto-accepted, S-effort, in blast radius)
1. Server lifecycle: daemon with port file, auto-start by skill, idle shutdown,
   health endpoint; binds **127.0.0.1 only**.
2. Incremental per-file re-extraction, 300-500ms debounce; full-reparse budget
   ~2s/1k files, incremental <200ms.
3. Live-view staleness: "last updated" timestamp + STALE banner when watcher dies
   or parse fails. Last-good graph shown, never a flickering half-graph.
4. Env extraction records variable NAMES only, never values. Graph and reports are
   safe to share by construction.
5. Receipt code-snippet serving jailed to repo root, read-only.
6. Narrator degradation: if the CC CLI is unavailable, emit the raw verdict table.
7. Empty states: zero-claims report ("no checkable claims made"), empty-repo live
   view, reconnect banner when the server dies.
8. Mermaid level-of-detail: directory-clustered rendering for large graphs.
9. `program-design doctor` command; `--verbose` extraction logging.
10. GitHub Actions CI: fixture corpus on every PR; npm publish pipeline for the CLI;
    skill install via npx/marketplace.
11. `schemaVersion` field in the facts-graph IR from day one.
12. ts-morph (TS compiler API) only at MVP; tree-sitter deferred to second language.

### Error & Rescue Registry
| Codepath | Failure | Rescue | User sees |
|---|---|---|---|
| extractor.parseFile | syntax error mid-build | UNDETERMINED for affected scope | amber node + explainer |
| watcher | crash / missed event | staleness detection | "last updated" + STALE banner |
| claim translator (LLM) | malformed/ambiguous output | retry 1x → UNDETERMINED | original claim text shown |
| narrator (LLM) | sentence without receipt | lint drops sentence, flags | "1 statement removed (no receipt)" |
| narrator (LLM) | CC CLI unavailable | raw verdict table fallback | table, no prose |
| server.start | port in use | next free port + port file | URL printed |
| graph load | corrupt JSON | full re-extract (graph is disposable) | brief "rebuilding" |
| claim manifest | unexpressible category | UNVERIFIABLE-BY-DESIGN | explicit line in report |

### Failure Modes Registry
| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| extractor | parse failure | Y | corpus | amber + explainer | Y |
| extractor | wrong route detection (false absent) | N — by design a bug | corpus (release gate) | wrong red verdict | Y |
| checker | category mismatch | Y (UNVERIFIABLE) | unit | explicit | Y |
| translator | hallucinated manifest | Y (fence: ambiguous→UNDETERMINED) | eval suite | amber | Y |
| narrator | drifted assertion | Y (receipt lint, fail closed) | lint tests | flagged removal | Y |
| live view | stale graph shown as fresh | Y (stale banner) | e2e | banner | Y |
| server | LAN exposure | Y (127.0.0.1 bind) | unit | n/a | n/a |
CRITICAL GAP count: 0 (extractor false-absent is the residual risk; mitigated by
corpus + CI release gate, not rescuable at runtime by definition).

### NOT in scope (MVP)
- Correctness/behavior/runtime claims; security scanning; linting; test running.
- Fixing or editing code (read-only; remediation belongs to the building agent).
- Second stack / language-agnostic support (and tree-sitter until then).
- Cloud hosting, accounts, persistence beyond local files; shareable cloud links.
- VS Code extension. SVG export. Schema-as-platform guarantees for external tools.
- Spec-vs-code verification mode (final gate: deferred per user's original direction).

### What already exists (leverage, greenfield repo)
- ts-morph / TS compiler API (exports, imports, call graph) — reuse, never hand-roll.
- Next.js App Router filesystem conventions — routes are deterministically derivable.
- Prisma schema DSL / Supabase SQL migrations — parseable schema sources.
- Claude Code hooks (PostToolUse, Stop, plan mode) — trigger surface.
- Mermaid — diagram rendering. chokidar — watcher fallback. Hono/node http — server.
- Prior art to study, not rebuild: dependency-cruiser, madge (graph extraction shape).

### Why not X (alternatives interrogated, from dual-voice review)
- **Why not tests as the verifier?** Generated tests check behavior but are themselves
  agent-written code — the agent grading its own work, the exact failure the product
  exists to avoid. Tests also require a runnable app; the facts graph works on broken
  builds. Complementary, not substitute. (Acknowledged: behavior is where much pain
  lives — that is the explicit P3 trade.)
- **Why not just show the diff?** Diffs show what changed, not what's true. They don't
  answer "is rate limiting attached to this route now," and non-coders can't read them.
- **Why not existing graphers (dependency-cruiser, SCIP, Nx)?** None model Next.js
  route/middleware/schema semantics or three-state claim checking; module-import edges
  alone can't answer claim queries. Reuse their extraction patterns where licenses allow.

### Dream state delta
This plan lands: one deterministic engine, three projections (plan view, live view,
claim report), one stack, fixture-corpus-gated quality. 12-month ideal adds: regression
re-verification always-on (pending gate), spec-vs-code mode, schema-as-platform, a
second stack only after stack #1 is loved. The plan moves toward the ideal; nothing
in it forecloses the ideal.

## Engineering Hardening (Eng Review, 2026-06-07, via /autoplan)

### Determinism mechanics (how "bias to undetermined" becomes architecture)
1. **Pattern allowlist:** CONFIRMED/ABSENT are only ever emitted for constructs on an
   explicit recognized-pattern allowlist per category; everything off-list is
   UNDETERMINED by construction. The allowlist is a versioned, documented artifact.
2. **ABSENT carries search scope:** every ABSENT verdict records what was searched
   (which conventions, which directories, which matchers) — provable absence only.
3. **Transient unresolved references:** during an active build, a reference to a
   not-yet-existing file/module resolves UNDETERMINED ("transient unresolved"),
   never ABSENT. Tested under rapid sequential writes.
4. **Middleware attachment tiers:** global-exists → matcher-includes-route →
   recognized-guard-wrapper (Clerk/NextAuth/Supabase helpers/withAuth) →
   semantics-not-confirmed. Tiers map conservatively to the three states; "rate
   limiting works" is never claimable (P3).
5. **Wiring confidence tiers:** literal URL → constant-resolved → helper-resolved →
   SDK/external → dynamic (UNDETERMINED). One boolean edge is forbidden.
6. **Env model:** name + exposure class (NEXT_PUBLIC_ vs server-only); values never.
7. **Floor precedence:** 0-false-ABSENT is inviolable; the ≥70% usefulness floor may
   only be met by legitimately widening the allowlist, never by relaxing
   undetermined-bias. Floor is measured only after the false-ABSENT gate passes.

### Facts-graph IR requirements (Phase 0 additions)
- **Core/projection split:** core facts layer (what the checker reasons over,
  schemaVersion-gated) strictly separated from display projections (node shapes,
  LOD clusters, diff baselines) computed in the server. Verdict logic depends only
  on core. Display churn never touches ground truth.
- **Edge provenance:** every edge records source location, extractor rule id,
  confidence tier, and invalidation sources. Undetermined explainers and the
  narrator lint both consume provenance.
- **Dependency-aware invalidation model** defined WITH the schema: per-fact
  invalidation sources plus global invalidators (next.config, tsconfig paths,
  package.json, prisma schema, middleware matcher, route rename/delete).
  Invariant: incremental extraction == full re-extraction, asserted in CI after
  every corpus mutation.

### Runtime/infra hardening
- Watcher backpressure: ignore-globs (node_modules, .next, dist, generated),
  coalesce-to-latest bounded queue; sustained churn degrades to STALE banner,
  never silently falls behind. MVP ceiling: ~5k source files (corpus reflects it).
- Daemon identity: port file = {repo root, PID, session nonce, version}; liveness
  + ownership validated before reuse; one daemon per repo root; `doctor` detects
  orphans. Server requires the session token on every request (defeats
  DNS-rebinding/local cross-origin), validates Host header, realpath-canonicalizes
  the snippet jail and rejects symlink escapes. Honest limitation documented:
  snippet contents are not secret-scrubbed.
- Hook lifecycle state machine: plan-captured → build-active → extraction-pending
  → extraction-stable → claims-received → verdicts-streamed → report-finalized.
  PostToolUse ≠ filesystem stable; Stop may precede watcher flush — both tested.

### Narrator (upgraded from sentence lint to statement binding)
Narrator output is a list of statements, each bound to a fact ID; the renderer maps
fact IDs to file:line. Lint validates the fact's predicate supports the statement
(not merely that a citation exists). A failed statement drops whole — partial drops
that could invert meaning are structurally impossible. Claim translation is graded
by an eval suite: compound-claim decomposition, vague-claim handling, behavior-claim
refusal, adversarial inference bait.

### Trust-boundary clarifications (from both voices)
- The building agent is the UNTRUSTED party; a manifest it emits is untrusted input.
  What the verifier proves is manifest-vs-code consistency. Coverage of what SHOULD
  have been claimed is NOT guaranteed by agent-claims mode — stated in every report
  footer ("checked 7 claims the agent made; this is not a completeness audit").
  Full resolution = spec-vs-code mode (final-gate user challenge).
- PLAN view facts are NOT deterministic (plan text parsing is LLM-mediated at MVP).
  The PLAN view is explicitly carved out of the determinism guarantee and its banner
  says so. LIVE and REPORT render only the deterministic graph.

### Worktree parallelization strategy
| Step | Modules touched | Depends on |
|------|----------------|------------|
| Schema + invalidation model (Phase 0) | packages/core/schema | — |
| Extractor + corpus (Phase 1) | packages/core/extract, fixtures/ | Phase 0 |
| Checker + ledger (Phase 2) | packages/core/check | Phase 0 (schema), Phase 1 (graph) |
| Narrator + lint (Phase 3) | packages/core/narrate | Phase 2 |
| Server + views (Phase 4/6) | packages/server | Phase 0 (core read API) |
| Skill + hooks (Phase 5) | skill/ | Phase 2 (checker CLI) |
Lanes: A: Phase 0 → 1 → 2 → 3 (sequential, shared packages/core). B: server/views
scaffold + state machine (parallel after Phase 0, mock graph fixture). C: skill/hooks
(parallel after Phase 2). Launch B in a worktree once the schema lands; merge before
Phase 6 wiring. Conflict flag: B and A both touch packages/core/schema.ts at the
start — land Phase 0 first, then fan out.

## Design Specification (Design Review, 2026-06-07, via /autoplan)

### Surface model & navigation (resolves report-vs-diagram ambiguity)
ONE local web app, three views (tabs): PLAN · LIVE · REPORT. Markdown report is an
export artifact, not the primary read surface. Context-priority on open: claims exist
→ REPORT; active build, no fresh claims → LIVE; plan mode → PLAN. Clicking a graph
node shows its related claims; clicking a claim highlights its evidence nodes.

### Report information hierarchy (first paint, top to bottom)
1. Verdict bar: "3 of 7 claims confirmed · 2 absent · 2 undetermined" + session
   coverage indicator ("9/10 claims were checkable").
2. Diverged (ABSENT) claims, EXPANDED by default, receipt visible, each with
   copyable "ask the agent to fix it" text.
3. UNDETERMINED group, collapsed: plain-language reason first ("I can't safely
   confirm this from the code — here's what to check"), defeating code pattern
   behind an expand (technical disclosure, not the lead).
4. CONFIRMED group, collapsed (counts visible — never buries absences).
5. Structural diagram.
Permanent header badge on every view: "verifies presence, not correctness."
All-confirmed sessions get a deliberate relief state: "Everything the agent claimed
is in the code. 7/7 receipts." — affirmative, not an empty alarm panel.

### Receipt interaction (the load-bearing UI)
Each assertion: plain-language evidence summary → `file:line` chip → expands to
inline read-only snippet (±2 lines, jailed to repo root). Secondary: copy path.
Optional: editor deep-link (vscode://) when available. The receipt must be useful
to someone who cannot open an IDE.

### Planned-vs-actual distinction (the trust boundary, never "just a label")
PLAN view nodes: dashed outline + desaturated + persistent banner "PLANNED — not
yet verified" in a distinct neutral color. When a planned node becomes real and
verified, it transitions to solid (animated, respects reduced-motion). PLAN and
LIVE never blend in one canvas at MVP.

### Verdict encoding (never color alone)
CONFIRMED: green + solid node + ✓ · ABSENT: red + ring node + ✕ · UNDETERMINED:
amber + dashed node + ?. Text labels on hover/focus and in the report always.
Contrast ≥4.5:1 on all badges/banners; amber checked specifically.

### Interaction state table
| Surface | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL/STALE |
|---|---|---|---|---|---|
| LIVE | first-parse skeleton + per-category progress ("routes 12 · tables 4…") | empty-repo: "No supported app structure yet — the diagram grows as Claude builds." | server dead → reconnect banner | graph + "updated 3s ago" | last-good graph + STALE banner; failed-parse scopes rendered amber |
| REPORT | "Verifying claims…" on hook fire; deterministic verdicts stream in as resolving dots BEFORE narrator prose | "No checkable claims this session — claims appear when the agent reports completing a feature." | narrator down → raw verdict table, same hierarchy | relief state (all confirmed) | translator retry → that claim shows amber pending |
| PLAN | "Reading the plan…" | "No planned structure detected in this plan." | parse fail → "Couldn't derive structure from this plan" + raw plan link | intent diagram + banner | n/a |

### Graph-diff motion design
Additions: accent highlight, fades over ~8s. Removals: strikethrough 3s, then drop.
Baseline = last claim event (not the 300-500ms debounce tick). Reduced-motion: static
"new"/"removed" badges instead of fades. Motion exists only to show hierarchy/change.

### Diagram semantics (legend required in UI)
Shape per entity type: route (rounded rect) · middleware (hexagon) · DB table
(cylinder) · env var (tag) · dependency (pill) · page/component (rect). Middleware
attachment = labeled edge to route. Frontend→backend wiring: solid edge when matched,
dashed gray "unmatched call" when not. Directory clustering at zoom-out (LOD).

### Responsive strategy (intentional, not afterthought)
Primary habitat: docked side window next to editor/terminal — min target 480px wide.
Desktop full: split layout (canvas + inspector). Narrow (<640px): verdict list first,
collapsible tree replaces dense graph, receipts open as drawer. Mobile is a reader,
not a workspace.

### Accessibility minimums (requirements, not aspirations)
Keyboard: all nodes/claims reachable, visible focus, verdict filters operable without
pointer. Touch targets ≥44px. Reduced-motion mode. Report and verdict table fully
screen-reader navigable (verdicts announced as text). No color-only meaning anywhere.

### Anti-slop build constraints
No purple/violet gradients; no icon-in-colored-circle grids; no stacked-card app UI —
layout over cards; one accent color; real typeface (suggested default: IBM Plex Sans +
IBM Plex Mono for receipts — TASTE: override freely); calm dark-leaning developer
surface; cards only where the card IS the interaction (claim rows).

### Progressive disclosure (added 2026-06-07 — resolves User Challenge 1)
The default audience is non-technical; depth is opt-in per interaction. Three levels,
header toggle, persisted per state dir:
- **Plain (default):** no diagram, no jargon. LIVE renders deterministic FLOW STRIPS
  derived from the facts graph (page → clientCall → route → middleware guard →
  persistsTo table), in plain sentences with friendly chip labels. Flows that cannot
  be traced say so honestly ("I can't trace where this goes" — same undetermined
  discipline). REPORT leads with plain verdict sentences.
- **Map:** the structure diagram with friendly group labels + plain-language legend
  ("Endpoints — doors other software uses to talk to your app").
- **Technical:** the full existing view — tiers, ruleIds, receipts, raw JSON.
Teaching layer: every concept chip (page, endpoint, middleware, table, env var,
dependency) opens a learn popover: plain definition → "in YOUR app: <real instance>"
→ why it matters → "show me the code" (lands on the receipt — curiosity is the path
into technical depth). docs/learn.md is a gentle system-design primer using the
user's own stack. All flow content is a display PROJECTION of the deterministic
graph — the LLM still never draws anything.
Core addition: persistsTo extractor (route/page file with member access on an
imported prisma/db client matching a dbTable name → persistsTo edge with receipt) so
"saves to your User records" is a fact, not a guess.

### Design debt / follow-ups
No DESIGN.md exists — run /design-consultation before implementation polish. Designer
mockups skipped this run (gstack designer needs OpenAI key — run `design setup`).

## DX Specification (DX Review, 2026-06-07, via /autoplan)

### Quickstart contract (TTHW: Champion tier, ≤2 minutes, ≤3 commands)
```bash
cd my-next-app
npx program-design live        # extracts, starts local server, opens the diagram
# or, no repo handy:
npx program-design demo        # same flow on the bundled sample repo
```
Skill install: `/plugin` marketplace or npx — first claim-time verification runs with
zero config. No API keys (the narrator runs inside the user's existing CC session).
TTHW is measured in CI against the sample repo; >2min is a regression.

### CLI command matrix (verb-first, one convention)
| Command | Does | Key flags |
|---|---|---|
| `live` | extract + serve + watch | `--port`, `--no-open`, `--debounce`, `--ignore <glob>` |
| `demo` | `live` on bundled sample repo | — |
| `check` | run claims against graph | `--manifest claims.json`, `--json` |
| `report` | render last verdicts | `--json`, `--md <path>` |
| `export` | diagram export | `mermaid --out <path>` |
| `patterns` | show recognized-pattern allowlist | `--category middleware` |
| `status` / `stop` / `restart` | daemon lifecycle | — |
| `doctor` | env/daemon/orphan checks, prints fix commands | `--json` |
Exit codes: 0 = all confirmed · 1 = divergence (ABSENT) found · 2 = tool error.
`--json` on every read command (agent/CI ergonomics). Config file
`program-design.config.json`: port, debounce, ignoreGlobs, additional auth-guard
patterns, daemon.autostart, theme (CSS custom properties — the documented override
for the visual defaults).

### User-facing error catalog (CI-linted like receipts)
Every terminal error = problem + cause + fix + docs link. Catalog includes at minimum:
not a Next.js repo · unsupported stack variant · CC CLI unavailable (narrator
fallback notice) · stale/orphaned daemon · port conflict · Node version · install
failure. Docs-link presence is a CI check.

### Docs IA (load-bearing for a trust tool)
1. README: quickstart first block, then the headline caveat page link.
2. "What it can and cannot verify" — presence-not-correctness is the docs HEADLINE.
3. Supported patterns — generated from the versioned allowlist artifact.
4. UNDETERMINED gallery — worked examples of refused claims and why (sets
   expectations before the first amber verdict, not after).
5. Claim-manifest JSON schema reference + minimal example (third-party agents/CI
   can drive the verifier without the CC skill: `check --manifest claims.json`).
6. CI usage (exit codes, --json), troubleshooting, CONTRIBUTING.

### Upgrade & versioning policy
Semver. Changelog required per release. Claim-manifest schema: compatibility promise
within major. Graph cache: version mismatch → silent rebuild (disposable by design —
upgrades cannot corrupt state). Deprecations warn one minor ahead.

### Skill/daemon consent & state
First-run notice when the daemon auto-starts (one-time, marker file, reversible via
`daemon.autostart=false`). State lives in `~/.program-design/<repo-hash>/` (graph,
ledger, port file) — the user's repo is never polluted. Ledger is append-only JSONL.

### Community & measurement
MIT. CONTRIBUTING is built around the corpus loop: every real-world false ABSENT
becomes a contributed fixture case (community grows the adversarial corpus).
Deliberately NO telemetry — stated in docs; a trust tool doesn't phone home.
Feedback path: issue template that asks for `doctor --json` output.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Approach A: TS CLI engine + thin skill wrapper | Mechanical | P1,P5 | B (prompt extraction) violates determinism premise; C (hosted) violates non-goals | B, C |
| 2 | CEO | Claim ledger → accepted | Mechanical | P2 | blast radius, <1d CC | — |
| 3 | CEO | Graph diff in live view → accepted | Mechanical | P2 | display delta over watcher data | — |
| 4 | CEO | Undetermined explainers → accepted | Mechanical | P1 | completes three-state honesty | — |
| 5 | CEO | Diagram export narrowed to Mermaid-only | Mechanical | P3,P5 | one render target keeps it <1d | SVG at MVP |
| 6 | CEO | Spec-vs-code mode → deferred | User Challenge → gate | P3 | PRD chose agent claims; BOTH models object | — |
| 7 | CEO | Second stack → rejected at MVP | Mechanical | non-goal | named death-by-scope path | — |
| 8 | CEO | Cloud links → deferred | Mechanical | P3 | hosted service is a stated non-goal | — |
| 9 | CEO | VS Code extension → deferred | Mechanical | P3 | outside blast radius | — |
| 10 | CEO | Regression re-verification → ACCEPTED | Taste, APPROVED at gate | P2 borderline | 3-5 files; Codex argues strongly to include | — |
| 11 | CEO | Usefulness floor ≥70% kill criterion | Mechanical | P1 | both voices flagged undetermined-paralysis | no threshold |
| 12 | CEO | Structured claim manifest contract | Mechanical | P5 | NL→graph translation is the failure point; fence it | free-text NL parsing |
| 13 | CEO | Narrator fail-closed receipt lint | Mechanical | P1 | drift mitigation, verdicts immutable | trust-the-model |
| 14 | CEO | ts-morph only; tree-sitter deferred | Taste, APPROVED at gate | P3,P5 | deviates from PRD §8 ("tree-sitter plus TS API"); one language = one parser | dual tooling now |
| 15 | CEO | Hardening 1-11 (lifecycle, incremental, staleness, env names, jail, empty states, LOD, doctor, CI, schemaVersion) | Mechanical | P1,P2,P5 | all S-effort, in blast radius | — |
| 16 | CEO | Server binds 127.0.0.1 only | Mechanical | security | LAN leak of code structure | 0.0.0.0 |
| 17 | Design | One app, 3 tabs, context-priority on open | Mechanical | P5 | both voices: surface model ambiguous | separate surfaces |
| 18 | Design | Report hierarchy stack + session coverage indicator | Mechanical | P1 | first paint undefined; floor must be visible | diagram-first |
| 19 | Design | Receipt = summary-first + chip + inline snippet | Mechanical | P1 | load-bearing UI had no design | bare file:line text |
| 20 | Design | Planned-vs-actual: dashed+desaturated+banner+transition | Mechanical | P1 | trust boundary was one word | small label |
| 21 | Design | Verdicts encoded color+shape+text | Mechanical | P1 | colorblind users; never color-alone | color-only |
| 22 | Design | Stream deterministic verdicts before narrator prose | Mechanical | P5 | two LLM round-trips of silence otherwise | spinner-until-prose |
| 23 | Design | All-confirmed relief state + ask-agent-to-fix copy | Mechanical | P1 | missing emotional payoff; actionability | alarm-only tool |
| 24 | Design | Visual defaults (IBM Plex, dark-leaning, one accent) | Taste, APPROVED at gate | P5 | overridable aesthetic defaults | — |
| 25 | Design | Docked-panel responsive strategy + a11y minimums | Mechanical | P1 | real habitat is a 480px side window | desktop-only canvas |
| 26 | Eng | Pattern allowlist; ABSENT requires recorded search scope | Mechanical | P1 | mechanizes bias-to-undetermined | judgment-call absents |
| 27 | Eng | Transient unresolved refs → UNDETERMINED never ABSENT | Mechanical | P1 | timing false-absents during write-bursts | naive resolution |
| 28 | Eng | Dependency-aware invalidation + incremental==full CI invariant | Mechanical | P1 | cross-file facts go stale silently otherwise | per-file-only refresh |
| 29 | Eng | Core/projection IR split + edge provenance | Mechanical | P5 | display churn must not touch verdict logic | one fat schema |
| 30 | Eng | Fact-ID-bound narrator statements (whole-drop only) | Mechanical | P1 | sentence drops can invert meaning | free-prose lint |
| 31 | Eng | Fixture matrices + mutation tests + adversarial corpus growth | Mechanical | P1 | 50 hand claims won't cover false-ABSENT space | static corpus |
| 32 | Eng | Middleware + wiring confidence tiers | Mechanical | P1 | boolean edges invite false confidence | single edge type |
| 33 | Eng | Daemon identity + session token + Host validation + realpath jail | Mechanical | security | 127.0.0.1 necessary, not sufficient | bind-only defense |
| 34 | Eng | Backpressure: coalesce queue, ignore-globs, STALE degradation, 5k ceiling | Mechanical | P3 | unbounded queue under agent churn | unbounded watcher |
| 35 | Eng | Hook lifecycle state machine | Mechanical | P5 | PostToolUse ≠ stable filesystem | ad-hoc event handling |
| 36 | Eng | Floor precedence: false-ABSENT gate before usefulness floor | Mechanical | P1 | bars were in silent tension | unordered metrics |
| 37 | Eng | PLAN view carved out of determinism guarantee | Mechanical | P1 | plan parsing is LLM-mediated; say so | implicit overclaim |
| 38 | Eng | Stack variant: Prisma-first (Supabase subset second) | Taste, APPROVED at gate | P3 | extraction ease vs target-crowd fit | — |
| 39 | DX | Quickstart contract: ≤3 commands, ≤2min, bundled demo repo | Mechanical | P1 | both voices: no getting-started path existed | undefined onboarding |
| 40 | DX | CLI command matrix, verb-first, exit codes, --json everywhere | Mechanical | P5 | CLI surface was never enumerated | ad-hoc naming drift |
| 41 | DX | User-facing error catalog, docs links CI-linted | Mechanical | P1 | registry was system-facing only | internal-only errors |
| 42 | DX | Docs IA with caveat-as-headline + UNDETERMINED gallery | Mechanical | P1 | capability must be discoverable before first miss | docs-later |
| 43 | DX | Config file escape hatches (port/debounce/globs/guards/theme) | Mechanical | P5 | overridable-in-name needs a mechanism | false escape hatch |
| 44 | DX | Claim-manifest schema published + check --manifest | Mechanical | P1 | integration contract was unpublished | internal-only contract |
| 45 | DX | Semver/changelog/compat promise; cache silent-rebuild | Mechanical | P1 | upgrade path was absent | unversioned releases |
| 46 | DX | First-run daemon consent notice; state in ~/.program-design/<hash> | Mechanical | P5 | progressive consent; never pollute the repo | silent daemon spawn |
| 47 | DX | No telemetry, stated deliberately; doctor-based feedback path | Mechanical | P1 | trust tool doesn't phone home | quiet analytics |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (PLAN via /autoplan) | 9 proposals, 5 accepted, 4 deferred; premise gate passed; 0 critical gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 4 | CLEAR (via /autoplan voices) | CEO 15 + Design 12 + Eng 14 + DX 6-dimension findings, all resolved into plan |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN via /autoplan) | 26 issues, 0 critical gaps; test plan artifact written |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN via /autoplan) | score: 3/10 → 8/10, 9 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | CLEAR (PLAN via /autoplan) | score: 2/10 → 8/10, TTHW: undefined → <2min |

- **CROSS-MODEL:** Claude + Codex ran on all 4 phases. Heaviest overlap: agent-claims
  blind spot (4 voices), receipt legibility (4 voices), undetermined-paralysis (3 phases),
  false-ABSENT discipline (2 phases). One disagreement (live-view value) resolved by
  user at the premise gate.
- **UNRESOLVED:** 0 — both user challenges resolved to the user's original direction
  at the final gate (2026-06-07); all 4 taste decisions approved.
- **VERDICT:** CEO + ENG + DESIGN + DX CLEARED — ready to implement.
