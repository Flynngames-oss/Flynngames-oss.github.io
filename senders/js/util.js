// Senders — small maths helpers, a seeded random number generator and seeded gradient noise.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const TAU = Math.PI * 2;
export function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function dampAngle(a, b, k, dt) { return a + wrapAngle(b - a) * (1 - Math.exp(-k * dt)); }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const rrange = (r, a, b) => a + (b - a) * r();

function grad(h, x, y) {
  switch (h & 7) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Seeded 2D Perlin noise, roughly in [-1, 1].
export class Noise {
  constructor(seed) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  n2(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255, p = this.perm;
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1], ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = grad(aa, xf, yf) + (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) * u;
    const x2 = grad(ab, xf, yf - 1) + (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1)) * u;
    return (x1 + (x2 - x1) * v) * 0.95;
  }
  n1(x) { return this.n2(x, 7.31); }
  fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.n2(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  // sharp mountain ridges, 0..1
  ridged(x, y, oct = 4) {
    let a = 1, f = 1, s = 0, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(this.n2(x * f, y * f));
      v *= v; v *= w; w = clamp(v * 1.6, 0, 1);
      s += v * a; n += a; a *= 0.5; f *= 2.05;
    }
    return s / n;
  }
}

export const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}
export function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }
