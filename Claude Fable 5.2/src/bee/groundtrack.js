// ─────────────────────────────────────────────────────────────────────────────
// bee/groundtrack.js — FLIGHT PLATE
// While the bee flies, the drawing plate records it like a plotter: a dashed
// plumb line drops from the thorax to the surface below, a small reticle marks
// the ground point, and a hairline ground track fades out behind it. It makes
// altitude and path readable at a glance and ties the flight to the drawing.
// All hairlines live on LAYERS.HELPERS (beauty pass only).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LAYERS } from '../core/gfx.js';
import { palette } from '../core/themes.js';
import { clamp, smoothstep, TAU } from '../core/math.js';

const TRACK = 220;          // samples kept
const LIFE = 9;             // seconds (bee time) a track sample stays visible
const MAXV = (TRACK + 96) * 2;

export function createGroundTrack({ scene, bee, surfaceY }) {
  const pos = new Float32Array(MAXV * 3), dist = new Float32Array(MAXV), dash = new Float32Array(MAXV), alpha = new Float32Array(MAXV);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aDash', new THREE.BufferAttribute(dash, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aDist; attribute float aDash; attribute float aAlpha; varying float vDist; varying float vDash; varying float vAlpha;
      void main() { vDist = aDist; vDash = aDash; vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying float vDist; varying float vDash; varying float vAlpha;
      void main() {
        float on = vDash > 0.0 ? step( fract( vDist / vDash ), 0.55 ) : 1.0;
        float a = uOpacity * vAlpha * on; if ( a < 0.008 ) discard;
        gl_FragColor = vec4( uColor, a );
      }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false; lines.layers.set(LAYERS.HELPERS); lines.renderOrder = 4; lines.visible = false; lines.name = 'flight-plate';
  scene.add(lines);

  let nv = 0;
  const seg = (ax, ay, az, bx, by, bz, al, d = 0, d0 = 0) => {
    if (nv + 2 > MAXV || al < 0.008) return;
    pos.set([ax, ay, az, bx, by, bz], nv * 3);
    dist[nv] = d0; dist[nv + 1] = d0 + Math.hypot(bx - ax, by - ay, bz - az); dash[nv] = dash[nv + 1] = d; alpha[nv] = alpha[nv + 1] = al;
    nv += 2;
  };

  const track = [];           // { x, z, y, t }
  let simT = 0;

  /** @param {number} dt bee-time seconds  @param {number} air 0..1 airborne amount */
  function update(dt, air) {
    simT += dt;
    const p = bee.bodyWorld, sy = surfaceY(p.x, p.z) + 0.035;
    const last = track[track.length - 1];
    if (air > 0.25 && (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.22)) {
      track.push({ x: p.x, z: p.z, y: sy, t: simT });
      if (track.length > TRACK) track.shift();
    }
    while (track.length && simT - track[0].t > LIFE) track.shift();

    const show = air > 0.01 || track.length > 1;
    lines.visible = show;
    if (!show) return;
    nv = 0;
    mat.uniforms.uColor.value.copy(palette.current.line).lerp(palette.current.metal, 0.45);

    // ground track (segments that step on/off the plinth are skipped rather than slanted)
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      if (Math.abs(a.y - b.y) > 0.01) continue;
      const age = (simT - b.t) / LIFE;
      seg(a.x, a.y, a.z, b.x, b.y, b.z, Math.pow(1 - clamp(age), 1.6) * 0.75);
    }
    if (air > 0.01) {
      const alt = Math.max(0, p.y - 1.7 - sy);
      const k = air * smoothstep(0.2, 1.4, alt);
      // plumb line from the belly to the surface
      seg(p.x, p.y - 1.75, p.z, p.x, sy, p.z, k * 0.6, 0.42);
      // reticle: a ring that widens a little with height, four ticks, a centre mark
      const r = 0.75 + alt * 0.045, N = 40;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
        seg(p.x + Math.cos(a0) * r, sy, p.z + Math.sin(a0) * r, p.x + Math.cos(a1) * r, sy, p.z + Math.sin(a1) * r, k * 0.8);
      }
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * TAU, c = Math.cos(a0), s = Math.sin(a0);
        seg(p.x + c * (r + 0.18), sy, p.z + s * (r + 0.18), p.x + c * (r + 0.7), sy, p.z + s * (r + 0.7), k * 0.8);
        seg(p.x + c * 0.08, sy, p.z + s * 0.08, p.x + c * 0.26, sy, p.z + s * 0.26, k * 0.8);
      }
    }
    geo.setDrawRange(0, nv);
    geo.attributes.position.needsUpdate = geo.attributes.aDist.needsUpdate = geo.attributes.aDash.needsUpdate = geo.attributes.aAlpha.needsUpdate = true;
  }

  return { update, lines };
}
