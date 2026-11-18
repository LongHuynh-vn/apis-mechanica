// ─────────────────────────────────────────────────────────────────────────────
// post/shaders.js — GLSL for the post pipeline (full-screen passes).
// All passes use FullScreenQuad (big triangle with uv) and write raw values;
// the grade pass is the only one that tone-maps and encodes to sRGB.
// ─────────────────────────────────────────────────────────────────────────────

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ── bloom: 13-tap downsample (Jimenez 2014); Karis-weighted on the first level ──
export const BLOOM_DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;      // source texel size
uniform float uKaris;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float kw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * uKaris); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = kw(g0) * 0.5, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.125;
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// ── bloom: 3×3 tent upsample of the coarser level, added to this level ──
export const BLOOM_UP_FRAG = /* glsl */ `
uniform sampler2D tLow;   // coarser (already accumulated) level
uniform sampler2D tCur;   // this level's downsample
uniform vec2 uTexel;      // tLow texel size
uniform float uRadius, uWeight;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tLow, vUv + o * uTexel * uRadius).rgb; }
void main() {
  vec3 up = s(vec2(-1, 1)) + s(vec2(0, 1)) * 2.0 + s(vec2(1, 1))
          + s(vec2(-1, 0)) * 2.0 + s(vec2(0, 0)) * 4.0 + s(vec2(1, 0)) * 2.0
          + s(vec2(-1, -1)) + s(vec2(0, -1)) * 2.0 + s(vec2(1, -1));
  gl_FragColor = vec4(texture2D(tCur, vUv).rgb * uWeight + up / 16.0, 1.0);
}
`;

// ── depth helpers shared by DOF + grade ──
export const DEPTH_GLSL = /* glsl */ `
uniform float uNear, uFar;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos;
uniform float uFocus, uAperture;
float eyeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
// eye depth of what this pixel shows; pixels without depth are either the floor plane (analytic) or far
float sceneEyeDepth(vec2 uv, float d) {
  if (d < 0.999999) return eyeDepth(d);
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dv = normalize(vp.xyz / vp.w);
  vec3 dw = mat3(uCamWorld) * dv;
  if (dw.y < -1e-4) {
    float t = -uCamPos.y / dw.y;
    return min(t * -dv.z, uFar);
  }
  return uFar;
}
float cocOf(float z) { return clamp((1.0 - uFocus / max(z, 1e-3)) * uAperture, -1.0, 1.0); }
`;

// ── DOF 1: half-res prefilter → rgb + signed CoC ──
export const DOF_PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tColor, tDepth;
uniform vec2 uSrcTexel;   // full-res texel; > 0 when the DOF target is quarter-res (4 bilinear taps = 4×4 px box)
varying vec2 vUv;
${DEPTH_GLSL}
void main() {
  vec3 c;
  if (uSrcTexel.x > 0.0) {
    vec2 o = uSrcTexel;
    c = 0.25 * (texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb
              + texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb);
  } else c = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  gl_FragColor = vec4(c, cocOf(sceneEyeDepth(vUv, d)));
}
`;

// ── DOF 2: scatter-as-gather bokeh (golden-angle spiral, after D. Gustafsson) ──
// Samples farther than the centre are clamped to 2× the centre's CoC, so a
// blurred background never bleeds over an in-focus silhouette (no halos).
export const DOF_GATHER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uMaxR;      // max CoC radius in half-res px
varying vec2 vUv;
const float GOLDEN = 2.39996323;
const float RAD_SCALE = 1.15;
void main() {
  vec4 c = texture2D(tSrc, vUv);
  float cs = abs(c.a) * uMaxR;
  vec3 acc = c.rgb;
  float tot = 1.0;
  float radius = RAD_SCALE;
  float ang = 0.0;
  for (int i = 0; i < 128; i++) {
    if (radius >= uMaxR) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec4 s = texture2D(tSrc, tc);
    float ss = abs(s.a) * uMaxR;
    if (s.a > c.a) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    acc += mix(acc / tot, s.rgb, m);
    tot += 1.0;
    ang += GOLDEN;
    radius += RAD_SCALE / radius;
  }
  gl_FragColor = vec4(acc / tot, c.a);
}
`;

