// Senders — GPU grass: tens of thousands of individual blades in a tile that follows the camera, sitting on
// the real ground height, coloured like the ground under them, thinning out on the trail, rock, snow and
// water, and swaying in the wind. Flowers dot the meadows in the Highlands.
import * as THREE from 'three';
import { GRID } from './course.js';
import { clamp, smoothstep } from './util.js';

const VERT = /* glsl */`
precision highp float;
attribute vec4 aOff;
uniform vec3 uCam; uniform float uTile, uTime, uDensity, uFlowers;
uniform sampler2D uH, uC; uniform vec2 uOrigin, uSize;
uniform vec3 uSunDir;
varying vec3 vCol; varying float vShade;
#include <fog_pars_vertex>
float hAt(ivec2 g){ g = clamp(g, ivec2(0), ivec2(uSize) - 1); return texelFetch(uH, g, 0).r; }
void main(){
  vec2 p = aOff.xy + uTile * floor((uCam.xz - aOff.xy) / uTile + 0.5);
  vec2 g = (p - uOrigin) / ${GRID.toFixed(1)};
  vec4 c = texture2D(uC, (g + 0.5) / uSize);
  float dist = length(p - uCam.xz);
  float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, dist);
  float keep = step(aOff.z, c.a * uDensity);
  float hgt = (0.22 + 0.42 * aOff.w) * keep * fade * (0.55 + 0.55 * c.a);
  ivec2 gi = ivec2(floor(g)); vec2 f = fract(g);
  float y = mix(mix(hAt(gi), hAt(gi + ivec2(1, 0)), f.x), mix(hAt(gi + ivec2(0, 1)), hAt(gi + ivec2(1, 1)), f.x), f.y);
  float ang = aOff.z * 97.0 + aOff.w * 13.0;
  float ca = cos(ang), sa = sin(ang);
  float w = 0.055 * (1.0 - position.y * 0.85) * (0.7 + aOff.w * 0.6);
  vec3 local = vec3(position.x * w * ca, position.y * hgt, position.x * w * sa);
  float gust = sin(uTime * 0.7 + p.x * 0.05 + p.y * 0.04) * 0.5 + 0.5;
  float sway = sin(uTime * 2.2 + p.x * 0.45 + p.y * 0.35) * (0.12 + 0.2 * gust) + 0.18;
  vec2 bend = vec2(0.8, 0.5) * sway * position.y * position.y * hgt;
  vec3 wp = vec3(p.x + local.x + bend.x, y - 0.03 + local.y, p.y + local.z + bend.y);
  vec3 col = c.rgb * c.rgb * (0.62 + 0.55 * position.y) * (0.82 + 0.36 * fract(aOff.w * 7.3));
  if (uFlowers > 0.0 && aOff.w > 1.0 - uFlowers && position.y > 0.8) {
    float k = fract(aOff.z * 31.7);
    col = k < 0.33 ? vec3(1.0, 0.85, 0.15) : k < 0.66 ? vec3(0.95, 0.95, 1.0) : vec3(0.6, 0.35, 0.9);
  }
  vCol = col;
  vShade = 0.75 + 0.35 * position.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
varying vec3 vCol; varying float vShade;
uniform vec3 uLight;
#include <fog_pars_fragment>
void main(){
  gl_FragColor = vec4(vCol * vShade * uLight, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Grass {
  constructor(scene, course, quality) {
    this.scene = scene;
    const blades = quality.grass, tile = quality.grassTile;
    if (!blades) { this.mesh = null; return; }
    const W = course.GW, H = course.GH, w = course.world;
    // height texture (exact ground) and colour + density texture
    const hTex = new THREE.DataTexture(course.gh, W, H, THREE.RedFormat, THREE.FloatType);
    hTex.magFilter = hTex.minFilter = THREE.NearestFilter; hTex.needsUpdate = true;
    const cd = new Uint8Array(W * H * 4), gc = course.gridColor;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, d = course.gd[k], h = course.gh[k];
      // slope from neighbours
      const hl = course.gh[k - (i > 0 ? 1 : 0)], hr = course.gh[k + (i < W - 1 ? 1 : 0)], hd = course.gh[k - (j > 0 ? W : 0)], hu = course.gh[k + (j < H - 1 ? W : 0)];
      const ny = 2 * GRID / Math.hypot(hl - hr, 2 * GRID, hd - hu);
      let dens = w.grassDensity;
      dens *= smoothstep(course.hw + 0.6, course.hw + 2.2, d);
      dens *= smoothstep(0.76, 0.88, ny);
      if (h > course.snowY - 6) dens = 0;
      if (h < course.lakeY + 0.6) dens = 0;
      dens *= 0.75 + 0.5 * course.noise.n2(i * 0.11, j * 0.11);
      const c = [gc[k * 3], gc[k * 3 + 1], gc[k * 3 + 2]];
      cd[k * 4] = clamp(Math.sqrt(c[0]) * 255, 0, 255); cd[k * 4 + 1] = clamp(Math.sqrt(c[1]) * 255, 0, 255); cd[k * 4 + 2] = clamp(Math.sqrt(c[2]) * 255, 0, 255);
      cd[k * 4 + 3] = clamp(dens, 0, 1) * 255;
    }
    const cTex = new THREE.DataTexture(cd, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    cTex.magFilter = cTex.minFilter = THREE.LinearFilter; cTex.needsUpdate = true;
    this.textures = [hTex, cTex];
    // one blade: a tapered strip, 3 segments
    const pos = [], idx = [];
    for (let s = 0; s <= 3; s++) { const y = s / 3; pos.push(-1, y, 0, 1, y, 0); }
    for (let s = 0; s < 3; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const blade = new THREE.InstancedBufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    blade.setIndex(idx);
    const off = new Float32Array(blades * 4);
    for (let i = 0; i < blades; i++) { off[i * 4] = Math.random() * tile; off[i * 4 + 1] = Math.random() * tile; off[i * 4 + 2] = Math.random(); off[i * 4 + 3] = Math.random(); }
    blade.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    blade.instanceCount = blades;
    this.geo = blade;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uCam: { value: new THREE.Vector3() }, uTile: { value: tile }, uTime: { value: 0 }, uDensity: { value: 1 }, uFlowers: { value: w.flowers || 0 },
      uH: { value: hTex }, uC: { value: cTex }, uOrigin: { value: new THREE.Vector2(course.gx0, course.gz0) }, uSize: { value: new THREE.Vector2(W, H) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: new THREE.Color(1, 1, 1) },
    }]);
    this.uniforms.uH.value = hTex; this.uniforms.uC.value = cTex;
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: true });
    this.mesh = new THREE.Mesh(blade, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }
  setLight(sky) {
    if (!this.mesh) return;
    // rough match to the terrain's lighting: sun + sky fill
    const s = sky.sun.color.clone().multiplyScalar(sky.sun.intensity * Math.max(0.2, sky.sunDir.y) * 0.32);
    const a = sky.hemi.color.clone().multiplyScalar(sky.hemi.intensity * 0.36);
    this.uniforms.uLight.value.copy(s.add(a));
  }
  update(dt, camPos) {
    if (!this.mesh) return;
    this.uniforms.uTime.value += dt;
    this.uniforms.uCam.value.copy(camPos);
  }
  dispose() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); for (const t of this.textures) t.dispose();
  }
}
