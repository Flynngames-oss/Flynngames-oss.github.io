// The surfer: a wobbly verlet ragdoll that is pulled toward animated poses while riding,
// and goes fully limp (and tumbles in the whitewater) when you wipe out. Plus the board.
import * as THREE from 'three';

const V3 = THREE.Vector3;
// particle indices
export const J = { pelvis: 0, chest: 1, neck: 2, head: 3, lSh: 4, lEl: 5, lHa: 6, rSh: 7, rEl: 8, rHa: 9, lHip: 10, lKn: 11, lFt: 12, rHip: 13, rKn: 14, rFt: 15 };
const NP = 16;
const LEN = { torso: 0.42, neck: 0.16, head: 0.2, sh: 0.19, ua: 0.29, fa: 0.27, hip: 0.1, th: 0.44, sn: 0.44 };
const RAD = [0.14, 0.15, 0.06, 0.13, 0.07, 0.055, 0.05, 0.07, 0.055, 0.05, 0.08, 0.07, 0.06, 0.08, 0.07, 0.06];

// skins = the rubbery body colour, vests = Hawaiian shirt, hair = bucket hat
export const LOOKS = {
  skins: ['#ff6a1c', '#ffb02e', '#3fb8ff', '#7bd64a', '#ff5fa2', '#b07cff', '#f1c7a0', '#8a5634'],
  vests: ['#1aa7e0', '#ff3d6e', '#ffd23d', '#2ecc71', '#ff7a1f', '#b06bff', '#ffffff', '#16181d'],
  shorts: ['#2b3150', '#c0392b', '#16181d', '#ffb21f', '#00a37a', '#1f3cff'],
  hair: ['#8f9152', '#d9c48f', '#2b3150', '#ff3d6e', '#ffffff', '#16181d'],
  boards: ['#ffd21f', '#ffffff', '#1ec8ff', '#ff3d6e', '#7dff5a', '#16181d'],
};

// canvas textures: Hawaiian shirt and patterned board shorts
const texCache = new Map();
function shirtTexture(base) {
  const key = 'shirt' + base;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  const petals = ['#ffd23d', '#ff4f8b', '#ffffff', '#ff8a1f', '#ffd23d'];
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const cx = r() * 256, cy = r() * 256, s = 10 + r() * 14;
    // leaves
    x.fillStyle = '#1e8f4e';
    for (let k = 0; k < 3; k++) { const a = r() * 6.28; x.beginPath(); x.ellipse(cx + Math.cos(a) * s * 1.2, cy + Math.sin(a) * s * 1.2, s * 0.9, s * 0.35, a, 0, 6.28); x.fill(); }
    // hibiscus
    x.fillStyle = petals[i % petals.length];
    for (let k = 0; k < 5; k++) { const a = k / 5 * 6.28 + r(); x.beginPath(); x.ellipse(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.55, s * 0.38, a, 0, 6.28); x.fill(); }
    x.fillStyle = '#c0392b'; x.beginPath(); x.arc(cx, cy, s * 0.22, 0, 6.28); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1);
  texCache.set(key, t); return t;
}
function shortsTexture(base) {
  const key = 'shorts' + base;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  const hi = new THREE.Color(base).offsetHSL(0.45, 0.1, 0.25).getStyle();
  for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? hi : '#ffd23d'; x.fillRect(i * 22, 0, 7, 128); }
  x.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 40; i++) { x.beginPath(); x.arc((i * 37) % 128, (i * 53) % 128, 4, 0, 6.28); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1);
  texCache.set(key, t); return t;
}
export let ENV_MAP = null;
export function setEnvMap(t) { ENV_MAP = t; }

