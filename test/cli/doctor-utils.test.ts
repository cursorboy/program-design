import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nodeMajor,
  pidAlive,
  looksLikeNextRepo,
} from '../../src/cli/doctor-utils.js';

const tmpDirs: string[] = [];
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-doctor-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('nodeMajor', () => {
  it('parses common version strings', () => {
    expect(nodeMajor('v20.1.0')).toBe(20);
    expect(nodeMajor('22.0.0')).toBe(22);
    expect(nodeMajor('v18.19.1')).toBe(18);
  });

  it('returns 0 for garbage', () => {
    expect(nodeMajor('nonsense')).toBe(0);
    expect(nodeMajor('')).toBe(0);
  });
});

describe('pidAlive', () => {
  it('reports the current process as alive', () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it('reports an almost-certainly-dead pid as not alive', () => {
    // 2^31-ish pid that will not exist.
    expect(pidAlive(2147480000)).toBe(false);
  });
});

describe('looksLikeNextRepo', () => {
  it('true when an app/ dir exists', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'app'));
    expect(looksLikeNextRepo(repo)).toBe(true);
  });

  it('true when a pages/ dir exists', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'pages'));
    expect(looksLikeNextRepo(repo)).toBe(true);
  });

  it('true when next is a dependency', () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0' } }),
    );
    expect(looksLikeNextRepo(repo)).toBe(true);
  });

  it('true when next is a devDependency', () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ devDependencies: { next: '15.0.0' } }),
    );
    expect(looksLikeNextRepo(repo)).toBe(true);
  });

  it('false for an empty dir', () => {
    expect(looksLikeNextRepo(makeRepo())).toBe(false);
  });

  it('false when package.json has no next', () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ dependencies: { react: '19' } }),
    );
    expect(looksLikeNextRepo(repo)).toBe(false);
  });

  it('false (not a crash) on malformed package.json', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'package.json'), '{ broken');
    expect(looksLikeNextRepo(repo)).toBe(false);
  });
});
