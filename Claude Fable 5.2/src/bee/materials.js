// ─────────────────────────────────────────────────────────────────────────────
// bee/materials.js — MATERIALS
// A disciplined hierarchy: one dominant body material, one precious metal (in
// two finishes), glass for wings and eyes, and one emissive accent. Each
// selectable part owns its own instances so it can be dimmed / highlighted /
// dissolved on its own; every instance follows the theme crossfade.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { patchMaterial, globalUniforms } from '../core/gfx.js';
import { TokenBlender } from '../core/themes.js';
import { damp } from '../core/math.js';

// Per-theme art direction. Order: PORCELAIN & GILT, DELFT, OBSIDIAN & AMBER, CODEX.
const ROLE_TOKENS = [
  { // ── PORCELAIN & GILT: glossy ivory porcelain, 24k gold, frosted clear glass, smoked black eyes
    body:     { color: '#ece6db', roughness: 0.2,  metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.05, pattern: 0, env: 1.0 },
    metal:    { color: '#f1c36a', roughness: 0.15, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.25 },
    satin:    { color: '#e6b95e', roughness: 0.36, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.0 },
    filament: { color: '#f3cb78', roughness: 0.3,  metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.25 },
    eye:      { color: '#0d0d10', roughness: 0.06, metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.03, pattern: 0, env: 1.3 },
    glass:    { color: '#d0d9df', roughness: 0.26, opacity: 0.26, iridescence: 0.3,  env: 1.35 },
    vessel:   { color: '#fff1d8', roughness: 0.06, opacity: 0.05, iridescence: 0.06, env: 0.9 },
    core:     { color: '#4e2a0a', emissive: '#ff9a34', emissiveIntensity: 1.2, roughness: 0.45 },
    misc:     { cap: '#d8b25a', glint: '#ffe2b8', glintGain: 0.22, coreLight: '#ffa040', coreLightIntensity: 4, ghost: '#9aa0a6', ghostVein: '#c9a24e', ghostAlpha: 0.075, trail: '#b3852c' },
  },
  { // ── DELFT: blue-and-white glaze with cobalt florals, antique brass, cobalt-glazed eyes
    body:     { color: '#f5f7f9', roughness: 0.17, metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.04, pattern: 1, env: 1.0 },
    metal:    { color: '#bf9c5c', roughness: 0.28, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.05 },
    satin:    { color: '#a88a52', roughness: 0.46, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 0.95 },
    filament: { color: '#bfa06a', roughness: 0.36, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 0.95 },
    eye:      { color: '#16337e', roughness: 0.08, metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.03, pattern: 0, env: 1.3 },
    glass:    { color: '#c9d6e4', roughness: 0.22, opacity: 0.26, iridescence: 0.25, env: 1.3 },
    vessel:   { color: '#f8f4ec', roughness: 0.06, opacity: 0.05, iridescence: 0.05, env: 0.9 },
    core:     { color: '#4a2a0c', emissive: '#ffa64a', emissiveIntensity: 1.15, roughness: 0.45 },
    misc:     { cap: '#2a5cb0', glint: '#bcd4ff', glintGain: 0.3, coreLight: '#ffb060', coreLightIntensity: 4, ghost: '#8d9bb0', ghostVein: '#a88c55', ghostAlpha: 0.07, trail: '#1f4e9c' },
  },
  { // ── OBSIDIAN & AMBER: black lacquer, aged brass filigree, the core is the light
    body:     { color: '#030303', roughness: 0.13, metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.035, pattern: 0, env: 1.0 },
    metal:    { color: '#b99352', roughness: 0.34, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.0 },
    satin:    { color: '#9a7a44', roughness: 0.5,  metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 0.9 },
    filament: { color: '#7c6336', roughness: 0.4,  metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 0.8 },
    eye:      { color: '#020203', roughness: 0.05, metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.02, pattern: 0, env: 0.5 },
    glass:    { color: '#4a4237', roughness: 0.2,  opacity: 0.12, iridescence: 0.35, env: 0.7 },
    vessel:   { color: '#ffcf8a', roughness: 0.05, opacity: 0.045, iridescence: 0.08, env: 1.1 },
    core:     { color: '#3a1a04', emissive: '#ff9430', emissiveIntensity: 1.15, roughness: 0.5 },
    misc:     { cap: '#c79f58', glint: '#ffb45e', glintGain: 0.15, coreLight: '#ff9a38', coreLightIntensity: 14, ghost: '#d9c29a', ghostVein: '#c79f58', ghostAlpha: 0.022, trail: '#e9a13a' },
  },
  { // ── CODEX: cream enamel, oxidised bronze, sepia glass
    body:     { color: '#eadcbd', roughness: 0.4,  metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3,  pattern: 0, env: 0.85 },
    metal:    { color: '#8d7447', roughness: 0.42, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.0 },
    satin:    { color: '#77623e', roughness: 0.58, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 0.9 },
    filament: { color: '#96794a', roughness: 0.45, metalness: 1, clearcoat: 0,   clearcoatRoughness: 0.1,  pattern: 0, env: 1.1 },
    eye:      { color: '#27190f', roughness: 0.12, metalness: 0, clearcoat: 1,   clearcoatRoughness: 0.08, pattern: 0, env: 1.1 },
    glass:    { color: '#cdb88a', roughness: 0.32, opacity: 0.3,  iridescence: 0.12, env: 1.0 },
    vessel:   { color: '#f1dba8', roughness: 0.1,  opacity: 0.06, iridescence: 0.04, env: 0.85 },
    core:     { color: '#4a2a10', emissive: '#e8852a', emissiveIntensity: 1.2, roughness: 0.5 },
    misc:     { cap: '#8a5a2b', glint: '#e8b56e', glintGain: 0.25, coreLight: '#f09a3c', coreLightIntensity: 4, ghost: '#7d6a48', ghostVein: '#7a6238', ghostAlpha: 0.085, trail: '#7a4a22' },
  },
];

