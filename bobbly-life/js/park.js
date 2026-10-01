// Bobbly Land theme park (east of Coral Bay, with its own train station):
//  - "The Bobbler": a steel rollercoaster with a chain lift, a big first drop, banked turns, a vertical loop and
//    an airtime hill. Physics are real-ish (gravity + drag), so you feel it slow over the top of the loop.
//  - a giant Ferris wheel with swinging gondolas (jump out at the top if you dare — bring a parachute)
//  - bumper cars under a lit pavilion; the empty ones drive themselves and crash into each other
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, clamp, lerp, textSprite, rand, pick, mergeStatic } from './state.js';
import { heightAt, ZONES } from './terrain.js';
import { addCollider, ramps, LOC } from './world.js';
import { Vehicle, VTYPES } from './vehicles.js';
import { sfx } from './audio.js';

const PK = ZONES.park;
let H0 = 0;
const P = { coaster: null, wheel: null, bumpers: [], bulbs: [] };
G.park = P;
const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0.2 }, o));
const add = (parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; parent.add(o); return o; };

// ---------------------------------------------------------------- ride vehicle types
VTYPES.coaster = { name: 'Rollercoaster', emo: '🎢', price: 0, len: 2.3, wid: 1.8, h: 1.3, wr: 0, max: 40, acc: 0, turn: 0, color: '#e8322a', seats: 2, ride: true, noShop: true, noCrash: true, prompt: '🎢 Ride THE BOBBLER rollercoaster', tip: () => '🎢 Hold on tight! The ride starts in a moment. (E gets off — only do that in the station!)' };
VTYPES.gondola = { name: 'Ferris wheel gondola', emo: '🎡', price: 0, len: 2.4, wid: 2.0, h: 2.4, wr: 0, max: 5, acc: 0, turn: 0, color: '#3fa7ff', seats: 4, ride: true, noShop: true, noCrash: true, prompt: '🎡 Ride the Ferris Wheel', tip: () => '🎡 Enjoy the view! Press E to get off at the bottom (or at the top if you have a parachute...)' };
VTYPES.bumper = { name: 'Bumper Car', emo: '🚗', price: 0, len: 2.3, wid: 1.6, h: 1.2, wr: 0.14, max: 7.5, acc: 10, turn: 2.6, color: '#ff4a6a', seats: 1, bumper: true, custom: true, noShop: true, noCrash: true };

