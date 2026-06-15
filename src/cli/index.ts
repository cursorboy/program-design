#!/usr/bin/env node
/**
 * program-design CLI — the verb-first command matrix (PLAN.md DX spec).
 *
 *   live      extract + serve + watch (the quickstart entry point)
 *   demo      live on the bundled sample app
 *   check     run a claim manifest against the graph → verdicts + report
 *   report    render the last verdicts (markdown / json)
 *   export    diagram export (mermaid)
 *   patterns  show the recognized-pattern allowlist
 *   status / stop / restart   daemon lifecycle
 *   doctor    env / daemon / orphan checks, prints fix commands
 *
 * Exit codes (check):  0 = no ABSENT, 1 = at least one ABSENT, 2 = tool error.
 * Every other command:  0 = ok, 2 = tool error (PDError).
 *
 * Core/server/narrate/watch modules are imported by contract; they may not
 * exist on disk while the CLI is built in parallel — integration reconciles.
 */
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureStateDir,
  statePath,
  type DaemonInfo,
} from '../core/state.js';
import { SCHEMA_VERSION, type FactsGraph } from '../core/schema.js';

import { extractGraph, DEFAULT_IGNORE_GLOBS } from '../core/extract/index.js';
import { createWatcher } from '../core/watch.js';
import {
  checkClaims,
  validateManifest,
  appendLedger,
  recheckLedger,
  getAllowlist,
  summarize,
} from '../core/check/index.js';
import {
  renderVerdictTable,
  lintReport,
} from '../core/narrate/index.js';
import {
  startDaemon,
  stopDaemon,
  daemonStatus,
  graphToMermaid,
  notifyRefresh,
} from '../server/index.js';
import { deriveSystemMap, deriveTour } from '../server/system-map-derive.js';
import { prepareAuthoredMap } from './organize.js';
import { isMainEntry } from './entry.js';

import {
  PDError,
  fail,
  formatError,
  ERROR_CATALOG,
  type ErrorCode,
} from './errors.js';
import { loadConfig, resolveEffective, type PDConfig } from './config.js';
import {
  readManifestFile,
  readGraph,
  writeGraph,
  isGraphStale,
  readVerdicts,
  writeVerdicts,
} from './claims-io.js';
import { nodeMajor, pidAlive, looksLikeNextRepo, looksLikeJsRepo } from './doctor-utils.js';

const STALE_GRAPH_MS = 60_000;
const CLI_VERSION = '0.2.0';
/** Session id used for live-mode regression rechecks (one daemon per repo). */
const LIVE_SESSION_ID = 'live';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface GlobalOpts {
  repo: string;
}

/** Resolve --repo (default cwd) to an absolute path. */
function resolveRepo(opts: { repo?: string }): string {
  const r = opts.repo ?? process.cwd();
  return isAbsolute(r) ? r : resolve(process.cwd(), r);
}

/** Print a config-load warning if the file existed but was invalid. */
function loadConfigOrWarn(repoRoot: string): PDConfig {
  const res = loadConfig(repoRoot);
  if (res.error) {
    process.stderr.write(
      `warning: ${res.source} is invalid (${res.error}); using defaults.\n`,
    );
  }
  return res.config;
}

/** One-time daemon consent notice (PLAN.md DX spec — progressive consent). */
function maybeFirstRunNotice(repoRoot: string): void {
  const marker = statePath(repoRoot, 'firstRun');
  if (existsSync(marker)) return;
  process.stdout.write(
    [
      '',
      'Note: program-design starts a local server on 127.0.0.1 to serve the',
      'structure diagram and verification report. It binds to localhost only,',
      'phones home to no one, and keeps all state outside your repo in',
      '~/.program-design/. Disable auto-start with daemon.autostart=false in',
      'program-design.config.json.',
      '',
    ].join('\n') + '\n',
  );
  writeFileSync(marker, new Date().toISOString());
}

/** Open a URL in the default browser (best-effort, non-fatal). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* best-effort; URL is already printed */
  }
}

