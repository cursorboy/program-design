import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import type { FactsGraph } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

describe('parse-failure handling (no partial facts)', () => {
  it('records the broken file as a ParseFailure', () => {
    const pf = graph.parseFailures.find((f) => f.file === 'lib/brokenParse.ts');
    expect(pf).toBeDefined();
    expect(pf!.reason).toBeTruthy();
  });

  it('does NOT emit partial facts from the broken file', () => {
    // The broken file references process.env.SHOULD_NOT_BE_EXTRACTED — that env
    // var must never appear because the file failed to parse.
    const leaked = graph.nodes.find(
      (n) => n.kind === 'envVar' && n.name === 'SHOULD_NOT_BE_EXTRACTED',
    );
    expect(leaked).toBeUndefined();

    // No fact should carry the broken file in its provenance (except the file node
    // itself, which is metadata-only and safe).
    const factsFromBroken = graph.nodes.filter(
      (n) =>
        n.kind !== 'file' &&
        n.provenance?.file === 'lib/brokenParse.ts',
    );
    expect(factsFromBroken).toHaveLength(0);
  });

  it('still extracts everything else (extraction never crashes)', () => {
    expect(graph.nodes.filter((n) => n.kind === 'route').length).toBeGreaterThan(0);
    expect(graph.nodes.filter((n) => n.kind === 'dbTable').length).toBeGreaterThan(0);
  });

  it('records the parse failure count in stats', () => {
    expect(graph.stats.parseFailures).toBeGreaterThanOrEqual(1);
  });
});
