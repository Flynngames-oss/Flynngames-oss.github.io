// Wobble Surf: Lanzarote — main game: spots, surfing physics, tricks, scoring, camera, UI.
import * as THREE from 'three';
import { Sky } from './sky.js';
import { WaveSystem, Ocean, Spray, Trail } from './ocean.js';
import { Island, GEO, ll2w, buildTerrain, buildVillages, buildBeach, Ambient } from './world.js';
import { Ragdoll, poseStand, poseLie, poseSit, makeLineupSurfer, LOOKS, J, setEnvMap } from './surfer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const rand = (a, b) => a + Math.random() * (b - a);
const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------
// Real surf spots of Lanzarote's north-west coast
// ---------------------------------------------------------------------------
const SPOTS = [
  {
    id: 'famara', name: 'Playa de Famara', short: 'Famara', lat: 29.1215, lon: -13.552, bearing: 328,
    type: 'Beach break · A-frame peaks', size: '6–9 ft', level: 'Beginner', stars: 1,
    desc: 'Six kilometres of golden sand under the 600 m cliffs of the Risco de Famara. The surf capital of Lanzarote — and kitesurf heaven.',
    Hmin: 2.1, Hmax: 2.9, P: 6.5, st: 0.62, C: 3.2, uBreak: -150, uEnd: -18, peakS: 0, peel: 0, len: 240, setPeriod: 58, chop: 1.0,
    kites: 4, kiteAlong: 650, target: 9.0,
  },
  {
    id: 'sanjuan', name: 'San Juan', short: 'San Juan', lat: 29.1197, lon: -13.5745, bearing: 352,
    type: 'Right-hand reef', size: '8–11 ft', level: 'Intermediate', stars: 2,
    desc: 'A fast, peeling right over volcanic reef in front of the white houses of La Caleta de Famara.',
    Hmin: 2.5, Hmax: 3.4, P: 8.5, st: 0.8, C: 3.3, uBreak: -135, uEnd: -12, peakS: 0, peel: 1, len: 270, setPeriod: 55, chop: 0.85,
    kites: 2, kiteAlong: -900, target: 11.5,
  },
  {
    id: 'quemao', name: 'El Quemao', short: 'El Quemao', lat: 29.1085, lon: -13.666, bearing: 336,
    type: 'Left-hand reef · heavy barrels', size: '12–16 ft', level: 'Expert', stars: 3,
    desc: 'One of the heaviest waves in Europe. A thick left that throws over shallow lava rock off the village of La Santa.',
    Hmin: 3.6, Hmax: 4.8, P: 10.5, st: 1.0, C: 3.4, uBreak: -115, uEnd: -8, peakS: 0, peel: -1, len: 210, setPeriod: 52, chop: 0.7,
    kites: 0, kiteAlong: 0, target: 13.5,
  },
];
const RIVALS = [
  { name: 'Rayco', from: 'Caleta de Famara', look: { skin: '#3fb8ff', vest: '#ffd23d', shorts: '#16181d', hair: '#d9c48f', board: '#ffffff' } },
  { name: 'Naira', from: 'La Santa', look: { skin: '#ff5fa2', vest: '#2ecc71', shorts: '#2b3150', hair: '#ffffff', board: '#1ec8ff' } },
  { name: 'Yeray', from: 'Arrecife', look: { skin: '#7bd64a', vest: '#ff3d6e', shorts: '#1f3cff', hair: '#2b3150', board: '#ff3d6e' } },
];

// ---------------------------------------------------------------------------
// settings & save
// ---------------------------------------------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('wobblesurf.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('wobblesurf.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const settings = Object.assign({ time: 'morning', quality: isTouch ? 'low' : 'medium', music: true, sfx: true }, store.get('settings', {}));
const look = Object.assign({ skin: LOOKS.skins[0], vest: LOOKS.vests[0], shorts: LOOKS.shorts[0], hair: LOOKS.hair[0], board: LOOKS.boards[0] }, store.get('look2', {}));
const progress = Object.assign({ unlocked: 1, best: {} }, store.get('progress', {}));

// ---------------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 60000);
function resize() {
  const pr = Math.min(window.devicePixelRatio || 1, settings.quality === 'low' ? 0.85 : settings.quality === 'high' ? 1.75 : 1.25);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
// glow on sun sparkles and spray (not on the fastest setting)
let composer = null, renderPass = null, bloom = null;
function setupPost() {
  if (settings.quality === 'low') { composer = null; return; }
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(new THREE.Scene(), camera);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.35, 0.92);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass());
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}
function draw() {
  if (composer) { renderPass.scene = W.scene; composer.render(); } else renderer.render(W.scene, camera);
}
addEventListener('resize', () => { resize(); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); } });
resize();
setupPost();

const audio = new Audio();
audio.musicOn = settings.music; audio.sfxOn = settings.sfx;

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
const keys = {};
const pressed = {};
const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['Space'], grab: ['ShiftLeft', 'ShiftRight', 'KeyG'],
};
const held = (k) => KEYMAP[k].some((c) => keys[c]);
const hit = (k) => KEYMAP[k].some((c) => pressed[c]);
addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyC' && game.state === 'play') { camMode = (camMode + 1) % 3; toast(['Chase cam', 'Side cam', 'Drone cam'][camMode]); }
  if (e.code === 'KeyM') { settings.music = !settings.music; audio.setMusic(settings.music); store.set('settings', settings); syncSettingsUI(); }
  audio.start();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// touch buttons
document.querySelectorAll('[data-key]').forEach((b) => {
  const code = b.dataset.key;
  const on = (e) => { e.preventDefault(); if (!keys[code]) pressed[code] = true; keys[code] = true; b.classList.add('on'); audio.start(); };
  const off = (e) => { e.preventDefault(); keys[code] = false; b.classList.remove('on'); };
  b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
});

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
let island, albedoTex, depthTex;
let W = null; // current world
let W_env = null;
let camMode = 0;
const game = {
  state: 'boot', mode: 'free', spot: null, time: 0, heatTime: 0, heatLen: 300, waves: [], best: 0, timeScale: 1, fade: 0,
  rivals: [], paused: false, msgT: 0,
};
const S = { // the player's surfer
  mode: 'lineup', s: 0, u: 0, y: 0, psi: 0, V: 0, turn: 0, crouch: 0.3, lean: 0, pumpCD: 0, pumpA: 0,
  wave: null, dirSign: 1, camSide: 1, padSpeed: 0, padPhase: 0, padHeld: 0, popT: 0,
  vy: 0, airT: 0, spin: 0, flip: 0, spinV: 0, flipV: 0, grabT: 0, launchPsi: 0, airVrel: 0,
  inTube: false, tubeT: 0, foamT: 0, floatT: 0, floatDone: false, wipeT: 0, endT: 0, endReason: '',
  turnAcc: 0, turnT: 0, turnMinX: 9, turnMaxX: -9, turnStartAlong: 0, turnMinAlong: 9, cutT: -9,
  pos: new V3(), vel: new V3(), prevPos: new V3(), boardMat: new THREE.Matrix4(), bodyMat: new THREE.Matrix4(),
};
const score = { wave: 0, chain: [], chainPts: 0, chainT: 0, mult: 1, lostT: 0, tricks: 0 };

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------
async function boot() {
  setBoot(0.05, 'Loading Lanzarote elevation data…');
  island = await Island.load('assets/height.png', (p) => setBoot(0.05 + p * 0.4, 'Decoding real terrain…'));
  setBoot(0.5, 'Painting the island…');
  albedoTex = await new THREE.TextureLoader().loadAsync('assets/albedo.jpg');
  albedoTex.flipY = false;
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  albedoTex.needsUpdate = true;
  depthTex = island.depthTexture();
  setBoot(0.7, 'Building Famara…');
  await nextFrame();
  setupSpot(SPOTS[0]);
  setBoot(0.9, 'Waxing boards…');
  drawIslandMap();
  await nextFrame();
  renderer.compile(W.scene, camera);
  setBoot(1, 'Surf’s up!');
  game.state = 'title';
  const want = new URLSearchParams(location.search).get('spot');
  const sp = SPOTS.find((s) => s.id === want);
  setTimeout(() => {
    $('boot').classList.add('hidden');
    if (sp) startSession(sp, 'free'); else showScreen('title');
  }, 350);
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
function setBoot(p, txt) { $('bootFill').style.width = Math.round(p * 100) + '%'; $('bootText').textContent = txt; }

// ---------------------------------------------------------------------------
// world per spot
// ---------------------------------------------------------------------------
function disposeWorld() {
  if (!W) return;
  W.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && m.map !== albedoTex) m.map.dispose(); m.dispose(); });
  });
  W = null;
}

