// ─────────────────────────────────────────────────────────────────────────────
// bee/kit.js — GEOMETRY BUILDERS
// Small procedural "machine shop": lathe-turned parts, swept tubes, thick shell
// panels, real toothed gears, hex prisms, rivets. Everything returns plain
// non-indexed BufferGeometry with position / normal / uv so pieces can be merged.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

// ── utilities ────────────────────────────────────────────────────────────────

/** Normalise any geometry to non-indexed position/normal/uv so it can be merged. */
export function plain(g) {
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.morphAttributes = {};
  return g;
}

/** Merge a list of geometries (falsy entries are skipped). */
export function merge(list) {
  const gs = list.filter(Boolean).map(plain);
  if (gs.length === 1) return gs[0];
  return mergeGeometries(gs, false);
}

/** Flip triangle winding if the surface is inside-out (signed volume test about the origin of `centre`). */
export function orient(g, centre = null) {
  const p = g.attributes.position, idx = g.index;
  const n = idx ? idx.count : p.count;
  const a = V3(), b = V3(), c = V3(), o = centre || V3();
  let vol = 0;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, i0).sub(o); b.fromBufferAttribute(p, i1).sub(o); c.fromBufferAttribute(p, i2).sub(o);
    vol += a.dot(b.cross(c));
  }
  if (vol < 0) flip(g);
  return g;
}

export function flip(g) {
  if (g.index) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const k of Object.keys(g.attributes)) {
      const at = g.attributes[k], s = at.itemSize, arr = at.array;
      for (let i = 0; i < at.count; i += 3) {
        for (let j = 0; j < s; j++) { const t = arr[(i + 1) * s + j]; arr[(i + 1) * s + j] = arr[(i + 2) * s + j]; arr[(i + 2) * s + j] = t; }
      }
    }
  }
  if (g.attributes.normal) { const nn = g.attributes.normal.array; for (let i = 0; i < nn.length; i++) nn[i] = -nn[i]; }
  return g;
}

/** Bake a transform into a geometry: xf(g, { p:[x,y,z], r:[rx,ry,rz], s:number|[x,y,z] }) */
export function xf(g, { p, r, s } = {}) {
  if (s !== undefined) { if (typeof s === 'number') g.scale(s, s, s); else g.scale(s[0], s[1], s[2]); if ((typeof s !== 'number') && s[0] * s[1] * s[2] < 0) flip(g); }
  if (r) { if (r[0]) g.rotateX(r[0]); if (r[1]) g.rotateY(r[1]); if (r[2]) g.rotateZ(r[2]); }
  if (p) g.translate(p[0], p[1], p[2]);
  return g;
}

/** Rotate a +Y-aligned geometry so its axis points along `dir`, then move to `pos`. */
export function aim(g, dir, pos = null) {
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  if (pos) g.translate(pos.x, pos.y, pos.z);
  return g;
}

// ── lathe-turned parts ───────────────────────────────────────────────────────

/**
 * Revolve a profile around +Y. `profile` = [[radius, y], …] listed bottom → top
 * (or any order; winding is fixed automatically). Sharp profile corners stay
 * crisp (creased normals), like a part turned on a lathe.
 */
export function revolve(profile, { segments = 40, crease = 0.62, phiStart = 0, phiLength = TAU } = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  let g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  let cy = 0; for (const p of pts) cy += p.y; cy /= pts.length;
  orient(g, V3(0, cy, 0));
  g = toCreasedNormals(g, crease);
  return g;
}

/** A turned bushing / collar: outer radius, height, with small chamfers and an optional bore. */
export function bushing(r, h, { bore = 0, chamfer = 0.12, segments = 28 } = {}) {
  const c = Math.min(r, h) * chamfer, y0 = -h / 2, y1 = h / 2;
  const prof = bore > 0
    ? [[bore, y0], [r - c, y0], [r, y0 + c], [r, y1 - c], [r - c, y1], [bore, y1], [bore, y0]]
    : [[0, y0], [r - c, y0], [r, y0 + c], [r, y1 - c], [r - c, y1], [0, y1]];
  return revolve(prof, { segments });
}

