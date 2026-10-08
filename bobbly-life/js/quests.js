// Special characters with missions:
//  - King Flynn (owner of Bobbly Island) at his castle: collect every present to unlock him
//  - George, Flynn's silly son, hidden in his treehouse (no fast travel!): shoot down a runaway drone-plane
//  - Jacob on top of the Twin Towers: parachute to the crystal on another rooftop and bring it back
import * as THREE from 'three';
import { G, textSprite, rand, clamp } from './state.js';
import { Character, SKINS } from './character.js';
import { LOC, groundHeight, nearColliders, addCollider } from './world.js';
import { heightAt } from './terrain.js';
import { PRESENT_SPOTS } from './props.js';
import { Vehicle } from './vehicles.js';
import { explosion, smoke, fire, sparks, detach } from './debris.js';
import { sfx } from './audio.js';

const Q = { npcs: [] };
let dialogEl = null, missionEl = null;

function say(name, text, ms = 7000) {
  if (!dialogEl) {
    dialogEl = document.createElement('div');
    dialogEl.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);max-width:640px;width:90%;background:rgba(14,17,24,.92);border:1px solid rgba(255,176,32,.6);border-radius:14px;padding:14px 18px;color:#fff;font-family:Barlow,sans-serif;font-size:17px;z-index:30;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    document.body.appendChild(dialogEl);
  }
  dialogEl.innerHTML = `<div style="font-family:'Barlow Condensed',sans-serif;font-weight:800;color:#ffb020;font-size:20px;letter-spacing:1px">${name}</div>${text}`;
  dialogEl.style.display = 'block';
  clearTimeout(dialogEl._t); dialogEl._t = setTimeout(() => { dialogEl.style.display = 'none'; }, ms);
}
function mission(text) {
  if (!missionEl) {
    missionEl = document.createElement('div');
    missionEl.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:rgba(120,20,20,.85);color:#fff;font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:22px;padding:8px 18px;border-radius:10px;z-index:25;pointer-events:none;letter-spacing:.5px;text-align:center';
    document.body.appendChild(missionEl);
  }
  missionEl.style.display = text ? 'block' : 'none';
  if (text) missionEl.innerHTML = text;
}
function unlock(id, extraMoney = 0) {
  const sk = SKINS.find(s => s.id === id);
  if (!G.save.ownedSkins.includes(id)) G.save.ownedSkins.push(id);
  if (sk && !G.save.ownedHats.includes(sk.o.hat)) G.save.ownedHats.push(sk.o.hat);
  if (sk && !G.save.ownedGlasses.includes(sk.o.glasses)) G.save.ownedGlasses.push(sk.o.glasses);
  G.save.money += extraMoney;
  G.writeSave && G.writeSave();
  sfx.win();
  G.toast && G.toast(`${sk.emo} ${sk.name} unlocked! Wear it from the Skins tab at the clothing store${extraMoney ? ` · +$${extraMoney}` : ''}`, 'money', 9000);
}
function questNPC(name, outfit, x, y, z, facing, tagColor) {
  const c = new Character({ ...outfit, extras: [...outfit.extras] }, { name });
  c.place(x, y, z, facing);
  c.home = { x, y, z, facing };
  c.respawn = () => c.place(c.home.x, c.home.y, c.home.z, c.home.facing);
  const tag = textSprite(name.toUpperCase(), { size: 64, color: '#ffffff', bg: 'rgba(16,19,26,0.85)', accent: tagColor, scale: 1.6 });
  G.scene.add(tag); c.questTag = tag;
  Q.npcs.push(c);
  return c;
}
const outfitOf = (id) => SKINS.find(s => s.id === id).o;

