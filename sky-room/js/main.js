// Sky Room: a shared sandbox island. Build and break blocks together.
//
// Every player simulates their own movement and sends it ~15 times a second; everyone
// else smooths it. The HOST owns the world: players ask the host to place or break a
// block, the host checks it and tells everyone. New players get a full copy when they
// arrive, and the host's island is saved in their browser for next time.
import * as THREE from 'three';
import { createNet } from './net.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ff5a5f', '#ff9f1c', '#ffd23f', '#3ddc84', '#2ec4b6', '#4f6bff', '#9b5de5', '#f15bb5'];
// block types: name, colour, see-through?
const BLOCKS = [
  ['Grass', '#7fdc6e'], ['Dirt', '#8a5a3c'], ['Stone', '#9aa0aa'], ['Wood', '#c98a4b'], ['Leaves', '#2f9e44'],
  ['White', '#f4f4f4'], ['Red', '#e5484d'], ['Blue', '#3e63dd'], ['Gold', '#ffc53d'], ['Glass', '#bfe6ff', true],
];
const ISLAND_R = 16, LIMIT = 40, MIN_Y = -12, MAX_Y = 40, MAX_BLOCKS = 4000;
const GRAVITY = 30, JUMP_V = 10.5, SPEED = 7, RADIUS = 0.32, HEIGHT = 1.6, REACH = 12;
const SEND_HZ = 15;
const SAVE_KEY = 'skyroom-world-v1';

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

const net = createNet({ app: 'skyroom', onMessage, onLeave: removeRemote, onDisconnected, hostOnly: ['b', 'set', 'world'] });

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
scene.fog = new THREE.Fog('#8ec9ff', 50, 130);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight('#ffffff', '#5a7a9a', 1.1));
const sun = new THREE.DirectionalLight('#fff4dd', 1.6);
sun.position.set(15, 30, 10); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26 });
scene.add(sun);

// island: grass top, dirt rim, rocky underside
const islandTop = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R, 1, 64), new THREE.MeshLambertMaterial({ color: '#5cc85a' }));
islandTop.position.y = -0.5; islandTop.receiveShadow = true;
const rim = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R + 0.05, ISLAND_R - 0.6, 1.4, 64), new THREE.MeshLambertMaterial({ color: '#8a5a3c' }));
rim.position.y = -1.5;
const under = new THREE.Mesh(new THREE.ConeGeometry(ISLAND_R - 0.6, 14, 24), new THREE.MeshLambertMaterial({ color: '#6b6f7a', flatShading: true }));
under.rotation.x = Math.PI; under.position.y = -9.2;
scene.add(islandTop, rim, under);
// distant islands and clouds, just for looks
const rockMat = new THREE.MeshLambertMaterial({ color: '#6b6f7a', flatShading: true });
for (let i = 0; i < 9; i++) {
  const a = i / 9 * Math.PI * 2 + 0.3, d = 55 + (i % 3) * 15, r = 3 + (i % 4) * 1.5;
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
  const a = Math.random() * Math.PI * 2, d = 45 + Math.random() * 50;
  c.position.set(Math.cos(a) * d, -25 + Math.random() * 40, Math.sin(a) * d);
  scene.add(c);
}

// ------------------------------------------------------------------ the world (blocks)
// Cell (x, y, z) fills the cube from (x, y, z) to (x+1, y+1, z+1). The island surface is y = 0.
const world = new Map();   // "x,y,z" -> block type index
const meshes = new Map();  // "x,y,z" -> mesh
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const blockMats = BLOCKS.map(([, c, glass]) => new THREE.MeshLambertMaterial(glass ? { color: c, transparent: true, opacity: 0.45 } : { color: c }));
const key = (x, y, z) => x + ',' + y + ',' + z;
const solid = (x, y, z) => world.has(key(x, y, z));
const inBounds = (x, y, z) => Math.abs(x) <= LIMIT && Math.abs(z) <= LIMIT && y >= MIN_Y && y <= MAX_Y;

