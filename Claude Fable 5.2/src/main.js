// ─────────────────────────────────────────────────────────────────────────────
// main.js — boot + frame loop.
//
//   core/        state, themes, shared rendering contract, math
//   bee/         materials · geometry builders · rig · flight controller · explode system · schematic plate
//   stage/       backdrop, drafting floor, plinth, lighting, ground shadow
//   post/        selective bloom, ink edges, depth of field, AA
//   ui/          chrome, labels, sound      interaction/  camera rig, input, picking
//
// Frame order: themes → bee (sim + rig) → stage → camera → annotations/UI → render.
// The bee's world runs on scaled time (TEMPO, pause); camera and UI on wall time.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { state, actions, bus } from './core/state.js';
import { THEMES, palette, startThemeBlend, updateThemeBlend } from './core/themes.js';
import { globalUniforms, PASS } from './core/gfx.js';
import { DIMS } from './core/dims.js';
import { Spring, clamp, smoothstep } from './core/math.js';
import { createMaterials } from './bee/materials.js';
import { createExplode } from './bee/explode.js';
import { createBee } from './bee/bee.js';
import { createSchematic } from './bee/schematic.js';
import { createGroundTrack } from './bee/groundtrack.js';
import { createDirector } from './bee/director.js';
import { createFallbackStage, createFallbackPost } from './stage/fallback.js';
import { createUI } from './ui/ui.js';
import { createLabels } from './ui/labels.js';
import { createSound } from './ui/sound.js';
import { createCameraRig } from './interaction/cameraRig.js';
import { createInput } from './interaction/input.js';

const optional = async (path) => { try { return await import(path); } catch (err) { console.warn(`[apis] ${path} unavailable, using fallback`, err); return null; } };
const guard = (label, make, fallback) => { try { return make(); } catch (err) { console.warn(`[apis] ${label} failed, using fallback`, err); return fallback(); } };

