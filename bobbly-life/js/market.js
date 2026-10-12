// The Bobbly Stock Exchange (BSX): a little stock market that runs all by itself.
// Bots buy and sell all the time and news moves prices. Every trade pushes the price: buying pushes it up and
// selling pushes it down, whether it's yours, a friend's or a bot's. Momentum bots chase moves and value bots
// pull prices back towards what the company is "really" worth, so a big buy can start a rally that fades later.
// In multiplayer the host runs the market: everyone in the room trades on the same prices and sees each other's
// trades move them. Your shares and profit live in your save; the market itself is saved separately.
import { G, rand, randi, pick, clamp, writeSave, noEmoji } from './state.js';
import { sfx } from './audio.js';

// p0: starting price, vol: how jumpy it is, nv: how big its news is, depth: how many dollars of buying it takes to
// push the price up a lot (spending depth / 100 dollars pushes it up about 1%)
export const STOCKS = [
  { sym: 'BOB', name: 'Bobbly Corp', emo: '🫘', p0: 118, vol: 0.00055, nv: 0.035, depth: 200000 },
  { sym: 'BEAN', name: 'Bean Burger Co', emo: '🍔', p0: 22, vol: 0.0009, nv: 0.06, depth: 60000 },
  { sym: 'ROKT', name: 'Rocket Rides', emo: '🚀', p0: 35, vol: 0.0019, nv: 0.12, depth: 50000 },
  { sym: 'FISH', name: 'Fishy Business', emo: '🐟', p0: 12, vol: 0.0011, nv: 0.08, depth: 40000 },
  { sym: 'BRIK', name: 'Brick & Co', emo: '🧱', p0: 48, vol: 0.00075, nv: 0.05, depth: 100000 },
  { sym: 'DUCK', name: 'Rubber Duck Inc', emo: '🦆', p0: 4, vol: 0.0033, nv: 0.2, depth: 15000 },
  { sym: 'BCOIN', name: 'BobCoin', emo: '🪙', p0: 60, vol: 0.0019, nv: 0.12, depth: 60000 },
];
export const PERKS = [
  ['first', '🐣', 'First Trade', 'Make your first trade'],
  ['dip', '🛒', 'Buy the Dip', 'Buy a stock that is down 10% or more'],
  ['whale', '🐋', 'Whale', 'Make one trade worth $1,000 or more'],
  ['mover', '📣', 'Market Mover', 'Move a price 5% or more with one trade'],
  ['moon', '🚀', 'To the Moon', 'Sell shares for 50% more than you paid'],
  ['diamond', '💎', 'Diamond Hands', 'Hold a stock for 10 minutes'],
  ['basket', '🧺', 'Diversified', 'Own 4 different stocks at once'],
  ['streak', '🔥', 'Hot Streak', 'Sell for a profit 3 times in a row'],
];
// [total profit needed, rank]
export const RANKS = [[0, 'INTERN'], [100, 'JUNIOR TRADER'], [500, 'TRADER'], [2000, 'SENIOR TRADER'], [10000, 'SHARK'], [50000, 'WOLF OF BOBBLY ST'], [250000, 'MARKET LEGEND']];

