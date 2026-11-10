// Everything you see: the arena built straight from the collision shape, stands and lights outside
// the glass, cars built from simple shapes, the ball, boost pads, particles and name tags.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { W, H, L, R, GW, GH, GD, GR, GOAL_CZ, GOAL_HZ, BALL_R, PADS, sdArena, sdGoal, free, normalAt, ray } from './arena.js';
import { WHEELS, WHEEL_R } from './physics.js';

export const TEAM_COLORS = [new THREE.Color('#2f7dff'), new THREE.Color('#ff3b4f')];
export const TEAM_CSS = ['#2f7dff', '#ff3b4f'];
export const TEAM_NAMES = ['Blue', 'Red'];

// ---------- arena surface ----------
function sampleAxis(b, r, step, fil, extras) {
  const inner = b - r, vals = new Set();
  const n = Math.max(1, Math.ceil((2 * inner) / step));
  for (let i = 0; i <= n; i++) vals.add(+(-inner + (2 * inner * i) / n).toFixed(4));
  for (let k = 1; k <= fil; k++) {
    const o = r * Math.tan((k / fil) * (Math.PI / 4));
    vals.add(+(inner + o).toFixed(4)); vals.add(+(-inner - o).toFixed(4));
  }
  for (const e of extras) if (Math.abs(e) < inner) vals.add(+e.toFixed(4));
  return [...vals].sort((a, b2) => a - b2);
}

// triangles over the surface of a rounded box; keep(cx,cy,cz) decides which triangles stay
function roundBoxSurface(cx, cy, cz, B, r, step, fil, extras, keep, out) {
  const faces = [[0, 1, 2, 1], [0, -1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]];
  const p = [0, 0, 0], tmp = new THREE.Vector3();
  for (const [na, s, ua, va] of faces) {
    const us = sampleAxis(B[ua], r, step, fil, extras[na]?.[ua] || []);
    const vs = sampleAxis(B[va], r, step, fil, extras[na]?.[va] || []);
    const grid = [];
    for (let j = 0; j < vs.length; j++) {
      for (let i = 0; i < us.length; i++) {
        p[na] = s * B[na]; p[ua] = us[i]; p[va] = vs[j];
        // project the cube point onto the rounded box
        const q = [0, 0, 0];
        let dx = 0, dy = 0, dz = 0;
        for (let k = 0; k < 3; k++) {
          const inner = B[k] - r;
          q[k] = Math.max(-inner, Math.min(inner, p[k]));
        }
        dx = p[0] - q[0]; dy = p[1] - q[1]; dz = p[2] - q[2];
        const dl = Math.hypot(dx, dy, dz) || 1;
        grid.push(cx + q[0] + (dx / dl) * r, cy + q[1] + (dy / dl) * r, cz + q[2] + (dz / dl) * r);
      }
    }
    const nu = us.length;
    const vtx = (i, j) => { const o = (j * nu + i) * 3; return [grid[o], grid[o + 1], grid[o + 2]]; };
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i + 1, j + 1), d = vtx(i, j + 1);
        for (const tri of [[a, b, c], [a, c, d]]) {
          tmp.set((tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3);
          if (!keep(tmp.x, tmp.y, tmp.z)) continue;
          const isFloor = tmp.y < 0.05 && Math.abs(tri[0][1]) < 0.05 && Math.abs(tri[1][1]) < 0.05 && Math.abs(tri[2][1]) < 0.05;
          (isFloor ? out.floor : out.wall).push(...tri[0], ...tri[1], ...tri[2]);
        }
      }
    }
  }
}

function makeGeo(arr) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(arr);
  const nor = new Float32Array(arr.length);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    normalAt(pos[i], pos[i + 1], pos[i + 2], n);
    nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

