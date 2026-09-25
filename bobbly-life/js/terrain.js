// The big open world around Bobbly Town: a height grid with biomes, lakes, a bay and highways.
import * as THREE from 'three';
import { LAND } from './state.js';

export const WORLD = 1320;           // half-size of the whole map
const STEP = 8;                      // grid spacing (matches the terrain mesh)
const N = Math.round(WORLD * 2 / STEP) + 1;
const grid = new Float32Array(N * N);

// ---------------------------------------------------------------- noise
function hash(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function ridged(x, z, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1); s += v * v * a; n += a; a *= 0.5; f *= 2.1; }
  return s / n;
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- highways, lakes, landmarks
export const HIGHWAYS = [
  { name: 'North Highway', x0: -30, z0: LAND, x1: -30, z1: 1050 },
  { name: 'South Highway', x0: 30, z0: -LAND, x1: 30, z1: -1050 },
  { name: 'West Highway', x0: -LAND, z0: 30, x1: -1050, z1: 30 },
];
export const LAKES = [{ x: -640, z: 430, r: 120 }, { x: 520, z: -640, r: 45 }, { x: 620, z: 700, r: 90 }];
const BAY = { x0: 200, x1: 520, z0: -170, z1: 170 };

function segDist(x, z, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t));
}

// Biome weights (0..1)
export function biome(x, z) {
  return {
    north: sm(250, 800, z) * (1 - sm(500, 900, Math.abs(x) - 200) * 0.3),
    south: sm(250, 750, -z),
    west: sm(250, 700, -x) * (1 - sm(250, 800, z)) ,
    east: sm(250, 600, x),
  };
}

function rawHeight(x, z) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  const b = biome(x, z);
  const low = (fbm(x / 700 + 3, z / 700 - 7, 3) - 0.5) * 50;
  const hills = fbm(x / 180 + 10, z / 180, 4);
  const ridge = ridged(x / 320 + 5, z / 320 + 2, 5);
  const dunes = Math.sin(x / 38 + fbm(x / 200, z / 200, 2) * 7) * 0.5 + 0.5;
  const profile = 14 + (low + 25) * 0.4 + b.north * 30;
  let h = profile;
  h += b.west * (hills - 0.3) * 60;
  h += b.north * (Math.pow(ridge, 1.3) * 330 + fbm(x / 90, z / 90, 3) * 25);
  h += b.south * (dunes * 7 + (hills - 0.5) * 22);
  h += b.east * (hills - 0.5) * 22;
  // gentle corridors along the highways
  let dr = 1e9;
  for (const hw of HIGHWAYS) dr = Math.min(dr, segDist(x, z, hw));
  h = mix(profile, h, sm(12, 90, dr));
  // flat town in the middle
  h *= sm(LAND + 8, 330, r);
  // bay east of town (where the pier is)
  const bx = Math.max(BAY.x0 - x, 0, x - BAY.x1), bz = Math.max(BAY.z0 - z, 0, z - BAY.z1);
  h = mix(h, -4, 1 - sm(0, 12, Math.hypot(bx, bz)));
  // lakes
  for (const l of LAKES) h = mix(h, -4, 1 - sm(l.r * 0.6, l.r, Math.hypot(x - l.x, z - l.z)));
  // ocean all around the island
  h = mix(h, -9, sm(WORLD - 190, WORLD - 30, r));
  return h;
}

export function buildHeights() {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) grid[j * N + i] = rawHeight(-WORLD + i * STEP, -WORLD + j * STEP);
}

// Fast bilinear lookup (used by all the physics).
export function heightAt(x, z) {
  const fx = (x + WORLD) / STEP, fz = (z + WORLD) / STEP;
  if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return -9;
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1];
  // match the mesh's triangle split so feet sit on the visible ground
  if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

export function slopeAt(x, z) {
  return Math.hypot(heightAt(x + 4, z) - heightAt(x - 4, z), heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
}

// ---------------------------------------------------------------- meshes
const C = (h) => new THREE.Color(h);
const COL = { grass: C('#7ccf5a'), forest: C('#5aa847'), sand: C('#f2dc9a'), desert: C('#f0cf86'), rock: C('#9b9186'), snow: C('#f4f8ff'), beach: C('#f2dc9a'), dark: C('#4f8f3f') };
export function buildTerrainMesh(scene) {
  const segs = N - 1;
  const g = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, segs, segs);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const i = Math.round((x + WORLD) / STEP), j = Math.round((z + WORLD) / STEP);
    const h = grid[j * N + i];
    pos.setY(k, h);
    const b = biome(x, z);
    const r = Math.max(Math.abs(x), Math.abs(z));
    const slope = slopeAt(x, z);
    c.copy(COL.grass).lerp(COL.forest, b.west).lerp(COL.desert, b.south);
    if (h < 0.8 && r > LAND + 1) c.copy(COL.beach);
    if (slope > 0.55) c.lerp(COL.rock, Math.min(1, (slope - 0.55) * 3));
    if (h > 95) c.lerp(COL.snow, Math.min(1, (h - 95) / 25));
    const v = (hash(i, j) - 0.5) * 0.06;
    cols[k * 3] = c.r + v; cols[k * 3 + 1] = c.g + v; cols[k * 3 + 2] = c.b + v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Road strips that follow the ground.
export function buildHighways(scene, roadMat) {
  for (const hw of HIGHWAYS) {
    const len = Math.hypot(hw.x1 - hw.x0, hw.z1 - hw.z0);
    const n = Math.ceil(len / 6);
    const dx = (hw.x1 - hw.x0) / len, dz = (hw.z1 - hw.z0) / len;
    const px = -dz * 5, pz = dx * 5;
    const verts = [], uvs = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = hw.x0 + (hw.x1 - hw.x0) * t, z = hw.z0 + (hw.z1 - hw.z0) * t;
      for (const s of [-1, 1]) {
        const vx = x + px * s, vz = z + pz * s;
        verts.push(vx, Math.max(heightAt(vx, vz), heightAt(x, z)) + 0.12, vz);
        uvs.push(s < 0 ? 0 : 1, (len * t) / 10);
      }
      if (k < n) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = roadMat.map.clone(); tex.needsUpdate = true; tex.repeat.set(1, 1);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    scene.add(m);
  }
}

// Find the highest point in an area (for the mountain summit).
export function findPeak(x0, z0, x1, z1) {
  let best = { x: 0, z: 0, h: -1e9 };
  for (let z = z0; z <= z1; z += STEP) for (let x = x0; x <= x1; x += STEP) {
    const h = heightAt(x, z);
    if (h > best.h) best = { x, z, h };
  }
  return best;
}

// Deterministic random so every player gets the same forests.
let seed = 12345;
export function srand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
