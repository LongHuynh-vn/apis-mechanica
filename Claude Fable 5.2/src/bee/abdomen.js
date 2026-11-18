// ─────────────────────────────────────────────────────────────────────────────
// bee/abdomen.js — ABDOMEN
// Petiole gimbal, six overlapping tergite rings that telescope as the abdomen
// breathes, the amber honeycomb reactor seen through hexagonal windows, and
// the sting assembly. Frame: origin at the petiole joint, axis runs toward -Z.
//
// The rings carry what a maker would put on them — a rolled, riveted gilt
// trailing edge, riveted lateral hems, a framed spiracle per segment, gilt
// sternite edges and the worker's paired wax mirrors underneath. The core is
// a closed honeycomb: radial cells all round an amber heart, so whichever
// window you look through, you look down a cell into honey.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { V3, shell, revolve, bushing, tube, rod, merge, xf, aim, ballJoint, screwGeo, plate, Scatter } from './kit.js';
import { mesh } from './materials.js';
import { lerp, TAU, clamp, smoothstep } from '../core/math.js';
import { globalUniforms } from '../core/gfx.js';

export const ABD = { len: 5.5, ex: 1.0, ey: 0.88, thetaT: 2.26, thetaS: 1.06 };

// radius along the axis (s = distance behind the petiole)
const PROFILE = [[0, 0.3], [0.3, 0.9], [0.9, 1.5], [1.7, 1.82], [2.5, 1.88], [3.3, 1.74], [4.1, 1.42], [4.8, 0.95], [5.3, 0.46], [5.5, 0.2]];
const TABLE = (() => {
  const c = new THREE.SplineCurve(PROFILE.map(([s, r]) => new THREE.Vector2(s, r)));
  return c.getPoints(240);
})();
export function abdRadius(s) {
  s = clamp(s, 0, ABD.len);
  let lo = 0, hi = TABLE.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (TABLE[m].x < s) lo = m; else hi = m; }
  const a = TABLE[lo], b = TABLE[hi];
  return lerp(a.y, b.y, clamp((s - a.x) / Math.max(1e-5, b.x - a.x)));
}
const sag = (s) => -0.013 * s * s;
/** Point on the abdomen envelope. theta: 0 = dorsal, toward +X. dr: radial offset. */
export function abdPoint(theta, s, out = V3(), k = 1, dr = 0) {
  const r = abdRadius(s) * k + dr;
  return out.set(r * ABD.ex * Math.sin(theta), r * ABD.ey * Math.cos(theta) + sag(s), -s);
}
/** Outward normal of the envelope surface (k, dr held fixed), by finite differences. */
function abdNormal(theta, s, k = 1, dr = 0, out = V3()) {
  const a = abdPoint(theta - 1e-3, s, V3(), k, dr), b = abdPoint(theta + 1e-3, s, V3(), k, dr);
  const c = abdPoint(theta, s - 1e-3, V3(), k, dr), d = abdPoint(theta, s + 1e-3, V3(), k, dr);
  return out.crossVectors(b.sub(a), d.sub(c)).normalize();
}

// UV that the unpainted plates (sternites, wax mirrors) share: an unpainted spot of the Delft band — clear of its
// border lines and motifs — and outside the hex-window zone, so they stay plain glaze in every theme.
const PLAIN_UV = [0.5, 0.14];

const RINGS = [[0.14, 1.16], [1.0, 2.1], [1.94, 3.04], [2.88, 3.94], [3.78, 4.74], [4.58, 5.44]];

/** Low domed rivet on y = 0 pointing +Y (cheap enough to run in rows). */
const smallRivet = (r) => revolve([[r * 1.1, 0], [r * 1.1, r * 0.14], [r * 0.72, r * 0.6], [0, r * 0.8]], { segments: 7, crease: 0.9 });

