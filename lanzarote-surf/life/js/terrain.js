// The real island of Lanzarote: elevation data (SRTM via AWS Terrain Tiles) sampled smoothly, with flattened
// building pads and roads, drawn as level-of-detail tiles that follow the camera.
// World frame (same as the surf game): x = east, z = south, metres, origin 29.06 N 13.64 W, sea level y = 0.
import * as THREE from 'three';
import { G } from './state.js';

// The data grid is in the surf game's frame (origin 29.06 N 13.64 W). Here the world is shifted so the middle
// of Arrecife (where Bobbly's town centre stands) is at 0,0.
const DATA = { LAT0: 29.06, LON0: -13.64 };
const MLAT = 111320, MLON = 111320 * Math.cos(DATA.LAT0 * Math.PI / 180);
const llRaw = (lat, lon) => ({ x: (lon - DATA.LON0) * MLON, z: -(lat - DATA.LAT0) * MLAT });
export const ORIGIN = { lat: 28.9705, lon: -13.5605 };
export const OFF = llRaw(ORIGIN.lat, ORIGIN.lon);
export const GEO = { N: 1536, S: 56000, XMIN: -29000 - OFF.x, ZMIN: -29500 - OFF.z };
export function ll2w(lat, lon) { const p = llRaw(lat, lon); return { x: p.x - OFF.x, z: p.z - OFF.z }; }
export function w2ll(x, z) { x += OFF.x; z += OFF.z; return { lat: DATA.LAT0 - z / MLAT, lon: DATA.LON0 + x / MLON }; }
export const WORLD = 40000;           // (bigger than the island in every direction)
// the land of Lanzarote and La Graciosa (with a margin)
const _b0 = ll2w(29.29, -13.89), _b1 = ll2w(28.82, -13.40);
export const ISLAND_BOX = { x0: _b0.x, z0: _b0.z, x1: _b1.x, z1: _b1.z };
export const MAP_BOX = { x0: GEO.XMIN, z0: GEO.ZMIN, x1: GEO.XMIN + GEO.S, z1: GEO.ZMIN + GEO.S };
const NG = GEO.N, CELL = GEO.S / NG;
let HG = null;                         // raw heights (36 m grid)
let ALB = null;                        // albedo pixels (RGBA) for the map and ground colours
export let albedoTex = null, heightImage = null;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

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

