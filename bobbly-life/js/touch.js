// Phone and tablet controls.
//  - Left side: a floating joystick that appears wherever your thumb lands.
//  - Right side: drag to look around, pinch with two fingers to zoom.
//  - Big action buttons (bottom right) that change with what you're doing: walking, armed, swimming, falling,
//    driving, riding a bike, flying a plane or a helicopter, the submarine, fishing...
//  - A "Use" button that says what it will do ("Drive Sports Car", "Shop for clothes") whenever there's
//    something to use, and a row of small buttons along the top (phone, map, blaster, camera, emotes, chat).
import { G, clamp } from './state.js';

const $ = (id) => document.getElementById(id);
// [key, label, icon, big]  (Grab = grab/throw, Fire = shoot while held)
const SETS = {
  foot: [['Space', 'Jump', '⤒', 1], ['Grab', 'Grab', '✋'], ['KeyF', 'Slap', '👋'], ['KeyR', 'Flop', '🌀']],
  armed: [['Space', 'Jump', '⤒', 1], ['Fire', 'Fire', '🎯'], ['KeyF', 'Slap', '👋'], ['KeyR', 'Flop', '🌀']],
  swim: [['Space', 'Swim up', '⤒', 1], ['KeyC', 'Dive', '⤓']],
  sky: [['Space', 'Parachute', '🪂', 1]],
  ragdoll: [['KeyR', 'Get up', '🧍', 1]],
  fish: [['Space', 'Reel in', '🎣', 1], ['Escape', 'Stop', '✖']],
  car: [['Space', 'Brake', '🛑', 1], ['KeyQ', 'Horn', '📯'], ['KeyE', 'Exit', '🚪']],
  bike: [['Space', 'Hop', '⤒', 1], ['ShiftLeft', 'Wheelie', '↺'], ['KeyC', 'Lean', '↻'], ['KeyE', 'Exit', '🚪']],
  train: [['KeyQ', 'Horn', '📯', 1], ['KeyE', 'Exit', '🚪']],
  plane: [['KeyW', 'Faster', '⏩', 1], ['KeyS', 'Slower', '⏪'], ['KeyE', 'Exit', '🚪']],
  fighter: [['Fire', 'Fire', '🎯', 1], ['KeyW', 'Faster', '⏩'], ['KeyS', 'Slower', '⏪'], ['KeyE', 'Exit', '🚪']],
  heli: [['Space', 'Up', '⤒', 1], ['ShiftLeft', 'Down', '⤓'], ['KeyE', 'Exit', '🚪']],
  sub: [['Space', 'Rise', '⤒', 1], ['KeyC', 'Dive', '⤓'], ['KeyE', 'Exit', '🚪']],
  passenger: [['KeyE', 'Exit', '🚪', 1]],
  none: [],
};
const EMOTES = [['Digit1', '👋'], ['Digit2', '💃'], ['Digit3', '🎉'], ['Digit4', '🪑']];

export const touch = { mx: 0, my: 0, look: null, reel: false, active: false, stickOn: false };
let A = null, curSet = '', curExtra = '', useText = '';

function buzz() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* not supported */ } }

export function modeOf(P) {
  if (G.ui.fishing) return 'fish';
  if (G.rocketRide || G.cableRide || G.slideRide || G.arrested) return 'none';
  const v = P.vehicle;
  if (v) {
    const t = v.type;
    if (P.seat !== 0 || v.remoteDriver || t.ride) return 'passenger';
    if (t.rail) return 'train';
    if (t.heli) return 'heli';
    if (t.plane) return t.fighter ? 'fighter' : 'plane';
    if (t.sub) return 'sub';
    if (t.isBike) return 'bike';
    return 'car';
  }
  if (P.ragdoll) return 'ragdoll';
  if (P.swimming || P.diving) return 'swim';
  if (P.chute || P.wingsuit) return 'sky';
  return P.weapon ? 'armed' : 'foot';
}

// press / release one control
function press(k) {
  const K = A.K, P = A.player;
  buzz(); A.initAudio();
  if (k === 'Grab') { if (P.weapon && !P.vehicle) { G.mouse.fire = true; return; } G.mouse.grabLock = false; G.mouse.grab = true; return; }
  if (k === 'Fire') { G.mouse.fire = true; return; }
  if (k === 'Space' && G.ui.fishing) { touch.reel = true; return; }
  K[k] = true; A.onKey(k);
}
function release(k) {
  const K = A.K;
  if (k === 'Grab' || k === 'Fire') { G.mouse.grab = false; G.mouse.fire = false; return; }
  K[k] = false;
  if (k === 'KeyR') A.player.holdRag = false;
  if (k === 'Space') touch.reel = false;
}
function bindHold(el, k) {
  let down = false;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (down) return; down = true; el.classList.add('on'); press(k); });
  const up = () => { if (!down) return; down = false; el.classList.remove('on'); release(k); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el._release = up;
}

function buildActions(name) {
  const box = $('tActions');
  for (const b of box.querySelectorAll('button')) b._release && b._release();
  box.innerHTML = '';
  const set = [...SETS[name]];
  if ((name === 'foot' || name === 'armed') && G.save.gadget === 'grapple') set.push(['KeyQ', 'Grapple', '🪝']);
  if ((name === 'foot' || name === 'armed') && G.save.gadget === 'jetpack') set[0] = ['Space', 'Jump / Jet', '🔥', 1];
  set.forEach(([k, label, icon, big], i) => {
    const b = document.createElement('button');
    b.className = 'tbtn' + (big ? ' big' : '') + ' p' + i;
    b.innerHTML = `<span class="ti">${icon}</span><span class="tl">${label}</span>`;
    bindHold(b, k);
    box.appendChild(b);
  });
}

