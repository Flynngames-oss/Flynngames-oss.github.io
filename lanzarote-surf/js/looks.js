// Everything you can customise: the surfer (body, face, hair, hat, glasses, clothes and patterns) and the
// surfboard (shape, length, fins, colours, a printed design and your own spray paint on the deck).
import * as THREE from 'three';

export let ENV_MAP = null;
export function setEnvMap(t) { ENV_MAP = t; }

// ---------------------------------------------------------------------------
// the options
// ---------------------------------------------------------------------------
export const OPTIONS = {
  skin: ['#ff6a1c', '#ffb02e', '#3fb8ff', '#7bd64a', '#ff5fa2', '#b07cff', '#ffe14d', '#1ed6c0', '#f6d7c3', '#eec4a5', '#d9a27a', '#c68b62', '#a86f4a', '#7a4a2e', '#4e2f1c'],
  colors: ['#ffffff', '#16181d', '#ff3d6e', '#ff7a1f', '#ffd23d', '#7dff5a', '#2ecc71', '#1ec8ff', '#1f3cff', '#b06bff', '#ff5fa2', '#8a5634', '#c8b48a', '#2b3150', '#7a8a9a', '#00a37a'],
  hairColors: ['#16181d', '#3b2a20', '#6b4423', '#a8743f', '#e8c070', '#f2e6c8', '#d8d8d8', '#ff3d6e', '#1ec8ff', '#7dff5a', '#b06bff', '#ff7a1f'],
  eyes: [['dots', 'Dots'], ['big', 'Big'], ['happy', 'Happy'], ['sleepy', 'Sleepy'], ['angry', 'Fierce'], ['wink', 'Wink']],
  mouth: [['flat', 'Calm'], ['smile', 'Smile'], ['grin', 'Grin'], ['o', 'Woah'], ['tongue', 'Cheeky']],
  beard: [['none', 'None'], ['stubble', 'Stubble'], ['full', 'Beard'], ['moustache', 'Moustache']],
  hair: [['none', 'None'], ['short', 'Short'], ['long', 'Long'], ['mohawk', 'Mohawk'], ['afro', 'Afro'], ['bun', 'Bun'], ['ponytail', 'Ponytail'], ['spiky', 'Spiky']],
  hat: [['none', 'None'], ['bucket', 'Bucket hat'], ['cap', 'Cap'], ['backcap', 'Cap (backwards)'], ['beanie', 'Beanie'], ['visor', 'Visor'], ['helmet', 'Surf helmet'], ['straw', 'Straw hat']],
  glasses: [['none', 'None'], ['sunnies', 'Sunglasses'], ['round', 'Round'], ['goggles', 'Goggles'], ['star', 'Star glasses'], ['shades', 'Visor shades']],
  top: [['hawaiian', 'Hawaiian shirt'], ['tee', 'T-shirt'], ['tank', 'Tank top'], ['rash', 'Rash vest (long sleeves)'], ['wetsuit', 'Wetsuit'], ['none', 'No top']],
  pattern: [['plain', 'Plain'], ['flowers', 'Flowers'], ['stripes', 'Stripes'], ['camo', 'Camo'], ['tiedye', 'Tie-dye'], ['checks', 'Checks'], ['palms', 'Palms'], ['flames', 'Flames'], ['dots', 'Polka dots']],
  bottom: [['boardies', 'Board shorts'], ['short', 'Short shorts'], ['long', 'Long boardies'], ['wetsuit', 'Wetsuit legs']],
  shape: [['shortboard', 'Shortboard'], ['fish', 'Fish'], ['longboard', 'Longboard'], ['gun', 'Big-wave gun'], ['foamie', 'Foamie']],
  fins: [['thruster', 'Thruster (3)'], ['quad', 'Quad (4)'], ['twin', 'Twin (2)'], ['single', 'Single'], ['five', 'Five']],
  design: [['retro', 'Retro split'], ['solid', 'Solid'], ['stripes', 'Racing stripes'], ['flames', 'Flames'], ['fade', 'Fade'], ['checker', 'Checkers'], ['stars', 'Stars'], ['shark', 'Shark bite'], ['wood', 'Wood'], ['none', 'Blank (for painting)']],
};
// how each board feels: longboards glide but turn slowly, short boards snap
export const BOARD_FEEL = {
  shortboard: { turn: 1.0, speed: 1.0, label: 'Fast and snappy' },
  fish: { turn: 1.08, speed: 1.06, label: 'Quick in small waves' },
  longboard: { turn: 0.72, speed: 1.12, label: 'Glides, slow to turn' },
  gun: { turn: 0.85, speed: 1.15, label: 'Built for mega waves' },
  foamie: { turn: 0.9, speed: 0.95, label: 'Soft and stable' },
};
const SHAPE = {
  shortboard: { L: 1.85, W: 0.5, T: 0.07 },
  fish: { L: 1.65, W: 0.56, T: 0.075 },
  longboard: { L: 2.75, W: 0.58, T: 0.08 },
  gun: { L: 2.4, W: 0.48, T: 0.08 },
  foamie: { L: 2.1, W: 0.6, T: 0.1 },
};