const arenaVert = `
varying vec3 vP; varying vec3 vN;
void main() { vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const arenaFrag = `
uniform float uFloor; uniform float uTime; uniform vec3 uBlue; uniform vec3 uRed; uniform float uFlash; uniform float uFlashSide;
varying vec3 vP; varying vec3 vN;
float lineAA(float d, float w) { float f = fwidth(d); return 1.0 - smoothstep(w - f, w + f, d); }
void main() {
  vec3 n = normalize(vN);
  float side = smoothstep(-6.0, 6.0, vP.z);
  vec3 team = mix(uBlue, uRed, side);
  float light = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.3, 1.0, 0.2))), 0.0);
  if (uFloor > 0.5) {
    // turf with mowing stripes and pitch lines
    float stripe = step(0.5, fract(vP.z / 7.0));
    vec3 col = mix(vec3(0.13, 0.36, 0.17), vec3(0.16, 0.42, 0.2), stripe);
    col = mix(col, col * 0.78 + team * 0.10, 0.6);
    float ln = 0.0;
    ln = max(ln, lineAA(abs(vP.z), 0.18));
    ln = max(ln, lineAA(abs(length(vP.xz) - 10.0), 0.18));
    ln = max(ln, lineAA(length(vP.xz), 0.7));
    // goal boxes
    float bz = abs(vP.z);
    float inBoxX = step(abs(vP.x), 15.0);
    ln = max(ln, lineAA(abs(bz - 38.0), 0.18) * inBoxX);
    ln = max(ln, lineAA(abs(abs(vP.x) - 15.0), 0.18) * step(38.0, bz) * step(bz, ${L.toFixed(1)}));
    ln = max(ln, lineAA(abs(bz - ${L.toFixed(1)}), 0.22) * step(abs(vP.x), ${GW.toFixed(1)}));
    // outer edge of the flat bit
    ln = max(ln, lineAA(abs(abs(vP.x) - ${(W - R).toFixed(1)}), 0.18) * step(bz, ${(L - R).toFixed(1)}));
    ln = max(ln, lineAA(abs(bz - ${(L - R).toFixed(1)}), 0.18) * step(${GW.toFixed(1)}, abs(vP.x)) * step(abs(vP.x), ${(W - R).toFixed(1)}));
    vec3 lc = mix(vec3(0.92), team * 1.3 + 0.2, 0.25);
    col = mix(col, lc, ln * 0.85);
    // goal floor glows
    if (bz > ${L.toFixed(1)}) col = mix(col, team * 0.5, 0.45);
    col += team * uFlash * 0.35 * (uFlashSide < 0.5 ? 1.0 - side : side);
    gl_FragColor = vec4(col * light, 1.0);
  } else {
    float bz = abs(vP.z);
    float inGoal = step(${(L + 0.05).toFixed(2)}, bz);
    // hex-ish panel grid on the glass, net in the goals
    vec2 uv = vec2(vP.x + vP.z, vP.y) / 7.0;
    if (abs(n.x) > 0.7) uv = vec2(vP.z, vP.y) / 7.0;
    if (n.y < -0.5) uv = vP.xz / 9.0;
    vec2 g = abs(fract(uv) - 0.5);
    float grid = lineAA(min(g.x, g.y), 0.012) * (n.y < -0.5 ? 0.25 : 0.55) * (1.0 - smoothstep(14.0, 20.0, vP.y) * 0.5);
    vec2 nuv = (abs(n.x) > 0.7 ? vec2(vP.z, vP.y) : (abs(n.y) > 0.7 ? vec2(vP.x, vP.z) : vec2(vP.x, vP.y))) / 0.45;
    vec2 ng = abs(fract(nuv) - 0.5);
    float net = lineAA(min(ng.x, ng.y), 0.06);
    float low = 1.0 - smoothstep(0.6, 3.2, vP.y);
    vec3 base = mix(vec3(0.05, 0.07, 0.12), team * 0.35, 0.35);
    vec3 col = base * light + team * grid;
    float a = mix(0.14, 0.95, low) + grid * 0.4;
    // ramp trim stripe
    float trim = lineAA(abs(vP.y - 2.2), 0.08);
    col = mix(col, team * 1.4 + 0.15, trim);
    a = max(a, trim);
    if (inGoal > 0.5) {
      col = mix(vec3(0.03), team * 0.9 + 0.1, net);
      a = 0.15 + net * 0.85;
    }
    col += team * uFlash * 0.6 * (uFlashSide < 0.5 ? 1.0 - side : side);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
}`;

export function buildArena(scene) {
  const out = { floor: [], wall: [] };
  // the main room: drop the bits that sit inside the goal mouths
  const ex = { 2: { 0: [-GW, GW] }, 1: { 0: [-GW, GW] } };
  roundBoxSurface(0, H, 0, [W, H, L], R, 1.6, 10, ex, (x, y, z) => sdGoal(x, y, z) > -0.01, out);
  // goal boxes: keep only what's outside the main room
  for (const s of [-1, 1]) {
    roundBoxSurface(0, GH / 2, s * GOAL_CZ, [GW, GH / 2, GOAL_HZ], GR, 0.3, 4, {}, (x, y, z) => sdArena(x, y, z) > 0.01, out);
  }
  const uniforms = {
    uFloor: { value: 1 }, uTime: { value: 0 }, uBlue: { value: TEAM_COLORS[0].clone() }, uRed: { value: TEAM_COLORS[1].clone() },
    uFlash: { value: 0 }, uFlashSide: { value: 0 },
  };
  const floorMat = new THREE.ShaderMaterial({ vertexShader: arenaVert, fragmentShader: arenaFrag, uniforms, side: THREE.DoubleSide, extensions: { derivatives: true } });
  const wallUniforms = { ...uniforms, uFloor: { value: 0 } };
  const wallMat = new THREE.ShaderMaterial({ vertexShader: arenaVert, fragmentShader: arenaFrag, uniforms: wallUniforms, side: THREE.DoubleSide, transparent: true, depthWrite: false, extensions: { derivatives: true } });
  const floor = new THREE.Mesh(makeGeo(out.floor), floorMat);
  const wall = new THREE.Mesh(makeGeo(out.wall), wallMat);
  wall.renderOrder = 2;
  scene.add(floor, wall);

  // goal frames
  for (const s of [-1, 1]) {
    const col = TEAM_COLORS[s < 0 ? 0 : 1];
    const m = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.3) });
    const post = new THREE.CylinderGeometry(0.22, 0.22, GH, 10);
    for (const x of [-GW, GW]) { const p = new THREE.Mesh(post, m); p.position.set(x, GH / 2, s * L); scene.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, GW * 2 + 0.44, 10), m);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, GH, s * L); scene.add(bar);
    const glow = new THREE.PointLight(col, 30, 30, 2); glow.position.set(0, 3, s * (L + 3)); scene.add(glow);
  }
  buildStands(scene);
  return { floorMat, wallMat, uniforms, wallUniforms };
}

function buildStands(scene) {
  // a ring of seating with a crowd, dark stadium and light towers
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: '#0b1220' }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; scene.add(ground);
  const tierMat = new THREE.MeshLambertMaterial({ color: '#1c2436' });
  const rows = 9, crowd = [];
  const ox = W + 6, oz = L + GD + 5;
  for (let k = 0; k < rows; k++) {
    const d = k * 2.4, h = 1 + k * 1.8;
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, (oz + d) * 2), tierMat);
      side.position.set(s * (ox + d + 1.2), h / 2, 0); scene.add(side);
      const end = new THREE.Mesh(new THREE.BoxGeometry((ox + d) * 2 + 4.8, h, 2.4), tierMat);
      end.position.set(0, h / 2, s * (oz + d + 1.2)); scene.add(end);
      for (let z = -(oz + d) + 1; z < oz + d - 1; z += 1.3) crowd.push([s * (ox + d + 1.2), h, z]);
      for (let x = -(ox + d) + 1; x < ox + d - 1; x += 1.3) crowd.push([x, h, s * (oz + d + 1.2)]);
    }
  }
  const geo = new THREE.BoxGeometry(0.6, 1.1, 0.5);
  geo.translate(0, 0.55, 0);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const inst = new THREE.InstancedMesh(geo, mat, crowd.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const palette = ['#2f7dff', '#ff3b4f', '#f5f5f5', '#ffd23f', '#3a3f52', '#7ee081'];
  crowd.forEach((p, i) => {
    m4.makeTranslation(p[0] + (Math.random() - 0.5) * 0.3, p[1], p[2]);
    inst.setMatrixAt(i, m4);
    const team = p[2] < 0 ? 0 : 1;
    col.set(Math.random() < 0.55 ? palette[team] : palette[2 + Math.floor(Math.random() * 4)]);
    inst.setColorAt(i, col);
  });
  scene.add(inst);
  // light towers
  const towerMat = new THREE.MeshLambertMaterial({ color: '#30384a' });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6dd' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.4, 44, 1.4), towerMat);
    t.position.set(sx * (ox + 26), 22, sz * (oz + 18)); scene.add(t);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 1), lampMat);
    lamp.position.set(sx * (ox + 26), 44, sz * (oz + 18)); lamp.lookAt(0, 0, 0); scene.add(lamp);
  }
  // a big dome of stars
  const sg = new THREE.BufferGeometry(); const sp = [];
  for (let i = 0; i < 900; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.2;
    sp.push(Math.cos(th) * Math.sin(ph) * 400, Math.cos(ph) * 400, Math.sin(th) * Math.sin(ph) * 400);
  }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfe3ff', size: 1.4, sizeAttenuation: false })));
}

// ---------- ball ----------
function ballTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#eef1f6'; g.fillRect(0, 0, 512, 256);
  // panels: a pattern of diamonds and stripes (our own ball design)
  g.strokeStyle = '#9aa6bb'; g.lineWidth = 5;
  for (let i = 0; i < 8; i++) {
    const x = i * 64;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 64); g.lineTo(x, 128); g.lineTo(x + 32, 192); g.lineTo(x, 256); g.stroke();
  }
  g.fillStyle = '#ffb300';
  for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(i * 64 + 32, 128, 12, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#303848'; g.fillRect(0, 0, 512, 18); g.fillRect(0, 238, 512, 18);
  g.fillStyle = '#ffb300'; g.fillRect(0, 122, 512, 12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function makeBall() {
  const tex = ballTexture();
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 }));
  return m;
}

// soft dark blob on the floor (also tells you exactly where the ball is)
export function makeShadow(size, dark = 0.55) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, `rgba(0,0,0,${dark})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.renderOrder = 1;
  return m;
}
const _sn = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
export function placeShadow(sh, x, y, z, baseSize) {
  const t = ray(x, y, z, 0, -1, 0, 30);
  if (t < 0) { sh.visible = false; return; }
  sh.visible = true;
  const hy = y - t;
  normalAt(x, hy, z, _sn);
  sh.position.set(x + _sn.x * 0.03, hy + _sn.y * 0.03, z + _sn.z * 0.03);
  sh.quaternion.setFromUnitVectors(_z, _sn);
  const s = Math.max(0.4, 1 - t * 0.04) * baseSize;
  sh.scale.set(s, s, 1);
}

