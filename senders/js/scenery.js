// Senders — everything that stands on the mountain: trees (instanced, swaying in the wind, with a cheap far
// version), bushes, boulders and pebbles, the start gate, checkpoint banners, the finish arch, course tape,
// jump warning signs, sponsor boards, tents and cheering crowds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, rrange, clamp } from './util.js';
import { bannerTexture } from './textures.js';

export const shared = { time: { value: 0 }, rider: { value: new THREE.Vector3() } };

// ------------------------------------------------------------------ geometry helpers
function hash3(x, y, z, s) { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function jitter(g, amt, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), qx = Math.round(x * 50), qy = Math.round(y * 50), qz = Math.round(z * 50);
    p.setXYZ(i, x + (hash3(qx, qy, qz, seed) - 0.5) * amt, y + (hash3(qx, qy, qz, seed + 7) - 0.5) * amt * 0.6, z + (hash3(qx, qy, qz, seed + 13) - 0.5) * amt);
  }
  return g;
}
function paint(g, hex, faceJitter = 0, seed = 1, fn = null) {
  g = g.index ? g.toNonIndexed() : g;
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3), r = mulberry32(seed);
  const p = g.attributes.position, nm = g.attributes.normal;
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * faceJitter;
    for (let v = i; v < i + 3; v++) {
      let cr = c.r * k, cg = c.g * k, cb = c.b * k;
      if (fn) { const o = fn(p.getX(v), p.getY(v), p.getZ(v), nm.getY(v), [cr, cg, cb]); cr = o[0]; cg = o[1]; cb = o[2]; }
      arr[v * 3] = cr; arr[v * 3 + 1] = cg; arr[v * 3 + 2] = cb;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const merge = (list) => { const g = mergeGeometries(list, false); g.computeBoundingSphere(); return g; };
const cone = (r, h, y, seg) => new THREE.ConeGeometry(r, h, seg, 1).translate(0, y + h / 2, 0);
const cyl = (r0, r1, h, y, seg, hs = 1) => new THREE.CylinderGeometry(r0, r1, h, seg, hs).translate(0, y + h / 2, 0);
const ico = (r, x, y, z, d = 1) => new THREE.IcosahedronGeometry(r, d).translate(x, y, z);
function snowCap(on) {
  return on ? (x, y, z, ny, c) => { const k = Math.max(0, Math.min(1, (ny - 0.42) * 4)) * (hash3(Math.round(x * 3), Math.round(y * 3), Math.round(z * 3), 5) < 0.6 ? 0.85 : 0.25); return [c[0] + (0.92 - c[0]) * k, c[1] + (0.95 - c[1]) * k, c[2] + (1.0 - c[2]) * k]; } : null;
}
const lerp3 = (a, b, t) => a + (b - a) * Math.min(1, t * 0.9);
function linHex(h) { return new THREE.Color(h); }

// Each tree type: hi trunk, hi foliage, lo (single merged mesh)
function treeGeos(type, world) {
  const snowy = world.id === 'peaks';
  const leaf = world.colors.leaf;
  switch (type) {
    case 'pine': {
      const trunk = paint(cyl(0.16, 0.32, 3.4, 0, 7), 0x5a3d26, 0.15, 2);
      const layers = [[2.7, 4.2, 2.2], [2.2, 3.8, 4.1], [1.7, 3.3, 5.9], [1.15, 2.9, 7.6], [0.6, 2.2, 9.2]];
      const fol = merge(layers.map(([r, h, y], i) => paint(jitter(cone(r, h, y, 9), 0.35, i + 3), new THREE.Color(0x2f5a2a).multiplyScalar(0.85 + i * 0.07).getHex(), 0.18, i + 5, snowCap(snowy))));
      const lo = merge([paint(cyl(0.22, 0.3, 2.2, 0, 3), 0x5a3d26), paint(cone(2.6, 8.8, 1.8, 6), 0x2f5a2a, 0.1, 1, snowCap(snowy))]);
      return { trunk, fol, lo, sway: 1 };
    }
    case 'fir': {
      const trunk = paint(cyl(0.14, 0.3, 3.0, 0, 7), 0x4d3424, 0.15, 2);
      const layers = []; for (let i = 0; i < 7; i++) layers.push([1.95 - i * 0.24, 2.9 - i * 0.12, 1.6 + i * 1.55]);
      const fol = merge(layers.map(([r, h, y], i) => paint(jitter(cone(r, h, y, 8), 0.28, i + 21), new THREE.Color(0x24492a).multiplyScalar(0.85 + i * 0.05).getHex(), 0.16, i + 9, snowCap(snowy))));
      const lo = merge([paint(cyl(0.16, 0.26, 2, 0, 3), 0x4d3424), paint(cone(2.0, 11.5, 1.5, 5), 0x24492a, 0.1, 3, snowCap(snowy))]);
      return { trunk, fol, lo, sway: 0.8 };
    }
    case 'oak': case 'maple': {
      const maple = type === 'maple';
      const trunk = merge([paint(cyl(0.24, 0.42, 4.2, 0, 7), 0x5b4130, 0.12, 4), paint(cyl(0.08, 0.16, 2.2, 0, 5).rotateZ(0.8).translate(0.7, 3.6, 0), 0x5b4130), paint(cyl(0.08, 0.15, 2.0, 0, 5).rotateZ(-0.9).rotateY(1.9).translate(-0.4, 3.4, 0.5), 0x5b4130)]);
      const blobs = [[2.3, 0, 5.6, 0], [1.8, 1.4, 5.0, 0.5], [1.7, -1.3, 5.2, -0.4], [1.6, 0.2, 6.7, -0.4]];
      const base = maple ? 0xe8e0d8 : leaf;
      const fol = merge(blobs.map(([r, x, y, z], i) => paint(jitter(ico(r, x, y, z, 1), 0.35, i + 31), new THREE.Color(base).multiplyScalar(0.88 + (i % 3) * 0.08).getHex(), 0.22, i + 40)));
      const lo = merge([paint(cyl(0.25, 0.4, 4, 0, 3), 0x5b4130), paint(jitter(ico(2.9, 0, 5.8, 0, 0), 0.4, 3), base, 0.15, 5)]);
      return { trunk, fol, lo, sway: 1.1 };
    }
    case 'birch': {
      const bark = (x, y, z, ny, c) => (hash3(Math.round(y * 3), 1, 2, 3) < 0.25 ? [0.05, 0.05, 0.05] : c);
      const trunk = paint(cyl(0.12, 0.18, 7.2, 0, 6, 10), 0xe8e4dc, 0.1, 6, bark);
      const blobs = [[1.5, 0, 6.4, 0], [1.1, 0.8, 5.6, 0.3], [1.0, -0.7, 6.0, -0.4], [1.0, 0.1, 7.6, 0.2]];
      const fol = merge(blobs.map(([r, x, y, z], i) => paint(jitter(ico(r, x, y, z, 1), 0.3, i + 51), new THREE.Color(0x8fb04a).multiplyScalar(0.9 + (i % 2) * 0.1).getHex(), 0.2, i + 60)));
      const lo = merge([paint(cyl(0.12, 0.17, 6, 0, 3), 0xe8e4dc), paint(ico(1.9, 0, 6.6, 0, 0), 0x8fb04a, 0.1, 7)]);
      return { trunk, fol, lo, sway: 1.3 };
    }
    case 'dead': {
      const c = 0x6e6358;
      const trunk = merge([paint(cyl(0.1, 0.3, 6.5, 0, 6), c, 0.15, 7), paint(cyl(0.04, 0.09, 2.2, 0, 4).rotateZ(0.9).translate(0.85, 3.6, 0), c), paint(cyl(0.04, 0.08, 1.8, 0, 4).rotateZ(-0.8).rotateY(2).translate(-0.5, 4.4, 0.4), c), paint(cyl(0.03, 0.07, 1.6, 0, 4).rotateZ(0.7).rotateY(4).translate(0.2, 5.2, -0.6), c)]);
      return { trunk, fol: null, lo: paint(cyl(0.12, 0.28, 6, 0, 4), c), sway: 0 };
    }
    case 'cactus': {
      const g = 0x4f7a3a;
      const parts = [cyl(0.3, 0.34, 4.4, 0, 8), new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 4.4, 0),
        cyl(0.17, 0.17, 0.8, 0, 7).rotateZ(Math.PI / 2).translate(0.55, 2.0, 0), cyl(0.17, 0.19, 1.5, 0, 7).translate(0.95, 2.0, 0), new THREE.SphereGeometry(0.17, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.95, 3.5, 0),
        cyl(0.16, 0.16, 0.7, 0, 7).rotateZ(Math.PI / 2).translate(-0.5, 2.8, 0), cyl(0.16, 0.17, 1.1, 0, 7).translate(-0.85, 2.8, 0), new THREE.SphereGeometry(0.16, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.85, 3.9, 0)];
      const fol = merge(parts.map((p, i) => paint(p, g, 0.12, i + 70)));
      return { trunk: null, fol, lo: paint(cyl(0.3, 0.35, 4.6, 0, 5), g), sway: 0 };
    }
    case 'shrub': {
      const fol = merge([paint(jitter(ico(0.9, 0, 0.45, 0, 0), 0.4, 3).scale(1, 0.7, 1), 0x7c8a3a, 0.25, 4), paint(jitter(ico(0.6, 0.7, 0.3, 0.2, 0), 0.3, 5).scale(1, 0.7, 1), 0x8a8a40, 0.25, 6)]);
      return { trunk: null, fol, lo: paint(ico(0.9, 0, 0.4, 0, 0).scale(1, 0.6, 1), 0x7c8a3a), sway: 0.3 };
    }
    case 'bush': default: {
      const fol = merge([paint(jitter(ico(0.75, 0, 0.5, 0, 0), 0.2, 3), leaf, 0.25, 4), paint(jitter(ico(0.55, 0.6, 0.35, 0.2, 0), 0.15, 5), new THREE.Color(leaf).multiplyScalar(1.1).getHex(), 0.25, 6), paint(jitter(ico(0.5, -0.5, 0.3, -0.3, 0), 0.15, 7), new THREE.Color(leaf).multiplyScalar(0.9).getHex(), 0.25, 8)]);
      return { trunk: null, fol, lo: paint(new THREE.OctahedronGeometry(0.85, 0).translate(0, 0.45, 0), leaf), sway: 0.4 };
    }
  }
}

