// Bobbly Life — main loop, player control, camera, multiplayer glue.
import * as THREE from 'three';
import { G, loadSave, writeSave, clamp, rand, pick, COLORS, angleLerp, UP } from './state.js';
import { buildWorld, buildLights, updateWorld, LOC, groundHeight, nearColliders } from './world.js';
import { Character, updateNPC, randomOutfit, PARTS } from './character.js';
import { Vehicle, VTYPES, bumpVehicles, randomCarColor } from './vehicles.js';
import { updateProps, kickProps, spawnPresents, updatePresents, updateTrees, hitTree, scatterProps, buildPropMesh } from './props.js';
import { initJobs, updateJobs, quitJob, updateFishing, stopFishing } from './jobs.js';
import * as UI from './ui.js';
import * as NET from './net.js';
import { initAudio, sfx, setEngine } from './audio.js';
import { WEAPONS, fire, spawnShot, applyHit, updateWeapons, updateGunMeshes } from './weapons.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------------------------------------------------------- setup
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 2200);
G.scene = scene; G.camera = camera; G.renderer = renderer;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

loadSave();
buildLights();
buildWorld();

const player = new Character(G.save.outfit, { isPlayer: true, name: G.save.name });
G.player = player;
player.place(LOC.spawn.x, 0, LOC.spawn.z, Math.PI);
player.respawn = (home) => {
  if (player.vehicle) player.vehicle.removeOccupant(player);
  if (player.held) dropHeld(false);
  stopFishing();
  const s = (home || G.save.house) && G.save.house ? { x: LOC.mansion.x, z: LOC.mansion.z - 2 } : LOC.spawn;
  player.place(s.x + rand(-2, 2), groundHeight(s.x, s.z, 5), s.z + rand(-2, 2), Math.PI);
};
player.onDrop = () => dropHeld(false);

// World vehicles
const WV = [
  ['scooter', 46, -10, 0], ['scooter', 46, -6, 0], ['scooter', 46, -2, 0], ['scooter', 46, 2, 0],
  ['taxi', -46, -9, Math.PI / 2], ['taxi', -46, 0, Math.PI / 2], ['taxi', -46, 9, Math.PI / 2],
  ['firetruck', 50, 68, 0], ['garbage', 42, -72, 0], ['pickup', -104, 16, Math.PI / 2], ['pickup', -92, -60, 0],
  ['icecream', -44, 46, Math.PI / 2], ['monster', -48, -40, Math.PI], ['sports', 27.5, -12, 0], ['sedan', -27.5, 14, Math.PI],
  ['police', 27.5, 16, 0], ['sedan', 92.5, 40, 0], ['sedan', -87.5, -20, Math.PI], ['sedan', 32.5, 120, 0], ['pickup', 150, 60, 0],
  ['boat', 200, 14, Math.PI / 2], ['boat', 205, -14, Math.PI / 2], ['heli', -76, -78, 0], ['sports', -150, -28, 0],
  ['biplane', -122, 164, Math.PI / 2], ['jet', -138, 171.5, Math.PI / 2],
];
WV.forEach(([t, x, z, yaw], i) => new Vehicle(t, x, z, yaw, { id: 'w' + i, color: t === 'sedan' ? ['#3fa7ff', '#ff5b6e', '#b46cff', '#46c25a'][i % 4] : null }));
// Showroom cars
[['sports', -12], ['monster', 0], ['police', 12]].forEach(([t, x], i) => {
  const v = new Vehicle(t, x, -50, Math.PI * 0.85, { id: 'd' + i });
  v.display = true;
});

// NPCs
for (let i = 0; i < 20; i++) {
  const s = pick(G.locations.sidewalks.filter(p => Math.hypot(p.x, p.z) < 160));
  const n = new Character(randomOutfit(), { isNPC: true });
  n.place(s.x + rand(-1, 1), 0, s.z + rand(-1, 1), rand(0, 6.28));
  n.respawn = () => n.place(LOC.spawn.x + rand(-5, 5), 0, LOC.spawn.z + rand(-5, 5));
  G.npcs.push(n);
}
scatterProps();
spawnPresents();
initJobs();
UI.initUI();

