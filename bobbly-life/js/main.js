// Bobbly Life — main loop, player control, camera, multiplayer glue.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { G, loadSave, writeSave, clamp, rand, pick, COLORS, angleLerp, UP, WATER_Y } from './state.js';
import { buildWorld, buildLights, updateWorld, LOC, groundHeight, nearColliders, setShadows, setDrawDistances, baseHeight } from './world.js';
import { Character, updateNPC, randomOutfit, PARTS, SKIN_TONES, HAIRS, HAIR_COLORS } from './character.js';
import { Vehicle, VTYPES, bumpVehicles, randomCarColor } from './vehicles.js';
import { updateProps, kickProps, spawnPresents, updatePresents, updateTrees, hitTree, scatterProps, buildPropMesh } from './props.js';
import { initJobs, updateJobs, quitJob, updateFishing, stopFishing } from './jobs.js';
import * as UI from './ui.js';
import * as NET from './net.js';
import * as ADMIN from './admin.js';
G.adminSpeedMult = () => ADMIN.speedMult() * (G.fun ? G.fun.speed : 1); G.adminJumpMult = () => ADMIN.jumpMult() * (G.fun ? G.fun.jump : 1);
ADMIN.restore();
import { initAudio, sfx, setEngine, setMusic, musicPlaying, ambience } from './audio.js';
import { initTraffic, updateTraffic, initSkyTraffic, updateSkyTraffic } from './traffic.js';
import { updateDebris } from './debris.js';
import { updateCockpit } from './cockpit.js';
import { initQuests, updateQuests, fireCannon } from './quests.js';
import { initPolice, updatePolice } from './police.js';
import { initRocket, updateRocket } from './rocket.js';
import { PRESENT_SPOTS } from './props.js';
import { WEAPONS, fire, spawnShot, applyHit, updateWeapons, updateGunMeshes } from './weapons.js';
import { initOcean, updateOcean } from './ocean.js';
import { setNormalMaker } from './character.js';
import { normalFromHeight } from './textures.js';
setNormalMaker(normalFromHeight);
import { initSky, updateSky } from './sky.js';
import { initGrass, updateGrass } from './grass.js';
import { initWeather, updateWeather, weatherNet, applyWeatherNet } from './weather.js';
import { initTrain, updateTrain, onTrainNet } from './train.js';
import { initPark, updatePark, onRidesNet } from './park.js';
import { initModes, updateModes, onModeMsg, startMode, stopMode } from './modes.js';
import { updateArcade, arcadeKey } from './arcade.js';
import { updateGadgets, grappleKey } from './gadgets.js';
import { updateBattle, cutsceneCamera, skipCutscene } from './boss.js';
import { initCreatures, updateCreatures } from './creatures.js';
import { loadPhotos } from './photos.js';
import { touch, initTouch, updateTouch } from './touch.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
// phones and tablets start with touch controls; laptops and Chromebooks with touchscreens switch over when you touch the screen
let isTouch = matchMedia('(pointer: coarse)').matches;
const isChromebook = /CrOS/.test(navigator.userAgent);

// ---------------------------------------------------------------- setup
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
// Colour grade: natural colours with a little extra contrast and a soft vignette, plus FXAA (smooths jagged edges, cheap
// enough for Chromebooks).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.03 }, contrast: { value: 1.08 }, vig: { value: 0.34 }, uw: { value: 0 }, time: { value: 0 }, flash: { value: 0 }, fxaa: { value: 1 }, res: { value: new THREE.Vector2(1280, 720) }, blur: { value: 0 }, boom: { value: 0 }, slow: { value: 0 }, rays: { value: 0 }, sun: { value: new THREE.Vector2(0.5, 0.5) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, contrast, vig, uw, time, flash, fxaa, blur, boom, slow, rays; uniform vec2 res, sun; varying vec2 vUv;
    float lu(vec3 c){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return l / (1.0 + l); }
    vec3 aa(vec2 uv){
      vec2 px = 1.0 / res;
      vec3 nw = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(tDiffuse, uv + vec2(1.0, -1.0) * px).rgb;
      vec3 sw = texture2D(tDiffuse, uv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(tDiffuse, uv + vec2(1.0, 1.0) * px).rgb;
      vec3 m = texture2D(tDiffuse, uv).rgb;
      float lNW = lu(nw), lNE = lu(ne), lSW = lu(sw), lSE = lu(se), lM = lu(m);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < 0.04) return m;
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
      dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * px;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv - dir * 0.1667).rgb + texture2D(tDiffuse, uv + dir * 0.1667).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lB = lu(b);
      return (lB < lMin || lB > lMax) ? a : b;
    }
    void main(){
      vec2 uv = vUv;
      vec4 c = texture2D(tDiffuse, uv);
      if (uw > 0.0) {
        // underwater: the view wobbles and softens like looking through moving water
        uv += vec2(sin(uv.y * 38.0 + time * 1.9) + sin(uv.y * 17.0 - time * 1.3), cos(uv.x * 29.0 + time * 1.6)) * 0.0016 * uw;
        float b = 0.0022 * uw;
        c.rgb = texture2D(tDiffuse, uv).rgb * 0.36 + (texture2D(tDiffuse, uv + vec2(b, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(b, 0.0)).rgb + texture2D(tDiffuse, uv + vec2(0.0, b * 1.6)).rgb + texture2D(tDiffuse, uv - vec2(0.0, b * 1.6)).rgb) * 0.16;
      } else if (fxaa > 0.5) c.rgb = aa(uv);
      // speed blur: the edges of the screen streak outwards when you go really fast
      if (blur > 0.01) {
        vec2 d = (uv - 0.5) * blur * 0.06; vec3 acc = c.rgb;
        for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, uv - d * float(i)).rgb;
        c.rgb = mix(c.rgb, acc / 7.0, smoothstep(0.05, 0.45, length(uv - 0.5)));
      }
      // sun rays: bright sky streams out from behind trees and buildings
      if (rays > 0.01) {
        vec2 st = (sun - uv) / 18.0; vec2 q = uv; float lit = 0.0, w = 1.0;
        for (int i = 0; i < 18; i++) { q += st; vec3 s2 = texture2D(tDiffuse, q).rgb; lit += smoothstep(1.1, 2.4, dot(s2, vec3(0.33))) * w; w *= 0.93; }
        c.rgb += vec3(1.0, 0.86, 0.62) * lit * 0.045 * rays;
      }
      vec3 col = c.rgb;
      col += boom * vec3(1.0, 0.62, 0.25);
      col += flash * vec3(0.75, 0.8, 1.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat);
      col = (col - 0.18) * contrast + 0.18;
      vec2 d = vUv - 0.5; col *= 1.0 - (vig + uw * 0.9) * dot(d, d) * 1.3;
      col = mix(col, col * vec3(0.78, 1.0, 1.06), uw * 0.5);
      col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * vec3(1.05, 0.98, 0.9), slow * 0.45);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 2200);
