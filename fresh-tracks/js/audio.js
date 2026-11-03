// All sound is made with Web Audio: wind that builds with speed, the edge scraping and hissing as you
// carve, skids, landings, rails, crowd cheers at the venue and the lift clunking over towers.
export class Audio {
  constructor() { this.ok = false; this.vol = 0.8; }
  start() {
    if (this.ok) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(); this.ok = true;
    this.master = ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }
    this.noise = buf;
    const loop = (type, f, q, g) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const gn = ctx.createGain(); gn.gain.value = g; s.connect(fl); fl.connect(gn); gn.connect(this.master); s.start(); return { f: fl, g: gn };
    };
    this.wind = loop('bandpass', 500, 0.5, 0);
    this.ambient = loop('lowpass', 300, 0.3, 0.05);
    this.carve = loop('bandpass', 2200, 1.2, 0);
    this.skid = loop('bandpass', 900, 0.7, 0);
    this.rail = loop('bandpass', 3800, 6, 0);
    this.crowd = loop('bandpass', 1100, 0.4, 0);
  }
  setVolume(v) { this.vol = v; if (this.ok) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  update(p) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, set = (node, v, tc = 0.08) => node.setTargetAtTime(v, t, tc);
    const sp = Math.min(1, p.speed / 25);
    set(this.wind.g.gain, 0.02 + sp * sp * 0.5); set(this.wind.f.frequency, 300 + sp * 900);
    set(this.carve.g.gain, p.ground ? Math.min(0.28, sp * 0.18 + p.edge * 0.2) : 0, 0.04);
    set(this.carve.f.frequency, 1400 + sp * 2200 + p.edge * 800, 0.05);
    set(this.skid.g.gain, p.ground ? p.skid * Math.min(1, p.speed / 8) * 0.5 : 0, 0.04);
    set(this.rail.g.gain, p.rail ? 0.12 : 0, 0.03);
    set(this.crowd.g.gain, p.crowd * 0.25, 0.4);
  }
  burst(dur, freq, gain, type = 'lowpass', sweep = 0.3) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(50, freq * sweep), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain = 0.15, type = 'sine', slide = 1) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  pop() { this.burst(0.18, 1600, 0.25, 'bandpass', 0.6); this.tone(110, 0.12, 0.2, 'sine', 0.6); }
  land(k) { this.burst(0.35 + k * 0.3, 900, 0.35 + k * 0.4, 'lowpass', 0.15); this.tone(70, 0.2, 0.25 * k + 0.1, 'sine', 0.5); }
  crash() { this.burst(0.9, 1200, 0.7, 'lowpass', 0.1); this.burst(0.5, 3000, 0.3, 'bandpass', 0.3); }
  railOn() { this.tone(1800, 0.08, 0.12, 'square', 0.9); this.burst(0.12, 4000, 0.2, 'highpass', 0.8); }
  ding(hi = false) { this.tone(hi ? 1320 : 880, 0.25, 0.12, 'triangle'); setTimeout(() => this.tone(hi ? 1760 : 1320, 0.35, 0.1, 'triangle'), 90); }
  beep(hi) { this.tone(hi ? 1046 : 523, hi ? 0.5 : 0.18, 0.18, 'square'); }
  cheer(k = 1) { this.burst(2.4 * k, 1400, 0.45 * k, 'bandpass', 0.7); this.burst(1.6 * k, 2600, 0.2 * k, 'bandpass', 0.8); }
  clunk() { this.tone(140, 0.12, 0.18, 'square', 0.6); this.burst(0.15, 600, 0.2, 'lowpass', 0.3); }
}
