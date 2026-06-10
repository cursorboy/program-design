# Spec: the rest of the platform — Live & Technical modes

This specs out the parts of program-design beyond the system map you already have:
the **Live** mode (watch it build, claims adjudicated in real time) and the
**Technical** mode (the engineer's receipted view), plus how the supporting views
and the auto-generation pipeline fit. Everything here is grounded in code that
already exists; each surface notes what to **reuse** vs **build**.

> One sentence: the system map is the *picture*, Plain/Technical is the *depth* you
> read it at, and Live is the *time dimension* — the same map drawing itself while a
> deterministic lie-detector checks every claim the agent makes against the real code.

---

## 1. The platform grid: depth × liveness

There are two independent axes. The product is the cells of this grid, not separate apps.

|              | **Map** (default)            | **Plain**                       | **Technical**                          |
|--------------|------------------------------|---------------------------------|----------------------------------------|
| **Static**   | hierarchical system map      | plain-English flow sentences    | receipted IR + verdict ledger          |
| **Live**     | map draws itself as code lands | plain narration of each change | streaming verdict feed + IR deltas     |

- **Depth** (`data-depth = map | plain | technical`) is already a real toggle
  (`applyDepth`, `app.ts:1767`). It re-skins the *same* facts: "Your records" (Plain)
  ↔ "Postgres + pgvector (neondb)" (Technical). Today Technical only flips the raw-API
  footer + tree visibility; this spec makes it a real engineer view.
- **Liveness** is the existing daemon + long-poll `/api/events` loop. Today it refreshes
  counts on a version bump; this spec turns it into a streaming build-and-verify feed.

The moat is the **Live × claim-check** cell: the user watches Claude *say* "I added auth"
and watches the tool independently mark it CONFIRMED / ABSENT / UNDETERMINED with the
proof one click away. The diagram is the surface; the verdict is the product.

---

## 2. Live mode — "watch it build, watch it get checked"

**For:** a non-technical builder running Claude Code. They can't read code or a static
diagram cold, but they *can* watch a plain map grow and trust a green/red badge with a
receipt. Secondary audience: the agent itself, whose claims Live adjudicates in public.

**The pitch:** it is not a diagram, it is a **live lie-detector** for what the agent says
vs. what the code contains.

### Surfaces

1. **Self-drawing system map** — the hierarchical map (frontend / servers / data /
   external / scheduled), where each node appears with the tour's spring-reveal the
   instant its code lands; new nodes glow, removed nodes strike through.
   *Source:* `/api/graph` diffed in-browser via `prevNodeIds` on each `/api/events` bump.
   *Reuse:* the tour's `applyTourVisibility` / `frameVisibleNodes` reveal mechanic —
   "watch it build" and "walk me through it" become **one** mechanic.

2. **Live claim ticker** — the headline surface. An append-only feed: each row is the
   agent's claim in plain text + a streaming **CONFIRMED ✓ / ABSENT ✗ / UNDETERMINED –**
   badge + "show receipt." This replaces the static status strip in Live.
   *Source:* tail `/api/ledger` (JSONL `claim-checked` entries, each carrying a full
   `ClaimVerdict` with `receipts[]`, `searchScope[]`, `explainer`). Verdicts come from
   the deterministic `checkClaims` — **never an LLM**.

3. **Activity log** — the existing 10-entry change feed ("+ route POST /api/login · 3s
   ago"), extended to interleave claim verdicts on the same timeline. Clicking an entry
   jumps the camera to the node the verdict is grounded in (`verdict.factIds → node`).

4. **Build status header + STALE/updating banner** — "Building… · 14 pages · 3 servers"
   with a breathing dot while `lifecycleState` is `build-active`, plus the STALE banner
   and a new "updating…" transition during re-extraction.

5. **Receipt popover** — click any node or verdict → a ±2-line code snippet, matched line
   highlighted, proving it's real. Routed through the existing realpath-jailed
   `/api/snippet`.

6. **Connection / reconnect banners** — transient "Reconnecting…" if the long-poll drops
   (daemon bounce mid-build) and a terminal "Reload" on stale token; the durable
   `token.json` keeps the tab authed across a daemon restart.

### How a claim becomes a badge (the pipeline)

1. Claude finishes a step and emits a completion claim → the skill translates it to a
   `ClaimManifest` (`prompt.ts:122`).
2. The CLI runs **deterministic** `checkClaims(graph, manifest)` (`checker.ts:719`) —
   verdict computed from the facts graph.
3. Each verdict → appended to `ledger.jsonl` + `writeVerdicts`.
4. CLI `notifyRefresh('verdicts')` → `daemon.bump('verdicts')` wakes every parked
   `/api/events` waiter.
5. Browser `poll()` sees a new version, tails `/api/ledger`, appends the new rows with
   their badge + receipt.

The **build-active guard** (`checker.ts:176`) is what keeps the lie-detector honest:
nodes still being written resolve **UNDETERMINED** ("still building"), never a false
ABSENT — so it never cries wolf mid-build. And `recheckLedger` already re-verifies every
prior claim on each graph change, so a CONFIRMED that flips to ABSENT surfaces as a red
"this stopped being true" row.

### Build vs reuse

Almost all the transport already exists (daemon long-poll, `poll()`/`reconnect()`,
`checkClaims`, `recheckLedger`, `appendLedger`, `/api/snippet`, the tour reveal).

| Build | Effort |
|-------|--------|
| Live claim ticker UI (tail `/api/ledger`, badge + receipt per row) | M |
| Route newly-diffed nodes through the tour reveal animation (self-drawing map) | M |
| Ledger-tail diffing in browser (`lastSeenLedgerLen`, append only new rows) | S |
| Surface `regression-alert` rows ("this stopped being true", prev→current) | S |
| "updating…" transition on the STALE banner | S |
| **Claim-time live hook** — let the agent emit claims *during* the session, not only at Stop | L |
| Typed `/api/events` payloads (`{kind,count}`) to avoid redundant GETs | L |

### Phases

1. **MVP — streaming ticker over the existing live view.** Replace the static status
   strip with an append-only claim ticker tailing `/api/ledger` on each bump, with badge +
   one-click receipt. **Zero daemon/checker changes** — pure browser work. Structure
   already streams via the graph diff.
2. **Self-drawing map.** Route live node insertions through the tour's reveal spring +
   camera framing. Add regression rows + the "updating…" banner.
3. **Streaming claim intake + typed events.** Let the agent drop claims incrementally
   during the build (not just at Stop) so verdicts stream feature-by-feature; add typed
   event payloads. The only phase that touches daemon/skill plumbing.

### Honest constraints (must be designed-around, not hidden)

- **Claims arrive in batches, not token-by-token.** Verdicts update when the CLI runs a
  check (Stop hook / `--manifest`), not per-claim. MVP must say "updates as Claude
  finishes each step," not imply literal live streaming — until Phase 3's intake hook.
- **The ticker is only as live as the claim cadence.** Without the Phase 3 hook it moves
  only when the agent runs a check. Document this plainly.
- **Whole-graph re-extraction per change.** Large repos may batch many nodes into one
  reveal rather than trickling; debounce tuning matters. (`invalidate.ts` exists for
  incremental extraction but isn't wired into the live path yet.)
- **Reveal-surface reconciliation.** The live view today renders a directory-clustered
  *tree* (`buildTree`), not the infinite-canvas map. Phase 2 must decide which surface
  the reveal animates, or "self-drawing map" lands on the tree.

---

## 3. Technical mode — the receipted engineer's view

**For:** a skeptical senior engineer auditing whether the tool's claims hold up. They
won't trust a green check without a file:line they can click, want the confidence tier
behind every wire, expect ABSENT to carry a search scope and UNDETERMINED to carry the
exact defeating pattern, and want raw JSON to verify the UI isn't lying about the IR.

**The job:** verifiability. Make the tool credible by proving everything shown is
deterministically derived from real code, with one click to source. Every node, edge,
verdict, concern, and ledger entry carries a receipt through the single jailed
`/api/snippet`. **No LLM touches any verdict shown here.**

### Surfaces

1. **Receipted structure tree** — the existing `buildTree` hierarchy, upgraded so every
   leaf carries a clickable `file:line + ruleId` chip (not just kind-tag + name), plus
   kind/confidence filter chips (route / middleware / dbTable / envVar / dependency) so
   it's filterable, not hierarchy-only.

2. **Dependency + data-flow edge inspector** — *the missing piece.* `FactsGraph.edges`
   rendered as an inspectable list/DAG grouped by `EdgeKind` (`imports`, `calls`,
   `wiredTo`, `reads`, `persistsTo`, `queriesDb`, `storesData`, `navigatesTo`,
   `submitsTo`…). Each row: `from → to`, kind, **confidence tier** (`literal` /
   `constant-resolved` / `helper-resolved` / `sdk` / `dynamic`), `unresolved` flag, and a
   receipt. This is what turns "Your records" into "Postgres + pgvector via `storesData`
   edge, tier=constant-resolved, `src/db/client.ts:14`." Filter by kind and tier; click
   `from`/`to` to jump to the node.

3. **Full verdict ledger** — the Report view in full engineer detail: every
   `ClaimVerdict` with `category/predicate/subject/qualifiers`, state, **all** receipts,
   and the complete WHY — ABSENT's `searchScope[]` (where it looked), UNDETERMINED's
   `explainer.reason` + the exact **defeating pattern**, and `factIds[]` linking into the
   inspector. Plus an **allowlist provenance** line: which `(category,predicate)` entry +
   `ruleIds` proved the recognizer ran, or "off-allowlist → UNDETERMINED by construction."

4. **Raw IR console** — the existing tech-footer raw links, extended to all endpoints
   (`/api/system-map`, `/api/mermaid`, `/api/plan`, `/api/health`) + a "show Mermaid
   source" copyable view + a build-provenance strip (`generatedAt`, `buildActive`,
   `schemaVersion`, per-category `stats`). The IR an engineer can `curl`.

5. **Parse failures + coverage diagnostic** — *the honesty surface.* Renders
   `FactsGraph.parseFailures[]` (files the extractor couldn't analyze — exactly why their
   scope is UNDETERMINED, not ABSENT) paired with `stats` coverage counts. Shows the
   skeptic where the tool's vision has gaps. (Tracked today, surfaced nowhere — a real
   gap.)

6. **Technical history / regression ledger** — the History view with full `sessionId`,
   ISO timestamp, claim identity, and for `regression-alert` entries the
   previous→current verdict transition with both receipts. The deterministic audit trail
   proving claims were re-verified on each change.

### The three flavors of UNDETERMINED (must stay distinct)

Technical mode's credibility depends on never conflating:
- **off-allowlist** — UNDETERMINED by construction (no recognizer for this claim shape),
- **defeated** — a specific pattern beat the analysis (show the pattern), and
- **transient** — `unresolved=true` during `buildActive` (still building; will resolve).

### Build vs reuse

The depth toggle, `buildTree`, `claimRow`, `receipt`, `attachReceiptHandlers`,
`/api/snippet`, `/api/graph`, `/api/verdicts`, the `ConfidenceTier` vocab, and the
allowlist artifact all already exist. The Edge Inspector is the only genuinely new (L)
surface; the rest is extension.

| Build | Effort |
|-------|--------|
| Receipt chip + `ruleId` on every tree leaf (gated to technical depth) | S |
| Kind/confidence filter chips above the tree | S |
| **Edge Inspector** (edges grouped by kind, tier column, receipts, jump-to-node) | L |
| `claimRow` at technical depth: `factIds` + allowlist provenance | M |
| Bidirectional `factId` linking (verdict ↔ node/edge) | M |
| Parse-failures + coverage diagnostic panel | S |
| Raw IR console (more endpoints + build strip + Mermaid source) | M |
| Deepen History with verdict-transition detail | M |
| Annotate the build-active transient-unresolved guard in verdict UI | S |

### Phases

1. **MVP — receipts on every node + full verdict WHY.** Every tree leaf gets a clickable
   `file:line+ruleId`; Report at technical depth shows every verdict's state, all
   receipts, search scope, defeating pattern, factIds, allowlist provenance. Makes the
   whole tool verifiable end-to-end: claim → fact → file:line → source. Almost entirely
   existing code.
2. **Edge inspector + dependency/data-flow detail.** The raw wiring IR with tiers,
   filterable, cross-linked to the tree and to verdict factIds.
3. **Honesty + raw-IR diagnostics.** Parse-failures/coverage panel, expanded raw console,
   deepened history, transient-unresolved annotation. Completes the audit kit: when, from
   what, with what coverage, and what changed — all receipted.

### Risks

- Edge inspector can be a wall of edges on real repos → needs grouping/virtualization +
  tier filtering.
- `factId → node` links can dangle under version skew (graph and verdicts bump
  independently) → handle gracefully.
- Receipt chips per node multiply `/api/snippet` calls → keep the lazy expand-on-click +
  `dataset.loaded` cache; never eager-fetch.
- `parseFailures`/`stats` depend on the extractor → frame as "extracted," not "complete."

---

## 4. The rest of the platform (the connective tissue)

These already have view shells; they're the same facts at different angles:

- **Plan view** — from plan mode, the *intended* structure (`PlanIntent` schema exists,
  `schema.ts:318`); the diff between planned and built is a natural future surface.
- **Report view** — the static claim report (Plain by default; Technical deepens it, §3.3).
- **Concerns view** — the adversarial "what looks off" findings (already driving the ⚠
  badges and the tour's concern beat).
- **How-it-works view** — the dataFlows narrative in plain prose.
- **History view** — the session/regression ledger (Technical deepens it, §3.6).

### The one cross-cutting gap that matters most: auto-generation

theVault's `system-map.json` + `tour.json` were produced by a **workflow and hand-placed**
— the runtime pipeline that would make *any* project accurate on first open is the
biggest unbuilt piece. It has two halves:

1. **Deterministic infra/host/db extractors** (schema exists, rules don't): provider
   detection (Railway/Vercel/Neon from `railway.toml`, `vercel.json`, `@vercel/*`),
   database engine detection, third-party service detection (Stripe/OpenAI/Sendblue
   calls), scheduled-job detection. This is what would have gotten theVault's "Vercel vs
   Railway" right automatically instead of by hand. *(Several extractors —
   `forms.ts`, `navigation.ts`, `persists.ts` — exist but aren't wired into
   `extract/index.ts` yet.)*
2. **The organize pass** (contract exists in `system-map.ts`, no entry point): the
   separate clean-context LLM that reads the facts graph + real source and emits the
   `SystemMap`/`Tour`, fenced by `validateMap` (drops any node without a real receipt).
   Needs a CLI command / daemon trigger.

Until both ship, the map is accurate only for projects whose map was authored by hand.
This is the work that makes "accurate by default" true — and it's the natural follow-up
to the accuracy fixes already done.

---

## 5. Unified roadmap

Ordered so each step ships value and reuses the prior. Live and Technical interleave;
the auto-gen pipeline is the parallel track that unlocks "any project."

1. **Technical MVP** (receipts on every node + full verdict WHY) — pure extension of
   existing code; makes the tool end-to-end verifiable. *Highest credibility-per-effort.*
2. **Live MVP** (streaming claim ticker) — zero daemon changes; delivers the headline
   "watch claims get adjudicated."
3. **Self-drawing map** (Live phase 2) — unify the tour reveal with live node insertion.
4. **Edge inspector** (Technical phase 2) — the raw dependency/data-flow IR.
5. **Auto-gen pipeline** (parallel track) — infra/host/db extractors + the organize pass,
   so any project gets an accurate map+tour without hand-authoring.
6. **Streaming claim intake + honesty diagnostics** (Live/Technical phase 3) — incremental
   claims, typed events, parse-failure/coverage panels.

---

## 6. Invariants (true across every mode)

- The LLM never draws the diagram and never computes a verdict; it only *organizes*
  fact-anchored nodes (`validateMap` drops un-receipted ones) and *narrates* (fail-closed
  lint binds every statement to a fact id).
- Every assertion the user can read has a `file:line` receipt, served only through the
  realpath-jailed `/api/snippet` on a 127.0.0.1 bind with a per-session token.
- Env extraction records variable **names** only, never values. No telemetry.
- The three-state model (CONFIRMED / ABSENT / UNDETERMINED) with the **zero-false-ABSENT**
  corpus gate is the contract: when unsure, say UNDETERMINED — never a false accusation.
