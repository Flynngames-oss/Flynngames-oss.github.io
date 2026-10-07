// Senders — boot, game states (title → career map → drop in → ride → bail / finish → results), the frame
// loop with fixed-step physics, and all the glue between physics, rider, tricks, camera, effects, audio and UI.
import * as THREE from 'three';
import { Course } from './course.js';
import { WORLDS } from './worlds.js';
import { buildTerrain } from './terrainMesh.js';
import { Vegetation, buildProps, shared } from './scenery.js';
import { Sky } from './sky.js';
import { Bike } from './bike.js';
import { BikeModel } from './bikeModel.js';
import { Rider, Debris } from './rider.js';
import { TrickSystem } from './tricks.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { FX } from './fx.js';
import { Grass } from './grass.js';
import { Post } from './post.js';
import { initAudio, updateAudio, sfx, setVolumes, suspend } from './audio.js';
import { Music } from './music.js';
import { Input } from './input.js';
import * as UI from './ui.js';
import { loadProfile, saveProfile, newCareer, levelOptions, freeRideOption, dailyOption, ObjectiveTracker, MAX_LIVES, COLOR_SETS } from './career.js';
import { clamp, damp, wrapAngle, fmtNum, fmtTime, nextFrame, TAU } from './util.js';

const $ = UI.$;
const TEST = new URLSearchParams(location.search).has('test');   // automated tests: allow big frame steps
const MAXDT = TEST ? 0.25 : 0.05;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ------------------------------------------------------------------ quality presets
const QUALITY = [
  { name: 'Low', pr: 0.8, shadows: 0, post: 0, grass: 0, grassTile: 0, treeHi: 65, treeShadows: false, density: 0.55 },
  { name: 'Medium', pr: 1, shadows: 1024, post: 1, grass: 36000, grassTile: 32, treeHi: 90, treeShadows: true, density: 0.8 },
  { name: 'High', pr: 1.25, shadows: 2048, post: 2, grass: 80000, grassTile: 42, treeHi: 125, treeShadows: true, density: 1 },
  { name: 'Ultra', pr: 2, shadows: 4096, post: 2, grass: 150000, grassTile: 56, treeHi: 170, treeShadows: true, density: 1.15 },
];
const profile = loadProfile();
if (profile.settings.quality == null) profile.settings.quality = isTouch ? 0 : (navigator.hardwareConcurrency || 4) <= 4 ? 1 : 2;
let Q = QUALITY[profile.settings.quality];

// ------------------------------------------------------------------ renderer & world
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 7000);
const sky = new Sky(scene, renderer);
const post = new Post(renderer, scene, camera);
const fx = new FX(scene);
const input = new Input();
const music = new Music();
const tricks = new TrickSystem();
const rig = new CameraRig(camera);
let resScale = 1;
function applyQuality() {
  Q = QUALITY[profile.settings.quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr) * resScale);
  renderer.setSize(innerWidth, innerHeight);
  sky.setShadows(Q.shadows);
  renderer.shadowMap.enabled = Q.shadows > 0;
  post.setLevel(Q.post);
  post.resize();
  fx.setScale(innerHeight * renderer.getPixelRatio());
}
applyQuality();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.resize(); fx.setScale(innerHeight * renderer.getPixelRatio());
});

const riderColors = () => ({ jersey: profile.rider.jersey, accent: profile.rider.jacc, pants: profile.rider.pants, helmet: profile.rider.helmet });
const bikeModel = new BikeModel({ frame: profile.rider.frame, accent: profile.rider.accent });
scene.add(bikeModel.root);
const rider = new Rider(riderColors());
scene.add(rider.group);
const debris = new Debris();

const G = {
  state: 'boot', course: null, world: null, root: null, terrain: null, veg: null, props: null, grass: null, bike: null,
  opt: null, kind: null, run: null, acc: 0, overlays: [], selected: null, crashT: 0, crashS: 0, finishT: 0, introT: 0, count: 0,
  dustT: 0, crowdT: 0, crowdLvl: 0, botTrick: null, frameMs: 16, perfT: 0, keysT: 0, camMsgT: 0, attractCrashT: 0,
};
const ctrlIdle = { steer: 0, pedal: 0, brake: 0, lean: 0, spin: 0, jump: false, leanFresh: false, spinFresh: true, tricks: {}, trickHeld: false };
const ctrlBot = { steer: 0, pedal: 0, brake: 0, lean: 0, spin: 0, jump: false, leanFresh: false, spinFresh: true, tricks: { up: false, down: false, left: false, right: false, whip: false, barspin: false }, trickHeld: false };

