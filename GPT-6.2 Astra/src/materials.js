import * as T from 'three';
import { clamp, mix, random, TAU } from './geometry.js';

export const editions = [
  {
    name: 'Porcelain & Gilt',
    body: '#e6e0ce',
    metal: '#b28a54',
    edge: '#d3b87e',
    bronze: '#6d5134',
    dark: '#262721',
    eye: '#121b1b',
    lens: '#273334',
    glass: '#bdccc5',
    amber: '#c07b2c',
    floor: '#f5f3ea',
    base: '#cdc7b4',
    lines: '#927b51',
    key: '#fff3dc',
    rim: '#edf3ff',
    ink: '#312e25',
    muted: '#706b5f',
    accent: '#816436',
    line: '#c9c3b2',
    panel: '#f9f7f0',
    tint: '#ece7d9',
    status: '#637a52',
    btn: '#fffaf0',
    description: 'A mechanical honeybee in glazed porcelain, polished gold and etched glass.',
  },
  {
    name: 'Delft',
    body: '#f1f0e6',
    metal: '#ab884e',
    edge: '#d9c68e',
    bronze: '#79603c',
    dark: '#303946',
    eye: '#1c3459',
    lens: '#3d5b85',
    glass: '#d8e6ef',
    amber: '#d3a552',
    floor: '#edf0ed',
    base: '#d5dad6',
    lines: '#677e96',
    key: '#f5f6fc',
    rim: '#dceafa',
    ink: '#26364a',
    muted: '#58677a',
    accent: '#45648b',
    line: '#bac4ca',
    panel: '#f2f5f2',
    tint: '#dde5e9',
    status: '#527968',
    btn: '#fafafa',
    description:
      'Cobalt florals wind across white glazed porcelain. Antique brass carries the joints and etched wings.',
  },
  {
    name: 'Obsidian & Amber',
    body: '#262321',
    metal: '#a88145',
    edge: '#cfac68',
    bronze: '#624522',
    dark: '#171715',
    eye: '#121617',
    lens: '#343737',
    glass: '#b5aa91',
    amber: '#ffaf39',
    floor: '#24231f',
    base: '#3b3930',
    lines: '#b49864',
    key: '#ffe1ae',
    rim: '#f7e9d2',
    ink: '#f0e7d2',
    muted: '#b4ab97',
    accent: '#ceb078',
    line: '#565143',
    panel: '#302e28',
    tint: '#474134',
    status: '#bac38f',
    btn: '#282319',
    description:
      'Black lacquer and aged brass shelter a luminous amber core beneath six overlapping plates.',
  },
  {
    name: 'Codex',
    body: '#e3cda2',
    metal: '#9b7844',
    edge: '#bc975d',
    bronze: '#755436',
    dark: '#4c3827',
    eye: '#40382a',
    lens: '#665744',
    glass: '#e8d6ac',
    amber: '#cb8533',
    floor: '#e9d9b7',
    base: '#dac79f',
    lines: '#80623c',
    key: '#ffeecd',
    rim: '#f1dec2',
    ink: '#493626',
    muted: '#796347',
    accent: '#846039',
    line: '#bca882',
    panel: '#eee1c4',
    tint: '#dfcdab',
    status: '#72805b',
    btn: '#fff5dd',
    description:
      'Cream enamel and oxidized bronze frame an articulated study on a sepia drafting plate.',
  },
];
const roles = {
  body: ['body', 0.025, 0.245, 0.85],
  metal: ['metal', 0.95, 0.29, 0.1],
  edge: ['edge', 0.95, 0.205, 0.16],
  bronze: ['bronze', 0.91, 0.34, 0.09],
  dark: ['dark', 0.69, 0.32, 0.35],
  eye: ['eye', 0.31, 0.17, 0.62],
  lens: ['lens', 0.32, 0.205, 0.65],
  glass: ['glass', 0.23, 0.19, 0.7],
  etch: ['edge', 0.58, 0.32, 0.2],
  amber: ['amber', 0.07, 0.27, 0.77],
  lamp: ['amber', 0.16, 0.15, 1],
  base: ['base', 0.045, 0.56, 0.12],
  baseEdge: ['metal', 0.84, 0.31, 0.18],
  ink: ['lines', 0.38, 0.4, 0.1],
};
export const editionColor = (n, k) => new T.Color(editions[n][k]);
function floralTexture() {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const rng = random(207);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  function leaf(x, y, a, s) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-s * 0.45, -s * 0.2, -s * 0.32, -s * 0.75, 0, -s);
    g.bezierCurveTo(s * 0.29, -s * 0.68, s * 0.23, -s * 0.2, 0, 0);
    g.fillStyle = 'rgba(255,255,255,.76)';
    g.fill();
    g.restore();
  }
  function flower(x, y, s) {
    g.save();
    g.translate(x, y);
    for (let k = 0; k < 6; k++) {
      g.rotate(TAU / 6);
      g.beginPath();
      g.ellipse(0, -s * 0.5, s * 0.23, s * 0.47, 0.12, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,.86)';
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, s * 0.25, 0, TAU);
    g.fill();
    g.restore();
  }
  for (let row = -1; row < 5; row++)
    for (let col = -1; col < 7; col++) {
      const x = col * 138 + (row % 2) * 68,
        y = row * 135 + 27;
      g.strokeStyle = 'rgba(255,255,255,.69)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 33, y + 66);
      g.bezierCurveTo(x + 19, y + 34, x - 23, y + 11, x + 23, y - 8);
      g.bezierCurveTo(x + 55, y - 20, x + 55, y - 41, x + 43, y - 48);
      g.stroke();
      flower(x + 41, y - 51, 23 + rng() * 7);
      leaf(x + 4, y + 18, -0.88, 29);
      leaf(x + 12, y - 1, 0.95, 25);
      leaf(x - 7, y + 40, -0.75, 22);
      flower(x - 14, y + 26, 11);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(x - 5, y + 38);
      g.bezierCurveTo(x + 34, y + 36, x + 43, y + 9, x + 30, y + 11);
      g.stroke();
    }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