export function buildAbdomen({ mats, ex }) {
  const node = ex.node('petiole', { dir: [0, 0, -1], dist: 0.9, at: 0.47 });   // carries the petiole hardware only
  const swing = new THREE.Group(); swing.name = 'abdomen';                    // spring-driven swing about the waist
  const metalP = mats.get('metal', 'petiole'), satinP = mats.get('satin', 'petiole'), bodyP = mats.get('body', 'petiole');

  // ── petiole: a two-axis gimbal in the thoracic socket ─────────────────────
  // fixed yoke (pitch pins on X) → gimbal ring (turns with pitch) → trunnion hub + stalk (pitch + yaw)
  node.add(mesh(merge([
    xf(revolve([[0.25, 0.02], [0.33, 0.02], [0.335, 0.04], [0.335, 0.1], [0.32, 0.12], [0.25, 0.12], [0.25, 0.02]], { segments: 40 }), { r: [Math.PI / 2, 0, 0] }),   // collar in the socket bore
    ...[1, -1].map((sx) => {                                                     // fork cheeks
      const s = new THREE.Shape();
      s.moveTo(0.11, -0.13); s.lineTo(0.11, 0.13); s.lineTo(0, 0.075); s.absarc(0, 0, 0.075, Math.PI / 2, Math.PI * 1.5, false); s.lineTo(0.11, -0.13);
      s.holes.push(new THREE.Path().absarc(0, 0, 0.026, 0, TAU, true));
      return xf(plate(s, 0.04, { bevel: 0.009, curveSegments: 10 }), { r: [0, -Math.PI / 2, 0], p: [sx * 0.3, 0, 0] });
    }),
  ]), satinP, 'petiole'));
  node.add(mesh(merge([
    ...[1, -1].map((sx) => xf(bushing(0.026, 0.12, { segments: 12 }), { r: [0, 0, Math.PI / 2], p: [sx * 0.29, 0, 0] })),       // pitch pins
    ...[1, -1].map((sx) => aim(screwGeo(0.034, 12), V3(sx, 0, 0), V3(sx * 0.32, 0, 0))),
  ]), metalP, 'petiole'));
  const gimbal = new THREE.Group(); node.add(gimbal);
  gimbal.add(mesh(merge([
    xf(revolve([[0.19, -0.035], [0.235, -0.035], [0.245, -0.022], [0.245, 0.022], [0.235, 0.035], [0.19, 0.035], [0.182, 0.022], [0.182, -0.022], [0.19, -0.035]], { segments: 40 }), { r: [Math.PI / 2, 0, 0] }),
    ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => aim(bushing(0.04, 0.05, { bore: 0.0, segments: 14 }), V3(a, b, 0), V3(a * 0.235, b * 0.235, 0))),   // pivot bosses
  ]), metalP, 'petiole'));
  const stalk = new THREE.Group(); node.add(stalk);
  stalk.add(mesh(merge([
    ballJoint(0.1),
    xf(bushing(0.022, 0.42, { segments: 10 }), {}),                                                    // yaw pins (Y)
    xf(revolve([[0, 0.04], [0.07, 0.04], [0.075, 0.06], [0.06, 0.08], [0.06, 0.2], [0.085, 0.23], [0.085, 0.26], [0, 0.26]], { segments: 18 }), { r: [-Math.PI / 2, 0, 0] }),   // stalk
  ]), metalP, 'petiole'));
  stalk.add(mesh(xf(revolve([[0.08, 0.2], [0.17, 0.2], [0.26, 0.26], [0.33, 0.36], [0.37, 0.46], [0.33, 0.47], [0.08, 0.47], [0.08, 0.2]], { segments: 32 }), { r: [-Math.PI / 2, 0, 0] }), bodyP, 'petiole'));   // porcelain bell
  stalk.add(mesh(merge([
    xf(new THREE.TorusGeometry(0.355, 0.016, 6, 40), { p: [0, 0, -0.455] }),
    xf(new THREE.TorusGeometry(0.1, 0.014, 6, 24), { p: [0, 0, -0.205] }),
  ]), metalP, 'petiole'));

  // ── tergite + sternite rings ───────────────────────────────────────────────
  const rings = [];
  const windowMats = [];                    // windowed rings: drawn front-side only outside SECTION (see breathe)
  const band = mats.delftBand;
  const ringMetal = mats.get('metal', 'tergites', { cap: true });
  const rivetMat = mats.get('metal', 'tergites', { key: 'riv' });
  const rivet = smallRivet(1);
  RINGS.forEach(([s0, s1], i) => {
    const tNode = ex.node('tergites', { dir: [0, 0, -1], dist: 1.5 + i * 1.3, at: 0.41 - i * 0.03, name: `ex:tergite${i + 1}` });
    const slide = new THREE.Group(); tNode.add(slide); swing.add(tNode);
    const lip = (v) => lerp(-0.035, 0.04, v) + Math.sin(v * Math.PI) * 0.018;
    const sMid = (s0 + s1) / 2, arc = 2 * ABD.thetaT * abdRadius(sMid) * 0.94, axial = s1 - s0;
    const windowed = i >= 1 && i <= 3;
    const w = 0.37;                                                        // hexagon width, cm
    const bodyMat = mats.get('body', 'tergites', {
      cap: true, map: band, key: `t${i}`,
      hex: windowed ? { scale: [arc / w, axial / w], region: [1.12 / (2 * ABD.thetaT), 0.5, 0.56 / (2 * ABD.thetaT) + 0.02, 0.44], hole: 0.355, rim: 0.062 } : undefined,
    });
    const vOf = (s) => (s - s0) / (s1 - s0);
    const tergite = shell((u, v, o) => abdPoint(lerp(-ABD.thetaT, ABD.thetaT, u), lerp(s0, s1, v), o, 1, lip(v)), { nu: 88, nv: 16, thickness: 0.07 });
    const st0 = s0 + 0.05, st1 = Math.min(s1 + 0.05, ABD.len - 0.04);
    const stLip = (s) => lip(clamp((s - st0) / (st1 - st0))) * 0.6;
    const sternite = shell((u, v, o) => abdPoint(Math.PI + lerp(-ABD.thetaS, ABD.thetaS, u), lerp(st0, st1, v), o, 0.95, lip(v) * 0.6), { nu: 36, nv: 8, thickness: 0.06, uv: () => PLAIN_UV });
    const bodyParts = [tergite, sternite];
    // wax mirrors: the worker's paired, smooth oval plates on sternites 3–6
    if (i >= 2) for (const sg of [1, -1]) {
      const tc = Math.PI + sg * 0.42, sc = lerp(st0, st1, 0.55), rt = 0.3, rs = (st1 - st0) * 0.26;
      bodyParts.push(shell((u, v, o) => {
        const a = u * TAU, q = 1 - v * 0.999, th = tc + rt * q * Math.cos(a), s = sc + rs * q * Math.sin(a);
        return abdPoint(th, s, o, 0.95, stLip(s) + 0.016 * (0.35 + 0.65 * smoothstep(0, 0.3, v)));
      }, { nu: 28, nv: 2, thickness: 0.04, closedU: true, uv: () => PLAIN_UV }));
    }
    slide.add(mesh(merge(bodyParts), bodyMat, 'tergites'));
    if (windowed) windowMats.push(bodyMat);

    // gilt trailing rim, rolled bead on its very edge, lateral hems, sternite edge, spiracles
    const rim = shell((u, v, o) => abdPoint(lerp(-ABD.thetaT, ABD.thetaT, u), lerp(s1 - 0.085, s1 + 0.004, v), o, 1, lip(lerp(0.92, 1, v)) + 0.014), { nu: 88, nv: 2, thickness: 0.03 });
    const trim = [rim];
    { const pts = []; for (let k = 0; k <= 30; k++) pts.push(abdPoint(lerp(-ABD.thetaT, ABD.thetaT, k / 30), s1 - 0.004, V3(), 1, lip(1) + 0.004)); trim.push(tube(pts, 0.017, { tubular: 60, radial: 5 })); }
    for (const sg of [1, -1]) {
      const pts = []; for (let k = 0; k <= 6; k++) pts.push(abdPoint(sg * ABD.thetaT, lerp(s0 + 0.03, s1 - 0.02, k / 6), V3(), 1, lip(k / 6) + 0.004));
      trim.push(tube(pts, 0.024, { tubular: 12, radial: 6 }));
    }
    if (i === 0) { const pts = []; for (let k = 0; k <= 8; k++) pts.push(abdPoint(0, lerp(s0 + 0.05, s1 - 0.1, k / 8), V3(), 1, lip(k / 8) + 0.004)); trim.push(tube(pts, 0.016, { tubular: 16, radial: 6 })); }
    trim.push(shell((u, v, o) => abdPoint(Math.PI + lerp(-ABD.thetaS, ABD.thetaS, u), lerp(st1 - 0.06, st1, v), o, 0.95, stLip(st1 - 0.03) + 0.01), { nu: 36, nv: 1, thickness: 0.025 }));
    // a framed, louvred spiracle on each flank, low on the exposed part of the ring (clear of the windows)
    const sSp = i === 0 ? lerp(s0, s1, 0.55) : (s0 + 0.16 + s1) / 2, vSp = vOf(sSp);
    for (const sg of [1, -1]) {
      const th = sg * 1.98, p = abdPoint(th, sSp, V3(), 1, lip(vSp)), n = abdNormal(th, sSp, 1, lip(vSp));
      const along = abdPoint(th, sSp + 0.01, V3(), 1, lip(vSp)).sub(p).normalize();
      const frame = revolve([[0.028, -0.01], [0.056, -0.01], [0.062, 0.006], [0.055, 0.016], [0.034, 0.014], [0.028, 0.004], [0.028, -0.01]], { segments: 20 });
      frame.scale(1, 1, 1.45);                                                // oval, long axis along the body
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), n);
      const zl = V3(0, 0, 1).applyQuaternion(q), spin = Math.atan2(V3().crossVectors(zl, along).dot(n), zl.dot(along));
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(n, spin));
      frame.applyQuaternion(q); frame.translate(p.x, p.y, p.z); trim.push(frame);
      for (const t of [-0.45, 0, 0.45]) {
        const c = p.clone().addScaledVector(n, 0.006).addScaledVector(V3().crossVectors(n, along), t * 0.03);
        trim.push(rod(c.clone().addScaledVector(along, -0.034), c.clone().addScaledVector(along, 0.034), 0.006, { radial: 5 }));
      }
    }
    if (i === RINGS.length - 1) {                    // sting chamber: a dished, screwed diaphragm with the stylet's guide bush
      const sd = 5.3, r = abdRadius(sd) - 0.075, yc = sag(sd);
      const dish = xf(revolve([[0.085, -0.03], [0.12, -0.03], [r * 0.7, -0.012], [r, 0.02], [r, 0.05], [r * 0.7, 0.02], [0.13, 0.0], [0.13, 0.03], [0.085, 0.03], [0.085, -0.03]], { segments: 32 }), { r: [-Math.PI / 2, 0, 0] });
      dish.scale(1, ABD.ey, 1); dish.translate(0, yc - 0.03, -sd); trim.push(dish);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.5; trim.push(aim(screwGeo(0.018, 8), V3(0, 0, -1), V3(Math.sin(a) * r * 0.62, yc - 0.03 + Math.cos(a) * r * 0.62 * ABD.ey, -sd - 0.016))); }
    }
    slide.add(mesh(merge(trim), ringMetal, 'tergites'));

    // rivet rows: along the rim and down each lateral hem
    const riv = new Scatter(), sR = s1 - 0.045, vR = lerp(0.92, 1, 0.5);
    const nRiv = Math.max(12, Math.round((2 * ABD.thetaT * abdRadius(sR)) / 0.2));
    for (let k = 0; k < nRiv; k++) {
      const th = lerp(-ABD.thetaT, ABD.thetaT, (k + 0.5) / nRiv);
      riv.add(abdPoint(th, sR, V3(), 1, lip(vR) + 0.014), abdNormal(th, sR, 1, lip(vR) + 0.014), 0.017);
    }
    for (const sg of [1, -1]) for (let k = 1; k <= 3; k++) {
      const s = lerp(s0 + 0.03, s1 - 0.12, k / 4), th = sg * (ABD.thetaT - 0.06);
      if (i > 0 && s < s0 + 0.18) continue;                                  // hidden under the ring in front
      riv.add(abdPoint(th, s, V3(), 1, lip(vOf(s))), abdNormal(th, s, 1, lip(vOf(s))), 0.016);
    }
    const rm = riv.build(rivet, rivetMat); rm.userData.partId = 'tergites'; rm.castShadow = false; slide.add(rm);
    rings.push({ node: tNode, slide, s0, s1 });
  });

  // ── amber core: a closed honeycomb in a glass vessel ───────────────────────
  const cNode = ex.node('core', { dir: [0, -0.5, -0.87], dist: 5.6, at: 0.44 });
  const coreC = V3(0, sag(2.55) - 0.02, -2.55);
  cNode.position.copy(coreC); swing.add(cNode);
  const flick = { value: 1 };
  const honey = mats.get('core', 'core', {
    key: 'honey',
    extend: (shader) => {
      shader.uniforms.uTime = globalUniforms.uTime; shader.uniforms.uFlick = flick;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vCell;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vCell = dot( instanceMatrix[3].xyz, vec3( 3.17, 7.31, 5.77 ) );
          #else
            vCell = 0.37;
          #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCell; uniform float uTime; uniform float uFlick;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { // slow, uneven honey glow: every cell breathes on its own
            float f = 0.5 + 0.5 * sin( uTime * 1.3 + vCell * 6.0 ) * sin( uTime * 0.47 + vCell * 2.3 );
            float g = 0.5 + 0.5 * sin( uTime * 7.3 + vCell * 11.0 );
            totalEmissiveRadiance *= ( 0.62 + 0.36 * f + 0.07 * g ) * uFlick;
          }`);
    },
  });
  // The comb is a closed capsule that follows the abdomen's own profile just inside the shells, its hexagonal
  // cells standing radially in rows round the axis (no pentagons needed): a ray through any window meets honey
  // at the same depth, never the shells' glazed inner skin. Core-local frame: origin on the axis at s = 2.55.
  const S0 = 0.86, S1 = 4.36, SM = (S0 + S1) / 2, HL = (S1 - S0) / 2;
  const taper = (s) => Math.pow(Math.max(0, 1 - Math.abs((s - SM) / HL) ** 5), 0.5);
  const Rv = (s) => abdRadius(s) * 0.86 * taper(s);                                   // the glass vessel
  const cp = (th, s, R, out = V3()) => out.set(R * Math.sin(th), R * ABD.ey * Math.cos(th) + sag(s) - coreC.y, -s - coreC.z);
  const depth = 0.34, pitch = 0.35, Rc = (s) => Rv(s) - 0.05;                         // cell mouths
  const cells = [];
  {
    let s = S0 + 0.12, row = 0;
    while (s < S1 - 0.1) {
      const R = Rc(s);
      if (R > 0.32) {
        const circ = (TAU * R * (1 + ABD.ey)) / 2, n = Math.max(5, Math.round(circ / pitch));
        for (let k = 0; k < n; k++) {
          const th = ((k + (row & 1) * 0.5) / n) * TAU;
          const dth = cp(th + 1e-3, s, R).sub(cp(th - 1e-3, s, R));
          const dss = cp(th, s + 1e-3, Rc(s + 1e-3)).sub(cp(th, s - 1e-3, Rc(s - 1e-3)));
          cells.push({ p: cp(th, s, R), n: V3().crossVectors(dth, dss).normalize(), t: dth.normalize(), s: Math.min(1.05, circ / n / pitch) });
        }
        row++;
      }
      const dR = (Rc(s + 0.01) - Rc(s - 0.01)) / 0.02;
      s += (pitch * 0.866) / Math.sqrt(1 + dR * dR);
    }
  }
  const cellR = (pitch / Math.sqrt(3)) * 0.985, wallIn = cellR * 0.82;
  // honey stands brim-full (faintly domed) so it reads from grazing angles too; the gilt walls are fine lines between
  const honeyGeo = revolve([[wallIn, -0.5], [wallIn, 0.53], [wallIn * 0.6, 0.555], [0, 0.565]], { segments: 6, crease: 0.4 });
  const wallGeo = revolve([[wallIn, 0.53], [cellR, 0.53], [cellR, -0.5]], { segments: 6, crease: 0.3 });
  const honeyIM = new THREE.InstancedMesh(honeyGeo, honey, cells.length), wallIM = new THREE.InstancedMesh(wallGeo, mats.get('metal', 'core', { key: 'comb' }), cells.length);
  {
    const m = new THREE.Matrix4(), z = V3(), sc = V3();
    cells.forEach((c, k) => {
      z.crossVectors(c.t, c.n);
      m.makeBasis(c.t, c.n, z).scale(sc.set(c.s, depth, 1)).setPosition(c.p.clone().addScaledVector(c.n, -depth / 2));
      honeyIM.setMatrixAt(k, m); wallIM.setMatrixAt(k, m);
    });
  }
  for (const im of [honeyIM, wallIM]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.userData.partId = 'core'; im.castShadow = false; im.receiveShadow = false; cNode.add(im); }
  // the amber heart under the cells (shows in the seams between rows)
  cNode.add(mesh(shell((u, v, o) => { const s = lerp(S0 + 0.08, S1 - 0.08, v); return cp(u * TAU, s, Math.max(0.002, Rc(s) - depth * 0.75), o); }, { nu: 24, nv: 12, thickness: 0.02, closedU: true }), honey, 'core', { cast: false, receive: false }));
  // vessel + end finials + honey line to the thorax
  const vesselGeo = shell((u, v, o) => { const s = lerp(S0, S1, v); return cp(u * TAU, s, Math.max(0.002, Rv(s)), o); }, { nu: 40, nv: 24, thickness: 0.025, closedU: true });
  const vesselMat = mats.get('vessel', 'core');
  vesselMat.specularColor.set('#ffd9a0'); vesselMat.specularIntensity = 0.3;   // the glass returns warm, low reflections: it must never tint the honey cold
  const vessel = mesh(vesselGeo, vesselMat, 'core', { cast: false, receive: false }); vessel.renderOrder = 1; cNode.add(vessel);
  const capProfile = [[0, -0.06], [0.2, -0.06], [0.24, -0.02], [0.24, 0.05], [0.16, 0.1], [0.11, 0.12], [0.11, 0.16], [0.06, 0.2], [0, 0.21]];
  const yF = sag(S0) - coreC.y, yR = sag(S1) - coreC.y;
  const coreTrim = [
    xf(revolve(capProfile, { segments: 24 }), { r: [Math.PI / 2, 0, 0], p: [0, yF, -S0 - coreC.z] }),
    xf(revolve(capProfile, { segments: 24 }), { r: [-Math.PI / 2, 0, 0], p: [0, yR, -S1 - coreC.z] }),
    tube([V3(0, yF, -S0 - coreC.z + 0.18), V3(0, yF + 0.03, -S0 - coreC.z + 0.4), V3(0, 0.02 - coreC.y, -coreC.z - 0.28)], 0.045, { tubular: 14, radial: 8 }),
  ];
  for (let k = 0; k < 4; k++) {                      // meridian ribs
    const a = (k / 4) * TAU + Math.PI / 4, pts = [];
    for (let i = 0; i <= 24; i++) { const s = lerp(S0 + 0.02, S1 - 0.02, i / 24); pts.push(cp(a, s, Rv(s) * 1.012 + 0.004)); }
    coreTrim.push(tube(pts, 0.02, { tubular: 48, radial: 6 }));
  }
  cNode.add(mesh(merge(coreTrim), mats.get('satin', 'core'), 'core'));
  // short reach: the light has no shadow, so it may only warm the comb, the vessel and the shells' inner faces —
  // never the thoracic socket, the waist or the legs (its cut-off is shorter than the distance to any of them)
  const light = new THREE.PointLight('#ffa040', 20, 2.15, 2); light.castShadow = false; cNode.add(light);

  // ── sting assembly: porcelain venom bulb, levers, stylet, two barbed lancets ─
  const sNode = ex.node('sting', { dir: [0, 0, -1], dist: 10.4, at: 0.22 });
  sNode.position.set(0, sag(4.7) - 0.05, -4.7); sNode.rotation.x = 0.1; swing.add(sNode);
  const stMetal = mats.get('metal', 'sting'), stSatin = mats.get('satin', 'sting'), stBody = mats.get('body', 'sting');
  const along = (g) => xf(g, { r: [-Math.PI / 2, 0, 0] });                 // +Y → -Z
  sNode.add(mesh(along(revolve([[0, -0.2], [0.1, -0.18], [0.17, -0.1], [0.2, 0], [0.18, 0.12], [0.12, 0.22], [0.075, 0.27], [0.06, 0.29], [0, 0.29]], { segments: 24 })), stBody, 'sting'));
  sNode.add(mesh(merge([
    along(revolve([[0, -0.215], [0.06, -0.215], [0.07, -0.2], [0.04, -0.19], [0, -0.19]], { segments: 16 })),                     // bulb finial
    along(revolve([[0.19, -0.02], [0.204, -0.012], [0.204, 0.012], [0.19, 0.02]], { segments: 28 })),                            // girdle band
    along(revolve([[0.05, 0.27], [0.082, 0.27], [0.09, 0.29], [0.09, 0.33], [0.07, 0.35], [0.05, 0.35]], { segments: 18 })),      // neck collar
    // stylet: turned, tapering, with ring grooves, ending in a fine point
    along(revolve([[0.04, 0.34], [0.052, 0.36], [0.05, 0.5], [0.044, 0.52], [0.046, 0.54], [0.04, 0.72], [0.035, 0.74], [0.036, 0.76], [0.028, 0.98], [0.016, 1.2], [0.008, 1.3], [0, 1.36]], { segments: 12, crease: 0.9 })),
  ]), stMetal, 'sting'));
  // quadrate plates (fixed) either side, with their pivot screws
  const quad = new THREE.Shape(); quad.moveTo(0.0, -0.08); quad.lineTo(0.16, -0.05); quad.lineTo(0.2, 0.06); quad.lineTo(0.02, 0.1); quad.closePath();
  quad.holes.push(new THREE.Path().absarc(0.12, 0.02, 0.022, 0, TAU, true));
  sNode.add(mesh(merge([
    ...[1, -1].map((sx) => xf(plate(quad, 0.026, { bevel: 0.006 }), { r: [0, -Math.PI / 2, 0], p: [sx * 0.215, 0.0, -0.2] })),
    ...[1, -1].map((sx) => xf(bushing(0.07, 0.05, { segments: 14 }), { r: [0, 0, Math.PI / 2], p: [sx * 0.2, 0.02, -0.1] })),
    rod(V3(0.2, 0.02, -0.1), V3(0.3, 0.05, -0.42), 0.03), rod(V3(-0.2, 0.02, -0.1), V3(-0.3, 0.05, -0.42), 0.03),
  ]), stSatin, 'sting'));
  sNode.add(mesh(merge([1, -1].map((sx) => aim(screwGeo(0.022, 10), V3(sx, 0, 0), V3(sx * 0.228, -0.03, -0.16)))), stMetal, 'sting'));
  const lancets = [];
  for (const sx of [1, -1]) {
    const g = new THREE.Group(); sNode.add(g);
    const parts = [along(revolve([[0, 0.24], [0.016, 0.25], [0.017, 0.7], [0.012, 1.12], [0.006, 1.3], [0, 1.36]], { segments: 7, crease: 1.3 }))];
    for (let k = 0; k < 9; k++) {                  // backward-pointing barbs, outboard, shrinking toward the tip
      const z = -(1.27 - k * 0.055), sz = 1 - k * 0.04;
      parts.push(aim(new THREE.ConeGeometry(0.011 * sz, 0.05 * sz, 4), V3(sx * 0.5, 0.2, 1), V3(sx * 0.014, -0.004, z + 0.02)));
    }
    // the lever (triangular plate) that drives this lancet, pinned at its base, reaching out to the quadrate plate
    const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(sx * 0.17, 0.05); tri.lineTo(sx * 0.12, -0.07); tri.closePath();
    parts.push(xf(plate(tri, 0.02, { bevel: 0.005 }), { r: [Math.PI / 2, 0, 0], p: [0, -0.06, -0.3] }));
    parts.push(xf(bushing(0.018, 0.06, { segments: 8 }), { p: [0, -0.04, -0.3] }));
    g.add(mesh(xf(merge(parts), { p: [sx * 0.03, -0.045, 0] }), stSatin, 'sting'));
    lancets.push(g);
  }

  /** Breathing: phase in radians, amount 0..1. Rear rings travel furthest; each lags the one before. */
  function breathe(phase, amount = 1) {
    rings.forEach((r, i) => {
      const w = (i + 0.6) / 6;
      r.slide.position.z = Math.sin(phase - i * 0.55) * 0.085 * w * amount;
      const sc = 1 + Math.sin(phase - i * 0.55 + 0.6) * 0.009 * amount;
      r.slide.scale.set(sc, sc, 1);
    });
    lancets[0].position.z = Math.sin(phase * 0.5) * 0.03; lancets[1].position.z = -Math.sin(phase * 0.5) * 0.03;
    // the gimbal follows the swing the rig has just set: the ring turns in pitch, the stalk in pitch and yaw
    gimbal.rotation.x = swing.rotation.x;
    stalk.rotation.copy(swing.rotation);
    // Windowed rings: outside SECTION only their front faces are drawn, so a window seen at a slant shows the
    // honeycomb behind it rather than a sliver of the shell's own (glazed, patterned) inner skin.
    const side = globalUniforms.uSection.value > 0.001 ? THREE.DoubleSide : THREE.FrontSide;
    for (const m of windowMats) if (m.side !== side) { m.side = side; m.needsUpdate = true; }
  }

  const group = new THREE.Group(); group.name = 'abdomenMount'; group.add(node, swing);
  return {
    group, node, swing, rings, light, flick, lancets, breathe, coreNode: cNode,
    anchors: { petiole: V3(0, 0.3, 0), tergites: abdPoint(0.5, 2.5, V3(), 1.02), core: coreC.clone(), sting: V3(0, sag(5.6) - 0.1, -5.9) },
    tip: V3(0, sag(5.5) - 0.12, -5.98),
  };
}
