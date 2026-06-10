/**
 * diagram.ts — deterministic FactsGraph → Mermaid flowchart.
 *
 * The diagram renders ONLY what the extractor emits (PLAN.md: "honest by
 * construction"). The same logic is reused client-side by serving the rendered
 * source at /api/mermaid, so the browser never re-derives the graph shape.
 *
 * Semantics (PLAN.md "Diagram semantics"):
 *  - flowchart LR, subgraphs per top-level directory cluster.
 *  - shapes by kind: route = rounded `(name)`, middleware = hexagon `{{name}}`,
 *    dbTable = cylinder `[(name)]`, envVar = tag `>name]`, component/file = rect.
 *  - dependency nodes omitted by default (noise).
 *  - attachedTo edges labeled "middleware".
 *  - wiredTo: solid `-->` for literal/constant-resolved/helper-resolved tiers,
 *    dashed `-.->` labeled "unmatched/dynamic" otherwise.
 *  - unresolved/dynamic nodes suffixed "?".
 *  - cap at opts.maxNodes (default 150); routes/middleware/tables kept first,
 *    then a single "…N more files" node.
 */
import type {
  EntityKind,
  FactEdge,
  FactNode,
  FactsGraph,
} from '../core/schema.js';

const DEFAULT_MAX_NODES = 150;

/** Kinds we never draw (noise). */
const OMITTED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'dependency',
  'dbColumn',
]);

/** Priority order when capping: keep the load-bearing structure first. */
const KIND_PRIORITY: Record<EntityKind, number> = {
  route: 0,
  middleware: 1,
  dbTable: 2,
  serverAction: 3,
  clientCall: 4,
  form: 5,
  envVar: 6,
  component: 7,
  function: 8,
  file: 9,
  dbColumn: 10,
  dependency: 11,
  // full-system-map kinds — infra ranks high (it frames the system)
  server: 0,
  database: 1,
  host: 0,
  externalService: 3,
  cron: 4,
};

/** Wiring tiers that count as a confirmed (solid) wire. */
const SOLID_WIRE_TIERS: ReadonlySet<string> = new Set([
  'literal',
  'constant-resolved',
  'helper-resolved',
]);

/**
 * Escape Mermaid-special characters in a label. Mermaid breaks on quotes,
 * brackets, braces, pipes, angle brackets, parens, and `#`. We wrap labels in
 * double quotes and HTML-escape the dangerous characters so the shape syntax
 * stays intact.
 */
export function escapeMermaidLabel(name: string): string {
  return name
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/#/g, '&#35;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\(/g, '&#40;')
    .replace(/\)/g, '&#41;')
    .replace(/\|/g, '&#124;')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Deterministic, Mermaid-safe node identifier derived from a fact id. */
function safeId(id: string): string {
  // Mermaid ids must be alphanumeric/underscore. Hash-free, stable mapping.
  let out = '';
  for (const ch of id) {
    out += /[a-zA-Z0-9]/.test(ch) ? ch : '_';
  }
  // Guard against leading digit (Mermaid prefers a letter/underscore start).
  return /^[a-zA-Z_]/.test(out) ? out : `n_${out}`;
}

/** Top-level directory cluster for a node, from its provenance path. */
function clusterOf(node: FactNode): string {
  const file = node.provenance?.file;
  if (!file) return '(unscoped)';
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const slash = norm.indexOf('/');
  if (slash === -1) return '(root)';
  return norm.slice(0, slash);
}

function shapeFor(node: FactNode, label: string): string {
  const suffix = node.unresolved ? '?' : '';
  const text = `"${label}${suffix}"`;
  switch (node.kind) {
    case 'route':
      return `(${text})`;
    case 'middleware':
      return `{{${text}}}`;
    case 'dbTable':
      return `[(${text})]`;
    case 'envVar':
      return `>${text}]`;
    default:
      // component / file / function / serverAction / clientCall → rect
      return `[${text}]`;
  }
}

function classFor(kind: EntityKind): string {
  switch (kind) {
    case 'route':
      return 'kRoute';
    case 'middleware':
      return 'kMw';
    case 'dbTable':
      return 'kTable';
    case 'envVar':
      return 'kEnv';
    default:
      return 'kFile';
  }
}

