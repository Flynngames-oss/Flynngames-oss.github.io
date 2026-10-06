// Senders — tricks, landings and the combo / rep system.
// Held tricks (Superman, Tabletop, No Hander, Can-Can) score more the longer you hold them - but let go
// before you land! Tailwhips and barspins are one-shot spins. Flips and spins come from the bike's rotation.
// Everything you do chains into a combo with a growing multiplier; it banks into Rep a few seconds after your
// last trick, and a bail loses the lot.
import { clamp, damp, TAU } from './util.js';

export const TRICKS = {
  superman: { name: 'Superman', base: 450, perSec: 900 },
  tabletop: { name: 'Tabletop', base: 400, perSec: 750 },
  nohander: { name: 'No Hander', base: 400, perSec: 800 },
  cancan: { name: 'Can-Can', base: 350, perSec: 700 },
  whip: { name: 'Tailwhip', base: 1100, dur: 0.55 },
  barspin: { name: 'Barspin', base: 750, dur: 0.42 },
};
const HELD = ['superman', 'tabletop', 'nohander', 'cancan'];

export class TrickSystem {
  constructor() { this.reset(); this.listeners = []; }
  on(fn) { this.listeners.push(fn); }
  emit(e) { for (const f of this.listeners) f(e); }
  reset() {
    this.w = { superman: 0, tabletop: 0, nohander: 0, cancan: 0, nofooter: 0, whip: 0, barspin: 0 };
    this.vis = { roll: 0, yaw: 0, whip: 0, barspin: 0 };
    this.held = { superman: 0, tabletop: 0, nohander: 0, cancan: 0 };
    this.spin = { whip: -1, barspin: -1 };
    this.count = { whip: 0, barspin: 0 };
    this.combo = 0; this.comboMult = 1; this.comboTimer = 0; this.comboNames = [];
    this.lastTrickTime = 0;
    this.manualScore = 0;
    this.speedCool = 0; this.closeCool = new Map();
    this.prevKeys = {}; this.queue = {};
    this.runRep = 0;
  }
  trickHeld() {
    for (const k of HELD) if (this.w[k] > 0.45) return true;
    for (const k of ['whip', 'barspin']) if (this.spin[k] >= 0 && this.spin[k] < 0.88) return true;
    return false;
  }
  // keys: { up, down, left, right, whip, barspin } booleans (trick buttons)
  update(dt, bike, keys, time) {
    const air = bike.airborne && bike.air > 0.1 && !bike.crashed;
    for (const k of HELD) {
      const want = air && keys[k === 'superman' ? 'up' : k === 'tabletop' ? 'down' : k === 'nohander' ? 'left' : 'right'] ? 1 : 0;
      this.w[k] = damp(this.w[k], want, want ? 11 : 14, dt);
      if (this.w[k] < 0.01 && !want) this.w[k] = 0;
      if (air && this.w[k] > 0.75) this.held[k] += dt;
    }
    for (const k of ['whip', 'barspin']) {
      // presses are remembered briefly, so tapping right as you leave the lip still counts
      if (keys[k] && !this.prevKeys[k]) this.queue[k] = 0.35;
      this.queue[k] = Math.max(0, (this.queue[k] || 0) - dt);
      if (this.queue[k] > 0 && air && this.spin[k] < 0) { this.spin[k] = 0; this.queue[k] = 0; }
      if (this.spin[k] >= 0) {
        this.spin[k] += dt / TRICKS[k].dur;
        if (this.spin[k] >= 1) { this.spin[k] = -1; this.count[k]++; this.emit({ type: 'trickDone', name: TRICKS[k].name }); }
      }
      this.w[k] = this.spin[k] >= 0 ? Math.sin(Math.min(1, this.spin[k]) * Math.PI) : damp(this.w[k], 0, 12, dt);
    }
    for (const k in keys) this.prevKeys[k] = keys[k];
    // what the bike model shows
    const ease = (t) => t < 0 ? 0 : t * t * (3 - 2 * t);
    this.vis.whip = this.spin.whip >= 0 ? ease(this.spin.whip) * TAU : 0;
    this.vis.barspin = this.spin.barspin >= 0 ? ease(this.spin.barspin) * TAU : 0;
    this.vis.roll = this.w.tabletop * 1.15;
    this.vis.yaw = this.w.tabletop * 0.45 - this.w.cancan * 0.12;
    // combo timer & manuals
    if (bike.manual > 0.5 || bike.noseManual > 0.5) {
      this.manualScore += dt * 320;
      this.comboTimer = Math.max(this.comboTimer, 1.2);
    } else if (this.manualScore > 0) {
      const secs = this.manualScore / 320 + 0.5;
      if (secs > 1.0) this.addToCombo(Math.round(this.manualScore), `${bike.noseManual > bike.manual ? 'Nose ' : ''}Manual ${secs.toFixed(1)}s`, 'manual', { secs });
      this.manualScore = 0;
    }
    if (this.combo > 0 && !bike.airborne) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.bank();
    }
    // speed bonus
    this.speedCool -= dt;
    if (bike.speed * 3.6 > 70 && this.speedCool <= 0 && !bike.crashed) { this.speedCool = 7; this.addToCombo(250, 'Full Send!', 'speed'); }
  }
  closeCall(id, time) {
    const last = this.closeCool.get(id) || -99;
    if (time - last < 5) return;
    this.closeCool.set(id, time);
    this.addToCombo(220, 'Close call!', 'close');
  }
  addToCombo(score, name, kind, data) {
    this.combo += score;
    this.comboMult = Math.min(10, this.comboMult + (kind === 'speed' || kind === 'close' ? 0.5 : 1));
    this.comboTimer = 3.2;
    this.comboNames.push(name);
    this.emit({ type: 'trick', name, score, kind, data });
  }
  bank() {
    if (this.combo <= 0) return;
    const total = Math.round(this.combo * Math.max(1, Math.floor(this.comboMult)));
    this.runRep += total;
    this.emit({ type: 'bank', total, mult: Math.max(1, Math.floor(this.comboMult)), base: this.combo, names: this.comboNames.slice() });
    this.combo = 0; this.comboMult = 1; this.comboTimer = 0; this.comboNames = [];
  }
  lose() {
    if (this.combo > 0) this.emit({ type: 'lost', total: this.combo });
    this.combo = 0; this.comboMult = 1; this.comboTimer = 0; this.comboNames = [];
    for (const k of HELD) { this.w[k] = 0; this.held[k] = 0; }
    this.spin.whip = this.spin.barspin = -1; this.count.whip = this.count.barspin = 0;
    this.manualScore = 0;
  }
  takeoff() {
    for (const k of HELD) this.held[k] = 0;
    this.count.whip = this.count.barspin = 0;
  }
  // a clean landing: work out what was done in the air
  landed(e) {
    const parts = [];
    let score = 0;
    const flipsRaw = -e.flips / TAU;   // positive pitch accumulation is nose-up = backflip
    const nFlips = Math.round(Math.abs(flipsRaw));
    if (nFlips >= 1 && Math.abs(Math.abs(flipsRaw) - nFlips) < 0.32) {
      const back = flipsRaw < 0;
      const name = (nFlips === 2 ? 'Double ' : nFlips === 3 ? 'Triple ' : '') + (back ? 'Backflip' : 'Frontflip');
      parts.push({ name, kind: back ? 'backflip' : 'frontflip', n: nFlips });
      score += (back ? 1500 : 1800) * nFlips * (1 + 0.4 * (nFlips - 1));
    }
    const spinDeg = Math.abs(e.spins) * 180 / Math.PI;
    const nSpin = Math.round(spinDeg / 360);
    if (nSpin >= 1 && Math.abs(spinDeg - nSpin * 360) < 75) {
      const deg = nSpin * 360;
      const flat = nFlips >= 1;
      parts.push({ name: flat ? `Corked ${deg}` : `${deg}`, kind: 'spin', n: nSpin });
      score += 900 * nSpin * (1 + 0.5 * (nSpin - 1)) * (flat ? 1.5 : 1);
    }
    for (const k of HELD) {
      if (this.held[k] > 0.15) {
        parts.push({ name: TRICKS[k].name, kind: k, secs: this.held[k] });
        score += TRICKS[k].base + TRICKS[k].perSec * this.held[k];
      }
    }
    for (const k of ['whip', 'barspin']) if (this.count[k] > 0) {
      const n = this.count[k];
      parts.push({ name: (n === 2 ? 'Double ' : n >= 3 ? `${n}x ` : '') + TRICKS[k].name, kind: k, n });
      score += TRICKS[k].base * n * (1 + 0.3 * (n - 1));
    }
    if (e.airTime > 0.55) {
      const big = e.airTime > 1.6;
      const air = Math.round(120 * Math.pow(e.airTime, 1.6) + (big ? 400 : 0));
      if (!parts.length || big) parts.push({ name: big ? `Big Air ${e.airTime.toFixed(1)}s` : `Air ${e.airTime.toFixed(1)}s`, kind: 'air' });
      score += air;
    }
    if (!parts.length) { this.takeoff(); return null; }
    if (e.perfect) score *= 1.3; else if (e.sketchy) score *= 0.7;
    score = Math.round(score / 10) * 10;
    const name = parts.map((p) => p.name).join(' + ');
    this.combo += score;
    this.comboMult = Math.min(10, this.comboMult + parts.filter((p) => p.kind !== 'air').length + (e.perfect ? 0.5 : 0) + (parts.some((p) => p.kind === 'air') ? 0.5 : 0));
    this.comboTimer = 3.2;
    this.comboNames.push(name);
    const res = { type: 'jump', name, score, parts, perfect: e.perfect, sketchy: e.sketchy, airTime: e.airTime };
    this.emit(res);
    this.takeoff();
    return res;
  }
}
export { clamp };
