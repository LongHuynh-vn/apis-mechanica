// ─────────────────────────────────────────────────────────────────────────────
// post/post.js — the frame pipeline (replaces renderer.render(scene, camera)).
//
//   BEAUTY     all layers, uPass 0 → HDR HalfFloat target + depth texture.
//              Alpha = "lit geometry" mask (opaque = 1, glass = its opacity,
//              backdrop / floor ink = 0).
//   EMISSIVE   (bloom > 0) LAYERS.DEFAULT, uPass 1, black clear → half-res HDR,
//              13-tap mip chain down to 1/64, tent upsample back to 1/4.
//              Threshold 0: the mask is already emissive-only and occluded.
//   NORMAL_ID  (ink > 0) DEFAULT + GLASS, uPass 2 → RGBA8 + depth texture; the
//              grade pass detects depth / crease / part-id edges from it.
//   DOF        (dof > 0) half-res prefilter (rgb + signed CoC) → golden-angle
//              gather → composited by full-res CoC (in-focus pixels stay sharp).
//   GRADE      DOF mix, + bloom, Khronos Neutral tone mapping on lit geometry
//              (flat backdrop / drawing colours bypass the curve and stay exactly
//              on palette), ink lines, theme-aware vignette, sRGB, ±0.5/255
//              dither → RGBA8.
//   SMAA       last, to the canvas.
//
// RENDERER SETTINGS (set here): toneMapping = NoToneMapping (tone mapping happens
// in GRADE), outputColorSpace = SRGBColorSpace (unchanged default; GRADE encodes
// sRGB itself, SMAA writes the encoded values straight to the canvas).
// Every optional pass is skipped entirely when its amount is 0; render targets
// are allocated lazily on first use, resized in setSize, never per frame.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { LAYERS, PASS, globalUniforms } from '../core/gfx.js';
import { palette, TokenBlender } from '../core/themes.js';
import {
  FS_VERT, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, DOF_PREFILTER_FRAG, DOF_GATHER_FRAG, GRADE_FRAG,
} from './shaders.js';

/** Per-theme post tokens (PORCELAIN, DELFT, OBSIDIAN, CODEX). */
export const POST_TOKENS = [
  { exposure: 0.84, bloom: 0.42, bloomTint: '#fff0dc', vignette: 0.34, vigDarken: 0.0 },
  { exposure: 0.86, bloom: 0.40, bloomTint: '#fff3e4', vignette: 0.34, vigDarken: 0.0 },
  { exposure: 1.08, bloom: 1.1, bloomTint: '#ffdcae', vignette: 0.6, vigDarken: 0.4 },
  { exposure: 0.9, bloom: 0.45, bloomTint: '#ffe6c2', vignette: 0.5, vigDarken: 0.08 },
];

const MIPS = 5;                       // bloom levels below the half-res emissive target: 1/4 … 1/64
const LEVEL_WEIGHTS = [0.55, 0.8, 1.0, 1.0, 1.0];
const DOF_MAX_CSS = 13;               // max bokeh radius in CSS px at dof = 1
const APERTURE = 1.9;

const hdrRT = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  depthBuffer: false, generateMipmaps: false, ...opts,
});

