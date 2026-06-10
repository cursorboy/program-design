/**
 * entry.ts — "am I the process entry point?" for an ESM CLI.
 *
 * The naive check `fileURLToPath(import.meta.url) === resolve(process.argv[1])`
 * breaks the moment a symlink is involved, and npm guarantees one: the
 * installed bin is a `node_modules/.bin/program-design` SYMLINK to
 * dist/cli/index.js. Node realpaths the module graph (preserve-symlinks is off
 * by default), so import.meta.url holds the REAL path while argv[1] holds the
 * symlink — the strings never match, isEntry stays false, and the CLI exits 0
 * having done nothing. (macOS /tmp being a symlink to /private/tmp trips the
 * same wire.) Realpath BOTH sides before comparing.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMainEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    const self = realpathSync(fileURLToPath(moduleUrl));
    const invoked = realpathSync(resolve(argv1));
    return self === invoked;
  } catch {
    return false;
  }
}
