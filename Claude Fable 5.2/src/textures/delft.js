// ─────────────────────────────────────────────────────────────────────────────
// textures/delft.js — hand-painted cobalt Delftware, procedurally.
//
//   createDelftBandTexture({ size = 2048, seed = 7 })      4:1, wraps in U (abdominal rings)
//   createDelftMedallionTexture({ size = 1024, seed = 11 }) square, mirror-symmetric about u = 0.5
//
// Painted on PURE WHITE (the map multiplies a white glaze; white = untouched).
// Technique, like the real thing: translucent cobalt washes laid first with
// soft wet edges, edge darkening and granulation, then darker tapered outline
// strokes ("trek") with varying pressure that never quite match the washes,
// then dots, hatching and curling tendrils. Fully deterministic from `seed`.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rng, TAU } from '../core/math.js';

const WASH = [40, 78, 168];
const DEEP = [28, 58, 150];
const TREK = [20, 40, 120];
const DARK = [14, 28, 92];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return { canvas: c, ctx };
}

// ── geometry helpers ─────────────────────────────────────────────────────────
function bez(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const toPath = (pts) => { const p = new Path2D(); p.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) p.lineTo(...pts[i]); p.closePath(); return p; };

/** Pointed leaf outline (closed point list): base, direction, length, half-width, bend. */
function leafPts(base, ang, len, wid, bend = 0) {
  const L = (x, y) => add(base, rot(x, y, ang));
  const tip = L(len, bend * len * 0.25);
  const a = bez(L(0, 0), L(len * 0.3, wid * 1.3 + bend * len * 0.15), L(len * 0.72, wid * 0.6 + bend * len * 0.3), tip, 18);
  const b = bez(tip, L(len * 0.72, -wid * 0.6 + bend * len * 0.3), L(len * 0.3, -wid * 1.3 + bend * len * 0.15), L(0, 0), 18);
  return a.concat(b.slice(1));
}

/**
 * Fan-shaped petal around `base` (polar): half-opening `half` (rad), scalloped
 * rim with `lobes` lobes; `point` > 0 pulls the centre of the rim into a tip.
 */
function petalPts(base, ang, len, half, { lobes = 3, dip = 0.08, point = 0, skew = 0 } = {}) {
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * 2 - 1;                         // −1 … 1 across the petal
    const phi = u * half;
    const body = Math.pow(Math.cos((u * Math.PI) / 2), 0.32);
    const scal = 1 - dip * Math.pow(Math.abs(Math.sin(((u + 1) / 2) * lobes * Math.PI)), 0.7);
    const tip = 1 + point * Math.pow(1 - Math.abs(u), 3);
    const r = len * body * scal * tip * (1 + skew * u * 0.15);
    pts.push(add(base, rot(r, 0, ang + phi)));
  }
  return pts;
}

