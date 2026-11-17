import { CanvasTexture, Color, LineBasicMaterial, MeshPhysicalMaterial, SRGBColorSpace, Vector4 } from 'three'
import { ease, mix } from '../math.js'

const finishKeys = ['porcelain', 'enamel', 'metal', 'polish', 'darkMetal', 'vein', 'eyeBase', 'facet', 'jewel', 'glass', 'etch', 'amber', 'core', 'plinth']
const uiKeys = ['paper', 'light', 'edge', 'ink', 'muted', 'line', 'accent', 'button', 'on-button', 'console-fill']

function palette(name, ui, finishes, labels, studio, vellum = .36) {
  return {
    name,
    css: Object.fromEntries(uiKeys.map((token, i) => [token, new Color(ui[i])])),
    colors: Object.fromEntries(finishKeys.map((token, i) => [token, new Color(finishes[i])])),
    labels,
    light: new Color(studio[0]), rim: new Color(studio[1]),
    exposure: studio[2], environment: studio[3], key: studio[4], glow: studio[5], vellum,
  }
}

export const themes = [
  palette('Porcelain & Gilt',
    ['#f2ebdc', '#faf5ea', '#e5d6bc', '#34271b', '#6b5742', '#a48b6d', '#93622e', '#87562a', '#fff9ee', '#f8f0e2'],
    ['#fff3df', '#c9b797', '#c59656', '#eac17f', '#67462a', '#a47742', '#1f1b19', '#302821', '#bd8341', '#f8efdf', '#b49d83', '#9f4c1b', '#d27327', '#e7d8bf'],
    { body: 'Ivory porcelain', metal: '24k gilt', glass: 'Smoked optical glass', wing: 'Frosted glass' },
    ['#fff4e0', '#edf2ff', 1.055, .96, 1.88, .62]),
  palette('Delft',
    ['#e4e9ea', '#f6f7f3', '#c5d1d8', '#232f40', '#4d5e72', '#8094a6', '#345a8a', '#385c83', '#fafaff', '#eff2f2'],
    ['#edf2ee', '#b9c9d4', '#ad8955', '#d0b47e', '#554733', '#8c704b', '#102342', '#243d68', '#426691', '#e2edf7', '#788ba1', '#9a5027', '#c6783b', '#d5dee2'],
    { body: 'Cobalt-painted porcelain', metal: 'Antique brass', glass: 'Cobalt-glazed optical glass', wing: 'Frosted glass' },
    ['#e5edff', '#e7f0ff', 1.04, 1.06, 1.98, .48], .18),
  palette('Obsidian & Amber',
    ['#201814', '#33251b', '#100d0c', '#f1d9bd', '#caad8b', '#9c7651', '#e4b278', '#c2945b', '#25190e', '#281d17'],
    ['#292323', '#291f1a', '#b6824c', '#d9ad70', '#513928', '#ad8153', '#130f0e', '#25201b', '#ae6634', '#9a8878', '#ad8860', '#be5d26', '#ed7d2c', '#29201a'],
    { body: 'Black lacquered enamel', metal: 'Aged brass', glass: 'Black optical glass', wing: 'Smoked etched glass' },
    ['#ffdfb7', '#ffc88b', 1.01, .77, 1.7, 1.32], .60),
  palette('Codex',
    ['#e5d5b3', '#f3e7cd', '#c6aa7c', '#3d291a', '#695039', '#a58760', '#87572f', '#77502f', '#fbecd2', '#ebdbbd'],
    ['#e4cda6', '#bea17b', '#986942', '#b28a59', '#59412d', '#815936', '#392b20', '#514032', '#9b643a', '#ebd6ae', '#947450', '#a35930', '#c17a43', '#ceba95'],
    { body: 'Cream enamel', metal: 'Oxidized bronze', glass: 'Sepia optical glass', wing: 'Etched glass' },
    ['#ffdfb1', '#e4c3a0', .99, .87, 2.1, .43], 1.0),
]

