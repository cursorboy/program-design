/**
 * Navigation extraction — page-to-page links (the spine of a frontend-only app).
 *
 * Deterministic, honesty-first. We recognize:
 *   - next/link        <Link href="/login">            → nav/link
 *   - plain anchors    <a href="/about">               → nav/link
 *   - router pushes    router.push('/x') / replace(…)  → nav/router  (useRouter)
 *   - next redirects   redirect('/x') / permanentRedirect('/x')  → nav/redirect
 *
 * Resolution rules (mirrors wiring.ts honesty):
 *   - INTERNAL ('/...'): resolve to the page route node `route:GET <path>` whose
 *     path matches a defined page route. Emit a 'navigatesTo' edge from the
 *     CONTAINING file's page node (the page route whose provenance.file is this
 *     file) — or, if the file is not itself a page (e.g. a shared Nav component),
 *     from the file node — to that page route. tier: literal.
 *       · If the target path has no matching page route, the target may still be
 *         a real screen not-yet-built → emit the edge as unresolved:true to the
 *         would-be route id (honest "a link whose page we don't see").
 *   - EXTERNAL (http/https/mailto/tel): create a lightweight 'external' marker
 *     node and point the edge at it (attrs.external='true'). tier: literal.
 *   - DYNAMIC (template literal / expression / variable): emit the edge
 *     unresolved:true with NO concrete target path — "a link we can't follow".
 *   - TRIVIAL ('#', '', '#anchor'): skipped entirely (not navigation).
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

export interface NavigationResult {
  nodes: FactNode[];
  edges: FactEdge[];
}

/** The node id of an external-link marker (one shared per external URL). */
function externalId(url: string): string {
  return makeNodeId('component', `external:${url}`);
}

/**
 * Build a path → page route id index from the route nodes (page routes are
 * GET routes that are not /api). These are the only targets a link can reach.
 */
interface PageIndex {
  /** route path → route node id (page routes only). */
  idByPath: Map<string, string>;
  /** repo-rel file → page route node id (the page a file IS, if any). */
  pageIdByFile: Map<string, string>;
}

function indexPages(routeNodes: FactNode[]): PageIndex {
  const idByPath = new Map<string, string>();
  const pageIdByFile = new Map<string, string>();
  for (const n of routeNodes) {
    if (n.kind !== 'route') continue;
    const method = String(n.attrs.method ?? 'GET').toUpperCase();
    const path = String(n.attrs.path ?? '');
    const isApi = /\/api(\/|$)/.test(path);
    if (method !== 'GET' || isApi) continue; // page routes only
    if (!idByPath.has(path)) idByPath.set(path, n.id);
    const f = n.provenance?.file;
    if (f && !pageIdByFile.has(f)) pageIdByFile.set(f, n.id);
  }
  return { idByPath, pageIdByFile };
}

