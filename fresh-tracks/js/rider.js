// The snowboarder: smooth lathe-built body parts in real gear (shell/puffer/hoodie…, cargo/bib pants,
// helmet or beanie, mirrored goggles, gaiter, gloves, boots, bindings) on a properly shaped board with
// sidecut, rocker kicks and printed top sheet / base. Legs and arms are solved with two-bone IK so feet
// stay strapped in and hands really reach the board for grabs.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as G from './gear.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ------------------------------------------------------------------ geometry helpers
function lathe(pts, seg = 22) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0005), y)), seg, Math.PI, Math.PI * 2);
}
function capsule(r0, r1, L, n = 5, seg = 18) {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / n); p.push([r0 * Math.cos(a), r0 * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = (Math.PI / 2) * (i / n); p.push([r1 * Math.cos(a), L + r1 * Math.sin(a)]); }
  return lathe(p, seg);
}
// sphere patch with UVs in absolute phi/theta (so textures line up across pieces)
function spherePatch(r, ws, hs, phiStart, phiLen, thStart, thLen) {
  const g = new THREE.SphereGeometry(r, ws, hs, phiStart, phiLen, thStart, thLen);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (phiStart + u * phiLen) / (Math.PI * 2), 1 - (thStart + (1 - v) * thLen) / Math.PI);
  }
  return g;
}
const _y = V(), _z = V(), _x = V(), _m = new THREE.Matrix4();
function orient(obj, yDir, zHint) {
  _y.copy(yDir).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize(); _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z); obj.quaternion.setFromRotationMatrix(_m);
}
function placeLimb(mesh, a, b, pole, L) {
  const len = a.distanceTo(b);
  mesh.position.copy(a);
  orient(mesh, _tmp.subVectors(b, a), pole);
  mesh.scale.set(1, len / L, 1);
}
const _tmp = V(), _d = V(), _p = V();
// two-bone IK: returns middle joint in out, clamps end to reach
function ik2(a, t, l1, l2, pole, out, endOut) {
  _d.subVectors(t, a);
  let dist = _d.length();
  _d.divideScalar(dist || 1);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1); _p.normalize();
  out.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  if (endOut) endOut.copy(a).addScaledVector(_d, dist);
  return out;
}

// ------------------------------------------------------------------ the board
export function boardGeometry(shape = 'twin', L = 1.56) {
  const N = 64, M = 10, T = 0.013;
  const half = L / 2;
  const tipN = shape === 'directional' ? 0.18 : shape === 'swallow' ? 0.23 : 0.155;
  const tipT = shape === 'directional' ? 0.125 : shape === 'swallow' ? 0.15 : 0.155;
  const waist = 0.25, wn = shape === 'swallow' ? 0.315 : 0.293, wt = shape === 'swallow' ? 0.285 : shape === 'directional' ? 0.284 : 0.293;
  const eN = half - tipN, eT = -(half - tipT), c = (eN + eT) / 2 + (shape === 'directional' ? -0.03 : 0);
  const hw = (x) => {
    if (x >= eN) { const u = Math.min(1, (x - eN) / tipN); return Math.max(0.003, (wn / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.3)))); }
    if (x <= eT) {
      const u = Math.min(1, (eT - x) / tipT);
      if (shape === 'swallow') return (wt / 2) * (1 - 0.45 * u * u);
      return Math.max(0.003, (wt / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.3))));
    }
    if (x > c) { const k = (x - c) / (eN - c); return waist / 2 + (k * k * (wn - waist)) / 2; }
    const k = (c - x) / (c - eT); return waist / 2 + (k * k * (wt - waist)) / 2;
  };
  const kick = (x) => {
    if (x > eN) return 0.06 * Math.pow((x - eN) / tipN, 1.8);
    if (x < eT) return (shape === 'swallow' ? 0.035 : 0.055) * Math.pow((eT - x) / tipT, 1.8);
    return 0.004 * Math.cos(((x - c) / (eN - c)) * Math.PI * 0.5); // a touch of camber
  };
  const pos = [], uvTop = [], uvBase = [], idxTop = [], idxBase = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, x = -half + s * L;
    const w = hw(x), y = kick(x);
    for (let j = 0; j <= M; j++) {
      const v = (j / M) * 2 - 1;
      let xx = x;
      if (shape === 'swallow' && x < eT) { const u = Math.min(1, (eT - x) / tipT); xx = x + 0.12 * Math.pow(1 - Math.abs(v), 1.3) * u; }
      pos.push(xx, y, v * w);
      uvTop.push(s, (v + 1) / 2); uvBase.push(s, 1 - (v + 1) / 2);
    }
  }
  const row = M + 1;
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * row + j, b = a + 1, c2 = a + row, d = c2 + 1;
    idxTop.push(a, b, c2, b, d, c2); idxBase.push(a, c2, b, b, c2, d);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v, k) => (k % 3 === 1 ? v + T : v)), 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uvTop, 2)); top.setIndex(idxTop); top.computeVertexNormals();
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  base.setAttribute('uv', new THREE.Float32BufferAttribute(uvBase, 2)); base.setIndex(idxBase); base.computeVertexNormals();
  // sidewall + steel edge around the outline
  const loop = [];
  for (let i = 0; i <= N; i++) loop.push(i * row);
  for (let j = 1; j <= M; j++) loop.push(N * row + j);
  for (let i = N - 1; i >= 0; i--) loop.push(i * row + M);
  for (let j = M - 1; j >= 1; j--) loop.push(j);
  const sp = [], si = [];
  for (let k = 0; k < loop.length; k++) {
    const o = loop[k] * 3;
    sp.push(pos[o], pos[o + 1], pos[o + 2], pos[o], pos[o + 1] + T, pos[o + 2]);
    const a = k * 2, b = ((k + 1) % loop.length) * 2;
    si.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); side.setIndex(si); side.computeVertexNormals();
  return { top, base, side, T };
}

