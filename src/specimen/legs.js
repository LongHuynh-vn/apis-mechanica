import { Group, InstancedMesh, Matrix4, Sphere, Vector3 } from 'three'
import { mix, smooth, Spring, vec } from '../math.js'
import { nodeAt, surfaceBuffer, Workshop } from './geometry.js'

const tarsalLengths = [.111, .085, .073, .062, .052]
const tibiaLengths = [.660, .738, .845]
const femurLengths = [.685, .744, .831]
const legSockets = [.657, .030, -.563]
const stanceX = [1.20, 1.48, 1.27]
const stanceZ = [.91, .01, -1.15]
const matrices = { basis: new Matrix4(), inverse: new Matrix4(), transform: new Matrix4() }
const yAxis = new Vector3()
const zAxis = new Vector3()
const xAxis = new Vector3()

function poseSegment(carrier, a, b, pin, normalizedLength = true) {
  yAxis.subVectors(b, a)
  const length = yAxis.length()
  yAxis.divideScalar(Math.max(length, .0001))
  zAxis.crossVectors(pin, yAxis).normalize()
  xAxis.crossVectors(yAxis, zAxis).normalize()
  matrices.basis.makeBasis(xAxis, yAxis, zAxis)
  carrier.position.copy(a)
  carrier.quaternion.setFromRotationMatrix(matrices.basis)
  carrier.scale.y = normalizedLength ? length : 1
}

function buildStock(finishes, root, name, nodes) {
  const temporary = new Group()
  const make = new Workshop(temporary, finishes, 'legs')
  if (name === 'coxa' || name === 'trochanter') {
    const radius = name === 'coxa' ? .102 : .080
    make.rod('darkMetal', [0, .02, 0], [0, .95, 0], radius, { taper: .78, depth: radius * .83 })
    make.rod('metal', [0, .11, 0], [0, .74, 0], radius * .87, { taper: .47 })
    make.rod('polish', [-radius * 1.14, .14, 0], [radius * 1.14, .14, 0], radius * .58, { sides: 10 })
  }
  if (name === 'femur' || name === 'tibia') {
    const radius = name === 'femur' ? .102 : .084
    make.rod('darkMetal', [0, .04, 0], [0, .99, 0], radius * .65, { taper: .65, depth: radius * .51 })
    make.sphere('darkMetal', [0, .028, 0], [.091, .119, .092], true)
    make.rod('polish', [-radius * 1.20, .041, 0], [radius * 1.20, .041, 0], .052, { sides: 14 })
    for (const side of [-1, 1]) make.screw('polish', [side * radius * 1.14, .041, 0], [side, 0, 0], .028)
    make.sphere('metal', [0, .419, .016], [radius * 1.02, .42, radius * .86], true)
    make.sphere('enamel', [0, .385, radius * .53], [radius * .59, .298, radius * .49], true)
    make.tube('polish', [[0, .14, radius * .54], [0, .31, radius * .96], [0, .51, radius * .98], [0, .77, radius * .57]], .012)
    if (name === 'tibia') make.rod('polish', [0, .77, -.022], [0, 1.13, -.071], .021, { taper: .12, sides: 7 })
  }
  if (name === 'tarsus') {
    make.rod('darkMetal', [0, -.05, 0], [0, 1.01, 0], .043, { taper: .69, sides: 10 })
    make.rod('metal', [0, .09, 0], [0, .77, 0], .041, { taper: .66, sides: 9 })
    make.sphere('polish', [0, .075, 0], [.045, .29, .044], true)
  }
  if (name === 'claws') {
    make.sphere('darkMetal', [0, -.022, 0], [.039, .042, .028], true)
    for (const side of [-1, 1]) {
      make.tube('polish', [[side * .018, 0, 0], [side * .043, .034, -.008], [side * .053, .072, -.004], [side * .042, .090, .032]], .012, false, 15, 5)
      make.rod('metal', [side * .043, .079, .018], [side * .036, .087, .044], .013, { taper: .05, sides: 7 })
    }
  }
  make.finish()
  return temporary.children.map((prefab) => {
    const mesh = new InstancedMesh(prefab.geometry, prefab.material, nodes.length)
    mesh.userData.part = 'legs'
    mesh.frustumCulled = false
    mesh.boundingSphere = new Sphere(new Vector3(), 10)
    root.add(mesh)
    return { mesh, nodes }
  })
}

