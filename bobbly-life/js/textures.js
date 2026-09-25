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

export function asphaltTexture() {
  const n = 128, [c, x] = canvas(n);
  x.fillStyle = '#5a5f68'; x.fillRect(0, 0, n, n);
  for (let i = 0; i < 2500; i++) {
    const v = Math.floor(70 + rnd() * 60);
    x.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
    x.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // lane markings
  x.fillStyle = '#ffd54a'; x.fillRect(61, 8, 6, 56);
  x.fillStyle = '#eeeeee'; x.fillRect(4, 0, 4, n); x.fillRect(n - 8, 0, 4, n);
  // a few cracks
  x.strokeStyle = 'rgba(40,40,45,0.5)'; x.lineWidth = 1;
  for (let i = 0; i < 4; i++) { let px = 15 + rnd() * 100, py = rnd() * n; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rnd() - 0.5) * 12; py += rnd() * 10; x.lineTo(px, py); } x.stroke(); }
  return tex(c);
}

// Building walls: plaster with framed four-pane windows. White-ish so material colour tints it.
export function wallTextures() {
  const n = 256, [c, x] = canvas(n);
  x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, n, n);
  speckle(x, n, 2, 3000, 215, 255, 0.4);
  // subtle horizontal siding lines
  x.fillStyle = 'rgba(0,0,0,0.05)';
  for (let k = 0; k < n; k += 16) x.fillRect(0, k, n, 2);
  // window
  const wx = 64, wy = 52, ww = 128, wh = 120;
  x.fillStyle = '#d0d0d0'; x.fillRect(wx - 10, wy - 10, ww + 20, wh + 20);           // frame shadow
  x.fillStyle = '#ffffff'; x.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);             // frame
  const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
  g.addColorStop(0, '#bfe3ff'); g.addColorStop(0.45, '#7fb2e0'); g.addColorStop(0.55, '#a8d2f5'); g.addColorStop(1, '#5d8fc4');
  x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
  x.fillStyle = 'rgba(255,255,255,0.35)';
  x.beginPath(); x.moveTo(wx + 10, wy + wh - 10); x.lineTo(wx + 50, wy + 10); x.lineTo(wx + 70, wy + 10); x.lineTo(wx + 30, wy + wh - 10); x.fill();
  x.fillStyle = '#ffffff'; x.fillRect(wx + ww / 2 - 4, wy, 8, wh); x.fillRect(wx, wy + wh / 2 - 4, ww, 8);
  x.fillStyle = '#c8c8c8'; x.fillRect(wx - 14, wy + wh + 8, ww + 28, 10);            // sill
  x.fillStyle = '#e8e8e8'; x.fillRect(wx - 14, wy + wh + 6, ww + 28, 5);
  const map = tex(c);
  const [e, y] = canvas(n);
  y.fillStyle = '#000'; y.fillRect(0, 0, n, n);
  const eg = y.createLinearGradient(0, wy, 0, wy + wh);
  eg.addColorStop(0, '#ffe7a8'); eg.addColorStop(1, '#ffb84a');
  y.fillStyle = eg; y.fillRect(wx, wy, ww, wh);
  y.fillStyle = '#000'; y.fillRect(wx + ww / 2 - 4, wy, 8, wh); y.fillRect(wx, wy + wh / 2 - 4, ww, 8);
  const emit = tex(e);
  return { map, emit };
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
