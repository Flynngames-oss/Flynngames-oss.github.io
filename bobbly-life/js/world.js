// Builds Bobbly Town: ground, roads, buildings, colliders, trees, day/night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, mat, textSprite, rand, pick, clamp, lerp, LAND, WATER_Y } from './state.js';
import { buildHeights, heightAt, buildTerrainMesh, buildHighways, biome, slopeAt, findPeak, srand, LAKES, WORLD } from './terrain.js';

// ---------------------------------------------------------------- collision
export const colliders = [];
export const ramps = [];
const CELL = 20, GRID = new Map();
let groundTag = null;
export const getGroundTag = () => groundTag;

function cellKey(ix, iz) { return ix * 1000 + iz; }
function gridInsert(c) {
  const m = 3;
  for (let ix = Math.floor((c.minX - m) / CELL); ix <= Math.floor((c.maxX + m) / CELL); ix++)
    for (let iz = Math.floor((c.minZ - m) / CELL); iz <= Math.floor((c.maxZ + m) / CELL); iz++) {
      const k = cellKey(ix, iz);
      if (!GRID.has(k)) GRID.set(k, []);
      GRID.get(k).push(c);
    }
}
const EMPTY = [];
export function nearColliders(x, z) {
  return GRID.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY;
}

export function addCollider(minX, minY, minZ, maxX, maxY, maxZ, tag = null) {
  const c = { minX, minY, minZ, maxX, maxY, maxZ, tag, off: false };
  colliders.push(c);
  gridInsert(c);
  return c;
}

export function baseHeight(x, z) {
  return heightAt(x, z);
}

function rampHeight(rp, x, z) {
  const dx = x - rp.x, dz = z - rp.z;
  const s = Math.sin(rp.a), c = Math.cos(rp.a);
  const u = dx * s + dz * c, v = dx * c - dz * s;
  if (Math.abs(v) > rp.w / 2 || Math.abs(u) > rp.l / 2) return -Infinity;
  return rp.y0 + rp.h * ((u + rp.l / 2) / rp.l);
}

// Highest walkable surface under (x,z) that is not far above y.
export function groundHeight(x, z, y, r = 0.3) {
  let h = baseHeight(x, z);
  groundTag = null;
  const list = nearColliders(x, z);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.off) continue;
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r && c.maxY <= y + 0.65 && c.maxY > h) {
      h = c.maxY; groundTag = c.tag;
    }
  }
  for (let i = 0; i < ramps.length; i++) {
    const rh = rampHeight(ramps[i], x, z);
    if (rh > h && rh <= y + 0.9) { h = rh; groundTag = 'ramp'; }
  }
  return h;
}

// Push a vertical cylinder (feet at pos.y, height h) out of walls. Returns {nx,nz} of last hit or null.
export function resolveWalls(pos, r, h = 1.8, step = 0.55) {
  let hit = null;
  const list = nearColliders(pos.x, pos.z);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.off) continue;
    if (pos.y + h < c.minY || pos.y > c.maxY - step) continue;
    if (pos.x > c.minX - r && pos.x < c.maxX + r && pos.z > c.minZ - r && pos.z < c.maxZ + r) {
      const px1 = pos.x - (c.minX - r), px2 = (c.maxX + r) - pos.x;
      const pz1 = pos.z - (c.minZ - r), pz2 = (c.maxZ + r) - pos.z;
      const m = Math.min(px1, px2, pz1, pz2);
      if (m === px1) { pos.x -= px1; hit = { nx: -1, nz: 0, c }; }
      else if (m === px2) { pos.x += px2; hit = { nx: 1, nz: 0, c }; }
      else if (m === pz1) { pos.z -= pz1; hit = { nx: 0, nz: -1, c }; }
      else { pos.z += pz2; hit = { nx: 0, nz: 1, c }; }
    }
  }
  return hit;
}

// ---------------------------------------------------------------- static geometry batching
const statics = [];
function S(geo, material, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.updateMatrix();
  statics.push(m);
  return m;
}
function finalizeStatic() {
  const groups = new Map();
  for (const m of statics) {
    if (!groups.has(m.material)) groups.set(m.material, []);
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    groups.get(m.material).push(g);
  }
  for (const [material, geos] of groups) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    G.scene.add(mesh);
  }
  statics.length = 0;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONE4 = new THREE.ConeGeometry(1, 1, 4);
const PLANE = new THREE.PlaneGeometry(1, 1);

// solid box with collider; y0 = bottom
function box(x, y0, z, w, h, d, material, collide = true, tag = null) {
  if (typeof material === 'string') material = mat(material);
  S(BOX, material, x, y0 + h / 2, z, 0, 0, 0, w, h, d);
  if (collide) return addCollider(x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, tag);
}
function flat(x, y, z, w, d, color, ry = 0) {
  S(PLANE, typeof color === 'string' ? mat(color) : color, x, y, z, ry, -Math.PI / 2, 0, w, d, 1);
}

