// Dev-only: measures how far the wing membranes sit from the abdomen and thorax envelopes
// (negative = intersecting). Usage in the console:
//   const { clearance } = await import('/src/dev/clearance.js'); clearance(__apis)
import { abdRadius, ABD } from '../bee/abdomen.js';
import { THORAX } from '../bee/thorax.js';

const sag = (s) => -0.013 * s * s;

export function clearance(A) {
  const T = A.THREE, v = new T.Vector3(), res = {};
  const swing = A.bee.abdomen.swing; swing.updateWorldMatrix(true, false);
  const inv = new T.Matrix4().copy(swing.matrixWorld).invert();
  const bodyInv = new T.Matrix4().copy(A.bee.body.matrixWorld).invert();
  const n = 2 / THORAX.e;
  const membrane = (sideIdx, key) => A.bee.wings.sides[sideIdx][key].children.find((c) => c.isMesh && c.layers.mask === (1 << 3));
  for (const [name, sideIdx, key] of [['foreL', 0, 'blade'], ['foreR', 1, 'blade'], ['hindL', 0, 'hind'], ['hindR', 1, 'hind']]) {
    const mesh = membrane(sideIdx, key); mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    let minAbd = 9, minThx = 9, atAbd = null, atThx = null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const a = v.clone().applyMatrix4(inv), s = -a.z;
      if (s > 0.1 && s < 5.45) {
        const R = abdRadius(s) + 0.055;
        const c = (Math.hypot(a.x / (R * ABD.ex), (a.y - sag(s)) / (R * ABD.ey)) - 1) * R;
        if (c < minAbd) { minAbd = c; atAbd = [+a.x.toFixed(2), +a.y.toFixed(2), +s.toFixed(2)]; }
      }
      const b = v.clone().applyMatrix4(bodyInv);
      // scutellum cushion (centre 0,1.0,-1.2; radii .98,.5,.56) and the main superellipsoid
      const sc = (Math.hypot(b.x / 0.98, Math.max(0, b.y - 1.0) / 0.5, (b.z + 1.2) / 0.56) - 1) * 0.5;
      const q = Math.pow(Math.pow(Math.abs(b.x / THORAX.rx), n) + Math.pow(Math.abs(b.y / THORAX.ry), n) + Math.pow(Math.abs(b.z / THORAX.rz), n), 1 / n);
      const c2 = Math.min((q - 1) * 1.6, b.y > 1.0 ? sc : 9);
      if (c2 < minThx) { minThx = c2; atThx = [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)]; }
    }
    res[name] = { abd: +minAbd.toFixed(3), atAbd, thorax: +minThx.toFixed(3), atThx };
  }
  return res;
}
