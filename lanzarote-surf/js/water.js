// Under the water: crystal-clear light absorption and caustics for everything below the surface,
// plus the reef (lava rock, sand, corals, sponges, sea fans, sea grass, urchins, starfish) and the
// fish, a turtle and a ray that swim around the line-up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const V3 = THREE.Vector3;

// shared by every material that can be seen underwater
export const UW = {
  uCamUnder: { value: 0 },
  uWaterCol: { value: new THREE.Color(0.012, 0.15, 0.21) },   // the colour light scatters to in deep water
  uSigma: { value: new V3(0.17, 0.048, 0.038) },               // absorption per metre (red goes first): about 30 m visibility
  uUWTime: { value: 0 },
  uUWSun: { value: new THREE.Color(1, 1, 1) },
};

export const CAUSTIC_GLSL = /* glsl */`
float causticF(vec2 uv, float time){
  vec2 p=mod(uv*6.2831853,6.2831853)-250.;
  vec2 i=p; float c=1.; float inten=.005;
  for(int n=0;n<4;n++){
    float t=time*(1.-(3.5/float(n+1)));
    i=p+vec2(cos(t-i.x)+sin(t+i.y),sin(t-i.y)+cos(t+i.x));
    c+=1./length(vec2(p.x/(sin(i.x+t)/inten),p.y/(cos(i.y+t)/inten)));
  }
  c/=4.; c=1.17-pow(c,1.4);
  return pow(abs(c),8.);
}`;

const UW_DECL = /* glsl */`
varying vec3 vUWP;
uniform float uCamUnder, uUWTime; uniform vec3 uWaterCol, uSigma, uUWSun;
${CAUSTIC_GLSL}
`;
// light reaching the depth of the object, sunlight caustics on anything facing up, and the water between
// it and your eyes (just the water under the surface when you're above it, all of it when you're under)
const UW_APPLY = /* glsl */`
{
  float dB=-vUWP.y;
  if(dB>-0.35){
    float k=smoothstep(-0.35,0.25,dB);
    vec3 Vv=cameraPosition-vUWP; float dist=length(Vv); Vv/=max(dist,1e-4);
    float viewL;
    if(uCamUnder>0.5) viewL=dist;
    else { float ci=clamp(Vv.y,0.02,1.); float ct=sqrt(max(0.,1.-(1.-ci*ci)/1.77)); viewL=max(dB,0.)/max(ct,0.12); }
    vec3 light=exp(-uSigma*max(dB,0.)*0.55);
    vec3 Tv=exp(-uSigma*viewL);
    vec3 upV=normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz);
    float up=max(dot(normal,upV),0.);
    float cs=causticF(vUWP.xz/4.2,uUWTime*0.5)*up*(1.-smoothstep(3.,20.,dB))*smoothstep(0.,0.6,dB);
    vec3 lit=outgoingLight*light*(0.85+0.15*up)+diffuseColor.rgb*uUWSun*cs*1.6*light;
    outgoingLight=mix(outgoingLight,lit*Tv+uWaterCol*(1.-Tv),k);
  }
}
`;
function inject(sh) {
  Object.assign(sh.uniforms, UW);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vUWP;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 uwp=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        uwp=instanceMatrix*uwp;
      #endif
      vUWP=(modelMatrix*uwp).xyz;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + UW_DECL)
    .replace('#include <opaque_fragment>', UW_APPLY + '\n#include <opaque_fragment>');
}
// make a (standard/physical) material look right under the water
export function patchUnderwater(mat) {
  if (!mat || mat.userData.uw || !(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return mat;
  mat.userData.uw = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); inject(sh); };
  const key = 'uw|' + prev.toString();
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
export function patchObject(obj) {
  obj.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(patchUnderwater); });
}

