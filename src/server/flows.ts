/**
 * flows.ts — deterministic display projection: FactsGraph → plain-English user flows.
 *
 * This is the PLAIN level of progressive disclosure (PLAN.md "Progressive
 * disclosure"). It is a PURE FUNCTION over the facts graph — no I/O, no LLM, no
 * invention. Every step that has graph provenance carries a receipt (file:line)
 * and the originating fact id, so "show me the code" lands on a real receipt.
 *
 * A flow is the journey of one frontend call:
 *
 *   page (the component that calls) → action ("sends info to") → endpoint (route)
 *     → [guard, if a middleware is attached] → [table, if it persists]
 *
 * Flows whose wiring cannot be traced (dynamic URL / unresolved target) end on an
 * honest "unknown" step and are marked traced:false — the same undetermined
 * discipline as the verdict layer.
 *
 * Standalone page routes (GET page routes with no incoming wiring) are returned
 * separately via `derivePages` — "places a visitor can go".
 */
import type { FactsGraph, FactNode, FactEdge, Provenance } from '../core/schema.js';

export interface FlowStep {
  kind: 'page' | 'action' | 'endpoint' | 'guard' | 'table' | 'unknown';
  /** Friendly chip label (e.g. "Login form", "the login door (/api/login)"). */
  label: string;
  /** Full plain-English sentence a 15-year-old understands. */
  plain: string;
  /** Present whenever this step has graph provenance. */
  receipt?: { file: string; line: number };
  /** Fact node/edge id this step is grounded in (present with a receipt). */
  factId?: string;
}

export interface UserFlow {
  id: string;
  title: string;
  plain: string;
  steps: FlowStep[];
  /** false → the final hop could not be traced from the code alone. */
  traced: boolean;
}

/** A standalone page a visitor can navigate to (no incoming wiring). */
export interface PageEntry {
  label: string;
  path: string;
  receipt?: { file: string; line: number };
  factId?: string;
  /** Navigation hop distance from the root page (0 = root). -1 = unreachable. */
  depth?: number;
}

/**
 * A page-to-page navigation link (the spine of a frontend app). `to` is a page
 * path, the sentinel 'external' (with toUrl), or 'unknown' (a link we can't
 * follow). traced=false → dashed honest connector, no pulse.
 */
export interface NavLink {
  id: string;
  /** Source page path (the page that holds the link), or a file label. */
  fromPath: string;
  fromLabel: string;
  /** 'page' → toPath is a page; 'external' → toUrl; 'unknown' → untraceable. */
  toKind: 'page' | 'external' | 'unknown';
  toPath?: string;
  toLabel: string;
  toUrl?: string;
  traced: boolean;
  receipt?: { file: string; line: number };
  factId?: string;
}

/**
 * A form on a page and where it submits. dest: 'route' (traced, to a door),
 * 'external' (a marker), or 'unknown' (untraceable ghost).
 */
export interface FormEntry {
  id: string;
  label: string;
  /** The page path the form is attached to (the owner), or null if orphan. */
  ownerPath: string | null;
  ownerLabel: string;
  dest: 'route' | 'external' | 'unknown';
  destLabel: string;
  /** When dest==='route': the door's path. */
  destPath?: string;
  traced: boolean;
  receipt?: { file: string; line: number };
  factId?: string;
}

/** Wiring tiers we treat as a confirmed, traceable wire. */
const TRACEABLE_TIERS: ReadonlySet<string> = new Set([
  'literal',
  'constant-resolved',
  'helper-resolved',
]);

/** Middleware attachment tiers that prove a guard runs before the route. */
const GUARD_TIERS: ReadonlySet<string> = new Set(['matcher-includes', 'guard-wrapper']);

function provToReceipt(p: Provenance | null | undefined): { file: string; line: number } | undefined {
  if (!p || !p.file) return undefined;
  return { file: p.file, line: p.line };
}

