# TODOS

Deferred work from /autoplan review, 2026-06-07. Each item carries enough context to
pick up cold in 3 months.

## P1 — MCP server over the facts graph (2026-06-10, from Graphify comparison)
- **What:** Expose the deterministic facts graph as MCP tools (stdio + HTTP):
  `find_route`, `middleware_for_route`, `wiring_for_page`, `schema_model`,
  `receipt_for_fact`, `check_claim`. Every answer carries file:line provenance.
- **Why:** Graphify (graphify.net) proved agents want a graph instead of grep —
  its pitch is context-cost reduction. Ours is stronger on trust: their semantic
  edges are LLM-inferred (tagged EXTRACTED/INFERRED/AMBIGUOUS); our graph is
  deterministic-only. "The structure source your agent cannot hallucinate" is a
  moat Graphify can't copy without giving up its breadth.
- **Bonus:** `check_claim` as an MCP tool makes ANY agent self-verifying, not
  just Claude Code — grows the claim-manifest standard (see schema-as-platform).
- **Effort:** M. **Depends on:** stable graph schema (already versioned).

## P2 — Standalone shareable map export (`export html`)
- **What:** Single-file interactive HTML snapshot of the system map (the
  graph.html pattern Graphify ships) — founders share "what got built" with a
  cofounder/contractor without running anything.
- **Why:** The shareable artifact is the viral loop; also the static-export
  precursor the cloud-links TODO (P3 below) already calls for.
- **Effort:** S-M (the SPA is already self-contained; bake state in, strip the
  daemon dependency).

## P2 — Spec-vs-code verification mode
- **What:** Verify the codebase against the user's original task/spec, not the agent's
  self-reported claims.
- **Why:** Agent claims let the agent define the audit scope — omissions ("forgot
  password reset") are never caught. Both review models (Claude + Codex) flagged
  intent-vs-code as the more valuable comparison.
- **Pros:** Catches omissions, answers "did it build what I wanted."
- **Cons:** Requirements are vague; mapping intent to graph queries is much harder
  than structured agent claims. Risk of overpromising.
- **Context:** MVP ships agent-claims via the structured claim manifest (see CEO plan
  artifact). The checker and graph are reusable as-is; only the claim source changes.
  Start by letting the user hand-write claim manifests against their own spec.
- **Effort:** L (human ~1-2 wks / CC ~1 day). **Depends on:** MVP checker shipped.

## P3 — Cloud-hosted shareable graph links
- **What:** Share a live or static snapshot of the structure view/report via URL.
- **Why:** Founders want to show contractors/cofounders/engineers what got built.
- **Cons:** Violates MVP no-hosted-service non-goal; security surface (code structure
  is sensitive); accounts/persistence creep.
- **Context:** Start with static export (the Mermaid/report files are already
  shareable artifacts) before any hosted service.
- **Effort:** M-L. **Depends on:** MVP server + export.

## P3 — VS Code extension surface
- **What:** Render the same local server's views in a VS Code webview panel.
- **Why:** Meets developers where they are; CC skill remains the wedge.
- **Effort:** L. **Depends on:** stable local server API.

## P3 — Second stack (+ tree-sitter adoption)
- **What:** Python/FastAPI or plain Express extractor; tree-sitter for uniform ASTs.
- **Why:** Only after stack #1 is solid and used — the PRD names premature
  language-agnosticism as the most common way this dies half-built.
- **Effort:** XL. **Depends on:** stack #1 corpus green and adopted.

## P3 — SVG export
- **What:** Second diagram export target beyond Mermaid.
- **Context:** Cut from MVP to keep export genuinely <1d CC.
- **Effort:** S-M.

## P3 — Schema-as-platform
- **What:** Stabilize + document the facts-graph JSON schema for external consumers
  (QA skills, docs generators, onboarding tools).
- **Why:** The IR is the long-term platform; premature stability guarantees would
  freeze MVP iteration.
- **Effort:** M. **Depends on:** schema survives MVP contact with real repos.