// ---------------------------------------------------------------- loading
async function loadPixels(url) {
  const blob = await (await fetch(url)).blob();
  let bmp;
  try { bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
  catch (e) { bmp = await createImageBitmap(blob); }
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  return { data: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, bmp };
}
export async function loadIsland(base = '../assets/') {
  const [hp, ap] = await Promise.all([loadPixels(base + 'height.png'), loadPixels(base + 'albedo.jpg')]);
  HG = new Float32Array(NG * NG);
  for (let i = 0; i < NG * NG; i++) HG[i] = (hp.data[i * 4] * 256 + hp.data[i * 4 + 1]) / 10 - 500;
  ALB = ap;
  albedoTex = new THREE.Texture(ap.bmp);
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.flipY = false;
  albedoTex.wrapS = albedoTex.wrapT = THREE.ClampToEdgeWrapping;
  albedoTex.anisotropy = 8;
  albedoTex.needsUpdate = true;
  heightImage = hp;
  if (!ROADS.length) await loadRoads('assets/roads.json');
}

// raw height on the 36 m grid (clamped)
function hg(i, j) {
  i = i < 0 ? 0 : i > NG - 1 ? NG - 1 : i; j = j < 0 ? 0 : j > NG - 1 ? NG - 1 : j;
  return HG[j * NG + i];
}
// smooth (Catmull-Rom) height from the data
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
export function dataHeight(x, z) {
  if (!HG) return -20;
  const fx = (x - GEO.XMIN) / CELL - 0.5, fz = (z - GEO.ZMIN) / CELL - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const r = (jj) => cr(hg(i - 1, jj), hg(i, jj), hg(i + 1, jj), hg(i + 2, jj), tx);
  return cr(r(j - 1), r(j), r(j + 1), r(j + 2), tz);
}

// ---------------------------------------------------------------- pads (flat ground for buildings) and roads
// pad: { x, z, w, d, rot, h, blend }   (rot = rotation of the rectangle, radians)
const pads = [];
const PCELL = 128, PGRID = new Map();
const pkey = (ix, iz) => (ix + 1000) * 4000 + (iz + 1000);
function hashInsert(item, x0, z0, x1, z1) {
  for (let ix = Math.floor(x0 / PCELL); ix <= Math.floor(x1 / PCELL); ix++)
    for (let iz = Math.floor(z0 / PCELL); iz <= Math.floor(z1 / PCELL); iz++) {
      const k = pkey(ix, iz);
      let l = PGRID.get(k); if (!l) PGRID.set(k, l = []);
      l.push(item);
    }
}
export function addPad(x, z, w, d, rot = 0, h = null, blend = 30) {
  if (h === null) {
    // average ground height over the pad
    let s = 0, n = 0;
    for (let a = -0.5; a <= 0.5; a += 0.25) for (let b = -0.5; b <= 0.5; b += 0.25) {
      const lx = a * w, lz = b * d, c = Math.cos(rot), sn = Math.sin(rot);
      s += Math.max(0.8, dataHeight(x + lx * c + lz * sn, z - lx * sn + lz * c)); n++;
    }
    h = s / n;
  }
  const p = { kind: 'pad', x, z, w, d, rot, c: Math.cos(rot), s: Math.sin(rot), h, blend };
  const R = Math.hypot(w, d) / 2 + blend;
  pads.push(p);
  hashInsert(p, x - R, z - R, x + R, z + R);
  return p;
}
// is (x,z) on (or within m metres of) a building pad?
export function padAt(x, z, m = 0) {
  const l = PGRID.get(pkey(Math.floor(x / PCELL), Math.floor(z / PCELL)));
  if (l) for (const it of l) {
    if (it.kind !== 'pad') continue;
    const dx = x - it.x, dz = z - it.z, lx = dx * it.c - dz * it.s, lz = dx * it.s + dz * it.c;
    if (Math.abs(lx) < it.w / 2 + m && Math.abs(lz) < it.d / 2 + m) return true;
  }
  return false;
}
// roads: polylines with smoothed heights
export const ROADS = [];          // { name, pts:[{x,z,h}] , w }
export const ROADSEGS = [];
async function loadRoads(url) {
  try {
    const d = await (await fetch(url)).json();
    for (const r of d.roads) addRoad(r.pts.map(([x, z]) => ({ x: x - OFF.x, z: z - OFF.z })), 9, r.a + ' – ' + r.b);
    TOWN_PTS = d.towns;
  } catch (e) { console.warn('roads missing', e); }
}
export let TOWN_PTS = {};
export function addRoad(pts, w = 9, name = '') {
  // smooth the ground height along the road so it doesn't follow every bump
  const raw = pts.map((p) => Math.max(0.9, dataHeight(p.x, p.z)));
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  for (let i = 0; i < pts.length; i++) {
    let s = 0, n = 0;
    for (let k = i; k >= 0 && L[i] - L[k] < 45; k--) { s += raw[k]; n++; }
    for (let k = i + 1; k < pts.length && L[k] - L[i] < 45; k++) { s += raw[k]; n++; }
    pts[i].h = s / n;
  }
  const road = { name, pts, w };
  ROADS.push(road);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = { kind: 'road', a, b, w, road, i, dx: b.x - a.x, dz: b.z - a.z };
    seg.len2 = seg.dx * seg.dx + seg.dz * seg.dz || 1;
    ROADSEGS.push(seg);
    const m = w / 2 + 8;
    hashInsert(seg, Math.min(a.x, b.x) - m, Math.min(a.z, b.z) - m, Math.max(a.x, b.x) + m, Math.max(a.z, b.z) + m);
  }
  return road;
}
// nearest road to a point: { d, x, z, h, seg, t }
export function nearestRoad(x, z, maxD = 60) {
  let best = null;
  const r = Math.ceil(maxD / PCELL);
  for (let ix = Math.floor(x / PCELL) - r; ix <= Math.floor(x / PCELL) + r; ix++)
    for (let iz = Math.floor(z / PCELL) - r; iz <= Math.floor(z / PCELL) + r; iz++) {
      const l = PGRID.get(pkey(ix, iz)); if (!l) continue;
      for (const s of l) {
        if (s.kind !== 'road') continue;
        let t = ((x - s.a.x) * s.dx + (z - s.a.z) * s.dz) / s.len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = s.a.x + s.dx * t, pz = s.a.z + s.dz * t, dd = Math.hypot(x - px, z - pz);
        if (dd < maxD && (!best || dd < best.d)) best = { d: dd, x: px, z: pz, h: s.a.h + (s.b.h - s.a.h) * t, seg: s, t };
      }
    }
  return best;
}

