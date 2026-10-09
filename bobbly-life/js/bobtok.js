// BobTok: Bobbly Island's own short-video app, on the Bobbly Phone.
//  - The "For You" feed: swipe up (or scroll / arrow keys) for the next video. The videos are filmed live around
//    the island by little drone cameras: the Bobbly Express, the rollercoaster, the Ferris wheel, planes, the
//    whale and dolphins, robot buddies dancing, foxes, people in town, flyovers, and a LIVE stream whenever a
//    boss battle is on.
//  - Double-tap or ❤️ to like, 💬 for comments from the islanders, ➕ on a creator to follow them.
//  - Real video player: progress bar you can drag, tap to pause, double-tap to like, sound on/off, loops.
//  - The big ＋ films you playing, WITH the game's sound: 15 seconds, 1 minute or 3 minutes, with a 3-2-1
//    countdown, pause/resume and stop. Post it with a caption, then watch the views, likes and followers roll in
//    (popular videos earn money). Your videos are saved on this device (they're still there next time), and you
//    can save or share them to your real phone.
//  - Real TikTok videos: paste the link to any TikTok video (🎬 tab) and it plays in your feed with TikTok's own
//    official embed player. The links stay on this device; other players never see them.
import * as THREE from 'three';
import { G, rand, pick, clamp, addMoney, writeSave } from './state.js';
import { heightAt } from './terrain.js';
import { LOC } from './world.js';
import { CREATURES } from './creatures.js';
import { sfx, audioStream, initAudio } from './audio.js';

const BT = { active: false, idx: -1, feed: [], posts: [], el: null, clip: null, t: 0, rec: null, draft: null, lastTap: 0, nextComment: 0, paused: false, muted: false, saveT: 10, noStore: false,
  cam: { pos: new THREE.Vector3(), look: new THREE.Vector3() }, want: new THREE.Vector3(), prev: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), snap: true };
G.bobtok = BT;
const UP = new THREE.Vector3(0, 1, 0), _t = new THREE.Vector3(), _s = new THREE.Vector3();
const stats = () => G.save.bt || (G.save.bt = { followers: 0, likes: 0, views: 0, posts: 0, paid: 0, following: [] });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.floor(n));
const ground = (x, z) => Math.max(0, heightAt(x, z));
const at = (o, y = 0) => o ? _t.set(o.x, ground(o.x, o.z) + y, o.z) : null;
// the whale swims slow circles round the deep basin (the sea only moves while a camera is near the bay, so
// work out where it is from its circle rather than trusting a whale that hasn't moved yet)
function whaleAt() {
  const o = G.ocean, w = o && o.whale; if (!w || !o.pod) return null;
  const y = w.m.position.lengthSq() > 1 ? w.m.position.y : -18;
  return _t.set(o.pod.cx + 20 + Math.cos(w.a) * 62, y, o.pod.cz + Math.sin(w.a) * 58);
}
// where a model really is in the world (some swim around inside a parent group)
const world = (m) => { if (!m) return null; m.updateWorldMatrix(true, false); return _t.setFromMatrixPosition(m.matrixWorld); };

// ---------------------------------------------------------------- the videos the island's creators post
// target(): where the thing being filmed is (or null if it isn't around).  style: chase (follow behind), pov
// (ride along), orbit (circle round).  Each video gets its own random likes, comments and shares.
const CLIPS = [
  { id: 'train', who: 'choochoo_bob', av: '🚆', cap: 'the Bobbly Express NEVER misses 🚆💨 #train #bobblylife', song: 'Chugga Chugga (Remix)', target: () => G.train && G.train.cars[0] && G.train.cars[0].pos, style: 'chase', d: 18, h: 6, side: 9 },
  { id: 'coaster', who: 'coaster_kid', av: '🎢', cap: 'front row on THE BOBBLER 😱 do not look down #rollercoaster #bobblyland', song: 'Screaming Beans', target: () => G.park && G.park.coaster && G.park.coaster.cars[0] && G.park.coaster.cars[0].pos, style: 'pov', d: 14, h: 6, side: 7,
    dyn: () => (G.park.coaster.v > 3 ? 'pov' : 'chase') },   // front seat while it's moving, from behind while it waits in the station
  { id: 'wheel', who: 'ferris_fran', av: '🎡', cap: 'golden hour at Bobbly Land hits different 🎡✨', song: 'Round & Round', target: () => G.park && G.park.wheel && G.park.wheel.cy ? _t.set(G.park.wheel.cx, G.park.wheel.cy, G.park.wheel.cz) : null, style: 'orbit', r: 52, h: 6, look: 0, spd: 0.12 },
  { id: 'plane', who: 'sky_spotter', av: '✈️', cap: 'caught the 3:15 to Bobbly International 🛫 #planespotting', song: 'Jet Stream Lofi', target: () => G.skyTraffic && G.skyTraffic[0] && G.skyTraffic[0].m.position, style: 'chase', d: 80, h: 16, side: 30, free: true },
  { id: 'whale', who: 'whale_watcher', av: '🐋', cap: 'the GIANT whale of Coral Bay 🐋 she said hi', song: 'Ocean Song (whale remix)', target: () => whaleAt(), style: 'orbit', r: 32, h: 3, look: 0, spd: 0.1, free: true },
  { id: 'dolphins', who: 'whale_watcher', av: '🐬', cap: 'dolphin squad 🐬🐬🐬 #nature #coralbay', song: 'Splash Splash', target: () => { const o = G.ocean, d = o && o.dolphins && o.dolphins[0]; if (!d || !o.pod) return null; const w = world(d.m); return w.lengthSq() > 1 ? w : _t.set(o.pod.cx, -2, o.pod.cz); }, style: 'chase', d: 12, h: 2, side: 5, free: true },
  { id: 'dance', who: 'bolt_the_bot', av: '🤖', cap: 'new dance just dropped 🤖💃 #dancechallenge #fyp', song: 'Beep Boop Bounce', target: () => CREATURES.buddies[0] && CREATURES.buddies[0].m.obj.position, style: 'orbit', r: 5.5, h: 2.4, look: 1.2, spd: 0.35,
    start: () => { for (const b of CREATURES.buddies) { b.m.play('Dance', 0.2); b.busy = 9; b.target = null; } } },
  { id: 'fox', who: 'fox_spotter', av: '🦊', cap: 'spotted a wild fox in Funky Forest 🦊 so fluffy', song: 'Forest Lofi', target: () => CREATURES.foxes[0] && CREATURES.foxes[0].m.obj.position, style: 'chase', d: 4.5, h: 1.5, side: 2 },
  { id: 'npc', who: 'npc_daily', av: '🚶', cap: 'day in the life of a Bobbly Town bean 🚶 #dayinmylife', song: 'Walking Bean Blues', target: () => { const n = BT.npc; return n && !n.hidden ? n.root : null; }, style: 'chase', d: 5, h: 2.6, side: 1.5,
    pick: () => { const l = G.npcs.filter(n => !n.hidden && !n.vehicle); BT.npc = l.length ? pick(l) : null; } },
  { id: 'city', who: 'mega_city_views', av: '🏙️', cap: 'Mega City from above 🏙️✨ #drone #citylife', song: 'Skyline Dreams', target: () => at(LOC.city, 40), style: 'orbit', r: 240, h: 110, look: 0, spd: 0.05 },
  { id: 'peak', who: 'peak_climber', av: '🏔️', cap: 'made it to the top of Bouncy Peaks 🏔️ the view tho', song: 'Up Here', target: () => at(LOC.peak, 0), style: 'orbit', r: 170, h: 70, look: 0, spd: 0.04 },
  { id: 'lighthouse', who: 'beach_bean', av: '🌊', cap: 'lighthouse vibes 🌊🗼 #beach #chill', song: 'Waves (slowed)', target: () => at(LOC.lighthouse, 8), style: 'orbit', r: 45, h: 12, look: 0, spd: 0.08 },
  { id: 'town', who: 'bobbly_town', av: '⛲', cap: 'POV: it\'s a sunny day in Bobbly Town ☀️ #home', song: 'Town Square Waltz', target: () => _t.set(0, 3, 0), style: 'orbit', r: 34, h: 10, look: 0, spd: 0.07 },
  { id: 'stunt', who: 'stunt_valley', av: '🔥', cap: 'who can clear the 64 m gap?? 🔥 drop your best jump #stunts', song: 'Full Send', target: () => at(LOC.stunt2, 10), style: 'orbit', r: 90, h: 40, look: 0, spd: 0.05 },
  { id: 'windmill', who: 'farm_life', av: '🌬️', cap: 'the windmill never stops 🌬️ peaceful', song: 'Countryside', target: () => at(LOC.windmill, 6), style: 'orbit', r: 28, h: 5, look: 4, spd: 0.09 },
];
// the live battle stream goes to the top of the feed while a boss fight is on
const LIVE = { id: 'live', who: 'boss_alerts', av: '🔴', live: true, cap: '🔴 LIVE: it\'s attacking the island RIGHT NOW!! everyone help!!', song: 'Battle Theme (live)',
  target: () => { const B = G.battle; if (!B || !B.kind) return null; if (B.robot) return _t.copy(B.robot.m.obj.position).setY(B.robot.m.obj.position.y + 22); const u = B.ufos && B.ufos.find(x => x.alive); return u ? u.pos : null; },
  style: 'orbit', r: 110, h: 30, look: 0, spd: 0.08, free: true };
