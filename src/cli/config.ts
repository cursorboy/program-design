/**
 * Config file loading (PLAN.md DX spec — the documented escape hatch).
 *
 * `program-design.config.json` at the repo root. Every field is optional and
 * falls back to a default. CLI flags always override config; config overrides
 * defaults. Unknown keys are ignored (forward-compat). Invalid values throw a
 * manifest-style error so a typo never silently degrades behavior.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DaemonConfig {
  /** Whether the skill may auto-start the daemon at session start. Default true. */
  autostart: boolean;
}

export interface PDConfig {
  port: number;
  debounce: number;
  ignoreGlobs: string[];
  /** Extra user-supplied auth-guard wrapper names (widens guard recognition). */
  authGuards: string[];
  daemon: DaemonConfig;
  /** CSS custom-property overrides for the web view, e.g. { "--accent": "#0af" }. */
  theme: Record<string, string>;
}

export const DEFAULT_CONFIG: PDConfig = {
  port: 4040,
  debounce: 400,
  ignoreGlobs: [],
  authGuards: [],
  daemon: { autostart: true },
  theme: {},
};

export const CONFIG_FILENAME = 'program-design.config.json';

class ConfigError extends Error {}

function asNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ConfigError(`${field} must be a number`);
  }
  return v;
}

function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new ConfigError(`${field} must be an array of strings`);
  }
  return v as string[];
}

/**
 * Parse + validate raw config JSON into a partial config (only present keys).
 * Exported for testing without filesystem I/O.
 */
export function parseConfig(raw: unknown): Partial<PDConfig> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config root must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<PDConfig> = {};

  if ('port' in obj) out.port = asNumber(obj.port, 'port');
  if ('debounce' in obj) out.debounce = asNumber(obj.debounce, 'debounce');
  if ('ignoreGlobs' in obj)
    out.ignoreGlobs = asStringArray(obj.ignoreGlobs, 'ignoreGlobs');
  if ('authGuards' in obj)
    out.authGuards = asStringArray(obj.authGuards, 'authGuards');

  if ('daemon' in obj) {
    const d = obj.daemon;
    if (d === null || typeof d !== 'object' || Array.isArray(d)) {
      throw new ConfigError('daemon must be an object');
    }
    const dd = d as Record<string, unknown>;
    const daemon: DaemonConfig = { ...DEFAULT_CONFIG.daemon };
    if ('autostart' in dd) {
      if (typeof dd.autostart !== 'boolean') {
        throw new ConfigError('daemon.autostart must be a boolean');
      }
      daemon.autostart = dd.autostart;
    }
    out.daemon = daemon;
  }

  if ('theme' in obj) {
    const t = obj.theme;
    if (t === null || typeof t !== 'object' || Array.isArray(t)) {
      throw new ConfigError('theme must be an object of CSS custom properties');
    }
    const theme: Record<string, string> = {};
    for (const [k, val] of Object.entries(t as Record<string, unknown>)) {
      if (typeof val !== 'string') {
        throw new ConfigError(`theme.${k} must be a string`);
      }
      theme[k] = val;
    }
    out.theme = theme;
  }

  return out;
}

/** Merge a partial config over the defaults to produce a complete config. */
export function mergeConfig(partial: Partial<PDConfig>): PDConfig {
  return {
    port: partial.port ?? DEFAULT_CONFIG.port,
    debounce: partial.debounce ?? DEFAULT_CONFIG.debounce,
    ignoreGlobs: partial.ignoreGlobs ?? DEFAULT_CONFIG.ignoreGlobs,
    authGuards: partial.authGuards ?? DEFAULT_CONFIG.authGuards,
    daemon: partial.daemon ?? DEFAULT_CONFIG.daemon,
    theme: partial.theme ?? DEFAULT_CONFIG.theme,
  };
}

export interface ConfigLoadResult {
  config: PDConfig;
  /** Absolute path the config was loaded from, or null if defaults only. */
  source: string | null;
  /** Validation error message if the file existed but was invalid. */
  error?: string;
}

/**
 * Load config from `<repoRoot>/program-design.config.json`. Missing file →
 * defaults. Invalid file → defaults + an error message the caller surfaces
 * (we never crash the whole CLI over a config typo at load time; commands that
 * actually need the bad value can decide to fail).
 */
export function loadConfig(repoRoot: string): ConfigLoadResult {
  const path = join(repoRoot, CONFIG_FILENAME);
  if (!existsSync(path)) {
    return { config: mergeConfig({}), source: null };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const partial = parseConfig(raw);
    return { config: mergeConfig(partial), source: path };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { config: mergeConfig({}), source: path, error: msg };
  }
}

/**
 * Resolve effective values: CLI flags (when defined) win over config, which
 * wins over defaults. Pass only the flags that were actually supplied on the
 * command line (undefined === not supplied).
 */
export function resolveEffective(
  config: PDConfig,
  flags: {
    port?: number;
    debounce?: number;
    ignore?: string[];
  },
): { port: number; debounce: number; ignoreGlobs: string[] } {
  return {
    port: flags.port ?? config.port,
    debounce: flags.debounce ?? config.debounce,
    ignoreGlobs:
      flags.ignore && flags.ignore.length > 0
        ? flags.ignore
        : config.ignoreGlobs,
  };
}