// how much a point is "developed" (on a road or pad): 0 = wild ground, 1 = flat road/pad
let lastFlat = 0;
export const flatAmount = () => lastFlat;

// ---------------------------------------------------------------- the height used by everything
export function heightAt(x, z) {
  let h = dataHeight(x, z);
  // a little roughness the 36 m data can't show (none under water)
  const land = sm(0.6, 4, h);
  let detail = ((vnoise(x / 9, z / 9) - 0.5) * 0.7 + (vnoise(x / 31 + 7, z / 31) - 0.5) * 1.6) * land;
  let flat = 0;
  const l = PGRID.get(pkey(Math.floor(x / PCELL), Math.floor(z / PCELL)));
  // roads first, then building pads on top (a road that crosses a pad runs across it at the pad's height)
  if (l) for (let pass = 0; pass < 2; pass++) for (const it of l) {
    if ((it.kind === 'pad') !== (pass === 1)) continue;
    if (it.kind === 'pad') {
      const dx = x - it.x, dz = z - it.z;
      const lx = dx * it.c - dz * it.s, lz = dx * it.s + dz * it.c;
      const ox = Math.max(Math.abs(lx) - it.w / 2, 0), oz = Math.max(Math.abs(lz) - it.d / 2, 0);
      const o = Math.hypot(ox, oz);
      if (o > it.blend) continue;
      const k = 1 - sm(0, it.blend, o);
      h = mix(h, it.h, k); flat = Math.max(flat, k);
    } else {
      let t = ((x - it.a.x) * it.dx + (z - it.a.z) * it.dz) / it.len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - it.a.x - it.dx * t, z - it.a.z - it.dz * t);
      const hw = it.w / 2 + 1;
      if (d > hw + 7) continue;
      const k = 1 - sm(hw, hw + 7, d);
      const rh = it.a.h + (it.b.h - it.a.h) * t;
      h = mix(h, rh, k); flat = Math.max(flat, k);
    }
  }
  lastFlat = flat;
  return h + detail * (1 - flat);
}

export function slopeAt(x, z) {
  return Math.hypot(heightAt(x + 4, z) - heightAt(x - 4, z), heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
}

// ---------------------------------------------------------------- zones (flattened areas other modules look for)
export const ZONES = {};
export function addZone(name, x, z, w, d, h = null) {
  const p = addPad(x, z, w, d, 0, h, 40);
  ZONES[name] = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: p.h };
  return ZONES[name];
}
export function inZone(x, z, m = 0) {
  for (const k in ZONES) { const r = ZONES[k]; if (x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m) return k; }
  return null;
}

// things Bobbly's modules expect from its terrain (no rivers, lakes or magic forests on Lanzarote)
export const HIGHWAYS = [];
export const LAKES = [];
export const ISLANDS = [];
export const RIVERS = [];
export function riverDist() { return 1e9; }
export const FUNKY = { x: 1e7, z: 1e7, r: 1 };
export const CAVE = { x: 0, z: 0, hillX: 0, hillZ: 0 };
// the dive reef (Bobbly's the Playa Chica reef) sits off Playa Chica in Puerto del Carmen, Lanzarote's favourite dive site
const _bay = ll2w(28.9140, -13.6795);
export const BAY = { x0: _bay.x - 160, x1: _bay.x + 160, z0: _bay.z - 170, z1: _bay.z + 170 };
export const BAY_SHIFT = { x: BAY.x0 - 200, z: BAY.z0 + 170 };
export function bayDist() { return -1e9; }
export function coastDist(x, z) { return dataHeight(x, z) * 20; }
export function biome() { return { north: 0, south: 1, west: 0, east: 0, funky: 0 }; }
export function editGrid(near, fn) { /* the railway isn't built on Lanzarote */ }
export function buildHeights() { }

