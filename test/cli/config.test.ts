import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseConfig,
  mergeConfig,
  resolveEffective,
  loadConfig,
  DEFAULT_CONFIG,
  CONFIG_FILENAME,
} from '../../src/cli/config.js';

const tmpDirs: string[] = [];
function makeRepo(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-config-'));
  tmpDirs.push(dir);
  if (config !== undefined) {
    writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify(config));
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('parseConfig', () => {
  it('parses a full valid config', () => {
    const p = parseConfig({
      port: 5000,
      debounce: 250,
      ignoreGlobs: ['**/gen/**'],
      authGuards: ['withFoo'],
      daemon: { autostart: false },
      theme: { '--accent': '#fff' },
    });
    expect(p.port).toBe(5000);
    expect(p.debounce).toBe(250);
    expect(p.ignoreGlobs).toEqual(['**/gen/**']);
    expect(p.authGuards).toEqual(['withFoo']);
    expect(p.daemon).toEqual({ autostart: false });
    expect(p.theme).toEqual({ '--accent': '#fff' });
  });

  it('returns only present keys (partial)', () => {
    const p = parseConfig({ port: 8080 });
    expect(p.port).toBe(8080);
    expect(p.debounce).toBeUndefined();
    expect(p.daemon).toBeUndefined();
  });

  it('rejects a non-object root', () => {
    expect(() => parseConfig([])).toThrow();
    expect(() => parseConfig('nope')).toThrow();
    expect(() => parseConfig(null)).toThrow();
  });

  it('rejects wrong types per field', () => {
    expect(() => parseConfig({ port: 'x' })).toThrow();
    expect(() => parseConfig({ ignoreGlobs: 'x' })).toThrow();
    expect(() => parseConfig({ ignoreGlobs: [1] })).toThrow();
    expect(() => parseConfig({ daemon: { autostart: 'yes' } })).toThrow();
    expect(() => parseConfig({ theme: { '--x': 1 } })).toThrow();
  });
});

describe('mergeConfig', () => {
  it('fills defaults for absent keys', () => {
    const c = mergeConfig({ port: 9 });
    expect(c.port).toBe(9);
    expect(c.debounce).toBe(DEFAULT_CONFIG.debounce);
    expect(c.daemon).toEqual(DEFAULT_CONFIG.daemon);
  });

  it('an empty partial yields defaults', () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });
});

describe('resolveEffective — precedence', () => {
  const config = mergeConfig({ port: 1000, debounce: 100, ignoreGlobs: ['a'] });

  it('CLI flags override config', () => {
    const eff = resolveEffective(config, {
      port: 2000,
      debounce: 200,
      ignore: ['b'],
    });
    expect(eff).toEqual({ port: 2000, debounce: 200, ignoreGlobs: ['b'] });
  });

  it('config wins when no flag supplied', () => {
    const eff = resolveEffective(config, {});
    expect(eff).toEqual({ port: 1000, debounce: 100, ignoreGlobs: ['a'] });
  });

  it('empty ignore flag falls back to config (not empty override)', () => {
    const eff = resolveEffective(config, { ignore: [] });
    expect(eff.ignoreGlobs).toEqual(['a']);
  });

  it('defaults apply when config also empty', () => {
    const eff = resolveEffective(mergeConfig({}), {});
    expect(eff.port).toBe(DEFAULT_CONFIG.port);
    expect(eff.debounce).toBe(DEFAULT_CONFIG.debounce);
  });
});

describe('loadConfig', () => {
  it('returns defaults when no file exists', () => {
    const repo = makeRepo();
    const res = loadConfig(repo);
    expect(res.source).toBeNull();
    expect(res.config).toEqual(DEFAULT_CONFIG);
  });

  it('loads and merges a valid file', () => {
    const repo = makeRepo({ port: 7777 });
    const res = loadConfig(repo);
    expect(res.source).not.toBeNull();
    expect(res.config.port).toBe(7777);
    expect(res.config.debounce).toBe(DEFAULT_CONFIG.debounce);
  });

  it('surfaces an error and falls back to defaults on invalid file', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, CONFIG_FILENAME), '{ not json');
    const res = loadConfig(repo);
    expect(res.error).toBeTruthy();
    expect(res.config).toEqual(DEFAULT_CONFIG);
  });

  it('surfaces a validation error on a typed-wrong field', () => {
    const repo = makeRepo({ port: 'oops' });
    const res = loadConfig(repo);
    expect(res.error).toBeTruthy();
    expect(res.config).toEqual(DEFAULT_CONFIG);
  });
});
