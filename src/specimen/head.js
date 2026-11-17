import { Color, LatheGeometry, Quaternion, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mix, randomGenerator, Spring, TAU, vec } from '../math.js'
import { cylinder, extrude, formedShell, nodeAt, oval, profileAt, rodMatrix, transform, vertical, Workshop } from './geometry.js'

const cranialStations = [
  [0, .08, .12, -.07], [.12, .410, .39, .004], [.29, .609, .537, .061],
  [.54, .690, .542, .050], [.79, .530, .442, .02], [1.05, .236, .245, .014],
]
function cranium(angle, v, inset) {
  const [rx, ry, cy] = profileAt(cranialStations, 1.05 * v)
  return [(rx + inset) * Math.sin(angle), cy + (ry + inset) * Math.cos(angle), .768 - 1.05 * v]
}

const facet = new LatheGeometry(
  [new Vector2(0, -.004), new Vector2(.86, -.004), new Vector2(1, .001),
    new Vector2(.89, .006), new Vector2(.66, .010), new Vector2(.33, .0127), new Vector2(0, .0134)],
  6, Math.PI / 6,
)

function compoundEye(parent, finishes, assembly, side) {
  const eye = assembly.detach(nodeAt(parent, [side * .467, .109, .429]), [side, .13, .62], .94, .08, .75)
  eye.rotation.set(0, side * .61, side * .16, 'YXZ')
  const cradle = new Workshop(eye, finishes, 'eyes')
  cradle.sphere('eyeBase', [0, 0, -.042], [.366, .477, .249])
  cradle.tube('darkMetal', oval(.376, .478, [0, 0, -.060]), .030, true, 52, 7)
  cradle.tube('polish', oval(.379, .485, [0, 0, -.040]), .013, true, 54, 6)
  cradle.tube('metal', oval(.368, .470, [0, 0, -.072]), .014, true, 45, 6)
  for (const angle of [Math.PI * .31, Math.PI * .92, Math.PI * 1.59]) {
    cradle.screw('polish', [.387 * Math.cos(angle), .48 * Math.sin(angle), -.025], [0, .1, 1], .018)
  }
  cradle.finish()
  const lenses = assembly.detach(nodeAt(eye), [0, .05, 1], .17, .04, .53)
  const lattice = new Workshop(lenses, finishes, 'eyes')
  const matrices = []
  const values = []
  const random = randomGenerator(33 + side)
  for (let row = -13; row <= 13; row++) for (let col = -10; col <= 10; col++) {
    const x = (col + (Math.abs(row) % 2) * .5) * .0378
    const y = row * .0327
    const radial = (x / .355) ** 2 + (y / .464) ** 2
    if (radial > .963) continue
    const z = .249 * Math.sqrt(1 - radial)
    const normal = new Vector3(x / .355 ** 2, y / .464 ** 2, z / .249 ** 2).normalize()
    const tangent = new Quaternion().setFromUnitVectors(vertical, normal)
    const r = .0211 * (1 + .28 * radial)
    matrices.push(transform([x, y, z - .040], tangent, [r, .86, r]))
    const glint = .82 + random() * .22 + .12 * Math.exp(-((x + .10) ** 2 + (y - .17) ** 2) * 32)
    values.push(new Color(glint, glint * .969, glint * .94))
  }
  lattice.instances('facet', facet, matrices, values)
  assembly.tag('eyes', lenses, [0, .058, .185], side, .56)
}

const hairGeometry = mergeGeometries([
  cylinder(.15, 1, 1, 5).clone().applyMatrix4(rodMatrix([0, 0, 0], [.001, .088, .014], .0048)),
  cylinder(.08, 1, 1, 4).clone().applyMatrix4(rodMatrix([.001, .035, .006], [-.012, .077, .014], .0028)),
  cylinder(.10, 1, 1, 4).clone().applyMatrix4(rodMatrix([.002, .048, .007], [.015, .076, .023], .0026)),
])

export function setaeOn(parent, finishes, assembly, sample, config) {
  const { seed, count, length, axis, distance, apt, side = 0 } = config
  const tuft = assembly.detach(nodeAt(parent), axis, distance, .015, .60)
  const maker = new Workshop(tuft, finishes, 'setae')
  const matrices = []
  const colors = []
  const rng = randomGenerator(seed)
  for (let i = 0; i < count; i++) {
    const { position, normal } = sample(rng(), rng())
    const reach = .52 + length * rng()
    const spin = new Quaternion().setFromAxisAngle(vertical, rng() * TAU)
    const angle = new Quaternion().setFromUnitVectors(vertical, vec(normal).normalize()).multiply(spin)
    matrices.push(transform(position, angle, [reach, reach, reach]))
    const glimmer = .57 + rng() * .48
    colors.push(new Color(glimmer, glimmer * .96, glimmer * .85))
  }
  maker.instances('polish', hairGeometry, matrices, colors)
  assembly.tag('setae', tuft, apt, side, .62)
  return tuft
}

