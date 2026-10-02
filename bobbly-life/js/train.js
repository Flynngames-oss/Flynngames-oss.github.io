// Bobbly Rail: a passenger train that runs on a loop around the island, stopping at stations.
// Hop on at any platform (E next to a carriage) and ride, or get in the front cab and drive it yourself
// (W/S power & brake, Q horn). When nobody drives, it runs the timetable on its own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, clamp, lerp, WATER_Y, textSprite, mergeStatic } from './state.js';
import { heightAt, editGrid } from './terrain.js';
import { addCollider, ramps, LOC } from './world.js';
import { Vehicle, VTYPES } from './vehicles.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------- the route (x, z). Stations sit on straight, axis-aligned stretches.
const WP = [
  [190, -250], [130, -250], [70, -250], [10, -250], [-50, -250],          // Bobbly Central (east-west)
  [-130, -330], [-192, -472], [-290, -512],
  [-420, -510], [-540, -510], [-600, -510], [-660, -510], [-780, -510],    // Mega City (east-west)
  [-960, -505], [-1085, -420],
  [-1105, -260], [-1105, -150], [-1105, -90], [-1105, -30], [-1105, 80],   // West Beach (north-south)
  [-1100, 230], [-1060, 360], [-960, 435],
  [-920, 440], [-870, 440], [-835, 440], [-800, 440], [-760, 440],         // Lakeside (east-west, then a bridge over the lake)
  [-640, 442], [-520, 445], [-440, 490], [-300, 485], [-150, 472], [0, 465], [150, 460],
  [240, 458], [300, 458], [360, 458], [420, 458], [480, 458],              // Sunny Suburbs (east-west)
  [640, 440], [700, 300], [706, 160],
  [632, 60], [630, -10], [630, -60], [630, -110], [632, -170],             // Bobbly Land (north-south)
  [650, -240], [655, -300], [655, -340],                                     // Space Center (north-south)
  [640, -400], [520, -405], [380, -380], [270, -300],
];
export const STATIONS = [
  { name: 'Bobbly Central', x: 70, z: -250, axis: 'x', side: -1 },
  { name: 'Mega City', x: -600, z: -510, axis: 'x', side: 1 },
  { name: 'West Beach', x: -1105, z: -90, axis: 'z', side: 1 },
  { name: 'Lakeside', x: -835, z: 440, axis: 'x', side: 1 },
  { name: 'Sunny Suburbs', x: 360, z: 458, axis: 'x', side: 1 },
  { name: 'Bobbly Land', x: 630, z: -60, axis: 'z', side: 1 },
  { name: 'Space Center', x: 655, z: -300, axis: 'z', side: -1 },
];
const STEP = 2;
const curve = new THREE.CatmullRomCurve3(WP.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
const LEN = curve.getLength();
const N = Math.round(LEN / STEP);
const PX = new Float32Array(N), PZ = new Float32Array(N), PY = new Float32Array(N), TERR = new Float32Array(N);
{
  const pts = curve.getSpacedPoints(N);
  for (let i = 0; i < N; i++) { PX[i] = pts[i].x; PZ[i] = pts[i].z; }
}
const ds = LEN / N;
// grid of track samples for fast "is this near the railway?" checks (keeps trees and rocks off the line)
const CELL = 20, grid = new Map();
for (let i = 0; i < N; i++) { const k = Math.floor(PX[i] / CELL) * 1000 + Math.floor(PZ[i] / CELL); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
export function nearTrack(x, z, r = 6) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = grid.get((cx + a) * 1000 + cz + b); if (!l) continue;
    for (const i of l) if (Math.abs(PX[i] - x) < r && Math.abs(PZ[i] - z) < r) return true;
  }
  for (const st of STATIONS) if (Math.abs(st.x - x) < (st.axis === 'x' ? 50 : 14) && Math.abs(st.z - z) < (st.axis === 'z' ? 50 : 14)) return true;
  return false;
}
G.keepOut = (x, z) => nearTrack(x, z, 7);
const wrap = (i) => ((i % N) + N) % N;
const wrapS = (s) => ((s % LEN) + LEN) % LEN;
function sampleIndex(x, z) { let best = 0, bd = 1e18; for (let i = 0; i < N; i++) { const d = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2; if (d < bd) { bd = d; best = i; } } return best; }

