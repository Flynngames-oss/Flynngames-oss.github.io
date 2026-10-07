// Senders — the rider. A jointed body (full-face helmet and goggles, jersey, pants, gloves, shoes) whose
// hands and feet are pinned to the grips and pedals with two-bone IK, so it crouches, pedals, leans, absorbs
// landings and strikes trick poses. When you bail it turns into a verlet ragdoll that tumbles down the hill.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const J = ['pelvis', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hiL', 'hiR', 'knL', 'knR', 'foL', 'foR'];
const LEN = { thigh: 0.44, shin: 0.47, upper: 0.29, fore: 0.3 };
const RAD = { pelvis: 0.14, chest: 0.15, head: 0.16, shL: 0.08, shR: 0.08, elL: 0.06, elR: 0.06, haL: 0.06, haR: 0.06, hiL: 0.09, hiR: 0.09, knL: 0.07, knR: 0.07, foL: 0.07, foR: 0.07 };
const BONES = [['pelvis', 'chest'], ['chest', 'head'], ['chest', 'shL'], ['chest', 'shR'], ['shL', 'shR'], ['pelvis', 'hiL'], ['pelvis', 'hiR'], ['hiL', 'hiR'],
  ['shL', 'hiR'], ['shR', 'hiL'], ['shL', 'hiL'], ['shR', 'hiR'], ['head', 'shL'], ['head', 'shR'], ['pelvis', 'shL'], ['pelvis', 'shR'],
  ['shL', 'elL'], ['elL', 'haL'], ['shR', 'elR'], ['elR', 'haR'], ['hiL', 'knL'], ['knL', 'foL'], ['hiR', 'knR'], ['knR', 'foR'],
  ['shL', 'haL', 'min'], ['shR', 'haR', 'min'], ['hiL', 'foL', 'min'], ['hiR', 'foR', 'min']];

function jerseyTexture(c) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = c.jersey; x.fillRect(0, 0, 256, 256);
  x.fillStyle = c.accent; x.fillRect(0, 88, 256, 26); x.fillRect(0, 124, 256, 8);
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, 256, 14);
  x.fillStyle = c.accent; x.font = 'italic 900 60px "Barlow Condensed", Impact, sans-serif'; x.textAlign = 'center';
  x.fillText('77', 192, 200);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 10), mat);
  m.castShadow = true; return m;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

function solveIK(root, target, l1, l2, hint, out) {
  _a.subVectors(target, root);
  let d = _a.length();
  d = clamp(d, 0.05, (l1 + l2) * 0.999);
  _a.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(hint).addScaledVector(_a, -hint.dot(_a)).normalize();
  out.copy(root).addScaledVector(_a, a).addScaledVector(_b, h);
}