/** Strip query/hash and trailing slash; returns a normalized internal path. */
function normalizeInternal(href: string): string {
  let u = href;
  const q = u.search(/[?#]/);
  if (q >= 0) u = u.slice(0, q);
  if (!u.startsWith('/')) u = '/' + u;
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

type HrefKind = 'internal' | 'external' | 'dynamic' | 'trivial';
function classifyHref(href: string): HrefKind {
  const t = href.trim();
  if (t === '' || t === '#' || t.startsWith('#')) return 'trivial';
  if (/^(https?:|mailto:|tel:)/i.test(t)) return 'external';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return 'external';
  if (t.startsWith('/')) return 'internal';
  // relative path without a leading slash (e.g. "about") — treat as internal
  if (/^[\w./-]+$/.test(t)) return 'internal';
  return 'dynamic';
}

export function extractNavigation(
  repoRoot: string,
  sourceFiles: SourceFile[],
  routeNodes: FactNode[],
): NavigationResult {
  const nodes: FactNode[] = [];
  const edges: FactEdge[] = [];
  const { idByPath, pageIdByFile } = indexPages(routeNodes);

  const externalSeen = new Set<string>();
  const edgeSeen = new Set<string>();

  function ensureExternal(url: string, rel: string, line: number): string {
    const id = externalId(url);
    if (!externalSeen.has(id)) {
      externalSeen.add(id);
      nodes.push({
        id,
        kind: 'component',
        name: `external:${url}`,
        provenance: { file: rel, line, ruleId: 'nav/external' },
        attrs: { external: true, url },
        invalidatedBy: [rel],
      });
    }
    return id;
  }

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    // The "from" node: the page this file IS, else the file node.
    const fromId = pageIdByFile.get(rel) ?? makeNodeId('file', rel);
    const localConsts = collectLocalStringConsts(sf);

    /** Emit a navigatesTo edge from this file, honoring resolution rules. */
    const emit = (
      hrefRaw: string | null,
      isDynamic: boolean,
      line: number,
      ruleId: string,
    ): void => {
      if (!isDynamic && hrefRaw === null) return;
      if (isDynamic || hrefRaw === null) {
        // A link we can't follow — honest unresolved edge to an unknown target.
        const toId = makeNodeId('route', `GET ?nav:${rel}#${line}`);
        const eid = makeEdgeId('navigatesTo', fromId, toId);
        if (edgeSeen.has(eid)) return;
        edgeSeen.add(eid);
        edges.push({
          id: eid,
          kind: 'navigatesTo',
          from: fromId,
          to: toId,
          provenance: { file: rel, line, ruleId },
          tier: 'dynamic',
          invalidatedBy: [rel],
          unresolved: true,
        });
        return;
      }
      const kind = classifyHref(hrefRaw);
      if (kind === 'trivial') return;
      if (kind === 'external') {
        const toId = ensureExternal(hrefRaw.trim(), rel, line);
        addEdge(fromId, toId, line, ruleId, false);
        return;
      }
      if (kind === 'dynamic') {
        emit(null, true, line, ruleId);
        return;
      }
      // internal
      const path = normalizeInternal(hrefRaw);
      const resolved = idByPath.get(path);
      if (resolved) {
        addEdge(fromId, resolved, line, ruleId, false);
      } else {
        // honest: link to a screen we don't see (yet) — unresolved, never guess.
        const toId = makeNodeId('route', `GET ${path}`);
        addEdge(fromId, toId, line, ruleId, true);
      }
    };

    function addEdge(
      from: string,
      to: string,
      line: number,
      ruleId: string,
      unresolved: boolean,
    ): void {
      if (from === to) return; // a page linking to itself adds no navigation
      const eid = makeEdgeId('navigatesTo', from, to);
      if (edgeSeen.has(eid)) return;
      edgeSeen.add(eid);
      const e: FactEdge = {
        id: eid,
        kind: 'navigatesTo',
        from,
        to,
        provenance: { file: rel, line, ruleId },
        tier: 'literal',
        invalidatedBy: [rel],
      };
      if (unresolved) e.unresolved = true;
      edges.push(e);
    }

    sf.forEachDescendant((node) => {
      // --- JSX <Link href> and <a href> ---
      if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
        const tag = node.getTagNameNode().getText();
        if (tag !== 'Link' && tag !== 'a') return;
        const attr = findHrefAttr(node);
        if (!attr) return;
        const line = lineOf(sf, node.getStart());
        emit(attr.literal, attr.dynamic, line, 'nav/link');
        return;
      }
      // --- router.push / router.replace / redirect / permanentRedirect ---
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression();
        let ruleId: string | null = null;
        if (Node.isPropertyAccessExpression(callee)) {
          const m = callee.getName();
          if (m === 'push' || m === 'replace') ruleId = 'nav/router';
        } else if (Node.isIdentifier(callee)) {
          const name = callee.getText();
          if (name === 'redirect' || name === 'permanentRedirect') ruleId = 'nav/redirect';
        }
        if (!ruleId) return;
        const args = node.getArguments();
        if (args.length === 0) return;
        const first = args[0]!;
        const line = lineOf(sf, node.getStart());
        const { literal, dynamic } = resolveArg(first, localConsts);
        // router.push only counts as navigation when the arg is a string-ish path
        // or a const that resolves to one; an object form is a dynamic link.
        emit(literal, dynamic, line, ruleId);
      }
    });
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges };
}

/** Resolve a call argument to a literal href, or flag it dynamic. */
function resolveArg(
  arg: Node,
  localConsts: Map<string, string>,
): { literal: string | null; dynamic: boolean } {
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return { literal: arg.getLiteralValue(), dynamic: false };
  }
  if (Node.isIdentifier(arg)) {
    const v = localConsts.get(arg.getText());
    if (v !== undefined) return { literal: v, dynamic: false };
    return { literal: null, dynamic: true };
  }
  // template expression / object literal / member access → dynamic.
  return { literal: null, dynamic: true };
}

/** Find the href attribute of a JSX element → its literal value or dynamic flag. */
function findHrefAttr(
  el: import('ts-morph').JsxOpeningElement | import('ts-morph').JsxSelfClosingElement,
): { literal: string | null; dynamic: boolean } | null {
  for (const attr of el.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) continue;
    if (attr.getNameNode().getText() !== 'href') continue;
    const init = attr.getInitializer();
    if (!init) return null;
    if (Node.isStringLiteral(init)) {
      return { literal: init.getLiteralValue(), dynamic: false };
    }
    if (Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (!expr) return { literal: null, dynamic: true };
      if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
        return { literal: expr.getLiteralValue(), dynamic: false };
      }
      return { literal: null, dynamic: true };
    }
    return { literal: null, dynamic: true };
  }
  return null;
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
