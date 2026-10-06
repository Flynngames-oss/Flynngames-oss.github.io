// Senders — procedural downhill course: a trail that winds down a mountain, carved into the terrain, with
// kickers, tabletops, gaps, drops, rollers, rock gardens, berms on the corners and (on boss days) a huge gap
// jump over a ravine. Everything comes from one seed, so the same seed always gives the same mountain.
//
// Coordinates: y is up, the trail heads downhill towards +z. One centreline sample per metre (s = metres).
import { Noise, mulberry32, clamp, lerp, smoothstep, rrange, nextFrame } from './util.js';

export const SURF = { DIRT: 0, GRASS: 1, ROCK: 2, WOOD: 3, SNOW: 4, SAND: 5 };
export const GRID = 2;            // terrain grid spacing (m)
export const CHUNK = 128;         // terrain chunk size (m)
const MAXH = 1.0;                 // the trail never points more than ~57 degrees off the fall line
const FRES = 4;                   // feature profile samples per metre
const PDZ = 2;                    // profile lookup spacing (m)
const G = 9.81;

const softRamp = (x, k) => (x >= k ? x : x <= -k ? 0 : (x + k) * (x + k) / (4 * k));
function blur(a, rad) {
  const n = a.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - rad), hi = Math.min(n, i + rad + 1); out[i] = (pre[hi] - pre[lo]) / (hi - lo); }
  return out;
}
function lin(hex) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

export class Course {
  constructor({ world, seed, length = 1300, steep = 3, curvy = 3, stunts = 3, boss = false, name = '' }) {
    this.world = world; this.seed = seed >>> 0; this.name = name;
    this.steep = steep; this.curvy = curvy; this.stunts = stunts; this.boss = boss;
    this.rng = mulberry32(this.seed ^ 0x51ed27);
    this.noise = new Noise(this.seed);
    this.noiseB = new Noise((this.seed + 1013) >>> 0);
    this.hw = world.halfW; this.ew = 4.2; this.outer = this.hw + this.ew;
    this.nearU = this.outer / Math.cos(MAXH) + 2.5;
    this.L = boss ? 760 : Math.round(length);       // finish line distance along the trail
    this.N = this.L + 70;                           // the trail runs on a little past the finish
    this.features = []; this.rocks = []; this.trees = []; this.boulders = []; this.pebbles = [];
    this.ravine = null;
    this.col = {}; for (const k in world.colors) this.col[k] = lin(world.colors[k]);
    this.col.rockTint = lin(world.rockTint);
    if (boss) this.bossLip = this.L - 170;
    this.planSlots();
    this.buildCenterline();
    this.buildProfile();
    this.buildTrackHeights();
    this.placeFeatures();
    this.buildBanking();
    this.placeCheckpoints();
    this.buildRockHash();
    this.snowY = world.snowLine != null ? -world.snowLine : (world.id === 'canyon' ? Infinity : 260);
    this.lakeY = world.lake ? this.profM(this.zEnd + 190) + 2.2 : -Infinity;
  }

  // ------------------------------------------------------------------ feature slots (planned before the trail so jumps get straights)
  planSlots() {
    const r = this.rng, st = (this.stunts - 1) / 4, w = this.world;
    const spacing = lerp(150, 46, st);
    const endLimit = this.boss ? this.bossLip - 240 : this.L - 115;
    const weights = [['table', 3 + 3 * st], ['gap', st > 0.3 ? 0.6 + 2.2 * st : 0], ['drop', 1.1 + 1.2 * st], ['rollers', 1.6], ['rocks', 0.5 + w.rockDensity * 1.4]];
    const total = weights.reduce((a, b) => a + b[1], 0);
    this.slots = [];
    let s = 80;
    while (true) {
      let roll = r() * total, type = 'table';
      for (const [k, wt] of weights) { if ((roll -= wt) <= 0) { type = k; break; } }
      const ext = { table: [36, 40], gap: [36, 42], drop: [36, 18], rollers: [4, 52], rocks: [0, 0] }[type];
      const at = Math.round(s + ext[0]);
      if (at + ext[1] > endLimit) break;
      this.slots.push({ type, at, a: at - ext[0], b: at + ext[1], straight: type !== 'rocks' });
      s = at + ext[1] + spacing * rrange(r, 0.45, 1.3);
    }
    if (this.boss) this.slots.push({ type: 'boss', at: this.bossLip, a: this.bossLip - 185, b: this.N, straight: true });
  }

