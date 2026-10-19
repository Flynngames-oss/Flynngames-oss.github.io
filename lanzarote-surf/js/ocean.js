// Ocean: the wave model (shared by physics in JS and rendering in GLSL), the water meshes,
// the curling lip, spray particles and the surfer's foam trail.
import * as THREE from 'three';
import { SKY_GLSL } from './sky.js';

export const MAXW = 4;
const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const sq = (x) => x * x;
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Wave model. Coordinates: s = along the shore (uA), u = toward the shore (uD).
// Each wave is a long ridge whose crest sits at u = uc and travels toward the beach.
// Once it reaches the break line it starts to peel: the break point sb runs along
// the ridge (direction = peel). Ahead of sb the face is steep and green; behind it
// the wave has broken into whitewater.
// ---------------------------------------------------------------------------
export class WaveSystem {
  constructor(spot) {
    this.spot = spot;
    this.a = spot.a; this.d = spot.d;
    this.waves = [];
    this.t = 0;
    this.nextSet = 6;
    this.setLeft = 0;
    this.nextInSet = 0;
    this.ids = 1;
    // small ambient swell + wind chop, mostly travelling toward the shore
    const amb = [[0.24, 71, 0.0, 0], [0.09, 37, 0.5, 1.7], [0.04, 19, -0.7, 4.1]];
    this.amb = amb.map(([A, L, ang, ph]) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      const dx = this.d.x * c - this.d.z * s, dz = this.d.x * s + this.d.z * c;
      const k = Math.PI * 2 / L;
      return { dx, dz, k, A: A * spot.chop, w: Math.sqrt(9.81 * k), ph };
    });
    // a wave already on its way so the first one arrives quickly
    this.spawn(spot.uBreak - 110);
    this.setLeft = 1; this.nextInSet = 13;
    // every minute or two a MEGA wave rolls in: about ten times the size of the normal ones
    this.nextMega = rand(35, 60);
    this.onMega = null;
  }

  spawn(uc, mega = false) {
    const sp = this.spot;
    if (this.waves.length >= MAXW) return null;
    const Hmax = mega ? sp.Hmax * rand(8.5, 10) : rand(sp.Hmin, sp.Hmax);
    const peel = sp.peel || (Math.random() < 0.5 ? -1 : 1);
    const w = {
      id: this.ids++, uc: uc ?? sp.uBreak - 330, H: Hmax * 0.3, Hmax, s0: sp.peakS + rand(-16, 16) - peel * 8,
      peel, P: sp.P * rand(0.9, 1.1) * (mega ? 1.8 : 1), sb: 0, bk: 0, broke: false, fade: 0, stNow: 0, c: 9,
      len: sp.len * rand(0.85, 1.15) * (mega ? 2 : 1), t: 0, ph: rand(0, 6), dying: false, ridden: false, mega,
    };
    w.sb = w.s0;
    this.waves.push(w);
    return w;
  }

  update(dt) {
    this.t += dt;
    const sp = this.spot;
    // sets of waves
    if (this.setLeft > 0 && this.t >= this.nextInSet) {
      if (this.spawn()) { this.setLeft--; this.nextInSet = this.t + rand(11, 15); }
      else this.nextInSet = this.t + 2;
    }
    if (this.t >= this.nextSet) {
      this.setLeft += 2 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
      this.nextInSet = Math.max(this.nextInSet, this.t);
      this.nextSet = this.t + rand(sp.setPeriod * 0.8, sp.setPeriod * 1.2);
    }
    if (sp.Hmax > 0 && this.t >= this.nextMega) {
      const w = this.waves.some((q) => q.mega) ? null : this.spawn(sp.uBreak - 330, true);
      if (w) { this.nextMega = this.t + rand(85, 140); if (this.onMega) this.onMega(w); } else this.nextMega = this.t + 3;
    }
    for (const w of this.waves) {
      const far = ss(sp.uBreak - 60, sp.uBreak - 320, w.uc);
      w.c = (sp.C + (9 - sp.C) * far) * (w.mega ? 1.5 : 1);
      w.uc += w.c * dt;
      if (!w.dying) w.fade = Math.min(1, w.fade + dt / 4);
      const pre = ss(sp.uBreak - 330, sp.uBreak, w.uc);
      w.H = w.Hmax * (0.28 + 0.72 * pre);
      // a mega wave spends itself after it breaks, so only whitewater reaches the beach
      if (w.mega && w.broke) w.H *= Math.max(0.1, Math.exp(-(w.uc - sp.uBreak) / 75));
      w.stNow = sp.st * (0.25 + 0.75 * ss(sp.uBreak - 140, sp.uBreak, w.uc));
      if (!w.broke && w.uc >= sp.uBreak) { w.broke = true; w.sb = w.s0 - w.peel * 3; }
      if (w.broke) {
        w.bk = Math.min(1, w.bk + dt / 1.0);
        w.t += dt;
        const prog = (w.sb - w.s0) * w.peel;
        let p = w.P * (1 + 0.4 * Math.sin(w.t * 0.55 + w.ph) + 0.25 * Math.sin(w.t * 1.7 + w.ph * 2));
        if (prog > w.len) { p = 34; w.closeout = true; }
        w.sb += w.peel * p * dt;
        if (prog > w.len + 450) w.dying = true;
      }
      if (w.uc > sp.uEnd) w.dying = true;
      if (w.dying) w.fade -= dt / 5;
    }
    this.waves = this.waves.filter((w) => w.fade > 0 || !w.dying);
  }

  // Local shape parameters of one wave at (s,u).
  local(w, s, u) {
    const q = (s - w.s0) * w.peel;
    const env = Math.exp(-sq(q / (q > 0 ? 420 : 70))) * Math.max(0, w.fade);
    const ds = (s - w.sb) * w.peel;
    const br = w.bk * (1 - ss(-16, 0, ds));
    const sh = 1 - 0.5 * ss(30, 280, ds);
    const Hh = w.H * env * sh * (1 - 0.45 * br);
    const st = w.stNow * (1 - br) * (1 - 0.65 * ss(10, 250, ds));
    const Lf = Math.max(w.H, 0.3) * (3.2 - 2.2 * st);
    const du = u - w.uc;
    const T = w.bk * (ds >= 0 ? 1 - ss(0, 34, ds) : 1);
    return { env, ds, br, Hh, st, Lf, du, x: du / Lf, T };
  }

  waveY(w, s, u) {
    const L = this.local(w, s, u);
    let y;
    if (L.du < 0) y = Math.exp(-sq(L.du / (w.H * 5.5 + 1)));
    else { const x = Math.min(L.du / L.Lf, 1); y = (1 - x) * (1 - x) * (1 + 2 * x * (1 - L.st)); }
    y -= 0.1 * Math.exp(-sq((L.du - 1.6 * L.Lf) / L.Lf));
    return L.Hh * y;
  }

  ambient(x, z) {
    let h = 0;
    for (const m of this.amb) h += m.A * Math.sin(m.k * (m.dx * x + m.dz * z) - m.w * this.t + m.ph);
    return h;
  }

  // Water height at scene position (x,z).
  height(x, z) {
    const s = x * this.a.x + z * this.a.z, u = x * this.d.x + z * this.d.z;
    let h = this.ambient(x, z);
    for (const w of this.waves) if (w.fade > 0) h += this.waveY(w, s, u);
    return h;
  }

  // Foam / whitewater amount at (x,z) (rough; used for physics & audio).
  foamAt(x, z) {
    const s = x * this.a.x + z * this.a.z, u = x * this.d.x + z * this.d.z;
    let f = 0;
    for (const w of this.waves) {
      if (w.fade <= 0) continue;
      const L = this.local(w, s, u);
      let k = L.br * Math.exp(-sq((L.du - 0.3 * L.Lf) / (1.4 * L.Lf)));
      if (L.du < L.Lf) k += L.br * 0.7 * Math.exp(Math.min(L.du, 0) / 30);
      f += k * L.env;
    }
    return f;
  }

  // GPU uniforms for up to MAXW waves.
  fill(u0, u1) {
    for (let i = 0; i < MAXW; i++) {
      const w = this.waves[i];
      if (w && w.fade > 0) {
        u0[i].set(w.uc, w.sb, w.H, w.s0);
        u1[i].set(w.peel, w.bk, Math.max(0, w.fade), w.stNow);
      } else { u0[i].set(0, 0, 0, 0); u1[i].set(1, 0, 0, 0); }
    }
  }
}

