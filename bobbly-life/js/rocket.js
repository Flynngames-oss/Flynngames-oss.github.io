// Bobbly Space Center: board the rocket, count down, launch in first person and reach space.
import * as THREE from 'three';
import { G, mat, clamp, rand } from './state.js';
import { LOC } from './world.js';
import { sfx, rumble } from './audio.js';

const R = { state: 'idle', t: 0, vy: 0, alt: 0, pitch: 0 };
G.rocket = R;
let root, s1, s2, cap, flame, flame2, hud, smoke = [];
const SPACE_ALT = 9000;

function cyl(parent, color, r0, r1, h, y, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg), mat(color));
  m.position.y = y + h / 2; m.castShadow = true; parent.add(m); return m;
}
function flameMesh() {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(2.6, 16, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  outer.rotation.x = Math.PI; outer.position.y = -8;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(1.4, 9, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#fff2b0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.rotation.x = Math.PI; inner.position.y = -4.5;
  g.add(outer, inner); g.visible = false;
  return g;
}

export function initRocket() {
  const pad = LOC.rocketPad;
  if (!pad) return;
  root = new THREE.Group();
  // Stage 1 (booster)
  s1 = new THREE.Group();
  cyl(s1, '#eceeee', 3.2, 3.2, 40, 0);
  cyl(s1, '#1f1f22', 3.26, 3.26, 2.5, 30);
  cyl(s1, '#1f1f22', 3.26, 3.26, 1.2, 4);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 4), mat('#2a2a2e'));
    fin.position.set(Math.sin(a) * 4.4, 3.5, Math.cos(a) * 4.4); fin.rotation.y = a; fin.castShadow = true; s1.add(fin);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 2.2, 14, 1, true), mat('#3a3a3e', { side: THREE.DoubleSide }));
    bell.position.set(Math.sin(a + 0.78) * 1.5, -1.1, Math.cos(a + 0.78) * 1.5); s1.add(bell);
  }
  flame = flameMesh(); s1.add(flame);
  // Stage 2 + capsule
  s2 = new THREE.Group(); s2.position.y = 40;
  cyl(s2, '#2a2a2e', 3.2, 3.2, 2, 0);
  cyl(s2, '#eceeee', 3.2, 3.2, 16, 2);
  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.5, 2, 12, 1, true), mat('#3a3a3e', { side: THREE.DoubleSide })); b2.position.y = -0.8; s2.add(b2);
  flame2 = flameMesh(); flame2.scale.setScalar(0.6); s2.add(flame2);
  cap = new THREE.Group(); cap.position.y = 18;
  cyl(cap, '#d8dadc', 3.2, 1.3, 7, 0);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.2), mat('#1a2a3a', { emissive: '#0a1a2a' })); win.position.set(0, 3.6, 2.5); win.rotation.x = -0.35; cap.add(win);
  cyl(cap, '#b8382e', 0.25, 0.15, 6, 7);
  cyl(cap, '#b8382e', 0.6, 0.01, 1.4, 13);
  s2.add(cap);
  root.add(s1, s2);
  G.scene.add(root);
  reset();

  hud = document.createElement('div');
  hud.id = 'rocketHud';
  hud.style.cssText = 'position:fixed;top:18%;left:50%;transform:translateX(-50%);text-align:center;color:#fff;font-family:"Barlow Condensed",sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.8);pointer-events:none;display:none;z-index:5';
  document.body.appendChild(hud);

  G.interacts.push({
    x: pad.x - 10, z: pad.z + 18, r: 7,
    label: () => R.state === 'idle' ? 'Board the rocket and launch to space' : 'Rocket is busy — wait for it to return',
    action: board,
  });
  G.rocketE = () => {
    if (R.state === 'count' && R.t > 3) { exitRide(false); R.state = 'idle'; reset(); G.toast('Launch scrubbed.'); }
    else if (R.state === 'space' || (R.state === 'flight' && R.alt > 400)) exitRide(true);
  };
}

function reset() {
  const pad = LOC.rocketPad;
  root.position.set(pad.x, pad.y + 2.2, pad.z);
  root.rotation.set(0, 0, 0);
  if (s1.parent !== root) { G.scene.remove(s1); root.add(s1); }
  s1.position.set(0, 0, 0); s1.rotation.set(0, 0, 0);
  flame.visible = flame2.visible = false;
  R.vy = 0; R.alt = 0; R.pitch = 0;
}

function board() {
  if (R.state !== 'idle') return;
  const p = G.player;
  if (p.vehicle) p.vehicle.removeOccupant(p);
  if (p.held && G.dropHeld) G.dropHeld(false);
  G.rocketRide = true;
  R.prevFp = G.cam.fp;
  G.cam.fp = true; G.cam.pitch = -0.15; G.cam.yaw = Math.PI;
  p.group.visible = false;
  R.state = 'count'; R.t = 10; R.lastSec = 11;
  hud.style.display = 'block';
  sfx.door();
}

function exitRide(parachute) {
  const p = G.player;
  G.rocketRide = false;
  p.group.visible = true;
  G.cam.fp = R.prevFp;
  G.camShake = 0;
  rumble(0);
  hud.style.display = 'none';
  if (parachute) {
    const pad = LOC.rocketPad;
    p.place(pad.x - 60, pad.y + 700, pad.z + 40, 0);
    p.vel.y = -8; p.grounded = false; p.chute = true;
    G.toast('Welcome back to Earth! Steer your parachute with WASD.', '', 6000);
    R.state = 'return'; R.t = 6;
  } else {
    const pad = LOC.rocketPad;
    p.place(pad.x - 8, pad.y + 0.2, pad.z + 10, 0);
  }
  G.applyGraphics && G.applyGraphics();
}

