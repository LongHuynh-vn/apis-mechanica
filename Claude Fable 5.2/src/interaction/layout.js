// ─────────────────────────────────────────────────────────────────────────────
// interaction/layout.js — screen-space facts shared by the chrome, the labels
// and the camera rig (plain mutable object, no events).
//
//   layout.clear   { l, t, r, b }  CSS px — the stage area between the chrome
//                  blocks (written by ui.js on resize / font load)
//   layout.chrome  0..1            how present the chrome is (reveal × not hidden)
//   layout.bee     { l, t, r, b, valid }  projected extents of the machine's
//                  pickable parts this frame (written by input.js)
//   layout.vw, vh  viewport size the numbers above were measured in
// ─────────────────────────────────────────────────────────────────────────────
export const layout = {
  vw: 0, vh: 0,
  clear: null,
  chrome: 0,
  bee: { l: 0, t: 0, r: 0, b: 0, valid: false },
  head: { l: 0, t: 0, r: 0, b: 0, valid: false },   // same, head parts only (MACRO framing)
  labelW: 0,     // widest part label (px), written by labels.js — room the exploded framing must leave
  subject: 'bee',  // 'bee' | 'head' — what the camera is framing (MACRO tracks the head), written by the rig
  pad: 26,       // the chrome's outer margin (px), written by ui.js — labels align to it
};
