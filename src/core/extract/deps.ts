/**
 * Dependency extraction from package.json.
 *
 * dependencies + devDependencies → dependency nodes (attrs.version, attrs.dev).
 * ruleId "deps/package-json". Missing/invalid package.json → no nodes (never crash).
 */
import { join } from 'node:path';
import { makeNodeId, type FactNode } from '../schema.js';
import { existsSync, readFileSync, toRel } from './common.js';
import type { ParseFailure } from '../schema.js';

export interface DepsResult {
  nodes: FactNode[];
  packageJsonRel: string | null;
}

export function extractDeps(
  repoRoot: string,
  parseFailures: ParseFailure[],
): DepsResult {
  const nodes: FactNode[] = [];
  const abs = join(repoRoot, 'package.json');
  if (!existsSync(abs)) {
    return { nodes, packageJsonRel: null };
  }
  const rel = toRel(repoRoot, abs);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    parseFailures.push({ file: rel, reason: `invalid JSON: ${(e as Error).message}` });
    return { nodes, packageJsonRel: rel };
  }

  const pkg = parsed as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const add = (name: string, version: string, dev: boolean, line: number) => {
    const id = makeNodeId('dependency', name);
    if (nodes.some((n) => n.id === id)) return;
    nodes.push({
      id,
      kind: 'dependency',
      name,
      provenance: { file: rel, line, ruleId: 'deps/package-json' },
      attrs: { version, dev },
      invalidatedBy: [rel],
    });
  };

  // Find approximate line numbers for receipts (best-effort, deterministic).
  const lines = readFileSafe(abs).split(/\r?\n/);
  const lineFor = (name: string): number => {
    const needle = `"${name}"`;
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] ?? '').includes(needle)) return i + 1;
    }
    return 1;
  };

  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    add(name, String(version), false, lineFor(name));
  }
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    add(name, String(version), true, lineFor(name));
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, packageJsonRel: rel };
}

function readFileSafe(abs: string): string {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}
