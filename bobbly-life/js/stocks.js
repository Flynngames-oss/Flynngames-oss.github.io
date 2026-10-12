// Stocks: the Bobbly Stock Exchange app on the phone, styled like an old green trading terminal.
// The market itself (prices, bots, news, multiplayer) lives in market.js.
import * as THREE from 'three';
import { G, clamp } from './state.js';
import { sfx } from './audio.js';
import { STOCKS, PERKS, RANKS, M, PER_MIN, quote, buy, sell, maxBuy, maxSell, owned, costOf, change, netWorth, rank, holdings } from './market.js';

const UI = { el: null, api: null, sel: 0, tf: 'k', qty: 1, ver: -1, fver: -1, money: -1, clock: 0, newsKey: '', newsAt: 0, feedT: 0, ro: null };
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const price = (p) => '$' + (p >= 1000 ? Math.round(p).toLocaleString('en-US') : p >= 1 ? p.toFixed(2) : p.toFixed(3));
const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const axis = (p) => (p >= 1000 ? Math.round(p).toString() : p >= 100 ? p.toFixed(1) : p >= 10 ? p.toFixed(2) : p.toFixed(3));

// emoji drawn tiny and blown up, with a dark outline, so they look like pixel-art sprites
const ICONS = new Map();
export function pxIcon(emo, n = 16) {
  if (ICONS.has(emo)) return ICONS.get(emo);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = `${n - 3}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(emo, n / 2, n / 2 + 1);
    const d = x.getImageData(0, 0, n, n), a = d.data, out = new Uint8ClampedArray(a.length);
    const solid = (X, Y) => X >= 0 && Y >= 0 && X < n && Y < n && a[(Y * n + X) * 4 + 3] > 100;
    for (let y = 0; y < n; y++) for (let X = 0; X < n; X++) {
      const k = (y * n + X) * 4;
      if (solid(X, y)) { out[k] = a[k]; out[k + 1] = a[k + 1]; out[k + 2] = a[k + 2]; out[k + 3] = 255; } else if (solid(X + 1, y) || solid(X - 1, y) || solid(X, y + 1) || solid(X, y - 1)) { out[k] = 6; out[k + 1] = 12; out[k + 2] = 8; out[k + 3] = 255; }
    }
    d.data.set(out); x.putImageData(d, 0, 0);
    url = c.toDataURL();
  } catch (e) { /* no canvas: the icon is just left out */ }
  ICONS.set(emo, url);
  return url;
}
const img = (emo, cls = '') => `<img class="px ${cls}" src="${pxIcon(emo)}" alt="">`;

// ---------------------------------------------------------------- the screen
export function renderStocks(el, api) {
  UI.el = el; UI.api = api;
  UI.sel = clamp(holdings().sel | 0, 0, STOCKS.length - 1);
  UI.ver = UI.fver = UI.money = -1; UI.newsKey = ''; UI.top = M.feed[0]; UI.newsAt = M.news[0] ? M.news[0].at : 0;
  el.innerHTML = `<div class="sx" id="sx">${api.status}
    <div class="sx-grid">
      <section class="sx-box sx-chart" id="sxChartBox"><i class="sx-lbl">Chart</i>
        <div class="sx-chead">
          <span class="sx-tk" id="sxTk"></span>
          <span class="sx-px"><b id="sxPx"></b><em id="sxChg"></em></span>
          <span class="sx-tf"><button data-tf="k" title="A candle every 5 seconds">5s</button><button data-tf="m" title="A candle every minute">1m</button></span>
        </div>
        <div class="sx-cv"><canvas id="sxCv"></canvas><div class="sx-flash" id="sxFlash"></div><div class="sx-away hidden" id="sxAway"></div></div>
        <div class="sx-cfoot"><span>BSX v1.0</span><span class="sx-tick" id="sxTick"><span></span></span><span id="sxRank"></span></div>
      </section>
      <section class="sx-box sx-assets"><i class="sx-lbl">Assets</i>
        <div class="sx-pill blue"><span>Price</span><b id="sxAP"></b></div>
        <div class="sx-pill grey"><span>Shares</span><b id="sxAS"></b></div>
        <div class="sx-mv"><i>Market value</i><b id="sxMV"></b><em id="sxPL"></em></div>
      </section>
      <section class="sx-box sx-feed"><i class="sx-lbl">Live trades</i>
        <div class="sx-flow"><span id="sxFB"></span></div><div class="sx-flowl"><span id="sxFBt"></span><span id="sxFSt"></span></div>
        <ul id="sxFeed"></ul>
      </section>
      <section class="sx-box sx-cards"><i class="sx-lbl">Market</i>
        <div class="sx-row" id="sxCards">${STOCKS.map((s, i) => `<button class="sx-card" data-i="${i}"><em></em>${img(s.emo)}<b>${s.sym}</b><small></small><i class="own"></i></button>`).join('')}</div>
      </section>
      <div class="sx-side">
        <section class="sx-box sx-perks"><i class="sx-lbl">Perks</i>
          <div class="sx-pk">${PERKS.map(p => `<button data-perk="${p[0]}" title="${esc(p[2] + ': ' + p[3])}">${img(p[1])}</button>`).join('')}</div>
          <div class="sx-pktip" id="sxPkTip"></div>
        </section>
        <section class="sx-box red sx-target"><i class="sx-lbl">Target</i>
          <div class="sx-big" id="sxTgt"></div><small id="sxTgtL"></small><div class="sx-bar"><span id="sxTgtB"></span></div>
        </section>
        <section class="sx-box sx-bal"><i class="sx-lbl">Balance</i>
          <div class="sx-big" id="sxBal"></div><small>Available</small>
        </section>
        <section class="sx-trade">
          <div class="sx-qty"><button class="sx-btn grey" id="sxMinus" aria-label="Fewer">-</button><input id="sxQty" type="number" inputmode="numeric" min="1" step="1" aria-label="Shares"><button class="sx-btn grey" id="sxPlus" aria-label="More">+</button></div>
          <div class="sx-chips"><button data-q="1">1</button><button data-q="10">10</button><button data-q="100">100</button><button data-q="max">Max</button><button data-q="all">All</button></div>
          <div class="sx-bs"><button class="sx-btn sx-buy" id="sxBuy"><span></span><small></small></button><button class="sx-btn sx-sell" id="sxSell"><span></span><small></small></button></div>
        </section>
      </div>
    </div>
    <div class="sx-bot">
      <span class="sx-nav"><button id="sxHome" aria-label="Home">${img('🏠')}</button><button id="sxHelp" aria-label="How it works">?</button></span>
      <span class="sx-day" id="sxDay"></span>
      <span class="sx-nw">Net worth: <b id="sxNW"></b></span>
    </div>
    <div class="sx-help hidden" id="sxHelpBox"><div>
      <h4>How the market works</h4>
      <p>${img('📈')} Prices move all by themselves: bots trade all day long and news shakes things up.</p>
      <p>${img('🟢')} <b class="g">Buying pushes a price UP</b> and ${img('🔴')} <b class="r">selling pushes it DOWN</b>. Big orders move it more (the button shows how much).</p>
      <p>${img('🤖')} Some bots chase a rising price, others sell when it gets too high, so a big jump often fades again.</p>
      <p>${img('👥')} In multiplayer everyone trades the same market. Your friends' trades move your prices!</p>
      <p>${img('💰')} Buy low, sell high. Your profit takes you from Intern all the way to Market Legend.</p>
      <button class="sx-btn sx-buy" id="sxHelpOk">Got it</button>
    </div></div>
  </div>`;
  const q = (id) => el.querySelector('#' + id);
  q('sxHome').onclick = () => api.back();
  q('sxHelp').onclick = () => q('sxHelpBox').classList.remove('hidden');
  q('sxHelpOk').onclick = () => q('sxHelpBox').classList.add('hidden');
  el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => select(+b.dataset.i));
  el.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => { UI.tf = b.dataset.tf; holdings().tf = UI.tf; sfx.pop(); paintTf(); drawChart(); });
  el.querySelectorAll('[data-perk]').forEach(b => b.onclick = () => {
    const p = PERKS.find(x => x[0] === b.dataset.perk), got = holdings().perks.includes(p[0]);
    q('sxPkTip').innerHTML = `<b>${esc(p[2])}</b> ${got ? '✔' : '🔒'} ${esc(p[3])}`;
  });
  const qty = q('sxQty');
  qty.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') qty.blur(); });
  qty.addEventListener('input', () => { setQty(+qty.value || 0, false); });
  qty.addEventListener('blur', () => setQty(UI.qty));
  q('sxMinus').onclick = () => setQty(UI.qty - step());
  q('sxPlus').onclick = () => setQty(UI.qty + step());
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const v = b.dataset.q;
    setQty(v === 'max' ? Math.max(1, maxBuy(UI.sel)) : v === 'all' ? Math.max(1, owned(UI.sel)) : +v);
    sfx.pop();
  });
  q('sxBuy').onclick = doBuy;
  q('sxSell').onclick = doSell;
  UI.tf = holdings().tf === 'm' ? 'm' : 'k';
  paintTf();
  select(UI.sel, true);
  setQty(UI.qty);
  if (M.away) {
    const a = M.away; M.away = null;
    const box = q('sxAway');
    box.innerHTML = `<b>While you were away (${a.min} min)</b><div>${STOCKS.map((s, i) => `<span class="${a.ch[i] >= 0 ? 'g' : 'r'}">${s.sym} ${pct(a.ch[i])}</span>`).join('')}</div><button class="sx-btn sx-buy">OK</button>`;
    box.classList.remove('hidden');
    box.querySelector('button').onclick = () => box.classList.add('hidden');
  }
  if (!holdings().helped) { holdings().helped = true; q('sxHelpBox').classList.remove('hidden'); }
  if (UI.ro) UI.ro.disconnect();
  if (typeof ResizeObserver === 'function') { UI.ro = new ResizeObserver(() => drawChart()); UI.ro.observe(q('sxCv')); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawChart());
}
const step = () => (UI.qty >= 1000 ? 100 : UI.qty >= 100 ? 10 : 1);
function setQty(n, write = true) {
  UI.qty = clamp(Math.floor(n) || 1, 1, 999999);
  const box = UI.el && UI.el.querySelector('#sxQty');
  if (box && write) box.value = UI.qty;
  tradeUI();
}
function paintTf() { UI.el.querySelectorAll('[data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === UI.tf)); }
function select(i, quiet) {
  UI.sel = i; holdings().sel = i;
  const s = STOCKS[i];
  UI.el.querySelector('#sxTk').innerHTML = `${img(s.emo)}<b>${s.sym}</b><span>${esc(s.name)}</span>`;
  UI.el.querySelectorAll('.sx-card').forEach(c => c.classList.toggle('sel', +c.dataset.i === i));
  if (!quiet) sfx.pop();
  UI.ver = -1;
  refresh();
}

// ---------------------------------------------------------------- trading
function doBuy() {
  const s = STOCKS[UI.sel], before = s.p, r = buy(UI.sel, UI.qty);
  if (!r) { sfx.bad(); bump('sxBuy'); return; }
  sfx.coin();
  flash(`Bought ${r.n.toLocaleString()} ${s.sym}`, `avg ${price(r.avg)}  price ${pct(s.p / before - 1)}`, 'b');
  refresh();
}
function doSell() {
  const s = STOCKS[UI.sel], before = s.p, n = Math.min(UI.qty, maxSell(UI.sel)), r = n >= 1 ? sell(UI.sel, n) : null;
  if (!r) { sfx.bad(); bump('sxSell'); return; }
  if (r.profit >= 0) sfx.present(); else sfx.pop();
  flash(`Sold ${r.n.toLocaleString()} ${s.sym}`, `${r.profit >= 0 ? 'PROFIT +' : 'LOSS -'}${money(Math.abs(r.profit)).slice(1)}  price ${pct(s.p / before - 1)}`, r.profit >= 0 ? 'b' : 's');
  if (UI.qty > owned(UI.sel) && owned(UI.sel) > 0) setQty(owned(UI.sel));
  refresh();
}
function bump(id) { const b = UI.el.querySelector('#' + id); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); }
function flash(big, small, cls) {
  const f = UI.el && UI.el.querySelector('#sxFlash');
  if (!f) return;
  f.className = 'sx-flash'; void f.offsetWidth;
  f.innerHTML = `<b>${esc(big)}</b><small>${esc(small)}</small>`;
  f.classList.add('on', ...cls.split(' '));
  const box = UI.el.querySelector('#sxChartBox');
  box.classList.remove('kick'); void box.offsetWidth; box.classList.add('kick');
}
function tradeUI() {
  if (!UI.el) return;
  const i = UI.sel, n = UI.qty, s = STOCKS[i];
  const qb = quote(i, n), canB = !qb.tooBig && qb.total <= G.save.money;
  const b = UI.el.querySelector('#sxBuy'), sl = UI.el.querySelector('#sxSell');
  if (!b) return;
  b.querySelector('span').textContent = `Buy ${n.toLocaleString()}`;
  b.querySelector('small').textContent = qb.tooBig ? 'Too big!' : canB ? `${money(qb.total)}  ▲${qb.pct.toFixed(1)}%` : 'Not enough $';
  b.classList.toggle('off', !canB);
  const ns = Math.min(n, maxSell(i)), qs = ns ? quote(i, -ns) : null;
  sl.querySelector('span').textContent = `Sell ${(ns || n).toLocaleString()}`;
  sl.querySelector('small').textContent = qs ? `${money(qs.total)}  ▼${(-qs.pct).toFixed(1)}%` : 'No shares';
  sl.classList.toggle('off', !qs);
  b.title = `Buying ${n} ${s.sym} pushes the price up to ${price(qb.after)}`;
  sl.title = qs ? `Selling ${ns} ${s.sym} pushes the price down to ${price(qs.after)}` : `You don't own any ${s.sym}`;
}

