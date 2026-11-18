// ─────────────────────────────────────────────────────────────────────────────
// core/dims.js — world layout shared by bee, stage and camera.
//
// UNITS   1 scene unit = 1 cm (so the 110 mm bee is 11 units long).
// AXES    +Y up, floor at y = 0. The resting bee faces +Z; its LEFT wing
//         points toward +X. "Front" camera therefore sits on +Z looking back.
// ─────────────────────────────────────────────────────────────────────────────
export const DIMS = Object.freeze({
  floorY: 0,

  // Landing plinth: a low hexagonal pedestal centred on the origin.
  plinthTopY: 1.6,          // height of its flat top face
  plinthRadius: 8.0,        // circumradius of the top hexagon (two vertices lie on ±X)

  // The bee, at rest on the plinth.
  beeRest: Object.freeze({ x: 0, y: 1.6 + 2.5, z: 0.5 }),   // thorax centre
  beeLength: 11.0,          // head front (z ≈ +3.6) … sting tip (z ≈ -7.4) relative to thorax centre
  beeSpan: 18.6,            // wingtip to wingtip, wings spread
  beeHeadOffset: Object.freeze({ x: 0, y: -0.15, z: 2.75 }), // head centre relative to thorax centre
  beeCentre: Object.freeze({ x: 0, y: 3.9, z: -1.4 }),       // visual centre of the resting bee (camera target)
  beeRadius: 7.5,           // bounding radius of the resting bee around beeCentre (wings folded)

  // Region the bee wanders in while flying (ellipsoid: centre + radii).
  flightCentre: Object.freeze({ x: 0, y: 11.5, z: 0 }),
  flightRadii: Object.freeze({ x: 13, y: 4.5, z: 9 }),

  cameraFov: 30,            // vertical FOV in degrees (telephoto, product-shot feel)
});