// ---------------------------------------------------------------- personal vehicles
let myVehicle = null;
G.spawnMyVehicle = (id) => {
  if (player.vehicle) { UI.toast('Get out of your current vehicle first!'); return; }
  if (myVehicle) { NET.send({ t: 'vdel', id: myVehicle.id }); myVehicle.destroy(); }
  const t = VTYPES[id];
  let x, z, yaw = player.facing;
  if (t.boat) {
    const nearWater = Math.max(Math.abs(player.root.x), Math.abs(player.root.z)) > 170;
    if (nearWater && Math.abs(player.root.x) > Math.abs(player.root.z)) { x = Math.sign(player.root.x) * 205; z = player.root.z; }
    else if (nearWater) { x = player.root.x; z = Math.sign(player.root.z) * 205; }
    else { x = 205; z = 20; UI.toast('🚤 Your boat is waiting at the pier!'); G.waypoint = { x: 200, z: 20 }; }
    yaw = Math.PI / 2;
  } else if (t.plane && Math.abs(player.root.z - 168) > 12) {
    x = -140; z = 168; yaw = Math.PI / 2;
    UI.toast(`${t.emo} Your plane is waiting on the airport runway!`); G.waypoint = { x: -140, z: 168 };
  } else {
    x = player.root.x + Math.sin(player.facing) * (t.len / 2 + 2.5);
    z = player.root.z + Math.cos(player.facing) * (t.len / 2 + 2.5);
  }
  myVehicle = new Vehicle(id, x, z, yaw, { owner: G.net.myId, color: t.color === '#3fa7ff' ? randomCarColor() : null });
  sfx.pop();
  UI.toast(`${t.emo} ${t.name} spawned!`);
};

// ---------------------------------------------------------------- input
const K = G.keys;
const touch = { mx: 0, my: 0, look: null };
addEventListener('keydown', (e) => {
  if (G.ui.chatOpen) return;
  if (e.code === 'Tab') e.preventDefault();
  if (!G.started) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  const first = !K[e.code];
  K[e.code] = true;
  if (!first) return;
  onKey(e.code);
});
addEventListener('keyup', (e) => {
  K[e.code] = false;
  if (e.code === 'KeyR') player.holdRag = false;
});
addEventListener('blur', () => { for (const k in K) K[k] = false; G.mouse.grab = false; G.mouse.fire = false; });

function onKey(code) {
  if (code === 'Escape') {
    if (G.ui.panel) UI.closePanel();
    else if (G.ui.help) UI.showHelp(false);
    else if (G.ui.fishing) stopFishing();
    return;
  }
  if (code === 'Tab' || code === 'KeyP') { UI.togglePhone(); return; }
  if (code === 'KeyH') { UI.showHelp(!G.ui.help); return; }
  if (G.ui.panel || G.ui.help) return;
  if (code === 'KeyT' || code === 'Enter') { UI.openChat(); return; }
  if (code === 'KeyE') interact();
  if (code === 'KeyF') slap();
  if (code === 'KeyR') {
    if (player.vehicle) return;
    if (player.ragdoll) { player.holdRag = false; player.ragMin = Math.min(player.ragMin, player.ragT); }
    else { stopFishing(); player.flop(null, 0.8); player.holdRag = true; }
  }
  if (code === 'KeyJ') quitJob();
  if (code === 'KeyG') cycleWeapon();
  if (code === 'KeyV' && player.vehicle && player.vehicle.type.siren) sfx.honk();
  if (code === 'KeyQ' && player.vehicle) sfx.honk();
  const emotes = { Digit1: 'wave', Digit2: 'dance', Digit3: 'cheer', Digit4: 'sit' };
  if (emotes[code] && !player.vehicle) { player.emote = player.emote === emotes[code] ? null : emotes[code]; player.emoteT = 0; }
}

canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (!G.started || G.ui.panel || G.ui.help) return;
  if (!document.pointerLockElement && !isTouch) { canvas.requestPointerLock && canvas.requestPointerLock(); }
  if (e.button === 0 && player.weapon && !player.vehicle) { G.mouse.fire = true; return; }
  if (e.button === 0 || e.button === 2) {
    if (G.mouse.grabLock) { G.mouse.grabLock = false; }
    G.mouse.grab = true;
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0 || e.button === 2) { G.mouse.grab = false; G.mouse.fire = false; } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  G.cam.yaw -= e.movementX * 0.0025;
  G.cam.pitch = clamp(G.cam.pitch + e.movementY * 0.0025, -0.35, 1.35);
  G.cam.lastMouse = G.time;
});
addEventListener('wheel', (e) => { if (G.started && !G.ui.panel) G.cam.dist = clamp(G.cam.dist + Math.sign(e.deltaY) * 0.8, 3, 18); }, { passive: true });

