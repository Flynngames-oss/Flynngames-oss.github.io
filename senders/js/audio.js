// Senders — all sound is synthesised live (no audio files): wind that roars as you speed up, tyre roar that
// changes with the surface (dirt, grass, rock, wooden decks, snow, sand), the buzz of the freehub when you
// coast, skids, chain slap, suspension thuds, crashes, a crowd that cheers when you pass, and UI blips.
let ctx = null;
export const audio = { ready: false };
let master, sfxBus, musicBus, comp, noiseBuf, brownBuf, tickBuf;
const L = {};   // continuous layers

function mkNoise(sec, brown = false) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
function mkTicks() {
  // one second of freehub clicks (40 per second at playbackRate 1)
  const sr = ctx.sampleRate, b = ctx.createBuffer(1, sr, sr), d = b.getChannelData(0);
  for (let k = 0; k < 40; k++) {
    const s0 = Math.floor(k / 40 * sr);
    for (let i = 0; i < sr * 0.004; i++) d[s0 + i] += (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.0007)) * 0.9;
  }
  return b;
}
function loop(buf, filterType, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(sfxBus); src.start();
  return { src, f, g };
}
const set = (param, v, tc = 0.06) => { if (ctx) param.setTargetAtTime(v, ctx.currentTime, tc); };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = 0.8;
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8;
  musicBus = ctx.createGain(); musicBus.gain.value = 0.5;
  sfxBus.connect(comp); musicBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
  noiseBuf = mkNoise(2); brownBuf = mkNoise(3, true); tickBuf = mkTicks();
  L.wind = loop(noiseBuf, 'lowpass', 400, 0.5);
  L.wind2 = loop(brownBuf, 'bandpass', 180, 0.7);
  L.roll = loop(brownBuf, 'bandpass', 300, 0.9);
  L.grit = loop(noiseBuf, 'bandpass', 2600, 1.2);
  L.skid = loop(noiseBuf, 'bandpass', 1400, 2.5);
  L.crowd = loop(noiseBuf, 'bandpass', 1100, 0.6);
  L.tick = (() => { const src = ctx.createBufferSource(); src.buffer = tickBuf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500; const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(sfxBus); src.start(); return { src, f, g }; })();
  L.chain = loop(noiseBuf, 'bandpass', 700, 4);
  audio.ready = true; audio.ctx = ctx; audio.music = musicBus;
  return ctx;
}
export function setVolumes(sfx, music) { if (!ctx) return; set(sfxBus.gain, sfx * 0.8, 0.1); set(musicBus.gain, music * 0.55, 0.1); }
export function suspend(on) { if (!ctx) return; if (on && ctx.state === 'running') ctx.suspend(); else if (!on && ctx.state === 'suspended') ctx.resume(); }

// st: { speed, grounded, surf, pedal, slip, brake, crowd, air, active }
export function updateAudio(st) {
  if (!ctx) return;
  const v = st.active ? st.speed : 0, g = st.active && st.grounded;
  const sp = Math.min(1, v / 22);
  set(L.wind.g.gain, sp * sp * 0.55); set(L.wind.f.frequency, 250 + v * 55);
  set(L.wind2.g.gain, sp * sp * 0.5);
  // surface
  const surf = st.surf;
  const rollF = { 0: 320, 1: 520, 2: 240, 3: 160, 4: 700, 5: 900 }[surf] || 320;
  const rollQ = { 0: 0.9, 1: 0.6, 2: 1.4, 3: 3, 4: 0.5, 5: 0.5 }[surf] || 0.9;
  set(L.roll.f.frequency, rollF + v * 12); L.roll.f.Q.value = rollQ;
  set(L.roll.g.gain, g ? Math.min(1, v / 12) * (surf === 3 ? 0.9 : 0.6) : 0, 0.03);
  set(L.grit.g.gain, g ? Math.min(1, v / 15) * ({ 0: 0.07, 1: 0.03, 2: 0.13, 3: 0.02, 4: 0.09, 5: 0.12 }[surf] || 0.06) : 0, 0.03);
  set(L.grit.f.frequency, surf === 4 ? 3800 : surf === 5 ? 3200 : 2400);
  set(L.skid.g.gain, g ? Math.min(0.5, st.slip * 0.9) * Math.min(1, v / 5) : 0, 0.04);
  // freehub ticks while coasting (and in the air, the wheel keeps spinning)
  const coast = st.active && st.pedal < 0.1 && v > 1.2;
  set(L.tick.g.gain, coast ? 0.22 : 0, 0.05);
  L.tick.src.playbackRate.setTargetAtTime(Math.max(0.15, Math.min(3, v / 7)), ctx.currentTime, 0.05);
  set(L.chain.g.gain, st.active && st.pedal > 0.1 && g ? 0.12 : 0, 0.08);
  set(L.chain.f.frequency, 500 + v * 30);
  set(L.crowd.g.gain, Math.min(0.5, st.crowd) * 0.5, 0.3);
}