  // ------------------------------------------------------------------ centreline
  buildCenterline() {
    const r = this.rng, N = this.N, L = this.L, cf = (this.curvy - 1) / 4;
    const kap = new Float32Array(N);
    let s = 0, h = 0;
    const fill = (len, k) => { const e = Math.min(N, s + Math.max(1, Math.round(len))); for (let i = s; i < e; i++) kap[i] = k; s = e; };
    fill(42, 0);
    const finishStraight = this.boss ? 330 : 85;
    const res = this.slots.filter((x) => x.straight).map((x) => [x.a - 14, x.b + 14]);
    let ri = 0;
    while (s < N) {
      if (s > L - finishStraight) { fill(N - s, 0); break; }
      while (ri < res.length && res[ri][1] <= s) ri++;
      if (ri < res.length && res[ri][0] <= s) { fill(res[ri][1] - s, 0); continue; }
      const room = ri < res.length ? res[ri][0] - s : Math.max(1, L - finishStraight - s);
      if (room < 14) { fill(room, 0); continue; }
      if (r() < lerp(0.42, 0.16, cf)) { fill(Math.min(room, rrange(r, 18, 60) * lerp(1.3, 0.7, cf)), 0); continue; }
      const radius = lerp(rrange(r, 55, 120), rrange(r, 24, 55), cf);
      let angle = Math.min(rrange(r, 0.35, lerp(0.9, 1.55, cf)), room / radius);
      let dir = r() < 0.5 ? -1 : 1;
      if (Math.abs(h) > 0.25 && r() < 0.72) dir = -Math.sign(h);
      let target = clamp(h + dir * angle, -MAXH, MAXH);
      if (Math.abs(target - h) < 0.2) { dir = -dir; target = clamp(h + dir * angle, -MAXH, MAXH); }
      angle = Math.abs(target - h);
      if (angle * radius < 4) { fill(Math.min(room, 20), 0); continue; }
      fill(angle * radius, dir / radius);
      h = target;
    }
    const k2 = blur(blur(kap, 6), 6);
    const X = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N), K = new Float32Array(N);
    let hh = 0;
    for (let i = 1; i < N; i++) {
      const hn = clamp(hh + k2[i], -MAXH - 0.05, MAXH + 0.05), hm = (hh + hn) / 2;
      X[i] = X[i - 1] + Math.sin(hm); Z[i] = Z[i - 1] + Math.cos(hm);
      hh = hn; H[i] = hn;
    }
    for (let i = 1; i < N - 1; i++) K[i] = (H[i + 1] - H[i - 1]) / 2;
    this.X = X; this.Z = Z; this.H = H; this.K = K;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < N; i++) { if (X[i] < mn) mn = X[i]; if (X[i] > mx) mx = X[i]; }
    this.minX = mn; this.maxX = mx;
  }

  // ------------------------------------------------------------------ mountain profile
  buildProfile() {
    const w = this.world, Z = this.Z, X = this.X, H = this.H, N = this.N, nz = this.noise;
    this.zFin = Z[this.L]; this.zEnd = Z[N - 1];
    const pz0 = this.pz0 = -1000, n = this.PN = Math.ceil((this.zEnd + 3400 - pz0) / PDZ) + 2;
    const M = this.M = new Float32Array(n), SIDE = this.SIDE = new Float32Array(n), VAL = this.VAL = new Float32Array(n);
    const CX = this.CX = new Float32Array(n), SZ = this.SZ = new Float32Array(n), CH = this.CH = new Float32Array(n);
    const sig = w.slope * (0.72 + 0.11 * this.steep);
    const zF = this.zFin, zE = this.zEnd;
    const zLip = this.boss ? Z[this.bossLip] : 0;
    const slopeAt = (z) => {
      if (z < 0) return sig * (1.25 + 0.9 * smoothstep(-20, -500, z));
      if (z <= zE + 40) {
        let s = sig * clamp(1 + 0.55 * nz.n1(z / 190 + 3.1) + 0.28 * nz.n1(z / 63 + 9.7), 0.35, 1.9);
        s *= lerp(0.55, 1, smoothstep(0, 30, z));
        if (this.boss && z > zLip - 175 && z < zLip + 4) s = Math.max(s, sig * 1.55);
        if (this.boss && z >= zLip + 4 && z < zLip + 70) s = sig * 0.8;
        s *= lerp(1, 0.06, smoothstep(zF - 70, zF - 8, z));
        return s;
      }
      if (z < zE + 450) return 0.025;
      return -0.34 * smoothstep(zE + 450, zE + 1150, z);
    };
    const i0 = Math.round(-pz0 / PDZ);
    M[i0] = 0;
    for (let i = i0; i < n - 1; i++) M[i + 1] = M[i] - slopeAt(pz0 + (i + 0.5) * PDZ) * PDZ;
    for (let i = i0; i > 0; i--) M[i - 1] = M[i] + slopeAt(pz0 + (i - 0.5) * PDZ) * PDZ;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const z = pz0 + i * PDZ;
      const fz = 1 - smoothstep(zE + 40, zE + 300, z);
      SIDE[i] = 0.3 * nz.n1(z / 260 + 1.7) * fz;
      VAL[i] = (0.12 + 0.3 * nz.n1(z / 310 + 5.2)) * fz + 0.25 * (1 - fz);
      if (z <= Z[0]) { CX[i] = X[0]; SZ[i] = 0; CH[i] = 1; continue; }
      if (z >= Z[N - 1]) { CX[i] = X[N - 1]; SZ[i] = N - 1; CH[i] = Math.cos(H[N - 1]); continue; }
      while (j < N - 2 && Z[j + 1] < z) j++;
      const t = (z - Z[j]) / (Z[j + 1] - Z[j]);
      CX[i] = X[j] + (X[j + 1] - X[j]) * t; SZ[i] = j + t; CH[i] = Math.cos(H[j]);
    }
  }
  profM(z) {
    let f = (z - this.pz0) / PDZ; if (f < 0) f = 0; else if (f > this.PN - 1.001) f = this.PN - 1.001;
    const i = f | 0, t = f - i; return this.M[i] + (this.M[i + 1] - this.M[i]) * t;
  }
  sAtZ(z) {
    let f = (z - this.pz0) / PDZ; if (f < 0) f = 0; else if (f > this.PN - 1.001) f = this.PN - 1.001;
    const i = f | 0, t = f - i; return this.SZ[i] + (this.SZ[i + 1] - this.SZ[i]) * t;
  }

  // ------------------------------------------------------------------ trail heights & speed estimate
  buildTrackHeights() {
    const N = this.N, w = this.world, nz = this.noiseB, L = this.L;
    const Y0 = this.Y0 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const und = w.undulate * (0.9 * nz.n1(i / 38 + 2.2) + 0.35 * nz.n1(i / 13 + 8.1)) * smoothstep(25, 60, i) * (1 - smoothstep(L - 70, L - 25, i));
      Y0[i] = this.profM(this.Z[i]) + und;
    }
    for (let i = 0; i < 10; i++) Y0[i] = Y0[10] + (10 - i) * 0.04;   // gentle start ramp
    this.V = this.estimateSpeeds((i) => Y0[i]);
  }
  estimateSpeeds(yf) {
    const N = this.N, V = new Float32Array(N);
    V[0] = 0.5;
    for (let i = 0; i < N - 1; i++) {
      const v = V[i], slope = yf(i) - yf(i + 1);
      const a = G * slope - 0.015 * G - 0.55 * v * v / 90 + (v < 9.5 ? 2.2 : 0);
      let vn = Math.sqrt(Math.max(v * v + 2 * a, 1));
      const k = Math.abs(this.K[i + 1]);
      if (k > 1e-4) vn = Math.min(vn, Math.sqrt(0.85 * G / k));
      V[i + 1] = vn;
    }
    for (let i = N - 2; i >= 0; i--) V[i] = Math.min(V[i], Math.sqrt(V[i + 1] * V[i + 1] + 2 * 5.5));
    return V;
  }

  // ------------------------------------------------------------------ features
  isStraight(a, b, lim) {
    a = Math.max(1, Math.floor(a)); b = Math.min(this.N - 2, Math.ceil(b));
    for (let i = a; i <= b; i++) if (Math.abs(this.K[i]) > lim) return false;
    return true;
  }
  Y0at(s) {
    const f = clamp(s, 0, this.N - 1.001), i = f | 0, t = f - i;
    return this.Y0[i] + (this.Y0[i + 1] - this.Y0[i]) * t;
  }
  simulateLanding(sLip, v, off) {
    const y = (s) => this.Y0at(s) + off(s - sLip);
    const slope = (y(sLip) - y(sLip - 0.3)) / 0.3, th = Math.atan(slope);
    let px = 0, py = y(sLip), vx = v * Math.cos(th), vy = v * Math.sin(th);
    const dt = 0.008;
    for (let t = 0; t < 5; t += dt) {
      const dr = 0.5 / 90 * Math.hypot(vx, vy);
      vx -= dr * vx * dt; vy -= (G + dr * vy) * dt; px += vx * dt; py += vy * dt;
      if (px > 0.6 && py <= y(sLip + px)) return px;
    }
    return 99;
  }
  // speed a rider carries from sA up to sB over a candidate profile (gravity, drag, rolling, light pedalling)
  approachSpeed(sA, sB, off, sRef, v0) {
    let v = v0;
    for (let s = sA; s < sB; s += 0.25) {
      const y0 = this.Y0at(s) + off(s - sRef), y1 = this.Y0at(s + 0.25) + off(s + 0.25 - sRef);
      const a = G * (y0 - y1) / 0.25 - 0.012 * G - 0.5 * v * v / 90 + (v < 8.5 ? 1.4 : 0);
      v = Math.sqrt(Math.max(v * v + 2 * a * 0.25, 1));
    }
    return v;
  }
  jumpOff(p) {
    return (t) => {
      if (t < -p.Lk - p.Lrun) return 0;
      if (t < -p.Lk) return p.E * smoothstep(-p.Lk - p.Lrun, -p.Lk - 1, t);
      if (t <= 0) { const x = t + p.Lk; return p.E + p.R - Math.sqrt(Math.max(0, p.R * p.R - x * x)); }
      if (t < p.G) {
        if (p.kind === 'table') return lerp(p.E + p.Hk, p.Ht, t / p.G);
        const back = p.E + p.Hk - t * p.backS, front = p.Ht - Math.max(0, p.G - (p.deck || 0) - t) * p.frontS;
        return Math.max(back, front, p.pit);
      }
      const x = t - p.G;
      const face = x < p.kn ? p.Ht - p.tanB * x * x / (2 * p.kn) : p.Ht - p.tanB * (x - p.kn / 2);
      return softRamp(face, 1.4);
    };
  }
  jumpEnd(p) { return p.G + p.kn / 2 + (p.Ht + 1.4) / p.tanB + 1; }
  designJump(sLip, p, v, gmin, gmax) {
    let bestG = gmin, bestErr = 1e9;
    const faceLen = p.Ht / p.tanB;
    for (let G = gmin; G <= gmax; G += 0.5) {
      p.G = G;
      const land = this.simulateLanding(sLip, v, this.jumpOff(p));
      const err = Math.abs(land - (G + p.kn * 0.6 + 0.3 * faceLen));
      if (err < bestErr) { bestErr = err; bestG = G; }
    }
    p.G = bestG;
  }
  writeFeature(s0, s1, sRef, off, fid) {
    const F = this.F, a = Math.max(0, Math.floor(s0 * FRES)), b = Math.min(F.length - 1, Math.ceil(s1 * FRES));
    for (let j = a; j <= b; j++) F[j] += off(j / FRES - sRef);
    for (let i = Math.max(0, Math.floor(s0)); i <= Math.min(this.N - 1, Math.ceil(s1)); i++) if (!this.FT[i]) this.FT[i] = fid;
  }
  placeFeatures() {
    const N = this.N, st = (this.stunts - 1) / 4;
    this.F = new Float32Array(N * FRES + 4);
    this.FT = new Uint8Array(N);       // feature index + 1 for each metre of trail
    this.WOOD = new Uint8Array(N);
    this.ROCKY = new Uint8Array(N);
    this.NOTRACK = new Uint8Array(N);
    for (const sl of this.slots) {
      if (sl.type === 'boss') { this.features.push(this.makeBoss()); continue; }
      const f = this.makeFeature(sl.type, sl.at, st);
      if (f) this.features.push(f);
    }
  }
  makeFeature(type, at, st) {
    const r = this.rng, fid = this.features.length + 1;
    let v = clamp(this.V[at] * 0.92, 8.5, 15.5);
    if (type === 'table' || type === 'gap') {
      const alpha = rrange(r, 0.42, 0.55) + 0.07 * st;
      const Hk = rrange(r, 0.9, 1.45) * (0.85 + 0.35 * st) * (type === 'gap' ? 1.15 : 1);
      const E = rrange(r, 0.4, 1.5);
      const p = { kind: type, E, Lrun: 26, Hk, R: Hk / (1 - Math.cos(alpha)), Lk: 0, G: 6, Ht: E + Hk * rrange(r, 0.8, 1.05),
        tanB: Math.tan(rrange(r, 0.36, 0.47)), kn: 1.8, pit: -0.5, backS: 2.4, frontS: 2.0, deck: 1.2 };
      p.Lk = p.R * Math.sin(alpha);
      if (type === 'gap') p.Ht = Math.max(p.Ht, 3.2 * p.tanB / 0.42);    // gaps get long landings
      const sA = Math.round(at - p.Lk - p.Lrun - 6), vIn = clamp(this.V[sA] * 0.95, 7, 16);
      const vNat = this.approachSpeed(sA, at, this.jumpOff(p), at, vIn);
      // design for a bit below the natural speed so you don't need a perfect run-in; faster riders land deeper
      v = type === 'gap' ? clamp(vNat * 0.86, 8, 13.5) : clamp(vNat * 0.92, 7.5, 15);
      this.designJump(at, p, v, type === 'gap' ? 5 : 3, 20);
      const off = this.jumpOff(p);
      const s0 = at - p.Lk - p.Lrun, s1 = at + this.jumpEnd(p);
      this.writeFeature(s0, s1, at, off, fid);
      const wood = r() < 0.15 + 0.35 * st;
      if (wood) for (let i = Math.floor(at - p.Lk); i < at; i++) this.WOOD[i] = 1;
      return { type, s0, s1, sKick: at - p.Lk, sLip: at, sLand: at + p.G, height: p.E + p.Hk, gap: p.G, wood, p, v, vIn };
    }
    if (type === 'drop') {
      const E = rrange(r, 1.4, 2.4) * (0.85 + 0.4 * st), Dd = E * rrange(r, 0.45, 0.7), tanB = Math.tan(rrange(r, 0.38, 0.5));
      const off = (t) => {
        if (t < -34) return 0;
        if (t < 0) return E * smoothstep(-34, -3, t);
        return softRamp(Math.max(E - t * 3.2, E - Dd - tanB * t), 0.9);
      };
      const s1 = at + (E - Dd + 0.9) / tanB + 1;
      this.writeFeature(at - 34, s1, at, off, fid);
      const wood = r() < 0.3 + 0.3 * st;
      if (wood) for (let i = at - 9; i < at; i++) this.WOOD[i] = 1;
      return { type, s0: at - 34, s1, sLip: at, sLand: at + 2, height: E, wood, v };
    }
    if (type === 'rollers') {
      const A = rrange(r, 0.35, 0.7) * (0.8 + 0.45 * st), lam = rrange(r, 6.5, 10), n = 3 + Math.floor(r() * 4);
      const off = (t) => (t < 0 || t > n * lam ? 0 : A * (1 - Math.cos(t / lam * Math.PI * 2)) / 2);
      this.writeFeature(at, at + n * lam, at, off, fid);
      return { type, s0: at, s1: at + n * lam, sLip: at, height: A, v };
    }
    if (type === 'rocks') {
      const len = rrange(r, 18, 36), n = Math.round(len * rrange(r, 0.7, 1.1));
      for (let k = 0; k < n; k++) {
        const s = at + r() * len, d = rrange(r, -this.hw * 0.9, this.hw * 0.9);
        const P = this.pointAt(s, d);
        this.rocks.push({ x: P.x, z: P.z, r: rrange(r, 0.22, 0.48), h: rrange(r, 0.1, 0.26), track: true });
      }
      for (let i = at; i < at + len; i++) this.ROCKY[i] = 1;
      for (let i = at; i < at + len; i++) if (!this.FT[i]) this.FT[i] = fid;
      return { type, s0: at, s1: at + len, sLip: at, height: 0, v };
    }
    return null;
  }
  makeBoss() {
    const at = this.bossLip, fid = this.features.length + 1;
    const p = { kind: 'boss', E: 2.6, Lrun: 40, Hk: 3.0, R: 0, Lk: 0, G: 16, Ht: 6.4, tanB: Math.tan(0.45), kn: 2.6, pit: -24, backS: 4, frontS: 4, deck: 3 };
    const alpha = 0.58; p.R = p.Hk / (1 - Math.cos(alpha)); p.Lk = p.R * Math.sin(alpha);
    const sA = Math.round(at - p.Lk - p.Lrun - 6), vIn = clamp(this.V[sA] * 0.95, 12, 19);
    const v = clamp(this.approachSpeed(sA, at, this.jumpOff(p), at, vIn) * 0.92, 11, 17);
    this.designJump(at, p, v, 13, 26);
    const off = this.jumpOff(p);
    const s0 = at - p.Lk - p.Lrun, s1 = at + this.jumpEnd(p);
    this.writeFeature(s0, s1, at, off, fid);
    for (let i = Math.floor(at - p.Lk - 12); i < at; i++) this.WOOD[i] = 1;
    for (let i = Math.floor(at + p.G - 2); i < at + p.G + p.Ht / p.tanB; i++) this.WOOD[i] = 1;
    for (let i = Math.ceil(at + 1); i < at + p.G - p.deck - 1; i++) this.NOTRACK[i] = 1;
    this.ravine = { zA: this.Z[Math.ceil(at + 1.2)], zB: this.Z[Math.floor(at + p.G - p.deck - 1.2)], depth: 24 };
    return { type: 'boss', s0, s1, sKick: at - p.Lk, sLip: at, sLand: at + p.G, height: p.E + p.Hk, gap: p.G, wood: true, p, v, vIn };
  }

  buildBanking() {
    const N = this.N, B = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = this.K[i], ak = Math.abs(k);
      if (ak < 1 / 130) continue;
      const v = this.V[i], bank = clamp(Math.atan(v * v * ak / G) * 0.85, 0, 0.55);
      B[i] = -Math.tan(bank) * Math.sign(k) * smoothstep(1 / 130, 1 / 60, ak);
    }
    this.BANK = blur(blur(B, 6), 6);
    // never bank a jump
    for (const f of this.features) if (f.type !== 'rocks' && f.type !== 'rollers') {
      for (let i = Math.max(0, Math.floor(f.s0 - 8)); i < Math.min(N, f.s1 + 8); i++) {
        const fade = Math.min(smoothstep(f.s0 - 8, f.s0, i), 1 - smoothstep(f.s1, f.s1 + 8, i));
        this.BANK[i] *= 1 - fade;
      }
    }
  }

  placeCheckpoints() {
    this.checkpoints = [];
    const n = this.boss ? 2 : 3;
    for (let k = 1; k <= n; k++) {
      let s = Math.round(this.L * k / (n + 1));
      for (let tries = 0; tries < 80 && this.nearFeature(s, 12); tries++) s += 6;
      if (s < this.L - 40) this.checkpoints.push(s);
    }
    if (this.boss) this.checkpoints.push(Math.round(this.bossLip - 190));
    this.checkpoints.sort((a, b) => a - b);
  }
  nearFeature(s, pad) { for (const f of this.features) if (s > f.s0 - pad && s < f.s1 + pad) return f; return null; }
  respawnS(sCrash) {
    let s = sCrash - 10;
    for (let k = 0; k < 4; k++) { const f = this.nearFeature(s, 6); if (f) s = f.s0 - (f.type === 'boss' ? 140 : 22); }
    return clamp(s, 6, this.L - 5);
  }

  // ------------------------------------------------------------------ rocks on the trail (bumps)
  buildRockHash() {
    this.rockHash = new Map();
    this.rocks.forEach((rk, i) => {
      const k = this.hkey(Math.floor(rk.x / 4), Math.floor(rk.z / 4));
      let a = this.rockHash.get(k); if (!a) this.rockHash.set(k, a = []); a.push(i);
    });
  }
  hkey(i, j) { return (i + 4096) * 8192 + (j + 4096); }
  bumps(x, z) {
    if (!this.rocks.length) return 0;
    const ci = Math.floor(x / 4), cj = Math.floor(z / 4);
    let best = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this.rockHash.get(this.hkey(ci + a, cj + b)); if (!arr) continue;
      for (const i of arr) {
        const rk = this.rocks[i], dx = x - rk.x, dz = z - rk.z, d2 = (dx * dx + dz * dz) / (rk.r * rk.r);
        if (d2 < 1) { const q = 1 - d2, hh = rk.h * q * Math.sqrt(q); if (hh > best) best = hh; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ queries
  trackY(s) {
    const f = clamp(s, 0, this.N - 1.001), i = f | 0, t = f - i;
    const fj = clamp(s * FRES, 0, this.F.length - 2), j = fj | 0, u = fj - j;
    return this.Y0[i] + (this.Y0[i + 1] - this.Y0[i]) * t + this.F[j] + (this.F[j + 1] - this.F[j]) * u;
  }
  bankAt(s) { const f = clamp(s, 0, this.N - 1.001), i = f | 0, t = f - i; return this.BANK[i] + (this.BANK[i + 1] - this.BANK[i]) * t; }
  headingAt(s) { const f = clamp(s, 0, this.N - 1.001), i = f | 0, t = f - i; return this.H[i] + (this.H[i + 1] - this.H[i]) * t; }
  pointAt(s, d = 0) {
    const f = clamp(s, 0, this.N - 1.001), i = f | 0, t = f - i;
    const x = this.X[i] + (this.X[i + 1] - this.X[i]) * t, z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t;
    const h = this.headingAt(s);
    // lateral axis points to the rider's left
    return { x: x + Math.cos(h) * d, z: z - Math.sin(h) * d, h };
  }
  // nearest point on the trail: sets this.qs (metres along) and this.qd (signed lateral, + = rider's left)
  nearest(x, z) {
    const X = this.X, Z = this.Z, N = this.N;
    const s0 = Math.round(this.sAtZ(z));
    let best = Infinity, bi = 0;
    const i0 = Math.max(0, s0 - 30), i1 = Math.min(N - 1, s0 + 30);
    for (let i = i0; i <= i1; i += 2) { const dx = x - X[i], dz = z - Z[i], dd = dx * dx + dz * dz; if (dd < best) { best = dd; bi = i; } }
    const j0 = Math.max(0, bi - 2), j1 = Math.min(N - 1, bi + 2);
    for (let i = j0; i <= j1; i++) { const dx = x - X[i], dz = z - Z[i], dd = dx * dx + dz * dz; if (dd < best) { best = dd; bi = i; } }
    // project onto the neighbouring segments
    let bs = bi, bd2 = best;
    for (let k = -1; k <= 0; k++) {
      const a = bi + k, b = a + 1; if (a < 0 || b >= N) continue;
      const ex = X[b] - X[a], ez = Z[b] - Z[a], l2 = ex * ex + ez * ez;
      const t = clamp(((x - X[a]) * ex + (z - Z[a]) * ez) / l2, 0, 1);
      const px = X[a] + ex * t, pz = Z[a] + ez * t, dd = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dd <= bd2) { bd2 = dd; bs = a + t; }
    }
    const h = this.headingAt(bs), p = this.pointAt(bs);
    this.qs = bs; this.qd = (x - p.x) * Math.cos(h) - (z - p.z) * Math.sin(h);
    return bs;
  }
  baseH(x, z) {
    let f = (z - this.pz0) / PDZ; if (f < 0) f = 0; else if (f > this.PN - 1.001) f = this.PN - 1.001;
    const i = f | 0, t = f - i;
    const M = this.M[i] + (this.M[i + 1] - this.M[i]) * t;
    const cx = this.CX[i] + (this.CX[i + 1] - this.CX[i]) * t;
    const side = this.SIDE[i] + (this.SIDE[i + 1] - this.SIDE[i]) * t;
    const val = this.VAL[i] + (this.VAL[i + 1] - this.VAL[i]) * t;
    const u = x - cx, au = Math.abs(u);
    this._u = u; this._ch = this.CH[i];
    const su = u * 420 / (420 + au), asu = Math.abs(su);
    const w = this.world;
    let h = M + side * su + val * asu * asu / (asu + 30);
    if (au > 14) {
      const big = this.noise.ridged(x / 430 + 11.3, z / 430 - 4.7, 4);
      h += (big - 0.25) * w.bigAmp * smoothstep(14, 300, au);
    }
    if (au > 6) h += this.noise.fbm(x / 72, z / 72, 3) * w.medAmp * smoothstep(6, 50, au);
    if (au > this.hw) h += this.noiseB.fbm(x / 9, z / 9, 2) * w.smallAmp * smoothstep(this.hw + 1, this.hw + 8, au);
    if (w.cliffs >= 0.9 && au > 22) {
      const step = 15, q = h / step, k = Math.floor(q), fr = q - k;
      const tq = (k + smoothstep(0.32, 0.68, fr)) * step;
      h = lerp(h, tq, smoothstep(22, 80, au) * 0.85);
    }
    if (this.ravine) {
      // a gorge across the valley: true to the jump at the trail, wandering and widening away from it
      const rv = this.ravine, a2 = Math.max(0, au - 14);
      const widen = smoothstep(0, 170, a2) * 12, wob = this.noiseB.n1(x / 47 + 3) * 5 * smoothstep(0, 40, a2);
      const zA = rv.zA - widen + wob, zB = rv.zB + widen + wob * 0.6;
      if (z > zA - 2 && z < zB + 2) {
        const depth = rv.depth * (1 - smoothstep(160, 330, au)) * (1 + 0.15 * this.noise.n1(x / 30) * smoothstep(0, 30, a2));
        h -= depth * smoothstep(zA - 1, zA + 3.5 + widen * 0.4, z) * (1 - smoothstep(zB - 3.5 - widen * 0.4, zB + 1, z));
      }
    }
    return h;
  }
  // exact ground height (the physics uses this). Sets this.near (true when inside the trail corridor),
  // this.qs / this.qd (position along / across the trail) and this.dist (distance from the centreline).
  heightAt(x, z) {
    const base = this.baseH(x, z);
    const au = Math.abs(this._u);
    if (au > this.nearU) { this.near = false; this.dist = au * this._ch; return base; }
    this.nearest(x, z);
    const ad = Math.abs(this.qd);
    this.dist = ad;
    if (ad >= this.outer) { this.near = false; return base; }
    this.near = true;
    const s = this.qs;
    let th = this.trackY(s) + this.bankAt(s) * this.qd;
    if (ad < this.hw + 0.6) th += this.bumps(x, z);
    const w = 1 - smoothstep(this.hw, this.outer, ad);
    return base + (th - base) * w;
  }
  // ground height, normal and surface type for the physics
  probe(x, z, out) {
    const e = 0.12;
    const hx1 = this.heightAt(x + e, z), hx0 = this.heightAt(x - e, z), hz1 = this.heightAt(x, z + e), hz0 = this.heightAt(x, z - e);
    const h = this.heightAt(x, z);
    let nx = (hx0 - hx1) / (2 * e), nz = (hz0 - hz1) / (2 * e), ny = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    out.h = h; out.nx = nx; out.ny = ny; out.nz = nz;
    out.dist = this.dist; out.onTrack = this.near && this.dist < this.hw + 0.35;
    out.s = this.near ? this.qs : this.sAtZ(z); out.d = this.near ? this.qd : this._u * this._ch;
    out.surf = this.surfaceAt(out);
    return out;
  }
  surfaceAt(o) {
    if (o.onTrack) {
      const i = clamp(Math.round(o.s), 0, this.N - 1);
      if (this.WOOD[i]) return SURF.WOOD;
      if (this.NOTRACK[i]) return SURF.ROCK;
      if (this.ROCKY[i]) return SURF.ROCK;
      return SURF.DIRT;
    }
    if (o.ny < 0.78) return SURF.ROCK;
    if (o.h > this.snowY) return SURF.SNOW;
    if (this.world.id === 'canyon') return SURF.SAND;
    return SURF.GRASS;
  }

  // ------------------------------------------------------------------ ground colour (shared by terrain, trail edges, grass)
  groundColor(x, z, h, ny, d, out) {
    const C = this.col, w = this.world;
    const n1 = this.noise.fbm(x / 46, z / 46, 2) * 0.5 + 0.5, n2 = this.noiseB.n2(x / 13, z / 13) * 0.5 + 0.5;
    let r = lerp(C.grassA[0], C.grassB[0], n1), g = lerp(C.grassA[1], C.grassB[1], n1), b = lerp(C.grassA[2], C.grassB[2], n1);
    const dry = smoothstep(0.58, 0.85, n2) * 0.55;
    r = lerp(r, C.dry[0], dry); g = lerp(g, C.dry[1], dry); b = lerp(b, C.dry[2], dry);
    const fo = this.forestAt(x, z) * 0.75;
    r = lerp(r, C.forest[0], fo); g = lerp(g, C.forest[1], fo); b = lerp(b, C.forest[2], fo);
    if (d < this.hw + 3.2) {
      const worn = (1 - smoothstep(this.hw - 0.2, this.hw + 3.2, d)) * 0.55;
      r = lerp(r, C.dirt[0], worn); g = lerp(g, C.dirt[1], worn); b = lerp(b, C.dirt[2], worn);
    }
    if (h < this.lakeY + 1.4) { const m = smoothstep(this.lakeY + 1.4, this.lakeY + 0.2, h) * 0.8; r = lerp(r, C.sand[0], m); g = lerp(g, C.sand[1], m); b = lerp(b, C.sand[2], m); }
    let rk = smoothstep(0.86, 0.68, ny) * (d > this.outer ? 1 : 0.5);
    if (rk > 0) {
      let rr = C.rock[0], rg = C.rock[1], rb = C.rock[2];
      const v = 0.82 + 0.36 * n2;
      if (w.strata) { const band = 0.5 + 0.5 * Math.sin(h * 0.55 + n1 * 3); const k = 0.75 + 0.45 * band; rr *= k; rg *= k * (0.92 + 0.12 * band); rb *= k * (0.9 + 0.2 * band); }
      r = lerp(r, rr * v, rk); g = lerp(g, rg * v, rk); b = lerp(b, rb * v, rk);
    }
    if (h > this.snowY - 14) {
      const sn = smoothstep(this.snowY - 10, this.snowY + 6, h + (n1 - 0.5) * 16) * smoothstep(0.5, 0.74, ny) * (d < this.hw + 1.5 ? 0.55 : 1);
      r = lerp(r, C.snow[0], sn); g = lerp(g, C.snow[1], sn); b = lerp(b, C.snow[2], sn);
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }
  forestAt(x, z) { return clamp(this.noise.fbm(x / 85 + 40, z / 85 - 13, 2) * 1.7 + 0.15 + (this.world.forestPatch - 0.5), 0, 1); }

  // ------------------------------------------------------------------ the big height grid (async, with progress)
  async buildGrid(progress) {
    const gx0 = this.gx0 = Math.floor((this.minX - 280) / CHUNK) * CHUNK;
    const gx1 = this.gx1 = Math.ceil((this.maxX + 280) / CHUNK) * CHUNK;
    const gz0 = this.gz0 = -CHUNK * 2;
    const gz1 = this.gz1 = Math.ceil((this.zEnd + 260) / CHUNK) * CHUNK;
    const GW = this.GW = (gx1 - gx0) / GRID + 1, GH = this.GH = (gz1 - gz0) / GRID + 1;
    const gh = this.gh = new Float32Array(GW * GH), gr = this.gr = new Float32Array(GW * GH), gd = this.gd = new Float32Array(GW * GH);
    let t0 = performance.now();
    for (let j = 0; j < GH; j++) {
      const z = gz0 + j * GRID;
      for (let i = 0; i < GW; i++) {
        const x = gx0 + i * GRID, k = j * GW + i;
        const h = this.heightAt(x, z), d = this.dist;
        gh[k] = h; gd[k] = Math.min(d, 999);
        gr[k] = d < this.outer ? h - 0.32 * (1 - smoothstep(this.outer - 1.6, this.outer, d)) : h;
      }
      if (performance.now() - t0 > 30) { progress && progress(j / GH); await nextFrame(); t0 = performance.now(); }
    }
  }
  gridH(x, z) {
    const fx = clamp((x - this.gx0) / GRID, 0, this.GW - 1.001), fz = clamp((z - this.gz0) / GRID, 0, this.GH - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, W = this.GW, a = this.gh;
    const h0 = a[j * W + i] + (a[j * W + i + 1] - a[j * W + i]) * tx, h1 = a[(j + 1) * W + i] + (a[(j + 1) * W + i + 1] - a[(j + 1) * W + i]) * tx;
    return h0 + (h1 - h0) * tz;
  }
  gridD(x, z) {
    const i = clamp(Math.round((x - this.gx0) / GRID), 0, this.GW - 1), j = clamp(Math.round((z - this.gz0) / GRID), 0, this.GH - 1);
    return this.gd[j * this.GW + i];
  }
  gridNormalY(x, z) {
    const e = GRID, dx = this.gridH(x - e, z) - this.gridH(x + e, z), dz = this.gridH(x, z - e) - this.gridH(x, z + e);
    return 2 * e / Math.hypot(dx, 2 * e, dz);
  }
  inGrid(x, z) { return x > this.gx0 && x < this.gx1 && z > this.gz0 && z < this.gz1; }

  // ------------------------------------------------------------------ trees, boulders & pebbles
  placeScenery(density = 1) {
    const r = mulberry32(this.seed ^ 0x7ee5), w = this.world;
    const total = w.trees.reduce((a, b) => a + b[1], 0);
    const pickType = () => { let x = r() * total; for (const [t, wt] of w.trees) { if ((x -= wt) <= 0) return t; } return w.trees[0][0]; };
    const startP = this.pointAt(4), finP = this.pointAt(this.L);
    const clearZones = [{ x: startP.x, z: startP.z, r: 16 }, { x: finP.x, z: finP.z, r: 30 }];
    for (const f of this.features) if (f.type === 'boss') { const p = this.pointAt(f.sLip + f.gap / 2); clearZones.push({ x: p.x, z: p.z, r: f.gap / 2 + 4 }); }
    // spectators: at the big jumps, the boss gap, the start and the finish
    this.crowd = [];
    const addCrowd = (sA, sB, n, dMin, dMax) => {
      for (let s = sA; s <= sB; s += 7) { const p = this.pointAt(s); clearZones.push({ x: p.x, z: p.z, r: this.hw + dMax + 1.5 }); }
      for (let k = 0; k < n; k++) {
        const s = rrange(r, sA, sB), side = r() < 0.5 ? -1 : 1, d = side * rrange(r, this.hw + dMin, this.hw + dMax);
        const i = clamp(Math.round(s), 0, this.N - 1);
        if (this.NOTRACK[i]) continue;
        const p = this.pointAt(s, d), c = this.pointAt(s), y = this.heightAt(p.x, p.z);
        if (y < this.lakeY + 0.3) continue;
        this.crowd.push({ x: p.x, z: p.z, y, rot: Math.atan2(c.x - p.x, c.z - p.z) + rrange(r, -0.5, 0.5), s });
      }
    };
    for (const f of this.features) {
      if (f.type === 'boss') { addCrowd(f.sLip - 90, f.sLip - 3, 80, 2.6, 9); addCrowd(f.sLand + 2, f.sLand + 34, 55, 3, 10); }
      else if ((f.type === 'table' || f.type === 'gap' || f.type === 'drop') && f.height > 1.7 && r() < 0.75) addCrowd(f.sLip - 7, f.sLip + (f.gap || 4) + 10, 8 + Math.floor(r() * 12), 2.4, 7);
    }
    addCrowd(this.L - 48, this.L + 16, 64, 2.2, 9);
    addCrowd(1, 14, 7, 2.5, 6);
    const blocked = (x, z, pad) => { for (const c of clearZones) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2) return true; return false; };
    this.trees = [];
    const add = (cell, dMin, dMax, dens) => {
      for (let z = this.gz0 + cell / 2; z < this.gz1 - cell / 2; z += cell) {
        for (let x = this.gx0 + cell / 2; x < this.gx1 - cell / 2; x += cell) {
          const px = x + (r() - 0.5) * cell * 0.95, pz = z + (r() - 0.5) * cell * 0.95;
          const rv = r();
          const d = this.gridD(px, pz);
          if (d < dMin || d >= dMax) continue;
          if (d < this.hw + w.treeClear + 0.4) continue;
          let p = w.treeDensity * dens * density * (0.25 + 1.25 * this.forestAt(px, pz));
          if (d < this.outer + 2) p *= 0.6;
          const h = this.gridH(px, pz);
          if (h < this.lakeY + 0.6) continue;
          if (h > this.snowY + 30) p *= 0.3;
          const ny = this.gridNormalY(px, pz);
          if (ny < 0.72) p *= 0.25;
          if (rv > p) continue;
          if (blocked(px, pz, 0)) continue;
          const type = pickType();
          const sc = rrange(r, 0.75, 1.3) * (type === 'shrub' ? 0.8 : 1);
          this.trees.push({ x: px, z: pz, y: h, type, s: sc, rot: r() * 6.283, tint: rrange(r, 0.82, 1.12), r: (type === 'cactus' ? 0.32 : type === 'shrub' ? 0.0 : 0.28) * sc, d });
        }
      }
    };
    add(4.6, 0, 70, 1);
    add(8.5, 70, 999, 0.9);
    // bushes (you can ride through these)
    const bu = 5.5;
    for (let z = this.gz0 + bu / 2; z < this.gz1; z += bu) for (let x = this.gx0 + bu / 2; x < this.gx1; x += bu) {
      const px = x + (r() - 0.5) * bu, pz = z + (r() - 0.5) * bu, rv = r();
      const d = this.gridD(px, pz);
      if (d < this.hw + 1.1 || d > 150) continue;
      if (rv > w.bushDensity * 0.2 * density * (0.4 + this.forestAt(px, pz))) continue;
      const h = this.gridH(px, pz);
      if (h < this.lakeY + 0.4 || blocked(px, pz, 0)) continue;
      this.trees.push({ x: px, z: pz, y: h, type: 'bush', s: rrange(r, 0.7, 1.4), rot: r() * 6.283, tint: rrange(r, 0.85, 1.12), r: 0, d });
    }
    // boulders (big rocks you can crash into) and pebbles (decoration)
    this.boulders = []; this.pebbles = [];
    const bc = 9;
    for (let z = this.gz0 + bc / 2; z < this.gz1; z += bc) for (let x = this.gx0 + bc / 2; x < this.gx1; x += bc) {
      const px = x + (r() - 0.5) * bc, pz = z + (r() - 0.5) * bc, rv = r(), rv2 = r();
      const d = this.gridD(px, pz);
      if (d < this.hw + 2.2 || d > 360) continue;
      const ny = this.gridNormalY(px, pz), h = this.gridH(px, pz);
      if (h < this.lakeY) continue;
      let p = w.boulderDensity * 0.12 * (1 + (1 - ny) * 4) * (d < 40 ? 1.6 : 1);
      if (rv < p && !blocked(px, pz, 2)) {
        const sz = rrange(r, 0.7, 2.6) * (d < 12 ? 0.7 : 1) * (w.cliffs > 0.9 ? 1.3 : 1);
        this.boulders.push({ x: px, z: pz, y: h, s: sz, rot: r() * 6.28, tilt: r(), r: sz * 0.85, top: h + sz * 0.9, v: Math.floor(r() * 3) });
      }
      if (rv2 < w.rockDensity * 0.9 && d > this.hw + 0.8) {
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const qx = px + (r() - 0.5) * 6, qz = pz + (r() - 0.5) * 6;
          this.pebbles.push({ x: qx, z: qz, y: this.gridH(qx, qz), s: rrange(r, 0.12, 0.45), rot: r() * 6.28, v: Math.floor(r() * 3) });
        }
      }
    }
    // trail-side rocks from the rock gardens become visible rocks too
    for (const rk of this.rocks) this.pebbles.push({ x: rk.x, z: rk.z, y: this.heightAt(rk.x, rk.z) - rk.h * 0.6, s: rk.r * 1.15, rot: r() * 6.28, v: Math.floor(r() * 3), flat: rk.h / rk.r });
    // collision hash for trunks and boulders
    this.obHash = new Map();
    const put = (o) => { const k = this.hkey(Math.floor(o.x / 6), Math.floor(o.z / 6)); let a = this.obHash.get(k); if (!a) this.obHash.set(k, a = []); a.push(o); };
    for (const t of this.trees) if (t.r > 0) put(t);
    for (const b of this.boulders) if (b.s > 0.6) put(b);
  }
  // solid obstacles near a point (trunks and boulders)
  obstaclesNear(x, z, cb) {
    if (!this.obHash) return;
    const ci = Math.floor(x / 6), cj = Math.floor(z / 6);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this.obHash.get(this.hkey(ci + a, cj + b)); if (arr) for (const o of arr) cb(o);
    }
  }
}
