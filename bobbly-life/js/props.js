// Grabbable physics props, presents, and choppable trees.
import * as THREE from 'three';
import { G, mat, rand, pick, WATER_Y, addMoney, writeSave } from './state.js';
import { groundHeight, resolveWalls, getGroundTag, baseHeight, setTreeMatrix, LOC } from './world.js';
import { sfx } from './audio.js';

export const PTYPES = {
  box:    { r: 0.5, name: 'Box' },
  ball:   { r: 0.65, name: 'Beach Ball', bounce: 0.8, light: true },
  bag:    { r: 0.45, name: 'Trash Bag' },
  log:    { r: 0.5, name: 'Log' },
  pizza:  { r: 0.4, name: 'Pizza' },
  fish:   { r: 0.4, name: 'Fish' },
  cone:   { r: 0.4, name: 'Cone' },
};

const B = new THREE.BoxGeometry(1, 1, 1);
const S = new THREE.SphereGeometry(1, 14, 10);
const C = new THREE.CylinderGeometry(1, 1, 1, 12);

export function buildPropMesh(type, variant) {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, opts) => {
    const m = new THREE.Mesh(geo, mat(color, opts)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m;
  };
  switch (type) {
    case 'box': add(B, '#c9a86b', 0, 0, 0, 0.9, 0.9, 0.9); add(B, '#a07a4a', 0, 0, 0, 0.92, 0.12, 0.92); break;
    case 'ball': add(S, '#ffffff', 0, 0, 0, 0.65, 0.65, 0.65); add(S, '#ff5b6e', 0, 0, 0, 0.66, 0.66, 0.2); add(S, '#3fa7ff', 0, 0, 0, 0.2, 0.66, 0.66); break;
    case 'bag': add(S, '#2b2f36', 0, -0.05, 0, 0.45, 0.42, 0.4); add(C, '#ffd54a', 0, 0.38, 0, 0.08, 0.14, 0.08); break;
    case 'log': add(C, '#8b5a2b', 0, 0, 0, 0.42, 1.8, 0.42, 0, 0, Math.PI / 2); add(C, '#e6c28a', 0.91, 0, 0, 0.38, 0.02, 0.38, 0, 0, Math.PI / 2); add(C, '#e6c28a', -0.91, 0, 0, 0.38, 0.02, 0.38, 0, 0, Math.PI / 2); break;
    case 'pizza': add(B, '#ffe7b8', 0, 0, 0, 0.8, 0.15, 0.8); add(B, '#e84a3f', 0, 0.08, 0, 0.5, 0.01, 0.5); break;
    case 'fish': {
      const col = variant === 'gold' ? '#ffcc22' : variant === 'bass' ? '#4a8a5a' : variant === 'boot' ? '#6b4a2b' : '#7fb3d9';
      if (variant === 'boot') { add(B, col, 0, 0, 0, 0.35, 0.6, 0.35); add(B, col, 0, -0.2, 0.2, 0.35, 0.25, 0.5); }
      else { add(S, col, 0, 0, 0, 0.18, 0.28, 0.55, 0, 0, 0, variant === 'gold' ? { emissive: '#aa7700', emissiveIntensity: 0.4 } : undefined); add(new THREE.ConeGeometry(0.25, 0.3, 4), col, 0, 0, -0.6, 1, 1, 1, -Math.PI / 2); add(S, '#111', 0.12, 0.08, 0.35, 0.05, 0.05, 0.05); }
      break;
    }
    case 'cone': add(new THREE.ConeGeometry(0.35, 0.8, 12), '#ff7a1a', 0, 0.05, 0, 1, 1, 1); add(B, '#ff7a1a', 0, -0.35, 0, 0.7, 0.1, 0.7); break;
  }
  return g;
}

export class Prop {
  constructor(type, x, y, z, { variant = null, value = 0 } = {}) {
    this.type = type;
    this.def = PTYPES[type];
    this.variant = variant;
    this.value = value;
    this.r = this.def.r;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.mesh = buildPropMesh(type, variant);
    this.mesh.position.copy(this.pos);
    G.scene.add(this.mesh);
    this.held = null; this.inVehicle = null; this.cargoOf = null;
    this.dead = false;
    G.props.push(this);
  }

