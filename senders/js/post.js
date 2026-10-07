// Senders — post-processing: soft bloom on the sun and bright skies, a punchy colour grade, vignette, a radial
// speed blur that kicks in when you're really sending it, a white flash on big moments, and FXAA when MSAA
// isn't available. On Low quality everything is skipped and the scene renders straight to the screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const FinalShader = {
  uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1280, 720) }, uSpeed: { value: 0 }, uVig: { value: 0.5 }, uFlash: { value: 0 }, uFxaa: { value: 1 }, uSat: { value: 1.12 }, uRed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float uSpeed, uVig, uFlash, uFxaa, uSat, uRed; varying vec2 vUv;
    float lu(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 aa(vec2 uv){
      vec2 px = 1.0 / res;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uFxaa < 0.5) return c;
      vec3 n = texture2D(tDiffuse, uv + vec2(0.0, -px.y)).rgb, s = texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb;
      vec3 e = texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb, w = texture2D(tDiffuse, uv + vec2(-px.x, 0.0)).rgb;
      float lc = lu(c), ln = lu(n), ls = lu(s), le = lu(e), lw = lu(w);
      float mn = min(lc, min(min(ln, ls), min(le, lw))), mx = max(lc, max(max(ln, ls), max(le, lw)));
      float range = mx - mn;
      if (range < max(0.04, mx * 0.12)) return c;
      vec2 dir = vec2(-((ln + ls) - (le + lw)), (ln + le) - (ls + lw));
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((ln + ls + le + lw) * 0.03, 0.008));
      dir = clamp(dir * rcp, -3.0, 3.0) * px;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv - dir * 0.17).rgb + texture2D(tDiffuse, uv + dir * 0.17).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lb = lu(b);
      return (lb < mn || lb > mx) ? a : b;
    }
    void main(){
      vec3 col = aa(vUv);
      if (uSpeed > 0.01) {
        vec2 d = vUv - vec2(0.5, 0.47);
        float amt = uSpeed * smoothstep(0.12, 0.75, length(d)) * 0.045;
        vec3 acc = col;
        for (int i = 1; i <= 6; i++) acc += texture2D(tDiffuse, vUv - d * amt * float(i) / 6.0).rgb;
        col = acc / 7.0;
      }
      float l = lu(col);
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * 1.05 + 0.5;
      vec2 q = vUv - 0.5;
      col *= 1.0 - uVig * dot(q, q) * 1.5;
      col = mix(col, vec3(l * 1.1, l * 0.35, l * 0.3), uRed);
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = null; this.level = -1;
    this.speed = 0; this.flash = 0; this.red = 0;
  }
  setLevel(level) {
    if (level === this.level) return;
    this.level = level;
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.composer = null; }
    if (level <= 0) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: level >= 2 ? 4 : 0 });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (level >= 2) { this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.5, 0.92); c.addPass(this.bloom); }
    c.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.final.uniforms.uFxaa.value = level >= 2 ? 0 : 1;
    c.addPass(this.final);
    this.composer = c;
    this.resize();
  }
  resize() {
    if (!this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x / pr, size.y / pr);
    this.final.uniforms.res.value.set(size.x, size.y);
  }
  render(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    const u = this.final.uniforms;
    u.uSpeed.value = this.speed; u.uFlash.value = this.flash * 0.35; u.uRed.value = this.red;
    this.composer.render(dt);
  }
}