function setBlock(x, y, z, type) {
  const k = key(x, y, z);
  const old = meshes.get(k);
  if (old) { scene.remove(old); meshes.delete(k); }
  if (type == null || !(type >= 0 && type < BLOCKS.length)) { world.delete(k); return; }
  world.set(k, type);
  const m = new THREE.Mesh(boxGeo, blockMats[type]);
  m.position.set(x + 0.5, y + 0.5, z + 0.5);
  m.castShadow = !BLOCKS[type][2]; m.receiveShadow = true;
  m.userData.cell = [x, y, z];
  scene.add(m); meshes.set(k, m);
}
function clearWorld() { for (const k of [...world.keys()]) { const [x, y, z] = k.split(',').map(Number); setBlock(x, y, z, null); } }
function worldList() { return [...world].map(([k, t]) => [...k.split(',').map(Number), t]); }
function loadList(list) { clearWorld(); for (const b of list || []) if (Array.isArray(b) && inBounds(b[0], b[1], b[2])) setBlock(b[0] | 0, b[1] | 0, b[2] | 0, b[3] | 0); }
function starterWorld() {
  clearWorld();
  // a little tree and a few steps, so there's something to look at
  for (let y = 0; y < 3; y++) setBlock(5, y, 3, 3);
  for (let x = 4; x <= 6; x++) for (let z = 2; z <= 4; z++) for (let y = 3; y <= 4; y++) if (!(y === 4 && (x !== 5 && z !== 3))) setBlock(x, y, z, 4);
  for (let i = 0; i < 4; i++) for (let h = 0; h <= i; h++) setBlock(-6 + i, h, -5, 2);
}
let saveTimer = null;
function saveSoon() {
  if (net.mode === 'client') return;   // only the host (or solo player) keeps the island
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(worldList())); } catch (e) { /* full or blocked */ } }, 800);
}
function loadSaved() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (Array.isArray(s)) { loadList(s); return; } } catch (e) { /* ignore */ }
  starterWorld();
}

// ------------------------------------------------------------------ players
function nameTag(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(text, 128, 32);
  g.fillStyle = '#fff'; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  s.scale.set(2.4, 0.6, 1); s.position.y = 2.2; s.renderOrder = 10;
  return s;
}
function makeAvatar(name, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 14), mat);
  body.position.y = 0.72; body.castShadow = true;
  const eyeW = new THREE.MeshBasicMaterial({ color: '#fff' }), eyeB = new THREE.MeshBasicMaterial({ color: '#111' });
  for (const sx of [-0.12, 0.12]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), eyeW); w.position.set(sx, 1.18, 0.27);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeB); p.position.set(sx, 1.18, 0.35);
    g.add(w, p);
  }
  const arms = new THREE.Group();
  for (const sx of [-0.4, 0.4]) {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat); a.position.set(sx, 0.7, 0.05); a.castShadow = true;
    arms.add(a);
  }
  g.add(body, arms);
  const tag = nameTag(name); g.add(tag);
  scene.add(g);
  return { group: g, body, arms, tag, name, color };
}
function retag(a, name) { a.group.remove(a.tag); a.tag.material.map.dispose(); a.tag = nameTag(name); a.group.add(a.tag); a.name = name; }
// arms reach forward for a moment after placing or breaking; body bobs when walking
function animateAvatar(a, actAge, speed, t) {
  a.arms.position.z = actAge < 0.25 ? Math.sin(actAge / 0.25 * Math.PI) * 0.35 : 0;
  const bob = Math.sin(t * 14) * Math.min(speed / SPEED, 1) * 0.06;
  a.body.scale.set(1 - bob, 1 + bob, 1 - bob);
}

const me = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0, onGround: false, lastAct: -9, avatar: null };
const remotes = new Map();   // id -> { avatar, target, vel, at, facing, actAge }
let started = false, clock = 0;

function spawn() {
  const a = Math.random() * Math.PI * 2, d = Math.random() * (ISLAND_R - 6);
  me.pos.set(Math.cos(a) * d, 3, Math.sin(a) * d);
  me.vel.set(0, 0, 0); me.facing = yaw + Math.PI;
}
function start(code) {
  started = true;
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (code) $('roomCode').textContent = code; else $('room').classList.add('hidden');
  if (net.mode === 'client') $('resetBtn').classList.add('hidden');
  if (matchMedia('(pointer: coarse)').matches) { $('touch').classList.remove('hidden'); $('help').classList.add('hidden'); }
  me.avatar = makeAvatar(myName, myColor); me.avatar.tag.visible = false;
  if (net.mode !== 'client') loadSaved();   // joiners get the host's world instead
  spawn(); drawPlayers();
  if (net.mode === 'host') feed('Room open! Share the code with friends.');
  if (net.mode === 'client') feed('Joined! Loading the island...');
}

