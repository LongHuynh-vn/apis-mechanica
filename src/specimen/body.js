import { Quaternion, Vector3 } from 'three'
import { mix, Spring, TAU } from '../math.js'
import {
  aperturePoints, cylinder, extrude, formedShell, nodeAt, oval, profileAt,
  regular, rotation, surfaceBuffer, transform, vertical, Workshop,
} from './geometry.js'
import { setaeOn } from './head.js'
import { socketX, socketY, socketZ } from './wings.js'

const chestStations = [
  [0, .36, .38, .015], [.19, .64, .60, .009], [.48, .83, .735, .022], [.86, .874, .754, .027],
  [1.24, .831, .690, .033], [1.55, .727, .621, .009], [1.84, .563, .450, -.032], [2.02, .375, .314, -.055],
]
const abdomenStations = [
  [0, .277, .270, -.020], [.26, .532, .489, .011], [.57, .768, .622, .030], [1.03, .930, .701, .038],
  [1.34, .905, .684, .035], [1.64, .819, .627, .022], [1.95, .685, .537, -.016], [2.21, .489, .408, -.061],
  [2.44, .267, .250, -.083], [2.57, .091, .088, -.093],
]
const zAxis = new Vector3(0, 0, 1)
const yToZ = new Quaternion().setFromUnitVectors(vertical, zAxis)
const brassPin = cylinder(.90, 1, .018, 9)

function chest(d0, d1, extra = 0) {
  return (angle, v, inset) => {
    const d = mix(d0, d1, v)
    const [rx, ry, cy] = profileAt(chestStations, d)
    const flare = extra + inset
    return [(rx + flare) * Math.sin(angle), (ry + flare) * Math.cos(angle) + cy, 1.025 - d]
  }
}

function ring(sample, v, min = -Math.PI, max = Math.PI, inset = .007, count = 32) {
  return Array.from({ length: count }, (_, i) => sample(mix(min, max, i / (max - min > TAU - .001 ? count : count - 1)), v, inset))
}

function dorsalPlate(parent, finishes, assembly, front, back, rear) {
  const piston = nodeAt(parent)
  const shell = assembly.detach(nodeAt(piston), rear ? [0, .88, -.49] : [0, .985, .17], rear ? 1.33 : 1.77, rear ? .15 : .12, .86)
  const make = new Workshop(shell, finishes, 'plates')
  const lattice = chest(front, back, rear ? .018 : .028)
  const angle = rear ? 1.225 : 1.15
  make.add('porcelain', formedShell(lattice, -angle, angle, { thickness: .049, columns: rear ? 29 : 42, rows: rear ? 11 : 22 }), null, true)
  for (const v of [.024, .938]) {
    make.tube('darkMetal', ring(lattice, v, -angle, angle, -.006), .028, false, 44, 6)
    make.tube('polish', ring(lattice, v + .018, -angle + .01, angle - .01, .013), rear ? .014 : .017, false, 48, 6)
  }
  for (const side of [-1, 1]) {
    make.tube('metal', Array.from({ length: 10 }, (_, i) => lattice(side * (angle - .025), .05 + i / 10, .011)), .017)
    const strip = Array.from({ length: 9 }, (_, i) => lattice(side * (angle - .13 - .045 * Math.sin(i * Math.PI / 8)), .144 + i * .088, .004))
    make.tube('vein', strip, .006, false, 28, 4)
    for (const t of [.17, .68, .86]) {
      const a = (angle - .163) * side
      make.screw('polish', lattice(a, t, .01), [Math.sin(a), Math.cos(a), 0], rear ? .024 : .033)
    }
  }
  if (!rear) {
    make.tube('vein', [[0, .661, .589], [0, .765, .333], [0, .79, .133], [0, .799, -.023], [0, .788, -.154]], .008, false, 25, 5)
    // The small recessed stamp is formed by three concentric gold inlays.
    const plateCenter = lattice(0, .61, .013)
    const medallion = (r) => regular(6, r, Math.PI / 6).map(([x, z]) => [x, plateCenter[1] - (.047 * Math.abs(z)), plateCenter[2] + z])
    make.tube('polish', medallion(.143), .009, true, 28, 5)
    make.tube('vein', medallion(.104), .006, true, 28, 5)
    make.tube('vein', [[-.052, plateCenter[1], plateCenter[2] - .012], [0, plateCenter[1] + .002, plateCenter[2] + .047], [.052, plateCenter[1], plateCenter[2] - .012]], .006)
  }
  make.finish()
  assembly.tag('plates', shell, lattice(rear ? .22 : -.09, .48, .10), rear ? 1 : -1, rear ? .52 : .90)
  return piston
}

