import * as T from 'three';
import { vec, clamp, damp, mix } from './geometry.js';

const presets = {
  ISO: [-0.6, 0.475, 1],
  PLAN: [-0.11, 1.535, 1.05],
  FRONT: [-1.56, 0.15, 0.86],
  PROFILE: [0, 0.17, 0.98],
  MACRO: [-1.02, 0.27, 0.355],
};
export class CameraRig {
  constructor(canvas) {
    this.camera = new T.PerspectiveCamera(29, 1, 0.1, 100);
    this.canvas = canvas;
    this.view = 'ISO';
    this.az = this.azGoal = presets.ISO[0];
    this.el = this.elGoal = presets.ISO[1];
    this.zoom = this.zoomGoal = 1;
    this.center = vec(0.07, 0.98, 0);
    this.base = vec();
    this.follow = vec();
    this.pan = vec();
    this.focus = null;
    this.orbit = false;
    this.drag = null;
    this.held = new Map();
    this.click = null;
    this.hover = null;
    this.w = 1;
    this.h = 1;
    this.distance = 10;
    this.macro = 0;
    this.focusDepth = 10;
    this.framing = 1;
    this.screenShift = 0.012;
    this.tmp = vec();
    this.bind();
  }
  preset(name) {
    this.focus = null;
    this.view = name;
    const [az, el, z] = presets[name];
    this.azGoal = this.az + Math.atan2(Math.sin(az - this.az), Math.cos(az - this.az));
    this.elGoal = el;
    this.zoomGoal = z;
    this.pan.set(0, 0, 0);
    this.orbit = false;
  }
  select(object, local) {
    this.focus = { object, local: local.clone() };
    this.zoomGoal = 0.49;
    this.pan.set(0, 0, 0);
    this.orbit = false;
  }
  resize(w, h) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  bind() {
    const el = this.canvas;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      this.held.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pt = { x: e.clientX, y: e.clientY };
      if (this.held.size === 1)
        this.drag = {
          ...pt,
          old: pt,
          moved: false,
          pan: e.button === 2 || e.shiftKey,
          id: e.pointerId,
        };
      if (this.held.size === 2) {
        this.drag.moved = true;
        const [a, b] = [...this.held.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        this.hover?.(e);
        return;
      }
      this.held.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.held.size === 2) {
        const [a, b] = [...this.held.values()],
          len = Math.max(5, Math.hypot(a.x - b.x, a.y - b.y)),
          mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.zoomGoal = clamp((this.zoomGoal * this.pinch) / len, 0.23, 2.25);
        this.movePan(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
        this.pinch = len;
        this.pinchMid = mid;
        return;
      }
      const d = this.drag,
        dx = e.clientX - d.old.x,
        dy = e.clientY - d.old.y;
      d.old = { x: e.clientX, y: e.clientY };
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (d.moved) {
        this.orbit = false;
        if (d.pan) this.movePan(dx, dy);
        else {
          this.azGoal -= dx * 0.006;
          this.elGoal = clamp(this.elGoal + dy * 0.005, -0.04, Math.PI * 0.494);
        }
        this.onNavigate?.();
      }
    });
    const end = (e) => {
      const d = this.drag;
      this.held.delete(e.pointerId);
      if (!this.held.size) {
        this.drag = null;
        if (d && !d.moved && !d.pan && e.type !== 'pointercancel') this.click?.(e);
      } else if (d) {
        const p = [...this.held.values()][0];
        d.old = p;
        d.moved = true;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => {
      if (!this.drag) this.leave?.();
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomGoal = clamp(
          this.zoomGoal * Math.exp(clamp(e.deltaY, -120, 120) * 0.00165),
          0.23,
          2.25
        );
      },
      { passive: false }
    );
  }
  movePan(dx, dy) {
    const k = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / this.h;
    const e = this.camera.matrixWorld.elements;
    this.pan.x += (-e[0] * dx + e[4] * dy) * k;
    this.pan.y += (-e[1] * dx + e[5] * dy) * k;
    this.pan.z += (-e[2] * dx + e[6] * dy) * k;
  }
  update(dt, flight, bee, explosion) {
    if (this.orbit) this.azGoal += dt * 0.105;
    this.az = damp(this.az, this.azGoal, 6.5, dt);
    this.el = damp(this.el, this.elGoal, 6.5, dt);
    this.zoom = damp(this.zoom, this.zoomGoal, 5.6, dt);
    const mobile = this.w <= 700,
      aspect = this.w / this.h;
    this.base.set(0.11, 0.85 + explosion * 0.74, 0);
    this.follow.lerp(flight.pos, 1 - Math.exp(-dt * 2.4));
    this.base.addScaledVector(this.follow, 0.7);
    if (this.focus) this.base.copy(this.focus.local).applyMatrix4(this.focus.object.matrixWorld);
    else if (this.view === 'MACRO') {
      const eye = bee.anchors.get('eyes')[1];
      this.base.copy(eye.point).applyMatrix4(eye.parent.matrixWorld);
      this.base.x += 0.07;
    }
    this.base.add(this.pan);
    this.center.lerp(this.base, 1 - Math.exp(-dt * 6.5));
    const displayWidth = mobile ? 7.24 : Math.max(9.32, aspect * 5.47);
    const extra =
      1 +
      explosion * (this.focus?.object ? 0 : 0.44) +
      (!this.focus && this.view !== 'MACRO' ? flight.open * 0.12 : 0);
    this.framing = damp(this.framing, extra, 5.6, dt);
    this.distance =
      (displayWidth * this.framing * this.zoom) /
      (2 * Math.tan((this.camera.fov * Math.PI) / 360) * aspect);
    const co = Math.cos(this.el);
    this.camera.position
      .set(Math.sin(this.az) * co, Math.sin(this.el), Math.cos(this.az) * co)
      .multiplyScalar(this.distance)
      .add(this.center);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.center);
    const offset = mobile ? -0.061 : mix(-0.029, 0.048, flight.open);
    const shift = mobile || this.focus || this.view === 'MACRO' ? 0 : 0.012 + 0.038 * flight.open;
    this.screenShift = damp(this.screenShift, shift, 6.5, dt);
    this.camera.setViewOffset(
      this.w,
      this.h,
      -this.w * this.screenShift,
      -this.h * offset,
      this.w,
      this.h
    );
    this.camera.updateMatrixWorld();
    this.macro = damp(this.macro, !this.focus && this.view === 'MACRO' ? 1 : 0, 5.5, dt);
    this.focusDepth = this.camera.position.distanceTo(this.base);
  }
  project(v) {
    this.tmp.copy(v).project(this.camera);
    return {
      x: (this.tmp.x * 0.5 + 0.5) * this.w,
      y: (0.5 - this.tmp.y * 0.5) * this.h,
      z: this.tmp.z,
    };
  }
}
