// Realistic sky: physically based atmosphere (Rayleigh + Mie scattering), a moving layer of volumetric-looking
// clouds that thicken and darken with the weather, stars at night, and an environment map made from the sky so
// shiny things (cars, glass, wet roads, water) reflect the real sky colours.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { G, clamp, lerp } from './state.js';
import { getLights } from './world.js';

const S = { sky: null, clouds: null, stars: null, env: null, envT: 0, pmrem: null, envScene: null, envSky: null, lastSun: new THREE.Vector3() };
G.atmo = S;

function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(1000);
  sky.material.depthWrite = false;
  sky.material.uniforms.uGain = { value: 1 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('void main() {', 'uniform float uGain;\nvoid main() {')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uGain, 1.0 );');
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  return sky;
}

// Cloud layer: fractal noise in world space, drifting with the wind. Thin wisps on fair days, a solid dark deck in storms.
function makeClouds() {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: {
      uTime: { value: 0 }, uCover: { value: 0.46 }, uDark: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 1800 },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color('#fff4e0') }, uAmb: { value: new THREE.Color('#9fb4c8') }, uCam: { value: new THREE.Vector3() },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uCover, uDark, uFlash, uFade; uniform vec3 uSun, uSunCol, uAmb, uCam; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 6; k++){ s += n(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        vec2 wind = vec2(uTime * 6.0, uTime * 2.5);
        vec2 p = (vW.xz + wind) * 0.0016;
        float base = fbm(p) * 0.75 + fbm(p * 3.1 + 4.0) * 0.25;
        float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, base);
        // fake self-shadowing: denser cloud along the sun direction means a darker underside
        float base2 = fbm(p + uSun.xz * 0.06) * 0.75 + fbm((p + uSun.xz * 0.06) * 3.1 + 4.0) * 0.25;
        float shade = clamp(1.0 - (base2 - base) * 2.2 - d * 0.35, 0.35, 1.15);
        vec3 lit = uSunCol * shade * 1.05 + uAmb * 0.45;
        vec3 col = mix(lit, uAmb * 0.55, uDark * (0.55 + d * 0.45));
        col += vec3(0.85, 0.88, 1.0) * uFlash * d;
        float dist = length(vW.xz - uCam.xz);
        float a = d * (1.0 - smoothstep(uFade * 0.55, uFade, dist)) * mix(0.92, 1.0, uDark);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(5200, 1, 5200);
  mesh.frustumCulled = false; mesh.renderOrder = -1;
  return mesh;
}
function makeStars() {
  const n = 2600, p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 0.95 + 0.05, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    p[i * 3] = r * Math.cos(a) * 900; p[i * 3 + 1] = u * 900; p[i * 3 + 2] = r * Math.sin(a) * 900; s[i] = Math.random();
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
  S.sky = makeSky(); S.clouds = makeClouds(); S.stars = makeStars();
  scene.add(S.sky, S.clouds, S.stars);
  // environment map rendered from a copy of the sky
  S.envScene = new THREE.Scene();
  S.envSky = makeSky(); S.envScene.add(S.envSky);
  S.pmrem = new THREE.PMREMGenerator(G.renderer);
}

const sunDir = new THREE.Vector3(), tmp = new THREE.Color();
export function updateSky(dt) {
  const cam = G.camera.position, L = getLights();
  const a = (G.dayTime - 0.25) * Math.PI * 2;
  sunDir.set(Math.cos(a) * 0.8, Math.sin(a), 0.45).normalize();
  const W = G.weather || { overcast: 0, storm: 0, rain: 0 };
  const oc = W.overcast || 0, space = G.spaceFade || 0;
  const elev = sunDir.y, day = clamp(elev * 3 + 0.3, 0, 1);
  const u = S.sky.material.uniforms;
  u.sunPosition.value.copy(sunDir);
  u.turbidity.value = lerp(3.2, 14, oc);
  u.rayleigh.value = lerp(1.4, 0.6, oc) + (1 - day) * 0.8;
  u.mieCoefficient.value = lerp(0.004, 0.02, oc);
  u.uGain.value = lerp(0.42, 0.15, oc) * (1 - space);
  S.sky.position.copy(cam);
  const hide = !!G.underwater || space > 0.4;
  S.sky.visible = !hide;
  // clouds
  const cu = S.clouds.material.uniforms;
  cu.uTime.value = G.time;
  cu.uCover.value = lerp(0.46, 1.08, oc);
  cu.uDark.value = clamp(oc * 0.8 + (W.storm || 0) * 0.35, 0, 1);
  cu.uFlash.value = G.flash || 0;
  cu.uSun.value.copy(sunDir);
  cu.uCam.value.copy(cam);
  cu.uFade.value = (G.fogBaseFar || 1500) > 1000 ? 2000 : 1150;
  // sunlight on the clouds: white at noon, gold and pink at sunrise/sunset, grey-blue at night
  const dusk = clamp(1 - Math.abs(elev) * 4, 0, 1);
  cu.uSunCol.value.setRGB(1, 0.95 - dusk * 0.3, 0.9 - dusk * 0.5).multiplyScalar(lerp(0.12, 1, day) * (1 - oc * 0.45));
  cu.uAmb.value.copy(L.hemi.color).multiplyScalar(0.55 + 0.45 * day).lerp(tmp.setRGB(0.55, 0.6, 0.66), 0.5).multiplyScalar(lerp(0.25, 1, day));
  S.clouds.position.set(cam.x, Math.max(620, cam.y > 620 ? 620 : 620), cam.z);
  S.clouds.visible = !hide;
  // stars come out at night (and hide behind cloud)
  S.stars.position.copy(cam);
  S.stars.material.uniforms.uA.value = clamp((0.15 - elev) * 4, 0, 1) * (1 - oc) * (hide ? 0 : 1);
  S.stars.material.uniforms.uT.value = G.time;
  S.stars.visible = S.stars.material.uniforms.uA.value > 0.01;
  // keep reflections in step with the sky (every few seconds, or when the weather changes a lot)
  S.envT -= dt;
  if (G.save.gfx !== 'low' && (S.envT <= 0 || S.lastSun.distanceTo(sunDir) > 0.08)) {
    S.envT = 4; S.lastSun.copy(sunDir);
    const eu = S.envSky.material.uniforms;
    for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'uGain']) {
      if (eu[k].value.copy) eu[k].value.copy(u[k].value); else eu[k].value = u[k].value;
    }
    eu.uGain.value = Math.max(0.05, u.uGain.value) * 0.6 * (0.3 + 0.7 * day);
    const rt = S.pmrem.fromScene(S.envScene, 0.03, 1, 2000);
    if (S.env) S.env.dispose();
    S.env = rt;
    G.scene.environment = rt.texture;
  }
  if (G.save.gfx === 'low' && G.scene.environment) { G.scene.environment = null; }
}