export const DEFAULT_LOOK = {
  name: 'You', skin: '#ff6a1c', build: 1, head: 1, eyes: 'dots', mouth: 'flat', beard: 'none',
  hair: 'none', hairColor: '#3b2a20', hat: 'bucket', hatColor: '#8f9152', glasses: 'none', glassesColor: '#16181d',
  top: 'hawaiian', topColor: '#1aa7e0', topPattern: 'flowers', topAccent: '#ffd23d',
  bottom: 'boardies', bottomColor: '#2b3150', bottomPattern: 'stripes', bottomAccent: '#ffd23d',
  board: { shape: 'shortboard', len: 1, fins: 'thruster', base: '#ffd21f', accent: '#1ec8ff', rail: '#ff7a1f', bottom: '#1aa0d8', design: 'retro', finColor: '#223040' },
  ski: { hull: '#f2f2f2', deck: '#ffd21f', accent: '#16181d', seat: '#2b2f36', design: 'racing', sled: true, sledColor: '#ffd23d' },
};
export const PRESETS = [
  { name: 'Wobbly Joe', ...DEFAULT_LOOK },
  { name: 'Coral', skin: '#ff5fa2', eyes: 'big', mouth: 'smile', hair: 'long', hairColor: '#ffd23d', hat: 'none', glasses: 'sunnies', top: 'rash', topColor: '#1ed6c0', topPattern: 'plain', bottom: 'short', bottomColor: '#b06bff', bottomPattern: 'flowers', bottomAccent: '#ffffff', board: { shape: 'fish', len: 1, fins: 'twin', base: '#ffffff', accent: '#ff5fa2', rail: '#1ed6c0', bottom: '#ff5fa2', design: 'stars', finColor: '#ff5fa2' } },
  { name: 'Big Kahuna', skin: '#c68b62', build: 1.25, head: 1.05, eyes: 'happy', mouth: 'grin', beard: 'full', hair: 'long', hairColor: '#16181d', hat: 'straw', hatColor: '#e8c070', top: 'none', bottom: 'long', bottomColor: '#c0392b', bottomPattern: 'palms', bottomAccent: '#ffd23d', board: { shape: 'longboard', len: 1.05, fins: 'single', base: '#f2e6c8', accent: '#8a5634', rail: '#8a5634', bottom: '#8a5634', design: 'wood', finColor: '#8a5634' } },
  { name: 'Shredder', skin: '#7bd64a', build: 0.9, eyes: 'angry', mouth: 'tongue', hair: 'mohawk', hairColor: '#ff3d6e', hat: 'none', glasses: 'star', glassesColor: '#ff3d6e', top: 'tank', topColor: '#16181d', topPattern: 'flames', topAccent: '#ff7a1f', bottom: 'boardies', bottomColor: '#16181d', bottomPattern: 'checks', bottomAccent: '#ffffff', board: { shape: 'shortboard', len: 0.95, fins: 'quad', base: '#16181d', accent: '#ff7a1f', rail: '#ff3d6e', bottom: '#ff3d6e', design: 'flames', finColor: '#ff7a1f' } },
  { name: 'Big Wave Bob', skin: '#3fb8ff', build: 1.1, eyes: 'sleepy', mouth: 'flat', beard: 'stubble', hat: 'helmet', hatColor: '#ff7a1f', glasses: 'none', top: 'wetsuit', topColor: '#16181d', topPattern: 'plain', bottom: 'wetsuit', bottomColor: '#16181d', bottomPattern: 'plain', board: { shape: 'gun', len: 1.05, fins: 'thruster', base: '#ffffff', accent: '#c0392b', rail: '#c0392b', bottom: '#c0392b', design: 'stripes', finColor: '#16181d' } },
  { name: 'Sunny', skin: '#ffe14d', eyes: 'wink', mouth: 'smile', hair: 'afro', hairColor: '#ff7a1f', hat: 'none', glasses: 'round', glassesColor: '#b06bff', top: 'tee', topColor: '#7dff5a', topPattern: 'tiedye', topAccent: '#1ec8ff', bottom: 'boardies', bottomColor: '#1f3cff', bottomPattern: 'dots', bottomAccent: '#ffffff', board: { shape: 'foamie', len: 1, fins: 'thruster', base: '#1ec8ff', accent: '#ffd23d', rail: '#ffffff', bottom: '#ffffff', design: 'checker', finColor: '#ffffff' } },
  { name: 'Lava', skin: '#7a4a2e', build: 1, eyes: 'dots', mouth: 'smile', hair: 'bun', hairColor: '#16181d', hat: 'none', glasses: 'goggles', glassesColor: '#1ec8ff', top: 'rash', topColor: '#ff7a1f', topPattern: 'stripes', topAccent: '#16181d', bottom: 'short', bottomColor: '#16181d', bottomPattern: 'plain', board: { shape: 'fish', len: 1, fins: 'quad', base: '#ff7a1f', accent: '#16181d', rail: '#16181d', bottom: '#16181d', design: 'shark', finColor: '#16181d' } },
  { name: 'Ice', skin: '#b07cff', build: 0.95, eyes: 'big', mouth: 'o', hair: 'spiky', hairColor: '#ffffff', hat: 'beanie', hatColor: '#1ec8ff', glasses: 'shades', glassesColor: '#7dff5a', top: 'hawaiian', topColor: '#ffffff', topPattern: 'palms', topAccent: '#1ec8ff', bottom: 'long', bottomColor: '#1ec8ff', bottomPattern: 'stripes', bottomAccent: '#ffffff', board: { shape: 'shortboard', len: 1, fins: 'five', base: '#ffffff', accent: '#b07cff', rail: '#1ec8ff', bottom: '#b07cff', design: 'fade', finColor: '#b07cff' } },
];