/** Run a graph extraction with effective ignore globs + buildActive flag. */
async function extract(
  repoRoot: string,
  ignoreGlobs: string[],
  buildActive: boolean,
): Promise<FactsGraph> {
  const globs =
    ignoreGlobs.length > 0
      ? [...DEFAULT_IGNORE_GLOBS, ...ignoreGlobs]
      : DEFAULT_IGNORE_GLOBS;
  return extractGraph(repoRoot, { ignoreGlobs: globs, buildActive });
}

/**
 * Write the derived display projections (system map + guided tour) after an
 * extraction. Deterministic fallbacks only: an existing map/tour that was
 * authored (generatedBy 'llm' or absent) is never overwritten — only files we
 * generated ourselves are refreshed. Best-effort: never blocks extraction.
 */
function writeProjections(repoRoot: string, graph: FactsGraph): void {
  try {
    const readState = <T extends { generatedBy?: string }>(p: string): T | null => {
      if (!existsSync(p)) return null;
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as T;
      } catch {
        return null; // corrupt state is disposable by design
      }
    };
    const mapPath = statePath(repoRoot, 'systemMap');
    const existingMap = readState(mapPath);
    if (existingMap && existingMap.generatedBy !== 'deterministic') return;
    const map = deriveSystemMap(graph);
    if (!map) return;
    writeFileSync(mapPath, JSON.stringify(map, null, 2));
    const tourPath = statePath(repoRoot, 'tour');
    const existingTour = readState(tourPath);
    if (!existingTour || existingTour.generatedBy === 'deterministic') {
      writeFileSync(tourPath, JSON.stringify(deriveTour(map), null, 2));
    }
  } catch {
    /* projections are display-layer; extraction must never fail on them */
  }
}

// ---------------------------------------------------------------------------
// live / demo
// ---------------------------------------------------------------------------

interface LiveFlags {
  port?: number;
  open: boolean;
  debounce?: number;
  ignore?: string[];
}

