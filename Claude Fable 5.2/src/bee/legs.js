// ─────────────────────────────────────────────────────────────────────────────
// bee/legs.js — LEGS
// Six legs: coxa · trochanter · femur · tibia · basitarsus · tarsomeres ·
// pretarsal claws, every articulation a real pin joint. A leg is posed by seven
// angles (yaw of its plane + six in-plane link angles); standing uses analytic
// IK to a foot target, flight uses forward kinematics, and the two blend in
// angle space so link lengths never stretch. Hind tibiae carry the corbicula.
// Built for the LEFT side (+X outward); the right side is a mirrored group.
//
// Construction: every segment is a cast porcelain sleeve (superelliptic loft
// with chamfered ends, two engraved panel grooves and a gilt inlay line on its
// flanks) held between turned gilt ferrules with set screws. Each articulation
// is a clevis: the proximal link ends in a yoke with two cheeks, the distal
// link starts in a tongue, and a pin with a socket-head screw on one side and
// a hex nut on the other runs through all three along the hinge axis (local X).
// Link frame: origin at the proximal joint, +Z along the link, X = pin axis,
// +Y dorsal. Geometry stays inside each link's span so neighbours only meet in
// their clevis, whatever the pose.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, plain, orient, shell, tube, merge, xf, aim, ballJoint, bushing, screwGeo, rivetGeo, hexPrism, revolve } from './kit.js';
import { mesh } from './materials.js';
import { clamp, lerp, smoothstep, DEG } from '../core/math.js';

// link lengths: coxa, trochanter, femur, tibia, basitarsus, tarsus (cm)
export const LEG_TYPES = {
  fore: { part: 'forelegs', L: [0.5, 0.2, 1.45, 1.3, 0.78, 0.74], foot: V3(3.25, -2.5, 3.55), at: 0.02,
          fly: { yaw: 72, c: -48, t: -20, f: 14, ti: -152, b: -118, ta: -96 }, exDir: [0.55, -0.7, 0.45] },   // tucked under the chin
  mid:  { part: 'midlegs',  L: [0.48, 0.2, 1.65, 1.55, 0.92, 0.8], foot: V3(4.85, -2.5, 0.35), at: 0.04,
          fly: { yaw: -48, c: -58, t: -36, f: -24, ti: -124, b: -98, ta: -70 }, exDir: [0.8, -0.6, 0] },      // folded, trailing
  hind: { part: 'hindlegs', L: [0.55, 0.24, 2.0, 2.2, 1.15, 0.86], foot: V3(4.35, -2.5, -4.95), at: 0.06,
          fly: { yaw: -80, c: -64, t: -44, f: -30, ti: -62, b: -72, ta: -52 }, exDir: [0.55, -0.7, -0.45] }, // long, low, streaming behind
};
const KEYS = ['yaw', 'c', 't', 'f', 'ti', 'b', 'ta'];
export const toRad = (a) => Object.fromEntries(KEYS.map((k) => [k, a[k] * DEG]));
export const mixAngles = (out, a, b, t) => { for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; };
export const copyAngles = (out, a) => { for (const k of KEYS) out[k] = a[k]; return out; };

const TAU = Math.PI * 2;

// Joint radii (cheek disc radius) for joints 1…6: coxa|troch, troch|femur, knee, tibia|basitarsus, basitarsus|tarsus, tarsus|pretarsus.
const JR = {
  fore: [0.074, 0.074, 0.088, 0.068, 0.048, 0.034],
  mid:  [0.076, 0.076, 0.092, 0.07, 0.048, 0.034],
  hind: [0.082, 0.082, 0.104, 0.084, 0.054, 0.036],
};
const SCALE = { fore: 1, mid: 1.03, hind: 1.1 };
/** Clevis proportions from the cheek radius: tongue half-thickness g, side clearance c, cheek thickness t, fork half-width fw, tongue radius rt. */
const joint = (R) => ({ R, g: R * 0.36, c: R * 0.05, t: R * 0.32, fw: R * 0.73, rt: R * 0.8 });

// ── local machine shop ───────────────────────────────────────────────────────

/**
 * Closed loft through superelliptic stations { z, w, h, hb, n, dy }: w = half-width (X), h / hb = dorsal /
 * ventral half-height (Y), n = squareness (2 = ellipse). Stations of zero size close the ends. Sharp
 * steps between stations (chamfers, grooves) keep crisp creased normals.
 */
