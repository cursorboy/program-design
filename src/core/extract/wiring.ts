/**
 * Frontend-to-backend wiring: fetch()/axios calls in components.
 *
 * Tiers (PLAN.md hardening #5):
 *   literal            fetch("/api/x")
 *   constant-resolved  fetch(URL) where URL is a same-file/imported const literal
 *   dynamic            template literal / computed → UNDETERMINED (unresolved edge)
 *
 * wiredTo edge → matching route node when the path matches a defined route.
 * Unmatched literal call → clientCall node with no wiredTo edge.
 */
import type { SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  makeNodeId,
  makeEdgeId,
  type FactNode,
  type FactEdge,
  type WiringTier,
} from '../schema.js';
import { toRel, lineOf } from './common.js';

export interface WiringResult {
  nodes: FactNode[];
  edges: FactEdge[];
}

interface RouteIndex {
  /** path → set of methods defined at that path. */
  byPath: Map<string, Set<string>>;
}

function indexRoutes(routeNodes: FactNode[]): RouteIndex {
  const byPath = new Map<string, Set<string>>();
  for (const n of routeNodes) {
    if (n.kind !== 'route') continue;
    const path = String(n.attrs.path ?? '');
    const method = String(n.attrs.method ?? 'GET');
    if (!byPath.has(path)) byPath.set(path, new Set());
    byPath.get(path)!.add(method);
  }
  return { byPath };
}

export function extractWiring(
  repoRoot: string,
  sourceFiles: SourceFile[],
  routeNodes: FactNode[],
): WiringResult {
  const nodes: FactNode[] = [];
  const edges: FactEdge[] = [];
  const routes = indexRoutes(routeNodes);
  let counter = 0;

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    const localConsts = collectLocalStringConsts(sf);

    sf.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!isFetchLike(callee)) return;
      const args = node.getArguments();
      if (args.length === 0) return;
      const first = args[0]!;
      const line = lineOf(sf, node.getStart());

      let url: string | null = null;
      let tier: WiringTier;
      // Static prefix of a dynamic template (text before the first ${...}).
      let dynamicPrefix: string | null = null;

      if (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) {
        url = first.getLiteralValue();
        tier = 'literal';
      } else if (Node.isIdentifier(first)) {
        const resolved = localConsts.get(first.getText());
        if (resolved !== undefined) {
          url = resolved;
          tier = 'constant-resolved';
        } else {
          tier = 'dynamic';
        }
      } else if (Node.isTemplateExpression(first)) {
        // Template literal with substitutions → dynamic / UNDETERMINED.
        tier = 'dynamic';
        dynamicPrefix = first.getHead().getLiteralText();
      } else {
        tier = 'dynamic';
      }

      const method = methodOf(node);
      const idName = `${rel}#${counter++}`;
      const clientCallId = makeNodeId('clientCall', idName);
      const attrs: FactNode['attrs'] = { tier, method: method ?? 'GET' };
      if (url !== null) attrs.url = url;

      // ruleId carries the recognizing-pass evidence the checker keys ABSENT on:
      //   literal           → wiring/literal-url
      //   constant-resolved → wiring/resolved-url
      //   dynamic           → wiring/dynamic-url (off the confirm/absent allowlist)
      const ruleId =
        tier === 'literal'
          ? 'wiring/literal-url'
          : tier === 'constant-resolved'
            ? 'wiring/resolved-url'
            : 'wiring/dynamic-url';

      const callNode: FactNode = {
        id: clientCallId,
        kind: 'clientCall',
        name: idName,
        provenance: { file: rel, line, ruleId },
        attrs,
        invalidatedBy: [rel],
      };

      if (tier === 'dynamic') {
        // Dynamic call: unresolved so the checker maps it to UNDETERMINED.
        callNode.unresolved = true;
        // Emit an unresolved wiredTo edge to the static-prefix route the dynamic
        // URL could reach. This is what lets the checker resolve a wiring claim
        // about that prefix to UNDETERMINED ("could not resolve the URL") rather
        // than ABSENT — the spec's "never matched or absent" guarantee.
        const prefixPath = dynamicPrefix !== null ? normalizePath(dynamicPrefix) : null;
        if (prefixPath !== null) {
          if (prefixPath !== null) attrs.urlPrefix = prefixPath;
          const routeName = `${method ?? 'GET'} ${prefixPath}`;
          const routeId = makeNodeId('route', routeName);
          edges.push({
            id: makeEdgeId('wiredTo', clientCallId, routeId),
            kind: 'wiredTo',
            from: clientCallId,
            to: routeId,
            provenance: { file: rel, line, ruleId },
            tier,
            invalidatedBy: [rel],
            unresolved: true,
          });
        }
        nodes.push(callNode);
        return;
      }

      nodes.push(callNode);

      // Try to match the (literal/constant) URL to a defined route.
      const path = normalizePath(url!);
      const methods = path !== null ? routes.byPath.get(path) : undefined;
      if (path !== null && methods && methods.has(method ?? 'GET')) {
        const routeName = `${method ?? 'GET'} ${path}`;
        const routeId = makeNodeId('route', routeName);
        edges.push({
          id: makeEdgeId('wiredTo', clientCallId, routeId),
          kind: 'wiredTo',
          from: clientCallId,
          to: routeId,
          provenance: { file: rel, line, ruleId },
          tier,
          invalidatedBy: [rel],
        });
      }
      // Unmatched literal → node stays, no wiredTo edge (checker: ABSENT-eligible).
    });
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges };
}