function rockGeo(seed, detail = 1) {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), detail ? 0.55 : 0.35, seed).scale(1, 0.72, 1);
  return paint(g, 0xffffff, 0.22, seed);
}

function windMaterial(sway) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  if (sway > 0) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float sw = sin(uTime * 1.3 + ip.x * 0.21 + ip.y * 0.17) * 0.6 + sin(uTime * 2.9 + ip.x * 0.5) * 0.25;
          float k = max(position.y - 1.5, 0.0) * 0.018 * ${sway.toFixed(2)};
          transformed.x += sw * k; transformed.z += sw * k * 0.6;
          #endif`);
    };
  }
  return m;
}

// ------------------------------------------------------------------ dynamic instanced groups (near detail / far simple)
class Group {
  constructor(items, hiGeos, loGeo, mats, opts) {
    this.n = items.length;
    this.x = new Float32Array(this.n); this.z = new Float32Array(this.n);
    this.mats = new Float32Array(this.n * 16); this.cols = new Float32Array(this.n * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    items.forEach((it, i) => {
      this.x[i] = it.x; this.z[i] = it.z;
      e.set(it.tiltX || 0, it.rot || 0, it.tiltZ || 0); q.setFromEuler(e);
      s.set(it.sx || it.s, it.sy || it.s, it.sz || it.s); p.set(it.x, it.y, it.z);
      m.compose(p, q, s); m.toArray(this.mats, i * 16);
      const c = it.color || [1, 1, 1]; this.cols[i * 3] = c[0]; this.cols[i * 3 + 1] = c[1]; this.cols[i * 3 + 2] = c[2];
    });
    const tier = (shadow) => {
      const meshes = hiGeos.filter(Boolean).map((g, k) => {
        const im = new THREE.InstancedMesh(g, mats[k], this.n);
        im.frustumCulled = false; im.count = 0; im.castShadow = shadow; im.receiveShadow = true;
        return im;
      });
      for (let k = 1; k < meshes.length; k++) meshes[k].instanceMatrix = meshes[0].instanceMatrix;
      if (meshes.length) meshes[meshes.length - 1].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
      return meshes;
    };
    this.near = tier(!!opts.shadow);
    this.mid = opts.shadow ? tier(false) : null;
    this.lo = null;
    if (loGeo) {
      this.lo = new THREE.InstancedMesh(loGeo, opts.loMat, this.n);
      this.lo.frustumCulled = false; this.lo.count = 0;
      this.lo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
    }
  }
  add(root) { for (const h of this.near) root.add(h); if (this.mid) for (const h of this.mid) root.add(h); if (this.lo) root.add(this.lo); }
  update(cx, cz, fx, fz, hiR, farR) {
    const hiR2 = hiR * hiR, farR2 = farR * farR, nearR2 = this.mid ? 52 * 52 : hiR2;
    const T = [this.near, this.mid].map((t) => t && t.length ? { m: t[0].instanceMatrix.array, c: t[t.length - 1].instanceColor.array, n: 0 } : null);
    const L = this.lo ? { m: this.lo.instanceMatrix.array, c: this.lo.instanceColor.array, n: 0 } : null;
    const put = (o, i) => {
      o.m.set(this.mats.subarray(i * 16, i * 16 + 16), o.n * 16);
      o.c[o.n * 3] = this.cols[i * 3]; o.c[o.n * 3 + 1] = this.cols[i * 3 + 1]; o.c[o.n * 3 + 2] = this.cols[i * 3 + 2];
      o.n++;
    };
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - cx, dz = this.z[i] - cz, d2 = dx * dx + dz * dz;
      if (d2 > farR2) continue;
      if (d2 > 1600 && dx * fx + dz * fz < -0.4 * Math.sqrt(d2)) continue;
      if (d2 < nearR2 && T[0]) put(T[0], i);
      else if (d2 < hiR2 && (T[1] || T[0])) put(T[1] || T[0], i);
      else if (L) put(L, i);
    }
    [this.near, this.mid].forEach((t, k) => {
      if (!t || !t.length) return;
      for (const h of t) h.count = T[k].n;
      t[0].instanceMatrix.needsUpdate = true; t[t.length - 1].instanceColor.needsUpdate = true;
    });
    if (this.lo) { this.lo.count = L.n; this.lo.instanceMatrix.needsUpdate = true; this.lo.instanceColor.needsUpdate = true; }
  }
}

