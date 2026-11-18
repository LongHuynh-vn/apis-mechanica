// ─────────────────────────────────────────────────────────────────────────────
// core/state.js — the single source of truth + event bus.
//
// RULES
//  · UI / input code never touches the scene directly: it calls `actions.*`.
//  · Simulation code never touches the DOM: it writes `state.*` (continuous
//    values, read every frame) or calls `actions.*` (discrete changes → events).
//  · Discrete changes emit an event of the same name on `bus`; continuous
//    values (explode, assembly, telemetry, pointer) are simply polled.
// ─────────────────────────────────────────────────────────────────────────────

class Emitter {
  constructor() { this.map = new Map(); }
  on(evt, fn) { (this.map.get(evt) || this.map.set(evt, new Set()).get(evt)).add(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.map.get(evt)?.delete(fn); }
  emit(evt, payload) { this.map.get(evt)?.forEach((fn) => fn(payload)); this.map.get('*')?.forEach((fn) => fn(evt, payload)); }
}
export const bus = new Emitter();

export const FLIGHT = Object.freeze({ RESTING: 'RESTING', WARMING: 'WARMING', IN_FLIGHT: 'IN FLIGHT', LANDING: 'LANDING' });
export const RENDER_MODES = Object.freeze(['solid', 'section', 'schematic']);
export const VIEWS = Object.freeze(['iso', 'plan', 'front', 'profile', 'macro']);

/** Headline numbers. Every module quotes these so the piece stays internally consistent. */
export const SPEC = Object.freeze({
  spanMm: 186, bodyMm: 110, massG: 64, beatHz: 230, strokeDeg: 90,
  forewingMm: 77, hindwingMm: 55, hamuli: 21, facetsPerEye: 540, flagellomeres: 10, tergites: 6,
  gearTeeth: [12, 30, 14, 42],
});

/** TEMPO slider (0..1) ↔ time-scale (log mapping: 0 → 1/500×, 1 → 1×). */
export const TEMPO_MIN = 1 / 500;
export const tempoFromSlider = (s) => Math.pow(TEMPO_MIN, 1 - Math.min(1, Math.max(0, s)));
export const sliderFromTempo = (t) => 1 - Math.log(t) / Math.log(TEMPO_MIN);

export const state = {
  // ── discrete (changed through actions, each emits an event of the same name) ──
  theme: 0,                 // index into THEMES — event 'theme'
  renderMode: 'solid',      // one of RENDER_MODES — event 'renderMode'
  explodeTarget: 0,         // 0 assembled … 1 exploded (what the slider asks for) — event 'explodeTarget'
  wantFlight: false,        // user intent (button / F) — event 'wantFlight'
  flight: FLIGHT.RESTING,   // actual status, written by the flight controller — event 'flight'
  tempo: 1,                 // time-scale applied to the bee's world, TEMPO_MIN..1 — event 'tempo'
  paused: false,            // freezes the bee's world (camera still moves) — event 'paused'
  autoOrbit: false,         // ↻ ORBIT — event 'autoOrbit'
  view: 'iso',              // one of VIEWS (null after free navigation) — event 'view'
  hoverPart: null,          // part id under the cursor — event 'hover'
  selectedPart: null,       // part id the camera is framing — event 'select'
  uiHidden: false,          // H — event 'uiHidden'
  sound: false,             // M — event 'sound'
  tour: false,              // D — self-running guided tour (the director drives views, modes, tempo) — event 'tour'
  introDone: false,         // true once the opening assembly sequence has finished — event 'introDone'

  // ── continuous (polled every frame, no events) ──
  explode: 0,               // eased actual explode amount 0..1
  assembly: 0,              // 0..1 shown as "ASSEMBLY nn%" (intro progress, afterwards 1 - explode)
  uiReveal: 0,              // 0..1 driven by the intro: UI chrome fades in last
  flightAmount: 0,          // 0 on the plinth … 1 fully airborne (eased) — for telemetry fade etc.
  pointer: { x: 0, y: 0, nx: 0, ny: 0, inside: false, down: false, overUI: false }, // px + NDC (-1..1)
  telemetry: {
    alt: 0,                 // mm above the plinth top
    airspeed: 0,            // mm/s
    heading: 0,             // degrees 0..360 (0 = +Z "north", clockwise from above)
    beatHz: 0,              // current wing-beat frequency
    ampL: 0, ampR: 0,       // stroke amplitude, degrees (left / right wing)
    strokeL: 0, strokeR: 0, // instantaneous stroke angle, normalised -1..1 (for the oscilloscope)
    phase: 0,               // wing-beat phase in radians (monotonic)
    thrust: 0,              // thrust / weight ratio
    fps: 60,
  },
};

function set(key, value, evt = key) {
  if (state[key] === value) return false;
  const prev = state[key];
  state[key] = value;
  bus.emit(evt, { value, prev });
  return true;
}

export const actions = {
  setTheme: (i) => set('theme', ((i % 4) + 4) % 4),
  cycleTheme: () => actions.setTheme(state.theme + 1),
  setRenderMode: (m) => RENDER_MODES.includes(m) && set('renderMode', m),
  cycleRenderMode: () => actions.setRenderMode(RENDER_MODES[(RENDER_MODES.indexOf(state.renderMode) + 1) % RENDER_MODES.length]),
  setExplode: (v) => set('explodeTarget', Math.min(1, Math.max(0, v))),
  toggleExplode: () => actions.setExplode(state.explodeTarget > 0.5 ? 0 : 1),
  setWantFlight: (b) => set('wantFlight', !!b),
  toggleFlight: () => actions.setWantFlight(!state.wantFlight),
  setFlightStatus: (s) => set('flight', s),                     // flight controller only
  setTempo: (t) => set('tempo', Math.min(1, Math.max(TEMPO_MIN, t))),
  togglePause: () => set('paused', !state.paused),
  toggleOrbit: () => set('autoOrbit', !state.autoOrbit),
  setOrbit: (b) => set('autoOrbit', !!b),
  setView: (v) => { state.view = null; return set('view', v); },  // always re-emits, so pressing the same view re-centres
  clearView: () => { state.view = null; },                        // camera rig calls this when the user navigates freely (no event)
  setHover: (id) => set('hoverPart', id ?? null, 'hover'),
  select: (id) => set('selectedPart', id ?? null, 'select'),
  toggleUI: () => set('uiHidden', !state.uiHidden),
  toggleSound: () => set('sound', !state.sound),
  setTour: (b) => set('tour', !!b),
  toggleTour: () => set('tour', !state.tour),
  setIntroDone: () => set('introDone', true),
  // one-shot commands (no state, just an event)
  screenshot: () => bus.emit('screenshot'),          // S — save a clean PNG of the current frame
  toggleProboscis: () => bus.emit('proboscis'),      // P — extend / fold the proboscis
  replayIntro: () => bus.emit('replayIntro'),        // I — replay the opening assembly sequence
};
