// Reusable multiplayer layer for a static (GitHub Pages) site. No server of our own.
//
// One player HOSTS a room and relays messages for everyone else (star network).
// Two ways to reach the host, tried in this order:
//  1. RELAY: MQTT over secure WebSocket to a free public broker. It's an ordinary wss:// web
//     connection, so it works on almost every home and school network. Every message is
//     encrypted (AES-GCM) with a key made from the room code, so other broker users can't read it.
//  2. DIRECT: PeerJS / WebRTC peer-to-peer as a backup.
//
// Usage:
//   const net = createNet({ app: 'skyroom', onMessage, onLeave, onDisconnected });
//   const code = await net.host(status);   or   await net.join(code, status);
//   net.send({ t: 'pos', ... });            // to everyone
//   net.send({ t: 'hit', to: id, ... });    // to one player
// Every received message has .from (the sender's id). The host is the only one who
// can't be spoofed into: it stamps .from itself before relaying.

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DROP_MS = 25000;
const rid = () => Math.random().toString(36).slice(2, 10);
const enc = new TextEncoder(), dec = new TextDecoder();
const params = new URLSearchParams(location.search);

export function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

function brokers() {
  const q = params.get('broker');   // test hook: ?broker=ws://127.0.0.1:8888
  if (q) return [q];
  return ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
}