// ------------------------------------------------------------------ course loading
function disposeTree(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const m = o.material; if (m) for (const mm of Array.isArray(m) ? m : [m]) if (!seen.has(mm)) { seen.add(mm); mm.dispose(); }
  });
}
async function loadCourse(opt, progress) {
  if (G.root) {
    scene.remove(G.root); disposeTree(G.root);
    if (G.veg) G.veg.dispose(); if (G.props) G.props.dispose(); if (G.grass) G.grass.dispose();
    G.root = null;
  }
  const world = WORLDS[opt.world];
  progress(0.02, 'Shaping the mountain…'); await nextFrame();
  const course = new Course({ world, seed: opt.seed, length: opt.length, steep: opt.steep, curvy: opt.curvy, stunts: opt.stunts, boss: opt.boss, name: opt.name });
  await course.buildGrid((p) => progress(0.04 + p * 0.3, 'Shaping the mountain…'));
  course.placeScenery(Q.density);
  const root = new THREE.Group();
  const terrain = await buildTerrain(course, root, (p) => progress(0.36 + p * 0.44, 'Cutting the trail…'), Q);
  progress(0.82, 'Planting trees…'); await nextFrame();
  const veg = new Vegetation(course, root, Q);
  const props = buildProps(course, root, Q);
  progress(0.9, 'Growing the grass…'); await nextFrame();
  const grass = new Grass(scene, course, Q);
  sky.setWorld(world);
  if (grass) grass.setLight(sky);
  fx.setWorld(world);
  scene.add(root);
  Object.assign(G, { course, world, root, terrain, veg, props, grass, opt });
  G.bike = new Bike(course);
  rider.endRagdoll();
  G.bike.reset(G.state === 'title' ? 45 : 6, G.state === 'title' ? 9 : 0);
  placeVisuals(0);
  rig.snap();
  rig.update(0.016, { bike: G.bike, course, rider, mode: G.state === 'title' ? 'orbit' : null });
  veg.update(camera.position, camForward(), true);
  terrain.update(camera.position, 0);
  progress(0.96, 'Warming up…'); await nextFrame();
  renderer.compile(scene, camera);
  progress(1, 'Ready');
}
const _fw = new THREE.Vector3();
function camForward() { return camera.getWorldDirection(_fw); }

// ------------------------------------------------------------------ boot
async function boot() {
  const tip = UI.TIPS[Math.floor(Math.random() * UI.TIPS.length)];
  $('bootTip').textContent = tip;
  const prog = (p, t) => { $('bootFill').style.width = (p * 100).toFixed(0) + '%'; $('bootPct').textContent = (p * 100).toFixed(0) + '%'; if (t) $('bootText').textContent = t; };
  try { await document.fonts.ready; } catch (e) { /* ignore */ }
  const wi = Math.floor(Math.random() * (profile.unlockedWorld + 1));
  const opt = freeRideOption(Math.min(wi, WORLDS.length - 1), Math.floor(Math.random() * 1e9));
  opt.stunts = 4; opt.length = 1250;
  G.state = 'title';
  await loadCourse(opt, prog);
  $('boot').classList.add('fade');
  setTimeout(() => $('boot').classList.add('hidden'), 600);
  showTitle();
  if (isTouch) { document.body.classList.add('touch'); input.bindTouch($('touch')); }
}

// ------------------------------------------------------------------ menus
function showTitle() {
  G.state = 'title'; G.overlays = [];
  UI.show('title');
  $('touch').classList.add('hidden');
  const c = profile.career;
  $('btnContinue').classList.toggle('hidden', !c);
  if (c) $('continueSub').textContent = `${WORLDS[c.world].name} · ${c.level === 4 ? 'Boss jump' : 'Level ' + (c.level + 1)} · ${c.lives} ♥ · ${fmtNum(c.rep)} rep`;
  const d = dailyOption();
  $('dailySub').textContent = `Today: ${WORLDS[d.world].name} — same mountain for everyone`;
  UI.profileStrip(profile);
  if (G.course && G.kind) { G.kind = null; G.bike.reset(45, 9); rider.endRagdoll(); rig.snap(); }
  music.setIntensity(0.35);
}
function openOverlay(id) {
  const visible = ['title', 'worlds', 'map', 'pause', 'results'].filter((s) => !$(s).classList.contains('hidden'));
  G.overlays.push({ id, under: visible });
  for (const s of visible) $(s).classList.add('hidden');
  $(id).classList.remove('hidden');
  if (id === 'settings') syncSettings();
  if (id === 'riderPanel') UI.riderPanel(profile.rider, applyRider);
}
function closeOverlay() {
  const top = G.overlays.pop();
  if (!top) return false;
  $(top.id).classList.add('hidden');
  for (const s of top.under) $(s).classList.remove('hidden');
  saveProfile(profile);
  return true;
}
function applyRider() {
  bikeModel.setColors({ frame: profile.rider.frame, accent: profile.rider.accent });
  rider.setColors(riderColors());
  saveProfile(profile);
}
function syncSettings() {
  const s = profile.settings;
  UI.seg('segQuality', 'q', s.quality, (v) => { s.quality = +v; resScale = 1; applyQuality(); saveProfile(profile); $('fpsInfo').textContent = 'Trees, grass and shadows update on the next trail.'; });
  UI.seg('segCam', 'c', s.camera, (v) => { s.camera = +v; rig.mode = +v; rig.snap(); saveProfile(profile); });
  UI.seg('segHints', 'h', s.hints ? 1 : 0, (v) => { s.hints = v === '1'; saveProfile(profile); });
  $('volMusic').value = s.music; $('volSfx').value = s.sfx;
  $('volMusic').oninput = () => { s.music = +$('volMusic').value; setVolumes(s.sfx, s.music); };
  $('volSfx').oninput = () => { s.sfx = +$('volSfx').value; setVolumes(s.sfx, s.music); };
  $('fpsInfo').textContent = `Running at about ${Math.round(1000 / Math.max(1, G.frameMs))} fps`;
}

function openWorlds(title, unlocked, onPick) {
  G.state = 'worlds';
  UI.show('worlds');
  const done = []; for (let i = 0; i < WORLDS.length; i++) done[i] = i < profile.unlockedWorld;
  UI.worldGrid(title, unlocked, done, (i) => { sfx.click(); onPick(i); });
  G.worldsBack = showTitle;
}
function openMap() {
  const c = profile.career; if (!c) { showTitle(); return; }
  G.state = 'map'; G.selected = null;
  UI.show('map');
  renderMap();
}
function renderMap() {
  const c = profile.career;
  UI.careerMap(c, (lv) => levelOptions(c.seedBase, c.world, lv), G.selected, (i) => { G.selected = i; sfx.click(); renderMap(); });
}

