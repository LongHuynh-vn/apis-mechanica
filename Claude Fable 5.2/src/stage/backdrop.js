// ─────────────────────────────────────────────────────────────────────────────
// stage/backdrop.js — the infinite seamless backdrop.
//
// A full-screen triangle drawn first (opaque list, renderOrder −1000, no depth),
// on LAYERS.HELPERS so it never appears in the EMISSIVE / NORMAL_ID passes.
// Colour = soft radial falloff bg → bgEdge in screen space (a photographic
// cyclorama: no horizon, no seam with the floor, which is a pure ink overlay).
// CODEX adds procedural vellum — stains, tide-lines, mottling, foxing and fibre —
// keyed to the view direction so it turns with the camera like a distant dome.
// The low-frequency vellum is baked ONCE into a 2048×1024 equirect target at
// creation (rgba = stain, tide, mottle, foxing); only a single fibre noise is
// evaluated per pixel at runtime, and only while CODEX is showing.
// Writes alpha 0: post uses beauty alpha as the "lit geometry" mask, so flat
// paper colours bypass the tone curve and land exactly on the palette.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LAYERS } from '../core/gfx.js';
import { NOISE_GLSL } from './glsl.js';

const BAKE_FRAG = /* glsl */ `
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float lon = (vUv.x - 0.5) * 6.28318531, lat = (vUv.y - 0.5) * 3.14159265;
  vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float st = stFbm3(dir * 2.6 + 3.1);
  float st2 = stFbm3(dir * 6.5 + 11.7);
  float stain = smoothstep(0.52, 0.78, st) * 0.55 + smoothstep(0.55, 0.9, st2) * 0.35;
  float tide = smoothstep(0.035, 0.0, abs(st - 0.6));
  float mott = stFbm3(dir * 14.0);
  float fx = stNoise3(dir * 90.0);
  float fox = smoothstep(0.88, 0.96, fx) * smoothstep(0.5, 0.75, stFbm3(dir * 4.0 + 1.3));
  gl_FragColor = vec4(stain, tide, mott, fox);
}
`;

export function createBackdrop({ renderer } = {}) {
  const vellum = new THREE.WebGLRenderTarget(2048, 1024, {
    type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping,
  });
  vellum.texture.wrapS = THREE.RepeatWrapping;
  if (renderer) {
    const bake = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: BAKE_FRAG,
      depthTest: false, depthWrite: false,
    }));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(vellum);
    bake.render(renderer);
    renderer.setRenderTarget(prev);
    bake.material.dispose();
    bake.dispose();
  }

  const uniforms = {
    uBg: { value: new THREE.Color() },
    uBgEdge: { value: new THREE.Color() },
    uCodex: { value: 0 },
    uDark: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uInvViewProj: { value: new THREE.Matrix4() },
    tVellum: { value: vellum.texture },
  };

  const material = new THREE.ShaderMaterial({
    name: 'stage.backdrop',
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBg, uBgEdge;
      uniform float uCodex, uDark;
      uniform vec2 uRes;
      uniform mat4 uInvViewProj;
      uniform sampler2D tVellum;
      varying vec2 vNdc;
      ${NOISE_GLSL}
      void main() {
        float aspect = uRes.x / uRes.y;
        vec2 q = vec2(vNdc.x * aspect, vNdc.y + 0.12) * 0.5;
        float r = length(q * vec2(0.86, 1.0));
        float t = smoothstep(0.08, 0.98, r);
        t = t * t * (3.0 - 2.0 * t);
        vec3 col = mix(uBg, uBgEdge, t);

        if (uCodex > 0.001) {
          vec4 w = uInvViewProj * vec4(vNdc, 1.0, 1.0);
          vec4 n = uInvViewProj * vec4(vNdc, -1.0, 1.0);
          vec3 dir = normalize(w.xyz / w.w - n.xyz / n.w);
          vec2 uv = vec2(atan(dir.x, dir.z) / 6.28318531 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265 + 0.5);
          vec4 v = texture2D(tVellum, uv);          // stain, tide, mottle, foxing (baked)
          float fibre = stNoise3(dir * vec3(420.0, 60.0, 420.0)) - 0.5;
          vec3 parch = col;
          parch *= 1.0 - v.r * 0.085 - v.g * 0.021 - v.a * 0.12;
          parch *= 1.0 + fibre * 0.022 + (v.b - 0.5) * 0.035;
          parch = mix(parch, parch * vec3(1.0, 0.93, 0.82), v.r * 0.35 + v.a * 0.5);
          col = mix(col, parch, uCodex);
        }
        gl_FragColor = vec4(col, 0.0);
      }
    `,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'stage.backdrop';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.layers.set(LAYERS.HELPERS);

  const _m = new THREE.Matrix4();
  const _size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer_, scene, camera) => {
    const rt = renderer_.getRenderTarget();
    if (rt) uniforms.uRes.value.set(rt.width, rt.height);
    else uniforms.uRes.value.copy(renderer_.getDrawingBufferSize(_size));
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    uniforms.uInvViewProj.value.copy(_m).invert();
  };

  return { mesh, uniforms };
}
