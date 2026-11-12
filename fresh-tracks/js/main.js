// Fresh Tracks — boot, screens, the frame loop and all the glue: physics → rider → effects → camera → HUD,
// chairlifts, Winter Games events, the Design Studio preview, and riding with friends.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as T from './terrain.js';
import { buildWorld, updateLOD, snowUniforms, snowMaterial } from './world.js';
import { Rider } from './rider.js';
import { Player } from './player.js';
import { Spray, Snowfall, Tracks } from './fx.js';
import { trickName, trickPoints, railName, railPoints, GRAB_KEYS } from './tricks.js';
import { Games, EVENTS, LEVELS } from './games.js';
import { Net, randomCode } from './net.js';
import { Audio } from './audio.js';
import * as Gear from './gear.js';
import { Studio, randomLook } from './studio.js';
import { drawTrailMap, toMap } from './trailmap.js';

const $ = (id) => document.getElementById(id);
const URLQ = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ------------------------------------------------------------------ profile & settings
const PKEY = 'freshtracks.profile.v1';
let profile = {};
try { profile = JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch (e) { profile = {}; }
profile.settings = Object.assign({ quality: isTouch || (navigator.hardwareConcurrency || 4) <= 4 ? 0 : 1, weather: 'bluebird', cam: 'chase', vol: 0.7, touch: isTouch }, profile.settings || {});
profile.best = profile.best || {};
let look = Gear.sanitizeLook(profile.look || Gear.DEFAULT_LOOK);
function save() { profile.look = look; try { localStorage.setItem(PKEY, JSON.stringify(profile)); } catch (e) { /* full */ } }

const QUALITY = [
  { name: 'Low', res: 4, pr: Math.min(devicePixelRatio, 1) * 0.85, shadows: 0, treeStep: 10.5, treeNear: 130, flakes: 3500 },
  { name: 'Medium', res: 3, pr: Math.min(devicePixelRatio, 1.25), shadows: 1024, treeStep: 7.6, treeNear: 180, flakes: 6000 },
  { name: 'High', res: 2.5, pr: Math.min(devicePixelRatio, 1.6), shadows: 2048, treeStep: 6.4, treeNear: 240, flakes: 9000 },
];
const WEATHER = {
  bluebird: { name: 'Bluebird', elev: 34, az: 128, turb: 1.6, ray: 0.9, mie: 0.003, mieG: 0.86, fog: 0.00013, fogCol: 0xc6daf0, sun: 3.4, sunCol: 0xfff3e2, hemi: 0.75, sky: 0x9fc7ff, exposure: 0.5, spark: 1.0 },
  golden: { name: 'Golden hour', elev: 7, az: 112, turb: 4, ray: 2.4, mie: 0.006, mieG: 0.9, fog: 0.00018, fogCol: 0xe9b98e, sun: 2.8, sunCol: 0xffb36b, hemi: 0.55, sky: 0x8aa6d6, exposure: 0.62, spark: 1.0 },
  powder: { name: 'Powder day', elev: 40, az: 150, turb: 14, ray: 0.25, mie: 0.03, mieG: 0.6, fog: 0.0042, fogCol: 0xd3dbe4, sun: 0.7, sunCol: 0xffffff, hemi: 1.5, sky: 0xdfe6ee, exposure: 0.62, spark: 0.15, snow: true },
};
const Q = QUALITY[Math.max(0, Math.min(2, profile.settings.quality | 0))];
let W = WEATHER[profile.settings.weather] || WEATHER.bluebird;

// ------------------------------------------------------------------ renderer
const canvas = $('game');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { fail('Your browser could not start 3D graphics (WebGL). Try another browser or turn on hardware acceleration.'); throw e; }
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = Q.shadows > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
function fail(msg) { const e = $('err'); e.textContent = msg; e.classList.remove('hidden'); }

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 15000);
const sky = new Sky(); sky.scale.setScalar(12000); scene.add(sky);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = Q.shadows > 0;
if (Q.shadows) { sun.shadow.mapSize.set(Q.shadows, Q.shadows); const c = sun.shadow.camera; c.left = -42; c.right = 42; c.top = 42; c.bottom = -42; c.near = 1; c.far = 700; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05; }
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xa8ccff, 0xeef3f8, 0.7); scene.add(hemi);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const sunDir = new THREE.Vector3();

function applyWeather() {
  const el = THREE.MathUtils.degToRad(W.elev), az = THREE.MathUtils.degToRad(W.az);
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  const u = sky.material.uniforms;
  u.turbidity.value = W.turb; u.rayleigh.value = W.ray; u.mieCoefficient.value = W.mie; u.mieDirectionalG.value = W.mieG;
  u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  sun.color.set(W.sunCol); sun.intensity = W.sun;
  hemi.color.set(W.sky); hemi.intensity = W.hemi;
  scene.fog = new THREE.FogExp2(W.fogCol, W.fog);
  renderer.toneMappingExposure = W.exposure;
  snowUniforms.uSparkle.value.setScalar(W.spark * 0.9);
  // reflections from this sky
  const envScene = new THREE.Scene(); envScene.add(sky);
  if (W.snow) envScene.background = new THREE.Color(W.fogCol);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 20000);
  scene.add(sky);
  scene.environment = envRT.texture;
  scene.environmentIntensity = W.snow ? 0.8 : 0.6;
  if (snowfall) { snowfall.points.visible = !!W.snow; }
}

// ------------------------------------------------------------------ studio scene (Design Studio preview)
const studio = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, 1, 0.1, 200), yaw: 0.5, pitch: 0.12, dist: 4.4, drag: null, poseI: 0, rider: null, t: 0 };
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#2a4466'); g.addColorStop(0.55, '#7c9cc0'); g.addColorStop(1, '#dfe9f4');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; studio.scene.background = t;
  studio.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xfff1dd, 2.6); key.position.set(3, 5, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  const kc = key.shadow.camera; kc.left = -2; kc.right = 2; kc.top = 3; kc.bottom = -1; key.shadow.bias = -0.0005;
  const rim = new THREE.DirectionalLight(0x9cc8ff, 1.6); rim.position.set(-4, 3, -4);
  studio.scene.add(key, rim, new THREE.HemisphereLight(0xcfe4ff, 0xf3f6fa, 0.7));
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.16, 72), new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 0.85 }));
  pod.position.y = -0.08; pod.receiveShadow = true; studio.scene.add(pod);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0xe6eef7, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.16; floor.receiveShadow = true; studio.scene.add(floor);
}

