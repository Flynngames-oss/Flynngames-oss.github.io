// Senders — mountain bike physics. Two spring/damper wheel contacts give real suspension, pitching over
// lips and squashing into landings; tyres grip up to a friction limit (so you can drift and skid); pedalling
// is power-limited and air drag caps your top speed. In the air you can flip, spin and pull tricks, and
// how you land decides whether you ride away clean, sketchy... or bail.
import * as THREE from 'three';
import { clamp, lerp, damp, wrapAngle, TAU } from './util.js';
import { SURF } from './course.js';

const GRAV = 9.81;
export const BIKE = {
  mass: 90, L: 1.22, R: 0.37, travel: 0.17, K: 9000, C: 620, Kb: 60000, Cb: 2600, I: 20,
  power: 1150, maxPedalF: 330, dragK: 0.5,
};
const SURFP = {
  [SURF.DIRT]: { grip: 1.0, roll: 0.012 },
  [SURF.GRASS]: { grip: 0.8, roll: 0.03 },
  [SURF.ROCK]: { grip: 0.92, roll: 0.018 },
  [SURF.WOOD]: { grip: 0.95, roll: 0.008 },
  [SURF.SNOW]: { grip: 0.62, roll: 0.04 },
  [SURF.SAND]: { grip: 0.72, roll: 0.035 },
};

const _p = { h: 0, nx: 0, ny: 1, nz: 0, surf: 0, onTrack: true, s: 0, d: 0, dist: 0 };