// ------------------------------------------------------------------ build tools
let selected = 0, mode = 'build';
function drawHotbar() {
  $('hotbar').innerHTML = '';
  BLOCKS.forEach(([name, c], i) => {
    const b = document.createElement('button');
    b.className = 'slot' + (i === selected && mode === 'build' ? ' on' : ''); b.title = name;
    b.innerHTML = `<span style="background:${c}"></span><small>${(i + 1) % 10}</small>`;
    b.onclick = () => { selected = i; setMode('build'); };
    $('hotbar').appendChild(b);
  });
  const brk = document.createElement('button');
  brk.className = 'slot break' + (mode === 'break' ? ' on' : ''); brk.title = 'Break (or right-click)';
  brk.innerHTML = '<span>⛏</span><small>Q</small>';
  brk.onclick = () => setMode(mode === 'break' ? 'build' : 'break');
  $('hotbar').appendChild(brk);
}
function setMode(m) { mode = m; drawHotbar(); }
drawHotbar();

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
// what's under the pointer: the cell a new block would go in, and the block you'd break
function aim(clientX, clientY) {
  ndc.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 40;
  const hits = raycaster.intersectObjects([...meshes.values(), islandTop], false);
  for (const h of hits) {
    if (h.point.distanceTo(me.pos) > REACH) return null;
    if (h.object === islandTop) {
      if (h.face.normal.y < 0.5) continue;
      return { place: [Math.floor(h.point.x), 0, Math.floor(h.point.z)], hit: null };
    }
    const [x, y, z] = h.object.userData.cell;
    const n = h.face.normal;
    return { place: [x + Math.round(n.x), y + Math.round(n.y), z + Math.round(n.z)], hit: [x, y, z] };
  }
  return null;
}
function overlapsPlayer(x, y, z, p) {
  return x < p.x + RADIUS && x + 1 > p.x - RADIUS && z < p.z + RADIUS && z + 1 > p.z - RADIUS && y < p.y + HEIGHT && y + 1 > p.y;
}
function act(clientX, clientY, breaking) {
  const a = aim(clientX, clientY);
  if (!a) return;
  if (breaking) {
    if (!a.hit) return;
    request(a.hit, null);
  } else {
    const [x, y, z] = a.place;
    if (!inBounds(x, y, z) || solid(x, y, z) || overlapsPlayer(x, y, z, me.pos)) return;
    for (const [, r] of remotes) if (overlapsPlayer(x, y, z, r.avatar.group.position)) return;
    request(a.place, selected);
  }
  me.lastAct = clock;
}
// apply right away so it feels instant; the host has the final say and tells everyone
function request([x, y, z], type) {
  setBlock(x, y, z, type);
  sfx(type == null ? 'break' : 'place');
  if (net.mode === 'client') net.send({ t: 'b', x, y, z, b: type });
  else { saveSoon(); net.send({ t: 'set', x, y, z, b: type }); }
}
function hostApply(m) {
  const x = m.x | 0, y = m.y | 0, z = m.z | 0;
  const type = m.b == null ? null : m.b | 0;
  if (!inBounds(x, y, z)) return;
  if (type != null && (type < 0 || type >= BLOCKS.length || world.size >= MAX_BLOCKS)) { net.send({ t: 'set', to: m.from, x, y, z, b: world.get(key(x, y, z)) ?? null }); return; }
  setBlock(x, y, z, type);
  saveSoon();
  net.send({ t: 'set', x, y, z, b: type });   // to everyone, including whoever asked
}

// highlight box showing where your click will land
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false }));
const ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(ghost.geometry), new THREE.LineBasicMaterial({ color: '#ffffff' }));
ghost.add(ghostEdges); ghost.visible = false; scene.add(ghost);
let hover = null;
function updateGhost() {
  if (!hover || !started) { ghost.visible = false; return; }
  const a = aim(hover.x, hover.y);
  const cell = a && (mode === 'break' ? a.hit : a.place);
  ghost.visible = !!cell;
  if (!cell) return;
  ghost.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
  const c = mode === 'break' ? '#ff4d4f' : BLOCKS[selected][1];
  ghost.material.color.set(c); ghostEdges.material.color.set(mode === 'break' ? '#ff4d4f' : '#ffffff');
}

