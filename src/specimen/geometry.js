import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, EdgesGeometry, ExtrudeGeometry,
  Float32BufferAttribute, Group, InstancedMesh, LineSegments, Matrix4, Mesh, Quaternion,
  Shape, SphereGeometry, TubeGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mix, TAU, vec } from '../math.js'

const up = new Vector3(0, 1, 0)
const identity = new Quaternion()
const zero = new Vector3()
const one = new Vector3(1, 1, 1)
export const pinAxis = new Vector3(1, 0, 0)
export const vertical = up

export const nodeAt = (parent, position = [0, 0, 0]) => {
  const group = new Group()
  group.position.copy(vec(position))
  parent.add(group)
  return group
}

const sphereHigh = new SphereGeometry(1, 30, 20)
const sphereLow = new SphereGeometry(1, 12, 8)
const cylinderCache = new Map()
export function cylinder(top, bottom, height, sides = 24) {
  const key = [top, bottom, height, sides].join(',')
  if (!cylinderCache.has(key)) cylinderCache.set(key, new CylinderGeometry(top, bottom, height, sides))
  return cylinderCache.get(key)
}

export const tube = (points, thickness, closed = false, steps = Math.max(8, points.length * 5), sides = 6) =>
  new TubeGeometry(new CatmullRomCurve3(points.map(vec), closed, 'centripetal'), steps, thickness, sides, closed)

export const oval = (rx, ry, at = [0, 0, 0], segments = 36) =>
  Array.from({ length: segments }, (_, i) => {
    const t = i * TAU / segments
    return [at[0] + rx * Math.cos(t), at[1] + ry * Math.sin(t), at[2]]
  })

export function extrude(points, depth, bevel = 0, holes = []) {
  const path = (list) => {
    const shape = new Shape()
    list.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
    shape.closePath()
    return shape
  }
  const shape = path(points)
  shape.holes = holes.map(path)
  return new ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: bevel > 0, bevelSegments: 2, bevelThickness: bevel, bevelSize: bevel, curveSegments: 1,
  })
}

export const regular = (count, radius, angle = 0) => Array.from({ length: count }, (_, i) => {
  const t = i * TAU / count + angle
  return [radius * Math.cos(t), radius * Math.sin(t)]
})

export function transform(position = zero, orientation = identity, scale = one) {
  return new Matrix4().compose(vec(position), orientation, vec(scale))
}

export function rotation(axis, angle) {
  return new Quaternion().setFromAxisAngle(vec(axis), angle)
}

export function rodMatrix(a, b, thickness, depth = thickness) {
  const from = vec(a)
  const to = vec(b)
  const delta = new Vector3().subVectors(to, from)
  const length = delta.length()
  return transform(
    new Vector3().lerpVectors(from, to, .5), new Quaternion().setFromUnitVectors(up, delta.normalize()),
    [thickness, length, depth],
  )
}

export class Workshop {
  constructor(parent, finishes, id) {
    this.parent = parent
    this.finishes = finishes
    this.id = id
    this.batches = new Map()
    this.edges = []
  }

  add(finish, geometry, matrix, ink = false) {
    const shape = matrix ? geometry.clone().applyMatrix4(matrix) : geometry.clone()
    if (!this.batches.has(finish)) this.batches.set(finish, [])
    this.batches.get(finish).push(shape)
    if (ink) {
      this.edges.push(new EdgesGeometry(shape, 33))
    }
    return this
  }

  sphere(finish, at, scale, low = false, orientation = identity) {
    return this.add(finish, low ? sphereLow : sphereHigh, transform(at, orientation, scale))
  }

  rod(finish, a, b, radius, { taper = 1, depth = radius, sides = 16, ink = false } = {}) {
    return this.add(finish, cylinder(taper, 1, 1, sides), rodMatrix(a, b, radius, depth), ink)
  }

  tube(finish, points, radius, closed = false, steps, sides) {
    const geometry = tube(points, radius, closed, steps, sides)
    this.add(finish, geometry)
    geometry.dispose()
    return this
  }

