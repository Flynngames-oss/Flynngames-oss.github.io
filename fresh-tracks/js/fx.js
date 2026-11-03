// Snow effects: carved board tracks left in the snow, powder spray, landing puffs and falling snow.
import * as THREE from 'three';

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

const pointsVS = `
attribute float size; attribute float alpha; varying float vA; uniform float uScale;
void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const pointsFS = `
uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`;

export class Spray {
  constructor(scene, max = 2600) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.ttl = new Float32Array(max);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.s0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uni = { uTex: { value: softDot() }, uColor: { value: new THREE.Color(0.93, 0.96, 1.0) }, uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: pointsVS, fragmentShader: pointsFS, uniforms: this.uni, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    this.geo = g;
  }
  emit(p, v, count, spread, size = 0.25, ttl = 0.9) {
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.3; this.pos[i * 3 + 1] = p.y + Math.random() * 0.15; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread; this.vel[i * 3 + 1] = v.y + Math.random() * spread * 0.8; this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread;
      this.ttl[i] = ttl * (0.6 + Math.random() * 0.8); this.life[i] = this.ttl[i]; this.s0[i] = size * (0.6 + Math.random() * 0.9);
    }
  }
  update(dt, pxScale) {
    this.uni.uScale.value = pxScale;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.ttl[i]);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 4.5 * dt; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] * (1 + (1 - f) * 1.6);
      this.alpha[i] = f * f * 0.55;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.size.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true;
  }
}

export class Snowfall {
  constructor(scene, count = 9000) {
    this.count = count; this.R = 40;
    const pos = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * 2 * this.R; pos[i * 3 + 1] = Math.random() * 30 - 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * this.R; size[i] = 0.05 + Math.random() * 0.07; alpha[i] = 0.6 + Math.random() * 0.4; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.uni = { uTex: { value: softDot() }, uColor: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 600 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: pointsVS, fragmentShader: pointsFS, uniforms: this.uni, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; this.points.visible = false; scene.add(this.points);
    this.pos = pos; this.geo = g; this.t = 0;
  }
  update(dt, cam, wind, pxScale) {
    if (!this.points.visible) return;
    this.uni.uScale.value = pxScale; this.t += dt;
    const R = this.R, p = this.pos;
    for (let i = 0; i < this.count; i++) {
      p[i * 3] += (wind.x + Math.sin(this.t * 0.9 + i) * 0.4) * dt; p[i * 3 + 1] -= (1.1 + (i % 7) * 0.12) * dt; p[i * 3 + 2] += (wind.z + Math.cos(this.t * 0.7 + i * 1.3) * 0.4) * dt;
      // keep the flakes in a box around the camera
      let dx = p[i * 3] - cam.x, dz = p[i * 3 + 2] - cam.z, dy = p[i * 3 + 1] - cam.y;
      if (dx > R) p[i * 3] -= 2 * R; else if (dx < -R) p[i * 3] += 2 * R;
      if (dz > R) p[i * 3 + 2] -= 2 * R; else if (dz < -R) p[i * 3 + 2] += 2 * R;
      if (dy < -14) p[i * 3 + 1] += 34; else if (dy > 20) p[i * 3 + 1] -= 34;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// a ribbon pressed into the snow behind the board
export class Tracks {
  constructor(scene, max = 3000) {
    this.max = max; this.i = 0; this.count = 0; this.open = false;
    this.pos = new Float32Array(max * 2 * 3); this.nrm = new Float32Array(max * 2 * 3); this.col = new Float32Array(max * 2 * 4);
    const idx = new Uint32Array(max * 6);
    for (let k = 0; k < max; k++) {
      const a = k * 2, b = ((k + 1) % max) * 2;
      idx.set([a, b, a + 1, a + 1, b, b + 1], k * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshStandardMaterial({ color: 0xaab8cc, roughness: 0.95, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12 });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.geo = g; this.last = new THREE.Vector3(); this.dirty = false;
  }
  // p: board centre on the snow, side: unit vector across the board, n: surface normal
  add(p, side, n, width, alpha) {
    if (this.open && this.last.distanceToSquared(p) < 0.12) return;
    if (!this.open) { this._write(p, side, n, width, 0); this.open = true; }
    this._write(p, side, n, width, alpha);
    this.last.copy(p);
  }
  end() { if (!this.open) return; this.open = false; const k = (this.i - 1 + this.max) % this.max; for (const o of [0, 1]) this.col[(k * 2 + o) * 4 + 3] = 0; this.dirty = true; }
  _write(p, s, n, w, a) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    for (const [o, sg] of [[0, -1], [1, 1]]) {
      const v = k * 2 + o;
      this.pos[v * 3] = p.x + s.x * w * 0.5 * sg + n.x * 0.02; this.pos[v * 3 + 1] = p.y + s.y * w * 0.5 * sg + n.y * 0.02; this.pos[v * 3 + 2] = p.z + s.z * w * 0.5 * sg + n.z * 0.02;
      this.nrm[v * 3] = n.x; this.nrm[v * 3 + 1] = n.y; this.nrm[v * 3 + 2] = n.z;
      this.col[v * 4] = 0.86 + sg * 0.06; this.col[v * 4 + 1] = 0.9 + sg * 0.05; this.col[v * 4 + 2] = 1; this.col[v * 4 + 3] = a;
    }
    // the slot after the head is the oldest; hide its quad so the ring doesn't join end to start
    const nk = this.i * 2;
    for (const o of [0, 1]) { const v = k * 2 + o, u = nk + o; this.pos[u * 3] = this.pos[v * 3]; this.pos[u * 3 + 1] = this.pos[v * 3 + 1]; this.pos[u * 3 + 2] = this.pos[v * 3 + 2]; this.col[u * 4 + 3] = 0; }
    this.dirty = true;
  }
  update() {
    if (!this.dirty) return; this.dirty = false;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}
