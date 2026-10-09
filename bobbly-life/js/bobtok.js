// BobTok: Bobbly Island's own short-video app, on the Bobbly Phone.
//  - The "For You" feed: swipe up (or scroll / arrow keys) for the next video. The videos are filmed live around
//    the island by little drone cameras: the Bobbly Express, the rollercoaster, the Ferris wheel, planes, the
//    whale and dolphins, robot buddies dancing, foxes, people in town, flyovers, and a LIVE stream whenever a
//    boss battle is on.
//  - Double-tap or ❤️ to like, 💬 for comments from the islanders, ➕ on a creator to follow them.
//  - The big ＋ records 10 seconds of you playing. Post it with a caption, then watch the views, likes and
//    followers roll in (popular videos earn money). Save or share your clip to your real phone.
// Your stats are saved; the videos themselves only last until you close the game (save the good ones!).
import * as THREE from 'three';
import { G, rand, pick, clamp, addMoney, writeSave } from './state.js';
import { heightAt } from './terrain.js';
import { LOC } from './world.js';
import { CREATURES } from './creatures.js';
import { sfx } from './audio.js';

const BT = { active: false, idx: -1, feed: [], posts: [], el: null, clip: null, t: 0, rec: null, draft: null, lastTap: 0, nextComment: 0,
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
  const mine = [...BT.posts];
  let k = 0;
  while (world.length || mine.length) {
    if (mine.length && (k === 1 || k % 4 === 3 || !world.length)) items.push(mine.shift()); else if (world.length) items.push(world.shift());
    k++;
  }
  return items;
}
function itemHTML(c, i) {
  const me = !!c.mine, st = stats();
  const following = me || (st.following || []).includes(c.who);
  const media = c.photo ? `<img class="bt-media" src="${c.thumb}">` : c.url ? `<video class="bt-media" src="${c.url}" loop playsinline muted preload="auto"${c.thumb ? ` poster="${c.thumb}"` : ''}></video>` : '';
  return `<div class="bt-item${c.url || c.photo ? ' has-media' : ''}" data-i="${i}">${media}
    ${c.live ? '<div class="bt-live">LIVE</div>' : ''}
    <div class="bt-side">
      <div class="bt-av">${me ? '🙂' : c.av}${following ? '' : `<button class="bt-follow" data-follow="${esc(c.who)}">+</button>`}</div>
      <button class="bt-act" data-like="${i}"><span class="bt-heart${c.liked ? ' on' : ''}">❤</span><small>${fmt(c.likes)}</small></button>
      <button class="bt-act" data-comm="${i}"><span>💬</span><small>${fmt(c.comm)}</small></button>
      <button class="bt-act" data-share="${i}"><span>↗</span><small>${me ? 'Save' : fmt(c.shares)}</small></button>
      <div class="bt-disc">${c.av || '🎵'}</div>
    </div>
    <div class="bt-info"><b>@${esc(me ? (G.save.name || 'you').toLowerCase().replace(/\s+/g, '_') : c.who)}</b>${me ? ` · <span class="bt-views">${fmt(c.views)} views</span>` : ''}
      <p>${esc(c.cap)}</p><div class="bt-music"><span>🎵 ${esc(c.song || 'original sound')} · ${esc(me ? 'you' : c.who)}</span></div></div>
  </div>`;
}

