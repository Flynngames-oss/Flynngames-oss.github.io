// Procedurally painted textures (all original, drawn at startup — no image files).
import * as THREE from 'three';

function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// Speckle noise helper: draws many tiny dots of varying brightness.
function speckle(x, n, size, count, lo, hi, alpha = 1) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(lo + rnd() * (hi - lo));
    x.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    x.fillRect(rnd() * n, rnd() * n, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}

// Greyscale grass/ground detail: multiplied with the terrain's vertex colours.
export function grassDetail() {
  const n = 256, [c, x] = canvas(n);
  x.fillStyle = '#e6e6e6'; x.fillRect(0, 0, n, n);
  speckle(x, n, 3, 2600, 190, 255, 0.5);
  x.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const px = rnd() * n, py = rnd() * n, l = 3 + rnd() * 6, a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
    const v = Math.floor(200 + rnd() * 55);
    x.strokeStyle = `rgba(${v},${v},${v},0.7)`; x.lineWidth = 1 + rnd();
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  return tex(c);
}

export function pavingTexture() {
  const n = 256, [c, x] = canvas(n);
  x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, n, n);
  const t = 64;
  for (let j = 0; j < n / t; j++) for (let i = 0; i < n / t; i++) {
    const v = Math.floor(225 + rnd() * 30);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
  }
  speckle(x, n, 2, 1500, 200, 255, 0.35);
  x.strokeStyle = 'rgba(150,150,150,0.8)'; x.lineWidth = 3;
  for (let k = 0; k <= n; k += t) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, n); x.moveTo(0, k); x.lineTo(n, k); x.stroke(); }
  return tex(c);
}

export function asphaltTexture(lines = true) {
  const n = 128, [c, x] = canvas(n);
  x.fillStyle = '#5a5f68'; x.fillRect(0, 0, n, n);
  for (let i = 0; i < 2500; i++) {
    const v = Math.floor(70 + rnd() * 60);
    x.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
    x.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // lane markings
  if (lines) { x.fillStyle = '#ffd54a'; x.fillRect(61, 8, 6, 56);
  x.fillStyle = '#eeeeee'; x.fillRect(4, 0, 4, n); x.fillRect(n - 8, 0, 4, n); }
  // a few cracks
  x.strokeStyle = 'rgba(40,40,45,0.5)'; x.lineWidth = 1;
  for (let i = 0; i < 4; i++) { let px = 15 + rnd() * 100, py = rnd() * n; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rnd() - 0.5) * 12; py += rnd() * 10; x.lineTo(px, py); } x.stroke(); }
  return tex(c);
}

// Building walls: plaster with framed four-pane windows. White-ish so material colour tints it.
// Building facade: a 4 x 4 block of window bays (each bay 4 m) so windows vary — some blinds down,
// different reflections, and at night only some offices have their lights on.
export function wallTextures(kind = 'office') {
  if (kind === 'house') return houseTextures();
  const n = 512, bay = 128, [c, x] = canvas(n);
  x.fillStyle = '#e9e7e2'; x.fillRect(0, 0, n, n);
  speckle(x, n, 2, 9000, 205, 250, 0.35);
  const [e, y] = canvas(n);
  y.fillStyle = '#000'; y.fillRect(0, 0, n, n);
  for (let r = 0; r < 4; r++) {
    // floor slab line
    x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, r * bay + 114, n, 4);
    for (let k = 0; k < 4; k++) {
      const bx = k * bay, by = r * bay, wx = bx + 24, wy = by + 26, ww = bay - 48, wh = 70;
      // dirt streak under the sill
      const dg = x.createLinearGradient(0, wy + wh, 0, wy + wh + 30);
      dg.addColorStop(0, 'rgba(60,55,50,0.10)'); dg.addColorStop(1, 'rgba(60,55,50,0)');
      x.fillStyle = dg; x.fillRect(wx + 6, wy + wh, ww - 12, 30);
      // frame
      x.fillStyle = '#4a4e54'; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      // glass: sky reflection fading down into the dark interior
      const tint = rnd();
      const g = x.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
      g.addColorStop(0, `rgb(${178 + tint * 30 | 0},${196 + tint * 25 | 0},${212 + tint * 20 | 0})`);
      g.addColorStop(0.5, `rgb(${104 + tint * 25 | 0},${122 + tint * 25 | 0},${140 + tint * 25 | 0})`);
      g.addColorStop(1, `rgb(${58 + tint * 15 | 0},${68 + tint * 15 | 0},${80 + tint * 15 | 0})`);
      x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
      // blinds pulled part way down in some windows
      const blind = rnd() < 0.35 ? rnd() * 0.7 : 0;
      if (blind) { x.fillStyle = rnd() < 0.5 ? '#d8d2c4' : '#bfc3c6'; x.fillRect(wx, wy, ww, wh * blind); x.fillStyle = 'rgba(0,0,0,0.08)'; for (let l = wy + 3; l < wy + wh * blind; l += 4) x.fillRect(wx, l, ww, 1); }
      // soft diagonal glare
      x.fillStyle = 'rgba(255,255,255,0.08)';
      x.beginPath(); x.moveTo(wx + ww * 0.15, wy + wh); x.lineTo(wx + ww * 0.45, wy); x.lineTo(wx + ww * 0.6, wy); x.lineTo(wx + ww * 0.3, wy + wh); x.fill();
      // mullion + transom
      x.fillStyle = '#4a4e54'; x.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); x.fillRect(wx, wy + wh * 0.72, ww, 2);
      // sill
      x.fillStyle = '#cfcbc4'; x.fillRect(wx - 5, wy + wh + 3, ww + 10, 4);
      // night: roughly 40% of offices lit, warm or cool light
      if (rnd() < 0.42) {
        const warm = rnd() < 0.7, b2 = 0.55 + rnd() * 0.45;
        y.fillStyle = warm ? `rgba(255,${205 + rnd() * 30 | 0},${140 + rnd() * 40 | 0},${b2})` : `rgba(210,230,255,${b2})`;
        y.fillRect(wx, wy + wh * blind, ww, wh * (1 - blind));
        if (blind) { y.fillStyle = `rgba(255,220,170,${b2 * 0.4})`; y.fillRect(wx, wy, ww, wh * blind); }
        y.fillStyle = '#000'; y.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      }
    }
  }
  const map = tex(c), emit = tex(e);
  return { map, emit };
}