// ------------------------------------------------------------------ runs
async function startTrack(opt, kind) {
  G.kind = kind; G.state = 'loading';
  UI.show('gen');
  $('gen').classList.remove('fade');
  $('genWorld').textContent = `${WORLDS[opt.world].name}${opt.boss ? ' · Boss jump' : kind === 'career' ? ' · Level ' + (opt.level + 1) : kind === 'daily' ? ' · Daily Send' : ' · Free ride'}`;
  $('genName').textContent = opt.name;
  $('genTip').textContent = UI.TIPS[Math.floor(Math.random() * UI.TIPS.length)];
  const prog = (p, t) => { $('genFill').style.width = (p * 100).toFixed(0) + '%'; $('genPct').textContent = (p * 100).toFixed(0) + '%'; if (t) $('genText').textContent = t; };
  await loadCourse(opt, prog);
  music.play(WORLDS[opt.world].music, opt.seed);
  beginRun(opt, kind);
}
function beginRun(opt, kind) {
  const c = G.course;
  G.run = { opt, kind, time: 0, started: false, finished: false, bails: 0, maxSpeed: 0, obj: new ObjectiveTracker(opt.objective), objRewarded: false,
    air: 0, jumps: 0, perfects: 0, bestCombo: 0, cps: 0, offT: 0, finishBonus: 0, bestTrick: null };
  tricks.reset();
  G.bike.reset(6, 0); G.bike.frozen = true;
  rider.endRagdoll();
  rig.mode = profile.settings.camera; rig.snap();
  G.state = 'intro'; G.introT = 0; G.count = -1;
  UI.show('hud', 'intro');
  $('gen').classList.add('hidden');
  $('trackName').textContent = opt.name;
  UI.progressMarks(c);
  updateLives();
  $('introWorld').textContent = $('genWorld').textContent;
  $('introName').textContent = opt.name;
  $('introRatings').innerHTML = opt.boss ? '' : UI.ratings(opt);
  $('introObj').innerHTML = opt.objective ? `<i>♥ Bonus:</i> ${opt.objective.text}` : '';
  $('introObj').classList.toggle('hidden', !opt.objective);
  $('introGo').innerHTML = isTouch ? 'Tap to drop in' : input.usingPad ? 'Press <b>A</b> to drop in' : 'Press <b>Space</b> to drop in';
  $('objective').classList.toggle('hidden', !opt.objective);
  $('objective').className = opt.objective ? '' : 'hidden';
  $('combo').classList.add('hidden');
  $('keys').classList.toggle('hidden', !profile.settings.hints || isTouch);
  $('keys').classList.remove('fade'); G.keysT = 0;
  $('camName').textContent = '';
  $('warn').classList.add('hidden');
  UI.clearBig();
  if (isTouch) $('touch').classList.remove('hidden');
}
function dropIn() {
  if (G.state !== 'intro' || G.count >= 0) return;
  $('intro').classList.add('hidden');
  G.count = 3; G.introT = 0;
  UI.bigMsg('3', '', 0); sfx.count();
}
function updateLives() {
  const c = profile.career;
  $('lives').classList.toggle('hidden', G.kind !== 'career');
  if (G.kind === 'career' && c) UI.hearts($('lives'), c.lives);
}
function respawn(manual) {
  const b = G.bike, c = G.course;
  const s = c.respawnS(manual ? b.s : G.crashS);
  const f = c.nearFeature(s + 60, 0);
  b.reset(s, f && f.type === 'boss' ? 7 : Math.min(c.V[Math.round(s)] * 0.8, 9));
  rider.endRagdoll();
  tricks.lose();
  rig.snap();
  G.state = 'ride';
  UI.clearBig();
}
function onCrash(e, attract) {
  const b = G.bike;
  G.crashS = b.s; G.crashT = 0;
  rider.startRagdoll(b.vel, new THREE.Vector3(0, 1.5, 0));
  debris.start(b.pos, bikeModel.root.quaternion, b.vel);
  sfx.crash();
  rig.shake(0.9);
  fx.burst(b.pos, b.vel, b.ground[1].surf, 1.4);
  if (attract) { G.attractCrashT = 0.001; return; }
  post.flash = 0.6;
  tricks.lose();
  G.run.bails++;
  G.run.obj.event({ type: 'bail' });
  G.state = 'crashed';
  if (G.kind === 'career') {
    profile.career.lives--; profile.career.bails = (profile.career.bails || 0) + 1;
    updateLives(); sfx.lifeLost();
    UI.bigMsg(`Bailed!<small>${e.reason} · ♥ −1</small>`, 'bail', 2600);
  } else UI.bigMsg(`Bailed!<small>${e.reason}</small>`, 'bail', 2600);
  saveProfile(profile);
}
function finishRun() {
  const r = G.run;
  r.finished = true; G.state = 'finishing'; G.finishT = 0;
  tricks.bank();
  r.finishBonus = 1000 + (r.bails === 0 ? 1500 : 0);
  if (r.obj.event({ type: 'finish', time: r.time })) objectiveDone();
  sfx.finish(); sfx.cheer(1.5);
  UI.bigMsg(`Finish!<small>${fmtTime(r.time)}${r.bails === 0 ? ' · Clean run!' : ''}</small>`, 'orange', 2600);
  post.flash = 0.5;
}
function objectiveDone() {
  const r = G.run; if (!r || r.objRewarded) return;
  r.objRewarded = true;
  sfx.objective();
  if (G.kind === 'career' && profile.career) {
    if (profile.career.lives < MAX_LIVES) { profile.career.lives++; updateLives(); UI.toast('Bonus complete!', '+1 ♥', 'good'); }
    else UI.toast('Bonus complete!', 'lives full · +2,000 rep', 'good');
    if (profile.career.lives >= MAX_LIVES) tricks.runRep += 2000;
  } else UI.toast('Bonus complete!', '', 'good');
  saveProfile(profile);
}
function showResults() {
  const r = G.run, c = profile.career, opt = r.opt;
  const total = tricks.runRep + r.finishBonus;
  profile.totalRep += total; profile.bestRun = Math.max(profile.bestRun, total);
  const stats = [
    { label: 'Rep earned', value: fmtNum(total), big: true },
    { label: 'Time', value: fmtTime(r.time) }, { label: 'Top speed', value: Math.round(r.maxSpeed * 3.6) + ' km/h' },
    { label: 'Air time', value: r.air.toFixed(1) + ' s' }, { label: 'Bails', value: r.bails },
    { label: 'Perfect landings', value: r.perfects }, { label: 'Best combo', value: fmtNum(r.bestCombo) },
  ];
  const objective = opt.objective ? { ok: r.obj.done, text: opt.objective.text, reward: G.kind === 'career' } : null;
  const buttons = [];
  let title = 'Run complete', eyebrow = `${WORLDS[opt.world].name} · ${opt.name}`;
  if (G.kind === 'career' && c) {
    c.rep += total; c.tracks = (c.tracks || 0) + 1;
    c.picks[c.level] = G.selected ?? 0;
    if (opt.boss) {
      profile.unlockedWorld = Math.max(profile.unlockedWorld, Math.min(WORLDS.length - 1, c.world + 1));
      profile.bossesBeaten++;
      title = 'World complete!';
      if (c.world >= WORLDS.length - 1) {
        title = 'Career complete! You\'re a legend.';
        stats.push({ label: 'Career rep', value: fmtNum(c.rep) });
        profile.career = null;
        buttons.push({ label: 'Back to menu', primary: true, fn: () => { sfx.click(); showTitle(); } });
      } else {
        c.world++; c.level = 0; c.picks = [];
        buttons.push({ label: `On to ${WORLDS[c.world].name} ▶`, primary: true, fn: () => { sfx.click(); openMap(); } });
      }
    } else {
      c.level++;
      buttons.push({ label: 'Continue ▶', primary: true, fn: () => { sfx.click(); openMap(); } });
    }
    stats.push({ label: 'Lives', value: (profile.career ? profile.career.lives : c.lives) + ' ♥' });
  } else {
    if (G.kind === 'daily') {
      const best = profile.best[opt.daily] || 0;
      if (total > best) { profile.best[opt.daily] = total; title = best ? 'New daily best!' : 'Daily run complete'; }
      stats.push({ label: 'Today\'s best', value: fmtNum(Math.max(best, total)) });
      buttons.push({ label: 'Menu', fn: () => { sfx.click(); showTitle(); } });
      buttons.push({ label: 'Ride again', primary: true, fn: () => { sfx.click(); beginRun(opt, G.kind); } });
    } else {
      buttons.push({ label: 'Menu', fn: () => { sfx.click(); showTitle(); } });
      buttons.push({ label: 'New trail', fn: () => { sfx.click(); startTrack(freeRideOption(opt.world, Math.floor(Math.random() * 1e9)), 'free'); } });
      buttons.push({ label: 'Ride again', primary: true, fn: () => { sfx.click(); beginRun(opt, G.kind); } });
    }
  }
  saveProfile(profile);
  G.state = 'results';
  UI.show('results');
  $('touch').classList.add('hidden');
  UI.results({ eyebrow, title, stats, objective, buttons });
}
function gameOver() {
  const c = profile.career, r = G.run;
  const total = tricks.runRep;
  profile.totalRep += total; c.rep += total;
  profile.bestRun = Math.max(profile.bestRun, total);
  const stats = [
    { label: 'Career rep', value: fmtNum(c.rep), big: true },
    { label: 'Reached', value: `${WORLDS[c.world].name} ${c.level === 4 ? 'boss' : 'L' + (c.level + 1)}` },
    { label: 'Trails ridden', value: c.tracks || 0 }, { label: 'Bails', value: c.bails || 0 },
    { label: 'Total rep (all time)', value: fmtNum(profile.totalRep) },
  ];
  profile.career = null; saveProfile(profile);
  G.state = 'results';
  UI.show('results'); $('touch').classList.add('hidden');
  UI.results({ eyebrow: 'Out of lives', title: 'Career over', stats, objective: null, buttons: [
    { label: 'Menu', fn: () => { sfx.click(); showTitle(); } },
    { label: 'New career', primary: true, fn: () => { sfx.click(); act('career'); } },
  ] });
  void r;
}
function pause(on) {
  if (on) {
    if (!['ride', 'crashed', 'intro', 'finishing'].includes(G.state)) return;
    G.prePause = G.state; G.state = 'paused';
    $('pause').classList.remove('hidden');
    $('btnRestart').classList.remove('hidden');
    $('restartSub').textContent = G.kind === 'career' ? 'From the top (keeps your lives)' : 'From the top';
    $('quitSub').textContent = G.kind === 'career' ? 'Back to the map — this trail won\'t count' : '';
  } else if (G.state === 'paused') {
    G.state = G.prePause; $('pause').classList.add('hidden');
  }
}