G.scene = scene; G.camera = camera; G.renderer = renderer;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// ambient occlusion (Ultra graphics): soft contact shadows where things meet
const aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
aoPass.enabled = false;
aoPass.blendIntensity = 0.9;
aoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
// sprites (clouds, signs, smoke) have no depth to shade, so leave them out of the AO pass
aoPass.overrideVisibility = function () { const cache = this._visibilityCache; this.scene.traverse((o) => { cache.set(o, o.visible); if (o.isPoints || o.isLine || o.isSprite) o.visible = false; }); };
composer.addPass(aoPass);
// soft glow round bright things: the sun on water, street lamps, headlights, lightning
// (threshold above the brightest sky, so only real highlights glow: the sun on water, lamps, explosions)
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.3, 0.55, 1.45);
composer.addPass(bloomPass);
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);
composer.addPass(new OutputPass());
let useGrade = true;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); gradePass.uniforms.res.value.set(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()); aoPass.setSize(innerWidth, innerHeight); bloomPass.setSize(innerWidth / 2, innerHeight / 2); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const TIPS = [
  'Hold left click to grab things — and people. Let go to throw.',
  'Press R to ragdoll. Hold it to stay floppy.',
  'The elevator in Bobbly Tower goes all the way to the top. Bring a parachute (Space).',
  'Tab opens your phone: fast travel, vehicles and jobs.',
  'Crash a car hard enough and you will go through the windscreen.',
  'Planes take off from the airport runway — hold Space once you have speed.',
  'Jobs pay. Pizza, taxi, fire, garbage, lumber and fishing all earn cash.',
  'Press V for first person.',
  'Dive into Coral Bay with C — seven treasure chests are hidden down there!',
  'Jump off the Twin Towers and press Space for a WINGSUIT.',
  'Ride the train round the whole island, or drive it yourself!',
  'Bobbly Land has a rollercoaster with a loop. Hold on!',
  'Rain makes the roads slippery — brake early!',
];
$('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
async function progress(p, text) {
  $('loadFill').style.width = Math.round(p * 100) + '%';
  $('loadPct').textContent = Math.round(p * 100) + '%';
  $('loadText').textContent = text + '…';
  await new Promise(r => setTimeout(r, 30));
}
loadSave();
buildLights();
await loadPhotos(renderer, (f) => progress(f * 0.04, 'Loading real textures'));
await buildWorld(progress);
await progress(0.9, 'Spawning people and traffic');

const player = new Character(G.save.outfit, { isPlayer: true, name: G.save.name });
G.player = player;
player.place(LOC.spawn.x, 0, LOC.spawn.z, Math.PI);
player.respawn = (home) => {
  if (player.vehicle) player.vehicle.removeOccupant(player);
  if (player.held) dropHeld(false);
  stopFishing();
  const s = (home || G.save.house) && G.save.house ? { x: LOC.mansion.x, z: LOC.mansion.z - 2 } : LOC.spawn;
  player.place(s.x + rand(-2, 2), groundHeight(s.x, s.z, 5), s.z + rand(-2, 2), Math.PI);
};
player.onDrop = () => dropHeld(false);

// World vehicles
const WV = [
  ['scooter', 46, -10, 0], ['scooter', 46, -6, 0], ['scooter', 46, -2, 0], ['scooter', 46, 2, 0],
  ['taxi', -46, -9, Math.PI / 2], ['taxi', -46, 0, Math.PI / 2], ['taxi', -46, 9, Math.PI / 2],
  ['firetruck', 50, 68, 0], ['garbage', 42, -72, 0], ['pickup', -104, 16, Math.PI / 2], ['pickup', -92, -60, 0],
  ['icecream', -44, 46, Math.PI / 2], ['monster', -48, -40, Math.PI], ['sports', 21, -12, 0], ['sedan', -21, 14, Math.PI],
  ['police', 21, 16, 0], ['sedan', 99, 40, 0], ['sedan', -81, -20, Math.PI], ['sedan', 39, 120, 0], ['pickup', 159, 60, 0],
  ['boat', -45, -708, Math.PI / 2], ['boat', -40, -733, Math.PI / 2], ['sub', -12, -735, Math.PI / 2], ['boat', 360, -575, Math.PI], ['heli', -76, -78, 0], ['sports', -150, -28, 0],
  ['biplane', -122, 164, Math.PI / 2], ['jet', -138, 171.5, Math.PI / 2],
];
WV.forEach(([t, x, z, yaw], i) => new Vehicle(t, x, z, yaw, { id: 'w' + i, color: t === 'sedan' ? ['#3fa7ff', '#ff5b6e', '#b46cff', '#46c25a'][i % 4] : null }));
// go-karts lined up on the grid at the Crazy Go-Kart Track
(LOC.kartGrid || []).forEach((g, i) => new Vehicle('kart', g.x, g.z, g.yaw, { id: 'kart' + i, color: ['#e8322a', '#3fa7ff', '#ffd23a', '#46c25a', '#b97aff', '#ff8a2a'][i % 6] }));
// Showroom cars
[['sports', -12], ['monster', 0], ['police', 12]].forEach(([t, x], i) => {
  const v = new Vehicle(t, x, -50, Math.PI * 0.85, { id: 'd' + i });
  v.display = true;
});

// NPCs
// E-bikes ready to ride: a row by the spawn and a few at the stunt park
[['eb_hornet', 8, -21], ['eb_goldfork', 10.5, -21], ['eb_redline', 13, -21], ['eb_crimson', 15.5, -21], ['eb_shadow', -8, -21], ['eb_titan', -10.5, -21],
 ['eb_limited', -13, -21], ['eb_blackout', -15.5, -21], ['eb_stealth', -52, -46], ['eb_apex', -49, -46], ['eb_sting', -46, -46], ['eb_mini', -43, -46]]
  .forEach(([t, x, z], i) => new Vehicle(t, x, z, Math.PI, { id: 'eb' + i }));
// Cars parked along the suburban curbs
(G.parkedSpots || []).slice(0, 24).forEach((s, i) => new Vehicle(pick(['sedan', 'sedan', 'pickup', 'sports', 'sedan']), s.x, s.z, s.yaw, { id: 'pk' + i, color: randomCarColor() }));
// Airports: airliners at the gates, small planes by the hangars, cars in the car parks
(LOC.parkedPlanes || []).forEach((p, i) => new Vehicle(p.t, p.x, p.z, p.yaw, { id: 'ap' + i, livery: p.livery }));
(LOC.airportCars || []).forEach((s, i) => new Vehicle(pick(['sedan', 'sedan', 'pickup', 'taxi', 'sedan', 'sports']), s.x, s.z, s.yaw, { id: 'ac' + i, color: randomCarColor() }));
initTraffic(22);
initSkyTraffic();
initRocket();
initPolice();
initQuests();
initOcean();
initWeather();
initSky();
initTrain();
initPark();
initGrass();
initCreatures();   // animated robots + foxes load in the background
G.netSend = (m) => NET.send(m);
for (let i = 0; i < 44; i++) {
  const s = i < 24 ? pick(G.locations.sidewalks.filter(p => Math.hypot(p.x, p.z) < 160)) : pick(G.locations.sidewalks.filter(p => Math.hypot(p.x, p.z) >= 160));
  const n = new Character(randomOutfit(), { isNPC: true });
  n.place(s.x + rand(-1, 1), 0, s.z + rand(-1, 1), rand(0, 6.28));
  n.respawn = () => n.place(LOC.spawn.x + rand(-5, 5), 0, LOC.spawn.z + rand(-5, 5));
  G.npcs.push(n);
}
scatterProps();
spawnPresents();
initJobs();
UI.initUI();
initModes((m) => NET.send(m));

// ---------------------------------------------------------------- personal vehicles
let myVehicle = null;
G.spawnMyVehicle = (id) => {
  if (player.vehicle) { UI.toast('Get out of your current vehicle first!'); return; }
  if (myVehicle) { NET.send({ t: 'vdel', id: myVehicle.id }); myVehicle.destroy(); }
  const t = VTYPES[id];
  let x, z, yaw = player.facing;
  if (t.boat) {
    // the nearest deep enough water within 60 m, otherwise the pier in Slippy Bay
    let best = null;
    for (let a = 0; a < 16 && !best; a++) for (const d of [12, 25, 40, 60]) { const qx = player.root.x + Math.sin(a / 16 * Math.PI * 2) * d, qz = player.root.z + Math.cos(a / 16 * Math.PI * 2) * d; if (baseHeight(qx, qz) < WATER_Y - 1.5) { best = [qx, qz]; break; } }
    if (best) [x, z] = best;
    else { x = -45; z = -708; UI.toast('🚤 Your boat is waiting at the pier in Slippy Bay!'); G.waypoint = { x: -60, z: -712 }; }
    yaw = Math.PI / 2;
  } else if (t.sub) {
    x = -18; z = -700; yaw = Math.PI / 2;
    UI.toast('🟡 Your submarine is waiting in Slippy Bay, next to the pier!'); G.waypoint = { x: -28, z: -712 };
  } else if (t.plane) {
    // planes wait at the start of the nearest runway (airliners need the big international one)
    const list = (LOC.airports || []).filter(a => !t.airliner || a.name === 'Bobbly International');
    let a = list[0];
    for (const b of list) if (Math.hypot(b.x - player.root.x, b.z - player.root.z) < Math.hypot(a.x - player.root.x, a.z - player.root.z)) a = b;
    x = a.x; z = a.z; yaw = a.yaw;
    UI.toast(`${t.emo} Your plane is waiting on the runway at ${a.name}! (Phone → Fast Travel)`); G.waypoint = { x: a.x, z: a.z };
  } else {
    x = player.root.x + Math.sin(player.facing) * (t.len / 2 + 2.5);
    z = player.root.z + Math.cos(player.facing) * (t.len / 2 + 2.5);
  }
  myVehicle = new Vehicle(id, x, z, yaw, { owner: G.net.myId, color: t.color === '#3fa7ff' ? randomCarColor() : null });
  sfx.pop();
  UI.toast(`${t.emo} ${t.name} spawned!`);
};

// ---------------------------------------------------------------- input
const K = G.keys;
addEventListener('keydown', (e) => {
  if (G.ui.chatOpen) return;
  if (e.code === 'Tab') e.preventDefault();
  if (!G.started) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  const first = !K[e.code];
  K[e.code] = true;
  if (!first) return;
  onKey(e.code);
});
addEventListener('keyup', (e) => {
  K[e.code] = false;
  if (e.code === 'KeyR') player.holdRag = false;
});
addEventListener('blur', () => { for (const k in K) K[k] = false; G.mouse.grab = false; G.mouse.fire = false; });

function onKey(code) {
  if (G.cutscene && (code === 'Escape' || code === 'Enter' || code === 'Space')) { skipCutscene(); return; }
  if (code === 'Escape') {
    if (G.ui.panel) UI.closePanel();
    else if (G.ui.help) UI.showHelp(false);
    else if (G.ui.fishing) stopFishing();
    return;
  }
  if (code === 'Tab' || code === 'KeyP') { UI.togglePhone(); return; }
  if (code === 'KeyH') { UI.showHelp(!G.ui.help); return; }
  if (G.ui.panel || G.ui.help) return;
  if (code === 'KeyT' || code === 'Enter') { UI.openChat(); return; }
  if (code === 'KeyE') interact();
  if (code === 'KeyF') slap();
  if (code === 'KeyR') {
    if (player.vehicle) return;
    if (player.ragdoll) { player.holdRag = false; player.ragMin = Math.min(player.ragMin, player.ragT); }
    else { stopFishing(); player.flop(null, 0.8); player.holdRag = true; }
  }
  if (arcadeKey(code)) return;
  if (code === 'KeyJ') quitJob();
  if (code === 'KeyN' && G.openMap) { G.openMap(); return; }
  if (code === 'Backquote' && ADMIN.isAdmin()) { if (G.ui.panel) UI.closePanel(); else G.openAdmin(); return; }
  if (code === 'KeyM') { G.save.music = !musicPlaying(); setMusic(G.save.music); writeSave(); UI.toast(G.save.music ? '🎵 Music on' : '🔇 Music off'); }
  if (code === 'KeyV') {
    G.cam.fp = !G.cam.fp;
    G.cam.pitch = G.cam.fp ? 0 : 0.35;
    UI.toast(G.cam.fp ? '👀 First-person view (V to switch back)' : '🎥 Third-person view');
  }
  if (code === 'KeyG') cycleWeapon();
  if (code === 'KeyQ' && player.vehicle) sfx.honk();
  else if (code === 'KeyQ') grappleKey();
  const emotes = { Digit1: 'wave', Digit2: 'dance', Digit3: 'cheer', Digit4: 'sit' };
  if (emotes[code] && !player.vehicle) { player.emote = player.emote === emotes[code] ? null : emotes[code]; player.emoteT = 0; }
}

canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (!G.started || G.ui.panel || G.ui.help) return;
  if (!document.pointerLockElement && !isTouch) { canvas.requestPointerLock && canvas.requestPointerLock(); }
  if (e.button === 0 && player.weapon && !player.vehicle) { G.mouse.fire = true; return; }
  if (e.button === 0 && player.vehicle && player.vehicle.type.fighter) { G.mouse.fire = true; return; }
  if (e.button === 0 || e.button === 2) {
    if (G.mouse.grabLock) { G.mouse.grabLock = false; }
    G.mouse.grab = true;
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0 || e.button === 2) { G.mouse.grab = false; G.mouse.fire = false; } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  G.cam.yaw -= e.movementX * 0.0025;
  G.cam.pitch = clamp(G.cam.pitch + e.movementY * 0.0025, G.cam.fp ? -1.45 : -0.35, G.cam.fp ? 1.45 : 1.35);
  G.cam.lastMouse = G.time;
});
addEventListener('wheel', (e) => { if (G.started && !G.ui.panel) G.cam.dist = clamp(G.cam.dist + Math.sign(e.deltaY) * 0.8, 3, 18); }, { passive: true });

