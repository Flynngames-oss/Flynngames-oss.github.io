// Senders — textures painted at load time on canvases (no image files needed).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function shade(c, k) {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * k)), g = Math.min(255, Math.max(0, ((c >> 8) & 255) * k)), b = Math.min(255, Math.max(0, (c & 255) * k));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true, rep = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// normal map from the brightness of a canvas (bright = high)
function normalFromCanvas(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const c = canvas(w, h), ctx = c.getContext('2d'), out = ctx.createImageData(w, h);
  const L = (x, y) => { x = (x + w) % w; y = (y + h) % h; const i = (y * w + x) * 4; return (s[i] + s[i + 1] + s[i + 2]) / 765; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (L(x - 1, y) - L(x + 1, y)) * strength, dy = (L(x, y - 1) - L(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out.data[i] = (dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return tex(c, false);
}

// The trail: packed dirt with two worn tyre lines, pebbles, roots and little ruts.
export function dirtTextures(world) {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(77);
  const base = world.colors.dirt, dark = world.colors.dirtDark;
  ctx.fillStyle = hex(base); ctx.fillRect(0, 0, S, S);
  // blotchy variation
  for (let i = 0; i < 900; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() * 34;
    ctx.fillStyle = shade(r() < 0.5 ? base : dark, 0.85 + r() * 0.35); ctx.globalAlpha = 0.08 + r() * 0.12;
    ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (0.5 + r()), r() * 3, 0, 7); ctx.fill();
  }
  // tyre lines along the trail (the texture's v axis runs along the trail)
  for (const cx of [0.4, 0.6]) {
    for (let y = 0; y < S; y += 2) {
      const x = (cx + Math.sin(y / S * Math.PI * 2 * 2 + cx * 9) * 0.025) * S;
      ctx.globalAlpha = 0.22; ctx.fillStyle = shade(dark, 0.9);
      ctx.fillRect(x - 16, y, 32, 2);
      ctx.globalAlpha = 0.18; ctx.fillStyle = shade(base, 1.18);
      ctx.fillRect(x - 6, y, 12, 2);
    }
  }
  // grain
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 1;
  // pebbles
  for (let i = 0; i < 520; i++) {
    const x = r() * S, y = r() * S, rad = 0.8 + r() * r() * 4.5;
    const inLine = Math.abs(x / S - 0.4) < 0.04 || Math.abs(x / S - 0.6) < 0.04;
    if (inLine && r() < 0.8) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, rad, rad * 0.8, 0, 0, 7); ctx.fill();
    const g = 115 + r() * 60; ctx.fillStyle = `rgb(${g * (0.95 + r() * 0.1) | 0},${g * 0.93 | 0},${g * 0.85 | 0})`;
    ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.8, r() * 3, 0, 7); ctx.fill();
  }
  // little cracks / ruts
  ctx.strokeStyle = shade(dark, 0.7); ctx.lineWidth = 1.4;
  for (let i = 0; i < 40; i++) {
    let x = r() * S, y = r() * S; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 14; y += (r() - 0.2) * 16; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const map = tex(c);
  const nrm = normalFromCanvas(c, 3.0);
  return { map, nrm };
}

// Wooden deck for ramps and drops: planks running across the trail.
export function plankTextures() {
  const W = 256, H = 512, c = canvas(W, H), ctx = c.getContext('2d'), r = mulberry32(5);
  const plank = 32;
  for (let y = 0; y < H; y += plank) {
    const base = 120 + r() * 50;
    ctx.fillStyle = `rgb(${base * 1.25 | 0},${base * 0.92 | 0},${base * 0.6 | 0})`;
    ctx.fillRect(0, y, W, plank);
    for (let k = 0; k < 18; k++) {
      ctx.strokeStyle = `rgba(70,40,20,${0.1 + r() * 0.2})`; ctx.lineWidth = 1 + r();
      ctx.beginPath(); const yy = y + r() * plank; ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 32) ctx.lineTo(x, yy + Math.sin(x * 0.05 + k) * 1.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,18,8,0.75)'; ctx.fillRect(0, y, W, 2.5);
    ctx.fillStyle = 'rgba(255,230,190,0.15)'; ctx.fillRect(0, y + 3, W, 1.5);
    ctx.fillStyle = '#3a3a3a';
    for (const nx of [12, W - 14]) { ctx.beginPath(); ctx.arc(nx, y + 9, 2, 0, 7); ctx.arc(nx, y + plank - 9, 2, 0, 7); ctx.fill(); }
  }
  const map = tex(c);
  return { map, nrm: normalFromCanvas(c, 2.0) };
}

// Text banners (sponsor boards, start and finish arches).
export function bannerTexture(text, bg = '#ff5a14', fg = '#ffffff', w = 1024, h = 192, opts = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (opts.checker) {
    const sq = h / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < w / sq; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'; ctx.fillRect(x * sq, y * sq, sq, sq); }
    ctx.fillStyle = bg; ctx.fillRect(w * 0.22, h * 0.12, w * 0.56, h * 0.76);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, bg); g.addColorStop(1, shade(parseInt(bg.slice(1), 16), 0.75));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 0, w, h * 0.08);
  }
  ctx.fillStyle = fg;
  ctx.font = `italic 900 ${Math.round(h * 0.62)}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * 0.54);
  const t = tex(c, true, false);
  return t;
}

// Water ripples (tiling normal map).
export function waterNormal() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d'), r = mulberry32(9);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = 4 + r() * 22, v = r() < 0.5 ? 255 : 0;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      g.addColorStop(0, `rgba(${v},${v},${v},0.16)`); g.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = g; ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  return normalFromCanvas(c, 4.0);
}

// Bark / foliage noise used on trees so they aren't flat blobs of colour.
export function noiseTexture(size = 128, seed = 3, amount = 60) {
  const c = canvas(size, size), ctx = c.getContext('2d'), r = mulberry32(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) { const v = 200 + (r() - 0.5) * amount; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}
