import { editions } from './materials.js';
import { catalogue, partMaterial } from './catalogue.js';
import { tempoFromSlider } from './flight.js';
import { MM_PER_UNIT } from './labels.js';

const $ = (id) => document.getElementById(id);
export class UI {
  constructor(app) {
    this.app = app;
    this.hidden = false;
    this.lastPart = undefined;
    this.lastStatus = '';
    this.lastPct = -1;
    this.lastTheme = -1;
    this.lastTelemetry = 0;
    this.views = ['ISO', 'PLAN', 'FRONT', 'PROFILE', 'MACRO'];
    this.renders = ['SOLID', 'SECTION', 'SCHEMATIC'];
    const buttons = (parent, list, action) => {
      for (const [i, name] of list.entries()) {
        const b = document.createElement('button');
        b.textContent = name;
        b.dataset.index = i;
        b.setAttribute('aria-pressed', i === 0);
        b.onclick = () => action(i);
        parent.append(b);
      }
    };
    buttons($('view-options'), this.views, (i) => this.view(i));
    buttons($('render-options'), this.renders, (i) => this.render(i));
    for (const b of document.querySelectorAll('[data-theme]'))
      b.onclick = () => this.theme(+b.dataset.theme);
    $('flight').onclick = () => this.flight();
    $('orbit').onclick = () => {
      app.camera.orbit = !app.camera.orbit;
      this.syncOrbit();
    };
    app.camera.onNavigate = () => this.syncOrbit();
    $('explode').oninput = (e) => {
      app.explodeTarget = +e.target.value / 100;
      e.target.style.setProperty('--fill', e.target.value + '%');
    };
    $('tempo').oninput = (e) => {
      app.flight.tempo = tempoFromSlider(+e.target.value);
      $('tempo-val').textContent = this.tempoLabel(app.flight.tempo);
      e.target.style.setProperty('--fill', e.target.value + '%');
    };
    $('glossa').onclick = () => {
      app.flight.tongueOut = !app.flight.tongueOut;
      this.glossa();
    };
    const help = $('help-toggle');
    if (innerWidth <= 700) help.setAttribute('aria-expanded', 'false');
    help.onclick = () =>
      help.setAttribute('aria-expanded', help.getAttribute('aria-expanded') === 'false');
    document.addEventListener('keydown', (e) => this.key(e));
    this.scope = $('scope').getContext('2d');
    this.specObserver = new ResizeObserver(([entry]) =>
      document.documentElement.style.setProperty('--spec-height', entry.contentRect.height + 'px')
    );
    this.specObserver.observe(document.querySelector('.specs'));
  }
  tempoLabel(t) {
    return t > 0.99 ? '1×' : t >= 0.1 ? t.toFixed(2) + '×' : '1/' + Math.round(1 / t) + '×';
  }
  pressed(group, i) {
    for (const [j, b] of [...group.children].entries()) b.setAttribute('aria-pressed', i === j);
  }
  view(i) {
    this.app.resetFocus(false);
    this.app.camera.preset(this.views[i]);
    this.pressed($('view-options'), i);
    this.syncOrbit();
  }
  syncOrbit() {
    $('orbit').setAttribute('aria-pressed', this.app.camera.orbit);
  }
  render(i) {
    this.app.mode = i;
    this.pressed($('render-options'), i);
  }
  theme(i) {
    this.app.materials.selectTheme(i);
    for (const b of document.querySelectorAll('[data-theme]'))
      b.setAttribute('aria-pressed', +b.dataset.theme === i);
    document.querySelector('meta[name=theme-color]').content = editions[i].floor;
  }
  flight() {
    this.app.flight.toggle();
    this.updateStatus();
  }
  glossa() {
    $('glossa').textContent = this.app.flight.tongueOut ? 'Retract glossa' : 'Extend glossa';
  }
  toggleUI() {
    this.hidden = !this.hidden;
    document.body.classList.toggle('ui-hidden', this.hidden);
    $('chrome').inert = this.hidden;
    $('labels').inert = this.hidden;
    this.app.hovered = null;
    if (this.hidden) $('notice').classList.remove('visible');
  }
  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.target.isContentEditable) return;
    const k = e.key.toLowerCase(),
      a = this.app;
    if (k === 'h') {
      this.toggleUI();
      return;
    }
    if (k === 'escape') {
      if (this.hidden) this.toggleUI();
      else a.resetFocus();
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      a.flight.paused = !a.flight.paused;
      this.toast(a.flight.paused ? 'Study paused' : 'Study resumed');
      return;
    }
    if (k === 'f') this.flight();
    else if (k === 'e') a.explodeTarget = a.explodeTarget > 0.49 ? 0 : 1;
    else if (k === 'r') this.render((a.mode + 1) % 3);
    else if (k === 't') this.theme((a.materials.index + 1) % 4);
    else if (/^[1-5]$/.test(k)) this.view(+k - 1);
  }
  toast(msg) {
    if (this.hidden) return;
    const n = $('notice');
    n.textContent = msg;
    n.classList.add('visible');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => n.classList.remove('visible'), 1200);
  }
  updateStatus() {
    const f = this.app.flight;
    if (f.state === this.lastStatus) return;
    this.lastStatus = f.state;
    $('status-text').textContent = f.state;
    $('flight').querySelector('span').textContent = f.goal ? 'Land' : 'Take flight';
    $('flight').setAttribute('aria-label', f.goal ? 'Land' : 'Take flight');
    document.body.classList.toggle('airborne', f.state !== 'RESTING');
  }
  update(part, assembled, time) {
    const a = this.app,
      f = a.flight,
      index = a.materials.index;
    this.updateStatus();
    if (this.lastPart !== part || this.lastTheme !== index) {
      const c = catalogue[part];
      $('spec-label').textContent = c ? 'Component specification' : 'Specification';
      $('spec-name').textContent = c ? c[0] : 'Apis mellifera';
      $('spec-description').textContent = c ? c[2] : editions[index].description;
      $('spec-material').hidden = !c;
      $('spec-fact').hidden = !c;
      if (c) {
        $('spec-material').lastElementChild.textContent = partMaterial(part, index);
        $('spec-fact').textContent = c[3];
      }
      $('glossa').hidden = part !== 'proboscis';
      this.glossa();
      document.body.classList.toggle('part-selected', !!c);
      this.lastPart = part;
      this.lastTheme = index;
    }
    const pct = Math.round(assembled * 100);
    if (pct !== this.lastPct) {
      $('assembly-pct').textContent = pct + '%';
      this.lastPct = pct;
    }
    const range = $('explode');
    if (
      document.activeElement !== range ||
      Math.abs(+range.value / 100 - a.explodeTarget) > 0.002
    ) {
      range.value = a.explodeTarget * 100;
      range.style.setProperty('--fill', range.value + '%');
    }
    if (time - this.lastTelemetry < 0.09) return;
    this.lastTelemetry = time;
    const yscale =
      a.camera.h / (2 * a.camera.distance * Math.tan((a.camera.camera.fov * Math.PI) / 360));
    document.querySelector('.plate-scale>i').style.width =
      Math.round((25 / MM_PER_UNIT) * yscale) + 'px';
    if (f.state === 'RESTING' || this.hidden) return;
    $('alt').textContent = Math.round(f.pos.y * MM_PER_UNIT) + ' mm';
    $('air').textContent = Math.round(f.vel.length() * MM_PER_UNIT) + ' mm/s';
    $('hdg').textContent =
      String(Math.round((270 + (f.yaw * 180) / Math.PI + 360) % 360)).padStart(3, '0') + '°';
    $('hz').textContent = Math.round(f.beat) + ' Hz';
    const g = this.scope,
      w = g.canvas.width,
      h = g.canvas.height;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#' + a.materials.colors.line.getHexString();
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, h * 0.5);
    g.lineTo(w, h * 0.5);
    g.stroke();
    // At high beat rates the scope triggers on a zero crossing, like a bench oscilloscope.
    const trigger = f.beat * f.actualTempo < 6 ? f.phase : 0;
    for (const side of [-1, 1]) {
      g.strokeStyle =
        '#' + (side > 0 ? a.materials.colors.accent : a.materials.colors.muted).getHexString();
      g.globalAlpha = side > 0 ? 0.9 : 0.63;
      g.lineWidth = 1.55;
      g.beginPath();
      for (let x = 14; x < w; x += 2) {
        const phase = ((x - 14) / (w - 14)) * Math.PI * 7 + trigger + side * f.asym * 0.075,
          y =
            h * 0.5 +
            (side * 2.5 + Math.sin(phase) * h * 0.31 * (1 + side * f.asym * 0.18)) * f.visiblePower;
        x > 14 ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = '10px Plex,monospace';
      g.fillText(side > 0 ? 'L' : 'R', 1, side > 0 ? 13 : 30);
    }
    g.globalAlpha = 1;
  }
}