// fill in anything missing (and turn the old four-colour looks into the new kind)
export function normalizeLook(l = {}) {
  const out = { ...DEFAULT_LOOK, ...l, board: { ...DEFAULT_LOOK.board, ...(typeof l.board === 'object' ? l.board : {}) }, ski: { ...DEFAULT_LOOK.ski, ...(l.ski && typeof l.ski === 'object' ? l.ski : {}) } };
  if (l.vest && !l.topColor) out.topColor = l.vest;
  if (l.shorts && !l.bottomColor) out.bottomColor = l.shorts;
  if (l.hair && l.hair.startsWith && l.hair.startsWith('#')) { out.hatColor = l.hair; out.hair = 'none'; out.hat = 'bucket'; }
  if (typeof l.board === 'string') out.board.base = l.board;
  return out;
}

// ---------------------------------------------------------------------------
// fabric patterns
// ---------------------------------------------------------------------------
const texCache = new Map();
export function patternTexture(base, pattern, accent = '#ffd23d') {
  const key = base + pattern + accent;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  const hi = new THREE.Color(base).offsetHSL(0, 0, 0.12).getStyle(), lo = new THREE.Color(base).offsetHSL(0, 0, -0.12).getStyle();
  if (pattern === 'flowers') {
    const petals = [accent, '#ff4f8b', '#ffffff', '#ff8a1f', accent];
    for (let i = 0; i < 26; i++) {
      const cx = r() * 256, cy = r() * 256, s = 10 + r() * 14;
      x.fillStyle = '#1e8f4e';
      for (let k = 0; k < 3; k++) { const a = r() * 6.28; x.beginPath(); x.ellipse(cx + Math.cos(a) * s * 1.2, cy + Math.sin(a) * s * 1.2, s * 0.9, s * 0.35, a, 0, 6.28); x.fill(); }
      x.fillStyle = petals[i % petals.length];
      for (let k = 0; k < 5; k++) { const a = k / 5 * 6.28 + r(); x.beginPath(); x.ellipse(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.55, s * 0.38, a, 0, 6.28); x.fill(); }
      x.fillStyle = '#c0392b'; x.beginPath(); x.arc(cx, cy, s * 0.22, 0, 6.28); x.fill();
    }
  } else if (pattern === 'stripes') {
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? accent : hi; x.fillRect(i * 32 + 4, 0, 12, 256); }
  } else if (pattern === 'camo') {
    const cols = [lo, hi, accent, '#2b3a22'];
    for (let i = 0; i < 70; i++) { x.fillStyle = cols[i % 4]; x.beginPath(); x.ellipse(r() * 256, r() * 256, 10 + r() * 22, 6 + r() * 14, r() * 3, 0, 6.28); x.fill(); }
  } else if (pattern === 'tiedye') {
    for (let k = 9; k > 0; k--) { x.fillStyle = k % 3 === 0 ? accent : k % 3 === 1 ? base : '#ff5fa2'; x.beginPath(); for (let a = 0; a <= 6.3; a += 0.15) { const rr = k * 17 + Math.sin(a * 5 + k) * 8; x.lineTo(128 + Math.cos(a) * rr, 128 + Math.sin(a) * rr); } x.fill(); }
  } else if (pattern === 'checks') {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) { x.fillStyle = accent; x.fillRect(i * 32, j * 32, 32, 32); }
  } else if (pattern === 'palms') {
    for (let i = 0; i < 9; i++) {
      const cx = (i % 3) * 86 + 30 + r() * 20, cy = Math.floor(i / 3) * 86 + 70;
      x.strokeStyle = '#8a5634'; x.lineWidth = 5; x.beginPath(); x.moveTo(cx, cy + 10); x.quadraticCurveTo(cx + 8, cy - 20, cx + 4, cy - 40); x.stroke();
      x.strokeStyle = accent; x.lineWidth = 6;
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; x.beginPath(); x.moveTo(cx + 4, cy - 40); x.quadraticCurveTo(cx + 4 + Math.cos(a) * 18, cy - 50 + Math.sin(a) * 6, cx + 4 + Math.cos(a) * 28, cy - 34 + Math.abs(Math.sin(a)) * 10); x.stroke(); }
    }
  } else if (pattern === 'flames') {
    for (let i = 0; i < 9; i++) {
      x.fillStyle = i % 2 ? accent : '#ffd23d';
      x.beginPath(); x.moveTo(i * 30, 256);
      x.quadraticCurveTo(i * 30 + 25, 170, i * 30 + 8, 90 + r() * 40); x.quadraticCurveTo(i * 30 + 40, 160, i * 30 + 32, 256); x.fill();
    }
  } else if (pattern === 'dots') {
    x.fillStyle = accent;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.arc(i * 32 + (j % 2) * 16 + 8, j * 32 + 16, 7, 0, 6.28); x.fill(); }
  } else {
    // plain: a little fabric texture
    for (let i = 0; i < 600; i++) { x.fillStyle = r() < 0.5 ? hi : lo; x.globalAlpha = 0.25; x.fillRect(r() * 256, r() * 256, 2, 2); }
    x.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1);
  texCache.set(key, t); return t;
}

