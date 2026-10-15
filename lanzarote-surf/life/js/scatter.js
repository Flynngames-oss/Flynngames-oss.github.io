// The ground cover of real Lanzarote, filled in around you as you move (only what's near is ever drawn):
//  - malpaís: jagged black and rusty lava rocks where the old lava flows are (dark on the island map)
//  - loose volcanic stones everywhere else, and bare scree on steep slopes
//  - tabaiba and aulaga: low round grey-green and straw-coloured shrubs, the island's typical bushes
//  - La Geria and Masdache: vines planted in pits dug through the black picón, each sheltered from the
//    trade wind by a curved dry-stone wall (zoco)
import * as THREE from 'three';
import { G } from './state.js';
import { heightAt, groundColor, flatAmount, dataHeight, ll2w } from './terrain.js';
import { PLACES } from './world.js';
import { PH } from './photos.js';

const R_NEAR = 150, CELL = 7;           // rocks and bushes
const R_GERIA = 260, GSTEP = 9;         // vineyard pits
const MAX_ROCK = 3200, MAX_BUSH = 1400, MAX_ZOCO = 2600;
let rocks, bushes, zocoWall, zocoVine, last = null;
let GERIA = [];

function hash(i, j, k = 0) { let h = (i * 374761393 + j * 668265263 + k * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// a jagged lump of lava: an icosahedron pushed in and out by noise, flattened a little
function rockGeo() {
  // clinker lava is all sharp points and holes: several layers of noise on a fine sphere
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n1 = Math.sin(v.x * 4.1 + 1.3) * Math.cos(v.y * 3.3 - 0.7) * Math.sin(v.z * 3.7 + 2.1);
    const n2 = Math.sin(v.x * 13.7 + v.y * 9.1) * Math.cos(v.z * 11.3 - v.x * 5.2);
    const n3 = Math.sin(v.x * 31 + v.z * 23) * Math.sin(v.y * 27 - v.z * 19);
    v.multiplyScalar(0.72 + 0.3 * Math.abs(n1) + 0.14 * n2 + 0.07 * n3);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function bushGeo() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.85 + 0.25 * Math.abs(Math.sin(v.x * 9 + v.y * 7) * Math.cos(v.z * 8)));
    if (v.y < 0) v.y *= 0.3;
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y + 0.1, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// a crescent of piled stones, open on the downwind (south-west) side, about 4 m across and 0.8 m high
function zocoGeo() {
  const parts = [], A0 = -0.25 * Math.PI, A1 = 1.25 * Math.PI, N = 24;
  const pos = [], idx = [];
  const ring = (r, y) => { const out = []; for (let i = 0; i <= N; i++) { const a = A0 + (A1 - A0) * i / N, j = 1 + 0.06 * Math.sin(i * 2.7); out.push([Math.cos(a) * r * j, y, Math.sin(a) * r * j]); } return out; };
  const rings = [ring(2.25, -0.1), ring(2.15, 0.55), ring(1.95, 0.8), ring(1.7, 0.55), ring(1.6, -0.1)];
  for (const r of rings) for (const q of r) pos.push(...q);
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < N; i++) { const a = k * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  void parts;
  return g;
}
function stoneTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#4a4440'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) { const v = 40 + Math.random() * 70 | 0; x.fillStyle = `rgb(${v + 8},${v},${v - 6})`; x.beginPath(); x.ellipse(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 7, 2 + Math.random() * 5, Math.random() * 3, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function initScatter() {
  const rockM = new THREE.MeshStandardMaterial({ color: '#ffffff', map: PH.rock || null, roughness: 1, envMapIntensity: 0.25 });
  rocks = new THREE.InstancedMesh(rockGeo(), rockM, MAX_ROCK);
  rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ROCK * 3), 3);
  const bushM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  bushes = new THREE.InstancedMesh(bushGeo(), bushM, MAX_BUSH);
  bushes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUSH * 3), 3);
  const wallM = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95, side: THREE.DoubleSide });
  wallM.map.repeat.set(4, 1);
  const zg = zocoGeo();
  const uv = new Float32Array(zg.attributes.position.count * 2);
  for (let i = 0; i < zg.attributes.position.count; i++) { const px = zg.attributes.position.getX(i), pz = zg.attributes.position.getZ(i), py = zg.attributes.position.getY(i); uv[i * 2] = Math.atan2(pz, px) * 0.6; uv[i * 2 + 1] = py * 1.2 + Math.hypot(px, pz) * 0.2; }
  zg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  zocoWall = new THREE.InstancedMesh(zg, wallM, MAX_ZOCO);
  zocoVine = new THREE.InstancedMesh(bushGeo(), new THREE.MeshStandardMaterial({ color: '#5f7d2a', roughness: 0.85 }), MAX_ZOCO);
  for (const m of [rocks, bushes, zocoWall, zocoVine]) { m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = m !== zocoVine; G.scene.add(m); }
  // the vineyard areas: La Geria (between Uga and Masdache) and the Masdache / Tinajo picón fields
  GERIA = [
    { c: ll2w(28.982, -13.715), rx: 3600, rz: 1500 },
    { c: ll2w(28.990, -13.665), rx: 1700, rz: 1000 },
    { c: ll2w(29.035, -13.655), rx: 1100, rz: 900 },
  ];
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _k = new THREE.Color();
const inGeria = (x, z) => { for (const g of GERIA) { const dx = (x - g.c.x) / g.rx, dz = (z - g.c.z) / g.rz; if (dx * dx + dz * dz < 1) return true; } return false; };
function inTown(x, z) {
  for (const k in PLACES) { const p = PLACES[k]; if (p.r && Math.hypot(x - p.x, z - p.z) < p.r * 0.9) return true; }
  return Math.abs(x) < 900 && Math.abs(z) < 900;
}