export function createPost({ renderer, scene, camera, stage }) {
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const params = { bloom: 1, ink: 0, dof: 0, focus: 30, vignette: 1 };
  const tokens = new TokenBlender(POST_TOKENS);
  const tk = tokens.current;

  let W = 2, H = 2, PR = 1;

  // ── targets ────────────────────────────────────────────────────────────────
  const beautyDepth = new THREE.DepthTexture(W, H);
  beautyDepth.type = THREE.UnsignedIntType;
  const rtBeauty = hdrRT(W, H, { depthBuffer: true, depthTexture: beautyDepth });
  const rtLDR = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false });
  let rtEm = null, down = null, up = null;          // bloom (lazy)
  let rtNormal = null;                               // ink (lazy)
  let rtDofA = null, rtDofB = null;                  // dof (lazy)

  const half = (v, k) => Math.max(1, Math.floor(v / k));
  function ensureBloom() {
    if (rtEm) return;
    rtEm = hdrRT(half(W, 2), half(H, 2), { depthBuffer: true });
    down = []; up = [];
    for (let i = 0; i < MIPS; i++) {
      down.push(hdrRT(half(W, 4 << i), half(H, 4 << i)));
      if (i < MIPS - 1) up.push(hdrRT(half(W, 4 << i), half(H, 4 << i)));
    }
  }
  function ensureNormal() {
    if (rtNormal) return;
    const dt = new THREE.DepthTexture(W, H);
    dt.type = THREE.UnsignedIntType;
    rtNormal = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, depthTexture: dt, generateMipmaps: false,
    });
    grade.uniforms.tNormal.value = rtNormal.texture;
    grade.uniforms.tNDepth.value = rtNormal.depthTexture;
  }
  // The bokeh is gathered at half the CSS resolution: device/2 at pixel ratio 1, device/4 on
  // high-DPI screens (the in-focus subject always comes from the full-res beauty, so the
  // coarser target only ever carries already-blurred pixels — 1/4 of the gather cost at 2×).
  const dofDiv = () => (PR >= 1.5 ? 4 : 2);
  function ensureDof() {
    if (rtDofA) return;
    rtDofA = hdrRT(half(W, dofDiv()), half(H, dofDiv()));
    rtDofB = hdrRT(half(W, dofDiv()), half(H, dofDiv()));
  }

  // ── materials ──────────────────────────────────────────────────────────────
  const fsMat = (frag, uniforms) => new THREE.ShaderMaterial({
    uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const depthUniforms = () => ({
    uNear: { value: 0.5 }, uFar: { value: 600 },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uFocus: { value: 30 }, uAperture: { value: APERTURE },
  });

  const downMat = fsMat(BLOOM_DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
  const upMat = fsMat(BLOOM_UP_FRAG, {
    tLow: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uWeight: { value: 1 },
  });
  const prefMat = fsMat(DOF_PREFILTER_FRAG, { tColor: { value: rtBeauty.texture }, tDepth: { value: beautyDepth }, uSrcTexel: { value: new THREE.Vector2() }, ...depthUniforms() });
  const gatherMat = fsMat(DOF_GATHER_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxR: { value: 8 } });
  const grade = fsMat(GRADE_FRAG, {
    tBeauty: { value: rtBeauty.texture }, tDepth: { value: beautyDepth },
    tBloom: { value: null }, tDof: { value: null }, tNormal: { value: null }, tNDepth: { value: null },
    uRes: { value: new THREE.Vector2(W, H) }, uPixelRatio: { value: 1 },
    uBloom: { value: 0 }, uBloomTint: { value: new THREE.Color(1, 1, 1) },
    uDof: { value: 0 }, uMaxR: { value: 8 },
    uInk: { value: 0 }, uInkColor: { value: new THREE.Color() },
    uVignette: { value: 0 }, uVigColor: { value: new THREE.Color() },
    uExposure: { value: 1 },
    uFlat: globalUniforms.uSchematic,
    ...depthUniforms(),
  });
  const quad = new FullScreenQuad(grade);
  const smaa = new SMAAPass();
  smaa.renderToScreen = true;

  // ── helpers ────────────────────────────────────────────────────────────────
  const _clear = new THREE.Color();
  const BLACK = new THREE.Color(0, 0, 0);
  function drawTo(target, material) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }
  function setDepthUniforms(u) {
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uFocus.value = Math.max(0.5, params.focus);
  }
  function scenePass(pass, layerMask, target, clearAlpha) {
    globalUniforms.uPass.value = pass;
    camera.layers.mask = layerMask;
    if (pass !== PASS.BEAUTY) stage?.beforePass?.(pass);
    renderer.setRenderTarget(target);
    renderer.setClearColor(BLACK, clearAlpha);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    if (pass !== PASS.BEAUTY) stage?.afterPass?.(pass);
  }

  function renderBloom() {
    ensureBloom();
    // level 0 reads the half-res emissive target (Karis-weighted against fireflies)
    let src = rtEm;
    for (let i = 0; i < MIPS; i++) {
      downMat.uniforms.tSrc.value = src.texture;
      downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      downMat.uniforms.uKaris.value = i === 0 ? 1 : 0;
      drawTo(down[i], downMat);
      src = down[i];
    }
    let low = down[MIPS - 1];
    for (let i = MIPS - 2; i >= 0; i--) {
      upMat.uniforms.tLow.value = low.texture;
      upMat.uniforms.tCur.value = down[i].texture;
      upMat.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
      upMat.uniforms.uRadius.value = 1.0;
      upMat.uniforms.uWeight.value = LEVEL_WEIGHTS[i];
      drawTo(up[i], upMat);
      low = up[i];
    }
    grade.uniforms.tBloom.value = up[0].texture;
  }

  function renderDof() {
    ensureDof();
    setDepthUniforms(prefMat.uniforms);
    if (dofDiv() === 4) prefMat.uniforms.uSrcTexel.value.set(1 / W, 1 / H); else prefMat.uniforms.uSrcTexel.value.set(0, 0);
    drawTo(rtDofA, prefMat);
    gatherMat.uniforms.tSrc.value = rtDofA.texture;
    gatherMat.uniforms.uTexel.value.set(1 / rtDofA.width, 1 / rtDofA.height);
    gatherMat.uniforms.uMaxR.value = Math.max(0.5, maxCocHalfPx() * 2 / dofDiv());   // in DOF-target px
    drawTo(rtDofB, gatherMat);
    grade.uniforms.tDof.value = rtDofB.texture;
  }
  // (grade compares CoC in half-device-px, independent of the DOF target size)
  const maxCocHalfPx = () => Math.max(0.5, DOF_MAX_CSS * PR * 0.5 * Math.min(1, params.dof));

  // ── API ────────────────────────────────────────────────────────────────────
  function setSize(width, height, pixelRatio = renderer.getPixelRatio()) {
    PR = pixelRatio;
    W = Math.max(1, Math.floor(width * pixelRatio));
    H = Math.max(1, Math.floor(height * pixelRatio));
    rtBeauty.setSize(W, H);
    rtLDR.setSize(W, H);
    smaa.setSize(W, H);
    if (rtEm) {
      rtEm.setSize(half(W, 2), half(H, 2));
      for (let i = 0; i < MIPS; i++) {
        down[i].setSize(half(W, 4 << i), half(H, 4 << i));
        if (i < MIPS - 1) up[i].setSize(half(W, 4 << i), half(H, 4 << i));
      }
    }
    if (rtNormal) rtNormal.setSize(W, H);
    if (rtDofA) { rtDofA.setSize(half(W, dofDiv()), half(H, dofDiv())); rtDofB.setSize(half(W, dofDiv()), half(H, dofDiv())); }
    grade.uniforms.uRes.value.set(W, H);
    grade.uniforms.uPixelRatio.value = PR;
  }

  function render(dt) {
    void dt;
    tokens.update();
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(_clear);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const prevMask = camera.layers.mask;
    renderer.autoClear = false;
    camera.updateMatrixWorld();

    const bloomK = Math.max(0, params.bloom) * tk.bloom;
    const inkK = Math.min(1, Math.max(0, params.ink));
    const dofK = Math.min(1, Math.max(0, params.dof));

    // 1 · beauty (consumes the key shadow-map refresh requested by stage.prerender)
    scenePass(PASS.BEAUTY, 0xffffffff, rtBeauty, 0);
    // 2 · emissive mask → bloom
    if (bloomK > 1e-4) {
      ensureBloom();
      scenePass(PASS.EMISSIVE, 1 << LAYERS.DEFAULT, rtEm, 1);
    }
    // 3 · normals + ids → ink
    if (inkK > 1e-3) {
      ensureNormal();
      scenePass(PASS.NORMAL_ID, (1 << LAYERS.DEFAULT) | (1 << LAYERS.GLASS), rtNormal, 0);
    }
    globalUniforms.uPass.value = PASS.BEAUTY;
    camera.layers.mask = prevMask;

    if (bloomK > 1e-4) renderBloom();
    if (dofK > 1e-3) renderDof();

    // 4 · grade → LDR
    const gu = grade.uniforms;
    const wsum = LEVEL_WEIGHTS.reduce((a, b) => a + b, 0);
    gu.uBloom.value = bloomK > 1e-4 ? bloomK / wsum : 0;
    gu.uBloomTint.value.copy(tk.bloomTint);
    gu.uDof.value = dofK > 1e-3 ? 1 : 0;
    gu.uMaxR.value = maxCocHalfPx();
    gu.uInk.value = inkK > 1e-3 ? inkK : 0;
    gu.uInkColor.value.copy(palette.current.inkLine);
    gu.uVignette.value = Math.max(0, params.vignette) * tk.vignette;
    gu.uVigColor.value.copy(palette.current.bgEdge).multiplyScalar(1 - tk.vigDarken);
    gu.uExposure.value = tk.exposure;
    setDepthUniforms(gu);
    drawTo(rtLDR, grade);

    // 5 · SMAA → canvas (its edge pass discards non-edge pixels, so its targets must be auto-cleared)
    renderer.autoClear = true;
    smaa.render(renderer, null, rtLDR);

    renderer.autoClear = prevAuto;
    renderer.setClearColor(_clear, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  return {
    setSize,
    render,
    params,
    tokens: tk,
    _debug: {
      get targets() { return { rtBeauty, rtLDR, rtEm, rtNormal, rtDofA, rtDofB, down, up }; },
      grade, smaa, drawTo, renderBloom, renderDof,
    },
  };
}
