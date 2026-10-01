// Drivable vehicles: arcade car physics, ramps launch you, crashes eject you.
import * as THREE from 'three';
import { G, mat, clamp, lerp, angleLerp, WATER_Y, rand, pick } from './state.js';
import { bubbles } from './ocean.js';
import { groundHeight, resolveWalls, baseHeight, getGroundTag, nearColliders } from './world.js';
import { detach, chunk, sparks, smoke, fire, explosion } from './debris.js';
import { sfx } from './audio.js';
import { carModel, truckModel, bikeModel, bikeMaterials, airlinerModel, airlinerMaterials, LIVERY_COUNT, wheelModel, meshesFrom, paintMat, M } from './models.js';

export const VTYPES = {
  sedan:     { name: 'Sedan', emo: '🚗', price: 300, len: 4.8, wid: 2.1, h: 2.0, wr: 0.4, max: 32, acc: 19, turn: 1.9, color: '#3fa7ff', seats: 2 },
  taxi:      { name: 'Taxi', emo: '🚕', price: 400, len: 4.8, wid: 2.1, h: 2.0, wr: 0.4, max: 32, acc: 19, turn: 1.9, color: '#f2c318', seats: 2, taxi: true },
  scooter:   { name: 'Pizza Scooter', emo: '🛵', price: 150, len: 2.0, wid: 0.9, h: 0.7, wr: 0.32, max: 24, acc: 15, turn: 2.5, color: '#e84a3f', seats: 1, open: true, scooter: true },
  sports:    { name: 'Sports Car', emo: '🏎️', price: 1200, len: 4.6, wid: 2.1, h: 1.9, wr: 0.4, max: 48, acc: 30, turn: 2.1, color: '#d81e1e', seats: 2, sports: true },
  pickup:    { name: 'Pickup Truck', emo: '🛻', price: 600, len: 5.6, wid: 2.2, h: 2.35, wr: 0.46, max: 30, acc: 18, turn: 1.7, color: '#6b6f76', seats: 2, bed: true },
  icecream:  { name: 'Ice Cream Van', emo: '🍦', price: 700, len: 5.0, wid: 2.2, h: 2.85, wr: 0.48, max: 25, acc: 14, turn: 1.6, color: '#f6f2ea', seats: 2, van: true },
  garbage:   { name: 'Garbage Truck', emo: '🚛', price: 900, len: 6.6, wid: 2.4, h: 3.0, wr: 0.6, max: 24, acc: 13, turn: 1.4, color: '#2f7a45', seats: 2, bed: true, truck: true },
  police:    { name: 'Police Car', emo: '🚓', price: 1500, len: 4.8, wid: 2.1, h: 2.0, wr: 0.4, max: 40, acc: 24, turn: 2.0, color: '#f4f5f7', seats: 2, siren: true },
  monster:   { name: 'Monster Truck', emo: '🚙', price: 1800, len: 5.6, wid: 2.9, h: 3.3, wr: 1.05, max: 34, acc: 21, turn: 1.8, color: '#2f8a3a', seats: 2 },
  firetruck: { name: 'Fire Truck', emo: '🚒', price: 2500, len: 7.2, wid: 2.5, h: 3.0, wr: 0.6, max: 27, acc: 13, turn: 1.4, color: '#c8161b', seats: 2, truck: true, ladder: true },
  boat:      { name: 'Speed Boat', emo: '🚤', price: 1000, len: 5.0, wid: 2.2, h: 0.9, wr: 0, max: 30, acc: 15, turn: 1.6, color: '#ffffff', seats: 2, boat: true },
  biplane:   { name: 'Biplane', emo: '🛩️', price: 2000, len: 5.4, wid: 1.4, h: 1.6, wr: 0.4, max: 48, acc: 12, turn: 1.3, color: '#ff5b6e', seats: 1, plane: true, takeoff: 16 },
  jet:       { name: 'Jet Plane', emo: '✈️', price: 5000, len: 8.0, wid: 1.6, h: 1.8, wr: 0.4, max: 85, acc: 20, turn: 1.1, color: '#e8eef5', seats: 1, plane: true, takeoff: 26 },
  fighter:   { name: 'Fighter Jet', emo: '🛩️', price: 12000, len: 10, wid: 1.8, h: 2, wr: 0.4, max: 135, acc: 32, turn: 1.6, color: '#7d8791', seats: 1, plane: true, fighter: true, takeoff: 30 },
  airliner:  { name: 'Airliner', emo: '🛫', price: 25000, len: 40, wid: 4.2, h: 7, wr: 0.6, max: 90, acc: 4.0, turn: 0.38, color: '#f4f6f8', seats: 8, plane: true, airliner: true, takeoff: 44 },
  // Electric dirt bikes (original designs)
  eb_shadow:  { name: 'Shadow E-Moto', emo: '🏍️', price: 900, bike: { frame: '#1c1c1e', plastic: '#232326', accent: '#3a3a3e', fork: '#1a1a1a', shock: '#2a2a2a' } },
  eb_stealth: { name: 'Stealth Runner', emo: '🏍️', price: 950, bike: { frame: '#18181a', plastic: '#1c1c1e', accent: '#c83030', fork: '#222', shock: '#c83030' } },
  eb_hornet:  { name: 'Hornet Volt', emo: '🏍️', price: 1200, bike: { frame: '#1a1a1c', plastic: '#1c1c1e', accent: '#e8d830', fork: '#1a1a1a', shock: '#e8d830' } },
  eb_goldfork:{ name: 'Goldfork Pro', emo: '🏍️', price: 1500, bike: { frame: '#16161a', plastic: '#1a1a1e', accent: '#c8a040', fork: '#c8a040', shock: '#c8a040' }, max: 27 },
  eb_sting:   { name: 'Carbon Sting', emo: '🏍️', price: 1400, bike: { frame: '#1f2a24', plastic: '#1f2622', accent: '#3a4a40', fork: '#c8a040', shock: '#222' } },
  eb_limited: { name: 'Hornet Limited', emo: '🏍️', price: 1800, bike: { frame: '#1a1a1c', plastic: '#1c1c1e', accent: '#8a5ad8', fork: '#1a1a1a', shock: '#8a5ad8' }, max: 28 },
  eb_redline: { name: 'Redline Racer', emo: '🏍️', price: 1300, bike: { frame: '#1a1a1c', plastic: '#eeeeee', accent: '#d02828', fork: '#d8d8d8', shock: '#d02828' } },
  eb_blackout:{ name: 'Blackout', emo: '🏍️', price: 1100, bike: { frame: '#0f0f10', plastic: '#141416', accent: '#f0f0f0', fork: '#141416', shock: '#141416' } },
  eb_crimson: { name: 'Crimson Enduro', emo: '🏍️', price: 1400, bike: { frame: '#1a1a1c', plastic: '#d02828', accent: '#1a1a1c', fork: '#e0e0e0', shock: '#d02828' } },
  eb_titan:   { name: 'Titan Gold', emo: '🏍️', price: 2200, bike: { frame: '#141416', plastic: '#18181a', accent: '#c8a040', fork: '#c8a040', shock: '#c8a040', scale: 1.08 }, max: 30, acc: 20 },
  eb_mini:    { name: 'Blackout Mini', emo: '🏍️', price: 600, bike: { frame: '#18181a', plastic: '#1c1c1e', accent: '#555', fork: '#222', shock: '#222', scale: 0.82 }, max: 18, acc: 13 },
  eb_apex:    { name: 'Apex Trail', emo: '🏍️', price: 2000, bike: { frame: '#141416', plastic: '#1a1a1c', accent: '#2a2a2e', fork: '#1a1a1a', shock: '#3a3a3a', scale: 1.12 }, max: 29, acc: 19 },
  heli:      { name: 'Helicopter', emo: '🚁', price: 3000, len: 5.0, wid: 2.2, h: 1.8, wr: 0, max: 40, acc: 18, turn: 1.6, color: '#ff8a3d', seats: 2, heli: true },
  sub:       { name: 'Submarine', emo: '🟡', price: 4500, len: 6.6, wid: 2.6, h: 2.6, wr: 0, max: 12, acc: 4.5, turn: 0.75, color: '#ffc21a', seats: 2, sub: true, noCrash: true },
};

for (const t of Object.values(VTYPES)) if (t.bike) {
  const sc = t.bike.scale || 1;
  Object.assign(t, { len: 2.1 * sc, wid: 0.8, h: 1.1, wr: 0.35 * sc, max: Math.round((t.max || 24) * 1.25), acc: t.acc || 17, turn: 2, color: t.bike.plastic, seats: 1, open: true, isBike: true });
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.CylinderGeometry(1, 1, 1, 14);
WHEEL.rotateZ(Math.PI / 2);
function part(parent, color, x, y, z, sx, sy, sz, geo = BOX, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const CAR_IDS = new Set(['sedan', 'taxi', 'sports', 'police', 'pickup', 'monster']);
// wheel = steering pivot > spinning group > meshes (mirrored on the right side)
function addWheel(v, parent, x, y, z, r, w, style, steer) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z); parent.add(pivot);
  const spin = new THREE.Group(); pivot.add(spin);
  const face = meshesFrom(wheelModel(r, w, style));
  if (x < 0) face.rotation.y = Math.PI;
  spin.add(face);
  v.wheels.push(spin);
  if (steer) (v.steerWheels ||= []).push(pivot);
  return spin;
}
// emergency light bar: each vehicle gets its own materials so they flash independently
function lightbar(parent, y, z, x) {
  const out = [];
  for (const [col, em, sx] of [['#a01010', '#ff0000', 1], ['#1020a0', '#0030ff', -1]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 0.26), new THREE.MeshStandardMaterial({ color: col, emissive: em, emissiveIntensity: 0.1, roughness: 0.2 }));
    m.position.set(sx * x, y, z); parent.add(m); out.push(m);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(x * 2 + 0.6, 0.06, 0.3), M('trim'));
  base.position.set(0, y - 0.08, z); parent.add(base);
  return out;
}