// ---------------------------------------------------------------------------
// reef geometry
// ---------------------------------------------------------------------------
function noise3(x, y, z) { return Math.sin(x * 1.7 + y * 2.3) * 0.5 + Math.sin(y * 3.1 - z * 1.3) * 0.3 + Math.sin(z * 2.7 + x * 0.9) * 0.2; }
function lumpy(geo, amt, f = 2) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + amt * noise3(x * f + 3.1, y * f, z * f - 1.7);
    p.setXYZ(i, x * n, y * n, z * n);
  }
  geo.computeVertexNormals();
  return geo;
}
function rockGeo() { const g = new THREE.IcosahedronGeometry(1, 2); lumpy(g, 0.32, 1.6); g.scale(1, 0.55, 1); g.translate(0, 0.15, 0); return g; }
function brainGeo() {
  const g = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { // the winding grooves of a brain coral
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.05 * Math.sin(x * 14 + Math.sin(z * 9) * 2.5) * Math.sin(z * 13 + Math.sin(x * 7) * 2);
    p.setXYZ(i, x * n, y * n * 0.75, z * n);
  }
  g.computeVertexNormals();
  return g;
}
function branchGeo(seed) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const parts = [];
  const grow = (o, dir, len, rad, depth) => {
    const end = o.clone().addScaledVector(dir, len);
    const c = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6, 1);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir));
    c.translate(o.x, o.y, o.z);
    parts.push(c);
    if (depth <= 0) { const tip = new THREE.SphereGeometry(rad * 0.75, 6, 4); tip.translate(end.x, end.y, end.z); parts.push(tip); return; }
    const n = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d2 = dir.clone().add(new V3(r() - 0.5, r() * 0.4, r() - 0.5).multiplyScalar(1.3)).normalize();
      grow(end, d2, len * (0.65 + r() * 0.2), rad * 0.7, depth - 1);
    }
  };
  for (let i = 0; i < 4; i++) grow(new V3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3), new V3((r() - 0.5) * 0.8, 1, (r() - 0.5) * 0.8).normalize(), 0.32, 0.07, 3);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed ? p.toNonIndexed() : p));
  g.computeVertexNormals();
  return g;
}
function tubeGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const h = rand(0.4, 1.1), r = rand(0.07, 0.12);
    const c = new THREE.CylinderGeometry(r, r * 0.8, h, 10, 1, true);
    c.translate(0, h / 2, 0); c.rotateZ(rand(-0.25, 0.25)); c.rotateX(rand(-0.25, 0.25));
    c.translate(rand(-0.18, 0.18), 0, rand(-0.18, 0.18));
    parts.push(c);
  }
  return mergeGeometries(parts);
}
function fanTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff'; x.lineCap = 'round';
  let s = 5; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const br = (px, py, a, len, w, d) => {
    const ex = px + Math.cos(a) * len, ey = py - Math.sin(a) * len;
    x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    if (d > 0) { br(ex, ey, a + 0.35 + r() * 0.2, len * 0.75, w * 0.7, d - 1); br(ex, ey, a - 0.35 - r() * 0.2, len * 0.75, w * 0.7, d - 1); }
  };
  br(64, 128, Math.PI / 2, 34, 6, 5);
  // the fine mesh between the branches
  x.globalAlpha = 0.55; x.lineWidth = 1;
  for (let i = 0; i < 60; i++) { const a = r() * Math.PI, rr = 20 + r() * 90; x.beginPath(); x.arc(64, 128, rr, Math.PI + 0.25, Math.PI * 2 - 0.25); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  return t;
}
function fanGeo() { const g = new THREE.PlaneGeometry(1.2, 1.2, 1, 1); g.translate(0, 0.6, 0); return g; }
function grassGeo() {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const h = rand(0.35, 0.9);
    const b = new THREE.PlaneGeometry(0.05, h, 1, 4);
    b.translate(0, h / 2, 0);
    const p = b.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, p.getZ(k) + (y * y) * 0.4); }
    b.rotateY(rand(0, Math.PI * 2));
    b.translate(rand(-0.2, 0.2), 0, rand(-0.2, 0.2));
    parts.push(b);
  }
  return mergeGeometries(parts);
}
function urchinGeo() {
  const parts = [new THREE.SphereGeometry(0.07, 10, 8)];
  const ico = new THREE.IcosahedronGeometry(1, 1).attributes.position;
  for (let i = 0; i < ico.count; i += 2) {
    const d = new V3(ico.getX(i), ico.getY(i), ico.getZ(i)).normalize();
    if (d.y < -0.3) continue;
    const c = new THREE.ConeGeometry(0.008, 0.22, 3);
    c.translate(0, 0.11 + 0.05, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d));
    parts.push(c.toNonIndexed());
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}
function starGeo() {
  const s = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, rr = k % 2 ? 0.045 : 0.13; k ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  return g;
}
function plateGeo() { const g = new THREE.CylinderGeometry(1, 0.25, 0.12, 20, 1); lumpy(g, 0.08, 3); g.translate(0, 0.25, 0); const st = new THREE.CylinderGeometry(0.12, 0.18, 0.25, 8); st.translate(0, 0.12, 0); return mergeGeometries([g.toNonIndexed(), st.toNonIndexed()]); }

