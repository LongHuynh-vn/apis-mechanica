// ─────────────────────────────────────────────────────────────────────────────
// stage/groundShadow.js — the bee's key-light shadow on the stage (floor and
// plinth alike), with a penumbra that grows with distance like a real softbox.
//
//  1. capture  an orthographic camera looks UP the key-light direction from
//              below the floor at LAYERS.DEFAULT (plinth hidden), so the depth
//              test keeps, per light-space texel, the bee point CLOSEST to the
//              surface it shades. An override material writes, from the distance
//              h along the key ray down to the surface (plinth top or floor):
//                R = w            wide (soft) layer
//                G = exp(−h/0.4)  contact (feet, tarsi)
//                B = w            narrow (crisp) layer
//                A = w · h / 24   for the occluder height of the narrow layer
//              with w = 1 / (1 + h / 9).
//  2. blur     separable at full capture resolution (half float — the crisp/soft
//              hand-over divides two channels, which bands in 8 bit): R with
//              σ = 0.55 cm (+ 0.1 cm per cm of lift), G/B/A with σ = 0.13 cm.
//  3. receive  floor + plinth shaders (RECEIVER_GLSL) project their own world
//              position along the key direction, so the shadow lands correctly
//              at any height and runs across the plinth edge onto the floor with
//              no seam. Near-contact parts (h ≲ 0.3 cm) use the crisp layer, high
//              parts the soft one; the blend follows the local occluder height.
//              In SCHEMATIC the result becomes ink hatching.
// The plinth and floor do NOT sample the key shadow map (it stays for the bee's
// self-shadowing), so there is exactly one shadow on the stage.
// Cost per frame: one depth-tested draw of the bee into 1024² + 2 blur passes.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LAYERS, globalUniforms, sectionPlane } from '../core/gfx.js';
import { DIMS } from '../core/dims.js';
import { KEY_DIR } from './lighting.js';
import { clamp } from '../core/math.js';

const SIZE = 1024;         // capture + blur resolution
const HALF = 13;           // capture half-width in cm, light space (span 18.6 cm + blur margin)

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (v) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

/** Distance from p down the key ray (toward −KEY_DIR) to the plinth top or the floor. */
const ALONG_GLSL = /* glsl */ `
const vec3 ST_KEY = ${v3(KEY_DIR)};
float stHexH2(vec2 p) { vec2 q = abs(p); return max(q.y, dot(q, vec2(0.8660254, 0.5))); }
float stAlongKey(vec3 p) {
  float tTop = (p.y - ${f(DIMS.plinthTopY)}) / ST_KEY.y;
  vec2 q = p.xz - ST_KEY.xz * tTop;
  if (tTop >= -0.02 && stHexH2(q) <= ${f(DIMS.plinthRadius + 0.12)} * 0.8660254) return max(tTop, 0.0);
  return max((p.y - ${f(DIMS.floorY)}) / ST_KEY.y, 0.0);
}
`;

