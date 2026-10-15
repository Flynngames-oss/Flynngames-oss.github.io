// Detailed vehicle models: sculpted car bodies with glossy paint, e-dirt bikes and airliners.
// Geometry is built once per model and shared; only the paint material changes per colour.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';

// ---------------------------------------------------------------- reflections
let envTex = null;
function carEnv() {
  if (envTex || !G.renderer) return envTex;
  const s = new THREE.Scene();
  const g = new THREE.SphereGeometry(10, 48, 24);
  const top = new THREE.Color('#4f7fb0'), hor = new THREE.Color('#eef2f4'), gnd = new THREE.Color('#3c3a36');
  const cols = [], c = new THREE.Color(), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    if (y > 0) c.lerpColors(hor, top, Math.pow(y, 0.5)); else c.lerpColors(hor, gnd, Math.min(1, -y * 5));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 7) }));
  sun.position.set(5, 6, 3); s.add(sun);
  // a few dark "buildings" on the horizon give the reflections some detail
  const bm = new THREE.MeshBasicMaterial({ color: '#6a7078' });
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1 + (i * 7 % 5), 1.5), bm);
    const a = i / 14 * Math.PI * 2; b.position.set(Math.cos(a) * 8.5, 0, Math.sin(a) * 8.5); s.add(b);
  }
  const pm = new THREE.PMREMGenerator(G.renderer);
  envTex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return envTex;
}

const mats = new Map();
const envMats = [];
function std(key, opts, physical = false) {
  if (!mats.has(key)) {
    const m = new (physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)(opts);
    m.envMap = carEnv();
    m.userData.env = opts.envMapIntensity ?? 1;
    envMats.push(m);
    mats.set(key, m);
  }
  return mats.get(key);
}
export function paintMat(color) { return std('paint' + color, { color, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }, true); }
function plasticMat(color) { return std('plastic' + color, { color, metalness: 0.05, roughness: 0.42, envMapIntensity: 0.6 }); }
function metalMat(color, rough = 0.3) { return std('metal' + color + rough, { color, metalness: 0.85, roughness: rough }); }
const LIB = {
  glass: () => std('glass', { color: '#0d141b', metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6 }),
  chrome: () => metalMat('#e4e8ec', 0.1),
  alloy: () => metalMat('#b8bcc2', 0.25),
  darkAlloy: () => metalMat('#34373c', 0.35),
  rubber: () => std('rubber', { color: '#18191b', metalness: 0, roughness: 0.92, envMapIntensity: 0.3 }),
  trim: () => std('trim', { color: '#141518', metalness: 0.1, roughness: 0.55, envMapIntensity: 0.5 }),
  grille: () => std('grille', { color: '#0b0c0e', metalness: 0.4, roughness: 0.4 }),
  interior: () => std('interior', { color: '#26272a', metalness: 0, roughness: 0.85, envMapIntensity: 0.2 }),
  seat: () => std('seat', { color: '#1c1c1e', metalness: 0, roughness: 0.7, envMapIntensity: 0.3 }),
  liner: () => std('liner', { color: '#0e0e10', metalness: 0, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.1 }),
  headlight: () => std('headlight', { color: '#dfe6ee', emissive: '#fff4dc', emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.08 }),
  drl: () => std('drl', { color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.2 }),
  tail: () => std('tail', { color: '#6e0a0a', emissive: '#ff1010', emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.15 }),
  amber: () => std('amber', { color: '#ff9a1a', emissive: '#ff8a00', emissiveIntensity: 0.3, roughness: 0.2 }),
  plate: () => std('plate', { color: '#f2f2ea', metalness: 0.2, roughness: 0.4, map: plateTex() }),
  disc: () => metalMat('#8a8d92', 0.45),
  caliperRed: () => std('caliperRed', { color: '#c01818', metalness: 0.3, roughness: 0.35 }),
  frameMetal: () => metalMat('#2a2b2e', 0.35),
  silver: () => metalMat('#c9ccd1', 0.22),
  gold: () => metalMat('#c89a38', 0.2),
  white: () => paintMat('#f3f4f6'),
  black: () => paintMat('#111214'),
  wheelWhite: () => std('wheelWhite', { color: '#dcdcdc', metalness: 0.3, roughness: 0.4 }),
  lightbarRed: () => std('lbr', { color: '#a01010', emissive: '#ff0000', emissiveIntensity: 0.1 }),
  lightbarBlue: () => std('lbb', { color: '#1020a0', emissive: '#0030ff', emissiveIntensity: 0.1 }),
  awning: () => plasticMat('#f4a0c4'),
  stripe: () => std('stripe', { color: '#f2d21a', emissive: '#403800', roughness: 0.3 }),
  dark: () => plasticMat('#2b3a2e'),
};
export function M(key) {
  if (LIB[key]) return LIB[key]();
  if (key.startsWith('paint:')) return paintMat(key.slice(6));
  if (key.startsWith('plastic:')) return plasticMat(key.slice(8));
  if (key.startsWith('metal:')) return metalMat(key.slice(6));
  if (key.startsWith('tex:')) return TEXMATS.get(key);
  return paintMat(key);
}
const TEXMATS = new Map();
function texMat(key, canvasFn, opts = {}) {
  const k = 'tex:' + key;
  if (!TEXMATS.has(k)) {
    const t = new THREE.CanvasTexture(canvasFn()); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial(Object.assign({ map: t, metalness: 0.2, roughness: 0.4 }, opts));
    m.envMap = carEnv(); m.userData.env = 0.6; envMats.push(m);
    TEXMATS.set(k, m);
  }
  return k;
}
let _plate = null;
function plateTex() {
  if (_plate) return _plate;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f4ee'; x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#b01c1c'; x.font = 'italic 700 13px Georgia, serif'; x.textAlign = 'center'; x.fillText('Bobblyfornia', 64, 16);
  x.fillStyle = '#1a2a6a'; x.font = '700 30px Arial, sans-serif'; x.fillText('8BOB123', 64, 50);
  _plate = new THREE.CanvasTexture(c); _plate.colorSpace = THREE.SRGBColorSpace;
  return _plate;
}

// Day/night: reflections dim at night and headlights glow.
export function setVehicleLighting(day) {
  for (const m of envMats) m.envMapIntensity = m.userData.env * (0.15 + 0.85 * day);
  const hl = mats.get('headlight'); if (hl) hl.emissiveIntensity = 0.3 + (1 - day) * 2.2;
  const tl = mats.get('tail'); if (tl) tl.emissiveIntensity = 0.45 + (1 - day) * 1.2;
}