// point on the track at arc-length s
const out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
export function trackAt(s) {
  s = wrapS(s);
  const f = s / ds, i = Math.floor(f), t = f - i, j = wrap(i + 1);
  out.x = PX[i] + (PX[j] - PX[i]) * t; out.z = PZ[i] + (PZ[j] - PZ[i]) * t; out.y = PY[i] + (PY[j] - PY[i]) * t;
  const a = wrap(i - 2), b = wrap(i + 3);
  out.yaw = Math.atan2(PX[b] - PX[a], PZ[b] - PZ[a]);
  out.pitch = -Math.atan2(PY[b] - PY[a], ds * 5);
  return out;
}

// ---------------------------------------------------------------- heights: smooth enough for a train (bridges over water and valleys, tunnels through hills)
function computeHeights() {
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) { TERR[i] = heightAt(PX[i], PZ[i]); raw[i] = Math.max(TERR[i], WATER_Y + 5.5); }
  let a = raw;
  const box = (src, w) => { const o = new Float32Array(N); let acc = 0; for (let k = -w; k <= w; k++) acc += src[wrap(k)]; for (let i = 0; i < N; i++) { o[i] = acc / (2 * w + 1); acc += src[wrap(i + w + 1)] - src[wrap(i - w)]; } return o; };
  a = box(a, 30); a = box(a, 18);
  // stations sit on level ground
  for (const st of STATIONS) {
    st.i = sampleIndex(st.x, st.z); st.s = st.i * ds;
    let m = 0, n = 0; for (let k = -22; k <= 22; k++) { m += a[wrap(st.i + k)]; n++; }
    m /= n; st.y = m;
    for (let k = -30; k <= 30; k++) { const w = clamp((Math.abs(k) - 22) / 8, 0, 1); a[wrap(st.i + k)] = lerp(m, a[wrap(st.i + k)], w); }
  }
  // gentle gradients (max ~3.5%)
  const g = 0.035 * ds;
  for (let it = 0; it < 4; it++) {
    for (let i = 1; i < N * 2; i++) { const p = a[wrap(i - 1)], c = wrap(i); a[c] = clamp(a[c], p - g, p + g); }
    for (let i = N * 2; i > 0; i--) { const p = a[wrap(i + 1)], c = wrap(i); a[c] = clamp(a[c], p - g, p + g); }
  }
  for (let i = 0; i < N; i++) PY[i] = a[i] + 0.35;
  for (const st of STATIONS) st.y = PY[st.i];
}