// ------------------------------------------------------------------ input
const keys = new Set();
let yaw = 0, pitch = 0.45, jumpQueued = false;
const stick = { x: 0, y: 0 };
addEventListener('keydown', e => {
  if (!started || e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyQ') setMode(mode === 'break' ? 'build' : 'break');
  const n = /^Digit(\d)$/.exec(e.code);
  if (n) { selected = (+n[1] + 9) % 10; setMode('build'); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
renderer.domElement.addEventListener('wheel', e => { selected = (selected + (e.deltaY > 0 ? 1 : BLOCKS.length - 1)) % BLOCKS.length; setMode('build'); }, { passive: true });
// drag to look around; a click or tap without much drag builds (right-click breaks)
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button }; });
addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') hover = { x: e.clientX, y: e.clientY };
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  yaw -= dx * 0.006; pitch = Math.max(-0.3, Math.min(1.3, pitch + dy * 0.004));
});
addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved < 8 && started) act(e.clientX, e.clientY, drag.button === 2 || mode === 'break');
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
$('resetBtn').onclick = () => {
  if (!confirm('Start a fresh island? Everything built here will be cleared.')) return;
  starterWorld(); saveSoon();
  net.send({ t: 'world', w: worldList() });
};

// ------------------------------------------------------------------ local physics
// Move one axis at a time and stop at any block (or the island top) in the way.
function hitsSolid(p) {
  const x0 = Math.floor(p.x - RADIUS), x1 = Math.floor(p.x + RADIUS - 1e-6);
  const z0 = Math.floor(p.z - RADIUS), z1 = Math.floor(p.z + RADIUS - 1e-6);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + HEIGHT - 1e-6);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (solid(x, y, z)) return [x, y, z];
  return null;
}
const onIsland = (p) => Math.hypot(p.x, p.z) <= ISLAND_R;
function moveAxis(axis, d) {
  if (d === 0) return;
  const p = me.pos;
  const before = p[axis];
  p[axis] += d;
  if (axis === 'y' && d < 0 && before >= 0 && p.y < 0 && onIsland(p)) { p.y = 0; me.vel.y = 0; me.onGround = true; }
  const c = hitsSolid(p);
  if (!c) return;
  const ci = { x: 0, y: 1, z: 2 }[axis];
  if (axis === 'y') {
    if (d < 0) { p.y = c[1] + 1; me.onGround = true; } else p.y = c[1] - HEIGHT;
  } else p[axis] = d > 0 ? c[ci] - RADIUS - 1e-4 : c[ci] + 1 + RADIUS + 1e-4;
  me.vel[axis] = 0;
  if (hitsSolid(p)) p[axis] = before;   // corner case: just undo the move
}
function stepMe(dt) {
  let ix = stick.x, iz = stick.y;
  if (keys.has('KeyA')) ix -= 1;
  if (keys.has('KeyD')) ix += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('ArrowLeft')) yaw += 2.2 * dt;
  if (keys.has('ArrowRight')) yaw -= 2.2 * dt;
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const wx = ix * cos + iz * sin, wz = -ix * sin + iz * cos;
  if (il > 0.1) me.facing = Math.atan2(wx, wz);

  const f = 1 - Math.exp(-(me.onGround ? 16 : 5) * dt);
  me.vel.x += (wx * SPEED - me.vel.x) * f;
  me.vel.z += (wz * SPEED - me.vel.z) * f;
  if (jumpQueued && me.onGround) { me.vel.y = JUMP_V; sfx('jump'); }
  jumpQueued = false;
  me.vel.y = Math.max(me.vel.y - GRAVITY * dt, -30);

  // small sub-steps so fast falls can't pass through a block
  const steps = Math.ceil(Math.max(Math.abs(me.vel.x), Math.abs(me.vel.y), Math.abs(me.vel.z)) * dt / 0.3) || 1;
  me.onGround = false;
  for (let i = 0; i < steps; i++) {
    moveAxis('x', me.vel.x * dt / steps);
    moveAxis('z', me.vel.z * dt / steps);
    moveAxis('y', me.vel.y * dt / steps);
  }
  if (me.pos.y < -35) { sfx('fall'); spawn(); }
}