function loft(st, { seg = 14, crease = 0.62 } = {}) {
  const pos = [], idx = [], row = seg + 1;
  for (const s of st) {
    const e = 2 / (s.n ?? 2), w = Math.max(s.w, 1e-4), h = Math.max(s.h ?? s.w, 1e-4), hb = Math.max(s.hb ?? s.h ?? s.w, 1e-4);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU, c = Math.cos(a), sn = Math.sin(a);
      pos.push(w * Math.sign(c) * Math.abs(c) ** e + (s.dx ?? 0), (sn >= 0 ? h : hb) * Math.sign(sn) * Math.abs(sn) ** e + (s.dy ?? 0), s.z);
    }
  }
  for (let j = 0; j < st.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g = g.toNonIndexed();
  orient(g, V3(0, st[0].dy ?? 0, (st[0].z + st[st.length - 1].z) / 2));
  return plain(toCreasedNormals(g, crease));
}
const grow = (s, d) => ({ ...s, w: s.w + d, h: (s.h ?? s.w) + d, hb: (s.hb ?? s.h ?? s.w) + d });
const at = (s, z) => ({ ...s, z });
const closeAt = (s, z) => ({ ...s, z, w: 0, h: 0, hb: 0 });
const mix = (a, b, t) => ({ ...b, w: lerp(a.w, b.w, t), h: lerp(a.h ?? a.w, b.h ?? b.w, t), hb: lerp(a.hb ?? a.h ?? a.w, b.hb ?? b.h ?? b.w, t), n: lerp(a.n ?? 2, b.n ?? 2, t), dy: lerp(a.dy ?? 0, b.dy ?? 0, t) });

/** Porcelain sleeve stations between zA and zB: chamfered ends and V-section panel grooves at fractions `grooves`. */
function sleeve(zA, zB, sec, { grooves = [0.1, 0.9], extraZ = [], n = 15 } = {}) {
  const len = zB - zA, ch = Math.min(0.012, len * 0.08), gd = 0.0085, gw = 0.0055;
  const S = (z, d = 0) => ({ ...grow(sec(clamp((z - zA) / len), z), -d), z });
  const gz = grooves.map((t) => zA + t * len);
  const ent = [];
  for (let i = 0; i <= n; i++) ent.push({ z: lerp(zA + ch, zB - ch, i / n), d: 0 });
  for (const z of extraZ) if (z > zA + ch && z < zB - ch) ent.push({ z, d: 0 });
  const keep = ent.filter((e) => !gz.some((g) => Math.abs(e.z - g) < gw * 1.6));
  for (const g of gz) keep.push({ z: g - gw, d: 0 }, { z: g, d: gd }, { z: g + gw, d: 0 });
  keep.sort((a, b) => a.z - b.z);
  return [closeAt(S(zA), zA), S(zA, ch), ...keep.map((e) => S(e.z, e.d)), S(zB, ch), closeAt(S(zB), zB)];
}

/** Turned gilt ferrule band hugging a section. */
function ferrule(z0, z1, s, d = 0.011, c = 0.0055) {
  return loft([closeAt(s, z0), at(grow(s, d - c), z0), at(grow(s, d), z0 + c), at(grow(s, d), z1 - c), at(grow(s, d - c), z1), closeAt(s, z1)], { seg: 12, crease: 0.72 });   // smooth round, crisp 45° chamfers
}

/** Closed turned transition (end cap) between two sections, chamfered on both faces. */
function capLoft(za, sa, zb, sb, { seg = 12, c = 0.005 } = {}) {
  const dir = Math.sign(zb - za);
  return loft([closeAt(sa, za), at(grow(sa, -c), za), at(sa, za + dir * c), at(mix(sa, sb, 0.62), lerp(za, zb, 0.45)), at(sb, zb - dir * c), at(grow(sb, -c), zb), closeAt(sb, zb)], { seg, crease: 0.72 });
}

const arc = (cz, cy, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; };

/** A flat lug: outline in the link's (z, y) plane, thickness along X (centred), chamfered all round. */
function lugX(pts, thick, bevel = 0.005) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const b = Math.min(bevel, thick * 0.28);
  let g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, thick - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -(thick - 2 * b) / 2);
  g.rotateY(-Math.PI / 2);                       // shape x → link Z, extrusion → link X
  return plain(toCreasedNormals(plain(g), 0.6));
}
const PERM = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
/** A flat plate: outline in the link's (z, x) plane, thickness along Y, rounded edges (tarsomeres). */
function plateY(pts, thick, bevel) {
  const shape = new THREE.Shape(pts.map(([z, x]) => new THREE.Vector2(z, x)));
  const b = Math.min(bevel, thick * 0.32);
  let g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, thick - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(thick - 2 * b) / 2);
  g.applyMatrix4(PERM);                          // shape x → Z, shape y → X, extrusion → Y
  return plain(toCreasedNormals(plain(g), 0.7));
}

// ── clevis hardware ──────────────────────────────────────────────────────────

