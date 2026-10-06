// Senders — turns a Course into meshes: the detailed terrain chunks (with a cheaper far version of each),
// a huge low-detail backdrop of distant mountains, the dirt trail itself (a fine ribbon with tyre lines and
// pebbles that fades into the grass at its edges), wooden decks on the built ramps, and the lake.
import * as THREE from 'three';
import { GRID, CHUNK } from './course.js';
import { smoothstep, nextFrame, clamp } from './util.js';
import { dirtTextures, plankTextures, waterNormal } from './textures.js';
import { patchWorldPos } from './shaders.js';

const texCache = {};
function worldTex(world) {
  if (!texCache[world.id]) texCache[world.id] = dirtTextures(world);
  return texCache[world.id];
}
let planks = null;

export function terrainMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    patchWorldPos(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float fd = length(vViewPosition);
      float tn = svn(vWPos.xz * 0.07) * 0.5 + svn(vWPos.xz * 0.55) * 0.3;
      tn += (svn(vWPos.xz * 2.6) - 0.5) * 0.35 * smoothstep(90.0, 15.0, fd);
      diffuseColor.rgb *= 0.8 + 0.42 * tn;`);
  };
  return m;
}

function trailMaterial(world) {
  const { map, nrm } = worldTex(world);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, normalMap: nrm, normalScale: new THREE.Vector2(0.7, 0.7), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = { value: map };
    patchWorldPos(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float mixT;\nvarying float vMix;\nvarying vec2 vTUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = mixT; vTUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDirt;\nvarying float vMix;\nvarying vec2 vTUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fd = length(vViewPosition);
        float tn = svn(vWPos.xz * 0.07) * 0.5 + svn(vWPos.xz * 0.55) * 0.3 + (svn(vWPos.xz * 2.6) - 0.5) * 0.35 * smoothstep(90.0, 15.0, fd);
        vec3 ground = diffuseColor.rgb * (0.8 + 0.42 * tn);
        vec3 dirt = texture2D(uDirt, vTUv).rgb * (0.9 + 0.2 * svn(vWPos.xz * 0.15));
        float edge = svn(vWPos.xz * 0.9) * 0.55 + svn(vWPos.xz * 3.3) * 0.3;
        float m = smoothstep(0.25, 0.75, vMix * 1.35 - edge * 0.55 + 0.05);
        diffuseColor.rgb = mix(ground, dirt, m);`)
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP
        { vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0; mapN.xy *= normalScale * smoothstep(0.1, 0.6, vMix);
          normal = normalize( tbn * mapN ); }
        #endif`);
  };
  return m;
}

