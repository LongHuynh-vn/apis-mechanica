// ─────────────────────────────────────────────────────────────────────────────
// bee/setae.js — the pile: every seta is one instanced, camera-facing ribbon of
// drawn wire. The vertex shader bends it along its groom (a quadratic arc from
// root to tip), tapers it to a point, turns it to face the eye and gives it the
// normals of a round wire, so the 'filament' metal lights it like a strand:
// the highlight runs along the hair and slides across the pile with the groom.
// The fragment side darkens the roots (a pile shades itself) and lifts the tips
// where the coat turns edge-on to the eye — the soft halo of fur against light.
//
// Eight triangles a hair. The instance matrix still carries root · direction ·
// length · radius, so bounds, culling and picking keep working.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { globalUniforms } from '../core/gfx.js';

const STATIONS = [0, 0.27, 0.53, 0.78, 1];        // root → tip; closer together where the strand tapers
let ribbonGeo = null;
/** One strand: x = −1 / +1 (the two edges), y = 0 root … 1 tip. Shaped entirely in the vertex shader. */
function getRibbonGeo() {
  if (ribbonGeo) return ribbonGeo;
  const pos = [], nor = [], idx = [];
  for (const t of STATIONS) { pos.push(-1, t, 0, 1, t, 0); nor.push(0, 0, 1, 0, 0, 1); }
  for (let i = 0; i < STATIONS.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.2);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.1, 1));
  ribbonGeo = g;
  return g;
}

export const TRIS_PER_HAIR = (STATIONS.length - 1) * 2;

const VERT_PARS = /* glsl */ `
uniform vec3 uSway; uniform float uShimmer; uniform float uTime; uniform float uHairViewH; uniform float uSchematic;
attribute vec4 aGroom;      // xyz: bend toward the tip, in hair lengths (mesh space) · w: this hair's own random number
attribute vec3 aSkin;       // outward normal of the body where the hair is rooted (mesh space)
varying float vHairT; varying float vHairTint; varying float vHairHalo;
`;

// Replaces <defaultnormal_vertex>: builds the strand in view space and hands the lighting a round-wire normal.
const VERT_HAIR = /* glsl */ `
float hairT = position.y;
vec3 hairRoot = instanceMatrix[ 3 ].xyz;
vec3 hairAxis = instanceMatrix[ 1 ].xyz;                     // direction × length
float hairLen = length( hairAxis );
float hairPh = aGroom.w * 6.2831853;
vec3 hairShim = vec3( sin( uTime * 5.1 + hairPh * 7.0 ), sin( uTime * 6.7 + hairPh * 11.0 ), sin( uTime * 4.3 + hairPh * 17.0 ) ) * uShimmer;
vec3 hairBend = ( aGroom.xyz + uSway + hairShim ) * hairLen;  // the root stays put; the tip gives way
vec3 hairObj = hairRoot + hairAxis * hairT + hairBend * ( hairT * hairT );
vec3 hairTan = normalize( mat3( modelViewMatrix ) * ( hairAxis + 2.0 * hairBend * hairT ) );
vec4 hairMV = modelViewMatrix * vec4( hairObj, 1.0 );
vec3 hairEye = normalize( - hairMV.xyz );
vec3 hairSide = cross( hairTan, hairEye );
float hairSl = length( hairSide );
hairSide = hairSl > 1e-4 ? hairSide / hairSl : vec3( 1.0, 0.0, 0.0 );
vec3 hairFace = cross( hairSide, hairTan );                   // the wire's own normal that looks at the eye
float hairW = length( instanceMatrix[ 0 ].xyz ) * ( 0.62 + 0.38 * smoothstep( 0.0, 0.2, hairT ) ) * pow( max( 1.0 - pow( hairT, 2.2 ), 0.0 ), 0.8 );
// never thinner than about a pixel (except at the very tip): far away the pile reads as a soft mass, not as sparkle
float hairPx = - hairMV.z / ( projectionMatrix[ 1 ][ 1 ] * 0.5 * uHairViewH );
hairW = max( hairW, 0.46 * hairPx * ( 1.0 - hairT * hairT * 0.8 ) );
// SCHEMATIC draws the coat the way an engraver would: a third of the strands, so the pile stays a texture of
// pen strokes instead of closing up into solid ink
hairW *= 1.0 - step( 0.34, fract( aGroom.w * 91.7 ) ) * smoothstep( 0.1, 0.55, uSchematic );
hairMV.xyz += hairSide * ( position.x * hairW );
vec3 transformedNormal = normalize( hairFace * 0.5 + hairSide * ( position.x * 0.866 ) );
vHairT = hairT;
vHairTint = 0.84 + 0.32 * fract( aGroom.w * 37.0 );
float hairEdge = 1.0 - abs( dot( normalize( normalMatrix * aSkin ), hairEye ) );
vHairHalo = hairEdge * hairEdge * ( 0.25 + 0.75 * hairT );
`;

