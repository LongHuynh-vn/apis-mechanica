// ─────────────────────────────────────────────────────────────────────────────
// bee/surfaces.js — the body's analytic surfaces
// The thorax and cranium are defined as parametric surfaces. Shells, trim lines,
// rivets and fur are all placed by sampling these, so they always agree.
// (Kept in its own module so thorax.js, head.js and fur.js can share them.)
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { smoothstep } from '../core/math.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ── thorax: a superellipsoid, slightly boxy like a real thorax ───────────────
// Frame: origin at the thorax centre, +Z forward, +Y up, +X the bee's left.
// beltLo / beltHi are the latitudes of the gap between the box and the dorsal lid.
export const THORAX = { rx: 1.62, ry: 1.65, rz: 1.85, e: 0.86, beltLo: 0.512, beltHi: 0.672 };
const S = (t) => Math.sign(t) * Math.pow(Math.abs(t), THORAX.e);

/** Point on the thorax surface. phi: 0 = front (+Z), π/2 = left (+X). lam: latitude, -π/2 bottom … +π/2 top. k scales the radii. */
export function thoraxPoint(phi, lam, out = V3(), k = 1) {
  const cl = S(Math.cos(lam)), sl = S(Math.sin(lam));
  return out.set(THORAX.rx * k * cl * S(Math.sin(phi)), THORAX.ry * k * sl, THORAX.rz * k * cl * S(Math.cos(phi)));
}
/** Outward unit normal of the thorax surface. */
export function thoraxNormal(phi, lam, out = V3()) {
  const a = thoraxPoint(phi - 1e-3, lam), b = thoraxPoint(phi + 1e-3, lam), c = thoraxPoint(phi, lam - 1e-3), d = thoraxPoint(phi, lam + 1e-3);
  return out.crossVectors(b.sub(a), d.sub(c)).normalize();
}
/** Height (y) of the thorax surface at a given latitude — e.g. the belt where the wings hinge. */
export const thoraxHeightAt = (lam) => THORAX.ry * S(Math.sin(lam));

// ── cranium ──────────────────────────────────────────────────────────────────
// Frame: origin at the head centre, face toward +Z, +Y up.
export const HEAD = { rx: 1.58, ry: 1.5, rzFront: 0.82, rzBack: 0.6 };

/** Point on the cranium. phi: 0 = face (+Z), π/2 = left (+X). lam: latitude. */
export function headPoint(phi, lam, out = V3(), k = 1) {
  const sl = Math.sin(lam), cl = Math.cos(lam);
  const w = 0.6 + 0.4 * smoothstep(-0.95, 0.35, sl);                  // narrows toward the mandibles
  const cz = Math.cos(phi), rz = cz > 0 ? HEAD.rzFront : HEAD.rzBack;
  const flat = 1 - 0.1 * Math.pow(Math.max(0, cz), 6) * cl;           // slightly flattened face
  return out.set(HEAD.rx * k * w * cl * Math.sin(phi), HEAD.ry * k * sl, rz * k * flat * cl * cz);
}
/** Outward unit normal of the cranium. */
export function headNormal(phi, lam, out = V3()) {
  const a = headPoint(phi - 1e-3, lam), b = headPoint(phi + 1e-3, lam), c = headPoint(phi, lam - 1e-3), d = headPoint(phi, lam + 1e-3);
  return out.crossVectors(b.sub(a), d.sub(c)).normalize();
}

// Compound-eye footprint on the head (left side; the right is mirrored): fur must stay clear of it.
export const EYE_SEAT = { centre: V3(1.13, 0.17, 0.08), a: 0.47, b: 1.06, c: 0.6 };
