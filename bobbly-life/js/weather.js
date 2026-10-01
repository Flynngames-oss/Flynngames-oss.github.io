// Weather: sunny spells, clouds, rain, thunderstorms with lightning, wet slippery roads and tornadoes.
// The host (or the solo player) decides the weather; everyone in the room sees the same sky.
import * as THREE from 'three';
import { G, clamp, lerp, rand, pick, WATER_Y } from './state.js';
import { heightAt, WORLD } from './terrain.js';
import { getLights, groundHeight } from './world.js';
import { sfx, ambience, thunder } from './audio.js';
import { sparks, smoke } from './debris.js';

const W = { state: 'clear', t: rand(120, 220), rain: 0, overcast: 0, wet: 0, storm: 0, tornado: null, boltT: 6, forced: false };
G.weather = W;
const TARGET = { clear: [0, 0, 0], cloudy: [0.55, 0, 0], rain: [0.82, 0.65, 0], storm: [1, 1, 1] };
const NAMES = { clear: '☀️ Clear', cloudy: '☁️ Cloudy', rain: '🌧️ Rain', storm: '⛈️ Thunderstorm' };
let rain, deck, bolt = null, hud = null;
const cloudMats = new Set();

// ---------------------------------------------------------------- rain (all on the GPU: the drops wrap around the camera)
function buildRain() {
  const n = 9000, pos = new Float32Array(n * 6), end = new Float32Array(n * 2), seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 70, y = Math.random() * 40, z = Math.random() * 70, s = Math.random();
    for (let k = 0; k < 2; k++) { pos.set([x, y, z], i * 6 + k * 3); end[i * 2 + k] = k; seed[i * 2 + k] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRain: { value: 0 }, uWind: { value: new THREE.Vector2(3, 1.2) }, uCol: { value: new THREE.Color('#c8d4e0') } },
    vertexShader: `uniform vec3 uCam; uniform float uTime, uRain; uniform vec2 uWind; attribute float aEnd, aSeed; varying float vA;
      void main(){
        vec3 p = position;
        float sp = 26.0 + aSeed * 10.0;
        float y = mod(p.y - uTime * sp, 40.0);
        vec3 w = vec3(mod(p.x - uCam.x + uWind.x * y * 0.1, 70.0) - 35.0, y - 18.0, mod(p.z - uCam.z + uWind.y * y * 0.1, 70.0) - 35.0) + uCam;
        w += aEnd * vec3(uWind.x * 0.035, 0.75 + aSeed * 0.4, uWind.y * 0.035);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        vA = step(aSeed, uRain) * (1.0 - smoothstep(14.0, 34.0, -mv.z)) * (1.0 - aEnd * 0.75);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uCol, vA * 0.5); }`,
    transparent: true, depthWrite: false,
  });
  rain = new THREE.LineSegments(g, m);
  rain.frustumCulled = false; rain.visible = false;
  G.scene.add(rain);
}
// a low, dark cloud deck that rolls over during storms
function buildDeck() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 420; i++) {
    const px = Math.random() * 256, py = Math.random() * 256, r = 10 + Math.random() * 38;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const v = 150 + Math.random() * 70;
    g.addColorStop(0, `rgba(${v},${v},${v + 8},0.22)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { x.save(); x.translate(ox, oy); x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); x.restore(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.colorSpace = THREE.SRGBColorSpace;
  deck = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshBasicMaterial({ map: t, color: '#8a9098', transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  deck.rotation.x = -Math.PI / 2; deck.position.y = 240; deck.visible = false; deck.renderOrder = -1;
  G.scene.add(deck);
}

// ---------------------------------------------------------------- lightning
const boltMat = new THREE.MeshBasicMaterial({ color: '#f4f6ff', toneMapped: false, transparent: true, opacity: 1, fog: false });
function strike(near) {
  const P = G.player.root;
  let x, z;
  if (near) { const a = rand(0, 6.28), d = rand(12, 40); x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d; }
  else { const a = rand(0, 6.28), d = rand(120, 700); x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d; }
  x = clamp(x, -WORLD + 20, WORLD - 20); z = clamp(z, -WORLD + 20, WORLD - 20);
  const gy = Math.max(heightAt(x, z), WATER_Y);
  const top = gy + 230;
  // jagged main channel plus a couple of forks
  const pts = [new THREE.Vector3(x + rand(-40, 40), top, z + rand(-40, 40))];
  const seg = 16;
  for (let i = 1; i <= seg; i++) {
    const k = i / seg;
    pts.push(new THREE.Vector3(lerp(pts[0].x, x, k) + rand(-9, 9) * (1 - k * 0.8), lerp(top, gy, k), lerp(pts[0].z, z, k) + rand(-9, 9) * (1 - k * 0.8)));
  }
  const group = new THREE.Group();
  const tube = (list, r) => { const c = new THREE.CatmullRomCurve3(list, false, 'catmullrom', 0.1); group.add(new THREE.Mesh(new THREE.TubeGeometry(c, list.length * 3, r, 4, false), boltMat)); };
  tube(pts, 0.7);
  for (let f = 0; f < 3; f++) {
    const s = 3 + Math.floor(Math.random() * 8), fork = [pts[s].clone()];
    for (let i = 1; i < 5; i++) fork.push(fork[i - 1].clone().add(new THREE.Vector3(rand(-12, 12), -rand(8, 16), rand(-12, 12))));
    tube(fork, 0.35);
  }
  G.scene.add(group);
  if (bolt) { G.scene.remove(bolt.g); bolt.g.traverse(o => o.geometry && o.geometry.dispose()); }
  bolt = { g: group, t: 0.32 };
  G.flash = 1;
  const d = Math.hypot(x - G.camera.position.x, z - G.camera.position.z);
  thunder(d);
  if (d < 120) sparks(new THREE.Vector3(x, gy + 0.5, z), 30);
  // anyone standing right there gets knocked flat
  for (const ch of G.characters) {
    if (ch.isRemote || ch.vehicle) continue;
    if (Math.hypot(ch.root.x - x, ch.root.z - z) < 6) { ch.flop(new THREE.Vector3(rand(-4, 4), 9, rand(-4, 4)), 2.5); if (ch.isPlayer) G.toast && G.toast('⚡ ZAP! Lightning struck right next to you!', 'bad'); }
  }
}

// ---------------------------------------------------------------- tornado
function buildFunnelTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  for (let i = 0; i < 600; i++) {
    const px = Math.random() * 256, py = Math.random() * 256, w = 20 + Math.random() * 60, h = 2 + Math.random() * 6;
    const v = 80 + Math.random() * 90;
    x.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.08 + Math.random() * 0.2})`;
    for (const ox of [-256, 0, 256]) { x.beginPath(); x.ellipse(px + ox, py, w, h, 0, 0, 7); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function makeTornado(x, z, ang, life) {
  const g = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 24; i++) { const k = i / 24; prof.push(new THREE.Vector2(6 + Math.pow(k, 1.9) * 62 + Math.sin(k * 9) * 1.5 + (k < 0.06 ? (0.06 - k) * 140 : 0), k * 210)); }
  const layers = [];
  for (let l = 0; l < 3; l++) {
    const tex = buildFunnelTexture(); tex.repeat.set(2 + l, 3);
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), new THREE.MeshBasicMaterial({ map: tex, color: l ? '#8c8478' : '#6e675e', transparent: true, opacity: 0.75 - l * 0.15, side: THREE.DoubleSide, depthWrite: false }));
    m.scale.setScalar(1 + l * 0.12);
    g.add(m); layers.push(m);
  }
  // swirling debris at the base
  const deb = [];
  const dm = [new THREE.MeshLambertMaterial({ color: '#5a4a3a' }), new THREE.MeshLambertMaterial({ color: '#6b6b6b' }), new THREE.MeshLambertMaterial({ color: '#4a5a3a' })];
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(rand(0.2, 1.2), rand(0.1, 0.6), rand(0.2, 1)), pick(dm));
    g.add(m); deb.push({ m, a: rand(0, 6.28), r: rand(4, 18), h: rand(0, 40), w: rand(1.5, 3.5) });
  }
  const dust = new THREE.Mesh(new THREE.CylinderGeometry(22, 30, 10, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#7a6e60', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  dust.position.y = 4; g.add(dust);
  g.position.set(x, Math.max(heightAt(x, z), WATER_Y), z);
  G.scene.add(g);
  return { g, layers, deb, dust, x, z, vx: Math.sin(ang) * 7, vz: Math.cos(ang) * 7, life, max: life, wander: rand(0, 6.28), caught: new Set() };
}
function spawnTornado() {
  const P = G.player.root;
  const a = rand(0, 6.28), d = rand(260, 420);
  let x = clamp(P.x + Math.cos(a) * d, -WORLD + 150, WORLD - 150), z = clamp(P.z + Math.sin(a) * d, -WORLD + 150, WORLD - 150);
  const ang = Math.atan2(P.x - x, P.z - z) + rand(-0.5, 0.5);
  W.tornado = makeTornado(x, z, ang, rand(75, 110));
  G.toast && G.toast('🌪️ TORNADO WARNING! A tornado is touching down — get somewhere safe!', 'bad', 8000);
  sfx.bad();
}
function endTornado() {
  const T = W.tornado; if (!T) return;
  G.scene.remove(T.g);
  for (const v of G.vehicles) if (v.twister) releaseVehicle(v, 0.5);
  W.tornado = null;
}
const _v = new THREE.Vector3();
function releaseVehicle(v, k = 1) {
  const tw = v.twister; v.twister = null;
  const tang = tw.ang + Math.PI / 2;
  v.tumbling = true; v.onGround = false; v.flipped = false;
  v.moveYaw = Math.atan2(Math.cos(tang), Math.sin(tang));
  v.speed = 18 * k; v.vy = 5 * k;
  v.rollV = rand(-4, 4); v.pitchV = rand(-2, 2); v.yawV = rand(-3, 3);
  if (v.occupants.some(Boolean)) v.ejectAll(14 * k);
}
function updateTornado(dt) {
  const T = W.tornado;
  if (!T) { ambience('tornado', 0); return; }
  T.life -= dt;
  T.wander += rand(-0.6, 0.6) * dt;
  // drifts across the island, weaving a little
  T.vx += Math.sin(T.wander) * dt * 0.8; T.vz += Math.cos(T.wander) * dt * 0.8;
  const sp = Math.hypot(T.vx, T.vz); if (sp > 9) { T.vx *= 9 / sp; T.vz *= 9 / sp; }
  T.x += T.vx * dt; T.z += T.vz * dt;
  if (Math.abs(T.x) > WORLD - 60 || Math.abs(T.z) > WORLD - 60) { T.vx = -T.vx; T.vz = -T.vz; }
  const gy = Math.max(heightAt(T.x, T.z), WATER_Y);
  T.g.position.set(T.x, gy, T.z);
  const grow = clamp((T.max - T.life) / 6, 0, 1) * clamp(T.life / 6, 0, 1);
  T.g.scale.set(grow, 1, grow);
  T.layers.forEach((m, i) => { m.rotation.y -= dt * (2.2 + i * 0.7); m.material.map.offset.y += dt * (0.25 + i * 0.1); });
  T.dust.rotation.y -= dt * 3; T.dust.material.opacity = 0.35 * grow;
  for (const d of T.deb) {
    d.a += d.w * dt * 1.6; d.h += dt * 6; if (d.h > 60) d.h = 0;
    const r = d.r * (1 + d.h / 40);
    d.m.position.set(Math.cos(d.a) * r, d.h, Math.sin(d.a) * r);
    d.m.rotation.x += dt * 5; d.m.rotation.y += dt * 4;
  }
  if (Math.random() < dt * 8) smoke(new THREE.Vector3(T.x + rand(-15, 15), gy + 1, T.z + rand(-15, 15)), 1, true);
  const dist = Math.hypot(G.camera.position.x - T.x, G.camera.position.z - T.z);
  ambience('tornado', clamp(1 - dist / 450, 0, 1) * grow);
  if (grow > 0.3) {
    const R = 32 * grow;
    // vehicles get picked up, spun round and thrown out
    for (const v of G.vehicles) {
      if (v.remoteDriver || v.type.rail || v.type.ride || v.type.airliner || v.display || v.type.boat || v.type.sub) continue;
      const dx = v.pos.x - T.x, dz = v.pos.z - T.z, d = Math.hypot(dx, dz);
      if (!v.twister) {
        if (d < R && v.pos.y - gy < 30 && !T.caught.has(v)) {
          v.twister = { ang: Math.atan2(dz, dx), rad: d, h: v.pos.y - gy, t: rand(2.5, 5.5), spin: rand(2, 5) };
          T.caught.add(v);
          if (v.driver && v.driver.isPlayer) G.toast && G.toast('🌪️ WHOAAA! The tornado picked you up!', 'bad');
        }
        continue;
      }
      const tw = v.twister;
      tw.t -= dt;
      tw.ang += dt * (14 / Math.max(6, tw.rad));
      tw.rad = lerp(tw.rad, 9, dt * 0.8);
      tw.h = Math.min(tw.h + dt * 9, 55);
      v.pos.set(T.x + Math.cos(tw.ang) * tw.rad, gy + tw.h, T.z + Math.sin(tw.ang) * tw.rad);
      v.yaw += dt * tw.spin; v.roll += dt * tw.spin * 0.7; v.pitch += dt * tw.spin * 0.4;
      v.speed = 0; v.vy = 0;
      if (tw.t <= 0) releaseVehicle(v);
    }
    // people and loose things get sucked up and flung
    for (const ch of G.characters) {
      if (ch.isRemote || ch.vehicle) continue;
      const P = ch.ragdoll ? ch.p[0] : ch.root;
      const dx = P.x - T.x, dz = P.z - T.z, d = Math.hypot(dx, dz);
      if (d > R * 0.8 || P.y - gy > 70) continue;
      const k = 1 - d / (R * 0.8);
      if (!ch.ragdoll) ch.flop(_v.set(-dz / d * 10, 8, dx / d * 10), 3);
      ch.ragMin = Math.max(ch.ragMin, ch.ragT + 1);
      const h = Math.min(dt, 1 / 30);
      const tx = (-dz / (d || 1)) * 20 * k - dx / (d || 1) * 6 * k, tz = (dx / (d || 1)) * 20 * k - dz / (d || 1) * 6 * k, ty = (P.y - gy < 40 ? 14 : 2) * k;
      for (let i = 0; i < 7; i++) {
        const p = ch.p[i], pr = ch.prev[i];
        const vx = p.x - pr.x, vy = p.y - pr.y, vz = p.z - pr.z;
        pr.set(p.x - lerp(vx, tx * h, dt * 3), p.y - lerp(vy, ty * h, dt * 3), p.z - lerp(vz, tz * h, dt * 3));
      }
      if (ch.isPlayer && !ch.twistMsg) { ch.twistMsg = true; G.toast && G.toast('🌪️ You got sucked into the tornado!!', 'bad'); setTimeout(() => { ch.twistMsg = false; }, 8000); }
    }
    for (const pr of G.props) {
      if (pr.held || pr.inVehicle) continue;
      const dx = pr.pos.x - T.x, dz = pr.pos.z - T.z, d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = 1 - d / R;
      pr.vel.x = lerp(pr.vel.x, -dz / d * 20 * k, dt * 3); pr.vel.z = lerp(pr.vel.z, dx / d * 20 * k, dt * 3); pr.vel.y = lerp(pr.vel.y, 10 * k, dt * 3);
      pr.cargoOf = null;
    }
  }
  if (T.life <= 0) endTornado();
}
export function twisterUpdate(v) { return !!v.twister; }

// ---------------------------------------------------------------- the weather clock
function nextState() {
  const s = W.state;
  if (s === 'clear') return ['cloudy', rand(40, 80)];
  if (s === 'cloudy') return Math.random() < 0.7 ? ['rain', rand(80, 150)] : ['clear', rand(150, 300)];
  if (s === 'rain') return Math.random() < 0.55 ? ['storm', rand(70, 120)] : ['cloudy', rand(40, 70)];
  return ['rain', rand(40, 70)];
}
export function setWeather(state, fromNet = false) {
  if (!TARGET[state]) return;
  W.state = state; W.t = state === 'clear' ? rand(150, 300) : rand(80, 140);
  if (!fromNet) W.forced = true;
  if (state !== 'storm' && W.tornado && !fromNet) endTornado();
  if (!fromNet && G.onWeather) G.onWeather();
}
export function forceTornado() {
  if (W.state !== 'storm') setWeather('storm');
  if (!W.tornado) spawnTornado();
  G.onWeather && G.onWeather();
}
export function weatherNet() {
  const T = W.tornado;
  return { s: W.state, t: Math.round(W.t), tor: T ? [Math.round(T.x), Math.round(T.z), +T.vx.toFixed(2), +T.vz.toFixed(2), Math.round(T.life), Math.round(T.max)] : 0 };
}
export function applyWeatherNet(m) {
  if (!m) return;
  if (TARGET[m.s]) { W.state = m.s; W.t = m.t; }
  if (m.tor && !W.tornado) { W.tornado = makeTornado(m.tor[0], m.tor[1], 0, m.tor[4]); W.tornado.max = m.tor[5]; G.toast && G.toast('🌪️ TORNADO WARNING! Get somewhere safe!', 'bad', 8000); }
  if (m.tor && W.tornado) { const T = W.tornado; T.x = lerp(T.x, m.tor[0], 0.5); T.z = lerp(T.z, m.tor[1], 0.5); T.vx = m.tor[2]; T.vz = m.tor[3]; T.life = m.tor[4]; }
  if (!m.tor && W.tornado) endTornado();
}

function hudEl() {
  if (hud) return hud;
  hud = document.createElement('div'); hud.id = 'weatherHud';
  document.getElementById('hud').appendChild(hud);
  return hud;
}
export function initWeather() {
  buildRain();
  buildDeck();
  for (const c of G.clouds || []) for (const s of c.children) if (s.material) cloudMats.add(s.material);
}

const grey = new THREE.Color('#737c86'), tmp = new THREE.Color();
export function updateWeather(dt) {
  const host = G.net.mode !== 'client';
  // the weather clock (the host runs it; clients follow the host)
  W.t -= dt;
  if (host && W.t <= 0) {
    const [s, t] = nextState(); W.state = s; W.t = t; W.forced = false;
    if (s === 'storm') G.toast && G.toast('⛈️ A thunderstorm is rolling in...', '', 5000);
    if (s === 'rain') G.toast && G.toast('🌧️ It\'s starting to rain. Roads get slippery!', '', 5000);
    if (G.onWeather) G.onWeather();
  }
  const [oT, rT, sT] = TARGET[W.state];
  W.overcast += clamp(oT - W.overcast, -dt / 18, dt / 18);
  W.rain += clamp(rT - W.rain, -dt / 14, dt / 14);
  W.storm += clamp(sT - W.storm, -dt / 12, dt / 12);
  W.wet = clamp(W.wet + (W.rain > 0.1 ? dt * W.rain / 25 : -dt / 100), 0, 1);
  G.overcast = W.overcast; G.wet = W.wet;
  // storms: lightning, and sometimes a tornado
  if (W.storm > 0.6 && !G.underwater) {
    W.boltT -= dt;
    if (W.boltT <= 0) { W.boltT = rand(3, 11); strike(Math.random() < 0.06); }
  }
  if (host && W.state === 'storm' && W.storm > 0.9 && !W.tornado && !W.tornadoDone && Math.random() < dt / 40) { spawnTornado(); W.tornadoDone = true; G.onWeather && G.onWeather(); }
  if (W.state !== 'storm') W.tornadoDone = false;
  updateTornado(dt);
  if (bolt) {
    bolt.t -= dt;
    boltMat.opacity = bolt.t > 0.2 ? 1 : Math.random() < 0.5 ? 1 : 0.2;
    if (bolt.t <= 0) { G.scene.remove(bolt.g); bolt.g.traverse(o => o.geometry && o.geometry.dispose()); bolt = null; }
  }
  G.flash = Math.max(0, (G.flash || 0) - dt * 4.5);
  // sky, light and fog
  const L = getLights(), oc = W.overcast;
  const space = G.spaceFade || 0;
  if (oc > 0.001 && !G.underwater) {
    L.sun.intensity *= 1 - 0.78 * oc;
    L.hemi.intensity *= 1 - 0.3 * oc;
    const dayK = clamp(L.hemi.intensity / 0.65, 0.15, 1);
    tmp.copy(grey).multiplyScalar(dayK);
    G.landFog.color.lerp(tmp, oc * 0.75 * (1 - space));
    if (G.scene.background && G.scene.background.isColor) G.scene.background.lerp(tmp, oc * 0.75 * (1 - space));
    if (G.sky) { const u = G.sky.material.uniforms; u.horizon.value.lerp(tmp, oc * 0.8 * (1 - space)); u.top.value.lerp(tmp.multiplyScalar(0.8), oc * 0.85 * (1 - space)); }
    if (space < 0.01) G.landFog.far = (G.fogBaseFar || 1500) * lerp(1, 0.3, W.rain * 0.8 + W.storm * 0.2);
  } else if (space < 0.01 && G.fogBaseFar) G.landFog.far = G.fogBaseFar;
  if (L.hemi && G.flash > 0) { L.hemi.intensity += G.flash * 2.2; L.amb.intensity = 0.12 + G.flash * 1.2; } else if (L.amb) L.amb.intensity = 0.12;
  for (const m of cloudMats) m.color.multiplyScalar(1 - 0.6 * oc);
  if (deck) {
    deck.visible = oc > 0.05 && space < 0.3;
    deck.material.opacity = clamp((oc - 0.3) * 1.4, 0, 0.95);
    deck.material.color.setScalar(clamp(L.hemi.intensity * 0.9, 0.18, 0.6) + 0.1);
    deck.position.x = G.camera.position.x; deck.position.z = G.camera.position.z;
    deck.material.map.offset.x += dt * 0.003 * (1 + W.storm * 2); deck.material.map.offset.y += dt * 0.0015;
  }
  // rain
  if (rain) {
    const show = W.rain > 0.02 && !G.underwater && space < 0.1;
    rain.visible = show;
    if (show) {
      const u = rain.material.uniforms;
      u.uCam.value.copy(G.camera.position); u.uTime.value = G.time; u.uRain.value = W.rain;
      u.uWind.value.set(3 + W.storm * 6, 1.2 + W.storm * 3);
      u.uCol.value.setScalar(0.45 + clamp(L.hemi.intensity, 0, 1) * 0.4);
    }
  }
  // wet roads look darker
  for (const m of G.roadMats || []) m.color.setScalar(1 - 0.38 * W.wet);
  if (G.terrainMat) G.terrainMat.color.setScalar(1 - 0.18 * W.wet);
  ambience('rain', G.underwater ? 0 : W.rain);
  ambience('wind', G.underwater ? 0 : W.overcast * 0.15 + W.storm * 0.35);
  // little weather badge under the money
  const el = hudEl();
  const txt = (W.tornado ? '🌪️ TORNADO! · ' : '') + NAMES[W.state] + (W.wet > 0.3 ? ' · wet roads' : '');
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle('alert', !!W.tornado);
}
export { NAMES as WEATHER_NAMES };
