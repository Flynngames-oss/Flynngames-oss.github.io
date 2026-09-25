// Tiny synthesized sound effects (no audio files needed).
let ctx = null, master = null;
let engine = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

function tone(type, f0, f1, dur, vol = 0.5, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.4, freq = 1200, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export const sfx = {
  jump: () => tone('sine', 300, 700, 0.18, 0.35),
  land: () => noise(0.08, 0.25, 500),
  coin: () => { tone('square', 988, 988, 0.08, 0.2); tone('square', 1319, 1319, 0.25, 0.2, 0.08); },
  slap: () => { noise(0.12, 0.6, 3000); tone('triangle', 220, 90, 0.12, 0.3); },
  ragdoll: () => { tone('sine', 500 + Math.random() * 200, 180, 0.5, 0.3); },
  boing: () => tone('sine', 200, 900, 0.3, 0.4),
  honk: () => { tone('square', 420, 420, 0.25, 0.15); tone('square', 520, 520, 0.25, 0.12); },
  crash: () => { noise(0.35, 0.7, 800); tone('sawtooth', 120, 40, 0.3, 0.3); },
  splash: () => noise(0.5, 0.5, 1800),
  pop: () => tone('sine', 600, 1200, 0.1, 0.3),
  chop: () => { noise(0.1, 0.6, 2200); tone('triangle', 160, 80, 0.1, 0.4); },
  bad: () => { tone('square', 300, 150, 0.35, 0.2); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.15, 0.18, i * 0.1)); },
  present: () => { [784, 988, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.12, 0.3, i * 0.07)); },
  door: () => tone('triangle', 300, 200, 0.12, 0.3),
  water: () => noise(0.06, 0.12, 4000),
  pew: () => tone('square', 900, 250, 0.1, 0.15),
  pop2: () => tone('triangle', 500, 150, 0.08, 0.25),
  whoosh: () => { noise(0.4, 0.3, 900); tone('sawtooth', 200, 600, 0.3, 0.08); },
  boom: () => { noise(0.8, 0.9, 600); tone('sine', 120, 30, 0.6, 0.5); [880, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.1, 0.12, 0.15 + i * 0.06)); },
  splat: () => noise(0.07, 0.3, 1500),
};

// Engine hum whose pitch follows vehicle speed.
export function setEngine(on, speed = 0, heli = false) {
  if (!ctx) return;
  if (on && !engine) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.value = 0.0;
    o.connect(f); f.connect(g); g.connect(master);
    o.start();
    engine = { o, g };
  }
  if (!engine) return;
  if (!on) { engine.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); return; }
  const base = heli ? 30 + Math.abs(speed) * 1.5 : 45 + Math.abs(speed) * 4;
  engine.o.frequency.setTargetAtTime(base, ctx.currentTime, 0.1);
  engine.g.gain.setTargetAtTime(0.08, ctx.currentTime, 0.1);
}

// ---------------------------------------------------------------- background music
// Laid-back lo-fi loop: warm 7th chords, soft bass, sparse electric-piano melody, dusty hats.
const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]; // Am7 Fmaj7 Cmaj7 G7
const SCALE = [69, 72, 74, 76, 79, 81, 84];
let musicOn = false, musicGain = null, nextT = 0, step = 0, timer = null, melodyNote = 3;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function note(type, freq, t, dur, vol, cutoff = 3000) {
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(musicGain);
  o.start(t); o.stop(t + dur + 0.05);
}
function hat(t, vol = 0.03) {
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 7000;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(musicGain); src.start(t);
}
function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 0.3);
}
function schedule() {
  const beat = 60 / 82 / 2; // eighth notes at 82 bpm, swung
  while (nextT < ctx.currentTime + 0.3) {
    const bar = Math.floor(step / 8) % 4, s8 = step % 8;
    const ch = CHORDS[bar];
    const t = nextT + (s8 % 2 ? beat * 0.12 : 0);
    if (s8 === 0) ch.forEach((m, k) => note('triangle', mtof(m), t + k * 0.012, beat * 7.8, 0.022, 1100));
    if (s8 === 0 || s8 === 5) note('sine', mtof(ch[0] - 12), t, beat * 2.5, 0.1, 400);
    if (s8 === 0 || s8 === 3 || s8 === 5) kick(t);
    if (s8 % 2 === 1) hat(t, 0.02); else if (s8 === 2 || s8 === 6) hat(t, 0.035);
    if (Math.random() < (s8 % 2 ? 0.18 : 0.3)) {
      melodyNote = Math.max(0, Math.min(SCALE.length - 1, melodyNote + Math.floor(Math.random() * 3) - 1));
      note('sine', mtof(SCALE[melodyNote]), t, beat * 2, 0.03, 1800);
    }
    nextT += beat; step++;
  }
}
export function setMusic(on) {
  if (!ctx) return;
  if (!musicGain) { musicGain = ctx.createGain(); musicGain.gain.value = 0.9; musicGain.connect(master); }
  musicOn = on;
  if (on && !timer) { nextT = ctx.currentTime + 0.1; timer = setInterval(schedule, 100); }
  if (!on && timer) { clearInterval(timer); timer = null; }
}
export const musicPlaying = () => musicOn;
