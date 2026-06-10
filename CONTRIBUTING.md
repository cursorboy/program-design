# Contributing

program-design is a trust tool. Its single most important property is **zero
false ABSENT verdicts** — it must never say "absent" when it means "I didn't find
it." Contributions are organized around protecting that property.

## The corpus loop

The release gate is a fixture corpus of real Next.js claims, run in CI as the
**corpus-gate** job. A false ABSENT on the corpus is a release blocker.

The loop:

1. **You hit a false ABSENT in the wild.** The tool reported ABSENT for something
   that is actually present (a pattern it failed to recognize).
2. **Capture it as a fixture.** Reduce it to the smallest Next.js source that
   reproduces the wrong verdict, plus the claim manifest that triggers it.
3. **Add it to the corpus** under `fixtures/` with an expected verdict of
   UNDETERMINED (if the pattern is genuinely off the allowlist) or CONFIRMED (if
   the extractor should have recognized it).
4. **Fix the extractor or widen the allowlist** so the corpus passes. Widening
   the [recognized-pattern allowlist](docs/patterns.md) is the *only* sanctioned
   way to raise the usefulness floor — never by relaxing the undetermined-bias.
5. **The corpus grows.** Every real-world false ABSENT becomes a permanent
   adversarial test the community shares.

### Adding a corpus case

1. Create a minimal fixture directory (or extend the sample app) reproducing the
   case.
2. Add a claim manifest exercising the claim that mis-resolved.
3. Add a test under `test/` asserting the expected verdict. Run
   `npx vitest run`.
4. Open a PR. Attach `npx program-design doctor --json` output. Describe the
   real-world source the false ABSENT came from.

## Dev setup

```bash
git clone <repo>
cd program-design
npm ci
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run dev -- demo    # run the CLI from source against the sample app
```

- TypeScript, strict, ESM NodeNext (`.js` import suffixes).
- No new runtime dependencies without discussion — the dependency surface is
  part of the trust story.
- The facts-graph schema (`src/core/schema.ts`) and state layout
  (`src/core/state.ts`) are contracts. Changing the schema means bumping
  `SCHEMA_VERSION`.

## Principles for reviewers

- **Bias to UNDETERMINED.** If a change could produce an ABSENT where the truth is
  "unsure," reject it. Precision over coverage.
- **Receipts everywhere.** Any narrated statement must bind to a fact id that
  resolves to `file:line`. No receipt, no statement.
- **No telemetry.** A trust tool does not phone home. Do not add analytics.
- **Read-only.** program-design never edits user code.

## Feedback

Open an issue. The template asks for `program-design doctor --json` output — it
captures your Node version, repo detection, and daemon state in one paste.
