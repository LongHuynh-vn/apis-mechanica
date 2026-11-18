// ─────────────────────────────────────────────────────────────────────────────
// bee/bee.js — RIG
// Assembles the anatomy into one articulated machine and animates everything
// that rides on the flight controller: wings and their drive train, leg IK and
// trailing, head gaze stabilisation, antennae, abdomen swing and breathing,
// setae shimmer, the exploded view and the opening assembly. Every secondary
// motion has its own spring with its own frequency and lag — nothing shares a
// phase.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { buildThorax } from './thorax.js';
import { buildHead, REST_ANTENNA } from './head.js';
import { buildAbdomen } from './abdomen.js';
import { buildLegs, mixAngles, copyAngles } from './legs.js';
import { buildWings } from './wings.js';
import { createFlight, HOVER_PITCH } from './flight.js';
import { PARTS, PART_IDS } from './parts.js';
import { state, actions, bus, FLIGHT, SPEC } from '../core/state.js';
import { sectionPlane, globalUniforms } from '../core/gfx.js';
import { palette } from '../core/themes.js';
import { DIMS } from '../core/dims.js';
import { Spring, clamp, lerp, smoothstep, damp, ease, noise1, fbm1, angleDelta, TAU, DEG, rng } from '../core/math.js';

const EXPLODE_LIFT = 7.2;      // the whole machine rises this far (cm) so the legs clear the plinth when exploded

