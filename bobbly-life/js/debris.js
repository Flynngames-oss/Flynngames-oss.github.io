// Crash effects: parts that break off and tumble, flying chunks, fireballs, smoke and sparks.
import * as THREE from 'three';
import { G, rand } from './state.js';
import { groundHeight } from './world.js';
import { sfx } from './audio.js';

const pieces = [];
const puffs = [];
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _b = new THREE.Box3(), _s = new THREE.Vector3();

// Take an object off whatever it is attached to and let it fly, keeping where it is in the world.
export function detach(obj, vel, spin = null, life = 60) {
  if (!obj) return;
  G.scene.attach(obj);
  _b.setFromObject(obj); _b.getSize(_s);
  pieces.push({ o: obj, v: vel.clone(), w: spin ? spin.clone() : new THREE.Vector3(rand(-4, 4), rand(-4, 4), rand(-4, 4)), t: 0, life, r: Math.max(0.15, Math.min(_s.x, _s.y, _s.z) * 0.5), rest: false });
  while (pieces.length > 160) { const p = pieces.shift(); G.scene.remove(p.o); }
}

const BOXG = new THREE.BoxGeometry(1, 1, 1);
// A new loose chunk (panel, glass shard, bit of trim) thrown from a point.
export function chunk(material, sx, sy, sz, pos, vel, life = 25) {
  const m = new THREE.Mesh(BOXG, material);
  m.scale.set(sx, sy, sz); m.position.copy(pos);
  m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
  m.castShadow = true;
  G.scene.add(m);
  pieces.push({ o: m, v: vel.clone(), w: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), t: 0, life, r: Math.max(0.05, Math.min(sx, sy, sz) * 0.5), rest: false });
  while (pieces.length > 160) { const p = pieces.shift(); G.scene.remove(p.o); }
}