/** Ball with a slim equatorial band — reads as a ball joint. */
export function ballJoint(r, { segments = 20 } = {}) {
  const prof = [];
  const n = 12;
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI; prof.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return revolve(prof, { segments, crease: 1.2 });
}

/** Domed rivet head sitting on y = 0, pointing +Y. */
export function rivetGeo(r = 0.05, segments = 10) {
  return revolve([[r * 1.12, 0], [r * 1.12, r * 0.18], [r, r * 0.2], [r * 0.86, r * 0.55], [r * 0.5, r * 0.85], [0, r * 0.95]], { segments, crease: 0.9 });
}

/** Cap screw with a conical socket recess, on y = 0 pointing +Y. */
export function screwGeo(r = 0.07, segments = 14) {
  return revolve([[r, 0], [r, r * 0.55], [r * 0.88, r * 0.7], [r * 0.52, r * 0.7], [r * 0.3, r * 0.34], [0, r * 0.3]], { segments, crease: 0.5 });
}

/** Hexagonal prism (flat-top, axis +Y) with a light chamfer. */
export function hexPrism(r, h, { chamfer = 0.1 } = {}) {
  const c = Math.min(r, h) * chamfer;
  return revolve([[0, -h / 2], [r - c, -h / 2], [r, -h / 2 + c], [r, h / 2 - c], [r - c, h / 2], [0, h / 2]], { segments: 6, crease: 0.3 });
}

// ── swept tubes ──────────────────────────────────────────────────────────────

/**
 * Sweep a circular section along a curve. `radius` may be a number or f(u∈[0,1]).
 * `points` may be Vector3[] (Catmull-Rom is fitted) or a THREE.Curve.
 */