// ground colour from the painted island map (used by the phone map and for tinting)
const _c = new THREE.Color();
export function groundColor(x, z, h, c) {
  if (!ALB) return c.set('#a08060');
  const i = Math.max(0, Math.min(ALB.w - 1, Math.floor((x - GEO.XMIN) / GEO.S * ALB.w)));
  const j = Math.max(0, Math.min(ALB.h - 1, Math.floor((z - GEO.ZMIN) / GEO.S * ALB.h)));
  const k = (j * ALB.w + i) * 4;
  c.setRGB(ALB.data[k] / 255, ALB.data[k + 1] / 255, ALB.data[k + 2] / 255, THREE.SRGBColorSpace);
  if (h < 0) c.lerp(_c.set('#1d6f8a'), Math.min(1, 0.4 - h / 30));
  return c;
}

export function findPeak(x0, z0, x1, z1) {
  let best = { x: 0, z: 0, h: -1e9 };
  const st = Math.max(8, (x1 - x0) / 80);
  for (let z = z0; z <= z1; z += st) for (let x = x0; x <= x1; x += st) {
    const h = dataHeight(x, z);
    if (h > best.h) best = { x, z, h };
  }
  return best;
}
// march from a point out at sea toward the land to find the shore
export function findCoast(x, z, sx, sz) {
  let px = x + sx * 1500, pz = z + sz * 1500;
  for (let i = 0; i < 3000; i++) {
    if (dataHeight(px, pz) > 0.5) return { x: px - sx * 2, z: pz - sz * 2 };
    px -= sx; pz -= sz;
  }
  return { x, z };
}
// nearest dry land (for things whose real coordinates sit right on the waterline)
export function nearestLand(x, z, minH = 3) {
  if (dataHeight(x, z) >= minH) return { x, z };
  for (let r = 20; r < 3000; r += 20) for (let a = 0; a < 16; a++) {
    const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
    if (dataHeight(px, pz) >= minH) return { x: px, z: pz };
  }
  return { x, z };
}

let seed = 12345;
export function srand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

// ---------------------------------------------------------------- terrain: a quadtree of tiles with level of detail
// The island is split into 4 km squares. Near the camera a square splits into four, and again, down to 256 m
// tiles; every tile is the same 64 x 64 grid, so near tiles have 4 m detail and the far hills 64 m.
const ROOT = 4096, MINS = 256;
let NGRID = 64;
let terrMat = null, terrGroup = null;
const nodes = new Map();            // key -> { mesh, used }
const roots = [];

function areaHasLand(x0, z0, size) {
  const n = Math.max(4, Math.min(24, Math.round(size / 160)));
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) if (dataHeight(x0 + a * size / n, z0 + b * size / n) > -14) return true;
  return false;
}