// Building wall material with window texture, glowing windows at night.
const nightMats = [];
const bmatCache = new Map();
let winTex = null, winEmit = null;
function makeWindowTextures() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#9fc7e8'; x.fillRect(16, 14, 32, 30);
  x.fillStyle = '#ffffff'; x.fillRect(31, 14, 2, 30);
  x.fillStyle = '#d9d9d9'; x.fillRect(12, 44, 40, 4);
  winTex = new THREE.CanvasTexture(c);
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping; winTex.colorSpace = THREE.SRGBColorSpace;
  const e = document.createElement('canvas'); e.width = e.height = 64;
  const y = e.getContext('2d');
  y.fillStyle = '#000'; y.fillRect(0, 0, 64, 64);
  y.fillStyle = '#ffd98a'; y.fillRect(16, 14, 32, 30);
  winEmit = new THREE.CanvasTexture(e);
  winEmit.wrapS = winEmit.wrapT = THREE.RepeatWrapping;
}
function bmat(color) {
  if (!bmatCache.has(color)) {
    const m = new THREE.MeshLambertMaterial({ color, map: winTex, emissive: '#ffcf6a', emissiveMap: winEmit, emissiveIntensity: 0 });
    nightMats.push(m);
    bmatCache.set(color, m);
  }
  return bmatCache.get(color);
}
// Box geometry whose UVs repeat every 4m so windows keep their size.
function windowBoxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) {
    const f = Math.floor(i / 4);
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(dims[f][0] / 4)), uv.getY(i) * Math.max(1, Math.round(dims[f][1] / 4)));
  }
  return g;
}
function building(x, z, w, d, h, color, roofColor = '#6b6f78') {
  S(windowBoxGeo(w, h, d), bmat(color), x, h / 2, z);
  S(BOX, mat(roofColor), x, h + 0.25, z, 0, 0, 0, w + 0.6, 0.5, d + 0.6);
  return addCollider(x - w / 2, 0, z - d / 2, x + w / 2, h + 0.5, z + d / 2);
}
function sign(text, x, y, z, color = '#fff', bg = '#ff6a1a', scale = 3) {
  const sp = textSprite(text, { size: 64, color, bg, scale });
  sp.position.set(x, y, z);
  G.scene.add(sp);
}

// ---------------------------------------------------------------- locations
export const ROADS = [-150, -90, -30, 30, 90, 150];
export const BLOCKS = [-120, -60, 0, 60, 120];
export const LOC = {
  spawn: { x: 0, z: -14 },
  pizza: { x: 55, z: 0 },
  taxi: { x: -55, z: 0 },
  clothing: { x: 0, z: 56 },
  dealer: { x: 0, z: -58 },
  fire: { x: 54, z: 50 },
  recycle: { x: 56, z: -52 },
  dumpster: { x: 50, z: -64, w: 5, d: 3 },
  park: { x: -60, z: 60 },
  stunt: { x: -60, z: -60 },
  race: { x: -42, z: -42 },
  sawmill: { x: -108, z: -12 },
  logZone: { x: -106, z: 0, w: 12, d: 14 },
  fishing: { x: 229, z: 0 },
  airport: { x: -135, z: 168 },
  blasters: { x: -71, z: -44 },
  fishMarket: { x: 168, z: 10, w: 8, d: 5 },
  mansion: { x: 62, z: 108 },
  wardrobe: { x: 50, z: 112 },
  fireBuildings: [],
};

// ---------------------------------------------------------------- trees (instanced so they can be chopped)
let trunkIM, roundIM, pineIM, snowIM;
const treeDefs = [];
function addTree(x, z, type = Math.random() < 0.5 ? 'round' : 'pine', s = rand(0.85, 1.25)) {
  treeDefs.push({ x, z, type, s, y: heightAt(x, z) });
}
function buildTrees() {
  const n = treeDefs.length;
  trunkIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 1, 7), mat('#8b5a2b'), n);
  roundIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat('#5cbf4a', { flatShading: true }), n);
  pineIM = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), mat('#3f9e52', { flatShading: true }), n);
  snowIM = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), mat('#e8f2f5', { flatShading: true }), n);
  for (const im of [trunkIM, roundIM, pineIM, snowIM]) { im.castShadow = true; im.receiveShadow = true; G.scene.add(im); }
  treeDefs.forEach((t, i) => {
    const tree = { x: t.x, z: t.z, y: t.y, type: t.type, s: t.s, idx: i, hp: 5, alive: true, regrow: 0, shake: 0 };
    tree.collider = addCollider(t.x - 0.45, t.y - 1, t.z - 0.45, t.x + 0.45, t.y + 4 * t.s, t.z + 0.45, 'tree');
    G.trees.push(tree);
    setTreeMatrix(tree, 1);
  });
  for (const im of [trunkIM, roundIM, pineIM, snowIM]) im.computeBoundingSphere();
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _qq = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export function setTreeMatrix(tree, grow, lean = 0) {
  const s = tree.s * grow, y = tree.y || 0;
  _e.set(lean * 0.6, 0, lean);
  _qq.setFromEuler(_e);
  _p.set(tree.x, y + 1.5 * s, tree.z); _s.set(s, 3 * s, s);
  _m.compose(_p, _qq, _s); trunkIM.setMatrixAt(tree.idx, _m);
  roundIM.setMatrixAt(tree.idx, ZERO); pineIM.setMatrixAt(tree.idx, ZERO); snowIM.setMatrixAt(tree.idx, ZERO);
  if (tree.type === 'round') {
    _p.set(tree.x, y + 4.2 * s, tree.z); _s.set(2.2 * s, 2.0 * s, 2.2 * s);
    _m.compose(_p, _qq, _s); roundIM.setMatrixAt(tree.idx, _m);
  } else {
    _p.set(tree.x, y + 4.8 * s, tree.z); _s.set(2.0 * s, 5 * s, 2.0 * s);
    _m.compose(_p, _qq, _s); (tree.type === 'snow' ? snowIM : pineIM).setMatrixAt(tree.idx, _m);
  }
  if (grow === 0) trunkIM.setMatrixAt(tree.idx, ZERO), roundIM.setMatrixAt(tree.idx, ZERO), pineIM.setMatrixAt(tree.idx, ZERO), snowIM.setMatrixAt(tree.idx, ZERO);
  trunkIM.instanceMatrix.needsUpdate = roundIM.instanceMatrix.needsUpdate = pineIM.instanceMatrix.needsUpdate = snowIM.instanceMatrix.needsUpdate = true;
}

