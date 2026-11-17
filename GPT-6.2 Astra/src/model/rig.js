import * as T from 'three';
import { group, vec, V, smooth, clamp, Batch } from '../geometry.js';
import { buildHead } from './head.js';
import { buildThorax } from './thorax.js';
import { buildAbdomen } from './abdomen.js';
import { buildWings } from './wings.js';
import { buildLegs } from './legs.js';

export class Bee {
  constructor(scene, materials) {
    this.root = group(scene);
    this.materials = materials;
    this.mounts = [];
    this.anchors = new Map();
    this.gears = [];
    this.antennae = [];
    this.legs = [];
    this.wings = [];
    this.rings = [];
    this.fur = [];
    this.eyes = [];
    this.chassis = group(this.root);
    this.head = this.mount(this.chassis, 'head', [-1.0, 0.12, 0], [-0.77, 0.05, 0], 0.34);
    this.abdomen = this.mount(this.chassis, 'petiole', [0.65, 0.03, 0], [0.55, 0.01, 0], 0.47);
    buildThorax(this);
    buildAbdomen(this);
    buildHead(this);
    buildWings(this);
    buildLegs(this);
    this.root.updateMatrixWorld(true);
    this.pickables = [];
    this.root.traverse((m) => {
      if (m.isMesh && m.userData.part && !m.userData.ghost) {
        if (m.userData.role === 'body') {
          // Coordinates from the assembled casting keep the hand-painted pattern fixed to its glaze.
          const casting = m.geometry.attributes.position.clone().applyMatrix4(m.matrixWorld);
          m.geometry.setAttribute('castingPosition', casting);
        }
        this.pickables.push(m);
      }
    });
    const guideGeo = new T.BufferGeometry();
    this.guidePositions = new Float32Array(this.mounts.length * 6);
    this.guideDistances = new Float32Array(this.mounts.length * 2);
    guideGeo.setAttribute(
      'position',
      new T.BufferAttribute(this.guidePositions, 3).setUsage(T.DynamicDrawUsage)
    );
    guideGeo.setAttribute(
      'lineDistance',
      new T.BufferAttribute(this.guideDistances, 1).setUsage(T.DynamicDrawUsage)
    );
    this.guides = new T.LineSegments(
      guideGeo,
      new T.LineDashedMaterial({
        color: materials.colors.lines,
        transparent: true,
        opacity: 0,
        dashSize: 0.045,
        gapSize: 0.045,
        depthWrite: false,
      })
    );
    this.guides.frustumCulled = false;
    this.guides.renderOrder = 5;
    scene.add(this.guides);
    this.edgeGroup = [];
    this.edgesReady = false;
    this.edgeTask = false;
    this.edgeAmount = 0;
  }
  mount(parent, part, position, axis, delay = 0, guide = true) {
    const mount = group(parent, ...position);
    mount.userData.part = part;
    this.mounts.push({ mount, seat: V(position), axis: V(axis), delay, guide, amount: 0 });
    return mount;
  }
  batch(parent, part) {
    return new Batch(parent, this.materials, part);
  }
  anchor(part, parent, point) {
    if (!this.anchors.has(part)) this.anchors.set(part, []);
    this.anchors.get(part).push({ parent, point: V(point) });
  }
  explode(amount, opening = 0) {
    for (const m of this.mounts) {
      const t = smooth(m.delay * 0.56, 0.68 + m.delay * 0.32, amount);
      m.amount = t;
      const settle = opening
        ? Math.sin((1 - t) * Math.PI * 4) * 0.035 * Math.sin(t * Math.PI) * opening
        : 0;
      m.mount.position.copy(m.seat).addScaledVector(m.axis, t * (1 + opening * 0.72) + settle);
    }
  }
  updateGuides(amount) {
    this.guides.visible = amount > 0.055;
    this.guides.material.opacity = smooth(0.1, 0.55, amount) * 0.43;
    this.guides.material.color.copy(this.materials.colors.lines);
    if (!this.guides.visible) return;
    const a = vec(),
      b = vec();
    let count = 0;
    for (const m of this.mounts) {
      if (!m.guide || m.amount < 0.04) continue;
      a.copy(m.seat).applyMatrix4(m.mount.parent.matrixWorld);
      m.mount.getWorldPosition(b);
      a.toArray(this.guidePositions, count * 6);
      b.toArray(this.guidePositions, count * 6 + 3);
      this.guideDistances[count * 2] = 0;
      this.guideDistances[count * 2 + 1] = a.distanceTo(b);
      count++;
    }
    const g = this.guides.geometry;
    g.setDrawRange(0, count * 2);
    g.attributes.position.needsUpdate = true;
    g.attributes.lineDistance.needsUpdate = true;
  }
  prepareEdges() {
    if (this.edgeTask || this.edgesReady) return;
    this.edgeTask = true;
    this.lineMaterial = new T.LineBasicMaterial({
      color: this.materials.colors.ink,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.lineMaterial.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\ngl_Position.z-=.000028*gl_Position.w;'
      );
    };
    const queue = this.pickables.filter(
      (m) =>
        !m.isInstancedMesh && ['body', 'glass', 'dark', 'amber', 'metal'].includes(m.userData.role)
    );
    const schedule = (fn) =>
      window.requestIdleCallback
        ? window.requestIdleCallback(fn, { timeout: 170 })
        : setTimeout(fn, 30);
    const next = (deadline) => {
      const start = performance.now();
      do {
        const mesh = queue.pop();
        const edge = new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 38), this.lineMaterial);
        edge.renderOrder = 4;
        edge.visible = this.edgeAmount > 0.008;
        mesh.add(edge);
        this.edgeGroup.push(edge);
      } while (
        queue.length &&
        performance.now() - start < 2.7 &&
        (!deadline || deadline.timeRemaining() > 2)
      );
      if (queue.length) schedule(next);
      else this.edgesReady = true;
    };
    schedule(next);
  }
  drawing(t) {
    if (!this.edgeTask) this.prepareEdges();
    const active = t > 0.008;
    const visibilityChanged = active !== this.edgeAmount > 0.008;
    this.edgeAmount = t;
    this.lineMaterial.opacity = clamp(t) * 0.65;
    this.lineMaterial.color.copy(this.materials.colors.ink);
    if (visibilityChanged) for (const e of this.edgeGroup) e.visible = active;
  }
}
