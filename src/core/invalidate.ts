/**
 * Dependency-aware invalidation.
 *
 * Global invalidators force a full rebuild (cross-cutting config whose change can
 * affect any fact): next.config.*, tsconfig.json, package.json,
 * prisma/schema.prisma, middleware.ts (+ src/middleware.ts).
 *
 * Otherwise affectedFactIds = ids of nodes/edges whose `invalidatedBy` intersects
 * the set of changed files. Paths are compared as repo-relative POSIX strings.
 */
import type { FactsGraph } from './schema.js';

/** Exact filenames / paths that trigger a full rebuild when changed. */
const GLOBAL_INVALIDATOR_PATHS = new Set<string>([
  'tsconfig.json',
  'package.json',
  'prisma/schema.prisma',
  'middleware.ts',
  'src/middleware.ts',
  'middleware.js',
  'src/middleware.js',
]);

/** Basename prefixes that trigger a full rebuild (next.config.{js,mjs,ts,cjs}). */
function isNextConfig(rel: string): boolean {
  const base = rel.split('/').pop() ?? '';
  return /^next\.config\.(js|mjs|cjs|ts)$/.test(base);
}

function normalize(p: string): string {
  let s = p.split('\\').join('/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

export function invalidatedScope(
  graph: FactsGraph,
  changedFiles: string[],
): { fullRebuild: boolean; affectedFactIds: string[] } {
  const changed = new Set(changedFiles.map(normalize));

  for (const file of changed) {
    if (GLOBAL_INVALIDATOR_PATHS.has(file) || isNextConfig(file)) {
      return { fullRebuild: true, affectedFactIds: [] };
    }
  }

  const affected = new Set<string>();
  for (const node of graph.nodes) {
    if (node.invalidatedBy.some((f) => changed.has(normalize(f)))) {
      affected.add(node.id);
    }
  }
  for (const edge of graph.edges) {
    if (edge.invalidatedBy.some((f) => changed.has(normalize(f)))) {
      affected.add(edge.id);
    }
  }

  return { fullRebuild: false, affectedFactIds: [...affected].sort() };
}
