// All sound is synthesised with Web Audio: surf roar, board hiss, splashes, wind, chimes and a chill loop.
export class Audio {
  constructor() { this.ok = false; this.musicOn = true; this.sfxOn = true; }

  start() {
    if (this.ok) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.ok = true;
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.32; this.mus.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }
    this.noise = buf;
    const loopNoise = (type, freq, q, gain) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
      return { f, g };
    };
    this.ocean = loopNoise('lowpass', 420, 0.5, 0.25);
    this.roar = loopNoise('lowpass', 260, 0.7, 0);
    this.hiss = loopNoise('bandpass', 1800, 0.9, 0);
    this.wind = loopNoise('bandpass', 700, 0.6, 0);
    this.startMusic();
  }

  setMusic(on) { this.musicOn = on; if (this.ok) this.mus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.3); }
  setSfx(on) { this.sfxOn = on; if (this.ok) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1); }

  // continuous layers, called every frame
  update(p) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.ocean.g.gain.setTargetAtTime(0.18 + 0.08 * Math.sin(t * 0.4), t, 0.5);
    this.roar.g.gain.setTargetAtTime(Math.min(0.9, p.roar * 0.9), t, 0.15);
    this.roar.f.frequency.setTargetAtTime(180 + p.roar * 260, t, 0.2);
    this.hiss.g.gain.setTargetAtTime(Math.min(0.35, p.hiss * 0.35), t, 0.05);
    this.hiss.f.frequency.setTargetAtTime(900 + p.hiss * 1800, t, 0.05);
    this.wind.g.gain.setTargetAtTime(p.wind * 0.3, t, 0.1);
  }

  burst(dur = 0.6, freq = 900, gain = 0.5, type = 'lowpass', sweep = 0.3) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
  }
  splash(big = 1) { this.burst(0.9 * big, 2400, 0.7 * big, 'lowpass', 0.1); this.burst(0.5, 5000, 0.25 * big, 'highpass', 0.6); }
  spray(amt) { this.burst(0.25, 3500, 0.12 * amt, 'bandpass', 0.5); }

  tone(freq, dur, type = 'triangle', gain = 0.2, delay = 0, dest) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  chime(level = 1) {
    const base = [659, 784, 988, 1175, 1319];
    for (let i = 0; i < Math.min(5, 2 + level); i++) this.tone(base[i], 0.35, 'triangle', 0.12, i * 0.06);
  }
  big() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.6, 'square', 0.06, i * 0.08)); this.cheer(); }
  cheer() { this.burst(1.6, 1400, 0.25, 'bandpass', 0.8); }
  click() { this.tone(880, 0.06, 'square', 0.05); }
  bad() { this.tone(220, 0.3, 'sawtooth', 0.08); this.tone(165, 0.4, 'sawtooth', 0.08, 0.12); }
  horn() { this.tone(330, 0.9, 'sawtooth', 0.09); this.tone(415, 0.9, 'sawtooth', 0.07); }

  // a little laid-back loop: plucked chords, bass, soft drums
  startMusic() {
    const ctx = this.ctx;
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 60], [55, 59, 62, 67]];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const bpm = 92, beat = 60 / bpm;
    let next = ctx.currentTime + 0.2, step = 0;
    const tick = () => {
      if (!this.ok) return;
      while (next < ctx.currentTime + 0.4) {
        const bar = Math.floor(step / 8) % 4, s = step % 8;
        const ch = chords[bar];
        if (this.musicOn) {
          // pluck arpeggio
          const note = ch[[0, 2, 1, 3, 2, 1, 3, 2][s]] + 12;
          this.pluck(hz(note), next, 0.08);
          if (s === 0 || s === 3 || s === 6) this.pluck(hz(ch[0] - 12), next, 0.16, 'sine', 0.5);
          if (s === 0 || s === 4) this.kick(next);
          if (s === 2 || s === 6) this.hat(next, 0.05);
          if (s % 2 === 1) this.hat(next, 0.02);
        }
        next += beat / 2; step++;
      }
      this.musicTimer = setTimeout(tick, 120);
    };
    tick();
  }
  pluck(f, t, gain, type = 'triangle', dur = 0.35) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(2600, t); fl.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(this.mus); o.start(t); o.stop(t + dur + 0.05);
  }
  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.3);
  }
  hat(t, gain) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.mus); s.start(t, Math.random()); s.stop(t + 0.06);
  }
}
