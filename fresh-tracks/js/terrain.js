// The mountain as maths: one height function H(x, z) used by both the physics and the meshes.
// Downhill is +z. The resort is laid out in lanes across x:
//   Widowmaker (black, moguls) · Timberline (blue) · West Ridge lift · Flow Trail (berms + jumps)
//   · Jump Line park (rails, slopestyle, jump lines) · Summit Express lift · Winter Games venue
//   (superpipe, big air) · Cruiser (green, giant slalom gates)
import { makeNoise } from './noise.js';

const N1 = makeNoise(7), N2 = makeNoise(13), N3 = makeNoise(29), N4 = makeNoise(41);
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const BOUNDS = { x0: -600, x1: 600, z0: -120, z1: 1800 };
export const ELEV_TOP = 3180; // metres above sea level at the summit (for the HUD)

// ------------------------------------------------------------------ fall-line profile
export function slopeAt(z) {
  const top = 0.12 + 0.88 * sstep(40, 115, z);
  const bot = 1 - 0.9 * sstep(1470, 1590, z) - 0.1 * sstep(1600, 1640, z);
  const venue = sstep(200, 240, z) * (1 - sstep(470, 510, z)) + sstep(470, 500, z) * (1 - sstep(720, 760, z));
  const v = (0.16 * Math.sin(z / 150) + 0.08 * Math.sin(z / 47 + 1.3)) * (1 - Math.min(1, venue)) * sstep(120, 200, z);
  return 0.31 * (1 + v) * top * bot;
}
const PROF = new Float64Array(BOUNDS.z1 - BOUNDS.z0 + 2);
{ let y = 600; for (let i = 0; i < PROF.length; i++) { PROF[i] = y; y -= slopeAt(BOUNDS.z0 + i + 0.5); } }
export function baseY(z) {
  const f = clamp(z - BOUNDS.z0, 0, PROF.length - 1.001);
  const i = Math.floor(f), t = f - i;
  return PROF[i] * (1 - t) + PROF[i + 1] * t;
}

// ------------------------------------------------------------------ trails
export const TRAILS = [
  { id: 'widow', name: 'Widowmaker', diff: 'black', w: 30, z0: 70, z1: 1520, cx: (z) => -385 + 16 * Math.sin(z / 90), moguls: true },
  { id: 'timber', name: 'Timberline', diff: 'blue', w: 44, z0: 70, z1: 1520, cx: (z) => -255 + 40 * Math.sin(z / 165) + 12 * Math.sin(z / 61 + 2) },
  { id: 'flow', name: 'Flow Trail', diff: 'blue', w: 22, z0: 90, z1: 1480, cx: (z) => -118 + 26 * Math.sin(z / 42), flow: true },
  { id: 'park', name: 'Jump Line Park', diff: 'park', w: 64, z0: 70, z1: 1520, cx: () => 0, flat: true },
  { id: 'venue', name: 'Winter Games Venue', diff: 'park', w: 80, z0: 70, z1: 1520, cx: () => 175, flat: true },
  { id: 'cruiser', name: 'Cruiser', diff: 'green', w: 56, z0: 70, z1: 1520, cx: (z) => 320 + 28 * Math.sin(z / 210 + 1) },
];
const FLOW = TRAILS[2];
const flowCurv = (z) => -(26 / (42 * 42)) * Math.sin(z / 42);

export const LIFTS = [
  { id: 'summit', name: 'Summit Express', x: 82, zBase: 1592, zTop: 56 },
  { id: 'west', name: 'West Ridge Chair', x: -172, zBase: 1560, zTop: 70 },
];

// ------------------------------------------------------------------ features
export const KICKERS = [];
function kicker(o) {
  const k = Object.assign({ a: 0, exp: 2.6 }, o);
  if (k.lr == null) k.lr = k.H * 3.3;
  if (k.deck == null) k.deck = k.H * 3.2;
  if (k.land == null) k.land = k.H * 12;
  if (k.w == null) k.w = 3.6 + k.H * 1.3;
  if (k.wd == null) k.wd = 7 + k.H * 2.6;
  k.sa = Math.sin(k.a); k.ca = Math.cos(k.a);
  k.reach = k.lr + k.deck + k.land + k.wd + 6;
  KICKERS.push(k);
  return k;
}

export const RAILS = []; // filled by initRails() once H exists
const RAIL_DEFS = [];
function rail(o) { RAIL_DEFS.push(o); kicker({ x: o.x, z: o.z - 0.4, H: o.h0 - 0.14, lr: 2.4, deck: 0, land: 1.2, w: (o.type === 'box' ? 1.6 : 1.4), wd: 1.8, exp: 1.8, onramp: true }); }

