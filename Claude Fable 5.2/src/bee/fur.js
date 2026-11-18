// ─────────────────────────────────────────────────────────────────────────────
// bee/fur.js — where the fur grows, and how it is groomed
// Two coats (thorax, head). Each is grown in three steps:
//   1. roots   an even, blue-noise scatter over the analytic body surface
//              (jittered spherical-Fibonacci candidates → Poisson-disc rejection),
//              thinned toward everything the coat must leave clear;
//   2. groom   a flow field over the body — swept back and down, parting around
//              portholes, eyes, sockets and inlay lines — sets each hair's lean
//              and the arc it bends through on the way to its tip;
//   3. length  long and dense in the ruffs (collar, propodeum, vertex, occiput),
//              shorter on the face and under the body, feathered out at every edge.
// setae.js turns the result into instanced ribbons of drawn wire.
//
// Contract (bee.js depends on it): each builder returns
//   { node, meshes, count }
//   node    an explode node (part 'setae') that the caller parents to its body part
//   meshes  InstancedMesh[] — each with userData.sway (THREE.Vector3, mesh space)
//           and userData.shimmer ({ value }) that the rig drives every frame
//   count   number of filaments in this coat
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createSetae } from './setae.js';
import { THORAX, thoraxPoint, thoraxNormal, thoraxHeightAt, headPoint, headNormal, EYE_SEAT } from './surfaces.js';
import { rng, lerp, clamp, smoothstep } from '../core/math.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const MIN_DEN = 0.24;                                             // below this fraction of full density nothing is rooted at all

/**
 * Something the coat keeps clear of. `dist(P, g)` returns the distance from the keep-out's centre line / surface
 * and writes the direction pointing away from it into g.
 *   bare   no roots closer than this          full   full density from here on
 *   reach  the groom is deflected up to here  push   how strongly the flow parts around it
 */
const keepOut = (dist, bare, full, reach = full, push = 0) => ({ dist, bare, full, reach, push });

/**
 * Grow one coat.
 * @param {object} o
 *   seed, spacing (root spacing at full density), candidates (lattice size)
 *   point(phi, lam, out, k), normal(phi, lam, out)   the analytic surface
 *   region(phi, lam, P, st)   → false where bare, else fills st.den (0..1), st.len, st.lift (how erect, 0 flat … 1+ upright)
 *   keepOuts                  → list of keepOut()
 *   flow(P, N, out)           → the groom direction before it is laid onto the surface
 */
