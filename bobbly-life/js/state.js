// Shared game state and small helpers used by every module.
import * as THREE from 'three';

export const G = {
  scene: null, camera: null, renderer: null,
  time: 0, dayTime: 0.3, // 0..1, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
  started: false,
  player: null,
  characters: [],      // every Character (player, npcs, remotes)
  npcs: [],
  vehicles: [],
  props: [],
  trees: [],
  presents: [],
  fires: [],
  interacts: [],       // {pos, r, label(), action(), show()}
  sellZones: [],       // {min, max, accepts:{type: price}, name}
  remotes: new Map(),  // peerId -> Character
  locations: { houses: [], sidewalks: [] },
  job: null,
  ui: { panel: null, chatOpen: false, fishing: false, help: false },
  cam: { yaw: 0.6, pitch: 0.35, dist: 7, lastMouse: 0 },
  keys: {},
  mouse: { grab: false },
  net: { mode: 'solo', myId: 'me', code: null },
  save: null,
};

export const WATER_Y = -0.6;
export const LAND = 185;

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

export const COLORS = ['#ffcf4a', '#ff8a3d', '#ff5b6e', '#e05a8a', '#b46cff', '#6c7bff', '#3fa7ff', '#3fd6d0', '#46c25a', '#9be05a', '#ffffff', '#9aa4b1', '#4a4f5a', '#8b5a2b', '#f2c9a0', '#ffd6e8'];

const SAVE_KEY = 'bobblylife-save-v1';
export function defaultSave() {
  return {
    name: 'Bobbler' + Math.floor(Math.random() * 900 + 100),
    money: 100,
    outfit: { skin: '#ffcf4a', shirt: '#3fa7ff', pants: '#4a4f5a', hat: 'none', glasses: 'none', eyes: 'round' },
    ownedHats: ['none', 'cap'],
    ownedGlasses: ['none'],
    ownedCars: ['sedan'],
    house: false,
    presents: [],
    raceBest: 0,
    stats: { deliveries: 0, fires: 0, fish: 0, logs: 0, bags: 0, fares: 0 },
  };
}
export function loadSave() {
  let s = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      s = Object.assign(s, d);
      s.outfit = Object.assign(defaultSave().outfit, d.outfit || {});
      s.stats = Object.assign(defaultSave().stats, d.stats || {});
    }
  } catch (e) { /* storage blocked: play without saving */ }
  G.save = s;
  return s;
}
export function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.save)); } catch (e) { /* ignore */ }
}

// Scratch vectors (never keep references to these)
export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _q1 = new THREE.Quaternion();
export const UP = new THREE.Vector3(0, 1, 0);

// Cached materials by color so we don't make hundreds of duplicates.
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial(Object.assign({ color }, opts)));
  return matCache.get(key);
}

// Make a mesh span between two points (for limbs). Base geometry must be along Y with height 1.
export function placeBetween(mesh, a, b) {
  _v1.subVectors(b, a);
  const len = _v1.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-5) {
    _v1.multiplyScalar(1 / len);
    mesh.quaternion.setFromUnitVectors(UP, _v1);
  }
  mesh.scale.y = Math.max(len, 0.01);
}

// Text sprite (name tags, signs)
export function textSprite(text, { size = 48, color = '#fff', bg = 'rgba(0,0,0,0.45)', scale = 1 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `700 ${size}px Fredoka, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w; c.height = size * 1.5;
  ctx.font = `700 ${size}px Fredoka, sans-serif`;
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, 0, 0, c.width, c.height, size * 0.4); ctx.fill(); }
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sp.scale.set(c.width / c.height * 0.5 * scale, 0.5 * scale, 1);
  return sp;
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export function addMoney(n, why) {
  G.save.money = Math.max(0, Math.round(G.save.money + n));
  G.onMoney && G.onMoney(n, why);
  writeSave();
}
