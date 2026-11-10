// Car and ball physics. Fixed step (120 per second). One car is a rigid box riding on four spring
// wheels that ray-march against the arena. Ground handling, boost, jumps, double jumps, flips with
// flip cancels, air control and air roll, powerslide, wall driving, demolitions and ball hits.
import * as THREE from 'three';
import { free, normalAt, ray, BALL_R } from './arena.js';

export const GRAV = 6.5;
export const HX = 0.42, HY = 0.18, HZ = 0.59;           // car hitbox half sizes (width, height, length)
export const MAX_SPEED = 23, SUPERSONIC = 21.9, BALL_MAX = 60, MAX_ANG = 5.5;
export const WHEELS = [[0.36, -0.05, 0.38], [-0.36, -0.05, 0.38], [0.36, -0.05, -0.36], [-0.36, -0.05, -0.36]];
export const WHEEL_R = 0.16;
export const SUS_LEN = 0.22;                             // spring rest length + wheel radius
const SUS_K = 450, SUS_C = 24;
const INV_I = [1 / 0.38, 1 / 0.52, 1 / 0.21];            // inverse inertia (local x, y, z)
const BALL_M = 1 / 6;                                    // the ball weighs a sixth of a car
export const JUMP_V = 2.92, JUMP_HOLD_A = 14.58, JUMP_HOLD_T = 0.2, FLIP_WINDOW = 1.25;
export const BOOST_A = 9.92, BOOST_USE = 33.3;

const V = THREE.Vector3, Q = THREE.Quaternion;
const _up = new V(), _fw = new V(), _hp = new V(), _r = new V(), _vp = new V(), _n = new V(), _tn = new V();
const _a = new V(), _b = new V(), _t = new V(), _t2 = new V(), _p = new V(), _n2 = new V(), _vt = new V();
const _l = new V(), _rel = new V(), _vc = new V(), _h = new V(), _q = new Q(), _q2 = new Q();
const WORLD_UP = new V(0, 1, 0);

export function blankInput() { return { throttle: 0, steer: 0, pitch: 0, jump: false, boost: false, slide: false, roll: 0 }; }

function invI(c, v, out) {
  _q.copy(c.q).invert();
  out.copy(v).applyQuaternion(_q);
  out.x *= INV_I[0]; out.y *= INV_I[1]; out.z *= INV_I[2];
  return out.applyQuaternion(c.q);
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function driveAccel(v) {
  if (v < 14) return 16 - 14.4 * v / 14;
  if (v < 14.1) return 1.6 * (14.1 - v) / 0.1;
  return 0;
}
const CURV = [[0, 0.69], [5, 0.398], [10, 0.235], [15, 0.1375], [17.5, 0.11], [23, 0.088]];
function curvature(v) {
  for (let i = 1; i < CURV.length; i++) {
    if (v <= CURV[i][0]) {
      const [x0, y0] = CURV[i - 1], [x1, y1] = CURV[i];
      return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
    }
  }
  return CURV[CURV.length - 1][1];
}

export class Car {
  constructor(team) {
    this.team = team;
    this.pos = new V(); this.vel = new V(); this.q = new Q(); this.w = new V();
    this.in = blankInput(); this.prevJump = false;
    this.boost = 33; this.boosting = false;
    this.wheelT = [SUS_LEN, SUS_LEN, SUS_LEN, SUS_LEN];
    this.contacts = 0; this.onGround = false; this.groundN = new V(0, 1, 0);
    this.jumped = false; this.jumpT = 0; this.jumpHold = 0;
    this.canFlip = false; this.flipLimit = 0; this.airT = 0; this.flipT = 0; this.flipAxis = new V();
    this.dodged = false;
    this.bodyTouch = false; this.bodyN = new V(0, 1, 0); this.stuckT = 0;
    this.demo = false; this.respawnT = 0; this.demoN = 0;
    this.super = false; this.hitCool = 0;
    this.sim = true;
  }
  fwd(out) { return out.set(0, 0, 1).applyQuaternion(this.q); }
  up(out) { return out.set(0, 1, 0).applyQuaternion(this.q); }
  place(x, y, z, yaw) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.q.setFromAxisAngle(WORLD_UP, yaw);
    this.jumped = false; this.canFlip = false; this.flipT = 0; this.airT = 0; this.jumpHold = 0;
    this.demo = false; this.boosting = false; this.stuckT = 0;
  }
  speed() { return this.vel.length(); }
}

