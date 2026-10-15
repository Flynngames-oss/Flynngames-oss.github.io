// Sky dome, sun, clouds and the shared sky colour function used for water reflections.
import * as THREE from 'three';

// needs ss() defined before it is included
export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyHor;
vec3 skyColor(vec3 d){
  float y=max(d.y,0.);
  vec3 c=mix(uSkyHor,uSkyTop,pow(y,0.5));
  float sd=max(dot(d,uSunDir),0.);
  c+=uSunCol*(pow(sd,6.)*0.22+pow(sd,48.)*0.5);
  c=mix(c,uSkyHor*0.92,ss(0.0,-0.25,d.y));
  return c;
}
`;

export const TIMES = {
  morning: {
    label: 'Morning glass', sunEl: 24, sunAz: 115, exposure: 0.92,
    top: [0.10, 0.30, 0.62], hor: [0.62, 0.74, 0.86], sun: [1.0, 0.92, 0.78], fog: 0.00011,
    amb: 1.1, sunI: 2.6, hemiG: [0.45, 0.4, 0.33],
  },
  midday: {
    label: 'Midday sun', sunEl: 62, sunAz: 200, exposure: 0.88,
    top: [0.07, 0.24, 0.6], hor: [0.58, 0.72, 0.86], sun: [1.0, 0.97, 0.9], fog: 0.0001,
    amb: 1.1, sunI: 3.0, hemiG: [0.5, 0.44, 0.36],
  },
  sunset: {
    label: 'Famara sunset', sunEl: 7, sunAz: 292, exposure: 0.95,
    top: [0.13, 0.17, 0.36], hor: [0.98, 0.56, 0.34], sun: [1.0, 0.55, 0.25], fog: 0.00013,
    amb: 0.8, sunI: 2.2, hemiG: [0.42, 0.28, 0.22],
  },
};

export class Sky {
  constructor(scene) {
    this.u = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
      uSkyTop: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
      uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0.00005 }, uTime: { value: 0 },
    };
    const g = new THREE.SphereGeometry(1, 48, 24);
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: /* glsl */`varying vec3 vD; void main(){ vD=position; vec4 p=projectionMatrix*viewMatrix*(modelMatrix*vec4(position,1.)); gl_Position=p.xyww; }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
        ${SKY_GLSL}
        varying vec3 vD;
        float h2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
          return mix(mix(h2(i),h2(i+vec2(1,0)),u.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x),u.y); }
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.07+vec2(5.2,1.3); a*=.5; } return s; }
        void main(){
          vec3 d=normalize(vD);
          vec3 c=skyColor(d);
          float sd=max(dot(d,uSunDir),0.);
          c+=uSunCol*ss(0.9993,0.9997,sd)*4.;
          if(d.y>0.){
            vec2 uv=d.xz/(d.y+0.07)*0.9+vec2(uTime*0.004,uTime*0.002);
            float n=fbm(uv);
            float cl=ss(0.52,0.78,n)*ss(0.0,0.12,d.y);
            float lit=0.55+0.45*ss(0.3,0.9,fbm(uv+uSunDir.xz*0.06));
            vec3 cc=mix(uSkyHor*0.85+vec3(0.12),vec3(1.)*0.95,lit*0.6)+uSunCol*pow(sd,6.)*0.6;
            c=mix(c,cc,cl*0.85);
          }
          gl_FragColor=vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.scale.setScalar(40000);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7356, 0.8);
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(0xffffff, 0.00005);
  }

  set(key, scene, renderer) {
    const T = TIMES[key] || TIMES.morning;
    this.key = key;
    const el = THREE.MathUtils.degToRad(T.sunEl), az = THREE.MathUtils.degToRad(T.sunAz);
    // azimuth: 0 = north (-z), 90 = east (+x)
    this.u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.u.uSunCol.value.setRGB(...T.sun);
    this.u.uSkyTop.value.setRGB(...T.top);
    this.u.uSkyHor.value.setRGB(...T.hor);
    this.u.uFogCol.value.setRGB(...T.hor).multiplyScalar(0.92);
    this.u.uFogDen.value = T.fog;
    scene.fog.color.copy(this.u.uFogCol.value);
    scene.fog.density = T.fog;
    this.sun.color.setRGB(...T.sun);
    this.sun.intensity = T.sunI;
    this.hemi.color.setRGB(T.top[0] * 0.6 + 0.4, T.top[1] * 0.6 + 0.4, T.top[2] * 0.6 + 0.4);
    this.hemi.groundColor.setRGB(...T.hemiG);
    this.hemi.intensity = T.amb;
    renderer.toneMappingExposure = T.exposure;
  }

  update(camera, t) {
    this.mesh.position.copy(camera.position);
    this.u.uTime.value = t;
    this.sun.position.copy(camera.position).addScaledVector(this.u.uSunDir.value, 1000);
    this.sun.target.position.copy(camera.position);
  }
}