// Flatten { role: { key: v } } → { role_key: v } so TokenBlender can mix it.
const FLAT = ROLE_TOKENS.map((theme) => {
  const out = {};
  for (const [role, kv] of Object.entries(theme)) for (const [k, v] of Object.entries(kv)) out[`${role}_${k}`] = v;
  return out;
});

// How each role fills in SCHEMATIC mode (0 paper … 1 ink) and whether it is see-through.
const ROLE_DEF = {
  body:     { fillInk: 0.0 },
  metal:    { fillInk: 0.09 },
  satin:    { fillInk: 0.16 },
  filament: { fillInk: 0.14 },
  eye:      { fillInk: 0.45 },
  glass:    { fillInk: 0.0, transparent: true },
  vessel:   { fillInk: 0.0, transparent: true },
  core:     { fillInk: 0.0, fillAccent: 0.7 },
};

// Parts the SECTION plane never cuts: the mechanism you cut the bee open to see.
const SECTION_KEEPS_WHOLE = new Set(['motor', 'geartrain', 'core', 'sting', 'petiole', 'proboscis']);

export function createMaterials() {
  const tokens = new TokenBlender(FLAT);
  /** @type {{ mat: THREE.MeshPhysicalMaterial, role: string, part: string, u: object }[]} */
  const instances = [];
  const cache = new Map();
  const parts = new Map(); // partId → { dim, rim, fade, fadeTarget, list: [] }

  const partState = (id) => {
    if (!parts.has(id)) parts.set(id, { dim: 0, rim: 0, fade: 1, list: [] });
    return parts.get(id);
  };

  /**
   * Get (or create) the material for `role` on part `partId`.
   * @param {string} role   body | metal | satin | filament | eye | glass | vessel | core
   * @param {string} partId selectable component this mesh belongs to
   * @param {object} [v]    variant: { key, cap, hex, map, extend, flat, side }
   */
  function get(role, partId, v = {}) {
    const key = `${role}|${partId}|${v.key ?? ''}|${v.cap ? 'c' : ''}${v.hex ? 'h' : ''}${v.map ? 'm' : ''}`;
    if (cache.has(key)) return cache.get(key);
    const def = ROLE_DEF[role];
    const mat = new THREE.MeshPhysicalMaterial({
      transparent: !!def.transparent,
      depthWrite: !def.transparent,
      side: def.transparent ? THREE.DoubleSide : (v.side ?? THREE.FrontSide),
      flatShading: !!v.flat,
      map: v.map ?? null,
    });
    if (role === 'glass' || role === 'vessel') {
      mat.iridescenceIOR = 1.38;
      mat.iridescenceThicknessMinimum = 330; mat.iridescenceThicknessMaximum = 470;   // stays in the pale gold–teal orders, away from hot pink
      mat.specularIntensity = 1;
      mat.ior = 1.5;
    }
    if (role === 'core') mat.toneMapped = true;
    const u = patchMaterial(mat, {
      fillInk: def.fillInk, fillAccent: def.fillAccent ?? 0,
      cap: v.cap, hex: v.hex, pattern: !!v.map, key: v.key, extend: v.extend, glass: !!def.transparent,
      clip: !SECTION_KEEPS_WHOLE.has(partId),       // SECTION removes the whole near half; only the inner mechanism stays intact
    });
    const inst = { mat, role, part: partId, u };
    instances.push(inst);
    partState(partId).list.push(inst);
    cache.set(key, mat);
    applyOne(inst);
    return mat;
  }

  function applyOne({ mat, role, u }) {
    const t = tokens.current, g = (k) => t[`${role}_${k}`];
    mat.color.copy(g('color'));
    mat.roughness = g('roughness');
    mat.envMapIntensity = g('env');
    if (role === 'glass' || role === 'vessel') {
      mat.opacity = g('opacity');
      mat.iridescence = g('iridescence');
      mat.metalness = 0;
      if (mat.map) u.uPatternMix.value = 1;          // etch mask is always on
    } else if (role === 'core') {
      mat.emissive.copy(g('emissive'));
      mat.emissiveIntensity = g('emissiveIntensity');
      mat.metalness = 0;
    } else {
      mat.metalness = g('metalness');
      mat.clearcoat = g('clearcoat');
      mat.clearcoatRoughness = g('clearcoatRoughness');
      if (mat.map) u.uPatternMix.value = t.body_pattern;
    }
    u.uCapColor.value.copy(t.misc_cap);
    if (u.uHexRimColor) u.uHexRimColor.value.copy(t.metal_color);
  }

  let hoverId = null;

  return {
    get, instances, tokens,
    /** Current blended token values (e.g. tok.misc_coreLight). */
    get tok() { return tokens.current; },
    setHover(id) { hoverId = id; },
    /** Dissolve a part: 1 visible … 0 gone. */
    setFade(partId, f) { partState(partId).fade = f; },
    update(dt) {
      if (tokens.update()) for (const inst of instances) applyOne(inst);
      for (const [id, st] of parts) {
        const dimT = hoverId && id !== hoverId ? 1 : 0, rimT = hoverId && id === hoverId ? 1 : 0;
        st.dim = Math.abs(st.dim - dimT) < 1e-3 ? dimT : damp(st.dim, dimT, 9, dt);
        st.rim = Math.abs(st.rim - rimT) < 1e-3 ? rimT : damp(st.rim, rimT, 11, dt);
        for (const { u } of st.list) { u.uDim.value = st.dim; u.uRim.value = st.rim * 0.9; u.uFade.value = st.fade; }
      }
    },
  };
}

/** Convenience mesh factory: sets part id, shadow flags and layer in one go. */
export function mesh(geometry, material, partId, { cast = true, receive = true, layer = 0, name } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast; m.receiveShadow = receive;
  m.userData.partId = partId;
  if (layer) m.layers.set(layer);
  if (name) m.name = name;
  return m;
}

export { globalUniforms };
