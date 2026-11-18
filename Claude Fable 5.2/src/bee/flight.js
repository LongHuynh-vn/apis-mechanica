// ─────────────────────────────────────────────────────────────────────────────
// bee/flight.js — FLIGHT CONTROLLER
// A small physics + control simulation, not an animation loop.
//
//   steering   wander waypoints → desired velocity (arrive) → acceleration demand
//   attitude   the demand is met the way a real insect meets it: by tilting the
//              thrust vector. Roll and pitch chase their set-points through
//              under-damped springs, and the ACTUAL acceleration is derived from
//              the ACTUAL attitude — so the body banks into turns, noses down to
//              accelerate, flares to brake, overshoots a little and recovers.
//   wings      beat frequency and stroke amplitude follow thrust demand; roll and
//              yaw torque come from left/right amplitude asymmetry.
//   ground     on the plinth the body rides a sprung suspension; take-off and
//              landing only ever set targets for continuous parameters, so the
//              sequence can be reversed at any instant without a pop.
// Units: cm, seconds, radians. All integration uses the scaled sim dt.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { DIMS } from '../core/dims.js';
import { FLIGHT, SPEC, state, actions } from '../core/state.js';
import { Spring, Spring3, clamp, lerp, smoothstep, fbm1, noise1, angleDelta, TAU, DEG, rng } from '../core/math.js';

export const HOVER_PITCH = 0.33;           // nose-up body angle in hover (rad); the stroke plane is level then
const G = 210;                             // tilt ↔ acceleration scale (cm/s² per unit tangent)
const REST = new THREE.Vector3(DIMS.beeRest.x, DIMS.beeRest.y, DIMS.beeRest.z);

export function createFlight() {
  const rnd = rng(77);
  const f = {
    mode: 'rest',                          // rest | warm | fly | approach | descend | settle
    pos: REST.clone(), vel: new THREE.Vector3(), acc: new THREE.Vector3(),
    yaw: 0, pitch: 0, roll: 0,             // pitch: + nose up; roll: + left wing up
    yawRate: 0, pitchRate: 0, rollRate: 0,
    accBody: new THREE.Vector3(),          // acceleration felt in the body frame (drives secondary motion)
    // continuous sequence parameters
    fold: 1, gain: 0, shiver: 0, motor: 0, plant: 1, airborne: 0, reach: 0,
    // wings
    phase: 0, dPhase: 0, beatHz: SPEC.beatHz, ampL: 45 * DEG, ampR: 45 * DEG, meanL: 0.06, meanR: 0.06, thrust: 0,
    planeTilt: HOVER_PITCH,
    // behaviour
    target: new THREE.Vector3(), hovering: false, scan: 0, look: new THREE.Vector3(0, 6, 30), alert: 0,
    evadeCount: 0, gustLevel: 0, justLanded: false, justLifted: false, seqT: 0,
  };

  const sFold = new Spring(1.15, 1, 1), sGain = new Spring(1.7, 1, 0), sShiver = new Spring(3.2, 1, 0), sMotor = new Spring(1.3, 1, 0);
  const sPlant = new Spring(3.0, 1, 1), sAir = new Spring(0.9, 1, 0);
  const sPitch = new Spring(2.3, 0.6, 0), sRoll = new Spring(2.7, 0.52, 0), sYaw = new Spring(0.85, 0.9, 0), sThrust = new Spring(3.0, 0.8, 0);
  const sOff = new Spring3(3.1, 0.42, new THREE.Vector3());           // suspension: body offset from the resting pose
  const offTarget = new THREE.Vector3();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3(), vDes = new THREE.Vector3(), aCmd = new THREE.Vector3(), gust = new THREE.Vector3(), evade = new THREE.Vector3();
  let simT = 0, hoverLeft = 0, cruise = 24, gustT = 3, gustEnv = 0, gustDir = new THREE.Vector3(), evadeEnv = 0, evadeCool = 0, scanPhase = 0, wanderSeed = 0, flickT = 6;

  const C = DIMS.flightCentre, R = DIMS.flightRadii;
  function pickWaypoint(curious = false, camPos = null) {
    for (let i = 0; i < 12; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()), h = (rnd() * 2 - 1);
      tmp.set(C.x + Math.cos(a) * r * R.x, C.y + h * R.y * 0.85, C.z + Math.sin(a) * r * R.z);
      if (curious && camPos) {            // drift toward the viewer for a look
        tmp.set(camPos.x, 0, camPos.z).normalize().multiplyScalar(lerp(4, 8, rnd())).add(new THREE.Vector3(C.x + (rnd() - 0.5) * 6, C.y + (rnd() - 0.5) * 4, C.z));
      }
      if (tmp.distanceTo(f.pos) > 7) break;
    }
    f.target.copy(tmp);
    cruise = lerp(16, 34, rnd());
    f.hovering = false;
    wanderSeed = rnd() * 100;
  }

  function setStatus() {
    actions.setFlightStatus(f.mode === 'rest' ? FLIGHT.RESTING : f.mode === 'warm' ? FLIGHT.WARMING : f.mode === 'fly' ? FLIGHT.IN_FLIGHT : FLIGHT.LANDING);
  }

  /**
   * @param {number} dt   scaled sim seconds (0 when paused)
   * @param {object} inp  wantFlight, canFly, camera, pointer {nx, ny, active}, viewportH
   */
  function update(dt, inp) {
    f.justLanded = false; f.justLifted = false;
    simT += dt;
    const want = inp.wantFlight && inp.canFly;
    const grounded = f.mode === 'rest' || f.mode === 'warm' || f.mode === 'settle';

    // ── sequence logic: only ever sets targets ───────────────────────────────
    let foldT = 1, gainT = 0, shiverT = 0, motorT = 0, plantT = 1, airT = 0;
    offTarget.set(0, 0, 0);
    if (f.mode === 'rest') {
      if (want) { f.mode = 'warm'; f.seqT = 0; }
      else if (inp.canFly) {                                                        // idle life: now and then the wings flick open a few degrees and resettle
        flickT -= dt;
        if (flickT <= 0) { flickT = lerp(7, 17, rnd()); sFold.kick(-(0.8 + rnd() * 0.8)); f.alert = Math.max(f.alert, 0.35); }
      }
    } else if (f.mode === 'warm') {
      f.seqT += dt;
      motorT = 1;
      shiverT = f.seqT > 0.28 && f.seqT < 1.2 ? 1 : 0;
      foldT = f.seqT > 1.1 ? 0 : 1;
      gainT = f.seqT > 1.72 && f.fold < 0.3 ? 1 : 0;
      if (f.seqT > 1.74 && f.seqT < 2.14) offTarget.y = -0.34;                     // crouch: the legs load up
      else if (f.seqT >= 2.14) offTarget.y = 0.3;                                  // …and push off
      if (!want) { f.mode = 'settle'; }
      else if (f.seqT > 2.26 && f.gain > 0.84) {                                   // lift-off: hand the body to the flight dynamics
        f.mode = 'fly'; f.justLifted = true;
        f.pos.copy(REST).add(sOff.value); f.vel.copy(sOff.velocity).setY(Math.max(sOff.velocity.y, 0) + 9);
        sPitch.x = f.pitch; sPitch.v = 0; sRoll.x = f.roll; sRoll.v = 0; sYaw.x = f.yaw; sYaw.v = 0; sThrust.set(40);
        f.target.set(REST.x + (rnd() - 0.5) * 5, C.y - 1 + rnd() * 2, REST.z + 2 + rnd() * 3); cruise = 20; f.hovering = false; hoverLeft = 0;
      }
    } else if (f.mode === 'settle') {
      motorT = f.fold > 0.9 ? 0 : 1;
      gainT = 0; foldT = f.gain < 0.14 ? 1 : 0; plantT = 1;
      if (want) { f.mode = 'warm'; f.seqT = f.fold < 0.5 ? 1.2 : 0.25; }
      else if (f.fold > 0.992 && f.motor < 0.03 && sOff.velocity.length() < 0.3 && Math.abs(sPitch.v) < 0.05) { f.mode = 'rest'; f.alert = 1; flickT = lerp(6, 12, rnd()); }
    } else {                                                                        // airborne
      motorT = 1; foldT = 0; gainT = 1; airT = 1; plantT = 0;
      if (f.mode === 'fly' && !want) { f.mode = 'approach'; }
      else if ((f.mode === 'approach' || f.mode === 'descend') && want) { f.mode = 'fly'; pickWaypoint(); }
    }

    f.fold = clamp(sFold.step(dt, foldT)); f.gain = clamp(sGain.step(dt, gainT)); f.shiver = clamp(sShiver.step(dt, shiverT)); f.motor = clamp(sMotor.step(dt, motorT));

    // ── wing-beat clock ───────────────────────────────────────────────────────
    f.dPhase = TAU * f.beatHz * dt;
    f.phase += f.dPhase;

    if (grounded) {
      // ── on the plinth: sprung suspension about the resting pose ────────────
      offTarget.y += f.gain * 0.14;                                                // wings take some weight before lift-off
      const buzz = f.shiver * 0.012 + f.gain * 0.01;
      offTarget.x += Math.sin(f.phase * 0.37) * buzz; offTarget.y += Math.sin(f.phase * 0.53) * buzz * 0.6;
      const idle = 1 - f.motor;                                                    // standing is never perfectly still: slow weight shifts flex the legs
      offTarget.x += fbm1(simT * 0.23, 61) * 0.055 * idle; offTarget.y += fbm1(simT * 0.27, 71) * 0.04 * idle; offTarget.z += fbm1(simT * 0.19, 67) * 0.07 * idle;
      sOff.step(dt, offTarget);
      f.pos.copy(REST).add(sOff.value);
      f.vel.copy(sOff.velocity);
      f.acc.set(0, 0, 0);
      f.pitch = sPitch.step(dt, f.gain * 0.06 + fbm1(simT * 0.21, 73) * 0.012 * idle); f.roll = sRoll.step(dt, fbm1(simT * 0.17, 79) * 0.01 * idle); f.yaw = sYaw.step(dt, sYaw.x + angleDelta(sYaw.x, 0));
      f.pitchRate = sPitch.v; f.rollRate = sRoll.v; f.yawRate = sYaw.v;
      f.thrust = f.gain * 0.9;
      f.beatHz = SPEC.beatHz * lerp(0.9, 1.0, f.gain) * (1 + f.shiver * 0.04 * Math.sin(simT * 9));
      f.ampL = f.ampR = 45 * DEG * lerp(0.7, 0.96, f.gain); f.meanL = f.meanR = 0.06;
      f.accBody.set(sOff.sx.v * 0, -sOff.velocity.y * 2, 0);
    } else {
      // ── steering ───────────────────────────────────────────────────────────
      let vMax = cruise, flare = 0, yawGoal = null;
      const alt = f.pos.y - REST.y;
      if (f.mode === 'fly') {
        tmp.subVectors(f.target, f.pos);
        if (!f.hovering && tmp.length() < 1.6) { f.hovering = true; hoverLeft = rnd() < 0.3 ? lerp(1.8, 3.2, rnd()) : lerp(0.3, 1.2, rnd()); scanPhase = rnd() * TAU; f.scan = hoverLeft > 1.6 ? lerp(0.35, 0.75, rnd()) : 0; }
        if (f.hovering) { hoverLeft -= dt; if (hoverLeft <= 0) pickWaypoint(rnd() < 0.22, inp.camera?.position); }
      } else if (f.mode === 'approach') {
        f.target.set(REST.x, REST.y + 3.1, REST.z); vMax = 15; yawGoal = 0;
        tmp.subVectors(f.target, f.pos);
        if (Math.hypot(tmp.x, tmp.z) < 0.8 && Math.abs(tmp.y) < 1.2 && f.vel.length() < 7 && Math.abs(angleDelta(f.yaw, 0)) < 0.2) f.mode = 'descend';
      } else if (f.mode === 'descend') {
        f.target.set(REST.x, REST.y - 2.6, REST.z); vMax = lerp(5, 8.5, smoothstep(0.3, 2.5, alt)); yawGoal = 0; flare = 0.16 * smoothstep(3.2, 0.6, alt);
        plantT = smoothstep(2.6, 0.5, alt);
        if (alt <= 0.1) {                                                           // touchdown: hand the body to the suspension
          f.mode = 'settle'; f.justLanded = true;
          sOff.set(tmp.subVectors(f.pos, REST)); sOff.kick(f.vel);
          sPitch.x = f.pitch; sRoll.x = f.roll; sYaw.x = f.yaw;
          plantT = 1;
        }
      }
      tmp.subVectors(f.target, f.pos);
      const dist = tmp.length();
      vDes.copy(tmp).multiplyScalar(dist > 1e-4 ? Math.min(vMax, dist * 1.7) / dist : 0);
      if (f.mode === 'fly' && !f.hovering) {                                       // curl-ish meander so paths are never straight
        vDes.x += fbm1(simT * 0.31, wanderSeed) * 5.5; vDes.y += fbm1(simT * 0.27, wanderSeed + 9) * 3; vDes.z += fbm1(simT * 0.29, wanderSeed + 17) * 5.5;
      }
      if (f.hovering) {                                                            // station-keeping: tiny corrective drifts
        vDes.x += noise1(simT * 0.9, 31) * 1.3; vDes.y += noise1(simT * 1.3, 37) * 0.9; vDes.z += noise1(simT * 0.8, 41) * 1.3;
      }
      // keep inside the flight volume (soft wall)
      tmp.set((f.pos.x - C.x) / (R.x * 1.15), (f.pos.y - C.y) / (R.y * 1.3), (f.pos.z - C.z) / (R.z * 1.15));
      const out = tmp.length();
      if (out > 1 && f.mode === 'fly') vDes.addScaledVector(tmp.normalize(), -(out - 1) * 40);
      if (f.mode !== 'descend' && f.pos.y < DIMS.plinthTopY + 3.4 && Math.hypot(f.pos.x, f.pos.z) > 1.5) vDes.y = Math.max(vDes.y, 6);

      aCmd.subVectors(vDes, f.vel).multiplyScalar(2.5);

      // ── disturbances: wind + the cursor getting too close ──────────────────
      gustT -= dt;
      if (gustT <= 0 && f.mode === 'fly') { gustT = lerp(2.6, 7, rnd()); gustEnv = 1; const a = rnd() * TAU; gustDir.set(Math.cos(a), (rnd() - 0.5) * 0.5, Math.sin(a)).multiplyScalar(lerp(34, 62, rnd())); sRoll.kick((rnd() - 0.5) * 2.2); sPitch.kick((rnd() - 0.5) * 1.2); }
      gustEnv = Math.max(0, gustEnv - dt / 0.55);
      const ge = Math.sin(gustEnv * Math.PI) ** 2;
      gust.set(fbm1(simT * 0.43, 1), fbm1(simT * 0.37, 2) * 0.5, fbm1(simT * 0.41, 3)).multiplyScalar(7).addScaledVector(gustDir, ge);
      f.gustLevel = ge;

      evadeCool -= dt;
      if (inp.pointer?.active && inp.camera && f.mode === 'fly' && evadeCool <= 0) {
        tmp.copy(f.pos).project(inp.camera);
        const dx = (tmp.x - inp.pointer.nx) * inp.camera.aspect, dy = tmp.y - inp.pointer.ny;
        const d = Math.hypot(dx, dy) * 0.5 * inp.viewportH;                        // px
        if (d < 86 && tmp.z < 1) {
          const cr = new THREE.Vector3().setFromMatrixColumn(inp.camera.matrixWorld, 0), cu = new THREE.Vector3().setFromMatrixColumn(inp.camera.matrixWorld, 1);
          const l = Math.hypot(dx, dy) || 1, sx = l < 0.004 ? (rnd() < 0.5 ? -1 : 1) : dx / l, sy = l < 0.004 ? 0.3 : dy / l;
          evade.copy(cr).multiplyScalar(sx).addScaledVector(cu, sy * 0.6 + 0.25).normalize();
          evadeEnv = 1; evadeCool = 1.5; f.evadeCount++; f.alert = 1;
          f.target.copy(f.pos).addScaledVector(evade, 6.5); f.target.y = clamp(f.target.y, C.y - R.y, C.y + R.y); f.hovering = true; hoverLeft = 1.4; f.scan = 0;
        }
      }
      evadeEnv = Math.max(0, evadeEnv - dt / 0.34);
      aCmd.addScaledVector(evade, Math.sin(evadeEnv * Math.PI) * 150);

      // limits
      const ah = Math.hypot(aCmd.x, aCmd.z), ahMax = 78 + evadeEnv * 60;
      if (ah > ahMax) { aCmd.x *= ahMax / ah; aCmd.z *= ahMax / ah; }
      aCmd.y = clamp(aCmd.y, -46, 62);

      // ── heading ─────────────────────────────────────────────────────────────
      const sp = Math.hypot(f.vel.x, f.vel.z);
      let yawT = sYaw.target;
      if (yawGoal !== null) yawT = sYaw.x + angleDelta(sYaw.x, yawGoal);
      else if (f.hovering) { scanPhase += dt * 0.9; yawT = sYaw.target + Math.cos(scanPhase) * f.scan * dt * 0.9; }   // slow yaw scan while it looks around
      else if (sp > 6) yawT = sYaw.x + angleDelta(sYaw.x, Math.atan2(f.vel.x + (f.target.x - f.pos.x) * 0.6, f.vel.z + (f.target.z - f.pos.z) * 0.6));
      f.yaw = sYaw.step(dt, yawT); f.yawRate = sYaw.v;
      fwd.set(Math.sin(f.yaw), 0, Math.cos(f.yaw)); right.set(-Math.cos(f.yaw), 0, Math.sin(f.yaw));

      // ── attitude: tilt the thrust vector to meet the demand ────────────────
      const aF = aCmd.dot(fwd), aR = aCmd.dot(right);
      const pitchDes = clamp(HOVER_PITCH - Math.atan(aF / G) * 1.15 + flare, -0.2, 0.72);
      const rollDes = clamp(Math.atan(aR / G) * 1.25 + f.yawRate * sp * -0.0035, -0.62, 0.62);
      f.pitch = sPitch.step(dt, pitchDes); f.roll = sRoll.step(dt, rollDes);
      f.pitchRate = sPitch.v; f.rollRate = sRoll.v;
      const aVert = sThrust.step(dt, aCmd.y);
      // actual acceleration comes from the actual attitude (plus what the wind adds)
      f.acc.copy(fwd).multiplyScalar(-Math.tan(f.pitch - HOVER_PITCH - flare) * G / 1.15).addScaledVector(right, Math.tan(f.roll) * G / 1.25);
      f.acc.y = aVert;
      f.acc.add(gust).addScaledVector(f.vel, -0.3);
      f.vel.addScaledVector(f.acc, dt); f.pos.addScaledVector(f.vel, dt);
      if (f.mode !== 'descend' && f.mode !== 'settle') f.pos.y = Math.max(f.pos.y, REST.y + 0.6);

      // ── wing commands ───────────────────────────────────────────────────────
      const thrust = clamp(1 + aVert / 260 + Math.hypot(aF, aR) / 700, 0.62, 1.55);
      f.thrust = thrust * f.gain;
      f.beatHz = SPEC.beatHz * (0.94 + 0.06 * thrust) + noise1(simT * 3.1, 5) * 2.2;
      const A = 45 * DEG * (0.8 + 0.2 * thrust);
      const dA = clamp(0.62 * (rollDes - f.roll) + 0.2 * f.roll + 0.05 * f.yawRate, -0.19, 0.19);  // steer by stroke-amplitude asymmetry
      f.ampL = Math.min(A + dA, 54 * DEG); f.ampR = Math.min(A - dA, 54 * DEG);
      const mean = -0.04 + clamp(0.4 * (pitchDes - f.pitch), -0.12, 0.12);
      f.meanL = mean + clamp(f.yawRate * 0.06, -0.08, 0.08); f.meanR = mean - clamp(f.yawRate * 0.06, -0.08, 0.08);

      // acceleration felt by the body (for trailing legs, abdomen, antennae): world → heading frame
      f.accBody.set(f.acc.dot(right) * -1, f.acc.y, f.acc.dot(fwd));
    }

    f.plant = clamp(sPlant.step(dt, plantT));
    f.airborne = clamp(sAir.step(dt, airT));
    f.alert = Math.max(0, f.alert - dt * 0.9);
    setStatus();
    return f;
  }

  /** Hard reset to the resting pose (used when the opening sequence replays). */
  function reset() {
    f.mode = 'rest'; f.pos.copy(REST); f.vel.set(0, 0, 0); f.yaw = f.pitch = f.roll = 0;
    sFold.set(1); sGain.set(0); sShiver.set(0); sMotor.set(0); sPlant.set(1); sAir.set(0); sPitch.set(0); sRoll.set(0); sYaw.set(0); sOff.set(new THREE.Vector3());
    f.fold = 1; f.gain = 0; f.shiver = 0; f.motor = 0; f.plant = 1; f.airborne = 0;
    setStatus();
  }

  /** A soft landing thump for the suspension (used when the intro lowers the bee onto its feet). */
  function settleKick(v) { sOff.kick(new THREE.Vector3(0, v, 0)); }

  return { f, update, reset, settleKick, REST };
}
