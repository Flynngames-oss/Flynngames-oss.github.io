// A resort-style trail map painted from the real height function: hill shading, forests, trails coloured by
// difficulty, lifts, the venues, and teleport pins.
import * as T from './terrain.js';
import { makeNoise } from './noise.js';

const NR = makeNoise(77);
export const MAP = { x0: -490, x1: 490, z0: -20, z1: 1700, W: 960, H: 720 };
export const toMap = (x, z) => [((x - MAP.x0) / (MAP.x1 - MAP.x0)) * MAP.W, ((z - MAP.z0) / (MAP.z1 - MAP.z0)) * MAP.H];

let cached = null;
export function drawTrailMap(canvas) {
  canvas.width = MAP.W; canvas.height = MAP.H;
  const ctx = canvas.getContext('2d');
  if (cached) { ctx.drawImage(cached, 0, 0); return; }
  const off = document.createElement('canvas'); off.width = MAP.W; off.height = MAP.H;
  const x = off.getContext('2d');
  // sky gradient behind
  const g = x.createLinearGradient(0, 0, 0, MAP.H); g.addColorStop(0, '#9cc3e8'); g.addColorStop(1, '#dce9f5');
  x.fillStyle = g; x.fillRect(0, 0, MAP.W, MAP.H);
  // hill shading
  const cs = 4, id = x.createImageData(MAP.W, MAP.H);
  const sun = [-0.55, 0.62, -0.55], sl = Math.hypot(...sun);
  for (let py = 0; py < MAP.H; py += cs) for (let px = 0; px < MAP.W; px += cs) {
    const wx = MAP.x0 + (px / MAP.W) * (MAP.x1 - MAP.x0), wz = MAP.z0 + (py / MAP.H) * (MAP.z1 - MAP.z0);
    const e = 3, hx = T.H(wx + e, wz) - T.H(wx - e, wz), hz = T.H(wx, wz + e) - T.H(wx, wz - e);
    let nx = -hx, ny = 2 * e, nz = -hz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    let sh = Math.max(0, (nx * sun[0] + ny * sun[1] + nz * sun[2]) / sl);
    sh = 0.55 + sh * 0.5;
    let r = 245 * sh, gg = 249 * sh, b = 255 * Math.min(1.05, sh + 0.08);
    const m = T.masks(wx, wz);
    const forest = !T.clearance(wx, wz) && Math.abs(wx) < 470 && wz > 100 && wz < 1500 && (NR(wx * 0.008, wz * 0.008) * 0.5 + 0.5 + NR(wx * 0.03, wz * 0.03) * 0.25) > 0.38;
    if (forest && m.g < 0.05) { const k = ((px * 13 + py * 7) % 11) / 11; r = (40 + k * 20) * sh; gg = (78 + k * 25) * sh; b = (58 + k * 15) * sh; }
    for (let j = 0; j < cs; j++) for (let i = 0; i < cs; i++) { const o = ((py + j) * MAP.W + px + i) * 4; id.data[o] = r; id.data[o + 1] = gg; id.data[o + 2] = b; id.data[o + 3] = 255; }
  }
  x.putImageData(id, 0, 0);
  // trails
  const colr = { green: '#1e9e4a', blue: '#1f5fd6', black: '#111', park: '#ff7a00' };
  for (const t of T.TRAILS) {
    x.strokeStyle = colr[t.diff]; x.lineWidth = Math.max(3, (t.w / (MAP.x1 - MAP.x0)) * MAP.W * 0.5); x.lineCap = 'round'; x.globalAlpha = 0.85;
    x.beginPath();
    for (let z = t.z0; z <= t.z1; z += 6) { const [a, b] = toMap(t.cx(z), z); z === t.z0 ? x.moveTo(a, b) : x.lineTo(a, b); }
    x.stroke(); x.globalAlpha = 1;
    const lz = t.z0 + 560 + (t.id.length % 3) * 90; const [lx, ly] = toMap(t.cx(lz), lz);
    label(x, t.name, lx, ly, colr[t.diff]);
  }
  // park features
  for (const k of T.KICKERS) { if (k.onramp) continue; const [a, b] = toMap(k.x, k.z); x.fillStyle = '#fff'; x.strokeStyle = '#ff7a00'; x.lineWidth = 2; x.beginPath(); x.ellipse(a, b, 2 + k.H, 1.5 + k.H * 0.4, 0, 0, 7); x.fill(); x.stroke(); }
  {
    const P = T.PIPE; const [a, b] = toMap(P.x - P.half, P.z0), [c, d] = toMap(P.x + P.half, P.z1);
    x.fillStyle = '#c7dcf2'; x.strokeStyle = '#ff7a00'; x.lineWidth = 2; x.fillRect(a, b, c - a, d - b); x.strokeRect(a, b, c - a, d - b);
    label(x, 'SUPERPIPE', (a + c) / 2 + 40, (b + d) / 2, '#ff7a00');
    const [e, f] = toMap(T.BIGAIR.x, T.BIGAIR.z); label(x, 'BIG AIR', e + 34, f, '#ff7a00');
  }
  // lifts
  for (const L of T.LIFTS) {
    const [a, b] = toMap(L.x, L.zBase), [c, d] = toMap(L.x, L.zTop);
    x.strokeStyle = '#b8202a'; x.lineWidth = 3; x.setLineDash([10, 5]); x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#b8202a'; for (const [p, q] of [[a, b], [c, d]]) { x.beginPath(); x.arc(p, q, 6, 0, 7); x.fill(); }
    x.save(); x.translate(a + 10, (b + d) / 2 + 60); x.rotate(-Math.PI / 2); x.font = '18px "Bebas Neue", Impact'; x.fillStyle = '#b8202a'; x.fillText(L.name.toUpperCase(), 0, 0); x.restore();
  }
  // village
  { const [a, b] = toMap(0, 1660); label(x, 'BASE VILLAGE', a, b, '#3b2414'); const [c, d] = toMap(0, 30); label(x, 'SUMMIT  3180 m', c, d, '#0d1b2a'); }
  // title
  x.font = '44px "Bebas Neue", Impact'; x.fillStyle = 'rgba(13,27,42,0.85)'; x.fillText('FRESH TRACKS RESORT', 18, MAP.H - 18);
  cached = off;
  ctx.drawImage(off, 0, 0);
}
function label(x, text, a, b, col) {
  x.font = '17px "Bebas Neue", Impact, sans-serif';
  const w = x.measureText(text).width + 12;
  x.fillStyle = 'rgba(255,255,255,0.88)'; x.fillRect(a - w / 2, b - 11, w, 22);
  x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, a, b + 1); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
}