function growCoat({ seed, spacing, candidates, point, normal, region, keepOuts, flow, quick }) {
  const rnd = rng(seed);
  const cell = spacing * 1.7, inv = 1 / cell;
  const grid = new Map();
  const key = (ix, iy, iz) => (ix + 512) + 1024 * ((iy + 512) + 1024 * (iz + 512));
  const P = V3(), g = V3(), st = { den: 0, len: 0, lift: 0 };
  const roots = [];
  const jit = Math.sqrt((4 * Math.PI) / candidates) * 0.55;

  // ── 1. roots ───────────────────────────────────────────────────────────────
  for (let i = 0; i < candidates; i++) {
    const y0 = 1 - (2 * i + 1) / candidates, r0 = Math.sqrt(Math.max(0, 1 - y0 * y0)), az = i * GOLDEN;
    let dx = Math.cos(az) * r0 + (rnd() - 0.5) * jit, dy = y0 + (rnd() - 0.5) * jit, dz = Math.sin(az) * r0 + (rnd() - 0.5) * jit;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    if (quick && !quick(dx, dy, dz)) continue;                   // cheap cull of directions that cannot be furred
    const phi = Math.atan2(dx, dz), lam = Math.asin(clamp(dy, -1, 1));
    if (!region(phi, lam, P, st)) continue;
    let den = st.den, px = 0, py = 0, pz = 0;
    for (const k of keepOuts) {
      const d = k.dist(P, g, phi, lam);
      if (d >= k.reach && d >= k.full) continue;
      den *= smoothstep(k.bare, k.full, d);
      if (den < MIN_DEN) break;
      if (k.push) { const w = k.push * (1 - smoothstep(k.bare, k.reach, d)); px += g.x * w; py += g.y * w; pz += g.z * w; }
    }
    if (den < MIN_DEN) continue;                                 // no lone stragglers: the coat ends in a short, thinning fringe
    const s = spacing / Math.sqrt(den), s2 = s * s;
    const ix = Math.floor(P.x * inv), iy = Math.floor(P.y * inv), iz = Math.floor(P.z * inv), reach = Math.ceil(s * inv);
    let ok = true;
    for (let a = -reach; a <= reach && ok; a++) for (let b = -reach; b <= reach && ok; b++) for (let c = -reach; c <= reach && ok; c++) {
      const bucket = grid.get(key(ix + a, iy + b, iz + c));
      if (!bucket) continue;
      for (let j = 0; j < bucket.length; j += 3) {
        const ex = bucket[j] - P.x, ey = bucket[j + 1] - P.y, ez = bucket[j + 2] - P.z;
        if (ex * ex + ey * ey + ez * ez < s2) { ok = false; break; }
      }
    }
    if (!ok) continue;
    const kk = key(ix, iy, iz);
    let bucket = grid.get(kk); if (!bucket) grid.set(kk, (bucket = []));
    bucket.push(P.x, P.y, P.z);
    roots.push({ phi, lam, pos: P.clone(), den, len: st.len, lift: st.lift, push: V3(px, py, pz) });
  }

  // ── 2 + 3. groom and length ────────────────────────────────────────────────
  const N = V3(), F = V3(), Ft = V3();
  return roots.map((r) => {
    normal(r.phi, r.lam, N);
    flow(r.pos, N, F).add(r.push);
    // a slow wander in the groom, so the coat has cowlicks instead of a ruled comb
    F.x += Math.sin(r.pos.y * 2.3 + r.pos.z * 1.4 + 1.7) * 0.16; F.y += Math.sin(r.pos.z * 2.0 + r.pos.x * 2.6 + 4.1) * 0.16; F.z += Math.sin(r.pos.x * 1.8 + r.pos.y * 3.1 + 0.3) * 0.16;
    Ft.copy(F).addScaledVector(N, -F.dot(N));                    // laid onto the surface
    const lay = Math.min(1, Ft.length());                        // 0 where the flow meets the surface head-on (the hair stands), 1 where it runs along it
    const edge = smoothstep(MIN_DEN, 0.62, r.den);               // feather out toward every keep-out
    // the root stands (a pile, not a thatch); the arc then lays the tip over along the groom
    const dir = Ft.clone().addScaledVector(N, r.lift)
      .add(V3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.62)).normalize();
    if (dir.dot(N) < 0.45) dir.addScaledVector(N, 0.45 - dir.dot(N)).normalize();
    const bend = Ft.clone().multiplyScalar(0.34).addScaledVector(N, -(0.1 + 0.17 * lay));
    bend.y -= 0.03;                                              // and a little weight
    const lk = rnd();
    const len = r.len * (0.72 + 0.5 * lk * lk + (rnd() < 0.035 ? 0.3 : 0)) * (0.45 + 0.55 * edge);   // a few guard hairs stand proud
    return { pos: r.pos, dir, len, r: (0.0039 + 0.0024 * rnd()) * (0.85 + 0.6 * len), bend, skin: N.clone(), rnd: rnd() };
  });
}

// distance helpers ------------------------------------------------------------
const mirrorBall = (c) => (P, g) => { g.set(Math.abs(P.x) - c.x, P.y - c.y, P.z - c.z); const d = g.length() || 1; g.divideScalar(d); if (P.x < 0) g.x = -g.x; return d; };
const ball = (c) => (P, g) => { g.subVectors(P, c); const d = g.length() || 1; g.divideScalar(d); return d; };

