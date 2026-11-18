// ─────────────────────────────────────────────────────────────────────────────
// ui/sound.js — a soft, warm wing hum (off by default; M toggles state.sound).
//
//   createSound() → { update(dt) }
//
//  · WebAudio is created only inside a user gesture (the M keypress itself, or
//    the first pointer / key event after sound is switched on)
//  · hum pitch = telemetry.beatHz · tempo; level follows flightAmount and thrust;
//    slight stereo bias from ampL − ampR
//  · as TEMPO slows the pitch glides down; below ≈25 Hz the hum dissolves into
//    individual soft "whoomphs", one per down-stroke (and a fainter up-stroke),
//    derived from telemetry.phase
//  · silent when paused; gentle low-pass; all gains eased; master ≤ −18 dBFS
// ─────────────────────────────────────────────────────────────────────────────
import { state, bus } from '../core/state.js';
import { clamp, smoothstep, TAU } from '../core/math.js';

const MASTER = 0.11;           // ≈ −19 dBFS ceiling for the summed voices
const HUM_SPLIT_LO = 18, HUM_SPLIT_HI = 34;  // Hz: hum ↔ whoomph crossfade band

export function createSound() {
  let ctx = null, nodes = null;
  let silentFor = 0, suspended = false;
  let lastCycle = null, lastHalf = null;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = null; return false; }
    const master = ctx.createGain(); master.gain.value = 0;
    const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 900; lowpass.Q.value = 0.4;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;

    // hum: one warm periodic wave (fundamental + soft harmonics) and a slightly detuned twin
    const real = new Float32Array([0, 0, 0, 0, 0, 0, 0]);
    const imag = new Float32Array([0, 1, 0.34, 0.12, 0.05, 0.02, 0.008]);
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    const osc1 = ctx.createOscillator(); osc1.setPeriodicWave(wave); osc1.frequency.value = 230;
    const osc2 = ctx.createOscillator(); osc2.setPeriodicWave(wave); osc2.frequency.value = 230; osc2.detune.value = 7;
    const humGain = ctx.createGain(); humGain.gain.value = 0;
    const g1 = ctx.createGain(); g1.gain.value = 0.62;
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    osc1.connect(g1).connect(humGain);
    osc2.connect(g2).connect(humGain);

    // air: band-passed noise riding on the hum
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 9 + (Math.random() * 2 - 1) * 0.05; }
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const airBand = ctx.createBiquadFilter(); airBand.type = 'bandpass'; airBand.frequency.value = 460; airBand.Q.value = 0.8;
    const airGain = ctx.createGain(); airGain.gain.value = 0;
    noise.connect(airBand).connect(airGain);

    humGain.connect(lowpass);
    airGain.connect(lowpass);
    const whoomphBus = ctx.createGain(); whoomphBus.gain.value = 1;
    whoomphBus.connect(lowpass);
    if (pan) { lowpass.connect(pan).connect(comp); } else lowpass.connect(comp);
    comp.connect(master).connect(ctx.destination);

    osc1.start(); osc2.start(); noise.start();
    nodes = { master, lowpass, pan, osc1, osc2, humGain, airGain, airBand, noiseBuf, whoomphBus };
    return true;
  }

  let failed = false;
  function ensure() {
    if (!state.sound || failed || document.hidden) return;
    if (!ctx && !build()) { failed = true; return; }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    suspended = false;
  }
  // gestures that may (re)start audio
  const gesture = () => { if (state.sound) ensure(); };
  window.addEventListener('pointerdown', gesture, { passive: true });
  window.addEventListener('keydown', gesture);
  bus.on('sound', ({ value }) => { if (value) ensure(); });
  // a hidden tab stops calling update(): fade out and park instead of droning on
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !nodes) return;
    if (document.hidden) {
      nodes.master.gain.cancelScheduledValues(ctx.currentTime);
      nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      setTimeout(() => { if (document.hidden && ctx.state === 'running') { suspended = true; ctx.suspend().catch(() => {}); } }, 250);
    }
    lastCycle = lastHalf = null;   // no burst of whoomphs for the phase that passed meanwhile
  });

  const ramp = (param, v, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);

  function whoomph(level, strength, pan) {
    const t = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = nodes.noiseBuf;
    src.playbackRate.value = 0.7 + strength * 0.25;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 260 + strength * 220; bp.Q.value = 0.7;
    const g = ctx.createGain();
    const peak = level * (0.55 + strength * 0.45);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.045);
    g.gain.setTargetAtTime(0.0001, t + 0.06, 0.07 + 0.05 * (1 - strength));
    // a soft low thump under the air
    const th = ctx.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(78, t); th.frequency.exponentialRampToValueAtTime(46, t + 0.22);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.linearRampToValueAtTime(peak * 0.5, t + 0.03);
    tg.gain.setTargetAtTime(0.0001, t + 0.05, 0.06);
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); out = p; }
    src.connect(bp).connect(g);
    th.connect(tg).connect(nodes.whoomphBus);
    out.connect(nodes.whoomphBus);
    // stop only once both envelopes are ~60 dB down, so no voice is ever cut audibly
    const offset = Math.random() * 1.0;
    src.start(t, offset, 0.95);
    th.start(t); th.stop(t + 0.7);
  }

  function update(dt) {
    if (!ctx || !nodes) return;
    const tel = state.telemetry;
    const audible = state.sound && !state.paused;
    const f = Math.max(0, (tel.beatHz || 0) * state.tempo);
    const activity = Math.max(clamp(state.flightAmount || 0), 0.55 * smoothstep(0, 230, tel.beatHz || 0));
    const thrustK = 0.6 + 0.4 * clamp(tel.thrust || 0, 0, 1.5);
    const level = audible ? clamp(activity * thrustK, 0, 1.15) : 0;

    if (level <= 0.0005) {
      // fade out, then park the context so a silent piece costs no CPU
      if (ctx.state === 'running') {
        silentFor += dt;
        ramp(nodes.master.gain, 0, 0.08);
        if (silentFor > 1.5 && !suspended) { suspended = true; ctx.suspend().catch(() => {}); }
      }
      lastCycle = lastHalf = null;
      return;
    }
    silentFor = 0;
    if (suspended || ctx.state === 'suspended') { suspended = false; ctx.resume().catch(() => {}); }

    ramp(nodes.master.gain, MASTER * level, 0.12);
    // hum ↔ whoomph crossfade by effective frequency
    const humK = smoothstep(HUM_SPLIT_LO, HUM_SPLIT_HI, f);
    const fHum = Math.max(f, 12);
    ramp(nodes.osc1.frequency, fHum, 0.06);
    ramp(nodes.osc2.frequency, fHum, 0.06);
    ramp(nodes.humGain.gain, humK * 0.8, 0.1);
    ramp(nodes.airGain.gain, humK * 0.06, 0.15);
    ramp(nodes.airBand.frequency, clamp(fHum * 2, 120, 900), 0.1);
    // low-pass tracks the pitch so slow tempos stay dark and soft
    ramp(nodes.lowpass.frequency, clamp(fHum * 3.2 + 180, 260, 1300), 0.1);
    // stereo bias: the stronger-beating wing leans the hum toward its side (left wing → left)
    const stereo = clamp(((tel.ampR || 0) - (tel.ampL || 0)) / 40, -0.35, 0.35);
    if (nodes.pan) ramp(nodes.pan.pan, stereo, 0.15);

    // whoomphs below the split band: one per down-stroke, plus a fainter
    // up-stroke once the beat is slow enough to hear them apart
    const phase = tel.phase || 0;
    const cycle = Math.floor(phase / TAU), half = Math.floor(phase / Math.PI);
    if (lastCycle == null) { lastCycle = cycle; lastHalf = half; }
    const whK = 1 - humK;
    if (whK > 0.08 && f > 0.05 && half > lastHalf) {
      const down = half % 2 === 0;
      if (down || f < 8) whoomph(whK * 0.9, down ? 1 : 0.45, stereo);
    }
    lastCycle = cycle; lastHalf = half;
  }

  return { update };
}