// ---------------------------------------------------------------------------
export function makeBoard(color = '#ffffff', length = 1.95) {
  const L = length, W = 0.52, TH = 0.07;
  const NL = 28, NR = 14;
  const pos = [], col = [], idx = [];
  const base = new THREE.Color(color), stringer = new THREE.Color('#ff7a1f');
  // nose and tail in a contrasting colour (yellow board -> cyan ends), orange pinstripes
  const ends = base.getHSL({}).l > 0.85 || base.getHSL({}).s < 0.15 ? new THREE.Color('#1ec8ff') : new THREE.Color(color).offsetHSL(0.42, 0.1, 0.05);
  const stripe = new THREE.Color('#ff7a1f'), bottom = ends.clone().multiplyScalar(0.8);
  for (let i = 0; i <= NL; i++) {
    const t = i / NL; // 0 nose .. 1 tail
    const z = -L / 2 + t * L;
    let w = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.75) * 0.93 + 0.04)), 0.62) * W / 2;
    if (t > 0.9) w = Math.max(w, W * 0.17);
    const rock = Math.pow(1 - t, 3.2) * 0.2 + Math.pow(t, 4) * 0.04;
    const th = TH * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)));
    for (let r = 0; r < NR; r++) {
      const a = r / NR * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = ca * w;
      const y = rock + (sa > 0 ? sa * th * 0.75 : sa * th * 0.3);
      pos.push(x, y, z);
      let c = bottom;
      if (sa > 0.05) {
        const cut = t + x * 0.5; // diagonal colour split like a retro board
        c = cut < 0.24 || cut > 0.8 ? ends : base;
        if (Math.abs(cut - 0.24) < 0.018 || Math.abs(cut - 0.8) < 0.018) c = stripe;
        if (sa > 0.92 && Math.abs(x) < 0.01 && cut > 0.26 && cut < 0.78) c = stringer;
      }
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NL; i++) for (let r = 0; r < NR; r++) {
    const a = i * NR + r, b = i * NR + (r + 1) % NR, c = (i + 1) * NR + r, d = (i + 1) * NR + (r + 1) % NR;
    idx.push(a, b, c, b, d, c);
  }
  // caps
  const capN = pos.length / 3; pos.push(0, 0.2, -L / 2 - 0.001); col.push(base.r, base.g, base.b);
  const capT = pos.length / 3; pos.push(0, 0.04, L / 2 + 0.001); col.push(base.r, base.g, base.b);
  for (let r = 0; r < NR; r++) { idx.push(capN, (r + 1) % NR, r); idx.push(capT, NL * NR + r, NL * NR + (r + 1) % NR); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const grp = new THREE.Group();
  const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.25, envMap: ENV_MAP, envMapIntensity: 0.25 }));
  grp.add(m);
  // thruster fins
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.11, 0); fs.quadraticCurveTo(0.02, -0.05, -0.03, -0.12); fs.lineTo(0, 0);
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.008, bevelEnabled: false });
  fg.rotateY(Math.PI / 2);
  const fm = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.4 });
  for (const [x, z, ry] of [[0, L / 2 - 0.08, 0], [-0.17, L / 2 - 0.3, 0.07], [0.17, L / 2 - 0.3, -0.07]]) {
    const f = new THREE.Mesh(fg, fm); f.position.set(x, 0.03, z); f.rotation.y = ry; grp.add(f);
  }
  grp.userData.length = L;
  return grp;
}

// ---------------------------------------------------------------------------
// poses (board-local coordinates: x = right rail, y = up from deck, z = toward tail)
// ---------------------------------------------------------------------------
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();
function ik(out, A, T, l1, l2, pole, endOut) {
  _a.subVectors(T, A);
  let d = _a.length();
  const maxd = (l1 + l2) * 0.999;
  if (d < 1e-5) { _a.set(0, -1, 0); d = 1e-5; } else _a.multiplyScalar(1 / d);
  d = Math.min(d, maxd);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(1, 0, 0);
  _b.normalize();
  out.copy(A).addScaledVector(_a, a).addScaledVector(_b, h);
  if (endOut) endOut.copy(A).addScaledVector(_a, d);
}

