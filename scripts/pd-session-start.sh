#!/usr/bin/env bash
# program-design — SessionStart hook.
#
# Zero-friction activation for non-technical users: instead of making anyone
# type a command, this injects a short instruction into the session so the agent
# proactively (a) offers the live structure map and (b) verifies its own
# completion claims at claim time. It does NOT spawn a server here — the agent
# starts `npx program-design live` when it makes sense.
#
# Robust by design: only speaks up inside a Next.js project, never errors the
# session (always exits 0).
set -e

dir="${CLAUDE_PROJECT_DIR:-$PWD}"

is_next=0
if [ -f "$dir/package.json" ] && grep -q '"next"' "$dir/package.json" 2>/dev/null; then
  is_next=1
elif [ -d "$dir/app" ] || [ -d "$dir/src/app" ] || [ -d "$dir/pages" ] || [ -d "$dir/src/pages" ]; then
  is_next=1
fi

if [ "$is_next" -ne 1 ]; then
  exit 0
fi

read -r -d '' CTX <<'EOF' || true
program-design is installed. This looks like a Next.js app. Use it without making the user run anything:
1) LIVE MAP — early in the session, offer to start the plain-language structure map so the user can watch what is being built: run `npx program-design live` (extracts the code, serves a local map on 127.0.0.1, opens it). The map adapts to how technical the user is.
2) VERIFY AT CLAIM TIME — whenever you are about to say you finished or added something ("done, I added login with rate limiting and saved the email"), FIRST translate that summary into a claim manifest, run `npx program-design check --manifest <file> --json`, then present the CONFIRMED / ABSENT / UNDETERMINED verdicts VERBATIM, each with its file:line receipt. Never soften an ABSENT.
It verifies presence, not correctness. Full instructions are in the program-design skill.
EOF

# Emit as SessionStart additionalContext (JSON-escaped via a tiny node helper if
# available; otherwise a safe single-line fallback).
if command -v node >/dev/null 2>&1; then
  node -e 'const s=require("fs").readFileSync(0,"utf8");process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:s.trim()}}))' <<<"$CTX"
else
  esc=$(printf '%s' "$CTX" | tr '\n' ' ' | sed 's/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$esc"
fi
exit 0