/** Thorax: the pronotal collar ruff and the propodeal ruff, parted round everything set into them. Frame = thorax frame. */
export function buildThoraxFur({ mats, ex }) {
  const { beltLo, beltHi } = THORAX;
  const top = beltLo - 0.105;                                    // the coat stops short of the gilt rim band
  const hingeY = (thoraxHeightAt(beltLo) + thoraxHeightAt(beltHi)) / 2;
  const Q = V3();
  // Features of the chassis, laid out the way thorax.js lays them out: in the flat side view (y, z) of a flank.
  const SUTURES = [
    [[0.7, 1.12], [0.3, 1.1], [-0.2, 1.06], [-0.65, 0.97], [-1.0, 0.8]],          // pronotal: collar | mesopleuron
    [[0.55, -0.9], [0.15, -0.88], [-0.35, -0.85], [-0.8, -0.76], [-1.1, -0.58]],  // meso | metapleuron
    [[0.62, -1.36], [0.2, -1.36], [-0.3, -1.34], [-0.75, -1.22]],                 // metapleuron | propodeum
  ];
  /** An oval on the flank (both sides, or only the left with `leftOnly`): distance outside its rim. */
  const sideOval = (yc, zc, ry, rz, leftOnly = false) => (P, g) => {
    if (Math.abs(P.x) < 0.45 || (leftOnly && P.x < 0)) return 9;
    const qy = (P.y - yc) / ry, qz = (P.z - zc) / rz, q = Math.hypot(qy, qz) || 1;
    g.set(0, qy / ry, qz / rz).normalize();
    return (q - 1) * Math.min(ry, rz);
  };
  /** An inlaid suture drawn through side-view points: distance to the polyline. */
  const sideLine = (pts) => (P, g) => {
    if (Math.abs(P.x) < 0.45) return 9;
    let best = 9;
    for (let i = 0; i < pts.length - 1; i++) {
      const [y0, z0] = pts[i], [y1, z1] = pts[i + 1], ey = y1 - y0, ez = z1 - z0;
      const t = clamp(((P.y - y0) * ey + (P.z - z0) * ez) / (ey * ey + ez * ez), 0, 1);
      const dy = P.y - (y0 + ey * t), dz = P.z - (z0 + ez * t), d = Math.hypot(dy, dz);
      if (d < best) { best = d; g.set(0, dy / (d || 1), dz / (d || 1)); }
    }
    return best;
  };
  const keepOuts = [
    // the belt: nothing roots near it, and the groom is combed down away from it
    keepOut((P, g, phi, lam) => { thoraxPoint(phi, lam - 0.03, Q, 0.997); g.subVectors(Q, P).normalize(); return (top - lam) * 1.6; }, 0, 0.16, 0.55, 1.15),
    // porthole turrets (both flanks): the spot-faced boss reaches r 0.82
    keepOut((P, g) => { if (Math.abs(P.x) < 0.9) return 9; const dy = P.y + 0.19, dz = P.z - 0.1, d = Math.hypot(dy, dz) || 1; g.set(0, dy / d, dz / d); return d; }, 0.9, 1.08, 1.45, 1.25),
    // wing hinges, fore and hind
    keepOut(mirrorBall(V3(1.42, hingeY, 0.52)), 0.46, 0.66, 0.8, 0.6),
    keepOut(mirrorBall(V3(1.4, hingeY - 0.03, -0.46)), 0.46, 0.66, 0.8, 0.6),
    // neck ring (front) and petiole ring (rear)
    keepOut((P, g) => { if (P.z < 0.4) return 9; const dy = P.y - 0.05, d = Math.hypot(P.x, dy) || 1; g.set(P.x / d, dy / d, 0); return d; }, 0.73, 0.9),
    keepOut((P, g) => { if (P.z > -0.4) return 9; const dy = P.y + 0.12, d = Math.hypot(P.x, dy) || 1; g.set(P.x / d, dy / d, 0); return d; }, 0.79, 0.96),
    // the six coxal sockets on their screwed bosses, and the sternal boss
    keepOut(mirrorBall(V3(0.62, -1.36, 1.02)), 0.52, 0.66, 0.86, 0.7),
    keepOut(mirrorBall(V3(0.74, -1.47, 0.04)), 0.52, 0.66, 0.86, 0.7),
    keepOut(mirrorBall(V3(0.66, -1.36, -0.98)), 0.52, 0.66, 0.86, 0.7),
    keepOut(ball(V3(0, -1.66, 0)), 0.36, 0.5, 0.62, 0.5),
    // the sternal keel and the mid-line of the collar and the propodeum: the coat parts along them
    keepOut((P, g, phi, lam) => { if (P.z > 0 ? lam > 0.2 : lam > 0.38) return 9; g.set(P.x < 0 ? -1 : 1, 0, 0); return Math.abs(P.x) - (P.y < -1.2 ? 0.09 : 0); }, 0.03, 0.075, 0.24, 0.4),
    // pleural sutures (pronotal · meso|meta · meta|propodeum), inlaid: a fine parting follows each
    keepOut(sideLine(SUTURES[0]), 0.022, 0.05, 0.16, 0.3),
    keepOut(sideLine(SUTURES[1]), 0.022, 0.05, 0.16, 0.3),
    keepOut(sideLine(SUTURES[2]), 0.022, 0.05, 0.16, 0.3),
    // spiracle grilles, the metapleural access plate, and the maker's cartouche (left flank only)
    keepOut(sideOval(0.22, 1.37, 0.19, 0.115), 0.03, 0.09, 0.26, 0.8),
    keepOut(sideOval(0.2, -1.6, 0.21, 0.1), 0.03, 0.09, 0.26, 0.8),
    keepOut(sideOval(-0.42, -1.12, 0.28, 0.125), 0.04, 0.12, 0.3, 0.8),
    keepOut(sideOval(-1.16, 0.1, 0.07, 0.2, true), 0.05, 0.13, 0.3, 0.6),
  ];
  // where a suture crosses a given height of the flank (side-view z at y)
  const sutureZ = (pts, y) => {
    if (y >= pts[0][0]) return pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) if (y >= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (pts[i][0] - y) / (pts[i][0] - pts[i + 1][0]));
    return pts[pts.length - 1][1];
  };
  const hairs = growCoat({
    seed: 11, spacing: 0.0165, candidates: 300000,
    point: thoraxPoint, normal: thoraxNormal, keepOuts,
    quick: (dx, dy, dz) => dy < 0.4 && Math.abs(dz) > 0.3,       // below the belt, and on the two end caps only
    region(phi, lam, P, st) {
      if (lam > top) return false;
      thoraxPoint(phi, lam, P, 0.997);
      // the coat follows the sclerites: a ruff right round the pronotal collar (ahead of the pronotal suture) and
      // another round the propodeum (behind the last one), shorter where they pass under the body. Between the two
      // the enamel stays bare: the porthole turret, the access plate, the keel and the six coxal bosses fill it,
      // and the scraps of pile that would fit between them read as stubble, not fur.
      const z1 = sutureZ(SUTURES[0], P.y), z3 = sutureZ(SUTURES[2], P.y);
      const ruff = Math.max(smoothstep(z1 - 0.07, z1 + 0.13, P.z), smoothstep(-z3 - 0.07, -z3 + 0.13, -P.z));
      const under = smoothstep(-0.95, -1.4, P.y);
      st.den = ruff * (1 - 0.2 * under);
      if (st.den < MIN_DEN) return false;
      st.len = lerp(0.14, 0.25, ruff) * (1 - 0.4 * under);
      st.lift = lerp(1.1, 1.5, ruff);
      return true;
    },
    flow: (P, N, out) => out.set(0, -0.18, -1),                  // swept back, and a little down
  });
  const node = ex.node('setae', { dir: [0, 0.6, 1], dist: 5.4, at: 0.2 });
  const mesh = createSetae(mats.get('filament', 'setae', { key: 'thorax' }), hairs);
  node.add(mesh);
  return { node, meshes: [mesh], count: hairs.length };
}