let api = null;   // { back(), close(), rerender() } from the phone
export function renderBobTok(el, a, opts = {}) {
  api = a; BT.el = el; BT.active = true; BT.idx = -1;
  document.body.classList.add('bobtok');
  if (opts.draft) BT.draft = opts.draft;
  if (BT.draft) return renderPost(el);
  if (opts.screen === 'me') return renderMe(el);
  BT.feed = buildFeed();
  el.innerHTML = `<div id="bt" class="bt-feedview">
    <div class="bt-feed" id="btFeed">${BT.feed.map(itemHTML).join('') || '<div class="bt-item"><div class="bt-info"><p>Nothing to watch yet!</p></div></div>'}</div>
    <div class="bt-top"><button class="bt-back" id="btBack">‹</button><span class="bt-tab">Following</span><b class="bt-tab on">For You</b><button class="bt-x" id="btClose">✕</button></div>
    ${navHTML('home')}
    <div class="bt-sheet hidden" id="btSheet"></div>
  </div>`;
  bindCommon(el);
  const feed = el.querySelector('#btFeed');
  let tm = 0;
  feed.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(() => setActive(Math.round(feed.scrollTop / Math.max(1, feed.clientHeight))), 90); }, { passive: true });
  feed.addEventListener('pointerup', (e) => {
    if (e.target.closest('button')) return;
    const now = performance.now();
    if (now - BT.lastTap < 320) { like(BT.idx, true); heartBurst(e.clientX, e.clientY); BT.lastTap = 0; } else BT.lastTap = now;
  });
  el.querySelectorAll('[data-like]').forEach(b => b.onclick = () => like(+b.dataset.like));
  el.querySelectorAll('[data-comm]').forEach(b => b.onclick = () => openComments(+b.dataset.comm));
  el.querySelectorAll('[data-share]').forEach(b => b.onclick = () => share(+b.dataset.share));
  el.querySelectorAll('[data-follow]').forEach(b => b.onclick = (e) => { e.stopPropagation(); follow(b.dataset.follow); b.remove(); });
  setActive(0);
}
function navHTML(on) {
  return `<div class="bt-nav"><button data-bt="home" class="${on === 'home' ? 'on' : ''}">🏠<small>Home</small></button>
    <button data-bt="rec" class="bt-plus">＋</button><button data-bt="me" class="${on === 'me' ? 'on' : ''}">👤<small>Me</small></button></div>`;
}
function bindCommon(el) {
  const back = el.querySelector('#btBack'); if (back) back.onclick = () => { stopAll(); api.back(); };
  const x = el.querySelector('#btClose'); if (x) x.onclick = () => api.close();
  el.querySelectorAll('[data-bt]').forEach(b => b.onclick = () => {
    const k = b.dataset.bt;
    if (k === 'rec') startRecording();
    else if (k === 'me') { stopAll(); renderMe(BT.el); }
    else { stopAll(); renderBobTok(BT.el, api); }
  });
}
function stopAll() { if (!BT.el) return; BT.el.querySelectorAll('video').forEach(v => v.pause()); BT.clip = null; G.camOverride = null; }

