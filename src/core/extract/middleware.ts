/**
 * Middleware extraction + attachment.
 *
 * middleware.ts / src/middleware.ts existence → middleware node.
 *
 * Attachment (attachedTo edges, with confidence tiers):
 *   - literal `export const config = { matcher: [...] }` → match routes whose path
 *     satisfies the matcher (Next.js literal matcher semantics) with tier
 *     'matcher-includes'.
 *   - no matcher → applies to all routes (Next defaults) → edges tier 'global-exists'.
 *   - recognized guard wrapper imported (@clerk/nextjs, next-auth,
 *     @supabase/auth-helpers, or local withAuth) → attrs.guards + tier 'guard-wrapper'
 *     on matched edges.
 *   - non-literal (computed) matcher → NO attachedTo edges; node attrs.matcherDynamic.
 */
import { join } from 'node:path';
import type { SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import {
  makeNodeId,
  makeEdgeId,
  type FactNode,
  type FactEdge,
  type MiddlewareTier,
} from '../schema.js';
import { existsSync, toRel, lineOf } from './common.js';

export interface MiddlewareResult {
  nodes: FactNode[];
  edges: FactEdge[];
  /** Repo-relative paths searched (checker ABSENT scope). */
  searchScope: string[];
  /** Whether a middleware file was found. */
  found: boolean;
}

const GUARD_PACKAGES = [
  '@clerk/nextjs',
  'next-auth',
  '@supabase/auth-helpers',
  '@supabase/auth-helpers-nextjs',
];
const LOCAL_GUARD_NAMES = ['withAuth'];

export function findMiddlewareFile(
  repoRoot: string,
): { abs: string; rel: string } | null {
  const candidates = [
    join(repoRoot, 'middleware.ts'),
    join(repoRoot, 'src', 'middleware.ts'),
    join(repoRoot, 'middleware.js'),
    join(repoRoot, 'src', 'middleware.js'),
  ];
  for (const abs of candidates) {
    if (existsSync(abs)) return { abs, rel: toRel(repoRoot, abs) };
  }
  return null;
}

export function middlewareSearchScope(repoRoot: string): string[] {
  return ['middleware.ts', 'src/middleware.ts', 'middleware.js', 'src/middleware.js'];
}

export function extractMiddleware(
  repoRoot: string,
  sourceFiles: SourceFile[],
  routeNodes: FactNode[],
): MiddlewareResult {
  const searchScope = middlewareSearchScope(repoRoot);
  const file = findMiddlewareFile(repoRoot);
  if (!file) {
    return { nodes: [], edges: [], searchScope, found: false };
  }

  const rel = file.rel;
  // Find the loaded SourceFile for the middleware (it may have failed to parse,
  // in which case we still emit the node but no attachment edges).
  const sf = sourceFiles.find((s) => toRel(repoRoot, s.getFilePath()) === rel);

  const guards = sf ? detectGuards(sf) : [];
  const matcher = sf ? parseMatcher(sf) : { kind: 'absent' as const, patterns: [] };

  const nodeAttrs: FactNode['attrs'] = {
    file: rel,
    matcherDynamic: matcher.kind === 'dynamic',
  };
  if (guards.length > 0) nodeAttrs.guards = guards.join(',');

  const mwId = makeNodeId('middleware', rel);
  const mwNode: FactNode = {
    id: mwId,
    kind: 'middleware',
    name: rel,
    provenance: { file: rel, line: 1, ruleId: 'middleware/file' },
    attrs: nodeAttrs,
    invalidatedBy: [rel],
  };
  const nodes: FactNode[] = [mwNode];
  const edges: FactEdge[] = [];

  // Dynamic (computed) matcher → no attachment edges at all (UNDETERMINED).
  if (matcher.kind === 'dynamic') {
    return { nodes, edges, searchScope, found: true };
  }

  const baseTier: MiddlewareTier =
    guards.length > 0
      ? 'guard-wrapper'
      : matcher.kind === 'literal'
        ? 'matcher-includes'
        : 'global-exists';

  const matcherLine = matcher.line ?? 1;

  // ruleId aligns with the checker allowlist (middleware/matcher | guard-wrapper).
  const attachRuleId =
    baseTier === 'guard-wrapper' ? 'middleware/guard-wrapper' : 'middleware/matcher';

  for (const route of routeNodes) {
    if (route.kind !== 'route') continue;
    const path = String(route.attrs.path ?? '');
    let applies: boolean;
    if (matcher.kind === 'literal') {
      applies = matcher.patterns.some((p) => matchesMatcher(p, path));
    } else {
      // matcher absent → Next default: applies to all routes.
      applies = true;
    }
    if (!applies) continue;
    edges.push({
      id: makeEdgeId('attachedTo', mwId, route.id),
      kind: 'attachedTo',
      from: mwId,
      to: route.id,
      provenance: { file: rel, line: matcherLine, ruleId: attachRuleId },
      tier: baseTier,
      invalidatedBy: [rel],
    });
  }

  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges, searchScope, found: true };
}

interface MatcherResult {
  kind: 'literal' | 'absent' | 'dynamic';
  patterns: string[];
  line?: number;
}