  update(dt) {
    if (this.inVehicle) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    if (this.held) {
      const h = this.held;
      h.handPoint(this.pos);
      const f = h.facing;
      this.pos.x += Math.sin(f) * (this.r * 0.6); this.pos.z += Math.cos(f) * (this.r * 0.6);
      this.pos.y += this.type === 'log' ? 0.1 : 0;
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.set(0, f, 0);
      return;
    }
    if (this.cargoOf) { this.mesh.position.copy(this.pos); return; }
    const light = this.def.light;
    this.vel.y -= (light ? 12 : 24) * dt;
    if (light) this.vel.multiplyScalar(1 - dt * 0.3);
    this.pos.addScaledVector(this.vel, dt);
    _p.set(this.pos.x, this.pos.y - this.r, this.pos.z);
    const hit = resolveWalls(_p, this.r, this.r * 2, 0.2);
    if (hit) {
      this.pos.x = _p.x; this.pos.z = _p.z;
      if (hit.nx) this.vel.x = Math.abs(this.vel.x) * hit.nx * 0.5;
      if (hit.nz) this.vel.z = Math.abs(this.vel.z) * hit.nz * 0.5;
    }
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.05);
    const tag = getGroundTag();
    this.onGround = false;
    if (this.pos.y - this.r <= gh) {
      this.pos.y = gh + this.r;
      if (tag === 'tramp' && this.vel.y < -2) this.vel.y = Math.max(-this.vel.y * 0.95, 8);
      else if (this.vel.y < -2) this.vel.y = -this.vel.y * (this.def.bounce || 0.25);
      else { this.vel.y = 0; this.onGround = true; }
      const fr = 1 - Math.min(1, dt * (this.type === 'ball' ? 0.8 : 4));
      this.vel.x *= fr; this.vel.z *= fr;
    }
    if (this.pos.y < WATER_Y + 0.1 && baseHeight(this.pos.x, this.pos.z) < WATER_Y) {
      this.pos.y += (WATER_Y + 0.05 - this.pos.y) * 0.1;
      this.vel.multiplyScalar(0.95);
    }
    if (this.pos.y < -40) { this.dead = true; }
    // roll
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05 && (this.type === 'ball' || this.type === 'log' || this.type === 'bag')) {
      this.mesh.rotation.y = Math.atan2(this.vel.x, this.vel.z);
      if (this.type === 'ball') this.mesh.rotation.x += sp * dt / this.r;
    }
    this.mesh.position.copy(this.pos);
  }

  destroy() {
    this.dead = true;
    if (this.held) this.held.held = null;
    G.scene.remove(this.mesh);
  }
}
const _p = new THREE.Vector3();

// Characters bump / kick props when walking into them.
export function kickProps(ch) {
  if (ch.ragdoll || ch.vehicle) return;
  for (const pr of G.props) {
    if (pr.held || pr.inVehicle || pr.cargoOf) continue;
    const dx = pr.pos.x - ch.root.x, dz = pr.pos.z - ch.root.z;
    const d = Math.hypot(dx, dz);
    const min = pr.r + 0.45;
    if (d < min && d > 0.001 && pr.pos.y - pr.r < ch.root.y + 1.6 && pr.pos.y + pr.r > ch.root.y) {
      const push = (min - d);
      pr.pos.x += dx / d * push; pr.pos.z += dz / d * push;
      const sp = Math.hypot(ch.vel.x, ch.vel.z);
      const k = pr.def.light ? 1.6 : 0.8;
      pr.vel.x += dx / d * sp * k; pr.vel.z += dz / d * sp * k;
      if (pr.def.light && sp > 2) pr.vel.y = Math.max(pr.vel.y, 3 + sp * 0.3);
    }
  }
}

export function updateProps(dt) {
  for (const pr of G.props) pr.update(dt);
  // sell zones
  for (const z of G.sellZones) {
    for (const pr of G.props) {
      if (pr.dead || pr.inVehicle) continue;
      if (!(pr.type in z.accepts)) continue;
      if (Math.abs(pr.pos.x - z.x) < z.w / 2 && Math.abs(pr.pos.z - z.z) < z.d / 2 && pr.pos.y < (z.maxY || 3.5)) {
        const price = pr.value || z.accepts[pr.type];
        if (pr.held && pr.held.isPlayer) G.player.held = null;
        pr.destroy();
        addMoney(price, `Sold ${pr.def.name}${pr.variant ? ' (' + pr.variant + ')' : ''}`);
        sfx.coin();
        z.onSell && z.onSell(pr);
      }
    }
  }
  G.props = G.props.filter(p => !p.dead);
}

