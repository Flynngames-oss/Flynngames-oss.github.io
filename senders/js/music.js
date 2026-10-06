// Senders — a little procedural electronic soundtrack. Each world has its own key, chord progression and
// tempo; the song moves through sections (intro, groove, drop, breakdown), and a filter on the whole mix
// opens up the faster you ride, so the music swells when you're sending it.
import { audio } from './audio.js';
import { mulberry32 } from './util.js';

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], major7: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor() { this.on = true; this.playing = false; this.def = null; this.intensity = 0.4; this.timer = null; }
  setup() {
    const ctx = audio.ctx; if (!ctx || this.out) return;
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 2500; this.filter.Q.value = 0.8;
    this.out.connect(this.filter); this.filter.connect(audio.music);
    // reverb & delay sends
    this.rev = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.rev.buffer = ir;
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.32; this.rev.connect(this.revGain); this.revGain.connect(this.out);
    this.delay = ctx.createDelay(1); this.fb = ctx.createGain(); this.fb.gain.value = 0.36;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl); dl.connect(this.fb); this.fb.connect(this.delay); dl.connect(this.out);
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
  }
  play(def, seed = 1) {
    if (!audio.ctx) return;
    this.setup();
    this.def = def; this.r = mulberry32(seed);
    this.spb = 60 / def.bpm / 4;      // seconds per 16th
    this.delay.delayTime.value = this.spb * 3;
    this.step = 0; this.bar = 0;
    this.next = this.ctx.currentTime + 0.1;
    this.makeSong();
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.8);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
    this.playing = true;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.playing = false; if (this.out) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); }
  toggle() {
    this.on = !this.on;
    if (this.out) this.out.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.3);
    return this.on;
  }
  setIntensity(x) {
    this.intensity = x;
    if (this.filter) this.filter.frequency.setTargetAtTime(700 + Math.pow(x, 1.5) * 9000, this.ctx.currentTime, 0.4);
  }
  makeSong() {
    const r = this.r;
    this.hatPat = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 1 : r() < 0.35 ? 0.5 : 0));
    this.bassPat = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : i % 4 === 2 ? (r() < 0.7 ? 1 : 0) : r() < 0.22 ? 1 : 0));
    this.arpOrder = [0, 1, 2, 3, 2, 1, 0, 2].map((x) => (r() < 0.2 ? (x + 1) % 4 : x));
    this.lead = Array.from({ length: 32 }, () => (r() < 0.32 ? Math.floor(r() * 5) : -1));
  }
  chord(barIdx) {
    const d = this.def, sc = SCALES[d.mode] || SCALES.major;
    const rootOff = d.prog[barIdx % d.prog.length];
    // scale degree that the chord root sits on (fallback: nearest)
    let deg = sc.indexOf(((rootOff % 12) + 12) % 12); if (deg < 0) deg = 0;
    const note = (k) => d.root + sc[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
    const notes = [note(0), note(2), note(4)];
    if (d.mode === 'major7' || d.mode === 'minor') notes.push(note(6));
    return notes;
  }
  tick() {
    if (!this.ctx || !this.def) return;
    while (this.next < this.ctx.currentTime + 0.15) { this.playStep(this.step, this.next); this.next += this.spb; this.step++; if (this.step % 16 === 0) this.bar++; }
  }
  playStep(step, t) {
    const s16 = step % 16, bar = Math.floor(step / 16), sec = Math.floor(bar / 8) % 4;  // 0 intro, 1 groove, 2 drop, 3 breakdown
    const ch = this.chord(Math.floor(bar / 2));
    const full = sec === 2 || (sec === 1 && bar % 8 >= 4);
    const drums = sec !== 0 && sec !== 3;
    const lift = this.intensity;
    if (s16 === 0) this.pad(t, ch, this.spb * 16);
    if (drums || (sec === 3 && bar % 8 >= 6)) {
      if (s16 % 4 === 0 && (full || s16 % 8 === 0)) this.kick(t);
      if (s16 === 4 || s16 === 12) this.snare(t, full ? 0.32 : 0.22);
    }
    if (sec !== 0 && this.hatPat[s16]) this.hat(t, this.hatPat[s16] * (0.6 + lift * 0.5), s16 === 14 && full);
    if (sec !== 3 && this.bassPat[s16]) this.bass(t, ch[0] - 24 + (s16 === 10 ? 12 : 0), this.spb * 2.2);
    if (sec !== 0 || bar % 8 >= 2) {
      if (s16 % 2 === 0) { const k = this.arpOrder[(s16 / 2) % 8]; this.pluck(t, ch[k % ch.length] + 12 + (k === 3 ? 12 : 0), 0.06 + lift * 0.03); }
    }
    if (sec === 2 && s16 % 4 === 0) {
      const l = this.lead[(bar % 2) * 16 / 4 * 4 + s16 / 4 + (bar % 4 < 2 ? 0 : 8)];
      if (l >= 0) this.leadNote(t, ch[l % ch.length] + 24 + (l === 4 ? 12 : 0), this.spb * 3);
    }
  }
  // ---- instruments
  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.4);
  }
  snare(t, v) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    s.connect(f); f.connect(g); g.connect(this.out); g.connect(this.rev); s.start(t, Math.random() * 0.5); s.stop(t + 0.25);
    const o = c.createOscillator(), og = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    og.gain.setValueAtTime(v * 0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(og); og.connect(this.out); o.start(t); o.stop(t + 0.12);
  }
  hat(t, v, open) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = c.createGain(); g.gain.setValueAtTime(0.09 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.22 : 0.04));
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random() * 0.5); s.stop(t + 0.3);
  }
  bass(t, m, dur) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'sine'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m - 12);
    f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(900 + this.intensity * 700, t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.out); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  pad(t, notes, dur) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.6); g.gain.setValueAtTime(0.05, t + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    f.connect(g); g.connect(this.out); g.connect(this.rev);
    for (const m of notes) for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.7);
    }
  }
  pluck(t, m, v) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'square'; o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(f); f.connect(g); g.connect(this.out); g.connect(this.delay); o.start(t); o.stop(t + 0.3);
  }
  leadNote(t, m, dur) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(m);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 4; lfo.connect(lg); lg.connect(o.detune);
    f.type = 'lowpass'; f.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.out); g.connect(this.delay); g.connect(this.rev);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }
}