function selfRight(c, up, fwd) {
  const n = c.bodyN;
  c.vel.addScaledVector(n, 3.2);
  _a.crossVectors(up, n);
  if (_a.lengthSq() < 1e-4) _a.copy(fwd);
  c.w.copy(_a.normalize()).multiplyScalar(MAX_ANG);
}

export function stepCar(c, dt, frozen) {
  if (c.demo) return;
  const inp = frozen ? BLANK : c.in;
  const up = c.up(_up), fwd = c.fwd(_fw);
  if (c.hitCool > 0) c.hitCool -= dt;

  // --- suspension: four spring wheels
  let contacts = 0;
  _n.set(0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const wp = WHEELS[i];
    _hp.set(wp[0], wp[1], wp[2]).applyQuaternion(c.q).add(c.pos);
    const t = ray(_hp.x, _hp.y, _hp.z, -up.x, -up.y, -up.z, SUS_LEN);
    if (t < 0) { c.wheelT[i] = SUS_LEN; continue; }
    c.wheelT[i] = t; contacts++;
    _n.add(normalAt(_hp.x - up.x * t, _hp.y - up.y * t, _hp.z - up.z * t, _tn));
    const comp = SUS_LEN - t;
    _r.subVectors(_hp, c.pos);
    _vp.crossVectors(c.w, _r).add(c.vel);
    const rate = -_vp.dot(up);
    let F = SUS_K * comp + SUS_C * rate;
    if (F < 0) F = 0; else if (F > 400) F = 400;
    c.vel.addScaledVector(up, F * dt);
    _t.copy(up).multiplyScalar(F * dt);
    _t2.crossVectors(_r, _t);
    c.w.add(invI(c, _t2, _t2));
  }
  c.contacts = contacts;
  if (contacts) _n.normalize(); else _n.copy(WORLD_UP);
  c.groundN.copy(_n);

  const justJumped = c.jumped && c.jumpT < 0.12;
  if (contacts >= 3 && !justJumped) {
    c.onGround = true; c.jumped = false; c.canFlip = false; c.flipT = 0; c.airT = 0; c.dodged = false;
  } else {
    c.onGround = false;
    if (contacts === 0) {
      if (!c.jumped && !c.dodged && c.airT === 0) { c.canFlip = true; c.flipLimit = 1e9; } // drove off a ramp: flip kept
      c.airT += dt;
    }
  }

  // --- gravity and the sticky force that keeps wheels on walls
  c.vel.y -= GRAV * dt;
  if (contacts >= 3 && !justJumped) c.vel.addScaledVector(_n, -3.25 * dt);

  const boosting = inp.boost && c.boost > 0;

  if (c.onGround) {
    const n = _n;
    const ft = _a.copy(fwd).addScaledVector(n, -fwd.dot(n)).normalize();
    const lt = _b.crossVectors(n, ft);
    const vf = c.vel.dot(ft), vl = c.vel.dot(lt), av = Math.abs(vf);
    let th = inp.throttle;
    if (boosting) th = 1;
    let dv;
    if (th !== 0 && vf * th < 0 && av > 0.1) {           // braking
      dv = Math.sign(th) * 35 * dt * Math.min(1, Math.abs(th) * 1.5);
      if (Math.abs(dv) > av) dv = -vf;
    } else if (th !== 0) {
      dv = th * driveAccel(av) * dt;
    } else {                                              // coasting
      const d = 5.25 * dt;
      dv = av < d ? -vf : -Math.sign(vf) * d;
    }
    c.vel.addScaledVector(ft, dv);
    const kl = (inp.slide ? 1.4 : 16) * (n.y > 0.6 ? 1 : 0.7);
    c.vel.addScaledVector(lt, -vl * (1 - Math.exp(-kl * dt)));
    let cv = curvature(av);
    if (inp.slide) cv *= 1.45;
    const target = -inp.steer * cv * vf;
    const wn = c.w.dot(n);
    c.w.addScaledVector(n, (target - wn) * Math.min(1, 16 * dt));
    _t.copy(c.w).addScaledVector(n, -c.w.dot(n));
    c.w.addScaledVector(_t, -Math.min(1, 4 * dt));
  } else if (contacts === 0) {
    _q.copy(c.q).invert();
    const wl = _t.copy(c.w).applyQuaternion(_q);
    if (c.flipT > 0) {
      c.flipT -= dt;
      // stick against the flip cancels it
      if (c.flipAxis.x !== 0 && inp.pitch * c.flipAxis.x < -0.3) c.flipAxis.x *= 0.85;
      wl.x = c.flipAxis.x * MAX_ANG;
      wl.z = c.flipAxis.z * MAX_ANG;
      wl.y += (-8.92 * inp.steer * 0.3) * dt;
      if (c.flipT > 0.5) c.vel.y += GRAV * dt * 0.9;     // a moment of float at the start of a flip
    } else {
      const p = inp.pitch;
      let y = inp.steer, r = inp.roll;
      if (inp.slide) { r = clamp(r + inp.steer, -1, 1); y = 0; }
      wl.x += (12.15 * p - 2.8 * (1 - Math.abs(p)) * wl.x) * dt;
      wl.y += (-8.92 * y - 1.89 * (1 - Math.abs(y)) * wl.y) * dt;
      wl.z += (36.08 * r - 4.47 * wl.z) * dt;
    }
    c.w.copy(wl.applyQuaternion(c.q));
    if (!boosting) c.vel.addScaledVector(fwd, inp.throttle * 0.67 * dt);
  }

  // --- boost
  c.boosting = boosting;
  if (boosting) {
    c.vel.addScaledVector(fwd, BOOST_A * dt);
    c.boost = Math.max(0, c.boost - BOOST_USE * dt);
  }

  // --- jumping, double jumps and flips
  const pressed = inp.jump && !c.prevJump;
  c.prevJump = inp.jump;
  c.jumpT += dt;
  if (c.jumpHold > 0) {
    if (inp.jump) { c.vel.addScaledVector(up, JUMP_HOLD_A * dt); c.jumpHold -= dt; } else c.jumpHold = 0;
  }
  if (pressed) {
    if (contacts >= 2 && !c.jumped) {
      c.vel.addScaledVector(up, JUMP_V);
      c.jumped = true; c.jumpT = 0; c.jumpHold = JUMP_HOLD_T; c.canFlip = true; c.flipLimit = FLIP_WINDOW; c.airT = 0;
      c.onGround = false; c.events = (c.events || 0) | 1;
    } else if (contacts < 2 && c.bodyTouch) {
      selfRight(c, up, fwd);
    } else if (contacts === 0 && c.canFlip && c.airT < c.flipLimit) {
      c.canFlip = false; c.dodged = true;
      let sx = inp.steer, sy = inp.pitch;
      const mag = Math.hypot(sx, sy);
      if (mag < 0.5) {
        c.vel.addScaledVector(up, JUMP_V);               // double jump
        c.events = (c.events || 0) | 1;
      } else {
        if (mag > 1) { sx /= mag; sy /= mag; }
        const fh = _a.set(fwd.x, 0, fwd.z);
        if (fh.lengthSq() < 0.01) fh.set(-up.x, 0, -up.z);
        if (fh.lengthSq() < 0.01) fh.set(0, 0, 1);
        fh.normalize();
        const rh = _b.set(-fh.z, 0, fh.x);
        const fs = Math.abs(c.vel.dot(fh));
        c.vel.addScaledVector(fh, sy * (sy > 0 ? 5.0 : 5.33));
        c.vel.addScaledVector(rh, sx * 5.0 * (1 + 0.9 * Math.min(1, fs / 23)));
        if (c.vel.y < 0) c.vel.y *= 0.25;
        c.flipT = 0.65;
        c.flipAxis.set(sy, 0, sx).normalize();
        c.events = (c.events || 0) | 2;
      }
    }
  }

  // stuck on the roof or side for a while: flip back over by itself
  if (c.bodyTouch && contacts < 2 && c.vel.lengthSq() < 2.5) {
    c.stuckT += dt;
    if (c.stuckT > 1.6) { selfRight(c, up, fwd); c.stuckT = 0; }
  } else c.stuckT = 0;

  // --- integrate
  const sp = c.vel.length();
  if (sp > MAX_SPEED) c.vel.multiplyScalar(MAX_SPEED / sp);
  const ws = c.w.length();
  if (ws > MAX_ANG) c.w.multiplyScalar(MAX_ANG / ws);
  c.super = c.vel.length() >= SUPERSONIC;
  c.pos.addScaledVector(c.vel, dt);
  integrateQ(c.q, c.w, dt);

  hullArena(c);
  if (frozen) { c.vel.x = 0; c.vel.z = 0; c.w.set(0, 0, 0); }
}
const BLANK = blankInput();

