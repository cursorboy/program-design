/**
 * persistsTo extraction.
 *
 * Allowlist-spirit: a write through a prisma/db root to a KNOWN model emits a
 * display-only `persistsTo` edge (route → dbTable). Reads, computed property
 * access, and unknown models emit nothing. The rule-ran counter is always
 * recorded (even 0).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extractGraph } from '../../src/core/extract/index.js';
import type { FactsGraph, FactEdge } from '../../src/core/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, '..', '..', 'fixtures', 'sample-app');

const tmpDirs: string[] = [];

function scaffold(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'pd-persists-'));
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

function persistsEdges(g: FactsGraph): FactEdge[] {
  return g.edges.filter((e) => e.kind === 'persistsTo');
}

const PRISMA_SCHEMA = `
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`;
const PKG = JSON.stringify({ name: 't', dependencies: { next: '15.0.0' } });

describe('persistsTo: sample-app fixture (real route write)', () => {
  let graph: FactsGraph;
  beforeAll(async () => {
    graph = await extractGraph(SAMPLE);
  });

  it('emits route → User for db.user.create in the login route handler', () => {
    const edge = persistsEdges(graph).find(
      (e) => e.from === 'route:POST /api/login' && e.to === 'dbTable:User',
    );
    expect(edge).toBeDefined();
    expect(edge!.kind).toBe('persistsTo');
    expect(edge!.provenance?.ruleId).toBe('persists/prisma-write');
    // Provenance points at the db.user.create(...) call site, not the read above.
    expect(edge!.provenance?.file).toBe('app/api/login/route.ts');
    expect(edge!.provenance?.line).toBe(7);
    expect(edge!.invalidatedBy).toEqual(['app/api/login/route.ts']);
  });

  it('does NOT emit an edge for the read-only db.user.findUnique on the line above', () => {
    // Only one persistsTo edge from the login route — the create, never the read.
    const fromLogin = persistsEdges(graph).filter(
      (e) => e.from === 'route:POST /api/login',
    );
    expect(fromLogin).toHaveLength(1);
  });

  it('records the rule-ran counter in stats', () => {
    expect(graph.stats['persists/prisma-write']).toBeGreaterThanOrEqual(1);
  });
});

describe('persistsTo: negative cases (allowlist-spirit — emit nothing)', () => {
  it('read-only access (db.user.findMany) → NO edge', async () => {
    const root = scaffold({
      'package.json': PKG,
      'prisma/schema.prisma': PRISMA_SCHEMA,
      'lib/db.ts': `export const db = {} as any;\n`,
      'app/api/r/route.ts':
        `import { db } from '../../../lib/db';\n` +
        `export async function GET() {\n` +
        `  const u = await db.user.findMany();\n` +
        `  return Response.json(u);\n` +
        `}\n`,
    });
    const g = await extractGraph(root);
    expect(persistsEdges(g)).toHaveLength(0);
    // Counter still present (rule ran, found nothing).
    expect(g.stats['persists/prisma-write']).toBe(0);
  });

  it('computed property (db[model].create) → NO edge', async () => {
    const root = scaffold({
      'package.json': PKG,
      'prisma/schema.prisma': PRISMA_SCHEMA,
      'lib/db.ts': `export const db = {} as any;\n`,
      'app/api/r/route.ts':
        `import { db } from '../../../lib/db';\n` +
        `export async function POST() {\n` +
        `  const model = 'user';\n` +
        `  await db[model].create({ data: {} });\n` +
        `  return Response.json({});\n` +
        `}\n`,
    });
    const g = await extractGraph(root);
    expect(persistsEdges(g)).toHaveLength(0);
    expect(g.stats['persists/prisma-write']).toBe(0);
  });

  it('unknown model name (db.widget.create) → NO edge', async () => {
    const root = scaffold({
      'package.json': PKG,
      'prisma/schema.prisma': PRISMA_SCHEMA,
      'lib/db.ts': `export const db = {} as any;\n`,
      'app/api/r/route.ts':
        `import { db } from '../../../lib/db';\n` +
        `export async function POST() {\n` +
        `  await db.widget.create({ data: {} });\n` +
        `  return Response.json({});\n` +
        `}\n`,
    });
    const g = await extractGraph(root);
    expect(persistsEdges(g)).toHaveLength(0);
    expect(g.stats['persists/prisma-write']).toBe(0);
  });

  it('rule runs and records the counter even when there are no writes at all', async () => {
    const root = scaffold({
      'package.json': PKG,
      'prisma/schema.prisma': PRISMA_SCHEMA,
      'app/page.tsx': `export default function P() { return null; }\n`,
    });
    const g = await extractGraph(root);
    expect(g.stats['persists/prisma-write']).toBe(0);
  });
});

describe('persistsTo: from a known model in a lib/ file falls back to the file node', () => {
  it('attributes to the file node when the write is not inside a route file', async () => {
    const root = scaffold({
      'package.json': PKG,
      'prisma/schema.prisma': PRISMA_SCHEMA,
      'lib/db.ts': `export const db = {} as any;\n`,
      'lib/users.ts':
        `import { db } from './db';\n` +
        `export async function makeUser(email: string) {\n` +
        `  return db.user.create({ data: { email } });\n` +
        `}\n`,
    });
    const g = await extractGraph(root);
    const edge = persistsEdges(g).find((e) => e.to === 'dbTable:User');
    expect(edge).toBeDefined();
    expect(edge!.from).toBe('file:lib/users.ts');
    expect(edge!.provenance?.line).toBe(3);
  });
});
