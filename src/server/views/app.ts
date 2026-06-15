/**
 * views/app.ts — the single-page web app served at GET /.
 *
 * Returns ONE self-contained HTML document (inline <style> + <script>, no build
 * step, no external deps except: the Mermaid CDN with a graceful fallback to the
 * tree list, and Google Fonts for IBM Plex with a system fallback).
 *
 * Design: LIGHT, very minimal, animated (PLAN.md "Design Specification" +
 * "Progressive disclosure"). Warm-paper background, ink text, ONE accent (deep
 * teal), verdict colors tuned for ≥4.5:1 on the light bg, hairline borders, no
 * shadows except a single soft elevation for popovers/sheet. All animation gated
 * behind prefers-reduced-motion.
 *
 *  - THE MAP IS THE HOME. On open the user sees one full-width custom flow map
 *    (inline SVG + HTML, NOT Mermaid): three calm columns — "What people see"
 *    (pages + request-sending components), "Doors into your app" (API endpoints),
 *    "Your records" (db tables) — with cubic-bezier connectors from graph facts,
 *    a guard pill on the wires it protects, and an honest ghost node for wires we
 *    cannot trace. Nodes are focusable buttons; clicking opens the learn popover.
 *  - chrome is nearly zero: wordmark · status strip (the only verdict surface on
 *    the map) · a single "···" menu. The menu sheet holds Report · History · Plan
 *    · Technical view · Learn · Export · Shortcuts and the depth toggle.
 *  - permanent badge "verifies presence, not correctness", one accent color.
 *  - REPORT: filter chips + search, animated coverage ring + count-up verdict bar,
 *    ABSENT (expanded, quiet copyable fix) → UNDETERMINED → CONFIRMED → diagram.
 *  - verdict encoding never color-alone (icon + border style + text label).
 *  - LIVE (Technical depth): structure tree + Mermaid diagram, staleness, graph-diff,
 *    plus an activity feed of the last 10 added/removed nodes.
 *  - PLAN: dashed/desaturated planned tree with persistent banner.
 *  - learn popover (single-popover policy) + glossary sheet (renders all entries).
 *  - export menu (copy markdown report, download .mmd), keyboard shortcuts +
 *    shortcuts overlay, first-run coach line under the status strip.
 *  - a11y: focus-visible, 44px targets, aria, reduced-motion, ≥4.5:1; 480px.
 *
 * DEPTH-TOGGLE MAPPING (kept coherent with progressive disclosure):
 *   - "Map"  = the new home — the custom SVG flow map (replaces the old "Plain"
 *              level as the default landing level).
 *   - "Plain" = the old plain-English flow strips (kept, reachable from the menu
 *              depth toggle for users who want sentences instead of a diagram).
 *   - "Technical" = the old technical Live view (structure tree + Mermaid + raw
 *              API links). Mermaid lives ONLY here.
 *   Default depth is "map". Esc always returns to the map.
 *
 * The token is baked into the page so all fetches are authenticated; tokenless
 * navigation never reaches here (the daemon serves a 401 page instead).
 */

import { GLOSSARY } from './glossary.js';
import { getAllowlist } from '../../core/check/allowlist.js';

export function renderAppHtml(opts: { token: string }): string {
  const token = opts.token;
  // The token is hex (validated upstream); still JSON-encode defensively so it
  // cannot break out of the string literal.
  const tokenLiteral = JSON.stringify(token);
  // The glossary is a deterministic constant; bake it in so the learn layer
  // needs no extra fetch and works fully offline.
  const glossaryLiteral = JSON.stringify(GLOSSARY);
  // The allowlist is the deterministic (category,predicate)→ruleIds artifact that
  // gates which claims can ever be CONFIRMED/ABSENT. Baking it in lets the
  // Technical-depth verdict rows show the recognizer provenance with no fetch.
  const allowlistLiteral = JSON.stringify(getAllowlist());

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light" />
<title>program-design</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
${STYLES}
</style>
</head>
<body class="pd-enter">
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
  <div class="brand">
    <span class="brand-name">program-design</span>
    <span id="essence" class="essence">A calm map of what your app actually does.</span>
    <span id="sys-what" class="sys-what" hidden></span>
  </div>
  <div id="status-strip" class="status-strip" role="status" aria-live="polite"></div>
  <div class="header-right">
    <button id="menu-btn" class="iconbtn menu-btn" type="button" aria-haspopup="dialog" aria-expanded="false" title="Menu" aria-label="Open menu">···</button>
  </div>
</header>

<div id="conn-banner" class="conn-banner" role="status" hidden>
  <span class="conn-text">Lost connection to the local server. Reconnecting…</span>
  <button id="conn-retry" class="btn-secondary" type="button">Retry now</button>
</div>

<!-- 401 safety-net: server is up but THIS tab's token is stale (an earlier
     session). With the stable token this should no longer happen; if it does,
     reloading mints the page with the current token. -->
<div id="stale-token-banner" class="conn-banner stale-token-banner" role="alert" hidden>
  <span class="conn-text">This tab is from an earlier session. Reload to reconnect.</span>
  <button id="stale-token-reload" class="btn-secondary" type="button">Reload</button>
</div>

