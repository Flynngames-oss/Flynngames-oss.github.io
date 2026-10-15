// Friendly town traffic: cars that drive loops around the blocks (steal one with E!).
import * as THREE from 'three';
import { G, pick } from './state.js';
import { Vehicle, randomCarColor } from './vehicles.js';
import { airlinerModel, airlinerMaterials, meshesFrom } from './models.js';
import { ROADS as TROADS } from './terrain.js';
import { groundHeight } from './world.js';

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
    v.traffic = { pts, idx: (start + 1) % 4, cruise: 11 + Math.random() * 4 };
    v.aiDriven = true;
    cars.push(v);
  }
}

// Cars out on Lanzarote's real roads: they drive along the road on the right-hand side, turn round at the
// end, and when you leave them far behind they reappear on a road somewhere ahead of you.
const ROAD_LANE = 2.3;
function roadSpot(near, dMin = 250, dMax = 1500) {
  const main = TROADS.filter((r) => r.name !== 'street' && r.pts.length > 3);
  for (let k = 0; k < 120 && main.length; k++) {
    const r = main[Math.floor(Math.random() * main.length)];
    const i = 1 + Math.floor(Math.random() * (r.pts.length - 2)), p = r.pts[i];
    const d = Math.hypot(p.x - near.x, p.z - near.z);
    if (d < dMin || d > dMax) continue;
    return { r, i, dir: Math.random() < 0.5 ? 1 : -1 };
  }
  return null;
}
function roadTarget(R) {
  const pts = R.r.pts, a = pts[R.i], b = pts[Math.max(0, Math.min(pts.length - 1, R.i + R.dir))];
  let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  // keep right: (-dz, dx) is the right-hand side of the direction of travel
  return { x: a.x - dz * ROAD_LANE, z: a.z + dx * ROAD_LANE, yaw: Math.atan2(dx, dz) };
}
function putOnRoad(v, R) {
  const t = roadTarget(R);
  v.pos.set(t.x, groundHeight(t.x, t.z, 9999, 0.5), t.z);
  v.yaw = t.yaw; v.speed = 0;
  R.i = Math.max(0, Math.min(R.r.pts.length - 1, R.i + R.dir));
  v.traffic = { road: R, cruise: 15 + Math.random() * 7 };
}
export function initRoadTraffic(n = 10) {
  for (let i = 0; i < n; i++) {
    const R = roadSpot({ x: 0, z: 0 }, 200, 4000);
    if (!R) break;
    const type = pick(['sedan', 'sedan', 'sedan', 'taxi', 'pickup', 'sports', 'sedan']);
    const t = roadTarget(R);
    const v = new Vehicle(type, t.x, t.z, t.yaw, { id: 'rt' + i, color: type === 'sedan' ? randomCarColor() : null });
    putOnRoad(v, R);
    v.aiDriven = true;
    cars.push(v);
  }
}

const _f = new THREE.Vector3();
export function updateTraffic(dt, onRemoteHit) {
  const me = G.player ? (G.player.vehicle ? G.player.vehicle.pos : G.player.root) : null;
  for (const v of cars) {
    const T = v.traffic;
    if (!T) continue;
    // someone took it: it becomes a normal car
    if (v.driver || v.remoteDriver) { if (v.driver && v.driver.isPlayer && G.crime) G.crime('Stealing a car', 2); v.traffic = null; v.aiDriven = false; continue; }
    let p;
    if (T.road) {
      const R = T.road;
      // left far behind: come back on a road near the player
      if (me && Math.hypot(v.pos.x - me.x, v.pos.z - me.z) > 2200) { const R2 = roadSpot(me, 500, 1600); if (R2) putOnRoad(v, R2); continue; }
      p = roadTarget(R);
      if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 6) {
        const nx = R.i + R.dir;
        if (nx < 0 || nx >= R.r.pts.length) R.dir = -R.dir;        // end of the road: turn round
        else R.i = nx;
        p = roadTarget(R);
      }
    } else {
      p = T.pts[T.idx];
      if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 3.5) T.idx = (T.idx + 1) % T.pts.length;
    }
    const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
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

// Airliners cruising over the island (scenery only)
const sky = [];
export function initSkyTraffic() {
  G.skyTraffic = sky;   // (BobTok films them)
  const am = airlinerModel();
  for (let i = 0; i < 3; i++) {
    const m = meshesFrom(am.parts, airlinerMaterials(i), false);
    G.scene.add(m);
    sky.push({ m, a: i * 2.1, r: 2600 + i * 900, alt: 450 + i * 180, sp: (75 + i * 8) / (2600 + i * 900), dir: i % 2 ? -1 : 1 });
  }
}
export function updateSkyTraffic(dt) {
  for (const p of sky) {
    p.a += p.sp * dt * p.dir;
    const c = G.LOC.intl || { x: 0, z: 0 };       // circling over Lanzarote airport
    p.m.position.set(c.x + Math.cos(p.a) * p.r, p.alt, c.z + Math.sin(p.a) * p.r);
    // heading along the circle, banked gently into the turn
    const vx = -Math.sin(p.a) * p.dir, vz = Math.cos(p.a) * p.dir;
    p.m.rotation.set(0, Math.atan2(vx, vz), 0);
    p.m.rotateZ(0.12 * p.dir);
  }
}
