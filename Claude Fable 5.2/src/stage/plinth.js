// ─────────────────────────────────────────────────────────────────────────────
// stage/plinth.js — the landing plinth: a low hexagonal museum pedestal.
//
// Built from a revolved profile with 6 flat sides (vertices on ±X), faceted
// normals. From the floor up: a chamfered base slab, a recessed gilt shadow-gap
// neck, the main body with fine chamfers, and a perfectly flat top at
// DIMS.plinthTopY whose flat hexagon has circumradius exactly DIMS.plinthRadius.
// The top is split into concentric coplanar rings (never overlapping), so the
// thin gilt inlay line is flush with zero z-fighting.
// Materials: MeshPhysicalMaterial + patchMaterial (honours every pass and the
// SCHEMATIC fill), extended to receive the stage's ground shadow in BEAUTY.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { patchMaterial, LAYERS } from '../core/gfx.js';
import { DIMS } from '../core/dims.js';
import { RECEIVER_GLSL } from './glsl.js';
import { KEY_DIR } from './lighting.js';

const TOP = DIMS.plinthTopY;
const RT = DIMS.plinthRadius;

/**
 * Hexagonal solid of revolution. `profile` is a list of [circumradius, y] points
 * ordered counter-clockwise in the (r, y) half-plane (bottom → outside → top →
 * inward), which fixes the outward normal of every segment.
 */
function hexProfileGeometry(profile) {
  const pos = [];
  const v = (r, y, a) => [r * Math.cos(a), y, r * Math.sin(a)];
  const push = (a, b, c, expect) => {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = ab.cross(ac);
    if (n.lengthSq() < 1e-12) return;
    if (n.dot(expect) < 0) pos.push(...a, ...c, ...b);
    else pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    const dr = r1 - r0, dy = y1 - y0;
    for (let k = 0; k < 6; k++) {
      const a0 = (k * Math.PI) / 3, a1 = ((k + 1) * Math.PI) / 3, am = (a0 + a1) / 2;
      const expect = new THREE.Vector3(dy * Math.cos(am), -dr, dy * Math.sin(am));
      const p00 = v(r0, y0, a0), p01 = v(r0, y0, a1), p10 = v(r1, y1, a0), p11 = v(r1, y1, a1);
      push(p00, p01, p11, expect);
      push(p00, p11, p10, expect);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();          // non-indexed → flat facets
  g.computeBoundingSphere();
  return g;
}

const RECEIVE_VERT_DECL = 'varying vec3 vStageW;\nvarying vec3 vStageN;\n';
const RECEIVE_VERT = /* glsl */ `
  {
    vec4 stW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      stW = instanceMatrix * stW;
    #endif
    vStageW = (modelMatrix * stW).xyz;
    vStageN = normalize(mat3(modelMatrix) * objectNormal);
  }
`;
// The stage shadow is the key light's shadow, so only faces that see the key receive it
// (faces turned away are already unlit by the key).
const RECEIVE_FRAG = /* glsl */ `
  if (uPass == 0) {
    float stS = stageGroundShadow(vStageW) * smoothstep(0.02, 0.3, dot(normalize(vStageN), ${'vec3(' + [KEY_DIR.x, KEY_DIR.y, KEY_DIR.z].map((v) => v.toFixed(5)).join(', ') + ')'}));
    gl_FragColor.rgb *= 1.0 - stS * uStageShadowK * (1.0 - uSchematic);
    float stH = stageShadowHatch(gl_FragCoord.xy / max(uPixelRatio, 1.0)) * smoothstep(0.06, 0.3, stS) * 0.55;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, stH * uSchematic);
  }
`;

// The bee's amber core is a small point light inside the abdomen. On the glossy plinth a delta light
// leaves a pin-sharp specular dot, which reads as a bug rather than as light leaking from the
// honeycomb windows. Point lights are therefore shaded with a broad lobe here (diffuse pool + soft
// sheen); the key / rim / environment keep the real roughness. Point lights come first in the chunk,
// so the roughness is restored at the end of their (unrolled) loop.
const SOFT_POINT_LIGHTS = THREE.ShaderChunk.lights_fragment_begin
  .replace('IncidentLight directLight;', 'IncidentLight directLight;\nfloat stRough0 = material.roughness, stCCRough0 = 0.0;\n#ifdef USE_CLEARCOAT\nstCCRough0 = material.clearcoatRoughness;\n#endif\n')
  .replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
    'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tmaterial.roughness = max( stRough0, 0.62 );\n\t\t#ifdef USE_CLEARCOAT\n\t\tmaterial.clearcoatRoughness = max( stCCRough0, 0.62 );\n\t\t#endif\n\t\tdirectLight.color *= 0.85;')
  .replace('#pragma unroll_loop_end', '#pragma unroll_loop_end\n\tmaterial.roughness = stRough0;\n\t#ifdef USE_CLEARCOAT\n\tmaterial.clearcoatRoughness = stCCRough0;\n\t#endif');

/** patchMaterial `extend` hook that makes a material receive the ground shadow. */
export function shadowReceiverExtend(shadowUniforms, shadowK) {
  return (shader) => {
    Object.assign(shader.uniforms, shadowUniforms, { uStageShadowK: shadowK });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RECEIVE_VERT_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + RECEIVE_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + RECEIVER_GLSL + RECEIVE_VERT_DECL + 'uniform float uStageShadowK;\n')
      .replace('#include <lights_fragment_begin>', SOFT_POINT_LIGHTS)
      .replace('#include <tonemapping_fragment>', RECEIVE_FRAG + '\n#include <tonemapping_fragment>');
  };
}

