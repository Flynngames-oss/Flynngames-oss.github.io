// Drivable vehicles: arcade car physics, ramps launch you, crashes eject you.
import * as THREE from 'three';
import { G, mat, clamp, lerp, angleLerp, WATER_Y, rand, pick } from './state.js';
import { groundHeight, resolveWalls, baseHeight, getGroundTag } from './world.js';
import { sfx } from './audio.js';

export const VTYPES = {
  sedan:     { name: 'Sedan', emo: '🚗', price: 300, len: 4.2, wid: 2.0, h: 1.0, wr: 0.42, max: 25, acc: 15, turn: 1.9, color: '#3fa7ff', seats: 2 },
  taxi:      { name: 'Taxi', emo: '🚕', price: 400, len: 4.3, wid: 2.0, h: 1.0, wr: 0.42, max: 25, acc: 15, turn: 1.9, color: '#ffd54a', seats: 2, taxi: true },
  scooter:   { name: 'Pizza Scooter', emo: '🛵', price: 150, len: 2.0, wid: 0.9, h: 0.7, wr: 0.32, max: 19, acc: 13, turn: 2.5, color: '#e84a3f', seats: 1, open: true, scooter: true },
  sports:    { name: 'Sports Car', emo: '🏎️', price: 1200, len: 4.4, wid: 2.0, h: 0.8, wr: 0.4, max: 38, acc: 24, turn: 2.1, color: '#ff3b3b', seats: 2 },
  pickup:    { name: 'Pickup Truck', emo: '🛻', price: 600, len: 5.0, wid: 2.1, h: 1.2, wr: 0.5, max: 23, acc: 14, turn: 1.7, color: '#8b5a2b', seats: 2, bed: true },
  icecream:  { name: 'Ice Cream Van', emo: '🍦', price: 700, len: 5.0, wid: 2.2, h: 1.6, wr: 0.48, max: 20, acc: 11, turn: 1.6, color: '#ffd6e8', seats: 2, van: true },
  garbage:   { name: 'Garbage Truck', emo: '🚛', price: 900, len: 6.6, wid: 2.4, h: 1.5, wr: 0.6, max: 19, acc: 10, turn: 1.4, color: '#46a05a', seats: 2, bed: true, truck: true },
  police:    { name: 'Police Car', emo: '🚓', price: 1500, len: 4.4, wid: 2.0, h: 1.0, wr: 0.42, max: 31, acc: 19, turn: 2.0, color: '#ffffff', seats: 2, siren: true },
  monster:   { name: 'Monster Truck', emo: '🚙', price: 1800, len: 4.8, wid: 2.8, h: 1.1, wr: 1.05, max: 27, acc: 17, turn: 1.8, color: '#46c25a', seats: 2 },
  firetruck: { name: 'Fire Truck', emo: '🚒', price: 2500, len: 7.2, wid: 2.5, h: 1.6, wr: 0.6, max: 21, acc: 10, turn: 1.4, color: '#e84a3f', seats: 2, truck: true, ladder: true },
  boat:      { name: 'Speed Boat', emo: '🚤', price: 1000, len: 5.0, wid: 2.2, h: 0.9, wr: 0, max: 24, acc: 12, turn: 1.6, color: '#ffffff', seats: 2, boat: true },
  biplane:   { name: 'Biplane', emo: '🛩️', price: 2000, len: 5.4, wid: 1.4, h: 1.6, wr: 0.4, max: 40, acc: 10, turn: 1.3, color: '#ff5b6e', seats: 1, plane: true, takeoff: 16 },
  jet:       { name: 'Jet Plane', emo: '✈️', price: 5000, len: 8.0, wid: 1.6, h: 1.8, wr: 0.4, max: 70, acc: 16, turn: 1.1, color: '#e8eef5', seats: 1, plane: true, takeoff: 24 },
  heli:      { name: 'Helicopter', emo: '🚁', price: 3000, len: 5.0, wid: 2.2, h: 1.8, wr: 0, max: 30, acc: 14, turn: 1.6, color: '#ff8a3d', seats: 2, heli: true },
};

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