// Touch controls
if (isTouch) {
  document.body.classList.add('touch');
  const stick = $('stick'), knob = $('stickKnob');
  let sid = null;
  const setStick = (e) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy), m = r.width / 2;
    if (d > m) { dx *= m / d; dy *= m / d; }
    touch.mx = dx / m; touch.my = -dy / m;
    knob.style.left = (45 + dx) + 'px'; knob.style.top = (45 + dy) + 'px';
  };
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); setStick(e); initAudio(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) setStick(e); });
  const endStick = () => { sid = null; touch.mx = touch.my = 0; knob.style.left = knob.style.top = '45px'; };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  document.querySelectorAll('#tbtns button').forEach(b => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); initAudio();
      if (k === 'Grab') { if (player.weapon && !player.vehicle) { G.mouse.fire = true; return; } G.mouse.grabLock = false; G.mouse.grab = true; return; }
      if (G.ui.fishing && k === 'Space') { touch.reel = true; return; }
      K[k] = true; onKey(k);
    });
    const up = () => { if (k === 'Grab') { G.mouse.grab = false; G.mouse.fire = false; } else { K[k] = false; if (k === 'KeyR') player.holdRag = false; } touch.reel = false; };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointermove', (e) => {
    if (!touch.look || e.pointerId !== touch.look.id) return;
    G.cam.yaw -= (e.clientX - touch.look.x) * 0.006;
    G.cam.pitch = clamp(G.cam.pitch + (e.clientY - touch.look.y) * 0.004, -0.35, 1.35);
    touch.look.x = e.clientX; touch.look.y = e.clientY; G.cam.lastMouse = G.time;
  });
  const endLook = () => { touch.look = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
}

// ---------------------------------------------------------------- interactions
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();

function nearestInteract() {
  const P = player.root;
  let best = null, bd = 1e9;
  for (const it of G.interacts) {
    const d = Math.hypot(P.x - it.x, P.z - it.z);
    if (d < it.r && d < bd) { bd = d; best = it; }
  }
  return best;
}
function nearestVehicle() {
  let best = null, bd = 1e9;
  for (const v of G.vehicles) {
    if (v.display) continue;
    const d = Math.hypot(player.root.x - v.pos.x, player.root.z - v.pos.z);
    const reach = v.type.len / 2 + 2;
    if (d < reach && Math.abs(player.root.y - v.pos.y) < 3 && d < bd) {
      const free = v.remoteDriver ? !v.occupants[1] : (!v.occupants[0] || (v.seats.length > 1 && !v.occupants[1]));
      if (free) { bd = d; best = v; }
    }
  }
  return best;
}

function interact() {
  if (player.ragdoll) return;
  if (player.vehicle) {
    const v = player.vehicle;
    v.removeOccupant(player);
    sfx.door();
    if (v.stored && v.stored.length) {
      const pr = v.stored.shift(); pr.inVehicle = null;
      player.handPoint(pr.pos);
      pr.held = player; player.held = { kind: 'prop', obj: pr }; G.mouse.grabLock = true;
    }
    if (!v.driver && !v.remoteDriver) v.steerVis = 0;
    return;
  }
  const it = nearestInteract();
  if (it) { it.action(); return; }
  const v = nearestVehicle();
  if (v) {
    stopFishing();
    const seat = (!v.remoteDriver && !v.occupants[0]) ? 0 : 1;
    if (player.held) {
      if (player.held.kind === 'prop') { const pr = player.held.obj; pr.held = null; pr.inVehicle = v; (v.stored ||= []).push(pr); player.held = null; }
      else dropHeld(false);
    }
    G.mouse.grabLock = false; G.mouse.grab = false; player.ctrl.grab = false;
    player.emote = null;
    v.addOccupant(player, seat);
    sfx.door();
    if (seat === 0 && v.type.plane) UI.toast('✈️ W = more throttle · S = less · A/D turn · Space = nose up (take off when fast!) · Shift = nose down · E jump out', '', 8000);
    else if (seat === 0 && !G.seenDriveTip) { G.seenDriveTip = true; UI.toast(v.type.heli ? '🚁 W/S forward/back · A/D turn · Space up · Shift down · E exit' : 'W/S drive · A/D steer · Space brake · Q honk · E exit'); }
  }
}

function cycleWeapon() {
  const owned = Object.keys(WEAPONS).filter(id => G.save.ownedWeapons.includes(id));
  if (!owned.length) { UI.toast('🔫 You have no blasters yet — buy one at the Blaster Shop (stunt park)!'); G.waypoint = LOC.blasters; return; }
  const list = [null, ...owned];
  const i = list.indexOf(player.weapon || null);
  player.weapon = list[(i + 1) % list.length];
  G.save.weapon = player.weapon; writeSave();
  UI.toast(player.weapon ? `${WEAPONS[player.weapon].emo} ${WEAPONS[player.weapon].name} equipped — Left Click to shoot` : '✋ Blaster put away');
}
G.equipWeapon = (id) => { player.weapon = id; G.save.weapon = id; writeSave(); };