const gearModule = .036
function involuteTooth(count) {
  const pitch = gearModule * count * .5
  const base = pitch * Math.cos(Math.PI / 9)
  const inner = pitch - 1.25 * gearModule
  const outer = pitch + gearModule
  const involute = (r) => {
    const t = Math.sqrt(Math.max(0, (r / base) ** 2 - 1))
    return t - Math.atan(t)
  }
  const half = Math.PI / (2 * count) + involute(pitch)
  const flank = (r, sign) => [r * Math.cos(half - involute(r)), sign * r * Math.sin(half - involute(r))]
  const radii = [inner - .008, base, mix(base, outer, .38), mix(base, outer, .72), outer]
  const path = radii.map((r) => flank(r, -1)).concat(radii.slice().reverse().map((r) => flank(r, 1)))
  return extrude(path, .049, .003)
}

function gear(parent, finishes, position, count) {
  const axle = nodeAt(parent, [-.205, position[0], position[1]])
  axle.rotation.y = Math.PI / 2
  const turner = nodeAt(axle)
  const maker = new Workshop(turner, finishes, 'motor')
  const r = gearModule * count * .5
  const tooth = involuteTooth(count)
  const matrices = Array.from({ length: count }, (_, i) => transform([0, 0, .005], rotation(zAxis, i * TAU / count)))
  maker.instances('polish', tooth, matrices)
  const blank = r - 1.18 * gearModule
  const holes = Array.from({ length: 5 }, (_, i) => {
    const theta = i * TAU / 5
    const x = Math.cos(theta) * r * .529
    const y = Math.sin(theta) * r * .529
    return regular(9, r * .174).map(([a, b]) => [a + x, b + y])
  })
  maker.add('metal', extrude(regular(52, blank), .052, .006, holes), null, true)
  maker.tube('darkMetal', oval(blank - .026, blank - .026, [0, 0, .060], 26), .012, true, 43, 5)
  maker.tube('polish', oval(blank - .045, blank - .045, [0, 0, .064], 26), .006, true, 43, 4)
  const boss = count === 18 ? .108 : .071
  maker.rod('darkMetal', [0, 0, -.022], [0, 0, .098], boss, { sides: 16 })
  maker.screw('polish', [0, 0, .096], [0, 0, 1], boss * .66)
  if (count === 18) maker.screw('polish', [.15, 0, .093], [0, 0, 1], .051)
  maker.finish()
  return turner
}

