// ─────────────────────────────────────────────────────────────────────────────
// interaction/cameraRig.js — spherical orbit camera with glides, focus, follow.
//
//   const rig = createCameraRig({ camera, dom })
//   rig.update(dt, { follow, followAmount, head, intro })
//   rig.setView(name, { immediate })   'iso' | 'plan' | 'front' | 'profile' | 'macro'
//   rig.focusOn({ center, radius })    center: Vector3 | () => Vector3
//   rig.clearFocus()
//   rig.resize(w, h)
//   rig.dof        { amount 0..1, focus }   (MACRO only, eased)
//   rig.dragging   true while the user is orbiting / panning / pinching
//   rig.presets    the view table (mutable — tune freely)
//
// MODEL  base = { target, az, el, dist } (az from +Z toward +X, el above the
// horizon). User input moves `goal`; `cur` chases it with damping (inertia +
// fling). A glide (view / focus) writes both along an eased curve, so any
// interruption continues from where the camera really is — nothing snaps.
// Composition on top of the base: flight follow (spring), aspect fit, intro,
// explode pull-back, and a screen-space view offset that centres the subject in
// the clear stage area between the chrome blocks (eases away with H / reveal).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { state, actions, bus } from '../core/state.js';
import { DIMS } from '../core/dims.js';
import { DEG, clamp, damp, dampV3, angleDelta, ease, smoothstep, Spring3 } from '../core/math.js';
import { layout } from './layout.js';

const LIM = { elMin: 2 * DEG, elMax: 89.5 * DEG, distMin: 6, distMax: 120, focusMin: 4.2, floorY: 0.4 };
const BOX = { min: new THREE.Vector3(-34, 0.5, -34), max: new THREE.Vector3(34, 30, 34) };
const GLIDE = 1.1;

// `target` (optional) aims slightly below the bee's centre so bee + plinth sit
// as one group in the middle of the clear stage area rather than bottom-heavy.
export const VIEW_PRESETS = {
  iso: { az: 38, el: 20, dist: 44, target: { x: 0, y: 2.9, z: -1.1 } },
  // az 180: with +Y as camera-up, looking down from the -Z side puts the head (+Z) at the top of the screen
  plan: { az: 180, el: 89, dist: 50, target: { x: 0, y: 3.9, z: -1.0 } },
  front: { az: 0, el: 5, dist: 40, target: { x: 0, y: 3.4, z: -1.4 } },
  profile: { az: 90, el: 3, dist: 44, target: { x: 0, y: 3.4, z: -1.2 } },
  macro: { az: 32, el: 6, dist: 9.5, head: true },
};

const V = (o) => new THREE.Vector3(o.x, o.y, o.z);
const BEE_CENTRE = V(DIMS.beeCentre);
const DEFAULT_HEAD = V(DIMS.beeRest).add(V(DIMS.beeHeadOffset));

