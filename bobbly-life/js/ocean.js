// Coral Bay: the deep reef lagoon east of Bobbly Town, and everything that makes being underwater feel real.
//  - reef: branching / brain / fan corals, tube sponges, anemones, swaying sea grass and kelp, rocks,
//    starfish and urchins (all instanced, so thousands of them are cheap)
//  - life: fish schools that swirl and dart away from you, sea turtles, glowing jellyfish, a dolphin pod
//    that leaps out of the water, sharks and a giant humpback whale that surfaces to blow
//  - a broken sunken galleon and an underwater cave, with treasure chests to find
//  - looking: fog that gets darker and bluer the deeper you go, light rays from the surface, moving
//    caustics on the sand, drifting particles, bubbles, a wobbly blurred view and muffled sound
//  - breathing: an oxygen bar (25 s on one breath, 4 minutes with scuba gear)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, WATER_Y, clamp, lerp, addMoney, textSprite, mergeStatic } from './state.js';
import { heightAt, BAY, fbm } from './terrain.js';
import { addCollider, LOC, getLights, baseHeight } from './world.js';
import { sfx, setUnderwater, ambience, whaleCall } from './audio.js';

const CX = (BAY.x0 + BAY.x1) / 2, CZ = (BAY.z0 + BAY.z1) / 2;
const U = { uTime: { value: 0 } };
const ocean = { group: new THREE.Group(), fish: null, schools: [], turtles: [], jellies: [], dolphins: [], sharks: [], whale: null, chests: [] };
G.ocean = ocean;

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const R = rng(424242);
const rr = (a, b) => a + R() * (b - a);
const floorAt = (x, z) => heightAt(x, z);
const inBay = (x, z, m = 0) => x > BAY.x0 + m && x < BAY.x1 - m && z > BAY.z0 + m && z < BAY.z1 - m;