const MAPLE = [0xe0601c, 0xc8381c, 0xe8a020, 0xd07a1a, 0xb8401a, 0xf0b830];

export class Vegetation {
  constructor(course, root, quality) {
    this.groups = []; this.disposables = [];
    const world = course.world, r = mulberry32(course.seed ^ 0xbeef);
    this.hiR = quality.treeHi; this.farR = clamp(1.7 / world.sky.fogDensity, 420, 900);
    const byType = {};
    for (const t of course.trees) (byType[t.type] || (byType[t.type] = [])).push(t);
    const loMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.disposables.push(loMat);
    for (const type in byType) {
      const geos = treeGeos(type, world);
      const items = byType[type].map((t) => {
        let c;
        if (type === 'maple') { const h = new THREE.Color(MAPLE[Math.floor(r() * MAPLE.length)]); c = [h.r * t.tint, h.g * t.tint, h.b * t.tint]; }
        else c = [t.tint * rrange(r, 0.92, 1.06), t.tint * rrange(r, 0.95, 1.05), t.tint * rrange(r, 0.9, 1.04)];
        return { x: t.x, y: t.y - 0.15, z: t.z, s: t.s, rot: t.rot, tiltX: (r() - 0.5) * 0.08, tiltZ: (r() - 0.5) * 0.08, color: c };
      });
      const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const folMat = windMaterial(geos.sway);
      this.disposables.push(trunkMat, folMat, geos.lo, geos.trunk, geos.fol);
      const hiGeos = [], mats = [];
      if (geos.trunk) { hiGeos.push(geos.trunk); mats.push(trunkMat); }
      if (geos.fol) { hiGeos.push(geos.fol); mats.push(folMat); }
      const g = new Group(items, hiGeos, geos.lo, mats, { shadow: quality.treeShadows && type !== 'bush' && type !== 'shrub', loMat });
      g.add(root); this.groups.push(g);
    }
    // pebbles: only drawn close up
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.disposables.push(rockMat);
    const tint = new THREE.Color(world.rockTint);
    for (let v = 0; v < 3; v++) {
      const items = course.pebbles.filter((p) => p.v === v).map((p) => { const k = rrange(r, 0.75, 1.15); return { x: p.x, y: p.y, z: p.z, s: p.s, sy: p.s * (p.flat ? Math.min(1.2, p.flat * 2.2) : 1), rot: p.rot, color: [tint.r * k, tint.g * k, tint.b * k] }; });
      if (!items.length) continue;
      const geo = rockGeo(11 + v, 0); this.disposables.push(geo);
      const g = new Group(items, [geo], null, [rockMat], { shadow: false });
      g.isPebble = true; g.add(root); this.groups.push(g);
    }
    // boulders: always drawn
    for (let v = 0; v < 3; v++) {
      const list = course.boulders.filter((b) => b.v === v);
      if (!list.length) continue;
      const geo = rockGeo(21 + v); this.disposables.push(geo);
      const im = new THREE.InstancedMesh(geo, rockMat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
      list.forEach((b, i) => {
        e.set((b.tilt - 0.5) * 0.5, b.rot, (b.tilt - 0.3) * 0.4); q.setFromEuler(e);
        m.compose(new THREE.Vector3(b.x, b.y - b.s * 0.25, b.z), q, new THREE.Vector3(b.s * 1.1, b.s, b.s * 0.95));
        im.setMatrixAt(i, m);
        const k = rrange(r, 0.75, 1.12); im.setColorAt(i, c.setRGB(tint.r * k, tint.g * k, tint.b * k));
      });
      im.castShadow = quality.treeShadows; im.receiveShadow = true;
      im.computeBoundingSphere();
      root.add(im);
    }
    this.last = new THREE.Vector3(1e9, 0, 0); this.lastF = new THREE.Vector3(0, 0, 1);
  }
  update(cam, fwd, force) {
    const fx = fwd.x, fz = fwd.z, fl = Math.hypot(fx, fz) || 1;
    if (!force && (cam.x - this.last.x) ** 2 + (cam.z - this.last.z) ** 2 < 25 && (fx * this.lastF.x + fz * this.lastF.z) / fl > 0.94) return;
    this.last.copy(cam); this.lastF.set(fx / fl, 0, fz / fl);
    for (const g of this.groups) g.update(cam.x, cam.z, fx / fl, fz / fl, g.isPebble ? Math.min(this.hiR, 95) : this.hiR, g.isPebble ? 0 : this.farR);
  }
  dispose() { for (const d of this.disposables) if (d) d.dispose(); }
}

// ------------------------------------------------------------------ props: gates, arches, tape, signs, crowd
function box(w, h, d, x, y, z, color) { return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color); }
function placeOn(g, p, heading, y) { return g.rotateY(heading).translate(p.x, y, p.z); }

