// Jobs & activities: pizza, taxi, firefighter, garbage, lumberjack, fishing, races.
import * as THREE from 'three';
import { G, mat, rand, pick, clamp, addMoney, writeSave } from './state.js';
import { LOC, groundHeight } from './world.js';
import { Character, randomOutfit } from './character.js';
import { Prop } from './props.js';
import { sfx } from './audio.js';

export const JOBS = {
  pizza:   { name: 'Pizza Delivery', emo: '🍕', loc: LOC.pizza, desc: 'Deliver hot pizzas to houses before they go cold.' },
  taxi:    { name: 'Taxi Driver', emo: '🚕', loc: LOC.taxi, desc: 'Pick up passengers and drive them where they want to go.' },
  fire:    { name: 'Firefighter', emo: '🚒', loc: LOC.fire, desc: 'Spray water on burning buildings (hold Left Click).' },
  garbage: { name: 'Garbage Collector', emo: '🗑️', loc: LOC.recycle, desc: 'Collect trash bags and throw them in the dumpster.' },
  lumber:  { name: 'Lumberjack', emo: '🪓', loc: LOC.sawmill, desc: 'Chop trees with F and bring the logs to the sawmill.' },
  fishing: { name: 'Fishing', emo: '🎣', loc: LOC.fishing, desc: 'Catch fish at the end of the pier and sell them at the market.' },
  race:    { name: 'Stunt Race', emo: '🏁', loc: LOC.race, desc: 'Race through all the rings as fast as you can.' },
};

// ---------------------------------------------------------------- objective marker
let beam, arrow;
function initMarker() {
  beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffd54a', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  arrow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 4), new THREE.MeshBasicMaterial({ color: '#ffd54a' }));
  arrow.rotation.x = Math.PI;
  G.scene.add(beam, arrow);
  beam.visible = arrow.visible = false;
}
function showMarker(t) {
  if (!t) { beam.visible = arrow.visible = false; return; }
  const y = t.y !== undefined ? t.y : groundHeight(t.x, t.z, 100);
  beam.visible = arrow.visible = true;
  beam.position.set(t.x, y + 30, t.z);
  arrow.position.set(t.x, y + 3.5 + Math.sin(G.time * 4) * 0.4, t.z);
  arrow.rotation.y += 0.05;
}

function near(p, t, r) { return Math.hypot(p.x - t.x, p.z - t.z) < r; }
function playerPos() { return G.player.vehicle ? G.player.vehicle.pos : G.player.pos; }

export function startJob(id) {
  if (G.job && G.job.id === id) { quitJob(); return; }
  if (G.job) quitJob(true);
  const J = { id, t: 0, target: null, markers: [], count: 0 };
  G.job = J;
  G.onJobStart && G.onJobStart(id);
  starters[id](J);
  sfx.pop();
}

export function quitJob(silent = false) {
  const J = G.job;
  if (!J) return;
  J.cleanup && J.cleanup();
  G.job = null;
  G.player.hose = false;
  showMarker(null);
  G.clearJob && G.clearJob();
  if (!silent) G.toast(`Stopped ${JOBS[J.id].name}. Earned $${J.earned || 0} this shift.`);
}

function pay(J, amount, why) {
  J.earned = (J.earned || 0) + amount;
  addMoney(amount, why);
  sfx.coin();
}

function giveProp(prop) {
  const p = G.player;
  if (p.held && G.dropHeld) G.dropHeld(false);
  if (p.vehicle) { prop.inVehicle = p.vehicle; (p.vehicle.stored ||= []).push(prop); }
  else { prop.held = p; p.held = { kind: 'prop', obj: prop }; p.ctrl.grab = true; G.mouse.grabLock = true; }
}