// ------------------------------------------------------------------ shared assets
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const fabric = new THREE.CanvasTexture(G.fabricNormalCanvas()); fabric.wrapS = fabric.wrapT = THREE.RepeatWrapping; fabric.repeat.set(6, 6);
  const knit = new THREE.CanvasTexture(G.knitNormalCanvas()); knit.wrapS = knit.wrapT = THREE.RepeatWrapping; knit.repeat.set(10, 4);
  SHARED = {
    fabric, knit,
    upperArm: capsule(0.068, 0.061, 0.29),
    foreArm: capsule(0.061, 0.056, 0.27),
    shoulder: new THREE.SphereGeometry(0.078, 18, 12),
    neck: lathe([[0.001, -0.01], [0.058, 0], [0.056, 0.12], [0.001, 0.13]], 16),
    skull: new THREE.SphereGeometry(0.098, 24, 18),
    nose: new THREE.SphereGeometry(0.019, 10, 8),
    ear: new THREE.SphereGeometry(0.045, 14, 10),
    gaiter: lathe([[0.001, -0.2], [0.07, -0.2], [0.072, -0.12], [0.098, -0.06], [0.106, -0.02], [0.1, 0.0], [0.001, 0.0]], 24),
    strap: new THREE.CylinderGeometry(0.134, 0.134, 0.036, 40, 1, true),
    gogFrame: spherePatch(0.138, 30, 6, Math.PI / 2 - 0.98, 1.96, Math.PI * 0.42, Math.PI * 0.17),
    gogLens: spherePatch(0.143, 30, 6, Math.PI / 2 - 0.86, 1.72, Math.PI * 0.435, Math.PI * 0.135),
    visor: spherePatch(0.158, 30, 8, Math.PI / 2 - 1.05, 2.1, Math.PI * 0.36, Math.PI * 0.27),
    pom: new THREE.SphereGeometry(0.038, 16, 12),
    palm: new RoundedBoxGeometry(0.088, 0.1, 0.048, 2, 0.022),
    fingers: new RoundedBoxGeometry(0.084, 0.07, 0.042, 2, 0.02),
    mitt: new RoundedBoxGeometry(0.09, 0.16, 0.05, 3, 0.025),
    thumb: capsule(0.017, 0.015, 0.05, 3, 10),
    cuff: lathe([[0.058, -0.08], [0.07, -0.075], [0.068, 0.02], [0.05, 0.03]], 18),
    boot: new RoundedBoxGeometry(0.13, 0.16, 0.315, 3, 0.045),
    bootCuff: lathe([[0.075, 0], [0.078, 0.09], [0.07, 0.1]], 18),
    plate: new RoundedBoxGeometry(0.2, 0.022, 0.27, 2, 0.008),
    highback: new THREE.CylinderGeometry(0.085, 0.075, 0.22, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8),
    ankleStrap: new THREE.CylinderGeometry(0.084, 0.084, 0.055, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
    toeStrap: new THREE.CylinderGeometry(0.07, 0.07, 0.035, 14, 1, true, -Math.PI * 0.5, Math.PI),
  };
  return SHARED;
}

