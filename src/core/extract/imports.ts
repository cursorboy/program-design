/**
 * Import edge extraction + unresolved-reference detection.
 *
 * - Relative imports whose target file does not exist (agent mid-write) → the
 *   importing file node and the `imports` edge are marked unresolved: true.
 *   Unresolved facts MUST survive (checker maps them to UNDETERMINED, never ABSENT).
 * - Bare-package imports → `dependsOn` edges from file to dependency node when the
 *   dependency exists in the graph.
 */
import { dirname, resolve as resolvePath } from 'node:path';
import type { SourceFile } from 'ts-morph';
import {
  makeNodeId,
  makeEdgeId,
  type FactNode,
  type FactEdge,
} from '../schema.js';
import { existsSync, toRel, lineOf } from './common.js';

export interface ImportsResult {
  /** file nodes that gained unresolved=true (merged into files in index). */
  unresolvedFiles: Set<string>;
  edges: FactEdge[];
}

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_NAMES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

function relativeImportResolves(fromAbs: string, spec: string): boolean {
  const baseDir = dirname(fromAbs);
  const target = resolvePath(baseDir, spec);
  for (const ext of RESOLVE_EXTS) {
    if (existsSync(target + ext)) return true;
  }
  for (const idx of INDEX_NAMES) {
    if (existsSync(target + idx)) return true;
  }
  return false;
}

export function extractImports(
  repoRoot: string,
  sourceFiles: SourceFile[],
  dependencyNames: Set<string>,
): ImportsResult {
  const unresolvedFiles = new Set<string>();
  const edges: FactEdge[] = [];

  for (const sf of sourceFiles) {
    const fromAbs = sf.getFilePath();
    const rel = toRel(repoRoot, fromAbs);
    const fileId = makeNodeId('file', rel);

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      const line = lineOf(sf, imp.getStart());

      if (spec.startsWith('.') || spec.startsWith('/')) {
        // Relative/absolute local import → verify the target exists.
        if (!relativeImportResolves(fromAbs, spec)) {
          unresolvedFiles.add(rel);
          edges.push({
            id: makeEdgeId('imports', fileId, `unresolved:${spec}`),
            kind: 'imports',
            from: fileId,
            to: makeNodeId('file', spec), // synthetic target id
            provenance: { file: rel, line, ruleId: 'imports/unresolved' },
            invalidatedBy: [rel],
            unresolved: true,
          });
        }
        continue;
      }

      // Bare import → dependency. Package root (strip subpath, handle scopes).
      const pkg = packageRootOf(spec);
      if (dependencyNames.has(pkg)) {
        const depId = makeNodeId('dependency', pkg);
        const edgeId = makeEdgeId('dependsOn', fileId, depId);
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            kind: 'dependsOn',
            from: fileId,
            to: depId,
            provenance: { file: rel, line, ruleId: 'imports/depends-on' },
            invalidatedBy: [rel, 'package.json'],
          });
        }
      }
    }
  }

  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { unresolvedFiles, edges };
}

function packageRootOf(spec: string): string {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.slice(0, 2).join('/');
  }
  return spec.split('/')[0]!;
}