function pollenBasket(parent, finishes, assembly, side) {
  const basket = assembly.detach(nodeAt(parent, [0, .41, .081]), [0, .13, 1], .51, .045, .73)
  const maker = new Workshop(basket, finishes, 'corbicula')
  const vertices = [0, .02, .002]
  const uv = [.5, .5]
  const indices = []
  const total = 22
  for (let row = 1; row <= 4; row++) for (let i = 0; i < total; i++) {
    const a = i / total * Math.PI * 2
    const r = row / 4
    const y = .263 * r * Math.sin(a) + .021
    const x = .106 * r * Math.cos(a) * (1 - y * .87)
    const z = .054 * r ** 1.8 - .029 * Math.abs(y)
    vertices.push(x, y, z)
    uv.push(x * 4 + .5, y * 1.55 + .5)
    const b = 1 + (row - 1) * total + i
    const c = 1 + (row - 1) * total + (i + 1) % total
    if (row === 1) indices.push(0, b, c)
    else indices.push(b - total, b, c, b - total, c, c - total)
  }
  maker.add('darkMetal', surfaceBuffer(vertices, indices, uv))
  for (const edge of [-1, 1]) {
    const rail = [[0, -.239, .04], [edge * .080, -.183, .049], [edge * .108, .022, .054], [edge * .074, .202, .046], [0, .286, .047]]
    maker.tube('polish', rail, .017)
    for (let i = 0; i < 11; i++) {
      const v = i / 11
      const y = -.198 + v * .435
      const x = Math.sqrt(Math.max(.1, 1 - ((y - .02) / .269) ** 2)) * .114
      maker.tube('metal', [[edge * x, y, .052], [edge * (x + .027), y + .008, .090], [edge * (x + .011), y + .038, .107], [edge * (x - .025), y + .074, .099]], .0058, false, 8, 4)
    }
  }
  maker.finish()
  assembly.tag('corbicula', basket, [0, .01, .10], side, .38)
}

const segmentTypes = ['coxa', 'trochanter', 'femur', 'tibia']