const finishSettings = {
  porcelain: { metalness: .02, roughness: .29, clearcoat: .93, clearcoatRoughness: .19 },
  enamel: { metalness: .09, roughness: .32, clearcoat: .77, clearcoatRoughness: .23 },
  metal: { metalness: .91, roughness: .32 },
  polish: { metalness: .94, roughness: .215 },
  darkMetal: { metalness: .83, roughness: .385 },
  vein: { metalness: .66, roughness: .34, clearcoat: .32 },
  eyeBase: { metalness: .40, roughness: .24, clearcoat: .90, clearcoatRoughness: .125 },
  facet: { metalness: .30, roughness: .265, clearcoat: .85, clearcoatRoughness: .15 },
  jewel: { metalness: .32, roughness: .19, clearcoat: 1, clearcoatRoughness: .09 },
  glass: { metalness: .08, roughness: .30, clearcoat: .70, clearcoatRoughness: .23, iridescence: .30, iridescenceIOR: 1.29, iridescenceThicknessMinimum: 185, iridescenceThicknessMaximum: 275, transparent: true, depthWrite: false, side: 2, forceSinglePass: true, opacity: .43 },
  etch: { metalness: .04, roughness: .52, transparent: true, depthWrite: false, opacity: .31 },
  amber: { metalness: .21, roughness: .265, clearcoat: .65, clearcoatRoughness: .15 },
  core: { metalness: .18, roughness: .30, clearcoat: .55, clearcoatRoughness: .20 },
  plinth: { metalness: .25, roughness: .38, clearcoat: .35 },
  ghost: { metalness: .06, roughness: .40, iridescence: .18, iridescenceThicknessMinimum: 185, iridescenceThicknessMaximum: 275, side: 2, transparent: true, depthWrite: false, forceSinglePass: true },
}

