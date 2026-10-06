// Senders — controls. Keyboard, gamepad and touch all feed one control state.
//  Keyboard: W pedal · S brake · A/D steer (spin in the air) · ↑/↓ lean (manuals; flips in the air)
//            Space hold+release to pop · I/J/K/L tricks · U barspin · O tailwhip · R reset · C camera · Esc pause · M music
//  Gamepad:  RT pedal · LT brake · left stick steer/lean · A pop · right stick tricks · LB barspin · RB tailwhip
//            Y camera · B reset · Start pause
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.k = {}; this.edges = new Set();
    this.touch = { left: false, right: false, up: false, down: false, pedal: false, brake: false, jump: false, t1: false, t2: false, t3: false };
    this.padPrev = []; this.usingPad = false; this.usingTouch = false;
    this.state = { steer: 0, pedal: 0, brake: 0, lean: 0, spin: 0, jump: false, leanFresh: false, spinFresh: true,
      tricks: { up: false, down: false, left: false, right: false, whip: false, barspin: false } };
    this.blockW = false; this.blockS = false;
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.k[e.code]) this.edges.add(e.code);
      this.k[e.code] = true; this.usingPad = false;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.k[e.code] = false; });
    addEventListener('blur', () => { this.k = {}; });
  }
  pressed(code) { return this.edges.has(code); }
  // call when the bike leaves the ground: anything already held (pedalling, braking, steering into the lip,
  // leaning) won't start a flip or spin until it's let go and pressed again
  takeoff() {
    this.blockW = !!this.k.KeyW || this.touch.pedal; this.blockS = !!this.k.KeyS || this.touch.brake;
    this.blockLean = Math.abs(this.rawLean || 0) > 0.3; this.blockSpin = Math.abs(this.state.steer) > 0.25;
  }
  poll(airborne) {
    const k = this.k, s = this.state, t = this.touch;
    if (!k.KeyW && !t.pedal) this.blockW = false;
    if (!k.KeyS && !t.brake) this.blockS = false;
    let steer = (k.KeyD || k.ArrowRight || t.right ? 1 : 0) - (k.KeyA || k.ArrowLeft || t.left ? 1 : 0);
    let pedal = k.KeyW || t.pedal ? 1 : 0, brake = k.KeyS || t.brake ? 1 : 0;
    let lean = (k.ArrowUp || t.up ? 1 : 0) - (k.ArrowDown || t.down ? 1 : 0);
    let fresh = lean !== 0;
    if (airborne) {
      const w = k.KeyW && !this.blockW, sk = k.KeyS && !this.blockS;
      if (w || sk) { lean += (w ? 1 : 0) - (sk ? 1 : 0); fresh = true; }
    }
    let jump = !!(k.Space || t.jump);
    const tr = s.tricks;
    tr.up = !!(k.KeyI || t.t1); tr.down = !!k.KeyK; tr.left = !!(k.KeyJ || t.t2); tr.right = !!k.KeyL; tr.barspin = !!k.KeyU; tr.whip = !!(k.KeyO || t.t3);
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.padEdges = new Set();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const ax = dz(p.axes[0] || 0), ay = dz(p.axes[1] || 0), rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      const any = Math.abs(ax) + Math.abs(ay) + b(6) + b(7) + b(0) > 0.2;
      if (any) this.usingPad = true;
      steer = clamp(steer + ax, -1, 1);
      if (Math.abs(ay) > 0.15) { lean = clamp(lean - ay, -1, 1); fresh = true; }
      pedal = Math.max(pedal, b(7)); brake = Math.max(brake, b(6));
      if (b(0) > 0.5) jump = true;
      if (ry < -0.55) tr.up = true; if (ry > 0.55) tr.down = true; if (rx < -0.55) tr.left = true; if (rx > 0.55) tr.right = true;
      if (b(4) > 0.5) tr.barspin = true; if (b(5) > 0.5) tr.whip = true;
      if (b(2) > 0.5) tr.whip = true;
      const prev = this.padPrev[p.index] || [];
      const now = p.buttons.map((x) => x.pressed);
      const edge = (i, code) => { if (now[i] && !prev[i]) this.padEdges.add(code); };
      edge(3, 'cam'); edge(1, 'reset'); edge(9, 'pause'); edge(8, 'music'); edge(0, 'confirm'); edge(1, 'back');
      edge(12, 'up'); edge(13, 'down'); edge(14, 'left'); edge(15, 'right');
      this.padPrev[p.index] = now;
    }
    s.steer = clamp(steer, -1, 1); s.pedal = clamp(pedal, 0, 1); s.brake = clamp(brake, 0, 1);
    this.rawLean = lean;
    if (this.blockLean && Math.abs(lean) < 0.15) this.blockLean = false;
    if (this.blockSpin && Math.abs(s.steer) < 0.15) this.blockSpin = false;
    s.lean = this.blockLean ? 0 : clamp(lean, -1, 1); s.leanFresh = fresh && !this.blockLean;
    s.spin = s.steer; s.spinFresh = !this.blockSpin; s.jump = jump;
    return s;
  }
  action(name) {
    const e = this.edges, p = this.padEdges || new Set();
    switch (name) {
      case 'cam': return e.has('KeyC') || p.has('cam');
      case 'reset': return e.has('KeyR') || p.has('reset');
      case 'pause': return e.has('Escape') || e.has('KeyP') || p.has('pause');
      case 'music': return e.has('KeyM') || p.has('music');
      case 'confirm': return e.has('Enter') || p.has('confirm');
      case 'back': return e.has('Escape') || p.has('back');
      case 'hud': return e.has('KeyH');
      default: return false;
    }
  }
  endFrame() { this.edges.clear(); }
  bindTouch(root) {
    this.usingTouch = true;
    root.querySelectorAll('[data-t]').forEach((el) => {
      const key = el.dataset.t;
      const on = (e) => { e.preventDefault(); this.touch[key] = true; el.classList.add('on'); if (key === 'cam') this.edges.add('KeyC'); if (key === 'reset') this.edges.add('KeyR'); if (key === 'pause') this.edges.add('Escape'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    });
  }
}