function buildMesh(v) {
  const t = v.type, c = v.color;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  v.wheels = [];
  const L = t.len, W = t.wid, H = t.h, wr = t.wr;
  const base = wr + 0.1;
  const glass = { transparent: true, opacity: 0.55 };
  if (t.plane && t.name === 'Biplane') {
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
  } else {
    // wheels
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = part(body, '#222', sx * (W / 2 - 0.05), wr, sz * L * 0.32, 0.35, wr, wr, WHEEL);
      part(w, '#ddd', sx * 0.52, 0, 0, 0.1, 0.5, 0.5, WHEEL);
      v.wheels.push(w);
    }
    if (t.truck || t.van) {
      // cab at front
      const cabL = t.van ? L : 2.0;
      const cabZ = t.van ? 0 : L / 2 - cabL / 2;
      part(body, c, 0, base + 0.35, 0, W, 0.7, L);
      part(body, c, 0, base + 0.7 + H / 2, cabZ, W, H, cabL);
      part(body, '#bfe6ff', 0, base + 0.7 + H * 0.6, cabZ + cabL / 2, W * 0.85, H * 0.5, 0.06, BOX, glass);
      if (t.ladder) {
        part(body, '#c0c0c0', 0, base + 1.3, -1.2, 1.2, 0.5, L - 2.6);
        for (let z = -3.8; z < 1.2; z += 0.6) part(body, '#9aa4b1', 0, base + 1.6, z, 1.2, 0.08, 0.08);
        part(body, '#ffd54a', 0, base + 0.85, 0, W + 0.02, 0.1, L - 0.2);
        v.siren = [part(body, '#ff2020', -0.4, base + 0.8 + H, L / 2 - 1, 0.3, 0.2, 0.3, BOX, { emissive: '#ff0000' }), part(body, '#ff2020', 0.4, base + 0.8 + H, L / 2 - 1, 0.3, 0.2, 0.3, BOX, { emissive: '#ff0000' })];
      } else if (t.bed) {
        // open container (garbage truck)
        const bl = L - 2.2, bz = -L / 2 + bl / 2;
        part(body, c, 0, base + 1.2, bz - bl / 2 + 0.1, W, 1.6, 0.2);
        for (const s of [-1, 1]) part(body, c, s * (W / 2 - 0.1), base + 1.2, bz, 0.2, 1.6, bl);
        part(body, '#2a6a3a', 0, base + 1.2, bz + bl / 2 - 0.1, W, 1.6, 0.2);
        v.bedZone = { z0: bz - bl / 2 + 0.2, z1: bz + bl / 2 - 0.2, x: W / 2 - 0.2, y: base + 0.7 };
      }
      if (t.van) {
        part(body, '#fff6e0', 0, base + 0.7 + H + 0.9, -0.6, 0.5, 1.0, 0.5, new THREE.ConeGeometry(0.6, 1, 10)).rotation.x = Math.PI;
        part(body, '#ffb0d8', 0, base + 0.7 + H + 1.5, -0.6, 0.7, 0.7, 0.7, new THREE.SphereGeometry(0.6, 12, 10));
        part(body, '#8b5a2b', W / 2 + 0.01, base + 1.3, -0.6, 0.05, 0.7, 1.6);
      }
      v.seats = [[0.45, base + 0.15, cabZ + (t.van ? 1.2 : 0.1)], [-0.45, base + 0.15, cabZ + (t.van ? 1.2 : 0.1)]];
    } else {
      const bodyH = t.h * 0.55;
      part(body, c, 0, base + bodyH / 2 + 0.1, 0, W, bodyH, L);
      part(body, c, 0, base + bodyH + 0.12, L * 0.33, W * 0.98, 0.1, L * 0.3);      // hood
      part(body, c, 0, base + bodyH + 0.12, -L * 0.36, W * 0.98, 0.1, L * 0.24);     // trunk
      part(body, '#bfe6ff', 0, base + bodyH + 0.45, L * 0.16, W * 0.9, 0.6, 0.06, BOX, glass);
      part(body, '#5a3a2a', 0, base + bodyH + 0.15, -0.35, W * 0.8, 0.5, 0.3);      // seat backs
      if (t.taxi) { part(body, '#222', 0, base + bodyH + 0.14, 0, W + 0.01, 0.12, L * 0.5); part(body, '#ffd54a', 0, base + bodyH + 1.3, -0.5, 0.9, 0.3, 0.4, BOX, { emissive: '#aa8800', emissiveIntensity: 0.5 }); part(body, '#222', 0, base + bodyH + 0.8, -0.5, 0.06, 0.8, 0.06); }
      if (t.siren) {
        part(body, '#222', 0, base + bodyH + 0.14, 0, W + 0.01, 0.12, L * 0.9);
        part(body, '#222', 0, base + bodyH + 0.8, -0.5, 0.06, 0.8, 0.06);
        v.siren = [part(body, '#ff2020', -0.3, base + bodyH + 1.25, -0.5, 0.5, 0.2, 0.3, BOX, { emissive: '#ff0000' }), part(body, '#2050ff', 0.3, base + bodyH + 1.25, -0.5, 0.5, 0.2, 0.3, BOX, { emissive: '#0030ff' })];
      }
      if (t.name === 'Sports Car') { part(body, '#222', 0, base + bodyH + 0.55, -L / 2 + 0.2, W, 0.08, 0.5); for (const s of [-1, 1]) part(body, '#222', s * 0.7, base + bodyH + 0.35, -L / 2 + 0.2, 0.08, 0.4, 0.08); }
      if (t.bed) {
        // pickup bed walls
        for (const s of [-1, 1]) part(body, c, s * (W / 2 - 0.08), base + bodyH + 0.35, -L * 0.3, 0.16, 0.5, L * 0.4);
        part(body, c, 0, base + bodyH + 0.35, -L / 2 + 0.08, W, 0.5, 0.16);
        v.bedZone = { z0: -L / 2 + 0.2, z1: -L * 0.1, x: W / 2 - 0.25, y: base + bodyH + 0.1 };
      }
      if (t.wr > 0.8) for (const s of [-1, 1]) part(body, '#4a4f5a', s * 0.5, base - 0.2, 0, 0.2, 0.9, 0.2);
      v.seats = [[0.45, base + 0.05, -0.1], [-0.45, base + 0.05, -0.1]];
    }
    // lights
    part(body, '#fff6b0', 0.6, base + 0.35, L / 2 + 0.01, 0.35, 0.2, 0.05, BOX, { emissive: '#ffee88', emissiveIntensity: 0.6 });
    part(body, '#fff6b0', -0.6, base + 0.35, L / 2 + 0.01, 0.35, 0.2, 0.05, BOX, { emissive: '#ffee88', emissiveIntensity: 0.6 });
    part(body, '#ff3030', 0.7, base + 0.35, -L / 2 - 0.01, 0.3, 0.18, 0.05, BOX, { emissive: '#aa0000' });
    part(body, '#ff3030', -0.7, base + 0.35, -L / 2 - 0.01, 0.3, 0.18, 0.05, BOX, { emissive: '#aa0000' });
  }
  v.body = body;
  return root;
}

