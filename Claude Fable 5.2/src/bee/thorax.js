// ─────────────────────────────────────────────────────────────────────────────
// bee/thorax.js — THE ENGINE
// A sprung thoracic box: porcelain chassis (pleura + sternum) and a dorsal lid
// (scutum + scutellum) joined by gilt leaf springs. Inside, a four-wheel going
// train steps a slow barrel up to a crank that taps the lid at wing-beat
// frequency — the indirect flight mechanism of a real bee, in clockwork.
// Frame: origin at the thorax centre, +Z forward, +Y up, +X the bee's left.
//
// The chassis is dressed the way both the maker and the animal would divide
// it: pronotal, pleural and propodeal sutures inlaid in gilt, two louvred
// spiracle grilles a side, a sternal keel, screwed bosses round the six coxal
// sockets, a screwed access plate, and a turret porthole (spot-faced boss,
// screwed flange, fluted ring, bevelled crystal) looking onto the movement.
// The movement is a real one: an enamel pillar plate, skeleton bridges with
// chatons and screws, pillars and posts, spoked wheels with chamfered rims and
// set-screwed hubs, the mainspring barrel with its ratchet and click.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { V3, shell, revolve, bushing, tube, rod, gear, plate, linkShape, merge, xf, aim, rivetGeo, screwGeo, Scatter } from './kit.js';
import { mesh } from './materials.js';
import { buildThoraxFur } from './fur.js';
import { THORAX, thoraxPoint, thoraxNormal, thoraxHeightAt } from './surfaces.js';
import { SPEC } from '../core/state.js';
import { rng, lerp, TAU, smoothstep } from '../core/math.js';

// The thorax surface itself (a superellipsoid) lives in surfaces.js; re-exported for older imports.
export { THORAX, thoraxPoint, thoraxNormal };

// Going train: barrel wheel (42) → pinion (14) | wheel (30) → crank pinion (12). Axes along X.
const M = 0.035; // gear module (pitch radius = M·N/2)
const [N1, N2, N3, N4] = SPEC.gearTeeth; // 12, 30, 14, 42
export const GEARS = (() => {
  const r = (n) => (M * n) / 2;
  const c4 = { y: -0.42, z: -0.5 };
  const a43 = 0.9;                                   // direction barrel → second arbor (radians above +Z)
  const d43 = r(N4) + r(N3);
  const c3 = { y: c4.y + Math.sin(a43) * d43, z: c4.z + Math.cos(a43) * d43 };
  const a21 = -0.42;
  const d21 = r(N2) + r(N1);
  const c1 = { y: c3.y + Math.sin(a21) * d21, z: c3.z + Math.cos(a21) * d21 };
  return { r, c1, c2: c3, c3, c4, a43, a21, xA: 0.13, xB: -0.13, t: 0.13 };
})();

// ── surface toolkit ──────────────────────────────────────────────────────────
// The thorax is the superellipsoid |x/rx|^(2/e) + |y/ry|^(2/e) + |z/rz|^(2/e) = 1,
// so features can be laid out in a flat side / top / front view and projected
// straight onto it, with an analytic normal.
const { rx: RX, ry: RY, rz: RZ, e: EXP } = THORAX;
const E2 = 2 / EXP;
const pw = (t) => Math.pow(Math.abs(t), E2);
const rootE = (t) => Math.pow(Math.max(t, 1e-7), EXP / 2);
const _n = V3(), _p = V3(), _q = V3();

/** Project (a, b) onto the surface along an axis: 'x' → (y=a, z=b), 'y' → (x=a, z=b), 'z' → (x=a, y=b). */
function proj(axis, sgn, a, b, out = V3()) {
  if (axis === 'x') return out.set(sgn * RX * rootE(1 - pw(a / RY) - pw(b / RZ)), a, b);
  if (axis === 'y') return out.set(a, sgn * RY * rootE(1 - pw(a / RX) - pw(b / RZ)), b);
  return out.set(a, b, sgn * RZ * rootE(1 - pw(a / RX) - pw(b / RY)));
}
/** Outward unit normal at (or near) a surface point — the gradient of the implicit form. */
function sNormal(p, out = V3()) {
  const g = (c, r) => (Math.sign(c) * Math.pow(Math.abs(c / r) + 1e-9, E2 - 1)) / r;
  return out.set(g(p.x, RX), g(p.y, RY), g(p.z, RZ)).normalize();
}
/** Radial projection of any point onto the surface (from the thorax centre). */
function radial(q, out = V3()) {
  const f = pw(q.x / RX) + pw(q.y / RY) + pw(q.z / RZ);
  return out.copy(q).multiplyScalar(Math.pow(f, -EXP / 2));
}
const onSide = (y, z, lift = 0, out = V3()) => { proj('x', 1, y, z, out); return out.addScaledVector(sNormal(out, _n), lift); };
const onTop = (x, z, lift = 0, out = V3()) => { proj('y', 1, x, z, out); return out.addScaledVector(sNormal(out, _n), lift); };
const onBottom = (x, z, lift = 0, out = V3()) => { proj('y', -1, x, z, out); return out.addScaledVector(sNormal(out, _n), lift); };

/** shell() whose outer skin is guaranteed to face `ref(p)` (default: the thorax normal). */
function skin(P, opts, ref = sNormal) {
  const a = V3(), b = V3(), c = V3(), d = V3();
  P(0.47, 0.5, a); P(0.53, 0.5, b); P(0.5, 0.47, c); P(0.5, 0.53, d);
  const n = V3().crossVectors(b.sub(a), d.sub(c));
  P(0.5, 0.5, a);
  return shell(P, { ...opts, flipN: n.dot(ref(a, V3())) < 0 });
}

/**
 * A flat inlay ribbon following `curve(u, out)` (points on the surface): its top
 * stands `lift` proud, its body sinks `depth` into the porcelain — so it reads
 * as a gilt line let into the glaze, not a wire laid on top. Ends taper.
 */
function ribbon(curve, w, { lift = 0.006, depth = 0.034, n = 40, closed = false, taper = 0.07 } = {}) {
  const A = V3(), C = V3(), D = V3(), T = V3(), N = V3(), B = V3();
  const at = (u, o) => curve(closed ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u)), o);
  return shell((u, v, o) => {
    at(u, A); at(u + 1e-3, C); at(u - 1e-3, D);
    T.subVectors(C, D).normalize(); sNormal(A, N); B.crossVectors(N, T).normalize();
    const k = closed ? 1 : Math.min(1, Math.min(u, 1 - u) / taper);
    o.copy(A).addScaledVector(B, (v - 0.5) * w * (0.3 + 0.7 * Math.sqrt(k))).addScaledVector(N, lift);
  }, { nu: n, nv: 1, thickness: depth, closedU: closed });
}
/** Curve through side-view (y, z) points, projected onto the +X flank. */
const sideCurve = (pts) => {
  const c = new THREE.CatmullRomCurve3(pts.map(([y, z]) => V3(0, y, z)));
  return (u, o) => { c.getPointAt(u, _q); return onSide(_q.y, _q.z, 0, o); };
};
/** Curve through top-view (x, z) points, projected onto the lid. */
const topCurve = (pts) => {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V3(x, 0, z)));
  return (u, o) => { c.getPointAt(u, _q); return onTop(_q.x, _q.z, 0, o); };
};

/** Mirror a (non-indexed) geometry to the bee's right side, keeping it outward-facing. */
function mirrorX(src) {
  let g = src.index ? src.toNonIndexed() : src.clone();
  const p = g.attributes.position.array, nn = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; nn[i] = -nn[i]; }
  for (const k of Object.keys(g.attributes)) {
    const at = g.attributes[k], s = at.itemSize, arr = at.array;
    for (let i = 0; i < at.count; i += 3) for (let j = 0; j < s; j++) { const t = arr[(i + 1) * s + j]; arr[(i + 1) * s + j] = arr[(i + 2) * s + j]; arr[(i + 2) * s + j] = t; }
  }
  return g;
}
const both = (list) => [...list, ...list.map(mirrorX)];