// ---------------------------------------------------------------- materials
// Plants and soft corals sway with the current (done on the GPU)
function swayMat(params, amp, freq = 1.2) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float hh = max(position.y, 0.0);
        transformed.x += sin(uTime * ${freq.toFixed(2)} + ip.x * 0.37 + ip.z * 0.23 + hh * 0.9) * ${amp.toFixed(3)} * hh * hh;
        transformed.z += cos(uTime * ${(freq * 0.8).toFixed(2)} + ip.x * 0.21 - ip.z * 0.31 + hh * 0.7) * ${(amp * 0.6).toFixed(3)} * hh * hh;
      }`);
  };
  m.customProgramCacheKey = () => 'sway' + amp + '_' + freq;
  return m;
}
const stdMat = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0 }, o));

// Plain geometry with just position + normal (+ optional color) so different shapes can be merged
function clean(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (color) {
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return g;
}
function xf(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m); return g;
}
// bend a lump by noise so rocks and corals aren't perfect shapes
function lumpy(g, amt, seed) {
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 - seed) + Math.sin(v.y * 4.3 + seed * 2) * 0.5;
    v.multiplyScalar(1 + n * amt);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- coral & plant shapes
function staghorn(seed) {
  const r = rng(seed), parts = [];
  const grow = (x, y, z, dir, len, rad, depth) => {
    const end = new THREE.Vector3(x, y, z).addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(x, y, z);
    parts.push(clean(g));
    if (depth <= 0) { const tip = new THREE.SphereGeometry(rad * 0.72, 5, 3); tip.translate(end.x, end.y, end.z); parts.push(clean(tip)); }
    if (depth <= 0) return;
    const n = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3(r() - 0.5, r() * 0.4, r() - 0.5).multiplyScalar(1.3)).normalize();
      if (d.y < 0.25) { d.y = 0.25; d.normalize(); }
      grow(end.x, end.y, end.z, d, len * (0.6 + r() * 0.25), rad * 0.72, depth - 1);
    }
  };
  for (let i = 0; i < 3; i++) grow((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3, new THREE.Vector3(r() - 0.5, 1.6, r() - 0.5).normalize(), 0.5, 0.075, 2);
  return mergeGeometries(parts);
}
function brainCoral() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ridge = Math.sin(v.x * 13 + Math.sin(v.z * 9) * 2.2) * Math.cos(v.z * 12 + Math.sin(v.y * 7) * 2) * 0.05;
    v.multiplyScalar(1 + ridge);
    v.y = Math.max(v.y * 0.62, -0.12);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return clean(g);
}
function tubeSponge(seed) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.5 + r() * 0.9, rad = 0.09 + r() * 0.07;
    const g = new THREE.CylinderGeometry(rad, rad * 0.8, h, 9, 1, true);
    g.translate(0, h / 2, 0);
    xf(g, { x: (r() - 0.5) * 0.4, z: (r() - 0.5) * 0.4, rx: (r() - 0.5) * 0.35, rz: (r() - 0.5) * 0.35 });
    parts.push(clean(g));
  }
  return mergeGeometries(parts);
}
function anemone(seed) {
  const r = rng(seed), parts = [clean(xf(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 10), { y: 0.08 }))];
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2, d = r() * 0.2;
    const g = new THREE.ConeGeometry(0.03, 0.32 + r() * 0.12, 3);
    g.translate(0, 0.17, 0);
    xf(g, { x: Math.cos(a) * d, y: 0.14, z: Math.sin(a) * d, rx: Math.sin(a) * d * 2.2, rz: -Math.cos(a) * d * 2.2 });
    parts.push(clean(g));
  }
  return mergeGeometries(parts);
}
function grassClump(seed) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.PlaneGeometry(0.07, 1, 1, 4);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k) + 0.5; p.setX(k, p.getX(k) * (1 - y * 0.7)); p.setY(k, y); }
    xf(g, { x: (r() - 0.5) * 0.3, z: (r() - 0.5) * 0.3, ry: r() * Math.PI, rx: (r() - 0.5) * 0.3, sy: 0.6 + r() * 0.6 });
    parts.push(clean(g));
  }
  return mergeGeometries(parts);
}
function kelpBlade() {
  const parts = [];
  for (let k = 0; k < 2; k++) {
    const g = new THREE.PlaneGeometry(0.42, 1, 1, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5;
      p.setX(i, p.getX(i) * (0.55 + 0.45 * Math.sin(y * Math.PI)) + Math.sin(y * 9) * 0.04);
      p.setY(i, y);
    }
    g.rotateY(k * Math.PI / 2);
    parts.push(clean(g));
  }
  return mergeGeometries(parts);
}
function starfish() {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, rad = i % 2 ? 0.07 : 0.2; i ? s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return clean(g);
}
function urchin() {
  const parts = [clean(new THREE.SphereGeometry(0.12, 8, 6))];
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const d = new THREE.Vector3(r() - 0.5, r() * 0.9 - 0.15, r() - 0.5).normalize();
    const g = new THREE.ConeGeometry(0.012, 0.28, 3); g.translate(0, 0.14, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    parts.push(clean(g));
  }
  return mergeGeometries(parts);
}
function fanTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d'); x.strokeStyle = '#fff'; x.lineCap = 'round';
  const r = rng(5);
  const branch = (px, py, a, len, w, d) => {
    const ex = px + Math.cos(a) * len, ey = py - Math.sin(a) * len;
    x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    if (d > 0) for (let i = 0; i < 2; i++) branch(ex, ey, a + (i ? 0.35 : -0.35) + (r() - 0.5) * 0.3, len * 0.78, w * 0.75, d - 1);
  };
  for (let i = 0; i < 5; i++) branch(128, 250, Math.PI / 2 + (i - 2) * 0.32, 52, 6, 6);
  // the fine net between the branches
  x.globalAlpha = 0.55; x.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) { const a = Math.PI * (0.08 + r() * 0.84), d1 = 30 + r() * 190; x.beginPath(); x.moveTo(128 + Math.cos(a) * d1, 250 - Math.sin(a) * d1); x.lineTo(128 + Math.cos(a + 0.12) * (d1 + 12), 250 - Math.sin(a + 0.12) * (d1 + 12)); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function rockGeo(seed) { return clean(lumpy(new THREE.DodecahedronGeometry(1, 1), 0.18, seed)); }

// ---------------------------------------------------------------- the reef
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
function instanced(geo, material, list) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, material, list.length);
  list.forEach((it, i) => {
    _e.set(it.rx || 0, it.ry || 0, it.rz || 0); _q.setFromEuler(_e);
    _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s));
    im.setMatrixAt(i, _m);
    if (it.c) im.setColorAt(i, _c.set(it.c));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  (list.small ? ocean.detail : ocean.group).add(im);
  return im;
}
const pickC = (a) => a[Math.floor(R() * a.length)];
function reefNoise(x, z) { return fbm(x / 26 + 3, z / 26 - 9, 3); }
function kelpZone(x, z) { return Math.hypot(x - 255, z - 105) < 62 || Math.hypot(x - 470, z + 120) < 38; }

function buildReef() {
  const L = { stag: [[], [], []], brain: [], fan: [], tube: [], anem: [], grass: [], kelp: [], rock: [], star: [], urchin: [] };
  for (let x = BAY.x0 + 8; x < BAY.x1 - 3; x += 2.2) for (let z = BAY.z0 + 3; z < BAY.z1 - 3; z += 2.2) {
    const px = x + rr(-1, 1), pz = z + rr(-1, 1);
    if (Math.abs(pz) < 5 && px < 236) continue;                      // keep the pier clear
    const h = floorAt(px, pz), d = WATER_Y - h;
    if (d < 1.4) continue;
    const n = reefNoise(px, pz), ry = R() * Math.PI * 2;
    if (kelpZone(px, pz) && d > 5) { if (R() < 0.42) L.kelp.push({ x: px, y: h - 0.2, z: pz, sx: rr(0.8, 1.3), sy: Math.min(d - 1.5, rr(6, 15)), sz: 1, ry }); continue; }
    if (d < 7 && n < 0.26) { if (R() < 0.55) L.grass.push({ x: px, y: h, z: pz, s: rr(0.6, 1.3), ry, c: pickC(['#4f8a3a', '#5f9a42', '#3f7a3a', '#6a9a4a']) }); continue; }
    if (n > 0.245 && d < 30) {
      const dens = clamp((n - 0.245) * 7, 0.2, 0.9) * (d > 22 ? 0.4 : 1);
      if (R() > dens) continue;
      const k = R(), tilt = { rx: rr(-0.15, 0.15), rz: rr(-0.15, 0.15) };
      if (k < 0.3) L.stag[Math.floor(R() * 3)].push({ x: px, y: h - 0.1, z: pz, s: rr(1.2, 2.6), ry, ...tilt, c: pickC(['#ff7f6a', '#ffa64d', '#c77dff', '#f2e3c6', '#5fd3c7', '#ff5f8f']) });
      else if (k < 0.5) L.brain.push({ x: px, y: h, z: pz, s: rr(0.5, 1.4), ry, c: pickC(['#d9a15c', '#a8d36a', '#e489b0', '#c9b27a', '#8fc6d0']) });
      else if (k < 0.64) L.fan.push({ x: px, y: h - 0.1, z: pz, s: rr(0.8, 1.9), ry, rx: rr(-0.1, 0.1), c: pickC(['#b04aff', '#ff4a6a', '#ff8a2a', '#ffd04a']) });
      else if (k < 0.78) L.tube.push({ x: px, y: h - 0.1, z: pz, s: rr(0.8, 1.7), ry, c: pickC(['#ffc83a', '#b45cff', '#ff7a45', '#4ad9ff']) });
      else if (k < 0.9) L.anem.push({ x: px, y: h, z: pz, s: rr(0.8, 1.6), ry, c: pickC(['#ff7ab8', '#9be05a', '#ffb24a', '#7ad8ff']) });
      else L.urchin.push({ x: px, y: h + 0.05, z: pz, s: rr(0.8, 1.3), ry, c: pickC(['#2a1a3a', '#3a1a2a', '#1a1a2a']) });
      continue;
    }
    if (R() < 0.05) L.rock.push({ x: px, y: h - 0.2, z: pz, sx: rr(0.4, 1.6), sy: rr(0.3, 1.0), sz: rr(0.4, 1.6), ry, c: pickC(['#7d756a', '#6a6660', '#8a8070', '#5f6a66']) });
    else if (R() < 0.025) L.star.push({ x: px, y: h + 0.03, z: pz, s: rr(0.7, 1.4), ry, rx: rr(-0.1, 0.1), c: pickC(['#ff6a2a', '#e8322a', '#b44aff', '#ffb02a']) });
  }
  // big boulders (solid)
  for (let i = 0; i < 26; i++) {
    const x = rr(BAY.x0 + 40, BAY.x1 - 20), z = rr(BAY.z0 + 20, BAY.z1 - 20);
    if (x < 245 && Math.abs(z) < 20) continue;
    const h = floorAt(x, z), s = rr(1.8, 4.5);
    if (WATER_Y - h < s + 2) continue;
    L.rock.push({ x, y: h + s * 0.15, z, sx: s * rr(0.9, 1.3), sy: s * rr(0.6, 0.9), sz: s * rr(0.9, 1.3), ry: R() * 6, c: pickC(['#6f6a62', '#5f5a55', '#7a7266']) });
    addCollider(x - s * 0.8, h - 1, z - s * 0.8, x + s * 0.8, h + s * 0.85, z + s * 0.8);
  }
  for (const k of ['grass', 'star', 'urchin', 'anem', 'tube']) L[k].small = true;
  for (const l of L.stag) l.small = true;
  const coralMat = stdMat({ roughness: 0.75 });
  L.stag.forEach((list, i) => list.length && instanced(staghorn(100 + i * 31), coralMat, list));
  instanced(brainCoral(), stdMat({ roughness: 0.9 }), L.brain);
  const fanG = new THREE.PlaneGeometry(1.6, 1.6); fanG.translate(0, 0.8, 0);
  instanced(fanG, swayMat({ map: fanTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }, 0.05, 0.9), L.fan);
  instanced(tubeSponge(9), stdMat({ side: THREE.DoubleSide, roughness: 0.95 }), L.tube);
  instanced(anemone(4), swayMat({ roughness: 0.6, emissive: '#221122', emissiveIntensity: 0.3 }, 0.35, 2.0), L.anem);
  instanced(grassClump(3), swayMat({ side: THREE.DoubleSide, roughness: 0.9 }, 0.12, 1.4), L.grass);
  instanced(kelpBlade(), swayMat({ color: '#a39a44', emissive: '#262408', side: THREE.DoubleSide, roughness: 0.85 }, 0.025, 0.7), L.kelp);
  instanced(rockGeo(1), stdMat({ roughness: 1 }), L.rock);
  instanced(starfish(), stdMat({ roughness: 0.7 }), L.star);
  instanced(urchin(), stdMat({ roughness: 0.5 }), L.urchin);
  ocean.counts = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, Array.isArray(v[0]) ? v.reduce((a, b) => a + b.length, 0) : v.length]));
}

// ---------------------------------------------------------------- fish schools
const SPECIES = [
  { n: 80, size: 0.24, col: ['#cfd8e2', '#b8c4d0'], speed: 2.4, rad: 7 },     // sardines
  { n: 60, size: 0.22, col: ['#9fd0ff', '#7fb8f0'], speed: 2.2, rad: 6 },     // blue chromis
  { n: 28, size: 0.42, col: ['#ffd21f', '#ffc800'], speed: 1.5, rad: 4 },     // yellow tang
  { n: 26, size: 0.46, col: ['#2f6bff', '#3f7aff'], speed: 1.6, rad: 4 },     // blue tang
  { n: 18, size: 0.32, col: ['#ff7a1a', '#ff8a2a'], speed: 1.1, rad: 2.5 },   // clownfish
  { n: 18, size: 0.7, col: ['#3fd29a', '#2fc0c8'], speed: 1.3, rad: 5 },      // parrotfish
  { n: 24, size: 0.4, col: ['#ff6fa8', '#ff4f8f'], speed: 1.5, rad: 4 },      // pink wrasse
  { n: 20, size: 0.55, col: ['#e8e0c8', '#d8c8a0'], speed: 1.8, rad: 5 },     // snapper
  { n: 70, size: 0.26, col: ['#d0e0ec', '#c0d0dc'], speed: 2.6, rad: 8 },     // second sardine ball
  { n: 22, size: 0.38, col: ['#ffb02a', '#ff9a1a'], speed: 1.4, rad: 4 },
];
function fishGeometry() {
  const body = new THREE.SphereGeometry(0.5, 10, 7); body.scale(0.3, 0.52, 1);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.4, 0, 0.34, -0.82, 0, -0.34, -0.82], 3));
  tail.computeVertexNormals();
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.2, 0.15, 0, 0.42, -0.12, 0, 0.2, -0.3], 3));
  fin.computeVertexNormals();
  const g = mergeGeometries([clean(body), clean(tail), clean(fin)]);
  // darker back, pale belly, dark eye spots
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i), x = p.getX(i);
    let v = 0.62 + 0.45 * clamp(-y * 2.2 + 0.4, 0, 1);
    if (z > 0.3 && z < 0.36 && Math.abs(y - 0.06) < 0.07 && Math.abs(x) > 0.1) v = 0.08;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.min(1, v);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function buildFish() {
  const total = SPECIES.reduce((a, s) => a + s.n, 0);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.25, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = uTime * 13.0 + float(gl_InstanceID) * 1.37;
      transformed.x += sin(ph - position.z * 3.0) * 0.16 * smoothstep(0.25, -0.85, position.z);`);
  };
  m.customProgramCacheKey = () => 'fishwiggle';
  const im = new THREE.InstancedMesh(fishGeometry(), m, total);
  im.frustumCulled = false;
  let idx = 0;
  // schools live over the reef patches
  const homes = [];
  for (let tries = 0; homes.length < SPECIES.length && tries < 4000; tries++) {
    const x = rr(BAY.x0 + 35, BAY.x1 - 25), z = rr(BAY.z0 + 25, BAY.z1 - 25);
    if (reefNoise(x, z) < 0.26 || WATER_Y - floorAt(x, z) < 6) continue;
    if (homes.some(h => Math.hypot(h.x - x, h.z - z) < 45)) continue;
    homes.push({ x, z });
  }
  while (homes.length < SPECIES.length) homes.push({ x: rr(260, 470), z: rr(-130, 130) });
  SPECIES.forEach((sp, si) => {
    const school = { sp, home: homes[si], fish: [], a: R() * 6, w1: rr(0.025, 0.05) * (R() < 0.5 ? -1 : 1), R1: rr(12, 30), R2: rr(10, 26), dph: R() * 6, pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    for (let i = 0; i < sp.n; i++) {
      const u = R() * 2 - 1, a = R() * Math.PI * 2, rad = sp.rad * Math.cbrt(R());
      school.fish.push({ i: idx, off: new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(a) * rad, u * rad * 0.45, Math.sqrt(1 - u * u) * Math.sin(a) * rad), avoid: new THREE.Vector3(), s: sp.size * rr(0.8, 1.2), p: new THREE.Vector3(), ph: R() * 6 });
      im.setColorAt(idx, _c.set(sp.col[i % sp.col.length]).offsetHSL(rr(-0.02, 0.02), 0, rr(-0.06, 0.06)));
      idx++;
    }
    ocean.schools.push(school);
  });
  im.instanceColor.needsUpdate = true;
  ocean.group.add(im);
  ocean.fish = im;
}
const _f = new THREE.Vector3(), _g = new THREE.Vector3();
function updateFish(dt, t, focus) {
  const im = ocean.fish;
  for (const sc of ocean.schools) {
    sc.a += sc.w1 * dt * sc.sp.speed;
    const hx = sc.home.x + Math.cos(sc.a) * sc.R1, hz = sc.home.z + Math.sin(sc.a * 1.3 + sc.dph) * sc.R2;
    const fl = floorAt(hx, hz);
    const hy = lerp(fl + 2.2, WATER_Y - 1.6, 0.25 + 0.2 * Math.sin(t * 0.07 + sc.dph));
    _f.set(hx, hy, hz);
    if (sc.pos.lengthSq() === 0) sc.pos.copy(_f);
    sc.vel.subVectors(_f, sc.pos).multiplyScalar(1 / Math.max(dt, 1e-3));
    sc.pos.copy(_f);
    const sp = sc.vel.length();
    const swirl = t * 0.25 * (sc.w1 > 0 ? 1 : -1);
    const cs = Math.cos(swirl), sn = Math.sin(swirl);
    for (const f of sc.fish) {
      const ox = f.off.x * cs - f.off.z * sn, oz = f.off.x * sn + f.off.z * cs;
      const prevX = f.p.x, prevY = f.p.y, prevZ = f.p.z;
      _g.set(sc.pos.x + ox + Math.sin(t * 0.9 + f.ph) * 0.4, sc.pos.y + f.off.y + Math.sin(t * 0.7 + f.ph * 2) * 0.25, sc.pos.z + oz + Math.cos(t * 0.8 + f.ph) * 0.4);
      // dart away from divers and the submarine
      const dx = _g.x - focus.x, dy = _g.y - focus.y, dz = _g.z - focus.z, d = Math.hypot(dx, dy, dz);
      if (d < 6 && d > 0.01) f.avoid.addScaledVector(_f.set(dx, dy * 0.5, dz).normalize(), (6 - d) * dt * 6);
      f.avoid.multiplyScalar(1 - Math.min(1, dt * 0.6));
      if (f.avoid.lengthSq() > 64) f.avoid.setLength(8);
      _g.add(f.avoid);
      const fl = floorAt(_g.x, _g.z) + 0.5;
      if (_g.y < fl) _g.y = fl;
      if (_g.y > WATER_Y - 0.4) _g.y = WATER_Y - 0.4;
      f.p.copy(_g);
      // face where it's going (mostly with the school)
      let vx = _g.x - prevX, vy = _g.y - prevY, vz = _g.z - prevZ;
      const vl = Math.hypot(vx, vy, vz);
      if (vl < 1e-4 || vl > 3) { vx = sc.vel.x; vy = 0; vz = sc.vel.z; }
      if (sp < 0.05 && vl < 1e-4) { vx = Math.sin(f.ph); vz = Math.cos(f.ph); }
      const yaw = Math.atan2(vx, vz), pitch = -Math.atan2(vy, Math.hypot(vx, vz)) * 0.6;
      _e.set(pitch, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_g, _q, _s.setScalar(f.s));
      im.setMatrixAt(f.i, _m);
    }
  }
  im.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- bigger animals
// Smooth streamlined bodies from a lathe profile (radius along the length), lying along +z
function streamBody(profile, len, widthScale, top, belly, seg = 20) {
  const pts = profile.map(([u, r]) => new THREE.Vector2(r, u * len));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);               // length now runs along +z (nose forward)
  g.translate(0, 0, -len / 2);
  g.scale(widthScale, 1, 1);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(top), b = new THREE.Color(belly);
  let maxR = 0; for (const [, r] of profile) maxR = Math.max(maxR, r);
  for (let i = 0; i < p.count; i++) {
    const t = clamp(0.5 - p.getY(i) / (maxR * 1.2), 0, 1);
    _c.copy(a).lerp(b, t * t * (3 - 2 * t));
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function finShape(points, depth, color) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, stdMat({ color, roughness: 0.5 }));
}
function eye(parent, x, y, z, r) {
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), stdMat({ color: '#0a0a0c', roughness: 0.2 })); e.position.set(sx * x, y, z); parent.add(e); }
}