function buildMotor(parent, finishes, assembly) {
  const motor = assembly.detach(nodeAt(parent), [.93, -.04, -.15], 1.40, .40, .96)
  const frame = new Workshop(motor, finishes, 'motor')
  for (const side of [-1, 1]) {
    const x = side * .54
    frame.tube('metal', [[x * .74, -.22, .76], [x, -.32, .56], [x, -.29, -.50], [x * .77, -.20, -.73]], .051)
    frame.tube('darkMetal', [[x * .65, .24, .78], [x, .36, .54], [x, .326, -.51], [x * .69, .18, -.74]], .044)
    for (const z of [.61, -.65]) {
      frame.rod('polish', [x * .97, -.247, z], [x * .93, .303, z], .042, { depth: .071, sides: 9 })
      frame.screw('polish', [x, -.17, z], [side, 0, 0], .043)
      frame.screw('polish', [x, .287, z], [side, 0, 0], .041)
    }
  }
  const r12 = gearModule * (18 + 12) / 2
  const r23 = gearModule * (12 + 15) / 2
  const positions = [
    [.037, .506],
    [.037 - r12 * Math.sin(.17), .506 - r12 * Math.cos(.17)],
    [.037 - r12 * Math.sin(.17) + r23 * Math.sin(.21), .506 - r12 * Math.cos(.17) - r23 * Math.cos(.21)],
  ]
  positions.forEach(([y, z]) => {
    frame.rod('darkMetal', [-.48, y, z], [.582, y, z], .045, { sides: 15 })
    frame.rod('metal', [.22, y, z], [.48, y, z], .073)
    frame.screw('polish', [.608, y, z], [1, 0, 0], .054)
  })
  frame.finish()
  const gears = [18, 12, 15].map((count, i) => gear(motor, finishes, positions[i], count))
  const angle = (a, b) => Math.atan2(b[0] - a[0], a[1] - b[1])
  const angle12 = angle(positions[0], positions[1])
  const angle21 = angle(positions[1], positions[0])
  const angle23 = angle(positions[1], positions[2])
  const angle32 = angle(positions[2], positions[1])
  const phase2 = angle21 - Math.PI / 12
  const phase3 = angle32 - (Math.PI - 12 * (angle23 - phase2)) / 15
  const leaves = [-1, 1].map((side) => {
    const spring = nodeAt(motor, [side * .573, .277, 0])
    const make = new Workshop(spring, finishes, 'motor')
    for (let i = 0; i < 4; i++) {
      const y = i * .027
      const step = i * .062
      const edge = [[- .68 + step, y + .013], [-.48, y + .054], [-.16, y + .095], [.16, y + .113], [.45, y + .063], [.69 - step, y + .012]]
      const ribbon = edge.concat(edge.slice().reverse().map(([z, height]) => [z, height - .025]))
      const orient = rotation(vertical, -Math.PI / 2)
      make.add(i % 2 ? 'metal' : 'polish', extrude(ribbon, .083, .005), transform([.041, 0, 0], orient), true)
    }
    make.rod('darkMetal', [0, .072, -.16], [0, .222, -.16], .049, { depth: .066 })
    make.screw('polish', [side * .067, .134, -.16], [side, 0, 0], .058)
    make.finish()
    return spring
  })
  const crankLink = nodeAt(motor)
  const crank = new Workshop(crankLink, finishes, 'motor')
  crank.rod('darkMetal', [0, .015, 0], [0, .982, 0], .040, { depth: .027, sides: 9 })
  crank.rod('polish', [0, .071, .012], [0, .922, .012], .026, { depth: .023, sides: 8 })
  crank.sphere('metal', [0, .032, 0], [.049, .090, .043], true)
  crank.sphere('metal', [0, .929, 0], [.048, .080, .042], true)
  crank.finish()
  const saddle = nodeAt(motor)
  const bridge = new Workshop(saddle, finishes, 'motor')
  bridge.rod('metal', [-.585, 0, 0], [.585, 0, 0], .023, { depth: .028, sides: 12 })
  bridge.screw('polish', [-.102, 0, 0], [1, 0, 0], .041)
  bridge.finish()
  assembly.tag('motor', motor, [-.08, .205, .08], 0, .92)
  return { gears, phases: [angle12, phase2, phase3], leaves, crankLink, saddle, driveHub: positions[0] }
}

function wingMount(parent, finishes, assembly, side) {
  const hinge = assembly.detach(nodeAt(parent, [side * socketX, socketY, socketZ]), [side, .41, .06], .88, .25, .86)
  const holder = new Workshop(hinge, finishes, 'hinges')
  holder.rod('darkMetal', [-side * .255, -.13, -.17], [side * .027, -.048, -.043], .084, { depth: .089 })
  holder.rod('polish', [-side * .244, .005, .138], [side * .049, -.008, .064], .068)
  holder.add('metal', cylinder(.117, .144, .102, 24), transform([0, -.034, 0]))
  holder.add('darkMetal', cylinder(.121, .126, .055, 24), transform([0, .020, 0]))
  holder.sphere('polish', [0, .038, 0], [.087, .066, .084])
  holder.rod('metal', [-.159, .021, 0], [.145, .021, 0], .051, { sides: 16 })
  holder.screw('polish', [side * .143, .021, 0], [side, 0, 0], .036)
  holder.finish()
  const signal = nodeAt(hinge, [0, .052, 0])
  const lever = new Workshop(signal, finishes, 'hinges')
  lever.rod('polish', [-side * .132, -.079, -.15], [side * .20, -.011, .032], .038, { depth: .047, sides: 10 })
  lever.rod('darkMetal', [-side * .240, -.17, -.30], [-side * .132, -.079, -.15], .025)
  lever.sphere('metal', [side * .115, -.015, .017], [.047, .037, .055], true)
  lever.finish()
  assembly.tag('hinges', hinge, [0, .067, .020], side, .52)
  return signal
}

