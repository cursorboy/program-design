/**
 * Middleware attachment tiers under synthetic repos written to a temp dir:
 *   - no matcher        → tier 'global-exists', attaches to all routes
 *   - dynamic matcher   → NO attachment edges, node attrs.matcherDynamic=true
 *   - no middleware     → no middleware node at all (checker → ABSENT-eligible)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';

const tmpDirs: string[] = [];

function scaffold(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'pd-mw-'));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return root;
}

afterAll(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const PKG = JSON.stringify({ name: 't', dependencies: { next: '15.0.0' } });

describe('middleware: no matcher → global-exists tier', () => {
  it('attaches to every route with tier global-exists', async () => {
    const root = scaffold({
      'package.json': PKG,
      'app/page.tsx': 'export default function P(){return null}',
      'app/dash/page.tsx': 'export default function P(){return null}',
      'middleware.ts': `export default function middleware(){}\n`,
    });
    const g = await extractGraph(root);
    const mw = g.nodes.find((n) => n.kind === 'middleware');
    expect(mw).toBeDefined();
    expect(mw!.attrs.matcherDynamic).toBe(false);
    const edges = g.edges.filter((e) => e.kind === 'attachedTo');
    expect(edges.length).toBe(2);
    for (const e of edges) expect(e.tier).toBe('global-exists');
  });
});

describe('middleware: dynamic (computed) matcher → no edges, matcherDynamic flag', () => {
  it('emits NO attachment edges and flags matcherDynamic', async () => {
    const root = scaffold({
      'package.json': PKG,
      'app/page.tsx': 'export default function P(){return null}',
      'middleware.ts':
        `const paths = ['/api/:path*'];\n` +
        `export default function middleware(){}\n` +
        `export const config = { matcher: paths };\n`,
    });
    const g = await extractGraph(root);
    const mw = g.nodes.find((n) => n.kind === 'middleware');
    expect(mw).toBeDefined();
    expect(mw!.attrs.matcherDynamic).toBe(true);
    const edges = g.edges.filter((e) => e.kind === 'attachedTo');
    expect(edges).toHaveLength(0);
  });
});

describe('middleware: none present → no middleware node', () => {
  it('emits zero middleware nodes', async () => {
    const root = scaffold({
      'package.json': PKG,
      'app/page.tsx': 'export default function P(){return null}',
    });
    const g = await extractGraph(root);
    expect(g.nodes.filter((n) => n.kind === 'middleware')).toHaveLength(0);
  });
});
