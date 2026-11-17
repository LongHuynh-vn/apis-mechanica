import {
  BufferGeometry, CatmullRomCurve3, Euler, Float32BufferAttribute, InstancedBufferAttribute,
  InstancedMesh, Line, Matrix4, Quaternion, ShaderMaterial, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mix, smooth, TAU, vec } from '../math.js'
import { nodeAt, surfaceBuffer, transform, tube, Workshop } from './geometry.js'

export const socketX = .85
export const socketY = .646
export const socketZ = .32
export const wingRadius = 3.80
export const wingPhase = (state, side) => state.phase + side * (.024 + .08 * state.balance) + .045 * Math.sin(state.time * 2 + side)
export const wingStroke = (state, side) => state.stroke * (1 - side * state.balance * .24)
const hindOffset = [0.08, -.041, -.185]
const ghostCount = 10

const foreOutline = [
  [0, 0], [.32, .196], [.75, .344], [1.32, .473], [1.99, .551], [2.57, .566], [3.13, .522],
  [3.61, .379], [3.80, .145], [3.69, -.142], [3.34, -.398], [2.84, -.597], [2.25, -.754],
  [1.76, -.770], [1.28, -.656], [.80, -.435], [.37, -.220],
]
const hindOutline = [
  [.07, -.183], [.32, -.267], [.79, -.438], [1.27, -.646], [1.73, -.771], [2.21, -.773],
  [2.65, -.68], [2.87, -.686], [2.83, -.895], [2.59, -1.057], [2.20, -1.206], [1.71, -1.233],
  [1.27, -1.090], [.91, -.901], [.56, -.606], [.25, -.442],
]

// C, Sc+R, Rs, M, Cu and anal veins. Crossveins share actual junctions.
const root = [0, 0]
const r1 = [1.05, .342], r2 = [1.93, .481], r3 = [2.23, .512]
const ma = [2.28, .205], mb = [2.78, .223], mc = [3.18, .305], md = [3.58, .389]
const m0 = [.71, -.077], m1 = [1.21, -.148], m2 = [1.78, -.184], m3 = [2.20, -.172], m4 = [2.67, -.123], m5 = [3.085, -.045]
const cu0 = [.65, -.250], cu1 = [1.37, -.436], cu2 = [1.95, -.479], cu3 = [2.49, -.409]
const a1 = [.93, -.488], a2 = [1.42, -.690]
const foreVeins = [
  [root, [.46, .225], r1, [1.48, .427], r2, r3, [2.82, .539], [3.27, .490], md],
  [r3, ma, mb, mc, [3.34, .345], md],                                      // marginal cell
  [r2, [1.90, .235], [1.95, .129], ma],
  [root, [.28, -.012], m0, m1, m2, m3, m4, m5, [3.44, .083], [3.72, .233]],
  [r1, [.96, .138], m1],                                                    // radial crossvein
  [ma, [2.11, .054], [2.16, -.052], m3],                                   // 1rs-m
  [mb, [2.68, .095], [2.72, -.012], m4],                                   // 2rs-m
  [mc, [3.13, .158], m5],                                                   // closes third submarginal cell
  [root, [.30, -.105], cu0, [1.02, -.359], cu1, cu2, cu3, [2.80, -.480], [3.07, -.518]],
  [m2, [1.66, -.327], cu1], [m4, [2.46, -.286], cu3],                      // medial-cubital crossveins
  [root, [.40, -.231], a1, a2], [cu0, [.77, -.367], a1],
  [cu2, [1.86, -.637], [1.86, -.768]],
]
const sharedHind = [[.07, -.183], [.68, -.461], [1.25, -.688], [1.87, -.851], [2.50, -.832], [2.80, -.729]]
const hindVeins = [
  sharedHind,
  [[.07, -.183], [.57, -.550], [1.16, -.875], [1.57, -.983], [2.06, -1.032], [2.58, -1.066]],
  [sharedHind[2], [1.28, -.790], [1.16, -.875]],
  [sharedHind[3], [1.83, -.926], [1.57, -.983]],
  [sharedHind[4], [2.37, -.949], [2.06, -1.032]],
  [[.57, -.55], [.72, -.730], [.92, -.912]],
]
const camber = (x, z) => .098 * Math.sin(Math.PI * x / 3.84) * (.65 + .35 * Math.cos(z * 2.1)) + .019 * x / 3.8