export class Materials {
  constructor(paintedGlaze = floralTexture()) {
    this.cache = new Map();
    this.colors = {};
    for (const key of Object.keys(editions[0]))
      if (editions[0][key][0] === '#') this.colors[key] = editionColor(0, key);
    this.weights = [1, 0, 0, 0];
    this.from = [1, 0, 0, 0];
    this.index = 0;
    this.progress = 1;
    this.schematic = 0;
    this.selected = null;
    this.uniforms = {
      clip: { value: 7 },
      inverse: { value: new T.Matrix4() },
      floral: { value: 0 },
      paper: { value: this.colors.floor },
      draw: { value: 0 },
      flower: { value: paintedGlaze },
      ink: { value: this.colors.ink },
      accent: { value: this.colors.edge },
      glow: { value: 0 },
      arrival: { value: 1 },
      platform: { value: 1 },
    };
    this.styleKeys = {
      paper: 'floor',
      ink: 'ink',
      muted: 'muted',
      accent: 'accent',
      line: 'line',
      panel: 'panel',
      tint: 'tint',
      status: 'status',
      'btn-text': 'btn',
    };
  }
  selectTheme(index) {
    this.index = index;
    this.from = this.weights.slice();
    this.progress = 0;
  }
  updateTheme(dt) {
    if (this.progress >= 1) return false;
    this.progress = clamp(this.progress + dt / 0.8);
    const t = this.progress * this.progress * (3 - 2 * this.progress);
    for (let i = 0; i < 4; i++) this.weights[i] = mix(this.from[i], Number(i === this.index), t);
    for (const [key, color] of Object.entries(this.colors)) {
      color.setRGB(0, 0, 0);
      for (let i = 0; i < 4; i++) color.add(editionColor(i, key).multiplyScalar(this.weights[i]));
    }
    this.uniforms.floral.value = this.weights[1];
    for (const [k, v] of Object.entries(this.styleKeys))
      document.documentElement.style.setProperty('--' + k, '#' + this.colors[v].getHexString());
    for (const mat of this.cache.values()) this.paint(mat);
    return true;
  }
  paint(mat) {
    const role = mat.userData.role,
      def = roles[role];
    mat.color.copy(this.colors[def[0]]);
    if (role === 'amber' || role === 'lamp') mat.emissive.copy(this.colors.amber);
  }
  get(role, part = 'stage') {
    const key = role + '/' + part;
    if (this.cache.has(key)) return this.cache.get(key);
    const [palette, metalness, roughness, clearcoat] = roles[role];
    const mat = new T.MeshPhysicalMaterial({
      color: this.colors[palette],
      metalness,
      roughness,
      clearcoat,
      clearcoatRoughness: 0.19,
      side: T.DoubleSide,
      envMapIntensity: 1.0,
    });
    mat.userData.role = role;
    mat.userData.part = part;
    if (role === 'glass') {
      mat.transparent = true;
      mat.opacity = 0.29;
      mat.depthWrite = false;
      mat.iridescence = 0.55;
      mat.iridescenceIOR = 1.33;
      mat.iridescenceThicknessRange = [180, 370];
      mat.ior = 1.48;
      mat.specularIntensity = 1;
      mat.forceSinglePass = true;
    }
    if (role === 'etch') {
      mat.transparent = true;
      mat.opacity = 0.37;
      mat.depthWrite = false;
      mat.forceSinglePass = true;
    }
    if (role === 'lens') {
      mat.iridescence = 0.11;
      mat.iridescenceThicknessRange = [180, 270];
      mat.roughness = 0.245;
      mat.specularIntensity = 0.69;
      mat.clearcoat = 0.48;
      mat.envMapIntensity = 0.79;
    }
    if (role === 'lamp' || role === 'amber') {
      mat.emissive.copy(this.colors.amber);
      mat.emissiveIntensity = role === 'lamp' ? 0.88 : 0.42;
    }
    const u = this.uniforms;
    const local = { value: 0 };
    mat.userData.emphasis = local;
    const partOfBee = part !== 'stage';
    const painted = role === 'body',
      membrane = role === 'glass';
    mat.customProgramCacheKey = () => String(partOfBee) + String(painted) + String(membrane);
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uCut: u.clip,
        uBeeInverse: u.inverse,
        uDrawing: u.draw,
        uPaper: u.paper,
        uInk: u.ink,
        uAccent: u.accent,
        uEmphasis: local,
        uFlower: u.flower,
        uDelft: u.floral,
        uGlowPass: u.glow,
        uArrival: partOfBee ? u.arrival : u.platform,
      });
      shader.vertexShader =
        (painted ? 'attribute vec3 castingPosition;varying vec3 vCasting;\n' : '') +
        'varying vec3 vBeePoint; varying vec2 vPaintUv; uniform mat4 uBeeInverse;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 plateLocal=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          plateLocal=instanceMatrix*plateLocal;
        #endif
        vBeePoint=(uBeeInverse*modelMatrix*plateLocal).xyz;vPaintUv=uv;
        ${painted ? 'vCasting=castingPosition;' : ''}`
      );
      shader.fragmentShader =
        (painted ? 'varying vec3 vCasting;\n' : '') +
        'varying vec3 vBeePoint;varying vec2 vPaintUv;uniform float uCut,uDrawing,uEmphasis,uDelft,uGlowPass,uArrival;uniform vec3 uPaper,uInk,uAccent;uniform sampler2D uFlower;\n' +
        shader.fragmentShader;
      if (partOfBee)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
        if(vBeePoint.z>uCut)discard;
        if(uArrival<.999 && fract(dot(floor(gl_FragCoord.xy),vec2(.7548777,.5698403)))>uArrival)discard;`
        );
      else
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\nif(uArrival<.999 && fract(dot(floor(gl_FragCoord.xy),vec2(.7548777,.5698403)))>uArrival)discard;'
        );
      if (painted)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        vec2 paint=vec2(vCasting.x*.36+.21,atan(vCasting.z,vCasting.y+.025)/6.283+.50);
        float flowers=texture2D(uFlower,paint*vec2(1.,1.27)).a;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.008,.036,.13),flowers*uDelft*.98);`
        );
      if (membrane)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        float fringe=.5+.5*sin(vPaintUv.x*18.+vPaintUv.y*7.);
        diffuseColor.rgb*=mix(vec3(.76,.94,.95),vec3(1.,.87,.77),fringe);
        diffuseColor.a*=.84+.36*fringe;`
        );
      if (partOfBee)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `
        float rim=1.-abs(dot(normalize(normal),normalize(vViewPosition)));
        float inkEdge=smoothstep(.60,.97,rim);
        ${membrane ? `float a=14.*vPaintUv.x+4.*vPaintUv.y+rim*6.;outgoingLight*=mix(vec3(1.),.74+.26*cos(vec3(0.,2.09,4.18)+a),.22+.62*rim);` : ''}
        vec3 inkFill=mix(uPaper,uInk,.065+.21*(1.-max(0.,normal.y))+.70*inkEdge);
        outgoingLight=mix(outgoingLight,inkFill,uDrawing);
        outgoingLight=mix(outgoingLight,uPaper*.92,.70*max(-uEmphasis,0.));
        outgoingLight+=uAccent*pow(rim,2.4)*max(uEmphasis,0.)*.95;
        float cutEdge=1.-smoothstep(.006,.029,uCut-vBeePoint.z);
        outgoingLight=mix(outgoingLight,uAccent*1.22,cutEdge*.97);
        if(uGlowPass>.5)outgoingLight=totalEmissiveRadiance;
        #include <opaque_fragment>`
        );
    };
    this.cache.set(key, mat);
    return mat;
  }
  highlight(part, dt) {
    for (const m of this.cache.values()) {
      if (m.userData.part === 'stage') continue;
      const target = part ? (m.userData.part === part ? 1 : -1) : 0;
      const u = m.userData.emphasis;
      u.value = mix(u.value, target, 1 - Math.exp(-dt * 11));
    }
  }
}

