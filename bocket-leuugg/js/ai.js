// Bots: read where the ball is going, pick a job (go for the ball, back up a teammate, grab boost),
// then drive there with the same buttons a player has: throttle, steer, boost, powerslide, jumps and flips.
import * as THREE from 'three';
import { Ball, stepBall } from './physics.js';
import { L, PADS, BALL_R } from './arena.js';

const V = THREE.Vector3;
const _l = new V(), _d = new V(), _q = new THREE.Quaternion(), _up = new V(), _f = new V();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// where the ball will be over the next three seconds
const scratch = new Ball();
export function predictBall(ball, out) {
  scratch.pos.copy(ball.pos); scratch.vel.copy(ball.vel); scratch.w.copy(ball.w);
  out.length = 0;
  const dt = 1 / 30;
  for (let i = 1; i <= 90; i++) {
    stepBall(scratch, dt);
    out.push({ t: i * dt, x: scratch.pos.x, y: scratch.pos.y, z: scratch.pos.z });
  }
  return out;
}

export const SKILLS = [
  { name: 'Rookie', react: 0.22, boostUse: 0.35, flips: false, aerial: false, speedFac: 0.85, maxH: 1.7 },
  { name: 'Pro', react: 0.1, boostUse: 0.75, flips: true, aerial: false, speedFac: 1, maxH: 3.2 },
  { name: 'All-Star', react: 0.04, boostUse: 1, flips: true, aerial: true, speedFac: 1.1, maxH: 7 },
];

export class Bot {
  constructor(car, skill = 1) {
    this.car = car; this.sk = SKILLS[skill] || SKILLS[1];
    this.seq = null; this.seqT = 0; this.stuckT = 0; this.reverseT = 0; this.think = 0;
    this.target = new V(); this.role = 'attack'; this.aerial = false;
  }

  localAngle(tx, tz, ty = null) {
    const c = this.car;
    _q.copy(c.q).invert();
    _l.set(tx - c.pos.x, (ty === null ? c.pos.y : ty) - c.pos.y, tz - c.pos.z).applyQuaternion(_q);
    return Math.atan2(-_l.x, _l.z);
  }

  startSeq(steps) { this.seq = steps; this.seqT = 0; }

