// Snappy, Screen Helper's pixel-art mascot: a little screen-bot whose face lives on its screen.
// Moods: idle, blink, think, happy, wow, sad. Built as crisp SVG pixels so it scales to any size.

// 16 x 14 body; the face is drawn into the 10 x 6 screen at columns 3-12, rows 5-10
const BODY = [
  '.......aa.......',
  '.......aa.......',
  '.......kk.......',
  '..oooooooooooo..',
  '.obbbbbbbbbbbbo.',
  '.ob__________bo.',
  '.ob__________bo.',
  'bob__________bob',
  'bob__________bob',
  '.ob__________bo.',
  '.ob__________bo.',
  '.obbbbbbbbbbbbo.',
  '..oooooooooooo..',
  '....LL....RR....',
];
// face parts as [x, y, w, h] in screen pixels
const FACES = {
  idle: { e: [[2, 1, 2, 2], [6, 1, 2, 2]], m: [[4, 4, 2, 1]], c: [[1, 3], [8, 3]] },
  blink: { e: [[2, 2, 2, 1], [6, 2, 2, 1]], m: [[4, 4, 2, 1]], c: [[1, 3], [8, 3]] },
  think: { e: [[3, 0, 2, 2], [7, 0, 2, 2]], m: [[5, 4, 1, 1]], c: [[1, 3], [8, 3]] },
  happy: { e: [[1, 2, 1, 1], [2, 1, 1, 1], [3, 2, 1, 1], [6, 2, 1, 1], [7, 1, 1, 1], [8, 2, 1, 1]], m: [[3, 4, 4, 1], [2, 3, 1, 1], [7, 3, 1, 1]], c: [[0, 3], [9, 3]] },
  wow: { e: [[2, 0, 2, 3], [6, 0, 2, 3]], m: [[4, 4, 2, 2]], c: [] },
  sad: { e: [[2, 2, 2, 1], [6, 2, 2, 1]], m: [[4, 3, 2, 1], [3, 4, 1, 1], [6, 4, 1, 1]], c: [] },
};
const COL = { o: '#1b1745', b: 'url(#snappyBody)', k: '#a5b4ff', a: '#ffd166', _: '#0b1020', eye: '#5ef2ff', mouth: '#5ef2ff', cheek: '#ff7aa2', shine: '#26304d' };

let uid = 0;
function rects(list, fill, ox = 0, oy = 0, cls = '') {
  return list.map(([x, y, w = 1, h = 1]) => `<rect x="${x + ox}" y="${y + oy}" width="${w}" height="${h}" fill="${fill}"${cls ? ` class="${cls}"` : ''}/>`).join('');
}
function bodySvg(id) {
  let s = '';
  BODY.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    if (ch === 'L' || ch === 'R') { s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#6d7cff" class="leg ${ch === 'L' ? 'l' : 'r'}"/>`; return; }
    if (ch === 'a') { s += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COL.a}" class="bulb"/>`; return; }
    s += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${(COL[ch] || COL.b).replace('snappyBody', 'snappyBody' + id)}"/>`;
  }));
  s += `<rect x="3" y="5" width="1" height="1" fill="${COL.shine}"/><rect x="4" y="5" width="1" height="1" fill="${COL.shine}" opacity=".6"/>`;
  return s;
}
export function faceSvg(mood) {
  const f = FACES[mood] || FACES.idle;
  return rects(f.e, COL.eye, 3, 5) + rects(f.m, COL.mouth, 3, 5) + rects(f.c, COL.cheek, 3, 5);
}

// plain SVG markup (for places without the live mascot, e.g. the page overlay)
export function staticSvg(mood = 'idle', id = 'x') {
  return `<svg viewBox="0 0 16 14" shape-rendering="crispEdges" width="100%" height="100%"><defs><linearGradient id="snappyBody${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#4f7dff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>${bodySvg(id)}${faceSvg(mood)}</svg>`;
}
export const MASCOT_DATA = { BODY, FACES };

// returns { el, set(mood), mood }
export function createMascot({ size = 64, animated = true, mood = 'idle' } = {}) {
  const id = ++uid;
  const wrap = document.createElement('div');
  wrap.className = 'snappy' + (animated ? ' anim' : '');
  wrap.style.width = size + 'px'; wrap.style.height = Math.round(size * 14 / 16) + 'px';
  wrap.innerHTML = `<svg viewBox="0 0 16 14" shape-rendering="crispEdges" width="100%" height="100%" aria-label="Snappy">
    <defs><linearGradient id="snappyBody${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#4f7dff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    <g class="body">${bodySvg(id)}<g class="face">${faceSvg(mood)}</g></g></svg>`;
  const face = wrap.querySelector('.face');
  const m = { el: wrap, mood, set(next) { if (next === m.mood) return; m.mood = next; wrap.dataset.mood = next; face.innerHTML = faceSvg(next); } };
  wrap.dataset.mood = mood;
  if (animated) {
    // blink now and then when nothing else is going on
    const blink = () => {
      if (m.mood === 'idle') { face.innerHTML = faceSvg('blink'); setTimeout(() => { if (m.mood === 'idle') face.innerHTML = faceSvg('idle'); }, 140); }
      setTimeout(blink, 2500 + Math.random() * 3500);
    };
    setTimeout(blink, 1800 + Math.random() * 2000);
  }
  return m;
}