export async function buildTerrain(course, root, progress, quality) {
  const W = course.GW, H = course.GH, gh = course.gh, gr = course.gr, gd = course.gd;
  const out = { chunks: [], meshes: [], materials: [] };
  // ---- normals & colours for every grid vertex
  const nrm = new Float32Array(W * H * 3), col = new Float32Array(W * H * 3), tmp = [0, 0, 0];
  let t0 = performance.now();
  for (let j = 0; j < H; j++) {
    const z = course.gz0 + j * GRID;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const hl = gh[k - (i > 0 ? 1 : 0)], hr = gh[k + (i < W - 1 ? 1 : 0)], hd = gh[k - (j > 0 ? W : 0)], hu = gh[k + (j < H - 1 ? W : 0)];
      let nx = (hl - hr), ny = 2 * GRID, nz = (hd - hu);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nrm[k * 3] = nx; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = nz;
      course.groundColor(course.gx0 + i * GRID, z, gh[k], ny, gd[k], tmp);
      col[k * 3] = tmp[0]; col[k * 3 + 1] = tmp[1]; col[k * 3 + 2] = tmp[2];
    }
    if (performance.now() - t0 > 30) { progress(0.35 * j / H); await nextFrame(); t0 = performance.now(); }
  }
  course.gridColor = col;      // the grass uses these too

  // ---- detailed chunks (each has a full and a half resolution mesh, with skirts to hide LOD cracks)
  const tmat = terrainMaterial(); out.materials.push(tmat);
  const per = CHUNK / GRID;
  const nCx = (W - 1) / per, nCz = (H - 1) / per;
  function chunkGeo(ci, cj, step) {
    const n = per / step + 1, i0 = ci * per, j0 = cj * per;
    const nv = n * n + 4 * n;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cl = new Float32Array(nv * 3);
    const put = (v, gi, gj, drop) => {
      const k = gj * W + gi;
      pos[v * 3] = course.gx0 + gi * GRID; pos[v * 3 + 1] = gr[k] - drop; pos[v * 3 + 2] = course.gz0 + gj * GRID;
      nor[v * 3] = nrm[k * 3]; nor[v * 3 + 1] = nrm[k * 3 + 1]; nor[v * 3 + 2] = nrm[k * 3 + 2];
      cl[v * 3] = col[k * 3]; cl[v * 3 + 1] = col[k * 3 + 1]; cl[v * 3 + 2] = col[k * 3 + 2];
    };
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) put(b * n + a, i0 + a * step, j0 + b * step, 0);
    const skirt = n * n, drop = 5;
    for (let a = 0; a < n; a++) {
      put(skirt + a, i0 + a * step, j0, drop);                       // bottom edge
      put(skirt + n + a, i0 + a * step, j0 + (n - 1) * step, drop);  // top edge
      put(skirt + 2 * n + a, i0, j0 + a * step, drop);               // left edge
      put(skirt + 3 * n + a, i0 + (n - 1) * step, j0 + a * step, drop); // right edge
    }
    const idx = [];
    for (let b = 0; b < n - 1; b++) for (let a = 0; a < n - 1; a++) {
      const v0 = b * n + a, v1 = v0 + 1, v2 = v0 + n, v3 = v2 + 1;
      const d1 = Math.abs(pos[v0 * 3 + 1] - pos[v3 * 3 + 1]), d2 = Math.abs(pos[v1 * 3 + 1] - pos[v2 * 3 + 1]);
      if (d1 < d2) idx.push(v0, v2, v3, v0, v3, v1); else idx.push(v0, v2, v1, v1, v2, v3);
    }
    for (let a = 0; a < n - 1; a++) {
      let e0 = a, e1 = a + 1, s0 = skirt + a, s1 = skirt + a + 1; idx.push(e0, e1, s0, e1, s1, s0);
      e0 = (n - 1) * n + a; e1 = e0 + 1; s0 = skirt + n + a; s1 = s0 + 1; idx.push(e0, s0, e1, e1, s0, s1);
      e0 = a * n; e1 = (a + 1) * n; s0 = skirt + 2 * n + a; s1 = s0 + 1; idx.push(e0, s0, e1, e1, s0, s1);
      e0 = a * n + n - 1; e1 = (a + 1) * n + n - 1; s0 = skirt + 3 * n + a; s1 = s0 + 1; idx.push(e0, e1, s0, e1, s1, s0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  t0 = performance.now();
  for (let cj = 0; cj < nCz; cj++) {
    for (let ci = 0; ci < nCx; ci++) {
      const hi = new THREE.Mesh(chunkGeo(ci, cj, 1), tmat), lo = new THREE.Mesh(chunkGeo(ci, cj, 2), tmat);
      hi.receiveShadow = lo.receiveShadow = true;
      hi.matrixAutoUpdate = lo.matrixAutoUpdate = false;
      lo.visible = false;
      root.add(hi, lo);
      out.chunks.push({ hi, lo, x: course.gx0 + (ci + 0.5) * CHUNK, z: course.gz0 + (cj + 0.5) * CHUNK });
    }
    if (performance.now() - t0 > 30) { progress(0.35 + 0.35 * cj / nCz); await nextFrame(); t0 = performance.now(); }
  }

  // ---- far backdrop: the same landscape out to the horizon, with a hole where the detailed chunks are
  {
    const step = CHUNK, cxm = (course.gx0 + course.gx1) / 2;
    const fx0 = course.gx0 - Math.ceil(3400 / step) * step, fx1 = course.gx1 + Math.ceil(3400 / step) * step;
    const fz0 = course.gz0 - Math.ceil(1500 / step) * step, fz1 = course.gz1 + Math.ceil(3200 / step) * step;
    const nx = (fx1 - fx0) / step + 1, nz = (fz1 - fz0) / step + 1;
    const pos = [], nor = [], cl = [], idx = [];
    const vh = (x, z) => course.baseH(x, z);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = fx0 + i * step, z = fz0 + j * step, h = vh(x, z);
      const e = step * 0.5, ddx = vh(x - e, z) - vh(x + e, z), ddz = vh(x, z - e) - vh(x, z + e);
      const l = Math.hypot(ddx, 2 * e, ddz), ny = 2 * e / l;
      pos.push(x, h, z); nor.push(ddx / l, ny, ddz / l);
      course.groundColor(x, z, h, ny, 999, tmp); cl.push(tmp[0], tmp[1], tmp[2]);
    }
    const inside = (x, z) => x >= course.gx0 && x <= course.gx1 && z >= course.gz0 && z <= course.gz1;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const x = fx0 + (i + 0.5) * step, z = fz0 + (j + 0.5) * step;
      if (inside(x, z)) continue;
      const v0 = j * nx + i, v1 = v0 + 1, v2 = v0 + nx, v3 = v2 + 1;
      idx.push(v0, v2, v1, v1, v2, v3);
    }
    // skirt walls around the hole
    const addWall = (xa, za, xb, zb) => {
      const base = pos.length / 3;
      for (const [x, z] of [[xa, za], [xb, zb]]) { const h = vh(x, z); pos.push(x, h, z, x, h - 40, z); nor.push(0, 1, 0, 0, 1, 0); course.groundColor(x, z, h, 0.8, 999, tmp); cl.push(...tmp, ...tmp); }
      idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3, base, base + 2, base + 1, base + 2, base + 3, base + 1);
    };
    for (let x = course.gx0; x < course.gx1; x += step) { addWall(x, course.gz0, x + step, course.gz0); addWall(x, course.gz1, x + step, course.gz1); }
    for (let z = course.gz0; z < course.gz1; z += step) { addWall(course.gx0, z, course.gx0, z + step); addWall(course.gx1, z, course.gx1, z + step); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.setIndex(idx);
    const far = new THREE.Mesh(g, tmat);
    far.matrixAutoUpdate = false;
    root.add(far); out.meshes.push(far);
    void cxm;
  }
  progress(0.75); await nextFrame();

  // ---- the trail ribbon
  {
    const hw = course.hw, outer = course.outer;
    const cols = [-outer, -(hw + 3), -(hw + 2), -(hw + 1.25), -(hw + 0.6), -hw, -hw * 0.6, -hw * 0.22, 0, hw * 0.22, hw * 0.6, hw, hw + 0.6, hw + 1.25, hw + 2, hw + 3, outer];
    const NC = cols.length, ds = 0.5, rows = Math.floor((course.N - 1) / ds) + 1;
    const P = new Float32Array(rows * NC * 3), C = new Float32Array(rows * NC * 3), UV = new Float32Array(rows * NC * 2), MX = new Float32Array(rows * NC);
    t0 = performance.now();
    for (let r = 0; r < rows; r++) {
      const s = r * ds, ri = Math.min(course.N - 1, Math.round(s));
      const noTrack = course.NOTRACK[ri];
      for (let c = 0; c < NC; c++) {
        const d = cols[c], p = course.pointAt(s, d), k = r * NC + c;
        const h = course.heightAt(p.x, p.z);
        P[k * 3] = p.x; P[k * 3 + 1] = h; P[k * 3 + 2] = p.z;
        const ad = Math.abs(d);
        course.groundColor(p.x, p.z, h, ad > hw + 1 ? course.gridNormalY(p.x, p.z) : 0.97, ad, tmp);
        C[k * 3] = tmp[0]; C[k * 3 + 1] = tmp[1]; C[k * 3 + 2] = tmp[2];
        UV[k * 2] = d / (2 * hw) + 0.5; UV[k * 2 + 1] = s / (2 * hw);
        MX[k] = noTrack ? 0 : 1 - smoothstep(hw - 0.35, hw + 0.9, ad);
      }
      if (performance.now() - t0 > 30) { progress(0.75 + 0.15 * r / rows); await nextFrame(); t0 = performance.now(); }
    }
    // smooth normals over the whole ribbon
    const NRM = new Float32Array(rows * NC * 3);
    for (let r = 0; r < rows; r++) for (let c = 0; c < NC; c++) {
      const k = r * NC + c;
      const ka = (Math.max(0, r - 1)) * NC + c, kb = (Math.min(rows - 1, r + 1)) * NC + c;
      const kl = r * NC + Math.max(0, c - 1), kr = r * NC + Math.min(NC - 1, c + 1);
      const ax = P[kb * 3] - P[ka * 3], ay = P[kb * 3 + 1] - P[ka * 3 + 1], az = P[kb * 3 + 2] - P[ka * 3 + 2];
      const bx = P[kl * 3] - P[kr * 3], by = P[kl * 3 + 1] - P[kr * 3 + 1], bz = P[kl * 3 + 2] - P[kr * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      NRM[k * 3] = nx / l; NRM[k * 3 + 1] = ny / l; NRM[k * 3 + 2] = nz / l;
    }
    const mat = trailMaterial(course.world); out.materials.push(mat);
    const seg = 160;
    for (let r0 = 0; r0 < rows - 1; r0 += seg) {
      const r1 = Math.min(rows - 1, r0 + seg), nr = r1 - r0 + 1;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P.slice(r0 * NC * 3, (r1 + 1) * NC * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(NRM.slice(r0 * NC * 3, (r1 + 1) * NC * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(C.slice(r0 * NC * 3, (r1 + 1) * NC * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(UV.slice(r0 * NC * 2, (r1 + 1) * NC * 2), 2));
      g.setAttribute('mixT', new THREE.BufferAttribute(MX.slice(r0 * NC, (r1 + 1) * NC), 1));
      const idx = [];
      for (let r = 0; r < nr - 1; r++) for (let c = 0; c < NC - 1; c++) {
        const v0 = r * NC + c, v1 = v0 + 1, v2 = v0 + NC, v3 = v2 + 1;
        idx.push(v0, v2, v1, v1, v2, v3);
      }
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true; m.matrixAutoUpdate = false;
      root.add(m); out.meshes.push(m);
    }
  }
  progress(0.92); await nextFrame();

  // ---- wooden decks on built ramps and drops
  {
    if (!planks) planks = plankTextures();
    const wmat = new THREE.MeshLambertMaterial({ map: planks.map, normalMap: planks.nrm, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const smat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
    out.materials.push(wmat, smat);
    const runs = [];
    for (let i = 0; i < course.N; i++) {
      if (course.WOOD[i] && (i === 0 || !course.WOOD[i - 1])) runs.push([i, i]);
      if (course.WOOD[i]) runs[runs.length - 1][1] = i + 1;
    }
    const hw = course.hw - 0.1;
    for (const [a, b] of runs) {
      const pos = [], uv = [], idx = [], spos = [], sidx = [];
      const ds = 0.25, n = Math.round((b - a) / ds) + 1;
      for (let r = 0; r < n; r++) {
        const s = a + r * ds;
        for (const d of [-hw, hw]) {
          const p = course.pointAt(s, d);
          const ty = course.trackY(s) + course.bankAt(s) * d + 0.05;
          pos.push(p.x, ty, p.z); uv.push(d > 0 ? 1 : 0, s / 3);
          spos.push(p.x, ty + 0.12, p.z, p.x, ty - 0.9, p.z);
        }
        if (r < n - 1) {
          const v = r * 2; idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
          const q = r * 4;
          sidx.push(q, q + 4, q + 1, q + 1, q + 4, q + 5); // left side wall (both faces drawn via DoubleSide)
          sidx.push(q + 2, q + 3, q + 6, q + 3, q + 7, q + 6);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, wmat); m.receiveShadow = true; m.castShadow = false;
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
      sg.setIndex(sidx); sg.computeVertexNormals();
      const sm = new THREE.Mesh(sg, smat); smat.side = THREE.DoubleSide; sm.castShadow = true;
      root.add(m, sm); out.meshes.push(m, sm);
    }
  }

  // ---- lake
  if (course.lakeY > -1e8) {
    const wn = waterNormal();
    wn.repeat.set(180, 180);
    const wmat = new THREE.MeshStandardMaterial({ color: 0x2a5866, roughness: 0.08, metalness: 0.0, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.92 });
    const lake = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), wmat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set((course.gx0 + course.gx1) / 2, course.lakeY, course.zEnd + 400);
    root.add(lake); out.meshes.push(lake); out.materials.push(wmat);
    out.water = wn;
  }
  progress(1);

  out.update = (cam, dt) => {
    for (const c of out.chunks) {
      const dx = c.x - cam.x, dz = c.z - cam.z, far = dx * dx + dz * dz > 230 * 230;
      c.hi.visible = !far; c.lo.visible = far;
    }
    if (out.water) { out.water.offset.x += dt * 0.004; out.water.offset.y += dt * 0.006; }
  };
  void clamp;
  return out;
}
