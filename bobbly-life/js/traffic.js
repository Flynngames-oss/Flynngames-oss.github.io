// Friendly town traffic: cars that drive loops around the blocks (steal one with E!).
import * as THREE from 'three';
import { G, pick } from './state.js';
import { Vehicle, randomCarColor } from './vehicles.js';

const cars = [];
const LANE = 2.6;
// Loops follow the town roads (x/z = road centre lines), driving on the inside lane.
const LOOPS = [
  [-30, 30, -30, 30], [30, 90, -30, 30], [-90, -30, -30, 30], [-30, 30, 30, 90], [-30, 30, -90, -30],
  [-90, 90, -90, 90], [-150, 150, -150, 150], [30, 150, 30, 150], [-150, -30, -150, -30],
];

function loopPoints([x0, x1, z0, z1]) {
  return [
    { x: x0 + LANE, z: z0 + LANE }, { x: x1 - LANE, z: z0 + LANE },
    { x: x1 - LANE, z: z1 - LANE }, { x: x0 + LANE, z: z1 - LANE },
  ];
}

export function initTraffic(n = 12) {
  for (let i = 0; i < n; i++) {
    const pts = loopPoints(LOOPS[i % LOOPS.length]);
    const start = Math.floor(Math.random() * 4);
    const a = pts[start], b = pts[(start + 1) % 4];
    const t = 0.2 + Math.random() * 0.5;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const type = pick(['sedan', 'sedan', 'sedan', 'taxi', 'sports', 'pickup', 'icecream']);
    const v = new Vehicle(type, x, z, Math.atan2(b.x - a.x, b.z - a.z), { id: 't' + i, color: type === 'sedan' ? randomCarColor() : null });
    v.traffic = { pts, idx: (start + 1) % 4, cruise: 9 + Math.random() * 3 };
    cars.push(v);
  }
}

const _f = new THREE.Vector3();
export function updateTraffic(dt, onRemoteHit) {
  for (const v of cars) {
    const T = v.traffic;
    if (!T) continue;
    // someone took it: it becomes a normal car
    if (v.driver || v.remoteDriver) { v.traffic = null; continue; }
    const p = T.pts[T.idx];
    const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
    if (Math.hypot(dx, dz) < 3.5) T.idx = (T.idx + 1) % T.pts.length;
    const want = Math.atan2(dx, dz);
    let diff = ((want - v.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    // look ahead for people and cars
    v.forward(_f);
    let blocked = false;
    for (const ch of G.characters) {
      if (ch.vehicle) continue;
      const P = ch.ragdoll || ch.isRemote ? ch.p[0] : ch.root;
      const ax = P.x - v.pos.x, az = P.z - v.pos.z;
      const ahead = ax * _f.x + az * _f.z, side = Math.abs(ax * _f.z - az * _f.x);
      if (ahead > 0 && ahead < 8 && side < 2.2) { blocked = true; break; }
    }
    if (!blocked) for (const o of G.vehicles) {
      if (o === v) continue;
      const ax = o.pos.x - v.pos.x, az = o.pos.z - v.pos.z;
      const ahead = ax * _f.x + az * _f.z, side = Math.abs(ax * _f.z - az * _f.x);
      if (ahead > 0 && ahead < 9 && side < 2.5) { blocked = true; break; }
    }
    // don't wait forever (avoids jams at crossings)
    if (blocked) { T.wait = (T.wait || 0) + dt; if (T.wait > 3) { blocked = false; if (T.wait > 4.5) T.wait = 0; } } else T.wait = 0;
    const target = blocked ? 0 : Math.abs(diff) > 0.5 ? 5 : T.cruise;
    const inp = { throttle: v.speed < target ? 1 : v.speed > target + 1 ? -0.6 : 0, steer: Math.max(-1, Math.min(1, diff * 2.5)), brake: blocked, up: false, down: false };
    v.drive(dt, inp);
    if (Math.abs(v.speed) > 4) v.hitThings(onRemoteHit);
  }
}