/** "LoginForm.tsx" → "Login form". Splits PascalCase, drops the extension. */
export function friendlyComponentName(raw: string): string {
  // Use the file's basename, strip a trailing extension.
  let base = raw.replace(/\\/g, '/');
  const slash = base.lastIndexOf('/');
  if (slash !== -1) base = base.slice(slash + 1);
  base = base.replace(/\.[a-zA-Z0-9]+$/, '');
  // Split camel/Pascal boundaries and separators into words.
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return raw;
  const joined = words.join(' ').toLowerCase();
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Last path segment → a noun. "/api/login" → "login"; "/api/users" → "user". */
function nounForRoute(path: string): string {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') ?? path;
  const segs = clean.split('/').filter(Boolean);
  let last = segs[segs.length - 1] ?? clean;
  // Strip dynamic-segment brackets: [id] → id.
  last = last.replace(/[[\]{}().:]/g, '');
  if (!last || last === 'api') last = segs[segs.length - 2] ?? 'request';
  // Singularize a trailing plural for a friendlier noun.
  if (last.length > 3 && /s$/.test(last) && !/ss$/.test(last)) last = last.slice(0, -1);
  return last || 'request';
}

/** "GET /api/login" → "/api/login"; bare path passes through. */
function routePath(routeName: string): string {
  const m = routeName.match(/^[A-Z]+\s+(\/\S*)/);
  if (m && m[1]) return m[1];
  const sp = routeName.indexOf('/');
  return sp === -1 ? routeName : routeName.slice(sp);
}

function isPageRoute(node: FactNode): boolean {
  const method = String(node.attrs?.method ?? '').toUpperCase();
  const kindAttr = String(node.attrs?.routeKind ?? node.attrs?.type ?? '').toLowerCase();
  if (kindAttr === 'page') return true;
  // A GET route with no leading /api segment reads as a visitable page.
  const path = routePath(node.name);
  const isApi = /\/api(\/|$)/.test(path);
  return (method === 'GET' || method === '') && !isApi;
}

/**
 * Build the list of user flows from the graph. Deterministic: ordering is by the
 * (already deterministic) edge order in the graph, then stable string sort.
 */
export function deriveFlows(graph: FactsGraph): UserFlow[] {
  const nodeById = new Map<string, FactNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  // Index guards (middleware attachedTo route) and persists (route persistsTo table).
  const guardsByRoute = new Map<string, FactEdge>();
  const persistsByRoute = new Map<string, FactEdge>();
  for (const e of graph.edges) {
    if (e.kind === 'attachedTo' && GUARD_TIERS.has(String(e.tier ?? ''))) {
      if (!guardsByRoute.has(e.to)) guardsByRoute.set(e.to, e);
    }
    if (e.kind === 'persistsTo') {
      if (!persistsByRoute.has(e.from)) persistsByRoute.set(e.from, e);
    }
  }

  const wires = graph.edges.filter((e) => e.kind === 'wiredTo');
  const flows: UserFlow[] = [];

  for (const wire of wires) {
    const caller = nodeById.get(wire.from);
    const route = nodeById.get(wire.to);
    const tier = String(wire.tier ?? 'dynamic');
    const traceable = TRACEABLE_TIERS.has(tier) && !wire.unresolved;

    // --- page step (the component/file that holds the call) ---
    const callerProv = caller?.provenance ?? null;
    const rawCallerName =
      caller && callerProv?.file
        ? friendlyComponentName(callerProv.file)
        : caller
          ? friendlyComponentName(caller.name)
          : 'A page';
    // Plain-language relabel: a bare component that just fires a request reads as
    // "a button that loads data" — never the raw filename ("Dynamic"). Forms keep
    // their friendly "… form" name (they're shown as form nodes elsewhere).
    const callerMethod = String(caller?.attrs?.method ?? 'GET').toUpperCase();
    const looksLikeForm = /\bform\b/i.test(rawCallerName);
    const callerName = looksLikeForm
      ? rawCallerName
      : describeCaller(rawCallerName, callerMethod, traceable);
    const steps: FlowStep[] = [];
    steps.push({
      kind: 'page',
      label: callerName,
      plain: `${callerName} is where someone is using your app.`,
      receipt: provToReceipt(callerProv),
      factId: caller?.id,
    });

    // --- action step (the request itself) ---
    steps.push({
      kind: 'action',
      label: 'sends info to',
      plain: 'It sends some information across to the part of your app that does the work.',
      receipt: provToReceipt(wire.provenance),
      factId: wire.id,
    });

    if (!traceable) {
      // Honest undetermined ending.
      steps.push({
        kind: 'unknown',
        label: 'somewhere I can’t trace',
        plain: '…then it goes somewhere I can’t trace from the code alone.',
      });
      const titleName = route ? friendlyComponentName(callerName) : callerName;
      flows.push({
        id: 'flow:' + wire.id,
        title: `${callerName} sends a request`,
        plain: `${callerName} sends information out, but the code doesn’t spell out exactly where it lands.`,
        steps,
        traced: false,
      });
      void titleName;
      continue;
    }

    // --- endpoint step ---
    const path = route ? routePath(route.name) : '';
    const noun = path ? nounForRoute(path) : 'request';
    const endpointLabel = path ? `the ${noun} door (${path})` : 'a door into your app';
    steps.push({
      kind: 'endpoint',
      label: endpointLabel,
      plain: `That information arrives at ${endpointLabel} — a doorway into the working part of your app.`,
      receipt: provToReceipt(route?.provenance),
      factId: route?.id,
    });

    // --- guard step (optional) ---
    const guard = route ? guardsByRoute.get(route.id) : undefined;
    if (guard) {
      const guardNode = nodeById.get(guard.from);
      steps.push({
        kind: 'guard',
        label: 'checked by the security guard',
        plain: 'A security guard checks the visitor first, before anything else happens.',
        receipt: provToReceipt(guard.provenance ?? guardNode?.provenance ?? null),
        factId: guard.id,
      });
    }

    // --- table step (optional) ---
    const persists = route ? persistsByRoute.get(route.id) : undefined;
    if (persists) {
      const table = nodeById.get(persists.to);
      const tableName = table ? friendlyTableName(table.name) : 'your records';
      steps.push({
        kind: 'table',
        label: `saved in your ${tableName}`,
        plain: `The result gets saved in your ${tableName}, so it’s remembered later.`,
        receipt: provToReceipt(persists.provenance ?? table?.provenance ?? null),
        factId: persists.id,
      });
    }

    flows.push({
      id: 'flow:' + wire.id,
      title: `${callerName} → ${endpointLabel}`,
      plain: `${callerName} sends info to ${endpointLabel}${
        guard ? ', which a security guard checks first' : ''
      }${persists ? ', and the result is saved' : ''}.`,
      steps,
      traced: true,
    });
  }

  return flows;
}

/**
 * Plain-language label for a component that fires a request but isn't a form.
 * A GET reads as loading; anything else as sending. Never the raw filename — so
 * the demo "Dynamic.tsx" shows as "A button that loads data", not "Dynamic".
 */
function describeCaller(name: string, method: string, traceable: boolean): string {
  const loads = method === 'GET' || method === 'HEAD';
  // If the friendly name is already descriptive (multi-word, not a lone token),
  // keep it; only the bare single-word demo names get the action phrasing.
  const words = name.trim().split(/\s+/);
  const isBareToken = words.length === 1;
  if (!isBareToken) return name;
  if (loads) return 'A button that loads data';
  return traceable ? 'A button that sends data' : 'A button that sends a request';
}

/** "User" / "users" → "User records". */
function friendlyTableName(raw: string): string {
  let name = raw.trim();
  // Drop a schema prefix like "public.User".
  const dot = name.lastIndexOf('.');
  if (dot !== -1) name = name.slice(dot + 1);
  const titled = name.charAt(0).toUpperCase() + name.slice(1);
  return `${titled} records`;
}

/**
 * Standalone page routes with no incoming wiring — "places a visitor can go".
 * Deterministic: sorted by path.
 */
export function derivePages(graph: FactsGraph): PageEntry[] {
  const wiredTargets = new Set<string>();
  for (const e of graph.edges) if (e.kind === 'wiredTo') wiredTargets.add(e.to);

  const pages: PageEntry[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'route') continue;
    if (!isPageRoute(n)) continue;
    if (wiredTargets.has(n.id)) continue;
    const path = routePath(n.name);
    pages.push({
      label: pageLabel(path),
      path,
      receipt: provToReceipt(n.provenance),
      factId: n.id,
    });
  }
  pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return pages;
}

