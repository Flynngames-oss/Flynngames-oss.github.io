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

const NET_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'timeout'];
const MAX_TRIES = 3;
function friendly(type) {
  if (NET_ERRORS.includes(type)) return "Couldn't reach the multiplayer server. Check your internet and try again in a minute. (Some school or work networks block multiplayer, and then only solo works there.)";
  if (type === 'browser-incompatible') return "This browser can't do multiplayer. Try Chrome, Edge or Firefox.";
  return 'Multiplayer error: ' + type + '. Try again!';
}
// Retry wrapper: the free PeerJS server sometimes drops the first connection.
function withRetry(start, cb, status) {
  let attempt = 1;
  const go = () => start((err, ...rest) => {
    if (err && err.retry && attempt < MAX_TRIES) {
      attempt++;
      status && status(`Server busy, retrying (${attempt}/${MAX_TRIES})...`);
      setTimeout(go, 1500 * attempt);
      return;
    }
    cb(err ? (err.msg || err) : null, ...rest);
  });
  go();
}

export function hostGame(cb, status) { withRetry(hostOnce, cb, status); }

function hostOnce(cb, tries = 0) {
  if (!available()) { cb('Multiplayer library failed to load (check your internet).'); return; }
  const code = randomCode();
  peer = new window.Peer(PREFIX + code, peerOpts());
  let done = false;
  const timer = setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch (e) { /* ignore */ } cb({ retry: true, msg: friendly('timeout') }); } }, 12000);
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
    if (e.type === 'unavailable-id' && tries < 3 && !done) { done = true; clearTimeout(timer); peer.destroy(); hostOnce(cb, tries + 1); return; }
    if (!done) { done = true; clearTimeout(timer); try { peer.destroy(); } catch (x) { /* ignore */ } cb({ retry: NET_ERRORS.includes(e.type), msg: friendly(e.type) }); }
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
}

export function joinGame(code, cb, status) { withRetry((done) => joinOnce(code, done), cb, status); }

function joinOnce(code, cb) {
  if (!available()) { cb('Multiplayer library failed to load (check your internet).'); return; }
  peer = new window.Peer(peerOpts());
  let done = false;
  const fail = (m) => { if (!done) { done = true; clearTimeout(timer); cb(m); try { peer.destroy(); } catch (e) { /* ignore */ } } };
  const timer = setTimeout(() => fail({ retry: true, msg: 'Could not connect to room ' + code + '. Check the code, make sure your friend is still hosting, and try again.' }), 15000);
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
    hostConn.on('error', () => fail({ retry: true, msg: 'Connection to your friend failed. Try again!' }));
  });
  peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `Room "${code}" not found. Is your friend still hosting?` : { retry: NET_ERRORS.includes(e.type), msg: friendly(e.type) }));
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