// ------------------------------------------------------------------ actions (buttons with data-act)
function act(a) {
  switch (a) {
    case 'continue': openMap(); break;
    case 'career':
      if (profile.unlockedWorld > 0) openWorlds('Start your career in…', profile.unlockedWorld, (wi) => { newCareer(profile, wi); saveProfile(profile); openMap(); });
      else { newCareer(profile, 0); saveProfile(profile); openMap(); }
      break;
    case 'freeride': openWorlds('Free ride — pick a world', WORLDS.length - 1, (wi) => startTrack(freeRideOption(wi, Math.floor(Math.random() * 1e9)), 'free')); break;
    case 'daily': startTrack(dailyOption(), 'daily'); break;
    case 'rider': openOverlay('riderPanel'); break;
    case 'settings': openOverlay('settings'); break;
    case 'controls': openOverlay('controls'); break;
    case 'back': if (!closeOverlay()) { if (G.state === 'worlds') showTitle(); } break;
    case 'quitCareer': saveProfile(profile); showTitle(); break;
    case 'ride': { const c = profile.career; if (!c || G.selected == null) break; const opts = levelOptions(c.seedBase, c.world, c.level); const o = opts[G.selected] || opts[0]; startTrack(o, 'career'); break; }
    case 'resume': pause(false); break;
    case 'respawn': pause(false); if (G.state === 'ride') respawn(true); else if (G.state === 'crashed') G.crashT = 99; break;
    case 'restart': $('pause').classList.add('hidden'); beginRun(G.run.opt, G.kind); break;
    case 'quitRun': $('pause').classList.add('hidden'); if (G.kind === 'career') { saveProfile(profile); openMap(); } else showTitle(); break;
    case 'randomRider': {
      const p = (l) => l[Math.floor(Math.random() * l.length)];
      Object.assign(profile.rider, { frame: p(COLOR_SETS.frame), accent: p(COLOR_SETS.accent), jersey: p(COLOR_SETS.jersey), jacc: p(COLOR_SETS.jersey), pants: p(COLOR_SETS.pants), helmet: p(COLOR_SETS.helmet) });
      applyRider(); UI.riderPanel(profile.rider, applyRider);
      break;
    }
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) { sfx.click(); act(b.dataset.act); }
});
document.addEventListener('mouseover', (e) => { if (e.target.closest && e.target.closest('.mbtn, .btn, .tcard, .wcard')) sfx.hover(); });
// audio has to start from a user gesture
let audioOn = false;
function startAudio() {
  if (audioOn) return;
  if (!initAudio()) return;
  audioOn = true;
  setVolumes(profile.settings.sfx, profile.settings.music);
  if (G.world) music.play(G.world.music, G.opt ? G.opt.seed : 1);
}
addEventListener('pointerdown', () => { startAudio(); if (G.state === 'intro') dropIn(); });
addEventListener('keydown', startAudio);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(true); suspend(true); } else suspend(false); });

