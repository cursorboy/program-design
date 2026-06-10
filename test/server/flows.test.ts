import { describe, it, expect } from 'vitest';
import {
  deriveFlows,
  derivePages,
  deriveNavigation,
  deriveForms,
  computeNavDepths,
  friendlyComponentName,
} from '../../src/server/flows.js';
import {
  emptyGraph,
  makeNodeId,
  makeEdgeId,
  type FactsGraph,
  type FactNode,
  type FactEdge,
  type Provenance,
} from '../../src/core/schema.js';

function prov(file: string, line: number): Provenance {
  return { file, line, ruleId: 'test' };
}

function node(
  kind: FactNode['kind'],
  name: string,
  file: string | null,
  line = 1,
  attrs: FactNode['attrs'] = {},
): FactNode {
  return {
    id: makeNodeId(kind, name),
    kind,
    name,
    provenance: file ? prov(file, line) : null,
    attrs,
    invalidatedBy: [],
  };
}

function edge(
  kind: FactEdge['kind'],
  from: string,
  to: string,
  opts: Partial<FactEdge> = {},
): FactEdge {
  return {
    id: makeEdgeId(kind, from, to),
    kind,
    from,
    to,
    provenance: opts.provenance ?? prov('edge.ts', 5),
    tier: opts.tier,
    invalidatedBy: [],
    unresolved: opts.unresolved,
  };
}

function graphWith(nodes: FactNode[], edges: FactEdge[]): FactsGraph {
  const g = emptyGraph('/repo');
  g.nodes = nodes;
  g.edges = edges;
  return g;
}

describe('friendlyComponentName', () => {
  it('splits PascalCase and drops the extension', () => {
    expect(friendlyComponentName('LoginForm.tsx')).toBe('Login form');
    expect(friendlyComponentName('src/components/UserSettingsPanel.tsx')).toBe(
      'User settings panel',
    );
  });
});

describe('deriveFlows — full traced flow (wiring + guard + persists)', () => {
  const caller = node('clientCall', 'fetch /api/login', 'src/LoginForm.tsx', 12);
  const route = node('route', 'POST /api/login', 'src/app/api/login/route.ts', 1, {
    method: 'POST',
  });
  const mw = node('middleware', 'auth', 'src/middleware.ts', 3);
  const table = node('dbTable', 'User', 'prisma/schema.prisma', 9);

  const wire = edge('wiredTo', caller.id, route.id, {
    tier: 'literal',
    provenance: prov('src/LoginForm.tsx', 12),
  });
  const attached = edge('attachedTo', mw.id, route.id, {
    tier: 'guard-wrapper',
    provenance: prov('src/middleware.ts', 3),
  });
  const persists = edge('persistsTo', route.id, table.id, {
    provenance: prov('src/app/api/login/route.ts', 20),
  });

  const flows = deriveFlows(graphWith([caller, route, mw, table], [wire, attached, persists]));

  it('produces exactly one flow with 5 ordered steps', () => {
    expect(flows).toHaveLength(1);
    const kinds = flows[0]!.steps.map((s) => s.kind);
    expect(kinds).toEqual(['page', 'action', 'endpoint', 'guard', 'table']);
  });

  it('is marked traced', () => {
    expect(flows[0]!.traced).toBe(true);
  });

  it('carries receipts + factIds on every graph-grounded step', () => {
    const [page, action, endpoint, guard, tableStep] = flows[0]!.steps;
    expect(page!.receipt).toEqual({ file: 'src/LoginForm.tsx', line: 12 });
    expect(page!.factId).toBe(caller.id);
    expect(action!.receipt).toEqual({ file: 'src/LoginForm.tsx', line: 12 });
    expect(action!.factId).toBe(wire.id);
    expect(endpoint!.receipt).toEqual({ file: 'src/app/api/login/route.ts', line: 1 });
    expect(endpoint!.factId).toBe(route.id);
    expect(guard!.receipt).toEqual({ file: 'src/middleware.ts', line: 3 });
    expect(guard!.factId).toBe(attached.id);
    expect(tableStep!.receipt).toEqual({ file: 'src/app/api/login/route.ts', line: 20 });
    expect(tableStep!.factId).toBe(persists.id);
  });

  it('uses friendly plain-English labels (no jargon)', () => {
    const labels = flows[0]!.steps.map((s) => s.label);
    expect(labels[0]).toBe('Login form');
    expect(labels[2]).toContain('/api/login');
    expect(labels[3]).toContain('security guard');
    expect(labels[4]).toContain('User records');
  });
});