let personalCounter = 0;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _t = new THREE.Vector3();

export class Vehicle {
  constructor(typeId, x, z, yaw = 0, { id = null, color = null, owner = null } = {}) {
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
    this.occupants = [null, null];
    this.cargo = [];
    this.remoteDriver = null; this.netT = 0;
    this.mesh = buildMesh(this);
    G.scene.add(this.mesh);
    G.vehicles.push(this);
    this.sync();
  }

  get driver() { return this.occupants[0]; }
  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  seatPos(i, out) {
    const s = this.seats[Math.min(i, this.seats.length - 1)];
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
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
    const prevSpeed = this.speed;
    const inWater = t.boat;
    const canDrive = inWater ? true : this.onGround;
    if (canDrive) {
      if (inp.throttle > 0) this.speed += (this.speed < 0 ? 30 : t.acc) * inp.throttle * dt;
      else if (inp.throttle < 0) this.speed -= (this.speed > 0 ? 30 : t.acc * 0.6) * -inp.throttle * dt;
      else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 5 * dt);
      if (inp.brake) this.speed *= 1 - Math.min(1, 3 * dt);
      this.speed = clamp(this.speed, -t.max * 0.4, t.max);
      const turnK = clamp(this.speed / 7, -1, 1) * (inp.brake ? 1.5 : 1);
      this.yaw += inp.steer * t.turn * turnK * dt;
      this.steerVis = lerp(this.steerVis || 0, inp.steer, 0.2);
    }
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
      fp += ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * 1.1 * dt;
      if (!inp.up && !inp.down) fp *= 1 - Math.min(1, dt * 0.5); // gently levels out
      if (this.speed < t.takeoff * 0.8) fp -= 0.9 * dt;
      fp = clamp(fp, -1.1, 1.0);
      this.roll = lerp(this.roll, -inp.steer * 0.8, 0.06);
      this.yaw += inp.steer * t.turn * dt;
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
      if (!this.onGround && (fp < -0.3 || Math.abs(this.roll) > 0.6 || water)) this.planeCrash(water);
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
    if (this.driver || this.occupants[1]) this.ejectAll(14);
  }

  physics(dt, prevSpeed = this.speed) {
    const t = this.type;
    this.forward(_f);
    this.pos.addScaledVector(_f, this.speed * dt);
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
      this.pitch = lerp(this.pitch, -Math.atan2(gf - gb, L * 2), 0.3);
    } else this.pitch = lerp(this.pitch, clamp(this.vy * 0.03, -0.5, 0.4) * -1, 0.05);
    this.roll = lerp(this.roll, (this.steerVis || 0) * this.speed * 0.01, 0.1);
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
        this.yaw = angleLerp(this.yaw, this.net.yaw, k);
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
