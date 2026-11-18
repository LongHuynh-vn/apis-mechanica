// ─────────────────────────────────────────────────────────────────────────────
// core/gfx.js — rendering contract shared by bee, stage and post-processing.
//
//  LAYERS   which camera layers an object lives on
//  PASS     the three scene passes; selected by globalUniforms.uPass
//  globalUniforms   one uniform object shared by every patched material
//  patchMaterial()  teaches a MeshStandard/PhysicalMaterial the contract
//
// PASS CONTRACT (who renders what)
//  · BEAUTY     camera sees every layer, uPass = 0.
//  · EMISSIVE   camera sees LAYERS.DEFAULT only, uPass = 1. Patched materials
//               output ONLY their emissive radiance (black otherwise), so the
//               result is an occlusion-correct mask for selective bloom.
//  · NORMAL_ID  camera sees LAYERS.DEFAULT + LAYERS.GLASS, uPass = 2. Patched materials
//               output view-space normal (rgb, 0..1) and an edge id (a) for the
//               ink-line detector of SCHEMATIC mode.
//  Anything on LAYERS.DEFAULT must therefore be a patched material, or a
//  ShaderMaterial that honours uPass itself, or be hidden during passes 1 & 2.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const LAYERS = Object.freeze({
  DEFAULT: 0,   // solid geometry (bee, plinth)
  GHOST: 1,     // wing motion-blur ghosts, trails — beauty pass only
  HELPERS: 2,   // hairlines, guides, dimension lines, floor drawings — beauty pass only
  GLASS: 3,     // wing membranes — beauty + NORMAL_ID passes; never shadow casters
});

export const PASS = Object.freeze({ BEAUTY: 0, EMISSIVE: 1, NORMAL_ID: 2 });

export const globalUniforms = {
  uTime: { value: 0 },                              // seconds, real time
  uPass: { value: PASS.BEAUTY },                    // int, see PASS
  uSchematic: { value: 0 },                         // 0..1 crossfade into flat technical-drawing fills
  uSection: { value: 0 },                           // 0..1 amount of SECTION mode (cut-face caps)
  uPaper: { value: new THREE.Color('#f6f1e7') },    // schematic fill
  uInk: { value: new THREE.Color('#3a3530') },      // schematic line / hatch colour
  uBg: { value: new THREE.Color('#efe9df') },       // backdrop colour (dimmed parts fade toward it)
  uAccent: { value: new THREE.Color('#ffb24a') },   // emissive accent
  uHighlight: { value: new THREE.Color('#ffd98a') },// hover rim colour
  uPixelRatio: { value: 1 },                        // renderer pixel ratio (keeps hatching in CSS px)
};

/**
 * World-space clipping plane used by SECTION mode. Fragments with
 * dot(normal, p) + constant < 0 are discarded. Parked far away when unused.
 */
export const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e4);

let edgeIdCounter = 0;
const nextEdgeId = () => { edgeIdCounter = (edgeIdCounter + 1) % 37; return 0.06 + (edgeIdCounter / 37) * 0.84; };

const HEADER = /* glsl */ `
uniform int uPass;
uniform float uSchematic, uSection, uPixelRatio;
uniform vec3 uPaper, uInk, uBg, uAccent, uHighlight;
uniform float uDim, uRim, uFillInk, uFillAccent, uEdgeId, uPatternMix, uFade;
uniform vec3 uCapColor;
#ifdef APIS_HEX
uniform vec2 uHexScale; uniform vec4 uHexRegion; uniform float uHexHole, uHexRim; uniform vec3 uHexRimColor;
float apisHexRimMask = 0.0;
#endif
float apisHatch(vec2 p, float ang, float period) {
  float d = (p.x * cos(ang) + p.y * sin(ang)) / period;
  float f = abs(fract(d) - 0.5) * period;
  return 1.0 - smoothstep(0.3, 0.95, f);
}
`;