// a fish pointing along +z (head) with its tail at -z; vertex colours give it a back, a belly and stripes
function fishGeo(sp) {
  const body = new THREE.SphereGeometry(0.5, 14, 10);
  body.deleteAttribute('uv');
  body.scale(sp.w, sp.h, 1);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.42, 0, 0.32 * sp.h * 2, -0.78, 0, -0.32 * sp.h * 2, -0.78, 0, 0, -0.42, 0, -0.32 * sp.h * 2, -0.78, 0, 0.32 * sp.h * 2, -0.78], 3));
  tail.computeVertexNormals();
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0, sp.h * 0.45, 0.2, 0, sp.h * (0.45 + sp.fin), -0.15, 0, sp.h * 0.4, -0.3, 0, sp.h * 0.45, 0.2, 0, sp.h * 0.4, -0.3, 0, sp.h * (0.45 + sp.fin), -0.15], 3));
  fin.computeVertexNormals();
  const g = mergeGeometries([body.toNonIndexed(), tail, fin]);
  const p = g.attributes.position, col = [];
  const A = new THREE.Color(sp.a), B = new THREE.Color(sp.b), belly = new THREE.Color(sp.belly || '#f4f1e6');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    let c = A.clone();
    if (sp.stripes && Math.sin((z + 0.5) * Math.PI * sp.stripes) > 0.55) c = B.clone();
    if (sp.fade) c.lerp(B, Math.min(1, Math.max(0, (0.3 - z) * 1.2)));
    if (z < -0.4 || Math.abs(y) > sp.h * 0.44) c = B.clone();          // tail and fins
    if (y < -sp.h * 0.12 && z > -0.4) c.lerp(belly, Math.min(1, (-y / sp.h - 0.12) * 2.2));
    if (z > 0.3 && Math.abs(y - sp.h * 0.08) < 0.06 && Math.abs(p.getX(i)) > sp.w * 0.3) c.setRGB(0.02, 0.02, 0.02); // eyes
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// Canary Islands reef fish
const SPECIES = [
  { name: 'Canary damsel', a: '#2b6fd6', b: '#0e3a8a', w: 0.32, h: 0.55, fin: 0.25, len: 0.16, n: 40, schools: 2, speed: 0.9 },
  { name: 'Ornate wrasse', a: '#2fb36a', b: '#e2403a', stripes: 3, w: 0.26, h: 0.4, fin: 0.12, len: 0.24, n: 14, schools: 2, speed: 1.2 },
  { name: 'Parrotfish', a: '#e8524f', b: '#6a2d7a', fade: true, w: 0.38, h: 0.5, fin: 0.15, len: 0.42, n: 10, schools: 2, speed: 0.7 },
  { name: 'Sergeant major', a: '#e8e46a', b: '#1b1d22', stripes: 5, w: 0.3, h: 0.6, fin: 0.25, len: 0.2, n: 30, schools: 2, speed: 1.0 },
  { name: 'Salema', a: '#c7cdd4', b: '#d8b02a', stripes: 8, w: 0.28, h: 0.42, fin: 0.15, len: 0.26, n: 70, schools: 2, speed: 1.3 },
  { name: 'Blue chromis', a: '#55c8ff', b: '#1a7fd0', w: 0.3, h: 0.5, fin: 0.2, len: 0.11, n: 60, schools: 3, speed: 1.1 },
  { name: 'Trumpetfish', a: '#d9a43b', b: '#7b4a22', w: 0.12, h: 0.14, fin: 0.3, len: 0.7, n: 4, schools: 2, speed: 0.6 },
];

function fishMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFishT = UW.uUWTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFishT; attribute float aPhase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float tl=clamp(0.25-position.z,0.,1.4); transformed.x+=sin(uFishT*(9.+aPhase*3.)+aPhase*6.283-position.z*4.)*0.13*tl*tl; }`);
  };
  return patchUnderwater(m);
}

// ---------------------------------------------------------------------------
export class Reef {
  // spot: wave frame, floor(x, z): sea floor height in scene coordinates
  constructor(scene, spot, floor, quality) {
    this.scene = scene; this.spot = spot; this.floor = floor;
    this.group = new THREE.Group();
    scene.add(this.group);
    const q = quality === 'low' ? 0.45 : quality === 'high' ? 1.3 : 1;
    const rocky = spot.id === 'famara' ? 0.35 : 1; // Famara is a sandy beach break, the others break over lava reef
    this.t = 0;
    const a = spot.a, d = spot.d;
    const toXZ = (s, u) => ({ x: a.x * s + d.x * u, z: a.z * s + d.z * u });
    // where to put things: mostly around the line-up and along the ride, some further out under the mega waves
    const place = (core) => {
      for (let tries = 0; tries < 20; tries++) {
        const s = core ? spot.peakS + rand(-70, 70) + (Math.random() < 0.5 ? rand(-90, 90) : 0) : spot.peakS + rand(-220, 220);
        const u = core ? spot.uBreak + rand(-45, 45) : rand(spot.uBreak - 260, spot.uEnd - 8);
        const p = toXZ(s, u);
        const f = floor(p.x, p.z);
        if (f < -1.2 && f > -40) return { x: p.x, z: p.z, y: f };
      }
      return null;
    };
    const dummy = new THREE.Object3D();
    const mk = (geo, mat, n, setup) => {
      n = Math.max(1, Math.round(n * q));
      const m = new THREE.InstancedMesh(geo, mat, n);
      let k = 0;
      for (let i = 0; i < n * 2 && k < n; i++) {
        const P = place(Math.random() < 0.65);
        if (!P) continue;
        const c = setup(dummy, P);
        if (!c) continue;
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
        m.setColorAt(k, new THREE.Color(c));
        k++;
      }
      m.count = k;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
      return m;
    };
    const std = (o = {}) => patchUnderwater(new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }));
    // lava rocks
    mk(rockGeo(), std({ roughness: 0.95, flatShading: true }), 360 * rocky + 80, (o, P) => {
      const s = rand(0.4, 2.6) * (Math.random() < 0.1 ? 2 : 1);
      o.position.set(P.x, P.y - s * 0.15, P.z); o.rotation.set(rand(-0.3, 0.3), rand(0, 6.28), rand(-0.3, 0.3)); o.scale.set(s * rand(0.8, 1.4), s * rand(0.6, 1.1), s);
      return pick(['#1d1b1a', '#2a2522', '#24261f', '#33302a', '#1f2a22']);
    });
    // brain and boulder corals
    mk(brainGeo(), std({ roughness: 0.7 }), 160, (o, P) => {
      const s = rand(0.25, 0.9); o.position.set(P.x, P.y - 0.05, P.z); o.rotation.set(0, rand(0, 6.28), 0); o.scale.setScalar(s);
      return pick(['#d8b46a', '#9fbf5a', '#e0c35a', '#c78f5e', '#7fa37a', '#e7a1b8']);
    });
    // branching coral (three shapes)
    for (let v = 0; v < 3; v++) mk(branchGeo(11 + v * 37), std({ roughness: 0.6 }), 110, (o, P) => {
      const s = rand(0.5, 1.4); o.position.set(P.x, P.y - 0.05, P.z); o.rotation.set(rand(-0.15, 0.15), rand(0, 6.28), rand(-0.15, 0.15)); o.scale.setScalar(s);
      return pick(['#ff8a3d', '#ff5f8f', '#c56bff', '#ffd23d', '#ff6a3a', '#7ad0ff', '#ffb3c7']);
    });
    // tube sponges
    mk(tubeGeo(), std({ roughness: 0.75, side: THREE.DoubleSide }), 120, (o, P) => {
      const s = rand(0.6, 1.3); o.position.set(P.x, P.y - 0.05, P.z); o.rotation.set(0, rand(0, 6.28), 0); o.scale.setScalar(s);
      return pick(['#ff9f1c', '#ffcc00', '#b04ad8', '#e8483a', '#4fc3c8']);
    });
    // plate corals
    mk(plateGeo(), std({ roughness: 0.7 }), 70, (o, P) => {
      const s = rand(0.4, 1.0); o.position.set(P.x, P.y - 0.05, P.z); o.rotation.set(rand(-0.2, 0.2), rand(0, 6.28), rand(-0.2, 0.2)); o.scale.set(s, s * rand(0.7, 1.2), s);
      return pick(['#8fb36a', '#c9a96e', '#6fb3a6', '#d68ab0']);
    });
    // sea fans
    const fanT = fanTexture();
    this.fans = mk(fanGeo(), swaying(std({ map: fanT, alphaMap: fanT, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8 }), 0.12), 120, (o, P) => {
      const s = rand(0.6, 1.5); o.position.set(P.x, P.y - 0.05, P.z); o.rotation.set(0, rand(0, 6.28), 0); o.scale.setScalar(s);
      return pick(['#b0306a', '#7e3fc0', '#e0522a', '#ffcc33']);
    });
    // sea grass meadows on the sand
    mk(grassGeo(), swaying(std({ side: THREE.DoubleSide, roughness: 0.8 }), 0.25), 520 * (2 - rocky), (o, P) => {
      if (P.y < -14) return null;
      const s = rand(0.7, 1.4); o.position.set(P.x, P.y - 0.03, P.z); o.rotation.set(0, rand(0, 6.28), 0); o.scale.setScalar(s);
      return pick(['#3f8f3a', '#5aa33e', '#6f9b2e', '#2f7a44']);
    });
    // long-spined sea urchins (there are loads on Lanzarote's reefs)
    mk(urchinGeo(), std({ roughness: 0.5, flatShading: true }), 420 * rocky, (o, P) => {
      const s = rand(0.7, 1.3); o.position.set(P.x, P.y + 0.02, P.z); o.rotation.set(0, rand(0, 6.28), 0); o.scale.setScalar(s);
      return pick(['#0c0c10', '#16121a', '#0c0c10']);
    });
    // starfish
    mk(starGeo(), std({ roughness: 0.6 }), 90, (o, P) => {
      const s = rand(0.8, 1.6); o.position.set(P.x, P.y + 0.03, P.z); o.rotation.set(0, rand(0, 6.28), 0); o.scale.setScalar(s);
      return pick(['#ff5a2a', '#e8342f', '#ffa13d', '#c2278f']);
    });

    // fish
    this.schools = [];
    const fm = fishMaterial();
    for (const sp of SPECIES) {
      const n = Math.max(2, Math.round(sp.n * q));
      const geo = fishGeo(sp);
      const ph = new Float32Array(n); for (let i = 0; i < n; i++) ph[i] = Math.random();
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
      const mesh = new THREE.InstancedMesh(geo, fm, n);
      mesh.frustumCulled = false;
      for (let i = 0; i < n; i++) mesh.setColorAt(i, new THREE.Color().setHSL(0, 0, rand(0.85, 1.1)));
      this.group.add(mesh);
      const per = Math.ceil(n / sp.schools);
      const fish = [];
      for (let i = 0; i < n; i++) {
        const r = sp.len * (sp.n > 20 ? 7 : 12);
        fish.push({ school: Math.floor(i / per), o: new V3(rand(-r, r), rand(-r, r) * 0.4, rand(-r, r)), ph: Math.random() * 6.28, f: rand(0.5, 1.5), p: new V3(), dir: new V3(0, 0, 1) });
      }
      const schools = [];
      for (let k = 0; k < sp.schools; k++) {
        const P = place(true) || { x: 0, y: -5, z: 0 };
        schools.push({ c: new V3(P.x, P.y + 1.5, P.z), v: new V3(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(sp.speed * 0.5), target: null, flee: 0 });
      }
      this.schools.push({ sp, mesh, fish, schools });
    }
    // a green turtle and an eagle ray cruising about
    this.turtle = makeTurtle(); this.group.add(this.turtle.g);
    this.ray = makeRay(); this.group.add(this.ray.g);
    for (const c of [this.turtle, this.ray]) { const P = place(true) || { x: 0, y: -6, z: 0 }; c.pos = new V3(P.x, P.y + 2, P.z); c.v = new V3(1, 0, 0); c.target = null; }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new V3(); this._up = new V3(0, 1, 0);
    this.place = place;
  }

  update(dt, t, player, waves) {
    this.t = t;
    UW.uUWTime.value = t;
    const m = this._m, qq = this._q, sc = this._s;
    for (const S of this.schools) {
      const { sp, mesh, fish, schools } = S;
      for (const sch of schools) {
        // wander between spots on the reef, and dart away from the surfer when they get close
        if (!sch.target || sch.c.distanceTo(sch.target) < 2) { const P = this.place(Math.random() < 0.8); if (P) sch.target = new V3(P.x, P.y + rand(0.8, 3), P.z); }
        const want = sch.target ? sch.target.clone().sub(sch.c).normalize().multiplyScalar(sp.speed) : sch.v;
        const dp = sch.c.distanceTo(player);
        if (dp < 5) { sch.flee = Math.min(1, sch.flee + dt * 3); want.add(sch.c.clone().sub(player).setY(0).normalize().multiplyScalar(sp.speed * 4)); }
        else sch.flee = Math.max(0, sch.flee - dt * 0.5);
        sch.v.lerp(want, 1 - Math.exp(-dt * (0.6 + sch.flee * 3)));
        sch.c.addScaledVector(sch.v, dt);
        // stay between the sea floor and under the waves
        const fl = this.floor(sch.c.x, sch.c.z), top = Math.min(-0.9, waves.height(sch.c.x, sch.c.z) - 1.0);
        sch.c.y = Math.min(Math.max(sch.c.y, fl + 0.5), Math.max(top, fl + 0.6));
      }
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i], sch = schools[f.school];
        const spread = 1 + sch.flee * 1.5;
        const tx = sch.c.x + f.o.x * spread + Math.sin(t * 0.7 * f.f + f.ph) * 0.4;
        const ty = sch.c.y + f.o.y * spread + Math.sin(t * 0.9 * f.f + f.ph * 2) * 0.15;
        const tz = sch.c.z + f.o.z * spread + Math.cos(t * 0.6 * f.f + f.ph) * 0.4;
        const ox = f.p.x, oy = f.p.y, oz = f.p.z;
        if (f.p.lengthSq() === 0) f.p.set(tx, ty, tz);
        f.p.x += (tx - f.p.x) * Math.min(1, dt * 2); f.p.y += (ty - f.p.y) * Math.min(1, dt * 2); f.p.z += (tz - f.p.z) * Math.min(1, dt * 2);
        const vx = f.p.x - ox, vy = f.p.y - oy, vz = f.p.z - oz;
        const sp2 = vx * vx + vz * vz;
        if (sp2 > 1e-8) f.dir.lerp(sc.set(vx, vy * 0.5, vz).normalize(), Math.min(1, dt * 4)).normalize();
        else f.dir.lerp(sc.copy(sch.v).normalize(), Math.min(1, dt * 2)).normalize();
        qq.setFromUnitVectors(Z, f.dir);
        sc.setScalar(sp.len);
        m.compose(f.p, qq, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const c of [this.turtle, this.ray]) {
      if (!c.target || c.pos.distanceTo(c.target) < 3) { const P = this.place(Math.random() < 0.6); if (P) c.target = new V3(P.x, P.y + rand(1, 2.5), P.z); }
      if (c.target) c.v.lerp(c.target.clone().sub(c.pos).normalize().multiplyScalar(c.speed), 1 - Math.exp(-dt * 0.3));
      c.pos.addScaledVector(c.v, dt);
      const fl = this.floor(c.pos.x, c.pos.z);
      c.pos.y = Math.min(Math.max(c.pos.y, fl + 0.7), Math.min(-1.2, waves.height(c.pos.x, c.pos.z) - 1.2));
      c.g.position.copy(c.pos);
      c.g.quaternion.setFromUnitVectors(Z, sc.copy(c.v).setY(c.v.y * 0.3).normalize());
      c.anim(t);
    }
  }
}
const Z = new V3(0, 0, 1);

// fans and grass sway in the surge
function swaying(mat, amt) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, r) {
    sh.uniforms.uSwayT = UW.uUWTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 ip=vec3(0.);
          #ifdef USE_INSTANCING
            ip=instanceMatrix[3].xyz;
          #endif
          float h=max(position.y,0.);
          float ph=ip.x*0.31+ip.z*0.17;
          transformed.x+=sin(uSwayT*1.3+ph)*${amt.toFixed(3)}*h*h;
          transformed.z+=cos(uSwayT*1.1+ph*1.3)*${(amt * 0.6).toFixed(3)}*h*h; }`);
    prev.call(this, sh, r);
  };
  const key = 'sway' + amt + (mat.customProgramCacheKey ? mat.customProgramCacheKey() : '');
  mat.customProgramCacheKey = () => key;
  return mat;
}