export function buildProps(course, root, quality) {
  const r = mulberry32(course.seed ^ 0xface);
  const disposables = [];
  const hw = course.hw;
  const solid = [];   // merged plain-coloured parts
  const bannerMats = {};
  const bannerMat = (key, ...args) => {
    if (!bannerMats[key]) { const t = bannerTexture(...args); bannerMats[key] = new THREE.MeshLambertMaterial({ map: t }); disposables.push(t, bannerMats[key]); }
    return bannerMats[key];
  };
  const banner = (mat, w, h, p, heading, y, back = true) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m1 = new THREE.Mesh(g, mat); m1.position.set(p.x, y, p.z); m1.rotation.y = heading + Math.PI; root.add(m1);
    if (back) { const m2 = new THREE.Mesh(g, mat); m2.position.set(p.x, y, p.z); m2.rotation.y = heading; root.add(m2); }
    m1.castShadow = true;
    disposables.push(g);
  };
  const groundAt = (s, d) => { const p = course.pointAt(s, d); return course.heightAt(p.x, p.z); };

  // start gate
  {
    const s = 2.5, p = course.pointAt(s), h = p.h, y = course.trackY(s);
    for (const d of [-(hw + 0.45), hw + 0.45]) { const q = course.pointAt(s, d); solid.push(placeOn(box(0.22, 4.0, 0.22, 0, 2.0, 0, 0x2b2b30), q, h, groundAt(s, d) - 0.2)); }
    banner(bannerMat('senders', 'SENDERS', '#ff5a14', '#ffffff'), 2 * hw + 1.2, 0.95, p, h, y + 3.35);
    solid.push(placeOn(box(2 * hw + 1.4, 0.16, 0.16, 0, 0, 0, 0x2b2b30), p, h, y + 3.9));
    // start hut
    const hp = course.pointAt(s + 1, hw + 3.8), hy = course.heightAt(hp.x, hp.z);
    solid.push(placeOn(box(2.6, 2.4, 2.6, 0, 1.2, 0, 0x8a6a48), hp, h, hy - 0.1));
    solid.push(placeOn(paint(new THREE.ConeGeometry(2.3, 1.3, 4).rotateY(Math.PI / 4).translate(0, 3.0, 0), 0xd04a1a), hp, h, hy - 0.1));
    banner(bannerMat('start', 'START', '#20242c', '#ff5a14', 512, 160), 2.2, 0.7, course.pointAt(s - 0.35, hw + 3.8), h, hy + 1.6, false);
  }
  // checkpoints
  for (const cs of course.checkpoints) {
    const p = course.pointAt(cs), y = course.trackY(cs);
    for (const d of [-(hw + 0.5), hw + 0.5]) { const q = course.pointAt(cs, d); solid.push(placeOn(box(0.16, 3.6, 0.16, 0, 1.8, 0, 0x2a6fe0), q, p.h, groundAt(cs, d) - 0.2)); }
    banner(bannerMat('cp', 'CHECKPOINT', '#2a6fe0', '#ffffff'), 2 * hw + 1.1, 0.62, p, p.h, y + 3.1);
  }
  // finish arch (inflatable)
  {
    const s = course.L, p = course.pointAt(s), y = course.trackY(s), R = hw + 1.5;
    const arch = new THREE.TorusGeometry(R, 0.5, 10, 32, Math.PI);
    const g = paint(arch, 0xff5a14, 0.05, 3);
    solid.push(placeOn(g, p, p.h, y - 0.4));
    banner(bannerMat('finish', 'FINISH', '#ff5a14', '#ffffff', 1024, 192, { checker: true }), 2 * R * 0.75, 0.95, p, p.h, y + R - 0.85);
    // tents & banners at the finish area
    const tentCols = [0xff5a14, 0x2a6fe0, 0x20242c, 0xf0c020];
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1, ts = s + 4 + k * 5, td = side * (hw + 10 + r() * 3), tp = course.pointAt(ts, td), ty = course.heightAt(tp.x, tp.z);
      for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) solid.push(placeOn(box(0.08, 2.2, 0.08, ox, 1.1, oz, 0xdddddd), tp, tp.h, ty));
      solid.push(placeOn(paint(new THREE.ConeGeometry(2.1, 1.0, 4).rotateY(Math.PI / 4).translate(0, 2.7, 0), tentCols[k]), tp, tp.h, ty));
    }
  }
  // sponsor boards along the finish straight and boss run-in
  const sponsors = [['SEND IT', '#111418', '#ff5a14'], ['GRAVITY CO.', '#f4f4f4', '#20242c'], ['DIRT DOGS', '#2a6fe0', '#ffffff'], ['FLOW STATE', '#ff5a14', '#ffffff'], ['BIG AIR', '#f0c020', '#111111'], ['RIDGE RACING', '#20242c', '#f0c020']];
  const boards = (sA, sB, every) => {
    for (let s = sA; s < sB; s += every) for (const side of [-1, 1]) {
      const d = side * (hw + 1.4), p = course.pointAt(s, d), y = course.heightAt(p.x, p.z);
      const sp = sponsors[Math.floor(r() * sponsors.length)];
      const mat = bannerMat('sp' + sp[0], sp[0], sp[1], sp[2], 768, 192);
      const g = new THREE.PlaneGeometry(2.8, 0.7); disposables.push(g);
      const m = new THREE.Mesh(g, mat); m.position.set(p.x, y + 0.55, p.z); m.rotation.y = p.h - side * Math.PI / 2; root.add(m);
      const m2 = new THREE.Mesh(g, mat); m2.position.copy(m.position); m2.rotation.y = m.rotation.y + Math.PI; root.add(m2);
    }
  };
  boards(course.L - 44, course.L - 4, 4);
  for (const f of course.features) if (f.type === 'boss') boards(f.sLip - 70, f.sLip - 14, 5);

  // course tape on the outside of corners and beside jumps
  {
    const marks = new Uint8Array(course.N);
    for (let i = 0; i < course.N; i++) { const k = course.K[i]; if (Math.abs(k) > 1 / 75) marks[i] = k > 0 ? 1 : 2; }
    for (const f of course.features) if (f.type !== 'rocks' && f.type !== 'rollers') for (let i = Math.max(0, Math.floor(f.sLip - 14)); i < Math.min(course.N, f.sLip + (f.gap || 3) + 10); i++) marks[i] = 3;
    for (let i = Math.max(0, course.L - 50); i < Math.min(course.N, course.L + 20); i++) marks[i] = 3;
    const post = paint(new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(0, 0.5, 0), 0xf2f2f2);
    const tapeCol = 0xff6a1a;
    const prev = { 1: null, 2: null };
    const step = 4;
    for (let s = 0; s < course.N; s += step) {
      const m = marks[s];
      for (const side of [1, -1]) {
        // marks 1: turning left (positive curvature) -> outside is the right (negative d)
        const want = m === 3 || (m === 1 && side === -1) || (m === 2 && side === 1);
        const key = side;
        if (!want) { prev[key] = null; continue; }
        if (course.NOTRACK[s]) { prev[key] = null; continue; }
        const d = side * (hw + 1.7), p = course.pointAt(s, d), y = course.heightAt(p.x, p.z) - 0.1;
        solid.push(post.clone().translate(p.x, y, p.z));
        if (prev[key]) {
          const a = prev[key], dx = p.x - a.x, dz = p.z - a.z, len = Math.hypot(dx, dz), dy = y - a.y;
          const t = new THREE.BoxGeometry(0.015, 0.07, Math.hypot(len, dy));
          t.rotateX(-Math.atan2(dy, len)); t.rotateY(Math.atan2(dx, dz));
          t.translate((p.x + a.x) / 2, (y + a.y) / 2 + 0.85, (p.z + a.z) / 2);
          solid.push(paint(t, tapeCol));
        }
        prev[key] = { x: p.x, y, z: p.z };
      }
    }
    post.dispose();
  }
  // jump warning signs
  {
    const signMat = bannerMat('jump', '▲ JUMP ▲', '#ffcc00', '#111111', 512, 192);
    for (const f of course.features) {
      if (f.type === 'rocks' || f.type === 'rollers') continue;
      const s = (f.sKick || f.sLip) - 30, d = hw + 1.0, p = course.pointAt(s, d), y = course.heightAt(p.x, p.z);
      solid.push(placeOn(box(0.08, 1.6, 0.08, 0, 0.8, 0, 0x333333), p, p.h, y - 0.1));
      const g = new THREE.PlaneGeometry(1.1, 0.42); disposables.push(g);
      const m = new THREE.Mesh(g, signMat); m.position.set(p.x, y + 1.45, p.z); m.rotation.y = p.h + Math.PI; root.add(m);
      if (f.type === 'boss') {
        const bm = bannerMat('boss', course.world.boss.toUpperCase(), '#c81e1e', '#ffffff', 1024, 192);
        banner(bm, 2 * hw + 2, 1.0, course.pointAt(f.sLip - 40), course.headingAt(f.sLip - 40), course.trackY(f.sLip - 40) + 4.2);
        for (const dd of [-(hw + 0.8), hw + 0.8]) { const q = course.pointAt(f.sLip - 40, dd); solid.push(placeOn(box(0.2, 5, 0.2, 0, 2.5, 0, 0x20242c), q, q.h, course.heightAt(q.x, q.z) - 0.2)); }
        // scaffolding under the huge kicker and landing
        for (const [a, b] of [[f.sKick - 2, f.sLip], [f.sLand - 1, f.sLand + 6]]) {
          for (let s2 = a; s2 <= b; s2 += 1.5) for (const dd of [-(hw - 0.2), hw - 0.2]) {
            const q = course.pointAt(s2, dd), top = course.trackY(s2), bot = course.heightAt(q.x, q.z) - 25;
            const hgt = Math.max(0.5, top - bot);
            solid.push(placeOn(box(0.16, hgt, 0.16, 0, bot + hgt / 2, 0, 0x7a5532), q, q.h, 0));
          }
        }
      }
    }
  }

  const merged = merge(solid);
  for (const g of solid) g.dispose();
  const mm = new THREE.MeshLambertMaterial({ vertexColors: true });
  const propMesh = new THREE.Mesh(merged, mm);
  propMesh.castShadow = true; propMesh.receiveShadow = true;
  root.add(propMesh);
  disposables.push(merged, mm);

  // crowd
  const crowd = buildCrowd(course.crowd, r);
  if (crowd) { for (const m of crowd.meshes) root.add(m); disposables.push(...crowd.disposables); }
  return { dispose() { for (const d of disposables) d.dispose(); } };
}