function integrateQ(q, w, dt) {
  _q2.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(q);
  q.x += _q2.x; q.y += _q2.y; q.z += _q2.z; q.w += _q2.w;
  q.normalize();
}

const HULL = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) HULL.push([sx * HX, sy * HY, sz * HZ]);
HULL.push([0, HY, 0], [0, -HY, 0], [0, 0, HZ], [0, 0, -HZ], [HX, 0, 0], [-HX, 0, 0], [0, HY, HZ * 0.5], [0, HY, -HZ * 0.5]);

function hullArena(c) {
  c.bodyTouch = false;
  for (const h of HULL) {
    _p.set(h[0], h[1], h[2]).applyQuaternion(c.q).add(c.pos);
    const d = free(_p.x, _p.y, _p.z);
    if (d >= 0) continue;
    normalAt(_p.x, _p.y, _p.z, _n2);
    c.bodyTouch = true; c.bodyN.copy(_n2);
    c.pos.addScaledVector(_n2, -d);
    _r.subVectors(_p, c.pos);
    _vp.crossVectors(c.w, _r).add(c.vel);
    const vn = _vp.dot(_n2);
    if (vn >= 0) continue;
    _t.crossVectors(_r, _n2); invI(c, _t, _t); _t2.crossVectors(_t, _r);
    const j = -1.15 * vn / (1 + _n2.dot(_t2));
    c.vel.addScaledVector(_n2, j);
    _t.crossVectors(_r, _n2).multiplyScalar(j); c.w.add(invI(c, _t, _t));
    _vt.copy(_vp).addScaledVector(_n2, -vn);
    const vtl = _vt.length();
    if (vtl > 1e-4) {
      _vt.multiplyScalar(1 / vtl);
      _t.crossVectors(_r, _vt); invI(c, _t, _t); _t2.crossVectors(_t, _r);
      const jt = Math.min(vtl / (1 + _vt.dot(_t2)), 0.4 * j);
      c.vel.addScaledVector(_vt, -jt);
      _t.crossVectors(_r, _vt).multiplyScalar(-jt); c.w.add(invI(c, _t, _t));
    }
  }
}

