// Police: patrol cars and officers on foot. Break the law where a cop can see it (riding an
// e-bike on the streets, speeding in town, hitting people, stealing cars, smashing buildings,
// blasting people) and you get a wanted level. They chase you, pull you out, handcuff you
// and take you to Bobbly County Jail. Get far enough away for long enough and they give up.
import * as THREE from 'three';
import { G, rand, pick, clamp, textSprite, LAND } from './state.js';
import { Character, SKINS } from './character.js';
import { Vehicle } from './vehicles.js';
import { LOC, addCollider } from './world.js';
import { ZONES, inZone } from './terrain.js';
import { sfx } from './audio.js';

const P = { cars: [], cops: [], wanted: 0, reason: '', lastSeen: 0, lastClose: 0, jailT: 0, arrest: null, crimeCd: 0 };
G.police = P;
const copOutfit = () => { const o = SKINS.find(s => s.id === 'police').o; return { ...o, extras: [...o.extras] }; };
let hud = null, fade = null;

export function isTown(x, z) {
  if (Math.max(Math.abs(x), Math.abs(z)) < LAND + 20) return true;
  const k = inZone(x, z, 10);
  return k === 'city' || k === 'suburb' || k === 'valley' || k === 'village2';
}
const LOOPS = [[-90, 90, -90, 90], [-150, 150, -150, 150], [30, 150, 30, 150], [-450, -270, -220, -40], [-750, -450, -100, 90], [-630, -390, -340, -160]];
const LANE = 2.6;
const loopPts = ([x0, x1, z0, z1]) => [{ x: x0 + LANE, z: z0 + LANE }, { x: x1 - LANE, z: z0 + LANE }, { x: x1 - LANE, z: z1 - LANE }, { x: x0 + LANE, z: z1 - LANE }];

export function initPolice() {
  buildJail();
  LOOPS.forEach((L, i) => {
    const pts = loopPts(L), a = pts[0], b = pts[1];
    const v = new Vehicle('police', a.x + (b.x - a.x) * 0.3, a.z + (b.z - a.z) * 0.3, Math.atan2(b.x - a.x, b.z - a.z), { id: 'cop' + i });
    const o = new Character(copOutfit(), { name: 'Officer' });
    o.cop = true; o.car = v;
    v.addOccupant(o, 0);
    v.patrol = { pts, idx: 1 }; v.aiDriven = true; v.home = { x: v.pos.x, z: v.pos.z, yaw: v.yaw };
    P.cars.push(v); o.respawn = () => backInCar(o);
  });
  const walks = G.locations.sidewalks.filter(s => isTown(s.x, s.z));
  for (let i = 0; i < 10; i++) {
    const s = pick(walks);
    const n = new Character(copOutfit(), { isNPC: true, name: 'Officer' });
    n.cop = true;
    n.place(s.x, 0, s.z, rand(0, 6.28));
    n.respawn = () => { const s2 = pick(walks); n.place(s2.x, 0, s2.z); };
    G.npcs.push(n); P.cops.push(n);
  }
  hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:24px;color:#fff;background:rgba(20,30,70,.85);padding:6px 16px;border-radius:10px;display:none;z-index:24;pointer-events:none;letter-spacing:1px;text-shadow:0 2px 6px #000';
  document.body.appendChild(hud);
  fade = document.createElement('div');
  fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity .8s;pointer-events:none;z-index:40;display:flex;align-items:center;justify-content:center;color:#fff;font:800 64px "Barlow Condensed",sans-serif;letter-spacing:3px';
  document.body.appendChild(fade);

  // Report a crime. Only counts if a cop is close enough to see it.
  G.crime = (reason, level = 1) => {
    if (P.jailT > 0 || P.arrest || G.rocketRide) return;
    const pp = playerPos();
    const seen = P.cops.some(c => !c.ragdoll && c.root.distanceTo(pp) < 90) || P.cars.some(v => v.pos.distanceTo(pp) < 130);
    if (!seen) return;
    if (G.time < P.crimeCd && P.wanted >= level) { P.lastSeen = G.time; return; }
    P.crimeCd = G.time + 4;
    const before = P.wanted;
    P.wanted = Math.min(3, Math.max(P.wanted + (P.wanted ? 1 : 0), level));
    P.reason = reason; P.lastSeen = G.time; P.lastClose = G.time;
    if (P.wanted > before) { sfx.honk(); G.toast && G.toast(`🚨 ${reason}! The police are coming for you!`, 'bad', 5000); }
  };
}

