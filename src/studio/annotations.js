import { Vector3 } from 'three'
import { clamp, smooth } from '../math.js'
import { dimensions, partKeys, parts } from '../specimen/parts.js'
import { socketX, socketY, socketZ } from '../specimen/wings.js'

export class Annotations {
  constructor(canvas, labels, assembly, camera, finishes, interact) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.camera = camera
    this.assembly = assembly
    this.finish = finishes
    this.interact = interact
    this.world = new Vector3()
    this.projected = new Vector3()
    this.buttons = new Map()
    for (const id of partKeys) {
      const part = parts[id]
      const button = document.createElement('button')
      const name = document.createElement('strong')
      const caption = document.createElement('small')
      button.type = 'button'
      button.className = 'part-label'
      button.hidden = true
      button.dataset.part = id
      name.textContent = part.name
      caption.textContent = part.caption
      button.append(name, caption)
      labels.append(button)
      button.addEventListener('pointerenter', () => interact.hover(id))
      button.addEventListener('pointerleave', () => interact.hover(null))
      button.addEventListener('focus', () => interact.hover(id))
      button.addEventListener('blur', () => interact.hover(null))
      button.addEventListener('click', () => interact.select(id, this.buttons.get(id).anchor))
      this.buttons.set(id, { button, alpha: 0 })
    }
    this.layoutSelectors = ['.masthead', '.upper-right', '.specification', '.controls-legend', '.console']
    this.bounds = {}
    this.lastLayout = 0
  }

  resize(width, height) {
    this.width = width
    this.height = height
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio))
    this.canvas.width = Math.round(width * this.dpr)
    this.canvas.height = Math.round(height * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.lastLayout = 0
  }

  project(point, object) {
    this.projected.copy(point)
    if (object) this.projected.applyMatrix4(object.matrixWorld)
    this.projected.project(this.camera)
    return {
      x: (this.projected.x * .5 + .5) * this.width,
      y: (1 - this.projected.y) * .5 * this.height,
      z: this.projected.z,
    }
  }

  anchor(id, screen) {
    if (screen) return screen
    return this.assembly.anchors.get(id)?.find((a) => a.side === 1) ?? this.assembly.anchors.get(id)?.[0]
  }

  chooseAnchors() {
    const groups = []
    const footprints = []
    const focalPixels = this.height * .5 / Math.tan(this.camera.fov * Math.PI / 360)
    for (const [id, anchors] of this.assembly.anchors) {
      const candidates = []
      for (const anchor of anchors) {
        this.world.copy(anchor.point).applyMatrix4(anchor.node.matrixWorld)
        const depth = -this.projected.copy(this.world).applyMatrix4(this.camera.matrixWorldInverse).z
        if (depth < this.camera.near) continue
        const position = { anchor, ...this.project(this.world) }
        footprints.push({ ...position, radius: focalPixels * anchor.radius / depth * .90 })
        if (position.x > 8 && position.x < this.width - 8 && position.y > 18 && position.y < this.height - 18) candidates.push(position)
      }
      candidates.sort((a, b) => a.z - b.z)
      if (candidates[0]) groups.push({ id, ...candidates[0], priority: parts[id].priority ?? 90 })
    }
    this.footprints = footprints
    return groups
  }

  layout(anchors, highlighted) {
    const w = this.width
    const h = this.height
    const narrow = w < 790
    const labelWidth = narrow ? 105 : Math.min(193, .144 * w)
    const edge = narrow ? 19 : clamp(w * .045, 31, 88)
    const padding = narrow ? 13 : 15
    const safe = this.bounds
    const footerTop = safe['.console'].top - (narrow ? 18 : 20)
    const centres = [
      { x: edge, low: Math.min(footerTop, safe['.specification'].top - 13), high: Math.max(safe['.masthead'].bottom, narrow ? safe['.upper-right'].bottom : 0) + padding, items: [] },
      { x: w - edge - labelWidth, low: Math.min(footerTop, narrow || !safe['.controls-legend'].height ? h : safe['.controls-legend'].top - 14), high: safe['.upper-right'].bottom + padding, items: [] },
    ]
    const dense = narrow || h < 765
    const intersecting = (x, y, width, height) => this.footprints.some((point) => {
      const nearestX = clamp(point.x, x, x + width)
      const nearestY = clamp(point.y, y, y + height)
      return (nearestX - point.x) ** 2 + (nearestY - point.y) ** 2 < point.radius ** 2
    })
    const mainIds = dense ? ['eyes', 'motor', 'tergites', 'forewings', 'hamuli', 'plates'] : ['eyes', 'motor', 'tergites', 'forewings', 'hamuli', 'plates', 'core', 'legs', 'housing']
    const selected = anchors.filter(({ id }) => mainIds.includes(id) || id === highlighted)
      .sort((a, b) => (a.id === highlighted ? -1 : b.id === highlighted ? 1 : a.priority - b.priority))
    for (const item of selected) {
      const previous = this.buttons.get(item.id).column
      const freeSide = previous !== undefined && Math.abs(item.x / w - .51) < .055 ? previous : item.x < w * .51 ? 0 : 1
      const choices = [freeSide, 1 - freeSide]
      const max = narrow ? 3 : 5
      const column = choices.find((index) => centres[index].items.length < max && centres[index].low - centres[index].high > 35)
      if (column !== undefined) centres[column].items.push(item)
    }
    const positioned = []
    for (const [index, column] of centres.entries()) {
      const height = narrow ? 36 : 44
      const gap = narrow ? 41 : 52
      const slots = Math.max(0, Math.floor((column.low - column.high - height) / gap) + 1)
      const list = column.items.slice(0, slots).sort((a, b) => a.y - b.y)
      let next = column.high
      for (const [i, item] of list.entries()) {
        const y = Math.max(next, Math.min(item.y - height * .5, column.low - height - (list.length - 1 - i) * gap))
        const alternate = [y, y - 11, y + 11].find((position) => position >= next && position + height <= column.low && !intersecting(column.x, position, labelWidth, height))
        if (alternate === undefined) continue
        positioned.push({ ...item, labelX: column.x, labelY: alternate, width: labelWidth, labelHeight: height, left: index === 0 })
        next = alternate + gap
      }
    }
    return positioned
  }

  update(dt, root, amount, drawing, highlight, ready, hidden, focus) {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)
    if (hidden || !ready) return
    const explode = smooth(.34, .72, amount)
    const anchors = (explode > .002 || drawing > .01) ? this.chooseAnchors() : []
    let labels = []
    if (explode > .002 && !focus) {
      this.lastLayout -= dt
      if (this.lastLayout <= 0) {
        for (const key of this.layoutSelectors) this.bounds[key] = document.querySelector(key).getBoundingClientRect()
        this.lastLayout = .19
      }
      labels = this.layout(anchors, highlight)
    }
    const active = new Set(labels.map(({ id }) => id))
    const accent = '#' + this.finish.current.css.accent.getHexString()
    const line = '#' + this.finish.current.css.line.getHexString()
    for (const item of labels) {
      const { id, x, y, labelX, labelY, width, labelHeight, left, anchor } = item
      const entry = this.buttons.get(id)
      const selected = id === highlight
      entry.anchor = anchor
      entry.column = left ? 0 : 1
      entry.button.hidden = false
      entry.button.classList.toggle('highlighted', selected)
      entry.button.classList.toggle('left', left)
      entry.alpha = lerpFrame(entry.alpha, explode * (highlight && !selected ? .60 : 1), dt)
      entry.button.style.opacity = entry.alpha.toFixed(3)
      entry.button.style.width = width + 'px'
      // The layout is already collision-free, so labels are placed at the solved positions.
      entry.button.style.transform = `translate(${Math.round(labelX)}px,${Math.round(labelY)}px)`
      const attach = left ? labelX + width : labelX
      const base = labelY + labelHeight * .56
      const elbow = attach + (left ? 1 : -1) * Math.min(54, Math.max(15, Math.abs(attach - x) * .38))
      ctx.globalAlpha = entry.alpha * (selected ? .85 : .58)
      ctx.strokeStyle = selected ? accent : line
      ctx.fillStyle = selected ? accent : line
      ctx.lineWidth = selected ? 1.05 : .75
      ctx.beginPath()
      ctx.moveTo(attach, base)
      ctx.lineTo(elbow, base)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, selected ? 2.9 : 2, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const [id, entry] of this.buttons) {
      if (active.has(id)) continue
      if (explode < .06 || focus) {
        entry.alpha = lerpFrame(entry.alpha, 0, dt)
        entry.button.style.opacity = entry.alpha.toFixed(3)
      } else entry.alpha = 0
      if (entry.alpha < .018) entry.button.hidden = true
    }
    ctx.globalAlpha = 1
    if (drawing > .014 && !focus) this.drawSchematic(root, drawing * (1 - explode * .88), anchors, accent)
  }

  drawSchematic(root, opacity, anchors, ink) {
    const ctx = this.ctx
    const point = (x, y, z) => this.project(this.world.set(x, y, z), root)
    const fontSize = this.width < 720 ? 8 : 10
    ctx.strokeStyle = ink
    ctx.fillStyle = ink
    ctx.lineWidth = .82
    ctx.font = `${fontSize}px "JetBrains Mono"`
    ctx.textAlign = 'center'
    ctx.lineCap = 'round'
    ctx.globalAlpha = opacity * .72
    const end = point(0, -.095, -3.55)
    const nose = point(0, -.095, 2.10)
    const port = point(-4.65, .63, .46)
    const starboard = point(4.65, .63, .46)
    this.measure(end, nose, this.width < 720 ? -36 : -76, dimensions.body + ' mm')
    this.measure(port, starboard, this.width < 720 ? -35 : -61, dimensions.span + ' mm')
    this.segmented([point(0, .056, -4.1), point(0, .056, 2.87)], [8, 3, 2, 3])
    this.segmented([point(-4.65, .62, socketZ), point(4.65, .62, socketZ)], [5, 4])
    const arc = []
    for (let i = 0; i <= 34; i++) {
      const a = (-1 + i / 17) * Math.PI / 4
      const r = 2.65
      arc.push(point(socketX - r * Math.sin(a), socketY + .78, socketZ - r * Math.cos(a)))
    }
    this.segmented(arc, [3, 3])
    const angle = arc[19]
    ctx.fillText(dimensions.stroke + '°', angle.x + 6, angle.y - 7)
    const callouts = ['eyes', 'plates', 'hinges', 'tergites', 'corbicula']
    const placed = []
    for (const [i, id] of callouts.entries()) {
      const target = anchors.find((a) => a.id === id)
      if (!target) continue
      const x = target.x + (i % 2 ? -1 : 1) * (37 + i * 3)
      const y = target.y + (i % 2 ? 1 : -1) * (29 + i * 5)
      if (placed.some((p) => Math.hypot(x - p.x, y - p.y) < 26)) continue
      placed.push({ x, y })
      this.segmented([target, { x, y }], [2, 3])
      ctx.beginPath()
      ctx.arc(x, y, 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillText(String(i + 1).padStart(2, '0'), x, y + 3)
    }
    ctx.globalAlpha = 1
  }

  measure(a, b, distance, caption) {
    const ctx = this.ctx
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 28) return
    const tx = (b.x - a.x) / length
    const ty = (b.y - a.y) / length
    const nx = -ty
    const ny = tx
    const c = { x: a.x + nx * distance, y: a.y + ny * distance }
    const d = { x: b.x + nx * distance, y: b.y + ny * distance }
    this.segmented([a, c], [2, 3])
    this.segmented([b, d], [2, 3])
    this.segmented([c, d], [])
    for (const [p, direction] of [[c, 1], [d, -1]]) {
      this.segmented([
        { x: p.x + tx * direction * 8 + nx * 3, y: p.y + ty * direction * 8 + ny * 3 },
        p,
        { x: p.x + tx * direction * 8 - nx * 3, y: p.y + ty * direction * 8 - ny * 3 },
      ], [])
    }
    ctx.fillText(caption, (c.x + d.x) * .5, (c.y + d.y) * .5 - 8)
  }

  segmented(points, dash) {
    const ctx = this.ctx
    ctx.setLineDash(dash)
    ctx.beginPath()
    points.forEach(({ x, y }, i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.stroke()
    ctx.setLineDash([])
  }
}

const lerpFrame = (a, b, dt) => a + (b - a) * (1 - Math.exp(-dt * 13))
