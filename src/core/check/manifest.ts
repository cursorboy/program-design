/**
 * Manifest validation. The building agent is the UNTRUSTED party (PLAN.md
 * trust-boundary clarifications) — its manifest is untrusted input. We validate
 * raw JSON into a ClaimManifest with precise, path-anchored error strings.
 *
 * Unknown categories/predicates do NOT fail validation: that claim is moved into
 * `unverifiable` with a reason, never dropped silently (PLAN.md manifest rule).
 */
import {
  type Claim,
  type ClaimCategory,
  type ClaimManifest,
  type ClaimPredicate,
  type UnverifiableClaim,
  SCHEMA_VERSION,
} from '../schema.js';

const CATEGORIES: ReadonlySet<string> = new Set<ClaimCategory>([
  'route',
  'middleware',
  'schema',
  'env',
  'dep',
  'wiring',
]);

const PREDICATES: ReadonlySet<string> = new Set<ClaimPredicate>([
  'exists',
  'attached',
  'has-column',
  'reads',
  'installed',
  'wired',
]);

const SOURCES: ReadonlySet<string> = new Set(['agent', 'user', 'file']);

type ValidationResult =
  | { ok: true; manifest: ClaimManifest }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateManifest(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: ['$: expected an object'] };
  }

  // schemaVersion
  let schemaVersion = SCHEMA_VERSION;
  if (raw.schemaVersion === undefined) {
    errors.push('$.schemaVersion: required (expected number)');
  } else if (typeof raw.schemaVersion !== 'number') {
    errors.push('$.schemaVersion: expected number');
  } else {
    schemaVersion = raw.schemaVersion;
    if (schemaVersion !== SCHEMA_VERSION) {
      errors.push(
        `$.schemaVersion: expected ${SCHEMA_VERSION}, got ${schemaVersion}`,
      );
    }
  }

  // sessionId
  let sessionId = '';
  if (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) {
    errors.push('$.sessionId: expected non-empty string');
  } else {
    sessionId = raw.sessionId;
  }

  // source
  let source: ClaimManifest['source'] = 'agent';
  if (raw.source === undefined) {
    errors.push("$.source: required (expected 'agent' | 'user' | 'file')");
  } else if (typeof raw.source !== 'string' || !SOURCES.has(raw.source)) {
    errors.push(
      `$.source: expected 'agent' | 'user' | 'file', got ${JSON.stringify(raw.source)}`,
    );
  } else {
    source = raw.source as ClaimManifest['source'];
  }

  // claims
  const claims: Claim[] = [];
  const unverifiable: UnverifiableClaim[] = [];

  if (raw.claims === undefined) {
    errors.push('$.claims: required (expected array)');
  } else if (!Array.isArray(raw.claims)) {
    errors.push('$.claims: expected array');
  } else {
    raw.claims.forEach((c, i) => {
      validateClaim(c, i, claims, unverifiable, errors);
    });
  }

  // unverifiable (optional incoming list — preserved)
  if (raw.unverifiable !== undefined) {
    if (!Array.isArray(raw.unverifiable)) {
      errors.push('$.unverifiable: expected array');
    } else {
      raw.unverifiable.forEach((u, i) => {
        const path = `$.unverifiable[${i}]`;
        if (!isObject(u)) {
          errors.push(`${path}: expected object`);
          return;
        }
        if (typeof u.rawText !== 'string') {
          errors.push(`${path}.rawText: expected string`);
          return;
        }
        unverifiable.push({
          rawText: u.rawText,
          reason: typeof u.reason === 'string' ? u.reason : 'unspecified',
        });
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      schemaVersion,
      sessionId,
      source,
      claims,
      unverifiable,
    },
  };
}

function validateClaim(
  c: unknown,
  i: number,
  claims: Claim[],
  unverifiable: UnverifiableClaim[],
  errors: string[],
): void {
  const path = `$.claims[${i}]`;
  if (!isObject(c)) {
    errors.push(`${path}: expected object`);
    return;
  }

  // rawText is the one field we ALWAYS need to route an unverifiable claim.
  const rawText = typeof c.rawText === 'string' ? c.rawText : '';
  if (typeof c.rawText !== 'string') {
    errors.push(`${path}.rawText: expected string (the verbatim claim)`);
  }

  // Structural fields. These are hard validation errors (malformed input).
  if (typeof c.id !== 'string' || c.id.length === 0) {
    errors.push(`${path}.id: expected non-empty string`);
  }
  if (typeof c.subject !== 'string' || c.subject.length === 0) {
    errors.push(`${path}.subject: expected non-empty string`);
  }
  if (c.qualifiers !== undefined && !isObject(c.qualifiers)) {
    errors.push(`${path}.qualifiers: expected object of string values`);
  }
  const qualifiers: Record<string, string> = {};
  if (isObject(c.qualifiers)) {
    for (const [k, v] of Object.entries(c.qualifiers)) {
      if (typeof v !== 'string') {
        errors.push(`${path}.qualifiers.${k}: expected string`);
      } else {
        qualifiers[k] = v;
      }
    }
  }

  // category / predicate: UNKNOWN values are NOT hard errors — they route the
  // claim to `unverifiable` with a reason (never silently dropped).
  const categoryOk =
    typeof c.category === 'string' && CATEGORIES.has(c.category);
  const predicateOk =
    typeof c.predicate === 'string' && PREDICATES.has(c.predicate);

  if (typeof c.category !== 'string') {
    errors.push(`${path}.category: expected string`);
  }
  if (typeof c.predicate !== 'string') {
    errors.push(`${path}.predicate: expected string`);
  }

  // If structural fields already errored, stop (can't build a Claim).
  if (
    typeof c.id !== 'string' ||
    c.id.length === 0 ||
    typeof c.subject !== 'string' ||
    c.subject.length === 0 ||
    typeof c.rawText !== 'string'
  ) {
    return;
  }

  if (typeof c.category !== 'string' || typeof c.predicate !== 'string') {
    return;
  }

  if (!categoryOk || !predicateOk) {
    const bad: string[] = [];
    if (!categoryOk) bad.push(`category "${c.category}"`);
    if (!predicateOk) bad.push(`predicate "${c.predicate}"`);
    unverifiable.push({
      rawText,
      reason: `unknown ${bad.join(' and ')} — not a recognized claim shape`,
    });
    return;
  }

  claims.push({
    id: c.id,
    category: c.category as ClaimCategory,
    predicate: c.predicate as ClaimPredicate,
    subject: c.subject,
    qualifiers,
    rawText,
  });
}
