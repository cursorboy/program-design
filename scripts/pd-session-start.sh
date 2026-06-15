#!/usr/bin/env bash
# program-design — SessionStart hook.
#
# Zero-friction activation: instead of making anyone type a command, this injects
# a short instruction into the session so the agent proactively (a) offers the
# live structure map and (b) verifies its own completion claims. It does NOT
# spawn a server here — the agent runs `npx program-design live` when it makes
# sense.
#
# Works for ANY JavaScript/TypeScript project: the universal map reads any JS/TS
# codebase. Deep verification (routes, schema, claims) understands Next.js +
# Prisma, and the agent is told to say so. Robust by design: stays silent in a
# non-JS/TS project, never errors the session (always exits 0).
set -e

dir="${CLAUDE_PROJECT_DIR:-$PWD}"

# Broad JS/TS detection (mirrors looksLikeJsRepo in the CLI).
is_js=0
for f in package.json tsconfig.json jsconfig.json; do
  [ -f "$dir/$f" ] && is_js=1
done
for d in src app pages lib components; do
  [ -d "$dir/$d" ] && is_js=1
done
if [ "$is_js" -ne 1 ]; then
  # last resort: any JS/TS file at the repo root
  if ls "$dir"/*.{js,jsx,ts,tsx,mjs,cjs} >/dev/null 2>&1; then is_js=1; fi
fi

if [ "$is_js" -ne 1 ]; then
  exit 0
fi

# Tailor the nudge: Next.js gets the full deep-verify pitch; any other JS/TS
# project gets the universal map + an honest note that deep checks are Next-only.
is_next=0
if [ -f "$dir/package.json" ] && grep -q '"next"' "$dir/package.json" 2>/dev/null; then is_next=1; fi
[ -d "$dir/app" ] || [ -d "$dir/src/app" ] || [ -d "$dir/pages" ] || [ -d "$dir/src/pages" ] && is_next=1

if [ "$is_next" -eq 1 ]; then
read -r -d '' CTX <<'EOF' || true
program-design is installed and this is a Next.js app. Use it without making the user run anything:
1) LIVE MAP — early on, offer to start the plain-language structure map so the user can watch what is being built: run `npx program-design live` (extracts the code, serves a local map on 127.0.0.1, opens it). The map adapts to how technical the user is.
2) VERIFY AT CLAIM TIME — whenever you are about to say you finished or added something ("done, I added login with rate limiting and saved the email"), FIRST translate that summary into a claim manifest, run `npx program-design check --manifest <file> --json`, then present the CONFIRMED / ABSENT / UNDETERMINED verdicts VERBATIM, each with its file:line receipt. Never soften an ABSENT.
It verifies presence, not correctness. Full instructions are in the program-design skill.
EOF
else
read -r -d '' CTX <<'EOF' || true
program-design is installed. This is a JavaScript/TypeScript project (not Next.js). Use it without making the user run anything:
1) LIVE MAP — offer to start the plain-language structure map: run `npx program-design live`. It shows the universal map for ANY JS/TS project — the areas of code and the outside services/packages they use, each anchored to a real file. The map adapts to how technical the user is.
2) DEEP VERIFICATION (routes, database schema, claim verdicts with file:line receipts) currently understands Next.js + Prisma. On this stack, claim `check` will mostly resolve UNDETERMINED for routes/schema, though dependency and env-var claims still verify. Be honest about that limit; never present UNDETERMINED as confirmed or absent.
It verifies presence, not correctness. Full instructions are in the program-design skill.
EOF
fi

# Emit as SessionStart additionalContext (JSON-escaped via node when available).
if command -v node >/dev/null 2>&1; then
  node -e 'const s=require("fs").readFileSync(0,"utf8");process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:s.trim()}}))' <<<"$CTX"
else
  esc=$(printf '%s' "$CTX" | tr '\n' ' ' | sed 's/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$esc"
fi
exit 0