export function tube(points, radius = 0.05, { tubular = 24, radial = 8, caps = true, closed = false, tension = 0.5 } = {}) {
  const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points, closed, 'catmullrom', tension);
  const rf = typeof radius === 'function' ? radius : () => radius;
  const frames = curve.computeFrenetFrames(tubular, closed);
  const pos = [], nor = [], uv = [], idx = [];
  const P = V3(), N = V3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular; curve.getPointAt(u, P);
    const r = rf(u), n = frames.normals[i], b = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      N.set(c * n.x + s * b.x, c * n.y + s * b.y, c * n.z + s * b.z);
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r); nor.push(N.x, N.y, N.z); uv.push(u, j / radial);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < tubular; i++) for (let j = 0; j < radial; j++) {
    const a = i * row + j, b = a + row, c = b + 1, d = a + 1;
    idx.push(a, d, b, b, d, c);
  }
  if (caps && !closed) {
    for (const end of [0, 1]) {
      const i = end ? tubular : 0, base = pos.length / 3;
      curve.getPointAt(end, P); const t = frames.tangents[i];
      pos.push(P.x, P.y, P.z); nor.push(end ? t.x : -t.x, end ? t.y : -t.y, end ? t.z : -t.z); uv.push(end, 0.5);
      for (let j = 0; j < radial; j++) {
        const a = i * row + j, b = i * row + j + 1;
        if (end) idx.push(base, a, b); else idx.push(base, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/** Straight rod between two points. */
export function rod(a, b, r, { radial = 8, caps = true } = {}) {
  return tube(new THREE.LineCurve3(a, b), r, { tubular: 1, radial, caps });
}

// ── thick parametric shells ──────────────────────────────────────────────────

/**
 * A closed, thick panel built from a parametric surface P(u, v) → Vector3.
 * Outer skin = P, inner skin = P − n·thickness, plus edge walls, so SECTION
 * cuts show real material thickness. Normals of the skins are analytic
 * (finite differences), so closed-in-u rings have no shading seam.
 *
 * @param {(u:number, v:number, out:THREE.Vector3)=>void} P
 * @param {object} o  nu, nv grid; thickness number|f(u,v); closedU; flipN (reverse the outward side);
 *                    uv: f(u,v)→[s,t] custom UVs
 */
export function shell(P, { nu = 32, nv = 12, thickness = 0.08, closedU = false, flipN = false, uv = null, wallV0 = true, wallV1 = true, skip = null } = {}) {
  const tf = typeof thickness === 'function' ? thickness : () => thickness;
  const e = 1e-3, A = V3(), B = V3(), C = V3(), dU = V3(), dV = V3(), n = V3();
  const outer = [], inner = [], normals = [], uvs = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const uu = Math.min(1 - e, Math.max(e, u)), vv = Math.min(1 - e, Math.max(e, v));
    P(uu - e, vv, A); P(uu + e, vv, B); dU.subVectors(B, A);
    P(uu, vv - e, A); P(uu, vv + e, B); dV.subVectors(B, A);
    n.crossVectors(dU, dV).normalize(); if (flipN) n.negate();
    P(u, v, C);
    outer.push(C.x, C.y, C.z); normals.push(n.x, n.y, n.z);
    const t = tf(u, v); inner.push(C.x - n.x * t, C.y - n.y * t, C.z - n.z * t);
    const st = uv ? uv(u, v) : [u, v]; uvs.push(st[0], st[1]);
  }
  const pos = [], nor = [], tex = [];
  const row = nu + 1;
  const push = (arr, k, sign) => {
    pos.push(arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]);
    nor.push(normals[k * 3] * sign, normals[k * 3 + 1] * sign, normals[k * 3 + 2] * sign);
    tex.push(uvs[k * 2], uvs[k * 2 + 1]);
  };
  // skins
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (skip && skip((i + 0.5) / nu, (j + 0.5) / nv)) continue;   // leave a hole (cover its ragged edge with a bezel)
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    // outer: (a, b, c) must face +n.  n = dU × dV, so a→b (u) then a→c (v) is CCW seen from +n.
    for (const k of flipN ? [a, c, b, b, c, d] : [a, b, c, b, d, c]) push(outer, k, 1);
    for (const k of flipN ? [a, b, c, b, d, c] : [a, c, b, b, c, d]) push(inner, k, -1);
  }
  // edge walls (flat-shaded)
  const wall = (k0, k1) => {
    const p = (arr, k) => V3(arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]);
    const o0 = p(outer, k0), o1 = p(outer, k1), i0 = p(inner, k0), i1 = p(inner, k1);
    const fn = V3().crossVectors(V3().subVectors(o1, o0), V3().subVectors(i0, o0)).normalize();
    for (const q of [o0, o1, i0, o1, i1, i0]) { pos.push(q.x, q.y, q.z); nor.push(fn.x, fn.y, fn.z); }
    for (const k of [k0, k1, k0, k1, k1, k0]) tex.push(uvs[k * 2], uvs[k * 2 + 1]);
  };
  const W = (k0, k1, rev) => (rev !== flipN ? wall(k1, k0) : wall(k0, k1));
  for (let i = 0; i < nu; i++) {
    if (wallV0) W(i, i + 1, true);
    if (wallV1) W(nv * row + i, nv * row + i + 1, false);
  }
  if (!closedU) for (let j = 0; j < nv; j++) { W(j * row, (j + 1) * row, false); W(j * row + nu, (j + 1) * row + nu, true); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
  return g;
}

// ── flat machined parts ──────────────────────────────────────────────────────

/** Extrude a THREE.Shape (XY plane) along +Z, centred in Z, with a small bevel. */
export function plate(shape, thickness, { bevel = 0.012, curveSegments = 10, crease = 0.5 } = {}) {
  const b = Math.min(bevel, thickness * 0.35);
  let g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments, steps: 1,
  });
  g.translate(0, 0, -(thickness - 2 * b) / 2);
  g = toCreasedNormals(plain(g), crease);
  return g;
}

