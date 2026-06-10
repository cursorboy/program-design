# What it can and cannot verify

This is the most important page. Read it before your first verdict.

program-design checks **presence, not correctness.** It tells you whether the
thing an agent claimed exists in the code, and where. It does not — and cannot —
tell you whether the logic is right or the feature works at runtime.

## Presence vs correctness

The tool can say:

> There is no rate-limit middleware attached to `POST /api/login`.
> (searched: `middleware.ts` matcher, recognized guard wrappers)

It **cannot** say:

> Rate limiting works correctly.

The first is a structural fact, derivable from parsing the code. The second is a
runtime behavior claim — out of scope, by design. When in doubt, the tool says
so plainly rather than guessing.

This is deliberate. Two overclaims we refuse to make:

1. **"A second AI verifies the first."** A second LLM reading code hallucinates
   exactly like the first. Stacking models does not produce truth. That is why
   the verdict is computed deterministically from the facts graph, never by a
   model.
2. **"Static analysis proves the code is correct."** It does not. Parsing tells
   you what is present and how it is wired. It cannot tell you whether the logic
   is right.

The claim we *do* make: every statement the tool makes is backed by a specific
line of code you can open. You do not have to trust the tool. You can see the
evidence.

## The three verdict states

Every claim resolves to exactly one of three states.

### CONFIRMED — present, with a receipt

The extractor found the claimed construct on the recognized-pattern allowlist,
and the verdict carries one or more receipts (`file:line`). Encoding in the UI:
green, solid node, ✓.

> CONFIRMED: route `POST /api/login` exists.
> receipt: `app/api/login/route.ts:3`

### ABSENT — confirmed absent, with a search scope

The extractor searched the recognized patterns and the thing is **deterministically
not there.** An ABSENT always records *what was searched* (which conventions,
directories, matchers) — provable absence, never "I didn't find it." Encoding:
red, ring node, ✕. ABSENT is the divergence that makes `check` exit `1`.

> ABSENT: no rate-limit middleware attached to `POST /api/login`.
> searched: `middleware.ts` config.matcher, recognized guard wrappers.

### UNDETERMINED — analysis was defeated, and it says so

The parser hit something it cannot analyze — dynamic dispatch, a route built from
a string, reflection, a parse failure mid-build, an unsupported pattern. The
verdict carries a plain-language reason (and, behind an expand, the exact code
pattern that defeated it). Encoding: amber, dashed node, ?.

> UNDETERMINED: I can't safely confirm the frontend calls `/api/login` — the URL
> is built from a template literal at runtime.
> pattern: `` fetch(`/api/${endpoint}`) ``

**The tool never reports ABSENT when it means "I did not find it."** When in
doubt, the verdict is UNDETERMINED. Precision matters more than coverage. See the
[UNDETERMINED gallery](undetermined-gallery.md) for worked examples.

## The honest claim

> The true claim: every statement the tool makes is backed by a specific line of
> code the user can open. The user does not have to trust the tool. They can see
> the evidence.

Overclaim one — "a second AI verifies the first" — is false because a second LLM
reading code can hallucinate exactly like the first; stacking models does not
produce truth. Overclaim two — "static analysis proves the code is correct" — is
false because parsing tells you what is present and how it is wired, not whether
the logic is right or the feature works at runtime. The tool can say "there is no
rate-limit middleware attached to this route." It cannot say "rate limiting works
correctly."

## This is not a completeness audit

At MVP, claims come from the **building agent**, and the agent is the untrusted
party. What the verifier proves is **manifest-vs-code consistency**: did the
things the agent *said* it did actually land in the code?

It does **not** guarantee coverage of what the agent *should* have done. If the
agent forgot the password-reset flow and never claimed it, nothing will flag the
omission — because nothing claimed it. Every report says so in its footer:

> Checked 7 claims the agent made; this is not a completeness audit.

You can close this gap today by hand-authoring a claim manifest against your own
spec and running `program-design check --manifest claims.json` (see
[claim-manifest.md](claim-manifest.md)). Spec-vs-code mode — verifying against
your original intent instead of the agent's self-report — is the first post-MVP
move.
