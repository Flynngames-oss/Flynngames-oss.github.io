// Keyboard, mouse, gamepads and touch, all turned into the same set of car buttons.
export const keys = new Set();
const tapped = new Set();
export const mouse = { left: false, right: false };
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!keys.has(e.code)) tapped.add(e.code);
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });
export function bindMouse(canvas) {
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.left = true; if (e.button === 2) mouse.right = true; });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
// true once per key press
export function tap(code) { if (tapped.has(code)) { tapped.delete(code); return true; } return false; }
export function endFrame() { tapped.clear(); padPrev = padNow.map((p) => p.slice()); }

const K = (c) => (keys.has(c) ? 1 : 0);
export const SCHEMES = {
  // single player: everything works
  all: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], slide: ['KeyC', 'KeyX'], rollL: ['KeyQ'], rollR: ['KeyE'], cam: ['KeyF', 'KeyY'], mouse: true },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], boost: ['ShiftLeft'], slide: ['KeyC'], rollL: ['KeyQ'], rollR: ['KeyE'], cam: ['KeyF'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['Enter', 'NumpadEnter'], boost: ['ShiftRight'], slide: ['Slash'], rollL: ['Comma'], rollR: ['Quote'], cam: ['Period'] },
};
const any = (list) => list.some((c) => keys.has(c));

// --- gamepads
let padNow = [], padPrev = [];
export function pollPads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  padNow = pads.map((p) => p.buttons.map((b) => b.value));
  return pads;
}
const dz = (v, d = 0.18) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

// --- touch
export const touch = { on: false, sx: 0, sy: 0, jump: false, boost: false, slide: false, camTap: false };

export function readInput(scheme, padIndex, out) {
  const s = SCHEMES[scheme];
  let throttle = 0, steer = 0, pitch = 0, jump = false, boost = false, slide = false, roll = 0, cam = false;
  if (s) {
    const ud = (any(s.up) ? 1 : 0) - (any(s.down) ? 1 : 0);
    throttle = ud; pitch = ud;
    steer = (any(s.right) ? 1 : 0) - (any(s.left) ? 1 : 0);
    jump = any(s.jump); boost = any(s.boost); slide = any(s.slide);
    roll = (any(s.rollR) ? 1 : 0) - (any(s.rollL) ? 1 : 0);
    for (const c of s.cam) if (tap(c)) cam = true;
    if (s.mouse) { if (mouse.left) boost = true; if (mouse.right) jump = true; }
  }
  if (padIndex >= 0) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const p = pads[padIndex];
    if (p) {
      const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const was = (i) => (padPrev[padIndex] ? padPrev[padIndex][i] > 0.5 : false);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      const t = b(7) - b(6);
      if (Math.abs(t) > Math.abs(throttle)) throttle = t;
      if (Math.abs(lx) > Math.abs(steer)) steer = lx;
      if (Math.abs(ly) > Math.abs(pitch)) pitch = -ly;
      jump = jump || b(0) > 0.5; boost = boost || b(1) > 0.5; slide = slide || b(2) > 0.5;
      if (b(4) > 0.5) roll = -1; if (b(5) > 0.5) roll = 1;
      if (b(3) > 0.5 && !was(3)) cam = true;
    }
  }
  if (touch.on && (scheme === 'all')) {
    if (Math.abs(touch.sx) > Math.abs(steer)) steer = touch.sx;
    if (Math.abs(touch.sy) > Math.abs(pitch)) { pitch = touch.sy; throttle = touch.sy; }
    jump = jump || touch.jump; boost = boost || touch.boost; slide = slide || touch.slide;
    if (touch.camTap) { cam = true; touch.camTap = false; }
  }
  out.throttle = Math.max(-1, Math.min(1, throttle));
  out.steer = Math.max(-1, Math.min(1, steer));
  out.pitch = Math.max(-1, Math.min(1, pitch));
  out.jump = jump; out.boost = boost; out.slide = slide; out.roll = roll;
  return cam;
}
export function padPressed(padIndex, btn) {
  const n = padNow[padIndex], p = padPrev[padIndex];
  return !!(n && n[btn] > 0.5 && !(p && p[btn] > 0.5));
}

// on-screen joystick and buttons
export function setupTouch(root) {
  const stick = root.querySelector('#tStick'), knob = root.querySelector('#tKnob');
  let sid = null, cx = 0, cy = 0;
  const R = 55;
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; sid = t.identifier;
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    move(t); e.preventDefault();
  }, { passive: false });
  const move = (t) => {
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.sx = dx / R; touch.sy = -dy / R;
  };
  addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === sid) move(t); }, { passive: true });
  const end = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; touch.sx = touch.sy = 0; knob.style.transform = ''; } };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  for (const [id, key] of [['tJump', 'jump'], ['tBoost', 'boost'], ['tSlide', 'slide']]) {
    const el = root.querySelector('#' + id);
    el.addEventListener('touchstart', (e) => { touch[key] = true; el.classList.add('down'); e.preventDefault(); }, { passive: false });
    const up = () => { touch[key] = false; el.classList.remove('down'); };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  }
  root.querySelector('#tCam').addEventListener('touchstart', (e) => { touch.camTap = true; e.preventDefault(); }, { passive: false });
}
