// Everything you can wear and ride, and the painter that turns a design into fabric / board textures.
// Your own uploaded images live in an image library and can be printed on any item, like a manufacturer.
import { rng } from './noise.js';

export const PATTERNS = [
  ['solid', 'Solid'], ['colorblock', 'Colour block'], ['camo', 'Camo'], ['digital', 'Digi camo'], ['plaid', 'Plaid'],
  ['fade', 'Fade'], ['stripes', 'Stripes'], ['splatter', 'Splatter'], ['tiedye', 'Tie-dye'], ['checker', 'Checker'], ['flames', 'Flames'], ['topo', 'Topo lines'],
];
export const JACKETS = [['shell', 'Shell jacket'], ['puffer', 'Puffer'], ['anorak', 'Anorak'], ['hoodie', 'Hoodie'], ['flannel', 'Flannel'], ['race', 'Team race']];
export const PANTS = [['cargo', 'Cargo pants'], ['bib', 'Bib pants'], ['baggy', 'Baggy'], ['slim', 'Slim']];
export const HEADS = [['helmet', 'Helmet'], ['bucket', 'Bucket helmet'], ['visor', 'Visor helmet'], ['beanie', 'Beanie']];
export const LENSES = {
  gold: ['Gold mirror', '#d4a017'], blue: ['Blue mirror', '#2a6bff'], rose: ['Rose', '#ff7aa2'], smoke: ['Smoke', '#2a2a2e'],
  green: ['Green mirror', '#1fbf74'], purple: ['Purple mirror', '#8b4dff'], fire: ['Fire', '#ff5a1f'], clear: ['Clear', '#c9d6e3'],
};
export const BOARDS = [['twin', 'Twin park'], ['directional', 'All-mountain'], ['swallow', 'Powder swallowtail']];
export const SKINS = ['#f6d7c3', '#eac09c', '#d39e74', '#b07850', '#8a5636', '#5e3a22'];

export const DEFAULT_LOOK = {
  name: 'Rider', skin: '#eac09c', stance: 'regular',
  brand: { name: 'NORTHLINE', logo: null, font: 'Bebas Neue' },
  jacket: { style: 'shell', c1: '#1f6feb', c2: '#0d1b2a', c3: '#ffd166', pattern: 'colorblock', print: { img: null, place: 'chest', scale: 1 }, brandText: true },
  pants: { style: 'cargo', c1: '#2b2d31', c2: '#1a1b1e', c3: '#ffd166', pattern: 'solid', print: { img: null, place: 'thigh', scale: 1 }, brandText: true },
  head: { type: 'helmet', c1: '#f4f4f2', c2: '#1f6feb', finish: 'matte', print: { img: null, place: 'side', scale: 1 }, pom: true, brandText: true },
  goggles: { frame: '#ffffff', lens: 'gold', strap: '#1f6feb' },
  gaiter: { on: true, c1: '#0d1b2a', c2: '#1f6feb', pattern: 'stripes' },
  gloves: { type: 'gloves', c1: '#141414', c2: '#ffd166' },
  boots: { c1: '#2a2a2a', c2: '#ffd166' },
  bindings: { c1: '#111111', c2: '#ffd166' },
  board: { shape: 'twin', length: 1.56, c1: '#ffd166', c2: '#1f6feb', c3: '#0d1b2a', pattern: 'stripes', top: { img: null, scale: 1 }, base: { img: null, scale: 1 }, baseColor: '#0d1b2a', text: 'PRO 156', brandText: true },
};