/**
 * Parse `export const config = { matcher: [...] }`.
 * - literal array of string literals → literal
 * - matcher present but non-literal (identifier, computed) → dynamic
 * - no config / no matcher key → absent
 */
function parseMatcher(sf: SourceFile): MatcherResult {
  const configDecl = sf
    .getVariableDeclarations()
    .find((d) => d.getName() === 'config');
  if (!configDecl) return { kind: 'absent', patterns: [] };

  const init = configDecl.getInitializer();
  if (!init || !Node.isObjectLiteralExpression(init)) {
    return { kind: 'absent', patterns: [] };
  }

  const matcherProp = init
    .getProperties()
    .find(
      (p): p is import('ts-morph').PropertyAssignment =>
        Node.isPropertyAssignment(p) && p.getName() === 'matcher',
    );
  if (!matcherProp) return { kind: 'absent', patterns: [] };

  const line = lineOf(sf, matcherProp.getStart());
  const value = matcherProp.getInitializer();
  if (!value) return { kind: 'dynamic', patterns: [], line };

  // matcher: '/single' (string)
  if (Node.isStringLiteral(value)) {
    return { kind: 'literal', patterns: [value.getLiteralValue()], line };
  }

  // matcher: [ ... ]
  if (Node.isArrayLiteralExpression(value)) {
    const patterns: string[] = [];
    for (const el of value.getElements()) {
      if (Node.isStringLiteral(el)) {
        patterns.push(el.getLiteralValue());
      } else if (Node.isObjectLiteralExpression(el)) {
        // matcher: [{ source: '/path' }] — object form; extract source if literal.
        const src = el
          .getProperties()
          .find(
            (p): p is import('ts-morph').PropertyAssignment =>
              Node.isPropertyAssignment(p) && p.getName() === 'source',
          );
        const sv = src?.getInitializer();
        if (sv && Node.isStringLiteral(sv)) {
          patterns.push(sv.getLiteralValue());
        } else {
          return { kind: 'dynamic', patterns: [], line };
        }
      } else {
        // Spread, identifier, template — computed.
        return { kind: 'dynamic', patterns: [], line };
      }
    }
    return { kind: 'literal', patterns, line };
  }

  // Identifier, template literal, call, etc. → computed.
  return { kind: 'dynamic', patterns: [], line };
}

/**
 * Next.js matcher semantics for LITERAL patterns.
 * Supported deterministically:
 *   - exact:           '/about'        matches '/about'
 *   - path wildcard:   '/api/:path*'   matches '/api' and '/api/anything/deep'
 *   - named param:     '/blog/:slug'   matches '/blog/x' (single segment)
 *   - regex group tail '/((?!_next).*)' → conservatively treated as "all" only when
 *      it is exactly the catch-all form; otherwise we do not over-claim.
 */
export function matchesMatcher(pattern: string, routePath: string): boolean {
  // Normalize trailing slash.
  const norm = (s: string) => (s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s);
  const pat = norm(pattern);
  const path = norm(routePath);

  // ':path*' / ':slug*' trailing wildcard → prefix match (segment-aware).
  const starMatch = /^(.*?)\/:[A-Za-z_][A-Za-z0-9_]*\*$/.exec(pat);
  if (starMatch) {
    const prefix = starMatch[1] === '' ? '/' : starMatch[1]!;
    if (prefix === '/') return true; // '/:path*' matches everything
    // matches the prefix itself or anything below it
    return path === prefix || path.startsWith(prefix + '/');
  }

  // Build a regex from the pattern: ':name' → one segment, '*' → wildcard.
  // Only handle the safe, well-known forms; anything exotic falls through to
  // a literal compare (conservative, never over-matches).
  if (/^[/A-Za-z0-9_\-[\].:*]+$/.test(pat) && (pat.includes(':') || pat.includes('*'))) {
    const re = matcherToRegExp(pat);
    if (re) return re.test(path);
  }

  // Plain literal path.
  return pat === path;
}

function matcherToRegExp(pattern: string): RegExp | null {
  try {
    let out = '';
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i]!;
      if (ch === ':') {
        // named param up to next '/' or end; optional trailing '*' handled above
        let j = i + 1;
        while (j < pattern.length && /[A-Za-z0-9_]/.test(pattern[j]!)) j++;
        if (pattern[j] === '*') {
          out += '.*';
          j++;
        } else {
          out += '[^/]+';
        }
        i = j;
      } else if (ch === '*') {
        out += '.*';
        i++;
      } else if ('\\^$.|?+()[]{}'.includes(ch)) {
        out += '\\' + ch;
        i++;
      } else {
        out += ch;
        i++;
      }
    }
    return new RegExp('^' + out + '$');
  } catch {
    return null;
  }
}

/** Detect recognized guard wrappers from imports in the middleware file. */
function detectGuards(sf: SourceFile): string[] {
  const guards = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    for (const pkg of GUARD_PACKAGES) {
      if (spec === pkg || spec.startsWith(pkg + '/')) guards.add(pkg);
    }
    // Local guard: import { withAuth } from './lib/withAuth'
    for (const named of imp.getNamedImports()) {
      if (LOCAL_GUARD_NAMES.includes(named.getName())) guards.add(named.getName());
    }
  }
  return [...guards].sort();
}
