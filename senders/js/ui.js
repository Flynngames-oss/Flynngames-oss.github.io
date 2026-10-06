// Senders — menus and HUD. Plain DOM, built from the data the game hands over.
import { WORLDS } from './worlds.js';
import { fmtNum, fmtTime } from './util.js';
import { MAX_LIVES, START_LIVES, COLOR_SETS, rankOf } from './career.js';

export const $ = (id) => document.getElementById(id);
const SCREENS = ['title', 'worlds', 'map', 'gen', 'hud', 'intro', 'pause', 'results', 'riderPanel', 'settings', 'controls'];
export function show(...ids) { for (const id of SCREENS) $(id).classList.toggle('hidden', !ids.includes(id)); }
export function showOnly(id, on = true) { $(id).classList.toggle('hidden', !on); }

export const TIPS = [
  'Hold Space to crouch, then release right at the lip of a jump to pop higher.',
  'Land with your wheels lined up with the slope for a PERFECT landing and a bigger multiplier.',
  'Let go of a trick before you touch down — landing mid-Superman always ends badly.',
  'Every bail costs a life. Finish a trail\'s bonus objective to win one back.',
  'Tricks chain into combos. The multiplier grows with every different trick — bail and you lose the lot.',
  'Hold ↓ on the ground to pull a manual. Balance it for combo points.',
  'Brake before tight corners — the berms help, but they can\'t do everything.',
  'Come up short on a gap jump and you\'ll eat the landing. Pedal into the big ones!',
  'Riding close past trees at speed scores Close Calls.',
  'Steep trails are fast. Curvy trails are technical. Stunt trails are full of jumps.',
  'The boss jump at the end of each world is huge. Full send, no brakes.',
  'Press C to switch cameras — try the helmet cam on a forest run.',
  'Plug in a controller: Descenders-style controls with triggers and sticks.',
];

export function hearts(el, lives, max = Math.max(START_LIVES, lives)) {
  let h = '';
  for (let i = 0; i < Math.min(MAX_LIVES, max); i++) h += `<span class="heart${i < lives ? '' : ' empty'}">♥</span>`;
  el.innerHTML = h;
}
function pips(n) { let s = '<div class="pips">'; for (let i = 1; i <= 5; i++) s += `<span class="pip${i <= n ? ' on' : ''}"></span>`; return s + '</div>'; }
export function ratings(opt) {
  return `<div class="rt"><span>Steep</span>${pips(opt.steep)}<span>Curvy</span>${pips(opt.curvy)}<span>Stunts</span>${pips(opt.stunts)}</div>`;
}
function worldBg(w) {
  const c = (h) => '#' + h.toString(16).padStart(6, '0');
  return `linear-gradient(180deg, ${c(w.sky.zenith)} 0%, ${c(w.sky.horizon)} 48%, ${c(w.colors.grassB)} 52%, ${c(w.colors.forest)} 100%)`;
}

export function worldGrid(title, unlocked, done, onPick) {
  $('worldsTitle').textContent = title;
  const g = $('worldGrid'); g.innerHTML = '';
  WORLDS.forEach((w, i) => {
    const el = document.createElement('div');
    const locked = i > unlocked;
    el.className = 'wcard' + (locked ? ' locked' : '');
    el.style.background = worldBg(w);
    el.innerHTML = `<div class="wnum">${i + 1}</div>${locked ? '<div class="lock">🔒 Beat world ' + i + '</div>' : done && done[i] ? '<div class="badge">Boss beaten</div>' : ''}<h2>${w.name}</h2><p>${w.tag}</p>`;
    if (!locked) el.onclick = () => onPick(i);
    g.appendChild(el);
  });
}

export function careerMap(career, optionsFor, selected, onSelect) {
  const w = WORLDS[career.world];
  $('mapWorldNo').textContent = `World ${career.world + 1} of ${WORLDS.length}`;
  $('mapWorld').textContent = w.name; $('mapTag').textContent = w.tag;
  hearts($('mapLives'), career.lives); $('mapRep').textContent = fmtNum(career.rep);
  const cols = $('mapCols'); cols.innerHTML = '';
  for (let lv = 0; lv < 5; lv++) {
    const col = document.createElement('div');
    col.className = 'mcol' + (lv === career.level ? ' current' : '');
    col.innerHTML = `<h4>${lv === 4 ? 'Boss jump' : 'Level ' + (lv + 1)}</h4>`;
    const opts = optionsFor(lv);
    opts.forEach((o, i) => {
      const c = document.createElement('div');
      const picked = career.picks[lv];
      let cls = 'tcard' + (o.boss ? ' boss' : '');
      if (lv < career.level) cls += picked === i ? ' done' : ' dim';
      if (lv > career.level) cls += ' future';
      if (lv === career.level && selected === i) cls += ' sel';
      c.className = cls;
      const showInfo = lv <= career.level + 1;
      c.innerHTML = showInfo ? `<div class="tname">${o.name}</div>${o.boss ? '<div class="rt"><span>Gap</span><b>HUGE</b></div>' : ratings(o)}<div class="tobj"><i>♥ Bonus:</i> ${o.objective.text}</div>`
        : `<div class="tname">???</div><div class="rt"><span>Unknown trail</span></div>`;
      if (lv === career.level) c.onclick = () => onSelect(i);
      col.appendChild(c);
    });
    cols.appendChild(col);
  }
  $('btnRide').disabled = selected == null;
  $('mapHint').textContent = selected == null ? 'Pick your trail' : career.level === 4 ? 'Beat the boss to finish the world' : 'Ready when you are';
}