export function createBee({ scene, mats, ex, camera }) {
  const rnd = rng(5);
  const root = new THREE.Group(); root.name = 'bee'; root.rotation.order = 'YXZ';
  scene.add(root);
  const ctx = { mats, ex };

  // ── assemble ───────────────────────────────────────────────────────────────
  const thorax = buildThorax(ctx);
  const body = thorax.group; root.add(body);
  const M = thorax.mounts;
  const head = buildHead(ctx); head.node.position.copy(M.neck); body.add(head.node);
  head.pivot.rotation.order = 'YXZ';
  const abdomen = buildAbdomen(ctx); abdomen.group.position.copy(M.petiole); body.add(abdomen.group);
  const legs = buildLegs(ctx, M.coxae); body.add(legs.sides[0], legs.sides[1]);
  const wings = buildWings(ctx, M, thorax.lid); body.add(wings.sides[0].group, wings.sides[1].group);
  ex.freeze();
  scene.add(ex.guides);

  const flight = createFlight();
  const f = flight.f;

  // ── label / focus anchors (one Object3D per part) ──────────────────────────
  const anchors = {};
  const addAnchor = (id, parent, pos, radius) => { const o = new THREE.Object3D(); o.position.copy(pos); parent.add(o); anchors[id] = { o, radius }; };
  const WL = wings.sides[0], WR = wings.sides[1];
  addAnchor('forewings', WL.blade, wings.anchors.forewings, 4.4);
  addAnchor('hindwings', WR.hind, wings.anchors.hindwings, 3.2);
  addAnchor('hamuli', WL.hamNode, wings.anchors.hamuli, 1.6);
  addAnchor('hinges', WR.hingeNode, wings.anchors.hinges, 0.9);
  addAnchor('eyes', head.eyes[0], new THREE.Vector3(0.42, 0.3, 0.1), 1.3);
  addAnchor('ocelli', head.head, head.anchors.ocelli, 0.6);
  addAnchor('antennae', head.antennae[1].elbow, new THREE.Vector3(0, 1.2, 0), 1.6);
  addAnchor('mandibles', head.mandibles[0], new THREE.Vector3(-0.25, -0.2, 0.05), 0.7);
  addAnchor('proboscis', head.head, head.anchors.proboscis, 1.0);
  addAnchor('cranium', head.head, head.anchors.cranium, 1.9);
  addAnchor('scutum', thorax.lid, thorax.anchors.scutum, 1.9);
  addAnchor('thoraxbox', body, thorax.anchors.thoraxbox, 2.2);
  addAnchor('motor', ex.nodes.find((n) => n.userData.ex.part === 'motor'), thorax.anchors.motor, 1.5);
  addAnchor('geartrain', ex.nodes.find((n) => n.userData.ex.part === 'geartrain'), thorax.anchors.geartrain, 1.2);
  addAnchor('setae', ex.nodes.find((n) => n.userData.ex.part === 'setae'), thorax.anchors.setae, 1.6);
  const legOf = (type, side) => legs.legs.find((l) => l.type === type && l.side === side);
  addAnchor('forelegs', legOf('fore', 0).links[3], new THREE.Vector3(0, 0, 0.6), 2.0);
  addAnchor('midlegs', legOf('mid', 1).links[3], new THREE.Vector3(0, 0, 0.7), 2.2);
  addAnchor('hindlegs', legOf('hind', 0).links[2], new THREE.Vector3(0, 0, 1.4), 2.6);
  addAnchor('corbicula', legOf('hind', 0).corbNode, new THREE.Vector3(-0.2, 0, 1.3), 0.9);
  addAnchor('petiole', abdomen.node, abdomen.anchors.petiole, 0.6);
  addAnchor('tergites', abdomen.rings[2].slide, abdomen.anchors.tergites, 2.6);
  addAnchor('core', abdomen.coreNode, new THREE.Vector3(0, 0, 0), 1.8);
  addAnchor('sting', abdomen.swing.children.find((c) => c.userData.ex?.part === 'sting'), new THREE.Vector3(0, 0, -1.0), 1.0);

  const furMeshes = [...thorax.fur.meshes, ...head.fur.meshes];
  const pickables = [];
  root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.userData.partId) pickables.push(o); });

  // ── secondary motion: every spring has its own frequency and damping ───────
  const S = {
    headYaw: new Spring(2.3, 0.72), headPitch: new Spring(2.6, 0.7), headRoll: new Spring(5.5, 0.75),
    abdPitch: new Spring(1.85, 0.42), abdYaw: new Spring(1.6, 0.5),
    setaeX: new Spring(4.6, 0.3), setaeY: new Spring(5.2, 0.3), setaeZ: new Spring(4.1, 0.3),
    proboscis: new Spring(1.5, 0.85), mandible: new Spring(3, 0.6),
    explode: new Spring(0.95, 1), section: new Spring(1.15, 1), schematic: new Spring(1.5, 1),
  };
  const ant = [0, 1].map((i) => ({
    sx: new Spring(i ? 4.1 : 3.6, 0.3, REST_ANTENNA.scapeX), sz: new Spring(i ? 3.4 : 3.9, 0.32, REST_ANTENNA.scapeZ),
    wx: new Spring(i ? 6.3 : 5.6, 0.22), wz: new Spring(i ? 5.1 : 6.6, 0.24), ex: new Spring(2.4, 0.5, REST_ANTENNA.elbowX),
    twitch: 1 + rnd() * 3, pose: { ...REST_ANTENNA },
  }));
  const legDyn = legs.legs.map((leg, i) => ({
    swing: new Spring({ fore: 3.2, mid: 2.6, hind: 2.0 }[leg.type] * (1 + (leg.side ? 0.07 : -0.05)), 0.3),
    yaw: new Spring({ fore: 2.8, mid: 2.3, hind: 1.75 }[leg.type] * (1 + (leg.side ? -0.06 : 0.04)), 0.34),
    knee: new Spring({ fore: 4.3, mid: 3.7, hind: 3.0 }[leg.type], 0.28),
    fly: { ...leg.fly }, ik: { ...leg.rest }, out: { ...leg.rest }, trial: { ...leg.rest }, seed: i * 7.3, tuck: 0,
  }));

  /** Fold a leg's distal chain upward by `t` radians (each link by its own share): lifts the claw without moving the hip. */
  const tuckLeg = (a, t) => { a.f += t * 0.8; a.ti += t * 0.5; a.b += t * 0.9; a.ta += t * 1.1; };

  // ── state that isn't physics ───────────────────────────────────────────────
  let gearPhase = 0.4, breath = 0, introT = 0, proboscisOut = 0, idleLook = 0, raise = 0, sectionAmt = 0;
  const lookPoint = new THREE.Vector3(0, 6, 40), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane();
  const footWorld = legs.legs.map((leg) => new THREE.Vector3(flight.REST.x + (leg.side ? -1 : 1) * leg.foot.x, flight.REST.y + leg.foot.y, flight.REST.z + leg.foot.z));
  bus.on('proboscis', () => { proboscisOut = proboscisOut > 0.5 ? 0 : 1; });
  bus.on('replayIntro', () => { if (f.mode === 'rest') { introT = 0; state.introDone = false; state.uiReveal = Math.min(state.uiReveal, 0.0); actions.setExplode(0); S.explode.set(0); } });

  const headWorld = new THREE.Vector3(), bodyWorld = new THREE.Vector3();

  /**
   * @param {number} dtReal  wall-clock seconds
   * @param {number} dt      sim seconds (dtReal × tempo, 0 when paused)
   * @param {object} env     { camera, viewportH, time }
   */
  function update(dtReal, dt, env) {
    const cam = env.camera;

    // ── 1. opening sequence / exploded view ──────────────────────────────────
    let show = 0;                      // 0 = live pose … 1 = presentation pose (wings spread, legs in their rest shape)
    if (!state.introDone) {
      introT += dtReal;
      const it = introT - 0.55;                                                   // a beat of empty plate first: the grid inks itself in
      const assembled = ex.setIntro(it);
      const landT = clamp((it - ex.introDuration + 0.25) / 0.75);                 // lower onto its feet at the end
      raise = EXPLODE_LIFT * 0.55 * (1 - ease.inOutCubic(landT));
      show = 1 - ease.inOutCubic(clamp((it - ex.introDuration + 0.5) / 0.6));
      state.assembly = clamp(assembled * 1.02);
      state.explode = 0;
      state.uiReveal = clamp((it - ex.introDuration - 0.1) / 1.1);
      if (it > ex.introDuration + 0.62 && !introKick) { introKick = true; flight.settleKick(-5.5); }
      if (it > ex.introDuration + 1.2) {
        actions.setIntroDone(); state.assembly = 1; state.uiReveal = 1; ex.setAmount(0);
        for (const a of ant) { a.wx.kick(7 + rnd() * 3); a.sx.kick(-2.6); a.twitch = 2.5 + rnd() * 2; }   // the antennae twitch
      }
      ex.updateGuides(clamp(1 - it / (ex.introDuration * 0.9)) * 0.7);
    } else {
      introKick = false;
      // exploded view only happens on the plinth: land first, re-assemble before take-off
      if (state.explodeTarget > 0.001 && state.wantFlight && S.explode.x < 0.002 && f.mode !== 'rest') actions.setWantFlight(false);
      if (state.wantFlight && state.explodeTarget > 0.001 && f.mode === 'rest') actions.setExplode(0);
      const target = f.mode === 'rest' ? state.explodeTarget : 0;
      const e = clamp(S.explode.step(dtReal, target));
      state.explode = Math.abs(e - target) < 5e-4 ? target : e;
      state.assembly = 1 - state.explode;
      state.uiReveal = 1;
      ex.setAmount(state.explode);
      ex.updateGuides(smoothstep(0.02, 0.3, state.explode));
      raise = EXPLODE_LIFT * ease.inOutCubic(smoothstep(0, 0.75, state.explode));
      show = smoothstep(0, 0.32, state.explode);
    }
    const canFly = state.introDone && state.explode < 0.004;

    // ── 2. flight simulation ─────────────────────────────────────────────────
    const ptr = state.pointer;
    flight.update(dt, { wantFlight: state.wantFlight, canFly, camera: cam, viewportH: env.viewportH, pointer: { nx: ptr.nx, ny: ptr.ny, active: ptr.inside && !ptr.overUI && !ptr.down } });
    state.flightAmount = f.airborne;
    root.position.copy(f.pos); root.position.y += raise;
    root.rotation.set(-f.pitch, f.yaw, f.roll);
    root.updateMatrixWorld(true);
    body.getWorldPosition(bodyWorld);

    // ── 3. drive train + wings ───────────────────────────────────────────────
    const rate = dtReal > 0 ? (TAU * f.beatHz * dt) / dtReal : 0;               // true crank speed in real time (rad/s)
    const cap = TAU * 6.5, lock = smoothstep(cap, cap * 0.45, rate);            // slow enough to watch → phase-lock to the wings
    gearPhase += lerp(cap, rate, lock) * f.motor * dtReal;
    gearPhase += angleDelta(gearPhase, f.phase) * lock * f.motor * Math.min(1, 7 * dtReal);
    const lift = thorax.setCrank(gearPhase);
    thorax.setFlex(clamp(lift / 0.1, -1, 1), Math.max(f.gain, f.shiver * 0.7) * (1 - show));
    const slow = 1 - smoothstep(0.3, 3.0, f.dPhase);
    wings.update({
      phase: f.phase, dPhase: f.dPhase, fold: f.fold, gain: f.gain, show, planeTilt: f.planeTilt, shiver: f.shiver,
      ampL: f.ampL, ampR: f.ampR, meanL: f.meanL, meanR: f.meanR, lidLift: thorax.lid.position.y,
      trail: f.airborne * lerp(0.42, 1, slow),
    });
    mats.setFade('forewings', WL.solid); mats.setFade('hindwings', WL.solid); mats.setFade('hamuli', WL.solid);

    // ── 4. legs: IK on the plinth, trailing springs in the air ───────────────
    const speedF = f.accBody.z, climb = f.accBody.y;
    const vF = f.vel.x * Math.sin(f.yaw) + f.vel.z * Math.cos(f.yaw);
    for (let i = 0; i < legs.legs.length; i++) {
      const leg = legs.legs[i], d = legDyn[i];
      // stance target in this leg's hip frame (left-side convention)
      v1.copy(footWorld[i]);
      body.worldToLocal(v1); if (leg.side) v1.x = -v1.x; v1.sub(leg.hip);
      legs.ik(leg, v1, d.ik);
      // flight pose + springs: trail back with speed, sag/extend with vertical g, each leg at its own rate
      const hindK = leg.type === 'hind' ? 1.5 : leg.type === 'mid' ? 1.1 : 0.8;
      const sw = d.swing.step(dt, clamp(-climb * 0.0034 - Math.abs(vF) * 0.004, -0.5, 0.5) * hindK + noise1(env.time * 0.7, d.seed) * 0.05 * f.airborne);
      const yw = d.yaw.step(dt, clamp(-speedF * 0.0026 - vF * 0.012, -0.55, 0.4) * hindK + (leg.side ? 1 : -1) * f.accBody.x * 0.002);
      const kn = d.knee.step(dt, sw * 0.8);
      d.fly.yaw = leg.fly.yaw + yw; d.fly.c = leg.fly.c + sw * 0.3; d.fly.t = leg.fly.t + sw * 0.4;
      d.fly.f = leg.fly.f + sw * 0.9; d.fly.ti = leg.fly.ti + sw * 0.7 + kn * 0.6; d.fly.b = leg.fly.b + kn * 0.9; d.fly.ta = leg.fly.ta + kn * 1.2;
      mixAngles(d.out, d.fly, d.ik, ease.inOutCubic(f.plant));
      if (show > 0.001) mixAngles(d.out, d.out, leg.rest, show);
      legs.pose(leg, d.out, 1);
      // ground guard: a trailing leg tucks up rather than dip through the plinth. The tuck is computed from the UN-tucked
      // pose and from the surface under the HIP (neither depends on the tuck itself, so there is no feedback to flip-flop at
      // the plinth rim), and it is eased, so the guard can never cause a pop of its own.
      let tuckT = 0;
      if (show < 0.01 && f.plant < 0.999) {
        // surface under the hip and under the un-tucked claw (whichever is higher); neither depends on the tuck being solved
        const lastPt = leg.pts[leg.pts.length - 1];
        const plinthAt = (p) => DIMS.plinthTopY * (1 - smoothstep(DIMS.plinthRadius * 0.87, DIMS.plinthRadius * 1.04, Math.hypot(p.x, p.z)));
        v3.set((leg.side ? -1 : 1) * leg.hip.x, leg.hip.y, leg.hip.z); body.localToWorld(v3);
        v2.set((leg.side ? -1 : 1) * (leg.hip.x + lastPt.x), leg.hip.y + lastPt.y, leg.hip.z + lastPt.z); body.localToWorld(v2);
        const surface = Math.max(plinthAt(v3), plinthAt(v2));
        for (let k = 0; k < 7; k++) {                 // solve how much tuck lifts the foot clear (a continuous function of the pose)
          let lowest = Infinity;                      // ankle, tarsal joints and claw tip: whichever hangs lowest
          for (let j = 4; j < leg.pts.length; j++) {
            const p = leg.pts[j];
            v2.set((leg.side ? -1 : 1) * (leg.hip.x + p.x), leg.hip.y + p.y, leg.hip.z + p.z); body.localToWorld(v2);
            lowest = Math.min(lowest, v2.y - (j === leg.pts.length - 1 ? 0.1 : 0));   // claws and pad hang ~1 mm below the last joint's axis
          }
          const pen = Math.max(0, surface + 0.2 - lowest);  // one-sided and a fixed number of steps: it only ever adds tuck, so it cannot oscillate or branch
          tuckT = Math.min(tuckT + pen * 0.3, 1.6);
          copyAngles(d.trial, d.out); tuckLeg(d.trial, tuckT); legs.pose(leg, d.trial, 1);
        }
        tuckT *= 1 - Math.pow(f.plant, 4);            // a planted foot is the IK's business, not the guard's
      }
      d.tuck = tuckT;                                 // no smoothing: the solve is already a continuous function of the pose, and any lag lets the claw sink
      if (d.tuck > 1e-4) tuckLeg(d.out, d.tuck);
      if (d.tuck > 1e-4 || tuckT > 0) legs.pose(leg, d.out, 1);
    }

    // ── 5. head: gaze stabilisation + cursor tracking ────────────────────────
    const ptrActive = ptr.inside && !ptr.overUI;
    if (ptrActive && cam) {
      raycaster.setFromCamera(v1.set(ptr.nx, ptr.ny, 0), cam);
      cam.getWorldDirection(v2); plane.setFromNormalAndCoplanarPoint(v2, v3.copy(bodyWorld).addScaledVector(v2, -5));
      if (!raycaster.ray.intersectPlane(plane, lookPoint)) lookPoint.copy(cam.position);
    } else if (cam) {
      idleLook += dtReal;
      lookPoint.copy(cam.position).multiplyScalar(0.5).add(v1.set(Math.sin(idleLook * 0.31) * 14, 4 + Math.sin(idleLook * 0.23) * 5, 0));
    }
    v1.copy(lookPoint); body.worldToLocal(v1); v1.sub(M.neck);
    const gazeW = (ptrActive ? 0.75 : 0.35) * (1 - show);
    const yawL = clamp(Math.atan2(v1.x, v1.z), -0.62, 0.62) * gazeW, pitchL = clamp(Math.atan2(v1.y, Math.hypot(v1.x, v1.z)), -0.34, 0.42) * gazeW;
    head.pivot.rotation.y = S.headYaw.step(dt, yawL);
    head.pivot.rotation.x = -S.headPitch.step(dt, pitchL - (f.pitch - 0.06) * 0.55 * (1 - show));   // counter-pitch: stay level when the body noses up
    head.pivot.rotation.z = S.headRoll.step(dt, -f.roll * 0.86 * (1 - show));                       // counter-roll: stay level while the body banks
    head.head.getWorldPosition(headWorld);

    // ── 6. antennae: sway, feel the air, follow the cursor, twitch ───────────
    const air = clamp(f.vel.length() / 30), alert = f.alert;
    for (let i = 0; i < 2; i++) {
      const a = ant[i], sgn = i ? -1 : 1;
      a.twitch -= dt * (f.mode === 'rest' ? 1 : 1.6);
      if (a.twitch <= 0 && state.introDone) { a.twitch = 1.6 + rnd() * 4.5; a.wx.kick((rnd() - 0.3) * 7); a.wz.kick((rnd() - 0.5) * 6); a.sx.kick((rnd() - 0.5) * 1.6); }
      const sx = a.sx.step(dt, REST_ANTENNA.scapeX + pitchL * 0.5 + f.airborne * 0.18 - air * 0.12 + alert * 0.22 + f.shiver * 0.08 * Math.sin(f.phase * 0.21 + i));
      const sz = a.sz.step(dt, REST_ANTENNA.scapeZ - yawL * sgn * 0.45 - alert * 0.1 + f.roll * sgn * 0.2);
      const el = a.ex.step(dt, REST_ANTENNA.elbowX - f.airborne * 0.42 + air * 0.16 - alert * 0.3);      // held forward into the airflow
      const wx = a.wx.step(dt, air * 0.9 - f.accBody.y * 0.004 + fbm1(env.time * 0.9, 20 + i * 3) * 0.35 * (0.4 + air));
      const wz = a.wz.step(dt, f.accBody.x * sgn * 0.006 + fbm1(env.time * 1.1, 40 + i * 3) * 0.3 * (0.4 + air));
      const ch = ex.channels.find((c) => c.part === 'antennae');
      head.poseAntenna(i, { scapeX: sx, scapeZ: sz, elbowX: el, elbowZ: REST_ANTENNA.elbowZ, curl: REST_ANTENNA.curl, swayX: wx, swayZ: wz, spread: ch ? ch.k : 0 });
    }
    head.mandibles[0].rotation.z = head.mandibles[1].rotation.z = S.mandible.step(dt, 0.06 + Math.max(0, noise1(env.time * 0.35, 9)) * 0.28 * (f.mode === 'rest' ? 1 : 0.3)) * -1;
    head.setProboscis(clamp(S.proboscis.step(dt, proboscisOut * (f.mode === 'rest' ? 1 : 0))));

    // ── 7. abdomen: lags behind the thorax, and breathes ─────────────────────
    const hang = f.airborne * 0.26;
    // limits are set by the wings: the abdomen may sag and trail freely, but it swings up or sideways only as far as the
    // beating hindwings allow (measured with dev/audit.js wingsStress)
    abdomen.swing.rotation.x = -0.13 - hang + clamp(S.abdPitch.step(dt, clamp(-f.accBody.y * 0.0019 + f.pitchRate * 0.11 - f.accBody.z * 0.0008, -0.36, 0.08)), -0.5, 0.11);
    abdomen.swing.rotation.y = clamp(S.abdYaw.step(dt, clamp(f.yawRate * 0.14 + f.accBody.x * 0.0016 - f.rollRate * 0.05, -0.12, 0.12)), -0.16, 0.16);
    breath += dt * TAU * lerp(0.32, 1.35, Math.max(f.motor, f.airborne));
    abdomen.breathe(breath, 1 - show * 0.85);

    // ── 8. setae shimmer ─────────────────────────────────────────────────────
    const swx = S.setaeX.step(dt, clamp(-f.accBody.x * 0.0011, -0.2, 0.2)), swy = S.setaeY.step(dt, clamp(-f.accBody.y * 0.0009 - f.vel.y * 0.004, -0.2, 0.2)), swz = S.setaeZ.step(dt, clamp(-vF * 0.006 - f.accBody.z * 0.0009, -0.24, 0.24));
    for (const sm of furMeshes) { sm.userData.sway.set(swx, swy, swz); sm.userData.shimmer.value = 0.01 + 0.035 * Math.max(f.gain, f.shiver); }

    // ── 9. the amber core ────────────────────────────────────────────────────
    const tok = mats.tok;
    const pulse = 0.82 + 0.12 * Math.sin(env.time * 1.7) * Math.sin(env.time * 0.61) + 0.06 * noise1(env.time * 6, 3);
    abdomen.flick.value = lerp(0.9, 1.25, Math.max(f.motor, f.airborne));
    abdomen.light.color.copy(tok.misc_coreLight);
    abdomen.light.intensity = tok.misc_coreLightIntensity * pulse * abdomen.flick.value * (1 - globalUniforms.uSchematic.value);
    head.glint.color.value.copy(tok.misc_glint); head.glint.gain.value = tok.misc_glintGain;
    wings.ghostUniforms.uColor.value.copy(tok.misc_ghost); wings.ghostUniforms.uVein.value.copy(tok.misc_ghostVein); wings.ghostUniforms.uOpacity.value = tok.misc_ghostAlpha;
    wings.trailUniforms.uColor.value.copy(tok.misc_trail);
    ex.guideMat.uniforms.uColor.value.copy(palette.current.line);

    // ── 10. section plane rides with the body ────────────────────────────────
    sectionAmt = clamp(S.section.step(dtReal, state.renderMode === 'section' ? 1 : 0));
    globalUniforms.uSection.value = smoothstep(0, 0.08, sectionAmt);
    if (sectionAmt > 0.001) {
      v1.setFromMatrixColumn(body.matrixWorld, 0).normalize();                    // body +X (the bee's left)
      const offset = lerp(11.5, 0.0, ease.inOutCubic(sectionAmt));
      v2.copy(bodyWorld).addScaledVector(v1, offset);
      sectionPlane.normal.copy(v1).negate(); sectionPlane.constant = v1.dot(v2);
    } else { sectionPlane.normal.set(-1, 0, 0); sectionPlane.constant = 1e4; }

    // ── 11. telemetry ────────────────────────────────────────────────────────
    const t = state.telemetry;
    t.alt = Math.max(0, (f.pos.y - flight.REST.y) * 10); t.airspeed = f.vel.length() * 10 * (f.airborne > 0.02 ? 1 : 0);
    t.heading = ((-f.yaw / DEG) % 360 + 360) % 360; t.beatHz = f.gain > 0.02 || f.shiver > 0.02 ? f.beatHz : 0;
    t.ampL = (f.ampL * 2) / DEG * f.gain; t.ampR = (f.ampR * 2) / DEG * f.gain;
    t.strokeL = WL.ang.stroke / (45 * DEG); t.strokeR = WR.ang.stroke / (45 * DEG); t.phase = f.phase; t.thrust = f.thrust;
  }
  let introKick = false;

  // ── labels: project anchors, report separation ─────────────────────────────
  const items = PART_IDS.map((id) => ({ id, name: PARTS[id].name, caption: PARTS[id].caption, x: 0, y: 0, r: 20, alpha: 0, priority: PARTS[id].priority, visible: false }));
  const bounds = { cx: 0, cy: 0, rx: 0, ry: 0 };
  function labelFrame(cam, w, h) {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const sep = smoothstep(0.35, 0.8, state.explode) * (state.introDone ? 1 : 0);
    for (const it of items) {
      const a = anchors[it.id];
      a.o.getWorldPosition(v1);
      const dist = v1.distanceTo(cam.position);
      v1.project(cam);
      it.x = (v1.x * 0.5 + 0.5) * w; it.y = (-v1.y * 0.5 + 0.5) * h;
      it.visible = v1.z < 1 && v1.z > -1;
      it.r = (a.radius / (dist * Math.tan((cam.fov * DEG) / 2))) * (h / 2) * 0.55;
      it.alpha = sep * smoothstep(0.25, 0.9, id2sep(it.id));
      if (it.visible) { minX = Math.min(minX, it.x - it.r); maxX = Math.max(maxX, it.x + it.r); minY = Math.min(minY, it.y - it.r); maxY = Math.max(maxY, it.y + it.r); }
    }
    if (minX < maxX) {
      bounds.cx = (minX + maxX) / 2; bounds.cy = (minY + maxY) / 2; bounds.rx = (maxX - minX) / 2 + 14; bounds.ry = (maxY - minY) / 2 + 14;
    }
    return { viewport: { w, h }, bounds: minX < maxX ? bounds : null, hoverId: state.hoverPart, items };
  }
  const id2sep = (id) => { const s = ex.partSeparation(id); return id === 'thoraxbox' ? 1 : s; };

  /** Where the camera should look to frame a part (centre follows the part as it moves). */
  function getPartFocus(id) {
    const a = anchors[id];
    if (!a) return { center: () => bodyWorld.clone(), radius: 6 };
    const out = new THREE.Vector3();
    return { center: () => a.o.getWorldPosition(out), radius: a.radius * 1.5 };
  }

  return {
    root, body, flight, f, thorax, head, abdomen, legs, wings, anchors, pickables,
    update, labelFrame, getPartFocus, headWorld, bodyWorld,
    get sectionAmount() { return sectionAmt; },
    get raise() { return raise; },
    devUpdate(dtReal, time) { update(dtReal, dtReal * state.tempo * (state.paused ? 0 : 1), { camera, viewportH: innerHeight, time }); },
  };
}
