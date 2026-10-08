// The big open world around Bobbly Town: a height grid with biomes, lakes, a bay and highways.
import * as THREE from 'three';
import { LAND, G } from './state.js';

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
export function fbm(x, z, oct = 4) {
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

// ---------------------------------------------------------------- the island layout
// Bobbly Island (north is +z): Bobbly Town in the middle with Mega City to the west, the Mystery Cave in the rocky
// north-west hills, the Crazy Go-Kart Track out west, Bouncy Peaks (snowy mountains) in the north-east, the
// theme park and Park Lake east of town with the Funky Forest beyond, Slippy Bay opening to the sea in the south
// with sandy beaches, a palm islet in the bay and Treasure Island off the south-east coast.
export const HIGHWAYS = [
  { name: 'North Highway', x0: -30, z0: LAND, x1: -30, z1: 1050 },
  { name: 'South Highway', x0: 30, z0: -LAND, x1: 30, z1: -480 },
  { name: 'West Highway', x0: -LAND, z0: 30, x1: -1050, z1: 30 },
];
export const LAKES = [{ x: -640, z: 430, r: 120 }, { x: 620, z: 760, r: 90 }, { x: 860, z: 150, r: 70 }, { x: 370, z: 0, r: 78 }];
// Slippy Bay: the reef (the old Coral Bay lagoon, moved south of town) sits at the head of a wide bay that opens
// to the sea. BAY is the reef area; BAY_SHIFT maps the reef's original layout into it.
export const BAY_SHIFT = { x: -260, z: -720 };
export const BAY = { x0: -60, x1: 260, z0: -890, z1: -550 };
export const SLIPPY = { x0: -60, x1: 405, z1: -548 };
export const ISLANDS = [{ name: 'Treasure Island', x: 880, z: -1228, r: 58, h: 7 }, { name: 'Palm Islet', x: -150, z: -1050, r: 34, h: 3.5 }];
export const CAVE = { x: -330, z: 760, hillX: -330, hillZ: 860 };
// signed distance into Slippy Bay from its shore (positive = water); it widens towards the sea
export function bayDist(x, z) {
  const t = sm(SLIPPY.z1 - 40, -1150, z);
  const x0 = SLIPPY.x0 - t * 230 + (fbm(3.1, z / 120, 2) - 0.5) * 40 * t;
  const x1 = SLIPPY.x1 + t * 200 + (fbm(9.7, z / 120, 2) - 0.5) * 40 * t;
  const z1 = SLIPPY.z1 + (fbm(x / 110, 5.5, 2) - 0.5) * 30 * sm(SLIPPY.x0 + 60, SLIPPY.x0 + 160, x);
  return Math.min(x - x0, x1 - x, z1 - z);
}
// Sea floor of Slippy Bay: sandy shallows, reef terraces, and a deep basin
export function bayFloor(x, z) {
  const din = bayDist(x, z);
  const shelf = sm(6, 70, din), deep = sm(55, 150, din);
  let h = -0.3 - 3.7 * sm(0, 22, din) - 10 * shelf - 24 * deep;
  // reef bumps and terraces in the middle depths (around the reef), smoother sand elsewhere
  const reefArea = 1 - sm(0, 80, Math.max(BAY.x0 - x, 0, x - BAY.x1, BAY.z0 - z, z - BAY.z1));
  const reef = fbm(x / 34 + 40, z / 34 - 11, 4);
  h += (reef - 0.22) * 18 * shelf * (1 - deep * 0.6) * reefArea;
  h += Math.max(0, reef - 0.3) * 40 * shelf * (1 - deep) * reefArea;
  h += Math.sin(x / 5.5 + Math.sin(z / 9) * 1.6) * 0.25 * shelf;
  return Math.min(h, -0.25);
}
// Flat building zones
export const ZONES = {
  city: { x0: -1000, x1: -200, z0: -470, z1: 280, h: 0 },
  valley: { x0: 600, x1: 980, z0: -980, z1: -700, h: 'auto' },
  suburb: { x0: 140, x1: 560, z0: 185, z1: 440, h: 0 },
  space: { x0: 720, x1: 940, z0: -380, z1: -170, h: 'auto' },
  townpark: { x0: 200, x1: 545, z0: -178, z1: 178, h: 0 },
  farm2: { x0: -980, x1: -800, z0: -700, z1: -540, h: 'auto' },
  village2: { x0: 1000, x1: 1120, z0: -620, z1: -500, h: 'auto' },
  gasN: { x0: -20, x1: 10, z0: 690, z1: 730, h: 'auto' },
  gasS: { x0: 40, x1: 70, z0: -470, z1: -430, h: 'auto' },
  camp: { x0: -560, x1: -500, z0: 520, z1: 580, h: 'auto' },
  intl: { x0: 420, x1: 980, z0: -620, z1: -425, h: 'auto' },
  swAir: { x0: -1095, x1: -745, z0: -1085, z1: -975, h: 'auto' },
  jail: { x0: -175, x1: -105, z0: -305, z1: -235, h: 0 },
  park: { x0: 668, x1: 985, z0: -150, z1: 22, h: 'auto' },
  kart: { x0: -1060, x1: -790, z0: 560, z1: 800, h: 'auto' },
  cave: { x0: -366, x1: -294, z0: 722, z1: 790, h: 'auto' },
  cable: { x0: 776, x1: 816, z0: 318, z1: 352, h: 'auto' },
  stunt: { x0: -720, x1: -380, z0: -885, z1: -740, h: 'auto' },
  intlRw: { x0: 346, x1: 985, z0: -490, z1: -420, h: 'intl' },   // the long international runway
};
export const FUNKY = { x: 1060, z: 120, r: 330 };     // the Funky Forest: bright pink, purple and teal trees
// Rivers split the island into regions (highways cross them on bridges)
export const RIVERS = [
  { w: 24, pts: [[120, 1150], [60, 720], [-60, 520], [-160, 390], [-460, 335], [-820, 300], [-1340, 280]] },
  { w: 22, pts: [[1340, 620], [1060, 470], [920, 230], [870, 160]] },
  { w: 18, pts: [[372, -76], [350, -300], [300, -450], [240, -570]] },
];
function polyDist(x, z, pts) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, { x0: pts[i][0], z0: pts[i][1], x1: pts[i + 1][0], z1: pts[i + 1][1] }));
  return d;
}
export function riverDist(x, z) { let d = 1e9; for (const r of RIVERS) d = Math.min(d, polyDist(x, z, r.pts) - r.w / 2); return d; }
export function inZone(x, z, m = 0) {
  for (const k in ZONES) { const r = ZONES[k]; if (x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m) return k; }
  return null;
}

