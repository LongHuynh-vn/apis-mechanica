import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { vec, group, sweep, instances, transform } from '../geometry.js';

export const WING_LENGTH = 2.84;
const foreOutline = [
  [0, 0],
  [0.19, 0.083],
  [0.61, 0.175],
  [1.16, 0.255],
  [1.76, 0.289],
  [2.28, 0.261],
  [2.67, 0.168],
  [2.836, 0.044],
  [2.755, -0.113],
  [2.48, -0.29],
  [2.05, -0.434],
  [1.6, -0.505],
  [1.15, -0.43],
  [0.68, -0.292],
  [0.25, -0.106],
];
const hindOutline = [
  [0.19, -0.103],
  [0.53, -0.232],
  [0.96, -0.365],
  [1.38, -0.464],
  [1.61, -0.5],
  [1.98, -0.56],
  [2.08, -0.616],
  [1.92, -0.731],
  [1.58, -0.802],
  [1.19, -0.77],
  [0.82, -0.65],
  [0.48, -0.436],
  [0.26, -0.235],
];
const veinPaths = [
  [
    [0.025, 0.008],
    [0.43, 0.102],
    [1.13, 0.183],
    [1.76, 0.209],
    [2.26, 0.213],
    [2.68, 0.148],
  ],
  [
    [0.08, -0.015],
    [0.46, 0.018],
    [0.82, 0.054],
    [1.06, 0.108],
    [1.36, 0.14],
    [1.75, 0.177],
    [1.95, 0.17],
  ],
  [
    [0.04, -0.012],
    [0.35, -0.073],
    [0.67, -0.074],
    [0.92, -0.044],
    [1.1, 0.024],
    [1.36, 0.14],
  ],
  [
    [0.18, -0.068],
    [0.51, -0.185],
    [0.8, -0.236],
    [1.0, -0.22],
    [1.22, -0.17],
    [1.47, -0.17],
    [1.75, -0.12],
    [2.07, -0.088],
    [2.37, -0.072],
    [2.73, -0.04],
  ],
  [
    [1.36, 0.14],
    [1.56, 0.01],
    [1.78, -0.023],
    [2.09, 0.001],
    [2.4, 0.062],
    [2.68, 0.146],
  ],
  [
    [1.02, -0.216],
    [1.075, -0.116],
    [1.1, 0.024],
  ],
  [
    [1.44, -0.17],
    [1.47, -0.06],
    [1.54, 0.01],
  ],
  [
    [1.75, -0.12],
    [1.76, -0.065],
    [1.78, -0.023],
  ],
  [
    [0.37, -0.083],
    [0.55, -0.14],
    [0.71, -0.156],
    [0.81, -0.234],
  ],
  [
    [0.75, -0.32],
    [0.86, -0.285],
    [1.0, -0.22],
  ],
  [
    [1.08, -0.411],
    [1.24, -0.323],
    [1.37, -0.285],
    [1.47, -0.17],
  ],
  [
    [1.57, -0.49],
    [1.65, -0.36],
    [1.86, -0.265],
    [2.07, -0.088],
  ],
  [
    [1.93, -0.455],
    [1.97, -0.32],
    [2.17, -0.226],
    [2.37, -0.072],
  ],
];
const hindVeins = [
  [
    [0.22, -0.13],
    [0.57, -0.293],
    [0.99, -0.469],
    [1.48, -0.54],
    [1.98, -0.58],
  ],
  [
    [0.26, -0.17],
    [0.55, -0.37],
    [0.93, -0.533],
    [1.26, -0.6],
    [1.67, -0.65],
    [2.04, -0.614],
  ],
  [
    [0.32, -0.27],
    [0.59, -0.469],
    [0.88, -0.609],
    [1.18, -0.68],
    [1.52, -0.71],
    [1.89, -0.74],
  ],
  [
    [0.72, -0.59],
    [0.84, -0.545],
    [0.93, -0.533],
  ],
  [
    [1.17, -0.68],
    [1.23, -0.635],
    [1.26, -0.6],
  ],
  [
    [1.53, -0.705],
    [1.61, -0.679],
    [1.67, -0.65],
  ],
];
function wingPoint(u, v, s) {
  return vec(
    u,
    0.057 * Math.sin((Math.PI * u) / WING_LENGTH) - 0.057 * v * v + 0.026 * Math.sin(u * 1.6) * v,
    s * v
  );
}
function membrane(outline, s) {
  const spline = new T.CatmullRomCurve3(
    outline.map(([u, v]) => vec(u, v, 0)),
    true,
    'centripetal'
  );
  const boundary = spline.getPoints(90).slice(0, -1);
  const center = boundary.reduce((p, q) => p.add(q), vec()).multiplyScalar(1 / boundary.length);
  const pos = [],
    uv = [],
    ind = [];
  for (let k = 0; k <= 5; k++)
    for (const q of boundary) {
      const p = center.clone().lerp(q, k / 5);
      pos.push(...wingPoint(p.x, p.y, s).toArray());
      uv.push(p.x / WING_LENGTH, p.y + 0.6);
    }
  const n = boundary.length;
  for (let k = 0; k < 5; k++)
    for (let i = 0; i < n; i++) {
      const a = k * n + i,
        b = k * n + ((i + 1) % n);
      ind.push(a, a + n, b, b, a + n, b + n);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}
function buildFoil(bee, parent, s, hind) {
  const id = hind ? 'hindwing' : 'forewing',
    outline = hind ? hindOutline : foreOutline;
  const part = bee.mount(
    parent,
    id,
    [0, hind ? -0.019 : 0, 0],
    hind ? [0.19, 0.05, -s * 0.53] : [-0.05, 0.155, s * 0.17],
    hind ? 0.045 : 0.15
  );
  const b = bee.batch(part, id),
    mem = membrane(outline, s);
  b.add('glass', mem);
  b.tube(
    'metal',
    outline.map(([u, v]) => wingPoint(u, v, s)),
    hind ? 0.0075 : 0.01,
    90,
    7,
    true
  );
  for (const [i, path] of (hind ? hindVeins : veinPaths).entries()) {
    b.tube(
      i < 3 ? 'metal' : 'bronze',
      path.map(([u, v]) => wingPoint(u, v, s).add(vec(0, 0.005, 0))),
      i < 3 ? (hind ? 0.008 : 0.011) : 0.007,
      Math.max(8, path.length * 4),
      6
    );
  }
  if (!hind) {
    b.tube(
      'edge',
      [
        [0.04, 0.024],
        [0.55, 0.145],
        [1.17, 0.23],
        [1.74, 0.272],
        [2.21, 0.249],
      ].map(([u, v]) => wingPoint(u, v, s)),
      0.011,
      38,
      7
    );
    b.tube(
      'bronze',
      [
        [1.72, 0.238],
        [1.84, 0.233],
        [2.02, 0.223],
      ].map(([u, v]) => wingPoint(u, v, s)),
      0.02,
      13,
      8
    );
    // Etched flourishes follow the distal margin inside the last row of closed cells.
    for (let i = 0; i < 24; i++) {
      const t = i / 23,
        u = 1.68 + t * 0.93,
        v = -0.456 + t * 0.31;
      b.tube(
        'etch',
        [
          [u, v],
          [u + 0.024, v + 0.038],
          [u + 0.073, v + 0.075],
        ].map(([x, y]) => wingPoint(x, y, s)),
        0.0022,
        5,
        4
      );
    }
  }
  b.finish();
  bee.anchor(id, part, wingPoint(hind ? 1.53 : 2.09, hind ? -0.65 : 0.16, s));
  return mem;
}
export function buildWings(bee) {
  for (const s of [-1, 1]) {
    const mount = bee.mount(
      bee.chassis,
      'hinge',
      [-0.245, 0.605, s * 0.436],
      [0, 0.48, s * 0.55],
      0.25
    );
    const g = bee.batch(mount, 'hinge');
    g.ell('bronze', [0, -0.053, 0], [0.177, 0.083, 0.117], true);
    g.hoop('metal', [0, 0, 0], 0.116, 0.023, vec(0, 1, 0));
    g.hoop('edge', [0, 0.016, s * 0.018], 0.074, 0.016, vec(0, 0, s));
    for (const x of [-0.089, 0.089])
      g.rod('metal', [x, -0.03, 0], [x, 0.063, s * 0.044], 0.025, 0.022);
    g.rod('dark', [-0.115, 0.045, 0], [0.115, 0.045, 0], 0.024, 0.024);
    g.ell('edge', [0, 0.041, 0], [0.045, 0.044, 0.044], true);
    g.finish();
    bee.anchor('hinge', mount, [0, 0.04, s * 0.035]);
    const socket = bee.mount(mount, 'forewing', [0, 0.05, s * 0.015], [0, 0.19, s * 0.18], 0.13);
    const sweepAxis = group(socket),
      stroke = group(sweepAxis),
      coupled = group(stroke);
    const yoke = bee.batch(sweepAxis, 'hinge');
    for (const z of [-0.037, 0.037]) {
      yoke.rod('bronze', [-0.045, -0.015, z], [0.095, 0.01, z], 0.019, 0.015, 10);
      yoke.ell('edge', [0.095, 0.01, z], [0.022, 0.022, 0.02], true);
    }
    yoke.rod('edge', [0.092, 0.01, -0.049], [0.092, 0.01, 0.049], 0.012, 0.012);
    yoke.finish();
    const rocker = bee.batch(stroke, 'hinge');
    rocker.rod('metal', [-0.029, 0, 0], [0.167, 0, 0], 0.021, 0.012, 12);
    rocker.finish();
    const a = buildFoil(bee, coupled, s, false),
      b = buildFoil(bee, coupled, s, true);
    const ham = bee.mount(coupled, 'hamuli', [0, -0.009, 0], [0.065, 0.075, -s * 0.19], 0.075);
    const hookBase = bee.batch(ham, 'hamuli');
    const along = (t) => [0.42 + t * 1.03, -0.186 - 0.29 * t - 0.031 * Math.sin(Math.PI * t)];
    hookBase.tube(
      'edge',
      sweep((t) => wingPoint(...along(t), s)),
      0.008,
      28,
      6
    );
    hookBase.finish();
    const hook = new T.TubeGeometry(
      new T.CatmullRomCurve3([
        vec(0, 0, 0),
        vec(0.001, 0.017, s * 0.009),
        vec(0.008, 0.025, s * 0.023),
        vec(0.017, 0.011, s * 0.029),
      ]),
      8,
      0.0045,
      5,
      false
    );
    instances(
      ham,
      hook,
      bee.materials.get('metal', 'hamuli'),
      Array.from({ length: 21 }, (_, i) => transform(wingPoint(...along(i / 20), s))),
      'hamuli'
    );
    bee.anchor('hamuli', ham, wingPoint(...along(0.58), s));
    const ghostGeom = mergeGeometries([a, b]);
    const weights = Float32Array.from(
      { length: 32 },
      (_, i) => 0.3 + 0.7 * Math.sin((Math.PI * (i + 0.5)) / 32) ** 0.7
    );
    ghostGeom.setAttribute('ghostWeight', new T.InstancedBufferAttribute(weights, 1));
    const gm = bee.materials.get('glass', 'forewing').clone();
    gm.transparent = true;
    gm.depthWrite = false;
    gm.opacity = 0.09;
    gm.forceSinglePass = true;
    gm.customProgramCacheKey = () => 'wing-exposure';
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uCut = bee.materials.uniforms.clip;
      sh.uniforms.uBeeInverse = bee.materials.uniforms.inverse;
      sh.vertexShader =
        'attribute float ghostWeight;varying float vWeight;varying float vGhostZ;uniform mat4 uBeeInverse;\n' +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWeight=ghostWeight;vGhostZ=(uBeeInverse*modelMatrix*instanceMatrix*vec4(transformed,1.)).z;'
        );
      sh.fragmentShader =
        'varying float vWeight;varying float vGhostZ;uniform float uCut;\n' +
        sh.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nif(vGhostZ>uCut)discard;diffuseColor.a*=vWeight;'
        );
    };
    const ghosts = new T.InstancedMesh(ghostGeom, gm, weights.length);
    ghosts.frustumCulled = false;
    ghosts.userData.ghost = true;
    ghosts.visible = false;
    socket.add(ghosts);
    const traceGeo = new T.BufferGeometry(),
      count = 92;
    traceGeo.setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage)
    );
    traceGeo.setAttribute(
      'trailWeight',
      new T.Float32BufferAttribute(
        Array.from({ length: count }, (_, j) => (j / (count - 1)) ** 0.66),
        1
      )
    );
    const traceInk = new T.LineBasicMaterial({
      color: bee.materials.colors.lines,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    traceInk.onBeforeCompile = (sh) => {
      sh.vertexShader =
        'attribute float trailWeight; varying float vTrail;\n' +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvTrail=trailWeight;'
        );
      sh.fragmentShader =
        'varying float vTrail;\n' +
        sh.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.a*=vTrail;'
        );
    };
    const trace = new T.Line(traceGeo, traceInk);
    trace.frustumCulled = false;
    socket.add(trace);
    bee.wings.push({
      s,
      socket,
      sweepAxis,
      stroke,
      coupled,
      ghosts,
      trace,
      count,
      tip: wingPoint(2.83, 0.04, s),
    });
  }
}
