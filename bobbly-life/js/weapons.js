// Toy blasters: water, foam darts, paintballs and a confetti rocket. Hits make people flop.
import * as THREE from 'three';
import { G, mat, rand, pick } from './state.js';
import { groundHeight, nearColliders } from './world.js';
import { PARTS } from './character.js';
import { sfx } from './audio.js';

export const WEAPONS = {
  water:  { name: 'Water Blaster', emo: '💦', price: 100, rate: 0.05, speed: 26, grav: 14, size: 0.16, push: 3, dmg: 0.12, color: '#7fd0ff', fire: true, desc: 'Soak people! Also puts out fires.' },
  foam:   { name: 'Foam Dart Blaster', emo: '🔫', price: 150, rate: 0.3, speed: 48, grav: 3, size: 0.12, push: 10, dmg: 1, color: '#ff8a3d', desc: 'One dart = one flop.' },
  paint:  { name: 'Paintball Gun', emo: '🎨', price: 350, rate: 0.11, speed: 52, grav: 4, size: 0.13, push: 5, dmg: 0.34, paint: true, desc: 'Rapid fire, splats paint everywhere.' },
  rocket: { name: 'Confetti Rocket', emo: '🚀', price: 1200, rate: 1.1, speed: 32, grav: 0, size: 0.3, push: 16, dmg: 1, explode: 7, color: '#ffd54a', desc: 'BOOM! Launches people, props and cars.' },
};
const PAINT = ['#ff5b6e', '#3fa7ff', '#46c25a', '#ffd54a', '#b46cff', '#ff8a3d'];

// ---------------------------------------------------------------- gun meshes
export function buildGunMesh(id) {
  const g = new THREE.Group();
  const add = (color, x, y, z, sx, sy, sz, geo = new THREE.BoxGeometry(1, 1, 1), opts) => {
    const m = new THREE.Mesh(geo, mat(color, opts)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m;
  };
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  if (id === 'water') {
    add('#3fa7ff', 0, 0.05, 0.2, 0.18, 0.2, 0.6);
    add('#ffd54a', 0, 0.22, 0.1, 0.2, 0.2, 0.2, new THREE.SphereGeometry(1, 10, 8));
    add('#ff8a3d', 0, 0.05, 0.55, 0.05, 0.05, 0.2, cyl).rotation.x = Math.PI / 2;
    add('#ff5b6e', 0, -0.12, 0.05, 0.1, 0.25, 0.1);
  } else if (id === 'foam') {
    add('#ff8a3d', 0, 0.05, 0.2, 0.14, 0.18, 0.55);
    add('#ffd54a', 0, 0.05, 0.55, 0.06, 0.06, 0.25, cyl).rotation.x = Math.PI / 2;
    add('#3fa7ff', 0, -0.12, 0.02, 0.1, 0.25, 0.12);
  } else if (id === 'paint') {
    add('#4a4f5a', 0, 0.05, 0.25, 0.14, 0.16, 0.7);
    add('#b46cff', 0, 0.22, 0.2, 0.16, 0.16, 0.16, new THREE.SphereGeometry(1, 10, 8));
    add('#4a4f5a', 0, -0.12, 0.05, 0.1, 0.25, 0.1);
  } else if (id === 'rocket') {
    add('#46a05a', 0, 0.12, 0.1, 0.16, 1.1, 0.16, cyl).rotation.x = Math.PI / 2;
    add('#ff5b6e', 0, 0.12, 0.7, 0.12, 0.25, 0.12, new THREE.ConeGeometry(1, 1, 10)).rotation.x = Math.PI / 2;
    add('#4a4f5a', 0, -0.08, 0.05, 0.08, 0.25, 0.1);
  }
  return g;
}

// Show guns in the hands of anyone (player, remotes) who has one equipped.
export function updateGunMeshes() {
  for (const ch of G.characters) {
    const want = ch.weapon && !ch.vehicle && !ch.ragdoll ? ch.weapon : null;
    if (ch.gunId !== want) {
      if (ch.gunMesh) G.scene.remove(ch.gunMesh);
      ch.gunMesh = want ? buildGunMesh(want) : null;
      if (ch.gunMesh) G.scene.add(ch.gunMesh);
      ch.gunId = want;
    }
    if (ch.gunMesh) {
      ch.gunMesh.position.copy(ch.p[PARTS.HR]);
      ch.gunMesh.rotation.set(ch.isPlayer ? -G.cam.pitch * 0.5 + 0.1 : 0, ch.facing, 0, 'YXZ');
    }
  }
}

// ---------------------------------------------------------------- projectiles
const shots = [];
const decals = [];
const shotGeo = new THREE.SphereGeometry(1, 8, 6);
const _d = new THREE.Vector3(), _o = new THREE.Vector3(), _t = new THREE.Vector3();

function solid(p) {
  for (const c of nearColliders(p.x, p.z)) {
    if (!c.off && p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) return true;
  }
  return false;
}

export function spawnShot(type, pos, vel, visual, color) {
  const w = WEAPONS[type];
  const col = color || (w.paint ? pick(PAINT) : w.color);
  let mesh;
  if (type === 'rocket') {
    mesh = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8), mat('#ff5b6e'));
    b.rotation.x = Math.PI / 2; mesh.add(b);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), mat('#ffb21a', { emissive: '#ff8800', emissiveIntensity: 1 }));
    f.position.z = -0.5; mesh.add(f);
  } else {
    mesh = new THREE.Mesh(shotGeo, type === 'water' ? mat(col, { transparent: true, opacity: 0.75 }) : mat(col));
    mesh.scale.setScalar(w.size);
  }
  mesh.position.copy(pos);
  G.scene.add(mesh);
  shots.push({ type, w, pos: mesh.position, vel: vel.clone(), mesh, life: type === 'rocket' ? 4 : 2, visual, color: col });
}