function slap() {
  if (player.ragdoll || player.vehicle || player.punchT > 0 || player.fishing) return;
  player.punchT = 0.3;
  setTimeout(() => {
    const f = player.fwd(_v);
    const hitPt = _w.copy(player.root).addScaledVector(f, 1.1); hitPt.y += 1.2;
    let hit = false;
    for (const ch of G.characters) {
      if (ch === player || ch.vehicle) continue;
      if (ch.p[PARTS.CHE].distanceTo(hitPt) < 1.3 || ch.p[PARTS.PEL].distanceTo(hitPt) < 1.1) {
        const imp = _u.copy(f).multiplyScalar(9); imp.y = 4.5;
        if (ch.isRemote) NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] });
        else ch.flop(imp, 2);
        hit = true;
      }
    }
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle) continue;
      if (pr.pos.distanceTo(hitPt) < 1.3) { pr.cargoOf = null; pr.vel.addScaledVector(f, 9); pr.vel.y += 3.5; hit = true; }
    }
    for (const t of G.trees) {
      if (!t.alive) continue;
      const dx = t.x - player.root.x, dz = t.z - player.root.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * f.x + dz * f.z) / (d || 1) > 0.2) {
        hitTree(t); hit = true;
        if (!t.alive) UI.toast('🪵 TIMBER! Grab the logs and bring them to the sawmill.');
        break;
      }
    }
    if (hit) sfx.slap();
  }, 110);
}

function dropHeld(throwIt = true) {
  const h = player.held;
  if (!h) return;
  player.held = null;
  const f = player.fwd(_v);
  const power = throwIt ? 7 + Math.hypot(player.vel.x, player.vel.z) * 0.5 : 1;
  if (h.kind === 'prop') {
    const pr = h.obj;
    pr.held = null;
    pr.vel.copy(player.vel).addScaledVector(f, power); pr.vel.y = throwIt ? 4.5 : 1;
  } else if (h.kind === 'char') {
    const n = h.obj;
    n.grabbedBy = null;
    const imp = _u.copy(f).multiplyScalar(power); imp.y = throwIt ? 5 : 1;
    n.flop(imp, 1.5);
  } else if (h.kind === 'remote') {
    const imp = _u.copy(f).multiplyScalar(power); imp.y = throwIt ? 5 : 1;
    NET.send({ t: 'hit', to: h.obj.netId, imp: [imp.x, imp.y, imp.z] });
  }
}
G.dropHeld = dropHeld;

function updateGrab() {
  const p = player;
  if (p.ragdoll || p.vehicle) { if (p.held) dropHeld(false); return; }
  const grabbing = p.ctrl.grab && !p.hose && !p.fishing;
  if (!grabbing) { if (p.held) dropHeld(!G.mouse.grabLock); return; }
  const hp = p.handPoint(_w);
  if (!p.held) {
    let best = null, bd = 1.35;
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle) continue;
      const d = pr.pos.distanceTo(hp) - pr.r;
      if (d < bd) { bd = d; best = { kind: 'prop', obj: pr }; }
    }
    for (const ch of G.characters) {
      if (ch === p || ch.vehicle) continue;
      const d = Math.min(ch.p[PARTS.CHE].distanceTo(hp), ch.p[PARTS.PEL].distanceTo(hp), ch.p[PARTS.HEAD].distanceTo(hp)) - 0.4;
      if (d < bd) { bd = d; best = { kind: ch.isRemote ? 'remote' : 'char', obj: ch }; }
    }
    if (best) {
      p.held = best;
      if (best.kind === 'prop') { best.obj.held = p; best.obj.cargoOf = null; }
      else if (best.kind === 'char') best.obj.flop(null, 2.5);
      sfx.pop();
    }
  }
  if (p.held && p.held.kind !== 'prop') {
    const f = p.fwd(_v);
    const pt = new THREE.Vector3().copy(hp).addScaledVector(f, 0.35);
    pt.y += 0.2;
    if (p.held.kind === 'char') {
      const n = p.held.obj;
      if (!n.ragdoll) n.flop(null, 2);
      n.grabbedBy = { point: pt, t: 0.25 };
      n.ragMin = Math.max(n.ragMin, n.ragT + 1);
    } else p.held.pullPt = pt;
  }
}

// ---------------------------------------------------------------- multiplayer glue
function addRemote(id, name, outfit) {
  if (id === G.net.myId || G.remotes.has(id)) return G.remotes.get(id);
  const r = new Character(outfit || randomOutfit(), { isRemote: true, name });
  r.netId = id;
  r.setName(name || 'Player');
  r.place(LOC.spawn.x, 0, LOC.spawn.z);
  G.remotes.set(id, r);
  updateRoomInfo();
  return r;
}
function removeRemote(id) {
  const r = G.remotes.get(id);
  if (!r) return;
  for (const v of G.vehicles) if (v.remoteDriver === id) v.remoteDriver = null;
  if (r.heldMesh) G.scene.remove(r.heldMesh);
  r.destroy();
  G.remotes.delete(id);
  if (player.held && player.held.obj === r) player.held = null;
  updateRoomInfo();
}
function updateRoomInfo() {
  if (G.net.mode === 'solo') return;
  const el = $('roomInfo');
  el.classList.remove('hidden');
  el.innerHTML = `🌐 Room <b>${G.net.code}</b> · ${NET.playerCount()} player${NET.playerCount() > 1 ? 's' : ''} <button class="btn small blue" id="copyLink">Copy invite link</button>`;
  $('copyLink').onclick = () => {
    const link = location.origin + location.pathname + '?room=' + G.net.code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => UI.toast('📋 Invite link copied! Send it to your friends.'), () => UI.toast('Invite link: ' + link, '', 9000));
  };
}

