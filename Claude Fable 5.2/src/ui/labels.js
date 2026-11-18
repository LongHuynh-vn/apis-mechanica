// ─────────────────────────────────────────────────────────────────────────────
// ui/labels.js — floating part labels with 2-D collision avoidance.
//
//   createLabels({ root, onSelect? }) → { update(frame, dt), getRects() }
//
// Layout, every frame, entirely in JS (no DOM reads except on resize / new text):
//  1. candidates are split into a LEFT and a RIGHT column at the x that shares
//     them out in proportion to each column's free height (so the two columns
//     stay balanced from any angle), with hysteresis so labels do not flip-flop;
//     a lone label (hover callout) simply takes the side its anchor is on
//  2. columns sit just outside the machine's true screen extents (layout.bee,
//     measured from the meshes, so wing tips are never covered); their vertical
//     range is the viewport minus any chrome ([data-avoid] rects) they overlap
//  3. if a column cannot hold its labels, priority-1 labels drop out (a dropped
//     label returns while its part is hovered), then the weakest priority-0 ones
//  4. labels are sorted by anchor y and packed with an exact 1-D cluster solver:
//     no two boxes overlap (min gap) and each sits as close to its anchor as possible
//  5. positions glide on critically damped springs; leaders (dot → elbow → label)
//     are drawn in one SVG, ordered by y; a pair whose leaders would still cross
//     (very different anchor depths) is swapped and the column re-packed
//  6. the overlap guard compares boxes at the SAME moments (now and along the
//     springs' current heading), so labels gliding together never trip it — only
//     a genuine collision makes a label fade, jump and return
// ─────────────────────────────────────────────────────────────────────────────
import { state, actions } from '../core/state.js';
import { Spring, clamp, damp } from '../core/math.js';
import { layout } from '../interaction/layout.js';
import { PARTS_COPY } from '../data/partsCopy.js';
import { setStyle, setClass } from './widgets.js';

const HEAD_IDS = new Set(Object.keys(PARTS_COPY).filter((id) => PARTS_COPY[id].group === 'Head'));

const SVGNS = 'http://www.w3.org/2000/svg';
const GAP_Y = 9;          // min vertical gap between label boxes (px)
const COL_GAP = 34;       // gap between the bee ellipse and a column's inner edge (px)
const SHOULDER = 18;      // horizontal leader segment next to the label (px)
const EDGE = 26;          // viewport margin (px)
const CHROME_PAD = 14;    // clearance around chrome rects (px)
const STICK = 14;         // anchor-y hysteresis before two labels swap order (px)
const LOOKAHEAD = 0.2;    // s — the overlap guard tests where a label is heading, not only where it is
const MOVING = 140;       // px/s mean anchor speed above which the layout holds still

/** Leader elbow → anchor segment for a label packed at n.top in a column with inner edge `edge`. */
function leaderOf(n, left, edge) {
  const ly = n.top + n.nameH * 0.5;
  const lx = left ? edge + 5 : edge - 5;
  let ex = left ? lx + SHOULDER : lx - SHOULDER;
  if (left) ex = Math.min(ex, Math.max(lx, n.ax - 6)); else ex = Math.max(ex, Math.min(lx, n.ax + 6));
  return [ex, ly, n.ax, n.ay];
}
function segCross([x1, y1, x2, y2], [x3, y3, x4, y4]) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