function buildMesh(v) {
  const t = v.type, c = v.color;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  v.wheels = [];
  const L = t.len, W = t.wid, H = t.h, wr = t.wr;
  const base = wr + 0.1;
  const glass = { transparent: true, opacity: 0.55 };
  if (CAR_IDS.has(v.typeId)) {
    const { parts, P } = carModel(v.typeId);
    body.add(meshesFrom(parts, { body: paintMat(c) }));
    const ww = P.raise ? 0.95 : P.sport ? 0.34 : 0.3;
    const style = P.raise ? 'monster' : P.sport ? 'sport' : P.police ? 'truck' : 'alloy';
    const wx = P.raise ? 1.65 : P.W / 2 - ww / 2 - 0.03;
    P.wz.forEach((z, i) => { for (const sx of [-1, 1]) addWheel(v, body, sx * wx, wr, z, wr, ww, style, i === 0); });
    const sy = P.seatY + (P.raise || 0);
    v.seats = [[0.45, sy, P.seatZ], [-0.45, sy, P.seatZ]];
    if (P.rearSeat != null) v.seats.push([0.45, sy + 0.05, P.rearSeat + 0.3], [-0.45, sy + 0.05, P.rearSeat + 0.3]);
    if (t.bed) v.bedZone = { z0: -2.6, z1: -0.5, x: P.W / 2 - 0.25, y: 1.05 + (P.raise || 0) };
    if (t.siren) v.siren = lightbar(body, P.roofY + 0.14, -0.25, 0.34);
  } else if (t.truck || t.van) {
    const tm = truckModel(v.typeId, t);
    body.add(meshesFrom(tm.parts, { body: paintMat(c) }));
    tm.wz.forEach((z, i) => { for (const sx of [-1, 1]) addWheel(v, body, sx * (W / 2 - 0.22), wr, z, wr, 0.4, 'truck', i === 0); });
    const seatZ = tm.cabZ0 + tm.cabL * 0.42, sy = t.van ? 0.85 : 1.0;
    v.seats = [[0.5, sy, seatZ], [-0.5, sy, seatZ]];
    if (t.bed) { const bl = L - 2.4, gz = -L / 2 + bl / 2; v.bedZone = { z0: gz - bl / 2 + 0.25, z1: gz + bl / 2 - 0.25, x: W / 2 - 0.25, y: 1.3 }; }
    if (t.ladder) v.siren = lightbar(body, tm.cabH + 0.1, tm.cabZ0 + 0.5, 0.45);
    if (t.van) {
      part(body, '#f3e2c0', 0, tm.cabH + 0.55, -1.2, 0.45, 0.9, 0.45, new THREE.ConeGeometry(0.6, 1, 12)).rotation.x = Math.PI;
      part(body, '#f4a0c4', 0, tm.cabH + 1.1, -1.2, 0.62, 0.62, 0.62, new THREE.SphereGeometry(0.6, 14, 10));
    }
  } else if (t.airliner) {
    const am = airlinerModel();
    let h = 0; for (const ch of v.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const M8 = airlinerMaterials(v.livery ?? Math.abs(h) % LIVERY_COUNT);
    const fy = am.fy, ey = fy - 2.55 + 6.2 * 0.08;
    const hits = {
      body: [[0, fy, 20.1], [0, fy + 2, 12], [0, fy - 2, 12], [0, fy + 2.4, -8]],
      wingL: [[17.9, fy + 0.2, -8], [11, fy - 0.4, -3.5]], wingR: [[-17.9, fy + 0.2, -8], [-11, fy - 0.4, -3.5]],
      engL: [[6.2, ey - 1.15, 3.2], [6.2, ey, 5.4]], engR: [[-6.2, ey - 1.15, 3.2], [-6.2, ey, 5.4]],
      tail: [[0, fy + 10.8, -16.5], [7, fy + 1.6, -19], [-7, fy + 1.6, -19]],
    };
    v.pieces = {};
    for (const name in am.groups) { const g = meshesFrom(am.groups[name], M8); body.add(g); v.pieces[name] = { g, pts: hits[name], fatal: name === 'body' }; }
    part(body, '#2a2b2e', 0, fy - 0.9, 17.6, 1.9, 0.5, 0.6);
    v.seats = [[0.55, fy - 1.55, 16.4], [-0.55, fy - 1.55, 16.4]];
    for (const z of [10, 7, 4]) v.seats.push([1.0, fy - 1.85, z], [-1.0, fy - 1.85, z]);
  } else if (t.isBike) {
    const B = t.bike, sc = B.scale || 1;
    const bm = bikeModel(sc);
    const bike = new THREE.Group();       // pivot at the rear contact patch (for wheelies)
    bike.position.z = -bm.wb / 2;
    body.add(bike); v.bikeGroup = bike;
    bike.add(meshesFrom(bm.parts, bikeMaterials(B)));
    const mkWheel = (z, parts) => { const w = new THREE.Group(); w.position.set(0, bm.r, z); w.add(meshesFrom(parts)); bike.add(w); v.wheels.push(w); return w; };
    mkWheel(0, bm.wheels[0]); v.frontWheel = mkWheel(bm.wb, bm.wheels[1]);
    v.bikeWb = bm.wb;
    v.seats = [[0, 1.12 * sc - 0.5, (0.5 - 0.65) * sc]];
    v.eyes = [[0, 1.95 * sc, -0.2 * sc]];
  } else if (t.fighter) {
    const grp = (name, pts, fatal = false) => { const g = new THREE.Group(); body.add(g); (v.pieces ||= {})[name] = { g, pts, fatal }; return g; };
    const fus = grp('body', [[0, 1.3, 5.6], [0, 2.1, 1.6]], true), tail = grp('tail', [[1.3, 3.2, -4.2], [-1.3, 3.2, -4.2], [2.4, 1.3, -4.4], [-2.4, 1.3, -4.4]]);
    const grey = '#7d8791', dark = '#3a4048';
    part(fus, grey, 0, 1.3, 0, 1.3, 1.0, 8.5);
    part(fus, grey, 0, 1.15, -1.2, 2.2, 0.7, 4.5);                        // wide rear body
    const nose = part(fus, grey, 0, 1.3, 5.3, 0.62, 2.4, 0.52, new THREE.ConeGeometry(1, 1, 16)); nose.rotation.x = Math.PI / 2;
    part(fus, '#9fd3ff', 0, 1.95, 2.2, 0.8, 0.65, 2.4, new THREE.SphereGeometry(0.5, 16, 10), glass);   // canopy
    for (const sx of [-1, 1]) {
      part(fus, dark, sx * 0.85, 1.05, 1.5, 0.45, 0.6, 2.2);             // intakes
      const wg = grp(sx > 0 ? 'wingL' : 'wingR', [[sx * 4.6, 1.2, -2.6], [sx * 3, 1.2, -1.2]]);
      const sh = new THREE.Shape(); sh.moveTo(0, 2.2); sh.lineTo(sx * 4.6, -2.2); sh.lineTo(sx * 4.6, -3.2); sh.lineTo(0, -3.4); sh.lineTo(0, 2.2);
      const wgGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false }); wgGeo.rotateX(Math.PI / 2);
      const w = new THREE.Mesh(wgGeo, mat(grey)); w.position.set(sx * 0.5, 1.25, 0); w.castShadow = true; wg.add(w);
      part(wg, '#e8e8e8', sx * 3.4, 0.95, -1.0, 0.18, 0.18, 2.4, new THREE.CylinderGeometry(1, 1, 1, 8)).rotation.x = Math.PI / 2;   // missile
      part(wg, '#c02020', sx * 3.4, 0.95, 0.25, 0.12, 0.2, 0.12, new THREE.ConeGeometry(1, 1, 8)).rotation.x = Math.PI / 2;
      const fin = part(tail, grey, sx * 1.1, 2.3, -4.0, 0.12, 1.9, 1.6); fin.rotation.z = -sx * 0.35;
      const st = part(tail, grey, sx * 1.6, 1.25, -4.3, 2.0, 0.1, 1.3); st.rotation.y = -sx * 0.25;
      part(fus, '#ff8a3d', sx * 0.45, 1.2, -4.0, 0.34, 0.34, 0.3, new THREE.CylinderGeometry(1, 1, 1, 12), { emissive: '#ff5500', emissiveIntensity: 0.9 }).rotation.x = Math.PI / 2;
    }
    for (const [x, z] of [[-1.0, -1.2], [1.0, -1.2], [0, 3.6]]) { v.wheels.push(part(fus, '#222', x, 0.4, z, 0.2, 0.4, 0.4, WHEEL)); part(fus, '#4a4f5a', x, 0.65, z, 0.08, 0.5, 0.08); }
    v.seats = [[0, 0.8, 1.9]];
  } else if (t.plane && t.name === 'Biplane') {
    const grp = (name, pts, fatal = false) => { const g = new THREE.Group(); body.add(g); (v.pieces ||= {})[name] = { g, pts, fatal }; return g; };
    const fus = grp('body', [[0, 1.2, 3.1], [0, 1.75, 0]], true), eng = grp('engine', [[0, 1.2, 3.0], [0, 2.4, 2.95], [0, 0, 2.95]]);
    const wl = grp('wingL', [[4.4, 2.4, 0.9], [4.4, 0.75, 0.9]]), wr = grp('wingR', [[-4.4, 2.4, 0.9], [-4.4, 0.75, 0.9]]), tail = grp('tail', [[0, 2.6, -2.4], [1.5, 1.4, -2.3], [-1.5, 1.4, -2.3]]);
    part(fus, c, 0, 1.2, 0, 1.1, 1.1, 5);
    const e = part(eng, '#4a4f5a', 0, 1.2, 2.65, 0.6, 0.4, 0.6, new THREE.CylinderGeometry(1, 1, 1, 12)); e.rotation.x = Math.PI / 2;
    v.prop = new THREE.Group(); v.prop.position.set(0, 1.2, 2.95);
    part(v.prop, '#6b4a2b', 0, 0, 0, 0.18, 2.6, 0.06); part(v.prop, '#6b4a2b', 0, 0, 0, 2.6, 0.18, 0.06);
    eng.add(v.prop);
    for (const [g, sx] of [[wl, 1], [wr, -1]]) {
      part(g, '#ffd54a', sx * 2.3, 0.75, 0.9, 4.5, 0.12, 1.4);
      part(g, '#ffd54a', sx * 2.3, 2.4, 0.9, 4.5, 0.12, 1.4);
      for (const z of [0.4, 1.4]) part(g, '#6b4a2b', sx * 3.2, 1.58, z, 0.08, 1.6, 0.08);
    }
    part(tail, c, 0, 1.4, -2.3, 3, 0.1, 0.8);
    part(tail, c, 0, 2.0, -2.35, 0.1, 1.2, 0.8);
    for (const x of [-0.8, 0.8]) { v.wheels.push(part(fus, '#222', x, 0.4, 1.3, 0.2, 0.4, 0.4, WHEEL)); part(fus, '#4a4f5a', x * 0.7, 0.6, 1.3, 0.08, 0.5, 0.08); }
    part(tail, '#222', 0, 0.2, -2.3, 0.1, 0.2, 0.2, WHEEL);
    part(fus, '#bfe6ff', 0, 1.95, 0.4, 0.9, 0.4, 0.06, BOX, glass);
    v.seats = [[0, 0.9, -0.4]];
  } else if (t.plane) {
    const grp = (name, pts, fatal = false) => { const g = new THREE.Group(); body.add(g); (v.pieces ||= {})[name] = { g, pts, fatal }; return g; };
    const fus = grp('body', [[0, 1.3, 4.6], [0, 2.0, 1.4]], true), tail = grp('tail', [[0, 3.3, -3.1], [2.0, 1.45, -3.4], [-2.0, 1.45, -3.4]]);
    part(fus, c, 0, 1.3, 0, 1.3, 1.2, 7);
    const nose = part(fus, c, 0, 1.3, 4.3, 0.65, 1.6, 0.6, new THREE.ConeGeometry(1, 1, 12)); nose.rotation.x = Math.PI / 2;
    part(fus, '#8fd3ff', 0, 1.95, 1.4, 0.9, 0.7, 2.2, new THREE.SphereGeometry(0.5, 14, 10), glass);
    for (const sx of [-1, 1]) {
      const wg = grp(sx > 0 ? 'wingL' : 'wingR', [[sx * 4.7, 1.15, -1.3], [sx * 3, 1.15, -0.8]]);
      const w = part(wg, '#3fa7ff', sx * 2.6, 1.15, -0.4, 4.4, 0.15, 2.2); w.rotation.y = -sx * 0.35;
      const st = part(tail, '#3fa7ff', sx * 1.1, 1.45, -3.1, 1.8, 0.12, 1); st.rotation.y = -sx * 0.3;
    }
    part(tail, '#3fa7ff', 0, 2.4, -3.1, 0.15, 1.8, 1.4);
    part(fus, '#ff8a3d', 0, 1.3, -3.6, 0.5, 0.5, 0.3, new THREE.CylinderGeometry(1, 1, 1, 12), { emissive: '#ff5500', emissiveIntensity: 0.8 }).rotation.x = Math.PI / 2;
    for (const [x, z] of [[-0.9, -0.5], [0.9, -0.5], [0, 2.8]]) { v.wheels.push(part(fus, '#222', x, 0.4, z, 0.2, 0.4, 0.4, WHEEL)); part(fus, '#4a4f5a', x, 0.65, z, 0.08, 0.5, 0.08); }
    v.seats = [[0, 0.8, 1.2]];
  } else if (t.heli) {
    part(body, c, 0, 1.4, 0.3, 2.0, 1.8, 3.0, new THREE.SphereGeometry(0.5, 16, 12));
    part(body, '#bfe6ff', 0, 1.6, 1.3, 1.6, 1.2, 1.2, new THREE.SphereGeometry(0.5, 14, 10), glass);
    part(body, c, 0, 1.6, -2.4, 0.35, 0.35, 3.2);
    part(body, c, 0, 2.2, -3.9, 0.12, 1.2, 0.6);
    for (const s of [-1, 1]) { part(body, '#4a4f5a', s * 0.9, 0.12, 0.2, 0.12, 0.12, 3.2); part(body, '#4a4f5a', s * 0.7, 0.4, 0.2, 0.08, 0.6, 0.08); }
    part(body, '#4a4f5a', 0, 2.45, 0.3, 0.15, 0.4, 0.15);
    v.rotor = new THREE.Group(); v.rotor.position.set(0, 2.7, 0.3);
    part(v.rotor, '#333', 0, 0, 0, 8, 0.06, 0.35); part(v.rotor, '#333', 0, 0, 0, 0.35, 0.06, 8);
    body.add(v.rotor);
    v.tailRotor = new THREE.Group(); v.tailRotor.position.set(0.12, 2.3, -3.9);
    part(v.tailRotor, '#333', 0, 0, 0, 0.05, 1.4, 0.15);
    body.add(v.tailRotor);
    v.seats = [[0.35, 0.5, 0.6], [-0.35, 0.5, 0.6]];
  } else if (t.boat) {
    part(body, c, 0, 0.35, -0.3, W, 0.7, L - 1);
    const nose = part(body, c, 0, 0.35, L / 2 - 0.5, W * 0.7, 0.7, 1.4, new THREE.CylinderGeometry(0.5, 0.5, 1, 3));
    nose.rotation.x = Math.PI / 2; nose.rotation.y = Math.PI;
    part(body, '#3fa7ff', 0, 0.12, -0.3, W + 0.05, 0.2, L - 1);
    part(body, '#bfe6ff', 0, 1.0, 0.7, W * 0.8, 0.5, 0.1, BOX, glass);
    part(body, '#4a4f5a', 0, 0.5, -L / 2 + 0.2, 0.5, 0.8, 0.5);
    v.seats = [[0.45, 0.25, -0.2], [-0.45, 0.25, -0.2]];
  } else if (t.rail || t.ride || t.custom) {
    G.railMesh[v.typeId](v, body);
  } else if (t.sub) {
    const paint = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: '#8a9199', roughness: 0.35, metalness: 0.75 });
    const darkM = new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.6, metalness: 0.3 });
    const glassM = new THREE.MeshStandardMaterial({ color: '#bfefff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; body.add(o); return o; };
    // main pressure hull with a glass bubble at the front
    add(new THREE.CapsuleGeometry(1.15, 3.2, 8, 20), paint, 0, 1.3, -0.5, Math.PI / 2);
    add(new THREE.SphereGeometry(1.2, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassM, 0, 1.3, 1.25, Math.PI / 2);
    add(new THREE.TorusGeometry(1.18, 0.09, 8, 28), steel, 0, 1.3, 1.25);
    // conning tower, hatch, periscope and a beacon
    add(new THREE.BoxGeometry(0.9, 0.85, 1.6), paint, 0, 2.6, -0.7);
    add(new THREE.CylinderGeometry(0.45, 0.45, 0.85, 16), paint, 0, 2.6, -1.5);
    add(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 16), steel, 0, 3.08, -0.9);
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), steel, 0.25, 3.4, -0.4);
    add(new THREE.BoxGeometry(0.12, 0.12, 0.3), steel, 0.25, 3.95, -0.3);
    add(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff2010', emissiveIntensity: 1.5 }), -0.25, 3.15, -1.2);
    // portholes
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      add(new THREE.TorusGeometry(0.2, 0.05, 6, 14), steel, sx * 1.12, 1.45, -0.2 - i * 0.85, 0, Math.PI / 2);
      add(new THREE.CircleGeometry(0.19, 14), new THREE.MeshStandardMaterial({ color: '#1d3a4a', roughness: 0.1, metalness: 0.5 }), sx * 1.13, 1.45, -0.2 - i * 0.85, 0, sx * Math.PI / 2);
    }
    // thruster pods with lamps, skids, fins and the shrouded propeller
    for (const sx of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.28, 2.6, 4, 12), darkM, sx * 1.35, 0.55, -0.3, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.06, 0.06, 4.4, 6), steel, sx * 0.75, 0.08, -0.3, Math.PI / 2);
      add(new THREE.BoxGeometry(0.06, 0.4, 0.06), steel, sx * 0.75, 0.25, 1.1); add(new THREE.BoxGeometry(0.06, 0.4, 0.06), steel, sx * 0.75, 0.25, -1.6);
      add(new THREE.BoxGeometry(1.3, 0.08, 0.8), paint, sx * 1.1, 1.3, -2.7);
    }
    add(new THREE.BoxGeometry(0.08, 1.4, 0.8), paint, 0, 1.55, -2.75);
    add(new THREE.TorusGeometry(0.62, 0.1, 8, 24), darkM, 0, 1.3, -3.25);
    v.subProp = new THREE.Group(); v.subProp.position.set(0, 1.3, -3.2); body.add(v.subProp);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.04), steel); b.position.y = 0.28; const hub = new THREE.Group(); hub.rotation.z = i * Math.PI / 2; b.rotation.y = 0.5; hub.add(b); v.subProp.add(hub); }
    v.lamps = []; v.beams = [];
    const beamM = new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      v.lamps.push(add(new THREE.CircleGeometry(0.2, 14), new THREE.MeshStandardMaterial({ color: '#fff8e0', emissive: '#fff4c0', emissiveIntensity: 0.2 }), sx * 1.35, 0.55, 1.12));
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 16, 18, 1, true), beamM); beam.rotation.x = -Math.PI / 2; beam.position.set(sx * 1.35, 0.55, 9.1); beam.visible = false; body.add(beam); v.beams.push(beam);
    }
    v.seats = [[0.42, 0.62, 1.15], [-0.42, 0.62, 1.15]];
    v.eyes = v.seats.map(st => [st[0], 1.95, st[2] + 0.05]);
  } else if (t.scooter) {
    for (const z of [-0.65, 0.65]) { const w = part(body, '#222', 0, wr, z, 0.18, wr, wr, WHEEL); v.wheels.push(w); }
    part(body, c, 0, 0.55, 0, 0.5, 0.35, 1.5);
    part(body, c, 0, 0.9, 0.6, 0.4, 0.8, 0.3);
    part(body, '#333', 0, 1.35, 0.6, 0.9, 0.08, 0.08);
    part(body, '#222', 0, 0.8, -0.2, 0.45, 0.12, 0.7);
    part(body, '#ffd9a0', 0, 1.05, -0.65, 0.6, 0.35, 0.6);
    part(body, '#e84a3f', 0, 1.23, -0.65, 0.4, 0.02, 0.4);
    v.seats = [[0, 0.25, -0.2]];
  }
  // first-person eye points for each seat (in body space)
  if (!t.isBike && !t.scooter && !t.boat && !t.sub && !v.eyes && v.seats) v.eyes = v.seats.map(s => [s[0], s[1] + (t.heli ? 1.8 : 1.41), s[2] - 0.02]);
  v.body = body;
  return root;
}