function setActive(i) {
  if (i === BT.idx || !BT.el) return;
  BT.idx = i;
  const c = BT.feed[i];
  BT.el.querySelectorAll('video').forEach((v, k) => { if (v.closest('.bt-item').dataset.i != i) v.pause(); });
  if (!c) return;
  if (c.url || c.photo) {
    BT.clip = null; G.camOverride = null;
    const v = BT.el.querySelector(`.bt-item[data-i="${i}"] video`); if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    document.body.classList.remove('bt-world');
  } else {
    BT.clip = c; BT.t = 0; BT.snap = true;
    if (c.pick) c.pick();
    if (c.start) c.start();
    document.body.classList.add('bt-world');
  }
  if (c.mine) { c.views += 1; }
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
async function share(i) {
  const c = BT.feed[i]; if (!c) return;
  if (c.mine) return saveClip(c);
  c.shares++; const b = BT.el.querySelector(`[data-share="${i}"] small`); if (b) b.textContent = fmt(c.shares);
  G.toast && G.toast('↗ Shared with your Bobbly friends!', null, 1800);
}
async function saveClip(c) {
  if (!c.blob) return;
  const ext = c.photo ? 'jpg' : /mp4/.test(c.mime) ? 'mp4' : 'webm', name = `bobbly-life-${Date.now()}.${ext}`;
  // on phones, the share sheet lets you save it to your photos or send it to a friend
  try {
    const file = new File([c.blob], name, { type: c.blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My Bobbly Life clip' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = c.url || c.thumb; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  G.toast && G.toast('💾 Saved to your downloads!', 'money', 2500);
}

// ---------------------------------------------------------------- your profile
function renderMe(el) {
  const st = stats();
  BT.clip = null; G.camOverride = null; document.body.classList.remove('bt-world');
  el.innerHTML = `<div id="bt" class="bt-me">
    <div class="bt-top solid"><button class="bt-back" id="btBack">‹</button><b>@${esc((G.save.name || 'you').toLowerCase().replace(/\s+/g, '_'))}</b><button class="bt-x" id="btClose">✕</button></div>
    <div class="bt-prof"><div class="bt-bigav">🙂</div>
      <div class="bt-nums"><div><b>${fmt(st.following ? st.following.length : 0)}</b><small>Following</small></div><div><b>${fmt(st.followers)}</b><small>Followers</small></div><div><b>${fmt(st.likes)}</b><small>Likes</small></div></div>
      <p class="small">${fmt(st.views)} views · ${st.posts} videos posted · earned $${fmt(st.paid || 0)}</p>
      <button class="btn green" id="btRec2">＋ Record a video</button></div>
    <div class="bt-grid">${BT.posts.map((p, i) => `<div class="bt-thumb" data-p="${i}" style="background-image:url('${p.thumb || ''}')"><span>▶ ${fmt(p.views)}</span></div>`).join('') || '<p class="small bt-empty">No videos yet. Tap ＋ to record 10 seconds of you playing, then post it!</p>'}</div>
    <p class="small bt-note">Your videos stay until you close the game. Tap ↗ on one to save it to your device.</p>
    ${navHTML('me')}
  </div>`;
  bindCommon(el);
  el.querySelector('#btRec2').onclick = () => startRecording();
  el.querySelectorAll('[data-p]').forEach(t => t.onclick = () => {
    renderBobTok(el, api);
    const i = BT.feed.indexOf(BT.posts[+t.dataset.p]);
    if (i >= 0) { const f = el.querySelector('#btFeed'); f.scrollTop = i * f.clientHeight; setActive(i); }
  });
}

// ---------------------------------------------------------------- recording your own clip
const REC_SECONDS = 10;
function recHud() {
  let el = document.getElementById('btRec');
  if (!el) {
    el = document.createElement('div'); el.id = 'btRec';
    el.innerHTML = '<span class="dot"></span><b id="btRecT">REC</b><button id="btRecStop">■ Stop</button>';
    document.body.appendChild(el);
    el.querySelector('#btRecStop').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); stopRecording(); });
  }
  return el;
}
export function startRecording() {
  if (BT.rec) return;
  stopAll();
  api && api.close();
  const canvas = G.renderer.domElement;
  const rec = { t: REC_SECONDS, t0: performance.now(), chunks: [], thumb: null, recorder: null, mime: '', blob: null };
  BT.rec = rec;
  // a cover picture for the video, grabbed straight after the next frame is drawn
  G.afterRender = (c) => { rec.thumb = snap(c); G.afterRender = null; };
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  if (window.MediaRecorder && canvas.captureStream) {
    try {
      const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
      const r = new MediaRecorder(canvas.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined);
      r.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      r.onstop = () => finishRecording(rec);
      r.start(250); rec.recorder = r; rec.mime = r.mimeType || mime;
    } catch (e) { rec.recorder = null; }
  }
  if (!rec.recorder) { rec.t = 0.6; G.toast && G.toast('📸 Video recording isn\'t supported in this browser, so BobTok takes a photo instead!', null, 4000); }
  const h = recHud(); h.classList.add('on'); h.classList.toggle('photo', !rec.recorder);
  sfx.pop && sfx.pop();
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
  if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop(); else finishRecording(rec);
}
function finishRecording(rec) {
  const h = document.getElementById('btRec'); if (h) h.classList.remove('on');
  BT.rec = null;
  let blob = null, url = null, photo = false;
  if (rec.chunks.length) { blob = new Blob(rec.chunks, { type: rec.mime || 'video/webm' }); url = URL.createObjectURL(blob); }
  else if (rec.thumb) { photo = true; blob = dataToBlob(rec.thumb); }
  if (!blob) { G.toast && G.toast('Recording failed, try again!', 'bad'); return; }
  BT.draft = { mine: true, url, blob, mime: rec.mime, photo, thumb: rec.thumb, cap: pick(CAPS) + ' ' + [pick(TAGS), pick(TAGS)].filter((v, i, a) => a.indexOf(v) === i).join(' '), song: 'original sound' };
  G.openPhoneApp && G.openPhoneApp('bobtok');
}
function dataToBlob(d) { const [h, b] = d.split(','), bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: h.slice(5, h.indexOf(';')) }); }
function renderPost(el) {
  const d = BT.draft;
  BT.clip = null; G.camOverride = null; document.body.classList.remove('bt-world');
  el.innerHTML = `<div id="bt" class="bt-post">
    <div class="bt-top solid"><button class="bt-back" id="btDiscard">✕</button><b>New video</b><span></span></div>
    <div class="bt-prev">${d.photo ? `<img src="${d.thumb}">` : `<video src="${d.url}" autoplay loop muted playsinline></video>`}</div>
    <label class="lbl">Caption</label>
    <textarea id="btCap" maxlength="120" rows="2">${esc(d.cap)}</textarea>
    <div class="bt-post-btns"><button class="btn gray" id="btSave">↗ Save / share</button><button class="btn green" id="btPost">Post 🚀</button></div>
    <p class="small">Posting to BobTok only shares it inside the game. "Save / share" puts it on your device.</p>
  </div>`;
  el.querySelector('#btCap').addEventListener('keydown', (e) => e.stopPropagation());
  el.querySelector('#btDiscard').onclick = () => { if (d.url) URL.revokeObjectURL(d.url); BT.draft = null; renderBobTok(el, api); };
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
  // how far it'll go: mostly small, sometimes it blows up
  const viral = clamp(Math.exp((Math.random() + Math.random() + Math.random() - 1.5) * 1.6), 0.25, 14);
  Object.assign(d, { views: 0, likes: 0, comm: 0, shares: 0, liked: false, fans: [], age: 0, viral, ratio: rand(0.06, 0.16), next: 100, mineAv: '🙂' });
  BT.posts.unshift(d);
  st.posts++; writeSave();
  G.toast && G.toast('🎉 Posted to BobTok! Watch the views come in.', 'money', 3500);
}