function dolphinModel() {
  const g = new THREE.Group();
  const bodyMat = stdMat({ vertexColors: true, roughness: 0.32 });
  const body = new THREE.Mesh(streamBody([[0, 0.03], [0.08, 0.1], [0.3, 0.24], [0.55, 0.31], [0.75, 0.27], [0.86, 0.2], [0.9, 0.12], [0.93, 0.07], [0.99, 0.05], [1, 0]], 2.6, 0.82, '#56697a', '#dde5ec'), bodyMat);
  g.add(body);
  const dorsal = finShape([[0, 0], [0.45, 0], [0.05, 0.42], [-0.12, 0.38]], 0.05, '#4f6272'); dorsal.rotation.y = -Math.PI / 2; dorsal.position.set(0, 0.24, -0.15); g.add(dorsal);
  for (const sx of [-1, 1]) { const p = finShape([[0, 0], [0.35, -0.05], [0.42, -0.22], [0.1, -0.06]], 0.035, '#56697a'); p.rotation.set(Math.PI / 2, sx > 0 ? 0 : Math.PI, -0.4 * sx); p.position.set(sx * 0.2, -0.12, 0.45); g.add(p); }
  const tail = new THREE.Group(); tail.position.z = -1.25; g.add(tail);
  const fl = finShape([[0, 0.05], [0.42, 0.28], [0.5, 0.18], [0.12, -0.02], [0.5, -0.2], [0.42, -0.28], [0, -0.05]], 0.04, '#4f6272');
  fl.rotation.set(Math.PI / 2, 0, -Math.PI / 2); fl.position.z = 0; tail.add(fl);
  eye(g, 0.17, 0.05, 0.92, 0.035);
  g.userData.tail = tail;
  mergeStatic(g, new Set([tail]));
  return g;
}
function sharkModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(streamBody([[0, 0.04], [0.1, 0.1], [0.3, 0.28], [0.55, 0.38], [0.75, 0.33], [0.88, 0.22], [0.96, 0.12], [1, 0.02]], 4.2, 0.85, '#5c6670', '#e9ecee'), stdMat({ vertexColors: true, roughness: 0.55 })));
  const dorsal = finShape([[0, 0], [0.75, 0], [0.15, 0.85], [-0.05, 0.8]], 0.07, '#545e68'); dorsal.rotation.y = -Math.PI / 2; dorsal.position.set(0, 0.32, 0.3); g.add(dorsal);
  for (const sx of [-1, 1]) { const p = finShape([[0, 0], [0.75, -0.25], [0.8, -0.45], [0.2, -0.1]], 0.05, '#5c6670'); p.rotation.set(Math.PI / 2, sx > 0 ? 0 : Math.PI, -0.5 * sx); p.position.set(sx * 0.3, -0.18, 0.75); g.add(p); }
  const tail = new THREE.Group(); tail.position.z = -2.0; g.add(tail);
  const cf = finShape([[0, 0.05], [-0.55, 1.05], [-0.72, 0.95], [-0.25, 0.05], [-0.45, -0.55], [-0.3, -0.6], [0, -0.05]], 0.06, '#545e68');
  cf.rotation.y = -Math.PI / 2; tail.add(cf);
  eye(g, 0.24, 0.08, 1.55, 0.05);
  // gill slits
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.2, 0.025), stdMat({ color: '#3a434c' })); sl.position.set(sx * 0.31, 0.02, 1.05 - i * 0.09); g.add(sl); }
  g.userData.tail = tail;
  mergeStatic(g, new Set([tail]));
  return g;
}
function turtleModel(seed) {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#6b5233'; x.fillRect(0, 0, 128, 128);
  const r = rng(seed);
  for (let i = 0; i < 26; i++) { x.fillStyle = `hsl(${30 + r() * 15},${35 + r() * 20}%,${22 + r() * 18}%)`; x.beginPath(); const px = r() * 128, py = r() * 128; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; x.lineTo(px + Math.cos(a) * 14, py + Math.sin(a) * 14); } x.fill(); x.strokeStyle = '#3a2a18'; x.lineWidth = 2; x.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), stdMat({ map: tex, roughness: 0.6 }));
  shell.scale.set(0.62, 0.26, 0.78); g.add(shell);
  const under = new THREE.Mesh(new THREE.CircleGeometry(1, 18), stdMat({ color: '#d8c890' })); under.rotation.x = Math.PI / 2; under.scale.set(0.58, 0.74, 1); g.add(under);
  const skin = stdMat({ color: '#7a8a5a', roughness: 0.7 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), skin); head.scale.set(0.16, 0.13, 0.22); head.position.set(0, 0.04, 0.88); g.add(head);
  eye(g, 0.09, 0.09, 0.98, 0.022);
  const fl = [];
  for (const [sx, z, len, w] of [[-1, 0.42, 0.75, 0.22], [1, 0.42, 0.75, 0.22], [-1, -0.55, 0.32, 0.16], [1, -0.55, 0.32, 0.16]]) {
    const pv = new THREE.Group(); pv.position.set(sx * 0.5, 0.0, z); g.add(pv);
    const f = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), skin); f.scale.set(len / 2, 0.035, w / 2); f.position.x = sx * len / 2; f.rotation.y = sx * 0.4; pv.add(f);
    fl.push({ pv, sx, front: z > 0 });
  }
  g.userData.flippers = fl;
  mergeStatic(g, new Set(fl.map(f => f.pv)));
  return g;
}
function jellyModel(color) {
  const g = new THREE.Group();
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.5, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false }));
  g.add(bell);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.position.y = 0.12; inner.scale.y = 0.6; g.add(inner);
  const tm = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
  const tents = new THREE.Group(); g.add(tents);
  const seg = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, rad = 0.38;
    const len = 1.2 + R() * 1.4;
    for (let k = 0; k < 10; k++) for (const kk of [k, k + 1]) seg.push(Math.cos(a) * rad * (1 - kk * 0.03), -kk / 10 * len, Math.sin(a) * rad * (1 - kk * 0.03));
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  tents.add(new THREE.LineSegments(lg, tm));
  const arms = [];
  for (let i = 0; i < 4; i++) {        // frilly oral arms
    const a = new THREE.PlaneGeometry(0.12, 0.9, 1, 6); a.rotateY(i * 0.8); a.translate(Math.cos(i * 1.57) * 0.06, -0.45, Math.sin(i * 1.57) * 0.06); arms.push(a);
  }
  tents.add(new THREE.Mesh(mergeGeometries(arms), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })));
  g.userData = { bell, tents };
  return g;
}
function whaleModel() {
  const g = new THREE.Group();
  const L = 14;
  const body = new THREE.Mesh(streamBody([[0, 0.05], [0.06, 0.32], [0.2, 0.95], [0.4, 1.7], [0.6, 2.0], [0.75, 1.85], [0.88, 1.45], [0.96, 0.85], [1, 0.25]], L, 0.9, '#2c3742', '#e8ecef', 28), stdMat({ vertexColors: true, roughness: 0.6 }));
  g.add(body);
  // throat grooves
  for (let i = -5; i <= 5; i++) { const gr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 4.5), stdMat({ color: '#b8c0c6' })); gr.position.set(i * 0.22, -1.62 + Math.abs(i) * 0.04, 3.4); gr.rotation.z = i * 0.06; g.add(gr); }
  // long white pectoral fins (humpback)
  const pecs = [];
  for (const sx of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(sx * 1.5, -0.9, 2.6); g.add(pv);
    const p = finShape([[0, 0.25], [1.5, 0.15], [3.6, -0.15], [4.3, -0.35], [3.8, -0.5], [1.6, -0.45], [0, -0.3]], 0.14, '#cfd6db');
    p.rotation.set(Math.PI / 2, sx > 0 ? 0 : Math.PI, 0); p.rotation.z = sx * -0.25; pv.add(p);
    pecs.push({ pv, sx });
  }
  const dorsal = finShape([[0, 0], [0.9, 0], [0.2, 0.55]], 0.1, '#28323c'); dorsal.rotation.y = -Math.PI / 2; dorsal.position.set(0, 1.55, -2.6); g.add(dorsal);
  const tail = new THREE.Group(); tail.position.z = -6.8; g.add(tail);
  const fl = finShape([[0, 0.25], [1.6, 0.8], [2.6, 0.5], [2.4, 0.2], [0.6, -0.1], [2.4, -0.5], [2.6, -0.85], [1.6, -1.1], [0, -0.3]], 0.12, '#27313b');
  fl.rotation.set(Math.PI / 2, 0, -Math.PI / 2); fl.scale.setScalar(1.15); tail.add(fl);
  eye(g, 1.35, -0.55, 4.6, 0.09);
  // knobbly bumps on the head
  for (let i = 0; i < 16; i++) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), stdMat({ color: '#3a4652' })); const a = (R() - 0.5) * 1.2; k.position.set(Math.sin(a) * 0.9, 0.55 + Math.cos(a) * 0.3, 5 + R() * 1.6); g.add(k); }
  g.userData = { tail, pecs };
  mergeStatic(g, new Set([tail, ...pecs.map(p => p.pv)]));
  return g;
}