// Slopestyle course (Jump Line Park, top section)
export const SLOPE = { x: 0, zStart: 118, zFinish: 690 };
rail({ x: -14, z: 165, len: 9, h0: 0.55, h1: 0.55, type: 'box', name: 'Flat Box' });
rail({ x: 14, z: 165, len: 10, h0: 0.6, h1: 0.6, type: 'rail', name: 'Flat Rail' });
rail({ x: 0, z: 228, len: 12, h0: 0.7, h1: 0.3, type: 'rail', name: 'Down Rail' });
rail({ x: -13, z: 290, len: 10, h0: 0.55, h1: 0.7, type: 'box', name: 'Wide Box' });
rail({ x: 13, z: 290, len: 11, h0: 0.6, h1: 0.9, type: 'rail', name: 'Flat-Down Rail' });
for (const [z, m, l] of [[370, 2.0, 2.8], [470, 2.3, 3.2], [575, 2.5, 3.6]]) {
  kicker({ x: -13, z, H: m, course: 'slope' });
  kicker({ x: 13, z, H: l, course: 'slope' });
}
// Jump Line (lower park): a rhythm line of tables that grow, a small line for warming up, and rails
for (const [z, h] of [[760, 1.4], [815, 1.6], [872, 1.8], [934, 2.1], [1002, 2.5], [1080, 2.9], [1170, 3.4], [1270, 3.0], [1360, 2.4]]) kicker({ x: 4, z, H: h, line: 'pro' });
for (const [z, h] of [[792, 1.0], [846, 1.1], [900, 1.2], [958, 1.3], [1020, 1.4], [1090, 1.5]]) kicker({ x: -20, z, H: h, line: 'small' });
rail({ x: 21, z: 800, len: 10, h0: 0.6, h1: 0.6, type: 'rail', name: 'Park Rail' });
rail({ x: 22, z: 905, len: 9, h0: 0.55, h1: 0.55, type: 'box', name: 'Park Box' });
rail({ x: 21, z: 1010, len: 12, h0: 0.7, h1: 0.35, type: 'rail', name: 'Down Rail' });
rail({ x: -22, z: 1180, len: 10, h0: 0.55, h1: 0.55, type: 'box', name: 'Butter Box' });
// Flow Trail jumps sit on the straights between berms
for (let k = 1; k <= 10; k++) {
  const z = 42 * Math.PI * k;
  const dxdz = (26 / 42) * Math.cos(Math.PI * k);
  kicker({ x: FLOW.cx(z), z, H: k % 2 ? 1.25 : 1.55, a: Math.atan(dxdz), flow: true, land: 11 });
}
// Big Air
export const BIGAIR = kicker({ x: 175, z: 642, H: 4.4, lr: 15, exp: 3.0, deck: 4, land: 44, w: 7, wd: 26, bigair: true });
BIGAIR.zStart = 505;

// Superpipe (22 ft walls)
export const PIPE = { x: 175, z0: 252, z1: 452, D: 6.7, b: 4.6, deckW: 5 };
PIPE.R = PIPE.D / (1 - Math.cos((85 * Math.PI) / 180));
PIPE.uMax = PIPE.R * Math.sin((85 * Math.PI) / 180);
PIPE.half = PIPE.b + PIPE.uMax;
export function pipeS(z) { return sstep(PIPE.z0, PIPE.z0 + 24, z) * (1 - sstep(PIPE.z1 - 26, PIPE.z1, z)); }
export function wallY(u) {
  if (u <= 0) return 0;
  if (u >= PIPE.uMax) return PIPE.D;
  return PIPE.R - Math.sqrt(PIPE.R * PIPE.R - u * u);
}
function pipeH(x, z) {
  if (z < PIPE.z0 || z > PIPE.z1) return 0;
  const dx = Math.abs(x - PIPE.x) - PIPE.b;
  if (dx >= PIPE.uMax) return 0;
  const s = pipeS(z);
  return s * (wallY(dx) - PIPE.D);
}
export function inPipe(x, z) { return z > PIPE.z0 + 23 && z < PIPE.z1 - 24 && Math.abs(x - PIPE.x) < PIPE.half + 0.6; }