// ---------------------------------------------------------------- track meshes
function ribbon(off0, off1, y0, y1, keep) {
  // a strip running along the track between two side offsets, top at track height + y
  const pos = [], idx = [];
  let k = 0;
  for (let i = 0; i <= N; i++) {
    const c = wrap(i), a = wrap(i - 1), b = wrap(i + 1);
    let tx = PX[b] - PX[a], tz = PZ[b] - PZ[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const sx = tz, sz = -tx;
    pos.push(PX[c] + sx * off0, PY[c] + y0, PZ[c] + sz * off0, PX[c] + sx * off1, PY[c] + y1, PZ[c] + sz * off1);
    if (i > 0 && keep(wrap(i - 1))) idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    k += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function ballastTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#7a7268'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { const v = 70 + Math.random() * 90; x.fillStyle = `rgb(${v},${v - 6},${v - 12})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 3, 2 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildTrack() {
  const scene = G.scene;
  const all = () => true;
  const elevated = (i) => PY[i] - TERR[i] > 2.4 || TERR[i] < WATER_Y;
  const buried = (i) => TERR[i] - PY[i] > 5;
  // ballast bed (sides slope down), steel rails, concrete viaduct decks
  const bal = ribbon(-2.1, 2.1, -0.12, -0.12, all);
  const uv = new Float32Array(bal.attributes.position.count * 2);
  for (let i = 0; i < uv.length / 4; i++) { uv.set([0, i * ds / 4, 1, i * ds / 4], i * 4); }
  bal.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const balMat = new THREE.MeshLambertMaterial({ map: ballastTexture() });
  const balMesh = new THREE.Mesh(bal, balMat); balMesh.receiveShadow = true; scene.add(balMesh);
  for (const sd of [-1, 1]) scene.add(new THREE.Mesh(ribbon(sd * 2.1, sd * 3.1, -0.12, -0.75, all), balMat));
  const steel = new THREE.MeshStandardMaterial({ color: '#8d9298', metalness: 0.85, roughness: 0.35 });
  for (const off of [-0.75, 0.75]) {
    scene.add(new THREE.Mesh(ribbon(off - 0.04, off + 0.04, 0.17, 0.17, all), steel));
    for (const sd of [-0.04, 0.04]) scene.add(new THREE.Mesh(ribbon(off + sd, off + sd, 0.0, 0.17, all), steel));
  }
  // sleepers
  const n = Math.floor(LEN / 0.75);
  const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.14, 0.26), new THREE.MeshLambertMaterial({ color: '#4e4136' }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let k = 0; k < n; k++) { const t = trackAt(k * 0.75); e.set(t.pitch, t.yaw, 0, 'YXZ'); q.setFromEuler(e); m.compose(p.set(t.x, t.y - 0.02, t.z), q, one); sl.setMatrixAt(k, m); }
  sl.receiveShadow = true; scene.add(sl);
  // viaducts and bridges: deck + pillars
  const conc = new THREE.MeshLambertMaterial({ color: '#b9b4aa' });
  scene.add(new THREE.Mesh(ribbon(-2.6, 2.6, -0.8, -0.8, elevated), conc));
  for (const sd of [-1, 1]) {
    scene.add(new THREE.Mesh(ribbon(sd * 2.6, sd * 2.6, -0.8, 0.5, elevated), conc));
    scene.add(new THREE.Mesh(ribbon(sd * 2.6, sd * 2.6, -0.8, -1.9, elevated), conc));
  }
  const pil = [];
  const pg = new THREE.BoxGeometry(1.6, 1, 2.2);
  for (let i = 0; i < N; i += 7) {
    if (!elevated(i)) continue;
    const top = PY[i] - 1.9, bot = Math.min(TERR[i], WATER_Y - 3) - 1;
    const g = pg.clone(); g.scale(1, top - bot, 1); g.translate(0, (top + bot) / 2, 0);
    const t = trackAt(i * ds); g.rotateY(0); g.applyMatrix4(new THREE.Matrix4().makeRotationY(t.yaw)); g.translate(PX[i], 0, PZ[i]);
    pil.push(g);
  }
  if (pil.length) { const pm = new THREE.Mesh(mergeGeometries(pil), conc); pm.castShadow = true; scene.add(pm); }
  // tunnels: a dark arched tube inside the hill, with stone portals at each end
  const tun = new THREE.MeshLambertMaterial({ color: '#3a3632', side: THREE.DoubleSide });
  const arcs = [];
  for (let a = 0; a < 8; a++) {
    const a0 = Math.PI * a / 8, a1 = Math.PI * (a + 1) / 8;
    arcs.push(ribbon(Math.cos(a0) * 3.3, Math.cos(a1) * 3.3, Math.sin(a0) * 5.2 - 0.3, Math.sin(a1) * 5.2 - 0.3, buried));
  }
  scene.add(new THREE.Mesh(mergeGeometries(arcs), tun));
  const stone = new THREE.MeshLambertMaterial({ color: '#8a8177' });
  for (let i = 0; i < N; i++) {
    if (buried(i) === buried(wrap(i - 1))) continue;
    const t = trackAt(i * ds);
    const g = new THREE.Group(); g.position.set(t.x, t.y, t.z); g.rotation.y = t.yaw; scene.add(g);
    for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 1.6), stone); c.position.set(sx * 4, 3.2, 0); g.add(c); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(9.6, 2, 1.6), stone); top.position.y = 6.6; g.add(top);
  }
  ocTrack.elevated = elevated; ocTrack.buried = buried;
}
const ocTrack = {};