export function profileStrip(profile) {
  $('profileStrip').innerHTML = `<span>Rank <b>${rankOf(profile.totalRep)}</b></span><span>Total rep <b>${fmtNum(profile.totalRep)}</b></span><span>Best run <b>${fmtNum(profile.bestRun)}</b></span>`;
}

let toastN = 0;
export function toast(text, sub = '', cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  $('toasts').appendChild(el);
  const id = ++toastN;
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = 0; setTimeout(() => el.remove(), 400); }, 2600);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
  return id;
}
let centerTimer = null;
export function bigMsg(html, cls = '', ms = 1400) {
  const c = $('center');
  c.innerHTML = `<div class="big-msg ${cls}">${html}</div>`;
  clearTimeout(centerTimer);
  if (ms) centerTimer = setTimeout(() => { c.innerHTML = ''; }, ms);
}
export function clearBig() { $('center').innerHTML = ''; clearTimeout(centerTimer); }
export function popup(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'popup ' + cls; el.innerHTML = html;
  $('hud').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

export function progressMarks(course) {
  const m = $('progMarks'); m.innerHTML = '';
  const total = course.L;
  for (const s of course.checkpoints) m.innerHTML += `<div class="pmark cp" style="left:${(s / total * 100).toFixed(2)}%"></div>`;
  for (const f of course.features) if (f.type === 'boss') m.innerHTML += `<div class="pmark boss" style="left:${(f.sLip / total * 100).toFixed(2)}%"></div>`;
  m.innerHTML += '<div class="pmark fin" style="left:100%"></div>';
}

export function results(o) {
  $('resWorld').textContent = o.eyebrow; $('resTitle').textContent = o.title;
  $('resGrid').innerHTML = o.stats.map((s) => `<div class="${s.big ? 'big' : ''}"><small>${s.label}</small><b>${s.value}</b></div>`).join('');
  $('resObj').className = 'res-obj ' + (o.objective ? (o.objective.ok ? 'ok' : 'no') : 'hidden');
  if (o.objective) $('resObj').innerHTML = (o.objective.ok ? '✔ Bonus complete: ' : '✖ Bonus missed: ') + o.objective.text + (o.objective.ok && o.objective.reward ? ' <b>+1 ♥</b>' : '');
  const b = $('resButtons'); b.innerHTML = '';
  for (const btn of o.buttons) {
    const e = document.createElement('button');
    e.className = 'btn ' + (btn.primary ? 'primary' : 'ghost'); e.textContent = btn.label; e.onclick = btn.fn;
    b.appendChild(e);
  }
}

export function swatches(id, list, current, onPick) {
  const el = $(id); el.innerHTML = '';
  for (const c of list) {
    const s = document.createElement('div');
    const css = typeof c === 'string' ? c : '#' + c.toString(16).padStart(6, '0');
    s.className = 'sw' + (c === current ? ' sel' : ''); s.style.background = css;
    s.onclick = () => { onPick(c); for (const x of el.children) x.classList.remove('sel'); s.classList.add('sel'); };
    el.appendChild(s);
  }
}
export function riderPanel(rider, onChange) {
  const set = (k) => (c) => { rider[k] = c; onChange(); };
  swatches('swFrame', COLOR_SETS.frame, rider.frame, set('frame'));
  swatches('swAccent', COLOR_SETS.accent, rider.accent, set('accent'));
  swatches('swJersey', COLOR_SETS.jersey, rider.jersey, set('jersey'));
  swatches('swJacc', COLOR_SETS.jersey, rider.jacc, set('jacc'));
  swatches('swPants', COLOR_SETS.pants, rider.pants, set('pants'));
  swatches('swHelmet', COLOR_SETS.helmet, rider.helmet, set('helmet'));
}
export function seg(id, attr, value, onPick) {
  const el = $(id);
  for (const b of el.querySelectorAll('button')) {
    b.classList.toggle('on', String(b.dataset[attr]) === String(value));
    b.onclick = () => { for (const x of el.querySelectorAll('button')) x.classList.remove('on'); b.classList.add('on'); onPick(b.dataset[attr]); };
  }
}
export { fmtNum, fmtTime };