const FANS = ['bean_lover22', 'sprocket', 'zoomzoom', 'pizza_pete', 'lil_bobbler', 'coolcat99', 'gigi.g', 'turbo_tim', 'skater_sam', 'nana_bean', 'kingflynn_fan', 'george_irl', 'mega_max', 'bubbles', 'captain_kev', 'ruby.r', 'frog_fan', 'dj_bean'];
const SAY = ['this is so bobbly 😂', 'first!!', 'how did u film this', 'W video', 'i watched this 20 times', 'need part 2', 'the music 🔥🔥', 'my favourite creator', 'NO WAY 😱', 'this made my day', 'living in bobbly town is the best', 'teach me', 'goated', '💀💀💀', 'who else is watching at night', 'underrated', 'LOL', 'i was there!!', 'bro is famous now', 'so peaceful 😌', 'pov: me', 'how is this real', 'can u do a tutorial', '10/10', 'the camera work tho'];
const CAPS = ['watch this 😂', 'did that really just happen 💀', 'just a normal day in Bobbly Life', 'rate this 1-10', 'POV: you have no fear', 'they said i couldn\'t do it', 'wait for it...', 'this is my life now 😎', 'pro gamer move', 'oops 🙃'];
const TAGS = ['#bobblylife', '#fyp', '#bean', '#funny', '#stunts', '#viral', '#gaming'];

function makeComments(n) { const out = []; for (let i = 0; i < n; i++) out.push({ who: pick(FANS), text: pick(SAY), likes: Math.floor(rand(0, 2400) * Math.random()) }); return out; }
function fakeStats(c) { const k = Math.pow(10, rand(2.6, 5.9)); c.likes = Math.floor(k); c.comm = Math.floor(k * rand(0.01, 0.04)); c.shares = Math.floor(k * rand(0.005, 0.03)); c.comments = null; c.liked = false; }

// ---------------------------------------------------------------- the feed
function buildFeed() {
  const items = [];
  if (LIVE.target()) { const c = { ...LIVE }; fakeStats(c); items.push(c); }
  const world = CLIPS.filter(c => { if (c.pick) c.pick(); return !!c.target(); }).map(c => { const o = { ...c }; fakeStats(o); return o; });
  for (let i = world.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [world[i], world[j]] = [world[j], world[i]]; }
  const mine = [...BT.posts, ...links().map(l => ({ tiktok: l.id, who: 'tiktok', av: '🎬', cap: 'A TikTok you added', song: 'TikTok', likes: 0, comm: 0, shares: 0, liked: false }))];
  let k = 0;
  while (world.length || mine.length) {
    if (mine.length && (k === 1 || k % 4 === 3 || !world.length)) items.push(mine.shift()); else if (world.length) items.push(world.shift());
    k++;
  }
  return items;
}
function itemHTML(c, i) {
  if (c.tiktok) return tiktokHTML(c, i);
  const me = !!c.mine, st = stats();
  const following = me || (st.following || []).includes(c.who);
  const media = c.photo ? `<img class="bt-media" src="${c.thumb}">` : c.url ? `<video class="bt-media" src="${c.url}" loop playsinline preload="metadata"${c.thumb ? ` poster="${c.thumb}"` : ''}></video>` : '';
  return `<div class="bt-item${c.url || c.photo ? ' has-media' : ''}" data-i="${i}">${media}
    ${c.live ? '<div class="bt-live">LIVE</div>' : ''}
    <div class="bt-pause">▶</div>
    <div class="bt-side">
      <div class="bt-av">${me ? '🙂' : c.av}${following ? '' : `<button class="bt-follow" data-follow="${esc(c.who)}">+</button>`}</div>
      <button class="bt-act" data-like="${i}"><span class="bt-heart${c.liked ? ' on' : ''}">❤</span><small>${fmt(c.likes)}</small></button>
      <button class="bt-act" data-comm="${i}"><span>💬</span><small>${fmt(c.comm)}</small></button>
      <button class="bt-act" data-share="${i}"><span>${me ? '⋯' : '↗'}</span><small>${me ? 'More' : fmt(c.shares)}</small></button>
      <div class="bt-disc">${c.av || '🎵'}</div>
    </div>
    <div class="bt-info"><b>@${esc(me ? myName() : c.who)}</b>${me ? ` · <span class="bt-views">${fmt(c.views)} views</span>` : ''}
      <p>${esc(c.cap)}</p><div class="bt-music"><span>🎵 ${esc(c.song || 'original sound')} · ${esc(me ? 'you' : c.who)}</span></div></div>
    ${c.live || c.photo ? '' : `<div class="bt-prog" data-prog="${i}"><div class="bt-pfill"></div><span class="bt-ptime"></span></div>`}
  </div>`;
}
const myName = () => (G.save.name || 'you').toLowerCase().replace(/\s+/g, '_');
const mmss = (t) => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