function playerPos() { const p = G.player; return p.vehicle ? p.vehicle.pos : p.root; }

// ---------------------------------------------------------------- the jail
function buildJail() {
  const Z = ZONES.jail, y = 0;
  const x0 = Z.x0 + 5, x1 = Z.x1 - 5, z0 = Z.z0 + 5, z1 = Z.z1 - 5;
  const concrete = new THREE.MeshLambertMaterial({ color: '#9a9a94' }), dark = new THREE.MeshLambertMaterial({ color: '#5a5e64' }), steel = new THREE.MeshStandardMaterial({ color: '#60656c', metalness: 0.8, roughness: 0.4 });
  const box = (m, x, yy, z, w, h, d, collide = true) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, yy + h / 2, z); o.castShadow = o.receiveShadow = true; G.scene.add(o);
    if (collide) addCollider(x - w / 2, yy, z - d / 2, x + w / 2, yy + h, z + d / 2);
    return o;
  };
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshLambertMaterial({ color: '#8c8a84' }));
  yard.rotation.x = -Math.PI / 2; yard.position.set((x0 + x1) / 2, y + 0.05, (z0 + z1) / 2); G.scene.add(yard);
  // perimeter wall with a gate on the north side
  const gx = (x0 + x1) / 2;
  box(concrete, (x0 + x1) / 2, y, z0, x1 - x0, 5, 0.7);
  box(concrete, x0, y, (z0 + z1) / 2, 0.7, 5, z1 - z0);
  box(concrete, x1, y, (z0 + z1) / 2, 0.7, 5, z1 - z0);
  box(concrete, (x0 + gx - 5) / 2, y, z1, gx - 5 - x0, 5, 0.7);
  box(concrete, (gx + 5 + x1) / 2, y, z1, x1 - gx - 5, 5, 0.7);
  for (let x = x0; x <= x1; x += 2) box(dark, x, y + 5, z0, 0.1, 1.2, 0.1, false);   // razor-wire posts
  // cell block building
  box(new THREE.MeshLambertMaterial({ color: '#b8b4aa' }), gx, y, z0 + 8, 40, 8, 12);
  // three cells in the yard, open side barred
  P.cells = [];
  for (let i = 0; i < 3; i++) {
    const cx = gx - 8 + i * 8, cz = z0 + 20;
    box(concrete, cx, y, cz - 2.2, 5, 3.6, 0.4);
    box(concrete, cx - 2.6, y, cz, 0.4, 3.6, 4.8);
    box(concrete, cx + 2.6, y, cz, 0.4, 3.6, 4.8);
    box(concrete, cx, y + 3.6, cz, 5.6, 0.3, 4.8, false);
    for (let b = -2.2; b <= 2.21; b += 0.4) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6), steel); bar.position.set(cx + b, y + 1.8, cz + 2.3); G.scene.add(bar); }
    addCollider(cx - 2.5, y, cz + 2.2, cx + 2.5, y + 3.6, cz + 2.45);
    box(dark, cx - 1.6, y, cz - 1.2, 1.2, 0.6, 2, false);      // bench
    P.cells.push({ x: cx, z: cz });
  }
  // guard tower + sign
  box(concrete, x1 - 3, y, z1 - 3, 3, 10, 3);
  box(new THREE.MeshLambertMaterial({ color: '#7fa0b8' }), x1 - 3, y + 10, z1 - 3, 4, 2.4, 4, false);
  const sign = textSprite('BOBBLY COUNTY JAIL', { size: 64, color: '#ffffff', bg: 'rgba(16,19,26,0.9)', accent: '#3a6ab0', scale: 3 });
  sign.position.set(gx, y + 8, z1 + 1); G.scene.add(sign);
  LOC.jailGate = { x: gx, z: z1 + 6 };
  LOC.jail = LOC.jailGate;
}