// Giant slalom gates on the Cruiser
export const GATES = [];
export const GS = { zStart: 190, zFinish: 760 };
{
  const t = TRAILS[5];
  for (let i = 0; i < 22; i++) {
    const z = 222 + i * 24.5;
    const side = i % 2 ? 1 : -1;
    GATES.push({ z, x: t.cx(z) + side * 6.5, w: 7, color: i % 2 ? 'blue' : 'red' });
  }
}

// ------------------------------------------------------------------ masks
// groom: 0 wild snow … 1 groomed piste; flat: lanes with no big rolling terrain (park, venue, base)
const M = { g: 0, f: 0, trail: null, tm: 0, flowM: 0, flowLat: 0, widM: 0 };
export const MASK = M; // filled by the last H() / masks() call
export function masks(x, z) {
  const ax = Math.abs(x);
  const edge = 1 - sstep(445, 470, ax);
  const tb = Math.max(1 - sstep(84, 108, z), sstep(1492, 1526, z)) * edge;
  let g = tb, f = tb, best = 0, trail = null, flowM = 0, flowLat = 0, widM = 0;
  for (let i = 0; i < TRAILS.length; i++) {
    const t = TRAILS[i];
    if (z < t.z0 - 30 || z > t.z1 + 30) continue;
    const c = t.cx(z), d = Math.abs(x - c);
    const zz = sstep(t.z0 - 30, t.z0, z) * (1 - sstep(t.z1, t.z1 + 30, z));
    const m = (1 - sstep(t.w * 0.5 - 3, t.w * 0.5 + 3, d)) * zz;
    if (m > g) g = m;
    if (t.flat) { const mf = (1 - sstep(t.w * 0.5 - 2, t.w * 0.5 + 16, d)) * zz; if (mf > f) f = mf; }
    if (m > best) { best = m; trail = t; }
    if (t.flow) { flowM = m; flowLat = x - c; }
    if (t.moguls) widM = m;
  }
  M.g = g; M.f = f; M.trail = trail; M.tm = best; M.flowM = flowM; M.flowLat = flowLat; M.widM = widM;
  return M;
}

// Where trees / rocks are not allowed (trails, lift lines, base area, venues)
export function clearance(x, z) {
  const m = masks(x, z);
  if (m.g > 0.04) return true;
  for (const l of LIFTS) if (Math.abs(x - l.x) < 13 && z > l.zTop - 30 && z < l.zBase + 30) return true;
  if (z > 1480 || z < 100) return true;
  return false;
}

// ------------------------------------------------------------------ height
function kickerH(k, x, z) {
  const dx = x - k.x, dz = z - k.z;
  if (dz < -k.lr - 3 || dz > k.reach || Math.abs(dx) > k.reach) return 0;
  const t = dx * k.sa + dz * k.ca;
  const lat = Math.abs(dx * k.ca - dz * k.sa);
  if (t < -k.lr || t > k.deck + k.land) return 0;
  if (t < 0) {
    const u = (t + k.lr) / k.lr;
    const h = k.H * Math.pow(u, k.exp);
    const side = 1 - sstep(k.w * 0.5 - 0.3, k.w * 0.5 + 1.0 + 0.8 * h, lat);
    return h * side;
  }
  const wg = k.w + (k.wd - k.w) * sstep(0, k.deck * 0.6 + 0.6, t);
  let h;
  if (t < k.deck) h = k.H;
  else { const u = (t - k.deck) / k.land; h = k.H * 0.5 * (1 + Math.cos(Math.PI * u)); }
  const side = 1 - sstep(wg * 0.5 - 0.3, wg * 0.5 + 1.0 + 0.8 * k.H, lat);
  return h * side;
}

export function H(x, z) {
  const m = masks(x, z);
  const g = m.g, f = m.f;
  let y = baseY(z);
  const ax = Math.abs(x);
  if (ax > 425) { const d = ax - 425; y += d * d * 0.0032 + d * 0.12 + (N3(x * 0.013, z * 0.013) * 0.5 + 0.5) * d * 0.18; }
  if (z < -40) { const d = -40 - z; y += d * d * 0.004; }
  const L = N1(x * 0.0045, z * 0.0035) * 5.5 + N2(x * 0.011, z * 0.009) * 2.0;
  const Md = N2(x * 0.03, z * 0.03) * 1.3 + N3(x * 0.085, z * 0.085) * 0.5 + N4(x * 0.22, z * 0.22) * 0.12;
  y += L * (1 - f) + Md * (1 - g);
  if (g > 0 && f < 0.5) y += N4(x * 0.05, z * 0.04) * 0.25 * g * (1 - f);
  if (m.widM > 0) y += m.widM * 0.62 * Math.sin(x * 1.15 + z * 0.5) * Math.sin(z * 0.85 - x * 0.4);
  if (m.flowM > 0) {
    const lat = m.flowLat;
    const tilt = -flowCurv(z) * 44;
    y += m.flowM * (lat * tilt + 1.1 * sstep(FLOW.w * 0.5 - 5, FLOW.w * 0.5, Math.abs(lat)));
  }
  for (let i = 0; i < KICKERS.length; i++) { const k = KICKERS[i]; if (Math.abs(z - k.z) < k.reach) y += kickerH(k, x, z); }
  y += pipeH(x, z);
  return y;
}

