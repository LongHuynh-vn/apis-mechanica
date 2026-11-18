// ─────────────────────────────────────────────────────────────────────────────
// bee/head.js — HEAD
// Cranial housing, compound eyes (540 instanced hexagonal lenses each, with a
// view-dependent pseudopupil glint), ocelli triad, elbowed antennae on ball
// joints (scape · pedicel · 10 flagellomeres), mandibles and a folding
// proboscis. Frame: origin at the head centre, face toward +Z, +Y up.
//
// Construction: the porcelain cranium carries a raised, chamfered clypeus
// plate (riveted, edged by the epistomal inlay) with a piano-hinged labrum;
// frontal, subantennal and genal sutures are gilt inlays; the antennae seat in
// flanged ball sockets closed by split retaining rings; the eyes sit in
// profiled, screwed bezels; the ocelli are claw-set jewels; the mandibles are
// porcelain spoons pinned in slotted hinge blocks; the proboscis folds as a
// pair of stipes rails, a galeal sheath and a sliding annulated glossa; the
// neck is a ball in a socket cup behind a screwed occipital flange.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, plain, orient, shell, revolve, bushing, tube, merge, xf, aim, rivetGeo, screwGeo, hexPrism, Scatter, ballJoint } from './kit.js';
import { mesh } from './materials.js';
import { buildHeadFur } from './fur.js';
import { HEAD, headPoint, headNormal } from './surfaces.js';
import { SPEC } from '../core/state.js';
import { DIMS } from '../core/dims.js';
import { rng, lerp, smoothstep, TAU, clamp } from '../core/math.js';

// The cranium surface lives in surfaces.js; re-exported for older imports.
export { headPoint };

const EYE = { a: 0.47, b: 1.06, c: 0.6, thetaMax: 1.42 };

// ── surface helpers ──────────────────────────────────────────────────────────
const wrap = (d) => { d = (d + Math.PI) % TAU; if (d < 0) d += TAU; return d - Math.PI; };
/** Point on the cranium, offset `d` along its normal. */
const HP = (phi, lam, d = 0, o = V3()) => { headPoint(phi, lam, o); if (d) o.addScaledVector(headNormal(phi, lam), d); return o; };
/** (phi, lam) of the cranium point seen from the head centre in the direction of q. */
function proj(q) {
  let phi = Math.atan2(q.x, q.z), lam = Math.atan2(q.y, Math.hypot(q.x, q.z));
  const p = V3();
  for (let i = 0; i < 12; i++) {
    headPoint(phi, lam, p);
    phi += wrap(Math.atan2(q.x, q.z) - Math.atan2(p.x, p.z));
    lam += Math.atan2(q.y, Math.hypot(q.x, q.z)) - Math.atan2(p.y, Math.hypot(p.x, p.z));
  }
  return [phi, lam];
}
/** x of the cranium's outline at a latitude (phi = π/2). */
const xMaxAt = (lam) => headPoint(Math.PI / 2, lam).x;
const phiForX = (x, lam) => Math.asin(clamp(x / xMaxAt(lam), -1, 1));

const arc = (cx, cy, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; };
/** Chamfered flat plate from an outline in the XY plane, thickness along Z (centred). */
function lugZ(pts, thick, bevel = 0.006, segs = 1) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const b = Math.min(bevel, thick * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, thick - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: segs, curveSegments: 4 });
  g.translate(0, 0, -(thick - 2 * b) / 2);
  return plain(toCreasedNormals(plain(g), 0.6));
}
/** Same, outline in the (z, y) plane, thickness along X. */
const lugX = (pts, thick, bevel, segs) => lugZ(pts, thick, bevel, segs).rotateY(-Math.PI / 2);
/** Sweep a closed 2D profile [dr, dh] around an elliptical loop: ring(t) = centre + (A+dr)cos t·U + (B+dr)sin t·W + dh·N. */
function ringSweep(profile, A, B, n, { U = V3(0, 1, 0), W = V3(0, 0, 1), N = V3(1, 0, 0), C = V3(), crease = 0.5 } = {}) {
  const pos = [], idx = [], m = profile.length;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU, c = Math.cos(t), s = Math.sin(t);
    for (const [dr, dh] of profile) pos.push(
      C.x + (A + dr) * c * U.x + (B + dr) * s * W.x + dh * N.x,
      C.y + (A + dr) * c * U.y + (B + dr) * s * W.y + dh * N.y,
      C.z + (A + dr) * c * U.z + (B + dr) * s * W.z + dh * N.z);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = a + m, d = b + m;
    idx.push(a, b, c, b, d, c);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g = g.toNonIndexed();
  orient(g);                                     // closed surface: the signed-volume test is reference-free
  return plain(toCreasedNormals(g, crease));
}
/** A tube that rides on the cranium through (phi, lam) samples, lifted by d. */
const inlayOn = (pl, r = 0.0105, d = 0.0, tubular = 3) => tube(pl.map(([p, l]) => HP(p, l, d)), r, { tubular: pl.length * tubular, radial: 5 });