  // Two opposing screw slots sit just above the head face.
  screw(finish, at, axis, r = .043) {
    const head = vec(at)
    const normal = vec(axis).clone().normalize()
    const slot = new Vector3().crossVectors(normal, Math.abs(normal.y) > .8 ? pinAxis : up).normalize()
    const face = new Vector3().copy(head).addScaledVector(normal, .019)
    this.rod('darkMetal', head, face, r * 1.14, { taper: .94, sides: 12 })
    this.rod(finish, face, face.clone().addScaledVector(normal, .012), r * .86, { taper: .82, sides: 10 })
    face.addScaledVector(normal, .0125)
    this.rod('darkMetal', face.clone().addScaledVector(slot, -r * .57), face.clone().addScaledVector(slot, r * .57), r * .09, { sides: 5 })
    return this
  }

  instances(finish, geometry, matrices, colors) {
    const mesh = new InstancedMesh(geometry, this.finishes.material(this.id, finish), matrices.length)
    matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix)
      if (colors) mesh.setColorAt(i, colors[i])
    })
    mesh.computeBoundingSphere()
    mesh.userData.part = this.id
    this.parent.add(mesh)
    return mesh
  }

  finish() {
    for (const [finish, shapes] of this.batches) {
      const indexed = shapes.every((shape) => shape.index)
      const compatible = indexed ? shapes : shapes.map((shape) => shape.index ? shape.toNonIndexed() : shape)
      const geometry = compatible.length === 1 ? compatible[0] : mergeGeometries(compatible)
      const mesh = new Mesh(geometry, this.finishes.material(this.id, finish))
      mesh.userData.part = this.id
      if (mesh.material.transparent) mesh.renderOrder = finish === 'etch' ? 5 : finish === 'glass' ? 3 : 4
      this.parent.add(mesh)
      for (const shape of new Set([...shapes, ...compatible])) {
        if (shape !== geometry) shape.dispose()
      }
    }
    if (this.edges.length) {
      const edges = new LineSegments(mergeGeometries(this.edges), this.finishes.ink)
      edges.userData.featureInk = true
      edges.renderOrder = 4
      this.parent.add(edges)
      this.edges.forEach((geometry) => geometry.dispose())
    }
    return this.parent
  }
}

// Cubic interpolation keeps each machined profile smooth between section stations.
export function profileAt(stations, z) {
  const end = stations.length - 1
  let i = 0
  while (i < end - 1 && z > stations[i + 1][0]) i++
  const left = stations[i]
  const right = stations[i + 1]
  const before = stations[Math.max(0, i - 1)]
  const after = stations[Math.min(end, i + 2)]
  const distance = right[0] - left[0]
  const t = Math.min(1, Math.max(0, (z - left[0]) / distance))
  const t2 = t * t
  const t3 = t2 * t
  return left.slice(1).map((a, j) => {
    const b = right[j + 1]
    const first = (b - before[j + 1]) * distance / (right[0] - before[0])
    const last = (after[j + 1] - a) * distance / (after[0] - left[0])
    return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * first + (-2 * t3 + 3 * t2) * b + (t3 - t2) * last
  })
}

