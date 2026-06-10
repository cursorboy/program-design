/**
 * Claim-manifest + state-file I/O for the CLI.
 *
 * `check --manifest <path>` accepts either a full ClaimManifest JSON object or
 * a bare Claim[] array (third-party agents / hand-authored specs). This module
 * normalizes both into a ClaimManifest and does a structural shape check
 * (the deeper, allowlist-aware validation is core `validateManifest`).
 *
 * It also centralizes reading/writing the disposable state files (graph.json,
 * verdicts.json) with corruption handling, so commands stay thin.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  Claim,
  ClaimManifest,
  ClaimCategory,
  ClaimPredicate,
  FactsGraph,
  ClaimVerdict,
} from '../core/schema.js';
import { SCHEMA_VERSION } from '../core/schema.js';
import { statePath } from '../core/state.js';
import { PDError } from './errors.js';

const CATEGORIES: ReadonlySet<string> = new Set<ClaimCategory>([
  'route',
  'middleware',
  'schema',
  'env',
  'dep',
  'wiring',
]);

const PREDICATES: ReadonlySet<string> = new Set<ClaimPredicate>([
  'exists',
  'attached',
  'has-column',
  'reads',
  'installed',
  'wired',
]);

function isClaimShape(v: unknown): v is Claim {
  if (v === null || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.category === 'string' &&
    CATEGORIES.has(c.category) &&
    typeof c.predicate === 'string' &&
    PREDICATES.has(c.predicate) &&
    typeof c.subject === 'string' &&
    typeof c.rawText === 'string' &&
    c.qualifiers !== null &&
    typeof c.qualifiers === 'object' &&
    !Array.isArray(c.qualifiers)
  );
}

/**
 * Normalize parsed JSON (object | array) into a ClaimManifest. Throws a
 * PDError('manifest-invalid') with a precise detail on any structural problem.
 * Exported pure of filesystem so tests can drive it directly.
 */
export function normalizeManifest(raw: unknown, sessionId?: string): ClaimManifest {
  // Bare Claim[] form.
  if (Array.isArray(raw)) {
    raw.forEach((c, i) => {
      if (!isClaimShape(c)) {
        throw new PDError('manifest-invalid', `claim at index ${i} is malformed.`);
      }
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId: sessionId ?? randomUUID(),
      source: 'file',
      claims: raw as Claim[],
      unverifiable: [],
    };
  }

  if (raw === null || typeof raw !== 'object') {
    throw new PDError(
      'manifest-invalid',
      'expected a JSON object (ClaimManifest) or array (Claim[]).',
    );
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.claims)) {
    throw new PDError('manifest-invalid', 'manifest.claims must be an array.');
  }
  obj.claims.forEach((c, i) => {
    if (!isClaimShape(c)) {
      throw new PDError('manifest-invalid', `claims[${i}] is malformed.`);
    }
  });

  const unverifiable = Array.isArray(obj.unverifiable) ? obj.unverifiable : [];

  return {
    schemaVersion:
      typeof obj.schemaVersion === 'number' ? obj.schemaVersion : SCHEMA_VERSION,
    sessionId:
      typeof obj.sessionId === 'string'
        ? obj.sessionId
        : (sessionId ?? randomUUID()),
    source: obj.source === 'agent' || obj.source === 'user' ? obj.source : 'file',
    claims: obj.claims as Claim[],
    unverifiable: unverifiable as ClaimManifest['unverifiable'],
  };
}

/** Read + normalize a manifest file from disk. */
export function readManifestFile(path: string, sessionId?: string): ClaimManifest {
  if (!existsSync(path)) {
    throw new PDError('manifest-invalid', `file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PDError('manifest-invalid', `not valid JSON: ${msg}`);
  }
  return normalizeManifest(parsed, sessionId);
}

// ---------------------------------------------------------------------------
// Disposable state-file I/O
// ---------------------------------------------------------------------------

/** Read graph.json. Returns null if missing; throws graph-corrupt on bad JSON. */
export function readGraph(repoRoot: string): FactsGraph | null {
  const path = statePath(repoRoot, 'graph');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FactsGraph;
  } catch {
    throw new PDError('graph-corrupt', `failed to parse ${path}.`);
  }
}

export function writeGraph(repoRoot: string, graph: FactsGraph): void {
  writeFileSync(statePath(repoRoot, 'graph'), JSON.stringify(graph, null, 2));
}

/** True if no graph exists, it's corrupt, schemaVersion mismatches, or it's older than maxAgeMs. */
export function isGraphStale(repoRoot: string, maxAgeMs: number): boolean {
  const path = statePath(repoRoot, 'graph');
  if (!existsSync(path)) return true;
  let graph: FactsGraph;
  try {
    graph = JSON.parse(readFileSync(path, 'utf8')) as FactsGraph;
  } catch {
    return true; // corrupt → treat as stale, rebuild
  }
  if (graph.schemaVersion !== SCHEMA_VERSION) return true;
  const ageMs = Date.now() - statSync(path).mtimeMs;
  return ageMs > maxAgeMs;
}

export function readVerdicts(repoRoot: string): ClaimVerdict[] | null {
  const path = statePath(repoRoot, 'verdicts');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ClaimVerdict[];
  } catch {
    throw new PDError('graph-corrupt', `failed to parse ${path}.`);
  }
}

export function writeVerdicts(repoRoot: string, verdicts: ClaimVerdict[]): void {
  writeFileSync(
    statePath(repoRoot, 'verdicts'),
    JSON.stringify(verdicts, null, 2),
  );
}
