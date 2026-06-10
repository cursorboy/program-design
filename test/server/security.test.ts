import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSnippet,
  isLoopbackHost,
  tokensMatch,
} from '../../src/server/security.js';

describe('tokensMatch', () => {
  it('rejects undefined / mismatched / wrong-length', () => {
    expect(tokensMatch(undefined, 'abc')).toBe(false);
    expect(tokensMatch('abcd', 'abc')).toBe(false);
    expect(tokensMatch('xyz', 'abc')).toBe(false);
  });
  it('accepts exact match', () => {
    expect(tokensMatch('deadbeef', 'deadbeef')).toBe(true);
  });
});

describe('isLoopbackHost', () => {
  it('accepts loopback hosts with and without port', () => {
    expect(isLoopbackHost('127.0.0.1:4317', 4317)).toBe(true);
    expect(isLoopbackHost('localhost:4317', 4317)).toBe(true);
    expect(isLoopbackHost('127.0.0.1', 4317)).toBe(true);
    expect(isLoopbackHost('[::1]:4317', 4317)).toBe(true);
  });
  it('rejects non-loopback / rebinding hosts', () => {
    expect(isLoopbackHost('evil.com', 4317)).toBe(false);
    expect(isLoopbackHost('evil.com:4317', 4317)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:9999', 4317)).toBe(false);
    expect(isLoopbackHost(undefined, 4317)).toBe(false);
    expect(isLoopbackHost('attacker.localhost', 4317)).toBe(false);
  });
});

describe('readSnippet jail', () => {
  let repo: string;
  let outside: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'pd-repo-'));
    outside = mkdtempSync(join(tmpdir(), 'pd-outside-'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'a.ts'), 'l1\nl2\nl3\nl4\nl5\n', 'utf8');
    writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET\n', 'utf8');
    // symlink inside the repo pointing OUT of the repo
    try {
      symlinkSync(join(outside, 'secret.txt'), join(repo, 'src', 'escape.ts'));
    } catch {
      /* symlink may fail on some CI; the test below tolerates it */
    }
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('serves ±2 lines for a file inside the repo (200)', () => {
    const r = readSnippet(repo, 'src/a.ts', 3, 2);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.lines).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(r.centerLine).toBe(3);
  });

  it('rejects `..` traversal (403)', () => {
    const r = readSnippet(repo, '../pd-outside-x/secret.txt', 1, 2);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it('rejects an absolute path escaping the repo (403)', () => {
    const r = readSnippet(repo, join(outside, 'secret.txt'), 1, 2);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it('rejects a symlink that escapes the repo (403)', () => {
    const r = readSnippet(repo, 'src/escape.ts', 1, 2);
    // either the symlink resolved out → 403, or the platform refused the
    // symlink → 404. Never 200 with secret contents.
    expect(r.ok).toBe(false);
    expect(r.lines).toBeUndefined();
    expect([403, 404]).toContain(r.status);
  });

  it('returns 404 for a missing file', () => {
    const r = readSnippet(repo, 'src/nope.ts', 1, 2);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });

  it('clamps the line window to file bounds', () => {
    const r = readSnippet(repo, 'src/a.ts', 1, 2);
    expect(r.ok).toBe(true);
    expect(r.startLine).toBe(1);
    expect(r.lines?.[0]).toBe('l1');
  });
});
