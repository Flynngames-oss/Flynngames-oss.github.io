// Builds the resort in 3D from the height function: chunked snow terrain with groomed corduroy and
// sparkles, high-res overlays for every kicker and the superpipe, snow-loaded pine forests, rocks,
// distant peaks, two working chairlifts, park rails & boxes, venue grandstands with crowds, slalom
// gates, trail signs, fences and a base village. Also keeps the colliders for the physics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './terrain.js';
import { rng, makeNoise } from './noise.js';

const { H, MASK, sstep } = T;
const NR = makeNoise(77);

// ------------------------------------------------------------------ snow material
function snowTextures() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), id = x.createImageData(S, S), r = rng(3);
  const waves = [];
  for (let i = 0; i < 46; i++) { const kx = Math.round((r() - 0.5) * 24), ky = Math.round((r() - 0.5) * 10) || 1; waves.push([kx, ky, r() * 6.28, 1 / Math.hypot(kx, ky)]); }
  for (let i = 0; i < 300; i++) waves.push([Math.round((r() - 0.5) * 140), Math.round((r() - 0.5) * 140) || 1, r() * 6.28, 0.012]);
  const hf = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let h = 0; const u = i / S, v = j / S;
    for (const [kx, ky, p, a] of waves) h += Math.sin(6.2832 * (kx * u + ky * v) + p) * a;
    hf[j * S + i] = h;
  }
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const l = hf[j * S + ((i + S - 1) % S)], rr = hf[j * S + ((i + 1) % S)], u = hf[((j + S - 1) % S) * S + i], d = hf[((j + 1) % S) * S + i];
    let nx = (l - rr) * 3.2, ny = (u - d) * 3.2; const L = Math.hypot(nx, ny, 1);
    const o = (j * S + i) * 4; id.data[o] = (nx / L * 0.5 + 0.5) * 255; id.data[o + 1] = (ny / L * 0.5 + 0.5) * 255; id.data[o + 2] = (1 / L * 0.5 + 0.5) * 255; id.data[o + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  const nrm = new THREE.CanvasTexture(c); nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.anisotropy = 8;
  // albedo: barely-there variation so big slopes don't look flat
  const c2 = document.createElement('canvas'); c2.width = c2.height = 256;
  const x2 = c2.getContext('2d'); x2.fillStyle = '#f3f6fa'; x2.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { x2.fillStyle = `rgba(${170 + r() * 40},${190 + r() * 30},${220 + r() * 30},${0.03 + r() * 0.05})`; x2.beginPath(); x2.arc(r() * 256, r() * 256, 3 + r() * 22, 0, 7); x2.fill(); }
  const alb = new THREE.CanvasTexture(c2); alb.wrapS = alb.wrapT = THREE.RepeatWrapping; alb.colorSpace = THREE.SRGBColorSpace;
  return { nrm, alb };
}
let SNOWTEX = null;
export const snowUniforms = { uSparkle: { value: new THREE.Color(1, 1, 1) } };
export function snowMaterial(overlay = false) {
  if (!SNOWTEX) SNOWTEX = snowTextures();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: SNOWTEX.alb, normalMap: SNOWTEX.nrm, normalScale: new THREE.Vector2(0.38, 0.38), roughness: 0.86, metalness: 0 });
  if (overlay) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSparkle = snowUniforms.uSparkle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float groom;\nvarying float vGroom;\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroom = groom;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vGroom; varying vec3 vWPos; uniform vec3 uSparkle;
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.82, vGroom);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float dist = length(vViewPosition);
  float fade = (1.0 - smoothstep(3.0, 16.0, dist)) * vGroom;
  if (fade > 0.001) {
    float ph = vWPos.x * 104.72 + sin(vWPos.z * 0.05) * 3.0;
    float pass = abs(fract(vWPos.x / 4.3 + 0.07 * sin(vWPos.z * 0.013)) - 0.5);
    float d = cos(ph) * 0.2 * fade + (1.0 - smoothstep(0.0, 0.012, 0.5 - pass)) * 0.0;
    vec3 tx = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    normal = normalize(normal + tx * d);
  }
}`)
      .replace('#include <dithering_fragment>', `{
  vec3 cell = floor(vWPos * 20.0);
  float hh = h13(cell);
  vec3 vd = normalize(vViewPosition);
  float tw = h13(cell + floor(vd * 45.0) * 7.0);
  float dist = length(vViewPosition);
  float sp = step(0.991, hh) * step(0.6, tw) * (1.0 - smoothstep(2.0, 26.0, dist));
  gl_FragColor.rgb += sp * uSparkle;
}
#include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'snow' + (overlay ? 'o' : '');
  return m;
}

// ------------------------------------------------------------------ colliders (circles + boxes)
export class Colliders {
  constructor() { this.cells = new Map(); this.boxes = []; }
  key(ix, iz) { return ix * 100003 + iz; }
  add(x, z, r, kind = 'tree') {
    const ix = Math.floor(x / 10), iz = Math.floor(z / 10), k = this.key(ix, iz);
    let a = this.cells.get(k); if (!a) this.cells.set(k, (a = []));
    a.push({ x, z, r, kind });
  }
  box(x0, z0, x1, z1, y1, kind = 'building') { this.boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y1, kind }); }
  // nearest overlap with the rider at (x,z) (radius rr) or null
  hit(x, y, z, rr) {
    const ix = Math.floor(x / 10), iz = Math.floor(z / 10);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const c = this.cells.get(this.key(ix + a, iz + b)); if (!c) continue;
      for (const o of c) { const dx = x - o.x, dz = z - o.z, rs = o.r + rr; if (dx * dx + dz * dz < rs * rs) return o; }
    }
    for (const b of this.boxes) if (x > b.x0 - rr && x < b.x1 + rr && z > b.z0 - rr && z < b.z1 + rr && y < b.y1) return b;
    return null;
  }
}

