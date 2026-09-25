// HUD, shops, phone, minimap, chat.
import { G, COLORS, addMoney, writeSave, LAND } from './state.js';
import { HATS, GLASSES, EYES } from './character.js';
import { VTYPES } from './vehicles.js';
import { JOBS, startJob } from './jobs.js';
import { LOC, ROADS, colliders } from './world.js';
import { sfx } from './audio.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- toasts & job panel
export function toast(text, cls = '', dur = 3800) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = text;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), dur);
}

function fmtTime(t) {
  const a = Math.abs(t);
  const m = Math.floor(a / 60), s = Math.floor(a % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
export function setJob(title, obj, timer) {
  $('jobPanel').classList.remove('hidden');
  $('jobTitle').textContent = title;
  $('jobObj').textContent = obj;
  const tEl = $('jobTimer');
  if (timer === null || timer === undefined) tEl.textContent = '';
  else if (timer < 0) { tEl.textContent = '⏱ ' + (-timer).toFixed(1) + 's'; tEl.style.color = '#3fa7ff'; }
  else { tEl.textContent = '⏱ ' + fmtTime(timer); tEl.style.color = timer < 10 ? '#ff3b3b' : '#3fa7ff'; }
}
export function clearJob() { $('jobPanel').classList.add('hidden'); }

let shownMoney = 0;
function onMoney(n, why) {
  if (n > 0) toast(`+$${n}  ${why || ''}`, 'money');
  else if (n < 0) toast(`-$${-n}  ${why || ''}`);
}

// ---------------------------------------------------------------- panels
export function openPanel(title, render) {
  G.ui.panel = title;
  $('panelTitle').textContent = title;
  $('panel').classList.remove('hidden');
  G.ui.render = render;
  render($('panelBody'));
  if (document.pointerLockElement) document.exitPointerLock();
}
export function closePanel() {
  G.ui.panel = null;
  $('panel').classList.add('hidden');
}
function rerender() { if (G.ui.panel && G.ui.render) G.ui.render($('panelBody')); }

function outfitChanged() {
  G.player.setOutfit(G.save.outfit);
  writeSave();
  G.onOutfit && G.onOutfit();
}

function itemGrid(list, ownedKey, slot, freeAll = false) {
  const o = G.save.outfit;
  return `<div class="grid">${list.map(it => {
    const owned = freeAll || !ownedKey || G.save[ownedKey].includes(it.id);
    const eq = o[slot] === it.id;
    return `<div class="item ${owned ? 'owned' : ''} ${eq ? 'equipped' : ''}" data-slot="${slot}" data-id="${it.id}" data-price="${it.price || 0}" data-owned="${owned ? 1 : 0}">
      <span class="emo">${it.emo || '👀'}</span>${it.name}<div class="price">${eq ? 'Wearing' : owned ? 'Owned' : '$' + it.price}</div></div>`;
  }).join('')}</div>`;
}

function clothingPanel(title) {
  let tab = 'hats';
  const render = (el) => {
    const o = G.save.outfit;
    let html = `<div class="tabs">
      <button class="btn small ${tab === 'hats' ? '' : 'gray'}" data-tab="hats">🎩 Hats</button>
      <button class="btn small ${tab === 'glasses' ? '' : 'gray'}" data-tab="glasses">😎 Glasses</button>
      <button class="btn small ${tab === 'face' ? '' : 'gray'}" data-tab="face">👀 Face</button>
      <button class="btn small ${tab === 'colors' ? '' : 'gray'}" data-tab="colors">🎨 Colors</button></div>`;
    if (tab === 'hats') html += itemGrid(HATS, 'ownedHats', 'hat');
    if (tab === 'glasses') html += itemGrid(GLASSES, 'ownedGlasses', 'glasses');
    if (tab === 'face') html += itemGrid(EYES.map(e => ({ ...e, emo: { round: '🙂', big: '😳', happy: '😊', angry: '😠', sleepy: '😴' }[e.id] })), null, 'eyes', true);
    if (tab === 'colors') {
      for (const [k, label] of [['skin', 'Skin'], ['shirt', 'Shirt'], ['pants', 'Pants']]) {
        html += `<h3>${label}</h3><div class="swatches">${COLORS.concat(k === 'skin' ? ['#c68b59', '#8b5a2b', '#ffb36b'] : []).map(c => `<div class="sw ${o[k] === c ? 'sel' : ''}" data-color="${c}" data-key="${k}" style="background:${c}"></div>`).join('')}</div>`;
      }
      html += '<p class="small">Colors are free!</p>';
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelectorAll('.sw').forEach(s => s.onclick = () => { o[s.dataset.key] = s.dataset.color; outfitChanged(); render(el); });
    el.querySelectorAll('.item').forEach(it => it.onclick = () => {
      const slot = it.dataset.slot, id = it.dataset.id, price = +it.dataset.price;
      const ownedKey = slot === 'hat' ? 'ownedHats' : slot === 'glasses' ? 'ownedGlasses' : null;
      if (it.dataset.owned !== '1') {
        if (G.save.money < price) { toast('Not enough money! Do some jobs 💼', 'bad'); sfx.bad(); return; }
        addMoney(-price, 'Bought!');
        G.save[ownedKey].push(id);
        sfx.coin();
      }
      o[slot] = id;
      outfitChanged();
      render(el);
    });
  };
  openPanel(title, render);
}

function dealerPanel() {
  openPanel('🚗 Car Dealer', (el) => {
    el.innerHTML = `<p>Buy a vehicle, then spawn it any time from your <b>Phone (Tab)</b>.</p><div class="grid">${Object.entries(VTYPES).map(([id, t]) => {
      const owned = G.save.ownedCars.includes(id);
      return `<div class="item ${owned ? 'owned' : ''}" data-id="${id}"><span class="emo">${t.emo}</span>${t.name}<div class="price">${owned ? 'Owned ✓ — tap to spawn' : '$' + t.price}</div></div>`;
    }).join('')}</div>`;
    el.querySelectorAll('.item').forEach(it => it.onclick = () => {
      const id = it.dataset.id, t = VTYPES[id];
      if (!G.save.ownedCars.includes(id)) {
        if (G.save.money < t.price) { toast('Not enough money! 💸', 'bad'); sfx.bad(); return; }
        addMoney(-t.price, `Bought a ${t.name}!`);
        G.save.ownedCars.push(id);
        writeSave();
        sfx.win();
        rerender();
      } else { closePanel(); G.spawnMyVehicle(id); }
    });
  });
}

function blasterPanel() {
  openPanel('🔫 Blaster Shop', (el) => {
    el.innerHTML = `<p>Toy blasters make people flop over! Press <b>G</b> to switch blasters, <b>Left Click</b> to shoot.</p><div class="grid">${Object.entries(WEAPONS).map(([id, w]) => {
      const owned = G.save.ownedWeapons.includes(id);
      const eq = G.player.weapon === id;
      return `<div class="item ${owned ? 'owned' : ''} ${eq ? 'equipped' : ''}" data-id="${id}"><span class="emo">${w.emo}</span>${w.name}<div class="small">${w.desc}</div><div class="price">${eq ? 'Equipped' : owned ? 'Owned — tap to equip' : '$' + w.price}</div></div>`;
    }).join('')}</div>`;
    el.querySelectorAll('.item').forEach(it => it.onclick = () => {
      const id = it.dataset.id, w = WEAPONS[id];
      if (!G.save.ownedWeapons.includes(id)) {
        if (G.save.money < w.price) { toast('Not enough money! 💸 Do some jobs first.', 'bad'); sfx.bad(); return; }
        addMoney(-w.price, `Bought ${w.name}!`);
        G.save.ownedWeapons.push(id);
        sfx.win();
      }
      G.equipWeapon(G.player.weapon === id ? null : id);
      rerender();
    });
  });
}

function phonePanel() {
  openPanel('📱 Bobbly Phone', (el) => {
    const s = G.save;
    el.innerHTML = `
      <h3>🚗 My Vehicles</h3>
      <div class="grid">${s.ownedCars.map(id => `<div class="item owned" data-car="${id}"><span class="emo">${VTYPES[id].emo}</span>${VTYPES[id].name}<div class="price">Spawn</div></div>`).join('')}</div>
      ${s.ownedWeapons.length ? `<h3>🔫 My Blasters (G to switch)</h3><div class="grid">${s.ownedWeapons.map(id => `<div class="item owned ${G.player.weapon === id ? 'equipped' : ''}" data-wpn="${id}"><span class="emo">${WEAPONS[id].emo}</span>${WEAPONS[id].name}<div class="price">${G.player.weapon === id ? 'Equipped' : 'Equip'}</div></div>`).join('')}</div>` : ''}
      <h3>💼 Jobs &amp; Activities</h3>
      <div class="grid">${Object.entries(JOBS).map(([id, j]) => `<div class="item" data-job="${id}"><span class="emo">${j.emo}</span>${j.name}<div class="small">${j.desc}</div><div class="price">${G.job && G.job.id === id ? 'Active' : 'Set waypoint'}</div></div>`).join('')}
        <div class="item" data-wp="clothing"><span class="emo">👕</span>Clothing Store<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="dealer"><span class="emo">🚗</span>Car Dealer<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="airport"><span class="emo">✈️</span>Airport<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="blasters"><span class="emo">🔫</span>Blaster Shop<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="mansion"><span class="emo">🏠</span>Dream House<div class="price">${s.house ? 'Your home' : '$2000'}</div></div>
      </div>
      <h3>📊 Stats</h3>
      <p>🎁 Presents found: <b>${s.presents.length} / 20</b> · 🍕 Deliveries: ${s.stats.deliveries} · 🚕 Fares: ${s.stats.fares} · 🔥 Fires: ${s.stats.fires} · 🎣 Fish: ${s.stats.fish} · 🪵 Logs: ${s.stats.logs} · 🗑️ Bags: ${s.stats.bags} · 🏁 Best race: ${s.raceBest ? s.raceBest.toFixed(1) + 's' : '—'}</p>
      <div class="tabs">
        <button class="btn small blue" id="phRespawn">🔄 Respawn (unstuck)</button>
        ${s.house ? '<button class="btn small green" id="phHome">🏠 Go Home</button>' : ''}
        <button class="btn small gray" id="phWp">❌ Clear waypoint</button>
        <button class="btn small gray" id="phHelp">❓ Help</button>
      </div>`;
    el.querySelectorAll('[data-wpn]').forEach(b => b.onclick = () => { G.equipWeapon(G.player.weapon === b.dataset.wpn ? null : b.dataset.wpn); rerender(); });
    el.querySelectorAll('[data-car]').forEach(b => b.onclick = () => { closePanel(); G.spawnMyVehicle(b.dataset.car); });
    el.querySelectorAll('[data-job]').forEach(b => b.onclick = () => { G.waypoint = JOBS[b.dataset.job].loc; toast('📍 Waypoint set: ' + JOBS[b.dataset.job].name); closePanel(); });
    el.querySelectorAll('[data-wp]').forEach(b => b.onclick = () => { G.waypoint = LOC[b.dataset.wp]; toast('📍 Waypoint set!'); closePanel(); });
    $('phRespawn').onclick = () => { closePanel(); G.player.respawn(); };
    if ($('phHome')) $('phHome').onclick = () => { closePanel(); G.player.respawn(true); };
    $('phWp').onclick = () => { G.waypoint = null; closePanel(); };
    $('phHelp').onclick = () => { closePanel(); showHelp(true); };
  });
}

export function showHelp(on) {
  G.ui.help = on;
  $('help').classList.toggle('hidden', !on);
  if (on && document.pointerLockElement) document.exitPointerLock();
}

export function togglePhone() {
  if (G.ui.panel) closePanel(); else phonePanel();
}

// ---------------------------------------------------------------- chat
export function openChat() {
  if (G.ui.chatOpen) return;
  G.ui.chatOpen = true;
  const inp = $('chatInput');
  inp.classList.remove('hidden');
  inp.value = '';
  setTimeout(() => inp.focus(), 10);
  if (document.pointerLockElement) document.exitPointerLock();
}
export function closeChat() {
  G.ui.chatOpen = false;
  $('chatInput').classList.add('hidden');
  $('chatInput').blur();
}
export function chatLine(name, text, color = '#ffd166') {
  const el = document.createElement('div');
  el.className = 'chatline';
  const b = document.createElement('b');
  b.textContent = name + ': ';
  b.style.color = color;
  el.appendChild(b);
  el.appendChild(document.createTextNode(text));
  $('chatLog').appendChild(el);
  while ($('chatLog').children.length > 8) $('chatLog').firstChild.remove();
  setTimeout(() => el.remove(), 15000);
}

// ---------------------------------------------------------------- minimap
let mapBase = null;
function buildMapBase() {
  const S = 520;
  mapBase = document.createElement('canvas');
  mapBase.width = mapBase.height = S;
  const x = mapBase.getContext('2d');
  const W = (v) => (v + S / 2);
  x.fillStyle = '#3f9be0'; x.fillRect(0, 0, S, S);
  x.fillStyle = '#f2dc9a'; x.fillRect(W(-LAND - 6), W(-LAND - 6), (LAND + 6) * 2, (LAND + 6) * 2);
  x.fillStyle = '#7ccf5a'; x.fillRect(W(-LAND + 20), W(-LAND + 20), (LAND - 20) * 2, (LAND - 20) * 2);
  x.fillStyle = '#6b7079';
  for (const r of ROADS) { x.fillRect(W(r - 5), W(-LAND), 10, LAND * 2); x.fillRect(W(-LAND), W(r - 5), LAND * 2, 10); }
  x.fillStyle = '#b88a5a'; x.fillRect(W(183), W(-3), 49, 6);
  x.fillStyle = '#e8e2d4';
  for (const c of colliders) {
    if (c.tag === 'tree' || c.maxX - c.minX < 3 || c.maxZ - c.minZ < 3 || c.maxY < 2) continue;
    x.fillRect(W(c.minX), W(c.minZ), c.maxX - c.minX, c.maxZ - c.minZ);
  }
  x.fillStyle = '#3f8f4a';
  for (const t of G.trees) { x.beginPath(); x.arc(W(t.x), W(t.z), 1.6, 0, 7); x.fill(); }
  x.font = '14px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const icons = [['🍕', LOC.pizza], ['🚕', LOC.taxi], ['👕', LOC.clothing], ['🚗', LOC.dealer], ['🚒', LOC.fire], ['♻️', LOC.recycle],
    ['🪓', LOC.sawmill], ['🎣', LOC.fishing], ['🐟', LOC.fishMarket], ['🏁', LOC.race], ['🏠', LOC.mansion], ['🌳', LOC.park], ['⛲', { x: 0, z: 0 }], ['✈️', LOC.airport], ['🔫', LOC.blasters]];
  for (const [e, l] of icons) x.fillText(e, W(l.x), W(l.z));
}

export function drawMinimap() {
  if (!mapBase) buildMapBase();
  const c = $('minimap'), x = c.getContext('2d');
  const S = c.width, R = S / 2;
  const P = G.player.vehicle ? G.player.vehicle.pos : G.player.pos;
  const zoom = G.player.vehicle ? 0.9 : 1.4;
  x.save();
  x.clearRect(0, 0, S, S);
  x.beginPath(); x.arc(R, R, R, 0, 7); x.clip();
  x.fillStyle = '#3f9be0'; x.fillRect(0, 0, S, S);
  x.translate(R, R);
  x.rotate(G.cam.yaw);          // camera forward is up
  x.scale(zoom, zoom);
  x.drawImage(mapBase, -P.x - mapBase.width / 2, -P.z - mapBase.height / 2);
  const dot = (wx, wz, col, r = 4) => { x.fillStyle = col; x.beginPath(); x.arc(wx - P.x, wz - P.z, r / zoom, 0, 7); x.fill(); };
  if (G.job && G.job.markers) for (const m of G.job.markers) dot(m.x, m.z, '#222', 4);
  for (const v of G.vehicles) if (v.owner === G.net.myId) dot(v.pos.x, v.pos.z, '#ff8a3d', 4);
  for (const [, r] of G.remotes) { const p = r.p[0]; dot(p.x, p.z, '#ff3bd4', 5); }
  x.restore();
  // objective / waypoint (clamped to edge)
  const drawTarget = (t, col) => {
    const dx = t.x - P.x, dz = t.z - P.z;
    const cs = Math.cos(G.cam.yaw), sn = Math.sin(G.cam.yaw);
    let sx = (dx * cs - dz * sn) * zoom, sy = (dx * sn + dz * cs) * zoom;
    const d = Math.hypot(sx, sy);
    if (d > R - 10) { sx *= (R - 10) / d; sy *= (R - 10) / d; }
    x.fillStyle = col; x.strokeStyle = '#fff'; x.lineWidth = 2;
    x.beginPath(); x.arc(R + sx, R + sy, 7, 0, 7); x.fill(); x.stroke();
  };
  if (G.waypoint) drawTarget(G.waypoint, '#3fa7ff');
  if (G.job && G.job.target) drawTarget(G.job.target, '#ffd54a');
  // player arrow
  x.save();
  x.translate(R, R);
  const f = G.player.vehicle ? G.player.vehicle.yaw : G.player.facing;
  x.rotate(Math.PI - f + G.cam.yaw);
  x.fillStyle = '#ff3b3b'; x.strokeStyle = '#fff'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, -9); x.lineTo(7, 7); x.lineTo(0, 3); x.lineTo(-7, 7); x.closePath(); x.fill(); x.stroke();
  x.restore();
}

// ---------------------------------------------------------------- HUD per frame
export function updateHUD() {
  const m = G.save.money;
  if (shownMoney !== m) { shownMoney += Math.sign(m - shownMoney) * Math.max(1, Math.floor(Math.abs(m - shownMoney) / 8)); $('moneyVal').textContent = shownMoney; }
  const t = (G.job && G.job.target) || G.waypoint;
  const P = G.player.vehicle ? G.player.vehicle.pos : G.player.pos;
  if (t) {
    const d = Math.hypot(t.x - P.x, t.z - P.z);
    $('objDist').classList.remove('hidden');
    $('objDist').textContent = (G.job && G.job.target ? '⭐ ' : '📍 ') + Math.round(d) + 'm';
    if (!G.job && G.waypoint && d < 8) { G.waypoint = null; toast('📍 You arrived!'); }
  } else $('objDist').classList.add('hidden');
  const v = G.player.vehicle;
  if (v && G.player.seat === 0) { $('speedo').classList.remove('hidden'); $('speedo').textContent = Math.round(Math.abs(v.speed) * 3.6) + ' km/h' + (v.type.heli ? ` · ${Math.round(v.pos.y)}m up` : ''); }
  else $('speedo').classList.add('hidden');
}

export function setPrompt(text) {
  const p = $('prompt');
  if (!text) { p.classList.add('hidden'); return; }
  p.classList.remove('hidden');
  p.innerHTML = text;
}

// ---------------------------------------------------------------- init
export function initUI() {
  G.toast = toast; G.setJob = setJob; G.clearJob = clearJob; G.onMoney = onMoney;
  shownMoney = G.save.money;
  $('moneyVal').textContent = shownMoney;
  $('panelClose').onclick = closePanel;
  $('helpClose').onclick = () => showHelp(false);
  G.interacts.push(
    { x: LOC.clothing.x, z: LOC.clothing.z, r: 5, label: () => '👕 Shop for clothes', action: () => clothingPanel('👕 Bobbly Boutique') },
    { x: LOC.dealer.x, z: LOC.dealer.z, r: 5, label: () => '🚗 Browse vehicles', action: dealerPanel },
    { x: LOC.blasters.x, z: LOC.blasters.z, r: 4, label: () => '🔫 Shop for blasters', action: blasterPanel },
    { x: LOC.airport.x + 10, z: LOC.airport.z + 9, r: 4, label: () => '✈️ Buy planes (Car Dealer)', action: dealerPanel },
    {
      x: LOC.mansion.x, z: LOC.mansion.z + 4, r: 4.5,
      label: () => G.save.house ? '🏠 Your Dream House (spawn point)' : '🏠 Buy the Dream House ($2000)',
      action: () => {
        if (G.save.house) { toast('Welcome home! You will now spawn here. Use the wardrobe to change clothes for free.'); return; }
        if (G.save.money < 2000) { toast('You need $2000 for the Dream House. Keep working! 💪', 'bad'); sfx.bad(); return; }
        addMoney(-2000, 'Bought the Dream House! 🏠');
        G.save.house = true; writeSave(); sfx.win();
        toast('🏠 It\'s yours! You now spawn here and can use the wardrobe.');
      },
    },
    {
      x: LOC.wardrobe.x, z: LOC.wardrobe.z + 1.5, r: 3,
      label: () => G.save.house ? '👗 Wardrobe' : '👗 Wardrobe (buy the house first)',
      action: () => { if (G.save.house) clothingPanel('👗 Wardrobe'); else toast('Buy the Dream House first!'); },
    },
  );
  const inp = $('chatInput');
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const t = inp.value.trim().slice(0, 100);
      if (t) { chatLine(G.save.name, t); G.onChat && G.onChat(t); }
      closeChat();
    } else if (e.key === 'Escape') closeChat();
  });
}