// ---------- cars ----------
export const BODIES = ['Brick', 'Dart', 'Bubble', 'Hauler'];
export const TOPPERS = ['None', 'Cone', 'Crown', 'Halo', 'Antenna', 'Fin'];
export const ACCENTS = ['#ffffff', '#111318', '#ffd23f', '#7ee081', '#b46bff', '#ff8a1f', '#26e0d8', '#ff5ac8', '#9aa6bb', '#7a4a2a'];
export const WHEELS_COL = ['#202329', '#d9dde6', '#ffd23f', '#ff3b4f', '#26e0d8', '#7ee081'];
export const TRAILS = ['#ffb347', '#6ad4ff', '#b46bff', '#7ee081', '#ff5ac8', '#ffffff'];

export function defaultLook() { return { name: 'Player', body: 0, accent: 0, wheels: 0, trail: 0, topper: 0, shade: 0 }; }

function teamPaint(team, shade) {
  const c = TEAM_COLORS[team].clone();
  if (shade === 1) c.multiplyScalar(0.65);
  if (shade === 2) c.lerp(new THREE.Color('#ffffff'), 0.35);
  return c;
}

export function makeCar(look, team) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshStandardMaterial({ color: teamPaint(team, look.shade | 0), roughness: 0.35, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: ACCENTS[look.accent | 0] || '#ffffff', roughness: 0.4, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0d1420', roughness: 0.1, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.8 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2030' });
  const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const b = look.body | 0;
  if (b === 0) { // Brick: chunky and boxy
    add(new RoundedBoxGeometry(0.86, 0.26, 1.2, 2, 0.06), paint, 0, -0.03, 0);
    add(new RoundedBoxGeometry(0.72, 0.2, 0.56, 2, 0.05), glass, 0, 0.17, -0.08);
    add(new THREE.BoxGeometry(0.74, 0.03, 0.5), accent, 0, 0.28, -0.08);
    add(new THREE.BoxGeometry(0.84, 0.04, 0.16), accent, 0, 0.24, -0.55);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.08), dark, 0.3, 0.16, -0.55); add(new THREE.BoxGeometry(0.05, 0.12, 0.08), dark, -0.3, 0.16, -0.55);
    add(new THREE.BoxGeometry(0.2, 0.27, 1.21), accent, 0, -0.03, 0).scale.set(1, 1.002, 1);
  } else if (b === 1) { // Dart: low wedge
    const s = new THREE.Shape();
    s.moveTo(-0.6, -0.15); s.lineTo(0.62, -0.15); s.lineTo(0.62, -0.03); s.lineTo(0.15, 0.08); s.lineTo(-0.15, 0.22); s.lineTo(-0.5, 0.2); s.lineTo(-0.6, 0.08);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.84, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    geo.translate(0, 0, -0.42); geo.rotateY(-Math.PI / 2);
    add(geo, paint, 0, 0, 0);
    const cab = add(new THREE.BoxGeometry(0.66, 0.12, 0.44), glass, 0, 0.18, -0.12); cab.rotation.x = -0.25;
    add(new THREE.BoxGeometry(0.9, 0.035, 0.18), accent, 0, 0.3, -0.56);
    add(new THREE.BoxGeometry(0.05, 0.1, 0.06), dark, 0.32, 0.24, -0.56); add(new THREE.BoxGeometry(0.05, 0.1, 0.06), dark, -0.32, 0.24, -0.56);
    add(new THREE.BoxGeometry(0.88, 0.03, 0.3), accent, 0, -0.04, 0.5);
  } else if (b === 2) { // Bubble: round and cute
    add(new RoundedBoxGeometry(0.84, 0.24, 1.16, 3, 0.11), paint, 0, -0.04, 0);
    const dome = add(new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.07, -0.05);
    dome.scale.set(1, 0.6, 1.1);
    add(new THREE.TorusGeometry(0.34, 0.03, 6, 20), accent, 0, 0.08, -0.05).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.08, 10, 8), accent, 0, 0.24, -0.05);
  } else { // Hauler: tall truck
    add(new RoundedBoxGeometry(0.86, 0.3, 1.2, 2, 0.05), paint, 0, -0.01, 0);
    add(new RoundedBoxGeometry(0.78, 0.26, 0.5, 2, 0.05), paint, 0, 0.24, 0.12);
    add(new THREE.BoxGeometry(0.72, 0.16, 0.06), glass, 0, 0.26, 0.38);
    add(new THREE.BoxGeometry(0.8, 0.05, 0.5), accent, 0, 0.17, -0.32);
    add(new THREE.BoxGeometry(0.6, 0.05, 0.08), lamp, 0, 0.39, 0.2);
  }
  // lights
  add(new THREE.BoxGeometry(0.14, 0.05, 0.02), lamp, 0.27, -0.02, 0.61); add(new THREE.BoxGeometry(0.14, 0.05, 0.02), lamp, -0.27, -0.02, 0.61);
  add(new THREE.BoxGeometry(0.16, 0.04, 0.02), tail, 0.27, 0.0, -0.61); add(new THREE.BoxGeometry(0.16, 0.04, 0.02), tail, -0.27, 0.0, -0.61);
  // team light bar on the roof so you can always tell teams apart
  const bar = new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team].clone().multiplyScalar(1.4) });
  add(new THREE.BoxGeometry(0.5, 0.025, 0.05), bar, 0, b === 3 ? 0.385 : b === 2 ? 0.2 : b === 1 ? 0.26 : 0.295, b === 3 ? 0.3 : 0.1);
  // topper
  const tp = look.topper | 0, ty = b === 3 ? 0.38 : b === 2 ? 0.28 : b === 1 ? 0.27 : 0.3;
  if (tp === 1) add(new THREE.ConeGeometry(0.1, 0.28, 12), new THREE.MeshStandardMaterial({ color: '#ff7a1a' }), 0, ty + 0.13, -0.08);
  if (tp === 2) {
    const crown = add(new THREE.CylinderGeometry(0.13, 0.11, 0.1, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#ffd23f', metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide }), 0, ty + 0.06, -0.08);
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), crown.material); sp.position.set(Math.cos(i) * 0.12, 0.08, Math.sin(i) * 0.12); crown.add(sp); }
  }
  if (tp === 3) add(new THREE.TorusGeometry(0.17, 0.025, 6, 22), new THREE.MeshBasicMaterial({ color: '#fff3a0' }), 0, ty + 0.28, -0.08).rotation.x = Math.PI / 2;
  if (tp === 4) { add(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), dark, -0.25, ty + 0.25, -0.45); add(new THREE.SphereGeometry(0.06, 10, 8), accent, -0.25, ty + 0.5, -0.45); }
  if (tp === 5) { const f = add(new THREE.BoxGeometry(0.03, 0.22, 0.4), accent, 0, ty + 0.1, -0.25); f.rotation.x = -0.3; }
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.13, 16); wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.135, 8); rimGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: '#101114', roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: WHEELS_COL[look.wheels | 0] || '#202329', metalness: 0.6, roughness: 0.35 });
  const wheels = [];
  for (const wp of WHEELS) {
    const wg = new THREE.Group();
    const spin = new THREE.Group(); wg.add(spin);
    spin.add(new THREE.Mesh(wheelGeo, tire));
    spin.add(new THREE.Mesh(rimGeo, rimMat));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.2), rimMat); spin.add(spoke);
    wg.position.set(wp[0] * 1.08, wp[1], wp[2]);
    g.add(wg); wheels.push({ g: wg, spin, base: wp });
  }
  // boost flame
  const flameMat = new THREE.MeshBasicMaterial({ color: TRAILS[look.trail | 0] || '#ffb347', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.13, 0.7, 10, 1, true); flameGeo.rotateX(-Math.PI / 2); flameGeo.translate(0, 0, -0.35);
  const flame = new THREE.Mesh(flameGeo, flameMat); flame.position.set(0, 0.02, -0.6); g.add(flame);
  const core = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.scale.set(0.45, 0.45, 0.6); flame.add(core);
  flame.visible = false;
  g.userData = { wheels, flame, roll: 0, trail: new THREE.Color(TRAILS[look.trail | 0] || '#ffb347'), paint };
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// name tag above a car
export function makeTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 34px Barlow, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(text, 128, 34);
  g.fillStyle = color; g.fillText(text, 128, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(2.4, 0.6, 1); sp.renderOrder = 10;
  return sp;
}

// ---------- boost pads ----------
export function buildPads(scene) {
  const list = [];
  const bigRing = new THREE.TorusGeometry(1.0, 0.12, 8, 28); bigRing.rotateX(Math.PI / 2);
  const smallDisc = new THREE.CylinderGeometry(0.55, 0.65, 0.06, 18);
  const orbGeo = new THREE.IcosahedronGeometry(0.45, 1);
  for (const p of PADS) {
    const g = new THREE.Group(); g.position.set(p.x, 0.02, p.z); scene.add(g);
    if (p.big) {
      const ringMat = new THREE.MeshBasicMaterial({ color: '#ffb02e' });
      const ring = new THREE.Mesh(bigRing, ringMat); ring.position.y = 0.06; g.add(ring);
      const orb = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      orb.position.y = 1.0; g.add(orb);
      list.push({ g, orb, ring, ringMat, big: true });
    } else {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffc24a' });
      const disc = new THREE.Mesh(smallDisc, mat); g.add(disc);
      list.push({ g, disc, mat, big: false });
    }
  }
  return list;
}
export function updatePads(list, state, t) {
  for (let i = 0; i < list.length; i++) {
    const v = list[i], on = state[i].t <= 0;
    if (v.big) {
      v.orb.visible = on; v.orb.rotation.y = t * 1.5; v.orb.position.y = 1.0 + Math.sin(t * 2 + i) * 0.15;
      v.ringMat.color.set(on ? '#ffb02e' : '#4a3a20');
    } else v.mat.color.set(on ? '#ffc24a' : '#3a3220');
  }
}

// ---------- particles ----------
export class Particles {
  constructor(scene, n = 2500) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.size = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = 1.0 - smoothstep(0.2, 0.5, length(d)); if (a <= 0.0) discard; gl_FragColor = vec4(vC * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.mat = mat;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, color, life, size, grav = 0) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grav[i] = grav;
  }
  burst(x, y, z, color, count, speed, life = 1.2, size = 0.5) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      const r = Math.sqrt(1 - u * u);
      this.emit(x, y, z, Math.cos(th) * r * s, u * s, Math.sin(th) * r * s, color, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), 4);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= 1 - 1.5 * dt; this.vel[k + 1] *= 1 - 1.5 * dt; this.vel[k + 2] *= 1 - 1.5 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.size[i] *= 1 - 0.6 * dt;
      if (f < 0.3) { this.col[k] *= 0.93; this.col[k + 1] *= 0.93; this.col[k + 2] *= 0.93; }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}

// ---------- the whole scene ----------
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070b16');
  scene.fog = new THREE.Fog('#070b16', 140, 380);
  scene.add(new THREE.HemisphereLight('#bcd4ff', '#20304a', 1.3));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(30, 60, 20); scene.add(sun);
  const arena = buildArena(scene);
  return { renderer, scene, arena };
}

export function syncCarMesh(mesh, car, dt) {
  mesh.visible = !car.demo;
  if (car.demo) return;
  mesh.position.copy(car.pos);
  mesh.quaternion.copy(car.q);
  const ud = mesh.userData;
  const fwdSpeed = car.vel.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(car.q));
  ud.roll += (fwdSpeed / WHEEL_R) * dt;
  for (let i = 0; i < 4; i++) {
    const w = ud.wheels[i];
    w.g.position.y = w.base[1] - (car.wheelT[i] - WHEEL_R);
    w.spin.rotation.x = ud.roll;
    if (i < 2) w.g.rotation.y = -car.in.steer * 0.42 * (car.sim ? 1 : 0.6);
  }
  ud.flame.visible = car.boosting;
  if (car.boosting) { const s = 0.85 + Math.random() * 0.35; ud.flame.scale.set(s, s, 0.8 + Math.random() * 0.6); }
}