// ---------------------------------------------------------------- rollercoaster
// control points: x, height above the park, z, and an "up" hint (banking / loop)
function coasterPoints() {
  const pts = [], ups = [];
  const p = (x, y, z, up = [0, 1, 0]) => { pts.push(new THREE.Vector3(x, H0 + y, z)); ups.push(new THREE.Vector3(...up).normalize()); };
  p(796, 2.4, -24); p(806, 2.2, -20); p(826, 2.2, -20); p(846, 2.2, -20);     // station
  p(862, 4, -20); p(878, 14, -20); p(896, 27, -20); p(908, 33, -20);           // chain lift
  p(918, 32, -20); p(932, 20, -20); p(944, 6, -22, [0, 1, 0]);                 // the big drop
  p(958, 5, -34, [-0.5, 1, 0]); p(966, 8, -55, [-0.8, 1, 0]); p(961, 11, -78, [-0.6, 1, 0.5]); p(946, 11, -94, [0, 1, 0.7]); // banked turn
  p(930, 6, -100);
  const cx = 914, cy = 13.2, R = 8.6;                                          // vertical loop
  for (let k = 0; k <= 8; k++) {
    const th = k / 8 * Math.PI * 2;
    const x = cx - R * Math.sin(th), y = cy - R * Math.cos(th), z = -100 - 3.2 * (k / 8);
    pts.push(new THREE.Vector3(x, H0 + y, z)); ups.push(new THREE.Vector3(cx - x, cy - y, 0).normalize());
  }
  p(896, 5, -103.2); p(876, 4.5, -103.2);
  p(860, 13, -103.2); p(848, 17, -103.2); p(836, 13, -103.2);                  // airtime hill
  p(818, 5, -102, [0.3, 1, 0]);
  p(800, 6, -94, [0.7, 1, 0]); p(788, 7, -76, [0.8, 1, 0]); p(786, 6, -56, [0.4, 1, 0]); // turn home
  p(788, 4, -38);
  return { pts, ups };
}
function buildCoaster() {
  const { pts, ups } = coasterPoints();
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const L = curve.getLength(), n = Math.round(L / 0.5);
  const S = { curve, L, n, pos: [], T: [], N: [], B: [] };
  for (let i = 0; i < n; i++) {
    const u = i / n, t = curve.getUtoTmapping(u);
    const p = curve.getPoint(t), T = curve.getTangent(t).normalize();
    const f = t * pts.length, a = Math.floor(f) % pts.length, b = (a + 1) % pts.length, k = f - Math.floor(f);
    const up = ups[a].clone().lerp(ups[b], k).normalize();
    const N = up.sub(T.clone().multiplyScalar(up.dot(T))).normalize();
    const B = new THREE.Vector3().crossVectors(N, T).normalize();
    S.pos.push(p); S.T.push(T); S.N.push(N); S.B.push(B);
  }
  // keep the frames from flipping between samples
  for (let i = 1; i < n; i++) if (S.N[i].dot(S.N[i - 1]) < 0) { S.N[i].negate(); S.B[i].negate(); }
  const rail = M('#e8322a', { metalness: 0.6, roughness: 0.3 }), spine = M('#ffcf1a', { metalness: 0.5, roughness: 0.35 }), sup = M('#eef0f2', { metalness: 0.5, roughness: 0.4 });
  const offs = (o1, o2) => new THREE.CatmullRomCurve3(S.pos.map((p, i) => p.clone().addScaledVector(S.B[i], o1).addScaledVector(S.N[i], o2)), true);
  const g = new THREE.Group(); G.scene.add(g);
  for (const sx of [-0.6, 0.6]) add(g, new THREE.TubeGeometry(offs(sx, 0), n, 0.09, 6, true), rail, 0, 0, 0);
  add(g, new THREE.TubeGeometry(offs(0, -0.45), n, 0.2, 8, true), spine, 0, 0, 0);
  // ties and supports
  const ties = [], cols = [];
  for (let i = 0; i < n; i += 3) {
    const p = S.pos[i], N = S.N[i], B = S.B[i], T = S.T[i];
    const m = new THREE.Matrix4().makeBasis(B, N, T).setPosition(p.clone().addScaledVector(N, -0.25));
    const tg = new THREE.BoxGeometry(1.4, 0.12, 0.14); tg.applyMatrix4(m); ties.push(tg);
    if (i % 12 === 0 && N.y > 0.6) {
      const base = heightAt(p.x, p.z), top = p.y - 0.6;
      if (top - base > 1.2) { const c = new THREE.CylinderGeometry(0.18, 0.24, top - base, 8); c.translate(p.x, (top + base) / 2, p.z); cols.push(c); }
    }
  }
  add(g, mergeGeometries(ties), spine, 0, 0, 0);
  if (cols.length) add(g, mergeGeometries(cols), sup, 0, 0, 0);
  // loop supports: two tall legs either side of the loop
  for (const sz of [-104.5, -96]) { const c = new THREE.CylinderGeometry(0.3, 0.4, 22, 8); c.translate(914, H0 + 11, sz); add(g, c, sup, 0, 0, 0); }
  // station platform and roof
  const plat = M('#c9c3b8', { roughness: 0.9 });
  add(g, new THREE.BoxGeometry(44, 2.2, 3.4), plat, 826, H0 + 1.1, -22.6);
  addCollider(804, H0 - 1, -24.3, 848, H0 + 2.2, -20.9);
  ramps.push({ x: 826, z: -28.3, w: 6, l: 8, h: 2.2, a: Math.PI, y0: H0 });
  add(g, new THREE.BoxGeometry(6, 0.3, 8.6), plat, 826, H0 + 1.0, -28.3, Math.atan2(2.2, 8));
  add(g, new THREE.BoxGeometry(46, 0.3, 7), M('#e8322a'), 826, H0 + 6.4, -21.5);
  for (const x of [806, 826, 846]) add(g, new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), sup, x, H0 + 4.3, -24);
  const sign = textSprite('🎢 THE BOBBLER', { size: 64, color: '#ffcf1a', bg: 'rgba(160,20,20,0.95)', scale: 3.4 }); sign.position.set(826, H0 + 8.3, -21.5); g.add(sign);
  // the train of cars
  const cars = [];
  const colors = ['#e8322a', '#ffcf1a', '#3fa7ff'];
  for (let i = 0; i < 3; i++) { const v = new Vehicle('coaster', 826, -20, Math.PI / 2, { id: 'coaster' + i, color: colors[i] }); v.canBoard = () => P.coaster.state === 'load'; cars.push(v); }
  P.coaster = { S, cars, s: 0, v: 0, state: 'load', t: 10, lap: 0, netT: 0, g: 1 };
  const sAt = (x, z) => { let best = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.hypot(S.pos[i].x - x, S.pos[i].z - z); if (d < bd) { bd = d; best = i; } } return best * (L / n); };
  P.coaster.stop = sAt(836, -20); P.coaster.liftA = sAt(860, -20); P.coaster.liftB = sAt(908, -20); P.coaster.st0 = sAt(800, -22); P.coaster.st1 = sAt(848, -20);
  P.coaster.s = P.coaster.stop;
  mergeStatic(g);
  LOC.coaster = { x: 826, z: -30 };
}
function coasterFrame(s, out) {
  const C = P.coaster.S;
  s = ((s % C.L) + C.L) % C.L;
  const f = s / (C.L / C.n), i = Math.floor(f) % C.n, j = (i + 1) % C.n, k = f - Math.floor(f);
  out.p.copy(C.pos[i]).lerp(C.pos[j], k);
  out.T.copy(C.T[i]).lerp(C.T[j], k).normalize();
  out.N.copy(C.N[i]).lerp(C.N[j], k).normalize();
  out.B.crossVectors(out.N, out.T).normalize();
  out.N.crossVectors(out.T, out.B).normalize();
  return out;
}
const FR = { p: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3(), B: new THREE.Vector3() };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function placeCoasterCars() {
  const C = P.coaster;
  C.cars.forEach((v, i) => {
    coasterFrame(C.s - i * 2.6, FR);
    v.pos.copy(FR.p).addScaledVector(FR.N, 0.1);
    _m.makeBasis(new THREE.Vector3().crossVectors(FR.N, FR.T), FR.N, FR.T);
    _q.setFromRotationMatrix(_m);
    _e.setFromQuaternion(_q, 'YXZ');
    v.yaw = _e.y; v.pitch = _e.x; v.roll = _e.z; v.speed = C.v;
    v.quat = (v.quat || new THREE.Quaternion()).copy(_q);
  });
}
function coasterCarMesh(v, body) {
  const c = v.color;
  const paint = M(c, { metalness: 0.35, roughness: 0.3 }), dark = M('#202226'), seat = M('#1c1c22', { roughness: 0.9 }), bar = M('#ffcf1a', { metalness: 0.6 });
  add(body, new THREE.BoxGeometry(1.7, 0.55, 2.2), paint, 0, 0.45, 0);
  add(body, new THREE.BoxGeometry(1.75, 0.35, 0.5), paint, 0, 0.85, 0.95);
  for (const sx of [-0.42, 0.42]) {
    add(body, new THREE.BoxGeometry(0.62, 0.12, 0.7), seat, sx, 0.78, -0.15);
    add(body, new THREE.BoxGeometry(0.62, 0.95, 0.12), seat, sx, 1.2, -0.55);
    add(body, new THREE.BoxGeometry(0.5, 0.06, 0.06), bar, sx, 1.15, 0.25);
    add(body, new THREE.BoxGeometry(0.05, 0.4, 0.05), bar, sx, 0.95, 0.25);
  }
  for (const sx of [-0.6, 0.6]) for (const z of [-0.75, 0.75]) add(body, new THREE.CylinderGeometry(0.16, 0.16, 0.14, 10), dark, sx, 0.05, z, 0, 0, Math.PI / 2);
  v.seats = [[0.42, 0.5, -0.15], [-0.42, 0.5, -0.15]];
  mergeStatic(body);
  v.eyes = v.seats.map(s => [s[0], 1.85, s[2] - 0.05]);
}
function updateCoaster(dt) {
  const C = P.coaster;
  const host = G.net.mode !== 'client';
  const riders = C.cars.some(v => v.occupants.some(Boolean));
  if (host || C.netS === undefined) {
    if (C.state === 'load') {
      C.v = 0; C.s = C.stop;
      C.t -= dt;
      if (C.t <= 0) { C.state = 'run'; C.v = 3.5; C.lap = 0; if (riders) G.toast && G.toast('🎢 Here we go!!', '', 2500); }
    } else {
      coasterFrame(C.s - 2.6, FR);
      const g = 9.81;
      C.v += (-g * FR.T.y - 0.0016 * C.v * C.v - 0.06) * dt;
      const d = ((C.s - C.liftA) % C.S.L + C.S.L) % C.S.L;
      const fromStop = ((C.s - C.stop) % C.S.L + C.S.L) % C.S.L;
      if (fromStop < C.liftA - C.stop && C.v < 3.5) C.v = 3.5;                      // tyres push the train out of the station
      if (d < C.liftB - C.liftA + 9 && C.v < 4) { C.v = 4; if (Math.random() < dt * 6 && G.camera.position.distanceTo(FR.p) < 60) sfx.water(); }   // clack-clack chain lift
      // brakes into the station
      const toStop = ((C.stop - C.s) % C.S.L + C.S.L) % C.S.L;
      if (C.lap > 0 && toStop < 45) { const vT = Math.max(0.6, Math.sqrt(2 * 2.2 * toStop)); if (C.v > vT) C.v = Math.max(vT, C.v - 9 * dt); if (C.v < 1.2) C.v = 1.2; }
      if (C.v < 0.8) C.v = 0.8;
      const before = C.s;
      C.s = (C.s + C.v * dt) % C.S.L;
      if (C.s < before) C.lap++;
      if (C.lap > 0 && toStop < C.v * dt + 0.05) { C.s = C.stop; C.state = 'load'; C.t = 12; C.v = 0; if (riders) G.toast && G.toast('🎢 What a ride! Press E to get off, or stay for another go.', 'money', 5000); }
      if (C.s > C.stop + 5) C.lap = Math.max(C.lap, C.lap);
    }
  } else {
    C.netS = (C.netS + C.netV * dt) % C.S.L;
    let d = C.netS - C.s; if (d > C.S.L / 2) d -= C.S.L; if (d < -C.S.L / 2) d += C.S.L;
    C.v = C.netV; C.s = ((C.s + C.v * dt + d * Math.min(1, dt * 3)) % C.S.L + C.S.L) % C.S.L;
  }
  placeCoasterCars();
  // g-force readout for riders
  const me = C.cars.find(v => v.occupants.includes(G.player));
  if (me) {
    coasterFrame(C.s, FR);
    const k = 1 / Math.max(1, 1 / 0.001);
    const curv = C.v * C.v * 0.06;
    C.g = lerp(C.g, Math.max(0, FR.N.y + curv * 0.12), 0.1);
    G.rideHud = `🎢 ${Math.round(C.v * 3.6)} km/h · ${C.g.toFixed(1)} G · ${Math.round(FR.p.y - H0)} m up`;
    if (C.v > 18 && Math.random() < dt * 2) sfx.whoosh();
    void k;
  }
}