/** Tongue on the proximal end of a link: a disc around the pin running into the end cap at zt. */
function tongue(J, zt) {
  return lugX([[zt, J.rt * 0.8], ...arc(0, 0, J.rt, Math.PI / 2, Math.PI * 1.5, 9), [zt, -J.rt * 0.8]], J.g * 2, J.R * 0.07);
}
/** Yoke cheeks + pin + socket-head screw (+X) + hex nut (−X) at joint z = zj; the cheeks run back to zb. */
function fork(J, zj, zb, hb) {
  const out = [];
  const pts = [[zb, -hb], [zj - J.R * 0.25, -J.R], ...arc(zj, 0, J.R, -Math.PI / 2, Math.PI / 2, 9), [zj - J.R * 0.25, J.R], [zb, hb]];
  for (const s of [1, -1]) out.push(xf(lugX(pts, J.t, J.R * 0.08), { p: [s * (J.g + J.c + J.t / 2), 0, 0] }));
  out.push(xf(bushing(J.R * 0.3, (J.fw + 0.008) * 2, { segments: 10 }), { r: [0, 0, Math.PI / 2], p: [0, 0, zj] }));
  out.push(xf(screwGeo(J.R * 0.52, 10), { r: [0, 0, -Math.PI / 2], p: [J.fw - 0.001, 0, zj] }));
  out.push(xf(hexPrism(J.R * 0.44, J.R * 0.3, { chamfer: 0.2 }), { r: [0, 0, Math.PI / 2], p: [-(J.fw + J.R * 0.14), 0, zj] }));
  return out;
}
/** Set screws on a ferrule's flanks (±X). */
function setScrews(z, s, sides = [1, -1], r = 0.012) {
  return sides.map((sd) => xf(screwGeo(r, 7), { r: [0, 0, -sd * Math.PI / 2], p: [sd * (s.w + 0.0095), s.dy ?? 0, z] }));
}
/** Gilt inlay line along a sleeve's flank. */
function inlay(zA, zB, sec, side, t0 = 0.15, t1 = 0.85) {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = lerp(t0, t1, i / 8), z = lerp(zA, zB, t), s = sec(t, z); pts.push(V3(side * (s.w + 0.001), s.dy ?? 0, z)); }
  return tube(pts, 0.0058, { tubular: 12, radial: 4 });
}

// ── segment shapes (cross-section as a function of t ∈ [0,1] along the sleeve) ─

function sections(type) {
  const k = SCALE[type], hind = type === 'hind', fore = type === 'fore';
  return {
    coxa: (t) => { const r = lerp(0.212, 0.15, t ** 0.85) * k; return { w: r, h: r, hb: r * 1.02, n: 2.15 }; },
    femur: (t) => {
      const r = (0.082 + 0.046 * Math.sin(Math.PI * t ** 0.78)) * k;
      return hind ? { w: r * 0.88, h: r * 1.13, hb: r * 1.13, n: 2.15 } : { w: r * 0.95, h: r * 1.04, hb: r * 1.04, n: 2.1 };
    },
    tibia: hind
      ? (t) => ({ w: lerp(0.066, 0.084, t), h: lerp(0.078, 0.255, smoothstep(0, 0.92, t)), hb: lerp(0.078, 0.235, smoothstep(0, 0.92, t)), n: 2.7, dy: lerp(0, 0.014, t) })
      : (t) => { const r = (fore ? 0.06 + 0.042 * t ** 1.5 : 0.062 + 0.036 * t ** 1.3) * k; return { w: r * 0.96, h: r * 1.05, hb: r * 1.05, n: 2.15 }; },
    basi: hind
      ? (t) => ({ w: 0.054, h: lerp(0.158, 0.13, t), hb: lerp(0.15, 0.125, t), n: 3.3, dy: 0.008 })
      : (t) => { const h = lerp(0.07, 0.056, t) * k; return { w: 0.05 * k, h, hb: h, n: 2.5 }; },
  };
}

// ── one link's geometry ──────────────────────────────────────────────────────