// ------------------------------------------------------------------ networking
let sendTimer = 0;
function sendPos(dt) {
  if (net.mode === 'solo') return;
  sendTimer -= dt;
  if (sendTimer > 0) return;
  sendTimer = 1 / SEND_HZ;
  const r = (v) => Math.round(v * 100) / 100;
  net.send({ t: 'p', x: r(me.pos.x), y: r(me.pos.y), z: r(me.pos.z), vx: r(me.vel.x), vy: r(me.vel.y), vz: r(me.vel.z), f: r(me.facing), a: r(clock - me.lastAct), n: myName, c: myColor });
}
function onMessage(m) {
  const fromHost = m.from === net.hostId;
  if (m.t === 'p') {
    let r = remotes.get(m.from);
    if (!r) {
      r = { avatar: makeAvatar(String(m.n || 'Player').slice(0, 14), String(m.c || '#ffffff')), target: new THREE.Vector3(+m.x || 0, +m.y || 0, +m.z || 0), vel: new THREE.Vector3(), at: 0, facing: 0, actAge: 9 };
      r.avatar.group.position.copy(r.target);
      remotes.set(m.from, r);
      feed(`${r.avatar.name} joined`);
      drawPlayers();
      // the host sends newcomers the whole island
      if (net.mode === 'host') net.send({ t: 'world', to: m.from, w: worldList() });
    }
    if (m.n && m.n !== r.avatar.name) { retag(r.avatar, String(m.n).slice(0, 14)); drawPlayers(); }
    r.target.set(+m.x || 0, +m.y || 0, +m.z || 0); r.vel.set(+m.vx || 0, +m.vy || 0, +m.vz || 0);
    r.facing = +m.f || 0; r.actAge = +m.a; r.at = performance.now();
  } else if (m.t === 'b' && net.mode === 'host') {
    hostApply(m);
  } else if (m.t === 'set' && fromHost) {
    const had = world.get(key(m.x | 0, m.y | 0, m.z | 0));
    const type = m.b == null ? null : m.b | 0;
    if ((had ?? null) !== type) setBlock(m.x | 0, m.y | 0, m.z | 0, type);
  } else if (m.t === 'world' && fromHost) {
    const first = world.size === 0;
    loadList(m.w);
    if (first) feed(`Island loaded: ${world.size} blocks`);
    else feed('The host started a fresh island');
  }
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (r) { scene.remove(r.avatar.group); remotes.delete(id); feed(`${r.avatar.name} left`); drawPlayers(); }
}
function onDisconnected() {
  $('banner').textContent = 'The host left the room';
  for (const id of [...remotes.keys()]) removeRemote(id);
  net.mode = 'solo';
}

// ------------------------------------------------------------------ HUD + sound
function drawPlayers() {
  const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = [[myName + ' (you)', myColor, true], ...[...remotes.values()].map(r => [r.avatar.name, r.avatar.color, false])];
  $('board').innerHTML = `<div style="opacity:.8;font-size:12px;margin-bottom:4px">${rows.length} on the island</div>` +
    rows.map(([n, c, mine]) => `<div class="p${mine ? ' me' : ''}"><span class="dot" style="background:${esc(c)}"></span><span class="n">${esc(n)}</span></div>`).join('');
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
    const set = { jump: [300, 600, 0.12, 'sine'], place: [520, 380, 0.08, 'triangle'], break: [220, 90, 0.12, 'square'], fall: [700, 120, 0.6, 'sine'] }[kind];
    o.type = set[3]; o.frequency.setValueAtTime(set[0], t); o.frequency.exponentialRampToValueAtTime(set[1], t + set[2]);
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + set[2]);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + set[2]);
  } catch (e) { /* no audio */ }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  if (started) {
    stepMe(dt);
    sendPos(dt);
    const a = me.avatar;
    a.group.position.copy(me.pos);
    a.group.rotation.y = me.facing;
    animateAvatar(a, clock - me.lastAct, Math.hypot(me.vel.x, me.vel.z), clock);
    // remote players: aim a little ahead using their velocity, then ease toward it
    for (const [, r] of remotes) {
      const age = Math.min((performance.now() - r.at) / 1000, 0.25);
      const p = r.avatar.group.position;
      const tx = r.target.x + r.vel.x * age, ty = r.target.y + r.vel.y * age, tz = r.target.z + r.vel.z * age;
      if (Math.hypot(tx - p.x, ty - p.y, tz - p.z) > 6) p.set(tx, ty, tz);
      else { const k = 1 - Math.exp(-12 * dt); p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.z += (tz - p.z) * k; }
      let dr = r.facing - r.avatar.group.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      r.avatar.group.rotation.y += dr * (1 - Math.exp(-15 * dt));
      r.actAge += dt;
      animateAvatar(r.avatar, r.actAge, Math.hypot(r.vel.x, r.vel.z), clock);
    }
    // third-person camera
    camTarget.lerp(tmp.set(me.pos.x, Math.max(me.pos.y, -8) + 1.3, me.pos.z), 1 - Math.exp(-10 * dt));
    const dist = 8;
    camera.position.set(camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(camTarget);
    updateGhost();
  } else {
    camera.position.set(Math.sin(clock * 0.1) * 30, 14, Math.cos(clock * 0.1) * 30);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// test hook for automated checks
window.__skyroom = { net, me, remotes, world, act, request };
