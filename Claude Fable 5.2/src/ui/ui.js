// ─────────────────────────────────────────────────────────────────────────────
// ui/ui.js — the exhibition chrome.
//
//   createUI({ root }) → { update(dt, time), colors }
//
//   · builds all markup inside `root` (#ui)
//   · writes the theme tokens as CSS custom properties on #app while a theme
//     fade runs (and once at start), so every colour crossfades with the scene
//   · reads `state` every frame, talks back only through `actions`
//   · chrome groups reveal once `state.uiReveal` starts (staggered, on their own
//     unhurried clock) and fade with H
//   · elements that labels must avoid carry [data-avoid] and data-visible="0|1"
//   · publishes the clear stage area + chrome presence to interaction/layout.js
//   · SCHEMATIC mode fades in a numbered key to the plate's callouts
// ─────────────────────────────────────────────────────────────────────────────
import { state, actions, FLIGHT, SPEC, tempoFromSlider, sliderFromTempo } from '../core/state.js';
import { THEMES, palette, themeBlend } from '../core/themes.js';
import { globalUniforms } from '../core/gfx.js';
import { clamp, damp, ease, smoothstep, TAU } from '../core/math.js';
import { PARTS } from '../bee/parts.js';
import { PARTS_COPY, PART_COUNT, materialLine } from '../data/partsCopy.js';
import { layout } from '../interaction/layout.js';
import { el, setStyle, setClass, setText, createSlider, createSegmented } from './widgets.js';
import { createScope } from './scope.js';

const VARS = [
  ['bg', '--bg'], ['bgEdge', '--bg-edge'], ['line', '--line'], ['ink', '--ink'], ['inkSoft', '--ink-soft'],
  ['metal', '--metal'], ['accent', '--accent'], ['accentInk', '--accent-ink'], ['glow', '--glow'],
  ['paper', '--paper'], ['inkLine', '--ink-line'], ['panel', '--panel'],
];

const VIEW_ITEMS = [
  { id: 'iso', html: 'Iso' }, { id: 'plan', html: 'Plan' }, { id: 'front', html: 'Front' },
  { id: 'profile', html: 'Profile' }, { id: 'macro', html: 'Macro' },
];
const RENDER_ITEMS = [{ id: 'solid', html: 'Solid' }, { id: 'section', html: 'Section' }, { id: 'schematic', html: 'Schematic' }];

const LEGEND = [
  ['drag', 'orbit'], ['scroll', 'zoom'], ['right-drag', 'pan'], ['F', 'flight'], ['E', 'explode'],
  ['T', 'theme'], ['R', 'render'], ['1–5', 'views'], ['D', 'tour'], ['space', 'pause'],
  ['H', 'hide UI'], ['M', 'sound'], ['S', 'still'], ['P', 'proboscis'],
];

// numbered key to the schematic plate's callouts (same numbers as bee/schematic.js)
const KEY_ITEMS = Object.entries(PARTS).filter(([, p]) => p.n).sort((a, b) => a[1].n - b[1].n)
  .map(([id, p]) => ({ id, n: p.n, name: PARTS_COPY[id]?.title ?? p.name }));

const REVEAL_S = 1.9;   // the chrome's entrance takes this long once the intro releases it

// reveal windows (fractions of the reveal clock) and entrance offsets (em; + = from below)
const GROUPS = {
  frame: { a: 0.0, b: 0.42, dy: 0 },
  title: { a: 0.06, b: 0.58, dy: -0.7 },
  theme: { a: 0.16, b: 0.68, dy: -0.7 },
  bar: { a: 0.28, b: 0.82, dy: 0.9 },
  spec: { a: 0.38, b: 0.92, dy: 0.9 },
  legend: { a: 0.48, b: 1.0, dy: 0.9 },
};

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const pad2 = (n) => String(n).padStart(2, '0');

function hexSwatch([a, b]) {
  const hex = (r) => Array.from({ length: 6 }, (_, i) => {
    const t = (i / 6) * TAU;
    return `${(Math.cos(t) * r).toFixed(3)},${(Math.sin(t) * r).toFixed(3)}`;
  }).join(' ');
  return `<svg viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true">
    <polygon points="${hex(1)}" fill="${a}"/>
    <polygon points="${hex(0.5)}" fill="${b}"/>
    <polygon class="am-hex-edge" points="${hex(1)}"/>
  </svg>`;
}