// ---------------------------------------------------------------------------
// materials and body proportions
// ---------------------------------------------------------------------------
export function makeMaterials(look) {
  const env = { envMap: ENV_MAP, envMapIntensity: 0.3 };
  const fabric = (col, pat, acc, rough = 0.7) => new THREE.MeshStandardMaterial({ map: patternTexture(col, pat, acc), roughness: rough, ...env });
  const skin = new THREE.MeshPhysicalMaterial({ color: look.skin, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(look.skin).offsetHSL(0, 0, 0.2), ...env });
  const neo = (col) => new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5, ...env });
  const top = look.top === 'none' ? skin : look.top === 'wetsuit' ? neo(look.topColor) : fabric(look.topColor, look.top === 'hawaiian' && look.topPattern === 'plain' ? 'flowers' : look.topPattern, look.topAccent, look.top === 'rash' ? 0.45 : 0.7);
  const bottom = look.bottom === 'wetsuit' ? neo(look.bottomColor) : fabric(look.bottomColor, look.bottomPattern, look.bottomAccent, 0.65);
  return {
    skin, top, bottom,
    arms: look.top === 'rash' || look.top === 'wetsuit' ? top : skin,          // long sleeves
    upperArm: look.top === 'tee' || look.top === 'hawaiian' || look.top === 'rash' || look.top === 'wetsuit' ? top : skin,
    shins: look.bottom === 'wetsuit' ? bottom : skin,
    thighs: look.bottom === 'short' ? skin : bottom,
    hat: new THREE.MeshStandardMaterial({ color: look.hatColor, roughness: 0.9, side: THREE.DoubleSide, ...env }),
    hair: new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.75, ...env }),
    glasses: new THREE.MeshPhysicalMaterial({ color: look.glassesColor, roughness: 0.25, clearcoat: 0.8, ...env }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#0b1520', roughness: 0.05, metalness: 0.6, clearcoat: 1, ...env }),
    band: new THREE.MeshStandardMaterial({ color: '#6b3fa0', roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.3 }),
    white: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }),
    pink: new THREE.MeshStandardMaterial({ color: '#ff5f7a', roughness: 0.5 }),
  };
}