// ---------------------------------------------------------------- Ferris wheel
const WH = { cx: 735, cz: -118, R: 20, n: 14 };
function buildWheel() {
  WH.cy = H0 + 0.35 + 2.9 + WH.R;
  const g = new THREE.Group(); g.position.set(WH.cx, WH.cy, WH.cz); G.scene.add(g);
  const white = M('#f4f6f8', { metalness: 0.5, roughness: 0.35 }), steel = M('#c8ced6', { metalness: 0.7, roughness: 0.3 });
  const rot = new THREE.Group(); g.add(rot);
  for (const sz of [-1.6, 1.6]) {
    add(rot, new THREE.TorusGeometry(WH.R, 0.28, 8, 64), white, 0, 0, sz);
    add(rot, new THREE.TorusGeometry(WH.R * 0.55, 0.16, 8, 48), white, 0, 0, sz);
    for (let i = 0; i < WH.n; i++) {
      const a = i / WH.n * Math.PI * 2;
      const sp = new THREE.CylinderGeometry(0.08, 0.08, WH.R, 6); sp.translate(0, WH.R / 2, 0); sp.rotateZ(a);
      add(rot, sp, steel, 0, 0, sz);
    }
  }
  for (let i = 0; i < WH.n; i++) { const a = i / WH.n * Math.PI * 2; const cb = add(rot, new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), steel, -Math.sin(a) * WH.R, Math.cos(a) * WH.R, 0, Math.PI / 2); void cb; }
  add(rot, new THREE.CylinderGeometry(1.1, 1.1, 3.8, 16), M('#ff4a6a', { metalness: 0.4 }), 0, 0, 0, Math.PI / 2);
  // A-frame legs
  for (const sz of [-3.2, 3.2]) for (const sx of [-1, 1]) {
    const len = Math.hypot(WH.cy - H0, 9);
    const leg = new THREE.CylinderGeometry(0.35, 0.5, len, 10); leg.translate(0, -len / 2, 0); leg.rotateZ(sx * Math.atan2(9, WH.cy - H0));
    add(g, leg, white, 0, 0, sz);
  }
  add(g, new THREE.CylinderGeometry(0.4, 0.4, 7, 10), steel, 0, 0, 0, Math.PI / 2);
  // rim lights (glow at night)
  const bulbM = new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffcc55', emissiveIntensity: 0.2 });
  P.bulbs.push(bulbM);
  const bg = new THREE.SphereGeometry(0.16, 6, 4), bl = [];
  for (const sz of [-1.9, 1.9]) for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; const b = bg.clone(); b.translate(Math.sin(a) * WH.R, Math.cos(a) * WH.R, sz); bl.push(b); }
  add(rot, mergeGeometries(bl), bulbM, 0, 0, 0);
  // boarding deck
  add(G.scene, new THREE.BoxGeometry(8, 0.35, 7), M('#c9c3b8', { roughness: 0.9 }), WH.cx, H0 + 0.17, WH.cz);
  const s = textSprite('🎡 BIG WHEEL', { size: 56, color: '#fff', bg: 'rgba(40,110,200,0.95)', scale: 2.4 }); s.position.set(WH.cx, H0 + 4.5, WH.cz + 5); G.scene.add(s);
  WH.rot = rot;
  mergeStatic(rot); mergeStatic(g, new Set([rot]));
  WH.gond = [];
  const cols = ['#ff4a6a', '#ffcf1a', '#3fa7ff', '#46c25a', '#b46cff', '#ff8a2a', '#2fd0c0'];
  for (let i = 0; i < WH.n; i++) { const v = new Vehicle('gondola', WH.cx, WH.cz, 0, { id: 'gond' + i, color: cols[i % cols.length] }); v.wheelIdx = i; WH.gond.push(v); }
  WH.a = 0;
  P.wheel = WH;
  LOC.ferris = { x: WH.cx, z: WH.cz + 6 };
}
function gondolaMesh(v, body) {
  const paint = M(v.color, { metalness: 0.3, roughness: 0.35 }), white = M('#f4f6f8'), seat = M('#2a2c34', { roughness: 0.9 });
  const glass = M('#bfe6ff', { transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false });
  add(body, new THREE.CylinderGeometry(1.15, 1.0, 0.15, 16), white, 0, 0.05, 0);
  add(body, new THREE.CylinderGeometry(1.15, 1.15, 0.9, 16, 1, true), paint, 0, 0.55, 0).material.side = THREE.DoubleSide;
  add(body, new THREE.CylinderGeometry(1.15, 1.15, 1.1, 16, 1, true), glass, 0, 1.55, 0);
  add(body, new THREE.SphereGeometry(1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint, 0, 2.05, 0);
  add(body, new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6), M('#c8ced6', { metalness: 0.7 }), 0, 2.85, 0);
  for (const z of [-0.6, 0.6]) add(body, new THREE.BoxGeometry(1.5, 0.45, 0.45), seat, 0, 0.32, z);
  v.seats = [[0.42, 0.35, -0.55], [-0.42, 0.35, -0.55], [0.42, 0.35, 0.4], [-0.42, 0.35, 0.4]];
  mergeStatic(body);
  v.eyes = v.seats.map(s => [s[0], 1.75, s[2] - 0.02]);
}
function updateWheel(dt) {
  const host = G.net.mode !== 'client';
  if (host || WH.netA === undefined) WH.a += dt * (Math.PI * 2 / 110);
  else { WH.netA += dt * (Math.PI * 2 / 110); WH.a = lerp(WH.a, WH.netA, Math.min(1, dt * 2)); }
  WH.rot.rotation.z = WH.a;
  for (const v of WH.gond) {
    const a = WH.a + v.wheelIdx / WH.n * Math.PI * 2;
    const px = WH.cx - Math.sin(a) * WH.R, py = WH.cy + Math.cos(a) * WH.R;
    v.pos.set(px, py - 2.9, WH.cz);
    v.yaw = 0; v.pitch = 0; v.roll = Math.sin(G.time * 0.7 + v.wheelIdx) * 0.04; v.speed = 0;
  }
  for (const m of P.bulbs) m.emissiveIntensity = 0.2 + (G.night || 0) * 2.2;
}

