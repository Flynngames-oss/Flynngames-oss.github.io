// Drivable vehicles: arcade car physics, ramps launch you, crashes eject you.
import * as THREE from 'three';
import { G, mat, clamp, lerp, angleLerp, WATER_Y, rand, pick } from './state.js';
import { groundHeight, resolveWalls, baseHeight, getGroundTag } from './world.js';
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
  airliner:  { name: 'Airliner', emo: '🛫', price: 25000, len: 40, wid: 4.2, h: 7, wr: 0.6, max: 90, acc: 3.2, turn: 0.38, color: '#f4f6f8', seats: 8, plane: true, airliner: true, takeoff: 48 },
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
    body.add(meshesFrom(am.parts, airlinerMaterials(v.livery ?? Math.abs(h) % LIVERY_COUNT)));
    const fy = am.fy;
    part(body, '#2a2b2e', 0, fy - 0.9, 17.6, 1.9, 0.5, 0.6);
    v.seats = [[0.55, fy - 1.75, 16.4], [-0.55, fy - 1.75, 16.4]];
    for (const z of [10, 7, 4]) v.seats.push([1.0, fy - 1.85, z], [-1.0, fy - 1.85, z]);
  } else if (t.isBike) {
    const B = t.bike, sc = B.scale || 1;
    const bm = bikeModel(sc);
    const bike = new THREE.Group();       // pivot at the rear contact patch (for wheelies)
    bike.position.z = -bm.wb / 2;
    body.add(bike);
    bike.add(meshesFrom(bm.parts, bikeMaterials(B)));
    const mkWheel = (z, parts) => { const w = new THREE.Group(); w.position.set(0, bm.r, z); w.add(meshesFrom(parts)); bike.add(w); v.wheels.push(w); return w; };
    mkWheel(0, bm.wheels[0]); v.frontWheel = mkWheel(bm.wb, bm.wheels[1]);
    v.bikeWb = bm.wb;
    v.seats = [[0, 1.12 * sc - 0.5, (0.5 - 0.65) * sc]];
  } else if (t.plane && t.name === 'Biplane') {
    part(body, c, 0, 1.2, 0, 1.1, 1.1, 5);
    const eng = part(body, '#4a4f5a', 0, 1.2, 2.65, 0.6, 0.4, 0.6, new THREE.CylinderGeometry(1, 1, 1, 12)); eng.rotation.x = Math.PI / 2;
    v.prop = new THREE.Group(); v.prop.position.set(0, 1.2, 2.95);
    part(v.prop, '#6b4a2b', 0, 0, 0, 0.18, 2.6, 0.06); part(v.prop, '#6b4a2b', 0, 0, 0, 2.6, 0.18, 0.06);
    body.add(v.prop);
    part(body, '#ffd54a', 0, 0.75, 0.9, 9, 0.12, 1.4);
    part(body, '#ffd54a', 0, 2.4, 0.9, 9, 0.12, 1.4);
    for (const x of [-3.2, 3.2]) for (const z of [0.4, 1.4]) part(body, '#6b4a2b', x, 1.58, z, 0.08, 1.6, 0.08);
    part(body, c, 0, 1.4, -2.3, 3, 0.1, 0.8);
    part(body, c, 0, 2.0, -2.35, 0.1, 1.2, 0.8);
    for (const x of [-0.8, 0.8]) { v.wheels.push(part(body, '#222', x, 0.4, 1.3, 0.2, 0.4, 0.4, WHEEL)); part(body, '#4a4f5a', x * 0.7, 0.6, 1.3, 0.08, 0.5, 0.08); }
    part(body, '#222', 0, 0.2, -2.3, 0.1, 0.2, 0.2, WHEEL);
    part(body, '#bfe6ff', 0, 1.95, 0.4, 0.9, 0.4, 0.06, BOX, glass);
    v.seats = [[0, 0.9, -0.4]];
  } else if (t.plane) {
    part(body, c, 0, 1.3, 0, 1.3, 1.2, 7);
    const nose = part(body, c, 0, 1.3, 4.3, 0.65, 1.6, 0.6, new THREE.ConeGeometry(1, 1, 12)); nose.rotation.x = Math.PI / 2;
    part(body, '#8fd3ff', 0, 1.95, 1.4, 0.9, 0.7, 2.2, new THREE.SphereGeometry(0.5, 14, 10), glass);
    for (const sx of [-1, 1]) {
      const w = part(body, '#3fa7ff', sx * 2.6, 1.15, -0.4, 4.4, 0.15, 2.2); w.rotation.y = -sx * 0.35;
      const st = part(body, '#3fa7ff', sx * 1.1, 1.45, -3.1, 1.8, 0.12, 1); st.rotation.y = -sx * 0.3;
    }
    part(body, '#3fa7ff', 0, 2.4, -3.1, 0.15, 1.8, 1.4);
    part(body, '#ff8a3d', 0, 1.3, -3.6, 0.5, 0.5, 0.3, new THREE.CylinderGeometry(1, 1, 1, 12), { emissive: '#ff5500', emissiveIntensity: 0.8 }).rotation.x = Math.PI / 2;
    for (const [x, z] of [[-0.9, -0.5], [0.9, -0.5], [0, 2.8]]) { v.wheels.push(part(body, '#222', x, 0.4, z, 0.2, 0.4, 0.4, WHEEL)); part(body, '#4a4f5a', x, 0.65, z, 0.08, 0.5, 0.08); }
    v.seats = [[0, 1.0, 1.2]];
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
    this.pos.y = this.type.boat ? WATER_Y - 0.1 : groundHeight(x, z, 50, 0.5);
    this.yaw = yaw; this.speed = 0; this.vy = 0; this.onGround = true;
    this.pitch = 0; this.roll = 0; this.bounce = 0; this.bounceV = 0;
    this.hvel = new THREE.Vector3(); // helicopter horizontal velocity
    this.rotorSpeed = 0;
    this.cargo = [];
    this.remoteDriver = null; this.netT = 0;
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
    if (t.heli) return this.fly(dt, inp);
    if (t.plane) return this.planeFly(dt, inp);
    if (t.isBike) return this.ride(dt, inp);
    const prevSpeed = this.speed;
    const inWater = t.boat;
    const canDrive = inWater ? true : this.onGround;
    if (canDrive) {
      const sp = this.speed, ratio = Math.min(1, Math.abs(sp) / t.max);
      // engine: strong off the line, fading near top speed
      if (inp.throttle > 0) {
        if (sp < -0.5) this.speed += 26 * inp.throttle * dt;                           // braking while reversing
        else this.speed += t.acc * (1 - ratio * ratio * 0.85) * inp.throttle * dt;
      } else if (inp.throttle < 0) {
        if (sp > 0.5) this.speed -= 26 * -inp.throttle * dt;                           // brakes
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
      const latMax = (t.sports ? 12 : t.truck ? 7 : 10) / Math.max(1, Math.abs(this.speed));
      yawRate = clamp(yawRate, -latMax, latMax);
      if (inp.brake && Math.abs(this.speed) > 7) yawRate *= 1.8;                       // handbrake turn
      this.yaw += yawRate * dt;
      this.steerVis = this.steerA / 0.6;
      // grip: the direction of travel catches up with where the car points
      if (this.moveYaw === undefined) this.moveYaw = this.yaw;
      const grip = inp.brake ? 1.8 : t.boat ? 2.5 : 9 - ratio * 3;
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
    this.wheelie = 0; this.wv = 0; this.pitch = 0; this.roll = 1.3;
    const sp = this.speed; this.speed = 0;
    if (d) {
      this.ejectAll(Math.max(6, Math.abs(sp)));
      if (d.isPlayer && G.toast) G.toast(msg, 'bad');
    }
    setTimeout(() => { this.roll = 0; }, 2500);
  }

  planeFly(dt, inp) {
    const t = this.type;
    this.throttle = clamp((this.throttle || 0) + inp.throttle * dt * 0.7, 0, 1);
    let fp = this.fp || 0;
    const target = this.throttle * t.max;
    this.speed += clamp(target - this.speed, -5 * dt, t.acc * dt);
    if (this.onGround) {
      if (inp.throttle < 0) this.speed = Math.max(0, this.speed - 14 * dt);
      this.yaw += inp.steer * t.turn * dt * clamp(this.speed / 8, 0, 1);
      this.roll = lerp(this.roll, 0, 0.2);
      if (this.speed > t.takeoff && inp.up) { fp = 0.2; this.onGround = false; this.pos.y += 0.2; }
      else fp = lerp(fp, 0, 0.2);
    } else {
      const big = !!t.airliner, bankMax = big ? 0.5 : 0.85;
      fp += ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * (big ? 0.4 : 1.1) * dt;
      if (!inp.up && !inp.down) fp *= 1 - Math.min(1, dt * 0.5); // gently levels out
      if (this.speed < t.takeoff * 0.8) fp -= 0.9 * dt;
      fp = clamp(fp, -1.1, big ? 0.3 : 1.0);
      // bank to turn: the plane rolls first, and the turn follows the bank angle
      this.roll = lerp(this.roll, -inp.steer * bankMax, 1 - Math.exp(-dt * (big ? 1.3 : 3)));
      this.yaw += -this.roll / bankMax * t.turn * dt;
    }
    this.fp = fp;
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
    if (!this.onGround && Math.abs(this.speed) < Math.abs(before) * 0.5) this.planeCrash(false);
  }

  planeCrash(water) {
    if (G.fx) G.fx.boom(this.pos, !water);
    this.fp = 0; this.roll = 0; this.throttle = 0;
    this.speed = 0;
    this.onGround = true;
    if (this.occupants.some(Boolean)) this.ejectAll(14);
  }

  physics(dt, prevSpeed = this.speed) {
    const t = this.type;
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
      this.pitch = lerp(this.pitch, this.slopeP, 0.3);
    } else this.pitch = lerp(this.pitch, clamp(this.vy * 0.03, -0.5, 0.4) * -1, 0.05);
    if (!t.isBike) this.roll = lerp(this.roll, clamp((this.steerA || 0) * this.speed * 0.012 + (this.slip || 0) * 0.3, -0.12, 0.12), 0.1);
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
      if (impact > 4) {
        this.speed *= -0.25;
        this.bounceV += 3;
        if (this.driver && this.driver.isPlayer) sfx.crash();
        if (impact > 17 && this.driver && !t.heli) this.ejectAll(impact);
      } else this.speed *= 1 - along * 0.5;
      if (t.heli && this.hvel) this.speed *= 0.5;
    }
  }

  ejectAll(force) {
    this.forward(_f);
    for (const ch of [...this.occupants]) {
      if (!ch) continue;
      this.removeOccupant(ch);
      _t.copy(_f).multiplyScalar(force * 0.7); _t.y = 7;
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
          else if (!ch.ragdoll) { ch.flop(_t, 2.5); if (this.driver && this.driver.isPlayer) sfx.slap(); }
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
    this.body.position.y = this.bounce;
    this.body.rotation.set(this.pitch, 0, this.roll);
    for (const w of this.wheels) w.rotation.x += this.speed * 0.016 / Math.max(0.3, this.type.wr);
    if (this.prop) this.prop.rotation.z += (this.driver || this.remoteDriver ? 0.3 + (this.throttle || 0) * 0.8 + Math.abs(this.speed) * 0.02 : 0);
    if (this.rotor) { this.rotor.rotation.y += this.rotorSpeed * 0.5; this.tailRotor.rotation.x += this.rotorSpeed * 0.6; }
    if (this.siren) {
      const on = this.driver && Math.floor(G.time * 4) % 2 === 0;
      this.siren[0].material.emissiveIntensity = this.driver ? (on ? 1.5 : 0.1) : 0.1;
      this.siren[1].material.emissiveIntensity = this.driver ? (on ? 0.1 : 1.5) : 0.1;
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
    } else if (!this.driver) {
      // coasting / falling while nobody drives
      if (this.type.plane) {
        if (!this.onGround || this.speed > 0.05) { this.throttle = Math.max(0, (this.throttle || 0) - dt * 0.3); this.planeFly(dt, { throttle: 0, steer: 0, up: false, down: !this.onGround && Math.random() < 0.5 }); }
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
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
    const a = vs[i], b = vs[j];
    if (a.type.heli !== b.type.heli && (a.pos.y > b.pos.y + 3 || b.pos.y > a.pos.y + 3)) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const min = (a.type.len + b.type.len) * 0.3;
    if (d < min && d > 0.01 && Math.abs(a.pos.y - b.pos.y) < 2) {
      const push = (min - d) / d * 0.5;
      const am = a.remoteDriver ? 0 : 1, bm = b.remoteDriver ? 0 : 1;
      a.pos.x -= dx * push * am; a.pos.z -= dz * push * am;
      b.pos.x += dx * push * bm; b.pos.z += dz * push * bm;
      const avg = (a.speed + b.speed) * 0.5;
      if (am) a.speed = lerp(a.speed, avg, 0.5);
      if (bm) b.speed = lerp(b.speed, avg, 0.5);
    }
  }
}

export function randomCarColor() {
  return pick(['#3fa7ff', '#ff5b6e', '#46c25a', '#b46cff', '#ffffff', '#4a4f5a', '#ff8a3d', '#3fd6d0']);
}
export { rand };
