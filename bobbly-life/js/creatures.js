// Real animated 3D models walking around the island: little robot buddies in Bobbly Town that wave, dance and
// give you a thumbs up, and foxes trotting through the woods that run away if you get too close.
// Robot: "RobotExpressive" by Tomás Laulhé (Quaternius), CC0. Fox: model by PixelMannen (CC0), rigging and
// animation by tomkranis (CC-BY 4.0), glTF conversion by @AsoboStudio and @scurest (CC-BY 4.0).
import * as THREE from 'three';
import { G, rand, pick } from './state.js';
import { groundHeight } from './world.js';
import { heightAt } from './terrain.js';
import { FUNKY } from './terrain.js';
import { loadModel, spawnModel } from './gltf.js';
import { sfx } from './audio.js';

const buddies = [], foxes = [];
const SPOTS = [[0, -26], [22, -22], [-22, 22], [24, 24], [-26, -20], [0, 28], [30, 0], [-30, 2]];
const BUDDY_COLS = ['#ffd23f', '#5ab8ff', '#ff6fb8', '#7ae86a'];

export async function initCreatures() {
  try {
    const robot = await loadModel('robot');
    BUDDY_COLS.forEach((col, i) => {
      const m = spawnModel(robot, 1.9);
      // give each buddy its own colour
      m.root.traverse(o => { if (o.isMesh && o.material && /Main/i.test(o.material.name)) { o.material = o.material.clone(); o.material.color.set(col); } });
      const [x, z] = SPOTS[i * 2];
      m.obj.position.set(x, groundHeight(x, z, 50), z);
      G.scene.add(m.obj);
      m.play('Idle');
      const bd = { m, target: null, wait: rand(1, 5), waved: false, busy: 0, name: ['Bolt', 'Sprocket', 'Widget', 'Gizmo'][i] };
      buddies.push(bd);
      G.interacts.push({ get x() { return m.obj.position.x; }, get z() { return m.obj.position.z; }, r: 2.8, label: () => `🤖 High five ${bd.name}!`, action: () => highFive(bd) });
    });
  } catch (e) { console.warn('robot buddies unavailable', e); }
  try {
    const fox = await loadModel('fox');
    for (let i = 0; i < 9; i++) {
      const m = spawnModel(fox, 0.85);
      const home = i < 6 ? [FUNKY.x + rand(-200, 120), FUNKY.z + rand(-200, 200)] : [rand(-760, -520), rand(380, 640)];
      m.obj.position.set(home[0], heightAt(home[0], home[1]), home[1]);
      G.scene.add(m.obj);
      m.play('Survey');
      foxes.push({ m, home, target: null, wait: rand(1, 4), state: 'idle' });
    }
  } catch (e) { console.warn('foxes unavailable', e); }
}

const _v = new THREE.Vector3();
function steer(c, tx, tz, speed, dt) {
  const o = c.m.obj.position, dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
  if (d < 0.6) return true;
  const yaw = Math.atan2(dx, dz);
  let dy = yaw - c.m.obj.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  c.m.obj.rotation.y += dy * Math.min(1, dt * 6);
  o.x += dx / d * speed * dt; o.z += dz / d * speed * dt;
  return false;
}
export function updateCreatures(dt) {
  const P = G.player; if (!P) return;
  const pp = P.vehicle ? P.vehicle.pos : P.root, cam = G.camera.position;
  for (const b of buddies) {
    const o = b.m.obj.position, d = Math.hypot(o.x - cam.x, o.z - cam.z);
    b.m.obj.visible = d < 160;
    if (!b.m.obj.visible) continue;
    b.m.mixer.update(dt);
    const near = Math.hypot(pp.x - o.x, pp.z - o.z);
    if (b.busy > 0) { b.busy -= dt; if (b.busy <= 0) b.m.play('Idle'); continue; }
    if (near < 5 && !P.vehicle) {
      // turn to face you and wave (once each time you come over)
      const yaw = Math.atan2(pp.x - o.x, pp.z - o.z); b.m.obj.rotation.y += Math.atan2(Math.sin(yaw - b.m.obj.rotation.y), Math.cos(yaw - b.m.obj.rotation.y)) * Math.min(1, dt * 5);
      if (!b.waved) { b.waved = true; b.m.play('Wave', 0.2, true); b.busy = 2.2; }
      else b.m.play('Idle');
      b.target = null;
      continue;
    }
    if (near > 9) b.waved = false;
    if (!b.target) {
      b.wait -= dt;
      if (b.wait <= 0) { if (Math.random() < 0.2) { b.m.play('Dance'); b.busy = rand(3, 6); b.wait = rand(2, 5); } else { b.target = pick(SPOTS); b.m.play('Walking'); } }
    } else if (steer(b, b.target[0], b.target[1], 1.6, dt)) { b.target = null; b.wait = rand(2, 7); b.m.play('Idle'); }
    o.y = groundHeight(o.x, o.z, o.y + 2);
  }
  for (const f of foxes) {
    const o = f.m.obj.position, d = Math.hypot(o.x - cam.x, o.z - cam.z);
    f.m.obj.visible = d < 140;
    if (!f.m.obj.visible) continue;
    f.m.mixer.update(dt);
    const near = Math.hypot(pp.x - o.x, pp.z - o.z);
    if (near < 10 && f.state !== 'flee') {
      // run away!
      f.state = 'flee'; f.m.play('Run', 0.15);
      _v.set(o.x - pp.x, 0, o.z - pp.z).normalize().multiplyScalar(30);
      f.target = [o.x + _v.x, o.z + _v.z];
    }
    if (f.target) {
      if (steer(f, f.target[0], f.target[1], f.state === 'flee' ? 9 : 1.8, dt)) { f.target = null; f.state = 'idle'; f.wait = rand(2, 6); f.m.play('Survey'); }
    } else {
      f.wait -= dt;
      if (f.wait <= 0) { f.state = 'walk'; f.target = [f.home[0] + rand(-40, 40), f.home[1] + rand(-40, 40)]; f.m.play('Walk'); }
    }
    o.y = heightAt(o.x, o.z);
  }
}
// E next to a robot buddy: a high five
function highFive(b) { b.m.play(Math.random() < 0.5 ? 'ThumbsUp' : 'Yes', 0.15, true); b.busy = 2; sfx.pop && sfx.pop(); G.toast && G.toast(`🤖 ${b.name}: "Beep boop! High five!"`, null, 2500); }