const MAP_FRAGMENT = /* glsl */ `
#ifdef APIS_FADE_ALPHA
  diffuseColor.a *= uFade;
#else
  if ( uFade < 0.999 ) {
    // screen-door fade (interleaved gradient noise) — lets opaque parts dissolve without sorting issues
    float ign = fract( 52.9829189 * fract( dot( floor( gl_FragCoord.xy ), vec2( 0.06711056, 0.00583715 ) ) ) );
    if ( ign >= uFade ) discard;
  }
#endif
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, uPatternMix );
  #ifdef APIS_GLASS
    // etched glass: the map is an etch mask (white = clear pane, darker = frosted line) → frosted areas turn milky
    float apisEtch = ( 1.0 - sampledDiffuseColor.g ) * uPatternMix;
    diffuseColor.a = mix( diffuseColor.a, min( 1.0, diffuseColor.a * 2.2 + 0.16 ), apisEtch );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), apisEtch * 0.35 );
  #endif
#endif
#ifdef APIS_HEX
{
  vec2 hp = vUv * uHexScale;
  const vec2 hs = vec2( 1.0, 1.7320508 );
  vec2 ha = mod( hp, hs ) - hs * 0.5;
  vec2 hb = mod( hp - hs * 0.5, hs ) - hs * 0.5;
  vec2 gv = dot( ha, ha ) < dot( hb, hb ) ? ha : hb;
  vec2 cell = ( hp - gv ) / uHexScale;                       // uv of this cell's centre
  float hd = max( abs( gv.x ), dot( abs( gv ), vec2( 0.5, 0.8660254 ) ) );   // 0 centre … 0.5 edge
  // region is mirrored about u = 0.5: uHexRegion = ( offset from the midline, centre v, radius u, radius v )
  vec2 rq = ( vec2( abs( cell.x - 0.5 ), cell.y ) - uHexRegion.xy ) / uHexRegion.zw;
  float inRegion = step( dot( rq, rq ), 1.0 );
  float aa = fwidth( hd ) * 1.2 + 1e-5;
  float hole = inRegion * ( 1.0 - smoothstep( uHexHole - aa, uHexHole + aa, hd ) );
  if ( hole > 0.5 ) discard;
  apisHexRimMask = inRegion * ( 1.0 - smoothstep( uHexHole + uHexRim - aa, uHexHole + uHexRim + aa, hd ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uHexRimColor, apisHexRimMask );
}
#endif
`;

const METAL_FRAGMENT = /* glsl */ `
#ifdef APIS_HEX
  metalnessFactor = mix( metalnessFactor, 1.0, apisHexRimMask );
  roughnessFactor = mix( roughnessFactor, 0.24, apisHexRimMask );
#endif
`;

const COMPOSE = /* glsl */ `
{
  vec3 apisCol = gl_FragColor.rgb;
  vec3 apisN = normal;
  float apisId = uEdgeId;
  float ndv = saturate( dot( normal, normalize( vViewPosition ) ) );
  apisCol += uHighlight * pow( 1.0 - ndv, 2.0 ) * uRim;
  vec2 apisFc = gl_FragCoord.xy / uPixelRatio;
  if ( uSchematic > 0.001 ) {
    float ndl = dot( normal, normalize( vec3( 0.45, 0.75, 0.48 ) ) );
    float zoneMid = smoothstep( 0.42, 0.02, ndl );
    float zoneDark = smoothstep( 0.02, -0.4, ndl );
    float h = max( apisHatch( apisFc, 0.7853982, 5.0 ) * zoneMid, apisHatch( apisFc, -0.7853982, 5.0 ) * zoneDark );
    vec3 fill = mix( mix( uPaper, uInk, uFillInk ), uAccent, uFillAccent );
    fill = mix( fill, uInk, h * 0.5 * ( 1.0 - uFillInk ) );
    apisCol = mix( apisCol, fill, uSchematic );
  }
  #ifdef APIS_CAP
  if ( ! gl_FrontFacing && uSection > 0.001 ) {
    float ch = apisHatch( apisFc, 0.7853982, 4.0 );
    apisCol = mix( apisCol, mix( uCapColor, uInk, ch * 0.5 ), uSection );
    apisN = vec3( 0.0, 0.0, 1.0 );
    apisId = fract( uEdgeId + 0.5 );
  }
  #endif
  apisCol = mix( apisCol, uBg, uDim * 0.72 );
  if ( uPass == 1 ) {
    apisCol = totalEmissiveRadiance * ( 1.0 - uDim * 0.72 ) * ( 1.0 - uSchematic * 0.6 );
    #ifdef APIS_CAP
    if ( ! gl_FrontFacing && uSection > 0.001 ) apisCol = vec3( 0.0 );
    #endif
  }
  gl_FragColor.rgb = apisCol;
  #ifdef APIS_GLASS
  { // glass: see-through where it is dark, solid where it catches a highlight or turns edge-on
    float sl = clamp( dot( totalSpecular, vec3( 0.2126, 0.7152, 0.0722 ) ) * 1.25, 0.0, 1.0 );
    gl_FragColor.a = clamp( gl_FragColor.a + ( sl * 0.5 + pow( 1.0 - ndv, 3.0 ) * 0.18 ) * uFade * ( 1.0 - uSchematic ), 0.0, 1.0 );
  }
  #endif
  if ( uPass == 2 ) gl_FragColor = vec4( apisN * 0.5 + 0.5, apisId );
}
`;

