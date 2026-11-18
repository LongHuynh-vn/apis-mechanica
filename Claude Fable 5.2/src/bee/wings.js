// ─────────────────────────────────────────────────────────────────────────────
// bee/wings.js — WINGS
// Forewing + hindwing in etched glass, veined in gilt after Apis mellifera
// (costa, Sc+R, pterostigma, the long marginal cell, three submarginal cells,
// basal vein, the discoidal cells with both recurrent veins, cubital and anal
// veins; on the hindwing C+Sc+R, Rs, the M+Cu fork, cu-a, the anal vein and the
// vannal lobe), the hamuli row that hooks the pair into ONE aerofoil, and the
// axillary hinge.
//
// Kinematic chain per side:  hinge base (stroke-plane frame) → stroke (about Y)
// → deviation (about Z) → pitch (about the span, X) → blade.
// Blade frame: +X root→tip, +Z leading edge, +Y dorsal surface.
//
// The hinge is that chain as a watchmaker would build it — a universal joint in
// a cocked cradle:
//   pedestal  (fixed)   foot screwed to the box's rim band, a strap over the lip, a journal block in the belt slot
//   cradle    (base)    rocks in that journal about the lateral axis (the stroke-plane tilt); carries the
//                       step-bearing cup below and the jewelled cock above
//   kingpin   (stroke)  turns in cup and cock about +Y; cross-block with the two deviation pins, click wheel,
//                       and on top the crank the drive link pulls
//   fork      (dev)     swings on those pins about Z; its barrel is the feathering bearing
//   root spar (pitch)   ONE shaft through the barrel, ending in a screwed clamp that grips the wing's basal plate
//   drive link          telescoping, ball-ended: stud on the lid's rim band → crank
//   tegula              an enamel shield on a post, forward of the base
// Nothing in it sweeps into the thorax: everything that turns with the stroke stays within 7 mm of the kingpin.
//
// A real bee beats at 230 Hz, so at speed the wing is drawn as a motion-blur
// envelope of ghost samples; slow TEMPO down and the ghosts collapse into the
// true figure-eight stroke with its pitch flips.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { V3, tube, rod, merge, xf, aim, revolve, bushing, ballJoint, plate, linkShape, shell, gear, screwGeo, hexPrism } from './kit.js';
import { mesh } from './materials.js';
import { THORAX, thoraxPoint, thoraxNormal } from './surfaces.js';
import { LAYERS } from '../core/gfx.js';
import { SPEC } from '../core/state.js';
import { lerp, clamp, smoothstep, TAU, DEG, hash1 } from '../core/math.js';

// ── planform ─────────────────────────────────────────────────────────────────
// `a` > 1 keeps the base slender (petiolate), so a folded wing runs past the thorax instead of through it
const FORE = { L: SPEC.forewingMm / 10, hmax: 1.3, a: 1.08, b: 0.5, stub: 0.06, cz: 0.2, sweep: 0.3, camber: 0.07 };
const HIND = { L: SPEC.hindwingMm / 10, hmax: 0.84, a: 1.15, b: 0.5, stub: 0.045, cz: 0.12, sweep: 0.22, camber: 0.04, lobe: 0.07, notch: 0.026 };
const ROOT = 0.18;                        // blade root sits this far outboard of the gimbal pivot (pivot 1.42 + root + 7.7 = half of the 186 mm span)

function planform(W) {
  const um = W.a / (W.a + W.b), fmax = Math.pow(um, W.a) * Math.pow(1 - um, W.b);
  const half = (u) => (W.hmax * Math.pow(Math.max(u, 0), W.a) * Math.pow(Math.max(1 - u, 0), W.b)) / fmax + W.stub * Math.pow(1 - u, 3);
  const centre = (u) => W.cz - 0.42 * half(u) - W.sweep * u * u;
  // vannal lobe: a rounded flap at the base of the trailing edge, set off from the rest by a shallow notch
  const lobe = (u) => (W.lobe ? W.lobe * Math.exp(-(((u - 0.215) / 0.095) ** 2)) - W.notch * Math.exp(-(((u - 0.385) / 0.04) ** 2)) : 0);
  const zL = (u) => centre(u) + half(u), zT = (u) => centre(u) - half(u) - lobe(u);
  /** (u along span 0..1, t across chord 0 trailing … 1 leading) → blade-space point */
  const at = (u, t, out = V3(), lift = 0) => {
    const a = zT(u), b = zL(u);
    return out.set(u * W.L, W.camber * Math.sin(Math.PI * t) * (0.35 + 0.65 * u) * Math.sqrt(Math.max(0, 1 - u * u * 0.6)) + lift, lerp(a, b, t));
  };
  const _a = V3(), _b = V3(), _c = V3(), _d = V3();
  /** Unit normal of the membrane (toward +Y, the dorsal face). */
  const normal = (u, t, out = V3()) => {
    const e = 2e-3, u0 = Math.max(u - e, 0), u1 = Math.min(u + e, 0.9999);
    at(u1, t, _a); at(u0, t, _b); at(u, t + e, _c); at(u, t - e, _d);
    return out.crossVectors(_c.sub(_d), _a.sub(_b)).normalize();
  };
  return { W, zL, zT, at, normal };
}
const PF = planform(FORE), PH = planform(HIND);