// ---------------------------------------------------------------- bumper cars
const AR = { x0: 716, x1: 754, z0: -24, z1: 0 };
function buildBumpers() {
  const cx = (AR.x0 + AR.x1) / 2, cz = (AR.z0 + AR.z1) / 2, w = AR.x1 - AR.x0, d = AR.z1 - AR.z0;
  const g = new THREE.Group(); G.scene.add(g);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#3a3e46'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#454a54'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) x.fillRect(i * 16, j * 16, 16, 16);
  const ft = new THREE.CanvasTexture(c); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(w / 4, d / 4); ft.colorSpace = THREE.SRGBColorSpace;
  add(g, new THREE.BoxGeometry(w, 0.2, d), new THREE.MeshStandardMaterial({ map: ft, metalness: 0.6, roughness: 0.35 }), cx, H0 + 0.1, cz);
  addCollider(AR.x0, H0 - 1, AR.z0, AR.x1, H0 + 0.2, AR.z1);
  // padded fence all round
  const pad = M('#ffcf1a', { roughness: 0.7 });
  for (const [x0, z0, x1, z1] of [[AR.x0 - 0.4, AR.z0 - 0.4, AR.x1 + 0.4, AR.z0], [AR.x0 - 0.4, AR.z1, AR.x1 + 0.4, AR.z1 + 0.4], [AR.x0 - 0.4, AR.z0, AR.x0, AR.z1], [AR.x1, AR.z0, AR.x1 + 0.4, AR.z1]]) {
    add(g, new THREE.BoxGeometry(x1 - x0, 0.8, z1 - z0), pad, (x0 + x1) / 2, H0 + 0.6, (z0 + z1) / 2);
    addCollider(x0, H0, z0, x1, H0 + 1.0, z1);
  }
  // pavilion roof with a light grid
  const roof = M('#e8322a', { roughness: 0.6 });
  add(g, new THREE.BoxGeometry(w + 4, 0.35, d + 4), roof, cx, H0 + 4.8, cz);
  for (const [ox, oz, sx2, sz2] of [[0, -(d + 4) / 2, w + 4.4, 0.3], [0, (d + 4) / 2, w + 4.4, 0.3], [-(w + 4) / 2, 0, 0.3, d + 4.4], [(w + 4) / 2, 0, 0.3, d + 4.4]]) add(g, new THREE.BoxGeometry(sx2, 1.0, sz2), M('#ffffff'), cx + ox, H0 + 5.3, cz + oz);
  const lightM = new THREE.MeshStandardMaterial({ color: '#fffbe0', emissive: '#ffe9a0', emissiveIntensity: 0.6 });
  P.bulbs.push(lightM);
  const lg = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) { const b = new THREE.SphereGeometry(0.14, 6, 4); b.translate(AR.x0 + 2 + i * (w - 4) / 9, H0 + 4.55, AR.z0 + 2 + j * (d - 4) / 5); lg.push(b); }
  add(g, mergeGeometries(lg), lightM, 0, 0, 0);
  for (const [px, pz] of [[AR.x0 - 1.5, AR.z0 - 1.5], [AR.x1 + 1.5, AR.z0 - 1.5], [AR.x0 - 1.5, AR.z1 + 1.5], [AR.x1 + 1.5, AR.z1 + 1.5]]) {
    add(g, new THREE.CylinderGeometry(0.2, 0.2, 4.8, 10), M('#f4f6f8', { metalness: 0.5 }), px, H0 + 2.4, pz);
    addCollider(px - 0.2, H0, pz - 0.2, px + 0.2, H0 + 4.8, pz + 0.2);
  }
  const s = textSprite('💥 BUMPER CARS', { size: 56, color: '#fff', bg: 'rgba(200,30,40,0.95)', scale: 2.4 }); s.position.set(cx, H0 + 7, AR.z0 - 2.2); g.add(s);
  const cols = ['#ff4a6a', '#3fa7ff', '#ffcf1a', '#46c25a', '#b46cff', '#ff8a2a', '#2fd0c0', '#ff6fd0'];
  for (let i = 0; i < 8; i++) {
    const v = new Vehicle('bumper', AR.x0 + 4 + (i % 4) * 9, AR.z0 + 6 + Math.floor(i / 4) * 12, rand(0, 6.28), { id: 'bump' + i, color: cols[i] });
    v.aiDriven = true; v.ai = { t: rand(0, 2), steer: 0, thr: 1 };
    P.bumpers.push(v);
  }
  LOC.bumper = { x: cx, z: AR.z0 - 3 };
  mergeStatic(g);
}
function bumperMesh(v, body) {
  const paint = M(v.color, { metalness: 0.3, roughness: 0.3 }), rubber = M('#1a1a1e', { roughness: 0.95 }), chrome = M('#d8dde4', { metalness: 0.9, roughness: 0.2 });
  const tb = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.2, 8, 24), rubber); tb.rotation.x = Math.PI / 2; tb.scale.set(0.82, 1.18, 1); tb.position.y = 0.3; body.add(tb);
  add(body, new THREE.CylinderGeometry(0.85, 0.95, 0.5, 20), paint, 0, 0.42, 0).scale.set(0.82, 1, 1.15);
  add(body, new THREE.BoxGeometry(1.2, 0.55, 0.3), paint, 0, 0.9, -0.75);
  add(body, new THREE.BoxGeometry(1.0, 0.15, 0.7), M('#22242a'), 0, 0.72, -0.2);
  const wheel = add(body, new THREE.TorusGeometry(0.2, 0.04, 6, 14), M('#222'), 0, 1.0, 0.45, -0.9);
  void wheel;
  add(body, new THREE.CylinderGeometry(0.04, 0.04, 3.6, 6), chrome, 0, 2.6, -0.9);
  add(body, new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshStandardMaterial({ color: '#9fe8ff', emissive: '#6fd8ff', emissiveIntensity: 1.5 }), 0, 4.4, -0.9);
  v.seats = [[0, 0.45, -0.2]];
  v.wheels = [];
  mergeStatic(body);
}
function updateBumpers(dt) {
  const host = G.net.mode !== 'client';
  for (const v of P.bumpers) {
    // keep everyone inside the rink
    v.pos.x = clamp(v.pos.x, AR.x0 + 1, AR.x1 - 1); v.pos.z = clamp(v.pos.z, AR.z0 + 1, AR.z1 - 1);
    if (v.driver || v.remoteDriver || !host) continue;
    const a = v.ai;
    a.t -= dt;
    if (a.t <= 0) { a.t = rand(0.8, 2.5); a.steer = rand(-1, 1); a.thr = Math.random() < 0.15 ? -1 : 1; }
    v.drive(dt, { throttle: a.thr, steer: a.steer, brake: false, up: false, down: false });
  }
}
// bumper on bumper: a springy bounce
export function bumperBounce(a, b) {
  const t = a.speed; a.speed = b.speed * 0.9 - 1.5; b.speed = t * 0.9 - 1.5;
  a.yaw += rand(-0.4, 0.4); b.yaw += rand(-0.4, 0.4);
  if (G.camera && G.camera.position.distanceTo(a.pos) < 40 && Math.random() < 0.6) sfx.boing();
}
G.bumperBounce = bumperBounce;