// Soft round sprite texture for fire and smoke
let puffTex = null;
function tex() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}
function puff(pos, vel, color, size, grow, life, additive = false) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(), color, transparent: true, opacity: 0.9, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true }));
  m.position.copy(pos); m.scale.setScalar(size);
  G.scene.add(m);
  puffs.push({ m, v: vel.clone(), grow, life, t: 0, o: additive ? 1 : 0.75 });
  while (puffs.length > 260) { const p = puffs.shift(); G.scene.remove(p.m); p.m.material.dispose(); }
}
const _v = new THREE.Vector3();
export function smoke(pos, amount = 1, dark = true) {
  for (let i = 0; i < amount; i++) puff(_v.set(pos.x + rand(-0.5, 0.5), pos.y + rand(0, 0.6), pos.z + rand(-0.5, 0.5)), new THREE.Vector3(rand(-0.6, 0.6), rand(1.5, 3.5), rand(-0.6, 0.6)), dark ? '#2a2a2c' : '#bfbfbf', rand(0.8, 1.6), rand(1.2, 2.2), rand(2.5, 4.5));
}
export function dust(pos, amount = 3, size = 1) {
  for (let i = 0; i < amount; i++) puff(_v.set(pos.x + rand(-1, 1) * size, pos.y + rand(0, 1), pos.z + rand(-1, 1) * size), new THREE.Vector3(rand(-3, 3), rand(0.5, 2.5), rand(-3, 3)).multiplyScalar(size), Math.random() < 0.5 ? '#b8ab94' : '#9a9080', rand(1.5, 3) * size, 1.2, rand(3, 6));
}
export function sparks(pos, n = 12) {
  for (let i = 0; i < n; i++) puff(pos, new THREE.Vector3(rand(-7, 7), rand(2, 8), rand(-7, 7)), '#ffc060', 0.18, -0.05, rand(0.3, 0.7), true);
}
export function fire(pos, n = 2, size = 1) {
  for (let i = 0; i < n; i++) puff(_v.set(pos.x + rand(-0.6, 0.6) * size, pos.y + rand(0, 0.5), pos.z + rand(-0.6, 0.6) * size), new THREE.Vector3(rand(-0.4, 0.4), rand(2, 4), rand(-0.4, 0.4)), Math.random() < 0.5 ? '#ff7a1a' : '#ffb030', rand(0.8, 1.4) * size, 0.6, rand(0.4, 0.8), true);
}
// Big explosion: a boiling fireball, a shockwave ring racing across the ground, burning debris, sparks, a tall
// column of black smoke, a scorch mark, a flash on screen and (for really big ones near you) slow motion.
const booms = [];
let fireMat = null;
function fireballMat() {
  if (fireMat) return fireMat;
  fireMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uT: { value: 0 }, uSeed: { value: 0 } },
    vertexShader: `uniform float uT, uSeed; varying float vN; varying vec3 vNrm;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + uSeed) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){ vec3 p = position; float k = n(p * 2.2 + uT * 3.0) * 0.6 + n(p * 5.0 - uT * 4.0) * 0.4; vN = k;
        vNrm = normalize(normalMatrix * normal); p *= 0.75 + k * 0.55; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform float uT; varying float vN; varying vec3 vNrm;
      void main(){ float heat = clamp(1.25 - uT * 1.4 + vN * 0.5, 0.0, 1.0);
        vec3 c = mix(vec3(0.25, 0.05, 0.02), vec3(1.0, 0.45, 0.08), smoothstep(0.1, 0.5, heat));
        c = mix(c, vec3(1.0, 0.9, 0.55), smoothstep(0.55, 0.9, heat)); c = mix(c, vec3(1.0), smoothstep(0.92, 1.0, heat));
        float rim = pow(1.0 - abs(vNrm.z), 2.0);
        float a = clamp(1.4 - uT * 1.2, 0.0, 1.0) * (0.75 + 0.25 * vN) * (1.0 - rim * 0.5);
        gl_FragColor = vec4(c * (2.2 + heat * 2.0), a); }`,
  });
  return fireMat;
}
const BALLG = new THREE.IcosahedronGeometry(1, 3), RINGG = new THREE.RingGeometry(0.85, 1, 48);
let ringMat = null, scorchMat = null;
function scorch() {
  if (scorchMat) return scorchMat;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(10,8,6,0.95)'); g.addColorStop(0.6, 'rgba(25,20,15,0.6)'); g.addColorStop(1, 'rgba(30,25,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  scorchMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  return scorchMat;
}
const burnMat = new THREE.MeshStandardMaterial({ color: '#2a2422', roughness: 0.9 });
export function explosion(pos, size = 1) {
  sfx.boom();
  const cam = G.camera ? G.camera.position.distanceTo(pos) : 1e9;
  // fireball
  const ball = new THREE.Mesh(BALLG, fireballMat().clone());
  ball.material.uniforms.uSeed.value = Math.random() * 100;
  ball.position.copy(pos); ball.scale.setScalar(0.5 * size); ball.renderOrder = 5;
  G.scene.add(ball);
  booms.push({ m: ball, t: 0, kind: 'ball', size, life: 1.3 });
  // shockwave ring along the ground
  if (!ringMat) ringMat = new THREE.MeshBasicMaterial({ color: '#fff3d0', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(RINGG, ringMat.clone());
  const gy = groundHeight(pos.x, pos.z, pos.y + 1, 0.3);
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, Math.max(gy, pos.y - 3) + 0.3, pos.z);
  G.scene.add(ring);
  booms.push({ m: ring, t: 0, kind: 'ring', size, life: 0.6 });
  if (pos.y - gy < 4) {
    const sc = new THREE.Mesh(new THREE.CircleGeometry(1, 20), scorch());
    sc.rotation.x = -Math.PI / 2; sc.position.set(pos.x, gy + 0.05, pos.z); sc.scale.setScalar(3.5 * size);
    G.scene.add(sc); booms.push({ m: sc, t: 0, kind: 'scorch', life: 40 });
    dust(_v.set(pos.x, gy, pos.z), Math.round(8 * size), 2.2 * size);
  }
  // fire, smoke and sparks
  for (let i = 0; i < 16 * size; i++) puff(_v.set(pos.x + rand(-1.5, 1.5) * size, pos.y + rand(0, 2) * size, pos.z + rand(-1.5, 1.5) * size), new THREE.Vector3(rand(-6, 6), rand(2, 9), rand(-6, 6)).multiplyScalar(size), i % 3 ? '#ff8a20' : '#ffd060', rand(2, 4) * size, 3 * size, rand(0.5, 1.1), true);
  for (let i = 0; i < 18 * size; i++) puff(_v.set(pos.x + rand(-2, 2) * size, pos.y + rand(0, 3) * size, pos.z + rand(-2, 2) * size), new THREE.Vector3(rand(-2, 2), rand(4, 9), rand(-2, 2)), i % 2 ? '#1e1e20' : '#3a3634', rand(2.5, 4.5) * size, 2.2 * size, rand(4, 8));
  sparks(pos, Math.round(30 * size));
  // burning debris
  for (let i = 0; i < Math.round(6 * size); i++) {
    const v = new THREE.Vector3(rand(-14, 14), rand(8, 22), rand(-14, 14)).multiplyScalar(Math.sqrt(size));
    chunk(burnMat, rand(0.3, 0.9), rand(0.2, 0.6), rand(0.3, 0.9), pos, v, 12);
    pieces[pieces.length - 1].burn = 1.6;
  }
  // screen flash, shake and slow motion
  if (cam < 90 * size) {
    const k = Math.max(0, 1 - cam / (90 * size));
    G.boomFlash = Math.max(G.boomFlash || 0, 0.9 * k);
    G.camShake = Math.max(G.camShake || 0, 0.55 * size * k + 0.15);
    if (size >= 1.5 && cam < 70 * size && !(G.slowmo > 0) && performance.now() - (G.lastSlowmo || 0) > 8000) { G.slowmo = 1.4; G.lastSlowmo = performance.now(); }
  }
}
function updateBooms(dt) {
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i];
    b.t += dt;
    if (b.t > b.life) { G.scene.remove(b.m); if (b.kind !== 'scorch') b.m.material.dispose(); booms.splice(i, 1); continue; }
    const f = b.t / b.life;
    if (b.kind === 'ball') { b.m.material.uniforms.uT.value = f; b.m.scale.setScalar(b.size * (1.5 + 5.5 * Math.pow(f, 0.4))); b.m.position.y += dt * 3 * b.size; }
    else if (b.kind === 'ring') { b.m.scale.setScalar(b.size * (2 + 26 * Math.pow(f, 0.6))); b.m.material.opacity = 0.8 * (1 - f); }
    else if (b.kind === 'scorch' && f > 0.85) b.m.scale.multiplyScalar(1 - dt * 0.6);
  }
  if (G.boomFlash) G.boomFlash = Math.max(0, G.boomFlash - dt * 2.5);
}

