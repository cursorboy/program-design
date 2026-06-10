import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainEntry } from '../../src/cli/entry.js';

let dir: string;
let realFile: string;
let linkFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-entry-'));
  realFile = join(dir, 'cli.js');
  writeFileSync(realFile, '// entry fixture\n');
  linkFile = join(dir, 'bin-shim');
  symlinkSync(realFile, linkFile);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isMainEntry (symlink-safe entry detection)', () => {
  it('matches a direct invocation of the real path', () => {
    expect(isMainEntry(realFile, pathToFileURL(realFile).href)).toBe(true);
  });

  it('matches when invoked through a symlink — the npx .bin shim case', () => {
    // npm installs bin as a node_modules/.bin SYMLINK; Node realpaths
    // import.meta.url, so a naive string compare fails and the CLI silently
    // does nothing. This is the v0.1.0 regression.
    expect(isMainEntry(linkFile, pathToFileURL(realFile).href)).toBe(true);
  });

  it('rejects a different file and missing argv', () => {
    const other = join(dir, 'other.js');
    writeFileSync(other, '');
    expect(isMainEntry(other, pathToFileURL(realFile).href)).toBe(false);
    expect(isMainEntry(undefined, pathToFileURL(realFile).href)).toBe(false);
  });

  it('returns false (never throws) for a nonexistent argv path', () => {
    expect(isMainEntry(join(dir, 'ghost.js'), pathToFileURL(realFile).href)).toBe(false);
  });
});
