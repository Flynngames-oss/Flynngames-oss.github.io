// Multiplayer party games, run by the host:
//  🙈 Hide & Seek: one seeker counts while everyone hides in Bobbly Town, then hunts them down.
//     Found hiders join the seekers. Hiders win if anyone is still hidden when time runs out.
//  🚓 Cops & Robbers: robbers grab cash bags around town in fast cars; cops chase them in police cars.
//     A cop who gets close BUSTS a robber (20 s in jail). Robbers score per bag, cops score per bust.
import * as THREE from 'three';
import { G, rand, pick, addMoney, textSprite } from './state.js';
import { groundHeight, LOC } from './world.js';
import { sfx } from './audio.js';

const MD = { m: null, ph: null, left: 0, roles: {}, sc: { a: 0, b: 0 }, bags: [], ping: 0, jailT: 0 };
G.mode = MD;
const TOWN = 195;
const NAMES = { hide: '🙈 Hide & Seek', cops: '🚓 Cops & Robbers' };
let bar = null, cover = null, send = () => {}, tick = 0, bagMeshes = [];

const me = () => G.net.myId;
const role = (id) => MD.roles[id];
function everyone() {
  const list = [{ id: me(), pos: G.player.ragdoll ? G.player.p[0] : G.player.root, name: G.save.name }];
  for (const [id, r] of G.remotes) list.push({ id, pos: r.p[0], name: r.name });
  return list;
}
function nameOf(id) { if (id === me()) return G.save.name; const r = G.remotes.get(id); return r ? r.name : 'Someone'; }

