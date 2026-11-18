// ─────────────────────────────────────────────────────────────────────────────
// dev/ui-test.js — harness for the UI / labels / camera / input / sound layer.
// Stand-in meshes for every part, a fake intro, a fake flight controller with
// plausible telemetry, eased explode, theme crossfade, and a live overlap check
// on the labels (window.__uiTest.report()).
//
// URL flags: ?explode=1  ?flight=1  ?theme=0..3  ?skipIntro  ?view=plan
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { state, actions, bus, FLIGHT } from '../core/state.js';
import { palette, startThemeBlend, updateThemeBlend } from '../core/themes.js';
import { DIMS } from '../core/dims.js';
import { clamp, damp, smoothstep, TAU, DEG } from '../core/math.js';
import { PARTS_COPY } from '../data/partsCopy.js';
import { createUI } from '../ui/ui.js';
import { createLabels } from '../ui/labels.js';
import { createSound } from '../ui/sound.js';
import { createCameraRig } from '../interaction/cameraRig.js';
import { createInput } from '../interaction/input.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('gl');
const uiRoot = document.getElementById('ui');
const annotRoot = document.getElementById('annot');

// ── renderer / scene ───────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(DIMS.cameraFov, innerWidth / innerHeight, 0.5, 600);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(12, 30, 18); scene.add(sun);

const plinth = new THREE.Mesh(new THREE.CylinderGeometry(DIMS.plinthRadius, DIMS.plinthRadius * 1.04, DIMS.plinthTopY, 6),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
plinth.position.y = DIMS.plinthTopY / 2;
scene.add(plinth);

const mats = {
  body: new THREE.MeshStandardMaterial({ roughness: 0.35 }),
  metal: new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ roughness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  eye: new THREE.MeshStandardMaterial({ color: 0x15120e, roughness: 0.15 }),
  core: new THREE.MeshStandardMaterial({ color: 0xe0902a, emissive: 0xc06010, emissiveIntensity: 0.8 }),
  filament: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.6 }),
};

// ── stand-in bee ───────────────────────────────────────────────────────────
const bee = new THREE.Group();
bee.position.set(DIMS.beeRest.x, DIMS.beeRest.y, DIMS.beeRest.z);
scene.add(bee);

