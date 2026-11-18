// ─────────────────────────────────────────────────────────────────────────────
// core/themes.js — theme registry, the 800 ms crossfade clock, and TokenBlender.
//
// HOW THEMING WORKS
//  · Each module owns a token table: an array of four plain objects (one per
//    theme, same keys). Values may be numbers, '#rrggbb' strings (→ THREE.Color,
//    lerped in linear space), THREE.Color, or number arrays. Anything else snaps
//    at the halfway point.
//  · Wrap the table in a TokenBlender and call `blender.update()` once per
//    frame. `blender.current` then holds the smoothly mixed values (Color
//    instances are reused, so you may keep references to them).
//  · Re-theming mid-fade never snaps: the blender re-bases on whatever it was
//    showing when the new fade began.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ease } from './math.js';

export const THEMES = Object.freeze([
  { id: 'porcelain', name: 'Porcelain & Gilt', short: 'Porcelain', dark: false, swatch: ['#f4efe6', '#c9a045'] },
  { id: 'delft',     name: 'Delft',            short: 'Delft',     dark: false, swatch: ['#eef2f6', '#1f4e9c'] },
  { id: 'obsidian',  name: 'Obsidian & Amber', short: 'Obsidian',  dark: true,  swatch: ['#15130f', '#f0a43a'] },
  { id: 'codex',     name: 'Codex',            short: 'Codex',     dark: false, swatch: ['#e2d2ac', '#6b4423'] },
]);

/** Shared palette. Stage, UI and bee all read these so every accent moves together. */
export const PALETTE = [
  { // PORCELAIN & GILT
    bg: '#efe9df', bgEdge: '#ddd4c5', line: '#a8977a', ink: '#2a2622', inkSoft: '#7d756a',
    metal: '#b3852c', accent: '#b3852c', accentInk: '#fffaf0', glow: '#ffb24a',
    paper: '#f6f1e7', inkLine: '#3a3530', panel: '#f7f3ea',
  },
  { // DELFT
    bg: '#e4e8eb', bgEdge: '#cfd6dc', line: '#7f95ad', ink: '#1c2733', inkSoft: '#66768a',
    metal: '#94743a', accent: '#1f4e9c', accentInk: '#f3f7fb', glow: '#ffc680',
    paper: '#f1f4f6', inkLine: '#1d3f7a', panel: '#eef1f4',
  },
  { // OBSIDIAN & AMBER
    bg: '#0f0d0a', bgEdge: '#050403', line: '#8a6f40', ink: '#ebe3d3', inkSoft: '#8f8573',
    metal: '#b89455', accent: '#e9a13a', accentInk: '#140f08', glow: '#ffa230',
    paper: '#17130e', inkLine: '#cba75c', panel: '#17140f',
  },
  { // CODEX
    bg: '#e2d2ac', bgEdge: '#c9b486', line: '#7b5a3a', ink: '#3b2a1a', inkSoft: '#7c6646',
    metal: '#7a6238', accent: '#7a4a22', accentInk: '#f3e7c8', glow: '#e89b3c',
    paper: '#eadbb8', inkLine: '#4a3220', panel: '#e9dbb9',
  },
];

export const THEME_FADE = 0.8; // seconds

/** The crossfade clock. `t` is eased 0..1; `serial` increments whenever a new fade begins. */
export const themeBlend = { from: 0, to: 0, t: 1, raw: 1, serial: 0, active: false };

export function startThemeBlend(to, immediate = false) {
  if (to === themeBlend.to && !immediate) return;
  themeBlend.from = themeBlend.to;
  themeBlend.to = to;
  themeBlend.raw = immediate ? 1 : 0;
  themeBlend.t = immediate ? 1 : 0;
  themeBlend.active = !immediate;
  themeBlend.serial++;
}

/** Advance the clock; call once per frame (real time) BEFORE any TokenBlender.update(). */
export function updateThemeBlend(dt) {
  if (!themeBlend.active) return false;
  themeBlend.raw = Math.min(1, themeBlend.raw + dt / THEME_FADE);
  themeBlend.t = ease.inOutCubic(themeBlend.raw);
  if (themeBlend.raw >= 1) themeBlend.active = false;
  return true;
}

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const toValue = (v) => (isHex(v) ? new THREE.Color(v) : v?.isColor ? v.clone() : Array.isArray(v) ? v.slice() : v);

export class TokenBlender {
  /** @param {object[]} table one token object per theme (same keys in each) */
  constructor(table) {
    this.table = table.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, toValue(v)])));
    this.current = Object.fromEntries(Object.entries(this.table[themeBlend.to]).map(([k, v]) => [k, toValue(v)]));
    this.base = Object.fromEntries(Object.entries(this.current).map(([k, v]) => [k, toValue(v)]));
    this.serial = themeBlend.serial;
    this.settled = false;
  }

  /** @returns {boolean} true while values are changing (and on the first call) */
  update() {
    if (this.serial !== themeBlend.serial) {
      this.serial = themeBlend.serial;
      for (const k in this.current) copyInto(this.base, k, this.current[k]);
      this.settled = false;
    }
    if (this.settled) return false;
    const target = this.table[themeBlend.to], t = themeBlend.t;
    for (const k in target) {
      const a = this.base[k], b = target[k];
      if (typeof b === 'number') this.current[k] = a + (b - a) * t;
      else if (b?.isColor) this.current[k].copy(a).lerp(b, t);
      else if (Array.isArray(b)) for (let i = 0; i < b.length; i++) this.current[k][i] = a[i] + (b[i] - a[i]) * t;
      else this.current[k] = t < 0.5 ? a : b;
    }
    if (!themeBlend.active) this.settled = true;
    return true;
  }
}

function copyInto(obj, k, v) {
  if (v?.isColor) obj[k].copy(v);
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) obj[k][i] = v[i];
  else obj[k] = v;
}

/** One shared blender for PALETTE (updated by main.js each frame, before everything else). */
export const palette = new TokenBlender(PALETTE);