// Touch controls (phones and tablets): see touch.js. Touch the screen to switch to them, press a key to switch back.
let touchReady = false;
function setTouchMode(on) {
  isTouch = on;
  if (on && !touchReady) {
    touchReady = true;
    initTouch({ K, player, onKey, canvas, initAudio });
    // no accidental page zooming on iPhones
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => { if (isTouch) e.preventDefault(); }, { passive: false });
  }
  document.body.classList.toggle('touch', on);
  $('touch').classList.toggle('hidden', !on || !G.started);
  if (on && document.pointerLockElement) document.exitPointerLock();
}
if (isTouch) setTouchMode(true);
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !isTouch) setTouchMode(true); }, true);
addEventListener('keydown', (e) => { if (isTouch && touchReady && !G.ui.chatOpen && !matchMedia('(pointer: coarse)').matches && /^(Key[WASDEFRG]|Arrow|Space|Tab)/.test(e.code)) setTouchMode(false); }, true);

// ---------------------------------------------------------------- interactions
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const _fpq = new THREE.Quaternion();

function nearestInteract() {
  const P = player.root;
  let best = null, bd = 1e9;
  for (const it of G.interacts) {
    if (it.minY !== undefined && P.y < it.minY) continue;
    if (it.y !== undefined && Math.abs(P.y - it.y) > (it.dy || 3)) continue;
    if (it.when && !it.when()) continue;
    const d = Math.hypot(P.x - it.x, P.z - it.z);
    if (d < it.r && d < bd) { bd = d; best = it; }
  }
  return best;
}
function nearestVehicle() {
  let best = null, bd = 1e9;
  for (const v of G.vehicles) {
    if (v.display) continue;
    const d = Math.hypot(player.root.x - v.pos.x, player.root.z - v.pos.z);
    const reach = v.type.len / 2 + 2.8; // a freshly spawned vehicle (len / 2 + 2.5 away) is in reach
    if (d < reach && Math.abs(player.root.y - v.pos.y) < 3 && d < bd) {
      if (v.canBoard && !v.canBoard()) continue;
      const free = v.occupants.some((o, i) => !o && (i > 0 || !v.remoteDriver));
      if (free) { bd = d; best = v; }
    }
  }
  return best;
}

function interact() {
  if (G.arrested) return;
  if (G.rocketRide) { G.rocketE && G.rocketE(); return; }
  if (player.ragdoll) return;
  if (player.vehicle) {
    const v = player.vehicle;
    v.removeOccupant(player);
    sfx.door();
    if (v.stored && v.stored.length) {
      const pr = v.stored.shift(); pr.inVehicle = null;
      player.handPoint(pr.pos);
      pr.held = player; player.held = { kind: 'prop', obj: pr }; G.mouse.grabLock = true;
    }
    if (!v.driver && !v.remoteDriver) v.steerVis = 0;
    return;
  }
  const it = nearestInteract();
  if (it) { it.action(); return; }
  const v = nearestVehicle();
  if (v) {
    stopFishing();
    const seat = v.occupants.findIndex((o, i) => !o && (i > 0 || !v.remoteDriver));
    if (player.held) {
      if (player.held.kind === 'prop') { const pr = player.held.obj; pr.held = null; pr.inVehicle = v; (v.stored ||= []).push(pr); player.held = null; }
      else dropHeld(false);
    }
    G.mouse.grabLock = false; G.mouse.grab = false; player.ctrl.grab = false;
    player.emote = null;
    v.addOccupant(player, seat);
    if (G.cam.fp && v.type.airliner) G.cam.pitch = 0.3;
    sfx.door();
    if (seat === 0 && v.type.isBike) UI.toast('W throttle · S brake · A/D lean · WHEELIE: Shift (lean back) + W, then feather W and tap S/C to hold it at the balance point · Space hop · E off', '', 9000);
    else if (seat === 0 && v.type.plane) UI.toast(`${v.type.emo} W/S throttle · ↑ nose up · ↓ nose down · ← → bank & turn · build speed on the runway, then ↑ to take off at ${Math.round(v.type.takeoff * 3.6)} km/h · V = cockpit view · E jump out`, '', 9000);
    else if (v.type.rail || v.type.ride) UI.toast(v.type.tip ? v.type.tip(seat) : '🎢 Hold on tight! Press E to get off.', '', 7000);
    else if (seat === 0 && !G.seenDriveTip) { G.seenDriveTip = true; UI.toast(v.type.heli ? '🚁 W/S forward/back · A/D turn · Space up · Shift down · E exit' : 'W/S drive · A/D steer · Space brake · Q honk · E exit'); }
  }
}

