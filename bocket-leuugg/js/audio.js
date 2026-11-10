// Little synth sound effects: engine hum, boost roar, ball hits, goal horn, countdown beeps.
let ctx = null, master = null, engine = null, boostN = null;
export let muted = false;
try { muted = localStorage.getItem('bocket.mute') === '1'; } catch (e) { /* ignore */ }

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
  // engine: two detuned saws through a lowpass
  const g = ctx.createGain(); g.gain.value = 0;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; const o2 = ctx.createOscillator(); o2.type = 'square';
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start();
  engine = { g, f, o1, o2 };
  // boost: looping noise
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
  const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.7;
  const bg = ctx.createGain(); bg.gain.value = 0;
  src.connect(bf); bf.connect(bg); bg.connect(master); src.start();
  boostN = { g: bg, f: bf, buf: nb };
}
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('bocket.mute', m ? '1' : '0'); } catch (e) { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function engineUpdate(speed, throttle, boosting, on) {
  if (!ctx || !engine) return;
  const t = ctx.currentTime;
  const base = 55 + speed * 7 + Math.abs(throttle) * 12;
  engine.o1.frequency.setTargetAtTime(base, t, 0.05);
  engine.o2.frequency.setTargetAtTime(base * 0.502, t, 0.05);
  engine.f.frequency.setTargetAtTime(300 + speed * 50, t, 0.08);
  engine.g.gain.setTargetAtTime(on ? 0.045 + Math.abs(throttle) * 0.03 : 0, t, 0.08);
  boostN.g.gain.setTargetAtTime(on && boosting ? 0.16 : 0, t, 0.04);
  boostN.f.frequency.setTargetAtTime(700 + speed * 30, t, 0.1);
}

function noiseHit(vol, freq, dur, q = 1) {
  const src = ctx.createBufferSource(); src.buffer = boostN.buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, when = 0) {
  const o = ctx.createOscillator(); o.type = type; const g = ctx.createGain(); const t = ctx.currentTime + when;
  o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  hit(power) { if (!ctx) return; const v = Math.min(1, power / 30); noiseHit(0.25 + v * 0.5, 600 + v * 2500, 0.15 + v * 0.15); tone(110 + v * 60, 0.18, 'sine', 0.2 + v * 0.3, -60); },
  bounce(power) { if (!ctx) return; const v = Math.min(1, power / 25); noiseHit(0.08 + v * 0.2, 400 + v * 800, 0.12); },
  jump() { if (!ctx) return; noiseHit(0.08, 1500, 0.08); tone(220, 0.08, 'triangle', 0.05, 120); },
  pad(big) { if (!ctx) return; tone(big ? 520 : 760, big ? 0.25 : 0.1, 'triangle', big ? 0.12 : 0.06, big ? 500 : 200); },
  beep(hi) { if (!ctx) return; tone(hi ? 880 : 440, hi ? 0.5 : 0.18, 'square', 0.1); },
  goal() {
    if (!ctx) return;
    noiseHit(0.9, 3000, 1.2, 0.5);
    for (let i = 0; i < 3; i++) { tone(233, 1.4, 'sawtooth', 0.12, 0, i * 0.02); tone(294, 1.4, 'sawtooth', 0.1, 0, 0.01); tone(349, 1.4, 'sawtooth', 0.08); }
    // crowd roar
    noiseHit(0.5, 1200, 3.0, 0.3);
  },
  demo() { if (!ctx) return; noiseHit(0.8, 1800, 0.7); tone(90, 0.6, 'sawtooth', 0.3, -60); },
  whistle() { if (!ctx) return; tone(2100, 0.25, 'sine', 0.12, 0); tone(2100, 0.5, 'sine', 0.12, 0, 0.3); },
  chat() { if (!ctx) return; tone(990, 0.08, 'sine', 0.06); tone(1320, 0.1, 'sine', 0.05, 0, 0.06); },
};
