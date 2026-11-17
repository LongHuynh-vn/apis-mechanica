import { vec, clamp, smooth } from './geometry.js';
import { Matrix4 } from 'three';
import { catalogue, majorParts } from './catalogue.js';
import { WING_LENGTH } from './model/wings.js';
const HALF_SPAN = 0.451 + WING_LENGTH,
  NOSE = -1.805,
  STING_TIP = 3.122;
export const MM_PER_UNIT = 186 / (2 * HALF_SPAN);
const ns = 'http://www.w3.org/2000/svg';
function svg(tag, parent, attrs = {}) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
}
function attrs(el, obj) {
  for (const [k, v] of Object.entries(obj)) el.setAttribute(k, v);
}
const f = (n) => Math.round(n * 10) / 10;
export class Labels {
  constructor(bee, rig, onSelect, onHover) {
    this.bee = bee;
    this.rig = rig;
    this.labels = document.getElementById('labels');
    this.svg = document.getElementById('leaders');
    this.callouts = new Map();
    this.tmp = vec();
    this.point = vec();
    this.guides = svg('g', this.svg);
    this.dim = svg('g', this.svg);
    this.dim.style.display = 'none';
    this.projection = new Matrix4();
    this.combined = new Matrix4();
    this.solids = bee.pickables.map((mesh) => {
      const source = mesh.isInstancedMesh ? mesh : mesh.geometry;
      if (!source.boundingBox) source.computeBoundingBox();
      const { min, max } = source.boundingBox,
        points = [];
      for (const x of [min.x, max.x])
        for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) points.push(vec(x, y, z));
      return { mesh, points };
    });
    for (const [id, refs] of bee.anchors) {
      const data = catalogue[id];
      if (!data) continue;
      const label = document.createElement('button');
      label.className = 'part-label';
      label.hidden = true;
      label.dataset.part = id;
      const name = document.createElement('span'),
        meta = document.createElement('span');
      name.textContent = data[0];
      meta.className = 'part-meta';
      meta.textContent = data[1];
      label.append(name, meta);
      this.labels.append(label);
      label.onclick = () => onSelect(id, refs[0]);
      label.onpointerenter = () => onHover(id);
      label.onpointerleave = () => onHover(null);
      label.onfocus = () => onHover(id);
      label.onblur = () => onHover(null);
      const g = svg('g', this.guides);
      g.style.display = 'none';
      const path = svg('path', g),
        dot = svg('circle', g, { r: 2.1 });
      this.callouts.set(id, { id, label, g, path, dot, refs, w: 0 });
    }
    this.measures = Array.from({ length: 3 }, () => ({
      path: svg('path', this.dim),
      text: svg('text', this.dim, { class: 'measure', 'text-anchor': 'middle' }),
    }));
    this.centre = svg('path', this.dim, { 'stroke-dasharray': '9 5 2 5', opacity: 0.53 });
    this.numbers = Array.from({ length: 3 }, (_, i) => {
      const circle = svg('circle', this.dim, { r: 8 });
      const text = svg('text', this.dim, {
        class: 'measure',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      text.textContent = String(i + 1).padStart(2, '0');
      return { circle, text };
    });
  }
  anchor(refs) {
    const camera = this.rig.camera.position;
    let best = Infinity,
      chosen = null;
    for (const ref of refs) {
      this.tmp.copy(ref.point).applyMatrix4(ref.parent.matrixWorld);
      const d = camera.distanceToSquared(this.tmp);
      if (d < best) {
        best = d;
        chosen = ref;
        this.point.copy(this.tmp);
      }
    }
    return { ref: chosen, ...this.rig.project(this.point) };
  }
  project(x, y, z) {
    return this.rig.project(this.tmp.set(x, y, z).applyMatrix4(this.bee.chassis.matrixWorld));
  }
  silhouettes() {
    const { camera, w, h } = this.rig;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const rectangles = [];
    for (const { mesh, points } of this.solids) {
      this.combined.multiplyMatrices(this.projection, mesh.matrixWorld);
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      for (const v of points) {
        const p = this.tmp.copy(v).applyMatrix4(this.combined),
          x = (p.x * 0.5 + 0.5) * w,
          y = (0.5 - p.y * 0.5) * h;
        x0 = Math.min(x, x0);
        x1 = Math.max(x, x1);
        y0 = Math.min(y, y0);
        y1 = Math.max(y, y1);
      }
      if (x1 > 0 && x0 < w && y1 > 0 && y0 < h) rectangles.push({ x0, x1, y0, y1 });
    }
    return rectangles;
  }
  dimensions(opacity) {
    this.dim.style.display = opacity > 0.015 ? '' : 'none';
    if (opacity <= 0.015) return;
    this.dim.style.opacity = opacity;
    const p = (x, y, z) => this.project(x, y, z),
      pair = (a, b) => 'M' + f(a.x) + ' ' + f(a.y) + 'L' + f(b.x) + ' ' + f(b.y);
    const dims = [
      [
        p(NOSE, -0.71, -0.56),
        p(STING_TIP, -0.71, -0.56),
        Math.round((STING_TIP - NOSE) * MM_PER_UNIT) + ' mm',
      ],
      [p(0.12, 0.72, -HALF_SPAN), p(0.12, 0.72, HALF_SPAN), '186 mm'],
    ];
    for (const [i, [a, b, title]] of dims.entries()) {
      const m = this.measures[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        l = Math.hypot(dx, dy) || 1,
        nx = -dy / l,
        ny = dx / l;
      let path = pair(a, b);
      for (const q of [a, b])
        path += pair({ x: q.x - nx * 5, y: q.y - ny * 5 }, { x: q.x + nx * 5, y: q.y + ny * 5 });
      m.path.setAttribute('d', path);
      attrs(m.text, { x: f((a.x + b.x) / 2 + nx * 12), y: f((a.y + b.y) / 2 + ny * 12) });
      m.text.textContent = title;
    }
    const arc = [];
    for (let i = 0; i <= 32; i++) {
      const a = ((45 + (i * 90) / 32) * Math.PI) / 180;
      arc.push(p(-0.245 + 1.28 * Math.cos(a), 0.76, 0.451 + 1.28 * Math.sin(a)));
    }
    const a = this.measures[2],
      q = arc[16];
    a.path.setAttribute('d', arc.map((v, i) => (i ? 'L' : 'M') + f(v.x) + ' ' + f(v.y)).join(''));
    a.text.textContent = '90°';
    attrs(a.text, { x: q.x, y: q.y - 9 });
    this.centre.setAttribute(
      'd',
      pair(p(-2.35, 0.06, 0), p(3.48, 0.06, 0)) + pair(p(0, 0.03, -2.48), p(0, 0.03, 2.48))
    );
    for (const [i, id] of ['eyes', 'motor', 'rings'].entries()) {
      const pt = this.anchor(this.bee.anchors.get(id)),
        n = this.numbers[i],
        x = pt.x + 13,
        y = pt.y - 12;
      attrs(n.circle, { cx: x, cy: y });
      attrs(n.text, { x, y });
    }
  }
  update(amount, drawing, hover, hidden) {
    const alpha = smooth(0.22, 0.61, amount);
    this.dimensions(hidden ? 0 : drawing);
    if (hidden || alpha < 0.012) {
      for (const l of this.callouts.values())
        if (!l.label.hidden) {
          l.label.hidden = true;
          l.g.style.display = 'none';
        }
      return;
    }
    const { w } = this.rig,
      mobile = w <= 700;
    const topL = document.querySelector('.identity').getBoundingClientRect().bottom,
      topR = document.querySelector('.finishes').getBoundingClientRect().bottom;
    const bottomL = document.querySelector('.specs').getBoundingClientRect().top,
      bottomR = document.querySelector('.controls-help').getBoundingClientRect().top;
    const rangeL = [(mobile ? Math.max(topL, topR) : topL) + 12, bottomL - 13],
      rangeR = [topR + 15, (mobile ? bottomL : bottomR) - 14],
      gap = mobile ? 32 : 40;
    const left = [],
      right = [],
      bounds = this.silhouettes();
    for (const c of this.callouts.values()) c.p = this.anchor(c.refs);
    const centerX = this.rig.project(this.bee.root.getWorldPosition(this.tmp)).x;
    const leftEdge = clamp(
        Math.min(...bounds.map((p) => p.x0)) - 11,
        w * (mobile ? 0.25 : 0.14),
        w * 0.275
      ),
      rightEdge = clamp(
        Math.max(...bounds.map((p) => p.x1)) + 11,
        w * 0.725,
        w * (mobile ? 0.75 : 0.86)
      );
    for (const c of this.callouts.values()) {
      if (!majorParts.includes(c.id) && c.id !== hover) continue;
      const side = c.p.x < centerX ? 'left' : 'right';
      (side === 'left' ? left : right).push(c);
    }
    const visible = new Set();
    for (const [side, list, range, edge] of [
      ['left', left, rangeL, leftEdge],
      ['right', right, rangeR, rightEdge],
    ]) {
      const max = Math.max(
        0,
        Math.min(mobile ? 2 : 5, Math.floor((range[1] - range[0]) / gap) + 1)
      );
      list.sort(
        (a, b) =>
          Number(b.id === hover) - Number(a.id === hover) ||
          majorParts.indexOf(a.id) - majorParts.indexOf(b.id)
      );
      list.splice(max);
      list.sort((a, b) => a.p.y - b.p.y);
      let prev = range[0] - gap;
      for (const c of list) {
        c.y = Math.max(prev + gap, clamp(c.p.y, range[0], range[1]));
        prev = c.y;
      }
      let next = range[1] + gap;
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].y = Math.min(list[i].y, next - gap);
        next = list[i].y;
      }
      let latestBottom = range[0];
      for (const c of list) {
        const { label, g, p } = c;
        label.hidden = false;
        label.dataset.side = side;
        const measured = label.offsetWidth,
          half = label.offsetHeight / 2,
          x = side === 'left' ? Math.max(12, edge - measured) : Math.min(edge, w - 12 - measured);
        // A projected mount can extend well beyond its anchor. Reserve its whole silhouette.
        let y = null,
          cost = Infinity;
        for (let trial = latestBottom + half; trial <= range[1] - half; trial += 4) {
          if (Math.abs(trial - c.y) >= cost) continue;
          if (
            bounds.some(
              (r) =>
                r.x0 < x + measured + 5 &&
                r.x1 > x - 5 &&
                r.y0 < trial + half + 3 &&
                r.y1 > trial - half - 3
            )
          )
            continue;
          y = trial;
          cost = Math.abs(trial - c.y);
        }
        if (y === null) {
          label.hidden = true;
          g.style.display = 'none';
          continue;
        }
        visible.add(c.id);
        latestBottom = y + half + 5;
        Object.assign(label.style, { left: f(x) + 'px', top: f(y - half) + 'px', opacity: alpha });
        g.style.display = '';
        g.style.opacity = String(alpha * 0.71);
        const x1 = side === 'left' ? x + measured + 6 : x - 6,
          x2 = x1 + (side === 'left' ? 12 : -12);
        attrs(c.dot, { cx: f(p.x), cy: f(p.y) });
        c.path.setAttribute(
          'd',
          'M' + f(x1) + ' ' + f(y) + 'H' + f(x2) + 'L' + f(p.x) + ' ' + f(p.y)
        );
      }
    }
    for (const c of this.callouts.values())
      if (!visible.has(c.id)) {
        c.label.hidden = true;
        c.g.style.display = 'none';
      }
  }
}
