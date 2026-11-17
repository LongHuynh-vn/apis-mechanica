import { Vector3 } from 'three'

export const TAU = Math.PI * 2
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
export const mix = (a, b, t) => a + (b - a) * t
export const ramp = (a, b, x) => clamp((x - a) / (b - a))
export const smooth = (a, b, x) => {
  const t = ramp(a, b, x)
  return t * t * (3 - 2 * t)
}
export const ease = (x) => x * x * x * (x * (6 * x - 15) + 10)
export const damp = (a, b, rate, dt) => mix(a, b, 1 - Math.exp(-rate * dt))
export const angleBetween = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
export const vec = (p) => p instanceof Vector3 ? p : new Vector3(...p)

export function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

// Exact underdamped spring step for a constant target over dt.
export class Spring {
  constructor(value, frequency, damping = .71) {
    this.value = value
    this.velocity = 0
    this.frequency = frequency
    this.damping = damping
  }

  step(target, dt) {
    const omega = this.frequency * TAU
    const decay = this.damping * omega
    const angular = omega * Math.sqrt(1 - this.damping ** 2)
    const sine = Math.sin(angular * dt)
    const cosine = Math.cos(angular * dt)
    const envelope = Math.exp(-decay * dt)
    const offset = this.value - target
    const coefficient = (this.velocity + decay * offset) / angular
    const oscillation = offset * cosine + coefficient * sine
    this.velocity = envelope * (angular * (-offset * sine + coefficient * cosine) - decay * oscillation)
    this.value = target + envelope * oscillation
    return this.value
  }
}