NET.on('hello', (m) => {
  const r = addRemote(m.from, m.name, m.outfit);
  UI.toast(`👋 ${m.name} joined the game!`);
  UI.chatLine('🌐', `${m.name} joined`, '#9be05a');
  if (G.net.mode === 'host') {
    const players = [{ id: G.net.myId, name: G.save.name, outfit: G.save.outfit }];
    for (const [id, rr] of G.remotes) if (id !== m.from) players.push({ id, name: rr.name, outfit: rr.outfit });
    NET.send({ t: 'welcome', to: m.from, players, d: G.dayTime });
  }
  void r;
});
NET.on('welcome', (m) => {
  for (const p of m.players) addRemote(p.id, p.name, p.outfit);
  G.dayTime = m.d;
  updateRoomInfo();
});
NET.on('leave', (m) => {
  const r = G.remotes.get(m.from);
  if (r) { UI.toast(`${r.name} left the game.`); UI.chatLine('🌐', `${r.name} left`, '#ff8fb0'); }
  removeRemote(m.from);
});
NET.on('disconnected', () => {
  UI.toast('❌ Lost connection to the host. You are now playing solo.', 'bad', 8000);
  for (const id of [...G.remotes.keys()]) removeRemote(id);
  G.net.mode = 'solo';
  $('roomInfo').classList.add('hidden');
});
NET.on('outfit', (m) => {
  const r = G.remotes.get(m.from);
  if (r) { r.setOutfit(m.outfit); if (m.name !== r.name) r.setName(m.name); }
});
NET.on('chat', (m) => {
  const r = G.remotes.get(m.from);
  UI.chatLine(r ? r.name : '???', String(m.text).slice(0, 100), '#8fd3ff');
});
NET.on('time', (m) => { if (G.net.mode === 'client') G.dayTime = m.d; });
NET.on('hit', (m) => {
  if (m.to && m.to !== G.net.myId) return;
  if (player.vehicle) return;
  stopFishing();
  player.flop(new THREE.Vector3(m.imp[0], m.imp[1], m.imp[2]), 2);
});
NET.on('pull', (m) => {
  if (m.to && m.to !== G.net.myId) return;
  if (player.vehicle) return;
  stopFishing();
  if (!player.ragdoll) player.flop(null, 1);
  player.grabbedBy = { point: new THREE.Vector3(m.pos[0], m.pos[1], m.pos[2]), t: 0.4 };
  player.ragMin = Math.max(player.ragMin, player.ragT + 0.6);
});
NET.on('shot', (m) => {
  if (!WEAPONS[m.w]) return;
  spawnShot(m.w, new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), true, m.c);
});
NET.on('shothit', (m) => {
  if (m.to && m.to !== G.net.myId) return;
  if (!WEAPONS[m.ty]) return;
  stopFishing();
  applyHit(player, new THREE.Vector3(...m.d), WEAPONS[m.ty]);
});
G.onRemoteShot = (ch, dir, type) => NET.send({ t: 'shothit', to: ch.netId, d: [dir.x, dir.y, dir.z], ty: type });
G.onRemoteHit = (ch, imp) => NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] });
NET.on('vdel', (m) => {
  const v = G.vehicles.find(v => v.id === m.id);
  if (v && !(player.vehicle === v && player.seat === 0)) { if (player.vehicle === v) v.removeOccupant(player); v.destroy(); }
});
NET.on('st', (m) => {
  let r = G.remotes.get(m.from);
  if (!r) return;
  r.applySnapshot(m.p, m.f, m.r);
  r.weapon = WEAPONS[m.w] ? m.w : null;
  // held item visual
  if (m.h !== r.heldType) {
    if (r.heldMesh) G.scene.remove(r.heldMesh);
    r.heldMesh = m.h ? buildPropMesh(m.h, m.hv) : null;
    if (r.heldMesh) G.scene.add(r.heldMesh);
    r.heldType = m.h;
  }
  // vehicle they drive
  if (m.v) {
    let v = G.vehicles.find(v => v.id === m.v.id);
    if (!v && VTYPES[m.v.t]) { v = new Vehicle(m.v.t, m.v.x, m.v.z, m.v.yaw, { id: m.v.id, color: m.v.c, owner: m.from }); v.pos.y = m.v.y; }
    if (v) {
      if (player.vehicle === v && player.seat === 0) { v.removeOccupant(player); UI.toast('Someone else took the wheel!'); }
      v.remoteDriver = m.from; v.net = m.v; v.netT = 0;
      if (r.drivingVid && r.drivingVid !== v.id) { const o = G.vehicles.find(x => x.id === r.drivingVid); if (o) o.remoteDriver = null; }
      r.drivingVid = v.id;
    }
  } else if (r.drivingVid) {
    const v = G.vehicles.find(x => x.id === r.drivingVid);
    if (v && v.remoteDriver === m.from) { v.remoteDriver = null; v.speed = 0; }
    r.drivingVid = null;
  }
});