// ---------------------------------------------------------------- job starters
const starters = {
  pizza(J) {
    J.stage = 'return';
    J.cleanup = () => { if (J.prop && !J.prop.dead) J.prop.destroy(); };
    J.update = (dt) => {
      const pp = playerPos();
      if (J.stage === 'return') {
        J.target = LOC.pizza;
        G.setJob('🍕 Pizza Delivery', 'Go to the Pizza Place counter to grab a pizza.', null);
        if (near(pp, LOC.pizza, 6)) {
          const houses = G.locations.houses.filter(h => Math.hypot(h.door.x - LOC.pizza.x, h.door.z - LOC.pizza.z) > 40);
          J.house = pick(houses);
          J.prop = new Prop('pizza', pp.x, pp.y + 1.5, pp.z);
          giveProp(J.prop);
          const d = Math.hypot(J.house.door.x - pp.x, J.house.door.z - pp.z);
          J.timer = Math.round(25 + d / 6);
          J.stage = 'deliver';
          G.toast('🍕 Deliver this pizza to ' + J.house.name + '! Hop on a scooter to be quick.');
        }
      } else if (J.stage === 'deliver') {
        J.timer -= dt;
        J.target = J.house.door;
        G.setJob('🍕 Pizza Delivery', `Deliver the pizza to ${J.house.name} (door marker).`, J.timer);
        const pr = J.prop;
        const delivered = pr && !pr.dead && (
          (!pr.held && !pr.inVehicle && near(pr.pos, J.house.door, 3.5)) ||
          ((pr.held === G.player || (pr.inVehicle && pr.inVehicle === G.player.vehicle)) && near(pp, J.house.door, G.player.vehicle ? 6 : 3.5)));
        if (delivered) {
          const tip = Math.max(0, Math.round(J.timer));
          pay(J, 25 + tip, `Pizza delivered! (+$${tip} tip)`);
          G.save.stats.deliveries++;
          if (pr.inVehicle) { const st = pr.inVehicle.stored; st.splice(st.indexOf(pr), 1); }
          if (pr.held) G.player.held = null;
          pr.destroy(); J.prop = null;
          J.stage = 'return';
          G.toast('Great job! Head back for the next pizza.');
        } else if (J.timer <= 0 || !pr || pr.dead) {
          G.toast('😢 The pizza went cold... back to the Pizza Place!', 'bad'); sfx.bad();
          if (pr && !pr.dead) { if (pr.held) G.player.held = null; if (pr.inVehicle) { const st = pr.inVehicle.stored; st.splice(st.indexOf(pr), 1); } pr.destroy(); }
          J.prop = null; J.stage = 'return';
        }
      }
    };
  },

  taxi(J) {
    J.stage = 'getTaxi';
    J.cleanup = () => {
      if (J.npc) { if (J.npc.vehicle) J.npc.vehicle.removeOccupant(J.npc); J.npc.passengerFor = null; J.npc.leaveT = 15; }
    };
    const newFare = () => {
      const pp = playerPos();
      const opts = G.locations.sidewalks.filter(s => { const d = Math.hypot(s.x - pp.x, s.z - pp.z); return d > 30 && d < 130; });
      const s = pick(opts.length ? opts : G.locations.sidewalks);
      const npc = new Character(randomOutfit(), { isNPC: true });
      npc.place(s.x, 0, s.z, rand(0, 6.28));
      npc.passengerFor = G.player;
      G.npcs.push(npc);
      J.npc = npc; J.stage = 'pickup';
      G.toast('🚕 A passenger is waiting! Follow the marker.');
    };
    J.update = (dt) => {
      const pv = G.player.vehicle;
      const inTaxi = pv && pv.type.taxi && G.player.seat === 0;
      if (J.stage === 'getTaxi') {
        const taxis = G.vehicles.filter(v => v.type.taxi && !v.driver);
        const t = taxis.sort((a, b) => a.pos.distanceTo(G.player.pos) - b.pos.distanceTo(G.player.pos))[0];
        J.target = t ? { x: t.pos.x, z: t.pos.z } : LOC.taxi;
        G.setJob('🚕 Taxi Driver', 'Get in a taxi (press E next to it).', null);
        if (inTaxi) newFare();
        return;
      }
      if (J.stage === 'pickup') {
        J.target = { x: J.npc.root.x, z: J.npc.root.z };
        G.setJob('🚕 Taxi Driver', inTaxi ? 'Drive to the waving passenger and stop next to them.' : 'Get back in your taxi!', null);
        if (inTaxi && near(pv.pos, J.npc.root, 8) && Math.abs(pv.speed) < 4 && !pv.occupants[1]) {
          J.npc.vehicle = null;
          pv.addOccupant(J.npc, 1);
          J.npc.emote = null;
          const pp = pv.pos;
          const dests = G.locations.houses.filter(h => { const d = Math.hypot(h.door.x - pp.x, h.door.z - pp.z); return d > 50 && d < 220; });
          J.dest = pick(dests.length ? dests : G.locations.houses);
          J.dist = Math.hypot(J.dest.door.x - pp.x, J.dest.door.z - pp.z);
          J.timer = Math.round(18 + J.dist / 7);
          J.stage = 'dropoff';
          sfx.door();
          G.toast(`"Take me to ${J.dest.name}, please!"`);
        }
        return;
      }
      if (J.stage === 'dropoff') {
        J.timer -= dt;
        J.target = J.dest.door;
        G.setJob('🚕 Taxi Driver', `Drive your passenger to ${J.dest.name}.`, J.timer);
        const v = J.npc.vehicle;
        if (v && near(v.pos, J.dest.door, 9) && Math.abs(v.speed) < 4) {
          v.removeOccupant(J.npc);
          J.npc.passengerFor = null; J.npc.leaveT = 20;
          const tip = Math.max(0, Math.round(J.timer));
          pay(J, Math.round(15 + J.dist / 6) + tip, `Fare paid! (+$${tip} tip)`);
          G.save.stats.fares++;
          J.npc = null;
          sfx.door();
          newFare();
        } else if (J.timer <= 0) {
          if (v) { v.removeOccupant(J.npc); }
          J.npc.passengerFor = null; J.npc.leaveT = 20;
          J.npc.flop(new THREE.Vector3(0, 6, 0), 2);
          G.toast('😠 Your passenger got tired of waiting and jumped out!', 'bad'); sfx.bad();
          J.npc = null;
          newFare();
        }
      }
    };
  },

  fire(J) {
    G.player.hose = true;
    J.fires = [];
    J.cleanup = () => { for (const f of J.fires) G.scene.remove(f.mesh); J.fires = []; };
    const ignite = () => {
      const b = pick(LOC.fireBuildings.filter(b => Math.hypot(b.x - LOC.fire.x, b.z - LOC.fire.z) > 25));
      J.building = b;
      const n = randi(3, 5);
      for (let i = 0; i < n; i++) {
        const side = randi(0, 3);
        const t = rand(-0.4, 0.4);
        let x = b.x, z = b.z;
        if (side === 0) { x += b.w / 2 + 0.3; z += t * b.d; }
        else if (side === 1) { x -= b.w / 2 + 0.3; z += t * b.d; }
        else if (side === 2) { z += b.d / 2 + 0.3; x += t * b.w; }
        else { z -= b.d / 2 + 0.3; x += t * b.w; }
        const y = rand(0.5, Math.min(b.h - 1, 7));
        J.fires.push(makeFire(x, y, z));
      }
      J.timer = 100;
      J.stage = 'fight';
      G.toast('🔥 FIRE! A building is burning — follow the marker!', 'bad');
    };
    J.stage = 'wait'; J.wait = 1;
    J.update = (dt) => {
      animateFires(J.fires);
      if (J.stage === 'wait') {
        J.wait -= dt;
        G.setJob('🚒 Firefighter', 'Waiting for the next emergency call...', null);
        J.target = null;
        if (J.wait <= 0) ignite();
        return;
      }
      J.timer -= dt;
      const alive = J.fires.filter(f => f.hp > 0);
      const nearest = alive.sort((a, b) => a.pos.distanceTo(G.player.pos) - b.pos.distanceTo(G.player.pos))[0];
      J.target = nearest ? { x: nearest.pos.x, z: nearest.pos.z } : null;
      G.setJob('🚒 Firefighter', `Put out the fires! ${alive.length} left. Hold Left Click to spray water.`, J.timer);
      if (!alive.length) {
        pay(J, 60 + Math.round(J.timer * 0.6), 'Fire put out! Hero! 🧯');
        G.save.stats.fires++;
        J.cleanup(); J.fires = [];
        J.stage = 'wait'; J.wait = 6;
      } else if (J.timer <= 0) {
        G.toast('The fire burned out on its own... try to be faster!', 'bad'); sfx.bad();
        J.cleanup(); J.fires = [];
        J.stage = 'wait'; J.wait = 6;
      }
    };
  },

  garbage(J) {
    J.bags = [];
    J.cleanup = () => { for (const b of J.bags) if (!b.dead) b.destroy(); };
    const spawnBags = () => {
      const spots = G.locations.sidewalks.filter(s => Math.hypot(s.x - LOC.recycle.x, s.z - LOC.recycle.z) < 120 && Math.hypot(s.x - LOC.recycle.x, s.z - LOC.recycle.z) > 20);
      J.bags = [];
      for (let i = 0; i < 6; i++) {
        const s = pick(spots);
        J.bags.push(new Prop('bag', s.x + rand(-1.5, 1.5), 1, s.z + rand(-1.5, 1.5)));
      }
      G.toast('🗑️ 6 trash bags spotted around town! Garbage truck is at the recycling center.');
    };
    spawnBags();
    J.update = () => {
      const left = J.bags.filter(b => !b.dead);
      const holding = G.player.held && G.player.held.obj && G.player.held.obj.type === 'bag';
      if (holding || (G.player.vehicle && G.player.vehicle.cargo.some(c => c.type === 'bag'))) J.target = LOC.dumpster;
      else {
        const pp = playerPos();
        const nb = left.filter(b => !b.cargoOf).sort((a, b) => a.pos.distanceTo(pp) - b.pos.distanceTo(pp))[0];
        J.target = nb ? { x: nb.pos.x, z: nb.pos.z } : LOC.dumpster;
      }
      J.markers = left.map(b => b.pos);
      G.setJob('🗑️ Garbage Collector', `Throw trash bags into the dumpster. ${left.length} left. (Load them in a truck to carry many!)`, null);
      if (!left.length) { pay(J, 40, 'All trash collected! Bonus!'); spawnBags(); }
    };
  },

  lumber(J) {
    J.update = () => {
      const holding = G.player.held && G.player.held.obj && G.player.held.obj.type === 'log';
      const cargo = G.player.vehicle && G.player.vehicle.cargo.some(c => c.type === 'log');
      if (holding || cargo) { J.target = LOC.logZone; G.setJob('🪓 Lumberjack', 'Bring the log to the yellow zone at the sawmill ($20 each).', null); return; }
      const pp = playerPos();
      const logs = G.props.filter(p => p.type === 'log' && !p.cargoOf && !p.held);
      const nl = logs.sort((a, b) => a.pos.distanceTo(pp) - b.pos.distanceTo(pp))[0];
      if (nl && nl.pos.distanceTo(pp) < 60) { J.target = { x: nl.pos.x, z: nl.pos.z }; G.setJob('🪓 Lumberjack', 'Grab the log (hold Left Click) and carry it to the sawmill.', null); return; }
      const trees = G.trees.filter(t => t.alive && t.x < -90 && t.z < -30);
      const nt = trees.sort((a, b) => Math.hypot(a.x - pp.x, a.z - pp.z) - Math.hypot(b.x - pp.x, b.z - pp.z))[0];
      J.target = nt ? { x: nt.x, z: nt.z } : null;
      G.setJob('🪓 Lumberjack', 'Walk up to a tree in the forest and press F to chop it (5 hits).', null);
    };
  },

  fishing(J) {
    J.update = () => {
      J.target = G.player.fishing ? null : LOC.fishing;
      const holding = G.player.held && G.player.held.obj && G.player.held.obj.type === 'fish';
      if (holding) { J.target = LOC.fishMarket; G.setJob('🎣 Fishing', 'Bring your catch to the blue Fish Market mat to sell it.', null); }
      else G.setJob('🎣 Fishing', G.player.fishing ? 'Wait for a bite, then reel it in!' : 'Go to the end of the pier and press E to fish.', null);
    };
  },

  race(J) {
    const pts = [[-30, -52], [-30, -120], [-30, -150], [30, -150], [30, -90], [90, -90], [90, -30], [30, -30], [-30, -30], [-42, -42]];
    J.rings = pts.map(([x, z], i) => {
      const pv = i ? pts[i - 1] : [-42, -60];
      const m = new THREE.Mesh(new THREE.TorusGeometry(5, 0.45, 8, 28), new THREE.MeshBasicMaterial({ color: i === pts.length - 1 ? '#ff5b6e' : '#ffd54a', transparent: true, opacity: 0.85 }));
      m.position.set(x, 5, z);
      m.rotation.y = Math.atan2(x - pv[0], z - pv[1]);
      m.visible = false;
      G.scene.add(m);
      return { x, z, m };
    });
    J.idx = 0; J.stage = 'count'; J.count = 3.5;
    J.cleanup = () => { for (const r of J.rings) G.scene.remove(r.m); };
    J.update = (dt) => {
      J.rings.forEach((r, i) => { r.m.visible = i === J.idx || i === J.idx + 1; r.m.material.opacity = i === J.idx ? 0.9 : 0.35; });
      const r = J.rings[J.idx];
      J.target = { x: r.x, z: r.z };
      if (J.stage === 'count') {
        const before = Math.ceil(J.count);
        J.count -= dt;
        const now = Math.ceil(J.count);
        if (now !== before && now > 0) { G.toast(`🏁 ${now}...`); sfx.pop(); }
        G.setJob('🏁 Stunt Race', 'Get ready! Use any vehicle — or your wobbly legs!', null);
        if (J.count <= 0) { J.stage = 'go'; J.t = 0; G.toast('GO GO GO! 🏁'); sfx.win(); }
        return;
      }
      J.t += dt;
      G.setJob('🏁 Stunt Race', `Ring ${J.idx + 1} / ${J.rings.length}. Best: ${G.save.raceBest ? G.save.raceBest.toFixed(1) + 's' : '—'}`, -J.t);
      const pp = playerPos();
      if (near(pp, r, 6.5) && Math.abs(pp.y - r.m.position.y) < 9) {
        sfx.pop();
        J.idx++;
        if (J.idx >= J.rings.length) {
          const t = J.t;
          const best = !G.save.raceBest || t < G.save.raceBest;
          if (best) G.save.raceBest = t;
          writeSave();
          pay(J, Math.max(25, Math.round(160 - t * 1.5)), `Race finished in ${t.toFixed(1)}s${best ? ' — NEW RECORD! 🏆' : ''}`);
          sfx.win();
          quitJob(true);
        }
      }
    };
  },
};

