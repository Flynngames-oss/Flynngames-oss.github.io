// Senders — cameras: chase (follows your line, widens with speed, floats behind you over jumps), far chase,
// helmet cam, trackside "TV" cameras, a crash cam that watches you tumble, and a slow orbit for the menus.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, wrapAngle } from './util.js';

export const CAM_MODES = ['Chase', 'Far chase', 'Helmet cam', 'Trackside'];

export class CameraRig {
  constructor(camera) {
    this.cam = camera; this.mode = 0;
    this.pos = new THREE.Vector3(0, 5, -10); this.look = new THREE.Vector3();
    this.yaw = 0; this.y = 0; this.fov = 70;
    this.shakeAmp = 0; this.shakeT = 0; this.rumble = 0;
    this.side = null; this.orbit = 0;
    this._v = new THREE.Vector3(); this._t = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this.snapNext = true;
  }
  snap() { this.snapNext = true; this.side = null; }
  shake(a) { this.shakeAmp = Math.min(1.2, this.shakeAmp + a); }
  update(dt, ctx) {
    const { bike, course } = ctx, cam = this.cam;
    const snap = this.snapNext; this.snapNext = false;
    const k = snap ? 1e3 : 1;
    const bp = bike.pos, sp = bike.speed;
    const hs = Math.hypot(bike.vel.x, bike.vel.z);
    const velYaw = hs > 2 ? Math.atan2(bike.vel.x, bike.vel.z) : bike.yaw;
    let fovT = 70;
    let rollT = 0;
    if (ctx.mode === 'orbit') {
      // menu cinematics: a new shot every few seconds, rider framed to one side of the screen
      this.orbit += dt;
      if (snap || !this.shot || this.orbit > this.shot.len) {
        const shots = [{ a: 1.25, d: 6.5, h: 1.2 }, { a: 0.55, d: 8, h: 1.6 }, { a: 2.2, d: 7, h: 2.2 }, { a: -1.3, d: 6, h: 0.9 }, { a: 1.6, d: 11, h: 3.5 }, { a: -0.7, d: 7.5, h: 1.4 }];
        this.shot = Object.assign({ len: 5 + Math.random() * 3 }, shots[Math.floor(Math.random() * shots.length)]);
        this.orbit = 0; this.cut = true;
      }
      const sh = this.shot, a = velYaw + sh.a + this.orbit * 0.04 * Math.sign(sh.a);
      this._t.set(bp.x + Math.sin(a) * sh.d, 0, bp.z + Math.cos(a) * sh.d);
      this._t.y = Math.max(bp.y + sh.h, course.heightAt(this._t.x, this._t.z) + 0.8);
      if (this.cut) { this.pos.copy(this._t); this.cut = false; } else this.pos.lerp(this._t, 1 - Math.exp(-4 * dt));
      // shift the aim so the rider sits on the free side of the screen
      const fx = bp.x - this.pos.x, fz = bp.z - this.pos.z, fl = Math.hypot(fx, fz) || 1;
      const rx = -fz / fl, rz = fx / fl;     // camera right
      const shift = (ctx.frame || 0) * sh.d * 0.3;
      this.look.set(bp.x + rx * shift, bp.y + 0.6, bp.z + rz * shift);
      fovT = 50;
    } else if (ctx.crashed) {
      const c = ctx.focus;
      this._t.copy(this.pos);
      const dx = this._t.x - c.x, dz = this._t.z - c.z, dl = Math.hypot(dx, dz) || 1;
      const want = clamp(dl, 4.5, 8);
      this._t.x = c.x + dx / dl * want; this._t.z = c.z + dz / dl * want;
      this._t.y = Math.max(c.y + 2.2, course.heightAt(this._t.x, this._t.z) + 1.2);
      this.pos.lerp(this._t, 1 - Math.exp(-2.5 * dt));
      this.look.lerp(c, 1 - Math.exp(-7 * dt));
      fovT = 62;
    } else if (this.mode === 2) {
      // helmet cam
      const P = ctx.rider.P;
      this._v.set(Math.sin(bike.yaw) * Math.cos(bike.pitch), Math.sin(bike.pitch), Math.cos(bike.yaw) * Math.cos(bike.pitch));
      this.pos.copy(P.head).addScaledVector(this._v, 0.16); this.pos.y += 0.04;
      this._t.set(Math.sin(velYaw), 0, Math.cos(velYaw)).lerp(this._v, bike.airborne ? 0.7 : 0.5).normalize();
      this._t.y += -0.12;
      this.look.copy(this.pos).addScaledVector(this._t, 10);
      fovT = 88 + clamp((sp - 10) * 0.6, 0, 12);
      rollT = bike.roll * 0.55;
    } else if (this.mode === 3) {
      // trackside cameras that hand over as you pass
      if (!this.side || bike.s > this.side.s + 14 || bike.s < this.side.s - 120) {
        const s = Math.min(course.L + 30, bike.s + 34 + Math.random() * 30), d = (Math.random() < 0.5 ? -1 : 1) * (course.hw + 5 + Math.random() * 6);
        const p = course.pointAt(s, d);
        this.side = { s, x: p.x, z: p.z, y: course.heightAt(p.x, p.z) + 1.2 + Math.random() * 2.5 };
        this.pos.set(this.side.x, this.side.y, this.side.z);
        this.look.set(bp.x, bp.y + 0.8, bp.z);
      }
      this.look.lerp(this._v.set(bp.x, bp.y + 0.7, bp.z), 1 - Math.exp(-10 * dt));
      const dist = this.pos.distanceTo(bp);
      fovT = clamp(900 / (dist + 8), 22, 70);
    } else {
      // chase cams
      const far = this.mode === 1;
      this.yaw = snap ? velYaw : dampAngle(this.yaw, velYaw, bike.airborne ? 2.2 : 4.2, dt);
      const dist = (far ? 6.6 : 3.9) + clamp(sp, 0, 25) * (far ? 0.08 : 0.055);
      const hgt = (far ? 2.6 : 1.45) + clamp(sp, 0, 25) * 0.015;
      const tx = bp.x - Math.sin(this.yaw) * dist, tz = bp.z - Math.cos(this.yaw) * dist;
      const g = course.heightAt(tx, tz);
      let ty = Math.max(bp.y + hgt, g + 0.9);
      // keep the rider in view over crests: lift if the ground between camera and rider is in the way
      const mx = (tx + bp.x) / 2, mz = (tz + bp.z) / 2, mg = course.heightAt(mx, mz);
      ty = Math.max(ty, mg + 1.2);
      this.y = snap ? ty : damp(this.y, ty, bike.airborne ? 3.0 : 8, dt);
      if (this.y < g + 0.6) this.y = g + 0.6;
      this._t.set(tx, this.y, tz);
      this.pos.x = snap ? tx : damp(this.pos.x, tx, 14, dt); this.pos.z = snap ? tz : damp(this.pos.z, tz, 14, dt); this.pos.y = this.y;
      const ahead = far ? 3 : 2.4;
      this._v.set(bp.x + Math.sin(this.yaw) * ahead, bp.y + (far ? 0.5 : 0.75), bp.z + Math.cos(this.yaw) * ahead);
      this.look.lerp(this._v, snap ? 1 : 1 - Math.exp(-16 * dt));
      fovT = (far ? 62 : 68) + clamp((sp - 7) * 0.95, 0, 20);
      rollT = bike.roll * 0.12;
    }
    void k;
    this.fov = damp(this.fov, fovT, 3, dt);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    cam.position.copy(this.pos);
    // shake
    this.shakeT += dt;
    this.shakeAmp = damp(this.shakeAmp, 0, 4, dt);
    const r = this.shakeAmp * 0.12 + this.rumble * 0.012;
    if (r > 0.0005) {
      cam.position.x += (Math.sin(this.shakeT * 53) + Math.sin(this.shakeT * 31)) * r;
      cam.position.y += (Math.sin(this.shakeT * 47) + Math.cos(this.shakeT * 29)) * r;
    }
    cam.lookAt(this.look);
    if (rollT) { this._q.setFromAxisAngle(this._v.set(0, 0, 1), -rollT); cam.quaternion.multiply(this._q); }
  }
}
export { lerp, wrapAngle };
