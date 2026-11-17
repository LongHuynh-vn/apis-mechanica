import { Vector3 } from 'three'
import { angleBetween, clamp, damp, mix, randomGenerator, smooth, Spring, TAU } from './math.js'
import { dimensions } from './specimen/parts.js'

export const restHeight = 1.394
export const plinthTop = .172
const takeoffTime = 2.62
const landingTime = 2.81

export class FlightController {
  constructor() {
    this.position = new Vector3(0, restHeight, 0)
    this.velocity = new Vector3()
    this.guidance = new Vector3()
    this.waypoint = new Vector3(.78, restHeight + 1.30, .55)
    this.goal = new Vector3()
    this.wind = new Vector3()
    this.evasion = new Vector3()
    this.restY = restHeight
    this.mode = 'RESTING'
    this.elapsed = 0
    this.time = 0
    this.flightTime = 0
    this.rate = 0
    this.nextGust = 3.2
    this.cooldown = 0
    this.dwell = 0
    this.ensemble = randomGenerator(5208)
    this.direction = 0
    this.scanDirection = .27
    this.yaw = 0
    this.pitch = 0
    this.bank = 0
    this.curious = 0
    this.fold = 1
    this.drive = 0
    this.gear = 0
    this.warm = 0
    this.power = 0
    this.compression = 0
    this.beat = dimensions.beat
    this.stroke = dimensions.stroke * Math.PI / 360
    this.balance = 0
    this.acceleration = 0
    this.phase = 0
    this.phaseStep = 0
    this.shaft = .43
    this.yawSpring = new Spring(0, 1.15, .81)
    this.bankSpring = new Spring(0, 1.78, .70)
    this.pitchSpring = new Spring(0, 1.66, .75)
  }

  get airborne() {
    return this.mode === 'WARMING' || this.mode === 'IN FLIGHT'
  }

  toggle() {
    const go = !this.airborne
    this.start = {
      y: this.position.y, fold: this.fold, drive: this.drive, gear: this.gear, power: this.power,
      warm: this.warm, yaw: this.yaw,
    }
    this.mode = go ? 'WARMING' : 'LANDING'
    this.elapsed = 0
    if (go && this.position.y < restHeight + .12) this.flightTime = 0
    if (go) this.waypoint.set(.93, restHeight + 1.34, .62)
    this.dwell = 0
    this.evasion.multiplyScalar(.55)
  }

  evade(away, urgency) {
    if (this.mode !== 'IN FLIGHT' || this.cooldown > 0) return
    this.cooldown = 2.3 + this.ensemble() * .95
    const impulse = this.evasion.length() * .20 + .77 + urgency * 1.02
    this.evasion.copy(away).normalize().multiplyScalar(impulse)
    this.evasion.y = .16 + urgency * .30
  }

  chooseWaypoint() {
    const r = this.ensemble
    const direction = this.direction += .92 + r() * 2.30
    const range = mix(.52, 1.65, r())
    this.waypoint.set(Math.cos(direction) * range, restHeight + mix(.98, 1.84, r()), Math.sin(direction) * range * .78)
    this.scanDirection = -.66 + r() * 1.32
    this.dwell = 0
  }

  update(wallDt, tempo, paused) {
    if (paused) {
      this.phaseStep = 0
      return 0
    }
    const speed = .17 + .83 * Math.sqrt(tempo)
    const simDt = wallDt * speed
    const startPhase = this.phase
    const count = Math.max(1, Math.ceil(wallDt * 100))
    for (let i = 0; i < count; i++) this.integrate(simDt / count, wallDt * tempo / count)
    this.phaseStep = this.phase - startPhase
    if (this.phase > TAU * 4096) this.phase %= TAU
    return simDt
  }