function cycleWeapon() {
  const owned = Object.keys(WEAPONS).filter(id => G.save.ownedWeapons.includes(id));
  if (!owned.length) { UI.toast('🔫 You have no blasters yet — buy one at the Blaster Shop (stunt park)!'); G.waypoint = LOC.blasters; return; }
  const list = [null, ...owned];
  const i = list.indexOf(player.weapon || null);
  player.weapon = list[(i + 1) % list.length];
  G.save.weapon = player.weapon; writeSave();
  UI.toast(player.weapon ? `${WEAPONS[player.weapon].emo} ${WEAPONS[player.weapon].name} equipped — Left Click to shoot` : '✋ Blaster put away');
}
G.equipWeapon = (id) => { player.weapon = id; G.save.weapon = id; writeSave(); };

function slap() {
  if (player.ragdoll || player.vehicle || player.punchT > 0 || player.fishing) return;
  player.punchT = 0.3;
  setTimeout(() => {
    const f = player.fwd(_v);
    const hitPt = _w.copy(player.root).addScaledVector(f, 1.1); hitPt.y += 1.2;
    let hit = false;
    for (const ch of G.characters) {
      if (ch === player || ch.vehicle) continue;
      if (ch.p[PARTS.CHE].distanceTo(hitPt) < 1.3 || ch.p[PARTS.PEL].distanceTo(hitPt) < 1.1) {
        const imp = _u.copy(f).multiplyScalar(9); imp.y = 4.5;
        if (ch.isRemote) NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] });
        else ch.flop(imp, 2);
        hit = true;
      }
    }
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle) continue;
      if (pr.pos.distanceTo(hitPt) < 1.3) { pr.cargoOf = null; pr.vel.addScaledVector(f, 9); pr.vel.y += 3.5; hit = true; }
    }
    for (const t of G.trees) {
      if (!t.alive) continue;
      const dx = t.x - player.root.x, dz = t.z - player.root.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.3 && (dx * f.x + dz * f.z) / (d || 1) > 0.2) {
        hitTree(t); hit = true;
        if (!t.alive) UI.toast('🪵 TIMBER! Grab the logs and bring them to the sawmill.');
        break;
      }
    }
    if (hit) sfx.slap();
  }, 110);
}

function dropHeld(throwIt = true) {
  const h = player.held;
  if (!h) return;
  player.held = null;
  const f = player.fwd(_v);
  const power = throwIt ? 7 + Math.hypot(player.vel.x, player.vel.z) * 0.5 : 1;
  if (h.kind === 'prop') {
    const pr = h.obj;
    pr.held = null;
    pr.vel.copy(player.vel).addScaledVector(f, power); pr.vel.y = throwIt ? 4.5 : 1;
  } else if (h.kind === 'char') {
    const n = h.obj;
    n.grabbedBy = null;
    const imp = _u.copy(f).multiplyScalar(power); imp.y = throwIt ? 5 : 1;
    n.flop(imp, 1.5);
  } else if (h.kind === 'remote') {
    const imp = _u.copy(f).multiplyScalar(power); imp.y = throwIt ? 5 : 1;
    NET.send({ t: 'hit', to: h.obj.netId, imp: [imp.x, imp.y, imp.z] });
  }
}
G.dropHeld = dropHeld;

function updateGrab() {
  const p = player;
  if (p.ragdoll || p.vehicle) { if (p.held) dropHeld(false); return; }
  const grabbing = p.ctrl.grab && !p.hose && !p.fishing;
  if (!grabbing) { if (p.held) dropHeld(!G.mouse.grabLock); return; }
  const hp = p.handPoint(_w);
  if (!p.held) {
    let best = null, bd = 1.35;
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle) continue;
      const d = pr.pos.distanceTo(hp) - pr.r;
      if (d < bd) { bd = d; best = { kind: 'prop', obj: pr }; }
    }
    for (const ch of G.characters) {
      if (ch === p || ch.vehicle) continue;
      const d = Math.min(ch.p[PARTS.CHE].distanceTo(hp), ch.p[PARTS.PEL].distanceTo(hp), ch.p[PARTS.HEAD].distanceTo(hp)) - 0.4;
      if (d < bd) { bd = d; best = { kind: ch.isRemote ? 'remote' : 'char', obj: ch }; }
    }
    if (best) {
      p.held = best;
      if (best.kind === 'prop') { best.obj.held = p; best.obj.cargoOf = null; }
      else if (best.kind === 'char') best.obj.flop(null, 2.5);
      sfx.pop();
    }
  }
  if (p.held && p.held.kind !== 'prop') {
    const f = p.fwd(_v);
    const pt = new THREE.Vector3().copy(hp).addScaledVector(f, 0.35);
    pt.y += 0.2;
    if (p.held.kind === 'char') {
      const n = p.held.obj;
      if (!n.ragdoll) n.flop(null, 2);
      n.grabbedBy = { point: pt, t: 0.25 };
      n.ragMin = Math.max(n.ragMin, n.ragT + 1);
    } else p.held.pullPt = pt;
  }
}

// ---------------------------------------------------------------- multiplayer glue
// nobody can pretend to be the admin by putting a crown in their name
const cleanName = (n) => String(n || 'Player').replace(/👑|\[ADMIN\]/gi, '').trim().slice(0, 20) || 'Player';
function addRemote(id, name, outfit, did) {
  name = cleanName(name);
  if (id === G.net.myId) return null;
  if (G.remotes.has(id)) { const r0 = G.remotes.get(id); if (did) r0.did = did; return r0; }
  const r = new Character(outfit || randomOutfit(), { isRemote: true, name });
  r.netId = id; r.did = did;
  r.setName(name || 'Player');
  r.place(LOC.spawn.x, 0, LOC.spawn.z);
  G.remotes.set(id, r);
  updateRoomInfo();
  return r;
}
function removeRemote(id) {
  const r = G.remotes.get(id);
  if (!r) return;
  for (const v of G.vehicles) if (v.remoteDriver === id) v.remoteDriver = null;
  // their own spawned vehicles leave with them (unless someone is still sitting in one)
  for (const v of G.vehicles.filter(v => v.owner === id && !v.occupants.some(o => o))) v.destroy();
  if (r.heldMesh) G.scene.remove(r.heldMesh);
  r.destroy();
  G.remotes.delete(id);
  if (player.held && player.held.obj === r) player.held = null;
  updateRoomInfo();
}
function updateRoomInfo() {
  if (G.net.mode === 'solo') return;
  const el = $('roomInfo');
  el.classList.remove('hidden');
  el.innerHTML = `🌐 Room <b>${G.net.code}</b> · ${NET.playerCount()} player${NET.playerCount() > 1 ? 's' : ''} <button class="btn small blue" id="copyLink">Copy invite link</button>`;
  $('copyLink').onclick = () => {
    const link = location.origin + location.pathname + '?room=' + G.net.code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => UI.toast('📋 Invite link copied! Send it to your friends.'), () => UI.toast('Invite link: ' + link, '', 9000));
  };
}