function buildAnimals() {
  for (let i = 0; i < 5; i++) {
    const m = turtleModel(i + 10); m.scale.setScalar(rr(1, 1.35));
    ocean.detail.add(m);
    ocean.turtles.push({ m, a: R() * 6, w: rr(0.02, 0.035) * (R() < 0.5 ? 1 : -1), cx: rr(270, 460), cz: rr(-110, 110), r1: rr(25, 50), r2: rr(20, 45), ph: R() * 6, prev: new THREE.Vector3() });
  }
  const jc = ['#ff8ad8', '#8ad8ff', '#c08aff', '#ffb08a', '#8affd0'];
  for (let i = 0; i < 18; i++) {
    const m = jellyModel(jc[i % jc.length]); const s = rr(0.6, 1.4); m.scale.setScalar(s);
    const x = rr(420, 505), z = rr(-160, -40);
    ocean.detail.add(m);
    ocean.jellies.push({ m, x, z, y: lerp(floorAt(x, z) + 3, WATER_Y - 2, R()), vy: 0, ph: R() * 6, s, dx: rr(-0.2, 0.2), dz: rr(-0.2, 0.2) });
  }
  for (let i = 0; i < 4; i++) {
    const m = dolphinModel(); ocean.group.add(m);
    ocean.dolphins.push({ m, off: new THREE.Vector3(rr(-3, 3), rr(-0.6, 0.6), rr(-4, 4)), jumpT: rr(4, 18), jump: -1, prev: new THREE.Vector3() });
  }
  ocean.pod = { a: 0, cx: CX + 10, cz: CZ, r: 95 };
  for (let i = 0; i < 2; i++) {
    const m = sharkModel(); m.scale.setScalar(rr(0.95, 1.15)); ocean.detail.add(m);
    ocean.sharks.push({ m, a: i * 3, w: 0.05 * (i ? -1 : 1), cx: 380 + i * 40, cz: -20 + i * 50, r: 35 + i * 10, depth: 0.55 + i * 0.15, chase: 0, bumpT: 0, prev: new THREE.Vector3() });
  }
  const wm = whaleModel(); ocean.group.add(wm);
  ocean.whale = { m: wm, a: 1, surfT: 50, surfacing: 0, songT: 6, prev: new THREE.Vector3() };
}
function orient(m, prev, pos, roll = 0) {
  const vx = pos.x - prev.x, vy = pos.y - prev.y, vz = pos.z - prev.z;
  const h = Math.hypot(vx, vz);
  if (h + Math.abs(vy) > 1e-5) m.rotation.set(-Math.atan2(vy, h), Math.atan2(vx, vz), roll, 'YXZ');
  prev.copy(pos);
}
function updateAnimals(dt, t, focus, P) {
  for (const tu of ocean.turtles) {
    tu.a += tu.w * dt;
    _p.set(tu.cx + Math.cos(tu.a) * tu.r1, 0, tu.cz + Math.sin(tu.a * 1.4 + tu.ph) * tu.r2);
    const fl = floorAt(_p.x, _p.z);
    _p.y = lerp(fl + 1.5, WATER_Y - 0.8, 0.35 + 0.35 * Math.sin(t * 0.05 + tu.ph));
    tu.m.position.copy(_p); orient(tu.m, tu.prev, _p);
    for (const f of tu.m.userData.flippers) {
      const k = Math.sin(t * 1.6 + tu.ph + (f.front ? 0 : 1.2));
      f.pv.rotation.z = f.sx * (f.front ? k * 0.55 : k * 0.25);
      f.pv.rotation.y = f.sx * (f.front ? 0.2 + k * 0.25 : 0);
    }
  }
  for (const j of ocean.jellies) {
    const pulse = Math.max(0, Math.sin(t * 1.7 + j.ph));
    j.vy += (pulse * 0.9 - 0.25 - j.vy) * Math.min(1, dt * 2);
    j.y += j.vy * dt * 0.6; j.x += j.dx * dt; j.z += j.dz * dt;
    const fl = floorAt(j.x, j.z);
    if (j.y > WATER_Y - 1.2) j.vy = -0.4;
    if (j.y < fl + 2) j.vy = 0.6;
    if (j.x < 410 || j.x > 510) j.dx = -j.dx;
    if (j.z < -165 || j.z > -30) j.dz = -j.dz;
    j.m.position.set(j.x, j.y, j.z);
    const u = j.m.userData;
    u.bell.scale.set(1 + pulse * 0.14, 1 - pulse * 0.2, 1 + pulse * 0.14);
    u.tents.rotation.set(Math.sin(t * 0.8 + j.ph) * 0.15, t * 0.1, Math.cos(t * 0.7 + j.ph) * 0.15);
    u.tents.scale.y = 1 + pulse * 0.1;
    // sting!
    if (P && !P.vehicle && !P.ragdoll && Math.hypot(P.root.x - j.x, P.root.z - j.z) < 0.9 * j.s && P.root.y + 1 > j.y - 1.5 * j.s && P.root.y < j.y + 0.5) {
      P.flop(_f.set(P.root.x - j.x, 1.5, P.root.z - j.z).normalize().multiplyScalar(4), 1.5);
      G.toast && G.toast('⚡ Ouch! Jellyfish sting! Don\'t touch the jellies.', 'bad');
      sfx.slap();
    }
  }
  // dolphin pod: cruises round the bay near the surface and jumps clean out of the water
  const pod = ocean.pod;
  pod.a += dt * 0.085;
  const px = pod.cx + Math.cos(pod.a) * pod.r, pz = pod.cz + Math.sin(pod.a) * pod.r * 0.85;
  const tx = -Math.sin(pod.a), tz = Math.cos(pod.a) * 0.85;
  for (const d of ocean.dolphins) {
    _p.set(px + d.off.x * tz + d.off.z * tx, WATER_Y - 1.3 + d.off.y + Math.sin(t * 1.3 + d.off.x) * 0.3, pz - d.off.x * tx + d.off.z * tz);
    d.jumpT -= dt;
    if (d.jump < 0 && d.jumpT <= 0) { d.jump = 0; d.jumpT = rr(6, 16); }
    if (d.jump >= 0) {
      d.jump += dt / 1.6;
      const k = d.jump;
      _p.y += Math.sin(Math.min(1, k) * Math.PI) * 4.2;
      if (k > 0.03 && !d.splash1) { d.splash1 = true; splash(_p); }
      if (k >= 1) { d.jump = -1; d.splash1 = false; splash(_p); }
    }
    d.m.position.copy(_p); orient(d.m, d.prev, _p, Math.sin(t * 0.7) * 0.1);
    d.m.userData.tail.rotation.x = Math.sin(t * 7 + d.off.z) * 0.35;
  }
  // sharks: lazy circles, and they get curious about divers (and give them a bump)
  for (const s of ocean.sharks) {
    s.a += s.w * dt;
    const fl = floorAt(s.cx, s.cz);
    _g.set(s.cx + Math.cos(s.a) * s.r, lerp(fl + 3, WATER_Y - 3, s.depth), s.cz + Math.sin(s.a) * s.r);
    const pos = s.m.position;
    if (pos.lengthSq() === 0) pos.copy(_g);
    s.bumpT -= dt;
    if (P && P.diving && !P.vehicle && P.root.distanceTo(pos) < 22 && s.bumpT < 0) s.chase = Math.min(1, s.chase + dt * 0.4); else s.chase = Math.max(0, s.chase - dt * 0.3);
    if (s.chase > 0) _g.lerp(_f.set(P.root.x, P.root.y + 0.8, P.root.z), s.chase * 0.9);
    const k = 1 - Math.exp(-dt * 0.7);
    _p.copy(pos).lerp(_g, k);
    const fl2 = floorAt(_p.x, _p.z) + 1.2; if (_p.y < fl2) _p.y = fl2;
    if (_p.y > WATER_Y - 1.4) _p.y = WATER_Y - 1.4;
    pos.copy(_p);
    orient(s.m, s.prev, _p);
    s.m.userData.tail.rotation.y = Math.sin(t * (3 + s.chase * 4)) * 0.35;
    if (P && s.chase > 0.3 && !P.ragdoll && P.root.distanceTo(pos) < 2.4) {
      P.flop(_f.subVectors(P.root, pos).setY(0.4).normalize().multiplyScalar(6), 1.6);
      G.toast && G.toast('🦈 A shark bumped you! It was only curious...', 'bad');
      s.bumpT = 20; s.chase = 0; sfx.slap();
    }
  }
  // the whale: slow circles in the deep basin, surfacing every minute or so to breathe
  const w = ocean.whale;
  w.a += dt * 0.022;
  w.surfT -= dt;
  if (w.surfT <= 0 && w.surfacing === 0) { w.surfacing = 0.0001; w.surfT = rr(60, 110); }
  let wy = -21 + Math.sin(t * 0.03) * 3;
  if (w.surfacing > 0) {
    w.surfacing += dt / 22;
    const k = Math.sin(Math.min(1, w.surfacing) * Math.PI);
    wy = lerp(wy, WATER_Y - 0.9, k);
    if (w.surfacing > 0.45 && !w.blown) { w.blown = true; spout(w.m.position); }
    if (w.surfacing >= 1) { w.surfacing = 0; w.blown = false; }
  }
  _p.set(CX + 30 + Math.cos(w.a) * 62, wy, CZ + Math.sin(w.a) * 58);
  w.m.position.copy(_p); orient(w.m, w.prev, _p, -0.12);
  w.m.userData.tail.rotation.x = Math.sin(t * 0.9) * 0.28;
  for (const pc of w.m.userData.pecs) pc.pv.rotation.z = pc.sx * Math.sin(t * 0.45) * 0.12;
  // whale song when you're underwater nearby
  w.songT -= dt;
  if (w.songT <= 0) { w.songT = rr(9, 18); if (G.underwater && focus.distanceTo(_p) < 160) whaleCall(1 - focus.distanceTo(_p) / 160); }
}