let personalCounter = 0;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _t = new THREE.Vector3();

export class Vehicle {
  constructor(typeId, x, z, yaw = 0, { id = null, color = null, owner = null, livery = null } = {}) {
    if (livery != null) this.livery = livery;
    this.typeId = typeId;
    this.type = VTYPES[typeId];
    this.color = color || this.type.color;
    this.id = id || ('p' + G.net.myId + '_' + (personalCounter++));
    this.owner = owner;
    this.pos = new THREE.Vector3(x, 0, z);
    this.pos.y = this.type.boat ? WATER_Y - 0.1 : this.type.sub ? WATER_Y - 2.1 : groundHeight(x, z, 50, 0.5);
    this.yaw = yaw; this.speed = 0; this.vy = 0; this.onGround = true;
    this.pitch = 0; this.roll = 0; this.bounce = 0; this.bounceV = 0;
    this.hvel = new THREE.Vector3(); // helicopter horizontal velocity
    this.rotorSpeed = 0;
    this.cargo = [];
    this.remoteDriver = null; this.netT = 0;
    this.damage = 0; this.lost = {}; this.lostWheels = 0; this.pull = 0;
    const T = this.type; this.carLike = !T.isBike && !T.plane && !T.heli && !T.boat && !T.sub && !T.rail && !T.ride;
    this.mesh = buildMesh(this);
    this.occupants = this.seats.map(() => null);
    G.scene.add(this.mesh);
    G.vehicles.push(this);
    this.sync();
  }