async function boot() {
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.localClippingEnabled = true;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const maxRatio = pixelRatio;
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DIMS.cameraFov, 1, 0.5, 600);
  camera.layers.enableAll();
  camera.position.set(28, 16, 36); camera.lookAt(0, 4, -1.4);

  // initial theme (shareable: #theme=obsidian)
  const wanted = THEMES.findIndex((t) => t.id === new URLSearchParams(location.hash.slice(1)).get('theme'));
  if (wanted > 0) { state.theme = wanted; startThemeBlend(wanted, true); }
  palette.update();
  bus.on('theme', ({ value }) => { startThemeBlend(value); history.replaceState(null, '', `#theme=${THEMES[value].id}`); });

  // ── stage, materials, bee, post ────────────────────────────────────────────
  const [stageMod, postMod, delftMod] = await Promise.all([optional('./stage/stage.js'), optional('./post/post.js'), optional('./textures/delft.js')]);
  const stage = stageMod ? guard('stage', () => stageMod.createStage({ renderer, scene, camera }), () => createFallbackStage({ renderer, scene })) : createFallbackStage({ renderer, scene });

  const mats = createMaterials();
  if (delftMod) {
    try {
      mats.delftBand = delftMod.createDelftBandTexture({ size: 2048 }); mats.delftBand.repeat.set(2, 1);
      mats.delftMedallion = delftMod.createDelftMedallionTexture({ size: 1024 });
    } catch (err) { console.warn('[apis] delft textures failed', err); }
  }
  const ex = createExplode();
  const bee = createBee({ scene, mats, ex, camera });
  const schematic = createSchematic({ scene, bee, root: document.getElementById('annot') });
  const post = postMod ? guard('post', () => postMod.createPost({ renderer, scene, camera, stage }), () => createFallbackPost({ renderer, scene, camera })) : createFallbackPost({ renderer, scene, camera });

  // The emissive (bloom-mask) pass only needs what glows plus the large shells that can hide it;
  // skipping the other ~120 meshes there removes most of that pass's draw calls.
  const EMISSIVE_PARTS = new Set(['core', 'eyes', 'ocelli', 'tergites', 'thoraxbox', 'scutum', 'cranium', 'petiole', 'sting']);
  const skipInEmissive = bee.pickables.filter((m) => !EMISSIVE_PARTS.has(m.userData.partId));
  const wasVisible = new Uint8Array(skipInEmissive.length);
  const stageBefore = stage.beforePass.bind(stage), stageAfter = stage.afterPass.bind(stage);
  stage.beforePass = (pass) => {
    stageBefore(pass);
    if (pass === PASS.EMISSIVE) skipInEmissive.forEach((m, i) => { wasVisible[i] = m.visible ? 1 : 0; m.visible = false; });
  };
  stage.afterPass = (pass) => {
    if (pass === PASS.EMISSIVE) skipInEmissive.forEach((m, i) => { m.visible = wasVisible[i] === 1; });
    stageAfter(pass);
  };

  // ── interaction + UI ───────────────────────────────────────────────────────
  const rig = createCameraRig({ camera, dom: canvas });
  const input = createInput({ dom: canvas, camera, rig, getPickables: () => (state.introDone ? bee.pickables : []), getPartFocus: bee.getPartFocus });
  const ui = createUI({ root: document.getElementById('ui') });
  const labels = createLabels({ root: document.getElementById('ui'), onSelect: (id) => { actions.select(id); rig.focusOn(bee.getPartFocus(id)); } });
  const sound = createSound();
  const groundTrack = createGroundTrack({ scene, bee, surfaceY: (x, z) => stage.surfaceY(x, z) });
  const director = createDirector({ rig, bee });

  // ── sizing (pixel ratio adapts to hold 60 fps) ─────────────────────────────
  let W = 0, H = 0;
  function resize(force = false) {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    if (!force && w === W && h === H) return;
    W = w; H = h;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    post.setSize(w, h, pixelRatio); rig.resize?.(w, h);
  }
  resize(true);
  let slow = 0, fast = 0, fpsAvg = 60;
  function adapt(dt) {
    fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
    state.telemetry.fps = fpsAvg;
    if (document.hidden) return;
    if (dt > 1 / 45) { slow += dt; fast = 0; } else if (dt < 1 / 57) { fast += dt; slow = Math.max(0, slow - dt * 0.5); }
    if (slow > 1.5 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); slow = 0; resize(true); }
    else if (fast > 6 && pixelRatio < maxRatio) { pixelRatio = Math.min(maxRatio, pixelRatio + 0.25); fast = 0; resize(true); }
  }

  let wantShot = false;
  bus.on('screenshot', () => { wantShot = true; });

  // capture helpers: ?ui=0 starts with the chrome hidden, ?tour=1 starts the guided tour once the bee has assembled
  const query = new URLSearchParams(location.search);
  if (query.get('ui') === '0') actions.toggleUI();
  if (query.get('tour') === '1') bus.on('introDone', () => setTimeout(() => actions.setTour(true), 900));

  // ── frame ──────────────────────────────────────────────────────────────────
  const sSchem = new Spring(1.4, 1, 0);
  let time = 0, introClock = 0;
  const highlight = new THREE.Color();

  function tick(dtReal) {
    time += dtReal;
    resize();

    // themes + shared colour globals
    updateThemeBlend(dtReal);
    palette.update();
    const pal = palette.current;
    globalUniforms.uTime.value = time; globalUniforms.uPixelRatio.value = pixelRatio;
    globalUniforms.uBg.value.copy(pal.bg); globalUniforms.uPaper.value.copy(pal.paper); globalUniforms.uInk.value.copy(pal.inkLine);
    globalUniforms.uAccent.value.copy(pal.glow);
    globalUniforms.uHighlight.value.copy(highlight.copy(pal.glow).lerp(pal.metal, 0.35));
    const schem = clamp(sSchem.step(dtReal, state.renderMode === 'schematic' ? 1 : 0));
    globalUniforms.uSchematic.value = schem < 0.002 ? 0 : schem;

    // the bee's world runs on scaled time
    director.update(dtReal);
    const dt = state.paused ? 0 : dtReal * state.tempo;
    mats.setHover(state.introDone ? (state.hoverPart || null) : null);
    mats.update(dtReal);
    bee.update(dtReal, dt, { camera, viewportH: H, time });
    groundTrack.update(dt, state.flightAmount);

    // stage
    if (!state.introDone) introClock += dtReal; else introClock = 99;
    stage.setInk(clamp(introClock / 1.9));
    const altitude = Math.max(0, bee.bodyWorld.y - 2.5 - stage.surfaceY(bee.bodyWorld.x, bee.bodyWorld.z));
    stage.update(dtReal, time, { beePos: bee.bodyWorld, altitude, flightAmount: state.flightAmount });

    // camera
    rig.update(dtReal, {
      follow: bee.bodyWorld, followAmount: Math.max(state.flightAmount, smoothstep(0, 0.6, state.explode) * 0.92),
      head: bee.headWorld, intro: state.introDone ? 1 : smoothstep(0, 1, state.assembly),
    });
    input.update(dtReal);
    camera.updateMatrixWorld();

    // annotations + chrome
    labels.update(bee.labelFrame(camera, W, H), dtReal);
    schematic.update(dtReal, { camera, w: W, h: H, amount: globalUniforms.uSchematic.value });
    ui.update(dtReal, time);
    sound.update(dtReal);

    // render
    stage.prerender(renderer, scene);
    post.params.ink = globalUniforms.uSchematic.value;
    post.params.dof = rig.dof?.amount ?? 0; post.params.focus = rig.dof?.focus ?? 30;
    post.params.bloom = 1; post.params.vignette = 1;
    post.render(dtReal);

    if (wantShot) {
      wantShot = false;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `apis-mechanica-${THEMES[state.theme].id}-${Date.now()}.png`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    adapt(dt);
    tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // debugging / capture hook: advance the piece by fixed steps without waiting for rAF
  window.__apis = { state, actions, bus, bee, rig, stage, post, mats, ex, renderer, scene, camera, THREE, ui, labels, input, sound, schematic, director, groundTrack, step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); } };
}

// fonts first, so the UI never reflows mid-reveal
const fontsReady = document.fonts?.ready ?? Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1200))]).then(boot).catch((err) => { console.error(err); });