function rebuild(cx, cz) {
  let nr = 0, nb = 0, nz = 0;
  const i0 = Math.floor((cx - R_NEAR) / CELL), i1 = Math.floor((cx + R_NEAR) / CELL), j0 = Math.floor((cz - R_NEAR) / CELL), j1 = Math.floor((cz + R_NEAR) / CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const r0 = hash(i, j);
    const x = (i + hash(i, j, 1)) * CELL, z = (j + hash(i, j, 2)) * CELL;
    if ((x - cx) ** 2 + (z - cz) ** 2 > R_NEAR * R_NEAR) continue;
    const d = dataHeight(x, z);
    if (d < 1.2) continue;
    const y = heightAt(x, z);
    if (flatAmount() > 0.15) continue;                      // roads, runways, town squares
    if (inTown(x, z) && r0 > 0.15) continue;
    groundColor(x, z, y, _c);
    const lum = _c.r * 0.3 + _c.g * 0.59 + _c.b * 0.11;      // (linear colour)
    const sandy = lum > 0.38;
    const geria = inGeria(x, z);
    const lava = lum < 0.05 && !geria;
    // rocks: lots on the lava, a few everywhere else, none on the sand
    const nRock = sandy ? (r0 < 0.04 ? 1 : 0) : lava ? 2 + Math.floor(r0 * 3) : geria ? 0 : r0 < 0.35 ? 1 : 0;
    for (let k = 0; k < nRock && nr < MAX_ROCK; k++) {
      const a = hash(i, j, 3 + k), b = hash(i, j, 7 + k);
      const px = x + (a - 0.5) * CELL, pz = z + (b - 0.5) * CELL, py = heightAt(px, pz);
      const s = lava ? 0.35 + Math.pow(hash(i, j, 11 + k), 2) * 1.6 : 0.15 + hash(i, j, 11 + k) * 0.45;
      _q.setFromEuler(_e.set(a * 6, b * 6, (a - b) * 2));
      _m.compose(_p.set(px, py + s * 0.12, pz), _q, _s.set(s * (0.8 + a * 0.6), s, s * (0.8 + b * 0.6)));
      rocks.setMatrixAt(nr, _m);
      const rust = lava && hash(i, j, 19 + k) < 0.2;
      _k.setRGB(rust ? 0.075 : 0.032, rust ? 0.036 : 0.029, rust ? 0.022 : 0.027).multiplyScalar((0.7 + a * 0.6) * (PH.rock ? 3.6 : 1));
      if (!lava) _k.lerp(_c.multiplyScalar(PH.rock ? 3.2 : 1), 0.35);
      rocks.setColorAt(nr, _k);
      nr++;
    }
    // bushes: tabaiba (grey-green) and aulaga (dry straw), never on the lava or in the vineyards
    if (!lava && !geria && nb < MAX_BUSH && r0 > 0.82) {
      const s = 0.35 + hash(i, j, 23) * 0.6, aul = hash(i, j, 29) < 0.35;
      _q.setFromEuler(_e.set(0, r0 * 30, 0));
      _m.compose(_p.set(x, y - 0.05, z), _q, _s.set(s * 1.1, s, s * 1.1));
      bushes.setMatrixAt(nb, _m);
      _k.set(aul ? '#a89a6a' : sandy ? '#8f9a5a' : '#6f7f45').multiplyScalar(0.8 + hash(i, j, 31) * 0.4);
      bushes.setColorAt(nb, _k);
      nb++;
    }
  }
  // La Geria: a pit and a crescent wall every ~9 m, on a jittered grid, the open side away from the north-east trade wind
  if (GERIA.some((g) => Math.hypot(cx - g.c.x, cz - g.c.z) < Math.max(g.rx, g.rz) + R_GERIA)) {
    const a0 = Math.floor((cx - R_GERIA) / GSTEP), a1 = Math.floor((cx + R_GERIA) / GSTEP), b0 = Math.floor((cz - R_GERIA) / GSTEP), b1 = Math.floor((cz + R_GERIA) / GSTEP);
    for (let j = b0; j <= b1 && nz < MAX_ZOCO; j++) for (let i = a0; i <= a1 && nz < MAX_ZOCO; i++) {
      const x = (i + 0.5 + (hash(i, j, 41) - 0.5) * 0.35) * GSTEP + (j % 2) * GSTEP * 0.5, z = (j + 0.5 + (hash(i, j, 43) - 0.5) * 0.35) * GSTEP;
      if ((x - cx) ** 2 + (z - cz) ** 2 > R_GERIA * R_GERIA || !inGeria(x, z)) continue;
      if (dataHeight(x, z) < 2) continue;
      const y = heightAt(x, z);
      if (flatAmount() > 0.1 || hash(i, j, 47) < 0.12) continue;
      const s = 0.85 + hash(i, j, 53) * 0.35;
      _q.setFromEuler(_e.set(0, -Math.PI * 0.25 + (hash(i, j, 59) - 0.5) * 0.5, 0));
      _m.compose(_p.set(x, y - 0.25, z), _q, _s.set(s, s, s));
      zocoWall.setMatrixAt(nz, _m);
      _q.setFromEuler(_e.set(0, hash(i, j, 61) * 6, 0));
      _m.compose(_p.set(x - 0.15, y - 0.15, z + 0.15), _q, _s.set(1.05 * s, 0.8 * s, 1.05 * s));
      zocoVine.setMatrixAt(nz, _m);
      nz++;
    }
  }
  rocks.count = nr; bushes.count = nb; zocoWall.count = nz; zocoVine.count = nz;
  for (const m of [rocks, bushes, zocoWall, zocoVine]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

let busy = 0;
export function updateScatter(dt) {
  if (!rocks) return;
  const c = G.camera.position;
  busy -= dt;
  // nothing to see from high up in a plane (and no point rebuilding)
  const vis = c.y - Math.max(0, heightAt(c.x, c.z)) < 220;
  rocks.visible = bushes.visible = zocoWall.visible = zocoVine.visible = vis;
  if (!vis) return;
  if (!last || (Math.hypot(c.x - last.x, c.z - last.z) > 25 && busy <= 0)) { last = { x: c.x, z: c.z }; busy = 0.25; rebuild(c.x, c.z); }
}
