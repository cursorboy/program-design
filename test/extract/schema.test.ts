import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import { extractPrisma } from '../../src/core/extract/prisma.js';
import type { FactsGraph } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

let graph: FactsGraph;
beforeAll(async () => {
  graph = await extractGraph(SAMPLE);
});

describe('prisma schema extraction', () => {
  it('extracts both models as dbTable nodes', () => {
    const tables = graph.nodes
      .filter((n) => n.kind === 'dbTable')
      .map((n) => n.name)
      .sort();
    expect(tables).toEqual(['Post', 'User']);
  });

  it('extracts columns with table-qualified names', () => {
    const cols = graph.nodes
      .filter((n) => n.kind === 'dbColumn')
      .map((n) => n.name);
    expect(cols).toContain('User.id');
    expect(cols).toContain('User.email');
    expect(cols).toContain('User.createdAt');
  });

  it('does NOT invent columns that are not in the schema', () => {
    const cols = graph.nodes
      .filter((n) => n.kind === 'dbColumn')
      .map((n) => n.name);
    expect(cols).not.toContain('User.phone');
  });

  it('emits hasColumn edges from table to each column', () => {
    const userCols = graph.edges.filter(
      (e) => e.kind === 'hasColumn' && e.from === 'dbTable:User',
    );
    const targets = userCols.map((e) => e.to);
    expect(targets).toContain('dbColumn:User.email');
    expect(userCols.length).toBeGreaterThanOrEqual(4);
  });

  it('uses the schema/prisma-model ruleId with provenance', () => {
    const user = graph.nodes.find((n) => n.name === 'User' && n.kind === 'dbTable')!;
    expect(user.provenance!.ruleId).toBe('schema/prisma-model');
    expect(user.provenance!.file).toBe('prisma/schema.prisma');
    expect(user.provenance!.line).toBeGreaterThanOrEqual(1);
  });

  it('records schemaSource present in stats', () => {
    expect(graph.stats.schemaSource).toBe(1);
  });

  it('missing schema.prisma → no nodes, schemaSource absent', () => {
    const res = extractPrisma(join(here, 'does-not-exist'));
    expect(res.nodes).toHaveLength(0);
    expect(res.schemaSource).toBe('absent');
  });
});