// ---------------------------------------------------------------- geometry kit
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
class Kit {
  constructor() { this.parts = new Map(); }
  put(geo, key, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }
  add(geo, key, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    return this.put(geo, key, _m);
  }
  // box of size w,h,d with rounded edges
  box(key, x, y, z, w, h, d, r = 0.03, rx = 0, ry = 0, rz = 0) { return this.add(rbox(w, h, d, r), key, x, y, z, rx, ry, rz); }
  // cylinder/rod between two points
  rod(key, a, b, rad, seg = 8) {
    _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
    const len = _d.length();
    _q.setFromUnitVectors(UPV, _d.normalize());
    _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(rad, len, rad));
    return this.put(cyl(seg), key, _m);
  }
  // flat strut (box) between two points; thickness t across X, width w
  strut(key, a, b, w, t) {
    _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
    const len = _d.length();
    _q.setFromUnitVectors(UPV, _d.normalize());
    _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(t, len, w));
    return this.put(BOXG, key, _m);
  }
  // flat panel between two points; width w across X, thickness t
  panel(key, a, b, w, t) {
    _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
    const len = _d.length();
    _q.setFromUnitVectors(UPV, _d.normalize());
    _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(w, len, t));
    return this.put(BOXG, key, _m);
  }
  merge(target, xform) {
    for (const [k, list] of target.parts) for (const g of list) { const c = g.clone(); if (xform) c.applyMatrix4(xform); if (!this.parts.has(k)) this.parts.set(k, []); this.parts.get(k).push(c); }
    return this;
  }
  bake() {
    const out = [];
    for (const [k, list] of this.parts) out.push({ key: k, geo: mergeGeometries(list, false) });
    return out;
  }
}
const BOXG = new THREE.BoxGeometry(1, 1, 1);
const rboxCache = new Map();
function rbox(w, h, d, r) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  if (r <= 0.004) { const k = 'b'; if (!rboxCache.has(k)) rboxCache.set(k, BOXG); const g = BOXG.clone(); g.scale(w, h, d); return g; }
  const k = [w, h, d, r].map(v => v.toFixed(3)).join();
  if (!rboxCache.has(k)) rboxCache.set(k, new RoundedBoxGeometry(w, h, d, 2, r));
  return rboxCache.get(k);
}
const cylCache = new Map();
function cyl(seg) { if (!cylCache.has(seg)) cylCache.set(seg, new THREE.CylinderGeometry(1, 1, 1, seg)); return cylCache.get(seg); }
const SPH = new THREE.SphereGeometry(1, 16, 10);

// Extrude a side profile (z,y points, front = +z) into a solid across the car's width.
function sideSolid(pts, width, bevel, { arches = [], yb = null, smooth = true, curveSeg = 10 } = {}) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  const rest = pts.slice(1).map(p => new THREE.Vector2(p[0], p[1]));
  if (smooth) s.splineThru(rest); else for (const p of rest) s.lineTo(p.x, p.y);
  // bottom edge, front to back, cutting round wheel arches
  const bottom = yb ?? pts[pts.length - 1][1];
  for (const a of [...arches].sort((u, v) => v.z - u.z)) {
    const sn = Math.max(-0.99, Math.min(0.99, (bottom - a.y) / a.r));
    const a1 = Math.asin(sn);
    s.lineTo(a.z + a.r * Math.cos(a1), bottom);
    s.absarc(a.z, a.y, a.r, a1, Math.PI - a1, false);
  }
  s.lineTo(pts[0][0], bottom);
  s.lineTo(pts[0][0], pts[0][1]);
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 3, curveSegments: curveSeg, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}
// Extrude a plan-view (x,z) outline upward by thickness (for wings etc.)
function planSolid(pts, thick, bevel = 0) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], -pts[0][1]);
  for (const p of pts.slice(1)) s.lineTo(p[0], -p[1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thick / 2, 0);
  return g;
}

// ---------------------------------------------------------------- wheels
const wheelCache = new Map();
// Returns baked parts for one wheel whose axle is along X and whose outer face points +X.
export function wheelModel(r, w, style = 'alloy') {
  const key = r.toFixed(2) + w.toFixed(2) + style;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const k = new Kit();
  const ri = style === 'monster' ? r * 0.5 : style === 'truck' ? r * 0.62 : r * 0.7;
  // tyre: lathe of a rounded section
  const pr = [];
  const hw = w / 2;
  pr.push(new THREE.Vector2(ri, -hw * 0.9));
  pr.push(new THREE.Vector2(r - 0.07 * r, -hw));
  pr.push(new THREE.Vector2(r - 0.015, -hw * 0.85));
  pr.push(new THREE.Vector2(r, -hw * 0.5));
  pr.push(new THREE.Vector2(r, hw * 0.5));
  pr.push(new THREE.Vector2(r - 0.015, hw * 0.85));
  pr.push(new THREE.Vector2(r - 0.07 * r, hw));
  pr.push(new THREE.Vector2(ri, hw * 0.9));
  const tyre = new THREE.LatheGeometry(pr, 28);
  tyre.rotateZ(Math.PI / 2);
  k.add(tyre, 'rubber');
  if (style === 'monster') for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; k.box('rubber', (i % 2 ? 0.18 : -0.18) * w, Math.cos(a) * r, Math.sin(a) * r, w * 0.5, 0.12, 0.28, 0.03, a, 0, 0); }
  // rim barrel
  const barrel = new THREE.CylinderGeometry(ri, ri, w * 0.86, 24, 1, true); barrel.rotateZ(Math.PI / 2);
  const rimKey = style === 'truck' ? 'wheelWhite' : style === 'sport' ? 'darkAlloy' : style === 'monster' ? 'chrome' : 'alloy';
  k.add(barrel, rimKey);
  const face = hw * 0.55;
  // rim lip
  const lip = new THREE.TorusGeometry(ri - 0.01, 0.022, 6, 24); lip.rotateY(Math.PI / 2);
  k.add(lip, rimKey, face + 0.02);
  // brake disc + caliper behind the spokes
  const disc = new THREE.CylinderGeometry(ri * 0.78, ri * 0.78, 0.03, 20); disc.rotateZ(Math.PI / 2);
  k.add(disc, 'disc', face - 0.1);
  k.box(style === 'sport' ? 'caliperRed' : 'darkAlloy', face - 0.06, ri * 0.55, -ri * 0.3, 0.07, ri * 0.4, ri * 0.35, 0.02);
  // spokes
  const n = style === 'sport' ? 10 : style === 'truck' ? 0 : 5;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const len = ri - 0.06;
    k.box(rimKey, face, Math.cos(a) * len / 2, Math.sin(a) * len / 2, 0.05, len, style === 'sport' ? 0.05 : 0.1, 0.015, a, 0, 0);
  }
  if (style === 'truck') {
    const dish = new THREE.CylinderGeometry(ri * 0.95, ri * 0.7, 0.08, 24); dish.rotateZ(Math.PI / 2);
    k.add(dish, rimKey, face - 0.02);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; k.add(SPH, 'chrome', face + 0.02, Math.cos(a) * ri * 0.35, Math.sin(a) * ri * 0.35, 0, 0, 0, 0.025, 0.025, 0.025); }
  }
  // hub cap
  const hub = new THREE.CylinderGeometry(ri * 0.22, ri * 0.26, 0.06, 16); hub.rotateZ(Math.PI / 2);
  k.add(hub, style === 'monster' ? 'chrome' : rimKey, face + 0.02);
  const baked = k.bake();
  wheelCache.set(key, baked);
  return baked;
}
// knobby dirt-bike wheel with wire spokes; axle along X
function bikeWheelModel(r, front) {
  const key = 'bike' + r.toFixed(3) + front;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const k = new Kit();
  const tube = r * 0.2;
  const tyre = new THREE.TorusGeometry(r - tube, tube, 10, 36); tyre.rotateY(Math.PI / 2);
  k.add(tyre, 'rubber');
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * Math.PI * 2 + (i % 2) * 0.05;
    const off = (i % 2 ? 1 : -1) * tube * 0.45;
    k.box('rubber', off, Math.cos(a) * (r - 0.006), Math.sin(a) * (r - 0.006), tube * 0.8, 0.04, 0.05, 0.01, a, 0, 0);
  }
  const rr = r - tube * 2 + 0.005;
  const rim = new THREE.TorusGeometry(rr, 0.02, 6, 36); rim.rotateY(Math.PI / 2); rim.scale(2.2, 1, 1);
  k.add(rim, 'darkAlloy');
  // hub + wire spokes laced from both flanges
  const hubG = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12); hubG.rotateZ(Math.PI / 2);
  k.add(hubG, 'silver');
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, side = i % 2 ? 1 : -1, a2 = a + side * 0.35;
    k.rod('silver', [side * 0.06, Math.cos(a2) * 0.05, Math.sin(a2) * 0.05], [side * 0.015, Math.cos(a) * rr, Math.sin(a) * rr], 0.004, 4);
  }
  // wavy brake rotor + sprocket/pulley
  const disc = new THREE.CylinderGeometry(front ? 0.11 : 0.1, front ? 0.11 : 0.1, 0.01, 18); disc.rotateZ(Math.PI / 2);
  k.add(disc, 'disc', -0.08);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.add(cyl(6), 'darkAlloy', -0.083, Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0, 0, Math.PI / 2, 0.012, 0.01, 0.012); }
  if (!front) {
    const spr = new THREE.CylinderGeometry(0.14, 0.14, 0.012, 24); spr.rotateZ(Math.PI / 2);
    k.add(spr, 'gold', 0.085);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; k.box('gold', 0.085, Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0.012, 0.018, 0.018, 0.002, a, 0, 0); }
  }
  const baked = k.bake();
  wheelCache.set(key, baked);
  return baked;
}