<main id="main" class="main">
  <!-- First-run coach line (one-time, dismissible) — lives under the status strip -->
  <div id="coach" class="coach" role="note" hidden>
    <span class="coach-text">Tap any step to see what it means — tap deeper to see the real code.</span>
    <button id="coach-dismiss" class="coach-x" type="button" aria-label="Dismiss tip">×</button>
  </div>

  <!-- MAP — the home. INFINITE CANVAS, CORRECT architecture: a CSS-transformed
       #world DIV that contains BOTH an SVG wire layer (#wire-svg) and an HTML
       node layer (#node-layer). Because #world is a normal element with a CSS
       transform (NOT an SVG <g> transform attribute), Chromium applies that
       transform to BOTH the child <svg> wires AND the child HTML node divs
       identically — so nodes and wires are LOCKED together and pan/zoom/drag
       all move as one canvas. Built client-side from /api/flows + /api/graph.
       NOT SVG-embedded HTML, NOT an SVG camera group, NOT Mermaid, NOT lanes. -->
  <section id="view-map" class="view view-map" role="region" aria-label="A map of your app" hidden>
    <div id="map-stale" class="stale-banner" role="status" hidden>STALE — the structure may be out of date.</div>
    <div id="canvas-viewport" class="canvas-host" aria-live="polite" tabindex="0" role="application" aria-label="Pan and zoom map of your app. Use arrow keys to pan, plus and minus to zoom, 0 to fit.">
      <!-- #world: the single CSS-transformed layer. transform-origin:0 0;
           style.transform = translate(TXpx,TYpx) scale(K). Everything inside is
           in WORLD pixel coordinates and moves together with one transform. The
           dot-grid is a tiled background on #world so it pans/scales too. -->
      <div id="world" class="world">
        <!-- dot-grid: a tiled background fixed in the world; pans+scales with it. -->
        <div class="grid-bg" aria-hidden="true"></div>
        <!-- WIRE LAYER: an SVG drawn in world px; overflow:visible so nothing
             clips. Wires, flow pulses, guard checkpoints, ghost wire live here. -->
        <svg id="wire-svg" class="wire-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <!-- a small "go to" arrowhead for NAVIGATION connectors (page→page),
                 distinct from the teal data-flow pulse wires. -->
            <marker id="nav-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </marker>
          </defs>
          <g id="band-labels" class="band-labels" aria-hidden="true"></g>
          <g id="wire-layer"></g>
        </svg>
        <!-- NODE LAYER: each node is an absolutely-positioned HTML <button> at
             world left/top. They share #world's transform with the wires. -->
        <div id="node-layer" class="node-layer"></div>
      </div>
      <!-- SYSTEM MAP: screen-pinned layer column captions (float above the
           canvas; never reflow it). Populated by JS only when a system map
           exists, positioned at each layer column's screen x each frame. -->
      <div id="sys-captions" class="sys-captions" aria-hidden="true" hidden></div>
      <!-- a quiet flow caption appears when a node/flow is focused/hovered -->
      <div id="flow-caption" class="flow-caption" role="status" aria-live="polite" hidden></div>
      <!-- the calm empty-state line, shown when there are no nodes -->
      <p id="canvas-empty" class="canvas-empty" hidden>Nothing to show yet. As Claude builds, a picture of your app appears here — the screens people open, and where their information goes.</p>
      <!-- minimal zoom controls (bottom-right) -->
      <div class="canvas-controls" role="group" aria-label="Zoom and fit">
        <button id="zoom-out" class="canvas-ctl" type="button" aria-label="Zoom out" title="Zoom out (−)">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <button id="zoom-in" class="canvas-ctl" type="button" aria-label="Zoom in" title="Zoom in (+)">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 4v8M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <button id="zoom-fit" class="canvas-ctl" type="button" aria-label="Fit everything in view" title="Fit (0)">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5V2.8A.8.8 0 0 1 2.8 2H5M11 2h2.2a.8.8 0 0 1 .8.8V5M14 11v2.2a.8.8 0 0 1-.8.8H11M5 14H2.8a.8.8 0 0 1-.8-.8V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <!-- "What am I looking at?" — the always-available plain-language key.
           One quiet button, bottom-left; opens a small panel explaining boxes,
           lines, locks, and dashes in plain words. Hidden while the tour plays
           (the tour narrates the map itself). Open state persists. -->
      <div id="map-key" class="map-key">
        <button id="map-key-btn" class="map-key-btn" type="button" aria-expanded="false" aria-controls="map-key-panel">What am I looking at?</button>
        <div id="map-key-panel" class="map-key-panel" role="region" aria-label="What the map shows" hidden>
          <p class="map-key-row"><span class="mk-swatch mk-card" aria-hidden="true"></span>Each box is a piece of your app — a screen people open, the server doing the work, your saved records, or an outside service.</p>
          <p class="map-key-row"><span class="mk-swatch mk-wire" aria-hidden="true"></span>A line means information moves between two pieces. The moving dots show the direction.</p>
          <p class="map-key-row"><span class="mk-swatch mk-lock" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor"/></svg></span>A lock is a security check that runs before a request is let through.</p>
          <p class="map-key-row"><span class="mk-swatch mk-dashed" aria-hidden="true"></span>Dashed or faded means the code mentions it, but I can’t trace it for sure — so I won’t pretend.</p>
          <p class="map-key-tip">Tap any box to see what it is in plain words — and the real line of code behind it.</p>
        </div>
      </div>
      <!-- a tiny breathing "building…" indicator near the status strip area -->
      <div id="build-indicator" class="build-indicator" role="status" hidden>
        <span class="bi-dot" aria-hidden="true"></span><span class="bi-text">building…</span>
      </div>
      <!-- quiet floating presence-not-correctness badge, bottom-center on the map -->
      <footer class="map-foot" aria-hidden="true">
        <span class="badge" title="This tool checks that claimed things exist in the code. It does not check that they work.">verifies presence, not correctness</span>
      </footer>

      <!-- THE GUIDED TOUR PLAYER — floats over the canvas. Only shown when a
           tour exists AND a system map exists. The map starts almost empty and
           ASSEMBLES itself one plain-language beat at a time. Hidden by default;
           JS un-hides it once /api/tour returns beats. -->
      <div id="tour-layer" class="tour-layer" hidden>
        <!-- a large friendly screenshot card (the opening beats show the real
             landing + login pages) — floats over the canvas, framed. -->
        <figure id="tour-shot" class="tour-shot" hidden aria-hidden="true">
          <img id="tour-shot-img" class="tour-shot-img" alt="" />
        </figure>

        <!-- caption bar: the plain narration, bottom-center, generous. It is the
             live region a screen reader announces on each beat. -->
        <div id="tour-caption" class="tour-caption" role="status" aria-live="polite">
          <p id="tour-caption-text" class="tour-caption-text"></p>
          <button id="tour-concern-btn" class="tour-concern-btn" type="button" hidden>See what looks off</button>
        </div>

        <!-- the control dock: step through the story yourself with Back / Next -->
        <div id="tour-controls" class="tour-controls" role="group" aria-label="Guided tour controls">
          <div class="tour-steprow">
            <button id="tour-back" class="tour-step-btn" type="button" aria-label="Previous step">&#8249; Back</button>
            <div class="tour-progress" aria-hidden="true">
              <span id="tour-progress-text" class="tour-progress-text">Step 1 of 1</span>
              <div id="tour-dots" class="tour-dots"></div>
            </div>
            <button id="tour-next" class="tour-step-btn" type="button" aria-label="Next step">Next &#8250;</button>
          </div>
          <div class="tour-endrow">
            <button id="tour-replay" class="tour-quiet-btn" type="button" hidden>Replay</button>
            <button id="tour-skip" class="tour-quiet-btn" type="button">Skip &mdash; show the whole map</button>
            <button id="tour-explore" class="tour-quiet-btn" type="button" hidden>Explore on your own</button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- PLAN -->
  <section id="view-plan" class="view" role="tabpanel" aria-labelledby="tab-plan" hidden>
    <div class="plan-banner" role="note">
      <strong>PLANNED — not yet verified.</strong>
      This view is the agent's stated intent, not verified fact.
    </div>
    <div id="plan-body" class="tree-host" aria-live="polite">
      <p class="muted loading-line">Reading the plan…</p>
    </div>
  </section>

  <!-- LIVE -->
  <section id="view-live" class="view" role="tabpanel" aria-labelledby="tab-live" hidden>
    <div class="live-head">
      <div id="live-status" class="updated" aria-live="polite">Loading structure…</div>
      <div id="stale-banner" class="stale-banner" role="status" hidden>STALE — the structure may be out of date.</div>
    </div>

    <!-- PLAIN level: plain-English flow strips (depth=plain only) -->
    <div id="flows-host" class="flows-host" aria-live="polite">
      <p class="muted loading-line">Reading how your app connects…</p>
    </div>

    <div class="live-grid">
      <div class="panel">
        <h2 class="panel-title">Structure</h2>
        <div id="live-tree" class="tree-host" aria-live="polite">
          <p class="muted loading-line">Reading files…</p>
        </div>
      </div>
      <div class="panel">
        <h2 class="panel-title">Diagram <span class="legend-toggle" id="legend-toggle" tabindex="0" role="button" aria-expanded="false">legend</span></h2>
        <div id="plain-legend" class="plain-legend">
          <p class="plain-legend-head">What the shapes mean</p>
          <ul class="plain-legend-list">
            <li><span class="lg-shape rounded"></span><strong>Endpoint</strong> — a door other software uses to talk to your app.</li>
            <li><span class="lg-shape hex"></span><strong>Security guard</strong> — a check that runs before a door opens (middleware).</li>
            <li><span class="lg-shape cyl"></span><strong>Records</strong> — where your app remembers things (a database table).</li>
            <li><span class="lg-shape tag"></span><strong>Settings &amp; secrets</strong> — values read from outside the code (env vars).</li>
            <li><span class="lg-shape rect"></span><strong>Page / file</strong> — a screen people see or a file of code.</li>
            <li><span class="lg-line"></span>A solid line means we traced the connection; a dashed line means we couldn’t be sure.</li>
          </ul>
        </div>
        <div id="legend" class="legend" hidden>
          <span class="lg"><span class="lg-shape rounded"></span>route</span>
          <span class="lg"><span class="lg-shape hex"></span>middleware</span>
          <span class="lg"><span class="lg-shape cyl"></span>db table</span>
          <span class="lg"><span class="lg-shape tag"></span>env var</span>
          <span class="lg"><span class="lg-shape rect"></span>file / component</span>
          <span class="lg">solid → matched · dashed ⇢ unmatched/dynamic</span>
        </div>
        <div id="diagram-host" class="diagram-host">
          <p class="muted loading-line">Building diagram…</p>
        </div>
      </div>
    </div>

    <!-- Activity feed: last 10 added/removed nodes -->
    <div id="activity" class="activity" hidden>
      <h2 class="panel-title">What just changed</h2>
      <ul id="activity-list" class="activity-list"></ul>
    </div>
  </section>

  <!-- REPORT -->
  <section id="view-report" class="view" role="tabpanel" aria-labelledby="tab-report" hidden>
    <div id="report-body" aria-live="polite">
      <p class="muted loading-line">Verifying claims…</p>
    </div>
  </section>

  <!-- HISTORY -->
  <section id="view-history" class="view" role="tabpanel" aria-labelledby="tab-history" hidden>
    <div id="history-body" aria-live="polite">
      <p class="muted loading-line">Reading the ledger…</p>
    </div>
  </section>

  <!-- HOW IT WORKS — the plain-language end-to-end stories (map.dataFlows) -->
  <section id="view-howitworks" class="view" role="tabpanel" aria-labelledby="menu-howitworks" hidden>
    <div id="howitworks-body" aria-live="polite">
      <p class="muted loading-line">Reading the stories…</p>
    </div>
  </section>

  <!-- WHAT LOOKS OFF — the adversarial concerns (map.concerns) -->
  <section id="view-concerns" class="view" role="tabpanel" aria-labelledby="menu-concerns" hidden>
    <div id="concerns-body" aria-live="polite">
      <p class="muted loading-line">Looking for things to check…</p>
    </div>
  </section>

  <!-- TECHNICAL level: raw API links footer -->
  <footer id="tech-footer" class="tech-footer">
    <span class="muted">Raw data (tokened):</span>
    <a id="raw-graph" href="#" target="_blank" rel="noopener">/api/graph</a>
    <a id="raw-verdicts" href="#" target="_blank" rel="noopener">/api/verdicts</a>
    <a id="raw-flows" href="#" target="_blank" rel="noopener">/api/flows</a>
    <a id="raw-ledger" href="#" target="_blank" rel="noopener">/api/ledger</a>
  </footer>

  <!-- permanent, quiet presence-not-correctness badge — footer micro-text -->
  <footer class="page-foot">
    <span class="badge" title="This tool checks that claimed things exist in the code. It does not check that they work.">verifies presence, not correctness</span>
  </footer>
</main>

<!-- Menu sheet (the only chrome affordance) -->
<div id="menu-sheet" class="overlay menu-overlay" role="dialog" aria-modal="true" aria-labelledby="menu-title" hidden>
  <div class="menu-card">
    <div class="menu-head">
      <h2 id="menu-title">Menu</h2>
      <button class="menu-close btn-secondary" type="button" aria-label="Close menu">Close</button>
    </div>
    <nav class="menu-list" aria-label="Sections">
      <button class="menu-item" type="button" id="menu-howitworks" data-view="howitworks" hidden>How it works <span class="menu-sub">the system in plain words</span></button>
      <button class="menu-item" type="button" id="menu-concerns" data-view="concerns" hidden>What looks off <span class="menu-sub">things worth checking</span></button>
      <button class="menu-item" type="button" data-view="report">Report</button>
      <button class="menu-item" type="button" data-view="history">History</button>
      <button class="menu-item" type="button" data-view="plan">Plan</button>
      <button class="menu-item" type="button" data-view="live">Technical view</button>
      <button class="menu-item" type="button" data-menu="learn">Learn <span class="menu-sub">the whole menu in plain words</span></button>
      <button class="menu-item" type="button" data-menu="export-md">Export <span class="menu-sub">copy report (markdown)</span></button>
      <button class="menu-item" type="button" data-menu="export-mmd">Export diagram <span class="menu-sub">download .mmd</span></button>
      <button class="menu-item" type="button" data-menu="shortcuts">Shortcuts</button>
    </nav>
    <div class="menu-depth-wrap">
      <p class="menu-depth-label">How should we explain your app?</p>
      <div class="aud" role="radiogroup" aria-label="How technical should the map be" id="aud-toggle">
        <button class="aud-opt" type="button" role="radio" id="aud-simple" data-aud="simple" aria-checked="false" title="Plain words, the simplest picture">
          <span class="aud-emoji" aria-hidden="true">🌱</span><span class="aud-name">Keep it simple</span><span class="aud-sub">plain words, no jargon</span>
        </button>
        <button class="aud-opt" type="button" role="radio" id="aud-guided" data-aud="guided" aria-checked="true" title="The map, with things explained as you go">
          <span class="aud-emoji" aria-hidden="true">🧭</span><span class="aud-name">Show &amp; explain</span><span class="aud-sub">tap anything to learn it</span>
        </button>
        <button class="aud-opt" type="button" role="radio" id="aud-technical" data-aud="technical" aria-checked="false" title="Files, routes, and receipts on everything">
          <span class="aud-emoji" aria-hidden="true">⚙️</span><span class="aud-name">I write code</span><span class="aud-sub">files, routes, receipts</span>
        </button>
      </div>
    </div>
  </div>
</div>

<!-- ONBOARDING: first-visit "how should we explain this?" question. Gated on
     localStorage pd-audience; shown over the map before the tour. Re-openable
     from the menu. The three choices map 1:1 to the audience radio above. -->
<div id="onboard" class="overlay onboard-overlay" role="dialog" aria-modal="true" aria-labelledby="onboard-title" hidden>
  <div class="onboard-card">
    <p class="onboard-kicker">Before we draw your app…</p>
    <h2 id="onboard-title" class="onboard-title">How should we explain it?</h2>
    <p class="onboard-lead">Pick whatever feels right — you can change it anytime from the menu.</p>
    <div class="onboard-choices">
      <button class="onboard-choice" type="button" data-aud="simple">
        <span class="oc-emoji" aria-hidden="true">🌱</span>
        <span class="oc-name">Keep it simple</span>
        <span class="oc-desc">Plain words and the clearest possible picture. No code, no jargon.</span>
      </button>
      <button class="onboard-choice is-default" type="button" data-aud="guided">
        <span class="oc-emoji" aria-hidden="true">🧭</span>
        <span class="oc-name">Show me &amp; explain</span>
        <span class="oc-desc">The map, with everything explained as you go. Tap anything to learn what it is.</span>
      </button>
      <button class="onboard-choice" type="button" data-aud="technical">
        <span class="oc-emoji" aria-hidden="true">⚙️</span>
        <span class="oc-name">I write code</span>
        <span class="oc-desc">Files, routes, and a file:line receipt on everything. The full technical detail.</span>
      </button>
    </div>
    <button class="onboard-skip" type="button">Skip — just show me the map</button>
  </div>
</div>

<!-- Learn popover (Plain level teaching layer) -->
<div id="learn-pop" class="overlay learn-pop" role="dialog" aria-modal="false" aria-labelledby="learn-title" hidden>
  <div class="learn-card">
    <button class="learn-close" type="button" aria-label="Close">×</button>
    <h3 id="learn-title" class="learn-title"></h3>
    <p class="learn-plain"></p>
    <p class="learn-instance"></p>
    <div class="learn-rels" hidden></div>
    <p class="learn-why"></p>
    <div class="learn-actions">
      <button class="btn-secondary learn-code" type="button">Show me the code</button>
      <button class="btn-secondary learn-more" type="button">Learn more</button>
    </div>
    <div class="learn-snippet-host"></div>
  </div>
</div>

<!-- Glossary sheet ("Learn more") -->
<div id="glossary-panel" class="overlay glossary-panel" role="dialog" aria-modal="true" aria-labelledby="glossary-title" hidden>
  <div class="glossary-sheet">
    <div class="glossary-head">
      <h2 id="glossary-title">The whole menu, in plain words</h2>
      <button class="glossary-close btn-secondary" type="button" aria-label="Close glossary">Close</button>
    </div>
    <p class="muted glossary-intro">One restaurant analogy for every part of your app. Want the long version? <a id="learn-md-link" href="#" target="_blank" rel="noopener">Read the gentle primer (docs/learn.md) →</a></p>
    <div id="glossary-list" class="glossary-list"></div>
  </div>
</div>

<!-- Keyboard shortcuts overlay -->
<div id="shortcuts" class="overlay shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" hidden>
  <div class="shortcuts-card">
    <button class="shortcuts-close" type="button" aria-label="Close">×</button>
    <h3 id="shortcuts-title">Keyboard shortcuts</h3>
    <dl class="shortcuts-list">
      <dt>Space</dt><dd>play or pause the guided tour</dd>
      <dt>← / →</dt><dd>previous / next tour step (or pan the map)</dd>
      <dt>m</dt><dd>open the menu</dd>
      <dt>d</dt><dd>cycle depth (Map → Plain → Technical)</dd>
      <dt>+ / −</dt><dd>zoom the map in / out</dd>
      <dt>0</dt><dd>fit the whole map in view</dd>
      <dt>/</dt><dd>focus the report search box</dd>
      <dt>Esc</dt><dd>skip the tour to the full map, then close overlays</dd>
      <dt>?</dt><dd>show or hide this list</dd>
    </dl>
  </div>
</div>

<div id="snippet-tpl" hidden></div>

<script>
window.__PD_TOKEN__ = ${tokenLiteral};
window.__PD_GLOSSARY__ = ${glossaryLiteral};
window.__PD_ALLOWLIST__ = ${allowlistLiteral};
</script>
<script>
${appScript()}
</script>
<script>
// Mermaid via CDN with graceful fallback: if it fails to load, the LIVE view
// keeps the (primary, reliable) tree and shows a notice instead of the diagram.
(function () {
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  s.async = true;
  s.onload = function () { window.__PD_onMermaid && window.__PD_onMermaid(); };
  s.onerror = function () { window.__PD_onMermaidFail && window.__PD_onMermaidFail(); };
  document.head.appendChild(s);
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Styles — LIGHT, very minimal, one accent (deep teal), hairline borders.
// Verdict colors verified ≥4.5:1 on --bg #fafaf9:
//   green #047857 (5.3:1), red #b91c1c (5.9:1), amber #b45309 (4.7:1).
// Accent teal #0f766e (5.4:1) used sparingly.
// ---------------------------------------------------------------------------
const STYLES = `
:root {
  --bg: #fafaf9;
  --bg-1: #ffffff;
  --bg-2: #f5f5f4;
  --border: #e7e5e4;
  --border-strong: #d6d3d1;
  --fg: #1c1917;
  --fg-dim: #44403c;
  --muted: #78716c;
  --accent: #0f766e;
  --accent-soft: #e6f1ef;
  --green: #047857;
  --green-bg: #ecfdf5;
  --red: #b91c1c;
  --red-bg: #fef2f2;
  --amber: #b45309;
  --amber-bg: #fffbeb;
  --elevation: 0 8px 30px rgba(28,25,23,.12);
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --radius: 8px;
  /* floating-header height — the fitAll top-inset uses this so no node ever
     hides behind the overlay header on the full-bleed map. */
  --header-h: 60px;
  /* reusable easing curves — 2-3 named tokens, calm with one spring for settle */
  --ease-out: cubic-bezier(.16,1,.3,1);        /* decelerate / settle in */
  --ease-spring: cubic-bezier(.34,1.56,.64,1); /* gentle overshoot for node settle */
  --ease-fade: cubic-bezier(.33,0,.2,1);       /* quiet fade */
  --ease-soft: cubic-bezier(.4,0,.2,1);        /* gentle move (legacy alias) */
}
* { box-sizing: border-box; }
/* The hidden attribute must ALWAYS win. Any element with a display flex/grid
   class rule (banners, coach strip, overlays) otherwise stays on screen even
   after JS sets hidden=true — the root cause of the phantom "Lost connection"
   banner that showed while the connection was actually fine. One global guard
   kills the whole bug class for every current and future toggled element. */
[hidden] { display: none !important; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  letter-spacing: -.003em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
/* barely-there warm paper grain — a self-contained SVG noise, fixed, ~3% opacity.
   No external resource, no gradient; just a faint tactile surface. */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  opacity: .025;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.skip-link {
  position: absolute; left: -999px; top: 0; z-index: 100;
  background: var(--accent); color: #fff; padding: 8px 14px; border-radius: 0 0 var(--radius) 0;
}
.skip-link:focus { left: 0; }

a { color: var(--accent); }

.topbar {
  display: flex; align-items: baseline; gap: 20px;
  padding: 16px 30px;
  border-bottom: 1px solid transparent;
  background: var(--bg);
  position: sticky; top: 0; z-index: 20;
  flex-wrap: wrap;
  transition: border-color .6s var(--ease-fade), background .3s var(--ease-fade);
}
/* a hairline appears only once the page has scrolled past the calm header */
.topbar.is-stuck { border-bottom-color: var(--border); }
/* On the full-bleed MAP, the header FLOATS over the canvas: fixed, translucent
   + blurred, no heavy border. It sits above the canvas (z over the SVG) but the
   canvas still fills the whole viewport underneath it. */
body.map-mode .topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  min-height: var(--header-h);
  padding: 12px 22px; align-items: center;
  background: rgba(250,250,249,.72);
  -webkit-backdrop-filter: saturate(1.4) blur(12px);
  backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid rgba(231,229,228,.6);
}
body.map-mode .topbar.is-stuck { border-bottom-color: rgba(231,229,228,.6); }
.brand { display: flex; align-items: baseline; gap: 14px; font-weight: 600; letter-spacing: -.01em; min-width: 0; }
.brand-name { font-size: 15px; font-weight: 600; letter-spacing: -.005em; }
/* the one essence line — sits beside the wordmark, recedes after entrance */
.essence {
  font-size: 13px; color: var(--muted); font-weight: 400; letter-spacing: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: opacity .8s var(--ease-fade);
}
/* after the entrance completes, the essence quietly retires to just the wordmark */
body.pd-settled .essence { opacity: 0; }
body.pd-settled .topbar:hover .essence, body.pd-settled .essence:focus-within { opacity: 1; }
@media (max-width: 680px) { .essence { display: none; } }
.tabs { display: flex; gap: 2px; }
.tab {
  appearance: none; background: transparent; color: var(--muted);
  border: none; border-bottom: 2px solid transparent;
  font-family: var(--sans); font-size: 14px; font-weight: 600;
  padding: 11px 14px; min-height: 44px; cursor: pointer;
  transition: color .18s ease, border-color .18s ease;
}
.tab:hover { color: var(--fg); }
.tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
.header-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }

/* status strip — the only verdict surface on the map. Understated; lives as one
   quiet line, fades in LAST during the entrance. */
.status-strip { flex: 1; min-width: 0; font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; font-weight: 400; }
.status-strip:empty { display: none; }
.status-strip .ss-link { appearance: none; background: transparent; border: none; cursor: pointer; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.status-strip .ss-link:hover { color: var(--fg); }
.status-strip .ss-ok { color: var(--green); }
.status-strip .ss-bad { color: var(--red); font-weight: 600; }
.menu-btn { font-size: 18px; line-height: 1; letter-spacing: 1px; padding: 6px 14px; }
.iconbtn {
  appearance: none; cursor: pointer; min-height: 36px; min-width: 36px;
  background: transparent; color: var(--muted);
  border: 1px solid var(--border-strong); border-radius: 999px;
  font-family: var(--sans); font-size: 13px; font-weight: 600; padding: 6px 12px;
  transition: color .18s ease, border-color .18s ease;
}
.iconbtn:hover { color: var(--accent); border-color: var(--accent); }
/* permanent badge — now quiet footer micro-text, no longer shouting in the header */
.page-foot {
  margin-top: 40px; padding-top: 18px;
  text-align: center;
}
.badge {
  font-size: 11px; font-weight: 400; color: var(--muted);
  letter-spacing: .04em;
  border: none; background: transparent;
  padding: 0; white-space: nowrap;
}
:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 3px; border-radius: 4px; }

.exportwrap { position: relative; }
.export-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 30;
  background: var(--bg-1); border: 1px solid var(--border-strong); border-radius: var(--radius);
  box-shadow: var(--elevation); padding: 6px; min-width: 220px;
  display: flex; flex-direction: column; gap: 2px;
  animation: pop-in .14s ease;
}
.export-item {
  appearance: none; cursor: pointer; text-align: left;
  background: transparent; color: var(--fg); border: none; border-radius: 6px;
  font-family: var(--sans); font-size: 13px; font-weight: 500; padding: 9px 10px; min-height: 38px;
}
.export-item:hover { background: var(--bg-2); color: var(--accent); }

.main { padding: 48px 40px 40px; max-width: 1040px; margin: 0 auto; }
/* FULL-BLEED MAP: in map-mode the page IS the canvas. The whole document stops
   scrolling, .main drops its padding/width cap, and the map view becomes a
   fixed full-viewport layer the canvas fills edge-to-edge. Floating chrome
   (header, banners, badge, controls) sits ON TOP via fixed positioning and
   never reflows the canvas. Other views are untouched (normal scroll flow). */
body.map-mode { overflow: hidden; }
body.map-mode .main { padding: 0; max-width: none; margin: 0; }
body.map-mode .page-foot { display: none; }
.view-map { padding: 18px 0 0; }
.view { }
.view-anim { animation: tab-in .26s ease; }
@keyframes tab-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes pop-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }

/* staggered fade-up for list items */
.stagger { opacity: 0; animation: rise .34s ease forwards; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.muted { color: var(--muted); }
.loading-line { font-style: italic; }

/* coach strip */
.coach {
  display: flex; align-items: center; gap: 12px;
  background: var(--accent-soft); border: 1px solid #cfe6e2; color: var(--accent);
  border-radius: var(--radius); padding: 10px 14px; margin-bottom: 16px; font-size: 14px;
  animation: rise .34s ease;
}
.coach-text { flex: 1; }
.coach-x { appearance: none; background: transparent; border: none; color: var(--accent); font-size: 20px; line-height: 1; cursor: pointer; min-width: 36px; min-height: 36px; }

.conn-banner {
  display: flex; align-items: center; gap: 12px;
  background: var(--amber-bg); color: var(--amber);
  border-bottom: 1px solid var(--amber);
  padding: 11px 22px; font-weight: 600;
  animation: slide-down .26s ease;
}
/* display:flex above overrides the UA [hidden]{display:none}, so toggling the
   hidden attribute in JS did NOT hide the banner — it stayed on screen reading
   "Lost connection" even while the connection was fine. This restores hidden as
   the real off switch for both the reconnect and stale-token banners. (Same bug
   class as overlay[hidden] above.) */
.conn-banner[hidden] { display: none; }
@keyframes slide-down { from { transform: translateY(-100%); opacity: 0; } to { transform: none; opacity: 1; } }
/* the 401 safety-net banner is steadier (it needs a deliberate Reload, not a
   self-clearing reconnect) — same warm surface, but it never pulses away. */
.stale-token-banner .conn-text { font-weight: 600; }

/* ── FULL-BLEED MAP: floating overlay chrome ─────────────────────────────────
   On the map, banners/coach/badge do NOT reflow the canvas — they FLOAT on top
   (fixed, above the canvas, under the header) and still show/hide via [hidden]. */
body.map-mode .conn-banner {
  position: fixed; left: 50%; top: calc(var(--header-h) + 10px);
  transform: translateX(-50%); z-index: 38;
  width: auto; max-width: min(92vw, 560px);
  border: 1px solid var(--amber); border-radius: 999px;
  box-shadow: var(--elevation);
  padding: 9px 16px; font-size: 13px;
}
/* the STALE pill: smaller, subtler, floating — not a full-width bar */
body.map-mode #map-stale {
  position: fixed; left: 50%; top: calc(var(--header-h) + 10px);
  transform: translateX(-50%); z-index: 36;
  width: auto; max-width: min(92vw, 460px);
  border-radius: 999px; box-shadow: var(--elevation);
  padding: 5px 14px; font-size: 12px; font-weight: 600;
  background: var(--amber-bg); color: var(--amber); border: 1px solid var(--amber);
  white-space: nowrap;
}
/* first-run coach floats top-RIGHT under the header (clear of the centered band
   labels), quiet and dismissible. */
body.map-mode .coach {
  position: fixed; right: 16px; top: calc(var(--header-h) + 10px);
  z-index: 34;
  width: auto; max-width: min(80vw, 460px); margin: 0;
  border-radius: 999px; box-shadow: var(--elevation);
}
/* the presence-not-correctness badge floats bottom-center, quiet */
.map-foot { display: none; }
body.map-mode .map-foot {
  display: block; position: fixed; left: 50%; bottom: 12px;
  transform: translateX(-50%); z-index: 6;
  margin: 0; padding: 0; pointer-events: none;
}

/* PLAN */
.plan-banner {
  background: var(--bg-2); border: 1px dashed var(--border-strong);
  color: var(--fg-dim); border-radius: var(--radius);
  padding: 12px 14px; margin-bottom: 18px;
}
.plan-banner strong { color: var(--fg); }

/* LIVE */
.live-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
.updated { color: var(--muted); font-size: 13px; font-family: var(--mono); }
.stale-banner {
  background: var(--amber-bg); color: var(--amber);
  border: 1px solid var(--amber); border-radius: var(--radius);
  padding: 6px 12px; font-weight: 600; font-size: 13px;
}
.live-grid { display: grid; grid-template-columns: minmax(0,340px) 1fr; gap: 22px; }
.panel { min-width: 0; }
.panel-title { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); }
.legend-toggle { font-size: 11px; color: var(--accent); cursor: pointer; margin-left: 6px; text-transform: none; letter-spacing: 0; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; font-size: 12px; color: var(--fg-dim); }
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg-shape { width: 16px; height: 12px; border: 1px solid var(--border-strong); background: var(--bg-2); display: inline-block; }
.lg-shape.rounded { border-radius: 8px; }
.lg-shape.hex { clip-path: polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%); }
.lg-shape.cyl { border-radius: 8px / 4px; }
.lg-shape.tag { clip-path: polygon(0 0,80% 0,100% 50%,80% 100%,0 100%); }
.diagram-host { overflow: auto; min-height: 120px; }
.diagram-host svg { max-width: 100%; height: auto; }

/* activity feed */
.activity { margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--border); }
.activity-list { list-style: none; margin: 0; padding: 0; }
.activity-item { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.activity-item:last-child { border-bottom: none; }
.act-mark { font-weight: 700; font-family: var(--mono); }
.act-add .act-mark { color: var(--green); }
.act-rem .act-mark { color: var(--red); }
.act-name { font-family: var(--mono); }
.act-time { margin-left: auto; color: var(--muted); font-size: 12px; }

/* Tree */
.tree { list-style: none; margin: 0; padding: 0; font-family: var(--mono); font-size: 13px; }
.tree ul { list-style: none; margin: 0; padding-left: 16px; border-left: 1px solid var(--border); }
.tree li { margin: 1px 0; }
.tree-toggle {
  appearance: none; background: transparent; border: none; color: var(--fg);
  font-family: var(--mono); font-size: 13px; cursor: pointer; padding: 4px 4px;
  min-height: 28px; text-align: left; display: inline-flex; align-items: center; gap: 6px;
}
.tree-toggle .caret { color: var(--muted); width: 10px; display: inline-block; }
.tree-leaf { padding: 4px 4px 4px 20px; display: flex; align-items: center; gap: 6px; }
.kind-tag {
  font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
  border: 1px solid var(--border-strong); border-radius: 4px; padding: 0 5px; color: var(--muted);
}
.kind-route { color: var(--green); border-color: var(--green); }
.kind-middleware { color: var(--amber); border-color: var(--amber); }
.kind-dbTable { color: var(--accent); border-color: var(--accent); }
.kind-envVar { color: #7c3aed; border-color: #7c3aed; }
.node-new { box-shadow: 0 0 0 2px var(--accent); border-radius: 4px; transition: box-shadow 1.2s ease; }
.node-removed { text-decoration: line-through; opacity: .55; }
.diff-badge { font-size: 10px; font-weight: 700; padding: 0 5px; border-radius: 4px; margin-left: 6px; }
.diff-badge.new { background: var(--accent); color: #fff; }
.diff-badge.removed { background: var(--red); color: #fff; }
.tree.planned, .tree.planned .tree-toggle, .tree.planned .tree-leaf { color: var(--fg-dim); }
.tree.planned .kind-tag { border-style: dashed; opacity: .8; }

/* ── Technical depth: a receipt on EVERY node, a kind filter, verdict provenance.
   Everything here is gated to body[data-depth="technical"] so Plain/Map stay calm. */
.tree-leaf { flex-wrap: wrap; }
.tree-receipt, .rule-id { display: none; }
body[data-depth="technical"] .tree-receipt {
  display: inline-flex; font-family: var(--mono); font-size: 10.5px; line-height: 1.5;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px;
  padding: 0 5px; color: var(--accent); cursor: pointer; margin-left: 4px;
}
body[data-depth="technical"] .tree-receipt:hover { border-color: var(--accent); }
body[data-depth="technical"] .rule-id { display: inline; font-family: var(--mono); font-size: 10px; color: var(--muted); }
.tree-leaf .snippet { flex: 1 0 100%; margin-top: 4px; }
.tree-filter { display: none; }
body[data-depth="technical"] .tree-filter {
  display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.tfc {
  font-size: 11px; font-family: var(--mono); cursor: pointer; color: var(--fg-dim);
  background: var(--bg-1); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px;
}
.tfc:hover { border-color: var(--border-strong); }
.tfc.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.tfc-n { opacity: .7; margin-left: 2px; }
.leaf-filtered, .dir-filtered { display: none !important; }
.claim-tech { display: none; }
body[data-depth="technical"] .claim-tech {
  display: block; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 12px;
}
.ct-row { display: flex; gap: 8px; align-items: baseline; margin: 3px 0; }
.ct-k { flex: 0 0 80px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.ct-v { color: var(--fg-dim); word-break: break-word; }
.ct-v.mono, .factid-chip { font-family: var(--mono); }
.factid-chip {
  display: inline-block; font-size: 10.5px; background: var(--bg-2);
  border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; margin: 1px 2px 1px 0;
}
.allow-ok { color: var(--green); font-weight: 600; }
.allow-off { color: var(--amber); font-weight: 600; }

/* REPORT */
.verdict-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 20px;
  padding: 6px 0 18px; margin-bottom: 18px; border-bottom: 1px solid var(--border);
}
.ring-wrap { display: flex; align-items: center; gap: 14px; }
.ring { width: 64px; height: 64px; flex: 0 0 auto; }
.ring-track { fill: none; stroke: var(--border); stroke-width: 6; }
.ring-fill { fill: none; stroke: var(--accent); stroke-width: 6; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 1s ease; }
.ring-pct { font-family: var(--mono); font-size: 15px; font-weight: 600; fill: var(--fg); }
.vb-count { font-weight: 700; font-size: 17px; }
.vb-sub { color: var(--muted); font-size: 13px; }
.vb-segs { display: flex; flex-wrap: wrap; gap: 16px; }
.vb-seg { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; }
.vb-seg .ico { font-weight: 700; }
.seg-confirmed { color: var(--green); }
.seg-absent { color: var(--red); }
.seg-undetermined { color: var(--amber); }

/* filter + search */
.report-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 18px; }
.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.fchip {
  appearance: none; cursor: pointer; min-height: 36px;
  background: transparent; color: var(--fg-dim);
  border: 1px solid var(--border-strong); border-radius: 999px;
  font-family: var(--sans); font-size: 13px; font-weight: 600; padding: 6px 14px;
  transition: color .16s ease, border-color .16s ease, background .16s ease;
}
.fchip:hover { border-color: var(--accent); color: var(--accent); }
.fchip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.search-box {
  flex: 1; min-width: 180px; max-width: 360px;
  appearance: none; background: var(--bg-1);
  border: 1px solid var(--border-strong); border-radius: 999px;
  font-family: var(--sans); font-size: 14px; padding: 9px 16px; min-height: 36px; color: var(--fg);
}
.search-box::placeholder { color: var(--muted); }

.group { margin-bottom: 16px; }
.group > summary {
  cursor: pointer; list-style: none; padding: 11px 0; min-height: 44px;
  display: flex; align-items: center; gap: 10px;
  font-weight: 600; border-bottom: 1px solid var(--border);
}
.group > summary::-webkit-details-marker { display: none; }
.group > summary .gcaret { color: var(--muted); }
.group-confirmed > summary { color: var(--green); }
.group-undetermined > summary { color: var(--amber); }

.claim-row {
  padding: 16px 0; border-bottom: 1px solid var(--border);
}
.claim-row:last-child { border-bottom: none; }
.claim-absent { padding-left: 12px; border-left: 3px solid var(--red); }
.claim-undetermined { padding-left: 12px; border-left: 3px dashed var(--amber); }
.claim-confirmed { padding-left: 12px; border-left: 3px solid var(--green); }
.claim-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.vlabel { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
.vlabel.confirmed { color: var(--green); }
.vlabel.absent { color: var(--red); }
.vlabel.undetermined { color: var(--amber); }
.vlabel svg { width: 15px; height: 15px; }
.vlabel .draw { stroke-dasharray: 36; stroke-dashoffset: 36; animation: draw .5s ease forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
.claim-text { font-weight: 600; }
.claim-raw { color: var(--fg-dim); font-size: 13px; margin: 6px 0 0; }
.evidence { margin-top: 10px; }
.evidence-summary { color: var(--fg-dim); margin-bottom: 6px; }

.receipt { margin: 8px 0; }
.chip {
  appearance: none; cursor: pointer;
  font-family: var(--mono); font-size: 12px;
  background: var(--bg-2); color: var(--accent);
  border: 1px solid var(--border-strong); border-radius: 6px;
  padding: 6px 10px; min-height: 32px;
}
.chip:hover { border-color: var(--accent); }
.snippet {
  margin-top: 8px; font-family: var(--mono); font-size: 12.5px;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 12px; overflow-x: auto; white-space: pre; color: var(--fg-dim);
}
.snippet .ln { color: var(--muted); user-select: none; display: inline-block; width: 3.2em; text-align: right; padding-right: 12px; }
.snippet .center { background: var(--accent-soft); display: block; color: var(--fg); }
.copy-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.btn-secondary {
  appearance: none; cursor: pointer; min-height: 36px;
  background: var(--bg-1); color: var(--fg-dim);
  border: 1px solid var(--border-strong); border-radius: 6px;
  font-family: var(--sans); font-size: 12px; font-weight: 600; padding: 7px 12px;
  transition: color .16s ease, border-color .16s ease;
}
.btn-secondary:hover { color: var(--accent); border-color: var(--accent); }
.fix-box { margin-top: 10px; }
.fix-box pre { margin: 0 0 8px; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; color: var(--muted); }
.defeat { margin-top: 8px; }
.defeat summary { cursor: pointer; color: var(--muted); font-size: 13px; }
.defeat pre { font-family: var(--mono); font-size: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; overflow-x: auto; }

.relief { text-align: center; padding: 40px 20px; }
.relief .big { color: var(--green); font-size: 22px; font-weight: 700; }
.relief .sub { color: var(--fg-dim); margin-top: 8px; }
.empty { text-align: center; padding: 56px 24px; color: var(--muted); font-size: 15px; }

/* Depth toggle (radiogroup) */
.depth { display: inline-flex; gap: 2px; padding: 2px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 999px; }
.depth-opt {
  appearance: none; background: transparent; color: var(--muted);
  border: none; border-radius: 999px; cursor: pointer;
  font-family: var(--sans); font-size: 12px; font-weight: 600; letter-spacing: .02em;
  padding: 9px 14px; min-height: 40px; min-width: 44px;
  transition: color .16s ease, background .16s ease;
}
.depth-opt:hover { color: var(--fg); }
.depth-opt[aria-checked="true"] { background: var(--accent); color: #fff; }

/* AUDIENCE radio (menu): three stacked cards, the chosen one accented. */
.aud { display: grid; gap: 8px; }
.aud-opt {
  appearance: none; cursor: pointer; text-align: left;
  display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; align-items: center;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px;
  padding: 12px 14px; color: var(--fg);
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
}
.aud-opt:hover { border-color: var(--border-strong); }
.aud-opt .aud-emoji { grid-row: 1 / span 2; font-size: 20px; line-height: 1; }
.aud-opt .aud-name { font-size: 14px; font-weight: 600; }
.aud-opt .aud-sub { font-size: 12px; color: var(--muted); }
.aud-opt[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; background: var(--bg); }
.aud-opt[aria-checked="true"] .aud-name { color: var(--accent); }

/* ONBOARDING overlay: the first-visit audience question. */
.onboard-overlay { display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 70%, transparent); backdrop-filter: blur(7px); }
.onboard-card {
  background: var(--bg); border: 1px solid var(--border-strong); border-radius: 18px;
  box-shadow: 0 40px 100px -40px rgba(28,25,23,.5);
  width: min(540px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto;
  padding: 30px 30px 22px; text-align: center;
  animation: onboard-pop .42s var(--ease-spring) both;
}
@keyframes onboard-pop { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
.onboard-kicker { font-family: var(--mono); font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.onboard-title { font-size: 25px; letter-spacing: -.01em; margin: 0 0 8px; }
.onboard-lead { font-size: 14.5px; color: var(--fg-dim); max-width: 42ch; margin: 0 auto 22px; }
.onboard-choices { display: grid; gap: 12px; text-align: left; }
.onboard-choice {
  appearance: none; cursor: pointer; display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; align-items: start;
  background: var(--bg-2); border: 1.5px solid var(--border); border-radius: 14px; padding: 16px 18px; color: var(--fg);
  transition: border-color .16s ease, transform .16s var(--ease-spring), box-shadow .16s ease, background .16s ease;
}
.onboard-choice:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 28px -16px rgba(28,25,23,.4); }
.onboard-choice .oc-emoji { grid-row: 1 / span 2; font-size: 28px; line-height: 1; align-self: center; }
.onboard-choice .oc-name { font-size: 16px; font-weight: 600; }
.onboard-choice .oc-desc { font-size: 13px; color: var(--fg-dim); line-height: 1.5; }
.onboard-choice.is-default { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.onboard-skip { appearance: none; background: none; border: none; cursor: pointer; color: var(--muted); font-family: var(--sans); font-size: 13px; margin-top: 16px; padding: 8px; }
.onboard-skip:hover { color: var(--accent); text-decoration: underline; }

/* ===== AUDIENCE-DRIVEN MAP DETAIL ====================================== */
/* Technical identifiers on a node (e.g. "Postgres + pgvector") are hidden for
   the two non-coder levels; only the "I write code" audience sees them. */
body:not([data-audience="technical"]) .sys-tech { display: none; }
/* Simple mode: roomier cards + bigger labels, and the chrome calms down. */
body[data-audience="simple"] .sys-label { font-size: 14px; }
body[data-audience="simple"] .sys-tech,
body[data-audience="simple"] .gnode-rcpt,
body[data-audience="simple"] .rule-id { display: none !important; }
/* Receipts on the map's flow nodes appear only for the technical audience. */
body:not([data-audience="technical"]) .cn-rcpt { display: none; }

/* CALM WIRES for non-coders: the spaghetti of crossing lines is the #1 thing
   that makes the map feel intimidating. At the two non-technical levels the
   idle wires recede to a faint single tone (no rainbow brand colors, no moving
   pulses); the connections you care about light up the moment you hover or
   focus a box. Technical readers keep the full live, colored, pulsing wires. */
body[data-audience="simple"] .map-wire,
body[data-audience="guided"] .map-wire { opacity: .16; stroke-width: 1.3; }
body[data-audience="simple"] .map-wire.wire-branded,
body[data-audience="guided"] .map-wire.wire-branded { stroke: var(--accent) !important; }
body[data-audience="simple"] .map-wire.wire-hi,
body[data-audience="guided"] .map-wire.wire-hi { opacity: 1; stroke-width: 2.4; }
body[data-audience="simple"] .map-wire.wire-dim,
body[data-audience="guided"] .map-wire.wire-dim { opacity: .05; }
body[data-audience="simple"] .flow-pulse { display: none !important; }
body[data-audience="guided"] .flow-pulse { opacity: .35; }
body[data-audience="guided"] .flow-pulse.pulse-hi { opacity: 1; }

/* Roomier, more readable cards for the simplest level. */
body[data-audience="simple"] .sys-label { font-size: 14px; font-weight: 600; }
body[data-audience="simple"] .sys-node { min-height: 52px; }

/* PLAIN level: flow strips */
.flows-host { margin-bottom: 8px; }
.flow-strip { padding: 16px 0; border-bottom: 1px solid var(--border); }
.flow-strip:last-child { border-bottom: none; }
.flow-title { font-weight: 600; margin: 0 0 4px; }
.flow-plain { color: var(--fg-dim); font-size: 13px; margin: 0 0 12px; }
.flow-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.flow-chip {
  appearance: none; cursor: pointer;
  background: var(--bg-1); color: var(--fg); border: 1px solid var(--border-strong);
  border-radius: 999px; padding: 8px 14px; min-height: 40px;
  font-family: var(--sans); font-size: 13px; font-weight: 500;
  transition: transform .14s ease, border-color .14s ease;
}
.flow-chip:hover { border-color: var(--accent); transform: translateY(-1px); }
.flow-chip.chip-action { background: transparent; border-style: dashed; color: var(--muted); }
.flow-chip.chip-unknown { background: var(--amber-bg); color: var(--amber); border-color: var(--amber); cursor: default; }
.flow-chip.chip-endpoint { border-color: var(--green); }
.flow-chip.chip-guard { border-color: var(--amber); }
.flow-chip.chip-table { border-color: var(--accent); }
.flow-arrow { color: var(--muted); font-size: 16px; user-select: none; transition: transform .14s ease; }
.flow-chip:hover + .flow-arrow, .flow-arrow.nudge { transform: translateX(2px); }
.flow-untraced { }
.flow-untraced-note { color: var(--amber); font-size: 12px; margin: 8px 0 0; }
.flow-chip-snippet { margin-top: 10px; }
.pages-block { padding: 16px 0; border-top: 1px solid var(--border); margin-top: 4px; }
.pages-block h3 { margin: 0 0 4px; font-size: 14px; }
.pages-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.page-pill { font-family: var(--mono); font-size: 12px; color: var(--fg-dim); background: var(--bg-2); border: 1px solid var(--border-strong); border-radius: 6px; padding: 6px 10px; }
.page-pill b { color: var(--fg); font-family: var(--sans); }

/* Plain verdict sentences (REPORT @ Plain) */
.plain-verdict { padding: 14px 0; border-bottom: 1px solid var(--border); }
.plain-verdict:last-child { border-bottom: none; }
.plain-verdict.pv-confirmed { padding-left: 12px; border-left: 3px solid var(--green); }
.plain-verdict.pv-absent { padding-left: 12px; border-left: 3px solid var(--red); }
.plain-verdict.pv-undetermined { padding-left: 12px; border-left: 3px dashed var(--amber); }
.pv-line { font-weight: 600; }
.pv-confirmed .pv-line { color: var(--green); }
.pv-absent .pv-line { color: var(--red); }
.pv-undetermined .pv-line { color: var(--amber); }
.pv-raw { color: var(--fg-dim); font-size: 13px; margin: 6px 0 0; }
.pv-evidence { margin-top: 8px; }
.pv-evidence > summary { cursor: pointer; color: var(--muted); font-size: 13px; }

/* Plain-language legend (Map level) */
.plain-legend { margin-bottom: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
.plain-legend-head { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.plain-legend-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 13px; color: var(--fg-dim); }
.plain-legend-list li { display: flex; align-items: center; gap: 8px; }
.plain-legend-list strong { color: var(--fg); }
.lg-line { width: 16px; height: 0; border-top: 2px solid var(--accent); display: inline-block; }

/* HISTORY */
.history-session { margin-bottom: 24px; }
.history-session-head { font-size: 13px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 6px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.history-entry { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.history-entry:last-child { border-bottom: none; }
.he-ico { font-weight: 700; }
.he-ico.confirmed { color: var(--green); }
.he-ico.absent { color: var(--red); }
.he-ico.undetermined { color: var(--amber); }
.he-text { flex: 1; }
.he-time { color: var(--muted); font-size: 12px; font-family: var(--mono); }
.history-regression {
  background: var(--red-bg); border: 1px solid var(--red); border-left: 4px solid var(--red);
  border-radius: var(--radius); padding: 12px 14px; margin: 10px 0;
}
.history-regression .hr-title { color: var(--red); font-weight: 700; }
.history-regression .hr-claim { font-size: 13px; color: var(--fg-dim); margin: 4px 0 0; }

/* Overlays (single layer policy: only one is ever non-hidden) */
.overlay { position: fixed; inset: 0; z-index: 60; }
.overlay[hidden] { display: none; }
body.overlay-open { overflow: hidden; }

.learn-pop { display: grid; place-items: center; background: rgba(28,25,23,.28); padding: 16px; animation: backdrop .2s ease; }
.learn-card { background: var(--bg-1); border: 1px solid var(--border-strong); border-radius: var(--radius); max-width: 460px; width: 100%; padding: 22px; position: relative; box-shadow: var(--elevation); animation: pop-in .18s ease; max-height: 86vh; overflow-y: auto; overscroll-behavior: contain; }
.learn-close { position: absolute; top: 10px; right: 12px; appearance: none; background: transparent; border: none; color: var(--muted); font-size: 22px; cursor: pointer; line-height: 1; min-width: 44px; min-height: 44px; }
.learn-title { margin: 0 6px 8px 0; font-size: 18px; }
.learn-plain { color: var(--fg-dim); margin: 0 0 10px; }
.learn-instance { background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin: 0 0 10px; font-size: 13px; }
.learn-why { color: var(--muted); font-size: 13px; font-style: italic; margin: 0 0 14px; }
.learn-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.learn-snippet-host:not(:empty) { margin-top: 12px; }

@keyframes backdrop { from { opacity: 0; } to { opacity: 1; } }

/* Glossary sheet (slides up from bottom on mobile / in from right on desktop) */
.glossary-panel { display: grid; place-items: stretch; background: rgba(28,25,23,.32); animation: backdrop .2s ease; }
.glossary-sheet { background: var(--bg); border-left: 1px solid var(--border-strong); margin-left: auto; width: min(560px, 100%); height: 100%; overflow-y: auto; padding: 26px; box-shadow: var(--elevation); animation: sheet-in .28s ease; }
@keyframes sheet-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.glossary-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.glossary-head h2 { font-size: 18px; margin: 0; }
.glossary-intro { font-size: 13px; margin: 8px 0 18px; }
.glossary-list { display: grid; gap: 0; }
.glossary-entry { padding: 16px 0; border-bottom: 1px solid var(--border); }
.glossary-entry:last-child { border-bottom: none; }
.glossary-entry h3 { margin: 0 0 2px; font-size: 15px; }
.glossary-entry .gl-tech { color: var(--muted); font-size: 12px; font-family: var(--mono); }
.glossary-entry .gl-plain { margin: 8px 0 6px; color: var(--fg-dim); }
.glossary-entry .gl-analogy { font-size: 13px; color: var(--accent); margin: 0 0 4px; }
.glossary-entry .gl-analogy-tag { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); margin-right: 6px; }
.glossary-entry .gl-why { font-size: 13px; color: var(--muted); font-style: italic; margin: 0; }

/* Shortcuts overlay */
.shortcuts { display: grid; place-items: center; background: rgba(28,25,23,.28); padding: 16px; animation: backdrop .2s ease; }
.shortcuts-card { background: var(--bg-1); border: 1px solid var(--border-strong); border-radius: var(--radius); max-width: 380px; width: 100%; padding: 22px; position: relative; box-shadow: var(--elevation); animation: pop-in .18s ease; }
.shortcuts-close { position: absolute; top: 10px; right: 12px; appearance: none; background: transparent; border: none; color: var(--muted); font-size: 22px; cursor: pointer; line-height: 1; min-width: 44px; min-height: 44px; }
.shortcuts-card h3 { margin: 0 0 14px; font-size: 17px; }
.shortcuts-list { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; }
.shortcuts-list dt { font-family: var(--mono); font-size: 13px; color: var(--accent); }
.shortcuts-list dd { margin: 0; font-size: 13px; color: var(--fg-dim); }

/* Technical footer */
.tech-footer { margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; align-items: center; }
.tech-footer a { font-family: var(--mono); font-size: 12px; }

/* ── THE MAP (home) — INFINITE CANVAS ───────────────────────────────────────
   A full-bleed viewport (#canvas-viewport) holding ONE CSS-transformed layer
   (#world) whose style.transform = translate(TXpx,TYpx) scale(K) is the only
   thing pan/zoom/drag mutate. #world is a NORMAL DIV, so Chromium applies that
   transform to BOTH its child SVG wire layer AND its child HTML node divs
   IDENTICALLY — wires and nodes stay perfectly locked together (the bug fix:
   SVG-embedded HTML under an SVG <g> transform did NOT do this). Nodes sit in 3
   vertical world bands:
     pages/forms (left) → endpoints/doors (mid) → records/tables (right).
   The dot-grid is a tiled background ON #world so it pans/scales with the world. */
.view-map { padding: 0; }
/* FULL-BLEED: the map view is a fixed full-viewport layer; the viewport
   fills it edge-to-edge with NO border, NO radius, NO margin. The dot-grid +
   nodes reach every edge of the screen. 100dvh (not 100vh) for mobile safety. */
.view-map.view {
  position: fixed; inset: 0; z-index: 1;
  width: 100vw; height: 100dvh;
}
/* #canvas-viewport — the pan surface. overflow:hidden clips the infinite world;
   touch-action:none so we own pan/pinch via Pointer Events. The dot-grid lives
   on #world (not here) so it scales/pans with the world. */
.canvas-host {
  position: absolute; inset: 0; width: 100%; height: 100%;
  border: none; border-radius: 0;
  background: var(--bg-1); overflow: hidden;
  touch-action: none;
  cursor: grab;
}
.canvas-host.is-panning { cursor: grabbing; }
.canvas-host:focus { outline: none; }
.canvas-host:focus-visible { outline: 1.5px solid var(--accent); outline-offset: -2px; }
/* #world — the single CSS-transformed layer. transform set by JS each frame;
   transform-origin 0 0 so world px map linearly; will-change:transform for GPU.
   The dot-grid is a repeating radial-gradient background here, so it pans AND
   scales with the world (background-position + background-size driven by JS). */
#world {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  transform-origin: 0 0; transform: translate(0px,0px) scale(1);
  will-change: transform;
}
/* dot-grid: a tiled radial-gradient on #world. JS keeps its tile size at the
   base world spacing (26px) so it reads as an infinite grid that scales with K.
   A huge fixed background box behind everything carries the pattern. */
#world .grid-bg {
  position: absolute; left: -8000px; top: -8000px; width: 16000px; height: 16000px;
  pointer-events: none;
  background-image: radial-gradient(var(--border-strong) 1.2px, transparent 1.3px);
  background-size: 26px 26px;
  background-position: 0 0;
  opacity: .5;
}
.wire-svg { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.wire-svg .map-wire, .wire-svg .flow-pulse, .wire-svg .guard-checkpoint { pointer-events: auto; }
.node-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; }

/* band captions — WORLD-SPACE SVG <text> under #cam (they pan/zoom WITH the
   nodes so they never desync). Quiet, uppercase, tracked; sit above each band. */
.band-labels { pointer-events: none; }
.band-label {
  fill: var(--muted);
  font-family: var(--sans);
  font-size: 13px; font-weight: 600; letter-spacing: 1.6px;
  text-transform: uppercase; text-anchor: middle;
  transition: opacity .5s var(--ease-fade);
}
body.pd-enter .band-label { opacity: 0; animation: enter-fade .8s var(--ease-fade) 2.1s forwards; }

/* a quiet flow caption (the UserFlow sentence) appears on node/flow focus */
.flow-caption {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 5; max-width: min(80%, 560px);
  background: var(--bg); border: 1px solid var(--border); border-radius: 999px;
  box-shadow: var(--elevation);
  font-size: 13px; color: var(--fg-dim); padding: 8px 16px; text-align: center;
  pointer-events: none;
  animation: caption-in .2s var(--ease-out);
}
.flow-caption strong { color: var(--fg); font-weight: 600; }
@keyframes caption-in { from { opacity: 0; transform: translateX(-50%) translateY(4px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

/* ── THE GUIDED TOUR PLAYER ──────────────────────────────────────────────────
   A floating layer over the canvas. The caption bar sits bottom-center and is
   generous + readable; the control dock sits just below it. The shot card
   floats over the canvas to show the real landing/login screenshots large.
   Everything is pointer-events:none on the container so the canvas underneath
   still pans/zooms; the interactive children opt back in. */
.tour-layer { position: absolute; inset: 0; z-index: 7; pointer-events: none; }
.tour-layer[hidden] { display: none !important; }

/* the big friendly screenshot card — the opening beats literally show theVault's
   real landing + login pages, framed like a browser snapshot. */
.tour-shot {
  position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%);
  margin: 0; z-index: 6; pointer-events: none;
  width: min(560px, 78vw); max-height: 62vh;
  background: var(--bg-1); border: 1px solid var(--border-strong);
  border-radius: 14px; box-shadow: var(--elevation); padding: 10px;
  animation: tour-shot-in .42s var(--ease-out);
}
.tour-shot[hidden] { display: none !important; }
.tour-shot::before {
  content: ''; position: absolute; left: 12px; top: -1px; height: 8px; width: 38px;
  border-radius: 0 0 6px 6px; background: var(--bg-2); border: 1px solid var(--border);
  border-top: none;
}
.tour-shot-img {
  display: block; width: 100%; height: auto; max-height: calc(62vh - 24px);
  object-fit: contain; border-radius: 8px; background: var(--bg-2);
}
@keyframes tour-shot-in { from { opacity: 0; transform: translate(-50%, -46%) scale(.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }

/* caption bar — bottom-center, floating, readable, generous plain text. */
.tour-caption {
  position: absolute; left: 50%; bottom: 118px; transform: translateX(-50%);
  z-index: 8; pointer-events: auto; box-sizing: border-box;
  width: min(720px, calc(100% - 40px)); text-align: center;
  background: var(--bg-1); border: 1px solid var(--border);
  border-radius: 16px; box-shadow: var(--elevation);
  padding: 18px 24px; animation: tour-cap-in .3s var(--ease-out);
}
.tour-caption-text {
  margin: 0; font-size: 18px; line-height: 1.5; font-weight: 500; color: var(--fg);
}
@keyframes tour-cap-in { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

/* a concern beat tints the caption bar amber/red and reveals its action button. */
.tour-caption.is-concern {
  border-color: #fcd9b6; background: #fff8f1;
}
.tour-caption.is-concern .tour-caption-text { color: #9a3412; }
/* The countdown bar fills over the autoplay interval, so "playing" looks alive
   (you can see the next step coming) instead of a dead pause. Hidden unless
   autoplay is running; reset and re-run on every beat. */
.tour-countdown { margin-top: 10px; height: 3px; border-radius: 999px; background: var(--border); overflow: hidden; opacity: 0; transition: opacity .2s ease; }
.tour-countdown.is-counting { opacity: 1; }
.tour-countdown-fill { display: block; height: 100%; width: 0; border-radius: 999px; background: var(--accent); }
.tour-countdown.is-counting .tour-countdown-fill { width: 100%; }
.tour-concern-btn {
  margin-top: 12px; appearance: none; cursor: pointer;
  font-family: var(--sans); font-size: 14px; font-weight: 600;
  color: #ffffff; background: #b45309; border: 1px solid #92400e;
  border-radius: 10px; padding: 10px 16px; min-height: 44px;
}
.tour-concern-btn[hidden] { display: none !important; }
.tour-concern-btn:hover { background: #92400e; }
.tour-concern-btn:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }

/* the control dock — primary play/pause, step row, end row. */
.tour-controls {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
  z-index: 8; pointer-events: auto; box-sizing: border-box;
  width: min(720px, calc(100% - 40px));
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.tour-play {
  appearance: none; cursor: pointer; display: inline-flex; align-items: center; gap: 10px;
  font-family: var(--sans); font-size: 16px; font-weight: 600; color: #ffffff;
  background: var(--accent); border: 1px solid var(--accent);
  border-radius: 999px; padding: 12px 26px; min-height: 48px;
  box-shadow: var(--elevation); transition: background .2s var(--ease-fade);
}
.tour-play:hover { background: #0c5f58; }
.tour-play:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.tour-play-glyph {
  width: 0; height: 0; border-style: solid;
  border-width: 7px 0 7px 12px; border-color: transparent transparent transparent #ffffff;
}
/* when playing, the glyph becomes a pause bar pair (two solid bars, no gradient) */
.tour-controls.is-playing .tour-play-glyph {
  width: 12px; height: 14px;
  border-style: solid; border-color: #ffffff;
  border-width: 0; border-left-width: 4px; border-right-width: 4px;
  box-sizing: border-box; background: transparent;
}
.tour-steprow {
  display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap;
}
.tour-step-btn {
  appearance: none; cursor: pointer; font-family: var(--sans); font-size: 14px; font-weight: 600;
  color: var(--fg); background: var(--bg-1); border: 1px solid var(--border-strong);
  border-radius: 10px; padding: 10px 16px; min-height: 44px; box-shadow: var(--elevation);
}
.tour-step-btn:hover { background: var(--bg-2); color: var(--accent); }
.tour-step-btn:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.tour-step-btn:disabled { opacity: .4; cursor: default; }
/* on the LAST beat the Next button becomes a confident, filled "Close" — the
   accent fill signals "this ends the tour", never a greyed dead control. */
.tour-step-btn.is-close { background: var(--accent); color: #fff; border-color: var(--accent); }
.tour-step-btn.is-close:hover { background: var(--accent); color: #fff; filter: brightness(1.08); }
.tour-progress { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 96px; }
.tour-progress-text { font-size: 12px; color: var(--muted); font-weight: 500; }
.tour-dots { display: flex; gap: 5px; }
.tour-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--border-strong);
  transition: background .25s var(--ease-fade), transform .25s var(--ease-fade);
}
.tour-dot.is-seen { background: var(--accent); }
.tour-dot.is-current { background: var(--accent); transform: scale(1.5); }
.tour-endrow { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.tour-quiet-btn {
  appearance: none; cursor: pointer; font-family: var(--sans); font-size: 13px; font-weight: 500;
  color: var(--muted); background: transparent; border: none; border-radius: 8px;
  padding: 8px 10px; min-height: 36px; text-decoration: underline; text-underline-offset: 3px;
}
.tour-quiet-btn:hover { color: var(--accent); }
.tour-quiet-btn:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.tour-quiet-btn[hidden] { display: none !important; }

/* TOUR-MODE node/edge visibility: un-revealed nodes/edges are hidden (opacity
   + pointer-events off) so the map literally grows. Layout/positions are kept
   stable — we only toggle opacity, never remove. The reveal class restores it
   with the spring settle so it looks drawn. */
body.tour-active #node-layer .cn-host.tour-hidden,
body.tour-active #wire-layer .tour-hidden { opacity: 0; pointer-events: none; }
body.tour-active #node-layer .cn-host.tour-shown { opacity: 1; }
.cn-host.tour-reveal { animation: cn-settle .5s var(--ease-spring); }
/* spotlight a highlighted node without dimming the rest */
.cn-host.tour-spot .sys-node {
  border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), var(--elevation);
}

/* CLAIM-CHECK BADGES — a small corner glyph on each node chip. ✓ = built and
   found in your code; ⚠ = referenced by a concern (something to check). Subtle. */
.canvas-node.sys-node { position: relative; }
.sys-claim {
  position: absolute; top: -6px; right: -6px; width: 17px; height: 17px;
  border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; line-height: 1; border: 1px solid var(--bg-1);
  pointer-events: auto;
}
.sys-claim.claim-ok { background: var(--accent-soft); color: #047857; }
.sys-claim.claim-warn { background: #fef3c7; color: #b45309; }

@media (prefers-reduced-motion: reduce) {
  .tour-shot, .tour-caption, .cn-host.tour-reveal { animation: none !important; }
}

@media (max-width: 480px) {
  .tour-caption { bottom: 132px; padding: 14px 16px; width: calc(100% - 24px); }
  .tour-caption-text { font-size: 15px; }
  .tour-controls { bottom: 14px; width: calc(100% - 24px); gap: 8px; }
  .tour-play { font-size: 15px; padding: 11px 20px; }
  .tour-step-btn { padding: 9px 12px; font-size: 13px; }
  .tour-shot { width: 88vw; top: 40%; }
}

.canvas-empty {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  text-align: center; color: var(--muted); font-size: 15px; line-height: 1.6;
  max-width: 40ch; margin: 0; pointer-events: none;
}

/* minimal zoom + fit controls, bottom-right; the one soft tinted shadow */
.canvas-controls {
  position: absolute; right: 14px; bottom: 14px; z-index: 5;
  display: flex; flex-direction: column; gap: 6px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 6px; box-shadow: var(--elevation);
}
.canvas-ctl {
  appearance: none; cursor: pointer; min-width: 44px; min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--fg-dim);
  border: none; border-radius: 7px; padding: 0;
  transition: color .16s var(--ease-soft), background .16s var(--ease-fade);
}
.canvas-ctl:hover { color: var(--accent); background: var(--bg-2); }
.canvas-ctl svg { width: 16px; height: 16px; display: block; }

/* "What am I looking at?" — the plain-language key, bottom-left. */
.map-key { position: absolute; left: 14px; bottom: 14px; z-index: 6; }
body.tour-active .map-key { display: none; }
.map-key-btn {
  appearance: none; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
  color: var(--fg-dim); background: var(--bg); border: 1px solid var(--border);
  border-radius: 999px; padding: 8px 14px; min-height: 36px; box-shadow: var(--elevation);
  transition: color .16s var(--ease-soft), border-color .16s var(--ease-soft);
}
.map-key-btn:hover, .map-key-btn[aria-expanded="true"] { color: var(--accent); border-color: var(--border-strong); }
.map-key-panel {
  position: absolute; left: 0; bottom: 44px; width: min(330px, calc(100vw - 28px));
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--elevation); padding: 14px 16px;
}
.map-key-row { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 10px; font-size: 13px; line-height: 1.45; color: var(--fg-dim); }
.mk-swatch { flex: 0 0 auto; width: 26px; height: 18px; margin-top: 2px; display: inline-flex; align-items: center; justify-content: center; }
.mk-card { border: 1px solid var(--border-strong); border-radius: 5px; background: var(--bg-2); }
.mk-wire { border-top: 2px solid var(--accent); height: 0; align-self: center; }
.mk-lock svg { width: 14px; height: 14px; color: var(--fg-dim); display: block; }
.mk-dashed { border-top: 2px dashed var(--border-strong); height: 0; align-self: center; }
.map-key-tip { margin: 2px 0 0; font-size: 12px; color: var(--muted); }

/* tiny breathing "building…" indicator — sits above the map key's button */
.build-indicator {
  position: absolute; left: 14px; bottom: 62px; z-index: 5;
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 999px;
  box-shadow: var(--elevation); padding: 6px 12px;
  font-size: 12px; color: var(--accent); font-weight: 600;
}
.build-indicator .bi-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--accent); animation: bi-breathe 1.6s var(--ease-soft) infinite; }
@keyframes bi-breathe { 0%,100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }

/* ── NODES — rounded-rect chips, hairline by default, faint surface ──
   Absolutely-positioned HTML in #node-layer (NOT SVG-embedded). The .cn-host
   wrapper carries the WORLD position (left/top/width in world px) and is what
   the user drags; the inner <button>.canvas-node fills it. Ink only (verdict
   color stays on the status strip). A small inline-SVG type glyph + plain name.
   Page=window, door=arch, record=database lines, ghost=wavy. */
.cn-host {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  transition: opacity .3s var(--ease-fade);
}
.cn-host.is-dragging { cursor: grabbing; z-index: 3; }
.canvas-node {
  width: 100%; height: 100%;
  appearance: none; text-align: left; cursor: inherit;
  background: var(--bg-1); color: var(--fg);
  border: 1px solid var(--border); border-radius: 9px;
  padding: 0 12px; box-sizing: border-box;
  font-family: var(--sans); font-size: 13px; font-weight: 500; letter-spacing: -.005em;
  display: flex; align-items: center; gap: 9px;
  transition: border-color .2s var(--ease-soft), background .2s var(--ease-fade), opacity .25s var(--ease-fade), box-shadow .2s var(--ease-soft);
}
.canvas-node .cn-glyph { flex: 0 0 auto; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); transition: color .2s var(--ease-soft); }
.canvas-node .cn-glyph svg { width: 16px; height: 16px; display: block; }
/* WRAP labels (up to 2 lines) instead of truncating with an ellipsis — so
   "the login door (/api/login)" and "saved in your User records" are never cut
   off. The chip is tall enough (NODE_H) for two comfortable lines. */
.canvas-node .cn-name {
  min-width: 0; line-height: 1.2;
  overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow-wrap: anywhere; word-break: break-word;
}
.canvas-node:hover { border-color: var(--border-strong); background: var(--bg); }
.canvas-node:hover .cn-glyph { color: var(--fg-dim); }
.canvas-node:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 2px; }
.canvas-node.node-ghost { color: var(--muted); cursor: default; font-style: italic; border-style: dashed; }
.canvas-node.node-ghost .cn-glyph { color: var(--border-strong); }
.cn-host.node-ghost-host { cursor: default; }
/* focus mode: the focused node stays ink+accent border; the rest dim. Uses an
   accent box-shadow ring too, so it still reads on a branded card whose
   border-color is set inline to the brand primary. */
.cn-host.is-dim { opacity: .28; }
.cn-host.is-focus .canvas-node { border-color: var(--accent); box-shadow: 0 0 0 1.5px var(--accent); }
.cn-host.is-focus .canvas-node .cn-glyph { color: var(--accent); }
/* spring-in for entrance + live new nodes. The .cn-host is absolutely
   positioned (left/top in world px) AND animates a scale/opacity transform —
   these compose fine on a normal HTML element (unlike SVG-embedded HTML). */
.cn-host.cn-rise { opacity: 0; animation: cn-settle .46s var(--ease-spring) forwards; }
@keyframes cn-settle { from { opacity: 0; transform: scale(.92) translateY(6px); } to { opacity: 1; transform: none; } }
/* removed nodes fade + shrink out before being pruned */
.cn-host.cn-leave { pointer-events: none; animation: cn-leave .34s var(--ease-fade) forwards; }
@keyframes cn-leave { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.92) translateY(6px); } }
/* one-shot "just built" accent RING — an HTML box-shadow pulse on the host that
   expands and fades (the node layer is HTML now, so no SVG ring element). */
.cn-host.just-built-ring { animation: ring-pop 1s var(--ease-out); }
@keyframes ring-pop {
  0% { box-shadow: 0 0 0 0 var(--accent); }
  70% { box-shadow: 0 0 0 8px rgba(15,118,110,0); }
  100% { box-shadow: 0 0 0 8px rgba(15,118,110,0); }
}

/* ── guard CHECKPOINT — one lock marker on the protected wire's midpoint ──
   Lives in the world (under #cam) so it tracks the wire; keyboard-focusable,
   tooltip via aria + the title element. Collision-safe placement in JS. */
.guard-checkpoint { cursor: pointer; }
.guard-checkpoint .gc-bg { fill: var(--bg); stroke: var(--border-strong); stroke-width: 1.25; transition: stroke .2s var(--ease-soft), fill .2s var(--ease-fade); }
.guard-checkpoint .gc-icon { stroke: var(--muted); fill: none; transition: stroke .2s var(--ease-soft); }
.guard-checkpoint:hover .gc-bg, .guard-checkpoint:focus-visible .gc-bg { stroke: var(--accent); fill: var(--accent-soft); }
.guard-checkpoint:hover .gc-icon, .guard-checkpoint:focus-visible .gc-icon { stroke: var(--accent); }
.guard-checkpoint:focus-visible { outline: none; }
.guard-checkpoint:focus-visible .gc-bg { stroke-width: 2; }
.gc-anim.gc-rise { opacity: 0; animation: cn-settle .42s var(--ease-spring) .2s forwards; transform-box: fill-box; transform-origin: center; }

/* ── WIRES — smooth cubic-bezier paths; the connection is the hero ── */
.map-wire { fill: none; stroke: var(--accent); stroke-width: 1.7; opacity: .5; transition: stroke-width .2s var(--ease-soft), opacity .25s var(--ease-fade); }
.map-wire.wire-untraced { stroke: var(--border-strong); stroke-dasharray: 4 5; stroke-width: 1.6; opacity: .6; }
.map-wire.wire-hi { stroke-width: 2.4; opacity: 1; }
.map-wire.wire-dim { opacity: .1; }
.map-wire.wire-draw { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: wire-draw .9s var(--ease-out) forwards; }
.map-wire.wire-untraced.wire-draw { animation: wire-draw-dash .9s var(--ease-out) forwards; }
@keyframes wire-draw { to { stroke-dashoffset: 0; } }
@keyframes wire-draw-dash { from { stroke-dashoffset: var(--len); } to { stroke-dashoffset: 0; } }

/* ── THE HERO MOTION — one perpetual flowing pulse per TRACED wire ──
   A short bright dash travels left→right along the wire, looping ~2.2s, with a
   per-wire staggered phase. GPU-cheap: only stroke-dashoffset animates.
   Untraced/dashed wires get NO pulse (honesty). */
.flow-pulse { fill: none; stroke: var(--accent); stroke-width: 2.4; stroke-linecap: round; opacity: .9; pointer-events: none;
  stroke-dasharray: var(--seg, 14) var(--gap, 999);
  stroke-dashoffset: var(--len, 600);
  animation: flow-pulse var(--dur, 2.2s) linear var(--phase, 0s) infinite;
}
@keyframes flow-pulse { from { stroke-dashoffset: var(--len, 600); } to { stroke-dashoffset: 0; } }
.flow-pulse.pulse-hi { stroke-width: 3; opacity: 1; animation-duration: var(--dur-fast, 1.1s); }
.flow-pulse.pulse-dim { opacity: 0; }

/* ── NAVIGATION connectors — a light "go to" arrow between pages. Distinct
   from the teal data-flow wires: muted ink, thin, a subtle arrowhead, and NO
   flowing pulse (navigation is a link, not data movement). */
.map-wire.wire-nav { stroke: var(--muted); stroke-width: 1.3; opacity: .55; }
.map-wire.wire-nav.wire-untraced { stroke: var(--border-strong); stroke-dasharray: 4 5; opacity: .55; }
.map-wire.wire-nav.wire-hi { stroke: var(--fg-dim); stroke-width: 1.9; opacity: 1; }
/* page → form tether: a faint, short hairline (the form belongs to this page). */
.map-wire.wire-owns { stroke: var(--border-strong); stroke-width: 1.2; opacity: .4; }
.map-wire.wire-owns.wire-hi { opacity: .8; }
#nav-arrow path { stroke: var(--muted); }

/* form nodes: a faint accent-tinted surface so they read as input, distinct
   from plain pages but still calm. */
.canvas-node.cn-band-form { background: var(--accent-soft); }
.canvas-node.cn-band-form .cn-glyph { color: var(--accent); }

/* ── ENTRANCE SEQUENCE — the choreographed first open ───────────────────────
   The body carries .pd-enter while the reveal plays; JS removes it (adding
   .pd-settled) once done, or instantly on reduced-motion / a skip gesture.
   Beat 1 (0–600ms): wordmark sets, essence fades in. Generous emptiness.
   Beat 2 (600ms+): JOURNEY LANES reveal top-to-bottom (JS-staggered): each
                    lane's title rises, then its wire draws itself left→right,
                    then the pulse starts. The pages shelf fades in LAST.
   Beat 3: status strip fades in last, understated. Any key/click skips. */

/* Beat 1 — wordmark quiet, essence delayed fade-in */
body.pd-enter .brand-name { opacity: 0; animation: enter-fade .7s var(--ease-fade) .05s forwards; }
body.pd-enter .essence { opacity: 0; animation: enter-rise .8s var(--ease-out) .35s forwards; }
body.pd-enter .menu-btn { opacity: 0; animation: enter-fade .6s var(--ease-fade) 1.5s forwards; }

/* Beat 3 — the status strip fades in last, understated */
body.pd-enter .status-strip { opacity: 0; animation: enter-fade .8s var(--ease-fade) 2.1s forwards; }

@keyframes enter-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes enter-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* QUICK entrance for return visits (body.pd-quick): one gentle 1-beat fade,
   not the full choreographed sequence — so it never gets tiresome. */
body.pd-quick .view-map { opacity: 0; animation: enter-fade .5s var(--ease-fade) forwards; }
body.pd-quick .status-strip { opacity: 0; animation: enter-fade .5s var(--ease-fade) .15s forwards; }

/* ── Menu sheet ─────────────────────────────────────────────────────────── */
.menu-overlay { display: grid; place-items: stretch; background: rgba(28,25,23,.32); animation: backdrop .2s ease; }
.menu-card { background: var(--bg); border-left: 1px solid var(--border-strong); margin-left: auto; width: min(360px, 100%); height: 100%; overflow-y: auto; padding: 22px; box-shadow: var(--elevation); animation: sheet-in .26s ease; }
.menu-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.menu-head h2 { font-size: 18px; margin: 0; }
.menu-list { display: flex; flex-direction: column; gap: 2px; }
.menu-item {
  appearance: none; cursor: pointer; text-align: left;
  background: transparent; color: var(--fg); border: none; border-radius: 8px;
  font-family: var(--sans); font-size: 15px; font-weight: 600; padding: 12px 12px; min-height: 48px;
  display: flex; flex-direction: column; gap: 2px;
}
.menu-item:hover { background: var(--bg-2); color: var(--accent); }
.menu-sub { font-size: 12px; font-weight: 400; color: var(--muted); }
.menu-item:hover .menu-sub { color: var(--accent); }
.menu-depth-wrap { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
.menu-depth-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 8px; }

/* Depth visibility: classes toggled on <body> by JS.
   Depth mapping: map = SVG flow map (home) · plain = flow strips · technical = tree+mermaid. */
body[data-depth="plain"] .live-grid { display: none; }
body[data-depth="plain"] #report-diagram-wrap { display: none; }
/* The plain legend belonged to the old Map=Mermaid level; never show it now. */
.plain-legend { display: none; }
body[data-depth="technical"] .flows-host { display: none; }
body[data-depth="plain"] .flows-host { display: block; }
body[data-depth="technical"] #tech-footer { display: flex; }
body:not([data-depth="technical"]) #tech-footer { display: none; }

@media (max-width: 760px) {
  .live-grid { grid-template-columns: 1fr; }
  .badge { display: none; }
  .glossary-sheet { animation: sheet-up .28s ease; }
  @keyframes sheet-up { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
}
@media (max-width: 480px) {
  .main { padding: 14px; }
  .view-map { padding: 0; }
  .topbar { gap: 10px; padding: 10px 14px; }
  .header-right { gap: 8px; }
  /* the infinite canvas stays usable at 480px: one-finger pan, two-finger
     pinch-zoom (touch-action:none above), controls reachable bottom-right. */
  .band-label { font-size: 11px; letter-spacing: 1px; }
  .flow-caption { font-size: 12px; padding: 7px 12px; max-width: 90%; }
  .menu-card { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .view-anim, .stagger, .coach, .conn-banner, .export-menu,
  .learn-card, .glossary-sheet, .shortcuts-card, .learn-pop, .glossary-panel, .shortcuts,
  .menu-card, .cn-host.cn-rise, .cn-host.cn-leave, .gc-anim.gc-rise,
  .cn-host.just-built-ring, .build-indicator .bi-dot, .band-label { animation: none !important; }
  .stagger, .cn-host.cn-rise, .gc-anim.gc-rise, .band-label { opacity: 1 !important; transform: none !important; }
  /* the dot-grid stays static under reduced motion (it still pans, but no animated reveal) */
  .map-wire.wire-draw { stroke-dasharray: none !important; stroke-dashoffset: 0 !important; animation: none !important; }
  .map-wire.wire-untraced.wire-draw { stroke-dasharray: 4 5 !important; }
  /* no perpetual pulses under reduced motion — the wires stay calm and still */
  .flow-pulse { animation: none !important; display: none !important; }
  .cn-host.just-built-ring { animation: none !important; box-shadow: none !important; }
  .flow-caption { animation: none !important; }
  .ring-fill { transition: none !important; }
  .vlabel .draw { animation: none !important; stroke-dashoffset: 0 !important; }
  /* ENTRANCE: reduced-motion jumps straight to the final state, no choreography */
  body.pd-enter .brand-name, body.pd-enter .essence, body.pd-enter .menu-btn,
  body.pd-enter .status-strip, body.pd-enter .band-label,
  body.pd-quick .view-map, body.pd-quick .status-strip { animation: none !important; opacity: 1 !important; transform: none !important; }
  * { transition: none !important; }
}

/* ===========================================================================
   THE LAYERED SYSTEM MAP — the full live breakdown for non-technical people.
   Reuses the same infinite-canvas machinery (#world CSS transform, draggable
   HTML nodes, SVG wires, fitAll, focus mode) but renders SYSTEM nodes: a
   plain label, a muted technical identity, a provider badge, a kind glyph,
   and (for databases) an expandable cluster of table chips with lock flags.
   Five left-to-right LAYER columns with screen-pinned captions. Ink only by
   default; verdict/severity color is reserved for the concerns panel.
   =========================================================================== */

/* screen-pinned column captions — quiet, fixed across the top of the canvas so
   a non-coder always knows which band is which even after panning. They float
   ABOVE the canvas (like the header) and never reflow it. */
.sys-captions { position: absolute; left: 0; right: 0; top: 0; height: 0; z-index: 4; pointer-events: none; }
.sys-caption {
  position: absolute; left: 16px; top: 0;
  font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--muted); white-space: nowrap; text-align: left;
  transition: opacity .5s var(--ease-fade);
}
.sys-caption .sys-caption-sub { display: block; font-size: 10px; letter-spacing: .6px; text-transform: none; color: var(--border-strong); font-weight: 500; }

/* ── SYSTEM NODE chip — a card BODY (glyph + plain label + muted technical)
   over a full-width brand BAR strip at the bottom. The bar background is the
   provider's brand primary, so the map is colorful and you tell Claude vs Neon
   vs Stripe at a glance. External-service + data nodes (.sys-branded) also tint
   the WHOLE card to the org's theme. ── */
.canvas-node.sys-node {
  flex-direction: column; align-items: stretch; justify-content: flex-start;
  gap: 0; padding: 0; text-align: left; overflow: hidden;
}
.sys-node .sys-body {
  flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; justify-content: center;
  gap: 3px; padding: 7px 11px 6px;
}
.sys-node .sys-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sys-node .cn-glyph { flex: 0 0 auto; }
.sys-node .sys-label {
  min-width: 0; flex: 1; font-weight: 600; font-size: 13px; line-height: 1.2;
  overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow-wrap: anywhere; word-break: break-word;
}
.sys-node .sys-tech {
  font-family: var(--mono); font-size: 10.5px; color: var(--muted);
  line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* the BRAND BAR — a full-width strip across the bottom of every node, attached
   under the card and part of it (drags/moves with the node). Background = the
   provider brand primary; text = onPrimary (≈4.5:1). A small brand dot leads. */
.sys-node .sys-brandbar {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
  height: 19px; padding: 0 10px; line-height: 1;
  font-size: 10.5px; font-weight: 600; letter-spacing: .01em;
  border-top: 1px solid rgba(0,0,0,.06);
}
.sys-node .sys-brand-dot {
  width: 6px; height: 6px; border-radius: 999px; flex: 0 0 auto; opacity: .9;
}
.sys-node .sys-brand-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* a fully-branded card (external services + data stores): tint bg + a 1.5px
   brand-primary border so the whole node reads as that org's color/theme. */
.canvas-node.sys-node.sys-branded { border-width: 1.5px; }

/* the side-panel provider chip echoes the node's brand bar (brand primary bg). */
.prov-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; letter-spacing: .01em;
  border-radius: 999px; padding: 2px 9px 2px 7px; line-height: 1.5; white-space: nowrap;
}
.prov-chip-dot { width: 6px; height: 6px; border-radius: 999px; flex: 0 0 auto; opacity: .9; }

/* a small "not running yet" flag on intended (coded-but-not-live) nodes */
.sys-flag {
  font-size: 9.5px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase;
  color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 4px;
  padding: 1px 5px; line-height: 1.5; white-space: nowrap;
}

/* the cron rail nodes are smaller and read as triggers above the servers col */
.canvas-node.sys-kind-cron { background: var(--bg-2); }

/* ── DATABASE CLUSTER — compact table chips attached to the database node,
   revealed on expand (progressive disclosure). Lives INSIDE #node-layer as an
   absolutely-positioned panel anchored under its database node (world px), so
   it pans/zooms/drags with the world. ── */
.sys-cluster {
  position: absolute; box-sizing: border-box;
  background: var(--bg-1); border: 1px solid var(--border);
  border-radius: 9px; padding: 8px;
  display: flex; flex-direction: column; gap: 4px;
  box-shadow: var(--elevation);
}
.sys-cluster .sys-cluster-head {
  font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); margin: 0 2px 2px;
}
.sys-chip {
  appearance: none; cursor: pointer; text-align: left;
  display: flex; align-items: center; gap: 6px;
  background: var(--bg-2); color: var(--fg-dim);
  border: 1px solid var(--border); border-radius: 6px;
  font-family: var(--sans); font-size: 11px; font-weight: 500;
  padding: 5px 8px; min-height: 30px; line-height: 1.2;
  transition: border-color .16s var(--ease-soft), color .16s var(--ease-soft);
}
.sys-chip:hover { border-color: var(--accent); color: var(--accent); }
.sys-chip:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 2px; }
.sys-chip .sys-chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.sys-chip .sys-chip-glyph { flex: 0 0 auto; width: 13px; height: 13px; color: var(--muted); display: inline-flex; }
.sys-chip .sys-chip-glyph svg { width: 13px; height: 13px; display: block; }
/* a sensitive table gets a small lock glyph + an amber tint on the lock only */
.sys-chip.sys-sensitive .sys-lock { color: var(--amber); flex: 0 0 auto; width: 12px; height: 12px; display: inline-flex; }
.sys-chip.sys-sensitive .sys-lock svg { width: 12px; height: 12px; display: block; }
.sys-cluster.cn-rise { opacity: 0; animation: cn-settle .4s var(--ease-spring) forwards; }

/* the database node shows a small "expand" affordance count when collapsed */
.sys-node .sys-expand {
  font-size: 10px; color: var(--accent); font-weight: 600; letter-spacing: .02em;
  display: inline-flex; align-items: center; gap: 4px;
}
.sys-node .sys-expand svg { width: 11px; height: 11px; }

/* external-call wires read lighter than the main data flow (server→external) */
.map-wire.wire-external { stroke: var(--muted); stroke-width: 1.4; opacity: .4; stroke-dasharray: 1 0; }
.map-wire.wire-external.wire-hi { stroke: var(--fg-dim); stroke-width: 2; opacity: .95; }
/* a BRANDED external wire: the inline stroke is the external org's brand primary
   (set in JS). Make it clearly visible (stronger than the faint default) so a
   line to Claude reads as Anthropic-coral, a line to a payments service violet. */
.map-wire.wire-branded { stroke-width: 1.8; opacity: .72; }
.map-wire.wire-branded.wire-hi { stroke-width: 2.6; opacity: 1; }
/* a branded flow pulse uses the same brand stroke (set inline in JS). */
.flow-pulse.pulse-branded { opacity: .95; }
/* intended (coded-but-not-live) edges: dashed grey, no pulse */
.map-wire.wire-intended { stroke: var(--border-strong); stroke-width: 1.5; opacity: .55; stroke-dasharray: 5 5; }
.map-wire.wire-intended.wire-hi { stroke: var(--muted); opacity: .9; }

/* a short edge label sits on the wire midpoint (world space SVG text).
   HIDDEN by default — the wire's function/route name is noise on a dense map.
   It only appears when you hover the node it belongs to (focusSystemNode adds
   label-hi to that node's edges, which fades the label in). */
.wire-label {
  fill: var(--muted); font-family: var(--sans); font-size: 10px; font-weight: 500;
  text-anchor: middle; pointer-events: none; opacity: 0;
  paint-order: stroke; stroke: var(--bg-1); stroke-width: 3px; stroke-linejoin: round;
  transition: opacity .2s var(--ease-fade);
}
.wire-label.label-dim { opacity: 0; }
.wire-label.label-hi { opacity: 1; fill: var(--fg-dim); font-weight: 600; }

/* ── system-node side panel (reuses the learn popover shell, extra rows) ── */
.sys-panel-tech { font-family: var(--mono); font-size: 12px; color: var(--muted); margin: 0 0 4px; }
.sys-panel-host { font-size: 13px; color: var(--fg-dim); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── node relationships ("how it connects") in the detail panel ── */
.learn-rels { margin: 0 0 12px; }
.learn-rels[hidden] { display: none !important; }
.rel-group { margin-top: 10px; }
.rel-head {
  font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
  color: var(--muted); margin: 0 0 5px;
}
.rel-row {
  display: flex; align-items: flex-start; gap: 9px; width: 100%; text-align: left;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 7px;
  padding: 8px 10px; margin: 0 0 5px; cursor: pointer; color: inherit;
  transition: border-color .15s var(--ease-soft), background .15s var(--ease-soft);
}
.rel-row:hover { border-color: var(--border-strong); background: var(--bg-1); }
.rel-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rel-arrow { color: var(--accent); font-weight: 700; line-height: 1.4; flex: 0 0 auto; font-size: 14px; }
.rel-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rel-label { font-size: 13px; font-weight: 600; color: var(--fg); }
.rel-flow { font-size: 11.5px; color: var(--muted); font-family: var(--mono); word-break: break-word; }
.rel-planned {
  font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: var(--muted); border: 1px solid var(--border-strong); border-radius: 4px;
  padding: 0 4px; margin-left: 6px; vertical-align: middle;
}
.sys-panel-sensitive {
  background: var(--amber-bg); border: 1px solid var(--amber); border-radius: 6px;
  padding: 8px 10px; margin: 0 0 10px; font-size: 12.5px; color: var(--amber);
}
.sys-panel-sensitive strong { color: var(--amber); }

/* ── "How it works" panel — the dataFlows narrative ── */
.howitworks-list { display: grid; gap: 0; }
.hiw-story { padding: 16px 0; border-bottom: 1px solid var(--border); }
.hiw-story:last-child { border-bottom: none; }
.hiw-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 999px; background: var(--accent-soft);
  color: var(--accent); font-size: 12px; font-weight: 700; margin-right: 8px; flex: 0 0 auto;
}
.hiw-title { font-weight: 600; font-size: 15px; margin: 0 0 6px; display: flex; align-items: center; }
.hiw-plain { color: var(--fg-dim); margin: 0; font-size: 14px; line-height: 1.6; }
.hiw-intro { color: var(--fg-dim); font-size: 14px; margin: 0 0 18px; }

/* ── "What looks off" panel — concerns. The ONE place severity color appears
   prominently (high=red, med=amber, low=grey). ── */
.concerns-list { display: grid; gap: 0; }
.concern { padding: 16px 0; border-bottom: 1px solid var(--border); }
.concern:last-child { border-bottom: none; }
.concern-high { padding-left: 12px; border-left: 3px solid var(--red); }
.concern-med { padding-left: 12px; border-left: 3px solid var(--amber); }
.concern-low { padding-left: 12px; border-left: 3px solid var(--border-strong); }
.concern-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.sev-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; }
.sev-high { background: var(--red); }
.sev-med { background: var(--amber); }
.sev-low { background: var(--border-strong); }
.concern-label { font-weight: 600; }
.concern-high .concern-label { color: var(--red); }
.concern-med .concern-label { color: var(--amber); }
.concern-detail { color: var(--fg-dim); font-size: 13.5px; margin: 7px 0 0; line-height: 1.55; }
.concern-intro { color: var(--fg-dim); font-size: 14px; margin: 0 0 18px; }

/* the header affordance badge: "N things to check" with a red count */
.concern-count {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--red);
}
.concern-count .cc-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--red); }
.menu-item .menu-badge {
  margin-left: auto; align-self: flex-start;
  font-size: 11px; font-weight: 700; color: #fff; background: var(--red);
  border-radius: 999px; padding: 1px 8px; line-height: 1.5;
}
.menu-item { flex-direction: row; align-items: center; }
.menu-item .menu-sub { flex-direction: column; }

/* the system map "what" one-liner as a quiet header subtitle */
.sys-what { font-size: 13px; color: var(--muted); font-weight: 400; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46ch; }

@media (max-width: 480px) {
  .sys-caption { font-size: 10px; letter-spacing: .8px; }
  .sys-caption .sys-caption-sub { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sys-cluster.cn-rise { animation: none !important; opacity: 1 !important; }
  .sys-caption { transition: none !important; }
}
`;

// ---------------------------------------------------------------------------
// Client script. Authored as a template string returned verbatim into <script>.
// Kept dependency-free; talks only to the same-origin tokened API.
// ---------------------------------------------------------------------------
function appScript(): string {
  return String.raw`
(function () {
  "use strict";
  var TOKEN = window.__PD_TOKEN__;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function api(path, opts) {
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    var url = path + sep + 't=' + encodeURIComponent(TOKEN);
    var o = opts || {};
    o.headers = o.headers || {};
    o.headers['X-PD-Token'] = TOKEN;
    return fetch(url, o);
  }
  function getJSON(path) {
    return api(path).then(function (r) {
      if (r.status === 404) return r.json().then(function (j) { return { __missing: true, data: j }; }, function () { return { __missing: true, data: null }; });
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // staggered fade-up: apply .stagger + delay to a node-list of items.
  function stagger(nodes) {
    if (reduceMotion) return;
    Array.prototype.forEach.call(nodes, function (el, i) {
      el.classList.add('stagger');
      el.style.animationDelay = Math.min(i * 60, 600) + 'ms';
    });
  }
  function animTab(view) {
    if (reduceMotion) return;
    var panel = document.getElementById('view-' + view);
    if (!panel) return;
    panel.classList.remove('view-anim'); void panel.offsetWidth; panel.classList.add('view-anim');
  }

  // ---- depth (progressive disclosure) ------------------------------------
  // map = SVG flow map (home) · plain = flow strips · technical = tree+mermaid.
  var depths = ['map', 'plain', 'technical'];
  var GLOSSARY = window.__PD_GLOSSARY__ || [];
  var ALLOWLIST = window.__PD_ALLOWLIST__ || [];
  // (category,predicate) → the allowlist entry whose ruleIds prove a recognizer
  // exists for this claim shape. Off-list claims are UNDETERMINED by construction.
  function allowlistEntryFor(cat, pred) {
    for (var i = 0; i < ALLOWLIST.length; i++) {
      if (ALLOWLIST[i].category === cat && ALLOWLIST[i].predicate === pred) return ALLOWLIST[i];
    }
    return null;
  }
  function conceptForStepKind(k) {
    return k === 'page' ? 'page' : k === 'action' ? 'order-ticket'
      : k === 'endpoint' ? 'endpoint' : k === 'guard' ? 'guard'
      : k === 'table' ? 'records' : null;
  }
  function conceptByKey(key) {
    for (var i = 0; i < GLOSSARY.length; i++) if (GLOSSARY[i].key === key) return GLOSSARY[i];
    return null;
  }
  var depth = 'map';
  try { var saved = localStorage.getItem('pd-depth'); if (depths.indexOf(saved) !== -1) depth = saved; } catch (e) {}
  function applyDepth(next, fromUser) {
    if (depths.indexOf(next) === -1) next = 'map';
    depth = next;
    document.body.setAttribute('data-depth', depth);
    try { localStorage.setItem('pd-depth', depth); } catch (e) {}
    maybeShowCoach();
    // Depth changes route to the level's home surface:
    //   map → the SVG map · plain → the flow strips (Live) · technical → Live tree.
    if (fromUser) {
      if (depth === 'map') show('map');
      else if (current === 'map') show('live');
      else if (current) show(current);
    }
  }

  // ---- AUDIENCE: how technical the reader is (the user picks at onboarding) --
  // This is the primary control. It drives body[data-audience] (CSS gates the
  // map's technical detail) and a sensible internal depth. Three levels:
  //   simple    → plainest map, no file paths, friendly captions
  //   guided    → the map + tap-to-learn (default)
  //   technical → file:line receipts + raw identifiers on the map; tech surfaces
  var AUDIENCES = ['simple', 'guided', 'technical'];
  var AUD_TO_DEPTH = { simple: 'map', guided: 'map', technical: 'technical' };
  var audience = 'guided';
  try { var sa = localStorage.getItem('pd-audience'); if (AUDIENCES.indexOf(sa) !== -1) audience = sa; } catch (e) {}
  function applyAudience(next, fromUser) {
    if (AUDIENCES.indexOf(next) === -1) next = 'guided';
    audience = next;
    document.body.setAttribute('data-audience', audience);
    try { localStorage.setItem('pd-audience', audience); } catch (e) {}
    // reflect in BOTH the menu radio and the onboarding cards
    Array.prototype.forEach.call(document.querySelectorAll('.aud-opt'), function (b) {
      var on = b.getAttribute('data-aud') === audience;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    // keep the internal depth in step, but never yank the view on first paint
    applyDepth(AUD_TO_DEPTH[audience] || 'map', false);
    // the map's plain-vs-technical detail is CSS-driven; band captions are JS,
    // so refresh them, and re-fit so bigger simple-mode cards stay in frame.
    if (current === 'map') {
      if (typeof updateSysCaptions === 'function') updateSysCaptions();
      if (fromUser && typeof fitAll === 'function') requestAnimationFrame(function () { fitAll(reduceMotion); });
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.aud-opt'), function (b) {
    b.addEventListener('click', function () { applyAudience(b.getAttribute('data-aud'), true); b.focus(); });
    b.addEventListener('keydown', function (e) {
      var i = AUDIENCES.indexOf(b.getAttribute('data-aud'));
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusAud((i + 1) % AUDIENCES.length); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusAud((i + AUDIENCES.length - 1) % AUDIENCES.length); }
    });
  });
  function focusAud(i) {
    var b = document.querySelector('.aud-opt[data-aud="' + AUDIENCES[i] + '"]');
    if (b) { applyAudience(AUDIENCES[i], true); b.focus(); }
  }
  function cycleDepth() {
    var i = AUDIENCES.indexOf(audience);
    applyAudience(AUDIENCES[(i + 1) % AUDIENCES.length], true);
  }

  // ---- ONBOARDING: first-visit "how should we explain this?" -------------
  // Shown only when the reader has not chosen an audience yet. It precedes the
  // guided tour (the tour is stashed and started once they choose), so the very
  // first thing a non-technical user sees is a plain question, not a diagram.
  var onboardingPending = false;
  function needsOnboarding() {
    try { return localStorage.getItem('pd-audience') === null; } catch (e) { return false; }
  }
  function openOnboarding(fromMenu) {
    var ov = document.getElementById('onboard');
    if (!ov) return;
    if (!fromMenu) onboardingPending = true;
    // mark the card matching the current audience as the highlighted default
    Array.prototype.forEach.call(ov.querySelectorAll('.onboard-choice'), function (b) {
      b.classList.toggle('is-default', b.getAttribute('data-aud') === audience);
    });
    openTheOverlay(ov, ov.querySelector('.onboard-choice.is-default') || ov.querySelector('.onboard-choice'));
  }
  function chooseAudience(aud) {
    applyAudience(aud, true);
    closeAllOverlays(false);
    if (onboardingPending) { onboardingPending = false; flushPendingTour(); }
  }
  (function wireOnboarding() {
    var ov = document.getElementById('onboard');
    if (!ov) return;
    Array.prototype.forEach.call(ov.querySelectorAll('.onboard-choice'), function (b) {
      b.addEventListener('click', function () { chooseAudience(b.getAttribute('data-aud')); });
    });
    var skip = ov.querySelector('.onboard-skip');
    if (skip) skip.addEventListener('click', function () { chooseAudience('guided'); });
  })();

  // ---- coach strip (first-run, Plain only, dismissible) ------------------
  var coach = document.getElementById('coach');
  function maybeShowCoach() {
    if (!coach) return;
    var dismissed = false;
    try { dismissed = localStorage.getItem('pd-coach') === '1'; } catch (e) {}
    // One-time tip, shown under the status strip while on the map home.
    coach.hidden = dismissed || depth !== 'map' || current !== 'map';
  }
  var coachX = document.getElementById('coach-dismiss');
  if (coachX) coachX.addEventListener('click', function () {
    try { localStorage.setItem('pd-coach', '1'); } catch (e) {}
    if (coach) coach.hidden = true;
  });

  // ---- "What am I looking at?" key (Map) ---------------------------------
  var mapKeyBtn = document.getElementById('map-key-btn');
  var mapKeyPanel = document.getElementById('map-key-panel');
  function setMapKey(open) {
    if (!mapKeyBtn || !mapKeyPanel) return;
    mapKeyPanel.hidden = !open;
    mapKeyBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem('pd-mapkey', open ? '1' : '0'); } catch (e) {}
  }
  if (mapKeyBtn) {
    mapKeyBtn.addEventListener('click', function () { setMapKey(mapKeyPanel.hidden); });
    var keyOpen = false;
    try { keyOpen = localStorage.getItem('pd-mapkey') === '1'; } catch (e) {}
    if (keyOpen) setMapKey(true);
  }

  // ---- view routing (no tabs — navigation comes from the menu sheet) -----
  var views = ['map', 'plan', 'live', 'report', 'history', 'howitworks', 'concerns'];
  var current = null;
  function show(view) {
    if (views.indexOf(view) === -1) view = 'map';
    current = view;
    views.forEach(function (v) {
      var panel = document.getElementById('view-' + v);
      if (panel) panel.hidden = (v !== view);
    });
    // FULL-BLEED: only the MAP view is the edge-to-edge fixed canvas. map-mode
    // flips body.overflow:hidden, floats the header/banners/badge, and lets the
    // canvas fill the viewport. Other views restore normal document scroll.
    document.body.classList.toggle('map-mode', view === 'map');
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
    animTab(view);
    maybeShowCoach();
    if (view === 'map') { loadMap(); updateBuildIndicator(); }
    else { var bi = document.getElementById('build-indicator'); if (bi) bi.hidden = true; }
    if (view === 'plan') loadPlan();
    if (view === 'live') loadLive();
    if (view === 'report') loadReport();
    if (view === 'history') loadHistory();
    if (view === 'howitworks') loadHowItWorks();
    if (view === 'concerns') loadConcerns();
  }

  // ---- connection banner -------------------------------------------------
  var connBanner = document.getElementById('conn-banner');
  var staleTokenBanner = document.getElementById('stale-token-banner');
  // Stale-token is a TERMINAL state: once this tab's token is known-bad, only a
  // Reload can recover it, so the two banners must be mutually exclusive. We lock
  // out the transient "Reconnecting…" banner entirely (setConn becomes a no-op)
  // and cancel any reconnect timer that was already scheduled — otherwise a
  // pending reconnect() fires and re-shows "Reconnecting…" stacked on top of the
  // Reload banner (the exact two-banner bug seen in the wild).
  function setConn(dead) {
    if (staleToken) { connBanner.hidden = true; return; }
    connBanner.hidden = !dead;
  }
  // 401 safety-net: the server is up but THIS tab's token is stale. Show an
  // ACTIONABLE banner (Reload), and never the infinite "Reconnecting…" — a
  // health probe can't help because the token itself is wrong. With the stable
  // token this should not happen; this is the safety net.
  function setStaleToken() {
    staleToken = true;          // terminal — locks setConn and the loops below
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (staleTokenBanner) staleTokenBanner.hidden = false;
    connBanner.hidden = true;   // hide the transient "Reconnecting…" banner
    polling = false;            // stop the events loop
    reconnecting = false;       // stop the health-probe backoff
  }
  document.getElementById('conn-retry').addEventListener('click', function () {
    // skip the backoff wait and probe health right now
    pollBackoff = 2000;
    if (reconnecting) { reconnect(); }
    else { setConn(false); if (current) show(current); }
  });
  var reloadBtn = document.getElementById('stale-token-reload');
  if (reloadBtn) reloadBtn.addEventListener('click', function () { location.reload(); });

  // ---- snippet receipts --------------------------------------------------
  function attachReceiptHandlers(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-snippet]'), function (chip) {
      chip.addEventListener('click', function () {
        var host = chip.parentNode.querySelector('.snippet');
        var file = chip.getAttribute('data-file');
        var line = chip.getAttribute('data-line');
        if (host && host.dataset.loaded === '1') {
          var open = host.hidden;
          host.hidden = !open;
          chip.setAttribute('aria-expanded', open ? 'true' : 'false');
          return;
        }
        if (!host) {
          host = document.createElement('div');
          host.className = 'snippet';
          host.setAttribute('role', 'region');
          chip.parentNode.appendChild(host);
        }
        host.hidden = false;
        host.textContent = 'loading…';
        chip.setAttribute('aria-expanded', 'true');
        api('/api/snippet?file=' + encodeURIComponent(file) + '&line=' + encodeURIComponent(line))
          .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j && j.error || ('http ' + r.status)); }); })
          .then(function (j) {
            host.innerHTML = '';
            (j.lines || []).forEach(function (ln, idx) {
              var n = (j.startLine || 1) + idx;
              var row = document.createElement('span');
              row.className = (n === j.centerLine) ? 'center' : '';
              row.innerHTML = '<span class="ln">' + n + '</span>' + esc(ln);
              host.appendChild(row);
              host.appendChild(document.createTextNode('\n'));
            });
            host.dataset.loaded = '1';
          })
          .catch(function (err) { host.textContent = 'could not load snippet (' + err.message + ')'; });
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-copy]'), function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy');
        copy(text, btn);
      });
    });
  }
  function copy(text, btn) {
    var done = function () { if (!btn) return; var o = btn.textContent; btn.textContent = 'copied ✓'; setTimeout(function () { btn.textContent = o; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
  }

  // ---- count-up animation -----------------------------------------------
  function countUp(el, to) {
    if (reduceMotion || to <= 0) { el.textContent = String(to); return; }
    var start = performance.now(), dur = 700;
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      el.textContent = String(Math.round(p * to));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- REPORT ------------------------------------------------------------
  var reportVerdicts = [];
  var reportFilter = 'all';     // all | confirmed | absent | undetermined
  var reportQuery = '';
  function loadReport() {
    var body = document.getElementById('report-body');
    getJSON('/api/verdicts').then(function (res) {
      var verdicts = (res && res.__missing) ? [] : res;
      if (!Array.isArray(verdicts)) verdicts = [];
      reportVerdicts = verdicts;
      renderReport(body, verdicts);
    }).catch(function () {
      body.innerHTML = '<p class="muted">Could not load verdicts.</p>';
    });
  }
  function verdictMatches(v) {
    if (reportFilter !== 'all' && v.verdict !== reportFilter) return false;
    if (reportQuery) {
      var c = v.claim || {};
      var hay = ((c.subject || '') + ' ' + (c.rawText || '')).toLowerCase();
      if (hay.indexOf(reportQuery) === -1) return false;
    }
    return true;
  }
  function renderReport(body, verdicts) {
    if (!verdicts.length) {
      body.innerHTML = depth === 'plain'
        ? '<div class="empty">Nothing to check yet. When Claude says it finished a feature, I’ll show here whether it’s really in your code.</div>'
        : '<div class="empty">No checkable claims this session — claims appear when the agent reports completing a feature.</div>';
      return;
    }
    if (depth === 'plain') { renderReportPlain(body, verdicts); return; }
    var confirmed = verdicts.filter(function (v) { return v.verdict === 'confirmed'; });
    var absent = verdicts.filter(function (v) { return v.verdict === 'absent'; });
    var undet = verdicts.filter(function (v) { return v.verdict === 'undetermined'; });
    var total = verdicts.length;
    var pct = total ? Math.round((confirmed.length / total) * 100) : 0;

    var html = '';
    // (1) verdict bar: animated coverage ring + count-up segments
    var C = 2 * Math.PI * 26; // r=26
    html += '<div class="verdict-bar">';
    html += '<div class="ring-wrap">';
    html += '<svg class="ring" viewBox="0 0 64 64" role="img" aria-label="' + pct + '% of claims confirmed">';
    html += '<circle class="ring-track" cx="32" cy="32" r="26"></circle>';
    html += '<circle class="ring-fill" cx="32" cy="32" r="26" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '" data-target="' + ((1 - confirmed.length / Math.max(1,total)) * C).toFixed(1) + '"></circle>';
    html += '<text class="ring-pct" x="32" y="37" text-anchor="middle">' + pct + '%</text>';
    html += '</svg>';
    html += '<div><div class="vb-count"><span class="cu" data-to="' + confirmed.length + '">0</span> of ' + total + ' claims confirmed</div>';
    html += '<div class="vb-sub">' + total + ' of ' + total + ' claims were checkable</div></div>';
    html += '</div>';
    html += '<div class="vb-segs">';
    html += '<span class="vb-seg seg-confirmed"><span class="ico">✓</span> <span class="cu" data-to="' + confirmed.length + '">0</span> confirmed</span>';
    html += '<span class="vb-seg seg-absent"><span class="ico">✕</span> <span class="cu" data-to="' + absent.length + '">0</span> absent</span>';
    html += '<span class="vb-seg seg-undetermined"><span class="ico">?</span> <span class="cu" data-to="' + undet.length + '">0</span> undetermined</span>';
    html += '</div>';
    html += '</div>';

    // (1b) filter chips + search
    html += '<div class="report-controls" role="group" aria-label="Filter claims">';
    html += '<div class="filter-chips">';
    [['all','All'],['confirmed','Confirmed'],['absent','Absent'],['undetermined','Undetermined']].forEach(function (f) {
      html += '<button class="fchip" type="button" data-filter="' + f[0] + '" aria-pressed="' + (reportFilter === f[0] ? 'true' : 'false') + '">' + f[1] + '</button>';
    });
    html += '</div>';
    html += '<input id="report-search" class="search-box" type="search" placeholder="Search claims…   ( / )" value="' + esc(reportQuery) + '" aria-label="Search claims" />';
    html += '</div>';

    html += '<div id="report-results"></div>';
    // (5) diagram (hidden at Plain via #report-diagram-wrap)
    html += '<div id="report-diagram-wrap" class="panel" style="margin-top:22px"><h2 class="panel-title">Structural diagram</h2><div id="report-diagram" class="diagram-host"><p class="muted loading-line">Building diagram…</p></div></div>';

    body.innerHTML = html;

    // count-up + ring draw
    Array.prototype.forEach.call(body.querySelectorAll('.cu'), function (el) { countUp(el, +el.getAttribute('data-to')); });
    var ringFill = body.querySelector('.ring-fill');
    if (ringFill) {
      if (reduceMotion) { ringFill.setAttribute('stroke-dashoffset', ringFill.getAttribute('data-target')); }
      else { requestAnimationFrame(function () { requestAnimationFrame(function () { ringFill.setAttribute('stroke-dashoffset', ringFill.getAttribute('data-target')); }); }); }
    }

    // wire filter chips + search
    Array.prototype.forEach.call(body.querySelectorAll('.fchip'), function (chip) {
      chip.addEventListener('click', function () {
        reportFilter = chip.getAttribute('data-filter');
        Array.prototype.forEach.call(body.querySelectorAll('.fchip'), function (c) {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        renderResults();
      });
    });
    var search = document.getElementById('report-search');
    if (search) {
      search.addEventListener('input', function () { reportQuery = search.value.trim().toLowerCase(); renderResults(); });
    }

    renderResults();
    renderDiagramInto('report-diagram');
  }
  function renderResults() {
    var host = document.getElementById('report-results');
    if (!host) return;
    var verdicts = reportVerdicts.filter(verdictMatches);
    var confirmed = verdicts.filter(function (v) { return v.verdict === 'confirmed'; });
    var absent = verdicts.filter(function (v) { return v.verdict === 'absent'; });
    var undet = verdicts.filter(function (v) { return v.verdict === 'undetermined'; });

    if (!verdicts.length) {
      host.innerHTML = '<div class="empty">No claims match this filter.</div>';
      return;
    }
    var html = '';
    var unfiltered = reportFilter === 'all' && !reportQuery;
    if (unfiltered && absent.length === 0 && undet.length === 0) {
      html += '<div class="relief"><div class="big">Everything the agent claimed is in the code.</div>';
      html += '<div class="sub">' + confirmed.length + ' of ' + reportVerdicts.length + ' receipts.</div></div>';
    } else {
      absent.forEach(function (v) { html += claimRow(v); });
      if (undet.length) {
        if (unfiltered) {
          html += '<details class="group group-undetermined" open><summary><span class="gcaret">▾</span> ' + undet.length + ' undetermined — I can\'t safely confirm these from the code</summary>';
          undet.forEach(function (v) { html += claimRow(v); });
          html += '</details>';
        } else { undet.forEach(function (v) { html += claimRow(v); }); }
      }
      if (confirmed.length) {
        if (unfiltered) {
          html += '<details class="group group-confirmed"><summary><span class="gcaret">▸</span> ' + confirmed.length + ' confirmed — present in the code</summary>';
          confirmed.forEach(function (v) { html += claimRow(v); });
          html += '</details>';
        } else { confirmed.forEach(function (v) { html += claimRow(v); }); }
      }
    }
    host.innerHTML = html;
    stagger(host.querySelectorAll('.claim-row'));
    attachReceiptHandlers(host);
  }
  function verdictIcon(vl) {
    // animated stroke-dash draw-in for ✓ / ✕; ? as plain glyph
    if (vl === 'confirmed') return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path class="draw" d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (vl === 'absent') return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path class="draw" d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    return '<span aria-hidden="true">?</span>';
  }
  function claimRow(v) {
    var c = v.claim || {};
    var raw = c.rawText || (c.subject || '');
    var cls = 'claim-' + v.verdict;
    var vl = v.verdict;
    var s = '<div class="claim-row ' + cls + '">';
    s += '<div class="claim-head">';
    s += '<span class="vlabel ' + vl + '" aria-label="Verdict: ' + vl + '">' + verdictIcon(vl) + ' ' + vl + '</span>';
    s += '<span class="claim-text">' + esc(c.subject || raw) + '</span>';
    s += '</div>';
    if (raw && raw !== (c.subject || '')) s += '<p class="claim-raw">"' + esc(raw) + '"</p>';

    if (vl === 'confirmed') {
      s += '<div class="evidence"><div class="evidence-summary">Found in the code:</div>';
      (v.receipts || []).forEach(function (r) { s += receipt(r); });
      s += '</div>';
    } else if (vl === 'absent') {
      var scope = (v.searchScope || []).join(', ') || 'the conventional locations';
      s += '<div class="evidence"><div class="evidence-summary">Searched ' + esc(scope) + ' and did not find it.</div></div>';
      var fix = 'The verifier found this claim ABSENT: "' + raw + '". Searched: ' + scope + '. Please implement it and re-verify.';
      s += '<div class="fix-box"><pre>' + esc(fix) + '</pre>';
      s += '<button class="btn-secondary" type="button" data-copy="' + esc(fix) + '">Copy: ask the agent to fix it</button></div>';
    } else {
      var ex = v.explainer || {};
      s += '<div class="evidence"><div class="evidence-summary">' + esc(ex.reason || 'Could not analyze this from the code.') + '</div>';
      if (ex.pattern) {
        s += '<details class="defeat"><summary>What defeated the analysis</summary><pre>' + esc(ex.pattern) + '</pre></details>';
      }
      s += '</div>';
    }
    s += claimTechBlock(v);
    s += '</div>';
    return s;
  }
  function receipt(r) {
    if (!r || !r.file) return '';
    var path = r.file + ':' + r.line;
    var s = '<div class="receipt">';
    s += '<button class="chip" type="button" data-snippet="1" data-file="' + esc(r.file) + '" data-line="' + esc(r.line) + '" aria-expanded="false">' + esc(path) + '</button>';
    // the extractor rule that produced this fact — proof of WHICH recognizer
    // fired, shown only at Technical depth (CSS-gated).
    if (r.ruleId) s += '<span class="rule-id" title="extractor rule">' + esc(r.ruleId) + '</span>';
    s += '<div class="copy-row"><button class="btn-secondary" type="button" data-copy="' + esc(path) + '">copy path</button></div>';
    s += '</div>';
    return s;
  }
  // Technical-depth detail appended to a verdict row: the exact claim identity,
  // the fact ids the verdict is grounded in, and the allowlist recognizer that
  // makes this claim shape checkable (or marks it UNDETERMINED-by-construction).
  function claimTechBlock(v) {
    var c = v.claim || {};
    var rows = '';
    // precise claim identity
    var ident = [c.category, c.predicate, c.subject].filter(Boolean).join(' · ');
    var quals = c.qualifiers && typeof c.qualifiers === 'object'
      ? Object.keys(c.qualifiers).map(function (k) { return k + '=' + c.qualifiers[k]; }).join(', ') : '';
    if (ident) rows += '<div class="ct-row"><span class="ct-k">claim</span><span class="ct-v mono">' + esc(ident) + (quals ? ' (' + esc(quals) + ')' : '') + '</span></div>';
    // fact ids this verdict is grounded in
    if (v.factIds && v.factIds.length) {
      rows += '<div class="ct-row"><span class="ct-k">grounded in</span><span class="ct-v">' +
        v.factIds.map(function (id) { return '<span class="factid-chip mono">' + esc(id) + '</span>'; }).join(' ') + '</span></div>';
    }
    // allowlist recognizer provenance
    var entry = (c.category && c.predicate) ? allowlistEntryFor(c.category, c.predicate) : null;
    if (entry) {
      rows += '<div class="ct-row"><span class="ct-k">recognizer</span><span class="ct-v mono">' +
        esc((entry.ruleIds || []).join(', ')) + ' <span class="allow-ok">allowlisted</span></span></div>';
    } else if (c.category) {
      rows += '<div class="ct-row"><span class="ct-k">recognizer</span><span class="ct-v">' +
        '<span class="allow-off">off-allowlist → UNDETERMINED by construction</span></span></div>';
    }
    if (!rows) return '';
    return '<div class="claim-tech">' + rows + '</div>';
  }

  // ---- REPORT @ Plain: verdict sentences only ----------------------------
  function plainVerdictLine(v) {
    if (v === 'confirmed') return '✓ This is really in your code';
    if (v === 'absent') return '✗ I looked and this is not in your code';
    return '? I can’t safely confirm this';
  }
  function renderReportPlain(body, verdicts) {
    var confirmed = verdicts.filter(function (v) { return v.verdict === 'confirmed'; }).length;
    var html = '<p class="flow-plain">Here’s what Claude said it built, and whether I can actually find each thing in your code. ' +
      esc(confirmed) + ' of ' + verdicts.length + ' checked out.</p>';
    var order = ['absent', 'undetermined', 'confirmed'];
    order.forEach(function (band) {
      verdicts.filter(function (v) { return v.verdict === band; }).forEach(function (v) {
        var c = v.claim || {};
        var raw = c.rawText || c.subject || '';
        html += '<div class="plain-verdict pv-' + band + '">';
        html += '<div class="pv-line">' + esc(plainVerdictLine(band)) + '</div>';
        if (raw) html += '<p class="pv-raw">“' + esc(raw) + '”</p>';
        var receipts = v.receipts || [];
        if (band === 'absent') {
          var scope = (v.searchScope || []).join(', ') || 'the conventional locations';
          var fix = 'The verifier found this claim ABSENT: "' + raw + '". Searched: ' + scope + '. Please implement it and re-verify.';
          html += '<div class="copy-row"><button class="btn-secondary" type="button" data-copy="' + esc(fix) + '">Copy: ask the agent to fix it</button></div>';
        }
        if (receipts.length) {
          html += '<details class="pv-evidence"><summary>show me the evidence</summary>';
          receipts.forEach(function (r) { html += receipt(r); });
          html += '</details>';
        }
        html += '</div>';
      });
    });
    body.innerHTML = html;
    stagger(body.querySelectorAll('.plain-verdict'));
    attachReceiptHandlers(body);
  }

  // ---- HISTORY -----------------------------------------------------------
  function loadHistory() {
    var body = document.getElementById('history-body');
    getJSON('/api/ledger').then(function (res) {
      var ledger = (res && res.__missing) ? [] : res;
      if (!Array.isArray(ledger)) ledger = [];
      renderHistory(body, ledger);
    }).catch(function () {
      body.innerHTML = '<p class="muted">Could not load history.</p>';
    });
  }
  function renderHistory(body, ledger) {
    if (!ledger.length) {
      body.innerHTML = '<div class="empty">No history yet. Each time the agent claims a feature, the result is recorded here.</div>';
      return;
    }
    // group by session, preserving first-seen order
    var order = [], groups = {};
    ledger.forEach(function (e) {
      var sid = e.sessionId || 'session';
      if (!groups[sid]) { groups[sid] = []; order.push(sid); }
      groups[sid].push(e);
    });
    var html = '';
    order.forEach(function (sid, gi) {
      var entries = groups[sid];
      html += '<div class="history-session">';
      html += '<h3 class="history-session-head">Session ' + (gi + 1) + ' · ' + esc(shortId(sid)) + '</h3>';
      entries.forEach(function (e) {
        if (e.type === 'regression-alert') {
          var pc = (e.previous && e.previous.claim) || (e.current && e.current.claim) || {};
          html += '<div class="history-regression">';
          html += '<div class="hr-title">⚠ Previously confirmed, now missing</div>';
          html += '<p class="hr-claim">“' + esc(pc.subject || pc.rawText || 'a feature') + '” was confirmed earlier but is no longer found in the code.</p>';
          html += '</div>';
        } else if (e.type === 'claim-checked' && e.verdict) {
          var v = e.verdict; var c = v.claim || {};
          html += '<div class="history-entry">';
          html += '<span class="he-ico ' + v.verdict + '">' + (v.verdict === 'confirmed' ? '✓' : v.verdict === 'absent' ? '✕' : '?') + '</span>';
          html += '<span class="he-text">' + esc(c.subject || c.rawText || 'claim') + '</span>';
          html += '<span class="he-time">' + esc(timeText(e.timestamp)) + '</span>';
          html += '</div>';
        }
      });
      html += '</div>';
    });
    body.innerHTML = html;
    stagger(body.querySelectorAll('.history-session'));
  }
  function shortId(s) { return String(s).slice(0, 8); }
  function timeText(ts) {
    if (!ts) return '';
    var d = new Date(ts); if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString(); } catch (e) { return ts; }
  }

  // ---- HOW IT WORKS (map.dataFlows) — the plain end-to-end stories --------
  function withSystemMap(cb) {
    if (systemMap) { cb(systemMap); return; }
    getJSON('/api/system-map').then(function (res) {
      var map = (res && res.__missing) ? null : res;
      if (map && map.nodes) { systemMap = map; setSystemChrome(map); }
      cb(map);
    }).catch(function () { cb(null); });
  }
  function loadHowItWorks() {
    var body = document.getElementById('howitworks-body');
    if (!body) return;
    withSystemMap(function (map) {
      var flows = (map && map.dataFlows) || [];
      if (!flows.length) {
        body.innerHTML = '<div class="empty">No end-to-end stories yet. When a system map is built, the main journeys through your app appear here in plain words.</div>';
        return;
      }
      var html = '<p class="hiw-intro">The main journeys through your system, start to finish, in plain words.</p>';
      html += '<div class="howitworks-list">';
      flows.forEach(function (f, i) {
        html += '<div class="hiw-story">';
        html += '<p class="hiw-title"><span class="hiw-num">' + (i + 1) + '</span>' + esc(f.title || 'Story ' + (i + 1)) + '</p>';
        html += '<p class="hiw-plain">' + esc(f.plain || '') + '</p>';
        html += '</div>';
      });
      html += '</div>';
      body.innerHTML = html;
      stagger(body.querySelectorAll('.hiw-story'));
    });
  }

  // ---- WHAT LOOKS OFF (map.concerns) — the adversarial value --------------
  function loadConcerns() {
    var body = document.getElementById('concerns-body');
    if (!body) return;
    withSystemMap(function (map) {
      var concerns = (map && map.concerns) || [];
      if (!concerns.length) {
        body.innerHTML = '<div class="empty">Nothing flagged. When a system map is built, anything that looks off — weak spots, risky data handling — is listed here with a receipt.</div>';
        return;
      }
      var order = { high: 0, med: 1, low: 2 };
      var sorted = concerns.slice().sort(function (a, b) {
        return (order[a.severity] == null ? 3 : order[a.severity]) - (order[b.severity] == null ? 3 : order[b.severity]);
      });
      var high = concerns.filter(function (c) { return c.severity === 'high'; }).length;
      var html = '<p class="concern-intro">' +
        (high > 0 ? 'I found <strong>' + high + '</strong> thing' + (high === 1 ? '' : 's') + ' worth checking. ' : '') +
        'Each one points at the exact place in the code.</p>';
      html += '<div class="concerns-list">';
      sorted.forEach(function (c) {
        var sev = (c.severity === 'high' || c.severity === 'med' || c.severity === 'low') ? c.severity : 'low';
        html += '<div class="concern concern-' + sev + '">';
        html += '<div class="concern-head"><span class="sev-dot sev-' + sev + '" aria-hidden="true"></span>';
        html += '<span class="concern-label">' + esc(c.label || '') + '</span></div>';
        if (c.detail) html += '<p class="concern-detail">' + esc(c.detail) + '</p>';
        if (c.file) {
          var rec = parseReceipt(c.file);
          html += '<div class="receipt"><button class="chip" type="button" data-snippet="1" data-file="' +
            esc(rec.file) + '" data-line="' + esc(rec.line) + '" aria-expanded="false">' + esc(rec.file + ':' + rec.line) + '</button></div>';
        }
        html += '</div>';
      });
      html += '</div>';
      body.innerHTML = html;
      stagger(body.querySelectorAll('.concern'));
      attachReceiptHandlers(body);
    });
  }

  // ---- LIVE @ Plain: flow strips -----------------------------------------
  function loadFlows() {
    var host = document.getElementById('flows-host');
    if (!host) return;
    getJSON('/api/flows').then(function (res) {
      var data = (res && res.__missing) ? { flows: [], pages: [] } : res;
      renderFlows(host, (data && data.flows) || [], (data && data.pages) || []);
    }).catch(function () {
      host.innerHTML = '<div class="empty">Couldn’t read how your app connects right now.</div>';
    });
  }
  function renderFlows(host, flows, pages) {
    if (!flows.length && !pages.length) {
      host.innerHTML = '<div class="empty">As Claude builds, I’ll show here how the pieces of your app connect.</div>';
      return;
    }
    var html = '';
    flows.forEach(function (f, fi) {
      html += '<div class="flow-strip' + (f.traced ? '' : ' flow-untraced') + '">';
      html += '<p class="flow-title">' + esc(f.title) + '</p>';
      html += '<p class="flow-plain">' + esc(f.plain) + '</p>';
      html += '<div class="flow-chips">';
      (f.steps || []).forEach(function (s, si) {
        if (si > 0) html += '<span class="flow-arrow" aria-hidden="true">→</span>';
        var key = conceptForStepKind(s.kind);
        var cls = 'flow-chip chip-' + s.kind;
        if (s.kind === 'unknown') {
          html += '<span class="' + cls + '">' + esc(s.label) + '</span>';
        } else {
          html += '<button class="' + cls + '" type="button" data-flow="' + fi + '" data-step="' + si + '"' +
            (key ? ' data-concept="' + esc(key) + '"' : '') + '>' + esc(s.label) + '</button>';
        }
      });
      html += '</div>';
      if (!f.traced) html += '<p class="flow-untraced-note">I can’t trace the last step from the code alone — so I won’t pretend to.</p>';
      html += '</div>';
    });
    if (pages.length) {
      html += '<div class="pages-block"><h3>Pages people can visit</h3>';
      html += '<p class="flow-plain">Screens a visitor can open directly.</p>';
      html += '<div class="pages-list">';
      pages.forEach(function (p) {
        html += '<span class="page-pill"><b>' + esc(p.label) + '</b> ' + esc(p.path) + '</span>';
      });
      html += '</div></div>';
    }
    host.innerHTML = html;
    stagger(host.querySelectorAll('.flow-strip, .pages-block'));
    host.__flows = flows;
    attachFlowChips(host);
  }
  function attachFlowChips(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.flow-chip[data-concept]'), function (chip) {
      chip.addEventListener('click', function () {
        var fi = +chip.getAttribute('data-flow');
        var si = +chip.getAttribute('data-step');
        var flow = (host.__flows || [])[fi];
        var step = flow && flow.steps && flow.steps[si];
        openLearn(chip.getAttribute('data-concept'), step);
      });
    });
  }

  // ---- overlays: single-layer policy -------------------------------------
  var learnPop = document.getElementById('learn-pop');
  var glossaryPanel = document.getElementById('glossary-panel');
  var shortcutsOv = document.getElementById('shortcuts');
  var menuSheet = document.getElementById('menu-sheet');
  var menuBtn = document.getElementById('menu-btn');
  var lastFocused = null;
  var openOverlay = null; // the currently-open overlay element, or null

  function anyOverlayOpen() { return !!openOverlay; }
  function lockBody(on) {
    document.body.classList.toggle('overlay-open', on);
  }
  // Close every overlay. Only ever one layer is shown.
  function closeAllOverlays(restoreFocus) {
    if (learnPop) learnPop.hidden = true;
    if (glossaryPanel) glossaryPanel.hidden = true;
    if (shortcutsOv) shortcutsOv.hidden = true;
    if (menuSheet) menuSheet.hidden = true;
    var onb = document.getElementById('onboard'); if (onb) onb.hidden = true;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    openOverlay = null;
    lockBody(false);
    if (restoreFocus && lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch (e) {} }
  }
  function openTheOverlay(el, focusEl) {
    // single-popover policy: opening anything closes others first.
    if (openOverlay && openOverlay !== el) { openOverlay.hidden = true; }
    if (el !== menuSheet && menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    lastFocused = document.activeElement;
    el.hidden = false;
    openOverlay = el;
    lockBody(true);
    if (focusEl && focusEl.focus) focusEl.focus();
  }

  // ---- menu sheet --------------------------------------------------------
  function openMenu() {
    if (!menuSheet) return;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    openTheOverlay(menuSheet, menuSheet.querySelector('.menu-close'));
  }
  if (menuBtn) menuBtn.addEventListener('click', openMenu);
  if (menuSheet) {
    var mclose = menuSheet.querySelector('.menu-close');
    if (mclose) mclose.addEventListener('click', function () { closeAllOverlays(true); });
    menuSheet.addEventListener('click', function (e) { if (e.target === menuSheet) closeAllOverlays(true); });
    Array.prototype.forEach.call(menuSheet.querySelectorAll('.menu-item'), function (item) {
      // depth radios are NOT .menu-item, so this only catches navigation actions.
      item.addEventListener('click', function () {
        var view = item.getAttribute('data-view');
        var act = item.getAttribute('data-menu');
        if (view) { closeAllOverlays(false); show(view); return; }
        if (act === 'learn') { openGlossary(); return; }
        if (act === 'shortcuts') { openTheOverlay(shortcutsOv, shortcutsOv.querySelector('.shortcuts-close')); return; }
        if (act === 'export-md') { closeAllOverlays(false); exportMarkdown(null); return; }
        if (act === 'export-mmd') { closeAllOverlays(false); exportMermaid(); return; }
      });
    });
  }

  function openLearn(conceptKey, step) {
    var c = conceptByKey(conceptKey);
    if (!c) return;
    learnPop.querySelector('.learn-title').textContent = c.friendly + ' (' + c.technical + ')';
    learnPop.querySelector('.learn-plain').textContent = c.plain;
    var inst = learnPop.querySelector('.learn-instance');
    inst.textContent = 'In your app: ' + ((step && step.plain) || c.analogy);
    var relsEl = learnPop.querySelector('.learn-rels');
    if (relsEl) { relsEl.innerHTML = ''; relsEl.hidden = true; } // glossary panel has no relationships
    learnPop.querySelector('.learn-why').textContent = 'Why it matters: ' + c.why;
    var snipHost = learnPop.querySelector('.learn-snippet-host');
    snipHost.innerHTML = ''; snipHost.dataset.loaded = '';
    var codeBtn = learnPop.querySelector('.learn-code');
    var rec = step && step.receipt;
    codeBtn.style.display = rec ? '' : 'none';
    codeBtn.onclick = rec ? function () {
      if (snipHost.dataset.loaded === '1') { snipHost.hidden = !snipHost.hidden; return; }
      snipHost.innerHTML = '<div class="receipt"><button class="chip" type="button" data-snippet="1" data-file="' +
        esc(rec.file) + '" data-line="' + esc(rec.line) + '" aria-expanded="false">' +
        esc(rec.file + ':' + rec.line) + '</button></div>';
      attachReceiptHandlers(snipHost);
      snipHost.dataset.loaded = '1';
      var c2 = snipHost.querySelector('[data-snippet]'); if (c2) c2.click();
    } : null;
    openTheOverlay(learnPop, learnPop.querySelector('.learn-close'));
  }
  if (learnPop) {
    learnPop.querySelector('.learn-close').addEventListener('click', function () { closeAllOverlays(true); });
    learnPop.addEventListener('click', function (e) { if (e.target === learnPop) closeAllOverlays(true); });
    learnPop.querySelector('.learn-more').addEventListener('click', function () { openGlossary(); });
  }

  function openGlossary() {
    var list = document.getElementById('glossary-list');
    var html = '';
    GLOSSARY.forEach(function (c) {
      html += '<div class="glossary-entry">';
      html += '<h3>' + esc(c.friendly) + ' <span class="gl-tech">' + esc(c.technical) + '</span></h3>';
      html += '<p class="gl-plain">' + esc(c.plain) + '</p>';
      html += '<p class="gl-analogy"><span class="gl-analogy-tag">Like a restaurant:</span> ' + esc(c.analogy) + '</p>';
      html += '<p class="gl-why">' + esc(c.why) + '</p>';
      html += '</div>';
    });
    list.innerHTML = html;
    openTheOverlay(glossaryPanel, glossaryPanel.querySelector('.glossary-close'));
    stagger(list.querySelectorAll('.glossary-entry'));
  }
  if (glossaryPanel) {
    glossaryPanel.querySelector('.glossary-close').addEventListener('click', function () { closeAllOverlays(true); });
    glossaryPanel.addEventListener('click', function (e) { if (e.target === glossaryPanel) closeAllOverlays(true); });
  }

  // shortcuts overlay
  function toggleShortcuts() {
    if (shortcutsOv.hidden) openTheOverlay(shortcutsOv, shortcutsOv.querySelector('.shortcuts-close'));
    else closeAllOverlays(true);
  }
  if (shortcutsOv) {
    shortcutsOv.querySelector('.shortcuts-close').addEventListener('click', function () { closeAllOverlays(true); });
    shortcutsOv.addEventListener('click', function (e) { if (e.target === shortcutsOv) closeAllOverlays(true); });
  }
  // Export actions are invoked from the menu sheet (see menu-item wiring).
  function exportMarkdown(btn) {
    getJSON('/api/verdicts').then(function (res) {
      var verdicts = (res && res.__missing) ? [] : res;
      if (!Array.isArray(verdicts)) verdicts = [];
      copy(buildMarkdown(verdicts), btn);
    });
  }
  function buildMarkdown(verdicts) {
    var conf = verdicts.filter(function (v) { return v.verdict === 'confirmed'; });
    var abs = verdicts.filter(function (v) { return v.verdict === 'absent'; });
    var und = verdicts.filter(function (v) { return v.verdict === 'undetermined'; });
    var lines = [];
    lines.push('# program-design report');
    lines.push('');
    lines.push('_Verifies presence, not correctness._');
    lines.push('');
    lines.push('- ' + conf.length + ' confirmed · ' + abs.length + ' absent · ' + und.length + ' undetermined (of ' + verdicts.length + ')');
    lines.push('');
    function section(title, list) {
      if (!list.length) return;
      lines.push('## ' + title);
      lines.push('');
      list.forEach(function (v) {
        var c = v.claim || {};
        var mark = v.verdict === 'confirmed' ? '✓' : v.verdict === 'absent' ? '✕' : '?';
        lines.push('- ' + mark + ' ' + (c.subject || c.rawText || 'claim'));
        (v.receipts || []).forEach(function (r) { if (r && r.file) lines.push('  - ' + r.file + ':' + r.line); });
        if (v.verdict === 'absent' && v.searchScope && v.searchScope.length) lines.push('  - searched: ' + v.searchScope.join(', '));
      });
      lines.push('');
    }
    section('Absent', abs);
    section('Undetermined', und);
    section('Confirmed', conf);
    return lines.join('\n');
  }
  function exportMermaid() {
    api('/api/mermaid').then(function (r) { return r.ok ? r.text() : ''; }).then(function (src) {
      if (!src) return;
      var blob = new Blob([src], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'diagram.mmd';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  // global keydown: Esc closes overlays then returns to the map; shortcuts
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      // Closing the onboarding question without choosing = "just show me" (guided).
      if (onboardingPending) { e.preventDefault(); chooseAudience('guided'); return; }
      if (anyOverlayOpen()) { closeAllOverlays(true); return; }
      // While the guided tour is playing, Esc skips it to the full map.
      if (tourActive && current === 'map') { e.preventDefault(); skipToFull(); return; }
      // Esc always returns to the map home.
      if (current !== 'map') show('map');
      return;
    }
    // ignore shortcuts while typing in an input
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
    if (typing) return;
    // TOUR shortcuts (only while the tour is active on the map): ← / → step
    // through the story yourself. These take priority over map pan.
    if (tourActive && current === 'map' && !anyOverlayOpen()) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (beatIndex >= tour.beats.length - 1) endTour(); else manualBeat(1);
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); manualBeat(-1); return; }
    }
    if (e.key === '/') {
      var search = document.getElementById('report-search');
      if (current !== 'report') { show('report'); }
      setTimeout(function () { var s = document.getElementById('report-search'); if (s) { e.preventDefault(); s.focus(); } }, 0);
      e.preventDefault();
      return;
    }
    if (e.key === 'm' || e.key === 'M') { openMenu(); }
    else if (e.key === 'd' || e.key === 'D') { cycleDepth(); }
    // map pan/zoom/fit also work globally while the map is the active view
    else if (current === 'map') {
      var vp = document.getElementById('canvas-viewport');
      if (vp && document.activeElement === vp) return; // its own handler runs
      if (e.key === '+' || e.key === '=') { e.preventDefault(); mapZoom(1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); mapZoom(0.8); }
      else if (e.key === '0') { e.preventDefault(); userInteractedAt = Date.now(); fitAll(false); }
      else if (e.key.indexOf('Arrow') === 0) {
        e.preventDefault(); userInteractedAt = Date.now();
        if (e.key === 'ArrowLeft') camTarget.tx += 60;
        else if (e.key === 'ArrowRight') camTarget.tx -= 60;
        else if (e.key === 'ArrowUp') camTarget.ty += 60;
        else if (e.key === 'ArrowDown') camTarget.ty -= 60;
        nudgeCam();
      }
    }
  });
  // shared zoom-toward-center used by the global shortcut handler
  function mapZoom(mult) {
    userInteractedAt = Date.now();
    var sz = canvasSize();
    var cx = sz.w / 2, cy = sz.h / 2;
    var k = clampK(camTarget.k * mult);
    var wx = (cx - camTarget.tx) / camTarget.k, wy = (cy - camTarget.ty) / camTarget.k;
    camTarget.k = k; camTarget.tx = cx - wx * k; camTarget.ty = cy - wy * k;
    nudgeCam();
  }

  // ---- LIVE --------------------------------------------------------------
  var prevNodeIds = null;
  var prevNodeNames = {};
  var activityLog = []; // {kind:'add'|'rem', name, time}
  function loadLive() {
    if (depth === 'plain') loadFlows();
    getJSON('/api/graph').then(function (res) {
      var graph = (res && res.__missing) ? null : res;
      renderLive(graph);
    }).catch(function () {
      document.getElementById('live-status').textContent = 'Could not load structure.';
    });
  }
  function renderLive(graph) {
    var status = document.getElementById('live-status');
    var treeHost = document.getElementById('live-tree');
    var stale = document.getElementById('stale-banner');
    var activity = document.getElementById('activity');
    if (!graph || !graph.nodes || !graph.nodes.length) {
      status.textContent = '';
      treeHost.innerHTML = '<div class="empty">No supported app structure yet — the diagram grows as Claude builds.</div>';
      document.getElementById('diagram-host').innerHTML = '';
      stale.hidden = true;
      if (activity) activity.hidden = true;
      return;
    }
    var age = Date.now() - new Date(graph.generatedAt).getTime();
    stale.hidden = !(graph.buildActive && age > 60000);
    status.textContent = 'updated ' + agoText(age) + ' ago · ' + countKinds(graph);

    // graph-diff: highlight new nodes, strike removed, and log activity.
    var ids = {}, names = {};
    graph.nodes.forEach(function (n) { ids[n.id] = true; names[n.id] = (n.kind + ' ' + n.name); });
    var newIds = {}, removedIds = [];
    if (prevNodeIds) {
      graph.nodes.forEach(function (n) { if (!prevNodeIds[n.id]) { newIds[n.id] = true; pushActivity('add', n.kind + ' ' + n.name); } });
      Object.keys(prevNodeIds).forEach(function (id) { if (!ids[id]) { removedIds.push(id); pushActivity('rem', prevNodeNames[id] || id); } });
    }
    treeHost.innerHTML = '';
    treeHost.appendChild(buildTreeFilter(graph.nodes));   // Technical: kind filter
    treeHost.appendChild(buildTree(graph.nodes, newIds, false));
    attachReceiptHandlers(treeHost);                       // Technical: node receipts
    applyTreeFilter();
    prevNodeIds = ids; prevNodeNames = names;

    if (!reduceMotion) {
      Array.prototype.forEach.call(treeHost.querySelectorAll('.node-new'), function (el) {
        setTimeout(function () { el.classList.remove('node-new'); var b = el.querySelector('.diff-badge.new'); if (b) b.remove(); }, 8000);
      });
    }
    renderActivity();
    renderDiagramInto('diagram-host');
  }
  function pushActivity(kind, name) {
    activityLog.unshift({ kind: kind, name: name, time: Date.now() });
    if (activityLog.length > 10) activityLog.length = 10;
  }
  function renderActivity() {
    var activity = document.getElementById('activity');
    var list = document.getElementById('activity-list');
    if (!activity || !list) return;
    if (!activityLog.length) { activity.hidden = true; return; }
    activity.hidden = false;
    var html = '';
    activityLog.forEach(function (a) {
      html += '<li class="activity-item act-' + (a.kind === 'add' ? 'add' : 'rem') + '">';
      html += '<span class="act-mark">' + (a.kind === 'add' ? '+' : '−') + '</span>';
      html += '<span class="act-name">' + esc(a.name) + '</span>';
      html += '<span class="act-time">' + agoText(Date.now() - a.time) + ' ago</span>';
      html += '</li>';
    });
    list.innerHTML = html;
    stagger(list.querySelectorAll('.activity-item'));
  }
  function countKinds(graph) {
    var c = {};
    graph.nodes.forEach(function (n) { c[n.kind] = (c[n.kind] || 0) + 1; });
    var parts = [];
    ['route', 'middleware', 'dbTable', 'component', 'file', 'envVar'].forEach(function (k) {
      if (c[k]) parts.push(label(k) + ' ' + c[k]);
    });
    return parts.join(' · ');
  }
  function label(k) { return k === 'dbTable' ? 'tables' : k === 'envVar' ? 'env' : k + 's'; }
  function agoText(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.round(s / 60); return m + 'm';
  }

  // Build a directory-clustered collapsible tree from nodes.
  // Technical-depth kind filter above the structure tree — chips per EntityKind
  // (with counts) that narrow the tree to one kind (route / dbTable / envVar / …).
  var treeFilter = 'all';
  function buildTreeFilter(nodes) {
    var counts = {};
    nodes.forEach(function (n) { counts[n.kind] = (counts[n.kind] || 0) + 1; });
    var kinds = Object.keys(counts).sort();
    if (treeFilter !== 'all' && kinds.indexOf(treeFilter) === -1) treeFilter = 'all';
    var bar = document.createElement('div');
    bar.className = 'tree-filter';
    var html = '<button class="tfc' + (treeFilter === 'all' ? ' on' : '') + '" data-kind="all" type="button">all <span class="tfc-n">' + nodes.length + '</span></button>';
    kinds.forEach(function (k) {
      html += '<button class="tfc' + (treeFilter === k ? ' on' : '') + '" data-kind="' + esc(k) + '" type="button">' + esc(k) + ' <span class="tfc-n">' + counts[k] + '</span></button>';
    });
    bar.innerHTML = html;
    Array.prototype.forEach.call(bar.querySelectorAll('.tfc'), function (b) {
      b.addEventListener('click', function () {
        treeFilter = b.getAttribute('data-kind');
        Array.prototype.forEach.call(bar.querySelectorAll('.tfc'), function (x) { x.classList.toggle('on', x === b); });
        applyTreeFilter();
      });
    });
    return bar;
  }
  function applyTreeFilter() {
    var host = document.getElementById('live-tree');
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('.tree-leaf'), function (li) {
      var show = treeFilter === 'all' || li.getAttribute('data-kind') === treeFilter;
      li.classList.toggle('leaf-filtered', !show);
    });
    // collapse directories whose every leaf is filtered out
    Array.prototype.forEach.call(host.querySelectorAll('li'), function (li) {
      if (!li.querySelector(':scope > .tree-toggle')) return;
      var leaves = li.querySelectorAll('.tree-leaf');
      var anyVisible = Array.prototype.some.call(leaves, function (l) { return !l.classList.contains('leaf-filtered'); });
      li.classList.toggle('dir-filtered', leaves.length > 0 && !anyVisible);
    });
  }
  function buildTree(nodes, newIds, planned) {
    var root = { dirs: {}, leaves: [] };
    nodes.forEach(function (n) {
      var file = (n.provenance && n.provenance.file) || '';
      var parts = file ? file.replace(/\\/g, '/').split('/') : [];
      var dir = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var p = parts[i];
        dir.dirs[p] = dir.dirs[p] || { dirs: {}, leaves: [] };
        dir = dir.dirs[p];
      }
      dir.leaves.push(n);
    });
    var ul = document.createElement('ul');
    ul.className = 'tree' + (planned ? ' planned' : '');
    appendDir(ul, root, newIds);
    return ul;
  }
  function appendDir(ul, dir, newIds) {
    Object.keys(dir.dirs).sort().forEach(function (name) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.className = 'tree-toggle'; btn.type = 'button';
      btn.setAttribute('aria-expanded', 'true');
      btn.innerHTML = '<span class="caret" aria-hidden="true">▾</span>' + esc(name) + '/';
      var child = document.createElement('ul');
      appendDir(child, dir.dirs[name], newIds);
      btn.addEventListener('click', function () {
        var open = child.hidden;
        child.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.querySelector('.caret').textContent = open ? '▾' : '▸';
      });
      li.appendChild(btn); li.appendChild(child); ul.appendChild(li);
    });
    dir.leaves.sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (n) {
      var li = document.createElement('li');
      var isNew = newIds && newIds[n.id];
      var kindCls = ['route', 'middleware', 'dbTable', 'envVar'].indexOf(n.kind) !== -1 ? ' kind-' + n.kind : '';
      li.className = 'tree-leaf' + (isNew ? ' node-new' : '');
      li.setAttribute('data-kind', n.kind);
      var html = '<span class="kind-tag' + kindCls + '">' + esc(n.kind) + '</span>' + esc(n.name) +
        (n.unresolved ? ' <span class="muted" title="referenced but not resolved — UNDETERMINED, not absent">?</span>' : '') +
        (isNew && newIds ? '<span class="diff-badge new">new</span>' : '');
      // Technical depth: a clickable file:line + ruleId receipt on EVERY node, so
      // every fact in the tree is one click from the source that proves it.
      var pr = n.provenance;
      if (pr && pr.file) {
        html += '<button class="chip tree-receipt" type="button" data-snippet="1" data-file="' + esc(pr.file) +
          '" data-line="' + esc(pr.line) + '" aria-expanded="false">' + esc(pr.file + ':' + pr.line) + '</button>';
        if (pr.ruleId) html += '<span class="rule-id" title="extractor rule">' + esc(pr.ruleId) + '</span>';
      }
      li.innerHTML = html;
      ul.appendChild(li);
    });
  }

  // ---- PLAN --------------------------------------------------------------
  function loadPlan() {
    var body = document.getElementById('plan-body');
    var banner = document.querySelector('#view-plan .plan-banner');
    if (banner) {
      banner.innerHTML = depth === 'plain'
        ? '<strong>This is what Claude says it’s planning to build.</strong> Nothing here is verified yet.'
        : '<strong>PLANNED — not yet verified.</strong> This view is the agent’s stated intent, not verified fact.';
    }
    getJSON('/api/plan').then(function (res) {
      var plan = (res && res.__missing) ? null : res;
      if (!plan || !plan.nodes || !plan.nodes.length) {
        body.innerHTML = depth === 'plain'
          ? '<div class="empty">Claude hasn’t shared a plan yet. When it does, I’ll show what it intends to build here.</div>'
          : '<div class="empty">No planned structure detected in this plan.</div>';
        return;
      }
      var pseudo = plan.nodes.map(function (n, i) {
        return { id: 'plan:' + i, kind: n.kind, name: n.name, provenance: null, unresolved: false };
      });
      body.innerHTML = '';
      body.appendChild(buildTree(pseudo, null, true));
      stagger(body.querySelectorAll('.tree-leaf'));
    }).catch(function () {
      body.innerHTML = '<div class="empty">Couldn\'t derive structure from this plan.</div>';
    });
  }

  // ---- Mermaid diagram ---------------------------------------------------
  var mermaidReady = false, mermaidFailed = false, pendingDiagram = null;
  window.__PD_onMermaid = function () {
    try {
      window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', flowchart: { useMaxWidth: true } });
      mermaidReady = true;
      if (pendingDiagram) { var p = pendingDiagram; pendingDiagram = null; renderDiagramInto(p); }
    } catch (e) { mermaidFailed = true; }
  };
  window.__PD_onMermaidFail = function () { mermaidFailed = true; if (pendingDiagram) renderDiagramInto(pendingDiagram); };

  var diagSeq = 0;
  function renderDiagramInto(hostId) {
    var host = document.getElementById(hostId);
    if (!host) return;
    if (mermaidFailed) {
      host.innerHTML = '<p class="muted">Diagram unavailable offline — see the structure tree above.</p>';
      return;
    }
    if (!mermaidReady) { pendingDiagram = hostId; return; }
    api('/api/mermaid').then(function (r) { return r.ok ? r.text() : ''; }).then(function (src) {
      if (!src) { host.innerHTML = '<p class="muted">No diagram yet.</p>'; return; }
      var id = 'mmd' + (++diagSeq);
      window.mermaid.render(id, src).then(function (out) {
        host.innerHTML = out.svg;
      }).catch(function () {
        host.innerHTML = '<p class="muted">Could not render the diagram.</p>';
      });
    }).catch(function () { host.innerHTML = '<p class="muted">Could not load the diagram.</p>'; });
  }

  // legend toggle
  var lt = document.getElementById('legend-toggle');
  if (lt) {
    var toggleLegend = function () {
      var lg = document.getElementById('legend');
      lg.hidden = !lg.hidden;
      lt.setAttribute('aria-expanded', lg.hidden ? 'false' : 'true');
    };
    lt.addEventListener('click', toggleLegend);
    lt.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLegend(); } });
  }

  // ---- status strip (the only verdict surface on the map) ----------------
  function refreshStatusStrip() {
    var strip = document.getElementById('status-strip');
    if (!strip) return;
    getJSON('/api/verdicts').then(function (res) {
      var verdicts = (res && res.__missing) ? [] : res;
      if (!Array.isArray(verdicts)) verdicts = [];
      var total = verdicts.length;
      if (!total) { strip.innerHTML = ''; return; } // absence of chrome, not an empty box
      var confirmed = 0, failed = 0;
      verdicts.forEach(function (v) {
        if (v.verdict === 'confirmed') confirmed++;
        else if (v.verdict === 'absent') failed++;
      });
      var html;
      if (failed === 0) {
        html = '<span class="ss-ok">Everything Claude claimed checks out</span> · ' +
          '<button class="ss-link" type="button" data-goto="report">see receipts</button>';
      } else {
        html = "Claude's claims: <span class=\"ss-ok\">" + confirmed + ' check out</span> · ' +
          '<span class="ss-bad">' + failed + " doesn't</span> — " +
          '<button class="ss-link" type="button" data-goto="report">see why</button>';
      }
      strip.innerHTML = html;
      var link = strip.querySelector('[data-goto]');
      if (link) link.addEventListener('click', function () { show('report'); });
    }).catch(function () { /* leave the strip as-is on transient errors */ });
  }

  // ---- build indicator: build-active from /api/health.lifecycleState, or
  //      inferred "live" from recent version bumps. Breathes near the map. ----
  var lastVersionBumpAt = 0, buildHintUntil = 0;
  function updateBuildIndicator() {
    var ind = document.getElementById('build-indicator');
    if (!ind) return;
    var active = (Date.now() < buildHintUntil) || (Date.now() - lastVersionBumpAt < 8000 && lastVersionBumpAt > 0);
    ind.hidden = !(current === 'map' && active);
  }
  function pollHealthForBuild() {
    api('/api/health').then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
      if (!h) return;
      var st = h.lifecycleState;
      if (st === 'build-active' || st === 'extraction-pending') buildHintUntil = Date.now() + 6000;
      updateBuildIndicator();
    }).catch(function () {});
  }

  // ---- THE MAP (home) — INFINITE CANVAS ----------------------------------
  // Consumes /api/flows (deriveFlows → UserFlow[] + derivePages → PageEntry[]).
  // We project the flows into a DETERMINISTIC node/edge model laid out in 3
  // vertical world bands (pages | doors | records), then draw it into ONE SVG
  // camera group (#cam). Pan/zoom only mutate #cam's transform — never relayout.
  //
  // Consistent 1.5px-stroke inline SVG type-glyphs (ink, one family). No emoji.
  var GLYPHS = {
    page: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor"/><path d="M2 6h12" stroke="currentColor"/><path d="M4.4 4.6h.01" stroke="currentColor"/></svg>',
    door: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13.5V5a4 4 0 0 1 8 0v8.5" stroke="currentColor"/><path d="M3 13.5h10" stroke="currentColor"/><path d="M9.7 8.4v1.2" stroke="currentColor"/></svg>',
    record: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" stroke="currentColor"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor"/></svg>',
    ghost: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8c1.2-1.6 2.8-1.6 4 0s2.8 1.6 4 0 2.8-1.6 4 0" stroke="currentColor"/></svg>',
    form: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor"/><path d="M5 6h6M5 8.5h6M5 11h3.5" stroke="currentColor"/></svg>'
  };
  var NODE_GLYPH = { page: 'page', form: 'form', endpoint: 'door', table: 'record', unknown: 'ghost' };
  var BAND_GLYPH = { page: 'page', form: 'form', door: 'door', record: 'record', ghost: 'ghost' };
  var STEP_CONCEPT = { page: 'page', form: 'form', endpoint: 'endpoint', guard: 'guard', table: 'records' };

  // world band x-centers + node geometry (world coordinates).
  // TIGHTENED so connected nodes sit close and wires are short legible arcs:
  // band centers are NODE_W + a snug gutter apart, vertical gap is compact.
  var NODE_W = 188, NODE_H = 46, ROW_GAP = 34;
  var BAND_GAP = NODE_W + 78;          // door is one node + a snug gutter from page
  var BAND_X = { page: 120, door: 120 + BAND_GAP, record: 120 + 2 * BAND_GAP, ghost: 120 + BAND_GAP };

  function firstStep(flow, kind) {
    var steps = flow.steps || [];
    for (var i = 0; i < steps.length; i++) if (steps[i].kind === kind) return steps[i];
    return null;
  }
  function lower(s) { return String(s).charAt(0).toLowerCase() + String(s).slice(1); }
  function flowRank(flow) {
    if (!flow.traced) return 3;
    if (firstStep(flow, 'table')) return 0;     // reaches a record
    if (firstStep(flow, 'endpoint')) return 1;  // door only
    return 2;
  }
  function doorVerb(label) {
    var l = String(label).toLowerCase();
    if (/log\s?in|signin|\blogin\b/.test(l)) return 'logs in';
    if (/sign\s?up|register|\bsignup\b/.test(l)) return 'signs up';
    if (/log\s?out|signout|\blogout\b/.test(l)) return 'logs out';
    return null;
  }
  // The plain-English flow caption ("When someone logs in"), shown on focus.
  function flowCaption(flow) {
    if (!flow.traced) return 'A request we can’t follow';
    var endpoint = firstStep(flow, 'endpoint');
    var verb = endpoint ? doorVerb(endpoint.label) : null;
    if (verb) return 'When someone ' + verb;
    var page = firstStep(flow, 'page');
    return page ? 'When someone uses ' + lower(page.label) : 'A journey through your app';
  }

  // ---- model: pages + nav + forms + flows → deterministic banded nodes ----
  // The map is now a RICH APP-STRUCTURE map that reads even with NO backend:
  //   · PAGE nodes (one per page route), connected by NAVIGATION edges (light,
  //     arrowed: "from Home you can go to Login/About"). Laid out by nav depth.
  //   · FORM nodes hang under their owning page, with a SUBMIT edge to a door
  //     (traced, teal pulse), an external marker, or an honest "can't trace"
  //     ghost (dashed, no pulse).
  //   · The BACKEND JOURNEY (door → records, guard on the protected wire) flows
  //     to the right when present.
  // A node: { id, band:'page'|'form'|'door'|'record'|'ghost', label, concept,
  //           step, x, y, ghost, depth?, path? }.
  // An edge: { id, from, to, traced, flowId, nav?, submit? }.
  // A guard: { id, edgeId, doorName, receipt, flowId }.
  function buildModel(flows, pages, nav, forms) {
    pages = pages || []; nav = nav || []; forms = forms || [];
    var ordered = (flows || []).slice().sort(function (a, b) { return flowRank(a) - flowRank(b); });
    var nodes = [], edges = [], guards = [], nodeById = {};
    var captions = {}; // flowId → caption sentence (for focus mode)
    function ensure(id, band, label, concept, step, ghost) {
      if (nodeById[id]) return nodeById[id];
      var n = { id: id, band: band, label: label, concept: concept, step: step || null, ghost: !!ghost, flows: {} };
      nodeById[id] = n; nodes.push(n);
      return n;
    }
    function pageId(path) { return 'vpage:' + path; }

    // --- 1. PAGE nodes (the navigation graph — the star of a frontend app) ---
    pages.forEach(function (p) {
      var n = ensure(pageId(p.path), 'page', p.label, 'page',
        { plain: p.label + ' (' + p.path + ') — a screen a visitor can open.', receipt: p.receipt || null });
      n.path = p.path;
      n.depth = (typeof p.depth === 'number') ? p.depth : -1;
    });

    // --- 2. NAVIGATION edges (page → page / external / unknown) -------------
    nav.forEach(function (l) {
      // resolve the source node: a real page if its path matches, else skip the
      // visual anchor onto the target's source page is unknown → anchor on the
      // FIRST page (so a shared Nav component's links still connect the graph).
      var fromN = nodeById[pageId(l.fromPath)];
      if (!fromN) {
        // shared component (e.g. Nav.tsx): anchor its links on the home/root page
        // so they read as "from here you can go to …" rather than floating.
        var root = pages.filter(function (p) { return p.depth === 0; })[0] || pages[0];
        if (root) fromN = nodeById[pageId(root.path)];
      }
      if (!fromN) return;
      var toN = null;
      if (l.toKind === 'page' && l.toPath) {
        toN = nodeById[pageId(l.toPath)];
        if (!toN) {
          // a linked page we don't have a node for → honest ghost
          toN = ensure('navghost:' + l.id, 'ghost', l.toLabel, null, null, true);
        }
      } else if (l.toKind === 'external') {
        toN = ensure('ext:' + (l.toUrl || l.id), 'ghost', l.toLabel, null,
          { plain: l.toLabel + ' — this link leaves your app for another website.', receipt: l.receipt || null }, true);
        toN.external = true;
      } else {
        toN = ensure('navghost:' + l.id, 'ghost', l.toLabel, null,
          { plain: l.toLabel + ' — a link the code doesn’t spell out, so we can’t follow it.', receipt: l.receipt || null }, true);
      }
      if (!toN || toN.id === fromN.id) return;
      var eid = 'nav:' + fromN.id + '->' + toN.id;
      if (!edges.some(function (e) { return e.id === eid; })) {
        edges.push({ id: eid, from: fromN.id, to: toN.id, traced: !!l.traced, nav: true, flowId: 'nav:' + l.id });
      }
    });

    // --- 3. FORM nodes (attached under their owner page) + submit edges -----
    // Track which form files own a backend journey, so we don't ALSO draw the
    // flow-derived "Login form" page node for the same submit (no double-login).
    var formFiles = {};
    forms.forEach(function (f) {
      var fid = 'form:' + f.id;
      var fnode = ensure(fid, 'form', f.label, 'form',
        { plain: f.label + ' — ' + (f.traced ? 'it sends what someone types to ' + f.destLabel + '.' : 'it sends what someone types somewhere we can’t trace.'), receipt: f.receipt || null });
      fnode.ownerPath = f.ownerPath || null;
      if (f.receipt && f.receipt.file) formFiles[f.receipt.file] = true;
      // owner edge: page → form (so the form hangs off its page). Light, no pulse.
      var owner = f.ownerPath ? nodeById[pageId(f.ownerPath)] : null;
      if (owner) {
        var oid = 'owns:' + owner.id + '->' + fid;
        if (!edges.some(function (e) { return e.id === oid; })) {
          edges.push({ id: oid, from: owner.id, to: fid, traced: true, owns: true, flowId: 'form:' + f.id });
        }
      }
      // submit edge: form → door / external / ghost.
      var toN = null;
      if (f.dest === 'route' && f.destPath) {
        toN = ensure('door:' + f.destLabel, 'door', f.destLabel, 'endpoint',
          { plain: 'A door into your app at ' + f.destPath + '.', receipt: null });
      } else if (f.dest === 'external') {
        toN = ensure('ext:form:' + f.id, 'ghost', f.destLabel, null,
          { plain: f.destLabel + ' — this form posts to another website.', receipt: f.receipt || null }, true);
        toN.external = true;
      } else {
        toN = ensure('ghost:form:' + f.id, 'ghost', 'somewhere we can’t trace', null, null, true);
      }
      if (toN) {
        var sid = 'submit:' + fid + '->' + toN.id;
        if (!edges.some(function (e) { return e.id === sid; })) {
          edges.push({ id: sid, from: fid, to: toN.id, traced: !!f.traced, submit: true, flowId: 'form:' + f.id });
        }
        fnode.flows['form:' + f.id] = true;
        if (toN.band === 'door') toN.flows['form:' + f.id] = true;
      }
      captions['form:' + f.id] = f.traced ? 'When someone submits the ' + lower(f.label) : 'A form we can’t fully trace';
    });

    // --- 4. BACKEND JOURNEY from flows: door → records (+ guard) -----------
    // Forms already carry the form→door hop; here we extend doors to records and
    // attach guards. Flows whose caller is a FORM file are not re-drawn as a
    // separate page node (the form node represents that submit).
    ordered.forEach(function (flow) {
      captions[flow.id] = flowCaption(flow);
      var page = firstStep(flow, 'page');
      var endpoint = firstStep(flow, 'endpoint');
      var guard = firstStep(flow, 'guard');
      var table = firstStep(flow, 'table');
      var callerFile = page && page.receipt ? page.receipt.file : null;
      var isFormFlow = callerFile && formFiles[callerFile];

      if (flow.traced && endpoint) {
        var door = ensure('door:' + endpoint.label, 'door', endpoint.label, 'endpoint', endpoint);
        door.flows[flow.id] = true;
        // door → records
        if (table) {
          var rec = ensure('rec:' + table.label, 'record', table.label, 'records', table);
          rec.flows[flow.id] = true;
          var reid = 'e:' + door.id + '->' + rec.id;
          if (!edges.some(function (e) { return e.id === reid; })) {
            edges.push({ id: reid, from: door.id, to: rec.id, traced: true, flowId: flow.id });
          }
        }
        // if this flow is NOT a form (e.g. a bare client call), draw its caller
        // page node + page→door edge so non-form journeys still render.
        if (!isFormFlow && page) {
          var cn = ensure('caller:' + page.label + ':' + (callerFile || flow.id), 'form', page.label, 'page', page);
          cn.flows[flow.id] = true;
          var ceid = 'e:' + cn.id + '->' + door.id;
          if (!edges.some(function (e) { return e.id === ceid; })) {
            edges.push({ id: ceid, from: cn.id, to: door.id, traced: true, submit: true, flowId: flow.id });
          }
        }
        // guard sits on the wire that reaches this door (form→door or caller→door)
        if (guard) {
          var protectedEdge = edges.filter(function (e) { return e.to === door.id && (e.submit || e.owns !== true) && !e.nav; })[0];
          if (protectedEdge) {
            var gid = 'g:' + protectedEdge.id;
            if (!guards.some(function (g) { return g.id === gid; })) {
              guards.push({ id: gid, edgeId: protectedEdge.id, doorName: endpoint ? endpoint.label : 'this door',
                receipt: guard.receipt || null, flowId: flow.id });
            }
          }
        }
      } else if (!isFormFlow) {
        // untraced client-call flow (e.g. "A button that loads data") → ghost.
        var cn2 = ensure('caller:' + (page ? page.label : flow.id) + ':' + (callerFile || flow.id), 'form', page ? page.label : 'A request', 'page', page);
        cn2.flows[flow.id] = true;
        var gh = ensure('ghost:' + flow.id, 'ghost', 'somewhere I can’t trace', null, null, true);
        gh.flows[flow.id] = true;
        var geid = 'e:' + cn2.id + '->' + gh.id;
        if (!edges.some(function (e) { return e.id === geid; })) {
          edges.push({ id: geid, from: cn2.id, to: gh.id, traced: false, submit: true, flowId: flow.id });
        }
      }
    });

    layout(nodes, edges);
    // PRESERVE user-dragged positions across live re-renders: the deterministic
    // layout above sets defaults; any node the user moved keeps its override.
    nodes.forEach(function (n) {
      var p = nodePos[n.id];
      if (p) { n.x = p.x; n.y = p.y; }
    });
    return { nodes: nodes, edges: edges, guards: guards, nodeById: nodeById, captions: captions };
  }

  // Deterministic layout, left → right by ROLE:
  //   PAGES (by nav depth: home at left, deeper screens further right)
  //     → FORMS (hang just right/below their owning page)
  //       → DOORS (endpoints) → RECORDS (tables). Ghosts tuck below the forms.
  // No Math.random / Date.now — purely a function of the model. fitAll centers it.
  function pageColX(depth) {
    // depth 0,1,2… each step is one tight column; unreachable (-1) share col 0.
    var d = depth >= 0 ? depth : 0;
    return BAND_X.page + d * (NODE_W + 60);
  }
  function layout(nodes, edges) {
    var pages = [], formsB = [], doors = [], records = [], ghosts = [];
    nodes.forEach(function (n) {
      if (n.band === 'page') pages.push(n);
      else if (n.band === 'form') formsB.push(n);
      else if (n.band === 'door') doors.push(n);
      else if (n.band === 'record') records.push(n);
      else ghosts.push(n);
    });

    // --- pages: grouped into depth columns, stacked vertically within a column.
    var byDepth = {};
    var maxDepth = 0;
    pages.forEach(function (n) {
      var d = n.depth >= 0 ? n.depth : 0;
      if (d > maxDepth) maxDepth = d;
      (byDepth[d] = byDepth[d] || []).push(n);
    });
    Object.keys(byDepth).forEach(function (d) {
      var list = byDepth[d];
      list.sort(function (a, b) { return (a.path || a.id) < (b.path || b.id) ? -1 : 1; });
      var totalH = list.length > 0 ? (list.length - 1) * (NODE_H + ROW_GAP) : 0;
      var startY = -totalH / 2;
      list.forEach(function (node, i) {
        node.x = pageColX(node.depth >= 0 ? node.depth : 0) - NODE_W / 2;
        node.y = startY + i * (NODE_H + ROW_GAP);
      });
    });

    // helper: a node's owner page (for forms) or source (for doors).
    function fromOf(id) { for (var i = 0; i < edges.length; i++) if (edges[i].to === id && !edges[i].nav) return edges[i].from; return null; }

    // x for the columns to the RIGHT of the deepest page column.
    var formX = pageColX(maxDepth) + (NODE_W + 70);
    var doorX = formX + (NODE_W + 70);
    var recordX = doorX + (NODE_W + 70);

    // --- forms (+ bare client-call callers): sit in the form column, anchored
    //     near their owning page's y, then swept so none overlap. The preferred
    //     y is the owner page's y (so a form reads as "belongs to this page"); a
    //     caller with no owner falls back to its own door's y. ---
    formsB.forEach(function (node) {
      var ownerId = fromOf(node.id);
      var owner = ownerId ? nodeFromList(nodes, ownerId) : null;
      node._prefY = owner ? owner.y : 0;
      node.x = formX - NODE_W / 2;
    });
    formsB.sort(function (a, b) {
      if (a._prefY !== b._prefY) return a._prefY - b._prefY;
      return a.id < b.id ? -1 : 1;
    });
    // sweep top→bottom guaranteeing a minimum gap of NODE_H + 18 between forms.
    var MIN_GAP = NODE_H + 18;
    var lastY = -1e9;
    formsB.forEach(function (node) {
      var y = node._prefY;
      if (y < lastY + MIN_GAP) y = lastY + MIN_GAP;
      node.y = y;
      lastY = y;
      delete node._prefY;
    });

    // --- doors: ranked by the y of whatever connects INTO them (form/page). ---
    function inY(n) {
      var src = fromOf(n.id); var s = src ? nodeFromList(nodes, src) : null;
      return s ? s.y : 9999;
    }
    doors.sort(function (a, b) { var ya = inY(a), yb = inY(b); if (ya !== yb) return ya - yb; return a.id < b.id ? -1 : 1; });
    placeCol(doors, doorX, doors.length ? inYStart(doors) : 0);

    records.sort(function (a, b) { var ya = inY(a), yb = inY(b); if (ya !== yb) return ya - yb; return a.id < b.id ? -1 : 1; });
    placeCol(records, recordX, records.length ? inYStart(records) : 0);

    // --- ghosts: tuck near whatever points at them (their source's y). ---
    ghosts.sort(function (a, b) { var ya = inY(a), yb = inY(b); if (ya !== yb) return ya - yb; return a.id < b.id ? -1 : 1; });
    ghosts.forEach(function (node) {
      var src = fromOf(node.id); var s = src ? nodeFromList(nodes, src) : null;
      var sx = s ? s.x : formX - NODE_W / 2;
      node.x = sx + (NODE_W + 70);
      node.y = s ? s.y : 0;
      // nudge so a ghost never lands exactly on a door
      while (occupied(nodes, node)) node.y += (NODE_H + 16);
    });

    function inYStart(list) {
      // align the column's first node to the min source y so wires stay short
      var minY = 9999;
      list.forEach(function (n) { minY = Math.min(minY, inY(n)); });
      return minY === 9999 ? 0 : minY;
    }
    function placeCol(list, x, startY) {
      list.forEach(function (node, i) { node.x = x - NODE_W / 2; node.y = startY + i * (NODE_H + ROW_GAP); });
    }
  }
  function nodeFromList(nodes, id) { for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i]; return null; }
  function occupied(nodes, self) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]; if (n === self) continue;
      if (Math.abs(n.x - self.x) < 4 && Math.abs(n.y - self.y) < NODE_H) return true;
    }
    return false;
  }

  // ---- camera (CSS transform on #world only) ------------------------------
  // The CORE FIX: pan/zoom set #world.style.transform = translate(TXpx,TYpx)
  // scale(K). #world is a normal DIV, so Chromium applies this to BOTH its child
  // SVG wire layer AND its child HTML node divs identically — wires and nodes
  // stay locked together. (cam.tx/ty are TX/TY screen px, cam.k is K.)
  // Screen->world: wx = (sx - TX)/K. World->screen: sx = wx*K + TX.
  var cam = { tx: 0, ty: 0, k: 1 };          // applied (TX, TY, K)
  var camTarget = { tx: 0, ty: 0, k: 1 };    // lerped toward
  var camAnimating = false;
  var userInteractedAt = 0;                  // for skip-auto-frame
  var K_MIN = 0.35, K_MAX = 2.6;
  function clampK(k) { return Math.max(K_MIN, Math.min(K_MAX, k)); }
  function applyCam() {
    var world = document.getElementById('world');
    if (world) {
      world.style.transform = 'translate(' + cam.tx.toFixed(2) + 'px,' + cam.ty.toFixed(2) + 'px) scale(' + cam.k.toFixed(4) + ')';
    }
    // keep the system-map screen-pinned layer captions aligned to their columns
    if (systemMode) positionSysCaptions();
  }
  function setCamInstant(tx, ty, k) {
    cam.tx = camTarget.tx = tx; cam.ty = camTarget.ty = ty; cam.k = camTarget.k = clampK(k);
    applyCam();
  }
  function camLoop() {
    var dx = camTarget.tx - cam.tx, dy = camTarget.ty - cam.ty, dk = camTarget.k - cam.k;
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(dk) < 0.0008) {
      cam.tx = camTarget.tx; cam.ty = camTarget.ty; cam.k = camTarget.k; applyCam();
      camAnimating = false; return;
    }
    var e = 0.22;
    cam.tx += dx * e; cam.ty += dy * e; cam.k += dk * e;
    applyCam();
    requestAnimationFrame(camLoop);
  }
  function nudgeCam() {
    if (reduceMotion) { cam.tx = camTarget.tx; cam.ty = camTarget.ty; cam.k = camTarget.k; applyCam(); return; }
    if (!camAnimating) { camAnimating = true; requestAnimationFrame(camLoop); }
  }
  function canvasSize() {
    var host = document.getElementById('canvas-viewport');
    var r = host ? host.getBoundingClientRect() : { width: 800, height: 500 };
    return { w: r.width || 800, h: r.height || 500 };
  }
  // current floating-header height (read the CSS var, fall back to 60)
  function headerInset() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
      var n = parseFloat(v);
      if (n > 0) return n;
    } catch (e) {}
    return 60;
  }
  // frame a world bounding box CENTERED in the viewport's AVAILABLE region.
  // The full-bleed map floats a header over the top and zoom controls bottom-
  // right, so we reserve a TOP inset (header height + margin) and a small BOTTOM
  // inset, then center the graph inside what's left on BOTH axes. opts:
  //   pad      — comfortable world-padding around the bbox (default 70)
  //   insets   — {top,bottom,left,right} screen px reserved (default header-aware)
  //   maxK     — clamp so a tiny graph isn't blown up too large
  //   instant  — snap (reduced-motion / resize) vs eased
  function frameBox(bb, pad, instant, opts) {
    if (!bb) return;
    opts = opts || {};
    var sz = canvasSize();
    pad = pad == null ? 70 : pad;
    var ins = opts.insets || {};
    var top = ins.top == null ? (headerInset() + 22) : ins.top;
    var bottom = ins.bottom == null ? 78 : ins.bottom;   // clear the zoom controls
    var left = ins.left == null ? 24 : ins.left;
    var right = ins.right == null ? 24 : ins.right;
    // the rectangle on screen the graph must fit/center inside
    var availW = Math.max(40, sz.w - left - right);
    var availH = Math.max(40, sz.h - top - bottom);
    var bw = Math.max(1, bb.x2 - bb.x1), bh = Math.max(1, bb.y2 - bb.y1);
    var maxK = opts.maxK == null ? 1.35 : opts.maxK;
    var k = Math.min((availW - pad * 2) / bw, (availH - pad * 2) / bh);
    k = clampK(Math.min(k, maxK));
    var cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
    // center of the AVAILABLE region in screen space
    var scx = left + availW / 2, scy = top + availH / 2;
    var tx = scx - cx * k, ty = scy - cy * k;
    if (instant) setCamInstant(tx, ty, k);
    else { camTarget.tx = tx; camTarget.ty = ty; camTarget.k = clampK(k); nudgeCam(); }
  }
  function nodesBBox(list) {
    if (!list || !list.length) return null;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    list.forEach(function (n) {
      if (n.x == null) return;
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + NODE_W); y2 = Math.max(y2, n.y + NODE_H);
    });
    if (x1 === Infinity) return null;
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }
  // Fit the WHOLE graph, centered in the available region (header-inset aware),
  // targeting ~70-80% viewport fill — clamped so a small graph never balloons.
  function fitAll(instant) {
    frameBox(nodesBBox(currentModel ? currentModel.nodes : []), 56, instant, { maxK: 1.3 });
  }

  // ---- rendering into the camera -----------------------------------------
  var SVGNS = 'http://www.w3.org/2000/svg';
  var currentModel = null;
  var renderedNodeIds = {};   // id → host <g> element (for diffing live builds)
  var renderedEdgeIds = {};
  var pulseRegistry = [];     // {edge, pathEl, pulseEl}

  // ---- world-space band labels (under #cam, so they pan/zoom WITH nodes) ----
  // One caption above each band's column, anchored at the band's world x-center
  // and a margin ABOVE that band's topmost node, so they never overlap a node
  // and never desync when the user pans (they live in the same coordinate space).
  var BAND_CAPTION = { page: 'Pages people can visit', form: 'Forms', door: 'Doors into your app', record: 'Your records' };
  function renderBandLabels(model) {
    var layer = document.getElementById('band-labels');
    if (!layer) return;
    layer.innerHTML = '';
    // For each labeled band, compute the topmost node y and the x-center across
    // its (possibly multi-column) nodes — pages now spread across depth columns.
    var tops = {}, sumX = {}, cnt = {};
    model.nodes.forEach(function (n) {
      if (n.ghost) return;
      var b = n.band;
      if (b !== 'page' && b !== 'form' && b !== 'door' && b !== 'record') return;
      if (tops[b] == null || n.y < tops[b]) tops[b] = n.y;
      sumX[b] = (sumX[b] || 0) + (n.x + NODE_W / 2);
      cnt[b] = (cnt[b] || 0) + 1;
    });
    ['page', 'form', 'door', 'record'].forEach(function (b) {
      if (tops[b] == null) return;            // no node in this band → no label
      var t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', 'band-label band-label-' + b);
      t.setAttribute('x', (sumX[b] / cnt[b]).toFixed(1));
      t.setAttribute('y', (tops[b] - 30).toFixed(1));
      t.textContent = BAND_CAPTION[b];
      layer.appendChild(t);
    });
  }

  // a node's rendered height (system nodes are taller — card body + brand bar;
  // cron-rail nodes are short). Connect wires to the card BODY center, not the
  // whole-card center, so a line never appears to pierce the brand bar.
  function nodeConnH(n) {
    if (n && n.sys) {
      if (n.cronRail) return 56;
      return SYS_NODE_H - 19;   // body height (brand bar is 19px at the bottom)
    }
    return NODE_H;
  }
  function edgePath(from, to) {
    // TOP-DOWN flow: smooth cubic bezier from the BOTTOM-center of the source
    // down to the TOP-center of the target. Connect to the card body, not
    // through the 19px brand bar (nodeConnH).
    var ax = from.x + NODE_W / 2, ay = from.y + nodeConnH(from);
    var bx = to.x + NODE_W / 2, by = to.y;
    if (by >= ay) {
      var dy = Math.max(40, (by - ay) * 0.4);
      return 'M' + ax.toFixed(1) + ',' + ay.toFixed(1) +
        ' C' + ax.toFixed(1) + ',' + (ay + dy).toFixed(1) +
        ' ' + bx.toFixed(1) + ',' + (by - dy).toFixed(1) +
        ' ' + bx.toFixed(1) + ',' + by.toFixed(1);
    }
    // target sits at/above the source (back-edge or a side gutter node) — route
    // out the bottom and curve up to the target's top so it never spears the card.
    return 'M' + ax.toFixed(1) + ',' + ay.toFixed(1) +
      ' C' + ax.toFixed(1) + ',' + (ay + 36).toFixed(1) +
      ' ' + bx.toFixed(1) + ',' + (by - 36).toFixed(1) +
      ' ' + bx.toFixed(1) + ',' + by.toFixed(1);
  }

  function loadMap() {
    // PRIMARY VIEW: if a SystemMap exists (nodes>0) render the layered system
    // map. Otherwise fall back to the existing nav/forms map (kept intact).
    // GUIDED TOUR: when a tour ALSO exists, the first map load enters tour mode
    // (the comprehension fix) — the map assembles itself one beat at a time
    // instead of dumping the whole thing. We fetch the tour in parallel so the
    // first system-map render already knows whether to start hidden.
    getJSON('/api/system-map').then(function (res) {
      var map = (res && res.__missing) ? null : res;
      if (map && map.nodes && map.nodes.length) {
        // load the tour once; if present and not yet shown, enter tour mode.
        ensureTour(function (tour) {
          if (tour && tour.beats && tour.beats.length && !tourEverShown) {
            // If onboarding is still up, draw the static map underneath and stash
            // the tour — it starts the moment they pick an audience.
            if (onboardingPending) { pendingTour = { map: map, tour: tour }; loadSystemMap(map); }
            else startTour(map, tour);
          } else {
            loadSystemMap(map);
          }
        });
      } else {
        loadFlowsMap();
      }
    }).catch(function () {
      // a transient system-map error should not blank the map — fall back.
      loadFlowsMap();
    });
    // STALE banner: the structure may be out of date while a build is active.
    getJSON('/api/graph').then(function (res) {
      var g = (res && res.__missing) ? null : res;
      var stale = document.getElementById('map-stale');
      if (!stale) return;
      if (!g || !g.generatedAt) { stale.hidden = true; return; }
      var age = Date.now() - new Date(g.generatedAt).getTime();
      stale.hidden = !(g.buildActive && age > 60000);
    }).catch(function () {});
  }
  function loadFlowsMap() {
    systemMode = false;
    setSystemChrome(null);
    getJSON('/api/flows').then(function (res) {
      var data = (res && res.__missing) ? { flows: [], pages: [], nav: [], forms: [] } : res;
      renderCanvas((data && data.flows) || [], (data && data.pages) || [], (data && data.nav) || [], (data && data.forms) || []);
    }).catch(function () {
      var empty = document.getElementById('canvas-empty');
      if (empty) { empty.hidden = false; empty.textContent = 'Couldn’t read your app’s structure right now.'; }
    });
  }

  // =========================================================================
  // THE LAYERED SYSTEM MAP — full live breakdown for non-technical people.
  // Reuses the same camera (#world CSS transform), draggable HTML nodes, SVG
  // wires, pulses, fitAll and nodePos override map. A SystemMap drives it:
  //   { what, nodes[], edges[], dataFlows[], concerns[] }
  // Five left-to-right LAYER columns (frontend | servers | data | external)
  // with a small SCHEDULED rail above servers. Database tables are a CLUSTER
  // attached to their database node, revealed on expand (progressive disclosure).
  // =========================================================================
  var systemMode = false;
  var systemMap = null;          // the raw SystemMap
  var expandedDbs = {};          // dbId -> true when its table cluster is shown

  // provider → { name, primary, tint, onPrimary }. The REAL recognizable brand
  // palette per provider, so the map is colorful and you can tell Claude vs Neon
  // vs Stripe at a glance:
  //   primary    = the brand color (the bottom brand-bar background / card border)
  //   tint       = a very light brand bg (the branded card background)
  //   onPrimary  = the text color that meets ~4.5:1 on the primary (light brand
  //                primaries like neon/supabase/aws use a dark ink instead of #fff)
  // 'unknown' is a neutral stone grey so unbranded nodes stay calm.
  var PROVIDER_BRAND = {
    railway:    { name: 'Railway',    primary: '#8257E5', tint: '#F1ECFD', onPrimary: '#fff' },
    vercel:     { name: 'Vercel',     primary: '#111111', tint: '#F1F1F1', onPrimary: '#fff' },
    neon:       { name: 'Neon',       primary: '#00E599', tint: '#E3FBF2', onPrimary: '#06281E' },
    supabase:   { name: 'Supabase',   primary: '#3ECF8E', tint: '#E8FBF1', onPrimary: '#0B3D2A' },
    postgres:   { name: 'Postgres',   primary: '#336791', tint: '#E9F0F6', onPrimary: '#fff' },
    redis:      { name: 'Redis',      primary: '#D82C20', tint: '#FCEAE8', onPrimary: '#fff' },
    docker:     { name: 'Docker',     primary: '#2496ED', tint: '#E7F2FD', onPrimary: '#fff' },
    fly:        { name: 'Fly.io',     primary: '#7B3FE4', tint: '#F0E9FD', onPrimary: '#fff' },
    cloudflare: { name: 'Cloudflare', primary: '#F38020', tint: '#FEF1E5', onPrimary: '#1c1917' },
    aws:        { name: 'AWS',        primary: '#FF9900', tint: '#FFF3E0', onPrimary: '#1c1917' },
    openai:     { name: 'OpenAI',     primary: '#10A37F', tint: '#E7F6F1', onPrimary: '#fff' },
    anthropic:  { name: 'Anthropic',  primary: '#CC785C', tint: '#F7EEE9', onPrimary: '#fff' },
    stripe:     { name: 'Stripe',     primary: '#635BFF', tint: '#ECEBFF', onPrimary: '#fff' },
    instagram:  { name: 'Instagram',  primary: '#E1306C', tint: '#FCE9F1', onPrimary: '#fff' },
    tiktok:     { name: 'TikTok',     primary: '#EE1D52', tint: '#FFE9EE', onPrimary: '#fff' },
    unknown:    { name: '',           primary: '#78716C', tint: '#F5F5F4', onPrimary: '#fff' }
  };
  // legacy alias: some callers still read .label/.tint — keep them working but
  // sourced from PROVIDER_BRAND (label = brand name; tint = the brand primary so
  // the old "tinted dot" stays the brand color).
  function provBrand(p) { return PROVIDER_BRAND[p] || PROVIDER_BRAND.unknown; }
  function provStyle(p) {
    var b = provBrand(p);
    return { label: b.name, tint: b.primary, primary: b.primary, onPrimary: b.onPrimary, bg: b.tint };
  }
  // does this node's whole CARD get branded (tint bg + primary border)? External
  // services + data stores (database/cache) read as that org's color/theme.
  function nodeIsBranded(n) {
    return n && (n.kind === 'externalService' || n.kind === 'database' || n.kind === 'cache') && n.provider && n.provider !== 'unknown';
  }
  // the most specific display name for a node's brand bar: prefer the node's host
  // (e.g. "Sendblue", "api.openai.com") when it adds information beyond the bare
  // provider name; else fall back to the provider's brand name.
  function brandBarName(n) {
    var b = provBrand(n.provider);
    var host = (n.host || '').trim();
    if (host && b.name && host.toLowerCase() !== b.name.toLowerCase()) {
      // a short, more-specific host wins (e.g. "Sendblue" over "unknown"); a long
      // technical host (with dots/slashes) falls back to the clean brand name.
      if (host.length <= 18 && !/[\/]/.test(host)) return host;
    }
    if (b.name) return b.name;
    if (host) return host;
    return 'service';
  }

  // one inline-SVG glyph per kind (1.5px stroke, ink, consistent). No emoji.
  var SYS_GLYPHS = {
    page: GLYPHS.page,
    server: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="4" rx="1" stroke="currentColor"/><rect x="2.5" y="9.5" width="11" height="4" rx="1" stroke="currentColor"/><path d="M5 4.5h.01M5 11.5h.01" stroke="currentColor"/></svg>',
    worker: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2" stroke="currentColor"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" stroke="currentColor"/></svg>',
    scraper: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8" stroke="currentColor"/><path d="M4.5 7L8 10.5 11.5 7" stroke="currentColor"/><path d="M3 13.5h10" stroke="currentColor"/></svg>',
    database: GLYPHS.record,
    cache: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 1.5L3 9h4l-.8 5.5L13 6.5H8.6L9 1.5z" stroke="currentColor"/></svg>',
    dataTable: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1" stroke="currentColor"/><path d="M2.5 6.5h11M2.5 9.5h11M6 6.5v6.5" stroke="currentColor"/></svg>',
    externalService: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor"/><path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 12.4 8 14C6.2 12.4 5.2 10.2 5.2 8S6.2 3.6 8 2z" stroke="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor"/></svg>',
    cron: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor"/><path d="M8 4.5V8l2.4 1.6" stroke="currentColor"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6l3 3 3-3" stroke="currentColor"/></svg>'
  };
  function sysGlyph(kind) { return SYS_GLYPHS[kind] || SYS_GLYPHS.server; }

  // five layers laid left→right. Scheduled sits as a small rail ABOVE servers.
  var SYS_LAYERS = ['frontend', 'servers', 'data', 'external'];
  var SYS_LAYER_CAPTION = {
    frontend: { title: 'WHAT PEOPLE SEE', sub: 'pages and screens' },
    servers:  { title: 'SERVERS DOING THE WORK', sub: 'the services that run code' },
    data:     { title: 'WHERE DATA LIVES', sub: 'databases and caches' },
    external: { title: 'OUTSIDE SERVICES', sub: 'third parties you call' }
  };
  // column x-centers (world px). TIGHTER gutters than before so connecting wires
  // are short and the relationship is obvious — but still enough room for the
  // brand bars + the clamped edge labels. Each layer shares ONE x (clean
  // columns, no jitter). The column GAP = node width + a fixed gutter.
  var SYS_COL_GUTTER = 132;                 // was 170 — pulled the columns closer
  var SYS_COL_GAP = NODE_W + SYS_COL_GUTTER;
  var SYS_COL_X = {
    frontend: 160,
    servers:  160 + SYS_COL_GAP,
    data:     160 + 2 * SYS_COL_GAP,
    external: 160 + 3 * SYS_COL_GAP
  };
  // taller node (card body + the 19px brand bar) and a consistent row gap.
  var SYS_NODE_H = 66, SYS_ROW_GAP = 26, SYS_CRON_GAP = 24;

  function layerOf(n) {
    if (n.layer) return n.layer;
    var k = n.kind;
    if (k === 'page') return 'frontend';
    if (k === 'database' || k === 'cache' || k === 'dataTable') return 'data';
    if (k === 'externalService') return 'external';
    if (k === 'cron') return 'scheduled';
    return 'servers';
  }

  // ---- model: SystemMap → deterministic layer-banded nodes/edges ----------
  // dataTable nodes are NOT laid out top-level; they cluster under their owning
  // database (revealed on expand). Top-level edges into a table are re-pointed
  // to the table's database so the flow reads server→database, not server→table.
  function buildSystemModel(map) {
    var nodes = [], nodeById = {}, edges = [], captions = {};
    var tablesByDb = {};   // dbId -> [tableNode]
    var dbList = [];       // database/cache nodes (the data-layer top-level nodes)
    var tableToDb = {};    // tableId -> dbId (for edge re-pointing)

    // index every source node
    var srcById = {};
    map.nodes.forEach(function (n) { srcById[n.id] = n; });

    // figure out which database each table belongs to: prefer an edge from a
    // database to the table; else attach to the first database in the map.
    var firstDb = null;
    map.nodes.forEach(function (n) { if (!firstDb && (n.kind === 'database' || n.kind === 'cache')) firstDb = n.id; });
    // build a quick lookup: does an edge connect a db to this table?
    map.edges.forEach(function (e) {
      var f = srcById[e.from], t = srcById[e.to];
      if (f && t && (f.kind === 'database' || f.kind === 'cache') && t.kind === 'dataTable') tableToDb[t.id] = f.id;
      if (f && t && (t.kind === 'database' || t.kind === 'cache') && f.kind === 'dataTable') tableToDb[f.id] = t.id;
    });

    map.nodes.forEach(function (n) {
      if (n.kind === 'dataTable') {
        var db = tableToDb[n.id] || firstDb;
        if (db) {
          tableToDb[n.id] = db;
          (tablesByDb[db] = tablesByDb[db] || []).push(n);
        }
        return; // tables are clustered, not top-level
      }
      var layer = layerOf(n);
      var node = {
        id: n.id, sys: true, kind: n.kind, layer: layer,
        label: n.label, technical: n.technical || '', host: n.host || '',
        provider: n.provider || 'unknown', file: n.file || null,
        note: n.note || null, sensitive: n.sensitive || null,
        flows: {}, neighbors: {}
      };
      nodeById[n.id] = node; nodes.push(node);
      if (n.kind === 'database' || n.kind === 'cache') dbList.push(node);
    });

    // edges: re-point any endpoint that is a table to its database; drop
    // edges that became self-loops (server→table where table is in this db are
    // represented by the server→database edge). Keep db↔table internal edges out.
    var seen = {};
    map.edges.forEach(function (e) {
      var from = tableToDb[e.from] || e.from;
      var to = tableToDb[e.to] || e.to;
      // drop database↔its-own-table internal edges (the cluster shows that)
      var sf = srcById[e.from], st = srcById[e.to];
      var fromIsTable = sf && sf.kind === 'dataTable';
      var toIsTable = st && st.kind === 'dataTable';
      if (fromIsTable && to === (tableToDb[e.from] || '')) return;
      if (toIsTable && from === (tableToDb[e.to] || '')) return;
      if (from === to) return;
      if (!nodeById[from] || !nodeById[to]) return;
      var eid = 'sys:' + from + '->' + to;
      if (seen[eid]) {
        // merge flow text from a second collapsed table-edge
        return;
      }
      seen[eid] = true;
      var fNode = nodeById[from], tNode = nodeById[to];
      var extNode = (tNode.kind === 'externalService') ? tNode : (fNode.kind === 'externalService') ? fNode : null;
      var external = !!extNode;
      var ed = {
        id: eid, from: from, to: to, flows: e.flows || '',
        file: e.file || null, intended: !!e.intended, external: external,
        // the external service's provider drives the edge's brand tint (a line to
        // Claude is Anthropic-coral, a line to a Stripe service is Stripe-violet).
        extProvider: extNode ? (extNode.provider || 'unknown') : null
      };
      edges.push(ed);
      captions[eid] = e.flows || '';
      // wire up neighbor + flow membership for focus mode
      fNode.flows[eid] = true; tNode.flows[eid] = true;
      fNode.neighbors[to] = true; tNode.neighbors[from] = true;
    });

    // record the clustered tables on their db node (sorted: sensitive first)
    dbList.forEach(function (db) {
      var tabs = tablesByDb[db.id] || [];
      tabs.sort(function (a, b) {
        var as = (a.sensitive && a.sensitive.length) ? 0 : 1;
        var bs = (b.sensitive && b.sensitive.length) ? 0 : 1;
        if (as !== bs) return as - bs;
        return a.label < b.label ? -1 : 1;
      });
      db.tables = tabs;
    });

    layoutSystem(nodes, edges);
    // preserve user-dragged positions across live re-renders
    nodes.forEach(function (n) { var p = nodePos[n.id]; if (p) { n.x = p.x; n.y = p.y; } });
    return { nodes: nodes, edges: edges, guards: [], nodeById: nodeById, captions: captions, system: true, raw: map };
  }

  // Tidy layered layout. Each layer is one clean vertical column sharing a single
  // x (no jitter) with CONSISTENT row spacing. To minimize wire crossings we run
  // a deterministic barycenter sweep: order each column by the average position
  // of its connected neighbors in the adjacent columns, so connected nodes sit
  // near each other. No Math.random / Date.now — purely a function of the model.
  // TOP-DOWN HIERARCHICAL layout (a layered DAG / flowchart, per the layout
  // spec): rank nodes by flow depth so the picture reads top→bottom like a
  // document — "what starts an action" at the top, "where it ends up" (the
  // database + AI services) at the bottom. Within each rank, order to minimize
  // crossing wires (median heuristic). The result: a clear vertical spine
  // (page → API → queue → worker → database) with leaves fanning out, instead
  // of the old fixed columns that forced every write into a long diagonal.
  // Fully deterministic: id-sorted iteration, fixed sweep counts, stable sorts.
  function layoutSystem(nodes, edges) {
    var NW = NODE_W, NH = SYS_NODE_H, RGAP = 96, XGAP = 30;
    var ns = nodes.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var idOf = {}; ns.forEach(function (n) { idOf[n.id] = n; n.cronRail = (n.kind === 'cron'); });
    var es = edges.slice()
      .filter(function (e) { return e.from && e.to && e.from !== e.to && idOf[e.from] && idOf[e.to]; })
      .sort(function (a, b) { var ka = a.from + '>' + a.to, kb = b.from + '>' + b.to; return ka < kb ? -1 : 1; });

    // ── PHASE 0: forward adjacency + deterministic cycle break (DFS) ──
    var rawFwd = {}; ns.forEach(function (n) { rawFwd[n.id] = []; });
    es.forEach(function (e) { rawFwd[e.from].push(e.to); });
    var backKey = {}, state = {};
    function visit(u) {
      state[u] = 1;
      rawFwd[u].forEach(function (v) {
        if (state[v] === 1) backKey[u + '>' + v] = true;   // back-edge (cycle)
        else if (!state[v]) visit(v);
      });
      state[u] = 2;
    }
    ns.forEach(function (n) { if (!state[n.id]) visit(n.id); });

    // forward DAG (back-edges excluded from ranking/ordering)
    var fwd = {}, indeg = {};
    ns.forEach(function (n) { fwd[n.id] = []; indeg[n.id] = 0; });
    es.forEach(function (e) { if (!backKey[e.from + '>' + e.to]) { fwd[e.from].push(e.to); indeg[e.to]++; } });

    // ── PHASE 1: longest-path ranking (Kahn) + pinned infra ranks ──
    var rank = {}, indeg2 = {};
    ns.forEach(function (n) { rank[n.id] = 0; indeg2[n.id] = indeg[n.id]; });
    var q = ns.filter(function (n) { return indeg[n.id] === 0; }).map(function (n) { return n.id; });
    while (q.length) {
      var u = q.shift();
      fwd[u].forEach(function (v) { if (rank[u] + 1 > rank[v]) rank[v] = rank[u] + 1; if (--indeg2[v] === 0) q.push(v); });
    }
    var maxSvc = 0;
    ns.forEach(function (n) { if (n.kind === 'server' || n.kind === 'worker' || n.kind === 'scraper') maxSvc = Math.max(maxSvc, rank[n.id]); });
    var rankDB = maxSvc + 1;
    ns.forEach(function (n) {
      if (n.kind === 'database') rank[n.id] = rankDB;          // databases at the floor
      else if (n.kind === 'externalService') rank[n.id] = rankDB; // externals: floor (right gutter)
      else if (n.kind === 'cache') rank[n.id] = Math.max(rank[n.id], maxSvc); // cache near workers
      // backend services (API, worker, scrapers/bots) must never sit in rank 0 —
      // that row is the frontend "what people see" band. A scraper/bot has no
      // incoming edges so longest-path floats it to the top; push it into the
      // servers band instead.
      else if ((n.kind === 'server' || n.kind === 'worker' || n.kind === 'scraper') && rank[n.id] === 0) rank[n.id] = 1;
      else if (n.kind === 'cron') {                            // crons: trigger band above their targets
        var mn = 1e9; rawFwd[n.id].forEach(function (v) { mn = Math.min(mn, rank[v]); });
        rank[n.id] = mn === 1e9 ? 0 : Math.max(0, mn - 1);
      }
    });

    // group spine nodes by rank (externals go to a right gutter, not the spine)
    var maxRank = 0; ns.forEach(function (n) { maxRank = Math.max(maxRank, rank[n.id]); });
    var ranks = []; for (var r = 0; r <= maxRank; r++) ranks.push([]);
    var exts = [];
    ns.forEach(function (n) { if (n.kind === 'externalService') exts.push(n); else ranks[rank[n.id]].push(n); });
    ranks.forEach(function (list) { list.sort(function (a, b) { return a.id < b.id ? -1 : 1; }); });

    // ── PHASE 2: within-rank ordering — median crossing reduction ──
    function neighborsInRank(n, rr) {
      var res = [];
      es.forEach(function (e) {
        var o = null;
        if (e.from === n.id) o = idOf[e.to]; else if (e.to === n.id) o = idOf[e.from];
        if (o && o.kind !== 'externalService' && rank[o.id] === rr) res.push(o);
      });
      return res;
    }
    function median(arr) {
      if (!arr.length) return -1;
      var a = arr.slice().sort(function (x, y) { return x - y; });
      var m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }
    var oi = {};
    function reindex() { ranks.forEach(function (list) { list.forEach(function (n, i) { oi[n.id] = i; }); }); }
    reindex();
    for (var sweep = 0; sweep < 6; sweep++) {
      var down = sweep % 2 === 0;
      for (var ri = 1; ri <= maxRank; ri++) {
        var rr2 = down ? ri : (maxRank - ri);
        if (rr2 < 1 && !down) break;
        var adj = down ? rr2 - 1 : rr2 + 1;
        if (adj < 0 || adj > maxRank) continue;
        ranks[rr2].forEach(function (n) {
          var idxs = neighborsInRank(n, adj).map(function (m) { return oi[m.id]; }).filter(function (x) { return x >= 0; });
          n._med = idxs.length ? median(idxs) : oi[n.id];
        });
        ranks[rr2].sort(function (a, b) { if (a._med !== b._med) return a._med - b._med; return a.id < b.id ? -1 : 1; });
        reindex();
      }
    }

    // ── PHASE 3: coordinate assignment with WIDE-RANK WRAPPING ──
    // A rank with many nodes (e.g. 10 entry pages) would be a single very wide
    // row that makes the whole map sprawl. Instead, wrap wide ranks into a
    // compact centered GRID of sub-rows. Ranks stack downward accounting for
    // their (possibly multi-row) height, so the hierarchy stays top→bottom and
    // each level reads as a tidy block. Fully deterministic.
    var STEP = NW + XGAP, SUBGAP = 22, MAXPERROW = 5;
    function rowsForRank(list) { return list.length ? Math.ceil(list.length / MAXPERROW) : 1; }
    // cumulative y per rank from variable rank heights
    var rankY = []; var yAcc = 0;
    for (var rr3 = 0; rr3 <= maxRank; rr3++) {
      rankY[rr3] = yAcc;
      var rows = rowsForRank(ranks[rr3]);
      yAcc += rows * NH + (rows - 1) * SUBGAP + RGAP;
    }
    ranks.forEach(function (list, r) {
      var rows = rowsForRank(list);
      var cols = rows > 1 ? MAXPERROW : list.length;
      list.forEach(function (n, i) {
        var row = Math.floor(i / cols);
        var col = i % cols;
        // number of nodes actually on THIS sub-row (last row may be short)
        var onRow = Math.min(cols, list.length - row * cols);
        n.x = (col - (onRow - 1) / 2) * STEP;
        n.y = rankY[r] + row * (NH + SUBGAP);
      });
    });
    // ── external gutter: a right-hand column of the third-party services the
    // servers "phone out" to, stacked vertically and centered on the floor. ──
    var maxX = -1e9; ns.forEach(function (n) { if (n.kind !== 'externalService') maxX = Math.max(maxX, n.x); });
    if (maxX === -1e9) maxX = 0;
    var gx = maxX + NW + XGAP * 2;
    exts.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var extTotalH = exts.length ? (exts.length - 1) * (NH + XGAP) : 0;
    var floorY = rankY[rankDB] != null ? rankY[rankDB] : maxRank * (NH + RGAP);
    exts.forEach(function (n, i) { n.x = gx; n.y = floorY - extTotalH / 2 + i * (NH + XGAP); });
  }

  // ---- render the system map into the camera ------------------------------
  var renderedClusterDbs = {};   // dbId -> cluster element
  function loadSystemMap(map) {
    systemMode = true;
    systemMap = map;
    setSystemChrome(map);
    renderSystemCanvas(buildSystemModel(map));
  }

  // =========================================================================
  // THE GUIDED, SELF-NARRATING TOUR
  // The map is rendered exactly as normal, then visibility is controlled per
  // beat: a node/edge is visible once ANY played beat revealed it (cumulative).
  // We toggle opacity (never remove) so layout/positions stay stable. The
  // caption bar narrates; the camera eases to frame the currently-visible nodes;
  // optional screenshots show the real pages large; a concern beat tints amber.
  // =========================================================================
  var tour = null;                 // the loaded Tour, or null
  var tourFetched = false;         // /api/tour already requested
  var tourActive = false;          // tour mode currently driving the map
  var tourEverShown = false;       // tour has been entered once this session
  var pendingTour = null;          // {map,tour} stashed while onboarding is open
  function flushPendingTour() {
    if (!pendingTour || tourEverShown) { pendingTour = null; return; }
    var p = pendingTour; pendingTour = null;
    startTour(p.map, p.tour);
  }
  var beatIndex = 0;               // current beat (0-based)
  var tourPlaying = false;         // autoplay running
  var autoplayTimer = null;        // the per-beat advance timer
  var AUTOPLAY_MS = 5600;          // comfortable read time per beat
  var revealedIds = {};            // cumulative node ids made visible
  var revealedEdgeIds = {};        // cumulative GATED edge keys made visible
  var concernNodeIds = {};         // node id -> true when a concern references it

  function ensureTour(cb) {
    if (tourFetched) { cb(tour); return; }
    getJSON('/api/tour').then(function (res) {
      tourFetched = true;
      var t = (res && res.__missing) ? null : res;
      tour = (t && t.beats) ? t : null;
      cb(tour);
    }).catch(function () { tourFetched = true; tour = null; cb(null); });
  }

  // Which node ids are referenced by a concern — match the concern.file path
  // (before any :line) to a node.file path, or by an obvious id match.
  function computeConcernNodes(map) {
    var out = {};
    var concerns = (map && map.concerns) || [];
    var nodes = (map && map.nodes) || [];
    function pathOf(f) { return f ? String(f).split(':')[0] : ''; }
    concerns.forEach(function (c) {
      var cf = pathOf(c.file);
      if (!cf) return;
      nodes.forEach(function (n) {
        if (pathOf(n.file) === cf) out[n.id] = true;
      });
    });
    return out;
  }

  // claim verdict for a node chip: 'warn' if a concern references it, 'ok' if it
  // has a file receipt (built + found in your code), else null (no badge).
  function claimFor(n) {
    if (n && concernNodeIds[n.id]) return 'warn';
    if (n && n.file) return 'ok';
    return null;
  }

  function startTour(map, t) {
    tour = t;
    tourActive = true;
    tourEverShown = true;
    beatIndex = 0;
    revealedIds = {};
    revealedEdgeIds = {};
    concernNodeIds = computeConcernNodes(map);
    document.body.classList.add('tour-active');
    var layer = document.getElementById('tour-layer');
    if (layer) layer.hidden = false;
    buildTourDots();
    // render the system canvas; the render hook calls applyTourVisibility(true)
    // which hides everything except beat 0 and frames it.
    loadSystemMap(map);
    // present beat 0 (caption, shot, highlight, camera). Visibility is already
    // applied by the render hook; goToBeat re-applies + narrates.
    goToBeat(0, true);
  }

  function buildTourDots() {
    var host = document.getElementById('tour-dots');
    if (!host || !tour) return;
    var html = '';
    for (var i = 0; i < tour.beats.length; i++) html += '<span class="tour-dot" data-dot="' + i + '"></span>';
    host.innerHTML = html;
  }

  // cumulative reveal: collect every id revealed by beats 0..beatIndex. A reveal
  // id containing "->" is an EDGE (e.g. "svc_worker->ext_sendblue"); everything
  // else is a node. Edges named in a beat are GATED — held hidden until their
  // beat even if both endpoints are already up — so a "texts back" beat can make
  // a specific wire appear on cue instead of it showing the moment the worker did.
  function recomputeRevealed() {
    revealedIds = {};
    revealedEdgeIds = {};
    if (!tour) return;
    for (var i = 0; i <= beatIndex && i < tour.beats.length; i++) {
      var rv = tour.beats[i].reveal || [];
      rv.forEach(function (id) {
        if (id.indexOf('->') >= 0) revealedEdgeIds[normEdgeKey(id)] = true;
        else revealedIds[id] = true;
      });
    }
  }
  // strip the model's "sys:" prefix so tour edge ids ("a->b") match model ids
  // ("sys:a->b").
  function normEdgeKey(id) { return String(id).replace(/^sys:/, ''); }
  // every edge id named in ANY beat's reveal — the set of gated edges.
  function tourGatedEdges() {
    var g = {};
    if (tour) tour.beats.forEach(function (b) {
      (b.reveal || []).forEach(function (id) { if (id.indexOf('->') >= 0) g[normEdgeKey(id)] = true; });
    });
    return g;
  }

  // show/hide nodes + edges by the cumulative revealed set. An edge is shown
  // only when BOTH endpoints are revealed (so no wire dangles into a hidden
  // node). reduced-motion = instant (no spring), otherwise the newly-shown
  // nodes get the spring settle so the map looks like it is being drawn.
  function applyTourVisibility(initial) {
    if (!tourActive || !currentModel) return;
    recomputeRevealed();
    var nodeLayer = document.getElementById('node-layer');
    var wireLayer = document.getElementById('wire-layer');
    if (nodeLayer) {
      Array.prototype.forEach.call(nodeLayer.querySelectorAll('.cn-host'), function (h) {
        var id = h.getAttribute('data-node');
        var show = !!revealedIds[id];
        var wasHidden = h.classList.contains('tour-hidden') || (initial && !h.classList.contains('tour-shown'));
        h.classList.toggle('tour-hidden', !show);
        h.classList.toggle('tour-shown', show);
        if (show && wasHidden && !reduceMotion) {
          h.classList.remove('tour-reveal'); void h.offsetWidth; h.classList.add('tour-reveal');
        }
      });
    }
    if (currentModel.edges && wireLayer) {
      var gated = tourGatedEdges();
      var edgeVisible = {};
      currentModel.edges.forEach(function (e) {
        var both = !!revealedIds[e.from] && !!revealedIds[e.to];
        var key = normEdgeKey(e.id);
        // a gated edge needs its own beat to fire even when both ends are up.
        edgeVisible[e.id] = both && (!gated[key] || !!revealedEdgeIds[key]);
      });
      Array.prototype.forEach.call(wireLayer.querySelectorAll('[data-edge]'), function (el) {
        var eid = el.getAttribute('data-edge');
        el.classList.toggle('tour-hidden', !edgeVisible[eid]);
      });
    }
  }

  // frame the camera around the currently-visible nodes (eased, never yanky).
  function frameVisibleNodes(instant) {
    if (!currentModel) return;
    var vis = currentModel.nodes.filter(function (n) { return revealedIds[n.id]; });
    if (!vis.length) vis = currentModel.nodes;
    var bb = nodesBBox(vis);
    if (bb) frameBox(bb, 64, instant, { maxK: 1.25 });
  }

  // present a single beat: reveal its nodes/edges, narrate, highlight, frame,
  // and (if any) show the screenshot large. dir>0 = forward, used only for feel.
  function goToBeat(i, instant) {
    if (!tour) return;
    var n = tour.beats.length;
    if (i < 0) i = 0; if (i > n - 1) i = n - 1;
    beatIndex = i;
    var beat = tour.beats[i];
    applyTourVisibility(false);
    setTourCaption(beat);
    showTourShot(beat);
    applyTourHighlight(beat);
    updateTourControls();
    frameVisibleNodes(!!instant && reduceMotion);
  }

  function setTourCaption(beat) {
    var cap = document.getElementById('tour-caption');
    var txt = document.getElementById('tour-caption-text');
    var cbtn = document.getElementById('tour-concern-btn');
    if (txt) txt.textContent = beat.caption || '';
    if (cap) cap.classList.toggle('is-concern', !!beat.concern);
    if (cbtn) cbtn.hidden = !beat.concern;
  }

  // the screenshot card: shown LARGE for a beat that names a shot. Loaded from
  // the tokened /api/shot endpoint. Hidden again on any beat without a shot.
  function showTourShot(beat) {
    var fig = document.getElementById('tour-shot');
    var img = document.getElementById('tour-shot-img');
    if (!fig || !img) return;
    if (beat.shot) {
      var src = '/api/shot?name=' + encodeURIComponent(beat.shot) + '&t=' + encodeURIComponent(TOKEN);
      if (img.getAttribute('data-shot') !== beat.shot) {
        img.setAttribute('data-shot', beat.shot);
        img.src = src;
      }
      fig.hidden = false;
    } else {
      fig.hidden = true;
      img.removeAttribute('data-shot');
      img.removeAttribute('src');
    }
  }

  // spotlight (accent) the beat's highlight ids without dimming the rest. Ids may
  // be nodes OR edges ("a->b") — an edge highlight thickens that wire so a beat
  // can literally point at the connection it is narrating.
  function applyTourHighlight(beat) {
    var hiNode = {}, hiEdge = {};
    (beat.highlight || []).forEach(function (id) {
      if (id.indexOf('->') >= 0) hiEdge[normEdgeKey(id)] = true; else hiNode[id] = true;
    });
    var nodeLayer = document.getElementById('node-layer');
    if (nodeLayer) Array.prototype.forEach.call(nodeLayer.querySelectorAll('.cn-host'), function (h) {
      var id = h.getAttribute('data-node');
      h.classList.toggle('tour-spot', !!hiNode[id] && !!revealedIds[id]);
    });
    var wireLayer = document.getElementById('wire-layer');
    if (wireLayer) Array.prototype.forEach.call(wireLayer.querySelectorAll('.map-wire'), function (p) {
      p.classList.toggle('wire-hi', !!hiEdge[normEdgeKey(p.getAttribute('data-edge'))]);
    });
  }

  function updateTourControls() {
    if (!tour) return;
    var n = tour.beats.length;
    var ptext = document.getElementById('tour-progress-text');
    if (ptext) ptext.textContent = 'Step ' + (beatIndex + 1) + ' of ' + n;
    var dots = document.getElementById('tour-dots');
    if (dots) {
      Array.prototype.forEach.call(dots.querySelectorAll('.tour-dot'), function (d, i) {
        d.classList.toggle('is-seen', i <= beatIndex);
        d.classList.toggle('is-current', i === beatIndex);
      });
    }
    var back = document.getElementById('tour-back');
    var next = document.getElementById('tour-next');
    if (back) back.disabled = beatIndex <= 0;
    // On the LAST beat, the Next button becomes a live "Close" that ends the
    // tour (reveals the full map) — never a greyed/dead control. Before the
    // last beat it is the normal enabled "Next ›".
    if (next) {
      var onLast = beatIndex >= n - 1;
      next.disabled = false;
      next.classList.toggle('is-close', onLast);
      next.innerHTML = onLast ? 'Close' : 'Next &#8250;';
      next.setAttribute('aria-label', onLast ? 'Close the tour and show the whole map' : 'Next step');
    }
    var controls = document.getElementById('tour-controls');
    if (controls) controls.classList.toggle('is-playing', tourPlaying);
    var ptxt = document.getElementById('tour-play-text');
    var pbtn = document.getElementById('tour-play');
    var atLast = beatIndex >= n - 1;
    if (ptxt) ptxt.textContent = tourPlaying ? 'Pause' : (beatIndex === 0 ? 'Walk me through it' : 'Play');
    if (pbtn) pbtn.setAttribute('aria-label', tourPlaying ? 'Pause' : 'Walk me through it');
    // Replay appears once you have reached the end; play hides at the very end.
    var replay = document.getElementById('tour-replay');
    if (replay) replay.hidden = !atLast;
    if (pbtn) pbtn.style.display = (atLast && !tourPlaying) ? 'none' : '';
  }

  function startCountdown() {
    var c = document.getElementById('tour-countdown');
    if (!c) return;
    var fill = c.querySelector('.tour-countdown-fill');
    c.classList.remove('is-counting');
    if (reduceMotion || !fill) return;
    fill.style.transition = 'none';
    void c.offsetWidth;                 // reset the fill to 0 instantly
    fill.style.transition = 'width ' + AUTOPLAY_MS + 'ms linear';
    void c.offsetWidth;
    c.classList.add('is-counting');     // .is-counting drives the fill to 100%
  }
  function stopCountdown() {
    var c = document.getElementById('tour-countdown');
    if (!c) return;
    c.classList.remove('is-counting');
    var fill = c.querySelector('.tour-countdown-fill');
    if (fill) fill.style.transition = 'none';
  }
  function clearAutoplay() {
    if (autoplayTimer) { clearTimeout(autoplayTimer); autoplayTimer = null; }
    stopCountdown();
  }
  function scheduleAutoplay() {
    clearAutoplay();
    if (!tourPlaying) return;
    if (beatIndex >= tour.beats.length - 1) { tourPlaying = false; updateTourControls(); return; }
    startCountdown();                   // show the bar filling toward the next beat
    autoplayTimer = setTimeout(function () {
      if (!tourPlaying) return;
      goToBeat(beatIndex + 1, false);
      scheduleAutoplay();
    }, AUTOPLAY_MS);
  }
  function playTour() {
    if (!tour) return;
    // If we are at the end, restart from the top.
    if (beatIndex >= tour.beats.length - 1) { beatIndex = 0; goToBeat(0, false); }
    tourPlaying = true;
    updateTourControls();
    // Advance ONE beat right away so pressing Play visibly DOES something — the
    // viewer has already read the current beat, so "Play" means "continue the
    // story now", not "sit on this beat for 5.6 silent seconds" (which read as
    // a dead button). Then keep going on the timer.
    if (beatIndex < tour.beats.length - 1) {
      goToBeat(beatIndex + 1, false);
    }
    scheduleAutoplay();
  }
  function pauseTour() {
    tourPlaying = false;
    clearAutoplay();
    updateTourControls();
  }
  function togglePlay() { if (tourPlaying) pauseTour(); else playTour(); }
  // any manual step pauses autoplay (so the viewer takes control smoothly).
  function manualBeat(delta) {
    if (!tour) return;
    pauseTour();
    goToBeat(beatIndex + delta, false);
  }
  function replayTour() {
    if (!tour || !systemMap) return;
    revealedIds = {};
    revealedEdgeIds = {};
    beatIndex = 0;
    tourActive = true;
    document.body.classList.add('tour-active');
    var layer = document.getElementById('tour-layer');
    if (layer) layer.hidden = false;
    loadSystemMap(systemMap);
    goToBeat(0, true);
  }

  // CLOSE / SKIP: finish the tour and hand back the normal pannable map. "Close"
  // means close — we DISMISS the tour chrome entirely (no lingering "whole
  // picture" banner) and let the remaining nodes settle in with a gentle stagger
  // so the map COMPLETES itself rather than dumping every hidden node at once.
  function endTour(closingLine) {
    pauseTour();
    tourActive = false;
    document.body.classList.remove('tour-active');
    var nodeLayer = document.getElementById('node-layer');
    var wireLayer = document.getElementById('wire-layer');
    if (nodeLayer) {
      // nodes still hidden by the tour get a staggered reveal; ones already shown
      // just shed their tour classes.
      var stagger = 0;
      Array.prototype.forEach.call(nodeLayer.querySelectorAll('.cn-host'), function (h) {
        var wasHidden = h.classList.contains('tour-hidden');
        h.classList.remove('tour-hidden'); h.classList.remove('tour-shown'); h.classList.remove('tour-spot');
        if (wasHidden && !reduceMotion) {
          var delay = stagger * 40; stagger++;
          h.style.animationDelay = delay + 'ms';
          h.classList.remove('tour-reveal'); void h.offsetWidth; h.classList.add('tour-reveal');
          (function (el, d) { setTimeout(function () { el.style.animationDelay = ''; el.classList.remove('tour-reveal'); }, d + 700); })(h, delay);
        }
      });
    }
    if (wireLayer) Array.prototype.forEach.call(wireLayer.querySelectorAll('[data-edge]'), function (el) {
      el.classList.remove('tour-hidden');
    });
    // dismiss the whole tour overlay — caption, controls, shot, dots — so nothing
    // lingers over the map.
    var fig = document.getElementById('tour-shot'); if (fig) fig.hidden = true;
    var layer = document.getElementById('tour-layer'); if (layer) layer.hidden = true;
    requestAnimationFrame(function () { fitAll(reduceMotion); });
  }
  function skipToFull() {
    if (beatIndex >= ((tour && tour.beats.length) || 1) - 1) {
      // already at the last beat — use the natural closing line if present.
      endTour();
    } else {
      endTour();
    }
  }
  // fully dismiss the tour chrome and behave like the plain system map.
  function exploreOnOwn() {
    var layer = document.getElementById('tour-layer');
    if (layer) layer.hidden = true;
  }

  // ---- tour control wiring (run once at boot) -----------------------------
  function wireTourControls() {
    var back = document.getElementById('tour-back');
    if (back) back.addEventListener('click', function () { manualBeat(-1); });
    var next = document.getElementById('tour-next');
    if (next) next.addEventListener('click', function () {
      if (beatIndex >= tour.beats.length - 1) { endTour(); return; }
      manualBeat(1);
    });
    var skip = document.getElementById('tour-skip');
    if (skip) skip.addEventListener('click', function () { skipToFull(); });
    var replay = document.getElementById('tour-replay');
    if (replay) replay.addEventListener('click', function () {
      var sk = document.getElementById('tour-skip'); if (sk) sk.hidden = false;
      var bk = document.getElementById('tour-back'); if (bk) bk.style.display = '';
      var nx = document.getElementById('tour-next'); if (nx) nx.style.display = '';
      var prog = document.querySelector('.tour-progress'); if (prog) prog.style.display = '';
      var ex = document.getElementById('tour-explore'); if (ex) ex.hidden = true;
      replayTour();
    });
    var explore = document.getElementById('tour-explore');
    if (explore) explore.addEventListener('click', function () { exploreOnOwn(); });
    var cbtn = document.getElementById('tour-concern-btn');
    if (cbtn) cbtn.addEventListener('click', function () { show('concerns'); });
  }

  function setSystemChrome(map) {
    var whatEl = document.getElementById('sys-what');
    var hiwBtn = document.getElementById('menu-howitworks');
    var concBtn = document.getElementById('menu-concerns');
    if (!map) {
      if (whatEl) { whatEl.hidden = true; whatEl.textContent = ''; }
      if (hiwBtn) hiwBtn.hidden = true;
      if (concBtn) concBtn.hidden = true;
      return;
    }
    if (whatEl) {
      whatEl.textContent = map.what || '';
      whatEl.title = map.what || '';
      whatEl.hidden = !map.what;
    }
    var flows = map.dataFlows || [];
    var concerns = map.concerns || [];
    var high = concerns.filter(function (c) { return c.severity === 'high'; }).length;
    if (hiwBtn) hiwBtn.hidden = !flows.length;
    if (concBtn) {
      concBtn.hidden = !concerns.length;
      var existing = concBtn.querySelector('.menu-badge');
      if (existing) existing.remove();
      if (high > 0) {
        var b = document.createElement('span');
        b.className = 'menu-badge';
        b.textContent = high + ' to check';
        concBtn.appendChild(b);
      }
    }
  }

  function renderSystemCanvas(model) {
    var nodeLayer = document.getElementById('node-layer');
    var wireLayer = document.getElementById('wire-layer');
    var empty = document.getElementById('canvas-empty');
    var bandLabels = document.getElementById('band-labels');
    if (!nodeLayer || !wireLayer) return;

    var firstPaint = currentModel === null || !currentModel.system;
    var prevIds = renderedNodeIds;
    var newNodeIds = {};
    model.nodes.forEach(function (n) { if (!prevIds[n.id]) newNodeIds[n.id] = true; });

    currentModel = model;
    if (empty) empty.hidden = true;
    if (bandLabels) bandLabels.innerHTML = ''; // system map uses screen-pinned captions

    // full redraw of wires + node layer (system mode is small: ~10-15 nodes)
    wireLayer.innerHTML = '';
    nodeLayer.innerHTML = '';
    renderedNodeIds = {}; renderedEdgeIds = {}; pulseRegistry = []; renderedClusterDbs = {};

    // ---- wires (data-flow lines) ------------------------------------------
    model.edges.forEach(function (e, i) {
      var from = model.nodeById[e.from], to = model.nodeById[e.to];
      if (!from || !to) return;
      var d = edgePath(from, to);
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', d);
      var cls = 'map-wire';
      if (e.intended) cls += ' wire-intended';
      else if (e.external) cls += ' wire-external';
      // EXTERNAL-service edges are tinted in that org's brand primary so a line
      // going to Claude is Anthropic-coral, a line to a payments service is
      // Stripe-violet, etc. Non-external edges stay the neutral/teal accent.
      var extBrandColor = null;
      if (e.external && e.extProvider) {
        extBrandColor = provBrand(e.extProvider).primary;
        cls += ' wire-branded';
        path.style.stroke = extBrandColor;
      }
      path.setAttribute('class', cls);
      path.setAttribute('data-edge', e.id);
      wireLayer.appendChild(path);
      if (!reduceMotion && firstPaint) {
        var len0 = path.getTotalLength ? path.getTotalLength() : 300;
        path.style.setProperty('--len', len0.toFixed(0));
        path.classList.add('wire-draw');
      }
      // short edge label (the flows description), clamped; full text on focus
      var lbl = shortFlow(e.flows);
      if (lbl) {
        var mid = path.getPointAtLength ? path.getPointAtLength(path.getTotalLength() * 0.5) : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        var t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('class', 'wire-label');
        t.setAttribute('data-edge', e.id);
        t.setAttribute('x', mid.x.toFixed(1));
        t.setAttribute('y', (mid.y - 6).toFixed(1));
        t.textContent = lbl;
        var full = document.createElementNS(SVGNS, 'title');
        full.textContent = e.flows || '';
        t.appendChild(full);
        wireLayer.appendChild(t);
      }
      // perpetual flow PULSE on data-flow edges (not intended/coded-not-live).
      // External-service edges keep the pulse too, but in the org's BRAND color.
      // reduced-motion = no pulse.
      if (!reduceMotion && !e.intended) {
        var pulse = document.createElementNS(SVGNS, 'path');
        pulse.setAttribute('d', d);
        pulse.setAttribute('class', 'flow-pulse' + (extBrandColor ? ' pulse-branded' : ''));
        pulse.setAttribute('data-edge', e.id);
        if (extBrandColor) pulse.style.stroke = extBrandColor;
        wireLayer.appendChild(pulse);
        pulseRegistry.push({ edge: e, pathEl: path, pulseEl: pulse });
      }
    });
    pulseRegistry.forEach(function (p, i) {
      var len = p.pathEl.getTotalLength ? p.pathEl.getTotalLength() : 300;
      p.pulseEl.style.setProperty('--len', len.toFixed(0));
      p.pulseEl.style.setProperty('--seg', '13');
      p.pulseEl.style.setProperty('--gap', (len + 13).toFixed(0));
      p.pulseEl.style.setProperty('--dur', '2.4s');
      p.pulseEl.style.setProperty('--dur-fast', '1.1s');
      p.pulseEl.style.setProperty('--phase', (-(i * 0.5) % 2.4).toFixed(2) + 's');
      if (firstPaint) {
        p.pulseEl.style.visibility = 'hidden';
        (function (pe) { setTimeout(function () { pe.style.visibility = ''; }, 900); })(p.pulseEl);
      }
    });

    // ---- nodes ------------------------------------------------------------
    var staggerIdx = 0;
    model.nodes.forEach(function (n) {
      var host = makeSystemNode(n);
      nodeLayer.appendChild(host);
      renderedNodeIds[n.id] = host;
      positionSystemNode(host, n);
      // In tour mode the engine owns the reveal animation (tour-reveal), so we
      // SKIP the entrance stagger here — otherwise cn-rise's forwards-fill would
      // pin opacity:1 and defeat the per-beat hiding.
      if (!reduceMotion && !tourActive) {
        host.classList.add('cn-rise');
        host.style.animationDelay = (firstPaint ? Math.min(staggerIdx * 46, 650) : 0) + 'ms';
        staggerIdx++;
        if (!firstPaint && newNodeIds[n.id]) spawnRing(host, n);
      }
      // re-show any expanded cluster (persisted across re-render)
      if ((n.kind === 'database' || n.kind === 'cache') && expandedDbs[n.id] && n.tables && n.tables.length) {
        renderCluster(n);
      }
    });
    model.edges.forEach(function (e) { renderedEdgeIds[e.id] = true; });

    // TOUR HOOK: when a tour is active, the engine owns initial visibility +
    // camera (it hides un-revealed nodes and frames just beat 0). Otherwise the
    // map fits the whole thing as before.
    if (tourActive) {
      applyTourVisibility(true);
      updateSysCaptions();
    } else if (firstPaint) {
      requestAnimationFrame(function () { fitAll(reduceMotion); });
      updateSysCaptions();
    } else {
      updateSysCaptions();
    }
  }

  // a system node chip. STRUCTURE:
  //   [ glyph  Plain label                ]   <- the card body (.sys-body)
  //   [ ▮ Provider / host name            ]   <- the brand BAR, full width, bottom
  // The brand bar replaces the old floating provider "pill"; it is part of the
  // node and drags/moves with it. The bar background = the provider's brand
  // primary with onPrimary text. External-service + data (database/cache) nodes
  // get the WHOLE card branded (tint bg + primary border) on top of the bar.
  function makeSystemNode(n) {
    var host = document.createElement('div');
    host.className = 'cn-host';
    host.setAttribute('data-node', n.id);
    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    var brand = provBrand(n.provider);
    var branded = nodeIsBranded(n);
    btn.className = 'canvas-node sys-node sys-kind-' + n.kind + (branded ? ' sys-branded' : '');
    if (branded) {
      // the whole card reads as the org's color/theme.
      btn.style.background = brand.tint;
      btn.style.borderColor = brand.primary;
    }
    var html = '';
    // --- card body: glyph + plain label (+ muted technical) ---
    html += '<span class="sys-body">';
    html += '<span class="sys-row">';
    html += '<span class="cn-glyph" aria-hidden="true">' + sysGlyph(n.kind) + '</span>';
    html += '<span class="sys-label">' + esc(n.label) + '</span>';
    html += '</span>';
    if (n.technical) html += '<span class="sys-tech" title="' + esc(n.technical) + '">' + esc(n.technical) + '</span>';
    if (n.note || false) html += '<span class="sys-flag">not running yet</span>';
    // database expand affordance (chip count) lives in the body, above the bar
    if ((n.kind === 'database' || n.kind === 'cache') && n.tables && n.tables.length) {
      html += '<span class="sys-expand" data-expand="' + esc(n.id) + '">' + SYS_GLYPHS.chevron + n.tables.length + ' table' + (n.tables.length === 1 ? '' : 's') + '</span>';
    }
    html += '</span>'; // /sys-body
    // --- brand BAR: full-width strip across the bottom of the card ---
    var barName = brandBarName(n);
    html += '<span class="sys-brandbar" style="background:' + esc(brand.primary) + ';color:' + esc(brand.onPrimary) + '" aria-hidden="true">';
    html += '<span class="sys-brand-dot" style="background:' + esc(brand.onPrimary) + '"></span>';
    html += '<span class="sys-brand-name">' + esc(barName) + '</span>';
    html += '</span>';
    // claim-check badge: a small corner glyph. ✓ = built + found in your code
    // (default for any node with a file receipt); ⚠ = referenced by a concern.
    var claim = claimFor(n);
    if (claim === 'warn') {
      html += '<span class="sys-claim claim-warn" title="something to check" aria-label="something to check">&#9888;</span>';
    } else if (claim === 'ok') {
      html += '<span class="sys-claim claim-ok" title="built and found in your code" aria-label="built and found in your code">&#10003;</span>';
    }
    btn.innerHTML = html;
    btn.setAttribute('aria-label', sysNodeAria(n));
    host.appendChild(btn);
    positionSystemNode(host, n);

    btn.addEventListener('mouseenter', function () { if (!draggingNode) focusSystemNode(n, true); });
    btn.addEventListener('mouseleave', function () { if (!draggingNode) focusSystemNode(n, false); });
    btn.addEventListener('focus', function () { focusSystemNode(n, true); });
    btn.addEventListener('blur', function () { focusSystemNode(n, false); });
    btn.addEventListener('keydown', function (e) {
      if (e.key.indexOf('Arrow') !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var dd = e.shiftKey ? 20 : 8, dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -dd; else if (e.key === 'ArrowRight') dx = dd;
      else if (e.key === 'ArrowUp') dy = -dd; else if (e.key === 'ArrowDown') dy = dd;
      setNodePos(n, n.x + dx, n.y + dy);
      moveCluster(n);
    });
    host.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      beginSystemNodeDrag(n, host, e);
    });
    return host;
  }

  function sysNodeAria(n) {
    var brand = provBrand(n.provider);
    var s = n.label;
    var kindWord = n.kind === 'database' ? 'a database' : n.kind === 'cache' ? 'a cache and queue'
      : n.kind === 'page' ? 'a page people see' : n.kind === 'externalService' ? 'an outside service'
      : n.kind === 'worker' ? 'a background worker' : n.kind === 'scraper' ? 'a scraper'
      : n.kind === 'cron' ? 'a scheduled job' : 'a server';
    s += ', ' + kindWord;
    // the brand bar's accessible name: spoken as part of the node's label so the
    // bar's provider (e.g. "on Anthropic") is never lost to a screen reader.
    var bn = brandBarName(n);
    if (bn && bn !== 'service') s += ' on ' + bn;
    if (n.tables && n.tables.length) s += ', holding ' + n.tables.length + ' tables';
    return s;
  }

  function positionSystemNode(host, n) {
    var w = n.cronRail ? Math.round(NODE_W * 0.62) : NODE_W;
    // taller now: the card body + the full-width brand bar. Cron rail stays
    // smaller but still leaves room for its (neutral) brand bar.
    var h = n.cronRail ? 56 : SYS_NODE_H;
    host.style.left = n.x.toFixed(1) + 'px';
    host.style.top = n.y.toFixed(1) + 'px';
    host.style.width = w + 'px';
    host.style.height = h + 'px';
  }

  // truncate an edge flow label for the inline wire caption (full text on hover)
  function shortFlow(s) {
    if (!s) return '';
    s = String(s);
    if (s.length <= 26) return s;
    return s.slice(0, 24).replace(/[ ,]+$/, '') + '…';
  }

  // ---- database CLUSTER: compact table chips, revealed on expand ----------
  function renderCluster(db) {
    var nodeLayer = document.getElementById('node-layer');
    if (!nodeLayer || !db.tables || !db.tables.length) return;
    if (renderedClusterDbs[db.id]) return;
    var cluster = document.createElement('div');
    cluster.className = 'sys-cluster';
    cluster.setAttribute('data-cluster', db.id);
    if (!reduceMotion) cluster.classList.add('cn-rise');
    var html = '<div class="sys-cluster-head">stored here</div>';
    db.tables.forEach(function (t) {
      var sens = t.sensitive && t.sensitive.length;
      html += '<button class="sys-chip' + (sens ? ' sys-sensitive' : '') + '" type="button" data-table="' + esc(t.id) + '"' +
        (sens ? ' title="stores: ' + esc(t.sensitive.join(', ')) + '"' : '') + '>';
      html += '<span class="sys-chip-glyph" aria-hidden="true">' + SYS_GLYPHS.dataTable + '</span>';
      html += '<span class="sys-chip-name">' + esc(t.label) + '</span>';
      if (sens) html += '<span class="sys-lock" aria-hidden="true">' + SYS_GLYPHS.lock + '</span>';
      html += '</button>';
    });
    cluster.innerHTML = html;
    nodeLayer.appendChild(cluster);
    renderedClusterDbs[db.id] = cluster;
    Array.prototype.forEach.call(cluster.querySelectorAll('.sys-chip'), function (chip) {
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        var tid = chip.getAttribute('data-table');
        var tab = findTable(tid);
        if (tab) openSystemNode(tab, true);
      });
    });
    positionCluster(db, cluster);
  }
  function positionCluster(db, cluster) {
    // anchor just below the database node, in world px (pans/zooms with world)
    cluster.style.left = (db.x).toFixed(1) + 'px';
    cluster.style.top = (db.y + SYS_NODE_H + 12).toFixed(1) + 'px';
    cluster.style.width = (NODE_W) + 'px';
  }
  function moveCluster(db) {
    var c = renderedClusterDbs[db.id];
    if (c) positionCluster(db, c);
  }
  function removeCluster(dbId) {
    var c = renderedClusterDbs[dbId];
    if (c && c.parentNode) c.parentNode.removeChild(c);
    delete renderedClusterDbs[dbId];
  }
  function toggleCluster(db) {
    if (expandedDbs[db.id]) { expandedDbs[db.id] = false; removeCluster(db.id); }
    else { expandedDbs[db.id] = true; renderCluster(db); }
  }
  function findTable(tid) {
    if (!systemMap) return null;
    for (var i = 0; i < systemMap.nodes.length; i++) if (systemMap.nodes[i].id === tid) return systemMap.nodes[i];
    return null;
  }

  // ---- focus mode for system nodes: dim the rest, strengthen this node's
  //      connected edges + labels + neighbors (reuses the dim/hi classes). ----
  function focusSystemNode(n, on) {
    if (on) setCaption(n.label + (provStyle(n.provider).label ? ' — on ' + provStyle(n.provider).label : ''));
    else setCaption('');
    // NB: do NOT bail on reduceMotion here. Edge labels are now hover-only, so
    // this highlight is the ONLY way to read a wire's function/route name —
    // it must work for reduced-motion users too. The toggled classes are pure
    // opacity/stroke changes; the reduced-motion media queries already strip any
    // transition, so there is no motion to suppress.
    var mineEdges = {};
    if (currentModel) currentModel.edges.forEach(function (e) { if (e.from === n.id || e.to === n.id) mineEdges[e.id] = true; });
    // NB: coerce the toggle's force arg to a REAL boolean. (on AND mineEdges[eid])
    // is undefined (not false) for an unrelated edge, and classList.toggle(cls,
    // undefined) treats a missing force as "flip" — which would ADD the class to
    // every unrelated wire and light up the whole map. The double-bang keeps it a
    // hard off.
    Array.prototype.forEach.call(document.querySelectorAll('#wire-layer .map-wire'), function (p) {
      var mine = on && !!mineEdges[p.getAttribute('data-edge')];
      p.classList.toggle('wire-hi', mine);
      p.classList.toggle('wire-dim', on && !mine);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#wire-layer .flow-pulse'), function (pp) {
      var mine = on && !!mineEdges[pp.getAttribute('data-edge')];
      pp.classList.toggle('pulse-hi', mine);
      pp.classList.toggle('pulse-dim', on && !mine);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#wire-layer .wire-label'), function (wl) {
      var eid = wl.getAttribute('data-edge');
      var mine = on && !!mineEdges[eid];
      wl.classList.toggle('label-hi', mine);
      wl.classList.toggle('label-dim', on && !mine);
      if (mine) { var e = sysEdgeById(eid); if (e) wl.firstChild.textContent = e.flows || wl.firstChild.textContent; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('#node-layer .cn-host'), function (h) {
      var id = h.getAttribute('data-node');
      var mine = id === n.id || (n.neighbors && n.neighbors[id]);
      h.classList.toggle('is-focus', on && id === n.id);
      h.classList.toggle('is-dim', on && !mine);
    });
  }
  function sysEdgeById(id) {
    if (!currentModel || !id) return null;
    for (var i = 0; i < currentModel.edges.length; i++) if (currentModel.edges[i].id === id) return currentModel.edges[i];
    return null;
  }

  // ---- system node drag (re-ropes wires + moves its cluster) --------------
  function beginSystemNodeDrag(n, host, e) {
    if (e.target && e.target.closest && e.target.closest('.sys-expand')) {
      // clicking the expand affordance toggles the cluster, never drags.
      e.stopPropagation();
      toggleCluster(n);
      return;
    }
    if (e.stopPropagation) e.stopPropagation();
    var startX = e.clientX, startY = e.clientY;
    var origX = n.x, origY = n.y;
    var moved = 0, isDrag = false;
    var pid = e.pointerId;
    try { host.setPointerCapture(pid); } catch (er) {}
    function move(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (!isDrag && moved > 4) { isDrag = true; draggingNode = n.id; host.classList.add('is-dragging'); markInteractGlobal(); focusSystemNode(n, false); }
      if (isDrag) { setNodePos(n, origX + dx / cam.k, origY + dy / cam.k); moveCluster(n); ev.preventDefault(); }
    }
    function up(ev) {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      try { host.releasePointerCapture(pid); } catch (er) {}
      if (isDrag) { host.classList.remove('is-dragging'); draggingNode = null; suppressNextClick(host); }
      else { openSystemNode(n, false); }
    }
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
  }

  // ---- the plain side panel for a system node (reuses the learn popover) --
  function openSystemNode(n, isTable) {
    var card = learnPop;
    if (!card) return;
    card.querySelector('.learn-title').textContent = n.label;
    var plainEl = card.querySelector('.learn-plain');
    plainEl.textContent = sysNodePlain(n, isTable);
    var inst = card.querySelector('.learn-instance');
    inst.innerHTML = '';
    if (n.technical) { var tEl = document.createElement('div'); tEl.className = 'sys-panel-tech'; tEl.textContent = n.technical; inst.appendChild(tEl); }
    var brand = provBrand(n.provider);
    var hostLine = document.createElement('div'); hostLine.className = 'sys-panel-host';
    var hostTxt = n.host ? n.host : (brand.name || '');
    if (hostTxt) hostLine.appendChild(document.createTextNode(hostTxt));
    if (brand.name) {
      // a small branded chip echoing the node's brand bar (brand primary bg).
      var badge = document.createElement('span'); badge.className = 'prov-chip';
      badge.style.background = brand.primary; badge.style.color = brand.onPrimary;
      badge.innerHTML = '<span class="prov-chip-dot" style="background:' + esc(brand.onPrimary) + '"></span>' + esc(brand.name);
      hostLine.appendChild(badge);
    }
    inst.appendChild(hostLine);
    if (isTable && n.sensitive && n.sensitive.length) {
      var sens = document.createElement('div'); sens.className = 'sys-panel-sensitive';
      sens.innerHTML = '<strong>Stores:</strong> ' + esc(n.sensitive.join(', '));
      inst.appendChild(sens);
    }
    var whyEl = card.querySelector('.learn-why');
    whyEl.textContent = n.note ? ('Note: ' + n.note) : '';
    whyEl.style.display = n.note ? '' : 'none';

    // relationships — what this node connects to/from, clickable to jump there.
    var relsEl = card.querySelector('.learn-rels');
    if (relsEl) {
      var relsHtml = buildNodeRels(n);
      if (relsHtml) {
        relsEl.innerHTML = relsHtml;
        relsEl.hidden = false;
        Array.prototype.forEach.call(relsEl.querySelectorAll('.rel-row'), function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-relid');
            var raw = currentModel && currentModel.raw;
            var node = raw && (raw.nodes || []).filter(function (m) { return m.id === id; })[0];
            if (node) openSystemNode(node, node.kind === 'dataTable');
          });
        });
      } else { relsEl.innerHTML = ''; relsEl.hidden = true; }
    }

    // the receipt: file:line chip → show me the code. If the file is not under
    // the daemon root the snippet endpoint will 4xx; show the path as text then.
    var snipHost = card.querySelector('.learn-snippet-host');
    snipHost.innerHTML = ''; snipHost.dataset.loaded = '';
    var codeBtn = card.querySelector('.learn-code');
    var rec = n.file ? parseReceipt(n.file) : null;
    codeBtn.style.display = rec ? '' : 'none';
    codeBtn.textContent = 'Show me the code';
    codeBtn.onclick = rec ? function () {
      if (snipHost.dataset.loaded === '1') { snipHost.hidden = !snipHost.hidden; return; }
      snipHost.innerHTML = '<div class="receipt"><button class="chip" type="button" data-snippet="1" data-file="' +
        esc(rec.file) + '" data-line="' + esc(rec.line) + '" aria-expanded="false">' + esc(rec.file + ':' + rec.line) + '</button></div>';
      attachReceiptHandlers(snipHost);
      snipHost.dataset.loaded = '1';
      var c2 = snipHost.querySelector('[data-snippet]'); if (c2) c2.click();
    } : null;
    var moreBtn = card.querySelector('.learn-more');
    if (moreBtn) moreBtn.style.display = 'none';
    openTheOverlay(card, card.querySelector('.learn-close'));
  }
  function sysNodePlain(n, isTable) {
    if (isTable) return n.label + ' — one table of records inside your database: a single kind of thing it stores, one row per item.';
    switch (n.kind) {
      case 'page': return n.label + ' — a screen people open in their browser. It does not hold any data itself; it asks your server for everything it shows.';
      case 'server': return n.label + ' — a service that runs your code and answers requests. Most things in the app flow through here: it reads and writes the database and calls the outside services.';
      case 'worker': return n.label + ' — a background worker. The slow jobs (downloading, transcribing, calling AI) run here so people never have to sit and wait for them.';
      case 'scraper': return n.label + ' — a bot that logs into an outside service and pulls things in. It runs around the clock on its own, not when a person clicks anything.';
      case 'database': return n.label + ' — the main place your app remembers things, long-term. Almost everything important ends up stored here.';
      case 'cache': return n.label + ' — a fast, temporary store and job queue. It holds work that is waiting to be done and speeds up repeated lookups.';
      case 'externalService': return n.label + ' — an outside company’s service your app calls over the internet. You don’t run it; your app depends on it (and usually pays for it).';
      case 'cron': return n.label + ' — a job that runs on a timer, not when a person does anything, poking your servers to do recurring work.';
      default: return n.label + '.';
    }
  }
  // Build the "how it connects" section for a system node: the real edges in and
  // out, each with its plain flow description, each clickable to jump to that
  // node. Uses the laid-out model edges (already deduped — table writes fold into
  // the one database row, so a hub like the API reads cleanly instead of listing
  // every table twice). A table node's own edges are folded away, so we show the
  // database it lives in instead.
  function buildNodeRels(n) {
    var cm = currentModel;
    if (!cm) return null;
    var byId = cm.nodeById || {};
    function row(other, flow, intended, arrow) {
      var tag = intended ? ' <span class="rel-planned">planned</span>' : '';
      var fl = flow ? '<span class="rel-flow">' + esc(flow) + '</span>' : '';
      return '<button class="rel-row" type="button" data-relid="' + esc(other.id) + '">' +
        '<span class="rel-arrow">' + arrow + '</span>' +
        '<span class="rel-body"><span class="rel-label">' + esc(other.label) + tag + '</span>' + fl + '</span></button>';
    }
    // a table: its reads/writes were folded into the database — point home to it.
    if (n.kind === 'dataTable') {
      var dbNode = null;
      (cm.nodes || []).forEach(function (m) {
        if ((m.kind === 'database' || m.kind === 'cache') && m.tables) {
          m.tables.forEach(function (t) { if (t.id === n.id) dbNode = m; });
        }
      });
      if (!dbNode) return null;
      return '<div class="rel-group"><div class="rel-head">Lives inside</div>' +
        row(dbNode, 'one of the tables in this database', false, '▸') + '</div>';
    }
    var out = [], inc = [];
    (cm.edges || []).forEach(function (e) {
      if (e.from === n.id && byId[e.to]) out.push({ other: byId[e.to], flow: e.flows || '', intended: !!e.intended });
      else if (e.to === n.id && byId[e.from]) inc.push({ other: byId[e.from], flow: e.flows || '', intended: !!e.intended });
    });
    if (!out.length && !inc.length) return null;
    var html = '';
    if (out.length) {
      html += '<div class="rel-group"><div class="rel-head">Sends data to</div>' +
        out.map(function (r) { return row(r.other, r.flow, r.intended, '→'); }).join('') + '</div>';
    }
    if (inc.length) {
      html += '<div class="rel-group"><div class="rel-head">Gets called by</div>' +
        inc.map(function (r) { return row(r.other, r.flow, r.intended, '←'); }).join('') + '</div>';
    }
    return html;
  }
  function parseReceipt(file) {
    if (!file) return null;
    var s = String(file);
    var idx = s.lastIndexOf(':');
    if (idx === -1) return { file: s, line: 1 };
    var line = parseInt(s.slice(idx + 1), 10);
    if (isNaN(line)) return { file: s, line: 1 };
    return { file: s.slice(0, idx), line: line };
  }

  // ---- screen-pinned layer captions (recomputed each cam frame) -----------
  function updateSysCaptions() {
    var host = document.getElementById('sys-captions');
    if (!host) return;
    if (!systemMode || !currentModel || !currentModel.system) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    if (!host.dataset.built) {
      var html = '';
      SYS_LAYERS.forEach(function (L) {
        var cap = SYS_LAYER_CAPTION[L];
        html += '<div class="sys-caption" data-layer="' + L + '">' + esc(cap.title) + '<span class="sys-caption-sub">' + esc(cap.sub) + '</span></div>';
      });
      host.innerHTML = html;
      host.dataset.built = '1';
    }
    positionSysCaptions();
  }
  // The layout is now TOP-DOWN: pages sit at the top, servers in the middle,
  // data at the bottom, external services in a right-hand gutter. So the layer
  // captions become VERTICAL band labels — pinned to the left rail at each
  // band's vertical center (frontend/servers/data) — plus a single header above
  // the right gutter (external). They pan vertically WITH the diagram (screen-y
  // derived from world-y) but stay anchored to the left edge horizontally, like
  // axis labels, so they never drift off-screen sideways.
  function positionSysCaptions() {
    var host = document.getElementById('sys-captions');
    if (!host || host.hidden) return;
    if (!currentModel || !currentModel.nodes) return;
    var sz = canvasSize();
    // bounds per layer from the actual laid-out nodes
    var L = {};
    currentModel.nodes.forEach(function (n) {
      if (n.ghost || !n.sys) return;
      var lay = n.layer || 'servers';
      if (lay === 'scheduled') return;          // cron rail has no band label
      var b = L[lay] || (L[lay] = { minY: 1e9, maxY: -1e9, minX: 1e9, maxX: -1e9 });
      var h = n.cronRail ? 30 : SYS_NODE_H;
      if (n.y < b.minY) b.minY = n.y;
      if (n.y + h > b.maxY) b.maxY = n.y + h;
      if (n.x < b.minX) b.minX = n.x;
      if (n.x + NODE_W > b.maxX) b.maxX = n.x + NODE_W;
    });
    Array.prototype.forEach.call(host.querySelectorAll('.sys-caption'), function (el) {
      var lay = el.getAttribute('data-layer');
      var b = L[lay];
      if (!b) { el.style.opacity = '0'; return; }
      if (lay === 'external') {
        // header centered above the right-hand gutter (pans fully with diagram)
        var wx = (b.minX + b.maxX) / 2, wy = b.minY - 30;
        var sx = wx * cam.k + cam.tx, sy = wy * cam.k + cam.ty;
        el.style.left = sx.toFixed(1) + 'px';
        el.style.top = sy.toFixed(1) + 'px';
        el.style.transform = 'translate(-50%,-100%)';
        el.style.textAlign = 'center';
        el.style.opacity = (sx < -160 || sx > sz.w + 160 || sy < -60 || sy > sz.h + 60) ? '0' : '0.92';
      } else {
        // left-rail band label at the band's vertical center
        var cy = ((b.minY + b.maxY) / 2) * cam.k + cam.ty;
        el.style.left = '16px';
        el.style.top = cy.toFixed(1) + 'px';
        el.style.transform = 'translateY(-50%)';
        el.style.textAlign = 'left';
        el.style.opacity = (cy < 8 || cy > sz.h - 8) ? '0' : '0.92';
      }
    });
  }

  function renderCanvas(flows, pages, nav, forms) {
    var nodeLayer = document.getElementById('node-layer');
    var wireLayer = document.getElementById('wire-layer');
    var empty = document.getElementById('canvas-empty');
    if (!nodeLayer || !wireLayer) return;

    // hide system-map screen captions when rendering the flows fallback map
    var sysCaps = document.getElementById('sys-captions');
    if (sysCaps) { sysCaps.hidden = true; }
    // if we were previously in system mode, the node/wire layers hold system
    // nodes the flows diff can't reconcile — clear them for a clean first paint.
    if (currentModel && currentModel.system) {
      wireLayer.innerHTML = ''; nodeLayer.innerHTML = '';
      renderedNodeIds = {}; renderedEdgeIds = {}; pulseRegistry = []; renderedClusterDbs = {};
      currentModel = null;
    }

    var model = buildModel(flows, pages, nav, forms);
    var firstPaint = currentModel === null;
    currentModel = model;

    if (!model.nodes.length) {
      if (empty) empty.hidden = false;
      wireLayer.innerHTML = ''; nodeLayer.innerHTML = '';
      renderedNodeIds = {}; renderedEdgeIds = {}; pulseRegistry = [];
      return;
    }
    if (empty) empty.hidden = true;

    // ---- diff: which node ids are NEW vs this render, which are gone -------
    var newNodeIds = {}, goneNodeIds = {};
    model.nodes.forEach(function (n) { if (!renderedNodeIds[n.id]) newNodeIds[n.id] = true; });
    Object.keys(renderedNodeIds).forEach(function (id) { if (!model.nodeById[id]) goneNodeIds[id] = true; });

    // remove gone nodes (fade+shrink, then prune)
    Object.keys(goneNodeIds).forEach(function (id) {
      var el = renderedNodeIds[id];
      if (el) {
        if (reduceMotion) { el.parentNode && el.parentNode.removeChild(el); }
        else { el.classList.add('cn-leave'); (function (e) { setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 360); })(el); }
      }
      delete renderedNodeIds[id];
    });

    // ---- (re)build wires + pulses (full redraw of the wire layer) ---------
    wireLayer.innerHTML = '';
    pulseRegistry = [];
    var newEdge = {};
    model.edges.forEach(function (e) {
      var from = model.nodeById[e.from], to = model.nodeById[e.to];
      if (!from || !to) return;
      var d = edgePath(from, to);
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', d);
      // Edge kinds on the canvas:
      //   nav   → a light ARROWED connector ("go to"), no data-flow pulse.
      //   owns  → a faint page→form tether (the form belongs to this page).
      //   data-flow (submit / door→record) → the teal wire; traced ones pulse.
      // Untraced (dynamic / unknown) edges are dashed and never pulse (honesty).
      var isNav = !!e.nav, isOwns = !!e.owns;
      var cls = 'map-wire';
      if (isNav) cls += ' wire-nav' + (e.traced ? '' : ' wire-untraced');
      else if (isOwns) cls += ' wire-owns';
      else cls += (e.traced ? '' : ' wire-untraced');
      path.setAttribute('class', cls);
      path.setAttribute('data-edge', e.id);
      if (isNav) path.setAttribute('marker-end', 'url(#nav-arrow)');
      wireLayer.appendChild(path);
      var isNewEdge = !renderedEdgeIds[e.id];
      if (isNewEdge) newEdge[e.id] = true;
      // draw-in animation for new edges (and on first paint, all edges)
      if (!reduceMotion && (isNewEdge || firstPaint)) {
        var len = path.getTotalLength ? path.getTotalLength() : 300;
        path.style.setProperty('--len', len.toFixed(0));
        path.classList.add('wire-draw');
      }
      // perpetual pulse ONLY on traced DATA-FLOW wires (not nav, not owns) —
      // honesty: nav connectors and dashed/untraced wires never pulse.
      if (e.traced && !isNav && !isOwns && !reduceMotion) {
        var pulse = document.createElementNS(SVGNS, 'path');
        pulse.setAttribute('d', d);
        pulse.setAttribute('class', 'flow-pulse');
        pulse.setAttribute('data-edge', e.id);
        wireLayer.appendChild(pulse);
        pulseRegistry.push({ edge: e, pathEl: path, pulseEl: pulse });
      }
    });
    // size + phase-stagger the pulses
    pulseRegistry.forEach(function (p, i) {
      var len = p.pathEl.getTotalLength ? p.pathEl.getTotalLength() : 300;
      p.pulseEl.style.setProperty('--len', len.toFixed(0));
      p.pulseEl.style.setProperty('--seg', '13');
      p.pulseEl.style.setProperty('--gap', (len + 13).toFixed(0));
      p.pulseEl.style.setProperty('--dur', '2.2s');
      p.pulseEl.style.setProperty('--dur-fast', '1.05s');
      p.pulseEl.style.setProperty('--phase', (-(i * 0.5) % 2.2).toFixed(2) + 's');
      // new-edge pulses wait for the wire to draw itself first
      if (newEdge[p.edge.id] || firstPaint) {
        p.pulseEl.style.visibility = 'hidden';
        (function (pe) { setTimeout(function () { pe.style.visibility = ''; }, 900); })(p.pulseEl);
      }
    });
    // ---- guard checkpoints on protected wires -----------------------------
    model.guards.forEach(function (g) {
      var path = wireLayer.querySelector('path.map-wire[data-edge="' + cssEsc(g.edgeId) + '"]');
      placeGuard(wireLayer, path, g, !!newEdge[g.edgeId] || firstPaint);
    });

    // ---- nodes: create new, reposition existing ---------------------------
    var staggerIdx = 0;
    model.nodes.forEach(function (n) {
      var host = renderedNodeIds[n.id];
      if (!host) {
        host = makeNode(n);
        nodeLayer.appendChild(host);
        renderedNodeIds[n.id] = host;
        positionNode(host, n);
        // spring-in (staggered on first paint, immediate-ish for live new nodes)
        if (!reduceMotion) {
          host.classList.add('cn-rise');
          var delay = firstPaint ? Math.min(staggerIdx * 48, 700) : 0;
          host.style.animationDelay = delay + 'ms';
          staggerIdx++;
          // a one-shot "just built" ring for live-added nodes (not first paint)
          if (!firstPaint && newNodeIds[n.id]) spawnRing(host, n);
        }
      } else {
        positionNode(host, n);
      }
    });
    renderedEdgeIds = {}; model.edges.forEach(function (e) { renderedEdgeIds[e.id] = true; });

    // ---- world-space band captions (redrawn each render to track the layout) --
    renderBandLabels(model);

    // ---- camera: fit on first paint; frame the new cluster on live build --
    if (firstPaint) {
      var fitInstant = reduceMotion;
      // first paint coordinates with the entrance: a gentle eased fit
      requestAnimationFrame(function () { fitAll(fitInstant); });
    } else if (!reduceMotion) {
      var newOnes = model.nodes.filter(function (n) { return newNodeIds[n.id]; });
      if (newOnes.length) scheduleAutoFrame(newOnes);
    }
  }

  function makeNode(n) {
    // An absolutely-positioned HTML wrapper (.cn-host) in #node-layer carrying
    // the WORLD position (left/top/width in world px). Inside it, a focusable
    // <button>.canvas-node fills it. NO SVG-embedded HTML — plain HTML under
    // the CSS-transformed #world, so it pans/zooms/drags with the wires.
    var host = document.createElement('div');
    host.className = 'cn-host' + (n.ghost ? ' node-ghost-host' : '');
    host.setAttribute('data-node', n.id);
    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.className = 'canvas-node' + (n.ghost ? ' node-ghost' : '');
    if (n.ghost) {
      btn.setAttribute('disabled', 'disabled'); btn.setAttribute('aria-disabled', 'true');
      // a ghost is the honest "I can't trace this" marker — say so on hover too.
      btn.setAttribute('title', 'The code mentions this, but I can’t trace where it goes — so I won’t pretend.');
    }
    var glyph = GLYPHS[(n.external ? 'door' : (BAND_GLYPH[n.band] || 'page'))] || GLYPHS.page;
    btn.className += ' cn-band-' + n.band;
    btn.innerHTML = '<span class="cn-glyph" aria-hidden="true">' + glyph + '</span><span class="cn-name">' + esc(n.label) + '</span>';
    btn.setAttribute('aria-label', nodeAria(n));
    host.appendChild(btn);
    positionNode(host, n);
    if (!n.ghost) {
      btn.addEventListener('mouseenter', function () { if (!draggingNode) focusNode(n, true); });
      btn.addEventListener('mouseleave', function () { if (!draggingNode) focusNode(n, false); });
      btn.addEventListener('focus', function () { focusNode(n, true); });
      btn.addEventListener('blur', function () { focusNode(n, false); });
      // arrow-key nudge in world space while the node button is focused (a11y)
      btn.addEventListener('keydown', function (e) {
        if (e.key.indexOf('Arrow') !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var d = e.shiftKey ? 20 : 8, dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -d; else if (e.key === 'ArrowRight') dx = d;
        else if (e.key === 'ArrowUp') dy = -d; else if (e.key === 'ArrowDown') dy = d;
        setNodePos(n, n.x + dx, n.y + dy);
      });
      // node drag: pointerdown on the node begins a drag (stopPropagation so it
      // never pans the canvas). drag-vs-click distinguished by a 4px threshold —
      // a tap (no real movement) opens the plain panel; a drag moves the node.
      host.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button !== 0) return;
        beginNodeDrag(n, host, e);
      });
    }
    return host;
  }
  function nodeAria(n) {
    if (n.band === 'page') return n.label + ', a page someone can visit' + (n.path ? ' at ' + n.path : '');
    if (n.band === 'form') return n.label + ', a form someone fills in';
    if (n.band === 'door') return n.label + ', a door into your app';
    if (n.band === 'record') return n.label + ', where information is saved';
    if (n.external) return n.label;
    return n.label;
  }
  function captionForNode(n) {
    if (!currentModel) return '';
    var fid = Object.keys(n.flows || {})[0];
    return (fid && currentModel.captions[fid]) || '';
  }
  function positionNode(host, n) {
    // Plain HTML left/top/width in WORLD px. Because .cn-host lives under the
    // CSS-transformed #world, these world coords are scaled+translated by the
    // SAME transform that moves the wires — so node and wire stay locked.
    host.style.left = n.x.toFixed(1) + 'px';
    host.style.top = n.y.toFixed(1) + 'px';
    host.style.width = NODE_W + 'px';
    host.style.height = NODE_H + 'px';
  }

  // ---- node-drag override map + live wire re-roping ----------------------
  // nodePos[id] = {x,y}: user-dragged positions, keyed by node id. The
  // deterministic layout provides defaults; drags override. Preserved across
  // live /api/events re-renders so a user-moved node never snaps back.
  var nodePos = {};
  var draggingNode = null;

  // Move a node to a NEW world position: update its model x/y, its DOM box, the
  // override map, AND re-rope every wire connected to it so the wires follow.
  function setNodePos(n, x, y) {
    n.x = x; n.y = y;
    nodePos[n.id] = { x: x, y: y };
    var host = renderedNodeIds[n.id];
    if (host) positionNode(host, n);
    redrawWiresForNode(n.id);
  }

  // Recompute the bezier 'd' for every edge touching nodeId (and its pulse +
  // guard), so dragging a node visibly drags its ropes with it.
  function redrawWiresForNode(nodeId) {
    if (!currentModel) return;
    var wireLayer = document.getElementById('wire-layer');
    if (!wireLayer) return;
    currentModel.edges.forEach(function (e) {
      if (e.from !== nodeId && e.to !== nodeId) return;
      var from = currentModel.nodeById[e.from], to = currentModel.nodeById[e.to];
      if (!from || !to) return;
      var d = edgePath(from, to);
      var path = wireLayer.querySelector('path.map-wire[data-edge="' + cssEsc(e.id) + '"]');
      if (path) path.setAttribute('d', d);
      var pulse = wireLayer.querySelector('path.flow-pulse[data-edge="' + cssEsc(e.id) + '"]');
      if (pulse) {
        pulse.setAttribute('d', d);
        if (pulse.getTotalLength) {
          var len = pulse.getTotalLength();
          pulse.style.setProperty('--len', len.toFixed(0));
          pulse.style.setProperty('--gap', (len + 13).toFixed(0));
        }
      }
      // system map: keep the inline wire label on the (moved) wire midpoint
      var lbl = wireLayer.querySelector('text.wire-label[data-edge="' + cssEsc(e.id) + '"]');
      if (lbl && path && path.getPointAtLength) {
        var mp = path.getPointAtLength(path.getTotalLength() * 0.5);
        lbl.setAttribute('x', mp.x.toFixed(1));
        lbl.setAttribute('y', (mp.y - 6).toFixed(1));
      }
    });
    // re-place any guard sitting on an affected wire (its midpoint moved)
    (currentModel.guards || []).forEach(function (g) {
      var e = edgeById(g.edgeId);
      if (!e || (e.from !== nodeId && e.to !== nodeId)) return;
      var grp = wireLayer.querySelector('g.guard-checkpoint[data-guard="' + cssEsc(g.id) + '"]');
      var path = wireLayer.querySelector('path.map-wire[data-edge="' + cssEsc(g.edgeId) + '"]');
      if (grp && path && path.getPointAtLength) {
        var pt = path.getPointAtLength(path.getTotalLength() * 0.5);
        grp.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ')');
      }
    });
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  // Begin a node drag. Convert the screen delta to a WORLD delta (divide by K)
  // and move the node live. A <4px movement is treated as a click (opens the
  // panel); a real drag suppresses that click and ropes the wires along.
  function beginNodeDrag(n, host, e) {
    if (e.stopPropagation) e.stopPropagation();  // never pan the canvas
    var startX = e.clientX, startY = e.clientY;
    var origX = n.x, origY = n.y;
    var moved = 0, isDrag = false;
    var pid = e.pointerId;
    try { host.setPointerCapture(pid); } catch (er) {}
    function move(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (!isDrag && moved > 4) {
        isDrag = true; draggingNode = n.id;
        host.classList.add('is-dragging');
        markInteractGlobal();
        focusNode(n, false);
      }
      if (isDrag) {
        // screen delta -> world delta (divide by K); update node + ropes
        setNodePos(n, origX + dx / cam.k, origY + dy / cam.k);
        ev.preventDefault();
      }
    }
    function up(ev) {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      try { host.releasePointerCapture(pid); } catch (er) {}
      if (isDrag) {
        host.classList.remove('is-dragging');
        draggingNode = null;
        // suppress the click that the browser fires after pointerup on a drag
        suppressNextClick(host);
      } else {
        // a tap, not a drag — open the plain panel
        if (!n.ghost) openNode(n);
      }
    }
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
  }
  function suppressNextClick(host) {
    var killer = function (ev) { ev.stopPropagation(); ev.preventDefault(); host.removeEventListener('click', killer, true); };
    host.addEventListener('click', killer, true);
    setTimeout(function () { host.removeEventListener('click', killer, true); }, 60);
  }
  // userInteractedAt marker reachable outside setupCanvasInteraction's closure
  function markInteractGlobal() { userInteractedAt = Date.now(); }

  // one-shot accent ring that expands and fades around a just-built node.
  // HTML now: a box-shadow pulse class on the host (no SVG ring element).
  function spawnRing(host, n) {
    host.classList.add('just-built-ring');
    setTimeout(function () { host.classList.remove('just-built-ring'); }, 1100);
  }

  // ONE lock checkpoint on the protected wire's midpoint, collision-safe.
  var GUARD_R = 14;
  function placeGuard(wireLayer, path, g, animate) {
    if (!path || !path.getPointAtLength) return;
    var L = path.getTotalLength();
    var pt = path.getPointAtLength(L * 0.5);
    // POSITION lives on the outer group via the transform ATTRIBUTE. The
    // spring-in ANIMATION (a CSS transform) lives on an INNER group. They must
    // be separate elements: a CSS transform overrides an element's transform
    // attribute entirely, so putting both on one group made gc-rise wipe out
    // translate(x,y) and snap the guard to the world origin (the "lock floating
    // at the far-left" bug). Same collision class as the node-stacking fix.
    var grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', 'guard-checkpoint');
    grp.setAttribute('data-guard', g.id);
    grp.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ')');
    grp.setAttribute('tabindex', '0');
    grp.setAttribute('role', 'img');
    grp.setAttribute('aria-label', 'Security guard checks requests to ' + g.doorName);
    var title = document.createElementNS(SVGNS, 'title');
    title.textContent = 'checked by the security guard';
    var anim = document.createElementNS(SVGNS, 'g');
    anim.setAttribute('class', 'gc-anim' + (animate && !reduceMotion ? ' gc-rise' : ''));
    var bg = document.createElementNS(SVGNS, 'circle');
    bg.setAttribute('class', 'gc-bg'); bg.setAttribute('r', GUARD_R);
    var icon = document.createElementNS(SVGNS, 'path');
    icon.setAttribute('class', 'gc-icon');
    icon.setAttribute('d', 'M-4.5,-1 h9 a1.4 1.4 0 0 1 1.4 1.4 v4.2 a1.4 1.4 0 0 1 -1.4 1.4 h-9 a1.4 1.4 0 0 1 -1.4 -1.4 v-4.2 a1.4 1.4 0 0 1 1.4 -1.4 z M-2.5,-1 v-1.8 a2.5 2.5 0 0 1 5 0 v1.8');
    icon.setAttribute('stroke-width', '1.4');
    icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
    anim.appendChild(bg); anim.appendChild(icon);
    grp.appendChild(title); grp.appendChild(anim);
    grp.addEventListener('click', function (e) { e.stopPropagation(); openGuard(g); });
    grp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGuard(g); } });
    grp.addEventListener('mouseenter', function () { focusFlow(g.flowId, true); });
    grp.addEventListener('mouseleave', function () { focusFlow(g.flowId, false); });
    grp.addEventListener('focus', function () { focusFlow(g.flowId, true); });
    grp.addEventListener('blur', function () { focusFlow(g.flowId, false); });
    wireLayer.appendChild(grp);
  }

  // ---- focus mode: dim the rest, strengthen this flow's path + pulse ------
  function setCaption(text) {
    var cap = document.getElementById('flow-caption');
    if (!cap) return;
    if (text) { cap.innerHTML = '<strong>' + esc(text) + '</strong>'; cap.hidden = false; }
    else cap.hidden = true;
  }
  function focusFlow(flowId, on) {
    if (!currentModel) return;
    if (on) setCaption(currentModel.captions[flowId] || '');
    else setCaption('');
    if (reduceMotion) return;
    // wires + pulses of this flow get strengthened/sped; everything else dims
    // !! on every force arg: a missing edge/flow yields undefined, and
    // classList.toggle(cls, undefined) flips instead of forcing off (see the
    // note in focusSystemNode) — which would light unrelated wires/nodes.
    Array.prototype.forEach.call(document.querySelectorAll('#wire-layer .map-wire'), function (p) {
      var e = edgeById(p.getAttribute('data-edge'));
      var mine = !!(e && e.flowId === flowId);
      p.classList.toggle('wire-hi', on && mine);
      p.classList.toggle('wire-dim', on && !mine);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#wire-layer .flow-pulse'), function (pp) {
      var e = edgeById(pp.getAttribute('data-edge'));
      var mine = !!(e && e.flowId === flowId);
      pp.classList.toggle('pulse-hi', on && mine);
      pp.classList.toggle('pulse-dim', on && !mine);
    });
    // dim non-participating nodes
    var inFlow = {};
    currentModel.edges.forEach(function (e) { if (e.flowId === flowId) { inFlow[e.from] = true; inFlow[e.to] = true; } });
    Array.prototype.forEach.call(document.querySelectorAll('#node-layer .cn-host'), function (h) {
      var id = h.getAttribute('data-node');
      h.classList.toggle('is-focus', on && !!inFlow[id]);
      h.classList.toggle('is-dim', on && !inFlow[id]);
    });
  }
  function focusNode(n, on) {
    var fid = Object.keys(n.flows || {})[0];
    if (n.visit || !fid) {
      // a visit page has no flow — just show its own caption, no dimming
      setCaption(on ? (n.visit ? n.label + ' — a page people can visit' : n.label) : '');
      return;
    }
    focusFlow(fid, on);
  }
  function edgeById(id) {
    if (!currentModel || !id) return null;
    for (var i = 0; i < currentModel.edges.length; i++) if (currentModel.edges[i].id === id) return currentModel.edges[i];
    return null;
  }

  // ---- opening the plain panel (reuses the learn popover) ----------------
  function openNode(n) {
    if (n.concept) openLearn(n.concept, n.step);
  }
  function openGuard(g) {
    var step = { plain: 'A security guard (middleware) runs before ' + g.doorName + ' opens, checking the visitor first.' };
    if (g.receipt) step.receipt = g.receipt;
    openLearn('guard', step);
  }

  // ---- auto-frame the newly-built cluster (debounced; never mid-interaction)
  var autoFrameTimer = null, pendingNew = [];
  function scheduleAutoFrame(newOnes) {
    pendingNew = pendingNew.concat(newOnes);
    if (autoFrameTimer) clearTimeout(autoFrameTimer);
    autoFrameTimer = setTimeout(function () {
      autoFrameTimer = null;
      var ns = pendingNew; pendingNew = [];
      // never yank the camera if the user just panned/zoomed
      if (Date.now() - userInteractedAt < 4000) return;
      var bb = nodesBBox(ns);
      if (bb) {
        // pad generously so the new cluster sits comfortably framed
        frameBox({ x1: bb.x1 - 40, y1: bb.y1 - 40, x2: bb.x2 + 40, y2: bb.y2 + 40 }, 90, false);
      }
    }, 600);
  }

  // ---- pan / zoom / fit interaction (Pointer Events + wheel) -------------
  // All bound on #canvas-viewport (the pan surface). Pan drives cam.tx/ty (TX/TY)
  // by the raw screen delta; zoom drives cam.k (K) toward the cursor. Node drags
  // are handled on the node itself (stopPropagation), so they never pan here.
  function setupCanvasInteraction() {
    var svg = document.getElementById('canvas-viewport');
    var host = svg;
    if (!svg || svg.__wired) return;
    svg.__wired = true;

    function clientToHost(cx, cy) {
      var r = host.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    }
    function markInteract() { userInteractedAt = Date.now(); }

    // --- pan via pointer drag on empty canvas; pinch via two pointers ---
    var pointers = {};   // id → {x,y}
    var panning = false, panStart = null, pinchStart = null;
    var moved = 0;
    svg.addEventListener('pointerdown', function (e) {
      // Bail on any UI control floating over the canvas (tour controls, zoom
      // buttons, menu, panels, links, inputs). The tour bar sits INSIDE
      // #canvas-viewport, so a pointerdown on "Walk me through it" bubbles here;
      // if we started a pan we'd call setPointerCapture and steal the pointer,
      // so the button's click never fired and the canvas dragged instead. Letting
      // UI handle its own pointer fixes that whole class of dead-button bug.
      if (e.target.closest && e.target.closest(
        'button, a, input, select, textarea, label, ' +
        '.tour-controls, .tour-caption, .canvas-ctl, .menu-sheet, .menu-btn, ' +
        '.overlay, .panel, [role="button"]'
      )) return;
      // start a drag only on empty canvas (not on a node — those stopPropagation —
      // nor on a guard checkpoint in the wire svg).
      var onChip = e.target.closest && (e.target.closest('.cn-host') || e.target.closest('.guard-checkpoint'));
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 1 && !onChip) {
        panning = true; moved = 0; panStart = { x: e.clientX, y: e.clientY, tx: camTarget.tx, ty: camTarget.ty };
        svg.classList.add('is-panning');
        try { svg.setPointerCapture(e.pointerId); } catch (er) {}
      } else if (ids.length === 2) {
        panning = false; svg.classList.remove('is-panning');
        var p = ids.map(function (id) { return pointers[id]; });
        pinchStart = { dist: dist(p[0], p[1]), k: camTarget.k,
          mid: clientToHost((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2),
          tx: camTarget.tx, ty: camTarget.ty };
      }
    });
    svg.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinchStart) {
        var p = ids.map(function (id) { return pointers[id]; });
        var d = dist(p[0], p[1]);
        var k = clampK(pinchStart.k * (d / Math.max(1, pinchStart.dist)));
        // keep the pinch midpoint fixed
        var m = pinchStart.mid;
        var wx = (m.x - pinchStart.tx) / pinchStart.k, wy = (m.y - pinchStart.ty) / pinchStart.k;
        camTarget.k = k; camTarget.tx = m.x - wx * k; camTarget.ty = m.y - wy * k;
        markInteract(); nudgeCam();
      } else if (panning && panStart) {
        var ddx = e.clientX - panStart.x, ddy = e.clientY - panStart.y;
        moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
        // PAN: TX/TY follow the raw screen delta (nodes + wires move together)
        camTarget.tx = panStart.tx + ddx; camTarget.ty = panStart.ty + ddy;
        markInteract(); nudgeCam();
      }
    });
    function endPointer(e) {
      delete pointers[e.pointerId];
      var ids = Object.keys(pointers);
      if (ids.length < 2) pinchStart = null;
      if (ids.length === 0) { panning = false; svg.classList.remove('is-panning'); }
    }
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);

    // --- wheel / trackpad-pinch zoom toward the cursor ---
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      markInteract();
      var pos = clientToHost(e.clientX, e.clientY);
      // ctrl+wheel = trackpad pinch; otherwise standard wheel zoom
      var factor = Math.exp(-(e.deltaY) * 0.0015);
      var k = clampK(camTarget.k * factor);
      // keep the point under the cursor fixed in world space
      var wx = (pos.x - camTarget.tx) / camTarget.k, wy = (pos.y - camTarget.ty) / camTarget.k;
      camTarget.k = k; camTarget.tx = pos.x - wx * k; camTarget.ty = pos.y - wy * k;
      nudgeCam();
    }, { passive: false });

    // --- zoom controls ---
    function zoomBy(mult) {
      markInteract();
      var sz = canvasSize();
      var cx = sz.w / 2, cy = sz.h / 2;
      var k = clampK(camTarget.k * mult);
      var wx = (cx - camTarget.tx) / camTarget.k, wy = (cy - camTarget.ty) / camTarget.k;
      camTarget.k = k; camTarget.tx = cx - wx * k; camTarget.ty = cy - wy * k;
      nudgeCam();
    }
    var zi = document.getElementById('zoom-in'), zo = document.getElementById('zoom-out'), zf = document.getElementById('zoom-fit');
    if (zi) zi.addEventListener('click', function () { zoomBy(1.25); });
    if (zo) zo.addEventListener('click', function () { zoomBy(0.8); });
    if (zf) zf.addEventListener('click', function () { markInteract(); fitAll(false); });

    // --- keyboard pan/zoom when the canvas viewport is focused ---
    svg.addEventListener('keydown', function (e) {
      // arrows nudge a focused NODE (handled on the node); here they pan the map
      if (e.target && e.target.closest && e.target.closest('.cn-host')) return;
      var step = 60;
      if (e.key === 'ArrowLeft') { camTarget.tx += step; markInteract(); nudgeCam(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { camTarget.tx -= step; markInteract(); nudgeCam(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { camTarget.ty += step; markInteract(); nudgeCam(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { camTarget.ty -= step; markInteract(); nudgeCam(); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') { zoomBy(1.25); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomBy(0.8); e.preventDefault(); }
      else if (e.key === '0') { markInteract(); fitAll(false); e.preventDefault(); }
    });

    // re-fit on resize so the diagram stays framed (only if the user is idle)
    var resizeT = null;
    window.addEventListener('resize', function () {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        if (current === 'map' && Date.now() - userInteractedAt > 4000) fitAll(true);
      }, 200);
    });
  }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  // ---- live refresh via long-poll (resilient backoff) --------------------
  // Two distinct loops so the reconnect banner ALWAYS self-clears:
  //   • poll()      — the live long-poll on /api/events (up to 25s per request).
  //   • reconnect() — a FAST /api/health probe used only while disconnected.
  // The bug being fixed: relying on the next /api/events response to clear the
  // banner meant it could persist up to the 25s long-poll timeout after the
  // server was already back. Now, the instant /api/health answers ok we remove
  // the banner, reset backoff, refresh, and resume the events loop immediately.
  var lastVersion = 0, polling = false, pollBackoff = 2000, reconnecting = false;
  var staleToken = false, reconnectTimer = null;
  function startEvents() {
    if (polling || staleToken) return;
    polling = true;
    poll();
  }
  function onDisconnected() {
    if (staleToken) return;     // terminal: only a Reload recovers this tab
    setConn(true);
    polling = false;            // stop the events loop; the health probe drives recovery
    if (!reconnecting) { reconnecting = true; reconnect(); }
  }
  function poll() {
    if (!polling || staleToken) return;
    api('/api/events?since=' + lastVersion).then(function (r) {
      // A 401 means the SERVER IS UP but this tab's token is stale — a health
      // probe can't fix that, so surface the actionable Reload banner instead
      // of the infinite "Reconnecting…".
      if (r.status === 401) { setStaleToken(); return null; }
      if (!r.ok) throw new Error('events ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j === null) return;   // handled 401 above
      setConn(false);
      pollBackoff = 2000; // recovered → reset backoff
      if (typeof j.version === 'number' && j.version > lastVersion) {
        lastVersion = j.version;
        lastVersionBumpAt = Date.now();
        refreshStatusStrip();
        pollHealthForBuild();
        updateBuildIndicator();
        if (current) show(current);
      }
      if (polling) setTimeout(poll, 100);
    }).catch(function () {
      // Server is unreachable (e.g. a daemon restart) — hand off to the fast
      // health-probe recovery loop so the banner clears the moment it returns.
      onDisconnected();
    });
  }
  // Fast recovery probe: hit /api/health on a 2s→10s backoff, indefinitely.
  // The MOMENT it returns ok → drop the banner, resume events, re-render.
  function reconnect() {
    if (staleToken) return;     // terminal: a Reload is the only path back
    reconnectTimer = null;      // this invocation consumed the scheduled timer
    api('/api/health').then(function (r) {
      // 401: server is back up but our token is stale → Reload, don't keep probing.
      if (r.status === 401) { setStaleToken(); return null; }
      if (!r.ok) throw new Error('health ' + r.status);
      return r.json();
    }).then(function (h) {
      if (h === null || staleToken) return;   // handled 401 above (or went stale)
      if (!h || h.ok !== true) throw new Error('health not ok');
      // Server is back. Self-heal immediately and never leave the banner up.
      reconnecting = false;
      pollBackoff = 2000;
      setConn(false);
      refreshStatusStrip();
      if (current) show(current);
      polling = true;
      poll();
    }).catch(function () {
      if (staleToken) return;   // do not re-show "Reconnecting…" once terminal
      setConn(true);            // keep the banner up while still down
      reconnectTimer = setTimeout(reconnect, pollBackoff);
      pollBackoff = Math.min(pollBackoff * 1.5, 10000);
    });
  }

  // ---- technical footer raw API links (tokened) -------------------------
  (function () {
    function withToken(p) { return p + '?t=' + encodeURIComponent(TOKEN); }
    var g = document.getElementById('raw-graph'); if (g) g.href = withToken('/api/graph');
    var v = document.getElementById('raw-verdicts'); if (v) v.href = withToken('/api/verdicts');
    var f = document.getElementById('raw-flows'); if (f) f.href = withToken('/api/flows');
    var lr = document.getElementById('raw-ledger'); if (lr) lr.href = withToken('/api/ledger');
    var lm = document.getElementById('learn-md-link');
    if (lm) lm.href = 'https://github.com/anthropics/program-design/blob/main/docs/learn.md';
  })();

  // ---- entrance sequence (the "design heavy on initial open") ------------
  // First open gets the full choreographed reveal (gated by localStorage
  // 'pd-entered'); return visits get a quick 1-beat fade. Reduced-motion and any
  // skip gesture (keypress/click/scroll/touch) jump straight to the final state.
  var entered = false;
  try { entered = localStorage.getItem('pd-entered') === '1'; } catch (e) {}
  // firstRun = full sequence; otherwise a quick fade. reduced-motion → neither.
  var firstRun = !entered && !reduceMotion;
  var quickRun = entered && !reduceMotion;
  var entranceDone = false;
  function settleEntrance() {
    if (entranceDone) return;
    entranceDone = true;
    document.body.classList.remove('pd-enter', 'pd-quick');
    document.body.classList.add('pd-settled');
    try { localStorage.setItem('pd-entered', '1'); } catch (e) {}
  }
  function setupEntrance() {
    if (reduceMotion) {
      // Instant final state — no choreography, no class juggling.
      document.body.classList.remove('pd-enter');
      document.body.classList.add('pd-settled');
      try { localStorage.setItem('pd-entered', '1'); } catch (e) {}
      return;
    }
    if (firstRun) {
      document.body.classList.add('pd-enter');
      // The reveal lands around 2.9s; then the essence retires to the wordmark.
      setTimeout(settleEntrance, 3000);
    } else {
      document.body.classList.remove('pd-enter');
      document.body.classList.add('pd-quick', 'pd-settled');
      try { localStorage.setItem('pd-entered', '1'); } catch (e) {}
    }
    // Skip affordance: any intentional gesture jumps to the final state.
    var skip = function () { settleEntrance(); detachSkip(); };
    function detachSkip() {
      document.removeEventListener('keydown', skip, true);
      document.removeEventListener('pointerdown', skip, true);
      document.removeEventListener('wheel', skip, true);
      document.removeEventListener('touchstart', skip, true);
    }
    if (firstRun) {
      document.addEventListener('keydown', skip, true);
      document.addEventListener('pointerdown', skip, true);
      document.addEventListener('wheel', skip, true);
      document.addEventListener('touchstart', skip, true);
    }
  }

  // topbar hairline appears only after the calm header has scrolled away
  (function () {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    var onScroll = function () { topbar.classList.toggle('is-stuck', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  // ---- boot: the map is the home ----------------------------------------
  function boot() {
    // Always paint the verdict status strip first (the only verdict surface here).
    refreshStatusStrip();
    var hash = (location.hash || '').replace('#', '');
    if (views.indexOf(hash) !== -1) { show(hash); return Promise.resolve(); }
    // The map is the home for EVERY audience (even technical — the map just
    // grows receipts). The Technical tree stays reachable from the menu.
    show('map');
    return Promise.resolve();
  }
  // First-time readers get the audience question before anything is drawn — so
  // gate the tour now (before boot's loadMap runs) and pop the modal after.
  var firstVisit = needsOnboarding();
  if (firstVisit) onboardingPending = true;
  applyAudience(audience, false);
  maybeShowCoach();
  setupEntrance();
  setupCanvasInteraction();
  wireTourControls();
  boot();
  if (firstVisit) openOnboarding(false);
  pollHealthForBuild();
  startEvents();
})();
`;
}