export const CANDLE = 5, PER_MIN = 12;      // a live candle every 5 seconds, a minute candle every 12 of them
const TICK = 0.5, KEEP = 120, FEE = 0.0025, XMAX = 1.2;
const KV = 0.02, KM = 0.35, TAU = 6, DRIFT = 0.000015, KA = 1 / 2400;
const SAVE_KEY = 'bobbly-market-v1';
const BOTS = ['WobblyWendy', 'DiamondDan', 'BeanBaron', 'MoonMolly', 'PaperPete', 'StonkSteve', 'QuackQueen', 'RocketRay', 'FishyPhil', 'BrickBob', 'HodlHank', 'CandleCarl', 'BullBetty', 'BearBernie', 'LuckyLou', 'ChartChad'];
const NEWS = {
  BOB: [['Bobbly Corp reports record profits!', 1], ['Bobbly Corp launches the BobPhone 2', 1], ['Bobbly Corp boss slips on a banana live on TV', -1], ['Bobbly Corp recalls a million wobbly chairs', -1]],
  BEAN: [['Bean Burger invents the TRIPLE bean burger', 1], ['Everyone on the island is hungry today', 1], ['Bean Burger runs out of beans', -1], ['Inspector finds a sock in a bean burger', -1]],
  ROKT: [['Rocket Rides lands on the Moon!', 1], ['Rocket Rides sells out every space ticket', 1], ['Rocket Rides rocket flies sideways', -1], ['Rocket launch delayed by angry seagulls', -1]],
  FISH: [['Huge fishing season at the docks', 1], ['Golden fish spotted in Bobbly Bay', 1], ['The fish have gone on holiday', -1], ['Fishy Business boat springs a leak', -1]],
  BRIK: [['Building boom in Bobbly City', 1], ['Brick & Co wins a giant new contract', 1], ['Brick & Co builds a house upside down', -1], ['Brick shortage hits the island', -1]],
  DUCK: [['Rubber Duck goes VIRAL on BobTok!', 1], ['A famous Bobbler buys a million ducks', 1], ['DUCK TO THE MOON!!', 1], ['Expert says the duck craze is over', -1], ['Scientists confirm rubber ducks are... just ducks', -1]],
  BCOIN: [['Bean Burger now takes BobCoin', 1], ['BobCoin miners strike digital gold', 1], ['Someone dropped a BobCoin wallet in the sea', -1], ['Is the BobCoin bubble about to pop?', -1]],
};
const MARKET_NEWS = [['BULL RUN! Bobblers are buying everything', 1], ['MARKET CRASH! Panic on Bobbly Street', -1], ['Bobbly Bank cuts interest rates', 1], ['Bobbly Bank raises interest rates', -1]];

export const M = { t: 0, ci: 0, acc: 0, ver: 0, feedVer: 0, feed: [], news: [], marks: [], newsT: rand(25, 50), away: null, mode: 'solo', synced: false, asked: 0, netAcc: 0, saveAcc: 0, perkAcc: 0, ready: false };
let send = () => {};
G.market = M;

const gauss = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * Math.random()); };
const last = (a) => a[a.length - 1];
const r4 = (n) => Math.round(n * 10000) / 10000;
const rc = (c) => [r4(c[0]), r4(c[1]), r4(c[2]), r4(c[3]), Math.round(c[4]), Math.round(c[5])];
const hostId = () => 'bobblylife-v1-' + G.net.code;
const H = () => { const s = G.save; if (!s.mk || typeof s.mk !== 'object') s.mk = {}; const h = s.mk; h.h ||= {}; h.perks ||= []; h.pnl ||= 0; h.n ||= 0; h.streak ||= 0; h.rank ||= 0; return h; };
export const holdings = () => H();

// ---------------------------------------------------------------- candles
function newCandle(s) {
  s.k.push([s.p, s.p, s.p, s.p, 0, 0]);
  if (s.k.length > KEEP) s.k.shift();
  if (M.ci % PER_MIN === 0) { s.m.push([s.p, s.p, s.p, s.p, 0, 0]); if (s.m.length > KEEP) s.m.shift(); }
}
// move the price by x (log change) and record the volume: x > 0 is net buying, x < 0 net selling
function move(s, x, twoWay = 0) {
  s.p = clamp(s.p * Math.exp(x), 0.05, 99999);
  const net = Math.abs(x) * s.depth / s.p, b = (x > 0 ? net : 0) + twoWay / 2, sl = (x < 0 ? net : 0) + twoWay / 2;
  for (const c of [last(s.k), last(s.m)]) { if (s.p > c[1]) c[1] = s.p; if (s.p < c[2]) c[2] = s.p; c[3] = s.p; c[4] += b; c[5] += sl; }
}