// ---------------------------------------------------------------- presents
export const PRESENT_SPOTS = [
  [0, -3.6], [95, 95], [-95, -95], [150, -150], [-150, 150], [229, 2.5], [172, -172], [-74, 48], [-44, -74],
  [-130, 0], [70, 68], [0, -72], [-90, -120], [-60, -96], [108, 0], [-176, 0], [0, 176], [62, 126], [11, -131], [-150, -150],
  // out in the big world (some are filled in once landmarks exist)
  'peak', 'pyramid', 'cabin', 'oasis', 'tower', 'castle', 'space', 'farm', 'village', 'camp', [-420, 180], [-600, -120], [345, 327], [520, 420], [-240, 240], [-30, 600], [30, -600], [-600, 30], [-900, -400], [800, 300], [-300, 950], [700, -300], [-1000, 700],
];
const presentGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
export function spawnPresents() {
  const cols = ['#ff5b6e', '#3fa7ff', '#b46cff', '#46c25a', '#ffd54a'];
  PRESENT_SPOTS.forEach((spot, i) => {
    const L = { castle: LOC.castle, space: LOC.space, farm: LOC.farm, village: LOC.village, camp: LOC.camp, tower: LOC.tower, peak: LOC.peak, pyramid: LOC.pyramid && { x: 140, z: -720 }, cabin: LOC.cabin, oasis: LOC.oasis };
    const [x, z] = typeof spot === 'string' ? [L[spot].x, L[spot].z] : spot;
    if (G.save.presents.includes(i)) return;
    const g = new THREE.Group();
    const m = new THREE.Mesh(presentGeo, mat(cols[i % cols.length], { emissive: cols[i % cols.length], emissiveIntensity: 0.25 }));
    const rb1 = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.84, 0.15), mat('#fff6b0'));
    const rb2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.84, 0.84), mat('#fff6b0'));
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.06, 6, 12), mat('#fff6b0'));
    bow.position.y = 0.5;
    g.add(m, rb1, rb2, bow);
    m.castShadow = true;
    const y = groundHeight(x, z, 999) + 0.8;
    g.position.set(x, y, z);
    G.scene.add(g);
    G.presents.push({ id: i, x, y, z, mesh: g });
  });
}
export function updatePresents(dt, onCollect) {
  const P = G.player.pos;
  for (const pr of G.presents) {
    if (pr.got) continue;
    pr.mesh.rotation.y += dt * 1.5;
    pr.mesh.position.y = pr.y + Math.sin(G.time * 2 + pr.id) * 0.2;
    if (Math.abs(P.x - pr.x) < 1.6 && Math.abs(P.z - pr.z) < 1.6 && Math.abs(P.y + 0.8 - pr.y) < 2.2) {
      pr.got = true;
      G.scene.remove(pr.mesh);
      G.save.presents.push(pr.id);
      writeSave();
      sfx.present();
      onCollect(pr);
    }
  }
}

// ---------------------------------------------------------------- trees
export function hitTree(tree) {
  if (!tree.alive) return;
  tree.hp--; tree.shake = 0.3;
  sfx.chop();
  if (tree.hp <= 0) {
    tree.alive = false;
    tree.falling = 0;
    tree.fallDir = Math.random() < 0.5 ? -1 : 1;
    tree.collider.off = true;
  }
}
export function updateTrees(dt) {
  for (const t of G.trees) {
    if (t.shake > 0) {
      t.shake -= dt;
      setTreeMatrix(t, 1, Math.sin(t.shake * 60) * 0.05);
      if (t.shake <= 0) setTreeMatrix(t, 1, 0);
    }
    if (t.falling !== undefined && t.falling !== null) {
      t.falling += dt;
      const lean = Math.min(Math.PI / 2, t.falling * t.falling * 2.5) * t.fallDir;
      setTreeMatrix(t, 1, lean);
      if (t.falling > 1.2) {
        t.falling = null;
        setTreeMatrix(t, 0);
        t.regrow = 90;
        for (let i = 0; i < 2; i++) {
          const pr = new Prop('log', t.x + t.fallDir * (1.5 + i * 2), 1, t.z + rand(-0.5, 0.5));
          pr.vel.set(t.fallDir * 1.5, 2, 0);
        }
      }
    }
    if (!t.alive && t.falling === null && t.regrow > 0) {
      t.regrow -= dt;
      if (t.regrow <= 0) { t.alive = true; t.hp = 5; t.collider.off = false; t.growT = 0; }
    }
    if (t.growT !== undefined) {
      t.growT += dt;
      setTreeMatrix(t, Math.min(1, t.growT / 2));
      if (t.growT > 2) t.growT = undefined;
    }
  }
}

export function scatterProps() {
  // beach balls in the park, boxes and cones around town
  for (let i = 0; i < 5; i++) new Prop('ball', -60 + rand(-15, 15), 1, 60 + rand(-5, 15));
  for (let i = 0; i < 3; i++) new Prop('ball', 175, 1, rand(-60, 60));
  for (let i = 0; i < 8; i++) new Prop('box', pick([-1, 1]) * rand(6, 20), 1, pick([-1, 1]) * rand(6, 20));
  for (let i = 0; i < 6; i++) new Prop('cone', -60 + rand(-18, 18), 1, -60 + rand(-18, 18));
  for (let i = 0; i < 4; i++) new Prop('box', 48 + rand(-3, 3), 1 + i, -48);
}