// ---------------------------------------------------------------- particles: bubbles, splashes, spouts, coins
const bubbleTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 10, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.75, 'rgba(220,245,255,0.35)'); g.addColorStop(0.9, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(24, 22, 5, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); return t;
})();
const puffTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const parts = [];
const bubbleMat = new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false });
const puffMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.85 });
const coinMat = new THREE.SpriteMaterial({ color: '#ffd23a', map: puffTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
function addPart(mat, pos, vel, life, size, kind) {
  let p = parts.find(q => !q.alive && q.s.material === mat);
  if (!p) { if (parts.length > 400) return; p = { s: new THREE.Sprite(mat), v: new THREE.Vector3() }; ocean.fx.add(p.s); parts.push(p); }
  p.alive = true; p.s.visible = true; p.s.position.copy(pos); p.v.copy(vel); p.life = life; p.max = life; p.size = size; p.kind = kind;
  p.s.scale.setScalar(size);
}
export function bubbles(pos, n = 4, spread = 0.3) {
  for (let i = 0; i < n; i++) addPart(bubbleMat, _f.set(pos.x + rr(-spread, spread), pos.y + rr(-spread, spread), pos.z + rr(-spread, spread)), _g.set(rr(-0.2, 0.2), rr(1.2, 2.2), rr(-0.2, 0.2)), 8, rr(0.08, 0.22), 'bubble');
}
function splash(pos) {
  for (let i = 0; i < 14; i++) addPart(puffMat, _f.set(pos.x + rr(-0.6, 0.6), WATER_Y + 0.1, pos.z + rr(-0.6, 0.6)), _g.set(rr(-2, 2), rr(3, 6), rr(-2, 2)), rr(0.6, 1.1), rr(0.5, 1.1), 'splash');
  if (G.camera && G.camera.position.distanceTo(pos) < 60) sfx.water();
}
function spout(pos) {
  for (let i = 0; i < 40; i++) addPart(puffMat, _f.set(pos.x + rr(-0.4, 0.4), WATER_Y + 0.5, pos.z + 4 + rr(-0.4, 0.4)), _g.set(rr(-1, 1), rr(7, 13), rr(-1, 1)), rr(1.2, 2.2), rr(0.8, 1.8), 'splash');
  if (G.camera && G.camera.position.distanceTo(pos) < 150) sfx.whoosh();
}
function coins(pos) {
  for (let i = 0; i < 40; i++) addPart(coinMat, _f.copy(pos).add(_g.set(rr(-0.4, 0.4), 0.6, rr(-0.4, 0.4))), _g.set(rr(-2, 2), rr(2, 6), rr(-2, 2)), rr(1, 1.8), rr(0.12, 0.25), 'coin');
}
function updateParts(dt) {
  for (const p of parts) {
    if (!p.alive) continue;
    p.life -= dt;
    if (p.kind === 'bubble') {
      p.v.x += Math.sin(G.time * 6 + p.size * 50) * dt * 0.8;
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.size * (1 + (p.max - p.life) * 0.08));
      if (p.s.position.y > WATER_Y - 0.05) p.life = 0;
    } else {
      p.v.y -= (p.kind === 'coin' ? 6 : 9.8) * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.opacity = p.kind === 'splash' ? 0.85 : 1;
      p.s.scale.setScalar(p.size * (p.kind === 'splash' ? 1 + (1 - p.life / p.max) * 1.5 : 1));
    }
    if (p.life <= 0) { p.alive = false; p.s.visible = false; }
  }
}

// ---------------------------------------------------------------- shipwreck
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const r = rng(31);
  for (let i = 0; i < 16; i++) {
    x.fillStyle = `hsl(${24 + r() * 10},${28 + r() * 15}%,${30 + r() * 12}%)`; x.fillRect(0, i * 16, 256, 16);
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, i * 16, 256, 1.5);
    for (let k = 0; k < 3; k++) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(r() * 256, i * 16, 2, 16); }
  }
  // algae and barnacles
  for (let i = 0; i < 220; i++) { x.fillStyle = r() < 0.6 ? `rgba(${60 + r() * 40},${100 + r() * 50},${50 + r() * 30},${0.25 + r() * 0.35})` : `rgba(220,215,200,${0.3 + r() * 0.4})`; x.beginPath(); x.arc(r() * 256, r() * 256, 1 + r() * 6, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
}
// lofted hull between stations u0..u1 (0 = stern, 1 = bow), open on top
function hullGeo(L, W, H, u0, u1) {
  const sec = [[1, 1], [1.03, 0.75], [0.97, 0.45], [0.78, 0.2], [0.45, 0.05], [0, 0]];
  const pts = [...sec, ...sec.slice(0, -1).reverse().map(([a, b]) => [-a, b])];
  const ns = 18, pos = [], uv = [], idx = [];
  for (let i = 0; i <= ns; i++) {
    const u = u0 + (u1 - u0) * i / ns;
    const w = W / 2 * (u < 0.15 ? 0.72 + u / 0.15 * 0.28 : Math.pow(Math.sin(Math.min(1, (1 - u) / 0.85) * Math.PI / 2), 0.7));
    const z = (u - 0.5) * L;
    const sheer = H * (1 + 0.18 * Math.pow(Math.abs(u - 0.45) * 2, 2));
    pts.forEach(([a, b], k) => { pos.push(a * w, b * sheer, z); uv.push(u * 4, k / (pts.length - 1)); });
  }
  const n = pts.length;
  for (let i = 0; i < ns; i++) for (let k = 0; k < n - 1; k++) { const a = i * n + k, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function buildWreck() {
  const wx = 395, wz = 48;
  const fy = Math.min(floorAt(wx, wz - 10), floorAt(wx, wz + 10), floorAt(wx, wz)) - 0.6;
  const wood = stdMat({ map: woodTexture(), side: THREE.DoubleSide, roughness: 0.95 });
  const dark = stdMat({ color: '#2a2018', roughness: 1 });
  const L = 30, W = 8.5, H = 6.5;
  const root = new THREE.Group(); root.position.set(wx, fy, wz); ocean.group.add(root);
  // stern half: upright-ish, lying along z, you can swim in through the broken front
  const stern = new THREE.Group(); stern.rotation.z = 0.1; root.add(stern);
  stern.add(new THREE.Mesh(hullGeo(L, W, H, 0, 0.55), wood));
  const transom = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, H * 1.25, 0.4), wood); transom.position.set(0, H * 0.62, -L / 2); stern.add(transom);
  // ribs at the break
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(W * 0.46, 0.18, 6, 14, Math.PI), dark);
    rib.rotation.z = Math.PI; rib.position.set(0, H * 0.95, (0.55 - 0.5) * L - i * 0.9); rib.scale.y = 1.25; stern.add(rib);
  }
  // half of the deck still on, with a hatch and the captain's cabin
  for (let k = 0; k < 9; k++) if (k !== 4 && k !== 5) { const pl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.15, 1.1), wood); pl.position.set(0, H - 0.05, -L / 2 + 2 + k * 1.2); pl.rotation.z = (k % 3 - 1) * 0.03; stern.add(pl); }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 2.4, 4), wood); cab.position.set(0, H + 1.2, -L / 2 + 2.4); stern.add(cab);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 10), stdMat({ color: '#2b2b2b', roughness: 0.6, metalness: 0.5 }));
    cn.rotation.z = Math.PI / 2; cn.position.set(sx * (W / 2 + 0.2), H * 0.7, -L / 2 + 4 + i * 3); stern.add(cn);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 7, 10), wood); mast.position.set(0, H + 3, -L / 2 + 8); mast.rotation.z = 0.08; stern.add(mast);
  // bow half: broke off and rolled onto its side
  const bow = new THREE.Group(); bow.position.set(2.5, 0.6, 5.5); bow.rotation.set(-0.1, 0.35, -0.95); root.add(bow);
  bow.add(new THREE.Mesh(hullGeo(L, W, H, 0.62, 1), wood));
  const bsp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 7, 8), wood); bsp.rotation.x = Math.PI / 2 - 0.3; bsp.position.set(0, H + 0.8, L / 2 + 2.5); bow.add(bsp);
  // the main mast lying across the sand, barrels and a scattered cannon
  const fm = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 17, 10), wood); fm.rotation.set(Math.PI / 2, 0, 0); fm.rotation.z = 1.1; fm.position.set(-7, 0.5, 2); root.add(fm);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9, 8), wood); yard.rotation.z = 0.2; yard.position.set(-9, 0.45, 5); root.add(yard);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), wood); b.position.set(-4 + rr(-3, 3), 0.4, -6 + rr(-5, 5)); b.rotation.set(R() < 0.5 ? Math.PI / 2 : 0, R() * 3, 0); root.add(b);
  }
  // colliders: two hull sides, the keel floor and the transom (open at the front so you can swim in)
  const x0 = wx - W / 2, x1 = wx + W / 2, z0 = wz - L / 2, z1 = wz + (0.55 - 0.5) * L;
  addCollider(x0 - 0.3, fy, z0, x0 + 0.3, fy + H, z1);
  addCollider(x1 - 0.3, fy, z0, x1 + 0.3, fy + H, z1);
  addCollider(x0, fy - 1, z0, x1, fy + 0.5, z1);
  addCollider(x0, fy, z0 - 0.4, x1, fy + H * 1.2, z0 + 0.3);
  addCollider(wx - W * 0.4, fy + H, z0, wx + W * 0.4, fy + H + 2.4, z0 + 4.5);
  addCollider(wx - 1, fy, wz + 3, wx + 6.5, fy + 5, wz + 15);
  ocean.wreck = { x: wx, z: wz, y: fy };
  mergeStatic(root);
  chest('wreck1', wx + 0.5, fy + 0.5, wz - L / 2 + 6, 0.2);
  chest('wreck2', wx - 6, floorAt(wx - 6, wz + 12), wz + 12, 2.3);
}