export function updateDebris(dt) {
  updateBooms(dt);
  for (let i = pieces.length - 1; i >= 0; i--) {
    const d = pieces[i], o = d.o;
    d.t += dt;
    if (d.t > d.life) { G.scene.remove(o); pieces.splice(i, 1); continue; }
    if (d.burn > 0) { d.burn -= dt; if (Math.random() < 0.5) fire(o.position, 1, 0.5); }
    if (d.rest) continue;
    d.v.y -= 24 * dt;
    o.position.addScaledVector(d.v, dt);
    _q.setFromEuler(_e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt));
    o.quaternion.premultiply(_q);
    const gh = groundHeight(o.position.x, o.position.z, o.position.y + 1, 0.1);
    if (o.position.y - d.r < gh) {
      o.position.y = gh + d.r;
      if (d.v.y < -2) { d.v.y = -d.v.y * 0.32; if (d.r > 0.5 && G.camera && G.camera.position.distanceToSquared(o.position) < 900) sfx.crash(); }
      else d.v.y = 0;
      d.v.x *= 0.72; d.v.z *= 0.72; d.w.multiplyScalar(0.7);
      if (d.v.lengthSq() < 0.05 && d.w.lengthSq() < 0.05) d.rest = true;
    }
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.t += dt;
    if (p.t > p.life) { G.scene.remove(p.m); p.m.material.dispose(); puffs.splice(i, 1); continue; }
    p.m.position.addScaledVector(p.v, dt);
    p.v.multiplyScalar(1 - Math.min(1, dt * 1.2));
    p.m.scale.multiplyScalar(1 + p.grow * dt);
    p.m.material.opacity = p.o * (1 - p.t / p.life);
  }
  if (G.camShake) G.camShake = Math.max(0, G.camShake - dt * 0.8);
}
