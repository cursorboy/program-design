/**
 * organize.ts — install an LLM-authored ("organize pass") system map.
 *
 * The deterministic deriver (server/system-map-derive.ts) gives every repo a
 * fact-anchored map with zero LLM calls. The organize pass is the optional
 * upgrade: a clean-context LLM (normally the Claude Code skill) reads the real
 * source plus the facts graph and writes a RICHER map — better labels, hosting
 * detail, end-to-end stories, concerns. This module is the gate that map must
 * pass through:
 *
 *   - shape-validated (nodes/edges arrays, string fields),
 *   - fact-anchored via validateMap: any node whose file receipt does not
 *     resolve to a real repo file is DROPPED, and edges to dropped nodes go
 *     with it — the LLM cannot invent structure,
 *   - stamped generatedBy:'llm' so the deterministic deriver never overwrites
 *     it on the next extraction.
 *
 * Pure logic lives here (testable without spawning the CLI); cli/index.ts owns
 * argv, error formatting, and exit codes.
 */
import type { FactsGraph } from '../core/schema.js';
import {
  SYSTEM_MAP_VERSION,
  validateMap,
  layerForKind,
  detectProvider,
  type SystemMap,
  type SystemNode,
  type SystemNodeKind,
} from '../core/system-map.js';
import { TOUR_VERSION, type Tour, type Beat } from '../core/tour.js';

const NODE_KINDS: ReadonlySet<string> = new Set([
  'page',
  'server',
  'worker',
  'scraper',
  'database',
  'cache',
  'dataTable',
  'externalService',
  'cron',
]);

export interface InstallResult {
  ok: boolean;
  errors: string[];
  map?: SystemMap;
  tour?: Tour;
  nodesKept: number;
  nodesDropped: number;
  edgesKept: number;
  edgesDropped: number;
  /** Reveal ids removed from tour beats because they don't exist in the map. */
  revealsDropped: number;
}

function failResult(errors: string[]): InstallResult {
  return { ok: false, errors, nodesKept: 0, nodesDropped: 0, edgesKept: 0, edgesDropped: 0, revealsDropped: 0 };
}

/** The set of repo-relative paths the deterministic extractor actually saw. */
export function realFilesOf(graph: FactsGraph): Set<string> {
  const files = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === 'file') files.add(n.name);
    if (n.provenance?.file) files.add(n.provenance.file);
  }
  for (const e of graph.edges) {
    if (e.provenance?.file) files.add(e.provenance.file);
  }
  return files;
}

/**
 * Validate + normalize an authored SystemMap (and optional Tour) against the
 * facts graph. Returns the stamped artifacts ready to be written, plus a
 * summary of what the fact-anchor gate dropped.
 */