export function createCameraRig({ camera, dom }) {
  const presets = VIEW_PRESETS;
  const cur = { target: BEE_CENTRE.clone(), az: presets.iso.az * DEG, el: presets.iso.el * DEG, dist: presets.iso.dist };
  const goal = { target: cur.target.clone(), az: cur.az, el: cur.el, dist: cur.dist };
  const vel = { az: 0, el: 0 };
  let tween = null;
  let track = null;               // null | 'head' | 'focus'
  let focusFn = null;             // () => Vector3 for 'focus'
  let saved = null;               // camera state before focusOn
  const trackPos = new THREE.Vector3();
  const headSm = DEFAULT_HEAD.clone();
  let headInit = false;
  let lastCtx = { follow: null, followAmount: 0, head: DEFAULT_HEAD, intro: 1 };

  const followSpring = new Spring3(0.62, 1, new THREE.Vector3());
  const tmpOffset = new THREE.Vector3();
  const finalTarget = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let followGate = 1, orbitVel = 0, aspectK = 1, fitMul = 1, focusK = 0;
  const shift = { x: 0, y: 0 }, autoShift = { x: 0, y: 0 };
  const dof = { amount: 0, focus: 20 };

  // ── views, focus ─────────────────────────────────────────────────────────
  const headFn = () => headSm;

  function startGlide(to, dur = GLIDE) {
    tween = {
      t: 0, dur,
      from: { target: cur.target.clone(), az: cur.az, el: cur.el, dist: cur.dist },
      to,                                                // target: Vector3 | fn
      daz: to.az == null ? 0 : angleDelta(cur.az, to.az),
    };
    vel.az = vel.el = 0;
  }

  function setView(name, { immediate = false } = {}) {
    const p = presets[name];
    if (!p) return;
    saved = null; focusFn = null;
    track = p.head ? 'head' : null;
    const target = p.head ? headFn : (p.target ? V(p.target) : BEE_CENTRE.clone());
    const to = { target, az: p.az * DEG, el: clamp(p.el * DEG, LIM.elMin, LIM.elMax), dist: p.dist };
    if (immediate) {
      tween = null;
      cur.target.copy(typeof target === 'function' ? target() : target);
      cur.az = to.az; cur.el = to.el; cur.dist = to.dist;
      copyCurToGoal();
      followSpring.set(tmp.set(0, 0, 0));
      return;
    }
    startGlide(to);
  }

  function frameDistance(radius) {
    const tanV = Math.tan((camera.fov * DEG) / 2);
    return clamp(radius / (0.45 * tanV), LIM.focusMin, LIM.distMax);
  }

  function focusOn({ center, radius = 2 } = {}) {
    if (!center) return;
    if (!saved) saved = { target: cur.target.clone(), dist: cur.dist, track };
    focusFn = typeof center === 'function' ? center : () => center;
    track = 'focus';
    trackPos.copy(focusFn());
    // move in on the part — never back out, even for a part as large as a wing
    const d = Math.min(frameDistance(radius), Math.max(LIM.focusMin, (saved?.dist ?? cur.dist) * 0.9));
    startGlide({ target: () => trackPos, az: null, el: null, dist: d });
  }

  function clearFocus() {
    if (!saved) return;
    const s = saved; saved = null; focusFn = null;
    track = s.track === 'head' ? 'head' : null;
    startGlide({ target: s.track === 'head' ? headFn : s.target, az: null, el: null, dist: s.dist });
  }

  function copyCurToGoal() { goal.target.copy(cur.target); goal.az = cur.az; goal.el = cur.el; goal.dist = cur.dist; }

  bus.on('view', ({ value }) => { if (value) setView(value); });

  // ── pointer input ────────────────────────────────────────────────────────
  const pointers = new Map();     // id → { x, y }
  let mode = null;                // 'orbit' | 'pan' | 'pinch'
  let downX = 0, downY = 0, moved = false, dragging = false;
  let pinch = null;
  let lastMoveT = 0;
  const flingVel = { az: 0, el: 0 };

  const viewH = () => Math.max(1, dom.clientHeight || window.innerHeight);
  function interrupt() {
    if (tween) { tween = null; copyCurToGoal(); }
    if (state.view) actions.clearView();
  }
  function beginDrag() {
    dragging = true;
    interrupt();
    vel.az = vel.el = 0;
  }
  function orbitBy(dx, dy, t) {
    const k = (Math.PI * 1.15) / viewH();
    goal.az -= dx * k;
    goal.el = clamp(goal.el + dy * k, LIM.elMin, LIM.elMax);
    const dtE = Math.max(1e-3, (t - lastMoveT) / 1000);
    const blend = 1 - Math.exp(-dtE / 0.05);
    flingVel.az += ((-dx * k) / dtE - flingVel.az) * blend;
    flingVel.el += ((dy * k) / dtE - flingVel.el) * blend;
    lastMoveT = t;
  }
  function panBy(dx, dy) {
    const wpp = (2 * cur.dist * Math.tan((camera.fov * DEG) / 2)) / viewH();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    tmp.set(e[0], e[1], e[2]).multiplyScalar(-dx * wpp);
    goal.target.add(tmp);
    tmp.set(e[4], e[5], e[6]).multiplyScalar(dy * wpp);
    goal.target.add(tmp);
    goal.target.clamp(BOX.min, BOX.max);
    if (track === 'head') track = null;         // free navigation detaches from the head
    if (track === 'focus') { track = null; }    // keeps `saved`, so Esc still returns
  }

  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try { dom.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone (synthetic / cancelled) */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      mode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      downX = e.clientX; downY = e.clientY; moved = false;
      lastMoveT = e.timeStamp; flingVel.az = flingVel.el = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      mode = 'pinch';
      if (!dragging) beginDrag();
    }
  });
  dom.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch.d > 1 && d > 1) goal.dist = clamp(goal.dist * (pinch.d / d), LIM.distMin, LIM.distMax);
      panBy(mx - pinch.mx, my - pinch.my);
      pinch = { d, mx, my };
      return;
    }
    if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) { moved = true; beginDrag(); }
    if (!moved) return;
    if (mode === 'orbit') orbitBy(dx, dy, e.timeStamp);
    else if (mode === 'pan') panBy(dx, dy);
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1 && mode === 'pinch') {
      // continue as a one-finger orbit without a jump
      mode = 'orbit';
      lastMoveT = e.timeStamp; flingVel.az = flingVel.el = 0;
      return;
    }
    if (pointers.size === 0) {
      if (dragging && mode === 'orbit' && e.timeStamp - lastMoveT < 90) {
        // a gentle follow-through only: a flick coasts ~15°, it never spins the piece round
        vel.az = clamp(flingVel.az, -0.7, 0.7); vel.el = clamp(flingVel.el, -0.3, 0.3);
      }
      dragging = false; mode = null; pinch = null;
    }
  };
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= viewH();
    if (e.ctrlKey) d *= 2.5;                       // trackpad pinch
    if (tween) { tween = null; copyCurToGoal(); }
    if (state.view) actions.clearView();
    goal.dist = clamp(goal.dist * Math.exp(clamp(d, -240, 240) * 0.0012), LIM.distMin, LIM.distMax);
  }, { passive: false });

  // ── resize ───────────────────────────────────────────────────────────────
  function resize(w, h) {
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => resize(dom.clientWidth, dom.clientHeight));

  // ── per-frame ────────────────────────────────────────────────────────────
  function update(dt, ctx = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    lastCtx = ctx;
    const head = ctx.head || DEFAULT_HEAD;
    if (!headInit) { headSm.copy(head); headInit = true; }
    dampV3(headSm, head, 9, dt);                          // ≈0.25 s smoothing for MACRO
    if (track === 'focus' && focusFn) dampV3(trackPos, focusFn(), 12, dt);

    if (tween) {
      tween.t += dt;
      const k = ease.inOutCubic(clamp(tween.t / tween.dur));
      const to = tween.to;
      const tgt = typeof to.target === 'function' ? to.target() : to.target;
      cur.target.lerpVectors(tween.from.target, tgt, k);
      cur.az = tween.from.az + tween.daz * k;
      cur.el = to.el == null ? cur.el : tween.from.el + (to.el - tween.from.el) * k;
      cur.dist = tween.from.dist + (to.dist - tween.from.dist) * k;
      copyCurToGoal();
      if (tween.t >= tween.dur) tween = null;
    } else {
      if (track === 'head') goal.target.copy(headSm);
      else if (track === 'focus') goal.target.copy(trackPos);
      if (!dragging) {
        goal.az += vel.az * dt; goal.el = clamp(goal.el + vel.el * dt, LIM.elMin, LIM.elMax);
        vel.az = damp(vel.az, 0, 4.6, dt); vel.el = damp(vel.el, 0, 4.6, dt);
      }
      cur.az = damp(cur.az, goal.az, 14, dt);
      cur.el = damp(cur.el, goal.el, 14, dt);
      cur.dist = damp(cur.dist, goal.dist, 8, dt);
      dampV3(cur.target, goal.target, track ? 16 : 10, dt);
    }
    // auto-orbit (eases in and out, suspended while dragging or gliding)
    const orbitTarget = state.autoOrbit && !dragging && !tween ? 5 * DEG : 0;
    orbitVel = damp(orbitVel, orbitTarget, 1.6, dt);
    if (!tween) { goal.az += orbitVel * dt; cur.az += orbitVel * dt; }

    // flight follow (spring on an offset, disabled while a part or the head is tracked)
    followGate = damp(followGate, track ? 0 : 1, 2.5, dt);
    const fa = clamp(ctx.followAmount ?? 0) * followGate;
    if (ctx.follow) tmpOffset.subVectors(ctx.follow, cur.target).multiplyScalar(0.8 * fa);
    else tmpOffset.set(0, 0, 0);
    followSpring.step(dt, tmpOffset);
    finalTarget.copy(cur.target).add(followSpring.value);

    // aspect fit: narrow / portrait viewports pull back so the bee still fits
    const aspect = camera.aspect || 1.6;
    aspectK = damp(aspectK, aspect < 1.5 ? Math.pow(1.5 / aspect, 0.85) : 1, 6, dt);

    // intro: additive, eased (×1.16 farther and −16° az at intro = 0)
    const ik = 1 - smoothstep(0, 1, ctx.intro ?? 1);
    const az = cur.az - 16 * DEG * ik;
    const el = cur.el;
    // exploded: auto-frame. The machine's measured screen box (the head's in
    // MACRO) is fitted into the clear stage area minus room for a label column
    // on each side (distance) and centred in it (image offset, below). Frozen
    // while the user navigates freely, so it never fights a manual zoom.
    // (a part in focus takes over: the auto-frame steps aside while it is held)
    focusK = damp(focusK, saved ? 1 : 0, 4, dt);
    const exRaw = smoothstep(0, 0.6, state.explode || 0);
    const exK = exRaw * (1 - focusK);
    layout.subject = track === 'head' ? 'head' : 'bee';
    const subject = track === 'head' ? layout.head : layout.bee;
    const c = layout.clear;
    const W = dom.clientWidth || window.innerWidth, H = dom.clientHeight || window.innerHeight;
    if (exRaw > 0.01 && subject.valid && c && !dragging) {
      // label columns may use the full width (they find their own vertical room
      // between the chrome blocks), so the machine is centred on the viewport
      // horizontally and in the clear band vertically
      const ct = c.t * layout.chrome, cb = H - (H - c.b) * layout.chrome;
      const cl = 0, cr = W;
      const room = (layout.labelW || 160) + (layout.pad || 26) + 44;
      const allowW = Math.max(120, W - 2 * room), allowH = Math.max(120, (cb - ct) * 0.9);
      const bw = subject.r - subject.l, bh = subject.b - subject.t;
      if (state.view && !saved) {
        if (!tween) {
          const ratio = clamp(Math.max(bw / allowW, bh / allowH), 0.5, 2);
          fitMul = clamp(fitMul * Math.pow(ratio, Math.min(1, 2.4 * dt)), 0.6, 3.4);
        }
        // the box was measured with the current offset applied: remove it, then
        // ask for the offset that puts the box's centre on the clear area's centre
        autoShift.x = (cl + cr) / 2 - ((subject.l + subject.r) / 2 - shift.x);
        autoShift.y = (ct + cb) / 2 - ((subject.t + subject.b) / 2 - shift.y);
      }
    } else if (exRaw <= 0.01) fitMul = damp(fitMul, 1, 3, dt);
    const dist = cur.dist * (1 + 0.28 * fa) * aspectK * (1 + 0.16 * ik) * (1 + (fitMul - 1) * exK);

    const ce = Math.cos(el);
    camera.position.set(
      finalTarget.x + Math.sin(az) * ce * dist,
      finalTarget.y + Math.sin(el) * dist,
      finalTarget.z + Math.cos(az) * ce * dist,
    );
    if (camera.position.y < LIM.floorY) camera.position.y = LIM.floorY;
    camera.up.set(0, 1, 0);
    camera.lookAt(finalTarget);
    camera.updateMatrixWorld();

    // composition: slide the image (not the camera) so the subject sits in the
    // middle of the clear stage area; vertical at half strength so the plinth
    // keeps its footing. Eases out when the chrome fades (H, intro).
    // Exploded, the offset instead centres the machine's measured box (above).
    let sx = 0, sy = 0;
    if (c && layout.chrome > 0 && W > 0 && H > 0) {
      sx = ((c.l + c.r) / 2 - W / 2) * layout.chrome;
      sy = ((c.t + c.b) / 2 - H / 2) * layout.chrome * 0.5;
    }
    sx = clamp(sx + (autoShift.x - sx) * exK, -W * 0.15, W * 0.15);
    sy = clamp(sy + (autoShift.y - sy) * exK, -H * 0.2, H * 0.2);
    shift.x = damp(shift.x, sx, 2.6, dt); shift.y = damp(shift.y, sy, 2.6, dt);
    if (Math.abs(shift.x) + Math.abs(shift.y) > 0.2) camera.setViewOffset(W, H, -shift.x, -shift.y, W, H);
    else if (camera.view?.enabled) camera.clearViewOffset();

    // depth of field (MACRO only)
    const macro = track === 'head';
    dof.amount = damp(dof.amount, macro ? 1 : 0, macro ? 2.2 : 3.5, dt);
    if (dof.amount < 1e-3 && !macro) dof.amount = 0;
    dof.focus = camera.position.distanceTo(macro || dof.amount > 0 ? headSm : finalTarget);
  }

  setView('iso', { immediate: true });

  return {
    update, setView, focusOn, clearFocus, resize, dof, presets,
    get dragging() { return dragging; },
    get focused() { return !!saved; },
    get target() { return finalTarget; },
    get ctx() { return lastCtx; },
  };
}
