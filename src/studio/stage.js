import {
  BufferGeometry, Color, DepthTexture, Float32BufferAttribute, HalfFloatType, LineSegments, LinearFilter,
  Mesh, NeutralToneMapping, PlaneGeometry, ShaderMaterial, UnsignedIntType, Vector2,
  Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { PMREMGenerator } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import { clamp, mix, smooth, TAU } from '../math.js'
import { plinthTop, restHeight } from '../flight.js'
import { extrude, nodeAt, regular, rotation, transform, Workshop } from '../specimen/geometry.js'

const fullscreen = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

class PlateFinishPass extends Pass {
  constructor(camera, palette) {
    super()
    this.smallA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
    this.smallB = this.smallA.clone()
    this.extract = new ShaderMaterial({
      uniforms: { source: { value: null }, texel: { value: new Vector2() } },
      vertexShader: fullscreen,
      fragmentShader: `varying vec2 vUv; uniform sampler2D source; uniform vec2 texel;
        void main() {
          vec3 c = (texture2D(source, vUv + texel).rgb + texture2D(source, vUv - texel).rgb
            + texture2D(source, vUv + texel * vec2(1.0,-1.0)).rgb
            + texture2D(source, vUv + texel * vec2(-1.0,1.0)).rgb) * 0.25;
          float mask = smoothstep(1.33, 2.64, max(c.r, max(c.g, c.b)));
          gl_FragColor = vec4(c * mask, 1.0);
        }`,
    })
    this.blur = new ShaderMaterial({
      uniforms: { source: { value: null }, axis: { value: new Vector2() } },
      vertexShader: fullscreen,
      fragmentShader: `varying vec2 vUv; uniform sampler2D source; uniform vec2 axis;
        void main() {
          vec3 c = texture2D(source, vUv).rgb * 0.36;
          c += (texture2D(source, vUv + axis * 1.27).rgb + texture2D(source, vUv - axis * 1.27).rgb) * 0.242;
          c += (texture2D(source, vUv + axis * 2.86).rgb + texture2D(source, vUv - axis * 2.86).rgb) * 0.078;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    this.grade = new ShaderMaterial({
      uniforms: {
        source: { value: null }, bloom: { value: this.smallA.texture }, depth: { value: null },
        paper: { value: palette.css.paper }, lit: { value: palette.css.light }, edge: { value: palette.css.edge },
        texel: { value: new Vector2() }, dof: { value: 0 }, focus: { value: 4.1 }, vellum: { value: .38 },
        nearPlane: { value: camera.near }, farPlane: { value: camera.far }, bloomMix: { value: .1 },
      },
      vertexShader: fullscreen,
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D source, bloom, depth;
        uniform vec3 paper, lit, edge;
        uniform vec2 texel;
        uniform float dof, focus, nearPlane, farPlane, vellum, bloomMix;
        float distanceToCamera(vec2 p) {
          float d = texture2D(depth,p).x;
          return nearPlane * farPlane / (farPlane - d * (farPlane - nearPlane));
        }
        void main() {
          vec2 centre = (vUv - vec2(0.52, 0.62)) * vec2(1.0, 1.22);
          vec3 bg = mix(lit, paper, smoothstep(0.06, 0.67, length(centre)));
          bg = mix(bg, edge, smoothstep(0.42, 0.99, length(centre)) * 0.62);
          float stain = sin(vUv.x*11.0 + cos(vUv.y*8.0)) * sin(vUv.y*14.0 + vUv.x*4.0);
          bg *= 1.0 + stain * 0.027 * vellum;
          vec4 sampleColor = texture2D(source, vUv);
          if (dof > 0.001) {
            float distance = distanceToCamera(vUv);
            float radius = min(7.8, max(0.0, abs(distance-focus) - 0.27) * 3.0) * dof;
            if (radius > 0.4) {
              vec4 taps = sampleColor * 2.0;
              for (int i = 0; i < 8; i++) {
                float a = float(i) * 2.39996;
                vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(float(i) / 8.0 + .12) * radius * texel;
                taps += texture2D(source, uv);
              }
              sampleColor = taps * 0.1;
            }
          }
          vec3 composed = sampleColor.rgb + bg * (1.0 - sampleColor.a);
          gl_FragColor = vec4(composed + texture2D(bloom, vUv).rgb * bloomMix, 1.0);
        }`,
    })
    this.quad = new FullScreenQuad(null)
    this.width = 1
    this.height = 1
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.round(width / 4))
    this.height = Math.max(1, Math.round(height / 4))
    this.smallA.setSize(this.width, this.height)
    this.smallB.setSize(this.width, this.height)
    this.grade.uniforms.texel.value.set(1 / width, 1 / height)
    this.extract.uniforms.texel.value.set(1.30 / width, 1.30 / height)
  }

  render(renderer, writeBuffer, readBuffer) {
    this.extract.uniforms.source.value = readBuffer.texture
    this.draw(renderer, this.extract, this.smallA)
    const { axis, source } = this.blur.uniforms
    source.value = this.smallA.texture
    axis.value.set(1.18 / this.width, 0)
    this.draw(renderer, this.blur, this.smallB)
    source.value = this.smallB.texture
    axis.value.set(0, 1.18 / this.height)
    this.draw(renderer, this.blur, this.smallA)
    this.grade.uniforms.source.value = readBuffer.texture
    this.grade.uniforms.depth.value = readBuffer.depthTexture
    this.draw(renderer, this.grade, writeBuffer)
  }

  draw(renderer, material, target) {
    this.quad.material = material
    renderer.setRenderTarget(target)
    this.quad.render(renderer)
  }
}

