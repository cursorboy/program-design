/**
 * Forms extraction — <form> elements + where they submit.
 *
 * Deterministic, honesty-first. A form node is created for:
 *   - a JSX <form> element                                  → forms/jsx-form
 *
 * Its submit destination ('submitsTo' edge) is resolved from, in priority order:
 *   1. action="/path"            (string literal)            → resolve to route
 *   2. action={serverAction}     (an expression)             → unresolved / action
 *   3. an onSubmit/onAction handler that calls fetch(URL)    → resolve to route
 *
 * Resolution mirrors wiring.ts:
 *   - literal/const URL that matches a defined route  → traced submitsTo (literal
 *     or constant-resolved tier) to `route:<METHOD> <path>`.
 *   - literal URL with NO matching route              → submitsTo, unresolved
 *     (the route may not be built yet — honest, never guessed).
 *   - external URL (http/https)                       → submitsTo to an external
 *     marker node (attrs.external='true').
 *   - dynamic (template/expression/unknown)           → submitsTo, unresolved
 *     ("we can't trace where this form goes").
 *   - a <form> with no discernible destination        → submitsTo, unresolved.
 *
 * The form node carries attrs.owner = the page route id (if the file IS a page)
 * else the file node id, so the canvas can attach the form to its page.
 *
 * Coordination with wiring.ts: a form whose onSubmit calls fetch('/api/login')
 * ALSO surfaces as the existing clientCall/wiredTo journey (wiring.ts is
 * unchanged). The form node is an additional, page-anchored view of the same
 * submit — not a contradictory duplicate. The canvas merges them by the shared
 * destination route.
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

export interface FormsResult {
  nodes: FactNode[];
  edges: FactEdge[];
}

interface PageIndex {
  /** route path → set of methods. */
  methodsByPath: Map<string, Set<string>>;
  /** repo-rel file → page route node id (the page a file IS, if any). */
  pageIdByFile: Map<string, string>;
}

function indexRoutes(routeNodes: FactNode[]): PageIndex {
  const methodsByPath = new Map<string, Set<string>>();
  const pageIdByFile = new Map<string, string>();
  for (const n of routeNodes) {
    if (n.kind !== 'route') continue;
    const method = String(n.attrs.method ?? 'GET').toUpperCase();
    const path = String(n.attrs.path ?? '');
    if (!methodsByPath.has(path)) methodsByPath.set(path, new Set());
    methodsByPath.get(path)!.add(method);
    // page routes (GET, non-api) own a file → form owner
    const isApi = /\/api(\/|$)/.test(path);
    if (method === 'GET' && !isApi) {
      const f = n.provenance?.file;
      if (f && !pageIdByFile.has(f)) pageIdByFile.set(f, n.id);
    }
  }
  return { methodsByPath, pageIdByFile };
}

function externalId(url: string): string {
  return makeNodeId('component', `external:${url}`);
}

