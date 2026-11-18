// ─────────────────────────────────────────────────────────────────────────────
// bee/director.js — GUIDED TOUR
// A self-running tour for screen recording: press D and the piece presents
// itself — macro on the eye, take-off, a slow-motion pass that eases TEMPO
// down to show the figure-eight stroke, the technical drawing in flight, the
// landing, a lengthwise section, the exploded view, then the next theme.
// It only ever calls the same actions a visitor would, so nothing can pop,
// and it yields the instant state.tour is switched off.
// ─────────────────────────────────────────────────────────────────────────────
import { state, actions, bus, TEMPO_MIN } from '../core/state.js';
import { damp } from '../core/math.js';

export function createDirector({ rig, bee }) {
  let index = -1, t = 0, tempoGoal = 1, restoring = false;

  const SHOTS = [
    { name: 'plate', dur: 4.5, enter() { actions.setRenderMode('solid'); actions.setExplode(0); rig.clearFocus(); actions.select(null); actions.setView('iso'); actions.setOrbit(true); } },
    { name: 'macro', dur: 5.5, enter() { actions.setOrbit(false); actions.setView('macro'); } },
    { name: 'take-off', dur: 6.0, enter() { actions.setView('iso'); actions.setWantFlight(true); } },
    { name: 'slow motion', dur: 8.5, enter() { tempoGoal = 1 / 110; rig.focusOn({ center: () => bee.bodyWorld, radius: 5.4 }); }, exit() { tempoGoal = 1; rig.clearFocus(); } },
    { name: 'drawing in flight', dur: 7.0, enter() { actions.setRenderMode('schematic'); actions.setOrbit(true); }, exit() { actions.setRenderMode('solid'); } },
    { name: 'landing', max: 10, until: () => bee.f.mode === 'rest', enter() { actions.setOrbit(false); actions.setView('iso'); actions.setWantFlight(false); } },
    { name: 'section', dur: 6.5, enter() { actions.setRenderMode('section'); actions.setView('profile'); }, exit() { actions.setRenderMode('solid'); } },
    { name: 'exploded', dur: 9.0, enter() { actions.setView('iso'); actions.setExplode(1); actions.setOrbit(true); }, exit() { actions.setExplode(0); actions.setOrbit(false); } },
    { name: 're-assembly', dur: 3.4, enter() {} },
    { name: 'next theme', dur: 2.4, enter() { actions.cycleTheme(); } },
  ];

  function go(i) {
    if (index >= 0) SHOTS[index].exit?.();
    index = i; t = 0;
    if (i >= 0) SHOTS[i].enter();
  }

  bus.on('tour', ({ value }) => {
    if (value) { restoring = false; go(0); }
    else {                                           // hand everything back; ease TEMPO home rather than snapping it
      if (index >= 0) SHOTS[index].exit?.();
      index = -1; tempoGoal = 1; restoring = true; actions.setOrbit(false);
    }
  });

  function update(dt) {
    if (state.tour && state.introDone) {
      const shot = SHOTS[index];
      t += dt;
      const done = shot.until ? (shot.until() && t > 1.2) || t > shot.max : t > shot.dur;
      if (done) go((index + 1) % SHOTS.length);
    }
    if (state.tour || restoring) {
      const cur = Math.log(state.tempo), goal = Math.log(Math.max(TEMPO_MIN, tempoGoal));
      const next = Math.abs(cur - goal) < 0.01 ? goal : damp(cur, goal, 2.6, dt);
      actions.setTempo(Math.exp(next));
      if (restoring && next === goal) restoring = false;
    }
  }

  return { update, get shot() { return index >= 0 ? SHOTS[index].name : null; } };
}