// Local player fires. Returns shot info for networking.
export function fire(player, camera) {
  const w = WEAPONS[player.weapon];
  camera.getWorldDirection(_d);
  if (player.weapon !== 'rocket') { _d.x += rand(-0.02, 0.02); _d.y += rand(-0.02, 0.02) + (w.grav > 5 ? 0.06 : 0.01); _d.z += rand(-0.02, 0.02); }
  _d.normalize();
  _o.copy(player.p[PARTS.HR]).addScaledVector(_d, 0.7);
  _o.y += 0.1;
  const vel = _d.clone().multiplyScalar(w.speed);
  vel.x += player.vel.x; vel.z += player.vel.z;
  spawnShot(player.weapon, _o, vel, false);
  const last = shots[shots.length - 1];
  if (player.weapon === 'rocket') sfx.whoosh(); else if (player.weapon === 'water') { if (Math.random() < 0.3) sfx.water(); } else if (player.weapon === 'paint') sfx.pop2(); else sfx.pew();
  // recoil wobble
  player.v[PARTS.HR].addScaledVector(_d, -3);
  player.v[PARTS.HEAD].addScaledVector(_d, -1);
  return { w: player.weapon, p: [_o.x, _o.y, _o.z].map(r2), v: [vel.x, vel.y, vel.z].map(r2), c: last.color };
}
const r2 = (x) => Math.round(x * 100) / 100;

// Apply a blaster hit to a character we simulate (npc or our own player).
export function applyHit(ch, dir, w) {
  if (ch.vehicle) return;
  ch.soak = (ch.soak || 0) + w.dmg;
  _t.copy(dir).setY(0).normalize().multiplyScalar(w.push);
  _t.y = w.push * 0.35 + 1;
  if (ch.ragdoll) { for (const p of ch.prev) p.addScaledVector(_t, -1 / 60 * 0.4); return; }
  if (ch.soak >= 1) { ch.soak = 0; ch.flop(_t, 2); }
  else { ch.vel.x += _t.x * 0.25; ch.vel.z += _t.z * 0.25; for (const v of ch.v) v.addScaledVector(dir, w.push * 0.4); }
}

function explode(pos, visual) {
  boomFx(pos, true);
  if (visual) return;
  const R = 7;
  for (const ch of G.characters) {
    const p = ch.p[PARTS.PEL];
    const d = p.distanceTo(pos);
    if (d > R) continue;
    const k = (1 - d / R);
    _t.subVectors(p, pos).setY(0).normalize().multiplyScalar(18 * k); _t.y = 8 + 10 * k;
    if (ch.isRemote) G.onRemoteHit && G.onRemoteHit(ch, _t);
    else if (ch.vehicle) { if (ch.vehicle.driver === ch && !ch.vehicle.type.heli && !ch.vehicle.type.plane) { ch.vehicle.vy += 10 * k; ch.vehicle.onGround = false; } }
    else ch.flop(_t, 2.5);
  }
  for (const pr of G.props) {
    const d = pr.pos.distanceTo(pos);
    if (d > R || pr.held || pr.inVehicle) continue;
    pr.cargoOf = null;
    _t.subVectors(pr.pos, pos).normalize().multiplyScalar(16 * (1 - d / R)); _t.y += 8;
    pr.vel.add(_t);
  }
  for (const v of G.vehicles) {
    if (v.display || v.remoteDriver || v.type.boat) continue;
    const d = v.pos.distanceTo(pos);
    if (d > R) continue;
    if (v.type.plane && !v.onGround) { v.planeCrash(false); continue; }
    if (v.type.heli) { v.vy += 8; continue; }
    v.vy += 11 * (1 - d / R); v.onGround = false; v.bounceV += 4;
    v.speed *= 0.3;
  }
  for (const f of (G.job && G.job.fires) || []) if (f.hp > 0 && f.pos.distanceTo(pos) < R) f.hp -= 60;
}