let api = null;   // { back(), close() } from the phone
export function renderBobTok(el, a, opts = {}) {
  api = a; BT.el = el; BT.active = true; BT.idx = -1; BT.paused = false;
  document.body.classList.add('bobtok');
  if (opts.draft) BT.draft = opts.draft;
  if (BT.draft) return renderPost(el);
  if (opts.screen === 'me') return renderMe(el);
  if (opts.screen === 'rec') return renderRec(el);
  BT.feed = buildFeed();
  el.innerHTML = `<div id="bt" class="bt-feedview">
    <div class="bt-feed" id="btFeed">${BT.feed.map(itemHTML).join('') || '<div class="bt-item"><div class="bt-info"><p>Nothing to watch yet!</p></div></div>'}</div>
    <div class="bt-top"><button class="bt-back" id="btBack">‹</button><span class="bt-tab">Following</span><b class="bt-tab on">For You</b><button class="bt-snd" id="btSnd">${BT.muted ? '🔇' : '🔊'}</button><button class="bt-x" id="btClose">✕</button></div>
    ${navHTML('home')}
    <div class="bt-sheet hidden" id="btSheet"></div>
  </div>`;
  bindCommon(el);
  const feed = el.querySelector('#btFeed');
  let tm = 0;
  feed.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(() => setActive(Math.round(feed.scrollTop / Math.max(1, feed.clientHeight))), 90); }, { passive: true });
  // one tap pauses / plays, two quick taps like it (and a finger that slides is a swipe, not a tap)
  let down = null, single = 0;
  feed.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  feed.addEventListener('pointerup', (e) => {
    if (!down || e.target.closest('button, .bt-prog') || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { down = null; return; }
    down = null;
    const now = performance.now();
    if (now - BT.lastTap < 300) { clearTimeout(single); BT.lastTap = 0; like(BT.idx, true); heartBurst(e.clientX, e.clientY); return; }
    BT.lastTap = now; single = setTimeout(togglePause, 300);
  });
  el.querySelectorAll('[data-like]').forEach(b => b.onclick = () => like(+b.dataset.like));
  el.querySelectorAll('[data-comm]').forEach(b => b.onclick = () => openComments(+b.dataset.comm));
  el.querySelectorAll('[data-share]').forEach(b => b.onclick = () => share(+b.dataset.share));
  el.querySelectorAll('[data-follow]').forEach(b => b.onclick = (e) => { e.stopPropagation(); follow(b.dataset.follow); b.remove(); });
  el.querySelectorAll('[data-prog]').forEach(bindScrub);
  el.querySelector('#btSnd').onclick = () => { BT.muted = !BT.muted; el.querySelector('#btSnd').textContent = BT.muted ? '🔇' : '🔊'; el.querySelectorAll('video').forEach(v => { v.muted = BT.muted; }); const it = itemEl(BT.idx); if (it && it.classList.contains('bt-tt')) ttSend(it, BT.muted ? 'mute' : 'unMute'); };
  el.querySelectorAll('[data-ttctl]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const it = b.closest('.bt-item'); it.classList.toggle('ctl'); b.querySelector('small').textContent = it.classList.contains('ctl') ? 'Swipe' : 'Controls'; });
  el.querySelectorAll('[data-ttnext]').forEach(b => b.onclick = (e) => { e.stopPropagation(); const f = el.querySelector('#btFeed'); f.scrollTo({ top: (BT.idx + 1) * f.clientHeight, behavior: 'smooth' }); });
  // videos recorded in Chrome don't know how long they are until they've been read to the end: make them find out
  el.querySelectorAll('video').forEach(v => v.addEventListener('loadedmetadata', () => { if (v.duration === Infinity) { const f = () => { v.removeEventListener('timeupdate', f); v.currentTime = 0; }; v.addEventListener('timeupdate', f); v.currentTime = 1e101; } }));
  setActive(0);
}
function navHTML(on) {
  return `<div class="bt-nav"><button data-bt="home" class="${on === 'home' ? 'on' : ''}">🏠<small>Home</small></button>
    <button data-bt="links" class="${on === 'links' ? 'on' : ''}">🎬<small>TikTok</small></button><button data-bt="rec" class="bt-plus">＋</button><button data-bt="me" class="${on === 'me' ? 'on' : ''}">👤<small>Me</small></button></div>`;
}
function bindCommon(el) {
  const back = el.querySelector('#btBack'); if (back) back.onclick = () => { stopAll(); api.back(); };
  const x = el.querySelector('#btClose'); if (x) x.onclick = () => api.close();
  el.querySelectorAll('[data-bt]').forEach(b => b.onclick = () => {
    const k = b.dataset.bt;
    stopAll();
    if (k === 'rec') renderRec(BT.el);
    else if (k === 'me') renderMe(BT.el);
    else if (k === 'links') renderLinks(BT.el);
    else renderBobTok(BT.el, api);
  });
}
function stopAll() { if (!BT.el) return; BT.el.querySelectorAll('video').forEach(v => v.pause()); BT.clip = null; G.camOverride = null; document.body.classList.remove('bt-world'); }
const itemEl = (i) => BT.el && BT.el.querySelector(`.bt-item[data-i="${i}"]`);
const videoOf = (i) => { const it = itemEl(i); return it && it.querySelector('video'); };

function setActive(i) {
  if (i === BT.idx || !BT.el) return;
  BT.idx = i; BT.paused = false;
  const c = BT.feed[i];
  BT.el.querySelectorAll('.bt-item').forEach(it => { it.classList.remove('paused'); const v = it.querySelector('video'); if (v && it.dataset.i != i) v.pause(); });
  if (!c) return;
  // TikTok players only load while they're on screen (they're heavy, and it stops their sound when you swipe on)
  BT.el.querySelectorAll('.bt-tt iframe').forEach(f => { if (f.closest('.bt-item').dataset.i != i && f.getAttribute('src') !== 'about:blank') f.setAttribute('src', 'about:blank'); });
  if (c.tiktok) {
    BT.clip = null; G.camOverride = null;
    document.body.classList.remove('bt-world');
    const f = itemEl(i).querySelector('iframe'); f.setAttribute('src', playerURL(c.tiktok));
  } else if (c.url || c.photo) {
    BT.clip = null; G.camOverride = null;
    document.body.classList.remove('bt-world');
    const v = videoOf(i);
    if (v) playVideo(v);
  } else {
    BT.clip = c; BT.t = 0; BT.snap = true;
    if (!c.dur && !c.live) c.dur = Math.round(rand(14, 32));
    if (c.pick) c.pick();
    if (c.start) c.start();
    document.body.classList.add('bt-world');
  }
  if (c.mine) { c.views += 1; }
}
// play with sound if the browser lets us; otherwise play silently and show the sound button
function playVideo(v) {
  try { v.currentTime = 0; } catch (e) { /* not loaded yet */ }
  v.muted = BT.muted;
  const p = v.play();
  if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); const b = BT.el && BT.el.querySelector('#btSnd'); if (b) { b.textContent = '🔇'; b.classList.add('nudge'); } BT.muted = true; });
}
function togglePause() {
  const it = itemEl(BT.idx), c = BT.feed[BT.idx]; if (!it || !c || c.live) return;
  if (c.tiktok) { const p = it.classList.toggle('paused'); ttSend(it, p ? 'pause' : 'play'); if (!p && !BT.muted) ttSend(it, 'unMute'); return; }
  const v = it.querySelector('video');
  if (v) { if (v.paused) { v.play().catch(() => {}); it.classList.remove('paused'); } else { v.pause(); it.classList.add('paused'); } }
  else if (!c.photo) { BT.paused = !BT.paused; it.classList.toggle('paused', BT.paused); }
}
// drag along the bar at the bottom to jump around in the video
function bindScrub(bar) {
  const i = +bar.dataset.prog;
  const seek = (e) => {
    const r = bar.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1), c = BT.feed[i], v = videoOf(i);
    if (v) { const d = isFinite(v.duration) && v.duration > 0 ? v.duration : (c.dur || 10); v.currentTime = f * d; }
    else if (c && c.dur) { BT.t = f * c.dur; BT.snap = true; }
    bar.classList.add('drag');
  };
  bar.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); bar.setPointerCapture(e.pointerId); seek(e); });
  bar.addEventListener('pointermove', (e) => { if (bar.hasPointerCapture(e.pointerId)) seek(e); });
  const up = (e) => { if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId); bar.classList.remove('drag'); };
  bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
}
function updateProgress() {
  const c = BT.feed[BT.idx], it = itemEl(BT.idx); if (!c || !it) return;
  const bar = it.querySelector('.bt-prog'); if (!bar) return;
  let t = 0, d = 1;
  const v = it.querySelector('video');
  if (v) { t = v.currentTime; d = isFinite(v.duration) && v.duration > 0 ? v.duration : (c.dur || 10); }
  else { t = BT.t; d = c.dur || 20; }
  bar.firstElementChild.style.transform = `scaleX(${clamp(t / d, 0, 1)})`;
  bar.lastElementChild.textContent = `${mmss(t)} / ${mmss(d)}`;
}