/** "/" → "Home page"; "/about" → "About page"; "/blog/[slug]" → "Blog page". */
export function pageLabel(path: string): string {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return 'Home page';
  const segs = clean.split('/').filter(Boolean);
  let first = segs[0] ?? 'page';
  first = first.replace(/[[\]{}().:]/g, '').replace(/[_-]+/g, ' ');
  const titled = first.charAt(0).toUpperCase() + first.slice(1);
  return `${titled} page`;
}

// ---------------------------------------------------------------------------
// Navigation (page-to-page links) + forms — the rich app-structure map. These
// power the frontend-only case where there is no backend at all.
// ---------------------------------------------------------------------------

/** Is this route node a visitable page (GET, not under /api)? */
function isPageRouteNode(n: FactNode): boolean {
  if (n.kind !== 'route') return false;
  return isPageRoute(n);
}

/** A short external host label: "https://example.com/x" → "example.com". */
function externalLabel(url: string): string {
  try {
    const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i);
    if (m && m[1]) return m[1];
  } catch {
    /* ignore */
  }
  if (/^mailto:/i.test(url)) return url.replace(/^mailto:/i, '');
  return 'an external site';
}

/**
 * Page-to-page navigation links. A navigatesTo edge whose `from` is a page route
 * is attributed to that page's path; a `from` that is a shared component file is
 * attributed to a friendly file label (it still anchors the link visually).
 */