// ---------------------------------------------------------------- setup
export function initQuests() {
  G.save.quests = G.save.quests || {};
  // --- King Flynn at the castle, with a throne and a royal carpet
  if (LOC.castle) {
    const cx = LOC.castle.x, cz = LOC.castle.z, y = groundHeight(cx, cz, 999);
    const gold = new THREE.MeshStandardMaterial({ color: '#d4a82a', metalness: 0.8, roughness: 0.3 });
    const red = new THREE.MeshLambertMaterial({ color: '#8a1020' });
    const throne = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 1.4), gold); seat.position.y = 0.4; throne.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3, 0.3), gold); back.position.set(0, 1.9, -0.6); throne.add(back);
    const cush = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 1.1), red); cush.position.y = 0.9; throne.add(cush);
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 12), red); carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.05, 6); throne.add(carpet);
    throne.position.set(cx, y, cz - 4); G.scene.add(throne);
    Q.flynn = questNPC('King Flynn', outfitOf('flynn'), cx, y + 0.9, cz - 3.6, 0, '#d4a82a');
    G.interacts.push({ x: cx, z: cz - 2, r: 5, label: () => '👑 Talk to King Flynn', action: talkFlynn });
  }
  // --- George's treehouse, hidden deep in the Funky Forest in the east (no fast travel, no map icon)
  buildTreehouse(1100, 300);
  // --- Jacob on the Twin Towers' rooftop deck
  if (LOC.twinTop) {
    const T = LOC.twinTop;
    Q.jacob = questNPC('Jacob', outfitOf('jacob'), T.x - 6, T.top + 0.3, T.z - 6, Math.PI / 4, '#ff6a1a');
    G.interacts.push({ x: T.x - 6, z: T.z - 6, r: 4, minY: T.top - 3, label: () => '🪂 Talk to Jacob', action: talkJacob });
    placeCrystal();
  }
}

// ---------------------------------------------------------------- Flynn
function talkFlynn() {
  const have = G.save.presents.length, need = PRESENT_SPOTS.length;
  if (G.save.ownedSkins.includes('flynn')) { say('King Flynn', 'Welcome back! You may dress as the King of Bobbly Island whenever you like. Have you met my son George? He hides in his treehouse deep in the <b>Funky Forest</b> in the east.'); return; }
  if (have >= need) {
    say('King Flynn', `All <b>${need}</b> presents?! Incredible! As owner of Bobbly Island I declare you royalty. Take my crown!`);
    unlock('flynn', 1000);
    return;
  }
  say('King Flynn', `I am <b>King Flynn</b>, owner of all of Bobbly Island! Bring me proof you've explored my island: find <b>all ${need} presents</b> hidden around it. You have <b>${have}</b> so far. Some are in the mountains, on rooftops and far out in the wild…<br><small>Psst — my son George hides in a treehouse somewhere in the colourful Funky Forest, east of the theme park.</small>`, 11000);
}

