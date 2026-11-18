// ─────────────────────────────────────────────────────────────────────────────
// core/math.js — small numeric toolkit shared by every module.
// Everything here is frame-rate independent: pass real delta-time in seconds.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const remap = (x, a, b, c, d) => c + (d - c) * clamp(invLerp(a, b, x));
export const smoothstep = (a, b, x) => { const t = clamp(invLerp(a, b, x)); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, x) => { const t = clamp(invLerp(a, b, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Shortest signed angular difference a→b in radians, in (-π, π]. */
export const angleDelta = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d <= -Math.PI) d += TAU; return d; };

export const ease = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoots ~10% then settles — used for parts clicking into place. */
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
};

/** Exponential smoothing toward a target; `lambda` is the rate (1/s). */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const dampAngle = (current, target, lambda, dt) => current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
export function dampV3(v, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  v.x += (target.x - v.x) * k; v.y += (target.y - v.y) * k; v.z += (target.z - v.z) * k;
  return v;
}

/**
 * Damped harmonic oscillator integrated in closed form (unconditionally stable,
 * identical result at any frame rate). `freq` in Hz, `zeta` damping ratio
 * (1 = critically damped, <1 rings, >1 sluggish).
 */
export class Spring {
  constructor(freq = 2, zeta = 0.6, x = 0) { this.freq = freq; this.zeta = zeta; this.x = x; this.v = 0; this.target = x; }
  set(x) { this.x = x; this.v = 0; this.target = x; return this; }
  /** Add an instantaneous velocity kick. */
  kick(dv) { this.v += dv; return this; }
  step(dt, target = this.target) {
    this.target = target;
    if (dt <= 0) return this.x;
    const w = TAU * this.freq, z = this.zeta;
    const x0 = this.x - target, v0 = this.v;
    let x, v;
    if (z < 0.9999) {
      const wd = w * Math.sqrt(1 - z * z);
      const e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      const B = (v0 + z * w * x0) / wd;
      x = e * (x0 * c + B * s);
      v = e * ((B * wd - z * w * x0) * c - (x0 * wd + z * w * B) * s);
    } else if (z > 1.0001) {
      const zs = Math.sqrt(z * z - 1);
      const r1 = -w * (z - zs), r2 = -w * (z + zs);
      const c2 = (v0 - r1 * x0) / (r2 - r1), c1 = x0 - c2;
      const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
      x = c1 * e1 + c2 * e2; v = c1 * r1 * e1 + c2 * r2 * e2;
    } else {
      const e = Math.exp(-w * dt), B = v0 + w * x0;
      x = (x0 + B * dt) * e; v = (B - w * (x0 + B * dt)) * e;
    }
    this.x = x + target; this.v = v;
    return this.x;
  }
}

/** Three independent springs on a Vector3. */
export class Spring3 {
  constructor(freq = 2, zeta = 0.6, v = new THREE.Vector3()) {
    this.sx = new Spring(freq, zeta, v.x); this.sy = new Spring(freq, zeta, v.y); this.sz = new Spring(freq, zeta, v.z);
    this.value = v.clone(); this.velocity = new THREE.Vector3();
  }
  set(v) { this.sx.set(v.x); this.sy.set(v.y); this.sz.set(v.z); this.value.copy(v); return this; }
  setParams(freq, zeta) { for (const s of [this.sx, this.sy, this.sz]) { s.freq = freq; s.zeta = zeta; } return this; }
  kick(dv) { this.sx.kick(dv.x); this.sy.kick(dv.y); this.sz.kick(dv.z); return this; }
  step(dt, target) {
    this.value.set(this.sx.step(dt, target.x), this.sy.step(dt, target.y), this.sz.step(dt, target.z));
    this.velocity.set(this.sx.v, this.sy.v, this.sz.v);
    return this.value;
  }
}

/** Deterministic PRNG (mulberry32). `const rnd = rng(42); rnd()` → [0,1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };

/** Smooth 1-D value noise in [-1, 1]; different `seed`s are decorrelated. */
export function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash1(i + seed * 57.31), b = hash1(i + 1 + seed * 57.31);
  return (a + (b - a) * u) * 2 - 1;
}
/** Two-octave fractal version of noise1, still in roughly [-1, 1]. */
export const fbm1 = (t, seed = 0) => noise1(t, seed) * 0.65 + noise1(t * 2.13 + 7.7, seed + 3.1) * 0.35;
