/**
 * Shared helpers for the deterministic extractor.
 *
 * No LLM, ever. Everything here is pure path/AST machinery. The extractor must
 * work WITHOUT node_modules in the target repo, so we never require its tsconfig
 * and we disable ts-morph's filesystem dependency resolution.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep, posix } from 'node:path';
import {
  Project,
  type SourceFile,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from 'ts-morph';
import type { ParseFailure } from '../schema.js';

/** Default ignore globs (also the public DEFAULT_IGNORE_GLOBS in index.ts). */
export const DEFAULT_IGNORE_DIRS = [
  'node_modules',
  '.next',
  'dist',
  '.git',
  'generated',
];

/** Convert any path to a repo-relative POSIX path. */
export function toRel(repoRoot: string, absPath: string): string {
  const rel = relative(repoRoot, absPath);
  return rel.split(sep).join(posix.sep);
}

/** Build a ts-morph project that never touches node_modules or a tsconfig. */
export function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      noResolve: true,
      noLib: true,
      jsx: 4 /* react-jsx; numeric to avoid importing the enum */,
    },
  });
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function isSourceFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return SOURCE_EXTS.has(path.slice(dot).toLowerCase());
}

export interface WalkResult {
  /** Absolute paths of source files. */
  sourceFiles: string[];
  /** Absolute paths of every non-ignored file (for files.ts). */
  allFiles: string[];
}

/** Recursively list files under repoRoot, skipping ignored directories. */
export async function walkRepo(
  repoRoot: string,
  ignoreDirs: string[],
): Promise<WalkResult> {
  const ignore = new Set(ignoreDirs);
  const sourceFiles: string[] = [];
  const allFiles: string[] = [];

  async function recurse(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort for deterministic ordering.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        await recurse(full);
      } else if (entry.isFile()) {
        allFiles.push(full);
        if (isSourceFile(entry.name)) sourceFiles.push(full);
      }
    }
  }

  await recurse(repoRoot);
  sourceFiles.sort();
  allFiles.sort();
  return { sourceFiles, allFiles };
}

/**
 * Add source files to a ts-morph project one-by-one, capturing parse failures.
 * A file that fails → ParseFailure pushed, file NOT added (no partial facts).
 */
export function loadSourceFiles(
  project: Project,
  repoRoot: string,
  absPaths: string[],
  parseFailures: ParseFailure[],
): SourceFile[] {
  const loaded: SourceFile[] = [];
  for (const abs of absPaths) {
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (e) {
      parseFailures.push({
        file: toRel(repoRoot, abs),
        reason: `read error: ${(e as Error).message}`,
      });
      continue;
    }
    let sf: SourceFile;
    try {
      sf = project.createSourceFile(abs, text, { overwrite: true });
    } catch (e) {
      parseFailures.push({
        file: toRel(repoRoot, abs),
        reason: `parse error: ${(e as Error).message}`,
      });
      continue;
    }
    // ts-morph is permissive; detect hard syntax errors explicitly so a broken
    // file never leaks partial facts.
    try {
      const diagnostics = sf.getPreEmitDiagnostics();
      const syntaxErrors = diagnostics.filter((d) => {
        const code = d.getCode();
        // 1xxx codes are syntactic (parser) errors; semantic (type) errors are
        // 2xxx+ and are expected without node_modules — ignore those.
        return code >= 1000 && code < 2000;
      });
      if (syntaxErrors.length > 0) {
        parseFailures.push({
          file: toRel(repoRoot, abs),
          reason: `syntax error: ${syntaxErrors[0]!.getMessageText().toString()}`,
        });
        project.removeSourceFile(sf);
        continue;
      }
    } catch (e) {
      parseFailures.push({
        file: toRel(repoRoot, abs),
        reason: `diagnostic error: ${(e as Error).message}`,
      });
      try {
        project.removeSourceFile(sf);
      } catch {
        /* ignore */
      }
      continue;
    }
    loaded.push(sf);
  }
  return loaded;
}

/** 1-based line number for a ts-morph node start. */
export function lineOf(sf: SourceFile, pos: number): number {
  return sf.getLineAndColumnAtPos(pos).line;
}

export interface FileMeta {
  absPath: string;
  relPath: string;
  size: number;
}

export function fileMeta(repoRoot: string, absPath: string): FileMeta | null {
  try {
    const s = statSync(absPath);
    return { absPath, relPath: toRel(repoRoot, absPath), size: s.size };
  } catch {
    return null;
  }
}

export { existsSync, readFileSync, join };
