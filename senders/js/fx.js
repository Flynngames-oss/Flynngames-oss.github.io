// Senders — particles: dust trails off the back wheel, dirt sprays and clods on landings and skids, snow and
// sand spray, and ambient life in the air (falling leaves, drifting pollen, light motes, snowflakes, desert dust).
import * as THREE from 'three';
import { clamp } from './util.js';

const VERT = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  vAlpha = aAlpha; vColor = aColor;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
varying float vAlpha; varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.15, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const N = 2400;

export class FX {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N); this.alpha = new Float32Array(N); this.life = new Float32Array(N); this.max = new Float32Array(N);
    this.grow = new Float32Array(N); this.a0 = new Float32Array(N); this.grav = new Float32Array(N); this.drag = new Float32Array(N); this.kind = new Uint8Array(N);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0; this.alive = 0;
    this.dust = new THREE.Color(0x9b7b58); this.tmp = new THREE.Color();
    this.ambient = null; this.ambT = 0;
  }
  setWorld(world) { this.dust.set(world.dust); this.ambient = world.ambient; this.clear(); }
  setScale(h) { this.mat.uniforms.uScale.value = h * 0.6; }
  clear() { this.life.fill(0); this.alpha.fill(0); }
  spawn(x, y, z, vx, vy, vz, color, size, grow, life, alpha, grav, drag, kind = 0) {
    const i = this.next; this.next = (this.next + 1) % N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.max[i] = life; this.a0[i] = alpha; this.alpha[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag; this.kind[i] = kind;
  }
  surfColor(surf) {
    // 0 dirt 1 grass 2 rock 3 wood 4 snow 5 sand
    if (surf === 4) return this.tmp.setRGB(0.95, 0.97, 1);
    if (surf === 5) return this.tmp.copy(this.dust).lerp(new THREE.Color(0xe0b080), 0.4);
    if (surf === 1) return this.tmp.copy(this.dust).lerp(new THREE.Color(0x6a7a40), 0.35);
    if (surf === 2) return this.tmp.copy(this.dust).lerp(new THREE.Color(0x9a948a), 0.5);
    return this.tmp.copy(this.dust);
  }
  // a puff of dust trailing the back wheel
  trail(p, vel, surf, amount) {
    if (surf === 3) return;
    const c = this.surfColor(surf);
    const n = 1;
    for (let k = 0; k < n; k++) {
      const s = 0.25 + Math.random() * 0.35;
      this.spawn(p.x + (Math.random() - 0.5) * 0.3, p.y + 0.05, p.z + (Math.random() - 0.5) * 0.3,
        vel.x * 0.15 + (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.8, vel.z * 0.15 + (Math.random() - 0.5) * 0.8,
        c, s * (surf === 4 ? 0.8 : 1), 0.9 + amount * 0.8, 0.9 + Math.random() * 1.0, 0.14 * Math.min(1, amount + 0.25), -0.3, 1.8);
    }
  }
  // dirt clods & spray (landings, skids, crashes)
  burst(p, vel, surf, power) {
    const c = this.surfColor(surf);
    const n = Math.round(clamp(power, 0.2, 2) * 14);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3 * power;
      this.spawn(p.x, p.y + 0.05, p.z, vel.x * 0.3 + Math.cos(a) * sp, 1 + Math.random() * 3.5 * power, vel.z * 0.3 + Math.sin(a) * sp,
        this.tmp.copy(c).multiplyScalar(0.55 + Math.random() * 0.3), 0.07 + Math.random() * 0.08, 0, 0.6 + Math.random() * 0.5, 1, 9.8, 0.3, 1);
    }
    for (let k = 0; k < n * 0.7; k++) {
      this.spawn(p.x + (Math.random() - 0.5), p.y + 0.1, p.z + (Math.random() - 0.5), vel.x * 0.2 + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.5, vel.z * 0.2 + (Math.random() - 0.5) * 2,
        c, 0.6 + Math.random() * 0.6, 2.2, 1.4 + Math.random(), 0.35, -0.2, 1.8);
    }
  }
  update(dt, camPos) {
    // ambient particles around the camera
    if (this.ambient && camPos) {
      this.ambT += dt;
      const rate = this.ambient === 'leaves' ? 0.05 : this.ambient === 'snow' ? 0.012 : this.ambient === 'motes' ? 0.04 : this.ambient === 'dust' ? 0.09 : 0.06;
      while (this.ambT > rate) {
        this.ambT -= rate;
        const x = camPos.x + (Math.random() - 0.5) * 50, z = camPos.z + (Math.random() - 0.5) * 50, y = camPos.y + Math.random() * 12 - 2;
        if (this.ambient === 'leaves') this.spawn(x, y + 4, z, 0.6, -0.8, 0.3, this.tmp.setHSL(0.03 + Math.random() * 0.09, 0.85, 0.42), 0.13, 0, 7, 1, 0, 0, 2);
        else if (this.ambient === 'snow') this.spawn(x, y + 6, z, 0.4, -1.2, 0.2, this.tmp.setRGB(1, 1, 1), 0.08, 0, 7, 0.9, 0, 0, 2);
        else if (this.ambient === 'motes') this.spawn(x, y, z, 0.1, 0.05, 0.1, this.tmp.setRGB(1.6, 1.5, 1.1), 0.05, 0, 5, 0.8, 0, 0, 3);
        else if (this.ambient === 'dust') this.spawn(x, camPos.y - 1 + Math.random() * 3, z, 2.5, 0.1, 0.8, this.tmp.copy(this.dust).multiplyScalar(1.3), 1.4, 0.5, 4, 0.08, 0, 0, 0);
        else this.spawn(x, y, z, 0.3, 0.05, 0.1, this.tmp.setRGB(1.4, 1.4, 1.0), 0.04, 0, 5, 0.8, 0, 0, 3);
      }
    }
    let alive = 0;
    const t = performance.now() * 0.001;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      if (this.kind[i] === 2) { this.vel[i3] = Math.sin(t * 1.7 + i) * 0.9; this.vel[i3 + 2] = Math.cos(t * 1.3 + i * 0.7) * 0.6; }
      if (this.kind[i] === 3) { this.vel[i3 + 1] = Math.sin(t * 0.8 + i) * 0.15; }
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.max[i];
      this.alpha[i] = this.a0[i] * (this.kind[i] === 1 ? Math.min(1, f * 3) : Math.min(1, f * 1.5) * Math.min(1, (1 - f) * 8));
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    this.alive = alive;
    const g = this.geo.attributes;
    g.position.needsUpdate = true; g.aColor.needsUpdate = true; g.aSize.needsUpdate = true; g.aAlpha.needsUpdate = true;
  }
}