function edgeOf(outline) {
  return new CatmullRomCurve3(outline.map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal')
}

function skin(outline, center, offset) {
  const shape = edgeOf(outline)
  const vertices = []
  const uv = []
  const indices = []
  const segments = 80
  const rows = 9
  for (let r = 0; r <= rows; r++) for (let i = 0; i < segments; i++) {
    const point = shape.getPoint(i / segments)
    const x = mix(center[0], point.x, r / rows)
    const z = mix(center[1], point.z, r / rows)
    vertices.push(x - offset[0], camber(x, z), z - offset[2])
    uv.push(x / wingRadius, (z + 1.25) / 1.87)
    if (!r) continue
    const a = (r - 1) * segments + i
    const b = (r - 1) * segments + (i + 1) % segments
    indices.push(a, a + segments, b, b, a + segments, b + segments)
  }
  return surfaceBuffer(vertices, indices, uv)
}

function surfacePath(path, offset, height = .006) {
  return path.map(([x, z]) => [x - offset[0], camber(x, z) + height, z - offset[2]])
}

function buildBlade(node, finishes, id, isFore) {
  const cart = new Workshop(node, finishes, id)
  const outline = isFore ? foreOutline : hindOutline
  const offset = isFore ? [0, 0, 0] : hindOffset
  const center = isFore ? [1.95, -.045] : [1.62, -.886]
  const membrane = skin(outline, center, offset)
  const edge = edgeOf(outline).getPoints(42).slice(0, -1).map(({ x, z }) => [x, z])
  cart.add('glass', membrane)
  const frame = tube(surfacePath(edge, offset, .003), isFore ? .0155 : .013, true, 96, 5)
  cart.add('vein', frame)
  const ghostEdges = [frame]
  const veins = isFore ? foreVeins : hindVeins
  for (const [i, path] of veins.entries()) {
    const vein = tube(surfacePath(path, offset), i < 2 ? .0135 : .008, false, Math.max(8, path.length * 6), 5)
    cart.add(i === 0 ? 'polish' : 'vein', vein)
    if (i < 8) ghostEdges.push(vein)
  }
  // Fine fan etching terminates inside the cells and never crosses the frame.
  if (isFore) {
    for (let i = 0; i < 19; i++) {
      const t = i / 18
      const x = mix(2.64, 3.43, t)
      const z = mix(-.49, -.23, t)
      cart.tube('etch', surfacePath([[x - .17, z + .079], [x, z], [x + .06, z - .017]], offset, .002), .0037, false, 7, 3)
    }
    for (let i = 0; i < 13; i++) {
      const x = .56 + i * .128
      const z = -.13 - .10 * i / 13
      cart.tube('etch', surfacePath([[x, z], [x + .05, z + .104]], offset, .002), .0035, false, 4, 3)
    }
  }
  const start = isFore ? [.0, .0, .0] : [.0, .0, .012]
  const stem = isFore ? [.61, .049, .19] : [.42, .041, -.118]
  cart.rod('metal', start, stem, isFore ? .032 : .023, { taper: .42 })
  cart.sphere('polish', start, isFore ? [.075, .040, .075] : [.060, .035, .064], true)
  cart.finish()
  const outlines = mergeGeometries(ghostEdges)
  for (const geometry of ghostEdges) geometry.dispose()
  return { membrane, outlines }
}

function coupling(node, finishes) {
  const cart = new Workshop(node, finishes, 'hamuli')
  const points = [[.43, -.332], [.79, -.434], [1.27, -.643], [1.72, -.768], [1.98, -.778]]
  const rail = new CatmullRomCurve3(surfacePath(points, [0, 0, 0], -.008).map(vec))
  cart.tube('darkMetal', surfacePath(points, [0, 0, 0], -.010), .016, false, 32, 6)
  cart.tube('polish', surfacePath(points.map(([x, z]) => [x, z + .026]), [0, 0, 0], .008), .012, false, 32, 5)
  const hook = tube([[0, -.019, -.027], [0, .013, -.021], [0, .028, .006], [0, .019, .028], [0, -.002, .035]], .0065, false, 10, 5)
  const matrices = Array.from({ length: 21 }, (_, i) => {
    const t = .031 + i / 21.7
    const angle = -Math.atan2(rail.getTangent(t).z, rail.getTangent(t).x)
    return transform(rail.getPoint(t), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), [1, 1.06 - i * .010, 1])
  })
  cart.instances('polish', hook, matrices)
  cart.finish()
}