// ---------------------------------------------------------------- every frame
const MILESTONES = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
export function updateBobTok(dt) {
  // recording countdown
  if (BT.rec && !BT.rec.stopping) {
    BT.rec.t = (BT.rec.recorder ? REC_SECONDS : 0.6) - (performance.now() - BT.rec.t0) / 1000;   // real seconds (the video is real time)
    const t = document.getElementById('btRecT'); if (t) t.textContent = BT.rec.recorder ? `REC 0:${String(Math.max(0, Math.ceil(BT.rec.t))).padStart(2, '0')}` : '📸';
    if (BT.rec.t <= 0) stopRecording();
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
  // is the BobTok feed still on screen?
  const open = BT.active && G.ui.panel && G.ui.phoneApp === 'bobtok' && document.contains(BT.el && BT.el.querySelector('#bt'));
  if (!open) {
    if (BT.active) { BT.active = false; BT.clip = null; G.camOverride = null; document.body.classList.remove('bobtok', 'bt-world'); if (BT.el) BT.el.querySelectorAll('video').forEach(v => v.pause()); }
    return;
  }
  filmClip(dt);
}
// the drone camera for whatever video is showing
function filmClip(dt) {
  const c = BT.clip; if (!c) return;
  BT.t += dt;
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
  else BT.cam.pos.lerp(want, c.style === 'pov' ? 1 : 1 - Math.exp(-dt * 3));
  G.camOverride = BT.cam;
}

// arrow keys / W S / mouse wheel scroll the feed on computers
addEventListener('keydown', (e) => {
  if (!BT.active || !BT.el || BT.draft) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const f = BT.el.querySelector('#btFeed'); if (!f) return;
  const d = { ArrowDown: 1, KeyS: 1, PageDown: 1, ArrowUp: -1, KeyW: -1, PageUp: -1 }[e.code];
  if (d) { e.preventDefault(); f.scrollTo({ top: clamp(BT.idx + d, 0, BT.feed.length - 1) * f.clientHeight, behavior: 'smooth' }); }
  if (e.code === 'KeyL' || e.code === 'Space') { e.preventDefault(); like(BT.idx); }
});