  integrate(dt, wingDt) {
    this.time += dt
    this.elapsed += dt
    const t = this.elapsed
    const time = this.time
    let fold = 1
    let drive = 0
    let gear = 0
    let warm = 0
    let power = 0
    let flare = 0
    let compression = 0
    let heading = 0
    let gain = 17
    let damping = 8
    const start = this.start
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.wind.multiplyScalar(Math.exp(-dt * 2.6))
    this.evasion.multiplyScalar(Math.exp(-dt * 1.43))
    this.goal.set(0, restHeight, 0)
    if (this.mode !== 'RESTING') this.flightTime += dt

    if (this.mode === 'WARMING') {
      const highStart = smooth(.08, .9, start.y - restHeight)
      const flex = smooth(.40, .75, t) * (1 - smooth(1.12, 1.50, t)) * (1 - highStart)
      const launch = smooth(1.23 - highStart * .83, 2.46 - highStart * .44, t)
      power = mix(start.power, 1, smooth(.04, 1.72, t))
      warm = mix(start.warm, 1, smooth(.22, .62, t)) * (1 - smooth(1.29, 2.10, t))
      fold = mix(start.fold, 0, smooth(.72 - highStart * .67, 1.60, t))
      drive = mix(start.drive, .095, smooth(.37, .78, t) * (1 - highStart)) + (1 - Math.max(start.drive * highStart, .095)) * smooth(1.09 - highStart * .87, 1.97, t)
      gear = mix(start.gear, 1, smooth(1.42 - highStart * .63, 2.21, t))
      this.goal.set(this.waypoint.x * launch * .73, mix(start.y, this.waypoint.y, launch) - flex * .105, this.waypoint.z * launch * .76)
      flare = -.085 * (smooth(1.32, 1.53, t) - smooth(1.73, 2.34, t))
      compression = flex
      gain = 26
      damping = 8.9
      if (t > takeoffTime) {
        this.mode = 'IN FLIGHT'
        this.elapsed = 0
      }
    } else if (this.mode === 'IN FLIGHT') {
      fold = 0
      gear = 1
      drive = 1
      power = 1
      gain = 7.15
      damping = 4.95
      if (this.position.distanceToSquared(this.waypoint) < .31) {
        this.dwell += dt
        if (this.dwell > 2.15) this.chooseWaypoint()
      }
      if (time >= this.nextGust) {
        const r = this.ensemble
        this.wind.set((r() - .5) * 2.5, (r() - .44) * 1.2, (r() - .5) * 2.8)
        this.nextGust = time + 1.35 + r() * 4.6
      }
      this.goal.copy(this.waypoint).add(this.evasion)
      this.goal.x += .097 * Math.sin(time * 2.27) + .043 * Math.sin(time * 5.41)
      this.goal.y += .065 * Math.sin(time * 3.75) + .032 * Math.sin(time * 6.37 + .7)
      this.goal.z += .069 * Math.sin(time * 2.74 + .5)
      const motion = smooth(.055, .55, Math.hypot(this.velocity.x, this.velocity.z))
      const scan = .38 * Math.sin(time * 1.34) + this.scanDirection
      const bearing = Math.atan2(this.velocity.x, this.velocity.z)
      heading = this.yaw + angleBetween(this.yaw, scan) * (1 - motion) + angleBetween(this.yaw, bearing) * motion
      this.curious = damp(this.curious, (1 - motion) * Math.sin(time * 1.4 + .9), 4, dt)
    } else if (this.mode === 'LANDING') {
      const descent = smooth(.12, 1.83, t)
      const settle = smooth(1.55, 1.89, t) - smooth(2.16, 2.60, t)
      fold = mix(start.fold, 1, smooth(1.79, 2.61, t))
      drive = start.drive * (1 - smooth(1.36, 2.40, t))
      power = start.power * (1 - smooth(1.59, 2.67, t))
      gear = start.gear * (1 - smooth(.49, 1.46, t))
      warm = start.warm * (1 - smooth(0, .72, t))
      this.goal.y = mix(start.y, restHeight, descent) - .108 * settle
      flare = -.17 * (smooth(.27, .95, t) - smooth(1.43, 2.28, t)) * smooth(.04, .43, start.y - restHeight)
      compression = settle
      heading = mix(start.yaw, start.yaw + angleBetween(start.yaw, 0), smooth(.05, 1.64, t))
      gain = mix(11, 27, smooth(.36, 1.29, t))
      damping = mix(6.1, 9.1, smooth(.36, 1.29, t))
      this.curious = damp(this.curious, 0, 3, dt)
      if (t > landingTime) {
        this.mode = 'RESTING'
        this.elapsed = 0
      }
    } else {
      this.goal.y += .009 * Math.sin(time * 2.75 + .3)
      this.curious = damp(this.curious, .15 * Math.sin(time * 1.03), 2, dt)
    }

    this.guidance.copy(this.goal).sub(this.position).multiplyScalar(gain).addScaledVector(this.velocity, -damping)
    this.guidance.clampLength(0, 10.1)
    this.velocity.addScaledVector(this.guidance, dt).addScaledVector(this.wind, dt * gear)
    this.position.addScaledVector(this.velocity, dt)

    const yawGoal = this.yaw + angleBetween(this.yaw, heading)
    const last = this.yaw
    this.yaw = this.yawSpring.step(yawGoal, dt)
    const right = this.guidance.x * Math.cos(this.yaw) - this.guidance.z * Math.sin(this.yaw)
    const forward = this.guidance.z * Math.cos(this.yaw) + this.guidance.x * Math.sin(this.yaw)
    const steer = drive * smooth(.12, .89, this.position.y - restHeight)
    this.bank = this.bankSpring.step(clamp(-right * .134 * steer, -.40, .40), dt)
    this.pitch = this.pitchSpring.step(clamp(forward * .093 * steer + flare, -.26, .28), dt)
    this.acceleration = damp(this.acceleration, clamp(forward * .28, -1, 1), 5.2, dt)
    this.rate = damp(this.rate, (this.yaw - last) / Math.max(dt, .001), 6.4, dt)
    this.balance = damp(this.balance, clamp((this.rate * .55 - right * .135) * steer, -.76, .76), 7, dt)
    const thrust = clamp(this.guidance.y * .13 + Math.hypot(this.guidance.x, this.guidance.z) * .058, -.29, .48)
    this.beat = damp(this.beat, dimensions.beat + (thrust * 21 + 3.1 * Math.sin(time * 2.61)) * drive, 4, dt)
    this.stroke = damp(this.stroke, (dimensions.stroke * Math.PI / 360) * (1 + thrust * .31 * drive), 5, dt)

    this.fold = damp(this.fold, fold, 15, dt)
    this.drive = damp(this.drive, clamp(drive), 14, dt)
    this.gear = damp(this.gear, gear, 13, dt)
    this.warm = damp(this.warm, warm, 14, dt)
    this.power = damp(this.power, power, 8, dt)
    this.compression = damp(this.compression, compression, 13, dt)
    const beatRate = this.beat * (.195 * this.warm + .805 * this.drive + .195 * this.drive ** 2)
    this.phase += wingDt * TAU * beatRate
    this.shaft = (this.shaft + dt * this.power * (7.9 + thrust * 3)) % (TAU * 20)
  }
}