/** Flat polygon (pts in a plane) facing `normal`, as a non-indexed geometry. */
function capFace(pts3, normal) {
  const ax = Math.abs(normal.x) > 0.5 ? ['z', 'y'] : Math.abs(normal.y) > 0.5 ? ['x', 'z'] : ['x', 'y'];
  const tri = THREE.ShapeUtils.triangulateShape(pts3.map((p) => new THREE.Vector2(p[ax[0]], p[ax[1]])), []);
  const pos = [], nor = [], e1 = V3(), e2 = V3();
  for (const [i, j, k] of tri) {
    e1.subVectors(pts3[j], pts3[i]); e2.subVectors(pts3[k], pts3[i]);
    const order = e1.cross(e2).dot(normal) >= 0 ? [i, j, k] : [i, k, j];
    for (const m of order) { pos.push(pts3[m].x, pts3[m].y, pts3[m].z); nor.push(normal.x, normal.y, normal.z); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/** Slotted, lightly domed countersunk screw head on y = 0, pointing +Y (slot along Z). */
function slottedHead(r = 0.03, seg = 4) {
  const prof = [[0, -0.3 * r], [r * 1.1, -0.3 * r], [r * 1.1, 0.03 * r], [r * 0.82, 0.24 * r], [0, 0.34 * r]];
  const s = r * 0.13, floor = 0.12 * r, parts = [];
  for (const sg of [1, -1]) {
    const half = revolve(prof, { segments: seg, phiStart: sg > 0 ? 0 : Math.PI, phiLength: Math.PI, crease: 0.7 });
    const face = [...prof.map(([pr, py]) => V3(0, py, pr)), ...prof.slice().reverse().map(([pr, py]) => V3(0, py, -pr))].filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 1e-6);
    if (face[face.length - 1].distanceTo(face[0]) < 1e-6) face.pop();
    parts.push(xf(merge([half, capFace(face, V3(-sg, 0, 0))]), { p: [sg * s, 0, 0] }));
  }
  parts.push(xf(new THREE.BoxGeometry(2 * s, floor + 0.3 * r, 2 * r * 0.98), { p: [0, (floor - 0.3 * r) / 2, 0] }));
  return merge(parts);
}

/** Basis matrix: shape X → t, Y → n × t, Z → n (for plates lying on the surface). */
function onFrame(g, pos, n, t) {
  const z = n.clone().normalize(), x = t.clone().addScaledVector(z, -t.dot(z)).normalize(), y = V3().crossVectors(z, x);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos));
  return g;
}
const roundRect = (w, h, r) => {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
};
const circleHole = (x, y, r) => { const h = new THREE.Path(); h.absarc(x, y, r, 0, TAU, true); return h; };

// gear-plane coordinates (lx = −z, ly = y) ↔ thorax frame
const G = (lx, ly, x = 0) => V3(x, ly, -lx);
const V2 = (x, y) => new THREE.Vector2(x, y);

/**
 * Skeleton bridge outline: a constant-width arm along a smooth path through
 * `pts`, swelling into round bosses (`boss` radii, one per point, 0 = none),
 * rounded ends, arbor holes. Gear-plane coordinates.
 */
function bridgeShape(pts, w, boss, holes = [], paths = []) {
  const c = new THREE.SplineCurve(pts.map(([x, y]) => V2(x, y)));
  const n = 52, L = [], R = [], P = [], H = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = c.getPointAt(t), tg = c.getTangentAt(t);
    let hw = w / 2;
    pts.forEach(([bx, by], k) => { const d = Math.hypot(p.x - bx, p.y - by); if (boss[k] > d) hw = Math.max(hw, Math.sqrt(boss[k] * boss[k] - d * d)); });
    const nx = -tg.y, ny = tg.x;
    L.push(V2(p.x + nx * hw, p.y + ny * hw)); R.push(V2(p.x - nx * hw, p.y - ny * hw)); P.push(p); H.push(hw);
  }
  const s = new THREE.Shape();
  s.moveTo(L[0].x, L[0].y);
  for (let i = 1; i <= n; i++) s.lineTo(L[i].x, L[i].y);
  const aL = Math.atan2(L[n].y - P[n].y, L[n].x - P[n].x);
  s.absarc(P[n].x, P[n].y, H[n], aL, aL - Math.PI, true);
  for (let i = n; i >= 0; i--) s.lineTo(R[i].x, R[i].y);
  const aR = Math.atan2(R[0].y - P[0].y, R[0].x - P[0].x);
  s.absarc(P[0].x, P[0].y, H[0], aR, aR - Math.PI, true);
  s.closePath();
  for (const [x, y, r] of holes) s.holes.push(circleHole(x, y, r));
  s.holes.push(...paths);
  return s;
}
/** Kidney-shaped window (annular sector) around (cx, cy). */
function kidney(cx, cy, r0, r1, a0, a1) {
  const w = new THREE.Path();
  w.absarc(cx, cy, r1, a0, a1, false);
  w.absarc(cx, cy, r0, a1, a0, true);
  w.closePath();
  return w;
}

/** Spoked web disc with parallel-sided spokes (gear plane, centred). */
function webShape(rOut, rHub, spokes, hw, bore) {
  const s = new THREE.Shape(); s.absarc(0, 0, rOut, 0, TAU, false);
  s.holes.push(circleHole(0, 0, bore));
  const r1 = rOut - 0.012, r0 = rHub, step = TAU / spokes;
  for (let k = 0; k < spokes; k++) {
    const c0 = k * step + step * 0.25, c1 = c0 + step;
    const w = new THREE.Path();
    w.absarc(0, 0, r1, c0 + Math.asin(hw / r1), c1 - Math.asin(hw / r1), false);
    w.absarc(0, 0, r0, c1 - Math.asin(hw / r0), c0 + Math.asin(hw / r0), true);
    w.closePath(); s.holes.push(w);
  }
  return s;
}

