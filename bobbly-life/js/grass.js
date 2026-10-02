// 3D grass: hundreds of thousands of individual blades around the camera, coloured to match the ground underneath,
// swaying in the wind (harder in storms) and bending away from your feet. Only where real grass would grow:
// not on roads, pavements, buildings, beaches, steep rock or snow. Drawn entirely on the GPU.
import * as THREE from 'three';
import { G, WATER_Y, LAND, clamp } from './state.js';
import { heightAt, slopeAt, biome, inZone, riverDist, HIGHWAYS, WORLD } from './terrain.js';
import { colliders, getLights } from './world.js';

const RES = 4;                         // metres per mask pixel
const PATCH = 8, BLADES = 400;         // blades per 8 m patch
let mesh = null, mat = null, cells = [], lastCell = '', R = 7;

function segDist(x, z, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t));
}
function buildMaps() {
  const S = Math.round(WORLD * 2 / RES);
  const hData = new Float32Array(S * S), cData = new Uint8Array(S * S * 4);
  const grass = new THREE.Color('#7fae4f'), forest = new THREE.Color('#5a8f42'), desert = new THREE.Color('#b8aa6a'), c = new THREE.Color();
  const blocked = new Uint8Array(S * S);
  // buildings, walls and other solid things
  for (const cl of colliders) {
    if (cl.maxY < 0.4 || cl.tag === 'tree') continue;
    const i0 = Math.floor((cl.minX + WORLD) / RES) - 1, i1 = Math.ceil((cl.maxX + WORLD) / RES), j0 = Math.floor((cl.minZ + WORLD) / RES) - 1, j1 = Math.ceil((cl.maxZ + WORLD) / RES);
    if ((i1 - i0) * (j1 - j0) > 40000) continue;
    for (let j = Math.max(0, j0); j < Math.min(S, j1); j++) for (let i = Math.max(0, i0); i < Math.min(S, i1); i++) blocked[j * S + i] = 1;
  }
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -WORLD + (i + 0.5) * RES, z = -WORLD + (j + 0.5) * RES, k = j * S + i;
    const h = heightAt(x, z);
    hData[k] = h;
    let d = 1;
    if (h < WATER_Y + 1.6 || h > 92 || blocked[k]) d = 0;
    else if (Math.max(Math.abs(x), Math.abs(z)) < LAND + 6) d = 0;
    else if (inZone(x, z, 3)) d = 0;
    else if (riverDist(x, z) < 3) d = 0;
    else if (G.keepOut && G.keepOut(x, z)) d = 0;
    else { for (const hw of HIGHWAYS) if (segDist(x, z, hw) < 9) { d = 0; break; } }
    if (d) { const sl = slopeAt(x, z); d = clamp((0.62 - sl) * 3, 0, 1); }
    const b = biome(x, z);
    c.copy(grass).lerp(forest, b.west).lerp(desert, b.south);
    if (b.south > 0.5) d *= 0.55;                     // dry, thinner grass in the golden southern hills
    cData[k * 4] = c.r * 255; cData[k * 4 + 1] = c.g * 255; cData[k * 4 + 2] = c.b * 255; cData[k * 4 + 3] = d * 255;
  }
  const hTex = new THREE.DataTexture(hData, S, S, THREE.RedFormat, THREE.FloatType);
  hTex.magFilter = hTex.minFilter = THREE.NearestFilter; hTex.needsUpdate = true;
  const cTex = new THREE.DataTexture(cData, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  cTex.magFilter = cTex.minFilter = THREE.LinearFilter; cTex.needsUpdate = true;
  return { hTex, cTex, S };
}

function bladePatch() {
  // each blade: a curved, tapering strip of 5 triangles
  const pos = [], idx = [], rnd = [];
  let s = 1234; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let b = 0; b < BLADES; b++) {
    const x = r() * PATCH, z = r() * PATCH, a = r() * Math.PI, h = 0.35 + r() * 0.45, w = 0.04 + r() * 0.035, lean = (r() - 0.5) * 0.5, seed = r();
    const base = pos.length / 3;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, ww = w * (1 - t * 0.85);
      const off = lean * t * t;
      for (const sd of [-1, 1]) {
        pos.push(x + Math.cos(a) * ww * sd + Math.sin(a) * off, t * h, z + Math.sin(a) * ww * sd + Math.cos(a) * off);
        rnd.push(t, seed);
      }
    }
    pos.push(x + Math.sin(a) * lean * 1.2, h * 1.08, z + Math.cos(a) * lean * 1.2); rnd.push(1.05, seed);
    for (let k = 0; k < 3; k++) { const q = base + k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    idx.push(base + 6, base + 7, base + 8);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('bt', new THREE.Float32BufferAttribute(rnd, 2));
  g.setIndex(idx);
  return g;
}