// ---------------------------------------------------------------- stations
function buildStation(st) {
  const scene = new THREE.Group(); G.scene.add(scene);
  const along = st.axis === 'x';
  const t = trackAt(st.s);
  const y = t.y + 0.75;                          // platform top, level with the carriage floor
  const off = 4.4 * st.side;                     // platform centre, beside the track
  const cx = along ? st.x : st.x + off, cz = along ? st.z + off : st.z;
  const L = 74, Wd = 5.4;
  const sx = along ? L : Wd, sz = along ? Wd : L;
  const concrete = new THREE.MeshLambertMaterial({ color: '#c9c3b8' });
  const edge = new THREE.MeshLambertMaterial({ color: '#ffd23a' });
  const gnd = Math.min(heightAt(cx, cz), y - 0.2);
  const base = new THREE.Mesh(new THREE.BoxGeometry(sx, y - gnd + 0.5, sz), concrete);
  base.position.set(cx, (y + gnd - 0.5) / 2, cz); base.receiveShadow = true; base.castShadow = true; scene.add(base);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(along ? L : 0.35, 0.02, along ? 0.35 : L), edge);
  strip.position.set(along ? cx : cx - Math.sign(off) * (Wd / 2 - 0.3), y + 0.01, along ? cz - Math.sign(off) * (Wd / 2 - 0.3) : cz); scene.add(strip);
  addCollider(cx - sx / 2, gnd - 1, cz - sz / 2, cx + sx / 2, y, cz + sz / 2);
  // ramps down at both ends
  for (const e of [-1, 1]) {
    const rx = along ? cx + e * (L / 2 + 4) : cx, rz = along ? cz : cz + e * (L / 2 + 4);
    const g0 = heightAt(rx + (along ? e * 4 : 0), rz + (along ? 0 : e * 4));
    const h = y - g0;
    if (h < 0.3) continue;
    const a = along ? (e > 0 ? -Math.PI / 2 : Math.PI / 2) : (e > 0 ? Math.PI : 0);
    ramps.push({ x: rx, z: rz, w: Wd - 0.4, l: 8, h, a, y0: g0 });
    const rm = new THREE.Mesh(new THREE.BoxGeometry(Wd - 0.4, 0.3, Math.hypot(8, h)), concrete);
    rm.position.set(rx, g0 + h / 2 - 0.12, rz); rm.rotation.order = 'YXZ'; rm.rotation.set(-Math.atan2(h, 8), a, 0); scene.add(rm);
  }
  // canopy, benches, lamps, name boards
  const roofM = new THREE.MeshStandardMaterial({ color: '#2f6fd0', roughness: 0.5, metalness: 0.3 }), pole = new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 0.6, roughness: 0.4 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(along ? 40 : 3.8, 0.25, along ? 3.8 : 40), roofM);
  roof.position.set(cx, y + 3.6, cz); roof.castShadow = true; scene.add(roof);
  for (let k = -2; k <= 2; k++) {
    const px = along ? cx + k * 9 : cx, pz = along ? cz : cz + k * 9;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8), pole); c.position.set(px, y + 1.8, pz); scene.add(c);
    if (k % 2 === 0) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(along ? 2 : 0.5, 0.45, along ? 0.5 : 2), new THREE.MeshLambertMaterial({ color: '#7a4a2a' }));
      b.position.set(px + (along ? 2.5 : 0.8 * Math.sign(off)), y + 0.45, pz + (along ? 0.8 * Math.sign(off) : 2.5)); scene.add(b);
    }
  }
  for (const k of [-1, 1]) {
    const s = textSprite('🚉 ' + st.name, { size: 52, color: '#fff', bg: 'rgba(25,60,140,0.95)', scale: 2.1, accent: '#ffd23a' });
    s.position.set(along ? cx + k * 16 : cx, y + 4.6, along ? cz : cz + k * 16); scene.add(s);
  }
  st.board = { x: cx, z: cz, y };
  LOC['stn_' + st.name] = { x: cx, z: cz };
  mergeStatic(scene);
}