describe('deriveFlows — dynamic / unresolved wiring is honest', () => {
  const caller = node('clientCall', 'fetch dynamic', 'src/Widget.tsx', 4);
  const route = node('route', 'POST /api/x', 'src/app/api/x/route.ts', 1, { method: 'POST' });

  it('dynamic tier → traced:false ending on an unknown step', () => {
    const wire = edge('wiredTo', caller.id, route.id, { tier: 'dynamic' });
    const flows = deriveFlows(graphWith([caller, route], [wire]));
    expect(flows).toHaveLength(1);
    expect(flows[0]!.traced).toBe(false);
    const last = flows[0]!.steps[flows[0]!.steps.length - 1]!;
    expect(last.kind).toBe('unknown');
    expect(last.plain).toContain("can’t trace");
    expect(last.receipt).toBeUndefined();
  });

  it('unresolved wire → traced:false', () => {
    const wire = edge('wiredTo', caller.id, route.id, { tier: 'literal', unresolved: true });
    const flows = deriveFlows(graphWith([caller, route], [wire]));
    expect(flows[0]!.traced).toBe(false);
    expect(flows[0]!.steps.map((s) => s.kind)).toEqual(['page', 'action', 'unknown']);
  });
});

describe('derivePages — standalone page routes with no incoming wiring', () => {
  it('lists GET page routes with no wiring as visitable pages', () => {
    const home = node('route', 'GET /', 'src/app/page.tsx', 1, { method: 'GET' });
    const about = node('route', 'GET /about', 'src/app/about/page.tsx', 1, { method: 'GET' });
    const api = node('route', 'POST /api/login', 'src/app/api/login/route.ts', 1, {
      method: 'POST',
    });
    const pages = derivePages(graphWith([home, about, api], []));
    expect(pages.map((p) => p.path)).toEqual(['/', '/about']);
    expect(pages[0]!.label).toBe('Home page');
    expect(pages[1]!.label).toBe('About page');
    expect(pages[0]!.receipt).toEqual({ file: 'src/app/page.tsx', line: 1 });
  });

  it('excludes page routes that are wiredTo targets', () => {
    const page = node('route', 'GET /dash', 'src/app/dash/page.tsx', 1, { method: 'GET' });
    const caller = node('clientCall', 'go dash', 'src/Nav.tsx', 2);
    const wire = edge('wiredTo', caller.id, page.id, { tier: 'literal' });
    const pages = derivePages(graphWith([page, caller], [wire]));
    expect(pages).toHaveLength(0);
  });
});

describe('deriveFlows — determinism', () => {
  it('same graph → identical output', () => {
    const caller = node('clientCall', 'fetch /api/a', 'src/A.tsx', 2);
    const route = node('route', 'POST /api/a', 'src/app/api/a/route.ts', 1, { method: 'POST' });
    const wire = edge('wiredTo', caller.id, route.id, { tier: 'literal' });
    const g = graphWith([caller, route], [wire]);
    expect(JSON.stringify(deriveFlows(g))).toBe(JSON.stringify(deriveFlows(g)));
  });

  it('a guard whose tier is unconfirmed does NOT add a guard step', () => {
    const caller = node('clientCall', 'fetch /api/a', 'src/A.tsx', 2);
    const route = node('route', 'POST /api/a', 'src/app/api/a/route.ts', 1, { method: 'POST' });
    const mw = node('middleware', 'global', 'src/middleware.ts', 1);
    const wire = edge('wiredTo', caller.id, route.id, { tier: 'literal' });
    const attached = edge('attachedTo', mw.id, route.id, { tier: 'unconfirmed' });
    const flows = deriveFlows(graphWith([caller, route, mw], [wire, attached]));
    expect(flows[0]!.steps.map((s) => s.kind)).toEqual(['page', 'action', 'endpoint']);
  });

  it('relabels a bare client-call component to a plain action phrase (no "Dynamic")', () => {
    const caller = node('clientCall', 'comp', 'src/components/Dynamic.tsx', 4, { method: 'GET' });
    const route = node('route', 'GET /api/x', 'src/app/api/x/route.ts', 1, { method: 'GET' });
    // dynamic/unresolved wire → untraced flow.
    const wire = edge('wiredTo', caller.id, route.id, { tier: 'dynamic', unresolved: true });
    const flows = deriveFlows(graphWith([caller, route], [wire]));
    const pageStep = flows[0]!.steps.find((s) => s.kind === 'page')!;
    expect(pageStep.label).not.toBe('Dynamic');
    expect(pageStep.label.toLowerCase()).toContain('button');
  });
});

