// ─────────────────────────────────────────────────────────────────────────────
// dev/stage-test.js — harness for the stage, post pipeline and Delft textures.
//
// Keys:  T theme · R schematic · D depth of field · F bob 0–15 cm · I replay ink-in
//        M macro camera · V toggle vignette · B toggle bloom · H hud
// URL:   ?theme=0..3 &schematic=1 &dof=1 &bob=1 &macro=1 &lift=<cm>
// Stand-in subject at DIMS.beeRest: glossy clearcoat ivory body (Delft band
// crossfades in with the Delft theme), polished gold collar + head, six thin
// legs standing on the plinth, a glass wing panel on LAYERS.GLASS, and an
// emissive amber core half-hidden by an opaque gold shell (bloom must respect it).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LAYERS, globalUniforms, patchMaterial, setLayer } from '../core/gfx.js';
import { DIMS } from '../core/dims.js';
import { palette, startThemeBlend, updateThemeBlend, themeBlend, THEMES } from '../core/themes.js';
import { damp } from '../core/math.js';
import { createStage } from '../stage/stage.js';
import { createPost } from '../post/post.js';
import { createDelftBandTexture, createDelftMedallionTexture } from '../textures/delft.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.localClippingEnabled = true;
const pr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pr);
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(DIMS.cameraFov, 1, 0.5, 600);
camera.position.set(30, 22, 38);
const controls = new OrbitControls(camera, canvas);
controls.target.set(DIMS.beeCentre.x, DIMS.beeCentre.y, DIMS.beeCentre.z);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 6;
controls.maxDistance = 200;

const stage = createStage({ renderer, scene, camera });
const post = createPost({ renderer, scene, camera, stage });

// ── stand-in subject ───────────────────────────────────────────────────────
const subject = new THREE.Group();
subject.name = 'subject';
scene.add(subject);
const band = createDelftBandTexture();
const medallion = createDelftMedallionTexture();

const ivory = new THREE.MeshPhysicalMaterial({ color: 0xf6f0e4, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, map: band });
const ivoryU = patchMaterial(ivory, { pattern: true, fillInk: 0 });
const plate = new THREE.MeshPhysicalMaterial({ color: 0xf6f0e4, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, map: medallion });
const plateU = patchMaterial(plate, { pattern: true, fillInk: 0 });
const gold = new THREE.MeshPhysicalMaterial({ color: 0xd8a94a, metalness: 1, roughness: 0.18, clearcoat: 0.4, clearcoatRoughness: 0.1 });
patchMaterial(gold, { fillInk: 0.25 });
const darkEnamel = new THREE.MeshPhysicalMaterial({ color: 0x1b1916, metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
patchMaterial(darkEnamel, { fillInk: 0.85 });
const glass = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
  clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false,
});
patchMaterial(glass, {});
const amber = new THREE.MeshPhysicalMaterial({ color: 0x331a05, emissive: 0xffa230, emissiveIntensity: 7, roughness: 0.3 });
patchMaterial(amber, { fillAccent: 1 });

const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const R = DIMS.beeRest;
const abdomen = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), ivory));
abdomen.scale.set(1.75, 1.6, 3.6);
abdomen.position.set(0, 0.05, -3.2);
abdomen.rotation.x = -0.12;
const thorax = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), plate));
thorax.scale.set(1.8, 1.7, 1.9);
thorax.rotation.x = -Math.PI / 2;           // medallion faces up
const collar = shadowy(new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.16, 24, 96), gold));
collar.position.set(0, 0, -1.6);
const head = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1.15, 64, 32), gold));
head.position.set(DIMS.beeHeadOffset.x, DIMS.beeHeadOffset.y, DIMS.beeHeadOffset.z);
const eyeL = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.55, 48, 24), darkEnamel));
eyeL.position.set(0.75, 0.2, 3.1);
const eyeR = eyeL.clone(); eyeR.position.x = -0.75;
// emissive core, half hidden by an opaque shell
const core = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 24), amber);
core.position.set(0, 1.55, 0.2);
const shell = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24, 0, Math.PI), gold));
shell.position.copy(core.position);
shell.material = gold.clone(); patchMaterial(shell.material, { fillInk: 0.25 });
shell.material.side = THREE.DoubleSide;
shell.rotation.y = Math.PI * 0.5;            // covers the -Z… let the open side face the camera-left
subject.add(abdomen, thorax, collar, head, eyeL, eyeR, core, shell);

// six legs, thin rods (0.15 cm) touching the plinth top
const legMat = darkEnamel;
const footY = DIMS.plinthTopY - R.y;
for (const side of [-1, 1]) {
  for (const [z, spread] of [[1.2, 2.6], [0.0, 3.2], [-1.4, 3.0]]) {
    const hip = new THREE.Vector3(side * 1.1, -0.9, z);
    const knee = new THREE.Vector3(side * spread, -0.4, z + (z > 0.5 ? 0.9 : z < -0.5 ? -0.9 : 0.2));
    const foot = new THREE.Vector3(side * (spread + 0.7), footY + 0.075, z + (z > 0.5 ? 1.6 : z < -0.5 ? -1.8 : 0.3));
    for (const [a, b] of [[hip, knee], [knee, foot]]) {
      const len = a.distanceTo(b);
      const rod = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, len, 12), legMat));
      rod.position.copy(a).add(b).multiplyScalar(0.5);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      subject.add(rod);
    }
    const toe = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8), gold));
    toe.position.copy(foot).setY(footY + 0.11);
    subject.add(toe);
  }
}
// glass wing panels
for (const side of [-1, 1]) {
  const wing = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.6), glass);
  wing.position.set(side * 4.6, 1.5, -1.6);
  wing.rotation.set(-Math.PI / 2 + 0.08, 0, side * -0.32);
  setLayer(wing, LAYERS.GLASS);
  subject.add(wing);
}
subject.position.set(R.x, R.y, R.z);

