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
// Big explosion: fireball, flying sparks and a column of black smoke.
export function explosion(pos, size = 1) {
  sfx.boom();
  for (let i = 0; i < 18 * size; i++) puff(_v.set(pos.x + rand(-1.5, 1.5) * size, pos.y + rand(0, 2) * size, pos.z + rand(-1.5, 1.5) * size), new THREE.Vector3(rand(-6, 6), rand(2, 9), rand(-6, 6)).multiplyScalar(size), i % 3 ? '#ff8a20' : '#ffd060', rand(2, 4) * size, 3 * size, rand(0.5, 1.1), true);
  for (let i = 0; i < 14 * size; i++) puff(_v.set(pos.x + rand(-2, 2) * size, pos.y + rand(0, 3) * size, pos.z + rand(-2, 2) * size), new THREE.Vector3(rand(-2, 2), rand(3, 7), rand(-2, 2)), '#1e1e20', rand(2.5, 4) * size, 2.5 * size, rand(3, 6));
  sparks(pos, 30);
  if (G.camera && G.camera.position.distanceTo(pos) < 60 * size) G.camShake = Math.max(G.camShake || 0, 0.35 * size);
}

export function updateDebris(dt) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const d = pieces[i], o = d.o;
    d.t += dt;
    if (d.t > d.life) { G.scene.remove(o); pieces.splice(i, 1); continue; }
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
