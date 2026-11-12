// Voltcoin app: everything you see. Reads the chain state, builds signed transactions and hands them to the peer.
(function () {
  'use strict';
  const V = window.VLT, P = V.peer, W = V.wallet, M = V.miner, C = V.C;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('voltcoin:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('voltcoin:' + k, JSON.stringify(v)); } catch (e) { /* blocked */ } },
    del(k) { try { localStorage.removeItem('voltcoin:' + k); } catch (e) { /* blocked */ } },
  };
  const GAMES = { bocket: 'Bocket Leuugg', 'fresh-tracks': 'Fresh Tracks', 'wobble-surf': 'Wobble Surf', senders: 'Senders', 'bobbly-life': 'Bobbly Life' };

  // ------------------------------------------------------------ formatting
  const vStr = (sats) => (sats / C.SAT).toFixed(8);
  function vHTML(sats) {
    const m = vStr(sats).match(/^(-?\d+\.\d*?)(0*)$/);
    return esc(m[1]) + (m[2] ? '<span class="dim">' + m[2] + '</span>' : '');
  }
  const uStr = (cents) => (cents / C.CENT).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const short = (pub) => 'vlt_' + pub.slice(0, 6) + '…' + pub.slice(-4);
  function big(n) {
    const u = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']];
    for (const [v, s] of u) if (n >= v) return (n / v).toFixed(n / v >= 100 ? 0 : 1) + s;
    return String(Math.round(n));
  }
  function dur(sec) {
    if (!isFinite(sec) || sec <= 0) return '--';
    if (sec < 60) return Math.max(1, Math.round(sec)) + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ' + Math.round((sec % 3600) / 60) + 'm';
    return (sec / 86400).toFixed(1) + ' days';
  }
  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const clock = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function parseAmount(str, decimals) {
    const s = String(str || '').trim().replace(/,/g, '');
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    const [i, f = ''] = s.split('.');
    if (f.length > decimals) return null;
    const n = Number(i || '0') * Math.pow(10, decimals) + Number((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
    return Number.isSafeInteger(n) ? n : null;
  }
  const parseV = (s) => parseAmount(s, 8);
  const parseU = (s) => parseAmount(s, 2);
  function hue(pub) { let h = 0; for (let i = 0; i < 8; i++) h = (h * 31 + pub.charCodeAt(i)) % 360; return h; }
  function avatar(pub, name) {
    const style = pub === W.pub ? '' : ` style="background:hsl(${hue(pub)} 60% 64%)"`;
    return `<span class="avatar"${style}>${esc((name || '?')[0].toUpperCase())}</span>`;
  }

  // ------------------------------------------------------------ state helpers
  const st = () => P.chain.state;
  const meAcct = () => st().acct[W.pub];
  const nameOf = (pub) => pub === C.ADMIN ? 'Voltcoin Mint' : (st().acct[pub] ? st().acct[pub].name : short(pub));
  const pubOf = (name) => st().names[String(name || '').trim().replace(/^@/, '').toLowerCase()];
  const lastPx = () => { const t = st().trades; return t.length ? t[t.length - 1].px : 0; };
  function maxMinable() { let t = 0; for (let k = 0; ; k++) { const r = Math.floor(C.REWARD0 / Math.pow(2, k)); if (r < 1) return t; t += r * C.HALVING; } }
  const MAX_MINED = maxMinable();
  function stats24() {
    const t = st().trades, cut = Date.now() - 86400000;
    let open = 0, hi = 0, lo = Infinity, vol = 0;
    for (let i = 0; i < t.length; i++) {
      const x = t[i];
      if (x.ts < cut) { open = x.px; continue; }
      if (!open) open = x.px;
      hi = Math.max(hi, x.px); lo = Math.min(lo, x.px); vol += V.mulDiv(x.amt, x.px, C.SAT, false);
    }
    const last = lastPx();
    return { last, open, hi: hi || last, lo: lo === Infinity ? last : lo, vol, chg: open ? (last - open) / open : 0 };
  }

  // ------------------------------------------------------------ toasts
  const ICON = { ok: 'i-bolt', err: 'i-x', volt: 'i-bolt', info: 'i-ledger' };
  function toast(msg, kind = 'info', ms = 4200) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<span class="ti"><svg><use href="#${ICON[kind] || 'i-bolt'}"/></svg></span><span></span>`;
    el.lastChild.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
  }

  // ------------------------------------------------------------ routing
  const VIEWS = ['wallet', 'mine', 'trade', 'leaders', 'ledger', 'admin'];
  let view = 'wallet';
  function route() {
    const h = location.hash.replace('#', '');
    view = VIEWS.includes(h) ? h : 'wallet';
    for (const v of VIEWS) $('v-' + v).hidden = v !== view;
    for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('on', a.dataset.v === view);
    invalidate(true);
    if (view === 'trade') requestAnimationFrame(drawPrice);
    if (view === 'mine') requestAnimationFrame(drawDiff);
  }
  addEventListener('hashchange', route);

  let raf = 0;
  function invalidate() { if (!raf) raf = requestAnimationFrame(render); }
  function render() {
    raf = 0;
    renderHeader();
    if (view === 'wallet') renderWallet();
    else if (view === 'mine') renderMine();
    else if (view === 'trade') renderTrade();
    else if (view === 'leaders') renderLeaders();
    else if (view === 'ledger') renderLedger();
    else if (view === 'admin') renderAdmin();
  }

  // ------------------------------------------------------------ header
  function renderHeader() {
    const s24 = stats24();
    $('tkPrice').textContent = s24.last ? uStr(s24.last) : '--';
    const chg = $('tkChg');
    chg.textContent = s24.last ? (s24.chg >= 0 ? '+' : '') + (s24.chg * 100).toFixed(2) + '%' : '';
    chg.className = 'chg num ' + (s24.chg > 0 ? 'up' : s24.chg < 0 ? 'down' : 'muted');
    const online = P.online();
    $('netDot').className = 'dot ' + (online ? 'on' : P.status === 'offline' ? '' : 'wait');
    const peers = P.peerCount();
    $('netText').textContent = online ? `${peers} ${peers === 1 ? 'peer' : 'peers'} · block ${st().h.toLocaleString()}` : P.status === 'offline' ? 'Offline' : 'Connecting';
    const a = meAcct();
    const name = a ? a.name : (store.get('pendingName', '') || 'Wallet');
    $('meName').textContent = name;
    $('meAvatar').textContent = name[0].toUpperCase();
  }
  $('meChip').onclick = () => { location.hash = '#wallet'; };

  // ------------------------------------------------------------ describing transactions
  function describe(tx, s) {
    const who = (p) => esc(nameOf(p));
    const mineSide = (p) => p === W.pub;
    switch (tx.t) {
      case 'reg': return { ico: 'in', icon: 'i-wallet', title: `${who(tx.f)} opened a wallet`, amt: `+${uStr(C.WELCOME)} USDF`, cat: 'reg' };
      case 'send': {
        const unit = tx.a === 'V' ? 'VLT' : 'USDF';
        const val = tx.a === 'V' ? vHTML(tx.amt) : uStr(tx.amt);
        const dir = mineSide(tx.to) ? 'in' : mineSide(tx.f) ? 'out' : '';
        const sign = dir === 'in' ? '+' : dir === 'out' ? '−' : '';
        return { ico: dir || 'out', icon: dir === 'in' ? 'i-recv' : 'i-send', title: `${who(tx.f)} → ${who(tx.to)}`, sub: tx.memo ? esc(tx.memo) : '', amt: `${sign}${val} ${unit}`, cat: 'send' };
      }
      case 'mine': {
        const r = s.rw && s.rw[tx.id];
        return { ico: 'mine', icon: 'i-bolt', title: `${who(tx.f)} mined a reward`, sub: `${big(tx.d)} hashes`, amt: r ? `+${vHTML(r)} VLT` : '', cat: 'mine' };
      }
      case 'earn': return { ico: 'in', icon: tx.src === 'daily' ? 'i-gift' : 'i-game', title: tx.src === 'daily' ? `${who(tx.f)} claimed the daily reward` : `${who(tx.f)} earned in ${esc(GAMES[tx.src.slice(5)] || tx.src.slice(5))}`, amt: `+${uStr(tx.amt)} USDF`, cat: 'earn' };
      case 'order': return { ico: tx.side === 'b' ? 'buy' : 'sell', icon: 'i-trade', title: `${who(tx.f)} ${tx.ioc ? 'market' : 'limit'} ${tx.side === 'b' ? 'buy' : 'sell'}`, sub: `${vStr(tx.amt)} VLT at ${uStr(tx.px)} USDF`, amt: '', cat: 'order' };
      case 'cancel': return { ico: '', icon: 'i-x', title: `${who(tx.f)} cancelled an order`, amt: '', cat: 'order' };
      case 'mint': {
        const unit = tx.a === 'V' ? 'VLT' : 'USDF';
        return { ico: 'mint', icon: 'i-bolt', title: `Mint → ${who(tx.to)} <span class="tag mint">Mint</span>`, sub: tx.memo ? esc(tx.memo) : 'New coins created', amt: `+${tx.a === 'V' ? vHTML(tx.amt) : uStr(tx.amt)} ${unit}`, cat: 'mint' };
      }
    }
    return { ico: '', icon: 'i-ledger', title: esc(tx.t), amt: '', cat: '' };
  }
  function itemHTML(d, meta, extra = '') {
    return `<div class="item ${extra}"><span class="ico ${d.ico}"><svg><use href="#${d.icon}"/></svg></span><div class="item-main"><b>${d.title}</b><span>${d.sub ? d.sub + ' · ' : ''}${meta}</span></div><div class="item-amt">${d.amt}</div></div>`;
  }

  // ------------------------------------------------------------ wallet view
  function renderWallet() {
    const a = meAcct();
    const px = lastPx();
    const V0 = a ? a.V + a.lV : 0, U0 = a ? a.U + a.lU : 0;
    const total = U0 + (px ? V.mulDiv(V0, px, C.SAT, false) : 0);
    $('wTotal').innerHTML = `${uStr(total)} <small>USDF</small>`;
    $('wTotalSub').textContent = px ? `VLT valued at ${uStr(px)} USDF, the last traded price` : 'VLT has no price until the first trade';
    $('wVlt').innerHTML = vHTML(a ? a.V : 0);
    $('wVltLock').textContent = a && a.lV ? `+${vStr(a.lV)} in orders` : (px && a ? `≈ ${uStr(V.mulDiv(a.V, px, C.SAT, false))} USDF` : '');
    $('wUsdf').textContent = uStr(a ? a.U : 0);
    $('wUsdfLock').textContent = a && a.lU ? `+${uStr(a.lU)} in orders` : '';
    $('wAddr').textContent = W.pub ? short(W.pub) : '--';
    $('btnSend').disabled = !a;

    // daily
    const pendDaily = P.pending(W.pub).some((t) => t.t === 'earn' && t.src === 'daily');
    const wait = a ? a.daily + C.DAILY_GAP - Date.now() : 0;
    const bd = $('btnDaily');
    if (!a) { bd.disabled = true; bd.textContent = 'Waiting for your wallet'; $('dailyText').textContent = 'Your wallet is being confirmed by the network.'; }
    else if (pendDaily) { bd.disabled = true; bd.textContent = 'Claiming…'; }
    else if (wait > 0) { bd.disabled = true; bd.textContent = 'Claimed'; $('dailyText').textContent = `Next reward in ${dur(wait / 1000)}.`; }
    else { bd.disabled = false; bd.textContent = `Claim ${uStr(C.DAILY)} USDF`; $('dailyText').textContent = 'Claim 25 USDF every day.'; }

    // game earnings
    const q = gameQueue();
    const sum = q.reduce((t, e) => t + e.amt, 0);
    const left = a ? gameLeftToday(a) : C.GAME_DAY;
    const can = Math.min(sum, left);
    $('gamePill').textContent = uStr(sum) + ' USDF';
    const by = {};
    for (const e of q) { by[e.g] = by[e.g] || { amt: 0, n: 0 }; by[e.g].amt += e.amt; by[e.g].n++; }
    $('gameList').innerHTML = Object.keys(by).map((g) => `<div class="game-row"><span>${esc(GAMES[g] || g)} <span class="muted">· ${by[g].n} ${by[g].n === 1 ? 'reward' : 'rewards'}</span></span><b class="num">${uStr(by[g].amt)}</b></div>`).join('');
    const bg = $('btnGames');
    const pendGame = P.pending(W.pub).some((t) => t.t === 'earn' && t.src !== 'daily');
    bg.disabled = !a || can <= 0 || pendGame;
    bg.className = 'btn wide' + (can > 0 ? ' primary' : '');
    bg.textContent = pendGame ? 'Claiming…' : can > 0 ? `Claim ${uStr(can)} USDF` : sum > 0 ? 'Daily game limit reached' : 'Nothing to claim yet';
    $('gameText').textContent = left < C.GAME_DAY ? `Games pay up to 100 USDF a day. ${uStr(left)} USDF left today.` : 'Score goals, land tricks and get barreled in Flynngames to earn USDF (up to 100 a day).';

    // activity
    $('wActivity').innerHTML = myActivity(8) || '<div class="empty">No activity yet. Claim your daily reward or start mining.</div>';
  }

  function myActivity(limit) {
    const s = st(), out = [];
    for (const tx of P.pending(W.pub)) out.push({ ts: tx.ts, html: itemHTML(describe(tx, s), '<span class="tag pending">Pending</span>') });
    const main = P.chain.main;
    for (let i = main.length - 1; i > 0 && out.length < 60; i--) {
      const b = P.chain.blocks.get(main[i]);
      for (let j = b.x.length - 1; j >= 0; j--) {
        const tx = b.x[j];
        if (tx.f === W.pub || tx.to === W.pub) out.push({ ts: b.ts, html: itemHTML(describe(tx, s), ago(b.ts)) });
      }
    }
    for (let i = s.trades.length - 1; i >= 0 && i > s.trades.length - 200; i--) {
      const t = s.trades[i];
      if (t.b !== W.pub && t.s !== W.pub) continue;
      const buy = t.b === W.pub;
      out.push({ ts: t.ts, html: itemHTML({ ico: buy ? 'buy' : 'sell', icon: 'i-trade', title: buy ? 'Bought VLT' : 'Sold VLT', sub: `at ${uStr(t.px)} USDF`, amt: `${buy ? '+' : '−'}${vHTML(t.amt)} VLT<i>${buy ? '−' : '+'}${uStr(V.mulDiv(t.amt, t.px, C.SAT, false))} USDF</i>` }, ago(t.ts)) });
    }
    out.sort((x, y) => y.ts - x.ts);
    return out.slice(0, limit).map((x) => x.html).join('');
  }

  $('btnDaily').onclick = () => submit(W.tx('earn', { src: 'daily', amt: C.DAILY }), 'Daily reward claimed: +25.00 USDF');

  // game rewards are dropped into localStorage by the games (they share this site's storage)
  function gameQueue() { const q = store.get('earn', []); return Array.isArray(q) ? q.filter((e) => e && GAMES[e.g] && Number.isInteger(e.amt) && e.amt > 0) : []; }
  function gameLeftToday(a) { const day = Math.floor(Date.now() / 86400000); return C.GAME_DAY - (a.gday === day ? a.gsum : 0); }
  $('btnGames').onclick = () => {
    const a = meAcct(); if (!a) return;
    let left = gameLeftToday(a);
    const q = gameQueue();
    const by = {};
    for (const e of q) by[e.g] = (by[e.g] || 0) + e.amt;
    let claimed = 0; let err = null;
    for (const g of Object.keys(by)) {
      let amt = Math.min(by[g], left);
      while (amt > 0 && !err) {
        const part = Math.min(amt, C.GAME_MAX);
        const tx = W.tx('earn', { src: 'game:' + g, amt: part, ts: Date.now() + claimed });
        err = P.submit(tx);
        if (!err) { watch(tx, 'game'); claimed += part; amt -= part; left -= part; by[g] -= part; }
      }
    }
    // keep anything over today's limit for tomorrow
    const rest = Object.keys(by).filter((g) => by[g] > 0).map((g) => ({ g, amt: by[g], why: 'carried over', ts: Date.now() }));
    store.set('earn', rest);
    if (err && !claimed) toast(err, 'err'); else toast(`Claiming ${uStr(claimed)} USDF from your games`, 'ok');
    invalidate();
  };

  // send / receive
  let sendAsset = 'V';
  function openModal(id) { $(id).hidden = false; const f = $(id).querySelector('input'); if (f) setTimeout(() => f.focus(), 30); }
  for (const m of document.querySelectorAll('.modal')) m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) { if (m.id !== 'onboard') m.hidden = true; } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const m of document.querySelectorAll('.modal')) if (m.id !== 'onboard') m.hidden = true; });
  $('btnSend').onclick = () => { $('sErr').textContent = ''; updateSendAvail(); openModal('sendModal'); };
  $('btnRecv').onclick = () => {
    const a = meAcct();
    $('recvName').textContent = a ? '@' + a.name : 'Wallet pending';
    $('recvAddr').textContent = W.pub;
    openModal('recvModal');
  };
  $('btnCopyAddr').onclick = () => copy(meAcct() ? meAcct().name : W.pub, 'Username copied');
  segment($('sAsset'), 'a', (v) => { sendAsset = v; $('sUnit').textContent = v === 'V' ? 'VLT' : 'USDF'; $('sAmt').placeholder = v === 'V' ? '0.00000000' : '0.00'; updateSendAvail(); });
  function updateSendAvail() { const a = meAcct(); $('sAvail').innerHTML = a ? (sendAsset === 'V' ? vHTML(a.V) + ' VLT' : uStr(a.U) + ' USDF') : '--'; }
  $('sendForm').onsubmit = (e) => {
    e.preventDefault();
    const to = pubOf($('sTo').value);
    const amt = sendAsset === 'V' ? parseV($('sAmt').value) : parseU($('sAmt').value);
    const err = $('sErr');
    if (!to) { err.textContent = 'No wallet has that username. Check the spelling.'; return; }
    if (to === W.pub) { err.textContent = 'That is your own wallet.'; return; }
    if (!amt) { err.textContent = sendAsset === 'V' ? 'Enter an amount, up to 8 decimal places.' : 'Enter an amount, up to 2 decimal places.'; return; }
    const fields = { to, a: sendAsset, amt };
    const memo = $('sMemo').value.trim(); if (memo) fields.memo = memo.slice(0, 60);
    const tx = W.tx('send', fields);
    const why = P.submit(tx);
    if (why) { err.textContent = niceErr(why); return; }
    watch(tx, 'send');
    $('sendModal').hidden = true;
    $('sAmt').value = ''; $('sMemo').value = '';
    toast(`Sending ${sendAsset === 'V' ? vStr(amt) + ' VLT' : uStr(amt) + ' USDF'} to ${nameOf(to)}`, 'ok');
    invalidate();
  };

  // recovery code
  let codeShown = false;
  $('btnShowCode').onclick = () => {
    codeShown = !codeShown;
    $('codeText').textContent = codeShown ? W.code() : 'VLT-•••••••• •••••••• •••••••• •••••••• •••••••• •••••••• •••••••• ••••••••';
    $('codeBox').classList.toggle('shown', codeShown);
    $('btnShowCode').textContent = codeShown ? 'Hide recovery code' : 'Show recovery code';
  };
  $('btnCopyCode').onclick = () => copy(W.code(), 'Recovery code copied. Keep it secret.');
  $('btnSwitch').onclick = () => openModal('switchModal');
  $('btnSwitchYes').onclick = () => {
    M.stop(); W.forget(); store.del('pendingName'); store.del('regtx');
    $('switchModal').hidden = true;
    showOnboard();
  };
  function copy(text, msg) {
    const done = () => toast(msg, 'ok');
    try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); } catch (e) { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text and copy it yourself.', 'err'); }
    t.remove();
  }

  // ------------------------------------------------------------ submitting and watching transactions
  const watching = new Map(); // tx id -> { kind, tx, msg }
  function watch(tx, kind, msg) { watching.set(tx.id, { kind, tx, msg }); }
  function submit(tx, msg) {
    const why = P.submit(tx);
    if (why) { toast(niceErr(why), 'err'); return false; }
    watch(tx, tx.t, msg);
    invalidate();
    return true;
  }
  function niceErr(why) {
    const map = {
      'not enough VLT': 'You do not have enough VLT for that.',
      'not enough USDF': 'You do not have enough USDF for that.',
      'name taken': 'That username is taken. Try another one.',
      'no wallet': 'Your wallet is still being confirmed. Try again in a moment.',
      'daily reward already claimed': 'You already claimed today. Come back tomorrow.',
      'order too small': 'The smallest order is 0.00001 VLT.',
      'too many open orders': 'You have 20 open orders. Cancel one first.',
    };
    return map[why] || why.charAt(0).toUpperCase() + why.slice(1) + '.';
  }
  function checkWatched() {
    const s = st();
    for (const [id, w] of watching) {
      if (!s.used.has(id)) continue;
      watching.delete(id);
      const tx = w.tx;
      if (tx.t === 'mine') {
        const r = s.rw && s.rw[id];
        if (r) { sessionMined += r; toast(`Reward confirmed: +${vStr(r)} VLT`, 'volt'); }
      } else if (tx.t === 'order') {
        const fills = s.trades.filter((t) => t.tx === id);
        const got = fills.reduce((t, f) => t + f.amt, 0);
        if (got) toast(`${tx.side === 'b' ? 'Bought' : 'Sold'} ${vStr(got)} VLT${got < tx.amt ? (tx.ioc ? ' (all the book had)' : ', rest is on the book') : ''}`, 'ok');
        else toast(tx.ioc ? 'Nothing matched your market order.' : `Order placed: ${tx.side === 'b' ? 'buy' : 'sell'} ${vStr(tx.amt)} VLT at ${uStr(tx.px)}`, 'ok');
      } else if (tx.t === 'reg') {
        toast(`Welcome to Voltcoin, ${s.acct[W.pub] ? s.acct[W.pub].name : ''}! +50.00 USDF`, 'volt', 6000);
        store.del('regtx');
      } else if (tx.t === 'send') toast(`Sent to ${nameOf(tx.to)}`, 'ok');
      else if (tx.t === 'cancel') toast('Order cancelled', 'ok');
      else if (tx.t === 'mint') toast(`Minted to ${nameOf(tx.to)}`, 'volt');
      else if (w.msg) toast(w.msg, 'ok');
    }
    // trades where somebody filled one of my resting orders
    const t = s.trades;
    for (let i = Math.max(lastTradeSeen, t.length - 50); i < t.length; i++) {
      const x = t[i];
      if (seenTradeIds.has(x.tx + i)) continue;
      if (x.ts < startedAt) continue;
      const mineRest = (x.b === W.pub && x.side === 's') || (x.s === W.pub && x.side === 'b');
      if (mineRest && !watching.has(x.tx)) toast(`Your order filled: ${x.b === W.pub ? 'bought' : 'sold'} ${vStr(x.amt)} VLT at ${uStr(x.px)}`, 'ok');
      seenTradeIds.add(x.tx + i);
    }
    lastTradeSeen = t.length;
  }
  let lastTradeSeen = 0;
  const seenTradeIds = new Set();
  const startedAt = Date.now();
  P.on((kind, d) => {
    if (kind === 'dropped' && d.tx.f === W.pub && watching.has(d.tx.id)) {
      watching.delete(d.tx.id);
      if (d.tx.t !== 'mine') toast('Not confirmed: ' + niceErr(d.why), 'err', 6000);
    }
    if (kind === 'chain') { checkWatched(); checkRegistration(); refreshNames(); M.refresh(staleJob); }
    invalidate();
  });

  // ------------------------------------------------------------ mining view
  let sessionMined = 0;
  const threadsEl = $('mThreads');
  threadsEl.max = M.maxThreads;
  threadsEl.value = Math.min(M.maxThreads, store.get('threads', M.defaultThreads));
  $('mThreadsVal').textContent = threadsEl.value;
  threadsEl.oninput = () => { $('mThreadsVal').textContent = threadsEl.value; store.set('threads', +threadsEl.value); if (M.running) M.setThreads(+threadsEl.value); };
  $('btnMine').onclick = () => {
    if (M.running) { M.stop(); invalidate(); return; }
    if (!meAcct()) { toast('Your wallet is still being confirmed. Try again in a moment.', 'err'); return; }
    M.start(+threadsEl.value, () => ({ ref: P.chain.tip.hash, d: V.mineDifficulty(st()) }), (proof) => {
      const tx = W.tx('mine', { ref: proof.ref, d: proof.d, pn: proof.pn });
      const why = P.submit(tx);
      if (why) toast('Proof rejected: ' + niceErr(why), 'err');
      else { watch(tx, 'mine'); toast('Found a winning hash! Waiting for the network…', 'volt'); }
    });
    invalidate();
  };
  function staleJob(job) {
    const s = st();
    const recent = s.recent.slice(-(C.REF_WINDOW - 3));
    return !recent.includes(job.ref) || job.d < V.mineDifficulty(s) * C.ACCEPT * 1.05;
  }
  M.on((k) => { if (k === 'found' || k === 'state') invalidate(); if (k === 'tick' && (view === 'mine' || !$('onboard').hidden)) { if (view === 'mine') renderMine(true); renderOnboardWork(); } });

  function renderMine(live) {
    const s = st();
    const d = V.mineDifficulty(s);
    $('v-mine').querySelector('.rig').classList.toggle('on', M.running);
    $('rigState').textContent = M.running ? 'Mining' : 'Idle';
    $('btnMine').querySelector('span').textContent = M.running ? 'Stop mining' : 'Start mining';
    $('mRate').textContent = M.running ? big(M.rate) + 'H/s' : '0 H/s';
    $('mEta').textContent = M.running && M.rate ? '≈ ' + dur(d / M.rate) : '--';
    $('mFound').textContent = M.found;
    $('mEarned').innerHTML = vHTML(sessionMined) + ' VLT';
    const tHex = V.C && window.VSHA.target(d).toString(16).padStart(13, '0');
    $('mTarget').textContent = tHex.slice(0, 13) + '…';
    const feed = $('hashFeed');
    feed.classList.toggle('idle', !M.samples.length);
    feed.innerHTML = M.samples.map((x) => {
      const z = (x.hash.match(/^0*/) || [''])[0];
      return `<li class="${x.win ? 'win' : ''}"><span class="n">${esc(x.nonce.slice(-7))}</span><span class="h"><span class="z">${z}</span>${x.hash.slice(z.length, 40)}</span>${x.win ? '<b>WIN</b>' : ''}</li>`;
    }).join('');
    if (live) return;
    const r = V.mineReward(s);
    $('mReward').innerHTML = `${vHTML(r)} <small>VLT</small>`;
    $('mHalving').textContent = r > 0 ? `Halves to ${vStr(Math.floor(r / 2))} VLT in ${C.HALVING - (s.nProofs % C.HALVING)} rewards` : 'Every Voltcoin has been mined';
    $('mSupplyBar').style.width = Math.min(100, (s.minedV / MAX_MINED) * 100).toFixed(2) + '%';
    $('mSupply').innerHTML = `${vHTML(s.minedV)} VLT mined`;
    $('mCap').textContent = `of about ${Math.round(MAX_MINED / C.SAT)} VLT that can ever be mined`;
    const f = V.difficultyParts(s);
    $('fBase').textContent = big(f.base);
    $('fSupply').textContent = f.supplyF.toFixed(2) + '×';
    $('fPrice').textContent = f.priceF.toFixed(2) + '×';
    $('fTotal').textContent = big(f.total);
    drawDiff();
  }

  // ------------------------------------------------------------ canvas helpers
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function prep(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  function drawDiff() {
    const cv = $('diffChart');
    if (!cv.offsetParent) return;
    const { g, w, h } = prep(cv);
    const s = st();
    const pf = V.difficultyParts(s).priceF;
    const supply = s.supplyV / C.SAT;
    const xMax = Math.max(5, Math.ceil(supply + 0.5));
    const dAt = (x) => C.MINE_BASE * Math.pow(2, x * C.SUPPLY_STEEP) * pf;
    const yMin = Math.log10(dAt(0)), yMax = Math.log10(dAt(xMax));
    const L = 44, R = 26, T = 16, B = 22;
    const X = (x) => L + (x / xMax) * (w - L - R);
    const Y = (d) => T + (1 - (Math.log10(d) - yMin) / (yMax - yMin)) * (h - T - B);
    g.font = '11px ' + css('--f-num');
    g.strokeStyle = css('--line'); g.fillStyle = css('--muted'); g.lineWidth = 1;
    for (let k = Math.ceil(yMin); k <= Math.floor(yMax); k++) {
      const y = Y(Math.pow(10, k));
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(big(Math.pow(10, k)), L - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let x = 0; x <= xMax; x++) g.fillText(x + (x === 0 ? ' VLT' : ''), X(x), h - B + 6);
    // the curve, filled up to "now"
    g.beginPath(); g.moveTo(X(0), Y(dAt(0)));
    for (let i = 1; i <= 100; i++) { const x = (i / 100) * xMax; g.lineTo(X(x), Y(dAt(x))); }
    g.strokeStyle = css('--line-2'); g.lineWidth = 2; g.stroke();
    g.beginPath(); g.moveTo(X(0), h - B);
    for (let i = 0; i <= 60; i++) { const x = (i / 60) * supply; g.lineTo(X(x), Y(dAt(x))); }
    g.lineTo(X(supply), h - B); g.closePath();
    g.fillStyle = css('--volt-glow'); g.fill();
    g.beginPath(); g.moveTo(X(0), Y(dAt(0)));
    for (let i = 1; i <= 60; i++) { const x = (i / 60) * supply; g.lineTo(X(x), Y(dAt(x))); }
    g.strokeStyle = css('--volt'); g.lineWidth = 2; g.stroke();
    const cx = X(supply), cy = Y(dAt(supply));
    g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fillStyle = css('--volt'); g.fill();
    g.fillStyle = css('--text'); g.textAlign = cx > w - 90 ? 'right' : 'left'; g.textBaseline = 'bottom';
    g.font = '600 11px ' + css('--f-ui');
    g.fillText('You are here', cx + (cx > w - 90 ? -9 : 9), cy - 4);
  }

  // ------------------------------------------------------------ trade view
  let side = 'b', otype = 'limit', range = '1d', priceTouched = false;
  segment($('sideSeg'), 's', (v) => { side = v; priceTouched = false; updateForm(true); });
  segment($('typeSeg'), 't', (v) => { otype = v; updateForm(true); });
  segment($('rangeSeg'), 'r', (v) => { range = v; drawPrice(); });
  for (const b of $('pcts').querySelectorAll('button')) b.onclick = () => {
    const a = meAcct(); if (!a) return;
    const p = +b.dataset.p / 100;
    if (side === 's') $('oAmt').value = vStr(Math.floor(a.V * p));
    else {
      const px = otype === 'market' ? bestAsk() : parseU($('oPrice').value);
      if (!px) { $('oErr').textContent = 'Set a price first.'; return; }
      $('oAmt').value = vStr(Math.floor((a.U * p * C.SAT) / px));
    }
    updateForm();
  };
  $('oPrice').oninput = () => { priceTouched = true; updateForm(); };
  $('oAmt').oninput = () => updateForm();
  const bestAsk = () => { const s = st(); return s.asks.length ? s.orders[s.asks[0]].px : 0; };
  const bestBid = () => { const s = st(); return s.bids.length ? s.orders[s.bids[0]].px : 0; };

  // walk the book to see what a market order of `amt` would cost
  function marketQuote(amt) {
    const s = st(), list = side === 'b' ? s.asks : s.bids;
    let left = amt, cost = 0, worst = 0;
    for (const id of list) {
      const o = s.orders[id];
      if (o.f === W.pub) continue;
      const f = Math.min(left, o.amt);
      cost += V.mulDiv(f, o.px, C.SAT, false); worst = o.px; left -= f;
      if (!left) break;
    }
    return { filled: amt - left, cost, worst };
  }

  function updateForm(reset) {
    const a = meAcct();
    const btn = $('oSubmit');
    btn.className = 'btn wide big-btn ' + (side === 'b' ? 'buy' : 'sell');
    btn.textContent = (side === 'b' ? 'Buy' : 'Sell') + ' VLT';
    $('fPriceWrap').hidden = otype === 'market';
    if ((reset || !priceTouched) && otype === 'limit') {
      const p = side === 'b' ? (bestAsk() || lastPx() || bestBid()) : (bestBid() || lastPx() || bestAsk());
      if (p && !priceTouched) $('oPrice').value = (p / 100).toFixed(2);
    }
    $('oAvail').innerHTML = a ? (side === 'b' ? uStr(a.U) + ' USDF' : vHTML(a.V) + ' VLT') : '--';
    const amt = parseV($('oAmt').value) || 0;
    let total = 0;
    if (otype === 'market') { const q = marketQuote(amt); total = q.cost; }
    else { const px = parseU($('oPrice').value) || 0; total = V.mulDiv(amt, px, C.SAT, side === 'b'); }
    $('oTotal').textContent = (otype === 'market' && amt ? '≈ ' : '') + uStr(total) + ' USDF';
    $('oErr').textContent = '';
  }

  $('orderForm').onsubmit = (e) => {
    e.preventDefault();
    const err = $('oErr');
    if (!meAcct()) { err.textContent = 'Your wallet is still being confirmed.'; return; }
    const amt = parseV($('oAmt').value);
    if (!amt) { err.textContent = 'Enter an amount of VLT, up to 8 decimal places.'; return; }
    let px, ioc = false;
    if (otype === 'market') {
      const q = marketQuote(amt);
      if (!q.filled) { err.textContent = side === 'b' ? 'Nobody is selling right now. Place a limit order instead.' : 'Nobody is buying right now. Place a limit order instead.'; return; }
      px = side === 'b' ? Math.ceil(q.worst * 1.02) : Math.floor(q.worst * 0.98);
      px = Math.max(1, px);
      ioc = true;
    } else {
      px = parseU($('oPrice').value);
      if (!px) { err.textContent = 'Enter a price in USDF.'; return; }
    }
    const fields = { side, px, amt };
    if (ioc) fields.ioc = true;
    const tx = W.tx('order', fields);
    const why = P.submit(tx);
    if (why) { err.textContent = niceErr(why); return; }
    watch(tx, 'order');
    $('oAmt').value = '';
    toast('Order sent', 'info', 2000);
    updateForm();
    invalidate();
  };

  function levels(list, s) {
    const m = new Map();
    for (const id of list) { const o = s.orders[id]; const l = m.get(o.px) || { px: o.px, amt: 0, mine: false }; l.amt += o.amt; if (o.f === W.pub) l.mine = true; m.set(o.px, l); }
    return [...m.values()];
  }
  function renderTrade() {
    const s = st(), s24 = stats24();
    $('tPrice').textContent = s24.last ? uStr(s24.last) : '--';
    const c = $('tChg'); c.textContent = s24.last ? (s24.chg >= 0 ? '+' : '') + (s24.chg * 100).toFixed(2) + '%' : '--'; c.className = 'num ' + (s24.chg > 0 ? 'up' : s24.chg < 0 ? 'down' : '');
    $('tHigh').textContent = s24.hi ? uStr(s24.hi) : '--';
    $('tLow').textContent = s24.lo ? uStr(s24.lo) : '--';
    $('tVol').textContent = uStr(s24.vol) + ' USDF';
    // book
    const asks = levels(s.asks, s).slice(0, 9), bids = levels(s.bids, s).slice(0, 9);
    const maxQ = Math.max(1, ...asks.map((l) => l.amt), ...bids.map((l) => l.amt));
    const row = (l) => `<div class="lvl${l.mine ? ' mine' : ''}" data-px="${l.px}"><i style="width:${((l.amt / maxQ) * 100).toFixed(1)}%"></i><span>${uStr(l.px)}</span><span>${vStr(l.amt)}</span><span>${uStr(V.mulDiv(l.amt, l.px, C.SAT, false))}</span></div>`;
    $('bookAsks').innerHTML = asks.length ? asks.slice().reverse().map(row).join('') : '<div class="none">No sell orders</div>';
    $('bookBids').innerHTML = bids.length ? bids.map(row).join('') : '<div class="none">No buy orders</div>';
    $('bookMid').textContent = s24.last ? uStr(s24.last) : '--';
    $('bookMid').className = 'num ' + (s24.chg > 0 ? 'up' : s24.chg < 0 ? 'down' : '');
    const ba = bestAsk(), bb = bestBid();
    $('bookSpread').textContent = ba && bb ? `Spread ${uStr(ba - bb)}` : '';
    // my orders
    const mine = Object.values(s.orders).filter((o) => o.f === W.pub).sort((x, y) => y.seq - x.seq);
    $('myOrders').querySelector('tbody').innerHTML = mine.map((o) => `<tr><td class="${o.side === 'b' ? 'up' : 'down'}"><b>${o.side === 'b' ? 'Buy' : 'Sell'}</b></td><td class="num">${uStr(o.px)}</td><td class="num">${vStr(o.amt)}</td><td class="num muted">${((1 - o.amt / o.orig) * 100).toFixed(0)}%</td><td class="r"><button class="cancel-btn" data-oid="${o.id}" type="button">Cancel</button></td></tr>`).join('');
    $('myOrdersEmpty').hidden = mine.length > 0;
    $('myOrders').hidden = !mine.length;
    // trades
    const tr = s.trades.slice(-40).reverse();
    $('recentTrades').innerHTML = tr.length ? tr.map((t) => `<div class="row"><span class="${t.side === 'b' ? 'up' : 'down'}">${uStr(t.px)}</span><span>${vStr(t.amt)}</span><span>${clock(t.ts)}</span></div>`).join('') : '<div class="empty small">No trades yet.</div>';
    updateForm();
    drawPrice();
  }
  $('bookAsks').onclick = $('bookBids').onclick = (e) => {
    const l = e.target.closest('.lvl'); if (!l) return;
    if (otype !== 'limit') { otype = 'limit'; setSeg($('typeSeg'), 't', 'limit'); }
    $('oPrice').value = (+l.dataset.px / 100).toFixed(2); priceTouched = true; updateForm();
  };
  $('myOrders').onclick = (e) => {
    const b = e.target.closest('.cancel-btn'); if (!b) return;
    if (P.pending(W.pub).some((t) => t.t === 'cancel' && t.oid === b.dataset.oid)) return;
    b.disabled = true; b.textContent = 'Cancelling';
    submit(W.tx('cancel', { oid: b.dataset.oid }));
  };

  function drawPrice() {
    const cv = $('priceChart');
    if (!cv.offsetParent) return;
    const { g, w, h } = prep(cv);
    const all = st().trades;
    $('chartEmpty').hidden = all.length > 0;
    if (!all.length) return;
    const now = Date.now();
    const spans = { '1h': 3600e3, '1d': 86400e3, '1w': 7 * 86400e3 };
    let start = range === 'all' ? Math.min(all[0].ts, now - 3600e3) : now - spans[range];
    const bucket = range === '1h' ? 60e3 : range === '1d' ? 15 * 60e3 : range === '1w' ? 2 * 3600e3 : Math.max(60e3, Math.ceil((now - start) / 70 / 60e3) * 60e3);
    start = Math.floor(start / bucket) * bucket;
    const n = Math.ceil((now - start) / bucket);
    let prev = 0;
    for (const t of all) { if (t.ts < start) prev = t.px; else break; }
    const candles = [];
    let i0 = all.findIndex((t) => t.ts >= start); if (i0 < 0) i0 = all.length;
    for (let k = 0; k < n; k++) {
      const b0 = start + k * bucket, b1 = b0 + bucket;
      let o = 0, hi = 0, lo = 0, c = 0, vol = 0;
      while (i0 < all.length && all[i0].ts < b1) {
        const t = all[i0++];
        if (!o) { o = prev || t.px; hi = Math.max(o, t.px); lo = Math.min(o, t.px); }
        hi = Math.max(hi, t.px); lo = Math.min(lo, t.px); c = t.px; vol += V.mulDiv(t.amt, t.px, C.SAT, false);
      }
      if (o) { candles.push({ o, hi, lo, c, vol, k }); prev = c; }
      else if (prev) candles.push({ o: prev, hi: prev, lo: prev, c: prev, vol: 0, k, flat: true });
    }
    if (!candles.length) return;
    let yLo = Math.min(...candles.map((x) => x.lo)), yHi = Math.max(...candles.map((x) => x.hi));
    if (yHi === yLo) { yHi *= 1.05; yLo *= 0.95; }
    const pad = (yHi - yLo) * 0.1; yHi += pad; yLo = Math.max(0, yLo - pad);
    const R = 70, B = 24, T = 8;
    const volH = (h - B - T) * 0.16;
    const plotH = h - B - T - volH - 6;
    const cw = (w - R) / n;
    const X = (k) => k * cw + cw / 2;
    const Y = (p) => T + (1 - (p - yLo) / (yHi - yLo)) * plotH;
    const up = css('--up'), down = css('--down'), line = css('--line'), muted = css('--muted');
    g.font = '11px ' + css('--f-num');
    // grid + price axis
    g.strokeStyle = line; g.fillStyle = muted; g.lineWidth = 1; g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const p = yLo + ((yHi - yLo) * k) / 4, y = Math.round(Y(p)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w - R, y); g.stroke();
      g.fillText(uStr(p), w - R + 8, y);
    }
    // time axis
    g.textAlign = 'center'; g.textBaseline = 'top';
    const labels = Math.min(6, Math.max(2, Math.floor((w - R) / 110)));
    for (let k = 0; k < labels; k++) {
      const idx = Math.round(((k + 0.5) / labels) * (n - 1));
      const ts = start + idx * bucket;
      const txt = range === '1w' || range === 'all' && now - start > 2 * 86400e3 ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      g.fillText(txt, X(idx), h - B + 7);
    }
    // volume
    const maxVol = Math.max(1, ...candles.map((x) => x.vol));
    const vBase = h - B;
    for (const x of candles) {
      if (!x.vol) continue;
      const vh = (x.vol / maxVol) * volH;
      g.fillStyle = x.c >= x.o ? 'rgba(31,203,139,0.25)' : 'rgba(240,70,90,0.25)';
      g.fillRect(X(x.k) - Math.max(1, cw * 0.32), vBase - vh, Math.max(2, cw * 0.64), vh);
    }
    // candles
    const bw = Math.max(1.5, Math.min(14, cw * 0.64));
    for (const x of candles) {
      const col = x.flat ? css('--faint') : x.c >= x.o ? up : down;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      const cx = Math.round(X(x.k)) + 0.5;
      g.beginPath(); g.moveTo(cx, Y(x.hi)); g.lineTo(cx, Y(x.lo)); g.stroke();
      const y1 = Y(Math.max(x.o, x.c)), y2 = Y(Math.min(x.o, x.c));
      g.fillRect(cx - bw / 2, y1, bw, Math.max(1, y2 - y1));
    }
    // last price line
    const last = all[all.length - 1].px, ly = Math.round(Y(last)) + 0.5;
    const lc = candles[candles.length - 1];
    const col = lc.c >= lc.o ? up : down;
    g.setLineDash([3, 4]); g.strokeStyle = col; g.beginPath(); g.moveTo(0, ly); g.lineTo(w - R, ly); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.fillRect(w - R + 2, ly - 10, R - 4, 20);
    g.fillStyle = lc.c >= lc.o ? '#00160d' : '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = '600 11px ' + css('--f-num');
    g.fillText(uStr(last), w - R + 7, ly);
  }

  // ------------------------------------------------------------ leaderboard
  let lb = 'rich';
  segment($('lbSeg'), 'l', (v) => { lb = v; renderLeaders(); });
  function renderLeaders() {
    const s = st(), px = lastPx();
    const accts = Object.entries(s.acct).map(([pub, a]) => ({ pub, a }));
    const holders = accts.filter((x) => x.a.V + x.a.lV > 0).length;
    $('sHolders').textContent = holders.toLocaleString();
    $('sSupply').innerHTML = vHTML(s.supplyV);
    $('sMined').innerHTML = vHTML(s.minedV);
    $('sMinted').innerHTML = vHTML(s.mintedV);
    const cfg = {
      rich: { title: 'Rich list', col: 'VLT', val: (a) => a.V + a.lV, fmt: (v) => vHTML(v), share: (v) => s.supplyV ? v / s.supplyV : 0 },
      worth: { title: 'Net worth', col: 'USDF', val: (a) => a.U + a.lU + (px ? V.mulDiv(a.V + a.lV, px, C.SAT, false) : 0), fmt: (v) => uStr(v), share: null },
      miners: { title: 'Top miners', col: 'VLT mined', val: (a) => a.mined, fmt: (v) => vHTML(v), share: (v) => s.minedV ? v / s.minedV : 0, extra: (a) => `${a.nMined} ${a.nMined === 1 ? 'reward' : 'rewards'}` },
      traders: { title: 'Top traders', col: 'Volume (USDF)', val: (a) => a.vol, fmt: (v) => uStr(v), share: null },
    }[lb];
    $('lbTitle').textContent = cfg.title;
    $('lbCol').textContent = cfg.col;
    $('lbCol2').textContent = cfg.share ? 'Share' : cfg.extra ? '' : '';
    const rows = accts.map((x) => ({ ...x, v: cfg.val(x.a) })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 50);
    $('lbEmpty').hidden = rows.length > 0;
    $('lbTable').querySelector('tbody').innerHTML = rows.map((x, i) => {
      const sh = cfg.share ? cfg.share(x.v) : null;
      return `<tr class="${x.pub === W.pub ? 'me-row' : ''}"><td><span class="rank r${i + 1}">${i + 1}</span></td><td><span class="who">${avatar(x.pub, x.a.name)}<b>${esc(x.a.name)}</b>${x.pub === W.pub ? '<span class="you">You</span>' : ''}</span></td><td class="r num">${cfg.fmt(x.v)}</td><td class="r num hide-sm muted">${sh !== null ? (sh * 100).toFixed(1) + '%<span class="share-bar"><i style="width:' + (sh * 100).toFixed(1) + '%"></i></span>' : cfg.extra ? cfg.extra(x.a) : ''}</td></tr>`;
    }).join('');
  }

  // ------------------------------------------------------------ ledger
  let lg = 'all', lgLimit = 60;
  segment($('lgSeg'), 'g', (v) => { lg = v; lgLimit = 60; renderLedger(); });
  $('btnMoreLedger').onclick = () => { lgLimit += 60; renderLedger(); };
  function renderLedger() {
    const s = st();
    $('chainLine').innerHTML = `<span>Height <b>${s.h.toLocaleString()}</b></span><span>Transactions <b>${s.nTx.toLocaleString()}</b></span><span>Pending <b>${P.mempool.size}</b></span><span>Latest block <b>${esc(P.chain.tip.hash.slice(0, 16))}…</b></span>`;
    const out = [];
    if (lg === 'trade') {
      for (let i = s.trades.length - 1; i >= 0 && out.length < lgLimit + 1; i--) {
        const t = s.trades[i];
        out.push(itemHTML({ ico: t.side === 'b' ? 'buy' : 'sell', icon: 'i-trade', title: `${esc(nameOf(t.b))} bought from ${esc(nameOf(t.s))}`, sub: `at ${uStr(t.px)} USDF`, amt: `${vHTML(t.amt)} VLT<i>${uStr(V.mulDiv(t.amt, t.px, C.SAT, false))} USDF</i>` }, `<span class="blk">#${t.h}</span> · ${ago(t.ts)}`));
      }
    } else {
      const main = P.chain.main;
      for (let i = main.length - 1; i > 0 && out.length < lgLimit + 1; i--) {
        const b = P.chain.blocks.get(main[i]);
        for (let j = b.x.length - 1; j >= 0 && out.length < lgLimit + 1; j--) {
          const tx = b.x[j];
          const d = describe(tx, s);
          if (lg === 'mint' && d.cat !== 'mint') continue;
          if (lg === 'mine' && d.cat !== 'mine') continue;
          if (lg === 'send' && d.cat !== 'send') continue;
          if (lg === 'me' && tx.f !== W.pub && tx.to !== W.pub) continue;
          out.push(itemHTML(d, `<span class="blk">#${b.h}</span> · ${ago(b.ts)}`, d.cat === 'mint' ? 'is-mint' : ''));
        }
      }
    }
    $('btnMoreLedger').hidden = out.length <= lgLimit;
    $('ledgerList').innerHTML = out.slice(0, lgLimit).join('') || '<div class="empty">Nothing here yet.</div>';
  }

  // ------------------------------------------------------------ admin (the mint)
  let mintAsset = 'V';
  segment($('mintAsset'), 'a', (v) => { mintAsset = v; $('mintUnit').textContent = v === 'V' ? 'VLT' : 'USDF'; $('mintAmt').placeholder = v === 'V' ? '0.001' : '100.00'; renderAdmin(); });
  $('mintAmt').oninput = () => renderAdmin();
  $('adminLock').onsubmit = (e) => {
    e.preventDefault();
    if (W.unlockAdmin($('adminPass').value)) { $('adminPass').value = ''; $('adminLockErr').textContent = ''; toast('Mint unlocked on this device', 'volt'); renderAdmin(); }
    else $('adminLockErr').textContent = 'That passphrase is not the mint key.';
  };
  $('adminMint').onsubmit = (e) => {
    e.preventDefault();
    const err = $('mintErr');
    const to = pubOf($('mintTo').value);
    const amt = mintAsset === 'V' ? parseV($('mintAmt').value) : parseU($('mintAmt').value);
    if (!to) { err.textContent = 'No wallet has that username.'; return; }
    if (!amt) { err.textContent = 'Enter an amount.'; return; }
    const fields = { to, a: mintAsset, amt };
    const memo = $('mintMemo').value.trim(); if (memo) fields.memo = memo.slice(0, 60);
    const tx = W.adminTx('mint', fields);
    const why = P.submit(tx);
    if (why) { err.textContent = niceErr(why); return; }
    err.textContent = '';
    watch(tx, 'mint');
    $('mintAmt').value = ''; $('mintMemo').value = '';
    toast(`Minting ${mintAsset === 'V' ? vStr(amt) + ' VLT' : uStr(amt) + ' USDF'} to ${nameOf(to)}`, 'volt');
    renderAdmin();
  };
  function renderAdmin() {
    const on = !!W.admin;
    $('adminLock').hidden = on; $('adminMint').hidden = !on;
    $('adminPill').textContent = on ? 'Unlocked' : 'Locked';
    $('adminPill').className = 'pill' + (on ? ' volt' : '');
    const s = st();
    const amt = mintAsset === 'V' ? (parseV($('mintAmt').value) || 0) : 0;
    const now = V.mineDifficulty(s);
    const after = Math.round(now * Math.pow(2, (amt / C.SAT) * C.SUPPLY_STEEP));
    $('mintDiff').textContent = amt ? `${big(now)} → ${big(after)} hashes` : `${big(now)} hashes (no change)`;
    const out = [];
    const main = P.chain.main;
    for (let i = main.length - 1; i > 0 && out.length < 40; i--) {
      const b = P.chain.blocks.get(main[i]);
      for (const tx of b.x) if (tx.t === 'mint') out.push(itemHTML(describe(tx, s), `<span class="blk">#${b.h}</span> · ${ago(b.ts)}`, 'is-mint'));
    }
    $('mintHistory').innerHTML = out.join('') || '<div class="empty">No coins have been minted yet.</div>';
  }

  // ------------------------------------------------------------ segmented controls
  function segment(el, key, fn) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
      setSeg(el, key, b.dataset[key]);
      fn(b.dataset[key]);
    });
  }
  function setSeg(el, key, val) { for (const x of el.querySelectorAll('button')) x.classList.toggle('on', x.dataset[key] === val); }

  let knownNames = -1;
  function refreshNames() {
    const names = Object.values(st().acct).map((a) => a.name);
    if (names.length === knownNames) return;
    knownNames = names.length;
    $('nameList').innerHTML = names.sort().map((n) => `<option value="${esc(n)}">`).join('');
  }

  // ------------------------------------------------------------ onboarding
  function showOnboard(msg) {
    $('onboard').hidden = false;
    $('obStart').hidden = false; $('obRestore').hidden = true; $('obWork').hidden = true;
    $('obErr').textContent = msg || '';
    setTimeout(() => $('obName').focus(), 50);
  }
  $('obRestoreBtn').onclick = () => { $('obStart').hidden = true; $('obRestore').hidden = false; $('obRestoreErr').textContent = ''; $('obCode').focus(); };
  $('obBackBtn').onclick = () => showOnboard();
  $('obRestoreForm').onsubmit = (e) => {
    e.preventDefault();
    const hex = W.parseCode($('obCode').value);
    if (!hex) { $('obRestoreErr').textContent = 'That code does not look right. It has 64 letters and numbers after VLT-.'; return; }
    W.restore(hex);
    $('obCode').value = '';
    afterWallet();
    $('onboard').hidden = true;
    toast(meAcct() ? `Welcome back, ${meAcct().name}` : 'Wallet restored. Looking for it on the network…', 'ok');
  };
  let obWorking = false;
  $('obForm').onsubmit = async (e) => {
    e.preventDefault();
    if (obWorking) return;
    const name = $('obName').value.trim();
    const err = $('obErr');
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { err.textContent = 'Use 3 to 16 letters, numbers or underscores.'; return; }
    if (pubOf(name)) { err.textContent = 'That username is taken. Try another one.'; return; }
    obWorking = true;
    $('obStart').hidden = true; $('obWork').hidden = false;
    $('obStep').textContent = 'Generating your keys';
    W.create(); W.persist();
    store.set('pendingName', name);
    M.hashes = 0;
    await new Promise((r) => setTimeout(r, 400));
    $('obStep').textContent = 'Doing proof of work';
    const pn = await M.pow(V.regSeed(W.pub), C.REG_D);
    $('obBar').style.width = '100%';
    $('obStep').textContent = 'Broadcasting to the network';
    const tx = W.tx('reg', { name, pn });
    const why = P.submit(tx);
    obWorking = false;
    if (why) { W.forget(); showOnboard(niceErr(why)); return; }
    store.set('regtx', tx);
    watch(tx, 'reg');
    afterWallet();
    setTimeout(() => { $('onboard').hidden = true; }, 500);
  };
  function renderOnboardWork() {
    if ($('obWork').hidden) return;
    $('obHashes').textContent = M.hashes.toLocaleString() + ' hashes';
    $('obBar').style.width = Math.min(96, (M.hashes / C.REG_D) * 60).toFixed(1) + '%';
  }

  // if our sign-up never made it into a block (or someone took the name first), deal with it
  let regRetry = 0;
  function checkRegistration() {
    if (!W.pub || meAcct()) return;
    const tx = store.get('regtx', null);
    if (!tx || tx.f !== W.pub) return;
    if (P.mempool.has(tx.id)) return;
    if (Date.now() - regRetry < 20000) return;
    regRetry = Date.now();
    const why = V.dryRun(st(), tx);
    if (why === 'name taken') { store.del('regtx'); store.del('pendingName'); W.forget(); showOnboard('Someone took that username first. Pick another one.'); return; }
    if (!why || why === 'too old') {
      const fresh = why === 'too old' ? W.tx('reg', { name: tx.name, pn: tx.pn }) : tx;
      if (!P.submit(fresh)) { store.set('regtx', fresh); watch(fresh, 'reg'); }
    }
  }

  function afterWallet() {
    const a = meAcct();
    P.setIdentity(W.pub, a ? a.name : store.get('pendingName', ''));
    invalidate();
  }

  // ------------------------------------------------------------ resize + timers
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (view === 'trade') drawPrice(); if (view === 'mine') drawDiff(); }).observe(document.body);
  }
  setInterval(() => { checkRegistration(); invalidate(); }, 5000);
  addEventListener('storage', (e) => { if (e.key === 'voltcoin:earn') invalidate(); });

  // ------------------------------------------------------------ boot
  P.start();
  if (W.load()) afterWallet(); else showOnboard();
  refreshNames();
  route();
})();
