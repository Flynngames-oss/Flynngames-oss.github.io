// Sky Room: a shared floating island. Every player simulates their own movement and
// sends it ~15 times a second; everyone else smooths it. Shoves go straight to the
// player who got shoved, and the host keeps the scoreboard.
import * as THREE from 'three';
import { createNet } from './net.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ff5a5f', '#ff9f1c', '#ffd23f', '#3ddc84', '#2ec4b6', '#4f6bff', '#9b5de5', '#f15bb5'];
const ISLAND_R = 16;
const GRAVITY = 30, JUMP_V = 11, SPEED = 8, RADIUS = 0.6;
const SHOVE_RANGE = 2.4, SHOVE_COOLDOWN = 0.7, SHOVE_PUSH = 15, SHOVE_LIFT = 7;
const SEND_HZ = 15, KO_CREDIT_MS = 6000;
// solid crates on the island: x, z, half width x, half width z, top height
const BOXES = [
  [6, 4, 1.5, 1.5, 1.2], [-7, -3, 2, 1.2, 1.2], [-2, 8, 1.2, 1.2, 1.2], [-2, 8 - 2.6, 1.2, 1.2, 2.4], [3, -8, 2.5, 1, 1.2],
];

// ------------------------------------------------------------------ menu
const params = new URLSearchParams(location.search);
let myName = localStorage.getItem('skyroom-name') || '';
let myColor = localStorage.getItem('skyroom-color') || COLORS[Math.floor(Math.random() * COLORS.length)];
$('name').value = myName;
if (params.get('room')) $('code').value = params.get('room').toUpperCase();
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch' + (c === myColor ? ' on' : ''); b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
  b.onclick = () => { myColor = c; document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s === b)); };
  $('swatches').appendChild(b);
}
const status = (t, err) => { $('status').textContent = t; $('status').classList.toggle('err', !!err); };
const menuButtons = (on) => ['joinBtn', 'hostBtn', 'soloBtn'].forEach(id => { $(id).disabled = !on; });
function readName() {
  myName = ($('name').value.trim() || 'Player').slice(0, 14);
  try { localStorage.setItem('skyroom-name', myName); localStorage.setItem('skyroom-color', myColor); } catch (e) { /* ignore */ }
}

const net = createNet({ app: 'skyroom', onMessage, onLeave: removeRemote, onDisconnected });

$('hostBtn').onclick = async () => {
  readName(); menuButtons(false);
  try { const code = await net.host(t => status(t)); start(code); } catch (e) { status(e.message, true); menuButtons(true); }
};
$('joinBtn').onclick = async () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 5) { status('Room codes are 5 letters.', true); return; }
  readName(); menuButtons(false);
  try { await net.join(code, t => status(t)); start(code); } catch (e) { status(e.message, true); menuButtons(true); }
};
$('soloBtn').onclick = () => { readName(); start(''); };
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('copyBtn').onclick = () => {
  const url = location.origin + location.pathname + '?room=' + net.code;
  navigator.clipboard?.writeText(url).then(() => { $('copyBtn').textContent = 'Copied!'; setTimeout(() => { $('copyBtn').textContent = 'Copy invite link'; }, 1500); });
};

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8ec9ff');
scene.fog = new THREE.Fog('#8ec9ff', 40, 110);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight('#ffffff', '#5a7a9a', 1.1));
const sun = new THREE.DirectionalLight('#fff4dd', 1.6);
sun.position.set(15, 30, 10); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
scene.add(sun);

// island: grass top, dirt rim, rocky underside
const island = new THREE.Group();
const top = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R, 1, 48), new THREE.MeshLambertMaterial({ color: '#5cc85a' }));
top.position.y = -0.5; top.receiveShadow = true;
const rim = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R + 0.05, ISLAND_R - 0.6, 1.4, 48), new THREE.MeshLambertMaterial({ color: '#8a5a3c' }));
rim.position.y = -1.5;
const under = new THREE.Mesh(new THREE.ConeGeometry(ISLAND_R - 0.6, 14, 24), new THREE.MeshLambertMaterial({ color: '#6b6f7a', flatShading: true }));
under.rotation.x = Math.PI; under.position.y = -9.2;
island.add(top, rim, under);
scene.add(island);
const crateMat = new THREE.MeshLambertMaterial({ color: '#d9a066' });
for (const [x, z, hx, hz, h] of BOXES) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, h, hz * 2), crateMat);
  m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