// ------------------------------------------------------------------ game objects
let world = null, player = null, rider = null, spray = null, snowfall = null, tracks = null;
const audio = new Audio();
const games = new Games();
const net = new Net();
let state = 'boot', prevState = 'title';
let score = 0, combo = null, liftRide = null, camMode = profile.settings.cam;
const remotes = new Map();

// ------------------------------------------------------------------ input
const keys = new Set();
const pressed = new Set();
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  audio.start();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', () => audio.start(), { once: false });
function readInput() {
  let grab = null;
  for (const k in GRAB_KEYS) if (keys.has(k)) { grab = GRAB_KEYS[k]; break; }
  return { left: keys.has('ArrowLeft'), right: keys.has('ArrowRight'), up: keys.has('ArrowUp'), down: keys.has('ArrowDown'), jump: keys.has('Space'), grab };
}
// touch buttons
for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); keys.add(k); pressed.add(k); b.classList.add('held'); audio.start(); };
  const off = (e) => { e.preventDefault(); keys.delete(k); b.classList.remove('held'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
}

// ------------------------------------------------------------------ screens
const SCREENS = ['title', 'studio', 'games', 'friends', 'settings', 'help', 'map', 'pause', 'results'];
function show(s) {
  if (s !== state && !['settings', 'help'].includes(state)) prevState = state;
  state = s;
  for (const id of SCREENS) $(id).classList.toggle('hidden', id !== s);
  const riding = s === 'ride';
  $('hud').classList.toggle('hidden', !(riding || s === 'pause' || s === 'map'));
  $('touch').classList.toggle('hidden', !(riding && profile.settings.touch));
  for (const r of remotes.values()) r.tag.classList.toggle('hidden', !riding);
  if (s === 'studio') openStudio();
  if (s === 'games') openGames();
  if (s === 'friends') openFriends();
  if (s === 'settings') openSettings();
  if (s === 'map') openMap();
  if (s === 'pause') $('quitEvent').classList.toggle('hidden', !games.active);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  const go = b.dataset.go;
  audio.start();
  if (go === 'freeride') { startFreeRide(); return; }
  if (go === 'back') { show(prevState === 'pause' || prevState === 'ride' ? 'pause' : 'title'); return; }
  if (go === 'ride') { show('ride'); return; }
  if (go === 'quitevent') { leaveEvent(); return; }
  if (go === 'title') { if (games.active) leaveEvent(true); stopLift(); show('title'); return; }
  show(go);
});

// ------------------------------------------------------------------ boot
const bootFill = $('bootFill'), bootText = $('bootText');
const bootT0 = performance.now();
function progress(f, t) { bootFill.style.width = Math.round(f * 100) + '%'; if (t) bootText.textContent = t; if (URLQ.has('debug')) console.log('boot', Math.round(performance.now() - bootT0), t); }