// ---------------------------------------------------------------- rolling stock models
const LIVERY = { body: '#f4f4f2', stripe: '#d8262f', nose: '#ffcf1a', dark: '#22262c', glass: '#26323c' };
function carMesh(v, body, loco) {
  const L = v.type.len, Wd = 2.9, floor = 1.1, H = 2.65;
  const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.45, metalness: 0.15 }, o));
  const white = M(LIVERY.body), red = M(LIVERY.stripe), dark = M(LIVERY.dark), glass = M('#9fc4d8', { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.4, depthWrite: false });
  const box = (m, x, y, z, w, h, d, parent = body) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const len = loco ? L - 3 : L - 0.6, z0 = loco ? -1.5 : 0;
  // floor, underframe, roof
  box(dark, 0, floor - 0.25, z0, Wd - 0.2, 0.5, len);
  box(white, 0, floor + 0.02, z0, Wd, 0.06, len);
  const roofShape = new THREE.Shape(); roofShape.moveTo(-Wd / 2, 0); roofShape.quadraticCurveTo(-Wd / 2, 0.55, 0, 0.6); roofShape.quadraticCurveTo(Wd / 2, 0.55, Wd / 2, 0); roofShape.lineTo(-Wd / 2, 0);
  const rg = new THREE.ExtrudeGeometry(roofShape, { depth: len, bevelEnabled: false }); rg.translate(0, floor + H, z0 - len / 2);
  const rm = new THREE.Mesh(rg, M('#d9dadc')); rm.castShadow = true; body.add(rm);
  // sides: solid below the windows, glass band, thin band above; red stripe
  for (const sx of [-1, 1]) {
    box(white, sx * (Wd / 2 - 0.05), floor + 0.55, z0, 0.1, 1.1, len);
    box(red, sx * (Wd / 2 - 0.02), floor + 0.95, z0, 0.06, 0.22, len);
    box(white, sx * (Wd / 2 - 0.05), floor + H - 0.25, z0, 0.1, 0.5, len);
    box(glass, sx * (Wd / 2 - 0.05), floor + 1.65, z0, 0.06, 1.0, len);
    const nWin = Math.floor(len / 2.1);
    for (let k = 0; k <= nWin; k++) box(white, sx * (Wd / 2 - 0.05), floor + 1.65, z0 - len / 2 + k * len / nWin, 0.12, 1.0, 0.22);
    if (!loco) for (const dz of [-len / 2 + 1.6, len / 2 - 1.6]) { box(M('#c8ccd2'), sx * (Wd / 2 - 0.01), floor + 1.15, dz, 0.05, 2.25, 1.3); box(M('#ffcf1a'), sx * (Wd / 2), floor + 1.15, dz, 0.03, 2.3, 0.08); }
  }
  // ends and gangway bellows
  for (const e of loco ? [-1] : [-1, 1]) {
    box(white, 0, floor + H / 2, z0 + e * len / 2, Wd, H, 0.1);
    box(dark, 0, floor + H / 2, z0 + e * (len / 2 + 0.25), 1.4, 2.4, 0.5);
  }
  // seats inside (blue moquette) so you can see people riding
  const seatM = M('#2f4fa8', { roughness: 0.9 });
  v.seats = [];
  if (loco) {
    v.seats.push([0.55, floor + 0.25, L / 2 - 3.6], [-0.55, floor + 0.25, L / 2 - 3.6]);
    box(dark, 0, floor + 0.55, L / 2 - 2.6, 2.4, 0.9, 0.6);
    for (const s of v.seats) { box(seatM, s[0], floor + 0.3, s[2] - 0.15, 0.6, 0.12, 0.6); box(seatM, s[0], floor + 0.7, s[2] - 0.45, 0.6, 0.75, 0.12); }
  } else {
    for (const z of [5.4, 3.0, 0.6, -1.8, -4.2]) for (const sx of [-0.75, 0.75]) {
      v.seats.push([sx, floor + 0.25, z]);
      box(seatM, sx, floor + 0.3, z - 0.15, 0.9, 0.12, 0.6); box(seatM, sx, floor + 0.75, z - 0.45, 0.9, 0.8, 0.14);
    }
  }
  // bogies with wheels
  const wheelM = M('#2a2c30', { metalness: 0.7, roughness: 0.4 });
  v.wheels = [];
  for (const bz of [len / 2 - 2.6, -len / 2 + 2.6]) {
    box(dark, 0, 0.55, z0 + bz, 2.2, 0.35, 2.8);
    for (const wz of [-0.9, 0.9]) for (const sx of [-0.75, 0.75]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 16), wheelM); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.46, z0 + bz + wz); body.add(w); v.wheels.push(w);
    }
  }
  if (loco) {
    // streamlined nose with a big windscreen and headlights
    const ns = new THREE.Shape(); ns.moveTo(-Wd / 2, 0); ns.lineTo(Wd / 2, 0); ns.lineTo(Wd / 2, H * 0.62); ns.quadraticCurveTo(Wd / 2, H + 0.5, 0, H + 0.6); ns.quadraticCurveTo(-Wd / 2, H + 0.5, -Wd / 2, H * 0.62); ns.lineTo(-Wd / 2, 0);
    const nose = new THREE.Group(); nose.position.set(0, floor, L / 2 - 3); body.add(nose);
    const sections = 6;
    for (let k = 0; k < sections; k++) {
      const t0 = k / sections, sc = 1 - Math.pow(t0, 2.2) * 0.75, scy = 1 - Math.pow(t0, 1.4) * 0.68;
      const g = new THREE.ExtrudeGeometry(ns, { depth: 3 / sections + 0.02, bevelEnabled: false });
      const mm = new THREE.Mesh(g, k < 2 ? white : M(LIVERY.nose)); mm.scale.set(sc, scy, 1); mm.position.z = t0 * 3; mm.castShadow = true; nose.add(mm);
    }
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.1), M('#1d2a36', { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ws.position.set(0, H * 0.75, 1.15); ws.rotation.x = -0.75; nose.add(ws);
    for (const sx of [-0.85, 0.85]) {
      const hl = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff4c0', emissiveIntensity: 1.6 }));
      hl.position.set(sx * 0.6, 0.55, 2.6); nose.add(hl);
    }
    box(red, 0, floor + 0.95, L / 2 - 1.6, Wd * 0.8, 0.22, 2.6);
    // pantograph
    box(dark, 0, floor + H + 0.7, -2, 1.6, 0.08, 0.1); box(dark, 0, floor + H + 0.45, -2.4, 0.08, 0.5, 0.8);
    const name = textSprite('BOBBLY EXPRESS', { size: 40, color: '#d8262f', bg: null, scale: 1.4 });
    name.position.set(0, floor + 3.7, -2); body.add(name);
  }
  v.eyes = v.seats.map(s => [s[0], s[1] + 1.41, s[2] - 0.02]);
  mergeStatic(body, new Set(v.wheels));
}

