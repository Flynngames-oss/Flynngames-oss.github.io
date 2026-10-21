// The island: real Lanzarote elevation data (SRTM, via AWS Terrain Tiles), a painted
// colour map, white villages, palms, kites and birds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnderwater } from './water.js?v=10';

export const GEO = { LAT0: 29.06, LON0: -13.64, N: 1536, S: 56000, XMIN: -29000, ZMIN: -29500 };
const MLAT = 111320, MLON = 111320 * Math.cos(GEO.LAT0 * Math.PI / 180);
export function ll2w(lat, lon) { return { x: (lon - GEO.LON0) * MLON, z: -(lat - GEO.LAT0) * MLAT }; }
export function w2ll(x, z) { return { lat: GEO.LAT0 - z / MLAT, lon: GEO.LON0 + x / MLON }; }

// real places (approximate centres) – used for the white houses
export const TOWNS = [
  { name: 'Caleta de Famara', lat: 29.1165, lon: -13.5655, r: 380, n: 190 },
  { name: 'Urbanización Famara', lat: 29.1285, lon: -13.5395, r: 260, n: 70 },
  { name: 'La Santa', lat: 29.1085, lon: -13.6545, r: 360, n: 150 },
  { name: 'Club La Santa', lat: 29.1135, lon: -13.6455, r: 160, n: 26, big: true },
  { name: 'Tinajo', lat: 29.0635, lon: -13.6775, r: 600, n: 120 },
  { name: 'Soo', lat: 29.083, lon: -13.62, r: 300, n: 40 },
  { name: 'Teguise', lat: 29.0605, lon: -13.5605, r: 500, n: 140 },
  { name: 'Haría', lat: 29.145, lon: -13.499, r: 600, n: 90 },
  { name: 'Mancha Blanca', lat: 29.045, lon: -13.68, r: 350, n: 40 },
  { name: 'Tiagua', lat: 29.04, lon: -13.635, r: 300, n: 30 },
];

export class Island {
  static async load(url, onProgress) {
    const blob = await (await fetch(url)).blob();
    onProgress && onProgress(0.5);
    let bmp;
    try { bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
    catch (e) { bmp = await createImageBitmap(blob); }
    const N = GEO.N;
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, N, N).data;
    const H = new Float32Array(N * N), M = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) { H[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 10 - 500; M[i] = px[i * 4 + 2]; }
    return new Island(H, M);
  }
  constructor(H, M) { this.H = H; this.M = M; this.N = GEO.N; this.cell = GEO.S / GEO.N; }
  // bilinear height at absolute world position
  h(x, z) {
    const N = this.N;
    let fx = (x - GEO.XMIN) / this.cell - 0.5, fz = (z - GEO.ZMIN) / this.cell - 0.5;
    fx = Math.max(0, Math.min(N - 1.001, fx)); fz = Math.max(0, Math.min(N - 1.001, fz));
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const H = this.H, k = j * N + i;
    return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + N] * (1 - tx) + H[k + N + 1] * tx) * tz;
  }
  mask(x, z) {
    const N = this.N;
    const i = Math.round((x - GEO.XMIN) / this.cell - 0.5), j = Math.round((z - GEO.ZMIN) / this.cell - 0.5);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return this.M[j * N + i] / 255;
  }
  // march from out at sea toward the land to find the shoreline
  findCoast(x, z, sx, sz) {
    let px = x + sx * 1500, pz = z + sz * 1500;
    for (let i = 0; i < 3000; i++) {
      if (this.h(px, pz) > 0.5) return { x: px - sx * 2, z: pz - sz * 2 };
      px -= sx * 1; pz -= sz * 1;
    }
    return { x, z };
  }

  depthTexture() {
    const N = this.N, n = N / 2;
    const data = new Uint16Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * 2 * N + i * 2;
      const v = (this.H[k] + this.H[k + 1] + this.H[k + N] + this.H[k + N + 1]) / 4;
      data[j * n + i] = THREE.DataUtils.toHalfFloat(v);
    }
    const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
}

