// ─────────────────────────────────────────────────────────────────────────────
// ui/widgets.js — small hand-built controls used by the chrome.
//   createSlider()     hairline range slider (pointer + keyboard), no native input
//   createSegmented()  row of text/icon buttons with a gliding active indicator
//   el(), setStyle()   tiny DOM helpers (setStyle caches, so unchanged values
//                      never touch the DOM)
// ─────────────────────────────────────────────────────────────────────────────
import { clamp, damp } from '../core/math.js';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

const styleCache = new WeakMap();
/** Write a style property only if it changed since the last write through this helper. */
export function setStyle(node, prop, value) {
  let c = styleCache.get(node);
  if (!c) styleCache.set(node, (c = {}));
  if (c[prop] === value) return;
  c[prop] = value;
  if (prop.startsWith('--')) node.style.setProperty(prop, value);
  else node.style[prop] = value;
}
export function setClass(node, cls, on) {
  if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}
export function setText(node, text) {
  if (node.__t !== text) { node.__t = text; node.textContent = text; }
}

/**
 * @param {object} o
 * @param {string} o.label        aria label
 * @param {number[]} [o.ticks]    major tick positions 0..1
 * @param {number[]} [o.minor]    minor tick positions 0..1
 * @param {(v:number)=>void} o.onInput
 * @param {(v:number)=>void} [o.onCommit]
 * @param {()=>void} [o.onReset]  double-click
 * @param {number} [o.step=0.02]  keyboard step
 */
export function createSlider(o) {
  const root = el('div', 'am-slider am-interactive');
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', o.label);
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  root.append(el('div', 'am-slider-track'));
  for (const t of o.ticks ?? [0, 1]) { const k = el('i', 'am-slider-tick'); k.style.left = `calc(${t * 100}% - 0.5px)`; root.append(k); }
  for (const t of o.minor ?? []) { const k = el('i', 'am-slider-tick is-minor'); k.style.left = `calc(${t * 100}% - 0.5px)`; root.append(k); }
  const fill = el('div', 'am-slider-fill');
  const thumb = el('div', 'am-slider-thumb');
  root.append(fill, thumb);

  let width = 0;           // measured track width (px)
  let shown = 0;           // displayed value (eased)
  let dragValue = null;    // value under the finger while dragging
  let dragging = false;
  let pid = null;

  const valueAt = (clientX) => {
    const r = root.getBoundingClientRect();
    width = r.width;
    return clamp((clientX - r.left) / Math.max(1, r.width));
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    root.classList.add('is-pointer');               // mouse / touch use: no keyboard focus ring
    root.focus({ preventScroll: true });
    pid = e.pointerId;
    try { root.setPointerCapture(pid); } catch { /* pointer already gone */ }
    dragging = true;
    root.classList.add('is-drag');
    dragValue = valueAt(e.clientX);
    o.onInput(dragValue);
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dragValue = valueAt(e.clientX);
    o.onInput(dragValue);
  });
  const end = (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    root.classList.remove('is-drag');
    o.onCommit?.(dragValue);
    dragValue = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('dblclick', () => o.onReset?.());
  root.addEventListener('blur', () => root.classList.remove('is-pointer'));
  root.addEventListener('keydown', (e) => {
    root.classList.remove('is-pointer');
    const step = o.step ?? 0.02;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else if (e.key === 'Home') d = -1;
    else if (e.key === 'End') d = 1;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const v = clamp((o.getValue?.() ?? shown) + d * (e.shiftKey ? 5 : 1));
    o.onInput(v);
    o.onCommit?.(v);
  });

  return {
    root,
    get dragging() { return dragging; },
    measure() { width = root.offsetWidth; },
    /** @param {number} value external value 0..1 (ignored while dragging) */
    update(dt, value) {
      const target = dragging && dragValue != null ? dragValue : value;
      shown = dragging ? damp(shown, target, 30, dt) : damp(shown, target, 18, dt);
      if (Math.abs(shown - target) < 1e-4) shown = target;
      const x = (shown * width).toFixed(2);
      setStyle(thumb, 'transform', `translate3d(${x}px,0,0)`);
      setStyle(fill, 'transform', `scaleX(${shown.toFixed(4)})`);
      const pct = String(Math.round(shown * 100));
      if (root.__pct !== pct) { root.__pct = pct; root.setAttribute('aria-valuenow', pct); }
    },
  };
}

/**
 * @param {object} o
 * @param {{id:string, html:string, title?:string}[]} o.items
 * @param {(id:string)=>void} o.onSelect
 * @param {string} [o.cls]          extra class on the container
 * @param {string} [o.itemCls]      class for each button
 * @param {'line'|'pill'} [o.indicator='line']
 */
export function createSegmented(o) {
  const root = el('div', (o.cls ?? 'am-seg') + ' am-interactive');
  root.setAttribute('role', 'radiogroup');
  const ind = el('span', o.indicator === 'pill' ? 'am-seg-ind' : 'am-seg-line');
  root.append(ind);
  const buttons = o.items.map((it) => {
    const b = el('button', o.itemCls ?? '', it.html);
    b.type = 'button';
    b.dataset.id = it.id;
    b.setAttribute('role', 'radio');
    if (it.title) b.setAttribute('aria-label', it.title);
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep keyboard focus where it was
    b.addEventListener('click', () => o.onSelect(it.id));
    root.append(b);
    return b;
  });
  let rects = null;        // [{x, w}] measured
  const pos = { x: 0, w: 0, a: 0, init: false };
  let active = null;

  return {
    root,
    buttons,
    measure() {
      rects = buttons.map((b) => ({ x: b.offsetLeft, w: b.offsetWidth }));
    },
    update(dt, activeId) {
      if (activeId !== active) {
        active = activeId;
        buttons.forEach((b) => { const on = b.dataset.id === activeId; setClass(b, 'is-active', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      }
      if (!rects) return;
      const i = o.items.findIndex((it) => it.id === activeId);
      const targetA = i >= 0 ? 1 : 0;
      if (i >= 0) {
        const r = rects[i];
        const inset = o.indicator === 'pill' ? 0 : 0.18 * r.w;
        const tx = r.x + inset, tw = r.w - inset * 2;
        if (!pos.init || pos.a < 0.02) { pos.x = tx; pos.w = tw; pos.init = true; }
        pos.x = damp(pos.x, tx, 14, dt);
        pos.w = damp(pos.w, tw, 14, dt);
      }
      pos.a = damp(pos.a, targetA, 10, dt);
      setStyle(ind, 'transform', `translate3d(${pos.x.toFixed(2)}px,0,0)`);
      setStyle(ind, 'width', `${pos.w.toFixed(2)}px`);
      setStyle(ind, 'opacity', pos.a.toFixed(3));
    },
  };
}
