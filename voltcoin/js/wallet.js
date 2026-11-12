// Voltcoin wallet keys and the mining rig.
(function (root) {
  'use strict';
  const V = root.VLT, S = root.VSHA;
  const KEY = 'voltcoin:wallet';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } },
  };

  // ------------------------------------------------------------ wallet
  const W = { kp: null, pub: '', seed: '', admin: null };
  function fromSeed(seedHex) {
    W.seed = seedHex;
    W.kp = nacl.sign.keyPair.fromSeed(V.bytesOf(seedHex));
    W.pub = V.hexOf(W.kp.publicKey);
  }
  W.load = () => { const s = store.get(KEY); if (s && V.isHex(s.seed, 64)) { fromSeed(s.seed); return true; } return false; };
  W.create = () => { fromSeed(V.hexOf(nacl.randomBytes(32))); };
  W.persist = () => store.set(KEY, { seed: W.seed });
  W.forget = () => { store.del(KEY); W.kp = null; W.pub = ''; W.seed = ''; };
  W.code = () => 'VLT-' + W.seed.match(/.{8}/g).join('-').toUpperCase();
  W.parseCode = (txt) => {
    const hex = String(txt || '').toLowerCase().replace(/^\s*vlt-?/, '').replace(/[^0-9a-f]/g, '');
    return hex.length === 64 ? hex : null;
  };
  W.restore = (hex) => { fromSeed(hex); W.persist(); };
  W.tx = (t, fields, kp = W.kp) => V.sign(Object.assign({ v: 1, t, f: V.hexOf(kp.publicKey), ts: Date.now() }, fields), kp.secretKey);
  W.unlockAdmin = (pass) => {
    const seed = S.hex('voltcoin-admin|' + String(pass).trim());
    const kp = nacl.sign.keyPair.fromSeed(V.bytesOf(seed));
    if (V.hexOf(kp.publicKey) !== V.C.ADMIN) return false;
    W.admin = kp; return true;
  };
  W.adminTx = (t, fields) => W.tx(t, fields, W.admin);

  // ------------------------------------------------------------ mining rig (Web Workers)
  const M = {
    workers: [], threads: 0, running: false, jobId: 0, job: null,
    hashes: 0, rate: 0, samples: [], found: 0, earned: 0, startedAt: 0,
    listeners: [], rateWin: [],
  };
  const cores = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2)));
  M.maxThreads = cores;
  M.defaultThreads = Math.max(1, Math.min(4, cores - 1));
  M.on = (fn) => M.listeners.push(fn);
  const emit = (k, d) => { for (const f of M.listeners) try { f(k, d); } catch (e) { console.error(e); } };

  function spawn(n) {
    while (M.workers.length < n) {
      const w = new Worker('js/worker.js');
      w.onmessage = (e) => onWork(e.data);
      M.workers.push(w);
    }
    while (M.workers.length > n) M.workers.pop().terminate();
  }

  function onWork(m) {
    if (!M.job || m.id !== M.job.id) return;
    M.hashes += m.count;
    M.rateWin.push([performance.now(), m.count]);
    if (m.sample) { M.samples.unshift({ hash: m.sample, nonce: m.nonce }); if (M.samples.length > 14) M.samples.length = 14; }
    if (m.found) {
      const job = M.job;
      M.job = null;
      for (const w of M.workers) w.postMessage({ cmd: 'stop' });
      M.samples.unshift({ hash: m.hash, nonce: m.nonce, win: true });
      job.resolve(m.nonce, m.hash);
    }
  }

  setInterval(() => {
    const now = performance.now();
    M.rateWin = M.rateWin.filter((x) => now - x[0] < 4000);
    const sum = M.rateWin.reduce((t, x) => t + x[1], 0);
    const span = M.rateWin.length ? Math.max(1000, now - M.rateWin[0][0] + 120) : 1;
    M.rate = M.rateWin.length ? (sum / span) * 1000 : 0;
    emit('tick');
  }, 500);

  function runJob(seed, d, resolve, kind) {
    M.jobId++;
    M.job = { id: M.jobId, seed, d, resolve, kind, started: Date.now() };
    for (const w of M.workers) w.postMessage({ cmd: 'mine', id: M.jobId, seed, d });
  }

  // one-off proof of work (opening a wallet)
  M.pow = (seed, d) => new Promise((res) => {
    const was = M.running;
    M.running = false;
    spawn(Math.max(M.workers.length, M.defaultThreads));
    runJob(seed, d, (nonce) => { M.running = was; if (!was) spawn(0); res(nonce); }, 'pow');
  });

  // continuous mining: getWork() returns { ref, d } for the newest block; submit(proof) sends it
  M.start = (threads, getWork, submit) => {
    M.threads = threads; M.getWork = getWork; M.submit = submit;
    M.running = true; M.startedAt = M.startedAt || Date.now();
    spawn(threads);
    next();
    emit('state');
  };
  M.setThreads = (n) => { M.threads = n; if (M.running) { spawn(n); if (M.job) for (const w of M.workers) w.postMessage({ cmd: 'mine', id: M.job.id, seed: M.job.seed, d: M.job.d }); } emit('state'); };
  M.stop = () => {
    M.running = false; M.job = null;
    spawn(0);
    M.rateWin = []; M.rate = 0;
    emit('state');
  };
  function next() {
    if (!M.running) return;
    const work = M.getWork();
    if (!work) { setTimeout(next, 2000); return; }
    const seed = V.mineSeed(work.ref, W.pub);
    runJob(seed, work.d, (nonce, hash) => {
      M.found++;
      M.submit({ ref: work.ref, d: work.d, pn: nonce, hash });
      emit('found', { hash });
      setTimeout(next, 50);
    }, 'mine');
    M.job.ref = work.ref;
  }
  // called when a new block arrives: keep going unless our job went stale
  M.refresh = (isStale) => { if (M.running && M.job && M.job.kind === 'mine' && isStale(M.job)) { M.job = null; next(); } };

  root.VLT.wallet = W;
  root.VLT.miner = M;
})(window);
