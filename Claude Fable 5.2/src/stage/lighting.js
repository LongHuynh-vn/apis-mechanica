// ─────────────────────────────────────────────────────────────────────────────
// stage/lighting.js — key / rim / hemisphere lights and the procedural studio
// environment map.
//
// The studio is one analytic sphere shader (no textures): a soft ambient
// gradient, a large key softbox front-left-above (aligned with the key light),
// a tall narrow strip light behind-right (the elegant line highlight along
// clearcoat edges), a dim overhead panel, a weak front-right fill card and a
// black flag on the left for negative fill. It is captured into a reused cube
// target and prefiltered with PMREMGenerator.fromCubemap into a reused PMREM
// target, so re-theming re-captures every frame of the fade without allocating.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const KEY_DIR = new THREE.Vector3(-0.5, 0.74, 0.45).normalize();     // toward the key light
export const RIM_DIR = new THREE.Vector3(0.42, 0.5, -0.76).normalize();     // behind-right-above

const STUDIO_FRAG = /* glsl */ `
uniform vec3 uAmbTop, uAmbHorizon, uAmbGround;
uniform float uAmb;
uniform vec3 uKeyDir, uStripDir, uFillDir;
uniform float uKey, uStrip, uTop, uFill, uFlag;
uniform vec3 uKeyTint, uStripTint, uFillTint;
varying vec3 vDir;

// soft rectangle centred on direction n with half-extents (tangent of half angles) ext
float softbox(vec3 v, vec3 n, vec3 up, vec2 ext, float soft) {
  float c = dot(v, n);
  if (c <= 0.0) return 0.0;
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  vec2 q = vec2(dot(v, t), dot(v, b)) / c;
  vec2 e = abs(q) / ext;
  float m = (1.0 - smoothstep(1.0 - soft, 1.0, e.x)) * (1.0 - smoothstep(1.0 - soft, 1.0, e.y));
  float falloff = 1.0 - 0.35 * dot(q / ext, q / ext);      // brighter centre, like diffusion fabric
  return m * max(falloff, 0.0);
}

void main() {
  vec3 v = normalize(vDir);
  float y = v.y;
  vec3 amb = y > 0.0 ? mix(uAmbHorizon, uAmbTop, smoothstep(0.0, 0.8, y)) : mix(uAmbHorizon, uAmbGround, smoothstep(0.0, 0.35, -y));
  vec3 col = amb * uAmb;
  // black flag (negative fill) on the camera-left side, low
  float flag = softbox(v, normalize(vec3(-1.0, 0.05, -0.25)), vec3(0, 1, 0), vec2(0.9, 0.7), 0.5);
  col *= 1.0 - flag * uFlag;
  col += uKeyTint * uKey * softbox(v, uKeyDir, vec3(0, 1, 0), vec2(0.62, 0.42), 0.32);
  col += uStripTint * uStrip * softbox(v, uStripDir, vec3(0, 1, 0), vec2(0.075, 0.95), 0.45);
  col += uStripTint * uStrip * 0.45 * softbox(v, normalize(vec3(-0.75, 0.35, -0.6)), vec3(0, 1, 0), vec2(0.05, 0.7), 0.5);
  col += vec3(1.0) * uTop * softbox(v, vec3(0.0, 1.0, 0.0), vec3(0, 0, 1), vec2(0.75, 0.75), 0.6);
  col += uFillTint * uFill * softbox(v, uFillDir, vec3(0, 1, 0), vec2(0.9, 0.5), 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createLighting({ renderer, scene }) {
  const group = new THREE.Group();
  group.name = 'stage.lights';

  // ── key: soft, front-left-above, shadow-casting, follows the bee ──────────
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.name = 'stage.key';
  keyLight.castShadow = true;
  const sh = keyLight.shadow;
  sh.mapSize.set(2048, 2048);
  sh.camera.left = -12; sh.camera.right = 12; sh.camera.top = 12; sh.camera.bottom = -12;
  sh.camera.near = 20; sh.camera.far = 80;
  sh.bias = -0.00025;
  sh.normalBias = 0.018;
  sh.radius = 2.2;
  sh.intensity = 0.72;
  sh.camera.updateProjectionMatrix();
  group.add(keyLight, keyLight.target);

  // ── rim: from behind, separates the silhouette ─────────────────────────────
  const rimLight = new THREE.DirectionalLight(0xffffff, 1.2);
  rimLight.name = 'stage.rim';
  group.add(rimLight, rimLight.target);

  // ── fill ───────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.3);
  hemi.name = 'stage.hemi';
  group.add(hemi);

  // ── procedural studio → PMREM ──────────────────────────────────────────────
  const su = {
    uAmbTop: { value: new THREE.Color() }, uAmbHorizon: { value: new THREE.Color() }, uAmbGround: { value: new THREE.Color() },
    uAmb: { value: 0.5 },
    uKeyDir: { value: KEY_DIR.clone() },
    uStripDir: { value: new THREE.Vector3(0.62, 0.22, -0.75).normalize() },
    uFillDir: { value: new THREE.Vector3(0.8, 0.12, 0.58).normalize() },
    uKey: { value: 5 }, uStrip: { value: 6 }, uTop: { value: 1.5 }, uFill: { value: 0.8 }, uFlag: { value: 0.9 },
    uKeyTint: { value: new THREE.Color() }, uStripTint: { value: new THREE.Color() }, uFillTint: { value: new THREE.Color() },
  };
  const studio = new THREE.Scene();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(10, 64, 32),
    new THREE.ShaderMaterial({
      name: 'stage.studio',
      uniforms: su,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: STUDIO_FRAG,
    }),
  );
  studio.add(sphere);
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.5, 50, cubeRT);
  studio.add(cubeCam);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let pmremRT = null;

  function captureEnvironment() {
    cubeCam.update(renderer, studio);
    pmremRT = pmrem.fromCubemap(cubeRT.texture, pmremRT);
    scene.environment = pmremRT.texture;
  }

  function applyTokens(t) {
    keyLight.color.copy(t.keyColor);
    rimLight.color.copy(t.rimColor);
    hemi.color.copy(t.hemiSky);
    hemi.groundColor.copy(t.hemiGround);
    hemi.intensity = t.hemiIntensity;
    sh.intensity = t.keyShadow;
    su.uAmbTop.value.copy(t.stAmbTop); su.uAmbHorizon.value.copy(t.stAmbHorizon); su.uAmbGround.value.copy(t.stAmbGround);
    su.uAmb.value = t.stAmb;
    su.uKey.value = t.stKey; su.uStrip.value = t.stStrip; su.uTop.value = t.stTop; su.uFill.value = t.stFill; su.uFlag.value = t.stFlag;
    su.uKeyTint.value.copy(t.stKeyTint); su.uStripTint.value.copy(t.stStripTint); su.uFillTint.value.copy(t.stFillTint);
  }

  // light-space basis of the key shadow camera (matches Object3D.lookAt with up = +Y)
  const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), KEY_DIR).normalize();
  const ly = new THREE.Vector3().crossVectors(KEY_DIR, lx).normalize();
  const texel = (sh.camera.right - sh.camera.left) / sh.mapSize.x;
  const _p = new THREE.Vector3();

  /** Centre the tight shadow frustum on `pos`, snapped to whole shadow texels (no shimmer). */
  function follow(pos) {
    const a = Math.round(pos.dot(lx) / texel) * texel;
    const b = Math.round(pos.dot(ly) / texel) * texel;
    const c = pos.dot(KEY_DIR);
    _p.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(KEY_DIR, c);
    keyLight.target.position.copy(_p);
    keyLight.position.copy(_p).addScaledVector(KEY_DIR, 50);
    rimLight.target.position.copy(pos);
    rimLight.position.copy(pos).addScaledVector(RIM_DIR, 50);
    keyLight.target.updateMatrixWorld();
    rimLight.target.updateMatrixWorld();
  }

  return { group, keyLight, rimLight, hemi, applyTokens, captureEnvironment, follow };
}
