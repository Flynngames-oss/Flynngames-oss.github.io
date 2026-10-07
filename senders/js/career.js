// Senders — career: work your way through five worlds. Each world has four levels where you pick one of
// three trails (each rated for steepness, curviness and stunts, with a bonus objective that earns a life),
// then the world's boss jump. Bails cost a life; run out and the career is over. Beating a boss unlocks
// starting your next career from that world. Rep is your score, saved forever.
import { WORLDS } from './worlds.js';
import { mulberry32, hashStr, pick, rrange, clamp } from './util.js';

const SAVE = 'senders.save.v1';
export const MAX_LIVES = 10;
export const START_LIVES = 6;
export const RANKS = [[0, 'Rookie'], [20000, 'Local Shredder'], [80000, 'Trail Ripper'], [200000, 'Sender'], [450000, 'Pro Rider'], [900000, 'Mountain Legend'], [2000000, 'Senders Icon']];
export const rankOf = (rep) => { let r = RANKS[0][1]; for (const [n, name] of RANKS) if (rep >= n) r = name; return r; };

export const COLOR_SETS = {
  frame: [0xff5a14, 0x1e1f24, 0xf2f2f2, 0x2a6fe0, 0x2fbf5f, 0xe23a3a, 0xf0c020, 0x8a3fd0, 0x18c0c8, 0xff7ab8],
  accent: [0x18c0c8, 0xff5a14, 0xf0c020, 0xf2f2f2, 0x1e1f24, 0xe23a3a, 0x2fbf5f, 0x2a6fe0],
  jersey: ['#ff5a14', '#1e1f24', '#f2f2f2', '#2a6fe0', '#2fbf5f', '#e23a3a', '#f0c020', '#8a3fd0', '#18c0c8', '#ff7ab8'],
  pants: [0x1e1f24, 0x3a3f4a, 0x5a4a3a, 0x203060, 0x2a4a2a, 0x6a6a6a],
  helmet: [0xf2f2f2, 0x1e1f24, 0xff5a14, 0x2a6fe0, 0xf0c020, 0xe23a3a, 0x2fbf5f, 0x8a3fd0],
};
const DEFAULT_PROFILE = {
  totalRep: 0, bestRun: 0, unlockedWorld: 0, careers: 0, bossesBeaten: 0,
  rider: { frame: 0xff5a14, accent: 0x18c0c8, jersey: '#1e1f24', jacc: '#ff5a14', pants: 0x1e1f24, helmet: 0xf2f2f2 },
  settings: { quality: null, music: 0.7, sfx: 0.9, camera: 0, hints: true },
  career: null, best: {},
};

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(SAVE));
    if (p) return Object.assign({}, DEFAULT_PROFILE, p, { rider: Object.assign({}, DEFAULT_PROFILE.rider, p.rider), settings: Object.assign({}, DEFAULT_PROFILE.settings, p.settings) });
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
}
export function saveProfile(p) { try { localStorage.setItem(SAVE, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }

// ------------------------------------------------------------------ objectives
const OBJ = {
  jumps: (n) => ({ id: 'jumps', n, text: `Land ${n} jumps`, unit: '' }),
  backflip: () => ({ id: 'backflip', n: 1, text: 'Land a backflip' }),
  frontflip: () => ({ id: 'frontflip', n: 1, text: 'Land a frontflip' }),
  spin: () => ({ id: 'spin', n: 1, text: 'Land a 360' }),
  combo: (n) => ({ id: 'combo', n, text: `Bank a ${n.toLocaleString('en-US')} rep combo` }),
  speed: (n) => ({ id: 'speed', n, text: `Hit ${n} km/h` }),
  perfects: (n) => ({ id: 'perfects', n, text: `${n} perfect landings` }),
  nobail: () => ({ id: 'nobail', n: 1, text: 'Finish without bailing' }),
  time: (n) => ({ id: 'time', n, text: `Finish in under ${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}` }),
  manual: (n) => ({ id: 'manual', n, text: `Manual for ${n} seconds` }),
  superman: () => ({ id: 'superman', n: 1, text: 'Pull a Superman' }),
  whip: () => ({ id: 'whip', n: 1, text: 'Land a tailwhip' }),
  close: (n) => ({ id: 'close', n, text: `${n} close calls with trees` }),
  air: (n) => ({ id: 'air', n, text: `${n} seconds of total air` }),
  rep: (n) => ({ id: 'rep', n, text: `Earn ${n.toLocaleString('en-US')} rep in one run` }),
};

export function makeObjective(r, wi, opt) {
  const d = wi / 4;  // world difficulty 0..1
  const st = opt.stunts;
  const choices = [
    () => OBJ.jumps(Math.round(3 + st * 0.8)),
    () => OBJ.backflip(), () => OBJ.spin(), () => OBJ.superman(), () => OBJ.whip(),
    () => OBJ.combo(Math.round((2500 + d * 9000 + st * 600) / 500) * 500),
    () => OBJ.speed(Math.round(58 + opt.steep * 3 + d * 8)),
    () => OBJ.perfects(Math.round(2 + st * 0.5 + d * 2)),
    () => OBJ.nobail(),
    () => OBJ.manual(2), () => OBJ.air(Math.round(4 + st * 1.5 + d * 3)),
    () => OBJ.rep(Math.round((5000 + d * 25000 + st * 2000) / 1000) * 1000),
  ];
  if (WORLDS[wi].id === 'forest' || WORLDS[wi].treeDensity > 0.5) choices.push(() => OBJ.close(Math.round(3 + d * 3)));
  if (d > 0.4) choices.push(() => OBJ.frontflip());
  return pick(r, choices)();
}

export class ObjectiveTracker {
  constructor(obj) { this.obj = obj; this.prog = 0; this.done = false; this.failed = false; this.jumps = 0; this.perfects = 0; this.air = 0; this.close = 0; }
  // returns true the moment it completes
  event(e) {
    if (this.done || !this.obj) return false;
    const o = this.obj;
    switch (e.type) {
      case 'jump':
        if (o.id === 'jumps' && e.airTime > 0.4) this.prog = ++this.jumps;
        if (o.id === 'perfects' && e.perfect) this.prog = ++this.perfects;
        if (o.id === 'air') this.prog = Math.floor((this.air += e.airTime) * 10) / 10;
        if (o.id === 'bossTrick' && e.boss && e.parts.some((p) => p.kind !== 'air')) this.prog = 1;
        for (const p of e.parts) {
          if (o.id === 'backflip' && p.kind === 'backflip') this.prog = 1;
          if (o.id === 'frontflip' && p.kind === 'frontflip') this.prog = 1;
          if (o.id === 'spin' && p.kind === 'spin') this.prog = 1;
          if (o.id === 'superman' && p.kind === 'superman') this.prog = 1;
          if (o.id === 'whip' && p.kind === 'whip') this.prog = 1;
        }
        break;
      case 'bank': if (o.id === 'combo') this.prog = Math.max(this.prog, e.total); break;
      case 'speed': if (o.id === 'speed') this.prog = Math.max(this.prog, Math.floor(e.kmh)); break;
      case 'manual': if (o.id === 'manual') this.prog = Math.max(this.prog, Math.floor(e.secs * 10) / 10); break;
      case 'close': if (o.id === 'close') this.prog = ++this.close; break;
      case 'rep': if (o.id === 'rep') this.prog = e.total; break;
      case 'bail': if (o.id === 'nobail' || o.id === 'time') { this.failed = o.id === 'nobail'; } break;
      case 'finish':
        if (o.id === 'nobail' && !this.failed) this.prog = 1;
        if (o.id === 'time' && e.time < o.n) this.prog = o.n;
        break;
    }
    if (!this.failed && this.prog >= o.n) { this.done = true; return true; }
    return false;
  }
  label() {
    const o = this.obj; if (!o) return '';
    if (this.done) return '✔ ' + o.text;
    if (this.failed) return '✖ ' + o.text;
    if (o.n > 1 && o.id !== 'time' && o.id !== 'speed') return `${o.text} — ${o.id === 'combo' || o.id === 'rep' ? Math.round(this.prog).toLocaleString('en-US') : this.prog}/${o.n.toLocaleString('en-US')}`;
    if (o.id === 'speed') return `${o.text} — best ${this.prog} km/h`;
    return o.text;
  }
}

// ------------------------------------------------------------------ tracks
export function trackOption(r, wi, level, boss) {
  const w = WORLDS[wi], d = wi / 4;
  const opt = {
    world: wi, level, boss,
    seed: Math.floor(r() * 2 ** 31),
    steep: boss ? 4 : clamp(Math.round(rrange(r, 1, 5) * 0.75 + d * 1.6 + level * 0.25), 1, 5),
    curvy: boss ? 2 : clamp(Math.round(rrange(r, 1, 5)), 1, 5),
    stunts: boss ? 3 : clamp(Math.round(rrange(r, 1, 5) * 0.8 + d * 1.2), 1, 5),
    length: boss ? 760 : Math.round(rrange(r, 1050, 1350) + d * 250 + level * 40),
  };
  opt.name = boss ? w.boss : `${pick(r, w.names[0])} ${pick(r, w.names[1])}`;
  opt.objective = boss ? { id: 'bossTrick', n: 1, text: 'Pull any trick over the boss gap' } : makeObjective(r, wi, opt);
  return opt;
}
export function levelOptions(seedBase, wi, level) {
  const r = mulberry32(hashStr(`${seedBase}:${wi}:${level}`));
  if (level >= 4) return [trackOption(r, wi, level, true)];
  const n = 3, opts = [];
  for (let i = 0; i < n; i++) opts.push(trackOption(r, wi, level, false));
  // make sure the choices actually differ: one steep, one curvy, one stunt-heavy
  opts[0].steep = Math.min(5, opts[0].steep + 1); opts[1].curvy = Math.min(5, opts[1].curvy + 1); opts[2].stunts = Math.min(5, opts[2].stunts + 2);
  opts[2].objective = makeObjective(r, wi, opts[2]);
  return opts;
}

export function newCareer(profile, startWorld = 0) {
  profile.careers++;
  profile.career = { world: startWorld, level: 0, lives: START_LIVES, rep: 0, seedBase: Math.floor(Math.random() * 1e9), picks: [], tracks: 0, bails: 0, start: startWorld };
  return profile.career;
}
export function freeRideOption(wi, seed) {
  const r = mulberry32(seed);
  const opt = trackOption(r, wi, 2, false);
  opt.length = Math.round(rrange(r, 1300, 1600));
  opt.free = true;
  return opt;
}
export function dailyOption() {
  const d = new Date(); const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  const r = mulberry32(hashStr('daily' + key));
  const wi = Math.floor(r() * WORLDS.length);
  const opt = trackOption(r, wi, 3, false);
  opt.length = 1400; opt.daily = key; opt.name = 'Daily Send: ' + opt.name;
  return opt;
}