function segDist(x, z, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t));
}

// Biome weights (0..1)
export function biome(x, z) {
  return {
    north: sm(380, 860, z) * sm(-380, 120, x),                              // Bouncy Peaks (north-east)
    south: sm(300, 750, -z) * 0.6,
    west: sm(250, 700, -x) * (1 - sm(250, 800, z) * 0.6),
    east: sm(250, 600, x),
    funky: 1 - sm(FUNKY.r * 0.7, FUNKY.r, Math.hypot(x - FUNKY.x, z - FUNKY.z)),
  };
}
// distance from the coast (positive = inland). The island is a big rounded blob with a wobbly shoreline.
export function coastDist(x, z) {
  const n = Math.pow(Math.pow(Math.abs(x), 6) + Math.pow(Math.abs(z), 6), 1 / 6);
  const a = Math.atan2(z, x);
  const wob = (fbm(Math.cos(a) * 3 + 11, Math.sin(a) * 3 - 4, 3) - 0.5) * 110;
  return 1150 + wob - n;
}

function rawHeight(x, z, noRiver = false, noZones = false) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  const b = biome(x, z);
  const low = (fbm(x / 700 + 3, z / 700 - 7, 3) - 0.5) * 50;
  const hills = fbm(x / 180 + 10, z / 180, 4);
  const ridge = ridged(x / 320 + 5, z / 320 + 2, 5);
  const profile = 14 + (low + 25) * 0.4 + b.north * 30;
  let h = profile;
  h += b.west * (hills - 0.3) * 60;
  h += b.north * (Math.pow(ridge, 1.3) * 330 + fbm(x / 90, z / 90, 3) * 25);
  h += b.south * (hills - 0.4) * 40;
  h += b.east * (hills - 0.5) * 22;
  // the rocky hill in the north-west with the Mystery Cave in it
  const ch = Math.hypot(x - CAVE.hillX, z - CAVE.hillZ);
  h += (1 - sm(60, 260, ch)) * (70 + ridged(x / 60, z / 60, 3) * 30);
  // gentle corridors along the highways
  let dr = 1e9;
  for (const hw of HIGHWAYS) dr = Math.min(dr, segDist(x, z, hw));
  h = mix(profile, h, sm(12, 90, dr));
  // sandy beaches: the land slopes gently down to Slippy Bay
  const bd = bayDist(x, z);
  if (bd < 0) h = mix(0.35 - bd * 0.025, h, sm(30, 170, -bd));
  // flat building zones
  if (!noZones) for (const k in ZONES) {
    const rz = ZONES[k];
    if (rz.h === 'auto') rz.h = rawHeight((rz.x0 + rz.x1) / 2, (rz.z0 + rz.z1) / 2, true, true);
    else if (typeof rz.h === 'string') rz.h = ZONES[rz.h].h;
    const zx = Math.max(rz.x0 - x, 0, x - rz.x1), zz = Math.max(rz.z0 - z, 0, z - rz.z1);
    h = mix(rz.h, h, sm(0, rz.h ? 50 : 70, Math.hypot(zx, zz)));
  }
  // flat town in the middle
  h *= sm(LAND + 8, 330, r);
  // rivers
  if (!noRiver) for (const rv of RIVERS) {
    const d = polyDist(x, z, rv.pts);
    if (d < rv.w + 40) h = mix(h, -3.5, 1 - sm(rv.w * 0.5, rv.w * 0.5 + 26, d));
  }
  // Slippy Bay
  if (bd > -12) h = mix(h, bayFloor(x, z), sm(-12, 6, bd));
  // lakes
  for (const l of LAKES) h = mix(h, -4, 1 - sm(l.r * 0.6, l.r, Math.hypot(x - l.x, z - l.z)));
  // the sea all around the island (beaches first), but never under an airport or town
  const cd = coastDist(x, z), keep = noZones ? 0 : inZone(x, z, 40) ? 1 : 0;
  if (!keep) {
    h = mix(Math.min(h, 0.4 + cd * 0.02), h, sm(20, 120, cd));
    h = mix(h, -6 - Math.min(22, -cd * 0.12), sm(10, -40, cd));
  }
  // islands
  for (const il of ISLANDS) {
    const d = Math.hypot(x - il.x, z - il.z);
    if (d < il.r * 1.6) h = Math.max(h, il.h * (1 - sm(il.r * 0.35, il.r, d)) + (fbm(x / 12, z / 12, 2) - 0.5) * 2 * (1 - sm(0, il.r, d)) - 4 * sm(il.r, il.r * 1.6, d));
  }
  return h;
}

