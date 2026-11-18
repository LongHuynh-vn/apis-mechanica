// ─────────────────────────────────────────────────────────────────────────────
// bee/schematic.js — the drawing plate
// In SCHEMATIC mode the bee carries its own drafting: centre lines, dimension
// lines for body length and wingspan, the stroke-angle arc, and numbered
// callouts — all attached to the moving machine, so the plate animates in
// flight. Dimension lines always offset themselves sideways ON SCREEN, so they
// read cleanly from any camera angle, and fade when seen end-on.
// Hairlines are world-space GL lines; numerals are DOM (crisp mono type).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LAYERS } from '../core/gfx.js';
import { palette } from '../core/themes.js';
import { state, SPEC } from '../core/state.js';
import { PARTS } from './parts.js';
import { smoothstep, damp, DEG } from '../core/math.js';

const MAXV = 720;

export function createSchematic({ scene, bee, root }) {
  // ── line batch (world space, rebuilt every frame while visible) ────────────
  const pos = new Float32Array(MAXV * 3), dist = new Float32Array(MAXV), dash = new Float32Array(MAXV), alpha = new Float32Array(MAXV);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aDash', new THREE.BufferAttribute(dash, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aDist; attribute float aDash; attribute float aAlpha; varying float vDist; varying float vDash; varying float vAlpha;
      void main() { vDist = aDist; vDash = aDash; vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying float vDist; varying float vDash; varying float vAlpha;
      void main() {
        float on = 1.0;
        if ( vDash > 0.0 ) { float f = fract( vDist / vDash ); on = ( f < 0.62 || ( f > 0.78 && f < 0.86 ) ) ? 1.0 : 0.0; }   // long-short centre-line pattern
        float a = uOpacity * vAlpha * on; if ( a < 0.01 ) discard;
        gl_FragColor = vec4( uColor, a );
      }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false; lines.layers.set(LAYERS.HELPERS); lines.renderOrder = 20; lines.visible = false; lines.name = 'schematic-lines';
  scene.add(lines);
  let nv = 0;
  const seg = (a, b, al = 1, dashLen = 0) => {
    if (nv + 2 > MAXV || al < 0.01) return;
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], nv * 3);
    dist[nv] = 0; dist[nv + 1] = a.distanceTo(b); dash[nv] = dash[nv + 1] = dashLen; alpha[nv] = alpha[nv + 1] = al;
    nv += 2;
  };

  // ── DOM annotations ────────────────────────────────────────────────────────
  root.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' });
  root.appendChild(svg);
  const mk = (cls, text) => { const d = document.createElement('div'); d.className = `annot ${cls}`; d.textContent = text; d.style.opacity = '0'; root.appendChild(d); return d; };
  const dims = {
    length: { el: mk('annot--dim', `${SPEC.bodyMm} mm`), x: 0, y: 0, a: 0 },
    span: { el: mk('annot--dim', `${SPEC.spanMm} mm`), x: 0, y: 0, a: 0 },
    stroke: { el: mk('annot--dim', `${SPEC.strokeDeg}°`), x: 0, y: 0, a: 0 },
    axis: { el: mk('annot--note', '℄'), x: 0, y: 0, a: 0 },
  };
  const callouts = Object.entries(PARTS).filter(([, p]) => p.n).sort((a, b) => a[1].n - b[1].n).map(([id, p]) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', 'var(--ink-line)'); line.setAttribute('stroke-width', '0.75'); svg.appendChild(line);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '1.6'); dot.setAttribute('fill', 'var(--ink-line)'); svg.appendChild(dot);
    return { id, el: mk('annot--callout', String(p.n)), line, dot, x: 0, y: 0, ax: 0, ay: 0, a: 0, init: false };
  });
  const place = (d, x, y, a) => { d.x = x; d.y = y; d.a = a; d.el.style.opacity = a.toFixed(3); if (a > 0.004) d.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`; };

  const A = new THREE.Vector3(), B = new THREE.Vector3(), o = new THREE.Vector3(), axis = new THREE.Vector3(), view = new THREE.Vector3(), up = new THREE.Vector3(), fwdW = new THREE.Vector3();
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3(), mid = new THREE.Vector3(), c = new THREE.Vector3(), t1 = new THREE.Vector3();
  const toScreen = (v, w, h, out) => { t1.copy(v).project(camRef); out.x = (t1.x * 0.5 + 0.5) * w; out.y = (-t1.y * 0.5 + 0.5) * h; return t1.z < 1; };
  let camRef = null;
  const s2 = { x: 0, y: 0 };

  /** A dimension between two world points, offset sideways on screen; returns the label anchor + visibility. */
  function dimension(a, b, off, prefer, w, h, al) {
    axis.subVectors(b, a); const len = axis.length(); axis.divideScalar(len);
    view.subVectors(mid.addVectors(a, b).multiplyScalar(0.5), camRef.position).normalize();
    o.crossVectors(axis, view); const sideways = o.length();                // 0 when the dimension is seen end-on
    if (sideways < 1e-3) return 0;
    o.divideScalar(sideways); if (o.dot(prefer) < 0) o.negate();
    const vis = al * smoothstep(0.18, 0.5, sideways);
    if (vis < 0.01) return 0;
    p0.copy(a).addScaledVector(o, 0.35); p1.copy(a).addScaledVector(o, off + 0.45); seg(p0, p1, vis * 0.8);     // extension lines
    p2.copy(b).addScaledVector(o, 0.35); p3.copy(b).addScaledVector(o, off + 0.45); seg(p2, p3, vis * 0.8);
    p0.copy(a).addScaledVector(o, off); p2.copy(b).addScaledVector(o, off); seg(p0, p2, vis);                    // dimension line
    for (const p of [p0, p2]) {                                                                                   // oblique end ticks
      p1.copy(p).addScaledVector(axis, 0.22).addScaledVector(o, 0.22); p3.copy(p).addScaledVector(axis, -0.22).addScaledVector(o, -0.22); seg(p1, p3, vis);
    }
    mid.addVectors(p0, p2).multiplyScalar(0.5);
    return vis;
  }

  function update(dt, { camera, w, h, amount }) {
    camRef = camera;
    const vis = amount * (state.introDone ? 1 : 0);
    lines.visible = vis > 0.004;
    if (!lines.visible) {
      if (dims.length.a > 0 || callouts[0].a > 0) { for (const k in dims) place(dims[k], 0, 0, 0); for (const cl of callouts) { cl.a = 0; cl.el.style.opacity = '0'; cl.line.setAttribute('opacity', '0'); cl.dot.setAttribute('opacity', '0'); } }
      return;
    }
    nv = 0;
    mat.uniforms.uColor.value.copy(palette.current.inkLine); mat.uniforms.uOpacity.value = vis * 0.9;
    const body = bee.body, f = bee.f, M = body.matrixWorld;
    const calm = 1 - smoothstep(0.05, 0.4, state.explode);                 // the plate steps back when the machine is exploded
    up.setFromMatrixColumn(camera.matrixWorld, 1); fwdW.setFromMatrixColumn(M, 2).normalize();
    const spread = Math.max(1 - f.fold, 0) * calm;

    // centre lines
    A.set(0, 0, 5.2).applyMatrix4(M); B.set(0, -0.35, -9.4).applyMatrix4(M); seg(A, B, 0.75 * calm, 1.15);
    A.set(0, 2.9, 0).applyMatrix4(M); B.set(0, -3.3, 0).applyMatrix4(M); seg(A, B, 0.5 * calm, 1.15);
    const hy = bee.thorax.mounts.foreHinge.y, hz = bee.thorax.mounts.foreHinge.z;
    A.set(10.6, hy, hz).applyMatrix4(M); B.set(-10.6, hy, hz).applyMatrix4(M); seg(A, B, 0.6 * spread, 1.15);
    toScreen(c.set(0, 0, 5.5).applyMatrix4(M), w, h, s2); place(dims.axis, s2.x, s2.y, vis * 0.8 * calm);

    // body length: head front → sting tip
    A.set(0, 0.1, 3.56).applyMatrix4(M); B.set(0, -0.7, -7.44).applyMatrix4(M);
    let v = dimension(A, B, 4.3, up, w, h, calm);
    if (v > 0 && toScreen(mid, w, h, s2)) place(dims.length, s2.x, s2.y, v * vis); else place(dims.length, 0, 0, 0);

    // wingspan: tip to tip with the wings square to the body
    const half = SPEC.spanMm / 20;
    A.set(half, hy, hz).applyMatrix4(M); B.set(-half, hy, hz).applyMatrix4(M);
    t1.copy(fwdW).addScaledVector(up, 0.35);
    v = dimension(A, B, 5.6, t1.clone(), w, h, spread);
    if (v > 0 && toScreen(mid, w, h, s2)) place(dims.span, s2.x, s2.y, v * vis); else place(dims.span, 0, 0, 0);

    // stroke-angle arc on the left wing, drawn in the stroke plane
    const WL = bee.wings.sides[0], BM = WL.base.matrixWorld, r = 6.3, meanS = f.meanL, halfA = (SPEC.strokeDeg / 2) * DEG;
    const arcA = spread * (1 - smoothstep(0.02, 0.2, state.explode));
    if (arcA > 0.01) {
      const N = 28;
      for (let i = 0; i < N; i++) {
        const a0 = meanS - halfA + (i / N) * 2 * halfA, a1 = meanS - halfA + ((i + 1) / N) * 2 * halfA;
        A.set(Math.cos(a0) * r, 0, Math.sin(a0) * r).applyMatrix4(BM); B.set(Math.cos(a1) * r, 0, Math.sin(a1) * r).applyMatrix4(BM); seg(A, B, arcA);
      }
      c.set(0, 0, 0).applyMatrix4(BM);
      for (const a0 of [meanS - halfA, meanS + halfA]) { B.set(Math.cos(a0) * (r + 0.5), 0, Math.sin(a0) * (r + 0.5)).applyMatrix4(BM); seg(c, B, arcA * 0.7, 0.5); }
      A.set(Math.cos(meanS) * (r + 0.85), 0, Math.sin(meanS) * (r + 0.85)).applyMatrix4(BM);
      if (toScreen(A, w, h, s2)) place(dims.stroke, s2.x, s2.y, arcA * vis); else place(dims.stroke, 0, 0, 0);
    } else place(dims.stroke, 0, 0, 0);

    geo.setDrawRange(0, nv);
    geo.attributes.position.needsUpdate = geo.attributes.aDist.needsUpdate = geo.attributes.aDash.needsUpdate = geo.attributes.aAlpha.needsUpdate = true;

    // numbered callouts: pushed outward from the machine's screen centre, kept apart from each other
    toScreen(bee.bodyWorld, w, h, s2); const cx = s2.x, cy = s2.y;
    const ca = vis * calm;
    for (const cl of callouts) {
      const an = bee.anchors[cl.id];
      an.o.getWorldPosition(A); const ok = toScreen(A, w, h, s2);
      cl.ax = s2.x; cl.ay = s2.y;
      let dx = s2.x - cx, dy = s2.y - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const d = camera.position.distanceTo(A), pr = (an.radius / (d * Math.tan((camera.fov * DEG) / 2))) * (h / 2) * 0.5;
      cl.tx = s2.x + dx * (pr + 44); cl.ty = s2.y + dy * (pr + 44) - 6; cl.ok = ok;
    }
    for (let it = 0; it < 3; it++) for (let i = 0; i < callouts.length; i++) for (let j = i + 1; j < callouts.length; j++) {
      const a = callouts[i], b = callouts[j], dx = b.tx - a.tx, dy = b.ty - a.ty, l = Math.hypot(dx, dy);
      if (l < 30 && l > 1e-3) { const push = (30 - l) / 2; a.tx -= (dx / l) * push; a.ty -= (dy / l) * push; b.tx += (dx / l) * push; b.ty += (dy / l) * push; }
    }
    for (const cl of callouts) {
      if (!cl.init) { cl.x = cl.tx; cl.y = cl.ty; cl.init = true; }
      cl.x = damp(cl.x, cl.tx, 12, dt); cl.y = damp(cl.y, cl.ty, 12, dt);
      const a = cl.ok ? ca : 0;
      cl.a = a; cl.el.style.opacity = a.toFixed(3);
      cl.el.style.transform = `translate(${cl.x.toFixed(1)}px,${cl.y.toFixed(1)}px) translate(-50%,-50%)`;
      const dx = cl.x - cl.ax, dy = cl.y - cl.ay, l = Math.hypot(dx, dy) || 1;
      cl.line.setAttribute('x1', cl.ax.toFixed(1)); cl.line.setAttribute('y1', cl.ay.toFixed(1));
      cl.line.setAttribute('x2', (cl.x - (dx / l) * 9).toFixed(1)); cl.line.setAttribute('y2', (cl.y - (dy / l) * 9).toFixed(1));
      cl.line.setAttribute('opacity', (a * 0.9).toFixed(3));
      cl.dot.setAttribute('cx', cl.ax.toFixed(1)); cl.dot.setAttribute('cy', cl.ay.toFixed(1)); cl.dot.setAttribute('opacity', a.toFixed(3));
    }
  }

  return { update, lines };
}