function membrane(pf, nx = 48, nt = 12) {
  const pos = [], uv = [], idx = [], p = V3();
  for (let i = 0; i <= nx; i++) {
    const s = i / nx, u = Math.min(0.999999, 1 - (1 - s) * (1 - s));      // stations crowd toward the tip, which closes to a point
    for (let j = 0; j <= nt; j++) { const t = j / nt; pf.at(u, t, p); pos.push(p.x, p.y, p.z); uv.push(u, t); }
  }
  const row = nt + 1;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nt; j++) { const a = i * row + j, b = a + row; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ── venation ─────────────────────────────────────────────────────────────────
// Veins are drawn in the membrane's own (u, t) space: u along the span, t across the chord (0 trailing … 1 leading).
// Junctions are named points shared by every vein that meets there, so tubes end exactly on one another.
//   r     in-plane half-width at the start → at the end (cm)
//   fade  the vein thins away to nothing before the margin
//   web   [start, end]: flare into the vein it springs from / runs into (a filleted tee)
//   bead  junctions that get a soldered node
const FJ = {
  f: [0.385, 0.565],                      // M+Cu forks into the basal vein (M) and Cu
  j1: [0.487, 0.872], r0: [0.502, 0.946], // basal vein meets Rs · Rs leaves Sc+R
  j2: [0.575, 0.776], j3: [0.664, 0.716], j4: [0.762, 0.674],   // along M: floors of the three submarginal cells
  k1: [0.612, 0.893], k2: [0.651, 0.866], k3: [0.69, 0.853], k4: [0.834, 0.862],   // along Rs: floor of the marginal cell
  m1: [0.62, 0.746], m2: [0.724, 0.69],   // where the two recurrent veins meet M
  c0: [0.405, 0.538], c1b: [0.535, 0.452], c1: [0.586, 0.44], c2: [0.702, 0.398],  // along Cu
  a1: [0.405, 0.272], a2: [0.578, 0.122], // along the anal vein
  sg: [0.612, 0.95], ap: [0.886, 0.958],  // under the pterostigma · where R1 closes the marginal cell
};
const U0 = 0.012;                         // vein roots start inside the basal plate
const FORE_VEINS = [
  { n: 'costa',  r: [0.036, 0.025],  p: [[U0, 0.972], [0.2, 0.984], [0.4, 0.986], [0.59, 0.982]] },
  { n: 'Sc+R',   r: [0.033, 0.024],  p: [[U0, 0.79], [0.1, 0.868], [0.25, 0.912], [0.4, 0.934], FJ.r0, [0.59, 0.956]] },
  { n: 'R1',     r: [0.025, 0.013],  p: [[0.645, 0.972], [0.75, 0.976], [0.84, 0.972], FJ.ap] },
  { n: 'Rs',     r: [0.019, 0.013],  p: [FJ.sg, FJ.k1, FJ.k2, FJ.k3, [0.765, 0.848], FJ.k4, [0.878, 0.884], [0.897, 0.924], FJ.ap], web: [1, 0] },
  { n: 'M+Cu',   r: [0.032, 0.024],  p: [[U0, 0.44], [0.13, 0.468], [0.27, 0.52], FJ.f] },
  { n: 'basal',  r: [0.022, 0.019],  p: [FJ.f, [0.412, 0.676], [0.447, 0.786], FJ.j1], web: [0, 0] },
  { n: 'Rs·1',   r: [0.017, 0.017],  p: [FJ.j1, FJ.r0], web: [0, 1] },
  { n: 'Rs+M·M', r: [0.02, 0.006],   p: [FJ.j1, [0.53, 0.826], FJ.j2, FJ.m1, FJ.j3, FJ.m2, FJ.j4, [0.82, 0.657], [0.872, 0.648]], fade: 0.72 },
  { n: '1rs-m',  r: [0.014, 0.014],  p: [FJ.j2, [0.608, 0.826], FJ.k2], web: [1, 1] },
  { n: '2rs-m',  r: [0.013, 0.013],  p: [FJ.j3, [0.674, 0.786], FJ.k3], web: [1, 1] },
  { n: '3rs-m',  r: [0.013, 0.013],  p: [FJ.j4, [0.784, 0.762], [0.816, 0.812], FJ.k4], web: [1, 1] },
  { n: 'Cu',     r: [0.023, 0.006],  p: [FJ.f, FJ.c0, [0.465, 0.478], FJ.c1b, FJ.c1, [0.645, 0.424], FJ.c2, [0.752, 0.356], [0.79, 0.31]], fade: 0.74 },
  { n: '1m-cu',  r: [0.014, 0.014],  p: [FJ.m1, [0.606, 0.6], FJ.c1], web: [1, 1] },
  { n: '2m-cu',  r: [0.013, 0.013],  p: [FJ.m2, [0.728, 0.55], FJ.c2], web: [1, 1] },
  { n: 'cu-a',   r: [0.015, 0.015],  p: [FJ.c0, [0.409, 0.4], FJ.a1], web: [1, 1] },
  { n: 'A',      r: [0.026, 0.005],  p: [[U0, 0.13], [0.16, 0.21], [0.3, 0.262], FJ.a1, [0.5, 0.215], FJ.a2, [0.622, 0.036]], fade: 0.78 },
  { n: 'Cu2',    r: [0.013, 0.013],  p: [FJ.c1b, [0.566, 0.29], FJ.a2], web: [1, 1] },
];
const FORE_BEADS = [['f', 0.034], ['j1', 0.027], ['r0', 0.031], ['j2', 0.025], ['j3', 0.022], ['j4', 0.02], ['k1', 0.023], ['k2', 0.021], ['k3', 0.021], ['k4', 0.021],
  ['m1', 0.023], ['m2', 0.021], ['c0', 0.027], ['c1b', 0.024], ['c1', 0.024], ['c2', 0.021], ['a1', 0.027], ['a2', 0.02], ['ap', 0.02]];
const STIGMA = { u0: 0.583, u1: 0.662, t: 0.964, w: 0.058 };

const HJ = {
  f: [0.36, 0.5],                         // M+Cu fork
  r0: [0.43, 0.958],                      // Rs leaves C+Sc+R where the hamuli begin
  rm: [0.522, 0.9], m1: [0.505, 0.7],     // rs-m: on Rs · on M
  c0: [0.33, 0.492], a1: [0.31, 0.2],     // cu-a: on M+Cu · on the anal vein
};
const HIND_VEINS = [
  { n: 'C+Sc+R', r: [0.032, 0.021],  p: [[U0, 0.93], [0.2, 0.956], HJ.r0, [0.47, 0.968]] },
  { n: 'Rs',     r: [0.02, 0.005],   p: [HJ.r0, HJ.rm, [0.68, 0.856], [0.83, 0.79], [0.92, 0.72]], fade: 0.6, web: [1, 0] },
  { n: 'M+Cu',   r: [0.03, 0.022],   p: [[U0, 0.42], [0.18, 0.464], HJ.c0, HJ.f] },
  { n: 'M',      r: [0.019, 0.005],  p: [HJ.f, [0.43, 0.6], HJ.m1, [0.62, 0.672], [0.76, 0.6], [0.87, 0.52]], fade: 0.62 },
  { n: 'Cu',     r: [0.019, 0.005],  p: [HJ.f, [0.44, 0.42], [0.54, 0.3], [0.625, 0.16]], fade: 0.55 },
  { n: 'rs-m',   r: [0.012, 0.012],  p: [HJ.m1, [0.508, 0.8], HJ.rm], web: [1, 1] },
  { n: 'cu-a',   r: [0.013, 0.013],  p: [HJ.c0, [0.316, 0.35], HJ.a1], web: [1, 1] },
  { n: 'A',      r: [0.024, 0.005],  p: [[U0, 0.16], [0.16, 0.214], HJ.a1, [0.4, 0.12], [0.455, 0.03]], fade: 0.6 },
];
const HIND_BEADS = [['f', 0.029], ['r0', 0.026], ['rm', 0.02], ['m1', 0.02], ['c0', 0.024], ['a1', 0.022]];

/** A vein's centre line, sampled evenly: [{ u, t, s }] with s the distance along it in cm. */
function samplePath(pf, ctrl, step = 0.1) {
  const sx = pf.W.L, sy = pf.W.hmax * 1.9;                                // (u, t) → roughly true shape, so the spline bends evenly
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([u, t]) => V3(u * sx, t * sy, 0)), false, 'centripetal');
  const n = Math.max(3, Math.ceil(curve.getLength() / step));
  const pts = curve.getSpacedPoints(n), out = [], a = V3(), b = V3();
  let s = 0;
  pts.forEach((p, i) => {
    const u = clamp(p.x / sx, 0, 0.999999), t = clamp(p.y / sy, 0, 1);
    pf.at(u, t, a); if (i) s += a.distanceTo(b); b.copy(a);
    out.push({ u, t, s });
  });
  out.len = s;
  return out;
}
/** In-plane half-width of a vein along its sampled path. */
function veinRadius(v, path) {
  const [r0, r1] = v.r, web = v.web || [0, 0];
  return (i) => {
    const s = path[i].s, f = s / (path.len || 1);
    let r = lerp(r0, r1, f);
    if (v.fade) r *= 1 - 0.93 * smoothstep(v.fade, 1, f);
    if (web[0]) r *= 1 + 0.75 * Math.exp(-s / 0.055);
    if (web[1]) r *= 1 + 0.75 * Math.exp(-(path.len - s) / 0.055);
    return r;
  };
}
/**
 * Sweep a flattened (lenticular) section along a path lying in the membrane, centred on it so the vein
 * stands equally proud of both faces.
 */