// ---------------------------------------------------------------- keeping it live
const setT = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
function refresh() {
  const el = UI.el, q = (id) => el.querySelector('#' + id), i = UI.sel, s = STOCKS[i], hd = holdings();
  const ch = change(i), up = ch >= 0;
  setT(q('sxPx'), price(s.p));
  setT(q('sxChg'), pct(ch)); q('sxChg').className = up ? 'g' : 'r';
  setT(q('sxAP'), price(s.p));
  setT(q('sxAS'), owned(i).toLocaleString());
  const val = owned(i) * s.p, cost = costOf(i);
  setT(q('sxMV'), money(val));
  setT(q('sxPL'), cost ? `(${pct(val / cost - 1)})` : '(+0%)'); q('sxPL').className = !cost || val >= cost ? 'g' : 'r';
  setT(q('sxBal'), money(G.save.money));
  setT(q('sxNW'), money(netWorth()));
  const r = rank(), next = RANKS[r + 1];
  setT(q('sxRank'), RANKS[r][1]);
  if (next) {
    setT(q('sxTgt'), money(next[0]));
    setT(q('sxTgtL'), `Profit to be a ${next[1]}  (so far ${money(hd.pnl)})`);
    q('sxTgtB').style.width = clamp((hd.pnl - RANKS[r][0]) / (next[0] - RANKS[r][0]), 0, 1) * 100 + '%';
  } else { setT(q('sxTgt'), 'MAX'); setT(q('sxTgtL'), `Market legend!  profit ${money(hd.pnl)}`); q('sxTgtB').style.width = '100%'; }
  el.querySelectorAll('[data-perk]').forEach(b => b.classList.toggle('got', hd.perks.includes(b.dataset.perk)));
  el.querySelectorAll('.sx-card').forEach(c => {
    const k = +c.dataset.i, x = change(k), o = owned(k);
    c.classList.toggle('up', x >= 0); c.classList.toggle('down', x < 0);
    setT(c.querySelector('em'), pct(x));
    setT(c.querySelector('small'), price(STOCKS[k].p));
    setT(c.querySelector('.own'), o ? `x${o > 9999 ? Math.round(o / 1000) + 'k' : o}` : '');
  });
  // who's winning right now: buyers or sellers (the last few candles)
  let b = 0, sv = 0;
  for (const c of s.k.slice(-4)) { b += c[4]; sv += c[5]; }
  const bp = b + sv > 0 ? b / (b + sv) : 0.5;
  q('sxFB').style.width = (bp * 100).toFixed(1) + '%';
  setT(q('sxFBt'), `Buyers ${Math.round(bp * 100)}%`); setT(q('sxFSt'), `Sellers ${Math.round(100 - bp * 100)}%`);
  // the news ticker
  const key = M.news.map(n => n.at).join(',');
  if (key !== UI.newsKey) {
    UI.newsKey = key;
    const t = q('sxTick').firstElementChild;
    const mv = (sym, d) => `<b class="${d >= 0 ? 'g' : 'r'}">${sym} ${d >= 0 ? '▲' : '▼'}${Math.abs(d)}%</b>`;
    const items = M.news.slice(0, 6).map(n => {
      const all = n.ch.length >= STOCKS.length, avg = Math.round(n.ch.reduce((a, c) => a + c[1], 0) / Math.max(1, n.ch.length));
      return `<span>${esc(n.text)} ${all ? mv('ALL STOCKS', avg) : n.ch.map(([k, d]) => mv(STOCKS[k].sym, d)).join(' ')}</span>`;
    });
    t.innerHTML = items.join('<i>★</i>') || '<span>Welcome to the Bobbly Stock Exchange</span>';
    t.style.animationDuration = Math.max(14, t.textContent.length * 0.16) + 's';
    const n0 = M.news[0];
    if (n0 && n0.at > UI.newsAt) {
      UI.newsAt = n0.at;
      const d = n0.ch[0] ? n0.ch[0][1] : 0;
      flash('Breaking news', n0.text, d >= 0 ? 'b n' : 's n');
      sfx.pop();
    }
  }
  tradeUI();
  drawChart();
}
function feed() {
  const ul = UI.el.querySelector('#sxFeed'), seen = M.feed.indexOf(UI.top);   // only brand-new rows slide in
  UI.top = M.feed[0];
  ul.innerHTML = M.feed.slice(0, 14).map((e, k) => {
    const s = STOCKS[e.s];
    if (!s) return '';
    const who = e.k === 'me' ? '★ YOU' : e.k === 'pl' ? '👤 ' + e.w : e.k === 'whale' ? '🐋 ' + e.w.replace(/^WHALE /, '') : e.w;
    return `<li class="${e.q > 0 ? 'g' : 'r'} ${e.k}${k < seen ? ' new' : ''}"><b>${esc(who)}</b> ${e.q > 0 ? 'buy' : 'sell'} ${Math.abs(e.q).toLocaleString()} ${s.sym} <i>${price(e.p)}</i></li>`;
  }).join('');
}

