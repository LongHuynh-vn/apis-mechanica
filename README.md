# Apis Mechanica

A Three.js exhibit of an articulated mechanical honeybee. The geometry, wing venation, Delft florals, and drafting plate are generated in the browser.

[Open the live exhibit](https://longhuynh-vn.github.io/apis-mechanica/)

The GPT-6.2 Astra edition has its own [live exhibit](https://longhuynh-vn.github.io/apis-mechanica/GPT-6.2%20Astra/) and [source folder](./GPT-6.2%20Astra/).

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Run `npm run build` to generate the static site in `dist/` or `npm run preview` to serve that build locally.

- Press **F** to take flight or land. Lower **Tempo** to see the individual wing strokes, pitch reversals, and wingtip paths.
- Press **E** or scrub **Assembled / Exploded**. Hover a part to read its specification and click to frame it. Click open space or press **Esc** to return.
- Press **R** for the physical, sectioned, or schematic render. Press **1–5** for camera presets and **T** for finishes.
- Drag to orbit, right-drag to pan, and scroll to zoom. Press **Space** to pause and **H** to hide the interface for recording. Double-tap the stage to restore the interface on touch screens.

The exhibit uses a nominal 186 mm span at full extension, a 113 mm body length, and a 64 g design mass. The 230 Hz, 90° hover calibration comes from measured honeybee kinematics. The flight controller uses a reduced-order simulation. [Honeybee flight kinematics](https://pubmed.ncbi.nlm.nih.gov/16330767/)

The wing frames follow the primary venation and cell layout of the worker honeybee. Each hindwing carries 21 hooks, within the observed range of 20–22. [Forewing venation study](https://iris.unito.it/handle/2318/1507231), [Wing coupling study](https://pmc.ncbi.nlm.nih.gov/articles/PMC8373159/)

The project is available under the [MIT License](LICENSE). Bundled fonts and Three.js carry their own [license notices](public/licenses/).