// ------------------------------------------------------------------ helpers
const colorGeo = (g, col) => {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
};
const boxAt = (w, h, d, x, y, z, col, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return colorGeo(g, col); };
const cylAt = (r0, r1, h, x, y, z, col, seg = 8, rx = 0, rz = 0) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z); return colorGeo(g, col); };
const VC = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.75 }, o));
function textTexture(lines, w = 512, h = 256, bg = '#0d1b2a', fg = '#fff', font = 'Bebas Neue', size = 90) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  const L = Array.isArray(lines) ? lines : [lines];
  L.forEach((t, i) => { const s = i === 0 ? size : size * 0.45; x.font = `${s}px "${font}", "Barlow Condensed", Impact, sans-serif`; x.fillText(t, w / 2, h / 2 + (i - (L.length - 1) / 2) * size * 0.75); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ------------------------------------------------------------------ trees
function pineGeometry(hi) {
  const r = rng(hi ? 11 : 12), parts = [];
  const green = new THREE.Color('#1c3a27'), green2 = new THREE.Color('#2a4d33'), snow = new THREE.Color('#f2f6fb'), dark = new THREE.Color('#10231a');
  const trunk = new THREE.CylinderGeometry(0.11, 0.24, 2.6, hi ? 7 : 5); trunk.translate(0, 1.3, 0); parts.push(colorGeo(trunk, '#3d2b1f'));
  if (!hi) {
    const cone = new THREE.ConeGeometry(2.4, 8.6, 7); cone.translate(0, 5.7, 0);
    const g = cone.toNonIndexed(); const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const c = y > 6.5 ? snow : (i % 3 === 0 ? snow.clone().lerp(green, 0.35) : green); col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); parts.push(g);
    return mergeGeometries(parts);
  }
  const layers = 8, A = 11, top = 10;
  for (let l = 0; l < layers; l++) {
    const f = l / layers;
    const y0 = 1.5 + f * (top - 2.4), Rr = 2.6 * Math.pow(1 - f, 0.95) + 0.25, hgt = 1.9 - f * 0.6;
    const pos = [], col = [];
    const apex = [0, y0 + hgt, 0], under = [0, y0 + hgt * 0.35, 0];
    const rim = [];
    for (let a = 0; a < A; a++) {
      const t = (a / A) * Math.PI * 2 + l * 0.7, rr = Rr * (0.72 + r() * 0.42);
      rim.push([Math.cos(t) * rr, y0 - r() * 0.35, Math.sin(t) * rr, r()]);
    }
    for (let a = 0; a < A; a++) {
      const p = rim[a], q = rim[(a + 1) % A];
      const cs = (v) => (v < 0.5 ? snow.clone().lerp(green2, v * 0.6) : green.clone().lerp(green2, r()));
      // top surface (snowy)
      pos.push(...apex, ...q.slice(0, 3), ...p.slice(0, 3));
      const ca = snow.clone().lerp(green, 0.15 + r() * 0.2);
      col.push(ca.r, ca.g, ca.b); const cq = cs(q[3]); col.push(cq.r, cq.g, cq.b); const cp = cs(p[3]); col.push(cp.r, cp.g, cp.b);
      // underside (dark needles)
      pos.push(...under, ...p.slice(0, 3), ...q.slice(0, 3));
      for (let k = 0; k < 3; k++) col.push(dark.r, dark.g, dark.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals(); parts.push(g);
  }
  const tip = new THREE.ConeGeometry(0.35, 1.6, 6); tip.translate(0, top + 0.2, 0); parts.push(colorGeo(tip, '#e9eff5'));
  for (const p of parts) if (!p.attributes.normal) p.computeVertexNormals();
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position, n = makeNoise(91);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.35 * n(x * 1.7 + 3, z * 1.7 + y) + 0.15 * n(x * 4, y * 4 + z);
    p.setXYZ(i, x * k, y * k * 0.7, z * k);
  }
  g.computeVertexNormals();
  const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
  const nn = ng.attributes.normal, col = new Float32Array(nn.count * 3);
  const rock = new THREE.Color('#5a5650'), rock2 = new THREE.Color('#3f3c38'), snow = new THREE.Color('#f1f5fa');
  for (let i = 0; i < nn.count; i++) { const c = nn.getY(i) > 0.45 ? snow : rock.clone().lerp(rock2, (i * 0.618) % 1); col.set([c.r, c.g, c.b], i * 3); }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); ng.deleteAttribute('uv');
  return ng;
}

// ------------------------------------------------------------------ chairlift
export class Lift {
  constructor(def, scene, col) {
    this.def = def; this.speed = 6.5; this.time = 0;
    const x = def.x, off = 2.6;
    const zs = [def.zBase];
    const span = def.zBase - def.zTop, n = Math.ceil(span / 115);
    for (let i = 1; i < n; i++) zs.push(def.zBase - (span * i) / n);
    zs.push(def.zTop);
    // cable height at each support: stations lower, towers tall enough to clear the snow by ~8 m mid-span
    const pts = zs.map((z, i) => ({ z, y: H(x, z) + (i === 0 || i === zs.length - 1 ? 6.2 : 11.5) }));
    for (let it = 0; it < 3; it++) for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 1; k < 8; k++) {
        const z = pts[i].z + (pts[i + 1].z - pts[i].z) * (k / 8), y = pts[i].y + (pts[i + 1].y - pts[i].y) * (k / 8);
        const clr = y - Math.max(H(x - off, z), H(x + off, z));
        if (clr < 8) { const add = 8 - clr; if (i > 0) pts[i].y += add * 0.6; if (i + 1 < pts.length - 1) pts[i + 1].y += add * 0.6; }
      }
    }
    this.towers = pts;
    // loop path: up line (x-off) from base to top, bullwheel, down line (x+off) back
    const path = [];
    for (const p of pts) path.push(new THREE.Vector3(x - off, p.y, p.z));
    for (let a = 1; a < 8; a++) { const t = (a / 8) * Math.PI; path.push(new THREE.Vector3(x - off * Math.cos(t), pts[pts.length - 1].y, def.zTop - off * Math.sin(t))); }
    for (let i = pts.length - 1; i >= 0; i--) path.push(new THREE.Vector3(x + off, pts[i].y, pts[i].z));
    for (let a = 1; a < 8; a++) { const t = (a / 8) * Math.PI; path.push(new THREE.Vector3(x + off * Math.cos(t), pts[0].y, def.zBase + off * Math.sin(t))); }
    this.path = path;
    this.cum = [0];
    for (let i = 1; i <= path.length; i++) this.cum.push(this.cum[i - 1] + path[i % path.length].distanceTo(path[i - 1]));
    this.L = this.cum[this.cum.length - 1];
    this.sLoad = 4; this.sUnload = this.cum[pts.length - 1] - 3;
    this.spacing = 22;
    this.N = Math.floor(this.L / this.spacing);
    this.build(scene, col);
  }
  at(s, out, dirOut) {
    s = ((s % this.L) + this.L) % this.L;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const a = this.path[lo], b = this.path[(lo + 1) % this.path.length];
    const t = (s - this.cum[lo]) / Math.max(1e-6, this.cum[lo + 1] - this.cum[lo]);
    out.lerpVectors(a, b, t);
    if (dirOut) dirOut.subVectors(b, a).normalize();
    return out;
  }
  chairS(i) { return (i * this.spacing + this.time * this.speed) % this.L; }
  build(scene, col) {
    const x = this.def.x;
    const steel = '#8b9097', dark = '#2b2f36';
    // towers
    const tgeo = [];
    for (let i = 1; i < this.towers.length - 1; i++) {
      const p = this.towers[i], gy = H(x, p.z), h = p.y - gy + 0.6;
      tgeo.push(cylAt(0.42, 0.55, h, x, gy + h / 2 - 0.4, p.z, steel, 10));
      tgeo.push(boxAt(6.8, 0.45, 0.6, x, p.y + 0.5, p.z, steel));
      tgeo.push(boxAt(0.9, 0.5, 2.4, x - 2.6, p.y + 0.2, p.z, dark));
      tgeo.push(boxAt(0.9, 0.5, 2.4, x + 2.6, p.y + 0.2, p.z, dark));
      tgeo.push(boxAt(0.12, h * 0.95, 0.12, x + 0.6, gy + h * 0.47, p.z + 0.5, '#d6d9dd'));
      col.add(x, p.z, 0.75, 'tower');
    }
    // stations
    for (const [i, top] of [[0, false], [this.towers.length - 1, true]]) {
      const p = this.towers[i], gy = H(x, p.z), dz = top ? -1 : 1;
      tgeo.push(boxAt(9, 1.2, 12, x, gy + 0.3, p.z + dz * 2, '#9aa0a6'));
      tgeo.push(boxAt(1.2, p.y - gy + 1, 1.2, x - 3.5, gy + (p.y - gy) / 2, p.z + dz * 1, steel));
      tgeo.push(boxAt(1.2, p.y - gy + 1, 1.2, x + 3.5, gy + (p.y - gy) / 2, p.z + dz * 1, steel));
      tgeo.push(boxAt(8.4, 1.6, 7.5, x, p.y + 1.2, p.z + dz * 0.6, '#d9dde2'));
      tgeo.push(boxAt(9.6, 0.35, 9, x, p.y + 2.2, p.z + dz * 0.6, '#b8202a', 0.05 * dz));
      const wheel = new THREE.TorusGeometry(2.6, 0.12, 6, 28); wheel.rotateX(Math.PI / 2); wheel.translate(x, p.y, p.z); tgeo.push(colorGeo(wheel, dark));
      // operator hut
      const hx = x + 7.5, hz = p.z + dz * 4;
      tgeo.push(boxAt(3.2, 2.8, 3.2, hx, H(hx, hz) + 1.4, hz, '#7a4a2a'));
      tgeo.push(boxAt(3.8, 0.4, 3.8, hx, H(hx, hz) + 3.0, hz, '#f0f4f8'));
      col.box(x - 4.6, p.z + dz * 2 - 6, x + 4.6, p.z + dz * 2 + 6, gy + 1.2, 'station');
      col.box(hx - 1.7, hz - 1.7, hx + 1.7, hz + 1.7, H(hx, hz) + 3, 'hut');
    }
    const towers = new THREE.Mesh(mergeGeometries(tgeo), VC({ metalness: 0.35, roughness: 0.55 }));
    towers.castShadow = true; towers.receiveShadow = true; scene.add(towers);
    // station signs
    for (const [i, top] of [[0, false], [this.towers.length - 1, true]]) {
      const p = this.towers[i];
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshStandardMaterial({ map: textTexture(this.def.name.toUpperCase(), 1024, 200, '#b8202a', '#fff', 'Bebas Neue', 150), roughness: 0.6 }));
      sign.position.set(x, p.y + 2.9, p.z + (top ? -1 : 1) * 4.3); sign.rotation.y = top ? Math.PI : 0;
      scene.add(sign);
    }
    // cables
    const cm = new THREE.LineBasicMaterial({ color: 0x1a1d22 });
    const lp = this.path.concat([this.path[0]]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lp), cm); scene.add(line);
    // chairs: instanced, 4-seat with backrest, armrests, bar and footrest
    const cg = [];
    const red = '#c2272d', blk = '#22252b', grey = '#9aa3ad';
    cg.push(boxAt(0.12, 2.6, 0.12, 0, -1.3, 0, grey));
    cg.push(boxAt(0.5, 0.35, 0.7, 0, 0.1, 0, blk));
    cg.push(boxAt(2.4, 0.12, 0.12, 0, -2.6, -0.05, grey));
    cg.push(boxAt(2.3, 0.14, 0.62, 0, -2.75, 0.18, red));
    cg.push(boxAt(2.3, 0.55, 0.1, 0, -2.4, -0.15, red, -0.18));
    cg.push(boxAt(0.08, 0.5, 0.6, 1.17, -2.5, 0.18, grey)); cg.push(boxAt(0.08, 0.5, 0.6, -1.17, -2.5, 0.18, grey));
    cg.push(boxAt(2.3, 0.06, 0.06, 0, -1.95, 0.6, grey)); cg.push(boxAt(0.06, 0.06, 0.65, 1.1, -1.95, 0.3, grey)); cg.push(boxAt(0.06, 0.06, 0.65, -1.1, -1.95, 0.3, grey));
    cg.push(boxAt(2.0, 0.05, 0.3, 0, -3.3, 0.75, grey));
    this.chairs = new THREE.InstancedMesh(mergeGeometries(cg), VC({ roughness: 0.5, metalness: 0.2 }), this.N);
    this.chairs.castShadow = true; this.chairs.frustumCulled = false;
    scene.add(this.chairs);
    this.update(0);
  }
  update(dt, fast = 1) {
    this.time += dt * fast;
    const p = new THREE.Vector3(), d = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < this.N; i++) {
      this.at(this.chairS(i), p, d);
      const yaw = Math.atan2(d.x, d.z);
      q.setFromAxisAngle(_UP, yaw);
      m.compose(p, q, _ONE);
      this.chairs.setMatrixAt(i, m);
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }
  // seat position for chair i (pos, yaw)
  seat(i, out) {
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    this.at(this.chairS(i), p, d);
    const yaw = Math.atan2(d.x, d.z);
    out.pos.set(p.x + Math.sin(yaw) * 0.12 + Math.cos(yaw) * 0.55, p.y - 2.7, p.z + Math.cos(yaw) * 0.12 - Math.sin(yaw) * 0.55);
    out.yaw = yaw; out.s = this.chairS(i);
    return out;
  }
  loadPoint() { const p = new THREE.Vector3(); this.at(this.sLoad, p); p.y = H(p.x, p.z); return p; }
  // the chair that reaches the loading point next
  nextChair() {
    let best = 0, bt = 1e9;
    for (let i = 0; i < this.N; i++) { const ds = ((this.sLoad - this.chairS(i)) % this.L + this.L) % this.L; if (ds < bt) { bt = ds; best = i; } }
    return { i: best, wait: bt / this.speed };
  }
}
const _UP = new THREE.Vector3(0, 1, 0), _ONE = new THREE.Vector3(1, 1, 1);

