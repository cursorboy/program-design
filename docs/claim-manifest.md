# Claim-manifest schema

The claim manifest is the published contract for driving the verifier. A
third-party agent or a CI job can verify a codebase without the Claude Code skill:

```bash
npx program-design check --manifest claims.json --json
```

`--manifest` accepts either a full `ClaimManifest` object or a bare `Claim[]`
array (a bare array is wrapped into a manifest with `source: "file"`).

## Concepts

- A **Claim** is a structured, verifiable statement: a category, a predicate, a
  normalized subject, qualifiers, and the original natural-language text.
- The manifest is **untrusted input.** The verifier proves manifest-vs-code
  consistency; it does not trust the claim's own assertion.
- Claims that cannot be expressed structurally (behavior/runtime claims) go in
  `unverifiable`, never in `claims`.

## JSON Schema

This matches the types in `src/core/schema.ts` (`SCHEMA_VERSION = 1`).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ClaimManifest",
  "type": "object",
  "required": ["schemaVersion", "sessionId", "source", "claims", "unverifiable"],
  "properties": {
    "schemaVersion": { "type": "integer", "const": 1 },
    "sessionId": { "type": "string" },
    "source": { "type": "string", "enum": ["agent", "user", "file"] },
    "claims": { "type": "array", "items": { "$ref": "#/definitions/Claim" } },
    "unverifiable": {
      "type": "array",
      "items": { "$ref": "#/definitions/UnverifiableClaim" }
    }
  },
  "definitions": {
    "Claim": {
      "type": "object",
      "required": ["id", "category", "predicate", "subject", "qualifiers", "rawText"],
      "properties": {
        "id": { "type": "string" },
        "category": {
          "type": "string",
          "enum": ["route", "middleware", "schema", "env", "dep", "wiring"]
        },
        "predicate": {
          "type": "string",
          "enum": ["exists", "attached", "has-column", "reads", "installed", "wired"]
        },
        "subject": {
          "type": "string",
          "description": "Normalized: route path only (e.g. /api/login, method goes in qualifiers.method), table name, env name, or dep name."
        },
        "qualifiers": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "e.g. { \"method\": \"POST\", \"middleware\": \"rate-limit\", \"column\": \"email\" }"
        },
        "rawText": {
          "type": "string",
          "description": "Original natural-language claim, verbatim. Untrusted."
        }
      }
    },
    "UnverifiableClaim": {
      "type": "object",
      "required": ["rawText", "reason"],
      "properties": {
        "rawText": { "type": "string" },
        "reason": {
          "type": "string",
          "description": "e.g. \"behavior claim — presence-only tool\""
        }
      }
    }
  }
}
```

### Category → predicate mapping

| Category | Predicate | Means |
|---|---|---|
| `route` | `exists` | a route handling the subject path exists |
| `middleware` | `attached` | middleware (qualifier `middleware`) is attached to the route |
| `schema` | `exists` | table `subject` exists |
| `schema` | `has-column` | table `subject` has column (qualifier `column`) |
| `env` | `reads` | env var `subject` is read |
| `dep` | `installed` | dependency `subject` is installed |
| `wiring` | `wired` | the frontend calls route `subject` |

## Minimal example

```json
{
  "schemaVersion": 1,
  "sessionId": "demo-session",
  "source": "user",
  "claims": [
    {
      "id": "c1",
      "category": "route",
      "predicate": "exists",
      "subject": "/api/login",
      "qualifiers": { "method": "POST" },
      "rawText": "There is a login route at /api/login"
    }
  ],
  "unverifiable": []
}
```

A bare array is also accepted:

```json
[
  {
    "id": "c1",
    "category": "dep",
    "predicate": "installed",
    "subject": "prisma",
    "qualifiers": {},
    "rawText": "Prisma is installed"
  }
]
```

## Compatibility promise

The claim-manifest schema follows **semver** and is **stable within a major
version.** New optional fields may be added in minor releases; required fields and
the meaning of existing fields do not change within a major. Deprecations warn one
minor version ahead. The facts-graph cache is disposable: a `schemaVersion`
mismatch triggers a silent rebuild, so upgrades cannot corrupt your state.
