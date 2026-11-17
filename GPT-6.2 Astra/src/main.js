import * as T from 'three';
import { Materials, studioEnvironment, sectionShadowMaterial } from './materials.js';
import { Bee } from './model/rig.js';
import { Stage } from './stage.js';
import { FlightController } from './flight.js';
import { CameraRig } from './optics.js';
import { Optics } from './post.js';
import { Labels } from './labels.js';
import { UI } from './ui.js';
import { vec, clamp, mix, smooth, damp } from './geometry.js';

class Exhibit {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.renderer = new T.WebGLRenderer({
      canvas: this.canvas,
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0, 0);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowTime = 1;
    this.scene = new T.Scene();
    this.materials = new Materials();
    this.environment = studioEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.83;
    this.bee = new Bee(this.scene, this.materials);
    this.stage = new Stage(this.scene, this.materials, this.bee);
    this.flight = new FlightController(this.bee);
    const depth = sectionShadowMaterial(this.materials.uniforms);
    for (const m of this.bee.pickables) {
      const role = m.userData.role;
      m.receiveShadow = true;
      m.castShadow = !m.isInstancedMesh && !['glass', 'etch'].includes(role);
      if (m.castShadow) m.customDepthMaterial = depth;
    }
    this.camera = new CameraRig(this.canvas);
    this.post = new Optics(this.renderer, this.materials);
    this.mode = 0;
    this.section = 0;
    this.drawing = 0;
    this.explodeTarget = 0;
    this.exploded = 0;
    this.focused = null;
    this.hovered = null;
    this.time = 0;
    this.intro = 0;
    this.pickClock = 0;
    this.layoutClock = 0;
    this.ready = false;
    this.pendingPointer = null;
    this.pointer = new T.Vector2();
    this.ray = new T.Raycaster();
    this.tmp = vec();
    this.quality = 1;
    this.frameAverage = 1 / 60;
    this.qualityClock = 0;
    this.ui = new UI(this);
    this.labels = new Labels(
      this.bee,
      this.camera,
      (id, ref) => this.focus(id, ref),
      (id) => {
        this.hovered = id;
      }
    );
    this.camera.click = (e) => this.click(e);
    this.camera.hover = (e) => {
      this.pendingPointer = { x: e.clientX, y: e.clientY };
    };
    this.camera.leave = () => {
      this.pendingPointer = null;
      this.stationaryPointer = null;
      this.flight.evadeArmed = true;
      this.hovered = null;
      this.canvas.classList.remove('can-inspect');
    };
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize = () => {
      const w = innerWidth,
        h = innerHeight;
      this.camera.resize(w, h);
      this.applySize();
    };
    this.resize();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
    });
    this.last = 0;
    requestAnimationFrame((t) => this.frame(t));
  }
  applySize() {
    const { w, h } = this.camera,
      pixelRatio = Math.min(2, devicePixelRatio || 1, Math.sqrt(2350000 / (w * h))) * this.quality;
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.resize(this.canvas.width, this.canvas.height);
  }
  hit(x, y) {
    const { w, h, camera } = this.camera;
    this.pointer.set((x / w) * 2 - 1, 1 - (y / h) * 2);
    this.ray.setFromCamera(this.pointer, camera);
    const hits = this.ray.intersectObjects(this.bee.pickables, false);
    for (const hit of hits) {
      this.tmp.copy(hit.point).applyMatrix4(this.materials.uniforms.inverse.value);
      if (this.tmp.z > this.materials.uniforms.clip.value || hit.object.material.opacity < 0.065)
        continue;
      return hit;
    }
    return null;
  }
  click(e) {
    if (!this.ready || this.ui.hidden) return;
    const hit = this.hit(e.clientX, e.clientY);
    if (!hit) {
      this.resetFocus();
      return;
    }
    this.focus(hit.object.userData.part, {
      parent: hit.object,
      point: hit.object.worldToLocal(hit.point.clone()),
    });
  }
  focus(id, ref) {
    this.focused = id;
    this.hovered = null;
    this.camera.select(ref.parent, ref.point);
    this.ui.syncOrbit();
  }
  resetFocus(reframe = true) {
    const had = this.focused;
    this.focused = null;
    this.hovered = null;
    this.camera.focus = null;
    if (had && reframe) {
      this.camera.preset(this.camera.view);
      this.ui.syncOrbit();
    }
  }
  pick(dt) {
    this.pickClock += dt;
    const p = this.pendingPointer || (this.flight.goal ? this.stationaryPointer : null);
    if (
      !p ||
      this.pickClock < (this.pendingPointer ? 0.053 : 0.11) ||
      !this.ready ||
      this.camera.drag ||
      this.ui.hidden
    )
      return;
    this.pickClock = 0;
    this.stationaryPointer = p;
    this.pendingPointer = null;
    const hit = this.hit(p.x, p.y);
    this.hovered = hit?.object.userData.part || null;
    this.canvas.classList.toggle('can-inspect', !!hit);
    const center = this.camera.project(this.bee.root.getWorldPosition(this.tmp));
    const nx = ((p.x - center.x) / this.camera.w) * 3.1,
      ny = ((center.y - p.y) / this.camera.h) * 3.1;
    this.flight.observe(
      clamp(nx, -1, 1),
      clamp(ny, -1, 1),
      Math.hypot(nx, ny) * 1.5,
      nx < 0 ? 1 : -1
    );
  }
  frame(now) {
    const raw = this.last ? Math.max(0.001, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const dt = Math.min(raw, 0.175);
    this.time += dt;
    this.intro += dt;
    const duration = this.reduced ? 0.75 : 3.95;
    const opening = this.intro < duration;
    const progress = clamp(this.intro / duration),
      assembly = smooth(0.13, 0.91, progress);
    this.exploded = damp(this.exploded, this.explodeTarget, 5.9, dt);
    const spread = 1 - assembly + assembly * this.exploded;
    this.bee.explode(spread, 1 - assembly);
    this.bee.root.visible = progress > 0.12;
    this.materials.uniforms.arrival.value = smooth(0.12, 0.33, progress);
    if (opening) this.canvas.style.opacity = String(smooth(0, 0.15, progress));
    if (!this.ready && progress > 0.83) {
      this.ready = true;
      document.body.classList.add('ready');
    }
    this.materials.updateTheme(dt);
    this.section = damp(this.section, this.mode === 1 ? 1 : 0, 5.9, dt);
    this.drawing = damp(this.drawing, this.mode === 2 ? 1 : 0, 6.2, dt);
    this.materials.uniforms.clip.value = mix(5.6, 0.015, this.section);
    this.materials.uniforms.draw.value = this.drawing;
    this.bee.drawing(this.drawing);
    this.flight.update(dt, Math.min(raw, 0.05), spread);
    this.bee.root.updateMatrixWorld(true);
    this.materials.uniforms.inverse.value.copy(this.bee.chassis.matrixWorld).invert();
    this.camera.update(dt, this.flight, this.bee, opening ? 0 : this.exploded);
    this.pick(dt);
    const part = this.hovered || this.focused;
    this.materials.highlight(this.ui.hidden ? null : part, dt);
    const amber =
      (0.46 + 0.043 * Math.sin(this.flight.t * 3.75) + 0.029 * Math.sin(this.flight.t * 7.34)) *
      (1 + this.materials.weights[2] * 0.72);
    for (const m of this.materials.cache.values())
      if (m.userData.role === 'amber') m.emissiveIntensity = amber;
    this.bee.coreLight.intensity = 0.31 * amber * (1 - this.drawing);
    this.bee.updateGuides(opening ? 0 : spread);
    this.stage.update(this.flight, this.bee, smooth(0, 0.37, progress), this.flight.t, spread);
    this.layoutClock += dt;
    if (this.layoutClock > 0.029) {
      this.ui.update(this.ui.hidden ? null : part, 1 - spread, this.time);
      this.labels.update(opening ? 0 : spread, this.drawing, part, this.ui.hidden);
      this.layoutClock = 0;
    }
    this.shadowTime += dt;
    if (this.shadowTime > (this.flight.state === 'RESTING' && !opening ? 0.13 : 0.046)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowTime = 0;
    }
    this.post.render(this.scene, this.camera);
    if (this.ready && raw < 0.18) {
      this.frameAverage = mix(this.frameAverage, raw, 0.035);
      this.qualityClock += dt;
      if (this.qualityClock > 2.2) {
        this.qualityClock = 0;
        let next = this.quality;
        if (this.frameAverage > 0.021) next = Math.max(0.68, next - 0.1);
        else if (this.frameAverage < 0.0158) next = Math.min(1, next + 0.045);
        if (next !== this.quality) {
          this.quality = next;
          this.applySize();
        }
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}
export let exhibit;
try {
  exhibit = new Exhibit();
} catch (error) {
  console.error(error);
  const n = document.getElementById('notice');
  n.textContent = 'The study needs WebGL 2. Enable hardware acceleration and reload.';
  n.classList.add('visible');
  document.body.classList.add('ready');
}
