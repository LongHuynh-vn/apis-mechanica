import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { angleBetween, clamp, damp, mix, vec } from '../math.js'

const presets = [
  { theta: .962, phi: 1.102, radius: 11.82, target: [-.04, 1.40, -.35] },
  { theta: .27, phi: .026, radius: 12.27, target: [0, 1.37, -.32] },
  { theta: .07, phi: 1.345, radius: 11.72, target: [0, 1.62, .06] },
  { theta: Math.PI / 2, phi: 1.413, radius: 11.81, target: [0, 1.44, -.24] },
  { theta: .681, phi: 1.21, radius: 3.43, target: [0, 0, 0] },
]

export class CameraRig {
  constructor(width, height) {
    this.camera = new PerspectiveCamera(33.5, width / height, .064, 95)
    this.width = width
    this.height = height
    this.view = 0
    this.orbit = false
    this.spherical = new Spherical(presets[0].radius, presets[0].phi, presets[0].theta)
    this.target = vec(presets[0].target)
    this.ideal = new Vector3()
    this.offset = new Vector3()
    this.pan = new Vector3()
    this.right = new Vector3()
    this.up = new Vector3()
    this.follow = new Vector3()
    this.forward = new Vector3()
    this.look = new Vector3()
    this.inspect = null
    this.manualZoom = 1
    this.turn = 0
    this.tilt = 0
    this.dof = 0
    this.focusDistance = presets[4].radius
    this.camera.position.copy(this.target).add(this.offset.setFromSpherical(this.spherical))
    this.camera.lookAt(this.target)
  }

  resize(width, height) {
    this.width = width
    this.height = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  setView(view) {
    this.view = view
    this.inspect = null
    this.manualZoom = 1
    this.turn = 0
    this.tilt = 0
    this.pan.set(0, 0, 0)
  }

  frame(part) {
    this.inspect = part
    this.pan.set(0, 0, 0)
    this.manualZoom = 1
  }

  drag(x, y, panning) {
    if (panning) {
      const worldPerPixel = 2 * Math.tan(this.camera.fov * Math.PI / 360) * this.spherical.radius / this.height
      this.right.setFromMatrixColumn(this.camera.matrix, 0)
      this.up.setFromMatrixColumn(this.camera.matrix, 1)
      this.pan.addScaledVector(this.right, -x * worldPerPixel).addScaledVector(this.up, y * worldPerPixel).clampLength(0, 12)
    } else {
      this.turn -= x * .0062
      this.tilt = clamp(this.tilt - y * .0059, .025 - presets[this.view].phi, 1.555 - presets[this.view].phi)
    }
  }

  zoom(delta) {
    this.manualZoom = clamp(this.manualZoom * Math.exp(delta * .00115), this.view === 4 || this.inspect ? .61 : .46, 3)
  }

  update(dt, flight, head, exploded, opening) {
    const preset = presets[this.view]
    let radius = preset.radius
    const narrow = clamp((1.52 - this.camera.aspect) / 1.02)
    if (this.orbit) this.turn += .132 * dt
    let theta = preset.theta + this.turn
    let phi = preset.phi + this.tilt
    this.ideal.set(...preset.target)
    const inspecting = this.inspect !== null
    const macro = this.view === 4 && !inspecting
    if (inspecting) {
      this.ideal.copy(this.inspect.point).applyMatrix4(this.inspect.node.matrixWorld)
      radius = clamp(this.inspect.radius * 4.25, 2.80, 6.40)
      if (this.view === 1) phi = mix(phi, 1.03, .73)
    } else if (macro) {
      this.ideal.set(.35, .14, .527).applyMatrix4(head.matrixWorld)
      this.ideal.y -= narrow * .055
    } else {
      this.follow.set(flight.position.x * .64, (flight.position.y - flight.restY) * .62, flight.position.z * .61)
      this.ideal.add(this.follow)
      const airborne = clamp((flight.position.y - flight.restY) * .86)
      radius += exploded * 8.35 + airborne * 2.52
      const restingWidth = [7.05, 4.80, 4.30, 7.42][this.view]
      const span = mix(restingWidth, 10.65, airborne) + exploded * 4.25
      const horizontalFov = Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect
      radius = Math.max(radius, span / (2 * horizontalFov * (.89 - exploded * .12)))
      theta += .05 * (1 - opening)
      if (this.view !== 1) {
        this.ideal.y += (exploded * .82 + airborne * .18) * (1 - narrow) - narrow * .49
        if (this.view === 0) {
          const shift = (airborne * .30 + exploded * .72) * (1 - narrow) + narrow * .37
          this.ideal.x -= Math.cos(theta) * shift
          this.ideal.z += Math.sin(theta) * shift
        }
        phi += exploded * (this.view === 0 ? -.09 : 0)
      }
    }
    const aspectScale = macro || inspecting ? 1 + narrow * .23 : 1
    this.ideal.add(this.pan)
    this.spherical.radius = damp(this.spherical.radius, (radius + (1 - opening) * .50) * this.manualZoom * aspectScale, 5.6, dt)
    this.spherical.phi = damp(this.spherical.phi, clamp(phi, .025, 1.555), 6.3, dt)
    this.spherical.theta += angleBetween(this.spherical.theta, theta) * (1 - Math.exp(-dt * 6.4))
    this.target.lerp(this.ideal, 1 - Math.exp(-dt * (macro || inspecting ? 6.3 : 4.5)))
    this.camera.position.copy(this.target).add(this.offset.setFromSpherical(this.spherical))
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld()
    this.dof = damp(this.dof, macro ? 1 : 0, 6, dt)
    this.focusDistance = mix(this.spherical.radius, this.camera.position.distanceTo(this.ideal), this.dof * .8)
  }
}
