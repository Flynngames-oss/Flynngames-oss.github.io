// Voltcoin peer: keeps this browser's copy of the chain, talks to other copies, and seals blocks.
// Messages travel over public MQTT brokers (the same way Flynn Chat connects people). Nobody is trusted:
// every block and transaction is checked against the rules before it is accepted.
(function (root) {
  'use strict';
  const V = root.VLT;
  const qs = new URLSearchParams(location.search);
  const BROKERS = qs.get('broker') ? [qs.get('broker')] : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
  const NET = qs.get('net') || 'main';
  const BASE = 'voltcoin/v1/' + NET.replace(/[^a-z0-9-]/gi, '');
  const PAGE = 50;
  const STORE_KEY = 'voltcoin:' + NET + ':chain';
  const rid = (n = 12) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('');

  const P = {
    cid: rid(10),
    chain: new V.Chain(),
    mempool: new Map(),        // id -> tx
    clients: [],
    seen: new Map(),
    peers: new Map(),          // cid -> { last, h, name }
    pageSeen: [],              // per broker: page number -> hash of its last block
    produceTimer: 0, saveTimer: 0, pageTimer: 0, helloTimer: 0,
    producer: '0'.repeat(64),
    name: '',
    ready: false,
    listeners: [],
    lastSync: 0,
    status: 'connecting',
  };

  const emit = (kind, data) => { for (const f of P.listeners) try { f(kind, data); } catch (e) { console.error(e); } };
  P.on = (fn) => P.listeners.push(fn);

  // ------------------------------------------------------------ local storage
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) P.chain.bulk(JSON.parse(raw));
    } catch (e) { console.warn('could not load saved chain', e); }
  }
  function save() {
    clearTimeout(P.saveTimer);
    P.saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(P.chain.mainBlocks())); } catch (e) { /* full or blocked */ }
    }, 800);
  }

  // ------------------------------------------------------------ network
  const live = () => P.clients.filter((c) => c.connected);
  function connect() {
    if (typeof root.mqtt === 'undefined') { P.status = 'offline'; emit('net'); return; }
    BROKERS.forEach((url, i) => {
      let c;
      try { c = root.mqtt.connect(url, { clientId: 'vlt_' + rid(10), clean: true, connectTimeout: 10000, reconnectPeriod: 4000, keepalive: 30 }); }
      catch (e) { return; }
      P.pageSeen[i] = {};
      c.on('connect', () => {
        c.subscribe([BASE + '/g', BASE + '/d/' + P.cid, BASE + '/p/+'], { qos: 0 });
        P.status = 'online'; emit('net');
        setTimeout(hello, 300 + Math.random() * 500);
        schedulePages(5000);
      });
      c.on('close', () => { P.status = live().length ? 'online' : 'connecting'; emit('net'); });
      c.on('error', () => {});
      c.on('message', (topic, payload) => onMessage(i, topic, payload));
      P.clients.push(c);
    });
  }

  function send(obj, topic = BASE + '/g') {
    obj.mid = rid(10);
    P.seen.set(obj.mid, Date.now());
    const data = JSON.stringify(obj);
    for (const c of live()) { try { c.publish(topic, data, { qos: 0 }); } catch (e) { /* ignore */ } }
  }

  function onMessage(bi, topic, payload) {
    let m;
    try { m = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (topic.startsWith(BASE + '/p/')) return onPage(bi, topic, m);
    if (!m.mid || P.seen.has(m.mid)) return;
    P.seen.set(m.mid, Date.now());
    if (P.seen.size > 5000) { const cut = Date.now() - 120000; for (const [k, t] of P.seen) if (t < cut) P.seen.delete(k); }
    switch (m.k) {
      case 'tx': if (m.tx) acceptTx(m.tx, false); break;
      case 'blk': if (m.b) acceptBlock(m.b, m.from); break;
      case 'hi': onHello(m); break;
      case 'req': if (m.to === P.cid && Array.isArray(m.loc)) answer(m); break;
      case 'blks': if (Array.isArray(m.bs)) onBlocks(m); break;
      case 'bye': if (P.peers.delete(m.cid)) emit('peers'); break;
    }
  }

  function hello() {
    clearTimeout(P.helloTimer);
    send({ k: 'hi', cid: P.cid, h: P.chain.tip.h, w: P.chain.tipWork, tip: P.chain.tip.hash, name: P.name });
    P.helloTimer = setTimeout(hello, 15000 + Math.random() * 5000);
    prunePeers();
  }
  function prunePeers() {
    const cut = Date.now() - 50000;
    let ch = false;
    for (const [k, p] of P.peers) if (p.last < cut) { P.peers.delete(k); ch = true; }
    if (ch) emit('peers');
  }
  function onHello(m) {
    if (m.cid === P.cid || typeof m.cid !== 'string') return;
    const isNew = !P.peers.has(m.cid);
    P.peers.set(m.cid, { last: Date.now(), h: m.h, name: String(m.name || '').slice(0, 16) });
    emit('peers');
    if (typeof m.w === 'number' && m.w > P.chain.tipWork) request(m.cid);
    else if (isNew && typeof m.w === 'number' && m.w < P.chain.tipWork) setTimeout(hello, 200 + Math.random() * 800); // let them see we are ahead
  }
  function request(cid) {
    if (Date.now() - P.lastSync < 1500) return;
    P.lastSync = Date.now();
    send({ k: 'req', to: cid, from: P.cid, loc: P.chain.locator() });
  }
  function answer(m) {
    if (typeof m.from !== 'string') return;
    const bs = P.chain.after(m.loc.filter((h) => typeof h === 'string').slice(0, 64), 100);
    if (bs.length) send({ k: 'blks', bs, more: bs.length === 100, from: P.cid }, BASE + '/d/' + m.from.replace(/[^a-z0-9]/g, ''));
  }
  function onBlocks(m) {
    const before = P.chain.tip.hash;
    P.chain.bulk(m.bs);
    if (P.chain.tip.hash !== before) afterChange();
    if (m.more && typeof m.from === 'string') { P.lastSync = 0; request(m.from); }
  }

  // ------------------------------------------------------------ retained pages: a copy of the chain that lives on the brokers,
  // so somebody opening the app when nobody else is online still gets the whole history.
  function onPage(bi, topic, m) {
    const n = parseInt(topic.split('/').pop(), 10);
    if (!Number.isInteger(n) || !Array.isArray(m.bs) || !m.bs.length) return;
    const last = m.bs[m.bs.length - 1];
    P.pageSeen[bi][n] = last && last.hash;
    const before = P.chain.tip.hash;
    P.chain.bulk(m.bs);
    if (P.chain.tip.hash !== before) afterChange();
    schedulePages(3000 + Math.random() * 3000);
  }
  function schedulePages(ms) {
    clearTimeout(P.pageTimer);
    P.pageTimer = setTimeout(publishPages, ms);
  }
  function publishPages() {
    const main = P.chain.main;
    const pages = Math.ceil((main.length - 1) / PAGE);
    P.clients.forEach((c, bi) => {
      if (!c.connected) return;
      for (let n = 0; n < pages; n++) {
        const lastH = main[Math.min((n + 1) * PAGE, main.length - 1)];
        if (P.pageSeen[bi][n] === lastH) continue;
        const bs = main.slice(n * PAGE + 1, (n + 1) * PAGE + 1).map((h) => P.chain.blocks.get(h));
        try { c.publish(BASE + '/p/' + n, JSON.stringify({ bs }), { qos: 0, retain: true }); P.pageSeen[bi][n] = lastH; } catch (e) { /* ignore */ }
      }
    });
  }

  // ------------------------------------------------------------ transactions and blocks
  function acceptTx(tx, mine) {
    if (!tx || typeof tx.id !== 'string' || P.mempool.has(tx.id) || P.chain.state.used.has(tx.id)) return null;
    try { V.checkSig(tx); } catch (e) { return e.message; }
    if (mine) {
      const why = V.dryRun(P.chain.state, tx);
      if (why) return why;
    }
    P.mempool.set(tx.id, tx);
    if (P.mempool.size > 2000) P.mempool.delete(P.mempool.keys().next().value);
    if (mine) send({ k: 'tx', tx });
    emit('mempool');
    scheduleProduce(mine ? 150 + Math.random() * 300 : 500 + Math.random() * 1500);
    return null;
  }

  function acceptBlock(b, from) {
    const r = P.chain.add(b);
    if (r === 'orphan' && from) request(from);
    if (r === 'added' || r === 'reorg') afterChange();
  }

  function afterChange() {
    const used = P.chain.state.used;
    for (const id of P.mempool.keys()) if (used.has(id)) P.mempool.delete(id);
    save();
    schedulePages(4000 + Math.random() * 4000);
    emit('chain');
    if (P.mempool.size) scheduleProduce(800 + Math.random() * 1500);
  }

  P.chain.onChange((kind, info) => {
    if (kind === 'reorg') for (const b of info.dropped) for (const tx of b.x) if (!P.chain.state.used.has(tx.id)) P.mempool.set(tx.id, tx);
  });

  function scheduleProduce(ms) {
    if (P.produceTimer) return;
    P.produceTimer = setTimeout(produce, ms);
  }
  function produce() {
    P.produceTimer = 0;
    if (!P.mempool.size) return;
    const txs = [...P.mempool.values()].sort((a, b) => a.ts - b.ts);
    const now = Date.now();
    const { ok, dead } = V.selectTxs(P.chain.state, txs, Math.max(now, P.chain.tip.ts));
    for (const d of dead) {
      // keep a tx a little while in case the block it depends on is still on its way
      if (now - d.tx.ts > 45000 || /already|too old|bad/.test(d.why)) { P.mempool.delete(d.tx.id); emit('dropped', d); }
    }
    if (!ok.length) { if (P.mempool.size) scheduleProduce(4000); return; }
    const b = V.sealBlock(P.chain.tip, ok, P.producer, now);
    const r = P.chain.add(b);
    if (r === 'added') { send({ k: 'blk', b, from: P.cid }); afterChange(); }
  }

  // ------------------------------------------------------------ public
  P.start = () => {
    load();
    P.ready = true;
    emit('chain');
    connect();
    setInterval(prunePeers, 10000);
    addEventListener('pagehide', () => send({ k: 'bye', cid: P.cid }));
  };
  P.submit = (tx) => acceptTx(tx, true);
  P.setIdentity = (pub, name) => { P.producer = pub; P.name = name || ''; };
  P.online = () => live().length > 0;
  P.peerCount = () => P.peers.size;
  P.pending = (pub) => [...P.mempool.values()].filter((t) => t.f === pub);

  root.VLT.peer = P;
})(window);