/** Head: face between the eyes, vertex, occiput, temples. Frame = head frame (origin at the head centre). */
export function buildHeadFur({ mats, ex }) {
  const E = EYE_SEAT, ea = E.a + 0.1, eb = E.b + 0.1, ec = E.c + 0.1;
  const socket = headPoint(0.255, 0.2014);
  socket.x = Math.abs(socket.x);
  const keepOuts = [
    // compound eyes: the pile stops short of the bezel and is combed along its rim instead of over it
    keepOut((P, g) => {
      const qx = (Math.abs(P.x) - E.centre.x) / ea, qy = (P.y - E.centre.y) / eb, qz = (P.z - E.centre.z) / ec, q = Math.hypot(qx, qy, qz) || 1;
      g.set((P.x < 0 ? -1 : 1) * qx / ea, qy / eb, qz / ec).normalize();
      return (q - 1) * 0.62;
    }, 0, 0.13, 0.42, 1.3),
    keepOut(mirrorBall(socket), 0.31, 0.42, 0.6, 0.85),                               // antennal sockets
    keepOut(ball(headPoint(0, 1.05)), 0.2, 0.27, 0.38, 0.6),                          // ocelli triad
    keepOut(mirrorBall(V3().copy(headPoint(0.62, 1.24))), 0.19, 0.26, 0.36, 0.6),
    // occipital ring and its rivet circle (back of the head)
    keepOut((P, g) => { if (P.z > -0.05) return 9; const dy = P.y - 0.15, d = Math.hypot(P.x, dy) || 1; g.set(P.x / d, dy / d, 0); return d; }, 0.85, 1.0),
    // median facial line: a parting
    keepOut((P, g, phi, lam) => { if (P.z < 0 || lam < 0.36 || lam > 1.4) return 9; g.set(P.x < 0 ? -1 : 1, 0, 0); return Math.abs(P.x); }, 0.026, 0.065, 0.2, 0.35),
  ];
  const hairs = growCoat({
    seed: 23, spacing: 0.0165, candidates: 260000,
    point: headPoint, normal: headNormal, keepOuts,
    region(phi, lam, P, st) {
      if (lam < -1.0) return false;
      const front = smoothstep(-0.25, 0.3, Math.cos(phi));
      const floor = lerp(-0.86, 0.3, front);                     // the face below the antennae (clypeus, mandibles, proboscis) stays bare enamel
      const low = smoothstep(floor - 0.2, floor, lam);
      if (low < 0.05) return false;
      headPoint(phi, lam, P, 0.997);
      const crown = smoothstep(0.75, 1.2, lam);                  // vertex
      st.den = (0.78 + 0.22 * crown - 0.18 * (1 - front) * (1 - crown)) * low;
      st.len = 0.115 + 0.1 * crown + 0.06 * (1 - front) * (1 - crown);
      st.lift = 1.15 + 0.3 * crown;
      return true;
    },
    // radial on the face (out from between the antennae, up over the brow), then swept back over the vertex and down the occiput
    flow: (P, N, out) => out.set(0, 0.34 * clamp(P.z / 0.5, -0.7, 1), -1),
  });
  const node = ex.node('setae', { dir: [0, 1, 0.1], dist: 2.9, at: 0.2, name: 'ex:setae:head' });
  const mesh = createSetae(mats.get('filament', 'setae', { key: 'head' }), hairs);
  node.add(mesh);
  return { node, meshes: [mesh], count: hairs.length };
}