export const PRESETS = [
  { name: 'Pipe Pro', desc: 'Bright shell, white lid, gold lens', look: {} },
  {
    name: 'Backcountry Shell', desc: 'Earth tones, bibs, smoke lens',
    look: { jacket: { style: 'shell', c1: '#6b705c', c2: '#3a3d33', c3: '#e9c46a', pattern: 'colorblock' }, pants: { style: 'bib', c1: '#2f3e46', c2: '#1d262b', pattern: 'solid' }, head: { type: 'helmet', c1: '#3a3d33', c2: '#e9c46a', finish: 'matte' }, goggles: { lens: 'smoke', frame: '#222', strap: '#6b705c' }, gaiter: { c1: '#3a3d33', c2: '#e9c46a', pattern: 'solid' }, board: { shape: 'swallow', c1: '#e9c46a', c2: '#3a3d33', c3: '#264653', pattern: 'topo', text: 'POW 158' } },
  },
  {
    name: 'Park Rat', desc: 'Hoodie, baggy pants, beanie',
    look: { jacket: { style: 'hoodie', c1: '#e63946', c2: '#f1faee', c3: '#1d3557', pattern: 'solid' }, pants: { style: 'baggy', c1: '#a8a29e', c2: '#78716c', pattern: 'solid' }, head: { type: 'beanie', c1: '#1d3557', c2: '#f1faee', pom: false }, goggles: { lens: 'rose', frame: '#f1faee', strap: '#e63946' }, gaiter: { on: false }, board: { shape: 'twin', c1: '#f1faee', c2: '#e63946', c3: '#1d3557', pattern: 'checker', text: 'JIB 152', length: 1.52 } },
  },
  {
    name: 'Winter Games Team', desc: 'Team race kit, visor helmet',
    look: { jacket: { style: 'race', c1: '#ffffff', c2: '#d62828', c3: '#003049', pattern: 'colorblock' }, pants: { style: 'slim', c1: '#003049', c2: '#d62828', pattern: 'solid' }, head: { type: 'visor', c1: '#ffffff', c2: '#d62828', finish: 'gloss' }, goggles: { lens: 'blue', frame: '#fff', strap: '#d62828' }, gaiter: { c1: '#003049', c2: '#d62828', pattern: 'stripes' }, board: { shape: 'directional', c1: '#ffffff', c2: '#d62828', c3: '#003049', pattern: 'stripes', text: 'TEAM 159', length: 1.59 } },
  },
  {
    name: 'Retro 90s', desc: 'Neon colour block anorak',
    look: { jacket: { style: 'anorak', c1: '#7b2ff7', c2: '#00e5ff', c3: '#ff2e88', pattern: 'colorblock' }, pants: { style: 'baggy', c1: '#00e5ff', c2: '#7b2ff7', pattern: 'colorblock' }, head: { type: 'beanie', c1: '#ff2e88', c2: '#00e5ff', pom: true }, goggles: { lens: 'fire', frame: '#7b2ff7', strap: '#00e5ff' }, gaiter: { c1: '#ff2e88', c2: '#7b2ff7', pattern: 'checker' }, board: { c1: '#ff2e88', c2: '#00e5ff', c3: '#7b2ff7', pattern: 'splatter', text: 'RAD 155' } },
  },
  {
    name: 'Night Camo', desc: 'Puffer in dark camo',
    look: { jacket: { style: 'puffer', c1: '#2d3a2e', c2: '#151a16', c3: '#556b4f', pattern: 'camo' }, pants: { style: 'cargo', c1: '#151a16', c2: '#2d3a2e', c3: '#556b4f', pattern: 'camo' }, head: { type: 'bucket', c1: '#151a16', c2: '#556b4f', finish: 'matte' }, goggles: { lens: 'green', frame: '#151a16', strap: '#2d3a2e' }, gaiter: { c1: '#151a16', c2: '#556b4f', pattern: 'digital' }, board: { c1: '#151a16', c2: '#556b4f', c3: '#2d3a2e', pattern: 'digital', text: 'STEALTH 157' } },
  },
  {
    name: 'Lumberjack', desc: 'Flannel, beanie with pom',
    look: { jacket: { style: 'flannel', c1: '#b5121b', c2: '#111111', c3: '#f2e8cf', pattern: 'plaid' }, pants: { style: 'cargo', c1: '#5c4033', c2: '#3b2a20', pattern: 'solid' }, head: { type: 'beanie', c1: '#f2e8cf', c2: '#b5121b', pom: true }, goggles: { lens: 'gold', frame: '#111', strap: '#b5121b' }, gaiter: { on: false }, board: { c1: '#f2e8cf', c2: '#b5121b', c3: '#111111', pattern: 'plaid', text: 'TIMBER 156' } },
  },
];

