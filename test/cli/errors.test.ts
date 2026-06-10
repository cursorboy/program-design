import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  ERROR_CATALOG,
  ERROR_CODES,
  PDError,
  fail,
  formatError,
  docsLink,
} from '../../src/cli/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const errorsDocPath = join(here, '../../docs/errors.md');

describe('error catalog', () => {
  it('has the minimum required codes', () => {
    const required = [
      'not-a-nextjs-repo',
      'unsupported-stack',
      'narrator-unavailable',
      'stale-daemon',
      'port-conflict',
      'node-version',
      'manifest-invalid',
      'graph-corrupt',
    ];
    for (const code of required) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('every entry has a problem, cause, and fix', () => {
    for (const code of ERROR_CODES) {
      const spec = ERROR_CATALOG[code];
      expect(spec.problem.length, `${code}.problem`).toBeGreaterThan(0);
      expect(spec.cause.length, `${code}.cause`).toBeGreaterThan(0);
      expect(spec.fix.length, `${code}.fix`).toBeGreaterThan(0);
    }
  });

  it('every code has a matching anchor in docs/errors.md', () => {
    const doc = readFileSync(errorsDocPath, 'utf8');
    for (const code of ERROR_CODES) {
      // GitHub slugifies "## not-a-nextjs-repo" → "#not-a-nextjs-repo".
      expect(doc, `missing heading for ${code}`).toContain(`## ${code}`);
    }
  });
});

describe('PDError', () => {
  it('carries code, cause_, fix, docs', () => {
    const err = new PDError('port-conflict');
    expect(err.code).toBe('port-conflict');
    expect(err.cause_).toBe(ERROR_CATALOG['port-conflict'].cause);
    expect(err.fix).toBe(ERROR_CATALOG['port-conflict'].fix);
    expect(err.docs).toBe(docsLink('port-conflict'));
    expect(err).toBeInstanceOf(Error);
  });

  it('appends detail to the problem message', () => {
    const err = new PDError('manifest-invalid', 'claims[0] is malformed.');
    expect(err.message).toContain(ERROR_CATALOG['manifest-invalid'].problem);
    expect(err.message).toContain('claims[0] is malformed.');
  });

  it('docsLink points at the right anchor', () => {
    expect(docsLink('graph-corrupt')).toMatch(/docs\/errors\.md#graph-corrupt$/);
  });
});

describe('fail', () => {
  it('throws a PDError with the given code', () => {
    expect(() => fail('node-version')).toThrowError(PDError);
    try {
      fail('stale-daemon');
    } catch (e) {
      expect((e as PDError).code).toBe('stale-daemon');
    }
  });
});

describe('formatError', () => {
  it('renders problem, cause, fix, docs', () => {
    const out = formatError(new PDError('not-a-nextjs-repo'));
    expect(out).toContain('[not-a-nextjs-repo]');
    expect(out).toContain('Problem:');
    expect(out).toContain('Cause:');
    expect(out).toContain('Fix:');
    expect(out).toContain('Docs:');
    expect(out).toContain('docs/errors.md#not-a-nextjs-repo');
  });
});