// Reshape the ground after it's generated (used to dig cuttings and build embankments for the railway).
export function editGrid(near, fn) {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -WORLD + i * STEP, z = -WORLD + j * STEP;
    if (!near(x, z)) continue;
    const k = j * N + i; grid[k] = fn(x, z, grid[k]);
  }
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
// natural colours (the ground shader lays real photos over them; the island map uses them as they are)
const COL = { grass: C('#6c8a42'), forest: C('#56763a'), sand: C('#dcc89e'), desert: C('#a2a462'), rock: C('#8c8478'), snow: C('#f4f7fa'), beach: C('#dcc89e'), dark: C('#4f7040'), seaSand: C('#cdb88f'), algae: C('#5f7a45'), funky: C('#78b860') };
// The colour of the ground anywhere on the island (the terrain and the island map both use it).
export function groundColor(x, z, h, c) {
  const b = biome(x, z);
  const r = Math.max(Math.abs(x), Math.abs(z));
  const slope = slopeAt(x, z);
  c.copy(COL.grass).lerp(COL.forest, b.west).lerp(COL.desert, b.south).lerp(COL.funky, b.funky * 0.6);
  // sand only along the water: beaches, the bay, the coast and round the islands
  if (r > LAND + 1) {
    let near = Math.max(sm(-80, -40, bayDist(x, z)), 1 - sm(40, 80, coastDist(x, z)));
    for (const il of ISLANDS) near = Math.max(near, 1 - sm(il.r + 8, il.r + 30, Math.hypot(x - il.x, z - il.z)));
    c.lerp(COL.beach, near * (1 - sm(1.6, 3.6, h)));
  }
  if (h < -3) {
    // sea floor: pale sand in the shallows, darker sand and rock down deep, with patchy algae
    c.lerp(COL.seaSand, Math.min(1, (-3 - h) / 30));
    const patch = fbm(x / 22 + 7, z / 22 + 3, 3);
    if (patch > 0.58) c.lerp(COL.algae, Math.min(0.55, (patch - 0.58) * 3));
  }
  if (slope > 0.55) c.lerp(COL.rock, Math.min(1, (slope - 0.55) * 3));
  const snowLine = 95 - b.north * 30;                     // Bouncy Peaks are snowy lower down
  if (h > snowLine) c.lerp(COL.snow, Math.min(1, (h - snowLine) / 22));
  if (ISLANDS.some(il => Math.hypot(x - il.x, z - il.z) < il.r * 0.92) && h > -1) c.copy(COL.beach);
  return c;
}

