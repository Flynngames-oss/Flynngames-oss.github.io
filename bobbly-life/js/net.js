// Multiplayer. The host relays messages between everyone (star network).
//
// Two ways to connect, tried in this order:
//  1. RELAY: everyone connects out to a public MQTT-over-WebSocket broker. This works on nearly
//     every home network because it's a normal secure web connection — no peer-to-peer needed.
//     Messages are encrypted (AES-GCM) with a key made from the room code, so other people
//     on the public broker can't read them.
//  2. DIRECT: PeerJS / WebRTC peer-to-peer (the old way) as a backup.
import { G } from './state.js';

const PREFIX = 'bobblylife-v1-';
const conns = new Map();          // client id -> { peer, open, send }
const handlers = {};
let peer = null, hostConn = null;
const DROP_MS = 45000;
const MQ = { client: null, base: '', key: null, lastHeard: 0, seen: new Map(), transport: null };

export const on = (type, fn) => { handlers[type] = fn; };
function dispatch(msg) { const h = handlers[msg.t]; if (h) { try { h(msg); } catch (e) { console.error(e); } } }

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
const rid = () => Math.random().toString(36).slice(2, 10);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- relay (MQTT over secure WebSocket)
function brokers() {
  const q = params.get('broker');          // test hook: ?broker=ws://127.0.0.1:8888
  if (q) return [q];
  return ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
}
const enc = new TextEncoder(), dec = new TextDecoder();
async function roomCrypto(code) {
  const k = await crypto.subtle.digest('SHA-256', enc.encode('bobblylife-key:' + code));
  const t = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('bobblylife-topic:' + code)));
  const hex = [...t.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { key: await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']), base: 'bobblylife/v2/' + hex };
}
async function seal(msg) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, MQ.key, enc.encode(JSON.stringify(msg))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(buf) {
  try {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, MQ.key, b.slice(12));
    const m = JSON.parse(dec.decode(pt));
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch (e) { return null; }
}
function publish(topic, msg) { if (MQ.client && MQ.client.connected) seal(msg).then(p => MQ.client.publish(topic, p, { qos: 0 })); }
function connectBroker(url, ms = 12000) {
  return new Promise((resolve) => {
    if (typeof window.mqtt === 'undefined') { resolve(null); return; }
    let c;
    try { c = window.mqtt.connect(url, { clientId: 'bl_' + rid(), clean: true, connectTimeout: ms, reconnectPeriod: 0, keepalive: 30 }); } catch (e) { resolve(null); return; }
    const t = setTimeout(() => { try { c.end(true); } catch (e) { /* ignore */ } resolve(null); }, ms);
    c.once('connect', () => { clearTimeout(t); c.options.reconnectPeriod = 2000; resolve(c); });
    c.once('error', () => { clearTimeout(t); try { c.end(true); } catch (e) { /* ignore */ } resolve(null); });
  });
}
async function firstBroker(status) {
  const list = brokers();
  for (let i = 0; i < list.length; i++) {
    status && status(`Connecting to multiplayer server ${i + 1}/${list.length}...`);
    const c = await connectBroker(list[i]);
    if (c) return c;
  }
  return null;
}

// ---------------------------------------------------------------- direct (PeerJS / WebRTC) backup
function peerOpts() {
  const q = params.get('peerserver');   // ?peerserver=host:port to use your own PeerJS server
  const opts = { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
  if (q) {
    const [host, port] = q.split(':');
    Object.assign(opts, { host, port: +port || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost' });
  }
  return opts;
}
export function available() { return typeof window.mqtt !== 'undefined' || typeof window.Peer === 'function'; }

// ---------------------------------------------------------------- hosting
export async function hostGame(cb, status) {
  if (!available()) { cb('Multiplayer failed to load — check your internet connection.'); return; }
  const code = randomCode();
  G.net.code = code; G.net.myId = PREFIX + code;
  let ready = false;
  const done = (how) => { if (ready) return; ready = true; G.net.mode = 'host'; MQ.transport = how; cb(null, code); };
  // relay
  const cr = await roomCrypto(code); MQ.key = cr.key; MQ.base = cr.base;
  const c = await firstBroker(status);
  if (c) {
    MQ.client = c;
    c.subscribe(MQ.base + '/h', { qos: 0 });
    c.on('message', async (topic, payload) => {
      const m = await unseal(payload);
      if (!m || !m.from) return;
      MQ.seen.set(m.from, performance.now());
      if (m.t === 'join-req') {
        if (!conns.has(m.from)) conns.set(m.from, { peer: m.from, open: true, relay: true, send: (x) => publish(MQ.base + '/c/' + m.from, x) });
        publish(MQ.base + '/c/' + m.from, { t: 'join-ok', from: G.net.myId });
        return;
      }
      if (m.t === 'bye') { dropPeer(m.from); return; }
      if (m.t === 'ping') return;
      const conn = conns.get(m.from);
      if (conn) hostReceive(conn, m);
    });
    // keep-alive both ways, and drop relay players we haven't heard from for a while
    // (generous, because browsers slow down timers in background tabs)
    setInterval(() => {
      const now = performance.now();
      for (const [id, cn] of conns) if (cn.relay) { if (now - (MQ.seen.get(id) || 0) > DROP_MS) dropPeer(id); else cn.send({ t: 'ping', from: G.net.myId }); }
    }, 4000);
    done('relay');
  }
  // direct connections too, for anyone whose network blocks the relay
  if (typeof window.Peer === 'function') {
    try {
      peer = new window.Peer(PREFIX + code, peerOpts());
      peer.on('open', () => done('direct'));
      peer.on('connection', (conn) => {
        conn.on('open', () => { conns.set(conn.peer, conn); });
        conn.on('data', (msg) => { if (msg && typeof msg === 'object' && typeof msg.t === 'string') { msg.from = conn.peer; hostReceive(conn, msg); } });
        conn.on('close', () => dropPeer(conn.peer));
        conn.on('error', () => dropPeer(conn.peer));
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
      peer.on('error', () => { /* relay may still be fine */ });
    } catch (e) { /* ignore */ }
  }
  setTimeout(() => { if (!ready) cb("Couldn't reach any multiplayer server. Check your internet and try again. (Some school or work networks block multiplayer.)"); ready = true; }, 30000);
}

// ---------------------------------------------------------------- joining
export async function joinGame(code, cb, status) {
  if (!available()) { cb('Multiplayer failed to load — check your internet connection.'); return; }
  code = code.toUpperCase();
  const myId = 'm_' + rid();
  G.net.myId = myId;
  const cr = await roomCrypto(code); MQ.key = cr.key; MQ.base = cr.base;
  // 1) relay: try each broker until the host answers
  const list = brokers();
  for (let i = 0; i < list.length; i++) {
    status && status(`Looking for room ${code} (server ${i + 1}/${list.length})...`);
    const c = await connectBroker(list[i]);
    if (!c) continue;
    const ok = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 12000);
      c.subscribe(MQ.base + '/c/' + myId, { qos: 0 });
      c.on('message', async (topic, payload) => {
        const m = await unseal(payload);
        if (!m) return;
        MQ.lastHeard = performance.now();
        if (m.t === 'join-ok') { clearTimeout(t); resolve(true); return; }
        if (m.t === 'ping') return;
        if (G.net.mode === 'client' && MQ.transport === 'relay') dispatch(m);
      });
      MQ.client = c;
      const ask = () => publish(MQ.base + '/h', { t: 'join-req', from: myId });
      ask(); setTimeout(ask, 2000); setTimeout(ask, 5000); setTimeout(ask, 8500);
    });
    if (ok) {
      MQ.transport = 'relay';
      G.net.mode = 'client'; G.net.code = code;
      // lost the host?
      const watch = setInterval(() => {
        if (G.net.mode !== 'client') { clearInterval(watch); return; }
        if (performance.now() - MQ.lastHeard > DROP_MS) { clearInterval(watch); dispatch({ t: 'disconnected' }); return; }
        publish(MQ.base + '/h', { t: 'ping', from: myId });
      }, 4000);
      // encrypt the goodbye now so it can be sent instantly when the tab closes
      seal({ t: 'bye', from: myId }).then(bye => addEventListener('pagehide', () => { try { c.publish(MQ.base + '/h', bye, { qos: 0 }); } catch (e) { /* ignore */ } }));
      cb(null);
      return;
    }
    try { c.end(true); } catch (e) { /* ignore */ }
    MQ.client = null;
  }
  // 2) direct peer-to-peer backup
  if (typeof window.Peer !== 'function') { cb(`Room "${code}" not found. Is your friend still hosting? Check the code and try again.`); return; }
  status && status(`Trying a direct connection to room ${code}...`);
  joinDirect(code, cb);
}
function joinDirect(code, cb) {
  peer = new window.Peer(peerOpts());
  let done = false;
  const fail = (m) => { if (!done) { done = true; clearTimeout(timer); cb(m); try { peer.destroy(); } catch (e) { /* ignore */ } } };
  const timer = setTimeout(() => fail(`Couldn't connect to room ${code}. Check the code, make sure your friend is still hosting, and try again.`), 15000);
  peer.on('open', (id) => {
    G.net.myId = id;
    hostConn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    hostConn.on('open', () => {
      if (done) return;
      done = true; clearTimeout(timer);
      MQ.transport = 'direct';
      G.net.mode = 'client'; G.net.code = code;
      cb(null);
    });
    hostConn.on('data', (msg) => dispatch(msg));
    hostConn.on('close', () => dispatch({ t: 'disconnected' }));
    hostConn.on('error', () => fail('Connection to your friend failed. Try again!'));
  });
  peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `Room "${code}" not found. Is your friend still hosting?` : `Couldn't connect (${e.type}). Try again in a minute.`));
}

// ---------------------------------------------------------------- relaying + sending
function hostReceive(conn, msg) {
  msg.from = conn.peer;
  if (msg.to && msg.to !== G.net.myId) { const c = conns.get(msg.to); if (c && c.open) c.send(msg); return; }
  dispatch(msg);
  if (msg.to === G.net.myId) return;
  for (const [id, c] of conns) if (id !== conn.peer && c.open) c.send(msg);
}
function dropPeer(id) {
  if (!conns.has(id)) return;
  conns.delete(id);
  const msg = { t: 'leave', from: id };
  dispatch(msg);
  for (const [, c] of conns) if (c.open) c.send(msg);
}
export function send(msg) {
  if (G.net.mode === 'solo') return;
  msg.from = G.net.myId;
  if (G.net.mode === 'host') {
    if (msg.to) { const c = conns.get(msg.to); if (c && c.open) c.send(msg); return; }
    for (const [, c] of conns) if (c.open) c.send(msg);
  } else if (MQ.transport === 'relay') publish(MQ.base + '/h', msg);
  else if (hostConn && hostConn.open) hostConn.send(msg);
}

export function playerCount() { return G.net.mode === 'solo' ? 1 : G.remotes.size + 1; }
