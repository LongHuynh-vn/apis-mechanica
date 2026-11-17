import { BufferGeometry, Float32BufferAttribute, LineDashedMaterial, LineSegments, Vector3 } from 'three'
import { ease, ramp, vec } from '../math.js'

export class Assembly {
  constructor(scene) {
    this.mounts = []
    this.anchors = new Map()
    this.site = new Vector3()
    this.object = new Vector3()
    this.material = new LineDashedMaterial({ dashSize: .045, gapSize: .055, transparent: true, opacity: 0, depthWrite: false })
    this.guides = new LineSegments(new BufferGeometry(), this.material)
    this.guides.frustumCulled = false
    this.guides.renderOrder = 7
    scene.add(this.guides)
  }

  detach(node, axis, distance, start = .08, end = .88) {
    this.mounts.push({ node, seat: node.position.clone(), axis: vec(axis).clone().normalize(), distance, start, end })
    return node
  }

  tag(id, node, point = [0, 0, 0], side = 0, radius = .65) {
    if (!this.anchors.has(id)) this.anchors.set(id, [])
    this.anchors.get(id).push({ node, point: vec(point), side, radius })
  }

  apply(amount) {
    for (const mount of this.mounts) {
      const step = ease(ramp(mount.start, mount.end, amount))
      mount.node.position.copy(mount.seat).addScaledVector(mount.axis, step * mount.distance)
    }
  }

  drawGuides(opacity, color) {
    this.guides.visible = opacity > .01
    if (!this.guides.visible) return
    this.material.color.copy(color)
    this.material.opacity = opacity * .65
    const count = this.mounts.length * 2
    const geometry = this.guides.geometry
    if (!geometry.hasAttribute('position')) {
      geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3))
      geometry.setAttribute('lineDistance', new Float32BufferAttribute(new Float32Array(count), 1))
    }
    const positions = geometry.getAttribute('position')
    const distance = geometry.getAttribute('lineDistance')
    let i = 0
    for (const { node, seat } of this.mounts) {
      this.site.copy(seat).applyMatrix4(node.parent.matrixWorld)
      this.object.setFromMatrixPosition(node.matrixWorld)
      const length = this.site.distanceTo(this.object)
      if (length < .04) continue
      positions.setXYZ(i, this.site.x, this.site.y, this.site.z)
      positions.setXYZ(i + 1, this.object.x, this.object.y, this.object.z)
      distance.setX(i, 0)
      distance.setX(i + 1, length)
      i += 2
    }
    geometry.setDrawRange(0, i)
    positions.needsUpdate = true
    distance.needsUpdate = true
  }
}