// Cacti and rocks: simple instanced decorations with small colliders.
function buildInstanced(list, parts) {
  for (const [geo, color, tf] of parts) {
    const im = new THREE.InstancedMesh(geo, mat(color, { flatShading: true }), list.length);
    list.forEach((d, i) => { tf(d, _m); im.setMatrixAt(i, _m); });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    G.scene.add(im);
  }
}
function buildWilderness() {
  const cacti = [], rocks = [];
  const tries = 60000;
  for (let k = 0; k < tries; k++) {
    const x = (srand() * 2 - 1) * (WORLD - 60), z = (srand() * 2 - 1) * (WORLD - 60);
    if (Math.max(Math.abs(x), Math.abs(z)) < LAND + 25) continue;
    if (Math.abs(x + 30) < 12 && z > 0) continue;
    if (Math.abs(x - 30) < 12 && z < 0) continue;
    if (Math.abs(z - 30) < 12 && x < 0) continue;
    const h = heightAt(x, z);
    if (h < 0.8) continue;
    const b = biome(x, z), sl = slopeAt(x, z), r = srand();
    if (b.west > 0.55 && h < 90 && sl < 0.7) { if (r < 0.09) addTree(x, z, srand() < 0.6 ? 'pine' : 'round', 0.9 + srand() * 0.7); }
    else if (b.north > 0.5 && sl < 0.9) {
      if (h < 115 && r < 0.035) addTree(x, z, h > 60 ? 'snow' : 'pine', 0.9 + srand() * 0.6);
      else if (r > 0.992) rocks.push({ x, z, y: h, s: 1 + srand() * 3, a: srand() * 6 });
    } else if (b.south > 0.55) {
      if (r < 0.012) cacti.push({ x, z, y: h, s: 0.8 + srand() * 0.7, a: srand() * 6 });
      else if (r > 0.996) rocks.push({ x, z, y: h, s: 1 + srand() * 2.5, a: srand() * 6 });
    } else if (r < 0.012) addTree(x, z, 'round', 0.9 + srand() * 0.5);
    else if (r > 0.997) rocks.push({ x, z, y: h, s: 1 + srand() * 2, a: srand() * 6 });
  }
  const up = new THREE.Vector3(0, 1, 0);
  buildInstanced(cacti, [
    [new THREE.CylinderGeometry(0.45, 0.5, 1, 8), '#3f9e52', (d, m) => { _qq.setFromAxisAngle(up, d.a); m.compose(_p.set(d.x, d.y + 2 * d.s, d.z), _qq, _s.set(d.s, 4 * d.s, d.s)); }],
    [new THREE.CylinderGeometry(0.3, 0.3, 1, 8), '#3f9e52', (d, m) => { _qq.setFromAxisAngle(up, d.a); m.compose(_p.set(d.x + Math.cos(d.a) * 0.8 * d.s, d.y + 2.6 * d.s, d.z - Math.sin(d.a) * 0.8 * d.s), _qq, _s.set(d.s, 1.6 * d.s, d.s)); }],
    [new THREE.CylinderGeometry(0.3, 0.3, 1, 8), '#3f9e52', (d, m) => { _qq.setFromAxisAngle(up, d.a); m.compose(_p.set(d.x - Math.cos(d.a) * 0.8 * d.s, d.y + 2.1 * d.s, d.z + Math.sin(d.a) * 0.8 * d.s), _qq, _s.set(d.s, 1.3 * d.s, d.s)); }],
  ]);
  for (const d of cacti) addCollider(d.x - 0.5 * d.s, d.y - 1, d.z - 0.5 * d.s, d.x + 0.5 * d.s, d.y + 4 * d.s, d.z + 0.5 * d.s);
  buildInstanced(rocks, [[new THREE.DodecahedronGeometry(1, 0), '#9b9186', (d, m) => { _qq.setFromAxisAngle(up, d.a); m.compose(_p.set(d.x, d.y + d.s * 0.3, d.z), _qq, _s.set(d.s * 1.3, d.s, d.s)); }]]);
  for (const d of rocks) addCollider(d.x - d.s, d.y - 2, d.z - d.s, d.x + d.s, d.y + d.s * 1.1, d.z + d.s);
}

