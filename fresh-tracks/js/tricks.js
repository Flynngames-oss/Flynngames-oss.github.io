// Names tricks the way riders and commentators do, and scores them (free ride points + judges' values).
export const GRABS = {
  indy: 'Indy', melon: 'Melon', mute: 'Mute', stalefish: 'Stalefish', nose: 'Nose Grab', tail: 'Tail Grab', method: 'Method',
};
export const GRAB_KEYS = { KeyA: 'indy', KeyS: 'melon', KeyD: 'nose', KeyF: 'tail', KeyQ: 'mute', KeyW: 'method', KeyR: 'stalefish' };
const MULT = ['', '', 'Double ', 'Triple ', 'Quad '];

export function trickName(t) {
  const parts = [];
  const g = t.grab && (t.grabs ? t.grabs[t.grab] : 0.3) > 0.12 ? GRABS[t.grab] : null;
  if (t.pipe) {
    if (t.flips >= 1) {
      parts.push(t.frontside ? 'Frontside' : 'Backside');
      parts.push((t.flips > 1 ? MULT[Math.min(4, t.flips)] : '') + (t.spin >= 540 ? 'Cork ' + t.spin : t.flipDir > 0 ? 'Rodeo ' + Math.max(540, t.spin) : 'McTwist'));
    } else if (t.spin <= 180) {
      if (t.alley) parts.push('Alley-Oop');
      parts.push(t.frontside ? 'Frontside' : 'Backside');
      parts.push(g ? '' : 'Air');
    } else {
      if (t.alley) parts.push('Alley-Oop');
      parts.push(t.sw ? (t.frontside ? 'Cab' : 'Switch Backside') : (t.frontside ? 'Frontside' : 'Backside'));
      parts.push(String(t.spin));
    }
    if (g) parts.push(g);
    return parts.filter(Boolean).join(' ');
  }
  const dir = t.sw ? (t.frontside ? 'Cab' : 'Switch Backside') : (t.frontside ? 'Frontside' : 'Backside');
  if (t.flips >= 1) {
    if (t.spin >= 360) { parts.push(dir); parts.push(MULT[Math.min(4, t.flips)] + 'Cork ' + t.spin); }
    else { if (t.sw) parts.push('Switch'); parts.push(MULT[Math.min(4, t.flips)] + (t.flipDir > 0 ? 'Backflip' : 'Frontflip')); }
  } else if (t.spin >= 180) {
    parts.push(dir); parts.push(String(t.spin));
  } else if (!g) {
    parts.push(t.sw ? 'Switch' : ''); parts.push(t.air > 0.55 ? 'Straight Air' : 'Ollie');
  } else if (t.sw) parts.push('Switch');
  if (g) parts.push(g);
  return parts.filter(Boolean).join(' ');
}

export function railName(e) {
  const base = e.slide === 'board' ? (e.type === 'box' ? 'Boardslide' : 'Boardslide') : '50-50';
  return (e.press > 0.3 ? (e.slide === '5050' ? 'Press ' : '') : '') + base + (e.type === 'box' ? ' (box)' : '');
}

// free ride points for one trick
export function trickPoints(t) {
  if (t.small && !t.spin && !t.flips && !t.grab) return 0;
  let p = 60 + t.air * 90;
  p += (t.pipe ? t.userSpin || 0 : t.spin) / 180 * 160;
  p += t.flips * 450;
  const gt = t.grab ? (t.grabs ? t.grabs[t.grab] : 0) : 0;
  if (gt > 0.12) p += 90 + gt * 220;
  p += t.height * 40;
  if (t.sw) p *= 1.15;
  if (t.quality === 'sketchy') p *= 0.5;
  return Math.round(p / 10) * 10;
}
export function railPoints(e) { return Math.round((80 + e.time * 260 + (e.slide === 'board' ? 60 : 0)) / 10) * 10; }

// what judges would give one trick (difficulty × execution × amplitude)
export function judgeValue(t, ev) {
  if (t.small && !t.spin && !t.flips && !(t.grab && t.grabT > 0.2)) return 0;
  const spin = t.pipe ? (t.userSpin || 0) + (t.spin >= 360 ? 0 : 0) : t.spin;
  let d = 4 + spin / 180 * (ev === 'bigair' ? 9 : 6.2) + t.flips * (ev === 'bigair' ? 15 : 11);
  if (t.flips && spin >= 540) d += 4;
  const gt = t.grab ? (t.grabs ? t.grabs[t.grab] : 0) : 0;
  if (gt > 0.12) d += 3 + Math.min(4, gt * 6);
  if (t.sw) d += 3;
  d += Math.min(10, t.height * (ev === 'pipe' ? 2.0 : 1.2));
  if (t.quality === 'sketchy') d *= 0.55;
  return d;
}