function torsoGeo(style) {
  let p = [[0.168, -0.17], [0.178, -0.12], [0.175, -0.02], [0.17, 0.08], [0.182, 0.2], [0.197, 0.3], [0.202, 0.36], [0.19, 0.415], [0.15, 0.46], [0.095, 0.5], [0.08, 0.55], [0.076, 0.6], [0.001, 0.6]];
  if (style === 'puffer') p = p.map(([r, y]) => [r > 0.01 && y < 0.45 ? r + 0.018 + 0.012 * Math.abs(Math.sin((y + 0.17) * Math.PI / 0.069)) : r + (r > 0.01 ? 0.01 : 0), y]);
  if (style === 'hoodie' || style === 'flannel') p = p.map(([r, y]) => [r > 0.01 ? r + 0.006 : r, y]);
  if (style === 'race') p = p.map(([r, y]) => [r > 0.01 && y < 0.45 ? r - 0.008 : r, y]);
  if (style === 'flannel') p[p.length - 3] = [0.09, 0.55];
  return lathe(p, 28);
}
function hipGeo(style) {
  const k = style === 'baggy' ? 0.012 : style === 'slim' ? -0.01 : 0;
  return lathe([[0.001, -0.13], [0.15 + k, -0.12], [0.176 + k, -0.07], [0.178 + k, 0.02], [0.172 + k, 0.1], [0.16, 0.15], [0.001, 0.15]], 24);
}
function thighGeo(style) { const k = style === 'baggy' ? 0.016 : style === 'slim' ? -0.014 : style === 'bib' ? 0.004 : 0; return capsule(0.1 + k, 0.084 + k, 0.44, 5, 20); }
function shinGeo(style) {
  const k = style === 'baggy' ? 0.016 : style === 'slim' ? -0.012 : 0;
  return lathe([[0.001, -0.07], [0.05 + k, -0.065], [0.08 + k, -0.03], [0.081 + k, 0.1], [0.086 + k, 0.3], [0.096 + k * 1.2, 0.44], [0.099 + k * 1.2, 0.49], [0.075, 0.505], [0.001, 0.505]], 20);
}

const mat = (o) => new THREE.MeshStandardMaterial(o);
const pmat = (o) => new THREE.MeshPhysicalMaterial(o);