// ---------------------------------------------------------------------------
// GLSL version of exactly the same wave model.
// ---------------------------------------------------------------------------
export const WAVE_GLSL = /* glsl */`
uniform float uTime;
uniform vec2 uA, uD;
uniform vec4 uW0[${MAXW}], uW1[${MAXW}];
uniform vec4 uAmb[3];
uniform vec2 uAmbW[3];
float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
float sq(float x){return x*x;}
float ambient(vec2 p){
  float h=0.;
  for(int i=0;i<3;i++) h+=uAmb[i].w*sin(uAmb[i].z*dot(uAmb[i].xy,p)-uAmbW[i].x*uTime+uAmbW[i].y);
  return h;
}
float waveField(vec2 p, out float foam, out float thin, out float tube){
  float s=dot(p,uA), u=dot(p,uD);
  float h=0.; foam=0.; thin=0.; tube=0.;
  for(int i=0;i<${MAXW};i++){
    vec4 A=uW0[i]; vec4 B=uW1[i];
    if(B.z<=0.0) continue;
    float q=(s-A.w)*B.x;
    float env=exp(-sq(q/(q>0.?420.:70.)))*B.z;
    float ds=(s-A.y)*B.x;
    float br=B.y*(1.-ss(-16.,0.,ds));
    float sh=1.-0.5*ss(30.,280.,ds);
    float Hh=A.z*env*sh*(1.-0.45*br);
    float st=B.w*(1.-br)*(1.-0.65*ss(10.,250.,ds));
    float Lf=max(A.z,0.3)*(3.2-2.2*st);
    float du=u-A.x;
    float y;
    if(du<0.) y=exp(-sq(du/(A.z*5.5+1.)));
    else { float x=min(du/Lf,1.); y=(1.-x)*(1.-x)*(1.+2.*x*(1.-st)); }
    y-=0.1*exp(-sq((du-1.6*Lf)/Lf));
    h+=Hh*y;
    float f=br*exp(-sq((du-0.3*Lf)/(1.4*Lf)));
    if(du<Lf) f+=br*0.7*exp(min(du,0.)/30.);
    f*=env;
    f+=B.y*env*exp(-sq((du-Lf)/(0.8+0.4*Lf)))*exp(-sq((ds+3.)/6.))*1.4;
    f+=st*env*0.7*exp(-sq((du+0.2)/0.55))*ss(-2.,25.,ds)*ss(1.2,2.2,A.z);
    foam+=f;
    thin+=env*(1.-br)*(0.35+0.65*st)*ss(0.2,0.95,y)*ss(-3.,0.,du)*ss(0.5,1.5,A.z);
    float T=B.y*(ds>=0.?1.-ss(0.,34.,ds):1.)*ss(0.9,1.4,A.z*env);
    float xx=du/Lf;
    tube+=T*ss(0.,0.12,xx)*(1.-ss(T*0.7,T*1.02,xx))*ss(-12.,-2.,ds);
  }
  return h+ambient(p);
}
float waveH(vec2 p){ float f,t,b; return waveField(p,f,t,b); }
`;