const POLE_KNEE = new V3(1, 0.1, 0), POLE_ELBOW = new V3(-0.3, -1, 0.2);
export function poseStand(o, p) {
  const c = p.c, lean = p.lean || 0, t = p.t || 0, wob = p.wob || 0;
  const pelH = 0.98 - 0.38 * c;
  o[J.lFt].set(0, 0.08, -0.3); o[J.rFt].set(0, 0.08, 0.4);
  const px = 0.05 * c + lean * 0.22;
  o[J.pelvis].set(px, pelH, 0.05);
  o[J.lHip].set(px, pelH, -0.05); o[J.rHip].set(px, pelH, 0.15);
  ik(o[J.lKn], o[J.lHip], o[J.lFt], LEN.th, LEN.sn, POLE_KNEE);
  ik(o[J.rKn], o[J.rHip], o[J.rFt], LEN.th, LEN.sn, _c.set(1, 0.1, 0.25));
  // torso leans forward (toward +x) when crouching, sideways with lean
  const fwd = 0.18 + 0.55 * c + (p.tilt || 0);
  _d.set(Math.sin(fwd) + lean * 0.25, Math.cos(fwd), (p.twist || 0) * 0.1).normalize();
  o[J.chest].copy(o[J.pelvis]).addScaledVector(_d, LEN.torso);
  o[J.neck].copy(o[J.chest]).addScaledVector(_d, LEN.neck);
  o[J.head].copy(o[J.neck]).addScaledVector(_d, LEN.head);
  o[J.head].x += 0.04;
  const tw = (p.twist || 0) * 0.6;
  o[J.lSh].set(o[J.chest].x - Math.sin(tw) * LEN.sh, o[J.chest].y + 0.04, o[J.chest].z - Math.cos(tw) * LEN.sh);
  o[J.rSh].set(o[J.chest].x + Math.sin(tw) * LEN.sh, o[J.chest].y + 0.04, o[J.chest].z + Math.cos(tw) * LEN.sh);
  // arms out for balance; they wave around with the wobble
  const ay = o[J.chest].y;
  const s1 = Math.sin(t * 2.3) * 0.06 * (1 + wob) + Math.sin(t * 5.1) * 0.02 * wob, s2 = Math.cos(t * 1.9) * 0.06 * (1 + wob);
  _c.set(0.2 + lean * 0.2 + s1 * 2, ay + 0.28 + lean * 0.25 + s2 * 2.5 + (p.armUp || 0), -0.55);
  ik(o[J.lEl], o[J.lSh], _c, LEN.ua, LEN.fa, POLE_ELBOW, o[J.lHa]);
  if (p.grab) {
    _c.set(0.24, 0.12, 0.12); // grab the rail
    ik(o[J.rEl], o[J.rSh], _c, LEN.ua, LEN.fa, _d.set(1, 0, 0.5), o[J.rHa]);
  } else {
    _c.set(0.28 - lean * 0.15 - s2 * 2, ay - 0.12 - lean * 0.2 + s1 * 2 + (p.armUp || 0) * 0.6, 0.62);
    ik(o[J.rEl], o[J.rSh], _c, LEN.ua, LEN.fa, POLE_ELBOW, o[J.rHa]);
  }
}

export function poseLie(o, p) {
  const ph = p.paddle || 0, amt = p.paddleAmt || 0;
  o[J.pelvis].set(0, 0.2, 0.3);
  o[J.chest].set(0, 0.25 + 0.05 * amt, -0.12);
  o[J.neck].set(0, 0.31 + 0.05 * amt, -0.27);
  o[J.head].set(0, 0.43 + 0.04 * amt, -0.42);
  o[J.lSh].set(-0.19, 0.27, -0.16); o[J.rSh].set(0.19, 0.27, -0.16);
  o[J.lHip].set(-0.1, 0.2, 0.32); o[J.rHip].set(0.1, 0.2, 0.32);
  o[J.lKn].set(-0.12, 0.2, 0.76); o[J.rKn].set(0.12, 0.2, 0.76);
  o[J.lFt].set(-0.13, 0.32 + Math.max(0, Math.sin(ph * 2)) * 0.08 * amt, 1.18); o[J.rFt].set(0.13, 0.32 + Math.max(0, -Math.sin(ph * 2)) * 0.08 * amt, 1.18);
  for (const [sh, el, ha, side, off] of [[J.lSh, J.lEl, J.lHa, -1, 0], [J.rSh, J.rEl, J.rHa, 1, Math.PI]]) {
    const a = ph + off;
    _c.set(side * (0.32 + 0.06 * amt), 0.12 - 0.42 * amt * Math.max(0, Math.sin(a)) - 0.05, -0.32 + 0.38 * amt * Math.cos(a));
    if (amt < 0.05) _c.set(side * 0.3, 0.12, -0.1);
    ik(o[el], o[sh], _c, LEN.ua, LEN.fa, _d.set(side, 0.6, 0.2), o[ha]);
  }
}

