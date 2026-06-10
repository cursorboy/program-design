import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatcher } from '../../src/core/watch.js';
import type { FactsGraph } from '../../src/core/schema.js';

const tmpDirs: string[] = [];

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), 'pd-watch-'));
  tmpDirs.push(root);
  mkdirSync(join(root, 'app'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 't', dependencies: { next: '15.0.0' } }),
  );
  writeFileSync(join(root, 'app', 'page.tsx'), 'export default function P(){return null}');
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

describe('createWatcher', () => {
  it('re-extracts on a file change and delivers a fresh graph', async () => {
    const root = scaffold();
    const graphs: FactsGraph[] = [];
    const handle = createWatcher(root, (g) => graphs.push(g), { debounceMs: 50 });

    const aboutDir = join(root, 'app', 'about');
    const aboutPage = join(aboutDir, 'page.tsx');
    mkdirSync(aboutDir, { recursive: true });

    // A fresh graph containing the new route is the real success condition.
    // Waiting merely for "any graph" raced: an extraction triggered by the
    // initial event burst could deliver a graph that predates about/page.tsx.
    // Re-touching the file every 500ms also defeats the chokidar-setup race
    // (an event is guaranteed to fire after the watcher is actually ready).
    const hasAbout = () =>
      graphs.some((g) =>
        g.nodes.some((n) => n.kind === 'route' && n.name === 'GET /about'),
      );
    const deadline = Date.now() + 12_000;
    while (!hasAbout() && Date.now() < deadline) {
      writeFileSync(aboutPage, 'export default function A(){return null}');
      await new Promise((r) => setTimeout(r, 500));
    }

    await handle.close();

    expect(hasAbout()).toBe(true);
    const match = graphs.find((g) =>
      g.nodes.some((n) => n.kind === 'route' && n.name === 'GET /about'),
    )!;
    expect(match.buildActive).toBe(true);
  }, 20_000);
});
