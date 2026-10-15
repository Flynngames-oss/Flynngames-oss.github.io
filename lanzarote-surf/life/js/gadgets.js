// Gadgets: a jetpack (hold Space in the air to fly) and a grappling hook (Q: shoot it where you look and get
// yanked through the air). Bought and equipped from the phone.
import * as THREE from 'three';
import { G, addMoney, writeSave, mat } from './state.js';
import { heightAt } from './terrain.js';
import { nearColliders } from './world.js';
import { PARTS } from './character.js';
import { fire, smoke, sparks } from './debris.js';
import { sfx } from './audio.js';

export const GADGETS = {
  jetpack: { name: 'Jetpack', emo: '🧑‍🚀', price: 1500, desc: 'Jump, then HOLD Space to blast into the sky. Refuels on the ground.' },
  grapple: { name: 'Grappling Hook', emo: '🪝', price: 900, desc: 'Press Q to fire it where you look and swing across the city. Q again to let go.' },
};
const S = { fuel: 1, pack: null, flames: [], rope: null, hook: null, grab: null, hud: null, thrusting: false };

function owned() { return G.save.gadgets || (G.save.gadgets = []); }
export function buyOrEquip(id) {
  const g = GADGETS[id];
  if (!owned().includes(id)) {
    if (G.save.money < g.price) { G.toast && G.toast(`The ${g.name} costs $${g.price}. Keep working! 💪`, 'bad'); sfx.bad && sfx.bad(); return false; }
    addMoney(-g.price, 'Bought a ' + g.name + '!'); owned().push(id); sfx.win && sfx.win();
  }
  G.save.gadget = G.save.gadget === id ? null : id;
  writeSave();
  G.toast && G.toast(G.save.gadget ? `${g.emo} ${g.name} equipped! ${g.desc}` : `${g.name} put away.`, null, 6000);
  return true;
}

// ---------------------------------------------------------------- jetpack
function packMesh() {
  const g = new THREE.Group();
  const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  const red = new THREE.MeshStandardMaterial({ color: '#e8463a', roughness: 0.4, metalness: 0.3 }), steel = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.3, metalness: 0.8 });
  for (const sx of [-0.17, 0.17]) {
    add(new THREE.CapsuleGeometry(0.13, 0.42, 4, 10), red, sx, 0.45, -0.5);
    add(new THREE.CylinderGeometry(0.08, 0.12, 0.16, 10), steel, sx, 0.08, -0.5);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb030', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.rotation.x = Math.PI; fl.position.set(sx, -0.32, -0.5); g.add(fl); S.flames.push(fl);
  }
  add(new THREE.BoxGeometry(0.5, 0.22, 0.1), steel, 0, 0.62, -0.44);
  return g;
}
function hud() {
  if (S.hud) return S.hud;
  const el = document.createElement('div'); el.id = 'gadgetHud';
  el.innerHTML = '<span id="gadgetName"></span><div id="fuelBar"><div id="fuelFill"></div></div>';
  document.body.appendChild(el); S.hud = el; return el;
}

// ---------------------------------------------------------------- grappling hook
const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
function solidAt(p) {
  if (p.y < heightAt(p.x, p.z)) return true;
  for (const c of nearColliders(p.x, p.z)) if (!c.off && p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) return true;
  return false;
}
export function grappleKey() {
  const P = G.player;
  if (G.save.gadget !== 'grapple' || P.vehicle || !G.started) return false;
  if (S.grab) { S.grab = null; return true; }
  G.camera.getWorldDirection(_d);
  _a.copy(P.p[PARTS.HR]);
  for (let t = 2; t < 90; t += 0.8) {
    _p.copy(_a).addScaledVector(_d, t);
    if (solidAt(_p)) { S.grab = { pt: _p.clone().addScaledVector(_d, -0.4), t: 0 }; sfx.pew && sfx.pew(); sparks(_p, 8); return true; }
  }
  G.toast && G.toast('🪝 Nothing to grab there — aim at a building, tree, hill or rock.', null, 2000);
  return true;
}
function ropeLine() {
  if (S.rope) return S.rope;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  S.rope = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#2a2a2e' })); S.rope.frustumCulled = false;
  S.hook = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 6), mat('#c8ccd2', { emissive: '#333' }));
  G.scene.add(S.rope, S.hook); return S.rope;
}