// ---------------------------------------------------------------- UI
function ui() {
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'modeBar'; document.getElementById('hud').appendChild(bar);
    cover = document.createElement('div'); cover.id = 'modeCover'; document.body.appendChild(cover);
  }
}
function fmt(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
function render() {
  ui();
  if (!MD.m) { bar.style.display = 'none'; cover.style.display = 'none'; return; }
  const r = role(me());
  let txt = '';
  if (MD.m === 'hide') {
    const hiders = Object.values(MD.roles).filter(x => x === 'hider').length;
    txt = `${NAMES.hide} · You are ${r === 'seeker' ? '<b>SEEKING</b> 👀' : r === 'hider' ? '<b>HIDING</b> 🤫' : 'watching'} · ${MD.ph === 'hide' ? 'Hiding time' : 'Seeking'} ${fmt(MD.left)} · ${hiders} hidden`;
  } else {
    txt = `${NAMES.cops} · You are a <b>${r === 'cop' ? 'COP 🚓' : r === 'robber' ? 'ROBBER 💰' : 'spectator'}</b> · ${fmt(MD.left)} · Robbers ${MD.sc.a} · Cops ${MD.sc.b}`;
  }
  if (bar._t !== txt) { bar.innerHTML = txt; bar._t = txt; }
  bar.style.display = 'block';
  bar.className = r === 'cop' ? 'blue' : r === 'robber' ? 'red' : '';
  const blind = MD.m === 'hide' && MD.ph === 'hide' && r === 'seeker';
  const jailed = MD.jailT > 0;
  cover.style.display = blind || jailed ? 'flex' : 'none';
  const ct = blind ? `<div>👀 Close your eyes and count!<br><span>${Math.ceil(MD.left)}</span></div>` : jailed ? `<div>🚔 BUSTED!<br><span>${Math.ceil(MD.jailT)}</span><small>Back on the streets soon...</small></div>` : '';
  if (cover._t !== ct) { cover.innerHTML = ct; cover._t = ct; }
  G.modeFreeze = blind || jailed;
}

// ---------------------------------------------------------------- applying host state on every client
function teleport(x, z, face = 0) {
  const P = G.player;
  if (P.vehicle) P.vehicle.removeOccupant(P);
  P.place(x, groundHeight(x, z, 50) + 0.1, z, face);
}
function applyStart() {
  const r = role(me());
  if (!r) { G.toast(`🎮 ${NAMES[MD.m]} is being played — you'll be in the next round!`); return; }
  if (MD.m === 'hide') {
    if (r === 'seeker') teleport(0, -14, Math.PI); else teleport(rand(-20, 20), rand(-20, 20), rand(0, 6));
    G.toast(r === 'seeker' ? '👀 You are the SEEKER! Count to 40, then find everyone in Bobbly Town.' : '🤫 HIDE! You have 40 seconds. Stay inside Bobbly Town — no vehicles!', '', 8000);
  } else {
    if (r === 'cop') { teleport(-140 + rand(-6, 6), -212, 0); setTimeout(() => G.spawnMyVehicle && G.spawnMyVehicle('police'), 300); }
    else { teleport(rand(-30, 30), rand(-30, 30), rand(0, 6)); setTimeout(() => G.spawnMyVehicle && G.spawnMyVehicle('sports'), 300); }
    G.toast(r === 'cop' ? '🚓 You are a COP! Get close to robbers to bust them. Their location pings on your map.' : '💰 You are a ROBBER! Grab the green cash bags around town and don\'t get caught!', '', 8000);
  }
  sfx.win();
}
function finish(text, winners) {
  const r = role(me());
  const won = winners.includes(r);
  G.toast(text + (won ? ' You win! +$100' : ''), won ? 'money' : '', 9000);
  if (won) addMoney(100, '🏆 Party game win!');
  G.chatLine && G.chatLine('🎮', text, '#ffd166');
  MD.m = null; MD.roles = {}; MD.jailT = 0;
  clearBags(); tagColors(); render();
}
export function onModeMsg(m) {
  if (m.ev === 'end') { finish(m.text, m.win || []); return; }
  const was = MD.m;
  MD.m = m.m; MD.ph = m.ph; MD.left = m.left; MD.roles = m.roles || {}; MD.sc = m.sc || { a: 0, b: 0 };
  MD.bags = m.bags || [];
  if (m.ev === 'start' || (!was && MD.m)) applyStart();
  if (m.ev === 'found' && m.id) { G.toast(m.id === me() ? '😱 You were FOUND! Now help seek the others.' : `👀 ${nameOf(m.id)} was found!`, m.id === me() ? 'bad' : ''); sfx.pop(); }
  if (m.ev === 'seek') { G.toast(role(me()) === 'seeker' ? '👀 Ready or not, here I come! Go find them!' : '🤫 The seeker is coming...', '', 4000); sfx.honk(); }
  if (m.ev === 'bust' && m.id) {
    if (m.id === me()) { MD.jailT = 20; teleport(-140, -270, 0); G.toast('🚔 BUSTED! 20 seconds in jail.', 'bad'); sfx.bad(); }
    else G.toast(`🚔 ${nameOf(m.id)} got busted!`);
  }
  if (m.ev === 'bag' && m.id === me()) { G.toast('💰 Cash grabbed! +1 for the robbers', 'money'); sfx.coin(); }
  if (m.ev === 'ping') { MD.ping = 4; if (role(me()) === 'seeker' || role(me()) === 'cop') G.toast('📡 Their location flashed on your map!'); }
  syncBags(); tagColors(); render();
}

// ---------------------------------------------------------------- host logic
function broadcast(ev, extra = {}) {
  const m = { t: 'mode', m: MD.m, ph: MD.ph, left: +MD.left.toFixed(1), roles: MD.roles, sc: MD.sc, bags: MD.bags, ev, ...extra };
  send(m); onModeMsg(m);
}
function newBag() {
  const sw = G.locations.sidewalks.filter(p => Math.abs(p.x) < 170 && Math.abs(p.z) < 170);
  const p = pick(sw); return [Math.round(p.x + rand(-2, 2)), Math.round(p.z + rand(-2, 2))];
}
export function startMode(m) {
  if (G.net.mode === 'client') { send({ t: 'modeReq', m }); G.toast('📨 Asked the host to start ' + NAMES[m]); return; }
  const all = everyone().map(p => p.id);
  if (all.length < 2) { G.toast('🎮 Party games need at least 2 players — host a room and invite a friend!', 'bad', 6000); return; }
  MD.m = m; MD.roles = {}; MD.sc = { a: 0, b: 0 }; MD.bags = []; MD.ping = 0;
  const shuffled = all.slice().sort(() => Math.random() - 0.5);
  if (m === 'hide') { shuffled.forEach((id, i) => { MD.roles[id] = i === 0 ? 'seeker' : 'hider'; }); MD.ph = 'hide'; MD.left = 40; }
  else {
    const nCops = Math.max(1, Math.round(all.length / 3));
    shuffled.forEach((id, i) => { MD.roles[id] = i < nCops ? 'cop' : 'robber'; });
    MD.ph = 'play'; MD.left = 240; MD.bags = [newBag(), newBag(), newBag()];
  }
  MD.pingT = 30;
  broadcast('start');
}
export function stopMode() {
  if (G.net.mode === 'client') { send({ t: 'modeReq', m: 'stop' }); return; }
  if (!MD.m) return;
  const m = { t: 'mode', ev: 'end', text: '🛑 The party game was stopped.', win: [] };
  send(m); onModeMsg(m);
}
function hostTick(dt) {
  if (!MD.m) return;
  MD.left -= dt;
  const ps = everyone();
  const pos = (id) => { const p = ps.find(q => q.id === id); return p && p.pos; };
  for (const id of Object.keys(MD.roles)) if (!ps.some(p => p.id === id)) delete MD.roles[id];   // someone left
  if (MD.m === 'hide') {
    if (MD.ph === 'hide' && MD.left <= 0) { MD.ph = 'seek'; MD.left = 180; broadcast('seek'); return; }
    if (MD.ph === 'seek') {
      for (const [hid, r] of Object.entries(MD.roles)) {
        if (r !== 'hider') continue;
        const hp = pos(hid); if (!hp) continue;
        for (const [sid, s] of Object.entries(MD.roles)) {
          if (s !== 'seeker') continue;
          const sp = pos(sid); if (!sp) continue;
          if (Math.hypot(hp.x - sp.x, hp.z - sp.z) < 2.4 && Math.abs(hp.y - sp.y) < 2.5) { MD.roles[hid] = 'seeker'; broadcast('found', { id: hid }); break; }
        }
      }
      const left = Object.values(MD.roles).filter(r => r === 'hider').length;
      if (left === 0) { const m = { t: 'mode', ev: 'end', text: '👀 Everyone was found — the SEEKERS win!', win: ['seeker'] }; send(m); onModeMsg(m); return; }
      if (MD.left <= 0) { const m = { t: 'mode', ev: 'end', text: `🤫 Time's up! ${left} hider${left > 1 ? 's' : ''} stayed hidden — the HIDERS win!`, win: ['hider'] }; send(m); onModeMsg(m); return; }
      MD.pingT -= dt; if (MD.pingT <= 0) { MD.pingT = 30; broadcast('ping'); return; }
    }
  } else {
    for (const [rid, r] of Object.entries(MD.roles)) {
      if (r !== 'robber') continue;
      const rp = pos(rid); if (!rp) continue;
      if (MD.jailed && MD.jailed[rid] > G.time) continue;
      for (const [cid, c] of Object.entries(MD.roles)) {
        if (c !== 'cop') continue;
        const cp = pos(cid); if (!cp) continue;
        if (Math.hypot(rp.x - cp.x, rp.z - cp.z) < 3.6 && Math.abs(rp.y - cp.y) < 3) { (MD.jailed ||= {})[rid] = G.time + 22; MD.sc.b += 2; broadcast('bust', { id: rid }); break; }
      }
      MD.bags.forEach((b, i) => {
        if (Math.hypot(rp.x - b[0], rp.z - b[1]) < 3.2 && Math.abs(rp.y - groundHeight(b[0], b[1], 50)) < 4) { MD.bags[i] = newBag(); MD.sc.a += 1; broadcast('bag', { id: rid }); }
      });
    }
    MD.pingT -= dt; if (MD.pingT <= 0) { MD.pingT = 20; broadcast('ping'); return; }
    if (MD.left <= 0) {
      const a = MD.sc.a, b = MD.sc.b;
      const text = a > b ? `💰 Time's up! Robbers ${a} – Cops ${b}. The ROBBERS win!` : a < b ? `🚓 Time's up! Cops ${b} – Robbers ${a}. The COPS win!` : `🤝 Time's up! It's a draw, ${a} – ${b}.`;
      const m = { t: 'mode', ev: 'end', text, win: a > b ? ['robber'] : a < b ? ['cop'] : [] }; send(m); onModeMsg(m); return;
    }
  }
  tick -= dt;
  if (tick <= 0) { tick = 1; broadcast(null); }
}

// ---------------------------------------------------------------- cash bags, name tags, map
const bagMat = new THREE.MeshStandardMaterial({ color: '#3fd65a', emissive: '#1f9a3a', emissiveIntensity: 0.8 });
function clearBags() { for (const b of bagMeshes) G.scene.remove(b); bagMeshes = []; }
function syncBags() {
  if (MD.m !== 'cops') { clearBags(); return; }
  while (bagMeshes.length < MD.bags.length) {
    const g = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), bagMat); bag.scale.set(1, 1.1, 0.9); bag.position.y = 1; g.add(bag);
    const s = textSprite('💰 $', { size: 48, color: '#fff', bg: 'rgba(30,140,60,0.9)', scale: 1.2 }); s.position.y = 2.4; g.add(s);
    G.scene.add(g); bagMeshes.push(g);
  }
  MD.bags.forEach((b, i) => bagMeshes[i].position.set(b[0], groundHeight(b[0], b[1], 50), b[1]));
}
function tagColors() {
  const mine = role(me());
  for (const [id, r] of G.remotes) {
    if (!r.tag) continue;
    const rr = role(id);
    r.tag.visible = !(MD.m === 'hide' && mine === 'seeker' && rr === 'hider');
    r.tag.material.color.set(rr === 'cop' ? '#7fb2ff' : rr === 'robber' ? '#ff8f8f' : rr === 'seeker' ? '#ffd23a' : '#ffffff');
  }
}
G.mapHide = (id) => {
  if (!MD.m) return false;
  const mine = role(me()), rr = role(id);
  if (MD.ping > 0) return false;
  if (MD.m === 'hide' && mine === 'seeker' && rr === 'hider') return true;
  if (MD.m === 'cops' && mine === 'cop' && rr === 'robber') return true;
  return false;
};
G.mapColor = (id) => { const rr = role(id); return rr === 'cop' ? '#3f6fff' : rr === 'robber' ? '#ff3b3b' : rr === 'seeker' ? '#ffd23a' : '#ff3bd4'; };
(G.mapDots ||= []).push((dot) => { if (MD.m === 'cops') for (const b of MD.bags) dot(b[0], b[1], '#3fd65a', 6); });