// ------------------------------------------------------------------ the title-screen bot (and a handy autopilot)
function bot(b, c, ctrl) {
  const look = b.s + 5 + b.speed * 0.6, p = c.pointAt(look);
  const err = wrapAngle(Math.atan2(p.x - b.pos.x, p.z - b.pos.z) - b.yaw);
  ctrl.steer = clamp(-err * 2.5, -1, 1); ctrl.spin = 0;
  let vt = 99; for (let k = Math.floor(b.s); k < Math.min(c.N, b.s + 35); k++) vt = Math.min(vt, c.V[k]);
  const fe = c.nearFeature(b.s + 25, 0); if (fe && fe.vIn) vt = Math.min(vt, fe.vIn + 0.3);
  ctrl.pedal = b.speed < vt - 0.5 ? 1 : 0; ctrl.brake = b.speed > vt + 1.5 ? 0.7 : 0;
  for (const k in ctrl.tricks) ctrl.tricks[k] = false;
  if (b.airborne) {
    ctrl.pedal = 0; ctrl.brake = 0;
    if (G.botTrick && b.air > 0.18 && b.vel.y > -2.2) ctrl.tricks[G.botTrick] = true;
    if (G.botTrick === 'whip' && b.air > 0.15) ctrl.tricks.whip = true;
  }
  ctrl.trickHeld = tricks.trickHeld();
  return ctrl;
}

// ------------------------------------------------------------------ frame
let last = performance.now();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = (now - last) / 1000; last = now;
  const dt = Math.min(MAXDT, Math.max(0.0001, dtRaw));
  G.frameMs = G.frameMs * 0.95 + dtRaw * 1000 * 0.05;
  adaptResolution(dt);
  if (!G.course) { input.endFrame(); return; }
  renderer.info.reset();
  const b = G.bike;
  const inp = input.poll(b.airborne);
  globalKeys();
  const st = G.state;
  const attract = ['title', 'worlds', 'map', 'loading'].includes(st) || G.overlays.length && !G.run;
  const physicsOn = attract || st === 'ride' || st === 'intro' || st === 'crashed' || st === 'finishing';
  if (physicsOn) simulate(dt, inp, attract);
  placeVisuals(dt);
  if (G.run && G.kind) updateHud(dt);
  post.render(dt);
  input.endFrame();
}
function globalKeys() {
  if (input.action('pause')) {
    if (G.overlays.length) closeOverlay();
    else if (G.state === 'paused') pause(false);
    else if (['ride', 'crashed', 'intro', 'finishing'].includes(G.state)) pause(true);
    else if (G.state === 'worlds') showTitle();
    else if (G.state === 'map') showTitle();
  }
  if (input.action('music')) { const on = music.toggle(); if (G.run) UI.toast(on ? 'Music on' : 'Music off'); }
  if (G.state === 'intro' && (input.pressed('Space') || input.pressed('Enter') || input.action('confirm'))) dropIn();
  if (['ride', 'crashed', 'finishing', 'intro'].includes(G.state) && input.action('cam')) {
    rig.mode = (rig.mode + 1) % CAM_MODES.length; profile.settings.camera = rig.mode; rig.snap();
    $('camName').textContent = CAM_MODES[rig.mode] + ' cam'; G.camMsgT = 2;
  }
  if (G.state === 'ride' && input.action('reset')) respawn(true);
}