function normalizePath(url: string): string | null {
  let u = url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return null; // external
  const q = u.search(/[?#]/);
  if (q >= 0) u = u.slice(0, q);
  if (!u.startsWith('/')) u = '/' + u;
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

export function extractForms(
  repoRoot: string,
  sourceFiles: SourceFile[],
  routeNodes: FactNode[],
): FormsResult {
  const nodes: FactNode[] = [];
  const edges: FactEdge[] = [];
  const { methodsByPath, pageIdByFile } = indexRoutes(routeNodes);
  const externalSeen = new Set<string>();

  // A component file rendered by a page → that page's route id. Lets a form
  // living in LoginForm.tsx attach to the Login page that renders <LoginForm/>.
  const ownerByComponentFile = resolveComponentOwners(
    repoRoot,
    sourceFiles,
    pageIdByFile,
  );

  function ensureExternal(url: string, rel: string, line: number): string {
    const id = externalId(url);
    if (!externalSeen.has(id)) {
      externalSeen.add(id);
      nodes.push({
        id,
        kind: 'component',
        name: `external:${url}`,
        provenance: { file: rel, line, ruleId: 'forms/external' },
        attrs: { external: true, url },
        invalidatedBy: [rel],
      });
    }
    return id;
  }

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    const owner =
      pageIdByFile.get(rel) ??
      ownerByComponentFile.get(rel) ??
      makeNodeId('file', rel);
    const localConsts = collectLocalStringConsts(sf);
    let counter = 0;

    sf.forEachDescendant((node) => {
      const isForm =
        (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) &&
        node.getTagNameNode().getText() === 'form';
      if (!isForm) return;
      const line = lineOf(sf, node.getStart());
      const idName = `${rel}#${counter++}`;
      const formId = makeNodeId('form', idName);

      // Resolve the destination.
      const dest = resolveFormDest(node, localConsts);

      const attrs: FactNode['attrs'] = { file: rel, owner };
      if (dest.method) attrs.method = dest.method;
      const formNode: FactNode = {
        id: formId,
        kind: 'form',
        name: idName,
        provenance: { file: rel, line, ruleId: 'forms/jsx-form' },
        attrs,
        invalidatedBy: [rel],
      };

      const ruleId =
        dest.via === 'fetch'
          ? 'forms/onsubmit-fetch'
          : dest.via === 'action'
            ? 'forms/action'
            : 'forms/jsx-form';

      if (dest.kind === 'external' && dest.url) {
        const toId = ensureExternal(dest.url, rel, line);
        formNode.attrs.dest = 'external';
        nodes.push(formNode);
        edges.push(submit(formId, toId, rel, line, ruleId, 'literal', false));
        return;
      }

      if (dest.kind === 'route' && dest.url) {
        const path = normalizePath(dest.url);
        const method = (dest.method ?? 'POST').toUpperCase();
        const methods = path ? methodsByPath.get(path) : undefined;
        if (path && methods && methods.has(method)) {
          const toId = makeNodeId('route', `${method} ${path}`);
          formNode.attrs.dest = 'route';
          nodes.push(formNode);
          edges.push(submit(formId, toId, rel, line, ruleId, dest.tier, false));
          return;
        }
        if (path) {
          // literal URL, no matching route → honest unresolved (route maybe unbuilt)
          const toId = makeNodeId('route', `${method} ${path}`);
          formNode.attrs.dest = 'unresolved';
          formNode.unresolved = true;
          nodes.push(formNode);
          edges.push(submit(formId, toId, rel, line, ruleId, dest.tier, true));
          return;
        }
      }

      // dynamic / unknown destination → honest ghost.
      formNode.attrs.dest = 'unknown';
      formNode.unresolved = true;
      nodes.push(formNode);
      const ghostId = makeNodeId('route', `POST ?form:${idName}`);
      edges.push(submit(formId, ghostId, rel, line, ruleId, 'dynamic', true));
    });
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges };
}

function submit(
  from: string,
  to: string,
  rel: string,
  line: number,
  ruleId: string,
  tier: WiringTier,
  unresolved: boolean,
): FactEdge {
  const e: FactEdge = {
    id: makeEdgeId('submitsTo', from, to),
    kind: 'submitsTo',
    from,
    to,
    provenance: { file: rel, line, ruleId },
    tier,
    invalidatedBy: [rel],
  };
  if (unresolved) e.unresolved = true;
  return e;
}

interface FormDest {
  kind: 'route' | 'external' | 'unknown';
  url: string | null;
  method: string | null;
  tier: WiringTier;
  via: 'action' | 'fetch' | 'none';
}

/**
 * Resolve where a <form> submits:
 *   1. action="..." string → route or external.
 *   2. action={expr}       → unknown (server action / dynamic).
 *   3. onSubmit/onAction handler that calls fetch(URL) → that URL.
 */
function resolveFormDest(
  el: import('ts-morph').JsxOpeningElement | import('ts-morph').JsxSelfClosingElement,
  localConsts: Map<string, string>,
): FormDest {
  let actionExpr: Node | undefined;
  let methodAttr: string | null = null;
  let submitHandler: Node | undefined;

  for (const attr of el.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) continue;
    const name = attr.getNameNode().getText();
    const init = attr.getInitializer();
    if (name === 'action') {
      if (init && Node.isStringLiteral(init)) {
        actionExpr = init;
      } else if (init && Node.isJsxExpression(init)) {
        actionExpr = init.getExpression() ?? init;
      }
    } else if (name === 'method') {
      if (init && Node.isStringLiteral(init)) methodAttr = init.getLiteralValue().toUpperCase();
    } else if (name === 'onSubmit' || name === 'onAction') {
      if (init && Node.isJsxExpression(init)) submitHandler = init.getExpression();
    }
  }

  // 1/2. action attribute.
  if (actionExpr) {
    if (Node.isStringLiteral(actionExpr) || Node.isNoSubstitutionTemplateLiteral(actionExpr)) {
      const url = actionExpr.getLiteralValue();
      const external = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
      return {
        kind: external ? 'external' : 'route',
        url,
        method: methodAttr ?? 'POST',
        tier: 'literal',
        via: 'action',
      };
    }
    if (Node.isIdentifier(actionExpr)) {
      const v = localConsts.get(actionExpr.getText());
      if (v !== undefined) {
        const external = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
        return {
          kind: external ? 'external' : 'route',
          url: v,
          method: methodAttr ?? 'POST',
          tier: 'constant-resolved',
          via: 'action',
        };
      }
      // action={serverAction} — a server action import / dynamic target.
      return { kind: 'unknown', url: null, method: methodAttr ?? 'POST', tier: 'dynamic', via: 'action' };
    }
    return { kind: 'unknown', url: null, method: methodAttr ?? 'POST', tier: 'dynamic', via: 'action' };
  }

  // 3. onSubmit handler → look for a fetch(URL) inside the referenced function.
  const fetchDest = findFetchInHandler(el, submitHandler, localConsts);
  if (fetchDest) return fetchDest;

  return { kind: 'unknown', url: null, method: methodAttr, tier: 'dynamic', via: 'none' };
}

/**
 * Find a fetch(URL, {method}) call reachable from the form's submit handler.
 * Handles onSubmit={onSubmit} (a referenced function in the same component) and
 * onSubmit={() => fetch(...)} (an inline arrow). We scan the whole containing
 * function/component for a fetch call when given a bare identifier handler — a
 * deterministic, conservative association (the common single-form component).
 */
function findFetchInHandler(
  el: Node,
  handler: Node | undefined,
  localConsts: Map<string, string>,
): FormDest | null {
  let scope: Node | undefined;

  if (handler && (Node.isArrowFunction(handler) || Node.isFunctionExpression(handler))) {
    scope = handler;
  } else {
    // Bare identifier handler (or none): scan the enclosing component function.
    scope = el.getFirstAncestor(
      (a) =>
        Node.isFunctionDeclaration(a) ||
        Node.isArrowFunction(a) ||
        Node.isFunctionExpression(a),
    );
  }
  if (!scope) return null;

  let found: FormDest | null = null;
  scope.forEachDescendant((node, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!(Node.isIdentifier(callee) && callee.getText() === 'fetch')) return;
    const args = node.getArguments();
    if (args.length === 0) return;
    const first = args[0]!;
    let url: string | null = null;
    let tier: WiringTier = 'dynamic';
    if (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) {
      url = first.getLiteralValue();
      tier = 'literal';
    } else if (Node.isIdentifier(first)) {
      const v = localConsts.get(first.getText());
      if (v !== undefined) {
        url = v;
        tier = 'constant-resolved';
      }
    }
    const method = fetchMethod(node) ?? 'POST';
    if (url === null) {
      found = { kind: 'unknown', url: null, method, tier: 'dynamic', via: 'fetch' };
    } else {
      const external = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
      found = { kind: external ? 'external' : 'route', url, method, tier, via: 'fetch' };
    }
    traversal.stop();
  });
  return found;
}