export function createPlinth({ shadowUniforms }) {
  const group = new THREE.Group();
  group.name = 'stage.plinth';

  const shadowK = { value: 1 };

  const body = new THREE.MeshPhysicalMaterial({
    name: 'stage.plinth.body',
    color: 0xf1ebe0, roughness: 0.42, metalness: 0,
    clearcoat: 0.5, clearcoatRoughness: 0.16,
    sheen: 1e-3, sheenRoughness: 0.8, sheenColor: 0xffffff,
    envMapIntensity: 0.85,
  });
  const bodyU = patchMaterial(body, { fillInk: 0, key: 'stage-recv', extend: shadowReceiverExtend(shadowUniforms, shadowK) });

  const inlay = new THREE.MeshPhysicalMaterial({
    name: 'stage.plinth.inlay',
    color: 0xc99a3e, roughness: 0.24, metalness: 1,
    clearcoat: 0.3, clearcoatRoughness: 0.12,
    envMapIntensity: 1.0,
  });
  const inlayU = patchMaterial(inlay, { fillInk: 0.15, key: 'stage-recv', extend: shadowReceiverExtend(shadowUniforms, shadowK) });

  // ── profiles (circumradius, y) ─────────────────────────────────────────────
  const chamTop = 0.09;                      // perpendicular-ish size of the top chamfer
  const RB = RT + chamTop * 1.3;             // body circumradius (8.117)
  const outer = [
    [0, 0], [9.2, 0], [9.2, 0.22], [9.12, 0.30],             // base slab + chamfer
    [8.06, 0.30],                                            // tread
  ];
  const neck = [[8.06, 0.30], [7.94, 0.30], [7.94, 0.42], [8.08, 0.42]]; // gilt shadow-gap
  const upper = [
    [8.08, 0.42], [RB, 0.46], [RB, TOP - chamTop], [RT, TOP],  // body + chamfers
    [6.98, TOP],                                              // outer top ring
  ];
  const inlayRing = [[6.98, TOP], [6.86, TOP]];
  const innerTop = [[6.86, TOP], [0, TOP]];

  const mk = (profile, mat, name) => {
    const m = new THREE.Mesh(hexProfileGeometry(profile), mat);
    m.name = name;
    m.receiveShadow = false;      // the bee's shadow comes from the stage shadow (groundShadow.js), not the shadow map
    m.castShadow = false;
    m.layers.set(LAYERS.DEFAULT);
    group.add(m);
    return m;
  };
  mk(outer, body, 'plinth.base');
  mk(neck, inlay, 'plinth.neck');
  mk(upper, body, 'plinth.body');
  mk(inlayRing, inlay, 'plinth.inlay');
  mk(innerTop, body, 'plinth.top');

  const WHITE = new THREE.Color(1, 1, 1);
  // clearcoat / sheen never reach exactly 0, so crossing themes never recompiles the program
  function applyTokens(t) {
    body.color.copy(t.plinthColor);
    body.roughness = t.plinthRough;
    body.clearcoat = Math.max(1e-3, t.plinthClearcoat);
    body.clearcoatRoughness = t.plinthCCRough;
    body.envMapIntensity = t.plinthEnv;
    body.sheen = Math.max(1e-3, t.plinthSheen);
    body.sheenColor.copy(t.plinthColor).lerp(WHITE, 0.4);
    inlay.color.copy(t.inlayColor);
    inlay.roughness = t.inlayRough;
  }

  return { group, body, inlay, bodyU, inlayU, shadowK, applyTokens };
}

/** Height of the supporting surface under (x, z): plinth top inside its hexagon, else the floor. */
export function surfaceY(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  const h = Math.max(az, ax * 0.8660254 + az * 0.5);
  return h <= (RT + 0.12) * 0.8660254 ? TOP : DIMS.floorY;
}