function sweepOnWing(pf, path, rad, { radial = 6, flat = 0.62 } = {}) {
  const n = path.length, pos = [], nor = [], idx = [];
  const P = path.map((q) => pf.at(q.u, q.t, V3())), T = V3(), N = V3(), B = V3(), v = V3();
  for (let i = 0; i < n; i++) {
    T.subVectors(P[Math.min(i + 1, n - 1)], P[Math.max(i - 1, 0)]).normalize();
    pf.normal(path[i].u, path[i].t, N);
    B.crossVectors(N, T).normalize(); N.crossVectors(T, B);
    const a = rad(i), b = Math.max(a * flat, 0.0035);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * TAU, c = Math.cos(th), s = Math.sin(th);
      pos.push(P[i].x + B.x * a * c + N.x * b * s, P[i].y + B.y * a * c + N.y * b * s, P[i].z + B.z * a * c + N.z * b * s);
      v.copy(B).multiplyScalar(c * b).addScaledVector(N, s * a).normalize(); nor.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
    idx.push(a, b, d, a, d, c);
  }
  for (const end of [0, 1]) {                                              // closed ends
    const i = end ? n - 1 : 0, base = pos.length / 3;
    T.subVectors(P[Math.min(i + 1, n - 1)], P[Math.max(i - 1, 0)]).normalize();
    pos.push(P[i].x, P[i].y, P[i].z); nor.push(end ? T.x : -T.x, end ? T.y : -T.y, end ? T.z : -T.z);
    for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + ((j + 1) % radial); if (end) idx.push(base, a, b); else idx.push(base, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
/** A soldered node where veins meet: a low, round bead bedded in the membrane. */
function beadOnWing(pf, [u, t], r) {
  const p = pf.at(u, t, V3());
  return xf(new THREE.SphereGeometry(1, 10, 6), { s: [r, r * 0.66, r], p: [p.x, p.y, p.z] });
}
/** The fine wire that edges the glass: from u0 on the leading edge, round the tip, back along the trailing edge to u1. */
function marginPath(pf, u0, u1, n = 70) {
  const ctrl = [], sOf = (u) => 1 - Math.sqrt(1 - u), s0 = sOf(u0), s1 = sOf(u1);
  const nl = Math.round(n * 0.4), nt = n - nl, out = [], a = V3(), b = V3();
  for (let i = 0; i < nl; i++) { const s = lerp(s0, 1, i / nl); ctrl.push([1 - (1 - s) * (1 - s), 1]); }
  for (let i = 0; i <= nt; i++) { const s = lerp(1, s1, i / nt); ctrl.push([Math.min(0.999999, 1 - (1 - s) * (1 - s)), 0]); }
  let s = 0;
  ctrl.forEach(([u, t], i) => { pf.at(u, t, a); if (i) s += a.distanceTo(b); b.copy(a); out.push({ u, t, s }); });
  out.len = s;
  return out;
}

/** Everything gilt on one wing, plus the sampled paths the etch mask is drawn from. */
function buildVenation(pf, veins, joints, beads, { margin, extra = [] }) {
  const parts = [], paths = [];
  for (const v of veins) {
    const path = samplePath(pf, v.p), rad = veinRadius(v, path);
    parts.push(sweepOnWing(pf, path, rad));
    paths.push({ path, rad });
  }
  for (const [k, r] of beads) parts.push(beadOnWing(pf, joints[k], r));
  if (margin) {
    const path = marginPath(pf, margin[0], margin[1]);
    const rad = (i) => 0.0075 * (0.75 + 0.25 * smoothstep(0, 0.6, path[i].s)) * (1 - 0.5 * smoothstep(path.len - 1.2, path.len, path[i].s));
    parts.push(sweepOnWing(pf, path, rad, { radial: 5, flat: 1 }));
  }
  return { geo: merge([...parts, ...extra]), paths };
}

/**
 * Etch mask for a wing membrane, drawn in the membrane's own (u, t) space from the very paths the gilt
 * veins follow: white = clear pane; grey = frosted. Frost hugs every vein and both margins, each cell keeps
 * a clear heart, and a fine stipple stands in for the microtrichia of a real wing.
 */
function etchTexture(pf, paths, w = 1024, h = 512, seed = 3, stigma = null) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  const X = (u) => u * w, Y = (t) => (1 - t) * h;
  const rim = g.createLinearGradient(0, 0, 0, h);
  rim.addColorStop(0, 'rgba(105,105,105,0.6)'); rim.addColorStop(0.06, 'rgba(105,105,105,0)');
  rim.addColorStop(0.93, 'rgba(105,105,105,0)'); rim.addColorStop(1, 'rgba(105,105,105,0.55)');
  g.fillStyle = rim; g.fillRect(0, 0, w, h);
  const tip = g.createLinearGradient(w * 0.88, 0, w, 0);
  tip.addColorStop(0, 'rgba(105,105,105,0)'); tip.addColorStop(1, 'rgba(105,105,105,0.5)');
  g.fillStyle = tip; g.fillRect(0, 0, w, h);
  const base = g.createLinearGradient(0, 0, w * 0.07, 0);
  base.addColorStop(0, 'rgba(100,100,100,0.5)'); base.addColorStop(1, 'rgba(100,100,100,0)');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const px = h / (pf.W.hmax * 1.9);                                        // texels per cm across the chord (mid-wing)
  // three passes: a wide soft bloom of frost, a tighter band, then the engraved line itself
  for (const pass of [{ k: 5.2, add: 0.05, a: 0.06 }, { k: 2.6, add: 0.02, a: 0.11 }, { k: 1.15, add: 0.004, a: 0.24 }]) {
    g.strokeStyle = `rgba(100,100,100,${pass.a})`;
    for (const { path, rad } of paths) {
      for (let i = 1; i < path.length; i++) {                             // segment by segment: the line tapers with the vein
        g.lineWidth = Math.max(1, (rad(i) * pass.k + pass.add) * 2 * px);
        g.beginPath(); g.moveTo(X(path[i - 1].u), Y(path[i - 1].t)); g.lineTo(X(path[i].u), Y(path[i].t)); g.stroke();
      }
    }
  }
  if (stigma) {
    g.fillStyle = 'rgba(95,95,95,0.5)';
    g.beginPath(); g.ellipse(X((stigma.u0 + stigma.u1) / 2), Y(stigma.t), ((stigma.u1 - stigma.u0) / 2) * w * 1.25, stigma.w * px * 2.2, 0, 0, TAU); g.fill();
  }
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  g.fillStyle = 'rgba(90,90,90,0.13)';
  for (let i = 0; i < (w * h) / 46; i++) { const r = 0.5 + rnd() * 0.7; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, TAU); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  return tex;
}

// ── hindwing coupling fit: its hamuli row must lie on the forewing's trailing fold ──
const HAM = { u0: 0.47, u1: 0.72 };
const COUPLE = (() => {
  const a = PH.at(HAM.u0, 1), b = PH.at(HAM.u1, 1), len = Math.hypot(b.x - a.x, b.z - a.z);
  const uA = 0.47, fa = PF.at(uA, 0);                 // far enough outboard that the hindwing root never sweeps into the thorax flank
  let lo = uA, hi = 0.9;                              // find the forewing station the same distance away
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, fm = PF.at(m, 0); if (Math.hypot(fm.x - fa.x, fm.z - fa.z) < len) lo = m; else hi = m; }
  const fb = PF.at((lo + hi) / 2, 0);
  const angH = Math.atan2(b.z - a.z, b.x - a.x), angF = Math.atan2(fb.z - fa.z, fb.x - fa.x);
  const rotY = -(angF - angH);                        // rotation about +Y (x→z sense is negative)
  const c = Math.cos(angF - angH), s = Math.sin(angF - angH);
  const pos = V3(fa.x - (a.x * c - a.z * s), -0.03, fa.z - (a.x * s + a.z * c));
  return { rotY, pos, uF0: uA, uF1: (lo + hi) / 2 };
})();

// ── small machine-shop helpers (local to the hinge) ──────────────────────────
const alongX = (g) => g.rotateZ(-Math.PI / 2);        // turned parts are made along +Y
const alongZ = (g) => g.rotateX(Math.PI / 2);
function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2; r = Math.max(1e-3, Math.min(r, x - 1e-3, y - 1e-3));
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
/** A milled block between two corners: rounded in the XY outline, chamfered on its Z faces. */
function block(x0, x1, y0, y1, z0, z1, { round = 0.01, bevel = 0.006 } = {}) {
  const g = plate(roundRect(x1 - x0 - 2 * bevel, y1 - y0 - 2 * bevel, round), z1 - z0, { bevel, curveSegments: 4 });
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** A flat plate lying in the XZ plane (outline given as a Shape in x, z), y0 … y1 thick. */
function slab(shape, y0, y1, bevel = 0.005) {
  const g = plate(shape, y1 - y0, { bevel, curveSegments: 6 });
  g.rotateX(Math.PI / 2);                                                  // shape y → +z
  return g.translate(0, (y0 + y1) / 2, 0);
}

/** The hinge hardware, built once (left side; the right is the mirrored group). All in hinge-pivot coordinates. */
function buildHinge(mounts) {
  const H = mounts.foreHinge, { rz, e, beltLo, beltHi } = THORAX;
  const sp = (t) => Math.sign(t) * Math.pow(Math.abs(t), e);
  // the thorax surface where it crosses a given fore-aft station: lets the hardware sit ON the belt
  const phiAt = (zl, lam, k = 1) => { const c = clamp((H.z + zl) / (rz * k * sp(Math.cos(lam))), -1, 1); return Math.acos(Math.sign(c) * Math.pow(Math.abs(c), 1 / e)); };
  const onBelt = (zl, lam, k, out = V3()) => thoraxPoint(phiAt(zl, lam, k), lam, out, k).sub(H);
  const normalAt = (zl, lam) => thoraxNormal(phiAt(zl, lam), lam);
  const BAND = 1.012;                                                      // the gilt rim bands stand this proud of the porcelain
  const proud = (zl, lam, h, out = V3()) => onBelt(zl, lam, BAND, out).addScaledVector(normalAt(zl, lam), h);   // h above the band

  // ── pedestal (fixed): foot on the box's rim band, strap over the lip, journal block in the belt slot ──
  // (the two lips of the belt slot slope inward and down, so the block is kept low and short to clear the lid's)
  const FOOT = 0.046;
  const fixedSatin = [
    shell((u, v, o) => proud(lerp(-0.136, 0.086, u), lerp(beltLo - 0.072, beltLo - 0.012, v), FOOT, o), { nu: 10, nv: 4, thickness: FOOT, flipN: true }),
    block(-0.14, 0.03, -0.094, -0.064, -0.12, -0.068),
    block(0.0, 0.03, -0.126, -0.07, -0.12, -0.068),                        // the strap turns down onto the foot
    block(-0.19, -0.13, -0.094, 0.024, -0.12, 0.056, { round: 0.012 }),
  ];
  const fixedMetal = [
    xf(alongX(bushing(0.04, 0.011, { bore: 0.018, segments: 22 })), { p: [-0.1245, 0, 0] }),        // journal bearing ring
    xf(screwGeo(0.017), { p: [-0.05, -0.064, -0.094] }),                                              // strap screw
  ];
  for (const zl of [-0.094, 0.042]) {                                      // foot screws (the forward one takes the place of a rim rivet)
    const lam = beltLo - 0.04;
    fixedMetal.push(aim(screwGeo(0.026), normalAt(zl, lam), proud(zl, lam, FOOT - 0.001)));
  }

  // ── tegula: an enamel shield on a gilt post, forward of the base ──
  // (far enough forward that the fork and the clamp pass behind it at the top of the forward stroke; its post
  //  stands midway between two of the rim rivets)
  const tegBody = [], tz = 0.365;
  {
    const lamP = beltLo - 0.036, n = normalAt(tz, lamP), foot = onBelt(tz, lamP, BAND);
    const up = onBelt(tz, lamP + 0.03, BAND).sub(foot).normalize();
    const seat = foot.clone().addScaledVector(n, 0.046), centre = seat.clone().addScaledVector(up, 0.05);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), n);
    const place = (g, p) => g.applyQuaternion(q).translate(p.x, p.y, p.z);
    const dome = revolve([[0, -0.006], [0.086, -0.006], [0.097, 0.003], [0.093, 0.013], [0.08, 0.025], [0.058, 0.035], [0.03, 0.041], [0, 0.043]], { segments: 32, crease: 1.3 });
    dome.scale(0.94, 1, 1.18);
    tegBody.push(place(dome, centre));
    const rimRing = new THREE.TorusGeometry(0.097, 0.0075, 6, 40).rotateX(Math.PI / 2).scale(0.94, 1, 1.18).translate(0, 0.002, 0);
    fixedMetal.push(place(rimRing, centre));
    fixedMetal.push(aim(bushing(0.021, 0.05, { segments: 14 }), n, foot.clone().addScaledVector(n, 0.022)));
    fixedMetal.push(aim(bushing(0.034, 0.008, { segments: 16 }), n, foot.clone().addScaledVector(n, 0.004)));
    const boss = seat.clone().addScaledVector(n, 0.036);                  // the post's screw shows through the enamel
    fixedMetal.push(aim(screwGeo(0.019), n, boss));
  }

  // ── cradle (base): rocks about X in the pedestal's journal; step-bearing cup below, jewelled cock above ──
  const cradleMetal = [
    rod(V3(-0.185, 0, 0), V3(-0.1, 0, 0), 0.017, { radial: 12 }),                                    // trunnion
    block(-0.117, -0.087, -0.045, 0.1, -0.03, 0.03),                                                 // upright
    block(-0.1, -0.03, -0.07, -0.042, -0.027, 0.027),                                                // lower arm
    xf(bushing(0.045, 0.03, { segments: 22 }), { p: [0, -0.055, 0] }),                               // step-bearing cup
    block(-0.1, -0.025, 0.068, 0.098, -0.027, 0.027),                                                // the cock
    xf(bushing(0.04, 0.03, { bore: 0.02, segments: 22 }), { p: [0, 0.083, 0] }),
    xf(screwGeo(0.014), { p: [-0.07, 0.098, 0] }),
    // click spring: a wire from the upright round to the click wheel on the kingpin
    rod(V3(-0.087, 0.051, 0.012), V3(-0.08, 0.051, 0.03), 0.009, { radial: 6 }),
    tube([V3(-0.082, 0.051, 0.026), V3(-0.07, 0.051, 0.046), V3(-0.044, 0.051, 0.058), V3(-0.014, 0.051, 0.056), V3(0.01, 0.051, 0.046)], (t) => 0.0055 * (1 - 0.3 * t), { tubular: 18, radial: 5 }),
  ];
  const jewel = xf(revolve([[0.0205, 0], [0.033, 0], [0.033, 0.006], [0.028, 0.011], [0.0205, 0.009], [0.0205, 0]], { segments: 20, crease: 1.2 }), { p: [0, 0.098, 0] });

  // ── kingpin (stroke): cross-block with the deviation pins, click wheel, and the crank on top ──
  // The crank is set so that across the whole stroke (folded back … full forward) its ball stays on the stud's side.
  const lamS = beltHi + 0.036, zS = -0.223;                                // the stud sits between two of the lid's rim rivets
  const nS = normalAt(zS, lamS), studFoot = onBelt(zS, lamS, BAND);
  const STUD = studFoot.clone().addScaledVector(nS, 0.056);
  const CRANK = 0.06, BALL_Y = 0.158;
  const delta = Math.atan2(STUD.z, STUD.x) - ((64 - 85.5) / 2) * DEG;      // azimuth (x → z) of the crank, measured from the spar
  const BALL = V3(Math.cos(delta) * CRANK, BALL_Y, Math.sin(delta) * CRANK);
  const strokeSatin = [
    rod(V3(0, -0.066, 0), V3(0, 0.138, 0), 0.017, { radial: 12 }),                                   // kingpin
    block(-0.033, 0.033, -0.034, 0.034, -0.035, 0.035, { round: 0.012, bevel: 0.007 }),              // cross-block
    xf(alongZ(gear(12, 0.0064, 0.012, { bore: 0.016 })), { p: [0, 0.051, 0] }),                      // click wheel
  ];
  const strokeMetal = [
    rod(V3(0, 0, -0.064), V3(0, 0, 0.064), 0.014, { radial: 10 }),                                   // deviation pins
    xf(alongZ(bushing(0.021, 0.008, { segments: 14 })), { p: [0, 0, 0.062] }),
    xf(alongZ(bushing(0.021, 0.008, { segments: 14 })), { p: [0, 0, -0.062] }),
    xf(bushing(0.03, 0.02, { segments: 18 }), { p: [0, 0.122, 0] }),                                 // crank boss
    xf(slab(linkShape(CRANK, 0.026, 0.012, { hole: 0.36 }), 0.115, 0.129, 0.004), { r: [0, -delta, 0] }),   // crank arm
    xf(hexPrism(0.022, 0.014), { p: [0, 0.139, 0] }),
    rod(V3(BALL.x, 0.124, BALL.z), V3(BALL.x, BALL_Y, BALL.z), 0.009, { radial: 8 }),
    xf(ballJoint(0.024, { segments: 14 }), { p: [BALL.x, BALL.y, BALL.z] }),
  ];

  // ── fork (dev): swings on the cross-block's pins; its barrel is the feathering bearing ──
  const armShape = linkShape(0.086, 0.027, 0.014, { hole: 0.5 });
  const devMetal = [
    xf(plate(armShape, 0.016, { bevel: 0.004 }), { p: [0, 0, 0.047] }),
    xf(plate(armShape, 0.016, { bevel: 0.004 }), { p: [0, 0, -0.047] }),
    xf(alongX(revolve([[0.028, -0.028], [0.046, -0.028], [0.05, -0.024], [0.05, -0.012], [0.047, -0.009], [0.047, 0.009], [0.05, 0.012], [0.05, 0.024], [0.046, 0.028], [0.028, 0.028], [0.028, -0.028]], { segments: 26 })), { p: [0.09, 0, 0] }),
    xf(screwGeo(0.011), { p: [0.09, 0.0465, 0] }),                                                   // oil-cup screw
  ];

  // ── root spar (pitch): one shaft through the barrel, ending in the clamp that grips the wing's basal plate ──
  const JAW = { x0: 0.134, x1: 0.245, z0: -0.03, z1: 0.268, lo: -0.007, hi: 0.031, t: 0.023 };       // slot lo … hi takes the plate
  const jaw = () => { const s = roundRect(JAW.x1 - JAW.x0 - 0.01, JAW.z1 - JAW.z0 - 0.01, 0.03); return s; };
  const jawAt = (y0, y1) => slab(jaw(), y0, y1).translate((JAW.x0 + JAW.x1) / 2, 0, (JAW.z0 + JAW.z1) / 2);
  const pitchSatin = [
    rod(V3(0.044, 0, 0), V3(0.138, 0, 0), 0.026, { radial: 14 }),                                    // the spar
    xf(alongX(bushing(0.041, 0.014, { segments: 20 })), { p: [0.127, 0, 0] }),                       // thrust collar
    block(JAW.x0, 0.162, JAW.lo - 0.002, JAW.hi + 0.002, JAW.z0 + 0.006, JAW.z1 - 0.006, { round: 0.006 }),   // clamp spine
    jawAt(JAW.hi, JAW.hi + JAW.t), jawAt(JAW.lo - JAW.t, JAW.lo),
  ];
  const pitchMetal = [xf(alongX(hexPrism(0.035, 0.013)), { p: [0.0525, 0, 0] })];                    // retaining nut inboard of the barrel
  for (const z of [0.036, 0.202]) {
    pitchMetal.push(xf(screwGeo(0.024), { p: [0.203, JAW.hi + JAW.t, z] }));
    pitchMetal.push(xf(hexPrism(0.024, 0.016), { p: [0.203, JAW.lo - JAW.t - 0.008, z] }));
  }

  // ── drive link: stud on the lid's rim band → crank ball; a sleeve and a rod that telescope ──
  const stud = merge([
    aim(bushing(0.031, 0.012, { segments: 16 }), nS, studFoot.clone().addScaledVector(nS, 0.005)),
    aim(revolve([[0, 0], [0.019, 0], [0.019, 0.008], [0.012, 0.016], [0.011, 0.04], [0, 0.04]], { segments: 12 }), nS, studFoot.clone().addScaledVector(nS, 0.008)),
    xf(ballJoint(0.026, { segments: 14 }), { p: [STUD.x, STUD.y, STUD.z] }),
  ]);
  // reach of the link across every pose it must serve
  let dMin = 9, dMax = 0; const b = V3(), eu = new THREE.Euler();
  for (let s = -86; s <= 66; s += 4) for (const tilt of [0, 0.33]) for (const lift of [-0.03, 0.03]) {
    b.copy(BALL).applyEuler(eu.set(0, -s * DEG, 0)).applyEuler(eu.set(tilt, 0, 0));
    const d = Math.hypot(b.x - STUD.x, b.y - STUD.y - lift, b.z - STUD.z);
    dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
  }
  const sleeveLen = dMin - 0.034, rodLen = Math.max(dMin - 0.024, dMax - sleeveLen + 0.02);
  const linkSleeve = merge([
    revolve([[0, 0], [0.011, 0], [0.011, 0.03], [0.016, 0.036], [0.016, sleeveLen - 0.012], [0.019, sleeveLen - 0.012], [0.019, sleeveLen - 0.003], [0.016, sleeveLen], [0, sleeveLen]], { segments: 14 }),
  ]);
  const linkRod = merge([
    revolve([[0, 0], [0.011, 0], [0.011, 0.026], [0.0075, 0.032], [0.0075, rodLen], [0, rodLen]], { segments: 10 }),
  ]);

  return {
    fixedSatin: merge(fixedSatin), fixedMetal: merge(fixedMetal), tegBody: merge(tegBody),
    cradleMetal: merge(cradleMetal), jewel, strokeSatin: merge(strokeSatin), strokeMetal: merge(strokeMetal),
    devMetal: merge(devMetal), pitchSatin: merge(pitchSatin), pitchMetal: merge(pitchMetal),
    stud, linkSleeve, linkRod, STUD, BALL, JAW,
  };
}

