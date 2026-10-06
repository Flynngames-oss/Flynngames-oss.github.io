// Senders — sky dome with sun and drifting clouds, the sun light (with a shadow map that follows the rider),
// hemisphere fill light, distance fog and a reflection map made from the sky for shiny bikes and water.
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';

const VERT = /* glsl */`varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const FRAG = /* glsl */`uniform vec3 uZenith, uHorizon, uFog, uSunDir, uSunCol; uniform float uClouds, uTime, uDisc;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  col = mix(col, uFog, smoothstep(0.1, -0.04, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 60.0) * 0.45);
  if (h > -0.02) {
    vec2 p = d.xz / (h + 0.14) * 1.5 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = svn(p * 0.9) * 0.55 + svn(p * 2.1 + 3.3) * 0.28 + svn(p * 5.3 + 1.7) * 0.17;
    float c = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.32, n) * smoothstep(0.03, 0.3, h);
    float thick = smoothstep(1.0 - uClouds + 0.1, 1.0, n);
    vec3 cc = mix(vec3(1.0, 1.0, 1.02), uHorizon * 0.78, thick * 0.55);
    cc += uSunCol * pow(sd, 4.0) * 0.35 * (1.0 - thick);
    col = mix(col, cc, c * 0.92);
  }
  col = mix(col, uSunCol * 6.0, smoothstep(0.99955, 0.9998, sd) * uDisc);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uClouds: { value: 0.4 }, uTime: { value: 0 }, uDisc: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), this.mat);
    this.mesh.renderOrder = -1; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.shadow.camera.left = -42; this.sun.shadow.camera.right = 42; this.sun.shadow.camera.top = 42; this.sun.shadow.camera.bottom = -42;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445522, 1);
    scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = null;
    this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._f = new THREE.Vector3();
  }
  setShadows(size) {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }
  setWorld(world) {
    const s = world.sky;
    this.uniforms.uZenith.value.set(s.zenith); this.uniforms.uHorizon.value.set(s.horizon); this.uniforms.uFog.value.set(s.fog);
    this.uniforms.uSunCol.value.set(s.sun); this.uniforms.uClouds.value = s.clouds;
    this.sunDir.set(Math.cos(s.el) * Math.sin(s.az), Math.sin(s.el), Math.cos(s.el) * Math.cos(s.az)).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.sun.color.set(s.sun); this.sun.intensity = s.sunI;
    this.hemi.color.set(s.hemiSky); this.hemi.groundColor.set(s.hemiGround); this.hemi.intensity = s.hemiI;
    this.scene.fog = new THREE.FogExp2(s.fog, s.fogDensity);
    this.scene.background = null;
    // reflection map from the sky (no sun disc so bikes don't get a blinding highlight)
    const envScene = new THREE.Scene();
    const envMat = this.mat.clone(); envMat.uniforms = THREE.UniformsUtils.clone(this.uniforms); envMat.uniforms.uDisc.value = 0;
    const m = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat);
    envScene.add(m);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(world.colors.grassA).multiplyScalar(0.5) }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -5; envScene.add(ground);
    if (this.env) this.env.dispose();
    this.env = this.pmrem.fromScene(envScene, 0, 0.1, 500).texture;
    this.scene.environment = this.env;
    m.geometry.dispose(); envMat.dispose(); ground.geometry.dispose(); ground.material.dispose();
  }
  update(focus, camPos, dt) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camPos);
    // keep the shadow map centred on the rider, snapped to whole texels so shadows don't shimmer
    const L = this.sunDir, r = this._r.set(0, 1, 0).cross(L).normalize(), u = this._u.copy(L).cross(r).normalize();
    const texel = (this.sun.shadow.camera.right * 2) / Math.max(256, this.sun.shadow.mapSize.x);
    const a = Math.round(focus.dot(r) / texel) * texel, b = Math.round(focus.dot(u) / texel) * texel, c = focus.dot(L);
    const f = this._f.set(0, 0, 0).addScaledVector(r, a).addScaledVector(u, b).addScaledVector(L, c);
    this.sun.target.position.copy(f);
    this.sun.position.copy(f).addScaledVector(L, 200);
    this.sun.target.updateMatrixWorld();
  }
}