// the head: a tall rubbery bean with the chosen face, hair, hat and glasses. Eyes look along -z.
export function makeHead(M, look = DEFAULT_LOOK) {
  const head = new THREE.Group();
  const s = look.head || 1;
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 18), M.skin);
  hd.scale.set(0.95, 1.18, 0.95);
  head.add(hd);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); head.add(m); return m; };
  const BALL = new THREE.SphereGeometry(1, 14, 10);
  // eyes
  for (const sx of [-1, 1]) {
    const ex = sx * 0.052, ey = 0.035, ez = -0.138;
    if (look.eyes === 'big') { add(BALL, M.white, ex, ey, ez + 0.004, 0.034, 0.04, 0.02); add(BALL, M.dark, ex, ey - 0.004, ez - 0.012, 0.018, 0.022, 0.012); }
    else if (look.eyes === 'happy' || (look.eyes === 'wink' && sx > 0)) add(new THREE.TorusGeometry(0.02, 0.006, 6, 12, Math.PI), M.dark, ex, ey - 0.006, ez, 1, 1, 1, 0, 0, 0);
    else if (look.eyes === 'sleepy') add(new THREE.CapsuleGeometry(0.006, 0.03, 3, 6), M.dark, ex, ey, ez, 1, 1, 1, 0, 0, Math.PI / 2);
    else if (look.eyes === 'angry') { add(BALL, M.dark, ex, ey, ez, 0.021, 0.027, 0.013); add(new THREE.CapsuleGeometry(0.006, 0.035, 3, 6), M.dark, ex, ey + 0.04, ez, 1, 1, 1, 0, 0, Math.PI / 2 + sx * 0.4); }
    else add(BALL, M.dark, ex, ey, ez, 0.021, 0.027, 0.013);
  }
  // mouth
  if (look.mouth === 'smile' || look.mouth === 'grin') add(new THREE.TorusGeometry(look.mouth === 'grin' ? 0.04 : 0.03, 0.007, 6, 14, Math.PI), M.dark, 0.003, -0.03, -0.142, 1, 1, 1, 0, 0, Math.PI);
  else if (look.mouth === 'o') add(new THREE.TorusGeometry(0.015, 0.007, 6, 14), M.dark, 0.003, -0.05, -0.142);
  else if (look.mouth === 'tongue') { add(new THREE.TorusGeometry(0.03, 0.007, 6, 14, Math.PI), M.dark, 0.003, -0.03, -0.142, 1, 1, 1, 0, 0, Math.PI); add(BALL, M.pink, 0.012, -0.068, -0.14, 0.016, 0.02, 0.008); }
  else add(new THREE.CapsuleGeometry(0.006, 0.05, 3, 6), M.dark, 0.004, -0.045, -0.142, 1, 1, 1, 0, 0, Math.PI / 2);
  // beard
  if (look.beard === 'full') add(new THREE.SphereGeometry(0.15, 18, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), M.hair, 0, -0.01, -0.005, 1.0, 1.22, 1.02);
  else if (look.beard === 'stubble') { const m = new THREE.MeshStandardMaterial({ color: look.hairColor, transparent: true, opacity: 0.45, roughness: 1 }); add(new THREE.SphereGeometry(0.151, 18, 10, 0, Math.PI * 2, Math.PI * 0.58, Math.PI * 0.42), m, 0, 0, 0, 0.96, 1.19, 0.96); }
  else if (look.beard === 'moustache') for (const sx of [-1, 1]) add(BALL, M.hair, sx * 0.026, -0.022, -0.142, 0.03, 0.011, 0.012, 0, 0, sx * 0.3);
  // hair
  const hairOn = look.hat === 'none' || look.hat === 'visor' || look.hat === 'backcap' || look.hat === 'cap';
  const H = M.hair;
  if (look.hair === 'short') add(new THREE.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), H, 0, 0.02, 0.01, 0.98, 1.2, 0.98);
  else if (look.hair === 'long') { add(new THREE.SphereGeometry(0.158, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), H, 0, 0.02, 0.01, 1, 1.2, 1); add(new THREE.CapsuleGeometry(0.11, 0.18, 4, 12), H, 0, -0.12, 0.07, 1.25, 1, 0.6); }
  else if (look.hair === 'mohawk' && hairOn) for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.03, 0.11, 6), H, 0, 0.19 - Math.abs(i - 2.5) * 0.012, -0.08 + i * 0.035, 1, 1, 1, -0.3 + i * 0.12);
  else if (look.hair === 'afro' && hairOn) add(new THREE.IcosahedronGeometry(0.21, 2), H, 0, 0.1, 0.03, 1, 0.85, 1);
  else if (look.hair === 'bun') { add(new THREE.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), H, 0, 0.02, 0.01, 0.98, 1.2, 0.98); if (hairOn) add(BALL, H, 0, 0.19, 0.06, 0.06, 0.06, 0.06); }
  else if (look.hair === 'ponytail') { add(new THREE.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), H, 0, 0.02, 0.01, 0.98, 1.2, 0.98); add(new THREE.CapsuleGeometry(0.035, 0.16, 4, 8), H, 0, 0.0, 0.17, 1, 1, 1, 0.7); }
  else if (look.hair === 'spiky' && hairOn) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; add(new THREE.ConeGeometry(0.035, 0.12, 5), H, Math.cos(a) * 0.08, 0.17, Math.sin(a) * 0.08 + 0.01, 1, 1, 1, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); }
  // hats
  const T = M.hat;
  if (look.hat === 'bucket' || look.hat === 'straw') {
    const g = new THREE.Group();
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.155, 0.12, 24, 1, false), T); crown.position.y = 0.14;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), T); top.scale.y = 0.35; top.position.y = 0.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.153, 0.157, 0.03, 24, 1, true), M.band); band.position.y = 0.1;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, look.hat === 'straw' ? 0.34 : 0.26, look.hat === 'straw' ? 0.04 : 0.07, 28, 1, true), T); brim.position.y = 0.055;
    g.add(crown, top, band, brim); g.rotation.x = 0.22; g.position.set(0, 0.02, 0.02); head.add(g);
  } else if (look.hat === 'cap' || look.hat === 'backcap') {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.158, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), T); dome.scale.y = 0.9; dome.position.y = 0.06;
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), T); peak.position.set(0, 0.07, -0.13); peak.scale.set(1, 1, 0.9);
    g.add(dome, peak); if (look.hat === 'backcap') g.rotation.y = Math.PI; head.add(g);
  } else if (look.hat === 'beanie') {
    add(new THREE.SphereGeometry(0.162, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), T, 0, 0.04, 0, 1, 1.15, 1);
    add(BALL, T, 0, 0.23, 0, 0.04, 0.04, 0.04);
  } else if (look.hat === 'visor') {
    add(new THREE.TorusGeometry(0.152, 0.012, 6, 24), T, 0, 0.08, 0, 1, 1, 1, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), T, 0, 0.08, -0.13);
  } else if (look.hat === 'helmet') {
    add(new THREE.SphereGeometry(0.17, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), T, 0, 0.03, 0, 1, 1.15, 1);
    add(new THREE.TorusGeometry(0.1, 0.008, 6, 20, Math.PI), M.dark, 0, -0.03, 0, 1.4, 1, 1, 0, Math.PI / 2, Math.PI);
  }
  // glasses
  if (look.glasses !== 'none') {
    const G = M.glasses, L = M.lens;
    if (look.glasses === 'shades') add(new THREE.CapsuleGeometry(0.03, 0.12, 4, 10), L, 0, 0.035, -0.142, 1, 1, 0.5, 0, 0, Math.PI / 2);
    else if (look.glasses === 'goggles') { for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), L, sx * 0.055, 0.035, -0.142, 1, 1, 1, Math.PI / 2); add(new THREE.TorusGeometry(0.152, 0.01, 6, 24), G, 0, 0.035, 0, 1, 1, 1, Math.PI / 2); }
    else if (look.glasses === 'star') for (const sx of [-1, 1]) { const st = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? 0.02 : 0.045; k ? st.lineTo(Math.cos(a) * rr, -Math.sin(a) * rr) : st.moveTo(Math.cos(a) * rr, -Math.sin(a) * rr); } add(new THREE.ExtrudeGeometry(st, { depth: 0.01, bevelEnabled: false }), G, sx * 0.058, 0.035, -0.152); }
    else for (const sx of [-1, 1]) {
      if (look.glasses === 'round') add(new THREE.TorusGeometry(0.03, 0.006, 6, 16), G, sx * 0.055, 0.035, -0.145);
      else { add(BALL, L, sx * 0.055, 0.035, -0.142, 0.042, 0.03, 0.01); add(new THREE.TorusGeometry(0.04, 0.005, 6, 16), G, sx * 0.055, 0.035, -0.143, 1, 0.75, 1); }
    }
    if (look.glasses !== 'goggles') add(new THREE.CapsuleGeometry(0.004, 0.03, 3, 6), G, 0, 0.04, -0.145, 1, 1, 1, 0, 0, Math.PI / 2);
  }
  head.scale.setScalar(s);
  return head;
}

