import { TAU } from './math.js'
import { partKeys, parts, scaleMM } from './specimen/parts.js'
import { wingPhase, wingStroke } from './specimen/wings.js'
import { materialDescription, themes } from './studio/themes.js'

const byId = (id) => document.getElementById(id)
const glyph = (number, width) => String(number).padStart(width, '0')
const introCopy = [
  'An articulated study of <em>Apis mellifera</em>, cast in porcelain, gilt and etched glass.',
  'An articulated study of <em>Apis mellifera</em>, in cobalt porcelain, antique brass and etched glass.',
  'An articulated study of <em>Apis mellifera</em>, in black enamel, aged brass and amber glass.',
  'An articulated study of <em>Apis mellifera</em>, in cream enamel and bronze, set on a vellum plate.',
]

export const tempoFromSlider = (position) => .008 ** (1 - Number(position))

export class Interface {
  constructor(exhibit, actions) {
    this.exhibit = exhibit
    this.actions = actions
    this.nodes = Object.fromEntries([
      'flight-status', 'assembly-status', 'status-light', 'flight-toggle', 'flight-label', 'spec-index', 'spec-title',
      'spec-description', 'spec-material', 'spec-fact', 'spec-metrics', 'specification', 'assembly', 'tempo',
      'tempo-value', 'orbit-toggle', 'telemetry', 'telemetry-clock', 'oscilloscope', 'altitude', 'airspeed',
      'heading', 'beat', 'proboscis-action', 'mobile-hide', 'restore-ui', 'console',
    ].map((id) => [id, byId(id)]))
    this.currentPart = undefined
    this.currentTheme = -1
    this.currentStatus = null
    this.currentAssembly = -1
    this.scope = this.nodes.oscilloscope.getContext('2d')
    this.telemetryDelay = 0
    this.buttons = Object.fromEntries(['view', 'render', 'theme'].map((group) => [group, Array.from(exhibit.querySelectorAll(`[data-${group}]`))]))
    this.nodes['flight-toggle'].addEventListener('click', actions.flight)
    this.nodes['orbit-toggle'].addEventListener('click', actions.orbit)
    this.nodes['mobile-hide'].addEventListener('click', actions.hide)
    this.nodes['restore-ui'].addEventListener('click', actions.hide)
    this.nodes['proboscis-action'].addEventListener('click', actions.feed)
    this.nodes.assembly.addEventListener('input', (event) => {
      this.slider(event.target, event.target.value)
      actions.assembly(Number(event.target.value))
    })
    this.nodes.tempo.addEventListener('input', (event) => {
      const value = event.target.value
      const rate = tempoFromSlider(value)
      this.slider(event.target, value)
      this.nodes['tempo-value'].textContent = rate < .1 ? rate.toFixed(3) + '×' : rate.toFixed(2) + '×'
      actions.tempo(rate)
    })
    for (const [group, buttons] of Object.entries(this.buttons)) {
      for (const [i, button] of buttons.entries()) button.addEventListener('click', () => actions[group](i))
    }
    this.slider(this.nodes.tempo, 1)
    this.slider(this.nodes.assembly, 0)
    this.nodes.tempo.setAttribute('aria-valuetext', '1× normal speed')
    this.nodes.tempo.addEventListener('input', () => this.nodes.tempo.setAttribute('aria-valuetext', this.nodes['tempo-value'].textContent + ' speed'))
    window.addEventListener('keydown', (event) => this.key(event))
  }

  key(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
    const key = event.key.toLowerCase()
    const shortcuts = {
      f: this.actions.flight, e: this.actions.explode, t: this.actions.nextTheme, r: this.actions.nextRender,
      ' ': this.actions.pause, h: this.actions.hide, escape: this.actions.escape,
    }
    if (shortcuts[key]) {
      event.preventDefault()
      shortcuts[key]()
    } else if (/^[1-5]$/.test(key)) {
      event.preventDefault()
      this.actions.view(Number(key) - 1)
    }
  }

  slider(input, position) {
    input.style.setProperty('--progress', Number(position) * 100 + '%')
  }

  select(group, value) {
    this.buttons[group].forEach((button, i) => button.setAttribute('aria-pressed', String(value === i)))
  }

  setAssembly(value) {
    this.nodes.assembly.value = value
    this.slider(this.nodes.assembly, value)
  }

  feed(extended) {
    const button = this.nodes['proboscis-action']
    button.textContent = extended ? 'Retract glossa' : 'Extend glossa'
    button.setAttribute('aria-pressed', String(extended))
  }

  hide(hidden) {
    this.exhibit.classList.toggle('ui-hidden', hidden)
    for (const element of this.exhibit.querySelectorAll('.chrome')) element.inert = hidden
    this.nodes['restore-ui'].hidden = !hidden
  }

  ready() {
    this.exhibit.classList.add('is-ready')
  }