function setupSpot(spot) {
  disposeWorld();
  const scene = new THREE.Scene();
  // reflections for the glossy surfer and board, baked from the sky
  const envScene = new THREE.Scene();
  const envSky = new Sky(envScene);
  envSky.set(settings.time, envScene, renderer);
  envSky.mesh.scale.setScalar(50);
  const pm = new THREE.PMREMGenerator(renderer);
  if (W_env) W_env.dispose();
  W_env = pm.fromScene(envScene, 0.03);
  pm.dispose();
  setEnvMap(W_env.texture);
  const sky = new Sky(scene);
  sky.set(settings.time, scene, renderer);
  const b = spot.bearing * Math.PI / 180;
  const n = { x: Math.sin(b), z: -Math.cos(b) };
  const sw = ll2w(spot.lat, spot.lon);
  const origin = island.findCoast(sw.x, sw.z, n.x, n.z);
  spot.d = { x: -n.x, z: -n.z };
  spot.a = { x: -spot.d.z, z: spot.d.x };
  spot.origin = origin;
  const waves = new WaveSystem(spot);
  const q = settings.quality;
  const depthXf = new THREE.Vector4(GEO.XMIN - origin.x, GEO.ZMIN - origin.z, 1 / GEO.S, 1 / GEO.S);
  const ocean = new Ocean(scene, waves, { depthTex, depthXf, sky, gridA: q === 'low' ? 120 : q === 'high' ? 230 : 180, gridD: q === 'low' ? 220 : q === 'high' ? 420 : 320 });
  const terrain = buildTerrain(island, origin, albedoTex, q);
  scene.add(terrain);
  scene.add(buildVillages(island, origin, q));
  scene.add(buildBeach(island, origin, spot, q));
  const amb = new Ambient(scene, spot, island, origin);
  const spray = new Spray(scene, sky, q === 'low' ? 1400 : q === 'high' ? 5000 : 3200);
  const trail = new Trail(scene, sky);
  const rag = new Ragdoll(scene, look);
  const floor = (x, z) => island.h(x + origin.x, z + origin.z);
  // locals sitting in the line-up (they are also your contest rivals)
  const locals = RIVALS.map((r, i) => {
    const sit = makeLineupSurfer(r.look, 'sit');
    const stand = makeLineupSurfer(r.look, 'stand');
    stand.visible = false;
    scene.add(sit, stand);
    return { ...r, sit, stand, s: spot.peakS + (i - 1) * 16 + rand(-4, 4), u: spot.uBreak - 6 - i * 4, ph: rand(0, 6), riding: null, rideT: 0, cool: rand(5, 20), heat: [] };
  });
  W = { scene, sky, waves, ocean, terrain, amb, spray, trail, rag, spot, origin, floor, locals };
  game.spot = spot;
  resetToLineup(true);
}

// convert wave-frame (s,u) to scene x,z
const toXZ = (s, u, out = {}) => { const a = W.spot.a, d = W.spot.d; out.x = a.x * s + d.x * u; out.z = a.z * s + d.z * u; return out; };
const fwdOf = (psi) => ({ x: -Math.sin(psi), z: -Math.cos(psi) });
const psiOf = (x, z) => Math.atan2(-x, -z);

function surfNormal(x, z, out) {
  const e = 0.35, wv = W.waves;
  const h = wv.height(x, z), hx = wv.height(x + e, z), hz = wv.height(x, z + e);
  return out.set(h - hx, e, h - hz).normalize();
}

// ---------------------------------------------------------------------------
// game flow
// ---------------------------------------------------------------------------
function startSession(spot, mode) {
  game.mode = mode;
  if (W.spot !== spot) setupSpot(spot);
  game.time = 0; game.heatTime = mode === 'contest' ? game.heatLen : 0;
  game.waves = []; game.best = 0;
  for (const L of W.locals) L.heat = [];
  game.state = 'play';
  resetToLineup(true);
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  $('hudSpot').textContent = spot.name;
  $('hudBoard').classList.toggle('hidden', mode !== 'contest');
  updateBoardUI();
  if (mode === 'contest') { audio.horn(); bigMsg('HEAT STARTS', `Best two waves count · beat ${W.locals.map((l) => l.name).join(', ')}`); }
  else bigMsg(spot.short.toUpperCase(), 'Free surf · Hold ↑ to paddle into a wave');
}

function resetToLineup(instant) {
  const sp = W.spot;
  S.mode = 'lineup';
  S.s = sp.peakS + rand(-5, 5); S.u = sp.uBreak + 4;
  S.psi = psiOf(-sp.d.x, -sp.d.z); // facing out to sea
  S.V = 0; S.padSpeed = 0; S.padHeld = 0; S.wave = null; S.inTube = false; S.tubeT = 0; S.foamT = 0;
  S.turn = 0; S.crouch = 0.3; S.vy = 0;
  score.wave = 0; score.chain = []; score.chainPts = 0; score.mult = 1;
  W.trail.clear();
  const p = toXZ(S.s, S.u);
  S.pos.set(p.x, W.waves.height(p.x, p.z), p.z);
  computeBoardMat();
  W.rag.snap(S.boardMat, poseSit, { t: 0 });
  if (!instant) { game.fade = 1; }
}

