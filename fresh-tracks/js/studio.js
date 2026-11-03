// Design Studio panel: be the manufacturer. Pick real-world garment cuts, colours, patterns, and print your
// own uploaded images anywhere (chest logo, back print, all-over, sleeves, legs, helmet, board top and base).
import * as G from './gear.js';

const PALETTE = ['#0d1b2a', '#1d3557', '#1f6feb', '#3a86ff', '#00b4d8', '#00e5ff', '#2a9d8f', '#52b788', '#6b705c', '#2d3a2e', '#e9c46a', '#ffd166',
  '#f77f00', '#ff5a1f', '#e63946', '#b5121b', '#ff2e88', '#ff7aa2', '#7b2ff7', '#ffffff', '#f2e8cf', '#a8a29e', '#5c4033', '#2b2d31', '#111111'];
const DESIGNS_KEY = 'freshtracks.designs.v1';

export class Studio {
  constructor(tabsEl, bodyEl, getLook, setLook) {
    this.tabsEl = tabsEl; this.bodyEl = bodyEl; this.getLook = getLook; this.setLook = setLook;
    this.tab = 'jacket';
    this.TABS = [['rider', '🧑 Rider'], ['jacket', '🧥 Jacket'], ['pants', '👖 Pants'], ['head', '⛑️ Head'], ['goggles', '🥽 Goggles'], ['hands', '🧤 Gloves & Boots'], ['board', '🏂 Board'], ['brand', '🏷️ My Brand'], ['presets', '✨ Presets'], ['saved', '💾 Saved']];
  }
  open() { this.renderTabs(); this.render(); }
  renderTabs() {
    this.tabsEl.innerHTML = '';
    for (const [id, label] of this.TABS) {
      const b = document.createElement('button'); b.className = 'tab' + (id === this.tab ? ' on' : ''); b.textContent = label;
      b.onclick = () => { this.tab = id; this.renderTabs(); this.render(); };
      this.tabsEl.appendChild(b);
    }
  }
  change(fn) { const l = G.clone(this.getLook()); fn(l); this.setLook(l); }
  // ---------------------------------------------------------------- widgets
  el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  group(title) { const g = this.el('div', 'grp'); g.appendChild(this.el('h4', '', title)); this.bodyEl.appendChild(g); return g; }
  chips(parent, opts, val, on) {
    const c = this.el('div', 'chips');
    for (const [v, label] of opts) { const b = this.el('button', 'chip' + (v === val ? ' on' : ''), label); b.onclick = () => on(v); c.appendChild(b); }
    parent.appendChild(c); return c;
  }
  colors(parent, label, val, on) {
    const row = this.el('div', 'colrow'); row.appendChild(this.el('span', '', label));
    const sw = this.el('div', 'swatches');
    for (const c of PALETTE) { const b = this.el('button', 'sw' + (c.toLowerCase() === (val || '').toLowerCase() ? ' on' : '')); b.style.background = c; b.title = c; b.onclick = () => on(c); sw.appendChild(b); }
    const pick = this.el('label', 'sw pick'); const inp = document.createElement('input'); inp.type = 'color'; inp.value = val || '#ffffff';
    inp.oninput = () => on(inp.value, true); pick.appendChild(inp); pick.title = 'Any colour'; sw.appendChild(pick);
    row.appendChild(sw); parent.appendChild(row);
  }
  text(parent, val, max, on, ph = '') {
    const i = document.createElement('input'); i.className = 'st-text'; i.maxLength = max; i.value = val || ''; i.placeholder = ph;
    i.oninput = () => on(i.value); i.onkeydown = (e) => e.stopPropagation(); parent.appendChild(i); return i;
  }
  slider(parent, val, min, max, step, on) {
    const i = document.createElement('input'); i.type = 'range'; i.className = 'slider'; i.min = min; i.max = max; i.step = step; i.value = val;
    i.oninput = () => on(parseFloat(i.value)); parent.appendChild(i); return i;
  }
  // image library picker: shows your uploads, lets you add / remove / choose
  images(parent, current, on) {
    const wrap = this.el('div', 'upl');
    const none = this.el('button', 'thumb' + (!current ? ' on' : ''), '<span style="display:grid;place-items:center;height:100%;font-weight:800;font-size:12px;opacity:.7">None</span>');
    none.onclick = () => on(null); wrap.appendChild(none);
    for (const [id, e] of G.images) {
      if (e.remote) continue;
      const t = this.el('button', 'thumb' + (id === current ? ' on' : ''));
      t.style.backgroundImage = `url(${e.src})`;
      const x = this.el('span', 'x', '✕'); x.onclick = (ev) => { ev.stopPropagation(); G.removeImage(id); if (id === current) on(null); else this.render(); };
      t.appendChild(x); t.onclick = () => on(id); wrap.appendChild(t);
    }
    const add = this.el('label', 'addimg', '+'); add.title = 'Upload your own image';
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; try { const id = await G.addImageFile(f); on(id); } catch (e) { alert('Could not read that image'); } };
    add.appendChild(inp); wrap.appendChild(add);
    parent.appendChild(wrap);
  }
  printBlock(title, part, places) {
    const L = this.getLook(), P = L[part].print || { img: null, place: places[0][0], scale: 1 };
    const g = this.group(title);
    this.images(g, P.img, (id) => this.change((l) => { l[part].print = Object.assign({ place: places[0][0], scale: 1 }, l[part].print || {}, { img: id }); }));
    if (P.img) {
      this.chips(g, places, P.place, (v) => this.change((l) => { l[part].print.place = v; }));
      const s = this.el('div', 'tip', 'Size'); g.appendChild(s);
      this.slider(g, P.scale || 1, 0.4, 2.2, 0.05, (v) => this.change((l) => { l[part].print.scale = v; }));
    } else g.appendChild(this.el('div', 'tip', 'Upload any picture (a logo, your art, a photo) and print it on this.'));
  }
  // ---------------------------------------------------------------- tabs
  render() {
    const L = this.getLook(), B = this.bodyEl; B.innerHTML = '';
    const set = (part, key) => (v) => this.change((l) => { if (part) l[part][key] = v; else l[key] = v; });
    switch (this.tab) {
      case 'rider': {
        let g = this.group('Name'); this.text(g, L.name, 16, (v) => this.change((l) => { l.name = v; }), 'Rider');
        g = this.group('Stance');
        this.chips(g, [['regular', 'Regular (left foot forward)'], ['goofy', 'Goofy (right foot forward)']], L.stance, set(null, 'stance'));
        g = this.group('Skin tone');
        const sw = this.el('div', 'swatches');
        for (const c of G.SKINS) { const b = this.el('button', 'sw' + (c === L.skin ? ' on' : '')); b.style.background = c; b.onclick = () => this.change((l) => { l.skin = c; }); sw.appendChild(b); }
        g.appendChild(sw);
        g = this.group('Neck gaiter');
        this.chips(g, [[true, 'On'], [false, 'Off']], L.gaiter.on !== false, set('gaiter', 'on'));
        if (L.gaiter.on !== false) {
          this.colors(g, 'Main', L.gaiter.c1, set('gaiter', 'c1')); this.colors(g, 'Second', L.gaiter.c2, set('gaiter', 'c2'));
          this.chips(g, G.PATTERNS, L.gaiter.pattern, set('gaiter', 'pattern'));
        }
        break;
      }
      case 'jacket': {
        let g = this.group('Cut'); this.chips(g, G.JACKETS, L.jacket.style, set('jacket', 'style'));
        g = this.group('Colours'); this.colors(g, 'Main', L.jacket.c1, set('jacket', 'c1')); this.colors(g, 'Second', L.jacket.c2, set('jacket', 'c2')); this.colors(g, 'Accent', L.jacket.c3, set('jacket', 'c3'));
        g = this.group('Pattern'); this.chips(g, G.PATTERNS, L.jacket.pattern, set('jacket', 'pattern'));
        this.printBlock('Your print', 'jacket', [['chest', 'Chest logo'], ['front', 'Big front'], ['back', 'Back'], ['sleeve', 'Sleeve'], ['allover', 'All-over']]);
        g = this.group('Branding'); this.chips(g, [[true, 'Show my brand'], [false, 'No brand']], L.jacket.brandText !== false, set('jacket', 'brandText'));
        break;
      }
      case 'pants': {
        let g = this.group('Cut'); this.chips(g, G.PANTS, L.pants.style, set('pants', 'style'));
        g = this.group('Colours'); this.colors(g, 'Main', L.pants.c1, set('pants', 'c1')); this.colors(g, 'Second', L.pants.c2, set('pants', 'c2')); this.colors(g, 'Accent', L.pants.c3, set('pants', 'c3'));
        g = this.group('Pattern'); this.chips(g, G.PATTERNS, L.pants.pattern, set('pants', 'pattern'));
        this.printBlock('Your print', 'pants', [['thigh', 'Thigh logo'], ['allover', 'All-over']]);
        g = this.group('Branding'); this.chips(g, [[true, 'Show my brand'], [false, 'No brand']], L.pants.brandText !== false, set('pants', 'brandText'));
        break;
      }
      case 'head': {
        let g = this.group('Headwear'); this.chips(g, G.HEADS, L.head.type, set('head', 'type'));
        g = this.group('Colours'); this.colors(g, 'Main', L.head.c1, set('head', 'c1')); this.colors(g, 'Stripe', L.head.c2, set('head', 'c2'));
        if (L.head.type !== 'beanie') { g = this.group('Finish'); this.chips(g, [['matte', 'Matte'], ['gloss', 'Gloss']], L.head.finish, set('head', 'finish')); }
        else { g = this.group('Pom pom'); this.chips(g, [[true, 'Yes'], [false, 'No']], L.head.pom !== false, set('head', 'pom')); }
        this.printBlock('Your print', 'head', L.head.type === 'beanie' ? [['side', 'Front patch']] : [['side', 'Sides & back'], ['allover', 'All-over']]);
        g = this.group('Branding'); this.chips(g, [[true, 'Show my brand'], [false, 'No brand']], L.head.brandText !== false, set('head', 'brandText'));
        break;
      }
      case 'goggles': {
        let g = this.group('Lens');
        this.chips(g, Object.entries(G.LENSES).map(([k, v]) => [k, v[0]]), L.goggles.lens, set('goggles', 'lens'));
        g = this.group('Frame & strap'); this.colors(g, 'Frame', L.goggles.frame, set('goggles', 'frame')); this.colors(g, 'Strap', L.goggles.strap, set('goggles', 'strap'));
        if (L.head.type === 'visor') g.appendChild(this.el('div', 'tip', 'Your visor helmet uses this lens colour.'));
        break;
      }
      case 'hands': {
        let g = this.group('Gloves'); this.chips(g, [['gloves', 'Five-finger gloves'], ['mitts', 'Mittens']], L.gloves.type, set('gloves', 'type'));
        this.colors(g, 'Main', L.gloves.c1, set('gloves', 'c1')); this.colors(g, 'Cuff', L.gloves.c2, set('gloves', 'c2'));
        g = this.group('Boots'); this.colors(g, 'Boot', L.boots.c1, set('boots', 'c1')); this.colors(g, 'Liner/laces', L.boots.c2, set('boots', 'c2'));
        g = this.group('Bindings'); this.colors(g, 'Base & highback', L.bindings.c1, set('bindings', 'c1')); this.colors(g, 'Straps', L.bindings.c2, set('bindings', 'c2'));
        break;
      }
      case 'board': {
        let g = this.group('Shape'); this.chips(g, G.BOARDS, L.board.shape, set('board', 'shape'));
        g = this.group('Length: ' + Math.round(L.board.length * 100) + ' cm');
        this.slider(g, L.board.length, 1.42, 1.66, 0.01, (v) => { this.change((l) => { l.board.length = v; }); g.querySelector('h4').textContent = 'Length: ' + Math.round(v * 100) + ' cm'; });
        g = this.group('Top sheet'); this.colors(g, 'Main', L.board.c1, set('board', 'c1')); this.colors(g, 'Second', L.board.c2, set('board', 'c2')); this.colors(g, 'Accent', L.board.c3, set('board', 'c3'));
        this.chips(g, G.PATTERNS, L.board.pattern, set('board', 'pattern'));
        g = this.group('Top graphic (your image)');
        this.images(g, L.board.top.img, (id) => this.change((l) => { l.board.top.img = id; }));
        if (L.board.top.img) { g.appendChild(this.el('div', 'tip', 'Size (max = full-bleed)')); this.slider(g, L.board.top.scale || 1, 0.4, 1.8, 0.05, (v) => this.change((l) => { l.board.top.scale = v; })); }
        g = this.group('Base'); this.colors(g, 'Base colour', L.board.baseColor, set('board', 'baseColor'));
        this.images(g, L.board.base.img, (id) => this.change((l) => { l.board.base.img = id; }));
        if (L.board.base.img) this.slider(g, L.board.base.scale || 1, 0.4, 1.8, 0.05, (v) => this.change((l) => { l.board.base.scale = v; }));
        g = this.group('Model name'); this.text(g, L.board.text, 14, (v) => this.change((l) => { l.board.text = v; }), 'PRO 156');
        this.chips(g, [[true, 'Show text'], [false, 'Hide text']], L.board.brandText !== false, set('board', 'brandText'));
        break;
      }
      case 'brand': {
        let g = this.group('Brand name');
        g.appendChild(this.el('div', 'tip', 'You are the manufacturer! Your brand goes on jackets, pants, helmets, goggle straps and boards.'));
        this.text(g, L.brand.name, 18, (v) => this.change((l) => { l.brand.name = v; }), 'YOUR BRAND');
        g = this.group('Lettering');
        this.chips(g, [['Bebas Neue', 'Bold'], ['Barlow Condensed', 'Condensed'], ['Barlow', 'Clean'], ['Georgia', 'Classic'], ['Courier New', 'Mono']], L.brand.font, (v) => this.change((l) => { l.brand.font = v; }));
        g = this.group('Brand logo (your image)');
        this.images(g, L.brand.logo, (id) => this.change((l) => { l.brand.logo = id; }));
        g.appendChild(this.el('div', 'tip', 'A PNG with a transparent background looks best. It replaces the brand name on your gear.'));
        break;
      }
      case 'presets': {
        const g = this.group('Start from a kit'); const w = this.el('div', 'presets');
        G.PRESETS.forEach((p, i) => { const b = this.el('button', 'preset', `<b>${p.name}</b><small>${p.desc}</small>`); b.onclick = () => this.setLook(G.presetLook(i, this.getLook())); w.appendChild(b); });
        g.appendChild(w);
        break;
      }
      case 'saved': {
        let list = [];
        try { list = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]'); } catch (e) { list = []; }
        let g = this.group('Save this design');
        const nm = this.text(g, '', 20, () => {}, 'Design name');
        const sv = this.el('button', 'pill primary', 'Save'); sv.style.marginTop = '8px';
        sv.onclick = () => { list.unshift({ name: nm.value || 'Design ' + (list.length + 1), look: this.getLook() }); try { localStorage.setItem(DESIGNS_KEY, JSON.stringify(list.slice(0, 24))); } catch (e) { /* full */ } this.render(); };
        g.appendChild(sv);
        g = this.group('My designs');
        if (!list.length) g.appendChild(this.el('div', 'tip', 'Nothing saved yet.'));
        const w = this.el('div', 'presets');
        list.forEach((d, i) => {
          const b = this.el('button', 'preset', `<b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.look.jacket.style)} · ${escapeHtml(d.look.board.shape)}</small>`);
          b.onclick = () => this.setLook(G.sanitizeLook(d.look));
          b.oncontextmenu = (e) => { e.preventDefault(); list.splice(i, 1); localStorage.setItem(DESIGNS_KEY, JSON.stringify(list)); this.render(); };
          w.appendChild(b);
        });
        g.appendChild(w);
        if (list.length) g.appendChild(this.el('div', 'tip', 'Right-click a design to delete it.'));
        break;
      }
    }
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function randomLook(base) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const col = () => pick(PALETTE);
  const l = G.clone(base);
  l.jacket.style = pick(G.JACKETS)[0]; l.jacket.c1 = col(); l.jacket.c2 = col(); l.jacket.c3 = col(); l.jacket.pattern = pick(G.PATTERNS)[0];
  l.pants.style = pick(G.PANTS)[0]; l.pants.c1 = col(); l.pants.c2 = col(); l.pants.pattern = Math.random() < 0.6 ? 'solid' : pick(G.PATTERNS)[0];
  l.head.type = pick(G.HEADS)[0]; l.head.c1 = col(); l.head.c2 = col(); l.head.finish = pick(['matte', 'gloss']);
  l.goggles.lens = pick(Object.keys(G.LENSES)); l.goggles.frame = col(); l.goggles.strap = col();
  l.gaiter.c1 = col(); l.gaiter.c2 = col(); l.gaiter.pattern = pick(G.PATTERNS)[0];
  l.gloves.c1 = col(); l.gloves.c2 = col(); l.boots.c1 = pick(['#2a2a2a', '#5c4033', '#ffffff', col()]); l.bindings.c1 = col(); l.bindings.c2 = col();
  l.board.shape = pick(G.BOARDS)[0]; l.board.c1 = col(); l.board.c2 = col(); l.board.c3 = col(); l.board.pattern = pick(G.PATTERNS)[0]; l.board.baseColor = col();
  return l;
}