export function deriveNavigation(graph: FactsGraph): NavLink[] {
  const nodeById = new Map<string, FactNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const links: NavLink[] = [];
  for (const e of graph.edges) {
    if (e.kind !== 'navigatesTo') continue;
    const fromNode = nodeById.get(e.from);
    const toNode = nodeById.get(e.to);

    // Resolve the source label/path.
    let fromPath = '';
    let fromLabel = 'A page';
    if (fromNode && isPageRouteNode(fromNode)) {
      fromPath = routePath(fromNode.name);
      fromLabel = pageLabel(fromPath);
    } else if (fromNode && fromNode.kind === 'file') {
      fromLabel = friendlyComponentName(fromNode.name);
      fromPath = '@' + fromNode.name; // a non-page anchor key
    } else if (e.provenance?.file) {
      fromLabel = friendlyComponentName(e.provenance.file);
      fromPath = '@' + e.provenance.file;
    }

    // Resolve the target.
    let toKind: NavLink['toKind'] = 'unknown';
    let toPath: string | undefined;
    let toLabel = 'somewhere we can’t follow';
    let toUrl: string | undefined;
    if (toNode && toNode.attrs?.external) {
      toKind = 'external';
      toUrl = String(toNode.attrs.url ?? '');
      toLabel = 'an external site (' + externalLabel(toUrl) + ')';
    } else if (e.unresolved) {
      // unresolved internal link → a screen we don't see (honest ghost), unless
      // it points at a real path we just don't have a node for.
      const tp = toNode && isPageRouteNode(toNode) ? routePath(toNode.name) : null;
      if (tp) {
        toKind = 'page';
        toPath = tp;
        toLabel = pageLabel(tp);
      } else {
        toKind = 'unknown';
        toLabel = 'a page we can’t place yet';
      }
    } else if (toNode && isPageRouteNode(toNode)) {
      toKind = 'page';
      toPath = routePath(toNode.name);
      toLabel = pageLabel(toPath);
    }

    links.push({
      id: e.id,
      fromPath,
      fromLabel,
      toKind,
      toPath,
      toLabel,
      toUrl,
      traced: !e.unresolved,
      receipt: provToReceipt(e.provenance),
      factId: e.id,
    });
  }
  links.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return links;
}

/** "components/LoginForm.tsx" → "Login form". Falls back to "Form". */
function formLabel(node: FactNode): string {
  const file = node.provenance?.file ?? node.name;
  const friendly = friendlyComponentName(file);
  // "Login form" / "Search form": if the component name already ends in "form"
  // keep it; otherwise append " form".
  if (/\bform\b/i.test(friendly)) return friendly;
  return friendly + ' form';
}