async function boot() {
  progress(0.03, 'Waking up the groomers…');
  try { await Promise.race([Promise.all(['40px "Bebas Neue"', '20px "Barlow"', '20px "Barlow Condensed"'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* ok */ }
  await new Promise((r) => Gear.loadLibrary(r));
  snowfall = new Snowfall(scene, Q.flakes);
  applyWeather();
  world = await buildWorld(scene, Q, progress);
  progress(0.97, 'Waxing your board…');
  player = new Player(world);
  rider = new Rider(look); scene.add(rider.root);
  if (!Q.shadows) rider.setShadows(false);
  spray = new Spray(scene); tracks = new Tracks(scene);
  player.goofy = look.stance === 'goofy';
  const s0 = T.SPOTS[0]; player.spawn(s0.x, s0.z);
  studio.rider = new Rider(look); studio.scene.add(studio.rider.root);
  initMenus();
  progress(1, 'Ready!');
  $('boot').classList.add('gone'); setTimeout(() => $('boot').classList.add('hidden'), 700);
  show('title');
  if (URLQ.has('ride')) startFreeRide(URLQ.get('ride'));
  if (URLQ.has('studio')) show('studio');
  renderer.setAnimationLoop(frame);
}

// ------------------------------------------------------------------ free ride
function startFreeRide(spotId) {
  stopLift();
  if (games.active) leaveEvent(true);
  const s = T.SPOTS.find((x) => x.id === spotId) || (player.pos.z > 1500 || !player.started ? T.SPOTS[0] : null);
  if (s) teleport(s);
  player.started = true;
  show('ride');
  toast('Free ride! Press <kbd>M</kbd> for the trail map, <kbd>E</kbd> at a lift.');
}
function teleport(s) {
  stopLift();
  player.spawn(s.x, s.z, { x: 0, z: 1 });
  tracks.end(); combo = null;
  snapCamera();
}

// ------------------------------------------------------------------ tricks, combos, popups
let trickTimer = 0;
function popup(name, pts, q, extra = '') {
  const el = $('trick');
  el.innerHTML = `<div class="n">${name}</div>${pts ? `<div class="p">+${pts.toLocaleString()}${extra}</div>` : ''}${q ? `<div class="q ${q === 'Sketchy' || q === 'Bail!' ? 'bad' : ''}">${q}</div>` : ''}`;
  el.classList.remove('fade'); trickTimer = 2.4;
}
function feed(html) {
  const f = $('feed'), d = document.createElement('div'); d.innerHTML = html; f.prepend(d);
  while (f.children.length > 5) f.lastChild.remove();
  setTimeout(() => d.remove(), 6000);
}
function toast(html) { feed(html); }
function bankCombo() {
  if (!combo) return;
  const total = combo.pts * combo.n;
  score += total;
  if (total >= 500) window.VoltEarn?.add('fresh-tracks', Math.min(10, Math.max(1, Math.floor(total / 2000))), 'Tricks');
  if (combo.n > 1) feed(`Combo x${combo.n}: <b>+${total.toLocaleString()}</b>`);
  combo = null;
}
function addTrick(name, pts, q) {
  if (!combo) combo = { pts: 0, n: 0, ground: 0 };
  combo.pts += pts; combo.n += 1; combo.ground = 0;
  popup(name, pts, q, combo.n > 1 ? ` · combo x${combo.n}` : '');
}

function handleEvents() {
  for (const e of player.events) {
    const gres = games.onEvent(e);
    if (e.type === 'takeoff') { if (e.ollie) audio.pop(); tracks.end(); }
    else if (e.type === 'land') {
      const t = e.trick;
      audio.land(Math.min(1, e.impact / 12));
      landPuff(Math.min(1.5, e.impact / 8));
      if (t.small && !t.spin && !t.flips && !t.grab) continue;
      const name = trickName(t), pts = trickPoints(t);
      const q = t.quality === 'sketchy' ? 'Sketchy' : t.height > 4 ? 'Huge!' : t.air > 1.4 ? 'Stomped' : 'Clean';
      if (games.active) popup(name, 0, gres ? `Judges: ${gres.v.toFixed(1)}` + (t.quality === 'sketchy' ? ' · sketchy' : '') : q);
      else addTrick(name, pts, q + (t.height > 0.8 ? ` · ${t.height.toFixed(1)} m` : ''));
      if (nearVenue()) audio.cheer(Math.min(1, 0.4 + t.spin / 1440 + t.flips * 0.3));
      if (pts >= 300) net.sendEvent({ trick: name });
    } else if (e.type === 'railOn') { audio.railOn(); tracks.end(); }
    else if (e.type === 'railOff') {
      const name = railName(e), pts = railPoints(e);
      if (games.active) popup(name, 0, gres ? `Judges: ${gres.v.toFixed(1)}` : '');
      else addTrick(name, pts, `${e.dist.toFixed(1)} m`);
    } else if (e.type === 'crash') {
      audio.crash(); landPuff(2);
      popup('Bail!', 0, e.why === 'tree' ? 'Hit a tree' : e.why === 'landing' ? 'Bad landing' : 'Wipeout');
      combo = null; tracks.end();
      $('trick').querySelector('.n').style.color = '#ff8a8a';
    } else if (e.type === 'respawn') { snapCamera(true); }
  }
  player.events.length = 0;
}
function nearVenue() { const p = player.pos; return Math.abs(p.x - 175) < 60 && p.z > 230 && p.z < 760 || (Math.abs(p.x) < 40 && p.z > 560 && p.z < 720); }
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
function landPuff(k) {
  const p = player.pos;
  spray.emit(p, _v1.set(player.vel.x * 0.4, 0.8, player.vel.z * 0.4), Math.round(14 * k), 3 * k, 0.18, 0.8);
}

// ------------------------------------------------------------------ chairlifts
function nearLift() {
  if (!world) return null;
  for (const L of world.lifts) { const lp = L.loadPoint(); if (Math.hypot(player.pos.x - lp.x, player.pos.z - lp.z) < 16) return L; }
  return null;
}
function startLift(L) {
  const nc = L.nextChair();
  liftRide = { L, i: nc.i, phase: 'wait' };
  const lp = L.loadPoint();
  player.spawn(lp.x, lp.z + 1.2, { x: 0, z: -1 });
  player.freeze = true;
  tracks.end(); bankCombo();
  $('liftName').textContent = L.def.name;
  $('liftBar').classList.remove('hidden');
  feed(`Waiting for the next chair on <b>${L.def.name}</b>…`);
}
function stopLift() {
  if (!liftRide) return;
  liftRide = null; player.freeze = false; if (player.mode === 'lift') player.mode = 'ground';
  $('liftBar').classList.add('hidden');
}
const seatOut = { pos: new THREE.Vector3(), yaw: 0, s: 0 };
function updateLift(dt) {
  const R = liftRide, L = R.L;
  const fast = keys.has('Space') ? 7 : 1;
  if (R.phase === 'wait') {
    const ds = ((L.sLoad - L.chairS(R.i)) % L.L + L.L) % L.L;
    if (ds < 0.6 || ds > L.L - 3) { R.phase = 'ride'; player.mode = 'lift'; audio.clunk(); }
    $('liftFill').style.width = '0%';
    return 1;
  }
  L.seat(R.i, seatOut);
  const s = seatOut.s;
  const prog = (s - L.sLoad) / (L.sUnload - L.sLoad);
  $('liftFill').style.width = Math.max(0, Math.min(100, prog * 100)) + '%';
  const yaw = seatOut.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
  player.pos.set(seatOut.pos.x + fx * 0.42, seatOut.pos.y - 0.5, seatOut.pos.z + fz * 0.42);
  player.qVis.setFromAxisAngle(_UP, yaw + (look.stance === 'goofy' ? Math.PI : 0));
  if (s >= L.sUnload && s < L.sUnload + 40) {
    // hop off at the top
    const x = L.def.x - 6, z = L.def.zTop + 10;
    stopLift();
    player.spawn(x, z, { x: -0.3, z: 1 });
    player.vel.set(-0.5, 0, 2.5);
    feed(`Top of <b>${L.def.name}</b>. Enjoy the ride!`);
    snapCamera();
  }
  return fast;
}
const _UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ camera
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), fov: 60 };
const CAMS = ['chase', 'far', 'pov', 'side'];
function snapCamera(soft) {
  const p = player.pos;
  cam.dir.set(player.heading.x, 0, player.heading.z).normalize();
  if (!soft) { cam.pos.copy(p).addScaledVector(cam.dir, -6).add(_v1.set(0, 2.6, 0)); cam.look.copy(p); }
}
function updateCamera(dt) {
  const p = player.pos;
  const hv = _v1.set(player.vel.x, 0, player.vel.z);
  const sp = hv.length();
  if (player.mode === 'ground' || player.mode === 'rail' || player.mode === 'crash') { if (sp > 1.5) cam.dir.lerp(hv.normalize(), 1 - Math.exp(-dt * 2.6)).normalize(); }
  else if (player.mode === 'air' && sp > 3) cam.dir.lerp(hv.normalize(), 1 - Math.exp(-dt * 1.5)).normalize();
  const tgtPos = _v2, tgtLook = _v3;
  const P = T.PIPE;
  const inPipeZone = Math.abs(p.x - P.x) < P.half + 2 && p.z > P.z0 + 4 && p.z < P.z1 && (player.inPipe || player.mode === 'air');
  if (liftRide && liftRide.phase === 'ride') {
    const yaw = seatOut.yaw;
    tgtPos.set(p.x - Math.cos(yaw) * 5.5 - Math.sin(yaw) * 4, p.y + 1.6, p.z + Math.sin(yaw) * 5.5 - Math.cos(yaw) * 4);
    tgtLook.set(p.x + Math.sin(yaw) * 6, p.y + 0.6, p.z + Math.cos(yaw) * 6);
  } else if (camMode === 'pov' && player.mode !== 'crash') {
    rider.P.head.getWorldPosition(tgtPos); tgtPos.y += 0.06;
    tgtLook.copy(tgtPos).addScaledVector(cam.dir, 10).add(_v1.set(0, -2.2, 0));
    cam.pos.copy(tgtPos); cam.look.lerp(tgtLook, 1 - Math.exp(-dt * 10));
    finishCam(dt, sp, true); return;
  } else if (inPipeZone && camMode !== 'side') {
    tgtPos.set(P.x + (p.x - P.x) * 0.3, Math.max(p.y + 2.2, T.baseY(p.z) + 1.5), p.z - 14);
    tgtLook.set(p.x, p.y + 0.6, p.z + 4);
  } else if (camMode === 'side') {
    const sx = -cam.dir.z, sz = cam.dir.x;
    tgtPos.set(p.x + sx * 9 + cam.dir.x * 2, p.y + 2.5, p.z + sz * 9 + cam.dir.z * 2);
    tgtLook.set(p.x, p.y + 0.7, p.z);
  } else {
    const far = camMode === 'far';
    const d = far ? 9.5 : 5.4, h = far ? 4 : 2.0;
    tgtPos.copy(p).addScaledVector(cam.dir, -d); tgtPos.y += h + Math.min(2, sp * 0.03);
    tgtLook.copy(p).addScaledVector(cam.dir, far ? 5 : 3.5); tgtLook.y += 0.9;
  }
  const k = 1 - Math.exp(-dt * (player.mode === 'air' ? 4.5 : 5.5));
  cam.pos.lerp(tgtPos, k);
  cam.look.lerp(tgtLook, 1 - Math.exp(-dt * 9));
  finishCam(dt, sp, false);
}
function finishCam(dt, sp, pov) {
  const gy = T.H(cam.pos.x, cam.pos.z) + (pov ? 0.2 : 0.7);
  if (cam.pos.y < gy) cam.pos.y = gy;
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  const f = (pov ? 78 : 58) + Math.min(14, sp * 0.35);
  cam.fov += (f - cam.fov) * (1 - Math.exp(-dt * 3));
  camera.fov = cam.fov; camera.updateProjectionMatrix();
  // a little chatter at speed on the snow
  if (player.mode === 'ground' && sp > 12) { const a = (sp - 12) * 0.0006; camera.rotation.z += (Math.random() - 0.5) * a; }
}

// ------------------------------------------------------------------ riding frame
let hudT = 0, netT = 0, imgT = 0, crowdT = 0;
const sideV = new THREE.Vector3(), nrmV = new THREE.Vector3();
function updateRide(dt) {
  const inp = readInput();
  // one-shot keys
  if (pressed.has('Escape')) { show('pause'); pressed.clear(); return; }
  if (pressed.has('KeyM') && !games.active) { show('map'); pressed.clear(); return; }
  if (pressed.has('KeyC')) { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]; profile.settings.cam = camMode; save(); feed(`Camera: <b>${camMode}</b>`); }
  if (pressed.has('KeyT')) { net.sendEvent({ wave: 1 }); feed('👋 You waved'); }
  if (pressed.has('KeyE') && !games.active) {
    if (liftRide) { /* already on */ } else { const L = nearLift(); if (L && player.mode === 'ground') startLift(L); }
  }
  pressed.clear();

  let liftFast = 1;
  if (liftRide) liftFast = updateLift(dt);
  else player.update(dt, inp);
  for (const L of world.lifts) L.update(dt, liftRide && liftRide.L === L ? liftFast : 1);
  handleEvents();

  // games
  if (games.active) {
    const r = games.update(dt, player);
    if (r === 'go') { player.freeze = false; audio.beep(true); $('count').textContent = 'GO!'; setTimeout(() => $('count').classList.add('hidden'), 700); kickOff(); }
    if (r === 'end') { showRunResults(); return; }
    const A = games.active;
    if (A.state === 'countdown') { const n = Math.ceil(A.cd - 0.2); if (n !== A.lastN && n > 0) { A.lastN = n; $('count').textContent = n; $('count').classList.remove('hidden'); audio.beep(false); } }
    if (A.flash) { feed(A.flash); A.flash = null; }
  }
  // combo banking
  if (combo && player.mode === 'ground') { combo.ground += dt; if (combo.ground > 2.2) bankCombo(); }

  // rider
  if (!liftRide || liftRide.phase === 'wait') {
    rider.root.position.copy(player.pos);
    if (player.mode === 'crash') rider.root.position.y += 0.35;
    rider.root.quaternion.copy(player.qVis);
  } else { rider.root.position.copy(player.pos); rider.root.quaternion.copy(player.qVis); }
  rider.pose(player.poseParams(inp), dt);

  // snow fx
  const sp = player.speed;
  if (player.mode === 'ground' && !liftRide) {
    sideV.set(0, 0, 1).applyQuaternion(player.qTravel);
    nrmV.copy(player.n);
    T.masks(player.pos.x, player.pos.z);
    const deep = 1 - T.MASK.g;
    tracks.add(player.pos, sideV, nrmV, 0.24 + player.skid * 0.55, 0.42 + deep * 0.35 + Math.abs(player.roll) * 0.25);
    const carve = Math.abs(player.roll), sk = player.skid;
    if (sp > 4 && (carve > 0.25 || sk > 0.25 || deep > 0.5)) {
      const side = Math.sign(player.roll || 1);
      const n = Math.round((sk * 3 + carve * 2 + deep * 1.5) * Math.min(1, sp / 12) * (W.snow ? 1.6 : 1));
      if (n > 0) {
        const ep = _v1.copy(player.pos).addScaledVector(sideV, -side * 0.15);
        const ev = _v2.copy(player.vel).multiplyScalar(0.35).addScaledVector(sideV, -side * (2 + sk * 4)); ev.y += 1.2 + sk * 1.5;
        spray.emit(ep, ev, n, 1.4 + sk * 2, 0.22 + deep * 0.12, 0.8);
      }
    }
  }
  // HUD
  hudT -= dt;
  if (hudT <= 0) { hudT = 0.2; updateHud(); }
  if (trickTimer > 0) { trickTimer -= dt; if (trickTimer <= 0) $('trick').classList.add('fade'); }
  const L = !liftRide && player.mode === 'ground' && !games.active ? nearLift() : null;
  setPrompt(L ? `<kbd>E</kbd> Ride the ${L.def.name}` : liftRide && liftRide.phase === 'wait' ? 'Get ready… the chair is coming' : '');
  updateCamera(dt);
  // audio
  audio.update({ speed: sp, ground: player.mode === 'ground', edge: Math.abs(player.roll), skid: player.skid, rail: player.mode === 'rail', crowd: nearVenue() ? 1 : 0 });
  // multiplayer
  netT -= dt; if (netT <= 0 && net.on) { netT = 0.1; sendNet(inp); }
  imgT -= dt; if (imgT <= 0 && net.on) { imgT = 7; sendImages(); }
}
function kickOff() {
  const ev = games.active.ev;
  const push = ev.id === 'pipe' ? 6 : ev.id === 'bigair' ? 4 : 3;
  player.vel.set(0, 0, push);
}
let lastPrompt = '';
function setPrompt(html) { if (html === lastPrompt) return; lastPrompt = html; const p = $('prompt'); p.innerHTML = html; p.classList.toggle('hidden', !html); }
function updateHud() {
  const p = player.pos;
  $('hudSpeed').textContent = Math.round(player.speed * 3.6);
  const pl = T.placeName(p.x, p.z);
  $('hudPlace').textContent = liftRide ? liftRide.L.def.name : pl.name;
  $('hudDiff').className = 'diff ' + (liftRide ? 'off' : pl.diff);
  $('hudAlt').textContent = Math.round(T.ELEV_TOP + (p.y - 600)) + ' m';
  const cur = combo ? combo.pts * combo.n : 0;
  $('hudScore').textContent = games.active ? '' : (score + cur).toLocaleString() + ' pts';
  const A = games.active;
  $('evBar').classList.toggle('hidden', !A);
  if (A) {
    $('evName').textContent = A.ev.name;
    $('evRun').textContent = `Run ${Math.min(A.run + 1, A.ev.runs)}/${A.ev.runs}`;
    $('evTime').textContent = A.state === 'run' ? A.t.toFixed(1) + 's' : '';
    $('evPts').textContent = A.ev.timed ? (A.missed ? `${A.missed} missed` : `Gate ${A.gate}/${T.GATES.length}`) : A.log.length ? `${A.log.filter((l) => !l.fall).length} tricks` : '';
  }
  // friends list
  const list = net.on ? net.list() : [];
  $('players').classList.toggle('hidden', !net.on);
  if (net.on) $('players').innerHTML = `<b>Room ${net.code}</b>` + [`🟢 ${escapeHtml(look.name)} (you)`, ...list.map((r) => `🔵 ${escapeHtml((r.look && r.look.name) || 'Rider')}`)].map((s) => `<div>${s}</div>`).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ------------------------------------------------------------------ multiplayer
function sendNet(inp) {
  const p = player.pos, q = player.qVis, ps = player.poseParams(inp);
  const r = (v, k = 100) => Math.round(v * k) / k;
  net.send({
    p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x, 1000), r(q.y, 1000), r(q.z, 1000), r(q.w, 1000)],
    ps: { c: r(ps.crouch), l: r(ps.lean), sw: ps.sw ? 1 : 0, a: ps.air ? 1 : 0, g: ps.grab || 0, t: ps.tuck, b: ps.brake, x: ps.crash ? 1 : 0, s: r(ps.spin), sit: ps.sit ? 1 : 0, pr: ps.press },
    m: player.mode, sp: r(player.speed), look,
  });
}
function sendImages() {
  if (!net.list().length) return;
  const imgs = {};
  for (const id of Gear.lookImageIds(look)) { const s = Gear.smallSrc(id); if (s) imgs[id] = s; }
  if (Object.keys(imgs).length) net.sendImages(imgs);
}
net.onImages = (imgs) => {
  for (const id in imgs) Gear.addRemoteImage(id, imgs[id], () => { for (const r of remotes.values()) if (r.look && Gear.lookImageIds(r.look).includes(id)) r.rider.setLook(r.look); });
};
net.onEvent = (id, ev) => {
  const peer = net.peers.get(id); const nm = escapeHtml((peer && peer.look && peer.look.name) || 'A friend');
  if (ev.trick) feed(`🔥 <b>${nm}</b> landed ${escapeHtml(String(ev.trick).slice(0, 60))}`);
  if (ev.wave) feed(`👋 <b>${nm}</b> waves`);
};
function updateRemotes(dt) {
  if (!net.on) { if (remotes.size) { for (const r of remotes.values()) dropRemote(r); remotes.clear(); } return; }
  const seen = new Set();
  for (const peer of net.list()) {
    const st = peer.st; if (!st || !Array.isArray(st.p)) continue;
    const id = st.id; seen.add(id);
    let r = remotes.get(id);
    const lk = peer.look ? Gear.sanitizeLook(peer.look) : null;
    if (!r) {
      r = { rider: new Rider(lk || Gear.DEFAULT_LOOK), pos: new THREE.Vector3(...st.p), q: new THREE.Quaternion(), look: lk, key: JSON.stringify(lk), tag: document.createElement('div') };
      r.tag.className = 'tag3d'; document.body.appendChild(r.tag);
      if (!Q.shadows) r.rider.setShadows(false);
      scene.add(r.rider.root); remotes.set(id, r);
    }
    if (lk) { const k = JSON.stringify(lk); if (k !== r.key) { r.key = k; r.look = lk; r.rider.setLook(lk); } }
    const tp = _v1.set(st.p[0], st.p[1], st.p[2]);
    if (r.pos.distanceToSquared(tp) > 400) r.pos.copy(tp); else r.pos.lerp(tp, 1 - Math.exp(-dt * 12));
    if (Array.isArray(st.q)) { const tq = new THREE.Quaternion(st.q[0], st.q[1], st.q[2], st.q[3]).normalize(); r.q.slerp(tq, 1 - Math.exp(-dt * 14)); }
    r.rider.root.position.copy(r.pos); if (st.ps && st.ps.x) r.rider.root.position.y += 0.35;
    r.rider.root.quaternion.copy(r.q);
    const ps = st.ps || {};
    r.rider.pose({ crouch: +ps.c || 0.2, lean: +ps.l || 0, sw: !!ps.sw, air: !!ps.a, grab: typeof ps.g === 'string' ? ps.g : null, tuck: +ps.t || 0, brake: +ps.b || 0, crash: !!ps.x, spin: +ps.s || 0, sit: !!ps.sit, press: +ps.pr || 0 }, dt);
    // name tag
    const sp = _v2.copy(r.pos); sp.y += 2.1; sp.project(camera);
    const vis = sp.z < 1 && state === 'ride' && r.pos.distanceTo(camera.position) < 250;
    r.tag.classList.toggle('hidden', !vis);
    if (vis) { r.tag.style.left = ((sp.x * 0.5 + 0.5) * innerWidth) + 'px'; r.tag.style.top = ((-sp.y * 0.5 + 0.5) * innerHeight) + 'px'; r.tag.textContent = (lk && lk.name) || 'Rider'; }
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { dropRemote(r); remotes.delete(id); }
}
function dropRemote(r) { scene.remove(r.rider.root); r.rider.dispose(); r.tag.remove(); }

// ------------------------------------------------------------------ Winter Games flow
let gamesSel = { ev: 'pipe', lvl: 'pro' };
function openGames() {
  const c = $('evCards'); c.innerHTML = '';
  for (const ev of Object.values(EVENTS)) {
    const b = document.createElement('button'); b.className = 'card' + (gamesSel.ev === ev.id ? ' on' : '');
    const best = profile.best[ev.id];
    b.innerHTML = `<div class="ic">${ev.icon}</div><b>${ev.name}</b><p>${ev.desc}</p>${best ? `<div class="best">Best: ${best.medal || ''} ${best.text}</div>` : ''}`;
    b.onclick = () => { gamesSel.ev = ev.id; openGames(); };
    c.appendChild(b);
  }
  const lc = $('lvlChips'); lc.innerHTML = '';
  for (const l of LEVELS) { const b = document.createElement('button'); b.className = 'chip' + (gamesSel.lvl === l.id ? ' on' : ''); b.textContent = l.name; b.onclick = () => { gamesSel.lvl = l.id; openGames(); }; lc.appendChild(b); }
}
$('evGo').onclick = () => {
  stopLift(); bankCombo();
  games.start(gamesSel.ev, gamesSel.lvl, { name: look.name });
  const A = games.active;
  $('resTitle').textContent = A.ev.name + ' · ' + A.lv.name;
  $('resBody').innerHTML = `<p class="sub">${A.ev.desc}</p><div class="sub small">${A.ev.timed ? 'Two runs, times added together.' : A.ev.id === 'bigair' ? 'Three jumps. Your best two scores are added.' : 'Three runs. Your best run counts.'}</div>` + standingsTable();
  $('resNext').textContent = 'Start run 1 →';
  show('results');
};
function beginRun() {
  const A = games.active; if (!A) return;
  const s = A.ev.start;
  player.spawn(s.x, s.z, { x: 0, z: 1 });
  player.freeze = true; tracks.end(); combo = null;
  games.beginRun();
  snapCamera();
  show('ride');
}
$('resNext').onclick = () => {
  const A = games.active;
  if (!A) { show('title'); return; }
  if (A.done) { finishEvent(); return; }
  beginRun();
};
$('resQuit').onclick = () => { leaveEvent(); };
function leaveEvent(silent) {
  if (!games.active) return;
  games.stop(); player.freeze = false; $('count').classList.add('hidden');
  if (!silent) { show('ride'); feed('Left the event. Free riding!'); }
}
function standingsTable() {
  const A = games.active, list = games.standings(), ev = A.ev;
  const fmt = (c) => (ev.timed ? (c.best >= 900 ? '—' : c.best.toFixed(2) + 's') : c.best.toFixed(2));
  return `<table class="lb">${list.map((c, i) => `<tr class="${c.me ? 'me' : ''}"><td>${i + 1}</td><td>${c.flag} ${escapeHtml(c.name)}</td><td class="r">${c.runs.map((r) => (ev.timed ? (r >= 900 ? 'DNF' : r.toFixed(2)) : r.toFixed(1))).join(' · ')}</td><td class="r"><b>${A.run ? fmt(c) : ''}</b></td></tr>`).join('')}</table>`;
}
function showRunResults() {
  const A = games.active, r = A.lastRun;
  player.freeze = true;
  $('resTitle').textContent = `${A.ev.name} · Run ${A.run} of ${A.ev.runs}`;
  const logs = A.log.length ? `<div class="runlog">${A.log.map((l) => `<div><span>${escapeHtml(l.name)}</span><span>${l.fall ? '💥' : l.v.toFixed(1)}</span></div>`).join('')}</div>` : '<div class="sub">No tricks landed.</div>';
  $('resBody').innerHTML = `<div class="bigscore">${r.text}</div>${A.ev.timed ? '' : logs}` + standingsTable();
  $('resNext').textContent = A.done ? 'Final results →' : `Run ${A.run + 1} →`;
  audio.cheer(r.score > 70 ? 1 : 0.5);
  show('results');
}
function finishEvent() {
  const A = games.active, list = games.standings(), rank = list.findIndex((c) => c.me) + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  const me = list[rank - 1];
  const txt = A.ev.timed ? me.best.toFixed(2) + 's' : me.best.toFixed(2);
  const prev = profile.best[A.ev.id];
  const better = !prev || (A.ev.timed ? me.best < prev.score : me.best > prev.score);
  if (better && me.best < 900) { profile.best[A.ev.id] = { score: me.best, text: txt, medal }; save(); }
  $('resTitle').textContent = `${A.ev.name} · Final`;
  $('resBody').innerHTML = `${medal ? `<div class="medal">${medal}</div>` : ''}<div class="sub" style="text-align:center;font-size:20px">${medal ? (rank === 1 ? 'Gold! You are the Winter Games champion!' : rank === 2 ? 'Silver medal! So close!' : 'Bronze medal! On the podium!') : `You finished ${rank}${['th', 'st', 'nd', 'rd'][rank % 10 > 3 || Math.floor(rank / 10) === 1 ? 0 : rank % 10] || 'th'}. Train and try again!`}</div>` + standingsTable();
  $('resNext').textContent = 'Back to free ride';
  if (medal) audio.cheer(1.3);
  games.stop();
  player.freeze = false;
  $('resNext').onclick = () => { $('resNext').onclick = resNextDefault; show('ride'); };
}
const resNextDefault = $('resNext').onclick;

// ------------------------------------------------------------------ friends screen
function openFriends() {
  $('mpName').value = look.name || '';
  if (!$('mpCode').value) $('mpCode').value = net.code || '';
  renderFriendList();
}
function renderFriendList() {
  const l = net.on ? net.list() : [];
  $('mpList').innerHTML = net.on ? [`<div>🟢 ${escapeHtml(look.name)} (you)</div>`, ...l.map((r) => `<div>🔵 ${escapeHtml((r.look && r.look.name) || 'Rider')}</div>`)].join('') : '';
}
$('mpMake').onclick = () => { $('mpCode').value = randomCode(); };
$('mpJoin').onclick = async () => {
  const name = $('mpName').value.trim().slice(0, 16) || 'Rider';
  look.name = name; save(); rider.setLook(look);
  let code = $('mpCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) { code = randomCode(); $('mpCode').value = code; }
  $('mpStatus').textContent = 'Connecting…';
  const ok = await net.start(code, (s) => { $('mpStatus').textContent = s; });
  if (!ok) { $('mpStatus').textContent = 'Could not reach the multiplayer server. Check your internet and try again.'; return; }
  $('mpStatus').textContent = `Connected to room ${code}! Tell your friends the code.`;
  setTimeout(() => { if (state === 'friends') startFreeRide(); feed(`You're in room <b>${code}</b>. Friends who join will appear on the mountain.`); }, 900);
};
setInterval(() => { if (state === 'friends') renderFriendList(); }, 1000);

// ------------------------------------------------------------------ settings
function openSettings() {
  const mk = (el, opts, cur, on) => { el.innerHTML = ''; for (const [v, label] of opts) { const b = document.createElement('button'); b.className = 'chip' + (v === cur ? ' on' : ''); b.textContent = label; b.onclick = () => { on(v); openSettings(); }; el.appendChild(b); } };
  mk($('setQuality'), QUALITY.map((q, i) => [i, q.name]), profile.settings.quality, (v) => { if (v !== profile.settings.quality) { profile.settings.quality = v; save(); location.reload(); } });
  mk($('setWeather'), Object.entries(WEATHER).map(([k, w]) => [k, w.name]), profile.settings.weather, (v) => { profile.settings.weather = v; W = WEATHER[v]; save(); applyWeather(); });
  mk($('setCam'), [['chase', 'Chase'], ['far', 'Wide'], ['pov', 'Helmet cam'], ['side', 'Side']], camMode, (v) => { camMode = v; profile.settings.cam = v; save(); });
  mk($('setTouch'), [[true, 'On'], [false, 'Off']], !!profile.settings.touch, (v) => { profile.settings.touch = v; save(); });
  const vol = $('setVol'); vol.value = profile.settings.vol; vol.oninput = () => { profile.settings.vol = +vol.value; audio.setVolume(+vol.value); save(); };
}

// ------------------------------------------------------------------ trail map
function openMap() {
  const c = $('mapCanvas'); drawTrailMap(c);
  const pins = $('mapPins'); pins.innerHTML = '';
  const place = (el, x, z) => { const [a, b] = toMap(x, z); el.style.left = (a / c.width * 100) + '%'; el.style.top = (b / c.height * 100) + '%'; };
  for (const s of T.SPOTS) {
    const b = document.createElement('button'); b.className = 'mpin'; b.textContent = s.name; b.title = s.desc;
    place(b, s.x, s.z);
    b.onclick = () => { teleport(s); show('ride'); feed(`Dropped in at <b>${s.name}</b>`); };
    pins.appendChild(b);
  }
  const you = document.createElement('div'); you.className = 'mpin you'; you.textContent = '● You'; place(you, player.pos.x, player.pos.z); pins.appendChild(you);
  for (const r of remotes.values()) { const f = document.createElement('div'); f.className = 'mpin you'; f.style.background = '#8ecbff'; f.textContent = (r.look && r.look.name) || 'Friend'; place(f, r.pos.x, r.pos.z); pins.appendChild(f); }
}

// ------------------------------------------------------------------ design studio
let studioUI = null, lookTimer = 0, pendingLook = null;
function initMenus() {
  studioUI = new Studio($('stTabs'), $('stBody'), () => look, (l) => {
    look = Gear.sanitizeLook(l); save();
    pendingLook = look; lookTimer = 0.05;
    studioUI.render();
  });
  $('stDone').onclick = () => { rider.setLook(look); player.goofy = look.stance === 'goofy'; show(prevState === 'pause' ? 'pause' : 'title'); };
  $('stRandom').onclick = () => { look = Gear.sanitizeLook(randomLook(look)); save(); pendingLook = look; lookTimer = 0.01; studioUI.render(); };
  $('stPose').onclick = () => { studio.poseI = (studio.poseI + 1) % STUDIO_POSES.length; };
  // orbit the rider
  canvas.addEventListener('pointerdown', (e) => { if (state !== 'studio') return; studio.drag = { x: e.clientX, y: e.clientY, yaw: studio.yaw, pitch: studio.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!studio.drag) return; studio.yaw = studio.drag.yaw - (e.clientX - studio.drag.x) * 0.01; studio.pitch = Math.max(-0.3, Math.min(0.9, studio.drag.pitch + (e.clientY - studio.drag.y) * 0.006)); });
  canvas.addEventListener('pointerup', () => { studio.drag = null; });
  canvas.addEventListener('wheel', (e) => { if (state !== 'studio') return; studio.dist = Math.max(1.6, Math.min(8, studio.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
  $('setVol').value = profile.settings.vol; audio.setVolume(profile.settings.vol);
}
const STUDIO_POSES = [
  {}, { air: true, grab: 'indy', crouch: 0.5 }, { air: true, grab: 'melon', crouch: 0.5 }, { air: true, grab: 'nose' }, { crouch: 0.6, lean: 0.5 }, { tuck: 1 }, { air: true, grab: 'method' },
];
function openStudio() { studioUI.open(); studio.rider.setLook(look); }
function renderStudio(dt) {
  studio.t += dt;
  if (lookTimer > 0) { lookTimer -= dt; if (lookTimer <= 0 && pendingLook) { studio.rider.setLook(pendingLook); pendingLook = null; } }
  if (!studio.drag) studio.yaw += dt * 0.25;
  const p = STUDIO_POSES[studio.poseI];
  const R = studio.rider;
  R.root.position.set(0, p.air ? 0.55 + Math.sin(studio.t * 2) * 0.05 : 0.0, 0);
  R.root.rotation.set(p.air ? -0.15 : 0, 0, p.air ? 0.1 : 0);
  R.pose({ crouch: 0.2, ...p }, dt);
  const w = innerWidth, h = innerHeight, panel = w > 760 ? Math.min(470, w * 0.52) : 0;
  const c = studio.cam;
  c.aspect = (w) / h;
  if (panel) c.setViewOffset(w + panel, h, panel, 0, w, h); else c.clearViewOffset();
  const ty = 0.85 + R.root.position.y * 0.7;
  c.position.set(Math.sin(studio.yaw) * Math.cos(studio.pitch) * studio.dist, ty + Math.sin(studio.pitch) * studio.dist, Math.cos(studio.yaw) * Math.cos(studio.pitch) * studio.dist);
  if (w <= 760) c.position.y += 0.4;
  c.lookAt(0, ty, 0); c.updateProjectionMatrix();
  renderer.render(studio.scene, c);
}

// ------------------------------------------------------------------ title cinematic
let titleT = 0;
function updateTitle(dt) {
  titleT += dt;
  const z = 330 + ((titleT * 9) % 620), x = 26 + Math.sin(titleT * 0.08) * 14;
  cam.pos.set(x, T.H(x, z) + 9 + Math.sin(titleT * 0.13) * 3, z);
  cam.look.set(-4, T.H(-4, z + 60) + 2, z + 60);
  camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.fov = 55; camera.updateProjectionMatrix();
  // the rider shows off at the top of the jump line
  rider.root.position.set(4, T.H(4, z + 22), z + 22);
  rider.root.quaternion.setFromAxisAngle(_UP, Math.PI * 0.5);
  rider.pose({ crouch: 0.3, lean: 0.2 }, dt);
  for (const L of world.lifts) L.update(dt);
}

// ------------------------------------------------------------------ frame loop
let last = performance.now(), fpsAcc = 0, fpsN = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsN++;
  if (state === 'studio') { if (!window.__noRender) renderStudio(dt); return; }
  if (state === 'ride') updateRide(dt);
  else if (state === 'title') updateTitle(dt);
  else {
    // menus over the game: keep the world alive
    for (const L of world.lifts) L.update(dt);
    if (state === 'pause' && pressed.has('Escape')) show('ride');
    if (state === 'map' && (pressed.has('KeyM') || pressed.has('Escape'))) show('ride');
    pressed.clear();
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
  }
  updateRemotes(dt);
  spray.update(dt, innerHeight * renderer.getPixelRatio() * 0.9);
  snowfall.update(dt, camera.position, { x: 0.6, z: 1.2 }, innerHeight * renderer.getPixelRatio() * 0.9);
  tracks.update();
  updateCrowd(dt);
  updateLOD(world, camera.position, Q.treeNear);
  // shadows follow the action
  const focus = state === 'ride' ? player.pos : cam.look;
  const snap = 0.5;
  sun.target.position.set(Math.round(focus.x / snap) * snap, Math.round(focus.y / snap) * snap, Math.round(focus.z / snap) * snap);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
  if (!window.__noRender) renderer.render(scene, camera);
}
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _s4 = new THREE.Vector3(1, 1, 1), _p4 = new THREE.Vector3();
function updateCrowd(dt) {
  const c = world && world.crowd; if (!c) return;
  crowdT += dt;
  if (camera.position.distanceTo(_p4.set(175, 0, 450).setY(camera.position.y)) > 500 && Math.abs(camera.position.x) > 80) return;
  const base = c.userData.base;
  for (let i = 0; i < base.length; i++) {
    const [x, y, z, yaw] = base[i];
    const jump = Math.max(0, Math.sin(crowdT * (5 + (i % 5)) + i * 1.7)) * 0.18;
    _q4.setFromAxisAngle(_UP, yaw); _p4.set(x, y + jump, z); _s4.setScalar(0.9 + (i % 7) * 0.04);
    _m4.compose(_p4, _q4, _s4); c.setMatrixAt(i, _m4);
  }
  c.instanceMatrix.needsUpdate = true;
}

addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
window.__ft = { frame, get player() { return player; }, get world() { return world; }, get rider() { return rider; }, keys, pressed, T, games, show, get state() { return state; }, teleport, camera, renderer };

boot().catch((e) => { console.error(e); fail('Something went wrong loading Fresh Tracks: ' + (e && e.message)); });