const VERT_PROJECT = /* glsl */ `
vec4 mvPosition = hairMV;
gl_Position = projectionMatrix * mvPosition;
`;

const VERT_WORLDPOS = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = modelMatrix * vec4( hairObj, 1.0 );
#endif
`;

/**
 * @param {THREE.Material} material  a patched 'filament' material from the library (one per coat → own uniforms)
 * @param {{pos:THREE.Vector3, dir:THREE.Vector3, len:number, r:number, bend?:THREE.Vector3, skin?:THREE.Vector3, rnd?:number}[]} hairs
 *        pos root · dir unit direction at the root · len length · r root radius · bend arc toward the tip (hair lengths)
 *        · skin body normal at the root · rnd 0..1
 * @returns {THREE.InstancedMesh} with .userData.sway (Vector3 uniform value) and .userData.shimmer ({value})
 */
export function createSetae(material, hairs, partId = 'setae') {
  const sway = { value: new THREE.Vector3() }, shimmer = { value: 0.012 }, viewH = { value: 1080 };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uSway = sway; shader.uniforms.uShimmer = shimmer; shader.uniforms.uTime = globalUniforms.uTime; shader.uniforms.uHairViewH = viewH;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <defaultnormal_vertex>', VERT_HAIR)
      .replace('#include <project_vertex>', VERT_PROJECT)
      .replace('#include <worldpos_vertex>', VERT_WORLDPOS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHairT; varying float vHairTint; varying float vHairHalo;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        diffuseColor.rgb *= mix( 0.26, 1.0, smoothstep( 0.0, 0.62, vHairT ) ) * vHairTint;   // roots sit in the pile's own shade`)
      .replace('#include <opaque_fragment>', /* glsl */ `outgoingLight += diffuseColor.rgb * vHairHalo * 0.42;   // tips catch the light where the coat turns away
        #include <opaque_fragment>`);
  };
  const baseKey = material.customProgramCacheKey?.() ?? '';
  material.customProgramCacheKey = () => baseKey + '|setae-ribbon';

  const n = hairs.length;
  const geo = getRibbonGeo().clone();
  geo.boundingSphere = getRibbonGeo().boundingSphere.clone(); geo.boundingBox = getRibbonGeo().boundingBox.clone();
  const groom = new Float32Array(n * 4), skin = new Float32Array(n * 3);
  const mesh = new THREE.InstancedMesh(geo, material, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), d = new THREE.Vector3();
  hairs.forEach((h, i) => {
    q.setFromUnitVectors(up, d.copy(h.dir).normalize());
    s.set(h.r, h.len, h.r);
    m.compose(h.pos, q, s); mesh.setMatrixAt(i, m);
    if (h.bend) { groom[i * 4] = h.bend.x; groom[i * 4 + 1] = h.bend.y; groom[i * 4 + 2] = h.bend.z; }
    groom[i * 4 + 3] = h.rnd ?? ((i * 0.61803398875) % 1);
    const k = h.skin || d;
    skin[i * 3] = k.x; skin[i * 3 + 1] = k.y; skin[i * 3 + 2] = k.z;
  });
  geo.setAttribute('aGroom', new THREE.InstancedBufferAttribute(groom, 4));
  geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 0.4;                       // the arc and the sway reach a little past the straight strand
  mesh.castShadow = false; mesh.receiveShadow = false;
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {                    // strand width is clamped in pixels → needs the target's height
    const rt = renderer.getRenderTarget();
    viewH.value = rt ? rt.height : renderer.getDrawingBufferSize(size).y;
  };
  mesh.userData.partId = partId;
  mesh.userData.sway = sway.value;
  mesh.userData.shimmer = shimmer;
  return mesh;
}
