import * as T from 'three';
import {
  vec,
  group,
  TAU,
  loft,
  loftPoint,
  sweep,
  instances,
  random,
  rodMatrix,
  filamentGeometry,
  screwGeometry,
  screwMatrices,
  mix,
} from '../geometry.js';

function lenses(bee, parent, side) {
  const rx = 0.357,
    ry = 0.405,
    rz = 0.223,
    r = 0.052;
  const g = new T.BufferGeometry(),
    positions = [],
    uv = [],
    indices = [];
  for (const [rad, height] of [
    [1, -0.49],
    [0.93, 0.16],
    [0.64, 0.63],
    [0.26, 0.78],
  ]) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI * 0.5 + (i * TAU) / 6,
        x = Math.cos(angle) * rad,
        y = Math.sin(angle) * rad;
      positions.push(x, y, height);
      uv.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
    }
  }
  positions.push(0, 0, 0.81);
  uv.push(0.5, 0.5);
  for (let ring = 0; ring < 3; ring++)
    for (let i = 0; i < 6; i++) {
      const a = ring * 6 + i,
        b = ring * 6 + ((i + 1) % 6);
      indices.push(a, b, a + 6, b, b + 6, a + 6);
    }
  for (let i = 0; i < 6; i++) indices.push(18 + i, 18 + ((i + 1) % 6), 24);
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const matrices = [],
    colors = [],
    rng = random(263),
    dark = new T.Color(),
    p = vec();
  function point(u, v) {
    const d = u * u + v * v,
      k = Math.sqrt(Math.max(0.001, 2 - d));
    return vec(rx * u * k, ry * v * k, side * rz * (1 - d));
  }
  for (let j = -13; j <= 13; j++)
    for (let i = -14; i <= 14; i++) {
      const u = (i + (j & 1) * 0.5) * r * Math.sqrt(3),
        v = j * r * 1.5;
      if (u * u + v * v > 0.966) continue;
      p.copy(point(u, v));
      const du = point(u + 0.0001, v)
          .sub(p)
          .multiplyScalar(10000),
        dv = point(u, v + 0.0001)
          .sub(p)
          .multiplyScalar(10000);
      const n = vec(p.x / rx ** 2, p.y / ry ** 2, p.z / rz ** 2).normalize();
      const mat = new T.Matrix4().makeBasis(
        du.multiplyScalar(r * 0.964 * side),
        dv.multiplyScalar(r * 0.964),
        n.multiplyScalar(0.011)
      );
      mat.setPosition(p.clone().addScaledVector(n, 0.22));
      matrices.push(mat);
      const value = 0.41 + rng() * 0.48;
      dark.setRGB(value * 0.92, value * 0.95, value);
      colors.push(dark.clone());
    }
  const carrier = bee.mount(parent, 'eyes', [0, 0, 0], [0, 0, side * 0.1], 0, false);
  const obj = instances(carrier, g, bee.materials.get('lens', 'eyes'), matrices, 'eyes', colors);
  bee.eyes.push(obj);
  return matrices.length;
}
function eye(bee, side) {
  const seat = bee.mount(
    bee.head,
    'eyes',
    [-0.36, 0.12, side * 0.369],
    [-0.13, 0.025, side * 0.55],
    0.025
  );
  seat.rotation.y = -side * 0.4;
  seat.rotation.z = -0.27;
  seat.scale.set(0.89, 0.94, 1.04);
  const b = bee.batch(seat, 'eyes');
  b.ell('bronze', [0, 0.002, -side * 0.028], [0.397, 0.443, 0.168]);
  b.ell('eye', [0, 0, 0], [0.368, 0.416, 0.221]);
  b.hoop('metal', [0, 0, side * 0.013], 0.376, 0.023, vec(0, 0, side), 1.13);
  b.hoop('edge', [0, 0, side * 0.043], 0.354, 0.01, vec(0, 0, side), 1.14);
  b.tube(
    'dark',
    sweep((t) => {
      const a = -0.5 + t * 3.3;
      return vec(Math.cos(a) * 0.376, Math.sin(a) * 0.426, side * 0.025);
    }),
    0.008
  );
  b.finish();
  lenses(bee, seat, side);
  const pins = sweep((t) => {
    const a = t * TAU;
    return [Math.cos(a) * 0.383, Math.sin(a) * 0.435, side * 0.034];
  }, 15).slice(0, -1);
  instances(
    seat,
    screwGeometry,
    bee.materials.get('edge', 'eyes'),
    screwMatrices(pins, 0.014, side),
    'eyes'
  );
  bee.anchor('eyes', seat, [0, 0.01, side * 0.22]);
}
export function fur(bee, parent, profile, u0, u1, n, seed) {
  const rng = random(seed),
    matrices = [];
  for (let i = 0; i < n; i++) {
    const u = mix(u0, u1, rng()),
      a = (rng() - 0.5) * Math.PI * 1.82,
      b = loftPoint(profile, u, a);
    const direction = vec(-0.22 + rng() * 0.46, Math.cos(a), Math.sin(a)).normalize();
    const tip = b
      .clone()
      .addScaledVector(direction, 0.028 + rng() * 0.047)
      .add(vec(0.027, 0, 0));
    matrices.push(rodMatrix(b, tip, 0.0018 + rng() * 0.0016));
  }
  const g = bee.mount(parent, 'setae', [0, 0, 0], [0.015, 0.14, 0], 0.03, false);
  instances(g, filamentGeometry, bee.materials.get('edge', 'setae'), matrices, 'setae');
  bee.fur.push({ g, seed });
  bee.anchor('setae', g, loftPoint(profile, (u0 + u1) / 2, 0.53));
}
function antenna(bee, s) {
  const root = bee.mount(
    bee.head,
    'antennae',
    [-0.53, 0.32, s * 0.215],
    [-0.27, 0.46, s * 0.22],
    0.035
  );
  const scape = group(root),
    b = bee.batch(scape, 'antennae');
  const elbow = vec(-0.23, 0.46, s * 0.19);
  b.ell('bronze', [0, 0, 0], [0.087, 0.075, 0.075], true);
  b.ell('edge', [-0.015, 0.025, s * 0.01], [0.057, 0.059, 0.058], true);
  b.rod('metal', [0, 0.015, 0], elbow, 0.044, 0.037, 14);
  b.rod(
    'dark',
    elbow.clone().multiplyScalar(0.2),
    elbow.clone().multiplyScalar(0.24),
    0.047,
    0.045
  );
  b.rod(
    'edge',
    elbow.clone().multiplyScalar(0.78),
    elbow.clone().multiplyScalar(0.84),
    0.043,
    0.044
  );
  b.ell('dark', elbow, [0.062, 0.06, 0.058], true);
  b.ell('edge', elbow.clone().add(vec(-0.012, 0.013, s * 0.009)), [0.049, 0.049, 0.049], true);
  b.finish();
  let p = group(scape, elbow.x, elbow.y, elbow.z);
  const joints = [];
  for (let k = 0; k < 10; k++) {
    const q = group(p);
    const t = k / 9,
      len = 0.089 - 0.014 * t;
    const d = vec(-len, 0.043 - 0.064 * t, s * (0.025 - 0.022 * t)),
      rad = 0.035 - 0.012 * t;
    const bb = bee.batch(q, 'antennae');
    bb.rod(k % 4 === 0 ? 'dark' : 'bronze', [0, 0, 0], d, rad, rad * 0.89, 10);
    bb.rod(
      'edge',
      d.clone().multiplyScalar(0.12),
      d.clone().multiplyScalar(0.81),
      rad * 1.09,
      rad * 0.99,
      12
    );
    bb.ell('dark', d, [rad * 0.8, rad * 0.8, rad * 0.8], true);
    bb.finish();
    joints.push(q);
    p = group(q, d.x, d.y, d.z);
  }
  bee.antennae.push({ s, scape, joints });
  bee.anchor('antennae', joints[5], [0, 0, 0]);
}
export function buildHead(bee) {
  const p = [
    [-0.71, 0.048, 0.09, -0.045],
    [-0.65, 0.27, 0.29, -0.002],
    [-0.53, 0.426, 0.425, 0.028],
    [-0.32, 0.483, 0.494, 0.045],
    [-0.12, 0.443, 0.46, 0.04],
    [0.035, 0.345, 0.352, 0.025],
    [0.11, 0.22, 0.24, 0.014],
  ];
  const b = bee.batch(bee.head, 'head');
  b.add('dark', loft(p), vec(0.005, 0, 0), vec(0.992, 0.972, 0.97));
  b.add('body', loft(p.slice(0, 6), -2.39, 2.39));
  const mask = [
    [-0.805, 0.002, 0.003, -0.109],
    [-0.795, 0.055, 0.095, -0.109],
    [-0.771, 0.121, 0.166, -0.097],
    [-0.712, 0.198, 0.219, -0.054],
    [-0.641, 0.231, 0.236, -0.016],
    [-0.576, 0.206, 0.216, 0.026],
  ];
  b.add('body', loft(mask, -2.35, 2.35, 18, 30));
  for (const s of [-1, 1]) {
    b.tube(
      'metal',
      sweep((t) => loftPoint(mask, t, s * (0.64 + 0.73 * t), 0.006)),
      0.008,
      19,
      6
    );
    b.tube(
      'bronze',
      sweep((t) => loftPoint(mask, 0.68, s * (0.42 + 0.89 * t), 0.008)),
      0.006,
      16,
      5
    );
  }
  b.hoop('bronze', [0.07, 0.04, 0], 0.29, 0.059, vec(1, 0, 0), 1.03);
  b.hoop('edge', [0.11, 0.04, 0], 0.29, 0.016, vec(1, 0, 0));
  for (const s of [-1, 1]) {
    b.tube(
      'metal',
      sweep((t) => loftPoint(p, t * 0.85, s * (0.39 + 0.58 * t), 0.008)),
      0.012,
      27
    );
    b.tube(
      'bronze',
      sweep((t) => loftPoint(p, 0.74, s * (0.1 + 2.25 * t), 0.009)),
      0.014,
      26
    );
    b.tube(
      'edge',
      sweep((t) => loftPoint(p, 0.765, s * (0.12 + 2.12 * t), 0.01)),
      0.006,
      24
    );
    b.rod('metal', [-0.66, -0.1, s * 0.15], [-0.69, -0.19, s * 0.14], 0.055, 0.044);
    eye(bee, s);
    antenna(bee, s);
    const j = bee.mount(
      bee.head,
      'mandibles',
      [-0.55, -0.22, s * 0.2],
      [-0.22, -0.3, s * 0.17],
      0.11
    );
    const jaw = bee.batch(j, 'mandibles');
    jaw.ell('bronze', [0, 0, 0], [0.1, 0.08, 0.09], true);
    const path = new T.CatmullRomCurve3([
      vec(0, 0, 0),
      vec(-0.107, -0.085, s * 0.03),
      vec(-0.187, -0.135, -s * 0.03),
      vec(-0.228, -0.125, -s * 0.092),
      vec(-0.251, -0.085, -s * 0.145),
    ]);
    for (let k = 0; k < 15; k++) {
      const u = k / 15,
        v = (k + 1) / 15,
        jawRadius = (t) => 0.002 + 0.048 * (1 - t) ** 0.68;
      jaw.rod('metal', path.getPoint(u), path.getPoint(v), jawRadius(u), jawRadius(v), 12);
    }
    jaw.finish();
    bee.anchor('mandibles', j, [-0.17, -0.1, 0]);
  }
  b.finish();
  bee.anchor('head', bee.head, [-0.52, 0.23, 0.04]);
  fur(bee, bee.head, p, 0.61, 0.87, 330, 48);
  const crown = bee.mount(bee.head, 'ocelli', [-0.3, 0.49, 0], [-0.04, 0.42, 0], 0.04);
  const jewel = bee.batch(crown, 'ocelli');
  for (const [x, z] of [
    [-0.12, 0],
    [0.025, 0.125],
    [0.025, -0.125],
  ]) {
    jewel.ell('metal', [x, -0.011, z], [0.075, 0.032, 0.075], true);
    jewel.ell('eye', [x, 0.008, z], [0.055, 0.035, 0.055], true);
    jewel.hoop('edge', [x, 0.008, z], 0.058, 0.008, vec(0, 1, 0));
  }
  jewel.finish();
  bee.anchor('ocelli', crown, [0, 0.02, 0]);
  const mouth = bee.mount(bee.head, 'proboscis', [-0.465, -0.3, 0], [-0.12, -0.41, 0], 0.17);
  bee.tongue = group(mouth);
  const bb = bee.batch(bee.tongue, 'proboscis');
  bb.rod('bronze', [0, 0, 0], [0.21, -0.074, 0], 0.061, 0.041, 14);
  bb.rod('edge', [0.19, -0.068, 0], [0.38, -0.091, 0], 0.039, 0.028, 12);
  bb.finish();
  bee.glossa = group(bee.tongue, 0.32, -0.09, 0);
  const tip = bee.batch(bee.glossa, 'proboscis');
  tip.rod('metal', [0, 0, 0], [0.27, -0.005, 0], 0.026, 0.01);
  tip.ell('amber', [0.27, -0.005, 0], [0.028, 0.015, 0.022], true);
  tip.finish();
  bee.anchor('proboscis', bee.glossa, [0.12, 0, 0]);
}
