// ─────────────────────────────────────────────────────────────────────────────
// stage/dust.js — a sparse, almost subliminal field of motes drifting in the
// key light (LAYERS.GHOST: beauty only). Motion is computed in the vertex
// shader from uTime, so the CPU does nothing per frame.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LAYERS, globalUniforms } from '../core/gfx.js';
import { rng } from '../core/math.js';

export function createDust({ count = 110, seed = 5 } = {}) {
  const rnd = rng(seed);
  const pos = new Float32Array(count * 3);
  const seedA = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3 + 0] = (rnd() - 0.5) * 56;
    pos[i * 3 + 1] = 1 + rnd() * 30;
    pos[i * 3 + 2] = (rnd() - 0.5) * 44;
    seedA[i * 4 + 0] = rnd(); seedA[i * 4 + 1] = rnd(); seedA[i * 4 + 2] = rnd(); seedA[i * 4 + 3] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 15, 0), 60);

  const uniforms = {
    uTime: globalUniforms.uTime,
    uPixelRatio: globalUniforms.uPixelRatio,
    uColor: { value: new THREE.Color(1, 1, 1) },
    uAlpha: { value: 0.1 },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uCentre: { value: new THREE.Vector3(0, 4, 0) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'stage.dust',
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uPixelRatio, uAlpha;
      uniform vec3 uKeyDir, uCentre;
      varying float vA;
      void main() {
        float t = uTime * (0.05 + aSeed.x * 0.06);
        vec3 p = position;
        p += vec3(sin(t * 1.3 + aSeed.y * 6.28), sin(t * 0.9 + aSeed.z * 6.28) * 0.6, cos(t * 1.1 + aSeed.w * 6.28)) * (1.5 + aSeed.x * 2.0);
        p.y = 1.0 + mod(p.y + uTime * (0.03 + aSeed.w * 0.05) - 1.0, 30.0);      // very slow rise, wraps
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // brighter inside the key beam around the subject, fading at the field's edges
        vec3 rel = p - uCentre;
        float beam = exp(-dot(rel - uKeyDir * dot(rel, uKeyDir), rel - uKeyDir * dot(rel, uKeyDir)) / 220.0);
        float twinkle = 0.65 + 0.35 * sin(uTime * (0.4 + aSeed.y) + aSeed.z * 30.0);
        float edge = smoothstep(1.0, 3.0, p.y) * (1.0 - smoothstep(24.0, 30.0, p.y));
        vA = uAlpha * (0.25 + 0.75 * beam) * twinkle * edge;
        float sz = (0.9 + aSeed.z * 1.4) * uPixelRatio;
        gl_PointSize = clamp(sz * 48.0 / max(-mv.z, 1.0), 0.8 * uPixelRatio, 3.2 * uPixelRatio);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float m = exp(-dot(c, c) * 14.0);
        gl_FragColor = vec4(uColor, vA * m);
      }
    `,
  });
  const points = new THREE.Points(g, material);
  points.name = 'stage.dust';
  points.layers.set(LAYERS.GHOST);
  points.renderOrder = 10;
  return { points, uniforms };
}
