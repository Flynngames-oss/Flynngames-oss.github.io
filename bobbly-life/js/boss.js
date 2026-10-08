// Boss battles:
//  🤖 MEGA BOBBOT — a 46 m robot wades out of the sea and smashes through Mega City. It punches buildings down,
//     stomps (shockwave!) and fires eye lasers. Shoot its glowing chest core with rockets, the MEGA Rocket
//     Launcher, a fighter jet's cannon — or fly a plane into it.
//  👽 UFO INVASION — flying saucers beam people up and zap you with lasers. Shoot them all down.
// Each battle starts with a short movie-style intro. In multiplayer the host runs the bosses and everyone
// sees the same fight; anyone can damage them.
import * as THREE from 'three';
import { G, addMoney, writeSave, rand, pick, clamp } from './state.js';
import { heightAt } from './terrain.js';
import { nearColliders, LOC } from './world.js';
import { explosion, dust, sparks, smoke, fire } from './debris.js';
import { loadModel, spawnModel } from './gltf.js';
import * as NET from './net.js';
import { sfx } from './audio.js';

const B = { kind: null, robot: null, ufos: [], t: 0, won: false, hud: null, bolts: [], netT: 0, abductions: 0 };
G.battle = B;
G.shotTargets = G.shotTargets || [];
const host = () => G.net.mode !== 'client';
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();

