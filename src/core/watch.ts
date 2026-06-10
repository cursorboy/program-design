/**
 * File watcher — full re-extract per trigger at MVP.
 *
 * - chokidar over repoRoot, ignoring DEFAULT_IGNORE_GLOBS directories.
 * - debounce (default 400ms).
 * - coalesce-to-latest: a change arriving DURING an extraction queues exactly one
 *   re-run (bounded queue of size 1), never falling behind silently.
 *
 * invalidatedScope (invalidate.ts) exists for the checker / regression layer and
 * future incremental optimization; the watcher itself does a full re-extract.
 */
import chokidar from 'chokidar';
import type { FactsGraph } from './schema.js';
import { extractGraph, DEFAULT_IGNORE_GLOBS } from './extract/index.js';

export interface WatcherHandle {
  close(): Promise<void>;
}

export function createWatcher(
  repoRoot: string,
  onGraph: (g: FactsGraph) => void,
  opts?: {
    debounceMs?: number;
    ignoreGlobs?: string[];
    onError?: (e: Error) => void;
  },
): WatcherHandle {
  const debounceMs = opts?.debounceMs ?? 400;
  const ignoreGlobs = opts?.ignoreGlobs ?? DEFAULT_IGNORE_GLOBS;
  const onError = opts?.onError ?? (() => {});

  // Ignore matcher: any path whose segments include an ignored directory name.
  const ignoreSet = new Set(ignoreGlobs);
  const ignored = (p: string): boolean => {
    const parts = p.split(/[\\/]/);
    return parts.some((seg) => ignoreSet.has(seg));
  };

  let closed = false;
  let extracting = false;
  let pending = false; // coalesce-to-latest: at most one queued re-run
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const runExtraction = async (): Promise<void> => {
    if (closed) return;
    extracting = true;
    try {
      const graph = await extractGraph(repoRoot, {
        ignoreGlobs,
        buildActive: true,
      });
      if (!closed) onGraph(graph);
    } catch (e) {
      onError(e as Error);
    } finally {
      extracting = false;
      // A change arrived during extraction → run exactly once more.
      if (pending && !closed) {
        pending = false;
        void runExtraction();
      }
    }
  };

  const trigger = (): void => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (extracting) {
        // Coalesce: queue exactly one re-run after the current one finishes.
        pending = true;
      } else {
        void runExtraction();
      }
    }, debounceMs);
  };

  const watcher = chokidar.watch(repoRoot, {
    ignored: (p: string) => ignored(p),
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on('add', trigger);
  watcher.on('change', trigger);
  watcher.on('unlink', trigger);
  watcher.on('addDir', trigger);
  watcher.on('unlinkDir', trigger);
  watcher.on('error', (e: unknown) => onError(e as Error));

  return {
    async close(): Promise<void> {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      await watcher.close();
    },
  };
}
