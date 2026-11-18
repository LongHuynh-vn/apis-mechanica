// Dev-only part viewer: ?part=thorax|head|abdomen|legs|wings|bee  &theme=0..3  &view=iso|side|top|front  &d=distance
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMaterials } from '../bee/materials.js';
import { createExplode } from '../bee/explode.js';
import { startThemeBlend, palette } from '../core/themes.js';
import { globalUniforms } from '../core/gfx.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
camera.layers.enableAll();
const controls = new OrbitControls(camera, canvas);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.03).texture;
const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(10, 18, 12); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 }); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
scene.add(key, new THREE.HemisphereLight(0xffffff, 0xbfb6a8, 0.5));

const theme = Number(q.get('theme') || 0);
startThemeBlend(theme, true); palette.update();
scene.background = palette.current.bg.clone();
globalUniforms.uBg.value.copy(palette.current.bg); globalUniforms.uPaper.value.copy(palette.current.paper); globalUniforms.uInk.value.copy(palette.current.inkLine);

const mats = createMaterials();
const ex = createExplode();
const ctx = { mats, ex };
const part = q.get('part') || 'thorax';
const log = document.getElementById('log');
let api = null;
try {
  if (part === 'bee') {
    const { createBee } = await import('../bee/bee.js');
    const { state, actions } = await import('../core/state.js');
    if (q.get('nointro')) { state.introDone = true; state.uiReveal = 1; }
    api = createBee({ scene, mats, ex, camera });
    if (q.get('fly')) setTimeout(() => actions.setWantFlight(true), 300);
    if (q.get('tempo')) actions.setTempo(Number(q.get('tempo')));
    if (q.get('explode')) actions.setExplode(Number(q.get('explode')));
    if (q.get('mode')) actions.setRenderMode(q.get('mode'));
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(8, 8.3, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.6 }));
    ground.rotation.y = Math.PI / 6; ground.position.y = 0.8; ground.receiveShadow = true; scene.add(ground);
    window.__dev2 = { state, actions };
  } else {
    const mod = await import(`../bee/${part}.js`);
    const fn = Object.values(mod).find((f) => typeof f === 'function' && /^build/.test(f.name));
    api = fn(ctx);
    scene.add(api.group || api.node);
    ex.freeze();
  }
} catch (err) { log.textContent = String(err.stack || err); console.error(err); }
scene.add(ex.guides);
window.__dev = { scene, camera, renderer, mats, ex, api, THREE, controls };

const d = Number(q.get('d') || 14);
const views = { iso: [0.62, 0.34, 0.72], side: [1, 0.08, 0.02], top: [0.01, 1, 0.01], front: [0.02, 0.1, 1], back: [-0.5, 0.3, -0.8], under: [0.5, -0.6, 0.6] };
const v = new THREE.Vector3(...(views[q.get('view') || 'iso'])).normalize().multiplyScalar(d);
const tgt = (q.get('t') || '0,0,0').split(',').map(Number);
controls.target.set(...tgt); camera.position.copy(v).add(controls.target); controls.update();

let tris = 0, calls = 0;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  globalUniforms.uTime.value = t; globalUniforms.uPixelRatio.value = renderer.getPixelRatio();
  globalUniforms.uSchematic.value = Number(q.get('schem') || 0);
  mats.update(dt);
  api?.devUpdate?.(dt, t);
  if (q.get('ex')) ex.setAmount(Number(q.get('ex'))), ex.updateGuides(1);
  controls.update();
  renderer.render(scene, camera);
  tris = renderer.info.render.triangles; calls = renderer.info.render.calls;
  if (!log.textContent.startsWith('Error') && !log.textContent.includes('at ')) log.textContent = `${part} · ${calls} calls · ${(tris / 1000).toFixed(1)}k tris`;
  requestAnimationFrame(frame);
}
frame();