// ---------------------------------------------------------------- the train
const TR = { s: 0, v: 0, cars: [], state: 'run', dwell: 0, next: 0, lastStation: -1, hornT: 0, netT: 0 };
G.train = TR;
VTYPES.loco = { name: 'Bobbly Express', emo: '🚆', price: 0, len: 15, wid: 3, h: 4.3, wr: 0.46, max: 34, acc: 1.4, turn: 0, color: '#f4f4f2', seats: 2, rail: true, noShop: true, noCrash: true, prompt: '🚆 Drive the train', tip: (seat) => seat === 0 ? '🚆 You\'re driving the Bobbly Express! W power · S brake · Q horn · stop at the platforms · E get out' : '🚆 Riding up front! Press E to get off.' };
VTYPES.carriage = { name: 'Train carriage', emo: '🚃', price: 0, len: 16, wid: 3, h: 4.3, wr: 0.46, max: 34, acc: 1, turn: 0, color: '#f4f4f2', seats: 10, rail: true, noShop: true, noCrash: true, prompt: '🚃 Board the train', tip: () => '🚆 All aboard! The train stops at every station (see the map). Press E to get off.' };
(G.railMesh ||= {}).loco = (v, body) => carMesh(v, body, true);
G.railMesh.carriage = (v, body) => carMesh(v, body, false);

