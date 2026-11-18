# Apis Mechanica

[Open the Claude Fable 5.2 exhibit](https://longhuynh-vn.github.io/apis-mechanica/Claude%20Fable%205.2/)

An interactive Three.js study of a mechanical honeybee in porcelain, enamel, precious metal and etched glass. Every part is generated in the browser: the airframe, the gear train, the wing venation, the fur, the Delft florals and the drafting plate. It assembles itself on load, flies under a small physics and control simulation, and comes apart into labelled components.

## Run it

```sh
npm ci
npm start
```

Open http://127.0.0.1:5179/. There is no bundler: the browser loads the ES modules as written, and three.js is resolved through the import map in `index.html`. `npm run build` copies the page, its modules and only the three.js files they import into `dist/`.

Add `?tour=1&ui=0` to the address to start the guided tour with the interface hidden, for recording.

## Controls

| Input | Action |
|---|---|
| Drag, scroll, right-drag | Orbit, zoom, pan |
| `F` | Take flight or land |
| `E` | Explode or reassemble |
| `T` | Next theme: Porcelain & Gilt, Delft, Obsidian & Amber, Codex |
| `R` | Next render mode: solid, section, schematic |
| `1`–`5` | Views: iso, plan, front, profile, macro |
| `Space` | Pause the bee (the camera keeps moving) |
| `D` | Guided tour |
| `H` | Hide the interface |
| `M`, `S`, `P`, `I` | Sound, save a still, extend the proboscis, replay the assembly |

Lower **Tempo** in flight to see the wing strokes: the motion-blur envelope collapses into the figure-eight stroke, with its pitch reversals and the wingtip trace. Hover a part to read its specification; click it to frame it.

## Layout

| Folder | Contents |
|---|---|
| `src/core` | State and events, theme crossfade, the shared rendering contract, maths |
| `src/bee` | Materials, geometry builders, anatomy, rig, flight controller, explode system, schematic plate, guided tour |
| `src/stage`, `src/post`, `src/textures` | Drafting floor, plinth, lighting and shadows; bloom, ink edges, depth of field; procedural Delft painting |
| `src/ui`, `src/interaction`, `src/data` | Interface, labels and sound; camera rig and input; part descriptions |
| `src/dev` | Test harness pages and audits for motion continuity, foot contact and wing clearance |

The headline figures are a 186 mm span, a 110 mm body, 64 g, a 230 Hz beat and a 90° stroke. The gear train is 42 → 14 and 30 → 12 teeth, a 1 : 7.5 step-up to the crank.