NET.on('hello', (m) => {
  if (G.net.mode === 'host' && ADMIN.isBanned(m.did)) { NET.kick(m.from, 'banned'); return; }
  const r = addRemote(m.from, m.name, m.outfit, m.did);
  const who = r ? r.name : cleanName(m.name);
  UI.toast(`👋 ${who} joined the game!`);
  UI.chatLine('🌐', `${who} joined`, '#9be05a');
  if (G.net.mode === 'host') {
    const players = [{ id: G.net.myId, name: G.save.name, outfit: G.save.outfit, did: G.save.deviceId }];
    for (const [id, rr] of G.remotes) if (id !== m.from) players.push({ id, name: rr.name, outfit: rr.outfit, did: rr.did });
    NET.send({ t: 'welcome', to: m.from, players, d: G.dayTime, wx: weatherNet() });
  }
  void r;
});
NET.on('welcome', (m) => {
  for (const p of m.players) addRemote(p.id, p.name, p.outfit, p.did);
  G.dayTime = m.d;
  applyWeatherNet(m.wx);
  updateRoomInfo();
});
NET.on('leave', (m) => {
  const r = G.remotes.get(m.from);
  if (r) { UI.toast(`${r.name} left the game.`); UI.chatLine('🌐', `${r.name} left`, '#ff8fb0'); }
  removeRemote(m.from);
});
NET.on('disconnected', () => {
  UI.toast('❌ Lost connection to the host. You are now playing solo.', 'bad', 8000);
  for (const id of [...G.remotes.keys()]) removeRemote(id);
  G.net.mode = 'solo';
  $('roomInfo').classList.add('hidden');
});
NET.on('outfit', (m) => {
  const r = G.remotes.get(m.from);
  if (r) { r.setOutfit(m.outfit); const nm = r.isAdminPlayer ? '👑 ' + cleanName(m.name) + ' [ADMIN]' : cleanName(m.name); if (nm !== r.name) r.setName(nm); }
});
NET.on('chat', (m) => {
  const r = G.remotes.get(m.from);
  UI.chatLine(r ? r.name : '???', String(m.text).slice(0, 100), '#8fd3ff');
});
NET.on('time', (m) => { if (G.net.mode === 'client') { G.dayTime = m.d; applyWeatherNet(m.wx); } });
NET.on('trn', onTrainNet);
NET.on('mode', (m) => { if (G.net.mode === 'client') onModeMsg(m); });
NET.on('modeReq', (m) => { if (G.net.mode === 'host') { if (m.m === 'stop') stopMode(); else startMode(m.m); } });
NET.on('rides', (m) => { if (G.net.mode === 'client') onRidesNet(m); });
NET.on('wx', (m) => { if (G.net.mode === 'client') applyWeatherNet(m); });
G.onWeather = () => { if (G.net.mode === 'host') NET.send({ t: 'wx', ...weatherNet() }); };
NET.on('hit', (m) => {
  if (m.to && m.to !== G.net.myId) return;
  if (player.vehicle) return;
  stopFishing();
  player.flop(new THREE.Vector3(m.imp[0], m.imp[1], m.imp[2]), 2);
});
NET.on('pull', (m) => {
  if (m.to && m.to !== G.net.myId) return;
  if (player.vehicle) return;
  stopFishing();
  if (!player.ragdoll) player.flop(null, 1);
  player.grabbedBy = { point: new THREE.Vector3(m.pos[0], m.pos[1], m.pos[2]), t: 0.4 };
  player.ragMin = Math.max(player.ragMin, player.ragT + 0.6);
});
NET.on('shot', (m) => {
  if (!WEAPONS[m.w]) return;
  spawnShot(m.w, new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), true, m.c);
});
NET.on('shothit', (m) => {
  if (m.to && m.to !== G.net.myId) return;
  if (!WEAPONS[m.ty]) return;
  stopFishing();
  applyHit(player, new THREE.Vector3(...m.d), WEAPONS[m.ty]);
});
G.onRemoteShot = (ch, dir, type) => NET.send({ t: 'shothit', to: ch.netId, d: [dir.x, dir.y, dir.z], ty: type });
G.onRemoteHit = (ch, imp) => NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] });
NET.on('vdel', (m) => {
  const v = G.vehicles.find(v => v.id === m.id);
  if (v && !(player.vehicle === v && player.seat === 0)) { if (player.vehicle === v) v.removeOccupant(player); v.destroy(); }
});
NET.on('st', (m) => {
  let r = G.remotes.get(m.from);
  if (!r) return;
  r.applySnapshot(m.p, m.f, m.r);
  r.weapon = WEAPONS[m.w] ? m.w : null;
  r.netFlat = !!m.fl;
  // held item visual
  if (m.h !== r.heldType) {
    if (r.heldMesh) G.scene.remove(r.heldMesh);
    r.heldMesh = m.h ? buildPropMesh(m.h, m.hv) : null;
    if (r.heldMesh) G.scene.add(r.heldMesh);
    r.heldType = m.h;
  }
  // vehicle they drive
  if (m.v) {
    let v = G.vehicles.find(v => v.id === m.v.id);
    if (!v && VTYPES[m.v.t]) { v = new Vehicle(m.v.t, m.v.x, m.v.z, m.v.yaw, { id: m.v.id, color: m.v.c, owner: m.from }); v.pos.y = m.v.y; }
    if (v) {
      if (player.vehicle === v && player.seat === 0) { v.removeOccupant(player); UI.toast('Someone else took the wheel!'); }
      v.remoteDriver = m.from; v.net = m.v; v.netT = 0;
      if (r.drivingVid && r.drivingVid !== v.id) { const o = G.vehicles.find(x => x.id === r.drivingVid); if (o) o.remoteDriver = null; }
      r.drivingVid = v.id;
    }
  } else if (r.drivingVid) {
    const v = G.vehicles.find(x => x.id === r.drivingVid);
    if (v && v.remoteDriver === m.from) { v.remoteDriver = null; v.speed = 0; }
    r.drivingVid = null;
  }
});

let netAcc = 0, timeAcc = 0;
function netTick(dt) {
  if (G.net.mode === 'solo') return;
  netAcc += dt; timeAcc += dt;
  if (netAcc < 1 / 12) return;
  netAcc = 0;
  const heldProp = player.held && player.held.kind === 'prop' ? player.held.obj : null;
  const msg = {
    t: 'st', p: player.snapshot(), f: Math.round(player.facing * 100) / 100, r: player.ragdoll ? 1 : 0,
    h: heldProp ? heldProp.type : 0, hv: heldProp ? heldProp.variant : 0,
    v: player.vehicle && player.seat === 0 ? player.vehicle.netState() : 0,
    w: player.weapon || 0,
    fl: player.diving || player.wingsuit ? 1 : 0,
  };
  NET.send(msg);
  if (player.held && player.held.kind === 'remote' && player.held.pullPt) {
    const p = player.held.pullPt;
    NET.send({ t: 'pull', to: player.held.obj.netId, pos: [p.x, p.y, p.z] });
  }
  if (G.net.mode === 'host' && timeAcc > 5) { timeAcc = 0; NET.send({ t: 'time', d: G.dayTime, wx: weatherNet() }); }
}
G.onOutfit = () => NET.send({ t: 'outfit', outfit: G.save.outfit, name: G.save.name });
G.onChat = (text) => NET.send({ t: 'chat', text });
G.onJobStart = () => { UI.showHelp(false); };

