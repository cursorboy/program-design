import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import type { FactsGraph } from '../../src/core/schema.js';
import { prepareAuthoredMap, realFilesOf } from '../../src/cli/organize.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

const goodNode = {
  id: 'server:app',
  kind: 'server',
  label: 'The app server',
  technical: 'Next.js',
  file: 'app/api/login/route.ts:1',
};

describe('prepareAuthoredMap (the fact-anchor gate)', () => {
  it('rejects non-object maps and empty node lists', () => {
    expect(prepareAuthoredMap(graph, 'nope').ok).toBe(false);
    expect(prepareAuthoredMap(graph, { nodes: [] }).ok).toBe(false);
  });

  it('rejects nodes missing id/kind/label with pointed errors', () => {
    const r = prepareAuthoredMap(graph, { nodes: [{ id: 'x', kind: 'starship', label: 'X' }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/kind must be one of/);
  });

  it('installs a receipted map stamped generatedBy llm', () => {
    const r = prepareAuthoredMap(graph, {
      what: 'A tiny app.',
      nodes: [goodNode],
      edges: [],
    });
    expect(r.ok).toBe(true);
    expect(r.map!.generatedBy).toBe('llm');
    expect(r.nodesKept).toBe(1);
  });

  it('DROPS nodes whose receipt does not resolve to a real repo file, and their edges', () => {
    const r = prepareAuthoredMap(graph, {
      nodes: [
        goodNode,
        { id: 'ext:made-up', kind: 'externalService', label: 'Invented', file: 'lib/notreal.ts:3' },
      ],
      edges: [{ from: 'server:app', to: 'ext:made-up', flows: 'imaginary' }],
    });
    expect(r.ok).toBe(true);
    expect(r.nodesKept).toBe(1);
    expect(r.nodesDropped).toBe(1);
    expect(r.edgesKept).toBe(0);
    expect(r.edgesDropped).toBe(1);
  });

  it('fails closed when EVERY node is unanchored', () => {
    const r = prepareAuthoredMap(graph, {
      nodes: [{ id: 'a', kind: 'server', label: 'A', file: 'nope.ts:1' }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/every node was dropped/);
  });

  it('backstops layer and provider deterministically when omitted', () => {
    const r = prepareAuthoredMap(graph, {
      nodes: [
        { id: 'db:x', kind: 'database', label: 'DB', technical: 'Postgres on Neon', file: 'prisma/schema.prisma:1' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.map!.nodes[0]!.layer).toBe('data');
    expect(r.map!.nodes[0]!.provider).toBe('neon');
  });

  it('keeps tour beats but drops reveal ids that are not in the validated map', () => {
    const r = prepareAuthoredMap(
      graph,
      { nodes: [goodNode] },
      { title: 'Tour', beats: [{ caption: 'Look at this.', reveal: ['server:app', 'ghost:nope'] }] },
    );
    expect(r.ok).toBe(true);
    expect(r.tour!.generatedBy).toBe('llm');
    expect(r.tour!.beats[0]!.reveal).toEqual(['server:app']);
    expect(r.revealsDropped).toBe(1);
  });

  it('realFilesOf covers walked files and provenance files', () => {
    const files = realFilesOf(graph);
    expect(files.has('app/api/login/route.ts')).toBe(true);
    expect(files.has('prisma/schema.prisma')).toBe(true);
  });
});
