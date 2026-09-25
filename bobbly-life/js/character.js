// Wobbly characters: spring-driven body parts while walking, verlet ragdoll when flopped.
import * as THREE from 'three';
import { G, mat, placeBetween, textSprite, clamp, angleLerp, WATER_Y, UP, rand, pick, COLORS } from './state.js';
import { groundHeight, resolveWalls, getGroundTag, baseHeight } from './world.js';
import { sfx } from './audio.js';

export const HATS = [
  { id: 'none', name: 'No Hat', price: 0, emo: '🙂' },
  { id: 'cap', name: 'Cap', price: 50, emo: '🧢' },
  { id: 'beanie', name: 'Beanie', price: 90, emo: '🧶' },
  { id: 'party', name: 'Party Hat', price: 80, emo: '🥳' },
  { id: 'cone', name: 'Traffic Cone', price: 60, emo: '🚧' },
  { id: 'chef', name: 'Chef Hat', price: 120, emo: '👨‍🍳' },
  { id: 'hardhat', name: 'Hard Hat', price: 110, emo: '⛑️' },
  { id: 'tophat', name: 'Top Hat', price: 150, emo: '🎩' },
  { id: 'bunny', name: 'Bunny Ears', price: 180, emo: '🐰' },
  { id: 'cowboy', name: 'Cowboy Hat', price: 200, emo: '🤠' },
  { id: 'witch', name: 'Witch Hat', price: 220, emo: '🧙' },
  { id: 'propeller', name: 'Propeller Cap', price: 250, emo: '🚁' },
  { id: 'viking', name: 'Viking Helmet', price: 300, emo: '🪓' },
  { id: 'halo', name: 'Halo', price: 500, emo: '😇' },
  { id: 'crown', name: 'Crown', price: 800, emo: '👑' },
];
export const GLASSES = [
  { id: 'none', name: 'None', price: 0, emo: '🙂' },
  { id: 'nerd', name: 'Nerd Glasses', price: 80, emo: '🤓' },
  { id: 'sun', name: 'Sunglasses', price: 100, emo: '😎' },
  { id: 'goggles', name: 'Goggles', price: 150, emo: '🥽' },
  { id: 'diamond', name: 'Diamond Shades', price: 400, emo: '💎' },
];
export const EYES = [
  { id: 'round', name: 'Normal' }, { id: 'big', name: 'Big' }, { id: 'happy', name: 'Happy' },
  { id: 'angry', name: 'Grumpy' }, { id: 'sleepy', name: 'Sleepy' },
];

const PEL = 0, CHE = 1, HEAD = 2, HL = 3, HR = 4, FL = 5, FR = 6;
export const PARTS = { PEL, CHE, HEAD, HL, HR, FL, FR };
const RAD = [0.38, 0.42, 0.42, 0.14, 0.14, 0.16, 0.16];
const INVM = [0.6, 0.5, 0.8, 1.6, 1.6, 1.4, 1.4];
const POSE = [[0, 0.75, 0], [0, 1.25, 0], [0, 1.95, 0], [-0.55, 0.95, 0.05], [0.55, 0.95, 0.05], [-0.22, 0.12, 0], [0.22, 0.12, 0]];
const CONS = [[PEL, CHE], [CHE, HEAD], [PEL, HEAD], [CHE, HL], [CHE, HR], [PEL, FL], [PEL, FR], [HEAD, HL, 1], [HEAD, HR, 1], [FL, FR, 1]];
const K0 = [800, 380, 190, 70, 70, 650, 650];
const C0 = [50, 24, 11, 7, 7, 42, 42];

const CAPS = new THREE.CapsuleGeometry(0.46, 0.5, 6, 14);
const HEADG = new THREE.SphereGeometry(0.42, 18, 14);
const LIMB = new THREE.CylinderGeometry(1, 1, 1, 8);
const BALL = new THREE.SphereGeometry(1, 10, 8);
const HALFBALL = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _mtx = new THREE.Matrix4();