export function poseSit(o, p) {
  const t = p.t || 0;
  o[J.pelvis].set(0, 0.14, 0.25);
  o[J.chest].set(0, 0.56, 0.22 + Math.sin(t * 0.7) * 0.03);
  o[J.neck].set(0, 0.72, 0.2);
  o[J.head].set(0, 0.92, 0.17);
  o[J.lSh].set(-0.19, 0.6, 0.22); o[J.rSh].set(0.19, 0.6, 0.22);
  o[J.lHip].set(-0.1, 0.14, 0.27); o[J.rHip].set(0.1, 0.14, 0.27);
  o[J.lKn].set(-0.34, -0.06, 0.05); o[J.rKn].set(0.34, -0.06, 0.05);
  o[J.lFt].set(-0.36, -0.48, 0.12 + Math.sin(t * 1.3) * 0.08); o[J.rFt].set(0.36, -0.48, 0.12 - Math.sin(t * 1.3) * 0.08);
  _c.set(-0.27, 0.08, 0.0); ik(o[J.lEl], o[J.lSh], _c, LEN.ua, LEN.fa, _d.set(-1, 0, 0.3), o[J.lHa]);
  _c.set(0.27, 0.08, 0.0); ik(o[J.rEl], o[J.rSh], _c, LEN.ua, LEN.fa, _d.set(1, 0, 0.3), o[J.rHa]);
}

// ---------------------------------------------------------------------------
// rubber-toy look: glossy skin, printed shirt and shorts, bucket hat
export function makeMaterials(look) {
  const env = { envMap: ENV_MAP, envMapIntensity: 0.3 };
  return {
    skin: new THREE.MeshPhysicalMaterial({ color: look.skin, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(look.skin).offsetHSL(0, 0, 0.2), ...env }),
    shirt: new THREE.MeshStandardMaterial({ map: shirtTexture(look.vest), roughness: 0.7, ...env }),
    shorts: new THREE.MeshStandardMaterial({ map: shortsTexture(look.shorts), roughness: 0.65, ...env }),
    hat: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.95, side: THREE.DoubleSide, ...env }),
    band: new THREE.MeshStandardMaterial({ color: '#6b3fa0', roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.3 }),
  };
}

// head: a tall rubbery bean, two dot eyes, a straight little mouth and a bucket hat. Eyes look along -z.
export function makeHead(M) {
  const head = new THREE.Group();
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 18), M.skin);
  hd.scale.set(0.95, 1.18, 0.95);
  head.add(hd);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), M.dark);
    e.scale.set(1, 1.3, 0.6);
    e.position.set(sx * 0.052, 0.035, -0.138); head.add(e);
  }
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.05, 3, 6), M.dark);
  mouth.rotation.z = Math.PI / 2; mouth.position.set(0.004, -0.045, -0.142); head.add(mouth);
  // bucket hat, tipped back a little
  const hat = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.155, 0.12, 24, 1, false), M.hat);
  crown.position.y = 0.14;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.hat);
  top.scale.y = 0.35; top.position.y = 0.2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.153, 0.157, 0.03, 24, 1, true), M.band);
  band.position.y = 0.1;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.26, 0.07, 28, 1, true), M.hat);
  brim.position.y = 0.055;
  hat.add(crown, top, band, brim);
  hat.rotation.x = 0.22; hat.position.set(0, 0.02, 0.02);
  head.add(hat);
  return head;
}