  get driver() { return this.occupants[0]; }
  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  seatPos(i, out) {
    const s = this.seats[Math.min(i, this.seats.length - 1)];
    if (this.quat) return out.set(s[0], s[1], s[2]).applyQuaternion(this.quat).add(this.pos);   // rollercoaster cars can go upside down
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    if (this.type.isBike) {
      const wb = this.bikeWb, p = -this.pitch;          // p > 0 = front up
      const lz = s[2] + wb / 2, ly = s[1];
      const rz = lz * Math.cos(p) - ly * Math.sin(p) - wb / 2, ry = lz * Math.sin(p) + ly * Math.cos(p);
      const lx = -ry * Math.sin(this.roll) * 0.5;
      out.set(this.pos.x + lx * c + rz * sn, this.pos.y + ry * Math.cos(this.roll) + this.bounce, this.pos.z - lx * sn + rz * c);
      return out;
    }
    out.set(this.pos.x + s[0] * c + s[2] * sn, this.pos.y + s[1] + this.bounce, this.pos.z - s[0] * sn + s[2] * c);
    return out;
  }
  exitPos(out) {
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const side = this.type.wid / 2 + 1.1;
    out.set(this.pos.x + side * c, this.pos.y + 0.5, this.pos.z - side * sn);
    return out;
  }

