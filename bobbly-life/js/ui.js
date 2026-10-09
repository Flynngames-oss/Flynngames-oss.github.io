// HUD, shops, phone, minimap, chat.
import * as THREE from 'three';
import { G, COLORS, addMoney, writeSave, LAND, noEmoji } from './state.js';
import { HATS, GLASSES, EYES, SKINS, HAIRS, HAIR_COLORS, SKIN_TONES, TOPS, BOTTOMS } from './character.js';
import { VTYPES } from './vehicles.js';
import { JOBS, startJob } from './jobs.js';
import { LOC, ROADS, colliders, groundHeight } from './world.js';
import { PRESENT_SPOTS } from './props.js';
import { WORLD, heightAt, biome, HIGHWAYS, groundColor, ZONES } from './terrain.js';
import { sfx, setMusic, musicPlaying } from './audio.js';
import { renderBobTok, fmt } from './bobtok.js';
import { WEAPONS } from './weapons.js';
import { setWeather, forceTornado } from './weather.js';
import * as ADMIN from './admin.js';
import { GADGETS, buyOrEquip } from './gadgets.js';
import { startMode, stopMode } from './modes.js';
import { ARCADE, startArcade, stopArcade, surprise } from './arcade.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- toasts & job panel
export function toast(text, cls = '', dur = 3800) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = noEmoji(text);
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
  $('jobTitle').textContent = noEmoji(title);
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
  const P = $('panel'); P.classList.remove('phone'); for (const c of [...P.classList]) if (c.startsWith('app-')) P.classList.remove(c);
  G.ui.phoneApp = null;
  $('panelTitle').textContent = title;
  $('panel').classList.remove('hidden');
  G.ui.render = render;
  render($('panelBody'));
  if (document.pointerLockElement) document.exitPointerLock();
}
export function closePanel() {
  G.ui.panel = null; G.ui.phoneApp = null;
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
  let tab = 'skins';
  const render = (el) => {
    const o = G.save.outfit;
    let html = `<div class="tabs">
      <button class="btn small ${tab === 'skins' ? '' : 'gray'}" data-tab="skins">🦸 Skins</button>
      <button class="btn small ${tab === 'tops' ? '' : 'gray'}" data-tab="tops">👕 Tops</button>
      <button class="btn small ${tab === 'bottoms' ? '' : 'gray'}" data-tab="bottoms">👖 Bottoms</button>
      <button class="btn small ${tab === 'hats' ? '' : 'gray'}" data-tab="hats">🎩 Hats</button>
      <button class="btn small ${tab === 'glasses' ? '' : 'gray'}" data-tab="glasses">😎 Glasses</button>
      <button class="btn small ${tab === 'face' ? '' : 'gray'}" data-tab="face">👀 Face</button>
      <button class="btn small ${tab === 'hair' ? '' : 'gray'}" data-tab="hair">💇 Hair</button>
      <button class="btn small ${tab === 'colors' ? '' : 'gray'}" data-tab="colors">🎨 Colors</button></div>`;
    if (tab === 'skins') {
      html += `<p class="small">A skin changes your whole look! You can still change hats and colors after.</p><div class="grid">${SKINS.map(sk => {
        const owned = G.save.ownedSkins.includes(sk.id);
        return `<div class="item ${owned ? 'owned' : ''}" data-skin="${sk.id}"><span class="emo">${sk.emo}</span>${sk.name}<div class="price">${owned ? 'Owned — wear it' : sk.quest ? '🔒 Secret character' : '$' + sk.price}</div>${!owned && sk.quest ? `<div class="small">${sk.quest}</div>` : ''}</div>`;
      }).join('')}</div>`;
    }
    if (tab === 'tops') {
      html += `<p class="small">Free! The colour comes from the Colors tab (Shirt).</p><div class="grid">${TOPS.map(t => `<div class="item ${(o.top || 'tshirt') === t.id ? 'equipped' : ''}" data-top="${t.id}"><span class="emo">${t.emo}</span>${t.name}</div>`).join('')}</div>`;
    }
    if (tab === 'bottoms') {
      html += `<div class="grid">${BOTTOMS.map(t => `<div class="item ${(o.bottom || 'jeans') === t.id ? 'equipped' : ''}" data-bottom="${t.id}"><span class="emo">${t.emo}</span>${t.name}</div>`).join('')}</div>`;
      html += `<h3>👟 Feet & sneakers</h3><div class="swatches"><div class="sw ${!o.shoes || o.shoes === 'bare' ? 'sel' : ''}" data-shoe="bare" title="Bare bean feet" style="background:${o.skin || '#ffd23f'};border-radius:50%"></div>${['#f2f2ee', '#3a3f4a', '#202226', '#b8322a', '#2f5fa8', '#8a6a4a', '#46a85a', '#ff8a2a', '#b46cff'].map(c => `<div class="sw ${o.shoes === c ? 'sel' : ''}" data-shoe="${c}" style="background:${c}"></div>`).join('')}</div><p class="small">The colour of trousers comes from the Colors tab (Pants).</p>`;
    }
    if (tab === 'hats') html += itemGrid(HATS, 'ownedHats', 'hat');
    if (tab === 'glasses') html += itemGrid(GLASSES, 'ownedGlasses', 'glasses');
    if (tab === 'hair') {
      html += `<h3>Style</h3><div class="grid">${HAIRS.map(h => `<div class="item ${o.hair === h.id ? 'equipped' : ''}" data-hair="${h.id}">${h.name}</div>`).join('')}</div>`;
      html += `<h3>Colour</h3><div class="swatches">${HAIR_COLORS.map(c => `<div class="sw ${o.hairColor === c ? 'sel' : ''}" data-hc="${c}" style="background:${c}"></div>`).join('')}</div><p class="small">Haircuts are free.</p>`;
    }
    if (tab === 'face') html += itemGrid(EYES.map(e => ({ ...e, emo: { round: '🙂', big: '😳', happy: '😊', angry: '😠', sleepy: '😴' }[e.id] })), null, 'eyes', true);
    if (tab === 'colors') {
      for (const [k, label] of [['skin', 'Skin'], ['shirt', 'Shirt'], ['pants', 'Pants']]) {
        html += `<h3>${label}</h3><div class="swatches">${(k === 'skin' ? SKIN_TONES.concat(['#ffcf4a', '#9be05a', '#8fa3b8']) : COLORS).map(c => `<div class="sw ${o[k] === c ? 'sel' : ''}" data-color="${c}" data-key="${k}" style="background:${c}"></div>`).join('')}</div>`;
      }
      html += '<p class="small">Colors are free!</p>';
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-skin]').forEach(it => it.onclick = () => {
      const sk = SKINS.find(x => x.id === it.dataset.skin);
      if (!G.save.ownedSkins.includes(sk.id) && sk.quest) { toast(`🔒 ${sk.quest}`, 'bad', 6000); return; }
      if (!G.save.ownedSkins.includes(sk.id)) {
        if (G.save.money < sk.price) { toast('Not enough money! Do some jobs 💼', 'bad'); sfx.bad(); return; }
        addMoney(-sk.price, `Bought the ${sk.name} skin!`);
        G.save.ownedSkins.push(sk.id);
        sfx.win();
      }
      if (!G.save.ownedHats.includes(sk.o.hat)) G.save.ownedHats.push(sk.o.hat);
      if (!G.save.ownedGlasses.includes(sk.o.glasses)) G.save.ownedGlasses.push(sk.o.glasses);
      Object.assign(o, sk.o, { extras: [...sk.o.extras] });
      outfitChanged();
      toast(`${sk.emo} You're now a ${sk.name}!`);
      render(el);
    });
    el.querySelectorAll('[data-hair]').forEach(b => b.onclick = () => { o.hair = b.dataset.hair; outfitChanged(); render(el); });
    el.querySelectorAll('[data-top]').forEach(b => b.onclick = () => { o.top = b.dataset.top; outfitChanged(); render(el); });
    el.querySelectorAll('[data-bottom]').forEach(b => b.onclick = () => { o.bottom = b.dataset.bottom; outfitChanged(); render(el); });
    el.querySelectorAll('[data-shoe]').forEach(b => b.onclick = () => { o.shoes = b.dataset.shoe; outfitChanged(); render(el); });
    el.querySelectorAll('[data-hc]').forEach(b => b.onclick = () => { o.hairColor = b.dataset.hc; outfitChanged(); render(el); });
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelectorAll('.sw[data-key]').forEach(s => s.onclick = () => { o[s.dataset.key] = s.dataset.color; outfitChanged(); render(el); });
    el.querySelectorAll('.item[data-slot]').forEach(it => it.onclick = () => {
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
    el.innerHTML = `<p>Buy a vehicle, then spawn it any time from your <b>Phone (Tab)</b>.</p><div class="grid">${Object.entries(VTYPES).filter(([, t]) => !t.noShop).map(([id, t]) => {
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

// [emoji, name, x, z, facing]
const TRAVEL = [
  ['🏖️', 'Slippy Bay — Dive Shop', 'diveShop'], ['🎣', 'Slippy Bay Pier & Beach', -94, -716, Math.PI / 2], ['🌳', 'Bobbly Park (pond & big slide)', 'townPark'], ['🎢', 'Bobbly Land Theme Park', 'themePark'],
  ['🚡', 'Cable Car to Bouncy Peaks', 'cableBase'], ['⛰️', 'Bouncy Peaks (summit!)', 'peak'], ['🕳️', 'Mystery Cave', 'mysteryCave'], ['🏎️', 'Crazy Go-Kart Track', 'kart'], ['🌬️', 'Windmill', 'windmill'], ['🗼', 'Lighthouse', 'lighthouse'],
  ['🚉', 'Bobbly Central Station', 'stn_Bobbly Central'], ['🚉', 'Lakeside Station', 'stn_Lakeside'], ['🚉', 'West Beach Station', 'stn_West Beach'],
  ['🏙️', 'Twin Towers', 'twin'], ['🛗', 'Twin Towers — rooftop deck', 'twinTop'], ['🛫', 'Bobbly International Airport', 'intl'], ['🛩️', 'SW Regional Airport', 'swAir'],
  ['✈️', 'Town Airfield', -130, 158, Math.PI / 2], ['⛲', 'Town Square', 0, -14, Math.PI], ['🔫', 'Blaster Shop', -70, -48, -Math.PI / 2],
  ['🚗', 'Car Dealer', 0, -56, Math.PI], ['👕', 'Clothing Store', 0, 54, 0], ['🍕', 'Pizza Place', 52, 0, Math.PI / 2],
  ['🚕', 'Taxi Depot', -52, 0, -Math.PI / 2], ['🚒', 'Fire Station', 52, 50, 0], ['🛹', 'Stunt Park', -52, -52, Math.PI],
  ['🤸', 'Trampoline Park', -60, 50, 0], ['🪓', 'Sawmill', -106, -14, 0],
  ['🎬', 'Bobblywood Sign', 'sign'], ['🏕️', 'Forest Lake Cabin', 'cabin'], ['🌴', 'Valley Suburbs', 'valley'], ['🏞️', 'Mountain Lake', 'eastLake'], ['🏙️', 'Mega City', 'city'], ['🏡', 'Sunny Suburbs', 'suburb'], ['🚀', 'Space Center', 'space'], ['🌾', 'Hill Farm', 'farm'], ['🔥', 'Stunt Valley — MEGA RAMP', 'stunt2'], ['💥', 'Human Cannonball', 'cannon'], ['🏘️', 'Sunset Hills Village', 'village'], ['🏰', 'Old Castle', 'castle'], ['⛺', 'Campsite', 'camp'],
];
// the illustrated island map (north at the top)
const MAP_LABELS = [
  ['🏘️', 'Bobbly Town', 0, 0], ['🏙️', 'Mega City', -600, -100], ['🕳️', 'Mystery Cave', -330, 760], ['🏎️', 'Crazy Go-Kart Track', -925, 680],
  ['🏔️', 'Bouncy Peaks', 620, 900], ['🎢', 'Bobbly Land', 826, -64], ['🌈', 'Funky Forest', 1060, 160], ['🌳', 'Bobbly Park', 370, 0],
  ['🏖️', 'Slippy Bay', 160, -800], ['🏴‍☠️', 'Treasure Island', 880, -1228], ['🌴', 'Palm Islet', -150, -1050], ['🌬️', 'Windmill', -120, 300],
  ['🏡', 'Sunny Suburbs', 350, 310], ['✈️', 'Airport', 660, -520], ['🚀', 'Space Center', 830, -275], ['🏰', 'Old Castle', -880, 960], ['🎬', 'Bobblywood', -430, 640], ['🚡', 'Cable Car', 796, 335], ['🔥', 'Stunt Valley', -550, -812],
];
let mapArt = null;
const mc = new THREE.Color();
function drawIslandArt() {
  const S = 720, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S), k = (WORLD * 2) / S;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const wx = -WORLD + (i + 0.5) * k, wz = WORLD - (j + 0.5) * k, h = heightAt(wx, wz), b = biome(wx, wz);
    let r, g, bl;
    if (h < -0.6) { const d = Math.min(1, (-0.6 - h) / 14); r = 120 - d * 70; g = 200 - d * 70; bl = 235 - d * 30; }
    else { groundColor(wx, wz, h, mc).convertLinearToSRGB(); r = mc.r * 255 + b.funky * 60; g = mc.g * 255; bl = mc.b * 255 + b.funky * 70; }
    const n = ((i * 7 + j * 13) % 9) - 4;
    const q = (j * S + i) * 4; img.data[q] = r + n; img.data[q + 1] = g + n; img.data[q + 2] = bl + n; img.data[q + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const P = (wx, wz) => [(wx + WORLD) / k, (WORLD - wz) / k];
  // built-up areas
  for (const [key, col] of [['city', 'rgba(170,176,188,0.9)'], ['suburb', 'rgba(232,214,190,0.75)'], ['valley', 'rgba(232,214,190,0.75)'], ['intl', 'rgba(170,176,188,0.85)'], ['swAir', 'rgba(170,176,188,0.85)'], ['space', 'rgba(190,190,186,0.8)'], ['park', 'rgba(255,170,200,0.6)']]) {
    const Z = ZONES[key]; if (!Z) continue; const [x0, y0] = P(Z.x0, Z.z1), [x1, y1] = P(Z.x1, Z.z0); x.fillStyle = col; x.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  // roads
  x.strokeStyle = 'rgba(90,96,108,0.85)'; x.lineWidth = 3;
  for (const hw of HIGHWAYS) { const [a1, b1] = P(hw.x0, hw.z0), [a2, b2] = P(hw.x1, hw.z1); x.beginPath(); x.moveTo(a1, b1); x.lineTo(a2, b2); x.stroke(); }
  const [tx0, tz0] = P(-185, 185); x.fillStyle = 'rgba(200,190,170,0.9)'; x.fillRect(tx0, tz0, 370 / k, 370 / k);
  return c;
}
function islandMapPanel() {
  openPanel('🗺️ Bobbly Island Map', (el) => {
    el.innerHTML = '<canvas id="islandMap" width="720" height="720" style="width:100%;max-width:720px;border-radius:14px;border:6px solid #c8a46a;background:#e8d6a8"></canvas><p class="small">Tap a place on the list in Fast Travel to go there. Treasure Island has no fast travel — take a boat!</p>';
    if (!mapArt) mapArt = drawIslandArt();
    const cv = el.querySelector('#islandMap'), x = cv.getContext('2d'), S = cv.width, k = (WORLD * 2) / S;
    const P = (wx, wz) => [(wx + WORLD) / k, (WORLD - wz) / k];
    const draw = () => {
      x.drawImage(mapArt, 0, 0);
      x.font = '800 30px Fredoka, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#ff7a3a'; x.strokeStyle = '#fff'; x.lineWidth = 6;
      x.strokeText('BOBBLY ISLAND', S / 2, 40); x.fillText('BOBBLY ISLAND', S / 2, 40);
      for (const [e, name, wx, wz] of MAP_LABELS) {
        const [px, py] = P(wx, wz);
        x.font = '24px sans-serif'; x.fillText(e, px, py + 8);
        x.font = '700 13px Fredoka, sans-serif'; x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.9)'; x.fillStyle = '#3a2a1a';
        x.strokeText(name, px, py + 26); x.fillText(name, px, py + 26);
        x.fillStyle = '#ff7a3a';
      }
      // X marks the spot
      const [ix, iy] = P(880, -1228); x.strokeStyle = '#d8322a'; x.lineWidth = 4; x.beginPath(); x.moveTo(ix - 7, iy - 18); x.lineTo(ix + 7, iy - 4); x.moveTo(ix + 7, iy - 18); x.lineTo(ix - 7, iy - 4); x.stroke();
      // compass
      x.save(); x.translate(60, S - 70); x.fillStyle = '#fff'; x.strokeStyle = '#3a2a1a'; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 30, 0, 7); x.fill(); x.stroke();
      x.fillStyle = '#d8322a'; x.beginPath(); x.moveTo(0, -26); x.lineTo(7, 0); x.lineTo(-7, 0); x.fill(); x.fillStyle = '#3a2a1a'; x.beginPath(); x.moveTo(0, 26); x.lineTo(7, 0); x.lineTo(-7, 0); x.fill();
      x.font = '700 13px sans-serif'; x.fillText('N', 0, -32); x.restore();
      // you are here
      const pl = G.player.vehicle ? G.player.vehicle.pos : G.player.pos, [mx, my] = P(pl.x, pl.z);
      x.fillStyle = '#ff3b3b'; x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(mx, my, 8, 0, 7); x.fill(); x.stroke();
      x.font = '700 12px sans-serif'; x.fillStyle = '#ff3b3b'; x.lineWidth = 3; x.strokeText('YOU', mx, my - 12); x.fillText('YOU', mx, my - 12);
    };
    draw();
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

function diveShopPanel() {
  openPanel('🤿 Coral Bay Dive Shop', (el) => {
    const S2 = G.save, o = S2.outfit;
    const mask = S2.ownedGlasses.includes('scuba'), suit = S2.ownedSkins.includes('diver'), sub = S2.ownedCars.includes('sub');
    const T = (S2.treasure || []).length, N = G.ocean ? G.ocean.chests.length : 7;
    el.innerHTML = `<p>Coral Bay is a deep reef lagoon full of fish, turtles, dolphins, sharks, jellyfish and a giant whale. There's a sunken pirate ship and an underwater cave, and <b>${N} treasure chests</b> are hidden down there (${T} found).</p>
      <div class="grid">
        <div class="item ${mask ? 'owned' : ''} ${o.glasses === 'scuba' ? 'equipped' : ''}" data-dive="mask"><span class="emo">🤿</span>Scuba Mask<div class="small">Breathe for 4 minutes instead of 25 seconds</div><div class="price">${o.glasses === 'scuba' ? 'Wearing' : mask ? 'Owned — wear it' : '$150'}</div></div>
        <div class="item ${suit ? 'owned' : ''}" data-dive="suit"><span class="emo">🧜</span>Full Scuba Diver<div class="small">Mask, air tank, wetsuit and flippers (swim much faster)</div><div class="price">${suit ? 'Owned — wear it' : '$300'}</div></div>
        <div class="item ${sub ? 'owned' : ''}" data-dive="sub"><span class="emo">🟡</span>Submarine<div class="small">Glass bubble, sonar, headlights. Never runs out of air!</div><div class="price">${sub ? 'Owned — launch it' : '$' + VTYPES.sub.price}</div></div>
      </div>
      <h3>How to dive</h3>
      <p>Swim out past the pier where it gets deep. <b>C</b> dive down · <b>Space</b> swim up · <b>Shift</b> swim fast · <b>E</b> open a treasure chest. Keep an eye on your air bar!</p>
      <p class="small">Submarine: W/S thrust · A/D turn · Space rise · Shift dive · V cockpit view with sonar (treasure shows as gold dots).</p>`;
    el.querySelectorAll('[data-dive]').forEach(b => b.onclick = () => {
      const k = b.dataset.dive;
      if (k === 'mask') {
        if (!mask) { if (S2.money < 150) { toast('Not enough money! Do some jobs 💼', 'bad'); sfx.bad(); return; } addMoney(-150, 'Bought a Scuba Mask!'); S2.ownedGlasses.push('scuba'); sfx.coin(); }
        o.glasses = 'scuba'; outfitChanged();
      } else if (k === 'suit') {
        const sk = SKINS.find(x => x.id === 'diver');
        if (!suit) { if (S2.money < sk.price) { toast('Not enough money! Do some jobs 💼', 'bad'); sfx.bad(); return; } addMoney(-sk.price, 'Bought the Scuba Diver suit!'); S2.ownedSkins.push('diver'); if (!S2.ownedGlasses.includes('scuba')) S2.ownedGlasses.push('scuba'); sfx.win(); }
        Object.assign(o, sk.o, { extras: [...sk.o.extras] }); outfitChanged();
        toast('🤿 Suited up! Flippers make you swim fast.');
      } else if (k === 'sub') {
        if (!sub) { if (S2.money < VTYPES.sub.price) { toast(`The submarine costs $${VTYPES.sub.price}. Keep working! 💪`, 'bad'); sfx.bad(); return; } addMoney(-VTYPES.sub.price, 'Bought a Submarine!'); S2.ownedCars.push('sub'); writeSave(); sfx.win(); }
        closePanel(); G.spawnMyVehicle('sub'); return;
      }
      rerender();
    });
  });
}
export const openDiveShop = diveShopPanel;

// ---------------------------------------------------------------- the Bobbly Phone: a home screen of apps
// [id, name, icon, icon colours]
const APPS = [
  ['bobtok', 'BobTok', '🎵', '#ff2f6d,#ffb020'], ['garage', 'Garage', '🚗', '#2f6fd8,#38c8ff'], ['map', 'Map', '🗺️', '#2e9e5b,#a8e063'], ['travel', 'Travel', '🚀', '#6a3fc8,#7f9cff'],
  ['jobs', 'Jobs', '💼', '#e8861a,#ffd200'], ['missions', 'Missions', '💥', '#d8262f,#ff8a65'], ['gadgets', 'Gadgets', '🎒', '#0f8f84,#38ef7d'], ['arcade', 'Arcade', '🕹️', '#8e2de2,#f05aff'],
  ['weather', 'Weather', '🌦️', '#1f86b0,#6dd5ed'], ['stats', 'Stats', '📊', '#3f4b5a,#8fa3b8'], ['settings', 'Settings', '⚙️', '#33363c,#8a8f98'], ['admin', 'Admin', '👑', '#ffd23f,#ff8a2a'],
];
const APP_HTML = {
  garage: () => { const s = G.save; return `
      <h3>🚗 My Vehicles</h3>
      <div class="grid">${s.ownedCars.map(id => `<div class="item owned" data-car="${id}"><span class="emo">${VTYPES[id].emo}</span>${VTYPES[id].name}<div class="price">Spawn</div></div>`).join('')}</div>
      ${s.ownedWeapons.length ? `<h3>🔫 My Blasters (G to switch)</h3><div class="grid">${s.ownedWeapons.map(id => `<div class="item owned ${G.player.weapon === id ? 'equipped' : ''}" data-wpn="${id}"><span class="emo">${WEAPONS[id].emo}</span>${WEAPONS[id].name}<div class="price">${G.player.weapon === id ? 'Equipped' : 'Equip'}</div></div>`).join('')}</div>` : ''}`; },
  gadgets: () => { const s = G.save; return `
      <h3>🎒 Gadgets</h3>
      <div class="grid">${Object.entries(GADGETS).map(([id, g]) => `<div class="item ${(s.gadgets || []).includes(id) ? 'owned' : ''} ${s.gadget === id ? 'equipped' : ''}" data-gad="${id}"><span class="emo">${g.emo}</span>${g.name}<div class="small">${g.desc}</div><div class="price">${s.gadget === id ? 'Equipped' : (s.gadgets || []).includes(id) ? 'Equip' : '$' + g.price}</div></div>`).join('')}</div>`; },
  missions: () => { const s = G.save; return `
      <h3>💥 Boss Battles &amp; Stunts</h3>
      <div class="grid">
        <div class="item" data-boss="robot"><span class="emo">🤖</span>Robot Attack!<div class="small">A 46 m robot wades out of the sea and smashes Mega City. Shoot its glowing chest core! Win $5000 + a secret costume.</div><div class="price">${G.battle && G.battle.kind ? 'Battle on!' : 'Start'}</div></div>
        <div class="item" data-boss="ufo"><span class="emo">👽</span>UFO Invasion!<div class="small">Flying saucers beam people up. Shoot them all down! Win $3000 + a secret costume.</div><div class="price">${G.battle && G.battle.kind ? 'Battle on!' : 'Start'}</div></div>
        <div class="item" data-wp="stunt2"><span class="emo">🔥</span>MEGA Jump<div class="small">Drive up the lift, floor it down the 46 m ramp and clear the 64 m gap. +$500</div><div class="price">Set waypoint</div></div>
        <div class="item" data-wp="cannon"><span class="emo">🎯</span>Human Cannonball<div class="small">Get fired out of the cannon and land on the bullseye. Up to +$500</div><div class="price">Set waypoint</div></div>
        ${G.battle && G.battle.kind && G.net.mode !== 'client' ? '<div class="item" data-boss="end"><span class="emo">🏳️</span>End the battle<div class="price">Stop</div></div>' : ''}
      </div>`; },
  travel: () => { const s = G.save; return `
      <h3>🚀 Fast Travel</h3>
      <div class="grid">${TRAVEL.map((t, i) => `<div class="item" data-go="${i}"><span class="emo">${t[0]}</span>${t[1]}<div class="price">Go!</div></div>`).join('')}</div>`; },
  jobs: () => { const s = G.save; return `
      <h3>💼 Jobs &amp; Activities</h3>
      <div class="grid">${Object.entries(JOBS).map(([id, j]) => `<div class="item" data-job="${id}"><span class="emo">${j.emo}</span>${j.name}<div class="small">${j.desc}</div><div class="price">${G.job && G.job.id === id ? 'Active' : 'Set waypoint'}</div></div>`).join('')}
        <div class="item" data-wp="clothing"><span class="emo">👕</span>Clothing Store<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="dealer"><span class="emo">🚗</span>Car Dealer<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="airport"><span class="emo">✈️</span>Airport<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="blasters"><span class="emo">🔫</span>Blaster Shop<div class="price">Set waypoint</div></div>
        <div class="item" data-wp="mansion"><span class="emo">🏠</span>Dream House<div class="price">${s.house ? 'Your home' : '$2000'}</div></div>
      </div>`; },
  arcade: () => { const s = G.save; return `
      <h3>🕹️ Arcade (solo or with friends)</h3>
      <div class="grid"><div class="item surprise" data-arc="surprise"><span class="emo">🎲</span>Surprise Me!<div class="small">A random mode or chaos event: meteors, moon gravity, beach ball storm...</div><div class="price">Go!</div></div>
        ${Object.entries(ARCADE).map(([id, a]) => `<div class="item" data-arc="${id}"><span class="emo">${a.emo}</span>${a.name}<div class="small">${a.desc}</div><div class="price">${G.arcade.mode === id ? 'Playing (J to quit)' : 'Play'}</div></div>`).join('')}</div>
      ${G.arcade.mode ? '<div class="tabs"><button class="btn small gray" data-arc="stop">🛑 Stop arcade game</button></div>' : ''}
      <h3>🎮 Party Games (multiplayer)</h3>
      ${G.net.mode === 'solo' ? '<p class="small">Host a room and invite friends to play Hide &amp; Seek or Cops &amp; Robbers!</p>' : `<div class="tabs">
        <button class="btn small ${G.mode.m === 'hide' ? 'green' : 'blue'}" data-mode="hide">🙈 Hide &amp; Seek</button>
        <button class="btn small ${G.mode.m === 'cops' ? 'green' : 'blue'}" data-mode="cops">🚓 Cops &amp; Robbers</button>
        ${G.mode.m ? '<button class="btn small gray" data-mode="stop">🛑 Stop game</button>' : ''}</div>
        <p class="small">Hide &amp; Seek: one seeker counts to 40, everyone hides in Bobbly Town. Cops &amp; Robbers: robbers grab cash bags, cops bust them.</p>`}`; },
  weather: () => { const s = G.save; return `
      <h3>🌦️ Weather Machine</h3>
      ${G.net.mode === 'client' ? '<p class="small">Only the host can change the weather.</p>' : `<div class="tabs">
        <button class="btn small ${G.weather.state === 'clear' ? 'green' : 'gray'}" data-wx="clear">☀️ Sunny</button>
        <button class="btn small ${G.weather.state === 'cloudy' ? 'green' : 'gray'}" data-wx="cloudy">☁️ Cloudy</button>
        <button class="btn small ${G.weather.state === 'rain' ? 'green' : 'gray'}" data-wx="rain">🌧️ Rain</button>
        <button class="btn small ${G.weather.state === 'storm' ? 'green' : 'gray'}" data-wx="storm">⛈️ Storm</button>
        <button class="btn small ${G.weather.tornado ? 'green' : 'gray'}" data-wx="tornado">🌪️ Tornado!</button></div>`}`; },
  stats: () => { const s = G.save; return `
      <h3>📊 Stats</h3>
      <p>🎁 Presents found: <b>${s.presents.length} / ${PRESENT_SPOTS.length}</b> · 🍕 Deliveries: ${s.stats.deliveries} · 🚕 Fares: ${s.stats.fares} · 🔥 Fires: ${s.stats.fires} · 🎣 Fish: ${s.stats.fish} · 🪵 Logs: ${s.stats.logs} · 🗑️ Bags: ${s.stats.bags} · 🏁 Best race: ${s.raceBest ? s.raceBest.toFixed(1) + 's' : '—'} · 💰 Sunken treasure: ${(s.treasure || []).length} / ${G.ocean ? G.ocean.chests.length : 7}</p>
      <h3>🎵 BobTok</h3>
      <p>${fmt(Math.floor((s.bt || {}).followers || 0))} followers · ${fmt(Math.floor((s.bt || {}).likes || 0))} likes · ${fmt(Math.floor((s.bt || {}).views || 0))} views · ${(s.bt || {}).posts || 0} videos</p>`; },
  settings: () => { const s = G.save; return `
      <h3>⚙️ Settings</h3>
      <div class="tabs">
        <button class="btn small ${musicPlaying() ? 'green' : 'gray'}" id="phMusic">${musicPlaying() ? '🎵 Music: on' : '🔇 Music: off'}</button>
        <button class="btn small blue" id="phGfx">🖥️ Graphics: ${({ low: 'Low', high: 'High', ultra: 'Ultra' })[s.gfx] || 'High'}</button>
      </div>
      <h3>🛟 Help</h3>
      <div class="tabs">
        <button class="btn small blue" id="phRespawn">🔄 Respawn (unstuck)</button>
        <button class="btn small blue" id="phRebuild">🏗️ Rebuild the city</button>
        ${s.house ? '<button class="btn small green" id="phHome">🏠 Go Home</button>' : ''}
        <button class="btn small gray" id="phWp">❌ Clear waypoint</button>
        <button class="btn small gray" id="phHelp">❓ Help</button>
      </div>`; },
};
let phoneApp = null;
function phonePanel(app = null, opts = {}) {
  phoneApp = app;
  let once = opts;
  openPanel('📱 Bobbly Phone', (el) => { renderPhone(el, once); once = {}; });
}
G.openPhoneApp = (app, opts) => phonePanel(app, opts || {});
function openApp(id) {
  if (id === 'map') { closePanel(); islandMapPanel(); return; }
  if (id === 'admin') { G.openAdmin(); return; }
  phoneApp = id; sfx.pop && sfx.pop();
  rerender();
}
function statusBar() {
  const h = Math.floor(((G.dayTime || 0) * 24 + 24) % 24), m = Math.floor(((G.dayTime || 0) * 24 * 60) % 60);
  return `<div class="ph-status"><b>${h}:${String(m).padStart(2, '0')}</b><span class="ph-island"></span><span class="ph-icons">▂▄▆ 🔋<button class="ph-x" id="phX" aria-label="Close">✕</button></span></div>`;
}
function renderPhone(el, opts = {}) {
  const P = $('panel');
  P.classList.add('phone');
  for (const c of [...P.classList]) if (c.startsWith('app-')) P.classList.remove(c);
  if (phoneApp) P.classList.add('app-' + phoneApp);
  G.ui.phoneApp = phoneApp;
  if (phoneApp === 'bobtok') { renderBobTok(el, { back: () => openApp(null), close: closePanel }, opts); return; }
  if (!phoneApp) {
    const apps = APPS.filter(a => a[0] !== 'admin' || ADMIN.isAdmin());
    el.innerHTML = statusBar() + `<div class="ph-home"><div class="ph-greet"><b>Hi ${noEmoji(G.save.name || 'Bobbler')}!</b><span>$${G.save.money}</span></div>
      <div class="ph-apps">${apps.map(([id, name, emo, c]) => `<button class="ph-app" data-app="${id}"><span class="ph-icon" style="background:linear-gradient(135deg,${c})">${emo}</span><span class="ph-name">${name}</span></button>`).join('')}</div></div><div class="ph-homebar"></div>`;
    el.querySelectorAll('[data-app]').forEach(b => b.onclick = () => openApp(b.dataset.app));
  } else {
    const a = APPS.find(x => x[0] === phoneApp) || ['', '', '', ''];
    el.innerHTML = statusBar() + `<div class="ph-appbar"><button id="phBack" aria-label="Back">‹</button><span>${a[2]} ${a[1]}</span></div><div class="ph-content">${APP_HTML[phoneApp] ? APP_HTML[phoneApp]() : ''}</div><div class="ph-homebar"></div>`;
    el.querySelector('#phBack').onclick = () => openApp(null);
    bindPhone(el);
  }
  el.querySelector('#phX').onclick = closePanel;
}
function bindPhone(el) {
  const q = (id) => el.querySelector('#' + id);
    el.querySelectorAll('[data-boss]').forEach(b => b.onclick = () => {
      const k = b.dataset.boss;
      if (k === 'end') { G.endBattle(); closePanel(); return; }
      if (G.battle && G.battle.kind) { toast('A battle is already happening!'); return; }
      closePanel(); G.startBattle(k);
    });
    el.querySelectorAll('[data-gad]').forEach(b => b.onclick = () => { buyOrEquip(b.dataset.gad); rerender(); });
    el.querySelectorAll('[data-wpn]').forEach(b => b.onclick = () => { G.equipWeapon(G.player.weapon === b.dataset.wpn ? null : b.dataset.wpn); rerender(); });
    el.querySelectorAll('[data-car]').forEach(b => b.onclick = () => { closePanel(); G.spawnMyVehicle(b.dataset.car); });
    el.querySelectorAll('[data-job]').forEach(b => b.onclick = () => { G.waypoint = JOBS[b.dataset.job].loc; toast('📍 Waypoint set: ' + JOBS[b.dataset.job].name); closePanel(); });
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      const t = TRAVEL[+b.dataset.go];
      closePanel();
      const p = G.player;
      if (p.vehicle) p.vehicle.removeOccupant(p);
      if (p.held && G.dropHeld) G.dropHeld(false);
      const tx = typeof t[2] === 'string' ? LOC[t[2]].x + (t[2] === 'peak' ? 4 : 0) : t[2], tz = typeof t[2] === 'string' ? LOC[t[2]].z : t[3];
      const face = typeof t[2] === 'string' ? (t[4] || 0) : (t[4] || 0);
      p.place(tx, groundHeight(tx, tz, 999) + 0.1, tz, face);
      G.cam.yaw = face + Math.PI;
      sfx.pop();
      toast(`${t[0]} Welcome to ${t[1]}!`);
    });
    el.querySelectorAll('[data-wp]').forEach(b => b.onclick = () => { G.waypoint = LOC[b.dataset.wp]; toast('📍 Waypoint set!'); closePanel(); });
    el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { closePanel(); if (b.dataset.mode === 'stop') stopMode(); else startMode(b.dataset.mode); });
    el.querySelectorAll('[data-wx]').forEach(b => b.onclick = () => {
      const w = b.dataset.wx;
      if (w === 'tornado') { forceTornado(); closePanel(); return; }
      setWeather(w); toast(`Weather: ${b.textContent}`); rerender();
    });
    el.querySelectorAll('[data-arc]').forEach(b => b.onclick = () => { closePanel(); const id = b.dataset.arc; if (id === 'stop') stopArcade(); else if (id === 'surprise') surprise(); else startArcade(id); });
    if (q('phRespawn')) q('phRespawn').onclick = () => { closePanel(); G.player.respawn(); };
    if (q('phRebuild')) q('phRebuild').onclick = () => { closePanel(); const n = G.rebuildCity(); toast(n ? `🏗️ The builders fixed ${n} building${n === 1 ? '' : 's'}!` : '🏗️ Nothing is broken right now.'); };
    if (q('phHome')) q('phHome').onclick = () => { closePanel(); G.player.respawn(true); };
    if (q('phWp')) q('phWp').onclick = () => { G.waypoint = null; closePanel(); };
    if (q('phHelp')) q('phHelp').onclick = () => { closePanel(); showHelp(true); };
    if (q('phMusic')) q('phMusic').onclick = () => { G.save.music = !musicPlaying(); setMusic(G.save.music); writeSave(); rerender(); };
    if (q('phGfx')) q('phGfx').onclick = () => { G.save.gfx = { low: 'high', high: 'ultra', ultra: 'low' }[G.save.gfx] || 'high'; writeSave(); G.applyGraphics && G.applyGraphics(); rerender(); };
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
let worldBase = null;
// Whole-island overview map: 1 pixel = 5 metres.
function buildWorldBase() {
  const S = Math.round(WORLD * 2 / 5);
  worldBase = document.createElement('canvas');
  worldBase.width = worldBase.height = S;
  const x = worldBase.getContext('2d');
  const img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const wx = -WORLD + i * 5, wz = -WORLD + j * 5;
    const h = heightAt(wx, wz), b = biome(wx, wz);
    let r, g, bl;
    if (h < -0.6) { r = 63; g = 155; bl = 224; }
    else if (h > 95) { r = 240; g = 244; bl = 250; }
    else if (h > 60) { r = 150; g = 145; bl = 135; }
    else { r = 106 + (200 - 106) * b.south - 20 * b.west; g = 138 + (180 - 138) * b.south - 25 * b.west; bl = 85 + (120 - 85) * b.south - 15 * b.west; }
    const k = (j * S + i) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = bl; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = '#e8e2d4';
  for (const c of colliders) {
    if (Math.max(Math.abs(c.minX), Math.abs(c.minZ)) < LAND + 30 || c.maxX - c.minX < 5 || c.maxY < 3 || c.tag === 'tree') continue;
    x.fillRect((c.minX + WORLD) / 5, (c.minZ + WORLD) / 5, Math.max(1, (c.maxX - c.minX) / 5), Math.max(1, (c.maxZ - c.minZ) / 5));
  }
  x.strokeStyle = '#6b7079'; x.lineWidth = 2;
  for (const hw of HIGHWAYS) { x.beginPath(); x.moveTo((hw.x0 + WORLD) / 5, (hw.z0 + WORLD) / 5); x.lineTo((hw.x1 + WORLD) / 5, (hw.z1 + WORLD) / 5); x.stroke(); }
  for (const f of G.mapExtras || []) f(x, (v) => (v + WORLD) / 5);
}

function buildMapBase() {
  const S = 520;
  mapBase = document.createElement('canvas');
  mapBase.width = mapBase.height = S;
  const x = mapBase.getContext('2d');
  const W = (v) => (v + S / 2);
  x.fillStyle = '#6a8a55'; x.fillRect(W(-LAND), W(-LAND), LAND * 2, LAND * 2);
  x.fillStyle = '#6b7079';
  for (const r of ROADS) { x.fillRect(W(r - 5), W(-LAND), 10, LAND * 2); x.fillRect(W(-LAND), W(r - 5), LAND * 2, 10); }
  x.fillStyle = '#b88a5a'; x.fillRect(W(183), W(-3), 49, 6);
  x.fillStyle = '#e8e2d4';
  for (const c of colliders) {
    if (Math.abs(c.minX) > LAND + 60 || Math.abs(c.minZ) > LAND + 60) continue;
    if (c.tag === 'tree' || c.maxX - c.minX < 3 || c.maxZ - c.minZ < 3 || c.maxY < 2) continue;
    x.fillRect(W(c.minX), W(c.minZ), c.maxX - c.minX, c.maxZ - c.minZ);
  }
  x.fillStyle = '#3f8f4a';
  for (const t of G.trees) { if (Math.abs(t.x) > LAND + 60 || Math.abs(t.z) > LAND + 60) continue; x.beginPath(); x.arc(W(t.x), W(t.z), 1.6, 0, 7); x.fill(); }
  x.font = '14px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const icons = [['🍕', LOC.pizza], ['🚕', LOC.taxi], ['👕', LOC.clothing], ['🚗', LOC.dealer], ['🚒', LOC.fire], ['♻️', LOC.recycle],
    ['🪓', LOC.sawmill], ['🎣', LOC.fishing], ['🐟', LOC.fishMarket], ['🏁', LOC.race], ['🏠', LOC.mansion], ['🌳', LOC.park], ['⛲', { x: 0, z: 0 }], ['✈️', LOC.airport], ['🔫', LOC.blasters]];
  for (const [e, l] of icons) x.fillText(e, W(l.x), W(l.z));
}

export function drawMinimap() {
  if (!mapBase) { buildMapBase(); buildWorldBase(); }
  const c = $('minimap'), x = c.getContext('2d');
  const S = c.width, R = S / 2;
  const P = G.player.vehicle ? G.player.vehicle.pos : G.player.pos;
  const vt = G.player.vehicle && G.player.vehicle.type;
  const zoom = vt ? (vt.plane ? 0.22 : vt.heli ? 0.35 : 0.9) : 1.4;
  x.save();
  x.clearRect(0, 0, S, S);
  x.beginPath(); x.arc(R, R, R, 0, 7); x.clip();
  x.fillStyle = '#3f9be0'; x.fillRect(0, 0, S, S);
  x.translate(R, R);
  x.rotate(G.cam.yaw);          // camera forward is up
  x.scale(zoom, zoom);
  x.drawImage(worldBase, -P.x - WORLD, -P.z - WORLD, WORLD * 2, WORLD * 2);
  x.drawImage(mapBase, -P.x - mapBase.width / 2, -P.z - mapBase.height / 2);
  const dot = (wx, wz, col, r = 4) => { x.fillStyle = col; x.beginPath(); x.arc(wx - P.x, wz - P.z, r / zoom, 0, 7); x.fill(); };
  if (G.job && G.job.markers) for (const m of G.job.markers) dot(m.x, m.z, '#222', 4);
  for (const v of G.vehicles) if (v.owner === G.net.myId) dot(v.pos.x, v.pos.z, '#ff8a3d', 4);
  for (const [id, r] of G.remotes) { if (G.mapHide && G.mapHide(id)) continue; const p = r.p[0]; dot(p.x, p.z, G.mapColor ? G.mapColor(id) : '#ff3bd4', 5); }
  for (const f of G.mapDots || []) f(dot);
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
  // far-away landmarks, drawn at a fixed size
  x.font = '16px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [e, k] of [['⛰️', 'peak'], ['🎬', 'sign'], ['🏕️', 'cabin'], ['🌴', 'valley'], ['🗼', 'twin'], ['✈️', 'airport'], ['🛫', 'intl'], ['🛩️', 'swAir'], ['🏙️', 'city'], ['🏡', 'suburb'], ['🚀', 'space'], ['🌾', 'farm'], ['🏘️', 'village'], ['🏰', 'castle']]) {
    const l = LOC[k]; if (!l) continue;
    const dx = l.x - P.x, dz = l.z - P.z, cs = Math.cos(G.cam.yaw), sn = Math.sin(G.cam.yaw);
    const sx = (dx * cs - dz * sn) * zoom, sy = (dx * sn + dz * cs) * zoom;
    if (Math.hypot(sx, sy) < R - 10) x.fillText(e, R + sx, R + sy);
  }
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
  if (G.rideHud) { $('speedo').classList.remove('hidden'); $('speedo').textContent = G.rideHud; }
  else if (v && G.player.seat === 0) {
    $('speedo').classList.remove('hidden');
    let txt = Math.round(Math.abs(v.speed) * 3.6) + ' km/h' + (v.type.heli || v.type.plane ? ` · ${Math.round(v.pos.y)}m up` : '') + (v.type.sub ? ` · ${Math.max(0, Math.round(-0.6 - v.pos.y))} m deep` : '');
    if (v.type.plane && v.onGround && !v.wrecked) txt += v.speed > v.type.takeoff ? ' · ✈️ PULL ↑ NOW TO TAKE OFF!' : ` · take-off at ${Math.round(v.type.takeoff * 3.6)} km/h`;
    if (v.wrecked) txt = '💥 WRECKED — press E to get out';
    else if (v.flipped) txt = '🙃 Flipped! Hang on…';
    $('speedo').textContent = txt;
  }
  else if (G.rideHud) { $('speedo').classList.remove('hidden'); $('speedo').textContent = G.rideHud; }
  else $('speedo').classList.add('hidden');
}

export function setPrompt(text) {
  const p = $('prompt');
  if (!text) { p.classList.add('hidden'); return; }
  p.classList.remove('hidden');
  p.innerHTML = noEmoji(text);
}

// ---------------------------------------------------------------- init
export function initUI() {
  G.chatLine = chatLine;
  G.toast = toast; G.setJob = setJob; G.clearJob = clearJob; G.onMoney = onMoney; G.openDiveShop = diveShopPanel; G.openMap = islandMapPanel;
  G.openAdmin = () => ADMIN.openAdmin({ openPanel, closePanel, toast, rerender });
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
      if (t === '/admin') { closeChat(); G.openAdmin(); return; }
      if (t) { chatLine(G.save.name, t); G.onChat && G.onChat(t); }
      closeChat();
    } else if (e.key === 'Escape') closeChat();
  });
}