export class Rider {
  constructor(colors) {
    this.group = new THREE.Group();
    this.colors = Object.assign({}, colors);
    this.jtex = jerseyTexture(colors);
    this.mats = {
      jersey: new THREE.MeshStandardMaterial({ map: this.jtex, roughness: 0.8 }),
      sleeve: new THREE.MeshStandardMaterial({ color: colors.jersey, roughness: 0.8 }),
      pants: new THREE.MeshStandardMaterial({ color: colors.pants, roughness: 0.85 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.7 }),
      shoe: new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.7 }),
      helmet: new THREE.MeshStandardMaterial({ color: colors.helmet, roughness: 0.25, metalness: 0.2 }),
      accent: new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.4 }),
      lens: new THREE.MeshStandardMaterial({ color: 0xff8a20, roughness: 0.05, metalness: 0.95 }),
      strap: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
    };
    const M = this.mats;
    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.27, 4, 12), M.jersey); this.torso.scale.set(1.3, 1, 0.82); this.torso.castShadow = true;
    this.pack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.08), M.accent); this.pack.castShadow = true;
    this.hips = capsule(0.12, 0.14, M.pants);
    this.neck = capsule(0.055, 0.08, M.sleeve);
    this.limbs = {
      upL: capsule(0.056, LEN.upper - 0.1, M.sleeve), upR: capsule(0.056, LEN.upper - 0.1, M.sleeve),
      foreL: capsule(0.048, LEN.fore - 0.09, M.sleeve), foreR: capsule(0.048, LEN.fore - 0.09, M.sleeve),
      thighL: capsule(0.078, LEN.thigh - 0.13, M.pants), thighR: capsule(0.078, LEN.thigh - 0.13, M.pants),
      shinL: capsule(0.062, LEN.shin - 0.12, M.pants), shinR: capsule(0.062, LEN.shin - 0.12, M.pants),
    };
    this.kneePads = [new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), M.accent), new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), M.accent)];
    this.hands = [new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.1), M.glove), new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.1), M.glove)];
    this.feet = [new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.27), M.shoe), new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.27), M.shoe)];
    // full-face helmet
    this.head = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), M.helmet); shell.scale.set(0.95, 1.0, 1.12); this.head.add(shell);
    const chin = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.04, 8, 16, Math.PI), M.helmet); chin.rotation.set(Math.PI / 2, 0, 0); chin.position.set(0, -0.08, 0.04); this.head.add(chin);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.12), M.accent); peak.position.set(0, 0.11, 0.15); peak.rotation.x = -0.25; this.head.add(peak);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.018, 6, 24), M.strap); strap.rotation.x = Math.PI / 2 - 0.12; strap.position.set(0, 0.02, 0.0); strap.scale.set(1, 1.15, 1); this.head.add(strap);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.065, 0.04), M.lens); lens.position.set(0, 0.025, 0.155); this.head.add(lens);
    this.head.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(this.torso, this.pack, this.hips, this.neck, this.head, ...Object.values(this.limbs), ...this.kneePads, ...this.hands, ...this.feet);
    this.P = {}; for (const k of J) this.P[k] = new THREE.Vector3();
    this.rag = null;
    this.look = new THREE.Vector3(0, 0, 1);
    this.headLook = 0.5;
    this.neckEnd = new THREE.Vector3();
  }
  setColors(c) {
    this.colors = Object.assign({}, c);
    this.jtex.dispose(); this.jtex = jerseyTexture(c); this.mats.jersey.map = this.jtex; this.mats.jersey.needsUpdate = true;
    this.mats.sleeve.color.set(c.jersey); this.mats.pants.color.set(c.pants); this.mats.helmet.color.set(c.helmet); this.mats.accent.color.set(c.accent);
  }

  // Pose on the bike. st: { crouch 0..1, fb (-1 back..1 forward), side (-1..1), w: {superman, nohander, tabletop, cancan, nofooter, whip, barspin} }
  poseOnBike(bm, st) {
    const root = bm.root; root.updateMatrixWorld(true);
    const W = root.matrixWorld, P = this.P, w = st.w;
    const c = clamp(st.crouch, 0, 1), back = Math.max(0, -st.fb), fwd = Math.max(0, st.fb);
    const sup = w.superman, noh = w.nohander;
    // core of the body in the bike's frame
    const px = st.side * 0.06, py = lerp(0.82, 0.56, c) + sup * 0.12 - back * 0.04, pz = lerp(-0.2, -0.28, c) - back * 0.2 + fwd * 0.1 - sup * 0.22;
    P.pelvis.set(px, py, pz);
    const lam = lerp(0.86, 1.06, c) + fwd * 0.12 - back * 0.25 + sup * 0.35 - noh * 0.35;
    P.chest.set(px * 1.6, py + 0.5 * Math.cos(lam), pz + 0.5 * Math.sin(lam));
    P.head.set(P.chest.x * 1.1, P.chest.y + 0.16 - sup * 0.03, P.chest.z + 0.12);
    P.shL.set(P.chest.x + 0.19, P.chest.y - 0.035, P.chest.z - 0.02); P.shR.set(P.chest.x - 0.19, P.chest.y - 0.035, P.chest.z - 0.02);
    P.hiL.set(px + 0.1, py, pz); P.hiR.set(px - 0.1, py, pz);
    for (const k of ['pelvis', 'chest', 'head', 'shL', 'shR', 'hiL', 'hiR']) P[k].applyMatrix4(W);
    // hands and feet: grips and pedals (world), unless a trick takes them off
    bm.gripL.getWorldPosition(P.haL); bm.gripR.getWorldPosition(P.haR);
    bm.pedals[0].getWorldPosition(P.foL); bm.pedals[1].getWorldPosition(P.foR);
    const upW = _c.set(0, 1, 0).transformDirection(W);
    P.foL.addScaledVector(upW, 0.05); P.foR.addScaledVector(upW, 0.05);
    const blend = (key, x, y, z, k) => { if (k <= 0.001) return; _d.set(x, y, z).applyMatrix4(W); P[key].lerp(_d, k); };
    blend('haL', 0.74, 1.2, -0.06, noh); blend('haR', -0.74, 1.2, -0.06, noh);
    blend('haL', 0.3, 0.98, 0.25, w.barspin); blend('haR', -0.3, 0.98, 0.25, w.barspin);
    blend('foL', 0.15, 0.62, -1.08, sup); blend('foR', -0.15, 0.62, -1.08, sup);
    blend('foL', 0.6, 0.18, -0.05, w.nofooter); blend('foR', -0.6, 0.18, -0.05, w.nofooter);
    blend('foL', -0.4, 0.3, 0.2, w.cancan);
    blend('foL', 0.32, 0.25, -0.2, w.whip); blend('foR', -0.32, 0.25, -0.2, w.whip);
    // elbows out and back, knees forward and out
    const hintArmL = _a.set(1, -0.7, -0.6).transformDirection(W).clone(), hintArmR = _b.set(-1, -0.7, -0.6).transformDirection(W).clone();
    solveIK(P.shL, P.haL, LEN.upper, LEN.fore, hintArmL, P.elL);
    solveIK(P.shR, P.haR, LEN.upper, LEN.fore, hintArmR, P.elR);
    const hintKL = _a.set(0.35, 0.2, 1).transformDirection(W).clone(), hintKR = _b.set(-0.35, 0.2, 1).transformDirection(W).clone();
    solveIK(P.hiL, P.foL, LEN.thigh, LEN.shin, hintKL, P.knL);
    solveIK(P.hiR, P.foR, LEN.thigh, LEN.shin, hintKR, P.knR);
    this.look.set(0, -0.15, 1).transformDirection(W);
    this.fwdW = _d.set(0, 0, 1).transformDirection(W).clone();
    this.place(true);
  }

  // put the meshes on the joints
  place(riding) {
    const P = this.P;
    // torso basis: x = left, y = up, z = forward
    const up = _a.subVectors(P.chest, P.pelvis).normalize();
    const left = _b.subVectors(P.shL, P.shR); left.addScaledVector(up, -left.dot(up)).normalize();
    const fwd = _c.crossVectors(left, up).normalize();
    _m.makeBasis(left, up, fwd);
    this.torso.quaternion.setFromRotationMatrix(_m);
    this.torso.position.addVectors(P.pelvis, P.chest).multiplyScalar(0.5);
    this.pack.quaternion.copy(this.torso.quaternion);
    this.pack.position.copy(this.torso.position).addScaledVector(fwd, -0.15).addScaledVector(up, 0.05);
    // hips across
    this.bone(this.hips, P.hiL, P.hiR);
    // head: looks where the bike goes while riding
    let hf = riding ? this.look : fwd;
    const hu = _d.subVectors(P.head, P.chest).normalize();
    if (riding) hu.lerp(_up, 0.5).normalize();
    const hfw = hf.clone().addScaledVector(hu, -hf.dot(hu)).normalize();
    const hl = new THREE.Vector3().crossVectors(hu, hfw).normalize();
    _m.makeBasis(hl, hu, hfw);
    this.head.quaternion.setFromRotationMatrix(_m);
    this.head.position.copy(P.head);
    this.neckEnd.lerpVectors(P.chest, P.head, 0.6);
    this.bone(this.neck, P.chest, this.neckEnd);
    const L = this.limbs;
    this.bone(L.upL, P.shL, P.elL); this.bone(L.upR, P.shR, P.elR);
    this.bone(L.foreL, P.elL, P.haL); this.bone(L.foreR, P.elR, P.haR);
    this.bone(L.thighL, P.hiL, P.knL); this.bone(L.thighR, P.hiR, P.knR);
    this.bone(L.shinL, P.knL, P.foL); this.bone(L.shinR, P.knR, P.foR);
    this.kneePads[0].position.copy(P.knL); this.kneePads[1].position.copy(P.knR);
    // hands along the forearm, feet pointing forward
    for (let i = 0; i < 2; i++) {
      const el = i ? P.elR : P.elL, ha = i ? P.haR : P.haL, h = this.hands[i];
      h.position.copy(ha);
      h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _a.subVectors(ha, el).normalize());
      const kn = i ? P.knR : P.knL, fo = i ? P.foR : P.foL, f = this.feet[i];
      const shin = _b.subVectors(fo, kn).normalize();
      const ff = (riding && this.fwdW ? this.fwdW.clone() : fwd.clone()); ff.addScaledVector(shin, -ff.dot(shin)).normalize();
      const fl = new THREE.Vector3().crossVectors(shin.clone().negate(), ff).normalize();
      _m.makeBasis(fl, shin.clone().negate(), ff);
      f.quaternion.setFromRotationMatrix(_m);
      f.position.copy(fo).addScaledVector(ff, 0.03);
    }
  }
  bone(mesh, a, b) {
    _a.subVectors(b, a); const len = _a.length();
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    if (len > 1e-5) mesh.quaternion.setFromUnitVectors(_up, _a.multiplyScalar(1 / len));
  }

  // ---------------------------------------------------------------- ragdoll
  startRagdoll(vel, kick) {
    const P = this.P, dt = 1 / 120;
    const pts = {}, prev = {};
    for (const k of J) {
      pts[k] = P[k].clone();
      const j = new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5);
      const v = vel.clone().add(j).add(kick || _a.set(0, 0, 0));
      if (k === 'head' || k === 'chest' || k === 'shL' || k === 'shR') v.addScaledVector(vel, 0.12).y += 1.0;
      prev[k] = pts[k].clone().addScaledVector(v, -dt);
    }
    const cons = BONES.map(([a, b, kind]) => ({ a, b, rest: pts[a].distanceTo(pts[b]), min: kind === 'min' }));
    for (const c of cons) if (c.min) c.rest = c.rest * 0.55;
    this.rag = { pts, prev, cons, t: 0, settle: 0 };
  }
  updateRagdoll(dt, course) {
    const R = this.rag; if (!R) return;
    const steps = 2, h = dt / steps;
    let moving = 0;
    for (let s = 0; s < steps; s++) {
      for (const k of J) {
        const p = R.pts[k], q = R.prev[k];
        const vx = (p.x - q.x) * 0.998, vy = (p.y - q.y) * 0.998, vz = (p.z - q.z) * 0.998;
        q.copy(p);
        p.x += vx; p.y += vy - 9.81 * h * h; p.z += vz;
      }
      for (let it = 0; it < 6; it++) {
        for (const c of R.cons) {
          const a = R.pts[c.a], b = R.pts[c.b];
          _a.subVectors(b, a); const len = _a.length() || 1e-6;
          if (c.min && len > c.rest) continue;
          const diff = (len - c.rest) / len * 0.5;
          a.addScaledVector(_a, diff); b.addScaledVector(_a, -diff);
        }
        for (const k of J) {
          const p = R.pts[k], r = RAD[k], g = course.heightAt(p.x, p.z);
          if (p.y < g + r) {
            const q = R.prev[k];
            p.y = g + r;
            const vx = p.x - q.x, vy = p.y - q.y, vz = p.z - q.z;
            // friction and a small bounce
            q.x = p.x - vx * 0.82; q.z = p.z - vz * 0.82; if (vy < 0) q.y = p.y + vy * 0.25;
          }
        }
      }
    }
    for (const k of J) { moving += R.pts[k].distanceTo(R.prev[k]); this.P[k].copy(R.pts[k]); }
    R.t += dt;
    R.settle = moving / dt / J.length;
    this.place(false);
  }
  endRagdoll() { this.rag = null; }
  centre(out) { return out.copy(this.P.pelvis); }
  dispose() { this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const k in this.mats) this.mats[k].dispose(); this.jtex.dispose(); }
}

// The bike flying off on its own after a bail.
export class Debris {
  constructor() { this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.w = new THREE.Vector3(); }
  start(pos, quat, vel) {
    this.pos.copy(pos); this.q.copy(quat); this.vel.copy(vel).multiplyScalar(0.85); this.vel.y += 1.5;
    this.w.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 9);
  }
  update(dt, course) {
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const g = course.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < g + 0.38) {
      this.pos.y = g + 0.38;
      if (this.vel.y < 0) this.vel.y *= -0.32;
      this.vel.x *= 0.95; this.vel.z *= 0.95;
      this.w.multiplyScalar(0.94);
      if (this.vel.length() < 1.5) this.w.multiplyScalar(0.85);
    }
    const a = this.w.length();
    if (a > 1e-4) { _q.setFromAxisAngle(_a.copy(this.w).multiplyScalar(1 / a), a * dt); this.q.premultiply(_q); }
  }
}
