// Snowboard physics on the analytic mountain. Fixed 240 Hz sub-steps.
// Ground: gravity along the slope, edge grip bends the velocity toward where the board points (carving),
// skids scrub speed, drag + snow friction, tuck, skating. Leaves the snow when the surface falls away
// (lips, rollers, the top of the pipe). Air: ballistic, spins/flips/grabs from the keys, the body pitches
// with the flight so landings match the slope. Landing checks the board against the snow; get it wrong
// and you bail. Rails/boxes lock on and slide. In the superpipe an assist keeps you going wall to wall.
import * as THREE from 'three';
import * as T from './terrain.js';

const G = 9.81, STEP = 1 / 240;
const SPINMAX = 12.6, FLIPMAX = 9.6;
const _n = { x: 0, y: 1, z: 0 }, _n2 = { x: 0, y: 1, z: 0 };
const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const qPi = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

function basisQ(X, Y, out) {
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  const Yo = new THREE.Vector3().crossVectors(Z, X).normalize();
  const m = new THREE.Matrix4().makeBasis(X.clone().normalize(), Yo, Z);
  return out.setFromRotationMatrix(m);
}

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = V(); this.vel = V(); this.heading = V().set(0, 0, 1); this.n = V().set(0, 1, 0);
    this.mode = 'ground';
    this.sw = false; this.goofy = false;
    this.qTravel = new THREE.Quaternion(); this.qVis = new THREE.Quaternion();
    this.edge = 0; this.roll = 0; this.turnRate = 0;
    this.crouch = 0.25; this.comp = 0; this.charge = 0; this.charging = false;
    this.air = null; this.rail = null; this.crashT = 0; this.tumble = V();
    this.events = [];
    this.acc = 0;
    this.speed = 0; this.skid = 0; this.inPipe = false;
    this.freeze = false;
    this.lastGround = 0; this.time = 0;
  }

  spawn(x, z, dir = { x: 0, z: 1 }) {
    this.pos.set(x, T.H(x, z), z);
    this.vel.set(0, 0, 0);
    this.heading.set(dir.x, 0, dir.z).normalize();
    T.normalAt(x, z, _n); this.n.set(_n.x, _n.y, _n.z);
    this.mode = 'ground'; this.sw = false; this.air = null; this.rail = null; this.crashT = 0; this.edge = 0; this.roll = 0;
    this.comp = 0; this.charge = 0; this.charging = false;
    this.updateFrame(0);
  }

  emit(type, data = {}) { this.events.push(Object.assign({ type }, data)); }

  update(dt, inp) {
    if (this.freeze || this.mode === 'lift') { this.updateFrame(dt); return; }
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) { this.step(STEP, inp); this.acc -= STEP; this.time += STEP; }
    this.updateFrame(dt, inp);
  }

  step(h, inp) {
    if (this.mode === 'ground') this.stepGround(h, inp);
    else if (this.mode === 'air') this.stepAir(h, inp);
    else if (this.mode === 'rail') this.stepRail(h, inp);
    else if (this.mode === 'crash') this.stepCrash(h);
  }

  // ---------------------------------------------------------------- ground
  stepGround(h, inp) {
    const p = this.pos, v = this.vel;
    T.normalAt(p.x, p.z, _n); const n = this._nv || (this._nv = V()); n.set(_n.x, _n.y, _n.z);
    v.y -= G * h;
    v.addScaledVector(n, -v.dot(n));
    const hd = this.heading; hd.addScaledVector(n, -hd.dot(n)).normalize();
    let speed = v.length();
    this.inPipe = T.inPipe(p.x, p.z);
    if (!this.inPipe) this.pipeDir = 0;
    const P = T.PIPE, dxp = p.x - P.x;
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    // steering: turn the board on the snow
    let rate = 0;
    if (!this.inPipe) {
      rate = -steer * (2.7 / (1 + speed * 0.05)) * (inp.down ? 1.25 : 1);
      if (rate) hd.applyAxisAngle(n, rate * h);
    }
    // carve: edge grip pulls the velocity round to the board's heading
    if (speed > 0.5) {
      const vd = this._vd || (this._vd = V()); vd.copy(v).divideScalar(speed);
      let dot = vd.dot(hd);
      if (dot < -0.15) { hd.negate(); this.sw = !this.sw; dot = -dot; }
      if (this.inPipe) hd.copy(vd);
      else if (inp.down && speed > 2.5) {
        // hockey stop: swing the board across the fall line and skid
        if (!this.brakeSide) this.brakeSide = steer || (Math.random() < 0.5 ? 1 : -1);
        const tg = this._bt || (this._bt = V()); tg.copy(vd).applyAxisAngle(n, this.brakeSide * 1.2);
        hd.lerp(tg, 1 - Math.exp(-h * 7)).normalize();
      } else {
        this.brakeSide = 0;
        if (!steer && dot < 0.9) { const tg = this._bt || (this._bt = V()); hd.lerp(vd, 1 - Math.exp(-h * 6)).normalize(); void tg; }
      }
      dot = vd.dot(hd);
      const cr = this._cr || (this._cr = V()); cr.crossVectors(vd, hd);
      const ang = Math.atan2(cr.dot(n), dot);
      const grip = inp.down ? 1.0 : 8;
      const turn = ang * (1 - Math.exp(-grip * h));
      v.applyAxisAngle(n, turn);
      speed -= Math.abs(turn) * speed * 0.05;
      this.skid += (Math.min(1, Math.abs(ang) * 2.2) - this.skid) * Math.min(1, h * 10);
      this.turnRate = inp.down ? 0 : turn / h;
    } else { this.skid *= 0.9; this.turnRate = rate; }
    // friction, drag, braking, tuck, skating
    const tuck = inp.up && speed > 4;
    const k = tuck ? 0.0052 : 0.0076;
    let dec = 0.035 * G * Math.max(0.2, n.y) + k * speed * speed + (inp.down ? 5 + speed * 0.3 : 0) + this.skid * speed * 0.35;
    speed = Math.max(0, speed - dec * h);
    if (inp.up && speed < 5.5 && !this.inPipe) speed += 2.4 * h;
    // superpipe assist: keeps the rhythm wall to wall at Olympic speed
    if (this.inPipe && Math.abs(dxp) < P.b + 0.8) {
      if (Math.abs(v.x) > 2.5) this.pipeDir = Math.sign(v.x);
      else if (!this.pipeDir) this.pipeDir = Math.abs(dxp) > 1 ? -Math.sign(dxp) : 1;
      const sx = this.pipeDir;
      const tgt = this._tg || (this._tg = V());
      tgt.set(sx * (inp.up ? 18.2 : 16.8), 0, 5.6);
      tgt.addScaledVector(n, -tgt.dot(n));
      const vt = this._vt || (this._vt = V()); vt.copy(v).setLength(speed);
      vt.lerp(tgt, 1 - Math.exp(-h * 4.5));
      v.copy(vt); speed = v.length();
    } else if (speed > 0.01) v.setLength(speed);
    else v.copy(hd).multiplyScalar(0);
    if (speed < 0.5 && !this.inPipe) v.copy(hd).multiplyScalar(speed);

    // ollie: hold space to load, release to pop
    if (inp.jump) { this.charging = true; this.charge = Math.min(1, this.charge + h * 2.6); }
    else if (this.charging) {
      this.charging = false;
      const pop = 3.3 + this.charge * 2.3;
      this.charge = 0;
      v.addScaledVector(n, pop); v.y += 0.4;
      p.addScaledVector(n, 0.05);
      this.takeoff(n, inp, true);
      return;
    }

    p.addScaledVector(v, h);
    this.collide(h);
    if (this.mode !== 'ground') return;
    const y = T.H(p.x, p.z);
    T.normalAt(p.x, p.z, _n2);
    const n2 = this._n2v || (this._n2v = V()); n2.set(_n2.x, _n2.y, _n2.z);
    const away = v.dot(n2);
    if (p.y - y > 0.4 || (away > 1.25 && p.y - y > -0.05)) { this.takeoff(n, inp, false); return; }
    p.y = y;
    // stay on the surface, keep speed through concave transitions
    const sp = v.length();
    v.addScaledVector(n2, -v.dot(n2));
    if (v.lengthSq() > 1e-6) v.setLength(sp * (away < -2 ? 0.995 : 1));
    this.n.lerp(n2, 1 - Math.exp(-h * 30)).normalize();
    this.comp = Math.max(0, this.comp - h * 2.2);
    this.lastGround = this.time;
    this.speed = sp;
    this.checkRails(inp, true);
    this.edgeTarget = -Math.max(-0.95, Math.min(0.95, Math.atan((speed * (this.turnRate || 0)) / G)));
    if (inp.down && speed > 2) this.edgeTarget = -0.5 * (this.brakeSide || 1) * Math.min(1, speed / 6);
  }

  takeoff(n, inp, ollie) {
    const P = T.PIPE, p = this.pos, v = this.vel;
    const pipe = T.inPipe(p.x, p.z) && n.y < 0.5;
    this.mode = 'air';
    const a = this.air = {
      t: 0, spin: 0, flip: 0, spinV: 0, flipV: 0, grab: null, grabT: 0, grabs: {}, y0: p.y, maxY: p.y, x0: p.x, z0: p.z,
      pipe, sw: this.sw, ollie, base: new THREE.Quaternion(), lipY: pipe ? T.baseY(p.z) : p.y, rail: false,
    };
    if (pipe) {
      const vy = Math.max(1, v.y), tt = (2 * vy) / G;
      const dxp = p.x - P.x;
      v.x = -Math.sign(dxp) * (0.35 / Math.max(0.5, tt));
      a.pipeY = n.clone();
      a.lastX = V().copy(v).addScaledVector(n, -v.dot(n)).normalize();
      a.nat = 0;
    }
    const spinIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    if (spinIn) a.spinV = spinIn * SPINMAX * 0.7;
    this.emit('takeoff', { pipe, ollie });
  }

  // ---------------------------------------------------------------- air
  stepAir(h, inp) {
    const p = this.pos, v = this.vel, a = this.air;
    v.y -= G * h;
    const sp = v.length(); v.multiplyScalar(1 - 0.0016 * sp * h);
    p.addScaledVector(v, h);
    a.t += h; if (p.y > a.maxY) a.maxY = p.y;
    // rotation from the keys
    const spinIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0), flipIn = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (spinIn) a.spinV += (spinIn * SPINMAX - a.spinV) * Math.min(1, h * 9);
    else a.spinV *= Math.exp(-h * 4.5);
    if (flipIn) a.flipV += (flipIn * FLIPMAX - a.flipV) * Math.min(1, h * 7);
    else a.flipV *= Math.exp(-h * 5);
    // a gentle auto-finish so near-complete rotations land
    if (!spinIn && Math.abs(a.spinV) < 3) { const tgt = Math.round(a.spin / Math.PI) * Math.PI; a.spin += (tgt - a.spin) * Math.min(1, h * 3); }
    if (!flipIn && Math.abs(a.flipV) < 3) { const tgt = Math.round(a.flip / (Math.PI * 2)) * Math.PI * 2; a.flip += (tgt - a.flip) * Math.min(1, h * 3); }
    a.spin += a.spinV * h; a.flip += a.flipV * h;
    // grabs
    if (inp.grab && a.t > 0.08) {
      if (a.grab !== inp.grab) a.grab = inp.grab;
      a.grabT += h; a.grabs[inp.grab] = (a.grabs[inp.grab] || 0) + h;
    } else a.grab = null;
    this.collide(h);
    if (this.mode !== 'air') return;
    if (this.checkRails(inp, false)) return;
    const y = T.H(p.x, p.z);
    if (p.y <= y) this.land(y);
  }

  airQuat(out) {
    const a = this.air, v = this.vel;
    const base = this._bq || (this._bq = new THREE.Quaternion());
    if (a.pipe) {
      // in the pipe the board turns with the flight (up the wall, over, back down): the natural "air"
      const X = this._X || (this._X = V());
      X.copy(v).addScaledVector(a.pipeY, -v.dot(a.pipeY));
      if (X.lengthSq() < 0.04) X.copy(a.lastX); else X.normalize();
      const c = this._c2 || (this._c2 = V()); c.crossVectors(a.lastX, X);
      a.nat += Math.atan2(c.dot(a.pipeY), a.lastX.dot(X));
      a.lastX.copy(X);
      basisQ(X, a.pipeY, base);
    } else {
      const f = this._f || (this._f = V());
      f.set(this.heading.x, 0, this.heading.z); if (f.lengthSq() < 1e-6) f.set(0, 0, 1); f.normalize();
      const hs = Math.hypot(v.x, v.z), pitch = Math.atan2(v.y, Math.max(0.1, hs)) * 0.9;
      const X = this._X || (this._X = V()), Y = this._Y || (this._Y = V());
      X.copy(f).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
      Y.copy(f).multiplyScalar(-Math.sin(pitch)).addScaledVector(UP, Math.cos(pitch));
      basisQ(X, Y, base);
    }
    const qs = this._qs || (this._qs = new THREE.Quaternion()), qf = this._qf || (this._qf = new THREE.Quaternion());
    qs.setFromAxisAngle(UP, a.spin); qf.setFromAxisAngle(_Z, a.flip);
    return out.copy(base).multiply(qs).multiply(qf);
  }

  land(y) {
    const p = this.pos, v = this.vel, a = this.air;
    p.y = y;
    T.normalAt(p.x, p.z, _n); const n = V().set(_n.x, _n.y, _n.z);
    const q = this.airQuat(new THREE.Quaternion());
    const X = V().set(1, 0, 0).applyQuaternion(q), Y = V().set(0, 1, 0).applyQuaternion(q);
    const impact = -v.dot(n);
    const vt = v.clone().addScaledVector(n, -v.dot(n));
    let vdir = vt.lengthSq() > 1 ? vt.clone().normalize() : X.clone().addScaledVector(n, -X.dot(n)).normalize();
    const Xt = X.clone().addScaledVector(n, -X.dot(n)); if (Xt.lengthSq() < 1e-6) Xt.copy(vdir); Xt.normalize();
    const up = Y.dot(n), align = Math.abs(Xt.dot(vdir));
    const small = a.t < 0.3 && Math.abs(a.spin) < 1.2 && Math.abs(a.flip) < 1.2;
    let quality = 'clean';
    if (!small) {
      if (up < 0.35 || align < 0.5 || impact > 19) quality = 'crash';
      else if (up < 0.68 || align < 0.8 || impact > 13.5) quality = 'sketchy';
    } else if (up < 0.2) quality = 'crash';
    // what you did up there
    const visNose = X.clone().multiplyScalar(this.sw ? -1 : 1);
    const newSw = visNose.dot(vdir) < 0;
    // in the pipe the natural half-turn counts toward the rotation (a 540 is 360 of extra spin)
    const total = a.pipe ? a.spin + Math.sign(a.nat || 1) * Math.PI : a.spin;
    const spins = Math.round(Math.abs(total) / Math.PI) * 180, flips = Math.round(Math.abs(a.flip) / (Math.PI * 2));
    const chestZ = (a.sw ? -1 : 1) * (this.goofy ? -1 : 1);
    const trick = {
      spin: spins, spinDir: Math.sign(total), flips, flipDir: Math.sign(a.flip), frontside: Math.sign(total) * chestZ > 0,
      alley: a.pipe && Math.abs(a.spin) > 1.5 && Math.sign(a.spin) !== Math.sign(a.nat || 1), userSpin: Math.round(Math.abs(a.spin) / Math.PI) * 180,
      sw: a.sw, grab: Object.keys(a.grabs).sort((x, y) => a.grabs[y] - a.grabs[x])[0] || null, grabT: a.grabT, grabs: a.grabs,
      air: a.t, height: Math.max(0, a.maxY - (a.pipe ? a.lipY : Math.max(a.y0, y))), pipe: a.pipe, quality, small, ollie: a.ollie,
      dist: Math.hypot(p.x - a.x0, p.z - a.z0),
    };
    this.air = null;
    if (quality === 'crash') { this.crash(vt, 'landing', trick); return; }
    this.mode = 'ground';
    this.sw = newSw;
    this.heading.copy(vdir);
    v.copy(vt).multiplyScalar(quality === 'clean' ? 0.985 : 0.8);
    if (impact > 9) v.multiplyScalar(Math.max(0.7, 1 - (impact - 9) * 0.02));
    this.n.copy(n);
    this.comp = Math.min(1, 0.25 + impact * 0.07);
    this.emit('land', { trick, impact });
  }

  // ---------------------------------------------------------------- rails & boxes
  checkRails(inp, ground) {
    const p = this.pos, v = this.vel;
    for (const R of T.RAILS) {
      const dx = p.x - R.p0.x, dy = p.y - R.p0.y, dz = p.z - R.p0.z;
      const s = dx * R.dir.x + dy * R.dir.y + dz * R.dir.z;
      if (s < 0.2 || s > R.L - 0.5) continue;
      const cx = R.p0.x + R.dir.x * s, cy = R.p0.y + R.dir.y * s, cz = R.p0.z + R.dir.z * s;
      const lat = Math.abs(p.x - cx), up = p.y - cy;
      if (lat > R.w / 2 + 0.34) continue;
      const along = v.x * R.dir.x + v.y * R.dir.y + v.z * R.dir.z;
      if (along < 1.5) continue;
      if (ground) { if (up < -0.42 || up > 0.1) continue; }
      else if (up < -0.3 || up > 0.45 || v.y > 2.5) continue;
      // lock on
      const air = this.air;
      const nose = V().set(1, 0, 0).applyQuaternion(this.qVis);
      const dirH = V().set(R.dir.x, 0, R.dir.z).normalize();
      const cosA = Math.abs(nose.x * dirH.x + nose.z * dirH.z);
      let slide = cosA > 0.7 ? '5050' : 'board';
      const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (ground && steer) slide = 'board';
      let side = 1;
      if (slide === 'board') {
        if (air) side = Math.sign(air.spin) || 1; else side = steer || 1;
      }
      this.rail = { R, s, v: along, slide, side, t: 0, startS: s, air: air ? { ...air } : null };
      if (air) this.airCarry = { spin: air.spin, flip: air.flip, sw: air.sw, t: air.t, grabs: air.grabs };
      else this.airCarry = null;
      this.mode = 'rail'; this.air = null;
      p.set(cx, cy, cz);
      this.emit('railOn', { name: R.name, type: R.type, slide });
      return true;
    }
    return false;
  }

  stepRail(h, inp) {
    const r = this.rail, R = r.R, p = this.pos;
    r.v += (-G * R.dir.y - (R.type === 'box' ? 0.9 : 0.6)) * h;
    r.s += r.v * h; r.t += h;
    p.set(R.p0.x + R.dir.x * r.s, R.p0.y + R.dir.y * r.s, R.p0.z + R.dir.z * r.s);
    this.vel.set(R.dir.x * r.v, R.dir.y * r.v, R.dir.z * r.v);
    this.speed = r.v;
    r.press = inp.up ? 1 : inp.down ? -1 : 0;
    const jump = !inp.jump && this.charging;
    if (inp.jump) this.charging = true;
    if (r.s > R.L || r.s < 0 || r.v < 0.4 || jump) {
      this.charging = false;
      this.vel.y += jump ? 3.6 : 1.0;
      this.heading.set(R.dir.x, 0, R.dir.z).normalize();
      if (r.slide === 'board') { /* come off sideways: count as a 90 out */ }
      this.mode = 'air';
      this.air = { t: 0, spin: r.slide === 'board' ? r.side * Math.PI / 2 : 0, flip: 0, spinV: r.slide === 'board' ? -r.side * 6.5 : 0, flipV: 0, grab: null, grabT: 0, grabs: {}, y0: p.y, maxY: p.y, x0: p.x, z0: p.z, pipe: false, sw: this.sw, ollie: true, base: new THREE.Quaternion(), lipY: p.y, rail: true };
      this.emit('railOff', { name: R.name, type: R.type, slide: r.slide, time: r.t, dist: Math.abs(r.s - r.startS), press: r.pressT || 0 });
      this.rail = null;
      return;
    }
    if (r.press) r.pressT = (r.pressT || 0) + h;
  }

  // ---------------------------------------------------------------- crashes & collisions
  collide() {
    const col = this.world && this.world.col; if (!col) return;
    const p = this.pos, v = this.vel;
    const o = col.hit(p.x, p.y, p.z, 0.32);
    if (!o) return;
    const sp = v.length();
    if (sp > 7 || this.mode === 'air') { this.crash(v.clone().multiplyScalar(-0.15), o.kind); return; }
    // push out and stop
    if (o.r != null) { const dx = p.x - o.x, dz = p.z - o.z, l = Math.hypot(dx, dz) || 1; p.x = o.x + (dx / l) * (o.r + 0.34); p.z = o.z + (dz / l) * (o.r + 0.34); }
    else { p.addScaledVector(v, -STEP * 2); }
    v.multiplyScalar(0.1);
  }

  crash(v, why, trick) {
    if (this.mode === 'crash') return;
    this.mode = 'crash'; this.crashT = 0; this.air = null; this.rail = null;
    this.vel.copy(v).multiplyScalar(0.7);
    this.tumble.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
    this.charging = false; this.charge = 0;
    this.emit('crash', { why, trick });
  }

  stepCrash(h) {
    const p = this.pos, v = this.vel;
    this.crashT += h;
    v.y -= G * h;
    const y = T.H(p.x, p.z);
    p.addScaledVector(v, h);
    if (p.y <= y + 0.05) {
      p.y = y;
      T.normalAt(p.x, p.z, _n);
      const n = V().set(_n.x, _n.y, _n.z);
      v.addScaledVector(n, -v.dot(n));
      const sp = v.length(), nsp = Math.max(0, sp - 6 * h);
      if (sp > 0) v.multiplyScalar(nsp / sp);
    }
    this.tumble.multiplyScalar(Math.exp(-h * 1.2));
    if (this.crashT > 2.0) this.respawnHere();
  }

  respawnHere() {
    const p = this.pos, P = T.PIPE;
    let x = p.x, z = p.z;
    if (T.inPipe(x, z) || (Math.abs(x - P.x) < P.half + 1 && z > P.z0 && z < P.z1)) { x = P.x; z = Math.min(P.z1 - 14, Math.max(P.z0 + 26, z)); }
    x = Math.max(-560, Math.min(560, x)); z = Math.max(-100, Math.min(1780, z));
    const o = this.world && this.world.col && this.world.col.hit(x, T.H(x, z), z, 0.6);
    if (o && o.r != null) { x += (x - o.x > 0 ? 1 : -1) * (o.r + 1); }
    this.spawn(x, z, { x: 0, z: 1 });
    this.emit('respawn');
  }

  // ---------------------------------------------------------------- orientation for rendering
  updateFrame(dt, inp = {}) {
    const q = this.qTravel;
    if (this.mode === 'ground' || (this.mode === 'crash' && !this.air)) {
      const hd = this.heading, n = this.n;
      const X = this._fx || (this._fx = V()); X.copy(hd).addScaledVector(n, -hd.dot(n)).normalize();
      basisQ(X, n, q);
      const et = this.mode === 'ground' ? (this.edgeTarget || 0) : 0;
      this.roll += (et - this.roll) * (1 - Math.exp(-dt * 8));
      const qr = this._qr || (this._qr = new THREE.Quaternion()); qr.setFromAxisAngle(_X, this.roll);
      q.multiply(qr);
    } else if (this.mode === 'air') {
      this.airQuat(q);
    } else if (this.mode === 'rail') {
      const R = this.rail.R;
      basisQ(V().set(R.dir.x, R.dir.y, R.dir.z), UP.clone(), q);
      if (this.rail.slide === 'board') q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.rail.side * Math.PI / 2));
      if (this.rail.press) q.multiply(new THREE.Quaternion().setFromAxisAngle(_Z, this.rail.press * 0.18));
    }
    this.qVis.copy(q);
    if (this.sw) this.qVis.multiply(qPi);
    if (this.mode === 'crash') {
      const t = this.crashT;
      const qt = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.tumble.x * Math.min(t, 0.9), this.tumble.y * t * 0.3, Math.min(1.4, t * 3) + this.tumble.z * Math.min(t, 0.6) * 0.3));
      this.qVis.multiply(qt);
    }
  }

  // pose parameters for the rider model / network
  poseParams(inp = {}) {
    const a = this.air;
    const charge = this.charging ? this.charge : 0;
    let crouch = 0.22 + Math.abs(this.roll) * 0.35 + this.comp * 0.8 + charge * 0.6;
    if (this.mode === 'rail') crouch = 0.35;
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const bodyFwd = (this.sw ? -1 : 1) * (this.goofy ? -1 : 1);
    return {
      crouch: Math.min(1, crouch),
      lean: this.mode === 'ground' ? steer * bodyFwd * Math.min(1, this.speed / 8) * 0.45 : 0,
      sw: this.sw,
      air: this.mode === 'air' && a && a.t > 0.12,
      grab: a && a.grab,
      tuck: this.mode === 'ground' && inp.up && this.speed > 4 ? 1 : 0,
      brake: this.mode === 'ground' && inp.down ? 1 : 0,
      crash: this.mode === 'crash',
      spin: a ? a.spinV : 0,
      press: this.mode === 'rail' && this.rail.press ? this.rail.press : 0,
      sit: this.mode === 'lift',
    };
  }
}
const _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