// ---------------------------------------------------------------- decorations: gate, paths, stalls, balloons
function buildDecor() {
  const g = new THREE.Group(); G.scene.add(g);
  const pave = new THREE.MeshLambertMaterial({ color: '#e6d6b8' });
  const flat = (x0, z0, x1, z1) => add(g, new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0), pave, (x0 + x1) / 2, H0 + 0.03, (z0 + z1) / 2);
  flat(636, -64, 960, -56);          // main avenue from the train station
  flat(731, -100, 739, -60);         // to the Ferris wheel
  flat(731, -56, 739, -26);          // to the bumper cars
  flat(822, -56, 830, -32);          // to the coaster
  // entrance arch
  const red = M('#e8322a'), yel = M('#ffcf1a');
  for (const z of [-67, -53]) { add(g, new THREE.CylinderGeometry(0.6, 0.7, 9, 12), red, 672, H0 + 4.5, z); add(g, new THREE.ConeGeometry(0.9, 1.6, 12), yel, 672, H0 + 9.8, z); addCollider(671.3, H0, z - 0.7, 672.7, H0 + 9, z + 0.7); }
  add(g, new THREE.BoxGeometry(1, 2.2, 15), red, 672, H0 + 8.2, -60);
  for (const sx of [-1, 1]) { const s = textSprite('✨ BOBBLY LAND ✨', { size: 72, color: '#ffcf1a', bg: 'rgba(160,20,20,0.9)', scale: 3.6 }); s.position.set(672 + sx * 0.9, H0 + 8.3, -60); g.add(s); }
  // stalls
  const stall = (x, z, name, col) => {
    add(g, new THREE.BoxGeometry(4, 2.4, 3), M('#f4f1ea'), x, H0 + 1.2, z);
    for (let i = 0; i < 6; i++) add(g, new THREE.BoxGeometry(0.7, 0.15, 3.6), M(i % 2 ? '#ffffff' : col), x - 1.75 + i * 0.7, H0 + 2.9, z + 0.3, -0.25);
    const t = textSprite(name, { size: 40, color: '#fff', bg: col, scale: 1.4 }); t.position.set(x, H0 + 3.8, z + 1.6); g.add(t);
    addCollider(x - 2, H0, z - 1.5, x + 2, H0 + 2.4, z + 1.5);
  };
  stall(770, -48, '🍿 Popcorn', '#e8322a'); stall(790, -48, '🍦 Ice Cream', '#ff6fd0'); stall(770, -72, '🌭 Hot Dogs', '#ff8a2a'); stall(880, -48, '🍭 Candy Floss', '#b46cff');
  // balloon bunches and lamp posts
  const bc = ['#ff4a6a', '#ffcf1a', '#3fa7ff', '#46c25a', '#b46cff'];
  for (const [bx, bz] of [[700, -50], [760, -66], [850, -66], [930, -52]]) {
    for (let i = 0; i < 7; i++) {
      const bp = new THREE.Vector3(bx + rand(-0.8, 0.8), H0 + 3.5 + rand(0, 1.4), bz + rand(-0.8, 0.8));
      add(g, new THREE.SphereGeometry(0.42, 12, 10), M(pick(bc), { roughness: 0.25 }), bp.x, bp.y, bp.z).scale.y = 1.2;
    }
    add(g, new THREE.CylinderGeometry(0.02, 0.02, 3.5, 4), M('#ddd'), bx, H0 + 1.75, bz);
  }
  for (let x = 690; x < 960; x += 30) for (const z of [-68, -52]) {
    add(g, new THREE.CylinderGeometry(0.08, 0.1, 4, 8), M('#2a2c34', { metalness: 0.6 }), x, H0 + 2, z);
    const bulb = add(g, new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe08a', emissiveIntensity: 0.3 }), x, H0 + 4.2, z);
    P.bulbs.push(bulb.material);
  }
  LOC.themePark = { x: 676, z: -60 };
  mergeStatic(g);
  LOC.parkGate = { x: 680, z: -60 };
}