// Turn baked parts into meshes. `paint` replaces the 'body' key with the vehicle's colour.
export function meshesFrom(baked, overrides = {}, shadows = true) {
  const g = new THREE.Group();
  for (const { key, geo } of baked) {
    const m = new THREE.Mesh(geo, overrides[key] || M(key));
    m.castShadow = shadows && key !== 'glass'; m.receiveShadow = false;
    g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------- cars
// All cars: +z forward, +x = driver's side (left), ground at y=0.
const carCache = new Map();
function carShell(k, P) {
  const { L, W, wr, wz, lift = 0 } = P;
  const arches = wz.map(z => ({ z, y: wr + lift, r: wr + 0.1 }));
  k.add(sideSolid(P.body, W, P.bevel ?? 0.12, { arches, yb: P.yb + lift, smooth: P.smooth !== false }), 'body', 0, 0, 0);
  // black arch liners
  for (const z of wz) { const lg = new THREE.CylinderGeometry(wr + 0.09, wr + 0.09, W - 0.2, 16, 1, true, 0, Math.PI); lg.rotateZ(Math.PI / 2); k.add(lg, 'liner', 0, wr + lift, z); }
  // underbody
  k.box('trim', 0, P.yb + lift + 0.04, 0, W - 0.3, 0.08, L - 0.6, 0.02);
}
function greenhouse(k, P) {
  const { W } = P, gw = W * (P.glassW ?? 0.82);
  k.add(sideSolid(P.glass, gw, 0.1, { smooth: P.smooth !== false }), 'glass');
  // roof panel in body colour
  const [r0, r1] = P.roof;
  k.box('body', 0, P.roofY + 0.04, (r0 + r1) / 2, gw + 0.12, 0.08, r1 - r0, 0.04);
  // window frames follow the actual glass outline
  const outline = P.smooth === false ? P.glass : new THREE.SplineCurve(P.glass.map(p => new THREE.Vector2(p[0], p[1]))).getPoints(40).map(v => [v.x, v.y]);
  const rear = outline.filter(p => p[0] <= r0 + 0.08), front = outline.filter(p => p[0] >= r1 - 0.08);
  const px = gw / 2 + 0.02;
  const [cTop, cBot] = P.cPanel;
  const cpoly = [...rear, [cTop, P.roofY - 0.01], [cBot, rear[0][1]]];
  for (const sx of [-1, 1]) {
    for (const edge of [rear, front]) for (let i = 0; i < edge.length - 1; i++) k.strut('body', [sx * px, edge[i][1], edge[i][0]], [sx * px, edge[i + 1][1], edge[i + 1][0]], 0.1, 0.05);
    // C-pillar / rear quarter panel and B-pillar
    k.add(sideSolid(cpoly, 0.03, 0, { smooth: false }), 'body', sx * (gw / 2 + 0.015));
    k.strut('body', [sx * px, P.belt, P.bz], [sx * px, P.roofY, P.bz - 0.08], 0.13, 0.05);
    // window trim along the belt
    k.box('trim', sx * (px + 0.005), P.belt + 0.02, (P.glass[0][0] + P.glass[P.glass.length - 1][0]) / 2, 0.03, 0.04, Math.abs(P.glass[P.glass.length - 1][0] - P.glass[0][0]) - 0.2, 0.01);
  }
}
function carDetails(k, P) {
  const { L, W, wz } = P, hw = W / 2, lift = P.lift || 0;
  const zf = P.noseZ ?? L / 2, zr = P.tailZ ?? -L / 2;
  const hy = P.lightY ?? 0.85, ty = P.tailY ?? 0.95;
  for (const sx of [-1, 1]) {
    // headlights (lens + LED strip)
    const [hlw, hlh] = P.hl || [0.5, 0.15];
    k.box('headlight', sx * (hw - 0.34), hy + lift, zf - 0.08, hlw, hlh, 0.2, Math.min(0.06, hlh / 2 - 0.01), 0.25, sx * 0.2, 0);
    k.box('drl', sx * (hw - 0.36), hy + lift - 0.085, zf - 0.03, 0.42, 0.025, 0.06, 0.01, 0.25, sx * 0.2, 0);
    // tail lights
    k.box('tail', sx * (hw - 0.3), ty + lift, zr + 0.05, 0.55, 0.14, 0.14, 0.04, 0, -sx * 0.15, 0);
    k.box('amber', sx * (hw - 0.62), ty + lift - 0.02, zr + 0.06, 0.12, 0.1, 0.1, 0.02);
    // mirrors
    if (P.mirror) {
      const [mz, my] = P.mirror;
      k.box('body', sx * (hw + 0.1), my + lift, mz, 0.22, 0.13, 0.12, 0.04, 0, sx * 0.15, 0);
      k.box('trim', sx * (hw + 0.02), my + lift - 0.03, mz + 0.02, 0.1, 0.05, 0.06, 0.01);
    }
    // door shut lines + handles
    for (const dz of P.doors || []) k.box('trim', sx * (hw + 0.004), (P.yb + P.belt) / 2 + lift + 0.05, dz, 0.012, P.belt - P.yb - 0.2, 0.012, 0.004);
    for (const hz of P.handles || []) k.box('chrome', sx * (hw + 0.012), P.belt - 0.12 + lift, hz, 0.02, 0.035, 0.16, 0.012);
    // side sill
    k.box('trim', sx * (hw - 0.02), P.yb + 0.1 + lift, (wz[0] + wz[wz.length - 1]) / 2, 0.08, 0.08, Math.abs(wz[0] - wz[wz.length - 1]) - 2 * (P.wr + 0.12), 0.03);
  }
  // grille, lower intake, plates, exhaust
  k.box('grille', 0, (P.grilleY ?? 0.62) + lift, zf - 0.02, P.grilleW ?? 0.95, P.grilleH ?? 0.22, 0.1, 0.04);
  k.box('chrome', 0, (P.grilleY ?? 0.62) + lift + 0.02, zf + 0.025, (P.grilleW ?? 0.95) - 0.1, 0.025, 0.02, 0.01);
  k.box('trim', 0, P.yb + 0.12 + lift, zf - 0.04, W * 0.78, 0.1, 0.12, 0.04);
  k.box('plate', 0, P.yb + 0.25 + lift, zf + 0.02, 0.52, 0.13, 0.02, 0.005);
  k.box('plate', 0, ty - 0.3 + lift, zr - 0.01, 0.52, 0.13, 0.02, 0.005, 0, Math.PI, 0);
  k.box('trim', 0, P.yb + 0.12 + lift, zr + 0.05, W * 0.8, 0.12, 0.12, 0.04);
  k.add(cyl(10), 'chrome', hw - 0.45, P.yb + 0.1 + lift, zr + 0.05, Math.PI / 2, 0, 0, 0.05, 0.2, 0.05);
}
function interior(k, P) {
  const lift = P.lift || 0, sy = P.seatY + lift;
  // dashboard + steering wheel
  k.box('interior', 0, P.belt + lift - 0.02, P.dashZ, P.W * 0.8, 0.22, 0.45, 0.06);
  const sw = new THREE.TorusGeometry(0.19, 0.03, 6, 16);
  k.add(sw, 'trim', 0.45, P.belt + lift + 0.14, P.dashZ - 0.32, -0.45, 0, 0);
  k.rod('trim', [0.45, P.belt + lift + 0.08, P.dashZ - 0.25], [0.45, P.belt + lift, P.dashZ - 0.05], 0.03);
  // seats
  for (const sx of [-1, 1]) {
    k.box('seat', sx * 0.45, sy + 0.08, P.seatZ + 0.05, 0.55, 0.14, 0.55, 0.05);
    k.box('seat', sx * 0.45, sy + 0.45, P.seatZ - 0.28, 0.55, 0.7, 0.14, 0.05, -0.15, 0, 0);
  }
  if (P.rearSeat != null) k.box('seat', 0, sy + 0.4, P.rearSeat, P.W * 0.78, 0.6, 0.18, 0.05, -0.1, 0, 0);
}

const CARS = {
  sedan: () => ({
    L: 4.8, W: 2.1, wr: 0.4, wz: [1.52, -1.48], yb: 0.3, belt: 1.1, bevel: 0.14, seatY: 0.22, seatZ: -0.1, dashZ: 0.95, rearSeat: -1.2,
    body: [[-2.36, 0.36], [-2.42, 0.62], [-2.36, 0.95], [-2.15, 1.1], [-1.4, 1.15], [0.2, 1.13], [1.2, 1.1], [2.0, 0.98], [2.34, 0.8], [2.42, 0.56], [2.36, 0.32]],
    glass: [[-1.75, 1.08], [-1.2, 1.7], [-0.75, 2.0], [0.3, 2.02], [0.65, 1.85], [1.3, 1.08]],
    roof: [-0.95, 0.45], roofY: 2.0,
    cPanel: [-0.85, -1.2], bz: -0.3,
    mirror: [1.0, 1.22], doors: [1.05, -0.35, -1.45], handles: [0.05, -0.95],
  }),
  sports: () => ({
    L: 4.6, W: 2.12, wr: 0.4, wz: [1.45, -1.42], yb: 0.24, belt: 0.98, bevel: 0.16, seatY: 0.12, seatZ: -0.3, dashZ: 0.7,
    lightY: 0.72, tailY: 0.86, grilleY: 0.42, grilleW: 1.4, grilleH: 0.18,
    body: [[-2.26, 0.3], [-2.32, 0.6], [-2.24, 0.9], [-1.9, 1.0], [-1.2, 1.04], [-0.2, 1.0], [0.8, 0.95], [1.6, 0.8], [2.18, 0.6], [2.32, 0.42], [2.28, 0.26]],
    glass: [[-2.0, 0.98], [-1.0, 1.62], [-0.35, 1.9], [0.2, 1.92], [0.55, 1.7], [1.15, 0.96]],
    roof: [-0.55, 0.2], roofY: 1.9, glassW: 0.78,
    cPanel: [-0.45, -0.85], bz: -0.45,
    mirror: [0.85, 1.08], doors: [0.95, -0.85], handles: [-0.6], sport: true, hl: [0.55, 0.08],
  }),
  pickup: () => ({
    L: 5.6, W: 2.2, wr: 0.46, wz: [1.85, -1.75], yb: 0.4, belt: 1.35, bevel: 0.1, seatY: 0.45, seatZ: 0.15, dashZ: 1.25, smooth: false,
    lightY: 1.12, tailY: 1.15, grilleY: 0.9, grilleW: 1.4, grilleH: 0.42,
    body: [[-2.8, 0.45], [-2.8, 1.02], [1.35, 1.02], [1.4, 1.36], [2.45, 1.32], [2.75, 1.2], [2.82, 0.95], [2.8, 0.45]],
    glass: [[-0.35, 1.3], [-0.3, 2.32], [0.75, 2.37], [1.45, 1.32]],
    roof: [-0.4, 0.8], roofY: 2.35,
    cPanel: [-0.1, -0.15], bz: 0.45,
    mirror: [1.3, 1.5], doors: [1.4, 0.4, -0.38], handles: [0.3], truckBed: true, noseZ: 2.9, tailZ: -2.88, hl: [0.45, 0.22],
  }),
};
CARS.taxi = () => ({ ...CARS.sedan(), taxi: true });
CARS.police = () => ({ ...CARS.sedan(), police: true });
CARS.monster = () => ({ ...CARS.pickup(), raise: 0.95, bigWr: 1.05 });

export function carModel(typeId) {
  if (carCache.has(typeId)) return carCache.get(typeId);
  const P = CARS[typeId]();
  let k = new Kit();
  carShell(k, P);
  if (P.truckBed) {
    // cab walls up to the belt + open bed
    const lift = P.lift || 0;
    k.box('body', 0, 1.18 + lift, 0.5, P.W - 0.02, 0.36, 1.85, 0.08);
    for (const sx of [-1, 1]) k.box('body', sx * (P.W / 2 - 0.07), 1.22 + lift, -1.6, 0.14, 0.42, 2.4, 0.05);
    k.box('body', 0, 1.22 + lift, -2.74, P.W - 0.02, 0.42, 0.12, 0.04);
    k.box('trim', 0, 1.04 + lift, -1.6, P.W - 0.2, 0.04, 2.3, 0.01);
    for (const sx of [-1, 1]) k.box('trim', sx * (P.W / 2 - 0.07), 1.44 + lift, -1.6, 0.16, 0.03, 2.4, 0.01);
  }
  greenhouse(k, P); interior(k, P);
  carDetails(k, P);
  if (P.taxi) {
    k.box('white', 0, P.roofY + 0.22, -0.3, 0.9, 0.26, 0.36, 0.05);
    k.box('trim', 0, P.roofY + 0.1, -0.3, 0.12, 0.1, 0.12, 0.02);
    for (const sx of [-1, 1]) k.box('trim', sx * 1.052, 0.72, 0, 0.01, 0.12, 3.2, 0.005);
  }
  if (P.police) {
    for (const sx of [-1, 1]) k.box('black', sx * 1.0, 0.72, 0.1, 0.14, 0.62, 2.3, 0.05);
    k.box('trim', 0, P.roofY + 0.1, -0.25, 1.35, 0.06, 0.3, 0.02);
    k.box('trim', 0, 0.55, 2.5, 1.3, 0.3, 0.12, 0.04);
  }
  if (P.sport) {
    k.box('body', 0, 1.28, -2.05, 1.8, 0.05, 0.4, 0.02);
    for (const sx of [-1, 1]) { k.box('trim', sx * 0.6, 1.12, -2.0, 0.05, 0.24, 0.12, 0.01); k.box('trim', sx * 1.04, 0.6, -0.95, 0.06, 0.25, 0.6, 0.03); k.add(cyl(10), 'chrome', sx * 0.35, 0.3, -2.3, Math.PI / 2, 0, 0, 0.055, 0.15, 0.055); }
    k.box('trim', 0, 1.02, 1.3, 0.5, 0.02, 0.3, 0.01);
  }
  if (P.raise) {
    // monster truck: the whole body sits high on long-travel suspension
    const up = new Kit().merge(k, new THREE.Matrix4().makeTranslation(0, P.raise, 0));
    const wr = P.bigWr;
    for (const z of P.wz) {
      up.rod('darkAlloy', [-1.6, wr, z], [1.6, wr, z], 0.12);
      for (const sx of [-1, 1]) { up.rod('chrome', [sx * 0.9, wr, z], [sx * 0.85, P.raise + 0.55, z + 0.25], 0.07); up.rod('gold', [sx * 1.0, wr, z - 0.3], [sx * 0.9, P.raise + 0.55, z - 0.15], 0.05); }
    }
    up.box('trim', 0, wr + 0.1, 0, 0.3, 0.3, P.L - 1, 0.05);
    k = up;
  }
  const res = { parts: k.bake(), P };
  carCache.set(typeId, res);
  return res;
}

// Box trucks / vans: cab + body built from rounded boxes.
const truckCache = new Map();
export function truckModel(typeId, t) {
  if (truckCache.has(typeId)) return truckCache.get(typeId);
  const k = new Kit(), L = t.len, W = t.wid, wr = t.wr;
  const van = !!t.van, fire = !!t.ladder, garb = !!t.bed && t.truck;
  const wz = van ? [1.6, -1.55] : [L / 2 - 1.25, -L / 2 + 1.5];
  const cabL = van ? 1.6 : 2.2, cabZ0 = L / 2 - cabL;
  // chassis rails
  k.box('trim', 0, wr + 0.1, 0, W * 0.6, 0.22, L - 0.4, 0.03);
  // cab: nose + windscreen + roof
  const cabH = van ? 2.75 : 2.95;
  k.add(sideSolid([[cabZ0, 0.5], [cabZ0, cabH], [L / 2 - 0.7, cabH], [L / 2 - 0.12, 1.55], [L / 2, 1.2], [L / 2, 0.5]], W, 0.1, { smooth: false, arches: [{ z: wz[0], y: wr, r: wr + 0.1 }], yb: 0.5 }), 'body');
  k.panel('glass', [0, cabH - 0.1, L / 2 - 0.72], [0, 1.58, L / 2 - 0.12], W - 0.3, 0.05);
  for (const sx of [-1, 1]) k.box('glass', sx * (W / 2 + 0.003), (cabH + 1.5) / 2, cabZ0 + cabL * 0.45, 0.02, cabH - 1.7, cabL * 0.55, 0.01);
  k.box('grille', 0, 0.95, L / 2 + 0.01, W * 0.6, 0.45, 0.06, 0.02);
  for (let i = 0; i < 5; i++) k.box('chrome', 0, 0.78 + i * 0.09, L / 2 + 0.04, W * 0.56, 0.02, 0.02, 0.005);
  k.box('trim', 0, 0.55, L / 2 + 0.05, W + 0.05, 0.22, 0.16, 0.05);
  for (const sx of [-1, 1]) {
    k.box('headlight', sx * (W / 2 - 0.3), 1.0, L / 2 + 0.02, 0.36, 0.2, 0.06, 0.04);
    k.box('trim', sx * (W / 2 + 0.2), 2.0, L / 2 - 0.5, 0.05, 0.4, 0.2, 0.02);
    k.rod('trim', [sx * W / 2, 2.1, L / 2 - 0.55], [sx * (W / 2 + 0.2), 2.1, L / 2 - 0.5], 0.015);
    k.box('tail', sx * (W / 2 - 0.2), 0.8, -L / 2 - 0.01, 0.2, 0.3, 0.05, 0.02);
  }
  k.box('plate', 0, 0.62, L / 2 + 0.14, 0.52, 0.13, 0.02, 0.005);
  // rear body
  const bL = L - cabL - 0.15, bz = -L / 2 + bL / 2;
  const bodyKit = new Kit();
  if (van) {
    bodyKit.add(sideSolid([[-L / 2, 0.5], [-L / 2, 2.85], [cabZ0 + 0.1, 2.85], [cabZ0 + 0.1, 0.5]], W, 0.12, { smooth: false, arches: [{ z: wz[1], y: wr, r: wr + 0.1 }], yb: 0.5 }), 'body');
    // serving hatch with awning
    bodyKit.box('glass', W / 2 + 0.005, 1.75, -0.6, 0.02, 0.8, 1.8, 0.01);
    bodyKit.box('trim', W / 2 + 0.01, 1.3, -0.6, 0.06, 0.08, 1.9, 0.02);
    bodyKit.box('awning', W / 2 + 0.35, 2.3, -0.6, 0.7, 0.05, 2.0, 0.02, 0, 0, -0.35);
  } else if (fire) {
    bodyKit.add(sideSolid([[-L / 2, 0.55], [-L / 2, 2.2], [cabZ0 - 0.1, 2.2], [cabZ0 - 0.1, 0.55]], W, 0.08, { smooth: false, arches: [{ z: wz[1], y: wr, r: wr + 0.1 }], yb: 0.55 }), 'body');
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      bodyKit.box('alloy', sx * (W / 2 + 0.005), 1.45, -L / 2 + 0.6 + i * 1.05, 0.02, 1.1, 0.9, 0.01);
      for (let j = 0; j < 8; j++) bodyKit.box('trim', sx * (W / 2 + 0.012), 1.0 + j * 0.13, -L / 2 + 0.6 + i * 1.05, 0.01, 0.01, 0.88, 0.002);
    }
    bodyKit.box('chrome', 0, 2.25, bz, W - 0.1, 0.08, bL - 0.1, 0.02);
    for (const sx of [-1, 1]) bodyKit.box('stripe', sx * (W / 2 + 0.01), 0.75, 0, 0.01, 0.12, L - 0.3, 0.003);
  } else if (garb) {
    const bl = L - 2.4, gz = -L / 2 + bl / 2;
    bodyKit.box('body', 0, 1.0, gz, W, 0.5, bl, 0.05);
    for (const sx of [-1, 1]) bodyKit.box('body', sx * (W / 2 - 0.08), 1.95, gz, 0.16, 1.6, bl, 0.05);
    bodyKit.box('body', 0, 1.95, gz - bl / 2 + 0.08, W, 1.6, 0.16, 0.05);
    bodyKit.box('dark', 0, 1.95, gz + bl / 2 - 0.08, W, 1.6, 0.16, 0.05);
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) bodyKit.box('dark', sx * (W / 2 + 0.005), 1.95, gz - bl / 2 + 0.4 + i * bl / 5, 0.03, 1.5, 0.08, 0.01);
    bodyKit.box('amber', 0, 2.8, gz - bl / 2 + 0.1, 0.3, 0.12, 0.12, 0.03);
  }
  k.merge(bodyKit);
  if (fire) {
    for (const sx of [-1, 1]) k.box('chrome', sx * 0.55, 2.55, -1.0, 0.1, 0.1, L - 2.8, 0.02);
    for (let z = -L / 2 + 1; z < L / 2 - 2.4; z += 0.5) k.box('chrome', 0, 2.55, z, 1.1, 0.05, 0.05, 0.01);
    k.box('trim', 0, 2.35, cabZ0 - 0.4, 0.8, 0.3, 0.6, 0.05);
  }
  const res = { parts: k.bake(), wz, cabZ0, cabL, cabH };
  truckCache.set(typeId, res);
  return res;
}

