import * as T from 'three';
import {
  vec,
  group,
  loft,
  loftPoint,
  surface,
  sweep,
  TAU,
  instances,
  transform,
  screwGeometry,
  screwMatrices,
} from '../geometry.js';
import { fur } from './head.js';

const moduleSize = 0.022;
// One involute flank is reflected about the tooth centre. All three wheels use the same module.
function tooth(n, depth) {
  const r = (n * moduleSize) / 2,
    base = r * Math.cos(Math.PI / 9),
    outer = r + moduleSize,
    inner = r - moduleSize * 1.2;
  const involute = (x) => {
    const a = Math.acos(Math.min(1, base / x));
    return Math.tan(a) - a;
  };
  const half = (x) => Math.PI / (2 * n) + involute(r) - involute(Math.max(base, x));
  const flank = [inner, Math.max(inner, base), (base + outer) * 0.5, outer];
  const shape = new T.Shape();
  const polar = (rr, aa) => [Math.cos(aa) * rr, Math.sin(aa) * rr];
  shape.moveTo(...polar(inner, -half(inner)));
  for (const radius of flank.slice(1)) shape.lineTo(...polar(radius, -half(radius)));
  for (const radius of [...flank].reverse()) shape.lineTo(...polar(radius, half(radius)));
  shape.closePath();
  const g = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.0016,
    bevelThickness: 0.0022,
    bevelSegments: 1,
    curveSegments: 3,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}