/**
 * Teach a MeshStandardMaterial / MeshPhysicalMaterial the rendering contract.
 *
 * @param {THREE.Material} material
 * @param {object} [opts]
 * @param {number}  [opts.fillInk=0]     schematic fill darkness (0 paper … 1 ink)
 * @param {number}  [opts.fillAccent=0]  schematic fill tint toward the accent colour
 * @param {boolean} [opts.cap=false]     SECTION: clip against sectionPlane and paint back faces as hatched cut-caps
 * @param {boolean} [opts.clip=false]    SECTION: clip against sectionPlane only (thin or one-sided parts: wings, setae, legs)
 * @param {object}  [opts.hex]           hexagonal window cut-outs in UV space:
 *                                       { scale:[u,v], region:[cu,cv,ru,rv], hole:0.36, rim:0.07, rimColor:Color }
 * @param {boolean} [opts.pattern=false] treat `material.map` as an overlay whose strength is uniforms.uPatternMix (0..1)
 * @param {boolean} [opts.glass=false]   transparent glass: highlights and grazing angles stay opaque
 * @param {string}  [opts.key]           extra program-cache key when `extend` changes the shader
 * @param {(shader:object, uniforms:object)=>void} [opts.extend]  further edits, runs last
 * @returns {object} the per-material uniform map (also at material.userData.uniforms):
 *                   uDim, uRim, uFade, uFillInk, uFillAccent, uEdgeId, uPatternMix, uCapColor (+ hex uniforms)
 */
export function patchMaterial(material, opts = {}) {
  const u = {
    uDim: { value: 0 },
    uRim: { value: 0 },
    uFillInk: { value: opts.fillInk ?? 0 },
    uFillAccent: { value: opts.fillAccent ?? 0 },
    uEdgeId: { value: material.transparent ? 1 : (opts.edgeId ?? nextEdgeId()) },
    uPatternMix: { value: opts.pattern ? 0 : 1 },
    uCapColor: { value: new THREE.Color('#d9b45c') },
    uFade: { value: 1 },                 // 1 visible … 0 gone (dithered for opaque, alpha for transparent)
  };
  material.defines = material.defines || {};
  let key = 'apis';
  if (material.transparent) { material.defines.APIS_FADE_ALPHA = ''; key += '|fa'; }
  if (opts.glass) { material.defines.APIS_GLASS = ''; key += '|glass'; }
  if (opts.cap) {
    material.defines.APIS_CAP = '';
    material.side = THREE.DoubleSide;
    key += '|cap';
  }
  if (opts.cap || opts.clip) {           // removed by the SECTION plane (caps additionally paint the cut face)
    material.clippingPlanes = [sectionPlane];
    material.clipShadows = true;
  }
  if (opts.hex) {
    material.defines.APIS_HEX = '';
    material.defines.USE_UV = '';
    material.side = THREE.DoubleSide;
    u.uHexScale = { value: new THREE.Vector2(...(opts.hex.scale ?? [10, 10])) };
    u.uHexRegion = { value: new THREE.Vector4(...(opts.hex.region ?? [0.5, 0.5, 0.5, 0.5])) };
    u.uHexHole = { value: opts.hex.hole ?? 0.36 };
    u.uHexRim = { value: opts.hex.rim ?? 0.07 };
    u.uHexRimColor = { value: opts.hex.rimColor ?? new THREE.Color('#d9b45c') };
    key += '|hex';
  }
  if (opts.key) key += '|' + opts.key;
  material.userData.uniforms = u;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HEADER)
      .replace('#include <map_fragment>', MAP_FRAGMENT)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + METAL_FRAGMENT)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + COMPOSE);
    opts.extend?.(shader, u);
  };
  material.customProgramCacheKey = () => key;
  return u;
}

/** Put an object (and its descendants) on exactly one layer. */
export function setLayer(object, layer) {
  object.traverse((o) => o.layers.set(layer));
  return object;
}
