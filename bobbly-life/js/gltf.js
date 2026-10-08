// Loads real 3D models (glTF) once and hands out copies that can each play their own animations.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three';

const loader = new GLTFLoader();
const cache = new Map();
export const MODELS = { robot: 'assets/robot.glb', fox: 'assets/fox.glb' };
export function loadModel(name) {
  if (!cache.has(name)) cache.set(name, new Promise((res, rej) => loader.load(MODELS[name], res, undefined, rej)));
  return cache.get(name);
}
// a copy of the model, scaled so it's `height` metres tall, with an animation mixer and named actions
export function spawnModel(gltf, height) {
  const root = SkeletonUtils.clone(gltf.scene);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  // pose the skeleton first, otherwise skinned meshes measure the wrong size
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
  const box = new THREE.Box3().setFromObject(root, true), h = box.max.y - box.min.y || 1;
  const holder = new THREE.Group();
  root.scale.setScalar(height / h);
  root.position.y = -box.min.y * height / h;
  holder.add(root);
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  let cur = null;
  const play = (name, fade = 0.25, once = false) => {
    const a = actions[name]; if (!a || cur === a) return a;
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once;
    a.fadeIn(fade).play(); if (cur) cur.fadeOut(fade);
    cur = a; return a;
  };
  return { obj: holder, root, mixer, actions, play, current: () => cur };
}