  update(m, dt, preds) {
    const c = this.car, inp = c.in, sk = this.sk;
    inp.throttle = 0; inp.steer = 0; inp.pitch = 0; inp.jump = false; inp.boost = false; inp.slide = false; inp.roll = 0;
    if (c.demo) return;
    const dir = c.team === 0 ? 1 : -1;               // which way we attack
    const ownZ = -dir * L, oppZ = dir * L;
    const ball = m.ball;

    // a scripted move in progress (jumps / flips)
    if (this.seq) {
      this.seqT += dt;
      let cur = null;
      for (const s of this.seq) if (this.seqT >= s.t) cur = s;
      if (cur) { Object.assign(inp, cur.in); }
      if (this.seq.length && this.seqT > this.seq[this.seq.length - 1].t + 0.05) this.seq = null;
      if (this.aerial) this.aerialSteer(ball, inp);
      return;
    }

    // in the air: land on the wheels
    if (c.contacts === 0) {
      if (this.aerial && c.airT < 2.5) { this.aerialSteer(ball, inp); inp.boost = c.boost > 0; return; }
      this.aerial = false;
      this.recover(inp);
      return;
    }

    // --- pick a job
    const kickoff = m.kickoff;
    const mates = m.cars.filter((o) => o.team === c.team && !o.demo);
    const score = (o) => {
      const goalSide = (ball.pos.z - o.pos.z) * dir > -1;
      return o.pos.distanceTo(ball.pos) + (goalSide ? 0 : 18) - o.speed() * 0.3;
    };
    let best = c, bs = Infinity;
    for (const o of mates) { const s = score(o); if (s < bs) { bs = s; best = o; } }
    this.role = best === c ? 'attack' : (c.boost < 30 ? 'boost' : 'support');
    if (kickoff) {
      // closest one goes for the ball, the others hang back
      let near = c, nd = Infinity;
      for (const o of mates) { const d = o.pos.distanceTo(ball.pos); if (d < nd - 0.5) { nd = d; near = o; } }
      this.role = near === c ? 'kickoff' : 'support';
    }

    const sp = c.speed();
    let tx, tz, ty = 0, wantBoost = false, arrive = false;

    if (this.role === 'kickoff') {
      tx = ball.pos.x; tz = ball.pos.z - dir * 1.1;
      wantBoost = true;
      const d = Math.hypot(tx - c.pos.x, tz - c.pos.z);
      if (d < 5.5 + sp * 0.05 && sk.flips && c.onGround) {
        this.startSeq([{ t: 0, in: { jump: true, throttle: 1 } }, { t: 0.07, in: { jump: false, throttle: 1 } }, { t: 0.1, in: { jump: true, pitch: 1, throttle: 1 } }, { t: 0.25, in: { jump: false, pitch: 1 } }]);
      }
    } else if (this.role === 'attack') {
      // find the first place we can reach the ball in time
      let ip = preds[preds.length - 1];
      const reach = (Math.max(sp, 10) + (c.boost > 10 ? 6 : 0)) * sk.speedFac;
      for (const p of preds) {
        if (p.y > sk.maxH + BALL_R) continue;
        const dd = Math.hypot(p.x - c.pos.x, p.z - c.pos.z) - 1.6;
        if (dd <= p.t * reach) { ip = p; break; }
      }
      // aim: towards their goal, or away from ours if we're defending deep
      let ax = 0 - ip.x, az = oppZ - ip.z;
      const deep = (ip.z - ownZ) * dir < 25;
      const behind = (ip.z - c.pos.z) * dir > -0.5;
      if (deep && !behind) { ax = ip.x - 0; az = ip.z - ownZ; }
      const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      const dist = Math.hypot(ip.x - c.pos.x, ip.z - c.pos.z);
      const off = clamp(dist * 0.35, 0.8, 5);
      tx = ip.x - ax * off; tz = ip.z - az * off; ty = ip.y;
      if (!behind && dist < 14 && !deep) {
        // on the wrong side of the ball: loop round to get goal side
        tx = ip.x + (c.pos.x > ip.x ? 5 : -5); tz = ip.z - dir * 9;
      }
      wantBoost = dist > 9 && Math.random() < sk.boostUse;
      const ang = this.localAngle(ip.x, ip.z);
      // jumps and flips at the ball
      if (c.onGround && Math.abs(ang) < 0.35) {
        const hd = Math.hypot(ball.pos.x - c.pos.x, ball.pos.z - c.pos.z);
        const bh = ball.pos.y;
        if (sk.aerial && ip.y > 4 && ip.t < 2.2 && c.boost > 30 && dist < ip.y * 2.4 + 4 && c.groundN.y > 0.9) {
          this.aerial = true;
          this.startSeq([{ t: 0, in: { jump: true } }, { t: 0.2, in: { jump: false } }, { t: 0.24, in: { jump: true } }, { t: 0.3, in: { jump: false } }]);
        } else if (bh > 1.9 && bh < 4.2 && hd < bh * 1.3 + 0.5 && sk.flips) {
          this.startSeq([{ t: 0, in: { jump: true, throttle: 1 } }, { t: 0.2, in: { jump: false } }, { t: 0.24, in: { jump: true } }, { t: 0.3, in: { jump: false } }]);
        } else if (bh < 1.7 && hd < 3.0 + sp * 0.06 && sp > 7 && sk.flips) {
          this.startSeq([{ t: 0, in: { jump: true, throttle: 1 } }, { t: 0.06, in: { jump: false, throttle: 1 } }, { t: 0.09, in: { jump: true, pitch: 1 } }, { t: 0.2, in: { jump: false, pitch: 1 } }]);
        }
      }
    } else if (this.role === 'boost') {
      // nearest big pad that's ready, not too far forward
      let bp = null, bd = Infinity;
      for (let i = 0; i < PADS.length; i++) {
        const p = PADS[i];
        if (!p.big || m.pads[i].t > 0) continue;
        const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z) + ((p.z - ball.pos.z) * dir > 10 ? 40 : 0);
        if (d < bd) { bd = d; bp = p; }
      }
      if (bp) { tx = bp.x; tz = bp.z; wantBoost = false; } else { this.role = 'support'; }
    }
    if (this.role === 'support') {
      tx = ball.pos.x * 0.45; tz = ownZ * 0.55 + ball.pos.z * 0.45;
      if ((tz - ownZ) * dir < 8) tz = ownZ + dir * 8;
      arrive = true;
    }

