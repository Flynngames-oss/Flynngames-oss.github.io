// The jet ski (personal watercraft): a lofted V-hull with sponsons, a deck with a hood, footwells and a seat
// pedestal, handlebars with mirrors, a jet nozzle, a rubber bumper and an optional rescue sled for towing
// surfers. Every colour, the side graphics and your own spray paint on the deck can be changed.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ENV_MAP } from './looks.js?v=10';

export const SKI_OPTIONS = {
  design: [['racing', 'Racing swoosh'], ['flames', 'Flames'], ['stripes', 'Stripes'], ['camo', 'Camo'], ['checker', 'Checkers'], ['solid', 'Solid'], ['none', 'Blank (for painting)']],
};
export const DEFAULT_SKI = { hull: '#f2f2f2', deck: '#ffd21f', accent: '#16181d', seat: '#2b2f36', design: 'racing', sled: true, sledColor: '#ffd23d' };
export const SKI_L = 3.3, SKI_B = 1.2; // length and beam (m)

// planform half-width (0..1) at t (0 = bow, 1 = stern)
function hwOf(t) {
  if (t < 0.42) return Math.pow(Math.sin(Math.PI / 2 * Math.min(1, t / 0.42)), 0.75);
  const k = (t - 0.42) / 0.58;
  return 1 - 0.12 * k * k;
}
export function skiOutline(n = 96) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([t, hwOf(t)]); }
  return pts;
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// paint: a picture of the deck from above (bow at the top), same idea as the surfboard
// ---------------------------------------------------------------------------
export const SKI_PW = 384, SKI_PH = 1024;
export const SKI_PAINT = { canvas: null };
export function skiPaintCanvas() {
  if (!SKI_PAINT.canvas) { SKI_PAINT.canvas = document.createElement('canvas'); SKI_PAINT.canvas.width = SKI_PW; SKI_PAINT.canvas.height = SKI_PH; }
  return SKI_PAINT.canvas;
}
export function loadSkiPaint(dataURL) {
  const c = skiPaintCanvas();
  return new Promise((res) => {
    if (!dataURL) { res(c); return; }
    const im = new Image();
    im.onload = () => { c.getContext('2d').drawImage(im, 0, 0, SKI_PW, SKI_PH); res(c); };
    im.onerror = () => res(c);
    im.src = dataURL;
  });
}
export function drawSkiDeck(g, cfg, paint) {
  const W = SKI_PW, H = SKI_PH;
  g.save();
  g.fillStyle = cfg.deck; g.fillRect(0, 0, W, H);
  const A = cfg.accent;
  let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (cfg.design === 'racing') {
    // two sweeping stripes from the hood back to the stern
    g.strokeStyle = A; g.lineCap = 'round';
    for (const sx of [-1, 1]) {
      g.lineWidth = 34; g.beginPath(); g.moveTo(W / 2 + sx * W * 0.08, H * 0.12); g.bezierCurveTo(W / 2 + sx * W * 0.3, H * 0.35, W / 2 + sx * W * 0.42, H * 0.6, W / 2 + sx * W * 0.47, H); g.stroke();
      g.lineWidth = 10; g.beginPath(); g.moveTo(W / 2 + sx * W * 0.16, H * 0.14); g.bezierCurveTo(W / 2 + sx * W * 0.36, H * 0.36, W / 2 + sx * W * 0.47, H * 0.6, W / 2 + sx * W * 0.5, H * 0.9); g.stroke();
    }
  } else if (cfg.design === 'flames') {
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i % 2 ? A : '#ff7a1f';
      const x0 = i * 60 - 20;
      g.beginPath(); g.moveTo(x0, H); g.bezierCurveTo(x0 + 10, H * 0.7, x0 + 70, H * 0.65, x0 + 30, H * (0.35 + r() * 0.15)); g.bezierCurveTo(x0 + 90, H * 0.65, x0 + 60, H * 0.8, x0 + 90, H); g.fill();
    }
  } else if (cfg.design === 'stripes') {
    for (const [dx, w] of [[-60, 22], [0, 40], [60, 22]]) { g.fillStyle = A; g.fillRect(W / 2 + dx - w / 2, 0, w, H); }
  } else if (cfg.design === 'camo') {
    const cols = [A, new THREE.Color(cfg.deck).offsetHSL(0, 0, -0.15).getStyle(), new THREE.Color(cfg.deck).offsetHSL(0, 0, 0.12).getStyle()];
    for (let i = 0; i < 90; i++) { g.fillStyle = cols[i % 3]; g.beginPath(); g.ellipse(r() * W, r() * H, 18 + r() * 40, 10 + r() * 26, r() * 3, 0, 6.28); g.fill(); }
  } else if (cfg.design === 'checker') {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) if ((i + j) % 2) { g.fillStyle = A; g.fillRect(i * 48, H - (j + 1) * 48, 48, 48); }
  }
  if (paint) g.drawImage(paint, 0, 0, W, H);
  g.restore();
}
// the side graphics on the hull (u = bow..stern, v = bottom..top)
function drawSide(g, cfg) {
  const W = 512, H = 128;
  g.fillStyle = cfg.hull; g.fillRect(0, 0, W, H);
  const A = cfg.accent, D = cfg.deck;
  if (cfg.design === 'racing' || cfg.design === 'solid' || cfg.design === 'stripes') {
    g.fillStyle = D; g.beginPath(); g.moveTo(W * 0.05, H * 0.75); g.bezierCurveTo(W * 0.35, H * 0.35, W * 0.6, H * 0.95, W, H * 0.45); g.lineTo(W, H * 0.68); g.bezierCurveTo(W * 0.6, H * 1.1, W * 0.35, H * 0.6, W * 0.05, H * 0.75); g.fill();
    g.fillStyle = A; g.fillRect(W * 0.12, H * 0.84, W * 0.85, H * 0.05);
  } else if (cfg.design === 'flames') {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? D : '#ff7a1f'; const y0 = H * (0.3 + 0.08 * i); g.beginPath(); g.moveTo(W * 0.15, y0); g.quadraticCurveTo(W * 0.5, y0 - 30, W, y0 + 10); g.lineTo(W, y0 + 24); g.quadraticCurveTo(W * 0.5, y0 - 10, W * 0.15, y0); g.fill(); }
  } else if (cfg.design === 'checker') {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) { g.fillStyle = A; g.fillRect(W * 0.5 + i * 16, H * 0.6 + j * 16, 16, 16); }
  } else if (cfg.design === 'camo') {
    let s = 9; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? A : D; g.beginPath(); g.ellipse(r() * W, r() * H, 14 + r() * 26, 6 + r() * 12, 0, 0, 6.28); g.fill(); }
  }
  // the dark waterline band
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, W, H * 0.12);
}

