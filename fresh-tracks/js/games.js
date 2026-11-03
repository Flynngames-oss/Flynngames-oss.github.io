// Winter Games (Olympic-style events): Halfpipe, Slopestyle, Big Air and Giant Slalom.
// Three runs each (two for GS). Judges score style events 0–100 from difficulty, amplitude, variety and
// landings; best run counts (Big Air: best two jumps added up). A field of 11 rivals competes with you.
import * as T from './terrain.js';
import { judgeValue, trickName, railName } from './tricks.js';
import { rng } from './noise.js';

export const EVENTS = {
  pipe: { id: 'pipe', name: 'Halfpipe', runs: 3, icon: '🛹', desc: 'Superpipe, 22 ft walls. Go wall to wall, spin, flip and grab. Judges score your whole run.', start: { x: T.PIPE.x, z: T.PIPE.z0 - 3 }, finishZ: T.PIPE.z1 - 14, limit: 45 },
  slope: { id: 'slope', name: 'Slopestyle', runs: 3, icon: '🏔️', desc: 'Rails up top, then three jump sections. Pick your line and stomp it.', start: { x: T.SLOPE.x, z: T.SLOPE.zStart }, finishZ: T.SLOPE.zFinish, limit: 90 },
  bigair: { id: 'bigair', name: 'Big Air', runs: 3, icon: '🚀', desc: 'One massive kicker. Three jumps, your best two count. Go big!', start: { x: T.BIGAIR.x, z: T.BIGAIR.zStart }, finishZ: T.BIGAIR.z + T.BIGAIR.deck + T.BIGAIR.land + 6, limit: 30 },
  gs: { id: 'gs', name: 'Giant Slalom', runs: 2, icon: '⏱️', desc: 'Race through 22 gates on the Cruiser. Miss a gate: +2 seconds. Fastest total time wins.', start: { x: T.TRAILS[5].cx(T.GS.zStart + 3), z: T.GS.zStart + 3 }, finishZ: T.GS.zFinish, limit: 120, timed: true },
};
export const LEVELS = [
  { id: 'rookie', name: 'Rookie', mean: 52, sd: 12, gs: 58 },
  { id: 'pro', name: 'Pro', mean: 70, sd: 10, gs: 50 },
  { id: 'olympian', name: 'Olympian', mean: 84, sd: 7, gs: 45 },
];
const RIVALS = [
  ['Mika Lindqvist', '🇸🇪'], ['Jonah Reyes', '🇺🇸'], ['Haruki Sato', '🇯🇵'], ['Lena Vogt', '🇩🇪'], ['Tomás Ibarra', '🇦🇷'], ['Sophie Martin', '🇫🇷'],
  ['Aleksi Koskinen', '🇫🇮'], ['Chloe Tremblay', '🇨🇦'], ['Ben Walker', '🇦🇺'], ['Ji-ho Park', '🇰🇷'], ['Nils Berg', '🇳🇴'], ['Emma Fischer', '🇨🇭'],
];

export class Games {
  constructor() { this.active = null; }

  start(evId, levelId, me) {
    const ev = EVENTS[evId], lv = LEVELS.find((l) => l.id === levelId) || LEVELS[1];
    const r = rng(Date.now() & 0xffff);
    const field = RIVALS.slice().sort(() => r() - 0.5).slice(0, 11).map(([name, flag], i) => ({ name, flag, skill: lv.mean + (r() - 0.5) * lv.sd * 1.4 + (i < 2 ? lv.sd * 0.6 : 0), runs: [] }));
    for (const f of field) {
      for (let k = 0; k < ev.runs; k++) {
        if (ev.timed) { const t = lv.gs + (100 - f.skill) * 0.08 + (r() - 0.3) * 2.2 + (r() < 0.08 ? 4 : 0); f.runs.push(Math.round(t * 100) / 100); }
        else { const fall = r() < 0.18; const s = fall ? 12 + r() * 25 : Math.min(98.5, Math.max(20, f.skill + (r() - 0.5) * lv.sd * 2)); f.runs.push(Math.round(s * 100) / 100); }
      }
    }
    this.active = { ev, lv, field, me: { name: me.name || 'You', flag: me.flag || '🏳️', runs: [], me: true }, run: 0, state: 'intro', log: [], t: 0, crashed: false, gate: 0, missed: 0, done: false };
    return this.active;
  }
  stop() { this.active = null; }

  beginRun() {
    const A = this.active; if (!A) return;
    A.state = 'countdown'; A.t = 0; A.cd = 3.2; A.log = []; A.crashed = false; A.gate = 0; A.missed = 0; A.endT = 0; A.landed = 0; A.lastZ = null; A.seen = {};
  }