function togglePause() {
  if (game.state === 'play') { game.state = 'pause'; showScreen('pause'); }
  else if (game.state === 'pause') { game.state = 'play'; showScreen(null); }
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------
function addTrick(name, pts, big) {
  score.chain.push(name);
  score.chainPts += pts;
  score.mult = Math.min(5, 1 + (score.chain.length - 1) * 0.5);
  score.chainT = 2.6;
  score.tricks++;
  popup(name, Math.round(pts), big);
  if (big) audio.big(); else audio.chime(Math.min(3, score.chain.length));
}
function bankChain() {
  if (!score.chain.length) return;
  const pts = Math.round(score.chainPts * score.mult);
  score.wave += pts;
  if (score.chain.length > 1) popup(`COMBO ×${score.mult.toFixed(1)}`, pts, false, 'combo');
  score.chain = []; score.chainPts = 0; score.mult = 1;
}
function loseChain() {
  if (score.chain.length) popup('COMBO LOST', 0, false, 'lost');
  score.chain = []; score.chainPts = 0; score.mult = 1;
}
const to10 = (p) => Math.round(1000 * (1 - Math.exp(-p / 3400))) / 100;

function endRide(reason, good) {
  if (S.mode === 'ended') return;
  if (good) bankChain(); else loseChain();
  const sc = to10(score.wave);
  if (S.wave) S.wave.ridden = true;
  if (score.wave > 0 || good) {
    game.waves.push(sc);
    game.best = Math.max(game.best, sc);
    bigMsg(sc.toFixed(2), reason, 'score');
    if (sc >= 8) audio.cheer();
  } else bigMsg('', reason, 'small');
  S.mode = 'ended';
  S.endT = 0;
  updateBoardUI();
}

function heatTotal(arr) { const s = [...arr].sort((a, b) => b - a); return (s[0] || 0) + (s[1] || 0); }

function updateBoardUI() {
  const rows = [{ name: 'You', you: true, waves: game.waves }].concat(W.locals.map((l) => ({ name: l.name, waves: l.heat })));
  rows.forEach((r) => (r.total = heatTotal(r.waves)));
  rows.sort((a, b) => b.total - a.total);
  $('hudBoard').innerHTML = rows.map((r, i) => `<div class="row ${r.you ? 'you' : ''}"><span>${i + 1}. ${r.name}</span><b>${r.total.toFixed(2)}</b></div>`).join('');
  $('hudWaves').textContent = game.mode === 'contest'
    ? `Waves ${game.waves.length} · Heat ${heatTotal(game.waves).toFixed(2)}`
    : `Waves ${game.waves.length} · Best ${game.best.toFixed(2)}`;
  return rows;
}

function endHeat() {
  game.state = 'results';
  const rows = updateBoardUI();
  const place = rows.findIndex((r) => r.you) + 1;
  const sp = W.spot;
  const idx = SPOTS.indexOf(sp);
  const won = place === 1;
  if (won && progress.unlocked < idx + 2) progress.unlocked = Math.min(SPOTS.length, idx + 2);
  progress.best[sp.id] = Math.max(progress.best[sp.id] || 0, heatTotal(game.waves));
  store.set('progress', progress);
  $('resTitle').textContent = won ? '🏆 YOU WIN!' : place === 2 ? '2nd place!' : `${place}${place === 3 ? 'rd' : 'th'} place`;
  $('resSub').textContent = won
    ? (idx < SPOTS.length - 1 ? `${SPOTS[idx + 1].name} is unlocked!` : 'Champion of Lanzarote! You conquered El Quemao.')
    : 'So close — paddle back out and try again.';
  $('resTable').innerHTML = rows.map((r, i) => `<div class="row ${r.you ? 'you' : ''}"><span>${i + 1}. ${r.name}</span><span class="w">${[...r.waves].sort((a, b) => b - a).slice(0, 2).map((x) => x.toFixed(2)).join(' + ') || '–'}</span><b>${r.total.toFixed(2)}</b></div>`).join('');
  $('btnNextSpot').classList.toggle('hidden', !(won && idx < SPOTS.length - 1));
  showScreen('results');
  if (won) audio.big(); else audio.bad();
}

// ---------------------------------------------------------------------------
// physics
// ---------------------------------------------------------------------------
const H = 1 / 120;
let acc = 0;

function computeBoardMat() {
  const p = S.pos;
  const nrm = surfNormal(p.x, p.z, _n);
  if (S.mode === 'air' || S.mode === 'airfail') {
    const e = new THREE.Euler(S.flip + clamp(S.vy * 0.03, -0.4, 0.4), S.launchPsi + S.spin, S.airRoll || 0, 'YXZ');
    S.boardMat.makeRotationFromEuler(e).setPosition(p);
    S.bodyMat.copy(S.boardMat);
    return;
  }
  const f = fwdOf(S.psi);
  _f.set(f.x, 0, f.z);
  _f.addScaledVector(nrm, -_f.dot(nrm)).normalize();
  _back.copy(_f).negate();
  _r.crossVectors(_f, nrm).normalize(); // right
  const bank = clamp(S.turn * Math.max(S.V, 3) * 0.045, -1.1, 1.1);
  _up.copy(nrm).addScaledVector(_r, bank).normalize();
  _r.crossVectors(_up, _back).normalize();
  S.boardMat.makeBasis(_r, _up, _back).setPosition(p.x, p.y + 0.02, p.z);
  // body frame: more upright than the board
  _up2.copy(_up).lerp(_worldUp, 0.55).normalize();
  _r2.crossVectors(_up2, _back).normalize();
  _b2.crossVectors(_r2, _up2).normalize();
  S.bodyMat.makeBasis(_r2, _up2, _b2).setPosition(p.x, p.y + 0.02, p.z);
}
const _n = new V3(), _f = new V3(), _r = new V3(), _up = new V3(), _back = new V3(), _up2 = new V3(), _r2 = new V3(), _b2 = new V3(), _worldUp = new V3(0, 1, 0);

function input() {
  return {
    steer: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
    up: held('up'), down: held('down'), jump: held('jump'), jumpHit: hit('jump'), grab: held('grab') || (held('jump') && S.mode === 'air'),
  };
}

function fixedStep(h, inp) {
  const wv = W.waves;
  wv.update(h);
  game.time += h;
  if (S.mode === 'lineup') stepLineup(h, inp);
  else if (S.mode === 'popup' || S.mode === 'ride') stepRide(h, inp);
  else if (S.mode === 'air') stepAir(h, inp);
  else if (S.mode === 'wipe') stepWipe(h);
  else if (S.mode === 'ended') stepEnded(h, inp);
  stepLocals(h);
}

// --- waiting / paddling in the line-up ------------------------------------------
function stepLineup(h, inp) {
  const sp = W.spot, wv = W.waves;
  const paddling = inp.up;
  S.padHeld = paddling ? S.padHeld + h : 0;
  // ← → turn the board, ↑ paddles forward the way you're facing, ↓ back-paddles
  let turn = -inp.steer * 1.7;
  // help: when a wave is about to reach you and you're paddling, swing round to face the beach
  let waveNear = false;
  for (const w of wv.waves) { const tt = (S.u - w.uc) / w.c; if (!w.ridden && !w.lb && tt > -0.3 && tt < 3.5) waveNear = true; }
  if (paddling && waveNear && !inp.steer) {
    const want = psiOf(sp.d.x, sp.d.z);
    turn = clamp(wrapPi(want - S.psi) * 2.5, -1.6, 1.6);
  }
  S.psi = wrapPi(S.psi + turn * h);
  S.padSpeed = lerp(S.padSpeed, paddling ? 2.6 : inp.down ? -0.8 : 0, 1 - Math.exp(-h * (paddling ? 1.8 : 1.4)));
  const f = fwdOf(S.psi);
  const vx = f.x * S.padSpeed, vz = f.z * S.padSpeed;
  S.s += (vx * sp.a.x + vz * sp.a.z) * h;
  S.u += (vx * sp.d.x + vz * sp.d.z) * h;
  S.s = clamp(S.s, sp.peakS - 450, sp.peakS + 450);
  S.u = clamp(S.u, sp.uBreak - 260, Math.min(sp.uEnd - 4, -12));
  S.padPhase += h * (paddling ? 6.5 : Math.abs(turn) > 0.1 ? 4 : 0);
  // whitewater pushes you toward the beach
  const p = toXZ(S.s, S.u);
  const foam = wv.foamAt(p.x, p.z);
  if (foam > 0.35) { S.u += foam * 2.5 * h; S.washT = (S.washT || 0) + h; } else S.washT = 0;
  S.pos.set(p.x, wv.height(p.x, p.z), p.z);
  computeBoardMat();
  const prone = paddling || Math.abs(S.padSpeed) > 0.4 || Math.abs(turn) > 0.1;
  S.prone = lerp(S.prone || 0, prone ? 1 : 0, 1 - Math.exp(-h * 5));
  W.rag.active(h, S.bodyMat, poseSit, { t: game.time }, (o, q) => poseLie(o, { paddle: S.padPhase, paddleAmt: paddling || Math.abs(turn) > 0.1 ? 1 : 0 }), S.prone, 1);
  // catch a wave: paddling, roughly facing the beach, with the face under you
  const facing = f.x * sp.d.x + f.z * sp.d.z;
  for (const w of wv.waves) {
    if (w.ridden || w.lb || w.fade < 0.6) continue;
    const L = wv.local(w, S.s, S.u);
    if (L.Hh < 0.75 || L.br > 0.45) continue;
    if (L.du > 0.0 && L.du < 1.4 * L.Lf && paddling && facing > 0.2 && S.padSpeed > 0.9 && S.padHeld > 0.3) { catchWave(w, inp); return; }
  }
}

function catchWave(w, inp) {
  const sp = W.spot;
  S.wave = w; w.ridden = true;
  S.mode = 'popup'; S.popT = 0;
  let dir = w.peel;
  { const f = fwdOf(S.psi), ea = f.x * sp.a.x + f.z * sp.a.z; if (Math.abs(ea) > 0.3) dir = Math.sign(ea); } // go the way you're pointing
  S.dirSign = dir; S.camSide = dir;
  const th = 0.42;
  const ex = Math.cos(th) * sp.a.x * dir + Math.sin(th) * sp.d.x, ez = Math.cos(th) * sp.a.z * dir + Math.sin(th) * sp.d.z;
  S.psi = psiOf(ex, ez);
  S.V = Math.max(7.5, w.P + 2);
  const L0 = W.waves.local(w, S.s, S.u);
  S.u = w.uc + Math.min(L0.du, 0.5 * L0.Lf);
  S.turn = 0; S.tubeT = 0; S.inTube = false; S.foamT = 0; S.floatDone = false;
  score.wave = 0; score.chain = []; score.chainPts = 0; score.mult = 1;
  W.trail.clear();
  audio.burst(0.5, 1600, 0.3, 'lowpass', 0.4);
  toast(dir === w.peel ? (dir > 0 ? 'Going right →' : '← Going left') : 'Wrong way! Turn around!');
}

// --- riding the face --------------------------------------------------------------
function stepRide(h, inp) {
  const sp = W.spot, wv = W.waves, w = S.wave, a = sp.a, d = sp.d;
  const popping = S.mode === 'popup';
  if (popping) { S.popT += h; if (S.popT > 0.5) S.mode = 'ride'; }
  let L = wv.local(w, S.s, S.u);
  // steering
  const ctrl = popping ? 0.4 : 1;
  const steer = inp.steer * ctrl;
  const target = steer * (2.25 + 1.0 * S.crouch) * (S.V > 3 ? 1 : 0.55);
  S.turn = lerp(S.turn, target, 1 - Math.exp(-h * 10));
  S.psi -= S.turn * h;
  const f = fwdOf(S.psi);
  const ea = f.x * a.x + f.z * a.z, ed = f.x * d.x + f.z * d.z;
  const along = ea * w.peel; // >0 = going toward the open shoulder
  // slope
  const p = toXZ(S.s, S.u);
  const hs = (wv.height(p.x + a.x * 0.4, p.z + a.z * 0.4) - wv.height(p.x - a.x * 0.4, p.z - a.z * 0.4)) / 0.8;
  const hu = (wv.height(p.x + d.x * 0.4, p.z + d.z * 0.4) - wv.height(p.x - d.x * 0.4, p.z - d.z * 0.4)) / 0.8;
  const slopeAlong = hs * ea + hu * ed;
  S.V += -9.81 * 0.85 * slopeAlong * h;
  const onFace = L.du > -0.6 && L.x < 1.3 && L.Hh > 0.5;
  const pocket = (1 - L.br) * L.st * ss(1.25, 0.05, L.x) * ss(-1.0, 0.0, L.du) * Math.exp(-Math.max(L.ds, 0) / 120) * (L.Hh > 0.6 ? 1 : 0);
  S.V += (2.7 * pocket * Math.max(0, along) + 0.7 * Math.min(1, Math.max(0, -hu)) * (onFace ? 1 : 0)) * h;
  S.V -= (0.07 * S.V + 0.0045 * S.V * S.V) * h;
  S.V -= Math.abs(S.turn) * S.V * 0.085 * h;
  if (L.br > 0.4 && L.du > -1 && L.du < 2 * L.Lf) S.V -= 2.5 * h; // whitewater is slow
  S.pumpCD -= h;
  if (inp.up && !popping && S.pumpCD <= 0 && onFace && S.V < 19) { S.V += 1.3; S.pumpCD = 0.45; S.pumpA = 1; }
  S.pumpA = Math.max(0, S.pumpA - h * 3);
  S.V = clamp(S.V, 0, 23);
  // crouch: hold ↓, or automatically inside the tube
  const tubeAhead = L.T > 0.4 && L.x < L.T && L.ds > -3 && L.ds < 20;
  const cT = inp.down ? 1 : tubeAhead ? 0.85 : 0.22 + 0.3 * Math.min(1, Math.abs(S.turn) / 2.5) + S.pumpA * 0.3;
  S.crouch = lerp(S.crouch, cT, 1 - Math.exp(-h * 8));
  // the wave carries you along with it when you're on the face
  let grip = L.du < -0.5 ? ss(-3.0, -0.5, L.du) : ss(3.5 * L.Lf, 1.3 * L.Lf, L.du);
  if (L.br > 0.3 && L.du > -2 && L.du < 2.5 * L.Lf) grip = Math.max(grip, Math.min(1, L.br * 1.5));
  const vx = f.x * S.V + d.x * w.c * grip, vz = f.z * S.V + d.z * w.c * grip;
  S.s += (vx * a.x + vz * a.z) * h;
  S.u += (vx * d.x + vz * d.z) * h;
  toXZ(S.s, S.u, p);
  const y = wv.height(p.x, p.z);
  S.prevPos.copy(S.pos);
  S.pos.set(p.x, y, p.z);
  S.vel.subVectors(S.pos, S.prevPos).multiplyScalar(1 / h);
  L = wv.local(w, S.s, S.u);
  computeBoardMat();
  const pose = { c: S.crouch, lean: clamp(S.turn * 0.35, -0.8, 0.8), t: game.time, wob: Math.abs(S.turn) * 0.5, tilt: S.pumpA * 0.25 };
  if (popping) W.rag.active(h, S.bodyMat, poseStand, pose, (o) => poseLie(o, {}), 1 - ss(0, 0.5, S.popT), 1);
  else W.rag.active(h, S.bodyMat, poseStand, pose, null, 0, 1);
  if (!popping) { ridePoints(h, L, along); }
  score.wave += S.V * 0.5 * h;
  // spray off the rail in hard turns
  const carve = Math.abs(S.turn) * S.V;
  {
    const back = fwdOf(S.psi);
    // a constant little fan of spray off the rail, a big rooster tail when you carve hard
    const side = Math.sign(S.turn) || -w.peel * Math.sign(ea || 1);
    const rx = -back.z * side, rz = back.x * side;
    const rate = (S.V > 4 ? S.V * 1.6 : 0) + Math.max(0, carve - 8) * 7;
    S.sprayAcc = (S.sprayAcc || 0) + rate * h;
    while (S.sprayAcc > 1) {
      S.sprayAcc--;
      const big = carve > 12;
      const k = rand(0.3, 1);
      W.spray.emit(p.x - back.x * rand(0.5, 1), y + 0.15, p.z - back.z * rand(0.5, 1),
        rx * rand(1.5, big ? 8 : 3.5) - back.x * 2 + vx * 0.35, rand(1.5, big ? 7 : 3.5), rz * rand(1.5, big ? 8 : 3.5) - back.z * 2 + vz * 0.35,
        rand(0.18, big ? 0.7 : 0.4) * k, rand(0.4, big ? 1.1 : 0.7), 1, 0.9);
    }
    if (carve > 12 && Math.random() < 0.05) audio.spray(Math.min(1, carve / 25));
  }
  // ---- launch into the air?
  const relU = S.V * ed + w.c * (grip - 1);
  if (!popping && L.x < 0.06 && L.du > -0.8 && relU < -3.2 && L.br < 0.35 && L.Hh > 0.9) { launch(L, relU, inp.jump); return; }
  if (!popping && inp.jumpHit && L.x < 0.35 && L.du > -0.8 && S.V > 5 && L.Hh > 0.7) { launch(L, Math.min(relU, -2), true); return; }
  // ---- barrels
  const inTubeNow = L.T > 0.45 && L.ds > -2.5 && L.ds < 18 && L.x > 0.1 && L.x < L.T * 0.92 && L.Hh > 1.3;
  if (inTubeNow) { S.tubeT += h; score.wave += 60 * h; }
  if (S.inTube && !inTubeNow) {
    if (S.tubeT > 0.35) {
      const nm = S.tubeT > 2.5 ? 'MASSIVE BARREL' : S.tubeT > 1.2 ? 'DEEP BARREL' : 'BARREL';
      addTrick(nm, 400 + 750 * S.tubeT, S.tubeT > 1.2);
    }
    S.tubeT = 0;
  }
  S.inTube = inTubeNow;
  // ---- wipeouts
  if (L.T > 0.75 && L.ds > -4 && L.ds < 1.5 && L.x > L.T * 0.82 && L.x < L.T * 1.25) return wipe('The lip landed on you!');
  const movingOn = along > 0.55 && S.V * along > w.P * 0.8;
  if (L.x < 0.07 && L.du > -0.5 && L.ds > -2 && L.ds < 8 && L.T > 0.3 && !movingOn) return wipe('Over the falls!');
  if (L.ds < -2.5 && L.br > 0.4 && L.du > -2 && L.du < 2 * L.Lf) { S.foamT += h; if (S.foamT > 0.7) return wipe('Eaten by the foam ball!'); }
  else S.foamT = Math.max(0, S.foamT - h * 2);
  // floater over the breaking section
  if (L.x < 0.08 && L.du > -0.8 && L.br > 0.2 && along > 0.55 && S.V > 7) { S.floatT += h; if (S.floatT > 0.5 && !S.floatDone) { S.floatDone = true; addTrick('FLOATER', 320); } }
  else { S.floatT = 0; if (L.x > 0.4) S.floatDone = false; }
  // ---- ride ends
  if (L.du < -2.4) return endRide(relU < -4 ? 'Kick out!' : 'Pulled off the back', true);
  if (w.fade < 0.35) return endRide('Rode it to the end!', true);
  if (S.V < 1.3 && L.x > 1.4) return endRide('Lost the wave', true);
  if (w.closeout && L.ds < 0 && L.br > 0.5 && L.du > -1) return wipe('Closed out!');
}

// tricks from turns
function ridePoints(h, L, along) {
  const tr = Math.abs(S.turn);
  if (tr > 1.0) {
    if (S.turnT === 0) { S.turnStartAlong = along; S.turnMinX = 9; S.turnMaxX = -9; S.turnMinAlong = 9; S.turnSign = Math.sign(S.turn); }
    if (Math.sign(S.turn) !== S.turnSign) finishTurn(L);
    S.turnT += h; S.turnAcc += Math.abs(S.turn) * h;
    S.turnMinX = Math.min(S.turnMinX, L.x); S.turnMaxX = Math.max(S.turnMaxX, L.x);
    S.turnMinAlong = Math.min(S.turnMinAlong, along);
  } else if (S.turnT > 0) finishTurn(L, along);
}
function finishTurn(L, along) {
  const ang = S.turnAcc, t = S.turnT, spd = S.V;
  S.turnT = 0; S.turnAcc = 0;
  if (spd < 5) return;
  if (S.turnStartAlong > 0.3 && S.turnMinAlong < -0.35) {
    S.cutT = game.time;
    addTrick(ang > 3.4 ? 'ROUNDHOUSE CUTBACK' : 'CUTBACK', ang > 3.4 ? 650 : 380, ang > 3.4);
    return;
  }
  if (S.turnMinX < 0.3 && ang > 1.5) {
    const curl = L.T > 0.25 && L.ds < 16 && L.ds > -6;
    if (curl) addTrick('RE-ENTRY', 460 + spd * 12);
    else if (t < 0.7) addTrick('SNAP', 320 + spd * 10);
    else addTrick('CARVE', 250 + spd * 10);
    return;
  }
  if (S.turnMaxX > 0.65 && ang > 1.2) addTrick('BOTTOM TURN', 90 + spd * 4);
}

// --- airs ---------------------------------------------------------------------
function launch(L, relU, jump) {
  S.mode = 'air';
  S.airT = 0; S.spin = 0; S.flip = 0; S.spinV = 0; S.flipV = 0; S.grabT = 0; S.airRoll = 0;
  S.launchPsi = S.psi;
  S.vy = clamp(Math.abs(relU) * 0.55 + 0.55 * L.Hh + (jump ? 2.6 : 0), 2.5, 12.5);
  S.airVrel = relU;
  const f = fwdOf(S.psi), a = W.spot.a;
  S.airEa = f.x * a.x + f.z * a.z;
  S.y = S.pos.y;
  audio.burst(0.3, 3000, 0.2, 'highpass', 0.5);
  for (let i = 0; i < 18; i++) W.spray.emit(S.pos.x + rand(-0.5, 0.5), S.pos.y, S.pos.z + rand(-0.5, 0.5), rand(-2, 2), rand(2, 6), rand(-2, 2), rand(0.25, 0.6), rand(0.5, 1.1), 1, 0.9);
}

function stepAir(h, inp) {
  const sp = W.spot, wv = W.waves, w = S.wave, a = sp.a, d = sp.d;
  S.airT += h;
  S.vy -= 9.81 * h;
  S.y += S.vy * h;
  const relU = S.airVrel * 0.18 + 2.0;
  S.s += S.V * S.airEa * 0.95 * h;
  S.u += (w.c + relU) * h;
  // spins and flips
  S.spinV = lerp(S.spinV, -inp.steer * 6.6, 1 - Math.exp(-h * 9));
  const fl = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  S.flipV = lerp(S.flipV, fl * 5.6, 1 - Math.exp(-h * 9));
  S.spin += S.spinV * h; S.flip += S.flipV * h;
  if (inp.grab) S.grabT += h;
  const p = toXZ(S.s, S.u);
  S.prevPos.copy(S.pos);
  S.pos.set(p.x, S.y, p.z);
  S.vel.subVectors(S.pos, S.prevPos).multiplyScalar(1 / h);
  computeBoardMat();
  W.rag.active(h, S.bodyMat, poseStand, { c: inp.grab ? 0.95 : 0.7, lean: 0, t: game.time, wob: 1.5, grab: inp.grab, armUp: inp.grab ? 0 : 0.25 }, null, 0, 0.75);
  const hw = wv.height(p.x, p.z);
  if (S.y <= hw && S.vy < 0) land(hw);
}

function land(hw) {
  const sp = W.spot, w = S.wave, wv = W.waves;
  const spin = wrapPi(S.spin), flip = wrapPi(S.flip);
  const spins = Math.round(Math.abs(S.spin) / Math.PI); // in 180s
  const flips = Math.round(Math.abs(S.flip) / (Math.PI * 2));
  const clean = Math.abs(flip) < 1.0 && (Math.abs(spin) < 0.95 || Math.abs(spin) > Math.PI - 0.8);
  S.pos.y = hw;
  if (!clean) { S.y = hw; return wipe(Math.abs(flip) >= 1.0 ? 'Landed on your head!' : 'Sketchy landing!'); }
  // name the trick
  let name = '';
  const deg = spins * 180;
  if (flips > 0) name = spins >= 1 ? (flips > 1 ? 'DOUBLE RODEO' : 'RODEO FLIP') : (flips > 1 ? 'DOUBLE ' : '') + (S.flip > 0 ? 'FRONTFLIP' : 'BACKFLIP');
  else if (deg >= 720) name = '720 ROTOR!!';
  else if (deg >= 540) name = '540 ROTOR';
  else if (deg >= 360) name = 'FULL ROTATION';
  else if (deg >= 180) name = 'AIR REVERSE';
  else name = S.airT > 0.7 ? 'BIG AIR' : 'AIR';
  if (S.grabT > 0.2) name = name + ' + GRAB';
  const pts = 220 + S.airT * 320 + spins * 430 + flips * 1300 + (S.grabT > 0.2 ? 200 + S.grabT * 180 : 0);
  addTrick(name, pts, spins >= 2 || flips >= 1 || S.airT > 1.4);
  // land going down the line
  const dir = Math.sign(S.airEa) || S.dirSign;
  const th = 0.38;
  S.psi = psiOf(Math.cos(th) * sp.a.x * dir + Math.sin(th) * sp.d.x, Math.cos(th) * sp.a.z * dir + Math.sin(th) * sp.d.z);
  S.V = Math.max(w.P * 1.05 + 1, S.V * 0.95);
  S.mode = 'ride';
  S.turn = 0; S.turnT = 0; S.turnAcc = 0;
  audio.splash(0.5);
  for (let i = 0; i < 25; i++) W.spray.emit(S.pos.x + rand(-0.6, 0.6), hw + 0.1, S.pos.z + rand(-0.6, 0.6), rand(-3, 3), rand(1.5, 4.5), rand(-3, 3), rand(0.3, 0.7), rand(0.4, 0.9), 1, 0.9);
  const L = wv.local(w, S.s, S.u);
  if (L.du < -0.8) endRide('Landed over the back!', true);
}

// --- wipeouts ------------------------------------------------------------------
function wipe(reason) {
  S.mode = 'wipe';
  S.wipeT = 0;
  S.wipeReason = reason;
  loseChain();
  popup(reason, 0, false, 'wipe');
  audio.splash(1.2);
  audio.bad();
  shake(0.6);
  const bl = W.rag.board.userData.length || 1.95;
  W.rag.goLimp(S.boardMat, S.vel, bl);
  // throw the body a bit
  const v = S.vel.clone().multiplyScalar(H);
  for (let i = 0; i < W.rag.P.length; i++) {
    W.rag.O[i].copy(W.rag.P[i]).sub(v).add(new V3(rand(-0.01, 0.01), -0.03 - Math.random() * 0.02, rand(-0.01, 0.01)));
  }
  for (let i = 0; i < 60; i++) W.spray.emit(S.pos.x + rand(-1, 1), S.pos.y + 0.2, S.pos.z + rand(-1, 1), rand(-4, 4) + S.vel.x * 0.3, rand(2, 8), rand(-4, 4) + S.vel.z * 0.3, rand(0.4, 1.1), rand(0.6, 1.4), 1, 0.95);
  $('drops').classList.remove('show'); void $('drops').offsetWidth; $('drops').classList.add('show');
}

function stepWipe(h) {
  S.wipeT += h;
  const wv = W.waves, sp = W.spot;
  const c = W.rag.P[J.pelvis];
  let foam = wv.foamAt(c.x, c.z);
  // the curl that got you keeps rolling you for a moment
  if (S.wipeT < 1.6) foam = Math.max(foam, 1.1 - S.wipeT * 0.5);
  W.rag.limpStep(h, wv, { foam, d: sp.d3 || (sp.d3 = new V3(sp.d.x, 0, sp.d.z)), a: sp.a3 || (sp.a3 = new V3(sp.a.x, 0, sp.a.z)), floor: W.floor });
  W.rag.boardMatrixFromLimp(S.boardMat);
  S.pos.copy(c);
  if (S.wipeT > 3.4) endRide(S.wipeReason, false);
}

function stepEnded(h, inp) {
  S.endT += h;
  // keep simulating whatever the body is doing
  if (W.rag.limp) {
    const sp = W.spot, c = W.rag.P[J.pelvis];
    W.rag.limpStep(h, W.waves, { foam: W.waves.foamAt(c.x, c.z), d: sp.d3, a: sp.a3, floor: W.floor });
    W.rag.boardMatrixFromLimp(S.boardMat);
  } else {
    // sink down / sit on the board as the wave goes
    const p = S.pos;
    p.y = W.waves.height(p.x, p.z);
    S.V *= Math.exp(-h * 2);
    const f = fwdOf(S.psi);
    p.x += f.x * S.V * h; p.z += f.z * S.V * h;
    computeBoardMat();
    W.rag.active(h, S.bodyMat, poseSit, { t: game.time }, null, 0, 1);
  }
  if (S.endT > 2.4) { game.fade = 1; resetToLineup(false); }
}

// --- locals / rivals ---------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function stepLocals(h) {
  const wv = W.waves, sp = W.spot;
  for (const L of W.locals) {
    L.cool -= h;
    if (L.riding) {
      const w = L.riding;
      L.rideT += h;
      const k = wv.local(w, L.rs, L.ru);
      // trim along in front of the curl
      const want = w.sb + w.peel * (9 + 5 * Math.sin(L.rideT * 0.9));
      L.rs += clamp(want - L.rs, -1, 1) * 2 * h + w.peel * w.P * h;
      const tx = 0.35 + 0.25 * Math.sin(L.rideT * 1.3);
      L.ru = lerp(L.ru, w.uc + tx * k.Lf, 1 - Math.exp(-h * 3));
      if (L.rideT > L.rideLen || w.fade < 0.4 || k.Hh < 0.5) {
        L.riding = null; L.stand.visible = false; L.sit.visible = true;
        L.s = sp.peakS + rand(-30, 30); L.u = sp.uBreak - rand(4, 18); L.cool = rand(25, 50);
        if (game.mode === 'contest' && game.state === 'play') { L.heat.push(L.score); updateBoardUI(); }
      }
    } else {
      // drift around in the line-up
      L.s += Math.sin(game.time * 0.1 + L.ph) * 0.3 * h;
      for (const w of wv.waves) {
        if (L.cool > 0 || w.ridden || w.lb || !w.broke || w.bk > 0.6) continue;
        if (Math.abs(L.s - w.s0) > 28) continue;
        if (S.wave === w) continue;
        // priority: if you're already paddling for it, it's yours. Otherwise the locals go about half the time
        if (game.state === 'play' && S.mode === 'lineup' && S.padHeld > 0 && Math.abs(S.s - w.s0) < 45) continue;
        if (w.roll === undefined) w.roll = Math.random();
        if (w.roll > (game.mode === 'contest' ? 0.55 : 0.4)) continue;
        // take it!
        w.lb = L.name;
        L.riding = w; L.rideT = 0; L.rideLen = rand(10, 18); L.rs = w.sb + w.peel * 6; L.ru = w.uc + 0.4 * 3;
        const skill = game.mode === 'contest' ? sp.target / 2 : 5;
        L.score = Math.round(clamp(rand(skill - 2.2, skill + 1.6), 1.5, 9.8) * 100) / 100;
        L.sit.visible = false; L.stand.visible = true;
        break;
      }
    }
  }
}
function renderLocals() {
  const wv = W.waves, sp = W.spot;
  for (const L of W.locals) {
    if (L.riding) {
      const w = L.riding;
      const p = toXZ(L.rs, L.ru);
      const y = wv.height(p.x, p.z);
      const th = 0.25 * Math.sin(L.rideT * 1.3 + 1);
      const fx = Math.cos(th) * sp.a.x * w.peel + Math.sin(th) * sp.d.x, fz = Math.cos(th) * sp.a.z * w.peel + Math.sin(th) * sp.d.z;
      surfNormal(p.x, p.z, _n);
      L.stand.position.set(p.x, y + 0.02, p.z);
      L.stand.rotation.set(0, psiOf(fx, fz), Math.sin(L.rideT * 1.3) * 0.25, 'YXZ');
      if (Math.random() < 0.3) W.spray.emit(p.x, y + 0.1, p.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 0.3, 0.6, 1, 0.6);
    } else {
      const p = toXZ(L.s, L.u);
      const y = wv.height(p.x, p.z);
      L.sit.position.set(p.x, y - 0.05, p.z);
      L.sit.rotation.set(Math.sin(game.time * 1.1 + L.ph) * 0.08, psiOf(-sp.d.x, -sp.d.z) + Math.sin(L.ph) * 0.5, Math.sin(game.time * 0.9 + L.ph) * 0.06, 'YXZ');
    }
  }
}