function simulate(dt, inp, attract) {
  const b = G.bike, c = G.course, r = G.run;
  let ctrl;
  if (attract) ctrl = bot(b, c, ctrlBot);
  else if (G.state === 'ride' && TEST && window.SENDERS.autopilot) ctrl = bot(b, c, ctrlBot);
  else if (G.state === 'ride') { ctrl = inp; ctrl.trickHeld = tricks.trickHeld(); }
  else if (G.state === 'finishing') { ctrl = ctrlIdle; ctrlIdle.brake = 0.5; ctrlIdle.steer = bot(b, c, ctrlBot).steer; }
  else ctrl = ctrlIdle;
  if (G.state !== 'finishing') ctrlIdle.brake = 0;
  // countdown before the drop
  if (G.state === 'intro' && G.count >= 0) {
    G.introT += dt;
    if (G.introT > 0.75) {
      G.introT = 0; G.count--;
      if (G.count > 0) { UI.bigMsg(String(G.count), '', 0); sfx.count(); }
      else { UI.bigMsg('Send it!', 'orange', 900); sfx.go(); G.state = 'ride'; b.frozen = false; r.started = true; b.vel.copy(b.f).multiplyScalar(2.5); }
    }
  }
  if (G.state === 'crashed' || (attract && b.crashed)) {
    rider.updateRagdoll(dt, c); debris.update(dt, c);
    G.crashT += dt;
    if (attract) { if (G.crashT > 2.5 || G.attractCrashT > 2.5) { G.crashS = b.s; respawnAttract(); } G.attractCrashT += dt; }
    else if (G.crashT > 3.4 || (G.crashT > 1.8 && rider.rag && rider.rag.settle < 0.5)) {
      if (G.kind === 'career' && profile.career && profile.career.lives <= 0) gameOver();
      else respawn(false);
    }
  } else {
    G.acc += dt;
    const h = 1 / 240;
    let n = 0;
    const maxN = TEST ? 64 : 16;
    while (G.acc >= h && n < maxN) { b.step(h, ctrl); G.acc -= h; n++; if (b.crashed) break; }
    if (n >= maxN) G.acc = 0;
    tricks.update(dt, b, ctrl.tricks || {}, performance.now() / 1000);
    handleBikeEvents(attract);
  }
  if (r && G.state !== 'crashed' && r.started && !r.finished) {
    r.time += dt;
    r.maxSpeed = Math.max(r.maxSpeed, b.speed);
    if (b.airborne) r.air += dt;
    if (r.obj.obj && r.obj.obj.id === 'speed' && r.obj.event({ type: 'speed', kmh: b.speed * 3.6 })) objectiveDone();
    // checkpoints & finish
    const cps = c.checkpoints;
    while (r.cps < cps.length && b.s > cps[r.cps] && b.dist < c.outer + 3) {
      r.cps++; sfx.checkpoint(); UI.toast('Checkpoint', fmtTime(r.time), '');
    }
    if (b.s >= c.L && b.dist < c.outer + 6 && !b.crashed) finishRun();
    // off the trail?
    if (b.dist > 34 && !b.crashed) {
      r.offT += dt;
      $('warn').classList.remove('hidden');
      $('warn').textContent = `Back to the trail! ${Math.max(0, 4 - r.offT).toFixed(1)}`;
      if (r.offT > 4 || b.dist > 75) { r.offT = 0; $('warn').classList.add('hidden'); respawn(true); UI.toast('Reset to trail', '', 'bad'); }
    } else if (r.offT > 0) { r.offT = 0; $('warn').classList.add('hidden'); }
    // close calls with trees
    if (b.speed > 9 && !b.crashed) {
      c.obstaclesNear(b.pos.x, b.pos.z, (o) => {
        if (o.top !== undefined) return;
        const d = Math.hypot(b.pos.x - o.x, b.pos.z - o.z) - o.r;
        if (d < 0.95 && d > 0.2) tricks.closeCall(o, performance.now() / 1000);
      });
    }
  }
  if (G.state === 'finishing') { G.finishT += dt; if (G.finishT > 2.8) showResults(); }
  if (attract && !b.crashed && b.s > c.L + 30) { b.reset(45, 9); rig.snap(); }
}
function respawnAttract() {
  const b = G.bike, c = G.course;
  const s = c.respawnS(G.crashS);
  b.reset(s, Math.min(c.V[Math.round(s)] * 0.8, 9));
  rider.endRagdoll(); tricks.lose(); rig.snap(); G.crashT = 0; G.attractCrashT = 0;
}