export function formatTempo(t) {
  if (t >= 0.995) return '1×';
  if (t >= 0.5) return `${t.toFixed(2).replace(/0$/, '')}×`;
  return `1/${Math.round(1 / t)}×`;
}

function partHTML(id, themeIdx, selected) {
  const p = PARTS_COPY[id];
  if (!p) {
    return `<div class="am-eyebrow"><span>Part</span></div><h2 class="am-h2">${id}</h2>`;
  }
  return `
    <div class="am-eyebrow"><span>${p.group}</span><span>·</span><span>Part ${pad2(p.no)} / ${pad2(PART_COUNT)}</span>${selected ? '<span class="am-sel">· Selected</span>' : ''}</div>
    <h2 class="am-h2">${p.title}</h2>
    <p class="am-body">${p.description}</p>
    <dl class="am-facts">
      <dt class="am-mono">Material</dt><dd>${materialLine(id, THEMES[themeIdx].id)}</dd>
      <dt class="am-mono">Function</dt><dd>${p.func}</dd>
      <dt class="am-mono">In nature</dt><dd class="am-fact">${p.fact}</dd>
    </dl>`;
}

const SPEC_HTML = `
  <div class="am-eyebrow"><span>General arrangement</span><span>·</span><span>Plate 08</span></div>
  <h2 class="am-h2">Specification</h2>
  <p class="am-body">An articulated study of the worker honeybee, built as a working flying machine.
  A resonant thoracic motor drives four etched-glass wings through a geared hinge, and every part
  separates along its own axis for inspection.</p>
  <dl class="am-specrow">
    <div><dt class="am-mono">Span</dt><dd>${SPEC.spanMm}<small>mm</small></dd></div>
    <div><dt class="am-mono">Mass</dt><dd>${SPEC.massG}<small>g</small></dd></div>
    <div><dt class="am-mono">Beat</dt><dd>${SPEC.beatHz}<small>Hz</small></dd></div>
    <div><dt class="am-mono">Stroke</dt><dd>${SPEC.strokeDeg}<small>deg</small></dd></div>
  </dl>`;