// ---------------------------------------------------------------- title screen
function buildTitle() {
  $('nameInput').value = G.save.name;
  const sw = (id, key, list) => {
    const el = $(id);
    el.innerHTML = '';
    for (const c of list) {
      const d = document.createElement('div');
      d.className = 'sw' + (G.save.outfit[key] === c ? ' sel' : '');
      d.style.background = c;
      d.onclick = () => { G.save.outfit[key] = c; player.setOutfit(G.save.outfit); writeSave(); sw(id, key, list); };
      el.appendChild(d);
    }
  };
  sw('swSkin', 'skin', SKIN_TONES);
  sw('swShirt', 'shirt', COLORS);
  sw('swPants', 'pants', COLORS);
  const hairSw = () => {
    const el = $('swHair'); el.innerHTML = '';
    for (const h of HAIRS) { const d = document.createElement('div'); d.className = 'sw txt' + (G.save.outfit.hair === h.id ? ' sel' : ''); d.textContent = h.name; d.onclick = () => { G.save.outfit.hair = h.id; player.setOutfit(G.save.outfit); writeSave(); hairSw(); }; el.appendChild(d); }
    for (const c of HAIR_COLORS) { const d = document.createElement('div'); d.className = 'sw' + (G.save.outfit.hairColor === c ? ' sel' : ''); d.style.background = c; d.onclick = () => { G.save.outfit.hairColor = c; player.setOutfit(G.save.outfit); writeSave(); hairSw(); }; el.appendChild(d); }
  };
  hairSw();
  const room = new URLSearchParams(location.search).get('room');
  if (room) { $('codeInput').value = room.toUpperCase().slice(0, 5); $('titleMsg').style.color = '#2a8a3a'; $('titleMsg').textContent = 'Your friend invited you! Press Join 👉'; }
  const readName = () => {
    const n = $('nameInput').value.trim().replace(/[<>]/g, '').slice(0, 14);
    if (n) G.save.name = n;
    writeSave();
    return G.save.name;
  };
  const btns = ['btnSolo', 'btnHost', 'btnJoin'];
  // phones and tablets: go full screen and sideways when you start (Android and iPad; on iPhone use "Add to Home Screen")
  if (isTouch) for (const id of btns) $(id).addEventListener('click', goFullscreen, true);
  const busy = (b) => btns.forEach(id => $(id).disabled = b);
  $('btnSolo').onclick = () => { readName(); startGame(); };
  $('btnHost').onclick = () => {
    readName(); initAudio(); busy(true);
    $('titleMsg').style.color = '#3f6f9e'; $('titleMsg').textContent = 'Creating a room...';
    NET.hostGame((err, code) => {
      busy(false);
      if (err) { $('titleMsg').style.color = '#d24'; $('titleMsg').textContent = err; return; }
      startGame();
      UI.toast(`🌐 Room created! Code: ${code} — click "Copy invite link" at the top to invite friends.`, '', 9000);
      G.onNetJoin && G.onNetJoin();
    }, (msg) => { $('titleMsg').textContent = msg; });
  };
  $('btnJoin').onclick = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 5) { $('titleMsg').style.color = '#d24'; $('titleMsg').textContent = 'Enter the 5-letter room code.'; return; }
    readName(); initAudio(); busy(true);
    $('titleMsg').style.color = '#3f6f9e'; $('titleMsg').textContent = 'Joining room ' + code + '...';
    NET.joinGame(code, (err) => {
      busy(false);
      if (err) { $('titleMsg').style.color = '#d24'; $('titleMsg').textContent = err; return; }
      startGame();
      NET.send({ t: 'hello', name: G.save.name, outfit: G.save.outfit, did: G.save.deviceId });
      G.onNetJoin && G.onNetJoin();
      UI.toast('🌐 Joined room ' + code + '!');
    }, (msg) => { $('titleMsg').textContent = msg; });
  };
  $('btnCustom').onclick = () => $('customCard').classList.toggle('hidden');
  $('btnCustomDone').onclick = () => { readName(); $('customCard').classList.add('hidden'); };
  const GFX = { low: ['Low', 'Faster — good for Chromebooks'], high: ['High', 'Shadows and sharper image'], ultra: ['Ultra', 'Ambient occlusion + long shadows (needs a good PC)'] };
  const gfxLabel = () => { const g = GFX[G.save.gfx] || GFX.high; $('btnGfx').innerHTML = `<b>Graphics: ${g[0]}</b><small>${g[1]}</small>`; };
  $('btnGfx').onclick = () => { G.save.gfx = { low: 'high', high: 'ultra', ultra: 'low' }[G.save.gfx] || 'high'; writeSave(); applyGraphics(); gfxLabel(); };
  gfxLabel();
  $('codeInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('btnJoin').click(); });
  $('nameInput').addEventListener('keydown', (e) => e.stopPropagation());
}

G.applyGraphics = () => applyGraphics();
G.writeSave = writeSave;
function applyGraphics() {
  const high = G.save.gfx !== 'low', ultra = G.save.gfx === 'ultra';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, isTouch ? 1.25 : 1.5) : Math.min(devicePixelRatio, 1) * 0.9);
  // every setting gets sun shadows now (Low uses a small, cheap shadow map), smoothing of jagged edges and the colour grade
  setShadows(true, ultra, !high);
  setDrawDistances(G.save.gfx);
  aoPass.enabled = ultra;
  bloomPass.enabled = high;
  useGrade = true;
  gradePass.uniforms.fxaa.value = renderer.getPixelRatio() < 1.3 ? 1 : 0;
  gradePass.uniforms.res.value.set(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
  camera.far = high ? 2200 : 1500; camera.updateProjectionMatrix();
  G.fogBaseFar = high ? 1500 : 1050;
  G.landFog.far = G.fogBaseFar;
}
if (!G.save.gfx) G.save.gfx = isTouch || isChromebook ? 'low' : 'high';
applyGraphics();

function goFullscreen() {
  const d = document.documentElement, req = d.requestFullscreen || d.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try { const r = req.call(d, { navigationUI: 'hide' }); if (r && r.then) r.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); } catch (e) { /* not allowed here */ }
}
function startGame() {
  initAudio();
  document.body.classList.add('ingame');
  if (G.save.music !== false) setMusic(true);
  G.started = true;
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  player.name = G.save.name;
  player.emote = null;
  player.respawn();
  player.weapon = G.save.weapon && G.save.ownedWeapons.includes(G.save.weapon) ? G.save.weapon : null;
  G.cam.yaw = 0; G.cam.pitch = 0.35;
  updateRoomInfo();
  if (!G.save.seenHelp) { G.save.seenHelp = true; writeSave(); UI.showHelp(true); }
  UI.toast(`Welcome to Bobbly Town, ${G.save.name}! Press Tab for your phone.`);
}