// ------------------------------------------------------------------ Rider
export class Rider {
  constructor(look, opts = {}) {
    const S = shared();
    this.opts = opts;
    this.root = new THREE.Group();
    this.boardG = new THREE.Group(); this.root.add(this.boardG);
    this.body = new THREE.Group(); this.root.add(this.body);
    this.textures = [];
    const M = this.M = {
      torso: pmat({ roughness: 0.68, normalMap: S.fabric, normalScale: new THREE.Vector2(0.35, 0.35), sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff) }),
      sleeve: pmat({ roughness: 0.68, normalMap: S.fabric, normalScale: new THREE.Vector2(0.35, 0.35), sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff) }),
      hip: pmat({ roughness: 0.75, normalMap: S.fabric, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.25, sheenRoughness: 0.7 }),
      thigh: pmat({ roughness: 0.75, normalMap: S.fabric, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.25, sheenRoughness: 0.7 }),
      shin: pmat({ roughness: 0.75, normalMap: S.fabric, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.25, sheenRoughness: 0.7 }),
      helmet: pmat({ roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
      beanie: mat({ roughness: 0.95, normalMap: S.knit, normalScale: new THREE.Vector2(0.8, 0.8) }),
      pad: mat({ color: 0x1a1a1a, roughness: 0.9 }),
      frame: mat({ roughness: 0.45 }),
      lens: pmat({ metalness: 1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.2 }),
      strap: mat({ roughness: 0.8 }),
      gaiter: pmat({ roughness: 0.85, normalMap: S.fabric, normalScale: new THREE.Vector2(0.4, 0.4), sheen: 0.3 }),
      skin: mat({ roughness: 0.62 }),
      glove: mat({ roughness: 0.6 }), glove2: mat({ roughness: 0.6 }),
      boot: mat({ roughness: 0.72 }), boot2: mat({ roughness: 0.6 }),
      bind: mat({ roughness: 0.45, metalness: 0.1 }), bind2: mat({ roughness: 0.55 }),
      top: pmat({ roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
      base: mat({ roughness: 0.22 }),
      edge: mat({ color: 0x5b6066, roughness: 0.3, metalness: 0.85 }),
    };
    const add = (g, m, parent = this.body) => { const o = new THREE.Mesh(g || new THREE.BufferGeometry(), m); o.castShadow = true; o.receiveShadow = false; parent.add(o); return o; };
    const P = this.P = {};
    // board
    P.bTop = add(null, M.top, this.boardG); P.bBase = add(null, M.base, this.boardG); P.bSide = add(null, M.edge, this.boardG);
    // feet: boots + bindings (static in the body frame)
    P.boots = []; P.binds = [];
    for (const side of [1, -1]) {
      const bg = new THREE.Group(); this.body.add(bg);
      bg.position.set(side * 0.27, 0.014, 0);
      const boot = add(S.boot, M.boot, bg); boot.position.set(0, 0.085, 0.022);
      const cuffB = add(S.bootCuff, M.boot2, bg); cuffB.position.set(0, 0.15, -0.01);
      const plate = add(S.plate, M.bind, bg); plate.position.set(0, 0.008, 0.0);
      const hb = add(S.highback, M.bind, bg); hb.position.set(0, 0.13, -0.035); hb.rotation.x = -0.28;
      const as = add(S.ankleStrap, M.bind2, bg); as.position.set(0, 0.13, 0.0); as.scale.set(1, 1, 1.25);
      const ts = add(S.toeStrap, M.bind2, bg); ts.position.set(0, 0.06, 0.1); ts.rotation.x = Math.PI / 2 - 0.5; ts.scale.set(1.05, 1, 0.8);
      P.boots.push(bg);
    }
    // legs, hips, torso
    P.hip = add(null, M.hip); P.thighL = add(null, M.thigh); P.thighR = add(null, M.thigh); P.shinL = add(null, M.shin); P.shinR = add(null, M.shin);
    P.torso = add(null, M.torso);
    P.hood = add(new THREE.SphereGeometry(0.1, 18, 12), M.torso, P.torso); P.hood.position.set(0, 0.5, -0.1); P.hood.scale.set(1.3, 0.75, 0.85);
    P.shL = add(S.shoulder, M.sleeve); P.shR = add(S.shoulder, M.sleeve);
    P.uaL = add(S.upperArm, M.sleeve); P.uaR = add(S.upperArm, M.sleeve); P.faL = add(S.foreArm, M.sleeve); P.faR = add(S.foreArm, M.sleeve);
    P.handL = new THREE.Group(); P.handR = new THREE.Group(); this.body.add(P.handL, P.handR);
    for (const h of [P.handL, P.handR]) {
      h.userData.cuff = add(S.cuff, M.glove2, h);
      h.userData.palm = add(S.palm, M.glove, h); h.userData.palm.position.y = 0.05;
      h.userData.fing = add(S.fingers, M.glove, h); h.userData.fing.position.set(0, 0.125, 0.012); h.userData.fing.rotation.x = 0.5;
      h.userData.mitt = add(S.mitt, M.glove, h); h.userData.mitt.position.set(0, 0.08, 0.005);
      h.userData.thumb = add(S.thumb, M.glove, h);
    }
    P.handL.userData.thumb.position.set(-0.045, 0.03, 0.02); P.handL.userData.thumb.rotation.z = 0.7;
    P.handR.userData.thumb.position.set(0.045, 0.03, 0.02); P.handR.userData.thumb.rotation.z = -0.7;
    P.neck = add(S.neck, M.gaiter);
    // head
    P.head = new THREE.Group(); this.body.add(P.head);
    P.skull = add(S.skull, M.skin, P.head); P.skull.scale.set(0.92, 1.05, 1);
    P.nose = add(S.nose, M.skin, P.head); P.nose.position.set(0, -0.025, 0.097); P.nose.scale.set(0.8, 1, 1.2);
    P.gaiter = add(S.gaiter, M.gaiter, P.head);
    P.helmet = new THREE.Group(); P.head.add(P.helmet);
    P.helmetTop = add(spherePatch(0.128, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.44), M.helmet, P.helmet);
    P.helmetSkirt = add(spherePatch(0.128, 36, 8, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, Math.PI * 0.44, Math.PI * 0.2), M.helmet, P.helmet);
    P.helmetBucket = add(spherePatch(0.128, 36, 8, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6, Math.PI * 0.44, Math.PI * 0.27), M.helmet, P.helmet);
    for (const o of [P.helmetTop, P.helmetSkirt, P.helmetBucket]) o.material.side = THREE.DoubleSide;
    P.helmet.position.set(0, 0.014, -0.006); P.helmet.scale.set(1.0, 0.98, 1.1);
    P.earL = add(S.ear, M.pad, P.head); P.earL.position.set(0.118, -0.04, -0.01); P.earL.scale.set(0.35, 1, 1);
    P.earR = add(S.ear, M.pad, P.head); P.earR.position.set(-0.118, -0.04, -0.01); P.earR.scale.set(0.35, 1, 1);
    P.visor = add(S.visor, M.lens, P.head); P.visor.position.set(0, 0.01, 0); P.visor.scale.set(1, 1, 1.02);
    P.beanie = new THREE.Group(); P.head.add(P.beanie);
    P.beanieTop = add(spherePatch(0.112, 30, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), M.beanie, P.beanie);
    P.beanieTop.scale.set(1, 1.15, 1.06); P.beanie.position.y = 0.012;
    P.pom = add(S.pom, M.beanie, P.beanie); P.pom.position.set(0, 0.14, -0.005);
    P.goggles = new THREE.Group(); P.head.add(P.goggles);
    P.gFrame = add(S.gogFrame, M.frame, P.goggles); P.gFrame.material.side = THREE.DoubleSide;
    P.gLens = add(S.gogLens, M.lens, P.goggles);
    P.strap = add(S.strap, M.strap, P.goggles); P.strap.position.y = 0.0; P.strap.scale.set(1, 1, 1.1);
    P.goggles.position.set(0, 0.012, 0.0); P.goggles.scale.set(1, 1, 1.05);

    // pose state
    this.j = {};
    for (const k of ['pelvis', 'chest', 'neck', 'headC', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankL', 'ankR', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'haLt', 'haRt', 'spine', 'fwd']) this.j[k] = V();
    this.j.ankL.set(0.27, 0.11, 0); this.j.ankR.set(-0.27, 0.11, 0);
    this.s = { crouch: 0.2, lean: 0, look: 1, grab: 0, tuck: 0, brake: 0, sit: 0, crash: 0, air: 0, wrap: 0, press: 0 };
    this.grabName = null;
    this.t = Math.random() * 10;
    this.look = null;
    this.setLook(look);
    this.pose({}, 1);
  }

  setLook(look) {
    const L = this.look = G.sanitizeLook(look);
    const M = this.M, P = this.P;
    for (const t of this.textures) t.dispose();
    this.textures = [];
    const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.textures.push(t); return t; };
    const J = G.paintJacket(L); M.torso.map = tex(J.torso); M.sleeve.map = tex(J.sleeve);
    const Pn = G.paintPants(L); M.thigh.map = tex(Pn.thigh); M.shin.map = tex(Pn.shin); M.hip.map = tex(Pn.hip);
    const hd = L.head.type;
    const htex = tex(G.paintHelmet(L));
    M.helmet.map = htex; M.beanie.map = htex;
    M.helmet.roughness = L.head.finish === 'gloss' ? 0.18 : 0.5; M.helmet.clearcoat = L.head.finish === 'gloss' ? 1 : 0.15;
    M.strap.map = tex(G.paintStrap(L));
    M.gaiter.map = tex(G.paintGaiter(L));
    M.frame.color.set(L.goggles.frame);
    const lens = G.LENSES[L.goggles.lens] || G.LENSES.gold;
    M.lens.color.set(lens[1]);
    M.lens.metalness = L.goggles.lens === 'clear' ? 0.3 : 1;
    M.skin.color.set(L.skin);
    M.glove.color.set(L.gloves.c1); M.glove2.color.set(L.gloves.c2);
    M.boot.color.set(L.boots.c1); M.boot2.color.set(L.boots.c2);
    M.bind.color.set(L.bindings.c1); M.bind2.color.set(L.bindings.c2);
    const B = G.paintBoard(L); M.top.map = tex(B.top); M.base.map = tex(B.base);
    for (const k in M) M[k].needsUpdate = true;
    // geometry by style
    const key = [L.jacket.style, L.pants.style, L.board.shape, L.board.length].join('|');
    if (key !== this.geoKey) {
      this.geoKey = key;
      for (const o of [P.torso, P.hip, P.thighL, P.shinL, P.bTop]) if (o.geometry && o.userData.own) o.geometry.dispose();
      P.torso.geometry = torsoGeo(L.jacket.style); P.torso.userData.own = true;
      P.hip.geometry = hipGeo(L.pants.style); P.hip.userData.own = true;
      P.thighL.geometry = P.thighR.geometry = thighGeo(L.pants.style); P.thighL.userData.own = true;
      P.shinL.geometry = P.shinR.geometry = shinGeo(L.pants.style); P.shinL.userData.own = true;
      const bg = boardGeometry(L.board.shape, L.board.length);
      P.bTop.geometry = bg.top; P.bBase.geometry = bg.base; P.bSide.geometry = bg.side; P.bTop.userData.own = true;
    }
    P.hood.visible = L.jacket.style !== 'race' && L.jacket.style !== 'flannel';
    P.helmet.visible = hd !== 'beanie';
    P.helmetSkirt.visible = hd === 'helmet' || hd === 'visor';
    P.helmetBucket.visible = hd === 'bucket';
    P.earL.visible = P.earR.visible = hd !== 'beanie';
    P.beanie.visible = hd === 'beanie';
    P.pom.visible = hd === 'beanie' && L.head.pom !== false;
    P.visor.visible = hd === 'visor';
    P.goggles.visible = hd !== 'visor';
    P.goggles.position.y = hd === 'beanie' ? 0.004 : 0.012;
    P.gaiter.visible = L.gaiter.on !== false;
    P.neck.material = L.gaiter.on !== false ? M.gaiter : M.skin;
    P.nose.visible = L.gaiter.on === false;
    const mitts = L.gloves.type === 'mitts';
    for (const h of [P.handL, P.handR]) { h.userData.fing.visible = !mitts; h.userData.palm.visible = !mitts; h.userData.mitt.visible = mitts; }
    this.fs = L.stance === 'goofy' ? -1 : 1;
    this.body.rotation.y = L.stance === 'goofy' ? Math.PI : 0;
  }

  setShadows(on) { this.root.traverse((o) => { if (o.isMesh) o.castShadow = on; }); }

  // p: { crouch, lean, sw (riding switch), air, grab, tuck, brake, sit, crash, spin, press }
  pose(p, dt) {
    const s = this.s, j = this.j, P = this.P;
    this.t += dt;
    const k = 1 - Math.exp(-dt * 12), k2 = 1 - Math.exp(-dt * 7);
    const noseX = this.fs; // nose side in body coordinates
    const lookT = noseX * (p.sw ? -1 : 1);
    s.crouch += ((p.crouch ?? 0.2) - s.crouch) * k;
    s.lean += ((p.lean || 0) - s.lean) * k2;
    s.look += (lookT - s.look) * (1 - Math.exp(-dt * 6));
    s.tuck += ((p.tuck || 0) - s.tuck) * k;
    s.brake += ((p.brake || 0) - s.brake) * k;
    s.sit += ((p.sit ? 1 : 0) - s.sit) * (p.sit && s.sit < 0.01 ? 1 : k);
    s.crash += ((p.crash ? 1 : 0) - s.crash) * k2;
    s.air += ((p.air ? 1 : 0) - s.air) * k;
    s.wrap += ((p.spin || 0) * 0.06 - s.wrap) * k2;
    s.press += ((p.press || 0) - s.press) * k;
    if (p.grab) this.grabName = p.grab;
    s.grab += ((p.grab ? 1 : 0) - s.grab) * (1 - Math.exp(-dt * 16));
    const look = s.look, c = Math.min(1, s.crouch + s.tuck * 0.5), lean = s.lean * (1 - s.sit), gr = s.grab, sit = s.sit;
    const gName = this.grabName;
    const heelGrab = gName === 'melon' || gName === 'stalefish' || gName === 'method';

    // pelvis and upper body
    let hipY = 0.93 - 0.34 * c - Math.abs(lean) * 0.12;
    hipY += (0.48 - hipY) * gr;
    const pz = Math.sin(lean) * 0.3 - 0.03 + c * 0.05 + (heelGrab ? -0.08 : 0.05) * gr;
    j.pelvis.set(look * 0.02 + s.press * look * 0.12, hipY, pz);
    let bend = 0.18 + 0.38 * c + lean * 0.55 + gr * (heelGrab ? 0.55 : 0.75) + s.tuck * 0.35 - s.brake * 0.25;
    let twist = look * (0.48 + 0.12 * c) * (1 - gr * 0.5) + s.wrap;
    let side = 0;
    if (gr > 0.01) {
      const handSide = (gName === 'indy' || gName === 'stalefish' || gName === 'tail') ? -noseX : noseX;
      side = -handSide * 0.35 * gr;
    }
    // sitting on a chair
    if (sit > 0) {
      j.pelvis.lerp(_tmp.set(0, 0.5, -0.4), sit);
      bend += (-0.12 - bend) * sit; twist *= 1 - sit; side *= 1 - sit;
    }
    // crash: limp and twisted
    if (s.crash > 0.01) { bend += Math.sin(this.t * 7) * 0.5 * s.crash; side += Math.sin(this.t * 5.3) * 0.4 * s.crash; }
    const eu = new THREE.Euler(bend, twist, side, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(eu);
    j.spine.set(0, 1, 0).applyQuaternion(q);
    j.fwd.set(0, 0, 1).applyQuaternion(q);
    j.chest.copy(j.pelvis).addScaledVector(j.spine, 0.43);
    j.shL.set(0.185, 0.03, -0.02).applyQuaternion(q).add(j.chest);
    j.shR.set(-0.185, 0.03, -0.02).applyQuaternion(q).add(j.chest);
    j.neck.copy(j.chest).addScaledVector(j.spine, 0.06);
    const hd = _x.copy(j.spine).multiplyScalar(0.55).addScaledVector(UP, 0.45).normalize();
    j.headC.copy(j.neck).addScaledVector(hd, 0.16);

    // legs
    const qh = new THREE.Quaternion().setFromEuler(new THREE.Euler(bend * 0.35, twist * 0.3, 0, 'YXZ'));
    j.hipL.set(0.095, -0.06, 0).applyQuaternion(qh).add(j.pelvis);
    j.hipR.set(-0.095, -0.06, 0).applyQuaternion(qh).add(j.pelvis);
    const kneeUp = gr * 0.8 + sit * 0.6;
    ik2(j.hipL, j.ankL, 0.44, 0.44, _p.set(-0.18 + gr * 0.4, kneeUp, 1), j.kneeL);
    const kL = j.kneeL.clone();
    ik2(j.hipR, j.ankR, 0.44, 0.44, _p.set(0.18 - gr * 0.4, kneeUp, 1), j.kneeR);
    j.kneeL.copy(kL);

    // hands
    const lead = look > 0 ? j.haLt : j.haRt, trail = look > 0 ? j.haRt : j.haLt;
    const ls = Math.sign(look) || 1;
    lead.set(ls * 0.44, -0.24, 0.16).add(j.chest);
    trail.set(-ls * 0.3, -0.32, -0.04).add(j.chest);
    if (lean > 0) { lead.z += lean * 0.5; trail.z += lean * 0.45; lead.y -= lean * 0.25; trail.y -= lean * 0.35; }
    else { trail.z += lean * 0.6; trail.y += lean * 0.35; lead.y -= lean * 0.2; lead.z -= lean * 0.2; }
    if (s.air > 0.01) {
      const a = s.air * (1 - gr);
      lead.lerp(_tmp.set(ls * 0.48, 0.06, 0.22).add(j.chest), a);
      trail.lerp(_tmp.set(-ls * 0.44, 0.02, 0.06).add(j.chest), a);
    }
    if (s.tuck > 0.01) {
      j.haLt.lerp(_tmp.set(0.12, j.pelvis.y + 0.02, j.pelvis.z + 0.36), s.tuck);
      j.haRt.lerp(_tmp.set(-0.12, j.pelvis.y + 0.02, j.pelvis.z + 0.36), s.tuck);
    }
    if (s.brake > 0.01) { lead.lerp(_tmp.set(ls * 0.5, 0.0, 0.3).add(j.chest), s.brake * 0.6); trail.lerp(_tmp.set(-ls * 0.5, -0.05, 0.25).add(j.chest), s.brake * 0.6); }
    if (gr > 0.01 && gName) {
      // which hand grabs where (in body frame: nose = noseX * x, toe edge = +z)
      const front = noseX > 0 ? j.haLt : j.haRt, back = noseX > 0 ? j.haRt : j.haLt;
      let hand = front, tgt;
      switch (gName) {
        case 'indy': hand = back; tgt = _tmp.set(-noseX * 0.06, 0.03, 0.15); break;
        case 'melon': tgt = _tmp.set(noseX * 0.05, 0.03, -0.15); break;
        case 'method': tgt = _tmp.set(noseX * 0.0, 0.05, -0.16); break;
        case 'mute': tgt = _tmp.set(noseX * 0.12, 0.03, 0.15); break;
        case 'stalefish': hand = back; tgt = _tmp.set(-noseX * 0.1, 0.03, -0.15); break;
        case 'nose': tgt = _tmp.set(noseX * 0.66, 0.06, 0.02); break;
        case 'tail': hand = back; tgt = _tmp.set(-noseX * 0.66, 0.06, 0.02); break;
        default: tgt = _tmp.set(0, 0.03, 0.15);
      }
      hand.lerp(tgt, gr);
      const other = hand === front ? back : front;
      const os = other === j.haLt ? 1 : -1;
      other.lerp(_x.set(os * 0.5, 0.15, 0.1).add(j.chest), gr);
    }
    if (sit > 0) {
      j.haLt.lerp(_tmp.set(0.16, j.pelvis.y + 0.06, j.pelvis.z + 0.28), sit);
      j.haRt.lerp(_tmp.set(-0.16, j.pelvis.y + 0.06, j.pelvis.z + 0.28), sit);
    }
    if (s.crash > 0.01) {
      j.haLt.lerp(_tmp.set(0.45, 0.15 * Math.sin(this.t * 9), 0.2 * Math.cos(this.t * 7)).add(j.chest), s.crash);
      j.haRt.lerp(_tmp.set(-0.45, 0.15 * Math.cos(this.t * 8), 0.2 * Math.sin(this.t * 6)).add(j.chest), s.crash);
    }
    ik2(j.shL, j.haLt, 0.29, 0.27, _p.set(0.6, -0.6, -0.5), j.elL, j.haL);
    ik2(j.shR, j.haRt, 0.29, 0.27, _p.set(-0.6, -0.6, -0.5), j.elR, j.haR);

    // place meshes
    P.hip.position.copy(j.pelvis); P.hip.quaternion.copy(qh);
    P.torso.position.copy(j.pelvis); P.torso.quaternion.copy(q);
    placeLimb(P.thighL, j.hipL, j.kneeL, _p.set(0, 0, 1), 0.44);
    placeLimb(P.thighR, j.hipR, j.kneeR, _p.set(0, 0, 1), 0.44);
    placeLimb(P.shinL, j.kneeL, j.ankL, _p.set(0, 0, 1), 0.44);
    placeLimb(P.shinR, j.kneeR, j.ankR, _p.set(0, 0, 1), 0.44);
    P.shL.position.copy(j.shL); P.shR.position.copy(j.shR);
    placeLimb(P.uaL, j.shL, j.elL, _p.set(0, 0, 1), 0.29);
    placeLimb(P.uaR, j.shR, j.elR, _p.set(0, 0, 1), 0.29);
    placeLimb(P.faL, j.elL, j.haL, _p.set(0, 0, 1), 0.27);
    placeLimb(P.faR, j.elR, j.haR, _p.set(0, 0, 1), 0.27);
    P.handL.position.copy(j.haL); orient(P.handL, _tmp.subVectors(j.haL, j.elL), _p.set(0, 0, 1));
    P.handR.position.copy(j.haR); orient(P.handR, _tmp.subVectors(j.haR, j.elR), _p.set(0, 0, 1));
    placeLimb(P.neck, j.chest, j.headC, j.fwd, 0.16);
    P.neck.scale.y = 1;
    P.head.position.copy(j.headC);
    const headYaw = look * 1.2 * (1 - sit) * (1 - gr * 0.3);
    P.head.quaternion.setFromEuler(new THREE.Euler(-0.15 + bend * 0.25, headYaw, 0, 'YXZ'));
  }

  dispose() {
    for (const t of this.textures) t.dispose();
    for (const k in this.M) this.M[k].dispose();
    for (const o of [this.P.torso, this.P.hip, this.P.thighL, this.P.shinL, this.P.bTop, this.P.bBase, this.P.bSide]) o.geometry && o.geometry.dispose();
  }
}