const S = (r) => new THREE.SphereGeometry(r, 24, 16);
const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const C = (r, h) => new THREE.CylinderGeometry(r, r, h, 16);
// id: [geometry, material role, assembled pos (rel. thorax), explode offset, focus radius, priority, mirror?, scale]
const SPECS = {
  cranium: [S(1.3), 'body', [0, -0.15, 2.75], [0, 1.5, 6], 1.5, 0],
  eyes: [S(0.7), 'eye', [1.0, 0.05, 2.95], [3.5, 2.5, 6.5], 1.6, 0, true, [0.7, 1, 0.8]],
  ocelli: [S(0.22), 'eye', [0, 1.15, 2.6], [0, 5.5, 5], 0.6, 1],
  antennae: [C(0.08, 2.6), 'metal', [0.45, 1.3, 3.8], [1.8, 6.5, 6.5], 1.6, 0, true],
  mandibles: [B(0.5, 0.25, 0.7), 'metal', [0.35, -1.0, 3.7], [1.5, -3, 7.5], 0.8, 1, true],
  proboscis: [C(0.1, 1.8), 'metal', [0, -1.4, 3.3], [0, -5, 6.5], 1.0, 1],
  scutum: [S(1.5), 'body', [0, 1.05, 0.1], [0, 6.5, 0.5], 1.6, 0, false, [1, 0.35, 1.1]],
  thoraxbox: [S(1.7), 'body', [0, 0, 0], [0, 0, 0], 2.0, 0],
  motor: [B(1.2, 1.0, 1.2), 'metal', [0, 0.1, 0], [-5.5, 3.5, 0.5], 1.0, 0],
  geartrain: [C(0.6, 0.18), 'metal', [0.4, 0.4, 0.1], [6, 4.5, 1], 0.8, 1],
  hinges: [B(0.6, 0.4, 0.6), 'metal', [1.5, 0.9, 0.2], [9.5, 3, 1.5], 0.7, 1, true],
  setae: [S(0.6), 'filament', [0, 0.9, 1.6], [-3.5, 6, 3], 0.8, 1],
  forewings: [B(7.7, 0.04, 2.2), 'glass', [4.6, 1.2, -1.2], [5, 4.5, -1.5], 4.0, 0, true],
  hindwings: [B(5.5, 0.04, 1.6), 'glass', [3.6, 1.0, -2.6], [4, 2, -5], 3.0, 0, true],
  hamuli: [B(1.2, 0.08, 0.12), 'metal', [2.6, 1.08, -2.1], [11.5, 0.5, -3.5], 0.7, 1],
  forelegs: [C(0.12, 2.4), 'body', [0.9, -1.6, 1.3], [3, -4.5, 4], 1.4, 1, true],
  midlegs: [C(0.12, 2.8), 'body', [1.1, -1.8, 0], [4.5, -5, 0.5], 1.5, 1, true],
  hindlegs: [C(0.13, 3.4), 'body', [1.25, -2.0, -1.2], [5.5, -5.5, -3], 1.8, 0, true],
  corbicula: [S(0.35), 'metal', [1.6, -2.6, -1.6], [-11.5, -5, -4], 0.6, 1],
  petiole: [C(0.35, 0.6), 'metal', [0, -0.2, -1.9], [0, -1.5, -3.5], 0.5, 1],
  tergites: [S(1.9), 'body', [0, -0.1, -4.3], [0, 2, -7], 2.6, 0, false, [0.9, 0.85, 1.4]],
  core: [S(0.9), 'core', [0, -0.1, -4.3], [0, -4.5, -6.5], 1.1, 0],
  sting: [new THREE.ConeGeometry(0.22, 1.2, 12), 'metal', [0, -0.3, -7.0], [0, -1, -10.5], 0.8, 0],
};

const parts = [];
for (const [id, [geo, role, pos, off, radius, priority, mirror, scale]] of Object.entries(SPECS)) {
  const g = new THREE.Group();
  g.userData.partId = id;
  const sides = mirror ? [1, -1] : [1];
  for (const s of sides) {
    const m = new THREE.Mesh(geo, mats[role]);
    m.position.set(pos[0] * s, pos[1], pos[2]);
    if (scale) m.scale.set(...scale);
    if (id === 'antennae') m.rotation.x = -0.6;
    if (id === 'proboscis' || id === 'petiole') m.rotation.x = Math.PI / 2;
    if (id.endsWith('legs')) m.rotation.z = 0.35 * s;
    if (id === 'sting') m.rotation.x = -Math.PI / 2;
    m.userData.side = s;
    g.add(m);
  }
  g.userData.off = new THREE.Vector3(...off).multiplyScalar(0.62);
  g.userData.mirror = !!mirror;
  g.userData.radius = radius;
  g.userData.priority = priority;
  bee.add(g);
  parts.push(g);
}

const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
function partCentre(g, out) {
  // centre of the part (single-sided parts: the mesh; mirrored: the +X instance)
  return g.children[0].getWorldPosition(out);
}

// ── modules under test ─────────────────────────────────────────────────────
const ui = createUI({ root: uiRoot });
const rig = createCameraRig({ camera, dom: canvas });
const labels = createLabels({
  root: uiRoot,
  onSelect: (id) => { actions.select(id); rig.focusOn(getPartFocus(id)); },
});
const sound = createSound();
const getPickables = () => parts.flatMap((g) => g.children);
const getPartFocus = (id) => {
  const g = parts.find((p) => p.userData.partId === id);
  return { center: () => partCentre(g, new THREE.Vector3()), radius: g.userData.radius };
};
const input = createInput({ dom: canvas, camera, rig, getPickables, getPartFocus });

// ── fake world ─────────────────────────────────────────────────────────────
const REST = new THREE.Vector3(DIMS.beeRest.x, DIMS.beeRest.y, DIMS.beeRest.z);
const sim = { t: 0, beat: 0, fa: 0, worldT: 0, phase: 0, prev: REST.clone(), vel: new THREE.Vector3(), heading: 0, turn: 0, warm: 0 };
const intro = { t: 0, active: !params.has('skipIntro') };
if (!intro.active) { state.assembly = 1; state.uiReveal = 1; }

