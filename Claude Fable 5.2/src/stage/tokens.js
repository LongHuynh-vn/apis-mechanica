// ─────────────────────────────────────────────────────────────────────────────
// stage/tokens.js — the stage's own per-theme token table (art direction).
//
// One row per theme (PORCELAIN, DELFT, OBSIDIAN, CODEX), same keys in each.
// Wrapped in a TokenBlender by createStage(), so every value crossfades over
// the shared 800 ms theme clock. Colours are sRGB hex (lerped in linear).
// Line / backdrop colours themselves come from the shared PALETTE.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_TOKENS = [
  { // 0 · PORCELAIN & GILT — warm bone-white, faint warm lines
    codex: 0, dark: 0,
    lineAlpha: 0.7, gridAlpha: 0.55,
    poolColor: '#fbf8f2', poolAlpha: 0.55,
    shadowColor: '#5a4c3c', shadowBody: 0.6, shadowContact: 0.85, plinthAO: 0.30,
    plinthColor: '#f1ebe0', plinthRough: 0.42, plinthClearcoat: 0.55, plinthCCRough: 0.16, plinthEnv: 0.85, plinthSheen: 0.0,
    inlayColor: '#c99a3e', inlayRough: 0.24,
    keyColor: '#fff4e6', keyIntensity: 2.9, keyShadow: 0.72,
    rimColor: '#ffffff', rimIntensity: 1.4,
    hemiSky: '#fff9f0', hemiGround: '#d9ccb8', hemiIntensity: 0.18,
    envIntensity: 0.9,
    // procedural studio (environment map): a white paper sweep — darker ambient so the softboxes model the form
    stAmbTop: '#968670', stAmbHorizon: '#ddd2bf', stAmbGround: '#d6cdbd', stAmb: 0.2,
    stKey: 4.2, stKeyTint: '#fff3e2', stStrip: 9.0, stStripTint: '#ffffff',
    stTop: 0.55, stFill: 0.8, stFillTint: '#fff8ee', stFlag: 0.9,
    dustAlpha: 0.10, dustColor: '#fffdf8',
  },
  { // 1 · DELFT — pale cool grey, cool blue-grey lines
    codex: 0, dark: 0,
    lineAlpha: 0.72, gridAlpha: 0.6,
    poolColor: '#f6f9fb', poolAlpha: 0.5,
    shadowColor: '#3f4e60', shadowBody: 0.58, shadowContact: 0.85, plinthAO: 0.28,
    plinthColor: '#d9dee2', plinthRough: 0.62, plinthClearcoat: 0.18, plinthCCRough: 0.3, plinthEnv: 0.8, plinthSheen: 0.0,
    inlayColor: '#a9b3bf', inlayRough: 0.2,
    keyColor: '#f3f6ff', keyIntensity: 2.9, keyShadow: 0.7,
    rimColor: '#eef4ff', rimIntensity: 1.45,
    hemiSky: '#f3f7fb', hemiGround: '#c5cdd6', hemiIntensity: 0.2,
    envIntensity: 0.9,
    stAmbTop: '#7f8791', stAmbHorizon: '#d3d9df', stAmbGround: '#cfd5db', stAmb: 0.2,
    stKey: 4.2, stKeyTint: '#f2f6ff', stStrip: 9.0, stStripTint: '#f4f8ff',
    stTop: 0.6, stFill: 0.8, stFillTint: '#eef3ff', stFlag: 0.9,
    dustAlpha: 0.09, dustColor: '#f8fbff',
  },
  { // 2 · OBSIDIAN & AMBER — near-black, brass lines, low key, strong rim
    codex: 0, dark: 1,
    lineAlpha: 0.5, gridAlpha: 0.26,
    poolColor: '#2a2016', poolAlpha: 0.75,
    shadowColor: '#000000', shadowBody: 0.75, shadowContact: 0.92, plinthAO: 0.55,
    plinthColor: '#0c0a08', plinthRough: 0.3, plinthClearcoat: 1.0, plinthCCRough: 0.07, plinthEnv: 0.55, plinthSheen: 0.0,
    inlayColor: '#c08f45', inlayRough: 0.22,
    keyColor: '#fff0dc', keyIntensity: 1.1, keyShadow: 0.85,
    rimColor: '#ffd49a', rimIntensity: 2.6,
    hemiSky: '#3b3122', hemiGround: '#0a0806', hemiIntensity: 0.1,
    envIntensity: 0.55,
    // near-black, neutral studio: lacquer only shows crisp softbox shapes (no warm ambient sheen → no bronze drift)
    stAmbTop: '#0a0a0a', stAmbHorizon: '#1a1612', stAmbGround: '#14110d', stAmb: 0.15,
    stKey: 6.0, stKeyTint: '#fff6ea', stStrip: 12.0, stStripTint: '#fff1dc',
    stTop: 0.35, stFill: 0.0, stFillTint: '#ffcf8a', stFlag: 1.0,
    dustAlpha: 0.32, dustColor: '#ffc982',
  },
  { // 3 · CODEX — Leonardo vellum, hand-inked sepia
    codex: 1, dark: 0,
    lineAlpha: 0.78, gridAlpha: 0.22,
    poolColor: '#f1e4c3', poolAlpha: 0.42,
    shadowColor: '#4a3219', shadowBody: 0.58, shadowContact: 0.85, plinthAO: 0.30,
    plinthColor: '#d9c7a0', plinthRough: 0.86, plinthClearcoat: 0.0, plinthCCRough: 0.5, plinthEnv: 0.65, plinthSheen: 0.25,
    inlayColor: '#8a6a3a', inlayRough: 0.34,
    keyColor: '#fff0d2', keyIntensity: 2.7, keyShadow: 0.7,
    rimColor: '#fff1d6', rimIntensity: 0.95,
    hemiSky: '#f3e6c6', hemiGround: '#bba274', hemiIntensity: 0.26,
    envIntensity: 0.72,
    stAmbTop: '#8a7c62', stAmbHorizon: '#e0d0aa', stAmbGround: '#e8d9b6', stAmb: 0.24,
    stKey: 3.0, stKeyTint: '#ffefd0', stStrip: 4.5, stStripTint: '#fff4de',
    stTop: 0.55, stFill: 0.9, stFillTint: '#fff0d4', stFlag: 0.85,
    dustAlpha: 0.12, dustColor: '#fff6e0',
  },
];