export function createLabels({ root, onSelect } = {}) {
  const layer = document.createElement('div');
  layer.className = 'am-labels';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'am-leaders');
  svg.setAttribute('aria-hidden', 'true');
  const gPaths = document.createElementNS(SVGNS, 'g');
  const gDots = document.createElementNS(SVGNS, 'g');
  svg.append(gPaths, gDots);
  layer.append(svg);
  root.append(layer);

  const select = onSelect || ((id) => actions.select(id));
  const nodes = new Map();
  let vw = 0, vh = 0, resized = false;
  window.addEventListener('resize', () => { resized = true; });
  // re-read chrome rects as soon as a chrome block appears / disappears
  new MutationObserver(() => { zoneTimer = 0; })
    .observe(root, { subtree: true, attributes: true, attributeFilter: ['data-visible'] });
  let zones = [];            // chrome rects to avoid
  let motion = 0;            // smoothed mean anchor speed (px/s)
  let zoneTimer = 0;
  let measureQueue = [];

  const fontsReady = () => { for (const n of nodes.values()) measureQueue.push(n); };
  document.fonts?.ready?.then(fontsReady);
  document.fonts?.addEventListener?.('loadingdone', fontsReady);

  function makeNode(item) {
    const el = document.createElement('div');
    el.className = 'am-label am-interactive';
    el.dataset.side = 'r';
    el.innerHTML = '<div class="am-label-name"></div><div class="am-label-cap"></div>';
    const nameEl = el.firstChild, capEl = el.lastChild;
    layer.append(el);
    const path = document.createElementNS(SVGNS, 'path');
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('r', '2.25');
    gPaths.append(path); gDots.append(dot);
    const n = {
      id: item.id, el, nameEl, capEl, path, dot,
      name: null, caption: null, w: 0, h: 0, nameH: 0, measured: false,
      side: 0, sx: new Spring(2.1, 1), sy: new Spring(2.1, 1), alpha: 0, live: false,
      hover: false, item: null, tx: 0, ty: 0, ax: 0, ay: 0, placed: false, keep: false,
      dside: 1, ghost: false, rank: null, eff: 0, hovered: false,
      pathD: '', dotXY: '',
    };
    el.addEventListener('pointerenter', () => { n.hover = true; actions.setHover(n.id); });
    el.addEventListener('pointerleave', () => { n.hover = false; if (state.hoverPart === n.id) actions.setHover(null); });
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => { e.stopPropagation(); select(n.id); });
    nodes.set(item.id, n);
    return n;
  }

  function setContent(n, item) {
    const name = item.name ?? item.id, caption = item.caption ?? '';
    if (name === n.name && caption === n.caption) return;
    n.name = name; n.caption = caption;
    n.nameEl.textContent = name;
    n.capEl.textContent = caption;
    n.capEl.style.display = caption ? '' : 'none';
    measureQueue.push(n);
  }

  function readZones() {
    zones = [];
    for (const z of root.querySelectorAll('[data-avoid]')) {
      if (z.dataset.visible === '0') continue;
      if (z.closest('[data-visible="0"]') && z.closest('[data-visible="0"]') !== z) continue;
      const r = z.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      zones.push({ l: r.left, r: r.right, t: r.top, b: r.bottom });
    }
  }

  /** Vertical range available to a column spanning [x0, x1]. */
  function columnRange(x0, x1) {
    let top = EDGE, bottom = vh - EDGE;
    for (const z of zones) {
      if (z.r + CHROME_PAD < x0 || z.l - CHROME_PAD > x1) continue;
      if ((z.t + z.b) / 2 < vh / 2) top = Math.max(top, z.b + CHROME_PAD);
      else bottom = Math.min(bottom, z.t - CHROME_PAD);
    }
    return { top, bottom };
  }

  /** Exact 1-D packing: sorted boxes, min gap, as close to desired tops as possible, inside [lo, hi]. */
  function pack(list, lo, hi) {
    const blocks = [];
    for (const n of list) {
      const b = { items: [n], offs: [0], height: n.h + GAP_Y, sum: n.desiredTop, count: 1, start: 0 };
      b.start = clamp(b.sum, lo, Math.max(lo, hi - b.height + GAP_Y));
      blocks.push(b);
      while (blocks.length > 1) {
        const a = blocks[blocks.length - 2], c = blocks[blocks.length - 1];
        if (a.start + a.height <= c.start + 0.01) break;
        for (let k = 0; k < c.items.length; k++) { a.items.push(c.items[k]); a.offs.push(a.height + c.offs[k]); }
        a.sum += c.sum - c.count * a.height;
        a.count += c.count;
        a.height += c.height;
        a.start = clamp(a.sum / a.count, lo, Math.max(lo, hi - a.height + GAP_Y));
        blocks.pop();
      }
    }
    for (const b of blocks) for (let k = 0; k < b.items.length; k++) b.items[k].top = b.start + b.offs[k];
  }

  function fits(list, range) {
    let h = 0;
    for (const n of list) h += n.h + GAP_Y;
    return h - GAP_Y <= range.bottom - range.top;
  }

  function update(frame, dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const w = frame.viewport?.w ?? window.innerWidth, h = frame.viewport?.h ?? window.innerHeight;
    if (w !== vw || h !== vh || resized) {
      vw = w; vh = h; resized = false; zoneTimer = 0;
      for (const n of nodes.values()) measureQueue.push(n);
    }
    // create / update nodes
    for (const n of nodes.values()) n.item = null;
    for (const it of frame.items || []) {
      const n = nodes.get(it.id) || makeNode(it);
      n.item = it;
      setContent(n, it);
    }
    // measure (batched reads, only when text or size changed)
    if (measureQueue.length) {
      const q = [...new Set(measureQueue)]; measureQueue = [];
      for (const n of q) { n.w = n.el.offsetWidth; n.h = n.el.offsetHeight; n.nameH = n.nameEl.offsetHeight; n.measured = true; }
      let mw = 0;
      for (const n of nodes.values()) if (n.measured) mw = Math.max(mw, n.w);
      layout.labelW = mw;
    }
    zoneTimer -= dt;
    if (zoneTimer <= 0) { readZones(); zoneTimer = 0.25; }

    const hoverId = frame.hoverId ?? null;
    // the anchors' ellipse, widened to the machine's true extents when known
    let b = frame.bounds || { cx: vw / 2, cy: vh / 2, rx: vw * 0.16, ry: vh * 0.25 };
    // MACRO frames the head: only the head's own parts are labelled (the rest of
    // the machine is out-of-focus backdrop), and the columns hug the head
    const headOnly = layout.subject === 'head' && layout.head.valid;
    const B = headOnly ? layout.head : layout.bee;
    if (headOnly) b = { cx: (B.l + B.r) / 2, cy: (B.t + B.b) / 2, rx: (B.r - B.l) / 2, ry: (B.b - B.t) / 2 };
    else if (B.valid) {
      const l = Math.min(b.cx - b.rx, B.l - 4), r = Math.max(b.cx + b.rx, B.r + 4);
      const t = Math.min(b.cy - b.ry, B.t - 4), bt = Math.max(b.cy + b.ry, B.b + 4);
      b = { cx: (l + r) / 2, cy: (t + bt) / 2, rx: (r - l) / 2, ry: (bt - t) / 2 };
    }

    // candidates
    const cand = [];
    let maxWAll = 0;
    for (const n of nodes.values()) {
      n.keep = false;
      n.hovered = false;
      const it = n.item;
      if (!it || !n.measured) continue;
      const onScreen = it.visible !== false && it.x > -40 && it.x < vw + 40 && it.y > -40 && it.y < vh + 40;
      if (!onScreen) continue;
      let eff = clamp(it.alpha ?? 0);
      const hovered = it.id === hoverId;
      if (hovered) eff = 1;
      else if (headOnly && !HEAD_IDS.has(it.id)) eff = 0;
      if (eff < 0.02) continue;
      n.eff = eff; n.hovered = hovered; n.ax = it.x; n.ay = it.y; n.prio = it.priority ?? 0;
      maxWAll = Math.max(maxWAll, n.w);
      cand.push(n);
    }

    // column geometry (inner edge clamped so labels stay on screen)
    const edgeOf = (left, maxW) => {
      const e = left ? b.cx - b.rx - COL_GAP : b.cx + b.rx + COL_GAP;
      const m = Math.max(EDGE, layout.pad || 0);     // align with the chrome's outer margin
      return left ? Math.max(e, m + maxW) : Math.min(e, vw - m - maxW);
    };
    const rangeOf = (left, maxW) => {
      const e = edgeOf(left, maxW);
      return columnRange(left ? e - maxW : e, left ? e : e + maxW);
    };

    // camera in motion (view glide, orbit fling)? Then the layout holds still:
    // columns and order freeze, so every label glides in step with its
    // neighbours and nothing has to fade. Order is settled once motion stops.
    let sum = 0, cnt = 0;
    for (const n of cand) {
      if (n.pax != null && n.alpha > 0.01) { sum += Math.hypot(n.ax - n.pax, n.ay - n.pay); cnt++; }
      n.pax = n.ax; n.pay = n.ay;
    }
    const speed = cnt && dt > 0 ? sum / cnt / dt : 0;
    motion = Math.max(speed, damp(motion, speed, 3, dt));
    const frozen = motion > MOVING && cand.length > 1;
    const holds = (n) => frozen && n.side !== 0 && n.alpha >= 0.01;

    // side assignment
    const cols = { l: [], r: [] };
    if (cand.length <= 1) {
      for (const n of cand) {
        const hyst = Math.max(18, b.rx * 0.14);
        if (n.side === 0 || n.alpha < 0.01) n.side = n.ax < b.cx ? -1 : 1;
        else if (n.side < 0 && n.ax > b.cx + hyst) n.side = 1;
        else if (n.side > 0 && n.ax < b.cx - hyst) n.side = -1;
      }
    } else {
      // split so each column's share matches its free height
      const rl = rangeOf(true, maxWAll), rr = rangeOf(false, maxWAll);
      const hl = Math.max(1, rl.bottom - rl.top), hr = Math.max(1, rr.bottom - rr.top);
      const sorted = cand.slice().sort((a, c) => a.ax - c.ax || a.ay - c.ay);
      const N = sorted.length;
      // halfway between the anchors' natural sides and a split by free height,
      // never more than a column can hold
      let avgH = 0;
      for (const n of cand) avgH += n.h + GAP_Y;
      avgH /= N;
      const capL = Math.floor((hl + GAP_Y) / avgH), capR = Math.floor((hr + GAP_Y) / avgH);
      // (anchors bunched in the middle, as seen head-on, have no natural side)
      const naturalK = cand.filter((n) => n.ax < b.cx).length;
      const shareK = (N * hl) / (hl + hr);
      const iqr = sorted[Math.floor(N * 0.75)].ax - sorted[Math.floor(N * 0.25)].ax;
      const wN = 0.5 * clamp(iqr / Math.max(1, 0.7 * b.rx));
      const kL = clamp(Math.round(clamp(wN * naturalK + (1 - wN) * shareK, N - capR, capL)), 1, N - 1);
      const m = (sorted[kL - 1].ax + sorted[kL].ax) / 2;
      const hyst = Math.max(12, b.rx * 0.06);
      sorted.forEach((n, i) => {
        const natural = i < kL ? -1 : 1;
        if (holds(n)) return;
        if (n.side === 0 || n.alpha < 0.01) n.side = natural;
        else if (n.side !== natural) {
          // keep the old side while the anchor is still near the split line
          if (natural > 0 ? n.ax > m + hyst : n.ax < m - hyst) n.side = natural;
        }
      });
    }
    for (const n of cand) (n.side < 0 ? cols.l : cols.r).push(n);

    for (const key of ['l', 'r']) {
      let list = cols[key];
      if (!list.length) continue;
      const left = key === 'l';
      let maxW = 0;
      for (const n of list) maxW = Math.max(maxW, n.w);
      const edge = edgeOf(left, maxW);
      const range = columnRange(left ? edge - maxW : edge, left ? edge : edge + maxW);
      // density rule
      if (!fits(list, range)) {
        list = list.filter((n) => n.prio === 0 || n.hovered);
        if (!fits(list, range)) {
          list.sort((a, c) => (c.hovered - a.hovered) || (c.eff - a.eff) || (a.prio - c.prio));
          while (list.length > 1 && !fits(list, range)) list.pop();
        }
      }
      // sticky order: start from last frame's order, swap neighbours only when
      // their anchors are clearly out of order (stops reordering flicker)
      list.sort((a, c) => (a.rank ?? 1e9) - (c.rank ?? 1e9) || a.ay - c.ay);
      for (let pass = 0, swapped = true; swapped && pass < list.length; pass++) {
        swapped = false;
        for (let i = 0; i + 1 < list.length; i++) {
          const a = list[i], c = list[i + 1];
          const fresh = a.rank == null || c.rank == null;
          const stick = fresh ? 0 : frozen ? Infinity : STICK;
          if (a.ay > c.ay + stick) { list[i] = c; list[i + 1] = a; swapped = true; }
        }
      }
      for (const n of list) n.desiredTop = n.ay - n.nameH * 0.5;
      pack(list, range.top, range.bottom);
      // leaders of neighbours must not cross: swap such a pair and re-pack
      for (let pass = 0; pass < 3 && !frozen; pass++) {
        let swapped = false;
        for (let i = 0; i + 1 < list.length; i++) {
          if (!segCross(leaderOf(list[i], left, edge), leaderOf(list[i + 1], left, edge))) continue;
          const t = list[i]; list[i] = list[i + 1]; list[i + 1] = t; swapped = true; i++;
        }
        if (!swapped) break;
        pack(list, range.top, range.bottom);
      }
      list.forEach((n, i) => { n.rank = i; });
      for (const n of list) {
        n.keep = true;
        n.tx = left ? edge - n.w : edge;
        n.ty = n.top;
        n.edge = edge;
      }
    }

    // motion: springs toward the packed targets (a label that is invisible jumps straight there)
    for (const n of nodes.values()) {
      if (!n.keep) { n.rank = null; continue; }
      if (n.alpha < 0.01 || !n.placed) { n.sx.set(n.tx); n.sy.set(n.ty); n.placed = true; n.dside = n.side; }
      if (n.dside !== n.side) { n.ghost = true; n.why = 'side'; n.rank = null; }     // switching column → fade, jump, fade in
      n.sx.step(dt, n.tx); n.sy.step(dt, n.ty);
    }
    // guard: displayed boxes must never overlap each other or the chrome. A label
    // whose glide would cross another fades out fast, jumps to its slot, fades back.
    // (If two TARGET boxes collide — only possible when both columns are squeezed
    // against each other on a tiny viewport — the weaker label is simply hidden.)
    const kept = [];
    for (const n of nodes.values()) { n.blocked = false; if (n.keep) kept.push(n); }
    const overD = (a, c) => a.sx.x < c.sx.x + c.w && c.sx.x < a.sx.x + a.w && a.sy.x < c.sy.x + c.h + 2 && c.sy.x < a.sy.x + a.h + 2;
    const overT = (a, c) => a.tx < c.tx + c.w && c.tx < a.tx + a.w && a.ty < c.ty + c.h && c.ty < a.ty + a.h;
    const inZone = (x, y, n) => zones.some((z) => x < z.r && z.l < x + n.w && y < z.b && z.t < y + n.h);
    const lag = (n) => Math.abs(n.sx.x - n.tx) + Math.abs(n.sy.x - n.ty);
    const weaker = (a, c) => (a.hovered ? c : c.hovered ? a : a.prio !== c.prio ? (a.prio > c.prio ? a : c) : a.eff < c.eff ? a : c);
    for (let i = 0; i < kept.length; i++) {
      const a = kept[i];
      if (inZone(a.tx, a.ty, a)) { a.blocked = true; continue; }
      for (let j = i + 1; j < kept.length; j++) {
        const c = kept[j];
        if (c.blocked || !overT(a, c)) continue;
        weaker(a, c).blocked = true;
      }
    }
    // predicted boxes at the same moments (now, +½ and +1 lookahead along each
    // spring's heading, capped at its target): labels gliding together in step
    // never collide; only genuinely crossing paths do
    const shown = [];
    for (const n of nodes.values()) {
      if (n.blocked || n.ghost || n.alpha <= 0.04) continue;
      n.px = [n.sx.x, n.sx.x, n.sx.x]; n.py = [n.sy.x, n.sy.x, n.sy.x];
      if (n.keep) {
        for (let k = 1; k < 3; k++) {
          const t = (LOOKAHEAD * k) / 2;
          const px = n.sx.x + n.sx.v * t, py = n.sy.x + n.sy.v * t;
          // never predict past the target
          n.px[k] = (px - n.tx) * (n.sx.x - n.tx) < 0 ? n.tx : px;
          n.py[k] = (py - n.ty) * (n.sy.x - n.ty) < 0 ? n.ty : py;
        }
      }
      shown.push(n);
    }
    const overS = (a, c) => {
      for (let k = 0; k < 3; k++) {
        if (a.px[k] < c.px[k] + c.w && c.px[k] < a.px[k] + a.w && a.py[k] < c.py[k] + c.h + 2 && c.py[k] < a.py[k] + a.h + 2) return true;
      }
      return false;
    };
    const inZoneS = (a) => {
      for (let k = 0; k < 3; k++) if (zones.some((z) => a.px[k] < z.r && z.l < a.px[k] + a.w && a.py[k] < z.b && z.t < a.py[k] + a.h)) return true;
      return false;
    };
    for (let i = 0; i < shown.length; i++) {
      const a = shown[i];
      if (a.ghost) continue;
      if (a.keep && inZoneS(a)) { a.ghost = true; a.why = 'zone'; continue; }
      for (let j = i + 1; j < shown.length; j++) {
        const c = shown[j];
        if (c.ghost || !overS(a, c)) continue;
        let mover;
        if (!a.keep || !c.keep) mover = !a.keep ? a : c;               // a label on its way out always yields
        else { mover = lag(a) >= lag(c) ? a : c; if (mover.hovered) mover = mover === a ? c : a; }
        mover.ghost = true; mover.why = `over:${(mover === a ? c : a).id}`;
        if (mover === a) break;
      }
    }

    // fade + write
    const anyHover = !!hoverId;
    for (const n of nodes.values()) {
      const target = n.keep && !n.ghost && !n.blocked ? n.eff * (anyHover && !n.hovered ? 0.42 : 1) : 0;
      n.alpha = damp(n.alpha, target, n.ghost ? 30 : target > n.alpha ? 7 : 9, dt);
      if (n.alpha < 0.01 && target === 0) { n.alpha = 0; n.ghost = false; }

      const a = n.alpha;
      const x = n.sx.x, y = n.sy.x;
      setStyle(n.el, 'opacity', a.toFixed(3));
      if (a > 0) setStyle(n.el, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`);
      const side = n.dside < 0 ? 'l' : 'r';
      if (n.el.dataset.side !== side) n.el.dataset.side = side;
      const live = a > 0.3 && n.keep;
      if (live !== n.live) { n.live = live; setClass(n.el, 'is-live', live); }
      setClass(n.el, 'is-hover', !!n.hovered && n.keep);
      setClass(n.dot, 'is-hover', !!n.hovered && n.keep);

      if (a > 0) {
        // leader: label inner edge → shoulder → anchor dot
        const ly = y + n.nameH * 0.5;
        const lx = n.dside < 0 ? x + n.w + 5 : x - 5;
        let ex = n.dside < 0 ? lx + SHOULDER : lx - SHOULDER;
        if (n.dside < 0) ex = Math.min(ex, Math.max(lx, n.ax - 6)); else ex = Math.max(ex, Math.min(lx, n.ax + 6));
        const d = `M${lx.toFixed(1)} ${ly.toFixed(1)}H${ex.toFixed(1)}L${n.ax.toFixed(1)} ${n.ay.toFixed(1)}`;
        if (d !== n.pathD) { n.pathD = d; n.path.setAttribute('d', d); }
        const dxy = `${n.ax.toFixed(1)},${n.ay.toFixed(1)}`;
        if (dxy !== n.dotXY) { n.dotXY = dxy; n.dot.setAttribute('cx', n.ax.toFixed(1)); n.dot.setAttribute('cy', n.ay.toFixed(1)); }
      }
      setStyle(n.path, 'opacity', a.toFixed(3));
      setStyle(n.dot, 'opacity', a.toFixed(3));
    }
  }

  /** Current label boxes (for tests): [{ id, x, y, w, h, alpha }] */
  function getRects() {
    return [...nodes.values()].filter((n) => n.alpha > 0.02).map((n) => ({
      id: n.id, x: n.sx.x, y: n.sy.x, w: n.w, h: n.h, alpha: n.alpha, tx: n.tx, ty: n.ty,
      ghost: n.ghost, blocked: n.blocked, keep: n.keep, why: n.why || '',
    }));
  }

  return { update, getRects };
}