// ---------------------------------------------------------------- per-frame player control
function controlPlayer(dt) {
  const p = player;
  const blocked = G.ui.panel || G.ui.help || G.ui.chatOpen || !G.started || G.rocketRide || G.arrested || G.modeFreeze || G.cableRide || G.slideRide || G.adminFreeze || G.cutscene;
  let ix = 0, iy = 0;
  if (!blocked) {
    ix = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0) + touch.mx;
    iy = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0) + touch.my;
  }
  ix = clamp(ix, -1, 1); iy = clamp(iy, -1, 1);
  const space = !blocked && (K.Space || touch.reel);
  if (p.vehicle) {
    p.ctrl.mx = p.ctrl.mz = 0;
    const v = p.vehicle;
    if (p.seat === 0 && !v.remoteDriver) {
      const shift = !!(K.ShiftLeft || K.ShiftRight), ctrl = !!(K.ControlLeft || K.ControlRight || K.KeyC);
      let inp = { throttle: iy, steer: -ix, brake: !!K.Space && !v.type.isBike, up: !!space, down: shift || (v.type.sub && !!K.KeyC), back: shift, fwd: ctrl, jump: v.type.isBike && space && !p.prevSpace };
      if (v.type.plane && !blocked) {
        // planes: arrow keys fly (↑ nose up, ↓ nose down, ←/→ bank), W/S throttle
        const ax = (K.ArrowRight ? 1 : 0) - (K.ArrowLeft ? 1 : 0) + (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0) + touch.mx;
        inp = { throttle: clamp((K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0) + (isTouch ? 0 : touch.my), -1, 1), steer: -clamp(ax, -1, 1), up: !!K.ArrowUp || !!space || (isTouch && touch.my > 0.3), down: !!K.ArrowDown || shift || (isTouch && touch.my < -0.3) };
      }
      p.prevSpace = space;
      v.drive(dt, inp);
      if (v.type.fighter && !blocked && (K.KeyF || G.mouse.fire)) fireCannon(v);
      v.hitThings((ch, imp) => NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] }));
      v.catchCargo();
    }
    setEngine(p.seat === 0 && !v.type.ride, v.speed + (v.type.heli ? v.pos.y * 0.3 : 0), v.type.heli || v.type.plane);
    return;
  }
  setEngine(false);
  const cy = G.cam.yaw;
  const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
  let mx = rx * ix + fx * iy, mz = rz * ix + fz * iy;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  p.ctrl.mx = mx; p.ctrl.mz = mz;
  p.ctrl.run = !!(K.ShiftLeft || K.ShiftRight) || (isTouch && l > 0.9);
  p.ctrl.up = !!space && !blocked;
  p.ctrl.dive = !blocked && !!(K.KeyC || K.ControlLeft || K.ControlRight);
  p.ctrl.ix = ix; p.ctrl.iy = iy;
  if (p.diving) { /* Space swims up while diving */ }
  else if (!G.ui.fishing && space && !p.prevSpace) {
    const fallH = p.root.y - groundHeight(p.root.x, p.root.z, p.root.y);
    if (p.wingsuit) {
      // wingsuit -> parachute
      p.wingsuit = false; p.ws = null; p.chute = true; p.vel.multiplyScalar(0.35); sfx.pop();
    } else if (!p.grounded && !p.chute && !p.swimming && p.vel.y < -4 && fallH > 24) {
      p.wingsuit = true; p.ws = null; sfx.whoosh();
      if (!G.seenWing) { G.seenWing = true; UI.toast('🦅 WINGSUIT! W dive faster · S flatten out · A/D turn · Space opens your parachute', '', 8000); }
    } else if (!p.grounded && !p.chute && !p.swimming && p.vel.y < -4 && fallH > 5) {
      p.chute = true; sfx.pop();
      if (!G.seenChute) { G.seenChute = true; UI.toast('🪂 Parachute open! Steer with WASD.'); }
    } else p.ctrl.jump = true;
  }
  p.prevSpace = space;
  p.ctrl.grab = !blocked && (G.mouse.grab || G.mouse.grabLock) && !p.ragdoll;
  p.ctrl.aim = (p.weapon || G.cam.fp) && !p.fishing ? G.cam.yaw + Math.PI : null;
  p.fireCd = (p.fireCd || 0) - dt;
  if (p.weapon && G.mouse.fire && !blocked && !p.ragdoll && !p.fishing && p.fireCd <= 0) {
    p.fireCd = WEAPONS[p.weapon].rate;
    const shot = fire(p, camera);
    NET.send({ t: 'shot', ...shot });
  }
  updateFishing(dt, space);
  ambience('rush', p.wingsuit && p.ws ? clamp((p.ws.v - 10) / 45, 0, 1) : p.chute ? 0.15 : 0);
}

// ---------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
function pointSolid(x, y, z) {
  for (const c of nearColliders(x, z)) {
    if (!c.off && c.tag !== 'tree' && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y > c.minY && y < c.maxY) return true;
  }
  return false;
}
let camOrbit = 0;
function updateCamera(dt) {
  if (G.camOverride) { const o = G.camOverride; camera.position.copy(o.pos); camera.lookAt(o.look); return; }   // photo / debug camera
  if (cutsceneCamera(dt, camera)) return;   // boss-battle intro movie
  if (!G.started) {
    // Home screen: your Bobbler dances on the right, the town behind them
    camOrbit += dt * 0.25;
    const P = player.root;
    const f = player.facing + Math.sin(camOrbit) * 0.25;
    camTarget.set(P.x, P.y + 1.3, P.z);
    camera.position.set(P.x + Math.sin(f) * 5.2, P.y + 1.9, P.z + Math.cos(f) * 5.2);
    camera.lookAt(camTarget);
    if (innerWidth > 700) camera.translateX(-1.9);
    return;
  }
  camera.up.set(0, 1, 0);
  const v = player.vehicle;
  // speed makes the view stretch a little
  const spd = v ? Math.abs(v.speed) : Math.hypot(player.vel.x, player.vel.z);
  const fovT = 65 + clamp((spd - 7) * 0.4, 0, v && v.type.plane ? 12 : 18);
  if (Math.abs(fovT - camera.fov) > 0.05) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
  player.head.visible = !G.cam.fp;
  // in a cockpit view the arms would cover the instruments
  const hideArms = G.cam.fp && v && v.eyes && (v.type.plane || v.type.heli || v.type.ride || v.type.sub);
  for (const k of ['armL', 'armR', 'handL', 'handR']) if (player[k]) player[k].visible = !hideArms;
  if (G.cam.fp) {
    // First person: eyes inside the head, looking where the mouse points
    const H = player.p[PARTS.HEAD];
    const cp = Math.cos(G.cam.pitch), sp = Math.sin(G.cam.pitch);
    const look = _u.set(-Math.sin(G.cam.yaw) * cp, -sp, -Math.cos(G.cam.yaw) * cp);
    if (v && player.seat === 0 && G.time - G.cam.lastMouse > 1.2 && (Math.abs(v.speed) > 2 || v.eyes)) G.cam.yaw = angleLerp(G.cam.yaw, v.yaw + Math.PI, 1 - Math.exp(-dt * 3));
    if (v && v.eyes && v.eyes[player.seat] && !G.rocketRide) {
      // sit in the seat and look out through the windscreen; the view banks and pitches with the vehicle
      const e = v.eyes[player.seat];
      v.body.updateMatrixWorld(true);
      camera.position.set(e[0], e[1], e[2]); v.body.localToWorld(camera.position);
      const a = G.cam.yaw - v.yaw;
      _w.set(-Math.sin(a) * cp, -sp, -Math.cos(a) * cp);
      v.body.getWorldQuaternion(_fpq);
      _w.applyQuaternion(_fpq);
      camera.up.set(0, 1, 0).applyQuaternion(_fpq);
      if (G.camShake) camera.position.add(_v.set((Math.random() - 0.5) * G.camShake, (Math.random() - 0.5) * G.camShake, (Math.random() - 0.5) * G.camShake));
      camera.lookAt(_v.copy(camera.position).add(_w));
      camTarget.copy(camera.position);
      return;
    }
    camera.up.set(0, 1, 0);
    camera.position.set(H.x, H.y + 0.12, H.z).addScaledVector(_w.set(look.x, 0, look.z).normalize(), G.rocketRide ? 0 : 0.25);
    if (G.camShake) camera.position.add(_w.set((Math.random() - 0.5) * G.camShake, (Math.random() - 0.5) * G.camShake, (Math.random() - 0.5) * G.camShake));
    camera.lookAt(_v.copy(camera.position).add(look));
    camTarget.copy(camera.position);
    return;
  }
  if (!v && player.wingsuit && G.time - G.cam.lastMouse > 0.8) {
    // swing round behind the wingsuit flyer
    G.cam.yaw = angleLerp(G.cam.yaw, player.facing + Math.PI, 1 - Math.exp(-dt * 2.5));
    G.cam.pitch += (0.12 - G.cam.pitch) * Math.min(1, dt * 2);
  }
  const tgt = v ? _v.copy(v.pos).add(_w.set(0, v.type.airliner ? 6 : v.type.heli || v.type.plane ? 2 : 1.4, 0)) : _v.copy(player.p[PARTS.CHE]).add(_w.set(0, 0.5, 0));
  camTarget.lerp(tgt, 1 - Math.exp(-dt * (v ? 12 : 10)));
  if (camTarget.distanceToSquared(tgt) > 400) camTarget.copy(tgt);
  let dist = G.cam.dist * (v ? (v.type.airliner ? 7.5 : v.type.plane ? 2.4 : v.type.heli ? 2.1 : v.type.truck ? 1.8 : 1.5) : (player.weapon ? 0.8 : 1));
  if (v && player.seat === 0 && G.time - G.cam.lastMouse > 1.2 && Math.abs(v.speed) > 2) {
    const behind = v.speed >= 0 ? v.yaw + Math.PI : v.yaw;
    G.cam.yaw = angleLerp(G.cam.yaw, behind, 1 - Math.exp(-dt * 2));
  }
  const cp = Math.cos(G.cam.pitch), sp = Math.sin(G.cam.pitch);
  const dir = _u.set(Math.sin(G.cam.yaw) * cp, sp, Math.cos(G.cam.yaw) * cp);
  // pull the camera in if a wall is in the way
  let d = dist;
  for (let i = 1; i <= 10; i++) {
    const t = dist * i / 10;
    if (pointSolid(camTarget.x + dir.x * t, camTarget.y + dir.y * t, camTarget.z + dir.z * t)) { d = Math.max(1.5, t - 0.6); break; }
  }
  camera.position.copy(camTarget).addScaledVector(dir, d);
  const gh = groundHeight(camera.position.x, camera.position.z, camera.position.y + 0.3);
  if (camera.position.y < gh + 0.4) camera.position.y = gh + 0.4;
  camera.lookAt(camTarget);
  if (G.camShake) camera.position.add(_w.set((Math.random() - 0.5) * G.camShake, (Math.random() - 0.5) * G.camShake, (Math.random() - 0.5) * G.camShake));
}