  spec(id, theme) {
    if (this.currentPart === id && this.currentTheme === theme) return
    this.currentPart = id
    this.currentTheme = theme
    const part = parts[id]
    const n = this.nodes
    this.exhibit.classList.toggle('part-open', Boolean(part))
    n['spec-title'].textContent = part?.name ?? 'The honeybee'
    n['spec-index'].textContent = part ? glyph(partKeys.indexOf(id) + 1, 2) + ' / ' + partKeys.length : 'II / 08'
    n['spec-material'].hidden = n['spec-fact'].hidden = !part
    n['spec-metrics'].hidden = Boolean(part)
    n['proboscis-action'].hidden = id !== 'proboscis'
    if (part) {
      n['spec-description'].textContent = part.function
      n['spec-material'].textContent = materialDescription(part, theme)
      n['spec-fact'].textContent = part.fact
    } else {
      n['spec-description'].innerHTML = introCopy[theme]
    }
  }

  update(dt, flight, paused, assembly, finish) {
    const status = paused ? 'PAUSED' : flight.mode
    const percent = Math.round((1 - assembly) * 100)
    const n = this.nodes
    if (this.currentAssembly !== percent) {
      n['assembly-status'].textContent = 'ASSEMBLY ' + percent + '%'
      n.assembly.setAttribute('aria-valuetext', Math.round(assembly * 100) + '% exploded')
      this.currentAssembly = percent
    }
    if (this.currentStatus !== status || this.currentFlight !== flight.airborne) {
      const active = flight.mode === 'IN FLIGHT' || flight.mode === 'LANDING' && flight.position.y - flight.restY > .17
      n['flight-status'].textContent = status
      n['flight-label'].textContent = flight.airborne ? 'Land' : 'Take flight'
      n['flight-toggle'].setAttribute('aria-pressed', String(flight.airborne))
      n['status-light'].classList.toggle('active', active && !paused)
      this.currentStatus = status
      this.currentFlight = flight.airborne
    }
    const visible = flight.mode === 'IN FLIGHT' || flight.mode === 'LANDING' && flight.position.y - flight.restY > .15
    if (this.telemetryVisible !== visible) {
      this.telemetryVisible = visible
      n.telemetry.classList.toggle('visible', visible)
      n.telemetry.setAttribute('aria-hidden', String(!visible))
    }
    this.telemetryDelay -= dt
    if (!visible || this.telemetryDelay > 0) return
    this.telemetryDelay = .057
    const altitude = Math.max(0, (flight.position.y - flight.restY) * scaleMM / 10)
    n.altitude.textContent = altitude.toFixed(1) + ' cm'
    n.airspeed.textContent = (flight.velocity.length() * scaleMM / 1000).toFixed(3) + ' m/s'
    n.heading.textContent = glyph(Math.round((flight.yaw * 180 / Math.PI % 360 + 360) % 360) % 360, 3) + '°'
    n.beat.textContent = Math.round(flight.beat * flight.drive) + ' Hz'
    n['telemetry-clock'].textContent = flight.flightTime.toFixed(1) + ' s'
    this.drawScope(flight, finish)
  }

  drawScope(flight, finish) {
    const ctx = this.scope
    const { width, height } = ctx.canvas
    ctx.clearRect(0, 0, width, height)
    const accent = '#' + finish.current.css.accent.getHexString()
    const line = '#' + finish.current.css.line.getHexString()
    ctx.strokeStyle = line
    ctx.globalAlpha = .37
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 45; x < width; x += 53) {
      ctx.moveTo(x, 6)
      ctx.lineTo(x, height - 5)
    }
    ctx.moveTo(39, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
    const portPhase = wingPhase(flight, -1)
    const cycles = 2.65
    const trigger = 44 + (width - 44) * (portPhase / TAU % 1) / cycles
    ctx.beginPath()
    ctx.moveTo(trigger, 4)
    ctx.lineTo(trigger, height - 5)
    ctx.stroke()
    for (const side of [1, -1]) {
      ctx.beginPath()
      ctx.globalAlpha = side > 0 ? .73 : .93
      ctx.strokeStyle = side > 0 ? line : accent
      ctx.fillStyle = ctx.strokeStyle
      ctx.font = '15px "JetBrains Mono"'
      ctx.fillText(side > 0 ? 'R' : 'L', side > 0 ? 21 : 2, height * .62)
      ctx.lineWidth = side > 0 ? 1.35 : 1.75
      const amplitude = wingStroke(flight, side) / (Math.PI / 4)
      const phaseOffset = wingPhase(flight, side) - portPhase
      for (let x = 44; x <= width; x += 3) {
        const t = (x - 44) / (width - 44)
        const phase = t * TAU * cycles + phaseOffset
        const y = height * .5 + Math.sin(phase) * height * .28 * amplitude * flight.drive
        x === 44 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}
