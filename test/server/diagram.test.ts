import { describe, it, expect } from 'vitest';
import { graphToMermaid, escapeMermaidLabel } from '../../src/server/diagram.js';
import {
  emptyGraph,
  makeNodeId,
  makeEdgeId,
  type FactsGraph,
  type FactNode,
  type FactEdge,
  type EntityKind,
} from '../../src/core/schema.js';

function node(
  kind: EntityKind,
  name: string,
  file: string,
  extra: Partial<FactNode> = {},
): FactNode {
  return {
    id: makeNodeId(kind, name),
    kind,
    name,
    provenance: { file, line: 1, ruleId: 'test' },
    attrs: {},
    invalidatedBy: [],
    ...extra,
  };
}

function edge(
  kind: FactEdge['kind'],
  from: string,
  to: string,
  extra: Partial<FactEdge> = {},
): FactEdge {
  return {
    id: makeEdgeId(kind, from, to),
    kind,
    from,
    to,
    provenance: null,
    invalidatedBy: [],
    ...extra,
  };
}

function synthetic(): FactsGraph {
  const g = emptyGraph('/repo');
  const route = node('route', 'GET /api/login', 'app/api/login/route.ts');
  const mw = node('middleware', 'auth', 'middleware.ts');
  const table = node('dbTable', 'users', 'prisma/schema.prisma');
  const env = node('envVar', 'DATABASE_URL', 'app/api/login/route.ts');
  const comp = node('component', 'LoginForm', 'app/login/page.tsx');
  const dep = node('dependency', 'next', 'package.json');
  const call = node('clientCall', 'fetch /api/login', 'app/login/page.tsx');
  g.nodes = [route, mw, table, env, comp, dep, call];
  g.edges = [
    edge('attachedTo', mw.id, route.id),
    edge('wiredTo', call.id, route.id, { tier: 'literal' }),
    edge('reads', route.id, env.id),
    edge('persistsTo', route.id, table.id),
    edge('dependsOn', comp.id, dep.id),
  ];
  return g;
}

describe('graphToMermaid', () => {
  it('starts with flowchart LR and uses shapes per kind', () => {
    const out = graphToMermaid(synthetic());
    expect(out.startsWith('flowchart LR')).toBe(true);
    // route → rounded ( )
    expect(out).toMatch(/\("GET \/api\/login"\)/);
    // middleware → hexagon {{ }}
    expect(out).toMatch(/\{\{"auth"\}\}/);
    // dbTable → cylinder [( )]
    expect(out).toMatch(/\[\("users"\)\]/);
    // envVar → tag >name]
    expect(out).toMatch(/>"DATABASE_URL"\]/);
    // component → rect [ ]
    expect(out).toMatch(/\["LoginForm"\]/);
  });

  it('omits dependency nodes by default', () => {
    const out = graphToMermaid(synthetic());
    expect(out).not.toContain('"next"');
    expect(out).not.toContain('|dependsOn|');
  });

  it('labels attachedTo edges as middleware', () => {
    const out = graphToMermaid(synthetic());
    expect(out).toMatch(/-->\|middleware\|/);
  });

  it('uses solid wire for literal tier and dashed for dynamic', () => {
    const g = synthetic();
    // add a dynamic wire
    const call2 = node('clientCall', 'fetch dynamic', 'app/x/page.tsx');
    g.nodes.push(call2);
    const route = g.nodes.find((n) => n.kind === 'route')!;
    g.edges.push(
      edge('wiredTo', call2.id, route.id, { tier: 'dynamic', unresolved: true }),
    );
    const out = graphToMermaid(g);
    // literal → solid
    expect(out).toMatch(/-->\s/);
    // dynamic → dashed labeled
    expect(out).toMatch(/-\.->\|dynamic\|/);
  });

  it('suffixes unresolved nodes with ?', () => {
    const g = emptyGraph('/repo');
    g.nodes = [node('route', 'GET /api/ghost', 'app/api/ghost/route.ts', { unresolved: true })];
    const out = graphToMermaid(g);
    expect(out).toMatch(/\("GET \/api\/ghost\?"\)/);
  });

  it('caps at maxNodes and adds a "…N more files" node', () => {
    const g = emptyGraph('/repo');
    const nodes: FactNode[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(node('file', `file${i}.ts`, `src/file${i}.ts`));
    }
    g.nodes = nodes;
    const out = graphToMermaid(g, { maxNodes: 5 });
    expect(out).toContain('…15 more files');
    // only 5 file nodes drawn
    const drawn = (out.match(/\["file\d+\.ts"\]/g) || []).length;
    expect(drawn).toBe(5);
  });

  it('keeps routes/middleware/tables before files when capping', () => {
    const g = emptyGraph('/repo');
    const nodes: FactNode[] = [];
    for (let i = 0; i < 10; i++) nodes.push(node('file', `f${i}.ts`, `src/f${i}.ts`));
    nodes.push(node('route', 'GET /keep', 'app/keep/route.ts'));
    g.nodes = nodes;
    const out = graphToMermaid(g, { maxNodes: 1 });
    expect(out).toContain('"GET /keep"');
    expect(out).toContain('…10 more files');
  });

  it('escapes mermaid-special characters in names', () => {
    expect(escapeMermaidLabel('a{b}[c]"d"')).toBe('a&#123;b&#125;&#91;c&#93;&quot;d&quot;');
    const g = emptyGraph('/repo');
    g.nodes = [node('route', 'GET /api/{id}', 'app/api/[id]/route.ts')];
    const out = graphToMermaid(g);
    expect(out).not.toContain('{id}');
    expect(out).toContain('&#123;id&#125;');
  });

  it('produces a deterministic output for the same graph', () => {
    const a = graphToMermaid(synthetic());
    const b = graphToMermaid(synthetic());
    expect(a).toBe(b);
  });
});