  // Drive with input {throttle, steer, brake, up, down}. Called for vehicles we control.
  drive(dt, inp) {
    const t = this.type;
    if (this.twister) return;
    if (t.heli) return this.fly(dt, inp);
    if (t.sub) return this.subDrive(dt, inp);
    if (t.rail || t.ride) return G.railDrive && G.railDrive(this, dt, inp);
    if (t.plane) return this.planeFly(dt, inp);
    if (t.isBike) return this.ride(dt, inp);
    const prevSpeed = this.speed;
    if (this.carLike) {
      if (this.tumbling) return this.physics(dt, prevSpeed);
      if (this.flipped) {
        this.flipT += dt; this.speed *= 1 - Math.min(1, dt * 3);
        if (this.flipT > 2.5 && !this.wrecked) this.unflip();
        return this.physics(dt, prevSpeed);
      }
      if (this.wrecked) { this.speed *= 1 - Math.min(1, dt * 2); return this.physics(dt, prevSpeed); }
    }
    const inWater = t.boat;
    const canDrive = inWater ? true : this.onGround;
    if (canDrive) {
      const sp = this.speed, ratio = Math.min(1, Math.abs(sp) / t.max);
      // engine: strong off the line, fading near top speed
      if (inp.throttle > 0) {
        if (sp < -0.5) this.speed += 26 * inp.throttle * dt;                           // braking while reversing
        else this.speed += t.acc * (1 - ratio * ratio * 0.85) * inp.throttle * dt;
      } else if (inp.throttle < 0) {
        if (sp > 0.5) this.speed -= 26 * (1 - 0.35 * (this.carLike ? G.wet || 0 : 0)) * -inp.throttle * dt;   // brakes (worse in the wet)
        else this.speed -= t.acc * 0.5 * -inp.throttle * dt;                            // reverse
      }
      // rolling resistance + air drag
      const drag = (inp.throttle === 0 ? 2.2 : 0.6) + 0.012 * sp * sp;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
      if (inp.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 9 * dt);
      this.speed = clamp(this.speed, -t.max * 0.35, t.max);
      // steering: the wheel turns gradually and turns less at high speed (bicycle model)
      const maxA = (0.55 - 0.4 * ratio) * (t.scooter ? 1.15 : 1);
      const target = inp.steer * maxA;
      const rate = (Math.abs(target) > Math.abs(this.steerA || 0) ? 1.8 : 3.2) * dt;
      this.steerA = (this.steerA || 0) + clamp(target - (this.steerA || 0), -rate, rate);
      const wheelbase = Math.max(1.4, t.len * 0.6);
      let yawRate = this.speed * Math.tan(this.steerA) / wheelbase;
      // tyres can only hold so much sideways force (~1g), so fast cars turn wide
      const wet = this.carLike ? (G.wet || 0) : 0;            // rain makes the road slippery
      const latMax = (t.sports ? 12 : t.truck ? 7 : 10) * (1 - 0.38 * wet) / Math.max(1, Math.abs(this.speed));
      yawRate = clamp(yawRate, -latMax, latMax);
      if (inp.brake && Math.abs(this.speed) > 7) yawRate *= 1.8;                       // handbrake turn
      this.yaw += yawRate * dt;
      if (this.lostWheels) {
        // a missing wheel drags the car to one side and grinds sparks off the road
        this.yaw += this.pull * dt * clamp(Math.abs(this.speed) / 10, 0, 1);
        this.speed = Math.min(this.speed, t.max * Math.max(0.25, 1 - 0.3 * this.lostWheels));
        if (Math.abs(this.speed) > 3 && Math.random() < dt * 25) sparks(this.pos, 3);
      }
      this.steerVis = this.steerA / 0.6;
      // grip: the direction of travel catches up with where the car points
      if (this.moveYaw === undefined) this.moveYaw = this.yaw;
      const grip = (inp.brake ? 1.8 : t.boat ? 2.5 : 9 - ratio * 3) * (1 - 0.6 * wet);
      let slip = ((this.yaw - this.moveYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.moveYaw += slip * Math.min(1, grip * dt);
      this.speed *= 1 - Math.min(0.5, Math.abs(slip) * 0.9 * dt);                        // sliding scrubs speed
      this.slip = slip;
    } else if (this.moveYaw !== undefined) this.moveYaw = angleLerp(this.moveYaw, this.yaw, 0.02);
    this.physics(dt, prevSpeed);
  }

  fly(dt, inp) {
    const t = this.type;
    this.rotorSpeed = Math.min(1, this.rotorSpeed + dt * 0.7);
    const lift = this.rotorSpeed >= 1;
    this.yaw += inp.steer * t.turn * dt;
    this.forward(_f);
    const target = lift ? inp.throttle * t.max : 0;
    this.speed += clamp(target - this.speed, -t.acc * dt, t.acc * dt);
    const vyT = lift ? (inp.up ? 9 : inp.down ? -9 : 0) : -6;
    this.vy += clamp(vyT - this.vy, -12 * dt, 12 * dt);
    this.pos.addScaledVector(_f, this.speed * dt);
    this.pos.y += this.vy * dt;
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.5, 1.2);
    const floor = Math.max(gh, baseHeight(this.pos.x, this.pos.z) < WATER_Y ? WATER_Y : -99);
    if (this.pos.y < floor) { this.pos.y = floor; if (this.vy < 0) this.vy = 0; this.onGround = true; } else this.onGround = this.pos.y - floor < 0.05;
    if (this.pos.y > 420) { this.pos.y = 420; this.vy = Math.min(0, this.vy); }
    this.collideWalls(dt, 0);
    this.pitch = lerp(this.pitch, this.speed / t.max * 0.25, 0.1);
    this.roll = lerp(this.roll, -inp.steer * 0.2, 0.1);
  }

  // Submarine: W/S thrust, A/D turn, Space rise, Shift dive. Floats at the surface with the tower out.
  subDrive(dt, inp) {
    const t = this.type;
    const target = inp.throttle * (inp.throttle > 0 ? t.max : t.max * 0.45);
    this.speed += clamp(target - this.speed, -t.acc * dt, t.acc * dt);
    this.speed *= 1 - Math.min(1, dt * 0.15);
    this.yaw += inp.steer * t.turn * (0.35 + Math.min(1, Math.abs(this.speed) / 4) * 0.65) * dt;
    const vyT = inp.up ? 3 : inp.down ? -3 : 0;
    this.vy += clamp(vyT - this.vy, -2.5 * dt, 2.5 * dt);
    this.forward(_f);
    const ox = this.pos.x, oz = this.pos.z, sp0 = this.speed;
    this.pos.addScaledVector(_f, this.speed * dt);
    this.pos.y += this.vy * dt;
    const top = WATER_Y - 2.1;
    if (this.pos.y > top) { this.pos.y = top; if (this.vy > 0) this.vy = 0; }
    // the sea floor: scrape along gentle slopes, stop at walls and the shore
    const fl = baseHeight(this.pos.x, this.pos.z);
    if (fl > top - 0.2 || fl > this.pos.y + 1.4) {
      this.pos.x = ox; this.pos.z = oz;
      if (Math.abs(this.speed) > 3 && this.driver && this.driver.isPlayer) sfx.crash();
      this.speed *= -0.25;
    } else if (this.pos.y < fl + 0.15) { this.pos.y = fl + 0.15; if (this.vy < 0) this.vy = 0; }
    this.collideWalls(dt, sp0);
    this.onGround = false;
    this.pitch = lerp(this.pitch, clamp(-this.vy * 0.07, -0.25, 0.25), Math.min(1, dt * 2));
    this.roll = lerp(this.roll, -inp.steer * 0.1 * Math.min(1, Math.abs(this.speed) / 5) + (this.pos.y >= top - 0.01 ? Math.sin(G.time * 1.3 + this.pos.x) * 0.03 : 0), Math.min(1, dt * 2));
    if (Math.abs(this.speed) > 1 && Math.random() < dt * 14 && this.pos.y < WATER_Y - 2.4) {
      _t.set(-Math.sin(this.yaw) * 3.4, 1.3, -Math.cos(this.yaw) * 3.4).add(this.pos);
      bubbles(_t, 2, 0.4);
    }
  }

  // E-dirt bike. Real-ish physics:
  //  - power-limited electric motor (huge torque low down, fading with speed) + air drag
  //  - lean-to-turn: turn rate = g·tan(lean)/speed
  //  - wheelies come from the actual acceleration: drive force × CG height vs gravity × CG reach,
  //    pivoting round the rear tyre. Past the balance point it keeps going over, so you feather
  //    the throttle, shift your weight (Shift back / C forward) and dab the rear brake (S) to hold it.
  ride(dt, inp) {
    const t = this.type, sp = this.speed, sc = t.bike.scale || 1;
    this.wheelie = this.wheelie || 0; this.wv = this.wv || 0;
    const prevSpeed = sp;
    const want = Math.max(0, inp.throttle), braking = inp.throttle < 0;
    this.thr = (this.thr || 0) + clamp(want - (this.thr || 0), -dt * 7, dt * 3.5);           // twist grip
    const bodyT = (inp.back ? 1 : 0) - (inp.fwd ? 1 : 0);
    this.riderLean = (this.riderLean || 0) + (bodyT - (this.riderLean || 0)) * Math.min(1, dt * 7);
    let acc = 0;
    if (this.onGround) {
      const P = t.acc * 3.6;                                    // power-to-weight
      let a = sp < -0.3 && want > 0 ? 12 : this.thr * Math.min(7.5, P / Math.max(2, Math.abs(sp)));
      if (braking) a -= sp > 0.3 ? (this.wheelie > 0.05 ? 7 : 11) : 2.5;
      this.speed += a * dt;
      const drag = 0.35 + (P / t.max) / (t.max * t.max) * this.speed * this.speed;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
      this.speed = clamp(this.speed, -4, t.max * 1.1);
      acc = (this.speed - sp) / dt;
      if (inp.jump) { this.vy = 6.5 + Math.abs(sp) * 0.05; this.onGround = false; this.pos.y += 0.1; if (this.wheelie < 0.2) this.wv += 1.0; }
    }
    this.accS = (this.accS || 0) + (acc - (this.accS || 0)) * Math.min(1, dt * 10);
    // lean into turns; turn rate from lean like a real bike (g·tanθ / v)
    const leanT = -inp.steer * clamp(Math.abs(this.speed) / 6, 0, 1) * 0.8;
    this.roll += (leanT - this.roll) * Math.min(1, dt * 4.5);
    let yawRate;
    if (Math.abs(this.speed) > 4) yawRate = 9.8 * Math.tan(-this.roll) / this.speed;
    else yawRate = inp.steer * this.speed * 0.45;
    if (this.onGround) this.yaw += yawRate * dt * (this.wheelie > 0.25 ? 0.4 : 1);
    this.moveYaw = this.yaw;
    if (this.onGround) {
      // centre of mass (bike + rider) relative to the rear contact patch; leaning back moves it back
      const x0 = (0.66 - this.riderLean * 0.16) * sc, y0 = (0.82 + Math.max(0, this.riderLean) * 0.04) * sc;
      const th = this.wheelie, c = Math.cos(th), s = Math.sin(th);
      const cgx = x0 * c - y0 * s, cgy = x0 * s + y0 * c;
      const I = (x0 * x0 + y0 * y0) * 4;                     // pitch inertia (bike, rider, spinning wheels)
      const torque = this.accS * cgy - 9.8 * cgx;
      // "pop": yank the bars back as you roll on the throttle
      if (inp.back && !this.popHeld && this.thr > 0.3 && th < 0.3) this.wv += 0.8 + this.thr * 0.6;
      this.popHeld = inp.back;
      if (th <= 0 && torque <= 0 && this.wv <= 0) { this.wheelie = 0; this.wv = 0; }
      else {
        this.wv += torque / I * dt;
        this.wv *= 1 - Math.min(1, dt * 2);
        this.wheelie += this.wv * dt;
        if (this.wheelie < 0) { if (this.wv < -1.4) this.bounceV -= Math.min(3, -this.wv * 0.8); this.wheelie = 0; this.wv = 0; }
      }
      this.balance = Math.atan2(x0, y0);
      if (this.wheelie > 1.3) return this.bikeCrash('Looped it!');
    } else {
      // in the air: shift your weight, and the spinning rear wheel pitches the bike (throttle up, brake down)
      this.wv += (this.riderLean * 2.6 + this.thr * 1.2 - (braking ? 2.2 : 0)) * dt;
      this.wv *= 1 - Math.min(1, dt * 0.8);
      this.wheelie += this.wv * dt;
    }
    // wheelie score
    if (this.onGround && this.wheelie > 0.2) { this.wT = (this.wT || 0) + dt; this.wD = (this.wD || 0) + Math.abs(this.speed) * dt; }
    else if (this.wT) {
      if (this.wT > 2 && this.driver && this.driver.isPlayer && G.toast) G.toast(`Wheelie! ${this.wT.toFixed(1)}s · ${Math.round(this.wD)} m`, 'good');
      this.wT = 0; this.wD = 0;
    }
    const wasAir = !this.onGround;
    this.physics(dt, prevSpeed);
    const dive = this.wheelie < 0.02 ? clamp(-this.accS * 0.006, -0.05, 0.07) : 0;
    this.pitch = (this.slopeP || 0) - this.wheelie + dive;
    if (wasAir && this.onGround) {
      if (this.wheelie < -0.4 || this.wheelie > 1.1 || Math.abs(this.roll) > 0.9) return this.bikeCrash('Bad landing!');
      if (this.wheelie < 0) this.wheelie = 0;
      this.wv = Math.min(this.wv, 0.3);
    }
    this.roll = clamp(this.roll, -0.85, 0.85);
  }

  bikeCrash(msg) {
    const d = this.driver;
    if (Math.abs(this.speed) > 8) { this.forward(_f); for (let i = 0; i < 5; i++) chunk(M('trim'), 0.3, 0.05, 0.2, _c1.copy(this.pos).setY(this.pos.y + 0.6), _t.copy(_f).multiplyScalar(this.speed * 0.4).add(_c2.set(rand(-3, 3), rand(2, 6), rand(-3, 3)))); sparks(this.pos, 16); }
    this.wheelie = 0; this.wv = 0; this.pitch = 0; this.roll = 1.3;
    const sp = this.speed; this.speed = 0;
    if (d) {
      this.ejectAll(Math.max(6, Math.abs(sp)));
      if (d.isPlayer && G.toast) G.toast(msg, 'bad');
    }
    setTimeout(() => { this.roll = 0; }, 2500);
  }

  planeFly(dt, inp) {
    const t = this.type, L = this.lost;
    if (this.wrecked) inp = { throttle: -1, steer: 0 };
    this.throttle = clamp((this.throttle || 0) + inp.throttle * dt * 0.7, 0, 1);
    let fp = this.fp || 0;
    const thrustK = t.airliner ? 1 - 0.45 * ((L.engL ? 1 : 0) + (L.engR ? 1 : 0)) : (L.engine ? 0 : 1);
    const target = this.throttle * t.max * thrustK;
    this.speed += clamp(target - this.speed, -5 * dt, t.acc * dt);
    if (this.onGround) {
      if (inp.throttle < 0) this.speed = Math.max(0, this.speed - 14 * dt);
      this.yaw += inp.steer * t.turn * dt * clamp(this.speed / 8, 0, 1);
      this.roll = lerp(this.roll, 0, 0.2);
      if (this.speed > t.takeoff && inp.up) { fp = 0.2; this.onGround = false; this.pos.y += 0.2; }
      else fp = lerp(fp, 0, 0.2);
    } else {
      const big = !!t.airliner, bankMax = big ? 0.5 : 0.85;
      fp += ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * (big ? 0.4 : 1.1) * dt * (L.tail ? 0.3 : 1);
      if (L.tail) { fp -= 0.7 * dt; this.yaw += Math.sin(G.time * 3.1) * 0.7 * dt; }
      if (!inp.up && !inp.down) fp *= 1 - Math.min(1, dt * 0.5); // gently levels out
      if (this.speed < t.takeoff * 0.8) fp -= 0.9 * dt;
      fp = clamp(fp, -1.1, big ? 0.3 : 1.0);
      // bank to turn: the plane rolls first, and the turn follows the bank angle
      this.roll = lerp(this.roll, -inp.steer * bankMax, 1 - Math.exp(-dt * (big ? 1.3 : 3)));
      // a missing wing: that side drops and the plane spirals down
      const lostW = (L.wingL ? 1 : 0) + (L.wingR ? 1 : 0);
      this.roll += ((L.wingR ? 1 : 0) - (L.wingL ? 1 : 0)) * 5 * dt;
      this.yaw += -Math.sin(this.roll) / bankMax * t.turn * dt;
      if (lostW) { this.pos.y -= lostW * 8 * dt; fp -= lostW * 0.25 * dt; }
    }
    this.fp = fp;
    if (this.wrecked && !this.onGround) { this.fallV = (this.fallV || 0) - 22 * dt; this.pos.y += this.fallV * dt; } else this.fallV = 0;
    const cp = Math.cos(fp);
    this.pos.x += Math.sin(this.yaw) * cp * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * cp * this.speed * dt;
    if (!this.onGround) {
      this.pos.y += Math.sin(fp) * this.speed * dt;
      if (this.speed < t.takeoff * 0.6) this.pos.y -= 7 * dt;
    }
    this.vy = this.onGround ? 0 : Math.sin(fp) * this.speed;
    if (this.pos.y > 450) this.pos.y = 450;
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.6, 1);
    const water = baseHeight(this.pos.x, this.pos.z) < WATER_Y && gh < WATER_Y;
    const floor = water ? WATER_Y : gh;
    if (this.pos.y <= floor || (this.onGround && this.pos.y - floor < 0.6)) {
      if (!this.onGround && (fp < (t.airliner ? -0.22 : -0.3) || Math.abs(this.roll) > 0.6 || water)) this.planeCrash(water);
      else { if (!this.onGround && this.driver && this.driver.isPlayer) sfx.land(); this.onGround = true; this.fp = 0; }
      this.pos.y = floor;
      if (water) { this.speed *= 1 - Math.min(1, dt * 2); this.throttle = 0; }
    } else this.onGround = false;
    this.pitch = -this.fp;
    const before = this.speed;
    this.collideWalls(dt, before);
    if (!this.onGround && !this.wrecked && Math.abs(this.speed) < Math.abs(before) * 0.5) return this.planeCrash(false);
    if (!this.onGround && !this.wrecked) this.checkPieces();
    // engines on fire trail smoke
    if ((L.engL || L.engR || L.engine || L.wingL || L.wingR) && !this.onGround && Math.random() < dt * 30) smoke(this.pos, 1, true);
  }