export function makeRenderer(container, scene, camera, finish) {
  const renderer = new WebGLRenderer({ alpha: false, antialias: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0, 0)
  renderer.toneMapping = NeutralToneMapping
  renderer.info.autoReset = false
  renderer.domElement.setAttribute('aria-hidden', 'true')
  container.append(renderer.domElement)
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthTexture: new DepthTexture(1, 1, UnsignedIntType),
  })
  const composer = new EffectComposer(renderer, target)
  const renderPass = new RenderPass(scene, camera, null, null, 0)
  const grading = new PlateFinishPass(camera, finish.current)
  composer.addPass(renderPass)
  composer.addPass(grading)
  composer.addPass(new OutputPass())
  composer.addPass(new FXAAPass())

  const room = new RoomEnvironment()
  const reflections = new PMREMGenerator(renderer)
  scene.environment = reflections.fromScene(room, .07, .1, 80, { size: 128 }).texture
  room.dispose()
  reflections.dispose()
  return { renderer, composer, grading: grading.grade.uniforms }
}

function draftLayer(scene, palette, codex = false) {
  const points = []
  const add = (a, b, strength) => points.push(a[0], a[1], b[0], b[1], strength)
  const arc = (cx, cz, r, start, end, length, alpha) => {
    for (let i = 0; i < length; i++) {
      const a = mix(start, end, i / length)
      const b = mix(start, end, (i + 1) / length)
      add([cx + r * Math.cos(a), cz + r * Math.sin(a)], [cx + r * Math.cos(b), cz + r * Math.sin(b)], alpha)
    }
  }
  if (!codex) {
    const r = .595
    const holes = regular(6, r)
    for (let j = -15; j <= 15; j++) for (let i = -14; i <= 14; i++) {
      const x = i * r * 1.5
      const z = (j + (Math.abs(i) % 2) * .5) * r * Math.sqrt(3)
      if (Math.hypot(x, z) > 13.5) continue
      for (const edge of [0, 1, 2]) {
        const a = holes[edge]
        const b = holes[edge + 1]
        add([x + a[0], z + a[1]], [x + b[0], z + b[1]], .236)
      }
    }
    for (const radius of [3.56, 3.73, 5.45, 6.92, 8.43]) {
      arc(0, 0, radius, 0, TAU, 110, radius === 3.73 || radius === 5.45 ? .48 : .25)
    }
    const radius = 5.45
    for (let i = 0; i < 144; i++) {
      const a = i * TAU / 144
      const r = radius + (i % 12 === 0 ? .32 : i % 4 === 0 ? .19 : .092)
      add([Math.cos(a) * radius, Math.sin(a) * radius], [Math.cos(a) * r, Math.sin(a) * r], i % 4 === 0 ? .55 : .28)
    }
    for (const [x, z] of [[-6.25, -3.8], [6.25, -3.8], [-6.25, 3.8], [6.25, 3.8], [0, 5.44], [0, -5.44]]) {
      add([x - .23, z], [x + .23, z], .57)
      add([x, z - .23], [x, z + .23], .57)
      arc(x, z, .097, 0, TAU, 16, .48)
    }
    add([0, -8], [0, 8], .29)
    add([-8, 0], [8, 0], .29)
  } else {
    for (const [i, radius] of [2.79, 3.84, 4.61, 6.17].entries()) {
      arc(.09 * i, -.027 * i, radius, -.18 + i * .28, TAU - .50 + i * .17, 103, .33)
      arc(-.04 * i, .026 * i, radius + .048, 2.01, 4.73, 51, .25)
    }
    for (let i = 0; i < 46; i++) {
      const x = -6 + i * .249
      const z = -3.75 + .19 * Math.sin(i * .19)
      add([x - .18, z + .38], [x + .61, z - .41], .19)
      add([x - .03, -z - .62], [x + .38, -z + .14], .20)
    }
  }
  const positions = []
  const ink = []
  for (let i = 0; i < points.length; i += 5) {
    positions.push(points[i], .006, points[i + 1], points[i + 2], .006, points[i + 3])
    ink.push(points[i + 4], points[i + 4])
  }
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('stroke', new Float32BufferAttribute(ink, 1))
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ink: { value: palette.css.line }, reveal: { value: 0 }, opacity: { value: 1 } },
    vertexShader: `attribute float stroke; varying vec2 p; varying float vStroke;
      void main() { p=position.xz; vStroke=stroke; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 ink; uniform float reveal, opacity; varying vec2 p; varying float vStroke;
      void main() {
        float d = length(p * vec2(0.84,1.0));
        float f = 1.0 - smoothstep(2.0, 13.0, d);
        float s = 1.0 - smoothstep(reveal-2.4, reveal, d + sin(atan(p.y,p.x)*3.0)*.68);
        gl_FragColor = vec4(ink, vStroke * f * s * opacity);
        #include <colorspace_fragment>
      }`,
  })
  const lines = new LineSegments(geometry, material)
  lines.renderOrder = -5
  scene.add(lines)
  return material.uniforms
}