let netAcc = 0, timeAcc = 0;
function netTick(dt) {
  if (G.net.mode === 'solo') return;
  netAcc += dt; timeAcc += dt;
  if (netAcc < 1 / 12) return;
  netAcc = 0;
  const heldProp = player.held && player.held.kind === 'prop' ? player.held.obj : null;
  const msg = {
    t: 'st', p: player.snapshot(), f: Math.round(player.facing * 100) / 100, r: player.ragdoll ? 1 : 0,
    h: heldProp ? heldProp.type : 0, hv: heldProp ? heldProp.variant : 0,
    v: player.vehicle && player.seat === 0 ? player.vehicle.netState() : 0,
    w: player.weapon || 0,
  };
  NET.send(msg);
  if (player.held && player.held.kind === 'remote' && player.held.pullPt) {
    const p = player.held.pullPt;
    NET.send({ t: 'pull', to: player.held.obj.netId, pos: [p.x, p.y, p.z] });
  }
  if (G.net.mode === 'host' && timeAcc > 10) { timeAcc = 0; NET.send({ t: 'time', d: G.dayTime }); }
}
G.onOutfit = () => NET.send({ t: 'outfit', outfit: G.save.outfit, name: G.save.name });
G.onChat = (text) => NET.send({ t: 'chat', text });
G.onJobStart = () => { UI.showHelp(false); };

// ---------------------------------------------------------------- title screen
function buildTitle() {
  const logo = $('logo');
  'BOBBLY LIFE'.split('').forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? ' ' : ch;
    s.style.animationDelay = (i * 0.1) + 's';
    logo.appendChild(s);
  });
  $('nameInput').value = G.save.name;
  const sw = (id, key, list) => {
    const el = $(id);
    el.innerHTML = '';
    for (const c of list) {
      const d = document.createElement('div');
      d.className = 'sw' + (G.save.outfit[key] === c ? ' sel' : '');
      d.style.background = c;
      d.onclick = () => { G.save.outfit[key] = c; player.setOutfit(G.save.outfit); writeSave(); sw(id, key, list); };
      el.appendChild(d);
    }
  };
  sw('swSkin', 'skin', ['#ffcf4a', '#f2c9a0', '#ffd6e8', '#9be05a', '#3fd6d0', '#ffb36b', '#b46cff', '#ff8fb0', '#c68b59', '#8b5a2b']);
  sw('swShirt', 'shirt', COLORS.slice(0, 12));
  sw('swPants', 'pants', COLORS.slice(0, 12));
  const room = new URLSearchParams(location.search).get('room');
  if (room) { $('codeInput').value = room.toUpperCase().slice(0, 5); $('titleMsg').style.color = '#2a8a3a'; $('titleMsg').textContent = 'Your friend invited you! Press Join 👉'; }
  const readName = () => {
    const n = $('nameInput').value.trim().replace(/[<>]/g, '').slice(0, 14);
    if (n) G.save.name = n;
    writeSave();
    return G.save.name;
  };
  const btns = ['btnSolo', 'btnHost', 'btnJoin'];
  const busy = (b) => btns.forEach(id => $(id).disabled = b);
  $('btnSolo').onclick = () => { readName(); startGame(); };
  $('btnHost').onclick = () => {
    readName(); initAudio(); busy(true);
    $('titleMsg').style.color = '#3f6f9e'; $('titleMsg').textContent = 'Creating a room...';
    NET.hostGame((err, code) => {
      busy(false);
      if (err) { $('titleMsg').style.color = '#d24'; $('titleMsg').textContent = err; return; }
      startGame();
      UI.toast(`🌐 Room created! Code: ${code} — click "Copy invite link" at the top to invite friends.`, '', 9000);
    }, (msg) => { $('titleMsg').textContent = msg; });
  };
  $('btnJoin').onclick = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 5) { $('titleMsg').style.color = '#d24'; $('titleMsg').textContent = 'Enter the 5-letter room code.'; return; }
    readName(); initAudio(); busy(true);
    $('titleMsg').style.color = '#3f6f9e'; $('titleMsg').textContent = 'Joining room ' + code + '...';
    NET.joinGame(code, (err) => {
      busy(false);
      if (err) { $('titleMsg').style.color = '#d24'; $('titleMsg').textContent = err; return; }
      startGame();
      NET.send({ t: 'hello', name: G.save.name, outfit: G.save.outfit });
      UI.toast('🌐 Joined room ' + code + '!');
    }, (msg) => { $('titleMsg').textContent = msg; });
  };
  $('codeInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('btnJoin').click(); });
  $('nameInput').addEventListener('keydown', (e) => e.stopPropagation());
}