function abdomenSkin(start, length, index, front = 0, back = 1) {
  return (angle, step, inset) => {
    const v = mix(front, back, step)
    const d = start + length * v
    const [rx, ry, cy] = profileAt(abdomenStations, d)
    const overlap = .038 + .037 * Math.sin(Math.PI * v) - .107 * (1 - v) ** 4 + .007 * (5 - index)
    const radius = inset + overlap
    return [(rx + radius) * Math.sin(angle), (ry + radius) * Math.cos(angle) + cy, -d]
  }
}

function cell(sample, hole) {
  const hex = aperturePoints(sample, hole, -.079, .97)
  const center = sample(hole.center, hole.v, -.065)
  const points = [center, ...hex]
  const uv = [.5, .5, ...regular(6, .5).flatMap(([x, y]) => [x + .5, y + .5])]
  const indices = hex.flatMap((_, i) => [0, i + 1, (i + 1) % 6 + 1])
  return surfaceBuffer(points.flat(), indices, uv)
}

function buildTergites(parent, finishes, assembly) {
  const geometry = [[.148, .478], [.500, .510], [.886, .504], [1.271, .487], [1.646, .465], [2.000, .432]]
  return geometry.map(([start, length], i) => {
    const slide = nodeAt(parent)
    const plate = assembly.detach(nodeAt(slide), [0, 0, -1], .24 + i * .446, .07 + .044 * (5 - i), .90)
    const maker = new Workshop(plate, finishes, 'tergites')
    const skin = abdomenSkin(start, length, i, 0, .773)
    const rich = i > 0 && i < 5
    const holes = rich ? [-1.38, -.92, -.46, 0, .46, .92, 1.38].map((center) => ({ center, half: .23, v: .57, ru: i === 4 ? .143 : .152, rv: .258 })) : []
    maker.add(i === 0 ? 'enamel' : 'porcelain', formedShell(skin, -Math.PI, Math.PI, { holes, columns: 46, rows: 10, thickness: .040 }), null, !rich)
    const seam = abdomenSkin(start, length, i, .763, 1)
    maker.add('metal', formedShell(seam, -Math.PI, Math.PI, { columns: 50, rows: 6, thickness: .025 }))
    maker.tube('darkMetal', ring(seam, .831, -Math.PI, Math.PI, -.003, 43), .022, true, 70, 6)
    maker.tube('polish', ring(seam, .669, -Math.PI, Math.PI, .011, 44), .012, true, 72, 6)
    maker.tube('vein', ring(skin, .164, -Math.PI, Math.PI, .004, 40), .008, true, 57, 5)
    const rivets = Array.from({ length: 22 }, (_, j) => {
      const a = j / 22 * TAU
      const q = new Quaternion().setFromUnitVectors(vertical, new Vector3(Math.sin(a), Math.cos(a), -.07).normalize())
      return transform(seam(a, .20, .005), q, [.020, .70, .020])
    })
    maker.instances('polish', brassPin, rivets)
    for (const hole of holes) {
      // A thin rolled gold rim surrounds the pierced ceramic, with amber recessed below.
      const corners = aperturePoints(skin, hole, .004, 1.08)
      for (let j = 0; j < corners.length; j++) {
        maker.rod('polish', corners[j], corners[(j + 1) % corners.length], .010, { taper: .94, sides: 8 })
      }
    }
    maker.finish()
    if (rich) {
      const cells = new Workshop(plate, finishes, 'core')
      holes.forEach((hole) => cells.add('amber', cell(skin, hole)))
      cells.finish()
    }
    assembly.tag('tergites', plate, skin(.18, .61, .09), 0, i === 2 ? 1.06 : .71)
    return slide
  })
}

