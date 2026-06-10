/**
 * App Router route extraction.
 *
 * - app/**\/page.tsx           → `route:GET <path>` node       (routes/app-router-page)
 * - app/**\/route.ts           → one node per exported verb     (routes/route-handler)
 * - 'use server' functions     → serverAction nodes            (routes/server-action)
 *
 * Handles src/app vs app, route groups (drop (group) segments), dynamic [id] and
 * catchall [...slug] (bracket syntax kept in the URL path), nested layouts (not routes).
 */
import { join, posix } from 'node:path';
import type { SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  makeNodeId,
  type FactNode,
  type FactEdge,
} from '../schema.js';
import { existsSync, toRel, lineOf } from './common.js';

const HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface RoutesResult {
  nodes: FactNode[];
  edges: FactEdge[];
  /** True if an app directory was found at all (checker ABSENT precondition). */
  appDirFound: boolean;
  /** Repo-relative app dir root(s) searched. */
  appDirs: string[];
}

/** Find the App Router root: prefer src/app, else app. */
export function findAppDir(repoRoot: string): { abs: string; rel: string } | null {
  const candidates = [join(repoRoot, 'src', 'app'), join(repoRoot, 'app')];
  for (const abs of candidates) {
    if (existsSync(abs)) return { abs, rel: toRel(repoRoot, abs) };
  }
  return null;
}

/**
 * Turn an app-relative directory path into a URL path.
 * - drop (group) segments
 * - keep [id] and [...slug] bracket syntax
 * Returns a POSIX path always beginning with '/'.
 */
export function dirToRoutePath(appRelDir: string): string {
  if (appRelDir === '' || appRelDir === '.') return '/';
  const segments = appRelDir.split(posix.sep).filter((s) => s.length > 0);
  const kept: string[] = [];
  for (const seg of segments) {
    // Route group: (marketing) → dropped from the URL.
    if (seg.startsWith('(') && seg.endsWith(')')) continue;
    kept.push(seg);
  }
  if (kept.length === 0) return '/';
  return '/' + kept.join('/');
}

/** app-relative directory of a file (POSIX), '' for the app root. */
function appRelDirOf(appRel: string): string {
  const idx = appRel.lastIndexOf('/');
  return idx < 0 ? '' : appRel.slice(0, idx);
}

export function extractRoutes(
  repoRoot: string,
  sourceFiles: SourceFile[],
): RoutesResult {
  const nodes: FactNode[] = [];
  const edges: FactEdge[] = [];
  const app = findAppDir(repoRoot);

  if (!app) {
    return { nodes, edges, appDirFound: false, appDirs: [] };
  }

  const appRelRoot = app.rel; // e.g. "app" or "src/app"

  for (const sf of sourceFiles) {
    const rel = toRel(repoRoot, sf.getFilePath());
    // Server actions can live anywhere; handle those separately below.
    const inApp = rel === appRelRoot || rel.startsWith(appRelRoot + '/');

    if (inApp) {
      const appRel = rel.slice(appRelRoot.length).replace(/^\//, ''); // path under app/
      const base = appRel.split('/').pop() ?? '';
      const baseNoExt = base.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '');

      if (baseNoExt === 'page') {
        const routePath = dirToRoutePath(appRelDirOf(appRel));
        addRoute(nodes, repoRoot, sf, 'GET', routePath, 'routes/app-router-page', 1);
      } else if (baseNoExt === 'route') {
        const routePath = dirToRoutePath(appRelDirOf(appRel));
        for (const { verb, line } of exportedVerbs(sf)) {
          addRoute(nodes, repoRoot, sf, verb, routePath, 'routes/app-router-handler', line);
        }
      }
      // layout.tsx, template.tsx, loading.tsx, etc. → NOT routes.
    }

    // Server actions: any file with a top-level 'use server' or per-function
    // 'use server' directive.
    extractServerActions(nodes, repoRoot, sf);
  }

  // Deterministic ordering.
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges, appDirFound: true, appDirs: [appRelRoot] };
}

