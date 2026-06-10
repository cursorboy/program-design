/**
 * File node extraction.
 *
 * Emits a `file` node per non-ignored file. attrs are capped to byte size + kind.
 * ruleId "files/source-file". These nodes are referenced by env `reads` edges and
 * dependency `dependsOn` edges (from other modules).
 */
import { extname } from 'node:path';
import { makeNodeId, type FactNode } from '../schema.js';
import { toRel, fileMeta } from './common.js';

export interface FilesResult {
  nodes: FactNode[];
}

/** Coarse kind classification for display + checker. Cheap and deterministic. */
function classify(rel: string): string {
  const ext = extname(rel).toLowerCase();
  const base = rel.split('/').pop() ?? '';
  const baseNoExt = base.replace(/\.[^.]+$/, '');
  if (baseNoExt === 'page') return 'page';
  if (baseNoExt === 'route') return 'route-handler';
  if (baseNoExt === 'layout') return 'layout';
  if (baseNoExt === 'middleware' && (rel === 'middleware.ts' || rel === 'src/middleware.ts'))
    return 'middleware';
  if (ext === '.prisma') return 'schema';
  if (ext === '.tsx' || ext === '.jsx') return 'component';
  if (ext === '.ts' || ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'module';
  if (ext === '.json') return 'config';
  return 'file';
}

export function extractFiles(repoRoot: string, absFiles: string[]): FilesResult {
  const nodes: FactNode[] = [];
  for (const abs of absFiles) {
    const meta = fileMeta(repoRoot, abs);
    if (!meta) continue;
    const rel = meta.relPath;
    const id = makeNodeId('file', rel);
    nodes.push({
      id,
      kind: 'file',
      name: rel,
      provenance: { file: rel, line: 1, ruleId: 'files/source-file' },
      attrs: { size: meta.size, kind: classify(rel) },
      invalidatedBy: [rel],
    });
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes };
}

export { toRel };