// distant islands and clouds, just for looks
const rockMat = new THREE.MeshLambertMaterial({ color: '#6b6f7a', flatShading: true });
for (let i = 0; i < 9; i++) {
  const a = i / 9 * Math.PI * 2 + 0.3, d = 45 + (i % 3) * 15, r = 3 + (i % 4) * 1.5;
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.8, 16), new THREE.MeshLambertMaterial({ color: '#5cc85a' }));
  const u = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.5, 10), rockMat);
  u.rotation.x = Math.PI; u.position.y = -r * 1.25 - 0.4;
  g.add(t, u); g.position.set(Math.cos(a) * d, -6 + (i % 5) * 4, Math.sin(a) * d);
  scene.add(g);
}
const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
for (let i = 0; i < 18; i++) {
  const c = new THREE.Group();
  for (let j = 0; j < 4; j++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2, 10, 8), cloudMat);
    s.position.set(j * 2.4, Math.random(), Math.random() * 1.5);
    c.add(s);
  }
  const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 60;
  c.position.set(Math.cos(a) * d, -25 + Math.random() * 40, Math.sin(a) * d);
  scene.add(c);
}

// ------------------------------------------------------------------ players
function nameTag(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(text, 128, 32);
  g.fillStyle = '#fff'; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  s.scale.set(2.4, 0.6, 1); s.position.y = 2.4; s.renderOrder = 10;
  return s;
}
function makeAvatar(name, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.6, 6, 14), mat);
  body.position.y = 0.85; body.castShadow = true;
  const eyeW = new THREE.MeshBasicMaterial({ color: '#fff' }), eyeB = new THREE.MeshBasicMaterial({ color: '#111' });
  for (const sx of [-0.2, 0.2]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), eyeW); w.position.set(sx, 1.2, 0.47);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eyeB); p.position.set(sx, 1.2, 0.59);
    g.add(w, p);
  }
  const arms = new THREE.Group();
  for (const sx of [-0.62, 0.62]) {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat); a.position.set(sx, 0.8, 0.1); a.castShadow = true;
    arms.add(a);
  }
  g.add(body, arms);
  const tag = nameTag(name); g.add(tag);
  scene.add(g);
  return { group: g, body, arms, tag, name, color };
}
function retag(a, name) { a.group.remove(a.tag); a.tag.material.map.dispose(); a.tag = nameTag(name); a.group.add(a.tag); a.name = name; }
// arms punch forward for a moment after a shove; body squashes when landing/moving
function animateAvatar(a, shoveAge, speed, t) {
  const k = shoveAge < 0.25 ? Math.sin(shoveAge / 0.25 * Math.PI) : 0;
  a.arms.position.z = k * 0.6;
  const bob = Math.sin(t * 14) * Math.min(speed / SPEED, 1) * 0.06;
  a.body.scale.set(1 - bob, 1 + bob, 1 - bob);
}

const me = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0, onGround: false,
  shoveCd: 0, lastShove: -9, stun: 0, hitBy: '', hitAt: 0, avatar: null,
};
const remotes = new Map();   // id -> { avatar, target, vel, at, facing, shove, shoveAt }
const scores = new Map();    // id -> { name, color, ko }  (host is the source of truth)
let started = false, clock = 0;

function spawn() {
  const a = Math.random() * Math.PI * 2, d = Math.random() * (ISLAND_R - 4);
  me.pos.set(Math.cos(a) * d, 4, Math.sin(a) * d);
  me.vel.set(0, 0, 0); me.stun = 0; me.hitBy = ''; me.facing = yaw + Math.PI;
}
function start(code) {
  started = true;
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (code) $('roomCode').textContent = code; else $('room').classList.add('hidden');
  if (matchMedia('(pointer: coarse)').matches) { $('touch').classList.remove('hidden'); $('help').classList.add('hidden'); }
  me.avatar = makeAvatar(myName, myColor); me.avatar.tag.visible = false;
  scores.set(net.mode === 'solo' ? 'me' : net.id, { name: myName, color: myColor, ko: 0 });
  spawn(); drawBoard();
  if (net.mode !== 'solo') feed(net.mode === 'host' ? 'Room open! Share the code with friends.' : 'Joined the room!');
}