    // --- drive
    const ang = this.localAngle(tx, tz);
    const d = Math.hypot(tx - c.pos.x, tz - c.pos.z);
    inp.steer = clamp(ang * 3.2, -1, 1);
    inp.throttle = 1;
    if (arrive && d < 6) inp.throttle = d < 2 ? 0 : 0.4;
    if (Math.abs(ang) > 1.4 && sp > 7 && c.onGround) inp.slide = true;
    if (wantBoost && Math.abs(ang) < 0.3 && sp < 22.5 && c.boost > 0 && c.onGround) inp.boost = true;
    if (kickoff && this.role === 'kickoff') inp.boost = c.boost > 0 && Math.abs(ang) < 0.5;
    // reverse out of being stuck
    if (this.reverseT > 0) { this.reverseT -= dt; inp.throttle = -1; inp.steer = -inp.steer; inp.boost = false; }
    else if (!m.frozen && c.onGround && sp < 1.5) { this.stuckT += dt; if (this.stuckT > 1.2) { this.reverseT = 0.8; this.stuckT = 0; } }
    else this.stuckT = 0;
    // driving on a wall for no reason: come down
    if (c.onGround && c.groundN.y < 0.5 && this.role !== 'attack') { inp.jump = !c.jumped && Math.random() < 0.05; }
  }

  // in the air: turn the wheels to the ground and face where we're going
  recover(inp) {
    const c = this.car;
    _q.copy(c.q).invert();
    const tl = _up.set(0, 1, 0).applyQuaternion(_q);
    const wl = _d.copy(c.w).applyQuaternion(_q);
    const rollErr = Math.atan2(tl.x, tl.y), pitchErr = Math.atan2(tl.z, tl.y);
    inp.roll = clamp(-rollErr * 2.2 - wl.z * 0.35, -1, 1);
    inp.pitch = clamp(pitchErr * 2.2 - wl.x * 0.35, -1, 1);
    const vh = Math.hypot(c.vel.x, c.vel.z);
    if (vh > 3 && Math.abs(rollErr) < 0.8) {
      const a = this.localAngle(c.pos.x + c.vel.x, c.pos.z + c.vel.z);
      inp.steer = clamp(a * 1.5 - wl.y * 0.3, -1, 1);
    }
    inp.throttle = 1;
  }

  // point the nose at the ball while flying
  aerialSteer(ball, inp) {
    const c = this.car;
    _q.copy(c.q).invert();
    _l.subVectors(ball.pos, c.pos);
    _l.y += 0.4;
    _l.applyQuaternion(_q).normalize();
    const wl = _d.copy(c.w).applyQuaternion(_q);
    inp.pitch = clamp(-_l.y * 4 - wl.x * 0.4, -1, 1);
    inp.steer = clamp(Math.atan2(-_l.x, _l.z) * 3 - wl.y * 0.3, -1, 1);
    inp.boost = c.boost > 0 && _l.z > 0.7;
  }
}
