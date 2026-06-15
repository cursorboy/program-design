import { describe, it, expect } from 'vitest';
import { renderAppHtml } from '../../src/server/views/app.js';
import { GLOSSARY } from '../../src/server/views/glossary.js';

describe('renderAppHtml', () => {
  const html = renderAppHtml({ token: 'abc123def456abc123def456abc123de' });

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('contains the permanent presence-not-correctness badge', () => {
    expect(html).toContain('verifies presence, not correctness');
  });

  it('opens on the INFINITE-CANVAS map (CSS-transformed #world, not lanes)', () => {
    // the map is the home: a pan/zoom canvas with a CSS-transformed #world layer.
    expect(html).toContain('id="view-map"');
    expect(html).toContain('class="canvas-host"');
    expect(html).toContain('id="canvas-viewport"');
    // the CORRECT architecture: a CSS-transformed #world wrapping the wire SVG
    // and the HTML node layer (NOT an SVG <g> camera group named #cam).
    expect(html).toContain('id="world"');
    expect(html).not.toContain('id="cam"');
    // the old lane/type-column IA is GONE from the landing
    expect(html).not.toContain('class="lane-svg map-svg"');
    expect(html).not.toContain('class="map-col-label"');
    expect(html).not.toContain('class="map-cols"');
    // the canvas builds its diagram client-side from /api/flows (+ /api/graph)
    expect(html).toContain('/api/flows');
    expect(html).toContain('checked by the security guard');
  });

  it('drives ONE CSS transform on #world (wires + HTML nodes move together)', () => {
    // pan/zoom/drag only mutate #world's CSS transform; a normal DIV transform
    // applies to BOTH the child SVG wires AND the child HTML node divs.
    expect(html).toContain('id="world"');
    expect(html).toContain("world.style.transform = 'translate(");
    // a CSS transform string in px + scale (not an SVG transform attribute)
    expect(html).toMatch(/world\.style\.transform = 'translate\(' \+ cam\.tx[\s\S]*?'px,'[\s\S]*?'px\) scale\(/);
    // the wire SVG layer and the HTML node layer both live INSIDE #world
    expect(html).toContain('id="wire-svg"');
    expect(html).toContain('id="wire-layer"');
    expect(html).toContain('id="node-layer"');
    const wStart = html.indexOf('<div id="world"');
    const wEnd = html.indexOf('</div>', html.indexOf('id="node-layer"'));
    const world = html.slice(wStart, wEnd > wStart ? wEnd : wStart + 1200);
    expect(world).toContain('id="wire-svg"');
    expect(world).toContain('id="node-layer"');
    // nodes are NEVER drawn as foreignObject anymore (the root-cause bug)
    expect(html).not.toContain('foreignObject');
  });

  it('the pan handler ignores UI controls (no dead buttons / stolen clicks)', () => {
    // The tour bar (and zoom/menu) sit INSIDE #canvas-viewport, so a pointerdown
    // on a button bubbles to the pan handler. If it started a pan it would
    // setPointerCapture and steal the click. The handler must bail on UI targets.
    expect(html).toMatch(/if \(e\.target\.closest && e\.target\.closest\(\s*'button, a, input/);
    expect(html).toContain('.tour-controls, .tour-caption, .canvas-ctl');
  });

  it('has the zoom + fit controls and the pan/zoom interaction', () => {
    expect(html).toContain('id="zoom-in"');
    expect(html).toContain('id="zoom-out"');
    expect(html).toContain('id="zoom-fit"');
    expect(html).toContain('function fitAll');
    expect(html).toContain('setupCanvasInteraction');
    // wheel zoom toward the cursor + pointer-drag pan
    expect(html).toContain("svg.addEventListener('wheel'");
    expect(html).toContain("svg.addEventListener('pointerdown'");
  });

  it('has a dot-grid background on #world that pans/scales with the world', () => {
    // the grid is a tiled radial-gradient ON #world, so it shares the world
    // transform and pans + scales with the nodes and wires.
    expect(html).toContain('class="grid-bg"');
    expect(html).toContain('radial-gradient(var(--border-strong)');
    // the grid div lives inside #world (under the same CSS transform)
    const wStart = html.indexOf('<div id="world"');
    const world = html.slice(wStart, wStart + 400);
    expect(world).toContain('class="grid-bg"');
  });

  it('lays nodes in role bands with WORLD-SPACE band labels (no desync)', () => {
    // band captions now live UNDER #cam as SVG <text> so they pan/zoom WITH the
    // nodes and never desync from the world — not screen-pinned absolute spans.
    expect(html).toContain('id="band-labels"');
    expect(html).toContain('function renderBandLabels');
    expect(html).toContain('var BAND_CAPTION');
    // the map now leads with the navigation graph (pages) + forms, then doors.
    expect(html).toContain('Pages people can visit');
    expect(html).toContain('Forms');
    expect(html).toContain('Doors into your app');
    expect(html).toContain('Your records');
    // the world labels are real SVG <text> built into the wire layer (world px)
    expect(html).toContain("document.createElementNS(SVGNS, 'text')");
    // the band-labels group lives INSIDE the #wire-svg (which lives in #world),
    // so it shares the node coordinate space and pans/zooms with them.
    const svgStart = html.indexOf('<svg id="wire-svg"');
    const svgEnd = html.indexOf('</svg>', svgStart);
    const wireWorld = html.slice(svgStart, svgEnd > svgStart ? svgEnd : svgStart + 600);
    expect(wireWorld).toContain('id="band-labels"');
    // the OLD screen-pinned absolute band-label spans are gone
    expect(html).not.toContain('class="band-label band-label-pages"');
    expect(html).not.toContain('.band-label-doors { left: 50%; }');
    // unconnected pages become the calmer lower cluster, still on the canvas
    expect(html).toContain('Pages people can visit');
    // band x-centers are deterministic world coordinates
    expect(html).toContain('var BAND_X');
  });

  it('is FULL-BLEED: the map view fills the whole viewport (no contained box)', () => {
    // the map view is a fixed full-viewport layer; the canvas fills it edge-to-
    // edge with 100dvh/100vw, no border, no rounded box.
    expect(html).toContain('.view-map.view {');
    expect(html).toContain('100dvh');
    expect(html).toContain('100vw');
    // the OLD contained bordered box height is gone (was calc(100vh - 150px))
    expect(html).not.toContain('height: calc(100vh - 150px)');
    // the canvas-host no longer carries a border/rounded box — it is edge-to-edge
    expect(html).toMatch(/\.canvas-host\s*\{[^}]*border:\s*none/);
    expect(html).toMatch(/\.canvas-host\s*\{[^}]*border-radius:\s*0/);
    // map-mode is the body switch that drives full-bleed + floating chrome
    expect(html).toContain('map-mode');
    expect(html).toContain("classList.toggle('map-mode', view === 'map')");
    // body stops scrolling on the map (the canvas pans, the page does not)
    expect(html).toContain('body.map-mode { overflow: hidden; }');
  });

  it('floats the header + banners over the canvas on the map (overlay, no reflow)', () => {
    // the header becomes a fixed translucent/blurred overlay bar on the map
    expect(html).toMatch(/body\.map-mode \.topbar\s*\{[^}]*position:\s*fixed/);
    expect(html).toContain('backdrop-filter');
    // banners + coach + STALE pill float (fixed) and do NOT push the canvas
    expect(html).toMatch(/body\.map-mode \.conn-banner\s*\{[^}]*position:\s*fixed/);
    expect(html).toMatch(/body\.map-mode #map-stale\s*\{[^}]*position:\s*fixed/);
    expect(html).toMatch(/body\.map-mode \.coach\s*\{[^}]*position:\s*fixed/);
    // the STALE banner is a subtler floating PILL (rounded), not a full-width bar
    expect(html).toMatch(/body\.map-mode #map-stale\s*\{[^}]*border-radius:\s*999px/);
    // the presence-not-correctness badge floats bottom-center on the map
    expect(html).toContain('class="map-foot"');
    expect(html).toMatch(/body\.map-mode \.map-foot\s*\{[^}]*position:\s*fixed/);
    // the fit math reserves a TOP inset for the floating header (no node hidden)
    expect(html).toContain('--header-h');
    expect(html).toContain('function headerInset');
  });

  it('makes the wire+pulse the hero (traced only), untraced dashed with no pulse', () => {
    // the perpetual pulse rides TRACED wires only
    expect(html).toContain('flow-pulse');
    expect(html).toContain("'flow-pulse'");
    // traced wire is a clear teal connector
    expect(html).toContain('.map-wire { fill: none; stroke: var(--accent)');
    // untraced wire: dashed, no pulse
    expect(html).toContain('wire-untraced');
    expect(html).toContain('.map-wire.wire-untraced { stroke: var(--border-strong); stroke-dasharray: 4 5');
  });

  it('positions each node as absolute HTML left/top in #node-layer (NOT foreignObject)', () => {
    // The CORRECT architecture: nodes are absolutely-positioned HTML in
    // #node-layer; positionNode sets style.left/top in WORLD px. They share
    // #world's CSS transform with the wires, so node + wire stay locked.
    expect(html).toContain('function positionNode');
    expect(html).toMatch(/function positionNode[\s\S]*?host\.style\.left/);
    expect(html).toMatch(/function positionNode[\s\S]*?host\.style\.top/);
    // makeNode builds a real HTML <div>.cn-host + <button>.canvas-node, no FO
    expect(html).toContain("document.createElement('div')");
    expect(html).toContain("document.createElement('button')");
    expect(html).not.toContain('foreignObject');
    // the OLD foreignObject node positioning is gone
    expect(html).not.toContain("fo.setAttribute('x'");
    // and the spring animates the .cn-host directly (a normal HTML element)
    expect(html).toContain('.cn-host.cn-rise');
    // #world's CSS transform (a different mechanism) is how pan/zoom works
    expect(html).toContain("world.style.transform = 'translate(");
  });

  it('makes nodes draggable and ropes their wires (nodePos override + threshold)', () => {
    // pointerdown on a NODE begins a node-drag (stopPropagation so it never pans)
    expect(html).toContain('function beginNodeDrag');
    expect(html).toContain("host.addEventListener('pointerdown'");
    // an override map keyed by node id persists user-dragged positions
    expect(html).toContain('var nodePos = {}');
    expect(html).toContain('nodePos[n.id]');
    // dragged positions are PRESERVED across live re-renders (no snap-back)
    expect(html).toMatch(/nodePos\[n\.id\][\s\S]{0,200}n\.x = p\.x; n\.y = p\.y;/);
    // screen delta -> world delta (divide by K) drives the node move
    expect(html).toContain('dx / cam.k');
    // drag-vs-click threshold (>4px = drag, else click opens the panel)
    expect(html).toContain('moved > 4');
    expect(html).toContain('suppressNextClick');
    // dragging a node re-ropes every wire connected to it
    expect(html).toContain('function redrawWiresForNode');
    expect(html).toContain('function setNodePos');
  });

  it('animates live builds: new nodes spring in with a just-built ring', () => {
    // spring-in on entrance + a one-shot box-shadow ring for live-added nodes
    expect(html).toContain('cn-rise');
    expect(html).toContain('just-built-ring');
    expect(html).toContain('function spawnRing');
    // and the camera frames the newly-built cluster (debounced, never mid-drag)
    expect(html).toContain('scheduleAutoFrame');
    expect(html).toContain('userInteractedAt');
    // a breathing build indicator when a build is active
    expect(html).toContain('id="build-indicator"');
  });

  it('has the calm empty state line (no boxes) when there are no nodes', () => {
    expect(html).toContain('a picture of your app appears here');
  });

  it('shows the status strip — the only verdict surface on the map', () => {
    expect(html).toContain('id="status-strip"');
    expect(html).toContain('refreshStatusStrip');
    // confirmed + failed phrasings from the brief
    expect(html).toContain('Everything Claude claimed checks out');
    expect(html).toContain("Claude's claims:");
    expect(html).toContain('see why');
  });

  it('puts navigation behind a single Menu affordance listing the sections', () => {
    expect(html).toContain('id="menu-btn"');
    expect(html).toContain('id="menu-sheet"');
    expect(html).toContain('data-view="report"');
    expect(html).toContain('data-view="history"');
    expect(html).toContain('data-view="plan"');
    expect(html).toContain('data-view="live"'); // Technical view
    expect(html).toMatch(/>Report</);
    expect(html).toMatch(/>History</);
    expect(html).toMatch(/>Plan</);
    expect(html).toContain('Technical view');
    expect(html).toContain('data-menu="learn"');
    expect(html).toContain('data-menu="export-md"');
    expect(html).toContain('data-menu="shortcuts"');
  });

  it('has the 401 stale-token safety-net banner with a Reload button', () => {
    // server is up but THIS tab's token is stale → actionable reload, not the
    // infinite "Reconnecting…". With the stable token this should be rare.
    expect(html).toContain('id="stale-token-banner"');
    expect(html).toContain('This tab is from an earlier session. Reload to reconnect.');
    expect(html).toContain('id="stale-token-reload"');
    expect(html).toContain('location.reload()');
    // a 401 from the events/health probe routes to the stale-token banner
    expect(html).toContain('setStaleToken');
    expect(html).toContain('r.status === 401');
  });

  it('keeps the network-error reconnect path with self-clearing health backoff', () => {
    // distinct from 401: a network error keeps the health-probe backoff that
    // self-clears the banner the instant /api/health returns ok.
    expect(html).toContain('/api/health');
    expect(html).toContain('pollBackoff');
    expect(html).toContain('setConn(false)');
  });

  it('enforces the hidden attribute globally so toggled banners actually hide', () => {
    // Root cause of the phantom "Lost connection" banner: .conn-banner had
    // display:flex which overrode the UA [hidden]{display:none}, so JS setting
    // hidden=true never visually hid it. A global guard makes hidden authoritative
    // for every toggled element (banners, coach, overlays).
    expect(html).toContain('[hidden] { display: none !important; }');
  });

  it('makes stale-token terminal: locks out the "Reconnecting…" banner (no stacking)', () => {
    // The two-banner bug: a pending reconnect() timer fired AFTER a 401 and
    // re-showed "Reconnecting…" stacked on top of the Reload banner. Fix: a
    // terminal staleToken flag that (a) makes setConn a no-op, (b) cancels the
    // scheduled reconnect timer, (c) early-returns every loop.
    expect(html).toContain('staleToken');
    // setConn must short-circuit once terminal
    expect(html).toMatch(/if\s*\(\s*staleToken\s*\)\s*\{\s*connBanner\.hidden\s*=\s*true;\s*return;/);
    // the scheduled reconnect timer is captured and cancelled on stale
    expect(html).toContain('reconnectTimer = setTimeout(reconnect');
    expect(html).toContain('clearTimeout(reconnectTimer)');
    // the loops bail out once terminal
    expect(html).toContain('if (!polling || staleToken) return;');
    expect(html).toContain('if (staleToken) return;');
  });

  it('renders in light mode with the warm-paper background color', () => {
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('#fafaf9');
    // no dark default surface should remain
    expect(html).not.toContain('#0f1115');
  });

  it('bakes the token into the page', () => {
    expect(html).toContain('"abc123def456abc123def456abc123de"');
  });

  it('loads only the mermaid CDN + Google Fonts as external resources', () => {
    // collect every external src/href
    const srcs = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(
      (m) => m[1] ?? '',
    );
    for (const s of srcs) {
      const allowed =
        s.startsWith('https://cdn.jsdelivr.net/npm/mermaid@11') ||
        s.startsWith('https://fonts.googleapis.com') ||
        s.startsWith('https://fonts.gstatic.com');
      expect(allowed, `unexpected external resource: ${s}`).toBe(true);
    }
    // and it does include the mermaid CDN
    expect(html).toContain('cdn.jsdelivr.net/npm/mermaid@11');
  });

  it('uses the IBM Plex typeface stack', () => {
    expect(html).toContain('IBM Plex Sans');
    expect(html).toContain('IBM Plex Mono');
  });

  it('includes the PLANNED banner and empty-state copy hooks', () => {
    expect(html).toContain('PLANNED — not yet verified');
  });

  it('respects reduced motion in the stylesheet', () => {
    expect(html).toContain('prefers-reduced-motion');
  });

  // ---- taste-directed map redesign (anti-card, hero pulse, checkpoint) ----

  it('canvas nodes are focusable buttons (ink only, verdict color off-node)', () => {
    // nodes are real <button>s built in world space; verdict color stays on the strip
    expect(html).toContain("btn.className = 'canvas-node'");
    expect(html).toContain('function makeNode');
    const m = html.match(/\.canvas-node\s*\{[^}]*\}/);
    expect(m, 'expected a .canvas-node rule').toBeTruthy();
    const rule = m ? m[0] : '';
    // hairline by default, faint surface — no verdict color on the node
    expect(rule).toContain('border: 1px solid var(--border)');
    expect(rule).not.toContain('--green');
    expect(rule).not.toContain('--red');
  });

  it('has the perpetual hero flow-pulse on traced wires', () => {
    // the pulse class + its keyframe + the element the client builds
    expect(html).toContain('flow-pulse');
    expect(html).toContain('@keyframes flow-pulse');
    expect(html).toContain("pulse.setAttribute('class', 'flow-pulse')");
  });

  it('renders ONE lock checkpoint marker on the protected wire (no emoji)', () => {
    // a single deduplicated guard-checkpoint class/marker exists…
    expect(html).toContain("grp.setAttribute('class', 'guard-checkpoint'");
    expect(html).toContain('.guard-checkpoint');
    expect(html).toContain('function placeGuard');
    // keyboard-focusable with the precise aria-label phrasing from the brief
    expect(html).toContain('Security guard checks requests to ');
    // …and it is NEVER a pictographic emoji lock — clean inline SVG only.
    expect(html).not.toContain('🔒');
  });

  it('defines the reusable easing custom properties', () => {
    expect(html).toContain('--ease-out:');
    expect(html).toContain('--ease-spring:');
    expect(html).toContain('--ease-fade:');
    expect(html).toContain('cubic-bezier(.16,1,.3,1)');
    expect(html).toContain('cubic-bezier(.34,1.56,.64,1)');
  });

  it('disables perpetual pulses under reduced motion', () => {
    const rm = html.indexOf('prefers-reduced-motion');
    const block = html.slice(rm);
    expect(block).toContain('.flow-pulse');
  });

  it('uses inline SVG type-glyphs for map nodes, not emoji', () => {
    expect(html).toContain('var GLYPHS = {');
    expect(html).toContain('page:');
    expect(html).toContain('door:');
    expect(html).toContain('record:');
  });

  it('opens with a choreographed entrance: essence line + first-run gate', () => {
    // the one-line essence is present on the landing
    expect(html).toContain('A calm map of what your app actually does.');
    expect(html).toContain('id="essence"');
    // first-run choreography is gated by localStorage 'pd-entered'
    expect(html).toContain('pd-entered');
    // the entrance/settle classes the script toggles on <body>
    expect(html).toContain('pd-enter');
    expect(html).toContain('pd-settled');
    // reduced-motion must jump straight to the final state (entrance gated)
    const rm = html.indexOf('prefers-reduced-motion');
    expect(html.slice(rm)).toContain('pd-enter');
  });

  it('keeps the presence-not-correctness badge as quiet footer micro-text', () => {
    expect(html).toContain('class="page-foot"');
    expect(html).toContain('verifies presence, not correctness');
  });

  it('does not contain purple/violet gradient slop', () => {
    expect(html.toLowerCase()).not.toContain('linear-gradient');
  });

  // ---- progressive disclosure ----

  it('has the three-level audience toggle (simple · guided · technical)', () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-aud="simple"');
    expect(html).toContain('data-aud="guided"');
    expect(html).toContain('data-aud="technical"');
    // human-language labels, not jargon
    expect(html).toContain('Keep it simple');
    expect(html).toContain('I write code');
  });

  it('persists depth in localStorage under key pd-depth, defaulting to map', () => {
    // The map is the default landing surface for every audience.
    expect(html).toContain('pd-depth');
    expect(html).toContain("var depth = 'map'");
  });

  it('persists the chosen audience under pd-audience, defaulting to guided', () => {
    expect(html).toContain('pd-audience');
    expect(html).toContain("var audience = 'guided'");
    // body[data-audience] is the CSS hook that gates the map's technical detail
    expect(html).toContain("setAttribute('data-audience'");
    expect(html).toContain('body:not([data-audience="technical"]) .sys-tech');
  });

  it('moves the audience toggle into the menu sheet', () => {
    const sheetStart = html.indexOf('id="menu-sheet"');
    const sheetEnd = html.indexOf('id="onboard"');
    const sheet = html.slice(sheetStart, sheetEnd);
    expect(sheet).toContain('aud-toggle');
    expect(sheet).toContain('How should we explain your app?');
  });

  it('ships a first-visit onboarding question with three audience choices', () => {
    expect(html).toContain('id="onboard"');
    expect(html).toContain('How should we explain it?');
    // each choice maps 1:1 to an audience and is dismissible without choosing
    expect(html).toContain('onboard-choice');
    expect(html).toContain('Skip — just show me the map');
    // the tour waits for the answer (stashed, not started under the modal)
    expect(html).toContain('pendingTour');
    expect(html).toContain('onboardingPending');
  });

  it('bakes every GLOSSARY concept key into the page', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(9);
    for (const c of GLOSSARY) {
      expect(html, `missing glossary key ${c.key}`).toContain('"' + c.key + '"');
    }
  });

  it('bakes every GLOSSARY entry (friendly term + plain def) into the page', () => {
    // The sheet renders all entries client-side from the baked JSON, so every
    // entry's friendly name, technical term, plain definition and why-line must
    // be present in the served markup.
    for (const c of GLOSSARY) {
      expect(html, `missing friendly ${c.friendly}`).toContain(c.friendly);
      expect(html, `missing technical ${c.technical}`).toContain(c.technical);
      expect(html, `missing plain def for ${c.key}`).toContain(c.plain);
      expect(html, `missing why for ${c.key}`).toContain(c.why);
    }
  });

  it('has the glossary sheet shell with a working close control and render hook', () => {
    expect(html).toContain('id="glossary-list"');
    expect(html).toContain('glossary-close');
    expect(html).toContain('The whole menu, in plain words');
    // the render loop that interpolates entries into the sheet
    expect(html).toContain('GLOSSARY.forEach');
    expect(html).toContain("class=\"glossary-entry\"");
  });

  it('has the report verdict filter chips and search box', () => {
    // chips are generated from this literal set in the baked client script
    expect(html).toContain("['all','All']");
    expect(html).toContain("['confirmed','Confirmed']");
    expect(html).toContain("['absent','Absent']");
    expect(html).toContain("['undetermined','Undetermined']");
    expect(html).toContain('data-filter="');
    expect(html).toContain('class="fchip"');
    expect(html).toContain('report-search');
  });

  it('has the dismissible first-run coach strip backed by localStorage pd-coach', () => {
    expect(html).toContain('id="coach"');
    expect(html).toContain('pd-coach');
    expect(html).toContain('tap deeper to see the real code');
  });

  it('switches mermaid to the neutral (light) theme', () => {
    expect(html).toContain("theme: 'neutral'");
  });

  it('serves the plain-level flow strips against /api/flows', () => {
    expect(html).toContain('/api/flows');
    expect(html).toContain('flows-host');
  });

  it('keeps the presence-not-correctness badge (already asserted) at all levels', () => {
    // The badge lives in the header outside any depth-gated container.
    expect(html).toContain('verifies presence, not correctness');
  });

  it('links the gentle primer (docs/learn.md)', () => {
    expect(html).toContain('docs/learn.md');
  });
});

describe('renderAppHtml — navigation graph + forms on the canvas', () => {
  const html = renderAppHtml({ token: 'abc123def456abc123def456abc123de' });

  it('consumes nav + forms from /api/flows when building the map', () => {
    // loadMap forwards nav + forms into renderCanvas → buildModel.
    expect(html).toContain('data.nav');
    expect(html).toContain('data.forms');
    expect(html).toContain('function buildModel(flows, pages, nav, forms)');
  });

  it('renders NAVIGATION edges as light arrowed connectors (distinct from data flow)', () => {
    // a dedicated nav arrowhead marker + a nav wire class that is NOT the teal
    // pulse wire — navigation is a link, not data movement.
    expect(html).toContain('id="nav-arrow"');
    expect(html).toContain('wire-nav');
    expect(html).toContain("marker-end', 'url(#nav-arrow)'");
    // nav/owns edges never get a flow pulse (honesty: only data-flow pulses).
    expect(html).toContain('!isNav && !isOwns');
  });

  it('renders FORM nodes (their own band + glyph)', () => {
    expect(html).toContain('cn-band-form');
    // a form glyph in the GLYPHS table and a form band-caption.
    expect(html).toMatch(/form:\s*'<svg/);
    expect(html).toContain("var BAND_CAPTION = { page: 'Pages people can visit', form: 'Forms'");
  });

  it('lays pages out by NAVIGATION DEPTH (left → right by hop distance)', () => {
    expect(html).toContain('function pageColX(depth)');
    expect(html).toContain('byDepth');
  });

  it('places the guard checkpoint at the protected wire MIDPOINT (not left of a node)', () => {
    // placeGuard samples the actual bezier path at 0.5 of its length.
    expect(html).toContain('path.getPointAtLength(L * 0.5)');
  });

  it('keeps guard POSITION (transform attr) separate from its spring ANIMATION (CSS transform)', () => {
    // Bug: a CSS transform (gc-rise spring) on the SAME element overrides the
    // positioning transform ATTRIBUTE, snapping the guard to the world origin
    // (the lock floating at the far-left). Fix: position on the outer
    // .guard-checkpoint group, animation on an inner .gc-anim group.
    // The animation class must NOT live on the positioned .guard-checkpoint element.
    expect(html).not.toContain("'guard-checkpoint' + (animate");
    expect(html).toContain("'gc-anim' + (animate");
    // the reduced-motion + keyframe rules target the inner element now
    expect(html).toContain('.gc-anim.gc-rise');
    expect(html).not.toContain('.guard-checkpoint.gc-rise');
  });

  it('uses plain-language labels — never the bare filename "Dynamic"', () => {
    // the canvas never hard-codes a raw component filename label.
    expect(html).not.toMatch(/>Dynamic</);
    expect(html).not.toContain("'Dynamic'");
  });

  it('WRAPS long node labels instead of truncating with an ellipsis', () => {
    // the primary node name wraps (line-clamp), so "the login door (/api/login)"
    // is never cut to "the login d…".
    expect(html).toContain('-webkit-line-clamp: 2');
    expect(html).not.toMatch(/\.cn-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});

describe('renderAppHtml — the layered LIVE SYSTEM MAP', () => {
  const html = renderAppHtml({ token: 'abc123def456abc123def456abc123de' });

  it('fetches /api/system-map and renders it as the primary map when present', () => {
    // loadMap fetches the system map first; nodes>0 → render the system map,
    // empty → fall back to the nav/forms flows map (kept intact).
    expect(html).toContain('/api/system-map');
    expect(html).toContain('function loadSystemMap');
    expect(html).toContain('function loadFlowsMap'); // the fallback path stays
    expect(html).toContain('function buildSystemModel');
    expect(html).toContain('function renderSystemCanvas');
  });

  it('lays out the four LAYER column captions for non-technical people', () => {
    expect(html).toContain('WHAT PEOPLE SEE');
    expect(html).toContain('SERVERS DOING THE WORK');
    expect(html).toContain('WHERE DATA LIVES');
    expect(html).toContain('OUTSIDE SERVICES');
    // captions are screen-pinned (float over the canvas), tracked to columns
    expect(html).toContain('id="sys-captions"');
    expect(html).toContain('function positionSysCaptions');
    // five layers laid left → right (scheduled rides above servers)
    expect(html).toContain("var SYS_LAYERS = ['frontend', 'servers', 'data', 'external']");
  });

  it('brands each node with a full-width bottom BAR in the provider colors (not a pill)', () => {
    // the provider name now lives in a branded bar across the bottom of the node,
    // colored in that org's brand primary — strong color coding, not a small pill.
    expect(html).toContain('var PROVIDER_BRAND');
    expect(html).toContain('class="sys-brandbar"');
    expect(html).toContain('sys-brand-dot');
    expect(html).toContain('sys-brand-name');
    // the old floating pill badge is gone
    expect(html).not.toContain('class="prov-badge"');
    // each recognized provider maps to a name + real brand colors
    expect(html).toContain("railway:");
    expect(html).toContain("neon:");
    expect(html).toContain("anthropic:");
    expect(html).toContain("#00E599");   // Neon green
    expect(html).toContain("#CC785C");   // Anthropic clay
    // external-service + data nodes get the WHOLE card branded
    expect(html).toContain('sys-branded');
  });

  it('uses inline-SVG kind glyphs (no emoji) per system node kind', () => {
    expect(html).toContain('var SYS_GLYPHS');
    // database / cache / worker / cron / externalService / dataTable glyphs
    expect(html).toContain('database:');
    expect(html).toContain('cache:');
    expect(html).toContain('worker:');
    expect(html).toContain('cron:');
    expect(html).toContain('externalService:');
    expect(html).toContain('dataTable:');
    // the verdict glyphs are allowed; no pictographic emoji here
    expect(html).not.toContain('🔒');
    expect(html).not.toContain('🗄');
  });

  it('clusters dataTables under their database, expandable (progressive disclosure)', () => {
    // tables are NOT top-level clutter — they cluster on their database and
    // reveal on expand. A sensitive table gets a lock glyph + its column hint.
    expect(html).toContain('function renderCluster');
    expect(html).toContain('function toggleCluster');
    expect(html).toContain("cluster.className = 'sys-cluster'");
    expect(html).toContain('sys-expand');
    expect(html).toContain('expandedDbs');
    // sensitive flag rendering: a lock glyph + the sensitive-column title hint
    expect(html).toContain('sys-sensitive');
    expect(html).toContain('sys-lock');
    expect(html).toContain('title="stores: ');
  });

  it('draws data-flow edges with labels, external/intended styling, and pulses', () => {
    // a short label rides each wire; full text on hover. External calls are a
    // lighter style; intended (coded-not-live) edges are dashed grey with no pulse.
    expect(html).toContain("'class', 'wire-label'");
    expect(html).toContain('wire-external');
    expect(html).toContain('wire-intended');
    expect(html).toContain('not running yet');
    // external-service edges are tinted in the org's brand color (a branded pulse)
    expect(html).toContain('wire-external');
    expect(html).toContain('pulse-branded');
    // the perpetual flow pulse rides every data-flow edge that is live (not intended) edges
    expect(html).toContain('!reduceMotion && !e.intended');
    expect(html).toContain('flow-pulse');
  });

  it('opens a plain side-panel for a system node (technical, host/provider, receipt)', () => {
    expect(html).toContain('function openSystemNode');
    expect(html).toContain('sys-panel-tech');
    expect(html).toContain('sys-panel-host');
    expect(html).toContain('sys-panel-sensitive');
    // the receipt path is parsed file:line and the snippet endpoint is reused
    expect(html).toContain('function parseReceipt');
    expect(html).toContain('Show me the code');
    expect(html).toContain('/api/snippet');
  });

  it('surfaces the two panels: How it works (dataFlows) + What looks off (concerns)', () => {
    // both are reachable from the menu and have their own views
    expect(html).toContain('data-view="howitworks"');
    expect(html).toContain('data-view="concerns"');
    expect(html).toContain('id="view-howitworks"');
    expect(html).toContain('id="view-concerns"');
    expect(html).toContain('function loadHowItWorks');
    expect(html).toContain('function loadConcerns');
    // How it works renders the dataFlows stories
    expect(html).toContain('map.dataFlows');
    expect(html).toContain('howitworks-list');
    // What looks off renders concerns with severity color (the ONE prominent place)
    expect(html).toContain('concerns-list');
    expect(html).toContain('sev-high');
    expect(html).toContain('sev-med');
    expect(html).toContain('sev-low');
  });

  it('badges the high-severity concern count on the menu affordance', () => {
    // "N to check" badge appears on the What-looks-off menu item for high sev
    expect(html).toContain('menu-badge');
    expect(html).toContain('to check');
    expect(html).toContain("c.severity === 'high'");
  });

  it('shows the map.what one-liner as a quiet header subtitle', () => {
    expect(html).toContain('id="sys-what"');
    expect(html).toContain('function setSystemChrome');
    expect(html).toContain('map.what');
  });

  it('keeps the permanent presence-not-correctness footer with the system map', () => {
    expect(html).toContain('verifies presence, not correctness');
  });

  it('reuses the infinite-canvas machinery (camera, fitAll, draggable nodes)', () => {
    // system nodes are draggable HTML under #world, ride the same CSS transform,
    // and re-rope their wires; fitAll frames the whole layered map.
    expect(html).toContain('function makeSystemNode');
    expect(html).toContain('function beginSystemNodeDrag');
    expect(html).toContain('function fitAll');
    expect(html).toContain("world.style.transform = 'translate(");
    // no foreignObject regressions
    expect(html).not.toContain('foreignObject');
  });

  it('aria-labels system nodes for non-coders (kind + provider)', () => {
    expect(html).toContain('function sysNodeAria');
    expect(html).toContain('a database');
    expect(html).toContain('an outside service');
  });
});

describe('renderAppHtml — the guided self-narrating tour', () => {
  const html = renderAppHtml({ token: 'abc123def456abc123def456abc123de' });

  it('ships the tour player chrome: caption bar, controls, progress, skip', () => {
    // the floating tour layer + its parts
    expect(html).toContain('id="tour-layer"');
    // the caption bar is a polite live region (screen readers announce each beat)
    expect(html).toContain('id="tour-caption"');
    expect(html).toMatch(/id="tour-caption"[^>]*aria-live="polite"/);
    expect(html).toContain('id="tour-caption-text"');
    // the tour is driven by Back / Next only (no autoplay) — the play/pause
    // button was removed (it overlapped the caption and confused the flow).
    expect(html).not.toContain('id="tour-play"');
    // back / next, beat progress + dots, replay, and skip-to-map
    expect(html).toContain('id="tour-back"');
    expect(html).toContain('id="tour-next"');
    expect(html).toContain('id="tour-progress-text"');
    expect(html).toContain('id="tour-dots"');
    expect(html).toContain('id="tour-replay"');
    expect(html).toContain('id="tour-skip"');
    expect(html).toContain('show the whole map');
  });

  it('shows the real landing/login screenshots via a tokened /api/shot <img>', () => {
    expect(html).toContain('id="tour-shot"');
    expect(html).toContain('id="tour-shot-img"');
    // the shot is loaded from the tokened /api/shot endpoint
    expect(html).toContain("'/api/shot?name=' + encodeURIComponent(beat.shot)");
  });

  it('enters tour mode by default when /api/tour returns beats', () => {
    // the first map load fetches the tour and starts it if not yet shown
    expect(html).toContain('/api/tour');
    expect(html).toContain('function ensureTour');
    expect(html).toContain('function startTour');
    expect(html).toContain('tourEverShown');
  });

  it('controls node/edge visibility by beat (reveal-by-beat, not removal)', () => {
    // the cumulative revealed set + visibility application (opacity, not removal)
    expect(html).toContain('function applyTourVisibility');
    expect(html).toContain('function recomputeRevealed');
    expect(html).toContain('tour-hidden');
    expect(html).toContain('tour-shown');
    expect(html).toContain('tour-reveal');
    // body.tour-active hides un-revealed nodes via opacity (layout stays stable)
    expect(html).toContain('body.tour-active #node-layer .cn-host.tour-hidden');
    expect(html).toContain('opacity: 0');
  });

  it('frames the camera around the currently-visible nodes (eased)', () => {
    expect(html).toContain('function frameVisibleNodes');
    expect(html).toContain('function goToBeat');
  });

  it('autoplays on a comfortable timer, pausable; manual steps pause it', () => {
    expect(html).toContain('function scheduleAutoplay');
    expect(html).toContain('AUTOPLAY_MS');
    expect(html).toContain('function manualBeat');
    expect(html).toContain('function pauseTour');
  });

  it('surfaces a concern beat in the amber tone with a What-looks-off button', () => {
    expect(html).toContain('id="tour-concern-btn"');
    expect(html).toContain('See what looks off');
    expect(html).toContain('is-concern');
    // the concern button opens the existing concerns panel
    expect(html).toContain("show('concerns')");
  });

  it('renders claim-check badges: ✓ built/found, ⚠ something to check', () => {
    expect(html).toContain('function claimFor');
    expect(html).toContain('sys-claim');
    expect(html).toContain('claim-ok');
    expect(html).toContain('claim-warn');
    expect(html).toContain('built and found in your code');
    expect(html).toContain('something to check');
    // ⚠ matches a concern by file path
    expect(html).toContain('function computeConcernNodes');
  });

  it('after the last beat / skip, reveals the FULL map + closing line', () => {
    expect(html).toContain('function endTour');
    expect(html).toContain('function skipToFull');
    expect(html).toContain('Explore on your own');
    expect(html).toContain('id="tour-explore"');
  });

  it('adds the Space / arrows / Esc tour shortcuts and documents them', () => {
    // documented in the shortcuts overlay
    expect(html).toContain('play or pause the guided tour');
    // Space toggles, Esc skips while the tour is active
    expect(html).toContain('skipToFull()');
  });

  it('reduced-motion still plays: instant reveals, no spring/auto-pan', () => {
    // the reduced-motion media block neutralizes the tour reveal animations
    expect(html).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*?\.cn-host\.tour-reveal/);
  });
});

describe('map key — "What am I looking at?"', () => {
  const html = renderAppHtml({ token: 'abc123def456abc123def456abc123de' });

  it('ships an always-available plain-language key on the map', () => {
    expect(html).toContain('id="map-key"');
    expect(html).toContain('What am I looking at?');
    expect(html).toContain('id="map-key-panel"');
    // explains the four visual primitives in plain words
    expect(html).toContain('Each box is a piece of your app');
    expect(html).toContain('moving dots show the direction');
    expect(html).toContain('security check that runs before a request');
    expect(html).toContain('can’t trace it for sure');
  });

  it('hides the key while the tour narrates the map', () => {
    expect(html).toContain('body.tour-active .map-key { display: none; }');
  });

  it('uses a jargon-free empty state on the canvas', () => {
    expect(html).toContain('the screens people open, and where their information goes');
    expect(html).not.toContain('pages, doors, and where information is saved');
  });
});