function randi(a, b) { return Math.floor(rand(a, b + 1)); }

// ---------------------------------------------------------------- fire & water
const flameMats = [mat('#ff5a1a', { emissive: '#ff3300', emissiveIntensity: 0.9 }), mat('#ffb21a', { emissive: '#ffaa00', emissiveIntensity: 0.9 })];
const flameGeo = new THREE.ConeGeometry(0.6, 1.8, 7);
function makeFire(x, y, z) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(flameGeo, flameMats[i % 2]);
    m.position.set(rand(-0.8, 0.8), rand(0, 0.6), rand(-0.8, 0.8));
    g.add(m);
  }
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: '#555', transparent: true, opacity: 0.35 }));
  smoke.position.y = 3;
  g.add(smoke);
  g.position.set(x, y, z);
  G.scene.add(g);
  return { pos: new THREE.Vector3(x, y, z), hp: 100, mesh: g };
}
function animateFires(fires) {
  for (const f of fires) {
    if (f.hp <= 0) continue;
    const s = 0.4 + f.hp / 100 * 0.8;
    f.mesh.children.forEach((c, i) => {
      if (i < 5) c.scale.set(s, s * (0.8 + Math.sin(G.time * 12 + i * 2) * 0.3), s);
      else { c.position.y = 3 + ((G.time + i) % 2) * 1.5; c.scale.setScalar(1 + ((G.time) % 2) * 0.6); }
    });
  }
}

