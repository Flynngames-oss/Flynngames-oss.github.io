// 👑 Admin panel — only for the game's owner.
// It unlocks with a secret password. Admin commands are signed with a private key that only the password can
// unlock, and every player's game checks the signature with the public key below, so nobody else can fake them.
import * as THREE from 'three';
import { G, addMoney, writeSave } from './state.js';
import * as NET from './net.js';
import { setWeather, forceTornado } from './weather.js';
import { HATS, GLASSES, SKINS } from './character.js';
import { VTYPES } from './vehicles.js';
import { WEAPONS } from './weapons.js';
import { LOC } from './world.js';

const PUB = {"kty": "EC", "crv": "P-256", "x": "uLuCSYs7P2Si6FsK_ZOlUE9VZqTku3DphYhhPdumCh4", "y": "9PsbqWWrjn1TrvDkXaRTjjrxPD5a4FgM8TVYjvqvnpE"};
const VAULT = {"salt": "ycHcMqHRku3EicOrJExzsw==", "iv": "vTiHcB3hchiruxXq", "data": "Rr8wVWmEcY59cERjDN+bfgNKlcbsB5DwGI7ihzUtMAKVGyCYBIU3oGsxrvGtgqiJSMDy85/VSB5AaY70Urqs5OcQruYmNgu2Qr6GZhaiYTAsZkek/KbJ9MzDLIKvxA+Z78xk0hvhNBGbEyAExqD2qQAeqs8XaM6OAnkXbMqDUZQpcr371+nBev6XcXfdBUjOTjRmc/NEGbm4WA==", "iter": 400000};
// crypto.subtle is missing outside secure contexts (plain http), so the game must still run without it
const S = (globalThis.crypto && crypto.subtle) || null, te = new TextEncoder();
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const REMEMBER = 'bobblylife-admin-key';
let priv = null;
const pubKey = S && S.importKey('jwk', { ...PUB, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
export const isAdmin = () => !!priv;

// ---------------------------------------------------------------- unlocking
async function importPriv(pk8) { return S.importKey('pkcs8', pk8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); }
export async function unlock(pw, remember) {
  if (!S) return false;
  try {
    const base = await S.importKey('raw', te.encode(pw.trim()), 'PBKDF2', false, ['deriveKey']);
    const aes = await S.deriveKey({ name: 'PBKDF2', salt: unb64(VAULT.salt), iterations: VAULT.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pk8 = await S.decrypt({ name: 'AES-GCM', iv: unb64(VAULT.iv) }, aes, unb64(VAULT.data));
    priv = await importPriv(pk8);
    if (remember) try { localStorage.setItem(REMEMBER, b64(pk8)); } catch (e) { /* ignore */ }
    announceMe();
    return true;
  } catch (e) { return false; }
}
export async function restore() {
  if (!S) return false;
  try { const s = localStorage.getItem(REMEMBER); if (s) { priv = await importPriv(unb64(s)); return true; } } catch (e) { /* ignore */ }
  return false;
}
export function lock() { priv = null; try { localStorage.removeItem(REMEMBER); } catch (e) { /* ignore */ } G.adminFly = G.adminSpeed = G.adminJump = 0; }

// ---------------------------------------------------------------- signed commands
const seen = new Set();
const canon = (c) => JSON.stringify([c.cmd, c.args, c.ts, c.n]);
async function signed(cmd, args = {}) {
  const c = { cmd, args, ts: Date.now(), n: Math.random().toString(36).slice(2, 12) };
  const sig = b64(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, te.encode(canon(c))));
  return { c, sig };
}
async function verify(m) {
  try {
    if (!pubKey || !m || !m.c || typeof m.sig !== 'string' || seen.has(m.c.n)) return false;
    const ok = await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, await pubKey, unb64(m.sig), te.encode(canon(m.c)));
    if (ok) seen.add(m.c.n);
    return ok;
  } catch (e) { return false; }
}
export async function cmd(name, args = {}) {
  if (!priv) return;
  const m = await signed(name, args);
  seen.add(m.c.n);
  apply(m.c, true);
  NET.send({ t: 'adm', ...m });
}
NET.on('adm', async (m) => {
  if (!(await verify(m))) return;
  const age = Date.now() - m.c.ts;
  if (m.c.cmd !== 'banlist' && Math.abs(age) > 10 * 60 * 1000) return;     // stale / replayed
  apply(m.c, false, m);
});

// ---------------------------------------------------------------- bans (kept as a signed list on every device; the host enforces it)
function banList() { const b = G.save.banSigned; return b && b.c && b.c.args && Array.isArray(b.c.args.list) ? b.c.args.list : []; }
export const isBanned = (did) => !!did && banList().some(b => b.did === did);
async function setBans(list) { if (!priv) return; const m = await signed('banlist', { list }); seen.add(m.c.n); G.save.banSigned = m; writeSave(); enforceBans(); NET.send({ t: 'adm', ...m }); }
function enforceBans() {
  if (G.net.mode !== 'host') return;
  for (const [id, r] of G.remotes) if (isBanned(r.did)) NET.kick(id, 'banned');
}
export async function ban(id) { const r = G.remotes.get(id); if (!r || !r.did) return; const list = banList().filter(b => b.did !== r.did); list.push({ did: r.did, name: r.name }); await setBans(list); cmd('kick', { to: id, why: 'banned' }); }
export async function unban(did) { await setBans(banList().filter(b => b.did !== did)); }

// ---------------------------------------------------------------- what each command does (on every player's game)
const me = () => G.net.myId;
const forMe = (a) => a.to === 'all' || a.to === me();
function apply(c, local, m) {
  const a = c.args || {}, P = G.player;
  switch (c.cmd) {
    case 'weather': if (a.s === 'tornado') { if (G.net.mode !== 'client') forceTornado(); } else setWeather(a.s, G.net.mode === 'client'); break;
    case 'time': G.dayTime = a.d; break;
    case 'boss': if (G.net.mode !== 'client') { if (a.k === 'end') G.endBattle && G.endBattle(); else if (G.startBattle && !(G.battle && G.battle.kind)) G.startBattle(a.k === 'ufo' ? 'ufo' : 'robot'); } break;
    case 'money': if (forMe(a) && !(local && a.to === 'all')) { const n = a.op === 'set' ? a.n - G.save.money : a.n; addMoney(n, a.op === 'set' ? '👑 The admin set your money' : n >= 0 ? '👑 Gift from the admin!' : '👑 The admin took some money'); } break;
    case 'tp': if (forMe(a) && !local) { if (P.vehicle) P.vehicle.removeOccupant(P); P.place(a.x, a.y, a.z, P.facing); G.toast && G.toast('👑 The admin teleported you!'); } break;
    case 'flop': if (forMe(a) && !local) P.flop(new THREE.Vector3((Math.random() - 0.5) * 8, a.big ? 40 : 6, (Math.random() - 0.5) * 8), a.big ? 4 : 2); break;
    case 'freeze': if (forMe(a) && !local) { G.adminFreeze = !!a.on; G.toast && G.toast(a.on ? '🧊 The admin froze you!' : '🔥 You can move again!'); } break;
    case 'unlock': if (forMe(a) && !(local && a.to === 'all')) unlockAll(true); break;
    case 'announce': showBanner(String(a.text || '').slice(0, 140)); break;
    case 'iam': { const r = G.remotes.get(a.id); if (r) { r.isAdminPlayer = true; if (!/\[ADMIN\]$/.test(r.name)) r.setName('👑 ' + r.name + ' [ADMIN]'); } break; }
    case 'kick':
      if (a.to === me() && !local) { kickedScreen(a.why); return; }
      if (G.net.mode === 'host') NET.kick(a.to, a.why || 'kicked');
      break;
    case 'banlist': if (m && (!G.save.banSigned || G.save.banSigned.c.ts < c.ts)) { G.save.banSigned = m; writeSave(); } enforceBans(); break;
  }
}
// tell everyone who the admin is (shows a crown on your name)
async function announceMe() { if (priv && G.net.mode !== 'solo') { cmd('iam', { id: me() }); if (G.save.banSigned) NET.send({ t: 'adm', ...G.save.banSigned }); } }
G.onNetJoin = () => setTimeout(announceMe, 1500);

function unlockAll(gift) {
  const s = G.save;
  for (const [k, list] of [['ownedHats', HATS.map(h => h.id)], ['ownedGlasses', GLASSES.map(g => g.id)], ['ownedSkins', SKINS.map(x => x.id)], ['ownedCars', Object.keys(VTYPES).filter(id => !VTYPES[id].noShop && !VTYPES[id].rail && !VTYPES[id].ride)], ['ownedWeapons', Object.keys(WEAPONS)]]) {
    for (const id of list) if (!s[k].includes(id)) s[k].push(id);
  }
  writeSave();
  G.toast && G.toast(gift ? '🎁 The admin unlocked EVERYTHING for you!' : '🔓 Everything unlocked!', 'money', 5000);
}
function showBanner(text) {
  let el = document.getElementById('adminBanner');
  if (!el) { el = document.createElement('div'); el.id = 'adminBanner'; document.body.appendChild(el); }
  el.innerHTML = `<div class="ab-crown">👑 ADMIN</div><div class="ab-text"></div>`;
  el.querySelector('.ab-text').textContent = text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(showBanner.t); showBanner.t = setTimeout(() => el.classList.remove('show'), 7000);
}
function kickedScreen(why) {
  const el = document.createElement('div'); el.id = 'kickedScreen';
  el.innerHTML = `<div><h1>${why === 'banned' ? '🚫 You have been banned' : '👢 You were kicked'}</h1><p>${why === 'banned' ? 'The admin banned you from multiplayer games.' : 'The admin removed you from this game.'}</p><p class="small">You can still play on your own.</p><button class="btn green" id="kickedOk">OK</button></div>`;
  document.body.appendChild(el);
  el.querySelector('#kickedOk').onclick = () => location.href = location.pathname;
}
NET.on('kicked', (m) => kickedScreen(m.why));

// ---------------------------------------------------------------- your own super powers (only on your game)
const _d = { x: 0, z: 0 };
export function updateAdmin(dt) {
  const P = G.player;
  if (!priv || !G.adminFly || !P || P.vehicle || P.ragdoll) return;
  const K = G.keys, sp = (K.ShiftLeft || K.ShiftRight ? 70 : 24) * dt;
  _d.x = P.ctrl.mx; _d.z = P.ctrl.mz;
  P.root.x += _d.x * sp; P.root.z += _d.z * sp;
  P.root.y += ((K.Space ? 1 : 0) - (K.KeyC || K.ControlLeft ? 1 : 0)) * sp * 0.8;
  P.vel.set(0, 0, 0);
}
export const speedMult = () => (priv && G.adminSpeed ? 2.6 : 1);
export const jumpMult = () => (priv && G.adminJump ? 2.4 : 1);

// ---------------------------------------------------------------- the panel
const WX = [['clear', '☀️ Sunny'], ['cloudy', '☁️ Cloudy'], ['rain', '🌧️ Rain'], ['storm', '⛈️ Storm'], ['tornado', '🌪️ Tornado']];
const TIMES = [[0.27, '🌅 Sunrise'], [0.42, '☀️ Morning'], [0.5, '🌞 Noon'], [0.71, '🌇 Sunset'], [0.9, '🌙 Night']];
export function openAdmin(UI) {
  if (!priv) return openUnlock(UI);
  UI.openPanel('👑 Admin Panel', (el) => {
    const s = G.save, players = [...G.remotes.entries()];
    const playerRows = players.map(([id, r]) => `
      <div class="adm-player"><b>${esc(r.name)}</b>
        <div class="tabs">
          <button class="btn small green" data-a="give" data-id="${id}">💰 +$1000</button>
          <button class="btn small blue" data-a="setm" data-id="${id}">💵 Set $</button>
          <button class="btn small gray" data-a="take" data-id="${id}">💸 −$1000</button>
          <button class="btn small blue" data-a="bring" data-id="${id}">🧲 Bring here</button>
          <button class="btn small blue" data-a="goto" data-id="${id}">🚀 Go to</button>
          <button class="btn small gray" data-a="flop" data-id="${id}">🤸 Flop</button>
          <button class="btn small gray" data-a="launch" data-id="${id}">🎆 Launch</button>
          <button class="btn small gray" data-a="freeze" data-id="${id}">🧊 Freeze</button>
          <button class="btn small gray" data-a="unfreeze" data-id="${id}">🔥 Unfreeze</button>
          <button class="btn small green" data-a="gift" data-id="${id}">🎁 Unlock all</button>
          <button class="btn small red" data-a="kick" data-id="${id}">👢 Kick</button>
          <button class="btn small red" data-a="ban" data-id="${id}">🚫 Ban</button>
        </div></div>`).join('');
    const bans = banList();
    el.innerHTML = `
      <div class="adm-hero">👑 Welcome, boss! <span class="small">You're the only one with these powers.</span></div>
      <h3>💰 My money: $${s.money}</h3>
      <div class="tabs">
        <button class="btn small green" data-me="1000">+$1,000</button><button class="btn small green" data-me="10000">+$10,000</button><button class="btn small green" data-me="1000000">+$1,000,000</button>
        <input id="admMoney" type="number" placeholder="exact amount" style="width:130px"><button class="btn small blue" id="admSetMoney">Set</button>
      </div>
      <h3>🦸 My super powers</h3>
      <div class="tabs">
        <button class="btn small ${G.adminFly ? 'green' : 'gray'}" id="admFly">🕊️ Fly ${G.adminFly ? 'ON' : 'off'}</button>
        <button class="btn small ${G.adminSpeed ? 'green' : 'gray'}" id="admSpeed">⚡ Super speed ${G.adminSpeed ? 'ON' : 'off'}</button>
        <button class="btn small ${G.adminJump ? 'green' : 'gray'}" id="admJump">🦘 Super jump ${G.adminJump ? 'ON' : 'off'}</button>
        <button class="btn small green" id="admUnlock">🔓 Unlock everything</button>
      </div>
      <p class="small">Fly: move with WASD, Space = up, C = down, Shift = fast.</p>
      <h3>🚗 Spawn anything (free)</h3>
      <div class="tabs">${Object.entries(VTYPES).filter(([, t]) => !t.rail && !t.ride && !t.bumper).map(([id, t]) => `<button class="btn small blue" data-veh="${id}">${t.emo} ${t.name}</button>`).join('')}</div>
      <h3>🌦️ Weather (for everyone)</h3>
      <div class="tabs">${WX.map(([k, n]) => `<button class="btn small ${G.weather && G.weather.state === k ? 'green' : 'gray'}" data-wx="${k}">${n}</button>`).join('')}</div>
      <h3>💥 Boss battles (for everyone)</h3>
      <div class="tabs"><button class="btn small red" data-bs="robot">🤖 Giant Robot attack</button><button class="btn small green" data-bs="ufo">👽 UFO Invasion</button><button class="btn small gray" data-bs="end">🏳️ End battle</button></div>
      <h3>🕐 Time of day (for everyone)</h3>
      <div class="tabs">${TIMES.map(([d, n]) => `<button class="btn small gray" data-time="${d}">${n}</button>`).join('')}</div>
      <h3>📢 Announcement (big message on everyone's screen)</h3>
      <div class="tabs"><input id="admMsg" maxlength="140" placeholder="Type a message..." style="flex:1;min-width:200px"><button class="btn small green" id="admSend">📢 Send</button></div>
      <h3>👥 Players ${G.net.mode === 'solo' ? '' : `in room ${G.net.code}`}</h3>
      ${G.net.mode === 'solo' ? '<p class="small">Host or join a multiplayer room to control other players.</p>' : players.length ? `
        <div class="tabs"><button class="btn small green" data-all="give">💰 Everyone +$1000</button><button class="btn small green" data-all="gift">🎁 Unlock all for everyone</button><button class="btn small blue" data-all="bring">🧲 Bring everyone here</button><button class="btn small gray" data-all="launch">🎆 Launch everyone</button><button class="btn small gray" data-all="freeze">🧊 Freeze all</button><button class="btn small gray" data-all="unfreeze">🔥 Unfreeze all</button></div>
        ${playerRows}` : '<p class="small">Nobody else is here yet.</p>'}
      <h3>🚫 Banned players</h3>
      ${bans.length ? bans.map(b => `<div class="tabs"><span>${esc(b.name || 'Player')}</span><button class="btn small blue" data-unban="${b.did}">Unban</button></div>`).join('') : '<p class="small">Nobody is banned.</p>'}
      <div class="tabs" style="margin-top:18px"><button class="btn small gray" id="admLock">🔒 Lock admin on this device</button></div>`;
    const re = () => UI.rerender ? UI.rerender() : openAdmin(UI);
    const me2 = G.player;
    el.querySelectorAll('[data-me]').forEach(b => b.onclick = () => { addMoney(+b.dataset.me, '👑 Admin money'); re(); });
    el.querySelector('#admSetMoney').onclick = () => { const v = Math.max(0, Math.round(+el.querySelector('#admMoney').value || 0)); G.save.money = v; writeSave(); G.onMoney && G.onMoney(0); UI.toast('💰 Money set to $' + v); re(); };
    el.querySelector('#admFly').onclick = () => { G.adminFly = !G.adminFly; re(); };
    el.querySelector('#admSpeed').onclick = () => { G.adminSpeed = !G.adminSpeed; re(); };
    el.querySelector('#admJump').onclick = () => { G.adminJump = !G.adminJump; re(); };
    el.querySelector('#admUnlock').onclick = () => { unlockAll(false); re(); };
    el.querySelectorAll('[data-veh]').forEach(b => b.onclick = () => { UI.closePanel(); const id = b.dataset.veh; if (!G.save.ownedCars.includes(id) && !VTYPES[id].noShop) G.save.ownedCars.push(id); G.spawnMyVehicle(id); });
    el.querySelectorAll('[data-wx]').forEach(b => b.onclick = () => { cmd('weather', { s: b.dataset.wx }); UI.toast('🌦️ Weather changed!'); setTimeout(re, 100); });
    el.querySelectorAll('[data-bs]').forEach(b => b.onclick = () => { cmd('boss', { k: b.dataset.bs }); UI.closePanel(); });
    el.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { cmd('time', { d: +b.dataset.time }); UI.toast('🕐 Time changed!'); });
    el.querySelector('#admSend').onclick = () => { const t = el.querySelector('#admMsg').value.trim(); if (t) { cmd('announce', { text: t }); el.querySelector('#admMsg').value = ''; } };
    const pos = () => ({ x: me2.root.x + (Math.random() - 0.5) * 4, y: me2.root.y + 0.5, z: me2.root.z + (Math.random() - 0.5) * 4 });
    const act = (a, to) => {
      if (a === 'give') cmd('money', { to, op: 'add', n: 1000 });
      if (a === 'take') cmd('money', { to, op: 'add', n: -1000 });
      if (a === 'setm') { const v = prompt('Set their money to:', '5000'); if (v !== null && !isNaN(+v)) cmd('money', { to, op: 'set', n: Math.max(0, Math.round(+v)) }); }
      if (a === 'bring') cmd('tp', { to, ...pos() });
      if (a === 'goto') { const r = G.remotes.get(to); if (r) { UI.closePanel(); me2.place(r.root.x + 2, r.root.y + 0.5, r.root.z, 0); } }
      if (a === 'flop') cmd('flop', { to });
      if (a === 'launch') cmd('flop', { to, big: true });
      if (a === 'freeze') cmd('freeze', { to, on: true });
      if (a === 'unfreeze') cmd('freeze', { to, on: false });
      if (a === 'gift') cmd('unlock', { to });
      if (a === 'kick') cmd('kick', { to, why: 'kicked' });
      if (a === 'ban' && confirm('Ban ' + (G.remotes.get(to) || {}).name + ' from multiplayer?')) ban(to);
    };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { act(b.dataset.a, b.dataset.id); UI.toast('👑 Done!'); setTimeout(re, 300); });
    el.querySelectorAll('[data-all]').forEach(b => b.onclick = () => { act(b.dataset.all, 'all'); UI.toast('👑 Done for everyone!'); });
    el.querySelectorAll('[data-unban]').forEach(b => b.onclick = async () => { await unban(b.dataset.unban); re(); });
    el.querySelector('#admLock').onclick = () => { lock(); UI.closePanel(); UI.toast('🔒 Admin locked. Type /admin in chat to unlock again.'); };
  });
}
function openUnlock(UI) {
  UI.openPanel('🔒 Admin login', (el) => {
    el.innerHTML = `<p>Enter the admin password.</p>
      <div class="tabs"><input id="admPw" type="password" autocomplete="off" style="flex:1;min-width:200px" placeholder="password"></div>
      <label class="small"><input type="checkbox" id="admRem" checked> Remember on this device</label>
      <div class="tabs"><button class="btn green" id="admGo">🔓 Unlock</button></div><p class="small" id="admErr"></p>`;
    const go = async () => {
      el.querySelector('#admErr').textContent = 'Checking...';
      if (await unlock(el.querySelector('#admPw').value, el.querySelector('#admRem').checked)) { UI.toast('👑 Admin unlocked! Press ` (or type /admin) any time.', 'money', 5000); openAdmin(UI); }
      else el.querySelector('#admErr').textContent = '❌ Wrong password.';
    };
    el.querySelector('#admGo').onclick = go;
    el.querySelector('#admPw').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    setTimeout(() => el.querySelector('#admPw').focus(), 50);
  });
}
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
void LOC;