/**
 * Outline of a spur gear with real teeth. `N` teeth, module `m` (pitch radius = m·N/2).
 * Tooth 0 is centred on +X. Returns a THREE.Shape with an arbor bore and spoke windows.
 */
export function gearShape(N, m, { bore = 0.04, spokes = 0, hub = 0.1, rim = 0.09 } = {}) {
  const rp = (m * N) / 2, rt = rp + m * 0.92, rr = rp - m * 1.15, pitch = TAU / N;
  const s = new THREE.Shape();
  for (let k = 0; k < N; k++) {
    const c = k * pitch;
    const pts = [
      [rr, -0.5], [rr, -0.31], [rp - m * 0.35, -0.275], [rp, -0.25], [rp + m * 0.5, -0.2], [rt, -0.13],
      [rt, 0.13], [rp + m * 0.5, 0.2], [rp, 0.25], [rp - m * 0.35, 0.275], [rr, 0.31],
    ];
    for (let i = 0; i < pts.length; i++) {
      const [r, f] = pts[i], a = c + f * pitch, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (k === 0 && i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, bore, 0, TAU, true); s.holes.push(hole);
  if (spokes > 0) {
    const r0 = hub, r1 = rr - rim;
    if (r1 - r0 > m) {
      const gap = 0.16; // spoke half-width as a fraction of the window pitch
      for (let k = 0; k < spokes; k++) {
        const a0 = (k + gap) * (TAU / spokes), a1 = (k + 1 - gap) * (TAU / spokes);
        const w = new THREE.Path();
        w.absarc(0, 0, r1, a0, a1, false);
        w.absarc(0, 0, r0, a1 - (0.1 * TAU) / spokes, a0 + (0.1 * TAU) / spokes, true);
        w.closePath(); s.holes.push(w);
      }
    }
  }
  return s;
}

/** A finished gear lying in the XY plane, thickness along Z. */
export function gear(N, m, thickness, opts = {}) {
  return plate(gearShape(N, m, opts), thickness, { bevel: Math.min(0.012, m * 0.25), curveSegments: 20, crease: 0.45 });
}

/** Rounded link (dog-bone) between two eye centres in the XY plane. */
export function linkShape(len, rEye, wBar, { hole = 0.5 } = {}) {
  const s = new THREE.Shape();
  const a = Math.asin(Math.min(0.99, wBar / rEye));
  s.absarc(0, 0, rEye, a, TAU - a, false);
  s.absarc(len, 0, rEye, Math.PI + a, Math.PI - a + TAU, false);
  s.closePath();
  for (const x of [0, len]) { const h = new THREE.Path(); h.absarc(x, 0, rEye * hole, 0, TAU, true); s.holes.push(h); }
  return s;
}

// ── instancing helper ────────────────────────────────────────────────────────

/**
 * Collects placements (position + outward normal + scale/spin) and bakes them
 * into one InstancedMesh — used for rivets, screws, facets, hooks.
 */
export class Scatter {
  constructor() { this.items = []; }
  add(pos, normal = V3(0, 1, 0), scale = 1, spin = 0) { this.items.push({ pos: pos.clone(), normal: normal.clone().normalize(), scale, spin }); return this; }
  get count() { return this.items.length; }
  build(geometry, material) {
    const mesh = new THREE.InstancedMesh(geometry, material, this.items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), up = V3(0, 1, 0), s = V3();
    this.items.forEach((it, i) => {
      q.setFromUnitVectors(up, it.normal);
      if (it.spin) q.multiply(q2.setFromAxisAngle(up, it.spin));
      if (typeof it.scale === 'number') s.setScalar(it.scale); else s.copy(it.scale);
      m.compose(it.pos, q, s); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** Sample an ellipse-of-revolution style ring: points around an ellipse in a plane. */
export function ellipseLoop(cx, cy, rx, ry, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return pts;
}