// ---------------------------------------------------------------- every frame
export function updateGadgets(dt) {
  const P = G.player, K = G.keys;
  if (!P || !G.started) return;
  const gad = G.save.gadget;
  // jetpack
  const showPack = gad === 'jetpack' && !P.vehicle;
  if (showPack && !S.pack) { S.pack = packMesh(); P.body.add(S.pack); }
  if (S.pack) S.pack.visible = showPack;
  S.thrusting = false;
  if (showPack && !P.ragdoll && !P.swimming) {
    if (K.Space && !P.grounded && S.fuel > 0 && !G.ui.panel && !G.ui.chatOpen) {
      S.thrusting = true;
      S.fuel = Math.max(0, S.fuel - dt * 0.16);
      P.vel.y = Math.min(P.vel.y + 46 * dt, 15);
      P.vel.x += P.ctrl.mx * 26 * dt; P.vel.z += P.ctrl.mz * 26 * dt;
      const h = Math.hypot(P.vel.x, P.vel.z); if (h > 22) { P.vel.x *= 22 / h; P.vel.z *= 22 / h; }
      if (Math.random() < 0.6) { _p.copy(P.root); _p.y += 0.4; fire(_p, 1, 0.35); if (Math.random() < 0.3) smoke(_p, 1, false); }
      if (Math.random() < dt * 8 && sfx.whoosh) sfx.whoosh();
    } else if (P.grounded) S.fuel = Math.min(1, S.fuel + dt * 0.4);
  }
  for (const f of S.flames) { f.visible = S.thrusting; f.scale.set(1, 0.7 + Math.random() * 0.6, 1); }
  // grappling hook
  if (S.grab) {
    const R = S.grab; R.t += dt;
    _d.subVectors(R.pt, P.root); const dist = _d.length();
    if (dist < 2.2 || R.t > 3.5 || P.vehicle || gad !== 'grapple') S.grab = null;
    else {
      if (P.ragdoll) P.ragdoll = false;
      _d.normalize();
      const sp = Math.min(34, 12 + R.t * 40);
      P.vel.lerp(_d.multiplyScalar(sp), Math.min(1, dt * 6));
      P.vel.y += 6 * dt;
      P.grounded = false;
    }
  }
  if (S.grab) {
    ropeLine();
    const a = S.rope.geometry.attributes.position, h = P.p[PARTS.HR];
    a.setXYZ(0, h.x, h.y, h.z); a.setXYZ(1, S.grab.pt.x, S.grab.pt.y, S.grab.pt.z); a.needsUpdate = true;
    S.hook.position.copy(S.grab.pt); S.rope.visible = S.hook.visible = true;
  } else if (S.rope) S.rope.visible = S.hook.visible = false;
  // fuel meter
  const show = gad === 'jetpack' && !P.vehicle;
  if (show || S.hud) {
    const el = hud();
    el.style.display = show || gad === 'grapple' ? 'block' : 'none';
    el.querySelector('#gadgetName').textContent = gad === 'jetpack' ? '🧑‍🚀 JETPACK — hold Space in the air' : gad === 'grapple' ? '🪝 GRAPPLE — press Q' : '';
    el.querySelector('#fuelBar').style.display = gad === 'jetpack' ? 'block' : 'none';
    el.querySelector('#fuelFill').style.width = Math.round(S.fuel * 100) + '%';
    el.querySelector('#fuelFill').style.background = S.fuel < 0.2 ? '#ff5b5b' : '#ffb030';
  }
}