  // Wing tips, engines, tail and nose each check whether they hit the ground or a building.
  checkPieces() {
    if (!this.pieces) return;
    this.mesh.position.copy(this.pos); this.mesh.rotation.set(0, this.yaw, 0);
    this.body.position.set(0, this.bounce, 0); this.body.rotation.set(this.pitch, 0, this.roll);
    this.mesh.updateMatrixWorld(true);
    for (const name in this.pieces) {
      const pc = this.pieces[name];
      if (pc.lost) continue;
      for (const p of pc.pts) {
        _t.set(p[0], p[1], p[2]); this.body.localToWorld(_t);
        const hitW = pointHitsWorld(_t);
        if (hitW) {
          // whatever this part of the plane hit takes damage depending on which part it was
          if (hitW !== true && G.hitBuilding) G.hitBuilding(hitW, _t, Math.abs(this.speed) * massOf(this.type) * (PART_HIT[name] || 0.4));
          if (pc.fatal) { this.planeCrash(false); return; }
          this.losePiece(name, _t);
          break;
        }
      }
    }
  }
  losePiece(name, at) {
    const pc = this.pieces && this.pieces[name];
    if (!pc || pc.lost) return;
    pc.lost = true; this.lost[name] = true;
    this.forward(_f);
    const v = _c1.copy(_f).multiplyScalar(this.speed * 0.75).add(_c2.set(rand(-6, 6), rand(2, 7), rand(-6, 6)));
    v.y += this.vy * 0.5;
    detach(pc.g, v, _c2.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)), 90);
    if (name === 'engine') this.prop = null;
    const p = at || this.pos;
    sparks(p, 25); fire(p, 6, 1.5); smoke(p, 4, true);
    if (G.camera && G.camera.position.distanceToSquared(p) < 40000) sfx.crash();
    const nice = { wingL: 'left wing', wingR: 'right wing', engL: 'left engine', engR: 'right engine', tail: 'tail', engine: 'engine' }[name] || name;
    if (this.driver && this.driver.isPlayer && G.toast) G.toast(`💥 Your ${nice} broke off!`, 'bad');
  }

  planeCrash(water) {
    if (this.wrecked) { this.onGround = true; return; }
    this.throttle = 0;
    this.onGround = true;
    const sp = Math.abs(this.speed);
    if (water) {
      smoke(this.pos, 6, false);
      this.fp = 0; this.roll = 0; this.speed = 0;
      if (this.occupants.some(Boolean)) this.ejectAll(14);
      return;
    }
    // the plane breaks up: every piece flies off and the fuselage burns
    explosion(_c1.copy(this.pos).setY(this.pos.y + 2), this.type.airliner ? 2.2 : 1.2);
    if (this.pieces) for (const name in this.pieces) if (name !== 'body') this.losePiece(name);
    this.wrecked = true; this.burnT = 25;
    this.charBody();
    if (this.occupants.some(Boolean)) this.ejectAll(Math.max(14, sp * 0.6));
    this.speed = sp * 0.25; this.fp = 0; this.roll = clamp(this.roll, -0.5, 0.5);
    this.blast(this.type.airliner ? 14 : 7);
  }
  // knock over anyone near an explosion
  blast(R) {
    for (const ch of G.characters) {
      if (ch.vehicle || ch.isRemote) continue;
      const P = ch.ragdoll ? ch.p[0] : ch.root;
      const d = P.distanceTo(this.pos);
      if (d < R && !ch.ragdoll) { _t.subVectors(P, this.pos).setY(0).normalize().multiplyScalar(14 * (1 - d / R) + 4); _t.y = 8; ch.flop(_t, 3); }
    }
  }
  charBody() {
    const burnt = charMat();
    this.body.traverse(o => { if (o.isMesh) { if (o.material && o.material.transparent) o.visible = false; else o.material = burnt; } });
  }

  // ------------------------------------------------ crashes for cars, trucks and bikes
  crash(impact, hit) {
    const t = this.type;
    if (t.plane || t.heli || t.boat || t.noCrash) return;
    if ((this.crashCD || 0) > G.time) return;
    this.crashCD = G.time + 0.35;
    this.damage += impact * (t.truck ? 0.55 : 1);
    this.forward(_f);
    const frontHit = hit ? (_f.x * hit.nx + _f.z * hit.nz) < 0 : this.speed >= 0;
    const sgn = frontHit ? 1 : -1;
    const at = _c1.copy(this.pos).addScaledVector(_f, sgn * t.len * 0.45); at.y += t.h * 0.35;
    const n = Math.min(18, Math.floor(impact / 1.6));
    const body = paintMat(this.color), glass = M('glass'), trim = M('trim');
    for (let i = 0; i < n; i++) {
      const k = Math.random();
      const v = _c2.copy(_f).multiplyScalar(this.speed * 0.3 + sgn * rand(-2, 1)).add(_t.set(rand(-4, 4), rand(2, 4 + impact * 0.25), rand(-4, 4)));
      if (hit) v.addScaledVector(_t.set(hit.nx, 0, hit.nz), impact * 0.15);
      if (k < 0.45) chunk(body, rand(0.3, 0.8), 0.05, rand(0.2, 0.6), at, v);
      else if (k < 0.75) chunk(glass, rand(0.06, 0.18), 0.02, rand(0.05, 0.15), at, v, 12);
      else chunk(trim, rand(0.3, 1.1), 0.1, 0.12, at, v);
    }
    sparks(at, 8 + Math.floor(impact));
    if (t.isBike) { if (impact > 9 && this.driver) this.bikeCrash('Crashed!'); return; }
    // wheels come off on big hits
    if (impact > 14 && this.wheels.length > 2 && Math.random() < 0.35 + (impact - 14) * 0.04) this.loseWheel(frontHit);
    if (impact > 20 && this.wheels.length > 2 && Math.random() < 0.3) this.loseWheel(!frontHit);
    // hard hits send the car rolling
    if (impact > 18 || (impact > 12 && Math.random() < 0.5)) this.tumble(impact);
    if (this.damage > 170 && !this.wrecked) this.explode();
  }
  loseWheel(front) {
    const cand = this.wheels.filter(w => w.parent && ((w.parent.position.z > 0) === front));
    const w = pick(cand.length ? cand : this.wheels);
    if (!w) return;
    this.wheels.splice(this.wheels.indexOf(w), 1);
    const side = w.parent.position.x >= 0 ? 1 : -1;
    this.forward(_f);
    const v = _c1.copy(_f).multiplyScalar(this.speed * 0.8).add(_c2.set(Math.cos(this.yaw) * side * rand(3, 7), rand(3, 7), -Math.sin(this.yaw) * side * rand(3, 7)));
    detach(w, v, _c2.set(rand(8, 18), rand(-3, 3), rand(-3, 3)), 60);
    this.lostWheels++; this.pull += side * 0.35;
  }
  tumble(impact) {
    this.tumbling = true; this.onGround = false; this.flipped = false;
    this.vy = Math.min(13, 3 + impact * 0.32);
    this.rollV = (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 1) * impact * 0.28;
    this.pitchV = rand(-1, 1) * impact * 0.12;
    this.yawV = rand(-2.5, 2.5);
    this.pos.y += 0.3;
    if (this.occupants.some(Boolean)) this.ejectAll(impact * 1.2);   // everyone goes flying
  }
  unflip() {
    this.flipped = false; this.tumbling = true; this.onGround = false;
    this.vy = 7.5; this.rollV = -wrapA(this.roll) / 0.57; this.pitchV = -wrapA(this.pitch) / 0.57; this.yawV = 0;
    this.pos.y += 0.2;
  }
  explode() {
    const hadPlayer = this.occupants.some(o => o && o.isPlayer);
    this.wrecked = true; this.burnT = 25;
    explosion(_c1.copy(this.pos).setY(this.pos.y + 1), 1.2);
    this.charBody();
    if (this.occupants.some(Boolean)) this.ejectAll(26);
    this.blast(8);
    while (this.wheels.length > 1 && Math.random() < 0.7) this.loseWheel(Math.random() < 0.5);
    this.tumble(26);
    if (hadPlayer && G.toast) G.toast('💥 KABOOM! Your ride blew up!', 'bad');
  }
  tumblePhysics(dt, prevSpeed) {
    const my = this.moveYaw === undefined ? this.yaw : this.moveYaw;
    this.pos.x += Math.sin(my) * this.speed * dt; this.pos.z += Math.cos(my) * this.speed * dt;
    this.vy -= 26 * dt; this.pos.y += this.vy * dt;
    this.roll += this.rollV * dt; this.pitch += this.pitchV * dt; this.yaw += (this.yawV || 0) * dt; this.moveYaw = my;
    this.speed *= 1 - Math.min(1, dt * 0.3);
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.5, 0.6);
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.roll = wrapA(this.roll); this.pitch = wrapA(this.pitch);
      const spin = Math.abs(this.rollV) + Math.abs(this.pitchV);
      const upright = Math.abs(this.roll) < 0.6 && Math.abs(this.pitch) < 0.6;
      if ((this.vy < -4 || spin > 3.5) && !(upright && this.vy > -9)) {
        // bounce and keep rolling
        this.vy = Math.min(9, -this.vy * 0.35 + spin * 0.35 + 1);
        this.rollV *= 0.62; this.pitchV *= 0.5; this.yawV = (this.yawV || 0) * 0.6;
        this.speed *= 0.72; this.damage += 3;
        sparks(this.pos, 10);
        if (Math.random() < 0.4) this.crash(8, null);
        if (G.camera && G.camera.position.distanceToSquared(this.pos) < 3600) sfx.crash();
      } else {
        this.tumbling = false; this.rollV = this.pitchV = this.yawV = 0; this.vy = 0; this.onGround = true;
        const r = Math.abs(this.roll), p = Math.abs(this.pitch);
        if (r < 0.9 && p < 0.9) { this.roll = 0; this.pitch = 0; }
        else { this.flipped = true; this.flipT = 0; this.roll = (r > 2.2 || p > 2.2) ? Math.PI : Math.sign(this.roll || 1) * Math.PI / 2; this.pitch = 0; }
      }
    } else this.onGround = false;
    this.collideWalls(dt, prevSpeed);
  }

  physics(dt, prevSpeed = this.speed) {
    const t = this.type;
    if (this.tumbling) return this.tumblePhysics(dt, prevSpeed);
    const my = this.moveYaw === undefined ? this.yaw : this.moveYaw;
    this.pos.x += Math.sin(my) * this.speed * dt; this.pos.z += Math.cos(my) * this.speed * dt;
    this.forward(_f);
    if (t.boat) {
      const bh = baseHeight(this.pos.x, this.pos.z);
      this.vy = 0;
      if (bh > WATER_Y - 0.4) {
        // beached: push back to water
        this.pos.addScaledVector(_f, -this.speed * dt * 1.2);
        this.speed *= -0.3;
      }
      this.pos.y = WATER_Y - 0.15 + Math.sin(G.time * 2 + this.pos.x) * 0.08;
      this.pitch = lerp(this.pitch, -this.speed * 0.006, 0.1);
      this.roll = lerp(this.roll, -(this.steerVis || 0) * this.speed * 0.006, 0.1);
      this.collideWalls(dt, prevSpeed);
      return;
    }
    this.vy -= 26 * dt;
    this.pos.y += this.vy * dt;
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.4, 0.6);
    const tag = getGroundTag();
    if (this.pos.y <= gh || (this.onGround && this.vy <= 0.5 && this.pos.y - gh < 0.35)) {
      if (!this.onGround && this.vy < -10) { this.bounceV = this.vy * 0.4; if (this.driver && this.driver.isPlayer) sfx.land(); }
      if (tag === 'tramp' && this.vy < -4) { this.vy = -this.vy * 0.8; this.pos.y = gh + 0.05; this.onGround = false; sfx.boing(); }
      else {
        const rise = (gh - this.pos.y) / dt;
        this.vy = this.onGround ? clamp(rise, 0, 30) : 0;
        this.pos.y = gh; this.onGround = true;
      }
    } else this.onGround = false;
    // water: sink slowly & stall
    if (this.pos.y < WATER_Y - 0.8) { this.speed *= 1 - Math.min(1, dt * 2); if (!this.splashed) { this.splashed = true; if (this.driver && this.driver.isPlayer) sfx.splash(); } } else this.splashed = false;
    // suspension wobble
    this.bounceV += (-this.bounce * 120 - this.bounceV * 8) * dt;
    this.bounce += this.bounceV * dt;
    // pitch from ground slope
    if (this.onGround) {
      const L = t.len * 0.4;
      const gf = groundHeight(this.pos.x + _f.x * L, this.pos.z + _f.z * L, this.pos.y + 1.2, 0.3);
      const gb = groundHeight(this.pos.x - _f.x * L, this.pos.z - _f.z * L, this.pos.y + 1.2, 0.3);
      this.slopeP = -Math.atan2(gf - gb, L * 2);
      if (!this.flipped) this.pitch = lerp(this.pitch, this.slopeP, 0.3);
    } else if (!this.flipped) this.pitch = lerp(this.pitch, clamp(this.vy * 0.03, -0.5, 0.4) * -1, 0.05);
    if (!t.isBike && !this.flipped) this.roll = lerp(this.roll, clamp((this.steerA || 0) * this.speed * 0.012 + (this.slip || 0) * 0.3, -0.12, 0.12), 0.1);
    this.collideWalls(dt, prevSpeed);
  }

  collideWalls(dt, prevSpeed) {
    const t = this.type;
    this.forward(_f);
    const off = t.len * 0.28, r = t.wid / 2 + 0.1;
    _c1.copy(this.pos).addScaledVector(_f, off);
    _c2.copy(this.pos).addScaledVector(_f, -off);
    const h1 = resolveWalls(_c1, r, t.h + 1, 0.7);
    const h2 = resolveWalls(_c2, r, t.h + 1, 0.7);
    if (h1 || h2) {
      const d1x = _c1.x - this.pos.x - _f.x * off, d1z = _c1.z - this.pos.z - _f.z * off;
      const d2x = _c2.x - this.pos.x + _f.x * off, d2z = _c2.z - this.pos.z + _f.z * off;
      this.pos.x += Math.abs(d1x) > Math.abs(d2x) ? d1x : d2x;
      this.pos.z += Math.abs(d1z) > Math.abs(d2z) ? d1z : d2z;
      const hit = h1 || h2;
      const along = Math.abs(_f.x * hit.nx + _f.z * hit.nz);
      const impact = Math.abs(prevSpeed) * along;
      // the building takes damage too (and may come down)
      if (impact > 5 && hit.c && G.hitBuilding) {
        const sg = (_f.x * hit.nx + _f.z * hit.nz) < 0 ? 1 : -1;
        _t.copy(this.pos).addScaledVector(_f, sg * t.len * 0.5); _t.y += t.airliner ? 3.5 : t.h * 0.5;
        G.hitBuilding(hit.c, _t, impact * massOf(t), hit.nx, hit.nz);
        if (this.driver && this.driver.isPlayer && impact * massOf(t) > 25 && G.crime) G.crime('Smashing into buildings', 2);
      }
      if (impact > 4) {
        this.speed *= -0.25;
        this.bounceV += 3;
        if (this.driver && this.driver.isPlayer) sfx.crash();
        if (impact > 7) this.crash(impact, hit);
        if (impact > 17 && this.driver && !t.heli && !t.plane && !t.noCrash) this.ejectAll(impact * 1.3);
      } else this.speed *= 1 - along * 0.5;
      if (t.heli && this.hvel) this.speed *= 0.5;
    }
  }

  ejectAll(force) {
    this.forward(_f);
    for (const ch of [...this.occupants]) {
      if (!ch) continue;
      this.removeOccupant(ch);
      _t.copy(_f).multiplyScalar(force * 0.8); _t.y = 7 + force * 0.25;
      ch.root.y += 1.2;
      for (const p of ch.p) p.y += 1.2;
      ch.flop(_t, 2.5);
      if (ch.isPlayer && G.onEjected) G.onEjected(this);
    }
  }

  addOccupant(ch, seat) {
    if (seat === 0) { this.moveYaw = this.yaw; this.steerA = 0; }
    this.occupants[seat] = ch;
    ch.vehicle = this; ch.seat = seat;
    ch.vel.set(0, 0, 0);
  }
  removeOccupant(ch) {
    const i = this.occupants.indexOf(ch);
    if (i >= 0) this.occupants[i] = null;
    ch.vehicle = null;
    const ep = this.exitPos(_t);
    ch.root.set(ep.x, Math.max(ep.y, groundHeight(ep.x, ep.z, ep.y + 2)), ep.z);
    resolveWalls(ch.root, 0.5, 1.8);
    if (this.type.boat || this.type.heli) ch.root.y = Math.max(ch.root.y, this.pos.y + 0.3);
    if (this.type.sub) {
      // climb out of the hatch at the surface, or swim out of the side underwater
      if (this.pos.y >= WATER_Y - 2.2) ch.root.set(ep.x, WATER_Y - 0.9, ep.z);
      else { ch.root.y = this.pos.y + 0.6; ch.diving = true; }
    }
    if (ch.place && (this.type.rail || this.type.ride)) { if (G.onLeaveRide) G.onLeaveRide(this, ch); }
  }

  // Knock over characters and props we drive into.
  hitThings(onRemoteHit) {
    const sp = Math.abs(this.speed);
    const t = this.type;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.forward(_f);
    for (const ch of G.characters) {
      if (ch.vehicle === this || ch.vehicle) continue;
      const P = ch.ragdoll || ch.isRemote ? ch.p[0] : ch.root;
      const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
      if (dx * dx + dz * dz > 30) continue;
      if (P.y > this.pos.y + t.h + 1.6 || P.y < this.pos.y - 1.5) continue;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < t.wid / 2 + 0.45 && Math.abs(lz) < t.len / 2 + 0.45) {
        if (sp > 3.5 || this.vy < -5) {
          _t.copy(_f).multiplyScalar(this.speed * 1.1); _t.y = 4 + sp * 0.25;
          if (ch.isRemote) onRemoteHit && onRemoteHit(ch, _t);
          else if (!ch.ragdoll) { ch.flop(_t, 2.5); if (this.driver && this.driver.isPlayer) { sfx.slap(); G.crime && G.crime(ch.cop ? 'Running over a police officer' : 'Hitting a pedestrian', ch.cop ? 3 : 2); } }
        } else if (!ch.isRemote && !ch.ragdoll) {
          const pushX = (lx >= 0 ? 1 : -1) * (t.wid / 2 + 0.46 - Math.abs(lx));
          if (Math.abs(pushX) < t.wid) { ch.root.x += pushX * c; ch.root.z -= pushX * s; }
        }
      }
    }
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle) continue;
      const dx = pr.pos.x - this.pos.x, dz = pr.pos.z - this.pos.z;
      if (dx * dx + dz * dz > 30) continue;
      if (pr.pos.y > this.pos.y + t.h + 1.2) continue;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < t.wid / 2 + pr.r && Math.abs(lz) < t.len / 2 + pr.r) {
        if (this.bedZone && lz > this.bedZone.z0 - 0.3 && lz < this.bedZone.z1 + 0.3 && pr.pos.y > this.pos.y + this.bedZone.y - 0.2) continue;
        pr.vel.copy(_f).multiplyScalar(this.speed * 1.2 + Math.sign(this.speed) * 2);
        pr.vel.y = 3 + sp * 0.15;
        pr.pos.addScaledVector(pr.vel, 0.03);
      }
    }
  }

  // Props that land in a truck bed ride along.
  catchCargo() {
    if (!this.bedZone) return;
    const bz = this.bedZone, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle || pr.cargoOf) continue;
      const dx = pr.pos.x - this.pos.x, dz = pr.pos.z - this.pos.z;
      if (dx * dx + dz * dz > 30) continue;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ly = pr.pos.y - this.pos.y;
      if (Math.abs(lx) < bz.x && lz > bz.z0 && lz < bz.z1 && ly > bz.y - 0.5 && ly < bz.y + 2.2 && pr.vel.y <= 0.5) {
        pr.cargoOf = this;
        pr.cargoLocal = new THREE.Vector3(clamp(lx, -bz.x + pr.r, bz.x - pr.r), bz.y + pr.r + 0.05 * this.cargo.length, clamp(lz, bz.z0 + pr.r, bz.z1 - pr.r));
        this.cargo.push(pr);
        sfx.pop();
      }
    }
  }

  sync() {
    const m = this.mesh;
    if (G.camera) {
      const cp = G.camera.position, dx = cp.x - this.pos.x, dz = cp.z - this.pos.z, far = this.type.airliner ? 2000 : 650;
      m.visible = dx * dx + dz * dz < far * far;
      if (!m.visible) return;
    }
    if (this.steerWheels) for (const p of this.steerWheels) p.rotation.y = (this.steerA || 0) * 0.9;
    m.position.copy(this.pos);
    m.rotation.set(0, this.yaw, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
    if (this.carLike) {
      // cars roll over around their middle, so a car on its roof sits on its roof
      const hc = this.type.h * 0.5;
      _t.set(0, hc, 0).applyEuler(this.body.rotation);
      this.body.position.set(-_t.x, this.bounce + hc - _t.y, -_t.z);
    } else this.body.position.set(0, this.bounce, 0);
    for (const w of this.wheels) w.rotation.x += this.speed * 0.016 / Math.max(0.3, this.type.wr);
    if (this.prop) this.prop.rotation.z += (this.driver || this.remoteDriver ? 0.3 + (this.throttle || 0) * 0.8 + Math.abs(this.speed) * 0.02 : 0);
    if (this.rotor) { this.rotor.rotation.y += this.rotorSpeed * 0.5; this.tailRotor.rotation.x += this.rotorSpeed * 0.6; }
    if (this.subProp) {
      this.subProp.rotation.z += this.speed * 0.06 + (this.driver || this.remoteDriver ? 0.05 : 0);
      const on = !!(this.driver || this.remoteDriver);
      const inside = G.cam && G.cam.fp && G.player && G.player.vehicle === this;
      for (const b of this.beams) b.visible = on && !inside;
      for (const l of this.lamps) l.material.emissiveIntensity = on ? 2.2 : 0.2;
    }
    if (this.siren) {
      const lit = this.driver && (this.driver.isPlayer || this.chase || !this.driver.cop);
      const on = lit && Math.floor(G.time * 4) % 2 === 0;
      this.siren[0].material.emissiveIntensity = lit ? (on ? 1.5 : 0.1) : 0.1;
      this.siren[1].material.emissiveIntensity = lit ? (on ? 0.1 : 1.5) : 0.1;
    }
    // cargo follows the truck
    if (this.cargo.length) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      this.cargo = this.cargo.filter(pr => pr.cargoOf === this && !pr.dead);
      for (const pr of this.cargo) {
        const l = pr.cargoLocal;
        pr.pos.set(this.pos.x + l.x * c + l.z * s, this.pos.y + l.y + this.bounce, this.pos.z - l.x * s + l.z * c);
        pr.vel.set(0, 0, 0);
      }
    }
  }

  update(dt) {
    this.effects(dt);
    if (this.twister) { this.sync(); return; }        // spinning round inside a tornado
    if (this.type.rail || this.type.ride) {             // moved by its track (train.js / park.js)
      if (this.remoteDriver) { this.netT += dt; if (this.netT > 2) this.remoteDriver = null; }
      this.sync(); return;
    }
    if (this.remoteDriver) {
      if (this.net) {
        const k = 1 - Math.exp(-dt * 12);
        this.pos.lerp(_t.set(this.net.x, this.net.y, this.net.z), k);
        if (this.pos.distanceToSquared(_t) > 400) this.pos.copy(_t);
        this.yaw = angleLerp(this.yaw, this.net.yaw, k); this.moveYaw = this.yaw;
        this.pitch = lerp(this.pitch, this.net.pitch, k); this.roll = lerp(this.roll, this.net.roll, k);
        this.speed = this.net.spd;
        if (this.type.heli) this.rotorSpeed = 1;
      }
      this.netT += dt;
      if (this.netT > 2) { this.remoteDriver = null; this.speed = 0; }
    } else if (!this.driver && !this.aiDriven) {
      // coasting / falling while nobody drives
      if (this.type.plane) {
        if (!this.onGround || this.speed > 0.05) { this.throttle = Math.max(0, (this.throttle || 0) - dt * 0.3); this.planeFly(dt, { throttle: 0, steer: 0, up: false, down: !this.onGround && Math.random() < 0.5 }); }
      } else if (this.type.sub) {
        if (this.pos.y < WATER_Y - 2.11 || Math.abs(this.speed) > 0.01) this.subDrive(dt, { throttle: 0, steer: 0, up: false, down: false, idle: true });
        if (this.vy < 0.5) this.vy += dt * 0.3;
      } else if (this.type.rail || this.type.ride) {
        /* moved by its track */
      } else if (this.type.heli) {
        this.rotorSpeed = Math.max(0, this.rotorSpeed - dt * 0.3);
        if (!this.onGround || this.speed !== 0) this.fly(dt, { throttle: 0, steer: 0, up: false, down: false });
      } else if (Math.abs(this.speed) > 0.01 || !this.onGround || this.bounceV !== 0 || this.type.boat) {
        const ps = this.speed;
        this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 8 * dt);
        this.steerVis = 0;
        this.physics(dt, ps);
        if (Math.abs(this.bounce) < 0.001 && Math.abs(this.bounceV) < 0.01) { this.bounce = 0; this.bounceV = 0; }
      }
    }
    this.sync();
  }

  effects(dt) {
    const hurt = this.damage > 80 || this.wrecked || this.lostWheels || Object.keys(this.lost).length;
    if (!hurt) { this.idleT = 0; return; }
    const cam = G.camera, d2 = cam ? cam.position.distanceToSquared(this.pos) : 0;
    this.fxT = (this.fxT || 0) - dt;
    if (this.burnT > 0) this.burnT -= dt;
    if ((this.damage > 80 || this.wrecked) && this.fxT <= 0 && d2 < 90000) {
      this.fxT = this.wrecked ? 0.09 : 0.25;
      this.forward(_f);
      _c1.copy(this.pos).addScaledVector(_f, this.type.plane ? 0 : this.type.len * 0.3); _c1.y += this.type.h * 0.6;
      if (this.wrecked && this.burnT > 0) fire(_c1, 2, this.type.airliner ? 3 : 1);
      smoke(_c1, 1, this.damage > 120 || this.wrecked);
    }
    // wrecks get towed away (repaired) once nobody is using them and nobody is watching
    if (!this.driver && !this.remoteDriver) {
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT > 45 && d2 > 8100) this.repair();
    } else this.idleT = 0;
  }
  repair() {
    G.scene.remove(this.mesh);
    this.wheels = []; this.steerWheels = null; this.pieces = null; this.prop = null; this.frontWheel = null; this.siren = null; this.cockpit = null;
    this.mesh = buildMesh(this);
    G.scene.add(this.mesh);
    this.damage = 0; this.wrecked = false; this.flipped = false; this.tumbling = false; this.lostWheels = 0; this.pull = 0; this.lost = {};
    this.roll = 0; this.pitch = 0; this.fp = 0; this.idleT = 0; this.burnT = 0; this.speed = 0;
    this.sync();
  }

  netState() {
    const r = (x) => Math.round(x * 100) / 100;
    return { id: this.id, t: this.typeId, c: this.color, x: r(this.pos.x), y: r(this.pos.y), z: r(this.pos.z), yaw: r(this.yaw), pitch: r(this.pitch), roll: r(this.roll), spd: r(this.speed) };
  }

  destroy() {
    for (const ch of [...this.occupants]) if (ch) this.removeOccupant(ch);
    for (const pr of this.cargo) pr.cargoOf = null;
    G.scene.remove(this.mesh);
    const i = G.vehicles.indexOf(this);
    if (i >= 0) G.vehicles.splice(i, 1);
  }
}