const STICKS = [
  [J.pelvis, J.chest], [J.chest, J.neck], [J.neck, J.head], [J.chest, J.lSh], [J.chest, J.rSh], [J.lSh, J.rSh],
  [J.lSh, J.lEl], [J.lEl, J.lHa], [J.rSh, J.rEl], [J.rEl, J.rHa], [J.pelvis, J.lHip], [J.pelvis, J.rHip], [J.lHip, J.rHip],
  [J.lHip, J.lKn], [J.lKn, J.lFt], [J.rHip, J.rKn], [J.rKn, J.rFt],
  // stiffeners
  [J.lSh, J.pelvis], [J.rSh, J.pelvis], [J.neck, J.lSh], [J.neck, J.rSh], [J.chest, J.lHip], [J.chest, J.rHip], [J.head, J.chest],
];
const STIFF = [0.3, 0.24, 0.2, 0.13, 0.22, 0.13, 0.08, 0.22, 0.13, 0.08, 0.36, 0.42, 1, 0.36, 0.42, 1];

export class Ragdoll {
  constructor(scene, look) {
    this.P = []; this.O = []; this.T = []; this.L = [];
    for (let i = 0; i < NP; i++) { this.P.push(new V3()); this.O.push(new V3()); this.T.push(new V3()); this.L.push(new V3()); }
    this.rest = [];
    this.limp = false;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.board = makeBoard(look.board, look.boardLen || 1.95);
    scene.add(this.board);
    // board particles for ragdoll mode: nose, tail, right rail
    this.B = [new V3(), new V3(), new V3()]; this.BO = [new V3(), new V3(), new V3()];
    this.build(look);
    // leash
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    this.leash = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x111111 }));
    this.leash.frustumCulled = false;
    scene.add(this.leash);
    // rest lengths from a standing pose
    const tmp = Array.from({ length: NP }, () => new V3());
    poseStand(tmp, { c: 0.3 });
    this.rest = STICKS.map(([a, b]) => tmp[a].distanceTo(tmp[b]));
  }

  build(look) {
    this.group.clear();
    const M = makeMaterials(look);
    const caps = [];
    const seg = (a, b, r, mat, len) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len), 6, 14), mat);
      this.group.add(m); caps.push({ m, a, b }); return m;
    };
    const tmp = Array.from({ length: NP }, () => new V3());
    poseStand(tmp, { c: 0.3 });
    const d = (a, b) => tmp[a].distanceTo(tmp[b]);
    // noodle body: shirt on the torso & shoulders, shorts on the hips & thighs, rubbery skin everywhere else
    seg(J.pelvis, J.neck, 0.16, M.shirt, d(J.pelvis, J.neck) - 0.12);
    seg(J.lSh, J.rSh, 0.105, M.shirt, d(J.lSh, J.rSh));
    seg(J.lHip, J.rHip, 0.14, M.shorts, d(J.lHip, J.rHip) + 0.05);
    seg(J.lSh, J.lEl, 0.072, M.skin, d(J.lSh, J.lEl)); seg(J.rSh, J.rEl, 0.072, M.skin, d(J.rSh, J.rEl));
    seg(J.lEl, J.lHa, 0.066, M.skin, d(J.lEl, J.lHa)); seg(J.rEl, J.rHa, 0.066, M.skin, d(J.rEl, J.rHa));
    seg(J.lHip, J.lKn, 0.098, M.shorts, d(J.lHip, J.lKn)); seg(J.rHip, J.rKn, 0.098, M.shorts, d(J.rHip, J.rKn));
    seg(J.lKn, J.lFt, 0.078, M.skin, d(J.lKn, J.lFt) - 0.06); seg(J.rKn, J.rFt, 0.078, M.skin, d(J.rKn, J.rFt) - 0.06);
    this.caps = caps;
    const mitt = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), M.skin); m.scale.set(1, 1.15, 0.8); this.group.add(m); return m; };
    this.hands = [mitt(), mitt()];
    const foot = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), M.skin); m.scale.set(0.95, 0.55, 1.6); return m; };
    this.feet = [foot(), foot()];
    this.group.add(...this.feet);
    this.head = makeHead(M);
    this.group.add(this.head);
    this.group.traverse((o) => { o.frustumCulled = false; });
  }

  setLook(look) {
    this.build(look);
    const parent = this.board.parent;
    parent.remove(this.board);
    this.board = makeBoard(look.board, look.boardLen || 1.95);
    parent.add(this.board);
  }

  // place every particle on its pose target instantly
  snap(boardMat, poseFn, p) {
    poseFn(this.L, p);
    for (let i = 0; i < NP; i++) { this.P[i].copy(this.L[i]).applyMatrix4(boardMat); this.O[i].copy(this.P[i]); }
    this.limp = false;
  }

  // active (animated) mode: particles chase pose targets with springs → natural wobble
  active(dt, boardMat, poseFn, p, blendFn, blend, stiffMul = 1) {
    poseFn(this.L, p);
    if (blendFn) {
      const tmp = this._tmp || (this._tmp = Array.from({ length: NP }, () => new V3()));
      blendFn(tmp, p);
      for (let i = 0; i < NP; i++) this.L[i].lerp(tmp[i], blend);
    }
    for (let i = 0; i < NP; i++) this.T[i].copy(this.L[i]).applyMatrix4(boardMat);
    const damp = 0.9;
    for (let i = 0; i < NP; i++) {
      const P = this.P[i], O = this.O[i];
      const vx = (P.x - O.x) * damp, vy = (P.y - O.y) * damp, vz = (P.z - O.z) * damp;
      O.copy(P);
      P.x += vx; P.y += vy - 9.8 * dt * dt * 0.3; P.z += vz;
      const k = Math.min(1, STIFF[i] * stiffMul * (dt * 120));
      P.lerp(this.T[i], k);
    }
    this.solve(3);
    // feet stay glued to the board
    if (stiffMul > 0.5) { this.P[J.lFt].copy(this.T[J.lFt]); this.P[J.rFt].copy(this.T[J.rFt]); }
    this.limp = false;
  }

  solve(iter) {
    const P = this.P;
    for (let it = 0; it < iter; it++) {
      for (let s = 0; s < STICKS.length; s++) {
        const [a, b] = STICKS[s];
        const pa = P[a], pb = P[b];
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const k = (d - this.rest[s]) / d * 0.5 * (s >= 17 ? 0.35 : 1);
        pa.x += dx * k; pa.y += dy * k; pa.z += dz * k;
        pb.x -= dx * k; pb.y -= dy * k; pb.z -= dz * k;
      }
    }
  }

  // start the limp ragdoll, keeping current velocities, and give the board its own body
  goLimp(boardMat, vel, boardLen) {
    this.limp = true;
    const nose = new V3(0, 0.05, -boardLen / 2), tail = new V3(0, 0.05, boardLen / 2), rail = new V3(0.26, 0.05, 0);
    [nose, tail, rail].forEach((p, i) => { this.B[i].copy(p).applyMatrix4(boardMat); this.BO[i].copy(this.B[i]).addScaledVector(vel, -1 / 120); });
    this.bLen = [boardLen, Math.hypot(0.26, boardLen / 2), Math.hypot(0.26, boardLen / 2)];
  }

  // limp simulation in the water
  limpStep(dt, waves, env) {
    const P = this.P, O = this.O, g = 9.8 * dt * dt;
    const cx = P[J.pelvis].x, cy = P[J.pelvis].y, cz = P[J.pelvis].z;
    for (let i = 0; i < NP; i++) {
      const p = P[i], o = O[i];
      let vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z;
      o.copy(p);
      const hw = waves.height(p.x, p.z);
      const depth = hw - p.y + RAD[i];
      let ax = 0, ay = -9.8, az = 0;
      if (depth > 0) {
        const dd = Math.min(depth, 1.2);
        ay += 13.5 * dd / 1.2 + 2;
        const drag = Math.exp(-dt * 3.2);
        vx *= drag; vy *= drag; vz *= drag;
        if (env.foam > 0.15) {
          // washing-machine tumble: pushed to shore and spun around the along-shore axis
          const f = Math.min(1.5, env.foam);
          ax += env.d.x * 7 * f; az += env.d.z * 7 * f;
          const rx = p.x - cx, ry = p.y - cy, rz = p.z - cz;
          // spin around axis a: v = a x r
          const sx = env.a.y * rz - env.a.z * ry, sy = env.a.z * rx - env.a.x * rz, sz = env.a.x * ry - env.a.y * rx;
          ax += sx * 26 * f; ay += sy * 26 * f; az += sz * 26 * f;
          ay += (Math.random() - 0.5) * 20 * f;
        }
      } else { vx *= 0.999; vy *= 0.999; vz *= 0.999; }
      p.x += vx + ax * dt * dt; p.y += vy + ay * dt * dt; p.z += vz + az * dt * dt;
      const floor = env.floor(p.x, p.z) + RAD[i];
      if (p.y < floor) { p.y = floor; o.x = p.x - vx * 0.5; o.z = p.z - vz * 0.5; }
    }
    this.solve(4);
    // board
    const B = this.B, BO = this.BO;
    for (let i = 0; i < 3; i++) {
      const p = B[i], o = BO[i];
      let vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z;
      o.copy(p);
      const hw = waves.height(p.x, p.z);
      let ay = -9.8;
      if (p.y < hw + 0.05) {
        ay += 40 * Math.min(1, hw + 0.05 - p.y) + 6;
        const drag = Math.exp(-dt * 2.5);
        vx *= drag; vy *= drag; vz *= drag;
        if (env.foam > 0.15) { p.x += env.d.x * 5 * env.foam * dt * dt; p.z += env.d.z * 5 * env.foam * dt * dt; }
      }
      p.x += vx; p.y += vy + ay * dt * dt; p.z += vz;
      const floor = env.floor(p.x, p.z) + 0.05;
      if (p.y < floor) p.y = floor;
    }
    const bl = this.bLen;
    for (let it = 0; it < 3; it++) {
      stick(B[0], B[1], bl[0]); stick(B[1], B[2], bl[1]); stick(B[0], B[2], bl[2]);
      // leash: tail to back ankle, max 2.6 m
      const ft = P[J.rFt];
      const dx = B[1].x - ft.x, dy = B[1].y - ft.y, dz = B[1].z - ft.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 2.6) {
        const k = (d - 2.6) / d * 0.5;
        B[1].x -= dx * k; B[1].y -= dy * k; B[1].z -= dz * k;
        ft.x += dx * k; ft.y += dy * k; ft.z += dz * k;
      }
    }
  }

  boardMatrixFromLimp(out) {
    const B = this.B;
    const z = new V3().subVectors(B[1], B[0]).normalize(); // nose -> tail = +z
    const mid = new V3().addVectors(B[0], B[1]).multiplyScalar(0.5);
    const x0 = new V3().subVectors(B[2], mid);
    const y = new V3().crossVectors(z, x0).normalize();
    const x = new V3().crossVectors(y, z).normalize();
    out.makeBasis(x, y, z);
    out.setPosition(mid.x, mid.y - 0.05, mid.z);
    return out;
  }

  render(boardMat) {
    const P = this.P;
    const q = new THREE.Quaternion(), up = new V3(0, 1, 0), dir = new V3();
    for (const c of this.caps) {
      dir.subVectors(P[c.b], P[c.a]);
      const l = dir.length();
      if (l > 1e-5) dir.multiplyScalar(1 / l); else dir.set(0, 1, 0);
      c.m.position.addVectors(P[c.a], P[c.b]).multiplyScalar(0.5);
      c.m.quaternion.setFromUnitVectors(up, dir);
    }
    this.hands[0].position.copy(P[J.lHa]); this.hands[1].position.copy(P[J.rHa]);
    // feet point along the shin-ish forward direction
    const fwdB = new V3(), right = new V3(), upv = new V3(), back = new V3(), m = new THREE.Matrix4();
    for (const [f, kn, ft] of [[this.feet[0], J.lKn, J.lFt], [this.feet[1], J.rKn, J.rFt]]) {
      f.position.copy(P[ft]);
      if (this.limp) { dir.subVectors(P[ft], P[kn]).normalize(); f.quaternion.setFromUnitVectors(up, dir); }
      else { f.quaternion.setFromRotationMatrix(m.extractRotation(boardMat)); f.rotateY(Math.PI / 2.3); }
    }
    // head frame from the torso
    upv.subVectors(P[J.head], P[J.neck]).normalize();
    right.subVectors(P[J.rSh], P[J.lSh]).normalize();
    back.crossVectors(right, upv).normalize();
    right.crossVectors(upv, back).normalize();
    m.makeBasis(right, upv, back);
    this.head.quaternion.setFromRotationMatrix(m);
    this.head.position.copy(P[J.head]);
    // board
    this.board.matrixAutoUpdate = false;
    this.board.matrix.copy(boardMat);
    this.board.matrixWorldNeedsUpdate = true;
    // leash from the back ankle to the tail
    const tail = new V3(0, 0.06, (this.board.userData.length || 1.95) / 2 - 0.04).applyMatrix4(boardMat);
    const a = P[J.rFt];
    const lp = this.leash.geometry.attributes.position;
    const dist = a.distanceTo(tail);
    const sag = Math.max(0, 2.6 - dist) * 0.35;
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      lp.setXYZ(i, a.x + (tail.x - a.x) * t, a.y + (tail.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (tail.z - a.z) * t);
    }
    lp.needsUpdate = true;
  }

  centre(out) { return out.copy(this.P[J.pelvis]); }
}