async function runLive(repoRoot: string, flags: LiveFlags): Promise<void> {
  // The universal map runs on any JS/TS project; deep verification (routes,
  // schema, claims) is Next.js + Prisma and degrades honestly elsewhere.
  if (!looksLikeJsRepo(repoRoot)) {
    fail('not-a-code-repo');
  }

  ensureStateDir(repoRoot);
  maybeFirstRunNotice(repoRoot);

  const config = loadConfigOrWarn(repoRoot);
  const eff = resolveEffective(config, {
    port: flags.port,
    debounce: flags.debounce,
    ignore: flags.ignore,
  });

  process.stdout.write('Extracting structure...\n');
  let graph = await extract(repoRoot, eff.ignoreGlobs, true);
  writeGraph(repoRoot, graph);
  writeProjections(repoRoot, graph);

  const daemon = await startDaemon(repoRoot, {
    port: eff.port,
    version: CLI_VERSION,
  });
  const url = `http://127.0.0.1:${daemon.port}/?t=${daemon.token}`;
  process.stdout.write(`\nLive at ${url}\n`);
  process.stdout.write(`  ${graph.nodes.length} nodes, ${graph.edges.length} edges.\n`);

  if (flags.open) openBrowser(url);

  const watcher = createWatcher(
    repoRoot,
    (next: FactsGraph) => {
      graph = next;
      writeGraph(repoRoot, graph);
      writeProjections(repoRoot, graph);
      void notifyRefresh(repoRoot, 'graph');
      // Regression re-verification over the ledger on each graph change.
      try {
        const alerts = recheckLedger(graph, repoRoot, LIVE_SESSION_ID);
        const regressions = alerts.filter((e) => e.type === 'regression-alert');
        if (regressions.length > 0) {
          appendLedger(repoRoot, regressions);
          void notifyRefresh(repoRoot, 'verdicts');
        }
      } catch {
        /* recheck is best-effort; never crash the watcher */
      }
    },
    { debounceMs: eff.debounce, ignoreGlobs: eff.ignoreGlobs },
  );

  process.stdout.write('\nWatching for changes. Press Ctrl+C to stop.\n');

  const shutdown = async () => {
    await watcher.close();
    await stopDaemon(repoRoot);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Resolve the bundled sample app relative to the installed package. */
function demoRepoRoot(): string {
  return fileURLToPath(new URL('../../fixtures/sample-app', import.meta.url));
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

interface CheckFlags {
  manifest?: string;
  json?: boolean;
}

async function runCheck(repoRoot: string, flags: CheckFlags): Promise<number> {
  if (!flags.manifest) {
    fail('manifest-invalid', '--manifest <path> is required at MVP.');
  }
  const manifestPath = isAbsolute(flags.manifest)
    ? flags.manifest
    : resolve(process.cwd(), flags.manifest);

  ensureStateDir(repoRoot);
  const config = loadConfigOrWarn(repoRoot);

  // Load the graph; rebuild if missing or stale (>60s) or schema mismatch.
  let graph = readGraph(repoRoot);
  if (!graph || isGraphStale(repoRoot, STALE_GRAPH_MS)) {
    if (!looksLikeJsRepo(repoRoot)) fail('not-a-code-repo');
    graph = await extract(repoRoot, config.ignoreGlobs, false);
    writeGraph(repoRoot, graph);
    writeProjections(repoRoot, graph);
  }

  // Normalize (bare Claim[] or ClaimManifest) then run the core validator.
  const normalized = readManifestFile(manifestPath);
  const validated = validateManifest(normalized);
  if (!validated.ok) {
    fail('manifest-invalid', validated.errors.join('; '));
  }
  const manifest = validated.manifest;

  const verdicts = checkClaims(graph, manifest);
  writeVerdicts(repoRoot, verdicts);

  // Ledger + live view.
  const entries = verdicts.map((v) => ({
    type: 'claim-checked' as const,
    sessionId: manifest.sessionId,
    timestamp: new Date().toISOString(),
    verdict: v,
  }));
  appendLedger(repoRoot, entries);
  await notifyRefresh(repoRoot, 'verdicts').catch(() => {});

  const summary = summarize(verdicts, manifest.unverifiable.length);

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ summary, verdicts }, null, 2) + '\n',
    );
  } else {
    process.stdout.write(renderVerdictTable(verdicts, summary) + '\n');
  }

  // Exit code: 1 if any ABSENT, else 0.
  return summary.absent > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// organize — install (or reset) an LLM-authored system map
// ---------------------------------------------------------------------------

interface OrganizeFlags {
  from?: string;
  tour?: string;
  reset?: boolean;
  json?: boolean;
}

