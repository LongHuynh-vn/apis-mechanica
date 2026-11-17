import {
  vec,
  group,
  surface,
  sweep,
  capsulePanel,
  filamentGeometry,
  rodMatrix,
  instances,
} from '../geometry.js';
import { catalogue } from '../catalogue.js';

function bearing(b, s, r) {
  b.rod('bronze', [0, 0, -r * 0.73], [0, 0, r * 0.73], r, r, 16);
  b.rod('metal', [0, 0, s * r * 0.68], [0, 0, s * r * 0.91], r * 0.84, r * 0.8, 16);
  b.rod('edge', [0, 0, s * r * 0.89], [0, 0, s * r * 0.98], r * 0.53, r * 0.51, 14);
  b.rod('dark', [-r * 0.33, 0, s * r * 0.993], [r * 0.33, 0, s * r * 0.993], r * 0.07, r * 0.07, 5);
}
function pollenBasket(bee, tibia, d, s) {
  const g = bee.mount(tibia, 'basket', [0, 0, 0], [0.045, 0.03, s * 0.22], 0.03);
  const b = bee.batch(g, 'basket');
  const dir = d.clone().normalize(),
    normal = vec(0, 0, s)
      .addScaledVector(dir, -dir.z * s)
      .normalize();
  const across = vec().crossVectors(dir, normal).normalize();
  function pt(u, v) {
    const width = 0.031 + 0.079 * Math.sin(Math.PI * u) ** 0.64;
    return d
      .clone()
      .multiplyScalar(0.13 + 0.73 * u)
      .addScaledVector(across, width * v)
      .addScaledVector(normal, 0.047 + 0.031 * v * v);
  }
  b.add(
    'metal',
    surface((u, v) => pt(u, 2 * v - 1), 16, 12)
  );
  for (const sign of [-1, 1])
    b.tube(
      'edge',
      sweep((t) => pt(t, sign)),
      0.011,
      20,
      6
    );
  const hairs = [];
  for (let i = 1; i < 14; i++)
    for (const sign of [-1, 1]) {
      const a = pt(i / 15, sign),
        elbow = a
          .clone()
          .addScaledVector(across, sign * 0.027)
          .addScaledVector(normal, 0.035);
      const end = elbow
        .clone()
        .addScaledVector(across, -sign * 0.032)
        .addScaledVector(normal, 0.025)
        .addScaledVector(dir, -0.022);
      hairs.push(rodMatrix(a, elbow, 0.0039), rodMatrix(elbow, end, 0.0027));
    }
  instances(g, filamentGeometry, bee.materials.get('edge', 'basket'), hairs, 'basket');
  b.finish();
  bee.anchor('basket', g, pt(0.56, 0.5));
}
const chains = [
  [
    [-0.67, -0.13, 0.32],
    [-0.72, -0.24, 0.47],
    [-0.78, -0.26, 0.54],
    [-0.99, -0.23, 0.79],
    [-1.2, -0.83, 0.96],
    [-1.38, -0.991, 1.03],
  ],
  [
    [-0.23, -0.16, 0.385],
    [-0.23, -0.27, 0.55],
    [-0.18, -0.25, 0.65],
    [-0.09, -0.19, 0.96],
    [-0.3, -0.87, 1.23],
    [-0.45, -0.991, 1.3],
  ],
  [
    [0.21, -0.13, 0.33],
    [0.33, -0.245, 0.51],
    [0.44, -0.2, 0.61],
    [0.75, -0.147, 0.83],
    [0.99, -0.81, 1.06],
    [1.14, -0.991, 1.2],
  ],
];
export function buildLegs(bee) {
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const side = s > 0 ? 'Left' : 'Right',
        name = ['foreleg', 'middle leg', 'hind leg'][i],
        part = 'leg' + i + (s > 0 ? 'l' : 'r');
      catalogue[part] = [
        side + ' ' + name,
        'Pin-jointed limb · 5 tarsomeres',
        catalogue.legs[2],
        i === 2
          ? 'The hind tibia carries a pollen basket framed by stiff hairs.'
          : catalogue.legs[3],
      ];
      const points = chains[i].map(([x, y, z]) => vec(x, y, s * z));
      const root = bee.mount(
        bee.chassis,
        part,
        points[0].toArray(),
        [i === 0 ? -0.1 : i === 2 ? 0.1 : 0, -0.14, s * 0.26],
        0.135
      );
      let parent = root;
      const pivots = [];
      for (let j = 0; j < 5; j++) {
        const d = points[j + 1].clone().sub(points[j]);
        const pivot = group(parent);
        pivots.push(pivot);
        const b = bee.batch(pivot, part);
        const widths = [0.082, 0.068, 0.078, i === 2 ? 0.079 : 0.06, 0.04];
        bearing(b, s, widths[j]);
        if (j === 0 || j === 1) {
          b.rod('bronze', [0, 0, 0], d, widths[j] * 0.79, widths[j] * 0.65);
          b.rod(
            'edge',
            d.clone().multiplyScalar(0.23),
            d.clone().multiplyScalar(0.69),
            widths[j] * 0.87,
            widths[j] * 0.76
          );
        } else {
          b.rod('dark', [0, 0, 0], d, widths[j] * 0.65, widths[j] * 0.43, 12);
          capsulePanel(
            b,
            d.clone().multiplyScalar(0.11),
            d.clone().multiplyScalar(0.88),
            widths[j],
            j === 4 ? 'edge' : 'body'
          );
          const offset = vec(0, 0, s * widths[j] * 0.67);
          b.rod(
            'metal',
            d.clone().multiplyScalar(0.18).add(offset),
            d.clone().multiplyScalar(0.8).add(offset),
            0.011,
            0.009,
            7
          );
          if (j === 3 && i === 2) pollenBasket(bee, pivot, d, s);
        }
        b.finish();
        if (j === 3) bee.anchor(part, pivot, d.clone().multiplyScalar(0.5));
        const spread = d
          .clone()
          .normalize()
          .multiplyScalar(j === 3 ? 0.23 : 0.13);
        parent = bee.mount(pivot, part, d.toArray(), spread.toArray(), 0.06 + j * 0.047, j > 1);
      }
      const sole = parent;
      for (let j = 0; j < 4; j++) {
        const d = vec(
            (i === 2 ? 0.073 : -0.072) * (1 - j * 0.105),
            j === 0 ? -0.008 : 0.001,
            s * (0.032 - j * 0.003)
          ),
          b = bee.batch(parent, part);
        b.ell('bronze', [0, 0, 0], [0.033 - j * 0.003, 0.022, 0.025], true);
        b.rod('metal', [0, 0, 0], d, 0.026 - j * 0.003, 0.019 - j * 0.002, 10);
        b.finish();
        parent = bee.mount(
          parent,
          part,
          d.toArray(),
          d.clone().multiplyScalar(0.75).toArray(),
          0.055 + j * 0.026,
          false
        );
      }
      const foot = bee.batch(parent, part),
        x = i === 2 ? 0.057 : -0.057;
      for (const q of [-1, 1])
        foot.tube(
          'bronze',
          [
            [0, 0, 0],
            [x * 0.55, 0.01, s * q * 0.018],
            [x, 0.004, s * q * 0.026],
            [x * 1.14, -0.003, s * q * 0.014],
          ],
          0.008,
          10,
          5
        );
      foot.finish();
      bee.legs.push({ s, i, pivots, sole, foot: parent, part });
      if (i === 0) bee.anchor('legs', pivots[3], [0, -0.26, s * 0.13]);
    }
}