bus.on('theme', ({ value }) => startThemeBlend(value));
bus.on('replayIntro', () => { intro.t = 0; intro.active = true; });
bus.on('screenshot', () => {
  renderer.render(scene, camera);
  console.info('[ui-test] screenshot requested — data URL length', canvas.toDataURL('image/png').length);
});
bus.on('proboscis', () => console.info('[ui-test] proboscis toggled'));
bus.on('renderMode', ({ value }) => { for (const m of Object.values(mats)) m.wireframe = value === 'schematic'; });

function flightPath(t, out) {
  const c = DIMS.flightCentre, r = DIMS.flightRadii;
  return out.set(c.x + Math.sin(t * 0.37) * r.x * 0.85, c.y + Math.sin(t * 0.61 + 0.6) * r.y * 0.6, c.z + Math.sin(t * 0.23 + 1.1) * r.z * 0.8);
}

function stepWorld(dt) {
  const wdt = state.paused ? 0 : dt * state.tempo;
  sim.worldT += wdt;
  const T = state.telemetry;
  switch (state.flight) {
    case FLIGHT.RESTING:
      sim.beat = damp(sim.beat, 0, 3, wdt);
      if (state.wantFlight) { actions.setFlightStatus(FLIGHT.WARMING); sim.warm = 0; }
      break;
    case FLIGHT.WARMING:
      sim.warm += wdt;
      sim.beat = 230 * smoothstep(0, 1.2, sim.warm);
      if (!state.wantFlight) actions.setFlightStatus(FLIGHT.RESTING);
      else if (sim.warm > 1.3) actions.setFlightStatus(FLIGHT.IN_FLIGHT);
      break;
    case FLIGHT.IN_FLIGHT:
      sim.beat = damp(sim.beat, 230, 3, wdt);
      sim.fa = damp(sim.fa, 1, 0.9, wdt);
      if (!state.wantFlight) actions.setFlightStatus(FLIGHT.LANDING);
      break;
    case FLIGHT.LANDING:
      sim.fa = damp(sim.fa, 0, 1.1, wdt);
      if (state.wantFlight) actions.setFlightStatus(FLIGHT.IN_FLIGHT);
      else if (sim.fa < 0.01) { sim.fa = 0; actions.setFlightStatus(FLIGHT.RESTING); }
      break;
  }
  sim.t += wdt * sim.fa;
  flightPath(sim.t, tmpV);
  const fe = smoothstep(0, 1, sim.fa);
  bee.position.lerpVectors(REST, tmpV, fe);
  if (wdt > 0) {
    tmpW.subVectors(bee.position, sim.prev).divideScalar(wdt);
    sim.vel.lerp(tmpW, 1 - Math.exp(-8 * wdt));
  }
  sim.prev.copy(bee.position);
  const hv = Math.hypot(sim.vel.x, sim.vel.z);
  const heading = hv > 0.3 ? Math.atan2(sim.vel.x, sim.vel.z) : sim.heading;
  const dH = Math.atan2(Math.sin(heading - sim.heading), Math.cos(heading - sim.heading));
  if (wdt > 0) sim.turn = damp(sim.turn, dH / wdt, 4, wdt);
  sim.heading = heading;
  bee.rotation.y = heading * fe;
  bee.rotation.z = -clamp(sim.turn * 0.25, -0.5, 0.5) * fe;
  sim.phase += TAU * sim.beat * wdt;

  state.flightAmount = sim.fa;
  T.alt = (bee.position.y - REST.y) * 10;
  T.airspeed = sim.vel.length() * 10;
  T.heading = ((heading / DEG) % 360 + 360) % 360;
  T.beatHz = sim.beat;
  const asym = clamp(sim.turn * 14, -18, 18) * fe;
  T.ampL = sim.beat > 1 ? 90 + asym : 0;
  T.ampR = sim.beat > 1 ? 90 - asym : 0;
  T.phase = sim.phase;
  T.strokeL = Math.sin(sim.phase); T.strokeR = Math.sin(sim.phase);
  T.thrust = sim.beat / 230 * (state.flight === FLIGHT.RESTING ? 0.3 : 1);

  // explode
  state.explode = damp(state.explode, state.explodeTarget, 3.2, dt);
  if (Math.abs(state.explode - state.explodeTarget) < 1e-4) state.explode = state.explodeTarget;
  for (const g of parts) {
    const e = state.explode, off = g.userData.off;
    g.children.forEach((m) => {
      const s = m.userData.side;
      m.userData.base ??= m.position.clone();
      m.position.set(m.userData.base.x + off.x * s * e, m.userData.base.y + off.y * e, m.userData.base.z + off.z * e);
    });
  }
}