export function updateStocks() {
  const now = performance.now(), dt = UI.last ? Math.min(1, (now - UI.last) / 1000) : 0;   // wall-clock time
  UI.last = now;
  updateTicker(dt);
  const el = UI.el;
  if (!el || G.ui.phoneApp !== 'stocks' || !G.ui.panel || !el.querySelector('#sx')) return;
  if (M.ver !== UI.ver || G.save.money !== UI.money) { UI.ver = M.ver; UI.money = G.save.money; refresh(); }
  UI.feedT -= dt;
  if (M.feedVer !== UI.fver && UI.feedT <= 0) { UI.fver = M.feedVer; UI.feedT = 0.3; feed(); }
  UI.clock -= dt;
  if (UI.clock <= 0) {
    UI.clock = 1;
    const h = Math.floor(((G.dayTime || 0) * 24 + 24) % 24), m = Math.floor(((G.dayTime || 0) * 24 * 60) % 60);
    const where = G.net.mode === 'client' ? (M.synced ? `● Room ${G.net.code} market` : '◌ Joining room market...') : G.net.mode === 'host' ? `● Room ${G.net.code} market` : '● Market open';
    setT(el.querySelector('#sxDay'), `${DAYS[new Date().getDay()]} ${h}:${String(m).padStart(2, '0')}   ${where}   Trades: ${holdings().n}`);
  }
}