// Landmarks out in the wild
function stepPyramid(x, z, size, steps, color) {
  const y0 = heightAt(x, z) - 3;
  const sh = size * 0.08;
  for (let i = 0; i < steps; i++) {
    const w = size * (1 - i / steps);
    box(x, y0 + i * sh, z, w, sh + (i === 0 ? 3 : 0), w, color);
  }
  return y0 + steps * sh;
}
function buildLandmarks() {
  // Desert pyramids
  const top1 = stepPyramid(140, -720, 70, 10, '#e6c27a');
  stepPyramid(260, -800, 44, 8, '#dcb56a');
  sign('🏜️ Bobbly Pyramids', 140, top1 + 6, -720, '#fff', '#c8963e', 3);
  LOC.pyramid = { x: 140, z: -684, top: top1 };
  // Oasis
  const lk = LAKES[1];
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; addTree(lk.x + Math.cos(a) * (lk.r + 6), lk.z + Math.sin(a) * (lk.r + 6), 'round', 1.2); }
  LOC.oasis = { x: lk.x + lk.r + 14, z: lk.z };
  // Mountain summit
  const pk = findPeak(-400, 500, 400, 1100);
  LOC.peak = pk;
  S(CYL8, mat('#8b5a2b'), pk.x, pk.h + 3, pk.z, 0, 0, 0, 0.15, 6, 0.15);
  S(BOX, mat('#ff5b6e'), pk.x + 1, pk.h + 5.2, pk.z, 0, 0, 0, 2, 1.2, 0.08);
  sign('⛰️ Mount Bobble — you made it!', pk.x, pk.h + 8, pk.z, '#fff', '#3f6f9e', 3);
  // Lake cabin
  const lake = LAKES[0];
  const cx = lake.x + lake.r + 14, cz = lake.z;
  const cy = heightAt(cx, cz);
  box(cx, cy - 2, cz, 8, 6.5, 7, '#8b5a2b');
  S(CONE4, mat('#6b3a2a'), cx, cy + 5.9, cz, Math.PI / 4, 0, 0, 6.6, 2.8, 5.8);
  box(cx - 9, -3, cz, 12, 3.4, 3, '#a0683a');
  sign('🏕️ Lake Cabin', cx, cy + 9, cz, '#fff', '#5a8a3a', 2.4);
  LOC.cabin = { x: cx - 6, z: cz + 6 };
  // North lake viewpoint
  LOC.eastLake = { x: LAKES[2].x - LAKES[2].r - 10, z: LAKES[2].z };
  // Highway signs at the town exits
  sign('⛰️ Snowy Mountains ↑', -30, 6, 200, '#fff', '#3f6f9e', 2.4);
  sign('🏜️ Desert ↓', 30, 6, -200, '#fff', '#c8963e', 2.4);
  sign('🌲 Forest & Lake ←', -200, 6, 30, '#fff', '#3f8a4a', 2.4);
}

// ---------------------------------------------------------------- lamps (instanced)
let bulbIM, bulbMat;
const lampPos = [];
function buildLamps() {
  for (const r of ROADS) {
    for (let t = -LAND + 10; t < LAND; t += 26) {
      if (ROADS.some(q => Math.abs(q - t) < 8)) continue;
      if (Math.abs(t) < 156) lampPos.push([r + 6, t]);
      lampPos.push([t, r - 6]);
    }
  }
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 5, 6), mat('#4a4f5a'), lampPos.length);
  bulbMat = new THREE.MeshBasicMaterial({ color: '#eeeeee' });
  bulbIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), bulbMat, lampPos.length);
  lampPos.forEach(([x, z], i) => {
    _m.makeTranslation(x, 2.5, z); pole.setMatrixAt(i, _m);
    _m.makeTranslation(x, 5.1, z); bulbIM.setMatrixAt(i, _m);
    addCollider(x - 0.15, 0, z - 0.15, x + 0.15, 5, z + 0.15);
  });
  pole.castShadow = true;
  G.scene.add(pole, bulbIM);
}

// ---------------------------------------------------------------- textures
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#555a63'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#ffd54a'; x.fillRect(30, 4, 4, 30);
  x.fillStyle = '#e8e8e8'; x.fillRect(2, 0, 2, 64); x.fillRect(60, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, (LAND * 2) / 10);
  return t;
}

// ---------------------------------------------------------------- building blocks
function house(x, z, face, color) {
  const w = 8, d = 7, h = 4.5;
  S(windowBoxGeo(w, h, d), bmat(color), x, h / 2, z);
  S(CONE4, mat(pick(['#b54a3f', '#6b4a3f', '#3f5f8b', '#4a7a4a'])), x, h + 1.4, z, Math.PI / 4, 0, 0, 6.6, 2.8, 5.8);
  addCollider(x - w / 2, 0, z - d / 2, x + w / 2, h + 0.2, z + d / 2);
  // door + path
  const fx = face === 0 ? 1 : face === 1 ? -1 : 0, fz = face === 2 ? 1 : face === 3 ? -1 : 0;
  const dx = x + fx * (w / 2 + 0.05), dz = z + fz * (d / 2 + 0.05);
  S(BOX, mat('#7a4a2b'), dx, 1.1, dz, 0, 0, 0, fx ? 0.12 : 1.4, 2.2, fz ? 0.12 : 1.4);
  const pathLen = 6;
  flat(x + fx * (w / 2 + pathLen / 2), 0.045, z + fz * (d / 2 + pathLen / 2), fx ? pathLen : 1.6, fz ? pathLen : 1.6, '#cfc6b3');
  // chimney
  box(x + 2, h, z + 1.5, 0.8, 2.5, 0.8, '#9a6b5a', false);
  const door = { x: x + fx * (w / 2 + 3.5), z: z + fz * (d / 2 + 3.5) };
  G.locations.houses.push({ x, z, door, name: 'House #' + (G.locations.houses.length + 1) });
  // mailbox
  box(door.x + (fz ? 1.6 : 0), 0, door.z + (fx ? 1.6 : 0), 0.3, 1.1, 0.3, '#4a4f5a', false);
  box(door.x + (fz ? 1.6 : 0), 1.1, door.z + (fx ? 1.6 : 0), 0.5, 0.4, 0.7, '#3fa7ff', false);
}