// ---------------------------------------------------------------- init / update / sync
(G.railMesh ||= {}).coaster = coasterCarMesh;
G.railMesh.gondola = gondolaMesh;
G.railMesh.bumper = bumperMesh;
G.rideDrive = () => {};                      // ride cars ignore driving input
export function initPark() {
  H0 = PK.h;
  buildCoaster();
  buildWheel();
  buildBumpers();
  buildDecor();
  (G.mapExtras ||= []).push((x, W) => { x.font = '13px sans-serif'; x.textAlign = 'center'; x.fillText('🎢', W(880), W(-60)); x.fillText('🎡', W(WH.cx), W(WH.cz)); });
}
let netT = 0;
export function updatePark(dt) {
  G.rideHud = null;
  updateCoaster(dt);
  updateWheel(dt);
  updateBumpers(dt);
  if (G.net.mode === 'host') {
    netT -= dt;
    if (netT <= 0) { netT = 1; const C = P.coaster; G.netSend && G.netSend({ t: 'rides', co: [+C.s.toFixed(2), +C.v.toFixed(2), C.state, +C.t.toFixed(1)], fw: +WH.a.toFixed(3) }); }
  }
}
export function onRidesNet(m) {
  const C = P.coaster;
  C.netS = m.co[0]; C.netV = m.co[1]; C.state = m.co[2]; C.t = m.co[3];
  if (WH.netA === undefined) WH.a = m.fw;
  WH.netA = m.fw;
}