// ---------------------------------------------------------------------------
// the surfboard
// ---------------------------------------------------------------------------
// half-width of the board (0..1 of its full half-width) at t (0 = nose, 1 = tail)
function outline(shape, t) {
  const tt = Math.min(1, Math.max(0, t));
  switch (shape) {
    case 'fish': { let w = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(tt, 0.6) * 0.9 + 0.08)), 0.45); if (tt > 0.85) w = Math.max(w, 0.42); return w; }
    case 'longboard': { let w = Math.pow(Math.sin(Math.PI * (tt * 0.9 + 0.06)), 0.32); if (tt > 0.9) w = Math.max(w, 0.32); return w; }
    case 'gun': return Math.pow(Math.sin(Math.PI * (tt * 0.96 + 0.02)), 0.75);
    case 'foamie': return Math.pow(Math.sin(Math.PI * (tt * 0.88 + 0.06)), 0.3);
    default: { let w = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(tt, 0.75) * 0.93 + 0.04)), 0.62) * (0.25 + 0.75 * Math.sin(Math.min(1, tt / 0.2) * Math.PI / 2)); if (tt > 0.9) w = Math.max(w, 0.34); return w; }
  }
}
export function boardDims(b) { const S = SHAPE[b.shape] || SHAPE.shortboard; return { L: S.L * (b.len || 1), W: S.W }; }
export function boardOutline(shape, n = 64) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([t, outline(shape, t)]); }
  return pts;
}
export const PAINT_W = 256, PAINT_H = 1024;
// The printed design and the paint: a 256 x 1024 picture of the deck seen from above (nose at the top).
// x maps straight across the board's widest width, so a paint stroke lands exactly where you put it.
export function drawDeck(ctx, b, paintImg) {
  const W = PAINT_W, H = PAINT_H;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = b.base; ctx.fillRect(0, 0, W, H);
  const A = b.accent, R = b.rail;
  let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (b.design === 'retro') {
    ctx.fillStyle = A;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.12); ctx.lineTo(0, H * 0.36); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(W, H * 0.68); ctx.lineTo(0, H * 0.92); ctx.fill();
    ctx.strokeStyle = R; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(0, H * 0.36 + 10); ctx.lineTo(W, H * 0.12 + 10); ctx.moveTo(0, H * 0.92 - 10); ctx.lineTo(W, H * 0.68 - 10); ctx.stroke();
  } else if (b.design === 'stripes') {
    for (const [dx, w] of [[-38, 14], [0, 24], [38, 14]]) { ctx.fillStyle = dx ? R : A; ctx.fillRect(W / 2 + dx - w / 2, 0, w, H); }
  } else if (b.design === 'flames') {
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i % 2 ? A : R;
      const x0 = i * 40 - 10;
      ctx.beginPath(); ctx.moveTo(x0, H);
      ctx.bezierCurveTo(x0 + 10, H * 0.75, x0 + 50, H * 0.7, x0 + 20, H * (0.45 + r() * 0.12));
      ctx.bezierCurveTo(x0 + 70, H * 0.68, x0 + 40, H * 0.8, x0 + 60, H);
      ctx.fill();
    }
  } else if (b.design === 'fade') {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, b.base); g.addColorStop(1, A); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (b.design === 'checker') {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) if ((i + j) % 2) { ctx.fillStyle = A; ctx.fillRect(i * 32, j * 32, 32, 32); ctx.fillRect(i * 32, H - (j + 1) * 32, 32, 32); }
  } else if (b.design === 'stars') {
    ctx.fillStyle = A;
    for (let i = 0; i < 26; i++) { const cx = r() * W, cy = r() * H, s = 8 + r() * 16; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? s * 0.45 : s; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.fill(); }
  } else if (b.design === 'shark') {
    ctx.fillStyle = A; ctx.beginPath(); ctx.moveTo(W, H * 0.3);
    for (let k = 0; k <= 10; k++) ctx.lineTo(W - (k % 2 ? 70 : 40), H * 0.3 + k * 26);
    ctx.lineTo(W, H * 0.3 + 260); ctx.fill();
  } else if (b.design === 'wood') {
    for (let i = 0; i < 40; i++) { ctx.strokeStyle = `rgba(90,50,20,${0.08 + r() * 0.15})`; ctx.lineWidth = 2 + r() * 4; ctx.beginPath(); const x0 = r() * W; ctx.moveTo(x0, 0); ctx.bezierCurveTo(x0 + r() * 30 - 15, H * 0.3, x0 + r() * 30 - 15, H * 0.7, x0, H); ctx.stroke(); }
  }
  // the stringer down the middle (not on foamies or blank boards)
  if (b.shape !== 'foamie' && b.design !== 'none') { ctx.fillStyle = 'rgba(60,40,25,0.55)'; ctx.fillRect(W / 2 - 2, H * 0.03, 4, H * 0.94); }
  if (paintImg) ctx.drawImage(paintImg, 0, 0, W, H);
  // a little traction pad on the tail
  if (b.shape !== 'longboard' && b.shape !== 'foamie') {
    ctx.fillStyle = 'rgba(20,22,26,0.85)';
    const y0 = H * 0.86;
    ctx.beginPath(); ctx.roundRect(W * 0.18, y0, W * 0.64, H * 0.12, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2;
    for (let y = y0 + 8; y < y0 + H * 0.12; y += 10) { ctx.beginPath(); ctx.moveTo(W * 0.2, y); ctx.lineTo(W * 0.8, y); ctx.stroke(); }
  }
  ctx.restore();
}