// ---------------------------------------------------------------- movie-style intros
export function cutscene(dur, cam, title, sub) {
  G.cutscene = { t: 0, dur, cam, title, sub };
  let el = document.getElementById('cutscene');
  if (!el) { el = document.createElement('div'); el.id = 'cutscene'; el.innerHTML = '<div class="cs-bar top"></div><div class="cs-bar bot"></div><div class="cs-title"></div><div class="cs-sub"></div><div class="cs-skip">Press Enter to skip</div>'; document.body.appendChild(el); el.onclick = () => skipCutscene(); }
  el.querySelector('.cs-title').textContent = title; el.querySelector('.cs-sub').textContent = sub || '';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
export function skipCutscene() { if (G.cutscene) G.cutscene.t = G.cutscene.dur; }
export function cutsceneCamera(dt, camera) {
  const C = G.cutscene; if (!C) return false;
  C.t += dt;
  const f = Math.min(1, C.t / C.dur);
  C.cam(f, _v, _w);
  camera.position.copy(_v); camera.lookAt(_w);
  if (C.t >= C.dur) { G.cutscene = null; const el = document.getElementById('cutscene'); if (el) el.classList.remove('show'); }
  return true;
}

// ---------------------------------------------------------------- HUD
function hud() {
  if (B.hud) return B.hud;
  const el = document.createElement('div'); el.id = 'bossHud';
  el.innerHTML = '<div id="bossName"></div><div id="bossBar"><div id="bossFill"></div></div><div id="bossTip"></div>';
  document.body.appendChild(el); B.hud = el; return el;
}
function showHud(name, frac, tip) {
  const el = hud(); el.style.display = 'block';
  el.querySelector('#bossName').textContent = name;
  el.querySelector('#bossFill').style.width = Math.max(0, frac * 100).toFixed(1) + '%';
  el.querySelector('#bossTip').textContent = tip;
}
function hideHud() { if (B.hud) B.hud.style.display = 'none'; }
// big gold banner across the screen for victories
G.banner = (text) => {
  let el = document.getElementById('bigBanner');
  if (!el) { el = document.createElement('div'); el.id = 'bigBanner'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(G.banner.t); G.banner.t = setTimeout(() => el.classList.remove('show'), 6000);
};

// ---------------------------------------------------------------- the giant robot
const ROBOT_H = 46;
async function makeRobot() {
  const gltf = await loadModel('robot');
  const m = spawnModel(gltf, ROBOT_H);
  m.root.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (/Main/i.test(o.material.name)) { o.material.color.set('#b8322a'); o.material.metalness = 0.55; o.material.roughness = 0.35; }
    else if (/Grey/i.test(o.material.name)) { o.material.color.set('#3a3f46'); o.material.metalness = 0.7; o.material.roughness = 0.3; }
    o.castShadow = true;
  });
  // the loader strips dots and de-duplicates names ("Palm2.R" -> "Palm2R", "Torso" -> "Torso_1"), so match loosely
  const key = (s) => s.replace(/_\d+$/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const bone = (n) => { let f = null; m.root.traverse(o => { if (!f && o.isBone && key(o.name) === key(n)) f = o; }); return f; };
  const glow = (r, c) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
  const core = glow(2.2, '#5ae8ff'), eyes = [glow(1.3, '#ff2a2a'), glow(1.3, '#ff2a2a')];
  G.scene.add(core, ...eyes);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false; G.scene.add(beam);
  return { m, head: bone('Head') || m.root, torso: bone('Torso') || bone('Body') || m.root, handR: bone('Palm2.R') || bone('LowerArm.R') || m.root, core, eyes, beam, hp: 300, max: 300, state: 'intro', st: 0, laserCd: 4, punchCd: 2, stompCd: 6, smashT: 0, goal: null, dead: false, deathT: 0, hitFlash: 0 };
}
function robotTargets(R) {
  const T = [];
  const mk = (getPos, r, mult) => { const t = { alive: true, owner: R, r, x: 0, y: 0, z: 0, upd: getPos, hit: (d, p) => damage(R, d * mult, p) }; T.push(t); return t; };
  mk((o) => R.core.getWorldPosition(o), 4.5, 2.5);
  mk((o) => { R.head.getWorldPosition(o); o.y += 6; return o.addScaledVector(_u.set(Math.sin(R.m.obj.rotation.y), 0, Math.cos(R.m.obj.rotation.y)), 6); }, 8.5, 1);
  mk((o) => R.torso.getWorldPosition(o), 9, 1);
  mk((o) => o.copy(R.m.obj.position).setY(R.m.obj.position.y + ROBOT_H * 0.18), 7, 0.7);
  return T;
}
function damage(R, d, p) {
  if (R.dead) return;
  if (!host()) { NET.send({ t: 'bossHit', k: 'robot', i: 0, d }); R.hitFlash = 0.15; return; }
  R.hp -= d; R.hitFlash = 0.15;
  if (p && Math.random() < 0.5) sparks(p, 10);
  if (R.hp <= 0) robotDie(R);
}
function robotDie(R) {
  if (R.dead) return;
  R.dead = true; R.state = 'dead'; R.deathT = 0; R.hp = 0;
  R.m.play('Death', 0.3, true);
  R.beam.visible = false;
  for (const t of R.targets) t.alive = false;
  if (host()) NET.send({ t: 'bossEv', k: 'robotDie' });
}
function buildingAt(x, z, y0, y1) {
  for (const c of nearColliders(x, z)) if (!c.off && c.b && !c.noDamage && x > c.minX - 6 && x < c.maxX + 6 && z > c.minZ - 6 && z < c.maxZ + 6 && c.maxY > y0 + 3) return c;
  return null;
}
function updateRobot(R, dt) {
  const o = R.m.obj, P = G.player, pp = P.vehicle ? P.vehicle.pos : P.root;
  R.m.mixer.update(dt);
  R.st += dt;
  const fwd = _u.set(Math.sin(o.rotation.y), 0, Math.cos(o.rotation.y));
  // glowing bits follow the bones
  R.torso.getWorldPosition(_v); R.core.position.copy(_v).addScaledVector(fwd, 6.3);
  R.core.material.color.setHSL(0.52, 1, 0.55 + Math.sin(G.time * 6) * 0.15 + (R.hitFlash > 0 ? 0.3 : 0));
  R.head.getWorldPosition(_v);
  const right = _w.set(fwd.z, 0, -fwd.x);
  R.eyes.forEach((e, i) => { e.position.copy(_v).addScaledVector(fwd, 11.6).addScaledVector(right, i ? 2.6 : -2.6); e.position.y += 6.5; e.visible = !R.dead; });
  R.core.visible = !R.dead;
  if (R.hitFlash > 0) R.hitFlash -= dt;
  for (const t of R.targets) { t.upd(_v); t.x = _v.x; t.y = _v.y; t.z = _v.z; }
  if (!host()) return;
  const gy = Math.max(heightAt(o.position.x, o.position.z), -40);
  if (R.state === 'dead') {
    R.deathT += dt;
    if (R.deathT < 4 && Math.random() < dt * 6) explosion(_v.copy(o.position).add(new THREE.Vector3(rand(-10, 10), rand(5, ROBOT_H), rand(-10, 10))), rand(0.8, 1.6));
    if (R.deathT > 2.2 && !B.won) win('robot');
    if (R.deathT > 6) o.position.y -= dt * 2;
    if (R.deathT > 25) endBattle(true);
    return;
  }
  if (R.state === 'intro') {
    // wades in out of the sea
    o.position.y = Math.min(gy, o.position.y + dt * 8);
    o.position.addScaledVector(fwd, dt * 9);
    R.m.play('Walking');
    if (R.st > 7) { R.state = 'walk'; R.st = 0; }
    return;
  }
  o.position.y += (gy - o.position.y) * Math.min(1, dt * 3);
  const dP = Math.hypot(pp.x - o.position.x, pp.z - o.position.z);
  R.laserCd -= dt; R.punchCd -= dt; R.stompCd -= dt;
  if (R.state === 'walk') {
    // head for the player if they're near, otherwise rampage through the city
    if (!R.goal || R.st > 18) { R.goal = dP < 600 ? [pp.x, pp.z] : [rand(-900, -300), rand(-400, 200)]; R.st = 0; }
    const dx = R.goal[0] - o.position.x, dz = R.goal[1] - o.position.z, d = Math.hypot(dx, dz);
    let dy = Math.atan2(dx, dz) - o.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    o.rotation.y += clamp(dy, -dt * 0.8, dt * 0.8);
    if (d > 15) { o.position.addScaledVector(fwd, dt * 7); R.m.play('Walking'); } else { R.goal = null; R.m.play('Idle'); }
    // feet crush whatever they walk through
    R.smashT -= dt;
    if (R.smashT <= 0) {
      R.smashT = 0.5;
      const c = buildingAt(o.position.x, o.position.z, o.position.y, 0);
      if (c && G.hitBuilding) { G.hitBuilding(c, _v.set(o.position.x, c.minY + 4, o.position.z), 4000); G.camShake = Math.max(G.camShake || 0, 0.3); }
    }
    // punch a building in front
    const fx = o.position.x + fwd.x * 18, fz = o.position.z + fwd.z * 18;
    const target = R.punchCd <= 0 && buildingAt(fx, fz, o.position.y, 0);
    if (target) { R.state = 'punch'; R.st = 0; R.punchC = target; R.m.play('Punch', 0.15, true); R.punchCd = 4; return; }
    if (R.stompCd <= 0 && dP < 45 && !P.vehicle) { R.state = 'stomp'; R.st = 0; R.m.play('Jump', 0.15, true); R.stompCd = 9; return; }
    if (R.laserCd <= 0 && dP < 280) { R.state = 'laser'; R.st = 0; R.laserCd = 6.5; R.aim = new THREE.Vector3(pp.x, pp.y + 1, pp.z); R.m.play('Idle'); return; }
  } else if (R.state === 'punch') {
    if (R.st > 0.45 && R.punchC) {
      const c = R.punchC; R.punchC = null;
      _v.set(clamp(o.position.x + fwd.x * 18, c.minX, c.maxX), clamp(o.position.y + ROBOT_H * 0.55, c.minY, c.maxY), clamp(o.position.z + fwd.z * 18, c.minZ, c.maxZ));
      if (G.hitBuilding) G.hitBuilding(c, _v, 9000);
      explosion(_v, 1.2); NET.send({ t: 'bossEv', k: 'boom', p: [_v.x, _v.y, _v.z], s: 1.2 });
    }
    if (R.st > 1.3) { R.state = 'walk'; R.st = 0; }
  } else if (R.state === 'stomp') {
    if (R.st > 0.85 && !R.stomped) {
      R.stomped = true;
      stompAt(o.position.x, o.position.y, o.position.z); NET.send({ t: 'bossEv', k: 'stomp', p: [o.position.x, o.position.y, o.position.z] });
    }
    if (R.st > 1.6) { R.state = 'walk'; R.st = 0; R.stomped = false; }
  } else if (R.state === 'laser') {
    // charge (thin flickering line), then FIRE
    R.aim.lerp(_v.set(pp.x, pp.y + 1, pp.z), Math.min(1, dt * (R.st < 0.9 ? 3 : 0.5)));
    showBeam(R, R.aim, R.st < 1.0 ? 0.25 + Math.random() * 0.2 : 2.2);
    NET.send({ t: 'bossEv', k: 'beam', a: [R.aim.x, R.aim.y, R.aim.z], w: R.st < 1.0 ? 0.3 : 2.2 });
    if (R.st > 1.0 && !R.fired) { R.fired = true; laserHit(R.aim); NET.send({ t: 'bossEv', k: 'boom', p: [R.aim.x, R.aim.y, R.aim.z], s: 1.1, hurt: 1 }); }
    if (R.st > 1.5) { R.state = 'walk'; R.st = 0; R.fired = false; R.beam.visible = false; NET.send({ t: 'bossEv', k: 'beamOff' }); }
  }
  // planes and cars that ram it
  for (const v of G.vehicles) {
    if (v.driver !== P || v.wrecked) continue;
    if (Math.hypot(v.pos.x - o.position.x, v.pos.z - o.position.z) < 9 && v.pos.y < o.position.y + ROBOT_H && Math.abs(v.speed) > 12) {
      damage(R, Math.abs(v.speed) * (v.type.plane ? 0.5 : 0.15), v.pos);
      if (v.type.plane || v.type.heli) v.planeCrash && v.planeCrash(false); else { v.speed = -v.speed * 0.4; explosion(v.pos.clone(), 0.8); }
    }
  }
}
function showBeam(R, aim, width) {
  R.head.getWorldPosition(_v);
  const fwd = _u.set(Math.sin(R.m.obj.rotation.y), 0, Math.cos(R.m.obj.rotation.y));
  _v.addScaledVector(fwd, 12.2); _v.y += 6.5;
  const len = _v.distanceTo(aim);
  R.beam.position.copy(_v); R.beam.lookAt(aim); R.beam.scale.set(width, width, len); R.beam.visible = true;
  R.beam.material.opacity = width < 1 ? 0.5 : 0.9;
}
function laserHit(p) {
  explosion(p, 1.1);
  hurtAround(p, 7, 16);
}
function stompAt(x, y, z) {
  explosion(_v.set(x, y + 1, z), 1.6);
  dust(_v, 30, 6);
  hurtAround(_v, 40, 14);
  G.camShake = Math.max(G.camShake || 0, 1.2);
}
function hurtAround(p, R, power) {
  for (const ch of G.characters) {
    if (ch.isRemote) continue;
    const q = ch.vehicle ? ch.vehicle.pos : ch.root, d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d > R || Math.abs(q.y - p.y) > 12) continue;
    if (ch.vehicle) { if (ch.vehicle.driver === ch) { const v = ch.vehicle; if (v.type.plane && !v.onGround) v.planeCrash(false); else { v.vy += power * 0.8; v.onGround = false; } } continue; }
    _w.set(q.x - p.x, 0, q.z - p.z).normalize().multiplyScalar(power * (1 - d / R) + 4); _w.y = power * 0.8;
    ch.flop(_w.clone(), 2.5);
  }
}

