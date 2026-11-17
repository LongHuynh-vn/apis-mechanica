import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './style.css'

import { DirectionalLight, Group, HemisphereLight, Plane, Raycaster, Scene, Vector2, Vector3 } from 'three'
import { clamp, damp, mix, smooth, TAU } from './math.js'
import { FlightController, plinthTop } from './flight.js'
import { Interface } from './interface.js'
import { BodyRig } from './specimen/body.js'
import { Assembly } from './specimen/explode.js'
import { HeadRig } from './specimen/head.js'
import { LegsRig } from './specimen/legs.js'
import { parts } from './specimen/parts.js'
import { WingRig } from './specimen/wings.js'
import { Annotations } from './studio/annotations.js'
import { CameraRig } from './studio/camera.js'
import { makeRenderer, Stage } from './studio/stage.js'
import { Finishes, themes } from './studio/themes.js'

const exhibit = document.getElementById('exhibit')
const stage = document.getElementById('stage')
const errorMessage = document.getElementById('renderer-error')

function startExhibit() {
  const scene = new Scene()
  const finish = new Finishes(exhibit.style)
  const assembly = new Assembly(scene)
  const flight = new FlightController()
  const camera = new CameraRig(innerWidth, innerHeight)
  const { renderer, composer, grading } = makeRenderer(stage, scene, camera.camera, finish)
  const floor = new Stage(scene, finish)
  const specimen = new Group()
  specimen.rotation.order = 'YXZ'
  scene.add(specimen)
  const torso = new BodyRig(specimen, finish, assembly)
  const head = new HeadRig(specimen, finish, assembly)
  const wings = new WingRig(specimen, finish, assembly)
  const legs = new LegsRig(specimen, finish, assembly, plinthTop)

  const key = new DirectionalLight(0xffefda, 2.4)
  key.position.set(-4, 8, 5)
  const fill = new HemisphereLight(0xe5ecff, 0x8b644a, .54)
  const rim = new DirectionalLight(0xeaf0ff, 1.56)
  rim.position.set(-5, 5.4, -6)
  const bounce = new DirectionalLight(0xf9deb4, .62)
  bounce.position.set(6, 2.4, 4.8)
  scene.add(key, rim, fill, bounce)

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  let intro = reducedMotion ? 4 : 0
  let exploded = 0
  let assemblyTarget = 0
  let updatingAssemblySlider = false
  let currentAssembly = 0
  let tempo = 1
  let tempoTarget = 1
  let renderMode = 0
  let ready = false
  let paused = false
  let hidden = false
  let extended = false
  let hover = null
  let labelHover = null
  let focused = null
  let pointerActive = false
  let pointerMoved = -10
  let lastTap = null
  let pickDelay = 0
  let blur = 0
  let lost = false
  const rendering = { section: 0, drawing: 0 }
  const gaze = new Vector2()
  const pointer = new Vector2()
  const world = new Vector3()
  const normal = new Vector3()
  const separation = new Vector3()
  const screen = new Vector3()
  const aimPlane = new Plane()
  const section = new Plane()
  const ray = new Raycaster()
  const drag = new Map()
  let quality = 1
  let pixelRatio = 1
  let frameAverage = 1 / 60
  let sampleCount = 0
  let perfElapsed = 0

  const updateUi = new Interface(exhibit, {
    flight: () => {
      if (!ready) return
      flight.toggle()
      if (paused) paused = false
    },
    assembly: (value) => setAssembly(value, false),
    explode: () => setAssembly(assemblyTarget > .5 ? 0 : 1, true),
    tempo: (value) => { tempoTarget = value },
    view: changeView,
    render: changeRender,
    theme: changeTheme,
    nextTheme: () => changeTheme((finish.index + 1) % themes.length),
    nextRender: () => changeRender((renderMode + 1) % 3),
    orbit: () => {
      camera.orbit = !camera.orbit
      updateUi.nodes['orbit-toggle'].setAttribute('aria-pressed', String(camera.orbit))
    },
    pause: () => { if (ready) paused = !paused },
    hide: toggleUI,
    feed: () => {
      extended = !extended
      updateUi.feed(extended)
      if (extended && focused !== 'proboscis') select('proboscis')
    },
    escape: () => hidden ? toggleUI() : select(null),
  })

  const annotations = new Annotations(document.getElementById('annotations'), document.getElementById('part-labels'),
    assembly, camera.camera, finish, { hover: (part) => { labelHover = part }, select })
  const raycastTargets = []
  specimen.traverse((mesh) => { if (mesh.isMesh && parts[mesh.userData.part]) raycastTargets.push(mesh) })

  function toggleUI() {
    if (!ready) return
    hidden = !hidden
    if (hidden) hover = labelHover = null
    updateUi.hide(hidden)
  }

  function setAssembly(value, animateSlider) {
    if (!ready) return
    if (value > .18 && focused) select(null)
    if (value > .27 && camera.view === 4) changeView(0)
    updatingAssemblySlider = animateSlider
    assemblyTarget = value
  }

  function changeRender(value) {
    renderMode = value
    updateUi.select('render', value)
  }

  function changeTheme(value) {
    finish.change(value)
    updateUi.select('theme', value)
    document.querySelector('meta[name="theme-color"]').content = '#' + themes[value].css.paper.getHexString()
  }

  function changeView(value) {
    focused = null
    camera.setView(value)
    updateUi.select('view', value)
  }

  function select(id, chosen) {
    focused = id
    camera.frame(id ? annotations.anchor(id, chosen) : null)
    if (!id) labelHover = null
  }

  function size() {
    const { clientWidth: width, clientHeight: height } = exhibit
    const budget = Math.sqrt(2_560_000 / (width * height))
    pixelRatio = Math.min(2, devicePixelRatio, Math.max(1, budget)) * quality
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    composer.setPixelRatio(pixelRatio)
    composer.setSize(width, height)
    camera.resize(width, height)
    annotations.resize(width, height)
  }

  function setPointer(e) {
    const rect = stage.getBoundingClientRect()
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2)
  }

  function intersection() {
    ray.setFromCamera(pointer, camera.camera)
    const hits = ray.intersectObjects(raycastTargets, false)
    return hits.find((hit) => hit.object.visible && hit.object.material.opacity > .11 &&
      (rendering.section < .38 || section.distanceToPoint(hit.point) > 0))
  }

  function pickAnchor(id, position) {
    return assembly.anchors.get(id)?.reduce((best, candidate) => {
      const distance = world.copy(candidate.point).applyMatrix4(candidate.node.matrixWorld).distanceToSquared(position)
      return !best || distance < best.distance ? { candidate, distance } : best
    }, null)?.candidate
  }

  stage.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'touch') pointerActive = true
    setPointer(e)
  })
  stage.addEventListener('pointerleave', () => {
    pointerActive = false
    hover = null
  })
  stage.addEventListener('pointerdown', (e) => {
    if (!ready || ![0, 1, 2].includes(e.button)) return
    stage.setPointerCapture(e.pointerId)
    drag.set(e.pointerId, { x: e.clientX, y: e.clientY, travel: 0, pan: e.button !== 0, click: e.button === 0 })
    if (drag.size > 1) for (const state of drag.values()) state.travel = 8
    setPointer(e)
  })
  stage.addEventListener('pointermove', (e) => {
    setPointer(e)
    pointerMoved = performance.now() / 1000
    if (e.pointerType !== 'touch') pointerActive = true
    if (!drag.has(e.pointerId)) return
    const state = drag.get(e.pointerId)
    const dx = e.clientX - state.x
    const dy = e.clientY - state.y
    if (drag.size === 2) {
      const other = [...drag.entries()].find(([id]) => id !== e.pointerId)[1]
      const before = Math.hypot(state.x - other.x, state.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      if (before > 8 && after > 8) camera.zoom(Math.log(before / after) / .00115)
      camera.drag(dx * .5, dy * .5, true)
    } else camera.drag(dx, dy, state.pan || e.shiftKey)
    state.travel += Math.hypot(dx, dy)
    state.x = e.clientX
    state.y = e.clientY
    if (state.travel > 2) stage.classList.add('dragging')
    hover = null
  })
  function release(e, cancel) {
    const state = drag.get(e.pointerId)
    drag.delete(e.pointerId)
    if (!drag.size) stage.classList.remove('dragging')
    if (!state || cancel || state.travel > 5 || !state.click) return
    if (hidden) {
      if (e.pointerType === 'touch') {
        const time = performance.now()
        if (lastTap && time - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28) {
          lastTap = null
          toggleUI()
        } else lastTap = { time, x: e.clientX, y: e.clientY }
      }
      return
    }
    setPointer(e)
    const hit = intersection()
    const id = hit?.object.userData.part
    select(id ?? null, id ? pickAnchor(id, hit.point) : null)
  }
  stage.addEventListener('pointerup', (e) => release(e, false))
  stage.addEventListener('pointercancel', (e) => release(e, true))
  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1
    camera.zoom(e.deltaY * units)
  }, { passive: false })
  stage.addEventListener('dblclick', () => { if (hidden) toggleUI() })
  window.addEventListener('resize', size)
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lost = true
    errorMessage.textContent = 'WebGL was interrupted. Reload the exhibit to reopen the specimen.'
    errorMessage.hidden = false
  })

  function followPointer(dt, now) {
    const tracking = pointerActive && !drag.size && !hidden
    world.set(.18, .29, .43).applyMatrix4(head.head.matrixWorld)
    screen.copy(world).project(camera.camera)
    const px = pointer.x - screen.x
    const py = pointer.y - screen.y
    gaze.x = damp(gaze.x, tracking ? clamp(px * 1.56, -1, 1) : 0, 6.3, dt)
    gaze.y = damp(gaze.y, tracking ? clamp(py * 1.55, -1, 1) : 0, 6.3, dt)
    const dx = px * camera.camera.aspect
    const closeness = Math.hypot(dx, py)
    if (tracking && now - pointerMoved < .19 && closeness < .145 && !paused && !focused && currentAssembly < .17) {
      ray.setFromCamera(pointer, camera.camera)
      camera.camera.getWorldDirection(normal)
      aimPlane.setFromNormalAndCoplanarPoint(normal, world)
      const hit = ray.ray.intersectPlane(aimPlane, separation)
      if (hit) {
        separation.negate().add(world)
        if (separation.lengthSq() < .006) separation.set(.72, .37, -.21)
        flight.evade(separation, 1 - closeness / .145)
      }
    }
  }

  function stageLighting(time) {
    const p = finish.current
    key.color.copy(p.light)
    rim.color.copy(p.rim)
    fill.color.copy(p.rim)
    key.intensity = p.key
    key.position.x = -3.8 + .48 * Math.sin(time * .43)
    rim.intensity = 1.27 + .21 * Math.sin(time * .62 + .5)
    bounce.intensity = .43 + .07 * Math.sin(time * .55 + 1.4)
    scene.environmentIntensity = p.environment
    renderer.toneMappingExposure = p.exposure
    grading.dof.value = camera.dof
    grading.focus.value = camera.focusDistance
    grading.vellum.value = p.vellum
    grading.bloomMix.value = .10 * p.glow * (1 - rendering.drawing)
  }

  function adjustQuality(realDt) {
    if (!ready || realDt > .12 || document.hidden) return
    sampleCount++
    frameAverage = mix(frameAverage, Math.min(realDt, .06), .031)
    perfElapsed += realDt
    if (perfElapsed < 2.35 || sampleCount < 39) return
    if (frameAverage > .0205 && pixelRatio > .88 && quality > .69) {
      quality = Math.max(.68, quality * .88)
      size()
    }
    perfElapsed = 0
    sampleCount = 0
  }

  size()
  updateUi.spec(null, 0)
  let previous = 0
  function frame(now) {
    if (lost) return
    requestAnimationFrame(frame)
    const realDt = previous ? (now - previous) / 1000 : 1 / 60
    const dt = clamp(realDt, .0001, .10)
    previous = now
    intro = Math.min(4.65, intro + dt)
    const opening = smooth(.86, 3.79, intro)
    if (!ready && intro > 3.47) {
      ready = true
      updateUi.ready()
    }

    finish.step(dt)
    tempo = damp(tempo, tempoTarget, 11.6, dt)
    exploded = damp(exploded, assemblyTarget, 9.2, dt)
    currentAssembly = mix(1, exploded, opening)
    if (updatingAssemblySlider) updateUi.setAssembly(exploded)
    if (Math.abs(exploded - assemblyTarget) < .0005) updatingAssemblySlider = false
    rendering.section = damp(rendering.section, renderMode === 1 ? 1 : 0, 9.6, dt)
    rendering.drawing = damp(rendering.drawing, renderMode === 2 ? 1 : 0, 9, dt)
    const simDt = flight.update(dt, tempo, paused)
    const windowPhase = flight.beat * TAU * tempo * Math.min(.032, Math.max(1 / 90, frameAverage))
    blur = damp(blur, smooth(.66, 3.90, windowPhase * flight.drive), 11, dt)
    const flightBlur = blur * flight.drive * (1 - currentAssembly)
    specimen.position.copy(flight.position)
    specimen.rotation.set(flight.pitch, flight.yaw, flight.bank, 'YXZ')
    specimen.visible = intro > .63
    const twitch = (smooth(3.82, 3.96, intro) - smooth(4.08, 4.38, intro)) * (1 + .25 * Math.sin(intro * 31))
    head.step(simDt, flight, gaze, extended, currentAssembly, twitch)
    torso.step(simDt, flight, currentAssembly, flightBlur)
    legs.step(simDt, flight, currentAssembly)
    wings.update(flight, { exploded: currentAssembly, drawing: rendering.drawing, windowPhase, blur })
    assembly.apply(currentAssembly)
    specimen.updateMatrixWorld(true)
    legs.updateInstances()
    camera.update(dt, flight, head.head, currentAssembly, opening)
    followPointer(dt, now / 1000)

    normal.set(-1, 0, 0).transformDirection(specimen.matrixWorld)
    world.set(.071, 0, 0).applyMatrix4(specimen.matrixWorld)
    section.setFromNormalAndCoplanarPoint(normal, world)
    finish.shared.apisPlane.value.set(normal.x, normal.y, normal.z, section.constant)
    pickDelay -= dt
    if (pickDelay < 0) {
      hover = ready && !hidden && pointerActive && !drag.size ? intersection()?.object.userData.part ?? null : null
      stage.classList.toggle('inspecting', Boolean(hover))
      pickDelay = .075
    }
    const active = labelHover ?? hover ?? focused
    const energy = .92 + .054 * Math.sin(flight.time * 4.1) + .025 * Math.sin(flight.time * 8.7 + 1.35) + .055 * flight.drive
    finish.updateSurface(dt, hidden ? null : active, rendering, energy, flightBlur, smooth(.66, 1.42, intro))
    assembly.drawGuides(ready ? smooth(.10, .70, currentAssembly) * .74 : 0, finish.current.css.line)
    floor.update(intro, flight, specimen, legs, currentAssembly, rendering.section, rendering.drawing)
    stageLighting(flight.time)
    renderer.info.reset()
    composer.render(dt)
    updateUi.update(dt, flight, paused, currentAssembly, finish)
    updateUi.spec(active, finish.index)
    annotations.update(dt, specimen, currentAssembly, rendering.drawing, active, ready, hidden, focused)
    adjustQuality(realDt)
  }

  if (import.meta.env.DEV) {
    window.__apis = {
      get snapshot() {
        return {
          ready, flight: flight.mode, paused, tempo, exploded: currentAssembly, view: camera.view, renderMode,
          theme: finish.index, position: flight.position.toArray(), fold: flight.fold, phase: flight.phase,
          stroke: flight.stroke, balance: flight.balance, drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles, pixelRatio, frameAverage, hidden, focused,
        }
      },
    }
  }
  requestAnimationFrame(frame)
}

try {
  startExhibit()
} catch (error) {
  console.error(error)
  errorMessage.textContent = 'The specimen could not be opened. Check that WebGL 2 is enabled in your browser.'
  errorMessage.hidden = false
}