function handleBikeEvents(attract) {
  const b = G.bike, r = G.run;
  for (const e of b.events) {
    if (e.type === 'takeoff') {
      tricks.takeoff(); input.takeoff();
      if (attract || (TEST && window.SENDERS.autopilot)) { const f = G.course.nearFeature(b.s, 0); G.botTrick = f && (f.type === 'table' || f.type === 'gap' || f.type === 'boss') ? [null, 'up', 'left', 'down', 'right', 'whip'][Math.floor(Math.random() * 6)] : null; }
    } else if (e.type === 'pop') sfx.pop();
    else if (e.type === 'land') {
      const surf = b.ground[1].surf;
      sfx.land(e.impact, surf);
      rig.shake(Math.min(0.8, e.impact / 14));
      if (e.impact > 4) fx.burst(_v.set(b.pos.x, b.ground[1].h, b.pos.z), b.vel, surf, Math.min(1.5, e.impact / 7));
      if (e.airTime > 0.25) {
        const res = tricks.landed(e);
        if (r && res) {
          r.jumps++; if (e.perfect) r.perfects++;
          const boss = G.course.features.some((f) => f.type === 'boss' && Math.abs(b.s - f.sLand - 6) < 22);
          if (r.obj.event({ type: 'jump', airTime: e.airTime, perfect: e.perfect, parts: res.parts, boss })) objectiveDone();
          if (boss) { UI.bigMsg('Boss jump landed!', 'orange', 2200); sfx.cheer(2); post.flash = 0.4; }
          if (!r.bestTrick || res.score > r.bestTrick.score) r.bestTrick = res;
        }
        if (G.crowdLvl > 0.2 && e.airTime > 0.7) sfx.cheer(Math.min(2, G.crowdLvl * 2));
      }
    } else if (e.type === 'crash') onCrash(e, attract);
  }
  b.events.length = 0;
}

// tricks -> HUD and objectives
tricks.on((e) => {
  const r = G.run;
  if (!r || !G.kind) return;
  if (e.type === 'jump') {
    const cls = e.perfect ? 'perfect' : '';
    UI.popup(`${e.name} <b>+${fmtNum(e.score)}</b>${e.perfect ? '<br><small>PERFECT</small>' : e.sketchy ? '<br><small>SKETCHY</small>' : ''}`, cls);
    sfx.trick();
  } else if (e.type === 'trick') {
    UI.popup(`${e.name} <b>+${fmtNum(e.score)}</b>`);
    if (e.kind === 'manual' && r.obj.event({ type: 'manual', secs: e.data.secs })) objectiveDone();
    if (e.kind === 'close' && r.obj.event({ type: 'close' })) objectiveDone();
  } else if (e.type === 'trickDone') sfx.whoosh();
  else if (e.type === 'bank') {
    r.bestCombo = Math.max(r.bestCombo, e.total);
    UI.toast(`+${fmtNum(e.total)} rep`, e.mult > 1 ? `${fmtNum(e.base)} × ${e.mult}` : '', 'gold');
    sfx.bank(e.mult >= 3);
    if (r.obj.event({ type: 'bank', total: e.total })) objectiveDone();
    if (r.obj.event({ type: 'rep', total: tricks.runRep })) objectiveDone();
  } else if (e.type === 'lost') UI.toast('Combo lost', fmtNum(e.total), 'bad');
});

// ------------------------------------------------------------------ visuals each frame
function placeVisuals(dt) {
  const b = G.bike, c = G.course;
  const crashed = b.crashed;
  if (crashed) { bikeModel.root.position.copy(debris.pos); bikeModel.root.quaternion.copy(debris.q); }
  else {
    bikeModel.root.position.copy(b.pos);
    _e.set(-b.pitch, b.yaw, b.roll + Math.sin(performance.now() * 0.03) * b.wobble * 0.08, 'YXZ');
    bikeModel.root.quaternion.setFromEuler(_e);
  }
  bikeModel.steer = b.steerVis;
  const levelCrank = Math.round(b.crank / Math.PI) * Math.PI;
  if (b.pedaling > 0.1) bikeModel.crankAngle = b.crank; else { b.crank = damp(b.crank, levelCrank, 6, dt); bikeModel.crankAngle = b.crank; }
  bikeModel.update(b, crashed ? null : tricks.vis);
  if (!crashed || !rider.rag) {
    const susp = (b.susp[0] + b.susp[1]) / 2 / 0.17;
    const ctl = input.state;
    const human = G.state === 'ride' && G.kind;
    const crouch = clamp(0.3 + b.charge * 0.6 + b.landSquash * 0.55 + susp * 0.25 + (b.airborne ? 0.08 : 0) - (b.pedaling > 0 ? 0.08 : 0), 0, 1);
    let fb = 0;
    if (b.airborne) fb = clamp(-b.pitchRate / 5, -1, 1) * 0.7;
    else if (human && Math.abs(ctl.lean) > 0.3) fb = ctl.lean;
    if (b.manual > 0) fb = -1;
    rider.poseOnBike(bikeModel, { crouch, fb, side: clamp(-b.yawRate * b.vLong * 0.03, -1, 1), w: tricks.w });
  }
  // camera
  const focus = crashed && rider.rag ? rider.centre(_v2) : null;
  const orbit = ['title', 'worlds', 'loading', 'map'].includes(G.state) || (G.overlays.length && !G.run);
  const panel = G.overlays.length && G.overlays[G.overlays.length - 1].id === 'riderPanel';
  const frameSide = panel ? 1 : ['title', 'loading'].includes(G.state) ? -1 : 0;
  rig.update(dt, { bike: b, course: c, rider, crashed: crashed && !!rider.rag, focus, mode: orbit || panel ? 'orbit' : null, frame: frameSide });
  if (G.veg) G.veg.update(camera.position, camForward());
  if (G.terrain) G.terrain.update(camera.position, dt);
  if (G.grass) G.grass.update(dt, camera.position);
  shared.time.value += dt; shared.rider.value.copy(b.pos);
  sky.update(crashed && rider.rag ? rider.P.pelvis : b.pos, camera.position, dt);
  // dust
  if (!crashed && b.grounded && b.speed > 6) {
    const g = b.ground[1];
    G.dustT += dt * (b.speed / 9) * (1 + b.slip * 5) * (g.surf === 1 ? 0.35 : g.surf === 3 ? 0 : 1);
    while (G.dustT > 0.06) {
      G.dustT -= 0.06;
      _v.set(b.pos.x - b.f.x * 0.61, g.h, b.pos.z - b.f.z * 0.61);
      fx.trail(_v, b.vel, g.surf, Math.min(1, b.speed / 20 + b.slip));
    }
  }
  fx.update(dt, camera.position);
  // crowd noise
  G.crowdT -= dt;
  if (G.crowdT <= 0 && c.crowd) {
    G.crowdT = 0.25;
    let best = 1e9; for (const p of c.crowd) { const d = (p.x - b.pos.x) ** 2 + (p.z - b.pos.z) ** 2; if (d < best) best = d; }
    G.crowdLvl = clamp(1 - Math.sqrt(best) / 60, 0, 1);
  }
  const riding = !!G.run && ['ride', 'finishing', 'intro'].includes(G.state);
  const active = (riding || (!G.run && !crashed)) && G.state !== 'paused';
  updateAudio({ active, speed: b.speed, grounded: b.grounded, surf: b.ground[1].surf, pedal: b.pedaling, slip: b.slip, crowd: G.crowdLvl * (riding ? 1 : 0.4), air: b.airborne });
  music.setIntensity(riding ? clamp(0.3 + b.speed / 22 + (b.airborne ? 0.15 : 0), 0.3, 1) : 0.4);
  post.speed = Q.post >= 2 && riding ? clamp((b.speed - 14) / 10, 0, 1) * 0.9 : 0;
  post.red = G.state === 'crashed' ? Math.max(0, 0.35 - G.crashT * 0.15) : 0;
  rig.rumble = b.grounded && riding ? clamp(b.speed / 20, 0, 1) * (b.ground[1].surf === 2 ? 2 : 0.6) : 0;
}