/** Sawtooth ratchet wheel outline. */
function ratchetShape(N, rOut, rIn, bore) {
  const s = new THREE.Shape(), step = TAU / N;
  for (let k = 0; k < N; k++) {
    const a = k * step;
    const pts = [[rIn, a], [rOut, a + step * 0.06], [rOut * 0.985, a + step * 0.22], [rIn, a + step]];
    pts.forEach(([r, b], i) => { const x = Math.cos(b) * r, y = Math.sin(b) * r; if (k === 0 && i === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  const sq = new THREE.Path(); const q = bore;
  sq.moveTo(-q, -q); sq.lineTo(-q, q); sq.lineTo(q, q); sq.lineTo(q, -q); sq.closePath(); s.holes.push(sq);   // winding square
  return s;
}

export function buildThorax({ mats, ex }) {
  const group = new THREE.Group(); group.name = 'thorax';
  const rnd = rng(11);
  const { beltLo, beltHi } = THORAX;
  const bodyBox = mats.get('body', 'thoraxbox', { cap: true });
  const metalBox = mats.get('metal', 'thoraxbox', { cap: true });
  const satinBox = mats.get('satin', 'thoraxbox', { cap: true });
  const bodyLid = mats.get('body', 'scutum', { cap: true, map: mats.delftMedallion, key: 'lid' });
  const metalLid = mats.get('metal', 'scutum', { cap: true });
  const head = slottedHead(1);                                     // unit screw head, scaled per placement

  // wing-hinge seats (other module): nothing new within ~0.5 cm of these, either side
  const HINGES = [V3(1.42, 0.996, 0.52), V3(1.4, 0.966, -0.46)];
  const nearHinge = (p, d = 0.52) => HINGES.some((h) => Math.hypot(Math.abs(p.x) - h.x, p.y - h.y, p.z - h.z) < d);

  // ── thoracic box (pleura + sternum) ────────────────────────────────────────
  const box = ex.node('thoraxbox', { dist: 0, at: 0.55 });   // the seat: last to leave, first to arrive
  group.add(box);
  const port = { y: -0.19, z: 0.1, r: 0.56 };
  const P = V3();
  const inPort = (u, v) => {
    thoraxPoint(u * TAU, lerp(-Math.PI / 2 + 0.02, beltLo, v), P);
    return Math.abs(P.x) > 1.0 && Math.hypot(P.y - port.y, P.z - port.z) < port.r;
  };
  const bowl = shell((u, v, o) => thoraxPoint(u * TAU, lerp(-Math.PI / 2 + 0.02, beltLo, v), o), {
    nu: 132, nv: 56, thickness: 0.085, closedU: true, skip: inPort,
  });
  box.add(mesh(bowl, bodyBox, 'thoraxbox'));

  const L = { metal: [], satin: [], body: [] };   // left-side features, mirrored afterwards
  const C = { metal: [], satin: [], body: [] };   // centred / one-off features
  const screwsL = [], screwsC = [];               // [pos, normal, radius]

  // gilt rim band along the top of the box; rivets (none under the leaf-spring shoes)
  const LEAVES = [0.45, 0.85, -0.45, -0.85, Math.PI - 0.5, Math.PI - 0.88, -Math.PI + 0.5, -Math.PI + 0.88];
  const band = (lam0, lam1, k, t = 0.03) => shell((u, v, o) => thoraxPoint(u * TAU, lerp(lam0, lam1, v), o, k), { nu: 132, nv: 2, thickness: t, closedU: true });
  C.metal.push(band(beltLo - 0.075, beltLo + 0.004, 1.012));
  const boxRivets = new Scatter();
  const angGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let i = 0; i < 44; i++) {
    const phi = (i / 44) * TAU;
    if (LEAVES.some((l) => angGap(phi, l) < 0.085)) continue;
    boxRivets.add(thoraxPoint(phi, beltLo - 0.036, V3(), 1.012), thoraxNormal(phi, beltLo - 0.036), 1);
  }

  // ── porthole turret (left; mirrored) ──
  // spot-faced boss rising from the flank → screwed base flange → fluted ring → lip → bevelled crystal
  const XF = 1.612, aHinge = Math.atan2(HINGES[0].y - port.y, HINGES[0].z - port.z);
  L.satin.push(skin((u, v, o) => {
    const a = u * TAU, rOut = 0.82 - 0.07 * smoothstep(0.5, 1, Math.cos(a - aHinge));   // the skirt draws in under the wing hinge
    const r = lerp(0.5, rOut, v), y = port.y + r * Math.sin(a), z = port.z + r * Math.cos(a);
    const xs = proj('x', 1, y, z, _p).x + 0.006;
    o.set(lerp(XF, xs, smoothstep(0.69, rOut, r)), y, z);
  }, { nu: 80, nv: 7, thickness: 0.12, closedU: true }));
  const atPort = (g) => aim(g, V3(1, 0, 0), V3(XF, port.y, port.z));
  // short sleeve: hides the cut edge of the shell without boxing the light out of the movement
  L.metal.push(atPort(revolve([[0.465, -0.16], [0.5, -0.16], [0.5, -0.004], [0.688, -0.004], [0.7, 0.008], [0.7, 0.026], [0.686, 0.036], [0.465, 0.036], [0.465, -0.16]], { segments: 60 })));
  const FL = 36;
  L.metal.push(skin((u, v, o) => {
    const a = u * TAU, f = (u * FL) % 1, g = Math.max(0, 1 - ((f - 0.5) / 0.38) ** 2);
    const ch = Math.min(smoothstep(0, 0.24, v), smoothstep(1, 0.76, v));
    const r = 0.598 - 0.012 * g - 0.009 * (1 - ch);
    o.set(XF + lerp(0.036, 0.084, v), port.y + r * Math.sin(a), port.z + r * Math.cos(a));
  }, { nu: FL * 4, nv: 3, thickness: 0.08, closedU: true }, (p, o) => o.set(0, p.y - port.y, p.z - port.z).normalize()));
  L.metal.push(atPort(revolve([[0.468, 0.078], [0.6, 0.078], [0.604, 0.088], [0.592, 0.1], [0.51, 0.108], [0.482, 0.1], [0.468, 0.088], [0.468, 0.078]], { segments: 60 })));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.39; screwsL.push([V3(XF + 0.036, port.y + Math.sin(a) * 0.645, port.z + Math.cos(a) * 0.645), V3(1, 0, 0), 0.024]); }
  // crystal: a shallow domed glass with a polished edge chamfer — the dome gathers the studio's reflections
  // while staying thin and clear in the middle, so the movement reads through it
  const dome = []; { const R = (0.47 ** 2 + 0.1 ** 2) / 0.2, h0 = Math.sqrt(R * R - 0.47 ** 2); for (const r of [0.47, 0.42, 0.36, 0.29, 0.21, 0.12, 0]) dome.push([r, 0.09 + Math.sqrt(R * R - r * r) - h0]); }
  const crystalL = atPort(revolve([[0, 0.06], [0.49, 0.06], [0.49, 0.08], ...dome], { segments: 64, crease: 0.3 }));
  // The crystal also carries a soft studio-window crescent on the upper-front of its dome (lathe UVs: u around,
  // v along the profile), the way a product photograph always shows its glass — visible from any angle,
  // never veiling the movement in the middle.
  const crystalMat = mats.get('vessel', 'thoraxbox', {
    key: 'crystal',
    extend: (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
        #ifdef USE_UV
        if ( uPass == 0 ) {
          float du = abs( fract( vUv.x - 0.875 + 0.5 ) - 0.5 );
          float band = ( 1.0 - smoothstep( 0.03, 0.1, du ) ) * smoothstep( 0.4, 0.46, vUv.y ) * ( 1.0 - smoothstep( 0.52, 0.6, vUv.y ) );
          float glint = band * 0.92 * uFade * ( 1.0 - uSchematic );
          // and the thick glass at the bevel reads as a smoky ring, so the crystal shows over a pale ground too
          float edge = smoothstep( 0.3, 0.345, vUv.y ) * ( 1.0 - smoothstep( 0.39, 0.45, vUv.y ) ) * uFade * ( 1.0 - uSchematic );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, gl_FragColor.rgb * 0.3, edge * 0.8 );
          gl_FragColor.a = max( gl_FragColor.a, edge * 0.45 );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), glint );
          gl_FragColor.a = max( gl_FragColor.a, glint * 0.85 );
        }
        #endif
        #include <tonemapping_fragment>`);
    },
  });
  crystalMat.defines.USE_UV = '';
  crystalMat.clearcoat = 0.5; crystalMat.clearcoatRoughness = 0.03;    // a second, crisper sheen on the dome
  const crystal = mesh(merge([crystalL, mirrorX(crystalL)]), crystalMat, 'thoraxbox', { cast: false, receive: false });
  crystal.renderOrder = 2; box.add(crystal);

  // ── pleural sutures, inlaid (side-view y, z) ──
  const suture = (pts, w = 0.028) => L.metal.push(ribbon(sideCurve(pts), w, { n: 44 }));
  suture([[0.7, 1.12], [0.3, 1.1], [-0.2, 1.06], [-0.65, 0.97], [-1.0, 0.8]]);              // pronotal: collar | mesopleuron
  suture([[0.55, -0.9], [0.15, -0.88], [-0.35, -0.85], [-0.8, -0.76], [-1.1, -0.58]]);     // meso | metapleuron
  suture([[0.62, -1.36], [0.2, -1.36], [-0.3, -1.34], [-0.75, -1.22]]);                     // metapleuron | propodeum

  // ── spiracle grilles: framed oval, satin floor, four louvre bars ──
  const spiracle = (yc, zc, ry, rz, tilt) => {
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const at = (ly, lz) => [yc + ly * ct - lz * st, zc + ly * st + lz * ct];
    L.metal.push(skin((u, v, o) => {
      const a = u * TAU, [y, z] = at((ry + 0.05 * v) * Math.sin(a), (rz + 0.05 * v) * Math.cos(a));
      onSide(y, z, 0.03 - 0.02 * smoothstep(0.4, 1, v), o);
    }, { nu: 44, nv: 3, thickness: 0.055, closedU: true }));
    L.satin.push(skin((u, v, o) => {
      const a = u * TAU, s = 1 - v * 0.999, [y, z] = at(ry * 1.02 * s * Math.sin(a), rz * 1.02 * s * Math.cos(a));
      onSide(y, z, 0.006, o);
    }, { nu: 32, nv: 2, thickness: 0.04, closedU: true }));
    for (const t of [-0.6, -0.2, 0.2, 0.6]) {
      const lz = rz * Math.sqrt(1 - t * t) * 1.02;
      const [y0, z0] = at(t * ry, -lz), [y1, z1] = at(t * ry, lz);
      L.metal.push(rod(onSide(y0, z0, 0.017), onSide(y1, z1, 0.017), 0.011, { radial: 6 }));
    }
  };
  spiracle(0.22, 1.37, 0.15, 0.08, -0.25);      // mesothoracic spiracle, under the pronotal lobe
  spiracle(0.2, -1.6, 0.17, 0.065, 0.2);        // propodeal spiracle

  // ── access plate on the metapleuron: bevelled porcelain panel, four countersunk screws ──
  const se = (t, p) => Math.sign(t) * Math.pow(Math.abs(t), p);
  const panel = { y: -0.42, z: -1.12, ry: 0.25, rz: 0.105 };
  L.body.push(skin((u, v, o) => {
    const a = u * TAU, s = 1 - v * 0.999;
    onSide(panel.y + panel.ry * s * se(Math.sin(a), 0.4), panel.z + panel.rz * s * se(Math.cos(a), 0.4), 0.026 * (0.35 + 0.65 * smoothstep(0, 0.22, v)), o);
  }, { nu: 56, nv: 5, thickness: 0.06, closedU: true }));
  L.metal.push(ribbon((u, o) => { const a = u * TAU; return onSide(panel.y + panel.ry * 0.8 * se(Math.sin(a), 0.4), panel.z + panel.rz * 0.66 * se(Math.cos(a), 0.4), 0.026, o); }, 0.012, { lift: 0.003, depth: 0.012, n: 56, closed: true }));
  for (const [dy, dz] of [[0.18, 0.06], [-0.18, 0.06], [0.18, -0.06], [-0.18, -0.06]]) {
    const p = onSide(panel.y + dy, panel.z + dz, 0.026); screwsL.push([p, sNormal(p, V3()), 0.019]);
  }

  // ── maker's cartouche below the porthole (left flank only): oval plaque, hexagon mark, engraved lines ──
  const cart = { y: -1.16, z: 0.1, ry: 0.07, rz: 0.2 };
  C.metal.push(skin((u, v, o) => {
    const a = u * TAU, s = 1 - v * 0.999;
    onSide(cart.y + cart.ry * s * Math.sin(a), cart.z + cart.rz * s * Math.cos(a), 0.018 * (0.4 + 0.6 * smoothstep(0, 0.3, v)), o);
  }, { nu: 48, nv: 4, thickness: 0.05, closedU: true }));
  C.metal.push(ribbon((u, o) => { const a = u * TAU; return onSide(cart.y + cart.ry * 0.78 * Math.sin(a), cart.z + cart.rz * 0.9 * Math.cos(a), 0.018, o); }, 0.007, { lift: 0.004, depth: 0.01, n: 48, closed: true }));
  C.metal.push(ribbon((u, o) => {                                     // the maker's hexagon
    const k = Math.floor(u * 6), f = u * 6 - k, a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU, r = 0.038;
    return onSide(cart.y + r * lerp(Math.sin(a0), Math.sin(a1), f), cart.z + 0.1 + r * lerp(Math.cos(a0), Math.cos(a1), f), 0.018, o);
  }, 0.008, { lift: 0.004, depth: 0.01, n: 36, closed: true }));
  for (const [dy, z0, z1] of [[0.022, -0.12, 0.04], [0, -0.13, 0.05], [-0.022, -0.1, 0.02]]) {
    C.metal.push(ribbon((u, o) => onSide(cart.y + dy, cart.z + lerp(z0, z1, u), 0.018, o), 0.006, { lift: 0.0035, depth: 0.01, n: 6, taper: 0.2 }));
  }

  // ── sternal keel: raised porcelain ridge with a gilt crest, screwed sternal boss ──
  const keelTaper = (u) => smoothstep(0, 0.1, u) * smoothstep(1, 0.88, u);
  C.body.push(skin((u, v, o) => onBottom(lerp(-0.09, 0.09, v), lerp(1.2, -1.25, u), 0.05 * Math.pow(Math.max(0, 1 - (2 * v - 1) ** 2), 0.7) * keelTaper(u), o), { nu: 44, nv: 6, thickness: 0.08 }));
  { const pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push(onBottom(0, lerp(1.2, -1.25, u), 0.05 * keelTaper(u) + 0.004)); } C.metal.push(tube(pts, 0.013, { tubular: 48, radial: 6 })); }
  C.metal.push(xf(revolve([[0, -0.09], [0.2, -0.09], [0.25, -0.065], [0.27, -0.03], [0.27, 0.02], [0.24, 0.04], [0.1, 0.05], [0, 0.05]], { segments: 36 }), { r: [Math.PI, 0, 0], p: [0, -1.66, 0] }));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4; screwsC.push([V3(Math.cos(a) * 0.165, -1.706, Math.sin(a) * 0.165), V3(0, -1, 0), 0.026]); }

  // ── coxal sockets: turned rings on screwed satin bosses (positions reused by the legs) ──
  const coxae = [
    { name: 'fore', pos: V3(0.62, -1.36, 1.02) },
    { name: 'mid', pos: V3(0.74, -1.47, 0.04) },
    { name: 'hind', pos: V3(0.66, -1.36, -0.98) },
  ];
  for (const c of coxae) {
    const n0 = sNormal(c.pos, V3()), t1 = V3().crossVectors(n0, V3(0, 0, 1)).normalize(), t2 = V3().crossVectors(n0, t1);
    const ring = (r, a, lift, o) => { _q.copy(c.pos).addScaledVector(t1, r * Math.cos(a)).addScaledVector(t2, r * Math.sin(a)); radial(_q, o); return o.addScaledVector(sNormal(o, _n), lift); };
    L.satin.push(skin((u, v, o) => ring(lerp(0.3, 0.47, v), u * TAU, 0.032 - 0.024 * smoothstep(0.45, 1, v), o), { nu: 36, nv: 3, thickness: 0.07, closedU: true }));
    for (let i = 0; i < 6; i++) { const p = ring(0.4, (i / 6) * TAU + 0.3, 0.025, V3()); screwsL.push([p, sNormal(p, V3()), 0.02]); }
    L.metal.push(aim(revolve([[0.15, -0.06], [0.3, -0.06], [0.335, -0.02], [0.335, 0.02], [0.31, 0.05], [0.27, 0.06], [0.24, 0.045], [0.2, 0.07], [0.15, 0.07], [0.15, -0.06]], { segments: 24 }), V3(0.55, -1, 0), V3(c.pos.x, c.pos.y + 0.02, c.pos.z)));
  }

  // ── neck collar (front) and petiole socket (rear): stepped, the socket screwed ──
  C.metal.push(xf(revolve([[0.36, -0.1], [0.58, -0.1], [0.64, -0.05], [0.64, 0.03], [0.6, 0.07], [0.52, 0.08], [0.5, 0.11], [0.42, 0.13], [0.36, 0.1], [0.36, -0.1]], { segments: 36 }), { r: [Math.PI / 2, 0, 0], p: [0, 0.05, 1.8] }));
  C.metal.push(xf(revolve([[0.34, -0.1], [0.62, -0.1], [0.68, -0.05], [0.68, 0.04], [0.64, 0.08], [0.58, 0.09], [0.56, 0.12], [0.38, 0.12], [0.34, 0.08], [0.34, -0.1]], { segments: 48 }), { r: [-Math.PI / 2, 0, 0], p: [0, -0.12, -1.8] }));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; screwsC.push([V3(Math.cos(a) * 0.47, -0.12 + Math.sin(a) * 0.47, -1.92), V3(0, 0, -1), 0.026]); }

  // ── leaf-spring shoes on the box rim (the leaves themselves belong to the motor) ──
  const shoe = (phi, lam, k, out, screws) => {
    const p = thoraxPoint(phi, lam, V3(), k), n = thoraxNormal(phi, lam), t = thoraxPoint(phi + 0.01, lam).sub(thoraxPoint(phi - 0.01, lam));
    out.push(onFrame(plate(roundRect(0.19, 0.085, 0.025), 0.034, { bevel: 0.008, curveSegments: 3 }), p.clone().addScaledVector(n, 0.012), n, t));
    for (const s of [-1, 1]) screws.push([p.clone().addScaledVector(n, 0.029).addScaledVector(t.clone().normalize(), s * 0.058), n.clone(), 0.017]);
  };
  for (const phi of LEAVES) shoe(phi, beltLo - 0.036, 1.012, C.metal, screwsC);

  // assemble the box
  const add = (list, mat) => { if (list.length) box.add(mesh(merge(list), mat, 'thoraxbox')); };
  add([...both(L.metal), ...C.metal], metalBox);
  add([...both(L.satin), ...C.satin], satinBox);
  add([...both(L.body), ...C.body], bodyBox);
  const scatterScrews = (list, mirror, mat, partId, parent) => {
    const s = new Scatter();
    for (const [p, n, r] of list) {
      if (nearHinge(p)) continue;
      s.add(p, n, r, rnd() * TAU);
      if (mirror) s.add(V3(-p.x, p.y, p.z), V3(-n.x, n.y, n.z), r, rnd() * TAU);
    }
    const m = s.build(head, mat); m.userData.partId = partId; m.castShadow = false; parent.add(m); return m;
  };
  const screwMatBox = mats.get('metal', 'thoraxbox', { key: 'screw' });
  scatterScrews(screwsL, true, screwMatBox, 'thoraxbox', box);
  scatterScrews(screwsC, false, screwMatBox, 'thoraxbox', box);
  const rv = boxRivets.build(rivetGeo(0.034), mats.get('metal', 'thoraxbox', { key: 'riv' }));
  rv.userData.partId = 'thoraxbox'; rv.castShadow = false; box.add(rv);

  // ── dorsal lid: scutum + scutellum (flexes at wing-beat frequency) ─────────
  const lidNode = ex.node('scutum', { dir: [0, 1, 0], dist: 6.2, at: 0.36 });
  group.add(lidNode);
  const lid = new THREE.Group(); lidNode.add(lid);
  const lidUV = (u, v) => {            // dorsal midline (phi = 0 / π) maps to u = 0.5 of the medallion
    const a = u * TAU, r = 0.5 * (1 - v) * 0.96;
    return [0.5 + Math.sin(a) * r, 0.5 + Math.cos(a) * r];
  };
  const scutum = shell((u, v, o) => thoraxPoint(u * TAU, lerp(beltHi, Math.PI / 2 - 0.02, v), o), { nu: 132, nv: 30, thickness: 0.085, closedU: true, uv: lidUV });
  lid.add(mesh(scutum, bodyLid, 'scutum'));
  // scutellum: a cushion with a squared footprint, rising out of the rear of the scutum
  const SC = { c: V3(0, 1.0, -1.18), rx: 0.86, ry: 0.5, rz: 0.54 };
  const scP = (a, l, o, k = 1) => { const cl = Math.cos(l); return o.set(SC.c.x + SC.rx * k * cl * se(Math.sin(a), 0.72), SC.c.y + SC.ry * k * Math.sin(l), SC.c.z + SC.rz * k * cl * se(Math.cos(a), 0.72)); };
  const scutellum = shell((u, v, o) => scP(u * TAU, lerp(0.12, Math.PI / 2 - 0.03, v), o), {
    nu: 64, nv: 14, thickness: 0.07, closedU: true, uv: (u, v) => [0.5 + Math.sin(u * TAU) * 0.2 * (1 - v), 0.14 + Math.cos(u * TAU) * 0.12 * (1 - v)],
  });
  lid.add(mesh(scutellum, bodyLid, 'scutum'));
  // where the cushion leaves the scutum: the scuto-scutellar suture
  const Fs = (p) => pw(p.x / RX) + pw(p.y / RY) + pw(p.z / RZ);
  const lJoin = (a) => {
    let lo = 0.12, hi = Math.PI / 2 - 0.05;
    if (Fs(scP(a, lo, _p)) >= 1) return lo;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (Fs(scP(a, m, _p)) < 1) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const lidMetal = [band(beltHi - 0.004, beltHi + 0.07, 1.012)];
  // rim: a gilt collar on the cushion just above the suture, and a rolled bead in the suture itself
  lidMetal.push(shell((u, v, o) => { const a = u * TAU; return scP(a, lJoin(a) + lerp(-0.01, 0.075, v), o, 1.016); }, { nu: 96, nv: 2, thickness: 0.035, closedU: true }));
  { const pts = []; for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; pts.push(scP(a, lJoin(a) - 0.004, V3(), 1.02)); } lidMetal.push(tube(pts, 0.017, { tubular: 96, radial: 6, closed: true })); }
  // median and parapsidal lines inlaid in the scutum
  lidMetal.push(ribbon(topCurve([[0, 0.22], [0, 0.7], [0, 1.26]]), 0.022, { n: 32 }));
  lidMetal.push(ribbon(topCurve([[0, -0.22], [0, -0.6], [0, -0.92]]), 0.022, { n: 20 }));
  for (const s of [1, -1]) lidMetal.push(ribbon(topCurve([[s * 0.5, -0.86], [s * 0.47, -0.62], [s * 0.42, -0.36]]), 0.015, { n: 20 }));   // parapsidal lines: short, posterior
  // lid finial (the medallion's boss) and the striker pad the crosshead taps
  lidMetal.push(xf(revolve([[0, 0], [0.15, 0], [0.162, 0.014], [0.15, 0.028], [0.11, 0.032], [0.1, 0.046], [0.07, 0.058], [0.074, 0.072], [0.05, 0.088], [0, 0.094]], { segments: 32 }), { p: [0, THORAX.ry - 0.012, 0] }));
  const padY = proj('y', 1, 0.62, 0.78, V3()).y - 0.097;
  lidMetal.push(xf(revolve([[0, -0.03], [0.06, -0.03], [0.072, -0.018], [0.072, 0.005], [0.1, 0.018], [0.1, 0.04], [0, 0.04]], { segments: 20 }), { p: [0.62, padY, 0.78] }));
  const lidScrews = [];
  for (const phi of LEAVES) shoe(phi, beltHi + 0.036, 1.012, lidMetal, lidScrews);
  lid.add(mesh(merge(lidMetal), metalLid, 'scutum'));
  const lidRivets = new Scatter();
  for (let i = 0; i < 40; i++) {
    const phi = ((i + 0.5) / 40) * TAU;
    if (LEAVES.some((l) => angGap(phi, l) < 0.09)) continue;
    lidRivets.add(thoraxPoint(phi, beltHi + 0.034, V3(), 1.012), thoraxNormal(phi, beltHi + 0.034), 1);
  }
  for (let i = 0; i < 10; i++) { const a = Math.PI + (i / 9 - 0.5) * 2.2, l = lJoin(a) + 0.034; lidRivets.add(scP(a, l, V3(), 1.016), scP(a, l, V3(), 1.1).sub(scP(a, l, V3(), 1.0)).normalize(), 0.62); }
  const lidRivMat = mats.get('metal', 'scutum', { key: 'riv' });
  const lr = lidRivets.build(rivetGeo(0.032), lidRivMat);
  lr.userData.partId = 'scutum'; lr.castShadow = false; lid.add(lr);
  scatterScrews(lidScrews, false, lidRivMat, 'scutum', lid);

  // ── resonant flight motor: frame, leaf springs, crank, conrod, crosshead ───
  const motorNode = ex.node('motor', { dir: [0, 1, 0], dist: 2.5, at: 0.5 });
  group.add(motorNode);
  const satinMotor = mats.get('satin', 'motor'), metalMotor = mats.get('metal', 'motor'), enamel = mats.get('body', 'motor');
  const springs = [];
  const leaf = (phi) => {                      // bowed leaf spring bridging the belt gap
    const w = 0.11;
    return shell((u, v, o) => {
      const lam = lerp(beltLo - 0.05, beltHi + 0.05, v);
      thoraxPoint(phi + (u - 0.5) * w, lam, o, 0.985 + Math.sin(v * Math.PI) * 0.03);
    }, { nu: 2, nv: 10, thickness: 0.022 });
  };
  for (const phi of LEAVES) springs.push(leaf(phi));
  const leafMesh = mesh(merge(springs), metalMotor, 'motor');
  motorNode.add(leafMesh);

  const { c1, c3, c4 } = GEARS;
  const A1 = [-c1.z, c1.y], A3 = [-c3.z, c3.y], A4 = [-c4.z, c4.y];       // arbors in gear-plane coords
  const PIL = { H: [0.22, 0.78], C: [-1.05, -0.5], F: [1.2, 0.15], Gp: [-0.1, -1.1], D: [0.3, 0.95], E: [-1.1, -0.3] };
  const POSTS = [[-0.55, -0.82], [0.75, -0.98]];
  const motorSatin = [], motorMetal = [], motorScrews = [];

  // enamel pillar plate: the movement's backdrop (and what stops the eye seeing straight through the bee)
  // (round, like a watch movement: centred on the train, just big enough to carry every pillar)
  const PLATE = (() => {
    const cx = 0.05, cy = -0.12;
    let r = 0;
    for (const [p, m] of [[A4, 0.62], [A3, 0.36], [A1, 0.33], ...['H', 'C', 'F', 'Gp', 'D', 'E'].map((k) => [PIL[k], 0.13]), ...POSTS.map((p) => [p, 0.12])]) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy) + m);
    return { cx, cy, r };
  })();
  {
    const s = new THREE.Shape(); s.absarc(PLATE.cx, PLATE.cy, PLATE.r, 0, TAU, false);
    for (const [x, y] of [A1, A3, A4]) s.holes.push(circleHole(x, y, 0.036));
    motorNode.add(mesh(xf(plate(s, 0.04, { bevel: 0.012, curveSegments: 24 }), { r: [0, Math.PI / 2, 0] }), enamel, 'motor'));
    // gilt chamfer rings round the plate edge, and a turned register line inside it
    for (const sx of [0.021, -0.021]) {
      motorMetal.push(xf(new THREE.TorusGeometry(PLATE.r - 0.004, 0.008, 4, 96), { r: [0, Math.PI / 2, 0], p: [sx, PLATE.cy, -PLATE.cx] }));
      motorMetal.push(xf(new THREE.TorusGeometry(PLATE.r - 0.075, 0.005, 3, 96), { r: [0, Math.PI / 2, 0], p: [sx, PLATE.cy, -PLATE.cx] }));
    }
  }
  // bridges: [path, width, bosses, x of the inner face, side]
  const BR = [
    { pts: [PIL.H, A3, A1, PIL.C], boss: [0.11, 0.1, 0.13, 0.11], x: 0.27, s: 1 },        // +X train bridge
    { pts: [PIL.F, A4, PIL.Gp], boss: [0.11, 0.34, 0.11], x: 0.42, s: 1,                   // +X barrel bridge (carries ratchet + click),
      win: [1.75, 2.95, 5.3].map((a) => kidney(A4[0], A4[1], 0.215, 0.305, a - 0.42, a + 0.42)) },   // windowed onto the turning barrel
    { pts: [PIL.D, A3, A1, PIL.E], boss: [0.11, 0.1, 0.12, 0.11], x: -0.27, s: -1 },      // −X train bridge
  ];
  const T_BR = 0.04;
  for (const b of BR) {
    const holes = b.pts.filter((p) => p === A1 || p === A3 || p === A4).map(([x, y]) => [x, y, 0.034]);
    const xc = b.x + b.s * T_BR / 2;
    motorSatin.push(xf(plate(bridgeShape(b.pts, 0.12, b.boss, holes, b.win), T_BR, { bevel: 0.011, curveSegments: 6 }), { r: [0, Math.PI / 2, 0], p: [xc, 0, 0] }));
    const face = b.x + b.s * T_BR;
    for (const p of b.pts) {
      if (p === A1 || p === A3 || p === A4) {      // chaton: a turned, screwed bearing setting
        motorMetal.push(aim(revolve([[0.034, 0], [0.074, 0], [0.08, 0.01], [0.074, 0.02], [0.05, 0.024], [0.038, 0.018], [0.034, 0]], { segments: 24 }), V3(b.s, 0, 0), G(p[0], p[1], face)));
        for (let i = 0; i < 2; i++) { const a = i * Math.PI + 0.6; motorScrews.push([G(p[0] + Math.cos(a) * 0.098, p[1] + Math.sin(a) * 0.098, face), V3(b.s, 0, 0), 0.018]); }
      } else {                                      // pillar end: screw through the bridge into the pillar
        motorScrews.push([G(p[0], p[1], face), V3(b.s, 0, 0), 0.034]);
        const X = Math.abs(b.x) + 0.004;
        motorSatin.push(aim(revolve([[0, 0.02], [0.062, 0.02], [0.07, 0.03], [0.07, 0.04], [0.05, 0.055], [0.05, X - 0.06], [0.066, X - 0.045], [0.066, X - 0.016], [0.056, X], [0, X]], { segments: 14 }), V3(b.s, 0, 0), G(p[0], p[1], 0)));
      }
    }
  }
  // posts from the plate down to the sternum, with screwed feet
  for (const [lx, ly] of POSTS) {
    const z = -lx, top = ly + 0.06, footY = -1.5;
    motorSatin.push(xf(revolve([[0, footY], [0.11, footY], [0.11, footY + 0.025], [0.06, footY + 0.05], [0.045, footY + 0.12], [0.06, footY + 0.15], [0.045, footY + 0.18], [0.04, top - 0.06], [0.055, top - 0.03], [0.04, top], [0, top]], { segments: 18 }), { p: [0, 0, z] }));
    for (const sz of [-1, 1]) motorScrews.push([V3(0.08 * sz, footY + 0.025, z), V3(0, 1, 0), 0.02]);
  }
  // crosshead guide: two rods, top and bottom yokes, a strut back to the train bridge
  const crankX = 0.46, throwR = 0.1, rodLen = 0.62;
  const guideZ = GEARS.c1.z, guideY0 = GEARS.c1.y + rodLen - 0.02, GX = 0.62;
  for (const dz of [-0.08, 0.08]) motorSatin.push(rod(V3(GX, 0.44, guideZ + dz), V3(GX, 1.02, guideZ + dz), 0.02, { radial: 10 }));
  motorSatin.push(xf(plate(roundRect(0.3, 0.075, 0.03), 0.055, { bevel: 0.01, curveSegments: 4 }), { r: [0, Math.PI / 2, 0], p: [GX, 1.03, guideZ] }));
  motorSatin.push(xf(plate(roundRect(0.3, 0.06, 0.028), 0.05, { bevel: 0.009, curveSegments: 4 }), { r: [0, Math.PI / 2, 0], p: [GX, 0.43, guideZ] }));
  motorMetal.push(xf(bushing(0.045, 0.075, { bore: 0.024, segments: 18 }), { p: [GX, 1.03, guideZ] }));
  motorSatin.push(rod(V3(GX, 0.42, guideZ + 0.12), V3(0.31, 0.1, guideZ + 0.12), 0.022, { radial: 8 }));
  for (const dz of [-0.11, 0.11]) motorScrews.push([V3(GX + 0.0, 1.06, guideZ + dz), V3(0, 1, 0), 0.016]);

  motorNode.add(mesh(merge(motorSatin), satinMotor, 'motor'));
  motorNode.add(mesh(merge(motorMetal), metalMotor, 'motor'));
  scatterScrews(motorScrews, false, mats.get('metal', 'motor', { key: 'screw' }), 'motor', motorNode);

  // crank disc with counterweight, crankpin + nut, on the fast arbor
  const crank = new THREE.Group(); crank.position.set(crankX, c1.y, c1.z); motorNode.add(crank);
  const cw = new THREE.Shape(); cw.absarc(0, 0, 0.17, Math.PI * 1.18, Math.PI * 1.82, false); cw.absarc(0, 0, 0.07, Math.PI * 1.82, Math.PI * 1.18, true); cw.closePath();
  const disc = merge([
    xf(revolve([[0.03, -0.03], [0.17, -0.03], [0.19, -0.012], [0.19, 0.012], [0.17, 0.03], [0.06, 0.03], [0.055, 0.045], [0.03, 0.045], [0.03, -0.03]], { segments: 36 }), { r: [0, 0, Math.PI / 2] }),
    xf(plate(cw, 0.03, { bevel: 0.007 }), { r: [0, -Math.PI / 2, 0], p: [-0.045, 0, 0] }),                                // counterweight crescent (opposite the pin)
    xf(revolve([[0, -0.03], [0.034, -0.03], [0.034, 0.075], [0.03, 0.08], [0, 0.08]], { segments: 14 }), { r: [0, 0, -Math.PI / 2], p: [0.02, throwR, 0] }),
    xf(revolve([[0.034, 0], [0.05, 0], [0.05, 0.026], [0.042, 0.032], [0.034, 0.032]], { segments: 6, crease: 0.3 }), { r: [0, 0, -Math.PI / 2], p: [0.1, throwR, 0] }),   // hex nut
    aim(screwGeo(0.02, 10), V3(-1, 0, 0), V3(-0.06, -0.12, 0)),                                                             // counterweight screw
  ]);
  crank.add(mesh(disc, metalMotor, 'motor'));
  motorNode.add(mesh(rod(V3(0.3, c1.y, c1.z), V3(crankX, c1.y, c1.z), 0.03), satinMotor, 'motor'));
  const conrod = new THREE.Group(); motorNode.add(conrod);
  conrod.add(mesh(merge([
    xf(plate(linkShape(rodLen, 0.05, 0.022), 0.03, { bevel: 0.007 }), { r: [0, Math.PI / 2, 0] }),
    xf(bushing(0.052, 0.04, { bore: 0.026, segments: 20 }), { r: [0, 0, Math.PI / 2] }),
    xf(bushing(0.052, 0.04, { bore: 0.026, segments: 20 }), { r: [0, 0, Math.PI / 2], p: [0, 0, -rodLen] }),
    xf(bushing(0.013, 0.014, { segments: 8 }), { p: [0, 0.026, -rodLen / 2] }),                                             // oil cup on the rod's crown
  ]), metalMotor, 'motor'));
  const crosshead = new THREE.Group(); motorNode.add(crosshead);
  crosshead.add(mesh(merge([
    xf(bushing(0.03, 0.15, { segments: 12 }), { r: [0, 0, Math.PI / 2], p: [0.04, 0, 0] }),                               // gudgeon pin
    (() => { const s = roundRect(0.26, 0.17, 0.04); s.holes.push(circleHole(-0.08, 0, 0.022), circleHole(0.08, 0, 0.022)); return xf(plate(s, 0.07, { bevel: 0.012 }), { r: [0, -Math.PI / 2, 0], p: [GX - (crankX + 0.06), 0, 0] }); })(),
    xf(revolve([[0, 0.08], [0.03, 0.08], [0.03, 0.1], [0.02, 0.12], [0.02, 0.55], [0.028, 0.56], [0.028, 0.58], [0.018, 0.595], [0, 0.6]], { segments: 12 }), { p: [GX - (crankX + 0.06), 0, 0] }),   // tappet
    xf(bushing(0.045, 0.02, { segments: 6, chamfer: 0.3 }), { r: [0, 0, Math.PI / 2], p: [-0.04, 0, 0] }),               // pin nut
  ]), metalMotor, 'motor'));

  // ── gear train ─────────────────────────────────────────────────────────────
  const gearNode = ex.node('geartrain', { dir: [0, 1, 0], dist: 4.3, at: 0.46 });
  group.add(gearNode);
  const metalGear = mats.get('metal', 'geartrain'), satinGear = mats.get('satin', 'geartrain');
  const wheels = {};
  /** Spoked wheel: full-depth toothed rim, a thin web with parallel spokes, a proud hub with a set screw. */
  const wheelGeo = (N, { spokes, hub, hw }) => {
    const rp = (M * N) / 2, rr = rp - M * 1.15, rimIn = rr - 0.055, h = GEARS.t / 2 - 0.0015;
    return merge([
      gear(N, M, GEARS.t, { bore: rimIn }),
      // polished anglage: a broad 45° chamfer turned on the rim's inner edge, both faces
      xf(revolve([[rimIn + 0.004, -h], [rimIn - 0.006, -h], [rimIn - 0.022, -h + 0.016], [rimIn - 0.022, h - 0.016], [rimIn - 0.006, h], [rimIn + 0.004, h], [rimIn + 0.004, -h]], { segments: 64, crease: 0.5 }), { r: [Math.PI / 2, 0, 0] }),
      plate(webShape(rimIn - 0.01, hub - 0.004, spokes, hw, 0.034), 0.046, { bevel: 0.009, curveSegments: 12 }),
      xf(revolve([[0.034, -0.1], [hub - 0.014, -0.1], [hub, -0.086], [hub, -0.03], [hub - 0.009, -0.022], [hub - 0.009, 0.022], [hub, 0.03], [hub, 0.086], [hub - 0.014, 0.1], [0.034, 0.1], [0.034, -0.1]], { segments: 24 }), { r: [Math.PI / 2, 0, 0] }),
      aim(screwGeo(0.017, 10), V3(Math.cos(0.5), Math.sin(0.5), 0), V3(Math.cos(0.5) * hub, Math.sin(0.5) * hub, 0.058)),
    ]);
  };
  /** Pinion: solid leaves, longer than the wheel it drives, with a turned shoulder on one side. */
  const pinionGeo = (N, side) => merge([
    gear(N, M, GEARS.t + 0.03, { bore: 0.034 }),
    xf(revolve([[0.034, 0], [0.11, 0], [0.12, 0.012], [0.12, 0.03], [0.09, 0.05], [0.034, 0.05], [0.034, 0]], { segments: 28 }), { r: [side * Math.PI / 2, 0, 0], p: [0, 0, side * (GEARS.t / 2 + 0.015)] }),
  ]);
  const addWheel = (key, geo, c, x, mat) => {
    const holder = new THREE.Group(); holder.position.set(x, c.y, c.z); holder.rotation.y = Math.PI / 2; gearNode.add(holder);
    const g = mesh(geo, mat, 'geartrain'); holder.add(g);
    wheels[key] = g; return g;
  };
  addWheel('g4', wheelGeo(N4, { spokes: 6, hub: 0.13, hw: 0.026 }), c4, GEARS.xA, metalGear);
  addWheel('g3', pinionGeo(N3, -1), c3, GEARS.xA, metalGear);
  addWheel('g2', wheelGeo(N2, { spokes: 5, hub: 0.11, hw: 0.024 }), GEARS.c2, GEARS.xB, metalGear);
  addWheel('g1', pinionGeo(N1, 1), c1, GEARS.xB, metalGear);
  // mainspring barrel on the great wheel's arbor (turns with it), cover screws so the motion reads
  const barrelX = 0.305;
  addWheel('barrel', merge([
    xf(revolve([[0.06, -0.088], [0.43, -0.088], [0.452, -0.074], [0.452, -0.03], [0.444, -0.024], [0.444, -0.012], [0.452, -0.006], [0.452, 0.07], [0.44, 0.08], [0.39, 0.08], [0.38, 0.09], [0.12, 0.09], [0.1, 0.1], [0.06, 0.1], [0.06, -0.088]], { segments: 64 }), { r: [Math.PI / 2, 0, 0] }),
    ...[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * TAU + 0.3; return aim(screwGeo(0.02, 10), V3(0, 0, 1), V3(Math.cos(a) * 0.415, Math.sin(a) * 0.415, 0.08)); }),
    ...[0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * TAU; return aim(screwGeo(0.024, 10), V3(0, 0, 1), V3(Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0.09)); }),   // cover screws, seen through the bridge windows
  ]), c4, barrelX, satinGear);
  // ratchet wheel (on the arbor square) with its click and click spring, above the barrel bridge
  const rcx = 0.42 + T_BR + 0.016;
  const gearStatic = [
    xf(plate(ratchetShape(24, 0.2, 0.165, 0.032), 0.03, { bevel: 0.006 }), { r: [0, Math.PI / 2, 0], p: [rcx, c4.y, c4.z] }),
    rod(V3(-0.05, c4.y, c4.z), V3(rcx + 0.05, c4.y, c4.z), 0.03, { radial: 12 }),
    rod(V3(-0.34, c3.y, c3.z), V3(0.34, c3.y, c3.z), 0.028, { radial: 12 }),
    rod(V3(-0.34, c1.y, c1.z), V3(0.31, c1.y, c1.z), 0.028, { radial: 12 }),
    xf(revolve([[0, 0], [0.05, 0], [0.05, 0.03], [0.034, 0.042], [0, 0.042]], { segments: 4, crease: 0.3 }), { r: [0, 0, -Math.PI / 2], p: [rcx + 0.015, c4.y, c4.z] }),   // square-ended winding arbor cap
  ];
  {
    const pa = 0.68, pr = 0.29, pv = [A4[0] + Math.cos(pa) * pr, A4[1] + Math.sin(pa) * pr];        // click pivot, on the bridge arm
    const ta = 1.25, tip = [A4[0] + Math.cos(ta) * 0.18, A4[1] + Math.sin(ta) * 0.18];             // where it drops into a tooth
    const ang = Math.atan2(tip[1] - pv[1], tip[0] - pv[0]), len = Math.hypot(tip[0] - pv[0], tip[1] - pv[1]);
    const clickS = linkShape(len, 0.032, 0.016, { hole: 0.4 });
    gearStatic.push(xf(xf(plate(clickS, 0.026, { bevel: 0.006 }), { r: [0, 0, ang], p: [pv[0], pv[1], 0] }), { r: [0, Math.PI / 2, 0], p: [rcx, 0, 0] }));
    const sp = []; for (let i = 0; i <= 10; i++) { const a = pa - 0.62 + (i / 10) * 0.5, r = 0.29 - 0.03 * Math.sin((i / 10) * Math.PI); sp.push(G(A4[0] + Math.cos(a) * r, A4[1] + Math.sin(a) * r, rcx)); }
    gearStatic.push(tube(sp, 0.009, { tubular: 20, radial: 5 }));                                  // click spring
    gearStatic.push(aim(screwGeo(0.026, 12), V3(1, 0, 0), G(pv[0], pv[1], rcx + 0.013)));
    gearStatic.push(aim(screwGeo(0.02, 10), V3(1, 0, 0), G(sp[0].z * -1, sp[0].y, 0.42 + T_BR)));
  }
  gearNode.add(mesh(merge(gearStatic), satinGear, 'geartrain'));

  /** Drive the train from the crank angle (radians). Wheels counter-rotate at exact tooth ratios. */
  function setCrank(theta) {
    // gear-plane coords: lx = -z, ly = y. Direction from wheel 1 → wheel 2 and from wheel 3 → wheel 4:
    const phi12 = Math.atan2(GEARS.c2.y - GEARS.c1.y, -(GEARS.c2.z - GEARS.c1.z));
    const phi34 = Math.atan2(GEARS.c4.y - GEARS.c3.y, -(GEARS.c4.z - GEARS.c3.z));
    const t1 = theta;
    const t2 = phi12 + Math.PI + Math.PI / N2 - (t1 - phi12) * (N1 / N2);
    const t3 = t2;                                    // same arbor
    const t4 = phi34 + Math.PI + Math.PI / N4 - (t3 - phi34) * (N3 / N4);
    wheels.g1.rotation.z = t1; wheels.g2.rotation.z = t2; wheels.g3.rotation.z = t3; wheels.g4.rotation.z = t4;
    wheels.barrel.rotation.z = t4;                    // the barrel rides the great wheel's arbor
    // crank shares the fast arbor (seen from +X the gear-plane angle runs the other way)
    crank.rotation.x = -t1;
    const py = GEARS.c1.y + Math.cos(-t1) * throwR, pz = GEARS.c1.z + Math.sin(-t1) * throwR;
    const dz = guideZ - pz, hy = py + Math.sqrt(Math.max(1e-4, rodLen * rodLen - dz * dz));
    crosshead.position.set(crankX + 0.06, hy, guideZ);
    conrod.position.set(crankX + 0.06, py, pz);
    // conrod geometry runs along local +X before its bake (→ -Z after rotateY 90°): aim -Z at the crosshead
    conrod.rotation.x = Math.atan2(hy - py, -(guideZ - pz));
    return hy - guideY0;                              // crosshead lift, ±throw
  }

  /** Thoracic flex: lid rides the crosshead (x ∈ -1..1), leaf springs stretch with it. */
  function setFlex(x, amount) {
    lid.position.y = x * 0.028 * amount;
    lid.scale.set(1 - x * 0.006 * amount, 1, 1 + x * 0.004 * amount);
    leafMesh.scale.y = 1 + x * 0.012 * amount;
  }

  // ── setae: placement lives in fur.js ───────────────────────────────────────
  const fur = buildThoraxFur({ mats, ex });
  group.add(fur.node);

  // wing hinge positions (left side; right is mirrored) — the belt at shoulder height
  const hingeY = (thoraxHeightAt(beltLo) + thoraxHeightAt(beltHi)) / 2;
  const mounts = {
    foreHinge: V3(1.42, hingeY, 0.52),
    hindHinge: V3(1.4, hingeY - 0.03, -0.46),
    coxae,
    neck: V3(0, 0.05, 1.88),
    petiole: V3(0, -0.12, -1.9),
  };

  setCrank(0.4);
  return { group, lid, lidNode, fur, mounts, setCrank, setFlex, anchors: {
    thoraxbox: V3(-1.2, -0.95, 0.9), scutum: V3(0, THORAX.ry, 0.2), motor: V3(crankX + 0.06, guideY0, guideZ),
    geartrain: V3(GEARS.xA, GEARS.c4.y, GEARS.c4.z), setae: V3(0, 0.7, 1.75),
  } };
}
