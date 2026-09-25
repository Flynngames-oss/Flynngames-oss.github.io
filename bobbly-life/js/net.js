// Peer-to-peer multiplayer with PeerJS. The host relays messages between everyone (star network).
import { G } from './state.js';

const PREFIX = 'bobblylife-v1-';
let peer = null, hostConn = null;
const conns = new Map();
const handlers = {};

export const on = (type, fn) => { handlers[type] = fn; };
function dispatch(msg) { const h = handlers[msg.t]; if (h) { try { h(msg); } catch (e) { console.error(e); } } }

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

function peerOpts() {
  // ?peerserver=host:port lets you use your own PeerJS server (default: free public PeerJS cloud)
  const q = new URLSearchParams(location.search).get('peerserver');
  const opts = { debug: 1 };
  if (q) {
    const [host, port] = q.split(':');
    Object.assign(opts, { host, port: +port || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost' });
  }
  return opts;
}

export function available() { return typeof window.Peer === 'function'; }

export function hostGame(cb, tries = 0) {
  if (!available()) { cb('Multiplayer library failed to load (check your internet).'); return; }
  const code = randomCode();
  peer = new window.Peer(PREFIX + code, peerOpts());
  let done = false;
  const timer = setTimeout(() => { if (!done) { done = true; cb('Could not reach the multiplayer server. Try again!'); } }, 15000);
  peer.on('open', (id) => {
    if (done) return;
    done = true; clearTimeout(timer);
    G.net.mode = 'host'; G.net.myId = id; G.net.code = code;
    cb(null, code);
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => { conns.set(conn.peer, conn); });
    conn.on('data', (msg) => hostReceive(conn, msg));
    conn.on('close', () => dropPeer(conn.peer));
    conn.on('error', () => dropPeer(conn.peer));
  });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id' && tries < 3 && !done) { done = true; clearTimeout(timer); peer.destroy(); hostGame(cb, tries + 1); return; }
    if (!done) { done = true; clearTimeout(timer); cb('Multiplayer error: ' + e.type); }
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
}

export function joinGame(code, cb) {
  if (!available()) { cb('Multiplayer library failed to load (check your internet).'); return; }
  peer = new window.Peer(peerOpts());
  let done = false;
  const fail = (m) => { if (!done) { done = true; clearTimeout(timer); cb(m); try { peer.destroy(); } catch (e) { /* ignore */ } } };
  const timer = setTimeout(() => fail('Could not find room ' + code + '. Check the code and try again.'), 15000);
  peer.on('open', (id) => {
    G.net.myId = id;
    hostConn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    hostConn.on('open', () => {
      if (done) return;
      done = true; clearTimeout(timer);
      G.net.mode = 'client'; G.net.code = code;
      cb(null);
    });
    hostConn.on('data', (msg) => dispatch(msg));
    hostConn.on('close', () => dispatch({ t: 'disconnected' }));
    hostConn.on('error', () => fail('Connection error.'));
  });
  peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `Room "${code}" not found. Is your friend still hosting?` : 'Multiplayer error: ' + e.type));
}

function hostReceive(conn, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
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
  } else if (hostConn && hostConn.open) hostConn.send(msg);
}

export function playerCount() { return G.net.mode === 'solo' ? 1 : G.remotes.size + 1; }
