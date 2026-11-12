// Voltcoin - the blockchain: transactions, blocks, the rules every copy of the app checks, and the exchange.
// Nothing here trusts anybody: every browser replays every block and throws out anything that breaks a rule.
(function (root) {
  'use strict';
  const S = root.VSHA;
  const nacl = root.nacl;

  // ---------------------------------------------------------------- the rules
  const C = {
    SAT: 100000000,            // 1 VLT = 100,000,000 sats
    CENT: 100,                 // 1 USDF = 100 cents
    ADMIN: '1e076790a47227197e07302e7c535e621e3b180b2a24238cbc1d6bf9a7c489dd', // the mint's public key
    GENESIS_TS: Date.UTC(2026, 10, 12),
    BLOCK_D: 4096,             // tiny proof of work to seal a block
    REG_D: 2000000,            // proof of work to open a wallet (stops spam accounts)
    MINE_BASE: 25000000,       // hashes to mine one reward at the very start
    SUPPLY_STEEP: 2,           // difficulty doubles every 0.5 VLT that exists
    PRICE_REF: 5000,           // and goes up 1x for every 5,000 USDF the price climbs
    REWARD0: 1000000,          // first reward: 0.01 VLT
    HALVING: 250,              // the reward halves every 250 rewards
    ACCEPT: 0.8,               // a proof still counts if difficulty rose by up to 25% while you mined
    REF_WINDOW: 12,            // a proof must build on one of the last 12 blocks
    WELCOME: 5000,             // 50 USDF to start
    DAILY: 2500,               // 25 USDF a day
    DAILY_GAP: 20 * 3600000,
    GAME_MAX: 2500,            // one game claim: up to 25 USDF
    GAME_DAY: 10000,           // games pay up to 100 USDF a day
    MIN_ORDER: 1000,           // smallest order: 0.00001 VLT
    MAX_ORDERS: 20,
    MAX_TX: 60,
    MAX_PRICE: 100000000000,   // 1 billion USDF per VLT
    MAX_AMT: 1e15,
    TRADES_KEEP: 4000,
  };

  // ---------------------------------------------------------------- helpers
  const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const bytesOf = (h) => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };
  const isHex = (h, n) => typeof h === 'string' && h.length === n && /^[0-9a-f]+$/.test(h);
  const isInt = (n) => Number.isSafeInteger(n);
  const canon = (o) => {
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
    return JSON.stringify(o);
  };
  const txBody = (tx) => { const b = Object.assign({}, tx); delete b.sig; delete b.id; return b; };
  const txId = (tx) => S.hex(canon(txBody(tx)));
  const mulDiv = (a, b, c, up) => { const p = BigInt(a) * BigInt(b), q = BigInt(c); return Number(up ? (p + q - 1n) / q : p / q); };
  const fail = (msg) => { const e = new Error(msg); e.rule = true; throw e; };

  const regSeed = (pub) => S.hex('VLT-REG|' + pub);
  const mineSeed = (ref, pub) => S.hex('VLT1|' + ref + '|' + pub);
  const powHash = (seed, nonce) => S.hex(seed + nonce);

  function sign(tx, secretKey) {
    tx.id = txId(tx);
    tx.sig = hexOf(nacl.sign.detached(S.utf8(tx.id), secretKey));
    return tx;
  }

  const verified = new Set();
  function checkSig(tx) {
    if (!isHex(tx.f, 64) || !isHex(tx.sig || '', 128)) fail('bad signature');
    const id = txId(tx);
    if (tx.id !== id) fail('bad id');
    if (verified.has(id)) return;
    if (!nacl.sign.detached.verify(S.utf8(id), bytesOf(tx.sig), bytesOf(tx.f))) fail('bad signature');
    verified.add(id);
  }

  // ---------------------------------------------------------------- state
  function freshState() {
    return {
      h: 0, tip: '', ts: C.GENESIS_TS,
      acct: {}, names: {}, orders: {}, bids: [], asks: [],
      supplyV: 0, minedV: 0, mintedV: 0, nProofs: 0, supplyU: 0, mintedU: 0,
      trades: [], used: new Set(), recent: [], nTx: 0, rw: {},
    };
  }

  function newAcct(name, ts) {
    return { name, V: 0, U: 0, lV: 0, lU: 0, mined: 0, nMined: 0, vol: 0, daily: 0, gday: -1, gsum: 0, joined: ts, nOpen: 0 };
  }

  function refPrice(s) {
    const t = s.trades;
    if (!t.length) return 0;
    const last = t.slice(-15).map((x) => x.px).sort((a, b) => a - b);
    return last[last.length >> 1] / C.CENT;
  }

  // the two numbers that make Voltcoin rarer over time
  function mineDifficulty(s) {
    const supplyF = Math.pow(2, (s.supplyV / C.SAT) * C.SUPPLY_STEEP);
    const priceF = 1 + refPrice(s) / C.PRICE_REF;
    return Math.round(C.MINE_BASE * supplyF * priceF);
  }
  function difficultyParts(s) {
    return { base: C.MINE_BASE, supplyF: Math.pow(2, (s.supplyV / C.SAT) * C.SUPPLY_STEEP), priceF: 1 + refPrice(s) / C.PRICE_REF, total: mineDifficulty(s) };
  }
  const mineReward = (s) => Math.floor(C.REWARD0 / Math.pow(2, Math.floor(s.nProofs / C.HALVING)));

  // ---------------------------------------------------------------- the order book
  function sortBook(s) {
    const o = s.orders;
    s.bids.sort((a, b) => o[b].px - o[a].px || o[a].seq - o[b].seq);
    s.asks.sort((a, b) => o[a].px - o[b].px || o[a].seq - o[b].seq);
  }

  function closeOrder(s, id) {
    const o = s.orders[id];
    const a = s.acct[o.f];
    if (o.side === 'b') { a.U += o.lock; a.lU -= o.lock; } else { a.V += o.lock; a.lV -= o.lock; }
    a.nOpen--;
    delete s.orders[id];
    const list = o.side === 'b' ? s.bids : s.asks;
    const i = list.indexOf(id); if (i >= 0) list.splice(i, 1);
  }

  function trade(s, buyer, seller, fill, px, ts, txid, side) {
    const cost = mulDiv(fill, px, C.SAT, false);
    s.trades.push({ ts, px, amt: fill, b: buyer, s: seller, side, tx: txid, h: s.h + 1 });
    if (s.trades.length > C.TRADES_KEEP) s.trades.splice(0, s.trades.length - C.TRADES_KEEP);
    s.acct[buyer].vol += cost; s.acct[seller].vol += cost;
    return cost;
  }

  function placeOrder(s, tx, ts) {
    const a = s.acct[tx.f];
    const { side, px, amt } = tx;
    if (side !== 'b' && side !== 's') fail('bad side');
    if (!isInt(px) || px < 1 || px > C.MAX_PRICE) fail('bad price');
    if (!isInt(amt) || amt < C.MIN_ORDER || amt > C.MAX_AMT) fail('order too small');
    if (a.nOpen >= C.MAX_ORDERS) fail('too many open orders');
    let left = amt;
    if (side === 'b') {
      let lock = mulDiv(amt, px, C.SAT, true);
      if (a.U < lock) fail('not enough USDF');
      a.U -= lock; a.lU += lock;
      while (left > 0 && s.asks.length) {
        const ask = s.orders[s.asks[0]];
        if (ask.px > px) break;
        if (ask.f === tx.f) { closeOrder(s, ask.id); continue; } // never trade with yourself
        const fill = Math.min(left, ask.amt);
        const cost = trade(s, tx.f, ask.f, fill, ask.px, ts, tx.id, 'b');
        lock -= cost; a.lU -= cost; a.V += fill;
        const sel = s.acct[ask.f]; sel.lV -= fill; sel.U += cost; ask.lock -= fill; ask.amt -= fill;
        left -= fill;
        if (ask.amt <= 0) closeOrder(s, ask.id);
      }
      if (left > 0 && !tx.ioc) {
        s.orders[tx.id] = { id: tx.id, f: tx.f, side, px, amt: left, orig: amt, lock, ts, seq: s.nTx };
        s.bids.push(tx.id); a.nOpen++;
      } else { a.U += lock; a.lU -= lock; }
    } else {
      if (a.V < amt) fail('not enough VLT');
      a.V -= amt; a.lV += amt;
      while (left > 0 && s.bids.length) {
        const bid = s.orders[s.bids[0]];
        if (bid.px < px) break;
        if (bid.f === tx.f) { closeOrder(s, bid.id); continue; }
        const fill = Math.min(left, bid.amt);
        const cost = trade(s, bid.f, tx.f, fill, bid.px, ts, tx.id, 's');
        const buy = s.acct[bid.f]; bid.lock -= cost; buy.lU -= cost; buy.V += fill; bid.amt -= fill;
        a.lV -= fill; a.U += cost;
        left -= fill;
        if (bid.amt <= 0) closeOrder(s, bid.id);
      }
      if (left > 0 && !tx.ioc) {
        s.orders[tx.id] = { id: tx.id, f: tx.f, side, px, amt: left, orig: amt, lock: left, ts, seq: s.nTx };
        s.asks.push(tx.id); a.nOpen++;
      } else { a.V += left; a.lV -= left; }
    }
    sortBook(s);
  }

  // ---------------------------------------------------------------- applying one transaction
  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  const MEMO_MAX = 60;

  function applyTx(s, tx, blk) {
    if (!tx || typeof tx !== 'object') fail('not a transaction');
    if (tx.v !== 1) fail('unknown version');
    checkSig(tx);
    if (s.used.has(tx.id)) fail('already in the chain');
    if (!isInt(tx.ts) || tx.ts > blk.ts + 600000 || tx.ts < blk.ts - 86400000) fail('too old');
    if (tx.memo !== undefined && (typeof tx.memo !== 'string' || tx.memo.length > MEMO_MAX)) fail('memo too long');
    const me = s.acct[tx.f];
    switch (tx.t) {
      case 'reg': {
        if (me) fail('wallet already open');
        if (typeof tx.name !== 'string' || !NAME_RE.test(tx.name)) fail('bad name');
        if (s.names[tx.name.toLowerCase()]) fail('name taken');
        if (typeof tx.pn !== 'string' || tx.pn.length > 20) fail('bad proof');
        if (!S.meets(powHash(regSeed(tx.f), tx.pn), C.REG_D)) fail('bad proof');
        const a = newAcct(tx.name, blk.ts);
        a.U = C.WELCOME; s.supplyU += C.WELCOME;
        s.acct[tx.f] = a; s.names[tx.name.toLowerCase()] = tx.f;
        break;
      }
      case 'send': {
        if (!me) fail('no wallet');
        const to = s.acct[tx.to];
        if (!to) fail('nobody with that address');
        if (tx.to === tx.f) fail('cannot send to yourself');
        if (!isInt(tx.amt) || tx.amt < 1 || tx.amt > C.MAX_AMT) fail('bad amount');
        if (tx.a === 'V') { if (me.V < tx.amt) fail('not enough VLT'); me.V -= tx.amt; to.V += tx.amt; }
        else if (tx.a === 'U') { if (me.U < tx.amt) fail('not enough USDF'); me.U -= tx.amt; to.U += tx.amt; }
        else fail('bad asset');
        break;
      }
      case 'mine': {
        if (!me) fail('no wallet');
        if (!s.recent.includes(tx.ref)) fail('proof is too old');
        if (!isInt(tx.d) || tx.d < 1) fail('bad difficulty');
        if (tx.d < mineDifficulty(s) * C.ACCEPT) fail('difficulty went up - proof too weak');
        if (typeof tx.pn !== 'string' || tx.pn.length > 20) fail('bad proof');
        const ph = powHash(mineSeed(tx.ref, tx.f), tx.pn);
        if (!S.meets(ph, tx.d)) fail('bad proof');
        if (s.used.has('p' + ph)) fail('proof already used');
        const r = mineReward(s);
        if (r < 1) fail('all Voltcoin has been mined');
        s.used.add('p' + ph);
        me.V += r; me.mined += r; me.nMined++;
        s.rw[tx.id] = r;
        s.supplyV += r; s.minedV += r; s.nProofs++;
        break;
      }
      case 'earn': {
        if (!me) fail('no wallet');
        if (!isInt(tx.amt) || tx.amt < 1) fail('bad amount');
        if (tx.src === 'daily') {
          if (tx.amt !== C.DAILY) fail('bad amount');
          if (blk.ts - me.daily < C.DAILY_GAP) fail('daily reward already claimed');
          me.daily = blk.ts;
        } else if (typeof tx.src === 'string' && /^game:[a-z0-9-]{2,20}$/.test(tx.src)) {
          const day = Math.floor(blk.ts / 86400000);
          if (me.gday !== day) { me.gday = day; me.gsum = 0; }
          if (tx.amt > C.GAME_MAX || me.gsum + tx.amt > C.GAME_DAY) fail('daily game limit reached');
          me.gsum += tx.amt;
        } else fail('bad source');
        me.U += tx.amt; s.supplyU += tx.amt;
        break;
      }
      case 'order': {
        if (!me) fail('no wallet');
        placeOrder(s, tx, blk.ts);
        break;
      }
      case 'cancel': {
        if (!me) fail('no wallet');
        const o = s.orders[tx.oid];
        if (!o || o.f !== tx.f) fail('order not found');
        closeOrder(s, tx.oid);
        break;
      }
      case 'mint': {
        if (tx.f !== C.ADMIN) fail('only the mint can mint');
        const to = s.acct[tx.to];
        if (!to) fail('nobody with that address');
        if (!isInt(tx.amt) || tx.amt < 1 || tx.amt > C.MAX_AMT) fail('bad amount');
        if (tx.a === 'V') { to.V += tx.amt; s.supplyV += tx.amt; s.mintedV += tx.amt; }
        else if (tx.a === 'U') { to.U += tx.amt; s.supplyU += tx.amt; s.mintedU += tx.amt; }
        else fail('bad asset');
        break;
      }
      default: fail('unknown transaction');
    }
    s.used.add(tx.id);
    s.nTx++;
  }

  // ---------------------------------------------------------------- blocks
  const txRoot = (txs) => S.hex(txs.map((t) => t.id).join(','));
  const blockHash = (b) => S.hex(`${b.h}|${b.p}|${b.ts}|${b.m}|${b.r}|${b.n}`);
  const blockWork = (b) => C.BLOCK_D + b.x.reduce((w, t) => w + (t.t === 'mine' && isInt(t.d) ? t.d : 0), 0);

  const GENESIS = (() => {
    const b = { h: 0, p: '0'.repeat(64), ts: C.GENESIS_TS, m: '0'.repeat(64), x: [], n: 0 };
    b.r = txRoot(b.x); b.hash = blockHash(b);
    return b;
  })();

  // cheap checks that need no state
  function checkBlockShape(b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.x)) fail('bad block');
    if (!isInt(b.h) || b.h < 1 || !isHex(b.p, 64) || !isHex(b.m, 64) || !isInt(b.ts) || !isInt(b.n)) fail('bad block');
    if (b.x.length < 1 || b.x.length > C.MAX_TX) fail('bad block size');
    if (b.r !== txRoot(b.x)) fail('bad tx root');
    if (b.hash !== blockHash(b)) fail('bad block hash');
    if (!S.meets(b.hash, C.BLOCK_D)) fail('block not sealed');
    if (b.ts > Date.now() + 120000) fail('block from the future');
  }

  function applyBlock(s, b) {
    if (b.h !== s.h + 1 || b.p !== s.tip) fail('does not connect');
    if (b.ts < s.ts) fail('block before its parent');
    for (const tx of b.x) applyTx(s, tx, b);
    s.h = b.h; s.tip = b.hash; s.ts = b.ts;
    s.recent.push(b.hash); if (s.recent.length > C.REF_WINDOW) s.recent.shift();
  }

  function genesisState() {
    const s = freshState();
    s.tip = GENESIS.hash; s.recent = [GENESIS.hash];
    return s;
  }

  const clone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : Object.assign(JSON.parse(JSON.stringify(Object.assign({}, s, { used: [] }))), { used: new Set(s.used) }));

  // seal a block: find a nonce so the hash meets BLOCK_D
  function sealBlock(parent, txs, producer, ts) {
    const b = { h: parent.h + 1, p: parent.hash, ts: Math.max(ts, parent.ts), m: producer, x: txs, n: 0 };
    b.r = txRoot(txs);
    for (let n = Math.floor(Math.random() * 1e9); ; n++) {
      b.n = n; b.hash = blockHash(b);
      if (S.meets(b.hash, C.BLOCK_D)) return b;
    }
  }

  // ---------------------------------------------------------------- the chain (with forks)
  class Chain {
    constructor() {
      this.blocks = new Map();   // hash -> block
      this.work = new Map();     // hash -> total work up to and including it
      this.bad = new Set();
      this.orphans = new Map();  // parent hash -> [blocks]
      this.blocks.set(GENESIS.hash, GENESIS); this.work.set(GENESIS.hash, 0);
      this.main = [GENESIS.hash];
      this.state = genesisState();
      this.listeners = [];
    }
    get tip() { return this.blocks.get(this.main[this.main.length - 1]); }
    get tipWork() { return this.work.get(this.tip.hash); }
    onChange(fn) { this.listeners.push(fn); }
    emit(kind, info) { for (const f of this.listeners) try { f(kind, info); } catch (e) { console.error(e); } }

    // returns 'added' | 'known' | 'orphan' | 'side' | 'reorg' | 'bad'
    add(b, quiet) {
      if (!b || this.blocks.has(b.hash)) return 'known';
      if (this.bad.has(b.hash)) return 'bad';
      try { checkBlockShape(b); } catch (e) { return 'bad'; }
      if (this.bad.has(b.p)) { this.bad.add(b.hash); return 'bad'; }
      const parent = this.blocks.get(b.p);
      if (!parent) {
        const l = this.orphans.get(b.p) || []; if (!l.some((x) => x.hash === b.hash)) l.push(b);
        this.orphans.set(b.p, l);
        if (this.orphans.size > 500) this.orphans.delete(this.orphans.keys().next().value);
        return 'orphan';
      }
      if (b.h !== parent.h + 1) { this.bad.add(b.hash); return 'bad'; }
      const w = this.work.get(b.p) + blockWork(b);
      let res;
      if (b.p === this.tip.hash) {
        const s2 = clone(this.state);
        try { applyBlock(s2, b); } catch (e) { this.bad.add(b.hash); return 'bad'; }
        this.blocks.set(b.hash, b); this.work.set(b.hash, w);
        this.state = s2; this.main.push(b.hash);
        res = 'added';
        if (!quiet) this.emit('block', { block: b });
      } else {
        this.blocks.set(b.hash, b); this.work.set(b.hash, w);
        res = 'side';
        // more work wins; on a perfect tie the lower hash wins, so every copy picks the same one
        if (w > this.tipWork || (w === this.tipWork && b.hash < this.tip.hash)) res = this.tryReorg(b.hash, quiet) ? 'reorg' : 'bad';
      }
      // any orphans waiting for this one?
      const kids = this.orphans.get(b.hash);
      if (kids) { this.orphans.delete(b.hash); for (const k of kids) this.add(k, quiet); }
      return res;
    }

    pathTo(hash) {
      const path = [];
      let h = hash;
      while (h && h !== GENESIS.hash) { const b = this.blocks.get(h); if (!b) return null; path.push(h); h = b.p; }
      return path.reverse();
    }

    tryReorg(hash, quiet) {
      const path = this.pathTo(hash);
      if (!path) return false;
      // find where it splits from the main chain, then rebuild the state along the new branch
      let split = 0;
      while (split < path.length && this.main[split + 1] === path[split]) split++;
      const s = genesisState();
      try {
        for (let i = 0; i < path.length; i++) {
          const b = this.blocks.get(path[i]);
          try { applyBlock(s, b); } catch (e) { if (i >= split) { this.bad.add(b.hash); for (let j = i + 1; j < path.length; j++) this.bad.add(path[j]); } throw e; }
        }
      } catch (e) { return false; }
      const dropped = this.main.slice(split + 1).map((h) => this.blocks.get(h));
      this.main = [GENESIS.hash].concat(path);
      this.state = s;
      if (!quiet) this.emit('reorg', { dropped });
      return true;
    }

    // add lots of blocks fast (loading from storage or syncing): applies in place instead of copying the state each time
    bulk(list) {
      let changed = false;
      for (const b of list) {
        if (!b || this.blocks.has(b.hash) || this.bad.has(b.hash)) continue;
        if (b.p !== this.tip.hash) { const r = this.add(b, true); if (r === 'added' || r === 'reorg') changed = true; continue; }
        try { checkBlockShape(b); } catch (e) { this.bad.add(b.hash); continue; }
        try { applyBlock(this.state, b); }
        catch (e) { this.bad.add(b.hash); this.rebuild(); continue; }
        this.blocks.set(b.hash, b); this.work.set(b.hash, this.work.get(b.p) + blockWork(b)); this.main.push(b.hash);
        changed = true;
        const kids = this.orphans.get(b.hash);
        if (kids) { this.orphans.delete(b.hash); this.bulk(kids); }
      }
      if (changed) this.emit('sync', {});
      return changed;
    }

    rebuild() {
      const s = genesisState();
      for (const h of this.main.slice(1)) applyBlock(s, this.blocks.get(h));
      this.state = s;
    }

    mainBlocks(from = 1) { return this.main.slice(from).map((h) => this.blocks.get(h)); }

    // a "locator": a few hashes from our main chain so a peer can find where we split
    locator() {
      const out = []; let step = 1;
      for (let i = this.main.length - 1; i > 0; i -= step) { out.push(this.main[i]); if (out.length > 10) step *= 2; }
      out.push(GENESIS.hash);
      return out;
    }
    // blocks after the newest hash in the locator that we share
    after(loc, max = 150) {
      const idx = new Map(this.main.map((h, i) => [h, i]));
      let start = 0;
      for (const h of loc) if (idx.has(h)) { start = idx.get(h); break; }
      return this.main.slice(start + 1, start + 1 + max).map((h) => this.blocks.get(h));
    }
  }

  // try txs against a copy of the state and keep the ones that are valid (for building a block)
  function selectTxs(state, txs, ts) {
    const s = clone(state);
    const fake = { ts, h: s.h + 1 };
    const ok = [], dead = [];
    for (const tx of txs) {
      if (ok.length >= C.MAX_TX) break;
      try { applyTx(s, tx, fake); ok.push(tx); } catch (e) { dead.push({ tx, why: e.message }); }
    }
    return { ok, dead };
  }

  // explain why a tx would fail right now (for the UI, before it is sent)
  function dryRun(state, tx) {
    try { const s = clone(state); applyTx(s, tx, { ts: Math.max(Date.now(), state.ts), h: s.h + 1 }); return null; } catch (e) { return e.message; }
  }

  root.VLT = Object.assign(root.VLT || {}, {
    C, Chain, GENESIS, sign, txId, applyTx, applyBlock, sealBlock, selectTxs, dryRun, checkSig,
    mineDifficulty, difficultyParts, mineReward, refPrice, regSeed, mineSeed, powHash, hexOf, bytesOf, isHex, canon, mulDiv, blockWork,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.VLT;
})(typeof self !== 'undefined' ? self : globalThis);
