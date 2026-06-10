/**
 * Prisma schema extraction — hand-rolled line parser.
 *
 * The Prisma DSL is line-regular: `model X { ... }` with one `field Type @attr`
 * per line. This is deterministic and does not need a full grammar.
 *
 * Emits: dbTable + dbColumn nodes + hasColumn edges. ruleId "schema/prisma-model".
 * Missing schema.prisma → no nodes; the caller records stats.schemaSource.
 */
import { join } from 'node:path';
import {
  makeNodeId,
  makeEdgeId,
  type FactNode,
  type FactEdge,
} from '../schema.js';
import { existsSync, readFileSync, toRel } from './common.js';

export interface PrismaResult {
  nodes: FactNode[];
  edges: FactEdge[];
  /** 'present' | 'absent' — recorded into stats.schemaSource. */
  schemaSource: 'present' | 'absent';
  schemaFileRel: string | null;
}

const PRISMA_CANDIDATES = [
  ['prisma', 'schema.prisma'],
  ['schema.prisma'],
];

export function findPrismaSchema(repoRoot: string): string | null {
  for (const parts of PRISMA_CANDIDATES) {
    const abs = join(repoRoot, ...parts);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export function extractPrisma(repoRoot: string): PrismaResult {
  const nodes: FactNode[] = [];
  const edges: FactEdge[] = [];
  const abs = findPrismaSchema(repoRoot);

  if (!abs) {
    return { nodes, edges, schemaSource: 'absent', schemaFileRel: null };
  }

  const rel = toRel(repoRoot, abs);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    // Treated as absent for schema purposes; never crash.
    return { nodes, edges, schemaSource: 'absent', schemaFileRel: rel };
  }

  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = stripComment(raw).trim();
    const modelMatch = /^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(line);
    if (!modelMatch) {
      i++;
      continue;
    }
    const modelName = modelMatch[1]!;
    const modelLineNo = i + 1; // 1-based
    const tableId = makeNodeId('dbTable', modelName);
    nodes.push({
      id: tableId,
      kind: 'dbTable',
      name: modelName,
      provenance: { file: rel, line: modelLineNo, ruleId: 'schema/prisma-model' },
      attrs: { model: modelName },
      invalidatedBy: [rel],
    });

    // Parse fields until the closing brace.
    i++;
    while (i < lines.length) {
      const fraw = lines[i] ?? '';
      const fline = stripComment(fraw).trim();
      if (fline === '}') {
        i++;
        break;
      }
      if (fline === '') {
        i++;
        continue;
      }
      // Block-level attributes (@@index, @@unique, @@map) are not columns.
      if (fline.startsWith('@@')) {
        i++;
        continue;
      }
      const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_.]*)(\??|\[\])?/.exec(
        fline,
      );
      if (fieldMatch) {
        const fieldName = fieldMatch[1]!;
        const fieldType = fieldMatch[2]!;
        const optionality = fieldMatch[3] ?? '';
        const colName = `${modelName}.${fieldName}`;
        const colId = makeNodeId('dbColumn', colName);
        const colLineNo = i + 1;
        nodes.push({
          id: colId,
          kind: 'dbColumn',
          name: colName,
          provenance: { file: rel, line: colLineNo, ruleId: 'schema/prisma-field' },
          attrs: {
            table: modelName,
            column: fieldName,
            type: fieldType,
            list: optionality === '[]',
            optional: optionality === '?',
          },
          invalidatedBy: [rel],
        });
        edges.push({
          id: makeEdgeId('hasColumn', tableId, colId),
          kind: 'hasColumn',
          from: tableId,
          to: colId,
          provenance: { file: rel, line: colLineNo, ruleId: 'schema/prisma-field' },
          invalidatedBy: [rel],
        });
      }
      i++;
    }
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges, schemaSource: 'present', schemaFileRel: rel };
}

/** Strip a // line comment, respecting nothing fancy (DSL has no string fields). */
function stripComment(line: string): string {
  const idx = line.indexOf('//');
  return idx < 0 ? line : line.slice(0, idx);
}