function buildCrowd(list, r) {
  if (!list.length) return null;
  const legs = merge([box(0.15, 0.82, 0.17, -0.1, 0.41, 0, 0xffffff), box(0.15, 0.82, 0.17, 0.1, 0.41, 0, 0xffffff), paint(new THREE.SphereGeometry(0.14, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.6, 0), 0xffffff)]);
  const armL = new THREE.BoxGeometry(0.11, 0.62, 0.11).translate(0, 0.31, 0).rotateZ(0.45).translate(-0.25, 1.38, 0);
  const armR = new THREE.BoxGeometry(0.11, 0.62, 0.11).translate(0, 0.31, 0).rotateZ(-0.45).translate(0.25, 1.38, 0);
  const shirt = merge([box(0.44, 0.6, 0.25, 0, 1.12, 0, 0xffffff), paint(armL, 0xffffff), paint(armR, 0xffffff)]);
  const skin = merge([paint(new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.58, 0), 0xffffff), box(0.1, 0.1, 0.1, -0.54, 1.96, 0, 0xffffff), box(0.1, 0.1, 0.1, 0.54, 1.96, 0, 0xffffff)]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time; sh.uniforms.uRider = shared.rider;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uRider;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
        float ex = smoothstep(75.0, 10.0, distance(ip.xz, uRider.xz));
        float sp = 4.0 + ex * 5.0 + fract(ph * 3.1) * 2.0;
        if (position.y > 1.36 && abs(position.x) > 0.235) {
          float a = sin(uTime * sp * 0.5 + ph) * (0.15 + 0.4 * ex) * sign(position.x);
          vec2 piv = vec2(sign(position.x) * 0.25, 1.38);
          vec2 q = transformed.xy - piv;
          transformed.xy = piv + vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
        }
        transformed.y += abs(sin(uTime * sp + ph)) * (0.03 + 0.24 * ex);
        #endif`);
  };
  const n = list.length;
  const meshes = [legs, shirt, skin].map((g) => { const im = new THREE.InstancedMesh(g, mat, n); im.castShadow = true; im.receiveShadow = true; return im; });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const shirts = [0xff5a14, 0x2a6fe0, 0xffffff, 0x20242c, 0xf0c020, 0xd03030, 0x30a050, 0x8040c0, 0x40c0d0, 0xe070a0];
  const pants = [0x2a3040, 0x404850, 0x6a5a40, 0x203060, 0x111111, 0x5a6a50];
  const skins = [0xf1c8a8, 0xd9a882, 0xb07a54, 0x7a4e30, 0xe8b894];
  list.forEach((p, i) => {
    const sc = rrange(r, 0.9, 1.08);
    q.setFromAxisAngle(up, p.rot);
    m.compose(new THREE.Vector3(p.x, p.y - 0.02, p.z), q, new THREE.Vector3(sc, sc, sc));
    for (const im of meshes) im.setMatrixAt(i, m);
    meshes[0].setColorAt(i, c.set(pants[Math.floor(r() * pants.length)]));
    meshes[1].setColorAt(i, c.set(shirts[Math.floor(r() * shirts.length)]));
    meshes[2].setColorAt(i, c.set(skins[Math.floor(r() * skins.length)]));
  });
  for (const im of meshes) im.computeBoundingSphere();
  return { meshes, disposables: [legs, shirt, skin, mat] };
}

export function linColor(h) { return linHex(h); }
