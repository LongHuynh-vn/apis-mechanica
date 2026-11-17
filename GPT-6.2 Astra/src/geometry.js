import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const vec = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const mix = T.MathUtils.lerp;
export function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function damp(a, b, speed, dt) {
  return mix(a, b, 1 - Math.exp(-speed * dt));
}
export function random(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function group(parent, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const sphere = new T.SphereGeometry(1, 32, 20);
const smallSphere = new T.SphereGeometry(1, 14, 10);
const axisY = vec(0, 1, 0);
const ident = new T.Quaternion();
function packed(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes))
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv)
    g.setAttribute(
      'uv',
      new T.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)
    );
  return g;
}
// Static pieces share a draw call inside their rigid, selectable mount.
export class Batch {
  constructor(parent, materials, part) {
    this.parent = parent;
    this.materials = materials;
    this.part = part;
    this.bins = new Map();
  }
  add(role, geometry, pos = vec(), scale = vec(1, 1, 1), q = ident) {
    const g = packed(geometry.clone()).applyMatrix4(new T.Matrix4().compose(pos, q, scale));
    if (!this.bins.has(role)) this.bins.set(role, []);
    this.bins.get(role).push(g);
    return this;
  }
  ell(role, p, s, small = false) {
    return this.add(role, small ? smallSphere : sphere, V(p), V(s));
  }
  rod(role, a, b, r1, r2 = r1, n = 12) {
    a = V(a);
    b = V(b);
    const d = b.clone().sub(a);
    const l = d.length();
    if (l < 0.0001) return this;
    return this.add(
      role,
      new T.CylinderGeometry(r2, r1, l, n, 1, false),
      a.clone().lerp(b, 0.5),
      vec(1, 1, 1),
      new T.Quaternion().setFromUnitVectors(axisY, d.normalize())
    );
  }
  tube(role, points, r = 0.012, steps = 24, sides = 6, closed = false) {
    const curve = new T.CatmullRomCurve3(points.map(V), closed, 'centripetal');
    return this.add(role, new T.TubeGeometry(curve, steps, r, sides, closed));
  }
  box(role, p, s, rotation = 0) {
    return this.add(
      role,
      new T.BoxGeometry(...s),
      V(p),
      vec(1, 1, 1),
      new T.Quaternion().setFromAxisAngle(vec(0, 0, 1), rotation)
    );
  }
  hoop(role, center, r, tube, normal = vec(0, 0, 1), sy = 1) {
    return this.add(
      role,
      new T.TorusGeometry(r, tube, 8, 52),
      V(center),
      vec(1, sy, 1),
      new T.Quaternion().setFromUnitVectors(vec(0, 0, 1), V(normal).normalize())
    );
  }
  finish() {
    const meshes = [];
    for (const [role, gs] of this.bins) {
      const geometry = gs.length === 1 ? gs[0] : mergeGeometries(gs);
      const mesh = new T.Mesh(geometry, this.materials.get(role, this.part));
      mesh.userData.part = this.part;
      mesh.userData.role = role;
      if (role === 'lamp' || role === 'amber') mesh.layers.enable(1);
      this.parent.add(mesh);
      meshes.push(mesh);
    }
    this.bins.clear();
    return meshes;
  }
}
export const V = (p) => (p?.isVector3 ? p.clone() : vec(...p));
export function instances(parent, geometry, material, matrices, part, colors) {
  if (!matrices.length) return;
  const m = new T.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, i) => {
    m.setMatrixAt(i, matrix);
    if (colors) m.setColorAt(i, colors[i]);
  });
  m.userData.part = part;
  m.computeBoundingSphere();
  parent.add(m);
  return m;
}
export function transform(p, s = vec(1, 1, 1), q = ident) {
  return new T.Matrix4().compose(V(p), q, V(s));
}
export function rodMatrix(a, b, r1, r2 = r1) {
  const d = V(b).sub(V(a));
  return transform(
    V(a).lerp(V(b), 0.5),
    [r1, d.length(), r2],
    new T.Quaternion().setFromUnitVectors(axisY, d.normalize())
  );
}
export function surface(fn, nu = 32, nv = 32) {
  const positions = [],
    uv = [],
    indices = [];
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const u = i / nu,
        v = j / nv,
        p = fn(u, v);
      positions.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j,
        b = a + nv + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
// The clockwise section angle measures down from the dorsal seam.
export function loftPoint(profile, u, angle, inflate = 0) {
  const f = clamp(u) * (profile.length - 1),
    i = Math.min(profile.length - 2, Math.floor(f)),
    t = f - i;
  const a = profile[i],
    b = profile[i + 1],
    p = profile[Math.max(0, i - 1)],
    q = profile[Math.min(profile.length - 1, i + 2)];
  function ordinate(k) {
    const s0 = p[k] || 0,
      s1 = a[k] || 0,
      s2 = b[k] || 0,
      s3 = q[k] || 0;
    return (
      0.5 *
      (2 * s1 +
        (-s0 + s2) * t +
        (2 * s0 - 5 * s1 + 4 * s2 - s3) * t * t +
        (-s0 + 3 * s1 - 3 * s2 + s3) * t * t * t)
    );
  }
  return vec(
    mix(a[0], b[0], t),
    ordinate(3) + Math.cos(angle) * (ordinate(1) + inflate),
    Math.sin(angle) * (ordinate(2) + inflate)
  );
}
export function loft(profile, a = -Math.PI, b = Math.PI, nu = 40, nv = 52) {
  return surface((u, v) => loftPoint(profile, u, mix(b, a, v)), nu, nv);
}
export function sweep(fn, count = 26) {
  return Array.from({ length: count + 1 }, (_, i) => fn(i / count));
}
export function capsulePanel(batch, a, b, width, role = 'body') {
  const start = V(a),
    end = V(b),
    delta = end.clone().sub(start),
    direction = delta.clone().normalize();
  const q = new T.Quaternion().setFromUnitVectors(axisY, direction),
    mid = start.clone().lerp(end, 0.5);
  batch.add(
    'metal',
    new T.SphereGeometry(1, 16, 12),
    mid,
    vec(width * 1.13, delta.length() * 0.51, width * 0.84),
    q
  );
  batch.add(
    role,
    new T.SphereGeometry(1, 24, 14),
    mid.clone().add(vec(0, 0.009, 0)),
    vec(width, delta.length() * 0.456, width * 0.89),
    q
  );
}
export function screwMatrices(points, radius = 0.035, side = 1) {
  const q = new T.Quaternion().setFromUnitVectors(axisY, vec(0, 0, side));
  return points.map((p) => transform(p, [radius, 0.015, radius], q));
}
export const screwGeometry = new T.CylinderGeometry(0.84, 1, 1, 12, 1);
export const filamentGeometry = new T.CylinderGeometry(0.16, 1, 1, 4, 1);
