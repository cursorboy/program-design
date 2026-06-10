import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '../../src/core/schema.js';
import { normalizeManifest, readManifestFile } from '../../src/cli/claims-io.js';
import { PDError } from '../../src/cli/errors.js';

const tmpFiles: string[] = [];
function writeTmp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-claims-'));
  tmpFiles.push(dir);
  const path = join(dir, 'claims.json');
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  while (tmpFiles.length) {
    const d = tmpFiles.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

const validClaim = {
  id: 'c1',
  category: 'route',
  predicate: 'exists',
  subject: 'POST /api/login',
  qualifiers: { method: 'POST' },
  rawText: 'There is a login route',
};

describe('normalizeManifest — bare Claim[]', () => {
  it('wraps a valid array into a manifest with source=file', () => {
    const m = normalizeManifest([validClaim], 'sess-1');
    expect(m.source).toBe('file');
    expect(m.sessionId).toBe('sess-1');
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.claims).toHaveLength(1);
    expect(m.unverifiable).toEqual([]);
  });

  it('generates a sessionId when none given', () => {
    const m = normalizeManifest([validClaim]);
    expect(m.sessionId).toBeTruthy();
  });

  it('rejects a malformed claim in the array', () => {
    expect(() => normalizeManifest([{ id: 'x' }])).toThrowError(PDError);
    try {
      normalizeManifest([{ ...validClaim, category: 'bogus' }]);
    } catch (e) {
      expect((e as PDError).code).toBe('manifest-invalid');
    }
  });
});

describe('normalizeManifest — ClaimManifest object', () => {
  it('accepts a full manifest', () => {
    const m = normalizeManifest({
      schemaVersion: 1,
      sessionId: 's',
      source: 'agent',
      claims: [validClaim],
      unverifiable: [{ rawText: 'it works', reason: 'behavior claim' }],
    });
    expect(m.source).toBe('agent');
    expect(m.claims).toHaveLength(1);
    expect(m.unverifiable).toHaveLength(1);
  });

  it('defaults source to file for an unknown source', () => {
    const m = normalizeManifest({
      sessionId: 's',
      source: 'weird',
      claims: [validClaim],
    });
    expect(m.source).toBe('file');
  });

  it('rejects when claims is not an array', () => {
    expect(() => normalizeManifest({ claims: 'nope' })).toThrowError(PDError);
  });

  it('rejects a malformed claim by index', () => {
    expect(() =>
      normalizeManifest({ claims: [validClaim, { id: 'bad' }] }),
    ).toThrowError(PDError);
  });

  it('rejects a non-object, non-array root', () => {
    expect(() => normalizeManifest(42)).toThrowError(PDError);
  });

  it('rejects an invalid predicate', () => {
    expect(() =>
      normalizeManifest([{ ...validClaim, predicate: 'frobnicate' }]),
    ).toThrowError(PDError);
  });

  it('rejects qualifiers that are not an object', () => {
    expect(() =>
      normalizeManifest([{ ...validClaim, qualifiers: ['a'] }]),
    ).toThrowError(PDError);
  });
});

describe('readManifestFile', () => {
  it('reads a valid manifest file', () => {
    const path = writeTmp(JSON.stringify([validClaim]));
    const m = readManifestFile(path);
    expect(m.claims).toHaveLength(1);
  });

  it('throws manifest-invalid on a missing file', () => {
    try {
      readManifestFile('/no/such/file.json');
    } catch (e) {
      expect((e as PDError).code).toBe('manifest-invalid');
    }
  });

  it('throws manifest-invalid on bad JSON', () => {
    const path = writeTmp('{ not json ');
    try {
      readManifestFile(path);
    } catch (e) {
      expect((e as PDError).code).toBe('manifest-invalid');
    }
  });
});
