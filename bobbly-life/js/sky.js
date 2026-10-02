// Cartoon sky: a clean blue gradient that glows gold and pink at sunrise and sunset, a soft sun, big puffy
// cumulus clouds drifting overhead (grey and heavy in storms, with a dark cloud deck when it's overcast),
// stars at night, and an environment map made from the sky so shiny things reflect it.
import * as THREE from 'three';
import { G, clamp, lerp } from './state.js';
import { getLights } from './world.js';

const S = { sky: null, clouds: null, deck: null, stars: null, env: null, envT: 0, pmrem: null, envScene: null, envSky: null, lastSun: new THREE.Vector3() };
G.atmo = S;

function makeSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uDisc: { value: 1 }, uGain: { value: 1 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uTop, uHorizon, uGround, uSun, uSunCol; uniform float uDisc, uGain; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.12, h));
        float s = max(dot(d, uSun), 0.0);
        col += uSunCol * (pow(s, 6.0) * 0.22 + pow(s, 48.0) * 0.45);
        col = mix(col, uSunCol * 3.0 + vec3(0.5), smoothstep(0.9991, 0.9995, s) * uDisc);
        gl_FragColor = vec4(col * uGain, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), m);
  sky.renderOrder = -2; sky.frustumCulled = false;
  return sky;
}