// ---------------------------------------------------------------- misc updates
function pushCharacters() {
  const list = G.characters;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.ragdoll || a.vehicle || a.isRemote) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.ragdoll || b.vehicle || b.isRemote) continue;
      const dx = b.root.x - a.root.x, dz = b.root.z - a.root.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.81 && d2 > 1e-6 && Math.abs(a.root.y - b.root.y) < 1.5) {
        const d = Math.sqrt(d2), push = (0.9 - d) * 0.5 / d;
        a.root.x -= dx * push; a.root.z -= dz * push;
        b.root.x += dx * push; b.root.z += dz * push;
      }
    }
  }
}

function updateNPCs(dt) {
  for (const n of G.npcs) {
    updateNPC(n, dt);
    if (n.leaveT !== undefined) {
      n.leaveT -= dt;
      if (n.leaveT <= 0 && n.root.distanceTo(player.pos) > 30) n.dead = true;
    }
  }
  const dead = G.npcs.filter(n => n.dead);
  for (const n of dead) n.destroy();
  if (dead.length) G.npcs = G.npcs.filter(n => !n.dead);
}

function updatePrompt() {
  const setPrompt = (t) => { G.promptRaw = t; UI.setPrompt(t); };
  if (!G.started || G.ui.panel || G.ui.help) { setPrompt(null); return; }
  const p = player;
  if (p.vehicle) { setPrompt(`<b>E</b> Get out`); return; }
  if (p.ragdoll) { setPrompt(p.holdRag ? 'Wheee! Release <b>R</b> to get up' : null); return; }
  const it = nearestInteract();
  if (it) { setPrompt(`<b>E</b> ${it.label()}`); return; }
  const v = nearestVehicle();
  if (v) { setPrompt(`<b>E</b> ${v.type.prompt ? v.type.prompt : (!v.remoteDriver && !v.occupants[0]) ? 'Drive' : 'Ride in'} ${v.type.prompt ? '' : v.type.emo + ' ' + v.type.name}`); return; }
  if (p.held) { setPrompt(G.mouse.grabLock ? 'Holding — <b>Click</b> to throw' : 'Release to throw'); return; }
  setPrompt(null);
}

function updateRemoteExtras() {
  for (const [, r] of G.remotes) {
    if (r.heldMesh) { r.handPoint(r.heldMesh.position); r.heldMesh.rotation.y = r.facing; }
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now(), frame = 0;
const _sunV = new THREE.Vector3();
function loop(now) {
  requestAnimationFrame(loop);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  // slow motion for huge explosions
  if (G.slowmo > 0) G.slowmo -= real;
  const dt = G.slowmo > 0 ? real * 0.28 : real;
  update(dt);
  if (G.noRender) return;
  if (useGrade) composer.render(); else renderer.render(scene, camera);
}
G.noRender = new URLSearchParams(location.search).has('norender');   // automated tests only
// run the game forward without drawing (used by automated tests)
G.step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) update(dt); };
function update(dt) {
  G.time += dt;
  frame++;

  controlPlayer(dt);
  if (G.started) updateGrab();
  updateTraffic(dt, (ch, imp) => NET.send({ t: 'hit', to: ch.netId, imp: [imp.x, imp.y, imp.z] }));
  updateSkyTraffic(dt);
  updateTrain(dt);
  updatePark(dt);
  updateDebris(dt);
  for (const v of G.vehicles) if (!(v.driver === player && player.seat === 0)) v.update(dt); else v.sync();
  bumpVehicles();
  updateNPCs(dt);
  updatePolice(dt);
  updateQuests(dt);
  for (const c of G.characters) c.update(dt);
  ADMIN.updateAdmin(dt);
  updateGadgets(dt);
  updateBattle(dt);
  updateCreatures(dt);
  updateRocket(dt);
  pushCharacters();
  for (const c of G.characters) if (!c.isRemote) kickProps(c);
  updateWeapons(dt);
  updateGunMeshes();
  updateProps(dt);
  updateTrees(dt);
  if (G.started) {
    updatePresents(dt, (pr) => {
      const hat = pick(['party', 'propeller', 'bunny', 'cowboy', 'viking', 'witch', 'tophat', 'halo', 'crown', 'chef', 'beanie', 'hardhat', 'cone'].filter(h => !G.save.ownedHats.includes(h)));
      if (hat) G.save.ownedHats.push(hat);
      import('./character.js').then(({ HATS }) => {
        const h = HATS.find(x => x.id === hat);
        UI.toast(`🎁 Present ${G.save.presents.length}/${PRESENT_SPOTS.length}! +$50${h ? ' and a free ' + h.name + '!' : ''}`, 'money', 6000);
      });
      G.save.money += 50; writeSave();
      void pr;
    });
    updateJobs(dt);
    updateModes(dt);
    updateArcade(dt);
  }
  updateRemoteExtras();
  updateWorld(dt, player.vehicle ? player.vehicle.pos : player.pos);
  updateWeather(dt);
  updateSky(dt);
  updateCamera(dt);
  updateCockpit(dt, player);
  updateOcean(dt, player);
  updateGrass();
  gradePass.uniforms.uw.value += ((G.gradeUW || 0) - gradePass.uniforms.uw.value) * Math.min(1, dt * 6);
  gradePass.uniforms.time.value = G.time;
  gradePass.uniforms.flash.value = G.flash || 0;
  { // speed blur, explosion flash, slow motion and sun rays
    const U = gradePass.uniforms, v = player.vehicle, sp = v ? Math.abs(v.speed || 0) : player.vel.length();
    U.blur.value += ((G.save.gfx === 'low' ? 0 : Math.min(0.9, Math.max(0, (sp - 28) / 45))) - U.blur.value) * Math.min(1, dt * 4);
    U.boom.value = G.boomFlash || 0;
    U.slow.value += ((G.slowmo > 0 ? 1 : 0) - U.slow.value) * Math.min(1, dt * 8);
    let rv = 0;
    if (G.save.gfx !== 'low' && !G.underwater) {
      const a = (G.dayTime - 0.25) * Math.PI * 2;
      _sunV.set(Math.cos(a) * 0.8, Math.sin(a), 0.45).normalize().multiplyScalar(500).add(camera.position).project(camera);
      if (_sunV.z < 1 && Math.abs(_sunV.x) < 1.6 && Math.abs(_sunV.y) < 1.6 && Math.sin(a) > -0.05) { U.sun.value.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5); rv = (1 - (G.overcast || 0)) * Math.min(1, Math.sin(a) * 6 + 0.3); }
    }
    U.rays.value += (rv - U.rays.value) * Math.min(1, dt * 3);
  }
  if (isTouch) updateTouch(dt, G.started ? G.promptRaw : null);
  if (G.started) {
    UI.updateHUD();
    if (frame % 2 === 0) UI.drawMinimap();
    updatePrompt();
    const locked = document.pointerLockElement === canvas;
    $('crosshair').classList.toggle('hidden', !(player.weapon || G.cam.fp) || !!player.vehicle || player.ragdoll);
    $('clickToPlay').classList.toggle('hidden', isTouch || locked || !!G.ui.panel || G.ui.help || G.ui.chatOpen);
    netTick(dt);
    if (frame % 600 === 0) writeSave();
  }
}

buildTitle();
await progress(1, 'Ready');
requestAnimationFrame(loop);
setTimeout(() => $('loading').classList.add('done'), 250);
setTimeout(() => $('loading').remove(), 1000);
window.__bobbly = G; // handy for debugging in the console
void UP;