// ---------------------------------------------------------------- the simulation (solo and host only)
function step(dt, quiet) {
  M.t += dt;
  const ci = Math.floor(M.t / CANDLE);
  while (M.ci < ci) { M.ci++; for (const s of STOCKS) newCandle(s); }
  const sq = Math.sqrt(dt);
  STOCKS.forEach((s, i) => {
    // momentum: how fast the price has been moving lately (this includes everyone's trades since the last tick)
    s.mom += (Math.log(s.p / s.pl) / dt - s.mom) * Math.min(1, dt / TAU);
    s.lf += (DRIFT - KA * (s.lf - s.la)) * dt + s.vol * 0.3 * sq * gauss();       // what the company is "really" worth
    const xV = KV * (s.lf - Math.log(s.p)) * dt;                                    // value bots buy cheap, sell dear
    const xM = (KM * s.mom + s.hype) * dt;                                           // momentum bots chase the move
    const xN = s.vol * sq * gauss();                                                 // everyone else
    const xW = Math.random() < dt / 75 ? (Math.random() < 0.5 ? -1 : 1) * rand(0.2, 0.5) * s.nv : 0;        // a whale
    const x = clamp(xV + xM + xN + xW, -0.12, 0.12);
    move(s, x, (Math.abs(xN) * 0.6 + s.vol * sq * rand(0.4, 1.2)) * s.depth / s.p);
    s.pl = s.p; s.lx = x;
    s.hype *= Math.exp(-dt / 8);
    if (xW && !quiet) botFeed({ w: 'WHALE ' + pick(BOTS), s: i, q: Math.sign(xW) * Math.max(1, Math.round(Math.abs(xW) * s.depth / s.p)), p: r4(s.p), k: 'whale' });
  });
  if (!quiet && Math.random() < 0.55 * dt / TICK) {
    const i = randi(0, STOCKS.length - 1), s = STOCKS[i];
    const side = (Math.random() < 0.7 ? Math.sign(s.lx) : -Math.sign(s.lx)) || 1;
    botFeed({ w: pick(BOTS), s: i, q: side * Math.max(1, Math.round(rand(0.001, 0.012) * s.depth / s.p)), p: r4(s.p), k: 'bot' });
  }
  M.newsT -= dt;
  if (M.newsT <= 0) { M.newsT = rand(45, 110); randomNews(quiet); }
}

function randomNews(quiet) {
  if (Math.random() < 0.15) {
    const [text, dir] = pick(MARKET_NEWS);
    applyNews(text, STOCKS.map((s, i) => [i, dir * rand(0.5, 1) * s.nv]), quiet);
  } else {
    const i = randi(0, STOCKS.length - 1), s = STOCKS[i], [text, dir] = pick(NEWS[s.sym]);
    applyNews(text, [[i, dir * rand(0.6, 1.5) * s.nv]], quiet);
  }
}
// news changes what a company is worth; the price jumps part of the way at once and bots push it the rest
function applyNews(text, ch, quiet) {
  for (const [i, d] of ch) { const s = STOCKS[i]; s.lf += d; s.hype += d * 0.06; move(s, d * 0.3, Math.abs(d) * 0.2 * s.depth / s.p); s.pl = s.p; }
  const n = { text, ch: ch.map(([i, d]) => [i, Math.round((Math.exp(d) - 1) * 100)]), at: Date.now() };
  if (quiet) { n.at -= 60000; M.news.unshift(n); if (M.news.length > 12) M.news.pop(); return; }
  addNews(n);
  if (G.net.mode === 'host') send({ t: 'mkn', n });
}
function addNews(n) {
  if (!n || typeof n.text !== 'string' || !Array.isArray(n.ch)) return;
  n = { text: noEmoji(n.text).slice(0, 90), ch: n.ch.filter(c => STOCKS[c[0]]).map(c => [c[0] | 0, Math.round(+c[1] || 0)]), at: +n.at || Date.now() };
  M.news.unshift(n);
  if (M.news.length > 12) M.news.pop();
  M.ver++;
  // tell the player about news on the stocks they own (the app shows it anyway)
  if (G.ui && G.ui.phoneApp === 'stocks') return;
  const mine = n.ch.filter(([i]) => owned(i) > 0);
  if (mine.length && G.toast) G.toast(`📰 ${n.text}  ${mine.slice(0, 3).map(([i, d]) => `${STOCKS[i].sym} ${d >= 0 ? '+' : ''}${d}%`).join(' ')}`, mine[0][1] >= 0 ? 'money' : 'bad', 6000);
}
// the bots' trades show up for everyone in the room
function botFeed(e) { feedAdd(e); if (G.net.mode === 'host') send({ t: 'mkf', e }); }
function feedAdd(e) {
  M.feed.unshift(e);
  if (M.feed.length > 40) M.feed.pop();
  M.feedVer++;
}

// things that happen in the game shake the market too
G.marketNews = (kind) => {
  if (!M.ready || G.net.mode === 'client') return;
  const at = (sym) => STOCKS.findIndex(s => s.sym === sym);
  if (kind === 'tornado') applyNews('Tornado hits Bobbly! Builders are going to be busy', [[at('BRIK'), 0.14], [at('BOB'), -0.04], [at('FISH'), -0.06]]);
  else if (kind === 'ufo') applyNews('UFOs over Bobbly City! Space stocks blast off', [[at('ROKT'), 0.2], [at('BOB'), -0.05], [at('BEAN'), -0.04]]);
  else applyNews('GIANT ATTACK on Bobbly City! Investors panic', STOCKS.map((s, i) => [i, s.sym === 'BRIK' ? 0.12 : -rand(0.6, 1.2) * s.nv]));
};