function linkGeometry(kind, type) {
  const def = LEG_TYPES[type], L = def.L, J = JR[type].map(joint), k = SCALE[type];
  const hind = type === 'hind', fore = type === 'fore', mid = type === 'mid';
  const SEC = sections(type);
  const B = [], M = [];
  let corb = null;

  /** Standard segment i: tongue + cap + ferrule … sleeve … ferrule + cap + yoke. */
  const segment = (i, sec, o = {}) => {
    const Jp = J[i - 1], Jd = J[i], Li = L[i];
    const zN = Jp.R + 0.018, zA = zN + (o.capLen ?? 0.05), zY = Li - Jd.R - 0.014, zB = zY - (o.capLenD ?? 0.055);
    const S = (t) => sec(t, lerp(zA, zB, t));
    const sA = S(0), sB = S(1);
    B.push(loft(sleeve(zA, zB, sec, o), { seg: 12 }));
    // proximal: tongue, turned cap, ferrule
    M.push(tongue(Jp, zN + 0.012));
    M.push(capLoft(zN, { w: Jp.g * 1.75, h: Jp.rt * 1.02, hb: Jp.rt * 1.02, n: 2.6 }, zA + 0.004, grow(sA, -0.002)));
    M.push(ferrule(zA - 0.012, zA + 0.03, sA));
    // distal: ferrule, cap, yoke
    M.push(ferrule(zB - 0.03, zB + 0.012, sB));
    M.push(capLoft(zB - 0.004, grow(sB, -0.002), zY, { w: Jd.fw + 0.003, h: Jd.R, hb: Jd.R, n: 2.6 }));
    M.push(...fork(Jd, Li, zY - 0.024, Jd.R * 0.98));
    M.push(...setScrews(zA + 0.009, sA, o.screwsA ?? [1]), ...setScrews(zB - 0.009, sB, o.screwsB ?? [-1]));   // set screws 180° apart
    for (const sd of o.inlay ?? [1, -1]) M.push(inlay(zA, zB, sec, sd));
    return { zN, zA, zB, zY, sA, sB };
  };

  switch (kind) {
    case 'coxa': {
      // stout cone on a ball seated in the sternal socket
      const Jd = J[0], Lc = L[0], zY = Lc - Jd.R - 0.014, zA = 0.15 * k, zB = zY - 0.045;
      const sec = SEC.coxa, sA = sec(0), sB = sec(1);
      B.push(loft(sleeve(zA, zB, sec, { grooves: [0.5], n: 8 }), { seg: 18 }));
      M.push(ballJoint(0.152 * k, { segments: 16 }));
      M.push(capLoft(0.062 * k, { w: 0.128 * k, h: 0.128 * k, hb: 0.128 * k, n: 2 }, zA + 0.004, grow(sA, -0.002), { seg: 16 }));
      M.push(ferrule(zA - 0.012, zA + 0.034, sA, 0.012));
      M.push(ferrule(zB - 0.03, zB + 0.012, sB));
      M.push(capLoft(zB - 0.004, grow(sB, -0.002), zY, { w: Jd.fw + 0.003, h: Jd.R, hb: Jd.R, n: 2.6 }));
      M.push(...fork(Jd, Lc, zY - 0.024, Jd.R * 0.98));
      M.push(...setScrews(zA + 0.011, sA, [1, -1], 0.0125), ...setScrews(zB - 0.009, sB, [-1]));
      for (const sd of [1, -1]) M.push(inlay(zA, zB, sec, sd, 0.2, 0.8));
      break;
    }
    case 'troch': {
      // small double-clevis knuckle: tongue in the coxa's yoke, its own yoke for the femur
      const Jp = J[0], Jd = J[1], Lt = L[1];
      const zN = Jp.R + 0.016, zY = Lt - Jd.R - 0.014;
      const blk = { w: Math.max(Jp.g * 1.75, Jd.fw + 0.006), h: Math.max(Jp.rt, Jd.R) * 1.06, n: 2.8 };
      blk.hb = blk.h;
      M.push(tongue(Jp, zN + 0.01));
      B.push(capLoft(zN - 0.002, grow(blk, 0.004), zY + 0.004, grow(blk, 0.004), { c: 0.006, seg: 16 }));   // porcelain knuckle
      M.push(ferrule(zN - 0.006, zN + 0.008, blk, 0.008, 0.003), ferrule(zY - 0.004, zY + 0.01, blk, 0.008, 0.003));
      M.push(...fork(Jd, Lt, zY - 0.02, Jd.R * 0.98));
      break;
    }
    case 'femur': {
      segment(2, SEC.femur, { grooves: [0.08, 0.92] });
      break;
    }
    case 'tibia': {
      const s = segment(3, SEC.tibia, hind ? { grooves: [0.07, 0.95], inlay: [1], capLenD: 0.05 } : { grooves: [0.09, 0.9] });
      const Lt = L[3], Jd = J[3];
      if (fore) {
        // fibula (velum): a hinged spur under the tibio-tarsal joint that closes the antenna-cleaner notch
        const hz = Lt - 0.03, hy = -(Jd.R + 0.03), al = 0.06;
        const flap = [[0, 0.017], [0.09, 0.016], [0.18, 0.012], [0.245, 0.006], [0.268, -0.004], [0.262, -0.014], [0.23, -0.02], [0.12, -0.021], [0.03, -0.019], ...arc(0, 0, 0.017, -Math.PI / 2, -Math.PI * 1.5, 6)];
        M.push(lugX(flap.map(([s, q]) => [hz + s * Math.cos(al) - q * Math.sin(al), hy + s * Math.sin(al) + q * Math.cos(al)]), 0.02, 0.004));
        const br = [[hz - 0.05, -Jd.R * 0.6], [hz + 0.012, -Jd.R * 0.6], ...arc(hz, hy, 0.015, 0, -Math.PI, 6)];
        for (const sd of [1, -1]) M.push(xf(lugX(br, 0.008, 0.0025), { p: [sd * 0.0155, 0, 0] }));
        M.push(xf(bushing(0.006, 0.044, { segments: 8 }), { r: [0, 0, Math.PI / 2], p: [0, hy, hz] }));
        for (const sd of [1, -1]) M.push(xf(rivetGeo(0.0085, 8), { r: [0, 0, -sd * Math.PI / 2], p: [sd * 0.0195, hy, hz] }));
      }
      if (mid) {
        // the mid tibia's distal spur
        const base = V3(0, -(s.sB.hb + 0.006), s.zB - 0.012), dir = V3(0, -0.36, 1).normalize();
        M.push(aim(revolve([[0, 0], [0.017, 0], [0.016, 0.03], [0.011, 0.12], [0.005, 0.2], [0, 0.245]], { segments: 10, crease: 0.9 }), dir, base));
        M.push(aim(bushing(0.022, 0.018, { segments: 10 }), dir, base.clone().addScaledVector(dir, 0.006)));
      }
      if (hind) {
        // rastellum: a comb of stiff spines across the truncated distal end, on the inner face
        for (let i = 0; i < 11; i++) {
          const y = (s.sB.dy ?? 0) + lerp(-0.8 * s.sB.hb, 0.8 * s.sB.h, i / 10);
          const base = V3(s.sB.w * 0.97, y, s.zB + 0.006);
          M.push(aim(revolve([[0, 0], [0.0068, 0], [0.005, 0.03], [0, 0.07]], { segments: 6, crease: 0.9 }), V3(-0.14, -(y - (s.sB.dy ?? 0)) * 0.3, 1).normalize(), base));
        }
        corb = corbiculaGeometry(s.zA, s.zB, SEC.tibia);
      }
      break;
    }
    case 'basi': {
      if (fore) {
        // antenna cleaner: a semicircular notch in the ventral margin, lined with a fine comb
        const Jp = J[3], zA = Jp.R + 0.018 + 0.05, zc = zA + 0.074, rn = 0.042;
        const base = SEC.basi;
        const sec = (t, z) => { const s = base(t); const d = z - zc; if (Math.abs(d) < rn) s.hb = Math.max(0.012, s.hb - Math.sqrt(rn * rn - d * d)); return s; };
        const extraZ = []; for (let j = 0; j <= 14; j++) extraZ.push(zc + rn * Math.cos((j / 14) * Math.PI));
        const s = segment(4, sec, { grooves: [0.42, 0.9], extraZ, inlay: [] });
        for (const sd of [1, -1]) M.push(inlay(s.zA, s.zB, sec, sd, 0.36, 0.86));
        const hAt = base((zc - s.zA) / (s.zB - s.zA)).hb;
        const lip = []; for (let j = 0; j <= 12; j++) { const p = (j / 12) * Math.PI; lip.push([zc + rn * Math.cos(p), -hAt + rn * Math.sin(p)]); }
        for (const sd of [1, -1]) M.push(tube(lip.map(([z, y]) => V3(sd * 0.043 * k, y, z)), 0.0065, { tubular: 18, radial: 4 }));
        for (let j = 1; j < 12; j++) {
          const p = (j / 12) * Math.PI, pos = V3(0, -hAt + (rn - 0.002) * Math.sin(p), zc + (rn - 0.002) * Math.cos(p));
          M.push(aim(revolve([[0, 0], [0.0045, 0], [0, 0.02]], { segments: 5, crease: 1 }), V3(0, -Math.sin(p), -Math.cos(p)), pos));
        }
      } else if (hind) {
        // broad flat basitarsus: pollen-brush rows engraved on the inner face, auricle at the press
        const sec = SEC.basi;
        const s = segment(4, sec, { grooves: [0.06, 0.94], inlay: [-1], capLen: 0.055 });
        for (let r = 0; r < 17; r++) {
          const z0 = lerp(s.zA + 0.07, s.zB - 0.06, r / 16), pts = [];
          for (let j = 0; j <= 6; j++) {
            const q = lerp(-0.84, 0.84, j / 6), ss = sec((z0 - s.zA) / (s.zB - s.zA)), hh = q > 0 ? ss.h : ss.hb;
            const x = ss.w * Math.pow(Math.max(0, 1 - Math.abs(q) ** ss.n), 1 / ss.n) + 0.0012;
            pts.push(V3(x, (ss.dy ?? 0) + q * hh, z0 + q * 0.035));
          }
          M.push(tube(pts, 0.0036, { tubular: 8, radial: 3 }));
        }
        // auricle: a dished ear plate on the outer face at the proximal end
        const za = s.zA + 0.035, ear = [[za, 0.04], [za + 0.05, 0.075], [za + 0.13, 0.07], [za + 0.17, 0.02], [za + 0.15, -0.05], [za + 0.07, -0.08], [za + 0.01, -0.05]];
        M.push(xf(lugX(ear, 0.014, 0.004), { p: [-(sec(0.05).w + 0.004), sec(0).dy ?? 0, 0] }));
        M.push(xf(rivetGeo(0.011, 8), { r: [0, 0, Math.PI / 2], p: [-(sec(0.05).w + 0.011), 0, za + 0.08] }));
      } else {
        segment(4, SEC.basi, { grooves: [0.1, 0.9] });
      }
      break;
    }
    case 'tarsus': {
      // four heart-shaped tarsomeres; each one's lobes are the clevis cheeks for the next one's stalk
      const Lt = L[5], l = Lt / 4, Jp = J[4], Jd = J[5];
      const stalk = [Jp.g, Jp.g * 0.94, Jp.g * 0.88, Jp.g * 0.82, Jd.g];
      for (let i = 0; i < 4; i++) {
        const a = i * l, b = (i + 1) * l, s = stalk[i], last = i === 3;
        const W = lerp(0.064, 0.047, i / 3) * k, T = lerp(0.06, 0.05, i / 3) * k;
        const nW = last ? Jd.g + Jd.c : stalk[i + 1] + 0.004, nd = last ? Jd.rt + 0.006 : stalk[i + 1] + 0.008;
        B.push(plateY(heartPts(a, b, s, W, nW, nd), T, T * 0.3));
        // pin through both lobes and the next stalk, domed heads both sides
        M.push(xf(bushing(last ? Jd.R * 0.28 : 0.0085, 2 * W + 0.004, { segments: 8 }), { r: [0, 0, Math.PI / 2], p: [0, 0, b] }));
        for (const sd of [1, -1]) M.push(xf(rivetGeo(last ? 0.0145 : 0.012, 7), { r: [0, 0, -sd * Math.PI / 2], p: [sd * (W - 0.001), 0, b] }));
      }
      break;
    }
    case 'claws': {
      // pretarsus: unguitractor tongue, a small block, two cleft claws and the arolium pad
      const Jp = J[5];
      M.push(tongue(Jp, 0.044));
      M.push(capLoft(0.034, { w: Jp.g * 1.7, h: Jp.rt * 0.95, hb: Jp.rt * 0.95, n: 2.5 }, 0.082, { w: 0.022, h: 0.018, hb: 0.022, n: 2.5 }, { seg: 12, c: 0.004 }));
      for (const s of [1, -1]) {
        M.push(tube([V3(s * 0.012, 0.004, 0.064), V3(s * 0.036, 0.012, 0.1), V3(s * 0.056, -0.004, 0.142), V3(s * 0.064, -0.04, 0.17), V3(s * 0.062, -0.068, 0.174)], (u) => 0.0135 * (1 - u * 0.8), { tubular: 11, radial: 6 }));
        M.push(tube([V3(s * 0.052, -0.006, 0.138), V3(s * 0.05, -0.03, 0.15), V3(s * 0.046, -0.052, 0.148)], (u) => 0.0068 * (1 - u * 0.7), { tubular: 6, radial: 5 }));   // the cleft: an inner tooth
      }
      M.push(tube([V3(0, -0.008, 0.07), V3(0, -0.03, 0.095), V3(0, -0.042, 0.112)], 0.0075, { tubular: 6, radial: 6 }));
      // arolium: a soft two-lobed cushion on a gilt stem, the part that actually meets the plinth
      for (const s of [1, -1]) B.push(xf(revolve([[0, -0.013], [0.016, -0.0125], [0.023, -0.007], [0.025, 0.0], [0.021, 0.008], [0.012, 0.0125], [0, 0.014]], { segments: 12, crease: 1.2 }), { s: [1, 1, 1.25], r: [-0.2, 0, 0], p: [s * 0.016, -0.052, 0.124] }));
      M.push(xf(revolve([[0, -0.006], [0.013, -0.006], [0.016, 0], [0.013, 0.006], [0, 0.006]], { segments: 10 }), { r: [-0.2, 0, 0], p: [0, -0.041, 0.112] }));
      break;
    }
  }
  return { body: B.length ? merge(B) : null, metal: M.length ? merge(M) : null, corb };
}