// ── the painter ──────────────────────────────────────────────────────────────
function painter(ctx, rnd, unit) {
  const jit = (a) => (rnd() - 0.5) * 2 * a;

  /** Tapered brush stroke along dense points. */
  function brush(pts, wMax, { col = TREK, alpha = 0.9, tin = 0.2, tout = 0.4, wobble = 0.2, minW = 0.1 } = {}) {
    if (pts.length < 2) return;
    const n = pts.length;
    const len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = len[n - 1] || 1;
    const ph = rnd() * TAU, fq = 1.5 + rnd() * 2.5;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const t = len[i] / L;
      const pr = Math.max(minW, smooth(0, tin, t) * Math.pow(1 - smooth(1 - tout, 1, t), 0.8));
      const w = wMax * pr * (1 + wobble * Math.sin(ph + t * fq * TAU)) * 0.5;
      left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
      right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
    }
    ctx.beginPath();
    ctx.moveTo(...left[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(...left[i]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(...right[i]);
    ctx.closePath();
    ctx.fillStyle = rgba(col, alpha);
    ctx.fill();
  }

  /** Translucent wash: soft wet edge, darker rim where the pigment pooled, granulation. */
  function wash(pts, alpha = 0.4, { col = WASH, dx = 0, dy = 0, grain = 1, rim = 1 } = {}) {
    const path = toPath(pts);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.filter = `blur(${(0.9 * unit).toFixed(2)}px)`;
    ctx.fillStyle = rgba(col, alpha);
    ctx.fill(path);
    if (rim > 0) {
      ctx.filter = `blur(${(0.6 * unit).toFixed(2)}px)`;
      ctx.strokeStyle = rgba(DEEP, alpha * 0.6 * rim);
      ctx.lineWidth = 2.2 * unit;
      ctx.stroke(path);
    }
    ctx.filter = 'none';
    if (grain > 0) {
      ctx.clip(path);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const n = Math.min(400, ((x1 - x0) * (y1 - y0)) / (60 * unit * unit)) * grain;
      ctx.fillStyle = rgba(DARK, 0.08);
      for (let i = 0; i < n; i++) ctx.fillRect(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 1.1 * unit, 1.1 * unit);
    }
    ctx.restore();
  }

  /** Outline a closed point list in two or three broken strokes, slightly off the wash. */
  function outline(pts, w, { pieces = 2, alpha = 0.92 } = {}) {
    const n = pts.length;
    const cuts = [0];
    for (let k = 1; k < pieces; k++) cuts.push(Math.floor((k / pieces + jit(0.06)) * n));
    cuts.push(n - 1);
    const off = [jit(1.4 * unit), jit(1.4 * unit)];
    for (let k = 0; k < pieces; k++) {
      const seg = pts.slice(Math.max(0, cuts[k] - 1), cuts[k + 1] + 1).map((p) => add(p, off));
      brush(seg, w * (0.85 + rnd() * 0.3), { tin: 0.18, tout: 0.4, alpha });
    }
  }

  function leaf(base, ang, len, wid, bend, { washA = 0.42, w = 3.0 } = {}) {
    const L = len * unit, Wd = wid * unit;
    const pts = leafPts(base, ang, L, Wd, bend);
    wash(pts, washA, { dx: jit(1.6 * unit), dy: jit(1.6 * unit) });
    wash(leafPts(base, ang + jit(0.05), L * 0.55, Wd * 0.6, bend), washA * 0.7, { grain: 0, rim: 0, col: DEEP });
    outline(pts, w * unit);
    const tip = add(base, rot(L * 0.82, bend * L * 0.2, ang));
    brush(bez(base, add(base, rot(L * 0.3, bend * L * 0.06, ang)), add(base, rot(L * 0.6, bend * L * 0.14, ang)), tip, 14), w * 0.5 * unit, { tin: 0.05, tout: 0.7, alpha: 0.75 });
  }

  function dots(c, r, n = 3, spread = 7) {
    const a0 = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + jit(0.3);
      const p = n === 1 ? c : add(c, rot(spread * unit, 0, a));
      ctx.beginPath();
      ctx.ellipse(p[0], p[1], r * unit * (0.85 + rnd() * 0.3), r * unit * (0.75 + rnd() * 0.3), rnd() * TAU, 0, TAU);
      ctx.fillStyle = rgba(TREK, 0.88);
      ctx.fill();
    }
  }

  /** A curling tendril: a clothoid whose curvature rises until it rolls up into a spiral. */
  function tendril(p, ang, len, dir = 1, turns = 1.5) {
    const pts = [p];
    const N = 90;
    let th = ang, x = p[0], y = p[1];
    const total = turns * TAU;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const ds = (len * unit / N) * (1.35 - 0.95 * t);
      th += dir * (total / N) * (0.15 + 3.4 * t * t * t);
      x += Math.cos(th) * ds; y += Math.sin(th) * ds;
      pts.push([x, y]);
    }
    brush(pts, 2.1 * unit, { tin: 0.04, tout: 0.55, wobble: 0.1, alpha: 0.85 });
  }

  function stem(p0, p1, p2, p3, w) { brush(bez(p0, p1, p2, p3, 40), w * unit, { tin: 0.06, tout: 0.3, wobble: 0.12 }); }

  /** Tulip standing on `base`, opening toward `ang` (canvas angle; −π/2 = up). */
  function tulip(base, ang, s, { leaves = true } = {}) {
    const S = s * unit;
    const head = add(base, rot(S * 0.62, 0, ang));
    const side = (k) => petalPts(head, ang + k * 0.38, S * 0.5, 0.36, { lobes: 1, dip: 0, point: 0.35, skew: k });
    const centre = petalPts(add(head, rot(-S * 0.02, 0, ang)), ang, S * 0.55, 0.32, { lobes: 1, dip: 0, point: 0.4 });
    for (const k of [-1, 1]) wash(side(k), 0.48, { dx: jit(2 * unit), dy: jit(2 * unit) });
    wash(centre, 0.4);
    wash(petalPts(head, ang, S * 0.3, 0.28, { lobes: 1, point: 0.2 }), 0.45, { grain: 0, rim: 0, col: DEEP });
    for (const k of [-1, 1]) outline(side(k), 3.0 * unit);
    outline(centre, 3.2 * unit);
    // ribs
    for (let k = -1; k <= 1; k++) {
      const a = ang + k * 0.13;
      brush(bez(head, add(head, rot(S * 0.12, 0, a)), add(head, rot(S * 0.26, 0, a)), add(head, rot(S * 0.38, 0, a)), 10), 1.5 * unit, { alpha: 0.65, tin: 0.05, tout: 0.7 });
    }
    // calyx + stem
    ctx.beginPath(); ctx.ellipse(head[0], head[1], S * 0.06, S * 0.04, ang + Math.PI / 2, 0, TAU); ctx.fillStyle = rgba(DARK, 0.85); ctx.fill();
    const bend = rot(0, S * 0.08 * (rnd() > 0.5 ? 1 : -1), ang);
    stem(base, add(add(base, rot(S * 0.2, 0, ang)), bend), add(add(base, rot(S * 0.42, 0, ang)), bend), head, 3.4);
    if (leaves) {
      leaf(add(base, rot(S * 0.1, 0, ang)), ang - 0.85, s * 0.48, s * 0.08, -0.55, { washA: 0.4 });
      leaf(add(base, rot(S * 0.2, 0, ang)), ang + 0.75, s * 0.4, s * 0.07, 0.5, { washA: 0.4 });
    }
  }

  /** Peony / rose: two rings of scalloped fan petals, a pooled heart, stippled stamens. */
  function peony(c, s, petals = 7) {
    const S = s * unit;
    const a0 = rnd() * TAU;
    const outer = [], inner = [];
    for (let i = 0; i < petals; i++) {
      const a = a0 + (i / petals) * TAU + jit(0.07);
      outer.push(petalPts(add(c, rot(S * 0.1, 0, a)), a, S * (0.55 + jit(0.04)), (Math.PI / petals) * 1.12, { lobes: 3, dip: 0.12, skew: jit(0.5) }));
    }
    for (let i = 0; i < 5; i++) {
      const a = a0 + Math.PI / petals + (i / 5) * TAU + jit(0.1);
      inner.push(petalPts(add(c, rot(S * 0.04, 0, a)), a, S * 0.33, (Math.PI / 5) * 1.05, { lobes: 2, dip: 0.14 }));
    }
    for (const p of outer) wash(p, 0.34, { dx: jit(1.5 * unit), dy: jit(1.5 * unit) });
    // shading at the petal bases (the painter's second, loaded stroke)
    for (let i = 0; i < petals; i++) {
      const a = a0 + (i / petals) * TAU;
      wash(petalPts(add(c, rot(S * 0.1, 0, a)), a, S * 0.34, (Math.PI / petals) * 0.8, { lobes: 1, dip: 0 }), 0.3, { grain: 0, rim: 0, col: DEEP });
    }
    for (const p of outer) outline(p, 2.8 * unit, { pieces: 3 });
    for (const p of inner) wash(p, 0.5, { grain: 0.5 });
    for (const p of inner) outline(p, 2.4 * unit, { pieces: 2 });
    // petal hatching: short radial strokes
    for (let i = 0; i < petals * 3; i++) {
      const a = a0 + (i / (petals * 3)) * TAU + jit(0.05);
      const p0 = add(c, rot(S * 0.36, 0, a)), p1 = add(c, rot(S * (0.47 + jit(0.03)), 0, a));
      brush([p0, lerp2(p0, p1, 0.5), p1], 1.4 * unit, { alpha: 0.55, tin: 0.1, tout: 0.6 });
    }
    // heart
    ctx.save();
    ctx.filter = `blur(${(1.2 * unit).toFixed(2)}px)`;
    ctx.beginPath(); ctx.arc(c[0], c[1], S * 0.12, 0, TAU); ctx.fillStyle = rgba(DEEP, 0.7); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(c[0], c[1], S * 0.125, 0.4, TAU - 0.2);
    ctx.strokeStyle = rgba(DARK, 0.85); ctx.lineWidth = 2.2 * unit; ctx.stroke();
    for (let i = 0; i < 11; i++) {
      const p = add(c, rot(S * (0.02 + rnd() * 0.08), 0, rnd() * TAU));
      ctx.beginPath(); ctx.arc(p[0], p[1], (1.3 + rnd() * 1.1) * unit, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
    }
  }

  function spray(base, ang, s, nLeaves = 5) {
    const S = s * unit;
    const tip = add(base, rot(S, 0, ang));
    const sgn = rnd() > 0.5 ? 1 : -1;
    const bendV = rot(0, S * 0.2 * sgn, ang);
    const c1 = add(add(base, rot(S * 0.33, 0, ang)), bendV), c2 = add(add(base, rot(S * 0.7, 0, ang)), [bendV[0] * 0.4, bendV[1] * 0.4]);
    const pts = bez(base, c1, c2, tip, 40);
    brush(pts, 2.6 * unit, { tin: 0.04, tout: 0.55 });
    for (let i = 0; i < nLeaves; i++) {
      const t = 0.2 + (i / nLeaves) * 0.72;
      const idx = Math.floor(t * (pts.length - 1));
      const p = pts[idx], q = pts[Math.min(pts.length - 1, idx + 1)];
      const da = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const side = i % 2 ? 1 : -1;
      leaf(p, da + side * (0.65 + jit(0.15)), s * (0.3 - t * 0.1), s * 0.075, side * 0.4, { washA: 0.4, w: 2.4 });
    }
    leaf(tip, ang + jit(0.2), s * 0.26, s * 0.08, jit(0.3), { washA: 0.42, w: 2.4 });
  }

  return { brush, wash, outline, leaf, dots, tendril, stem, tulip, peony, spray, rnd, jit, unit };
}

function finishTexture(canvas, { repeatU = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (repeatU) tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Horizontally tileable 4:1 band: borders in the top / bottom 8 %, a scrolling vine with tulips and peonies. */
export function createDelftBandTexture({ size = 2048, seed = 7 } = {}) {
  const W = size, H = Math.round(size / 4);
  const { canvas, ctx } = makeCanvas(W, H);
  const unit = W / 2048;
  const rnd = rng(seed);
  const P = painter(ctx, rnd, unit);

  // draw the same motif at x, x − W and x + W (same random stream) so the band wraps seamlessly
  const wrapped = (fn) => {
    const s = Math.floor(rnd() * 1e9);
    for (const off of [-W, 0, W]) {
      const Q = painter(ctx, rng(s), unit);
      ctx.save(); ctx.translate(off, 0); fn(Q); ctx.restore();
    }
  };

  // ── border lines (periodic width variation, so they tile) ──
  const borderLine = (y, w, alpha) => {
    const ph = rnd() * TAU, ph2 = rnd() * TAU;
    const N = 256;
    const yy = (t) => y + Math.sin(ph + t * TAU * 3) * 0.6 * unit;
    const ww = (t) => w * (1 + 0.16 * Math.sin(ph2 + t * TAU * 5) + 0.07 * Math.sin(t * TAU * 17));
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const t = i / N; ctx[i ? 'lineTo' : 'moveTo'](t * W, yy(t) - ww(t) / 2); }
    for (let i = N; i >= 0; i--) { const t = i / N; ctx.lineTo(t * W, yy(t) + ww(t) / 2); }
    ctx.closePath();
    ctx.fillStyle = rgba(TREK, alpha);
    ctx.fill();
  };
  for (const flip of [0, 1]) {
    const y = (v) => (flip ? H - v * H : v * H);
    ctx.save();
    ctx.filter = `blur(${(1.2 * unit).toFixed(2)}px)`;
    ctx.fillStyle = rgba(WASH, 0.28);
    ctx.fillRect(0, Math.min(y(0.008), y(0.047)), W, Math.abs(y(0.047) - y(0.008)));
    ctx.restore();
    borderLine(y(0.028), 8 * unit, 0.92);
    borderLine(y(0.07), 2.6 * unit, 0.88);
  }
  // little scallop row hanging from the inner border line
  const NS = 64;
  for (const flip of [0, 1]) {
    for (let i = 0; i < NS; i++) {
      const x0 = (i / NS) * W, x1 = ((i + 1) / NS) * W;
      const y0 = flip ? H - 0.07 * H : 0.07 * H, d = (flip ? -1 : 1) * 0.022 * H;
      P.brush(bez([x0, y0], [x0 + (x1 - x0) * 0.2, y0 + d], [x0 + (x1 - x0) * 0.8, y0 + d], [x1, y0], 10), 1.6 * unit, { alpha: 0.7, tin: 0.1, tout: 0.1 });
      P.dots([x0 + (x1 - x0) * 0.5, y0 + d * 1.6], 1.5, 1, 0);
    }
  }

  // ── the scrolling vine (period W/3 → wraps) ──
  const REP = 3, PER = W / REP, CY = H * 0.5, AMP = H * 0.15;
  const vineY = (x) => CY - AMP * Math.sin((x / PER) * TAU);
  {
    const pts = [];
    for (let i = -8; i <= 520; i++) { const x = (i / 512) * W; pts.push([x, vineY(x)]); }
    ctx.save(); ctx.filter = `blur(${(1.4 * unit).toFixed(2)}px)`;
    P.brush(pts.map(([x, yv]) => [x, yv + 3 * unit]), 7 * unit, { col: WASH, alpha: 0.3, tin: 1e-4, tout: 1e-4, wobble: 0, minW: 1 });
    ctx.restore();
    P.brush(pts, 4.2 * unit, { tin: 1e-4, tout: 1e-4, wobble: 0, minW: 1 });
  }

  for (let k = 0; k < REP; k++) {
    const x0 = k * PER;
    const xCrest = x0 + PER * 0.25;         // vine high (small y): peony hangs below it
    const xTrough = x0 + PER * 0.75;        // vine low: tulip rises above it
    wrapped((Q) => {
      const base = [xTrough + Q.jit(4 * unit), vineY(xTrough)];
      Q.tulip(base, -Math.PI / 2 + Q.jit(0.12), H * 0.42 / unit);
    });
    wrapped((Q) => {
      const c = [xCrest + Q.jit(4 * unit), vineY(xCrest) + H * 0.17];
      Q.stem([xCrest, vineY(xCrest)], [xCrest + 6 * unit, vineY(xCrest) + H * 0.05], [c[0] - 4 * unit, c[1] - H * 0.1], c, 3);
      Q.peony(c, H * 0.27 / unit, 7);
    });
    // leaf sprays from the vine, between the flowers
    for (const [f, dirUp] of [[0.05, 1], [0.45, -1], [0.55, 1], [0.95, -1]]) {
      const x = x0 + PER * f;
      wrapped((Q) => {
        const slope = Math.atan2(vineY(x + 1) - vineY(x), 1);
        Q.spray([x, vineY(x)], slope + dirUp * -0.95 + (f < 0.5 ? 0 : Math.PI), H * 0.27 / unit, 4);
      });
    }
    for (const [f, up] of [[0.14, 1], [0.36, 1], [0.64, -1], [0.86, -1]]) {
      const x = x0 + PER * f;
      wrapped((Q) => Q.tendril([x, vineY(x)], (up > 0 ? -1 : 1) * (Math.PI / 2) + Q.jit(0.5), H * 0.13 / unit, Q.rnd() > 0.5 ? 1 : -1, 1.4));
    }
    for (const f of [0.25, 0.75]) {
      const x = x0 + PER * f + PER * 0.12;
      wrapped((Q) => Q.dots([x, vineY(x) + (f < 0.5 ? -1 : 1) * H * 0.12], 3.2, 3, 7));
    }
  }

  return finishTexture(canvas, { repeatU: true });
}

/** Square medallion, bilaterally symmetric about u = 0.5, fading to white at the edges. */
export function createDelftMedallionTexture({ size = 1024, seed = 11 } = {}) {
  const W = size, H = size;
  const { canvas, ctx } = makeCanvas(W, H);
  const unit = W / 1024;
  const rnd = rng(seed);
  const P = painter(ctx, rnd, unit);
  const C = [W * 0.5, H * 0.5];
  const at = (u, v) => [u * W, v * H];

  // everything is painted on the left (and across the axis); the right half is then the mirror
  // wreath: two arching branches embracing the rosette
  P.stem(at(0.5, 0.86), at(0.3, 0.86), at(0.17, 0.62), at(0.24, 0.3), 3.2);
  for (const [t, side] of [[0.15, 1], [0.3, -1], [0.45, 1], [0.6, -1], [0.75, 1], [0.88, -1]]) {
    const pts = bez(at(0.5, 0.86), at(0.3, 0.86), at(0.17, 0.62), at(0.24, 0.3), 60);
    const i = Math.floor(t * 60), p = pts[i], q = pts[i + 1];
    const da = Math.atan2(q[1] - p[1], q[0] - p[0]);
    P.leaf(p, da + side * 0.7, 104 - t * 26, 21, side * 0.35);
  }
  // corner sprays and flowers toward the corners
  P.spray(at(0.3, 0.27), -2.45, 220, 4);
  P.spray(at(0.28, 0.76), 2.5, 210, 4);
  P.tulip(at(0.27, 0.27), -2.35, 210, { leaves: false });
  P.tulip(at(0.27, 0.73), 2.3, 180, { leaves: false });
  P.tendril(at(0.2, 0.47), Math.PI + 0.3, 140, 1, 1.5);
  P.tendril(at(0.38, 0.13), -2.2, 110, -1, 1.4);
  P.tendril(at(0.36, 0.88), 2.0, 110, 1, 1.4);
  P.dots(at(0.12, 0.36), 4, 3, 10);
  P.dots(at(0.13, 0.64), 4, 3, 10);
  P.dots(at(0.42, 0.95), 3.4, 3, 8);
  P.dots(at(0.44, 0.06), 3.4, 3, 8);
  // crown on the axis: a small upright tulip above the rosette
  P.tulip(at(0.5, 0.31), -Math.PI / 2, 150, { leaves: false });
  P.leaf(at(0.5, 0.3), -Math.PI / 2 - 0.9, 70, 13, -0.4);
  // the central rosette (straddles the axis; after mirroring it is perfectly symmetric)
  P.peony(C, 250, 8);

  // ── mirror the left half onto the right ──
  const tmp = document.createElement('canvas');
  tmp.width = W / 2; tmp.height = H;
  tmp.getContext('2d').drawImage(canvas, 0, 0, W / 2, H, 0, 0, W / 2, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(W / 2, 0, W / 2, H);
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();

  // ── fade to white at the edges ──
  const edge = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    return g;
  };
  const F = 0.1;
  ctx.fillStyle = edge(0, 0, W * F, 0); ctx.fillRect(0, 0, W * F, H);
  ctx.fillStyle = edge(W, 0, W * (1 - F), 0); ctx.fillRect(W * (1 - F), 0, W * F, H);
  ctx.fillStyle = edge(0, 0, 0, H * F); ctx.fillRect(0, 0, W, H * F);
  ctx.fillStyle = edge(0, H, 0, H * (1 - F)); ctx.fillRect(0, H * (1 - F), W, H * F);
  const rg = ctx.createRadialGradient(W / 2, H / 2, W * 0.5, W / 2, H / 2, W * 0.72);
  rg.addColorStop(0, 'rgba(255,255,255,0)');
  rg.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  return finishTexture(canvas);
}