// ------------------------------------------------------------------ HUD
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud(dt) {
  const r = G.run, b = G.bike, c = G.course;
  setText('timer', fmtTime(r.time));
  setText('speedVal', String(Math.round(b.speed * 3.6)));
  setText('repVal', fmtNum(tricks.runRep));
  const p = clamp(b.s / c.L, 0, 1) * 100;
  $('progFill').style.width = p.toFixed(1) + '%'; $('progDot').style.left = p.toFixed(1) + '%';
  if (r.obj.obj) {
    setText('objText', r.obj.label());
    const cls = r.obj.done ? 'done' : r.obj.failed ? 'failed' : '';
    if (hudCache.objCls !== cls) { hudCache.objCls = cls; $('objective').className = cls; }
  }
  if (tricks.combo > 0) {
    $('combo').classList.remove('hidden');
    setText('comboMult', 'x' + Math.max(1, Math.floor(tricks.comboMult)));
    setText('comboScore', fmtNum(tricks.combo));
    $('comboFill').style.width = (clamp(tricks.comboTimer / 3.2, 0, 1) * 100).toFixed(0) + '%';
    setText('comboNames', tricks.comboNames.slice(-3).join(' · '));
  } else $('combo').classList.add('hidden');
  // live trick readout in the air
  let tt = '';
  if (b.airborne && b.air > 0.2 && !b.crashed) {
    const parts = [];
    const fl = -b.pitchAccum / TAU;
    if (Math.abs(fl) > 0.55) parts.push((Math.abs(fl) > 1.6 ? 'Double ' : '') + (fl < 0 ? 'Backflip' : 'Frontflip'));
    const sp = Math.abs(b.yawAccum) * 180 / Math.PI;
    if (sp > 160) parts.push(Math.round(sp / 180) * 180 + '');
    for (const k of ['superman', 'tabletop', 'nohander', 'cancan']) if (tricks.w[k] > 0.5) parts.push({ superman: 'Superman', tabletop: 'Tabletop', nohander: 'No Hander', cancan: 'Can-Can' }[k] + ' ' + tricks.held[k].toFixed(1) + 's');
    if (tricks.spin.whip >= 0 || tricks.count.whip) parts.push('Tailwhip' + (tricks.count.whip > 1 ? ' x' + tricks.count.whip : ''));
    if (tricks.spin.barspin >= 0 || tricks.count.barspin) parts.push('Barspin' + (tricks.count.barspin > 1 ? ' x' + tricks.count.barspin : ''));
    tt = parts.join(' + ');
  }
  setText('trickText', tt);
  if (G.camMsgT > 0) { G.camMsgT -= dt; if (G.camMsgT <= 0) setText('camName', ''); }
  if (G.state === 'ride') { G.keysT += dt; if (G.keysT > 22) $('keys').classList.add('fade'); }
}

// ------------------------------------------------------------------ keep the frame rate up
let perfAcc = 0, perfN = 0, perfT = 0;
function adaptResolution(dt) {
  if (TEST) return;
  perfAcc += dt; perfN++; perfT += dt;
  if (perfT < 2) return;
  const avg = perfAcc / perfN; perfAcc = 0; perfN = 0; perfT = 0;
  let next = resScale;
  if (avg > 1 / 42) next = Math.max(0.55, resScale - 0.1);
  else if (avg < 1 / 57 && resScale < 1) next = Math.min(1, resScale + 0.05);
  if (next !== resScale) {
    resScale = next;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr) * resScale);
    renderer.setSize(innerWidth, innerHeight); post.resize(); fx.setScale(innerHeight * renderer.getPixelRatio());
  }
}

// ------------------------------------------------------------------ go
window.SENDERS = { G, profile, tricks, rig, renderer, scene };   // handy for debugging in the console
requestAnimationFrame(frame);
boot().catch((err) => {
  console.error(err);
  $('bootText').textContent = 'Something went wrong: ' + err.message;
});