function ghostMesh(node, part, finishes, geometry) {
  const alpha = new InstancedBufferAttribute(new Float32Array(ghostCount), 1)
  geometry.setAttribute('sampleAlpha', alpha)
  const mesh = new InstancedMesh(geometry, finishes.material(part, 'ghost'), ghostCount)
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  mesh.visible = false
  node.add(mesh)
  return { mesh, alpha }
}

function trail(node) {
  const count = 105
  const points = new Float32BufferAttribute(count * 3, 3)
  const phases = new Float32BufferAttribute(new Float32Array(count).map((_, i) => i / (count - 1)), 1)
  const geometry = new BufferGeometry().setAttribute('position', points).setAttribute('tracePhase', phases)
  const material = new ShaderMaterial({
    depthWrite: false, transparent: true,
    uniforms: { ink: { value: null }, phase: { value: 0 }, alpha: { value: 0 } },
    vertexShader: `attribute float tracePhase; varying float vPhase;
      void main() { vPhase = tracePhase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 ink; uniform float phase, alpha; varying float vPhase;
      void main() {
        float tail = fract(phase - vPhase + 1.0);
        gl_FragColor = vec4(ink, alpha * (0.32 + 0.68 * pow(1.0-tail, 3.0)));
        #include <colorspace_fragment>
      }`,
  })
  const line = new Line(geometry, material)
  line.frustumCulled = false
  line.renderOrder = 7
  node.add(line)
  return { line, points, material, count, amplitude: -1 }
}

function pose(euler, phase, fold, drive, stroke, side) {
  const s = Math.sin(phase)
  const spread = 1 - fold
  // The resting panels stack on two slightly different hinge stops.
  const sweep = (1.655 + side * .041) * fold + spread * (-.035 + stroke * drive * s)
  const elevation = (.094 + side * .020) * fold + spread * (.19 + drive * (.32 * s + .175 * Math.sin(phase * 2)))
  const pitch = fold * (.022 + side * .032) + spread * (.056 + drive * .69 * Math.tanh(3.2 * Math.cos(phase + .17)))
  return euler.set(pitch, sweep, elevation, 'YZX')
}