function placeCars() {
  let off = 0;
  for (const c of TR.cars) {
    const half = c.type.len / 2;
    const f = trackAt(TR.s - off - half * 0.55), fx = f.x, fy = f.y, fz = f.z;
    const b = trackAt(TR.s - off - half * 1.45);
    c.pos.set((fx + b.x) / 2, (fy + b.y) / 2, (fz + b.z) / 2);
    c.yaw = Math.atan2(fx - b.x, fz - b.z);
    c.pitch = -Math.atan2(fy - b.y, Math.hypot(fx - b.x, fz - b.z));
    c.roll = 0; c.speed = TR.v; c.moveYaw = c.yaw;
    c.mesh.visible = true;
    off += c.type.len + 0.6;
  }
}
// Shape the real ground to the railway: dig cuttings through hills and pile embankments over dips, so the
// train never runs inside the terrain. Only water and deep valleys keep bridges.
function prepareGround() {
  computeHeights();
  const bridge = (i) => TERR[i] < WATER_Y + 0.3 || PY[i] - TERR[i] > 10;
  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let bi = -1, bd = 1e9;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const l = grid.get((cx + a) * 1000 + cz + b); if (!l) continue;
      for (const i of l) { const d = Math.hypot(PX[i] - x, PZ[i] - z); if (d < bd) { bd = d; bi = i; } }
    }
    return [bi, bd];
  };
  editGrid((x, z) => { const [i, d] = nearest(x, z); return i >= 0 && d < 46; }, (x, z, h) => {
    const [i, d] = nearest(x, z);
    // stay well clear of bridges (the river or lake must stay open underneath)
    const t = PY[i] - 0.55;
    if (h < t) for (let k = -14; k <= 14; k += 2) if (bridge(wrap(i + k))) return h;   // never fill in under a bridge
    const w = d < 12 ? 1 : 1 - Math.min(1, (d - 12) / 34);
    const s = w * w * (3 - 2 * w);
    return h + (t - h) * s;
  });
  for (let i = 0; i < N; i++) TERR[i] = heightAt(PX[i], PZ[i]);
}
G.onHeights = prepareGround;
export function initTrain() {
  buildTrack();
  STATIONS.forEach(buildStation);
  TR.s = STATIONS[0].s + 30;
  TR.next = 1 % STATIONS.length;
  TR.cars.push(new Vehicle('loco', 0, 0, 0, { id: 'train0' }));
  for (let i = 1; i <= 3; i++) TR.cars.push(new Vehicle('carriage', 0, 0, 0, { id: 'train' + i }));
  for (const c of TR.cars) c.train = TR;
  // the timetable starts at Bobbly Central
  TR.s = STATIONS[0].s + 22; TR.state = 'dwell'; TR.dwell = 8; TR.next = 0; TR.lastStation = 0;
  placeCars();
  G.mapExtras = G.mapExtras || [];
  G.mapExtras.push((x, W) => {
    x.strokeStyle = '#4a3b30'; x.lineWidth = 2.2; x.setLineDash([4, 2]);
    x.beginPath(); for (let i = 0; i <= N; i += 3) { const k = wrap(i); i ? x.lineTo(W(PX[k]), W(PZ[k])) : x.moveTo(W(PX[k]), W(PZ[k])); } x.stroke(); x.setLineDash([]);
    x.font = '12px sans-serif'; x.textAlign = 'center';
    for (const st of STATIONS) x.fillText('🚉', W(st.x), W(st.z));
  });
  (G.mapDots ||= []).push((dot) => dot(TR.cars[0].pos.x, TR.cars[0].pos.z, '#d8262f', 5));
}

