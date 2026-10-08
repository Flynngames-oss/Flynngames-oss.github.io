// Arcade modes you can play on your own or with friends (open the phone → 🕹️ Arcade):
//  🗼 Doom Tower: climb a spiral tower in the sky before the rising lava catches you.
//  🪂 Sky Riot: floating tiles crumble under everyone's feet. Survive 60 seconds, push friends off.
//  🦖 Kaiju Smash: turn into a dino monster with mega jumps. Smash as much of the city as you can.
//  🎲 Surprise Me: a random mode or a chaos event (meteor shower, low gravity, beach ball storm, turbo legs).
import * as THREE from 'three';
import { G, rand, pick, addMoney } from './state.js';
import { addCollider, nearColliders, groundHeight, hitBuilding, rebuildCity, LOC } from './world.js';
import { explosion, sparks, dust, fire } from './debris.js';
import { Prop } from './props.js';
import { SKINS } from './character.js';
import { sfx } from './audio.js';
import { quitJob } from './jobs.js';

export const ARCADE = {
  tower: { name: 'Doom Tower', emo: '🗼', desc: 'Climb the sky tower before the lava gets you! $300 at the top.' },
  riot: { name: 'Sky Riot', emo: '🪂', desc: 'The floor crumbles under your feet. Survive 60 seconds! Friends can play too.' },
  kaiju: { name: 'Kaiju Smash', emo: '🦖', desc: 'Become a giant dino with mega jumps and smash the city. $10 per building.' },
};
const EVENTS = {
  meteors: { name: 'Meteor Shower', emo: '☄️', dur: 40 },
  lowgrav: { name: 'Moon Gravity', emo: '🌙', dur: 45 },
  balls: { name: 'Beach Ball Storm', emo: '🏐', dur: 30 },
  turbo: { name: 'Turbo Legs', emo: '⚡', dur: 45 },
};
const A = { mode: null, t: 0, ev: null, evT: 0, best: 0 };
G.arcade = A;
G.fun = { speed: 1, jump: 1, grav: 1 };
let bar = null;

const P = () => G.player;
function tp(x, y, z, face = 0) {
  const p = P();
  if (p.vehicle) p.vehicle.removeOccupant(p);
  if (p.held && G.dropHeld) G.dropHeld(false);
  p.place(x, y, z, face);
  G.cam.yaw = face + Math.PI;
}
function hud(text) {
  if (!bar) { bar = document.createElement('div'); bar.id = 'arcadeBar'; document.getElementById('hud').appendChild(bar); }
  bar.style.display = text ? 'block' : 'none';
  if (text && bar._t !== text) { bar.innerHTML = text; bar._t = text; }
}
const fmt = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const glow = (color, e = 0.35) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: e });
function confetti(pos) { for (let i = 0; i < 4; i++) sparks(new THREE.Vector3(pos.x + rand(-2, 2), pos.y + rand(0, 3), pos.z + rand(-2, 2)), 25); }

