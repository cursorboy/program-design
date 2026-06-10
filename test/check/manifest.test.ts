import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/core/check/index.js';
import { SCHEMA_VERSION } from '../../src/core/schema.js';

function base(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: 's1',
    source: 'agent',
    claims: [],
    ...extra,
  };
}

describe('validateManifest', () => {
  it('rejects non-object with $ path error', () => {
    const r = validateManifest(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('$:');
  });

  it('reports precise path for bad schemaVersion', () => {
    const r = validateManifest(base({ schemaVersion: 'x' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('$.schemaVersion'))).toBe(true);
  });

  it('reports missing sessionId and bad source', () => {
    const r = validateManifest({ schemaVersion: SCHEMA_VERSION, source: 'nope', claims: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('$.sessionId'))).toBe(true);
      expect(r.errors.some((e) => e.includes('$.source'))).toBe(true);
    }
  });

  it('accepts a well-formed manifest', () => {
    const r = validateManifest(
      base({
        claims: [
          { id: 'c1', category: 'route', predicate: 'exists', subject: '/api/x', qualifiers: { method: 'GET' }, rawText: 'added GET /api/x' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.claims.length).toBe(1);
      expect(r.manifest.claims[0]!.subject).toBe('/api/x');
    }
  });

  it('moves unknown category to unverifiable (never dropped, no hard error)', () => {
    const r = validateManifest(
      base({
        claims: [
          { id: 'c1', category: 'telemetry', predicate: 'exists', subject: 'x', rawText: 'added telemetry' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.claims.length).toBe(0);
      expect(r.manifest.unverifiable.length).toBe(1);
      expect(r.manifest.unverifiable[0]!.reason).toContain('telemetry');
      expect(r.manifest.unverifiable[0]!.rawText).toBe('added telemetry');
    }
  });

  it('moves unknown predicate to unverifiable', () => {
    const r = validateManifest(
      base({ claims: [{ id: 'c1', category: 'route', predicate: 'frobnicates', subject: '/x', rawText: 'r' }] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.unverifiable.length).toBe(1);
  });

  it('hard-errors on structurally malformed claim (missing id/subject)', () => {
    const r = validateManifest(
      base({ claims: [{ category: 'route', predicate: 'exists', rawText: 'r' }] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('$.claims[0].id'))).toBe(true);
      expect(r.errors.some((e) => e.includes('$.claims[0].subject'))).toBe(true);
    }
  });

  it('rejects non-string qualifier value with path', () => {
    const r = validateManifest(
      base({ claims: [{ id: 'c1', category: 'route', predicate: 'exists', subject: '/x', qualifiers: { method: 5 }, rawText: 'r' }] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('qualifiers.method'))).toBe(true);
  });

  it('preserves an incoming unverifiable list', () => {
    const r = validateManifest(
      base({ unverifiable: [{ rawText: 'rate limiting works', reason: 'behavior claim — presence-only tool' }] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.unverifiable.length).toBe(1);
  });
});