const drops = [];
const dropGeo = new THREE.SphereGeometry(0.18, 6, 5);
const dropMat = new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.8 });
let sprayAcc = 0;
export function updateWater(dt) {
  const p = G.player;
  if (p.hose && p.ctrl.grab && !p.ragdoll && !p.vehicle) {
    sprayAcc += dt;
    while (sprayAcc > 0.03) {
      sprayAcc -= 0.03;
      const d = new THREE.Mesh(dropGeo, dropMat);
      p.handPoint(d.position);
      const f = p.facing;
      const pitch = clamp(0.25 + G.cam.pitch * -0.6 + 0.2, -0.2, 0.9);
      d.userData.v = new THREE.Vector3(Math.sin(f) * 20 + rand(-1, 1), pitch * 14 + rand(-1, 1), Math.cos(f) * 20 + rand(-1, 1));
      d.userData.life = 1.4;
      G.scene.add(d); drops.push(d);
      if (Math.random() < 0.2) sfx.water();
    }
  }
  const fires = G.job && G.job.fires ? G.job.fires : [];
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.userData.v.y -= 18 * dt;
    d.position.addScaledVector(d.userData.v, dt);
    d.userData.life -= dt;
    let dead = d.userData.life <= 0 || d.position.y < 0;
    for (const f of fires) {
      if (f.hp > 0 && d.position.distanceTo(f.pos) < 2.6) {
        f.hp -= 2.2; dead = true;
        if (f.hp <= 0) { G.scene.remove(f.mesh); sfx.splash(); }
      }
    }
    // water pushes npcs/props a little
    if (dead) { G.scene.remove(d); drops.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- fishing minigame
const FISH = [
  { v: 'common', name: 'Sardine', price: 15, w: 55 },
  { v: 'bass', name: 'Big Bass', price: 35, w: 25 },
  { v: 'gold', name: 'GOLDEN FISH', price: 150, w: 6 },
  { v: 'boot', name: 'Old Boot', price: 2, w: 14 },
];
const F = { stage: null };
export function startFishing() {
  const p = G.player;
  if (p.vehicle || p.ragdoll) return;
  if (p.held && G.dropHeld) G.dropHeld(false);
  p.fishing = true;
  p.facing = Math.PI / 2;
  p.vel.set(0, 0, 0);
  F.stage = 'wait'; F.t = rand(2, 5);
  G.ui.fishing = true;
  document.getElementById('fishUI').classList.remove('hidden');
  msg('Waiting for a bite... 🎣');
  document.getElementById('fishBar').style.opacity = 0.4;
}
export function stopFishing(text) {
  G.player.fishing = false;
  G.ui.fishing = false;
  F.stage = null;
  document.getElementById('fishUI').classList.add('hidden');
  if (text) G.toast(text);
}
function msg(t) { document.getElementById('fishMsg').textContent = t; }
export function updateFishing(dt, holdUp) {
  if (!F.stage) return;
  const p = G.player;
  if (!p.fishing || p.ragdoll || Math.hypot(p.ctrl.mx, p.ctrl.mz) > 0.2) { stopFishing(); return; }
  if (F.stage === 'wait') {
    F.t -= dt;
    if (F.t <= 0) { F.stage = 'bite'; F.t = 1.3; msg('❗ A BITE! Press SPACE!'); sfx.pop(); F.pressed = false; }
  } else if (F.stage === 'bite') {
    F.t -= dt;
    if (holdUp) {
      F.stage = 'reel'; F.fish = 0.5; F.fishT = 0.5; F.zone = 0.3; F.zv = 0; F.prog = 0.3;
      const r = Math.random() * 100;
      let acc = 0; F.kind = FISH[0];
      for (const f of FISH) { acc += f.w; if (r < acc) { F.kind = f; break; } }
      F.diff = F.kind.v === 'gold' ? 2.2 : F.kind.v === 'bass' ? 1.5 : 1;
      msg('Reel it in! Hold SPACE');
      document.getElementById('fishBar').style.opacity = 1;
    } else if (F.t <= 0) { F.stage = 'wait'; F.t = rand(2, 5); msg('Too slow! Waiting again... 🎣'); }
  } else if (F.stage === 'reel') {
    if (Math.random() < dt * 1.3 * F.diff) F.fishT = rand(0, 1);
    F.fish += clamp(F.fishT - F.fish, -dt * 0.6 * F.diff, dt * 0.6 * F.diff);
    F.zv += (holdUp ? 2.6 : -2.2) * dt;
    F.zv = clamp(F.zv, -1.2, 1.2);
    F.zone += F.zv * dt;
    if (F.zone < 0) { F.zone = 0; F.zv = 0; }
    if (F.zone > 1 - 0.27) { F.zone = 1 - 0.27; F.zv = 0; }
    const inside = F.fish > F.zone - 0.02 && F.fish < F.zone + 0.27;
    F.prog += (inside ? 0.28 : -0.2) * dt;
    const bar = document.getElementById('fishBar');
    const H = bar.clientHeight || 260;
    document.getElementById('fishZone').style.bottom = (F.zone * H) + 'px';
    document.getElementById('fishIcon').style.bottom = (F.fish * (H - 30)) + 'px';
    document.getElementById('fishProgressFill').style.width = clamp(F.prog * 100, 0, 100) + '%';
    if (F.prog >= 1) {
      const k = F.kind;
      G.save.stats.fish++;
      const pr = new Prop('fish', p.root.x, p.root.y + 1.5, p.root.z, { variant: k.v, value: k.price });
      stopFishing(`🎣 You caught: ${k.name}! Sell it at the Fish Market ($${k.price}).`);
      sfx.win();
      pr.held = p; p.held = { kind: 'prop', obj: pr }; p.ctrl.grab = true; G.mouse.grabLock = true;
    } else if (F.prog <= 0) {
      stopFishing('The fish got away! 🐟💨'); sfx.bad();
    }
  }
}

// ---------------------------------------------------------------- per-frame job update
export function initJobs() {
  initMarker();
  // Sell zones
  G.sellZones.push(
    { ...LOC.dumpster, maxY: 4.5, accepts: { bag: 15 }, name: 'Dumpster', onSell: () => { G.save.stats.bags++; } },
    { ...LOC.logZone, accepts: { log: 20 }, name: 'Sawmill', onSell: () => { G.save.stats.logs++; } },
    { ...LOC.fishMarket, accepts: { fish: 15 }, name: 'Fish Market' },
  );
  // Job boards
  for (const [id, j] of Object.entries(JOBS)) {
    if (id === 'fishing') continue;
    G.interacts.push({
      x: j.loc.x, z: j.loc.z, r: 4.5,
      label: () => (G.job && G.job.id === id) ? `Quit ${j.name}` : `Start job: ${j.emo} ${j.name}`,
      action: () => startJob(id),
    });
  }
  G.interacts.push({
    x: LOC.fishing.x, z: LOC.fishing.z, r: 4,
    label: () => G.player.fishing ? 'Stop fishing' : '🎣 Fish here',
    action: () => { if (G.player.fishing) stopFishing(); else { if (!G.job || G.job.id !== 'fishing') { if (G.job) quitJob(true); G.job = { id: 'fishing', markers: [] }; starters.fishing(G.job); } startFishing(); } },
  });
}

export function updateJobs(dt) {
  const J = G.job;
  if (J && J.update) J.update(dt);
  showMarker(J ? J.target : null);
  updateWater(dt);
  // Trucks unload cargo automatically at the dumpster / sawmill
  for (const v of G.vehicles) {
    if (!v.cargo.length) continue;
    for (const z of G.sellZones) {
      if (Math.abs(v.pos.x - z.x) < z.w / 2 + 6 && Math.abs(v.pos.z - z.z) < z.d / 2 + 6) {
        for (const pr of v.cargo) if (pr.type in z.accepts) { pr.cargoOf = null; pr.pos.set(z.x, 1, z.z); }
      }
    }
  }
}