function fetchMethod(call: import('ts-morph').CallExpression): string | null {
  const args = call.getArguments();
  if (args.length >= 2) {
    const opts = args[1]!;
    if (Node.isObjectLiteralExpression(opts)) {
      for (const prop of opts.getProperties()) {
        if (Node.isPropertyAssignment(prop) && prop.getName() === 'method') {
          const init = prop.getInitializer();
          if (init && Node.isStringLiteral(init)) return init.getLiteralValue().toUpperCase();
        }
      }
    }
  }
  return null;
}

/**
 * Map each component FILE that a page renders → that page's route id.
 *
 * For every page file (pageIdByFile), find local component imports and the JSX
 * tags actually used in that page. If a page imports `LoginForm` from
 * '../../components/LoginForm' AND renders <LoginForm/>, then
 * 'components/LoginForm.tsx' → the login page route id. First page wins (stable).
 */
function resolveComponentOwners(
  repoRoot: string,
  sourceFiles: SourceFile[],
  pageIdByFile: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  // index source files by their repo-rel path WITHOUT extension for resolution.
  const byNoExt = new Map<string, string>();
  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    byNoExt.set(rel.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, ''), rel);
  }

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    const pageId = pageIdByFile.get(rel);
    if (!pageId) continue;

    // local-import name → resolved repo-rel file path.
    const importedFileByName = new Map<string, string>();
    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith('.')) continue; // local only
      const resolved = resolveLocalImport(rel, spec, byNoExt);
      if (!resolved) continue;
      const def = imp.getDefaultImport();
      if (def) importedFileByName.set(def.getText(), resolved);
      for (const named of imp.getNamedImports()) {
        const local = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
        importedFileByName.set(local, resolved);
      }
    }
    if (importedFileByName.size === 0) continue;

    // JSX tags rendered in this page.
    sf.forEachDescendant((node) => {
      let tag: string | null = null;
      if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
        tag = node.getTagNameNode().getText();
      }
      if (!tag) return;
      const file = importedFileByName.get(tag);
      if (file && !out.has(file)) out.set(file, pageId);
    });
  }
  return out;
}

/** Resolve a relative import specifier from a file to a repo-rel source path. */
function resolveLocalImport(
  fromRel: string,
  spec: string,
  byNoExt: Map<string, string>,
): string | null {
  // Compute the target path relative to the importing file's directory (POSIX).
  const dir = fromRel.slice(0, fromRel.lastIndexOf('/'));
  const parts = (dir ? dir.split('/') : []).concat(spec.split('/'));
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  const noExt = stack.join('/');
  if (byNoExt.has(noExt)) return byNoExt.get(noExt)!;
  // index file: import './components' → components/index.tsx
  if (byNoExt.has(noExt + '/index')) return byNoExt.get(noExt + '/index')!;
  return null;
}

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