function residentialBlock(cx, cz) {
  const colors = ['#ffe2b8', '#cfe8ff', '#ffd6e8', '#e0ffd6', '#fff3b0', '#e6d6ff', '#ffffff', '#ffd1a8'];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) house(cx + sx * 12, cz + sz * 11, sx > 0 ? 0 : 1, pick(colors));
  addTree(cx, cz + rand(-4, 4), 'round');
  addTree(cx + rand(-3, 3), cz - 14);
  addTree(cx + rand(-3, 3), cz + 14);
}

function forestBlock(cx, cz, n = 24) {
  const placed = [];
  let tries = 0;
  while (placed.length < n && tries++ < 400) {
    const x = cx + rand(-21, 21), z = cz + rand(-21, 21);
    if (placed.some(p => Math.hypot(p[0] - x, p[1] - z) < 4.2)) continue;
    placed.push([x, z]); addTree(x, z);
  }
  flat(cx, 0.03, cz, 48, 48, '#5fae4a');
}

function downtownBlock(cx, cz) {
  const cols = ['#c9d6e3', '#e3d5c9', '#b8c4d6', '#d6c9e3', '#f0e0c0', '#aebfcf'];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const h = Math.round(rand(16, 42) / 4) * 4;
    const c = building(cx + sx * 11, cz + sz * 11, 16, 16, h, pick(cols), '#50555e');
    LOC.fireBuildings.push({ x: cx + sx * 11, z: cz + sz * 11, w: 16, d: 16, h, c });
  }
  flat(cx, 0.035, cz, 44, 44, '#cfcfcf');
}