  // events from the physics while a run is live
  onEvent(e) {
    const A = this.active; if (!A || A.state !== 'run') return null;
    if (e.type === 'land' && !e.trick.small) {
      const name = trickName(e.trick);
      let v = judgeValue(e.trick, A.ev.id);
      const rep = A.seen[name] || 0; A.seen[name] = rep + 1;
      if (rep) v *= Math.pow(0.5, rep);
      A.log.push({ name, v, q: e.trick.quality, h: e.trick.height });
      if (A.ev.id === 'bigair') { A.landed = 1; A.endT = 1.8; }
      return { name, v };
    }
    if (e.type === 'railOff') {
      const name = railName(e);
      let v = 5 + Math.min(e.time, 1.6) * 9 + (e.slide === 'board' ? 2 : 0);
      const rep = A.seen[name] || 0; A.seen[name] = rep + 1; if (rep) v *= Math.pow(0.6, rep);
      A.log.push({ name, v, rail: true });
      return { name, v };
    }
    if (e.type === 'crash') { A.crashed = true; A.endT = 2.2; A.log.push({ name: 'Fall', v: 0, fall: true }); }
    return null;
  }

  // returns 'go' when the countdown finishes, 'end' when the run is over
  update(dt, player) {
    const A = this.active; if (!A) return null;
    if (A.state === 'countdown') { A.cd -= dt; if (A.cd <= 0) { A.state = 'run'; A.t = 0; return 'go'; } return null; }
    if (A.state !== 'run') return null;
    A.t += dt;
    const ev = A.ev, p = player.pos;
    if (ev.timed) {
      const g = T.GATES[A.gate];
      if (g && A.lastZ != null && A.lastZ < g.z && p.z >= g.z) {
        if (Math.abs(p.x - g.x) > g.w / 2 + 0.6) { A.missed++; A.flash = 'Missed gate +2s'; }
        A.gate++;
      }
      A.lastZ = p.z;
    }
    if (A.endT > 0) { A.endT -= dt; if (A.endT <= 0) return this.endRun(); }
    if (p.z > ev.finishZ && !A.endT) { A.endT = ev.timed ? 0.01 : 1.2; }
    if (A.t > ev.limit && !A.endT) A.endT = 0.01;
    if (ev.id === 'pipe' && player.speed < 1.5 && A.t > 4 && player.mode === 'ground' && !A.endT) A.endT = 0.8;
    return null;
  }

  runScore() {
    const A = this.active, ev = A.ev;
    if (ev.timed) {
      if (A.crashed || A.gate < T.GATES.length - 2) return { dnf: true, score: 999, text: 'DNF' };
      const t = A.t + A.missed * 2;
      return { score: Math.round(t * 100) / 100, text: t.toFixed(2) + 's' + (A.missed ? ` (${A.missed} missed)` : '') };
    }
    const tricks = A.log.filter((l) => !l.fall);
    let sum;
    if (ev.id === 'bigair') sum = tricks.length ? Math.max(...tricks.map((t) => t.v)) : 0;
    else sum = tricks.reduce((s, t) => s + t.v, 0);
    const k = ev.id === 'bigair' ? 40 : ev.id === 'pipe' ? 105 : 120;
    let s = 100 * (1 - Math.exp(-sum / k));
    if (A.crashed) s = Math.min(38, s * 0.35);
    s = Math.max(ev.id === 'bigair' && A.crashed ? 5 : 1, Math.min(99.5, s));
    return { score: Math.round(s * 100) / 100, text: s.toFixed(2) };
  }

  endRun() {
    const A = this.active;
    const r = this.runScore();
    A.me.runs.push(r.score);
    A.state = 'results'; A.lastRun = r; A.run++;
    A.done = A.run >= A.ev.runs;
    return 'end';
  }

  best(c) {
    const ev = this.active.ev;
    if (!c.runs.length) return ev.timed ? 9999 : 0;
    if (ev.timed) return Math.round(c.runs.reduce((a, b) => a + b, 0) * 100) / 100;
    if (ev.id === 'bigair') { const s = c.runs.slice().sort((a, b) => b - a); return Math.round(((s[0] || 0) + (s[1] || 0)) * 100) / 100; }
    return Math.max(...c.runs);
  }
  // rivals only show the runs that have happened so far
  standings() {
    const A = this.active, ev = A.ev, n = A.run;
    const list = A.field.map((f) => ({ ...f, runs: f.runs.slice(0, n) })).concat([A.me]);
    for (const c of list) c.best = this.best(c);
    list.sort((a, b) => (ev.timed ? a.best - b.best : b.best - a.best));
    return list;
  }
}
