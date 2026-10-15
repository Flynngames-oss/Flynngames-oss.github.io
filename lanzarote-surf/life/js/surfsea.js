// The sea round the island, from Wobble Surf: the same wave model and water shader, so from the cliffs above
// Famara, San Juan or El Quemao you see real sets rolling in, peeling and throwing, and everywhere else the
// Atlantic swell, ripples, sun glitter, turquoise shallows and foam on the shore.
import * as THREE from 'three';
import { WaveSystem, Ocean } from '../../js/ocean.js';
import { G, clamp } from './state.js';
import { GEO, ll2w, findCoast, dataHeight } from './terrain.js';
import { getLights } from './world.js';

// the surf spots (same numbers as the surf game)
const SPOTS = [
  { id: 'famara', lat: 29.1215, lon: -13.552, bearing: 328, Hmin: 2.1, Hmax: 2.9, P: 6.5, st: 0.62, C: 3.2, uBreak: -150, uEnd: -18, peakS: 0, peel: 0, len: 240, setPeriod: 58, chop: 1.0 },
  { id: 'sanjuan', lat: 29.1197, lon: -13.5745, bearing: 352, Hmin: 2.5, Hmax: 3.4, P: 8.5, st: 0.8, C: 3.3, uBreak: -135, uEnd: -12, peakS: 0, peel: 1, len: 270, setPeriod: 55, chop: 0.85 },
  { id: 'quemao', lat: 29.1085, lon: -13.666, bearing: 336, Hmin: 3.6, Hmax: 4.8, P: 10.5, st: 1.0, C: 3.4, uBreak: -115, uEnd: -8, peakS: 0, peel: -1, len: 210, setPeriod: 52, chop: 0.7 },
];
// a gentle sea for the rest of the island (no breaking waves, just swell)
const CALM = { id: 'calm', Hmin: 0, Hmax: 0, P: 0, st: 0, C: 3, uBreak: 1e7, uEnd: 1e7, peakS: 0, peel: 1, len: 0, setPeriod: 1e9, chop: 0.7 };

let sea = null, cur = null, depthTex = null, depthXf = null, skyU = null;

function depthTexture() {
  // the island's height (and the sea bed) every 73 m, so the water knows how deep it is
  const n = 768, data = new Uint16Array(n * n), st = GEO.S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = THREE.DataUtils.toHalfFloat(dataHeight(GEO.XMIN + (i + 0.5) * st, GEO.ZMIN + (j + 0.5) * st));
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// wave-frame directions and the break line of each spot, in world coordinates
function prepare(sp) {
  if (sp.a) return;
  if (sp === CALM) { sp.d = { x: 0.34, z: -0.94 }; sp.a = { x: 0.94, z: 0.34 }; return; }
  const b = sp.bearing * Math.PI / 180, n = { x: Math.sin(b), z: -Math.cos(b) };
  const p = ll2w(sp.lat, sp.lon), o = findCoast(p.x, p.z, n.x, n.z);
  sp.d = { x: -n.x, z: -n.z };
  sp.a = { x: -sp.d.z, z: sp.d.x };
  sp.origin = o;
  // the wave model measures along (a) and toward (d) the shore from the spot's origin: shift it to world space
  const ou = o.x * sp.d.x + o.z * sp.d.z, os = o.x * sp.a.x + o.z * sp.a.z;
  sp.uBreak += ou; sp.uEnd += ou; sp.peakS += os;
}

function build(sp) {
  prepare(sp);
  if (sea) { for (const m of [sea.ocean.near, sea.ocean.far, ...sea.ocean.lips.map((l) => l.mesh)]) { G.scene.remove(m); m.material.dispose(); if (m !== sea.ocean.far) { /* shared geometry */ } } }
  const waves = new WaveSystem(sp);
  const q = G.save.gfx;
  const ocean = new Ocean(G.scene, waves, { depthTex, depthXf, sky: { u: skyU }, gridA: q === 'low' ? 110 : q === 'ultra' ? 230 : 170, gridD: q === 'low' ? 200 : q === 'ultra' ? 420 : 300 });
  // seen from under the surface too (diving)
  ocean.near.material.side = THREE.DoubleSide;
  ocean.far.material.side = THREE.DoubleSide;
  sea = { waves, ocean, sp };
  cur = sp;
  G.water = ocean.near;
  G.surfSea = sea;
}

export function initSea() {
  depthTex = depthTexture();
  depthXf = new THREE.Vector4(GEO.XMIN, GEO.ZMIN, 1 / GEO.S, 1 / GEO.S);
  const su = G.sky.material.uniforms;
  // share Bobbly's sky colours (they follow the time of day) with the water shader
  skyU = { uSunDir: su.sunDir, uSunCol: { value: new THREE.Color() }, uSkyTop: su.top, uSkyHor: su.horizon, uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0.0001 } };
  build(nearestSpot(G.camera.position));
}

function nearestSpot(p) {
  let best = CALM, bd = 9000;
  for (const sp of SPOTS) { prepare(sp); const d = Math.hypot(p.x - sp.origin.x, p.z - sp.origin.z); if (d < bd) { bd = d; best = sp; } }
  return best;
}

let checkT = 0;
const _sd = new THREE.Vector3();
export function updateSea(dt) {
  if (!sea) return;
  const cam = G.camera.position;
  checkT -= dt;
  if (checkT <= 0) { checkT = 2; const sp = nearestSpot(cam); if (sp !== cur) build(sp); }
  sea.waves.update(Math.min(dt, 0.1));
  const L = getLights();
  _sd.copy(skyU.uSunDir.value).normalize(); skyU.uSunDir.value.copy(_sd);
  skyU.uSunCol.value.copy(L.sun.color).multiplyScalar(clamp(L.sun.intensity / 2.2, 0.05, 1.3));
  const fog = G.scene.fog;
  if (fog && fog.isFog) { skyU.uFogCol.value.copy(fog.color); skyU.uFogDen.value = 1.75 / Math.max(10, fog.far); }
  // night: the water goes dark (the sky colours already do)
  const day = clamp(_sd.y * 3 + 0.3, 0, 1);
  sea.ocean.u.uDeep.value.setRGB(0.0, 0.045, 0.14).multiplyScalar(0.25 + 0.75 * day);
  sea.ocean.u.uShallow.value.setRGB(0.02, 0.3, 0.42).multiplyScalar(0.2 + 0.8 * day);
  sea.ocean.u.uSSS.value.setRGB(0.02, 0.52, 0.56).multiplyScalar(0.15 + 0.85 * day);
  sea.ocean.update(sea.waves.t, cam);
  sea.ocean.far.position.x = cam.x; sea.ocean.far.position.z = cam.z;
  sea.ocean.far.position.y = -0.35;
  const hide = (G.spaceFade || 0) > 0.35;
  sea.ocean.near.visible = sea.ocean.far.visible = !hide;
}
// water height (with the swell) for floating things
export const seaHeight = (x, z) => (sea ? sea.waves.height(x, z) : 0);