function startGame() {
  initAudio();
  G.started = true;
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  player.name = G.save.name;
  player.respawn();
  player.weapon = G.save.weapon && G.save.ownedWeapons.includes(G.save.weapon) ? G.save.weapon : null;
  G.cam.yaw = 0; G.cam.pitch = 0.35;
  updateRoomInfo();
  if (!G.save.seenHelp) { G.save.seenHelp = true; writeSave(); UI.showHelp(true); }
  UI.toast(`Welcome to Bobbly Town, ${G.save.name}! Press Tab for your phone.`);
}

// ---------------------------------------------------------------- per-frame player control
function controlPlayer(dt) {
  const p = player;
  const blocked = G.ui.panel || G.ui.help || G.ui.chatOpen || !G.started;
  let ix = 0, iy = 0;
  if (!blocked) {
    ix = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0) + touch.mx;
    iy = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0) + touch.my;
  }
  ix = clamp(ix, -1, 1); iy = clamp(iy, -1, 1);
  const space = !blocked && (K.Space || touch.reel);
  if (p.vehicle) {
    p.ctrl.mx = p.ctrl.mz = 0;
    const v = p.vehicle;
    if (p.seat === 0 && !v.remoteDriver) {
      const inp = { throttle: iy, steer: -ix, brake: !!K.Space, up: !!space, down: !!(K.ShiftLeft || K.ShiftRight) };
      if (isTouch && v.type.heli) { inp.up = touch.my > 0.6; }
      v.drive(dt, inp);
      v.hitThings((ch, imp) => NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] }));
      v.catchCargo();
    }
    setEngine(p.seat === 0, v.speed + (v.type.heli ? v.pos.y * 0.3 : 0), v.type.heli || v.type.plane);
    return;
  }
  setEngine(false);
  const cy = G.cam.yaw;
  const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
  let mx = rx * ix + fx * iy, mz = rz * ix + fz * iy;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  p.ctrl.mx = mx; p.ctrl.mz = mz;
  p.ctrl.run = !!(K.ShiftLeft || K.ShiftRight) || (isTouch && l > 0.9);
  if (!G.ui.fishing && space && !p.prevSpace) p.ctrl.jump = true;
  p.prevSpace = space;
  p.ctrl.grab = !blocked && (G.mouse.grab || G.mouse.grabLock) && !p.ragdoll;
  p.ctrl.aim = p.weapon && !p.fishing ? G.cam.yaw + Math.PI : null;
  p.fireCd = (p.fireCd || 0) - dt;
  if (p.weapon && G.mouse.fire && !blocked && !p.ragdoll && !p.fishing && p.fireCd <= 0) {
    p.fireCd = WEAPONS[p.weapon].rate;
    const shot = fire(p, camera);
    NET.send({ t: 'shot', ...shot });
  }
  updateFishing(dt, space);
}

// ---------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
function pointSolid(x, y, z) {
  for (const c of nearColliders(x, z)) {
    if (!c.off && c.tag !== 'tree' && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y > c.minY && y < c.maxY) return true;
  }
  return false;
}
let camOrbit = 0;
function updateCamera(dt) {
  if (!G.started) {
    camOrbit += dt * 0.08;
    const P = player.root;
    camTarget.set(P.x, P.y + 1.4, P.z);
    camera.position.set(P.x + Math.sin(camOrbit) * 9, P.y + 3.2, P.z + Math.cos(camOrbit) * 9);
    camera.lookAt(camTarget);
    return;
  }
  const v = player.vehicle;
  const tgt = v ? _v.copy(v.pos).add(_w.set(0, v.type.heli || v.type.plane ? 2 : 1.4, 0)) : _v.copy(player.p[PARTS.CHE]).add(_w.set(0, 0.5, 0));
  camTarget.lerp(tgt, 1 - Math.exp(-dt * (v ? 12 : 10)));
  if (camTarget.distanceToSquared(tgt) > 400) camTarget.copy(tgt);
  let dist = G.cam.dist * (v ? (v.type.plane ? 2.4 : v.type.heli ? 2.1 : v.type.truck ? 1.8 : 1.5) : (player.weapon ? 0.8 : 1));
  if (v && player.seat === 0 && G.time - G.cam.lastMouse > 1.2 && Math.abs(v.speed) > 2) {
    const behind = v.speed >= 0 ? v.yaw + Math.PI : v.yaw;
    G.cam.yaw = angleLerp(G.cam.yaw, behind, 1 - Math.exp(-dt * 2));
  }
  const cp = Math.cos(G.cam.pitch), sp = Math.sin(G.cam.pitch);
  const dir = _u.set(Math.sin(G.cam.yaw) * cp, sp, Math.cos(G.cam.yaw) * cp);
  // pull the camera in if a wall is in the way
  let d = dist;
  for (let i = 1; i <= 10; i++) {
    const t = dist * i / 10;
    if (pointSolid(camTarget.x + dir.x * t, camTarget.y + dir.y * t, camTarget.z + dir.z * t)) { d = Math.max(1.5, t - 0.6); break; }
  }
  camera.position.copy(camTarget).addScaledVector(dir, d);
  const gh = groundHeight(camera.position.x, camera.position.z, camera.position.y + 0.3);
  if (camera.position.y < gh + 0.4) camera.position.y = gh + 0.4;
  camera.lookAt(camTarget);
}