// A photographic strip-light environment gives the curved gold edges dark and light reflections.
export function studioEnvironment(renderer) {
  const w = 512,
    h = 256,
    data = new Float32Array(w * h * 4);
  const panels = [
    [0.17, 0.31, 0.1, 0.085, 3.9],
    [0.67, 0.29, 0.16, 0.075, 3.6],
    [0.94, 0.46, 0.018, 0.19, 2.7],
    [0.41, 0.44, 0.032, 0.15, 2.65],
    [0.54, 0.15, 0.31, 0.029, 2.8],
    [0.8, 0.6, 0.08, 0.09, 0.6],
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w,
        v = y / h;
      let val = 0.12 + Math.max(0, 0.45 - v) * 0.54 + Math.max(0, v - 0.63) * 1.2;
      for (const [px, py, pw, ph, strength] of panels) {
        const dx = Math.min(Math.abs(u - px), 1 - Math.abs(u - px)) / pw,
          dy = (v - py) / ph;
        val += strength * Math.exp(-Math.pow(dx, 6) - Math.pow(dy, 6));
      }
      const i = (y * w + x) * 4;
      data[i] = val * 1.055;
      data[i + 1] = val * 1.01;
      data[i + 2] = val * 0.946;
      data[i + 3] = 1;
    }
  const tex = new T.DataTexture(data, w, h, T.RGBAFormat, T.FloatType);
  tex.mapping = T.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  tex.flipY = true;
  const gen = new T.PMREMGenerator(renderer),
    rt = gen.fromEquirectangular(tex);
  gen.dispose();
  tex.dispose();
  return rt;
}

export function sectionShadowMaterial(uniforms) {
  const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uCut = uniforms.clip;
    sh.uniforms.uBeeInverse = uniforms.inverse;
    sh.vertexShader =
      'uniform mat4 uBeeInverse; varying float vSectionZ;\n' +
      sh.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSectionZ=(uBeeInverse*modelMatrix*vec4(transformed,1.)).z;'
      );
    sh.fragmentShader =
      'uniform float uCut; varying float vSectionZ;\n' +
      sh.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif(vSectionZ>uCut)discard;'
      );
  };
  return depth;
}