function gear(bee, parent, x, y, z, n, sign, phase) {
  const wheel = group(parent, x, y, z),
    r = (n * moduleSize) / 2,
    depth = 0.038,
    part = 'motor',
    b = bee.batch(wheel, part);
  const ann = new T.Shape();
  ann.absarc(0, 0, r - moduleSize * 0.91, 0, TAU, false);
  const hole = new T.Path();
  hole.absarc(0, 0, r * 0.67, 0, TAU, true);
  ann.holes.push(hole);
  const g = new T.ExtrudeGeometry(ann, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    bevelSegments: 1,
    curveSegments: 30,
  });
  g.translate(0, 0, -depth / 2);
  b.add('metal', g);
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5;
    const d = vec(Math.cos(a), Math.sin(a), 0);
    b.rod(
      'metal',
      d.clone().multiplyScalar(r * 0.18),
      d.clone().multiplyScalar(r * 0.79),
      r * 0.105,
      r * 0.079,
      8
    );
  }
  b.rod('bronze', [0, 0, -0.034], [0, 0, 0.034], r * 0.23, r * 0.23, 18);
  b.rod('edge', [0, 0, -0.041], [0, 0, 0.041], r * 0.145, r * 0.145, 16);
  b.hoop('edge', [0, 0, Math.sign(z) * 0.021], r * 0.76, 0.004);
  b.ell('dark', [0, 0, Math.sign(z) * 0.045], [r * 0.065, r * 0.065, 0.007], true);
  b.finish();
  const matrices = Array.from({ length: n }, (_, i) =>
    transform(
      [0, 0, 0],
      [1, 1, 1],
      new T.Quaternion().setFromAxisAngle(vec(0, 0, 1), (i * TAU) / n)
    )
  );
  instances(wheel, tooth(n, depth), bee.materials.get('metal', part), matrices, part);
  bee.gears.push({ wheel, ratio: (sign * 24) / n, phase });
  return wheel;
}
function bearingBridge(bee, core, side) {
  const z = side * 0.529,
    bridge = bee.batch(core, 'motor');
  const shape = new T.Shape();
  shape.moveTo(-0.744, -0.142);
  shape.bezierCurveTo(-0.67, -0.123, -0.596, -0.02, -0.552, 0.043);
  shape.bezierCurveTo(-0.53, 0.091, -0.474, 0.075, -0.445, 0.045);
  shape.bezierCurveTo(-0.34, -0.022, -0.19, -0.022, -0.099, 0.049);
  shape.bezierCurveTo(-0.053, 0.095, -0.013, 0.066, 0.008, 0.036);
  shape.bezierCurveTo(0.093, -0.017, 0.21, -0.015, 0.307, 0.06);
  shape.lineTo(0.332, 0.026);
  shape.bezierCurveTo(0.126, -0.116, 0.031, -0.076, -0.063, -0.018);
  shape.bezierCurveTo(-0.265, -0.148, -0.348, -0.082, -0.48, -0.012);
  shape.bezierCurveTo(-0.6, -0.031, -0.623, -0.202, -0.733, -0.194);
  shape.closePath();
  for (const x of [-0.5, -0.06]) {
    const hole = new T.Path();
    hole.absarc(x, 0.025, 0.023, 0, TAU, true);
    shape.holes.push(hole);
  }
  const g = new T.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 13,
  });
  bridge.add('bronze', g, vec(0, 0, z));
  bridge.tube(
    'edge',
    [
      [-0.727, -0.16, z + side * 0.012],
      [-0.602, -0.072, z + side * 0.014],
      [-0.5, 0.05, z + side * 0.015],
      [-0.3, -0.039, z + side * 0.014],
      [-0.065, 0.05, z + side * 0.015],
      [0.11, -0.035, z + side * 0.012],
      [0.3, 0.035, z + side * 0.01],
    ],
    0.006,
    38,
    6
  );
  for (const [x, y, r] of [
    [-0.5, 0.025, 0.038],
    [-0.06, 0.025, 0.032],
    [0.247, 0.025, 0.025],
    [-0.712, -0.162, 0.025],
  ]) {
    bridge.hoop('edge', [x, y, z + side * 0.018], r, 0.007);
    bridge.ell(
      x === -0.5 ? 'amber' : 'dark',
      [x, y, z + side * 0.023],
      [r * 0.63, r * 0.63, 0.009],
      true
    );
  }
  bridge.finish();
}
function escapement(bee, core, side) {
  const z = side * 0.493,
    pivot = group(core, -0.63, 0.25, z),
    pawl = bee.batch(pivot, 'motor');
  pawl.rod('edge', [0, 0, 0], [0.112, 0.085, 0], 0.014, 0.011, 9);
  pawl.rod('bronze', [0.112, 0.085, 0], [0.145, 0.046, 0], 0.016, 0.004, 8);
  pawl.ell('dark', [0, 0, 0], [0.022, 0.022, 0.012], true);
  pawl.finish();
  const rod = group(core),
    r = bee.batch(rod, 'motor');
  r.rod('metal', [0, 0, 0], [0, 1, 0], 0.01, 0.01, 8);
  r.finish();
  if (!bee.escapements) bee.escapements = [];
  bee.escapements.push({ side, pivot, rod, z });
}
export function buildThorax(bee) {
  const p = [
    [-0.94, 0.25, 0.26, 0.12],
    [-0.87, 0.396, 0.382, 0.135],
    [-0.69, 0.55, 0.495, 0.144],
    [-0.4, 0.625, 0.57, 0.145],
    [-0.12, 0.655, 0.604, 0.14],
    [0.12, 0.62, 0.578, 0.13],
    [0.34, 0.505, 0.498, 0.115],
    [0.52, 0.385, 0.366, 0.095],
    [0.65, 0.21, 0.218, 0.07],
  ];
  const core = bee.mount(bee.chassis, 'motor', [-0.035, 0, 0], [0, -0.23, 0], 0.72);
  const b = bee.batch(core, 'motor');
  b.ell('dark', [-0.13, -0.12, -0.235], [0.68, 0.282, 0.075]);
  for (const s of [-1, 1]) {
    const z = s * 0.436;
    b.ell('bronze', [-0.1, 0.005, s * 0.346], [0.65, 0.36, 0.085]);
    b.ell('dark', [-0.16, 0.02, s * 0.398], [0.58, 0.298, 0.039]);
    b.tube(
      'metal',
      [
        [-0.83, 0.2, s * 0.34],
        [-0.77, -0.075, s * 0.468],
        [-0.48, -0.236, s * 0.471],
        [-0.02, -0.287, s * 0.445],
        [0.34, -0.18, s * 0.37],
        [0.5, 0.07, s * 0.3],
      ],
      0.039,
      28,
      8
    );
    b.tube(
      'edge',
      [
        [-0.84, 0.29, s * 0.32],
        [-0.57, 0.38, s * 0.454],
        [-0.18, 0.405, s * 0.525],
        [0.2, 0.31, s * 0.485],
        [0.48, 0.17, s * 0.29],
      ],
      0.025,
      28,
      8
    );
    for (const [x, y, r] of [
      [-0.5, 0.025, 0.265],
      [-0.06, 0.025, 0.177],
      [0.248, 0.025, 0.132],
    ]) {
      b.rod('bronze', [x, y, -0.448], [x, y, 0.448], r * 0.23, r * 0.23);
      b.hoop('bronze', [x, y, z], r * 1.11, 0.012);
    }
    const main = gear(bee, core, -0.5, 0.025, s * 0.467, 24, 1, 0);
    gear(bee, core, -0.06, 0.025, s * 0.467, 16, -1, Math.PI / 16);
    gear(bee, core, 0.248, 0.025, s * 0.467, 12, 1, 0);
    const crank = bee.batch(main, 'motor');
    crank.rod('edge', [0, 0, s * 0.053], [0.112, 0, s * 0.053], 0.018, 0.023);
    crank.ell('dark', [0.112, 0, s * 0.058], [0.024, 0.024, 0.014], true);
    crank.finish();
    const spring = group(core, 0, 0, 0);
    const leaf = bee.batch(spring, 'motor');
    for (let i = 0; i < 3; i++)
      leaf.tube(
        i === 1 ? 'edge' : 'metal',
        [
          [-0.69, 0.184 + i * 0.013, s * 0.48],
          [-0.48, 0.324 + i * 0.013, s * 0.5],
          [-0.17, 0.35 + i * 0.012, s * 0.508],
          [0.12, 0.28 + i * 0.01, s * 0.484],
          [0.29, 0.18 + i * 0.007, s * 0.43],
        ],
        0.012,
        28,
        6
      );
    leaf.finish();
    if (!bee.springs) bee.springs = [];
    bee.springs.push(spring);
    const studs = [
      [-0.74, 0.167, s * 0.5],
      [-0.59, -0.18, s * 0.475],
      [-0.29, -0.244, s * 0.46],
      [0.07, -0.22, s * 0.439],
      [0.334, -0.12, s * 0.405],
    ];
    instances(
      core,
      screwGeometry,
      bee.materials.get('edge', 'motor'),
      screwMatrices(studs, 0.026, s),
      'motor'
    );
    bearingBridge(bee, core, s);
    escapement(bee, core, s);
  }
  const innerCrank = gear(bee, core, -0.5, 0.025, -0.044, 24, 1, 0);
  gear(bee, core, -0.06, 0.025, -0.044, 16, -1, Math.PI / 16);
  gear(bee, core, 0.248, 0.025, -0.044, 12, 1, 0);
  const cb = bee.batch(innerCrank, 'motor');
  cb.rod('edge', [0, 0, 0.028], [0.115, 0.02, 0.028], 0.02, 0.024);
  cb.ell('dark', [0.115, 0.02, 0.032], [0.018, 0.018, 0.008], true);
  cb.finish();
  for (let i = 0; i < 6; i++) {
    const x = -0.6 + i * 0.16;
    b.hoop('bronze', [x, -0.1, -0.16], 0.225, 0.013, vec(1, 0, 0), 1.04);
  }
  for (let i = 0; i < 4; i++) {
    const y = 0.22 + i * 0.033;
    b.tube(
      i % 2 ? 'edge' : 'bronze',
      [
        [-0.69, y, -0.07],
        [-0.47, y + 0.085, -0.085],
        [-0.12, y + 0.094, -0.081],
        [0.2, y + 0.035, -0.078],
        [0.37, y - 0.065, -0.072],
      ],
      0.012,
      24,
      7
    );
  }
  b.finish();
  bee.anchor('motor', core, [-0.375, 0.04, 0.51]);
  bee.anchor('motor', core, [-0.375, 0.04, -0.51]);
  const caseMount = bee.mount(bee.chassis, 'scutum', [0, 0, 0], [0, 0.69, 0], 0.115);
  bee.plates = group(caseMount);
  const tailMount = bee.mount(bee.chassis, 'scutum', [0.017, 0, 0], [0.33, 0.46, 0], 0.21);
  bee.scutellum = group(tailMount);
  const shell = bee.batch(bee.plates, 'scutum'),
    tail = bee.batch(bee.scutellum, 'scutum');
  shell.add(
    'dark',
    loft(p.slice(0, 7), -1.21, 1.21, 38, 36),
    vec(0, -0.009, 0),
    vec(0.991, 0.974, 0.976)
  );
  tail.add(
    'bronze',
    loft(p.slice(6), -1.21, 1.21, 18, 22),
    vec(0, -0.011, 0),
    vec(0.994, 0.971, 0.972)
  );
  for (const s of [-1, 1]) {
    const start = s < 0 ? -1.17 : 0.015,
      end = s < 0 ? -0.015 : 1.17;
    shell.add('body', loft(p.slice(0, 7), start, end, 42, 26));
    tail.add('body', loft(p.slice(6), start, end, 18, 23));
    for (const u of [0.115, 0.737, 0.775, 0.885]) {
      (u > 0.75 ? tail : shell).tube(
        u === 0.737 ? 'bronze' : 'edge',
        sweep((t) => loftPoint(p, u, s * (0.015 + t * 1.156), 0.009)),
        u === 0.737 ? 0.017 : 0.008,
        23,
        6
      );
    }
    for (const [plate, from, length] of [
      [shell, 0, 0.75],
      [tail, 0.75, 0.25],
    ]) {
      plate.add(
        'bronze',
        surface((u, v) => loftPoint(p, from + length * u, s * 1.17, -0.036 * v), 24, 2)
      );
      plate.tube(
        'metal',
        sweep((t) => loftPoint(p, from + t * length, s * 1.17, 0.005)),
        0.022,
        32,
        8
      );
      plate.tube(
        'edge',
        sweep((t) => loftPoint(p, from + t * length, s * 1.095, 0.009)),
        0.006,
        27,
        6
      );
      plate.tube(
        'edge',
        sweep((t) => loftPoint(p, from + t * length, s * 0.021, 0.007)),
        0.009,
        30,
        7
      );
    }
    tail.tube(
      'metal',
      sweep((t) => loftPoint(p, 0.752, s * (0.018 + t * 1.146), 0.005)),
      0.016,
      25,
      7
    );
    // A chased, paired cartouche follows the compound curvature of the shell.
    shell.tube(
      'metal',
      sweep((t) => loftPoint(p, 0.21 + t * 0.49, s * (0.3 + 0.25 * Math.sin(t * Math.PI)), 0.008)),
      0.009,
      34,
      6
    );
    shell.tube(
      'edge',
      sweep((t) =>
        loftPoint(p, 0.225 + t * 0.448, s * (0.35 + 0.255 * Math.sin(t * Math.PI)), 0.009)
      ),
      0.0045,
      28,
      5
    );
    for (let j = 0; j < 4; j++) {
      tail.tube(
        'bronze',
        sweep((t) =>
          loftPoint(
            p,
            0.79 + j * 0.031 + 0.012 * Math.sin(Math.PI * t),
            s * (0.37 + t * 0.47),
            0.01
          )
        ),
        0.007,
        12,
        6
      );
    }
    const fasteners = [0.15, 0.27, 0.46, 0.62, 0.74].map((u) => loftPoint(p, u, s * 1.115, 0.022));
    instances(
      bee.plates,
      screwGeometry,
      bee.materials.get('edge', 'scutum'),
      screwMatrices(fasteners, 0.018, s),
      'scutum'
    );
  }
  shell.finish();
  tail.finish();
  bee.anchor('scutum', bee.plates, [-0.17, 0.77, 0.07]);
  const collar = bee.batch(bee.chassis, 'scutum');
  collar.add('bronze', loft(p.slice(0, 2), -Math.PI, Math.PI, 8, 44));
  for (let k = 0; k < 4; k++)
    collar.tube(
      k % 2 ? 'edge' : 'metal',
      sweep((t) => loftPoint(p, 0.018 + k * 0.023, t * TAU, 0.017), 48),
      0.01,
      48
    );
  collar.finish();
  fur(bee, bee.chassis, p, 0.086, 0.159, 730, 563);
}