/** fetch(...) or axios(...) / axios.get(...) etc. */
function isFetchLike(callee: Node): boolean {
  if (Node.isIdentifier(callee)) {
    const name = callee.getText();
    return name === 'fetch' || name === 'axios';
  }
  if (Node.isPropertyAccessExpression(callee)) {
    const obj = callee.getExpression();
    if (Node.isIdentifier(obj) && obj.getText() === 'axios') {
      const m = callee.getName();
      return ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'].includes(m);
    }
  }
  return false;
}

/** Infer HTTP method from a fetch options object or axios method name. */
function methodOf(call: import('ts-morph').CallExpression): string | null {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) {
    const obj = callee.getExpression();
    if (Node.isIdentifier(obj) && obj.getText() === 'axios') {
      const m = callee.getName().toUpperCase();
      if (m === 'REQUEST') return 'GET';
      return m;
    }
  }
  // fetch(url, { method: 'POST' })
  const args = call.getArguments();
  if (args.length >= 2) {
    const opts = args[1]!;
    if (Node.isObjectLiteralExpression(opts)) {
      for (const prop of opts.getProperties()) {
        if (Node.isPropertyAssignment(prop) && prop.getName() === 'method') {
          const init = prop.getInitializer();
          if (init && Node.isStringLiteral(init)) {
            return init.getLiteralValue().toUpperCase();
          }
        }
      }
    }
  }
  return 'GET';
}

/** Map of const-name → string-literal value within this file. */
function collectLocalStringConsts(sf: SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of sf.getVariableStatements()) {
    for (const decl of v.getDeclarations()) {
      const init = decl.getInitializer();
      if (
        init &&
        (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))
      ) {
        map.set(decl.getName(), init.getLiteralValue());
      }
    }
  }
  return map;
}

/**
 * Normalize a URL to a route path for matching:
 * - strip protocol+host if absolute
 * - strip query/hash
 * - drop trailing slash (except root)
 * Returns null for clearly non-route URLs (external absolute URLs).
 */
function normalizePath(url: string): string | null {
  let u = url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    // Absolute URL → external; not a local route wire.
    return null;
  }
  // Strip query and hash.
  const q = u.search(/[?#]/);
  if (q >= 0) u = u.slice(0, q);
  if (!u.startsWith('/')) u = '/' + u;
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u;
}