function wedge(x, z, w, l, h, dir, color = '#ffb347', y0 = 0) {
  // triangular prism: low at -l/2, high at +l/2 along local +z, then rotated
  const g = new THREE.BufferGeometry();
  const hw = w / 2, hl = l / 2;
  const P = [
    [-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl], [hw, h, hl], [-hw, h, hl],
  ];
  const faces = [
    [0, 5, 4], [0, 4, 1],   // slope
    [3, 2, 4], [3, 4, 5],   // back (vertical)
    [0, 1, 2], [0, 2, 3],   // bottom
    [0, 3, 5],              // left side
    [1, 4, 2],              // right side
  ];
  const pos = [];
  for (const f of faces) for (const i of f) pos.push(...P[i]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  const a = dir * Math.PI / 2;
  S(g, mat(color, { side: THREE.DoubleSide }), x, y0, z, a);
  ramps.push({ x, z, w, l, h, a, y0 });
}

function trampoline(x, z) {
  S(CYL, mat('#3fa7ff'), x, 0.3, z, 0, 0, 0, 2.4, 0.6, 2.4);
  S(CYL, mat('#222'), x, 0.62, z, 0, 0, 0, 2.1, 0.05, 2.1);
  addCollider(x - 2.2, 0, z - 2.2, x + 2.2, 0.65, z + 2.2, 'tramp');
}

function bench(x, z, ry) {
  S(BOX, mat('#a0683a'), x, 0.55, z, ry, 0, 0, 2.4, 0.15, 0.7);
  S(BOX, mat('#a0683a'), x + Math.sin(ry) * -0.3, 0.95, z + Math.cos(ry) * -0.3, ry, 0, 0, 2.4, 0.6, 0.12);
  S(BOX, mat('#4a4f5a'), x, 0.25, z, ry, 0, 0, 2.2, 0.5, 0.5);
}

function umbrella(x, z, color) {
  S(CYL8, mat('#eeeeee'), x, 1.4, z, 0, 0, 0, 0.07, 2.8, 0.07);
  S(new THREE.ConeGeometry(1, 1, 8), mat(color), x, 2.9, z, 0, 0, 0, 1.8, 0.7, 1.8);
}

// ---------------------------------------------------------------- build everything
export function buildWorld() {
  const scene = G.scene;
  makeWindowTextures();

  // Terrain for the whole island
  buildHeights();
  buildTerrainMesh(scene);

  // Ocean
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: '#2f9be8', transparent: true, opacity: 0.82 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  G.water = water;

  // Roads
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture() });
  for (const r of ROADS) {
    S(PLANE, roadMat, r, 0.02, 0, 0, -Math.PI / 2, 0, 10, LAND * 2, 1);
    S(PLANE, roadMat, 0, 0.021, r, 0, -Math.PI / 2, Math.PI / 2, 10, LAND * 2, 1);
  }
  for (const a of ROADS) for (const b of ROADS) flat(a, 0.025, b, 10, 10, '#555a63');
  buildHighways(scene, roadMat);

  // Sidewalk blocks
  for (const bx of BLOCKS) for (const bz of BLOCKS) {
    flat(bx, 0.022, bz, 50, 50, '#d9d4c7');
    flat(bx, 0.028, bz, 45, 45, '#86d162');
    G.locations.sidewalks.push(
      { x: bx - 23.5, z: bz - 23.5 }, { x: bx + 23.5, z: bz - 23.5 }, { x: bx - 23.5, z: bz + 23.5 }, { x: bx + 23.5, z: bz + 23.5 });
  }

  // --- Plaza (0,0)
  flat(0, 0.035, 0, 45, 45, '#eadfc6');
  S(CYL, mat('#b9c3cf'), 0, 0.4, 0, 0, 0, 0, 5, 0.8, 5);
  S(CYL, mat('#5cc8ff'), 0, 0.72, 0, 0, 0, 0, 4.5, 0.1, 4.5);
  addCollider(-3.6, 0, -3.6, 3.6, 0.8, 3.6);
  S(CYL, mat('#b9c3cf'), 0, 2, 0, 0, 0, 0, 0.6, 3.2, 0.6);
  S(CYL, mat('#b9c3cf'), 0, 3.4, 0, 0, 0, 0, 1.8, 0.4, 1.8);
  S(new THREE.SphereGeometry(1, 10, 8), mat('#8fe0ff'), 0, 3.9, 0, 0, 0, 0, 1.2, 0.6, 1.2);
  addCollider(-0.7, 0, -0.7, 0.7, 3.6, 0.7);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    addTree(Math.cos(a) * 16, Math.sin(a) * 16, 'round', 1);
    bench(Math.cos(a + 0.4) * 11, Math.sin(a + 0.4) * 11, -a - 0.4 + Math.PI / 2);
  }
  sign('Welcome to Bobbly Town!', 0, 7, -3, '#fff', '#e05a8a', 3.2);

  // --- Pizza (60,0)
  building(70, 0, 16, 24, 8, '#fff1dc', '#d23c32');
  box(61.5, 3, 0, 1.2, 0.4, 20, '#d23c32', false);
  sign('🍕 PIZZA PLACE', 61, 10.5, 0, '#fff', '#d23c32');

  // --- Taxi depot (-60,0)
  building(-70, 0, 16, 24, 7, '#ffd84a', '#333');
  sign('🚕 TAXI DEPOT', -61, 9.5, 0, '#222', '#ffd84a');
  for (let i = -1; i <= 1; i++) flat(-46, 0.04, i * 9, 5, 8, '#f5f5f5');

  // --- Clothing (0,60)
  building(0, 70, 26, 16, 8, '#ffb0d8', '#b8467d');
  sign('👕 BOBBLY BOUTIQUE', 0, 10.5, 61, '#fff', '#e05a8a');

  // --- Dealership (0,-60)
  building(0, -72, 30, 12, 6, '#bfe6ff', '#3f6f9e');
  sign('🚗 CAR DEALER', 0, 8.5, -65, '#fff', '#3f6f9e');
  flat(0, 0.04, -52, 40, 16, '#b9bec7');

  // --- Fire station (60,60)
  building(70, 68, 22, 22, 9, '#e84a3f', '#8b2a22');
  sign('🚒 FIRE STATION', 58, 11.5, 60, '#fff', '#b8322a');
  flat(50, 0.04, 68, 10, 12, '#b9bec7');

  // --- Recycling (60,-60)
  building(74, -72, 14, 14, 6, '#9cb89c', '#4a6a4a');
  sign('♻️ RECYCLING', 74, 8.5, -64, '#fff', '#3f8a4a');
  const dz = LOC.dumpster;
  box(dz.x, 0, dz.z, dz.w, 1.8, dz.d, '#2f8a4a', true);
  S(BOX, mat('#1f5f33'), dz.x, 1.82, dz.z, 0, 0, 0, dz.w - 0.4, 0.05, dz.d - 0.4);
  sign('Throw trash here!', dz.x, 4, dz.z, '#fff', '#2f8a4a', 1.6);

  // --- Park (-60,60)
  trampoline(-72, 72); trampoline(-62, 74); trampoline(-52, 72);
  for (let i = 0; i < 8; i++) addTree(-60 + rand(-20, 20), 60 + rand(-20, -2), 'round');
  // playground tower with stairs and slide
  box(-74, 0, 48, 4, 5, 4, '#ff8a3d');
  for (let s = 0; s < 9; s++) box(-74, 0, 50 + 0.8 * (8 - s) + 0.4, 2.5, 0.55 * (s + 1), 0.8, '#ffd54a', true);
  wedge(-74, 40, 2.5, 12, 5, 0, '#3fd6d0');
  sign('PARK', -60, 6, 38, '#fff', '#46c25a', 2);

  // --- Stunt park (-60,-60)
  flat(-60, 0.036, -60, 45, 45, '#9aa0aa');
  wedge(-60, -44, 7, 12, 3, 2, '#ff8a3d');
  wedge(-60, -70, 7, 12, 3, 0, '#ff8a3d');
  wedge(-78, -60, 8, 18, 6, 1, '#ff5b6e');
  box(-44, 0, -74, 10, 3, 8, '#b46cff');
  wedge(-44, -63, 10, 14, 3, 2, '#b46cff');
  wedge(-40, -50, 4, 6, 1.5, 3, '#ffd54a');
  flat(-76, 0.05, -78, 10, 10, '#4a4f5a');
  S(CYL, mat('#ffd54a'), -76, 0.06, -78, 0, 0, 0, 3.5, 0.02, 3.5);
  sign('STUNT PARK', -60, 8, -40, '#fff', '#ff5b6e', 2.2);

  // --- Sawmill (-120,0)
  box(-130, 0, 0, 14, 0.3, 20, '#8b6b4a', true);
  for (const [px, pz] of [[-136, -9], [-124, -9], [-136, 9], [-124, 9]]) box(px, 0, pz, 0.6, 6, 0.6, '#6b4a2b');
  S(BOX, mat('#a0522d'), -130, 6.2, 0, 0, 0, 0, 15, 0.4, 21);
  S(CYL, mat('#c0c0c0'), -130, 1.6, 0, 0, Math.PI / 2, 0, 1.3, 0.1, 1.3);
  box(-130, 0.3, 0, 6, 1, 2, '#6b4a2b', true);
  const lz = LOC.logZone;
  flat(lz.x, 0.05, lz.z, lz.w, lz.d, '#ffd54a');
  flat(lz.x, 0.06, lz.z, lz.w - 1, lz.d - 1, '#c9a86b');
  sign('🪵 SAWMILL - bring logs here!', -110, 7, 0, '#fff', '#8b5a2b', 2.4);
  forestBlock(-120, -60); forestBlock(-120, -120); forestBlock(-60, -120);

  // --- Residential
  for (const [cx, cz] of [[120, -120], [120, -60], [120, 0], [120, 60], [120, 120], [-120, 60], [-120, 120], [-60, 120], [0, 120]]) residentialBlock(cx, cz);

  // --- Mansion (60,120)
  S(windowBoxGeo(18, 7, 12), bmat('#fff6e0'), 62, 3.5, 126);
  S(CONE4, mat('#6b4a8b'), 62, 8.6, 126, Math.PI / 4, 0, 0, 14, 3.4, 10);
  addCollider(53, 0, 120, 71, 7.2, 132);
  flat(62, 0.05, 108, 12, 7, '#9be0ff');
  box(62, 0, 104.2, 12.6, 0.3, 0.6, '#ffffff', false);
  box(62, 0, 111.8, 12.6, 0.3, 0.6, '#ffffff', false);
  S(BOX, mat('#7a4a2b'), 62, 1.3, 119.95, 0, 0, 0, 2, 2.6, 0.12);
  sign('🏠 DREAM HOUSE', 62, 13, 120, '#fff', '#6b4a8b', 2.4);
  S(BOX, mat('#a0683a'), LOC.wardrobe.x, 1.2, LOC.wardrobe.z, 0, 0, 0, 2, 2.4, 1);
  addCollider(LOC.wardrobe.x - 1, 0, LOC.wardrobe.z - 0.5, LOC.wardrobe.x + 1, 2.4, LOC.wardrobe.z + 0.5);

  // --- Downtown
  downtownBlock(0, -120); downtownBlock(60, -120);
  // Taller buildings next to the shop blocks
  for (const [cx, cz] of [[60, 0], [-60, 0]]) {
    const h = 14;
    const c = building(cx + (cx > 0 ? 18 : -18), cz + 18, 10, 10, h, '#d6d0e3');
    LOC.fireBuildings.push({ x: cx + (cx > 0 ? 18 : -18), z: cz + 18, w: 10, d: 10, h, c });
  }
  for (const b of [[70, 0, 16, 24, 8], [-70, 0, 16, 24, 7], [0, 70, 26, 16, 8], [70, 68, 22, 22, 9], [0, -72, 30, 12, 6]])
    LOC.fireBuildings.push({ x: b[0], z: b[1], w: b[2], d: b[3], h: b[4] });

  // --- East beach & pier
  box(207.5, -3, 0, 49, 3.4, 6, '#b88a5a', true);
  for (let x = 186; x < 232; x += 6) for (const zz of [-2.6, 2.6]) S(CYL8, mat('#7a5a3a'), x, -1.5, zz, 0, 0, 0, 0.25, 3, 0.25);
  const fm = LOC.fishMarket;
  box(fm.x, 0, fm.z + 5, 7, 3, 3, '#ffffff');
  S(BOX, mat('#3fa7ff'), fm.x, 3.2, fm.z + 4.5, 0, 0, 0, 8, 0.4, 4.5);
  flat(fm.x, 0.05, fm.z, fm.w, fm.d, '#9be0ff');
  sign('🐟 FISH MARKET', fm.x, 5.5, fm.z + 3, '#fff', '#3fa7ff', 2.2);
  sign('🎣 Fishing spot', 229, 3.5, 0, '#fff', '#3f6f9e', 1.6);
  const umb = ['#ff5b6e', '#ffd54a', '#3fa7ff', '#46c25a', '#b46cff'];
  for (let z = -160; z <= 160; z += 22) if (Math.abs(z) > 12) umbrella(172 + rand(-3, 3), z, pick(umb));
  for (let x = -160; x <= 160; x += 22) umbrella(x, -172 + rand(-3, 3), pick(umb));
  for (let z = -170; z <= 170; z += 18) addTree(-172 + rand(-4, 4), z, 'pine');
  for (let x = -170; x <= 170; x += 20) addTree(x + rand(-3, 3), 182, 'round');

  // --- Airport (north edge)
  flat(0, 0.03, 168, 304, 16, '#3a3e46');
  for (let x = -145; x <= 145; x += 10) flat(x, 0.035, 168, 5, 0.6, '#ffffff');
  for (const zz of [161, 175]) flat(0, 0.035, zz, 300, 0.4, '#ffd54a');
  for (let i = 0; i < 6; i++) flat(-147, 0.035, 162.5 + i * 2.2, 3, 1, '#ffffff');
  S(CYL, mat('#e8e2d4'), -165, 5, 179, 0, 0, 0, 1.6, 10, 1.6);
  S(BOX, mat('#bfe6ff'), -165, 11, 179, 0, 0, 0, 5, 2, 5);
  S(BOX, mat('#4a4f5a'), -165, 12.2, 179, 0, 0, 0, 5.6, 0.4, 5.6);
  addCollider(-167.5, 0, 176.5, -162.5, 12.4, 181.5);
  sign('✈️ BOBBLY AIRPORT', -135, 7, 178, '#fff', '#3f6f9e', 2.6);

  // --- Blaster shop (stunt park corner)
  building(-78, -44, 10, 8, 5, '#b46cff', '#5a2b8b');
  sign('🔫 BLASTER SHOP', -72.5, 7.5, -44, '#fff', '#8b3fd6', 2.2);

  // Lighthouse
  for (let i = 0; i < 6; i++) S(CYL, mat(i % 2 ? '#ffffff' : '#e84a3f'), 172, i * 4 + 2, -172, 0, 0, 0, 3 - i * 0.15, 4, 3 - i * 0.15);
  S(CYL, mat('#ffe27a', { emissive: '#ffcc33', emissiveIntensity: 0.6 }), 172, 25.5, -172, 0, 0, 0, 2, 3, 2);
  S(new THREE.ConeGeometry(1, 1, 16), mat('#e84a3f'), 172, 28, -172, 0, 0, 0, 2.6, 2.5, 2.6);
  addCollider(169.5, 0, -174.5, 174.5, 24, -169.5);

  // Scatter roadside trees in free edge strips
  for (let i = 0; i < 16; i++) addTree(rand(-168, -156), rand(-150, 150));

  buildLandmarks();
  buildWilderness();
  buildTrees();
  buildLamps();
  finalizeStatic();

  // Clouds
  G.clouds = [];
  const cm = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.25 });
  for (let i = 0; i < 60; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rand(4, 8), 8, 6), cm);
      s.position.set(rand(-8, 8), rand(-1, 2), rand(-4, 4));
      cl.add(s);
    }
    cl.position.set(rand(-WORLD, WORLD), rand(90, 170), rand(-WORLD, WORLD));
    cl.scale.setScalar(rand(1, 2.2));
    scene.add(cl);
    G.clouds.push(cl);
  }
}