const WATER_FRAG_COMMON = /* glsl */`
uniform sampler2D uDepth, uRip;
uniform vec4 uDepthXf;
uniform vec3 uDeep, uShallow, uSSS;
uniform vec3 uFogCol;
uniform float uFogDen;
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,-3.7); a*=.5; } return s; }
vec3 shadeWater(vec3 W, vec3 Ng, float foamIn, float thin, float lip, float tube){
  vec3 V=normalize(cameraPosition-W);
  float dist=length(cameraPosition-W);
  // ripples from a tileable slope map at three scales
  vec2 q=W.xz; float t=uTime;
  vec2 g=(texture2D(uRip,q/21.+vec2(t*0.011,t*0.006)).xy-0.5)*1.0
        +(texture2D(uRip,q/7.7+vec2(-t*0.019,t*0.014)).xy-0.5)*0.7
        +(texture2D(uRip,q/2.6+vec2(t*0.03,-t*0.035)).xy-0.5)*0.45;
  float rf=1.-ss(40.,900.,dist);
  float steepN=clamp(1.-Ng.y,0.,1.);
  vec3 N=normalize(Ng+vec3(g.x,0.,g.y)*0.55*rf*(1.-0.6*lip)*(1.-0.5*ss(0.05,0.35,steepN)));
  float NV=max(dot(N,V),0.);
  float fres=0.02+0.7*pow(1.-NV,5.);
  vec3 R=reflect(-V,N); R.y=abs(R.y)+0.02;
  vec3 refl=skyColor(normalize(R))*0.9;
  float depth=-texture2D(uDepth,(W.xz-uDepthXf.xy)*uDepthXf.zw).r;
  float shal=exp(-max(depth,0.)*0.16)*(1.-lip);
  vec3 body=mix(uDeep,uShallow,shal);
  float dif=max(dot(N,uSunDir),0.);
  body*=0.5+0.5*dif;
  // light scattering through thin water near the crest
  float back=pow(max(dot(-V,uSunDir)*0.5+0.5,0.),2.);
  float sss=thin*(0.45+1.4*back);
  body+=uSSS*sss*(0.55+0.45*dif);
  // faces that look toward the viewer and away from the sky are darker/greener
  body*=0.85+0.3*clamp(Ng.y,0.,1.);
  tube=clamp(tube,0.,1.);
  body*=1.-0.55*tube;
  // wave faces glow green-blue, more the steeper they are
  float face=ss(0.12,0.6,length(Ng.xz))*(1.-lip);
  vec3 faceCol=mix(uDeep*1.3+uSSS*0.22,uSSS*(0.62+0.5*dif)+uDeep*0.2,clamp(thin*1.5,0.,1.));
  body=mix(body,faceCol,face*0.75);
  // streaky foam lines being drawn up the face
  float streak=fbm(vec2(dot(W.xz,uA)*0.12,dot(W.xz,uD)*1.6-t*0.9));
  foamIn+=face*ss(0.55,0.8,streak)*0.55*(1.-lip)*(1.-tube);
  vec3 col=mix(body,refl,fres*(1.-0.5*thin)*(1.-0.75*tube)*(1.-0.5*steepN));
  float rs=max(dot(R,uSunDir),0.);
  col+=uSunCol*(pow(rs,600.)*3.5+pow(rs,60.)*0.15)*(1.-ss(0.3,1.,foamIn));
  // foam
  float fn=fbm(W.xz*0.5+vec2(t*0.12,-t*0.05)+Ng.xz*2.);
  float fn2=fbm(W.xz*2.1-vec2(t*0.3,0.));
  float foam=foamIn;
  if(depth<1.8 && lip<0.5){
    float band=0.5+0.5*sin(dot(W.xz,uD)*0.55-t*1.1+fn*5.);
    foam+=ss(1.8,0.25,depth)*band*0.9;
  }
  float fm=ss(0.25,0.75,foam*(0.55+0.9*fn)+fn2*0.25-0.2+foam*0.25);
  fm=max(fm,ss(1.3,2.3,foam)*(0.75+0.25*fn2));
  // lumpy, self-shadowed whitewater rather than flat paint
  float lump=fbm(W.xz*0.9+vec2(-t*0.25,t*0.1));
  vec3 foamCol=vec3(0.93,0.96,1.0)*(0.55+0.4*dif)*(0.78+0.3*lump)+uSunCol*0.07*(lump)+uSSS*0.05*thin;
  col=mix(col,foamCol,clamp(fm,0.,1.));
  float fog=1.-exp(-sq(uFogDen*dist));
  col=mix(col,uFogCol,fog);
  return col;
}
`;