function peerOpts() {
  const q = params.get('peerserver');   // ?peerserver=host:port to use your own PeerJS server
  const opts = { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
  if (q) {
    const [host, port] = q.split(':');
    Object.assign(opts, { host, port: +port || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost' });
  }
  return opts;
}

function connectBroker(url, ms = 10000) {
  return new Promise((resolve) => {
    if (typeof window.mqtt === 'undefined') { resolve(null); return; }
    let c;
    try { c = window.mqtt.connect(url, { clientId: 'sr_' + rid(), clean: true, connectTimeout: ms, reconnectPeriod: 0, keepalive: 30 }); } catch (e) { resolve(null); return; }
    const t = setTimeout(() => { try { c.end(true); } catch (e) { /* ignore */ } resolve(null); }, ms);
    c.once('connect', () => { clearTimeout(t); c.options.reconnectPeriod = 2000; resolve(c); });
    c.once('error', () => { clearTimeout(t); try { c.end(true); } catch (e) { /* ignore */ } resolve(null); });
  });
}

export function createNet({ app, onMessage = () => {}, onLeave = () => {}, onDisconnected = () => {} }) {
  const net = { id: '', code: '', mode: 'solo', transport: null };
  const conns = new Map();   // host: player id -> { relay, send(msg), seen }
  let mq = null, key = null, base = '', peer = null, hostConn = null, lastHeard = 0;

  const deliver = (m) => { try { onMessage(m); } catch (e) { console.error(e); } };

  async function roomCrypto(code) {
    const k = await crypto.subtle.digest('SHA-256', enc.encode(app + '-key:' + code));
    const t = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(app + '-topic:' + code)));
    key = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
    base = app + '/v1/' + [...t.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function seal(msg) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(msg))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return out;
  }
  async function unseal(buf) {
    try {
      const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
      const m = JSON.parse(dec.decode(pt));
      return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
    } catch (e) { return null; }
  }
  const publish = (topic, msg) => { if (mq && mq.connected) seal(msg).then(p => mq.publish(topic, p, { qos: 0 })); };

  // ------------------------------------------------------------ host
  function hostBroadcast(msg, except) {
    let relayed = false;
    for (const [id, c] of conns) {
      if (id === except) continue;
      if (c.relay) relayed = true; else c.send(msg);
    }
    // relay players all listen on one shared topic, so one publish reaches all of them
    if (relayed) publish(base + '/b', msg);
  }
  function hostReceive(from, msg) {
    msg.from = from;
    const c = conns.get(from); if (c) c.seen = performance.now();
    if (msg.t === 'ping') return;
    if (msg.to && msg.to !== net.id) { const d = conns.get(msg.to); if (d) d.send(msg); return; }
    deliver(msg);
    if (!msg.to) hostBroadcast(msg, from);
  }
  function drop(id) {
    if (!conns.has(id)) return;
    conns.delete(id);
    onLeave(id);
    hostBroadcast({ t: 'leave', from: net.id, id });
  }

  net.host = (status) => new Promise(async (resolve, reject) => {
    if (typeof window.mqtt === 'undefined' && typeof window.Peer !== 'function') { reject(new Error('Multiplayer failed to load. Check your internet connection.')); return; }
    const code = randomCode();
    net.code = code; net.id = 'h_' + rid();
    let ready = false;
    const done = (how) => { if (ready) return; ready = true; net.mode = 'host'; net.transport = how; resolve(code); };
    await roomCrypto(code);
    for (const url of brokers()) {
      status && status('Opening room...');
      mq = await connectBroker(url);
      if (mq) break;
    }
    if (mq) {
      mq.subscribe(base + '/h', { qos: 0 });
      mq.on('message', async (topic, payload) => {
        const m = await unseal(payload);
        if (!m || typeof m.from !== 'string') return;
        const from = m.from;
        if (m.t === 'join') {
          if (!conns.has(from)) conns.set(from, { relay: true, seen: performance.now(), send: (x) => publish(base + '/c/' + from, x) });
          publish(base + '/c/' + from, { t: 'welcome', from: net.id });
          return;
        }
        if (!conns.has(from) || !conns.get(from).relay) return;
        if (m.t === 'bye') { drop(from); return; }
        hostReceive(from, m);
      });
      done('relay');
    }
    if (typeof window.Peer === 'function') {
      try {
        peer = new window.Peer(app + '-' + code, peerOpts());
        peer.on('open', () => done('direct'));
        peer.on('connection', (conn) => {
          conn.on('open', () => conns.set(conn.peer, { relay: false, seen: performance.now(), send: (x) => { if (conn.open) conn.send(x); } }));
          conn.on('data', (m) => { if (m && typeof m === 'object' && typeof m.t === 'string') hostReceive(conn.peer, m); });
          conn.on('close', () => drop(conn.peer));
          conn.on('error', () => drop(conn.peer));
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
        peer.on('error', () => { /* the relay may still be fine */ });
      } catch (e) { /* ignore */ }
    }
    // keep relay players alive, drop the ones that went quiet (generous: background tabs throttle timers)
    setInterval(() => {
      const now = performance.now();
      for (const [id, c] of conns) if (c.relay && now - c.seen > DROP_MS) drop(id);
      if ([...conns.values()].some(c => c.relay)) publish(base + '/b', { t: 'ping', from: net.id });
    }, 4000);
    setTimeout(() => { if (!ready) { ready = true; reject(new Error("Couldn't reach a multiplayer server. Some school or work networks block multiplayer.")); } }, 30000);
  });

  // ------------------------------------------------------------ join
  net.join = async (code, status) => {
    if (typeof window.mqtt === 'undefined' && typeof window.Peer !== 'function') throw new Error('Multiplayer failed to load. Check your internet connection.');
    code = code.toUpperCase().trim();
    net.id = 'p_' + rid();
    await roomCrypto(code);
    const list = brokers();
    for (let i = 0; i < list.length; i++) {
      status && status(`Looking for room ${code} (server ${i + 1}/${list.length})...`);
      const c = await connectBroker(list[i]);
      if (!c) continue;
      mq = c;
      let hostId = '';
      const ok = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 10000);
        c.subscribe(base + '/c/' + net.id, { qos: 0 });
        c.subscribe(base + '/b', { qos: 0 });
        c.on('message', async (topic, payload) => {
          const m = await unseal(payload);
          if (!m) return;
          if (m.t === 'welcome') { hostId = m.from; lastHeard = performance.now(); clearTimeout(t); resolve(true); return; }
          if (!hostId || m.from === net.id) return;
          lastHeard = performance.now();
          if (m.t === 'ping') return;
          if (m.t === 'leave') { onLeave(m.id); return; }
          deliver(m);
        });
        const ask = () => { if (!hostId) publish(base + '/h', { t: 'join', from: net.id }); };
        ask(); setTimeout(ask, 1500); setTimeout(ask, 4000); setTimeout(ask, 7000);
      });
      if (ok) {
        net.mode = 'client'; net.code = code; net.transport = 'relay';
        const watch = setInterval(() => {
          if (performance.now() - lastHeard > DROP_MS) { clearInterval(watch); onDisconnected(); return; }
          publish(base + '/h', { t: 'ping', from: net.id });
        }, 4000);
        // seal the goodbye now so it can go out instantly when the tab closes
        seal({ t: 'bye', from: net.id }).then(bye => addEventListener('pagehide', () => { try { c.publish(base + '/h', bye, { qos: 0 }); } catch (e) { /* ignore */ } }));
        return;
      }
      try { c.end(true); } catch (e) { /* ignore */ }
      mq = null;
    }
    if (typeof window.Peer !== 'function') throw new Error(`Room ${code} not found. Is your friend still hosting?`);
    status && status(`Trying a direct connection to room ${code}...`);
    await joinDirect(code);
  };

  function joinDirect(code) {
    return new Promise((resolve, reject) => {
      peer = new window.Peer(peerOpts());
      let done = false;
      const fail = (m) => { if (done) return; done = true; clearTimeout(timer); try { peer.destroy(); } catch (e) { /* ignore */ } reject(new Error(m)); };
      const timer = setTimeout(() => fail(`Couldn't connect to room ${code}. Check the code and make sure your friend is still hosting.`), 15000);
      peer.on('open', (id) => {
        net.id = id;
        hostConn = peer.connect(app + '-' + code, { reliable: false, serialization: 'json' });
        hostConn.on('open', () => {
          if (done) return;
          done = true; clearTimeout(timer);
          net.mode = 'client'; net.code = code; net.transport = 'direct';
          resolve();
        });
        hostConn.on('data', (m) => {
          if (!m || typeof m !== 'object' || typeof m.t !== 'string' || m.t === 'ping') return;
          if (m.t === 'leave') { onLeave(m.id); return; }
          deliver(m);
        });
        hostConn.on('close', () => onDisconnected());
        hostConn.on('error', () => fail('Connection to your friend failed. Try again!'));
      });
      peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `Room ${code} not found. Is your friend still hosting?` : `Couldn't connect (${e.type}). Try again in a minute.`));
    });
  }

  // ------------------------------------------------------------ sending
  net.send = (msg) => {
    if (net.mode === 'solo') return;
    msg.from = net.id;
    if (net.mode === 'host') {
      if (msg.to) { const c = conns.get(msg.to); if (c) c.send(msg); return; }
      hostBroadcast(msg);
    } else if (net.transport === 'relay') publish(base + '/h', msg);
    else if (hostConn && hostConn.open) hostConn.send(msg);
  };
  net.playerCount = () => net.mode === 'host' ? conns.size + 1 : 0;
  return net;
}
