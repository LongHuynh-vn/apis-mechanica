// Dev-only regression audits, run from the console against the live app:
//   const audit = await import('/src/dev/audit.js');
//   audit.triangles(__apis)      → triangle count per part
//   audit.feet(__apis)           → how high each claw tip sits above the plinth at rest + worst dip through a flight
//   audit.wings(__apis)          → wing-membrane clearance from abdomen / thorax at rest and over 8 beats in flight
//   audit.motion(__apis)         → single-frame jumps ("pops") across take-off, landing, cancels, explode, tempo, pause
// Every audit leaves the bee resting, TEMPO at 1, render mode solid. Rendering is stubbed while they run.
import { clearance } from './clearance.js';

const PLINTH_TOP = 1.6;

function quiet(A, fn) {
  const render = A.post.render, pre = A.stage.prerender;
  A.post.render = () => {}; A.stage.prerender = () => {};
  try { return fn(); } finally { A.post.render = render; A.stage.prerender = pre; }
}
function settle(A, max = 2400) {
  A.actions.setTempo(1); if (A.state.paused) A.actions.togglePause();
  A.actions.setWantFlight(false); A.actions.setExplode(0); A.actions.setRenderMode('solid');
  let n = 0; while ((A.bee.f.mode !== 'rest' || A.state.explode > 0.001) && n < max) { A.step(1, 1 / 60); n++; }
  A.step(30, 1 / 60);
}

export function triangles(A) {
  const by = {}; let total = 0;
  A.bee.root.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
    const g = o.geometry, n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    const p = o.userData.partId || 'other'; by[p] = (by[p] || 0) + n; total += n;
  });
  return { total: Math.round(total), meshes: A.bee.pickables.length, byPart: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round(v)])) };
}

/** Lowest world-space vertex of each leg's claw link, relative to the surface under it. */
function footClearance(A, leg) {
  const T = A.THREE, v = new T.Vector3(); let min = 9;
  leg.links[6].updateWorldMatrix(true, true);
  leg.links[6].traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const r = Math.hypot(v.x, v.z), surf = r < 6.6 ? PLINTH_TOP : r > 7.7 ? 0 : -9;   // ignore the chamfered plinth edge
      min = Math.min(min, v.y - surf);
    }
  });
  return min;
}

export function feet(A) {
  return quiet(A, () => {
    settle(A);
    A.scene.updateMatrixWorld(true);
    const rest = A.bee.legs.legs.map((l) => +footClearance(A, l).toFixed(3));
    let worst = 9, at = null;
    for (let rep = 0; rep < 2; rep++) {
      A.actions.setWantFlight(true);
      for (let i = 0; i < 300 + rep * 160; i++) {
        A.step(1, 1 / 60); A.scene.updateMatrixWorld(true);
        for (const l of A.bee.legs.legs) { const c = footClearance(A, l); if (c < worst) { worst = c; at = [l.type + l.side, A.bee.f.mode]; } }
      }
      A.actions.setWantFlight(false);
      let n = 0;
      while (A.bee.f.mode !== 'rest' && n < 1500) {
        A.step(1, 1 / 60); A.scene.updateMatrixWorld(true); n++;
        for (const l of A.bee.legs.legs) { const c = footClearance(A, l); if (c < worst) { worst = c; at = [l.type + l.side, A.bee.f.mode]; } }
      }
    }
    settle(A);
    return { restClawAbovePlinth: rest, worstDuringFlights: +worst.toFixed(3), at };
  });
}

export function wings(A) {
  return quiet(A, () => {
    settle(A);
    A.scene.updateMatrixWorld(true);
    const r = clearance(A);
    const rest = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.abd, v.thorax]]));
    A.actions.setWantFlight(true); A.step(420, 1 / 60); A.actions.setTempo(1 / 230);
    const min = { abd: 9, thorax: 9 }, worst = {};
    for (let i = 0; i < 480; i++) {
      A.step(1, 1 / 60); A.scene.updateMatrixWorld(true);
      for (const [k, v] of Object.entries(clearance(A))) {
        if (v.abd < min.abd) { min.abd = v.abd; worst.abd = [k, v.atAbd]; }
        if (v.thorax < min.thorax) { min.thorax = v.thorax; worst.thorax = [k, v.atThx]; }
      }
    }
    settle(A);
    return { rest, flight: { min, worst } };
  });
}

/** Wing clearance through `seconds` of real manoeuvring flight (turns, gusts, hover), sampled every 2nd frame. */
export function wingsStress(A, seconds = 40) {
  return quiet(A, () => {
    settle(A);
    A.actions.setWantFlight(true); A.step(300, 1 / 60);
    const min = { abd: 9, thorax: 9 }, worst = {}; let maxYaw = 0, maxPitchUp = -9, below = 0, n = 0;
    for (let i = 0; i < seconds * 60; i++) {
      A.step(1, 1 / 60);
      const s = A.bee.abdomen.swing.rotation;
      maxYaw = Math.max(maxYaw, Math.abs(s.y)); maxPitchUp = Math.max(maxPitchUp, s.x);
      if (i % 2) continue;
      A.scene.updateMatrixWorld(true); n++;
      let hit = false;
      for (const [k, v] of Object.entries(clearance(A))) {
        if (v.abd < min.abd) { min.abd = v.abd; worst.abd = [k, v.atAbd, +s.y.toFixed(2), +s.x.toFixed(2)]; }
        if (v.thorax < min.thorax) { min.thorax = v.thorax; worst.thorax = [k, v.atThx]; }
        if (v.abd < 0 || v.thorax < 0) hit = true;
      }
      if (hit) below++;
    }
    settle(A);
    return { min, worst, samples: n, samplesClipping: below, maxAbdYaw: +maxYaw.toFixed(3), maxAbdPitch: +maxPitchUp.toFixed(3) };
  });
}

