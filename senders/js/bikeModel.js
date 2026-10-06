// Senders — the downhill bike model. Local frame: +Z forward, +Y up, +X to the rider's left, origin midway
// between the axles at axle height. The front end (fork, wheel, bars) turns about the real steering axis, the
// fork compresses, the swingarm pivots with the rear shock, wheels spin and cranks turn. Tailwhips spin the
// frame around the head tube; barspins spin the front end.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const GEO = {
  htB: new THREE.Vector3(0, 0.42, 0.45), htT: new THREE.Vector3(0, 0.60, 0.38),
  bb: new THREE.Vector3(0, -0.02, -0.17), pivot: new THREE.Vector3(0, 0.1, -0.13),
  rearAxle: new THREE.Vector3(0, 0, -0.61), seat: new THREE.Vector3(0, 0.53, -0.34), crank: 0.17,
};
GEO.axis = GEO.htT.clone().sub(GEO.htB).normalize();
GEO.forkLen = GEO.htB.y / GEO.axis.y;   // crown to axle along the steering axis
GEO.grip = new THREE.Vector3(0.37, 0.67, 0.4);   // left grip (x mirrored for right) at zero steer

// merge a group's static meshes into one mesh per material (far fewer draw calls)
function mergeChildren(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh || c.isInstancedMesh) continue;
    c.updateMatrix();
    const g = c.geometry.clone().applyMatrix4(c.matrix);
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(g);
    group.remove(c); c.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
    m.castShadow = true; group.add(m);
    if (geos.length > 1) for (const g of geos) g.dispose();
  }
}

function tube(a, b, r, mat, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function wheel(mats) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.333, 0.038, 8, 36), mats.tire);
  tire.rotation.y = Math.PI / 2; tire.castShadow = true; g.add(tire);
  // knobs
  const knobs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.018, 0.03), mats.tire, 40);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    q.setFromAxisAngle(V(1, 0, 0), a);
    m.compose(V(0, Math.cos(a) * 0.37, Math.sin(a) * 0.37), q, V(1, 1, 1));
    knobs.setMatrixAt(i, m);
  }
  knobs.castShadow = true; g.add(knobs);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.297, 0.016, 6, 36), mats.rim);
  rim.rotation.y = Math.PI / 2; g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 10), mats.metal);
  hub.rotation.z = Math.PI / 2; g.add(hub);
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.004, 24), mats.metal);
  rotor.rotation.z = Math.PI / 2; rotor.position.x = 0.055; g.add(rotor);
  // spokes
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * Math.PI * 2, side = i % 2 ? 0.035 : -0.035, a2 = a + (i % 4 < 2 ? 0.35 : -0.35);
    pts.push(side, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0, Math.cos(a2) * 0.29, Math.sin(a2) * 0.29);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(sg, mats.spoke));
  return g;
}