function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(type, f0, f1, dur, vol, delay = 0, bus) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, 0.005, vol, dur); o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
function burst(dur, vol, type, freq, q = 1, delay = 0, buf) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, s = ctx.createBufferSource(); s.buffer = buf || noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.004, vol, dur);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
}

export const sfx = {
  land(impact, surf) {
    const k = Math.min(1.5, impact / 8);
    burst(0.25 + k * 0.2, 0.35 + k * 0.5, 'lowpass', surf === 3 ? 260 : 180, 1, 0, brownBuf);
    tone('sine', 90 + k * 30, 40, 0.18, 0.25 + k * 0.3);
    burst(0.12, 0.12 + k * 0.15, 'bandpass', surf === 3 ? 900 : 2200, 1.5);
    if (surf === 3) tone('triangle', 140, 90, 0.2, 0.25);
    burst(0.05, 0.08, 'highpass', 4000, 1, 0.03);  // chain slap
  },
  pop() { burst(0.08, 0.15, 'bandpass', 900, 1); tone('sine', 120, 70, 0.1, 0.12); },
  takeoff() { burst(0.4, 0.08, 'bandpass', 600, 0.6); },
  crash() {
    burst(0.5, 0.9, 'lowpass', 300, 1, 0, brownBuf); tone('sine', 100, 35, 0.35, 0.6);
    burst(0.2, 0.4, 'bandpass', 1800, 1.5, 0.08); burst(0.3, 0.5, 'lowpass', 250, 1, 0.22, brownBuf);
    for (let i = 0; i < 4; i++) tone('square', 900 + Math.random() * 1600, 500, 0.08, 0.05, 0.05 + i * 0.09);
    burst(0.4, 0.3, 'lowpass', 220, 1, 0.45, brownBuf);
  },
  whoosh() { burst(0.35, 0.18, 'bandpass', 1200, 0.8); },
  trick() { tone('triangle', 880, 880, 0.08, 0.12); tone('triangle', 1320, 1320, 0.12, 0.1, 0.06); },
  bank(big) { [659, 784, 988, 1319].slice(0, big ? 4 : 3).forEach((f, i) => tone('triangle', f, f, 0.14, 0.16, i * 0.07)); },
  lost() { tone('sawtooth', 300, 120, 0.35, 0.12); },
  checkpoint() { tone('sine', 880, 880, 0.12, 0.2); tone('sine', 1320, 1320, 0.2, 0.2, 0.1); },
  count() { tone('square', 440, 440, 0.12, 0.12); },
  go() { tone('square', 880, 880, 0.35, 0.16); tone('square', 1320, 1320, 0.35, 0.08); },
  objective() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.18, i * 0.075)); },
  life() { [784, 1047, 1568].forEach((f, i) => tone('sine', f, f, 0.2, 0.2, i * 0.1)); },
  lifeLost() { tone('sine', 330, 160, 0.5, 0.25); tone('sine', 220, 110, 0.6, 0.2, 0.1); },
  finish() { [523, 659, 784, 1047].forEach((f, i) => { tone('square', f, f, 0.3, 0.08, i * 0.12); tone('triangle', f * 2, f * 2, 0.3, 0.06, i * 0.12); }); },
  click() { tone('sine', 1200, 900, 0.05, 0.08); },
  hover() { tone('sine', 1800, 1600, 0.03, 0.03); },
  cheer(k = 1) {
    if (!ctx) return;
    burst(1.6, 0.25 * k, 'bandpass', 1000, 0.5);
    burst(1.2, 0.18 * k, 'bandpass', 1900, 0.8, 0.1);
    for (let i = 0; i < 3 * k; i++) tone('sine', 1800 + Math.random() * 900, 2400 + Math.random() * 800, 0.25, 0.05, Math.random() * 0.8);
  },
  wood() { tone('triangle', 180, 120, 0.12, 0.15); },
};