// Visual explosion: flash ball + confetti.
const fx = [];
export function boomFx(pos, confetti) {
  sfx.boom();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffd54a', transparent: true, opacity: 0.9 }));
  ball.position.copy(pos);
  G.scene.add(ball);
  fx.push({ m: ball, t: 0, kind: 'ball' });
  const n = confetti ? 40 : 15;
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.15), new THREE.MeshBasicMaterial({ color: pick(PAINT), side: THREE.DoubleSide }));
    c.position.copy(pos);
    c.userData.v = new THREE.Vector3(rand(-9, 9), rand(5, 14), rand(-9, 9));
    c.userData.s = new THREE.Vector3(rand(-8, 8), rand(-8, 8), 0);
    G.scene.add(c);
    fx.push({ m: c, t: 0, kind: 'conf' });
  }
}
G.fx = { boom: boomFx };

function splat(pos, color, normalUp) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(rand(0.25, 0.45), 10), mat(color));
  m.position.copy(pos);
  if (normalUp) { m.rotation.x = -Math.PI / 2; m.position.y += 0.03; }
  else m.lookAt(G.camera.position);
  G.scene.add(m);
  decals.push(m);
  if (decals.length > 80) G.scene.remove(decals.shift());
}

export function updateWeapons(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.vel.y -= s.w.grav * dt;
    const steps = Math.max(1, Math.ceil(s.vel.length() * dt / 0.3));
    let dead = false;
    for (let k = 0; k < steps && !dead; k++) {
      s.pos.addScaledVector(s.vel, dt / steps);
      // characters
      if (!s.visual) {
        for (const ch of G.characters) {
          if (ch.isPlayer || ch.vehicle) continue;
          const r = 0.5 + s.w.size;
          if (ch.p[PARTS.CHE].distanceTo(s.pos) < r || ch.p[PARTS.HEAD].distanceTo(s.pos) < r || ch.p[PARTS.PEL].distanceTo(s.pos) < r) {
            _d.copy(s.vel).normalize();
            if (s.w.explode) { explode(s.pos, false); }
            else if (ch.isRemote) G.onRemoteShot && G.onRemoteShot(ch, _d, s.type);
            else applyHit(ch, _d, s.w);
            if (s.w.paint) splat(s.pos, s.color, false);
            if (s.type !== 'rocket') sfx.splat();
            dead = true; break;
          }
        }
        if (!dead) for (const pr of G.props) {
          if (pr.held || pr.inVehicle || pr.pos.distanceTo(s.pos) > pr.r + s.w.size) continue;
          if (s.w.explode) explode(s.pos, false);
          else { pr.cargoOf = null; pr.vel.addScaledVector(_d.copy(s.vel).normalize(), s.w.push * 0.8); pr.vel.y += 1.5; }
          dead = true; break;
        }
        if (!dead && s.w.fire && G.job && G.job.fires) {
          for (const f of G.job.fires) if (f.hp > 0 && f.pos.distanceTo(s.pos) < 2.6) {
            f.hp -= 2.5; dead = true;
            if (f.hp <= 0) { G.scene.remove(f.mesh); sfx.splash(); }
          }
        }
      }
      if (dead) break;
      const gh = groundHeight(s.pos.x, s.pos.z, s.pos.y, 0);
      if (s.pos.y < Math.max(gh, -0.6)) {
        if (s.w.explode) explode(s.pos, s.visual);
        else if (s.w.paint) splat(_o.set(s.pos.x, Math.max(gh, -0.6), s.pos.z), s.color, true);
        dead = true;
      } else if (solid(s.pos)) {
        if (s.w.explode) explode(s.pos, s.visual);
        else if (s.w.paint) splat(s.pos, s.color, false);
        dead = true;
      }
    }
    s.life -= dt;
    if (s.type === 'rocket') s.mesh.lookAt(_o.copy(s.pos).add(s.vel));
    if (s.life <= 0 && s.w.explode && !dead) { explode(s.pos, s.visual); dead = true; }
    if (dead || s.life <= 0) { G.scene.remove(s.mesh); shots.splice(i, 1); }
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    if (f.kind === 'ball') {
      f.m.scale.setScalar(1 + f.t * 14);
      f.m.material.opacity = Math.max(0, 0.9 - f.t * 2.5);
      if (f.t > 0.4) { G.scene.remove(f.m); fx.splice(i, 1); }
    } else {
      const u = f.m.userData;
      u.v.y -= 9 * dt; u.v.multiplyScalar(1 - dt * 1.5);
      f.m.position.addScaledVector(u.v, dt);
      f.m.rotation.x += u.s.x * dt; f.m.rotation.y += u.s.y * dt;
      if (f.t > 2.5) { G.scene.remove(f.m); fx.splice(i, 1); }
    }
  }
  // soak slowly dries off
  for (const ch of G.characters) if (ch.soak) ch.soak = Math.max(0, ch.soak - dt * 0.35);
}