function buildReactor(parent, finishes, assembly) {
  const core = assembly.detach(nodeAt(parent, [0, .020, -.42]), [0, .83, -.58], 1.41, .34, .98)
  const make = new Workshop(core, finishes, 'core')
  make.rod('core', [0, 0, -.205], [0, 0, -1.65], .335, { taper: .48, sides: 12, ink: true })
  make.sphere('core', [0, 0, -.25], [.335, .335, .242])
  make.sphere('amber', [0, 0, -1.65], [.18, .18, .22])
  for (let i = 0; i < 5; i++) {
    const r = i === 4 ? .244 : .362 - i * .024
    const z = -.16 - i * .34
    make.add('darkMetal', cylinder(r, r, .048, 12), transform([0, 0, z], yToZ), true)
    make.tube('polish', oval(r + .012, r + .012, [0, 0, z - .026], 12), .018, true, 38, 5)
  }
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8
    const x = Math.cos(a)
    const y = Math.sin(a)
    make.tube('metal', [[x * .29, y * .29, -.09], [x * .367, y * .367, -.31], [x * .32, y * .32, -.84],
      [x * .268, y * .268, -1.31], [x * .159, y * .159, -1.73]], .016)
  }
  make.finish()
  assembly.tag('core', core, [0, .23, -.87], 0, .92)
}

function buildSting(parent, finishes, assembly) {
  const stinger = assembly.detach(nodeAt(parent, [0, -.070, -2.378]), [0, -.11, -1], 2.78, .00, .74)
  const cart = new Workshop(stinger, finishes, 'sting')
  cart.rod('metal', [0, 0, 0], [0, -.019, -.212], .153, { taper: .43, sides: 24, ink: true })
  cart.rod('darkMetal', [0, -.013, -.117], [0, -.024, -.237], .077, { taper: .60 })
  for (const side of [-1, 1]) {
    cart.rod('polish', [side * .049, -.019, -.135], [side * .011, -.032, -.252], .031, { taper: .08, sides: 10 })
    for (let i = 0; i < 3; i++) {
      const z = -.188 - i * .021
      cart.rod('metal', [side * .027, -.025, z], [side * (.063 - i * .013), -.031, z + .039], .010, { taper: .08, sides: 7 })
    }
  }
  cart.finish()
  assembly.tag('sting', stinger, [0, -.034, -.209], 0, .35)
}

export class BodyRig {
  constructor(root, finishes, assembly) {
    this.root = root
    const lower = nodeAt(root)
    const box = new Workshop(lower, finishes, 'plates')
    box.add('enamel', formedShell(chest(.12, 1.88), 1.84, TAU - 1.84, { columns: 29, rows: 17, thickness: .062 }), null, true)
    for (const side of [-1, 1]) {
      box.tube('darkMetal', [[side * .43, -.196, .84], [side * .662, -.235, .558], [side * .80, -.258, .12], [side * .736, -.245, -.42], [side * .571, -.195, -.71]], .071)
      box.tube('polish', [[side * .44, -.185, .84], [side * .69, -.239, .56], [side * .797, -.245, .11], [side * .74, -.229, -.43]], .019)
    }
    box.finish()
    this.plates = [dorsalPlate(root, finishes, assembly, .085, 1.331, false), dorsalPlate(root, finishes, assembly, 1.354, 1.87, true)]
    this.motor = buildMotor(root, finishes, assembly)
    this.hinges = [-1, 1].map((side) => wingMount(root, finishes, assembly, side))
    const collar = new Workshop(nodeAt(root), finishes, 'housing')
    collar.rod('darkMetal', [0, .008, .885], [0, .044, 1.280], .31, { taper: .81 })
    collar.rod('polish', [0, .041, 1.056], [0, .048, 1.105], .322, { taper: .99, sides: 33 })
    collar.rod('metal', [0, .041, 1.161], [0, .047, 1.205], .294, { taper: .96, sides: 29 })
    collar.finish()
    this.tufts = [-1, 1].map((side) => setaeOn(root, finishes, assembly, (a, b) => {
      const u = side * mix(.12, 1.72, a)
      const v = (b * .79 + .05) ** 1.31
      return { position: chest(.078, .373, .039)(u, v, .003), normal: [Math.sin(u) * .80, Math.cos(u), .50] }
    }, { side, seed: 445 + side, count: 144, length: .91, axis: [side * .46, .94, .44], distance: .47, apt: [side * .48, .56, .81] }))
    const waist = assembly.detach(nodeAt(root, [0, -.005, -.882]), [0, -.18, -1], .76, .45, .95)
    const petiole = new Workshop(waist, finishes, 'petiole')
    petiole.rod('darkMetal', [0, 0, .14], [0, -.021, -.329], .201, { taper: .69, sides: 24 })
    for (const z of [.060, -.039, -.132, -.203]) {
      const r = .231 + (z - .05) * .22
      petiole.tube('polish', oval(r, r * .89, [0, -.018, z], 26), .025, true, 40, 5)
    }
    for (const side of [-1, 1]) petiole.screw('metal', [side * .205, -.013, -.09], [side, 0, 0], .055)
    petiole.finish()
    assembly.tag('petiole', waist, [.11, .06, -.115], 0, .55)
    this.abdomen = nodeAt(root, [0, -.014, -.921])
    this.abdomen.rotation.order = 'YXZ'
    this.rings = buildTergites(this.abdomen, finishes, assembly)
    buildReactor(this.abdomen, finishes, assembly)
    buildSting(this.abdomen, finishes, assembly)
    this.tailRoll = new Spring(0, 1.60, .70)
    this.tailYaw = new Spring(0, 1.25, .65)
    this.tailPitch = new Spring(.022, 1.38, .69)
    this.linkAxis = new Vector3()
  }

