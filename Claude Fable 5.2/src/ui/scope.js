// ─────────────────────────────────────────────────────────────────────────────
// ui/scope.js — wing-stroke oscilloscope for the telemetry block.
// Draws ~2.5 cycles per wing as a triggered trace: amplitude = amp / 90° (the
// nominal stroke), phase scrolling at min(beatHz · tempo, 1.6) Hz so it reads
// as a slow, legible sweep rather than an aliased blur. Left wing = solid
// heavier trace, right wing = fine dashed trace, on a hairline graticule.
// ─────────────────────────────────────────────────────────────────────────────
import { TAU, damp } from '../core/math.js';

const CYCLES = 2.5;
const DIV_X = 10, DIV_Y = 4;

export function createScope(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  let phase = 0;
  const amp = { l: 1, r: 1 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  }

  function trace(a, ph, color, width, dash) {
    const mid = h / 2, A = a * h * 0.36;
    ctx.beginPath();
    const n = Math.max(48, Math.round(w / 2));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const y = mid - Math.sin(u * TAU * CYCLES - ph) * A;
      const x = u * w;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.setLineDash(dash);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * @param {number} dt
   * @param {{ink:string, inkSoft:string, line:string}} colors '#rrggbb'
   * @param {object} tel state.telemetry
   * @param {number} tempo state.tempo
   * @param {boolean} paused
   */
  function draw(dt, colors, tel, tempo, paused) {
    if (!w || !h) return;
    const f = Math.min((tel.beatHz || 0) * tempo, 1.6);
    if (!paused) phase = (phase + TAU * f * dt) % (TAU * 1000);
    amp.l = damp(amp.l, (tel.ampL || 0) / 90, 12, dt);
    amp.r = damp(amp.r, (tel.ampR || 0) / 90, 12, dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const px = 1 / dpr;

    // graticule
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = Math.max(px, 0.75);
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    for (let i = 1; i < DIV_X; i++) { const x = Math.round((i / DIV_X) * w * dpr) / dpr + px / 2; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.setLineDash([1, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // nominal ±90° guides
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (const s of [-1, 1]) { const y = Math.round((h / 2 - s * h * 0.36) * dpr) / dpr + px / 2; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // centre axis with minor ticks
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    const cy = Math.round((h / 2) * dpr) / dpr + px / 2;
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    for (let i = 0; i <= DIV_X * 5; i++) {
      const x = Math.round((i / (DIV_X * 5)) * w * dpr) / dpr + px / 2;
      const t = i % 5 === 0 ? 3 : 1.5;
      ctx.moveTo(x, cy - t); ctx.lineTo(x, cy + t);
    }
    ctx.stroke();
    // frame (top and bottom hairlines only)
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(0, px / 2); ctx.lineTo(w, px / 2);
    ctx.moveTo(0, h - px / 2); ctx.lineTo(w, h - px / 2);
    for (let j = 1; j < DIV_Y; j++) {
      if (j === DIV_Y / 2) continue;
      const y = Math.round((j / DIV_Y) * h * dpr) / dpr + px / 2;
      ctx.moveTo(0, y); ctx.lineTo(4, y); ctx.moveTo(w - 4, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    // traces
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.95;
    trace(amp.l, phase, colors.ink, 1.5, []);
    ctx.globalAlpha = 0.9;
    trace(amp.r, phase, colors.ink, 0.9, [3, 2.5]);
    ctx.globalAlpha = 1;
  }

  return { resize, draw };
}