function delftTransfer() {
  const canvas = document.createElement('canvas')
  canvas.width = 1536
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  function petal(x, y, angle, width, length, alpha) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    const pigment = ctx.createLinearGradient(0, 0, 0, -length)
    pigment.addColorStop(0, '#183e80')
    pigment.addColorStop(.44, '#35629e')
    pigment.addColorStop(1, '#7191bd')
    ctx.globalAlpha = alpha
    ctx.fillStyle = pigment
    ctx.strokeStyle = '#274c87'
    ctx.lineWidth = 2.1
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-width, -.38 * length, -width * .85, -.86 * length, 0, -length)
    ctx.bezierCurveTo(width * .78, -.83 * length, width, -.42 * length, 0, 0)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  for (let index = 0; index < 6; index++) {
    ctx.save()
    ctx.translate(index * 256 + 127, 188)
    if (index % 2) ctx.scale(-1, 1)
    ctx.strokeStyle = '#305791'
    ctx.lineWidth = 2.8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-107, 103)
    ctx.bezierCurveTo(-35, 96, 3, 50, 4, 0)
    ctx.moveTo(-80, 92)
    ctx.bezierCurveTo(-55, 49, -70, -24, -103, -3)
    ctx.moveTo(-20, 65)
    ctx.bezierCurveTo(43, 76, 98, 44, 110, -20)
    ctx.moveTo(34, 62)
    ctx.bezierCurveTo(39, 33, 75, 12, 82, 34)
    ctx.stroke()
    for (let j = 0; j < 5; j++) petal(4, -21, j * Math.PI * .4 + .16, 15, 56, .89)
    for (let j = 0; j < 3; j++) petal(108, -18, j * 1.25 - .73, 7.7, 28, .78)
    petal(-41, 82, -.83, 9, 40, .86)
    petal(-23, 70, 1.33, 9, 31, .82)
    petal(-73, 61, -.90, 9, 39, .83)
    petal(59, 61, 1.07, 8, 36, .84)
    petal(79, 49, .26, 8, 29, .78)
    ctx.fillStyle = '#254d89'
    ctx.beginPath()
    ctx.arc(4, -21, 7.4, 0, Math.PI * 2)
    ctx.fill()
    for (const [x, y] of [[-89, -52], [-98, -66], [-75, -63], [73, -51], [62, -63], [79, -68]]) {
      ctx.beginPath()
      ctx.arc(x, y, 2.7, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  ctx.strokeStyle = '#315b96a0'
  for (const y of [20, 26, 348, 354]) {
    ctx.lineWidth = y % 4 ? 2 : 3
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const vertexPatch = `
  vec4 apisP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    apisP = instanceMatrix * apisP;
  #endif
  apisWorld = (modelMatrix * apisP).xyz;`

export class Finishes {
  constructor(style) {
    this.style = style
    this.index = 0
    this.elapsed = .8
    this.current = structuredPalette(themes[0])
    this.start = structuredPalette(themes[0])
    this.cache = new Map()
    this.delft = delftTransfer()
    this.shared = {
      apisPlane: { value: new Vector4() },
      apisSection: { value: 0 },
      apisDrawing: { value: 0 },
      apisVisibility: { value: 1 },
      apisDelft: { value: 0 },
      apisInk: { value: new Color() },
      apisBackground: { value: new Color() },
      apisGilt: { value: new Color() },
    }
    this.ink = new LineBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 })
    this.writePalette()
  }

  material(part, finish) {
    const key = `${part}:${finish}`
    if (this.cache.has(key)) return this.cache.get(key).material
    const properties = { ...finishSettings[finish] }
    const colorKey = finish === 'ghost' ? 'glass' : finish
    const wing = ['forewings', 'hindwings', 'hamuli'].includes(part)
    const ghost = finish === 'ghost'
    if (wing) {
      properties.transparent = true
      properties.depthWrite = false
    }
    const material = new MeshPhysicalMaterial({ color: this.current.colors[colorKey], ...properties })
    const stage = part === 'stage'
    const painted = !stage && finish === 'porcelain' && (part === 'tergites' || part === 'plates')
    const glowing = finish === 'core' || finish === 'amber'
    const glass = finish === 'glass' || finish === 'ghost'
    const dim = { value: 1 }
    const rim = { value: 0 }
    const flat = { value: new Color() }
    if (painted) material.map = this.delft
    material.customProgramCacheKey = () => `apis-${painted}-${stage}-${glowing}-${glass}-${ghost}`
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shared, { apisDim: dim, apisRim: rim, apisFlat: flat })
      shader.vertexShader = 'varying vec3 apisWorld;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + vertexPatch)
      shader.fragmentShader = `
        varying vec3 apisWorld;
        uniform vec4 apisPlane;
        uniform vec3 apisInk, apisBackground, apisGilt, apisFlat;
        uniform float apisSection, apisDrawing, apisDim, apisRim, apisDelft, apisVisibility;
      ` + shader.fragmentShader
      if (ghost) {
        shader.vertexShader = 'attribute float sampleAlpha; varying float vSampleAlpha;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSampleAlpha = sampleAlpha;')
        shader.fragmentShader = 'varying float vSampleAlpha;\n' + shader.fragmentShader
        shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vSampleAlpha;\n#include <alphatest_fragment>')
      }
      if (!stage) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
          #include <clipping_planes_fragment>
          float cut = dot(apisWorld, apisPlane.xyz) + apisPlane.w;
          if (apisVisibility < 1.0 || (cut < 0.0 && apisSection > 0.0)) {
            vec2 pixel = mod(floor(gl_FragCoord.xy), 4.0);
            float stipple = (mod(pixel.x + 2.0 * pixel.y, 4.0) * 4.0 + mod(2.0 * pixel.x + pixel.y, 4.0) + 0.5) / 16.0;
            if (stipple > apisVisibility || (cut < 0.0 && stipple < apisSection)) discard;
          }
        `)
      }
      if (painted) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          vec4 pigment = texture2D(map, vMapUv);
          diffuseColor.rgb *= mix(vec3(1.0), pigment.rgb, apisDelft * pigment.a);
        `)
      }
      if (!stage) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float face = abs(dot(normal, normalize(vViewPosition)));
          float inkLine = 1.0 - smoothstep(0.065, 0.20, face);
          vec3 drawing = mix(apisFlat, apisInk, inkLine * ${glass ? '.42' : '.90'});
          outgoingLight = mix(outgoingLight, drawing, apisDrawing);
          float edge = (1.0 - smoothstep(0.01, 0.049, abs(cut))) * apisSection;
          float hatch = step(0.64, fract((apisWorld.y + apisWorld.z * 0.64) * 27.0));
          outgoingLight = mix(outgoingLight, apisGilt * (1.10 - hatch * 0.57), edge * 0.84);
          outgoingLight = mix(apisBackground, outgoingLight, apisDim);
          float highlight = (1.0 - smoothstep(0.025, 0.23, face)) * apisRim;
          outgoingLight = mix(outgoingLight, apisGilt * 1.45, highlight * 0.79);
          ${glass ? 'diffuseColor.a = mix(diffuseColor.a, diffuseColor.a * 0.69, apisDrawing);' : ''}
          #include <opaque_fragment>
        `)
      } else {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight = mix(outgoingLight, apisFlat, apisDrawing * 0.89);\n#include <opaque_fragment>')
      }
      if (!glowing) {
        // Reserve the HDR bloom range for visible reactor surfaces only.
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight *= min(1.0, 1.28 / max(1e-4, max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b))));\n#include <opaque_fragment>')
      }
    }
    const record = { part, finish, material, dim, rim, flat, colorKey, wing, alpha: material.opacity }
    this.cache.set(key, record)
    this.writeMaterial(record)
    return material
  }

  change(index) {
    if (index === this.index) return
    this.index = index
    this.start = structuredPalette(this.current)
    this.elapsed = 0
  }

  step(dt) {
    if (this.elapsed >= .8) return
    this.elapsed = Math.min(.8, this.elapsed + dt)
    const t = ease(this.elapsed / .8)
    const end = themes[this.index]
    for (const key of uiKeys) this.current.css[key].copy(this.start.css[key]).lerp(end.css[key], t)
    for (const key of finishKeys) this.current.colors[key].copy(this.start.colors[key]).lerp(end.colors[key], t)
    for (const key of ['light', 'rim']) this.current[key].copy(this.start[key]).lerp(end[key], t)
    for (const key of ['exposure', 'environment', 'key', 'glow', 'vellum']) this.current[key] = mix(this.start[key], end[key], t)
    this.current.delft = mix(this.start.delft, this.index === 1 ? 1 : 0, t)
    this.writePalette()
  }

  writePalette() {
    for (const key of uiKeys) this.style.setProperty('--' + key, '#' + this.current.css[key].getHexString())
    this.style.setProperty('--vellum', this.current.vellum.toFixed(2))
    this.shared.apisBackground.value.copy(this.current.css.paper)
    this.shared.apisInk.value.copy(this.current.css.ink)
    this.shared.apisGilt.value.copy(this.current.colors.polish)
    this.shared.apisDelft.value = this.current.delft
    this.ink.color.copy(this.current.css.ink)
    for (const record of this.cache.values()) this.writeMaterial(record)
  }

  writeMaterial({ material, colorKey, finish, flat }) {
    material.color.copy(this.current.colors[colorKey])
    const dark = ['darkMetal', 'eyeBase', 'facet', 'etch', 'vein'].includes(finish)
    const bright = finish === 'porcelain' || finish === 'enamel' || finish === 'glass'
    flat.value.copy(this.current.css.light).lerp(this.current.css.ink, dark ? .84 : bright ? .052 : finish === 'plinth' ? .16 : .42)
    if (finish === 'amber' || finish === 'core') material.emissive.copy(this.current.colors[finish])
  }

  updateSurface(dt, hovered, rendering, pulse, blur, visibility) {
    this.ink.opacity = rendering.drawing * .60 * (hovered ? .5 : 1)
    this.ink.visible = this.ink.opacity > .01
    this.shared.apisDrawing.value = rendering.drawing
    this.shared.apisSection.value = rendering.section
    this.shared.apisVisibility.value = visibility
    const alpha = 1 - Math.exp(-dt * 11)
    for (const { part, finish, dim, rim, material, wing, alpha: opacity } of this.cache.values()) {
      if (part === 'stage') continue
      if (wing) material.opacity = opacity * mix(1, finish === 'glass' ? .23 : .15, blur)
      dim.value = mix(dim.value, hovered && hovered !== part && finish !== 'ghost' ? .30 : 1, alpha)
      rim.value = mix(rim.value, hovered === part ? 1 : 0, alpha)
      if (finish === 'amber' || finish === 'core') {
        // Warm energy fluctuates independently of mechanical phase.
        const strength = (finish === 'core' ? 3.95 : 2.85) * this.current.glow
        material.emissiveIntensity = strength * pulse * (1 - rendering.drawing * .97)
      }
    }
  }
}

function structuredPalette(p) {
  return {
    ...p, delft: p.delft ?? 0,
    light: p.light.clone(),
    rim: p.rim.clone(),
    css: Object.fromEntries(Object.entries(p.css).map(([id, color]) => [id, color.clone()])),
    colors: Object.fromEntries(Object.entries(p.colors).map(([id, color]) => [id, color.clone()])),
  }
}

export function materialDescription(part, theme) {
  const { body, metal, glass, wing } = themes[theme].labels
  return {
    bodyMetal: `${body} · ${metal}`, metal, optical: `${glass} · ${metal}`,
    wing: `${wing} · ${metal}`, ember: 'Amber glass ·  Gilded cage',
  }[part.material]
}
