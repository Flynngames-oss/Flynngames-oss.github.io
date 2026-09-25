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