// ---------------------------------------------------------------- underwater cave
function buildCave() {
  const z = -112, xa = 280, xb = 318, wid = 6.5, ht = 5.5;
  let fy = -1e9; for (let x = xa; x <= xb; x += 2) fy = Math.max(fy, floorAt(x, z), floorAt(x, z - 3), floorAt(x, z + 3));
  const ceil = fy + ht;
  const rock = stdMat({ color: '#5d5750', roughness: 1, flatShading: true });
  const rock2 = stdMat({ color: '#6b6258', roughness: 1, flatShading: true });
  const g = new THREE.Group(); ocean.group.add(g);
  const rk = (x, y, zz, s, m = rock) => { s = Math.min(s, Math.max(1.2, (WATER_Y - 1.5 - y) / 0.8)); y = Math.min(y, WATER_Y - 1.5 - s * 0.8); const r = new THREE.Mesh(lumpy(new THREE.DodecahedronGeometry(1, 1), 0.2, x + zz), m); r.position.set(x, y, zz); r.scale.set(s * rr(0.9, 1.3), s * rr(0.7, 1.1), s * rr(0.9, 1.2)); r.rotation.set(R(), R() * 6, R()); g.add(r); };
  for (let x = xa; x <= xb; x += 3.2) {
    for (const sz of [-1, 1]) {
      rk(x, floorAt(x, z + sz * (wid / 2 + 3)) + 2, z + sz * (wid / 2 + 3.2), 3.3, sz > 0 ? rock : rock2);
      rk(x + 1.5, fy + 4.5, z + sz * (wid / 2 + 3.6), 3.2);
    }
    rk(x, ceil + 2.6, z, 3.4, rock2);
    rk(x + 1.2, ceil + 4.2, z + rr(-3, 3), 3);
  }
  for (let i = 0; i < 10; i++) rk(rr(xa - 4, xb + 4), ceil + rr(5, 8), z + rr(-7, 7), rr(2.5, 4));
  // solid walls and ceiling
  const cTop = Math.min(ceil + 9, WATER_Y - 2.2);
  addCollider(xa - 2, fy - 2, z - wid / 2 - 7, xb + 2, cTop, z - wid / 2);
  addCollider(xa - 2, fy - 2, z + wid / 2, xb + 2, cTop, z + wid / 2 + 7);
  addCollider(xa - 2, ceil, z - wid / 2, xb + 2, cTop, z + wid / 2);
  // glowing crystals and mushrooms light the way
  const cm = ['#4af2ff', '#b06aff', '#4aff9a'].map(c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.2 }));
  for (let x = xa + 2; x < xb; x += 2.6) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), cm[Math.floor(R() * 3)]);
    c.scale.set(0.6, rr(1.4, 2.6), 0.6); c.position.set(x + rr(-0.6, 0.6), floorAt(x, z) + rr(0.4, 3.5), z + sz * (wid / 2 - 0.2)); c.rotation.set(rr(-0.5, 0.5), R() * 3, sz * 0.5); g.add(c);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: c.material.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    gl.position.copy(c.position); gl.scale.setScalar(2.2); g.add(gl);
  }
  ocean.cave = { x0: xa, x1: xb, z0: z - wid / 2, z1: z + wid / 2, y0: fy, y1: ceil };
  mergeStatic(g);
  chest('cave', (xa + xb) / 2 + 4, floorAt((xa + xb) / 2 + 4, z), z + 1.6, Math.PI);
  LOC.cave = { x: xa - 6, z };
}