function makeTurtle() {
  const g = new THREE.Group();
  const shellM = patchUnderwater(new THREE.MeshStandardMaterial({ color: '#5b4a2a', roughness: 0.6 }));
  const skinM = patchUnderwater(new THREE.MeshStandardMaterial({ color: '#8a8a5a', roughness: 0.7 }));
  const shell = new THREE.Mesh(lumpy(new THREE.SphereGeometry(0.5, 16, 10), 0.04, 6), shellM); shell.scale.set(0.8, 0.32, 1);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 14, 8), skinM); belly.scale.set(0.75, 0.18, 0.95); belly.position.y = -0.06;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), skinM); head.scale.set(0.9, 0.8, 1.3); head.position.set(0, 0.02, 0.58);
  g.add(shell, belly, head);
  const flips = [];
  for (const [x, z, s] of [[-0.38, 0.22, 1], [0.38, 0.22, 1], [-0.3, -0.38, 0.6], [0.3, -0.38, 0.6]]) {
    const piv = new THREE.Group(); piv.position.set(x, -0.02, z);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 10, 6), skinM); f.scale.set(1.2, 0.12, 0.45); f.position.x = Math.sign(x) * 0.28 * s;
    f.rotation.y = Math.sign(x) * (z > 0 ? -0.5 : 0.4);
    piv.add(f); g.add(piv); flips.push(piv);
  }
  g.scale.setScalar(1.6);
  return { g, speed: 0.6, anim(t) { const a = Math.sin(t * 1.6); flips.forEach((p, i) => { p.rotation.z = (i % 2 ? -1 : 1) * (i < 2 ? a * 0.7 : a * 0.3); }); } };
}
function makeRay() {
  const g = new THREE.Group();
  const M = patchUnderwater(new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.6, side: THREE.DoubleSide }));
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8), M); body.scale.set(0.9, 0.22, 1.3);
  g.add(body);
  const wings = [];
  for (const sx of [-1, 1]) {
    const piv = new THREE.Group();
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, sx * 1.1, 0, -0.1, 0, 0, -0.35], 3));
    wg.computeVertexNormals();
    piv.add(new THREE.Mesh(wg, M)); g.add(piv); wings.push(piv);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.025, 1.4, 5), M); tail.rotation.x = Math.PI / 2; tail.position.z = -1.0;
  g.add(tail);
  g.scale.setScalar(1.3);
  return { g, speed: 0.9, anim(t) { const a = Math.sin(t * 1.8) * 0.45; wings[0].rotation.z = -a; wings[1].rotation.z = a; } };
}