// ---------------------------------------------------------------- 🗼 Doom Tower
const TW = { x: 420, y: 380, z: -420, n: 64, built: null };
function buildTower() {
  if (TW.built) return TW.built;
  const g = new THREE.Group(); G.scene.add(g);
  const plats = [];
  const cols = ['#ff5b6e', '#ffb13d', '#ffe14a', '#5ee07a', '#3fc8ff', '#b07aff'];
  // the core pillar (pushes you out, so you have to go round)
  const H = TW.n * 1.05 + 6;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, H, 32), new THREE.MeshStandardMaterial({ color: '#3a3550', roughness: 0.6 }));
  core.position.set(TW.x, TW.y + H / 2 - 4, TW.z); g.add(core);
  addCollider(TW.x - 2.6, TW.y - 4, TW.z - 2.6, TW.x + 2.6, TW.y + H - 4, TW.z + 2.6, 'tower');
  for (let i = 0; i < TW.n; i++) {
    const a = i * 0.46, r = 7.2 + Math.sin(i * 0.9) * 1.3, y = TW.y + i * 1.05;
    const kind = i === 0 ? 'start' : i % 9 === 4 ? 'bounce' : i % 7 === 3 ? 'move' : i % 5 === 2 ? 'thin' : 'solid';
    const s = kind === 'thin' ? 1.7 : kind === 'start' ? 6 : 2.8;
    const x = TW.x + Math.cos(a) * r, z = TW.z + Math.sin(a) * r;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.62, s * 0.55, 0.5, 24), kind === 'bounce' ? glow('#4dff88', 0.6) : glow(cols[i % cols.length], 0.12));
    m.position.set(x, y - 0.25, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
    // moving platforms get a collider that covers their whole path (so the collision grid knows about it), then shrink each frame
    const sweep = kind === 'move' ? 2.2 : 0, h = s * 0.45;
    const c = addCollider(x - h - sweep, y - 0.5, z - h - sweep, x + h + sweep, y, z + h + sweep, kind === 'bounce' ? 'bounce' : 'tower');
    c.minX = x - h; c.maxX = x + h; c.minZ = z - h; c.maxZ = z + h;
    plats.push({ m, c, x, y, z, h, kind, a, ph: i });
  }
  // the golden goal with a spinning trophy
  const top = TW.y + TW.n * 1.05;
  const goal = new THREE.Mesh(new THREE.CylinderGeometry(5, 4.4, 0.6, 32), glow('#ffd23a', 0.5));
  goal.position.set(TW.x, top - 0.3, TW.z); g.add(goal);
  addCollider(TW.x - 4.2, top - 0.6, TW.z - 4.2, TW.x + 4.2, top, TW.z + 4.2, 'tower');
  const trophy = new THREE.Group();
  const gold = glow('#ffcc33', 0.7);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.35, 1.1, 24, 1, true), gold); cup.position.y = 1.9; trophy.add(cup);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 12), gold); stem.position.y = 1; trophy.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.25, 20), gold); foot.position.y = 0.6; trophy.add(foot);
  trophy.position.set(TW.x, top, TW.z); g.add(trophy);
  // the lava sea that rises up the tower
  const lavaTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); x.fillStyle = '#ff4a10'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(255,${180 + Math.random() * 75 | 0},40,${0.4 + Math.random() * 0.5})`; x.beginPath(); x.arc(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 10, 0, 7); x.fill(); } const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 8); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const lava = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ map: lavaTex, color: '#ffffff' }));
  lava.rotation.x = -Math.PI / 2; g.add(lava);
  g.visible = false;
  TW.built = { g, plats, top, trophy, lava, lavaTex };
  return TW.built;
}
function startTower() {
  const T = buildTower(); T.g.visible = true;
  A.lavaY = TW.y - 8; A.t = 0;
  tp(TW.x + 7.2, TW.y + 0.2, TW.z, -Math.PI / 2);
  G.toast('🗼 DOOM TOWER! Jump up the spiral to the golden trophy. The lava starts rising in 8 seconds!', '', 8000);
  sfx.win();
}
function updateTower(dt) {
  const T = TW.built, p = P();
  A.t += dt;
  if (A.t > 8) A.lavaY += dt * (0.55 + A.t * 0.004);
  T.lava.position.set(TW.x, A.lavaY, TW.z);
  T.lavaTex.offset.set(G.time * 0.02, G.time * 0.013);
  T.trophy.rotation.y += dt * 1.5;
  for (const pl of T.plats) {
    if (pl.kind !== 'move') continue;
    const o = Math.sin(G.time * 1.4 + pl.ph) * 2.2, tx = -Math.sin(pl.a), tz = Math.cos(pl.a);
    const x = pl.x + tx * o, z = pl.z + tz * o;
    pl.m.position.x = x; pl.m.position.z = z;
    pl.c.minX = x - pl.h; pl.c.maxX = x + pl.h; pl.c.minZ = z - pl.h; pl.c.maxZ = z + pl.h;
  }
  // bounce pads launch you up
  for (const pl of T.plats) if (pl.kind === 'bounce' && p.grounded && Math.abs(p.root.y - pl.y) < 0.3 && Math.hypot(p.root.x - pl.x, p.root.z - pl.z) < pl.h + 0.4) { p.vel.y = 15; p.grounded = false; sfx.boing(); }
  const climbed = Math.max(0, Math.round(p.root.y - TW.y));
  A.best = Math.max(A.best, climbed);
  hud(`🗼 <b>Doom Tower</b> · Height ${climbed} m / ${Math.round(T.top - TW.y)} m · Lava ${A.lavaY < TW.y ? 'coming...' : Math.round(A.lavaY - TW.y) + ' m'} · ${fmt(A.t)}`);
  if (p.root.y < A.lavaY + 0.3 || p.root.y < TW.y - 12) {
    fire(p.root.clone(), 6, 2); sfx.bad();
    G.toast(`🔥 The lava got you at ${climbed} m! Back to the bottom...`, 'bad');
    A.lavaY = TW.y - 8; A.t = 0;
    tp(TW.x + 7.2, TW.y + 0.2, TW.z, -Math.PI / 2);
    return;
  }
  if (p.grounded && p.root.y > T.top - 0.5 && Math.hypot(p.root.x - TW.x, p.root.z - TW.z) < 5.5) {
    confetti(p.root); sfx.present();
    addMoney(300, '🗼 Doom Tower conquered!');
    G.toast(`🏆 YOU BEAT DOOM TOWER in ${fmt(A.t)}! +$300`, 'money', 8000);
    stopArcade(true);
  }
}

// ---------------------------------------------------------------- 🪂 Sky Riot
const SR = { x: -420, y: 400, z: 420, n: 9, s: 3.6, built: null };
function buildRiot() {
  if (SR.built) return SR.built;
  const g = new THREE.Group(); G.scene.add(g);
  const tiles = [], geo = new THREE.CylinderGeometry(SR.s * 0.56, SR.s * 0.48, 0.7, 6);
  const cols = ['#ff7ab6', '#7ad0ff', '#ffd36a', '#9cf07a', '#c79bff'];
  for (let i = 0; i < SR.n; i++) for (let j = 0; j < SR.n; j++) {
    // hexagon grid: odd rows shifted half a tile
    const x = SR.x + (i - (SR.n - 1) / 2) * SR.s * 0.95 + (j % 2) * SR.s * 0.47, z = SR.z + (j - (SR.n - 1) / 2) * SR.s * 0.82;
    const m = new THREE.Mesh(geo, glow(cols[(i + j * 2) % cols.length], 0.15));
    m.position.set(x, SR.y - 0.35, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
    const h = SR.s * 0.42;
    const c = addCollider(x - h, SR.y - 0.7, z - h, x + h, SR.y, z + h, 'riot');
    tiles.push({ m, c, x, z, h, state: 0, t: 0, vy: 0, base: m.material.color.clone() });
  }
  g.visible = false;
  SR.built = { g, tiles };
  return SR.built;
}
function resetTiles() { for (const t of SR.built.tiles) { t.state = 0; t.t = 0; t.vy = 0; t.c.off = false; t.m.visible = true; t.m.position.y = SR.y - 0.35; t.m.rotation.set(0, 0, 0); t.m.material.color.copy(t.base); t.m.material.emissive.copy(t.base); } }
function startRiot() {
  const R = buildRiot(); R.g.visible = true; resetTiles();
  A.t = 0; A.left = 60; A.ballT = 0;
  tp(SR.x + rand(-3, 3), SR.y + 0.2, SR.z + rand(-3, 3), rand(0, 6));
  G.toast('🪂 SKY RIOT! Tiles crumble a moment after you step on them. Keep moving and stay up for 60 seconds!', '', 8000);
  sfx.win();
}
function crumble(t) { if (t.state === 0) { t.state = 1; t.t = 0.8; } }
function updateRiot(dt) {
  const R = SR.built, p = P();
  A.t += dt; A.left -= dt;
  // tiles under anyone (you and your friends) start to crumble
  const feet = [p.root];
  for (const r of G.remotes.values()) feet.push(r.root);
  for (const f of feet) {
    if (A.t < 3 || Math.abs(f.y - SR.y) > 0.6) continue;   // a few seconds to get ready first
    for (const t of R.tiles) if (t.state === 0 && Math.abs(f.x - t.x) < t.h + 0.3 && Math.abs(f.z - t.z) < t.h + 0.3) crumble(t);
  }
  // later on, random tiles drop by themselves too
  if (A.t > 15 && Math.random() < dt * (0.4 + A.t * 0.03)) { const t = pick(R.tiles); crumble(t); }
  for (const t of R.tiles) {
    if (t.state === 1) {
      t.t -= dt;
      t.m.position.x = t.x + Math.sin(G.time * 60) * 0.06;
      t.m.material.emissive.setRGB(1, 0.25, 0.1); t.m.material.color.setRGB(1, 0.4, 0.3);
      if (t.t <= 0) { t.state = 2; t.c.off = true; t.vy = 0; sfx.pop2(); }
    } else if (t.state === 2) {
      t.vy -= 30 * dt; t.m.position.y += t.vy * dt; t.m.rotation.x += dt * 2; t.m.rotation.z += dt * 1.3;
      if (t.m.position.y < SR.y - 90) { t.state = 3; t.m.visible = false; }
    }
  }
  hud(`🪂 <b>Sky Riot</b> · ${A.t < 3 ? 'GET READY! · ' : ''}Survive ${fmt(A.left)} · ${R.tiles.filter(t => t.state === 0).length} tiles left`);
  if (p.root.y < SR.y - 25) {
    sfx.bad();
    G.toast(`💨 You fell after ${Math.floor(A.t)} seconds! Try again from the phone.`, 'bad', 6000);
    stopArcade(true);
    tp(LOC.spawn.x, groundHeight(LOC.spawn.x, LOC.spawn.z, 999) + 0.1, LOC.spawn.z, 0);
    return;
  }
  if (A.left <= 0) {
    confetti(p.root); sfx.present();
    addMoney(150, '🪂 Survived Sky Riot!');
    G.toast('🏆 You SURVIVED Sky Riot! +$150', 'money', 7000);
    stopArcade(true);
  }
}

// ---------------------------------------------------------------- 🦖 Kaiju Smash
const KJ = { hit: new Set(), wasAir: false, fallV: 0, outfit: null };
function sendOutfit(o) { if (G.netSend) G.netSend({ t: 'outfit', outfit: o, name: G.save.name }); }
function startKaiju() {
  A.t = 0; A.left = 60; KJ.hit = new Set(); KJ.score = 0;
  const dino = SKINS.find(s => s.id === 'dino');
  KJ.outfit = G.save.outfit;
  if (dino) { const o = { ...dino.o, extras: [...(dino.o.extras || [])] }; P().setOutfit(o); sendOutfit(o); }
  G.fun.speed = 1.8; G.fun.jump = 1.7;
  tp(LOC.spawn.x, groundHeight(LOC.spawn.x, LOC.spawn.z, 999) + 0.1, LOC.spawn.z, 0);
  G.toast('🦖 KAIJU SMASH! Run into buildings and land MEGA JUMPS (Space) on them. Smash as many as you can in 60 seconds!', '', 8000);
  sfx.boom();
}
function smash(c, p, energy) { if (!c.b) return; KJ.hit.add(c.b); hitBuilding(c, p, energy); }
function updateKaiju(dt) {
  const p = P(), r = p.root;
  A.t += dt; A.left -= dt;
  if (p.vehicle) p.vehicle.removeOccupant(p);
  // running into walls smashes them
  for (const c of nearColliders(r.x, r.z)) {
    if (c.off || !c.b || r.y > c.maxY || r.y + 2 < c.minY) continue;
    if (r.x > c.minX - 1.2 && r.x < c.maxX + 1.2 && r.z > c.minZ - 1.2 && r.z < c.maxZ + 1.2 && Math.random() < dt * 6) smash(c, r.clone().setY(r.y + 1), 260);
  }
  // landing a mega jump makes a shockwave
  if (!p.grounded) { KJ.wasAir = true; KJ.fallV = Math.min(KJ.fallV, p.vel.y); }
  else if (KJ.wasAir) {
    KJ.wasAir = false;
    if (KJ.fallV < -9) {
      const R = 12;
      dust(r.clone(), 10, 3); G.camShake = Math.max(G.camShake || 0, 0.6); sfx.boom();
      const seen = new Set();
      for (let dx = -R; dx <= R; dx += 10) for (let dz = -R; dz <= R; dz += 10) for (const c of nearColliders(r.x + dx, r.z + dz)) {
        if (seen.has(c) || c.off || !c.b) continue; seen.add(c);
        const cx = Math.max(c.minX, Math.min(r.x, c.maxX)), cz = Math.max(c.minZ, Math.min(r.z, c.maxZ));
        if (Math.hypot(cx - r.x, cz - r.z) < R) smash(c, new THREE.Vector3(cx, Math.max(c.minY + 1, Math.min(r.y, c.maxY - 1)), cz), 1400);
      }
      for (const ch of G.characters) if (ch !== p && !ch.isRemote && !ch.vehicle && ch.root.distanceTo(r) < R) ch.flop(new THREE.Vector3(Math.sign(ch.root.x - r.x) * 9, 10, Math.sign(ch.root.z - r.z) * 9), 2.5);
      for (const v of G.vehicles) if (!v.display && v.pos.distanceTo(r) < R && v.vel) { v.vel.y = (v.vel.y || 0) + 9; }
    }
    KJ.fallV = 0;
  }
  KJ.score = [...KJ.hit].filter(b => b.dead).length;
  hud(`🦖 <b>Kaiju Smash</b> · ${fmt(A.left)} · 🏢 ${KJ.score} smashed`);
  if (A.left <= 0) {
    const won = KJ.score * 10;
    if (won) addMoney(won, `🦖 Smashed ${KJ.score} buildings!`);
    G.toast(`🦖 RAAAWR! You smashed ${KJ.score} building${KJ.score === 1 ? '' : 's'}! +$${won}. The builders are fixing the city...`, 'money', 8000);
    stopArcade(true);
    setTimeout(() => { rebuildCity(); G.toast('🏗️ Bobbly Town is rebuilt!'); }, 6000);
  }
}
function endKaiju() {
  G.fun.speed = 1; G.fun.jump = 1;
  if (KJ.outfit) { P().setOutfit(KJ.outfit); sendOutfit(KJ.outfit); KJ.outfit = null; }
}

// ---------------------------------------------------------------- 🎲 chaos events
const meteors = [], balls = [];
const rockGeo = new THREE.IcosahedronGeometry(1, 2), rockMat = new THREE.MeshStandardMaterial({ color: '#5a4038', emissive: '#ff5a1a', emissiveIntensity: 0.9, roughness: 0.8 });
function startEvent(id) {
  const e = EVENTS[id];
  A.ev = id; A.evT = e.dur; A.spawnT = 0;
  if (id === 'lowgrav') { G.fun.grav = 0.3; G.fun.jump = 1.25; }
  if (id === 'turbo') G.fun.speed = 2.2;
  const tips = { meteors: 'Meteors are falling around you, run!', lowgrav: 'Jump really high and float around!', balls: 'It\'s raining beach balls! Grab and throw them.', turbo: 'Your legs are super fast!' };
  G.toast(`${e.emo} SURPRISE: ${e.name}! ${tips[id]}`, '', 7000);
  sfx.whoosh();
}
function endEvent() {
  if (!A.ev) return;
  if (A.ev === 'lowgrav') { G.fun.grav = 1; G.fun.jump = A.mode === 'kaiju' ? 1.7 : 1; }
  if (A.ev === 'turbo') G.fun.speed = A.mode === 'kaiju' ? 1.8 : 1;
  G.toast(`${EVENTS[A.ev].emo} ${EVENTS[A.ev].name} is over.`);
  A.ev = null;
}
function updateEvent(dt) {
  const p = P(), r = p.vehicle ? p.vehicle.pos : p.root;
  A.evT -= dt; A.spawnT -= dt;
  if (A.ev === 'meteors' && A.spawnT <= 0) {
    A.spawnT = rand(0.5, 1.2);
    const m = new THREE.Mesh(rockGeo, rockMat); m.scale.setScalar(rand(0.8, 1.6));
    const tx = r.x + rand(-35, 35), tz = r.z + rand(-35, 35);
    m.position.set(tx + 40, r.y + 90, tz - 25); G.scene.add(m);
    meteors.push({ m, v: new THREE.Vector3(-40, -90, 25).multiplyScalar(1 / 2.2), tx, tz });
  }
  if (A.ev === 'balls' && A.spawnT <= 0 && balls.length < 40) {
    A.spawnT = 0.25;
    const b = new Prop('ball', r.x + rand(-18, 18), r.y + rand(14, 22), r.z + rand(-18, 18), { variant: pick(['red', 'blue', 'green', 'yellow']) });
    balls.push({ b, t: 60 });
  }
  if (A.evT <= 0) endEvent();
}
function updateMeteors(dt) {
  for (let i = meteors.length - 1; i >= 0; i--) {
    const M = meteors[i];
    M.m.position.addScaledVector(M.v, dt); M.m.rotation.x += dt * 3;
    if (Math.random() < 0.5) fire(M.m.position.clone(), 1, 1);
    const gy = groundHeight(M.m.position.x, M.m.position.z, M.m.position.y);
    if (M.m.position.y <= gy + 0.5) {
      const pos = M.m.position.clone(); pos.y = gy;
      explosion(pos, 1.3);
      for (const ch of G.characters) if (!ch.isRemote && !ch.vehicle && ch.root.distanceTo(pos) < 7) ch.flop(new THREE.Vector3(ch.root.x - pos.x, 8, ch.root.z - pos.z).normalize().multiplyScalar(12), 2);
      for (const c of nearColliders(pos.x, pos.z)) if (!c.off && c.b && pos.x > c.minX - 3 && pos.x < c.maxX + 3 && pos.z > c.minZ - 3 && pos.z < c.maxZ + 3) hitBuilding(c, pos.clone().setY(Math.max(pos.y, c.minY + 1)), 500);
      G.scene.remove(M.m); meteors.splice(i, 1);
    }
  }
  for (let i = balls.length - 1; i >= 0; i--) { const B = balls[i]; B.t -= dt; if (B.t <= 0 || B.b.dead) { if (!B.b.dead && !B.b.held) B.b.destroy(); if (B.b.dead || !B.b.held) balls.splice(i, 1); } }
}

// ---------------------------------------------------------------- control
export function startArcade(id) {
  if (G.mode && G.mode.m) { G.toast('🎮 Finish the party game first!', 'bad'); return; }
  if (A.mode) stopArcade(false);
  if (G.job) quitJob(true);
  A.mode = id; A.best = 0;
  if (id === 'tower') startTower();
  if (id === 'riot') startRiot();
  if (id === 'kaiju') startKaiju();
}
export function stopArcade(quiet = false) {
  if (!A.mode) return;
  const was = A.mode; A.mode = null;
  if (was === 'kaiju') endKaiju();
  if (was === 'tower' && TW.built) { TW.built.g.visible = false; tp(LOC.spawn.x, groundHeight(LOC.spawn.x, LOC.spawn.z, 999) + 0.1, LOC.spawn.z, 0); }
  if (was === 'riot' && SR.built) setTimeout(() => { if (A.mode !== 'riot') SR.built.g.visible = false; }, 4000);
  hud('');
  if (!quiet) G.toast(`${ARCADE[was].emo} ${ARCADE[was].name} stopped.`);
}
export function surprise() {
  const opts = [...Object.keys(ARCADE).map(k => ['mode', k]), ...Object.keys(EVENTS).filter(k => k !== A.ev).map(k => ['ev', k])];
  const [kind, id] = pick(opts);
  if (kind === 'mode') { G.toast('🎲 SURPRISE!', '', 2000); startArcade(id); }
  else { endEvent(); startEvent(id); }
}
export function updateArcade(dt) {
  if (A.mode === 'tower') updateTower(dt);
  else if (A.mode === 'riot') updateRiot(dt);
  else if (A.mode === 'kaiju') updateKaiju(dt);
  if (A.ev) updateEvent(dt);
  if (meteors.length || balls.length) updateMeteors(dt);
  // let the HUD say when a chaos event is on, if no mode is
  if (!A.mode) hud(A.ev ? `${EVENTS[A.ev].emo} <b>${EVENTS[A.ev].name}</b> · ${fmt(A.evT)}` : '');
}
export function arcadeKey(code) {
  if (code === 'KeyJ' && A.mode) { stopArcade(); return true; }
  return false;
}
