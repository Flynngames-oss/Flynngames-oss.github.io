// The surfer creator (pick a surfer, then change everything about them and their board)
// and the spray paint workshop for the deck of the board.
import { OPTIONS, PRESETS, BOARD_FEEL, DEFAULT_LOOK, normalizeLook, drawDeck, boardOutline, boardDims, paintCanvas, PAINT_W, PAINT_H } from './looks.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ctx: { look, save(look), savePaint(dataURL), applyLook(), redrawBoard(), click(), onPaintMode(on), onDone() }
export function initCreator(ctx) {
  const look = ctx.look;
  let tab = 'surfers';
  const TABS = [['surfers', 'Surfers'], ['body', 'Body'], ['face', 'Face'], ['hair', 'Hair & hats'], ['clothes', 'Clothes'], ['board', 'Board']];

  const changed = (rebuild = true) => { ctx.save(look); if (rebuild) ctx.applyLook(); render(); };
  const set = (path, v) => {
    if (path.startsWith('board.')) look.board[path.slice(6)] = v; else look[path] = v;
    changed();
  };
  const get = (path) => (path.startsWith('board.') ? look.board[path.slice(6)] : look[path]);

  // building blocks
  const chips = (label, path, list, extra = {}) => `<div class="crow col"><span>${label}</span><div class="chips">${list.map(([id, nm]) =>
    `<button class="opt ${get(path) === id ? 'on' : ''}" data-lk="${path}" data-v="${id}">${esc(nm)}${extra[id] ? `<i>${esc(extra[id])}</i>` : ''}</button>`).join('')}</div></div>`;
  const swatches = (label, path, list = OPTIONS.colors) => `<div class="crow col"><span>${label}</span><div class="sw">${list.map((c) =>
    `<button data-lk="${path}" data-v="${c}" style="background:${c}" class="${get(path) === c ? 'on' : ''}" aria-label="${c}"></button>`).join('')}<label class="pickc" title="Any colour"><input type="color" data-lk="${path}" value="${get(path)}">+</label></div></div>`;
  const slider = (label, path, min, max, step, fmt) => `<div class="crow"><span>${label}</span><div class="sl"><input type="range" data-lk="${path}" min="${min}" max="${max}" step="${step}" value="${get(path)}"><b>${fmt(get(path))}</b></div></div>`;

  function presetCard(p, i) {
    const l = normalizeLook(p);
    const on = look.name === l.name;
    return `<button class="preset ${on ? 'on' : ''}" data-preset="${i}">
      <div class="dots"><i style="background:${l.skin}"></i><i style="background:${l.top === 'none' ? l.skin : l.topColor}"></i><i style="background:${l.bottomColor}"></i><i class="bd" style="background:linear-gradient(90deg, ${l.board.base} 60%, ${l.board.accent} 60%)"></i></div>
      <b>${esc(l.name)}</b><small>${OPTIONS.shape.find((s) => s[0] === l.board.shape)[1]} · ${OPTIONS.top.find((s) => s[0] === l.top)[1]}</small></button>`;
  }

  function body() {
    const L = look;
    switch (tab) {
      case 'surfers': return `<div class="sub2">Pick a surfer to start from, then change anything you like in the other tabs.</div>
        <div class="presets">${PRESETS.map(presetCard).join('')}</div>
        <div class="crow"><span>Name</span><input id="cName" class="txt" maxlength="14" value="${esc(L.name)}"></div>
        <div class="row2 tight"><button class="mbtn" id="cRandom"><b>🎲 Random surfer</b></button></div>`;
      case 'body': return swatches('Skin', 'skin', OPTIONS.skin)
        + slider('Build', 'build', 0.8, 1.3, 0.05, (v) => (v < 0.9 ? 'Skinny' : v > 1.15 ? 'Chunky' : v > 1.02 ? 'Strong' : 'Normal'))
        + slider('Head size', 'head', 0.85, 1.3, 0.05, (v) => (v < 0.95 ? 'Small' : v > 1.15 ? 'Big' : 'Normal'));
      case 'face': return chips('Eyes', 'eyes', OPTIONS.eyes) + chips('Mouth', 'mouth', OPTIONS.mouth) + chips('Beard', 'beard', OPTIONS.beard);
      case 'hair': return chips('Hair', 'hair', OPTIONS.hair) + swatches('Hair colour', 'hairColor', OPTIONS.hairColors)
        + chips('Hat', 'hat', OPTIONS.hat) + (L.hat !== 'none' ? swatches('Hat colour', 'hatColor') : '')
        + chips('Glasses', 'glasses', OPTIONS.glasses) + (L.glasses !== 'none' ? swatches('Frame colour', 'glassesColor') : '');
      case 'clothes': return chips('Top', 'top', OPTIONS.top)
        + (L.top !== 'none' ? swatches('Top colour', 'topColor') + (L.top !== 'wetsuit' ? chips('Print', 'topPattern', OPTIONS.pattern) + (L.topPattern !== 'plain' ? swatches('Print colour', 'topAccent') : '') : '') : '')
        + chips('Bottoms', 'bottom', OPTIONS.bottom) + swatches('Bottoms colour', 'bottomColor')
        + (L.bottom !== 'wetsuit' ? chips('Print', 'bottomPattern', OPTIONS.pattern) + (L.bottomPattern !== 'plain' ? swatches('Print colour', 'bottomAccent') : '') : '');
      case 'board': {
        const feel = {}; for (const k in BOARD_FEEL) feel[k] = BOARD_FEEL[k].label;
        return `<button class="mbtn primary paintbtn" id="cPaint"><b>🎨 Spray paint mode</b><small>Paint your own design on the deck</small></button>`
          + chips('Shape', 'board.shape', OPTIONS.shape, feel)
          + slider('Length', 'board.len', 0.9, 1.15, 0.05, (v) => `${(boardDims({ ...look.board, len: v }).L * 3.28).toFixed(1)} ft`)
          + chips('Fins', 'board.fins', OPTIONS.fins) + chips('Design', 'board.design', OPTIONS.design)
          + swatches('Deck colour', 'board.base') + swatches('Design colour', 'board.accent') + swatches('Rails & stripes', 'board.rail')
          + swatches('Bottom', 'board.bottom') + swatches('Fins', 'board.finColor');
      }
    }
    return '';
  }

  function render() {
    $('customTabs').innerHTML = TABS.map(([id, nm]) => `<button class="tab ${tab === id ? 'on' : ''}" data-tab="${id}">${nm}</button>`).join('');
    const scroll = $('customRows').scrollTop;
    $('customRows').innerHTML = body();
    $('customRows').scrollTop = scroll;
  }

  // one set of listeners for everything in the panel
  $('custom').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; $('customRows').scrollTop = 0; ctx.click(); render(); return; }
    if (t.dataset.preset !== undefined) {
      const p = normalizeLook(PRESETS[+t.dataset.preset]);
      for (const k of Object.keys(look)) delete look[k];
      Object.assign(look, p);
      ctx.click(); changed(); return;
    }
    if (t.dataset.lk) { ctx.click(); set(t.dataset.lk, t.dataset.v); return; }
    if (t.id === 'cRandom') { ctx.click(); randomise(); return; }
    if (t.id === 'cPaint') { ctx.click(); openPaint(); return; }
  });
  $('custom').addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cName') { look.name = t.value || 'You'; ctx.save(look); return; }
    if (!t.dataset.lk) return;
    const v = t.type === 'range' ? +t.value : t.value;
    if (t.dataset.lk.startsWith('board.')) look.board[t.dataset.lk.slice(6)] = v; else look[t.dataset.lk] = v;
    ctx.save(look); ctx.applyLook();
  });
  $('custom').addEventListener('change', (e) => { if (e.target.dataset.lk) render(); });

  function randomise() {
    const o = (k) => pick(OPTIONS[k])[0], c = () => pick(OPTIONS.colors);
    const name = look.name;
    Object.assign(look, normalizeLook({
      name, skin: pick(OPTIONS.skin), build: pick([0.85, 0.95, 1, 1, 1.1, 1.2]), head: pick([0.9, 1, 1, 1.1, 1.2]),
      eyes: o('eyes'), mouth: o('mouth'), beard: Math.random() < 0.7 ? 'none' : o('beard'),
      hair: o('hair'), hairColor: pick(OPTIONS.hairColors), hat: Math.random() < 0.4 ? 'none' : o('hat'), hatColor: c(),
      glasses: Math.random() < 0.5 ? 'none' : o('glasses'), glassesColor: c(),
      top: o('top'), topColor: c(), topPattern: o('pattern'), topAccent: c(),
      bottom: o('bottom'), bottomColor: c(), bottomPattern: o('pattern'), bottomAccent: c(),
      board: { shape: o('shape'), len: 1, fins: o('fins'), base: c(), accent: c(), rail: c(), bottom: c(), design: o('design'), finColor: c() },
    }));
    changed();
  }

  // -------------------------------------------------------------------------
  // spray paint workshop
  // -------------------------------------------------------------------------
  const P = { tool: 'spray', color: '#ff3d6e', size: 26, flow: 0.6, stamp: 'star', text: 'SURF', down: false, x: 0, y: 0, lx: 0, ly: 0, undo: [], raf: 0, last: 0 };
  const deckCv = document.createElement('canvas'); deckCv.width = PAINT_W; deckCv.height = PAINT_H;
  const view = $('paintCanvas');
  let DW = 1400, DH = 380, outlinePath = null;
  const PAINT_COLORS = ['#ffffff', '#16181d', '#ff3d6e', '#ff7a1f', '#ffd23d', '#7dff5a', '#2ecc71', '#1ec8ff', '#1f3cff', '#b06bff', '#ff5fa2', '#8a5634', '#c0c0c0', '#00a37a', '#ff0000', '#ffe14d'];
  const STAMPS = [['star', '★'], ['heart', '♥'], ['bolt', '⚡'], ['smile', '☺'], ['flower', '✿'], ['wave', '〰'], ['text', 'Aa']];

  function layoutPaint() {
    const d = boardDims(look.board);
    DW = 1400; DH = Math.round(DW * d.W / d.L);
    view.width = DW; view.height = DH;
    const sc = Math.min(Math.min(innerWidth * 0.94, 1100) / DW, innerHeight * 0.32 / DH);
    view.style.width = Math.round(DW * sc) + 'px'; view.style.height = Math.round(DH * sc) + 'px';
    // the outline of the board in paint coordinates (256 across the widest point, 1024 nose to tail)
    outlinePath = new Path2D();
    const pts = boardOutline(look.board.shape, 96);
    pts.forEach(([t, w], i) => { const x = PAINT_W / 2 + w * PAINT_W / 2, y = t * PAINT_H; i ? outlinePath.lineTo(x, y) : outlinePath.moveTo(x, y); });
    for (let i = pts.length - 1; i >= 0; i--) { const [t, w] = pts[i]; outlinePath.lineTo(PAINT_W / 2 - w * PAINT_W / 2, t * PAINT_H); }
    outlinePath.closePath();
  }
  // the view shows the board lying sideways, nose to the right
  const toPaint = (sx, sy) => ({ x: sy / DH * PAINT_W, y: (DW - sx) / DW * PAINT_H });
  function drawView() {
    const g = view.getContext('2d');
    drawDeck(deckCv.getContext('2d'), look.board, paintCanvas());
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, DW, DH);
    g.setTransform(0, DH / PAINT_W, -DW / PAINT_H, 0, DW, 0);
    g.save();
    g.clip(outlinePath);
    g.drawImage(deckCv, 0, 0);
    g.restore();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke(outlinePath);
    g.setTransform(1, 0, 0, 1, 0, 0);
    ctx.redrawBoard();
  }

  function pushUndo() {
    const c = paintCanvas();
    P.undo.push(c.getContext('2d').getImageData(0, 0, PAINT_W, PAINT_H));
    if (P.undo.length > 25) P.undo.shift();
  }
  // paint pixels are about square on the real board, so a round brush stays round
  function sprayAt(x, y, dt) {
    const g = paintCanvas().getContext('2d');
    g.fillStyle = P.color;
    const r = P.size;
    const n = Math.min(900, Math.round(P.flow * r * r * dt * 14));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.min(1, Math.abs(gauss()) * 0.42) * r;
      g.globalAlpha = 0.25 + Math.random() * 0.5;
      const s = Math.random() < 0.15 ? 2 : 1.3;
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s);
    }
    g.globalAlpha = 1;
  }
  function line(x0, y0, x1, y1, erase) {
    const g = paintCanvas().getContext('2d');
    g.save();
    g.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    g.strokeStyle = P.color; g.lineCap = g.lineJoin = 'round'; g.lineWidth = P.size * (erase ? 1.4 : 0.8);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.restore();
  }
  function stamp(x, y) {
    const g = paintCanvas().getContext('2d');
    g.save();
    g.translate(x, y); g.rotate(-Math.PI / 2); // upright when the board is seen nose-right
    g.fillStyle = P.color; g.strokeStyle = P.color;
    const s = P.size * 2.2;
    g.beginPath();
    if (P.stamp === 'star') for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? s * 0.42 : s; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    else if (P.stamp === 'heart') { g.moveTo(0, s * 0.8); g.bezierCurveTo(-s * 1.4, -s * 0.2, -s * 0.6, -s * 1.1, 0, -s * 0.4); g.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.4, -s * 0.2, 0, s * 0.8); }
    else if (P.stamp === 'bolt') { const q = [[0.2, -1], [-0.5, 0.1], [-0.05, 0.1], [-0.3, 1], [0.5, -0.15], [0.05, -0.15]]; q.forEach(([a, b], i) => (i ? g.lineTo(a * s, b * s) : g.moveTo(a * s, b * s))); }
    else if (P.stamp === 'smile') {
      g.arc(0, 0, s, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(-s * 0.35, -s * 0.25, s * 0.14, 0, 7); g.arc(s * 0.35, -s * 0.25, s * 0.14, 0, 7); g.fill();
      g.beginPath(); g.lineWidth = s * 0.14; g.arc(0, s * 0.05, s * 0.5, 0.2, Math.PI - 0.2); g.stroke();
      g.restore(); return;
    } else if (P.stamp === 'flower') { for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.moveTo(0, 0); g.ellipse(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, s * 0.45, s * 0.28, a, 0, Math.PI * 2); } }
    else if (P.stamp === 'wave') {
      g.lineWidth = s * 0.22; g.lineCap = 'round';
      g.moveTo(-s * 1.4, s * 0.2); for (let k = 0; k <= 24; k++) { const t = k / 24; g.lineTo(-s * 1.4 + t * s * 2.8, s * 0.2 - Math.sin(t * Math.PI * 3) * s * 0.4); }
      g.stroke(); g.restore(); return;
    } else if (P.stamp === 'text') {
      g.font = `900 ${Math.round(s * 1.1)}px Lilita One, Nunito, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(P.text || 'SURF', 0, 0); g.restore(); return;
    }
    g.closePath(); g.fill();
    g.restore();
  }
  function gauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function evPos(e) {
    const r = view.getBoundingClientRect();
    return toPaint((e.clientX - r.left) / r.width * DW, (e.clientY - r.top) / r.height * DH);
  }
  view.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { view.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    const p = evPos(e);
    pushUndo();
    P.down = true; P.x = P.lx = p.x; P.y = P.ly = p.y; P.last = performance.now();
    if (P.tool === 'stamp') { stamp(p.x, p.y); P.down = false; drawView(); return; }
    if (P.tool !== 'spray') line(p.x, p.y, p.x + 0.01, p.y, P.tool === 'eraser');
    else sprayAt(p.x, p.y, 1 / 60);
    drawView();
    tick();
  });
  view.addEventListener('pointermove', (e) => {
    const p = evPos(e);
    if (P.down) {
      if (P.tool === 'spray') {
        // fill in between fast strokes so the line doesn't break up into blobs
        const d = Math.hypot(p.x - P.x, p.y - P.y), steps = Math.ceil(d / (P.size * 0.3));
        for (let i = 1; i <= steps; i++) sprayAt(P.x + (p.x - P.x) * i / steps, P.y + (p.y - P.y) * i / steps, 1 / 240);
      } else line(P.x, P.y, p.x, p.y, P.tool === 'eraser');
    }
    P.x = p.x; P.y = p.y;
  });
  const up = () => { if (!P.down) return; P.down = false; drawView(); ctx.savePaint(paintCanvas().toDataURL('image/png')); };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  // holding the can still keeps spraying (paint builds up like a real can)
  function tick() {
    cancelAnimationFrame(P.raf);
    if (!P.down) return;
    const now = performance.now(), dt = Math.min(0.05, (now - P.last) / 1000); P.last = now;
    if (P.tool === 'spray') sprayAt(P.x, P.y, dt);
    drawView();
    P.raf = requestAnimationFrame(tick);
  }

  function renderPaintUI() {
    $('paintTools').innerHTML = [['spray', '🎨 Spray can'], ['marker', '🖊️ Marker'], ['stamp', '⭐ Stickers'], ['eraser', '🧽 Eraser']]
      .map(([id, nm]) => `<button class="opt ${P.tool === id ? 'on' : ''}" data-tool="${id}">${nm}</button>`).join('');
    $('paintColors').innerHTML = PAINT_COLORS.map((c) => `<button data-pc="${c}" style="background:${c}" class="${P.color === c ? 'on' : ''}"></button>`).join('')
      + `<label class="pickc" title="Any colour"><input type="color" id="paintPick" value="${P.color}">+</label>`;
    $('paintStamps').classList.toggle('hidden', P.tool !== 'stamp');
    $('paintStamps').innerHTML = STAMPS.map(([id, ic]) => `<button class="opt ${P.stamp === id ? 'on' : ''}" data-stamp="${id}">${ic}</button>`).join('')
      + (P.stamp === 'text' ? `<input id="paintText" class="txt" maxlength="12" value="${esc(P.text)}">` : '');
    $('paintSize').value = P.size; $('paintFlow').value = P.flow;
    $('paintFlowRow').classList.toggle('hidden', P.tool !== 'spray');
  }
  $('paint').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tool) { P.tool = t.dataset.tool; ctx.click(); renderPaintUI(); }
    else if (t.dataset.pc) { P.color = t.dataset.pc; ctx.click(); renderPaintUI(); }
    else if (t.dataset.stamp) { P.stamp = t.dataset.stamp; P.tool = 'stamp'; ctx.click(); renderPaintUI(); }
    else if (t.id === 'paintUndo') { const u = P.undo.pop(); if (u) { paintCanvas().getContext('2d').putImageData(u, 0, 0); drawView(); ctx.savePaint(paintCanvas().toDataURL('image/png')); } ctx.click(); }
    else if (t.id === 'paintClear') { pushUndo(); paintCanvas().getContext('2d').clearRect(0, 0, PAINT_W, PAINT_H); drawView(); ctx.savePaint(null); ctx.click(); }
    else if (t.id === 'paintFill') { pushUndo(); const g = paintCanvas().getContext('2d'); g.fillStyle = P.color; g.fillRect(0, 0, PAINT_W, PAINT_H); drawView(); ctx.savePaint(paintCanvas().toDataURL('image/png')); ctx.click(); }
    else if (t.id === 'paintBlank') { look.board.design = 'none'; ctx.save(look); drawView(); ctx.click(); }
    else if (t.id === 'paintDone') { ctx.click(); closePaint(); }
  });
  $('paint').addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'paintPick') P.color = t.value;
    else if (t.id === 'paintSize') P.size = +t.value;
    else if (t.id === 'paintFlow') P.flow = +t.value;
    else if (t.id === 'paintText') P.text = t.value;
  });
  $('paint').addEventListener('change', (e) => { if (e.target.id === 'paintPick') renderPaintUI(); });

  function openPaint() {
    layoutPaint();
    $('custom').classList.add('hidden');
    $('paint').classList.remove('hidden');
    renderPaintUI();
    drawView();
    ctx.onPaintMode(true);
  }
  function closePaint() {
    $('paint').classList.add('hidden');
    $('custom').classList.remove('hidden');
    ctx.savePaint(hasPaint() ? paintCanvas().toDataURL('image/png') : null);
    ctx.onPaintMode(false);
    render();
  }
  function hasPaint() {
    const d = paintCanvas().getContext('2d').getImageData(0, 0, PAINT_W, PAINT_H).data;
    for (let i = 3; i < d.length; i += 16) if (d[i]) return true;
    return false;
  }

  return {
    open(firstTime) {
      tab = 'surfers';
      $('customTitle').textContent = firstTime ? 'Choose your surfer' : 'Customise';
      $('customSub').textContent = firstTime ? 'Pick one, then make them your own: face, hair, clothes, board and spray paint' : 'Your surfer updates live in the water';
      render();
    },
    render,
  };
}

export { DEFAULT_LOOK };