// ------------------------------------------------------------------ build everything
export async function buildWorld(scene, Q, progress = () => {}) {
  const col = new Colliders();
  T.initRails();
  const out = { col, lifts: [], chunks: [], trees: [], dynamic: [] };
  const snow = snowMaterial(false), snowO = snowMaterial(true);
  out.snowMats = [snow, snowO];
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  // ---------- overlay regions (base terrain is pushed down beneath them)
  const holes = [];
  const P = T.PIPE;
  holes.push((x, z) => Math.abs(x - P.x) < P.half + P.deckW - Q.res - 0.5 && z > P.z0 + Q.res && z < P.z1 - Q.res ? 9 : 0);
  for (const k of T.KICKERS) {
    const t0 = -k.lr - 1.5 + Q.res + 0.3, t1 = k.deck + k.land + 1.5 - Q.res - 0.3, lw = k.wd / 2 + 2 + k.H - Q.res - 0.3;
    holes.push((x, z) => {
      const dx = x - k.x, dz = z - k.z;
      if (Math.abs(dz) > k.reach || Math.abs(dx) > k.reach) return 0;
      const t = dx * k.sa + dz * k.ca, lat = dx * k.ca - dz * k.sa;
      return t > t0 && t < t1 && Math.abs(lat) < lw ? 0.6 : 0;
    });
  }

  // ---------- chunked terrain
  const CH = 120, r = Q.res, n = Math.round(CH / r);
  const B = T.BOUNDS;
  const nx = Math.ceil((B.x1 - B.x0) / CH), nz = Math.ceil((B.z1 - B.z0) / CH);
  let done = 0;
  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) {
      const x0 = B.x0 + cx * CH, z0 = B.z0 + cz * CH;
      const W = n + 3, hs = new Float32Array(W * W), gr = new Float32Array(W * W);
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const x = x0 + (i - 1) * r, z = z0 + (j - 1) * r; hs[j * W + i] = H(x, z); gr[j * W + i] = MASK.g; }
      const cnt = (n + 1) * (n + 1);
      const pos = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2), gm = new Float32Array(cnt);
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const o = j * (n + 1) + i, hi = (j + 1) * W + (i + 1);
        const x = x0 + i * r, z = z0 + j * r;
        let y = hs[hi];
        for (const h of holes) { const d = h(x, z); if (d) { y -= d; break; } }
        pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
        const dx = hs[hi + 1] - hs[hi - 1], dz = hs[hi + W] - hs[hi - W];
        const L = Math.hypot(dx, 2 * r, dz);
        nrm[o * 3] = -dx / L; nrm[o * 3 + 1] = (2 * r) / L; nrm[o * 3 + 2] = -dz / L;
        uv[o * 2] = x / 7; uv[o * 2 + 1] = z / 7;
        gm[o] = gr[hi];
      }
      const idx = new (cnt > 65535 ? Uint32Array : Uint16Array)(n * n * 6);
      let k = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('groom', new THREE.BufferAttribute(gm, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, snow); mesh.receiveShadow = true; scene.add(mesh);
      out.chunks.push({ mesh, cx: x0 + CH / 2, cz: z0 + CH / 2, hi: null, lo: null });
      done++;
    }
    progress(0.1 + 0.45 * (cz / nz), 'Shaping the mountain…');
    await yieldUI();
  }

  // ---------- overlays: superpipe
  {
    const cols = [];
    const half = P.half;
    for (let i = 0; i <= 4; i++) cols.push(-(half + P.deckW) + (P.deckW * i) / 4);
    for (let i = 1; i <= 22; i++) { const th = (85 * Math.PI / 180) * (1 - i / 22); cols.push(-(P.b + P.R * Math.sin(th))); }
    for (let i = 1; i < 10; i++) cols.push(-P.b + (2 * P.b * i) / 10);
    for (let i = 0; i <= 22; i++) { const th = (85 * Math.PI / 180) * (i / 22); cols.push(P.b + P.R * Math.sin(th)); }
    for (let i = 1; i <= 4; i++) cols.push(half + (P.deckW * i) / 4);
    const rows = []; for (let z = P.z0 - 3; z <= P.z1 + 3; z += 0.75) rows.push(z);
    out.dynamic.push(overlayMesh(scene, snowO, rows.length, cols.length, (j, i) => { const x = P.x + cols[i], z = rows[j]; return [x, z]; }, 1, (x, z) => [x / 7, z / 7]));
    // pipe deck edge fences + blue lip lines
    const lipM = new THREE.MeshStandardMaterial({ color: 0x2a6bff, roughness: 0.6, emissive: 0x0a1e55, emissiveIntensity: 0.4 });
    for (const sd of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.14, P.z1 - P.z0 - 50); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, lipM); m.position.set(P.x + sd * (half + 0.15), T.baseY((P.z0 + P.z1) / 2) + 0.02, (P.z0 + P.z1) / 2);
      m.rotation.x = Math.atan(T.slopeAt(350)); scene.add(m);
    }
  }
  progress(0.6, 'Cutting the superpipe…'); await yieldUI();

  // ---------- overlays: kickers
  for (const k of T.KICKERS) {
    const ts = [], ls = [];
    const pushR = (arr, a, b, st) => { for (let v = a; v < b - 1e-6; v += st) arr.push(v); };
    pushR(ts, -k.lr - 1.5, -k.lr, 0.5); pushR(ts, -k.lr, 0, Math.min(0.28, k.lr / 10)); pushR(ts, 0, k.deck, 0.6); pushR(ts, k.deck, k.deck + k.land + 1.5, 0.8); ts.push(k.deck + k.land + 1.5);
    const lw = k.wd / 2 + 2 + k.H, li = k.w / 2 + 1.6 + 0.8 * k.H;
    pushR(ls, -lw, -li, 0.9); pushR(ls, -li, li, 0.35); pushR(ls, li, lw, 0.9); ls.push(lw);
    out.dynamic.push(overlayMesh(scene, snowO, ts.length, ls.length, (j, i) => {
      const t = ts[j], l = ls[i];
      return [k.x + t * k.sa + l * k.ca, k.z + t * k.ca - l * k.sa];
    }, 1, (x, z) => [x / 7, z / 7]));
    // blue dye line on the lip (like real parks) for proper jumps
    if (!k.onramp && k.H > 0.9) {
      const g = new THREE.PlaneGeometry(k.w * 0.95, 0.16); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2a6bff, roughness: 0.7, emissive: 0x0a1e55, emissiveIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 }));
      const lx = k.x - 0.1 * k.sa, lz = k.z - 0.1 * k.ca;
      m.position.set(lx, H(lx, lz) + 0.015, lz); m.rotation.y = k.a;
      scene.add(m);
    }
  }
  progress(0.68, 'Building kickers…'); await yieldUI();

  // ---------- rails & boxes
  {
    const railM = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.9, roughness: 0.25 });
    const legM = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.6, roughness: 0.5 });
    const boxTex = textTexture(['FRESH TRACKS'], 1024, 128, '#1d1f24', '#ffd166', 'Bebas Neue', 100);
    const boxTop = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.35, metalness: 0.2 });
    const boxSide = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.6 });
    for (const R of T.RAILS) {
      const a = new THREE.Vector3(R.p0.x, R.p0.y, R.p0.z), b = new THREE.Vector3(R.p1.x, R.p1.y, R.p1.z);
      const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      const pitch = Math.atan2(a.y - b.y, b.z - a.z);
      if (R.type === 'box') {
        const g = new THREE.BoxGeometry(0.55, 0.45, len);
        const m = new THREE.Mesh(g, [boxSide, boxSide, boxTop, boxSide, boxSide, boxSide]);
        m.position.copy(mid).add(new THREE.Vector3(0, -0.225, 0)); m.rotation.x = pitch; m.castShadow = true; m.receiveShadow = true; scene.add(m);
      } else {
        const g = new THREE.CylinderGeometry(0.045, 0.045, len, 14); g.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(g, railM); m.position.copy(mid); m.rotation.x = pitch; m.castShadow = true; scene.add(m);
      }
      const nLeg = Math.max(2, Math.ceil(len / 4));
      for (let i = 0; i <= nLeg; i++) {
        const p = a.clone().lerp(b, 0.05 + 0.9 * (i / nLeg)); const gy = H(p.x, p.z) - 0.3; const h = p.y - gy - (R.type === 'box' ? 0.4 : 0.03);
        if (h <= 0.05) continue;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 8), legM); leg.position.set(p.x, gy + h / 2, p.z); leg.castShadow = true; scene.add(leg);
      }
    }
  }

  // ---------- trees (per-chunk instancing with near/far detail)
  {
    const hiG = pineGeometry(true), loG = pineGeometry(false);
    const treeM = VC({ roughness: 0.92 });
    const rr = rng(2024);
    const per = new Map();
    const step = Q.treeStep;
    for (let z = 100; z < 1500; z += step) for (let x = -470; x < 470; x += step) {
      const px = x + (rr() - 0.5) * step * 0.9, pz = z + (rr() - 0.5) * step * 0.9;
      const dens = NR(px * 0.008, pz * 0.008) * 0.5 + 0.5 + NR(px * 0.03, pz * 0.03) * 0.25;
      const ax = Math.abs(px);
      const want = ax > 440 ? 0.3 : 0.62;
      if (dens < 1 - want) { rr(); rr(); continue; }
      if (T.clearance(px, pz)) { rr(); rr(); continue; }
      const m = T.masks(px, pz); if (m.g > 0.02) continue;
      const y = H(px, pz);
      const s = 0.65 + rr() * 0.75, rot = rr() * 6.28;
      const cxI = Math.floor((px - B.x0) / CH), czI = Math.floor((pz - B.z0) / CH), key = czI * nx + cxI;
      let a = per.get(key); if (!a) per.set(key, (a = []));
      a.push([px, y - 0.3, pz, s, rot]);
      col.add(px, pz, 0.45 + s * 0.15, 'tree');
    }
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), c = new THREE.Color();
    for (const [key, arr] of per) {
      const ch = out.chunks[key]; if (!ch) continue;
      const hi = new THREE.InstancedMesh(hiG, treeM, arr.length), lo = new THREE.InstancedMesh(loG, treeM, arr.length);
      arr.forEach(([x, y, z, s, rot], i) => {
        q.setFromAxisAngle(_UP, rot); sc.set(s * (0.85 + ((i * 0.37) % 0.3)), s, s * (0.85 + ((i * 0.53) % 0.3))); ps.set(x, y, z);
        mtx.compose(ps, q, sc); hi.setMatrixAt(i, mtx); lo.setMatrixAt(i, mtx);
        c.setHSL(0.36 + ((i * 0.13) % 0.06), 0.25, 0.85 + ((i * 0.29) % 0.3)); hi.setColorAt(i, c); lo.setColorAt(i, c);
      });
      hi.computeBoundingSphere(); lo.computeBoundingSphere();
      hi.castShadow = Q.shadows > 0; hi.receiveShadow = false; lo.castShadow = false;
      scene.add(hi, lo); hi.visible = false;
      ch.hi = hi; ch.lo = lo; out.trees.push(ch);
    }
  }
  progress(0.78, 'Growing the forest…'); await yieldUI();

  // ---------- rocks on the bowl walls and in the trees
  {
    const g = rockGeometry(), rr = rng(99), list = [];
    for (let i = 0; i < 300; i++) {
      const side = rr() < 0.5 ? -1 : 1, onWall = rr() < 0.35;
      const x = onWall ? side * (440 + rr() * 140) : (rr() - 0.5) * 900, z = 60 + rr() * 1440;
      if (!onWall && T.clearance(x, z)) continue;
      const s = onWall ? 3 + rr() * 7 : 0.6 + rr() * 1.4;
      list.push([x, H(x, z) - s * 0.25, z, s, rr() * 6.28]);
      if (!onWall) col.add(x, z, s * 0.9, 'rock');
    }
    const im = new THREE.InstancedMesh(g, VC({ roughness: 0.95 }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach(([x, y, z, sc, rot], i) => { q.setFromEuler(new THREE.Euler(rot * 0.3, rot, 0)); s.set(sc, sc * (0.7 + (i % 5) * 0.1), sc * 1.1); p.set(x, y, z); m.compose(p, q, s); im.setMatrixAt(i, m); });
    im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true; scene.add(im);
  }

  // ---------- distant peaks
  scene.add(buildBackdrop());
  progress(0.84, 'Raising the peaks…'); await yieldUI();

  // ---------- lifts
  for (const d of T.LIFTS) out.lifts.push(new Lift(d, scene, col));

  // ---------- venue: grandstands, crowd, banners, start/finish, fences
  buildVenue(scene, col, out);
  buildGates(scene, col);
  buildSigns(scene);
  buildVillage(scene, col);
  progress(0.95, 'Opening the lifts…'); await yieldUI();
  return out;
}

function overlayMesh(scene, mat, rows, cols, xz, _u, uvf) {
  const cnt = rows * cols, pos = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2), gm = new Float32Array(cnt);
  const nv = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const o = j * cols + i; const [x, z] = xz(j, i);
    pos[o * 3] = x; pos[o * 3 + 1] = H(x, z); pos[o * 3 + 2] = z;
    T.normalAt(x, z, nv, 0.05);
    nrm[o * 3] = nv.x; nrm[o * 3 + 1] = nv.y; nrm[o * 3 + 2] = nv.z;
    const [u, v] = uvf(x, z); uv[o * 2] = u; uv[o * 2 + 1] = v;
    T.masks(x, z); gm[o] = 1;
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    // keep the winding facing up whichever way the grid runs
    const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
    const cr = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cr < 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('groom', new THREE.BufferAttribute(gm, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  return m;
}

function buildBackdrop() {
  const A = 420, R = 44, cx = 0, cz = 840, n1 = makeNoise(5), n2 = makeNoise(6);
  const pos = [], colr = [];
  const B = T.BOUNDS;
  const snowC = new THREE.Color('#eef3f9'), rock = new THREE.Color('#6d6f73'), forest = new THREE.Color('#203327'), shadowSnow = new THREE.Color('#c9d6e6');
  for (let a = 0; a < A; a++) {
    const ang = (a / A) * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
    // where this ray leaves the playable rectangle
    const tx = dx > 0 ? (B.x1 - 4 - cx) / dx : dx < 0 ? (B.x0 + 4 - cx) / dx : 1e9;
    const tz = dz > 0 ? (B.z1 - 4 - cz) / dz : dz < 0 ? (B.z0 + 4 - cz) / dz : 1e9;
    const t0 = Math.min(tx, tz);
    const ix = cx + dx * t0, iz = cz + dz * t0, iy = H(ix, iz) - 1.5;
    for (let k = 0; k < R; k++) {
      const f = k / (R - 1), rad = t0 + Math.pow(f, 1.6) * 7000;
      const x = cx + dx * rad, z = cz + dz * rad;
      const ridge = 1 - Math.abs(n1(x * 0.0007, z * 0.0007)), ridge2 = 1 - Math.abs(n2(x * 0.0019, z * 0.0019));
      const amp = sstep(0, 0.25, f) * (1 - 0.5 * sstep(0.7, 1, f));
      const valley = dz > 0.6 ? (1 - 0.65 * sstep(0.6, 1, dz)) : 1; // the valley opens below the resort
      const y = k === 0 ? iy : iy + (ridge * ridge * 1150 + ridge2 * ridge2 * 320) * amp * valley - (dz > 0.6 ? 260 * sstep(0, 0.3, f) * sstep(0.6, 1, dz) : 0);
      pos.push(x, y, z);
    }
  }
  const idx = [];
  for (let a = 0; a < A; a++) for (let k = 0; k < R - 1; k++) {
    const i0 = a * R + k, i1 = ((a + 1) % A) * R + k;
    idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    const ny = nrm.getY(i), y = pos[i * 3 + 1];
    let c;
    if (y < 420 && ny > 0.55) c = forest.clone().lerp(snowC, sstep(300, 420, y) * 0.8);
    else if (ny < 0.5) c = rock.clone().lerp(snowC, sstep(0.3, 0.5, ny) * 0.75);
    else c = snowC.clone().lerp(shadowSnow, (i * 0.37) % 0.3);
    colr.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  const m = new THREE.Mesh(g, VC({ roughness: 0.9 }));
  m.receiveShadow = false;
  return m;
}

function crowdMesh(spots) {
  const body = new THREE.CapsuleGeometry(0.22, 0.6, 3, 8); body.translate(0, 0.55, 0);
  const head = new THREE.SphereGeometry(0.16, 8, 6); head.translate(0, 1.22, 0);
  const g = mergeGeometries([colorGeo(body, '#ffffff'), colorGeo(head, '#e8c4a0')]);
  const im = new THREE.InstancedMesh(g, VC({ roughness: 0.8 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), c = new THREE.Color();
  const pal = ['#d62828', '#f77f00', '#fcbf49', '#003049', '#2a9d8f', '#e9c46a', '#264653', '#7b2ff7', '#111', '#fff', '#1f6feb'];
  spots.forEach(([x, y, z, yaw], i) => { q.setFromAxisAngle(_UP, yaw); p.set(x, y, z); s.setScalar(0.9 + (i % 7) * 0.04); m.compose(p, q, s); im.setMatrixAt(i, m); c.set(pal[(i * 7 + (i >> 2)) % pal.length]); im.setColorAt(i, c); });
  im.computeBoundingSphere(); im.castShadow = false;
  im.userData.base = spots;
  return im;
}

function grandstand(scene, col, x, z, w, rows, yaw, crowd) {
  const geo = [];
  const gy = H(x, z);
  for (let r = 0; r < rows; r++) {
    const d = r * 1.1, hgt = 0.6 + r * 0.7;
    const lx = x + Math.sin(yaw) * d, lz = z + Math.cos(yaw) * d;
    geo.push(boxAt(w, hgt, 1.1, 0, 0, 0, r % 2 ? '#3c4450' : '#4a5361'));
    geo[geo.length - 1].rotateY(yaw); geo[geo.length - 1].translate(lx, gy + hgt / 2 - 0.3, lz);
    for (let i = 0; i < w / 0.75; i++) {
      if ((i * 31 + r * 17) % 9 === 0) continue;
      const ox = -w / 2 + 0.4 + i * 0.75;
      crowd.push([lx + Math.cos(yaw) * ox, gy + hgt - 0.3, lz - Math.sin(yaw) * ox, yaw + Math.PI]);
    }
  }
  const m = new THREE.Mesh(mergeGeometries(geo), VC({ roughness: 0.8 })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  const hw = w / 2 + 1, d = rows * 1.1;
  const cx = x + Math.sin(yaw) * d / 2, cz = z + Math.cos(yaw) * d / 2;
  col.box(cx - Math.max(hw * Math.abs(Math.cos(yaw)), d / 2), cz - Math.max(hw * Math.abs(Math.sin(yaw)), d / 2), cx + Math.max(hw * Math.abs(Math.cos(yaw)), d / 2), cz + Math.max(hw * Math.abs(Math.sin(yaw)), d / 2), gy + rows * 0.7 + 0.5, 'stand');
}

function banner(scene, text, x, z, w, h, bg = '#0d1b2a', fg = '#fff', yaw = 0, up = 0) {
  const tex = textTexture(text, 1024, Math.round(1024 * h / w), bg, fg, 'Bebas Neue', Math.min(150, 1024 * h / w * 0.6));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
  m.position.set(x, H(x, z) + h / 2 + up, z); m.rotation.y = yaw; m.castShadow = true; scene.add(m);
  return m;
}
function arch(scene, col, text, x, z, w, bg) {
  const gy = H(x, z), geo = [];
  geo.push(boxAt(0.5, 5, 0.5, x - w / 2, gy + 2.5, z, '#e6e9ee'), boxAt(0.5, 5, 0.5, x + w / 2, gy + 2.5, z, '#e6e9ee'));
  scene.add(new THREE.Mesh(mergeGeometries(geo), VC()));
  const b = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, 1.4), new THREE.MeshStandardMaterial({ map: textTexture(text, 1024, 140, bg, '#fff', 'Bebas Neue', 110), side: THREE.DoubleSide, roughness: 0.6 }));
  b.position.set(x, gy + 5.2, z); b.rotation.y = Math.PI; scene.add(b);
  col.add(x - w / 2, z, 0.4, 'pole'); col.add(x + w / 2, z, 0.4, 'pole');
}
function fence(scene, pts, h = 1.1) {
  // orange safety netting on poles
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.strokeStyle = '#ff6a13'; x.lineWidth = 7; x.beginPath(); x.moveTo(0, 32); x.lineTo(32, 0); x.lineTo(64, 32); x.lineTo(32, 64); x.closePath(); x.stroke();
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  const pos = [], uv = [], idx = [];
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const [px, pz] = pts[i]; const y = H(px, pz);
    if (i) L += Math.hypot(px - pts[i - 1][0], pz - pts[i - 1][1]);
    pos.push(px, y, pz, px, y + h, pz); uv.push(L / 0.5, 0, L / 0.5, h / 0.5);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  tex.repeat.set(1, 1);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, roughness: 0.8 }));
  scene.add(m);
}

function buildVenue(scene, col, out) {
  const P = T.PIPE, crowd = [];
  // superpipe: stands at the bottom, banners down the decks, start shack at the top
  grandstand(scene, col, P.x - P.half - P.deckW - 4, P.z1 - 50, 30, 6, -Math.PI / 2, crowd);
  grandstand(scene, col, P.x + P.half + P.deckW + 4, P.z1 - 50, 30, 6, Math.PI / 2, crowd);
  for (let z = P.z0 + 30; z < P.z1 - 20; z += 28) {
    for (const sd of [-1, 1]) banner(scene, sd > 0 ? 'WINTER GAMES' : 'SUPERPIPE', P.x + sd * (P.half + P.deckW + 0.4), z, 7, 1.0, sd > 0 ? '#0d1b2a' : '#b8202a', '#fff', Math.PI / 2, 0.1);
  }
  fence(scene, [[P.x - P.half - P.deckW - 1, P.z0], [P.x - P.half - P.deckW - 1, P.z1 + 10]]);
  fence(scene, [[P.x + P.half + P.deckW + 1, P.z0], [P.x + P.half + P.deckW + 1, P.z1 + 10]]);
  banner(scene, 'DROP IN', P.x, P.z0 - 10, 6, 1.2, '#b8202a', '#fff', Math.PI, 2.6);
  // big air: stands either side of the landing, a judges tower
  const BA = T.BIGAIR;
  grandstand(scene, col, BA.x - 23, BA.z + 34, 34, 7, -Math.PI / 2, crowd);
  grandstand(scene, col, BA.x + 23, BA.z + 34, 34, 7, Math.PI / 2, crowd);
  banner(scene, 'BIG AIR', BA.x, BA.zStart - 8, 7, 1.4, '#0d1b2a', '#ffd166', Math.PI, 2.8);
  {
    const gx = BA.x + 26, gz = BA.z + 66, gy = H(gx, gz);
    scene.add(new THREE.Mesh(mergeGeometries([boxAt(4, 6, 4, gx, gy + 3, gz, '#3a404a'), boxAt(4.6, 0.4, 4.6, gx, gy + 6.2, gz, '#f2f5f8'), boxAt(4.2, 1.4, 0.1, gx - 0.0, gy + 5.2, gz - 2.05, '#1b2a3a')]), VC()));
    col.box(gx - 2.2, gz - 2.2, gx + 2.2, gz + 2.2, gy + 7, 'tower');
  }
  // slopestyle: start gate and finish
  arch(scene, col, 'SLOPESTYLE START', T.SLOPE.x, T.SLOPE.zStart - 4, 14, '#0d1b2a');
  arch(scene, col, 'FINISH', T.SLOPE.x, T.SLOPE.zFinish, 40, '#b8202a');
  grandstand(scene, col, T.SLOPE.x - 36, T.SLOPE.zFinish - 26, 30, 5, -Math.PI / 2, crowd);
  arch(scene, col, 'JUMP LINE', 4, 712, 22, '#1f6feb');
  arch(scene, col, 'FLOW TRAIL', T.TRAILS[2].cx(96), 96, 18, '#1f6feb');
  const cm = crowdMesh(crowd); scene.add(cm); out.crowd = cm;
}

function buildGates(scene, col) {
  const red = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.6, side: THREE.DoubleSide });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1f4fd6, roughness: 0.6, side: THREE.DoubleSide });
  const pole = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 });
  const pg = new THREE.CylinderGeometry(0.025, 0.025, 1.9, 6);
  const panel = new THREE.PlaneGeometry(1.15, 0.9);
  for (const g of T.GATES) {
    for (const sd of [-1, 1]) {
      const x = g.x + sd * g.w / 2, z = g.z, y = H(x, z);
      for (const o of [-0.6, 0.6]) { const p = new THREE.Mesh(pg, pole); p.position.set(x + o, y + 0.95, z); scene.add(p); }
      const f = new THREE.Mesh(panel, g.color === 'red' ? red : blue); f.position.set(x, y + 1.35, z); scene.add(f);
    }
  }
  arch(scene, col, 'GIANT SLALOM START', T.TRAILS[5].cx(T.GS.zStart), T.GS.zStart, 18, '#0d1b2a');
  arch(scene, col, 'FINISH', T.TRAILS[5].cx(T.GS.zFinish), T.GS.zFinish, 26, '#b8202a');
}

