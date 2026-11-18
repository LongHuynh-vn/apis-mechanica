// ─────────────────────────────────────────────────────────────────────────────
// stage/fallback.js — a plain stage and a pass-through "post" with the same
// interfaces as stage.js / post.js. Only used if those modules fail to load,
// so the piece always renders.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DIMS } from '../core/dims.js';
import { palette } from '../core/themes.js';
import { patchMaterial } from '../core/gfx.js';

export function createFallbackStage({ renderer, scene }) {
  const group = new THREE.Group(); scene.add(group);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.03).texture;
  scene.background = new THREE.Color();
  const keyLight = new THREE.DirectionalLight(0xfff3e4, 2.2); keyLight.position.set(12, 22, 14); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.02;
  Object.assign(keyLight.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
  const rimLight = new THREE.DirectionalLight(0xdfe8ff, 1.1); rimLight.position.set(-10, 9, -16);
  group.add(keyLight, keyLight.target, rimLight, new THREE.HemisphereLight(0xffffff, 0xb8ae9e, 0.45));
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xece5d8, roughness: 0.5, clearcoat: 0.3 });
  patchMaterial(mat, {});
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(DIMS.plinthRadius, DIMS.plinthRadius + 0.3, DIMS.plinthTopY, 6), mat);
  plinth.rotation.y = Math.PI / 6; plinth.position.y = DIMS.plinthTopY / 2; plinth.receiveShadow = true; group.add(plinth);
  const apothem = DIMS.plinthRadius * Math.cos(Math.PI / 6);
  return {
    group, keyLight, rimLight,
    update(dt, time, ctx) {
      scene.background.copy(palette.current.bg); mat.color.copy(palette.current.panel);
      if (ctx?.beePos) { keyLight.target.position.copy(ctx.beePos); keyLight.position.copy(ctx.beePos).add(new THREE.Vector3(12, 22, 14)); }
    },
    setInk() {}, prerender() {}, beforePass() {}, afterPass() {},
    surfaceY(x, z) {
      const ax = Math.abs(x), az = Math.abs(z);
      return az <= apothem && ax * 0.8660254 + az * 0.5 <= apothem ? DIMS.plinthTopY : 0;
    },
  };
}

export function createFallbackPost({ renderer, scene, camera }) {
  return {
    params: { bloom: 1, ink: 0, dof: 0, focus: 30, vignette: 1 },
    setSize() {},
    render() { renderer.render(scene, camera); },
  };
}