function stepIntro(dt) {
  if (!intro.active) { state.assembly = 1 - state.explode; return 1; }
  intro.t += dt;
  state.assembly = smoothstep(0.2, 2.6, intro.t);
  state.uiReveal = smoothstep(2.0, 4.4, intro.t);
  const k = smoothstep(0, 3.6, intro.t);
  if (intro.t > 4.6) { intro.active = false; actions.setIntroDone(); }
  return k;
}

// ── annotations (schematic mode) to exercise the #annot styles ─────────────
const annots = [
  ['annot annot--dim', '186 mm'], ['annot annot--callout', '3'], ['annot annot--note', 'Section A–A'],
].map(([cls, text]) => { const e = document.createElement('div'); e.className = cls; e.textContent = text; e.style.opacity = '0'; annotRoot.append(e); return e; });
let annotK = 0;

// ── frame for labels ───────────────────────────────────────────────────────
const items = parts.map((g) => {
  const id = g.userData.partId, c = PARTS_COPY[id];
  return { id, name: c.title, caption: c.caption, x: 0, y: 0, r: 0, alpha: 0, priority: g.userData.priority, visible: true };
});
const frame = { viewport: { w: 0, h: 0 }, bounds: null, hoverId: null, items };
const proj = new THREE.Vector3();

function buildFrame() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  frame.viewport.w = w; frame.viewport.h = h;
  frame.hoverId = state.hoverPart;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const focal = h / (2 * Math.tan((camera.fov * DEG) / 2));
  parts.forEach((g, i) => {
    const it = items[i];
    partCentre(g, proj);
    const depth = proj.distanceTo(camera.position);
    proj.project(camera);
    it.visible = proj.z < 1;
    it.x = (proj.x * 0.5 + 0.5) * w;
    it.y = (-proj.y * 0.5 + 0.5) * h;
    it.r = (g.userData.radius * focal) / Math.max(depth, 1);
    it.alpha = smoothstep(0.45, 0.85, state.explode);
    // envelope of the whole (exploded) bee, all instances
    g.children.forEach((m) => {
      m.getWorldPosition(tmpV).project(camera);
      const sx = (tmpV.x * 0.5 + 0.5) * w, sy = (-tmpV.y * 0.5 + 0.5) * h;
      const rr = it.r * 0.7;
      x0 = Math.min(x0, sx - rr); x1 = Math.max(x1, sx + rr); y0 = Math.min(y0, sy - rr); y1 = Math.max(y1, sy + rr);
    });
  });
  frame.bounds = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 };
}

// ── overlap checker ────────────────────────────────────────────────────────
const stats = { checks: 0, labelOverlaps: 0, chromeOverlaps: 0, last: [] };
function overlapCheck() {
  // what the viewer sees: displayed boxes of labels that are at least 30 % opaque,
  // against chrome blocks that are actually visible
  const rs = labels.getRects().filter((r) => r.alpha > 0.3);
  const zones = [...uiRoot.querySelectorAll('[data-avoid]')]
    .filter((z) => z.dataset.visible !== '0' && Number(getComputedStyle(z).opacity) > 0.05)
    .map((z) => z.getBoundingClientRect());
  const hit = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  stats.checks++;
  const found = [];
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    for (let j = i + 1; j < rs.length; j++) {
      if (hit(a, rs[j])) found.push(`${rs[i].id}×${rs[j].id}`);
    }
    for (const z of zones) if (hit(a, { x: z.left, y: z.top, w: z.width, h: z.height })) found.push(`${rs[i].id}×chrome`);
  }
  stats.labelOverlaps += found.filter((f) => !f.endsWith('chrome')).length;
  stats.chromeOverlaps += found.filter((f) => f.endsWith('chrome')).length;
  if (found.length && found.join() !== stats.last.join()) console.warn('[ui-test] label overlap', found.join(', '));
  stats.last = found;
}