// Puffy cartoon cumulus: clusters of soft round lumps with flat bottoms, white on top and blue-grey underneath.
// A few shapes are instanced around the sky and drift with the wind (they wrap around you as you travel).
const CLOUD_N = 34, RING = 1050;
function cloudShape(seed) {
  let s = seed * 9301 + 49297; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const parts = [], n = 9 + Math.floor(r() * 6), len = 46 + r() * 40;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5, rad = (13 + r() * 10) * (1 - Math.abs(t) * 0.9);
    const g = new THREE.IcosahedronGeometry(rad, 2);
    g.translate(t * len + (r() - 0.5) * 8, rad * 0.35 + r() * 6 + (1 - Math.abs(t) * 2) * 8, (r() - 0.5) * 18);
    parts.push(g);
  }
  // a few lumps piled on top
  for (let i = 0; i < 3; i++) { const rad = 10 + r() * 7, g = new THREE.IcosahedronGeometry(rad, 2); g.translate((r() - 0.5) * len * 0.5, 16 + r() * 8, (r() - 0.5) * 10); parts.push(g); }
  // flatten the underside
  for (const g of parts) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.15); g.computeVertexNormals(); }
  const geo = new THREE.BufferGeometry();
  const all = []; for (const g of parts) all.push(g.index ? g.toNonIndexed() : g);
  let count = 0; for (const g of all) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let o = 0; for (const g of all) { pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return geo;
}
function makeClouds() {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uTop: { value: new THREE.Color(1, 1, 1) }, uBot: { value: new THREE.Color(0.7, 0.76, 0.86) }, uHaze: { value: new THREE.Color() }, uCam: { value: new THREE.Vector3() }, uFar: { value: 1100 } },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun, uTop, uBot, uHaze, uCam; uniform float uFar; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        float up = smoothstep(-0.6, 0.8, n.y), lit = max(dot(n, uSun), 0.0);
        vec3 c = mix(uBot, uTop, up) * (0.86 + 0.22 * lit);
        // soft bright rim where the edge faces the camera side-on
        vec3 v = normalize(uCam - vW);
        c += uTop * pow(1.0 - abs(dot(n, v)), 3.0) * 0.18;
        float d = length(vW.xz - uCam.xz);
        c = mix(c, uHaze, smoothstep(uFar * 0.55, uFar, d));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const shapes = [0, 1, 2, 3].map(i => cloudShape(i + 1));
  const group = new THREE.Group(), list = [];
  shapes.forEach((g, k) => {
    const n = Math.ceil(CLOUD_N / shapes.length), im = new THREE.InstancedMesh(g, mat, n);
    im.frustumCulled = false; im.renderOrder = -1;
    group.add(im);
    for (let i = 0; i < n; i++) list.push({ im, i, x: (Math.random() * 2 - 1) * RING, z: (Math.random() * 2 - 1) * RING, y: 230 + Math.random() * 170, s: 0.7 + Math.random() * 0.9, a: Math.random() * 6.28 });
  });
  return { group, list, mat };
}
// A dark, even cloud deck for overcast and stormy weather (fractal noise drifting with the wind).
function makeDeck() {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 }, uCover: { value: 0 }, uCol: { value: new THREE.Color() }, uFlash: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFade: { value: 1100 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uCover, uFlash, uFade; uniform vec3 uCol, uCam; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++){ s += n(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        vec2 p = (vW.xz + vec2(uTime * 7.0, uTime * 3.0)) * 0.0018;
        float b = fbm(p);
        float d = smoothstep(1.0 - uCover, 1.25 - uCover, b);
        vec3 c = uCol * (0.8 + 0.35 * b) + vec3(0.85, 0.88, 1.0) * uFlash * d;
        float a = d * (1.0 - smoothstep(uFade * 0.6, uFade, length(vW.xz - uCam.xz)));
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(4000, 1, 4000); mesh.frustumCulled = false; mesh.renderOrder = -1;
  return mesh;
}
function makeStars() {
  const n = 2600, p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 0.95 + 0.05, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    p[i * 3] = r * Math.cos(a) * 850; p[i * 3 + 1] = u * 850; p[i * 3 + 2] = r * Math.sin(a) * 850; s[i] = Math.random();
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('b', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 }, uT: { value: 0 } },
    vertexShader: `attribute float b; uniform float uT; varying float vB; void main(){ vB = b * (0.75 + 0.25 * sin(uT * 3.0 + b * 50.0)); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 1.0 + b * 2.2; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uA; varying float vB; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), a * uA * vB); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = -1;
  return pts;
}

export function initSky() {
  const scene = G.scene;
  // retire the old painted dome and sprite clouds
  if (G.sky) { scene.remove(G.sky); G.sky = null; }
  for (const c of G.clouds || []) scene.remove(c);
  G.clouds = [];
  S.sky = makeSky(); S.clouds = makeClouds(); S.deck = makeDeck(); S.stars = makeStars();
  scene.add(S.sky, S.clouds.group, S.deck, S.stars);
  // environment map rendered from a copy of the sky
  S.envScene = new THREE.Scene();
  S.envSky = makeSky(); S.envScene.add(S.envSky);
  S.pmrem = new THREE.PMREMGenerator(G.renderer);
}

// colours (linear) for noon, golden hour and night
const TOP = new THREE.Color(0.06, 0.28, 0.82), HOR = new THREE.Color(0.48, 0.72, 0.96);
const TOP_DUSK = new THREE.Color(0.2, 0.22, 0.5), HOR_DUSK = new THREE.Color(1.0, 0.5, 0.28);
const TOP_NIGHT = new THREE.Color(0.004, 0.008, 0.03), HOR_NIGHT = new THREE.Color(0.02, 0.035, 0.08);
const GREY = new THREE.Color(0.34, 0.37, 0.42), GREY_TOP = new THREE.Color(0.22, 0.25, 0.3);
const sunDir = new THREE.Vector3(), tmp = new THREE.Color(), top = new THREE.Color(), hor = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export function updateSky(dt) {
  const cam = G.camera.position, L = getLights();
  const a = (G.dayTime - 0.25) * Math.PI * 2;
  sunDir.set(Math.cos(a) * 0.8, Math.sin(a), 0.45).normalize();
  const W = G.weather || { overcast: 0, storm: 0, rain: 0 };
  const oc = W.overcast || 0, space = G.spaceFade || 0;
  const elev = sunDir.y, day = clamp(elev * 3 + 0.3, 0, 1), dusk = clamp(1 - Math.abs(elev - 0.05) * 5, 0, 1);
  // sky colours: blue by day, gold and pink low on the horizon at sunrise/sunset, deep navy at night, grey when overcast
  top.copy(TOP_NIGHT).lerp(TOP, day).lerp(TOP_DUSK, dusk * 0.45).lerp(GREY_TOP, oc * 0.85 * day);
  hor.copy(HOR_NIGHT).lerp(HOR, day).lerp(HOR_DUSK, dusk * 0.7).lerp(GREY, oc * 0.85 * day);
  const u = S.sky.material.uniforms;
  u.uTop.value.copy(top); u.uHorizon.value.copy(hor); u.uGround.value.copy(hor).multiplyScalar(0.8);
  u.uSun.value.copy(sunDir);
  u.uSunCol.value.setRGB(1, 0.85 - dusk * 0.3, 0.62 - dusk * 0.4).multiplyScalar(clamp(elev * 4 + 0.4, 0, 1) * (1 - oc * 0.85));
  u.uDisc.value = 1 - oc;
  u.uGain.value = 1 - space;
  S.sky.position.copy(cam);
  const hide = !!G.underwater || space > 0.4;
  S.sky.visible = !hide;
  // the land fog fades into the horizon colour so distant hills melt into the sky
  if (G.landFog && G.scene.fog === G.landFog && !hide) G.landFog.color.copy(hor).lerp(top, 0.12);
  // puffy clouds: drift with the wind and wrap around the camera
  const C = S.clouds, cu = C.mat.uniforms;
  const wind = 3 + (W.storm || 0) * 12;
  cu.uSun.value.copy(sunDir);
  cu.uTop.value.setRGB(1, 0.97 - dusk * 0.12, 0.94 - dusk * 0.25).multiplyScalar(lerp(0.08, 1.05, day)).lerp(tmp.setRGB(0.5, 0.52, 0.56), oc * 0.6);
  cu.uBot.value.copy(hor).lerp(tmp.setRGB(0.62, 0.67, 0.78), 0.55).multiplyScalar(lerp(0.12, 0.95, day) * (1 - oc * 0.35));
  cu.uHaze.value.copy(hor);
  cu.uCam.value.copy(cam);
  const used = new Set();
  for (const c of C.list) {
    c.x += wind * dt;
    let dx = c.x - cam.x, dz = c.z - cam.z;
    if (dx > RING) c.x -= RING * 2; else if (dx < -RING) c.x += RING * 2;
    if (dz > RING) c.z -= RING * 2; else if (dz < -RING) c.z += RING * 2;
    const sc = c.s * (1 + oc * 0.5);
    _q.setFromAxisAngle(UP, c.a);
    _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(sc, sc * (1 - oc * 0.3), sc));
    c.im.setMatrixAt(c.i, _m); used.add(c.im);
  }
  for (const im of used) im.instanceMatrix.needsUpdate = true;
  C.group.visible = !hide && cam.y < 600;
  // overcast deck
  const du = S.deck.material.uniforms;
  du.uTime.value = G.time; du.uCover.value = clamp(oc * 1.15 - 0.05, 0, 1.05);
  du.uCol.value.copy(GREY).multiplyScalar(lerp(0.12, 1, day) * (1 - (W.storm || 0) * 0.45));
  du.uFlash.value = G.flash || 0; du.uCam.value.copy(cam);
  du.uFade.value = (G.fogBaseFar || 1100) > 1000 ? 1600 : 1100;
  S.deck.position.set(cam.x, 420, cam.z);
  S.deck.visible = !hide && oc > 0.05;
  // stars come out at night (and hide behind cloud)
  S.stars.position.copy(cam);
  S.stars.material.uniforms.uA.value = clamp((0.15 - elev) * 4, 0, 1) * (1 - oc) * (hide ? 0 : 1);
  S.stars.material.uniforms.uT.value = G.time;
  S.stars.visible = S.stars.material.uniforms.uA.value > 0.01;
  // keep reflections in step with the sky (every few seconds, or when the sky changes a lot)
  S.envT -= dt;
  if (S.envT <= 0 || S.lastSun.distanceTo(sunDir) > 0.08) {
    S.envT = G.save.gfx === 'low' ? 8 : 4; S.lastSun.copy(sunDir);
    const eu = S.envSky.material.uniforms;
    for (const k of ['uTop', 'uHorizon', 'uGround', 'uSun', 'uSunCol']) eu[k].value.copy(u[k].value);
    eu.uDisc.value = 0;
    eu.uGain.value = 0.85 * (0.25 + 0.75 * day);
    const rt = S.pmrem.fromScene(S.envScene, 0.04, 1, 2000);
    if (S.env) S.env.dispose();
    S.env = rt;
    G.scene.environment = rt.texture;
  }
}
