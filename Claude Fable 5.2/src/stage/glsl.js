// ─────────────────────────────────────────────────────────────────────────────
// stage/glsl.js — GLSL snippets shared by the stage shaders.
// ─────────────────────────────────────────────────────────────────────────────
import { DIMS } from '../core/dims.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Hash / value noise / fbm (2-D and 3-D). Prefix `st` avoids clashes with three chunks. */
export const NOISE_GLSL = /* glsl */ `
float stHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float stHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float stNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(stHash12(i), stHash12(i + vec2(1, 0)), u.x), mix(stHash12(i + vec2(0, 1)), stHash12(i + vec2(1, 1)), u.x), u.y);
}
float stNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(stHash13(i), stHash13(i + vec3(1,0,0)), u.x), mix(stHash13(i + vec3(0,1,0)), stHash13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(stHash13(i + vec3(0,0,1)), stHash13(i + vec3(1,0,1)), u.x), mix(stHash13(i + vec3(0,1,1)), stHash13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
float stFbm2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * stNoise2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
float stFbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * stNoise3(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
`;

/** Flat-top hexagon helpers (vertices on ±X, matching the plinth) + the supporting-surface height. */
export const HEX_GLSL = /* glsl */ `
// max of the three edge-normal projections; a point is inside a hexagon of circumradius R when stHexH(p) <= R*0.8660254
float stHexH(vec2 p) { vec2 q = abs(p); return max(q.y, dot(q, vec2(0.8660254, 0.5))); }
float stSurfaceY(vec2 xz) { return stHexH(xz) <= ${f(DIMS.plinthRadius + 0.12)} * 0.8660254 ? ${f(DIMS.plinthTopY)} : 0.0; }
`;

/**
 * Ground-shadow receiver. Needs the uniforms from groundShadow.uniforms.
 * stageGroundShadow(worldPos) → 0..1 darkness (body blob + contact shadows).
 * stageShadowHatch(fragCoordCss) → 0..1 ink hatch pattern for SCHEMATIC.
 */
export const RECEIVER_GLSL = /* glsl */ `
uniform sampler2D uGShadow;
uniform vec3 uGShadowC, uGShadowAX, uGShadowAY;   // light-space origin + axes (world)
uniform vec4 uGShadowXform;   // xy: crisp → soft hand-over heights (cm), z: 1 / capture width, w: shrink factor (>= 1)
uniform vec4 uGShadowParams;  // x: body strength, y: contact strength, z: altitude fade, w: enabled
float stageGroundShadow(vec3 wp) {
  if (uGShadowParams.w < 0.5) return 0.0;
  vec3 d = wp - uGShadowC;
  vec2 uv = vec2(dot(d, uGShadowAX), dot(d, uGShadowAY)) * uGShadowXform.z * uGShadowXform.w + 0.5;
  vec2 e = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - uv);
  vec4 s = texture2D(uGShadow, clamp(uv, 0.0, 1.0));
  // crisp layer where the local occluder is near the surface, soft layer where it is high
  float hN = s.b > 0.004 ? s.a / s.b * 24.0 : 99.0;
  float soft = smoothstep(uGShadowXform.x, uGShadowXform.y, hN);
  float body = mix(s.b, s.r, soft) * uGShadowParams.x * uGShadowParams.z;
  float contact = min(s.g * 2.2, 1.0) * uGShadowParams.y;    // tarsi are thinner than the blur: re-normalise
  return clamp(1.0 - (1.0 - body) * (1.0 - contact), 0.0, 1.0) * e.x * e.y;
}
float stageShadowHatch(vec2 fc) {
  float d = (fc.x + fc.y) * 0.70710678 / 4.5;
  float h = abs(fract(d) - 0.5) * 4.5;
  return 1.0 - smoothstep(0.35, 1.05, h);
}
`;