// ── state & keys ────────────────────────────────────────────────────────────
let theme = Number(q.get('theme') ?? 0) % 4;
startThemeBlend(theme, true);
let schematicTarget = q.get('schematic') === '1' ? 1 : 0;
let dofTarget = q.get('dof') === '1' ? 1 : 0;
let bob = q.get('bob') === '1';
let bobT = 0;
let ink = 1, inkPlaying = false;
let hudOn = q.get('hud') !== '0';
let fixedLift = q.get('lift') != null ? Number(q.get('lift')) : null;
let offX = Number(q.get('x') ?? 0);           // shift the subject sideways (e.g. x=14 → over the floor)
if (q.get('macro') === '1') { camera.position.set(4.5, 5.6, 11.5); controls.target.set(0, 4.0, 3.2); }
globalUniforms.uSchematic.value = schematicTarget;
post.params.ink = schematicTarget;
post.params.dof = dofTarget;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 't') { theme = (theme + 1) % 4; startThemeBlend(theme); }
  if (k === 'r') schematicTarget = schematicTarget ? 0 : 1;
  if (k === 'd') dofTarget = dofTarget ? 0 : 1;
  if (k === 'f') bob = !bob;
  if (k === 'i') { ink = 0; inkPlaying = true; }
  if (k === 'v') post.params.vignette = post.params.vignette ? 0 : 1;
  if (k === 'b') post.params.bloom = post.params.bloom ? 0 : 1;
  if (k === 'h') hudOn = !hudOn;
  if (k === 'm') { camera.position.set(4.5, 5.6, 11.5); controls.target.set(0, 4.0, 3.2); }
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h, renderer.getPixelRatio());
  globalUniforms.uPixelRatio.value = renderer.getPixelRatio();
}
window.addEventListener('resize', resize);
resize();

// ── frame loop ─────────────────────────────────────────────────────────────
let last = performance.now();
let time = 0, fpsAvg = 60, msAvg = 16;
const beePos = new THREE.Vector3();
const headWorld = new THREE.Vector3();

function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
  last = now;
  time += dt;
  const t0 = performance.now();
  renderer.info.reset();

  updateThemeBlend(dt);
  palette.update();
  const pc = palette.current;
  globalUniforms.uBg.value.copy(pc.bg);
  globalUniforms.uPaper.value.copy(pc.paper);
  globalUniforms.uInk.value.copy(pc.inkLine);
  globalUniforms.uAccent.value.copy(pc.accent);
  globalUniforms.uHighlight.value.copy(pc.glow);
  globalUniforms.uTime.value = time;
  globalUniforms.uSchematic.value = damp(globalUniforms.uSchematic.value, schematicTarget, 5, dt);
  post.params.ink = globalUniforms.uSchematic.value;
  post.params.dof = damp(post.params.dof, dofTarget, 5, dt);

  // Delft band / medallion crossfade with the Delft theme
  const delftW = themeBlend.to === 1 ? themeBlend.t : themeBlend.from === 1 ? 1 - themeBlend.t : 0;
  ivoryU.uPatternMix.value = delftW;
  plateU.uPatternMix.value = delftW;

  // subject bob 0–15 cm
  if (bob) bobT += dt;
  else bobT = damp(bobT, Math.round(bobT / (Math.PI * 2 / 0.9)) * (Math.PI * 2 / 0.9), 3, dt);
  const lift = fixedLift ?? 15 * (0.5 - 0.5 * Math.cos(bobT * 0.9));
  subject.position.set(R.x + offX, R.y + lift, R.z);
  subject.updateMatrixWorld();
  beePos.copy(subject.position);

  if (inkPlaying) { ink = Math.min(1, ink + dt / 4.5); if (ink >= 1) inkPlaying = false; }
  stage.setInk(ink);

  stage.update(dt, time, { beePos, altitude: lift, flightAmount: Math.min(1, lift / 4) });
  controls.update();
  head.getWorldPosition(headWorld);
  post.params.focus = camera.position.distanceTo(headWorld);

  stage.prerender(renderer, scene);
  post.render(dt);

  const ms = performance.now() - t0;
  msAvg += (ms - msAvg) * 0.05;
  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  if (hudOn) {
    hud.textContent = `${THEMES[theme].name}  ·  schematic ${schematicTarget}  ·  dof ${dofTarget}  ·  bob ${bob ? 'on' : 'off'}  ·  lift ${lift.toFixed(1)} cm\n`
      + `${fpsAvg.toFixed(0)} fps  ·  cpu ${msAvg.toFixed(2)} ms  ·  ${renderer.domElement.width}×${renderer.domElement.height}  ·  calls ${renderer.info.render.calls}\n`
      + 'T theme · R schematic · D dof · F bob · I ink-in · M macro · B bloom · V vignette · H hud';
  } else hud.textContent = '';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__harness = { renderer, scene, camera, controls, stage, post, subject, setTheme: (i) => { theme = i; startThemeBlend(i); },
  setSchematic: (v) => { schematicTarget = v; }, setDof: (v) => { dofTarget = v; }, setLift: (v) => { fixedLift = v; }, setX: (v) => { offX = v; }, band, medallion };