function signTexture(name, diff) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, 512, 160); x.strokeStyle = '#2b2b2b'; x.lineWidth = 8; x.strokeRect(4, 4, 504, 152);
  const cx = 80, cy = 80;
  if (diff === 'green') { x.fillStyle = '#1e9e4a'; x.beginPath(); x.arc(cx, cy, 44, 0, 7); x.fill(); }
  else if (diff === 'blue') { x.fillStyle = '#1f5fd6'; x.fillRect(cx - 42, cy - 42, 84, 84); }
  else if (diff === 'black') { x.fillStyle = '#111'; x.beginPath(); x.moveTo(cx, cy - 52); x.lineTo(cx + 52, cy); x.lineTo(cx, cy + 52); x.lineTo(cx - 52, cy); x.fill(); }
  else { x.fillStyle = '#ff7a00'; roundRectP(x, cx - 50, cy - 34, 100, 68, 14); x.fill(); x.fillStyle = '#fff'; x.font = '40px "Bebas Neue", Impact'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PARK', cx, cy + 2); }
  x.fillStyle = '#1a1a1a'; x.font = '78px "Bebas Neue", Impact, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(name.toUpperCase(), 150, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function roundRectP(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function buildSigns(scene) {
  const post = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.9 });
  for (const t of T.TRAILS) {
    const z = t.z0 + 18, x = t.cx(z) - t.w / 2 - 2, y = H(x, z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6), post); p.position.set(x, y + 1.3, z); scene.add(p);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshStandardMaterial({ map: signTexture(t.name, t.diff), roughness: 0.7, side: THREE.DoubleSide }));
    s.position.set(x + 0.8, y + 2.2, z); s.rotation.y = Math.PI; scene.add(s);
  }
}

function woodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d'), r = rng(8);
  for (let i = 0; i < 16; i++) { x.fillStyle = `hsl(${24 + r() * 8},${40 + r() * 15}%,${26 + r() * 10}%)`; x.fillRect(0, i * 16, 256, 16); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, i * 16 + 14, 256, 2); }
  for (let i = 0; i < 160; i++) { x.strokeStyle = 'rgba(0,0,0,0.12)'; x.beginPath(); const y = r() * 256; x.moveTo(0, y); x.bezierCurveTo(80, y + r() * 6, 160, y - r() * 6, 256, y); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildVillage(scene, col) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6, emissive: 0xffb35c, emissiveIntensity: 0.55 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95 });
  const houses = [[-40, 1662, 26, 14, 9, 0], [40, 1676, 18, 12, 7, 0.1], [140, 1660, 22, 12, 8, -0.05], [-130, 1650, 14, 10, 6, 0.15], [230, 1650, 14, 10, 6, -0.12], [-210, 1640, 12, 9, 6, 0.2], [-10, 1720, 30, 14, 9, 0]];
  for (const [x, z, w, d, h, yaw] of houses) {
    const y = H(x, z) - 0.4;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood); walls.position.y = h / 2; walls.castShadow = walls.receiveShadow = true; g.add(walls);
    wood.map.repeat.set(2, 2);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.4, d + 0.4), stone); base.position.y = 0.7; g.add(base);
    // gable roof with snow
    const rh = d * 0.45, sh = new THREE.Shape([new THREE.Vector2(-d / 2 - 1.2, 0), new THREE.Vector2(d / 2 + 1.2, 0), new THREE.Vector2(0, rh)]);
    const rg = new THREE.ExtrudeGeometry(sh, { depth: w + 2, bevelEnabled: false }); rg.translate(0, 0, -(w + 2) / 2); rg.rotateY(Math.PI / 2);
    const rm = new THREE.Mesh(rg, roof); rm.position.y = h; rm.castShadow = true; g.add(rm);
    // windows facing the slope
    for (let i = 0; i < Math.floor(w / 3.2); i++) for (let fl = 0; fl < Math.floor(h / 3.4); fl++) {
      const wdw = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.6), glass); wdw.position.set(-w / 2 + 1.8 + i * 3.2, 2.4 + fl * 3.3, -d / 2 - 0.02); wdw.rotation.y = Math.PI; g.add(wdw);
    }
    const ch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2), stone); ch.position.set(w * 0.3, h + rh * 0.6, 0); g.add(ch);
    scene.add(g);
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = Math.abs(c) * w / 2 + Math.abs(s) * d / 2, hz = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
    col.box(x - hx, z - hz, x + hx, z + hz, y + h + rh, 'building');
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshStandardMaterial({ map: textTexture('FRESH TRACKS LODGE', 1024, 160, '#3b2414', '#ffd166', 'Bebas Neue', 120), roughness: 0.7 }));
  sign.position.set(-40, H(-40, 1662) + 10.5, 1662 - 7.2); sign.rotation.y = Math.PI; scene.add(sign);
}

// show near trees in full detail, far ones as simple cones
export function updateLOD(world, cam, nearDist) {
  const d2 = nearDist * nearDist;
  for (const ch of world.trees) {
    const dx = ch.cx - cam.x, dz = ch.cz - cam.z, near = dx * dx + dz * dz < d2;
    ch.hi.visible = near; ch.lo.visible = !near;
  }
}