// ---------------------------------------------------------------------------
export function buildTerrain(island, origin, albedo, quality, rocky = 0.6) {
  const NG = quality === 'low' ? 240 : quality === 'high' ? 420 : 340;
  const half = NG / 2;
  const A = 11 * half, ext = 34000, B = ext - A;
  const warp = (t) => { const a = Math.abs(t), a2 = a * a; return Math.sign(t) * (A * a + B * a2 * a2); };
  const pos = new Float32Array((NG + 1) * (NG + 1) * 3);
  const nor = new Float32Array((NG + 1) * (NG + 1) * 3);
  const uv = new Float32Array((NG + 1) * (NG + 1) * 2);
  let k = 0, q = 0;
  for (let j = 0; j <= NG; j++) {
    const tz = j / NG * 2 - 1, oz = warp(tz);
    for (let i = 0; i <= NG; i++) {
      const tx = i / NG * 2 - 1, ox = warp(tx);
      const wx = origin.x + ox, wz = origin.z + oz;
      let h = island.h(wx, wz);
      const dist = Math.hypot(ox, oz);
      if (h < 0) h = Math.min(h, -0.8 - dist * 0.0008) - (dist > 3000 ? 30 : 0);
      pos[k] = ox; pos[k + 1] = h; pos[k + 2] = oz;
      const e = Math.max(20, dist * 0.012);
      const hx = island.h(wx + e, wz) - island.h(wx - e, wz);
      const hz = island.h(wx, wz + e) - island.h(wx, wz - e);
      const n = new THREE.Vector3(-hx, 2 * e, -hz).normalize();
      nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
      k += 3;
      uv[q++] = (wx - GEO.XMIN) / GEO.S; uv[q++] = (wz - GEO.ZMIN) / GEO.S;
    }
  }
  const idx = new Uint32Array(NG * NG * 6);
  k = 0;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const p = j * (NG + 1) + i;
    idx[k++] = p; idx[k++] = p + NG + 1; idx[k++] = p + 1;
    idx[k++] = p + 1; idx[k++] = p + NG + 1; idx[k++] = p + NG + 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP=(modelMatrix*vec4(position,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP;
        float th(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        float tn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
          return mix(mix(th(i),th(i+vec2(1,0)),u.x),mix(th(i+vec2(0,1)),th(i+vec2(1,1)),u.x),u.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb*=1.18;
        float dd=length(vWP-cameraPosition);
        float nf=1.-smoothstep(200.,2500.,dd);
        float dn=tn(vWP.xz*0.11)*0.55+tn(vWP.xz*0.5)*0.3+tn(vWP.xz*2.3)*0.15;
        diffuseColor.rgb*=mix(1.,0.78+0.44*dn,nf);
        float strata=0.5+0.5*sin(vWP.y*0.9+tn(vWP.xz*0.02)*6.);
        float steep=1.-normalize(vNormal).y;
        diffuseColor.rgb*=1.-0.18*strata*smoothstep(0.35,0.7,steep)*nf;
        float wet=smoothstep(1.6,0.4,vWP.y)*smoothstep(-0.6,0.2,vWP.y);
        diffuseColor.rgb*=1.-0.38*wet;
        // the sea floor: golden sand with ripples, and black lava reef furred with algae
        float sb=smoothstep(0.3,-0.7,vWP.y);
        if(sb>0.){
          float n1=tn(vWP.xz*0.045)*0.6+tn(vWP.xz*0.17)*0.3+tn(vWP.xz*0.9)*0.1;
          float rip=0.5+0.5*sin(dot(vWP.xz,vec2(0.83,0.55))*3.1+tn(vWP.xz*0.3)*4.);
          vec3 sand=vec3(0.6,0.5,0.32)*(0.84+0.2*rip)*(0.85+0.3*tn(vWP.xz*2.7));
          vec3 rock=mix(vec3(0.03,0.028,0.026),vec3(0.06,0.075,0.035),tn(vWP.xz*1.3))*(0.8+0.4*tn(vWP.xz*6.));
          float rk=smoothstep(0.66-0.3*${rocky.toFixed(2)},0.72-0.3*${rocky.toFixed(2)},n1);
          diffuseColor.rgb=mix(diffuseColor.rgb,mix(sand,rock,rk),sb);
        }
        `);
  };
  patchUnderwater(mat);
  mat.customProgramCacheKey = () => 'terrain' + rocky; // (the sea floor differs per spot)
  const mesh = new THREE.Mesh(g, mat);
  return mesh;
}

// ---------------------------------------------------------------------------
function houseTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#e6e1d6'; x.fillRect(0, 118, 128, 10);
  const doorCol = ['#2f6b3a', '#2f6b3a', '#245b8f', '#2f6b3a', '#7a4a26'];
  x.fillStyle = doorCol[0];
  x.fillRect(50, 70, 24, 48);
  x.fillStyle = '#2f6b3a';
  x.fillRect(14, 58, 20, 22); x.fillRect(92, 58, 20, 22);
  x.fillStyle = '#1d2a33';
  x.fillRect(17, 61, 14, 16); x.fillRect(95, 61, 14, 16);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 20, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildVillages(island, origin, quality) {
  const group = new THREE.Group();
  const boxes = [];
  const rnd = mulberry(1234);
  const maxDist = 16000;
  for (const T of TOWNS) {
    const c = ll2w(T.lat, T.lon);
    if (Math.hypot(c.x - origin.x, c.z - origin.z) > maxDist) continue;
    const n = Math.round(T.n * (quality === 'low' ? 0.6 : 1));
    let tries = 0, placed = 0;
    const rot = rnd() * Math.PI;
    while (placed < n && tries < n * 30) {
      tries++;
      const r = T.r * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const h = island.h(x, z);
      if (h < 1.6) continue;
      const sl = Math.abs(island.h(x + 8, z) - island.h(x - 8, z)) + Math.abs(island.h(x, z + 8) - island.h(x, z - 8));
      if (sl > 5) continue;
      const big = T.big;
      const w = big ? 18 + rnd() * 30 : 6 + rnd() * 7, d = big ? 10 + rnd() * 12 : 6 + rnd() * 6;
      const ht = big ? 6 + rnd() * 5 : (rnd() < 0.3 ? 5.8 : 3.2) + rnd() * 0.8;
      // keep houses apart
      let ok = true;
      for (let b = boxes.length - 1; b >= Math.max(0, boxes.length - 220); b--) {
        const o = boxes[b];
        if (Math.abs(o.x - x) < (o.w + w) * 0.55 && Math.abs(o.z - z) < (o.d + d) * 0.55) { ok = false; break; }
      }
      if (!ok) continue;
      boxes.push({ x, z, y: h - 0.6, w, d, ht, rot: rot + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.15 });
      placed++;
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const uvA = geo.attributes.uv;
  for (let i = 8; i < 12; i++) uvA.setXY(i, 0.05, 0.95);
  const mat = new THREE.MeshStandardMaterial({ map: houseTexture(), roughness: 0.85 });
  const inst = new THREE.InstancedMesh(geo, mat, boxes.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  boxes.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
    p.set(b.x - origin.x, b.y, b.z - origin.z);
    s.set(b.w, b.ht + 0.6, b.d);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
    const v = 0.93 + rnd() * 0.07;
    col.setRGB(v, v * (0.98 + rnd() * 0.02), v * (0.94 + rnd() * 0.05));
    inst.setColorAt(i, col);
  });
  group.add(inst);
  // little rooftop parapets/chimneys for a few houses
  const chim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.2, 0.9).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.9 }), Math.ceil(boxes.length / 3));
  let ci = 0;
  boxes.forEach((b, i) => {
    if (i % 3 || ci >= chim.count) return;
    p.set(b.x - origin.x + Math.cos(b.rot) * b.w * 0.25, b.y + b.ht + 0.6, b.z - origin.z - Math.sin(b.rot) * b.w * 0.25);
    m.compose(p, q.identity(), s.set(1, 1, 1));
    chim.setMatrixAt(ci++, m);
  });
  chim.count = ci;
  group.add(chim);

  // palms around the villages near the coast
  const palms = [];
  for (const T of TOWNS) {
    const c = ll2w(T.lat, T.lon);
    if (Math.hypot(c.x - origin.x, c.z - origin.z) > 9000) continue;
    for (let i = 0; i < 26; i++) {
      const r = T.r * 1.1 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const h = island.h(x, z);
      if (h < 1.5) continue;
      if (boxes.some((o) => Math.abs(o.x - x) < o.w * 0.7 && Math.abs(o.z - z) < o.d * 0.7)) continue;
      palms.push({ x, z, y: h - 0.3, s: 0.8 + rnd() * 0.6, r: rnd() * 6.28, lean: (rnd() - 0.5) * 0.25 });
    }
  }
  if (palms.length) {
    const pg = palmGeometry();
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    const pi = new THREE.InstancedMesh(pg, pm, palms.length);
    palms.forEach((o, i) => {
      q.setFromEuler(new THREE.Euler(o.lean, o.r, 0));
      m.compose(p.set(o.x - origin.x, o.y, o.z - origin.z), q, s.setScalar(o.s));
      pi.setMatrixAt(i, m);
    });
    group.add(pi);
  }
  return group;
}

function palmGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 7, 7, 6);
  trunk.translate(0, 3.5, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.pow(y / 7, 2) * 0.6); }
  paint(trunk, 0x8a6f4f);
  parts.push(trunk);
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.PlaneGeometry(0.7, 3.6, 1, 6);
    const lp = leaf.attributes.position;
    for (let k = 0; k < lp.count; k++) {
      const y = lp.getY(k) + 1.8; // 0..3.6 along leaf
      const x = lp.getX(k) * (1 - y / 4);
      lp.setXYZ(k, x, -Math.pow(y / 3.6, 2) * 1.6 + y * 0.35, y);
    }
    leaf.rotateY(i / 9 * Math.PI * 2);
    leaf.translate(0.6, 7, 0);
    paint(leaf, i % 2 ? 0x3d6b2a : 0x4a7d31);
    parts.push(leaf);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

export function paint(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export function mulberry(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// Kitesurf kites (Famara is famous for them) and seagulls
// ---------------------------------------------------------------------------
export class Ambient {
  constructor(scene, spot, island, origin) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.kites = [];
    this.spot = spot;
    const cols = [[0xff3d6e, 0xffd23d], [0x29c7ff, 0x1f3cff], [0x9cff3d, 0x00a37a], [0xff8a1f, 0xffffff]];
    const nk = spot.kites || 0;
    for (let i = 0; i < nk; i++) {
      const g = new THREE.PlaneGeometry(9, 2.6, 16, 1);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k) / 4.5;
        p.setZ(k, -Math.cos(x * 1.25) * 2.6 + 2.6);
        p.setY(k, p.getY(k) - x * x * 1.6);
      }
      g.computeVertexNormals();
      const c = cols[i % cols.length];
      const tex = stripeTexture(c[0], c[1]);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 }));
      const lineG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5 }));
      const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x15171c }));
      this.group.add(mesh, line, rider);
      // anchor somewhere along the shore, a bit out, downwind of the surf
      const along = spot.kiteAlong + i * 140 * (i % 2 ? -1 : 1);
      const base = new THREE.Vector3(spot.a.x * along + spot.d.x * -60, 0, spot.a.z * along + spot.d.z * -60);
      this.kites.push({ mesh, line, rider, base, ph: i * 1.7, sp: 0.18 + i * 0.03 });
    }
    // birds
    this.birds = [];
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.3, -1.1, 0.25, 0.1, 0, 0, 0.3, 0, 0, -0.3, 1.1, 0.25, 0.1, 0, 0, 0.3]), 3));
    bg.computeVertexNormals();
    const bm = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(bg.clone(), bm);
      this.group.add(b);
      this.birds.push({ m: b, r: 40 + Math.random() * 90, h: 18 + Math.random() * 30, sp: 0.15 + Math.random() * 0.15, ph: Math.random() * 6, c: new THREE.Vector3(spot.a.x * (Math.random() - 0.5) * 300 - spot.d.x * 120, 0, spot.a.z * (Math.random() - 0.5) * 300 - spot.d.z * 120) });
    }
  }
  update(t, waves) {
    const wind = new THREE.Vector3(this.spot.d.x * 0.3 + this.spot.a.x, 0, this.spot.d.z * 0.3 + this.spot.a.z).normalize();
    for (const k of this.kites) {
      const tt = t * k.sp + k.ph;
      const rider = k.base.clone().addScaledVector(new THREE.Vector3(this.spot.a.x, 0, this.spot.a.z), Math.sin(tt * 0.3) * 80);
      rider.y = waves.height(rider.x, rider.z) + 0.9;
      const ex = Math.sin(tt * 2) * 0.55, ey = Math.sin(tt * 4) * 0.18;
      const side = new THREE.Vector3(-wind.z, 0, wind.x);
      const kp = rider.clone().addScaledVector(wind, 22 * Math.cos(ex)).addScaledVector(side, 22 * Math.sin(ex));
      kp.y = rider.y + 13 + ey * 14;
      k.mesh.position.copy(kp);
      k.mesh.lookAt(rider);
      k.mesh.rotateZ(ex * 0.9);
      const lp = k.line.geometry.attributes.position;
      lp.setXYZ(0, rider.x, rider.y + 0.4, rider.z); lp.setXYZ(1, kp.x, kp.y, kp.z); lp.needsUpdate = true;
      k.rider.position.copy(rider);
      k.rider.rotation.z = Math.sin(tt) * 0.3;
    }
    for (const b of this.birds) {
      const a = t * b.sp + b.ph;
      b.m.position.set(b.c.x + Math.cos(a) * b.r, b.h + Math.sin(a * 2.3) * 3, b.c.z + Math.sin(a) * b.r);
      b.m.rotation.set(0, -a, 0);
      const flap = Math.sin(t * 7 + b.ph) * 0.35;
      const p = b.m.geometry.attributes.position;
      p.setY(1, 0.25 + flap); p.setY(4, 0.25 + flap); p.needsUpdate = true;
    }
  }
}

function stripeTexture(a, b) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = '#' + new THREE.Color(i % 2 ? a : b).getHexString(); x.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------------------
// Beach life: striped umbrellas, towels, people and palms along the sand near the spot
// ---------------------------------------------------------------------------
export function buildBeach(island, origin, spot, quality) {
  const group = new THREE.Group();
  const rnd = mulberry(99);
  const a = spot.a, d = spot.d;
  const H = (s, u) => island.h(origin.x + a.x * s + d.x * u, origin.z + a.z * s + d.z * u);
  const spots = { umb: [], towel: [], ppl: [], palm: [] };
  const mul = quality === 'low' ? 0.5 : 1;
  for (let s = -650; s <= 650; s += 7) {
    // find where the sand starts on this line toward the shore
    let u0 = null;
    for (let u = -60; u < 400; u += 2) if (H(s, u) > 0.7) { u0 = u; break; }
    if (u0 === null) continue;
    for (let k = 0; k < 2; k++) {
      const u = u0 + 6 + rnd() * 50, ss = s + rnd() * 7;
      const h = H(ss, u);
      if (h < 0.7 || h > 9) continue;
      if (Math.abs(H(ss + 4, u) - H(ss - 4, u)) + Math.abs(H(ss, u + 4) - H(ss, u - 4)) > 2.5) continue;
      const x = a.x * ss + d.x * u, z = a.z * ss + d.z * u;
      const r = rnd();
      if (r < 0.25 * mul) spots.umb.push({ x, z, y: h, rot: rnd() * 6.28, c: Math.floor(rnd() * 5) });
      else if (r < 0.4 * mul) spots.towel.push({ x, z, y: h, rot: rnd() * 6.28, c: Math.floor(rnd() * 6) });
      else if (r < 0.75 * mul) spots.ppl.push({ x, z, y: h, rot: rnd() * 6.28 });
      else if (r < 0.8 * mul && u > u0 + 30) spots.palm.push({ x, z, y: h - 0.3, s: 0.8 + rnd() * 0.5, r: rnd() * 6.28, lean: (rnd() - 0.5) * 0.3 });
    }
    // a few people paddling or standing in the shallows
    if (rnd() < 0.18 * mul) {
      const u = u0 - 3 - rnd() * 8;
      spots.ppl.push({ x: a.x * s + d.x * u, z: a.z * s + d.z * u, y: -0.6, rot: rnd() * 6.28, wet: true });
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const cols = ['#ff3d6e', '#1ec8ff', '#ffd23d', '#7dff5a', '#ff7a1f', '#b06bff'];
  // umbrellas: pole + striped canopy (vertex colours alternate per segment)
  if (spots.umb.length) {
    const canopy = new THREE.ConeGeometry(1.25, 0.55, 12, 1, true).toNonIndexed();
    const cc = new Float32Array(canopy.attributes.position.count * 3);
    for (let i = 0; i < canopy.attributes.position.count; i++) { const f = Math.floor(i / 6) % 2 ? 1 : 0.15; cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = f; }
    canopy.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    canopy.translate(0, 2.2, 0);
    const pole = paint(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 5).translate(0, 1.15, 0).toNonIndexed(), 0xeeeeee);
    const g = mergeGeometries([canopy, pole]);
    g.computeVertexNormals();
    const inst = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), spots.umb.length);
    spots.umb.forEach((o, i) => {
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, o.rot, (rnd() - 0.5) * 0.25));
      inst.setMatrixAt(i, m.compose(p.set(o.x, o.y - 0.2, o.z), q, sc.set(1, 1, 1)));
      inst.setColorAt(i, col.set(cols[o.c]).lerp(new THREE.Color('#ffffff'), 0.05));
    });
    group.add(inst);
  }
  if (spots.towel.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.03, 1.8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), spots.towel.length);
    spots.towel.forEach((o, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
      inst.setMatrixAt(i, m.compose(p.set(o.x, o.y + 0.02, o.z), q, sc.set(1, 1, 1)));
      inst.setColorAt(i, col.set(cols[o.c]));
    });
    group.add(inst);
  }
  // little rubbery beach people in the same toy style as the surfer
  if (spots.ppl.length) {
    const body = new THREE.CapsuleGeometry(0.2, 0.75, 3, 8).translate(0, 0.6, 0);
    const head = new THREE.SphereGeometry(0.17, 10, 8).scale(0.95, 1.15, 0.95).translate(0, 1.32, 0);
    const legs = new THREE.CapsuleGeometry(0.09, 0.4, 2, 6).translate(0, 0.25, 0);
    const shirtCols = ['#1aa7e0', '#ff3d6e', '#ffd23d', '#2ecc71', '#ffffff', '#ff7a1f'];
    const skinCols = ['#ff6a1c', '#3fb8ff', '#ff5fa2', '#7bd64a', '#ffb02e', '#f1c7a0', '#b07cff'];
    const iB = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.6 }), spots.ppl.length);
    const iH = new THREE.InstancedMesh(mergeGeometries([head, legs]), new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.4 }), spots.ppl.length);
    spots.ppl.forEach((o, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
      const s2 = 0.85 + rnd() * 0.3;
      m.compose(p.set(o.x, o.y, o.z), q, sc.set(s2, s2, s2));
      iB.setMatrixAt(i, m); iH.setMatrixAt(i, m);
      iB.setColorAt(i, col.set(shirtCols[Math.floor(rnd() * shirtCols.length)]));
      iH.setColorAt(i, col.set(skinCols[Math.floor(rnd() * skinCols.length)]));
    });
    group.add(iB, iH);
  }
  if (spots.palm.length) {
    const inst = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), spots.palm.length);
    spots.palm.forEach((o, i) => {
      q.setFromEuler(new THREE.Euler(o.lean, o.r, 0));
      inst.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, sc.setScalar(o.s)));
    });
    group.add(inst);
  }
  group.traverse((o) => { o.frustumCulled = false; });
  return group;
}