/**
 * The wing's own basal plate: a gilt tongue the clamp grips, webbed out along each vein root like the base of a
 * leaf — so the roots grow out of one piece instead of converging as loose rods.
 *   x0      where the tongue ends inside the clamp (blade x)     grip  its z-extent there
 *   fingers [{ u, t0, t1 }] leading → trailing: how far the web runs out along each root, and across which chord band
 *   bays    [{ u, t }] the bottom of the scallop between neighbouring fingers
 */
function basalPlate(pf, { x0, grip, fingers, bays, y0, y1 }) {
  const m = 0.008;                                                          // the plate edges the glass by this much
  const P = (u, t) => { const a = pf.zT(u) - m, b = pf.zL(u) + m; return [u * pf.W.L, lerp(a, b, t)]; };
  const s = new THREE.Shape();
  s.moveTo(x0, grip[0]); s.lineTo(x0, grip[1]);
  const f0 = fingers[0];
  for (let i = 0; i <= 6; i++) s.lineTo(...P((f0.u * i) / 6, 1));           // along the leading edge
  fingers.forEach((f, i) => {
    const lo = P(f.u, f.t0), nose = P(f.u + 0.02, (f.t0 + f.t1) / 2);
    s.quadraticCurveTo(nose[0], nose[1], lo[0], lo[1]);                     // round the finger's tip
    const next = fingers[i + 1];
    if (next) {
      const hi = P(next.u, next.t1), b = bays[i], c = P(2 * b.u - (f.u + next.u) / 2, b.t);
      s.quadraticCurveTo(c[0], c[1], hi[0], hi[1]);                         // the scallop to the next root
    }
  });
  s.lineTo(x0, grip[0]);                                                    // straight back to the tongue (outside the glass all the way)
  return slab(s, y0, y1, 0.004);
}

