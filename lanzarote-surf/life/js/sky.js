// Realistic sky: real atmospheric scattering (the Preetham daylight model, as used by three.js's Sky) for the
// blue sky, hazy horizon and orange sunsets, a sun-lit layer of drifting clouds, stars at night, an overcast
// deck for storms, and an environment map made from the sky so shiny things reflect it.
import * as THREE from 'three';
import { G, clamp, lerp } from './state.js';
import { getLights } from './world.js';

const S = { sky: null, clouds: null, deck: null, stars: null, env: null, envT: 0, pmrem: null, envScene: null, envSky: null, lastSun: new THREE.Vector3() };
G.atmo = S;

const SKY = { turbidity: 2.0, rayleigh: 1.5, mie: 0.0026, g: 0.76, gain: 0.6 };
function makeSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uDisc: { value: 1 }, uGain: { value: SKY.gain }, uTurb: { value: SKY.turbidity }, uRay: { value: SKY.rayleigh },
      uMie: { value: SKY.mie }, uG: { value: SKY.g }, uNight: { value: 0 }, uOver: { value: 0 }, uGreyT: { value: new THREE.Color() }, uGreyH: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
    },
    vertexShader: `uniform vec3 uSun; uniform float uTurb, uRay, uMie;
      varying vec3 vDir; varying float vSunfade, vSunE; varying vec3 vBetaR, vBetaM;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww;
        vSunE = 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(uSun.y, -1.0, 1.0))) / 1.5)));
        vSunfade = 1.0 - clamp(1.0 - exp(uSun.y), 0.0, 1.0);
        vBetaR = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5) * (uRay - (1.0 - vSunfade));
        vBetaM = 0.434 * (0.2 * uTurb) * 10E-18 * vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14) * uMie;
      }`,
    fragmentShader: `uniform vec3 uSun, uGreyT, uGreyH, uGround; uniform float uDisc, uGain, uG, uNight, uOver;
      varying vec3 vDir; varying float vSunfade, vSunE; varying vec3 vBetaR, vBetaM;
      void main(){
        vec3 d = normalize(vDir);
        float za = acos(max(0.0, d.y));
        float inv = 1.0 / (cos(za) + 0.15 * pow(93.885 - za * 57.29577951, -1.253));
        vec3 Fex = exp(-(vBetaR * 8.4E3 * inv + vBetaM * 1.25E3 * inv));
        float ct = dot(d, uSun);
        float rP = 0.05968310365946075 * (1.0 + pow(ct * 0.5 + 0.5, 2.0));
        float g2 = uG * uG, mP = 0.07957747154594767 * (1.0 - g2) / pow(1.0 - 2.0 * uG * ct + g2, 1.5);
        vec3 sc = (vBetaR * rP + vBetaM * mP) / (vBetaR + vBetaM);
        vec3 Lin = pow(vSunE * sc * (1.0 - Fex), vec3(1.5));
        Lin *= mix(vec3(1.0), pow(vSunE * sc * Fex, vec3(0.5)), clamp(pow(1.0 - uSun.y, 5.0), 0.0, 1.0));
        vec3 col = pow((Lin + vec3(0.1) * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075), vec3(0.85)) * uGain;
        col *= min(1.0, 1.15 / max(col.r, max(col.g, max(col.b, 0.001))));   // capped (keeping its colour) so the sky never blooms
        col += min(vSunE * 19000.0 * Fex * 0.04 * uGain, vec3(40.0)) * smoothstep(0.99990, 0.99994, ct) * uDisc;          // the sun itself
        // the scattering model goes black after sunset: a deep blue night sky instead
        float h = clamp(d.y, 0.0, 1.0);
        col += mix(vec3(0.02, 0.035, 0.08), vec3(0.004, 0.008, 0.03), pow(h, 0.5)) * uNight;
        col = mix(col, mix(uGreyH, uGreyT, h), uOver);
        col = mix(col, uGround, smoothstep(0.0, -0.15, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), m);
  sky.renderOrder = -2; sky.frustumCulled = false;
  return sky;
}
// The same sky maths on the CPU, so the fog melts into exactly the colour of the horizon.
const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5], MC = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
function skyRadiance(d, sun, out) {
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(clamp(sun.y, -1, 1))) / 1.5)));
  const fade = 1 - clamp(1 - Math.exp(sun.y), 0, 1);
  const za = Math.acos(Math.max(0, d.y)), inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 57.29577951, -1.253));
  const ct = d.x * sun.x + d.y * sun.y + d.z * sun.z, rP = 0.05968310365946075 * (1 + Math.pow(ct * 0.5 + 0.5, 2));
  const g2 = SKY.g * SKY.g, mP = 0.07957747154594767 * (1 - g2) / Math.pow(1 - 2 * SKY.g * ct + g2, 1.5);
  const k = clamp(Math.pow(1 - sun.y, 5), 0, 1), add = [0, 0.0003, 0.00075], o = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = TR[i] * (SKY.rayleigh - (1 - fade)), bM = 0.434 * 0.2 * SKY.turbidity * 10e-18 * MC[i] * SKY.mie;
    const fex = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv)), sc = (bR * rP + bM * mP) / (bR + bM);
    let lin = Math.pow(sunE * sc * (1 - fex), 1.5); lin *= lerp(1, Math.pow(sunE * sc * fex, 0.5), k);
    o[i] = Math.pow(Math.max(0, (lin + 0.1 * fex) * 0.04 + add[i]), 0.85) * SKY.gain;
  }
  return out.setRGB(o[0], o[1], o[2]);
}
// A tiling noise texture (smooth blobs at two sizes), sampled at several scales by the cloud shader.
function noiseTexture() {
  const n = 256, data = new Uint8Array(n * n * 4);
  const lattice = (g, seed) => { let s = seed; const v = new Float32Array(g * g); for (let i = 0; i < g * g; i++) { s = (s * 16807) % 2147483647; v[i] = s / 2147483647; } return v; };
  const L1 = lattice(8, 11), L2 = lattice(16, 29), L3 = lattice(32, 47);
  const sample = (L, g, x, y) => { const fx = x * g / n, fy = y * g / n, i = Math.floor(fx), j = Math.floor(fy); let u = fx - i, v = fy - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const a = L[(j % g) * g + i % g], b = L[(j % g) * g + (i + 1) % g], c = L[((j + 1) % g) * g + i % g], dd = L[((j + 1) % g) * g + (i + 1) % g];
    return (a + (b - a) * u) + ((c + (dd - c) * u) - (a + (b - a) * u)) * v; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = sample(L1, 8, x, y) * 0.55 + sample(L2, 16, x, y) * 0.3 + sample(L3, 32, x, y) * 0.15, k = (y * n + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = v * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// A layer of fair-weather cumulus clouds ~500 m up: several sizes of noise make the shapes, a second look-up
// towards the sun makes the sides away from it darker (self-shadowing), and they glow at the edges near the sun.
function makeClouds() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uCover: { value: 0.45 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(1, 1, 1) },
      uShade: { value: new THREE.Color(0.6, 0.65, 0.72) }, uHaze: { value: new THREE.Color() }, uCam: { value: new THREE.Vector3() }, uFar: { value: 1400 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uNoise; uniform float uTime, uCover, uFar; uniform vec3 uSun, uLit, uShade, uHaze, uCam; varying vec3 vW;
      float cl(vec2 p){ return texture2D(uNoise, p).r * 0.5 + texture2D(uNoise, p * 2.31 + 0.37).r * 0.28 + texture2D(uNoise, p * 5.17 + 0.71).r * 0.15 + texture2D(uNoise, p * 11.3 + 0.13).r * 0.07; }
      void main(){
        vec2 p = (vW.xz + vec2(uTime * 6.0, uTime * 2.2)) * 0.00055;
        float n = cl(p);
        float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.2, n);
        if (d < 0.004) discard;
        float n2 = cl(p + normalize(uSun.xz + vec2(0.0001)) * 0.006);
        float lit = clamp(0.62 - (n2 - n) * 5.5 - (d - 0.5) * 0.25, 0.0, 1.0);
        vec3 c = mix(uShade, uLit, lit);
        vec3 v = normalize(vW - uCam);
        c += uLit * pow(max(dot(v, uSun), 0.0), 12.0) * (1.0 - d) * 0.45;
        float dist = length(vW.xz - uCam.xz);
        c = mix(c, uHaze, smoothstep(uFar * 0.45, uFar * 0.95, dist) * 0.7);
        gl_FragColor = vec4(c, d * 0.92 * (1.0 - smoothstep(uFar * 0.4, uFar * 0.85, dist)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = -1;
  return { mesh, mat };
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
  scene.add(S.sky, S.clouds.mesh, S.deck, S.stars);
  // environment map rendered from a copy of the sky
  S.envScene = new THREE.Scene();
  S.envSky = makeSky(); S.envScene.add(S.envSky);
  S.pmrem = new THREE.PMREMGenerator(G.renderer);
}

const GREY = new THREE.Color(0.34, 0.37, 0.42), GREY_TOP = new THREE.Color(0.22, 0.25, 0.3);
const sunDir = new THREE.Vector3(), tmp = new THREE.Color(), hor = new THREE.Color(), _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
export function updateSky(dt) {
  const cam = G.camera.position, L = getLights();
  const a = (G.dayTime - 0.25) * Math.PI * 2;
  sunDir.set(Math.cos(a) * 0.8, Math.sin(a), 0.45).normalize();
  const W = G.weather || { overcast: 0, storm: 0, rain: 0 };
  const oc = W.overcast || 0, space = G.spaceFade || 0;
  const elev = sunDir.y, day = clamp(elev * 3 + 0.3, 0, 1), dusk = clamp(1 - Math.abs(elev - 0.05) * 5, 0, 1);
  // the real sky: scattering by day, deep blue at night, grey when overcast
  const u = S.sky.material.uniforms;
  u.uSun.value.copy(sunDir);
  u.uDisc.value = 1 - oc;
  u.uGain.value = SKY.gain * (1 - space);
  u.uNight.value = (1 - day) * (1 - space);
  u.uOver.value = oc * 0.85 * day;
  u.uGreyT.value.copy(GREY_TOP).multiplyScalar(day); u.uGreyH.value.copy(GREY).multiplyScalar(day);
  // horizon colour, averaged round the compass (for the fog and the ground below the horizon)
  hor.setRGB(0, 0, 0);
  for (let k = 0; k < 4; k++) { const az = Math.atan2(sunDir.z, sunDir.x) + k * Math.PI / 2; hor.add(skyRadiance(_d.set(Math.cos(az), 0.05, Math.sin(az)).normalize(), sunDir, tmp)); }
  hor.multiplyScalar(0.25 * (1 - space)).add(tmp.setRGB(0.02, 0.035, 0.08).multiplyScalar(u.uNight.value)).lerp(tmp.copy(GREY).multiplyScalar(day), u.uOver.value);
  u.uGround.value.copy(hor).multiplyScalar(0.55);
  S.sky.position.copy(cam);
  const hide = !!G.underwater || space > 0.4;
  S.sky.visible = !hide;
  // the land fog fades into the horizon colour so distant hills melt into the sky
  if (G.landFog && G.scene.fog === G.landFog && !hide) G.landFog.color.copy(hor).multiplyScalar(0.84);
  // cloud layer: lit by the sun (gold at sunset), shaded blue-grey underneath, thicker when the weather turns
  const C = S.clouds, cu = C.mat.uniforms;
  cu.uTime.value = G.time * (1 + (W.storm || 0) * 3);
  cu.uCover.value = clamp(0.42 + oc * 0.5, 0, 0.98);
  cu.uSun.value.copy(sunDir);
  cu.uLit.value.setRGB(1.05, 1.0 - dusk * 0.18, 0.95 - dusk * 0.4).multiplyScalar(lerp(0.05, 1.0, day) * (1 - oc * 0.45));
  cu.uShade.value.copy(hor).lerp(tmp.setRGB(0.55, 0.6, 0.7), 0.5).multiplyScalar(lerp(0.1, 0.85, day) * (1 - oc * 0.3));
  cu.uHaze.value.copy(hor);
  cu.uCam.value.copy(cam);
  cu.uFar.value = G.camera.far * 0.95;
  C.mesh.position.set(cam.x, 520, cam.z); C.mesh.scale.set(G.camera.far * 2, 1, G.camera.far * 2);
  C.mesh.visible = !hide && cam.y < 2000;
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
    for (const k of ['uSun', 'uGreyT', 'uGreyH', 'uGround']) eu[k].value.copy(u[k].value);
    eu.uNight.value = u.uNight.value; eu.uOver.value = u.uOver.value;
    eu.uDisc.value = 0;
    eu.uGain.value = SKY.gain * 0.7 * (0.25 + 0.75 * day);
    const rt = S.pmrem.fromScene(S.envScene, 0.04, 1, 2000);
    if (S.env) S.env.dispose();
    S.env = rt;
    G.scene.environment = rt.texture;
  }
}