export function prepareAuthoredMap(
  graph: FactsGraph,
  rawMap: unknown,
  rawTour?: unknown,
  now?: string,
): InstallResult {
  const errors: string[] = [];
  if (typeof rawMap !== 'object' || rawMap === null || Array.isArray(rawMap)) {
    return failResult(['map must be a JSON object']);
  }
  const m = rawMap as Record<string, unknown>;
  if (!Array.isArray(m.nodes) || m.nodes.length === 0) errors.push('map.nodes must be a non-empty array');
  if (m.edges !== undefined && !Array.isArray(m.edges)) errors.push('map.edges must be an array');
  if (errors.length > 0) return failResult(errors);

  // Normalize nodes: required id/kind/label; layer + provider get deterministic
  // backstops so the author can omit them.
  const nodes: SystemNode[] = [];
  for (const [i, raw] of (m.nodes as unknown[]).entries()) {
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== 'string' || !n.id) { errors.push(`nodes[${i}]: missing id`); continue; }
    if (typeof n.kind !== 'string' || !NODE_KINDS.has(n.kind)) {
      errors.push(`nodes[${i}] (${n.id}): kind must be one of ${[...NODE_KINDS].join(', ')}`);
      continue;
    }
    if (typeof n.label !== 'string' || !n.label) { errors.push(`nodes[${i}] (${n.id}): missing label`); continue; }
    const kind = n.kind as SystemNodeKind;
    nodes.push({
      id: n.id,
      kind,
      layer: typeof n.layer === 'string' && n.layer ? (n.layer as SystemNode['layer']) : layerForKind(kind),
      label: n.label,
      technical: typeof n.technical === 'string' ? n.technical : '',
      host: typeof n.host === 'string' ? n.host : undefined,
      provider:
        typeof n.provider === 'string' && n.provider
          ? (n.provider as SystemNode['provider'])
          : detectProvider([n.host, n.technical].filter(Boolean).join(' ')),
      sensitive: Array.isArray(n.sensitive) ? (n.sensitive as string[]).filter((s) => typeof s === 'string') : undefined,
      file: typeof n.file === 'string' ? n.file : undefined,
      note: typeof n.note === 'string' ? n.note : undefined,
    });
  }
  if (errors.length > 0) return failResult(errors);

  const candidate: SystemMap = {
    schemaVersion: SYSTEM_MAP_VERSION,
    generatedBy: 'llm',
    generatedAt: now ?? new Date().toISOString(),
    repoRoot: graph.repoRoot,
    what: typeof m.what === 'string' ? m.what : '',
    nodes,
    edges: Array.isArray(m.edges)
      ? (m.edges as Record<string, unknown>[])
          .filter((e) => typeof e.from === 'string' && typeof e.to === 'string')
          .map((e) => ({
            from: e.from as string,
            to: e.to as string,
            flows: typeof e.flows === 'string' ? e.flows : '',
            file: typeof e.file === 'string' ? e.file : undefined,
            intended: e.intended === true ? true : undefined,
          }))
      : [],
    dataFlows: Array.isArray(m.dataFlows)
      ? (m.dataFlows as Record<string, unknown>[])
          .filter((f) => typeof f.title === 'string' && typeof f.plain === 'string')
          .map((f) => ({ title: f.title as string, plain: f.plain as string }))
      : [],
    concerns: Array.isArray(m.concerns)
      ? (m.concerns as Record<string, unknown>[])
          .filter((c) => typeof c.label === 'string')
          .map((c) => ({
            label: c.label as string,
            detail: typeof c.detail === 'string' ? c.detail : '',
            file: typeof c.file === 'string' ? c.file : undefined,
            severity: c.severity === 'high' || c.severity === 'med' || c.severity === 'low' ? c.severity : undefined,
          }))
      : [],
  };

  // The fact-anchor gate: no receipt that resolves to a real file → dropped.
  const validated = validateMap(candidate, realFilesOf(graph));
  const nodesDropped = candidate.nodes.length - validated.nodes.length;
  const edgesDropped = candidate.edges.length - validated.edges.length;
  if (validated.nodes.length === 0) {
    return failResult([
      'every node was dropped: no node carries a file receipt that resolves to a real repo file. ' +
        'Each node needs file: "<repo-relative-path>:<line>" pointing at code that exists.',
    ]);
  }

  // Optional tour: beats keep their order; reveal ids that don't exist in the
  // validated map are silently dropped (an edge id "a->b" is checked by ends).
  let tour: Tour | undefined;
  let revealsDropped = 0;
  if (rawTour !== undefined) {
    if (typeof rawTour !== 'object' || rawTour === null || Array.isArray(rawTour)) {
      return failResult(['tour must be a JSON object']);
    }
    const t = rawTour as Record<string, unknown>;
    if (!Array.isArray(t.beats) || t.beats.length === 0) return failResult(['tour.beats must be a non-empty array']);
    const ids = new Set(validated.nodes.map((n) => n.id));
    const beats: Beat[] = [];
    for (const [i, raw] of (t.beats as unknown[]).entries()) {
      const b = raw as Record<string, unknown>;
      if (typeof b.caption !== 'string' || !b.caption) return failResult([`tour.beats[${i}]: missing caption`]);
      const reveal = (Array.isArray(b.reveal) ? (b.reveal as unknown[]) : []).filter(
        (id): id is string => typeof id === 'string',
      );
      const kept = reveal.filter((id) => {
        if (id.includes('->')) {
          const [from, to] = id.replace(/^sys:/, '').split('->');
          return !!from && !!to && ids.has(from) && ids.has(to);
        }
        return ids.has(id);
      });
      revealsDropped += reveal.length - kept.length;
      beats.push({
        caption: b.caption,
        reveal: kept,
        highlight: Array.isArray(b.highlight) ? (b.highlight as string[]).filter((s) => typeof s === 'string') : undefined,
        shot: typeof b.shot === 'string' ? b.shot : undefined,
        concern: b.concern === true ? true : undefined,
      });
    }
    tour = {
      schemaVersion: TOUR_VERSION,
      title: typeof t.title === 'string' && t.title ? t.title : 'How your app works',
      beats,
      generatedBy: 'llm',
    };
  }

  return {
    ok: true,
    errors: [],
    map: validated,
    tour,
    nodesKept: validated.nodes.length,
    nodesDropped,
    edgesKept: validated.edges.length,
    edgesDropped,
    revealsDropped,
  };
}