/** Heart-shaped tarsomere planform in (z, x): rounded stalk at a, two lobes around the next pin at b, notch between them. */
function heartPts(a, b, s, W, nW, nd) {
  const l = b - a, rl = (W - nW) / 2, xl = nW + rl, R = [];
  for (let i = 0; i <= 3; i++) { const th = Math.PI - (i / 3) * (Math.PI / 2); R.push([a + s * Math.cos(th), s * Math.sin(th)]); }
  for (let i = 1; i <= 5; i++) { const t = i / 5; R.push([lerp(a + 0.1 * l, b, t), s + (W - s) * Math.sin((t * Math.PI) / 2) ** 1.3]); }
  for (let i = 1; i <= 5; i++) { const ph = (i / 5) * Math.PI; R.push([b + rl * Math.sin(ph), xl + rl * Math.cos(ph)]); }
  R.push([b - nd + 0.004, nW], [b - nd, nW - 0.004], [b - nd, 0]);
  const back = R.slice(1, -1).reverse().map(([z, x]) => [z, -x]);
  return [...R, ...back];
}

/**
 * The pollen basket on the outer (−X) face of the hind tibia: a polished, slightly dished plate in a
 * brushed frame, fenced by long filaments that rise from both margins and arch inward over it.
 */
function corbiculaGeometry(zA, zB, sec) {
  const z0 = lerp(zA, zB, 0.22), z1 = lerp(zA, zB, 0.94), len = zB - zA;
  const S = (z) => sec(clamp((z - zA) / len), z);
  const half = (v) => 0.76 * S(lerp(z0, z1, v)).h * Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 10));
  const face = (z, yr) => { const s = S(z), hh = yr > 0 ? s.h : s.hb, q = Math.min(0.995, Math.abs(yr) / hh); return -s.w * Math.pow(1 - q ** s.n, 1 / s.n); };
  const P = (u, v, o) => {
    const z = lerp(z0, z1, v), hw = half(v), yr = (u - 0.5) * 2 * hw, s = S(z);
    const dish = 0.03 * (1 - (2 * u - 1) ** 2) * Math.sin(Math.PI * v) ** 0.7;
    return o.set(face(z, yr) - 0.038 + dish, (s.dy ?? 0) + yr, z);
  };
  const dish = shell(P, { nu: 10, nv: 18, thickness: 0.012, flipN: true });
  const loop = [];
  for (let i = 0; i <= 18; i++) loop.push(P(0, i / 18, V3()));
  for (let i = 17; i >= 1; i--) loop.push(P(1, i / 18, V3()));
  const frame = tube(loop.map((p) => p.add(V3(-0.002, 0, 0))), 0.0105, { tubular: 60, radial: 5, closed: true });
  // fence: long filaments stand up from both margins, lean distally and arch inward over the plate
  const hairs = [], hwMax = half(0.5), N = 12;
  for (const side of [-1, 1]) for (let i = 0; i < N; i++) {
    const v = lerp(0.1, 0.92, (i + (side > 0 ? 0.5 : 0)) / N), hw = half(v), root = P(side > 0 ? 1 : 0, v, V3());
    const z = root.z, cy = S(z).dy ?? 0, yr = root.y - cy, x = root.x, g = 0.55 + 0.45 * hw / hwMax;
    hairs.push(tube([
      root.clone().add(V3(0.004, 0, 0)),
      V3(x - 0.1 * g, cy + yr * 1.12, z + 0.012),
      V3(x - 0.22 * g, cy + yr * 0.98, z + 0.035),
      V3(x - 0.29 * g, cy + yr * 0.62, z + 0.06),
      V3(x - 0.3 * g, cy + yr * 0.3, z + 0.08),
    ], (u) => 0.0082 * (1 - u * 0.7), { tubular: 9, radial: 4 }));
  }
  return { dish, frame, hairs: merge(hairs) };
}