// ── stroke kinematics ────────────────────────────────────────────────────────
/**
 * Wing angles at a given beat phase.
 * @param {number} phase   radians (0 = mid forward stroke)
 * @param {object} k       amp (half stroke amplitude, rad), mean (rad), dev (figure-eight depth, rad), pitchAmp (rad), lead (rotation phase lead, rad)
 * @param {object} out     { stroke, dev, pitch } — stroke +forward, dev +up, pitch about the span (-π/2 = leading edge straight up)
 */
export function wingAngles(phase, k, out) {
  const s = Math.sin(phase);
  out.stroke = k.mean + (k.amp * Math.asin(0.86 * s)) / 1.0353;            // gently triangular: lingers less at reversal
  out.dev = k.dev * Math.sin(2 * phase + 0.3);                              // 2:1 → the wingtip draws a figure-eight
  out.pitch = -Math.PI / 2 + (k.pitchAmp * Math.tanh(2.7 * Math.cos(phase + k.lead))) / 0.9910; // flips just ahead of each reversal
  return out;
}

const GHOSTS = 14;

export function buildWings({ mats, ex }, mounts, lid) {
  // ── venation, built once and shared by both sides ──────────────────────────
  const stigma = (() => {
    const path = samplePath(PF, [[STIGMA.u0, STIGMA.t + 0.014], [(STIGMA.u0 + STIGMA.u1) / 2, STIGMA.t], [STIGMA.u1, STIGMA.t + 0.008]], 0.05);
    return sweepOnWing(PF, path, (i) => 0.012 + STIGMA.w * Math.pow(Math.sin(Math.PI * clamp(path[i].s / path.len, 0.02, 0.98)), 0.7), { radial: 8, flat: 0.42 });
  })();
  const foldRail = (() => { const pts = []; for (let i = 0; i <= 10; i++) pts.push(PF.at(lerp(COUPLE.uF0 - 0.03, COUPLE.uF1 + 0.03, i / 10), 0.004, V3(), -0.004)); return tube(pts, (t) => 0.017 * (0.45 + 0.55 * Math.sin(Math.PI * clamp(t, 0.04, 0.96)) ** 0.5), { tubular: 30, radial: 6 }); })();
  const hinge = buildHinge(mounts), JAW = hinge.JAW;
  const PLATE = { y0: JAW.lo + 0.003, y1: JAW.hi - 0.003 };
  const forePlate = basalPlate(PF, {
    x0: -0.016, grip: [0.02, 0.252], ...PLATE,
    fingers: [{ u: 0.084, t0: 0.74, t1: 1 }, { u: 0.07, t0: 0.33, t1: 0.59 }, { u: 0.06, t0: 0, t1: 0.29 }],
    bays: [{ u: 0.044, t: 0.67 }, { u: 0.042, t: 0.31 }],
  });
  const fore = buildVenation(PF, FORE_VEINS, FJ, FORE_BEADS, { margin: [0.6, 0.05], extra: [stigma, foldRail, forePlate] });
  // hindwing root: a smaller web of the same kind, and no fitting — the hindwing has no hinge of its own; it rests
  // on the belt when folded and rides the forewing's trailing fold in flight
  const hindPlate = basalPlate(PH, {
    x0: -0.02, grip: [0.05, 0.152], y0: -0.008, y1: 0.02,
    fingers: [{ u: 0.084, t0: 0.78, t1: 1 }, { u: 0.068, t0: 0.3, t1: 0.58 }, { u: 0.058, t0: 0, t1: 0.3 }],
    bays: [{ u: 0.044, t: 0.68 }, { u: 0.042, t: 0.3 }],
  });
  const hindV = buildVenation(PH, HIND_VEINS, HJ, HIND_BEADS, { margin: [HAM.u1 + 0.03, 0.03], extra: [hindPlate] });

  const glassF = mats.get('glass', 'forewings', { map: etchTexture(PF, fore.paths, 1024, 512, 3, STIGMA), key: 'etch' });
  const glassH = mats.get('glass', 'hindwings', { map: etchTexture(PH, hindV.paths, 768, 384, 9), key: 'etch' });
  const metalF = mats.get('metal', 'forewings'), metalH = mats.get('metal', 'hindwings');
  const metalHinge = mats.get('metal', 'hinges'), satinHinge = mats.get('satin', 'hinges');
  const bodyHinge = mats.get('body', 'hinges'), jewelHinge = mats.get('eye', 'hinges');

  const foreMem = membrane(PF), hindMem = membrane(PH, 36, 9);
  const foreVeins = fore.geo, hindVeins = hindV.geo;
  // hamuli: a rail + 21 hooks along the hindwing's leading edge
  const hamRail = (() => { const pts = []; for (let i = 0; i <= 10; i++) pts.push(PH.at(lerp(HAM.u0 - 0.025, HAM.u1 + 0.025, i / 10), 0.996, V3(), 0.004)); return tube(pts, 0.018, { tubular: 30, radial: 6 }); })();
  const hookGeo = tube([V3(0, 0, 0), V3(0, 0.05, 0.035), V3(0, 0.072, 0.085), V3(0, 0.05, 0.125), V3(0, 0.015, 0.13)], (u) => 0.013 * (1 - u * 0.55), { tubular: 10, radial: 5 });

  // ghost geometry: the coupled pair as one sheet, plus a bright leading-edge strip (aVein = 1)
  const ghostGeo = (() => {
    const f = membrane(PF, 44, 10).toNonIndexed(), h = membrane(PH, 34, 8).toNonIndexed();
    h.rotateY(COUPLE.rotY); h.translate(COUPLE.pos.x, COUPLE.pos.y, COUPLE.pos.z);
    const strip = [];
    for (let i = 0; i < 24; i++) {
      const u0 = (i / 24) * 0.93, u1 = ((i + 1) / 24) * 0.93;
      const p0 = PF.at(u0, 1, V3()), p1 = PF.at(u1, 1, V3()), q0 = PF.at(u0, 0.9, V3()), q1 = PF.at(u1, 0.9, V3());
      strip.push(p0, q0, p1, p1, q0, q1);
    }
    const sg = new THREE.BufferGeometry().setFromPoints(strip); sg.computeVertexNormals();
    const tag = (g, v) => { g.setAttribute('aVein', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); g.deleteAttribute('uv'); return g; };
    const parts = [tag(f, 0), tag(h, 0), tag(sg, 1)];
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), vein = new Float32Array(n);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); vein.set(g.attributes.aVein.array, o); o += g.attributes.position.count; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('aVein', new THREE.BufferAttribute(vein, 1));
    out.translate(ROOT, 0, 0);
    return out;
  })();
  const ghostUniforms = { uColor: { value: new THREE.Color('#9c9384') }, uVein: { value: new THREE.Color('#d9b25f') }, uOpacity: { value: 0.07 }, uLight: { value: V3(0.4, 0.8, 0.45).normalize() } };
  const makeGhostMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: ghostUniforms,
    vertexShader: /* glsl */ `
      attribute float aVein; attribute float aAlpha; varying float vVein; varying float vAlpha; varying vec3 vN; varying vec3 vV;
      void main() {
        vVein = aVein; vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        vN = normalize( normalMatrix * mat3( instanceMatrix ) * normal ); vV = normalize( -mv.xyz );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uVein, uLight; uniform float uOpacity; varying float vVein; varying float vAlpha; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 n = normalize( vN ); float ndv = abs( dot( n, vV ) );
        float fres = pow( 1.0 - ndv, 2.0 );
        vec3 irid = 0.5 + 0.5 * cos( 6.2831 * ( fres * 1.4 + vec3( 0.0, 0.33, 0.67 ) ) );   // thin-film sheen at grazing angles
        float spec = pow( abs( dot( n, normalize( uLight + vV ) ) ), 60.0 );
        vec3 col = mix( mix( uColor, irid, fres * 0.35 ), uVein, vVein ) + vec3( spec ) * 0.6;
        float a = uOpacity * vAlpha * ( 0.55 + 0.9 * fres + vVein * 1.4 + spec * 2.0 );
        gl_FragColor = vec4( col, a );
      }`,
  });

  const sides = [];
  for (let s = 0; s < 2; s++) {
    const sideGroup = new THREE.Group(); sideGroup.scale.x = s ? -1 : 1; sideGroup.name = s ? 'wingR' : 'wingL';
    // hinge assembly (explode node) at the forewing hinge
    const hingeNode = ex.node('hinges', { dir: [1, 0.1, 0], dist: 1.7, at: 0.42 });
    hingeNode.position.copy(mounts.foreHinge); sideGroup.add(hingeNode);
    hingeNode.add(
      mesh(hinge.fixedSatin, satinHinge, 'hinges'), mesh(hinge.fixedMetal, metalHinge, 'hinges'),
      mesh(hinge.tegBody, bodyHinge, 'hinges'),
    );
    const stud = mesh(hinge.stud, metalHinge, 'hinges', { cast: false });   // rides the lid's rim band
    hingeNode.add(stud);
    const base = new THREE.Group(); hingeNode.add(base);                     // stroke-plane frame (tilts about X): the cradle
    base.add(mesh(hinge.cradleMetal, metalHinge, 'hinges'), mesh(hinge.jewel, jewelHinge, 'hinges', { cast: false }));
    const stroke = new THREE.Group(); base.add(stroke);                      // the kingpin
    stroke.add(mesh(hinge.strokeSatin, satinHinge, 'hinges'), mesh(hinge.strokeMetal, metalHinge, 'hinges'));
    const dev = new THREE.Group(); stroke.add(dev);                          // the fork
    dev.add(mesh(hinge.devMetal, metalHinge, 'hinges'));
    const pitch = new THREE.Group(); dev.add(pitch);                         // the root spar
    pitch.add(mesh(hinge.pitchSatin, satinHinge, 'hinges'), mesh(hinge.pitchMetal, metalHinge, 'hinges'));
    // drive link from the lid's rim to the kingpin's crank (re-aimed every frame; sleeve and rod slide in one another)
    const link = mesh(hinge.linkSleeve, satinHinge, 'hinges', { cast: false });
    const linkRod = mesh(hinge.linkRod, metalHinge, 'hinges', { cast: false });
    hingeNode.add(link, linkRod);

    // forewing
    const foreNode = ex.node('forewings', { dir: [0.8, 0.78, 0.1], dist: 5.4, at: 0 });
    pitch.add(foreNode);
    const blade = new THREE.Group(); blade.position.x = ROOT; foreNode.add(blade);
    const fm = mesh(foreMem, glassF, 'forewings', { cast: false, receive: false, layer: LAYERS.GLASS }); fm.renderOrder = 3;
    const fv = mesh(foreVeins, metalF, 'forewings', { receive: false });
    blade.add(fm, fv);
    // hindwing (rides on the forewing while coupled)
    const hindNode = ex.node('hindwings', { dir: [0.1, -0.2, -1], dist: 2.6, at: 0.03 });
    blade.add(hindNode);
    const hind = new THREE.Group(); hindNode.add(hind);
    const hm = mesh(hindMem, glassH, 'hindwings', { cast: false, receive: false, layer: LAYERS.GLASS }); hm.renderOrder = 3;
    const hv = mesh(hindVeins, metalH, 'hindwings', { receive: false });
    hind.add(hm, hv);
    const hamNode = ex.node('hamuli', { dir: [-0.05, 0.12, 1], dist: 1.3, at: 0.05 });
    hind.add(hamNode);
    const hooks = new THREE.InstancedMesh(hookGeo, mats.get('metal', 'hamuli'), SPEC.hamuli);
    const m4 = new THREE.Matrix4(), p = V3();
    for (let i = 0; i < SPEC.hamuli; i++) { PH.at(lerp(HAM.u0, HAM.u1, i / (SPEC.hamuli - 1)), 0.996, p, 0.004); hooks.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)); }
    hooks.instanceMatrix.needsUpdate = true; hooks.computeBoundingSphere(); hooks.userData.partId = 'hamuli'; hooks.castShadow = false;
    hamNode.add(hooks, mesh(hamRail, mats.get('metal', 'hamuli'), 'hamuli', { cast: false }));

    // motion-blur ghosts
    const ghosts = new THREE.InstancedMesh(ghostGeo, makeGhostMat(), GHOSTS);
    const gAlpha = new THREE.InstancedBufferAttribute(new Float32Array(GHOSTS), 1); gAlpha.setUsage(THREE.DynamicDrawUsage);
    ghosts.geometry = ghostGeo.clone(); ghosts.geometry.setAttribute('aAlpha', gAlpha);
    ghosts.frustumCulled = false; ghosts.layers.set(LAYERS.GHOST); ghosts.renderOrder = 4; ghosts.visible = false; ghosts.castShadow = false;
    base.add(ghosts);

    sides.push({ group: sideGroup, hingeNode, base, stroke, dev, pitch, foreNode, blade, hindNode, hind, hamNode, link, linkRod, stud, ghosts, gAlpha, casters: [fv, hv],
      ang: { stroke: 0, dev: 0, pitch: 0 }, k: { amp: 45 * DEG, mean: 0.06, dev: 9 * DEG, pitchAmp: 45 * DEG, lead: 0.42 } });
  }

  // ── wingtip trace: a fading figure-eight ribbon in the hinge-base frame ────
  const TRAIL_N = 120;
  const tipLocal = PF.at(0.992, 0.5, V3()).add(V3(ROOT, 0, 0));
  const trailUniforms = { uColor: { value: new THREE.Color('#b3852c') }, uWidth: { value: 1.6 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uOpacity: { value: 0 } };
  const makeTrail = () => {
    const g = new THREE.BufferGeometry();
    const n = TRAIL_N * 2;
    const pos = new Float32Array(n * 3), prev = new Float32Array(n * 3), next = new Float32Array(n * 3), side = new Float32Array(n), alpha = new Float32Array(n);
    const idx = [];
    for (let i = 0; i < TRAIL_N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; if (i < TRAIL_N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPrev', new THREE.BufferAttribute(prev, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aNext', new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: trailUniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute float aAlpha;
        uniform vec2 uRes; uniform float uWidth; varying float vAlpha; varying float vSide;
        void main() {
          mat4 mvp = projectionMatrix * modelViewMatrix;
          vec4 c = mvp * vec4( position, 1.0 ), a = mvp * vec4( aPrev, 1.0 ), b = mvp * vec4( aNext, 1.0 );
          vec2 dir = normalize( ( b.xy / b.w - a.xy / a.w ) * uRes + 1e-6 );
          vec2 nrm = vec2( -dir.y, dir.x );
          c.xy += nrm * aSide * uWidth * ( 0.35 + 0.65 * aAlpha ) / uRes * c.w;
          vAlpha = aAlpha; vSide = aSide; gl_Position = c;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; varying float vAlpha; varying float vSide;
        void main() { float edge = 1.0 - smoothstep( 0.55, 1.0, abs( vSide ) ); gl_FragColor = vec4( uColor, uOpacity * vAlpha * edge ); }`,
    });
    const mesh3 = new THREE.Mesh(g, mat); mesh3.frustumCulled = false; mesh3.layers.set(LAYERS.GHOST); mesh3.renderOrder = 6; mesh3.visible = false;
    return mesh3;
  };
  for (const sd of sides) { sd.trail = makeTrail(); sd.base.add(sd.trail); }

  // ── per-frame update ───────────────────────────────────────────────────────
  const FOLD = { stroke: -84.5 * DEG, dev: 5.2 * DEG, pitch: 18 * DEG };       // swept back and tented over the abdomen (inner edge raised, clear of the lid's rim band and its rivets)
  const SPREAD = { stroke: 3 * DEG, dev: 7 * DEG, pitch: -16 * DEG };      // unfolded, not yet beating
  const SHOW = { stroke: 0, dev: 0, pitch: 0 };                             // exploded view: flat, square to the body
  const tmp = { stroke: 0, dev: 0, pitch: 0 }, e = new THREE.Euler(), mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mC = new THREE.Matrix4();
  const a = V3(), b = V3(), c = V3(), up = V3(0, 1, 0);
  let frameSeed = 0;

  /**
   * @param {object} w
   *   phase        wing-beat phase now (rad)        dPhase   phase advanced during this frame (rad)
   *   fold         1 folded … 0 spread              gain     0 still … 1 full stroke
   *   show         0 … 1 exploded-view display pose planeTilt stroke-plane tilt about the lateral axis (rad)
   *   shiver       0 … 1 warm-up buzz               ampL/ampR half-amplitudes (rad), meanL/meanR mean stroke (rad)
   *   lidLift      scutum lift (cm) for the drive links
   *   trail        0 … 1 visibility of the wingtip trace
   */
  function update(w) {
    frameSeed = (frameSeed + 1) % 9973;
    const blur = smoothstep(0.3, 2.4, w.dPhase) * w.gain * (1 - w.fold) * (1 - w.show);
    const solid = 1 - smoothstep(0.25, 0.92, blur);
    for (let s = 0; s < 2; s++) {
      const sd = sides[s];
      sd.k.amp = s ? w.ampR : w.ampL; sd.k.mean = s ? w.meanR : w.meanL;
      wingAngles(w.phase, sd.k, tmp);
      const flapW = (1 - w.fold) * (1 - w.show), foldW = w.fold * (1 - w.show), showW = w.show;
      const g = w.gain;
      const fs = lerp(SPREAD.stroke, tmp.stroke, g), fd = lerp(SPREAD.dev, tmp.dev, g), fp = lerp(SPREAD.pitch, tmp.pitch, g);
      const sh = w.shiver * Math.sin(w.phase * 1.0 + s * 1.3), sh2 = w.shiver * Math.sin(w.phase * 1.07 + 2.0 + s);
      const foldDev = FOLD.dev + (s ? 0 : 1.1 * DEG);                       // left wing rests a hair above the right (no z-fight where they overlap)
      sd.ang.stroke = flapW * fs + foldW * (FOLD.stroke + sh * 0.02) + showW * SHOW.stroke;
      sd.ang.dev = flapW * fd + foldW * (foldDev + sh2 * 0.006) + showW * SHOW.dev;
      sd.ang.pitch = flapW * fp + foldW * (FOLD.pitch + sh2 * 0.032) + showW * SHOW.pitch;
      sd.base.rotation.x = w.planeTilt * flapW;
      sd.stroke.rotation.y = -sd.ang.stroke; sd.dev.rotation.z = sd.ang.dev; sd.pitch.rotation.x = sd.ang.pitch;

      // hindwing: hooked to the forewing in flight, slipped underneath when folded
      // (its root then returns to its own hinge on the thorax side, so it never swings into the body)
      const tuck = smoothstep(0.1, 0.92, w.fold) * (1 - w.show);
      c.subVectors(mounts.hindHinge, mounts.foreHinge)
        .applyEuler(e.set(-sd.base.rotation.x, 0, 0)).applyEuler(e.set(0, sd.ang.stroke, 0))
        .applyEuler(e.set(0, 0, -sd.ang.dev)).applyEuler(e.set(-sd.ang.pitch, 0, 0));
      c.x -= ROOT; c.y -= 0.075; c.z += 0.13;
      sd.hind.position.copy(COUPLE.pos).lerp(c, tuck);
      sd.hind.rotation.y = lerp(COUPLE.rotY, 0.07, tuck);

      // drive link: stud on the lid's rim → crank ball on the kingpin; the sleeve hangs on the stud, the rod on the crank
      a.copy(hinge.STUD); a.y += w.lidLift;
      b.copy(hinge.BALL).applyEuler(e.set(0, -sd.ang.stroke, 0)).applyEuler(e.set(sd.base.rotation.x, 0, 0));
      c.subVectors(b, a).normalize();
      sd.stud.position.y = w.lidLift;
      sd.link.position.copy(a); sd.link.quaternion.setFromUnitVectors(up, c);
      sd.linkRod.position.copy(b); sd.linkRod.quaternion.setFromUnitVectors(up, c.negate());

      // primary (detailed) wing dissolves as the blur envelope takes over
      sd.blade.visible = solid > 0.004;
      sd.solid = solid;
      for (const cst of sd.casters) cst.castShadow = blur < 0.25;

      // ghosts: samples of the stroke across this frame's interval, with falling opacity
      const show = blur > 0.004;
      sd.ghosts.visible = show;
      if (show) {
        const span = Math.min(w.dPhase, TAU);
        const full = smoothstep(TAU * 0.6, TAU, w.dPhase);                  // interval ≥ one whole beat → an even shimmer
        const jitter = hash1(frameSeed * 1.37 + s * 5.1);
        for (let i = 0; i < GHOSTS; i++) {
          const f = (i + lerp(0.5, jitter, full)) / GHOSTS;
          wingAngles(w.phase - span * f, sd.k, tmp);
          mA.makeRotationY(-tmp.stroke); mB.makeRotationZ(tmp.dev); mC.makeRotationX(tmp.pitch);
          sd.ghosts.setMatrixAt(i, mA.multiply(mB).multiply(mC));
          sd.gAlpha.array[i] = blur * lerp(Math.pow(1 - f, 1.3) * 1.9, 1, full);
        }
        sd.ghosts.instanceMatrix.needsUpdate = true; sd.gAlpha.needsUpdate = true;
      }

      // wingtip trace over the last beat
      const tv = w.trail * (1 - w.fold) * (1 - w.show) * smoothstep(0.3, 0.9, w.gain);
      sd.trail.visible = tv > 0.004;
      if (sd.trail.visible) {
        const pos = sd.trail.geometry.attributes.position, pv = sd.trail.geometry.attributes.aPrev, nx = sd.trail.geometry.attributes.aNext, al = sd.trail.geometry.attributes.aAlpha;
        const full = smoothstep(1.2, TAU, w.dPhase);
        const pts = sd._pts || (sd._pts = new Float32Array((TRAIL_N + 2) * 3));
        for (let i = -1; i <= TRAIL_N; i++) {
          wingAngles(w.phase - (i / (TRAIL_N - 1)) * TAU * 0.985, sd.k, tmp);
          a.copy(tipLocal).applyEuler(e.set(tmp.pitch, 0, 0)).applyEuler(e.set(0, 0, tmp.dev)).applyEuler(e.set(0, -tmp.stroke, 0));
          pts.set([a.x, a.y, a.z], (i + 1) * 3);
        }
        for (let i = 0; i < TRAIL_N; i++) {
          const fade = lerp(Math.pow(1 - i / (TRAIL_N - 1), 1.4), 0.55, full);
          for (let j = 0; j < 2; j++) {
            const k = (i * 2 + j) * 3, src = (i + 1) * 3;
            pos.array[k] = pts[src]; pos.array[k + 1] = pts[src + 1]; pos.array[k + 2] = pts[src + 2];
            pv.array[k] = pts[src - 3]; pv.array[k + 1] = pts[src - 2]; pv.array[k + 2] = pts[src - 1];
            nx.array[k] = pts[src + 3]; nx.array[k + 1] = pts[src + 4]; nx.array[k + 2] = pts[src + 5];
            al.array[i * 2 + j] = fade;
          }
        }
        pos.needsUpdate = pv.needsUpdate = nx.needsUpdate = al.needsUpdate = true;
        trailUniforms.uOpacity.value = tv;
      }
    }
    return { blur, solid };
  }

  return {
    sides, update, ghostUniforms, trailUniforms, tipLocal,
    anchors: { forewings: V3(ROOT + FORE.L * 0.66, 0, -0.2), hindwings: PH.at(0.6, 0.35, V3()), hamuli: PH.at(0.6, 1, V3()), hinges: V3(0, 0.1, 0) },
    FORE, HIND, ROOT,
  };
}