// ---------------------------------------------------------------------------
// the model. Frame: x = right, y = up (still-water line near 0), z = toward the stern; bow at -z.
// ---------------------------------------------------------------------------
export function makeJetski(cfg = DEFAULT_SKI, opts = {}) {
  cfg = { ...DEFAULT_SKI, ...cfg };
  const L = SKI_L, B = SKI_B;
  const NL = 44;
  const pos = [], uvD = [], uvS = [], idxDeck = [], idxHull = [];
  for (let i = 0; i <= NL; i++) {
    const t = i / NL, z = -L / 2 + t * L;
    const hw = Math.max(0.004, hwOf(t) * B / 2);
    const yk = -0.2 + 0.5 * Math.pow(1 - Math.min(1, t / 0.32), 2);            // keel rises to the bow
    const ys = 0.44 - 0.06 * t + 0.08 * Math.pow(1 - Math.min(1, t / 0.2), 2);   // sheer line
    const ytop = 0.5 + 0.38 * Math.exp(-Math.pow((t - 0.27) / 0.14, 2)) + 0.12 * ss(0.3, 0.42, t) * (1 - ss(0.86, 0.95, t)) - 0.04 * ss(0.88, 1, t);
    const f = ss(0.4, 0.5, t) * (1 - ss(0.84, 0.92, t));                        // footwells in the middle
    const fw = 0.4, ped = 0.6;
    const dome = (xf) => ys + 0.1 + (ytop - ys - 0.1) * (1 - Math.pow(Math.min(1, xf), 2.2));
    const side = [ // right side, from the deck centre round to the keel
      [0, (1 - f) * ytop + f * (ped + 0.02)],
      [(1 - f) * 0.32 * hw + f * 0.28, (1 - f) * dome(0.32) + f * ped],
      [(1 - f) * 0.36 * hw + f * 0.31, (1 - f) * dome(0.36) + f * fw],
      [0.84 * hw, (1 - f) * dome(0.84) + f * fw],
      [0.86 * hw, ys + 0.1],
      [0.98 * hw, ys + 0.1],
      [hw, ys],
      [0.97 * hw, yk + 0.26],
      [0.85 * hw, yk + 0.14],
      [0.55 * hw, yk + 0.07],
    ];
    const ring = [...side.map(([x, y]) => [x, y]), [0, yk], ...side.slice(1).reverse().map(([x, y]) => [-x, y])];
    for (let k = 0; k < ring.length; k++) {
      const [x, y] = ring[k];
      pos.push(x, y, z);
      uvD.push(x / B + 0.5, 1 - t);
      uvS.push(t, Math.min(1, Math.max(0, (y - yk) / Math.max(0.05, ys - yk))));
    }
  }
  const RN = 2 * 10; // ring size: 10 + keel + 9 = 20
  for (let i = 0; i < NL; i++) for (let k = 0; k < RN; k++) {
    const k2 = (k + 1) % RN;
    const a = i * RN + k, b = i * RN + k2, c = (i + 1) * RN + k, d = (i + 1) * RN + k2;
    const deck = (k <= 5 || k >= 15) && (k2 <= 5 || k2 >= 15) && !(k === 5 && k2 === 6) && !(k === 14 && k2 === 15);
    (deck ? idxDeck : idxHull).push(a, c, b, b, c, d);
  }
  // stern transom
  const base = NL * RN;
  const cx = pos.length / 3; pos.push(0, 0.2, L / 2 + 0.001); uvD.push(0.5, 0); uvS.push(1, 0.5);
  for (let k = 0; k < RN; k++) idxHull.push(cx, base + (k + 1) % RN, base + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvD, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uvS, 2));
  g.setIndex([...idxDeck, ...idxHull]);
  g.addGroup(0, idxDeck.length, 0); g.addGroup(idxDeck.length, idxHull.length, 1);
  g.computeVertexNormals();
  // the deck picture (design + paint) and the side graphics
  const cv = document.createElement('canvas'); cv.width = SKI_PW; cv.height = SKI_PH;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sc = document.createElement('canvas'); sc.width = 512; sc.height = 128;
  const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace; stex.channel = 1;
  const redraw = () => { drawSkiDeck(cv.getContext('2d'), cfg, opts.paint === false ? null : SKI_PAINT.canvas); tex.needsUpdate = true; };
  redraw(); drawSide(sc.getContext('2d'), cfg); stex.needsUpdate = true;
  const env = { envMap: ENV_MAP, envMapIntensity: 0.45 };
  const deckM = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12, ...env });
  const hullM = new THREE.MeshPhysicalMaterial({ map: stex, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12, ...env });
  const grp = new THREE.Group();
  const body = new THREE.Mesh(g, [deckM, hullM]);
  grp.add(body);
  const dark = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.6, ...env });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1d1f23', roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.25, metalness: 0.9, ...env });
  const seatM = new THREE.MeshPhysicalMaterial({ color: cfg.seat, roughness: 0.55, sheen: 0.4, ...env });
  const accentM = new THREE.MeshPhysicalMaterial({ color: cfg.accent, roughness: 0.35, clearcoat: 0.6, ...env });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); grp.add(m); return m; };
  const zt = (t) => -L / 2 + t * L;
  // rubber bumper along the sheer line
  const bump = [];
  for (let i = 0; i <= 30; i++) { const t = 0.03 + i / 30 * 0.95; const hw = hwOf(t) * B / 2; bump.push(new THREE.Vector3(hw + 0.015, 0.44 - 0.06 * t + 0.08 * Math.pow(1 - Math.min(1, t / 0.2), 2), zt(t))); }
  const bumpR = bump.map((v) => v.clone().setX(-v.x)).reverse();
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([...bumpR, ...bump]), 80, 0.035, 6, false), rubber, 0, 0, 0);
  // seat (two-tone with the passenger step)
  const seat = add(new RoundedBoxGeometry(0.52, 0.16, L * 0.36, 4, 0.07), seatM, 0, 0.69, zt(0.66));
  seat.scale.set(1, 1, 1);
  add(new RoundedBoxGeometry(0.5, 0.05, L * 0.3, 3, 0.02), accentM, 0, 0.775, zt(0.68));
  // steering: column, bar, grips, mirrors, a little dash and a visor
  const col = add(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 10), dark, 0, 0.82, zt(0.385), -0.55);
  col.castShadow = false;
  const barZ = zt(0.43), barY = 1.0;
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 10), metal, 0, barY, barZ, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10), rubber, sx * 0.33, barY, barZ, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), dark, sx * 0.36, barY + 0.06, zt(0.36), -0.3, 0, sx * 0.4);
    add(new RoundedBoxGeometry(0.13, 0.08, 0.03, 2, 0.012), dark, sx * 0.42, barY + 0.15, zt(0.35));
    add(new THREE.PlaneGeometry(0.11, 0.06), metal, sx * 0.42, barY + 0.15, zt(0.35) - 0.017, 0, Math.PI);
  }
  add(new RoundedBoxGeometry(0.28, 0.08, 0.16, 2, 0.02), dark, 0, 0.96, zt(0.37), -0.5);
  const visor = add(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20, 1, true, -0.7, 1.4), new THREE.MeshPhysicalMaterial({ color: '#0d1a22', roughness: 0.05, transmission: 0.3, transparent: true, opacity: 0.7, side: THREE.DoubleSide, ...env }), 0, 0.98, zt(0.38) + 0.12, -0.45, Math.PI, 0);
  visor.scale.set(1, 1, 0.55);
  // stern: jet nozzle, reboarding step, tow hook
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.28, 14), metal, 0, -0.05, L / 2 + 0.06, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14, 1, true), dark, 0, -0.05, L / 2 + 0.2, Math.PI / 2);
  add(new RoundedBoxGeometry(0.5, 0.03, 0.18, 2, 0.01), dark, 0, 0.08, L / 2 + 0.05);
  add(new THREE.TorusGeometry(0.045, 0.012, 6, 12), metal, 0, 0.5, L / 2 - 0.05, Math.PI / 2);
  // sponsons (little fins on the hull sides)
  for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.04, 0.09, 0.45, 2, 0.015), dark, sx * (B / 2 - 0.02), 0.02, zt(0.82));
  // hood vents
  for (let i = 0; i < 3; i++) add(new RoundedBoxGeometry(0.34 - i * 0.05, 0.015, 0.03, 2, 0.006), dark, 0, 0.83 + i * 0.015, zt(0.18 + i * 0.035), -0.25);
  // rescue sled for towing surfers
  if (cfg.sled) {
    const sledM = new THREE.MeshPhysicalMaterial({ color: cfg.sledColor, roughness: 0.6, sheen: 0.3, ...env });
    const sz = L / 2 + 0.95;
    add(new RoundedBoxGeometry(1.0, 0.1, 1.5, 4, 0.045), sledM, 0, 0.06, sz);
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), metal, sx * 0.28, 0.14, L / 2 + 0.12, Math.PI / 2 - 0.25);
      for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), dark, sx * 0.44, 0.12, sz - 0.5 + k * 0.5, 0, Math.PI / 2, 0);
    }
  }
  grp.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  grp.userData.redraw = redraw;
  grp.userData.length = L;
  return grp;
}