// surface normal by central differences (writes into out = {x,y,z})
export function normalAt(x, z, out, e = 0.08) {
  const hx = H(x + e, z) - H(x - e, z), hz = H(x, z + e) - H(x, z - e);
  let nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

// height without the kickers (rails sit above the plain slope)
function Hplain(x, z) {
  const saved = KICKERS.length; const ks = KICKERS.splice(0, saved);
  const y = H(x, z); KICKERS.push(...ks); return y;
}
export function initRails() {
  if (RAILS.length) return;
  for (const d of RAIL_DEFS) {
    const z0 = d.z, z1 = d.z + d.len;
    const y0 = Hplain(d.x, z0) + d.h0, y1 = Hplain(d.x, z1) + d.h1;
    const len = Math.hypot(z1 - z0, y1 - y0);
    RAILS.push({ ...d, p0: { x: d.x, y: y0, z: z0 }, p1: { x: d.x, y: y1, z: z1 }, dir: { x: 0, y: (y1 - y0) / len, z: (z1 - z0) / len }, L: len, w: d.type === 'box' ? 0.5 : 0.06 });
  }
}

// What the HUD calls this spot
export function placeName(x, z) {
  if (inPipe(x, z)) return { name: 'Superpipe', diff: 'park' };
  if (Math.abs(x - BIGAIR.x) < 20 && z > BIGAIR.zStart - 10 && z < BIGAIR.z + 60) return { name: 'Big Air', diff: 'park' };
  if (z < 95) return { name: 'Summit', diff: 'top' };
  if (z > 1500) return { name: 'Base Village', diff: 'base' };
  const m = masks(x, z);
  if (m.trail && m.tm > 0.5) {
    if (m.trail.id === 'park') return { name: z < SLOPE.zFinish ? 'Slopestyle Course' : 'Jump Line', diff: 'park' };
    return { name: m.trail.name, diff: m.trail.diff };
  }
  for (const l of LIFTS) if (Math.abs(x - l.x) < 13) return { name: l.name + ' lift line', diff: 'off' };
  return { name: 'Backcountry Trees', diff: 'off' };
}

// ------------------------------------------------------------------ spawn points (teleports)
export const SPOTS = [
  { id: 'summit', name: 'Summit', x: 70, z: 70, yaw: 0, desc: 'Top of the Summit Express' },
  { id: 'west', name: 'West Ridge', x: -160, z: 84, yaw: 0, desc: 'Top of the West Ridge Chair' },
  { id: 'slope', name: 'Slopestyle', x: 0, z: SLOPE.zStart, yaw: 0, desc: 'Rails and 3 jump sections' },
  { id: 'jumpline', name: 'Jump Line', x: 4, z: 700, yaw: 0, desc: 'Rhythm line of growing tables' },
  { id: 'flow', name: 'Flow Trail', x: FLOW.cx(100), z: 100, yaw: 0, desc: 'Berms and rollers' },
  { id: 'pipe', name: 'Superpipe', x: PIPE.x, z: PIPE.z0 - 6, yaw: 0, desc: '22 ft halfpipe' },
  { id: 'bigair', name: 'Big Air', x: BIGAIR.x, z: BIGAIR.zStart, yaw: 0, desc: 'One massive kicker' },
  { id: 'timber', name: 'Timberline', x: TRAILS[1].cx(100), z: 100, yaw: 0, desc: 'Long blue cruiser in the trees' },
  { id: 'widow', name: 'Widowmaker', x: TRAILS[0].cx(100), z: 100, yaw: 0, desc: 'Black run, moguls' },
  { id: 'cruiser', name: 'Cruiser', x: TRAILS[5].cx(120), z: 120, yaw: 0, desc: 'Wide green, slalom gates' },
  { id: 'base', name: 'Base Village', x: 70, z: 1560, yaw: 0, desc: 'Lodge and lifts' },
];