const shadowPlane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
function shadow(scene, shade) {
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { shade: { value: shade }, density: { value: 0 }, soft: { value: 2.9 } },
    vertexShader: fullscreen.replace('vec4(position.xy, 0.0, 1.0)', 'projectionMatrix * modelViewMatrix * vec4(position, 1.0)'),
    fragmentShader: `varying vec2 vUv; uniform vec3 shade; uniform float density, soft;
      void main() {
        float distance = length((vUv - .5) * 2.0);
        float fade = exp(-distance*distance*soft) * (1.0 - smoothstep(0.43, 1.0, distance));
        gl_FragColor = vec4(shade, fade * density);
        #include <colorspace_fragment>
      }`,
  })
  const decal = new Mesh(shadowPlane, material)
  scene.add(decal)
  decal.renderOrder = -2
  return decal
}

export class Stage {
  constructor(scene, finishes) {
    this.palette = finishes.current
    this.shade = new Color('#312013')
    this.draft = draftLayer(scene, this.palette)
    this.codex = draftLayer(scene, this.palette, true)
    this.platform = nodeAt(scene, [0, 0, -.095])
    const base = new Workshop(this.platform, finishes, 'stage')
    const flat = rotation([1, 0, 0], -Math.PI / 2)
    base.add('darkMetal', extrude(regular(6, 1.902, Math.PI / 6), .041, .012), transform([0, .017, 0], flat))
    base.add('metal', extrude(regular(6, 2.055, Math.PI / 6), .029, .013), transform([0, .034, 0], flat))
    base.add('plinth', extrude(regular(6, 2.125, Math.PI / 6), .084, .026), transform([0, .061, 0], flat))
    for (const [r, y, thickness, finish] of [[2.071, .174, .010, 'polish'], [1.963, .180, .0048, 'vein'], [1.362, .180, .0042, 'vein']]) {
      const points = regular(6, r, Math.PI / 6)
      for (const [i, [x, z]] of points.entries()) {
        const [nx, nz] = points[(i + 1) % 6]
        base.rod(finish, [x, y, z], [nx, y, nz], thickness, { sides: 5 })
      }
    }
    for (const [x, z] of [[-.36, 0], [.36, 0], [0, -.624], [0, .624], [-.73, -.624], [.73, -.624], [-.73, .624], [.73, .624]]) {
      const points = regular(6, .412)
      for (const [i, [a, b]] of points.entries()) {
        const [c, d] = points[(i + 1) % points.length]
        base.rod('vein', [x + a, .179, z + b], [x + c, .179, z + d], .0023, { sides: 4 })
      }
    }
    base.finish()
    this.pedestalShadow = shadow(scene, this.shade)
    this.pedestalShadow.position.set(0, .010, -.095)
    this.pedestalShadow.scale.set(3.03, 1, 2.85)
    this.ground = shadow(scene, this.shade)
    this.ground.position.y = .013
    this.contact = shadow(scene, this.shade)
    this.contact.position.y = plinthTop + .006
    this.feet = Array.from({ length: 6 }, () => {
      const foot = shadow(scene, this.shade)
      foot.scale.set(.178, 1, .193)
      foot.position.y = plinthTop + .009
      return foot
    })
    this.world = new Vector3()
  }