// ---------------------------------------------------------------- lighting / day-night
let sun, hemi, amb;
const skyDay = new THREE.Color('#8fd3ff'), skyDusk = new THREE.Color('#ff9f7a'), skyNight = new THREE.Color('#1b2350');
const tmpC = new THREE.Color();
export function buildLights() {
  hemi = new THREE.HemisphereLight('#ffffff', '#6a8a5a', 0.9);
  amb = new THREE.AmbientLight('#ffffff', 0.25);
  sun = new THREE.DirectionalLight('#fff4dd', 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 260;
  sun.shadow.bias = -0.0008;
  G.scene.add(hemi, amb, sun, sun.target);
  G.scene.fog = new THREE.Fog('#8fd3ff', 250, 1500);
}

export function updateWorld(dt, focus) {
  G.dayTime = (G.dayTime + dt / 720) % 1; // 12 minute day
  const a = (G.dayTime - 0.25) * Math.PI * 2;
  const elev = Math.sin(a);
  const day = clamp(elev * 2.5 + 0.35, 0, 1);
  const dusk = clamp(1 - Math.abs(elev) * 4, 0, 1);
  tmpC.copy(skyNight).lerp(skyDay, day).lerp(skyDusk, dusk * 0.5);
  G.scene.background = tmpC.clone();
  G.scene.fog.color.copy(tmpC);
  sun.intensity = 0.25 + 1.4 * day;
  hemi.intensity = 0.45 + 0.5 * day;
  sun.color.setRGB(1, lerp(0.75, 0.96, day), lerp(0.6, 0.87, day));
  const sd = new THREE.Vector3(Math.cos(a) * 0.8, Math.max(0.35, Math.abs(elev)), 0.45).normalize();
  sun.position.copy(focus).addScaledVector(sd, 120);
  sun.target.position.copy(focus);
  const night = clamp(1 - day * 1.4, 0, 1);
  for (const m of nightMats) m.emissiveIntensity = night * 0.9;
  if (bulbMat) bulbMat.color.setRGB(lerp(0.9, 1, night), lerp(0.9, 0.9, night), lerp(0.9, 0.5, night));
  G.night = night;
  for (const c of G.clouds) { c.position.x += dt * 2; if (c.position.x > WORLD + 100) c.position.x = -WORLD - 100; }
}