function mk(geo, material, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

export function makeHat(id) {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, opts) => {
    const m = mk(geo, mat(color, opts), sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
  };
  const CONE = new THREE.ConeGeometry(1, 1, 14);
  switch (id) {
    case 'cap': add(HALFBALL, '#e84a3f', 0, 0.12, 0, 0.44, 0.36, 0.44); add(LIMB, '#e84a3f', 0, 0.14, 0.36, 0.28, 0.03, 0.22); break;
    case 'beanie': add(HALFBALL, '#46c25a', 0, 0.1, 0, 0.45, 0.42, 0.45); add(BALL, '#ffffff', 0, 0.55, 0, 0.1, 0.1, 0.1); add(LIMB, '#2a8a3a', 0, 0.12, 0, 0.455, 0.08, 0.455); break;
    case 'party': add(CONE, '#e05a8a', 0, 0.62, 0, 0.24, 0.6, 0.24, -0.1); add(BALL, '#ffd54a', 0, 0.94, -0.03, 0.08, 0.08, 0.08); break;
    case 'cone': add(CONE, '#ff7a1a', 0, 0.66, 0, 0.3, 0.8, 0.3); add(LIMB, '#ffffff', 0, 0.62, 0, 0.19, 0.1, 0.19); add(LIMB, '#ff7a1a', 0, 0.28, 0, 0.4, 0.05, 0.4); break;
    case 'chef': add(LIMB, '#ffffff', 0, 0.45, 0, 0.3, 0.35, 0.3); add(BALL, '#ffffff', 0, 0.72, 0, 0.4, 0.25, 0.4); break;
    case 'hardhat': add(HALFBALL, '#ffd54a', 0, 0.14, 0, 0.45, 0.38, 0.45); add(LIMB, '#ffd54a', 0, 0.14, 0.05, 0.56, 0.03, 0.56); break;
    case 'tophat': add(LIMB, '#222222', 0, 0.66, 0, 0.28, 0.55, 0.28); add(LIMB, '#222222', 0, 0.38, 0, 0.48, 0.04, 0.48); add(LIMB, '#e84a3f', 0, 0.45, 0, 0.285, 0.1, 0.285); break;
    case 'bunny': for (const s of [-1, 1]) { add(BALL, '#ffffff', s * 0.16, 0.7, 0, 0.1, 0.35, 0.06, 0, 0, -s * 0.15); add(BALL, '#ffb0d8', s * 0.16, 0.7, 0.04, 0.05, 0.25, 0.03, 0, 0, -s * 0.15); } break;
    case 'cowboy': add(LIMB, '#8b5a2b', 0, 0.3, 0, 0.72, 0.04, 0.72); add(LIMB, '#8b5a2b', 0, 0.48, 0, 0.3, 0.35, 0.3); add(LIMB, '#4a2b1a', 0, 0.36, 0, 0.305, 0.07, 0.305); break;
    case 'witch': add(LIMB, '#5a2b8b', 0, 0.3, 0, 0.66, 0.04, 0.66); add(CONE, '#5a2b8b', 0, 0.75, -0.05, 0.36, 0.9, 0.36, -0.2); break;
    case 'propeller': {
      add(HALFBALL, '#3fa7ff', 0, 0.12, 0, 0.44, 0.36, 0.44); add(LIMB, '#ffd54a', 0, 0.55, 0, 0.03, 0.12, 0.03);
      const p = new THREE.Group(); p.position.y = 0.62; p.userData.spin = true;
      const b1 = mk(LIMB, mat('#e84a3f'), 0.06, 0.02, 0.5); b1.rotation.x = Math.PI / 2; b1.scale.set(0.06, 0.02, 0.06); p.add(b1);
      const bl = mk(new THREE.BoxGeometry(0.9, 0.02, 0.1), mat('#e84a3f')); p.add(bl);
      const bl2 = mk(new THREE.BoxGeometry(0.1, 0.02, 0.9), mat('#46c25a')); p.add(bl2);
      g.add(p); break;
    }
    case 'viking': add(HALFBALL, '#9aa4b1', 0, 0.1, 0, 0.45, 0.4, 0.45); for (const s of [-1, 1]) add(CONE, '#fff6e0', s * 0.5, 0.35, 0, 0.09, 0.4, 0.09, 0, 0, -s * 1.1); break;
    case 'halo': { const t = mk(new THREE.TorusGeometry(0.3, 0.04, 8, 20), mat('#ffe066', { emissive: '#ffd000', emissiveIntensity: 0.8 })); t.rotation.x = Math.PI / 2; t.position.y = 0.72; g.add(t); break; }
    case 'crown': add(LIMB, '#ffcc22', 0, 0.42, 0, 0.3, 0.2, 0.3); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(CONE, '#ffcc22', Math.sin(a) * 0.26, 0.6, Math.cos(a) * 0.26, 0.07, 0.18, 0.07); } add(BALL, '#e84a3f', 0, 0.42, 0.3, 0.05, 0.05, 0.03); break;
  }
  return g;
}