// near tiles get the finest grid, far ones (which cover more ground but look small) a coarser one
const gridFor = (size) => (size <= 512 ? NGRID : size <= 1024 ? NGRID * 0.75 : NGRID / 2);
function buildNodeGeo(x0, z0, size) {
  const n = gridFor(size), step = size / n;
  const W = n + 3;                                   // one extra sample around for normals
  const hs = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) hs[j * W + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const vcount = (n + 1) * (n + 1) + 4 * (n + 1);
  const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3);
  let v = 0;
  const put = (x, y, z, nx, ny, nz) => { pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz; v++; };
  const N3 = [0, 1, 0];
  const normal = (i, j) => {
    const hx = hs[(j + 1) * W + i + 2] - hs[(j + 1) * W + i], hz = hs[(j + 2) * W + i + 1] - hs[j * W + i + 1];
    const l = Math.hypot(hx, 2 * step, hz); N3[0] = -hx / l; N3[1] = 2 * step / l; N3[2] = -hz / l; return N3;
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const nn = normal(i, j);
    put(i * step - size / 2, hs[(j + 1) * W + i + 1], j * step - size / 2, nn[0], nn[1], nn[2]);
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + n + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // skirts hide the cracks between tiles of different detail
  const drop = step * 1.5 + 1;
  const edge = (list) => {
    const start = v;
    for (const [i, j] of list) { const k = j * (n + 1) + i; put(pos[k * 3], pos[k * 3 + 1] - drop, pos[k * 3 + 2], nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]); }
    for (let q = 0; q < list.length - 1; q++) {
      const a = list[q][1] * (n + 1) + list[q][0], b = list[q + 1][1] * (n + 1) + list[q + 1][0];
      idx.push(a, start + q, b, b, start + q, start + q + 1);
      idx.push(a, b, start + q, b, start + q + 1, start + q);
    }
  };
  const L = (f) => Array.from({ length: n + 1 }, (_, k) => f(k));
  edge(L((k) => [k, 0])); edge(L((k) => [k, n])); edge(L((k) => [0, k])); edge(L((k) => [n, k]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const keyOf = (x0, z0, size) => size + ':' + x0 + ':' + z0;
function nodeMesh(x0, z0, size) {
  const k = keyOf(x0, z0, size);
  let nd = nodes.get(k);
  if (nd) return nd;
  const mesh = new THREE.Mesh(buildNodeGeo(x0, z0, size), terrMat);
  mesh.position.set(x0 + size / 2, 0, z0 + size / 2);
  mesh.receiveShadow = true;
  mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  terrGroup.add(mesh);
  nd = { mesh, used: 0, size };
  nodes.set(k, nd);
  return nd;
}

export function buildTerrainMesh(scene, material) {
  terrMat = material;
  terrGroup = new THREE.Group();
  scene.add(terrGroup);
  if (G.save && G.save.gfx === 'low') NGRID = 32;
  const x0 = Math.floor(GEO.XMIN / ROOT) * ROOT, z0 = Math.floor(GEO.ZMIN / ROOT) * ROOT;
  for (let z = z0; z < GEO.ZMIN + GEO.S; z += ROOT) for (let x = x0; x < GEO.XMIN + GEO.S; x += ROOT) if (areaHasLand(x, z, ROOT)) roots.push({ x, z });
  for (const r of roots) nodeMesh(r.x, r.z, ROOT);     // the whole island at low detail straight away
  return { material, tiles: [] };
}

// Build the tiles around a point straight away (used at start and after fast travel).
export function primeTerrain(x, z) { updateTerrain(x, z, 1e9); }

// Called every frame: work out which tiles should be drawn, build missing ones (nearest first, a few
// milliseconds per frame) and draw a coarser parent until its children are ready.
const SPLIT = 1.25;
let frameNo = 0;
export function updateTerrain(cx, cz, budgetMs = 5) {
  if (!terrGroup) return;
  frameNo++;
  const t0 = performance.now();
  const want = [];
  const visit = (x0, z0, size, parent) => {
    const d = Math.hypot(Math.max(x0 - cx, 0, cx - (x0 + size)), Math.max(z0 - cz, 0, cz - (z0 + size)));
    if (size > MINS && d < size * SPLIT) {
      const h = size / 2;
      for (const [a, b] of [[0, 0], [h, 0], [0, h], [h, h]]) {
        if (size > 1024 || areaHasLandCached(x0 + a, z0 + b, h)) visit(x0 + a, z0 + b, h, { x0, z0, size, parent });
      }
      return;
    }
    want.push({ x0, z0, size, parent, d });
  };
  for (const r of roots) visit(r.x, r.z, ROOT, null);
  want.sort((a, b) => a.d - b.d);
  const show = new Set();
  for (const w of want) {
    let nd = nodes.get(keyOf(w.x0, w.z0, w.size));
    if (!nd && performance.now() - t0 < budgetMs) nd = nodeMesh(w.x0, w.z0, w.size);
    if (nd) { show.add(nd); continue; }
    // not built yet: draw the nearest ancestor that is
    for (let p = w.parent; p; p = p.parent) { const a = nodes.get(keyOf(p.x0, p.z0, p.size)); if (a) { show.add(a); w.anc = a; break; } }
  }
  // a shown ancestor covers its children: hide any of them that are also built
  const covered = [];
  for (const w of want) if (w.anc) covered.push(w.anc.mesh.position, w.anc.size);
  for (const nd of nodes.values()) {
    let vis = show.has(nd);
    if (vis && covered.length) {
      const p = nd.mesh.position;
      for (let i = 0; i < covered.length; i += 2) {
        const q = covered[i], s2 = covered[i + 1];
        if (s2 > nd.size && Math.abs(p.x - q.x) < s2 / 2 && Math.abs(p.z - q.z) < s2 / 2) { vis = false; break; }
      }
    }
    nd.mesh.visible = vis;
    if (vis) nd.used = frameNo;
  }
  // forget tiles that haven't been drawn for a while (never the 4 km ones)
  if (frameNo % 120 === 0) for (const [k, nd] of nodes) if (nd.size < ROOT && frameNo - nd.used > 600) { terrGroup.remove(nd.mesh); nd.mesh.geometry.dispose(); nodes.delete(k); }
}
const landCache = new Map();
function areaHasLandCached(x0, z0, size) {
  const k = keyOf(x0, z0, size);
  let v = landCache.get(k);
  if (v === undefined) { v = areaHasLand(x0, z0, size); landCache.set(k, v); }
  return v;
}
export const terrainReady = () => true;

// Realistic Lanzarote ground: the painted island map for colour, laid over with real sand, dirt and rock photos
// at three sizes, rock on cliffs, dark volcanic gravel where the map is black, damp sand by the sea.
export function makeTerrainMaterial(PH) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  const white = new THREE.DataTexture(new Uint8Array([200, 190, 170, 255]), 1, 1); white.needsUpdate = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uAlb: { value: albedoTex }, uGeo: { value: new THREE.Vector4(GEO.XMIN, GEO.ZMIN, 1 / GEO.S, 1 / GEO.S) },
      uSand: { value: PH.sand || white }, uDirt: { value: PH.dirt || white }, uRock: { value: PH.rock || white },
    });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying vec3 vTN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uAlb, uSand, uDirt, uRock; uniform vec4 uGeo; varying vec3 vTW; varying vec3 vTN;
      float th(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
      float tn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(th(i),th(i+vec2(1,0)),u.x),mix(th(i+vec2(0,1)),th(i+vec2(1,1)),u.x),u.y); }`)
      .replace('#include <map_fragment>', `
        vec2 auv = (vTW.xz - uGeo.xy) * uGeo.zw;
        vec3 alb = texture2D(uAlb, auv).rgb;
        float dist = length(vTW - cameraPosition);
        vec2 lp = mod(vTW.xz, 1000.0);                     // keep texture coordinates small (every scale repeats a whole number of times)
        float lum = dot(alb, vec3(0.3, 0.59, 0.11));
        // photo detail as brightness only, so the island keeps the colours of the real map
        float sandL = dot(mix(texture2D(uSand, lp * 0.22).rgb, texture2D(uSand, lp * 0.037 + 0.3).rgb, 0.45), vec3(0.3, 0.59, 0.11)) / 0.37;
        float dirtL = dot(mix(texture2D(uDirt, lp * 0.18).rgb, texture2D(uDirt, lp * 0.031 + 0.6).rgb, 0.45), vec3(0.3, 0.59, 0.11)) / 0.2;
        vec3 bw = pow(abs(vTN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 rockC = texture2D(uRock, mod(vTW.zy, 1000.0) * 0.09).rgb * bw.x + texture2D(uRock, lp * 0.09).rgb * bw.y + texture2D(uRock, mod(vTW.xy, 1000.0) * 0.09).rgb * bw.z;
        float rockL = dot(rockC, vec3(0.3, 0.59, 0.11)) / 0.23;
        float sandy = smoothstep(0.42, 0.62, lum) * smoothstep(-0.02, 0.06, alb.r - alb.b);
        float det = mix(dirtL, sandL, sandy);
        float steep = smoothstep(0.78, 0.55, vTN.y);
        det = mix(det, rockL, max(steep * 0.85, smoothstep(0.2, 0.1, lum) * 0.5));
        det = clamp(det, 0.35, 1.8);
        float near = 1.0 - smoothstep(150.0, 1600.0, dist);
        // cliffs show the layered brown-grey rock of the island
        vec3 base = mix(alb, alb * 0.6 + rockC * 0.5, steep * 0.6);
        vec3 col = base * mix(1.0, det, 0.75 * near + 0.2 * (1.0 - near));
        // big soft patches so the ground never looks uniform
        float macro = tn(vTW.xz * 0.013) * 0.6 + tn(vTW.xz * 0.06) * 0.4;
        col *= 0.86 + 0.28 * macro;
        // damp dark sand at the waterline
        col *= 1.0 - 0.35 * smoothstep(1.5, 0.3, vTW.y);
        // the map colours are bright: under this strong Canarian sun real earth reflects about half as much
        float cl = dot(col, vec3(0.3, 0.59, 0.11));
        col = mix(vec3(cl), col, 1.55) * vec3(1.06, 1.0, 0.9);      // the warm ochre of volcanic soil
        diffuseColor.rgb = max(col, 0.0) * 0.58;
      `);
  };
  m.customProgramCacheKey = () => 'lanzground3';
  return m;
}
