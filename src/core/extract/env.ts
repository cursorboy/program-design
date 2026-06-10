/**
 * Env-var extraction — NAMES ONLY, never values.
 *
 * Detects:
 *   process.env.X
 *   process.env['X']
 *   const { X, Y } = process.env
 * Emits envVar nodes (attrs.exposure = NEXT_PUBLIC_* ? 'client' : 'server') and
 * `reads` edges from the reading file node to the envVar node.
 */
import type { SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  makeNodeId,
  makeEdgeId,
  type FactNode,
  type FactEdge,
} from '../schema.js';
import { toRel, lineOf } from './common.js';

export interface EnvResult {
  nodes: FactNode[];
  edges: FactEdge[];
}

function exposureOf(name: string): 'client' | 'server' {
  return name.startsWith('NEXT_PUBLIC_') ? 'client' : 'server';
}

export function extractEnv(
  repoRoot: string,
  sourceFiles: SourceFile[],
): EnvResult {
  const nodes = new Map<string, FactNode>();
  const edges = new Map<string, FactEdge>();

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    const fileNodeId = makeNodeId('file', rel);

    const record = (name: string, line: number) => {
      if (!name) return;
      const envId = makeNodeId('envVar', name);
      if (!nodes.has(envId)) {
        nodes.set(envId, {
          id: envId,
          kind: 'envVar',
          name,
          provenance: { file: rel, line, ruleId: 'env/process-env-read' },
          attrs: { exposure: exposureOf(name) },
          invalidatedBy: [rel],
        });
      } else {
        const existing = nodes.get(envId)!;
        if (!existing.invalidatedBy.includes(rel)) existing.invalidatedBy.push(rel);
      }
      const edgeId = makeEdgeId('reads', fileNodeId, envId);
      if (!edges.has(edgeId)) {
        edges.set(edgeId, {
          id: edgeId,
          kind: 'reads',
          from: fileNodeId,
          to: envId,
          provenance: { file: rel, line, ruleId: 'env/process-env-read' },
          invalidatedBy: [rel],
        });
      }
    };

    sf.forEachDescendant((node) => {
      // process.env.X  and  process.env['X']
      if (Node.isPropertyAccessExpression(node)) {
        // node is `<something>.X`; check the object is `process.env`.
        const obj = node.getExpression();
        if (isProcessEnv(obj)) {
          record(node.getName(), lineOf(sf, node.getStart()));
        }
      } else if (Node.isElementAccessExpression(node)) {
        const obj = node.getExpression();
        if (isProcessEnv(obj)) {
          const arg = node.getArgumentExpression();
          if (arg && Node.isStringLiteral(arg)) {
            record(arg.getLiteralValue(), lineOf(sf, node.getStart()));
          }
        }
      } else if (Node.isVariableDeclaration(node)) {
        // const { X, Y } = process.env
        const init = node.getInitializer();
        if (init && isProcessEnv(init)) {
          const nameNode = node.getNameNode();
          if (Node.isObjectBindingPattern(nameNode)) {
            for (const el of nameNode.getElements()) {
              // Use the property name (source name), not the local alias.
              const propNode = el.getPropertyNameNode();
              const sourceName = propNode
                ? propNode.getText().replace(/['"]/g, '')
                : el.getName();
              record(sourceName, lineOf(sf, el.getStart()));
            }
          }
        }
      }
    });
  }

  const nodeArr = [...nodes.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const edgeArr = [...edges.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { nodes: nodeArr, edges: edgeArr };
}

/** True if the node is the `process.env` member access. */
function isProcessEnv(node: Node): boolean {
  if (!Node.isPropertyAccessExpression(node)) return false;
  if (node.getName() !== 'env') return false;
  const inner = node.getExpression();
  return Node.isIdentifier(inner) && inner.getText() === 'process';
}