function stick(a, b, len) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  const k = (d - len) / d * 0.5;
  a.x += dx * k; a.y += dy * k; a.z += dz * k;
  b.x -= dx * k; b.y -= dy * k; b.z -= dz * k;
}

// ---------------------------------------------------------------------------
// Other surfers sitting in the line-up (cheap static figures)
// ---------------------------------------------------------------------------
export function makeLineupSurfer(look, kind = 'sit') {
  const g = new THREE.Group();
  const b = makeBoard(look.board, 2.1);
  g.add(b);
  const P = Array.from({ length: NP }, () => new V3());
  if (kind === 'stand') poseStand(P, { c: 0.45, lean: 0.15 }); else poseSit(P, { t: 0 });
  const M = makeMaterials(look);
  const seg = (a, bb, r, m) => {
    const d = new V3().subVectors(P[bb], P[a]); const l = d.length();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 3, 10), m);
    mesh.position.addVectors(P[a], P[bb]).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
    g.add(mesh);
  };
  seg(J.pelvis, J.neck, 0.16, M.shirt); seg(J.lSh, J.rSh, 0.105, M.shirt); seg(J.lHip, J.rHip, 0.14, M.shorts);
  seg(J.lSh, J.lEl, 0.072, M.skin); seg(J.rSh, J.rEl, 0.072, M.skin); seg(J.lEl, J.lHa, 0.066, M.skin); seg(J.rEl, J.rHa, 0.066, M.skin);
  seg(J.lHip, J.lKn, 0.098, M.shorts); seg(J.rHip, J.rKn, 0.098, M.shorts); seg(J.lKn, J.lFt, 0.078, M.skin); seg(J.rKn, J.rFt, 0.078, M.skin);
  const h = makeHead(M);
  h.position.copy(P[J.head]);
  if (kind === 'stand') h.rotation.y = -Math.PI / 2; // faces +x like the stance
  g.add(h);
  return g;
}
