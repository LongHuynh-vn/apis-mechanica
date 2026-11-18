// ─────────────────────────────────────────────────────────────────────────────
// stage/floor.js — the drawing plate on the floor (y = 0, LAYERS.HELPERS).
//
// A pure overlay (premultiplied alpha, depthWrite off, keeps destination alpha)
// over the backdrop: soft light pool, the plinth's ambient occlusion, the bee's
// ground shadow, and analytic drafting linework:
//   honeycomb grid · construction circles · protractor arc with graduations ·
//   radial centre lines · dimension line + scale bar · registration crosses
// Every stroke is a distance field anti-aliased by its screen-space derivative,
// widths are in device px (hairlines stay hairlines at any zoom), and periodic
// patterns fade out before their period drops under a few CSS px (no moiré).
// CODEX turns it into hand inking: wobble, uneven ink, seed-of-life circles
// and hatched sectors. setInk(p) plots it in: circles sweep by angle, the grid
// grows outward, the crosses come last.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LAYERS, globalUniforms } from '../core/gfx.js';
import { DIMS } from '../core/dims.js';
import { NOISE_GLSL, HEX_GLSL, RECEIVER_GLSL } from './glsl.js';

const FLOOR_FRAG = /* glsl */ `
uniform float uSchematic, uPixelRatio;
uniform vec3 uInk;
uniform vec3 uLine, uPoolCol, uShadowCol;
uniform float uLineAlpha, uGridAlpha, uPoolAlpha, uShadowK, uAO, uCodex, uDark, uInkIn;
varying vec3 vWorld;
${NOISE_GLSL}
${HEX_GLSL}
${RECEIVER_GLSL}

const float PI = 3.14159265;
const float TAU = 6.28318531;
const float DEG = 0.01745329;
float PR;     // pixel ratio
float FP;     // world size of one device pixel (isotropic, conservative)

// coverage of a stroke at distance d (world), AA width g (world per px), width w (device px)
float strokeG(float d, float g, float w) {
  float ww = max(w, 1.0);
  return (w / ww) * clamp(0.5 * ww + 0.5 - abs(d) / g, 0.0, 1.0);
}
float stroke(float d, float w) { return strokeG(d, max(fwidth(d), 1e-5), w); }
// soft interval mask a <= x <= b, 1px AA
float span(float x, float a, float b) { return clamp((x - a) / FP + 0.5, 0.0, 1.0) * clamp((b - x) / FP + 0.5, 0.0, 1.0); }
// periodic pattern visibility: fades when the period gets below ~4 CSS px
float periodFade(float period) { float px = period / (FP * PR); return smoothstep(3.5, 9.0, px); }
float uni(float a, float b) { return a + b - a * b; }
// ink-in ramps
float ramp(float a, float b) { return clamp((uInkIn - a) / (b - a), 0.0, 1.0); }
float sweep(float th, float th0, float a, float b) {      // angular reveal, 0..1 of the turn
  if (uInkIn >= 0.9999) return 1.0;
  float f = fract((th - th0) / TAU);
  float r = ramp(a, b) * 1.0001;
  return clamp((r - f) * 40.0, 0.0, 1.0);
}

void main() {
  PR = max(uPixelRatio, 1.0);
  vec2 p0 = vWorld.xz;
  FP = max(max(length(dFdx(p0)), length(dFdy(p0))), 1e-5);
  if (dot(p0, p0) > 64.0 * 64.0) discard;      // nothing is drawn beyond the plate (lines fade out by r = 58)

  // CODEX: hand wobble + uneven ink
  vec2 wob = vec2(0.0);
  float dens = 1.0;
  if (uCodex > 0.001) {        // (uniform branch: no noise cost in the other themes)
    float n1 = stNoise2(p0 * 0.33 + 3.7), n2 = stNoise2(p0 * 1.7 + 1.3);
    wob = vec2(n1 - 0.5, stNoise2(p0 * 0.33 - 9.1) - 0.5) + vec2(n2 - 0.5, 0.5 - n1) * 0.3;
    float dn = stNoise2(p0 * 0.55 + 2.0) * 0.66 + n2 * 0.34;
    dens = mix(1.0, clamp(0.45 + 1.05 * dn, 0.2, 1.25), uCodex);
  }
  vec2 p = p0 + wob * 0.16 * uCodex;
  float r = length(p);
  float th = atan(p.y, p.x);                    // 0 on +X, +PI/2 on +Z (toward the front)
  float wBoost = mix(1.0, 1.35, uCodex);

  float HAIR = 0.75 * PR * wBoost;
  float FINE = 0.95 * PR * wBoost;
  float MID = 1.2 * PR * wBoost;

  float plate = 1.0 - smoothstep(30.0, 58.0, r);   // the whole drawing dissolves into the backdrop
  float lines = 0.0;

  // ── honeycomb grid (flat-top, matches the plinth) ──────────────────────────
  {
    const float R = 1.55;
    vec2 s = vec2(3.0 * R, 1.7320508 * R);
    vec2 a = mod(p, s) - 0.5 * s;
    vec2 b = mod(p - 0.5 * s, s) - 0.5 * s;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 cid = p - g;
    float d = R * 0.8660254 - stHexH(g);
    float grow = mix(9.0, 64.0, ramp(0.12, 0.72));
    float reveal = 1.0 - smoothstep(grow - 4.0, grow, length(cid));
    float cellVar = 0.75 + 0.25 * stHash12(floor(cid * 3.0 + 0.5));
    float near = smoothstep(9.6, 12.5, r);
    float far = 1.0 - smoothstep(16.0, 46.0, r);
    float grid = strokeG(d, FP, HAIR) * periodFade(R * 1.5) * near * far * reveal * cellVar;
    lines = uni(lines, grid * uGridAlpha * 0.55);
  }

  // ── plinth outline cell: a hexagon one module outside the plinth base ─────
  {
    float hh = stHexH(p);
    float d1 = hh - 10.2 * 0.8660254;
    float hv = sweep(th, -PI * 0.5, 0.02, 0.32);
    lines = uni(lines, stroke(d1, FINE) * 0.8 * hv);
  }

  // ── construction circles ───────────────────────────────────────────────────
  {
    float c = 0.0;
    // r, width, alpha, dash period (0 = solid), start angle, ink window
    c = uni(c, stroke(r - 11.6, HAIR) * 0.75 * sweep(th, 1.2, 0.0, 0.30));
    float dash = r * th;
    float dm = span(fract(dash / 0.9) * 0.9, 0.0, 0.55) * periodFade(0.9);
    c = uni(c, stroke(r - 13.4, HAIR) * 0.6 * mix(0.25, dm, periodFade(0.9)) * sweep(th, 2.4, 0.05, 0.38));
    c = uni(c, stroke(r - 17.2, FINE) * 0.8 * sweep(th, -0.6, 0.08, 0.42));
    c = uni(c, stroke(r - 27.6, HAIR) * 0.55 * sweep(th, 0.9, 0.18, 0.55));
    float dm2 = span(fract(dash / 2.4) * 2.4, 0.0, 1.5) * periodFade(2.4);
    c = uni(c, stroke(r - 36.0, HAIR) * 0.5 * mix(0.2, dm2, periodFade(2.4)) * sweep(th, 3.0, 0.22, 0.62));
    lines = uni(lines, c);
  }

  // ── protractor (front half, centred on the bee's heading) ─────────────────
  {
    const float RP = 22.0;
    float a = th / DEG;                                        // degrees, -180..180
    float onArc = clamp(span(a, -12.0, 181.0) + span(a, -181.0, -168.0), 0.0, 1.0);
    float sw = sweep(th, -12.0 * DEG, 0.28, 0.66);
    float pa = 0.0;
    pa = uni(pa, stroke(r - RP, FINE) * onArc);
    pa = uni(pa, stroke(r - (RP + 2.6), HAIR) * span(a, 0.0, 180.0) * 0.7);
    float k = floor(a + 0.5);
    float dperp = (a - k) * DEG * r;
    float m10 = step(abs(mod(k, 10.0)), 0.01) + step(9.99, abs(mod(k, 10.0)));
    float m5 = step(abs(mod(k, 5.0)), 0.01) + step(4.99, abs(mod(k, 5.0)));
    float len = mix(mix(0.42, 0.8, clamp(m5, 0.0, 1.0)), 1.45, clamp(m10, 0.0, 1.0));
    float tick = strokeG(dperp, FP, HAIR) * span(r - RP, 0.0, len) * span(a, 0.0, 180.0);
    float fadeMinor = mix(periodFade(DEG * RP), 1.0, clamp(m5, 0.0, 1.0));
    float fade5 = mix(periodFade(5.0 * DEG * RP), 1.0, clamp(m10, 0.0, 1.0));
    pa = uni(pa, tick * fadeMinor * fade5 * 0.85);
    // long inner graduations every 30°
    float k30 = floor(a / 30.0 + 0.5) * 30.0;
    float d30 = (a - k30) * DEG * r;
    pa = uni(pa, strokeG(d30, FP, HAIR) * span(r - RP, -1.1, 0.0) * span(a, 0.0, 180.0) * 0.8);
    lines = uni(lines, pa * sw);
  }

  // ── radial centre lines (dash-dot), every 30°, axes longer ────────────────
  {
    float k = floor(th / (PI / 6.0) + 0.5);
    float dth = th - k * (PI / 6.0);
    float d = r * sin(dth);
    float isAxis = step(abs(mod(k, 3.0)), 0.01) + step(2.99, abs(mod(k, 3.0)));
    float rEnd = mix(25.0, 40.0, clamp(isAxis, 0.0, 1.0));
    float grow = mix(10.6, rEnd, ramp(0.2, 0.6));
    float u = fract((r - 10.6) / 3.0) * 3.0;                     // dash-dot along the ray
    float dd = max(span(u, 0.0, 1.9), span(u, 2.25, 2.45));
    dd = mix(0.35, dd, periodFade(3.0));
    float ray = strokeG(d, FP, HAIR) * span(r, 10.6, grow) * dd * step(0.0, cos(dth));
    lines = uni(lines, ray * mix(0.45, 0.7, clamp(isAxis, 0.0, 1.0)));
  }

  // ── dimension line across the plinth (vertex to vertex) + scale bar ───────
  {
    float a = ramp(0.55, 0.82);
    float R = ${DIMS.plinthRadius.toFixed(2)};
    const float ZD = 13.6;
    float dim = 0.0;
    dim = uni(dim, strokeG(p.y - ZD, FP, HAIR) * span(p.x, -R, -R + (2.0 * R) * a));
    dim = uni(dim, strokeG(abs(p.x) - R, FP, HAIR) * span(p.y, 3.4, ZD + 0.9) * 0.8);
    // 45° architectural ticks at both ends + centre mark
    vec2 q = vec2(abs(p.x) - R, p.y - ZD);
    float obl = (q.x - q.y) * 0.70710678;
    dim = uni(dim, strokeG(obl, FP, MID) * step(length(q), 0.55));
    dim = uni(dim, strokeG(p.x, FP, HAIR) * span(p.y, ZD - 0.35, ZD + 0.35));
    // scale bar (1 cm divisions, 10 cm) on the front-right
    vec2 sb = p - vec2(14.0, 19.5);
    float bar = strokeG(sb.y, FP, HAIR) * span(sb.x, 0.0, 10.0 * a);
    float kx = floor(sb.x + 0.5);
    float tl = mix(0.32, 0.75, step(abs(mod(kx, 5.0)), 0.01) + step(4.99, abs(mod(kx, 5.0))));
    bar = uni(bar, strokeG(sb.x - kx, FP, HAIR) * span(sb.y, 0.0, tl) * span(sb.x, -0.1, 10.1 * a) * periodFade(1.0));
    float half_ = floor(sb.x * 2.0 + 0.5) * 0.5;
    bar = uni(bar, strokeG(sb.x - half_, FP, HAIR) * span(sb.y, 0.0, 0.2) * span(sb.x, 0.0, 10.0 * a) * periodFade(0.5) * 0.7);
    // alternating filled divisions under the bar (classic museum scale)
    float fill = span(sb.y, -0.22, 0.0) * span(sb.x, 0.0, 10.0 * a) * step(0.5, fract(sb.x * 0.5)) * 0.55;
    bar = uni(bar, fill);
    lines = uni(lines, (dim + bar - dim * bar) * 0.85);
  }

  // ── registration crosses (last) ───────────────────────────────────────────
  {
    float a = ramp(0.8, 1.0);
    vec2 c = vec2(26.0, 24.0);
    vec2 q = abs(p) - c;
    float arm = 1.7 * (0.6 + 0.4 * a);
    float cr = uni(strokeG(q.x, FP, HAIR) * span(q.y, -arm, arm), strokeG(q.y, FP, HAIR) * span(q.x, -arm, arm));
    cr *= 1.0 - span(length(q), 0.0, 0.18);
    cr = uni(cr, stroke(length(q) - 0.95, HAIR));
    float anyCross = step(length(q), 2.2);
    lines = uni(lines, cr * anyCross * a * 0.8 / max(plate, 0.25));    // stay visible past the plate fade
  }

  // ── CODEX: seed-of-life construction circles and hatched sectors ─────────
  if (uCodex > 0.001) {
    float cc = 0.0;
    for (int i = 0; i < 6; i++) {
      float ang = float(i) * PI / 3.0;
      vec2 cen = vec2(cos(ang), sin(ang)) * 8.0;
      float dc = length(p - cen) - 8.0;
      float th2 = uInkIn < 0.9999 ? atan(p.y - cen.y, p.x - cen.x) : 0.0;
      cc = uni(cc, stroke(dc, HAIR) * 0.55 * sweep(th2, ang + PI, 0.1 + float(i) * 0.06, 0.4 + float(i) * 0.06));
    }
    cc = uni(cc, stroke(r - 16.0, HAIR) * 0.6 * sweep(th, 0.3, 0.1, 0.5));
    // hatching: two sectors, wobbling strokes with ragged ends
    vec2 hp = p0 + wob * 0.35;
    float hc = dot(hp, vec2(0.70710678, 0.70710678)) / 0.34;
    float li = floor(hc + 0.5);
    float dh = (hc - li) * 0.34;
    float jitter = stHash12(vec2(li, 3.0));
    float a1 = th / DEG;
    float sect1 = span(r, 17.4 + jitter * 0.9, 27.2 - stHash12(vec2(li, 7.0)) * 1.4) * span(a1, -150.0, -102.0 + jitter * 6.0);
    float sect2 = span(r, 11.9 + jitter * 0.5, 16.9 - jitter * 0.8) * span(a1, -70.0 + jitter * 5.0, -28.0);
    float hatch = strokeG(dh, FP, HAIR * 0.9) * (sect1 + sect2) * periodFade(0.34) * (0.55 + 0.45 * stHash12(vec2(li, 1.0)));
    // cross-hatch the darker sector
    float hc2 = dot(hp, vec2(-0.70710678, 0.70710678)) / 0.42;
    float dh2 = (hc2 - floor(hc2 + 0.5)) * 0.42;
    float l2 = floor(hc2 + 0.5);
    float rag = span(r, 18.0 + stHash12(vec2(l2, 9.0)) * 2.5, 23.5 - stHash12(vec2(l2, 4.0)) * 2.5);
    hatch = uni(hatch, strokeG(dh2, FP, HAIR * 0.8) * sect1 * rag * span(a1, -140.0, -122.0) * periodFade(0.42) * 0.32);
    hatch *= ramp(0.55, 0.95);
    lines = uni(lines, (cc + hatch - cc * hatch) * uCodex);
  }

  // grazing views (FRONT / PROFILE, low orbits): far linework compresses into a single bright or
  // dark band that reads as a horizon. Fade strokes by the footprint anisotropy of a pixel
  // (≈ 1 / sin(elevation)): untouched above ~13°, gone below ~6°.
  vec2 dpx = dFdx(p0), dpy = dFdy(p0);
  float lx = length(dpx), ly = length(dpy);
  float aniso = max(lx, ly) / max(min(lx, ly), 1e-6);
  float graze = 1.0 - smoothstep(4.5, 10.0, aniso);
  float lineA = clamp(lines * dens, 0.0, 1.0) * plate * uLineAlpha * graze;

  // ── light pool, plinth occlusion, ground shadow ───────────────────────────
  float rr = length(p0);
  float poolA = uPoolAlpha * pow(1.0 - smoothstep(4.0, 34.0, rr), 1.6);
  float hb = stHexH(p0) - 9.2 * 0.8660254;                   // distance outside the plinth base (flat sides)
  float ao = (exp(-max(hb, 0.0) / 0.55) * 0.7 + exp(-max(hb, 0.0) / 3.2) * 0.3) * uAO;
  float gs = stageGroundShadow(vec3(p0.x, 0.0, p0.y));
  float shadow = clamp(1.0 - (1.0 - ao) * (1.0 - gs * uShadowK), 0.0, 1.0);
  vec2 fc = gl_FragCoord.xy / PR;
  float inkHatch = stageShadowHatch(fc) * smoothstep(0.06, 0.3, shadow) * 0.55;
  vec3 shCol = mix(uShadowCol, uInk, uSchematic);
  float shA = mix(shadow, inkHatch, uSchematic);

  vec4 acc = vec4(uPoolCol * poolA, poolA);
  acc = vec4(shCol * shA + acc.rgb * (1.0 - shA), shA + acc.a * (1.0 - shA));
  acc = vec4(uLine * lineA + acc.rgb * (1.0 - lineA), lineA + acc.a * (1.0 - lineA));
  gl_FragColor = acc;      // premultiplied
}
`;

export function createFloor({ shadowUniforms }) {
  const uniforms = {
    uSchematic: globalUniforms.uSchematic,
    uPixelRatio: globalUniforms.uPixelRatio,
    uInk: globalUniforms.uInk,
    uLine: { value: new THREE.Color() },
    uPoolCol: { value: new THREE.Color() },
    uShadowCol: { value: new THREE.Color() },
    uLineAlpha: { value: 0.6 },
    uGridAlpha: { value: 0.5 },
    uPoolAlpha: { value: 0.5 },
    uShadowK: { value: 1 },
    uAO: { value: 0.3 },
    uCodex: { value: 0 },
    uDark: { value: 0 },
    uInkIn: { value: 1 },
    ...shadowUniforms,
  };
  const material = new THREE.ShaderMaterial({
    name: 'stage.floor',
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: FLOOR_FRAG,
  });
  const geometry = new THREE.CircleGeometry(420, 96);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'stage.floor';
  mesh.position.y = DIMS.floorY;
  mesh.renderOrder = -900;
  mesh.layers.set(LAYERS.HELPERS);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