export function buildLegs({ mats, ex }, coxae) {
  const sides = [new THREE.Group(), new THREE.Group()];
  sides[0].name = 'legsL'; sides[1].name = 'legsR'; sides[1].scale.x = -1;
  const legs = [];
  const geoCache = {};
  const order = ['coxa', 'troch', 'femur', 'tibia', 'basi', 'tarsus', 'claws'];

  for (const type of ['fore', 'mid', 'hind']) {
    const def = LEG_TYPES[type], hip = coxae.find((c) => c.name === type).pos;
    geoCache[type] = order.map((kind) => linkGeometry(kind, type));
    const corb = geoCache[type][3].corb;
    const body = mats.get('body', def.part, { cap: true }), metal = mats.get('metal', def.part, { cap: true });
    for (let s = 0; s < 2; s++) {
      const root = ex.node(def.part, { dir: def.exDir, dist: 2.7, at: 0.19, name: `ex:${type}${s}` });
      root.position.copy(hip); sides[s].add(root);
      const links = order.map((kind, i) => {
        const g = new THREE.Group(); g.name = `${type}:${kind}`; root.add(g);
        const geo = geoCache[type][i];
        if (geo.body) g.add(mesh(geo.body, body, def.part));
        if (geo.metal) g.add(mesh(geo.metal, metal, def.part));
        return g;
      });
      let corbNode = null;
      if (corb) {
        corbNode = ex.node('corbicula', { dir: [-1, 0, 0], dist: 1.5, at: 0.1 });
        corbNode.add(
          mesh(corb.dish, mats.get('metal', 'corbicula', { cap: true }), 'corbicula'),
          mesh(corb.frame, mats.get('satin', 'corbicula', { cap: true }), 'corbicula'),
          mesh(corb.hairs, mats.get('filament', 'corbicula'), 'corbicula', { cast: false }),
        );
        links[3].add(corbNode);
      }
      // separation channels: outermost links leave first
      const ch = [0.16, 0.145, 0.13, 0.11, 0.09, 0.07, 0.05].map((at) => ex.channel(def.part, at));
      legs.push({
        type, side: s, def, root, links, corbNode, channels: ch, hip: hip.clone(),
        foot: def.foot.clone(),                              // stance target relative to the thorax centre, left-side convention
        angles: toRad({ yaw: 0, c: 0, t: 0, f: 0, ti: 0, b: 0, ta: 0 }),
        rest: null, fly: toRad(def.fly), pts: Array.from({ length: 8 }, () => V3()),
      });
    }
  }

  const r = V3(), d = V3(), xAxis = V3(), yAxis = V3(), basis = new THREE.Matrix4();
  /**
   * Pose a leg from its angle set. Positions are relative to the leg root (the hip).
   * `gaps[i]` (cm) opens joint i for the exploded view.
   */
  function pose(leg, a, gapScale = 0) {
    const L = leg.def.L, cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    r.set(cy, 0, sy);                         // radial direction of the leg plane
    xAxis.set(sy, 0, -cy);                    // pin axis (plane normal); local +Y then points "dorsal"
    const ang = [a.c, a.t, a.f, a.ti, a.b, a.ta, a.ta - 0.12];
    const p = leg.pts[0].set(0, 0, 0);
    let prev = p;
    for (let i = 0; i < 7; i++) {
      const c = Math.cos(ang[i]), s = Math.sin(ang[i]);
      d.set(r.x * c, s, r.z * c);
      const link = leg.links[i];
      const gap = gapScale * leg.channels[i].k * (i === 0 ? 0 : 0.27 + i * 0.03);
      link.position.copy(prev).addScaledVector(d, gap);
      yAxis.crossVectors(d, xAxis);
      basis.makeBasis(xAxis, yAxis, d); link.quaternion.setFromRotationMatrix(basis);
      const next = leg.pts[i + 1];
      next.copy(link.position).addScaledVector(d, i < 6 ? L[i] : 0.2);
      prev = next;
    }
  }

  /**
   * Standing IK: angles that put the tarsus tip on `foot` (given relative to the hip, left-side convention).
   * Femur/tibia solve as a two-bone chain with the knee up; the tarsus lies along the ground.
   */
  function ik(leg, foot, out) {
    const L = leg.def.L;
    const dH = Math.hypot(foot.x, foot.z), hF = foot.y + 0.11;         // the claws curl down from the last joint: keep them on, not in, the surface
    out.yaw = Math.atan2(foot.z, foot.x);
    out.c = -56 * DEG; out.t = -18 * DEG;
    let px = L[0] * Math.cos(out.c) + L[1] * Math.cos(out.t), py = L[0] * Math.sin(out.c) + L[1] * Math.sin(out.t);
    out.ta = -5 * DEG; out.b = -40 * DEG;
    let ax = dH - L[5] * Math.cos(out.ta) - L[4] * Math.cos(out.b), ay = hF - L[5] * Math.sin(out.ta) - L[4] * Math.sin(out.b);
    let dx = ax - px, dy = ay - py, D = Math.hypot(dx, dy);
    const reach = L[2] + L[3];
    if (D > reach * 0.985) {                 // target too far: straighten the tarsus toward it and stretch
      const k = clamp((D - reach * 0.985) / 1.2);
      out.b = lerp(out.b, Math.atan2(hF - py, dH - px), k * 0.85); out.ta = lerp(out.ta, out.b, k * 0.8);
      ax = dH - L[5] * Math.cos(out.ta) - L[4] * Math.cos(out.b); ay = hF - L[5] * Math.sin(out.ta) - L[4] * Math.sin(out.b);
      dx = ax - px; dy = ay - py; D = Math.hypot(dx, dy);
    }
    D = clamp(D, Math.abs(L[2] - L[3]) + 0.05, reach * 0.995);
    const base = Math.atan2(dy, dx);
    const alpha = Math.acos(clamp((L[2] * L[2] + D * D - L[3] * L[3]) / (2 * L[2] * D), -1, 1));
    out.f = base + alpha;
    const kx = px + L[2] * Math.cos(out.f), ky = py + L[2] * Math.sin(out.f);
    out.ti = Math.atan2(py + Math.sin(base) * D - ky, px + Math.cos(base) * D - kx);
    return out;
  }

  // rest pose = IK with the body at its resting height
  for (const leg of legs) {
    leg.rest = ik(leg, V3().subVectors(leg.foot, leg.hip), toRad({ yaw: 0, c: 0, t: 0, f: 0, ti: 0, b: 0, ta: 0 }));
    copyAngles(leg.angles, leg.rest); pose(leg, leg.angles);
  }

  return { sides, legs, pose, ik, group: (() => { const g = new THREE.Group(); g.add(...sides); return g; })() };
}