  update(intro, flight, root, legs, assembly, section, drawing) {
    const opacity = smooth(.55, 1.47, intro)
    const radius = 1 + 18 * smooth(.00, 1.6, intro)
    this.draft.reveal.value = radius
    this.codex.reveal.value = radius
    const { r, g, b } = this.palette.css.paper
    const lightness = r * .2126 + g * .7152 + b * .0722
    this.shade.set('#312013').multiplyScalar(mix(.24, 1, smooth(.04, .64, lightness)))
    this.draft.opacity.value = 1 - smooth(.45, 1, this.palette.vellum) * .43
    this.codex.opacity.value = smooth(.54, .99, this.palette.vellum)
    this.platform.scale.y = Math.max(.001, smooth(.43, 1.12, intro))
    this.platform.visible = intro > .43
    this.pedestalShadow.material.uniforms.density.value = opacity * .155
    const altitude = clamp((flight.position.y - restHeight) / 1.65)
    const readable = opacity * (1 - assembly * .80) * (1 - drawing * .45)
    this.ground.position.x = flight.position.x - .24 * altitude
    this.ground.position.z = flight.position.z - .34 * altitude
    this.ground.rotation.y = flight.yaw
    this.ground.scale.set(mix(1.94, 1.28, altitude), 1, mix(3.08, 2.06, altitude))
    this.ground.material.uniforms.density.value = readable * mix(.22, .105, altitude)
    this.ground.material.uniforms.soft.value = mix(3.5, 1.65, altitude)
    this.contact.position.x = flight.position.x
    this.contact.position.z = flight.position.z - .14
    this.contact.scale.set(1.38, 1, 1.86)
    this.contact.material.uniforms.density.value = readable * .30 * (1 - smooth(0, .54, altitude))
    for (const [i, foot] of this.feet.entries()) {
      this.world.copy(legs.legs[i].joints[9]).applyMatrix4(root.matrixWorld)
      foot.position.x = this.world.x
      foot.position.z = this.world.z
      const contact = 1 - smooth(.025, .16, Math.abs(this.world.y - plinthTop))
      foot.material.uniforms.density.value = readable * contact * .47 * (i < 3 ? 1 : 1 - section)
      foot.visible = contact * readable > .015
    }
  }
}