describe('deriveNavigation — page-to-page links', () => {
  const home = node('route', 'GET /', 'app/page.tsx', 1, { method: 'GET', path: '/' });
  const login = node('route', 'GET /login', 'app/login/page.tsx', 1, {
    method: 'GET',
    path: '/login',
  });
  const ext = node('component', 'external:https://example.com', 'app/page.tsx', 5, {
    external: true,
    url: 'https://example.com',
  });

  it('resolves an internal link to the target page node (traced)', () => {
    const link = edge('navigatesTo', home.id, login.id, { tier: 'literal' });
    const nav = deriveNavigation(graphWith([home, login], [link]));
    expect(nav.length).toBe(1);
    expect(nav[0]!.toKind).toBe('page');
    expect(nav[0]!.toPath).toBe('/login');
    expect(nav[0]!.traced).toBe(true);
  });

  it('marks an external link target as external', () => {
    const link = edge('navigatesTo', home.id, ext.id, { tier: 'literal' });
    const nav = deriveNavigation(graphWith([home, ext], [link]));
    expect(nav[0]!.toKind).toBe('external');
    expect(nav[0]!.toUrl).toBe('https://example.com');
  });

  it('marks a dynamic/unresolved link as untraced (honest)', () => {
    // a dynamic link has NO target node — the edge points at a ghost id that does
    // not exist in the graph (exactly how the extractor emits it).
    const link = edge('navigatesTo', home.id, 'route:GET ?nav:app/page.tsx#3', {
      tier: 'dynamic',
      unresolved: true,
    });
    const nav = deriveNavigation(graphWith([home], [link]));
    expect(nav[0]!.toKind).toBe('unknown');
    expect(nav[0]!.traced).toBe(false);
  });

  it('computes nav depth breadth-first from the home root', () => {
    const about = node('route', 'GET /about', 'app/about/page.tsx', 1, {
      method: 'GET',
      path: '/about',
    });
    const l1 = edge('navigatesTo', home.id, login.id, { tier: 'literal' });
    const l2 = edge('navigatesTo', login.id, about.id, { tier: 'literal' });
    const g = graphWith([home, login, about], [l1, l2]);
    const pages = derivePages(g);
    const depths = computeNavDepths(pages, deriveNavigation(g));
    expect(depths.get('/')).toBe(0);
    expect(depths.get('/login')).toBe(1);
    expect(depths.get('/about')).toBe(2);
  });
});

describe('deriveForms — forms + submit destinations', () => {
  const loginPage = node('route', 'GET /login', 'app/login/page.tsx', 1, {
    method: 'GET',
    path: '/login',
  });
  const loginRoute = node('route', 'POST /api/login', 'app/api/login/route.ts', 1, {
    method: 'POST',
    path: '/api/login',
  });

  it('reports a traced form → door submit with a plain "… form" label', () => {
    const form = node('form', 'components/LoginForm.tsx#0', 'components/LoginForm.tsx', 8, {
      owner: loginPage.id,
    });
    const sub = edge('submitsTo', form.id, loginRoute.id, { tier: 'literal' });
    const forms = deriveForms(graphWith([loginPage, loginRoute, form], [sub]));
    expect(forms.length).toBe(1);
    expect(forms[0]!.label).toBe('Login form');
    expect(forms[0]!.dest).toBe('route');
    expect(forms[0]!.traced).toBe(true);
    expect(forms[0]!.ownerPath).toBe('/login');
    expect(forms[0]!.destLabel).toContain('/api/login');
  });

  it('reports an untraceable form as not traced (honest)', () => {
    const form = node('form', 'components/SearchForm.tsx#0', 'components/SearchForm.tsx', 8, {
      owner: 'file:components/SearchForm.tsx',
    });
    const ghost = node('route', 'POST ?form:components/SearchForm.tsx#0', null);
    const sub = edge('submitsTo', form.id, ghost.id, { tier: 'dynamic', unresolved: true });
    const forms = deriveForms(graphWith([form, ghost], [sub]));
    expect(forms[0]!.dest).toBe('unknown');
    expect(forms[0]!.traced).toBe(false);
  });
});