export function buildHead({ mats, ex }) {
  const rnd = rng(23);
  // Outer node moves the whole head off the neck in the exploded view.
  const node = ex.node('cranium', { dir: [0, 0.12, 1], dist: 4.2, at: 0.3 });
  const pivot = new THREE.Group(); pivot.name = 'headPivot'; node.add(pivot);   // gaze rotations happen here (at the neck joint)
  const head = new THREE.Group(); head.name = 'head'; head.position.set(0, -0.15, 0.86); pivot.add(head);

  const body = mats.get('body', 'cranium', { cap: true });
  const metal = mats.get('metal', 'cranium', { cap: true });
  const satin = mats.get('satin', 'cranium', { cap: true });

  // ── cranial housing ────────────────────────────────────────────────────────
  const skull = shell((u, v, o) => headPoint(u * TAU, lerp(-Math.PI / 2 + 0.03, Math.PI / 2 - 0.03, v), o), { nu: 96, nv: 48, thickness: 0.07, closedU: true });
  const porcelain = [skull];
  const trim = [], brushed = [];
  const rivets = new Scatter(), screws = new Scatter();

  // clypeus: a raised porcelain shield, chamfered all round, convex upper margin
  const CLY = { lamB: -0.95, lamT: -0.2, H: 0.95 };
  const clyX = (v) => lerp(0.31, 0.37, v) * (v < 0.5 ? 1 : Math.sqrt(Math.max(0, 1 - ((v - 0.5) / 0.5) ** 2)) ** 0.8);
  const clyLam = (v) => lerp(CLY.lamB, CLY.lamT, v);
  const clyLift = (u, v) => { const e = Math.min((1 - Math.abs(2 * u - 1)) * clyX(v), v * CLY.H, (1 - v) * CLY.H * 0.6); return 0.008 + 0.024 * smoothstep(0, 0.065, e); };
  const clyPhi = (u, v) => phiForX((2 * u - 1) * clyX(v), clyLam(v));
  porcelain.push(shell((u, v, o) => HP(clyPhi(u, v), clyLam(v), clyLift(u, v), o), { nu: 22, nv: 20, thickness: 0.045 }));
  const clyLoop = [];
  for (let i = 0; i <= 10; i++) clyLoop.push([clyPhi(i / 10, 0.004), clyLam(0.004)]);
  for (let i = 1; i <= 16; i++) { const v = i / 16; clyLoop.push([clyPhi(0.998, v), clyLam(v)]); }
  for (let i = 15; i >= 1; i--) { const v = i / 16; clyLoop.push([clyPhi(0.002, v), clyLam(v)]); }
  trim.push(tube(clyLoop.map(([p, l]) => HP(p, l, 0.006)), 0.0115, { tubular: 140, radial: 5, closed: true }));   // epistomal inlay
  for (let i = 0; i < 7; i++) { const u = lerp(0.12, 0.88, i / 6), v = 0.075; rivets.add(HP(clyPhi(u, v), clyLam(v), clyLift(u, v)), headNormal(clyPhi(u, v), clyLam(v)), 0.85); }
  for (const u of [0.07, 0.93]) for (const v of [0.24, 0.4, 0.56]) rivets.add(HP(clyPhi(u, v), clyLam(v), clyLift(u, v)), headNormal(clyPhi(u, v), clyLam(v)), 0.85);

  // labrum: a porcelain flap on a three-knuckle piano hinge under the clypeus
  {
    const lamH = CLY.lamB - 0.035, H = HP(0, lamH, 0.03);
    const n = headNormal(0, lamH), tD = HP(0, lamH - 0.05).sub(HP(0, lamH)).normalize();
    const d = tD.clone().multiplyScalar(Math.cos(0.55)).addScaledVector(n, Math.sin(0.55)).normalize();
    const X = V3(1, 0, 0), Z = V3().crossVectors(X, d).normalize();
    const M = new THREE.Matrix4().makeBasis(X, d, Z).setPosition(H);
    // outline: x across, y down the flap (along d); slightly convex free edge
    const pts = [[-0.165, 0.025], [0.165, 0.025], [0.17, 0.15], [0.15, 0.2], [0.09, 0.225], [0, 0.232], [-0.09, 0.225], [-0.15, 0.2], [-0.17, 0.15]];
    porcelain.push(lugZ(pts, 0.034, 0.01, 2).applyMatrix4(M));
    const kn = (x0, x1) => xf(bushing(0.029, x1 - x0, { segments: 14 }), { r: [0, 0, Math.PI / 2], p: [(x0 + x1) / 2, 0, 0] }).applyMatrix4(M);
    trim.push(kn(-0.205, -0.078), kn(-0.072, 0.072), kn(0.078, 0.205));
    trim.push(xf(bushing(0.011, 0.44, { segments: 8 }), { r: [0, 0, Math.PI / 2] }).applyMatrix4(M));
    for (const s of [1, -1]) trim.push(xf(rivetGeo(0.016, 10), { r: [0, 0, -s * Math.PI / 2], p: [s * 0.208, 0, 0] }).applyMatrix4(M));
    // the outer knuckles' leaves, riveted to the cranium
    for (const s of [1, -1]) trim.push(lugZ([[s * 0.085, 0.0], [s * 0.2, 0.0], [s * 0.19, 0.07], [s * 0.095, 0.07]], 0.014, 0.004).applyMatrix4(new THREE.Matrix4().makeBasis(X, tD.clone().negate(), V3().crossVectors(X, tD.clone().negate())).setPosition(HP(0, lamH, 0.012))));
    for (const s of [1, -1]) rivets.add(HP(s * 0.24, lamH + 0.04, 0.015), headNormal(s * 0.24, lamH + 0.04), 0.7);
  }

  // sutures as gilt inlays: frontal (median), subantennal, genal (behind the eyes)
  const sockets = [V3(0.34, 0.3, 0), V3(-0.34, 0.3, 0)].map((s) => {
    const phi = Math.atan2(s.x, 0.78), lam = Math.asin(s.y / HEAD.ry);
    return { phi: phi * 0.62, lam, p: headPoint(phi * 0.62, lam, V3(), 1.0), n: headNormal(phi * 0.62, lam) };
  });
  {
    const fr = []; for (let i = 0; i <= 14; i++) fr.push([0, lerp(CLY.lamT + 0.045, 0.9, i / 14)]);
    trim.push(inlayOn(fr, 0.0105));
    rivets.add(HP(0, 0.93, 0.004), headNormal(0, 0.93), 0.9);
    for (const so of sockets.slice(0, 1)) for (const s of [1, -1]) {
      const a = [s * so.phi, so.lam - 0.17], b = [clyPhi(s > 0 ? 0.985 : 0.015, 0.66), clyLam(0.66) + 0.02], pl = [];
      for (let i = 0; i <= 8; i++) pl.push([lerp(a[0], b[0], i / 8), lerp(a[1], b[1], i / 8)]);
      trim.push(inlayOn(pl, 0.0095));
    }
  }

  // ── antennal sockets: flanged housing, split retaining ring, three screws ──
  const housing = revolve([[0.1, -0.05], [0.198, -0.05], [0.214, -0.022], [0.206, 0.006], [0.16, 0.022], [0.128, 0.05], [0.114, 0.063], [0.1, 0.063], [0.1, -0.05]], { segments: 26, crease: 0.5 });
  const clip = (() => {
    const pts = []; for (let i = 0; i <= 26; i++) { const a = 0.42 + (i / 26) * (TAU - 0.84); pts.push(V3(Math.cos(a) * 0.112, 0.069, Math.sin(a) * 0.112)); }
    const g = [tube(pts, 0.0085, { tubular: 52, radial: 5 })];
    for (const a of [0.42, TAU - 0.42]) g.push(xf(revolve([[0.006, -0.006], [0.016, -0.006], [0.016, 0.006], [0.006, 0.006], [0.006, -0.006]], { segments: 10 }), { p: [Math.cos(a) * 0.128, 0.069, Math.sin(a) * 0.128] }));
    return merge(g);
  })();
  for (const so of sockets) {
    brushed.push(aim(housing.clone(), so.n, so.p));
    trim.push(aim(clip.clone(), so.n, so.p));
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), so.n);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5, lp = V3(Math.cos(a) * 0.168, 0.016, Math.sin(a) * 0.168).applyQuaternion(q).add(so.p);
      screws.add(lp, V3(-Math.cos(a) * 0.25, 1, -Math.sin(a) * 0.25).applyQuaternion(q), 1);
    }
  }

  // ── occipital flange, neck socket and ball ─────────────────────────────────
  {
    // polar patch around the back pole (phi = π, lam = lam0), scaled so rho is roughly in cm on the surface
    const lam0 = Math.asin(0.15 / HEAD.ry), sx = xMaxAt(lam0), sy = HEAD.ry * Math.cos(lam0);
    const ringPL = (a, rho) => [Math.PI + (Math.sin(a) * rho) / sx, lam0 + (Math.cos(a) * rho * 0.94) / sy];
    const ringP = (a, rho, d, o) => { const [p, l] = ringPL(a, rho); return HP(p, l, d, o); };
    const lift = (v) => 0.006 + 0.026 * smoothstep(0, 0.22, Math.min(v, 1 - v));
    brushed.push(shell((u, v, o) => ringP(u * TAU, lerp(0.39, 0.56, v), lift(v), o), { nu: 72, nv: 6, thickness: 0.05, closedU: true }));
    for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * TAU, [pp, ll] = ringPL(a, 0.475); screws.add(HP(pp, ll, 0.031), headNormal(pp, ll), 1); }
    // socket cup holding the neck ball
    trim.push(xf(revolve([[0.27, 0.0], [0.39, 0.0], [0.4, 0.03], [0.37, 0.09], [0.32, 0.15], [0.3, 0.19], [0.27, 0.19], [0.27, 0.0]], { segments: 40, crease: 0.5 }), { r: [-Math.PI / 2, 0, 0], p: [0, 0.15, -0.6] }));
    trim.push(xf(ballJoint(0.3, { segments: 28 }), { p: [0, 0.15, -0.74] }));
  }

  // ── genal sutures + rivets (computed from the eye seat so they follow its outline) ──
  const eyeFrame = new THREE.Matrix4().compose(V3(1.13, 0.17, 0.08), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.2, 0.13)), V3(1, 1, 1));
  const B0 = EYE.b * Math.sin(EYE.thetaMax + 0.07), C0 = EYE.c * Math.sin(EYE.thetaMax + 0.07), X0 = EYE.a * Math.cos(EYE.thetaMax + 0.07);
  {
    const gl = [];
    for (let i = 0; i <= 18; i++) {
      const t = lerp(Math.PI * 1.06, Math.PI * 1.97, i / 18), q = V3(-0.02, (B0 + 0.2) * Math.cos(t), (C0 + 0.2) * Math.sin(t)).applyMatrix4(eyeFrame);
      gl.push(proj(q));
    }
    for (const s of [1, -1]) {
      trim.push(inlayOn(gl.map(([p, l]) => [s * p, l]), 0.0105, 0.0, 4));
      for (let i = 0; i < 6; i++) {
        const t = lerp(Math.PI * 1.15, Math.PI * 1.88, i / 5), q = V3(-0.02, (B0 + 0.11) * Math.cos(t), (C0 + 0.11) * Math.sin(t)).applyMatrix4(eyeFrame);
        const [p, l] = proj(q); rivets.add(HP(s * p, l, 0.004), headNormal(s * p, l), 0.8);
      }
    }
  }

  head.add(mesh(merge(porcelain), body, 'cranium'), mesh(merge(trim), metal, 'cranium'), mesh(merge(brushed), satin, 'cranium'));
  const rv = rivets.build(rivetGeo(0.03, 10), mats.get('metal', 'cranium', { key: 'riv' })); rv.userData.partId = 'cranium'; rv.castShadow = false; head.add(rv);
  const sc = screws.build(screwGeo(0.022, 10), mats.get('metal', 'cranium', { key: 'scr' })); sc.userData.partId = 'cranium'; sc.castShadow = false; head.add(sc);

  // ── compound eyes ──────────────────────────────────────────────────────────
  const eyeGlass = mats.get('eye', 'eyes');
  const eyeMetal = mats.get('metal', 'eyes');
  const glintU = { value: new THREE.Color('#ffd9a0') }, glintGain = { value: 0.5 };
  const glintExtend = (shader) => {
      shader.uniforms.uGlint = glintU; shader.uniforms.uGlintGain = glintGain;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vApisAxis;')
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
          #ifdef USE_INSTANCING
            vApisAxis = normalize( normalMatrix * mat3( instanceMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
          #else
            vApisAxis = normalize( normalMatrix * vec3( 0.0, 1.0, 0.0 ) );
          #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vApisAxis; uniform vec3 uGlint; uniform float uGlintGain;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { // pseudopupil: the facets that look straight at you answer with a faint inner glint
            float al = saturate( dot( normalize( vApisAxis ), normalize( vViewPosition ) ) );
            totalEmissiveRadiance += uGlint * ( pow( al, 26.0 ) * 0.55 + pow( al, 140.0 ) * 1.2 ) * uGlintGain;
          }`);
  };
  const lensMat = mats.get('eye', 'eyes', { key: 'lens', extend: glintExtend });
  const eyeP = (th, ps, o, k = 1) => o.set(EYE.a * k * Math.cos(th), EYE.b * k * Math.sin(th) * Math.cos(ps), EYE.c * k * Math.sin(th) * Math.sin(ps));
  const eyeN = (p, o) => o.set(p.x / (EYE.a * EYE.a), p.y / (EYE.b * EYE.b), p.z / (EYE.c * EYE.c)).normalize();
  // planar hex lattice → azimuthal-equidistant map onto the dome
  const cells = [];
  const sp = 0.0793;
  for (let j = -16; j <= 16; j++) for (let i = -16; i <= 16; i++) {
    const x = (i + (j & 1) * 0.5) * sp, y = j * sp * 0.8660254, r = Math.hypot(x, y);
    if (r < 1.04) cells.push({ x, y, r });
  }
  cells.sort((p, q) => p.r - q.r); cells.length = Math.min(cells.length, SPEC.facetsPerEye);
  const mapCell = (x, y, o, k = 1) => { const r = Math.hypot(x, y); return eyeP(Math.min(r, 1.04) * EYE.thetaMax, Math.atan2(y, x), o, k); };
  const lensGeo = revolve([[0, 0], [1, 0], [1, 0.2], [0.9, 0.34], [0.6, 0.47], [0.3, 0.53], [0, 0.55]], { segments: 6, crease: 0.75 });
  const buildFacets = () => {
    const im = new THREE.InstancedMesh(lensGeo, lensMat, cells.length);
    const P = V3(), N = V3(), A = V3(), B = V3(), X = V3(), Z = V3(), basis = new THREE.Matrix4(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V3();
    cells.forEach((c, i) => {
      mapCell(c.x, c.y, P, 1.004); eyeN(P, N);
      mapCell(c.x + sp * 0.5, c.y, A); mapCell(c.x - sp * 0.5, c.y, B);
      X.subVectors(A, B); const wx = X.length(); X.addScaledVector(N, -X.dot(N)).normalize();
      mapCell(c.x, c.y + sp * 0.5, A); mapCell(c.x, c.y - sp * 0.5, B);
      const wz = A.distanceTo(B);
      Z.crossVectors(X, N).normalize();
      basis.makeBasis(X, N, Z); q.setFromRotationMatrix(basis);
      const rx = (wx / Math.sqrt(3)) * 0.965, rz = (wz / Math.sqrt(3)) * 0.965 * 1.1547;
      s.set(rx, Math.min(rx, rz) * 0.9, rz);
      m.compose(P, q, s); im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.userData.partId = 'eyes'; im.castShadow = false; im.receiveShadow = true;
    return im;
  };
  const domeGeo = shell((u, v, o) => eyeP(lerp(0.02, EYE.thetaMax + 0.1, v), u * TAU, o, 0.985), { nu: 56, nv: 18, thickness: 0.06, closedU: true, flipN: true });
  // the bezel: a turned, stepped ring — inner lip over the outermost facets, chamfered crown, a skirt that sinks into the cranium
  const bezelGeo = merge([
    ringSweep([[-0.05, 0.026], [-0.036, 0.05], [-0.008, 0.06], [0.034, 0.06], [0.054, 0.042], [0.06, 0.0], [0.07, -0.016], [0.08, -0.03], [0.074, -0.13], [-0.04, -0.13]], B0, C0, 120, { C: V3(X0, 0, 0) }),
    ringSweep([[-0.004, 0.06], [0.006, 0.066], [0.016, 0.06], [0.006, 0.055]], B0 + 0.006, C0 + 0.006, 120, { C: V3(X0, 0, 0), crease: 1.2 }),   // a fine bead on the crown
  ]);
  const bezelScrews = new Scatter();
  for (let i = 0; i < 12; i++) { const t = ((i + 0.5) / 12) * TAU; bezelScrews.add(V3(X0 + 0.06, (B0 + 0.034) * Math.cos(t), (C0 + 0.034) * Math.sin(t)), V3(1, 0, 0), 0.8); }
  const eyes = [];
  for (const sx of [1, -1]) {
    const side = new THREE.Group(); side.scale.x = sx; head.add(side);
    const eNode = ex.node('eyes', { dir: [1, 0.05, 0.2], dist: 2.0, at: 0.24 });
    eNode.position.set(1.13, 0.17, 0.08); eNode.rotation.set(0, -0.2, 0.13);
    side.add(eNode);
    eNode.add(mesh(domeGeo, eyeGlass, 'eyes'), mesh(bezelGeo, eyeMetal, 'eyes'));
    const bs = bezelScrews.build(screwGeo(0.024, 10), mats.get('metal', 'eyes', { key: 'scr' })); bs.userData.partId = 'eyes'; bs.castShadow = false; eNode.add(bs);
    const fNode = ex.node('eyes', { dir: [1, 0, 0], dist: 0.6, at: 0.16, name: 'ex:eyes:facets' });
    fNode.add(buildFacets()); eNode.add(fNode);
    eyes.push(eNode);
  }

  // ── ocelli triad: jewels claw-set in gilt bezels on seat flanges ──────────
  const oNode = ex.node('ocelli', { dir: [0, 1, 0.25], dist: 1.9, at: 0.24 });
  head.add(oNode);
  const jewel = [], setting = [];
  for (const [phi, lam, r] of [[0, 1.05, 0.105], [0.62, 1.24, 0.09], [-0.62, 1.24, 0.09]]) {
    const p = headPoint(phi, lam, V3(), 1.0), n = headNormal(phi, lam);
    const S = (pts) => pts.map(([x, y]) => [x * r, y * r]);
    jewel.push(aim(revolve(S([[0, 0.78], [0.3, 0.74], [0.56, 0.6], [0.76, 0.4], [0.86, 0.18], [0.86, -0.1], [0, -0.1]]), { segments: 20, crease: 1.4 }), n, p));
    setting.push(aim(revolve(S([[0.84, -0.22], [1.5, -0.22], [1.58, -0.12], [1.5, -0.04], [1.16, 0.0], [1.08, 0.26], [0.98, 0.34], [0.86, 0.3], [0.84, 0.1], [0.84, -0.22]]), { segments: 24, crease: 0.5 }), n, p));
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), n);
    for (let i = 0; i < 6; i++) {   // claws gripping the jewel
      const a = (i / 6) * TAU + 0.26, ca = Math.cos(a), sa = Math.sin(a);
      const a0 = V3(ca * 1.0 * r, 0.26 * r, sa * 1.0 * r), a1 = V3(ca * 0.86 * r, 0.42 * r, sa * 0.86 * r), a2 = V3(ca * 0.72 * r, 0.5 * r, sa * 0.72 * r);
      setting.push(tube([a0, a1, a2].map((v) => v.applyQuaternion(q).add(p)), (u) => r * 0.075 * (1 - u * 0.5), { tubular: 4, radial: 4 }));
    }
  }
  oNode.add(mesh(merge(jewel), mats.get('eye', 'ocelli'), 'ocelli'), mesh(merge(setting), mats.get('metal', 'ocelli', { cap: true }), 'ocelli'));

  // ── antennae ───────────────────────────────────────────────────────────────
  const antBody = mats.get('body', 'antennae'), antMetal = mats.get('metal', 'antennae');
  const SEG = SPEC.flagellomeres, segLen = 0.245, pedLen = 0.2, scapeLen = 1.02;
  // scape: a slender porcelain club on a necked ball; gilt ferrules; a socket cup for the elbow ball
  const scapeGeo = revolve([[0, 0.07], [0.04, 0.075], [0.043, 0.13], [0.054, 0.15], [0.06, 0.2], [0.064, 0.32], [0.07, 0.6], [0.071, 0.8], [0.066, scapeLen - 0.12], [0.06, scapeLen - 0.08], [0, scapeLen - 0.08]], { segments: 16, crease: 0.9 });
  const scapeTrim = merge([
    ballJoint(0.105, { segments: 18 }),
    revolve([[0, 0.135], [0.06, 0.135], [0.066, 0.143], [0.066, 0.19], [0.06, 0.198], [0, 0.198]], { segments: 16 }),                         // base ferrule
    revolve([[0, 0.5], [0.069, 0.5], [0.075, 0.506], [0.075, 0.524], [0.069, 0.53], [0, 0.53]], { segments: 16 }),                              // mid band
    revolve([[0.056, scapeLen - 0.13], [0.068, scapeLen - 0.13], [0.075, scapeLen - 0.12], [0.08, scapeLen - 0.04], [0.086, scapeLen - 0.01], [0.074, scapeLen + 0.016], [0.062, scapeLen + 0.016], [0.056, scapeLen - 0.13]], { segments: 18, crease: 0.5 }),   // elbow cup: its lip retains the ball
    xf(ballJoint(0.07, { segments: 14 }), { p: [0, scapeLen, 0] }),
    tube([V3(0, 0.2, 0.0655), V3(0, 0.35, 0.068), V3(0, 0.5, 0.0705)], 0.006, { tubular: 8, radial: 4 }),
    tube([V3(0, 0.53, 0.0712), V3(0, 0.7, 0.0715), V3(0, scapeLen - 0.13, 0.0675)], 0.006, { tubular: 8, radial: 4 }),
  ]);
  // flagellomere: chamfered porcelain bead-tube; the joint is a tiny gilt ball under a collar ferrule
  const flagGeo = revolve([[0, 0.012], [0.03, 0.016], [0.048, 0.03], [0.056, 0.052], [0.058, 0.12], [0.057, 0.19], [0.051, 0.214], [0.038, 0.234], [0, 0.245]], { segments: 12, crease: 0.9 });
  const beadGeo = merge([ballJoint(0.032, { segments: 8 }), revolve([[0, 0.016], [0.054, 0.016], [0.06, 0.022], [0.06, 0.036], [0.054, 0.042], [0, 0.042]], { segments: 14, crease: 0.7 })]);
  const antennae = [];
  for (const sx of [1, -1]) {
    const side = new THREE.Group(); side.scale.x = sx; head.add(side);
    const aNode = ex.node('antennae', { dir: [0.3, 0.72, 0.62], dist: 2.9, at: 0.12 });
    const so = sockets[0];
    aNode.position.copy(so.p).addScaledVector(so.n, 0.03);
    side.add(aNode);
    const scape = new THREE.Group(); aNode.add(scape);                     // 2-DOF ball joint at the socket
    scape.add(mesh(scapeGeo, antBody, 'antennae'), mesh(scapeTrim, antMetal, 'antennae'));
    const elbow = new THREE.Group(); elbow.position.y = scapeLen; scape.add(elbow);
    const segs = new THREE.InstancedMesh(flagGeo, antBody, SEG + 1), beads = new THREE.InstancedMesh(beadGeo, antMetal, SEG + 1);
    for (const im of [segs, beads]) { im.userData.partId = 'antennae'; im.castShadow = true; im.frustumCulled = false; elbow.add(im); }
    antennae.push({ node: aNode, scape, elbow, segs, beads, bendX: new Float32Array(SEG + 1), bendZ: new Float32Array(SEG + 1), spread: 0 });
  }
  const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _e = new THREE.Euler(), _s = V3();
  /**
   * Pose one antenna. scapeX/scapeZ: ball-joint angles at the socket; elbowX/elbowZ: the elbow;
   * curl: static curve of the flagellum; swayX/swayZ: dynamic bend (radians at the tip, distributed along the chain).
   */
  function poseAntenna(i, { scapeX, scapeZ, elbowX, elbowZ, curl, swayX, swayZ, spread = 0 }) {
    const a = antennae[i];
    a.scape.rotation.set(scapeX, 0, scapeZ);
    a.elbow.rotation.set(elbowX, 0, elbowZ);
    _m.identity();
    for (let k = 0; k <= SEG; k++) {
      const w = (k + 1) / (SEG + 1), len = k === 0 ? pedLen : segLen;
      _e.set(curl * 0.12 + swayX * w * 0.2, 0, swayZ * w * 0.2);
      _m.multiply(_r.makeRotationFromEuler(_e));
      a.beads.setMatrixAt(k, _m);
      const sc = k === 0 ? pedLen / segLen : 1 - k * 0.012;
      a.segs.setMatrixAt(k, _t.copy(_m).scale(_s.set(k === 0 ? 1.1 : sc, k === 0 ? pedLen / segLen : 1, k === 0 ? 1.1 : sc)));
      _m.multiply(_t.makeTranslation(0, len * (1 + spread * 0.9), 0));
    }
    a.segs.instanceMatrix.needsUpdate = true; a.beads.instanceMatrix.needsUpdate = true;
  }

  // ── mandibles: porcelain spoons pinned in slotted gilt hinge blocks ───────
  const MAND = V3(0.52, -1.2, 0.36);
  const mandParts = (() => {
    // blade: a spoon, convex in front, its rim curling back; a gilt edge along the working margin
    const P0 = V3(-0.03, -0.035, 0), P1 = V3(-0.1, -0.21, 0.012), P2 = V3(-0.31, -0.25, 0.03);
    const curve = new THREE.QuadraticBezierCurve3(P0, P1, P2);
    const W = (v) => { const base = lerp(0.044, 0.088, smoothstep(0.1, 0.72, v)); return v < 0.74 ? base : base * Math.sqrt(Math.max(0, 1 - ((v - 0.74) / 0.26) ** 2)); };
    const T = V3(), Nn = V3(), C = V3();
    const P = (u, v, o) => {
      curve.getPoint(v, C); curve.getTangent(v, T); Nn.set(-T.y, T.x, 0).normalize();
      const s = 2 * u - 1, cup = smoothstep(0.2, 0.7, v);
      return o.copy(C).addScaledVector(Nn, W(v) * s).add(V3(0, 0, -0.05 * s * s * cup + 0.012 * (1 - cup) * (1 - s * s)));
    };
    const blade = shell(P, { nu: 12, nv: 22, thickness: (u, v) => lerp(0.05, 0.032, v), flipN: true });
    const rim = [];
    for (let i = 0; i <= 14; i++) rim.push(P(0.0, lerp(0.3, 1, i / 14), V3()).add(V3(0, 0, 0.004)));
    for (let i = 13; i >= 0; i--) rim.push(P(1.0, lerp(0.3, 1, i / 14), V3()).add(V3(0, 0, 0.004)));
    const jawMetal = merge([
      tube(rim, 0.0085, { tubular: 70, radial: 5 }),
      lugZ([...arc(0, 0, 0.07, Math.PI * 0.2, Math.PI * 1.25, 9), [-0.07, -0.12], [0.02, -0.11]], 0.098, 0.008),   // the tongue in the block's slot
    ]);
    // hinge block (static, rides with the mandible node): back cheek on the cranium, front cheek, lateral web, pin
    const [bp, bl] = proj(MAND); const base = HP(bp, bl).sub(MAND);
    const cheek = [...arc(0, 0, 0.085, Math.PI * 0.62, Math.PI * 2.05, 12), [0.15, 0.03], [0.15, 0.13], [0.03, 0.15]];
    const back = Math.max(0.12, -base.z + 0.02);
    const block = merge([
      xf(lugZ(cheek, 0.032, 0.007), { p: [0, 0, 0.072] }),
      xf(lugZ(cheek, back - 0.056, 0.007), { p: [0, 0, -(0.056 + back) / 2] }),
      xf(lugZ([[0.07, 0.045], [0.14, 0.04], [0.15, 0.13], [0.06, 0.15]], 0.06 + back + 0.03, 0.008), { p: [0, 0, (0.088 - back) / 2] }),
      xf(bushing(0.022, 0.07 + back, { segments: 12 }), { r: [Math.PI / 2, 0, 0], p: [0, 0, (0.09 - back) / 2] }),
      xf(screwGeo(0.042, 12), { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.087] }),
    ]);
    return { blade, jawMetal, block };
  })();
  const mandibles = [];
  for (const sx of [1, -1]) {
    const side = new THREE.Group(); side.scale.x = sx; head.add(side);
    const mNode = ex.node('mandibles', { dir: [0.45, -0.8, 0.4], dist: 1.9, at: 0.16 });
    mNode.position.copy(MAND); side.add(mNode);
    mNode.add(mesh(mandParts.block, mats.get('metal', 'mandibles', { cap: true }), 'mandibles'));
    const jaw = new THREE.Group(); mNode.add(jaw);
    jaw.add(mesh(mandParts.blade, mats.get('body', 'mandibles', { cap: true }), 'mandibles'), mesh(mandParts.jawMetal, mats.get('metal', 'mandibles', { cap: true }), 'mandibles'));
    mandibles.push(jaw);
  }

  // ── proboscis: paired stipes rails → galeal sheath → sliding glossa ───────
  // Folded, the rails swing back under the head and the sheath folds forward between them.
  const pNode = ex.node('proboscis', { dir: [0, -1, 0.15], dist: 3.0, at: 0.18 });
  const PY = -1.585;
  pNode.position.set(0, PY, 0.0); head.add(pNode);
  const pMetal = mats.get('metal', 'proboscis'), pBody = mats.get('body', 'proboscis');
  const L1 = 0.72, L2 = 0.95, LG = 0.86, RX = 0.15;
  {
    // mounting bracket under the head (static: belongs to the cranium): an oval base, two lugs with stub pins
    // (no through-pin, so the folded sheath can pass between the rails)
    const br = [];
    br.push(xf(revolve([[0, -0.028], [0.13, -0.028], [0.148, -0.012], [0.145, 0.03], [0, 0.04]], { segments: 22, crease: 0.5 }), { s: [1.75, 1, 1], p: [0, -1.5, 0.0] }));
    for (const s of [1, -1]) {
      br.push(xf(lugX([[-0.065, 0.135], [0.065, 0.135], [0.065, 0.0], ...arc(0, 0, 0.065, 0, -Math.PI, 8)], 0.034, 0.006), { p: [s * 0.203, PY, 0] }));
      br.push(xf(bushing(0.021, 0.09, { segments: 10 }), { r: [0, 0, Math.PI / 2], p: [s * 0.18, PY, 0] }));
      br.push(xf(screwGeo(0.032, 10), { r: [0, 0, -s * Math.PI / 2], p: [s * 0.219, PY, 0] }));
    }
    head.add(mesh(merge(br), metal, 'cranium'));
    for (const s of [1, -1]) for (const z of [-0.07, 0.07]) screws.add(V3(s * 0.11, -1.53, z), V3(0, -1, 0), 0.7);
  }
  const link1 = new THREE.Group(); pNode.add(link1);
  {
    const rail = [...arc(0, 0, 0.056, 0, Math.PI, 8), [-0.034, -L1 * 0.5], ...arc(0, -L1, 0.05, Math.PI, TAU, 8), [0.034, -L1 * 0.5]];
    const g = [];
    for (const s of [1, -1]) {
      g.push(xf(lugX(rail, 0.034, 0.008), { p: [s * RX, 0, 0] }));
      for (const y of [-L1 * 0.33, -L1 * 0.66]) g.push(xf(rivetGeo(0.014, 8), { r: [0, 0, -s * Math.PI / 2], p: [s * (RX + 0.016), y, 0] }));
    }
    g.push(xf(bushing(0.02, 2 * RX + 0.06, { segments: 10 }), { r: [0, 0, Math.PI / 2], p: [0, -L1, 0] }));
    for (const s of [1, -1]) g.push(xf(hexPrism(0.03, 0.022, { chamfer: 0.2 }), { r: [0, 0, Math.PI / 2], p: [s * (RX + 0.028), -L1, 0] }));
    link1.add(mesh(merge(g), pMetal, 'proboscis'));
  }
  const link2 = new THREE.Group(); link2.position.y = -L1; link1.add(link2);
  {
    // galeal sheath: two porcelain half-shells meeting on gilt seams, ferruled at both ends, bored for the glossa
    const sheath = xf(revolve([[0.036, 0.05], [0.056, 0.056], [0.066, 0.09], [0.07, 0.35], [0.067, 0.65], [0.056, L2 - 0.05], [0.046, L2], [0.036, L2], [0.036, 0.05]], { segments: 20, crease: 0.7 }), { r: [Math.PI, 0, 0], s: [1, 1, 0.86] });
    const m = [
      lugX([...arc(0, 0, 0.056, 0, Math.PI, 8), [-0.062, -0.02], [-0.062, -0.085], [0.062, -0.085], [0.062, -0.02]], 0.19, 0.01),
      xf(revolve([[0.064, 0], [0.076, 0.004], [0.078, 0.034], [0.066, 0.038], [0.064, 0]], { segments: 20 }), { r: [Math.PI, 0, 0], s: [1, 1, 0.86], p: [0, -0.095, 0] }),
      xf(revolve([[0.052, 0], [0.064, 0.004], [0.066, 0.032], [0.054, 0.036], [0.052, 0]], { segments: 20 }), { r: [Math.PI, 0, 0], s: [1, 1, 0.86], p: [0, -(L2 - 0.075), 0] }),
    ];
    for (const s of [1, -1]) m.push(tube([V3(0, -0.14, s * 0.0597), V3(0, -0.4, s * 0.0605), V3(0, -0.65, s * 0.058), V3(0, -(L2 - 0.1), s * 0.05)], 0.0055, { tubular: 16, radial: 4 }));
    for (const s of [1, -1]) m.push(xf(screwGeo(0.013, 8), { r: [0, 0, -s * Math.PI / 2], p: [s * 0.077, -0.112, 0] }));
    link2.add(mesh(sheath, pBody, 'proboscis'), mesh(merge(m), pMetal, 'proboscis'));
  }
  const glossa = new THREE.Group(); link2.add(glossa);
  {
    // annulated glossa ending in the flabellum, a small spoon
    const gl = [[0, 0]];
    const n = 30;
    for (let i = 0; i <= n; i++) { const y = (i / n) * (LG - 0.1), r = 0.026 - (i / n) * 0.007 + (i % 2 ? 0.005 : 0); gl.push([r, y]); }
    gl.push([0.011, LG - 0.085], [0.011, LG - 0.07], [0.03, LG - 0.06], [0.041, LG - 0.035], [0.037, LG - 0.012], [0.022, LG - 0.002], [0, LG]);
    glossa.add(mesh(xf(revolve(gl, { segments: 10, crease: 1.0 }), { r: [Math.PI, 0, 0] }), pMetal, 'proboscis'));
  }
  // Points that must stay clear of the plinth while the proboscis is out: [node, local point, clearance].
  const probes = [[link2, V3(0, 0, 0), 0.06], [link2, V3(0, -L2, 0), 0.075], [glossa, V3(0, -LG, 0), 0.045]];
  const _w = V3(), _o = V3();
  /** e: 0 folded under the head … 1 fully extended (the glossa reaches forward and down to sip at the plinth). */
  function setProboscis(e) {
    e = clamp(e);
    const s1 = smoothstep(0, 0.7, e), s2 = smoothstep(0.15, 0.85, e), s3 = smoothstep(0.45, 1, e);
    link1.rotation.x = lerp(1.45, -1.0, s1);                 // swung back under the head → forward and down
    link2.rotation.x = lerp(-(Math.PI - 0.04), -0.36, s2);   // folded forward between the rails → reaching out
    glossa.position.y = lerp(-(L2 + 0.04 - LG), -(L2 + 0.04 - LG) - 0.75, s3); // slides out of the sheath
    // ground guard: whatever the head's gaze, nothing dips into the plinth — the rails swing clear by just enough
    if (e > 0.002) for (let k = 0; k < 4; k++) {
      pNode.updateWorldMatrix(true, true);
      _o.setFromMatrixPosition(pNode.matrixWorld);
      let worst = 0, R = 1;
      for (const [nd, lp, c] of probes) {
        _w.copy(lp).applyMatrix4(nd.matrixWorld);
        const pen = DIMS.plinthTopY + c - _w.y;
        if (pen > worst) { worst = pen; R = Math.max(0.5, _w.distanceTo(_o)); }
      }
      if (worst <= 1e-4) break;
      link1.rotation.x += (link1.rotation.x < 0.05 ? -1 : 1) * Math.min(0.4, worst / R);
    }
  }
  setProboscis(0);

  // ── head setae: placement lives in fur.js ──────────────────────────────────
  const fur = buildHeadFur({ mats, ex });
  head.add(fur.node);

  // default pose
  for (const i of [0, 1]) poseAntenna(i, REST_ANTENNA);

  return {
    node, pivot, head, eyes, antennae, mandibles, fur, glint: { color: glintU, gain: glintGain },
    poseAntenna, setProboscis,
    anchors: {
      cranium: V3(0, -0.55, 0.78), eyes: V3(1.5, 0.3, 0.2), ocelli: V3(0, 1.42, 0.3), antennae: V3(0.6, 1.1, 1.3),
      mandibles: V3(0.45, -1.45, 0.42), proboscis: V3(0, -1.75, -0.3),
    },
  };
}

/** Resting antenna pose (also the neutral the springs return to). */
export const REST_ANTENNA = { scapeX: 0.5, scapeZ: -0.5, elbowX: 1.3, elbowZ: -0.12, curl: 0.3, swayX: 0, swayZ: 0, spread: 0 };