export class LegsRig {
  constructor(root, finishes, assembly, plinthY) {
    this.root = root
    this.plinthY = plinthY
    this.instances = []
    const allAnchors = new Map([...segmentTypes, 'tarsus', 'claws'].map((id) => [id, []]))
    this.legs = []
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const base = assembly.detach(nodeAt(root), [side, -.26, (1 - i) * .27], .92 + i * .096, .35, .91)
      const carriers = []
      for (const [index, name] of [...segmentTypes, ...Array(5).fill('tarsus'), 'claws'].entries()) {
        const anchor = nodeAt(base)
        const mount = assembly.detach(nodeAt(anchor), [0, 1, .17], index === 9 ? .27 : .162,
          .055 + (9 - index) * .031, .59 + (9 - index) * .028)
        allAnchors.get(name).push(mount)
        carriers.push(anchor)
        if (name === 'femur') assembly.tag('legs', mount, [side * .04, .51, .045], side, .75)
        if (name === 'tibia' && i === 2) pollenBasket(mount, finishes, assembly, side)
      }
      this.legs.push({
        side, i, carriers, x: new Spring(0, 2.43 + .20 * i + side * .16, .66),
        y: new Spring(0, 2.19 + .25 * i + side * .14, .70),
        z: new Spring(0, 1.92 + .30 * i + side * .17, .68),
        joints: Array.from({ length: 10 }, () => new Vector3()), pin: new Vector3(),
        footPath: Array.from({ length: 5 }, () => new Vector3()),
        center: vec([side * [.546, .624, .575][i], -.378 + i * .009, legSockets[i]]),
      })
    }
    for (const [id, anchors] of allAnchors) this.instances.push(...buildStock(finishes, root, id, anchors))
    this.work = {
      vector: new Vector3(), plane: new Vector3(), axis: new Vector3(), a: new Vector3(), b: new Vector3(),
    }
  }

  step(dt, state, exploded) {
    const { time, gear, position, velocity, pitch, bank, compression } = state
    const { vector, plane, axis, a, b } = this.work
    for (const leg of this.legs) {
      const { i, side, center, carriers, joints: j, pin } = leg
      const lift = gear * (1 - smooth(.1, .75, exploded))
      const swing = Math.sin(time * (3.65 - i * .32) + i * 1.27 + side * .691)
      leg.x.step(lift * ([-.31, -.41, -.26][i] + .076 * swing), dt)
      leg.y.step(lift * (.025 + .072 * Math.sin(time * (3.35 + i * .17) + side * 1.22)), dt)
      leg.z.step(lift * (-.52 - .195 * i + .127 * swing - velocity.length() * .09), dt)
      j[0].copy(center)
      j[1].copy(j[0]).add(a.set(side * .245, -.100 + lift * .024, (1 - i) * .090))
      j[2].copy(j[1]).add(a.set(side * .124, -.057 - lift * .059, (1 - i) * .135))
      const stretch = smooth(.11, .77, exploded)
      const toeX = side * (stanceX[i] + leg.x.value + .45 * stretch + .09 * compression)
      const toeZ = stanceZ[i] + leg.z.value + .042 * (1 - i) * compression
      let drop = 0
      for (const [k, length] of tarsalLengths.entries()) {
        leg.footPath[k].set(side * (.27 - k * .041), mix(-.86, -.36, k / 4) - lift * .26, mix([.66, .07, -.56][i], -.42, lift))
          .normalize().multiplyScalar(length * (1 + .04 * i))
        drop += leg.footPath[k].y
      }
      const stanceY = this.plinthY - position.y + .035 - drop + pitch * toeZ - bank * toeX
      const movingY = mix(-.69 - .139 * i, -.81 - .111 * i, gear) + leg.y.value
      const contact = (1 - smooth(.025, .45, position.y - state.restY)) * (1 - stretch)
      j[4].set(toeX, mix(movingY, stanceY, contact), toeZ)
      axis.subVectors(j[4], j[2])
      let d = axis.length()
      const thigh = femurLengths[i]
      const shin = tibiaLengths[i]
      if (d > thigh + shin - .017) {
        d = thigh + shin - .017
        j[4].copy(j[2]).addScaledVector(axis.normalize(), d)
      } else axis.normalize()
      plane.set(side * .91, .41 + lift * .42, .17 * (1 - i))
      plane.addScaledVector(axis, -plane.dot(axis)).normalize()
      const t = (thigh ** 2 + d ** 2 - shin ** 2) / Math.max(2 * d, .001)
      const n = Math.sqrt(Math.max(0, thigh ** 2 - t ** 2))
      j[3].copy(j[2]).addScaledVector(axis, t).addScaledVector(plane, n)
      pin.crossVectors(axis, plane).multiplyScalar(-side).normalize()
      for (let k = 0; k < 5; k++) j[k + 5].copy(j[k + 4]).add(leg.footPath[k])
      vector.set(side * .06, -.40, mix([.63, .13, -.38][i], -.26, lift)).normalize()
      b.copy(j[9]).add(vector)
      for (let k = 0; k < 9; k++) poseSegment(carriers[k], j[k], j[k + 1], pin)
      poseSegment(carriers[9], j[9], b, pin, false)
    }
  }

  updateInstances() {
    matrices.inverse.copy(this.root.matrixWorld).invert()
    for (const { mesh, nodes } of this.instances) {
      for (let i = 0; i < nodes.length; i++) mesh.setMatrixAt(i, matrices.transform.multiplyMatrices(matrices.inverse, nodes[i].matrixWorld))
      mesh.instanceMatrix.needsUpdate = true
    }
  }
}