// paint saved as a picture (shared by the board in the water and the paint editor)
export const PAINT = { canvas: null, img: null };
export function paintCanvas() {
  if (!PAINT.canvas) { PAINT.canvas = document.createElement('canvas'); PAINT.canvas.width = PAINT_W; PAINT.canvas.height = PAINT_H; }
  return PAINT.canvas;
}
export function loadPaint(dataURL) {
  const c = paintCanvas();
  return new Promise((res) => {
    if (!dataURL) { res(c); return; }
    const im = new Image();
    im.onload = () => { c.getContext('2d').drawImage(im, 0, 0, PAINT_W, PAINT_H); res(c); };
    im.onerror = () => res(c);
    im.src = dataURL;
  });
}

export function makeBoard(b = DEFAULT_LOOK.board, opts = {}) {
  if (typeof b === 'string') b = { ...DEFAULT_LOOK.board, base: b };
  b = { ...DEFAULT_LOOK.board, ...b };
  const S = SHAPE[b.shape] || SHAPE.shortboard;
  const L = (opts.length || S.L) * (b.len || 1), W = S.W, TH = S.T;
  const NL = 40, NR = 16;
  const pos = [], col = [], uv = [], deck = [], rest = [];
  const rail = new THREE.Color(b.rail), bottom = new THREE.Color(b.bottom);
  for (let i = 0; i <= NL; i++) {
    const t = i / NL;
    const z = -L / 2 + t * L;
    const w = outline(b.shape, t) * W / 2;
    const rock = b.shape === 'longboard' ? Math.pow(1 - t, 3) * 0.14 + Math.pow(t, 4) * 0.03 : Math.pow(1 - t, 3.2) * 0.2 + Math.pow(t, 4) * 0.04;
    const th = TH * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)));
    for (let r = 0; r < NR; r++) {
      const a = r / NR * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = ca * w;
      const y = rock + (sa > 0 ? sa * th * 0.75 : sa * th * 0.3);
      pos.push(x, y, z);
      uv.push(x / W + 0.5, 1 - t);
      const c = sa < -0.05 ? bottom : rail;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NL; i++) for (let r = 0; r < NR; r++) {
    const r2 = (r + 1) % NR;
    const a = i * NR + r, bb = i * NR + r2, c = (i + 1) * NR + r, d = (i + 1) * NR + r2;
    const onDeck = Math.sin(r / NR * Math.PI * 2) > 0.05 && Math.sin(r2 / NR * Math.PI * 2) > 0.05;
    (onDeck ? deck : rest).push(a, bb, c, bb, d, c);
  }
  const capN = pos.length / 3; pos.push(0, 0.2, -L / 2 - 0.001); uv.push(0.5, 1); col.push(rail.r, rail.g, rail.b);
  const capT = pos.length / 3; pos.push(0, 0.04, L / 2 + 0.001); uv.push(0.5, 0); col.push(rail.r, rail.g, rail.b);
  for (let r = 0; r < NR; r++) { rest.push(capN, (r + 1) % NR, r); rest.push(capT, NL * NR + r, NL * NR + (r + 1) % NR); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...deck, ...rest]);
  g.addGroup(0, deck.length, 0); g.addGroup(deck.length, rest.length, 1);
  g.computeVertexNormals();
  // the deck picture
  const cv = document.createElement('canvas'); cv.width = PAINT_W; cv.height = PAINT_H;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const redraw = () => { drawDeck(cv.getContext('2d'), b, opts.paint === false ? null : PAINT.canvas); tex.needsUpdate = true; };
  redraw();
  const foam = b.shape === 'foamie';
  const deckM = new THREE.MeshPhysicalMaterial({ map: tex, roughness: foam ? 0.85 : 0.35, clearcoat: foam ? 0 : 0.5, clearcoatRoughness: 0.2, envMap: ENV_MAP, envMapIntensity: 0.25 });
  const restM = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: foam ? 0.85 : 0.4, clearcoat: foam ? 0 : 0.35, clearcoatRoughness: 0.25, envMap: ENV_MAP, envMapIntensity: 0.25 });
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, [deckM, restM]));
  // fins
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.11, 0); fs.quadraticCurveTo(0.02, -0.05, -0.03, -0.12); fs.lineTo(0, 0);
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.008, bevelEnabled: false });
  fg.rotateY(Math.PI / 2);
  const fm = new THREE.MeshStandardMaterial({ color: b.finColor, roughness: 0.4 });
  const sw = W * 0.34;
  const FINS = {
    thruster: [[0, L / 2 - 0.08, 0, 1], [-sw, L / 2 - 0.3, 0.07, 1], [sw, L / 2 - 0.3, -0.07, 1]],
    quad: [[-sw, L / 2 - 0.3, 0.07, 1], [sw, L / 2 - 0.3, -0.07, 1], [-sw * 0.8, L / 2 - 0.14, 0.05, 0.85], [sw * 0.8, L / 2 - 0.14, -0.05, 0.85]],
    twin: [[-sw * 0.9, L / 2 - 0.22, 0.08, 1.25], [sw * 0.9, L / 2 - 0.22, -0.08, 1.25]],
    single: [[0, L / 2 - 0.16, 0, 1.9]],
    five: [[0, L / 2 - 0.08, 0, 0.9], [-sw, L / 2 - 0.3, 0.07, 1], [sw, L / 2 - 0.3, -0.07, 1], [-sw * 0.8, L / 2 - 0.14, 0.05, 0.8], [sw * 0.8, L / 2 - 0.14, -0.05, 0.8]],
  };
  for (const [x, z, ry, s] of FINS[b.fins] || FINS.thruster) {
    const f = new THREE.Mesh(fg, fm); f.position.set(x, 0.03, z); f.rotation.y = ry; f.scale.setScalar(s); grp.add(f);
  }
  grp.userData.length = L;
  grp.userData.redraw = redraw;
  grp.userData.shape = b.shape;
  return grp;
}