// ------------------------------------------------------------------ input
const keys = new Set();
let yaw = 0, pitch = 0.35, jumpQueued = false, shoveQueued = false;
const stick = { x: 0, y: 0 };
addEventListener('keydown', e => {
  if (!started || e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyF') shoveQueued = true;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// drag anywhere on the canvas to look around; a click without much drag is a shove
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; });
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  yaw -= dx * 0.006; pitch = Math.max(-0.2, Math.min(1.2, pitch + dy * 0.004));
});
addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved < 6 && e.pointerType === 'mouse' && started) shoveQueued = true;
  drag = null;
});
// touch joystick
const stickEl = $('stick'), knob = $('knob');
let stickId = null;
function stickMove(e) {
  const r = stickEl.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  stick.x = x; stick.y = y;
  knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
}
stickEl.addEventListener('pointerdown', e => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); e.stopPropagation(); });
stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
const stickUp = (e) => { if (e.pointerId !== stickId) return; stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; };
stickEl.addEventListener('pointerup', stickUp); stickEl.addEventListener('pointercancel', stickUp);
$('tjump').addEventListener('pointerdown', e => { jumpQueued = true; e.stopPropagation(); });
$('tshove').addEventListener('pointerdown', e => { shoveQueued = true; e.stopPropagation(); });

// ------------------------------------------------------------------ local physics
function groundAt(x, z, y) {
  let g = Math.hypot(x, z) <= ISLAND_R ? 0 : -Infinity;
  for (const [bx, bz, hx, hz, h] of BOXES) {
    if (Math.abs(x - bx) <= hx + RADIUS * 0.5 && Math.abs(z - bz) <= hz + RADIUS * 0.5 && y >= h - 0.35) g = Math.max(g, h);
  }
  return g;
}
function pushOutOfBoxes(p) {
  for (const [bx, bz, hx, hz, h] of BOXES) {
    if (p.y >= h - 0.35 || p.y + 1.6 < 0) continue;
    const dx = p.x - bx, dz = p.z - bz, ox = hx + RADIUS - Math.abs(dx), oz = hz + RADIUS - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) { p.x += Math.sign(dx) * ox; me.vel.x = 0; } else { p.z += Math.sign(dz) * oz; me.vel.z = 0; }
  }
}
function stepMe(dt) {
  // input, relative to the camera
  let ix = stick.x, iz = stick.y;
  if (keys.has('KeyA')) ix -= 1; if (keys.has('KeyD')) ix += 1;
  if (keys.has('KeyW')) iz -= 1; if (keys.has('KeyS')) iz += 1;
  if (keys.has('ArrowLeft')) yaw += 2.2 * dt; if (keys.has('ArrowRight')) yaw -= 2.2 * dt;
  if (keys.has('ArrowUp')) iz -= 1; if (keys.has('ArrowDown')) iz += 1;
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const wx = ix * cos + iz * sin, wz = -ix * sin + iz * cos;
  if (il > 0.1) me.facing = Math.atan2(wx, wz);

  // steer toward the wanted velocity; much weaker in the air or right after being shoved,
  // so a shove actually carries you
  me.stun = Math.max(0, me.stun - dt);
  const rate = me.stun > 0 ? 0.4 : me.onGround ? 14 : 3;
  const f = 1 - Math.exp(-rate * dt);
  me.vel.x += (wx * SPEED - me.vel.x) * f;
  me.vel.z += (wz * SPEED - me.vel.z) * f;
  if (jumpQueued && me.onGround) { me.vel.y = JUMP_V; me.onGround = false; sfx('jump'); }
  jumpQueued = false;
  me.vel.y -= GRAVITY * dt;

  me.pos.addScaledVector(me.vel, dt);
  pushOutOfBoxes(me.pos);
  const g = groundAt(me.pos.x, me.pos.z, me.pos.y);
  if (me.pos.y <= g && me.vel.y <= 0 && me.pos.y > g - 1.2) { me.pos.y = g; me.vel.y = 0; me.onGround = true; } else me.onGround = me.pos.y <= g + 0.01 && g > -Infinity;

  // shove whoever is in front of you
  me.shoveCd = Math.max(0, me.shoveCd - dt);
  if (shoveQueued && me.shoveCd === 0) {
    me.shoveCd = SHOVE_COOLDOWN; me.lastShove = clock; sfx('whoosh');
    const fx = Math.sin(me.facing), fz = Math.cos(me.facing);
    for (const [id, r] of remotes) {
      const dx = r.avatar.group.position.x - me.pos.x, dz = r.avatar.group.position.z - me.pos.z, dy = r.avatar.group.position.y - me.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > SHOVE_RANGE || Math.abs(dy) > 1.6) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < 0.35) continue;   // must be roughly in front
      const nx = d > 0.3 ? dx / d : fx, nz = d > 0.3 ? dz / d : fz;
      net.send({ t: 'hit', to: id, x: +(nx * SHOVE_PUSH).toFixed(2), z: +(nz * SHOVE_PUSH).toFixed(2), y: SHOVE_LIFT });
      sfx('hit');
    }
  }
  shoveQueued = false;

  // fell off the island
  if (me.pos.y < -30) {
    const by = me.hitBy && Date.now() - me.hitAt < KO_CREDIT_MS ? me.hitBy : '';
    sendOrApply({ t: 'ko', by });
    sfx('fall');
    spawn();
  }
}