export class Bike {
  constructor(course) {
    this.course = course;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.f = new THREE.Vector3(); this.u = new THREE.Vector3(); this.left = new THREE.Vector3();
    this.n = new THREE.Vector3(0, 1, 0);
    this.ground = [{ h: 0, n: new THREE.Vector3(0, 1, 0), surf: 0, onTrack: true, s: 0, d: 0, contact: false, comp: 0 }, { h: 0, n: new THREE.Vector3(0, 1, 0), surf: 0, onTrack: true, s: 0, d: 0, contact: false, comp: 0 }];
    this.events = [];
    this.reset(6, 0);
  }
  reset(s, speed) {
    const c = this.course, p = c.pointAt(s), y = c.trackY(s);
    const slope = Math.atan2(c.trackY(s + 0.6) - c.trackY(s - 0.6), 1.2);
    this.yaw = p.h; this.pitch = slope; this.roll = 0;
    this.yawRate = 0; this.pitchRate = 0;
    this.updateAxes();
    this.pos.set(p.x, y + BIKE.R + 0.06, p.z);
    this.vel.copy(this.f).multiplyScalar(speed);
    this.susp = [0.05, 0.05]; this.air = 0; this.airborne = false; this.grounded = true;
    this.crashed = false; this.crashReason = '';
    this.charge = 0; this.jumpHeld = false; this.sinceGround = 0; this.popped = false;
    this.wheelAng = 0; this.crank = 0; this.steerVis = 0;
    this.slip = 0; this.braking = 0; this.pedaling = 0; this.speed = speed; this.vLong = speed;
    this.manual = 0; this.noseManual = 0; this.landSquash = 0;
    this.pitchAccum = 0; this.yawAccum = 0; this.maxAirY = 0;
    this.trickBlock = 0; this.freshLean = false; this.freshSpin = false;
    this.s = s; this.d = 0; this.onTrack = true; this.dist = 0;
    this.frozen = false;
    this.wobble = 0;
    this.events.length = 0;
  }
  updateAxes() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.f.set(sy * cp, sp, cy * cp);
    this.u.set(-sp * sy, cp, -sp * cy);
    this.left.set(cy, 0, -sy);
  }
  emit(type, data = {}) { data.type = type; this.events.push(data); }

  // inp: { steer, pedal, brake, lean, spin, jump, leanFresh, spinFresh, trickHeld (bool: a trick needs the rider off the bike) }
  step(dt, inp) {
    if (this.crashed || this.frozen) return;
    const B = BIKE, c = this.course, m = B.mass;
    this.updateAxes();
    const f = this.f, u = this.u;
    let Fx = 0, Fy = -m * GRAV, Fz = 0, torque = 0, Nsum = 0, nx = 0, ny = 0, nz = 0;
    let anyContact = false, surf = SURF.DIRT;
    for (let w = 0; w < 2; w++) {
      const sg = w === 0 ? 1 : -1, g = this.ground[w];
      const hx = this.pos.x + f.x * sg * B.L / 2, hy = this.pos.y + f.y * sg * B.L / 2, hz = this.pos.z + f.z * sg * B.L / 2;
      c.probe(hx, hz, _p);
      g.h = _p.h; g.n.set(_p.nx, _p.ny, _p.nz); g.surf = _p.surf; g.onTrack = _p.onTrack; g.s = _p.s; g.d = _p.d; g.dist = _p.dist;
      const dist = (hy - _p.h) * _p.ny;
      let comp = B.R - dist;
      g.contact = comp > 0;
      if (g.contact) {
        anyContact = true;
        const pr = sg * B.L / 2 * this.pitchRate;
        const vn = (this.vel.x + u.x * pr) * _p.nx + (this.vel.y + u.y * pr) * _p.ny + (this.vel.z + u.z * pr) * _p.nz;
        let Fs = B.K * Math.min(comp, B.travel) - B.C * vn;
        if (comp > B.travel) Fs += B.Kb * (comp - B.travel) - B.Cb * Math.min(vn, 0) * 1;
        if (Fs < 0) Fs = 0;
        Fx += _p.nx * Fs; Fy += _p.ny * Fs; Fz += _p.nz * Fs;
        torque += sg * B.L / 2 * Fs * (_p.nx * u.x + _p.ny * u.y + _p.nz * u.z);
        Nsum += Fs; nx += _p.nx * Fs; ny += _p.ny * Fs; nz += _p.nz * Fs;
        if (w === 1 || !this.ground[1].contact) surf = _p.surf;
        // hitting a wall face-first
        const wallDot = -(_p.nx * f.x + _p.ny * f.y + _p.nz * f.z);
        if (w === 0 && wallDot > 0.72 && -vn > 6.5) { this.crash('Faceplant'); return; }
        // landing in the drink
        if (comp > B.travel + 0.25 && -vn > 16) { this.crash('Too hard!'); return; }
      }
      this.susp[w] = clamp(comp, 0, B.travel);
    }
    const front = this.ground[0], rear = this.ground[1];
    // where are we on the trail?
    this.s = rear.s; this.d = rear.d; this.onTrack = rear.onTrack || front.onTrack; this.dist = rear.dist;
    const wasAir = this.airborne;
    if (anyContact) { const l = Math.hypot(nx, ny, nz) || 1; this.n.set(nx / l, ny / l, nz / l); }
    // ---------- landing
    if (anyContact && wasAir) {
      if (this.air > 0.18) { if (this.land(inp)) return; }
      this.airborne = false;
    }
    if (!anyContact) { this.sinceGround += dt; if (this.sinceGround > 0.06 && !this.airborne) this.takeoff(); }
    else this.sinceGround = 0;
    this.grounded = anyContact;

    // ---------- jump / bunny hop (hold to crouch, release to pop)
    if (inp.jump) { this.charge = Math.min(1, this.charge + dt / 0.35); this.jumpHeld = true; }
    else if (this.jumpHeld) {
      this.jumpHeld = false;
      const late = !anyContact && this.sinceGround < 0.16 && !this.popped;
      if ((anyContact || late) && this.charge > 0.08) {
        const k = (2.1 + 1.7 * this.charge) * (late ? 0.75 : 1);
        this.vel.addScaledVector(anyContact ? this.n : this.u, k);
        this.pitchRate += 1.0 + this.charge * 0.6;
        this.popped = true;
        this.emit('pop', { power: this.charge });
      }
      this.charge = 0;
    }

    const speed = this.vel.length();
    this.speed = speed;
    // air drag
    const drag = B.dragK * speed;
    Fx -= this.vel.x * drag; Fy -= this.vel.y * drag; Fz -= this.vel.z * drag;

    if (anyContact) {
      const n = this.n;
      // tangent frame: forward along the ground, lateral to the rider's left
      let tx = f.x - n.x * (f.x * n.x + f.y * n.y + f.z * n.z), ty = f.y - n.y * (f.x * n.x + f.y * n.y + f.z * n.z), tz = f.z - n.z * (f.x * n.x + f.y * n.y + f.z * n.z);
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-4) { tx = Math.sin(this.yaw); ty = 0; tz = Math.cos(this.yaw); tl = 1; }
      tx /= tl; ty /= tl; tz /= tl;
      const lx = n.y * tz - n.z * ty, ly = n.z * tx - n.x * tz, lz = n.x * ty - n.y * tx;
      const vLong = this.vel.x * tx + this.vel.y * ty + this.vel.z * tz;
      const vLat = this.vel.x * lx + this.vel.y * ly + this.vel.z * lz;
      this.vLong = vLong;
      const sp = SURFP[surf] || SURFP[0];
      const mu = 1.0 * sp.grip, Nl = Math.max(Nsum, 0), maxF = mu * Nl;
      // pedalling (power limited), braking, rolling resistance
      let Fl = 0;
      const pedal = inp.pedal * (this.manual > 0.5 ? 0.6 : 1);
      if (pedal > 0 && vLong < 16) Fl += pedal * Math.min(B.maxPedalF, B.power / Math.max(vLong, 2.5)) * (1 - smoothFade(vLong, 13, 16));
      this.pedaling = pedal;
      const sgn = vLong >= 0 ? 1 : -1;
      if (inp.brake > 0) {
        const bf = inp.brake * Math.min(1100, maxF * 0.95);
        if (Math.abs(vLong) < 0.4) Fl -= vLong * m * 4; else Fl -= sgn * bf;
      }
      this.braking = inp.brake;
      Fl -= sgn * sp.roll * Nl;
      // lateral grip (relaxes sideways sliding, up to the friction limit)
      const latReq = -vLat * m / 0.05;
      const budget = Math.sqrt(Math.max(0, maxF * maxF - Math.min(Fl * Fl, maxF * maxF * 0.8)));
      const Flat = clamp(latReq, -budget, budget);
      this.slip = damp(this.slip, budget > 1 ? clamp((Math.abs(latReq) - budget) / (budget * 3), 0, 1) : 0, 10, dt);
      if (inp.brake > 0.6 && Math.abs(vLong) > 4) this.slip = Math.max(this.slip, 0.35 * inp.brake * (surf === SURF.WOOD ? 0.3 : 1));
      Fx += tx * Fl + lx * Flat; Fy += ty * Fl + ly * Flat; Fz += tz * Fl + lz * Flat;
      // steering: the yaw rate is limited by how much grip there is
      const v = Math.max(Math.abs(vLong), 0.5);
      const maxRate = Math.min(2.4, (mu * GRAV * 1.12) / v);
      const target = -inp.steer * maxRate * (this.manual > 0.5 ? 0.6 : 1);
      this.yawRate = damp(this.yawRate, target, 9, dt);
      this.yaw += this.yawRate * dt;
      // manuals: lean back (or forward) to balance on one wheel
      const slopeP = Math.asin(clamp(ty, -1, 1));
      const rel = wrapAngle(this.pitch - slopeP);
      if (inp.lean < -0.3 && Math.abs(vLong) > 2.5 && rear.contact) {
        const tgt = 0.24 * Math.min(1, -inp.lean);
        torque += clamp(13000 * (tgt - rel) - 1300 * this.pitchRate, -1600, 1800);
      } else if (inp.lean > 0.3 && Math.abs(vLong) > 2.5 && front.contact) {
        const tgt = -0.18 * Math.min(1, inp.lean);
        torque += clamp(13000 * (tgt - rel) - 1300 * this.pitchRate, -1800, 1600);
      }
      this.manual = rear.contact && !front.contact && rel > 0.06 ? this.manual + dt : 0;
      this.noseManual = front.contact && !rear.contact && rel < -0.06 ? this.noseManual + dt : 0;
      // looped out or went over the bars
      if (rel > 1.15) { this.crash('Looped out'); return; }
      if (rel < -1.0) { this.crash('Over the bars!'); return; }
      torque -= this.pitchRate * 90;
      // lean into the turn
      const lean = Math.atan(v * this.yawRate / GRAV);
      this.roll = damp(this.roll, clamp(lean, -0.85, 0.85) * (1 - this.slip * 0.5), 10, dt);
      this.popped = false;
    } else {
      // ---------- in the air
      this.air += dt;
      this.vLong = speed;
      this.pedaling = 0; this.braking = 0; this.slip = damp(this.slip, 0, 8, dt);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const trajP = Math.atan2(this.vel.y, Math.max(hs, 0.1));
      if (inp.leanFresh && Math.abs(inp.lean) > 0.2) {
        // lean forward (+) = front flip (nose down), lean back (-) = backflip
        this.pitchRate = damp(this.pitchRate, -inp.lean * 5.4, 3.4, dt);
      } else {
        // let go and the rotation stops quickly; near the flight path the bike settles onto it
        const err = wrapAngle(trajP - this.pitch);
        const want = Math.abs(err) < 1.7 ? clamp(err * 2.6, -2.4, 2.4) : this.pitchRate * 0.6;
        this.pitchRate = damp(this.pitchRate, want, Math.abs(this.pitchRate) > 3 ? 7 : 3, dt);
      }
      const velYaw = Math.atan2(this.vel.x, this.vel.z);
      if (inp.spinFresh !== false && Math.abs(inp.spin) > 0.2) {
        this.yawRate = damp(this.yawRate, -inp.spin * 6.6, 4.2, dt);
      } else {
        const err = wrapAngle(velYaw - this.yaw);
        const want = Math.abs(err) < 1.2 ? clamp(err * 2.2, -2.5, 2.5) : this.yawRate * 0.6;
        this.yawRate = damp(this.yawRate, want, Math.abs(this.yawRate) > 3 ? 6 : 3.5, dt);
      }
      this.yaw += this.yawRate * dt;
      this.pitchAccum += this.pitchRate * dt;
      this.yawAccum += this.yawRate * dt;
      this.roll = damp(this.roll, 0, 3, dt);
      this.maxAirY = Math.max(this.maxAirY, this.pos.y - Math.max(front.h, rear.h));
    }
    // ---------- integrate
    this.vel.x += Fx / m * dt; this.vel.y += Fy / m * dt; this.vel.z += Fz / m * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (anyContact) {
      this.pitchRate += torque / B.I * dt;
      this.pitchRate = clamp(this.pitchRate, -9, 9);
    }
    this.pitch += this.pitchRate * dt;
    // keep the pitch angle from winding up after flips
    if (!this.airborne) this.pitch = wrapAngle(this.pitch);
    this.wheelAng += this.vLong / B.R * dt;
    if (this.pedaling > 0) this.crank += Math.max(5, this.vLong * 0.9) * dt * this.pedaling;
    this.steerVis = damp(this.steerVis, anyContact ? clamp(-this.yawRate * 0.25 / Math.max(0.6, this.vLong * 0.12), -0.6, 0.6) : 0, 12, dt);
    this.landSquash = damp(this.landSquash, 0, 4, dt);
    this.wobble = damp(this.wobble, 0, 3, dt);
    if (this.course.lakeY > -1e8 && this.pos.y < this.course.lakeY - 0.2) { this.crash('Splashdown!'); return; }
    this.collideObstacles();
  }

  takeoff() {
    this.airborne = true; this.air = 0;
    this.pitchAccum = 0; this.yawAccum = 0; this.maxAirY = 0;
    this.pitchRate *= 0.35;
    this.emit('takeoff', { speed: this.speed });
  }

  // returns true if we crashed
  land(inp) {
    const n = this.n, f = this.f, v = this.vel;
    const impact = -(v.x * n.x + v.y * n.y + v.z * n.z);
    let tx = f.x - n.x * f.dot(n), ty = f.y - n.y * f.dot(n), tz = f.z - n.z * f.dot(n);
    const tl = Math.hypot(tx, ty, tz) || 1; ty /= tl;
    const slopeP = Math.asin(clamp(ty, -1, 1));
    // the bike's real pitch relative to the ground, ignoring whole flips
    const dPitch = wrapAngle(this.pitch - slopeP);
    // upside down?
    const upDot = this.u.x * n.x + this.u.y * n.y + this.u.z * n.z;
    const hs = Math.hypot(v.x, v.z);
    const velYaw = Math.atan2(v.x, v.z);
    const dYaw = hs > 3 ? wrapAngle(this.yaw - velYaw) : 0;
    const airTime = this.air;
    const flips = this.pitchAccum, spins = this.yawAccum;
    let reason = '';
    if (inp.trickHeld) reason = 'Still mid-trick!';
    else if (n.y < 0.5 && impact > 4) reason = 'Came up short!';
    else if (upDot < 0.25) reason = 'Landed upside down';
    else if (dPitch > 0.95) reason = 'Over-rotated... backwards';
    else if (dPitch < -0.95) reason = 'Nose dive!';
    else if (Math.abs(dYaw) > 1.1) reason = 'Landed sideways';
    else if (impact > 14.5) reason = 'Flat landing - too hard!';
    if (reason) { this.crash(reason, { airTime, flips, spins, impact }); return true; }
    const perfect = Math.abs(dPitch) < 0.2 && Math.abs(dYaw) < 0.2 && impact < 9;
    const sketchy = Math.abs(dPitch) > 0.55 || Math.abs(dYaw) > 0.55 || impact > 11;
    // straighten up and carry on
    this.yaw = this.yaw - dYaw * (sketchy ? 0.5 : 0.8);
    this.pitch = slopeP + dPitch * 0.6;
    this.pitchRate *= 0.25; this.yawRate *= 0.2;
    if (sketchy) { this.vel.multiplyScalar(0.85); this.wobble = 1; }
    this.landSquash = clamp(impact / 9, 0.2, 1);
    this.emit('land', { airTime, flips, spins, impact, perfect, sketchy, height: this.maxAirY });
    this.air = 0;
    return false;
  }

  collideObstacles() {
    const c = this.course, p = this.pos;
    let hit = null;
    const fx = p.x + this.f.x * 0.55, fz = p.z + this.f.z * 0.55;
    c.obstaclesNear(p.x, p.z, (o) => {
      if (hit) return;
      const top = o.top !== undefined ? o.top : o.y + 30;
      if (p.y - 0.25 > top) return;
      for (const [qx, qz, pad] of [[fx, fz, 0.18], [p.x, p.z, 0.3]]) {
        const dx = qx - o.x, dz = qz - o.z, d = Math.hypot(dx, dz), rr = o.r + pad;
        if (d < rr) {
          const nx = dx / (d || 1), nz = dz / (d || 1);
          const into = -(this.vel.x * nx + this.vel.z * nz);
          if (into > 4.2) { hit = o.top !== undefined ? 'Hit a rock!' : 'Hugged a tree!'; return; }
          // shove away and slide along it
          p.x += nx * (rr - d); p.z += nz * (rr - d);
          if (into > 0) { this.vel.x += nx * into * 1.2; this.vel.z += nz * into * 1.2; this.vel.multiplyScalar(0.92); }
          return;
        }
      }
    });
    if (hit) this.crash(hit);
  }

  crash(reason, data = {}) {
    if (this.crashed) return;
    this.crashed = true; this.crashReason = reason;
    this.emit('crash', Object.assign({ reason, speed: this.vel.length() }, data));
  }
}

function smoothFade(x, a, b) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
export { TAU, lerp };
