// ─────────────────────────────────────────────────────────────────────────────
// interaction/input.js — pointer state, hover picking, click-to-focus, keys.
//
//   createInput({ dom, camera, rig, getPickables, getPartFocus }) → { update(dt), pick(nx, ny) }
//
//  · keeps state.pointer (x, y, nx, ny, inside, down) — never writes overUI
//  · at most one raycast per frame, only when the pointer is over the canvas,
//    not over chrome and not dragging; → actions.setHover(id | null)
//  · click = pointerup within 5 px and 350 ms of pointerdown
//  · global keyboard shortcuts (ignored with ctrl / meta / alt, or in a field)
//  · D toggles the guided tour; any other key, any pointer-down and any wheel
//    hands control straight back to the user (state.tour → false)
//  · writes layout.bee: the machine's projected screen extents (from the local
//    bounding boxes of the pickable meshes), used by the labels and the rig
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { state, actions, VIEWS } from '../core/state.js';
import { layout } from './layout.js';
import { PARTS_COPY } from '../data/partsCopy.js';

const CLICK_PX = 5, CLICK_MS = 350;
const HEAD_IDS = new Set(Object.keys(PARTS_COPY).filter((id) => PARTS_COPY[id].group === 'Head'));

function partIdOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData && o.userData.partId != null) return o.userData.partId;
  return null;
}
function isShown(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function createInput({ dom, camera, rig, getPickables, getPartFocus }) {
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll();
  const ndc = new THREE.Vector2();
  const P = state.pointer;
  let down = null;                 // { x, y, t, button }
  let cursor = '';
  let hoverIsPart = false;

  function setPointer(e) {
    const r = dom.getBoundingClientRect();
    P.x = e.clientX - r.left;
    P.y = e.clientY - r.top;
    P.nx = (P.x / Math.max(1, r.width)) * 2 - 1;
    P.ny = -(P.y / Math.max(1, r.height)) * 2 + 1;
  }

  /** Raycast at NDC; returns part id or null. */
  function pick(nx, ny) {
    const list = getPickables?.() || [];
    if (!list.length) return null;
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(list, true);
    for (const h of hits) {
      if (!isShown(h.object)) continue;
      const id = partIdOf(h.object);
      if (id != null) return id;
    }
    return null;
  }

  // the tour director yields to the user instantly
  const yieldTour = () => { if (state.tour) actions.setTour(false); };
  window.addEventListener('pointerdown', yieldTour, { capture: true, passive: true });
  dom.addEventListener('wheel', yieldTour, { passive: true });

  window.addEventListener('pointermove', (e) => {
    setPointer(e);
    P.inside = e.target === dom;
  }, { passive: true });
  dom.addEventListener('pointerleave', () => { P.inside = false; });
  document.addEventListener('pointerleave', () => { P.inside = false; });
  window.addEventListener('blur', () => { P.inside = false; P.down = false; });

  dom.addEventListener('pointerdown', (e) => {
    setPointer(e);
    P.inside = true;
    P.down = true;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, primary: e.isPrimary };
    dom.focus?.({ preventScroll: true });
  });
  const release = (e) => {
    P.down = false;
    const d = down; down = null;
    if (!d || e.type === 'pointercancel' || d.button !== 0 || !d.primary) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX || performance.now() - d.t > CLICK_MS) return;
    setPointer(e);
    const id = pick(P.nx, P.ny);
    if (id != null) {
      actions.select(id);
      const f = getPartFocus?.(id);
      if (f) rig?.focusOn(f);
    } else {
      actions.select(null);
      rig?.clearFocus();
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // ── keyboard ─────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    // Space only "presses" a control that was reached with the keyboard; after a mouse click or a slider drag it pauses as usual
    const onButton = tag === 'BUTTON' && !!t.matches?.(':focus-visible');
    const code = e.code, key = (e.key || '').toLowerCase();

    if (key === 'd' || code === 'KeyD') { if (!e.repeat) actions.toggleTour(); return; }
    if (!/^(Shift|Control|Alt|Meta|CapsLock)/.test(e.key || '')) yieldTour();

    if (code === 'Space' || key === ' ') {
      if (onButton) return;                  // let a focused control activate normally
      e.preventDefault();
      if (!e.repeat) actions.togglePause();
      return;
    }
    if (key === 'escape') { actions.select(null); rig?.clearFocus(); return; }
    if (e.repeat) return;
    const digit = /^(Digit|Numpad)([1-5])$/.exec(code);
    if (digit) { actions.setView(VIEWS[Number(digit[2]) - 1]); return; }
    switch (key) {
      case 'f': actions.toggleFlight(); break;
      case 'e': actions.toggleExplode(); break;
      case 't': actions.cycleTheme(); break;
      case 'r': actions.cycleRenderMode(); break;
      case 'h': actions.toggleUI(); break;
      case 'o': actions.toggleOrbit(); break;
      case 'm': actions.toggleSound(); break;
      case 's': actions.screenshot(); break;
      case 'p': actions.toggleProboscis(); break;
      case 'i': actions.replayIntro(); break;
      default: return;
    }
  });

  // ── machine extents on screen (8 local box corners per pickable mesh) ──────
  const corners = new WeakMap();
  const pv = new THREE.Vector3();
  function localCorners(o) {
    let c = corners.get(o);
    if (c) return c;
    let box = null;
    if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox?.(); box = o.boundingBox; }
    else if (o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box = o.geometry.boundingBox; }
    c = [];
    if (box && !box.isEmpty()) {
      for (let i = 0; i < 8; i++) c.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    }
    corners.set(o, c);
    return c;
  }
  const acc = { bee: [0, 0, 0, 0], head: [0, 0, 0, 0] };
  const reset = (a) => { a[0] = 1e9; a[1] = -1e9; a[2] = 1e9; a[3] = -1e9; };
  const grow = (a, x, y) => { if (x < a[0]) a[0] = x; if (x > a[1]) a[1] = x; if (y < a[2]) a[2] = y; if (y > a[3]) a[3] = y; };
  const publish = (B, a) => { B.valid = a[0] < a[1]; if (B.valid) { B.l = a[0]; B.r = a[1]; B.t = a[2]; B.b = a[3]; } };
  function measureBee() {
    const list = getPickables?.() || [];
    const w = dom.clientWidth || window.innerWidth, h = dom.clientHeight || window.innerHeight;
    reset(acc.bee); reset(acc.head);
    for (const o of list) {
      if (!isShown(o)) continue;
      const isHead = HEAD_IDS.has(partIdOf(o));
      for (const c of localCorners(o)) {
        pv.copy(c).applyMatrix4(o.matrixWorld).project(camera);
        if (pv.z > 1 || pv.z < -1) continue;
        const x = (pv.x * 0.5 + 0.5) * w, y = (-pv.y * 0.5 + 0.5) * h;
        grow(acc.bee, x, y);
        if (isHead) grow(acc.head, x, y);
      }
    }
    publish(layout.bee, acc.bee);
    publish(layout.head, acc.head);
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  function update() {
    measureBee();
    const dragging = !!rig?.dragging;
    if (P.inside && !P.overUI && !dragging) {
      const id = pick(P.nx, P.ny);
      hoverIsPart = id != null;
      if (id !== state.hoverPart) actions.setHover(id);
    } else if (!P.inside && !P.overUI && !dragging) {
      hoverIsPart = false;
      if (state.hoverPart != null) actions.setHover(null);
    }
    const c = dragging ? 'grabbing' : P.inside && hoverIsPart && !P.overUI ? 'pointer' : 'grab';
    if (c !== cursor) { cursor = c; dom.style.cursor = c; }
  }

  return { update, pick };
}