// ---------------------------------------------------------------- misc updates
function pushCharacters() {
  const list = G.characters;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.ragdoll || a.vehicle || a.isRemote) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.ragdoll || b.vehicle || b.isRemote) continue;
      const dx = b.root.x - a.root.x, dz = b.root.z - a.root.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.81 && d2 > 1e-6 && Math.abs(a.root.y - b.root.y) < 1.5) {
        const d = Math.sqrt(d2), push = (0.9 - d) * 0.5 / d;
        a.root.x -= dx * push; a.root.z -= dz * push;
        b.root.x += dx * push; b.root.z += dz * push;
      }
    }
  }
}

function updateNPCs(dt) {
  for (const n of G.npcs) {
    updateNPC(n, dt);
    if (n.leaveT !== undefined) {
      n.leaveT -= dt;
      if (n.leaveT <= 0 && n.root.distanceTo(player.pos) > 30) n.dead = true;
    }
  }
  const dead = G.npcs.filter(n => n.dead);
  for (const n of dead) n.destroy();
  if (dead.length) G.npcs = G.npcs.filter(n => !n.dead);
}

function updatePrompt() {
  if (!G.started || G.ui.panel || G.ui.help) { UI.setPrompt(null); return; }
  const p = player;
  if (p.vehicle) { UI.setPrompt(`<b>E</b> Get out`); return; }
  if (p.ragdoll) { UI.setPrompt(p.holdRag ? 'Wheee! Release <b>R</b> to get up' : null); return; }
  const it = nearestInteract();
  if (it) { UI.setPrompt(`<b>E</b> ${it.label()}`); return; }
  const v = nearestVehicle();
  if (v) { UI.setPrompt(`<b>E</b> ${(!v.remoteDriver && !v.occupants[0]) ? 'Drive' : 'Ride in'} ${v.type.emo} ${v.type.name}`); return; }
  if (p.held) { UI.setPrompt(G.mouse.grabLock ? 'Holding — <b>Click</b> to throw' : 'Release to throw'); return; }
  UI.setPrompt(null);
}

function updateRemoteExtras() {
  for (const [, r] of G.remotes) {
    if (r.heldMesh) { r.handPoint(r.heldMesh.position); r.heldMesh.rotation.y = r.facing; }
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now(), frame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time += dt;
  frame++;

  controlPlayer(dt);
  if (G.started) updateGrab();
  for (const v of G.vehicles) if (!(v.driver === player && player.seat === 0)) v.update(dt); else v.sync();
  bumpVehicles();
  updateNPCs(dt);
  for (const c of G.characters) c.update(dt);
  pushCharacters();
  for (const c of G.characters) if (!c.isRemote) kickProps(c);
  updateWeapons(dt);
  updateGunMeshes();
  updateProps(dt);
  updateTrees(dt);
  if (G.started) {
    updatePresents(dt, (pr) => {
      const hat = pick(['party', 'propeller', 'bunny', 'cowboy', 'viking', 'witch', 'tophat', 'halo', 'crown', 'chef', 'beanie', 'hardhat', 'cone'].filter(h => !G.save.ownedHats.includes(h)));
      if (hat) G.save.ownedHats.push(hat);
      import('./character.js').then(({ HATS }) => {
        const h = HATS.find(x => x.id === hat);
        UI.toast(`🎁 Present ${G.save.presents.length}/20! +$50${h ? ' and a free ' + h.name + '!' : ''}`, 'money', 6000);
      });
      G.save.money += 50; writeSave();
      void pr;
    });
    updateJobs(dt);
  }
  updateRemoteExtras();
  updateWorld(dt, player.vehicle ? player.vehicle.pos : player.pos);
  updateCamera(dt);
  if (G.started) {
    UI.updateHUD();
    if (frame % 2 === 0) UI.drawMinimap();
    updatePrompt();
    const locked = document.pointerLockElement === canvas;
    $('crosshair').classList.toggle('hidden', !player.weapon || !!player.vehicle || player.ragdoll);
    $('clickToPlay').classList.toggle('hidden', isTouch || locked || !!G.ui.panel || G.ui.help || G.ui.chatOpen);
    netTick(dt);
    if (frame % 600 === 0) writeSave();
  }
  renderer.render(scene, camera);
}

buildTitle();
requestAnimationFrame(loop);
window.__bobbly = G; // handy for debugging in the console
void UP;