export function surfaceBuffer(vertices, indices, uvs) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// A formed shell parameterized across its arc (u) and length (v). The shell
// has inner and outer skins, rolled edges and open hexagonal apertures.
export function formedShell(sample, minU, maxU, { holes = [], columns = 38, rows = 9, thickness = .028 } = {}) {
  const vertices = []
  const normals = []
  const uv = []
  const indices = []
  const delta = .0002
  const add = (u, v, inset, face) => {
    const index = vertices.length / 3
    const point = sample(u, v, inset)
    vertices.push(...point)
    uv.push((u + Math.PI) / TAU, v)
    if (face) {
      const along = vec(sample(u + delta, v, inset)).sub(vec(sample(u - delta, v, inset)))
      const length = vec(sample(u, v + delta, inset)).sub(vec(sample(u, v - delta, inset)))
      along.cross(length).normalize().multiplyScalar(face)
      normals.push(...along.toArray())
    } else normals.push(0, 0, 0)
    return index
  }
  const quad = (a, b, c, d, reverse = false) => {
    if (reverse) indices.push(a, d, b, b, d, c)
    else indices.push(a, b, d, b, c, d)
  }
  function grid(left, right, nx, inset, face) {
    const origin = vertices.length / 3
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= nx; j++) {
      add(mix(left, right, j / nx), i / rows, inset, face)
      if (i && j) {
        const end = origin + i * (nx + 1) + j
        quad(end - nx - 2, end - nx - 1, end, end - 1, face < 0)
      }
    }
  }
  function wall(sweep, count, reverse = false) {
    const start = vertices.length / 3
    for (let i = 0; i <= count; i++) {
      const [u, v] = sweep(i / count)
      add(u, v, 0, 0)
      add(u, v, -thickness, 0)
      const n = start + i * 2
      if (i) quad(n - 2, n, n + 1, n - 1, reverse)
    }
  }
  const patches = holes.map((hole) => {
    const near = hole.center - hole.half
    const far = hole.center + hole.half
    const rays = [
      ...Array.from({ length: 18 }, (_, i) => i * TAU / 18),
      Math.atan2(hole.v, hole.half), Math.atan2(1 - hole.v, hole.half),
      ...regular(6, 1).map(([x, y]) => (Math.atan2(y * hole.rv, x * hole.ru) + TAU) % TAU),
    ].flatMap((angle) => [angle, (Math.PI - angle + TAU) % TAU, (Math.PI + angle) % TAU, (TAU - angle) % TAU])
      .sort((a, b) => a - b)
      .filter((angle, i, list) => !i || angle - list[i - 1] > 1e-6)
    const aperture = (angle) => hexPoint(hole, angle)
    const boundary = (angle) => {
      const x = Math.cos(angle)
      const y = Math.sin(angle)
      const d = Math.min(hole.half / Math.abs(x), (y > 0 ? 1 - hole.v : hole.v) / Math.abs(y))
      return [hole.center + d * x, hole.v + d * y]
    }
    return { near, far, aperture, boundary, rays }
  })
  for (const face of [1, -1]) {
    const inset = face === 1 ? 0 : -thickness
    let left = minU
    for (const patch of patches) {
      if (patch.near - left > 1e-5) grid(left, patch.near, Math.max(2, Math.ceil(columns * (patch.near - left) / (maxU - minU))), inset, face)
      const n = patch.rays.length
      const start = vertices.length / 3
      for (let r = 0; r <= 4; r++) {
        for (const angle of patch.rays) {
          const [au, av] = patch.aperture(angle)
          const [bu, bv] = patch.boundary(angle)
          add(mix(au, bu, r / 4), mix(av, bv, r / 4), inset, face)
        }
        if (r) for (let i = 0; i < n; i++) {
          const inner = start + (r - 1) * n
          const next = (i + 1) % n
          quad(inner + i, inner + i + n, inner + next + n, inner + next, face < 0)
        }
      }
      left = patch.far
    }
    if (maxU - left > 1e-5) grid(left, maxU, Math.max(2, Math.ceil(columns * (maxU - left) / (maxU - minU))), inset, face)
  }
  wall((t) => [mix(minU, maxU, t), 0], columns, true)
  wall((t) => [mix(minU, maxU, t), 1], columns)
  if (maxU - minU < TAU - .001) {
    wall((t) => [minU, t], rows)
    wall((t) => [maxU, t], rows, true)
  }
  for (const patch of patches) {
    const start = vertices.length / 3
    for (const angle of patch.rays) {
      const [u, v] = patch.aperture(angle)
      add(u, v, 0, 0)
      add(u, v, -thickness, 0)
    }
    const n = patch.rays.length
    for (let i = 0; i < n; i++) quad(start + 2 * i, start + 2 * ((i + 1) % n), start + 2 * ((i + 1) % n) + 1, start + 2 * i + 1)
  }
  const geometry = surfaceBuffer(vertices, indices, uv)
  const attribute = geometry.getAttribute('normal')
  for (let i = 0; i < normals.length; i += 3) {
    if (Math.abs(normals[i]) + Math.abs(normals[i + 1]) + Math.abs(normals[i + 2]) > .01) {
      attribute.setXYZ(i / 3, normals[i], normals[i + 1], normals[i + 2])
    }
  }
  return geometry
}

function hexPoint(hole, angle) {
  const x = Math.cos(angle) / hole.ru
  const y = Math.sin(angle) / hole.rv
  const heading = Math.atan2(y, x)
  const sector = Math.PI / 3
  const remainder = ((heading % sector) + sector) % sector - sector / 2
  const radius = Math.cos(sector / 2) / Math.cos(remainder)
  const factor = radius / Math.hypot(x, y)
  return [hole.center + factor * Math.cos(angle), hole.v + factor * Math.sin(angle)]
}

export function aperturePoints(sample, hole, inset, scale = 1) {
  return regular(6, 1).map(([x, y]) => sample(hole.center + x * hole.ru * scale, hole.v + y * hole.rv * scale, inset))
}
