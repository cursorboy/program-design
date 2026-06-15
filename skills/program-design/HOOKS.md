# Hooks

program-design works **without any hooks** — the live structure view refreshes
itself through the file watcher that `program-design live` starts. Hooks are an
optional convenience to automate the two trigger surfaces: build-time refresh and
claim-time verification.

## Are hooks required?

No.

- **Live refresh is automatic.** `program-design live` runs a debounced watcher
  (300–500 ms, configurable) that re-extracts the facts graph and pushes a
  refresh to the open diagram on every file change. A `PostToolUse` hook would
  only duplicate that.
- **Claim-time verification** is driven by the skill instructions (SKILL.md). A
  `Stop` hook is a convenient place to run it automatically at the end of a turn.

## PostToolUse — optional debounced refresh

Only useful if you are NOT running `program-design live` (e.g. you want the graph
on disk fresh for `check` without the server). The watcher already covers the
live case.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx program-design live --no-open >/dev/null 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

Note: prefer leaving `program-design live` running instead — it is debounced and
incremental, where a per-tool hook re-runs unconditionally.

## Stop — run the claim-time flow

A `Stop` hook is the natural place to verify completion claims when you finish a
turn. The hook itself does not invent claims; it signals the skill to translate
the turn's completion summary into a ClaimManifest and run `check`. In practice
the skill instructions handle the translation; the hook is a reminder trigger.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "test -f /tmp/program-design-claims.json && npx program-design check --manifest /tmp/program-design-claims.json --json || true"
          }
        ]
      }
    ]
  }
}
```

The skill writes `/tmp/program-design-claims.json` during the claim-time flow
(SKILL.md, Step 2). The `Stop` hook then runs the deterministic verifier and the
skill presents the verdict table verbatim. Because `check` exits `1` on a
divergence, CI and wrapper scripts can branch on it.

## Full `hooks.json` example

A combined snippet you can drop into your Claude Code settings. Both hooks are
defensive (`|| true`) so a missing CLI or temp file never blocks your turn.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "test -f /tmp/program-design-claims.json && npx program-design check --manifest /tmp/program-design-claims.json --json || true"
          }
        ]
      }
    ]
  }
}
```

## Lifecycle reference

The hook lifecycle maps to the facts-graph build states:
`plan-captured → build-active → extraction-pending → extraction-stable →
claims-received → verdicts-streamed → report-finalized`. PostToolUse does NOT
guarantee a stable filesystem and `Stop` may precede the watcher flush — which is
exactly why the live watcher (debounced, coalescing) is the primary refresh path
and hooks are secondary.