// ---------------------------------------------------------------- likes, comments, follows, shares
function like(i, only) {
  const c = BT.feed[i]; if (!c) return;
  if (c.liked && only) return;
  c.liked = !c.liked; c.likes += c.liked ? 1 : -1;
  const b = BT.el && BT.el.querySelector(`[data-like="${i}"]`);
  if (b) { b.querySelector('.bt-heart').classList.toggle('on', c.liked); b.querySelector('small').textContent = fmt(c.likes); }
  if (c.liked) { sfx.pop && sfx.pop(); try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* no vibration */ } }
}
function heartBurst(x, y) {
  const h = document.createElement('div'); h.className = 'bt-burst'; h.textContent = '❤'; h.style.left = x + 'px'; h.style.top = y + 'px';
  h.style.setProperty('--r', (Math.random() * 40 - 20) + 'deg');
  document.body.appendChild(h); setTimeout(() => h.remove(), 900);
}
function follow(who) {
  const st = stats(); st.following = st.following || [];
  if (!st.following.includes(who)) { st.following.push(who); writeSave(); }
  G.toast && G.toast(`🎵 Following @${who}`, null, 1800);
}
function openComments(i) {
  const c = BT.feed[i], sh = BT.el.querySelector('#btSheet'); if (!c || !sh) return;
  if (!c.comments) c.comments = c.mine ? (c.fans || []) : makeComments(8 + Math.floor(Math.random() * 6));
  const list = () => c.comments.map(m => `<div class="bt-c"><b>${esc(m.who)}</b> ${esc(m.text)}<small>❤ ${fmt(m.likes || 0)}</small></div>`).join('') || '<p class="small">No comments yet. Be the first!</p>';
  sh.innerHTML = `<div class="bt-sh-head">${fmt(c.comm)} comments<button id="btShX">✕</button></div><div class="bt-cl">${list()}</div>
    <div class="bt-cin"><input id="btCin" maxlength="80" placeholder="Add a comment..."><button id="btCsend">Send</button></div>`;
  sh.classList.remove('hidden');
  sh.querySelector('#btShX').onclick = () => sh.classList.add('hidden');
  const send = () => {
    const inp = sh.querySelector('#btCin'), t = inp.value.trim(); if (!t) return;
    c.comments.unshift({ who: (G.save.name || 'you'), text: t, likes: 0 }); c.comm++; inp.value = '';
    sh.querySelector('.bt-cl').innerHTML = list();
    const b = BT.el.querySelector(`[data-comm="${i}"] small`); if (b) b.textContent = fmt(c.comm);
  };
  sh.querySelector('#btCsend').onclick = send;
  sh.querySelector('#btCin').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); });
}
function share(i) {
  const c = BT.feed[i]; if (!c) return;
  if (c.mine) return moreSheet(c);
  c.shares++; const b = BT.el.querySelector(`[data-share="${i}"] small`); if (b) b.textContent = fmt(c.shares);
  G.toast && G.toast('↗ Shared with your Bobbly friends!', null, 1800);
}
// your own video: save it to the device, or delete it
function moreSheet(c) {
  const sh = BT.el.querySelector('#btSheet'); if (!sh) return;
  sh.innerHTML = `<div class="bt-sh-head">Your video · ${mmss(c.dur)}<button id="btShX">✕</button></div>
    <div class="bt-more"><button class="btn green" id="btMSave">↗ Save / share to your device</button><button class="btn red" id="btMDel">🗑 Delete this video</button></div>`;
  sh.classList.remove('hidden');
  sh.querySelector('#btShX').onclick = () => sh.classList.add('hidden');
  sh.querySelector('#btMSave').onclick = () => saveClip(c);
  sh.querySelector('#btMDel').onclick = () => {
    const b = sh.querySelector('#btMDel');
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again to delete it for good'; return; }
    deletePost(c).then(() => { G.toast && G.toast('🗑 Video deleted', null, 1800); renderBobTok(BT.el, api); });
  };
}
async function saveClip(c) {
  if (!c.blob) return;
  const ext = c.photo ? 'jpg' : /mp4/.test(c.mime) ? 'mp4' : 'webm', name = `bobbly-life-${Date.now()}.${ext}`;
  // on phones, the share sheet lets you save it to your photos or send it to a friend
  try {
    const file = new File([c.blob], name, { type: c.blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My Bobbly Life video' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = c.url || c.thumb; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  G.toast && G.toast('💾 Saved to your downloads!', 'money', 2500);
}

// ---------------------------------------------------------------- your videos are kept on this device
// (IndexedDB: the video files in one store, their captions and stats in another, so stats can be saved often)
const DB = {};
function idb() {
  if (!DB.p) DB.p = new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('no storage')); return; }
    const r = indexedDB.open('bobtok', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('videos'); d.createObjectStore('posts', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return DB.p;
}
function tx(store, mode, fn) {
  return idb().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result); t.onerror = t.onabort = () => rej(t.error);
  }));
}
const META = ['id', 'mime', 'photo', 'thumb', 'cap', 'song', 'created', 'dur', 'views', 'likes', 'comm', 'shares', 'viral', 'ratio', 'next', 'age'];
const meta = (p) => { const o = {}; for (const k of META) o[k] = p[k]; o.fans = (p.fans || []).slice(0, 30); return o; };
function saveStats() { if (BT.posts.length) tx('posts', 'readwrite', s => { for (const p of BT.posts) if (p.stored) s.put(meta(p)); }).catch(() => {}); }
async function loadPosts() {
  try {
    const metas = (await tx('posts', 'readonly', s => s.getAll())) || [];
    metas.sort((a, b) => b.created - a.created);
    for (const m of metas) {
      const blob = await tx('videos', 'readonly', s => s.get(m.id));
      if (!blob) continue;
      BT.posts.push({ ...m, fans: m.fans || [], mine: true, blob, url: m.photo ? null : URL.createObjectURL(blob), liked: false, stored: true });
    }
  } catch (e) { BT.noStore = true; }
}
loadPosts();
async function deletePost(p) {
  const k = BT.posts.indexOf(p); if (k >= 0) BT.posts.splice(k, 1);
  if (p.url) URL.revokeObjectURL(p.url);
  try { await tx('videos', 'readwrite', s => s.delete(p.id)); await tx('posts', 'readwrite', s => s.delete(p.id)); } catch (e) { /* already gone */ }
}