export class BikeModel {
  constructor(colors) {
    this.mats = {
      frame: new THREE.MeshStandardMaterial({ color: colors.frame, metalness: 0.45, roughness: 0.32 }),
      accent: new THREE.MeshStandardMaterial({ color: colors.accent, metalness: 0.3, roughness: 0.4 }),
      black: new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.2, roughness: 0.55 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.28 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd8a83c, metalness: 0.85, roughness: 0.25 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0, roughness: 0.92 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.6, roughness: 0.4 }),
      spring: new THREE.MeshStandardMaterial({ color: 0xff6a1a, metalness: 0.4, roughness: 0.35 }),
      spoke: new THREE.LineBasicMaterial({ color: 0x9aa0a8 }),
    };
    const M = this.mats;
    this.root = new THREE.Group();          // placed at the physics body
    this.vis = new THREE.Group();           // trick rotations (tabletop etc.) relative to the rider
    this.root.add(this.vis);
    // ---- frame (pivots about the head tube for tailwhips)
    this.framePivot = new THREE.Group(); this.framePivot.position.copy(GEO.htB); this.vis.add(this.framePivot);
    const fr = new THREE.Group(); fr.position.copy(GEO.htB).negate(); this.framePivot.add(fr);
    this.frame = fr;
    fr.add(tube(GEO.htB, GEO.htT, 0.045, M.frame, 10));
    fr.add(tube(V(0, 0.56, 0.37), V(0, 0.46, -0.24), 0.03, M.frame));                // top tube
    fr.add(tube(V(0, 0.44, 0.43), GEO.bb, 0.042, M.frame));                           // down tube
    fr.add(tube(GEO.bb, V(0, 0.49, -0.31), 0.032, M.frame));                           // seat tube
    fr.add(tube(V(0, 0.3, 0.12), V(0, 0.12, -0.02), 0.028, M.accent));                 // shock mount
    // rear shock: body + coil
    fr.add(tube(V(0, 0.36, 0.06), V(0, 0.22, -0.16), 0.024, M.black));
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 12), M.spring);
    for (let i = 0; i < 6; i++) { const c = coil.clone(); c.position.set(0, 0.34 - i * 0.022, 0.04 - i * 0.033); c.rotation.x = Math.PI / 2 - 0.85; fr.add(c); }
    // seat post + saddle
    fr.add(tube(V(0, 0.45, -0.29), GEO.seat, 0.016, M.black));
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.27), M.black);
    saddle.position.copy(GEO.seat).add(V(0, 0.02, 0.02)); saddle.rotation.x = 0.08; saddle.castShadow = true; fr.add(saddle);
    // chain guide & chainring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 4, 24), M.black); ring.rotation.y = Math.PI / 2; ring.position.copy(GEO.bb).add(V(-0.055, 0, 0)); fr.add(ring);
    // swingarm
    this.swing = new THREE.Group(); this.swing.position.copy(GEO.pivot); fr.add(this.swing);
    const ra = GEO.rearAxle.clone().sub(GEO.pivot);
    for (const x of [0.065, -0.065]) {
      this.swing.add(tube(V(x * 0.6, 0, 0), V(x, ra.y, ra.z), 0.02, M.frame));
      this.swing.add(tube(V(x, ra.y, ra.z), V(x * 0.5, 0.24, -0.2), 0.016, M.frame));
    }
    this.rearWheel = wheel(M); this.rearWheel.position.copy(ra); this.swing.add(this.rearWheel);
    // cranks
    this.cranks = new THREE.Group(); this.cranks.position.copy(GEO.bb); fr.add(this.cranks);
    this.pedals = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, GEO.crank + 0.02), M.black);
      arm.position.set(side * 0.085, 0, side * GEO.crank / 2); arm.castShadow = true; this.cranks.add(arm);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.1), M.black);
      ped.position.set(side * 0.135, 0, side * GEO.crank); ped.castShadow = true; this.cranks.add(ped);
      this.pedals.push(ped);
    }
    // ---- front end (turns about the steering axis)
    this.front = new THREE.Group(); this.front.position.copy(GEO.htB); this.vis.add(this.front);
    const ax = GEO.axis, down = ax.clone().negate();
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), M.black); crown.quaternion.setFromUnitVectors(V(0, 1, 0), ax); this.front.add(crown);
    for (const x of [0.075, -0.075]) this.front.add(tube(V(x, 0, 0), V(x, 0, 0).addScaledVector(down, 0.26), 0.019, M.gold));
    this.lowers = new THREE.Group(); this.front.add(this.lowers);
    for (const x of [0.075, -0.075]) this.lowers.add(tube(V(x, 0, 0).addScaledVector(down, 0.2), V(x, 0, 0).addScaledVector(down, GEO.forkLen + 0.02), 0.026, M.black));
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), M.black); arch.position.copy(down).multiplyScalar(0.23).add(V(0, 0, 0.03)); this.lowers.add(arch);
    this.frontWheel = wheel(M); this.frontWheel.position.copy(down).multiplyScalar(GEO.forkLen); this.lowers.add(this.frontWheel);
    // stem + bars
    const top = ax.clone().multiplyScalar(GEO.htT.clone().sub(GEO.htB).length() + 0.03);
    const gripRel = GEO.grip.clone().sub(GEO.htB);
    this.front.add(tube(top, V(0, gripRel.y - 0.01, gripRel.z), 0.02, M.black));
    const bar = tube(V(-0.38, gripRel.y, gripRel.z), V(0.38, gripRel.y, gripRel.z), 0.012, M.black); this.front.add(bar);
    for (const x of [1, -1]) {
      const grip = tube(V(x * 0.3, gripRel.y, gripRel.z), V(x * 0.39, gripRel.y, gripRel.z), 0.017, M.accent); this.front.add(grip);
      const lever = tube(V(x * 0.24, gripRel.y + 0.01, gripRel.z + 0.01), V(x * 0.33, gripRel.y - 0.01, gripRel.z + 0.07), 0.006, M.metal); this.front.add(lever);
    }
    this.gripL = new THREE.Object3D(); this.gripL.position.set(0.345, gripRel.y, gripRel.z); this.front.add(this.gripL);
    this.gripR = new THREE.Object3D(); this.gripR.position.set(-0.345, gripRel.y, gripRel.z); this.front.add(this.gripR);
    // number plate
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.01), M.accent); plate.position.set(0, gripRel.y - 0.05, gripRel.z + 0.06); plate.rotation.x = -0.25; this.front.add(plate);
    for (const g of [fr, this.swing, this.front, this.lowers, this.frontWheel, this.rearWheel]) mergeChildren(g);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.steer = 0; this.barSpin = 0; this.whip = 0;
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
  }
  setColors(c) { this.mats.frame.color.set(c.frame); this.mats.accent.color.set(c.accent); }
  // bike: physics Bike, tr: trick visuals { roll, yaw, whip, barspin }
  update(b, tr) {
    const ax = GEO.axis;
    this.front.quaternion.setFromAxisAngle(ax, this.steer + (tr ? tr.barspin : 0));
    this.framePivot.quaternion.setFromAxisAngle(ax, tr ? tr.whip : 0);
    this.lowers.position.copy(ax).multiplyScalar(b.susp[0] * 0.9);
    this.swing.rotation.x = b.susp[1] / 0.48;
    this.frontWheel.rotation.x = b.wheelAng; this.rearWheel.rotation.x = b.wheelAng;
    this.cranks.rotation.x = this.crankAngle;
    for (const p of this.pedals) p.rotation.x = -this.crankAngle;
    if (tr) { this.vis.rotation.set(0, tr.yaw || 0, tr.roll || 0); } else this.vis.rotation.set(0, 0, 0);
  }
  dispose() { this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const k in this.mats) this.mats[k].dispose(); }
}