// ---------------------------------------------------------------- the candle chart (drawn at half resolution for chunky pixels)
function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r))), f = r / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
function drawChart() {
  const cv = UI.el && UI.el.querySelector('#sxCv');
  if (!cv || !cv.clientWidth) return;
  const PX = 2, W = Math.max(80, Math.floor(cv.clientWidth / PX)), H = Math.max(50, Math.floor(cv.clientHeight / PX));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const x = cv.getContext('2d');
  x.imageSmoothingEnabled = false;
  const s = STOCKS[UI.sel], data = UI.tf === 'k' ? s.k : s.m;
  const AX = 34, top = 5, bot = H - 3, plotW = W - AX - 2, SP = 5;
  const n = Math.max(8, Math.floor(plotW / SP)), cs = data.slice(-n);
  x.fillStyle = '#030704'; x.fillRect(0, 0, W, H);
  let lo = Infinity, hi = -Infinity;
  for (const c of cs) { if (c[2] < lo) lo = c[2]; if (c[1] > hi) hi = c[1]; }
  const mid = (lo + hi) / 2, rng = Math.max(hi - lo, mid * 0.004);
  lo = mid - rng * 0.58; hi = mid + rng * 0.58;
  const Y = (p) => Math.round(top + (hi - p) / (hi - lo) * (bot - top));
  const X = (k) => plotW - (cs.length - k) * SP + 1;
  x.font = '8px Silkscreen, monospace'; x.textBaseline = 'middle';
  // grid and price labels
  const st = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / st) * st; v < hi; v += st) {
    const y = Y(v);
    x.fillStyle = '#0f2a17';
    for (let xx = 0; xx < plotW; xx += 3) x.fillRect(xx, y, 1, 1);
    x.fillStyle = '#2f9d55'; x.fillText(axis(v), plotW + 4, y);
  }
  x.fillStyle = '#0c2213';
  for (let k = cs.length - 1; k >= 0; k -= 12) for (let y = top; y < bot; y += 3) x.fillRect(X(k) + 1, y, 1, 1);
  // volume (grey bars at the bottom)
  let vmax = 1;
  for (const c of cs) vmax = Math.max(vmax, c[4] + c[5]);
  const vh = (bot - top) * 0.34;
  cs.forEach((c, k) => { const h = Math.max(1, Math.round((c[4] + c[5]) / vmax * vh)); x.fillStyle = '#272e29'; x.fillRect(X(k), bot - h + 1, SP - 1, h); });
  // candles
  cs.forEach((c, k) => {
    const up = c[3] >= c[0], xx = X(k);
    x.fillStyle = up ? '#3dff72' : '#ff4040';
    const yh = Y(c[1]), yl = Y(c[2]), yo = Y(c[0]), yc = Y(c[3]);
    x.fillRect(xx + 1, yh, 1, Math.max(1, yl - yh + 1));
    x.fillRect(xx, Math.min(yo, yc), 3, Math.max(1, Math.abs(yc - yo) + 1));
  });
  // what you paid on average
  const hd = holdings().h[s.sym], avg = hd && hd.q ? hd.c / hd.q : 0;
  if (avg) {
    const y = clamp(Y(avg), top, bot);
    x.fillStyle = '#ffc23a';
    for (let xx = 0; xx < plotW; xx += 4) x.fillRect(xx, y, 2, 1);
    x.fillRect(1, y - 4, 19, 9); x.fillStyle = '#1a1200'; x.fillText('AVG', 3, y + 0.5);
  }
  // your trades: ▲ where you bought, ▼ where you sold
  const now = UI.tf === 'k' ? M.ci : Math.floor(M.ci / PER_MIN);
  for (const mk of M.marks) {
    if (mk.s !== UI.sel) continue;
    const k = cs.length - 1 - (now - (UI.tf === 'k' ? mk.ci : Math.floor(mk.ci / PER_MIN)));
    if (k < 0 || k >= cs.length) continue;
    const xx = X(k) + 1, y = clamp(Y(mk.p), top + 4, bot - 4);
    x.fillStyle = mk.q > 0 ? '#ffe14a' : '#ff9d2a';
    if (mk.q > 0) { x.fillRect(xx, y + 3, 1, 1); x.fillRect(xx - 1, y + 4, 3, 1); x.fillRect(xx - 2, y + 5, 5, 1); } else { x.fillRect(xx - 2, y - 5, 5, 1); x.fillRect(xx - 1, y - 4, 3, 1); x.fillRect(xx, y - 3, 1, 1); }
  }
  // the live price
  const lc = cs[cs.length - 1], up = !lc || lc[3] >= lc[0], yp = clamp(Y(s.p), top + 4, bot - 4);
  x.fillStyle = up ? '#3dff72' : '#ff4040';
  for (let xx = 0; xx < plotW; xx += 4) x.fillRect(xx, yp, 2, 1);
  x.fillRect(plotW + 1, yp - 5, AX, 11);
  x.fillStyle = '#031006'; x.fillText(axis(s.p), plotW + 4, yp + 0.5);
}