/** Forms + where they submit. */
export function deriveForms(graph: FactsGraph): FormEntry[] {
  const nodeById = new Map<string, FactNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  // submitsTo edge by form id.
  const submitByForm = new Map<string, FactEdge>();
  for (const e of graph.edges) {
    if (e.kind === 'submitsTo' && !submitByForm.has(e.from)) submitByForm.set(e.from, e);
  }

  const entries: FormEntry[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'form') continue;
    const label = formLabel(n);

    // owner page.
    const ownerId = String(n.attrs.owner ?? '');
    const ownerNode = nodeById.get(ownerId);
    let ownerPath: string | null = null;
    let ownerLabel = 'a page';
    if (ownerNode && isPageRouteNode(ownerNode)) {
      ownerPath = routePath(ownerNode.name);
      ownerLabel = pageLabel(ownerPath);
    } else if (ownerNode && ownerNode.kind === 'file') {
      ownerLabel = friendlyComponentName(ownerNode.name);
    }

    // destination.
    const sub = submitByForm.get(n.id);
    let dest: FormEntry['dest'] = 'unknown';
    let destLabel = 'somewhere we can’t trace';
    let destPath: string | undefined;
    let traced = false;
    if (sub) {
      const toNode = nodeById.get(sub.to);
      if (toNode && toNode.attrs?.external) {
        dest = 'external';
        destLabel = 'an external site (' + externalLabel(String(toNode.attrs.url ?? '')) + ')';
        traced = true;
      } else if (!sub.unresolved) {
        dest = 'route';
        destPath = routePath(sub.to.replace(/^route:/, ''));
        const noun = nounForRoute(destPath);
        destLabel = `the ${noun} door (${destPath})`;
        traced = true;
      } else {
        dest = 'unknown';
        destLabel = 'somewhere we can’t trace';
        traced = false;
      }
    }

    entries.push({
      id: n.id,
      label,
      ownerPath,
      ownerLabel,
      dest,
      destLabel,
      destPath,
      traced,
      receipt: provToReceipt(n.provenance),
      factId: n.id,
    });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries;
}

/**
 * Compute navigation hop-depth for each page path from a root, breadth-first.
 * Root = the home '/' page if present, else the most-linked-to page, else the
 * first page by path. Pages unreachable from the root get depth -1.
 */
export function computeNavDepths(
  pages: PageEntry[],
  links: NavLink[],
): Map<string, number> {
  const depths = new Map<string, number>();
  const pagePaths = new Set(pages.map((p) => p.path));
  if (pagePaths.size === 0) return depths;

  // adjacency: page path → page paths it links to.
  const adj = new Map<string, string[]>();
  const inCount = new Map<string, number>();
  for (const l of links) {
    if (l.toKind !== 'page' || !l.toPath) continue;
    if (!pagePaths.has(l.fromPath) || !pagePaths.has(l.toPath)) {
      // a non-page source (shared Nav component) still seeds reachability of its
      // targets — treat the target as depth 1 from a virtual root later.
    }
    if (pagePaths.has(l.fromPath)) {
      if (!adj.has(l.fromPath)) adj.set(l.fromPath, []);
      adj.get(l.fromPath)!.push(l.toPath);
    }
    inCount.set(l.toPath, (inCount.get(l.toPath) ?? 0) + 1);
  }

  // choose root.
  let root = pages.find((p) => p.path === '/')?.path ?? null;
  if (!root) {
    let best: string | null = null;
    let bestC = -1;
    for (const p of pages) {
      const c = inCount.get(p.path) ?? 0;
      if (c > bestC) {
        bestC = c;
        best = p.path;
      }
    }
    root = best ?? pages[0]!.path;
  }

  const queue: string[] = [root];
  depths.set(root, 0);
  // also seed targets of a shared Nav (non-page source) as reachable at depth 1.
  for (const l of links) {
    if (l.toKind === 'page' && l.toPath && !pagePaths.has(l.fromPath)) {
      if (!depths.has(l.toPath)) {
        depths.set(l.toPath, 1);
        queue.push(l.toPath);
      }
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depths.get(cur)!;
    for (const next of adj.get(cur) ?? []) {
      if (!depths.has(next)) {
        depths.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  for (const p of pages) if (!depths.has(p.path)) depths.set(p.path, -1);
  return depths;
}