// ── initial flags ──────────────────────────────────────────────────────────
if (params.has('theme')) { const t = Number(params.get('theme')) || 0; actions.setTheme(t); startThemeBlend(t, true); }
if (params.has('explode')) { actions.setExplode(Number(params.get('explode')) || 1); state.explode = state.explodeTarget; }
if (params.has('flight')) actions.setWantFlight(true);
if (params.has('view')) rig.setView(params.get('view'), { immediate: true });

// ── loop ───────────────────────────────────────────────────────────────────
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
}
addEventListener('resize', resize);
resize();

let last = performance.now(), checkT = 0, clock = 0;
const thorax = new THREE.Vector3(), head = new THREE.Vector3();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!window.__uiTest?.frozen) tick(dt);
  requestAnimationFrame(loop);
}
/** Advance the whole harness by dt seconds (also used by step() for headless checks). */
function tick(dt) {
  clock += dt;
  const now = clock * 1000;
  updateThemeBlend(dt);
  palette.update();
  renderer.setClearColor(palette.current.bg);
  mats.body.color.copy(palette.current.paper);
  mats.metal.color.copy(palette.current.metal);
  mats.glass.color.copy(palette.current.line);
  mats.filament.color.copy(palette.current.metal);
  plinth.material.color.copy(palette.current.bgEdge);

  const introK = stepIntro(dt);
  stepWorld(dt);
  bee.updateMatrixWorld(true);
  thorax.copy(bee.position);
  partCentre(parts.find((p) => p.userData.partId === 'cranium'), head);
  rig.update(dt, { follow: thorax, followAmount: state.flightAmount, head, intro: introK });
  input.update(dt);
  buildFrame();
  labels.update(frame, dt);
  ui.update(dt, now / 1000);
  sound.update(dt);

  // annotations in schematic mode
  annotK = damp(annotK, state.renderMode === 'schematic' ? 1 : 0, 6, dt);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const pts = [[0, 1.6 + 0.01, 9.5], [2.2, 6, 3], [-8, 1.6, -8]];
  annots.forEach((e, i) => {
    tmpV.set(...pts[i]).project(camera);
    e.style.transform = `translate3d(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px,0) translate(-50%,-50%)`;
    e.style.opacity = annotK.toFixed(3);
  });

  renderer.render(scene, camera);
  checkT += dt;
  if (checkT > 0.5) { checkT = 0; overlapCheck(); }
}
requestAnimationFrame(loop);

/** Run n frames of dt seconds synchronously (background tabs throttle rAF); checks overlaps every frame. */
function step(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) { tick(dt); overlapCheck(); } return report(); }
const report = () => ({ checks: stats.checks, labelOverlaps: stats.labelOverlaps, chromeOverlaps: stats.chromeOverlaps, last: stats.last, shown: labels.getRects().filter((r) => r.alpha > 0.5).length });
/** Inspection helper: magnify a region of the page (freezes the loop while magnified). */
function mag(x, y, s) {
  const a = document.getElementById('app');
  window.__uiTest.frozen = !!s;
  a.style.transformOrigin = `${x}px ${y}px`;
  a.style.transform = s ? `scale(${s})` : '';
}
/** Screen position (CSS px) of a world point, or of a part's centre when given a part id. */
function toScreen(p) {
  const v = typeof p === 'string' ? partCentre(parts.find((g) => g.userData.partId === p), new THREE.Vector3()) : new THREE.Vector3(...p);
  v.project(camera);
  return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
}
window.__uiTest = { state, actions, labels, rig, camera, stats, step, report, mag, toScreen, frozen: false };