// ---------------------------------------------------------------- the stock ticker round Bobbly Tower
const TK = { mesh: null, tex: null, cv: null, t: 0, ver: -1 };
export function initTicker() {
  const T = G.LOC && G.LOC.stockTower;
  if (!T || TK.mesh) return;
  TK.cv = document.createElement('canvas');
  TK.cv.width = 4096; TK.cv.height = 72;
  TK.tex = new THREE.CanvasTexture(TK.cv);
  TK.tex.colorSpace = THREE.SRGBColorSpace;
  TK.tex.wrapS = THREE.RepeatWrapping;
  TK.tex.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ map: TK.tex, color: new THREE.Color(1.5, 1.5, 1.5) });
  const g = new THREE.Group(), w = T.w + 0.4, h = 3.2;
  // four screens, one per side, with the text running on round the corners
  for (let k = 0; k < 4; k++) {
    const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv;
    for (let n = 0; n < uv.count; n++) uv.setX(n, (k + uv.getX(n)) / 4);
    const a = [0, Math.PI / 2, Math.PI, -Math.PI / 2][k], mesh = new THREE.Mesh(geo, m);
    mesh.rotation.y = a;
    mesh.position.set(Math.sin(a) * (w / 2 + 0.05), 0, Math.cos(a) * (w / 2 + 0.05));
    g.add(mesh);
  }
  const trim = new THREE.MeshLambertMaterial({ color: '#1a1d22' });
  for (const dy of [-h / 2 - 0.2, h / 2 + 0.2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.4, w + 0.6), trim); b.position.y = dy; g.add(b); }
  g.position.set(T.x, T.y, T.z);
  G.scene.add(g);
  TK.mesh = g;
  drawTicker();
}
function drawTicker() {
  const x = TK.cv.getContext('2d'), W = TK.cv.width, H = TK.cv.height;
  x.fillStyle = '#020503'; x.fillRect(0, 0, W, H);
  x.font = '700 44px Silkscreen, monospace'; x.textBaseline = 'middle';
  const parts = STOCKS.map((s, i) => { const c = change(i); return [`${s.emo} ${s.sym} ${price(s.p)}`, `${c >= 0 ? '▲' : '▼'}${Math.abs(c * 100).toFixed(1)}%`, c >= 0]; });
  let px = 20;
  for (let rep = 0; px < W; rep++) {
    for (const [a, b, up] of parts) {
      if (px > W) break;
      x.fillStyle = '#ffffff'; x.fillText(a, px, H / 2 + 2); px += x.measureText(a).width + 14;
      x.fillStyle = up ? '#3dff72' : '#ff4040'; x.fillText(b, px, H / 2 + 2); px += x.measureText(b).width + 26;
      x.fillStyle = '#ffc23a'; x.fillText('★', px, H / 2 + 2); px += 60;
    }
    if (rep === 0) { x.fillStyle = '#ffc23a'; x.fillText('BOBBLY STOCK EXCHANGE', px, H / 2 + 2); px += x.measureText('BOBBLY STOCK EXCHANGE').width + 60; }
  }
  // LED dots
  x.fillStyle = 'rgba(0,0,0,.35)';
  for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 1);
  TK.tex.needsUpdate = true;
}
function updateTicker(dt) {
  if (!TK.mesh) { if (G.LOC && G.LOC.stockTower && G.scene) initTicker(); return; }
  const P = G.player && G.player.root, T = G.LOC.stockTower;
  const near = !P || Math.hypot(P.x - T.x, P.z - T.z) < 900;
  TK.mesh.visible = near;
  if (!near) return;
  TK.tex.offset.x = (TK.tex.offset.x + dt * 0.012) % 1;
  TK.t -= dt;
  if (TK.t <= 0 && M.ver !== TK.ver) { TK.t = 3; TK.ver = M.ver; drawTicker(); }
}
