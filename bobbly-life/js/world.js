// Builds Bobbly Town: ground, roads, buildings, colliders, trees, day/night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, mat, textSprite, noEmoji, rand, pick, clamp, lerp, LAND, WATER_Y, addMoney, writeSave } from './state.js';
import { rockTexture, sandTexture, woodTexture, interiorWallTexture } from './textures.js';
const dayMats = [];
G.interiors = [];
import { grassDetail, pavingTexture, asphaltTexture, asphaltNormal, wallTextures, roofTexture, roofNormal, waterTexture, makeSky, concreteTexture, glassWallTextures, goodsTexture } from './textures.js';

// Physically based materials on every setting (real reflections of the sky, roughness, bumps).
export function pbr(params) {
  return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, params));
}
function roadMatOf(lines, color) {
  const m = pbr({ map: asphaltTexture(lines), color: color || '#ffffff', normalMap: asphaltNormal(lines), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92 });
  (G.roadMats ||= []).push(m);
  return m;
}
import { setVehicleLighting, M as modelMat } from './models.js';
import { chunk, smoke, sparks, fire, dust } from './debris.js';
import { makeWaterMaterial, updateWater } from './water.js';
import { sfx } from './audio.js';
import { buildHeights, heightAt, buildTerrainMesh, buildHighways, biome, slopeAt, findPeak, srand, LAKES, WORLD, ZONES, inZone, riverDist, ISLANDS, CAVE, FUNKY } from './terrain.js';

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
  if (curB) curB.colliders.push(c);
  if (noDamage) c.noDamage = true;
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
G.groundAt = (x, z) => groundHeight(x, z, 999);
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
// Everything that never moves is merged into big meshes, but split into map squares ("chunks") so the GPU only
// draws the squares you can actually see. Each piece also has a layer: the building shells are drawn out to the
// fog, 3D facade detail only within a few hundred metres, and furniture inside buildings only when you're close.
// Plain coloured materials are merged into one shared material with the colour stored per vertex (far fewer draws).
const statics = [];
export const LAYER = { BASE: 0, DETAIL: 1, INSIDE: 2 };
let curLayer = 0;
function inLayer(layer, fn) { const o = curLayer; curLayer = layer; try { return fn(); } finally { curLayer = o; } }
function S(geo, material, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.updateMatrix();
  if (curB) m.userData.b = curB;
  m.userData.layer = curLayer;
  statics.push(m);
  return m;
}
const CHUNK = 160;
export const chunkList = [];                 // { mesh, x, y, z, r, layer }
function finalizeStatic() {
  const groups = new Map(), tagged = [], canon = new Map(), shared = new Map();
  const NOOP = THREE.Material.prototype.onBeforeCompile;
  const roadMats = G.roadMats || [];
  // plain materials that differ only by colour share one material; their colour goes into the vertices
  const canonical = (m) => {
    if (canon.has(m)) return canon.get(m);
    let r = { m, c: null };
    if ((m.isMeshLambertMaterial || m.isMeshStandardMaterial) && !m.vertexColors && !m.transparent && m.opacity === 1 && m.onBeforeCompile === NOOP && !roadMats.includes(m) && !m.userData.own) {
      const id = (t) => (t ? t.uuid : '');
      const night = nightMats.includes(m), day = dayMats.includes(m);
      const key = [m.type, id(m.map), id(m.emissiveMap), m.emissive.getHex(), m.emissiveIntensity, id(m.normalMap), id(m.roughnessMap), id(m.metalnessMap), m.roughness, m.metalness, m.side, m.flatShading, m.alphaTest, night, day].join('|');
      let sm = shared.get(key);
      if (!sm) {
        // plain Lambert colours become physically based too, so everything picks up the sky's light and reflections
        if (m.isMeshLambertMaterial) sm = new THREE.MeshStandardMaterial({ roughness: m.map ? 0.9 : 0.82, metalness: 0, map: m.map, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, normalMap: m.normalMap, side: m.side, flatShading: m.flatShading, alphaTest: m.alphaTest });
        else sm = m.clone();
        sm.color.set('#ffffff'); sm.vertexColors = true;
        if (night) nightMats.push(sm);
        if (day) dayMats.push(sm);
        shared.set(key, sm);
      }
      r = { m: sm, c: m.color };
    }
    canon.set(m, r);
    return r;
  };
  for (const s of statics) {
    const b = s.userData.b, layer = s.userData.layer || 0;
    // a destructible building keeps all its pieces in one chunk (so it can fall down as one)
    const cx = b && b.x0 !== undefined ? (b.x0 + b.x1) / 2 : s.position.x, cz = b && b.x0 !== undefined ? (b.z0 + b.z1) / 2 : s.position.z;
    const C = canonical(s.material);
    const key = C.m.id + ':' + layer + ':' + Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
    let grp = groups.get(key);
    if (!grp) groups.set(key, grp = { material: C.m, layer, geos: [], colored: !!C.c });
    const g = s.geometry.index ? s.geometry.toNonIndexed() : s.geometry.clone();
    g.applyMatrix4(s.matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (grp.colored) {
      const col = new Uint16Array(n * 3), R = C.c.r * 65535, Gc = C.c.g * 65535, B = C.c.b * 65535;
      for (let i = 0; i < n; i++) { col[i * 3] = R; col[i * 3 + 1] = Gc; col[i * 3 + 2] = B; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    }
    grp.geos.push(g);
    if (b) tagged.push({ b, grp, idx: grp.geos.length - 1 });
  }
  for (const grp of groups.values()) {
    grp.offs = []; let o = 0;
    for (const g of grp.geos) { grp.offs.push(o); o += g.attributes.position.count; }
    const merged = mergeGeometries(grp.geos, false);
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, grp.material);
    mesh.castShadow = grp.layer !== LAYER.INSIDE; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    G.scene.add(mesh);
    grp.mesh = mesh;
    grp.counts = grp.geos.map(g => g.attributes.position.count);
    const bs = merged.boundingSphere;
    chunkList.push({ mesh, x: bs.center.x, y: bs.center.y, z: bs.center.z, r: bs.radius, layer: grp.layer });
  }
  // remember which triangles belong to each destructible building
  for (const t of tagged) t.b.parts.push({ mesh: t.grp.mesh, start: t.grp.offs[t.idx], count: t.grp.counts[t.idx] });
  for (const grp of groups.values()) grp.geos = null;
  statics.length = 0;
  finalizeInstances();
}
// how far away each layer is still drawn (set from the graphics setting)
export const DRAW = { base: 1e9, detail: 420, inside: 90, tree: 900, car: 400, npc: 180, shadow: 160, lod: 260, moverShadow: 80 };
export function setDrawDistances(gfx) {
  if (gfx === 'low') Object.assign(DRAW, { detail: 340, inside: 75, tree: 700, car: 220, npc: 110, shadow: 60, lod: 110, moverShadow: 35 });
  else if (gfx === 'ultra') Object.assign(DRAW, { detail: 800, inside: 140, tree: 1500, car: 650, npc: 260, shadow: 420, lod: 420, moverShadow: 160 });
  else Object.assign(DRAW, { detail: 520, inside: 100, tree: 1100, car: 400, npc: 180, shadow: 160, lod: 260, moverShadow: 80 });
  cullT = 0;
}
// Shadow stand-ins: simple invisible shapes (layer 6, only the sun's shadow camera sees them) that cast the
// shadow instead of every little part. Trees always use them; on Low, people and cars do too.
export const SHADOW_LAYER = 6;
const proxyMat = new THREE.MeshBasicMaterial();
function proxyMesh(geo, parent, y = 0) { const p = new THREE.Mesh(geo, proxyMat); p.userData.isProxy = true; p.layers.set(SHADOW_LAYER); p.position.y = y; p.castShadow = false; parent.add(p); return p; }
function setCast(o, cast, makeProxy) {
  const mode = !cast ? 0 : makeProxy && G.save.gfx === 'low' ? 2 : 1;
  if (!o || o.userData.castMode === mode) return;
  o.userData.castMode = mode;
  if (mode === 2 && !o.userData.proxy) o.userData.proxy = makeProxy();
  o.traverse((c) => { if (c.isMesh && !c.userData.isProxy) { if (c.userData.castOrig === undefined) c.userData.castOrig = c.castShadow; c.castShadow = mode === 1 && c.userData.castOrig; } });
  for (const p of o.userData.proxy || []) p.castShadow = mode === 2;
}
const PROXY_CAPS = new THREE.CapsuleGeometry(0.43, 0.6, 2, 8), PROXY_HEAD = new THREE.SphereGeometry(0.46, 8, 6), PROXY_BOX = new THREE.BoxGeometry(1, 1, 1);
const charProxy = (ch) => () => [proxyMesh(PROXY_CAPS, ch.body, 0.38), proxyMesh(PROXY_HEAD, ch.head)];
const carProxy = (v) => () => { const t = v.type, p = proxyMesh(PROXY_BOX, v.mesh, t.h * 0.42); p.scale.set(t.wid * 0.92, t.h * 0.75, t.len * 0.95); return [p]; };
// Far-away cars, people and loose objects are skipped by the camera (layer 7) without touching their
// own visibility, so nothing else in the game has to know about it.
function setFar(o, far, again) {
  if (!o || (o.userData.far === far && !again)) return;
  o.userData.far = far;
  o.traverse((c) => { if (far) c.layers.set(7); else c.layers.set(c.userData.isProxy ? SHADOW_LAYER : 0); });
}
let reT = 0;
let cullT = 0;
function updateChunks(dt) {
  cullT -= dt;
  if (cullT > 0) return;
  cullT = 0.12;
  const c = G.camera.position;
  const fogFar = G.scene.fog === G.landFog ? G.landFog.far * 1.05 + 30 : 1e9;
  const lim = [Math.min(DRAW.base, fogFar), Math.min(DRAW.detail, fogFar), DRAW.inside, Math.min(DRAW.tree, fogFar)];
  for (const k of chunkList) {
    const d = Math.hypot(k.x - c.x, (k.y - c.y) * 0.5, k.z - c.z) - k.r;
    const vis = d < lim[k.layer];
    k.mesh.visible = vis;
    if (!vis) continue;
    // only things near you cast shadows (the shadow map only covers the area around you anyway)
    if (k.cast === undefined) k.cast = k.mesh.castShadow;
    k.mesh.castShadow = k.cast && d < DRAW.shadow;
    if (k.mesh.userData.shadowProxy) k.mesh.userData.shadowProxy.castShadow = d < DRAW.shadow;
    // far-away trees use simpler shapes
    if (k.lod) { const g = d > DRAW.lod ? k.lod.lo : k.lod.hi; if (k.mesh.geometry !== g) k.mesh.geometry = g; }
  }
  reT -= 0.12;
  const again = reT <= 0; if (again) reT = 2;
  const cl = Math.min(DRAW.car, fogFar), nl = Math.min(DRAW.npc, fogFar);
  for (const v of G.vehicles) if (v.mesh) { const d = Math.hypot(v.mesh.position.x - c.x, v.mesh.position.z - c.z), mine = G.player && G.player.vehicle === v, far = d > cl && !mine; setFar(v.mesh, far, again && far); setCast(v.mesh, mine || d < DRAW.moverShadow, carProxy(v)); }
  for (const ch of G.characters) if (!ch.isRemote && ch !== G.player && ch.group) { const d = Math.hypot(ch.root.x - c.x, ch.root.z - c.z), far = d > nl; setFar(ch.group, far, again && far); if (ch.tag) setFar(ch.tag, far); setCast(ch.group, d < DRAW.moverShadow, charProxy(ch)); }
  for (const pr of G.props) if (pr.mesh && !pr.held) { const far = Math.hypot(pr.mesh.position.x - c.x, pr.mesh.position.z - c.z) > nl; setFar(pr.mesh, far, again && far); }
}

// ---------------------------------------------------------------- destructible buildings
let curB = null, noDamage = false;
const collapsing = [], scars = [];
function beginB(color) { curB = { parts: [], colliders: [], color, hp: 0, dead: false }; }
function endB() {
  const b = curB; curB = null;
  if (!b || !b.colliders.length) return;
  let vol = 0; b.minY = 1e9; b.maxY = -1e9; b.x0 = 1e9; b.x1 = -1e9; b.z0 = 1e9; b.z1 = -1e9;
  for (const c of b.colliders) {
    vol += (c.maxX - c.minX) * (c.maxY - c.minY) * (c.maxZ - c.minZ);
    b.minY = Math.min(b.minY, c.minY); b.maxY = Math.max(b.maxY, c.maxY);
    b.x0 = Math.min(b.x0, c.minX); b.x1 = Math.max(b.x1, c.maxX); b.z0 = Math.min(b.z0, c.minZ); b.z1 = Math.max(b.z1, c.maxZ);
    c.b = b;
  }
  b.base = Math.max(b.minY, heightAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) - 0.5);
  b.hp = b.maxHp = vol / 20;
}
let scarTex = null;
function scarMaterial() {
  if (scarTex) return scarTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(8,8,8,1)'); g.addColorStop(0.45, 'rgba(20,18,16,0.95)'); g.addColorStop(0.75, 'rgba(40,36,32,0.6)'); g.addColorStop(1, 'rgba(40,36,32,0)');
  x.fillStyle = g; x.beginPath();
  for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2, r = 40 + Math.random() * 22; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  x.fill();
  x.strokeStyle = 'rgba(10,10,10,0.8)'; x.lineWidth = 2;
  for (let i = 0; i < 9; i++) { let px = 64, py = 64, a = Math.random() * 6.3; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 5; k++) { a += (Math.random() - 0.5) * 0.9; px += Math.cos(a) * 12; py += Math.sin(a) * 12; x.lineTo(px, py); } x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scarTex = new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  return scarTex;
}
const _hn = new THREE.Vector3(), _hp = new THREE.Vector3(), _hv = new THREE.Vector3();
// Something hit a building collider at point p with the given energy (mass x speed).
export function hitBuilding(c, p, energy, nx = null, nz = null) {
  const b = c && c.b;
  if (!c || c.off || c.noDamage || energy < 5) return;
  // which face was hit: use the given normal or the side of the box nearest the point
  if (nx === null) {
    const d = [[p.x - c.minX, -1, 0], [c.maxX - p.x, 1, 0], [p.z - c.minZ, 0, -1], [c.maxZ - p.z, 0, 1]].sort((a, b2) => a[0] - b2[0])[0];
    nx = d[1]; nz = d[2];
  }
  _hn.set(nx, 0, nz);
  _hp.set(nx > 0 ? c.maxX : nx < 0 ? c.minX : p.x, clamp(p.y, c.minY + 0.5, c.maxY - 0.5), nz > 0 ? c.maxZ : nz < 0 ? c.minZ : p.z);
  // chunks of wall and glass burst out of the hole
  const color = b ? b.color : '#9a9a96', n = Math.min(26, 4 + Math.floor(energy / 12));
  for (let i = 0; i < n; i++) {
    _hv.copy(_hn).multiplyScalar(rand(2, 7) + Math.min(10, energy / 60)).add(new THREE.Vector3(rand(-4, 4), rand(1, 6), rand(-4, 4)));
    if (i % 3) chunk(mat(color), rand(0.3, 1.2), rand(0.2, 0.8), rand(0.3, 1.0), _hp, _hv, 30);
    else chunk(mat('#9fc4dc', { transparent: true, opacity: 0.7 }), rand(0.1, 0.4), 0.03, rand(0.1, 0.3), _hp, _hv, 12);
  }
  dust(_hp, Math.min(10, 2 + energy / 40), 1 + Math.min(2, energy / 300));
  sparks(_hp, 12);
  // a scorched, cracked hole where it hit
  const s = clamp(energy / 25, 1.6, 12);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), scarMaterial());
  m.position.copy(_hp).addScaledVector(_hn, 0.06); m.lookAt(_hv.copy(m.position).add(_hn)); m.rotateZ(rand(0, 6.28));
  G.scene.add(m); scars.push({ m, b });
  if (scars.length > 90) G.scene.remove(scars.shift().m);
  if (energy > 250) fire(_hp, 6, clamp(energy / 400, 1, 3));
  if (G.camera && G.camera.position.distanceToSquared(_hp) < 40000) sfx.crash();
  if (!b || b.dead) return;
  b.hp -= energy;
  // a big enough hit (like a plane going full speed) brings even a skyscraper down
  if (b.hp <= 0 || (energy >= 1500 && energy >= b.maxHp * 0.12)) collapseBuilding(b, -nx, -nz);
}
G.hitBuilding = hitBuilding;
export function collapseBuilding(b, lx = 0, lz = 0) {
  if (b.dead) return;
  b.lx = lx; b.lz = lz;   // it leans away from the side that was hit
  b.dead = true; b.t = 0; b.dur = 1.6 + Math.min(4, (b.maxY - b.base) * 0.03);
  for (const c of b.colliders) c.off = true;
  for (const r of b.parts) { const a = r.mesh.geometry.attributes.position; r.orig = a.array.slice(r.start * 3, (r.start + r.count) * 3); }
  b.cx = (b.x0 + b.x1) / 2; b.cz = (b.z0 + b.z1) / 2;
  collapsing.push(b);
  sfx.boom();
  for (const s of scars) if (s.b === b) G.scene.remove(s.m);
  for (const sp of b.extras || []) sp.visible = false;
  for (let i = G.interacts.length - 1; i >= 0; i--) if (G.interacts[i].b === b) G.interacts.splice(i, 1);
  // knock over anyone standing right next to it
  for (const ch of G.characters) {
    if (ch.vehicle || ch.isRemote || ch.ragdoll) continue;
    const P = ch.root;
    if (P.x > b.x0 - 4 && P.x < b.x1 + 4 && P.z > b.z0 - 4 && P.z < b.z1 + 4) ch.flop(new THREE.Vector3(Math.sign(P.x - b.cx) * 6, 6, Math.sign(P.z - b.cz) * 6), 3);
  }
  if (G.camera && G.camera.position.distanceTo(new THREE.Vector3(b.cx, b.base, b.cz)) < 250) G.camShake = Math.max(G.camShake || 0, 0.3);
}
function updateCollapses(dt) {
  for (let i = collapsing.length - 1; i >= 0; i--) {
    const b = collapsing[i];
    b.t += dt;
    const e = Math.min(1, b.t / b.dur), f = 1 - e * e * 0.93, spread = 1 + e * 0.12;
    const H = b.maxY - b.base, lean = e * e * Math.min(0.35, 12 / Math.max(10, H)) ;
    for (const r of b.parts) {
      const a = r.mesh.geometry.attributes.position, arr = a.array, o = r.orig;
      for (let k = 0; k < r.count; k++) {
        const j = (r.start + k) * 3;
        const hy = o[k * 3 + 1] - b.base;
        arr[j] = b.cx + (o[k * 3] - b.cx) * spread + b.lx * hy * lean;
        arr[j + 1] = b.base + hy * f;
        arr[j + 2] = b.cz + (o[k * 3 + 2] - b.cz) * spread + b.lz * hy * lean;
      }
      a.addUpdateRange(r.start * 3, r.count * 3);
      a.needsUpdate = true;
    }
    // rubble raining down the sides and a rolling dust cloud
    const top = b.base + H * f;
    if (Math.random() < dt * 30) chunk(mat(b.color), rand(0.5, 2), rand(0.4, 1.5), rand(0.5, 2), _hp.set(rand(b.x0, b.x1), top, rand(b.z0, b.z1)), _hv.set(rand(-5, 5), rand(0, 3), rand(-5, 5)), 40);
    b.dustT = (b.dustT || 0) - dt;
    if (b.dustT <= 0) { b.dustT = 0.12; dust(_hp.set(rand(b.x0 - 3, b.x1 + 3), b.base + rand(0, 3), rand(b.z0 - 3, b.z1 + 3)), 2, 1.5 + H / 40); }
    if (e >= 1) {
      collapsing.splice(i, 1);
      addCollider(b.x0 + 1, b.base - 1, b.z0 + 1, b.x1 - 1, b.base + Math.max(0.6, H * 0.07) * 0.6, b.z1 - 1, 'rubble');
    }
  }
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
const flatGeoCache = new Map();
function flatGeo(w, d, tile) {
  const k = w + 'x' + d + 'x' + tile;
  if (!flatGeoCache.has(k)) {
    const g = new THREE.PlaneGeometry(1, 1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    flatGeoCache.set(k, g);
  }
  return flatGeoCache.get(k);
}
const GRASSY = ['#7fae4f', '#5a8f42', '#7fae4f'];
const PAVED = ['#cfcfca', '#d9d4c7', '#eadfc6', '#cfcfcf', '#cfc6b3', '#b9bec7', '#9aa0aa'];
function flat(x, y, z, w, d, color, ry = 0) {
  if (typeof color === 'string' && TX) {
    if (GRASSY.includes(color)) return S(flatGeo(w, d, 6), tmat(color, TX.grass, 'g'), x, y, z, ry, -Math.PI / 2, 0, w, d, 1);
    if (PAVED.includes(color)) return S(flatGeo(w, d, 3), tmat(color, TX.paving, 'p'), x, y, z, ry, -Math.PI / 2, 0, w, d, 1);
  }
  S(PLANE, typeof color === 'string' ? mat(color) : color, x, y, z, ry, -Math.PI / 2, 0, w, d, 1);
}

// Building wall material with window texture, glowing windows at night.
const nightMats = [];
const bmatCache = new Map();
let winTex = null, winEmit = null;
let houseTex = null, houseEmit = null, winRM = null, winN = null, houseRM = null, houseN = null;
// Terrain shading: rock strata on steep slopes (projected from the sides so it never stretches), fine sand on
// beaches and the sea floor, a second, larger grass layer far away so the pattern doesn't visibly repeat, and
// big soft patches of colour variation like real fields.
function realisticGround(m) {
  const rock = rockTexture(), sand = sandTexture();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: rock }; sh.uniforms.uSand = { value: sand };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec3 vGN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vGN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uRock, uSand; varying vec3 vGW; varying vec3 vGN;
      float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        vec4 g1 = texture2D(map, vMapUv);
        vec4 g2 = texture2D(map, vMapUv * 0.17 + 0.3);
        float far = smoothstep(25.0, 140.0, length(vGW - cameraPosition));
        vec3 grassD = mix(g1.rgb, g2.rgb, far * 0.7);
        vec3 bw = pow(abs(vGN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 rockD = texture2D(uRock, vGW.zy * 0.09).rgb * bw.x + texture2D(uRock, vGW.xz * 0.09).rgb * bw.y + texture2D(uRock, vGW.xy * 0.09).rgb * bw.z;
        float steep = smoothstep(0.8, 0.6, vGN.y);
        // sand where the ground colour is sandy (beaches, the bay, the islands)
        #ifdef USE_COLOR
          float sandy = smoothstep(0.05, 0.16, vColor.r - vColor.g);
        #else
          float sandy = 0.0;
        #endif
        vec3 sandD = mix(vec3(1.0), texture2D(uSand, vGW.xz * 0.12).rgb * 1.15, 0.6);
        vec3 detail = mix(mix(grassD, sandD, sandy), rockD * 1.15, steep * 0.85);
        float macro = gn(vGW.xz * 0.012) * 0.6 + gn(vGW.xz * 0.05) * 0.4;
        diffuseColor.rgb *= detail * (0.9 + 0.2 * macro);
      `);
  };
  m.customProgramCacheKey = () => 'realground';
}

function makeWindowTextures() {
  const w = wallTextures();
  winTex = w.map; winEmit = w.emit; winRM = w.rm; winN = w.normal;
  const h = wallTextures('house');
  houseTex = h.map; houseEmit = h.emit; houseRM = h.rm; houseN = h.normal;
}
const hmatCache = new Map();
function hmat(color) {
  if (!hmatCache.has(color)) {
    const m = pbr({ color, map: houseTex, emissive: '#ffcf6a', emissiveMap: houseEmit, emissiveIntensity: 0, roughnessMap: houseRM, metalnessMap: houseRM, roughness: 1, metalness: 1, normalMap: houseN, normalScale: new THREE.Vector2(1.2, 1.2) });
    nightMats.push(m);
    hmatCache.set(color, m);
  }
  return hmatCache.get(color);
}
// Textured material cache (colour + texture)
const tmatCache = new Map();
function tmat(color, map, key) {
  const k = color + key;
  if (!tmatCache.has(k)) tmatCache.set(k, new THREE.MeshLambertMaterial({ color, map }));
  return tmatCache.get(k);
}
let TX = null;
function initTextures() {
  TX = { grass: grassDetail(), paving: pavingTexture(), roof: roofTexture() };
}
function bmat(color) {
  if (!bmatCache.has(color)) {
    const m = pbr({ color, map: winTex, emissive: '#ffcf6a', emissiveMap: winEmit, emissiveIntensity: 0, roughnessMap: winRM, metalnessMap: winRM, roughness: 1, metalness: 1, normalMap: winN, normalScale: new THREE.Vector2(1.4, 1.4) });
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
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(dims[f][0] / 4)) / 4, uv.getY(i) * Math.max(1, Math.round(dims[f][1] / 4)) / 4);
  }
  return g;
}
function building(x, z, w, d, h, color, roofColor = '#6b6f78') {
  beginB(color);
  facade3D(x, z, w, d, 0, h, color, h > 12 && Math.random() < 0.4 ? 'ribbon' : 'punched');
  roofTop(x, z, w, d, h, roofColor, 'punched', { low: true, noMast: true });
  const c = addCollider(x - w / 2, 0, z - d / 2, x + w / 2, h + 0.3, z + d / 2);
  endB();
  return c;
}
function sign(text, x, y, z, color = '#fff', bg = '#ff6a1a', scale = 3) {
  const sp = textSprite(noEmoji(text).toUpperCase(), { size: 64, color: '#ffffff', bg: 'rgba(16,19,26,0.88)', accent: bg, scale });
  sp.position.set(x, y, z);
  G.scene.add(sp);
  if (curB) (curB.extras ||= []).push(sp);
  return sp;
}

// ---------------------------------------------------------------- real 3D building parts
// Box whose texture coordinates are in metres, so stone and concrete keep their real size on any box.
const tboxCache = new Map();
function tbox(w, h, d, tile = 2) {
  const k = [w, h, d, tile].map(v => Math.round(v * 50)).join(',');
  let g = tboxCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) { const f = dims[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * f[0] / tile, uv.getY(i) * f[1] / tile); }
    tboxCache.set(k, g);
  }
  return g;
}
const shade = (color, k) => '#' + new THREE.Color(color).multiplyScalar(k).getHexString();
const stoneCache = new Map();
function stone(color) {
  if (!stoneCache.has(color)) { const C = concreteTexture(); stoneCache.set(color, pbr({ color, map: C.map, normalMap: C.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.86 })); }
  return stoneCache.get(color);
}
const metalCache = new Map();
function metal(color, rough = 0.42) {
  const k = color + rough;
  if (!metalCache.has(k)) metalCache.set(k, pbr({ color, metalness: 0.7, roughness: rough }));
  return metalCache.get(k);
}
let glassTX = null;
const gmatCache = new Map();
function gmat(color) {
  if (!glassTX) glassTX = glassWallTextures();
  if (!gmatCache.has(color)) {
    const m = pbr({ color, map: glassTX.map, emissive: '#ffcf6a', emissiveMap: glassTX.emit, emissiveIntensity: 0, roughnessMap: glassTX.rm, metalnessMap: glassTX.rm, roughness: 1, metalness: 1, normalMap: glassTX.normal, normalScale: new THREE.Vector2(0.5, 0.5) });
    nightMats.push(m);
    gmatCache.set(color, m);
  }
  return gmatCache.get(color);
}
let roofMats = new Map();
function shingles(color) {
  if (!roofMats.has(color)) roofMats.set(color, pbr({ color, map: roofTexture(), normalMap: roofNormal(), normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 }));
  return roofMats.get(color);
}

// Small repeated details (window frames, air-con units, water tanks, masts) are instanced: one copy of the model,
// drawn many times, so thousands of them cost almost nothing.
const insts = [];
const _im = new THREE.Matrix4(), _ip = new THREE.Vector3(), _iq = new THREE.Quaternion(), _is = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
function addInst(kind, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, color = null) {
  _im.compose(_ip.set(x, y, z), _iq.setFromAxisAngle(UPV, ry), _is.set(sx, sy, sz));
  insts.push({ kind, m: _im.clone(), c: color, b: curB, layer: curLayer === LAYER.INSIDE ? LAYER.INSIDE : LAYER.DETAIL });
}
let KINDS = null;
function instKinds() {
  if (KINDS) return KINDS;
  const col = new THREE.Color();
  const part = (geo, color, x, y, z, ry = 0, rx = 0) => {
    const g = geo.clone(); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z);
    col.set(color); const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (r0, r1, h, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n);
  const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });
  const T = '#f6f4ee';
  KINDS = {
    // a painted window surround for a 1 x 1 m opening (scaled to each window): head with a crown moulding,
    // jambs, a deep sill and glazing bars, standing proud of the siding so it throws real shadows
    frame: { mat: plain, geo: mergeGeometries([
      part(B(1.2, 0.1, 0.09), T, 0, 0.55, 0.045), part(B(1.3, 0.04, 0.14), T, 0, 0.62, 0.07),
      part(B(0.1, 1.0, 0.08), T, -0.55, 0, 0.04), part(B(0.1, 1.0, 0.08), T, 0.55, 0, 0.04),
      part(B(1.32, 0.06, 0.17), T, 0, -0.53, 0.085), part(B(1.1, 0.05, 0.07), '#d8d4ca', 0, -0.585, 0.035),
      part(B(0.035, 1.0, 0.035), T, 0, 0, 0.018), part(B(1.0, 0.035, 0.035), T, 0, 0, 0.018),
    ]) },
    // rooftop air-conditioning unit: louvred metal box, fan grilles on top, pipes down to the roof
    ac: { mat: steel, geo: mergeGeometries([
      part(B(2.4, 1.2, 1.5), '#b9bdc2', 0, 0.75, 0), part(B(2.5, 0.12, 1.6), '#9aa0a6', 0, 1.38, 0),
      part(C(0.5, 0.5, 0.1, 14), '#2a2d31', -0.6, 1.47, 0), part(C(0.5, 0.5, 0.1, 14), '#2a2d31', 0.6, 1.47, 0),
      part(B(2.42, 0.06, 1.52), '#8a9096', 0, 0.45, 0), part(B(2.42, 0.06, 1.52), '#8a9096', 0, 0.75, 0), part(B(2.42, 0.06, 1.52), '#8a9096', 0, 1.05, 0),
      part(B(2.6, 0.15, 1.7), '#6a6e74', 0, 0.075, 0), part(C(0.07, 0.07, 1.2, 6), '#c8a060', 1.35, 0.6, 0.4),
    ]) },
    // old-city wooden water tank on a steel stand with a conical roof
    tank: { mat: plain, geo: mergeGeometries([
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => part(B(0.18, 2.4, 0.18), '#3a3d42', a * 1.05, 1.2, b * 1.05)),
      part(B(2.6, 0.15, 2.6), '#3a3d42', 0, 2.45, 0),
      part(C(1.45, 1.5, 3.2, 18), '#7a5638', 0, 4.15, 0),
      part(C(1.52, 1.52, 0.1, 18), '#2e2f33', 0, 3.3, 0), part(C(1.49, 1.49, 0.1, 18), '#2e2f33', 0, 4.6, 0), part(C(1.47, 1.47, 0.1, 18), '#2e2f33', 0, 5.5, 0),
      part(new THREE.ConeGeometry(1.6, 1.1, 18), '#4a3a2c', 0, 6.3, 0), part(C(0.06, 0.06, 0.5, 6), '#2e2f33', 0, 7.05, 0),
    ]) },
    // antenna mast with a satellite dish and aircraft-warning light
    mast: { mat: steel, geo: mergeGeometries([
      part(C(0.08, 0.12, 9, 6), '#d8dadc', 0, 4.5, 0), part(B(0.9, 0.2, 0.9), '#808488', 0, 0.1, 0),
      part(new THREE.SphereGeometry(0.75, 12, 6, 0, Math.PI * 2, 0, 1.0), '#eceef0', 1.1, 1.6, 0, 0, Math.PI / 2 + 0.5),
      part(C(0.04, 0.04, 1.2, 5), '#808488', 0.55, 1.4, 0, 0, Math.PI / 2), part(C(0.12, 0.12, 0.25, 8), '#c03030', 0, 9.1, 0),
    ]) },
  };
  return KINDS;
}
function finalizeInstances() {
  const K = instKinds(), groups = new Map();
  for (const it of insts) {
    const b = it.b, cx = b && b.x0 !== undefined ? (b.x0 + b.x1) / 2 : it.m.elements[12], cz = b && b.x0 !== undefined ? (b.z0 + b.z1) / 2 : it.m.elements[14];
    const key = it.kind + ':' + it.layer + ':' + Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const white = new THREE.Color(1, 1, 1);
  for (const list of groups.values()) {
    const k = K[list[0].kind], im = new THREE.InstancedMesh(k.geo, k.mat, list.length);
    const colored = list.some(it => it.c);
    list.forEach((it, i) => {
      im.setMatrixAt(i, it.m);
      if (colored) im.setColorAt(i, it.c ? new THREE.Color(it.c) : white);
      if (it.b) (it.b.inst ||= []).push({ im, i });
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    G.scene.add(im);
    const bs = im.boundingSphere;
    chunkList.push({ mesh: im, x: bs.center.x, y: bs.center.y, z: bs.center.z, r: bs.radius, layer: list[0].layer });
  }
  insts.length = 0;
}

// A real 3D facade. The window wall is set back inside a grid of stone piers and floor ledges that stand out from
// it, so every window sits in a deep reveal that catches light and shadow, like a real building.
//   punched: masonry office block with deep window reveals
//   ribbon:  deep horizontal ledges (sunshades/balconies) between floors
//   glass:   floor-to-ceiling tinted glass in a slim metal grid with slab edges at each floor
function facade3D(x, z, w, d, y0, y1, color, style) {
  const H = y1 - y0;
  if (H < 1) return;
  const ins = style === 'glass' ? 0.32 : style === 'ribbon' ? 0.9 : 0.5;
  const wc = Math.max(1, w - 2 * ins), dc = Math.max(1, d - 2 * ins);
  S(windowBoxGeo(wc, H, dc), style === 'glass' ? gmat(color) : bmat(color), x, y0 + H / 2, z);
  const nF = Math.max(1, Math.round(H / 4)), fh = H / nF;
  const trim = style === 'glass' ? metal('#3a4048', 0.35) : stone(color);
  const slab = style === 'glass' ? stone(shade(color, 0.82)) : trim;
  const [lo, hi] = style === 'glass' ? [-0.03, 0.19] : [-0.19, 0.24];
  // the corners are solid
  const bwx = wc / Math.max(1, Math.round(wc / 4)), cw = style === 'glass' ? ins + 0.16 : ins + bwx * 0.16;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S(tbox(cw, H, cw), trim, x + sx * (w / 2 - cw / 2), y0 + H / 2, z + sz * (d / 2 - cw / 2));
  inLayer(LAYER.DETAIL, () => {
    // a ledge at every floor
    for (let j = 0; j <= nF; j++) {
      const ya = Math.max(y0, y0 + (j + lo) * fh), yb = Math.min(y1, y0 + (j + hi) * fh);
      if (yb - ya < 0.05) continue;
      S(tbox(w, yb - ya, d), slab, x, (ya + yb) / 2, z);
    }
    // piers between the windows (mullions on glass towers)
    if (style === 'ribbon') return;
    for (const ax of [0, 1]) {
      const L = ax ? dc : wc, nB = Math.max(1, Math.round(L / 4)), bw = L / nB;
      const pw = style === 'glass' ? 0.26 : bw * 0.33, dep = ins + 0.04;
      for (let k = 1; k < nB; k++) {
        const t = -L / 2 + k * bw;
        for (const sd of [-1, 1]) {
          if (ax === 0) S(tbox(pw, H, dep), trim, x + t, y0 + H / 2, z + sd * (d / 2 - dep / 2));
          else S(tbox(dep, H, pw), trim, x + sd * (w / 2 - dep / 2), y0 + H / 2, z + t);
        }
      }
    }
  });
}
// Roof: membrane, a parapet wall with colliders, a cornice on older buildings, and rooftop plant.
function roofTop(x, z, w, d, h, color, style, opts = {}) {
  const top = h + 0.3;
  S(tbox(w - 0.1, 0.3, d - 0.1, 3), stone('#6e7177'), x, h + 0.15, z);
  if (style !== 'glass') S(tbox(w + 0.8, 0.5, d + 0.8), stone(shade(color, 0.86)), x, h - 0.15, z);
  const pc = style === 'glass' ? metal('#4a5058', 0.4) : stone(shade(color, 0.93)), ph = opts.low ? 0.8 : 1.0, pt = 0.32;
  S(tbox(w, ph, pt), pc, x, top + ph / 2, z - d / 2 + pt / 2); S(tbox(w, ph, pt), pc, x, top + ph / 2, z + d / 2 - pt / 2);
  S(tbox(pt, ph, d - 2 * pt), pc, x - w / 2 + pt / 2, top + ph / 2, z); S(tbox(pt, ph, d - 2 * pt), pc, x + w / 2 - pt / 2, top + ph / 2, z);
  if (style !== 'glass') {         // stone coping along the top of the parapet
    const cp = stone(shade(color, 0.8)), cy = top + ph + 0.05;
    S(tbox(w + 0.1, 0.1, pt + 0.12), cp, x, cy, z - d / 2 + pt / 2); S(tbox(w + 0.1, 0.1, pt + 0.12), cp, x, cy, z + d / 2 - pt / 2);
    S(tbox(pt + 0.12, 0.1, d - 2 * pt), cp, x - w / 2 + pt / 2, cy, z); S(tbox(pt + 0.12, 0.1, d - 2 * pt), cp, x + w / 2 - pt / 2, cy, z);
  }
  addCollider(x - w / 2, top, z - d / 2, x + w / 2, top + ph, z - d / 2 + pt);
  addCollider(x - w / 2, top, z + d / 2 - pt, x + w / 2, top + ph, z + d / 2);
  addCollider(x - w / 2, top, z - d / 2, x - w / 2 + pt, top + ph, z + d / 2);
  addCollider(x + w / 2 - pt, top, z - d / 2, x + w / 2, top + ph, z + d / 2);
  // rooftop plant (kept clear of the stair/elevator house at the -x,-z quarter)
  const n = Math.max(1, Math.min(6, Math.floor(w * d / 140)));
  const spots = [];
  for (let i = 0; i < n * 3 && spots.length < n; i++) {
    const px = x + rand(-w / 2 + 2.5, w / 2 - 2.5), pz = z + rand(-d / 2 + 2.2, d / 2 - 2.2);
    if (Math.abs(px - (x - w / 4)) < 4.5 && Math.abs(pz - (z - d / 4)) < 4.5) continue;
    if (spots.some(([a, b]) => Math.abs(a - px) < 3 && Math.abs(b - pz) < 2.4)) continue;
    spots.push([px, pz]);
    addInst('ac', px, top, pz, Math.random() < 0.5 ? 0 : Math.PI / 2);
    addCollider(px - 1.3, top, pz - 1.3, px + 1.3, top + 1.45, pz + 1.3);
  }
  if (style !== 'glass' && h < 100 && w > 9 && d > 9 && Math.random() < 0.5) {
    const tx = x + w / 2 - 2.6, tz = z + d / 2 - 2.6;
    addInst('tank', tx, top, tz, Math.random() * 6);
    addCollider(tx - 1.5, top, tz - 1.5, tx + 1.5, top + 6.8, tz + 1.5);
  }
  if (h > 50 && Math.random() < 0.5 && !opts.noMast) addInst('mast', x + w / 2 - 1.6, top, z - d / 2 + 1.6, Math.random() * 6);
}
// Window surrounds for a wall covered in the house siding texture (one window per 4 m bay per floor), on the
// face whose outward direction is (ox, oz). The wall face runs from a to b along x (ax=0) or z (ax=1).
function houseFrames(a, b, fixed, y0, H, ax, out) {
  const L = b - a;
  if (L < 0.5) return;
  const nB = Math.max(1, Math.round(L / 4)), bw = L / nB, nF = Math.max(1, Math.round(H / 4)), fh = H / nF;
  const ww = bw * 50 / 128, wh = fh * 58 / 128;
  for (let i = 0; i < nB; i++) for (let j = 0; j < nF; j++) {
    const t = a + (i + 0.5) * bw, y = y0 + j * fh + fh * (1 - 59 / 128);
    if (ax === 0) addInst('frame', t, y, fixed, out > 0 ? 0 : Math.PI, ww, wh, 1);
    else addInst('frame', fixed, y, t, out > 0 ? Math.PI / 2 : -Math.PI / 2, ww, wh, 1);
  }
}
// Hip roof with overhanging eaves (texture coordinates follow the slope so the shingles run the right way).
const hipCache = new Map();
function hipRoofGeo(w, d, h, over = 0.5) {
  const key = [w, d, h, over].join(',');
  if (hipCache.has(key)) return hipCache.get(key);
  const swap = d > w, W0 = swap ? d : w, D0 = swap ? w : d;
  const W = W0 / 2 + over, D = D0 / 2 + over, r = Math.max(0, W - D), H = h * D / (D0 / 2), sl = Math.hypot(D, H), T = 2.2;
  const pos = [], uv = [];
  const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  tri([-W, 0, D], [W, 0, D], [r, H, 0], [-W / T, 0], [W / T, 0], [r / T, sl / T]);
  tri([-W, 0, D], [r, H, 0], [-r, H, 0], [-W / T, 0], [r / T, sl / T], [-r / T, sl / T]);
  tri([W, 0, -D], [-W, 0, -D], [-r, H, 0], [-W / T, 0], [W / T, 0], [r / T, sl / T]);
  tri([W, 0, -D], [-r, H, 0], [r, H, 0], [-W / T, 0], [r / T, sl / T], [-r / T, sl / T]);
  tri([W, 0, D], [W, 0, -D], [r, H, 0], [-D / T, 0], [D / T, 0], [0, sl / T]);
  tri([-W, 0, -D], [-W, 0, D], [-r, H, 0], [-D / T, 0], [D / T, 0], [0, sl / T]);
  // underside of the eaves
  tri([-W, 0, -D], [W, 0, -D], [W, 0, D], [0, 0], [0, 0], [0, 0]);
  tri([-W, 0, -D], [W, 0, D], [-W, 0, D], [0, 0], [0, 0], [0, 0]);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (swap) g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  hipCache.set(key, g);
  return g;
}
// A hip roof on a w x d box whose walls end at height y: shingles, fascia boards and gutters all round.
function hipRoof(x, y, z, w, d, h, color, over = 0.5) {
  S(hipRoofGeo(w, d, h, over), shingles(color), x, y, z);
  const tr = stone('#f2f0ea'), W = w / 2 + over, D = d / 2 + over;
  inLayer(LAYER.DETAIL, () => {
    S(tbox(2 * W + 0.08, 0.24, 0.06), tr, x, y - 0.1, z + D); S(tbox(2 * W + 0.08, 0.24, 0.06), tr, x, y - 0.1, z - D);
    S(tbox(0.06, 0.24, 2 * D), tr, x + W, y - 0.1, z); S(tbox(0.06, 0.24, 2 * D), tr, x - W, y - 0.1, z);
    const gm = metal('#e8e6e0', 0.5);
    S(tbox(2 * W + 0.2, 0.12, 0.13), gm, x, y - 0.06, z + D + 0.09); S(tbox(2 * W + 0.2, 0.12, 0.13), gm, x, y - 0.06, z - D - 0.09);
  });
}
function chimney(x, y, z, top) {
  const h = top - y;
  S(tbox(0.95, h, 0.95), stone('#9a6b5a'), x, y + h / 2, z);
  S(tbox(1.15, 0.14, 1.15), stone('#8a8680'), x, top + 0.07, z);
  inLayer(LAYER.DETAIL, () => { S(CYL8, metal('#3a3a3a', 0.6), x - 0.18, top + 0.32, z, 0, 0, 0, 0.12, 0.4, 0.12); S(CYL8, metal('#3a3a3a', 0.6), x + 0.2, top + 0.28, z + 0.1, 0, 0, 0, 0.1, 0.3, 0.1); });
}

// ---------------------------------------------------------------- locations
export const ROADS = [-150, -90, -30, 30, 90, 150];
export const BLOCKS = [-120, -60, 0, 60, 120];
export const LOC = G.LOC = {
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
  fishing: { x: -31, z: -720 },
  airport: { x: -135, z: 168 },
  blasters: { x: -71, z: -44 },
  fishMarket: { x: -96, z: -706, w: 8, d: 5 },
  mansion: { x: 62, z: 108 },
  wardrobe: { x: 50, z: 112 },
  fireBuildings: [],
};

// ---------------------------------------------------------------- trees (instanced so they can be chopped)
const treeDefs = [];
function addTree(x, z, type = Math.random() < 0.5 ? 'round' : 'pine', s = rand(0.85, 1.25)) {
  if (G.keepOut && G.keepOut(x, z)) return;
  treeDefs.push({ x, z, type, s, y: heightAt(x, z) });
}
// Leafy crown: a cluster of lumpy blobs, darker underneath and in the middle.
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function tint(g, dark, light, y0, y1) {
  const p = g.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1) * 0.8 + hash3(p.getX(i), p.getY(i), p.getZ(i)) * 0.2;
    c.copy(dark).lerp(light, t); cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
function lumpy(g, amt) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash3(x * 3.1, y * 3.1, z * 3.1) - 0.5) * amt; p.setXYZ(i, x * k, y * k, z * k); }
  return g;
}
// ---------------------------------------------------------------- realistic trees: leaf and needle cards (like real games)
function foliageTexture(kind) {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  let sd = kind.length * 977; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
  if (kind === 'leaf') {
    // a clump of overlapping leaves with stems, varied greens, lighter where the sun hits
    for (let i = 0; i < 230; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 108, px = 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d * 0.9;
      const L = 10 + r() * 12, rot = r() * Math.PI * 2, lt = 36 + r() * 30 - d * 0.08;
      x.save(); x.translate(px, py); x.rotate(rot);
      x.fillStyle = `hsl(${88 + r() * 30},${45 + r() * 25}%,${lt}%)`;
      x.beginPath(); x.ellipse(0, 0, L, L * 0.45, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = `hsla(90,30%,${lt + 15}%,0.6)`; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-L, 0); x.lineTo(L, 0); x.stroke();
      x.restore();
    }
  } else {
    // a pine branch: twig down the middle and dense needles, optional snow on top
    x.strokeStyle = '#4a3420'; x.lineWidth = 5; x.beginPath(); x.moveTo(8, 128); x.lineTo(250, 128); x.stroke();
    for (let i = 0; i < 1300; i++) {
      const t = r(), px = 10 + t * 240, side = r() < 0.5 ? -1 : 1, len = (1 - t * 0.6) * (24 + r() * 30);
      const ang = side * (0.5 + r() * 0.9), lt = 22 + r() * 24;
      x.strokeStyle = `hsl(${120 + r() * 30},${35 + r() * 25}%,${lt}%)`; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(px, 128 + (r() - 0.5) * 6); x.lineTo(px + Math.cos(ang) * len * 0.5, 128 + Math.sin(ang) * len); x.stroke();
    }
    if (kind === 'snow') for (let i = 0; i < 500; i++) { const px = 10 + r() * 240, py = 128 - r() * 60; x.fillStyle = `rgba(250,252,255,${0.6 + r() * 0.4})`; x.beginPath(); x.arc(px, py, 2 + r() * 5, 0, 7); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function barkTexture() {
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d'); x.fillStyle = '#6a5442'; x.fillRect(0, 0, n, n);
  for (let i = 0; i < 90; i++) { const v = 50 + Math.random() * 70 | 0; x.fillStyle = `rgba(${v},${v * 0.8 | 0},${v * 0.6 | 0},0.7)`; x.fillRect(Math.random() * n, 0, 1 + Math.random() * 4, n); }
  for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(30,22,15,0.6)'; x.fillRect(Math.random() * n, Math.random() * n, 6 + Math.random() * 10, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// sway in the wind (stronger in storms), done on the GPU for every instance
const foliageWind = { value: 1 }, foliageTime = { value: 0 };
G.foliage = { wind: foliageWind, time: foliageTime };
function foliageMat(map, extra = {}) {
  const m = new THREE.MeshLambertMaterial(Object.assign({ map, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true }, extra));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = foliageWind; sh.uniforms.uTime = foliageTime;
    sh.vertexShader = 'uniform float uWind, uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float k = (position.y + 0.6) * uWind;
        transformed.x += sin(uTime * 1.6 + ip.x * 0.11 + position.y * 2.0) * 0.035 * k + sin(uTime * 5.3 + position.x * 9.0) * 0.012 * uWind;
        transformed.z += cos(uTime * 1.3 + ip.z * 0.13) * 0.03 * k; }`);
  };
  m.customProgramCacheKey = () => 'foliage' + (extra.color || '');
  return m;
}
function card(parts, cx, cy, cz, size, rx, ry, rz, shade, center) {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(cx, cy, cz);
  const p = g.attributes.position, nrm = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // round "crown" normals so the tree is lit like a solid shape, darker underneath and inside
    const nx = p.getX(i) - center[0], ny = p.getY(i) - center[1], nz = p.getZ(i) - center[2], l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / l, ny / l, nz / l);
    const v = shade * (0.74 + 0.26 * clamp((ny / l) * 0.5 + 0.5, 0, 1)) * (0.85 + 0.15 * Math.min(1, l));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push(g);
}
function crownGeo() {
  // broadleaf crown: ~46 leaf-clump cards spread through a lumpy dome
  const parts = [];
  let sd = 4242; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
  for (let i = 0; i < 46; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = 0.45 + r() * 0.55;
    const x = Math.sqrt(1 - u * u) * Math.cos(a) * rad, y = u * rad * 0.8 + 0.05, z = Math.sqrt(1 - u * u) * Math.sin(a) * rad;
    card(parts, x, y, z, 0.75 + r() * 0.45, r() * Math.PI, r() * Math.PI, r() * Math.PI, 0.85 + r() * 0.3, [0, -0.1, 0]);
  }
  return mergeGeometries(parts);
}
function pineGeo() {
  // conifer: whorls of drooping branch cards, wide at the bottom, narrowing to a spire
  const parts = [];
  let sd = 777; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
  const tiers = 11;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), y = -0.5 + t * 0.95, rad = 1.05 * (1 - t * 0.88), n = Math.max(4, Math.round(9 - t * 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n + r() * 0.1 + i * 0.37) * Math.PI * 2;
      const g = new THREE.PlaneGeometry(rad, Math.max(0.16, rad * 0.55));
      g.translate(rad / 2, 0, 0);
      g.rotateX(-Math.PI / 2 + 0.05);
      g.rotateZ(-0.32 - r() * 0.15);                // droop
      g.rotateY(-a);
      g.translate(0, y, 0);
      const p = g.attributes.position, nrm = g.attributes.normal, col = new Float32Array(p.count * 3);
      for (let q = 0; q < p.count; q++) {
        const nx = p.getX(q), nz = p.getZ(q), ny = 0.9, l = Math.hypot(nx, ny, nz);
        nrm.setXYZ(q, nx / l, ny / l, nz / l);
        const v = 0.65 + 0.35 * t + r() * 0.1; col[q * 3] = col[q * 3 + 1] = col[q * 3 + 2] = v;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    }
  }
  return mergeGeometries(parts);
}
// Cartoon trees: puffy round crowns made of soft blobs (lighter on top), stacked-cone pines, snowy pines,
// and the candy-coloured trees of the Funky Forest. Each crown is tinted per tree so no two look the same.
function shadeGeo(g, lo, hi, y0, y1, seed) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1), v = lo + (hi - lo) * t + (hash3(p.getX(i) + seed, p.getY(i), p.getZ(i)) - 0.5) * 0.05;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function blobCrown() {
  const parts = [];
  const blobs = [[0, 0.08, 0, 0.78], [0.5, -0.14, 0.2, 0.52], [-0.46, -0.1, 0.24, 0.52], [0.04, -0.06, -0.52, 0.54]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const pp = g.attributes.position;
    for (let i = 0; i < pp.count; i++) { const k = 1 + (hash3(pp.getX(i) * 5 + x, pp.getY(i) * 5, pp.getZ(i) * 5) - 0.5) * 0.12; pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k, pp.getZ(i) * k); }
    g.translate(x, y, z);
    parts.push(g);
  }
  const g = mergeGeometries(parts.map(q => q.index ? q.toNonIndexed() : q));
  g.computeVertexNormals();
  // smooth, rounded shading: point the normals away from the crown's centre
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), p.getY(i) + 0.15, p.getZ(i)).normalize(); const o = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).lerp(v, 0.6).normalize(); n.setXYZ(i, o.x, o.y, o.z); }
  return shadeGeo(g, 0.62, 1.0, -0.7, 0.9, 1);
}
function conePine(snow) {
  const parts = [];
  const tiers = [[-0.5, 0.42, 1.0], [-0.18, 0.4, 0.78], [0.12, 0.38, 0.56]];
  for (const [y, h, r] of tiers) {
    const g = new THREE.ConeGeometry(r, h * 1.25, 9, 1);
    g.translate(0, y + h * 0.62, 0);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > y + h * 0.75;
      const v = 0.68 + 0.32 * clamp((p.getY(i) + 0.5), 0, 1);
      if (snow && (top || hash3(p.getX(i), p.getY(i), p.getZ(i)) < 0.15)) c.set([0.95, 0.97, 1.0], i * 3);
      else if (snow) c.set([0.17 * v, 0.38 * v, 0.22 * v], i * 3);
      else { c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}
function treeMat() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = foliageWind; sh.uniforms.uTime = foliageTime;
    sh.vertexShader = 'uniform float uWind, uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float k = (position.y + 0.6) * uWind;
        transformed.x += sin(uTime * 1.6 + ip.x * 0.11 + position.y * 2.0) * 0.03 * k;
        transformed.z += cos(uTime * 1.3 + ip.z * 0.13) * 0.025 * k; }`);
  };
  m.customProgramCacheKey = () => 'cartoonTree';
  return m;
}
const FUNKY_COLS = ['#ff6fb8', '#b97aff', '#3fd8c8', '#ffa03a', '#c8f04a', '#ff5a7a', '#7ab8ff'];
const TREE_CHUNK = 140;
function buildTrees() {
  const trunkG = new THREE.CylinderGeometry(0.2, 0.34, 1, 8, 1);
  const pg = conePine(false), sg = conePine(true), cg = blobCrown();
  const geo = { round: cg, funky: cg, pine: pg, snow: sg };
  const lowCrown = shadeGeo(new THREE.IcosahedronGeometry(0.85, 1).translate(0, 0.05, 0), 0.62, 1.0, -0.7, 0.9, 1);
  const lowPine = (snow) => { const g = new THREE.ConeGeometry(1.0, 1.0, 7, 1).translate(0, 0, 0).toNonIndexed(); const p = g.attributes.position, c2 = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const v = 0.7 + 0.3 * (p.getY(i) + 0.5); if (snow) c2.set(p.getY(i) > 0.1 ? [0.95, 0.97, 1] : [0.17 * v, 0.38 * v, 0.22 * v], i * 3); else c2.set([v, v, v], i * 3); } g.setAttribute('color', new THREE.BufferAttribute(c2, 3)); g.computeVertexNormals(); return g; };
  const lo = { round: lowCrown, funky: lowCrown, pine: lowPine(false), snow: lowPine(true) };
  const crown = treeMat();
  const mats = { trunk: new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.9 }), round: crown, funky: crown, pine: crown, snow: crown };
  const col = new THREE.Color();
  // each map square gets its own small instanced meshes, so trees behind you or far away aren't drawn
  const buckets = new Map();
  for (const t of treeDefs) {
    const key = Math.floor(t.x / TREE_CHUNK) + ',' + Math.floor(t.z / TREE_CHUNK);
    let bk = buckets.get(key);
    if (!bk) buckets.set(key, bk = { all: [], round: [], pine: [], snow: [], funky: [] });
    bk.all.push(t); bk[t.type].push(t);
  }
  for (const bk of buckets.values()) {
    const C = { trunk: new THREE.InstancedMesh(trunkG, mats.trunk, bk.all.length) };
    for (const type of ['round', 'pine', 'snow', 'funky']) if (bk[type].length) C[type] = new THREE.InstancedMesh(geo[type], mats[type], bk[type].length);
    const ci = { round: 0, pine: 0, snow: 0, funky: 0 };
    bk.all.forEach((t, i) => {
      const tree = { x: t.x, z: t.z, y: t.y, type: t.type, s: t.s, C, ti: i, ci: ci[t.type]++, hp: 5, alive: true, regrow: 0, shake: 0 };
      tree.collider = addCollider(t.x - 0.45, t.y - 1, t.z - 0.45, t.x + 0.45, t.y + 4 * t.s, t.z + 0.45, 'tree');
      G.trees.push(tree);
      setTreeMatrix(tree, 1);
      // leaf colour: fresh greens, darker pines, and bright candy colours in the Funky Forest
      if (t.type === 'funky') col.set(FUNKY_COLS[Math.floor(hash3(t.x, 1, t.z) * FUNKY_COLS.length)]);
      else if (t.type === 'round') col.setHSL(0.24 + hash3(t.x, 2, t.z) * 0.07, 0.62, 0.38 + hash3(t.x, 3, t.z) * 0.08);
      else if (t.type === 'snow') col.set('#ffffff');
      else col.setHSL(0.36 + hash3(t.x, 4, t.z) * 0.04, 0.5, 0.25 + hash3(t.x, 5, t.z) * 0.05);
      C[t.type].setColorAt(tree.ci, col);
    });
    for (const [type, im] of Object.entries(C)) {
      im.castShadow = type === 'trunk'; im.receiveShadow = true;
      if (lo[type]) {
        const px = new THREE.InstancedMesh(lo[type], proxyMat, im.count);
        px.instanceMatrix = im.instanceMatrix; px.layers.set(SHADOW_LAYER); px.castShadow = true; px.frustumCulled = false; px.userData.isProxy = true;
        im.add(px); im.userData.shadowProxy = px;
      }
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      G.scene.add(im);
      const bs = im.boundingSphere;
      chunkList.push({ mesh: im, x: bs.center.x, y: bs.center.y, z: bs.center.z, r: bs.radius, layer: 3, lod: lo[type] ? { hi: geo[type], lo: lo[type] } : null });
    }
  }
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _qq = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export function setTreeMatrix(tree, grow, lean = 0) {
  const s = tree.s * grow, y = tree.y || 0, C = tree.C, crown = C[tree.type];
  _e.set(lean * 0.6, 0, lean);
  _qq.setFromEuler(_e);
  _p.set(tree.x, y + 1.5 * s, tree.z); _s.set(s, 3 * s, s);
  _m.compose(_p, _qq, _s); C.trunk.setMatrixAt(tree.ti, _m);
  if (tree.type === 'round' || tree.type === 'funky') { _p.set(tree.x, y + 4.3 * s, tree.z); _s.set(2.4 * s, 2.2 * s, 2.4 * s); }
  else { _p.set(tree.x, y + 4.4 * s, tree.z); _s.set(2.3 * s, 5.2 * s, 2.3 * s); }
  _m.compose(_p, _qq, _s); crown.setMatrixAt(tree.ci, _m);
  if (grow === 0) { C.trunk.setMatrixAt(tree.ti, ZERO); crown.setMatrixAt(tree.ci, ZERO); }
  C.trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
}

// Lots of copies of one model spread over the island, split into map squares so far ones aren't drawn.
function chunkedInstances(items, parts, layer = 3, size = 160) {
  const buckets = new Map();
  for (const it of items) { const k = Math.floor(it[0] / size) + ',' + Math.floor(it[1] / size); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(it); }
  for (const list of buckets.values()) for (const P of parts) {
    const im = new THREE.InstancedMesh(P.geo, P.mat, list.length);
    list.forEach((it, i) => { P.matrix(it, _m, i); im.setMatrixAt(i, _m); if (P.color) im.setColorAt(i, P.color(it, i)); });
    im.castShadow = !!P.cast && !P.proxy; im.receiveShadow = true;
    if (P.proxy) { const px = new THREE.InstancedMesh(P.proxy, proxyMat, list.length); px.instanceMatrix = im.instanceMatrix; px.layers.set(SHADOW_LAYER); px.castShadow = true; px.frustumCulled = false; px.userData.isProxy = true; im.add(px); im.userData.shadowProxy = px; }
    im.computeBoundingSphere(); G.scene.add(im);
    const bs = im.boundingSphere;
    chunkList.push({ mesh: im, x: bs.center.x, y: bs.center.y, z: bs.center.z, r: bs.radius, layer, lod: P.lo ? { hi: P.geo, lo: P.lo } : null });
  }
}
// Cacti and rocks: simple instanced decorations with small colliders.
function buildInstanced(list, parts) {
  if (!list.length) return;
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
    if (inZone(x, z, 25)) continue;
    if (G.keepOut && G.keepOut(x, z)) continue;
    if (Math.abs(x + 30) < 12 && z > 0) continue;
    if (Math.abs(x - 30) < 12 && z < 0) continue;
    if (Math.abs(z - 30) < 12 && x < 0) continue;
    const h = heightAt(x, z);
    if (h < 0.8) continue;
    const b = biome(x, z), sl = slopeAt(x, z), r = srand();
    if (b.funky > 0.3 && sl < 0.8) { if (r < 0.2 * b.funky) addTree(x, z, srand() < 0.85 ? 'funky' : 'round', 0.95 + srand() * 0.8); }
    else if (b.west > 0.55 && h < 90 && sl < 0.7) { if (r < 0.09) addTree(x, z, srand() < 0.6 ? 'pine' : 'round', 0.9 + srand() * 0.7); }
    else if (b.north > 0.5 && sl < 0.9) {
      if (h < 115 && r < 0.035) addTree(x, z, h > 60 ? 'snow' : 'pine', 0.9 + srand() * 0.6);
      else if (r > 0.992) rocks.push({ x, z, y: h, s: 1 + srand() * 3, a: srand() * 6 });
    } else if (b.south > 0.55) {
      if (r < 0.02) addTree(x, z, 'round', 0.8 + srand() * 0.6);
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
// ---------------------------------------------------------------- flowers, bushes, balloons
const flowerPos = [], bushPos = [], extraLamps = [];
const FLOWER_COLS = ['#ff5a8a', '#ffd23a', '#b97aff', '#ff7a3a', '#ffffff', '#5ab8ff'];
function flowerAt(x, z) { flowerPos.push([x, z]); }
function bushAt(x, z, s = 1) { bushPos.push([x, z, s]); }
function flowerBed(x, z, w, d, n) { for (let i = 0; i < n; i++) flowerAt(x + (Math.random() - 0.5) * w, z + (Math.random() - 0.5) * d); }
function buildDecor() {
  const col = new THREE.Color();
  const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), mat('#3f9e52'), flowerPos.length);
  const head = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), flowerPos.length);
  flowerPos.forEach(([x, z], i) => {
    const y = heightAt(x, z);
    _m.makeTranslation(x, y + 0.25, z); stem.setMatrixAt(i, _m);
    _m.makeTranslation(x, y + 0.52, z); head.setMatrixAt(i, _m);
    head.setColorAt(i, col.set(FLOWER_COLS[i % FLOWER_COLS.length]));
  });
  for (const im of [stem, head]) { im.receiveShadow = true; im.computeBoundingSphere(); G.scene.add(im); }
  const bg = blobCrown(), blo = shadeGeo(new THREE.IcosahedronGeometry(0.85, 1), 0.62, 1.0, -0.7, 0.9, 1);
  chunkedInstances(bushPos, [{ geo: bg, lo: blo, mat: treeMat(), cast: false,
    matrix: ([x, z, sc], m, i) => { _qq.setFromAxisAngle(UPV, i * 1.7); _p.set(x, heightAt(x, z) + 0.4 * sc, z); _s.set(0.95 * sc, 0.75 * sc, 0.95 * sc); m.compose(_p, _qq, _s); },
    color: (it, i) => col.setHSL(0.26 + (i % 5) * 0.012, 0.6, 0.33 + (i % 3) * 0.04) }]);
}

// Hot-air balloons drifting over the island
function stripeTexture(cols) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 32;
  const x = c.getContext('2d');
  cols.forEach((cl, i) => { x.fillStyle = cl; x.fillRect(i * 256 / cols.length, 0, 256 / cols.length + 1, 32); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildBalloons() {
  G.balloons = [];
  const sets = [['#ff5b6e', '#ffd54a'], ['#3fa7ff', '#ffffff'], ['#b46cff', '#ff8fd0'], ['#46c25a', '#ffd54a'], ['#ff8a3d', '#ffffff', '#ff5b6e'], ['#3fd6d0', '#b46cff']];
  sets.forEach((cols, i) => {
    const g = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshLambertMaterial({ map: stripeTexture([...cols, ...cols, ...cols, ...cols]) }));
    env.scale.set(1, 1.2, 1); g.add(env);
    const bot = new THREE.Mesh(new THREE.ConeGeometry(4.6, 5, 20, 1, true), new THREE.MeshLambertMaterial({ color: cols[0], side: THREE.DoubleSide }));
    bot.position.y = -8.5; bot.rotation.x = Math.PI; g.add(bot);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), mat('#a0683a'));
    basket.position.y = -13; g.add(basket);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 4), mat('#6b4a2b'));
      r.position.set(sx * 1.4, -11, sz * 1.4); g.add(r);
    }
    const a = i / sets.length * Math.PI * 2;
    g.userData = { cx: Math.cos(a) * 300, cz: Math.sin(a) * 300, r: 120 + i * 40, sp: 0.01 + i * 0.002, ph: a, y: 110 + i * 18 };
    G.scene.add(g);
    G.balloons.push(g);
  });
}
// ---------------------------------------------------------------- bridges, farms, villages, turbines & more
function buildBridges(list) {
  list.forEach((b, i) => {
    const alongZ = Math.abs(b.dz) > Math.abs(b.dx);
    const L = b.len + 0.3, W = 10;
    const sx = alongZ ? W : L, sz = alongZ ? L : W;
    addCollider(b.x - sx / 2, b.y - 1.4, b.z - sz / 2, b.x + sx / 2, b.y, b.z + sz / 2, 'bridge');
    S(BOX, mat('#8a8680'), b.x, b.y - 0.8, b.z, 0, 0, 0, sx, 1.2, sz);
    // side rails
    for (const s2 of [-1, 1]) {
      const rx = alongZ ? b.x + s2 * (W / 2 + 0.2) : b.x, rz = alongZ ? b.z : b.z + s2 * (W / 2 + 0.2);
      S(BOX, mat('#b8b4ac'), rx, b.y + 0.5, rz, 0, 0, 0, alongZ ? 0.4 : L, 1, alongZ ? L : 0.4);
      addCollider(rx - (alongZ ? 0.2 : L / 2), b.y - 0.2, rz - (alongZ ? L / 2 : 0.2), rx + (alongZ ? 0.2 : L / 2), b.y + 1, rz + (alongZ ? L / 2 : 0.2));
    }
    if (i % 4 === 0) { const gy = heightAt(b.x, b.z); const ph = b.y - 1.4 - Math.min(gy, -3); S(BOX, mat('#7a7670'), b.x, b.y - 1.4 - ph / 2, b.z, 0, 0, 0, 2, ph, 2); }
  });
}

const zc = (k) => { const r = ZONES[k]; return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y: r.h, w: r.x1 - r.x0, d: r.z1 - r.z0 }; };
function gable(x, y, z, w, d, h, color) {
  hipRoof(x, y, z, w * 0.98, d * 0.98, h, color, 0.5);
}
function fenceLine(x0, z0, x1, z1, y) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 3));
  for (let i = 0; i <= n; i++) S(BOX, mat('#8a6a4a'), x0 + (x1 - x0) * i / n, y + 0.6, z0 + (z1 - z0) * i / n, 0, 0, 0, 0.18, 1.2, 0.18);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
  for (const hy of [0.5, 1.0]) S(BOX, mat('#9a7a5a'), cx, y + hy, cz, ang, 0, 0, 0.08, 0.1, len);
}
function buildFarm(k) {
  const Z = zc(k), y = Z.y;
  // barn
  const bx = Z.x - Z.w / 2 + 25, bz = Z.z - Z.d / 2 + 25;
  box(bx, y - 2, bz, 16, 10, 12, '#8a3a2e');
  gable(bx, y + 8, bz, 16.6, 13, 6, '#4a4f58');
  S(BOX, mat('#e8e0d0'), bx, y + 3, bz + 6.05, 0, 0, 0, 6, 6, 0.1);
  // silo
  S(CYL, mat('#b8bcc0'), bx + 13, y + 9, bz, 0, 0, 0, 3.2, 18, 3.2);
  S(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#8a9098'), bx + 13, y + 18, bz, 0, 0, 0, 3.2, 2.4, 3.2);
  addCollider(bx + 10, y - 2, bz - 3.2, bx + 16.2, y + 18, bz + 3.2);
  // farmhouse
  BY = y; house(bx - 4, bz + 30, 2, '#e0d6c4', true); BY = 0;
  // fields with crop rows
  const fx0 = Z.x - Z.w / 2 + 55, fx1 = Z.x + Z.w / 2 - 8, fz0 = Z.z - Z.d / 2 + 8, fz1 = Z.z + Z.d / 2 - 8;
  fenceLine(fx0, fz0, fx1, fz0, y); fenceLine(fx0, fz1, fx1, fz1, y); fenceLine(fx0, fz0, fx0, fz1, y); fenceLine(fx1, fz0, fx1, fz1, y);
  flat((fx0 + fx1) / 2, y + 0.05, (fz0 + fz1) / 2, fx1 - fx0, fz1 - fz0, '#6b5a40');
  const crops = [];
  const half = (fz0 + fz1) / 2;
  for (let x = fx0 + 3; x < fx1 - 2; x += 2.2) for (let z = fz0 + 3; z < fz1 - 2; z += 1.6) crops.push([x, z, z < half]);
  const cg = new THREE.ConeGeometry(0.35, 1.3, 5);
  const im = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), crops.length);
  const col = new THREE.Color();
  crops.forEach(([x, z, wheat], i) => { _m.makeTranslation(x, y + 0.65, z); im.setMatrixAt(i, _m); im.setColorAt(i, col.set(wheat ? '#c8a850' : '#5f8a3a')); });
  im.computeBoundingSphere(); im.receiveShadow = true; G.scene.add(im);
  // hay bales
  for (let i = 0; i < 6; i++) { const hx = bx - 10 + (i % 3) * 3, hz = bz - 10 - Math.floor(i / 3) * 3; S(CYL, mat('#c8a860'), hx, y + 0.9, hz, 0, 0, Math.PI / 2, 1, 1.6, 1); addCollider(hx - 0.8, y, hz - 1, hx + 0.8, y + 1.8, hz + 1); }
  sign(k === 'farm1' ? 'Hill Farm' : 'Oak Farm', bx, y + 16, bz + 7, '#fff', '#8a6a4a', 2.4);
  return { x: bx, z: bz + 16 };
}
function buildVillage(k, name) {
  const Z = zc(k), y = Z.y;
  flat(Z.x, y + 0.04, Z.z, 30, 30, '#cfc6b3');
  S(CYL, mat('#8a8680'), Z.x, y + 0.6, Z.z, 0, 0, 0, 2, 1.2, 2);
  S(CYL, mat('#3a5a7a'), Z.x, y + 1.15, Z.z, 0, 0, 0, 1.7, 0.1, 1.7);
  addCollider(Z.x - 2, y - 1, Z.z - 2, Z.x + 2, y + 1.2, Z.z + 2);
  BY = y;
  const cols = ['#e8dcc8', '#c8d0d8', '#d8c8b8', '#b8c4b0', '#e0d0b0', '#d0b8a0'];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, r = 36;
    const hx = Z.x + Math.cos(a) * r, hz = Z.z + Math.sin(a) * r;
    const face = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 1 : 0) : (Math.sin(a) > 0 ? 3 : 2);
    house(hx, hz, face, cols[i % cols.length], i % 3 === 0);
  }
  BY = 0;
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28 + 0.3; addTree(Z.x + Math.cos(a) * 55, Z.z + Math.sin(a) * 55, 'round'); }
  sign(name, Z.x, y + 7, Z.z, '#fff', '#6a8a55', 2.6);
  return { x: Z.x + 16, z: Z.z };
}
function buildGas(k) {
  const Z = zc(k), y = Z.y;
  flat(Z.x, y + 0.05, Z.z, Z.w, Z.d, '#9aa0aa');
  for (const [dx, dz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) box(Z.x + dx, y - 1, Z.z + dz, 0.5, 6.5, 0.5, '#d8d8d8');
  S(BOX, mat('#c83a2e'), Z.x, y + 5.8, Z.z, 0, 0, 0, 15, 0.8, 13);
  for (const dx of [-3, 3]) box(Z.x + dx, y, Z.z, 1, 1.8, 0.7, '#e8e8e8');
  box(Z.x, y - 1, Z.z + (Z.d / 2 - 5), 12, 5, 6, '#e0dcd4');
  sign('FUEL', Z.x, y + 8.5, Z.z, '#fff', '#c83a2e', 2);
}
function buildTurbines() {
  G.turbines = [];
  let placed = 0, tries = 0;
  while (placed < 12 && tries++ < 3000) {
    const x = 600 + srand() * 650, z = -150 + srand() * 700;
    if (inZone(x, z, 60) || riverDist(x, z) < 40) continue;
    const y = heightAt(x, z);
    if (y < 8 || slopeAt(x, z) > 0.35) continue;
    if (G.turbines.some(t => Math.hypot(t.x - x, t.z - z) < 80)) continue;
    S(CYL8, mat('#e8eaec'), x, y + 22, z, 0, 0, 0, 1, 44, 1);
    addCollider(x - 1.2, y - 1, z - 1.2, x + 1.2, y + 44, z + 1.2);
    const rot = new THREE.Group();
    rot.position.set(x, y + 44, z + 1.6);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat('#e8eaec')); rot.add(hub);
    for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.8, 17, 0.25), mat('#f0f2f4')); bl.position.y = 8.5; const arm = new THREE.Group(); arm.rotation.z = b * Math.PI * 2 / 3; arm.add(bl); rot.add(arm); }
    const nac = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 5), mat('#e8eaec')); nac.position.set(x, y + 44, z - 0.8);
    G.scene.add(rot, nac);
    G.turbines.push({ x, z, rot, sp: 0.5 + srand() * 0.4 });
    placed++;
  }
}
function buildCastle() {
  const pk = findPeak(-1120, 840, -640, 1080);
  const x = pk.x, z = pk.z, y = pk.h;
  const R = 22, wallH = 9;
  for (const [dx, dz, sx, sz] of [[0, -R, 2 * R, 3], [0, R, 2 * R, 3], [-R, 0, 3, 2 * R], [R, 0, 3, 2 * R]]) {
    if (dz === R) { // gate gap
      box(x - R / 2 - 3, y - 8, z + R, R - 6, wallH + 8, 3, '#8a847a'); box(x + R / 2 + 3, y - 8, z + R, R - 6, wallH + 8, 3, '#8a847a');
    } else box(x + dx, y - 8, z + dz, sx, wallH + 8, sz, '#8a847a');
  }
  for (const [dx, dz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) { S(CYL, mat('#7a746a'), x + dx, y + 2, z + dz, 0, 0, 0, 4, 22, 4); S(new THREE.ConeGeometry(1, 1, 12), mat('#4a4f58'), x + dx, y + 16, z + dz, 0, 0, 0, 4.6, 6, 4.6); addCollider(x + dx - 4, y - 9, z + dz - 4, x + dx + 4, y + 13, z + dz + 4); }
  box(x, y - 6, z - 4, 16, 22, 14, '#7a746a');
  for (let i = -3; i <= 3; i++) S(BOX, mat('#8a847a'), x + i * 6, y + wallH + 0.8, z - R, 0, 0, 0, 2.4, 1.6, 3);
  sign('Old Castle', x, y + 22, z + R + 2, '#fff', '#7a746a', 3);
  return { x, z: z + R + 10, y };
}
function buildCamp() {
  const Z = zc('camp'), y = Z.y;
  for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; S(CONE4, mat(['#5a6a4a', '#6a5a4a', '#4a5a6a'][i % 3]), Z.x + Math.cos(a) * 12, y + 1.3, Z.z + Math.sin(a) * 12, a + Math.PI / 4, 0, 0, 2.6, 2.6, 2.6); }
  for (let i = 0; i < 4; i++) S(CYL8, mat('#6b4a2b'), Z.x, y + 0.2, Z.z, i * 0.8, 0, Math.PI / 2, 0.15, 1.6, 0.15);
  S(new THREE.ConeGeometry(0.5, 1.2, 7), mat('#ff8a2a', { emissive: '#ff5500', emissiveIntensity: 1 }), Z.x, y + 0.7, Z.z);
  for (let i = 0; i < 3; i++) bench(Z.x + Math.cos(i * 2.1) * 4, Z.z + Math.sin(i * 2.1) * 4, -i * 2.1);
  sign('Campsite', Z.x, y + 5, Z.z + 6, '#fff', '#5a6a4a', 2);
  return { x: Z.x + 6, z: Z.z + 6 };
}
function buildSpaceCenter() {
  const Z = zc('space'), y = Z.y;
  flat(Z.x, y + 0.04, Z.z, Z.w, Z.d, '#9a9a96');
  const px = Z.x + 30, pz = Z.z;
  box(px, y - 3, pz, 34, 3.4, 34, '#8a8a86');                       // launch pad
  S(BOX, mat('#2a2a2a'), px, y + 0.42, pz, 0, 0, 0, 10, 0.05, 30);   // flame trench
  // lattice launch tower
  const tx = px + 13, tz = pz, TH = 88;
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) S(BOX, mat('#b8382e'), tx + dx, y + TH / 2, tz + dz, 0, 0, 0, 0.6, TH, 0.6);
  for (let hy = 4; hy < TH; hy += 6) {
    S(BOX, mat(hy % 12 === 4 ? '#e8e8e8' : '#b8382e'), tx, y + hy, tz - 3, 0, 0, 0, 6.6, 0.4, 0.4); S(BOX, mat('#b8382e'), tx, y + hy, tz + 3, 0, 0, 0, 6.6, 0.4, 0.4);
    S(BOX, mat('#b8382e'), tx - 3, y + hy, tz, 0, 0, 0, 0.4, 0.4, 6.6); S(BOX, mat('#b8382e'), tx + 3, y + hy, tz, 0, 0, 0, 0.4, 0.4, 6.6);
    S(BOX, mat('#9a2e26'), tx, y + hy + 3, tz - 3, 0, 0, 0.78, 0.25, 8.4, 0.25);
  }
  addCollider(tx - 3.3, y, tz - 3.3, tx + 3.3, y + TH, tz + 3.3);
  for (const hy of [30, 62]) S(BOX, mat('#8a8a86'), tx - 7, y + hy, tz, 0, 0, 0, 8, 0.8, 2.4);  // access arms
  // fuel tanks and control centre
  for (const dz of [-18, 18]) { S(new THREE.SphereGeometry(1, 16, 12), mat('#e8e8e8'), Z.x - 40, y + 8, Z.z + dz, 0, 0, 0, 7, 7, 7); addCollider(Z.x - 47, y, Z.z + dz - 7, Z.x - 33, y + 15, Z.z + dz + 7); }
  building(Z.x - 60, Z.z - 70 + 30, 30, 18, 12, '#d8d8d4', '#4a4f58');
  sign('BOBBLY SPACE CENTER', Z.x - 60, y + 17, Z.z - 30, '#fff', '#3a6ab0', 3.4);
  LOC.space = { x: px - 10, z: pz + 21 };
  LOC.rocketPad = { x: px, z: pz, y: y + 0.4, towerX: tx };
}
// ---------------------------------------------------------------- airports
let rwMat = null;
function paved(x, y, z, w, d, material) { S(flatGeo(w, d, 10), material, x, y, z, 0, -Math.PI / 2, 0, w, d, 1); }
// big painted letters/numbers lying on the ground; the top of the text points along heading `ry`
function groundText(text, x, y, z, size, ry) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#f0f0ea'; g.font = '800 170px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, ry, 0);
  m.position.set(x, y, z); m.renderOrder = 1;
  G.scene.add(m);
}
const lampGlow = (c, e) => mat(c, { emissive: e, emissiveIntensity: 0.9 });
// East-west runway with real markings: x0..x1 along X, centred on z
function runway(x0, x1, z, y, W, numW, numE) {
  const L = x1 - x0, cx = (x0 + x1) / 2, top = y + 0.08;
  paved(cx, y + 0.05, z, L + 20, W + 14, mat('#7a7e84'));          // shoulders
  paved(cx, y + 0.065, z, L, W, rwMat);
  const white = mat('#ecece6');
  for (let x = x0 + 70; x < x1 - 70; x += 50) flat(x, top, z, 30, 0.9, white);            // centreline
  for (const s of [-1, 1]) flat(cx, top, z + s * (W / 2 - 1), L - 4, 0.8, white);         // edge lines
  for (const [end, dir] of [[x0, 1], [x1, -1]]) {
    const n = Math.floor((W - 8) / 4.2);
    for (let i = 0; i < n; i++) if (Math.abs(i - (n - 1) / 2) > 0.6) flat(end + dir * 20, top, z - (n - 1) * 2.1 + i * 4.2, 28, 1.8, white);   // piano keys
    flat(end + dir * 2, top, z, 1.2, W - 2, white);                                                             // threshold bar
    for (const s of [-1, 1]) flat(end + dir * 150, top, z + s * W * 0.2, 44, 5, white);                        // aiming points
    for (const k of [230, 290]) for (const s of [-1, 1]) for (const o of [0, 3]) flat(end + dir * k, top, z + s * (W * 0.2 + o), 22, 1.6, white);
    for (let i = -W / 2; i <= W / 2 + 0.1; i += 4) {
      S(BOX, lampGlow('#40ff70', '#20ff50'), end - dir * 1, y + 0.3, z + i, 0, 0, 0, 0.4, 0.3, 0.4);
      S(BOX, lampGlow('#ff3030', '#ff1010'), end - dir * 3, y + 0.3, z + i, 0, 0, 0, 0.4, 0.3, 0.4);
    }
  }
  for (let x = x0; x <= x1; x += 30) for (const s of [-1, 1]) S(BOX, lampGlow('#ffffff', '#fff4d0'), x, y + 0.3, z + s * (W / 2 + 1.5), 0, 0, 0, 0.35, 0.35, 0.35);
  groundText(numW, x0 + 62, top + 0.01, z, 20, -Math.PI / 2);
  groundText(numE, x1 - 62, top + 0.01, z, 20, Math.PI / 2);
}
function taxiway(x0, z0, x1, z1, y, W = 18) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  paved(cx, y + 0.06, cz, alongX ? L + W : W, alongX ? W : L + W, rwMat);
  flat(cx, y + 0.085, cz, alongX ? L : 0.45, alongX ? 0.45 : L, mat('#e8b418'));
  for (let t = 0; t <= L; t += 30) {
    const px = alongX ? Math.min(x0, x1) + t : cx, pz = alongX ? cz : Math.min(z0, z1) + t;
    for (const s of [-1, 1]) S(BOX, lampGlow('#3a7cff', '#2060ff'), px + (alongX ? 0 : s * (W / 2 + 1)), y + 0.25, pz + (alongX ? s * (W / 2 + 1) : 0), 0, 0, 0, 0.3, 0.3, 0.3);
  }
}
function glassBuilding(x, y, z, w, h, d, color = '#9fb6c6') {
  S(windowBoxGeo(w, h, d), bmat(color), x, y + h / 2, z);
  S(BOX, mat('#d8d8d4'), x, y + h + 0.3, z, 0, 0, 0, w + 1, 0.6, d + 1);
  addCollider(x - w / 2, y - 1, z - d / 2, x + w / 2, y + h + 0.6, z + d / 2);
}
// arched-roof hangar, open door facing +z
function hangar(x, y, z, w, d, h) {
  const arch = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, -Math.PI / 2, Math.PI);
  arch.rotateX(Math.PI / 2);
  S(arch, mat('#b9bec4', { side: THREE.DoubleSide }), x, y + h - w * 0.25, z, 0, 0, 0, w / 2, w * 0.25, d);
  S(BOX, mat('#9aa0a8'), x, y + (h - w * 0.25) / 2, z - d / 2, 0, 0, 0, w, h - w * 0.25, 0.4);
  S(new THREE.CircleGeometry(1, 24, 0, Math.PI), mat('#9aa0a8', { side: THREE.DoubleSide }), x, y + h - w * 0.25, z - d / 2, 0, 0, 0, w / 2, w * 0.25, 1);
  for (const sx of [-1, 1]) {
    S(BOX, mat('#9aa0a8'), x + sx * w / 2, y + (h - w * 0.25) / 2, z, 0, 0, 0, 0.4, h - w * 0.25, d);
    addCollider(x + sx * w / 2 - 0.3, y, z - d / 2, x + sx * w / 2 + 0.3, y + h, z + d / 2);
  }
  addCollider(x - w / 2, y, z - d / 2 - 0.3, x + w / 2, y + h, z - d / 2 + 0.3);
  paved(x, y + 0.04, z, w, d, mat('#a8acb0'));
}
function controlTower(x, y, z, h) {
  S(CYL, mat('#d8d4cc'), x, y + h / 2, z, 0, 0, 0, 2.6, h, 2.6);
  S(CYL, mat('#c8c4bc'), x, y + h - 1, z, 0, 0, 0, 5, 2, 5);
  S(new THREE.CylinderGeometry(1, 1.15, 1, 8), bmat('#6f93ad'), x, y + h + 2.5, z, 0, 0, 0, 6.2, 5, 6.2);
  S(new THREE.CylinderGeometry(1, 1, 1, 8), mat('#4a4f58'), x, y + h + 5.3, z, 0, 0, 0, 6.8, 0.6, 6.8);
  S(CYL8, mat('#8a8e94'), x, y + h + 8, z, 0, 0, 0, 0.12, 5, 0.12);
  S(BOX, lampGlow('#ff3030', '#ff0000'), x, y + h + 10.6, z, 0, 0, 0, 0.4, 0.4, 0.4);
  addCollider(x - 3, y, z - 3, x + 3, y + h + 5.6, z + 3);
}
function windsock(x, y, z) {
  S(CYL8, mat('#dcdcdc'), x, y + 3.5, z, 0, 0, 0, 0.1, 7, 0.1);
  for (let i = 0; i < 4; i++) S(new THREE.CylinderGeometry(1, 0.85, 1, 10, 1, true), mat(i % 2 ? '#ffffff' : '#ff6a1a', { side: THREE.DoubleSide }), x + 0.6 + i * 0.9, y + 6.6, z, 0, 0, -Math.PI / 2, 0.5 - i * 0.07, 0.9, 0.5 - i * 0.07);
}
function airportParking(x0, z0, cols, rows, y, spots) {
  paved(x0 + cols * 1.6, y + 0.05, z0 + rows * 3.5, cols * 3.2 + 6, rows * 7 + 6, streetMat);
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) flat(x0 + c * 3.2, y + 0.07, z0 + r * 7 + 3.5, 0.12, 5.5, mat('#ecece6'));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((r * 7 + c * 3) % 4 === 0) spots.push({ x: x0 + c * 3.2 + 1.6, z: z0 + r * 7 + 3.5, y, yaw: r % 2 ? 0 : Math.PI });
}
function buildAirports() {
  if (!rwMat) rwMat = roadMatOf(false, '#cfcac2');
  if (!streetMat) streetMat = roadMatOf(false, '#b8b8bc');
  LOC.airports = [{ name: 'Town Airfield', x: -140, z: 168, yaw: Math.PI / 2 }];
  LOC.airportCars = [];
  LOC.parkedPlanes = [];
  // ===== Bobbly International (south) =====
  {
    const y = ZONES.intl.h;
    runway(356, 978, -455, y, 50, '09', '27');
    taxiway(390, -500, 950, -500, y);
    for (const x of [390, 700, 950]) taxiway(x, -480, x, -500, y);
    // apron + gates with jet bridges
    paved(700, y + 0.05, -535, 380, 54, mat('#b9bec7'));
    [560, 640, 720, 800].forEach((gx, i) => {
      flat(gx, y + 0.09, -526, 0.5, 34, mat('#e8b418'));
      flat(gx, y + 0.09, -547, 8, 0.5, mat('#e8b418'));
      groundText(String(i + 1), gx + 7, y + 0.1, -540, 6, 0);
      const bx = gx - 4.2;
      S(CYL, mat('#c8ccd2'), bx, y + 2.6, -568, 0, 0, 0, 2.2, 5.2, 2.2);
      S(BOX, bmat('#c8ccd2'), bx, y + 3.7, -555.5, 0, 0, 0, 3, 2.8, 23);
      S(BOX, mat('#40444a'), bx, y + 3.7, -543.3, 0, 0, 0, 3.4, 3.2, 1.6);
      for (const lz of [-560, -548]) S(BOX, mat('#555a60'), bx, y + 1.1, lz, 0, 0, 0, 0.5, 2.3, 0.5);
      addCollider(bx - 1.6, y + 2.3, -568, bx + 1.6, y + 5.3, -542.5);
      LOC.parkedPlanes.push({ t: 'airliner', x: gx, z: -526, yaw: Math.PI, livery: i % 3 });
      S(BOX, mat('#e8b418'), gx + 11, y + 0.8, -540, 0, 0, 0, 1.6, 1.2, 2.4);
      for (let k = 0; k < 3; k++) S(BOX, mat('#7a7f86'), gx + 11, y + 0.7, -536.5 + k * 3, 0, 0, 0, 1.5, 1.0, 2.4);
    });
    // terminal: long glass hall under a floating roof
    glassBuilding(700, y, -588, 360, 16, 34, '#8fb0c4');
    S(BOX, mat('#e8e6e0'), 700, y + 17.2, -582, 0, 0, 0, 376, 1.2, 50);
    for (let x = 530; x <= 870; x += 34) S(CYL8, mat('#e8e6e0'), x, y + 8.6, -560, 0, 0, 0, 0.4, 17, 0.4);
    glassBuilding(700, y + 16, -592, 120, 8, 22, '#7fa2b8');
    sign('BOBBLY INTERNATIONAL AIRPORT', 700, y + 32, -572, '#fff', '#2f6fd6', 7);
    paved(700, y + 0.05, -612, 380, 12, streetMat);
    airportParking(895, -604, 16, 3, y, LOC.airportCars);
    controlTower(905, y, -535, 42);
    hangar(470, y, -585, 50, 44, 22);
    windsock(965, y, -520);
    for (const [fx, fz] of [[436, -522], [436, -548]]) { S(CYL, mat('#e8e8e4'), fx, y + 4, fz, 0, 0, 0, 7, 8, 7); addCollider(fx - 7, y, fz - 7, fx + 7, y + 8, fz + 7); }
    LOC.intl = { x: 680, z: -548 };
    LOC.airports.push({ name: 'Bobbly International', x: 368, z: -455, yaw: Math.PI / 2 });
    LOC.parkedPlanes.push({ t: 'jet', x: 462, z: -580, yaw: 0 }, { t: 'biplane', x: 480, z: -590, yaw: 0 });
  }
  // ===== South-West Regional =====
  {
    const y = ZONES.swAir.h;
    runway(-1088, -752, -1040, y, 34, '09', '27');
    taxiway(-940, -1022, -940, -1008, y, 14);
    paved(-905, y + 0.05, -1003, 150, 24, mat('#b9bec7'));
    glassBuilding(-900, y, -981, 46, 9, 12, '#a9bccb');
    sign('SW REGIONAL AIRPORT', -900, y + 13, -975, '#fff', '#2f9a5a', 4);
    controlTower(-862, y, -984, 18);
    hangar(-1030, y, -994, 32, 26, 14);
    windsock(-790, y, -1016);
    LOC.swAir = { x: -905, z: -996 };
    LOC.airports.push({ name: 'SW Regional', x: -1078, z: -1040, yaw: Math.PI / 2 });
    LOC.parkedPlanes.push({ t: 'airliner', x: -890, z: -1009, yaw: Math.PI / 2, livery: 2 }, { t: 'biplane', x: -1040, z: -996, yaw: 0 }, { t: 'jet', x: -1020, z: -996, yaw: 0 });
  }
}

function buildWildPlaces() {
  buildSpaceCenter();
  buildAirports();
  LOC.farm = buildFarm('farm2');
  LOC.village = buildVillage('village2', 'Sunset Hills');
  buildGas('gasN'); buildGas('gasS');
  buildTurbines();
  LOC.castle = buildCastle();
  LOC.camp = buildCamp();
}
export function updateTurbines(dt) { for (const t of G.turbines || []) t.rot.rotation.z += dt * t.sp; }

export function updateBalloons(t) {
  for (const b of G.balloons || []) {
    const u = b.userData, a = u.ph + t * u.sp;
    b.position.set(u.cx + Math.cos(a) * u.r, u.y + Math.sin(t * 0.3 + u.ph) * 6, u.cz + Math.sin(a) * u.r);
    b.rotation.y = t * 0.05;
  }
}

// ---------------------------------------------------------------- Mega City & Suburbs

// ---------------------------------------------------------------- palm trees (instanced)
const palmPos = [];
function palmAt(x, z, s = 1) { palmPos.push([x, z, s * (0.85 + Math.random() * 0.35), Math.random() * 6.28]); }
function buildPalms() {
  if (!palmPos.length) return;
  const n = palmPos.length;
  // one frond geometry: 8 drooping leaves merged
  const leaves = [];
  for (let k = 0; k < 8; k++) {
    const g = new THREE.ConeGeometry(0.55, 4.2, 4);
    g.rotateX(Math.PI / 2); g.translate(0, 0, 2.1); g.rotateX(0.35); g.scale(1, 0.25, 1); g.rotateY(k * Math.PI / 4);
    leaves.push(g.index ? g.toNonIndexed() : g);
  }
  const crownG = mergeGeometries(leaves);
  crownG.computeVertexNormals();
  const crownM = new THREE.MeshStandardMaterial({ color: '#4fb83a', roughness: 0.8, flatShading: true, side: THREE.DoubleSide });
  const trunkM = new THREE.MeshStandardMaterial({ color: '#a8845a', roughness: 0.9 }), trunkG = new THREE.CylinderGeometry(0.22, 0.34, 1, 7);
  for (const [x, z, sc] of palmPos) { const y = heightAt(x, z), h = 11 * sc; addCollider(x - 0.35, y - 1, z - 0.35, x + 0.35, y + h, z + 0.35, 'tree'); }
  chunkedInstances(palmPos, [
    { geo: trunkG, mat: trunkM, cast: true, matrix: ([x, z, sc, a], m) => { const y = heightAt(x, z), h = 11 * sc; _qq.setFromEuler(_e.set(0, a, 0.04)); m.compose(_p.set(x, y + h / 2, z), _qq, _s.set(1, h, 1)); } },
    { geo: crownG, mat: crownM, cast: true, matrix: ([x, z, sc, a], m) => { const y = heightAt(x, z), h = 11 * sc; _qq.setFromEuler(_e.set(0, a, 0.04)); m.compose(_p.set(x + 0.2, y + h, z), _qq, _s.set(sc, sc, sc)); } },
  ]);
  void n;
}

// ---------------------------------------------------------------- Downtown (LA-style big city)
let cityRoadMat = null, streetMat = null;
function roadStrip(x, z, len, alongX, w = 10, plain = false) {
  if (!cityRoadMat) cityRoadMat = roadMatOf(true);
  if (!streetMat) streetMat = roadMatOf(false, '#b8b8bc');
  const m = plain ? streetMat : cityRoadMat;
  if (alongX) S(flatGeo(w, len, 10), m, x, 0.02, z, 0, -Math.PI / 2, Math.PI / 2, w, len, 1);
  else S(flatGeo(w, len, 10), m, x, 0.021, z, 0, -Math.PI / 2, 0, w, len, 1);
}
function tower(x, z, w, d, h, color, roof = '#6b7079', antenna = false) {
  beginB(color);
  const style = h > 90 ? (Math.random() < 0.7 ? 'glass' : 'punched') : h > 36 ? pick(['punched', 'ribbon', 'glass']) : pick(['punched', 'punched', 'ribbon']);
  const walkIn = h >= 20 && w >= 12 && d >= 12 && Math.random() < 0.55;
  if (walkIn) groundFloor(x, z, w, d, h, color, style);
  else { facade3D(x, z, w, d, 0, h, color, style); addCollider(x - w / 2, 0, z - d / 2, x + w / 2, h + 0.3, z + d / 2); }
  roofTop(x, z, w, d, h, color, style, { noMast: antenna });
  // stair and lift house on the roof, with a door
  const pw = Math.min(4, w / 3), pd = Math.min(4, d / 3);
  box(x - w / 4, h + 0.3, z - d / 4, pw, 2.8, pd, stone(shade(color, 0.9)));
  S(tbox(pw + 0.3, 0.2, pd + 0.3), stone('#6e7177'), x - w / 4, h + 3.2, z - d / 4);
  inLayer(LAYER.DETAIL, () => S(tbox(1.0, 2.1, 0.08), metal('#5a6068', 0.5), x - w / 4 + pw / 2 - 0.9, h + 1.35, z - d / 4 + pd / 2 + 0.04));
  if (antenna) { S(CYL8, metal('#d8dadc'), x, h + 12, z, 0, 0, 0, 0.3, 22, 0.3); S(BALL_G, mat('#ff3030', { emissive: '#ff0000', emissiveIntensity: 1 }), x, h + 23.5, z, 0, 0, 0, 0.7, 0.7, 0.7); }
  endB();
  return h;
}
const BALL_G = new THREE.SphereGeometry(1, 10, 8);
// The street level of a city tower: glass shop front with a door, and a shop, café or lobby inside.
// Lobbies have an elevator straight up to the roof.
const GF = 5.2;
function groundFloor(x, z, w, d, h, color, style = 'punched') {
  const M = interiorMats();
  facade3D(x, z, w, d, GF, h, color, style);
  addCollider(x - w / 2, GF - 0.3, z - d / 2, x + w / 2, h + 0.3, z + d / 2);
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const frame = mat('#2a2d33');
  S(BOX, frame, x, GF - 0.25, z, 0, 0, 0, w + 0.3, 0.5, d + 0.3);            // band over the shop fronts
  S(BOX, M.plaster, x, GF - 0.52, z, 0, 0, 0, w - 0.3, 0.04, d - 0.3);       // ceiling
  for (const cx of [x0, x1]) for (const cz of [z0, z1]) { S(BOX, frame, cx, GF / 2, cz, 0, 0, 0, 0.7, GF, 0.7); addCollider(cx - 0.35, 0, cz - 0.35, cx + 0.35, GF, cz + 0.35); }
  const side = Math.floor(Math.random() * 4);             // which side has the door
  const glassX = (xa, xb, zz) => { if (xb - xa < 0.1) return; S(BOX, M.glass, (xa + xb) / 2, GF / 2 - 0.25, zz, 0, 0, 0, xb - xa, GF - 0.5, 0.06); addCollider(xa, 0, zz - 0.1, xb, GF, zz + 0.1); for (let mx = xa + 2.5; mx < xb - 0.5; mx += 2.5) S(BOX, frame, mx, GF / 2, zz, 0, 0, 0, 0.1, GF, 0.12); };
  const glassZ = (za, zb, xx) => { if (zb - za < 0.1) return; S(BOX, M.glass, xx, GF / 2 - 0.25, (za + zb) / 2, 0, 0, 0, 0.06, GF - 0.5, zb - za); addCollider(xx - 0.1, 0, za, xx + 0.1, GF, zb); for (let mz = za + 2.5; mz < zb - 0.5; mz += 2.5) S(BOX, frame, xx, GF / 2, mz, 0, 0, 0, 0.12, GF, 0.1); };
  const door = 1.6;
  if (side === 0) { glassX(x0 + 0.35, x - door, z1); glassX(x + door, x1 - 0.35, z1); S(BOX, M.glass, x, 3.0 + (GF - 3.5) / 2, z1, 0, 0, 0, door * 2, GF - 3.5, 0.06); } else glassX(x0 + 0.35, x1 - 0.35, z1);
  if (side === 1) { glassX(x0 + 0.35, x - door, z0); glassX(x + door, x1 - 0.35, z0); } else glassX(x0 + 0.35, x1 - 0.35, z0);
  if (side === 2) { glassZ(z0 + 0.35, z - door, x1); glassZ(z + door, z1 - 0.35, x1); } else glassZ(z0 + 0.35, z1 - 0.35, x1);
  if (side === 3) { glassZ(z0 + 0.35, z - door, x0); glassZ(z + door, z1 - 0.35, x0); } else glassZ(z0 + 0.35, z1 - 0.35, x0);
  S(BOX, M.tile, x, 0.04, z, 0, 0, 0, w - 0.4, 0.04, d - 0.4);
  addCollider(x0, -1, z0, x1, 0.06, z1);
  for (let lx = x0 + 3; lx < x1 - 1; lx += 4.5) for (let lz = z0 + 3; lz < z1 - 1; lz += 4.5) S(BOX, M.lamp, lx, GF - 0.56, lz, 0, 0, 0, 1.2, 0.04, 1.2);
  G.interiors.push({ x0, x1, z0, z1, y0: -0.5, y1: GF });
  const kind = pick(['shop', 'shop', 'cafe', 'lobby']);
  (G.walkIns ||= []).push({ x, z, w, d, kind, side });
  const y = 0.06;
  curLayer = LAYER.INSIDE;
  if (kind === 'shop') {
    // supermarket aisles with stocked shelves and a checkout
    for (let sz = z0 + 3; sz < z1 - 3; sz += 3.2) {
      const len = w - 6, cx = x + 0.5;
      S(shelfGeo(len), M.stock, cx, y + 0.9, sz);
      addCollider(cx - len / 2, 0, sz - 0.35, cx + len / 2, 1.8, sz + 0.35);
    }
    S(BOX, M.darkWood, x0 + 1.6, y + 0.5, z, 0, 0, 0, 0.8, 1.0, 2.4); S(BOX, M.screen, x0 + 1.6, y + 1.2, z - 0.6, 0, 0, 0, 0.4, 0.3, 0.05);
    addCollider(x0 + 1.2, 0, z - 1.2, x0 + 2.0, 1.0, z + 1.2);
  } else if (kind === 'cafe') {
    S(BOX, M.darkWood, x, y + 0.55, z0 + 1.2, 0, 0, 0, w - 4, 1.1, 0.8); S(BOX, M.lightWood, x, y + 1.12, z0 + 1.2, 0, 0, 0, w - 3.8, 0.06, 0.9);
    addCollider(x - w / 2 + 2, 0, z0 + 0.8, x + w / 2 - 2, 1.1, z0 + 1.6);
    S(BOX, M.steel, x - 2, y + 1.4, z0 + 1.0, 0, 0, 0, 0.7, 0.5, 0.5);
    for (let tx = x0 + 3; tx < x1 - 2; tx += 3.4) for (let tz = z0 + 4.5; tz < z1 - 2; tz += 3.4) { table(tx, tz, 0, y, 0.9, 0.9, 0.75, M.white); chair(tx, tz + 0.75, Math.PI, y); chair(tx, tz - 0.75, 0, y); plant(tx + 1.4, tz, y); }
  } else {
    // office lobby: reception desk, sofas, plants and an elevator to the roof
    S(BOX, M.lightWood, x, y + 0.55, z, 0, 0, 0, 3.2, 1.1, 0.9); S(BOX, M.white, x, y + 1.12, z, 0, 0, 0, 3.4, 0.06, 1.0);
    addCollider(x - 1.6, 0, z - 0.45, x + 1.6, 1.1, z + 0.45);
    sofa(x0 + 1.5, z + 2.5, -Math.PI / 2, y); sofa(x0 + 1.5, z - 2.5, -Math.PI / 2, y);
    plant(x1 - 1, z1 - 1, y); plant(x1 - 1, z0 + 1, y); plant(x0 + 1, z0 + 1, y);
    const ex = x1 - 0.2, ez = z;
    S(BOX, M.gold, ex - 0.05, y + 1.3, ez, 0, 0, 0, 0.08, 2.6, 2.2); S(BOX, M.black, ex - 0.1, y + 1.25, ez, 0, 0, 0, 0.04, 2.4, 0.04);
    const roofY = h + 0.3;
    G.interacts.push({ x: ex - 1, z: ez, y: 0.1, dy: 2.5, r: 2, label: () => '🛗 Take the elevator to the roof', action: () => { const P = G.player; P.place(x - w / 4 + 3, roofY + 0.2, z - d / 4, 0); G.toast && G.toast(`🛗 Ding! Roof of a ${Math.round(h)} m tower. Jump off with a wingsuit (Space)!`); } });
    G.interacts.push({ x: x - w / 4, z: z - d / 4 + 2.5, y: roofY, dy: 3, r: 2.5, label: () => '🛗 Elevator back down', action: () => { G.player.place(ex - 1.5, 0.2, ez, -Math.PI / 2); } });
  }
  curLayer = LAYER.BASE;
}
// Supermarket shelving: the long sides show stocked shelves, the ends and top are plain.
const shelfCache = new Map();
function shelfGeo(len) {
  const k = Math.round(len * 10);
  if (shelfCache.has(k)) return shelfCache.get(k);
  const g = new THREE.BoxGeometry(len, 1.8, 0.7), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const f = Math.floor(i / 4);
    if (f === 4 || f === 5) uv.setXY(i, uv.getX(i) * len / 1.6, 0.03 + uv.getY(i) * 0.94);
    else uv.setXY(i, 0.5, 0.995);
  }
  shelfCache.set(k, g);
  return g;
}
const CITY_COLS = ['#b8c8d8', '#8fa8c0', '#d8d0c0', '#c0b8b0', '#a8b8c8', '#e0dcd4', '#9ab0b8', '#c8b8a8', '#7f98b0', '#b0a090', '#6f8aa6', '#d0c4b0'];

function buildMegaCity() {
  const xs = []; for (let x = -210; x >= -990; x -= 60) xs.push(x);
  const zs = [-460, -400, -340, -280, -220, -160, -100, -40, 30, 90, 150, 210, 270];
  const CORE = { x: -600, z: -120 };
  for (const x of xs) roadStrip(x, (zs[0] + zs[zs.length - 1]) / 2, zs[zs.length - 1] - zs[0] + 10, false);
  for (const z of zs) if (z !== 30) roadStrip((xs[0] + xs[xs.length - 1]) / 2, z, xs[0] - xs[xs.length - 1] + 10, true);
  for (const x of xs) for (const z of zs) flat(x, 0.03, z, 10, 10, '#555a63');
  roadStrip((-185 + -210) / 2, -90, 25, true); roadStrip((-185 + -210) / 2, -30, 25, true);
  const blocks = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x0 = xs[i + 1] + 5, x1 = xs[i] - 5, z0 = zs[j] + 5, z1 = zs[j + 1] - 5;
    const b = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, bw: x1 - x0, bd: z1 - z0, x0, x1, z0, z1 };
    b.core = Math.hypot(b.cx - CORE.x, b.cz - CORE.z);
    blocks.push(b);
    flat(b.cx, 0.025, b.cz, b.bw, b.bd, '#d9d4c7');
    extraLamps.push([x0 + 2, z0 + 2], [x1 - 2, z1 - 2]);
    G.locations.sidewalks.push({ x: x0 + 1, z: z0 + 1 }, { x: x1 - 1, z: z0 + 1 }, { x: x0 + 1, z: z1 - 1 }, { x: x1 - 1, z: z1 - 1 });
    // palm-lined sidewalks on the long sides
    for (let t = z0 + 8; t < z1 - 4; t += 16) { palmAt(x0 + 1.6, t); palmAt(x1 - 1.6, t); }
  }
  const pickNear = (x, z) => blocks.filter(b => !b.used).sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z))[0];
  // Landmarks in the core
  const TWR = pickNear(CORE.x, CORE.z); TWR.used = true; buildBobblyTower(TWR.cx, TWR.cz);
  // Twin Towers on four blocks: the two towers on one diagonal, the plaza and a low-rise on the other
  {
    const A = pickNear(CORE.x + 90, CORE.z + 20);
    const at = (x, z) => blocks.find(b => !b.used && Math.abs(b.cx - x) < 2 && Math.abs(b.cz - z) < 40 && Math.sign(b.cz - A.cz) === Math.sign(z - A.cz));
    let set = null;
    for (const [dx, dz] of [[60, 60], [60, -60], [-60, 60], [-60, -60]]) {
      const B = at(A.cx + dx, A.cz + dz), C = at(A.cx + dx, A.cz), D = at(A.cx, A.cz + dz);
      if (B && C && D) { set = [A, B, C, D]; break; }
    }
    for (const b of set) b.used = true;
    buildTwinTowers(...set);
  }
  const CYLB = pickNear(CORE.x - 70, CORE.z + 60); CYLB.used = true;
  const cg = new THREE.CylinderGeometry(15, 15, 190, 28), uv = cg.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 24, uv.getY(k) * 47);
  S(cg, bmat('#7fb8d0'), CYLB.cx, 95, CYLB.cz);
  S(new THREE.CylinderGeometry(16, 16, 1, 28), mat('#50555e'), CYLB.cx, 190.5, CYLB.cz);
  S(new THREE.ConeGeometry(12, 24, 28), mat('#e8eef5'), CYLB.cx, 203, CYLB.cz);
  addCollider(CYLB.cx - 13, 0, CYLB.cz - 13, CYLB.cx + 13, 191, CYLB.cz + 13);
  const STEP = pickNear(CORE.x, CORE.z - 120); STEP.used = true;
  let y = 0;
  for (const [w, h] of [[42, 70], [32, 60], [22, 55], [12, 30]]) { S(windowBoxGeo(w, h, w), bmat('#e8d8c0'), STEP.cx, y + h / 2, STEP.cz); addCollider(STEP.cx - w / 2, y, STEP.cz - w / 2, STEP.cx + w / 2, y + h, STEP.cz + w / 2); y += h; S(BOX, mat('#b89a70'), STEP.cx, y + 0.3, STEP.cz, 0, 0, 0, w + 1, 0.6, w + 1); }
  S(CYL8, mat('#dddddd'), STEP.cx, y + 20, STEP.cz, 0, 0, 0, 0.4, 40, 0.4);
  // Parks: one big central park + a couple of small plazas
  for (const [px, pz] of [[CORE.x - 150, CORE.z + 150], [CORE.x + 200, CORE.z - 200], [CORE.x - 250, CORE.z - 250]]) {
    const P = pickNear(px, pz); P.used = true;
    flat(P.cx, 0.035, P.cz, P.bw - 4, P.bd - 4, '#7fae4f');
    for (let k = 0; k < 8; k++) palmAt(P.cx + rand(-18, 18), P.cz + rand(-18, 18), 1.1);
    for (let k = 0; k < 6; k++) bushAt(P.cx + rand(-20, 20), P.cz + rand(-20, 20), rand(0.8, 1.4));
    flowerBed(P.cx, P.cz, 24, 24, 30);
    S(CYL, mat('#b9c3cf'), P.cx, 0.4, P.cz, 0, 0, 0, 4, 0.8, 4);
    S(CYL, mat('#5c9ac8'), P.cx, 0.72, P.cz, 0, 0, 0, 3.6, 0.1, 3.6);
    addCollider(P.cx - 3, 0, P.cz - 3, P.cx + 3, 0.8, P.cz + 3);
    if (!LOC.cityPark) LOC.cityPark = { x: P.cx, z: P.cz + 8 };
  }
  // Everything else: skyscrapers in the core, mid-rises further out, low blocks at the edge
  for (const b of blocks) {
    if (b.used) continue;
    const mid = Math.max(0, 1 - b.core / 420);
    const n = mid > 0.3 ? (Math.random() < 0.5 ? 1 : 2) : 4;
    for (let k = 0; k < n; k++) {
      let hw, hd, ox, oz;
      if (n === 1) { hw = b.bw - 14; hd = b.bd - 14; ox = 0; oz = 0; }
      else if (n === 2) { hw = (b.bw - 14) / 2; hd = b.bd - 14; ox = (k ? 1 : -1) * (hw / 2 + 2); oz = 0; }
      else { hw = (b.bw - 14) / 2; hd = (b.bd - 14) / 2; ox = (k % 2 ? 1 : -1) * (hw / 2 + 2); oz = (k < 2 ? -1 : 1) * (hd / 2 + 2); }
      const h = Math.round((12 + Math.random() * 30 + mid * mid * 230 + (mid > 0.5 ? Math.random() * 60 : 0)) / 4) * 4;
      tower(b.cx + ox, b.cz + oz, hw, hd, h, pick(CITY_COLS), '#5f646e', h > 140 && Math.random() < 0.6);
    }
  }
  sign('Downtown Bobbly', -205, 12, 60, '#fff', '#c8a040', 4);
  LOC.city = { x: TWR.cx, z: TWR.cz + 26 };
}

// ---------------------------------------------------------------- the Twin Towers
// Modelled on the real towers: a chamfered square shaft wrapped in 57 narrow protruding steel columns
// per face, grey louvred mechanical-floor bands, pointed "trident" arches at the base, a plain parapet,
// the North Tower's broadcast antenna and the South Tower's rooftop observation deck.
let twinMats = null;
function twinMaterials() {
  if (twinMats) return twinMats;
  // dark glass between the columns, with office lights at night
  const mk = (lit) => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = lit ? '#000' : '#39414b'; x.fillRect(0, 0, 256, 256);
    for (let f = 0; f < 8; f++) for (let k = 0; k < 8; k++) {
      if (lit) { if (Math.random() < 0.45) { x.fillStyle = `rgba(255,${200 + Math.random() * 40 | 0},${130 + Math.random() * 60 | 0},${0.5 + Math.random() * 0.5})`; x.fillRect(k * 32, f * 32 + 4, 32, 26); } }
      else { const v = 50 + Math.random() * 25 | 0; x.fillStyle = `rgb(${v},${v + 6},${v + 14})`; x.fillRect(k * 32, f * 32 + 4, 32, 26); }
    }
    if (!lit) { x.fillStyle = 'rgba(200,210,220,0.18)'; for (let f = 0; f < 8; f++) x.fillRect(0, f * 32, 256, 4); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const glass = pbr({ map: mk(false), emissive: '#ffffff', emissiveMap: mk(true), emissiveIntensity: 0, roughness: 0.18, metalness: 0.55 });
  nightMats.push(glass);
  const lc = document.createElement('canvas'); lc.width = 64; lc.height = 64;
  const lx = lc.getContext('2d'); lx.fillStyle = '#8c9298'; lx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 8) { lx.fillStyle = '#5c6268'; lx.fillRect(0, i + 5, 64, 3); }
  const lt = new THREE.CanvasTexture(lc); lt.wrapS = lt.wrapT = THREE.RepeatWrapping; lt.colorSpace = THREE.SRGBColorSpace;
  twinMats = { glass, louvre: (reps) => { const t = lt.clone(); t.needsUpdate = true; t.repeat.set(1, reps); return new THREE.MeshLambertMaterial({ map: t }); }, steel: modelMat('alloy') };
  return twinMats;
}
function twinTower(tx, tz, W, H, north) {
  noDamage = true;   // the Twin Towers always stay standing
  const TM = twinMaterials();
  const c = 1.6, hw = W / 2;
  const n = 57, pitch = (W - 2 * c - 0.8) / (n - 1), floorH = H / 110, base = 21;
  // chamfered glass shaft
  const sh = new THREE.Shape();
  const e = hw - 0.3;
  sh.moveTo(-e + c, -e); sh.lineTo(e - c, -e); sh.lineTo(e, -e + c); sh.lineTo(e, e - c); sh.lineTo(e - c, e); sh.lineTo(-e + c, e); sh.lineTo(-e, e - c); sh.lineTo(-e, -e + c); sh.lineTo(-e + c, -e);
  const core = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false, UVGenerator: {
    generateTopUV: (g, v, a, b, cc) => [new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0)],
    generateSideWallUV: (g, v, a, b, cc, d) => {
      const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2], bx = v[b * 3], by = v[b * 3 + 1], bz = v[b * 3 + 2];
      const cx = v[cc * 3], cy = v[cc * 3 + 1], cz = v[cc * 3 + 2], dx = v[d * 3], dy = v[d * 3 + 1], dz = v[d * 3 + 2];
      const U = (x, y) => (Math.abs(ay - by) < Math.abs(ax - bx) ? x : y) / (8 * pitch), V = (z) => z / (8 * floorH);
      return [new THREE.Vector2(U(ax, ay), V(az)), new THREE.Vector2(U(bx, by), V(bz)), new THREE.Vector2(U(cx, cy), V(cz)), new THREE.Vector2(U(dx, dy), V(dz))];
    },
  } });
  core.rotateX(-Math.PI / 2);
  S(core, TM.glass, tx, 0, tz);
  addCollider(tx - hw, 0, tz - hw, tx + hw, H + 0.9, tz + hw);
  // the steel columns ("pinstripes") on all four faces
  const faces = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [fx, fz] of faces) {
    for (let i = 0; i < n; i++) {
      const along = -hw + c + 0.4 + i * pitch;
      const px = fx ? tx + fx * (hw - 0.05) : tx + along, pz = fz ? tz + fz * (hw - 0.05) : tz + along;
      const sx = fx ? 0.62 : 0.44, sz = fx ? 0.44 : 0.62;
      S(BOX, TM.steel, px, base + (H - base) / 2, pz, 0, 0, 0, sx, H - base, sz);
      // at the base every third column carries on down as a wide column
      if (i % 3 === 1) S(BOX, TM.steel, fx ? px + fx * 0.1 : px, (base - 6) / 2, fz ? pz + fz * 0.1 : pz, 0, 0, 0, fx ? 0.9 : 1.3, base - 6, fx ? 1.3 : 0.9);
    }
    // pointed "trident" arches between the wide base columns
    for (let i = 1; i + 3 < n; i += 3) {
      const a0 = -hw + c + 0.4 + i * pitch + 0.65, a1 = -hw + c + 0.4 + (i + 3) * pitch - 0.65, mid = (a0 + a1) / 2, w2 = (a1 - a0) / 2;
      const sp = new THREE.Shape();
      sp.moveTo(a0, 0);
      sp.quadraticCurveTo(a0, 3.6, mid, 5.2);
      sp.quadraticCurveTo(a1, 3.6, a1, 0);
      sp.lineTo(a1 + 0.66, 0); sp.lineTo(a1 + 0.66, 6); sp.lineTo(a0 - 0.66, 6); sp.lineTo(a0 - 0.66, 0); sp.lineTo(a0, 0);
      void w2;
      const g = new THREE.ExtrudeGeometry(sp, { depth: 0.7, bevelEnabled: false, curveSegments: 6 });
      g.translate(0, 0, -0.35);
      if (fx) g.rotateY(Math.PI / 2);
      S(g, TM.steel, fx ? tx + fx * (hw - 0.05) : tx, base - 6, fz ? tz + fz * (hw - 0.05) : tz);
    }
  }
  // mechanical floors: grey louvred bands (floors 7-8, 41-42, 75-76 and 108-110)
  for (const [f0, f1] of [[7, 9], [41, 43], [75, 77], [107, 110]]) {
    const y0 = f0 * floorH, h = (f1 - f0) * floorH;
    S(BOX, TM.louvre(Math.round(h / 0.45)), tx, y0 + h / 2, tz, 0, 0, 0, W - 0.25, h, W - 0.25);
  }
  // parapet + roof
  for (const [dx, dz, sx, sz] of [[0, hw, W + 0.5, 0.7], [0, -hw, W + 0.5, 0.7], [hw, 0, 0.7, W + 0.5], [-hw, 0, 0.7, W + 0.5]]) S(BOX, TM.steel, tx + dx, H + 0.8, tz + dz, 0, 0, 0, sx, 1.6, sz);
  S(BOX, mat('#6f757c'), tx, H + 0.45, tz, 0, 0, 0, W - 0.6, 0.9, W - 0.6);
  if (north) {
    // broadcast antenna
    S(BOX, mat('#9aa0a6'), tx, H + 4, tz, 0, 0, 0, 14, 7, 14);
    S(new THREE.CylinderGeometry(0.55, 1.6, 1, 12), mat('#c8ccd0'), tx, H + 7 + 45, tz, 0, 0, 0, 1, 90, 1);
    for (const hy of [20, 42, 62, 78]) S(new THREE.CylinderGeometry(1, 1, 1, 12), mat('#a8adb2'), tx, H + 7 + hy, tz, 0, 0, 0, 2.6 - hy * 0.02, 1.2, 2.6 - hy * 0.02);
    for (const [ox, oz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) S(CYL8, mat('#8a9096'), tx + ox * 1.2, H + 7 + 16, tz + oz * 1.2, 0, 0, 0, 0.18, 32, 0.18);
    S(BALL_G, mat('#ff3030', { emissive: '#ff0000', emissiveIntensity: 1 }), tx, H + 97.5, tz, 0, 0, 0, 0.8, 0.8, 0.8);
    addCollider(tx - 7, H, tz - 7, tx + 7, H + 7.5, tz + 7);
    addCollider(tx - 1.6, H, tz - 1.6, tx + 1.6, H + 97, tz + 1.6);
  } else {
    // rooftop observation deck: walkway with railings, inset from the edge
    const d = W / 2 - 6;
    S(BOX, mat('#b8bcc0'), tx, H + 0.8, tz, 0, 0, 0, 2 * d + 2, 0.2, 2 * d + 2);
    for (const [dx, dz, sx, sz] of [[0, d, 2 * d, 0.12], [0, -d, 2 * d, 0.12], [d, 0, 0.12, 2 * d], [-d, 0, 0.12, 2 * d]]) {
      S(BOX, mat('#dfe3e6'), tx + dx, H + 1.5, tz + dz, 0, 0, 0, sx, 1.2, sz);
      addCollider(tx + dx - sx / 2 - 0.1, H, tz + dz - sz / 2 - 0.1, tx + dx + sx / 2 + 0.1, H + 2.1, tz + dz + sz / 2 + 0.1);
    }
    S(BOX, mat('#7a8088'), tx, H + 3, tz, 0, 0, 0, 12, 4.5, 8);
    addCollider(tx - 6, H, tz - 4, tx + 6, H + 5.2, tz + 4);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; S(CYL8, mat('#5a6068'), tx + Math.cos(a) * (d - 1.5), H + 2, tz + Math.sin(a) * (d - 1.5), 0, 0, 0, 0.12, 1.4, 0.12); }
  }
  noDamage = false;
  return H + 0.9;
}
function buildTwinTowers(A, B, C, D) {
  const W = 48, H = 330;
  const north = A.cz > B.cz ? A : B, south = north === A ? B : A;
  twinTower(north.cx, north.cz, W, H, true);
  const top = twinTower(south.cx, south.cz, W, H, false);
  for (const b of [A, B]) flat(b.cx, 0.036, b.cz, b.bw, b.bd, '#cfc6b3');
  // the plaza: granite paving, a fountain with the big bronze sphere sculpture, benches and trees
  const P = C;
  flat(P.cx, 0.036, P.cz, P.bw, P.bd, '#cfc6b3');
  S(CYL, mat('#8a8680'), P.cx, 0.45, P.cz, 0, 0, 0, 11, 0.9, 11);
  S(CYL, mat('#4f86b0'), P.cx, 0.82, P.cz, 0, 0, 0, 10.3, 0.1, 10.3);
  addCollider(P.cx - 9, 0, P.cz - 9, P.cx + 9, 0.9, P.cz + 9);
  S(CYL, mat('#6a6560'), P.cx, 2.2, P.cz, 0, 0, 0, 1.2, 3, 1.2);
  const bronze = new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.8, roughness: 0.45 });
  S(new THREE.SphereGeometry(4.2, 28, 20), bronze, P.cx, 7.8, P.cz);
  S(new THREE.TorusGeometry(4.25, 0.18, 6, 32), bronze, P.cx, 7.8, P.cz, 0, 0.5, 0);
  addCollider(P.cx - 4, 3.6, P.cz - 4, P.cx + 4, 12, P.cz + 4);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; S(BOX, mat('#6b4a2b'), P.cx + Math.cos(a) * 16, 0.45, P.cz + Math.sin(a) * 16, -a, 0, 0, 0.6, 0.5, 3); addTree(P.cx + Math.cos(a + 0.5) * 20, P.cz + Math.sin(a + 0.5) * 20, 'round'); }
  // low dark office block on the fourth corner
  S(windowBoxGeo(D.bw - 8, 30, D.bd - 8), bmat('#6a6e75'), D.cx, 15, D.cz);
  S(BOX, mat('#4a4e55'), D.cx, 30.3, D.cz, 0, 0, 0, D.bw - 7, 0.6, D.bd - 7);
  addCollider(D.cx - (D.bw - 8) / 2, 0, D.cz - (D.bd - 8) / 2, D.cx + (D.bw - 8) / 2, 30.6, D.cz + (D.bd - 8) / 2);
  sign('TWIN TOWERS', P.cx, 16, P.cz, '#fff', '#3f6f9e', 4);
  LOC.twin = { x: P.cx, z: P.cz + 14 };
  LOC.twinTop = { x: south.cx + 10, z: south.cz + 10, top };
  const sx = south.cx, sz = south.cz, door = { x: sx + (P.cx > sx ? W / 2 + 2 : -W / 2 - 2), z: sz };
  sign('Elevator to the observation deck', door.x, 5, door.z, '#fff', '#46c25a', 1.6);
  G.interacts.push(
    { x: door.x, z: door.z, r: 5, label: () => '🛗 Ride up to the rooftop observation deck', action: () => { const p = G.player; if (p.held && G.dropHeld) G.dropHeld(false); p.place(sx + 10, top + 0.3, sz + 10, 0); G.toast && G.toast(`🏙️ You are ${H} metres up on the South Tower. Jump off and press Space for your parachute 🪂`, '', 7000); } },
    { x: sx + 10, z: sz + 10, r: 5, minY: top - 2, label: () => '🛗 Take the elevator back down', action: () => { G.player.place(door.x, 0, door.z, 0); } },
  );
}

function buildBobblyTower(tx, tz) {
  beginB('#e8eef5');
  // Podium
  S(windowBoxGeo(44, 24, 44), bmat('#e8eef5'), tx, 12, tz);
  addCollider(tx - 22, 0, tz - 22, tx + 22, 24, tz + 22);
  S(BOX, mat('#8fa3b8'), tx, 24.3, tz, 0, 0, 0, 45, 0.6, 45);
  let y = 24.6;
  for (let i = 0; i < 12; i++) {
    const w = 32 - i * 1.5, h = 22;
    S(windowBoxGeo(w, h, w), bmat(i % 3 === 2 ? '#bfe6ff' : '#8fc8ff'), tx, y + h / 2, tz);
    addCollider(tx - w / 2, y, tz - w / 2, tx + w / 2, y + h, tz + w / 2);
    y += h;
    if (i % 3 === 2) S(BOX, mat('#ffffff'), tx, y, tz, 0, 0, 0, w + 1.2, 0.8, w + 1.2);
  }
  // Observation deck
  const w = 32 - 11 * 1.5;
  for (const [dx, dz, sx, sz] of [[0, w / 2, w, 0.15], [0, -w / 2, w, 0.15], [w / 2, 0, 0.15, w], [-w / 2, 0, 0.15, w]]) {
    S(BOX, mat('#dfe8f5'), tx + dx, y + 0.6, tz + dz, 0, 0, 0, sx, 1.2, sz);
    addCollider(tx + dx - sx / 2 - 0.1, y, tz + dz - sz / 2 - 0.1, tx + dx + sx / 2 + 0.1, y + 1.2, tz + dz + sz / 2 + 0.1);
  }
  S(CYL8, mat('#e8eef5'), tx, y + 30, tz, 0, 0, 0, 0.9, 60, 0.9);
  addCollider(tx - 1, y, tz - 1, tx + 1, y + 60, tz + 1);
  S(BALL_G, mat('#ff3030', { emissive: '#ff0000', emissiveIntensity: 1 }), tx, y + 61, tz, 0, 0, 0, 1.2, 1.2, 1.2);
  sign('🏢 BOBBLY TOWER', tx, 30, tz + 24, '#fff', '#3f6fff', 4);
  sign('🛗 Elevator to the top!', tx, 5, tz + 23, '#fff', '#46c25a', 1.8);
  sign('🪂 Jump off & press Space for a parachute!', tx, y + 4, tz + 3, '#fff', '#ff6a1a', 2.2);
  const TB = curB;
  endB();
  LOC.tower = { x: tx + 4, z: tz + 4, top: y };
  const top = y;
  G.interacts.push(
    { b: TB, x: tx, z: tz + 25, r: 5.5, label: () => '🛗 Ride the elevator to the top of Bobbly Tower!', action: () => { const p = G.player; if (p.held && G.dropHeld) G.dropHeld(false); p.place(tx + 4, top + 0.2, tz + 4, 0); G.toast && G.toast('🏙️ WOW! You are 290 metres up! Jump off and press Space to open your parachute 🪂', '', 7000); } },
    { b: TB, x: tx + 4, z: tz + 4, r: 5, minY: top - 2, label: () => '🛗 Take the elevator back down', action: () => { G.player.place(tx, 0, tz + 27, 0); } },
  );
}

// ---------------------------------------------------------------- suburbs (wide streets, curbs, lawns, garages)
// ---------------------------------------------------------------- interiors you can walk into
let IM = null;
function interiorMats() {
  if (IM) return IM;
  const wood = woodTexture(); wood.repeat.set(1, 1);
  IM = {
    plaster: mat('#ece6da'), plasterB: mat('#dde6e8'), plasterG: mat('#e4ead8'), inner: (() => { const t = interiorWallTexture(); const m = new THREE.MeshLambertMaterial({ map: t.map, emissive: '#ffffff', emissiveMap: t.emit, emissiveIntensity: 0.6 }); dayMats.push(m); return m; })(),
    floor: pbr({ map: wood, color: '#b98a5c', roughness: 0.55 }), tile: pbr({ map: TX.paving, color: '#e8e4dc', roughness: 0.35 }),
    sofa: mat('#4a5f80'), cushion: mat('#7a92b8'), darkWood: mat('#5a3e2a'), lightWood: mat('#c49a6c'), white: mat('#f4f2ee'), black: mat('#202226'),
    steel: pbr({ color: '#c8ccd2', metalness: 0.8, roughness: 0.3 }), rug: mat('#8a3f3a'), rug2: mat('#3f6a8a'), bed: mat('#f0ece4'), duvet: mat('#5f8fb8'),
    screen: pbr({ color: '#0a0c10', roughness: 0.1, metalness: 0.5 }), plant: mat('#3f8a3f'), pot: mat('#b0603a'),
    glass: pbr({ color: '#a8c8d8', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.32, depthWrite: false }),
    lamp: new THREE.MeshStandardMaterial({ color: '#fff8e8', emissive: '#fff1d0', emissiveIntensity: 0.9 }),
    gold: pbr({ color: '#d8b45a', metalness: 0.9, roughness: 0.25 }),
    stock: pbr({ map: goodsTexture(), roughness: 0.6 }), shelf: mat('#e8e8e8'), goods: ['#e84a3f', '#3fa7ff', '#ffd23a', '#46c25a', '#b46cff', '#ff8a2a'].map(c => mat(c)),
  };
  return IM;
}
// a box-shaped piece of furniture; (lx, lz) are offsets from (cx, cz), rotated by ry (multiples of 90°)
function fb(cx, cz, ry, lx, y, lz, w, h, d, m) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const swap = Math.abs(sn) > 0.5;
  S(BOX, m, cx + lx * c + lz * sn, y + h / 2, cz - lx * sn + lz * c, 0, 0, 0, swap ? d : w, h, swap ? w : d);
}
function sofa(cx, cz, ry, y) { const M = interiorMats(); fb(cx, cz, ry, 0, y, 0, 2.2, 0.45, 0.9, M.sofa); fb(cx, cz, ry, 0, y, -0.38, 2.2, 0.95, 0.22, M.sofa); for (const sx of [-1, 1]) fb(cx, cz, ry, sx * 1.02, y, 0, 0.2, 0.7, 0.9, M.sofa); for (const sx of [-0.5, 0.5]) fb(cx, cz, ry, sx, y + 0.45, 0.05, 0.95, 0.14, 0.7, M.cushion); }
function table(cx, cz, ry, y, w, d, h, m) { const M = interiorMats(); fb(cx, cz, ry, 0, y + h - 0.06, 0, w, 0.06, d, m || M.lightWood); for (const sx of [-1, 1]) for (const sz of [-1, 1]) fb(cx, cz, ry, sx * (w / 2 - 0.08), y, sz * (d / 2 - 0.08), 0.06, h - 0.06, 0.06, M.darkWood); }
function chair(cx, cz, ry, y) { const M = interiorMats(); fb(cx, cz, ry, 0, y + 0.45, 0, 0.45, 0.06, 0.45, M.darkWood); fb(cx, cz, ry, 0, y + 0.45, -0.2, 0.45, 0.5, 0.05, M.darkWood); for (const sx of [-1, 1]) for (const sz of [-1, 1]) fb(cx, cz, ry, sx * 0.19, y, sz * 0.19, 0.04, 0.45, 0.04, M.darkWood); }
function plant(x, z, y) { const M = interiorMats(); S(CYL8, M.pot, x, y + 0.25, z, 0, 0, 0, 0.22, 0.5, 0.22); S(BALL_G, M.plant, x, y + 0.85, z, 0, 0, 0, 0.42, 0.55, 0.42); }
function ceilingLamp(x, z, y) { const M = interiorMats(); S(CYL8, M.lamp, x, y - 0.05, z, 0, 0, 0, 0.35, 0.08, 0.35); }
// a wall running along x (at z) or along z (at x): siding/facade outside, plaster inside, solid to walk into
let wallFrames = false;          // add 3D window surrounds to house walls
function wallX(xa, xb, z, y0, y1, inward, outer, inner) {
  if (xb - xa < 0.05) return;
  const T = 0.22, h = y1 - y0, cx = (xa + xb) / 2;
  S(windowBoxGeo(xb - xa, h, T), outer, cx, y0 + h / 2, z);
  inLayer(LAYER.INSIDE, () => S(inner === IM.inner ? windowBoxGeo(xb - xa, h, 0.02) : BOX, inner, cx, y0 + h / 2, z + inward * (T / 2 + 0.012), 0, 0, 0, inner === IM.inner ? 1 : xb - xa, inner === IM.inner ? 1 : h, inner === IM.inner ? 1 : 0.02));
  if (wallFrames && inner === IM.inner) houseFrames(xa, xb, z - inward * T / 2, y0, h, 0, -inward);
  addCollider(xa, y0, z - T / 2, xb, y1, z + T / 2);
}
function wallZ(za, zb, x, y0, y1, inward, outer, inner) {
  if (zb - za < 0.05) return;
  const T = 0.22, h = y1 - y0, cz = (za + zb) / 2;
  S(windowBoxGeo(T, h, zb - za), outer, x, y0 + h / 2, cz);
  inLayer(LAYER.INSIDE, () => S(inner === IM.inner ? windowBoxGeo(0.02, h, zb - za) : BOX, inner, x + inward * (T / 2 + 0.012), y0 + h / 2, cz, 0, 0, 0, inner === IM.inner ? 1 : 0.02, inner === IM.inner ? 1 : h, inner === IM.inner ? 1 : zb - za));
  if (wallFrames && inner === IM.inner) houseFrames(za, zb, x - inward * T / 2, y0, h, 1, -inward);
  addCollider(x - T / 2, y0, za, x + T / 2, y1, zb);
}

function tractHouse(x, z, face, color, y) {
  // face: 2 = door toward +z, 3 = door toward -z
  const fz = face === 2 ? 1 : -1;
  const M = interiorMats();
  beginB(color);
  const w = 10, d = 8, h = 6.4, FL = 3.2;
  const outer = hmat(color);
  const xL = x - w / 2, xR = x + w / 2, zF = z + fz * d / 2, zB = z - fz * d / 2, zMin = z - d / 2, zMax = z + d / 2;
  S(tbox(w + 0.3, 2, d + 0.3), stone('#a8a49c'), x, y - 1, z);
  wallFrames = true;
  addCollider(xL, y - 2, zMin, xR, y + 0.08, zMax);
  // outside walls (front door opening at x - 2)
  wallX(xL, xR, zB, y, y + h, fz, outer, M.inner);
  wallZ(zMin, zMax, xL, y, y + h, 1, outer, M.inner);
  wallZ(zMin, zMax, xR, y, y + h, -1, outer, M.inner);
  wallX(xL, x - 2.6, zF, y, y + h, -fz, outer, M.inner);
  wallX(x - 1.4, xR, zF, y, y + h, -fz, outer, M.inner);
  wallX(x - 2.6, x - 1.4, zF, y + 2.3, y + h, -fz, outer, M.plaster);
  wallFrames = false;
  S(BOX, mat('#5a4030'), x - 2.55, y + 1.15, zF - fz * 0.62, 0, 0, 0, 0.06, 2.25, 1.1);     // the front door, swung open
  // door surround, a little porch roof on brackets, and a step
  const tr = stone('#f4f2ee');
  S(tbox(1.6, 0.16, 0.3), tr, x - 2, y + 2.38, zF);
  S(tbox(0.14, 2.3, 0.26), tr, x - 2.68, y + 1.15, zF); S(tbox(0.14, 2.3, 0.26), tr, x - 1.32, y + 1.15, zF);
  S(tbox(2.4, 0.14, 1.3), shingles('#4a4f58'), x - 2, y + 2.85, zF + fz * 0.62, 0, fz * 0.12);
  inLayer(LAYER.DETAIL, () => { for (const sx of [-1, 1]) S(tbox(0.12, 0.5, 0.9), tr, x - 2 + sx * 1.05, y + 2.55, zF + fz * 0.45); });
  S(tbox(2.0, 0.18, 1.0), stone('#c8c4bc'), x - 2, y + 0.09, zF + fz * 0.55);
  curLayer = LAYER.INSIDE;
  // floors: wooden boards downstairs, upstairs floor with a hole for the staircase
  S(BOX, M.floor, x, y + 0.06, z, 0, 0, 0, w - 0.3, 0.04, d - 0.3);
  const sx0 = xR - 1.45, stairZ0 = z + fz * 2.4, stairZ1 = z - fz * 1.8;       // stairs climb toward the back
  const hz0 = Math.min(stairZ0, stairZ1), hz1 = Math.max(stairZ0, stairZ1);
  const slab = (x0, x1, z0, z1) => { if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return; S(BOX, M.plaster, (x0 + x1) / 2, y + FL - 0.1, (z0 + z1) / 2, 0, 0, 0, x1 - x0, 0.2, z1 - z0); S(BOX, M.floor, (x0 + x1) / 2, y + FL + 0.02, (z0 + z1) / 2, 0, 0, 0, x1 - x0, 0.04, z1 - z0); addCollider(x0, y + FL - 0.2, z0, x1, y + FL + 0.04, z1); };
  slab(xL + 0.1, sx0, zMin + 0.1, zMax - 0.1);
  slab(sx0, xR - 0.1, zMin + 0.1, hz0);
  slab(sx0, xR - 0.1, hz1, zMax - 0.1);
  // staircase (walkable ramp + real steps)
  const stairX = xR - 0.75, sl = Math.abs(stairZ1 - stairZ0);
  ramps.push({ x: stairX, z: (stairZ0 + stairZ1) / 2, w: 1.1, l: sl, h: FL, a: fz > 0 ? Math.PI : 0, y0: y + 0.08 });
  for (let k = 0; k < 16; k++) { const t = (k + 0.5) / 16; S(BOX, M.lightWood, stairX, y + 0.08 + FL * t - 0.1, stairZ0 + (stairZ1 - stairZ0) * t, 0, 0, 0, 1.1, 0.2, sl / 16 + 0.02); }
  S(BOX, M.white, sx0 - 0.03, y + FL + 0.5, (hz0 + hz1) / 2, 0, 0, 0, 0.05, 1.0, hz1 - hz0);           // banister
  // ground floor: living room (front left), kitchen and dining (back)
  S(BOX, M.rug, x - 2.2, y + 0.085, z + fz * 0.6, 0, 0, 0, 3, 0.01, 2.2);
  sofa(xL + 0.65, z + fz * 0.6, -Math.PI / 2, y + 0.08);
  table(x - 2.4, z + fz * 0.6, 0, y + 0.08, 1.0, 0.6, 0.42);
  fb(x - 0.4, z + fz * 0.6, 0, 0, y + 0.08, 0, 0.45, 0.5, 1.6, M.darkWood); fb(x - 0.4, z + fz * 0.6, 0, 0, y + 0.6, 0, 0.08, 0.75, 1.3, M.screen);
  fb(x, zB, 0, -1.6, y + 0.08, fz * 0.35, 3.6, 0.9, 0.62, M.white); fb(x, zB, 0, -1.6, y + 0.98, fz * 0.35, 3.6, 0.05, 0.66, M.darkWood);   // kitchen counter
  fb(x, zB, 0, -1.6, y + 1.6, fz * 0.2, 3.6, 0.7, 0.35, M.white);
  fb(xL + 0.45, zB + fz * 0.4, 0, 0, y + 0.08, 0, 0.75, 1.9, 0.7, M.steel);                                  // fridge
  table(x + 0.6, z - fz * 1.0, 0, y + 0.08, 1.4, 0.9, 0.76);
  chair(x + 0.6, z - fz * 1.0 + 0.75, Math.PI, y + 0.08); chair(x + 0.6, z - fz * 1.0 - 0.75, 0, y + 0.08);
  plant(xL + 0.5, zF - fz * 0.5, y + 0.08);
  ceilingLamp(x - 2.2, z, y + FL - 0.2); ceilingLamp(x, zB + fz * 1.2, y + FL - 0.2);
  // upstairs: bedroom
  const Y2 = y + FL + 0.04;
  S(BOX, M.rug2, x - 1.6, Y2 + 0.01, z, 0, 0, 0, 2.4, 0.01, 2.6);
  fb(xL + 1.3, zB + fz * 1.2, 0, 0, Y2, 0, 1.7, 0.45, 2.1, M.darkWood); fb(xL + 1.3, zB + fz * 1.2, 0, 0, Y2 + 0.45, 0, 1.6, 0.18, 2.0, M.bed);
  fb(xL + 1.3, zB + fz * 1.25, 0, 0, Y2 + 0.63, -fz * 0.2, 1.62, 0.1, 1.5, M.duvet); fb(xL + 1.3, zB + fz * 0.35, 0, 0, Y2, 0, 1.7, 1.1, 0.12, M.darkWood);
  for (const sx of [-0.4, 0.4]) fb(xL + 1.3, zB + fz * 0.55, 0, sx, Y2 + 0.63, 0, 0.6, 0.14, 0.35, M.white);
  fb(xL + 0.35, zF - fz * 1.3, 0, 0, Y2, 0, 0.6, 2.0, 1.6, M.lightWood);                                   // wardrobe
  table(x + 1.0, zF - fz * 0.5, 0, Y2, 1.2, 0.6, 0.74); chair(x + 1.0, zF - fz * 1.1, fz > 0 ? 0 : Math.PI, Y2);
  ceilingLamp(x - 1.6, z, y + h - 0.05);
  S(BOX, M.plaster, x, y + h - 0.02, z, 0, 0, 0, w - 0.25, 0.04, d - 0.25);
  curLayer = LAYER.BASE;
  // roof: shingled hip roof with deep eaves, fascia and gutters, and a brick chimney
  const roofC = pick(['#4a4f58', '#5a4a44', '#3f4a5a', '#6a5a50']);
  hipRoof(x, y + h, z, w, d, 2.6, roofC, 0.55);
  chimney(xL + 1.2, y + h - 0.5, z - fz * 1.2, y + h + 3.0);
  // attached garage with a white roll-up door
  const gx = x + 8, gz = z + fz * 0.5;
  S(windowBoxGeo(6, 3.4, 7), outer, gx, y + 1.7, gz);
  hipRoof(gx, y + 3.4, gz, 6, 7, 1.6, roofC, 0.45);
  addCollider(gx - 3, y - 2, gz - 3.5, gx + 3, y + 3.5, gz + 3.5);
  S(BOX, mat('#f0f0ec'), gx, y + 1.35, gz + fz * 3.52, 0, 0, 0, 4.6, 2.7, 0.06);
  for (let k = 1; k < 4; k++) S(BOX, mat('#d8d8d4'), gx, y + k * 0.68, gz + fz * 3.56, 0, 0, 0, 4.6, 0.05, 0.02);
  endB();
  // driveway and front walk to the sidewalk (sidewalk edge is 11.8 from the house centre line)
  flat(gx, y + 0.06, z + fz * (d / 2 + 4.4), 4.8, 8.8, '#cfcfca');
  flat(x - 2, y + 0.06, z + fz * (d / 2 + 4.4), 1.3, 8.8, '#cfcfca');
  // lawn
  flat(x + 1, y + 0.04, z + fz * (d / 2 + 4.4), 22, 8.8, '#7fae4f');
  bushAt(x - 4.2, z + fz * (d / 2 + 0.8), 0.8); bushAt(x + 1.2, z + fz * (d / 2 + 0.8), 0.8);
  G.interiors.push({ x0: xL, x1: xR, z0: zMin, z1: zMax, y0: y - 0.5, y1: y + h });
  const door = { x: x - 2, z: z + fz * (d / 2 + 9.5) };
  G.locations.houses.push({ x, z, door, name: 'House #' + (G.locations.houses.length + 1) });
  return { gx, gz, fz };
}
function streetSection(cx, cz, len, alongX, y) {
  // asphalt 11 wide, curbs, grass park strip, sidewalk — like a real suburban street
  if (!streetMat) streetMat = roadMatOf(false, '#b8b8bc');
  const rot = alongX ? Math.PI / 2 : 0;
  S(flatGeo(11, len, 10), streetMat, cx, y + 0.03, cz, 0, -Math.PI / 2, rot, 11, len, 1);
  for (const sd of [-1, 1]) {
    const o = (off) => alongX ? [cx, cz + sd * off] : [cx + sd * off, cz];
    const [kx, kz] = o(5.65);
    S(BOX, mat('#c8c6c0'), kx, y + 0.1, kz, 0, 0, 0, alongX ? len : 0.3, 0.2, alongX ? 0.3 : len);
    const [gx, gz] = o(6.7);
    flat(gx, y + 0.08, gz, alongX ? len : 1.8, alongX ? 1.8 : len, '#7fae4f');
    const [wx, wz] = o(8.4);
    flat(wx, y + 0.1, wz, alongX ? len : 1.6, alongX ? 1.6 : len, '#cfcfca');
  }
}
function suburbArea(zoneKey, name, dx = 110, dz = 70) {
  const Z = ZONES[zoneKey], y = Z.h || 0;
  const vxs = []; for (let x = Z.x0 + 10; x <= Z.x1 - 10; x += dx) vxs.push(x);
  const hzs = []; for (let z = Z.z0 + 25; z <= Z.z1 - 25; z += dz) hzs.push(z);
  const colors = ['#d8ccb4', '#c8c0b0', '#b8b4a8', '#e0d8c8', '#a8a49c', '#d0c0a0', '#bcb4a4', '#c4c8c8'];
  const xA = vxs[0], xB = vxs[vxs.length - 1], zA = hzs[0] - 25, zB = hzs[hzs.length - 1] + 25;
  for (const z of hzs) streetSection((xA + xB) / 2, z, xB - xA, true, y);
  for (const x of vxs) streetSection(x, (zA + zB) / 2, zB - zA, false, y);
  G.parkedSpots = G.parkedSpots || [];
  let n = 0;
  for (const z of hzs) {
    for (let x = xA + 16; x < xB - 12; x += 19) {
      if (vxs.some(vx => Math.abs(vx - x) < 16) || vxs.some(vx => Math.abs(vx - (x + 8)) < 15)) continue;
      for (const side of [1, -1]) {
        const hz = z + side * 20.3;
        if (hz < Z.z0 + 4 || hz > Z.z1 - 4) continue;
        const face = side > 0 ? 3 : 2;
        tractHouse(x, hz, face, colors[(n++) % colors.length], y);
        // street furniture on the grass strip
        const stripZ = z + side * 6.7;
        if (n % 3 === 0) extraLamps.push([x + 4, stripZ]);
        if (n % 5 === 0) { S(CYL8, mat('#e0c040'), x - 6, y + 0.45, stripZ, 0, 0, 0, 0.22, 0.9, 0.22); S(BALL_G, mat('#e0c040'), x - 6, y + 0.95, stripZ, 0, 0, 0, 0.2, 0.15, 0.2); }
        if (n % 2 === 0) { box(x + 5.2, y, z + side * 6.3, 0.7, 1.1, 0.7, n % 4 ? '#2f5f9f' : '#3f6f3f', false); }
        if (n % 4 === 1) addTree(x - 8, stripZ, 'round', 0.8);
        if (n % 7 === 3) G.parkedSpots.push({ x: x - 3, z: z + side * 4, y, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
    G.locations.sidewalks.push({ x: xA + 2, z: z + 8.4 }, { x: xB - 2, z: z + 8.4 }, { x: xA + 2, z: z - 8.4 }, { x: xB - 2, z: z - 8.4 });
  }
  sign(name, Z.x0 + 20, y + 8, Z.z0 + 12, '#fff', '#6a8a55', 3);
  return { x: vxs[0] + 9, z: hzs[0] + 9 };
}
function buildSuburbs() {
  LOC.suburb = suburbArea('suburb', 'Sunny Suburbs');
  LOC.valley = suburbArea('valley', 'Valley Suburbs');
}

function bobblywoodSign() {
  const word = 'BOBBLYWOOD', cx = -430, cz = 640;
  for (let i = 0; i < word.length; i++) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f2ec'; x.font = "800 170px 'Barlow Condensed', sans-serif"; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(word[i], 64, 88);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const lx = cx + 60 - i * 13.5, lz = cz + Math.sin(i * 0.9) * 3;
    const ly = heightAt(lx, lz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(11, 14), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    m.position.set(lx, ly + 8, lz); m.rotation.y = Math.PI; m.rotation.x = -0.12;
    G.scene.add(m);
    for (const px of [-3, 3]) S(CYL8, mat('#8a8680'), lx + px, ly + 3, lz + 0.6, 0, 0, 0, 0.12, 8, 0.12);
    addCollider(lx - 5.5, ly - 2, lz - 0.6, lx + 5.5, ly + 15, lz + 0.8);
  }
  LOC.sign = { x: cx, z: cz - 22 };
}

function buildLandmarks() {
  // Mountain summit
  const pk = findPeak(150, 520, 1050, 1150);
  LOC.peak = pk;
  S(CYL8, mat('#8b5a2b'), pk.x, pk.h + 3, pk.z, 0, 0, 0, 0.15, 6, 0.15);
  S(BOX, mat('#ff5b6e'), pk.x + 1, pk.h + 5.2, pk.z, 0, 0, 0, 2, 1.2, 0.08);
  sign('⛰️ Bouncy Peaks summit — you made it!', pk.x, pk.h + 8, pk.z, '#fff', '#3f6f9e', 3);
  // Lake cabin
  const lake = LAKES[0];
  const cx = lake.x + lake.r + 14, cz = lake.z;
  const cy = heightAt(cx, cz);
  box(cx, cy - 2, cz, 8, 6.5, 7, '#8b5a2b');
  hipRoof(cx, cy + 4.5, cz, 8, 7, 2.6, '#6b3a2a', 0.6);
  box(cx - 9, -3, cz, 12, 3.4, 3, '#a0683a');
  sign('🏕️ Lake Cabin', cx, cy + 9, cz, '#fff', '#5a8a3a', 2.4);
  LOC.cabin = { x: cx - 6, z: cz + 6 };
  // North lake viewpoint
  LOC.eastLake = { x: LAKES[1].x - LAKES[1].r - 10, z: LAKES[1].z };
  // Highway signs at the town exits
  sign('🏔️ Bouncy Peaks · 🕳️ Mystery Cave ↑', -30, 6, 200, '#fff', '#3f6f9e', 2.4);
  sign('🏖️ Slippy Bay ↓', 30, 6, -200, '#fff', '#2fa8d8', 2.4);
  sign('🏙️ Mega City · 🏎️ Go-Karts ←', -200, 6, 30, '#fff', '#3f8a4a', 2.4);
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
  lampPos.push(...extraLamps);
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 5, 6), mat('#4a4f5a'), lampPos.length);
  bulbMat = new THREE.MeshBasicMaterial({ color: '#eeeeee' });
  bulbIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), bulbMat, lampPos.length);
  lampPos.forEach(([x, z], i) => {
    const gy = heightAt(x, z);
    _m.makeTranslation(x, gy + 2.5, z); pole.setMatrixAt(i, _m);
    _m.makeTranslation(x, gy + 5.1, z); bulbIM.setMatrixAt(i, _m);
    addCollider(x - 0.15, gy, z - 0.15, x + 0.15, gy + 5, z + 0.15);
  });
  pole.castShadow = true;
  G.scene.add(pole, bulbIM);
}

// ---------------------------------------------------------------- textures
function roadTexture() {
  const t = asphaltTexture();
  t.repeat.set(1, (LAND * 2) / 10);
  return t;
}

// ---------------------------------------------------------------- building blocks
let BY = 0; // base height for houses built on raised ground
function house(x, z, face, color, tall = false) {
  const w = 8, d = 7, h = tall ? 7.5 : 4.5;
  beginB(color);
  S(windowBoxGeo(w, h, d), hmat(color), x, BY + h / 2, z);
  S(tbox(w + 0.2, 0.55, d + 0.2), stone('#a8a49c'), x, BY + 0.27, z);                    // stone plinth
  if (BY) S(BOX, mat('#8a8680'), x, BY - 1.5, z, 0, 0, 0, w + 0.4, 3, d + 0.4);
  hipRoof(x, BY + h, z, w, d, 2.6, pick(['#b8503f', '#7a4a3a', '#46628a', '#4f7a4f', '#4a4f58']), 0.55);
  addCollider(x - w / 2, BY - 2, z - d / 2, x + w / 2, BY + h + 0.2, z + d / 2);
  // windows: real frames and sills on all four walls
  houseFrames(x - w / 2, x + w / 2, z + d / 2, BY, h, 0, 1); houseFrames(x - w / 2, x + w / 2, z - d / 2, BY, h, 0, -1);
  houseFrames(z - d / 2, z + d / 2, x + w / 2, BY, h, 1, 1); houseFrames(z - d / 2, z + d / 2, x - w / 2, BY, h, 1, -1);
  // front door in a white surround with a small porch roof and a step
  const fx = face === 0 ? 1 : face === 1 ? -1 : 0, fz = face === 2 ? 1 : face === 3 ? -1 : 0;
  const dx = x + fx * (w / 2 + 0.05), dz = z + fz * (d / 2 + 0.05), ry = fx ? Math.PI / 2 : 0;
  S(tbox(1.3, 2.2, 0.12), mat(pick(['#7a4a2b', '#2f4f6f', '#8a2a2a', '#2f5a3a'])), dx, BY + 1.1, dz, ry);
  const tr = stone('#f4f2ee');
  S(tbox(1.7, 0.16, 0.24), tr, dx, BY + 2.28, dz, ry);
  S(tbox(0.16, 2.3, 0.22), tr, dx + (fz ? 0.75 : 0), BY + 1.15, dz + (fx ? 0.75 : 0), ry); S(tbox(0.16, 2.3, 0.22), tr, dx - (fz ? 0.75 : 0), BY + 1.15, dz - (fx ? 0.75 : 0), ry);
  S(tbox(2.2, 0.12, 1.1), shingles('#4a4f58'), dx + fx * 0.5, BY + 2.7, dz + fz * 0.5, ry, fz ? fz * 0.14 : 0, fx ? -fx * 0.14 : 0);
  S(tbox(1.9, 0.16, 0.9), stone('#c8c4bc'), dx + fx * 0.45, BY + 0.08, dz + fz * 0.45, ry);
  const pathLen = 6;
  flat(x + fx * (w / 2 + pathLen / 2), BY + 0.045, z + fz * (d / 2 + pathLen / 2), fx ? pathLen : 1.6, fz ? pathLen : 1.6, '#cfc6b3');
  chimney(x + 2, BY + h - 0.5, z + 1.5, BY + h + 3.1);
  endB();
  const door = { x: x + fx * (w / 2 + 3.5), z: z + fz * (d / 2 + 3.5) };
  G.locations.houses.push({ x, z, door, name: 'House #' + (G.locations.houses.length + 1) });
  // front garden: flower beds beside the path, bushes at the front corners
  const fd = fx ? w / 2 : d / 2, ph = fx ? d / 2 : w / 2;
  const px = fz ? 1 : 0, pz = fx ? 1 : 0;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) { const a = fd + 0.8 + k * 1.1; flowerAt(x + fx * a + px * side * 1.5, z + fz * a + pz * side * 1.5); }
    bushAt(x + fx * (fd + 0.6) + px * side * (ph + 0.6), z + fz * (fd + 0.6) + pz * side * (ph + 0.6), 0.9);
  }
  // mailbox
  box(door.x + (fz ? 1.6 : 0), BY, door.z + (fx ? 1.6 : 0), 0.3, 1.1, 0.3, '#4a4f5a', false);
  box(door.x + (fz ? 1.6 : 0), BY + 1.1, door.z + (fx ? 1.6 : 0), 0.5, 0.4, 0.7, '#3fa7ff', false);
}

function residentialBlock(cx, cz) {
  const colors = ['#e8dcc8', '#c8d0d8', '#d8c8b8', '#b8c4b0', '#e0d0b0', '#c0b8b0', '#f0ece4', '#d0b8a0', '#a8b0b8'];
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
  flat(cx, 0.03, cz, 48, 48, '#5a8f42');
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

function umbrella(x, z, color, y = 0) {
  S(CYL8, mat('#eeeeee'), x, y + 1.4, z, 0, 0, 0, 0.07, 2.8, 0.07);
  S(new THREE.ConeGeometry(1, 1, 8), mat(color), x, y + 2.9, z, 0, 0, 0, 1.8, 0.7, 1.8);
  S(BOX, mat(pick(['#ffffff', '#ff8fa8', '#8fd0ff', '#ffe08a'])), x + 1.4, y + 0.05, z + 0.4, rand(0, 3), 0, 0, 0.9, 0.05, 1.9);
}

// ---------------------------------------------------------------- the island's special places
// Moving bits (carousel, windmill sails, cable cars, rides) update every frame from updateIsland().
const movers = [];
const zy = (k) => ZONES[k].h;
function tagLayer(o, layer = 0) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }

// Bobbly Park: the green park east of town with a pond, a big slide, a carousel and a playground
function buildTownPark() {
  const L = LAKES[3], y = 0, pave = tmat('#e6dccb', TX.paving, 'p');
  sign('🌳 BOBBLY PARK', 206, 6.5, 24, '#fff', '#46c25a', 3);
  // a path from the town's east road and a ring round the pond
  S(tbox(80, 0.08, 4.5, 3), pave, 232, 0.04, 0);
  const R = L.r + 12, n = 32;
  for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; S(tbox(4.5, 0.08, R * 2 * Math.PI / n + 0.7, 3), pave, L.x + Math.cos(a) * R, 0.04, L.z + Math.sin(a) * R, -a); }
  for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, r = R + rand(9, 24); const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r; if (Math.abs(z) < 8 && x < L.x) continue; if (i % 3) addTree(x, z, 'round', rand(0.9, 1.3)); else bushAt(x, z, rand(0.9, 1.4)); }
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + 0.2; bench(L.x + Math.cos(a) * (R + 3.4), L.z + Math.sin(a) * (R + 3.4), -a - Math.PI / 2); flowerBed(L.x + Math.cos(a + 0.3) * (R + 6), L.z + Math.sin(a + 0.3) * (R + 6), 4, 4, 12); }
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; extraLamps.push([L.x + Math.cos(a) * (R - 3), L.z + Math.sin(a) * (R - 3)]); }
  // the big slide: climb the tower, slide down into the pond
  const tx = 290, tz = -34, th = 6.5;
  box(tx, 0, tz, 4.4, th, 4.4, '#ff7a3a');
  S(tbox(5, 0.3, 5), stone('#ffffff'), tx, th + 0.15, tz);
  S(new THREE.ConeGeometry(3.6, 2.6, 4), mat('#3fa7ff'), tx, th + 3.6, tz, Math.PI / 4);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) S(CYL8, mat('#ffffff'), tx + sx * 2.1, th + 1.3, tz + sz * 2.1, 0, 0, 0, 0.12, 2.3, 0.12);
  for (let k = 0; k < 13; k++) box(tx - 2.42 - (12 - k) * 0.44, 0, tz, 0.44, 0.5 * (k + 1), 2, '#ffd23a', true);
  wedge(tx + 2.2 + 11, tz, 2.4, 22, th, 3, '#ffd23a', 0);
  for (const sz of [-1.3, 1.3]) S(tbox(22.9, 0.5, 0.18), mat('#ff5a7a'), tx + 2.2 + 11, th / 2 + 0.55, tz + sz, 0, 0, -Math.atan2(th, 22));
  G.interacts.push({ x: tx, z: tz, y: th + 0.3, dy: 2, r: 3, label: () => '🛝 Whee! Go down the slide', action: () => { G.slideRide = { t: 0, x0: tx + 1.6, z: tz, y0: th + 0.6, len: 26 }; } });
  // carousel
  const cx = 470, cz = 96;
  box(cx, 0, cz, 13, 0.6, 13, '#d8d0c0', true);
  const car = new THREE.Group(); car.position.set(cx, 0.6, cz); G.scene.add(car);
  const gold = new THREE.MeshStandardMaterial({ color: '#f2c84a', metalness: 0.6, roughness: 0.35 });
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(7.4, 3.2, 16), new THREE.MeshStandardMaterial({ color: '#ff5a7a', roughness: 0.6 }));
  canopy.position.y = 6.2; car.add(canopy);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 0.8, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#ffd23a', roughness: 0.5, side: THREE.DoubleSide })); band.position.y = 4.4; car.add(band);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 6, 12), gold); pole.position.y = 3; car.add(pole);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 0.3, 24), new THREE.MeshStandardMaterial({ color: '#8a5ad8', roughness: 0.6 })); disc.position.y = 0.15; car.add(disc);
  const horseCols = ['#ffffff', '#ffd23a', '#7ab8ff', '#ff8fb8'];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, hx = Math.cos(a) * 5, hz = Math.sin(a) * 5;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 6), gold); p.position.set(hx, 2.3, hz); car.add(p);
    const h = new THREE.Group(); h.position.set(hx, 1.5, hz); h.rotation.y = -a; car.add(h);
    const hm = new THREE.MeshStandardMaterial({ color: horseCols[i % 4], roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 8), hm); body.rotation.x = Math.PI / 2; h.add(body);
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), hm); head.position.set(0, 0.45, 0.62); head.rotation.x = 0.5; h.add(head);
    for (const [lx, lz] of [[-0.18, 0.35], [0.18, 0.35], [-0.18, -0.35], [0.18, -0.35]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 5), hm); l.position.set(lx, -0.45, lz); h.add(l); }
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: '#ff5a7a' })); mane.position.set(0, 0.62, 0.45); mane.rotation.x = 0.5; h.add(mane);
  }
  tagLayer(car);
  addCollider(cx - 0.7, 0.6, cz - 0.7, cx + 0.7, 6.6, cz + 0.7);
  movers.push((dt, t) => { car.rotation.y = t * 0.45; car.children.forEach((c, i) => { if (c.isGroup) c.position.y = 1.5 + Math.sin(t * 2.2 + i) * 0.25; }); });
  sign('🎠 Carousel', cx, 9.6, cz, '#fff', '#ff5a7a', 1.8);
  // playground: swings, a seesaw and a sandpit
  const px = 452, pz = -104;
  flat(px, 0.03, pz, 34, 24, '#f2dc9a');
  for (const sx of [-4.2, 4.2]) for (const sz of [-1.3, 1.3]) S(CYL8, mat('#3fa7ff'), px + sx, 2.1, pz + sz * 0.6 + 6, 0, sz * 0.3, 0, 0.12, 4.4, 0.12);
  S(CYL8, mat('#ff5a7a'), px, 4.2, pz + 6, 0, 0, Math.PI / 2, 0.12, 8.6, 0.12);
  for (const sx of [-2, 0, 2]) { S(CYL8, mat('#c8c8c8'), px + sx - 0.3, 2.9, pz + 6, 0, 0, 0, 0.03, 2.6, 0.03); S(CYL8, mat('#c8c8c8'), px + sx + 0.3, 2.9, pz + 6, 0, 0, 0, 0.03, 2.6, 0.03); S(tbox(0.9, 0.1, 0.4), mat('#ffd23a'), px + sx, 1.55, pz + 6); }
  S(tbox(6, 0.25, 0.5), mat('#46c25a'), px - 6, 0.85, pz - 5, 0, 0, 0.18); S(tbox(0.5, 0.8, 0.5), mat('#ff7a3a'), px - 6, 0.4, pz - 5);
  box(px + 8, 0, pz - 5, 6, 0.4, 6, '#ffcf6a', true);
  sign('🛝 Playground', px, 6.2, pz + 10, '#fff', '#ff7a3a', 1.6);
  LOC.townPark = { x: 236, z: 6 };
}

// The windmill on the hill north-west of town
function buildWindmill() {
  const x = -120, z = 300, y = heightAt(x, z);
  const wall = stone('#f2ece0');
  S(new THREE.CylinderGeometry(3.4, 5.2, 14, 14), wall, x, y + 7, z);
  S(new THREE.CylinderGeometry(5.5, 5.5, 0.6, 14), stone('#c8a878'), x, y + 0.3, z);
  S(new THREE.ConeGeometry(4.6, 5, 14), mat('#d8463a'), x, y + 16.4, z);
  for (const h of [4, 9]) S(new THREE.CylinderGeometry(4.6 - h * 0.12, 4.7 - h * 0.12, 0.35, 14), stone('#c8a878'), x, y + h, z);
  addCollider(x - 4.4, y - 1, z - 4.4, x + 4.4, y + 14, z + 4.4);
  const face = Math.atan2(-x, -z);
  S(tbox(1.5, 2.4, 0.4), mat('#7a4a2b'), x + Math.sin(face) * 4.9, y + 1.2, z + Math.cos(face) * 4.9, face);
  const hub = new THREE.Group(); hub.position.set(x + Math.sin(face) * 4.4, y + 13.4, z + Math.cos(face) * 4.4); hub.rotation.y = face; G.scene.add(hub);
  const rot = new THREE.Group(); hub.add(rot);
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.85 }), cloth = new THREE.MeshStandardMaterial({ color: '#f6f0e2', roughness: 0.9, side: THREE.DoubleSide });
  rot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 10).rotateX(Math.PI / 2), wood));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; rot.add(arm);
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 11, 0.3), wood); spar.position.y = 5.5; arm.add(spar);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 8.5), cloth); sail.position.set(1.3, 6.4, 0.2); arm.add(sail);
    for (let k = 0; k < 6; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), wood); bar.position.set(1.3, 2.6 + k * 1.5, 0.25); arm.add(bar); }
  }
  tagLayer(hub);
  (G.turbines ||= []).push({ rot, sp: 0.55 });
  for (let i = 0; i < 6; i++) { const hx = x + 14 + i * 3.2, hz = z - 10 + (i % 2) * 4; S(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 12), mat('#e8c060'), hx, heightAt(hx, hz) + 0.7, hz, 0, Math.PI / 2, 0); }
  sign('🌬️ Windmill', x, y + 21.5, z, '#fff', '#d8463a', 2);
  LOC.windmill = { x: x + Math.sin(face) * 10, z: z + Math.cos(face) * 10 };
}

// The Mystery Cave: a huge hollow rock at the foot of the north-west hill. Inside: glowing crystals, a pool,
// stalactites and a treasure chest.
function buildCave() {
  const Z = ZONES.cave, x = (Z.x0 + Z.x1) / 2, z = (Z.z0 + Z.z1) / 2 + 6, y = Z.h, R = 24, H = 17;
  const g = new THREE.SphereGeometry(R, 30, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, H / R, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = 1 + (fbmHash(vx * 0.18, vy * 0.18, vz * 0.18) - 0.5) * 0.35;
    p.setXYZ(i, vx * k, vy * k + (vy < 0.5 ? -1.5 : 0), vz * k);
  }
  let ng = g.toNonIndexed(); ng.computeVertexNormals();
  // cut the entrance on the south side (facing town)
  const pos = ng.attributes.position, keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    let cxs = 0, cys = 0, czs = 0; for (let k = 0; k < 3; k++) { cxs += pos.getX(i + k); cys += pos.getY(i + k); czs += pos.getZ(i + k); }
    cxs /= 3; cys /= 3; czs /= 3;
    if (czs < -R * 0.55 && Math.abs(cxs) < 7.5 && cys < 9.5) continue;
    keep.push(i);
  }
  const arr = new Float32Array(keep.length * 9), nrm = new Float32Array(keep.length * 9), uv = new Float32Array(keep.length * 6);
  keep.forEach((i, j) => { for (let k = 0; k < 3; k++) { arr.set([pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)], (j * 3 + k) * 3); nrm.set([ng.attributes.normal.getX(i + k), ng.attributes.normal.getY(i + k), ng.attributes.normal.getZ(i + k)], (j * 3 + k) * 3); uv.set([pos.getX(i + k) / 4, pos.getY(i + k) / 4 + pos.getZ(i + k) / 4], (j * 3 + k) * 2); } });
  const dome = new THREE.BufferGeometry();
  dome.setAttribute('position', new THREE.BufferAttribute(arr, 3)); dome.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); dome.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const rockM = pbr({ color: '#d0c0a8', map: rockTexture(), roughness: 0.95, side: THREE.DoubleSide, flatShading: true });
  rockM.userData.own = true;
  S(dome, rockM, x, y, z);
  // entrance arch and boulders
  for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.13; S(new THREE.DodecahedronGeometry(1, 0), rockM, x + Math.cos(a) * (R + 1) + (i - 4) * 0.4, y + (i === 0 || i === 8 ? 2 : 8.5 + Math.abs(i - 4) * -0.6), z + Math.sin(a) * (R + 1), i, i * 0.7, 0, 3.2, 2.6, 2.6); }
  for (let i = 0; i < 14; i++) { const a = rand(0, Math.PI * 2), r = R + rand(2, 8); if (Math.sin(a) < -0.8) continue; S(new THREE.DodecahedronGeometry(1, 0), rockM, x + Math.cos(a) * r, y + rand(0, 3), z + Math.sin(a) * r, rand(0, 6), rand(0, 6), 0, rand(3, 6), rand(2.5, 5), rand(3, 6)); }
  // walls you can't walk through (with a gap for the entrance), and a roof you can stand on
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, cx = x + Math.cos(a) * (R - 1.2), cz = z + Math.sin(a) * (R - 1.2);
    if (Math.sin(a) < -0.93) continue;
    addCollider(cx - 3.2, y - 1, cz - 3.2, cx + 3.2, y + H * 0.85, cz + 3.2);
  }
  addCollider(x - R * 0.7, y + H - 2.5, z - R * 0.7, x + R * 0.7, y + H + 0.5, z + R * 0.7);
  // inside: glowing crystals, stalactites and stalagmites, an underground pool, torches and treasure
  inLayer(LAYER.DETAIL, () => {
    const cols = ['#5ae8ff', '#c07aff', '#ff6ad8', '#7affc8'];
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), r = rand(8, R - 4), c = pick(cols);
      const m = mat(c, { emissive: c, emissiveIntensity: 1.4 });
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      if (cz < z - R * 0.5 && Math.abs(cx - x) < 6) continue;
      S(new THREE.OctahedronGeometry(1, 0), m, cx, y + rand(0.5, 1.5), cz, rand(0, 6), rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.35, 0.7), rand(1.2, 2.4), rand(0.35, 0.7));
    }
    for (let i = 0; i < 30; i++) { const a = rand(0, Math.PI * 2), r = rand(3, R - 6), h = rand(2, 5); S(new THREE.ConeGeometry(1, 1, 7), rockM, x + Math.cos(a) * r, y + H * Math.sqrt(1 - (r / R) ** 2) - h / 2 - 0.5, z + Math.sin(a) * r, 0, Math.PI, 0, rand(0.5, 1), h, rand(0.5, 1)); }
    for (let i = 0; i < 10; i++) { const a = rand(0, Math.PI * 2), r = rand(9, R - 5), h = rand(1.5, 3.5); S(new THREE.ConeGeometry(1, 1, 7), rockM, x + Math.cos(a) * r, y + h / 2, z + Math.sin(a) * r, 0, 0, 0, rand(0.6, 1.1), h, rand(0.6, 1.1)); }
    S(new THREE.CircleGeometry(6, 24), mat('#2ab8e8', { emissive: '#1a88c8', emissiveIntensity: 0.9 }), x + 7, y + 0.12, z + 8, 0, -Math.PI / 2);
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i < 3 ? -0.5 - i * 0.6 : 0.5 + (i - 3) * 0.6), tx = x + Math.cos(a) * (R - 3), tz = z + Math.sin(a) * (R - 3); S(CYL8, mat('#5a3a22'), tx, y + 2.2, tz, 0, 0, 0, 0.1, 1.4, 0.1); S(new THREE.ConeGeometry(0.28, 0.7, 7), mat('#ffb030', { emissive: '#ff8a10', emissiveIntensity: 2 }), tx, y + 3.2, tz); }
  });
  G.interiors.push({ x0: x - R, x1: x + R, z0: z - R, z1: z + R, y0: y - 2, y1: y + H });
  const chx = x - 6, chz = z + 12;
  box(chx, y, chz, 1.6, 1.0, 1.0, '#8a5a2b', true);
  S(tbox(1.7, 0.5, 1.1), mat('#ffcf3a', { emissive: '#ffaa00', emissiveIntensity: 0.5 }), chx, y + 1.2, chz);
  G.interacts.push({ x: chx, z: chz, r: 2.6, when: () => !G.save.caveTreasure, label: () => '💎 Open the Mystery Cave treasure', action: () => { G.save.caveTreasure = true; addMoney(750, '💎 Mystery Cave treasure!'); sfx.win && sfx.win(); } });
  sign('🕳️ MYSTERY CAVE', x, y + 12, z - R - 4, '#fff', '#7a5ad8', 3);
  LOC.mysteryCave = { x, z: z - R - 10 };
}
function fbmHash(x, y, z) { return (Math.sin(x * 1.7 + y * 2.3) * Math.cos(z * 1.9 - x * 0.7) + Math.sin(y * 3.1 + z * 1.3) * 0.5) * 0.33 + 0.5; }

// The Crazy Go-Kart Track: a twisty circuit with red-and-white kerbs, tyre walls, a start gantry and karts.
const KART = { pts: null, cps: [], lap: null };
function buildKartTrack() {
  const Z = ZONES.kart, cx = (Z.x0 + Z.x1) / 2, cz = (Z.z0 + Z.z1) / 2, y = Z.h + 0.07;
  const ctrl = [[-100, -80], [-10, -95], [80, -88], [118, -40], [100, 30], [50, 52], [10, 25], [-30, 60], [-20, 98], [-90, 95], [-118, 40], [-120, -30]];
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([a, b]) => new THREE.Vector3(cx + a, y, cz + b)), true, 'centripetal');
  const N = 260, W = 12, pts = curve.getSpacedPoints(N);
  KART.pts = pts; KART.y = y;
  const verts = [], uvs = [], idx = [];
  let dist = 0;
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], q = pts[(i + 1) % N];
    const t = new THREE.Vector3().subVectors(q, p).normalize(), nx = -t.z, nz = t.x;
    for (const sd of [-1, 1]) { verts.push(p.x + nx * W / 2 * sd, y, p.z + nz * W / 2 * sd); uvs.push(sd < 0 ? 0 : 1, dist / 10); }
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    dist += p.distanceTo(q);
    // kerbs on both edges, red and white
    if (i < N && i % 2 === 0) for (const sd of [-1, 1]) S(tbox(1.1, 0.18, p.distanceTo(q) * 2 + 0.1), mat((i / 2) % 2 ? '#e8322a' : '#ffffff'), p.x + nx * (W / 2 + 0.55) * sd, y + 0.05, p.z + nz * (W / 2 + 0.55) * sd, Math.atan2(t.x, t.z));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
  S(g, roadMatOf(false, '#9a9aa0'), 0, 0, 0);
  // grass infield and the paddock
  flat(cx, Z.h + 0.03, cz, Z.x1 - Z.x0 - 6, Z.z1 - Z.z0 - 6, '#7fae4f');
  // tyre walls on the outside of the corners
  const tire = new THREE.TorusGeometry(0.45, 0.22, 6, 10);
  const tm = mat('#1e1e22');
  for (let i = 0; i < N; i += 5) {
    const p = pts[i], q = pts[(i + 3) % N], r0 = pts[(i + N - 3) % N];
    const t1 = new THREE.Vector3().subVectors(q, p).normalize(), t0 = new THREE.Vector3().subVectors(p, r0).normalize();
    const turn = t0.x * t1.z - t0.z * t1.x;
    if (Math.abs(turn) < 0.06) continue;
    const sd = turn > 0 ? -1 : 1, nx = -t1.z * sd, nz = t1.x * sd;
    for (let k = 0; k < 3; k++) S(tire, k === 1 ? mat('#e8322a') : tm, p.x + nx * (W / 2 + 3), y + 0.22 + k * 0.42, p.z + nz * (W / 2 + 3), 0, Math.PI / 2);
    addCollider(p.x + nx * (W / 2 + 3) - 0.7, y - 1, p.z + nz * (W / 2 + 3) - 0.7, p.x + nx * (W / 2 + 3) + 0.7, y + 1.3, p.z + nz * (W / 2 + 3) + 0.7);
  }
  // start / finish line and gantry
  const s0 = pts[0], s1 = pts[2], st = new THREE.Vector3().subVectors(s1, s0).normalize(), ang = Math.atan2(st.x, st.z), nx = -st.z, nz = st.x;
  for (let k = 0; k < 12; k++) for (let r = 0; r < 2; r++) S(tbox(1, 0.02, 1), mat((k + r) % 2 ? '#111111' : '#ffffff'), s0.x + nx * (k - 5.5) + st.x * (r - 0.5), y + 0.02, s0.z + nz * (k - 5.5) + st.z * (r - 0.5), ang);
  for (const sd of [-1, 1]) { S(tbox(0.5, 6, 0.5), metal('#d8dadc'), s0.x + nx * 7.5 * sd, y + 3, s0.z + nz * 7.5 * sd, ang); addCollider(s0.x + nx * 7.5 * sd - 0.3, y, s0.z + nz * 7.5 * sd - 0.3, s0.x + nx * 7.5 * sd + 0.3, y + 6, s0.z + nz * 7.5 * sd + 0.3); }
  S(tbox(15.5, 1.4, 0.4), mat('#e8322a'), s0.x, y + 6.3, s0.z, ang);
  sign('🏎️ CRAZY GO-KART TRACK', s0.x, y + 9, s0.z, '#fff', '#e8322a', 3);
  // grandstand
  const gx = s0.x - nx * 18, gz = s0.z - nz * 18;
  for (let k = 0; k < 5; k++) { S(tbox(1.6, 0.6 * (k + 1), 24), mat(['#3fa7ff', '#ffd23a', '#ff5a7a', '#46c25a', '#b97aff'][k]), gx - nx * k * 1.6, y + 0.3 * (k + 1), gz - nz * k * 1.6, ang); }
  S(tbox(9, 0.3, 24), mat('#ffffff'), gx - nx * 3.2, y + 5.5, gz - nz * 3.2, ang);
  for (let k = -1; k <= 1; k++) { const qx = gx - nx * 3.2 + st.x * k * 8, qz = gz - nz * 3.2 + st.z * k * 8; addCollider(qx - 3.2, y, qz - 3.2, qx + 3.2, y + 2.6, qz + 3.2); }
  // checkpoints for the lap timer
  for (let k = 1; k < 6; k++) KART.cps.push(pts[Math.floor(k * N / 6)]);
  KART.start = s0; KART.dir = st;
  LOC.kart = { x: s0.x - nx * 9, z: s0.z - nz * 9 };
  LOC.kartGrid = [0, 1, 2, 3, 4, 5].map(k => { const p = pts[(N - 4 - Math.floor(k / 2) * 4) % N]; return { x: p.x + nx * (k % 2 ? 2.5 : -2.5), z: p.z + nz * (k % 2 ? 2.5 : -2.5), yaw: ang }; });
}
// lap timer: drive a kart (or anything) over the start line after passing every checkpoint
function updateKartLap(dt) {
  if (!KART.pts || !G.player) return;
  const P = G.player.vehicle ? G.player.vehicle.pos : G.player.root;
  const L = KART.lap;
  const d0 = Math.hypot(P.x - KART.start.x, P.z - KART.start.z);
  if (!L) { if (d0 < 7 && G.player.vehicle) KART.lap = { t: 0, next: 0, laps: 0 }; return; }
  L.t += dt;
  if (L.next < KART.cps.length) { const c = KART.cps[L.next]; if (Math.hypot(P.x - c.x, P.z - c.z) < 14) L.next++; }
  else if (d0 < 8) {
    const best = G.save.kartBest || 0;
    if (!best || L.t < best) { G.save.kartBest = L.t; G.toast && G.toast(`🏁 NEW LAP RECORD! ${L.t.toFixed(2)}s`, 'money', 5000); addMoney(100, '🏁 Lap record'); }
    else G.toast && G.toast(`🏁 Lap ${L.t.toFixed(2)}s (best ${best.toFixed(2)}s)`, null, 3500);
    L.t = 0; L.next = 0; L.laps++;
  }
  if (Math.hypot(P.x - KART.start.x, P.z - KART.start.z) > 260) KART.lap = null;
  if (!G.job && G.setJob) {
    if (KART.lap) { G.setJob('🏎️ Go-Kart lap', `Checkpoint ${Math.min(L.next, KART.cps.length)}/${KART.cps.length}. Best: ${G.save.kartBest ? G.save.kartBest.toFixed(2) + 's' : '—'}`, -L.t); KART.showing = true; }
    else if (KART.showing) { KART.showing = false; G.clearJob && G.clearJob(); }
  }
}

// Treasure Island (off the south-east coast) and the little palm islet in Slippy Bay
function buildIslands() {
  const T = ISLANDS[0], ty = heightAt(T.x, T.z);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.3, r = rand(14, T.r * 0.75); palmAt(T.x + Math.cos(a) * r, T.z + Math.sin(a) * r, rand(0.9, 1.25)); }
  for (const a of [Math.PI / 4, -Math.PI / 4]) S(tbox(5, 0.05, 0.9), mat('#e8322a'), T.x, ty + 0.06, T.z, a);
  G.interacts.push({ x: T.x, z: T.z, r: 3.5, when: () => !G.save.islandTreasure, label: () => '⛏️ Dig up the pirate treasure!', action: () => { G.save.islandTreasure = true; addMoney(1500, '🏴‍☠️ Pirate treasure of Treasure Island!'); sfx.win && sfx.win(); } });
  // a skull rock and a wrecked rowing boat on the beach
  const sx = T.x + 24, sz = T.z + 16, sy = heightAt(sx, sz);
  S(new THREE.SphereGeometry(4, 14, 10), stone('#c8c0b0'), sx, sy + 2.6, sz, 0, 0, 0, 1, 0.9, 0.95);
  for (const ex of [-1.4, 1.4]) S(new THREE.SphereGeometry(1, 10, 8), mat('#1a1a1e'), sx + ex, sy + 3.2, sz - 3.3, 0, 0, 0, 0.9, 1.1, 0.5);
  addCollider(sx - 4, sy - 1, sz - 4, sx + 4, sy + 6, sz + 4);
  S(new THREE.CylinderGeometry(0.06, 0.06, 4, 5), mat('#5a3a22'), T.x - 4, ty + 2, T.z + 3);
  S(tbox(1.6, 1.0, 0.02), mat('#111111'), T.x - 3.2, ty + 3.4, T.z + 3);
  sign('🏴‍☠️ TREASURE ISLAND', T.x, ty + 8, T.z - 10, '#fff', '#8a2a1a', 3);
  LOC.treasure = { x: T.x - 8, z: T.z + 6 };
  const I = ISLANDS[1], iy = heightAt(I.x, I.z);
  for (let i = 0; i < 4; i++) palmAt(I.x + rand(-12, 12), I.z + rand(-12, 12), rand(0.9, 1.2));
  S(CYL8, mat('#8a5a36'), I.x - 3, iy + 1, I.z, 0, 0, 0, 0.12, 2, 0.12); S(CYL8, mat('#8a5a36'), I.x + 3, iy + 1, I.z, 0, 0, 0, 0.12, 2, 0.12);
  S(tbox(6, 0.08, 1.2), mat('#ff8a3a'), I.x, iy + 1.3, I.z, 0, 0, 0.05);
}

// Park Lake (next to the theme park): a jetty and rowing boats
function buildParkLake() {
  const L = LAKES[2];
  const jx = L.x - L.r + 6, jz = L.z, jy = Math.max(0.3, heightAt(jx - 8, jz));
  box(jx + 6, jy - 2.4, jz, 16, 2.6, 3, '#b88a5a', true);
  for (let i = 0; i < 3; i++) { const bx = jx + 6 + i * 5, bz = jz + (i % 2 ? 4 : -4); S(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(['#ff5a7a', '#3fa7ff', '#ffd23a'][i]), bx, -0.45, bz, 0, 0, 0, 0.9, 0.5, 2); }
  sign('🦆 Park Lake', jx, jy + 5, jz - 6, '#fff', '#3fa7ff', 2);
  sign('🌈 FUNKY FOREST →', FUNKY.x - FUNKY.r * 0.62, heightAt(FUNKY.x - FUNKY.r * 0.62, FUNKY.z + 140) + 6, FUNKY.z + 140, '#fff', '#b97aff', 3);
}

// Bouncy Peaks cable car: from the meadow by Park Lake up to a lodge high on the snowy mountain
const CABLE = { a: null, b: null, cabins: [], len: 0 };
function buildCableCar() {
  const Z = ZONES.cable, ax = (Z.x0 + Z.x1) / 2, az = (Z.z0 + Z.z1) / 2, ay = Z.h;
  // the top station: the highest reachable ground towards the summit
  const pk = LOC.peak || findPeak(150, 520, 1050, 1150);
  const dx = pk.x - ax, dz = pk.z - az, dl = Math.hypot(dx, dz);
  const bx = ax + dx / dl * (dl - 90), bz = az + dz / dl * (dl - 90), by = heightAt(bx, bz) + 0.3;
  const yaw = Math.atan2(dx, dz);
  const station = (x, y, z, top) => {
    box(x, y - 3, z, 14, 3.4, 12, stone('#c8c0b0'), true);
    for (const [sx, sz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) { S(tbox(0.6, 8, 0.6), metal('#d8463a'), x + sx, y + 4.4, z + sz); addCollider(x + sx - 0.3, y, z + sz - 0.3, x + sx + 0.3, y + 8.4, z + sz + 0.3); }
    S(tbox(15, 0.6, 13), metal('#d8463a'), x, y + 8.6, z);
    S(new THREE.CylinderGeometry(3, 3, 1, 16), metal('#3a3f46'), x, y + 7.4, z);
    sign(top ? '🚡 Bouncy Peaks Lodge' : '🚡 CABLE CAR to BOUNCY PEAKS', x, y + 11.5, z, '#fff', '#d8463a', 2.6);
  };
  station(ax, ay + 0.4, az, false); station(bx, by, bz, true);
  // ski lodge next to the top station
  const lx = bx + Math.cos(yaw) * 16, lz = bz - Math.sin(yaw) * 16, ly = heightAt(lx, lz);
  beginB('#8a5a36');
  S(tbox(12.6, 6, 9.6), stone('#9a948a'), lx, ly - 2.6, lz, yaw);
  S(tbox(12, 5, 9), pbr({ map: woodTexture(), color: '#b07a4a', roughness: 0.85 }), lx, ly + 2.5, lz, yaw);
  hipRoof(lx, ly + 5, lz, 12, 9, 3.4, '#f4f6fa', 0.8);
  addCollider(lx - 6, ly - 1, lz - 6, lx + 6, ly + 5, lz + 6);
  endB();
  for (let i = 0; i < 4; i++) S(tbox(0.12, 1.8, 0.06), mat(['#e8322a', '#3fa7ff', '#ffd23a', '#46c25a'][i]), lx - 3 + i * 0.5, ly + 0.9, lz + 4.8, yaw, 0, 0.15);
  // the cable: two lines (up and down) between the station wheels, held up by pylons
  CABLE.a = new THREE.Vector3(ax, ay + 7.4, az); CABLE.b = new THREE.Vector3(bx, by + 7.4, bz);
  CABLE.len = CABLE.a.distanceTo(CABLE.b);
  const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(2.6);
  CABLE.side = side;
  // the cable rides over the hillside on pylons: at least 13 m above the ground all the way
  const NS = 80, hs = new Float32Array(NS + 1);
  for (let i = 0; i <= NS; i++) { const t = i / NS, x = ax + (bx - ax) * t, z = az + (bz - az) * t; hs[i] = Math.max(CABLE.a.y + (CABLE.b.y - CABLE.a.y) * t, heightAt(x, z) + 13); }
  for (let pass = 0; pass < 6; pass++) for (let i = 1; i < NS; i++) hs[i] = Math.max(hs[i], (hs[i - 1] + hs[i + 1]) / 2 - 0.3);
  hs[0] = CABLE.a.y; hs[NS] = CABLE.b.y;
  CABLE.at = (t, sd, out) => { out.lerpVectors(CABLE.a, CABLE.b, t).addScaledVector(side, sd); const f = Math.min(NS - 1e-6, Math.max(0, t * NS)), i = Math.floor(f); out.y = hs[i] + (hs[i + 1] - hs[i]) * (f - i); return out; };
  const segN = 40;
  for (const sd of [-1, 1]) for (let i = 0; i < segN; i++) {
    const p0 = CABLE.at(i / segN, sd, new THREE.Vector3()), p1 = CABLE.at((i + 1) / segN, sd, new THREE.Vector3());
    const mid = p0.clone().add(p1).multiplyScalar(0.5), len = p0.distanceTo(p1);
    const m = S(CYL8, metal('#2a2d33'), mid.x, mid.y, mid.z, 0, 0, 0, 0.06, len, 0.06);
    m.quaternion.setFromUnitVectors(UPV, p1.clone().sub(p0).normalize()); m.updateMatrix();
  }
  for (let k = 1; k < 8; k++) {
    const t = k / 8, p = CABLE.at(t, 0, new THREE.Vector3()), gy = heightAt(p.x, p.z);
    if (p.y - gy < 4) continue;
    S(tbox(1, p.y - gy + 1, 1), metal('#d8dadc'), p.x, (p.y + gy) / 2, p.z);
    S(tbox(7, 0.5, 0.8), metal('#d8463a'), p.x, p.y + 0.4, p.z, yaw + Math.PI / 2);
    addCollider(p.x - 0.5, gy - 1, p.z - 0.5, p.x + 0.5, p.y, p.z + 0.5);
  }
  // cabins
  const cabinM = new THREE.MeshStandardMaterial({ color: '#d8463a', roughness: 0.45, metalness: 0.2 }), glassM = new THREE.MeshStandardMaterial({ color: '#bfe6ff', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.45 });
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Group(); G.scene.add(c);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4), glassM); body.position.y = -3; c.add(body);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), cabinM); floor.position.y = -4.2; c.add(floor);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 2.6), cabinM); roof.position.y = -1.8; c.add(roof);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), cabinM); arm.position.y = -0.8; c.add(arm);
    tagLayer(c);
    CABLE.cabins.push({ g: c, u: i / 8 });
  }
  movers.push((dt) => {
    for (const cb of CABLE.cabins) {
      cb.u = (cb.u + dt / 90) % 1;
      const up = cb.u < 0.5, t = up ? cb.u * 2 : 2 - cb.u * 2;
      CABLE.at(t, up ? -1 : 1, cb.g.position);
      cb.g.rotation.y = yaw;
    }
    // riding: the cabin carries you up (or down) the mountain
    const R = G.cableRide;
    if (R) {
      R.t += dt / 45;
      const t = R.up ? R.t : 1 - R.t;
      CABLE.at(Math.min(1, Math.max(0, t)), R.up ? -1 : 1, _cv);
      if (!R.cab) { R.cab = CABLE.cabins[0]; }
      R.cab.g.position.copy(_cv);
      G.player.place(_cv.x, _cv.y - 4.0, _cv.z, yaw + (R.up ? 0 : Math.PI));
      if (R.t >= 1) {
        G.cableRide = null;
        if (R.up) { G.player.place(bx - Math.sin(yaw) * 9, by + 0.3, bz - Math.cos(yaw) * 9, yaw); G.toast && G.toast('🏔️ Welcome to Bouncy Peaks! Grab a wingsuit or ride back down.', null, 5000); }
        else G.player.place(ax + Math.sin(yaw) * 9, ay + 0.6, az + Math.cos(yaw) * 9, yaw + Math.PI);
      }
    }
  });
  G.interacts.push({ x: ax, z: az, r: 6, when: () => !G.cableRide && !G.player.vehicle, label: () => '🚡 Ride the cable car up Bouncy Peaks', action: () => { G.cableRide = { t: 0, up: true }; } });
  G.interacts.push({ x: bx, z: bz, r: 6, when: () => !G.cableRide && !G.player.vehicle, label: () => '🚡 Ride the cable car back down', action: () => { G.cableRide = { t: 0, up: false }; } });
  LOC.cableBase = { x: ax - Math.sin(yaw) * 12, z: az - Math.cos(yaw) * 12 };
  LOC.lodge = { x: lx, z: lz + 8 };
}
const _cv = new THREE.Vector3();

// the slide in Bobbly Park
function updateSlide(dt) {
  const S2 = G.slideRide;
  if (!S2) return;
  S2.t += dt / 1.6;
  const t = Math.min(1, S2.t), x = S2.x0 + t * S2.len, y = Math.max(-0.3, S2.y0 - 6.6 * Math.min(1, t * 1.1));
  G.player.place(x, y, S2.z + Math.sin(t * 9) * 0.25, Math.PI / 2);
  if (S2.t >= 1) { G.slideRide = null; G.player.flop(new THREE.Vector3(10, 3, 0), 1.2); }
}
export function updateIsland(dt) {
  for (const f of movers) f(dt, G.time);
  updateSlide(dt);
  updateKartLap(dt);
}
function buildIslandPlaces() {
  buildTownPark();
  buildWindmill();
  buildCave();
  buildKartTrack();
  buildIslands();
  buildParkLake();
  buildCableCar();
}

// ---------------------------------------------------------------- build everything
export async function buildWorld(progress = () => {}) {
  const scene = G.scene;
  makeWindowTextures();
  initTextures();

  // Terrain for the whole island
  await progress(0.05, 'Shaping the island');
  buildHeights();
  if (G.onHeights) G.onHeights();          // the railway shapes the ground it runs on
  await progress(0.25, 'Painting terrain');
  const terr = buildTerrainMesh(scene);
  for (const t of terr.tiles) { const bs = t.geometry.boundingSphere; chunkList.push({ mesh: t, x: bs.center.x, y: bs.center.y, z: bs.center.z, r: bs.radius, layer: 0, ground: true }); }
  TX.grass.repeat.set(1, 1);
  const gd = TX.grass.clone(); gd.needsUpdate = true; gd.repeat.set(WORLD / 5, WORLD / 5);
  terr.material.map = gd; terr.material.needsUpdate = true;
  realisticGround(terr.material);
  G.terrainMat = terr.material;

  // Ocean
  const waterTex = waterTexture(); waterTex.repeat.set(700, 700);
  G.waterTex = waterTex;
  G.sky = makeSky(); scene.add(G.sky);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), makeWaterMaterial());
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);
  G.water = water;

  // Roads
  const roadMat = pbr({ map: roadTexture(), normalMap: asphaltNormal(false), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92 });
  (G.roadMats ||= []).push(roadMat);
  for (const r of ROADS) {
    S(PLANE, roadMat, r, 0.02, 0, 0, -Math.PI / 2, 0, 10, LAND * 2, 1);
    S(PLANE, roadMat, 0, 0.021, r, 0, -Math.PI / 2, Math.PI / 2, 10, LAND * 2, 1);
  }
  for (const a of ROADS) for (const b of ROADS) flat(a, 0.025, b, 10, 10, '#555a63');
  const bridges = buildHighways(scene, roadMat);
  buildBridges(bridges);

  // Sidewalk blocks
  for (const bx of BLOCKS) for (const bz of BLOCKS) {
    flat(bx, 0.022, bz, 50, 50, '#d9d4c7');
    flat(bx, 0.028, bz, 45, 45, '#7fae4f');
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
  sign('Bobbly Town', 0, 7, -3, '#fff', '#c8a040', 3.2);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; flowerBed(Math.cos(a) * 16, Math.sin(a) * 16, 3, 3, 18); bushAt(Math.cos(a + 0.2) * 20, Math.sin(a + 0.2) * 20, 1.1); }
  flowerBed(0, 0, 9, 9, 0);

  // --- Pizza (60,0)
  building(70, 0, 16, 24, 8, '#fff1dc', '#d23c32');
  box(61.5, 3, 0, 1.2, 0.4, 20, '#d23c32', false);
  sign('🍕 PIZZA PLACE', 61, 10.5, 0, '#fff', '#d23c32');

  // --- Taxi depot (-60,0)
  building(-70, 0, 16, 24, 7, '#e0c060', '#333');
  sign('🚕 TAXI DEPOT', -61, 9.5, 0, '#222', '#ffd84a');
  for (let i = -1; i <= 1; i++) flat(-46, 0.04, i * 9, 5, 8, '#f5f5f5');

  // --- Clothing (0,60)
  building(0, 70, 26, 16, 8, '#d8c0b8', '#6b4a44');
  sign('👕 BOBBLY BOUTIQUE', 0, 10.5, 61, '#fff', '#e05a8a');

  // --- Dealership (0,-60)
  building(0, -72, 30, 12, 6, '#b8c8d8', '#3f4f6e');
  sign('🚗 CAR DEALER', 0, 8.5, -65, '#fff', '#3f6f9e');
  flat(0, 0.04, -52, 40, 16, '#b9bec7');

  // --- Fire station (60,60)
  building(70, 68, 22, 22, 9, '#a8453c', '#5a2a22');
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
  wedge(-60, -44, 7, 12, 3, 2, '#9a958c');
  wedge(-60, -70, 7, 12, 3, 0, '#9a958c');
  wedge(-78, -60, 8, 18, 6, 1, '#8a857c');
  box(-44, 0, -74, 10, 3, 8, '#7a7f88');
  wedge(-44, -63, 10, 14, 3, 2, '#7a7f88');
  wedge(-40, -50, 4, 6, 1.5, 3, '#a8a090');
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
  hipRoof(62, 7, 126, 18, 12, 3.4, '#6b4a8b', 0.7);
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

  // --- rows of trees around the edge of town
  for (let z = -170; z <= 170; z += 18) { addTree(-172 + rand(-4, 4), z, 'pine'); if (Math.abs(z) > 14) addTree(174 + rand(-3, 3), z, 'round'); }
  for (let x = -170; x <= 170; x += 20) { addTree(x + rand(-3, 3), 182, 'round'); if (Math.abs(x - 30) > 14) addTree(x + rand(-3, 3), -176, 'round'); }
  // --- Slippy Bay: the fishing pier, fish market and beach umbrellas on the west beach
  {
    const px0 = -77, px1 = -28, pz = -720;
    box((px0 + px1) / 2, -3, pz, px1 - px0, 3.4, 6, '#b88a5a', true);
    for (let x = px0 + 2; x < px1; x += 6) for (const zz of [-2.6, 2.6]) S(CYL8, mat('#7a5a3a'), x, -1.5, pz + zz, 0, 0, 0, 0.25, 3, 0.25);
    const fm = LOC.fishMarket, fy = Math.max(0, heightAt(fm.x, fm.z));
    box(fm.x, fy, fm.z - 5, 7, 3, 3, '#ffffff');
    S(BOX, mat('#3fa7ff'), fm.x, fy + 3.2, fm.z - 4.5, 0, 0, 0, 8, 0.4, 4.5);
    flat(fm.x, fy + 0.05, fm.z, fm.w, fm.d, '#9be0ff');
    sign('🐟 FISH MARKET', fm.x, fy + 5.5, fm.z - 3, '#fff', '#3fa7ff', 2.2);
    sign('🎣 Fishing spot', px1 - 2, 3.5, pz, '#fff', '#3f6f9e', 1.6);
    sign('🏖️ SLIPPY BAY', -100, 7, -640, '#fff', '#2fa8d8', 3.4);
    const umb = ['#ff5b6e', '#ffd54a', '#3fa7ff', '#46c25a', '#b46cff'];
    for (let z = -600; z >= -900; z -= 20) { const x = -82 + rand(-8, 4), y = heightAt(x, z); if (y > -0.3 && y < 3) umbrella(x, z, pick(umb), y); }
    for (let x = -20; x <= 380; x += 24) { const z = -528 + rand(-6, 4), y = heightAt(x, z); if (y > -0.3 && y < 3) umbrella(x, z, pick(umb), y); }
  }
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
  building(-78, -44, 10, 8, 5, '#5a5f6a', '#2a2d33');
  sign('🔫 BLASTER SHOP', -72.5, 7.5, -44, '#fff', '#8b3fd6', 2.2);

  // Lighthouse on the east headland at the mouth of Slippy Bay
  {
    const lx = 690, lz = -1060, ly = Math.max(1, heightAt(lx, lz));
    for (let i = 0; i < 6; i++) S(CYL, mat(i % 2 ? '#ffffff' : '#e84a3f'), lx, ly + i * 4 + 2, lz, 0, 0, 0, 3 - i * 0.15, 4, 3 - i * 0.15);
    S(CYL, mat('#ffe27a', { emissive: '#ffcc33', emissiveIntensity: 0.6 }), lx, ly + 25.5, lz, 0, 0, 0, 2, 3, 2);
    S(new THREE.ConeGeometry(1, 1, 16), mat('#e84a3f'), lx, ly + 28, lz, 0, 0, 0, 2.6, 2.5, 2.6);
    S(CYL, stone('#b8b2a6'), lx, ly - 2, lz, 0, 0, 0, 5, 4, 5);
    addCollider(lx - 2.5, ly - 4, lz - 2.5, lx + 2.5, ly + 24, lz + 2.5);
    LOC.lighthouse = { x: lx, z: lz + 8 };
  }

  // Scatter roadside trees in free edge strips
  for (let i = 0; i < 16; i++) addTree(rand(-168, -156), rand(-150, 150));

  await progress(0.4, 'Building the town');
  buildLandmarks();
  bobblywoodSign();
  await progress(0.5, 'Raising Mega City');
  buildMegaCity();
  buildSuburbs();
  await progress(0.6, 'Building farms, villages and the space center');
  buildWildPlaces();
  await progress(0.62, 'Building Bobbly Park, the cave, the kart track and the cable car');
  buildIslandPlaces();
  await progress(0.65, 'Growing forests');
  buildWilderness();
  buildTrees();
  buildPalms();
  buildLamps();
  buildDecor();
  await progress(0.8, 'Finishing touches');
  finalizeStatic();

  // Clouds
  // Clouds: soft billboards made from a painted cumulus texture
  G.clouds = [];
  const cloudTex = [0, 1, 2].map(cloudTexture);
  cloudMats = cloudTex.map(t => new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.95 }));
  for (let i = 0; i < 70; i++) {
    const cl = new THREE.Group();
    const w = rand(40, 110);
    for (let j = 0; j < 4; j++) {
      const sp = new THREE.Sprite(pick(cloudMats));
      sp.scale.set(w * rand(0.6, 1), w * rand(0.35, 0.5), 1);
      sp.position.set(rand(-w * 0.5, w * 0.5), rand(-4, 6), rand(-w * 0.3, w * 0.3));
      cl.add(sp);
    }
    cl.position.set(rand(-WORLD, WORLD), rand(160, 300), rand(-WORLD, WORLD));
    scene.add(cl);
    G.clouds.push(cl);
  }
}
let cloudMats = [];
// Cumulus: lots of overlapping soft puffs, flatter and greyer underneath.
function cloudTexture(seed) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  let s2 = 99 + seed * 17; const r = () => { s2 = (s2 * 16807) % 2147483647; return (s2 - 1) / 2147483646; };
  for (let i = 0; i < 90; i++) {
    const px = 70 + r() * 372, py = 70 + r() * 110 - Math.max(0, (px - 256) ** 2 / 3000) * 0.3, rad = 25 + r() * 55;
    if (py + rad * 0.5 > 215) continue;
    const g = x.createRadialGradient(px, py, rad * 0.1, px, py, rad);
    const shade = Math.min(1, 0.72 + (215 - py) / 300);
    const v = Math.round(255 * shade);
    g.addColorStop(0, `rgba(${v},${v},${Math.min(255, v + 6)},0.55)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  // flat base
  const fade = x.createLinearGradient(0, 180, 0, 230);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = fade; x.fillRect(0, 180, 512, 76);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- lighting / day-night
let sun, hemi, amb;
const skyDay = new THREE.Color('#b4c8d4'), skyDusk = new THREE.Color('#d99a78'), skyNight = new THREE.Color('#141a2a');
const tmpC = new THREE.Color();
const WHITE = new THREE.Color('#ffffff'), skyTopDay = new THREE.Color('#4f7ca8'), skyTopNight = new THREE.Color('#0a1030');
export function setShadows(on, big = false, small = false) {
  if (!sun) return;
  sun.castShadow = on;
  // Ultra: shadows reach much further so whole buildings cast them. Low: a small, cheap shadow map around you.
  const e = big ? 170 : small ? 38 : 60, s = sun.shadow.camera;
  s.left = -e; s.right = e; s.top = e; s.bottom = -e; s.far = big ? 600 : small ? 200 : 260; s.updateProjectionMatrix();
  const sz = big ? 4096 : small ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== sz) { sun.shadow.mapSize.set(sz, sz); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  sun.userData.dist = big ? 300 : small ? 100 : 120;
}
export function buildLights() {
  hemi = new THREE.HemisphereLight('#ffffff', '#6a8a5a', 0.9);
  amb = new THREE.AmbientLight('#ffffff', 0.12);
  sun = new THREE.DirectionalLight('#fff4dd', 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 260;
  sun.shadow.bias = -0.0008;
  sun.shadow.camera.layers.enable(SHADOW_LAYER);
  G.scene.add(hemi, amb, sun, sun.target);
  G.landFog = new THREE.Fog('#b4c8d4', 160, 1300);
  G.scene.fog = G.landFog;
}
export const getLights = () => ({ sun, hemi, amb });

export function updateWorld(dt, focus) {
  G.dayTime = (G.dayTime + dt / 720) % 1; // 12 minute day
  const a = (G.dayTime - 0.25) * Math.PI * 2;
  const elev = Math.sin(a);
  const day = clamp(elev * 2.5 + 0.35, 0, 1);
  const dusk = clamp(1 - Math.abs(elev) * 4, 0, 1);
  tmpC.copy(skyNight).lerp(skyDay, day).lerp(skyDusk, dusk * 0.5);
  G.scene.background = tmpC.clone();
  if (G.sky) {
    const u = G.sky.material.uniforms;
    u.horizon.value.copy(tmpC).lerp(WHITE, 0.12 * day);
    u.top.value.copy(skyTopNight).lerp(skyTopDay, day).lerp(skyDusk, dusk * 0.3);
    u.sunDir.value.set(Math.cos(a) * 0.8, Math.sin(a), 0.45);
    G.sky.position.copy(G.camera.position);
  }
  updateBalloons(G.time);
  updateCollapses(dt);
  updateChunks(dt);
  updateIsland(dt);
  updateTurbines(dt);
  updateWater();
  G.landFog.color.copy(tmpC);
  sun.intensity = 0.25 + 1.7 * day;
  hemi.intensity = 0.3 + 0.35 * day;
  sun.color.setRGB(1, lerp(0.7, 0.9, day), lerp(0.5, 0.76, day));
  const sd = new THREE.Vector3(Math.cos(a) * 0.8, Math.max(0.35, Math.abs(elev)), 0.45).normalize();
  sun.position.copy(focus).addScaledVector(sd, sun.userData.dist || 120);
  sun.target.position.copy(focus);
  const night = clamp(1 - day * 1.4, 0, 1);
  for (const m of nightMats) m.emissiveIntensity = night * 0.9;
  for (const m of dayMats) m.emissiveIntensity = day * 0.75 * (1 - (G.overcast || 0) * 0.4);
  // indoors: the sun can't reach, so bring up the soft room light (as if from the windows and lamps)
  const cp = G.camera.position;
  let inside = false;
  for (const r of G.interiors) if (cp.x > r.x0 && cp.x < r.x1 && cp.z > r.z0 && cp.z < r.z1 && cp.y > r.y0 && cp.y < r.y1) { inside = true; break; }
  G.indoor = lerp(G.indoor || 0, inside ? 1 : 0, Math.min(1, dt * 4));
  amb.intensity = 0.12 + G.indoor * (0.55 + 0.35 * day);
  hemi.intensity += G.indoor * 0.25;
  setVehicleLighting(day);
  if (bulbMat) bulbMat.color.setRGB(lerp(0.9, 1, night), lerp(0.9, 0.9, night), lerp(0.9, 0.5, night));
  G.night = night;
  for (const c of G.clouds) { c.position.x += dt * 2; if (c.position.x > WORLD + 100) c.position.x = -WORLD - 100; }
  for (const m of cloudMats) m.color.setRGB(lerp(0.18, 1, day) + dusk * 0.2, lerp(0.2, 1, day) + dusk * 0.05, lerp(0.28, 1, day));
  updateSpace();
}

// ---------------------------------------------------------------- space (seen when you fly very high)
const BLACK = new THREE.Color('#000000');
let stars, earth, glow, moon, baseFogFar = null;
function earthTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#1d4f86'; x.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * 1024, cy = 90 + Math.random() * 330, r = 30 + Math.random() * 90;
    x.fillStyle = ['#4f7a3a', '#6b7a4a', '#8a7a5a', '#3f6a34'][i % 4];
    x.beginPath();
    for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2, rr = r * (0.6 + Math.random() * 0.5); x.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr); }
    x.fill();
  }
  x.fillStyle = '#f0f4f8'; x.fillRect(0, 490, 1024, 22);
  for (let i = 0; i < 90; i++) { x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(Math.random() * 1024, Math.random() * 512, 20 + Math.random() * 60, 6 + Math.random() * 12, 0, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildSpace() {
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(a) * 900; pos[i * 3 + 1] = Math.abs(u) * 900 * (u > -0.2 ? 1 : -1); pos[i * 3 + 2] = r * Math.sin(a) * 900;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.frustumCulled = false; stars.renderOrder = -1;
  const ER = 40000;
  earth = new THREE.Mesh(new THREE.SphereGeometry(ER, 96, 64), new THREE.MeshLambertMaterial({ map: earthTexture(), fog: false }));
  earth.position.y = -ER - 2; earth.visible = false;
  glow = new THREE.Mesh(new THREE.SphereGeometry(ER * 1.015, 64, 32), new THREE.MeshBasicMaterial({ color: '#6fb0ff', transparent: true, opacity: 0.25, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.position.copy(earth.position); glow.visible = false;
  moon = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 24), new THREE.MeshLambertMaterial({ color: '#b8b8b4', emissive: '#303030', fog: false }));
  moon.position.set(-38000, 26000, -42000); moon.visible = false;
  G.scene.add(stars, earth, glow, moon);
}
function updateSpace() {
  if (!stars) buildSpace();
  const cam = G.camera, alt = cam.position.y;
  const f = clamp((alt - 700) / 6500, 0, 1);
  G.spaceFade = f;
  stars.position.copy(cam.position);
  stars.material.opacity = clamp((f - 0.25) * 1.6, 0, 1);
  earth.visible = glow.visible = moon.visible = f > 0.05;
  if (G.water) G.water.visible = f < 0.35;
  if (G.sky) { const u = G.sky.material.uniforms; u.top.value.lerp(BLACK, f); u.horizon.value.lerp(BLACK, Math.pow(f, 0.7)); }
  G.scene.background.lerp(BLACK, f);
  const fog = G.landFog;
  if (baseFogFar === null) baseFogFar = fog.far;
  if (f > 0) {
    fog.far = lerp(fog.far, 1e6, f);
    fog.near = lerp(160, 1e5, f);
    if (cam.far < 90000) { cam.far = 90000; cam.updateProjectionMatrix(); }
  } else if (fog.near !== 160) {
    fog.near = 160;
    G.applyGraphics && G.applyGraphics();
  }
}