export function motion(A) {
  return quiet(A, () => {
    settle(A);
    const T = A.THREE, v = new T.Vector3(), series = {}, modes = [], marks = [];
    let frame = 0;
    const push = (k, x) => (series[k] || (series[k] = [])).push(x);
    const rec = () => {
      const b = A.bee, f = b.f;
      push('body.x', b.bodyWorld.x); push('body.y', b.bodyWorld.y); push('body.z', b.bodyWorld.z);
      push('root.pitch', b.root.rotation.x); push('root.yaw', b.root.rotation.y); push('root.roll', b.root.rotation.z);
      push('head.rx', b.head.pivot.rotation.x); push('head.ry', b.head.pivot.rotation.y); push('head.rz', b.head.pivot.rotation.z);
      push('abd.rx', b.abdomen.swing.rotation.x); push('abd.ry', b.abdomen.swing.rotation.y);
      push('lid.y', b.thorax.lid.position.y);
      b.legs.legs.forEach((leg, i) => { leg.links[6].getWorldPosition(v); push(`leg${i}.x`, v.x); push(`leg${i}.y`, v.y); push(`leg${i}.z`, v.z); });
      b.head.antennae.forEach((a, i) => { push(`ant${i}.sx`, a.scape.rotation.x); push(`ant${i}.sz`, a.scape.rotation.z); push(`ant${i}.ex`, a.elbow.rotation.x); });
      push('cam.x', A.camera.position.x); push('cam.y', A.camera.position.y); push('cam.z', A.camera.position.z);
      modes.push(f.mode + (A.state.explode > 0.001 ? '+ex' : '')); frame++;
    };
    const run = (n) => { for (let i = 0; i < n; i++) { A.step(1, 1 / 60); rec(); } };
    const until = (pred, max = 2400) => { let n = 0; while (!pred() && n < max) { A.step(1, 1 / 60); rec(); n++; } };
    const mark = (name) => marks.push([frame, name]);
    const rest = () => A.bee.f.mode === 'rest';
    mark('full flight'); run(40); A.actions.setWantFlight(true); run(600); A.actions.setWantFlight(false); until(rest); run(90);
    mark('cancel in warm-up'); A.actions.setWantFlight(true); run(70); A.actions.setWantFlight(false); until(rest); run(60);
    mark('cancel while unfolding, re-want, abort descent'); A.actions.setWantFlight(true); run(108); A.actions.setWantFlight(false); run(28); A.actions.setWantFlight(true); run(420);
    A.actions.setWantFlight(false); until(() => A.bee.f.mode === 'descend'); run(14); A.actions.setWantFlight(true); run(240);
    A.actions.setWantFlight(false); until(() => A.bee.f.mode === 'settle'); run(20); A.actions.setWantFlight(true); run(300); A.actions.setWantFlight(false); until(rest); run(60);
    mark('explode toggles'); A.actions.setExplode(1); run(100); A.actions.setExplode(0); run(60); A.actions.setExplode(1); run(330); A.actions.setExplode(0); run(330);
    mark('tempo and pause in flight'); A.actions.setWantFlight(true); run(360); A.actions.setTempo(0.01); run(60); A.actions.setTempo(1); run(60);
    A.actions.togglePause(); run(30); A.actions.togglePause(); run(60); A.actions.setWantFlight(false); until(rest); run(30);
    const spikes = [];
    for (const [k, s] of Object.entries(series)) {
      const d = []; for (let i = 1; i < s.length; i++) d.push(s[i] - s[i - 1]);
      const abs = d.map(Math.abs).sort((a, b) => a - b), p90 = abs[Math.floor(abs.length * 0.9)] || 0;
      const eps = k.startsWith('cam') ? 0.05 : k.startsWith('leg') || k.startsWith('body') ? 0.04 : 0.02;
      for (let i = 1; i < d.length - 1; i++) {
        const a = Math.abs(d[i]), nb = Math.max(Math.abs(d[i - 1]), Math.abs(d[i + 1]));
        if (a > eps && a > 3.5 * nb + p90 * 0.5) spikes.push({ k, frame: i + 1, jump: +d[i].toFixed(4), neighbour: +nb.toFixed(4), mode: modes[i + 1] });
      }
    }
    spikes.sort((a, b) => Math.abs(b.jump) - Math.abs(a.jump));
    settle(A);
    return { frames: frame, marks, spikes: spikes.length, top: spikes.slice(0, 20) };
  });
}