// ---------------------------------------------------------------- driving
function steerTo(v, tx, tz, speed, dt, blocked = false) {
  const dx = tx - v.pos.x, dz = tz - v.pos.z;
  const want = Math.atan2(dx, dz);
  const diff = ((want - v.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const target = blocked ? 0 : Math.abs(diff) > 0.9 ? Math.min(speed, 8) : speed;
  v.drive(dt, { throttle: v.speed < target ? 1 : v.speed > target + 2 ? -0.7 : 0, steer: clamp(diff * 2.5, -1, 1), brake: blocked, up: false, down: false });
}
function backInCar(o) {
  const v = o.car;
  if (!v) return;
  if (o.vehicle) o.vehicle.removeOccupant(o);
  if (v.driver && v.driver !== o) return;
  if (v.wrecked || v.flipped) v.repair();
  v.pos.set(v.home.x, 0, v.home.z); v.yaw = v.home.yaw; v.speed = 0; v.chase = false;
  o.place(v.pos.x, 0, v.pos.z);
  v.addOccupant(o, 0);
}

// ---------------------------------------------------------------- arrest + jail
function arrest() {
  const p = G.player;
  if (P.arrest) return;
  if (p.vehicle) p.vehicle.removeOccupant(p);
  if (p.held && G.dropHeld) G.dropHeld(false);
  P.arrest = { t: 0 };
  p.cuffed = true; G.arrested = true;
  sfx.bad();
  G.toast && G.toast('🚔 BUSTED! You\'re under arrest!', 'bad', 4000);
  fade.textContent = '';
}
function toJail() {
  const p = G.player, cell = pick(P.cells);
  p.place(cell.x, 0.2, cell.z, Math.PI);
  p.cuffed = false;
  const fine = Math.min(100, G.save.money);
  G.save.money -= fine;
  P.jailT = 25; P.arrest = null; G.arrested = false;
  P.wanted = 0; P.reason = '';
  resetPolice();
  G.toast && G.toast(`🔒 You're in jail for 25 seconds${fine ? ` and fined $${fine}` : ''}.`, 'bad', 6000);
}
function release() {
  const p = G.player;
  p.place(LOC.jailGate.x, 0.2, LOC.jailGate.z, 0);
  G.toast && G.toast('🔓 You\'re free! Try to stay out of trouble…', '', 5000);
}
function resetPolice() {
  for (const v of P.cars) {
    const cop = G.characters.find(c => c.car === v);
    if (cop && (cop.vehicle !== v)) backInCar(cop);
    v.chase = false;
  }
}

// ---------------------------------------------------------------- per frame
let checkT = 0;
export function updatePolice(dt) {
  const p = G.player, pp = playerPos();
  // --- arrest animation, then off to jail
  if (P.arrest) {
    P.arrest.t += dt;
    if (P.arrest.t > 2.2 && !P.arrest.faded) { P.arrest.faded = true; fade.textContent = 'BUSTED'; fade.style.opacity = 1; }
    if (P.arrest.t > 3.4 && !P.arrest.jailed) { P.arrest.jailed = true; toJail(); setTimeout(() => { fade.style.opacity = 0; }, 400); }
  }
  if (P.jailT > 0) {
    P.jailT -= dt;
    hud.style.display = 'block'; hud.style.background = 'rgba(60,60,60,.85)';
    hud.textContent = `🔒 IN JAIL — ${Math.ceil(P.jailT)}s`;
    if (P.jailT <= 0) { P.jailT = 0; release(); }
  }
  // --- spotting crimes that happen over time
  checkT -= dt;
  if (checkT <= 0 && G.started && !P.jailT && !P.arrest) {
    checkT = 0.5;
    const v = p.vehicle;
    if (v && p.seat === 0 && isTown(pp.x, pp.z)) {
      if (v.type.isBike && Math.abs(v.speed) > 2) G.crime('Riding an illegal e-bike on the street', 1);
      else if (!v.type.plane && !v.type.heli && Math.abs(v.speed) > 34) G.crime(`Speeding (${Math.round(Math.abs(v.speed) * 3.6)} km/h)`, 1);
      if (v.type.plane && !v.onGround && pp.y < 40 && Math.abs(v.speed) > 20) G.crime('Flying dangerously low over town', 2);
    }
  }
  // --- patrol / chase
  const wanted = P.wanted > 0 && !P.arrest && !P.jailT;
  let anyClose = false;
  const chasers = wanted ? [...P.cars].filter(v => v.driver && v.driver.cop).sort((a, b) => a.pos.distanceTo(pp) - b.pos.distanceTo(pp)).slice(0, P.wanted + 1) : [];
  for (const v of P.cars) {
    if (!v.driver || !v.driver.cop) { v.chase = false; continue; }
    if (v.wrecked || v.flipped) continue;
    const d = v.pos.distanceTo(pp);
    if (chasers.includes(v)) {
      v.chase = true;
      if (d < 320) anyClose = true;
      const pv = p.vehicle, pSpeed = pv ? Math.abs(pv.speed) : Math.hypot(p.vel.x, p.vel.z);
      // lead the target a little
      const lead = pv ? clamp(d / 40, 0, 1.2) : 0;
      const tx = pp.x + (pv ? Math.sin(pv.yaw) * pv.speed * lead : 0), tz = pp.z + (pv ? Math.cos(pv.yaw) * pv.speed * lead : 0);
      steerTo(v, tx, tz, d > 25 ? 42 : 12, dt, d < 7 && pSpeed < 3);
      v.hitThings(() => {});
      // close and the suspect has stopped (or is on foot): the officer gets out
      if (d < 12 && (pSpeed < 2.5 || !pv) && Math.abs(pp.y - v.pos.y) < 4) {
        const o = v.driver; v.removeOccupant(o); o.runner = true;
        if (!P.cops.includes(o)) P.cops.push(o);
      }
    } else {
      v.chase = false;
      const T = v.patrol, pt = T.pts[T.idx];
      if (Math.hypot(pt.x - v.pos.x, pt.z - v.pos.z) < 4) T.idx = (T.idx + 1) % T.pts.length;
      steerTo(v, pt.x, pt.z, 11, dt);
    }
  }
  // officers on foot: walk the beat, or run you down
  for (const c of P.cops) {
    if (c.ragdoll || c.vehicle) continue;
    const d = c.root.distanceTo(pp);
    if (wanted && (d < 80 || c.runner)) {
      if (d < 320) anyClose = true;
      const dx = pp.x - c.root.x, dz = pp.z - c.root.z, l = Math.hypot(dx, dz) || 1;
      c.ctrl.mx = dx / l; c.ctrl.mz = dz / l; c.ctrl.run = true;
      if (Math.random() < dt * 0.6) c.ctrl.jump = true;
      const pv = p.vehicle;
      if (d < 2.2 && (!pv || Math.abs(pv.speed) < 1.2) && !p.ragdoll) arrest();
      else if (d < 2.2 && p.ragdoll) arrest();
    } else if (c.runner && !wanted) {
      // go back to the patrol car
      c.runner = false;
      if (c.car) backInCar(c);
    } else c.ctrl.run = false;
  }
  if (wanted) {
    if (anyClose) P.lastClose = G.time;
    if (G.time - P.lastClose > 12) { P.wanted = 0; P.reason = ''; sfx.win(); G.toast && G.toast('😎 You lost the police!', 'money', 4000); resetPolice(); }
  }
  // wanted HUD
  if (!P.jailT) {
    if (P.wanted > 0) {
      hud.style.display = 'block'; hud.style.background = Math.floor(G.time * 3) % 2 ? 'rgba(160,20,20,.9)' : 'rgba(20,40,160,.9)';
      hud.textContent = `🚨 WANTED ${'★'.repeat(P.wanted)}${'☆'.repeat(3 - P.wanted)} — ${P.reason}`;
    } else hud.style.display = 'none';
  }
}