export class Ball {
  constructor() { this.pos = new V(0, BALL_R, 0); this.vel = new V(); this.w = new V(); this.q = new Q(); }
  reset() { this.pos.set(0, BALL_R + 0.02, 0); this.vel.set(0, 0, 0); this.w.set(0, 0, 0); }
}

export function stepBall(b, dt) {
  b.vel.y -= GRAV * dt;
  b.vel.multiplyScalar(1 - 0.03 * dt);
  b.w.multiplyScalar(1 - 0.05 * dt);
  b.pos.addScaledVector(b.vel, dt);
  let bounced = 0;
  const d = free(b.pos.x, b.pos.y, b.pos.z) - BALL_R;
  if (d < 0) {
    normalAt(b.pos.x, b.pos.y, b.pos.z, _n);
    b.pos.addScaledVector(_n, -d);
    const vn = b.vel.dot(_n);
    if (vn < 0) {
      const e = vn < -1.5 ? 0.6 : 0;
      b.vel.addScaledVector(_n, -(1 + e) * vn);
      if (vn < -3) bounced = -vn;
      _vt.copy(b.vel).addScaledVector(_n, -b.vel.dot(_n));
      _t.crossVectors(b.w, _n).multiplyScalar(-BALL_R);
      _vc.addVectors(_vt, _t);
      const cl = _vc.length();
      if (cl > 1e-4) {
        const maxJ = 0.35 * (1 + e) * (-vn) + 0.002;
        let dv = cl * 2 / 7;
        if (dv > maxJ) dv = maxJ;
        _vc.multiplyScalar(-dv / cl);
        b.vel.add(_vc);
        _t.crossVectors(_n, _vc).multiplyScalar(-5 / (2 * BALL_R));
        b.w.add(_t);
      }
    }
  }
  const s = b.vel.length();
  if (s > BALL_MAX) b.vel.multiplyScalar(BALL_MAX / s);
  const ws = b.w.length();
  if (ws > 6) b.w.multiplyScalar(6 / ws);
  integrateQ(b.q, b.w, dt);
  return bounced;
}