async function runOrganize(repoRoot: string, flags: OrganizeFlags): Promise<void> {
  ensureStateDir(repoRoot);
  const mapPath = statePath(repoRoot, 'systemMap');
  const tourPath = statePath(repoRoot, 'tour');

  if (flags.reset) {
    // Drop the authored artifacts; the deterministic deriver takes over again.
    for (const p of [mapPath, tourPath]) {
      try { unlinkSync(p); } catch { /* already absent */ }
    }
    const graph = readGraph(repoRoot);
    if (graph) writeProjections(repoRoot, graph);
    await notifyRefresh(repoRoot, 'graph').catch(() => {});
    process.stdout.write('Authored map removed; the deterministic map is back in charge.\n');
    return;
  }

  if (!flags.from) {
    fail('map-invalid', '--from <map.json> is required (or use --reset).');
  }

  // The fact-anchor gate needs the facts graph; rebuild if missing or stale.
  const config = loadConfigOrWarn(repoRoot);
  let graph = readGraph(repoRoot);
  if (!graph || isGraphStale(repoRoot, STALE_GRAPH_MS)) {
    if (!looksLikeJsRepo(repoRoot)) fail('not-a-code-repo');
    graph = await extract(repoRoot, config.ignoreGlobs, false);
    writeGraph(repoRoot, graph);
  }

  const readJsonArg = (p: string, what: string): unknown => {
    const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (e) {
      fail('map-invalid', `cannot read ${what} file ${abs}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      fail('map-invalid', `${what} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const rawMap = readJsonArg(flags.from, 'map');
  const rawTour = flags.tour ? readJsonArg(flags.tour, 'tour') : undefined;

  const result = prepareAuthoredMap(graph, rawMap, rawTour);
  if (!result.ok || !result.map) {
    fail('map-invalid', result.errors.join('; '));
  }

  writeFileSync(mapPath, JSON.stringify(result.map, null, 2));
  if (result.tour) writeFileSync(tourPath, JSON.stringify(result.tour, null, 2));
  await notifyRefresh(repoRoot, 'graph').catch(() => {});

  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          installed: true,
          nodes: result.nodesKept,
          nodesDropped: result.nodesDropped,
          edges: result.edgesKept,
          edgesDropped: result.edgesDropped,
          tourBeats: result.tour ? result.tour.beats.length : 0,
          revealsDropped: result.revealsDropped,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  process.stdout.write(
    `Installed the authored system map: ${result.nodesKept} nodes, ${result.edgesKept} edges` +
      (result.tour ? `, tour with ${result.tour.beats.length} beats` : '') +
      '.\n',
  );
  if (result.nodesDropped > 0 || result.edgesDropped > 0 || result.revealsDropped > 0) {
    process.stdout.write(
      `Fact-anchor gate dropped ${result.nodesDropped} node(s), ${result.edgesDropped} edge(s), ` +
        `${result.revealsDropped} tour reveal(s) with no receipt resolving to a real file.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

interface ReportFlags {
  json?: boolean;
  md?: string;
}

function renderReportMarkdown(verdicts: ReturnType<typeof readVerdicts>): string {
  const list = verdicts ?? [];
  const absent = list.filter((v) => v.verdict === 'absent');
  const undet = list.filter((v) => v.verdict === 'undetermined');
  const confirmed = list.filter((v) => v.verdict === 'confirmed');

  const lines: string[] = [];
  lines.push('# Verification report');
  lines.push('');
  lines.push(
    `${confirmed.length} confirmed · ${absent.length} absent · ${undet.length} undetermined`,
  );
  lines.push('');
  lines.push('> verifies presence, not correctness');
  lines.push('');

  const section = (
    title: string,
    items: typeof list,
  ): void => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const v of items) {
      lines.push(`- **${v.claim.rawText || v.claim.subject}**`);
      for (const r of v.receipts) {
        lines.push(`  - receipt: \`${r.file}:${r.line}\` (${r.ruleId})`);
      }
      if (v.explainer) {
        lines.push(`  - ${v.explainer.reason}`);
        if (v.explainer.pattern) {
          lines.push(`    - pattern: \`${v.explainer.pattern}\``);
        }
      }
      if (v.searchScope && v.searchScope.length > 0) {
        lines.push(`  - searched: ${v.searchScope.join(', ')}`);
      }
    }
    lines.push('');
  };

  section('Diverged (absent)', absent);
  section('Undetermined', undet);
  section('Confirmed', confirmed);

  lines.push('---');
  lines.push('');
  lines.push(
    `Checked ${list.length} claim${list.length === 1 ? '' : 's'} the agent made; this is not a completeness audit.`,
  );
  return lines.join('\n') + '\n';
}

function runReport(repoRoot: string, flags: ReportFlags): void {
  const verdicts = readVerdicts(repoRoot);
  if (verdicts === null) {
    process.stdout.write(
      'No checkable claims this session — run `program-design check --manifest <file>` first.\n',
    );
    return;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(verdicts, null, 2) + '\n');
    return;
  }

  const md = renderReportMarkdown(verdicts);
  // Optionally lint through the narrator (no-op for plain markdown render).
  void lintReport;
  if (flags.md) {
    const out = isAbsolute(flags.md) ? flags.md : resolve(process.cwd(), flags.md);
    writeFileSync(out, md);
    process.stdout.write(`Report written to ${out}\n`);
  } else {
    process.stdout.write(md);
  }
}

// ---------------------------------------------------------------------------
// export mermaid
// ---------------------------------------------------------------------------