  step(dt, state, explored, blur) {
    const { phase, drive, shaft, time, bank, pitch, balance, warm } = state
    // At display speed the tiny elastic travel is attenuated along with the wing envelope.
    const pulse = drive * (1 - blur * .72) * Math.sin(phase) * (1 - explored * .83)
    this.plates[0].position.y = pulse * .018
    this.plates[0].scale.y = 1 + pulse * .012
    this.plates[1].rotation.x = pulse * .021
    this.plates[1].position.y = -pulse * .011
    this.hinges.forEach((hinge, i) => hinge.rotation.y = (i ? 1 : -1) * pulse * .26)
    this.motor.leaves.forEach((leaf, i) => { leaf.scale.y = 1 + .21 * pulse + .04 * warm * Math.sin(shaft + i * 1.5) })
    const ratios = [1, -18 / 12, 18 / 15]
    this.motor.gears.forEach((gear, i) => { gear.rotation.z = this.motor.phases[i] + shaft * ratios[i] })
    const { crankLink, saddle, driveHub, phases } = this.motor
    saddle.position.set(0, .438 + pulse * .024 + warm * .013 * Math.sin(shaft), -.160)
    crankLink.position.set(-.10, driveHub[0] + .15 * Math.sin(shaft + phases[0]), driveHub[1] - .15 * Math.cos(shaft + phases[0]))
    this.linkAxis.set(-.10, saddle.position.y, saddle.position.z).sub(crankLink.position)
    crankLink.scale.y = this.linkAxis.length()
    crankLink.quaternion.setFromUnitVectors(vertical, this.linkAxis.normalize())
    this.abdomen.rotation.z = this.tailRoll.step(-bank * .47 + .044 * Math.sin(time * 1.61) * drive, dt)
    this.abdomen.rotation.y = this.tailYaw.step(-balance * .23 + Math.sin(time * 1.16) * .046, dt)
    this.abdomen.rotation.x = this.tailPitch.step(.018 + pitch * .63 + .040 * Math.sin(time * 2.41 + .6) * drive, dt)
    const respiration = (.50 + Math.sin(time * 2.75 + .19) * .50) * (1 - explored * .88)
    for (const [i, ringCarrier] of this.rings.entries()) {
      ringCarrier.position.z = -(.0145 * (i + .35)) * respiration
      const scale = 1 + respiration * .009 * Math.sin((i + 1) * .49)
      ringCarrier.scale.set(scale, scale, 1)
    }
    this.tufts.forEach((tuft, i) => { tuft.rotation.z = .0045 * Math.sin(time * (6.14 + i * .86) + i) * (.28 + drive) })
  }
}