// ---------------------------------------------------------------- your profile
function renderMe(el) {
  const st = stats();
  stopAll();
  el.innerHTML = `<div id="bt" class="bt-me">
    <div class="bt-top solid"><button class="bt-back" id="btBack">‹</button><b>@${esc(myName())}</b><button class="bt-x" id="btClose">✕</button></div>
    <div class="bt-prof"><div class="bt-bigav">🙂</div>
      <div class="bt-nums"><div><b>${fmt(st.following ? st.following.length : 0)}</b><small>Following</small></div><div><b>${fmt(st.followers)}</b><small>Followers</small></div><div><b>${fmt(st.likes)}</b><small>Likes</small></div></div>
      <p class="small">${fmt(st.views)} views · ${st.posts} videos posted · earned $${fmt(st.paid || 0)}</p>
      <button class="btn green" id="btRec2">＋ Make a video</button></div>
    <div class="bt-grid">${BT.posts.map((p, i) => `<div class="bt-thumb" data-p="${i}" style="background-image:url('${p.thumb || ''}')"><span>▶ ${fmt(p.views)}</span><em>${mmss(p.dur)}</em></div>`).join('') || '<p class="small bt-empty">No videos yet. Tap ＋ to film yourself playing (with sound!), then post it.</p>'}</div>
    <p class="small bt-note">${BT.noStore ? 'This browser can\'t keep videos, so they last until you close the game. Use ⋯ → Save to keep one.' : '✅ Your videos are saved on this device. <span id="btUse"></span>'}</p>
    ${navHTML('me')}
  </div>`;
  bindCommon(el);
  el.querySelector('#btRec2').onclick = () => renderRec(el);
  el.querySelectorAll('[data-p]').forEach(t => t.onclick = () => {
    renderBobTok(el, api);
    const i = BT.feed.indexOf(BT.posts[+t.dataset.p]);
    if (i >= 0) { const f = el.querySelector('#btFeed'); f.scrollTop = i * f.clientHeight; setActive(i); }
  });
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { const u = el.querySelector('#btUse'); if (u && e.usage) u.textContent = `(using ${Math.round(e.usage / 1048576)} MB)`; }).catch(() => {});
}