export function makeGlasses(id) {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, opts) => {
    const m = mk(geo, mat(color, opts), sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
  };
  const B = new THREE.BoxGeometry(1, 1, 1);
  switch (id) {
    case 'sun': for (const s of [-1, 1]) add(B, '#111111', s * 0.15, 0.07, 0.43, 0.22, 0.13, 0.04); add(B, '#111111', 0, 0.1, 0.44, 0.1, 0.03, 0.02); break;
    case 'nerd': for (const s of [-1, 1]) { const t = mk(new THREE.TorusGeometry(0.1, 0.022, 6, 16), mat('#222')); t.position.set(s * 0.15, 0.07, 0.44); g.add(t); } add(B, '#222', 0, 0.07, 0.45, 0.08, 0.02, 0.02); break;
    case 'goggles': add(LIMB, '#553311', 0, 0.07, 0, 0.44, 0.1, 0.44); for (const s of [-1, 1]) add(LIMB, '#66ccff', s * 0.15, 0.07, 0.42, 0.11, 0.08, 0.11, Math.PI / 2, 0, 0, { emissive: '#224466' }); break;
    case 'diamond': for (const s of [-1, 1]) add(new THREE.OctahedronGeometry(0.14), '#8ff0ff', s * 0.16, 0.07, 0.43, 1, 0.8, 0.3, 0, 0, 0, { emissive: '#3fd6d0', emissiveIntensity: 0.5 }); break;
  }
  return g;
}

function makeFace(eyes) {
  const g = new THREE.Group();
  const white = mat('#ffffff'), black = mat('#1a1a1a');
  const big = eyes === 'big' ? 1.35 : 1;
  for (const s of [-1, 1]) {
    if (eyes === 'happy') {
      const t = mk(new THREE.TorusGeometry(0.075, 0.022, 6, 12, Math.PI), black);
      t.position.set(s * 0.15, 0.05, 0.4); g.add(t);
      continue;
    }
    const w = mk(BALL, white, 0.1 * big, (eyes === 'sleepy' ? 0.04 : 0.11) * big, 0.06);
    w.position.set(s * 0.15, 0.06, 0.37); g.add(w);
    const p = mk(BALL, black, 0.055 * big, (eyes === 'sleepy' ? 0.03 : 0.065) * big, 0.04);
    p.position.set(s * 0.15, 0.05, 0.42); g.add(p);
    if (eyes === 'angry') {
      const br = mk(new THREE.BoxGeometry(0.16, 0.035, 0.03), black);
      br.position.set(s * 0.15, 0.2, 0.39); br.rotation.z = s * 0.35; g.add(br);
    }
  }
  const mouth = mk(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI), mat(eyes === 'angry' ? '#1a1a1a' : '#b8326a'));
  mouth.position.set(0, -0.12, 0.39);
  mouth.rotation.z = eyes === 'angry' ? 0 : Math.PI;
  g.add(mouth);
  for (const s of [-1, 1]) {
    const b = mk(BALL, mat('#ff8fb0', { transparent: true, opacity: 0.55 }), 0.06, 0.035, 0.02);
    b.position.set(s * 0.27, -0.06, 0.34); g.add(b);
  }
  return g;
}

export function randomOutfit() {
  return {
    skin: pick(['#ffcf4a', '#f2c9a0', '#ffd6e8', '#9be05a', '#3fd6d0', '#ffb36b', '#b46cff', '#ff8fb0', '#c68b59', '#8b5a2b']),
    shirt: pick(COLORS), pants: pick(COLORS),
    hat: Math.random() < 0.5 ? pick(HATS).id : 'none',
    glasses: Math.random() < 0.25 ? pick(GLASSES).id : 'none',
    eyes: pick(EYES).id,
  };
}

export class Character {
  constructor(outfit, { name = '', isPlayer = false, isRemote = false, isNPC = false } = {}) {
    this.isPlayer = isPlayer; this.isRemote = isRemote; this.isNPC = isNPC;
    this.name = name;
    this.root = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.grounded = false;
    this.swimming = false;
    this.ragdoll = false; this.ragT = 0; this.ragMin = 1.5; this.holdRag = false;
    this.phase = 0;
    this.ctrl = { mx: 0, mz: 0, run: false, jump: false, grab: false };
    this.punchT = 0; this.punchHit = false;
    this.emote = null; this.emoteT = 0;
    this.vehicle = null; this.seat = 0;
    this.held = null;       // {kind:'prop'|'char'|'remote', obj}
    this.grabbedBy = null;  // {point: Vector3, t}
    this.hose = false;
    this.fishing = false;
    this.p = POSE.map(() => new THREE.Vector3());
    this.v = POSE.map(() => new THREE.Vector3());
    this.prev = POSE.map(() => new THREE.Vector3());
    this.tgt = POSE.map(() => new THREE.Vector3());
    this.netP = null;
    this.rest = CONS.map(([a, b]) => Math.hypot(POSE[a][0] - POSE[b][0], POSE[a][1] - POSE[b][1], POSE[a][2] - POSE[b][2]));
    this.lastRight = new THREE.Vector3(1, 0, 0);
    this.buildMeshes();
    this.setOutfit(outfit);
    G.characters.push(this);
  }