// ---------------------------------------------------------------------------
// Tileable ripple slope map (sum of random waves with integer wave numbers)
// ---------------------------------------------------------------------------
function makeRippleTexture(N = 256) {
  const waves = [];
  for (let i = 0; i < 70; i++) {
    let kx, kz;
    do { kx = Math.round(rand(-22, 22)); kz = Math.round(rand(-22, 22)); } while (kx * kx + kz * kz < 4);
    const k = Math.hypot(kx, kz);
    waves.push({ kx, kz, A: Math.pow(k, -1.35) * rand(0.5, 1), ph: rand(0, 6.283) });
  }
  const gx = new Float32Array(N * N), gz = new Float32Array(N * N);
  let mx = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let sx = 0, sz = 0;
    for (const w of waves) {
      const c = Math.cos((w.kx * i + w.kz * j) * 2 * Math.PI / N + w.ph) * w.A * 2 * Math.PI;
      sx += c * w.kx; sz += c * w.kz;
    }
    gx[j * N + i] = sx; gz[j * N + i] = sz;
    mx = Math.max(mx, Math.abs(sx), Math.abs(sz));
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(127.5 + 127 * gx[i] / mx);
    data[i * 4 + 1] = Math.round(127.5 + 127 * gz[i] / mx);
    data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
let rippleTex = null;

// ---------------------------------------------------------------------------
// Water meshes
// ---------------------------------------------------------------------------
export class Ocean {
  constructor(scene, waves, opts) {
    this.waves = waves;
    this.scene = scene;
    const a = waves.a, d = waves.d;
    const W0 = [], W1 = [];
    for (let i = 0; i < MAXW; i++) { W0.push(new THREE.Vector4()); W1.push(new THREE.Vector4(1, 0, 0, 0)); }
    const amb = [], ambW = [];
    for (const m of waves.amb) { amb.push(new THREE.Vector4(m.dx, m.dz, m.k, m.A)); ambW.push(new THREE.Vector2(m.w, m.ph)); }
    this.u = {
      uTime: { value: 0 }, uA: { value: new THREE.Vector2(a.x, a.z) }, uD: { value: new THREE.Vector2(d.x, d.z) },
      uW0: { value: W0 }, uW1: { value: W1 }, uAmb: { value: amb }, uAmbW: { value: ambW },
      uCenter: { value: new THREE.Vector2() }, uWarp: { value: new THREE.Vector4() },
      uDepth: { value: opts.depthTex }, uDepthXf: { value: opts.depthXf },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uSSS: { value: new THREE.Color() },
      uFogCol: opts.sky.u.uFogCol, uFogDen: opts.sky.u.uFogDen,
      uSunDir: opts.sky.u.uSunDir, uSunCol: opts.sky.u.uSunCol, uSkyTop: opts.sky.u.uSkyTop, uSkyHor: opts.sky.u.uSkyHor,
      uL0: { value: new THREE.Vector4() }, uL1: { value: new THREE.Vector4() },
      uRip: { value: rippleTex || (rippleTex = makeRippleTexture()) },
    };
    this.u.uDeep.value.setRGB(0.0, 0.045, 0.14);
    this.u.uShallow.value.setRGB(0.02, 0.3, 0.42);
    this.u.uSSS.value.setRGB(0.02, 0.52, 0.56);

    // near grid, aligned with the waves, dense near the centre
    const Na = opts.gridA, Nd = opts.gridD;
    const pos = new Float32Array((Na + 1) * (Nd + 1) * 3);
    let k = 0;
    for (let j = 0; j <= Nd; j++) for (let i = 0; i <= Na; i++) { pos[k++] = i / Na * 2 - 1; pos[k++] = 0; pos[k++] = j / Nd * 2 - 1; }
    const idx = [];
    for (let j = 0; j < Nd; j++) for (let i = 0; i < Na; i++) {
      const p = j * (Na + 1) + i;
      // (a, d) is a mirrored basis relative to (x, z), so wind the other way to face up
      idx.push(p, p + 1, p + Na + 1, p + 1, p + Na + 2, p + Na + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const ext = 2600;
    this.deltaA = 0.6; this.deltaD = 0.3;
    const Aa = this.deltaA * Na / 2, Ad = this.deltaD * Nd / 2;
    this.u.uWarp.value.set(Aa, ext - Aa, Ad, ext - Ad);
    const nearMat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */`
        ${WAVE_GLSL}
        uniform vec2 uCenter; uniform vec4 uWarp;
        varying vec3 vW; varying vec3 vN; varying float vFoam, vThin, vTube;
        float warp(float t,float A,float B){ float a=abs(t); float a2=a*a; return sign(t)*(A*a+B*a2*a2); }
        void main(){
          vec2 off=vec2(warp(position.x,uWarp.x,uWarp.y), warp(position.z,uWarp.z,uWarp.w));
          vec2 p=uCenter+uA*off.x+uD*off.y;
          float f,th,tb,f2,th2,tb2;
          float h=waveField(p,f,th,tb);
          float e=0.2+length(off)*0.006;
          float hx=waveField(p+vec2(e,0.),f2,th2,tb2);
          float hz=waveField(p+vec2(0.,e),f2,th2,tb2);
          vN=normalize(vec3(h-hx,e,h-hz));
          vW=vec3(p.x,h,p.y); vFoam=f; vThin=th*(1.-0.7*min(tb,1.)); vTube=tb;
          gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec2 uA, uD;
        float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
        float sq(float x){return x*x;}
        ${SKY_GLSL}
        ${WATER_FRAG_COMMON}
        varying vec3 vW; varying vec3 vN; varying float vFoam, vThin, vTube;
        void main(){
          gl_FragColor=vec4(shadeWater(vW,normalize(vN),vFoam,vThin,0.,vTube),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.near = new THREE.Mesh(g, nearMat);
    this.near.frustumCulled = false;
    scene.add(this.near);

    // far ocean: big flat disc under everything out to the horizon
    const farG = new THREE.CircleGeometry(60000, 96);
    farG.rotateX(-Math.PI / 2);
    const farMat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */`
        varying vec3 vW;
        void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec2 uA, uD;
        float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
        float sq(float x){return x*x;}
        ${SKY_GLSL}
        ${WATER_FRAG_COMMON}
        varying vec3 vW;
        void main(){
          gl_FragColor=vec4(shadeWater(vW,vec3(0.,1.,0.),0.,0.,0.,0.),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.far = new THREE.Mesh(farG, farMat);
    this.far.position.y = -0.35;
    this.far.renderOrder = -1;
    scene.add(this.far);

    // the throwing lip (one mesh per breaking wave, up to 2)
    const NS = 110, NT = 16;
    const lp = new Float32Array((NS + 1) * (NT + 1) * 3);
    k = 0;
    for (let j = 0; j <= NT; j++) for (let i = 0; i <= NS; i++) { lp[k++] = i / NS; lp[k++] = j / NT; lp[k++] = 0; }
    const lidx = [];
    for (let j = 0; j < NT; j++) for (let i = 0; i < NS; i++) {
      const p = j * (NS + 1) + i;
      lidx.push(p, p + 1, p + NS + 1, p + 1, p + NS + 2, p + NS + 1);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setIndex(lidx);
    this.lips = [];
    for (let n = 0; n < 2; n++) {
      const lu = { ...this.u, uL0: { value: new THREE.Vector4() }, uL1: { value: new THREE.Vector4() } };
      const lm = new THREE.ShaderMaterial({
        uniforms: lu, side: THREE.DoubleSide,
        vertexShader: /* glsl */`
          ${WAVE_GLSL}
          uniform vec4 uL0, uL1;
          varying vec3 vW; varying vec3 vN; varying float vFoam, vT, vCol;
          vec3 lipPos(float ds, float tau, out float T, out float col){
            vec4 A=uL0, B=uL1;
            float s=A.y+B.x*ds;
            float q=(s-A.w)*B.x;
            float env=exp(-sq(q/(q>0.?420.:70.)))*B.z;
            float sh=1.-0.5*ss(30.,280.,ds);
            float Hh=A.z*env*sh;
            float st=B.w*(1.-0.65*ss(10.,250.,ds));
            float Lf=max(A.z,0.3)*(3.2-2.2*st);
            T=B.y*(ds>=0.?1.-ss(0.,34.,ds):1.)*ss(0.9,1.4,A.z*env);
            col=ss(0.,-15.,ds);
            float tt=tau*T;
            float u=A.x-0.25+Lf*1.02*tt;
            float y=Hh*(1.+0.07*sin(3.14159*tt))-Hh*0.86*tt*tt+0.04;
            y=mix(y,Hh*0.3*(1.-tt*0.5)-0.8,col);
            vec2 p=uA*s+uD*u;
            return vec3(p.x,y+ambient(p),p.y);
          }
          void main(){
            float ds=-24.+68.*position.x;
            float T,c,T2,c2;
            vec3 P=lipPos(ds,position.y,T,c);
            vec3 P1=lipPos(ds+0.4,position.y,T2,c2);
            vec3 P2=lipPos(ds,position.y+0.03,T2,c2);
            vec3 n=cross(P2-P,P1-P);
            if(dot(n,n)<1e-10) n=vec3(0.,1.,0.);
            vN=normalize(n);
            vW=P; vT=position.y*T; vCol=c;
            vFoam=c*1.2+ss(0.75,1.,position.y)*T*0.6;
            gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);
          }`,
        fragmentShader: /* glsl */`
          uniform float uTime; uniform vec2 uA, uD;
          float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
          float sq(float x){return x*x;}
          ${SKY_GLSL}
          ${WATER_FRAG_COMMON}
          varying vec3 vW; varying vec3 vN; varying float vFoam, vT, vCol;
          void main(){
            vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n;
            float thin=0.9*(1.-vCol);
            vec3 c=shadeWater(vW,n,vFoam,thin*(gl_FrontFacing?1.:0.6),1.,gl_FrontFacing?0.:0.45);
            gl_FragColor=vec4(c,1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const mesh = new THREE.Mesh(lg, lm);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this.lips.push({ mesh, u: lu });
    }
  }

  update(t, focus) {
    this.u.uTime.value = t;
    this.waves.fill(this.u.uW0.value, this.u.uW1.value);
    // snap the grid centre to its own spacing so the near water doesn't swim
    const a = this.waves.a, d = this.waves.d;
    const s = Math.round((focus.x * a.x + focus.z * a.z) / this.deltaA) * this.deltaA;
    const u = Math.round((focus.x * d.x + focus.z * d.z) / this.deltaD) * this.deltaD;
    this.u.uCenter.value.set(a.x * s + d.x * u, a.z * s + d.z * u);
    // lips: the two breaking waves closest to the focus
    const fs = focus.x * a.x + focus.z * a.z, fu = focus.x * d.x + focus.z * d.z;
    const cands = this.waves.waves.filter((w) => w.bk > 0 && w.fade > 0 && w.H > 0.9)
      .sort((p, q) => Math.abs(p.uc - fu) - Math.abs(q.uc - fu));
    for (let i = 0; i < this.lips.length; i++) {
      const L = this.lips[i], w = cands[i];
      L.mesh.visible = !!w;
      if (!w) continue;
      L.u.uL0.value.set(w.uc, w.sb, w.H, w.s0);
      L.u.uL1.value.set(w.peel, w.bk, Math.max(0, w.fade), w.stNow);
    }
  }
}

// ---------------------------------------------------------------------------
// Spray / mist particles
// ---------------------------------------------------------------------------
// clumpy foam sprite: lots of overlapping soft bubbles with a ragged edge
function sprayTexture() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const a = r() * 6.283, d = Math.pow(r(), 0.7) * N * 0.33;
    const cx = N / 2 + Math.cos(a) * d, cy = N / 2 + Math.sin(a) * d, rad = N * (0.05 + r() * 0.11) * (1 - d / N);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, 6.283); x.fill();
  }
  for (let i = 0; i < 60; i++) { // stray droplets
    const a = r() * 6.283, d = N * (0.3 + r() * 0.18);
    x.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
    x.beginPath(); x.arc(N / 2 + Math.cos(a) * d, N / 2 + Math.sin(a) * d, 0.8 + r() * 1.8, 0, 6.283); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Spray {
  constructor(scene, sky, max) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.n = 0; this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1); this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    const seed = new Float32Array(max); for (let i = 0; i < max; i++) seed[i] = Math.random();
    g.setAttribute('position', this.aPos); g.setAttribute('size', this.aSize); g.setAttribute('alpha', this.aAlpha);
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uTex: { value: sprayTexture() }, uSunCol: sky.u.uSunCol, uSunDir: sky.u.uSunDir, uFogCol: sky.u.uFogCol, uFogDen: sky.u.uFogDen },
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute float seed; uniform float uScale;
        varying float vA; varying float vD; varying float vS;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv;
          gl_PointSize=min(size*uScale/max(-mv.z,0.5),320.); vA=alpha; vD=-mv.z; vS=seed; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunCol, uFogCol; uniform float uFogDen; uniform sampler2D uTex;
        varying float vA; varying float vD; varying float vS;
        void main(){ vec2 c=gl_PointCoord-0.5;
          float an=vS*6.283; c=mat2(cos(an),-sin(an),sin(an),cos(an))*c;
          vec4 tx=texture2D(uTex,c+0.5);
          float a=tx.a*vA*smoothstep(1.2,5.,vD)*1.5;
          if(a<0.01) discard;
          float lit=0.78+0.3*(0.5-gl_PointCoord.y);
          vec3 col=(vec3(0.93,0.96,1.0)*lit+uSunCol*0.14)*(0.95+0.1*vS);
          float fog=1.-exp(-(uFogDen*vD)*(uFogDen*vD));
          gl_FragColor=vec4(mix(col,uFogCol,fog),a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.renderOrder = 5;
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, size, life, grav = 1, alpha = 0.8) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grav[i] = grav; this.alpha[i] = alpha;
  }

  update(dt, waves) {
    const S = this.aSize.array, A = this.aAlpha.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { S[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= 9.8 * this.grav[i] * dt;
      const dr = Math.exp(-dt * (0.6 + (1 - this.grav[i]) * 1.5));
      this.vel[k] *= dr; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      S[i] = this.size[i] * (1.6 - 0.6 * f);
      A[i] = this.alpha[i] * Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 8 + 0.2);
      if (this.grav[i] > 0.5 && (i & 7) === 0) {
        const h = waves.height(this.pos[k], this.pos[k + 2]);
        if (this.pos[k + 1] < h - 0.3) this.life[i] = Math.min(this.life[i], 0.15);
      }
    }
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Foam trail left behind the board
// ---------------------------------------------------------------------------
export class Trail {
  constructor(scene, sky, n = 90) {
    this.n = n;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3); this.posA.setUsage(THREE.DynamicDrawUsage);
    this.alA = new THREE.BufferAttribute(new Float32Array(n * 2), 1); this.alA.setUsage(THREE.DynamicDrawUsage);
    this.sideA = new THREE.BufferAttribute(new Float32Array(n * 2), 1);
    for (let i = 0; i < n; i++) { this.sideA.array[i * 2] = -1; this.sideA.array[i * 2 + 1] = 1; }
    g.setAttribute('position', this.posA); g.setAttribute('alpha', this.alA); g.setAttribute('side', this.sideA);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const p = i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSunCol: sky.u.uSunCol },
      vertexShader: /* glsl */`attribute float alpha; attribute float side; varying float vA; varying float vS; varying vec3 vW;
        void main(){ vA=alpha; vS=side; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uSunCol; varying float vA; varying float vS; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
        void main(){ float e=1.-abs(vS); float n=h(floor(vW.xz*3.));
          float a=vA*smoothstep(0.,0.6,e)*(0.55+0.45*n);
          gl_FragColor=vec4(vec3(0.92,0.95,0.98)+uSunCol*0.05,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.acc = 0;
  }
  clear() { this.pts.length = 0; }
  update(dt, waves, src) {
    // src: {x,z,dirx,dirz,width,on}
    this.acc += dt;
    if (src && src.on && this.acc > 0.045) {
      this.acc = 0;
      this.pts.unshift({ x: src.x, z: src.z, px: -src.dirz, pz: src.dirx, w: src.width, life: 1 });
      if (this.pts.length > this.n) this.pts.pop();
    }
    const P = this.posA.array, A = this.alA.array;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i];
      if (!p) { A[i * 2] = A[i * 2 + 1] = 0; continue; }
      p.life -= dt / 3.2;
      p.w += dt * 0.5;
      const y = waves.height(p.x, p.z) + 0.06;
      P[i * 6] = p.x - p.px * p.w; P[i * 6 + 1] = y; P[i * 6 + 2] = p.z - p.pz * p.w;
      P[i * 6 + 3] = p.x + p.px * p.w; P[i * 6 + 4] = y; P[i * 6 + 5] = p.z + p.pz * p.w;
      const al = Math.max(0, p.life) * (i === 0 ? 0 : 0.7);
      A[i * 2] = A[i * 2 + 1] = al;
    }
    while (this.pts.length && this.pts[this.pts.length - 1].life <= 0) this.pts.pop();
    this.posA.needsUpdate = true; this.alA.needsUpdate = true;
  }
}