// ── grade: DOF composite, bloom, tone map (lit geometry only), ink, vignette, sRGB, dither ──
export const GRADE_FRAG = /* glsl */ `
uniform sampler2D tBeauty, tDepth, tBloom, tDof, tNormal, tNDepth;
uniform vec2 uRes;
uniform float uPixelRatio;
uniform float uBloom; uniform vec3 uBloomTint;
uniform float uDof, uMaxR;
uniform float uInk; uniform vec3 uInkColor;
uniform float uVignette; uniform vec3 uVigColor;
uniform float uExposure, uFlat;
varying vec2 vUv;
${DEPTH_GLSL}

// Khronos PBR Neutral tone mapping
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
// flat paper colours pass through untouched; only a soft shoulder above 0.9
vec3 shoulder(vec3 c) {
  vec3 k = max(c - 0.9, 0.0);
  return min(c, 0.9) + k / (1.0 + k * 10.0);
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float lin(float d) { return eyeDepth(d); }

float inkEdges() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 mx = ivec2(uRes) - 1;
  float dC = lin(texelFetch(tNDepth, ip, 0).x);
  vec4 nC = texelFetch(tNormal, ip, 0);
  bool both = uPixelRatio >= 1.5;
  float eD = 0.0, eN = 0.0, eI = 0.0;
  ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(0, 1), ivec2(1, 1), ivec2(1, -1));
  for (int i = 0; i < 4; i++) {
    ivec2 o = offs[i];
    float wDiag = i >= 2 ? 0.7 : 1.0;
    ivec2 pa = clamp(ip + o, ivec2(0), mx), pb = clamp(ip - o, ivec2(0), mx);
    float dA = lin(texelFetch(tNDepth, pa, 0).x), dB = lin(texelFetch(tNDepth, pb, 0).x);
    vec4 nA = texelFetch(tNormal, pa, 0), nB = texelFetch(tNormal, pb, 0);
    // depth: second derivative relative to distance (planes at grazing angles stay clean)
    float sd = (dA + dB - 2.0 * dC) / dC;
    float sdv = both ? abs(sd) : max(sd, 0.0);
    eD = max(eD, smoothstep(0.012, 0.035, sdv) * wDiag);
    // normal creases (only between two geometry pixels)
    if (nC.a > 0.0) {
      vec3 n0 = normalize(nC.rgb * 2.0 - 1.0);
      if (nA.a > 0.0) eN = max(eN, smoothstep(0.22, 0.45, 1.0 - dot(n0, normalize(nA.rgb * 2.0 - 1.0))) * wDiag);
      if (nB.a > 0.0 && both) eN = max(eN, smoothstep(0.22, 0.45, 1.0 - dot(n0, normalize(nB.rgb * 2.0 - 1.0))) * wDiag);
    }
    // part boundaries (edge id), incl. silhouettes against the empty background (a = 0)
    float ia = abs(nA.a - nC.a), ib = abs(nB.a - nC.a);
    float idv = both ? max(ia, ib) : ((nC.a > nA.a ? ia : 0.0) + (nC.a > nB.a ? ib : 0.0));
    eI = max(eI, step(1.5 / 255.0, idv) * wDiag);
  }
  float e = max(eD, max(eN, eI));
  // Thin features (setae, fine veins, far antennae): a pixel whose part differs from what lies a
  // few px away on BOTH sides along some axis sits on a sliver narrower than ~2.5 CSS px. Both of
  // its outlines would merge into a solid black stroke (3,000 setae → black fur), so ink them at a
  // lighter, single weight instead.
  if (e > 0.0) {
    int R = int(clamp(floor(2.5 * uPixelRatio + 0.5), 2.0, 6.0));
    float thin = 0.0;
    for (int i = 0; i < 4; i++) {
      ivec2 o = offs[i] * R;
      float a = texelFetch(tNormal, clamp(ip + o, ivec2(0), mx), 0).a;
      float b = texelFetch(tNormal, clamp(ip - o, ivec2(0), mx), 0).a;
      thin = max(thin, step(abs(a - b), 0.5 / 255.0) * step(1.5 / 255.0, abs(a - nC.a)));
    }
    e *= 1.0 - 0.58 * thin;
  }
  return e;
}

void main() {
  vec4 beauty = texture2D(tBeauty, vUv);
  vec3 hdr = beauty.rgb;
  // SCHEMATIC fills are flat paper / ink too, so they also bypass the tone curve
  float geo = clamp(beauty.a, 0.0, 1.0) * (1.0 - uFlat);

  if (uDof > 0.0) {
    float z = sceneEyeDepth(vUv, texture2D(tDepth, vUv).x);
    float r = abs(cocOf(z)) * uMaxR;
    vec4 blur = texture2D(tDof, vUv);
    hdr = mix(hdr, blur.rgb, smoothstep(0.35, 1.4, r));
  }
  if (uBloom > 0.0) hdr += texture2D(tBloom, vUv).rgb * uBloom * uBloomTint;

  vec3 col = mix(shoulder(hdr), neutral(hdr * uExposure), geo);

  if (uInk > 0.0) col = mix(col, uInkColor, inkEdges() * uInk * 0.92);

  if (uVignette > 0.0) {
    vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float v = smoothstep(0.38, 1.05, length(q * vec2(0.82, 1.0)));
    col = mix(col, uVigColor, v * v * uVignette);
  }

  vec3 outc = toSRGB(col);
  // ±0.5/255 static dither (interleaved gradient noise) — kills banding on the soft backdrop
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  outc += (n - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}
`;