function antenna(parent, finishes, assembly, side) {
  const socket = nodeAt(parent, [side * .225, .178, .673])
  const fix = new Workshop(socket, finishes, 'antennae')
  fix.sphere('darkMetal', [0, 0, 0], [.113, .105, .069], true)
  fix.tube('polish', oval(.085, .083, [0, 0, .049], 21), .011, true, 28, 5)
  fix.finish()
  const boom = assembly.detach(nodeAt(socket, [0, .006, .053]), [side * .66, .67, .53], .86, .045, .57)
  const segments = []
  let anchor = boom
  let previous = new Quaternion()
  for (let i = 0; i < 12; i++) {
    const height = i === 0 ? .66 : i === 1 ? .133 : mix(.127, .096, (i - 2) / 9)
    const radius = i === 0 ? .057 : i === 1 ? .051 : mix(.043, .022, (i - 2) / 9)
    const target = i === 0 ? [side * .63, .70, .28] : i === 1 ? [side * .56, .08, .91] :
      [side * mix(.53, .15, (i - 2) / 9), mix(-.05, -.56, (i - 2) / 9), .88]
    const global = new Quaternion().setFromUnitVectors(vertical, vec(target).normalize())
    const rest = previous.clone().invert().multiply(global)
    previous = global
    const pivot = nodeAt(anchor)
    pivot.quaternion.copy(rest)
    const maker = new Workshop(pivot, finishes, 'antennae')
    maker.sphere('polish', [0, 0, 0], [radius * .86, radius * .86, radius * .86], true)
    maker.rod('darkMetal', [0, height * .10, 0], [0, height * .90, 0], radius * .94, { taper: .70, sides: 10 })
    maker.rod(i === 0 || i % 3 === 1 ? 'polish' : 'metal', [0, height * .18, 0], [0, height * .82, 0], radius, { taper: .77, sides: 10 })
    if (i === 0) {
      maker.rod('darkMetal', [0, .14, .047], [0, .51, .025], .011, { taper: .48, sides: 7 })
      maker.rod('enamel', [.008, .21, .043], [.008, .49, .038], .014, { taper: .62, sides: 8 })
    }
    if (i === 11) maker.sphere('polish', [0, height * .92, 0], [.025, .037, .025], true)
    maker.finish()
    segments.push({ pivot, rest })
    anchor = nodeAt(pivot, [0, height, 0])
    if (i === 4) assembly.tag('antennae', pivot, [0, height, 0], side, .72)
  }
  return {
    side, segments,
    sweep: new Spring(0, side === 1 ? 2.35 : 1.91, .63),
    nod: new Spring(0, side === 1 ? 2.81 : 3.07, .68),
  }
}