// Houses: painted lap siding and smaller windows with white trim, one per 4 m bay.
function houseTextures() {
  const n = 512, bay = 128, [c, x] = canvas(n);
  x.fillStyle = '#efece6'; x.fillRect(0, 0, n, n);
  for (let yy = 0; yy < n; yy += 8) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, yy + 6, n, 2); x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, yy, n, 1); }
  speckle(x, n, 2, 4000, 215, 250, 0.25);
  const [e, y] = canvas(n);
  y.fillStyle = '#000'; y.fillRect(0, 0, n, n);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    const bx = k * bay, by = r * bay, ww = 50, wh = 58, wx = bx + (bay - ww) / 2, wy = by + 30;
    x.fillStyle = '#fbfbf8'; x.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);          // trim
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(wx - 6, wy + wh + 6, ww + 12, 3);
    const g = x.createLinearGradient(wx, wy, wx + 20, wy + wh);
    g.addColorStop(0, '#b8cad8'); g.addColorStop(0.55, '#6c7f90'); g.addColorStop(1, '#3a4652');
    x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
    if (rnd() < 0.4) { x.fillStyle = '#f2ece0'; x.fillRect(wx, wy, ww, wh * (0.3 + rnd() * 0.4)); }   // curtains/blinds
    x.fillStyle = '#fbfbf8'; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); x.fillRect(wx, wy + wh / 2 - 2, ww, 4);
    if (rnd() < 0.3) { x.fillStyle = 'rgba(60,70,80,0.9)'; x.fillRect(wx - 20, wy - 4, 12, wh + 8); x.fillRect(wx + ww + 8, wy - 4, 12, wh + 8); }  // shutters
    if (rnd() < 0.5) { y.fillStyle = `rgba(255,${200 + rnd() * 40 | 0},140,${0.6 + rnd() * 0.4})`; y.fillRect(wx, wy, ww, wh); y.fillStyle = '#000'; y.fillRect(wx + ww / 2 - 2, wy, 4, wh); y.fillRect(wx, wy + wh / 2 - 2, ww, 4); }
  }
  return { map: tex(c), emit: tex(e) };
}

export function roofTexture() {
  const n = 128, [c, x] = canvas(n);
  x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, n, n);
  for (let r = 0; r < 8; r++) for (let k = 0; k < 9; k++) {
    const v = Math.floor(185 + rnd() * 60);
    x.fillStyle = `rgb(${v},${v},${v})`;
    const off = r % 2 ? 8 : 0;
    x.fillRect(k * 16 - off + 1, r * 16 + 1, 14, 14);
  }
  return tex(c);
}

export function woodTexture() {
  const n = 128, [c, x] = canvas(n);
  x.fillStyle = '#eeeeee'; x.fillRect(0, 0, n, n);
  for (let i = 0; i < 60; i++) {
    const v = Math.floor(190 + rnd() * 60);
    x.strokeStyle = `rgba(${v},${v},${v},0.8)`; x.lineWidth = 1 + rnd() * 2;
    const y0 = rnd() * n;
    x.beginPath(); x.moveTo(0, y0); x.bezierCurveTo(n / 3, y0 + (rnd() - 0.5) * 8, 2 * n / 3, y0 + (rnd() - 0.5) * 8, n, y0); x.stroke();
  }
  x.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < n; k += 32) x.fillRect(0, k, n, 2);
  return tex(c);
}

// Water ripples (tinted blue by the material)
export function waterTexture() {
  const n = 256, [c, x] = canvas(n);
  x.fillStyle = '#d8e8ff'; x.fillRect(0, 0, n, n);
  for (let i = 0; i < 260; i++) {
    const px = rnd() * n, py = rnd() * n, r = 4 + rnd() * 16;
    x.strokeStyle = `rgba(255,255,255,${0.2 + rnd() * 0.4})`; x.lineWidth = 1 + rnd() * 2;
    x.beginPath(); x.ellipse(px, py, r * 1.6, r * 0.5, 0, 0, Math.PI * (0.6 + rnd() * 0.8)); x.stroke();
  }
  return tex(c);
}

// Sky gradient dome
export function makeSky() {
  const g = new THREE.SphereGeometry(1000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#3f8fe8') }, horizon: { value: new THREE.Color('#bfe6ff') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color('#fff4d0') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
        if (vP.y < 0.0) c = horizon;
        float s = max(dot(vP, normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 900.0) * 2.0 + pow(s, 40.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}