// ---------------------------------------------------------------- George + the runaway drone
// a smooth leafy ball (normals point straight out, so no facets show)
function roundBall(r) {
  const g = new THREE.IcosahedronGeometry(r, 3), p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const l = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)); n.setXYZ(i, p.getX(i) / l, p.getY(i) / l, p.getZ(i) / l); }
  return g;
}
function buildTreehouse(x, z) {
  const y = heightAt(x, z);
  const bark = new THREE.MeshLambertMaterial({ color: '#5a4030' }), wood = new THREE.MeshLambertMaterial({ color: '#a0703a' }), plank = new THREE.MeshLambertMaterial({ color: '#8a5a2b' });
  const leaf = new THREE.MeshLambertMaterial({ color: '#3f7a30' });
  const g = new THREE.Group(); g.position.set(x, y, z); G.scene.add(g);
  const add = (geo, m, px, py, pz, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.CylinderGeometry(1.1, 1.8, 16, 12), bark, 0, 8, 0);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.CylinderGeometry(0.25, 0.45, 5, 6), bark, Math.cos(a) * 2, 12 + (i % 2), Math.sin(a) * 2, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); }
  for (let i = 0; i < 9; i++) add(roundBall(rand(3, 4.5)), leaf, rand(-4, 4), 16 + rand(-1, 3), rand(-4, 4));
  const PY = 9;   // platform height
  add(new THREE.BoxGeometry(8, 0.4, 8), plank, 0, PY, 0);
  for (const [px, pz, sx, sz] of [[0, 4, 8, 0.15], [0, -4, 8, 0.15], [4, 0, 0.15, 8], [-4, 0, 0.15, 8]]) add(new THREE.BoxGeometry(sx, 1, sz), wood, px, PY + 0.7, pz);
  // little hut with a window and a pirate flag
  add(new THREE.BoxGeometry(3.6, 2.6, 3), wood, -1.6, PY + 1.5, -1.8);
  add(new THREE.ConeGeometry(2.9, 1.6, 4), new THREE.MeshLambertMaterial({ color: '#c0463a' }), -1.6, PY + 3.6, -1.8, 0, Math.PI / 4, 0);
  add(new THREE.BoxGeometry(0.9, 0.8, 0.05), new THREE.MeshLambertMaterial({ color: '#223' }), -1.6, PY + 1.8, -0.28);
  add(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), wood, 3.4, PY + 2, -3.4);
  add(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshLambertMaterial({ color: '#111', side: THREE.DoubleSide }), 4.1, PY + 3, -3.4);
  // rope ladder
  for (const sx of [-0.4, 0.4]) add(new THREE.CylinderGeometry(0.04, 0.04, PY, 5), new THREE.MeshLambertMaterial({ color: '#c8b080' }), sx + 0.5, PY / 2, 4.2);
  for (let k = 0.6; k < PY; k += 0.6) add(new THREE.BoxGeometry(0.9, 0.06, 0.12), wood, 0.5, k, 4.2);
  // colliders: trunk, platform floor, hut
  addCollider(x - 1.3, y, z - 1.3, x + 1.3, y + PY - 0.2, z + 1.3);
  addCollider(x - 4, y + PY - 0.2, z - 4, x + 4, y + PY + 0.2, z + 4);
  addCollider(x - 3.4, y + PY, z - 3.3, x + 0.2, y + PY + 2.8, z - 0.3);
  const sign = textSprite("GEORGE'S TREEHOUSE - KEEP OUT (JK COME UP)", { size: 64, color: '#ffffff', bg: 'rgba(16,19,26,0.85)', accent: '#ffcf4a', scale: 1.6 });
  sign.position.set(x + 0.5, y + 3, z + 5); G.scene.add(sign);
  Q.tree = { x, z, y, top: y + PY + 0.2 };
  Q.george = questNPC('George', outfitOf('george'), x + 1.8, y + PY + 0.3, z + 1.5, 0.6, '#ffcf4a');
  Q.george.emote = 'dance';
  G.interacts.push({ x: x + 0.5, z: z + 5, r: 3, label: () => '🪜 Climb the rope ladder', action: () => { G.player.place(x + 0.5, y + PY + 0.3, z + 2.6, Math.PI); sfx.jump(); } });
  G.interacts.push({ x: x + 1.8, z: z + 1.5, r: 3.2, minY: y + PY - 1, label: () => '🤪 Talk to George', action: talkGeorge });
  // a clearing next to the tree where his fighter jet waits
}
function talkGeorge() {
  if (Q.drone) { say('George', 'GO GO GO! Shoot it down before it hits the city!!'); return; }
  if (G.save.ownedSkins.includes('george')) { say('George', 'You saved the city! You\'re officially my best friend. Also I ate a bug earlier. Want to see? No? Okay. 🤪'); return; }
  say('George', "Oh hi! I'm George, King Flynn's son. I'm hiding from my maths homework. 🤪 BUT WAIT — the radio says a <b>runaway robot plane with nobody on board</b> is flying straight at Mega City! Take my <b>fighter jet</b> — I'll catapult you straight into the sky! Hold <b>Left Click</b> (or <b>F</b>) to fire the cannon and shoot it down!", 12000);
  setTimeout(startDroneMission, 2500);
}
function startDroneMission() {
  const T = Q.tree;
  // the fighter jet, catapulted into the air above the treehouse
  const jet = new Vehicle('fighter', T.x + 20, T.z - 40, Math.PI * 0.85, { id: 'georgejet' });
  jet.pos.y = T.y + 160; jet.onGround = false; jet.speed = 80; jet.throttle = 0.8; jet.fp = 0;
  const p = G.player;
  if (p.vehicle) p.vehicle.removeOccupant(p);
  jet.addOccupant(p, 0);
  Q.jet = jet;
  // the runaway drone: comes in from the north towards the city
  const city = { x: -600, z: -120 };
  const start = new THREE.Vector3(-250, 190, 950);
  const dir = new THREE.Vector3(city.x - start.x, 0, city.z - start.z).normalize();
  Q.drone = { pos: start, dir, speed: 30, hp: 14, mesh: droneMesh(), city };
  G.scene.add(Q.drone.mesh);
  sfx.whoosh();
  G.toast && G.toast('🛩️ Fighter jet launched! Arrow keys to fly, W/S throttle, Left Click / F to fire', '', 8000);
}
function droneMesh() {
  const g = new THREE.Group();
  const grey = new THREE.MeshLambertMaterial({ color: '#b8bcc2' }), dark = new THREE.MeshLambertMaterial({ color: '#3a3e44' });
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); g.add(o); return o; };
  const body = add(new THREE.CylinderGeometry(1, 1, 1, 12), grey, 0, 0, 0, 1.4, 12, 1.4); body.rotation.x = Math.PI / 2;
  const nose = add(new THREE.SphereGeometry(1, 12, 8), grey, 0, 0, 6, 1.4, 1.4, 2.2); void nose;
  add(new THREE.BoxGeometry(1, 1, 1), grey, 0, 0, 0.5, 22, 0.3, 2.6);
  add(new THREE.BoxGeometry(1, 1, 1), grey, 0, 0.9, -5.4, 0.25, 2.2, 1.6);
  add(new THREE.BoxGeometry(1, 1, 1), grey, 0, 0, -5.6, 6, 0.25, 1.2);
  add(new THREE.CylinderGeometry(1, 1, 1, 10), dark, 0, 1.3, -3.5, 0.8, 0.8, 2.5).rotation.x = Math.PI / 2;
  const blink = add(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2020' }), 0, 1.6, 0);
  g.userData.blink = blink;
  const tag = textSprite('RUNAWAY DRONE - NOBODY ON BOARD', { size: 64, color: '#ffffff', bg: 'rgba(120,20,20,0.9)', accent: '#ff3030', scale: 3 });
  tag.position.y = 6; g.add(tag);
  g.scale.setScalar(1.3);
  return g;
}
// cannon fired from the fighter jet
const bullets = [];
const _f = new THREE.Vector3(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const BULLET_G = new THREE.BoxGeometry(0.12, 0.12, 4), BULLET_M = new THREE.MeshBasicMaterial({ color: '#ffe080' });
export function fireCannon(v) {
  if ((v.cannonCd || 0) > G.time) return;
  v.cannonCd = G.time + 0.07;
  v.body.updateMatrixWorld(true);
  v.body.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q);
  for (const sx of [-0.6, 0.6]) {
    const m = new THREE.Mesh(BULLET_G, BULLET_M);
    m.position.set(sx, 1.3, 5).applyMatrix4(v.body.matrixWorld);
    m.quaternion.copy(_q);
    G.scene.add(m);
    bullets.push({ m, v: _f.clone().multiplyScalar(650 + Math.abs(v.speed)), t: 0 });
  }
  sfx.pew();
}
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.t += dt;
    _a.copy(b.m.position);
    b.m.position.addScaledVector(b.v, dt);
    const D = Q.drone;
    if (D) {
      // distance from the drone to this frame's bullet path
      _b.subVectors(b.m.position, _a); const len = _b.length(); _b.normalize();
      const t = clamp(_f.subVectors(D.pos, _a).dot(_b), 0, len);
      if (_a.addScaledVector(_b, t).distanceTo(D.pos) < 9) { hitDrone(b.m.position); b.t = 99; }
    }
    if (b.t > 1.4) { G.scene.remove(b.m); bullets.splice(i, 1); }
  }
}
function hitDrone(p) {
  const D = Q.drone; if (!D) return;
  D.hp--; sparks(p, 12);
  if (D.hp <= 6) smoke(D.pos, 2, true);
  if (D.hp <= 0) {
    explosion(D.pos.clone(), 2);
    // the wreck falls out of the sky, away from the city
    for (const ch of [...D.mesh.children]) detach(ch, new THREE.Vector3(D.dir.x * 20 + rand(-10, 10), rand(0, 10), D.dir.z * 20 + rand(-10, 10)), null, 30);
    G.scene.remove(D.mesh);
    Q.drone = null; mission(null);
    say('George', "YOU DID IT!!! 🎉 The city is safe! You're a hero! Here — you can be me now. It's the best character. Obviously. 🤪", 9000);
    if (!G.save.ownedSkins.includes('george')) unlock('george', 500);
  }
}
function updateDrone(dt) {
  const D = Q.drone;
  if (!D) return;
  D.pos.addScaledVector(D.dir, D.speed * dt);
  D.mesh.position.copy(D.pos);
  D.mesh.rotation.set(0, Math.atan2(D.dir.x, D.dir.z), Math.sin(G.time * 0.7) * 0.08);
  D.mesh.userData.blink.visible = Math.floor(G.time * 3) % 2 === 0;
  if (D.hp <= 6 && Math.random() < dt * 20) smoke(D.pos, 1, true);
  const left = Math.hypot(D.pos.x - D.city.x, D.pos.z - D.city.z);
  G.waypoint = { x: D.pos.x, z: D.pos.z };
  mission(`🎯 Shoot down the runaway drone! &nbsp; ${Math.round(left)} m from the city &nbsp; · &nbsp; damage ${14 - D.hp}/14`);
  if (left < 230) {
    // too late: it self-destructs over the edge of the city
    explosion(D.pos.clone(), 2.5);
    G.scene.remove(D.mesh); Q.drone = null; mission(null); G.waypoint = null;
    say('George', 'Nooo, it got too close and had to self-destruct! Come back to my treehouse and try again!', 8000);
    return;
  }
  if (Q.jet && (Q.jet.wrecked || !Q.jet.driver)) {
    if (Q.jet.wrecked) { G.scene.remove(D.mesh); Q.drone = null; mission(null); G.waypoint = null; say('George', 'You crashed my jet! 😱 Come back to the treehouse and I\'ll find another one…', 8000); }
  }
}