// Vehicle-vs-vehicle bumping
export function bumpVehicles() {
  const vs = G.vehicles;
  for (const v of vs) if (v.bumpCD) v.bumpCD = Math.max(0, v.bumpCD - 1 / 60);
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
    const a = vs[i], b = vs[j];
    if (a.type.heli !== b.type.heli && (a.pos.y > b.pos.y + 3 || b.pos.y > a.pos.y + 3)) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const min = (a.type.len + b.type.len) * 0.3;
    if (d < min && d > 0.01 && Math.abs(a.pos.y - b.pos.y) < 2) {
      const push = (min - d) / d * 0.5;
      const am = a.remoteDriver || a.type.rail || a.type.ride ? 0 : 1, bm = b.remoteDriver || b.type.rail || b.type.ride ? 0 : 1;
      if (!am && !bm) continue;
      if (a.type.bumper && b.type.bumper && G.bumperBounce && !a.bumpCD) { G.bumperBounce(a, b); a.bumpCD = b.bumpCD = 0.3; }
      a.pos.x -= dx * push * am; a.pos.z -= dz * push * am;
      b.pos.x += dx * push * bm; b.pos.z += dz * push * bm;
      const nx = dx / d, nz = dz / d;
      const closing = (Math.sin(a.yaw) * a.speed - Math.sin(b.yaw) * b.speed) * nx + (Math.cos(a.yaw) * a.speed - Math.cos(b.yaw) * b.speed) * nz;
      if (closing > 9 && !a.type.plane && !b.type.plane && !a.type.bumper && !b.type.bumper) {
        if (am) a.crash(closing * 0.8, { nx: -nx, nz: -nz });
        if (bm) b.crash(closing * 0.8, { nx, nz });
        if (closing > 16) for (const v of [a, b]) if (v.driver && !v.remoteDriver) v.ejectAll(closing);
      }
      const avg = (a.speed + b.speed) * 0.5;
      if (am) a.speed = lerp(a.speed, avg, 0.5);
      if (bm) b.speed = lerp(b.speed, avg, 0.5);
    }
  }
}

function wrapA(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }
function pointHitsWorld(p) {
  const h = baseHeight(p.x, p.z);
  if (p.y < h - 0.05) return true;
  if (p.y < WATER_Y - 0.2 && h < WATER_Y) return true;
  for (const c of nearColliders(p.x, p.z)) if (!c.off && c.tag !== 'tree' && p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) return c;
  return false;
}
// how heavy each vehicle is when it slams into a building, and how hard each plane part hits
function massOf(t) { return t.airliner ? 50 : t.plane ? (t.name === 'Biplane' ? 4 : 8) : t.heli ? 4 : t.truck ? 3 : t.wr > 0.8 ? 2.5 : t.isBike ? 0.4 : t.scooter ? 0.5 : 1.2; }
const PART_HIT = { body: 1, engL: 0.5, engR: 0.5, engine: 0.5, wingL: 0.35, wingR: 0.35, tail: 0.3 };
let _charMat = null;
function charMat() { return _charMat || (_charMat = new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.95, metalness: 0.1 })); }

export function randomCarColor() {
  return pick(['#3fa7ff', '#ff5b6e', '#46c25a', '#b46cff', '#ffffff', '#4a4f5a', '#ff8a3d', '#3fd6d0']);
}
export { rand };