// ---------------------------------------------------------------- treasure chests
const chestWood = () => stdMat({ color: '#6b4422', roughness: 0.85 });
const gold = new THREE.MeshStandardMaterial({ color: '#e8b830', metalness: 0.85, roughness: 0.3, emissive: '#5a3a00', emissiveIntensity: 0.4 });
function chest(id, x, y, z, ry) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; ocean.detail.add(g);
  const wm = chestWood();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), wm); base.position.y = 0.3; g.add(base);
  for (const sx of [-0.45, 0.45]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.72), gold); b.position.set(sx, 0.3, 0); g.add(b); }
  const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.35); g.add(lid);
  const lm = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 12, 1, false, 0, Math.PI), wm); lm.rotation.z = Math.PI / 2; lm.position.z = 0.35; lid.add(lm);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), gold); lock.position.set(0, 0.55, 0.37); g.add(lock);
  const pile = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold); pile.scale.set(1.15, 0.45, 0.72); pile.position.y = 0.55; g.add(pile);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: '#ffd23a', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.y = 0.7; glow.scale.setScalar(3); g.add(glow);
  const c = { id, g, lid, pile, glow, x, y, z, open: false };
  ocean.chests.push(c);
  G.interacts.push({
    x, z, y: y + 0.4, dy: 2.5, r: 2.6,
    show: () => true,
    label: () => (G.save.treasure || []).includes(id) ? '🪙 Empty chest' : '💰 Open the treasure chest',
    action: () => openChest(c),
  });
}
function openChest(c) {
  const T = (G.save.treasure ||= []);
  if (T.includes(c.id)) { G.toast('🪙 You already emptied this one. There are more hidden around Coral Bay!'); return; }
  T.push(c.id);
  addMoney(300, '💰 Sunken treasure!');
  coins(_f.set(c.x, c.y + 0.5, c.z));
  sfx.present();
  G.toast(`💰 Treasure! +$300 · ${T.length}/${ocean.chests.length} chests found`, 'money', 6000);
  if (T.length === ocean.chests.length) setTimeout(() => G.toast('🏴‍☠️ You found ALL the sunken treasure! Legend of the deep!', 'money', 8000), 1500);
}
function updateChests(dt) {
  const T = G.save.treasure || [];
  for (const c of ocean.chests) {
    const open = T.includes(c.id);
    c.lid.rotation.x = lerp(c.lid.rotation.x, open ? -1.9 : 0, Math.min(1, dt * 3));
    c.pile.visible = open ? c.lid.rotation.x > -1.7 : true;
    c.glow.visible = !open;
    c.glow.material.opacity = 0.3 + Math.sin(G.time * 2.5 + c.x) * 0.15;
    if (!open && Math.random() < dt * 0.5) bubbles(_f.set(c.x, c.y + 0.7, c.z), 1, 0.2);
  }
}

// ---------------------------------------------------------------- light: rays, caustics, particles, fog
function rayTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  x.globalCompositeOperation = 'destination-in';
  const h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.5, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = h; x.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}
function buildRays() {
  const mat = new THREE.MeshBasicMaterial({ map: rayTexture(), color: '#bff4ff', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  ocean.rays = [];
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, -0.5, 0);
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(geo, mat.clone()); m.frustumCulled = false;
    ocean.fx.add(m);
    ocean.rays.push({ m, x: 0, z: 0, w: rr(1.5, 5), len: rr(22, 45), ph: R() * 6, tilt: rr(0.12, 0.3) });
  }
}
function buildCaustics() {
  const x0 = BAY.x0 - 6, x1 = BAY.x1 + 6, z0 = BAY.z0 - 6, z1 = BAY.z1 + 6, st = 2;
  const nx = Math.round((x1 - x0) / st), nz = Math.round((z1 - z0) / st);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), dep = new Float32Array((nx + 1) * (nz + 1)), idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = j * (nx + 1) + i, x = x0 + i * st, z = z0 + j * st, h = heightAt(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = h + 0.06; pos[k * 3 + 2] = z; dep[k] = WATER_Y - h;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (dep[a] < 0.2 && dep[b] < 0.2 && dep[c] < 0.2 && dep[d] < 0.2) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('depth', new THREE.BufferAttribute(dep, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSun: { value: 1 }, uCam: { value: new THREE.Vector3() }, uFar: { value: 90 } },
    vertexShader: `attribute float depth; varying float vD; varying vec3 vW;
      void main(){ vD = depth; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uSun, uFar; uniform vec3 uCam; varying float vD; varying vec3 vW;
      float caustic(vec2 p, float t){
        vec2 i = p; float c = 1.0; float inten = 0.005;
        for (int n = 0; n < 4; n++) {
          float tt = t * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
        }
        c /= 4.0; c = 1.17 - pow(c, 1.4);
        return pow(abs(c), 8.0);
      }
      void main(){
        if (vD < 0.25) discard;
        vec2 p = mod(vW.xz * 0.2, 6.2831) - 250.0;
        float c = caustic(p, uTime * 0.5) + 0.5 * caustic(p * 1.7 + 3.0, uTime * 0.4 + 2.0);
        float fade = smoothstep(0.25, 2.0, vD) * (1.0 - smoothstep(10.0, 34.0, vD));
        fade *= 1.0 - smoothstep(uFar * 0.35, uFar, distance(uCam, vW));
        gl_FragColor = vec4(vec3(0.6, 0.95, 1.0) * min(c, 1.4) * fade * uSun * 0.32, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 1;
  ocean.caustics = mesh; ocean.group.add(mesh);
}
function buildMotes() {
  const n = 1800, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = Math.random() * 40; p[i * 3 + 1] = Math.random() * 40; p[i * 3 + 2] = Math.random() * 40; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: U.uTime, uCol: { value: new THREE.Color('#cfefff') } },
    vertexShader: `uniform vec3 uCam; uniform float uTime; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.2 + position.y) * 0.6, uTime * 0.12, cos(uTime * 0.17 + position.x) * 0.6);
        p = uCam + mod(p - uCam, 40.0) - 20.0;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z; vA = (1.0 - smoothstep(6.0, 20.0, d)) * smoothstep(0.3, 1.5, d);
        gl_PointSize = 34.0 / d; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)) * vA * 0.35; gl_FragColor = vec4(uCol, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.visible = false;
  ocean.motes = pts; ocean.fx.add(pts);
}

// ---------------------------------------------------------------- dive shop on the beach
function buildDiveShop() {
  const x = 182, z = -26;
  const g = new THREE.Group(); g.position.set(x, 0, z); ocean.dock.add(g);
  const wall = stdMat({ color: '#f4f1ea' }), blue = stdMat({ color: '#2f8fd8' });
  const b = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 5.5), wall); b.position.y = 1.6; g.add(b);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.35, 6.5), blue); roof.position.y = 3.4; g.add(roof);
  const aw = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.12, 2.2), stdMat({ color: '#ffd23a' })); aw.position.set(0, 2.8, 3.6); aw.rotation.x = 0.25; g.add(aw);
  const tankM = stdMat({ color: '#ffcc22', metalness: 0.4, roughness: 0.4 });
  for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.7, 4, 10), tankM); t.position.set(-2.6 + i * 0.45, 0.55, 3.0); g.add(t); }
  const s = textSprite('🤿 DIVE SHOP', { size: 52, color: '#fff', bg: 'rgba(30,110,190,0.95)', scale: 2.2 }); s.position.set(0, 4.5, 2.9); g.add(s);
  addCollider(x - 3.5, 0, z - 2.75, x + 3.5, 3.4, z + 2.75);
  LOC.diveShop = { x, z: z + 4 };
  G.interacts.push({ x, z: z + 4.2, r: 4, label: () => '🤿 Dive Shop (scuba gear & tips)', action: () => G.openDiveShop && G.openDiveShop() });
}