  buildMeshes() {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.head = new THREE.Group();
    this.bodyMesh = mk(CAPS, mat('#fff'));
    this.bodyMesh.position.y = 0.32;
    this.body.add(this.bodyMesh);
    this.headMesh = mk(HEADG, mat('#fff'));
    this.head.add(this.headMesh);
    this.armL = mk(LIMB, mat('#fff'), 0.12, 1, 0.12);
    this.armR = mk(LIMB, mat('#fff'), 0.12, 1, 0.12);
    this.legL = mk(LIMB, mat('#fff'), 0.15, 1, 0.15);
    this.legR = mk(LIMB, mat('#fff'), 0.15, 1, 0.15);
    this.handL = mk(BALL, mat('#fff'), 0.15, 0.15, 0.15);
    this.handR = mk(BALL, mat('#fff'), 0.15, 0.15, 0.15);
    this.shoeL = mk(BALL, mat('#333'), 0.17, 0.12, 0.24);
    this.shoeR = mk(BALL, mat('#333'), 0.17, 0.12, 0.24);
    this.group.add(this.body, this.head, this.armL, this.armR, this.legL, this.legR, this.handL, this.handR, this.shoeL, this.shoeR);
    G.scene.add(this.group);
    // fishing rod & hose nozzle (hidden until used)
    this.rod = new THREE.Group();
    const stick = mk(LIMB, mat('#8b5a2b'), 0.03, 2.4, 0.03); stick.position.y = 1.2; this.rod.add(stick);
    this.rod.visible = false; this.group.add(this.rod);
    this.nozzle = mk(LIMB, mat('#e84a3f'), 0.09, 0.7, 0.09); this.nozzle.visible = false; this.group.add(this.nozzle);
  }

  setOutfit(o) {
    this.outfit = Object.assign({}, o);
    const skin = mat(o.skin), shirt = mat(o.shirt), pants = mat(o.pants);
    this.bodyMesh.material = shirt;
    this.headMesh.material = skin;
    this.armL.material = this.armR.material = shirt;
    this.handL.material = this.handR.material = skin;
    this.legL.material = this.legR.material = pants;
    if (this.hatObj) this.head.remove(this.hatObj);
    if (this.glassesObj) this.head.remove(this.glassesObj);
    if (this.faceObj) this.head.remove(this.faceObj);
    this.faceObj = makeFace(o.eyes); this.head.add(this.faceObj);
    this.hatObj = makeHat(o.hat); this.head.add(this.hatObj);
    this.glassesObj = makeGlasses(o.glasses); this.head.add(this.glassesObj);
  }

  setName(name) {
    this.name = name;
    if (this.tag) { G.scene.remove(this.tag); this.tag.material.map.dispose(); }
    this.tag = textSprite(name, { size: 40, scale: 1.1 });
    G.scene.add(this.tag);
  }

  place(x, y, z, facing = 0) {
    this.root.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.ragdoll = false;
    this.computeTargets(0);
    for (let i = 0; i < 7; i++) { this.p[i].copy(this.tgt[i]); this.v[i].set(0, 0, 0); this.prev[i].copy(this.tgt[i]); }
  }

