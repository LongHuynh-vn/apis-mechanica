import * as T from 'three';
import {
  vec,
  group,
  loft,
  TAU,
  surface,
  sweep,
  mix,
  clamp,
  instances,
  screwGeometry,
  screwMatrices,
} from '../geometry.js';

const stations = [
  [0, 0.18],
  [0.13, 0.28],
  [0.32, 0.419],
  [0.55, 0.508],
  [0.8, 0.546],
  [1.04, 0.554],
  [1.29, 0.528],
  [1.54, 0.466],
  [1.76, 0.374],
  [1.98, 0.25],
  [2.14, 0.139],
  [2.21, 0.055],
];
function radius(x) {
  let i = 0;
  while (i < stations.length - 2 && stations[i + 1][0] < x) i++;
  const a = stations[i],
    b = stations[i + 1];
  return mix(a[1], b[1], clamp((x - a[0]) / (b[0] - a[0])));
}
const center = (x) => 0.065 + 0.061 * Math.sin(x * 1.65) - 0.095 * x;
function collar(batch, role, point, u, r) {
  batch.tube(
    role,
    sweep((t) => point(u, t * TAU), 52),
    r,
    54,
    7
  );
}

// A perforated patch is constructed around each aperture in the unrolled shell.
// Matching outer/inner perimeter samples give each window a continuous, bevelled wall.
const border = [
  [0, 0.25],
  [0, 0.75],
  [0, 1],
  [0.5, 1],
  [1, 1],
  [1, 0.75],
  [1, 0.25],
  [1, 0],
  [0.5, 0],
  [0, 0],
];
const hex = [
  [0.14, 0.3],
  [0.14, 0.7],
  [0.32, 0.81],
  [0.5, 0.91],
  [0.68, 0.81],
  [0.86, 0.7],
  [0.86, 0.3],
  [0.68, 0.19],
  [0.5, 0.09],
  [0.32, 0.19],
];
function windowCell(b, point, u0, u1, a0, a1) {
  const ps = [],
    uv = [],
    ind = [];
  const decode = (pt, lift = 0) => point(mix(u0, u1, pt[0]), mix(a0, a1, pt[1]), lift);
  for (const ring of [border, hex])
    for (const xy of ring) {
      const p = decode(xy);
      ps.push(...p.toArray());
      uv.push(...xy);
    }
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10;
    ind.push(i, j, 10 + i, j, 10 + j, 10 + i);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(ps, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  g.computeVertexNormals();
  b.add('body', g);
  const rim = hex.map((p) => decode(p, 0.003));
  for (let k = 0; k < 10; k++) {
    const j = (k + 1) % 10;
    b.rod('metal', rim[k], rim[j], 0.009, 0.009, 6);
    const p1 = rim[k],
      p2 = rim[j],
      d1 = decode(hex[k], -0.041),
      d2 = decode(hex[j], -0.041);
    b.add(
      'bronze',
      surface((u, v) => p1.clone().lerp(p2, u).lerp(d1.clone().lerp(d2, u), v), 1, 1)
    );
  }
}
export function buildAbdomen(bee) {
  const waist = bee.batch(bee.abdomen, 'petiole');
  waist.rod('dark', [-0.2, 0, 0], [0.21, 0, 0], 0.174, 0.217, 26);
  for (let i = 0; i < 7; i++)
    waist.hoop(
      i % 2 ? 'edge' : 'bronze',
      [-0.17 + i * 0.055, 0.018, 0],
      0.176 + Math.sin(i * 0.49) * 0.04,
      0.016,
      vec(1, 0, 0)
    );
  waist.finish();
  bee.anchor('petiole', bee.abdomen, [-0.05, 0.02, 0.19]);
  const reactor = bee.mount(bee.abdomen, 'core', [0, 0, 0], [0, 0.015, 0], 0.84, false);
  bee.coreLight = new T.PointLight(0xffb65e, 0.16, 1.3, 2);
  bee.coreLight.position.set(0.98, 0.04, 0.02);
  reactor.add(bee.coreLight);
  const inn = bee.batch(reactor, 'core');
  const profile = stations.map(([x, r]) => [x, r * 0.775, r * 0.82, center(x)]);
  inn.add('amber', loft(profile, -Math.PI, Math.PI, 46, 48));
  inn.add(
    'amber',
    surface(
      (u, v) => {
        const x = 0.055 + u * 2.11;
        return vec(x, center(x) + (2 * v - 1) * radius(x) * 0.768, -0.016);
      },
      43,
      2
    )
  );
  for (let col = 0; col < 18; col++)
    for (let row = -3; row <= 3; row++) {
      const r = 0.065,
        x = 0.18 + col * r * 1.52,
        y = (row + (col % 2) * 0.5) * r * Math.sqrt(3);
      if (Math.abs(y) + r > radius(x) * 0.7) continue;
      for (let k = 0; k < 3; k++) {
        const a = (k * TAU) / 6,
          d = ((k + 1) * TAU) / 6;
        inn.rod(
          'bronze',
          [x + r * Math.cos(a), center(x) + y + r * Math.sin(a), -0.01],
          [x + r * Math.cos(d), center(x) + y + r * Math.sin(d), -0.01],
          0.0032,
          0.0032,
          4
        );
      }
    }
  inn.rod('bronze', [0.03, 0.035, 0], [2.16, -0.1, 0], 0.07, 0.045, 22);
  for (let i = 0; i < 13; i++) {
    const x = 0.17 + i * 0.151,
      r = radius(x);
    inn.hoop(
      i % 3 === 0 ? 'metal' : 'bronze',
      [x, center(x), 0],
      r * 0.818,
      0.013,
      vec(1, 0, 0),
      0.945
    );
  }
  for (let j = 0; j < 8; j++) {
    const a = (j * TAU) / 8;
    inn.tube(
      'edge',
      sweep((t) => {
        const x = 0.18 + t * 1.9,
          r = radius(x);
        return vec(x, center(x) + Math.cos(a) * r * 0.777, Math.sin(a) * r * 0.824);
      }),
      0.009,
      27
    );
  }
  inn.finish();
  bee.anchor('core', reactor, [0.95, 0.03, 0.41]);
  const boundaries = [0.1, 0.425, 0.782, 1.145, 1.49, 1.805, 2.205];
  for (let i = 0; i < 6; i++) {
    const start = boundaries[i],
      end = boundaries[i + 1],
      length = end - start;
    const mount = bee.mount(
      bee.abdomen,
      'rings',
      [start, 0, 0],
      [0.15 + i * 0.245, 0.01 * i, 0],
      0.16 + i * 0.08
    );
    const shell = group(mount),
      b = bee.batch(shell, 'rings');
    function point(u, a, inflate = 0) {
      const x = start + u * length,
        rr = radius(x) * (1 + 0.038 * Math.sin(u * Math.PI) - 0.039 * (1 - u) ** 3) + inflate;
      return vec(u * length, center(x) + Math.cos(a) * rr * 0.955, Math.sin(a) * rr);
    }
    const paintEnd = i % 2 ? 0.725 : 0.798;
    const patch = (role, ul, uh, al, ah, nu, nv, offset = 0) =>
      b.add(
        role,
        surface((u, v) => point(mix(ul, uh, u), mix(ah, al, v), offset), nu, nv)
      );
    patch('body', 0.025, paintEnd, -1.03, 1.03, 8, 28);
    patch('body', 0.025, paintEnd, 2.2, TAU - 2.2, 7, 21);
    for (const s of [-1, 1]) {
      const rows = i === 5 ? 1 : 2,
        cols = i === 5 ? 1 : 2;
      for (let c = 0; c < cols; c++)
        for (let j = 0; j < rows; j++) {
          const u0 = mix(0.025, paintEnd, c / cols),
            u1 = mix(0.025, paintEnd, (c + 1) / cols);
          const a0 = s * mix(1.03, 2.2, j / rows),
            a1 = s * mix(1.03, 2.2, (j + 1) / rows);
          windowCell(b, point, u0, u1, a0, a1);
        }
      const studs = [point(0.2, s * 0.82, 0.009), point(0.69, s * 0.82, 0.009)];
      instances(
        shell,
        screwGeometry,
        bee.materials.get('metal', 'rings'),
        screwMatrices(studs, 0.013, s),
        'rings'
      );
    }
    patch('bronze', 0, 0.025, -Math.PI, Math.PI, 2, 64);
    patch('metal', paintEnd, 0.948, -Math.PI, Math.PI, 5, 66);
    patch('dark', 0.942, 1.012, -Math.PI, Math.PI, 3, 66, -0.004);
    collar(b, 'edge', point, paintEnd, 0.011);
    collar(b, 'edge', point, 0.915, 0.009);
    collar(b, 'bronze', point, 0.977, 0.01);
    b.tube(
      'bronze',
      sweep((t) => point(0.095, t * 1.66 - 0.83, 0.004)),
      0.0045,
      16,
      5
    );
    for (let j = 0; j < 17; j++) {
      const a = -1.18 + j * 0.145;
      b.rod(
        'bronze',
        point(paintEnd + 0.022, a, 0.004),
        point(0.885, a + 0.032, 0.004),
        0.003,
        0.003,
        5
      );
    }
    b.finish();
    bee.rings.push(shell);
    if (i === 2) bee.anchor('rings', shell, [length * 0.5, 0.52, 0]);
  }
  const sting = bee.mount(bee.abdomen, 'sting', [2.18, center(2.18), 0], [0.74, -0.09, 0], 0.04);
  const s = bee.batch(sting, 'sting');
  s.rod('bronze', [-0.05, 0.015, 0], [0.135, -0.022, 0], 0.07, 0.03);
  for (const z of [-0.014, 0.014]) {
    s.rod('metal', [0.07, 0, z], [0.292, -0.082, z * 0.15], 0.022, 0.002, 9);
    for (let i = 0; i < 4; i++) {
      const x = 0.13 + i * 0.031;
      s.rod(
        'edge',
        [x, -0.021 - i * 0.011, z],
        [x - 0.027, -0.009 - i * 0.011, z * 1.55],
        0.008,
        0.001,
        6
      );
    }
  }
  s.finish();
  bee.anchor('sting', sting, [0.2, -0.05, 0]);
}