// ---------------------------------------------------------------- HUD: depth & oxygen
let hud = null;
function hudEl() {
  if (hud) return hud;
  hud = document.createElement('div');
  hud.id = 'diveHud';
  hud.innerHTML = '<div class="dh-depth"></div><div class="dh-bar"><div class="dh-fill"></div></div><div class="dh-tip"></div>';
  document.getElementById('hud').appendChild(hud);
  return hud;
}
export function hasScuba() {
  const o = G.save.outfit;
  return o.glasses === 'scuba' || (o.extras || []).some(e => String(e).startsWith('tank'));
}

// ---------------------------------------------------------------- init + per-frame
export function initOcean() {
  ocean.fx = new THREE.Group(); ocean.dock = new THREE.Group(); ocean.detail = new THREE.Group();
  ocean.group.add(ocean.detail);
  G.scene.add(ocean.group, ocean.fx, ocean.dock);
  buildReef();
  buildFish();
  buildAnimals();
  buildWreck();
  buildCave();
  chest('kelp', 262, floorAt(262, 112), 112, 1.2);
  chest('jelly', 478, floorAt(478, -96), -96, -0.6);
  chest('pier', 218, floorAt(218, -22), -22, 0.8);
  chest('deep', 352, floorAt(352, -18), -18, 2.8);
  buildRays();
  buildCaustics();
  buildMotes();
  buildDiveShop();
  G.oxygen = 1;
  ocean.uwFog = new THREE.Fog('#1d7f93', 0.5, 60);
}

const deepCol = new THREE.Color('#06324a'), shallowCol = new THREE.Color('#1f8fa6'), murkCol = new THREE.Color('#3b6b4a'), caveCol = new THREE.Color('#06121c');
const fogC = new THREE.Color(), hemiUW = new THREE.Color('#a6e2f5'), WHITE = new THREE.Color('#ffffff');
let warnT = 0, breathT = 0, wasUnder = false;
export function updateOcean(dt, player) {
  U.uTime.value = G.time;
  const cam = G.camera;
  const focus = player.vehicle ? player.vehicle.pos : player.root;
  const camD = Math.hypot(cam.position.x - CX, cam.position.z - CZ);
  const near = camD < 460 && cam.position.y < 300;
  ocean.group.visible = near;
  ocean.detail.visible = cam.position.y < WATER_Y || (camD < 230 && cam.position.y < 60);
  if (near) {
    updateFish(dt, G.time, focus);
    updateAnimals(dt, G.time, focus, G.started ? player : null);
    updateChests(dt);
  }
  updateParts(dt);
  if (ocean.caustics) {
    const L = getLights();
    ocean.caustics.material.uniforms.uSun.value = clamp((L.sun.intensity - 0.3) / 1.5, 0, 1) * (G.inCave ? 0.15 : 1) * (1 - (G.overcast || 0) * 0.8) * (G.underwater ? 1 : 0.3 * clamp(1 - (cam.position.y - WATER_Y) / 40, 0, 1));
    ocean.caustics.material.uniforms.uCam.value.copy(cam.position);
  }
  // are we underwater?
  const camFloor = baseHeight(cam.position.x, cam.position.z);
  const under = cam.position.y < WATER_Y - 0.05 && camFloor < WATER_Y;
  G.underwater = under;
  const depth = Math.max(0, WATER_Y - cam.position.y);
  const inBayNow = inBay(cam.position.x, cam.position.z, -10);
  const c = ocean.cave, inCave = G.inCave = c && cam.position.x > c.x0 - 2 && cam.position.x < c.x1 + 2 && cam.position.z > c.z0 - 1 && cam.position.z < c.z1 + 1 && cam.position.y < c.y1;
  if (under) {
    const k = clamp(depth / 34, 0, 1);
    fogC.copy(inBayNow ? shallowCol : murkCol).lerp(deepCol, k);
    const L = getLights();
    const day = clamp((L.sun.intensity - 0.25) / 1.7, 0, 1);
    fogC.multiplyScalar(0.25 + 0.75 * day);
    if (inCave) fogC.lerp(caveCol, 0.8);
    ocean.uwFog.color.copy(fogC);
    ocean.uwFog.near = 0.5;
    ocean.uwFog.far = inCave ? 26 : inBayNow ? lerp(80, 42, k) : 16;
    if (ocean.caustics) ocean.caustics.material.uniforms.uFar.value = ocean.uwFog.far;
    G.scene.fog = ocean.uwFog;
    for (const cl of G.clouds || []) cl.visible = false;
    G.scene.background = fogC;
    if (G.sky) G.sky.visible = false;
    L.sun.intensity *= lerp(0.9, 0.45, k) * (inCave ? 0.25 : 1);
    L.hemi.color.copy(hemiUW);
    L.hemi.intensity = Math.max(L.hemi.intensity, 0.45) * lerp(1.25, 0.95, k) * (inCave ? 0.55 : 1);

    ocean.motes.visible = true;
    ocean.motes.material.uniforms.uCam.value.copy(cam.position);
  } else {
    if (G.scene.fog !== G.landFog) { G.scene.fog = G.landFog; for (const cl of G.clouds || []) cl.visible = true; }
    if (ocean.caustics) ocean.caustics.material.uniforms.uFar.value = 90;
    if (G.sky) G.sky.visible = true;
    getLights().hemi.color.copy(WHITE);

    ocean.motes.visible = false;
  }
  // god rays hang down from the surface around you
  const showRays = under && !inCave;
  for (const r of ocean.rays) {
    r.m.visible = showRays;
    if (!showRays) continue;
    if (Math.hypot(r.x - cam.position.x, r.z - cam.position.z) > 45 || r.x === 0) { const a = Math.random() * 6.28, d = 6 + Math.random() * 38; r.x = cam.position.x + Math.cos(a) * d; r.z = cam.position.z + Math.sin(a) * d; }
    r.m.position.set(r.x + Math.sin(G.time * 0.2 + r.ph) * 1.5, WATER_Y, r.z);
    r.m.scale.set(r.w, r.len, 1);
    r.m.rotation.set(0, Math.atan2(cam.position.x - r.x, cam.position.z - r.z), 0);
    r.m.rotateX(r.tilt);
    const L = getLights();
    r.m.material.opacity = (0.1 + 0.08 * Math.sin(G.time * 0.6 + r.ph)) * clamp((L.sun.intensity - 0.1) * 2, 0, 1);
  }
  // muffled sound + bubbling ambience
  if (under !== wasUnder) { setUnderwater(under); wasUnder = under; if (under && G.started) sfx.splash(); }
  ambience('under', under ? 0.5 : 0);
  G.gradeUW = under ? (inCave ? 0.8 : 1) : 0;
  if (G.started) breathing(dt, player, depth);
}

function breathing(dt, P, camDepth) {
  const el = hudEl();
  const headUnder = !P.vehicle && P.p[2].y < WATER_Y - 0.1 && baseHeight(P.root.x, P.root.z) < WATER_Y;
  const scuba = hasScuba();
  if (headUnder) {
    G.oxygen -= dt / (scuba ? 240 : 25);
    breathT -= dt;
    if (breathT <= 0) { breathT = scuba ? 2.2 : 3.5; bubbles(_f.copy(P.p[2]).add(_g.set(0, 0.25, 0)), scuba ? 6 : 3, 0.15); }
  } else G.oxygen = Math.min(1, G.oxygen + dt * 0.6);
  const diveDepth = P.vehicle && P.vehicle.type.sub ? WATER_Y - P.vehicle.pos.y : WATER_Y - P.root.y;
  const show = headUnder || G.oxygen < 0.999 || (P.vehicle && P.vehicle.type.sub);
  el.style.display = show ? 'block' : 'none';
  if (!show) return;
  el.querySelector('.dh-depth').textContent = `${P.vehicle && P.vehicle.type.sub ? '🟡 Sub' : scuba ? '🤿 Scuba' : '🫧 Holding breath'} · depth ${Math.max(0, Math.round(diveDepth))} m`;
  const fill = el.querySelector('.dh-fill');
  fill.style.width = Math.round(G.oxygen * 100) + '%';
  const low = G.oxygen < 0.25;
  fill.classList.toggle('low', low);
  el.querySelector('.dh-bar').style.display = P.vehicle && P.vehicle.type.sub ? 'none' : 'block';
  el.querySelector('.dh-tip').textContent = P.vehicle && P.vehicle.type.sub ? 'W/S thrust · A/D turn · Space rise · Shift/C dive · V sonar cockpit' : low ? '⚠️ LOW AIR — swim up! (Space)' : headUnder && !scuba && G.oxygen < 0.6 ? 'Tip: scuba gear from the Dive Shop lets you stay down 4 minutes' : headUnder ? 'C dive · Space swim up · Shift swim fast' : '';
  if (low && headUnder) { warnT -= dt; if (warnT <= 0) { warnT = 1.2; sfx.bad(); } }
  if (G.oxygen <= 0) {
    G.oxygen = 0.4;
    P.diving = false;
    P.root.y = WATER_Y - 0.9;
    for (const p of P.p) p.y = Math.max(p.y, WATER_Y - 1);
    P.flop(_f.set(0, 5, 0), 2);
    G.toast('😵 You ran out of air and floated to the surface! Get scuba gear at the Dive Shop to stay down longer.', 'bad', 7000);
  }
  void camDepth;
}
export { inBay };