  get pos() { return this.ragdoll ? this.p[PEL] : this.root; }
  handPoint(out) { return out.addVectors(this.p[HL], this.p[HR]).multiplyScalar(0.5); }
  fwd(out) { return out.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  // ---------------------------------------------------------------- ragdoll
  flop(impulse = null, minTime = 1.5) {
    if (this.vehicle) return;
    if (!this.ragdoll) {
      this.ragdoll = true; this.ragT = 0;
      const h = 1 / 60;
      for (let i = 0; i < 7; i++) this.prev[i].copy(this.p[i]).addScaledVector(this.v[i], -h).addScaledVector(this.vel, -h);
      this.ragMin = minTime;
      if (this.isPlayer || Math.random() < 0.5) sfx.ragdoll();
    } else this.ragMin = Math.max(this.ragMin, this.ragT + minTime * 0.6);
    if (impulse) {
      const h = 1 / 60;
      for (let i = 0; i < 7; i++) this.prev[i].addScaledVector(impulse, -h * (0.7 + Math.random() * 0.6));
    }
    if (this.held && this.onDrop) this.onDrop(false);
  }

  getUp() {
    this.ragdoll = false;
    const pel = this.p[PEL];
    this.root.set(pel.x, groundHeight(pel.x, pel.z, pel.y + 0.5), pel.z);
    if (this.root.y < WATER_Y - 1.5) this.root.y = Math.max(this.root.y, WATER_Y - 0.9);
    this.vel.set(0, 0, 0);
    _fwd.crossVectors(this.lastRight, UP);
    if (_fwd.lengthSq() > 0.01) this.facing = Math.atan2(_fwd.x, _fwd.z);
    for (let i = 0; i < 7; i++) this.v[i].subVectors(this.p[i], this.prev[i]).multiplyScalar(30);
  }

  ragdollStep(dt) {
    const h = Math.min(dt, 1 / 30);
    const g = -24 * h * h;
    this.ragT += dt;
    for (let i = 0; i < 7; i++) {
      const p = this.p[i], pr = this.prev[i];
      _a.subVectors(p, pr).multiplyScalar(0.992);
      pr.copy(p);
      p.add(_a); p.y += g;
    }
    if (this.grabbedBy) {
      const gp = this.grabbedBy.point;
      this.p[CHE].lerp(gp, 0.6);
      this.prev[CHE].lerp(this.p[CHE], 0.5);
      this.grabbedBy.t -= dt;
      if (this.grabbedBy.t <= 0) this.grabbedBy = null;
    }
    for (let it = 0; it < 6; it++) {
      for (let k = 0; k < CONS.length; k++) {
        const [a, b, loose] = CONS[k];
        const pa = this.p[a], pb = this.p[b];
        _a.subVectors(pb, pa);
        const d = _a.length() || 1e-4;
        const rest = this.rest[k];
        if (loose && d < rest * 1.4 && d > rest * 0.5) continue;
        const diff = (d - (loose ? clamp(d, rest * 0.5, rest * 1.4) : rest)) / d;
        const wa = INVM[a], wb = INVM[b], ws = wa + wb;
        pa.addScaledVector(_a, diff * wa / ws);
        pb.addScaledVector(_a, -diff * wb / ws);
      }
      for (let i = 0; i < 7; i++) this.collideParticle(i);
    }
  }

  collideParticle(i) {
    const p = this.p[i], pr = this.prev[i], r = RAD[i];
    _b.set(p.x, p.y - r, p.z);
    const hit = resolveWalls(_b, r, r * 2, 0.2);
    if (hit) { p.x = _b.x; p.z = _b.z; }
    const gh = groundHeight(p.x, p.z, p.y, 0.05);
    if (p.y - r < gh) {
      const tag = getGroundTag();
      const vy = p.y - pr.y;
      p.y = gh + r;
      if (tag === 'tramp' && vy < -0.05) { pr.y = p.y - 0.28; if (i === PEL) sfx.boing(); }
      else { pr.y = p.y + Math.max(0, vy) * 0; pr.x += (p.x - pr.x) * 0.18; pr.z += (p.z - pr.z) * 0.18; }
    }
    if (p.y < WATER_Y && baseHeight(p.x, p.z) < WATER_Y) {
      p.y += (WATER_Y + 0.1 - p.y) * 0.08;
      pr.lerp(p, 0.08);
    }
  }

  // ---------------------------------------------------------------- walking
  locomote(dt) {
    const c = this.ctrl;
    const mlen = Math.hypot(c.mx, c.mz);
    const speed = this.swimming ? 3.5 : c.run ? 8.5 : 5;
    const acc = this.grounded ? 32 : 9;
    const tx = c.mx * speed, tz = c.mz * speed;
    this.vel.x += clamp(tx - this.vel.x, -acc * dt, acc * dt);
    this.vel.z += clamp(tz - this.vel.z, -acc * dt, acc * dt);
    if (c.aim !== undefined && c.aim !== null) this.facing = angleLerp(this.facing, c.aim, 1 - Math.exp(-18 * dt));
    else if (mlen > 0.1 && !this.fishing) this.facing = angleLerp(this.facing, Math.atan2(c.mx, c.mz), 1 - Math.exp(-10 * dt));
    if (c.jump && this.grounded) {
      this.vel.y = this.swimming ? 6 : 8.2; this.grounded = false;
      if (this.isPlayer) sfx.jump();
    }
    c.jump = false;
    this.vel.y -= 24 * dt;
    const wasGrounded = this.grounded;
    const prevVy = this.vel.y;
    this.root.addScaledVector(this.vel, dt);
    resolveWalls(this.root, 0.45, 1.9);
    const gh = groundHeight(this.root.x, this.root.z, this.root.y);
    const tag = getGroundTag();
    this.swimming = false;
    if (gh < WATER_Y - 0.4 && this.root.y < WATER_Y - 0.9 + 0.05) {
      this.swimming = true;
      this.root.y += (WATER_Y - 0.9 - this.root.y) * Math.min(1, dt * 8);
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
      if (!wasGrounded && prevVy < -6 && this.isPlayer) sfx.splash();
    } else if (this.root.y <= gh || (wasGrounded && this.vel.y <= 0 && this.root.y - gh < 0.45)) {
      if (tag === 'tramp' && prevVy < -3) {
        this.root.y = gh; this.vel.y = clamp(-prevVy * 0.95 + 3, 11, 24); this.grounded = false;
        sfx.boing();
      } else {
        if (!wasGrounded && prevVy < -21) { this.root.y = gh; this.flop(null, 1.5); return; }
        if (!wasGrounded && prevVy < -7 && this.isPlayer) sfx.land();
        this.root.y = gh; this.vel.y = 0; this.grounded = true;
      }
    } else this.grounded = false;
    if (this.root.y < -30 || Math.abs(this.root.x) > 900 || Math.abs(this.root.z) > 900) this.respawn && this.respawn();
  }

  computeTargets(dt) {
    const f = this.facing;
    const fx = Math.sin(f), fz = Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
    const R = this.root;
    const T = (i, lx, ly, lz) => this.tgt[i].set(R.x + rx * lx + fx * lz, R.y + ly, R.z + rz * lx + fz * lz);
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (this.vehicle ? 0 : Math.max(spd, 0.0) * 2.3);
    const s = Math.sin(this.phase), co = Math.cos(this.phase);
    const amp = Math.min(1, spd / 5) * 0.38;
    const lean = clamp(spd * 0.025, 0, 0.25);
    const bob = Math.abs(s) * 0.09 * Math.min(1, spd / 3);
    this.emoteT += dt;
    if (this.vehicle) {
      const scooter = this.vehicle.type.open;
      T(PEL, 0, 0.55, 0); T(CHE, 0, 1.05, 0.05); T(HEAD, 0, 1.75, 0.1);
      T(FL, -0.25, scooter ? 0.3 : 0.45, 0.6); T(FR, 0.25, scooter ? 0.3 : 0.45, 0.6);
      if (this.seat === 0) { T(HL, -0.3, 1.1, 0.6); T(HR, 0.3, 1.1, 0.6); }
      else { T(HL, -0.5, 0.8, 0.2); T(HR, 0.5, 0.8, 0.2); }
      return;
    }
    T(PEL, 0, 0.75 + bob, 0);
    T(CHE, 0, 1.25 + bob, lean * 0.8);
    T(HEAD, 0, 1.95 + bob, lean * 1.3);
    if (!this.grounded && !this.swimming) {
      T(FL, -0.24, 0.3, 0.12); T(FR, 0.24, 0.3, -0.08);
      T(HL, -0.65, 1.55, 0); T(HR, 0.65, 1.55, 0);
    } else {
      T(FL, -0.22, 0.12 + Math.max(0, co) * 0.28 * Math.min(1, spd / 3), s * amp);
      T(FR, 0.22, 0.12 + Math.max(0, -co) * 0.28 * Math.min(1, spd / 3), -s * amp);
      T(HL, -0.55, 0.95, -s * amp * 0.9);
      T(HR, 0.55, 0.95, s * amp * 0.9);
    }
    if (this.swimming) {
      const t = this.emoteT * 6;
      T(HL, -0.6, 1.6 + Math.sin(t) * 0.3, 0.4 + Math.cos(t) * 0.3);
      T(HR, 0.6, 1.6 + Math.sin(t + Math.PI) * 0.3, 0.4 + Math.cos(t + Math.PI) * 0.3);
    }
    if (this.emote && spd < 0.5) {
      const t = this.emoteT;
      if (this.emote === 'wave') { T(HR, 0.55, 2.3, 0.1 + Math.sin(t * 10) * 0.25); }
      else if (this.emote === 'dance') {
        const b = Math.abs(Math.sin(t * 6)) * 0.25;
        T(PEL, Math.sin(t * 3) * 0.2, 0.75 + b, 0); T(CHE, Math.sin(t * 3) * 0.3, 1.25 + b, 0); T(HEAD, Math.sin(t * 3 + 0.5) * 0.35, 1.95 + b, 0);
        T(HL, -0.6, 1.4 + Math.sin(t * 6) * 0.6, 0.2); T(HR, 0.6, 1.4 - Math.sin(t * 6) * 0.6, 0.2);
      } else if (this.emote === 'cheer') {
        const b = Math.abs(Math.sin(t * 8)) * 0.3;
        T(HL, -0.5, 2.5 + b, 0); T(HR, 0.5, 2.5 + b, 0); T(PEL, 0, 0.75 + b * 0.5, 0);
      } else if (this.emote === 'sit') {
        T(PEL, 0, 0.35, -0.1); T(CHE, 0, 0.9, -0.1); T(HEAD, 0, 1.6, 0);
        T(FL, -0.25, 0.2, 0.6); T(FR, 0.25, 0.2, 0.6); T(HL, -0.5, 0.4, 0.1); T(HR, 0.5, 0.4, 0.1);
      }
    } else if (spd > 0.5) this.emote = null;
    if (this.fishing) { T(HL, -0.15, 1.2, 0.55); T(HR, 0.15, 1.25, 0.6); }
    if (this.weapon && !this.ctrl.grab && !this.swimming) { T(HR, 0.22, 1.3, 0.65); T(HL, -0.05, 1.25, 0.7); }
    if (this.ctrl.grab) {
      const up = this.held && this.held.kind !== 'prop' ? 1.9 : 1.45;
      T(HL, -0.3, up, 0.85); T(HR, 0.3, up, 0.85);
    }
    if (this.punchT > 0) {
      const k = Math.sin((1 - this.punchT / 0.3) * Math.PI);
      T(HR, 0.25 - k * 0.2, 1.45, 0.3 + k * 1.1);
    }
  }

  springStep(dt) {
    const n = Math.max(2, Math.ceil(dt * 150)), h = dt / n;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 7; i++) {
        let k = K0[i], c = C0[i];
        if ((i === HL || i === HR) && (this.ctrl.grab || this.punchT > 0 || this.vehicle || this.fishing || this.emote || this.weapon)) { k = 420; c = 30; }
        if (this.vehicle) { k *= 2; c *= 1.5; }
        const p = this.p[i], v = this.v[i], t = this.tgt[i];
        v.x += ((t.x - p.x) * k - v.x * c) * h;
        v.y += ((t.y - p.y) * k - v.y * c) * h;
        v.z += ((t.z - p.z) * k - v.z * c) * h;
        p.addScaledVector(v, h);
      }
    }
  }

  update(dt) {
    if (this.isRemote) { this.updateRemote(dt); this.render(); return; }
    if (this.punchT > 0) this.punchT -= dt;
    if (this.ragdoll) {
      this.ragdollStep(dt);
      if (this.ragT > this.ragMin && !this.holdRag && !this.grabbedBy) {
        _a.subVectors(this.p[PEL], this.prev[PEL]);
        if (_a.length() / Math.min(dt, 1 / 30) < 2.5) this.getUp();
      }
      if (this.p[PEL].y < -30) this.respawn && this.respawn();
    } else {
      const ox = this.root.x, oy = this.root.y, oz = this.root.z;
      if (this.vehicle) this.vehicle.seatPos(this.seat, this.root), this.facing = this.vehicle.yaw;
      else this.locomote(dt);
      if (this.ragdoll) { this.render(); return; }
      // carry part of the motion so fast movement doesn't stretch the body, the rest becomes wobble
      const carry = this.vehicle ? 1 : 0.8;
      _a.set(this.root.x - ox, this.root.y - oy, this.root.z - oz).multiplyScalar(carry);
      if (_a.lengthSq() > 25) _a.set(this.root.x - ox, this.root.y - oy, this.root.z - oz);
      for (let i = 0; i < 7; i++) this.p[i].add(_a);
      this.computeTargets(dt);
      this.springStep(dt);
    }
    this.render();
  }

  updateRemote(dt) {
    if (!this.netP) return;
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < 7; i++) {
      const d = this.p[i].distanceToSquared(this.netP[i]);
      if (d > 100) this.p[i].copy(this.netP[i]); else this.p[i].lerp(this.netP[i], k);
    }
    this.facing = angleLerp(this.facing, this.netFacing || 0, k);
    this.root.copy(this.p[PEL]);
  }

  render() {
    const P = this.p;
    // basis
    _up.subVectors(P[HEAD], P[PEL]);
    if (_up.lengthSq() < 1e-6) _up.set(0, 1, 0);
    _up.normalize();
    if (this.ragdoll || this.isRemote && this.netRag) {
      _right.subVectors(P[FR], P[FL]).add(_c.subVectors(P[HR], P[HL]));
      _right.addScaledVector(_up, -_right.dot(_up));
      if (_right.lengthSq() < 0.01) _right.copy(this.lastRight); else _right.normalize();
      _right.lerp(this.lastRight, 0.5).normalize();
    } else {
      _fwd.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      _right.crossVectors(_up, _fwd).normalize();
    }
    this.lastRight.copy(_right);
    _fwd.crossVectors(_right, _up).normalize();
    _mtx.makeBasis(_right, _up, _fwd);
    this.body.position.copy(P[PEL]);
    this.body.quaternion.setFromRotationMatrix(_mtx);
    // head basis uses chest->head
    _c.subVectors(P[HEAD], P[CHE]).normalize();
    _d.crossVectors(_c, _fwd).normalize();
    _b.crossVectors(_d, _c);
    _mtx.makeBasis(_d, _c, _b);
    this.head.position.copy(P[HEAD]);
    this.head.quaternion.setFromRotationMatrix(_mtx);
    // limbs
    _a.copy(P[CHE]).addScaledVector(_right, -0.4).addScaledVector(_up, 0.1);
    placeBetween(this.armL, _a, P[HL]);
    _a.copy(P[CHE]).addScaledVector(_right, 0.4).addScaledVector(_up, 0.1);
    placeBetween(this.armR, _a, P[HR]);
    _a.copy(P[PEL]).addScaledVector(_right, -0.2).addScaledVector(_up, -0.1);
    placeBetween(this.legL, _a, P[FL]);
    _a.copy(P[PEL]).addScaledVector(_right, 0.2).addScaledVector(_up, -0.1);
    placeBetween(this.legR, _a, P[FR]);
    this.handL.position.copy(P[HL]); this.handR.position.copy(P[HR]);
    this.shoeL.position.copy(P[FL]); this.shoeR.position.copy(P[FR]);
    this.shoeL.quaternion.copy(this.body.quaternion); this.shoeR.quaternion.copy(this.body.quaternion);
    this.shoeL.position.addScaledVector(_fwd, 0.08); this.shoeR.position.addScaledVector(_fwd, 0.08);
    // spinning propeller hat
    const pr = this.hatObj && this.hatObj.children.find(c => c.userData.spin);
    if (pr) pr.rotation.y += 0.3 + Math.min(1, this.vel.length() / 5) * 0.5;
    // tools
    this.rod.visible = this.fishing;
    if (this.fishing) { this.rod.position.copy(P[HR]); this.rod.rotation.set(0.9, this.facing, 0, 'YXZ'); }
    this.nozzle.visible = this.hose && this.ctrl.grab;
    if (this.nozzle.visible) {
      _a.copy(P[HR]).addScaledVector(_fwd, 0.5);
      placeBetween(this.nozzle, P[HR], _a); this.nozzle.scale.y = 0.7;
    }
    if (this.tag) this.tag.position.set(P[HEAD].x, P[HEAD].y + 0.95, P[HEAD].z);
  }

  destroy() {
    G.scene.remove(this.group);
    if (this.tag) G.scene.remove(this.tag);
    const i = G.characters.indexOf(this);
    if (i >= 0) G.characters.splice(i, 1);
  }

  // network snapshot of body parts (rounded to cm)
  snapshot() {
    const a = [];
    for (let i = 0; i < 7; i++) a.push(Math.round(this.p[i].x * 100) / 100, Math.round(this.p[i].y * 100) / 100, Math.round(this.p[i].z * 100) / 100);
    return a;
  }
  applySnapshot(a, facing, rag) {
    if (!this.netP) {
      this.netP = POSE.map(() => new THREE.Vector3());
      for (let i = 0; i < 7; i++) this.p[i].set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
    }
    for (let i = 0; i < 7; i++) this.netP[i].set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
    this.netFacing = facing; this.netRag = rag;
  }
}

