/**
 * security.ts — the daemon's trust boundary (PLAN.md "Engineering Hardening").
 *
 * 127.0.0.1 bind is necessary but not sufficient. On every request we also:
 *  - require the per-session token (query ?t= or X-PD-Token header),
 *  - validate the Host header is loopback (anti-DNS-rebinding),
 *  - jail the snippet endpoint to realpath(repoRoot), rejecting `..` traversal
 *    and symlink escapes.
 *
 * Honest limitation (documented in PLAN.md): snippet contents are NOT
 * secret-scrubbed; the jail only guarantees we never serve outside the repo.
 */
import { realpathSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** Tokens are compared in constant time to avoid timing oracles. */
export function tokensMatch(a: string | undefined, b: string): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Validate the Host header points at loopback. Accepts:
 *   127.0.0.1[:port], localhost[:port], [::1][:port]
 * Anything else (e.g. an attacker's domain that resolves to 127.0.0.1) → reject.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const allowedHosts = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  // Strip the port if present. IPv6 hosts arrive bracketed: [::1]:4317
  let h = host;
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    if (close === -1) return false;
    const portPart = h.slice(close + 1);
    if (portPart && portPart !== `:${port}`) return false;
    h = h.slice(0, close + 1);
  } else {
    const colon = h.lastIndexOf(':');
    if (colon !== -1) {
      const portPart = h.slice(colon + 1);
      if (!/^\d+$/.test(portPart)) return false;
      if (portPart !== String(port)) return false;
      h = h.slice(0, colon);
    }
  }
  return allowedHosts.includes(h);
}

export interface SnippetResult {
  ok: boolean;
  status: number;
  /** Present when ok. */
  lines?: string[];
  /** 1-based line range actually returned. */
  startLine?: number;
  endLine?: number;
  /** The requested (1-based) center line. */
  centerLine?: number;
  error?: string;
}

/**
 * Read ±contextLines around `line` from `file`, jailed inside repoRoot.
 *
 * Jail algorithm:
 *  1. resolve(repoRoot, file) — collapses `..`.
 *  2. realpathSync on the resolved path — follows symlinks to the true target.
 *  3. assert the real target is inside realpath(repoRoot).
 * A symlink that points outside the repo therefore fails step 3, and `..`
 * traversal fails step 1's containment check.
 */
export function readSnippet(
  repoRoot: string,
  file: string,
  line: number,
  contextLines = 2,
): SnippetResult {
  if (!file || !Number.isFinite(line) || line < 1) {
    return { ok: false, status: 400, error: 'bad file or line' };
  }
  // Reject obvious traversal / absolute escapes before touching the FS.
  if (file.includes('\0')) {
    return { ok: false, status: 400, error: 'invalid path' };
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(repoRoot));
  } catch {
    return { ok: false, status: 500, error: 'repo root unavailable' };
  }

  const candidate = resolve(realRoot, file);
  // Fast containment check on the pre-realpath path (catches `..` escapes).
  if (!isInside(realRoot, candidate)) {
    return { ok: false, status: 403, error: 'outside repo' };
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(candidate);
  } catch {
    return { ok: false, status: 404, error: 'not found' };
  }
  // Post-realpath containment check (catches symlink escapes).
  if (!isInside(realRoot, realTarget)) {
    return { ok: false, status: 403, error: 'symlink escapes repo' };
  }

  let st;
  try {
    st = statSync(realTarget);
  } catch {
    return { ok: false, status: 404, error: 'not found' };
  }
  if (!st.isFile()) {
    return { ok: false, status: 403, error: 'not a file' };
  }

  let content: string;
  try {
    content = readFileSync(realTarget, 'utf8');
  } catch {
    return { ok: false, status: 404, error: 'unreadable' };
  }

  const all = content.split(/\r?\n/);
  const center = Math.min(Math.max(1, Math.floor(line)), all.length);
  const start = Math.max(1, center - contextLines);
  const end = Math.min(all.length, center + contextLines);
  const lines = all.slice(start - 1, end);

  return {
    ok: true,
    status: 200,
    lines,
    startLine: start,
    endLine: end,
    centerLine: center,
  };
}

/** True if `target` is `root` itself or strictly within it. */
function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const withSep = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(withSep);
}