// car touches ball. applyCar = false for a car someone else is driving (we only move the ball)
export function carBall(c, b, applyCar) {
  if (c.demo) return 0;
  _q.copy(c.q).invert();
  _l.subVectors(b.pos, c.pos).applyQuaternion(_q);
  const cx = clamp(_l.x, -HX, HX), cy = clamp(_l.y, -HY, HY), cz = clamp(_l.z, -HZ, HZ);
  const dx = _l.x - cx, dy = _l.y - cy, dz = _l.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > BALL_R * BALL_R) return 0;
  let d = Math.sqrt(d2);
  if (d < 1e-5) { _n.set(0, 1, 0); d = 0; } else _n.set(dx / d, dy / d, dz / d);
  _n.applyQuaternion(c.q);
  _p.set(cx, cy, cz).applyQuaternion(c.q).add(c.pos);
  b.pos.addScaledVector(_n, BALL_R - d);
  _r.subVectors(_p, c.pos);
  _vc.crossVectors(c.w, _r).add(c.vel);
  _rel.subVectors(b.vel, _vc);
  const vn = _rel.dot(_n);
  if (vn >= 0) return 0;
  _t.crossVectors(_r, _n); invI(c, _t, _t); _t2.crossVectors(_t, _r);
  const k = 1 / BALL_M + (applyCar ? 1 + _n.dot(_t2) : 0);
  const j = -vn / k;
  b.vel.addScaledVector(_n, j / BALL_M);
  if (applyCar) {
    c.vel.addScaledVector(_n, -j);
    _t.crossVectors(_r, _n).multiplyScalar(-j); c.w.add(invI(c, _t, _t));
  }
  const relSpeed = Math.min(46, _rel.length());
  if (c.hitCool <= 0) {
    const s = relSpeed < 5 ? 0.65 : relSpeed < 23 ? 0.65 - 0.1 * (relSpeed - 5) / 18 : 0.55 - 0.25 * (relSpeed - 23) / 23;
    c.up(_up); c.fwd(_fw);
    _h.subVectors(b.pos, c.pos);
    _h.addScaledVector(_up, -0.65 * _h.dot(_up)).normalize();
    _h.addScaledVector(_fw, -0.35 * _h.dot(_fw)).normalize();
    b.vel.addScaledVector(_h, relSpeed * s);
    c.hitCool = 0.1;
  }
  _vt.copy(_rel).addScaledVector(_n, -vn);
  _t.crossVectors(_n, _vt).multiplyScalar(0.6 / BALL_R);
  b.w.add(_t);
  const s = b.vel.length();
  if (s > BALL_MAX) b.vel.multiplyScalar(BALL_MAX / s);
  return relSpeed + 0.01;
}