export function graphToMermaid(
  graph: FactsGraph,
  opts?: { maxNodes?: number },
): string {
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;

  const drawable = graph.nodes.filter((n) => !OMITTED_KINDS.has(n.kind));

  // Stable ordering: by kind priority, then name, then id.
  const sorted = [...drawable].sort((a, b) => {
    const pa = KIND_PRIORITY[a.kind] ?? 99;
    const pb = KIND_PRIORITY[b.kind] ?? 99;
    if (pa !== pb) return pa - pb;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const kept = sorted.slice(0, Math.max(0, maxNodes));
  const overflow = sorted.length - kept.length;
  const keptIds = new Set(kept.map((n) => n.id));

  // Group kept nodes by cluster (stable insertion order).
  const clusters = new Map<string, FactNode[]>();
  for (const n of kept) {
    const c = clusterOf(n);
    const arr = clusters.get(c);
    if (arr) arr.push(n);
    else clusters.set(c, [n]);
  }

  const lines: string[] = [];
  lines.push('flowchart LR');

  let subgraphIdx = 0;
  for (const [cluster, nodes] of clusters) {
    const sgId = `sg_${subgraphIdx++}`;
    lines.push(`  subgraph ${sgId}["${escapeMermaidLabel(cluster)}"]`);
    for (const n of nodes) {
      lines.push(`    ${safeId(n.id)}${shapeFor(n, escapeMermaidLabel(n.name))}`);
    }
    lines.push('  end');
  }

  if (overflow > 0) {
    lines.push(`  __more["…${overflow} more files"]`);
  }

  // Edges: only those whose endpoints are both kept and drawn.
  const drawnEdges = graph.edges.filter(
    (e) => keptIds.has(e.from) && keptIds.has(e.to),
  );
  for (const e of drawnEdges) {
    const line = renderEdge(e);
    if (line) lines.push(`  ${line}`);
  }

  // Class definitions + assignments (color is paired with shape; the UI legend
  // and verdict encoding never rely on color alone).
  lines.push('  classDef kRoute fill:#0b3d2e,stroke:#10b981,color:#e6fff4;');
  lines.push('  classDef kMw fill:#3d2e0b,stroke:#fbbf24,color:#fff8e6;');
  lines.push('  classDef kTable fill:#0b2e3d,stroke:#38bdf8,color:#e6f7ff;');
  lines.push('  classDef kEnv fill:#2e0b3d,stroke:#c084fc,color:#f6e6ff;');
  lines.push('  classDef kFile fill:#1a1d24,stroke:#3a4150,color:#cbd5e1;');

  // Assign classes grouped per class to keep output compact + deterministic.
  const byClass = new Map<string, string[]>();
  for (const n of kept) {
    const cls = classFor(n.kind);
    const arr = byClass.get(cls);
    if (arr) arr.push(safeId(n.id));
    else byClass.set(cls, [safeId(n.id)]);
  }
  for (const [cls, ids] of byClass) {
    lines.push(`  class ${ids.join(',')} ${cls};`);
  }

  return lines.join('\n');
}

function renderEdge(e: FactEdge): string | null {
  const from = safeId(e.from);
  const to = safeId(e.to);
  switch (e.kind) {
    case 'attachedTo':
      return `${from} -->|middleware| ${to}`;
    case 'wiredTo': {
      const tier = e.tier ?? 'dynamic';
      if (SOLID_WIRE_TIERS.has(tier)) {
        return `${from} --> ${to}`;
      }
      const label = e.unresolved || tier === 'dynamic' ? 'dynamic' : 'unmatched';
      return `${from} -.->|${label}| ${to}`;
    }
    case 'persistsTo':
      return `${from} -->|persists| ${to}`;
    case 'reads':
      return `${from} -.->|reads| ${to}`;
    case 'calls':
      return `${from} --> ${to}`;
    default:
      // imports/exports/dependsOn/hasColumn are structural noise in the diagram.
      return null;
  }
}
