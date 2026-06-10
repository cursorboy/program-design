# UNDETERMINED gallery

UNDETERMINED is not a failure. It is the honest verdict when the parser hits
something it cannot analyze. This page sets expectations *before* your first amber
verdict, not after. Each example shows the code pattern that defeats analysis and
the plain-language reason the verifier reports.

The rule behind all of them: **the tool never reports ABSENT when it means "I
did not find it."** When analysis is defeated, the verdict is UNDETERMINED and it
says so plainly. Precision over coverage.

---

## 1. Dynamic fetch from a template literal

```ts
async function call(endpoint: string) {
  return fetch(`/api/${endpoint}`);
}
```

**Verdict:** UNDETERMINED (wiring).
**Reason:** I can't tell which route the frontend calls — the URL is built at
runtime from a template literal, so the path isn't a value I can resolve to a
defined route.

---

## 2. Computed middleware matcher

```ts
export const config = {
  matcher: PROTECTED_ROUTES.map((r) => `${r}/:path*`),
};
```

**Verdict:** UNDETERMINED (middleware attached).
**Reason:** I can't confirm this route is protected — the matcher is computed from
an array at module load instead of being written as a literal pattern I can check
the route against.

---

## 3. Route path built from a string

```ts
const path = isAdmin ? "/api/admin" : "/api/user";
fetch(BASE + path);
```

**Verdict:** UNDETERMINED (wiring).
**Reason:** The request URL is assembled from variables and a conditional, so I
can't pin it to a single defined route. I won't guess which one it hits.

---

## 4. Parse failure mid-build

```ts
export async function POST(req: Request) {
  const body = await req.json(
  // file saved mid-edit; the call is unclosed
```

**Verdict:** UNDETERMINED (route exists, scoped to this file).
**Reason:** This file didn't parse — it looks like it was caught mid-edit. Rather
than guess what's in it, I'm marking everything it would define as undetermined
until it parses cleanly. (Shown as an amber node with an explainer in the live
view.)

---

## 5. Unresolved import during build

```ts
import { rateLimit } from "./middleware/rate-limit"; // file doesn't exist yet
export const config = { matcher: ["/api/:path*"] };
```

**Verdict:** UNDETERMINED (transient unresolved), never ABSENT.
**Reason:** This references `./middleware/rate-limit`, which doesn't exist on disk
yet. During an active build that usually means it's about to be written, so I
treat it as undetermined — not absent. A missing target mid-build is timing, not
a divergence.

---

## 6. Behavior claim refused at translation

> Claim: "Rate limiting works correctly on the login route."

**Verdict:** not checkable — recorded as UNVERIFIABLE-BY-DESIGN, not a verdict.
**Reason:** This is a claim about runtime behavior ("works correctly"), and this
tool verifies presence, not correctness. The translator refuses to express it as
a structural claim; it appears in the report's unverifiable list with the reason
"behavior claim — presence-only tool." (The presence half — *is* a rate-limit
wrapper attached to the route — can be checked separately and may come back
CONFIRMED, ABSENT, or UNDETERMINED on its own.)

---

## Why this matters

Every UNDETERMINED carries the exact defeating pattern so the honesty is
inspectable. If you think a verdict *should* be CONFIRMED or ABSENT but it's
UNDETERMINED, that usually means the construct is off the recognized-pattern
allowlist (see [patterns.md](patterns.md)) — and the fix is to widen the allowlist
with a corpus case, never to relax the undetermined-bias. See
[CONTRIBUTING.md](../CONTRIBUTING.md).