// two cars bump. onDemo(victim, attacker) is only passed by whoever runs the match
const CS = [-0.22, 0, 0.22], CR = 0.42;
const _pa = new V(), _pb = new V(), _ba = new V(), _bb = new V(), _fa = new V(), _fb = new V();
export function carCar(a, b, onDemo) {
  if (a.demo || b.demo) return;
  if (a.pos.distanceToSquared(b.pos) > 6.25) return;
  a.fwd(_fa); b.fwd(_fb);
  let best = 0, bi = 0, bj = 0;
  for (let i = 0; i < 3; i++) {
    _pa.copy(a.pos).addScaledVector(_fa, CS[i]);
    for (let j = 0; j < 3; j++) {
      _pb.copy(b.pos).addScaledVector(_fb, CS[j]);
      const pen = 2 * CR - _pa.distanceTo(_pb);
      if (pen > best) { best = pen; bi = i; bj = j; _ba.copy(_pa); _bb.copy(_pb); }
    }
  }
  if (best <= 0) return;
  const n = _n.subVectors(_bb, _ba);
  const dl = n.length();
  if (dl < 1e-5) n.set(0, 1, 0); else n.multiplyScalar(1 / dl);
  if (a.sim) a.pos.addScaledVector(n, -best / 2);
  if (b.sim) b.pos.addScaledVector(n, best / 2);
  const vn = _rel.subVectors(b.vel, a.vel).dot(n);
  if (vn >= 0) return;
  const jv = -1.2 * vn / 2;
  const sa = a.vel.dot(n), sb = -b.vel.dot(n);
  if (a.sim) a.vel.addScaledVector(n, -jv);
  if (b.sim) b.vel.addScaledVector(n, jv);
  // the faster car hitting with its nose is the attacker
  const tryHit = (att, vic, frontHit, toward, dir) => {
    if (!frontHit || toward < 4) return false;
    if (att.super && att.team !== vic.team && onDemo) { onDemo(vic, att); return true; }
    if (vic.sim) vic.vel.addScaledVector(dir, toward * 0.3).addScaledVector(WORLD_UP, toward * 0.12);
    return false;
  };
  if (sa >= sb) tryHit(a, b, bi === 2, sa, n);
  else tryHit(b, a, bj === 2, sb, _n2.copy(n).negate());
}

export function demolish(c) {
  c.demo = true; c.respawnT = 3; c.demoN++; c.boosting = false;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
export function packCar(c) {
  return [c.pos.x, c.pos.y, c.pos.z, c.q.x, c.q.y, c.q.z, c.q.w, c.vel.x, c.vel.y, c.vel.z, c.w.x, c.w.y, c.w.z].map(r3);
}
export function unpackInto(o, s) {
  o.pos.set(s[0], s[1], s[2]); o.q.set(s[3], s[4], s[5], s[6]).normalize(); o.vel.set(s[7], s[8], s[9]); o.w.set(s[10], s[11], s[12]);
}
export function packBall(b) {
  return [b.pos.x, b.pos.y, b.pos.z, b.q.x, b.q.y, b.q.z, b.q.w, b.vel.x, b.vel.y, b.vel.z, b.w.x, b.w.y, b.w.z].map(r3);
}
