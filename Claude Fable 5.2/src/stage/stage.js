// ─────────────────────────────────────────────────────────────────────────────
// stage/stage.js — the exhibition stage: backdrop, floor drawing plate, landing
// plinth, lights + procedural studio environment, ground/contact shadow, dust.
//
//   const stage = createStage({ renderer, scene, camera });
//   per frame: stage.update(dt, time, ctx) → … → stage.prerender(renderer, scene) → post.render(dt)
//
// RENDERER SETTINGS (set here)
//   renderer.shadowMap.enabled    = true
//   renderer.shadowMap.type       = THREE.PCFShadowMap   (r187: PCFSoft was removed; PCF is Vogel-disk filtered)
//   renderer.shadowMap.autoUpdate = false  → the key shadow map is re-rendered exactly once per frame:
//                                   prerender() sets shadowMap.needsUpdate = true so the NEXT render
//                                   (the beauty pass) refreshes it; the EMISSIVE / NORMAL_ID / capture
//                                   passes never re-render it.
// SCENE SETTINGS (set here)
//   scene.environment (PMREM of the procedural studio), scene.environmentIntensity (per theme, breathing),
//   scene.environmentRotation.y (slow drift). scene.background stays null (the backdrop is a mesh).
//
// LAYERS  backdrop + floor → HELPERS · plinth → DEFAULT · dust → GHOST
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PASS } from '../core/gfx.js';
import { DIMS } from '../core/dims.js';
import { palette, TokenBlender } from '../core/themes.js';
import { damp, clamp } from '../core/math.js';
import { STAGE_TOKENS } from './tokens.js';
import { createBackdrop } from './backdrop.js';
import { createFloor } from './floor.js';
import { createPlinth, surfaceY } from './plinth.js';
import { createLighting, KEY_DIR } from './lighting.js';
import { createGroundShadow } from './groundShadow.js';
import { createDust } from './dust.js';

export { STAGE_TOKENS };

const REST_LIFT = DIMS.beeRest.y - DIMS.plinthTopY;   // thorax height above the surface when standing

export function createStage({ renderer, scene, camera }) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const tokens = new TokenBlender(STAGE_TOKENS);
  const t = tokens.current;

  const group = new THREE.Group();
  group.name = 'stage';
  scene.add(group);

  const ground = createGroundShadow();
  const backdrop = createBackdrop({ renderer });
  const floor = createFloor({ shadowUniforms: ground.uniforms });
  const plinth = createPlinth({ shadowUniforms: ground.uniforms });
  const lights = createLighting({ renderer, scene });
  const dust = createDust();
  group.add(backdrop.mesh, floor.mesh, plinth.group, lights.group, dust.points);

  const bee = new THREE.Vector3(DIMS.beeRest.x, DIMS.beeRest.y, DIMS.beeRest.z);
  let altitude = 0;
  let envDirty = true;
  let breathKey = 1;

  function applyTokens() {
    plinth.applyTokens(t);
    lights.applyTokens(t);
    const fu = floor.uniforms;
    fu.uPoolCol.value.copy(t.poolColor);
    fu.uPoolAlpha.value = t.poolAlpha;
    fu.uShadowCol.value.copy(t.shadowColor);
    fu.uLineAlpha.value = t.lineAlpha;
    fu.uGridAlpha.value = t.gridAlpha;
    fu.uAO.value = t.plinthAO;
    fu.uCodex.value = t.codex;
    fu.uDark.value = t.dark;
    backdrop.uniforms.uCodex.value = t.codex;
    backdrop.uniforms.uDark.value = t.dark;
    plinth.shadowK.value = 1 - t.dark * 0.3;
    dust.uniforms.uColor.value.copy(t.dustColor);
    dust.uniforms.uAlpha.value = t.dustAlpha;
  }

  function update(dt, time, ctx = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    if (tokens.update()) { applyTokens(); envDirty = true; }

    // shared palette colours (already blended by main.js)
    const pc = palette.current;
    backdrop.uniforms.uBg.value.copy(pc.bg);
    backdrop.uniforms.uBgEdge.value.copy(pc.bgEdge);
    floor.uniforms.uLine.value.copy(pc.line);

    // "lift" = 0 when standing (on the plinth or the floor), growing with height. Derived from the
    // thorax position so it is exact at rest whatever convention ctx.altitude uses; ctx.altitude is
    // the fallback when no position is given.
    let alt;
    if (ctx.beePos) {
      bee.copy(ctx.beePos);
      alt = Math.max(0, bee.y - surfaceY(bee.x, bee.z) - REST_LIFT);
    } else alt = Math.max(0, ctx.altitude ?? 0);
    altitude = dt > 0 ? damp(altitude, alt, 8, dt) : alt;

    // lights follow the bee; slow breathing so metals always shimmer a little
    lights.follow(bee);
    const b = 1 + 0.03 * (0.6 * Math.sin(time * 0.9) + 0.4 * Math.sin(time * 0.37 + 2.0));
    breathKey = b;
    lights.keyLight.intensity = t.keyIntensity * b;
    lights.rimLight.intensity = t.rimIntensity * (2 - b * 0.5 - 0.5);
    scene.environmentIntensity = t.envIntensity * (1 + (b - 1) * 0.8);
    scene.environmentRotation.set(0, 0.2 * Math.sin(time * 0.13) + 0.07 * Math.sin(time * 0.31 + 1.7), 0);

    ground.update(dt, bee, altitude, t.shadowBody, t.shadowContact);
    floor.uniforms.uShadowK.value = 1;

    dust.uniforms.uKeyDir.value.copy(KEY_DIR);
    dust.uniforms.uCentre.value.copy(bee);

    if (envDirty) { lights.captureEnvironment(); envDirty = false; }
  }

  function prerender(renderer_, scene_) {
    ground.render(renderer_ || renderer, scene_ || scene, [plinth.group]);
    (renderer_ || renderer).shadowMap.needsUpdate = true;   // consumed by the next render (beauty)
  }

  // Everything the stage puts on LAYERS.DEFAULT (the plinth) is a patched material, and everything
  // else lives on HELPERS / GHOST, which those passes never see — so there is nothing to hide.
  function beforePass(pass) { void pass; void PASS; }
  function afterPass(pass) { void pass; }

  function setInk(p) { floor.uniforms.uInkIn.value = clamp(p, 0, 1); }

  applyTokens();
  lights.follow(bee);
  ground.update(0, bee, 0, t.shadowBody, t.shadowContact);

  return {
    group,
    update,
    setInk,
    prerender,
    beforePass,
    afterPass,
    surfaceY,
    keyLight: lights.keyLight,
    rimLight: lights.rimLight,
    hemiLight: lights.hemi,
    plinth: plinth.group,
    tokens: t,
    _debug: { ground, floor, backdrop, plinth, lights, dust, get breath() { return breathKey; } },
  };
}
