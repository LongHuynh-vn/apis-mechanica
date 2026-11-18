// ─────────────────────────────────────────────────────────────────────────────
// bee/explode.js — EXPLODE SYSTEM
// Every separable piece hangs from an "explode node": a Group that slides away
// from its seat along its real assembly axis. Nodes nest (a leg's tibia rides
// on its femur's node), so chains separate joint by joint. The same nodes
// drive the opening sequence, played as a disassembly in reverse.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LAYERS } from '../core/gfx.js';
import { clamp, ease } from '../core/math.js';

const WINDOW = 0.45;        // fraction of the slider each piece takes to travel
const INTRO_TRAVEL = 0.56;  // seconds each piece takes to fly in
const INTRO_SPAN = 2.05;    // seconds between the first and the last piece starting

export function createExplode() {
  /** @type {THREE.Group[]} */
  const nodes = [];

  /**
   * Create an explode node.
   * @param {string} partId   selectable component it belongs to
   * @param {object} o        dir: assembly axis in the PARENT's space; dist: travel in cm at full explode;
   *                          at: 0..(1-WINDOW) when it starts to leave (0 = first, outermost)
   */
  function node(partId, { dir = [0, 1, 0], dist = 0, at = 0, name } = {}) {
    const g = new THREE.Group();
    g.name = name || `ex:${partId}`;
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]);
    if (d.lengthSq() > 0) d.normalize();
    g.userData.ex = { part: partId, dir: d, dist, at: clamp(at, 0, 1 - WINDOW), rest: new THREE.Vector3(), p: 0, k: 0, vis: 1 };
    nodes.push(g);
    return g;
  }

  /**
   * A bare separation channel (no Object3D): procedural rigs — leg chains, the
   * antennal flagellum — read `.k` (0 seated … 1 out) and open their own joints.
   */
  const channels = [];
  function channel(partId, at = 0) {
    const c = { part: partId, at: clamp(at, 0, 1 - WINDOW), k: 0, p: 0 };
    channels.push(c);
    return c;
  }

  /** Call once after the rig is assembled: remembers every node's seated position. */
  function freeze() { for (const n of nodes) n.userData.ex.rest.copy(n.position); }

  // ── assembly guides: dashed hairlines from each piece back to its seat ─────
  const MAX = 256;
  const guideGeo = new THREE.BufferGeometry();
  const gPos = new Float32Array(MAX * 6), gDist = new Float32Array(MAX * 2), gAlpha = new Float32Array(MAX * 2);
  guideGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage));
  guideGeo.setAttribute('aDist', new THREE.BufferAttribute(gDist, 1).setUsage(THREE.DynamicDrawUsage));
  guideGeo.setAttribute('aAlpha', new THREE.BufferAttribute(gAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const guideMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    uniforms: { uColor: { value: new THREE.Color('#a8977a') }, uOpacity: { value: 0.9 } },
    vertexShader: /* glsl */ `
      attribute float aDist; attribute float aAlpha; varying float vDist; varying float vAlpha;
      void main() { vDist = aDist; vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying float vDist; varying float vAlpha;
      void main() {
        float dash = step( fract( vDist / 0.34 ), 0.56 );
        if ( dash * vAlpha < 0.01 ) discard;
        gl_FragColor = vec4( uColor, uOpacity * vAlpha * dash );
      }`,
  });
  const guides = new THREE.LineSegments(guideGeo, guideMat);
  guides.frustumCulled = false; guides.layers.set(LAYERS.HELPERS); guides.renderOrder = 5;
  guides.name = 'assembly-guides';

  const a = new THREE.Vector3(), b = new THREE.Vector3();

  /** Seat every node according to its own progress k (0 seated … 1 fully out). */
  function apply() {
    for (const n of nodes) {
      const e = n.userData.ex;
      n.position.copy(e.rest).addScaledVector(e.dir, e.dist * e.k);
    }
  }

  /** Slider-driven: e ∈ 0..1 → staggered, eased travel per node. */
  function setAmount(amount) {
    for (const n of nodes) {
      const e = n.userData.ex;
      e.p = clamp((amount - e.at) / WINDOW);
      e.k = ease.inOutCubic(e.p);
      n.visible = true; n.scale.setScalar(1);
    }
    for (const c of channels) { c.p = clamp((amount - c.at) / WINDOW); c.k = ease.inOutCubic(c.p); }
    apply();
  }

  /**
   * Opening sequence, t in seconds. Pieces fly in along their assembly axes in
   * reverse disassembly order, overshoot a hair and settle ("click").
   * @returns {number} assembled fraction 0..1
   */
  function setIntro(t) {
    let seated = 0;
    for (const n of nodes) {
      const e = n.userData.ex;
      const start = (1 - e.at / (1 - WINDOW)) * INTRO_SPAN;       // last-off is first-on
      const u = clamp((t - start) / INTRO_TRAVEL);
      if (u <= 0) { n.visible = false; continue; }
      n.visible = true;
      const s = ease.outBack(u, 0.9);                               // 0 → 1 with a small overshoot
      e.k = (1 - s) * 1.25; e.p = 1 - u;
      n.scale.setScalar(0.35 + 0.65 * ease.outCubic(clamp(u * 2.2)));
      seated += u;
    }
    for (const c of channels) {
      const start = (1 - c.at / (1 - WINDOW)) * INTRO_SPAN;
      const u = clamp((t - start) / INTRO_TRAVEL);
      c.k = (1 - ease.outBack(u, 0.9)) * 1.25; c.p = 1 - u;
    }
    apply();
    return seated / nodes.length;
  }
  const introDuration = INTRO_SPAN + INTRO_TRAVEL;

  /** Rebuild the dashed guides (world space). `strength` 0..1 fades them. */
  function updateGuides(strength) {
    let i = 0;
    if (strength > 0.004) {
      for (const n of nodes) {
        const e = n.userData.ex;
        if (e.dist <= 0 || e.k < 0.02 || !n.visible || !n.parent || i >= MAX) continue;
        n.parent.localToWorld(a.copy(e.rest));
        n.parent.localToWorld(b.copy(n.position));
        const len = a.distanceTo(b);
        gPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        gDist[i * 2] = 0; gDist[i * 2 + 1] = len;
        const al = clamp(e.k * 3) * strength; gAlpha[i * 2] = al * 0.35; gAlpha[i * 2 + 1] = al;
        i++;
      }
    }
    guideGeo.setDrawRange(0, i * 2);
    guideGeo.attributes.position.needsUpdate = true; guideGeo.attributes.aDist.needsUpdate = true; guideGeo.attributes.aAlpha.needsUpdate = true;
    guides.visible = i > 0;
  }

  /** Mean separation (0..1) of all nodes belonging to a part — labels fade in with it. */
  function partSeparation(partId) {
    let s = 0, c = 0;
    for (const n of nodes) { const e = n.userData.ex; if (e.part === partId && e.dist > 0) { s += e.k; c++; } }
    return c ? s / c : 0;
  }

  return { nodes, node, channel, channels, freeze, setAmount, setIntro, introDuration, updateGuides, guides, guideMat, partSeparation };
}