async function runExportMermaid(
  repoRoot: string,
  flags: { out?: string },
): Promise<void> {
  let graph = readGraph(repoRoot);
  if (!graph) {
    if (!looksLikeJsRepo(repoRoot)) fail('not-a-code-repo');
    const config = loadConfigOrWarn(repoRoot);
    ensureStateDir(repoRoot);
    graph = await extract(repoRoot, config.ignoreGlobs, false);
    writeGraph(repoRoot, graph);
  }
  const mermaid = graphToMermaid(graph);
  if (flags.out) {
    const out = isAbsolute(flags.out) ? flags.out : resolve(process.cwd(), flags.out);
    writeFileSync(out, mermaid);
    process.stdout.write(`Mermaid diagram written to ${out}\n`);
  } else {
    process.stdout.write(mermaid + '\n');
  }
}

// ---------------------------------------------------------------------------
// patterns
// ---------------------------------------------------------------------------

function runPatterns(flags: { category?: string; json?: boolean }): void {
  let entries = getAllowlist();
  if (flags.category) {
    entries = entries.filter((e) => e.category === flags.category);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }
  if (entries.length === 0) {
    process.stdout.write('No patterns match that category.\n');
    return;
  }
  process.stdout.write('Recognized-pattern allowlist\n');
  process.stdout.write(
    'CONFIRMED/ABSENT are only emitted for these patterns; everything else is UNDETERMINED.\n\n',
  );
  for (const e of entries) {
    process.stdout.write(`  ${e.category} · ${e.predicate}\n`);
    process.stdout.write(`    ${e.description}\n`);
    process.stdout.write(`    rules: ${e.ruleIds.join(', ')}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// status / stop / restart
// ---------------------------------------------------------------------------

function runStatus(repoRoot: string, json?: boolean): void {
  const info = daemonStatus(repoRoot);
  if (json) {
    process.stdout.write(
      JSON.stringify({ running: info !== null, info }, null, 2) + '\n',
    );
    return;
  }
  if (!info) {
    process.stdout.write(
      'No daemon running for this repo. Start one with `program-design live`.\n',
    );
    return;
  }
  process.stdout.write(
    `Daemon running: http://127.0.0.1:${info.port} (pid ${info.pid}, v${info.version}).\n`,
  );
}

async function runStop(repoRoot: string): Promise<void> {
  const stopped = await stopDaemon(repoRoot);
  process.stdout.write(
    stopped ? 'Daemon stopped.\n' : 'No daemon was running.\n',
  );
}

async function runRestart(repoRoot: string, port?: number): Promise<void> {
  await stopDaemon(repoRoot);
  const config = loadConfigOrWarn(repoRoot);
  const daemon = await startDaemon(repoRoot, {
    port: port ?? config.port,
    version: CLI_VERSION,
  });
  process.stdout.write(
    `Daemon restarted: http://127.0.0.1:${daemon.port}/?t=${daemon.token}\n`,
  );
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function runDoctor(repoRoot: string, json?: boolean): Promise<number> {
  const checks: DoctorCheck[] = [];

  // 1. Node version.
  const major = nodeMajor(process.version);
  checks.push({
    name: 'node-version',
    ok: major >= 20,
    detail: `Node ${process.version} (need >=20)`,
    fix: major >= 20 ? undefined : ERROR_CATALOG['node-version'].fix,
  });

  // 2. Looks like a Next.js repo.
  const isNext = looksLikeNextRepo(repoRoot);
  checks.push({
    name: 'nextjs-repo',
    ok: isNext,
    detail: isNext
      ? 'Next.js app detected (app/ or pages/ or next dep).'
      : 'No app/ or pages/ dir and no next dependency.',
    fix: isNext ? undefined : ERROR_CATALOG['not-a-nextjs-repo'].fix,
  });

  // 3. State dir writable.
  let stateOk = true;
  let stateDetail = '';
  try {
    const dir = ensureStateDir(repoRoot);
    const probe = join(dir, '.doctor-probe');
    writeFileSync(probe, 'ok');
    stateDetail = `State dir writable: ${dir}`;
  } catch (e) {
    stateOk = false;
    stateDetail = `State dir not writable: ${e instanceof Error ? e.message : String(e)}`;
  }
  checks.push({
    name: 'state-dir',
    ok: stateOk,
    detail: stateDetail,
    fix: stateOk ? undefined : 'Check permissions on ~/.program-design/.',
  });

  // 4. Daemon status + orphan detection.
  const portFile = statePath(repoRoot, 'port');
  let daemonDetail = 'No daemon running.';
  let daemonOk = true;
  if (existsSync(portFile)) {
    try {
      const info = JSON.parse(readFileSync(portFile, 'utf8')) as DaemonInfo;
      const alive = pidAlive(info.pid);
      if (alive) {
        daemonDetail = `Daemon alive: pid ${info.pid}, port ${info.port}.`;
      } else {
        // Orphan: dead pid → clean it.
        daemonOk = false;
        daemonDetail = `Orphaned daemon record (pid ${info.pid} is dead) — cleaning port.json.`;
        try {
          writeFileSync(portFile, ''); // truncate; safe to remove the record
        } catch {
          /* ignore */
        }
      }
    } catch {
      daemonOk = false;
      daemonDetail = 'port.json is corrupt — removing.';
      try {
        writeFileSync(portFile, '');
      } catch {
        /* ignore */
      }
    }
  }
  checks.push({
    name: 'daemon',
    ok: daemonOk,
    detail: daemonDetail,
    fix: daemonOk ? undefined : ERROR_CATALOG['stale-daemon'].fix,
  });

  // 5. Graph schemaVersion vs SCHEMA_VERSION.
  const graphFile = statePath(repoRoot, 'graph');
  let graphOk = true;
  let graphDetail = 'No graph cached yet.';
  if (existsSync(graphFile)) {
    try {
      const g = JSON.parse(readFileSync(graphFile, 'utf8')) as { schemaVersion?: number };
      if (g.schemaVersion === SCHEMA_VERSION) {
        graphDetail = `Graph schemaVersion ${g.schemaVersion} matches.`;
      } else {
        graphOk = false;
        graphDetail = `Graph schemaVersion ${g.schemaVersion} != ${SCHEMA_VERSION} — will rebuild on next run.`;
      }
    } catch {
      graphOk = false;
      graphDetail = 'graph.json is corrupt — will rebuild on next run.';
    }
  }
  checks.push({
    name: 'graph-schema',
    ok: graphOk,
    detail: graphDetail,
    fix: graphOk ? undefined : 'Re-run `program-design live` to rebuild the graph.',
  });

  if (json) {
    process.stdout.write(JSON.stringify({ checks }, null, 2) + '\n');
  } else {
    process.stdout.write('program-design doctor\n\n');
    for (const c of checks) {
      process.stdout.write(`  [${c.ok ? 'ok' : '!!'}] ${c.name}: ${c.detail}\n`);
      if (c.fix) process.stdout.write(`       fix: ${c.fix}\n`);
    }
    process.stdout.write('\n');
  }

  return checks.every((c) => c.ok) ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command();
  program
    .name('program-design')
    .description(
      'Live structure visualization + deterministic claim verification for AI-built Next.js apps.',
    )
    .option('--repo <path>', 'repo root to operate on (default: cwd)')
    .version('0.2.0');

  const repoOf = (cmd: Command): string =>
    resolveRepo(cmd.optsWithGlobals() as GlobalOpts);

  program
    .command('live')
    .description('extract structure, start the local server, watch for changes')
    .option('--port <n>', 'port to bind', (v) => Number.parseInt(v, 10))
    .option('--no-open', 'do not open the browser automatically')
    .option('--debounce <ms>', 'watcher debounce in ms', (v) => Number.parseInt(v, 10))
    .option('--ignore <glob...>', 'additional ignore globs')
    .action(async (opts, cmd: Command) => {
      await runLive(repoOf(cmd), {
        port: opts.port,
        open: opts.open,
        debounce: opts.debounce,
        ignore: opts.ignore,
      });
    });

  program
    .command('demo')
    .description('run live on the bundled sample app')
    .option('--port <n>', 'port to bind', (v) => Number.parseInt(v, 10))
    .option('--no-open', 'do not open the browser automatically')
    .option('--debounce <ms>', 'watcher debounce in ms', (v) => Number.parseInt(v, 10))
    .action(async (opts) => {
      await runLive(demoRepoRoot(), {
        port: opts.port,
        open: opts.open,
        debounce: opts.debounce,
      });
    });

  program
    .command('check')
    .description('run a claim manifest against the facts graph')
    .requiredOption('--manifest <path>', 'path to a ClaimManifest JSON or Claim[] file')
    .option('--json', 'emit JSON instead of the verdict table')
    .action(async (opts, cmd: Command) => {
      const code = await runCheck(repoOf(cmd), {
        manifest: opts.manifest,
        json: opts.json,
      });
      process.exitCode = code;
    });

  program
    .command('organize')
    .description('install an LLM-authored system map (fact-anchored; receipts required)')
    .option('--from <path>', 'the authored SystemMap JSON to install')
    .option('--tour <path>', 'an authored Tour JSON to install alongside it')
    .option('--reset', 'remove the authored map and fall back to the deterministic one')
    .option('--json', 'emit a JSON summary')
    .action(async (opts, cmd: Command) => {
      await runOrganize(repoOf(cmd), {
        from: opts.from,
        tour: opts.tour,
        reset: opts.reset,
        json: opts.json,
      });
    });

  program
    .command('report')
    .description('render the last verdicts')
    .option('--json', 'emit raw verdict JSON')
    .option('--md <path>', 'write the markdown report to a file')
    .action((opts, cmd: Command) => {
      runReport(repoOf(cmd), { json: opts.json, md: opts.md });
    });

  const exp = program
    .command('export')
    .description('export diagrams from the facts graph');
  exp
    .command('mermaid')
    .description('export a Mermaid diagram')
    .option('--out <path>', 'write to a file instead of stdout')
    .action(async (opts, cmd: Command) => {
      await runExportMermaid(repoOf(cmd), { out: opts.out });
    });

  program
    .command('patterns')
    .description('show the recognized-pattern allowlist')
    .option('--category <cat>', 'filter by category (route, middleware, schema, env, dep, wiring)')
    .option('--json', 'emit JSON')
    .action((opts) => {
      runPatterns({ category: opts.category, json: opts.json });
    });

  program
    .command('status')
    .description('show daemon status for this repo')
    .option('--json', 'emit JSON')
    .action((opts, cmd: Command) => {
      runStatus(repoOf(cmd), opts.json);
    });

  program
    .command('stop')
    .description('stop the daemon for this repo')
    .action(async (_opts, cmd: Command) => {
      await runStop(repoOf(cmd));
    });

  program
    .command('restart')
    .description('restart the daemon for this repo')
    .option('--port <n>', 'port to bind', (v) => Number.parseInt(v, 10))
    .action(async (opts, cmd: Command) => {
      await runRestart(repoOf(cmd), opts.port);
    });

  program
    .command('doctor')
    .description('run environment + daemon health checks')
    .option('--json', 'emit JSON')
    .action(async (opts, cmd: Command) => {
      const code = await runDoctor(repoOf(cmd), opts.json);
      process.exitCode = code;
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    if (e instanceof PDError) {
      process.stderr.write(formatError(e) + '\n');
      process.exit(2);
    }
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    process.stderr.write(`program-design: unexpected error\n${msg}\n`);
    process.exit(2);
  }
}

// Only run when invoked as the entry point (keeps the module importable in
// tests). Symlink-safe: npx invokes the node_modules/.bin SYMLINK, so both
// sides must be realpathed before comparing (see entry.ts).
if (isMainEntry(process.argv[1], import.meta.url)) {
  void main();
}

export {
  buildProgram,
  resolveRepo,
  demoRepoRoot,
  renderReportMarkdown,
  type ErrorCode,
};