// ---------------------------------------------------------------- making a video
const LENGTHS = [[15, '15s'], [60, '1 min'], [180, '3 min']];
function renderRec(el) {
  const st = stats(), len = st.len || 60;
  stopAll();
  el.innerHTML = `<div id="bt" class="bt-recsetup">
    <div class="bt-top solid"><button class="bt-back" id="btBack">‹</button><b>Make a video</b><button class="bt-x" id="btClose">✕</button></div>
    <div class="bt-rs">
      <div class="bt-rs-cam">🎥</div>
      <p><b>BobTok films the game while you play</b>, with all the sound. Do your best stunts, crashes and jumps!</p>
      <div class="bt-len">${LENGTHS.map(([s, l]) => `<button data-len="${s}" class="${s === len ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="bt-opt"><input type="checkbox" id="btCD" ${st.countdown === false ? '' : 'checked'}> 3-2-1 countdown first</label>
      <button class="bt-bigrec" id="btGo" aria-label="Start recording"></button>
      <p class="small">While it's recording: ⏸ pauses, ■ finishes. The phone closes so you can play.</p>
    </div>
    ${navHTML('rec')}
  </div>`;
  bindCommon(el);
  el.querySelectorAll('[data-len]').forEach(b => b.onclick = () => { st.len = +b.dataset.len; writeSave(); el.querySelectorAll('[data-len]').forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelector('#btCD').onchange = (e) => { st.countdown = e.target.checked; writeSave(); };
  el.querySelector('#btGo').onclick = () => startRecording(st.len || 60, st.countdown !== false);
}
function recHud() {
  let el = document.getElementById('btRec');
  if (!el) {
    el = document.createElement('div'); el.id = 'btRec';
    el.innerHTML = '<span class="dot"></span><b id="btRecT">REC</b><div class="bt-rbar"><div id="btRecFill"></div></div><button id="btRecPause">⏸</button><button id="btRecStop" class="stop">■ Done</button>';
    document.body.appendChild(el);
    el.querySelector('#btRecStop').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); stopRecording(); });
    el.querySelector('#btRecPause').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pauseRecording(); });
  }
  return el;
}
function countdown(n, done) {
  const el = document.createElement('div'); el.id = 'btCount';
  document.body.appendChild(el);
  const step = () => {
    if (n <= 0) { el.remove(); done(); return; }
    el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    sfx.pop && sfx.pop(); n--; setTimeout(step, 1000);
  };
  step();
}
export function startRecording(len = 60, withCountdown = true) {
  if (BT.rec) return;
  stopAll();
  api && api.close();
  initAudio();
  const rec = { len, elapsed: 0, last: 0, paused: false, chunks: [], thumb: null, recorder: null, mime: '', starting: true };
  BT.rec = rec;
  const go = () => { rec.starting = false; beginRecording(rec); };
  if (withCountdown) countdown(3, go); else go();
}
function beginRecording(rec) {
  if (BT.rec !== rec) return;
  const canvas = G.renderer.domElement;
  // a cover picture for the video, grabbed straight after the next frame is drawn
  G.afterRender = (c) => { rec.thumb = snap(c); G.afterRender = null; };
  // the picture from the game, plus the game's sound
  const types = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
  if (window.MediaRecorder && canvas.captureStream) {
    try {
      const v = canvas.captureStream(30), a = audioStream();
      const stream = new MediaStream([...v.getVideoTracks(), ...(a ? a.getAudioTracks() : [])]);
      const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
      const opt = { videoBitsPerSecond: rec.len <= 15 ? 2500000 : 1600000, audioBitsPerSecond: 96000 };
      if (mime) opt.mimeType = mime;
      const r = new MediaRecorder(stream, opt);
      r.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      r.onstop = () => finishRecording(rec);
      r.start(500); rec.recorder = r; rec.mime = r.mimeType || mime;
    } catch (e) { rec.recorder = null; }
  }
  if (!rec.recorder) { rec.len = 0.6; G.toast && G.toast('📸 Video recording isn\'t supported in this browser, so BobTok takes a photo instead!', null, 4000); }
  rec.last = performance.now();
  const h = recHud(); h.classList.add('on'); h.classList.remove('paused'); h.classList.toggle('photo', !rec.recorder);
}
function pauseRecording() {
  const rec = BT.rec; if (!rec || !rec.recorder || rec.stopping) return;
  rec.paused = !rec.paused;
  try { if (rec.paused) rec.recorder.pause(); else { rec.recorder.resume(); rec.last = performance.now(); } } catch (e) { /* old browser */ }
  const h = recHud(); h.classList.toggle('paused', rec.paused);
  h.querySelector('#btRecPause').textContent = rec.paused ? '▶' : '⏸';
}
function snap(c) {
  const w = 270, h = 480, out = document.createElement('canvas'); out.width = w; out.height = h;
  const x = out.getContext('2d'), k = Math.max(w / c.width, h / c.height), sw = w / k, sh = h / k;
  x.drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.82);
}
export function stopRecording() {
  const rec = BT.rec; if (!rec || rec.stopping) return;
  rec.stopping = true;
  if (rec.recorder && rec.recorder.state !== 'inactive') { try { if (rec.recorder.state === 'paused') rec.recorder.resume(); } catch (e) { /* fine */ } rec.recorder.stop(); } else finishRecording(rec);
}
function finishRecording(rec) {
  const h = document.getElementById('btRec'); if (h) h.classList.remove('on');
  BT.rec = null;
  let blob = null, url = null, photo = false;
  if (rec.chunks.length) { blob = new Blob(rec.chunks, { type: rec.mime || 'video/webm' }); url = URL.createObjectURL(blob); }
  else if (rec.thumb) { photo = true; blob = dataToBlob(rec.thumb); }
  if (!blob) { G.toast && G.toast('Recording failed, try again!', 'bad'); return; }
  BT.draft = { mine: true, url, blob, mime: rec.mime, photo, thumb: rec.thumb, dur: Math.max(1, Math.round(rec.elapsed)), cap: pick(CAPS) + ' ' + [pick(TAGS), pick(TAGS)].filter((v, i, a) => a.indexOf(v) === i).join(' '), song: 'original sound' };
  G.openPhoneApp && G.openPhoneApp('bobtok');
}
function dataToBlob(d) { const [h, b] = d.split(','), bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: h.slice(5, h.indexOf(';')) }); }
function renderPost(el) {
  const d = BT.draft;
  stopAll();
  el.innerHTML = `<div id="bt" class="bt-post">
    <div class="bt-top solid"><button class="bt-back" id="btDiscard">✕</button><b>New video · ${mmss(d.dur)}</b><span></span></div>
    <div class="bt-prev">${d.photo ? `<img src="${d.thumb}">` : `<video src="${d.url}" autoplay loop playsinline${d.thumb ? ` poster="${d.thumb}"` : ''}></video><button class="bt-psnd" id="btPSnd">🔊</button>`}</div>
    <label class="lbl">Caption</label>
    <textarea id="btCap" maxlength="150" rows="2">${esc(d.cap)}</textarea>
    <div class="bt-post-btns"><button class="btn gray" id="btRetake">↺ Retake</button><button class="btn gray" id="btSave">↗ Save</button><button class="btn green" id="btPost">Post 🚀</button></div>
    <p class="small">Posting puts it on BobTok in the game (and keeps it on this device). "Save" puts a copy in your photos / downloads.</p>
  </div>`;
  const v = el.querySelector('.bt-prev video');
  if (v) { v.muted = false; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); el.querySelector('#btPSnd').textContent = '🔇'; }); el.querySelector('#btPSnd').onclick = () => { v.muted = !v.muted; el.querySelector('#btPSnd').textContent = v.muted ? '🔇' : '🔊'; }; }
  el.querySelector('#btCap').addEventListener('keydown', (e) => e.stopPropagation());
  const discard = () => { if (d.url) URL.revokeObjectURL(d.url); BT.draft = null; };
  el.querySelector('#btDiscard').onclick = () => { discard(); renderBobTok(el, api); };
  el.querySelector('#btRetake').onclick = () => { discard(); renderRec(el); };
  el.querySelector('#btSave').onclick = () => saveClip(d);
  el.querySelector('#btPost').onclick = () => {
    d.cap = el.querySelector('#btCap').value.trim() || d.cap;
    post(d); BT.draft = null; renderBobTok(el, api);
    const f = el.querySelector('#btFeed'), i = BT.feed.indexOf(d);
    if (f && i >= 0) { f.scrollTop = i * f.clientHeight; setActive(i); }
  };
}
function post(d) {
  const st = stats();
  // how far it'll go: mostly small, sometimes it blows up (and longer videos with more going on do a bit better)
  const viral = clamp(Math.exp((Math.random() + Math.random() + Math.random() - 1.5) * 1.6) * (1 + Math.min(d.dur || 10, 120) / 240), 0.25, 16);
  Object.assign(d, { id: 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), created: Date.now(), views: 0, likes: 0, comm: 0, shares: 0, liked: false, fans: [], age: 0, viral, ratio: rand(0.06, 0.16), next: 100 });
  BT.posts.unshift(d);
  st.posts++; writeSave();
  G.toast && G.toast('🎉 Posted to BobTok! Watch the views come in.', 'money', 3500);
  // keep it on this device for next time
  if (!BT.noStore) {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    tx('videos', 'readwrite', s => s.put(d.blob, d.id)).then(() => tx('posts', 'readwrite', s => s.put(meta(d)))).then(() => { d.stored = true; })
      .catch(() => { G.toast && G.toast('⚠️ Couldn\'t keep this video on your device (it might be full). It stays until you close the game: use ⋯ → Save.', 'bad', 6000); });
  }
}

// ---------------------------------------------------------------- every frame
const MILESTONES = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
export function updateBobTok(dt) {
  // recording: count real seconds (not while paused), stop at the chosen length
  const rec = BT.rec;
  if (rec && !rec.starting && !rec.stopping) {
    const now = performance.now();
    if (!rec.paused) rec.elapsed += (now - rec.last) / 1000;
    rec.last = now;
    const t = document.getElementById('btRecT'), f = document.getElementById('btRecFill');
    const txt = rec.recorder ? `${rec.paused ? 'PAUSED' : 'REC'} ${mmss(rec.elapsed)} / ${mmss(rec.len)}` : '📸';
    if (t && t.textContent !== txt) t.textContent = txt;
    if (f) f.style.transform = `scaleX(${clamp(rec.elapsed / rec.len, 0, 1)})`;
    if (rec.elapsed >= rec.len) stopRecording();
  }
  // your videos: views, likes, followers and comments keep coming while you play
  const st = stats();
  for (const p of BT.posts) {
    p.age += dt;
    const rate = (0.6 + st.followers * 0.02) * p.viral * 6 * Math.exp(-p.age / 150) * rand(0.4, 1.6);
    const dv = rate * dt;
    if (dv <= 0) continue;
    p.views += dv; st.views += dv;
    const dl = dv * p.ratio; p.likes += dl; st.likes += dl;
    st.followers += dv * 0.015 * p.viral;
    if (Math.random() < dv * 0.012) { p.comm++; p.fans.unshift({ who: pick(FANS), text: pick(SAY), likes: Math.floor(rand(0, 40)) }); }
    while (p.views >= p.next) {
      const m = p.next, pay = Math.round(m / 10);
      addMoney(pay, `🎵 BobTok: your video hit ${fmt(m)} views!`);
      st.paid = (st.paid || 0) + pay;
      p.next = MILESTONES.find(x => x > m) || m * 10;
    }
  }
  if (BT.posts.length && G.time > BT.nextComment && G.started && !G.ui.panel) {
    BT.nextComment = G.time + rand(35, 70);
    const p = BT.posts[0];
    if (p.views > 30) G.toast && G.toast(`💬 @${pick(FANS)} on your video: "${pick(SAY)}"`, null, 3500);
  }
  if (Math.random() < dt * 0.2) writeSave();
  if ((BT.saveT -= dt) <= 0) { BT.saveT = 10; saveStats(); }
  // is the BobTok feed still on screen?
  const open = BT.active && G.ui.panel && G.ui.phoneApp === 'bobtok' && document.contains(BT.el && BT.el.querySelector('#bt'));
  if (!open) {
    if (BT.active) { BT.active = false; BT.clip = null; G.camOverride = null; document.body.classList.remove('bobtok', 'bt-world'); if (BT.el) BT.el.querySelectorAll('video').forEach(v => v.pause()); }
    return;
  }
  filmClip(dt);
  updateProgress();
}
// the drone camera for whatever video is showing (it loops when it reaches the end, like a real video)
function filmClip(dt) {
  const c = BT.clip; if (!c) return;
  if (!BT.paused) BT.t += dt;
  if (c.dur && BT.t >= c.dur) { BT.t = 0; BT.snap = true; }
  const tg = c.target();
  if (!tg) return;
  if (c.dyn) { const st = c.dyn(); if (st !== c.style) { c.style = st; BT.snap = true; } }
  const T = _s.copy(tg), want = BT.want;
  // which way it's moving (for chasing and riding along)
  if (!BT.snap) { const v = _t.subVectors(T, BT.prev); if (v.lengthSq() > 1e-4) BT.fwd.lerp(v.setY(c.style === 'pov' ? v.y : 0).normalize(), Math.min(1, dt * 3)).normalize(); }
  BT.prev.copy(T);
  const f = BT.fwd, side = _t.crossVectors(f, UP).normalize();
  const look = BT.cam.look;
  if (c.style === 'orbit') {
    const a = (c.a0 ??= rand(0, 6.28)) + BT.t * (c.spd || 0.1);
    want.set(T.x + Math.cos(a) * c.r, T.y + c.h, T.z + Math.sin(a) * c.r);
    look.copy(T).y += c.look || 0;
  } else if (c.style === 'pov') {
    want.copy(T).addScaledVector(UP, 1.9).addScaledVector(f, -0.6);
    look.copy(T).addScaledVector(f, 14).addScaledVector(UP, 1.2);
  } else {
    want.copy(T).addScaledVector(f, -(c.d || 8)).addScaledVector(side, c.side || 0).addScaledVector(UP, c.h || 3);
    look.copy(T).addScaledVector(UP, (c.h || 3) * 0.2).addScaledVector(f, (c.d || 8) * 0.3);
  }
  if (!c.free && c.style !== 'pov') want.y = Math.max(want.y, ground(want.x, want.z) + 1.2);
  if (BT.snap) { BT.cam.pos.copy(want); BT.snap = false; BT.fwd.set(0, 0, 1); }
  else if (!BT.paused) BT.cam.pos.lerp(want, c.style === 'pov' ? 1 : 1 - Math.exp(-dt * 3));
  G.camOverride = BT.cam;
}

// arrow keys / W S / mouse wheel scroll the feed on computers; Space or K pauses, L likes
addEventListener('keydown', (e) => {
  if (!BT.active || !BT.el || BT.draft) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const f = BT.el.querySelector('#btFeed'); if (!f) return;
  const d = { ArrowDown: 1, KeyS: 1, PageDown: 1, ArrowUp: -1, KeyW: -1, PageUp: -1 }[e.code];
  if (d) { e.preventDefault(); f.scrollTo({ top: clamp(BT.idx + d, 0, BT.feed.length - 1) * f.clientHeight, behavior: 'smooth' }); }
  if (e.code === 'KeyL') { e.preventDefault(); like(BT.idx); }
  if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); togglePause(); }
});

// ---------------------------------------------------------------- real TikTok videos (links you add)
// TikTok lets websites show its videos with its own official embed player. You paste a video's link, BobTok keeps
// it on this device, and it plays in your feed. (TikTok doesn't let other sites show its For You feed or log in
// to accounts without an approved developer app and a server, so this is the way it can work here.)
const LINKS_KEY = 'bobtok-tiktoks';
function links() { try { return JSON.parse(localStorage.getItem(LINKS_KEY) || '[]'); } catch (e) { return []; } }
function setLinks(a) { try { localStorage.setItem(LINKS_KEY, JSON.stringify(a.slice(0, 60))); } catch (e) { /* storage blocked */ } }
export function tiktokId(text) {
  const t = String(text || '').trim();
  const m = t.match(/(?:\/video\/|\/v\/|\/player\/v1\/|\/embed\/v2\/|\/embed\/)(\d{8,25})/) || t.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
}
async function resolveTikTok(text) {
  const id = tiktokId(text); if (id) return id;
  if (!/tiktok\.com/i.test(text)) return null;
  // short links (vm.tiktok.com/..., tiktok.com/t/...): ask TikTok's public oEmbed service which video it is
  try {
    const r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(String(text).trim()));
    const j = await r.json();
    return j.embed_product_id || ((j.html || '').match(/data-video-id="(\d+)"/) || [])[1] || null;
  } catch (e) { return null; }
}
const playerURL = (id) => `https://www.tiktok.com/player/v1/${id}?autoplay=1&loop=1&rel=0&music_info=1&description=1&controls=1&progress_bar=1&volume_control=1`;
// TikTok's player takes play / pause / mute / unMute messages
function ttSend(it, type) { const f = it && it.querySelector('iframe'); try { f && f.contentWindow && f.contentWindow.postMessage({ type, value: null, 'x-tiktok-player': true }, '*'); } catch (e) { /* not loaded */ } }
function tiktokHTML(c, i) {
  return `<div class="bt-item has-media bt-tt" data-i="${i}">
    <iframe class="bt-media" src="about:blank" title="TikTok video" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <div class="bt-ttcover"></div>
    <div class="bt-tt-loading">Loading TikTok…<small>If nothing shows up, TikTok might be blocked on this device or network.</small></div>
    <div class="bt-pause">▶</div>
    <div class="bt-side">
      <div class="bt-av">🎬</div>
      <button class="bt-act" data-like="${i}"><span class="bt-heart${c.liked ? ' on' : ''}">❤</span><small>Like</small></button>
      <button class="bt-act" data-ttctl="${i}"><span>🖐</span><small>Controls</small></button>
      <button class="bt-act" data-ttnext="${i}"><span>⬇</span><small>Next</small></button>
    </div>
  </div>`;
}
function renderLinks(el) {
  stopAll();
  const list = links();
  el.innerHTML = `<div id="bt" class="bt-links">
    <div class="bt-top solid"><button class="bt-back" id="btBack">‹</button><b>🎬 TikTok videos</b><button class="bt-x" id="btClose">✕</button></div>
    <div class="bt-lk">
      <p><b>Watch real TikToks in BobTok.</b> In the TikTok app or website, open a video, tap <b>Share → Copy link</b>, then paste it here.</p>
      <div class="bt-lk-in"><input id="btLink" placeholder="https://www.tiktok.com/@.../video/..." autocomplete="off"><button class="btn green" id="btAdd">Add</button></div>
      <p class="small" id="btLinkMsg"></p>
      <div class="bt-lk-list">${list.map((l, k) => `<div class="bt-lk-row"><span>🎬 TikTok video <small>${esc(l.id)}</small></span><button class="btn small" data-watch="${k}">▶ Watch</button><button class="btn small gray" data-rm="${k}">✕</button></div>`).join('') || '<p class="small">No TikToks added yet.</p>'}</div>
      <p class="small">They play with TikTok's own player, right in your feed. Your links stay on this device only; other players can't see them. (TikTok is for ages 13+.)</p>
    </div>
    ${navHTML('links')}
  </div>`;
  bindCommon(el);
  const msg = el.querySelector('#btLinkMsg'), inp = el.querySelector('#btLink');
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') add(); });
  const add = async () => {
    msg.textContent = 'Checking the link…';
    const id = await resolveTikTok(inp.value);
    if (!id) { msg.textContent = '❌ That doesn\'t look like a TikTok video link. Use the full link with /video/ and a long number in it (if you have a short link, open it in your browser first and copy the long one).'; return; }
    const a = links().filter(l => l.id !== id); a.unshift({ id, added: Date.now() }); setLinks(a);
    G.toast && G.toast('🎬 TikTok added to your BobTok feed!', 'money', 2500);
    watch(id);
  };
  el.querySelector('#btAdd').onclick = add;
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const a = links(); a.splice(+b.dataset.rm, 1); setLinks(a); renderLinks(el); });
  el.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => watch(list[+b.dataset.watch].id));
}
function watch(id) {
  renderBobTok(BT.el, api);
  const i = BT.feed.findIndex(c => c.tiktok === id);
  if (i >= 0) { const f = BT.el.querySelector('#btFeed'); f.scrollTop = i * f.clientHeight; setActive(i); }
}