export function initGrass() {
  if (G.save.gfx === 'low') return;
  R = G.save.gfx === 'ultra' ? 8 : 6;
  const maps = buildMaps();
  mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uH: { value: null }, uC: { value: null }, uS: { value: maps.S }, uW: { value: WORLD }, uRes: { value: RES },
      uTime: { value: 0 }, uWind: { value: 1 }, uCam: { value: new THREE.Vector3() }, uFeet: { value: new THREE.Vector3(0, -999, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.55, 0.6) }, uR: { value: R * PATCH },
    }]),
    vertexShader: `uniform sampler2D uH, uC; uniform float uS, uW, uRes, uTime, uWind, uR; uniform vec3 uCam, uFeet;
      attribute vec2 bt; varying vec3 vCol; varying float vT; varying vec3 vN;
      #include <fog_pars_vertex>
      float hAt(vec2 p){ vec2 f = (p + uW) / uRes - 0.5; vec2 i = floor(f); vec2 t = f - i;
        float a = texture2D(uH, (i + 0.5) / uS).r, b = texture2D(uH, (i + vec2(1.5, 0.5)) / uS).r, c = texture2D(uH, (i + vec2(0.5, 1.5)) / uS).r, d = texture2D(uH, (i + 1.5) / uS).r;
        return mix(mix(a, b, t.x), mix(c, d, t.x), t.y); }
      void main(){
        vec3 p = position;
        vec2 base = (instanceMatrix * vec4(p.x, 0.0, p.z, 1.0)).xz;
        vec4 cm = texture2D(uC, (base + uW) / (2.0 * uW));
        float dist = length(base - uCam.xz);
        float fade = 1.0 - smoothstep(uR * 0.55, uR * 0.95, dist);
        float dens = cm.a;
        // thin out by density: each blade has its own threshold
        float keep = step(bt.y, dens * 1.05) * fade;
        float h = p.y * keep * (0.75 + 0.5 * dens);
        float t = bt.x;
        // wind: big slow gusts plus fast flutter
        float gust = sin(uTime * 1.3 + base.x * 0.07 + base.y * 0.05) * 0.5 + sin(uTime * 2.7 + base.x * 0.21) * 0.25;
        vec2 bend = vec2(0.6, 0.3) * gust * uWind * t * t * 0.35;
        bend += vec2(sin(uTime * 7.0 + bt.y * 40.0), cos(uTime * 6.0 + bt.y * 30.0)) * 0.03 * uWind * t;
        // squash away from feet
        vec2 away = base - uFeet.xz; float fd = length(away);
        if (fd < 1.2 && abs(uFeet.y - hAt(base)) < 1.5) { bend += normalize(away + 0.001) * (1.2 - fd) * 0.7 * t; h *= 0.6 + fd * 0.33; }
        vec3 w = vec3(base.x + bend.x, hAt(base) + h, base.y + bend.y);
        vec3 grassCol = cm.rgb * vec3(0.92, 1.0, 0.85);
        vCol = mix(grassCol * 0.42, grassCol * (0.92 + bt.y * 0.16), clamp(t, 0.0, 1.0));
        vT = t; vN = normalize(vec3(-bend.x, 1.0, -bend.y));
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        if (keep < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uSunDir, uSunCol, uAmb; varying vec3 vCol; varying float vT; varying vec3 vN;
      #include <fog_pars_fragment>
      void main(){
        float diff = max(dot(vN, uSunDir), 0.0) * 0.6 + 0.4;
        vec3 c = vCol * (uAmb + uSunCol * diff);
        // translucency: sunlight glowing through the tips
        c += vCol * uSunCol * 0.1 * vT * max(uSunDir.y, 0.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uH.value = maps.hTex; mat.uniforms.uC.value = maps.cTex;
  const n = (R * 2 + 1) ** 2;
  mesh = new THREE.InstancedMesh(bladePatch(), mat, n);
  mesh.frustumCulled = false;
  for (let i = 0; i < n; i++) cells.push([0, 0]);
  G.scene.add(mesh);
}

const _m = new THREE.Matrix4();
export function updateGrass() {
  if (!mesh) return;
  const cam = G.camera.position, L = getLights();
  const u = mat.uniforms;
  u.uTime.value = G.time;
  u.uCam.value.copy(cam);
  const P = G.player;
  u.uFeet.value.set(P.root.x, P.root.y, P.root.z);
  const W = G.weather || {};
  u.uWind.value = 1 + (W.storm || 0) * 2.5 + (W.rain || 0) * 0.8;
  u.uSunDir.value.copy(L.sun.position).sub(L.sun.target.position).normalize();
  u.uSunCol.value.copy(L.sun.color).multiplyScalar(L.sun.intensity * 0.55);
  u.uAmb.value.copy(L.hemi.color).multiplyScalar(L.hemi.intensity * 0.75);
  mesh.visible = cam.y < 160 && !G.underwater;
  // move the ring of grass patches with the camera (only when we cross into a new patch)
  const ci = Math.floor(cam.x / PATCH), cj = Math.floor(cam.z / PATCH), key = ci + ',' + cj;
  if (key === lastCell) return;
  lastCell = key;
  let k = 0;
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
    _m.makeTranslation((ci + a) * PATCH, 0, (cj + b) * PATCH);
    mesh.setMatrixAt(k++, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}