export function createUI({ root }) {
  const app = root.closest('#app') || root.parentElement || document.documentElement;
  // The overlay must never scroll (focus or drag auto-scroll would shove the whole chrome sideways).
  const pinScroll = (node) => node.addEventListener('scroll', () => { if (node.scrollLeft || node.scrollTop) { node.scrollLeft = 0; node.scrollTop = 0; } });
  pinScroll(root); pinScroll(app);
  const colors = {};

  // ── theme tokens → CSS custom properties ──────────────────────────────────
  let wroteFinal = false, lastSerial = -1;
  function writeVars(force = false) {
    const changing = themeBlend.active || themeBlend.serial !== lastSerial;
    if (!force && !changing && wroteFinal) return;
    lastSerial = themeBlend.serial;
    wroteFinal = !themeBlend.active;
    const cur = palette.current;
    for (const [k, v] of VARS) {
      const c = cur[k];
      if (!c?.isColor) continue;
      const hex = '#' + c.getHexString();
      colors[k] = hex;
      setStyle(app, v, hex);
    }
  }
  writeVars(true);

  // ── markup ────────────────────────────────────────────────────────────────
  root.insertAdjacentHTML('beforeend', `
    <div class="am-frame am-group" data-g="frame" aria-hidden="true">
      <i class="am-corner am-corner--tl"></i><i class="am-corner am-corner--tr"></i>
      <i class="am-corner am-corner--bl"></i><i class="am-corner am-corner--br"></i>
      <i class="am-tick am-tick--t"></i><i class="am-tick am-tick--b"></i>
      <i class="am-tick am-tick--l"></i><i class="am-tick am-tick--r"></i>
    </div>

    <header class="am-title am-group" data-g="title" data-avoid>
      <div class="am-eyebrow"><span>Fig. II</span><span>—</span><span>Ornithopter Hymenoptera</span></div>
      <h1 class="am-h1"><em>Apis</em> Mechanica</h1>
      <div class="am-rule" data-ref="rule"></div>
      <div class="am-eyebrow am-title-meta"><span>Concept Nº 08</span><span>·</span><span>Articulated Flying Machine</span><span>·</span><span>1 : 1 Study</span></div>
    </header>

    <div class="am-tr am-group" data-g="theme" data-avoid>
      <div data-ref="themes"></div>
      <div class="am-status" role="status">
        <span class="am-mono am-marker" data-ref="tour"><i class="am-marker-dot"></i>Tour</span>
        <span class="am-mono am-marker" data-ref="paused">Paused</span>
        <i class="am-dot" data-ref="dot"></i>
        <span class="am-mono am-stack am-stack--l" data-ref="flight">
          <span data-f="${FLIGHT.RESTING}" class="is-on">Resting</span>
          <span data-f="${FLIGHT.WARMING}">Warming</span>
          <span data-f="${FLIGHT.IN_FLIGHT}">In flight</span>
          <span data-f="${FLIGHT.LANDING}">Landing</span>
        </span>
        <span class="am-mono am-sep">·</span>
        <span class="am-mono">Assembly <span class="am-pct" data-ref="pct">0%</span></span>
      </div>
      <aside class="am-skey" data-ref="skey" data-avoid data-visible="0" aria-label="Key to figures">
        <div class="am-panel-head"><span class="am-mono">Key to figures</span></div>
        <ol class="am-skey-list">${KEY_ITEMS.map((k) => `<li class="am-skey-item"><span class="am-skey-n">${k.n}</span><span class="am-skey-name">${k.name}</span></li>`).join('')}</ol>
      </aside>
    </div>

    <section class="am-bl am-group" data-g="spec">
      <div class="am-telemetry" data-ref="tele" data-avoid data-visible="0" aria-live="off">
        <div class="am-panel-head"><span class="am-mono">Telemetry</span><span class="am-mono" data-ref="teleState">Live</span></div>
        <div class="am-tele-grid">
          <div class="am-tele-cell"><span class="am-mono">Alt</span><span class="am-tele-val" data-ref="tAlt">0<small>mm</small></span></div>
          <div class="am-tele-cell"><span class="am-mono">Airspeed</span><span class="am-tele-val" data-ref="tSpd">0.00<small>m/s</small></span></div>
          <div class="am-tele-cell"><span class="am-mono">Heading</span><span class="am-tele-val" data-ref="tHdg">000°<small>N</small></span></div>
          <div class="am-tele-cell"><span class="am-mono">Beat</span><span class="am-tele-val" data-ref="tBeat">0<small>Hz</small></span></div>
        </div>
        <div class="am-scope"><canvas data-ref="scope"></canvas></div>
        <div class="am-scope-key">
          <span class="am-mono am-key-l"><i></i><span data-ref="kL">Left 90°</span></span>
          <span class="am-mono am-key-r"><i></i><span data-ref="kR">Right 90°</span></span>
        </div>
      </div>
      <div class="am-spec" data-ref="spec" data-avoid>
        <div class="am-spec-body" data-ref="specBody"></div>
      </div>
    </section>

    <div class="am-barwrap">
      <nav class="am-bar am-group am-interactive" data-g="bar" data-ref="bar" data-avoid aria-label="Controls"></nav>
    </div>

    <aside class="am-legend am-group" data-g="legend" data-avoid tabindex="0" aria-label="Keyboard and mouse controls">
      <div class="am-panel-head"><span class="am-mono">Controls</span><kbd class="am-kbd am-legend-q">?</kbd></div>
      <div class="am-legend-list" data-ref="legend"></div>
    </aside>
  `);

  const $ = (ref) => root.querySelector(`[data-ref="${ref}"]`);
  const groups = [...root.querySelectorAll('.am-group')].map((node) => ({
    node, cfg: GROUPS[node.dataset.g], alpha: 0, avoid: node.hasAttribute('data-avoid'),
  }));
  const specGroup = groups.find((g) => g.cfg === GROUPS.spec);
  const trGroup = groups.find((g) => g.cfg === GROUPS.theme);
  const rule = $('rule'), dot = $('dot'), pctEl = $('pct'), pausedEl = $('paused'), tourEl = $('tour');
  const skey = $('skey'), skeyItems = [...skey.querySelectorAll('.am-skey-item')];
  const flightStack = $('flight');
  const flightWords = [...flightStack.children];
  const wordW = {};
  let flightW = 0;
  const tele = $('tele'), specBody = $('specBody'), bar = $('bar');
  const tAlt = $('tAlt'), tSpd = $('tSpd'), tHdg = $('tHdg'), tBeat = $('tBeat'), kL = $('kL'), kR = $('kR'), teleState = $('teleState');
  const scope = createScope($('scope'));

  // theme selector
  const themeSeg = createSegmented({
    cls: 'am-themes', itemCls: 'am-theme', indicator: 'pill',
    items: THEMES.map((t, i) => ({ id: String(i), title: t.name, html: `${hexSwatch(t.swatch)}<span class="am-theme-name">${t.short}</span>` })),
    onSelect: (id) => actions.setTheme(Number(id)),
  });
  $('themes').replaceWith(themeSeg.root);

  // control bar
  const sep = () => el('i', 'am-vsep');
  const label = (t) => el('span', 'am-mono am-ctl-label', t);

  const explode = createSlider({
    label: 'Explode', ticks: [0, 1], minor: [0.25, 0.5, 0.75], step: 0.05,
    getValue: () => state.explodeTarget,
    onInput: (v) => actions.setExplode(v),
    onReset: () => actions.setExplode(0),
  });
  const explodeCtl = el('div', 'am-ctl');
  explodeCtl.append(label('Explode'), explode.root);

  const flightBtn = el('button', 'am-primary am-interactive');
  flightBtn.type = 'button';
  flightBtn.innerHTML = `<span class="am-mono am-stack am-stack--c"><span class="is-on">Take flight</span><span>Land</span></span>`;
  const flightLabels = [...flightBtn.querySelectorAll('.am-stack > span')];
  flightBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  flightBtn.addEventListener('click', () => actions.toggleFlight());

  const viewSeg = createSegmented({ items: VIEW_ITEMS, onSelect: (id) => actions.setView(id) });
  const viewCtl = el('div', 'am-ctl'); viewCtl.append(label('View'), viewSeg.root);
  const renderSeg = createSegmented({ items: RENDER_ITEMS, onSelect: (id) => actions.setRenderMode(id) });
  const renderCtl = el('div', 'am-ctl'); renderCtl.append(label('Render'), renderSeg.root);

  const orbitBtn = el('button', 'am-toggle am-interactive', `
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 8.6a5.3 5.3 0 1 1-1.6-4.4"/><path d="M12.1 1.4v3.2H8.9"/></svg>
    <span class="am-mono">Orbit</span><i class="am-led"></i>`);
  orbitBtn.type = 'button';
  orbitBtn.setAttribute('aria-label', 'Auto orbit');
  const orbitLed = orbitBtn.querySelector('.am-led');
  orbitBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  orbitBtn.addEventListener('click', () => actions.toggleOrbit());

  const tempo = createSlider({
    label: 'Tempo', ticks: [0, 1], minor: [sliderFromTempo(0.01), sliderFromTempo(0.1)], step: 0.02,
    getValue: () => sliderFromTempo(state.tempo),
    onInput: (s) => actions.setTempo(s > 0.985 ? 1 : tempoFromSlider(s)),
    onReset: () => actions.setTempo(1),
  });
  const tempoRead = el('span', 'am-mono am-readout', '1×');
  const tempoCtl = el('div', 'am-ctl'); tempoCtl.append(label('Tempo'), tempo.root, tempoRead);

  // Two decks. On one row they dissolve (display: contents) and `order` interleaves them:
  // explode | flight | view | render | orbit | tempo. When space runs out the bar shows them as two rows.
  const rowA = el('div', 'am-bar-row'), rowB = el('div', 'am-bar-row');
  const sepWide = sep(); sepWide.classList.add('am-vsep--wide');           // render | orbit — only exists on one row
  rowA.append(explodeCtl, sep(), flightBtn, sep(), orbitBtn, sep(), tempoCtl);
  rowB.append(viewCtl, sep(), renderCtl, sepWide);
  [...rowA.children].forEach((n, i) => { n.style.order = String([1, 2, 3, 4, 9, 10, 11][i]); });
  [...rowB.children].forEach((n, i) => { n.style.order = String([5, 6, 7, 8][i]); });
  bar.append(rowA, rowB);
  const seps = [...bar.querySelectorAll('.am-vsep')];

  // legend
  const legend = $('legend');
  let soundKbd = null;
  for (const [k, t] of LEGEND) {
    const item = el('span', 'am-legend-item', `<kbd class="am-kbd">${k}</kbd><span>${t}</span>`);
    if (k === 'M') soundKbd = item.querySelector('kbd');
    legend.append(item);
  }

  // spec panel: one specification layer + two part layers (crossfade A ↔ B)
  const mkLayer = (html) => { const n = el('div', 'am-layer', html); specBody.append(n); return { node: n, alpha: 0, key: null }; };
  const specLayer = mkLayer(SPEC_HTML); specLayer.key = 'spec';
  const partLayers = [mkLayer(''), mkLayer('')];
  const layers = [specLayer, ...partLayers];
  let current = specLayer;
  specLayer.alpha = 1;
  let pendingId = null, pendingT = 0, shownKey = 'spec';

  function contentKey(id) {
    if (!id) return 'spec';
    return `${id}|${state.theme}|${state.selectedPart === id && !state.hoverPart ? 1 : 0}`;
  }
  function showContent(id) {
    const key = contentKey(id);
    if (key === shownKey) return;
    shownKey = key;
    if (!id) { current = specLayer; return; }
    const next = partLayers.find((l) => l !== current && l.alpha < 0.02) ||
      partLayers.reduce((a, b) => (a.alpha <= b.alpha ? a : b));
    if (next === current) return;
    next.node.innerHTML = partHTML(id, state.theme, state.selectedPart === id && !state.hoverPart);
    next.key = key;
    current = next;
  }

  // ── pointer over interactive chrome → state.pointer.overUI ────────────────
  root.addEventListener('pointerover', (e) => {
    if (e.target.closest?.('.am-interactive')) state.pointer.overUI = true;
  });
  root.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget;
    if (!to || !to.closest?.('.am-interactive') || !root.contains(to)) state.pointer.overUI = false;
  });

  // ── measurement (only on resize / font load, never per frame) ─────────────
  let measureStage = 2; // 2 → layout widths, 1 → read dependent sizes
  let fontPx = 12;
  const requestMeasure = () => { measureStage = 2; };
  window.addEventListener('resize', requestMeasure);
  document.fonts?.ready?.then(requestMeasure);
  document.fonts?.addEventListener?.('loadingdone', requestMeasure);

  const blCol = root.querySelector('.am-bl'), legendEl = root.querySelector('.am-legend');
  const barWrap = root.querySelector('.am-barwrap'), titleEl = root.querySelector('.am-title'), trEl = root.querySelector('.am-tr');
  let barMode = 'centre';

  /**
   * The control bar is centred on the viewport when it fits between the two
   * bottom columns. Otherwise the legend steps up above the bar's row and the
   * bar slides as little as possible to clear the spec column; only if even
   * that fails does it wrap.
   */
  function layoutBar(vw, pad, gap) {
    // small viewports fold the key into a "Controls ?" chip (it opens on hover)
    const vh = root.clientHeight || window.innerHeight;
    setClass(legendEl, 'is-compact', vw < 1500 || vh < 780);
    const left = blCol.offsetWidth, right = legendEl.offsetWidth;
    const leftLimit = pad + left + gap, rightLimit = vw - pad - right - gap, hardRight = vw - pad;
    setStyle(bar, 'maxWidth', 'none');
    const widthIn = (mode) => { setClass(bar, 'is-compact', mode !== 'row'); setClass(bar, 'is-stack', mode === 'stack'); return bar.offsetWidth; };
    let centre = vw / 2, lift = false, under = false;
    const fits = (w, limitR) => { if (w > limitR - leftLimit) return false; centre = clamp(vw / 2, leftLimit + w / 2, limitR - w / 2); return true; };
    // preference: one row beside the key → two decks beside the key → one row with the key lifted → two decks, key lifted
    // → narrow windows: the bar takes the full width at the bottom and the spec column and key sit above it
    const wRow = widthIn('row');
    if (fits(wRow, rightLimit)) barMode = 'row';
    else {
      const wDeck = widthIn('compact');
      if (fits(wDeck, rightLimit)) barMode = 'compact';
      else if (fits(wRow, hardRight)) { barMode = 'row'; lift = true; widthIn('row'); }
      else if (fits(wDeck, hardRight)) { barMode = 'compact'; lift = true; }
      else {
        under = true; lift = true; centre = vw / 2;
        if (wDeck <= vw - 2 * pad) barMode = 'compact';
        else { barMode = 'stack'; widthIn('stack'); setStyle(bar, 'maxWidth', `${Math.floor(Math.max(240, vw - 2 * pad))}px`); }
      }
    }
    const shift = centre - vw / 2;
    setStyle(barWrap, 'transform', Math.abs(shift) > 0.5 ? `translate3d(${shift.toFixed(1)}px,0,0)` : 'none');
    const above = `${(pad + bar.offsetHeight + gap * 0.9).toFixed(1)}px`;
    setStyle(legendEl, 'bottom', lift ? above : '');
    setStyle(blCol, 'bottom', under ? above : '');
  }

  /** Clear stage area for the camera's composition offset (CSS px, transforms ignored). */
  function measureClear(vw, vh, gap) {
    const top = Math.max(titleEl.offsetTop + titleEl.offsetHeight, trEl.offsetTop + trEl.offsetHeight) + gap;
    const barTop = barWrap.offsetTop + bar.offsetTop;
    const l = blCol.offsetLeft + blCol.offsetWidth + gap;
    const r = legendEl.offsetLeft - gap;
    layout.vw = vw; layout.vh = vh;
    layout.pad = fontPx * 2.6;
    layout.clear = { l, t: top, r: Math.max(l + 1, r), b: Math.max(top + 1, barTop - gap) };
  }

  function measureLayout() {
    fontPx = parseFloat(getComputedStyle(root).fontSize) || 12;
    const vw = root.clientWidth || window.innerWidth, vh = root.clientHeight || window.innerHeight;
    const pad = fontPx * 2.6, gap = fontPx * 1.6;
    layoutBar(vw, pad, gap);
    // fix the spec panel height to its tallest possible content → no layout jumps
    const probe = el('div', 'am-spec-body');
    probe.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:100%;';
    const probes = [SPEC_HTML, ...Object.keys(PARTS_COPY).map((id) => partHTML(id, state.theme, true))].map((h) => {
      const n = el('div', 'am-layer', h); probe.append(n); return n;
    });
    root.querySelector('.am-spec').append(probe);
    let maxH = 0;
    for (const n of probes) maxH = Math.max(maxH, n.offsetHeight);
    probe.remove();
    setStyle(specBody, 'minHeight', `${Math.ceil(maxH)}px`);
  }
  function measureDependent() {
    tourW = tourEl.offsetWidth;
    for (const w of flightWords) wordW[w.dataset.f] = w.offsetWidth;
    flightW = 0;
    explode.measure(); tempo.measure();
    viewSeg.measure(); renderSeg.measure(); themeSeg.measure();
    scope.resize();
    seps.forEach((s) => s.classList.remove('is-hidden'));
    let wrapped = false;
    for (const s of seps) {
      const a = s.previousElementSibling, b = s.nextElementSibling;
      if (a && b && Math.abs(b.offsetTop - a.offsetTop) > 4) { s.classList.add('is-hidden'); wrapped = true; }
    }
    setClass(bar, 'is-wrapped', wrapped);
    measureClear(root.clientWidth || window.innerWidth, root.clientHeight || window.innerHeight, fontPx * 1.6);
  }

  // ── per-frame state ───────────────────────────────────────────────────────
  let hideK = state.uiHidden ? 1 : 0;
  let revealK = 0, keyK = 0, tourW = 0;
  let pulseK = 0, teleK = 0, soundOn = null;
  let lastFlight = null, lastWant = null, lastPaused = null, lastOrbit = null, lastTour = null, orbitK = 0;
  const tcache = {};
  const txt = (node, key, value) => { if (tcache[key] !== value) { tcache[key] = value; node.innerHTML = value; } };

  function update(dt, time) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    writeVars();
    if (measureStage === 2) { measureLayout(); measureStage = 1; }
    else if (measureStage === 1) { measureDependent(); measureStage = 0; }

    // reveal + hide
    hideK = damp(hideK, state.uiHidden ? 1 : 0, 7, dt);
    if (Math.abs(hideK - (state.uiHidden ? 1 : 0)) < 1e-3) hideK = state.uiHidden ? 1 : 0;
    // the intro only releases the chrome; the entrance itself keeps its own pace
    const released = clamp(state.uiReveal ?? 1) > 0;
    revealK = released ? Math.min(1, revealK + dt / REVEAL_S) : 0;
    const reveal = revealK;
    layout.chrome = (1 - hideK) * ease.inOutCubic(smoothstep(0.15, 0.9, reveal));
    for (const g of groups) {
      const r = ease.outCubic(smoothstep(g.cfg.a, g.cfg.b, reveal));
      const a = r * (1 - hideK);
      g.alpha = a;
      setStyle(g.node, 'opacity', a.toFixed(3));
      const dy = (1 - r) * g.cfg.dy * fontPx + hideK * Math.sign(g.cfg.dy) * fontPx * 0.35;
      setStyle(g.node, 'transform', Math.abs(dy) < 0.01 ? 'none' : `translate3d(0,${dy.toFixed(2)}px,0)`);
      setClass(g.node, 'is-off', a < 0.15);
      if (g.avoid) { const v = a > 0.05 ? '1' : '0'; if (g.node.dataset.visible !== v) g.node.dataset.visible = v; }
    }
    const ruleK = ease.inOutCubic(smoothstep(GROUPS.title.a + 0.12, GROUPS.title.b + 0.12, reveal));
    setStyle(rule, 'transform', `scaleX(${ruleK.toFixed(4)})`);

    // status line (the word box glides to the width of the current word)
    if (state.flight !== lastFlight) {
      lastFlight = state.flight;
      flightWords.forEach((w) => setClass(w, 'is-on', w.dataset.f === state.flight));
    }
    const fw = wordW[state.flight];
    if (fw) {
      flightW = flightW ? damp(flightW, fw, 9, dt) : fw;
      setStyle(flightStack, 'width', `${flightW.toFixed(2)}px`);
    }
    setText(pctEl, `${Math.round(clamp(state.assembly) * 100)}%`);
    if (state.paused !== lastPaused) { lastPaused = state.paused; setClass(pausedEl, 'is-on', state.paused); }
    if (state.tour !== lastTour) { lastTour = state.tour; setClass(tourEl, 'is-on', state.tour); }
    // PAUSED steps aside (CSS transition) to make room when TOUR is showing too
    setStyle(pausedEl, 'transform', state.tour && tourW ? `translate3d(${(-(tourW + fontPx * 0.5)).toFixed(1)}px,0,0)` : 'none');

    // schematic key: follows the render-mode crossfade, steps away when exploded
    const keyTarget = (globalUniforms.uSchematic?.value ?? (state.renderMode === 'schematic' ? 1 : 0)) *
      (1 - smoothstep(0.04, 0.35, state.explode || 0));
    keyK = keyTarget < 0.002 && keyK < 0.002 ? 0 : damp(keyK, keyTarget, 14, dt);
    setStyle(skey, 'visibility', keyK > 0.001 ? 'visible' : 'hidden');
    setStyle(skey, 'opacity', ease.outCubic(smoothstep(0, 0.35, keyK)).toFixed(3));
    for (let i = 0; i < skeyItems.length; i++) {
      const k = ease.outCubic(smoothstep(0.08 + i * 0.045, 0.5 + i * 0.045, keyK));
      setStyle(skeyItems[i], 'opacity', k.toFixed(3));
      setStyle(skeyItems[i], 'transform', k > 0.999 ? 'none' : `translate3d(${((1 - k) * fontPx * 0.5).toFixed(2)}px,0,0)`);
    }
    const kv = keyK > 0.05 && trGroup.alpha > 0.05 ? '1' : '0';
    if (skey.dataset.visible !== kv) skey.dataset.visible = kv;
    pulseK = damp(pulseK, state.flight === FLIGHT.IN_FLIGHT ? 1 : 0, 3, dt);
    const beatT = (time * 0.75) % 1;
    const breathe = 0.5 + 0.5 * Math.cos(beatT * TAU);
    setStyle(dot, 'opacity', (1 - pulseK * 0.5 * (1 - breathe)).toFixed(3));
    setStyle(dot, '--ring', (pulseK * 0.55 * (1 - ease.outCubic(beatT))).toFixed(3));
    setStyle(dot, '--ring-s', (0.6 + ease.outCubic(beatT) * 1.3).toFixed(3));

    // bar
    if (state.wantFlight !== lastWant) {
      lastWant = state.wantFlight;
      setClass(flightLabels[0], 'is-on', !state.wantFlight);
      setClass(flightLabels[1], 'is-on', state.wantFlight);
      flightBtn.setAttribute('aria-pressed', state.wantFlight ? 'true' : 'false');
      flightBtn.setAttribute('aria-label', state.wantFlight ? 'Land' : 'Take flight');
      flightLabels[0].setAttribute('aria-hidden', state.wantFlight ? 'true' : 'false');
      flightLabels[1].setAttribute('aria-hidden', state.wantFlight ? 'false' : 'true');
    }
    // while the bee is still landing for a requested explode, hold the thumb where it was put instead of springing back
    const explodePending = state.explodeTarget > state.explode + 0.001 && state.flight !== FLIGHT.RESTING;
    explode.update(dt, clamp(explodePending ? state.explodeTarget : state.explode));
    tempo.update(dt, clamp(sliderFromTempo(state.tempo)));
    setText(tempoRead, formatTempo(state.tempo));
    viewSeg.update(dt, state.view);
    renderSeg.update(dt, state.renderMode);
    themeSeg.update(dt, String(state.theme));
    if (state.autoOrbit !== lastOrbit) { lastOrbit = state.autoOrbit; setClass(orbitBtn, 'is-active', state.autoOrbit); orbitBtn.setAttribute('aria-pressed', state.autoOrbit ? 'true' : 'false'); }
    orbitK = damp(orbitK, state.autoOrbit ? 1 : 0, 8, dt);
    setStyle(orbitLed, '--on', orbitK.toFixed(3));
    if (soundKbd && state.sound !== soundOn) { soundOn = state.sound; setClass(soundKbd, 'is-on', state.sound); }

    // telemetry (fades with flightAmount)
    teleK = damp(teleK, smoothstep(0.04, 0.55, state.flightAmount || 0), 6, dt);
    if (teleK < 1e-3) teleK = 0;
    setStyle(tele, 'opacity', teleK.toFixed(3));
    setStyle(tele, 'transform', `translate3d(0,${((1 - teleK) * fontPx * 0.6).toFixed(2)}px,0)`);
    setStyle(tele, 'visibility', teleK > 0 ? 'visible' : 'hidden');
    // reserve the telemetry area for labels as soon as flight is requested, before it fades in
    const tv = (teleK > 0.002 || state.wantFlight) && specGroup.alpha > 0.03 ? '1' : '0';
    if (tele.dataset.visible !== tv) tele.dataset.visible = tv;
    if (teleK > 0.005) {
      const t = state.telemetry;
      txt(tAlt, 'alt', `${Math.max(0, Math.round(t.alt))}<small>mm</small>`);
      txt(tSpd, 'spd', `${(Math.max(0, t.airspeed) / 1000).toFixed(2)}<small>m/s</small>`);
      const h = ((Math.round(t.heading) % 360) + 360) % 360;
      txt(tHdg, 'hdg', `${String(h).padStart(3, '0')}°<small>${CARDINALS[Math.round(h / 45) % 8]}</small>`);
      const eff = t.beatHz * state.tempo;
      txt(tBeat, 'beat', state.tempo < 0.995
        ? `${eff < 10 ? eff.toFixed(1) : Math.round(eff)}<small>Hz · ${Math.round(t.beatHz)} nom.</small>`
        : `${Math.round(t.beatHz)}<small>Hz</small>`);
      txt(kL, 'kl', `Left ${Math.round(t.ampL)}°`);
      txt(kR, 'kr', `Right ${Math.round(t.ampR)}°`);
      txt(teleState, 'ts', state.paused ? 'Hold' : state.tempo < 0.995 ? `Live · ${formatTempo(state.tempo)}` : 'Live');
      scope.draw(dt, colors, t, state.tempo, state.paused);
    }

    // spec panel content
    const want = state.hoverPart || state.selectedPart || null;
    if (want !== pendingId) { pendingId = want; pendingT = 0; }
    pendingT += dt;
    const delay = pendingId ? (state.hoverPart ? 0.09 : 0) : 0.28;
    if (pendingT >= delay) showContent(pendingId);
    const othersOut = layers.every((l) => l === current || l.alpha < 0.3);
    for (const l of layers) {
      const target = l === current && othersOut ? 1 : 0;
      l.alpha = damp(l.alpha, target, target ? 9 : 13, dt);
      if (Math.abs(l.alpha - target) < 0.002) l.alpha = target;
      setStyle(l.node, 'opacity', l.alpha.toFixed(3));
      const y = l === current ? (1 - l.alpha) * fontPx * 0.5 : (1 - l.alpha) * -fontPx * 0.25;
      setStyle(l.node, 'transform', Math.abs(y) < 0.01 ? 'none' : `translate3d(0,${y.toFixed(2)}px,0)`);
      setStyle(l.node, 'visibility', l.alpha < 0.001 ? 'hidden' : 'visible');
    }
  }

  return { update, colors };
}