// ------------------------------------------------------------------ networking
// send to everyone else, and handle it here too (the host never echoes a message back to its sender)
function sendOrApply(msg) {
  net.send(msg);
  onMessage({ ...msg, from: net.mode === 'solo' ? 'me' : net.id });
}
let sendTimer = 0;
function sendPos(dt) {
  if (net.mode === 'solo') return;
  sendTimer -= dt;
  if (sendTimer > 0) return;
  sendTimer = 1 / SEND_HZ;
  const r = (v) => Math.round(v * 100) / 100;
  net.send({ t: 'p', x: r(me.pos.x), y: r(me.pos.y), z: r(me.pos.z), vx: r(me.vel.x), vy: r(me.vel.y), vz: r(me.vel.z), f: r(me.facing), s: r(clock - me.lastShove), n: myName, c: myColor });
}
function onMessage(m) {
  if (m.t === 'p') {
    let r = remotes.get(m.from);
    if (!r) {
      r = { avatar: makeAvatar(String(m.n || 'Player').slice(0, 14), String(m.c || '#ffffff')), target: new THREE.Vector3(m.x, m.y, m.z), vel: new THREE.Vector3(), at: 0, facing: 0, shoveAge: 9 };
      r.avatar.group.position.copy(r.target);
      remotes.set(m.from, r);
      feed(`${r.avatar.name} joined`);
    }
    if (m.n && m.n !== r.avatar.name) retag(r.avatar, String(m.n).slice(0, 14));
    r.target.set(+m.x || 0, +m.y || 0, +m.z || 0); r.vel.set(+m.vx || 0, +m.vy || 0, +m.vz || 0);
    r.facing = +m.f || 0; r.shoveAge = +m.s; r.at = performance.now();
    if (net.mode === 'host' && !scores.has(m.from)) { scores.set(m.from, { name: r.avatar.name, color: r.avatar.color, ko: 0 }); broadcastScores(); }
    else if (net.mode === 'host') { const s = scores.get(m.from); if (s.name !== r.avatar.name) { s.name = r.avatar.name; broadcastScores(); } }
  } else if (m.t === 'hit' && m.to === net.id) {
    me.vel.set(+m.x || 0, +m.y || 0, +m.z || 0); me.onGround = false; me.stun = 0.45;
    me.hitBy = m.from; me.hitAt = Date.now(); sfx('hit');
  } else if (m.t === 'ko') {
    handleKo(m);
  } else if (m.t === 'scores' && net.mode === 'client') {
    scores.clear();
    for (const [id, name, color, ko] of m.s || []) scores.set(id, { name: String(name), color: String(color), ko: +ko || 0 });
    drawBoard();
  }
}
function nameOf(id) {
  if (id === net.id || id === 'me') return myName;
  return remotes.get(id)?.avatar.name || scores.get(id)?.name || 'Someone';
}
function handleKo(m) {
  const who = nameOf(m.from);
  if (m.by) feed(`${nameOf(m.by)} shoved ${who} off!`);
  else feed(`${who} fell off`);
  if (net.mode === 'host' && m.by && scores.has(m.by)) { scores.get(m.by).ko++; broadcastScores(); }
}
let scoreTimer = 0;
function broadcastScores() {
  drawBoard();
  if (net.mode !== 'host') return;
  scoreTimer = 2;
  net.send({ t: 'scores', s: [...scores].map(([id, s]) => [id, s.name, s.color, s.ko]) });
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (r) { scene.remove(r.avatar.group); remotes.delete(id); feed(`${r.avatar.name} left`); }
  if (scores.delete(id)) broadcastScores();
}
function onDisconnected() {
  $('banner').textContent = 'The host left the room';
  for (const id of [...remotes.keys()]) removeRemote(id);
  net.mode = 'solo';
}