export function initTouch(api) {
  A = api;
  document.body.classList.add('touch');
  const zone = $('tStickZone'), base = $('tStick'), knob = $('tKnob');
  // ---- floating joystick
  let sid = null, cx = 0, cy = 0;
  const R = () => Math.max(48, Math.min(70, Math.min(innerWidth, innerHeight) * 0.15));
  const place = (x, y) => { cx = x; cy = y; base.style.left = x + 'px'; base.style.top = y + 'px'; };
  const rest = () => { const r = R(); place(r + 34 + safe('left'), innerHeight - r - 34 - safe('bottom')); knob.style.transform = 'translate(-50%,-50%)'; base.classList.remove('on'); };
  const move = (e) => {
    const r = R();
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) { dx *= r / d; dy *= r / d; }
    // a small dead zone in the middle, then full range out to the edge of the ring
    const n = Math.hypot(dx, dy) || 1, m = Math.min(1, n / r), k = m < 0.12 ? 0 : (m - 0.12) / 0.88;
    touch.mx = dx / n * k; touch.my = -dy / n * k;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  zone.addEventListener('pointerdown', (e) => {
    if (sid !== null) return;
    e.preventDefault(); sid = e.pointerId; zone.setPointerCapture(sid); A.initAudio();
    place(e.clientX, e.clientY); base.classList.add('on'); touch.stickOn = true; move(e);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e); });
  const end = (e) => { if (e.pointerId !== sid) return; sid = null; touch.mx = touch.my = 0; touch.stickOn = false; rest(); };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  addEventListener('resize', () => { if (sid === null) rest(); });
  rest();

  // ---- look around (drag) and zoom (pinch) on the rest of the screen
  const canvas = A.canvas, pts = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); touch.look = null; }
    else if (pts.size === 1) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) G.cam.dist = clamp(G.cam.dist - (d - pinch) * 0.03, 3, 18);
      pinch = d; return;
    }
    if (!touch.look || e.pointerId !== touch.look.id) return;
    const s = 0.0062 * (G.save.lookSpeed || 1);
    G.cam.yaw -= (e.clientX - touch.look.x) * s;
    G.cam.pitch = clamp(G.cam.pitch + (e.clientY - touch.look.y) * s * 0.7, G.cam.fp ? -1.45 : -0.35, G.cam.fp ? 1.45 : 1.35);
    touch.look.x = e.clientX; touch.look.y = e.clientY; G.cam.lastMouse = G.time;
  });
  const endLook = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (touch.look && touch.look.id === e.pointerId) touch.look = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);

  // ---- the Use button
  const use = $('tUse');
  use.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); buzz(); A.initAudio(); A.onKey('KeyE'); });
  // ---- top row
  const top = { tPhone: 'Tab', tMap: 'KeyN', tGun: 'KeyG', tView: 'KeyV', tChat: 'KeyT' };
  for (const [id, k] of Object.entries(top)) $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); buzz(); A.initAudio(); A.onKey(k); });
  $('tMinimapHit').addEventListener('pointerdown', (e) => { e.preventDefault(); buzz(); A.onKey('KeyN'); });
  const emo = $('tEmotes');
  $('tEmote').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); buzz(); emo.classList.toggle('hidden'); });
  for (const [k, icon] of EMOTES) {
    const b = document.createElement('button'); b.textContent = icon;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); buzz(); A.onKey(k); emo.classList.add('hidden'); });
    emo.appendChild(b);
  }
  $('jobQuit') && $('jobQuit').addEventListener('pointerdown', (e) => { e.preventDefault(); A.onKey('KeyJ'); });
  // portrait tip (once per visit)
  // the tip shows once: gone when you tap OK or when it fades out by itself
  $('rotateOk').addEventListener('click', () => { $('rotateTip').classList.add('gone'); });
  $('rotateTip').addEventListener('animationend', () => { $('rotateTip').classList.add('gone'); });
}
function safe(side) { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sa-' + side)) || 0; }

// every frame: swap the buttons to suit what you're doing, show/hide the Use button
export function updateTouch(dt, promptHtml) {
  if (!A) return;
  const P = A.player, ui = G.ui;
  const hide = !G.started || !!ui.panel || !!ui.help || !!ui.chatOpen || !!G.cutscene;
  document.body.classList.toggle('touch-hide', hide);
  if (hide) { if (touch.stickOn || touch.mx || touch.my) { touch.mx = touch.my = 0; } return; }
  const m = modeOf(P), extra = (G.save.gadget || '') + (P.weapon ? 'w' : '');
  if (m !== curSet || extra !== curExtra) { curSet = m; curExtra = extra; buildActions(m); document.body.dataset.tmode = m; }
  // the Use button shows the prompt's action (only for "E" actions; driving has its own Exit button)
  let t = '';
  if (promptHtml && promptHtml.startsWith('<b>E</b>') && !P.vehicle) t = promptHtml.replace('<b>E</b>', '').trim();
  if (t !== useText) { useText = t; const u = $('tUse'); u.classList.toggle('hidden', !t); u.textContent = t; }
  $('tGun').classList.toggle('hidden', !(G.save.ownedWeapons && G.save.ownedWeapons.length) || !!P.vehicle);
  $('tChat').classList.toggle('hidden', G.net.mode === 'solo');
  // walking: the camera slowly swings round when you steer sideways, so you rarely need to drag it
  if (!P.vehicle && touch.stickOn && !touch.look && Math.abs(touch.mx) > 0.25) G.cam.yaw -= touch.mx * Math.min(1, Math.abs(touch.my) + 0.5) * dt * 1.15;
}
