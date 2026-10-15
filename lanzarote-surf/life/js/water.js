// Realistic water: scrolling normal-mapped ripples, Fresnel sky reflections, sun glitter, turquoise shallows
// fading to deep blue, foam along the shore, and a bright rippling ceiling when you look up from underwater.
import * as THREE from 'three';
import { G, WATER_Y, clamp, lerp } from './state.js';
import { heightAt, WORLD } from './terrain.js';
import { getLights } from './world.js';

export const WATER_NORMALS = 'assets/waternormals.jpg';
let mat = null;

function depthTexture() {
  const S = 1056, step = WORLD * 2 / S, data = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const d = WATER_Y - heightAt(-WORLD + (i + 0.5) * step, -WORLD + (j + 0.5) * step);
    data[j * S + i] = clamp(Math.round(d * 6 + 20), 0, 255);         // 20 = waterline, 6 steps per metre
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

export function makeWaterMaterial() {
  const normals = new THREE.TextureLoader().load(WATER_NORMALS);
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  mat = new THREE.ShaderMaterial({
    transparent: true, fog: true, side: THREE.DoubleSide, depthWrite: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uNormals: { value: null }, uDepth: { value: null }, uWorld: { value: WORLD },
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color('#fff2d8') },
      uSky: { value: new THREE.Color('#5d8fc8') }, uHorizon: { value: new THREE.Color('#c8d8e4') },
      uDeep: { value: new THREE.Color('#0a2c45') }, uShallow: { value: new THREE.Color('#2f7f7a') },
      uChop: { value: 1 }, uDay: { value: 1 }, uFlash: { value: 0 },
    }]),
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uNormals, uDepth; uniform float uWorld, uTime, uChop, uDay, uFlash;
      uniform vec3 uSun, uSunCol, uSky, uHorizon, uDeep, uShallow; varying vec3 vW;
      #include <fog_pars_fragment>
      vec3 nrm(vec2 p){ return texture2D(uNormals, p).rgb * 2.0 - 1.0; }
      void main(){
        float t = uTime;
        vec2 p = vW.xz;
        vec3 n = nrm(p * 0.021 + vec2(t * 0.012, t * 0.007)) + nrm(p * 0.047 - vec2(t * 0.009, -t * 0.013)) * 0.7
               + nrm(p * 0.0085 + vec2(-t * 0.004, t * 0.005)) * 0.9 + nrm(p * 0.11 + vec2(t * 0.03, t * 0.02)) * 0.35;
        vec3 N = normalize(vec3(n.x * 0.55 * uChop, 1.0, n.y * 0.55 * uChop));
        vec3 V = normalize(cameraPosition - vW);
        bool under = cameraPosition.y < vW.y;
        if (under) N = -N;
        float ndv = max(dot(N, V), 0.0);
        vec2 duv = (p + uWorld) / (2.0 * uWorld);
        float depth = (texture2D(uDepth, clamp(duv, 0.0, 1.0)).r * 255.0 - 20.0) / 6.0;
        if (duv.x < 0.0 || duv.y < 0.0 || duv.x > 1.0 || duv.y > 1.0) depth = 30.0;
        vec3 col;
        float alpha;
        if (!under) {
          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uHorizon, uSky, pow(clamp(R.y, 0.0, 1.0), 0.6));
          float k = smoothstep(0.0, 9.0, depth);
          vec3 body = mix(uShallow, uDeep, k) * (0.35 + 0.65 * uDay);
          // light scattering inside the water where waves face the sun
          body += uShallow * 0.12 * max(dot(N, uSun), 0.0) * (1.0 - k) * uDay;
          col = mix(body, sky, fres);
          float spec = pow(max(dot(R, uSun), 0.0), 600.0) * 7.0 + pow(max(dot(R, uSun), 0.0), 60.0) * 0.25;
          col += uSunCol * spec * smoothstep(-0.05, 0.1, uSun.y);
          // foam where the water is very shallow (beaches, river banks)
          float fn = texture2D(uNormals, p * 0.09 + vec2(t * 0.02, 0.0)).b;
          float foam = (1.0 - smoothstep(0.05, 0.9, depth)) * smoothstep(0.55, 0.85, fn + 0.25 * sin(t * 1.5 + p.x * 0.3));
          col = mix(col, vec3(0.92, 0.95, 0.97) * (0.4 + 0.6 * uDay), foam * 0.85);
          col += vec3(0.8, 0.85, 1.0) * uFlash * 0.25;
          alpha = mix(0.55, 0.96, smoothstep(0.0, 4.0, depth)) + fres * 0.3;
        } else {
          // from below: the bright, rippling surface (and total internal reflection at a slant)
          float window = smoothstep(0.55, 0.8, ndv);
          col = mix(vec3(0.05, 0.25, 0.32), vec3(0.75, 0.92, 0.95), window) * (0.3 + 0.7 * uDay);
          col += uSunCol * pow(max(dot(-V, uSun), 0.0), 40.0) * 2.0 * window;
          alpha = 0.95;
        }
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uNormals.value = normals;
  mat.uniforms.uDepth.value = depthTexture();
  return mat;
}

export function updateWater() {
  if (!mat) return;
  const u = mat.uniforms, L = getLights();
  const a = (G.dayTime - 0.25) * Math.PI * 2;
  u.uSun.value.set(Math.cos(a) * 0.8, Math.sin(a), 0.45).normalize();
  u.uTime.value = G.time;
  const day = clamp(u.uSun.value.y * 3 + 0.3, 0, 1);
  u.uDay.value = day * (1 - (G.overcast || 0) * 0.35);
  u.uSunCol.value.copy(L.sun.color).multiplyScalar(clamp(L.sun.intensity / 1.6, 0, 1.2));
  u.uHorizon.value.copy(G.landFog.color);
  u.uSky.value.copy(G.landFog.color).multiplyScalar(0.62).lerp(new THREE.Color(0.18, 0.36, 0.62), 0.45 * day * (1 - (G.overcast || 0)));
  const W = G.weather || {};
  u.uChop.value = 1 + (W.rain || 0) * 0.6 + (W.storm || 0) * 1.2;
  u.uFlash.value = G.flash || 0;
}
