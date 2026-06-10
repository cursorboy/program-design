/**
 * Hand-constructed FactsGraph builders for checker tests. These do NOT depend on
 * the extractor — every graph here is built by hand to exercise a specific rule.
 */
import {
  type Claim,
  type ClaimManifest,
  type FactEdge,
  type FactNode,
  type FactsGraph,
  type Provenance,
  SCHEMA_VERSION,
  makeEdgeId,
  makeNodeId,
} from '../../src/core/schema.js';

export function prov(
  file: string,
  line: number,
  ruleId: string,
  endLine?: number,
): Provenance {
  return endLine !== undefined
    ? { file, line, endLine, ruleId }
    : { file, line, ruleId };
}

export function node(
  partial: Partial<FactNode> & Pick<FactNode, 'kind' | 'name'>,
): FactNode {
  return {
    id: makeNodeId(partial.kind, partial.name),
    kind: partial.kind,
    name: partial.name,
    provenance: partial.provenance ?? null,
    attrs: partial.attrs ?? {},
    invalidatedBy: partial.invalidatedBy ?? [],
    ...(partial.unresolved !== undefined
      ? { unresolved: partial.unresolved }
      : {}),
  };
}

export function edge(
  partial: Partial<FactEdge> &
    Pick<FactEdge, 'kind' | 'from' | 'to'>,
): FactEdge {
  return {
    id: makeEdgeId(partial.kind, partial.from, partial.to),
    kind: partial.kind,
    from: partial.from,
    to: partial.to,
    provenance: partial.provenance ?? null,
    invalidatedBy: partial.invalidatedBy ?? [],
    ...(partial.tier !== undefined ? { tier: partial.tier } : {}),
    ...(partial.unresolved !== undefined
      ? { unresolved: partial.unresolved }
      : {}),
  };
}

export function graph(partial: Partial<FactsGraph> = {}): FactsGraph {
  return {
    schemaVersion: SCHEMA_VERSION,
    repoRoot: '/tmp/repo',
    generatedAt: '2026-06-07T00:00:00.000Z',
    buildActive: partial.buildActive ?? false,
    parseFailures: partial.parseFailures ?? [],
    nodes: partial.nodes ?? [],
    edges: partial.edges ?? [],
    stats: partial.stats ?? {},
  };
}

let counter = 0;
export function claim(partial: Partial<Claim> & Pick<Claim, 'category' | 'predicate' | 'subject'>): Claim {
  return {
    id: partial.id ?? `c${++counter}`,
    category: partial.category,
    predicate: partial.predicate,
    subject: partial.subject,
    qualifiers: partial.qualifiers ?? {},
    rawText: partial.rawText ?? `${partial.category} ${partial.subject}`,
  };
}

export function manifest(claims: Claim[]): ClaimManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: 's1',
    source: 'agent',
    claims,
    unverifiable: [],
  };
}