export function createGroundShadow() {
  // half float: the crisp/soft hand-over divides two blurred channels, which bands visibly in 8 bit
  const opts = { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const captureRT = new THREE.WebGLRenderTarget(SIZE, SIZE, { ...opts, depthBuffer: true });
  const blurA = new THREE.WebGLRenderTarget(SIZE, SIZE, { ...opts, depthBuffer: false });
  const blurB = new THREE.WebGLRenderTarget(SIZE, SIZE, { ...opts, depthBuffer: false });

  // light-space basis (camera right / up) — the camera looks along +KEY_DIR (from below, toward the light)
  const AX = new THREE.Vector3().crossVectors(KEY_DIR, new THREE.Vector3(0, 1, 0)).normalize();
  const AY = new THREE.Vector3().crossVectors(AX, KEY_DIR).normalize();

  const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.05, 160);
  camera.up.copy(AY);
  camera.layers.set(LAYERS.DEFAULT);

  const override = new THREE.ShaderMaterial({
    name: 'stage.groundShadow.capture',
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <batching_pars_vertex>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      varying vec3 vW;
      void main() {
        #include <batching_vertex>
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vec4 w = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          w = instanceMatrix * w;
        #endif
        #ifdef USE_BATCHING
          w = batchingMatrix * w;
        #endif
        vW = (modelMatrix * w).xyz;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      ${ALONG_GLSL}
      void main() {
        float h = stAlongKey(vW);
        float w = 1.0 / (1.0 + h / 9.0);
        gl_FragColor = vec4(w, exp(-h / 0.55), w, w * min(h / 24.0, 1.0));
      }
    `,
  });

  const overrideClip = override.clone();
  overrideClip.name = 'stage.groundShadow.captureClipped';
  overrideClip.clippingPlanes = [sectionPlane];
  const swapped = [];

  const blurMat = new THREE.ShaderMaterial({
    name: 'stage.groundShadow.blur',
    uniforms: {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2(1, 0) },     // one texel in uv, along the blur axis
      uSigma: { value: new THREE.Vector3(8, 2, 2) }, // (wide R, contact G, narrow B/A) in texels
    },
    depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uDir; uniform vec3 uSigma;
      varying vec2 vUv;
      void main() {
        // R with the wide sigma; G (contact) and BA (crisp layer) share the narrow one → 2 fetches per tap
        float r = 0.0, wr = 0.0;
        vec3 gba = vec3(0.0);
        vec3 s = max(uSigma, vec3(0.5));
        for (int i = -8; i <= 8; i++) {
          float x = float(i) / 8.0 * 2.6;            // ±2.6 sigma
          float w = exp(-0.5 * x * x);
          r += texture2D(tSrc, vUv + uDir * x * s.x).r * w;
          gba += texture2D(tSrc, vUv + uDir * x * s.z).gba * w;
          wr += w;
        }
        gl_FragColor = vec4(r, gba) / wr;
      }
    `,
  });
  const quad = new FullScreenQuad(blurMat);

  // receiver uniforms (shared by reference with floor + plinth materials)
  const uniforms = {
    uGShadow: { value: blurB.texture },
    uGShadowC: { value: new THREE.Vector3() },                        // light-space origin (world)
    uGShadowAX: { value: AX.clone() }, uGShadowAY: { value: AY.clone() },
    uGShadowXform: { value: new THREE.Vector4(0, 0, 1 / (2 * HALF), 1) }, // z: 1 / capture width, w: shrink (>= 1)
    uGShadowParams: { value: new THREE.Vector4(0.35, 0.6, 1, 0) },        // body, contact, altitude fade, enabled
  };

  // blur widths (cm) and the occluder heights (cm) over which the crisp layer hands over to the soft one
  const P = { wide: 0.55, wideLift: 0.1, narrow: 0.13, softFrom: 0.5, softTo: 4.0 };   // narrow also blurs the contact term

  const centre = new THREE.Vector3();
  const texel = (2 * HALF) / SIZE;
  let altitude = 0;
  const _clear = new THREE.Color();
  const _c = new THREE.Vector3();

  /** Track the bee (snapped to whole light-space texels: no shimmer). alt in cm above the surface beneath. */
  function update(dt, beePos, alt, strengthBody, strengthContact) {
    altitude = alt;
    const a = Math.round(beePos.dot(AX) / texel) * texel;
    const b = Math.round(beePos.dot(AY) / texel) * texel;
    centre.copy(AX).multiplyScalar(a).addScaledVector(AY, b).addScaledVector(KEY_DIR, beePos.dot(KEY_DIR));
    uniforms.uGShadowC.value.copy(centre);
    const shrink = 1 + clamp(alt, 0, 40) * 0.008;
    uniforms.uGShadowXform.value.set(P.softFrom, P.softTo, 1 / (2 * HALF), shrink);
    const fade = 1 / (1 + clamp(alt, 0, 60) * 0.03);
    uniforms.uGShadowParams.value.set(strengthBody, strengthContact, fade, 1);
  }

  /** Capture + blur. `hide` = objects on LAYERS.DEFAULT that must not cast (the plinth). */
  function render(renderer, scene, hide) {
    _c.copy(centre).addScaledVector(KEY_DIR, -80);
    camera.position.copy(_c);
    camera.lookAt(centre);
    camera.updateMatrixWorld();

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    renderer.getClearColor(_clear);
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    for (const o of hide) o.visible = false;

    // (shadowMap.autoUpdate is off and needsUpdate is false here, so this draw never re-renders the key shadow map)
    // SECTION: parts clipped by the section plane must cast clipped shadows (and the parts it keeps
    // whole must not be clipped), so the override is chosen per mesh while a section is showing.
    const section = globalUniforms.uSection.value > 0.001;
    if (section) {
      scene.traverseVisible((o) => {
        if (!o.layers.isEnabled(LAYERS.DEFAULT) || hide.includes(o)) return;
        if (o.isMesh && !Array.isArray(o.material)) {
          swapped.push(o, o.material);
          o.material = o.material.clippingPlanes?.length ? overrideClip : override;
        } else if (o.isPoints || o.isLine || o.isSprite) { swapped.push(o, null); o.visible = false; }
      });
    } else scene.overrideMaterial = override;
    scene.background = null;
    renderer.autoClear = false;
    renderer.setRenderTarget(captureRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    for (let i = 0; i < swapped.length; i += 2) {
      const o = swapped[i], m = swapped[i + 1];
      if (m) o.material = m; else o.visible = true;
    }
    swapped.length = 0;

    // blur: capture → A (horizontal) → B (vertical), all at SIZE
    blurMat.uniforms.uSigma.value.set((P.wide + clamp(altitude, 0, 20) * P.wideLift) / texel, P.narrow / texel, P.narrow / texel);
    blurMat.uniforms.tSrc.value = captureRT.texture;
    blurMat.uniforms.uDir.value.set(1 / SIZE, 0);
    renderer.setRenderTarget(blurA);
    quad.render(renderer);
    blurMat.uniforms.tSrc.value = blurA.texture;
    blurMat.uniforms.uDir.value.set(0, 1 / SIZE);
    renderer.setRenderTarget(blurB);
    quad.render(renderer);

    for (const o of hide) o.visible = true;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    renderer.autoClear = prevAuto;
    renderer.setClearColor(_clear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  return { uniforms, update, render, camera, params: P, targets: { captureRT, blurA, blurB } };
}
