import * as T from 'three';
import { vec, Batch, group, TAU, random, smooth } from './geometry.js';

export const PLINTH_TOP = 0.142;
const size = 1536,
  extent = 18;
function drafting(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  const rng = random(839);
  const line = (x, y, xx, yy) => {
    g.moveTo(x, y);
    g.lineTo(xx, yy);
  };
  const path = (fn, a, w = 1) => {
    g.beginPath();
    fn();
    g.strokeStyle = 'rgba(255,255,255,' + a + ')';
    g.lineWidth = w;
    g.stroke();
  };
  const unit = size / extent;
  const rad = 33;
  for (let j = -15; j <= 15; j++)
    for (let i = -15; i <= 15; i++) {
      const x = (i + (Math.abs(j) % 2) * 0.5) * Math.sqrt(3) * rad,
        y = j * 1.5 * rad,
        d = Math.hypot(x, y * 0.98);
      const alpha = Math.max(0, 1 - d / 685) * 0.26;
      if (!alpha) continue;
      path(
        () => {
          for (let k = 0; k < 4; k++) {
            const a = -Math.PI / 2 + (k * TAU) / 6,
              px = x + Math.cos(a) * rad,
              py = y + Math.sin(a) * rad;
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
        },
        alpha,
        0.83
      );
    }
  for (const [r, start, end, a, w] of [
    [3.21, 0, TAU, 0.59, 1.05],
    [3.28, 0.25, 3.88, 0.38, 0.85],
    [3.48, -1.91, 1.77, 0.48, 0.85],
    [3.52, -1.91, 0.37, 0.3, 0.85],
    [4.0, 2.72, 4.6, 0.22, 0.8],
    [4.43, -0.86, 0.78, 0.28, 1],
  ]) {
    path(() => g.arc(0, 0, r * unit, start, end), a, w);
  }
  for (let i = 0; i < 240; i++) {
    const a = (i * TAU) / 240,
      major = i % 10 === 0;
    const r0 = 3.215 * unit,
      r1 = r0 + (major ? 9 : i % 2 === 0 ? 4.8 : 2.8);
    path(
      () => line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1),
      major ? 0.65 : 0.48,
      major ? 1.1 : 0.78
    );
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    g.save();
    g.translate(Math.cos(a) * 3.54 * unit, Math.sin(a) * 3.54 * unit);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = 'rgba(255,255,255,.60)';
    g.font = '8px monospace';
    g.textAlign = 'center';
    g.fillText(String(i * 30).padStart(3, '0') + '°', 0, 0);
    g.restore();
  }
  g.setLineDash([8, 6, 2, 6]);
  path(
    () => {
      line(-5.55 * unit, 0, 5.55 * unit, 0);
      line(0, -4.72 * unit, 0, 4.72 * unit);
    },
    0.39,
    0.8
  );
  g.setLineDash([]);
  for (let i = -4; i <= 4; i++)
    for (let j = -3; j <= 3; j++) {
      if ((i + j) % 2 !== 0 || Math.hypot(i, j) < 1.4) continue;
      const x = i * unit * 1.35,
        y = j * unit * 1.31;
      path(
        () => {
          line(x - 5, y, x + 5, y);
          line(x, y - 5, x, y + 5);
        },
        0.43,
        0.8
      );
    }
  if (kind === 'codex') {
    for (let i = 0; i < 125; i++) {
      const a = rng() * TAU,
        r = (3.2 + rng() * 0.24) * unit,
        x = r * Math.cos(a),
        y = r * Math.sin(a);
      path(() => line(x - 2, y + 2, x + 3 + rng() * 4, y - 3), 0.5, 0.9);
    }
    for (let i = 0; i < 5; i++) {
      const r = (2.95 + i * 0.29) * unit;
      path(() => g.ellipse(2 - i, 1 + i, r, r * 0.993, 0.018, 0, TAU), 0.18, 0.95);
    }
  }
  const t = new T.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx = c.getContext('2d'),
    g = ctx.createRadialGradient(96, 96, 1, 96, 96, 95);
  for (const [u, a] of [
    [0, 1],
    [0.27, 0.81],
    [0.52, 0.45],
    [0.73, 0.16],
    [1, 0],
  ])
    g.addColorStop(u, 'rgba(255,255,255,' + a + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 192, 192);
  return new T.CanvasTexture(c);
}
function decal(scene, texture, color, opacity, y, w, d) {
  const material = new T.MeshPhysicalMaterial({
    map: texture,
    color,
    metalness: 0,
    roughness: 1,
    transparent: true,
    opacity,
    depthWrite: false,
    side: T.FrontSide,
  });
  // Printed ink and contact shadows have constant reflectance on the seamless paper.
  material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight=diffuseColor.rgb;\n#include <opaque_fragment>'
    );
  };
  material.customProgramCacheKey = () => 'printed-plate';
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(w, d, 1);
  mesh.position.y = y;
  scene.add(mesh);
  return mesh;
}
function hexShape(r, round) {
  const vs = Array.from(
    { length: 6 },
    (_, i) => new T.Vector2(Math.cos((i * TAU) / 6) * r, Math.sin((i * TAU) / 6) * r)
  );
  const shape = new T.Shape();
  for (let i = 0; i < 6; i++) {
    const v = vs[i],
      a = v.clone().lerp(vs[(i + 5) % 6], round),
      b = v.clone().lerp(vs[(i + 1) % 6], round);
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(v.x, v.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}
function hexGeometry(r, depth, bevel) {
  const g = new T.ExtrudeGeometry(hexShape(r, 0.04), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 5,
  });
  g.rotateX(-Math.PI / 2);
  g.scale(1, 1, 0.77);
  return g;
}
function printedPlinth() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  g.translate(512, 256);
  g.strokeStyle = 'rgba(255,255,255,.52)';
  g.lineWidth = 1.3;
  for (const scale of [1, 0.98]) {
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i * TAU) / 6,
        x = Math.cos(a) * 482 * scale,
        y = Math.sin(a) * 281 * scale;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,.87)';
  g.font = '12px monospace';
  g.textAlign = 'center';
  g.fillText('A. M E L L I F E R A     /     N° 0 8', 4, 214);
  g.beginPath();
  g.moveTo(-154, 210);
  g.lineTo(-125, 210);
  g.moveTo(133, 210);
  g.lineTo(162, 210);
  g.stroke();
  return new T.CanvasTexture(c);
}
export class Stage {
  constructor(scene, materials, bee) {
    this.materials = materials;
    this.grid = decal(
      scene,
      drafting('plate'),
      materials.colors.lines,
      0.43,
      -0.162,
      extent,
      extent
    );
    this.grid.renderOrder = -8;
    this.inkGrid = decal(
      scene,
      drafting('codex'),
      materials.colors.lines,
      0,
      -0.161,
      extent,
      extent
    );
    this.inkGrid.renderOrder = -7;
    this.inkProgress = { value: 0 };
    for (const sheet of [this.grid, this.inkGrid]) {
      const ink = sheet.material,
        setup = ink.onBeforeCompile;
      ink.customProgramCacheKey = () => 'drafting-ink';
      ink.onBeforeCompile = (sh) => {
        setup(sh);
        sh.uniforms.uInkProgress = this.inkProgress;
        sh.fragmentShader =
          'uniform float uInkProgress;\n' +
          sh.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
        vec2 paperPoint=vMapUv-.5;float r=length(paperPoint)+.064*(atan(paperPoint.y,paperPoint.x)/6.283185+.5);
        diffuseColor.a*=1.-smoothstep(uInkProgress*.85-.045,uInkProgress*.85,r);`
          );
      };
    }
    const tex = shadowTexture();
    this.plinthShadow = decal(scene, tex, 0x4d4231, 0.33, -0.154, 6.41, 3.99);
    this.plinthShadow.position.set(0.26, -0.154, 0.13);
    this.plinthShadow.renderOrder = -6;
    const base = group(scene, 0.11, 0, 0),
      b = new Batch(base, materials, 'stage');
    b.add('bronze', hexGeometry(2.59, 0.047, 0.018), vec(0, -0.114, 0));
    b.add('base', hexGeometry(2.66, 0.18, 0.031), vec(0, -0.087, 0));
    b.add('baseEdge', hexGeometry(2.692, 0.014, 0.006), vec(0, -0.056, 0));
    b.add('base', hexGeometry(2.645, 0.018, 0.018), vec(0, 0.106, 0));
    for (const mesh of b.finish()) mesh.receiveShadow = true;
    this.engraving = decal(
      scene,
      printedPlinth(),
      materials.colors.lines,
      0.63,
      PLINTH_TOP + 0.001,
      5.32,
      3.05
    );
    this.engraving.position.x = 0.11;
    this.engraving.renderOrder = 1;
    this.shadow = decal(scene, tex, 0x4c3924, 0.29, PLINTH_TOP + 0.003, 4.53, 2.18);
    this.shadow.renderOrder = 2;
    this.contacts = bee.legs.map(() => {
      const m = decal(scene, tex, 0x493e2d, 0.39, PLINTH_TOP + 0.004, 0.73, 0.33);
      m.renderOrder = 3;
      return m;
    });
    this.key = new T.DirectionalLight(0xfff3de, 1.95);
    this.key.position.set(-4, 7, 3);
    this.key.castShadow = true;
    scene.add(this.key);
    this.key.shadow.mapSize.set(1536, 1536);
    Object.assign(this.key.shadow.camera, {
      left: -5.2,
      right: 5.2,
      top: 5.2,
      bottom: -5.2,
      near: 0.35,
      far: 19,
    });
    this.key.shadow.bias = -0.00022;
    this.key.shadow.normalBias = 0.011;
    this.key.shadow.radius = 4.5;
    this.key.shadow.camera.updateProjectionMatrix();
    this.rim = new T.DirectionalLight(0xfff7ed, 1.36);
    this.rim.position.set(4, 3.7, -4.5);
    scene.add(this.rim);
    this.fill = new T.HemisphereLight(0xfff5df, 0x8c806a, 0.5);
    scene.add(this.fill);
    this.point = vec();
  }
  update(flight, bee, intro, time, explosion) {
    const m = this.materials,
      w = m.weights;
    this.grid.material.color.copy(m.colors.lines);
    this.inkGrid.material.color.copy(m.colors.lines);
    this.inkProgress.value = intro;
    const platform = smooth(0.08, 0.55, intro);
    m.uniforms.platform.value = platform;
    this.plinthShadow.material.opacity = 0.33 * platform;
    this.engraving.material.opacity = 0.67 * platform;
    this.grid.material.opacity = (1 - w[3]) * 0.47 * intro;
    this.inkGrid.material.opacity = w[3] * 0.62 * intro;
    this.inkGrid.visible = w[3] > 0.001;
    this.grid.scale.setScalar(extent * (0.93 + 0.07 * intro));
    this.grid.scale.z = 1;
    this.engraving.material.color.copy(m.colors.lines);
    this.key.color.copy(m.colors.key);
    this.rim.color.copy(m.colors.rim);
    this.key.position.x = -4 + Math.sin(time * 0.11) * 0.62;
    this.rim.position.z = -4.5 + Math.sin(time * 0.09) * 0.6;
    this.key.intensity = 1.95 - 0.82 * w[2];
    this.rim.intensity = 1.36 + 0.17 * w[2];
    this.fill.intensity = 0.5 - 0.28 * w[2];
    const h = Math.max(0, flight.pos.y);
    this.key.shadow.radius = 4.5 + 5 * h;
    this.key.shadow.intensity = 0.88 / (1 + h * 0.56);
    this.shadow.position.x = flight.pos.x + 0.16;
    this.shadow.position.z = flight.pos.z + 0.08;
    this.shadow.scale.set(4.52 / (1 + h * 0.15), 2.18 / (1 + h * 0.14), 1);
    this.shadow.material.opacity = (0.67 / (1 + h * 0.95)) * (1 - explosion * 0.42) * platform;
    for (const [i, mesh] of this.contacts.entries()) {
      bee.legs[i].foot.getWorldPosition(this.point);
      const dh = Math.max(0, this.point.y - PLINTH_TOP);
      mesh.position.x = this.point.x;
      mesh.position.z = this.point.z;
      mesh.material.opacity = 0.47 * (1 - smooth(0.01, 0.6, dh)) * (1 - explosion);
      mesh.visible = mesh.material.opacity > 0.005;
    }
  }
}