// ---------------------------------------------------------------- NPCs
export function updateNPC(n, dt) {
  const c = n.ctrl;
  if (n.ragdoll || n.vehicle) { c.mx = c.mz = 0; return; }
  if (n.passengerFor) { c.mx = c.mz = 0; n.emote = 'wave'; return; }
  if (!n.goal || n.wait > 0) {
    n.wait = (n.wait || 0) - dt;
    c.mx = c.mz = 0;
    if (n.wait <= 0) {
      const sw = G.locations.sidewalks;
      const here = n.goal || n.root;
      const opts = sw.filter(p => { const d = Math.hypot(p.x - here.x, p.z - here.z); return d > 3 && d < 50; });
      n.goal = opts.length ? pick(opts) : pick(sw);
      n.stuck = 0; n.wait = 0;
      n.lastD = 1e9;
    }
    return;
  }
  const dx = n.goal.x - n.root.x, dz = n.goal.z - n.root.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.2) { n.goal = { x: n.goal.x, z: n.goal.z, done: true }; n.wait = Math.random() < 0.3 ? rand(2, 6) : 0.01; if (Math.random() < 0.15) { n.emote = pick(['wave', 'dance', 'cheer']); n.emoteT = 0; } return; }
  c.mx = dx / d * 0.55; c.mz = dz / d * 0.55;
  n.stuck += dt;
  if (n.stuck > 1.5) { if (d > n.lastD - 1) { n.goal = null; n.wait = 0.2; } n.lastD = d; n.stuck = 0; }
  // occasionally hop
  if (Math.random() < dt * 0.05) c.jump = true;
}