// ---------------------------------------------------------------- per frame on every client
export function initModes(netSend) { send = netSend; ui(); render(); }
export function updateModes(dt) {
  if (G.net.mode !== 'client') hostTick(dt);
  else if (MD.m) MD.left -= dt;
  if (MD.ping > 0) MD.ping -= dt;
  if (MD.jailT > 0) { MD.jailT -= dt; if (MD.jailT <= 0) { teleport(LOC.jailGate ? LOC.jailGate.x : -140, LOC.jailGate ? LOC.jailGate.z : -225, 0); G.toast('🚶 You\'re out! Get back to robbing.'); } }
  for (const b of bagMeshes) b.rotation.y += dt * 2;
  if (MD.m) {
    const P = G.player, r = role(me());
    // house rules: hide & seek stays in town and on foot
    if (MD.m === 'hide') {
      if (P.vehicle) { P.vehicle.removeOccupant(P); G.toast('🚶 No vehicles in Hide & Seek!'); }
      if (Math.abs(P.root.x) > TOWN || Math.abs(P.root.z) > TOWN) { teleport(0, -14, 0); G.toast('⛔ Stay inside Bobbly Town!'); }
    }
    if (MD.m === 'cops' && r && MD.jailT <= 0 && Math.hypot(P.root.x, P.root.z) > 700) { teleport(0, -14, 0); G.toast('⛔ Too far! The chase stays near Bobbly Town.'); }
  }
  render();
}
export const MODE_NAMES = NAMES;