// ---------------------------------------------------------------- UFOs
let UFO_GEO = null;
function ufoMesh() {
  if (!UFO_GEO) {
    const prof = [[0.1, -1.2], [3.5, -0.9], [7, 0], [3.8, 0.8], [2.4, 1.1], [0.1, 1.15]].map(([a, b]) => new THREE.Vector2(a, b));
    UFO_GEO = { hull: new THREE.LatheGeometry(prof, 32), dome: new THREE.SphereGeometry(2.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), light: new THREE.SphereGeometry(0.35, 8, 6), beam: new THREE.ConeGeometry(6, 1, 24, 1, true).translate(0, -0.5, 0) };
  }
  const g = new THREE.Group();
  const hull = new THREE.Mesh(UFO_GEO.hull, new THREE.MeshStandardMaterial({ color: '#c8ccd4', metalness: 0.85, roughness: 0.25 })); hull.castShadow = true; g.add(hull);
  const dome = new THREE.Mesh(UFO_GEO.dome, new THREE.MeshStandardMaterial({ color: '#8fffc8', emissive: '#2a8a5a', emissiveIntensity: 0.6, transparent: true, opacity: 0.55, roughness: 0.1 })); dome.position.y = 1.0; g.add(dome);
  const alien = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), new THREE.MeshStandardMaterial({ color: '#7ae86a' })); alien.position.y = 1.6; g.add(alien);
  for (const sx of [-0.35, 0.35]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#111' })); e.position.set(sx, 1.85, 0.78); e.scale.set(1, 1.5, 0.6); g.add(e); }
  const lights = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, l = new THREE.Mesh(UFO_GEO.light, new THREE.MeshBasicMaterial({ color: '#ffffff' })); l.position.set(Math.cos(a) * 6.2, 0.05, Math.sin(a) * 6.2); g.add(l); lights.push(l); }
  const beam = new THREE.Mesh(UFO_GEO.beam, new THREE.MeshBasicMaterial({ color: '#9affb0', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = -1; beam.visible = false; g.add(beam);
  G.scene.add(g);
  return { g, lights, beam, hull };
}
function makeUfo(i, cx, cz) {
  const U = ufoMesh();
  const u = { ...U, i, hp: 14, max: 14, alive: true, pos: new THREE.Vector3(cx + rand(-80, 80), 260 + i * 15, cz + rand(-80, 80)), target: new THREE.Vector3(), alt: rand(32, 48), st: rand(0, 4), zapCd: rand(3, 6), abduct: null, vy: 0, spin: 0, crashed: false, hitFlash: 0 };
  u.target.set(cx, u.alt, cz);
  u.tgt = { alive: true, r: 7.5, x: 0, y: 0, z: 0, hit: (d, p) => hitUfo(u, Math.max(d, 0.5), p) };
  return u;
}
function hitUfo(u, d, p) {
  if (!u.alive) return;
  if (!host()) { NET.send({ t: 'bossHit', k: 'ufo', i: u.i, d }); u.hitFlash = 0.15; return; }
  u.hp -= d; u.hitFlash = 0.15; sparks(p || u.pos, 8);
  if (u.abduct && d > 0.4) u.abduct.hits = (u.abduct.hits || 0) + 1;
  if (u.hp <= 0) ufoDie(u);
}
function ufoDie(u) {
  if (!u.alive) return;
  u.alive = false; u.tgt.alive = false; u.beam.visible = false; u.vy = 0; u.spin = 4;
  explosion(u.pos.clone(), 1.3);
  if (u.abduct) releaseAbduct(u);
  if (host()) NET.send({ t: 'bossEv', k: 'ufoDie', i: u.i });
}
function releaseAbduct(u) { if (u.abduct && u.abduct.ch) u.abduct.ch.grabbedBy = null; u.abduct = null; u.beam.visible = false; }
function updateUfo(u, dt, center) {
  const P = G.player;
  u.st += dt;
  u.g.position.copy(u.pos);
  u.hull.rotation.y += dt * 1.2;
  u.lights.forEach((l, k) => l.material.color.setHSL(((G.time * 0.6 + k / 12) % 1), 1, u.hitFlash > 0 ? 0.9 : 0.6));
  if (u.hitFlash > 0) u.hitFlash -= dt;
  u.tgt.x = u.pos.x; u.tgt.y = u.pos.y; u.tgt.z = u.pos.z;
  if (!u.alive) {
    // crash!
    if (!u.crashed) {
      u.vy -= 24 * dt; u.pos.y += u.vy * dt; u.g.rotation.z += u.spin * dt; u.g.rotation.x += u.spin * 0.6 * dt;
      if (Math.random() < 0.6) smoke(u.pos, 1, true);
      if (u.pos.y < heightAt(u.pos.x, u.pos.z) + 1.5) { u.crashed = true; u.crashT = 0; explosion(u.pos.clone(), 1.5); }
    } else if ((u.crashT += dt) > 18) u.g.visible = false;
    return;
  }
  if (!host()) return;
  // descend, then drift around over the area, dodging a bit
  if (u.st > 3 || u.pos.distanceTo(u.target) < 6) { u.st = 0; u.target.set(center.x + rand(-110, 110), u.alt, center.z + rand(-110, 110)); u.target.y = Math.max(heightAt(u.target.x, u.target.z) + u.alt, u.alt); }
  if (!u.abduct) u.pos.lerp(_v.copy(u.target), Math.min(1, dt * 0.45));
  // zap the player
  u.zapCd -= dt;
  const pp = P.vehicle ? P.vehicle.pos : P.root;
  if (u.zapCd <= 0 && u.pos.distanceTo(pp) < 140) { u.zapCd = rand(4, 7); zap(u.pos.clone(), new THREE.Vector3(pp.x, pp.y + 1, pp.z)); NET.send({ t: 'bossEv', k: 'zap', a: [u.pos.x, u.pos.y, u.pos.z], b: [pp.x, pp.y + 1, pp.z] }); }
  // tractor beam
  if (!u.abduct && u.st > 2.5 && Math.random() < dt * 0.25) {
    const victims = G.npcs.filter(n => !n.vehicle && !n.hidden && Math.hypot(n.root.x - u.pos.x, n.root.z - u.pos.z) < 70);
    let ch = victims.length ? pick(victims) : null;
    if ((!ch || Math.random() < 0.25) && !P.vehicle && Math.hypot(pp.x - u.pos.x, pp.z - u.pos.z) < 70 && (performance.now() - (B.lastPlayerBeam || 0)) > 20000) { ch = P; B.lastPlayerBeam = performance.now(); }
    if (ch) u.abduct = { ch, t: 0 };
  }
  if (u.abduct) {
    const A = u.abduct, ch = A.ch; A.t += dt;
    // move over the victim, beam them up
    u.pos.x += (ch.root.x - u.pos.x) * Math.min(1, dt * 1.5); u.pos.z += (ch.root.z - u.pos.z) * Math.min(1, dt * 1.5);
    u.beam.visible = true; u.beam.scale.set(1, u.pos.y - heightAt(u.pos.x, u.pos.z) + 2, 1);
    if (A.t > 1.2) {
      if (!ch.ragdoll) ch.flop(null, 3);
      const lift = Math.min(1, (A.t - 1.2) / 4);
      ch.grabbedBy = { point: _w.set(u.pos.x, heightAt(ch.root.x, ch.root.z) + 2 + lift * (u.pos.y - heightAt(ch.root.x, ch.root.z) - 3), u.pos.z).clone(), t: 0.25 };
      ch.ragMin = Math.max(ch.ragMin || 0, ch.ragT + 1);
      if (A.hits >= 2 && ch === P) { releaseAbduct(u); G.toast && G.toast('😅 You broke free!', null, 2500); return; }
      if (lift >= 1) {
        releaseAbduct(u);
        if (ch === P) {
          const spots = [LOC.peak, LOC.treasure, LOC.mysteryCave, LOC.lighthouse, LOC.kart].filter(Boolean), s = pick(spots);
          P.place(s.x, heightAt(s.x, s.z) + 40, s.z, 0); P.flop(null, 2);
          G.toast && G.toast('👽 You got ABDUCTED... and dropped somewhere far away!', 'bad', 5000);
        } else { ch.place(rand(-150, 150), 0.5, rand(-150, 150), 0); B.abductions++; G.toast && G.toast(`👽 The aliens beamed someone up! (${B.abductions})`, 'bad', 2000); }
      }
    }
  } else u.beam.visible = false;
}
function zap(a, b) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: '#7aff8a' }));
  m.position.copy(a); G.scene.add(m);
  B.bolts.push({ m, v: b.clone().sub(a).normalize().multiplyScalar(48), t: 0 });
  sfx.pew && sfx.pew();
}
function updateBolts(dt) {
  for (let i = B.bolts.length - 1; i >= 0; i--) {
    const b = B.bolts[i]; b.t += dt; b.m.position.addScaledVector(b.v, dt);
    const p = b.m.position, P = G.player, q = P.vehicle ? P.vehicle.pos : P.p[1];
    let boom = b.t > 4 || p.y < heightAt(p.x, p.z);
    if (q.distanceTo(p) < 2.2) boom = true;
    if (boom) { explosion(p.clone(), 0.6); if (q.distanceTo(p) < 5) hurtAround(p, 5, 10); G.scene.remove(b.m); B.bolts.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- starting and ending battles
export async function startBattle(kind, fromNet = false) {
  if (B.kind) return;
  if (G.net.mode === 'client' && !fromNet) { NET.send({ t: 'bossReq', k: kind }); return; }
  B.kind = kind; B.t = 0; B.won = false; B.abductions = 0;
  const P = G.player, n = G.net.mode === 'solo' ? 1 : G.remotes.size + 1;
  if (!G.save.ownedWeapons.includes('mega')) { G.save.ownedWeapons.push('mega'); writeSave(); G.toast && G.toast('☄️ You got a free MEGA Rocket Launcher for this fight! Press G to switch to it.', 'money', 6000); }
  if (kind === 'robot') {
    const R = await makeRobot();
    R.max = R.hp = 300 * (1 + 0.5 * (n - 1));
    const o = R.m.obj; o.position.set(-1175, -40, -120); o.rotation.y = Math.PI / 2;
    G.scene.add(o); R.m.play('Walking');
    R.targets = robotTargets(R); G.shotTargets.push(...R.targets);
    B.robot = R;
    sfx.boom && sfx.boom();
    cutscene(7, (f, pos, look) => {
      const rx = o.position.x, ry = o.position.y, rz = o.position.z;
      pos.set(rx + 60 + f * 50, 6 + f * 10, rz + 70 - f * 40); look.set(rx, ry + ROBOT_H * (0.4 + f * 0.25), rz);
    }, '🤖 MEGA BOBBOT ATTACKS!', 'A giant robot is wading out of the sea towards Mega City! Shoot its glowing core!');
    G.waypoint = { x: -700, z: -120 };
  } else {
    const c = P.vehicle ? P.vehicle.pos : P.root, cx = c.x, cz = c.z;
    B.ufos = [];
    for (let i = 0; i < 3 + n; i++) { const u = makeUfo(i, cx, cz); B.ufos.push(u); G.shotTargets.push(u.tgt); }
    B.center = new THREE.Vector3(cx, 0, cz);
    cutscene(6, (f, pos, look) => { pos.set(cx + 30, heightAt(cx, cz) + 3, cz + 30); const u = B.ufos[0]; look.copy(u.pos); }, '👽 UFO INVASION!', 'Flying saucers are beaming people up! Shoot them all down!');
    for (const u of B.ufos) u.pos.y = 220 + u.i * 10;
  }
  if (host() && G.net.mode === 'host') NET.send({ t: 'bossStart', k: kind });
}
function win(kind) {
  B.won = true;
  if (kind === 'robot') {
    G.slowmo = 2;
    rewardAll(5000, '🤖 YOU DEFEATED MEGA BOBBOT!', 'botsmasher');
  } else rewardAll(3000, '👽 YOU SAVED THE ISLAND FROM THE ALIENS!', 'alienhunter');
  NET.send({ t: 'bossEv', k: 'win', kind });
}
function rewardAll(money, msg, skin) {
  addMoney(money, msg);
  if (skin && !G.save.ownedSkins.includes(skin)) { G.save.ownedSkins.push(skin); writeSave(); }
  G.banner && G.banner(msg + ` +$${money}`);
  if (skin) G.toast && G.toast(`🎉 New costume unlocked: ${skin === 'botsmasher' ? '🦾 Bot Smasher' : '🛸 Alien Hunter'}! (Phone → Clothes)`, 'money', 7000);
  sfx.win && sfx.win();
}
export function endBattle(silent) {
  if (!B.kind) return;
  if (B.robot) { const R = B.robot; for (const x of [R.m.obj, R.core, ...R.eyes, R.beam]) G.scene.remove(x); B.robot = null; }
  for (const u of B.ufos) { releaseAbduct(u); G.scene.remove(u.g); }
  B.ufos = [];
  G.shotTargets.length = 0;
  B.kind = null; hideHud();
  if (!silent && host() && G.net.mode === 'host') NET.send({ t: 'bossEnd' });
}

// ---------------------------------------------------------------- every frame
export function updateBattle(dt) {
  updateBolts(dt);
  if (!B.kind) { randomEvents(dt); return; }
  B.t += dt;
  if (B.kind === 'robot' && B.robot) {
    const R = B.robot; updateRobot(R, dt);
    showHud('🤖 MEGA BOBBOT', R.hp / R.max, R.dead ? 'DEFEATED!' : 'Shoot the glowing blue core on its chest! Rockets, fighter jets, MEGA launcher — or ram it with a plane!');
  } else if (B.kind === 'ufo') {
    const P = G.player, c = P.vehicle ? P.vehicle.pos : P.root;
    B.center.lerp(_v.set(c.x, 0, c.z), Math.min(1, dt * 0.05));
    for (const u of B.ufos) updateUfo(u, dt, B.center);
    const alive = B.ufos.filter(u => u.alive), hp = B.ufos.reduce((a, u) => a + Math.max(0, u.hp), 0), max = B.ufos.reduce((a, u) => a + u.max, 0);
    showHud(`👽 UFO INVASION — ${alive.length} left`, hp / max, alive.length ? 'Shoot the saucers! Stay out of the green beams!' : 'ALL UFOs DOWN!');
    if (host() && !alive.length && !B.won) { win('ufo'); setTimeout(() => endBattle(), 20000); }
  }
  if (host() && G.net.mode === 'host' && (B.netT -= dt) <= 0) {
    B.netT = 0.12;
    if (B.robot) { const o = B.robot.m.obj; NET.send({ t: 'bossSt', k: 'robot', p: [o.position.x, o.position.y, o.position.z, o.rotation.y], hp: B.robot.hp, max: B.robot.max, s: B.robot.state }); }
    else NET.send({ t: 'bossSt', k: 'ufo', u: B.ufos.map(u => [u.pos.x, u.pos.y, u.pos.z, u.hp, u.alive ? 1 : 0, u.beam.visible ? u.beam.scale.y : 0]) });
  }
}
// now and then, something big happens (solo / host only, never during jobs or arcade games)
let evT = 600 + Math.random() * 400;
function randomEvents(dt) {
  if (!G.started || !host() || G.job || (G.arcade && G.arcade.mode)) return;
  evT -= dt;
  if (evT <= 0) { evT = 900 + Math.random() * 600; G.toast && G.toast('⚠️ Something BIG is coming...', 'bad', 4000); setTimeout(() => startBattle(Math.random() < 0.5 ? 'robot' : 'ufo'), 4000); }
}

// ---------------------------------------------------------------- multiplayer
NET.on('bossReq', (m) => { if (host()) startBattle(m.k); });
NET.on('bossStart', (m) => { if (!host()) startBattle(m.k, true); });
NET.on('bossEnd', () => { if (!host()) endBattle(true); });
NET.on('bossHit', (m) => {
  if (!host()) return;
  if (m.k === 'robot' && B.robot) damage(B.robot, clamp(+m.d || 0, 0, 20), null);
  if (m.k === 'ufo') { const u = B.ufos[m.i]; if (u) hitUfo(u, clamp(+m.d || 0, 0, 20), null); }
});
NET.on('bossSt', (m) => {
  if (host()) return;
  if (m.k === 'robot' && B.robot) { const o = B.robot.m.obj; o.position.lerp(_v.set(m.p[0], m.p[1], m.p[2]), 0.5); o.rotation.y = m.p[3]; B.robot.hp = m.hp; B.robot.max = m.max; const anim = { walk: 'Walking', intro: 'Walking', punch: 'Punch', stomp: 'Jump', laser: 'Idle', dead: 'Death' }[m.s]; if (anim) B.robot.m.play(anim, 0.2, anim === 'Punch' || anim === 'Jump' || anim === 'Death'); }
  if (m.k === 'ufo') m.u.forEach((a, i) => { const u = B.ufos[i]; if (!u) return; if (u.alive) u.pos.lerp(_v.set(a[0], a[1], a[2]), 0.5); u.hp = a[3]; if (!a[4] && u.alive) ufoDie(u); u.beam.visible = !!a[5]; if (a[5]) u.beam.scale.set(1, a[5], 1); });
});
NET.on('bossEv', (m) => {
  if (host()) return;
  const R = B.robot;
  if (m.k === 'boom') { explosion(_v.set(...m.p), m.s || 1); if (m.hurt) hurtAround(_v, 7, 16); }
  if (m.k === 'stomp') stompAt(...m.p);
  if (m.k === 'beam' && R) showBeam(R, _w.set(...m.a), m.w);
  if (m.k === 'beamOff' && R) R.beam.visible = false;
  if (m.k === 'robotDie' && R) robotDie(R);
  if (m.k === 'zap') zap(new THREE.Vector3(...m.a), new THREE.Vector3(...m.b));
  if (m.k === 'ufoDie') { const u = B.ufos[m.i]; if (u) ufoDie(u); }
  if (m.k === 'win') { if (m.kind === 'robot') G.slowmo = 2; rewardAll(m.kind === 'robot' ? 5000 : 3000, m.kind === 'robot' ? '🤖 YOU DEFEATED MEGA BOBBOT!' : '👽 YOU SAVED THE ISLAND FROM THE ALIENS!', m.kind === 'robot' ? 'botsmasher' : 'alienhunter'); }
});
G.startBattle = startBattle; G.endBattle = () => endBattle();