// The ground is built as square tiles so the ones behind you or past the fog aren't drawn.
export function buildTerrainMesh(scene) {
  const c = new THREE.Color();
  const cols = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3);
  const H = (i, j) => grid[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = -WORLD + i * STEP, z = -WORLD + j * STEP, h = grid[k];
    groundColor(x, z, h, c);
    const v = (hash(i, j) - 0.5) * 0.06;
    cols[k * 3] = c.r + v; cols[k * 3 + 1] = c.g + v; cols[k * 3 + 2] = c.b + v;
    const nx = -(H(i + 1, j) - H(i - 1, j)) / (2 * STEP), nz = -(H(i, j + 1) - H(i, j - 1)) / (2 * STEP), l = Math.hypot(nx, 1, nz);
    nrm[k * 3] = nx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = nz / l;
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const T = 30, tiles = [];
  for (let tj = 0; tj < N - 1; tj += T) for (let ti = 0; ti < N - 1; ti += T) {
    const nI = Math.min(T, N - 1 - ti), nJ = Math.min(T, N - 1 - tj), vw = nI + 1;
    const pos = new Float32Array((nI + 1) * (nJ + 1) * 3), col = new Float32Array(pos.length), nor = new Float32Array(pos.length), uv = new Float32Array((nI + 1) * (nJ + 1) * 2), idx = [];
    for (let j = 0; j <= nJ; j++) for (let i = 0; i <= nI; i++) {
      const gi = ti + i, gj = tj + j, k = gj * N + gi, o = j * vw + i, x = -WORLD + gi * STEP, z = -WORLD + gj * STEP;
      pos[o * 3] = x; pos[o * 3 + 1] = grid[k]; pos[o * 3 + 2] = z;
      col.set(cols.subarray(k * 3, k * 3 + 3), o * 3); nor.set(nrm.subarray(k * 3, k * 3 + 3), o * 3);
      uv[o * 2] = (x + WORLD) / (2 * WORLD); uv[o * 2 + 1] = (WORLD - z) / (2 * WORLD);
    }
    for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
      const a = j * vw + i, bb = (j + 1) * vw + i, cc = (j + 1) * vw + i + 1, d = j * vw + i + 1;
      idx.push(a, bb, d, bb, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    scene.add(mesh); tiles.push(mesh);
  }
  return { material, tiles };
}

// Road strips that follow the ground.
export function roadHeight(x, z) { return Math.max(rawHeight(x, z, true), 0); }
export function buildHighways(scene, roadMat) {
  const bridges = [];
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
        verts.push(vx, Math.max(heightAt(vx, vz), roadHeight(x, z)) + 0.12, vz);
        uvs.push(s < 0 ? 0 : 1, (len * t) / 10);
      }
      if (k < n) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const rh = roadHeight(x, z);
      if (rh - heightAt(x, z) > 2) bridges.push({ x, z, y: rh + 0.12, dx, dz, len: len / n });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = roadMat.map.clone(); tex.needsUpdate = true; tex.repeat.set(1, 1);
    const rm = roadMat.clone(); rm.map = tex; rm.side = THREE.DoubleSide;
    const m = new THREE.Mesh(g, rm);
    (G.roadMats ||= []).push(rm);
    m.receiveShadow = true;
    scene.add(m);
  }
  return bridges;
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
