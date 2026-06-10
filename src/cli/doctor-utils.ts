/**
 * Pure, dependency-light helpers used by `doctor` and a few other commands.
 *
 * Kept out of index.ts so they can be unit-tested without importing the core
 * extract/check/narrate/server modules (which spin up real work) or a daemon.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Major version number from a Node version string ("v20.1.0" → 20). */
export function nodeMajor(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

/** True if a process with the given pid is alive (signal 0 probe). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH → no such process; EPERM → exists but not ours (still alive).
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Heuristic Next.js detection: an app/ or pages/ directory at the repo root, or
 * a "next" dependency in package.json. Deliberately lenient — a false negative
 * here only blocks `live`/`check` with a clear, fixable error.
 */
export function looksLikeNextRepo(repoRoot: string): boolean {
  if (existsSync(join(repoRoot, 'app')) || existsSync(join(repoRoot, 'pages'))) {
    return true;
  }
  const pkgPath = join(repoRoot, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
  } catch {
    return false;
  }
}