// ---------------------------------------------------------------- Jacob + the crystal
function placeCrystal() {
  const T = LOC.twinTop;
  // pick a mid-height rooftop 150-400 m from the towers
  let best = null;
  for (let r = 150; r <= 400 && !best; r += 50) for (let a = 0; a < 6.28 && !best; a += 0.4) {
    const x = T.x + Math.cos(a) * r, z = T.z + Math.sin(a) * r;
    for (const c of nearColliders(x, z)) if (c.b && !c.b.dead && !c.noDamage && c.maxY > 45 && c.maxY < 120 && (c.maxX - c.minX) > 12) { best = c; break; }
  }
  if (!best) return;
  const x = (best.minX + best.maxX) / 2, z = (best.minZ + best.maxZ) / 2, y = best.maxY + 1.6;
  const g = new THREE.Group();
  const cm = new THREE.MeshStandardMaterial({ color: '#7fe8ff', emissive: '#30c8ff', emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.9 });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), cm); gem.scale.set(0.8, 1.4, 0.8); g.add(gem);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#60e0ff', transparent: true, opacity: 0.25, depthWrite: false })); beam.position.y = 30; g.add(beam);
  g.position.set(x, y, z);
  G.scene.add(g);
  Q.crystal = { g, x, y, z, collider: best };
}
function talkJacob() {
  const st = G.save.quests.jacob;
  if (G.save.ownedSkins.includes('jacob')) { say('Jacob', 'Best parachute jump I\'ve ever seen. You\'re a natural! 🪂'); return; }
  if (Q.carrying) {
    Q.carrying = false; Q.crystalHeld && G.scene.remove(Q.crystalHeld); Q.crystalHeld = null; mission(null); G.waypoint = null;
    say('Jacob', 'You actually did it! The crystal! 🤩 You jumped, you glided, you nailed the landing. You can be me now — wear my gear with pride!', 9000);
    unlock('jacob', 500);
    return;
  }
  if (!Q.crystal) { say('Jacob', 'Hmm, I can\'t see my crystal anywhere… come back later!'); return; }
  G.save.quests.jacob = 'go';
  say('Jacob', "Hey! I'm Jacob, professional sky-diver. 🪂 See that <b>glowing blue crystal</b> on top of the building over there? <b>Jump off</b>, press <b>Space</b> to open your parachute, steer with <b>WASD</b>, land on that rooftop, grab the crystal and bring it back up here!", 12000);
  G.waypoint = { x: Q.crystal.x, z: Q.crystal.z };
  mission('🪂 Parachute onto the rooftop with the glowing crystal');
  void st;
}
function updateCrystal(dt) {
  const C = Q.crystal;
  if (!C) return;
  if (!Q.carrying) {
    C.g.rotation.y += dt * 1.5;
    C.g.children[0].position.y = Math.sin(G.time * 2) * 0.3;
    // if its building gets knocked down the crystal falls to the ground
    if (C.collider.off && C.y > heightAt(C.x, C.z) + 2) { C.y = heightAt(C.x, C.z) + 1.5; C.g.position.y = C.y; }
    const P = G.player.root;
    if (G.save.quests.jacob === 'go' && !G.player.vehicle && Math.hypot(P.x - C.x, P.z - C.z) < 2.6 && Math.abs(P.y - C.y) < 3.5) {
      Q.carrying = true; C.g.visible = false; sfx.present();
      const held = new THREE.Mesh(C.g.children[0].geometry, C.g.children[0].material); held.scale.set(0.35, 0.6, 0.35);
      G.scene.add(held); Q.crystalHeld = held;
      say('Jacob (on the radio)', 'You got it!! Now bring it back to me — take the lift in the South Tower back up to the roof!', 8000);
      G.waypoint = { x: LOC.twinTop.x, z: LOC.twinTop.z };
      mission('💎 Bring the crystal back to Jacob on the Twin Towers roof');
    }
  } else if (Q.crystalHeld) {
    const H = G.player.p[2];
    Q.crystalHeld.position.set(H.x, H.y + 1.1 + Math.sin(G.time * 3) * 0.1, H.z);
    Q.crystalHeld.rotation.y += dt * 2;
  }
}

// ---------------------------------------------------------------- per frame
export function updateQuests(dt) {
  for (const c of Q.npcs) {
    if (c.questTag) { const H = c.p[2]; c.questTag.position.set(H.x, H.y + 1.1, H.z); }
    // face the player when they come close
    const P = G.player.root;
    if (!c.ragdoll && Math.hypot(P.x - c.root.x, P.z - c.root.z) < 8) c.facing = Math.atan2(P.x - c.root.x, P.z - c.root.z);
    if (c === Q.george && !c.emote) c.emote = 'dance';
    // don't wander off (keep them home)
    if (!c.ragdoll && Math.hypot(c.root.x - c.home.x, c.root.z - c.home.z) > 3) c.respawn();
  }
  updateDrone(dt);
  updateBullets(dt);
  updateCrystal(dt);
}