function puff(pos, big) {
  let s = smoke.find(q => !q.visible);
  if (!s) {
    if (smoke.length > 140) return;
    s = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: '#d8d8d8', transparent: true, opacity: 0.7, depthWrite: false }));
    G.scene.add(s); smoke.push(s);
  }
  s.visible = true;
  s.position.copy(pos).add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)));
  s.userData = { v: new THREE.Vector3(rand(-6, 6), rand(-2, 3), rand(-6, 6)).multiplyScalar(big ? 1.6 : 0.5), life: 0, max: big ? 5 : 3 };
  s.scale.setScalar(big ? 3 : 1.5);
}

const _v = new THREE.Vector3();
export function updateRocket(dt) {
  if (!root) return;
  // smoke
  for (const s of smoke) {
    if (!s.visible) continue;
    const u = s.userData; u.life += dt;
    s.position.addScaledVector(u.v, dt); u.v.multiplyScalar(1 - dt * 0.6);
    s.scale.multiplyScalar(1 + dt * 0.9);
    s.material.opacity = Math.max(0, 0.7 * (1 - u.life / u.max));
    if (u.life > u.max) s.visible = false;
  }
  const flick = 0.85 + Math.random() * 0.3;
  if (flame.visible) flame.scale.set(1, flick * (1 + R.vy / 200), 1);
  if (flame2.visible) flame2.scale.set(0.6, 0.6 * flick, 0.6);

  if (R.state === 'count') {
    R.t -= dt;
    const sec = Math.ceil(R.t);
    if (sec !== R.lastSec) { R.lastSec = sec; if (sec > 0) sfx.pop(); }
    hud.innerHTML = `<div style="font-size:18px;letter-spacing:4px;opacity:.8">LAUNCH IN</div><div style="font-size:96px;font-weight:800">T-${Math.max(0, sec)}</div><div style="font-size:15px;opacity:.7">Look around with the mouse · E to scrub the launch</div>`;
    if (R.t < 3) {
      flame.visible = true;
      G.camShake = 0.05 + (3 - R.t) * 0.06;
      rumble(0.3 + (3 - R.t) * 0.2);
      if (Math.random() < 0.6) puff(_v.set(root.position.x, root.position.y - 2, root.position.z), true);
    }
    if (R.t <= 0) { R.state = 'flight'; R.ft = 0; sfx.boom(); }
  } else if (R.state === 'flight') {
    R.ft += dt;
    const acc = Math.min(34, 10 + R.ft * 1.2);
    R.vy += acc * dt;
    R.alt += R.vy * dt;
    // gentle gravity turn toward the east after clearing the tower
    R.pitch = clamp((R.alt - 500) / 9000, 0, 0.45);
    root.rotation.z = -R.pitch;
    root.position.x += Math.sin(R.pitch) * R.vy * dt;
    root.position.y += Math.cos(R.pitch) * R.vy * dt;
    G.camShake = Math.max(0.04, 0.35 - R.ft * 0.02);
    rumble(Math.max(0.25, 1 - R.alt / SPACE_ALT));
    if (R.alt < 1500 && Math.random() < 0.7) puff(_v.set(root.position.x, root.position.y - 4, root.position.z), R.alt < 150);
    // stage separation
    if (R.alt > 2600 && s1.parent === root) {
      root.updateMatrixWorld();
      s1.getWorldPosition(_v);
      root.remove(s1); G.scene.add(s1);
      s1.position.copy(_v); s1.rotation.z = -R.pitch;
      s1.userData.vy = R.vy * 0.4; s1.userData.spin = rand(-0.4, 0.4);
      flame.visible = false; flame2.visible = true;
      sfx.boom(); G.camShake = 0.5;
      G.toast('Stage separation!');
    }
    if (R.alt > SPACE_ALT) {
      R.state = 'space'; flame2.visible = false; rumble(0.05); G.camShake = 0;
      G.toast('You made it to SPACE! Press E to return to Earth.', '', 9000);
      sfx.win();
    }
    const kmh = Math.round(R.vy * 3.6);
    hud.innerHTML = `<div style="font-size:16px;letter-spacing:4px;opacity:.8">ALTITUDE</div><div style="font-size:64px;font-weight:800">${Math.round(R.alt).toLocaleString()} m</div><div style="font-size:22px">${kmh.toLocaleString()} km/h</div>`;
  } else if (R.state === 'space') {
    R.vy += (0 - R.vy) * Math.min(1, dt * 0.4);
    root.position.y += R.vy * dt * 0.3;
    root.rotation.z += dt * 0.01;
    R.alt = root.position.y;
    hud.innerHTML = `<div style="font-size:16px;letter-spacing:4px;opacity:.8">IN ORBIT</div><div style="font-size:54px;font-weight:800">${Math.round(R.alt).toLocaleString()} m</div><div style="font-size:18px;opacity:.85">Press E to return to Earth</div>`;
  } else if (R.state === 'return') {
    R.t -= dt;
    if (R.t <= 0) { R.state = 'idle'; reset(); }
  }
  // falling booster
  if (s1.parent !== root) {
    s1.userData.vy -= 20 * dt;
    s1.position.y += s1.userData.vy * dt;
    s1.rotation.x += s1.userData.spin * dt;
    if (s1.position.y < -50 && R.state !== 'flight' && R.state !== 'space') reset();
  }
  // keep the rider in the capsule window
  if (G.rocketRide) {
    root.updateMatrixWorld();
    cap.localToWorld(_v.set(0, 3.4, 3.1));
    const p = G.player;
    p.place(_v.x, _v.y - 1.95, _v.z, G.cam.yaw + Math.PI);
    p.group.visible = false;
  }
}