function addRoute(
  nodes: FactNode[],
  repoRoot: string,
  sf: SourceFile,
  method: string,
  path: string,
  ruleId: string,
  line: number,
): void {
  const name = `${method} ${path}`;
  const id = makeNodeId('route', name);
  if (nodes.some((n) => n.id === id)) return;
  const rel = toRel(repoRoot, sf.getFilePath());
  nodes.push({
    id,
    kind: 'route',
    name,
    provenance: { file: rel, line, ruleId },
    attrs: { method, path },
    invalidatedBy: [rel],
  });
}

/** Find exported HTTP verb functions/consts in a route handler. */
function exportedVerbs(sf: SourceFile): { verb: string; line: number }[] {
  const found: { verb: string; line: number }[] = [];
  const seen = new Set<string>();

  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (name && HTTP_VERBS.includes(name) && fn.isExported()) {
      if (!seen.has(name)) {
        seen.add(name);
        found.push({ verb: name, line: lineOf(sf, fn.getStart()) });
      }
    }
  }
  // export const GET = ... / export const GET: RouteHandler = ...
  for (const v of sf.getVariableStatements()) {
    if (!v.isExported()) continue;
    for (const decl of v.getDeclarations()) {
      const name = decl.getName();
      if (HTTP_VERBS.includes(name) && !seen.has(name)) {
        seen.add(name);
        found.push({ verb: name, line: lineOf(sf, decl.getStart()) });
      }
    }
  }
  found.sort((a, b) => (a.verb < b.verb ? -1 : a.verb > b.verb ? 1 : 0));
  return found;
}

/** Detect 'use server' server actions (file-level or function-level directive). */
function extractServerActions(
  nodes: FactNode[],
  repoRoot: string,
  sf: SourceFile,
): void {
  const rel = toRel(repoRoot, sf.getFilePath());
  const fileLevelUseServer = hasLeadingDirective(sf, 'use server');

  const addAction = (name: string, line: number) => {
    const id = makeNodeId('serverAction', name);
    if (nodes.some((n) => n.id === id)) return;
    nodes.push({
      id,
      kind: 'serverAction',
      name,
      provenance: { file: rel, line, ruleId: 'routes/server-action' },
      attrs: { file: rel },
      invalidatedBy: [rel],
    });
  };

  // File-level 'use server': every exported async function is a server action.
  if (fileLevelUseServer) {
    for (const fn of sf.getFunctions()) {
      if (!fn.isExported()) continue;
      const name = fn.getName();
      if (!name) continue;
      addAction(`${rel}#${name}`, lineOf(sf, fn.getStart()));
    }
    for (const v of sf.getVariableStatements()) {
      if (!v.isExported()) continue;
      for (const decl of v.getDeclarations()) {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          addAction(`${rel}#${decl.getName()}`, lineOf(sf, decl.getStart()));
        }
      }
    }
    return;
  }

  // Function-level 'use server' directive inside a function body.
  for (const fn of sf.getFunctions()) {
    if (functionHasUseServer(fn)) {
      const name = fn.getName() ?? '(anonymous)';
      addAction(`${rel}#${name}`, lineOf(sf, fn.getStart()));
    }
  }
}

function hasLeadingDirective(sf: SourceFile, directive: string): boolean {
  for (const stmt of sf.getStatements()) {
    if (Node.isExpressionStatement(stmt)) {
      const expr = stmt.getExpression();
      if (Node.isStringLiteral(expr)) {
        if (expr.getLiteralValue() === directive) return true;
        continue; // another directive (e.g. 'use client') — keep scanning prologue
      }
    }
    break; // first non-directive statement ends the directive prologue
  }
  return false;
}

function functionHasUseServer(fn: import('ts-morph').FunctionDeclaration): boolean {
  const body = fn.getBody();
  if (!body || !Node.isBlock(body)) return false;
  for (const stmt of body.getStatements()) {
    if (Node.isExpressionStatement(stmt)) {
      const expr = stmt.getExpression();
      if (Node.isStringLiteral(expr)) {
        if (expr.getLiteralValue() === 'use server') return true;
        continue;
      }
    }
    break;
  }
  return false;
}

export { SyntaxKind };