// ------------------------------------------------------------------ HUD + sound
function drawBoard() {
  const myId = net.mode === 'solo' ? 'me' : net.id;
  const rows = [...scores].sort((a, b) => b[1].ko - a[1].ko);
  const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('board').innerHTML = `<div style="opacity:.8;font-size:12px;margin-bottom:4px">${rows.length} on the island · shove-offs</div>` +
    rows.map(([id, s]) => `<div class="p${id === myId ? ' me' : ''}"><span class="dot" style="background:${esc(s.color)}"></span><span class="n">${esc(s.name)}</span><span>${s.ko}</span></div>`).join('');
}
function feed(text) {
  const d = document.createElement('div'); d.textContent = text;
  $('feed').appendChild(d);
  setTimeout(() => d.remove(), 4000);
  while ($('feed').children.length > 5) $('feed').firstChild.remove();
}
let actx = null;
function sfx(kind) {
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    const set = { jump: [300, 600, 0.12, 'sine'], whoosh: [500, 180, 0.12, 'triangle'], hit: [160, 60, 0.18, 'square'], fall: [700, 120, 0.6, 'sine'] }[kind];
    o.type = set[3]; o.frequency.setValueAtTime(set[0], t); o.frequency.exponentialRampToValueAtTime(set[1], t + set[2]);
    g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + set[2]);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + set[2]);
  } catch (e) { /* no audio */ }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
const camTarget = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  if (started) {
    stepMe(dt);
    sendPos(dt);
    if (net.mode === 'host') { scoreTimer -= dt; if (scoreTimer <= 0) broadcastScores(); }
    const a = me.avatar;
    a.group.position.copy(me.pos);
    a.group.rotation.y = me.facing;
    animateAvatar(a, clock - me.lastShove, Math.hypot(me.vel.x, me.vel.z), clock);
    // remote players: aim a little ahead using their velocity, then ease toward it
    for (const [, r] of remotes) {
      const age = Math.min((performance.now() - r.at) / 1000, 0.25);
      const p = r.avatar.group.position;
      const tx = r.target.x + r.vel.x * age, ty = r.target.y + r.vel.y * age, tz = r.target.z + r.vel.z * age;
      if (Math.hypot(tx - p.x, ty - p.y, tz - p.z) > 6) p.set(tx, ty, tz);
      else { const k = 1 - Math.exp(-12 * dt); p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.z += (tz - p.z) * k; }
      let dr = r.facing - r.avatar.group.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      r.avatar.group.rotation.y += dr * (1 - Math.exp(-15 * dt));
      r.shoveAge += dt;
      animateAvatar(r.avatar, r.shoveAge, Math.hypot(r.vel.x, r.vel.z), clock);
    }
    // third-person camera
    camTarget.lerp(new THREE.Vector3(me.pos.x, Math.max(me.pos.y, -8) + 1.4, me.pos.z), 1 - Math.exp(-10 * dt));
    const dist = 9;
    camera.position.set(camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(camTarget);
  } else {
    camera.position.set(Math.sin(clock * 0.1) * 30, 14, Math.cos(clock * 0.1) * 30);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// test hook for automated checks
window.__skyroom = { net, me, remotes, scores };