export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function deepMerge(base, add) {
  const out = clone(base);
  (function m(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') m(a[k], b[k]); else a[k] = b[k]; } })(out, add || {});
  return out;
}
export function presetLook(i, keep) {
  const l = deepMerge(DEFAULT_LOOK, PRESETS[i].look);
  if (keep) { l.name = keep.name; l.skin = keep.skin; l.stance = keep.stance; l.brand = clone(keep.brand); }
  return l;
}
// make a look received from the network safe to use
export function sanitizeLook(l) {
  const out = deepMerge(DEFAULT_LOOK, l && typeof l === 'object' ? l : {});
  const col = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  for (const part of ['jacket', 'pants', 'head', 'gaiter', 'gloves', 'boots', 'bindings', 'board']) for (const k of ['c1', 'c2', 'c3']) if (k in out[part]) out[part][k] = col(out[part][k], DEFAULT_LOOK[part][k] || '#888888');
  out.name = String(out.name || 'Rider').slice(0, 16);
  out.brand.name = String(out.brand.name || '').slice(0, 18);
  out.board.text = String(out.board.text || '').slice(0, 14);
  out.skin = col(out.skin, DEFAULT_LOOK.skin);
  return out;
}

// ------------------------------------------------------------------ image library
const LIB_KEY = 'freshtracks.images.v1';
export const images = new Map(); // id -> { src, img, small }
let libLoaded = false;
export function loadLibrary(onReady) {
  if (libLoaded) return; libLoaded = true;
  let data = {};
  try { data = JSON.parse(localStorage.getItem(LIB_KEY) || '{}'); } catch (e) { data = {}; }
  let n = 0;
  for (const id in data) { n++; addSrc(id, data[id], () => { if (--n === 0 && onReady) onReady(); }); }
  if (!n && onReady) onReady();
}
function saveLibrary() {
  const data = {};
  for (const [id, v] of images) if (!v.remote) data[id] = v.src;
  try { localStorage.setItem(LIB_KEY, JSON.stringify(data)); } catch (e) { /* storage full: keep in memory */ }
}
function addSrc(id, src, done, remote = false) {
  const img = new Image();
  const e = { src, img, ready: false, remote };
  images.set(id, e);
  img.onload = () => { e.ready = true; if (done) done(e); };
  img.onerror = () => { images.delete(id); if (done) done(null); };
  img.src = src;
  return e;
}
export function removeImage(id) { images.delete(id); saveLibrary(); }
// scale an uploaded file down, keep transparency, store it, resolve with its id
export function addImageFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const im = new Image();
      im.onerror = reject;
      im.onload = () => {
        const s = Math.min(1, 640 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        let src = c.toDataURL('image/webp', 0.86);
        if (!src.startsWith('data:image/webp')) src = c.toDataURL('image/png');
        const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        addSrc(id, src, () => { saveLibrary(); resolve(id); });
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
// a small copy to send to friends
export function smallSrc(id) {
  const e = images.get(id);
  if (!e || !e.ready) return null;
  if (e.remote) return e.src;
  if (e.small) return e.small;
  const im = e.img, s = Math.min(1, 160 / Math.max(im.width, im.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  let src = c.toDataURL('image/webp', 0.75);
  if (!src.startsWith('data:image/webp')) src = c.toDataURL('image/png');
  e.small = src;
  return src;
}
export function addRemoteImage(id, src, done) {
  if (images.has(id)) return;
  if (typeof src !== 'string' || !/^data:image\/(webp|png|jpeg);base64,/.test(src) || src.length > 120000) return;
  addSrc(id, src, done, true);
}
export function lookImageIds(look) {
  const ids = new Set();
  const add = (v) => { if (v && typeof v === 'string') ids.add(v); };
  add(look.brand && look.brand.logo);
  for (const p of ['jacket', 'pants', 'head']) add(look[p] && look[p].print && look[p].print.img);
  add(look.board && look.board.top && look.board.top.img);
  add(look.board && look.board.base && look.board.base.img);
  return [...ids];
}
const imgOf = (id) => { const e = id && images.get(id); return e && e.ready ? e.img : null; };

// ------------------------------------------------------------------ painting helpers
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function shade(h, k) { const [r, g, b] = hexToRgb(h); const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))); return `rgb(${f(r)},${f(g)},${f(b)})`; }
function lum(h) { const [r, g, b] = hexToRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
const contrast = (h) => (lum(h) > 0.55 ? '#111' : '#fff');
function seedOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function drawPattern(ctx, w, h, pat, c1, c2, c3, seed = 1, wrap = true) {
  const r = rng(seed);
  ctx.save();
  ctx.fillStyle = c1; ctx.fillRect(0, 0, w, h);
  switch (pat) {
    case 'colorblock': {
      ctx.fillStyle = c2; ctx.fillRect(0, 0, w, h * 0.36);
      ctx.fillStyle = c3; ctx.fillRect(0, h * 0.36, w, h * 0.045);
      ctx.fillStyle = shade(c1, -0.18); ctx.fillRect(0, h * 0.86, w, h * 0.14);
      break;
    }
    case 'camo': case 'digital': {
      const cols = [c2, c3, shade(c1, -0.35)];
      if (pat === 'camo') {
        for (let i = 0; i < 70; i++) {
          ctx.fillStyle = cols[i % 3];
          const x = r() * w, y = r() * h, s = (0.04 + r() * 0.08) * w;
          for (const ox of wrap ? [-w, 0, w] : [0]) {
            ctx.beginPath();
            for (let a = 0; a < 7; a++) { const t = (a / 7) * Math.PI * 2, rr = s * (0.55 + r() * 0.6); const px = x + ox + Math.cos(t) * rr, py = y + Math.sin(t) * rr * 0.7; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
            ctx.closePath(); ctx.fill();
          }
        }
      } else {
        const sq = Math.max(4, Math.round(w / 64));
        for (let y = 0; y < h; y += sq) for (let x = 0; x < w; x += sq) { const v = r(); if (v < 0.55) continue; ctx.fillStyle = cols[Math.floor(r() * 3)]; ctx.fillRect(x, y, sq, sq); }
      }
      break;
    }
    case 'plaid': {
      const s = w / 8;
      ctx.globalAlpha = 0.55; ctx.fillStyle = c2;
      for (let x = 0; x < w; x += s) ctx.fillRect(x, 0, s * 0.45, h);
      for (let y = 0; y < h; y += s) ctx.fillRect(0, y, w, s * 0.45);
      ctx.globalAlpha = 0.8; ctx.fillStyle = c3;
      for (let x = s * 0.7; x < w; x += s) ctx.fillRect(x, 0, s * 0.05, h);
      for (let y = s * 0.7; y < h; y += s) ctx.fillRect(0, y, w, s * 0.05);
      ctx.globalAlpha = 1;
      break;
    }
    case 'fade': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c2); g.addColorStop(0.55, c1); g.addColorStop(1, c3);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'stripes': {
      const n = 7;
      for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c2 : c1; ctx.fillRect(0, (i / n) * h, w, h / n + 1); }
      ctx.fillStyle = c3; for (let i = 1; i < n; i++) ctx.fillRect(0, (i / n) * h - h * 0.006, w, h * 0.012);
      break;
    }
    case 'splatter': {
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = i % 3 ? c2 : c3; ctx.globalAlpha = 0.85;
        const x = r() * w, y = r() * h, s = Math.pow(r(), 3) * w * 0.035 + 1;
        ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
        if (s > 6) for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + (r() - 0.5) * s * 4, y + (r() - 0.5) * s * 4, s * 0.25 * r(), 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'tiedye': {
      const cx = w * 0.5, cy = h * 0.55;
      for (let i = 60; i > 0; i--) {
        ctx.fillStyle = [c1, c2, c3][i % 3];
        ctx.beginPath();
        for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2, rr = (i / 60) * w * 0.75 * (1 + 0.12 * Math.sin(t * 5 + i * 0.6)); const px = cx + Math.cos(t + i * 0.08) * rr, py = cy + Math.sin(t + i * 0.08) * rr * 0.6; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.fill();
      }
      break;
    }
    case 'checker': {
      const s = w / 16;
      ctx.fillStyle = c2;
      for (let y = 0, j = 0; y < h; y += s, j++) for (let x = 0, i = 0; x < w; x += s, i++) if ((i + j) % 2) ctx.fillRect(x, y, s, s);
      break;
    }
    case 'flames': {
      for (const [col, k] of [[c2, 1], [c3, 0.62]]) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const x = (i / n) * w, tip = h * (1 - k * (0.45 + 0.4 * r()));
          ctx.quadraticCurveTo(x - w / n * 0.5, h - (h - tip) * 0.3, x - w / n * 0.15, tip);
          ctx.quadraticCurveTo(x, h - (h - tip) * 0.5, x + w / n * 0.2, h - (h - tip) * 0.2);
        }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'topo': {
      ctx.strokeStyle = c2; ctx.lineWidth = Math.max(1.5, w / 400);
      for (let i = 0; i < 22; i++) {
        const cx = r() * w, cy = r() * h;
        for (let k = 1; k < 6; k++) {
          ctx.beginPath();
          for (let a = 0; a <= 40; a++) { const t = (a / 40) * Math.PI * 2, rr = k * w * 0.02 * (1 + 0.25 * Math.sin(t * 3 + i)); const px = cx + Math.cos(t) * rr, py = cy + Math.sin(t) * rr * 0.8; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.globalAlpha = k === 3 ? 0.9 : 0.45; ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    default: break;
  }
  ctx.restore();
}

function stitch(ctx, pts, col, wdt = 2) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.setLineDash([wdt * 3, wdt * 2.5]);
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
}
function zip(ctx, x0, y0, x1, y1, col, wdt = 6) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function brandText(ctx, text, x, y, size, col, font = 'Bebas Neue', align = 'center', alpha = 1, rot = 0) {
  if (!text) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot);
  ctx.font = `${Math.round(size)}px "${font}", "Barlow Condensed", Impact, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(text, 0, 0); ctx.restore();
}
// draw an image into a box: 'contain' keeps it whole
function drawImg(ctx, img, cx, cy, bw, bh, mode = 'contain', rot = 0) {
  if (!img) return;
  const s = mode === 'cover' ? Math.max(bw / img.width, bh / img.height) : Math.min(bw / img.width, bh / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.save(); ctx.translate(cx, cy); if (rot) ctx.rotate(rot); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
}
function tileImg(ctx, img, w, h, scale) {
  if (!img) return;
  const tw = (w / 6) * scale, th = tw * (img.height / img.width);
  for (let y = -th * 0.5, j = 0; y < h + th; y += th * 1.15, j++) for (let x = (j % 2) * tw * 0.6 - tw; x < w + tw; x += tw * 1.2) ctx.drawImage(img, x, y, tw, th);
}
// brand mark: logo image if uploaded, else the brand name
function brandMark(ctx, look, cx, cy, size, col, wrapW = 0) {
  const logo = imgOf(look.brand && look.brand.logo);
  const xs = wrapW ? [cx, cx - wrapW, cx + wrapW] : [cx];
  for (const x of xs) {
    if (logo) drawImg(ctx, logo, x, cy, size * 2.2, size, 'contain');
    else brandText(ctx, look.brand.name, x, cy, size, col, look.brand.font);
  }
}

// ------------------------------------------------------------------ garment textures
// torso: u = around (0.5 = chest), v = up. Sleeves / legs similar.
export function paintJacket(look) {
  const J = look.jacket, W = 1024, Hh = 512;
  const torso = canvas(W, Hh), t = torso.getContext('2d');
  const seed = seedOf(J.style + J.pattern + J.c1 + J.c2);
  drawPattern(t, W, Hh, J.pattern, J.c1, J.c2, J.c3, seed);
  const dark = shade(J.c1, -0.45), line = shade(J.c1, -0.3);
  const fx = W * 0.5; // front centre
  // puffer baffles
  if (J.style === 'puffer') {
    for (let i = 1; i < 10; i++) {
      const y = (i / 10) * Hh;
      const g = t.createLinearGradient(0, y - 22, 0, y + 22);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.45, 'rgba(0,0,0,0.0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.45)'); g.addColorStop(0.55, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(255,255,255,0.08)');
      t.fillStyle = g; t.fillRect(0, y - 22, W, 44);
    }
  }
  // hem + collar bands
  t.fillStyle = 'rgba(0,0,0,0.22)'; t.fillRect(0, Hh - 26, W, 26);
  t.fillStyle = 'rgba(0,0,0,0.18)'; t.fillRect(0, 0, W, 30);
  if (J.style === 'hoodie') {
    // ribbed hem, kangaroo pocket, drawcords
    t.fillStyle = shade(J.c1, -0.15); t.fillRect(0, Hh - 46, W, 46);
    for (let x = 0; x < W; x += 6) { t.fillStyle = 'rgba(0,0,0,0.12)'; t.fillRect(x, Hh - 46, 2, 46); }
    t.fillStyle = shade(J.c1, -0.08); roundRect(t, fx - 150, Hh - 190, 300, 140, 26); t.fill();
    stitch(t, [[fx - 140, Hh - 54], [fx - 140, Hh - 160], [fx - 90, Hh - 182], [fx + 90, Hh - 182], [fx + 140, Hh - 160], [fx + 140, Hh - 54]], line, 2);
    t.strokeStyle = J.c3; t.lineWidth = 6; t.beginPath(); t.moveTo(fx - 30, 30); t.lineTo(fx - 36, 150); t.moveTo(fx + 30, 30); t.lineTo(fx + 36, 140); t.stroke();
    t.fillStyle = '#ddd'; t.fillRect(fx - 40, 148, 8, 18); t.fillRect(fx + 32, 138, 8, 18);
  } else if (J.style === 'flannel') {
    t.fillStyle = 'rgba(0,0,0,0.25)'; t.fillRect(fx - 8, 30, 16, Hh - 56);
    for (let y = 70; y < Hh - 30; y += 62) { t.fillStyle = '#e8e2d0'; t.beginPath(); t.arc(fx, y, 7, 0, 7); t.fill(); t.fillStyle = 'rgba(0,0,0,0.4)'; t.beginPath(); t.arc(fx, y, 2, 0, 7); t.fill(); }
    for (const sx of [-1, 1]) { const px = fx + sx * 110; stitch(t, [[px - 55, 120], [px + 55, 120], [px + 55, 230], [px - 55, 230], [px - 55, 120]], 'rgba(0,0,0,0.5)', 2); t.fillStyle = 'rgba(0,0,0,0.12)'; t.fillRect(px - 58, 110, 116, 34); }
  } else if (J.style === 'anorak') {
    zip(t, fx, 30, fx, 200, dark, 7);
    t.fillStyle = shade(J.c2, 0.05); roundRect(t, fx - 170, 230, 340, 150, 14); t.fill();
    stitch(t, [[fx - 160, 240], [fx + 160, 240]], shade(J.c2, -0.4), 2);
    zip(t, fx - 150, 250, fx + 150, 250, shade(J.c2, -0.5), 5);
    zip(t, W * 0.25, 120, W * 0.25, 360, dark, 5);
  } else {
    // full zip, hand pockets, chest pocket
    zip(t, fx, 30, fx, Hh - 8, dark, 8);
    t.fillStyle = 'rgba(0,0,0,0.25)'; t.fillRect(fx - 14, 30, 4, Hh - 40);
    zip(t, fx - 210, Hh - 150, fx - 130, Hh - 60, dark, 5);
    zip(t, fx + 210, Hh - 150, fx + 130, Hh - 60, dark, 5);
    zip(t, fx + 150, 110, fx + 150, 210, dark, 4);
    stitch(t, [[0, Hh * 0.36], [W, Hh * 0.36]], line, 2);
    if (J.style === 'race') {
      t.fillStyle = J.c3; t.beginPath(); t.moveTo(fx - 300, Hh); t.lineTo(fx - 240, Hh); t.lineTo(fx + 40, 0); t.lineTo(fx - 20, 0); t.fill();
      t.fillStyle = J.c2; t.fillRect(0, Hh * 0.62, W, 14);
    }
    // pit zips / reflective tab
    t.fillStyle = '#ccc'; t.fillRect(fx - 260, Hh - 120, 22, 9);
  }
  // seams down the sides
  for (const sx of [0.25, 0.75]) stitch(t, [[W * sx, 30], [W * sx, Hh - 26]], line, 2);
  // prints & branding
  const P = J.print || {}, pimg = imgOf(P.img), sc = P.scale || 1;
  if (pimg) {
    if (P.place === 'allover') tileImg(t, pimg, W, Hh, sc);
    else if (P.place === 'front') drawImg(t, pimg, fx, Hh * 0.52, 330 * sc, 260 * sc);
    else if (P.place === 'back') { drawImg(t, pimg, 0, Hh * 0.48, 360 * sc, 280 * sc); drawImg(t, pimg, W, Hh * 0.48, 360 * sc, 280 * sc); }
    else if (P.place === 'chest') drawImg(t, pimg, fx + 92, Hh * 0.29, 130 * sc, 100 * sc);
  }
  if (J.brandText) {
    const col = contrast(J.pattern === 'colorblock' ? J.c2 : J.c1);
    if (!(pimg && P.place === 'chest')) brandMark(t, look, fx - 100, Hh * 0.27, 40, col);
    if (!(pimg && (P.place === 'back' || P.place === 'allover'))) brandMark(t, look, 0, Hh * 0.22, 74, col, W);
  }
  // sleeves
  const sleeve = canvas(512, 256), s = sleeve.getContext('2d');
  drawPattern(s, 512, 256, J.pattern === 'colorblock' ? 'solid' : J.pattern, J.pattern === 'colorblock' ? J.c2 : J.c1, J.c2, J.c3, seed + 1);
  if (J.pattern === 'colorblock') { s.fillStyle = J.c3; s.fillRect(0, 150, 512, 16); s.fillStyle = J.c1; s.fillRect(0, 0, 512, 60); }
  if (J.style === 'puffer') for (let i = 1; i < 6; i++) { s.fillStyle = 'rgba(0,0,0,0.35)'; s.fillRect(0, (i / 6) * 256 - 2, 512, 4); }
  s.fillStyle = J.style === 'hoodie' ? shade(J.c1, -0.15) : 'rgba(0,0,0,0.3)'; s.fillRect(0, 0, 512, 22);
  if (J.style === 'race') { s.fillStyle = J.c3; s.fillRect(240, 0, 30, 256); }
  if (pimg && P.place === 'sleeve') drawImg(s, pimg, 256, 160, 150 * sc, 110 * sc, 'contain', -Math.PI / 2);
  else if (J.brandText) brandText(s, look.brand.name, 256, 170, 46, contrast(J.pattern === 'colorblock' ? J.c2 : J.c1), look.brand.font, 'center', 0.9, -Math.PI / 2);
  return { torso, sleeve };
}

export function paintPants(look) {
  const P = look.pants;
  const seed = seedOf(P.style + P.pattern + P.c1 + P.c2);
  const make = (w, h, part) => {
    const c = canvas(w, h), x = c.getContext('2d');
    drawPattern(x, w, h, P.pattern, P.c1, P.c2, P.c3, seed + (part === 'shin' ? 3 : part === 'hip' ? 5 : 0));
    const line = shade(P.c1, -0.35);
    if (part === 'thigh') {
      if (P.style === 'cargo' || P.style === 'bib' || P.style === 'baggy') {
        for (const u of [0.0, 1.0]) {
          // outside of leg is around u=0/1 for left leg-ish; pockets on both sides look right on both legs
          x.fillStyle = shade(P.c1, -0.08); roundRect(x, u * w - 70, h * 0.25, 140, h * 0.42, 10); x.fill();
          stitch(x, [[u * w - 62, h * 0.28], [u * w + 62, h * 0.28]], line, 2);
          x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(u * w - 70, h * 0.6, 140, 14);
        }
      }
      stitch(x, [[w * 0.5, 0], [w * 0.5, h]], line, 2);
      const pi = imgOf(P.print && P.print.img), sc = (P.print && P.print.scale) || 1;
      if (pi && P.print.place === 'thigh') drawImg(x, pi, w * 0.5, h * 0.55, 160 * sc, 160 * sc);
      else if (P.brandText) brandText(x, look.brand.name, w * 0.5, h * 0.62, 38, contrast(P.c1), look.brand.font, 'center', 0.9, -Math.PI / 2);
    }
    if (part === 'shin') {
      x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, h - 40, w, 40); // hem
      x.fillStyle = shade(P.c2, -0.1); x.fillRect(w * 0.62, h - 90, w * 0.22, 50); // scuff guard
      stitch(x, [[0, h * 0.06], [w, h * 0.06]], line, 2);
    }
    if (part === 'hip') { x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(0, 0, w, h * 0.18); }
    const pi = imgOf(P.print && P.print.img), sc = (P.print && P.print.scale) || 1;
    if (pi && P.print.place === 'allover') tileImg(x, pi, w, h, sc * 0.8);
    return c;
  };
  return { thigh: make(512, 512, 'thigh'), shin: make(512, 512, 'shin'), hip: make(512, 256, 'hip') };
}

export function paintHelmet(look) {
  const Hd = look.head, W = 1024, Hh = 512;
  const c = canvas(W, Hh), x = c.getContext('2d');
  if (Hd.type === 'beanie') {
    drawPattern(x, W, Hh, 'solid', Hd.c1, Hd.c2, Hd.c2);
    for (let i = 0; i < W; i += 10) { x.fillStyle = 'rgba(0,0,0,0.13)'; x.fillRect(i, 0, 4, Hh); }
    x.fillStyle = Hd.c2; x.fillRect(0, Hh * 0.55, W, Hh * 0.08);
    x.fillStyle = Hd.c2; x.fillRect(0, Hh * 0.7, W, Hh * 0.05);
    const pi = imgOf(Hd.print && Hd.print.img);
    if (pi) drawImg(x, pi, W * 0.25, Hh * 0.82, 160, 90); else if (Hd.brandText) { x.fillStyle = Hd.c2; roundRect(x, W * 0.25 - 80, Hh * 0.78, 160, 52, 6); x.fill(); brandText(x, look.brand.name, W * 0.25, Hh * 0.78 + 27, 40, contrast(Hd.c2), look.brand.font); }
    return c;
  }
  x.fillStyle = Hd.c1; x.fillRect(0, 0, W, Hh);
  // centre stripe front-to-back, side flashes
  x.fillStyle = Hd.c2;
  x.fillRect(W * 0.25 - 26, 0, 52, Hh * 0.62); x.fillRect(W * 0.75 - 26, 0, 52, Hh * 0.62);
  x.fillRect(0, Hh * 0.6, W, 12);
  // vents
  x.fillStyle = 'rgba(10,10,12,0.85)';
  for (const u of [0.17, 0.21, 0.29, 0.33, 0.62, 0.7, 0.8, 0.88]) { roundRect(x, W * u - 9, Hh * 0.12, 18, 70, 9); x.fill(); }
  const pi = imgOf(Hd.print && Hd.print.img), sc = (Hd.print && Hd.print.scale) || 1;
  if (pi && Hd.print.place === 'allover') tileImg(x, pi, W, Hh, sc);
  else if (pi) { drawImg(x, pi, 0, Hh * 0.42, 150 * sc, 110 * sc); drawImg(x, pi, W, Hh * 0.42, 150 * sc, 110 * sc); drawImg(x, pi, W * 0.5, Hh * 0.42, 150 * sc, 110 * sc); }
  else if (Hd.brandText) { brandMark(x, look, 0, Hh * 0.43, 54, contrast(Hd.c1), W); brandMark(x, look, W * 0.5, Hh * 0.43, 54, contrast(Hd.c1)); }
  x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, Hh * 0.585, W, Hh * 0.13);
  return c;
}

export function paintStrap(look) {
  const G = look.goggles, c = canvas(1024, 64), x = c.getContext('2d');
  x.fillStyle = G.strap; x.fillRect(0, 0, 1024, 64);
  x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, 4, 1024, 4); x.fillRect(0, 56, 1024, 4);
  for (let i = 0; i < 4; i++) brandText(x, look.brand.name, 128 + i * 256, 34, 40, contrast(G.strap), look.brand.font);
  return c;
}
export function paintGaiter(look) {
  const G = look.gaiter, c = canvas(512, 256), x = c.getContext('2d');
  drawPattern(x, 512, 256, G.pattern, G.c1, G.c2, shade(G.c1, 0.3), seedOf(G.pattern + G.c1));
  return c;
}
export function paintBoard(look) {
  const B = look.board, W = 1024, Hh = 256;
  const top = canvas(W, Hh), t = top.getContext('2d');
  drawPattern(t, W, Hh, B.pattern, B.c1, B.c2, B.c3, seedOf('b' + B.pattern + B.c1), false);
  const ti = imgOf(B.top && B.top.img), sc = (B.top && B.top.scale) || 1;
  if (ti) {
    if (sc >= 1.6) drawImg(t, ti, W * 0.5, Hh * 0.5, W * 0.9, Hh * 1.2, 'cover');
    else drawImg(t, ti, W * 0.5, Hh * 0.5, 420 * sc, 220 * sc);
  }
  if (B.brandText) {
    const col = contrast(B.c1);
    if (!ti) brandMark(t, look, W * 0.5, Hh * 0.5, 120, col);
    brandText(t, B.text, W * 0.16, Hh * 0.5, 44, col, look.brand.font, 'center', 0.9, Math.PI / 2);
    brandText(t, look.brand.name, W * 0.84, Hh * 0.5, 40, col, look.brand.font, 'center', 0.9, -Math.PI / 2);
  }
  // stance inserts
  t.fillStyle = 'rgba(0,0,0,0.35)';
  for (const u of [0.31, 0.34, 0.66, 0.69]) for (const v of [0.4, 0.6]) { t.beginPath(); t.arc(W * u, Hh * v, 3.5, 0, 7); t.fill(); }
  const base = canvas(W, Hh), b = base.getContext('2d');
  b.fillStyle = B.baseColor || B.c3; b.fillRect(0, 0, W, Hh);
  const g = b.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.08)');
  b.fillStyle = g; b.fillRect(0, 0, W, Hh);
  const bi = imgOf(B.base && B.base.img), bs = (B.base && B.base.scale) || 1;
  if (bi) drawImg(b, bi, W * 0.5, Hh * 0.5, 520 * bs, 230 * bs, bs >= 1.6 ? 'cover' : 'contain');
  else {
    const logo = imgOf(look.brand.logo);
    if (logo) drawImg(b, logo, W * 0.5, Hh * 0.5, 600, 200);
    else brandText(b, look.brand.name, W * 0.5, Hh * 0.54, 170, B.c1, look.brand.font);
  }
  return { top, base };
}
export function paintSmall(color, accent, kind) {
  const c = canvas(256, 128), x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 256, 128);
  if (kind === 'boot') { x.fillStyle = accent; for (let i = 0; i < 6; i++) x.fillRect(110 + (i % 2) * 6, 10 + i * 9, 30, 3); x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, 108, 256, 20); }
  return c;
}

// ------------------------------------------------------------------ normal maps
function heightToNormal(hf, w, h, strength) {
  const c = canvas(w, h), x = c.getContext('2d'), id = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const l = hf[j * w + ((i - 1 + w) % w)], r = hf[j * w + ((i + 1) % w)], u = hf[((j - 1 + h) % h) * w + i], d = hf[((j + 1) % h) * w + i];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1; const L = Math.hypot(nx, ny, nz);
    const o = (j * w + i) * 4; id.data[o] = (nx / L * 0.5 + 0.5) * 255; id.data[o + 1] = (ny / L * 0.5 + 0.5) * 255; id.data[o + 2] = (nz / L * 0.5 + 0.5) * 255; id.data[o + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}
export function fabricNormalCanvas() {
  const w = 256, h = 256, hf = new Float32Array(w * h), r = rng(5);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const weave = Math.sin(i * Math.PI * 0.5) * Math.sin(j * Math.PI * 0.5) * 0.4;
    const rip = (i % 32 === 0 || j % 32 === 0) ? 1.0 : 0;
    hf[j * w + i] = weave + rip + r() * 0.25;
  }
  return heightToNormal(hf, w, h, 1.2);
}
export function knitNormalCanvas() {
  const w = 128, h = 128, hf = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hf[j * w + i] = Math.abs(Math.sin((i / 8) * Math.PI)) + 0.3 * Math.abs(Math.sin((j / 6) * Math.PI + (i % 8 < 4 ? 0.8 : 0)));
  return heightToNormal(hf, w, h, 2.0);
}