// ---------------------------------------------------------------- saving the market
function snapshot(n = KEEP) {
  return { at: Date.now(), t: M.t, ci: M.ci, s: STOCKS.map(s => ({ p: r4(s.p), lf: s.lf, la: s.la, mom: s.mom, k: s.k.slice(-n).map(rc), m: s.m.slice(-n).map(rc) })), news: M.news.slice(0, 8) };
}
function saveMarket() {
  if (G.net.mode === 'client' || !M.ready) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); } catch (e) { /* storage full or blocked */ }
}
const okC = (c) => Array.isArray(c) && c.length === 6 && c.every(Number.isFinite);
function restore(d, full) {
  if (!d || !Array.isArray(d.s) || d.s.length !== STOCKS.length || !Number.isFinite(d.ci)) return false;
  if (!d.s.every(x => x && Number.isFinite(x.p) && x.p > 0 && Array.isArray(x.k) && x.k.length && x.k.every(okC) && Array.isArray(x.m) && x.m.length && x.m.every(okC))) return false;
  M.ci = d.ci; M.t = Number.isFinite(d.t) ? d.t : d.ci * CANDLE;
  STOCKS.forEach((s, i) => {
    const x = d.s[i];
    s.p = s.pl = x.p; s.k = x.k.map(c => c.slice()); s.m = x.m.map(c => c.slice()); s.hype = 0; s.lx = 0;
    if (full) { s.lf = Number.isFinite(x.lf) ? x.lf : Math.log(x.p); s.la = Number.isFinite(x.la) ? x.la : Math.log(s.p0); s.mom = Number.isFinite(x.mom) ? x.mom : 0; }
  });
  M.news = Array.isArray(d.news) ? d.news.filter(n => n && typeof n.text === 'string' && Array.isArray(n.ch)).slice(0, 12) : [];
  M.ver++; M.feedVer++;
  return true;
}
function fresh() {
  M.t = 0; M.ci = 0; M.news = [];
  for (const s of STOCKS) {
    s.p = s.pl = s.p0 * rand(0.85, 1.15); s.lf = Math.log(s.p); s.la = Math.log(s.p0); s.mom = 0; s.hype = 0; s.lx = 0;
    s.k = [[s.p, s.p, s.p, s.p, 0, 0]]; s.m = [[s.p, s.p, s.p, s.p, 0, 0]];
  }
  // two hours of history, so the charts aren't empty (big steps first, small ones for the last few minutes)
  for (let a = 0; a < KEEP * 60 - 600; a += 2.5) step(2.5, true);
  for (let a = 0; a < 600; a += TICK) step(TICK, true);
}
function loadMarket() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* no saved market */ }
  if (!restore(d, true)) { fresh(); return; }
  // the market kept going while you were away (up to half an hour of it)
  const away = clamp((Date.now() - (+d.at || Date.now())) / 1000, 0, 1800);
  if (away > 60) {
    const before = STOCKS.map(s => s.p);
    for (let a = 0; a < away; a += 2.5) step(2.5, true);
    M.away = { min: Math.round(away / 60), ch: STOCKS.map((s, i) => s.p / before[i] - 1) };
  }
}

// ---------------------------------------------------------------- prices, quotes and trading
export const owned = (i) => { const h = H().h[STOCKS[i].sym]; return h ? h.q : 0; };
export const costOf = (i) => { const h = H().h[STOCKS[i].sym]; return h ? h.c : 0; };
// change over the last 30 minutes
export function change(i) { const s = STOCKS[i], c = s.m[Math.max(0, s.m.length - 31)]; return c ? s.p / c[0] - 1 : 0; }
export function netWorth() { return G.save.money + STOCKS.reduce((a, s, i) => a + owned(i) * s.p, 0); }
export function rank() { const p = H().pnl; let r = 0; RANKS.forEach((x, k) => { if (p >= x[0]) r = k; }); return r; }