// ---------------------------------------------------------------- e-dirt bikes
// Pivot at the rear tyre contact patch, +z forward. Returns parts for frame (static) and the two wheels.
const bikeCache = new Map();
export function bikeModel(sc) {
  const key = sc.toFixed(2);
  if (bikeCache.has(key)) return bikeCache.get(key);
  const k = new Kit();
  const r = 0.35, wb = 1.3;           // model units, scaled by `sc` afterwards
  const head = [0, 1.2, 0.92], headLo = [0, 1.04, 0.98];
  // twin-spar aluminium frame
  for (const sx of [-1, 1]) {
    const x = sx * 0.11;
    k.strut('frame', [x, head[1], head[2] - 0.02], [x, 0.9, 0.58], 0.09, 0.035);
    k.strut('frame', [x, 0.9, 0.58], [x, 0.5, 0.52], 0.1, 0.035);
    k.strut('frame', [x * 0.9, headLo[1], headLo[2]], [x, 0.42, 0.85], 0.07, 0.03);
    k.strut('frame', [x, 0.42, 0.85], [x, 0.4, 0.55], 0.07, 0.03);
    // subframe up to the tail
    k.rod('frame', [x * 0.9, 0.88, 0.6], [x * 0.7, 0.98, 0.05], 0.018, 6);
    k.rod('frame', [x * 0.9, 0.55, 0.5], [x * 0.7, 0.95, 0.12], 0.015, 6);
    // swingarm (box section)
    k.strut('darkAlloy', [x, r, 0], [x, 0.5, 0.54], 0.075, 0.04);
    k.strut('darkAlloy', [x, r + 0.05, 0.1], [x, 0.58, 0.4], 0.03, 0.03);
    // foot pegs
    k.box('darkAlloy', sx * 0.2, 0.46, 0.56, 0.12, 0.025, 0.06, 0.008);
  }
  k.add(cyl(12), 'frame', 0, (head[1] + headLo[1]) / 2, (head[2] + headLo[2]) / 2, -0.42, 0, 0, 0.05, 0.24, 0.05);
  // battery box + side covers
  k.box('battery', 0, 0.66, 0.78, 0.2, 0.44, 0.44, 0.03, 0.12, 0, 0);
  const cover = [[0.53, 0.52], [0.56, 0.95], [0.88, 1.12], [0.99, 1.06], [0.93, 0.5], [0.72, 0.42]];
  for (const sx of [-1, 1]) {
    const g = sideSolid(cover, 0.02, 0, { smooth: false, yb: 0.42 });
    k.add(g, 'plastic', sx * 0.135);
    // accent graphic stripe on the panel
    k.strut('accent', [sx * 0.147, 0.62, 0.62], [sx * 0.147, 0.9, 0.95], 0.06, 0.004);
    k.strut('accent', [sx * 0.147, 0.56, 0.72], [sx * 0.147, 0.72, 0.92], 0.025, 0.004);
  }
  // motor + controller
  const mot = new THREE.CylinderGeometry(0.1, 0.1, 0.18, 16); mot.rotateZ(Math.PI / 2);
  k.add(mot, 'silver', 0, 0.42, 0.6);
  k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 16).rotateZ(Math.PI / 2), 'darkAlloy', 0.095, 0.42, 0.6);
  k.box('darkAlloy', 0, 0.36, 0.8, 0.16, 0.08, 0.2, 0.02);
  // primary + chain run to the rear sprocket
  k.add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10).rotateZ(Math.PI / 2), 'gold', 0.1, 0.42, 0.6);
  k.strut('chain', [0.095, 0.455, 0.6], [0.095, r + 0.145, 0], 0.012, 0.012);
  k.strut('chain', [0.095, 0.385, 0.6], [0.095, r - 0.145, 0], 0.012, 0.012);
  // rear shock: body, spring coils, reservoir
  const sh0 = [0, 0.92, 0.5], sh1 = [0, r + 0.12, 0.3];
  k.rod('shockBody', sh0, sh1, 0.024, 10);
  for (let i = 1; i < 9; i++) {
    const t = 0.15 + i * 0.075, p = sh0.map((v, j) => v + (sh1[j] - v) * t);
    const ring = new THREE.TorusGeometry(0.045, 0.01, 5, 12); ring.rotateX(Math.PI / 2 - 0.35);
    k.add(ring, 'shock', ...p);
  }
  k.add(cyl(10), 'shock', 0.06, 0.82, 0.46, 0.4, 0, 0, 0.022, 0.12, 0.022);
  // long flat seat + tail
  k.add(sideSolid([[0.06, 0.98], [0.1, 1.05], [0.55, 1.07], [0.9, 1.05], [0.96, 1.0], [0.6, 0.97]], 0.24, 0.04, { smooth: true, yb: 0.97 }), 'seat');
  k.add(sideSolid([[-0.34, 1.02], [-0.3, 1.07], [0.1, 1.0], [0.16, 0.92], [-0.05, 0.93]], 0.18, 0.02, { smooth: false, yb: 0.92 }), 'plastic');
  k.box('tail', 0, 1.02, -0.33, 0.1, 0.04, 0.03, 0.01);
  k.box('plate', 0, 0.9, -0.28, 0.2, 0.1, 0.01, 0.003, -0.4, Math.PI, 0);
  // front: forks, clamps, bars, number plate + headlight, fender
  const rake = -0.42, fk = new Kit();
  for (const sx of [-1, 1]) {
    fk.add(cyl(12), 'fork', sx * 0.1, 0.72, 0, 0, 0, 0, 0.042, 0.56, 0.042);    // upper legs
    fk.add(cyl(12), 'stanchion', sx * 0.1, 0.3, 0, 0, 0, 0, 0.028, 0.5, 0.028);  // lower
    fk.add(cyl(8), 'darkAlloy', sx * 0.1, 0.04, 0.02, 0, 0, 0, 0.034, 0.1, 0.034);
  }
  fk.box('darkAlloy', 0, 0.78, -0.01, 0.3, 0.05, 0.1, 0.015);
  fk.box('darkAlloy', 0, 0.98, -0.01, 0.3, 0.05, 0.11, 0.015);
  const bar = new THREE.CylinderGeometry(0.014, 0.014, 0.8, 8); bar.rotateZ(Math.PI / 2);
  fk.add(bar, 'darkAlloy', 0, 1.08, -0.06, 0, 0, 0);
  for (const sx of [-1, 1]) {
    fk.add(cyl(8), 'rubber', sx * 0.34, 1.08, -0.06, 0, 0, Math.PI / 2, 0.02, 0.13, 0.02);
    fk.box('darkAlloy', sx * 0.24, 1.07, 0.02, 0.14, 0.012, 0.02, 0.004, 0, sx * 0.3, 0);
    fk.box('darkAlloy', sx * 0.16, 1.1, -0.06, 0.05, 0.04, 0.04, 0.01);
  }
  fk.rod('darkAlloy', [-0.05, 1.03, -0.02], [-0.05, 1.08, -0.06], 0.018);
  fk.rod('darkAlloy', [0.05, 1.03, -0.02], [0.05, 1.08, -0.06], 0.018);
  fk.box('bar', 0, 1.1, -0.06, 0.2, 0.04, 0.045, 0.015);
  fk.add(sideSolid([[0.08, 0.62], [0.1, 0.96], [0.16, 0.98], [0.17, 0.6]], 0.3, 0.03, { smooth: false, yb: 0.6 }), 'plastic', 0, 0, -0.03);
  fk.box('headlight', 0, 0.8, 0.17, 0.13, 0.1, 0.03, 0.02);
  fk.box('drl', 0, 0.86, 0.175, 0.16, 0.015, 0.02, 0.005);
  const fen = new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.15, 16, 1, true, -0.2, 1.5); fen.rotateZ(Math.PI / 2);
  fk.add(fen, 'plastic', 0, 0.02, 0.02, 0, 0, 0);
  fk.add(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 6).rotateZ(Math.PI / 2), 'silver', 0, 0, 0);
  const fm = new THREE.Matrix4().compose(new THREE.Vector3(0, r, wb), new THREE.Quaternion().setFromEuler(new THREE.Euler(rake, 0, 0)), new THREE.Vector3(1, 1, 1));
  k.merge(fk, fm);
  // kickstand + brake lines
  k.rod('rubber', [0.12, 1.08, 0.92], [0.12, 0.6, 1.2], 0.006, 4);
  const scale = new THREE.Matrix4().makeScale(sc, sc, sc);
  const frameParts = new Kit().merge(k, scale).bake();
  const wheels = [bikeWheelModel(r * sc, false), bikeWheelModel(r * sc, true)];
  const res = { parts: frameParts, wheels, r: r * sc, wb: wb * sc };
  bikeCache.set(key, res);
  return res;
}
export function bikeMaterials(B) {
  return {
    frame: metalMat(B.frame, 0.35),
    plastic: plasticMat(B.plastic),
    accent: plasticMat(B.accent),
    fork: B.fork === '#c8a040' ? M('gold') : metalMat(B.fork, 0.3),
    stanchion: B.fork === '#c8a040' ? M('gold') : M('darkAlloy'),
    shock: plasticMat(B.shock),
    shockBody: M('darkAlloy'),
    battery: M('trim'),
    chain: M('darkAlloy'),
    seat: M('seat'),
    bar: plasticMat(B.accent),
  };
}

