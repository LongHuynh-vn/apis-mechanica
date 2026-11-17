import * as T from 'three';
import { vec, clamp, mix, smooth, damp, TAU, random } from './geometry.js';
import { PLINTH_TOP } from './stage.js';

class Spring {
  constructor(k, d) {
    this.k = k;
    this.d = d;
    this.x = 0;
    this.v = 0;
  }
  step(target, dt) {
    this.v += (this.k * (target - this.x) - this.d * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}
const rollAxis = vec(1, 0, 0),
  yawAxis = vec(0, 1, 0),
  liftAxis = vec(0, 0, 1);
const qYaw = new T.Quaternion(),
  qLift = new T.Quaternion(),
  qPitch = new T.Quaternion(),
  q = new T.Quaternion(),
  unit = vec(1, 1, 1),
  origin = vec(),
  tmpMatrix = new T.Matrix4(),
  tip = vec();
const heel = vec(),
  toe = vec(),
  hip = vec(),
  pinAxis = vec(),
  pinRotation = new T.Quaternion();
// Rotate the coxal pin to absorb contact while keeping each rigid link at its machined length.
function supportFoot(leg) {
  const pivot = leg.pivots[0],
    floor = PLINTH_TOP + 0.012;
  pivot.getWorldPosition(hip);
  pinAxis.copy(rollAxis).applyQuaternion(pivot.parent.getWorldQuaternion(pinRotation));
  for (let pass = 0; pass < 2; pass++) {
    leg.sole.getWorldPosition(heel);
    leg.foot.getWorldPosition(toe);
    const low = heel.y < toe.y ? heel : toe,
      depth = floor - low.y;
    if (depth <= 0.00005) break;
    const slope = pinAxis.z * (low.x - hip.x) - pinAxis.x * (low.z - hip.z);
    if (Math.abs(slope) < 0.06) break;
    pivot.rotation.x += clamp(depth / slope, -0.25, 0.25);
  }
}
function attitude(phase, side, open, amp, turn, power, out) {
  const asym = 1 + side * turn * 0.18,
    angle = phase + side * turn * 0.075;
  out.yaw = -side * (mix(0.29, Math.PI * 0.48, open) + amp * asym * Math.sin(angle));
  out.lift =
    mix(0.095, 0.105, open) + power * (0.16 * Math.sin(2 * angle + 0.06) + 0.04 * Math.cos(angle));
  // Rotation about the span reverses sign as the stroke passes either turning point.
  out.pitch = side * (mix(0.235, 0.07, open) + power * (0.68 * Math.tanh(3.2 * Math.cos(angle))));
  return out;
}
function orientation(a) {
  return q
    .copy(qYaw.setFromAxisAngle(yawAxis, a.yaw))
    .multiply(qLift.setFromAxisAngle(liftAxis, a.lift))
    .multiply(qPitch.setFromAxisAngle(rollAxis, a.pitch));
}
export const tempoFromSlider = (n) => Math.pow(500, n / 100 - 1);
export class FlightController {
  constructor(bee) {
    this.bee = bee;
    this.pos = vec();
    this.vel = vec();
    this.acc = vec();
    this.target = vec();
    this.gust = vec();
    this.evade = vec();
    this.mouse = vec();
    this.rng = random(8627);
    this.restHeight = PLINTH_TOP + 1.003;
    this.goal = false;
    this.progress = 0;
    this.state = 'RESTING';
    this.t = 0;
    this.phase = 0;
    this.gearAngle = 0;
    this.spool = 0;
    this.open = 0;
    this.thrust = 0;
    this.beat = 0;
    this.asym = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.landingFlare = 0;
    this.actualTempo = 1;
    this.tempo = 1;
    this.paused = false;
    this.pauseTime = 4;
    this.nextGust = 1.2;
    this.nextEvade = 0;
    this.evadeArmed = true;
    this.gazeAge = 8;
    this.feelers = [new Spring(49, 8), new Spring(62, 8.7)];
    this.trail = bee.legs.map((_, i) => new Spring(33 + i * 2.8, 6.5 + i * 0.32));
    this.abdYaw = new Spring(23, 6.4);
    this.abdPitch = new Spring(29, 6.0);
    this.neckYaw = new Spring(62, 10.4);
    this.neckRoll = new Spring(53, 10);
    this.tongue = new Spring(42, 10);
    this.tongueOut = false;
    this.curious = 0;
    this.foilMaterials = [...bee.materials.cache.values()].filter((m) =>
      ['forewing', 'hindwing', 'hamuli'].includes(m.userData.part)
    );
    for (const mat of this.foilMaterials) {
      mat.userData.baseAlpha = mat.opacity;
      mat.transparent = true;
      mat.forceSinglePass = true;
    }
    this.angles = { yaw: 0, lift: 0, pitch: 0 };
    this.visiblePower = 0;
  }
  toggle() {
    this.goal = !this.goal;
    this.state = this.goal ? 'WARMING' : 'LANDING';
  }
  observe(nx, ny, proximity, side) {
    this.mouse.set(nx, ny, 0);
    this.gazeAge = 0;
    if (proximity > 0.73) this.evadeArmed = true;
    if (
      this.goal &&
      this.progress > 0.85 &&
      proximity < 0.53 &&
      this.evadeArmed &&
      this.t > this.nextEvade
    ) {
      this.evade.set(side > 0 ? -0.85 : 0.85, 0.27, side * 0.65);
      this.nextEvade = this.t + 2.8;
      this.evadeArmed = false;
    }
  }
  update(dt, frameTime, explode) {
    this.actualTempo = damp(this.actualTempo, this.tempo, 9, dt);
    if (!this.paused) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) this.integrate(sub);
    }
    this.pose(frameTime, explode);
  }
  integrate(dt) {
    const speed = this.actualTempo,
      sim = dt * speed;
    this.t += sim;
    this.gazeAge += dt;
    // The mechanism follows simulated time. The operator can finish a landing in real time.
    this.progress = clamp(this.progress + ((this.goal ? 1 : -1) * dt) / 2.75);
    const p = this.progress;
    this.landingFlare = damp(this.landingFlare, this.goal ? 0 : smooth(0.1, 0.55, p), 5.4, dt);
    const openDesired = smooth(0.2, 0.53, p),
      lift = smooth(0.48, 0.93, p),
      engage = smooth(0.035, 0.34, p);
    this.spool = damp(this.spool, engage, 9, dt);
    this.open = damp(this.open, openDesired, 11, dt);
    this.pauseTime -= sim;
    if (this.pauseTime < 0) {
      this.pauseTime = 4.7 + this.rng() * 4;
      this.curious = 1.3 + this.rng() * 0.8;
    }
    this.curious = Math.max(0, this.curious - sim);
    this.nextGust -= sim;
    if (this.nextGust < 0) {
      this.nextGust = 1.65 + this.rng() * 2.7;
      this.gust.set((this.rng() - 0.5) * 0.9, (this.rng() - 0.48) * 0.42, (this.rng() - 0.5) * 0.9);
    }
    this.gust.multiplyScalar(Math.exp(-sim * 2.1));
    this.evade.multiplyScalar(Math.exp(-sim * 2.6));
    const wander = smooth(0.65, 1, p),
      drift = this.curious > 0 ? 0.38 : 1;
    this.target.set(
      wander * (0.88 * Math.sin(this.t * 0.39) + 0.34 * Math.sin(this.t * 0.85 + 0.3)) * drift,
      lift * (1.03 + 0.16 * Math.sin(this.t * 0.75) + 0.058 * Math.cos(this.t * 2.09)),
      wander * (0.61 * Math.sin(this.t * 0.53 + 0.34) + 0.22 * Math.sin(this.t * 1.19)) * drift
    );
    const physicsDt = dt * (p < 1 || !this.goal ? Math.max(0.88, speed) : speed);
    this.acc
      .copy(this.target)
      .sub(this.pos)
      .multiplyScalar(this.goal ? 12 : 19)
      .addScaledVector(this.vel, this.goal ? -5.4 : -7.2);
    this.acc.addScaledVector(this.gust, lift).addScaledVector(this.evade, lift * 9);
    this.vel.addScaledVector(this.acc, physicsDt);
    this.pos.addScaledVector(this.vel, physicsDt);
    if (!this.goal && p === 0 && this.pos.lengthSq() < 0.000007 && this.vel.lengthSq() < 0.00006) {
      this.pos.set(0, 0, 0);
      this.vel.set(0, 0, 0);
      this.state = 'RESTING';
    }
    if (this.goal && p >= 0.998) this.state = 'IN FLIGHT';
    const demand = clamp(
      0.52 + 0.26 * this.vel.y + 0.075 * this.acc.length() + 0.07 * Math.sin(this.t * 1.38),
      0.2,
      1.16
    );
    this.thrust = damp(this.thrust, demand * engage, 7, dt);
    this.beat = this.spool * (211 + 34 * demand);
    this.phase = (this.phase + TAU * this.beat * sim) % TAU;
    this.gearAngle = (this.gearAngle + (TAU * this.beat * sim) / 24) % (TAU * 4);
    this.asym = damp(
      this.asym,
      clamp(this.acc.z * 0.6 + this.vel.z * 0.64 + Math.sin(this.t * 0.83) * 0.12, -1, 1) * lift,
      6,
      physicsDt
    );
    const brake = !this.goal ? smooth(0.28, 0.82, p) * 0.18 : 0;
    this.pitch = damp(
      this.pitch,
      clamp(-this.acc.x * 0.074 - this.vel.x * 0.11, -0.17, 0.17) * lift - brake,
      4.2,
      physicsDt
    );
    this.roll = damp(
      this.roll,
      clamp(this.asym * 0.32 + this.gust.z * 0.11 * lift, -0.3, 0.3),
      5.3,
      physicsDt
    );
    this.yaw = damp(
      this.yaw,
      (this.vel.z * 0.29 +
        Math.sin(this.t * 0.72) * 0.18 +
        (this.curious > 0 ? Math.sin(this.t * 1.8) * 0.14 : 0)) *
        lift,
      3.8,
      physicsDt
    );
    const tracking = Math.exp(-Math.max(0, this.gazeAge - 2) * 0.58);
    this.neckYaw.step(
      this.mouse.x * 0.19 * tracking - this.yaw * 0.24 + Math.sin(this.t * 0.88) * 0.026,
      physicsDt
    );
    this.neckRoll.step(-this.roll * 0.83 + this.mouse.y * 0.045 * tracking, physicsDt);
    this.abdYaw.step(-this.vel.z * 0.16 - this.asym * 0.08, physicsDt);
    this.abdPitch.step(this.vel.y * 0.08 - this.pitch * 0.64, physicsDt);
    for (let i = 0; i < 2; i++)
      this.feelers[i].step(
        (this.mouse.x * 0.1 + (i ? 1 : -1) * this.mouse.y * 0.052) * tracking +
          this.vel.z * (i ? 0.12 : -0.1) +
          Math.sin(this.t * (i ? 2.15 : 1.81) + i * 2) * 0.035,
        physicsDt
      );
    for (let i = 0; i < this.trail.length; i++)
      this.trail[i].step(
        this.vel.x * 0.15 +
          this.vel.y * 0.12 +
          this.gust.z * 0.1 * lift +
          Math.sin(this.t * (2 + i * 0.07) + i * 1.21) * 0.017 * lift,
        physicsDt
      );
    this.tongue.step(this.tongueOut ? 1 : 0, dt);
  }
  pose(frameTime, explode) {
    const b = this.bee,
      p = this.progress,
      t = this.t,
      ph = this.phase,
      opening = this.open;
    const warm = Math.sin(Math.PI * smooth(0.045, 0.54, p)) * this.spool;
    const tremor = Math.sin(t * 97) * warm * 0.009;
    const compression = Math.sin(Math.PI * smooth(0.29, 0.64, p)) ** 2;
    this.displayLift = 0.92 * smooth(0, 0.95, explode);
    b.root.position.copy(this.pos);
    b.root.position.y += this.restHeight + tremor - compression * 0.072 + this.displayLift;
    b.chassis.rotation.set(
      this.roll + warm * 0.006 * Math.sin(t * 79),
      this.yaw,
      this.pitch,
      'YXZ'
    );
    b.head.rotation.set(
      this.neckRoll.x,
      this.neckYaw.x,
      -this.pitch * 0.66 + 0.016 * Math.sin(t * 1.37),
      'YXZ'
    );
    b.abdomen.rotation.set(
      -this.roll * 0.17,
      this.abdYaw.x,
      this.abdPitch.x - 0.018 + 0.014 * Math.sin(t * 1.23),
      'YXZ'
    );
    for (let i = 0; i < b.rings.length; i++)
      b.rings[i].position.x = 0.0045 * i * Math.sin(t * 1.56 - i * 0.105);
    for (const [i, a] of b.antennae.entries()) {
      const twitch =
        Math.pow(Math.max(0, Math.sin(t * 0.89 + i * 2.4 - 2.2)), 16) *
        Math.sin(t * 13.9 + i) *
        0.084;
      a.scape.rotation.set(
        a.s * (0.021 * Math.sin(t * 1.86 + i) + this.feelers[i].x * 0.42),
        this.feelers[i].x,
        a.s * 0.008 + twitch + 0.019 * Math.sin(t * 1.62 + i * 1.8)
      );
      for (let j = 0; j < a.joints.length; j++)
        a.joints[j].rotation.set(
          0.009 * Math.sin(t * 2.1 + i + j * 0.3),
          this.feelers[i].x * 0.125,
          0.009 * Math.sin(t * 2 + i + j * 0.38) + twitch * 0.041
        );
    }
    const push = Math.sin(Math.PI * smooth(0.37, 0.65, p)) * 0.14,
      flight = smooth(0.55, 0.85, p);
    for (const [k, leg] of b.legs.entries()) {
      const { pivots: js, s, i } = leg,
        h = this.trail[k].x,
        hind = i === 2;
      js[0].rotation.x = s * ((hind ? 0.09 : -0.23) * flight - push * 0.36);
      js[1].rotation.z = flight * (hind ? -0.02 : 0.03) + h * 0.3;
      js[2].rotation.z =
        (hind ? -0.21 : -0.57) * flight -
        h * 0.6 +
        push * (hind ? -0.6 : 0.45) -
        this.landingFlare * 0.19 * flight;
      js[3].rotation.z = (hind ? 0.31 : 1.65) * flight + h * 0.92 - push * 0.62;
      js[4].rotation.z = (hind ? 0.04 : 1.33) * flight + 0.33 * h;
      if (this.pos.y + this.displayLift < 0.52) supportFoot(leg);
    }
    b.plates.scale.y = 1 + 0.012 * this.spool * Math.sin(ph) + warm * 0.005 * Math.sin(t * 73);
    b.scutellum.rotation.z = 0.01 * this.spool * Math.sin(ph - 0.22);
    for (const [i, s] of b.springs.entries())
      s.scale.y = 1 + 0.052 * this.spool * Math.sin(ph + i * 0.07);
    for (const g of b.gears) g.wheel.rotation.z = g.phase + g.ratio * this.gearAngle;
    for (const link of b.escapements) {
      const a = this.gearAngle,
        x = -0.5 + 0.112 * Math.cos(a),
        y = 0.025 + 0.112 * Math.sin(a);
      link.pivot.rotation.z = 0.14 * this.spool * Math.sin(ph) - 0.09 * Math.cos(a);
      const endX = -0.63 + 0.07 * Math.cos(link.pivot.rotation.z),
        endY = 0.25 + 0.07 * Math.sin(link.pivot.rotation.z);
      link.rod.position.set(x, y, link.z);
      link.rod.rotation.z = Math.atan2(endY - y, endX - x) - Math.PI * 0.5;
      link.rod.scale.y = Math.hypot(endX - x, endY - y);
    }
    for (const f of b.fur) f.g.rotation.x = 0.008 * Math.sin(t * 5.2 + f.seed) * (0.2 + this.spool);
    b.tongue.rotation.z = -this.tongue.x * 2.04;
    b.glossa.position.x = 0.32 + this.tongue.x * 0.17;
    const power = this.spool * Math.min(1, 0.1 * warm + opening),
      amplitude = (Math.PI / 4) * power * (0.91 + 0.17 * this.thrust);
    const cycles = this.beat * this.actualTempo * frameTime,
      blur = smooth(0.035, 0.77, cycles) * power * (1 - smooth(0.25, 0.8, explode));
    this.visiblePower = power;
    for (const m of this.foilMaterials) m.opacity = m.userData.baseAlpha * (1 - blur * 0.94);
    for (const wing of b.wings) {
      const { s, sweepAxis, stroke, coupled, ghosts, trace } = wing;
      const a = attitude(ph, s, opening, amplitude, this.asym, power, this.angles);
      sweepAxis.rotation.y = a.yaw;
      stroke.rotation.z = a.lift;
      coupled.rotation.x = a.pitch;
      ghosts.visible = blur > 0.015;
      ghosts.material.opacity = 0.024 * blur;
      ghosts.material.color
        .copy(b.materials.colors.glass)
        .lerp(b.materials.colors.lines, b.materials.uniforms.draw.value);
      if (ghosts.visible) {
        const shutter = Math.min(1, cycles) * TAU;
        const end = mix(ph, Math.PI + 0.045 * Math.sin(t * 3), smooth(0.65, 1, cycles));
        for (let j = 0; j < ghosts.count; j++) {
          const sample = end - (shutter * (j + 0.42)) / ghosts.count;
          const rot = orientation(
            attitude(sample, s, opening, amplitude, this.asym, power, this.angles)
          );
          tmpMatrix.compose(origin, rot, unit);
          ghosts.setMatrixAt(j, tmpMatrix);
        }
        ghosts.instanceMatrix.needsUpdate = true;
      }
      trace.visible = power > 0.27 && explode < 0.7;
      trace.material.opacity = power * (0.14 + 0.49 * (1 - blur)) * (1 - explode);
      trace.material.color.copy(b.materials.colors.lines);
      if (trace.visible) {
        const attr = trace.geometry.attributes.position;
        for (let j = 0; j < wing.count; j++) {
          const pp = ph - TAU * (1 - j / (wing.count - 1)) * 0.97;
          tip
            .copy(wing.tip)
            .applyQuaternion(
              orientation(attitude(pp, s, opening, amplitude, this.asym, power, this.angles))
            );
          attr.setXYZ(j, tip.x, tip.y, tip.z);
        }
        attr.needsUpdate = true;
      }
    }
  }
}