// what a trade of q shares would cost (q > 0 buys, q < 0 sells). Your own order moves the price as it fills,
// so big orders get a worse average price, and there's a small fee.
export function quote(i, q) {
  const s = STOCKS[i], n = Math.abs(q), x = n * s.p / s.depth;
  const f = x < 1e-7 ? 1 : q > 0 ? (Math.exp(x) - 1) / x : (1 - Math.exp(-x)) / x;
  const gross = n * s.p * f, fee = gross * FEE, after = s.p * Math.exp(q > 0 ? x : -x);
  return { n, x, avg: s.p * f, total: q > 0 ? Math.ceil(gross + fee) : Math.max(0, Math.floor(gross - fee)), after, pct: (after / s.p - 1) * 100, tooBig: x > XMAX };
}
const limit = (i) => Math.floor(XMAX * STOCKS[i].depth / STOCKS[i].p);
export function maxBuy(i) {
  let lo = 0, hi = limit(i);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (quote(i, mid).total <= G.save.money) lo = mid; else hi = mid - 1; }
  return lo;
}
export const maxSell = (i) => Math.min(owned(i), limit(i));

export function buy(i, n) {
  n = Math.floor(n);
  if (!(n >= 1) || n > limit(i)) return null;
  const qt = quote(i, n);
  if (qt.total > G.save.money) return null;
  const s = STOCKS[i], hd = H(), dipped = change(i) <= -0.1;
  const h = hd.h[s.sym] || (hd.h[s.sym] = { q: 0, c: 0, t: Date.now() });
  G.save.money -= qt.total; h.q += n; h.c += qt.total; hd.n++;
  trade(i, n, qt);
  perk('first');
  if (dipped) perk('dip');
  if (qt.total >= 1000) perk('whale');
  if (qt.pct >= 5) perk('mover');
  if (Object.values(hd.h).filter(x => x.q > 0).length >= 4) perk('basket');
  writeSave();
  return qt;
}
export function sell(i, n) {
  n = Math.min(Math.floor(n), maxSell(i));
  if (!(n >= 1)) return null;
  const qt = quote(i, -n), s = STOCKS[i], hd = H(), h = hd.h[s.sym];
  const cost = h.c * n / h.q, profit = qt.total - cost;        // what those shares cost you (on average)
  h.c -= cost; h.q -= n;
  if (h.q <= 0) delete hd.h[s.sym];
  G.save.money += qt.total; hd.pnl += profit; hd.n++;
  hd.streak = profit > 0 ? hd.streak + 1 : 0;
  trade(i, -n, qt);
  perk('first');
  if (qt.total >= 1000) perk('whale');
  if (qt.pct <= -5) perk('mover');
  if (cost > 0 && qt.total >= cost * 1.5) perk('moon');
  if (hd.streak >= 3) perk('streak');
  const r = rank();
  if (r > hd.rank) { hd.rank = r; G.toast && G.toast(`📈 PROMOTED! You're now a ${RANKS[r][1]}`, 'money', 6000); sfx.win(); M.promoted = r; }
  writeSave();
  qt.profit = Math.round(profit);
  return qt;
}
// your order hits the market: the price moves, and everyone sees it
function trade(i, q, qt) {
  move(STOCKS[i], q > 0 ? qt.x : -qt.x, 0);
  M.marks.push({ s: i, ci: M.ci, p: qt.avg, q });
  if (M.marks.length > 60) M.marks.shift();
  const e = { w: noEmoji(G.save.name || 'You').slice(0, 16), s: i, q, p: r4(qt.avg), k: 'me', by: G.net.myId };
  feedAdd(e);
  if (G.net.mode === 'client') send({ t: 'mkt', to: hostId(), i, q, nm: e.w });
  else if (G.net.mode === 'host') send({ t: 'mkf', e: { ...e, k: 'pl' } });
  M.ver++;
}
function perk(id) {
  const hd = H();
  if (hd.perks.includes(id)) return;
  hd.perks.push(id);
  const p = PERKS.find(x => x[0] === id);
  G.toast && G.toast(`🏅 Perk unlocked: ${p[2]}!`, 'money', 5000);
  sfx.win();
  M.newPerk = id; M.ver++;
}