// ---------------------------------------------------------------------------
// camera
// ---------------------------------------------------------------------------
const cam = { pos: new V3(0, 30, 100), look: new V3(), shake: 0, tube: 0, fov: 62 };
function shake(a) { cam.shake = Math.max(cam.shake, a); }

function updateCamera(dt) {
  const sp = W.spot, wv = W.waves, a = sp.a, d = sp.d;
  const tp = new V3(), tl = new V3();
  let k = 4, minAbove = 0.8;
  if (game.state === 'custom') {
    // surfer on the left of the screen, the customise panel on the right
    const p = S.pos, f = fwdOf(S.psi);
    const rx = -f.z, rz = f.x;
    tp.set(p.x + f.x * 4.2 - rx * 1.4, 1.5, p.z + f.z * 4.2 - rz * 1.4);
    tl.set(p.x - rx * 1.6, p.y + 0.6, p.z - rz * 1.6);
    k = 3;
  } else if (game.state === 'title' || game.state === 'select' || game.state === 'boot') {
    // slow cinematic drift on the beach side of the peak, looking along the coast
    const t = performance.now() / 1000;
    const cs = sp.peakS + 50 + Math.sin(t * 0.05) * 30, cu = sp.uBreak + 24 + Math.sin(t * 0.037) * 8;
    const c = toXZ(cs, cu), l = toXZ(sp.peakS - 90, sp.uBreak + 2);
    tp.set(c.x, 2.4 + Math.sin(t * 0.07) * 0.8, c.z);
    tl.set(l.x, 3.5, l.z);
    k = 1.2;
  } else {
    const pos = S.mode === 'wipe' || (S.mode === 'ended' && W.rag.limp) ? W.rag.P[J.pelvis] : S.pos;
    if (S.mode === 'lineup') {
      const f = fwdOf(S.psi);
      tp.set(pos.x - f.x * 5.5, 2.1, pos.z - f.z * 5.5);
      tl.set(pos.x + f.x * 10, 1.0, pos.z + f.z * 10);
      k = 2.5;
    } else if (S.mode === 'wipe' || S.mode === 'ended') {
      tp.set(pos.x + d.x * 7 - a.x * S.camSide * 3, pos.y + 3.2, pos.z + d.z * 7 - a.z * S.camSide * 3);
      tl.copy(pos);
      k = 2.5;
    } else {
      const f = fwdOf(S.mode === 'air' ? S.launchPsi : S.psi);
      const ea = f.x * a.x + f.z * a.z;
      if (Math.abs(ea) > 0.35) S.camSide = lerp(S.camSide, Math.sign(ea), 1 - Math.exp(-dt * 1.3));
      const side = S.camSide;
      const w = S.wave;
      const Hh = w ? w.H : 2;
      if (camMode === 0) {
        // in front of the wave (beach side), a little behind the surfer, so the face stands up like a wall
        const cx = a.x * side * 1.0 + f.x * 0.35, cz = a.z * side * 1.0 + f.z * 0.35;
        const cl = Math.hypot(cx, cz) || 1;
        const dx = cx / cl, dz = cz / cl;
        // keep the camera low (below the crest) so the wave stands up above the horizon
        const back = 2.7 + Hh * 0.25, out = 3.0 + Hh * 0.5;
        const cy = Math.min(0.6 + 0.2 * Hh + 0.45 * Math.max(0, pos.y), 0.85 * Hh + 0.4);
        tp.set(pos.x - dx * back + d.x * out, cy, pos.z - dz * back + d.z * out);
        tl.set(pos.x + dx * 1.6 - d.x * 1.2, pos.y + 1.0, pos.z + dz * 1.6 - d.z * 1.2);
        if (S.mode === 'air') { tp.y = Math.max(tp.y, S.pos.y * 0.6 + 0.5); tl.y = S.pos.y + 0.4; }
      } else if (camMode === 1) {
        tp.set(pos.x + d.x * 15 - a.x * side * 5, pos.y + 3 + Hh * 0.5, pos.z + d.z * 15 - a.z * side * 5);
        tl.set(pos.x + a.x * side * 3, pos.y + 0.8, pos.z + a.z * side * 3);
      } else {
        tp.set(pos.x + d.x * 22 - a.x * side * 14, pos.y + 16, pos.z + d.z * 22 - a.z * side * 14);
        tl.set(pos.x + a.x * side * 6, pos.y, pos.z + a.z * side * 6);
        k = 2;
      }
      // barrel cam
      cam.tube = lerp(cam.tube, S.inTube && S.tubeT > 0.2 && camMode === 0 && w && w.H > 2.5 ? 1 : 0, 1 - Math.exp(-dt * 3.5));
      if (cam.tube > 0.01) {
        const ap = { x: a.x * w.peel, z: a.z * w.peel };
        const btp = new V3(pos.x - ap.x * 3.6 + d.x * 0.5, pos.y + 0.85, pos.z - ap.z * 3.6 + d.z * 0.5);
        const btl = new V3(pos.x + ap.x * 8 + d.x * 0.6, pos.y + 0.5, pos.z + ap.z * 8 + d.z * 0.6);
        tp.lerp(btp, cam.tube); tl.lerp(btl, cam.tube);
        minAbove = lerp(0.8, 0.3, cam.tube);
        k = lerp(k, 7, cam.tube);
      }
    }
  }
  const kk = 1 - Math.exp(-dt * k);
  cam.pos.lerp(tp, kk);
  cam.look.lerp(tl, 1 - Math.exp(-dt * k * 1.6));
  // never let the camera sit inside the wave: keep it in front of the face (unless it's the barrel cam)
  if (game.state === 'play' && S.wave && (S.mode === 'ride' || S.mode === 'popup' || S.mode === 'air') && cam.tube < 0.5) {
    const w = S.wave;
    const cs = cam.pos.x * a.x + cam.pos.z * a.z, cu = cam.pos.x * d.x + cam.pos.z * d.z;
    const L = wv.local(w, cs, cu);
    const minU = w.uc + L.Lf * 1.25 + 1.2;
    if (L.Hh > 0.4 && cu < minU) cam.pos.addScaledVector(new V3(d.x, 0, d.z), minU - cu);
  }
  const hw = wv.height(cam.pos.x, cam.pos.z);
  if (cam.pos.y < hw + minAbove) cam.pos.y = hw + minAbove;
  camera.position.copy(cam.pos);
  if (cam.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * cam.shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * cam.shake * 0.4;
    cam.shake = Math.max(0, cam.shake - dt * 1.5);
  }
  camera.lookAt(cam.look);
  if (window.__camOv) { camera.position.set(...window.__camOv[0]); camera.lookAt(...window.__camOv[1]); }
  const fovT = 62 + (S.mode === 'ride' || S.mode === 'air' ? clamp((S.V - 8) * 0.8, 0, 9) : 0) + cam.tube * 6;
  cam.fov = lerp(cam.fov, fovT, 1 - Math.exp(-dt * 2));
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// effects: lip spray, whitewater mist
// ---------------------------------------------------------------------------
function emitWaveSpray(dt) {
  const wv = W.waves, sp = W.spot, q = settings.quality === 'low' ? 0.45 : settings.quality === 'high' ? 1.4 : 1;
  for (const w of wv.waves) {
    if (!w.broke || w.fade < 0.3 || w.H < 0.9) continue;
    const near = toXZ(w.sb, w.uc);
    const dist = Math.hypot(near.x - camera.position.x, near.z - camera.position.z);
    if (dist > 420) continue;
    const n = (w.closeout ? 140 : 80) * dt * q * Math.min(1.7, w.H / 2);
    for (let i = 0; i < n; i++) {
      const ds = rand(-10, 1.5);
      const s = w.sb + w.peel * ds;
      const L = wv.local(w, s, w.uc);
      if (L.Hh < 0.6) continue;
      const u = w.uc + L.Lf * rand(0.85, 1.1);
      const p = toXZ(s, u);
      const y = wv.height(p.x, p.z);
      const up = Math.random() < 0.3 ? rand(5, 10) : rand(2, 5.5);
      W.spray.emit(p.x, y + 0.2, p.z, sp.d.x * rand(1, 4) + sp.a.x * w.peel * rand(-1.5, 1.5), up * Math.min(1.6, L.Hh / 2), sp.d.z * rand(1, 4) + sp.a.z * w.peel * rand(-1.5, 1.5), rand(0.6, 1.8) * Math.min(1.5, L.Hh / 2), rand(0.8, 1.7), 1, 0.9);
    }
    // the lip feathering and throwing: spray blown off the top of the curl
    const lipN = 40 * dt * q * Math.min(1.7, w.H / 2);
    for (let i = 0; i < lipN; i++) {
      const ds = rand(-2, 22);
      const s = w.sb + w.peel * ds;
      const L = wv.local(w, s, w.uc);
      if (L.Hh < 1 || L.T < 0.1) continue;
      const u = w.uc + L.Lf * L.T * rand(0, 1);
      const p = toXZ(s, u);
      const tt = (u - w.uc) / L.Lf;
      const y = L.Hh * (1.05 - 0.86 * tt * tt) + 0.2;
      W.spray.emit(p.x, y, p.z, sp.d.x * rand(0.5, 2.5) - sp.d.x * 1.5, rand(0.5, 2.5), sp.d.z * rand(0.5, 2.5) - sp.d.z * 1.5, rand(0.25, 0.7), rand(0.5, 1.1), 0.6, 0.75);
    }
    // mist off the back of the broken section
    const m = 24 * dt * q;
    for (let i = 0; i < m; i++) {
      const ds = rand(-70, -6);
      const s = w.sb + w.peel * ds;
      const L = wv.local(w, s, w.uc);
      if (L.Hh < 0.4) continue;
      const p = toXZ(s, w.uc + rand(-1, 3));
      const y = wv.height(p.x, p.z);
      W.spray.emit(p.x, y + 0.3, p.z, sp.d.x * 2, rand(0.5, 1.5), sp.d.z * 2, rand(1.6, 3.2), rand(1.5, 2.5), 0.05, 0.35);
    }
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let popTimer = 0;
function popup(name, pts, big, kind) {
  const el = document.createElement('div');
  el.className = 'pop ' + (kind || '') + (big ? ' big' : '');
  el.innerHTML = `<div class="n">${name}</div>${pts ? `<div class="p">+${pts}</div>` : ''}`;
  $('pops').appendChild(el);
  setTimeout(() => el.remove(), 1700);
  while ($('pops').children.length > 4) $('pops').firstChild.remove();
}
function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function bigMsg(a, b, kind) {
  const el = $('bigmsg');
  el.className = 'bigmsg ' + (kind || '');
  el.innerHTML = `${a ? `<div class="a">${a}</div>` : ''}<div class="b">${b}</div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

let hintT = 0;
function updateHUD(dt) {
  const sp = W.spot;
  $('hudSpeed').style.width = clamp(S.V / 20, 0, 1) * 100 + '%';
  $('hudKmh').textContent = Math.round(S.V * 3.6) + ' km/h';
  const chainEl = $('hudChain');
  if (score.chain.length) {
    chainEl.classList.add('on');
    chainEl.innerHTML = `<span>${score.chain.slice(-4).join(' + ')}</span><b>${Math.round(score.chainPts)} × ${score.mult.toFixed(1)}</b><i style="width:${clamp(score.chainT / 2.6, 0, 1) * 100}%"></i>`;
  } else chainEl.classList.remove('on');
  $('hudWave').textContent = S.mode === 'ride' || S.mode === 'air' || S.mode === 'popup' ? `Wave ${to10(score.wave + score.chainPts * score.mult).toFixed(2)}` : '';
  if (game.mode === 'contest') {
    const t = Math.max(0, game.heatTime);
    $('hudTimer').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    $('hudTimer').classList.toggle('low', t < 30);
  } else $('hudTimer').textContent = '';
  $('hudTube').classList.toggle('on', S.inTube && S.tubeT > 0.2);
  if (S.inTube) $('hudTube').innerHTML = `IN THE BARREL <b>${S.tubeT.toFixed(1)}s</b>`;
  // hints
  hintT -= dt;
  if (hintT > 0) return;
  hintT = 0.2;
  let hint = '';
  if (S.mode === 'lineup') {
    const wv = W.waves;
    let next = null, best = 1e9;
    for (const w of wv.waves) {
      if (w.ridden || w.uc > S.u - 0.5) continue;
      const tt = (S.u - w.uc) / w.c;
      if (tt < best) { best = tt; next = w; }
    }
    if (next && best < 9) {
      const ft = Math.round(next.Hmax * 3.28);
      const L = wv.local(next, S.s, next.uc);
      const far = L.Hh < 0.9 ? '  ·  too far from the peak, paddle toward the other surfers' : '';
      hint = best < 2.6 ? `PADDLE! Hold ${isTouch ? '▲' : '↑'}  (${ft} ft wave)${far}` : `Wave in ${Math.ceil(best)}…  ${ft} ft${far}`;
      $('hint').classList.toggle('urgent', best < 2.6);
    } else {
      const away = Math.abs(S.s - W.spot.peakS) > 60 || Math.abs(S.u - W.spot.uBreak) > 50;
      hint = away ? 'Paddle back out to the other surfers to catch waves'
        : isTouch ? 'Waiting for a set…  ◀ ▶ turn  ·  ▲ paddle' : 'Waiting for a set…  ← → turn  ·  ↑ paddle';
      $('hint').classList.remove('urgent');
    }
  } else if (S.mode === 'popup' || S.mode === 'ride') {
    if (game.time - (S.hintShown || -99) < 8) hint = isTouch ? '◀ ▶ carve · ▲ pump · ▼ crouch · JUMP at the lip' : '← → carve  ·  ↑ pump  ·  ↓ crouch  ·  SPACE jump at the lip';
    $('hint').classList.remove('urgent');
  } else if (S.mode === 'air') { hint = isTouch ? '◀ ▶ spin · ▲ ▼ flip · hold JUMP grab' : '← → spin  ·  ↑ ↓ flip  ·  SHIFT / hold SPACE grab'; }
  $('hint').textContent = hint;
}

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
let last = performance.now();
let lastMode = '';
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!W) return;
  const playing = game.state === 'play';
  const inp = playing ? input() : { steer: 0, up: false, down: false, jump: false, jumpHit: false, grab: false };
  for (const k in pressed) pressed[k] = false;
  if (game.state === 'pause' || game.state === 'results') dt = 0;
  // slow motion in big airs and deep barrels
  const slow = (S.mode === 'air' && S.airT > 0.25 && S.vy < 3) || (S.inTube && S.tubeT > 0.4);
  game.timeScale = lerp(game.timeScale, playing && slow ? 0.62 : 1, 1 - Math.exp(-dt * 6));
  const sdt = dt * game.timeScale;
  if (playing && S.mode !== lastMode) { if (S.mode === 'ride' && lastMode === 'popup') S.hintShown = game.time; lastMode = S.mode; }
  acc += sdt;
  let steps = 0;
  while (acc >= H && steps < 10) {
    if (playing || game.state === 'title' || game.state === 'select' || game.state === 'custom') {
      if (playing) fixedStep(H, inp);
      else { W.waves.update(H); game.time += H; stepLocals(H); if (game.state === 'custom') stepLineup(H, inp); }
    }
    acc -= H; steps++;
    if (steps === 1) { inp.jumpHit = false; }
  }
  if (steps >= 10) acc = 0;
  if (playing && game.mode === 'contest') {
    game.heatTime -= sdt;
    if (game.heatTime <= 0 && S.mode !== 'ride' && S.mode !== 'air' && S.mode !== 'popup') endHeat();
  }
  if (playing) bankTick(sdt);
  // render things
  const t = W.waves.t;
  if (W.rag) W.rag.render(S.boardMat);
  const showSurfer = playing || game.state === 'pause' || game.state === 'results' || game.state === 'custom';
  W.rag.group.visible = showSurfer; W.rag.board.visible = showSurfer; W.rag.leash.visible = showSurfer && (S.mode === 'wipe' || S.mode === 'ended');
  renderLocals();
  W.amb.update(t, W.waves);
  emitWaveSpray(sdt);
  W.spray.update(sdt, W.waves);
  W.spray.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  const tailOn = (S.mode === 'ride' || S.mode === 'popup') && S.V > 2;
  const f = fwdOf(S.psi);
  W.trail.update(sdt, W.waves, { on: tailOn, x: S.pos.x - f.x * 0.9, z: S.pos.z - f.z * 0.9, dirx: f.x, dirz: f.z, width: 0.25 });
  updateCamera(dt);
  W.ocean.update(t, (game.state === 'title' || game.state === 'select' || game.state === 'custom') ? cam.look : S.pos);
  W.sky.update(camera, t);
  // audio layers
  if (audio.ok) {
    let roar = 0;
    for (const w of W.waves.waves) {
      if (!w.broke) continue;
      const p = toXZ(w.sb, w.uc + 3);
      const dd = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      roar += w.fade * Math.min(1, w.H / 3) * clamp(1 - dd / 260, 0, 1);
    }
    audio.update({ roar: Math.min(1, roar), hiss: (S.mode === 'ride' || S.mode === 'popup') ? S.V / 18 : 0, wind: S.mode === 'air' ? 1 : (S.mode === 'ride' ? S.V / 40 : 0) });
  }
  if (playing) updateHUD(dt);
  // fade to black between rides
  if (game.fade > 0) { game.fade = Math.max(0, game.fade - dt * 1.6); }
  $('fader').style.opacity = game.fade;
  draw();
}

function bankTick(dt) {
  if (score.chain.length && S.mode !== 'wipe') {
    score.chainT -= dt;
    if (score.chainT <= 0 && S.mode !== 'air') bankChain();
  }
}

// ---------------------------------------------------------------------------
// screens / menus
// ---------------------------------------------------------------------------
function showScreen(id) {
  for (const s of ['title', 'select', 'pause', 'results', 'howto', 'custom']) $(s).classList.toggle('hidden', s !== id);
  if (id) { $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); }
  else if (game.state === 'play') { $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !isTouch); }
}

let selectMode = 'free';
function openSelect(mode) {
  selectMode = mode;
  game.state = 'select';
  $('selTitle').textContent = mode === 'contest' ? 'Surf contest — pick your heat' : 'Free surf — pick a spot';
  $('spotCards').innerHTML = SPOTS.map((s, i) => {
    const locked = mode === 'contest' && i >= progress.unlocked;
    const best = progress.best[s.id];
    return `<button class="spot ${locked ? 'locked' : ''}" data-i="${i}">
      <div class="lvl">${'★'.repeat(s.stars)}<span class="off">${'★'.repeat(3 - s.stars)}</span> ${s.level}</div>
      <div class="nm">${s.name}</div>
      <div class="ty">${s.type} · ${s.size}</div>
      <div class="ds">${s.desc}</div>
      <div class="co">${s.lat.toFixed(3)}°N ${Math.abs(s.lon).toFixed(3)}°W${best ? ` · best heat ${best.toFixed(2)}` : ''}</div>
      ${locked ? `<div class="lock">🔒 Win at ${SPOTS[i - 1].short} to unlock</div>` : ''}
    </button>`;
  }).join('');
  $('spotCards').querySelectorAll('.spot').forEach((b) => {
    b.onmouseenter = () => highlightPin(+b.dataset.i);
    b.onclick = () => {
      const i = +b.dataset.i;
      if (mode === 'contest' && i >= progress.unlocked) { audio.bad(); return; }
      audio.click();
      $('loadingSpot').classList.remove('hidden');
      setTimeout(() => {
        startSession(SPOTS[i], mode);
        $('loadingSpot').classList.add('hidden');
      }, 30);
    };
  });
  highlightPin(0);
  showScreen('select');
}

// real island map drawn from the albedo + height data
function drawIslandMap() {
  const cv = $('islandMap');
  const c0 = ll2w(29.30, -13.90), c1 = ll2w(28.83, -13.40);
  const N = 300, ratio = (c1.z - c0.z) / (c1.x - c0.x), NH = Math.round(N * ratio);
  cv.width = N; cv.height = NH;
  const x = cv.getContext('2d');
  const img = albedoTex.image;
  const sx = (c0.x - GEO.XMIN) / GEO.S * img.width, sz = (c0.z - GEO.ZMIN) / GEO.S * img.height;
  const sw = (c1.x - c0.x) / GEO.S * img.width, sh = (c1.z - c0.z) / GEO.S * img.height;
  x.drawImage(img, sx, sz, sw, sh, 0, 0, N, NH);
  const id = x.getImageData(0, 0, N, NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < N; i++) {
    const wx = c0.x + (i + 0.5) / N * (c1.x - c0.x), wz = c0.z + (j + 0.5) / NH * (c1.z - c0.z);
    const h = island.h(wx, wz);
    const k = (j * N + i) * 4;
    if (h <= 0.5) { const sh2 = Math.max(0, Math.min(1, -h / 40)); id.data[k] = 40 - sh2 * 26; id.data[k + 1] = 150 - sh2 * 70; id.data[k + 2] = 165 - sh2 * 40; }
    else { const l = 0.85 + Math.min(0.35, h / 900); id.data[k] *= l; id.data[k + 1] *= l; id.data[k + 2] *= l; }
  }
  x.putImageData(id, 0, 0);
  cv.style.aspectRatio = `${N} / ${NH}`;
  $('mapPins').innerHTML = SPOTS.map((s, i) => {
    const w = ll2w(s.lat, s.lon);
    const px = (w.x - c0.x) / (c1.x - c0.x) * 100, pz = (w.z - c0.z) / (c1.z - c0.z) * 100;
    return `<div class="pin ${s.id}" data-i="${i}" style="left:${px}%;top:${pz}%"><span>${s.short}</span></div>`;
  }).join('');
}
function highlightPin(i) { document.querySelectorAll('.pin').forEach((p) => p.classList.toggle('on', +p.dataset.i === i)); }

// customise
function buildCustom() {
  const rows = [['Body', 'skins', 'skin'], ['Hawaiian shirt', 'vests', 'vest'], ['Board shorts', 'shorts', 'shorts'], ['Bucket hat', 'hair', 'hair'], ['Board', 'boards', 'board']];
  $('customRows').innerHTML = rows.map(([label, list, key]) => `<div class="crow"><span>${label}</span><div class="sw">${LOOKS[list].map((c) => `<button data-k="${key}" data-c="${c}" style="background:${c}" class="${look[key] === c ? 'on' : ''}"></button>`).join('')}</div></div>`).join('');
  $('customRows').querySelectorAll('button').forEach((b) => b.onclick = () => {
    look[b.dataset.k] = b.dataset.c; store.set('look2', look); audio.click();
    W.rag.setLook(look); buildCustom();
  });
}

function syncSettingsUI() {
  document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', settings[b.dataset.set] === (b.dataset.val === 'true' ? true : b.dataset.val === 'false' ? false : b.dataset.val)));
}
document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.set; let v = b.dataset.val; if (v === 'true') v = true; if (v === 'false') v = false;
  settings[k] = v; store.set('settings', settings); audio.start(); audio.click();
  if (k === 'music') audio.setMusic(v);
  if (k === 'sfx') audio.setSfx(v);
  if (k === 'time' && W) setupSpot(W.spot);
  if (k === 'quality') { resize(); setupPost(); const sp = W.spot; setupSpot(sp); }
  syncSettingsUI();
}));

$('btnFree').onclick = () => { audio.start(); audio.click(); openSelect('free'); };
$('btnContest').onclick = () => { audio.start(); audio.click(); openSelect('contest'); };
$('btnHow').onclick = () => { audio.start(); audio.click(); showScreen('howto'); };
$('btnCustom').onclick = () => { audio.start(); audio.click(); game.state = 'custom'; buildCustom(); showScreen('custom'); previewSurfer(true); };
document.querySelectorAll('[data-back]').forEach((b) => b.onclick = () => { audio.click(); game.state = 'title'; previewSurfer(false); showScreen('title'); });
$('btnResume').onclick = () => togglePause();
$('btnQuit').onclick = () => { game.state = 'title'; showScreen('title'); $('hud').classList.add('hidden'); };
$('btnSpots').onclick = () => { openSelect(game.mode); };
$('btnAgain').onclick = () => startSession(W.spot, game.mode);
$('btnNextSpot').onclick = () => { const i = SPOTS.indexOf(W.spot); startSession(SPOTS[i + 1], 'contest'); };
$('btnResMenu').onclick = () => { game.state = 'title'; showScreen('title'); $('hud').classList.add('hidden'); };
$('btnPause').onclick = () => togglePause();
// the open-world island game (Lanzarote Life) lives in life/: leave the water at this spot's surf shack
const toIsland = () => { audio.click(); $('fader').style.opacity = 1; location.href = 'life/' + (W && game.state !== 'title' ? '?at=' + W.spot.id : ''); };
$('btnIsland').onclick = toIsland;
$('btnIsland2').onclick = toIsland;

// customise preview: the surfer sits in the line-up right in front of the camera
function previewSurfer(on) {
  if (on) { resetToLineup(true); cam.pos.copy(S.pos).add(new V3(0, 3, 0)); }
}

syncSettingsUI();
requestAnimationFrame(frame);
boot().catch((e) => {
  console.error(e);
  $('bootText').textContent = 'Could not load: ' + e.message;
});

// for debugging in the console
window.__surf = {
  game, S, score, get W() { return W; }, SPOTS, startSession, keys, setupSpot, cam,
  snap(cp, cl) { for (let i = 0; i < 5; i++) updateCamera(5); if (cp) { window.__camOv = [cp, cl]; updateCamera(0.01); } W.ocean.update(W.waves.t, game.state === 'play' ? S.pos : cam.look); W.sky.update(camera, W.waves.t); W.rag.render(S.boardMat); renderLocals(); draw(); },
  // advance the simulation quickly (testing)
  sim(sec, inp = {}) {
    const n = Math.round(sec / H);
    for (let i = 0; i < n; i++) {
      const ii = Object.assign({ steer: 0, up: false, down: false, jump: false, jumpHit: false, grab: false }, typeof inp === 'function' ? inp() : inp);
      if (game.state === 'play') fixedStep(H, ii); else { W.waves.update(H); game.time += H; }
      W.spray.update(H, W.waves);
    }
    return { mode: S.mode, s: S.s, u: S.u, V: S.V, wave: score.wave };
  },
};