export class WingRig {
  constructor(parent, finishes, assembly) {
    this.euler = new Euler()
    this.quaternion = new Quaternion()
    this.matrix = new Matrix4()
    this.tip = new Vector3()
    this.tipLocal = new Vector3(wingRadius, camber(wingRadius, .145), .145)
    this.traceColor = finishes.current.css.accent
    this.wings = [-1, 1].map((side) => {
      const socket = nodeAt(parent, [side * socketX, socketY, socketZ])
      socket.scale.x = side
      const flight = nodeAt(socket)
      const lift = assembly.detach(nodeAt(flight), [.73, 1, .11], 1.37, .09, .63)
      const fore = assembly.detach(nodeAt(lift), [.88, .46, .39], .92, .055, .71)
      const hind = assembly.detach(nodeAt(lift, hindOffset), [.13, -.37, -1], 1.13, .10, .79)
      const hooks = assembly.detach(nodeAt(lift), [.35, .62, -.78], .78, .10, .80)
      const a = buildBlade(fore, finishes, 'forewings', true)
      const b = buildBlade(hind, finishes, 'hindwings', false)
      coupling(hooks, finishes)
      assembly.tag('forewings', fore, [2.25, .15, .22], side, 1.52)
      assembly.tag('hindwings', hind, [1.88, .08, -.70], side, 1.15)
      assembly.tag('hamuli', hooks, [1.24, .10, -.61], side, .85)
      const membranes = mergeGeometries([a.membrane, b.membrane.translate(...hindOffset)])
      const outlines = mergeGeometries([a.outlines, b.outlines.translate(...hindOffset)])
      for (const geometry of [a.membrane, b.membrane, a.outlines, b.outlines]) geometry.dispose()
      const ghosts = [
        ghostMesh(socket, 'envelope-glass', finishes, membranes),
        ghostMesh(socket, 'envelope-veins', finishes, outlines),
      ]
      return { side, socket, flight, ghosts, trace: trail(socket) }
    })
  }

  update(state, settings) {
    const { phaseStep, fold, drive } = state
    const { exploded, drawing, windowPhase, blur } = settings
    const folding = mix(fold, .11, smooth(.04, .74, exploded))
    const active = drive * (1 - smooth(.05, .65, exploded))
    for (const wing of this.wings) {
      const sidePhase = wingPhase(state, wing.side)
      const amplitude = wingStroke(state, wing.side)
      const trace = wing.trace
      const frameBlur = blur * active * smooth(.22, .96, 1 - folding) * (1 - exploded) * (1 - drawing * .7)
      wing.flight.position.y = folding * .014
      wing.flight.rotation.copy(pose(this.euler, sidePhase, folding, active * (1 - frameBlur * .03), amplitude, wing.side))
      const visible = frameBlur > .015
      for (const ghost of wing.ghosts) ghost.mesh.visible = visible
      if (visible) {
        const shutter = Math.min(windowPhase || phaseStep, TAU * 1.64)
        for (let i = 0; i < ghostCount; i++) {
          const t = (i + .37 + .24 * Math.sin(i * 12.91)) / ghostCount
          const offset = pose(this.euler, sidePhase - shutter * t, folding, active, amplitude, wing.side)
          this.quaternion.setFromEuler(offset)
          this.matrix.makeRotationFromQuaternion(this.quaternion)
          for (const [idx, ghost] of wing.ghosts.entries()) {
            ghost.mesh.setMatrixAt(i, this.matrix)
            ghost.alpha.setX(i, frameBlur * (idx ? .041 : .101) * (1 - .61 * t))
          }
        }
        for (const ghost of wing.ghosts) {
          ghost.mesh.instanceMatrix.needsUpdate = true
          ghost.alpha.needsUpdate = true
        }
      }
      const trailOpacity = active * (1 - exploded) * smooth(.20, .8, 1 - fold) * mix(.78, .12, blur)
      trace.line.visible = trailOpacity > .015
      if (!trace.line.visible) continue
      trace.material.uniforms.alpha.value = trailOpacity
      trace.material.uniforms.ink.value = this.traceColor
      trace.material.uniforms.phase.value = (sidePhase / TAU) % 1
      if (Math.abs(amplitude - trace.amplitude) > .012 || Math.abs(active - trace.drive) > .018 || Math.abs(folding - trace.fold) > .018) {
        trace.amplitude = amplitude
        trace.drive = active
        trace.fold = folding
        for (let i = 0; i < trace.count; i++) {
          this.tip.copy(this.tipLocal).applyEuler(pose(this.euler, i * TAU / (trace.count - 1), folding, active, amplitude, wing.side))
          trace.points.setXYZ(i, this.tip.x, this.tip.y, this.tip.z)
        }
        trace.points.needsUpdate = true
      }
    }
  }
}