// ---------------------------------------------------------------- multiplayer
function netSnap() { const d = snapshot(60); d.s.forEach(x => { delete x.lf; delete x.la; delete x.mom; }); return d; }
function applyTick(m) {
  if (!Array.isArray(m.k) || !Array.isArray(m.m) || !Number.isFinite(m.ci) || m.ci < M.ci) return;
  if (m.ci - M.ci > KEEP * PER_MIN) { M.synced = false; return; }
  while (M.ci < m.ci) { M.ci++; for (const s of STOCKS) newCandle(s); }
  STOCKS.forEach((s, i) => {
    if (okC(m.k[i])) { s.k[s.k.length - 1] = m.k[i].slice(); s.p = s.pl = m.k[i][3]; }
    if (okC(m.m[i])) s.m[s.m.length - 1] = m.m[i].slice();
  });
  M.t = M.ci * CANDLE;
  M.ver++;
}
export function initMarket(net) {
  send = (m) => net.send(m);
  loadMarket();
  M.ready = true; M.ver++;
  // host -> everyone, every second: the live candles
  net.on('mk', (m) => {
    if (G.net.mode !== 'client') return;
    if (M.synced) applyTick(m);
    else if (performance.now() - M.asked > 4000) { M.asked = performance.now(); send({ t: 'mkreq', to: hostId() }); }
  });
  net.on('mkreq', (m) => { if (G.net.mode === 'host') send({ t: 'mks', to: m.from, d: netSnap() }); });
  net.on('mks', (m) => { if (G.net.mode === 'client' && restore(m.d, false)) { M.synced = true; M.marks = []; M.feed = []; M.feedVer++; } });
  // a friend traded: the host moves the price and tells everyone
  net.on('mkt', (m) => {
    if (G.net.mode !== 'host') return;
    const i = m.i | 0, s = STOCKS[i], q = Math.round(+m.q);
    if (!s || !q || !Number.isFinite(q)) return;
    const qt = quote(i, q);
    move(s, Math.sign(q) * Math.min(XMAX, qt.x), 0);
    const e = { w: noEmoji(String(m.nm || 'Bobbler')).slice(0, 16) || 'Bobbler', s: i, q, p: r4(qt.avg), k: 'pl', by: m.from };
    feedAdd(e); M.ver++;
    send({ t: 'mkf', e });
  });
  net.on('mkf', (m) => {
    const e = m.e;
    if (G.net.mode !== 'client' || !e || e.by === G.net.myId || !STOCKS[e.s | 0] || !Number.isFinite(+e.q) || !Number.isFinite(+e.p)) return;
    feedAdd({ w: noEmoji(String(e.w || 'Bobbler')).slice(0, 22), s: e.s | 0, q: Math.round(+e.q), p: +e.p, k: e.k === 'bot' || e.k === 'whale' ? e.k : 'pl' });
  });
  net.on('mkn', (m) => { if (G.net.mode === 'client') addNews(m.n); });
  addEventListener('pagehide', saveMarket);
}

export function updateMarket() {
  if (!M.ready) return;
  // wall-clock time, so the market keeps the right speed even when the game runs slowly
  const now = performance.now(), gap = M.last ? (now - M.last) / 1000 : 0;
  M.last = now;
  const dt = gap > 10 ? 0 : gap;
  const mode = G.net.mode;
  if (mode !== M.mode) {
    if (mode === 'client') { saveMarket(); M.synced = false; M.asked = 0; }     // keep your own market safe while you visit
    if (M.mode === 'client') { loadMarket(); M.synced = false; M.feed = []; M.marks = []; }   // back to your own market
    M.mode = mode;
  }
  if (mode === 'client') {
    if (!M.synced && performance.now() - M.asked > 4000) { M.asked = performance.now(); send({ t: 'mkreq', to: hostId() }); }
  } else {
    // the tab was hidden for a while: the market kept going without you
    if (gap > 10) { for (let a = 0; a < Math.min(gap, 1800); a += 2.5) step(2.5, true); M.ver++; }
    M.acc += dt;
    while (M.acc >= TICK) { M.acc -= TICK; step(TICK, false); M.ver++; }
    M.saveAcc += dt;
    if (M.saveAcc > 15) { M.saveAcc = 0; saveMarket(); }
    if (mode === 'host') {
      M.netAcc += dt;
      if (M.netAcc >= 1) { M.netAcc = 0; send({ t: 'mk', ci: M.ci, k: STOCKS.map(s => rc(last(s.k))), m: STOCKS.map(s => rc(last(s.m))) }); }
    }
  }
  M.perkAcc += dt;
  if (M.perkAcc > 5 && G.save) {
    M.perkAcc = 0;
    if (Object.values(H().h).some(h => h.q > 0 && Date.now() - h.t >= 600000)) perk('diamond');
  }
}