// ---------------------------------------------------------------- airliner
let airCache = null;
function liveryTexture(name, stripe, stripe2) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 2048;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f6f8'; x.fillRect(0, 0, 512, 2048);
  // grey belly (u near 0 / 1 is the bottom)
  x.fillStyle = '#c3c8ce'; x.fillRect(0, 0, 60, 2048); x.fillRect(452, 0, 60, 2048);
  // cheatlines under the windows (both sides)
  for (const u of [0.5 - 0.27, 0.5 + 0.27]) {
    x.fillStyle = stripe; x.fillRect(u * 512 - 9, 0, 18, 2048);
    x.fillStyle = stripe2; x.fillRect(u * 512 + (u < 0.5 ? -15 : 11), 0, 4, 2048);
  }
  // passenger windows along the cabin (v runs tail->nose)
  x.fillStyle = '#1a2330';
  for (const u of [0.5 - 0.2, 0.5 + 0.2]) {
    for (let v = 330; v < 1720; v += 25) {
      if (Math.abs(v - 1020) < 30 || Math.abs(v - 1580) < 30 || Math.abs(v - 420) < 30) continue;
      x.beginPath(); x.roundRect(u * 512 - 7, v, 14, 11, 4); x.fill();
    }
    // doors
    x.strokeStyle = '#9aa2ac'; x.lineWidth = 2;
    for (const v of [1580, 1020, 420]) { x.beginPath(); x.roundRect(u * 512 - 14, v - 18, 28, 40, 5); x.stroke(); }
  }
  // cockpit windows near the nose (top side)
  x.fillStyle = '#10161e';
  for (const [u, w] of [[0.36, 26], [0.43, 30], [0.57, 30], [0.64, 26]]) { x.beginPath(); x.roundRect(u * 512 - w / 2, 1855, w, 22, 4); x.fill(); }
  // airline name above the windows, reading nose-first on each side
  x.fillStyle = stripe; x.font = '700 42px Arial, sans-serif'; x.textAlign = 'center';
  for (const [u, rot] of [[0.5 - 0.14, Math.PI / 2], [0.5 + 0.14, -Math.PI / 2]]) {
    x.save(); x.translate(u * 512, 1150); x.rotate(rot); x.fillText(name, 0, 14); x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const LIVERIES = [
  { name: 'BOBBLY AIR', a: '#1d3f7a', b: '#e0a020', fin: '#1d3f7a' },
  { name: 'PACIFIC WINGS', a: '#0f6f7a', b: '#f07030', fin: '#0f6f7a' },
  { name: 'SUNSET AIRWAYS', a: '#b8322a', b: '#f0a030', fin: '#b8322a' },
];
export function airlinerModel() {
  if (airCache) return airCache;
  // separate pieces so wings, engines and the tail can break off
  const K = { body: new Kit(), wingL: new Kit(), wingR: new Kit(), engL: new Kit(), engR: new Kit(), tail: new Kit() };
  let k = K.body;
  const R = 2.05, L = 40, zN = 20, zT = -20;
  // fuselage lathe (profile evenly spaced along the length so the livery maps evenly)
  const prof = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const z = zT + (L * i) / n;
    let r;
    if (z > 14) r = R * Math.sqrt(Math.max(0, 1 - Math.pow((z - 14) / 6.1, 2)));
    else if (z < -8) r = R * (0.18 + 0.82 * Math.pow((z - zT) / 12, 0.75));
    else r = R;
    prof.push(new THREE.Vector2(Math.max(r, 0.001), z));
  }
  const fus = new THREE.LatheGeometry(prof, 40);
  fus.rotateX(Math.PI / 2);
  // upswept tail cone and slightly flattened lower nose
  const p = fus.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z < -8) p.setY(i, p.getY(i) + Math.pow((-8 - z) / 12, 1.6) * 1.5);
    if (z > 15 && p.getY(i) < 0) p.setY(i, p.getY(i) * 0.9);
  }
  fus.computeVertexNormals();
  const fy = 3.55;
  k.add(fus, 'livery', 0, fy, 0);
  // wings: swept, with dihedral, flap track fairings and winglets
  const wing = (s) => planSolid([[s * 1.6, 5.2], [s * 17.5, -6.6], [s * 17.9, -8.1], [s * 1.6, -2.4]], 0.34, 0.05);
  for (const s of [-1, 1]) {
    k = s > 0 ? K.wingL : K.wingR;
    k.add(wing(s), 'white', 0, fy - 1.25, 0, 0, 0, s * 0.08);
    k.add(sideSolid([[-6.7, 0], [-8.0, 2.2], [-8.8, 2.2], [-8.2, 0]], 0.12, 0.02, { smooth: false, yb: 0 }), 'fin', s * 17.75, fy - 1.1 + 17.75 * 0.08, 0);
    for (const x of [5, 9, 13]) k.box('white', s * x, fy - 1.45 + x * 0.08, -2.2 - x * 0.35, 0.25, 0.3, 2.2, 0.1);
    // engine: nacelle, intake, fan, exhaust cone, pylon
    k = s > 0 ? K.engL : K.engR;
    const ex = s * 6.2, ey = fy - 2.55 + 6.2 * 0.08, ez = 3.2;
    const nac = new THREE.CylinderGeometry(1.15, 1.0, 4.4, 24, 1, true); nac.rotateX(Math.PI / 2);
    k.add(nac, 'white', ex, ey, ez);
    const lip = new THREE.TorusGeometry(1.1, 0.1, 8, 24); k.add(lip, 'alloy', ex, ey, ez + 2.2);
    k.add(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 24).rotateX(Math.PI / 2), 'darkAlloy', ex, ey, ez + 1.7);
    for (let i = 0; i < 18; i++) k.box('alloy', ex, ey, ez + 1.62, 0.1, 1.9, 0.03, 0.01, 0, 0, i / 18 * Math.PI);
    k.add(new THREE.ConeGeometry(0.35, 0.7, 16).rotateX(Math.PI / 2), 'chrome', ex, ey, ez + 1.9);
    k.add(new THREE.ConeGeometry(0.55, 1.4, 16).rotateX(-Math.PI / 2), 'darkAlloy', ex, ey, ez - 2.7);
    k.box('white', ex, ey + 1.05, ez - 0.6, 0.35, 0.8, 3.6, 0.1);
  }
  k = K.body;
  // wing-to-body fairing
  k.box('white', 0, fy - 1.55, 0.6, 3.6, 1.1, 9, 0.5);
  // horizontal tail
  k = K.tail;
  for (const s of [-1, 1]) k.add(planSolid([[s * 0.6, -14.2], [s * 7, -18.6], [s * 7.1, -19.8], [s * 0.6, -18.6]], 0.2, 0.03), 'white', 0, fy + 0.9, 0, 0, 0, s * 0.1);
  // vertical fin
  const fin = sideSolid([[-19.8, 1.4], [-17.2, 10.8], [-15.6, 10.8], [-11.6, 1.4]], 0.34, 0.05, { smooth: false, yb: 1.4 });
  k.add(fin, 'fin', 0, fy, 0);
  k.add(new THREE.CircleGeometry(1.5, 24), 'logo', 0.23, fy + 6.2, -16.4, 0, Math.PI / 2, 0);
  k.add(new THREE.CircleGeometry(1.5, 24), 'logo', -0.23, fy + 6.2, -16.4, 0, -Math.PI / 2, 0);
  // APU exhaust, nav lights
  k = K.body;
  k.add(cyl(10), 'darkAlloy', 0, fy + 1.5, -19.9, Math.PI / 2, 0, 0, 0.15, 0.3, 0.15);
  K.wingL.add(SPH, 'navRed', 17.9, fy - 1.25 + 1.45, -8.1, 0, 0, 0, 0.12, 0.12, 0.12);
  K.wingR.add(SPH, 'navGreen', -17.9, fy - 1.25 + 1.45, -8.1, 0, 0, 0, 0.12, 0.12, 0.12);
  // landing gear
  const gearWheel = (x, z, rr) => { const t = new THREE.CylinderGeometry(rr, rr, 0.32, 16); t.rotateZ(Math.PI / 2); k.add(t, 'rubber', x, rr, z); k.add(new THREE.CylinderGeometry(rr * 0.55, rr * 0.55, 0.34, 12).rotateZ(Math.PI / 2), 'alloy', x, rr, z); };
  for (const s of [-1, 1]) {
    k.rod('alloy', [s * 2.9, 0.62, -1.5], [s * 2.9, fy - 1.2, -1.1], 0.14);
    k.box('darkAlloy', s * 2.9, 0.62, -1.5, 0.3, 0.2, 1.5, 0.05);
    for (const dz of [-0.55, 0.55]) for (const dx of [-0.3, 0.3]) gearWheel(s * 2.9 + dx, -1.5 + dz, 0.6);
  }
  k.rod('alloy', [0, 0.45, 15.2], [0, fy - 1.3, 15.0], 0.1);
  for (const dx of [-0.2, 0.2]) gearWheel(dx, 15.2, 0.45);
  const groups = {};
  for (const name in K) groups[name] = K[name].bake();
  airCache = { groups, parts: [].concat(...Object.values(groups)), fy };
  return airCache;
}
export function airlinerMaterials(i = 0) {
  const L = LIVERIES[i % LIVERIES.length];
  const lk = 'livery' + i;
  if (!mats.has(lk)) {
    const m = new THREE.MeshPhysicalMaterial({ map: liveryTexture(L.name, L.a, L.b), metalness: 0.2, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    m.envMap = carEnv(); m.userData.env = 0.8; envMats.push(m); mats.set(lk, m);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.fillStyle = L.fin; x.fillRect(0, 0, 128, 128);
    x.fillStyle = L.b; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.fill();
    x.fillStyle = L.fin; x.font = '800 74px Arial, sans-serif'; x.textAlign = 'center'; x.fillText(L.name[0], 64, 90);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    mats.set('logo' + i, new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }));
  }
  return {
    livery: mats.get(lk), logo: mats.get('logo' + i), fin: paintMat(L.fin), white: paintMat('#f4f6f8'),
    navRed: std('navR', { color: '#ff2020', emissive: '#ff0000', emissiveIntensity: 2 }),
    navGreen: std('navG', { color: '#20ff40', emissive: '#00ff30', emissiveIntensity: 2 }),
  };
}
export const LIVERY_COUNT = LIVERIES.length;