export class HeadRig {
  constructor(parent, finishes, assembly) {
    this.head = nodeAt(parent, [0, .034, 1.337])
    this.head.rotation.order = 'YXZ'
    const housing = assembly.detach(nodeAt(this.head), [0, .14, 1], .83, .44, .96)
    const cart = new Workshop(housing, finishes, 'housing')
    cart.add('porcelain', formedShell(cranium, -Math.PI, Math.PI, { columns: 47, rows: 24, thickness: .043 }), null, true)
    cart.sphere('porcelain', [0, -.070, .749], [.087, .126, .031])
    for (const [v, dark] of [[.22, false], [.73, true]]) {
      const seam = Array.from({ length: 30 }, (_, i) => cranium(i / 30 * TAU, v + .038 * Math.cos(i / 30 * TAU * 2), .012))
      cart.tube(dark ? 'darkMetal' : 'metal', seam, v > .5 ? .022 : .010, true, 55, 6)
    }
    for (const side of [-1, 1]) {
      cart.tube('polish', [[side * .075, .448, .604], [side * .13, .336, .673], [side * .19, .260, .687], [side * .22, .235, .656]], .016)
      cart.tube('darkMetal', [[side * .015, -.388, .560], [side * .16, -.351, .601], [side * .31, -.260, .579]], .014)
      cart.screw('polish', [side * .304, -.218, .595], [side * .28, 0, 1], .032)
    }
    cart.finish()
    assembly.tag('housing', housing, [0, .216, .68], 0, .90)
    for (const side of [-1, 1]) compoundEye(this.head, finishes, assembly, side)
    const ocelli = assembly.detach(nodeAt(this.head), [0, 1, .26], .79, .035, .66)
    const crowns = new Workshop(ocelli, finishes, 'ocelli')
    const ocelliPositions = [[-.155, .534, .475], [.155, .534, .475], [0, .511, .604]]
    for (const [i, p] of ocelliPositions.entries()) {
      const r = i === 2 ? .075 : .062
      const direction = vec([p[0] * .7, .88, .47]).normalize()
      const orientation = new Quaternion().setFromUnitVectors(vertical, direction)
      crowns.add('darkMetal', cylinder(r * .97, r * 1.14, .046, 20), transform(p, orientation))
      const bezel = vec(p).clone().addScaledVector(direction, .025)
      crowns.add('polish', cylinder(r * .81, r, .023, 20), transform(bezel, orientation))
      crowns.sphere('jewel', bezel.addScaledVector(direction, .031), [r * .79, .041, r * .79], true, orientation)
    }
    crowns.finish()
    assembly.tag('ocelli', ocelli, [0, .62, .57], 0, .43)
    this.antennae = [-1, 1].map((side) => antenna(this.head, finishes, assembly, side))
    this.mandibles = [-1, 1].map((side) => {
      const jaw = assembly.detach(nodeAt(this.head, [side * .156, -.282, .592]), [side, -.48, .54], .60, .12, .74)
      jaw.scale.x = side
      const parts = new Workshop(jaw, finishes, 'mandibles')
      const profile = [[-.027, .030], [.072, .026], [.127, -.060], [.115, -.141], [.036, -.227], [-.095, -.239], [-.125, -.189],
        [-.052, -.194], [-.084, -.142], [-.015, -.154], [-.044, -.096]]
      parts.add('metal', extrude(profile, .057, .014), null, true)
      parts.tube('polish', [[.055, -.038, .075], [.067, -.114, .075], [.025, -.179, .071], [-.07, -.208, .061]], .014)
      parts.screw('polish', [.046, -.030, .059], [0, 0, 1], .046)
      parts.finish()
      assembly.tag('mandibles', jaw, [.019, -.137, .069], side, .32)
      return jaw
    })
    const glossaCarrier = nodeAt(this.head, [0, -.361, .569])
    const mouth = assembly.detach(nodeAt(glossaCarrier), [0, -.87, .48], .97, .22, .82)
    this.glossa = mouth
    const tongue = new Workshop(mouth, finishes, 'proboscis')
    for (const side of [-1, 1]) tongue.tube('metal', [[side * .061, 0, 0], [side * .047, -.14, .019], [side * .030, -.36, .021]], .026)
    tongue.rod('darkMetal', [0, -.02, 0], [0, -.45, 0], .051, { taper: .46, sides: 12 })
    tongue.rod('polish', [0, -.20, .028], [0, -.58, .026], .022, { taper: .55, sides: 9 })
    tongue.sphere('jewel', [0, -.583, .026], [.026, .040, .023], true)
    tongue.finish()
    assembly.tag('proboscis', mouth, [0, -.38, .025], 0, .43)
    this.brow = setaeOn(this.head, finishes, assembly, (a, b) => {
      const flank = a > .5 ? 1 : -1
      const u = flank * mix(.18, 1.66, (a * 2) % 1)
      const v = mix(.405, .70, b)
      const p = cranium(u, v, .004)
      return { position: p, normal: [Math.sin(u) * .78, Math.cos(u), -.23] }
    }, { seed: 613, count: 163, length: 1.04, axis: [0, .92, .31], distance: .27, apt: [0, .61, .22] })
    this.swing = new Spring(0, 1.95)
    this.pitch = new Spring(0, 1.72)
    this.level = new Spring(0, 3.20, .77)
    this.feed = new Spring(0, 1.65, .80)
    this.quaternion = new Quaternion()
    this.xAxis = new Vector3(1, 0, 0)
    this.zAxis = new Vector3(0, 0, 1)
  }

  step(dt, state, gaze, extension, exploded, openingTwitch) {
    const { time, bank, pitch, curious, acceleration, drive } = state
    this.head.rotation.z = this.level.step(-bank * .93 + .017 * Math.sin(time * 1.6), dt)
    this.head.rotation.y = this.swing.step(gaze.x * .36 + curious * .24, dt)
    this.head.rotation.x = this.pitch.step(-pitch * .57 - gaze.y * .17 + .019 * Math.sin(time * 2.1), dt)
    const feeding = this.feed.step(Math.max(extension ? 1 : 0, exploded * .83), dt)
    this.glossa.rotation.x = mix(1.83, -.57, feeding)
    this.mandibles.forEach((jaw, i) => { jaw.rotation.z = (i === 0 ? -1 : 1) * (-.085 - .52 * feeding) })
    this.brow.rotation.z = .004 * drive * Math.sin(time * 9.7)
    for (const branch of this.antennae) {
      const { side, segments } = branch
      const tilt = branch.nod.step(.078 * Math.sin(time * (2.24 + side * .17) + side * .8) - gaze.y * .21 + acceleration * .107 + openingTwitch * .31, dt)
      const bend = branch.sweep.step(.127 * Math.sin(time * (1.43 - side * .16) - side) + gaze.x * .29 + curious * .12, dt)
      segments.forEach(({ pivot, rest }, i) => {
        const wave = .046 * Math.sin(time * (3.4 + side * .17) - i * .35 + side * 1.6)
        pivot.quaternion.copy(rest)
        pivot.quaternion.multiply(this.quaternion.setFromAxisAngle(this.xAxis, i ? tilt * .10 + wave : tilt))
        pivot.quaternion.multiply(this.quaternion.setFromAxisAngle(this.zAxis, i ? bend * .12 : bend))
      })
    }
  }
}