// distance along the track from the train to a station's stopping point
function distTo(st) { return wrapS(st.s + 22 - TR.s); }
const STOP_BRAKE = 1.1;
function announce(text) {
  if (TR.cars.some(c => c.occupants.some(o => o && o.isPlayer))) G.toast && G.toast(text, '', 4500);
}
G.railDrive = (v, dt, inp) => {
  if (!v.train) return G.rideDrive && G.rideDrive(v, dt, inp);
  if (v !== TR.cars[0]) return;
  // the player drives: W power, S brake
  TR.driven = true; TR.state = 'run';
  const a = inp.throttle > 0 ? 1.5 * inp.throttle * (1 - TR.v / 34) : inp.throttle < 0 ? -2.6 * -inp.throttle : -0.05;
  TR.v = clamp(TR.v + a * dt, inp.throttle < 0 && TR.v < 0.5 ? -4 : 0, 34);
  if (inp.brake) TR.v = Math.max(0, TR.v - 4 * dt);
  TR.s = wrapS(TR.s + TR.v * dt);
};
export function updateTrain(dt) {
  const loco = TR.cars[0];
  const playerDriving = loco.driver && loco.driver.isPlayer;
  const remote = !!loco.remoteDriver;
  if (!playerDriving) TR.driven = false;
  if (!playerDriving && !remote) {
    if (G.net.mode === 'client' && TR.netS !== undefined) {
      // follow the host's train
      TR.netS = wrapS(TR.netS + TR.netV * dt);
      let d = TR.netS - TR.s; if (d > LEN / 2) d -= LEN; if (d < -LEN / 2) d += LEN;
      TR.v = TR.netV; TR.s = wrapS(TR.s + TR.v * dt + d * Math.min(1, dt * 2));
    } else if (TR.state === 'dwell') {
      TR.v = 0; TR.dwell -= dt;
      if (TR.dwell <= 0) { TR.state = 'run'; TR.next = (TR.lastStation + 1) % STATIONS.length; sfx.honk(); announce(`🚆 Next stop: ${STATIONS[TR.next].name}`); }
    } else {
      // run the timetable: cruise, then brake smoothly into the next platform
      if (TR.next === undefined || TR.next < 0) TR.next = 0;
      const st = STATIONS[TR.next];
      const d = distTo(st);
      if (d > LEN - 60) { /* just left it */ }
      const vStop = Math.sqrt(2 * STOP_BRAKE * Math.max(0, d));
      const vT = Math.min(28, vStop);
      TR.v += clamp(vT - TR.v, -STOP_BRAKE * 1.6 * dt, 1.0 * dt);
      TR.s = wrapS(TR.s + TR.v * dt);
      if (d < 0.6 || (d < 3 && TR.v < 0.4)) {
        TR.s = wrapS(st.s + 22); TR.v = 0; TR.state = 'dwell'; TR.dwell = 14; TR.lastStation = TR.next;
        announce(`🚉 ${st.name} — doors open. Press E to get off.`);
        if (G.camera && G.camera.position.distanceTo(loco.pos) < 120) sfx.present();
      }
    }
  }
  if (playerDriving) {
    // tell the driver where they are
    for (let i = 0; i < STATIONS.length; i++) {
      const st = STATIONS[i], d = distTo(st);
      if (d < 3 && TR.v < 1 && TR.lastStation !== i) { TR.lastStation = i; G.toast && G.toast(`🚉 You stopped at ${st.name}! Perfect.`, 'money'); sfx.present(); }
    }
    if (G.keys && G.keys.KeyQ && TR.hornT <= 0) { TR.hornT = 1.2; sfx.honk(); }
  }
  TR.hornT -= dt;
  placeCars();
  // anything on the line gets knocked flying
  if (Math.abs(TR.v) > 3) loco.hitThings((ch, imp) => G.onRemoteHit && G.onRemoteHit(ch, imp));
  for (const c of TR.cars) c.sync();
  if (G.net.mode !== 'solo') {
    TR.netT -= dt;
    if (TR.netT <= 0) {
      if (playerDriving) { TR.netT = 0.1; G.netSend && G.netSend({ t: 'trn', s: +TR.s.toFixed(2), v: +TR.v.toFixed(2), d: 1 }); }
      else if (G.net.mode === 'host' && !remote) { TR.netT = 1; G.netSend && G.netSend({ t: 'trn', s: +TR.s.toFixed(2), v: +TR.v.toFixed(2), st: TR.state, n: TR.next, ls: TR.lastStation, dw: +TR.dwell.toFixed(1) }); }
    }
  }
}
export function onTrainNet(m) {
  const loco = TR.cars[0];
  if (loco.driver && loco.driver.isPlayer) return;
  if (m.d) { TR.s = m.s; TR.v = m.v; TR.netS = undefined; return; }
  TR.netS = m.s; TR.netV = m.v;
  if (m.st) { TR.state = m.st; TR.next = m.n; TR.lastStation = m.ls; TR.dwell = m.dw; }
}

// handy for tests and the conflict check
export const _dbg = { PX, PY, PZ, TERR, N };
export function trackReport() {
  let tunnel = 0, bridge = 0, maxG = 0;
  for (let i = 0; i < N; i++) {
    if (ocTrack.buried && ocTrack.buried(i)) tunnel += ds;
    if (ocTrack.elevated && ocTrack.elevated(i)) bridge += ds;
    maxG = Math.max(maxG, Math.abs(PY[wrap(i + 1)] - PY[i]) / ds);
  }
  return { len: Math.round(LEN), tunnel: Math.round(tunnel), bridge: Math.round(bridge), maxGrade: +(maxG * 100).toFixed(1), stations: STATIONS.map(s => [s.name, Math.round(s.y)]) };
}
export function trackConflicts(colliders) {
  const hits = new Map();
  for (const c of colliders) {
    if (c.tag === 'tree' || c.off) continue;
    for (let i = 0; i < N; i += 2) {
      if (PX[i] > c.minX - 2 && PX[i] < c.maxX + 2 && PZ[i] > c.minZ - 2 && PZ[i] < c.maxZ + 2 && PY[i] + 4.5 > c.minY && PY[i] < c.maxY - 0.2) {
        const k = `${Math.round(c.minX)},${Math.round(c.minZ)} y${Math.round(c.minY)}-${Math.round(c.maxY)}`;
        if (!hits.has(k)) hits.set(k, [Math.round(PX[i]), Math.round(PZ[i])]);
      }
    }
  }
  return [...hits.entries()].slice(0, 60);
}
export { TR as train };
