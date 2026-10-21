// Multiplayer: surf with friends who type in the same room code.
// Every player sends their own surfer (position, wobbly body, look) about ten times a second and sees
// everyone else's. Two ways to reach each other, both used at once so it works wherever the game runs:
//  - inside the Claude link: the platform's live "room" (each player's presence);
//  - anywhere: a public MQTT relay over a secure WebSocket (like Bobbly Life), encrypted with a key made
//    from the room code so nobody else on the relay can read it.
const enc = new TextEncoder(), dec = new TextDecoder();
const rid = () => Math.random().toString(36).slice(2, 10);
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
const TIMEOUT = 8000; // forget a player we haven't heard from for this long

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
const timeout = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

export class Net {
  constructor() {
    this.id = rid();
    this.code = '';
    this.on = false;
    this.peers = new Map(); // id -> { st, at, look }
    this.room = null; this.mq = null; this.key = null; this.topic = '';
    this.how = [];
    this.lastLook = 0;
  }

  // join (or make) the room with this code; resolves once at least one way of talking is up
  async start(code, status = () => {}) {
    this.stop();
    this.code = code.toUpperCase();
    this.on = true;
    const tries = [this.startRoom(status), this.startRelay(status)];
    const first = await Promise.race([
      Promise.any(tries.map((p) => p.then((ok) => (ok ? ok : Promise.reject())))).catch(() => null),
      timeout(20000, null),
    ]);
    if (!first) { this.on = false; return false; }
    return true;
  }

  async startRoom(status) {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return null;
    let room = null;
    try { room = await Promise.race([c.use('room'), timeout(6000, null)]); } catch (e) { room = null; }
    if (!room || !this.on) return null;
    status('Joining the room…');
    let r = null;
    try { r = await room.join('surf-' + this.code.toLowerCase()); } catch (e) { r = null; }
    if (!r || !this.on) return null;
    this.room = r;
    r.onPeers((ch) => {
      const now = performance.now();
      for (const p of ch.peers) {
        const st = p.presence && p.presence.st;
        if (p.sameTab || !st || typeof st !== 'object' || typeof st.id !== 'string' || st.id === this.id) continue;
        this.got(st, now);
      }
      for (const p of ch.left) { const st = p.presence && p.presence.st; if (st && st.id) this.peers.delete(st.id); }
    }, () => { this.room = null; this.how = this.how.filter((h) => h !== 'room'); });
    this.how.push('room');
    return 'room';
  }

  async startRelay(status) {
    if (!crypto.subtle) return null;
    // the relay library loads from a CDN; give it a moment if it hasn't arrived yet
    for (let i = 0; i < 30 && typeof window.mqtt === 'undefined'; i++) await timeout(200);
    if (typeof window.mqtt === 'undefined' || !this.on) return null;
    const k = await crypto.subtle.digest('SHA-256', enc.encode('wobblesurf-key:' + this.code));
    const t = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('wobblesurf-topic:' + this.code)));
    this.key = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
    this.topic = 'wobblesurf/v1/' + [...t.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
    for (let i = 0; i < BROKERS.length && this.on; i++) {
      status(`Connecting to the multiplayer server (${i + 1}/${BROKERS.length})…`);
      const c = await this.connect(BROKERS[i]);
      if (!c) continue;
      if (!this.on) { try { c.end(true); } catch (e) { /* ignore */ } return null; }
      this.mq = c;
      c.subscribe(this.topic, { qos: 0 });
      c.on('message', async (topic, payload) => {
        const m = await this.unseal(payload);
        if (!m || typeof m.id !== 'string' || m.id === this.id) return;
        if (m.bye) { this.peers.delete(m.id); return; }
        this.got(m, performance.now());
      });
      this.how.push('relay');
      return 'relay';
    }
    return null;
  }

  connect(url) {
    return new Promise((resolve) => {
      let c;
      try { c = window.mqtt.connect(url, { clientId: 'ws_' + rid(), clean: true, connectTimeout: 9000, reconnectPeriod: 0, keepalive: 30 }); } catch (e) { resolve(null); return; }
      const t = setTimeout(() => { try { c.end(true); } catch (e) { /* ignore */ } resolve(null); }, 9000);
      c.once('connect', () => { clearTimeout(t); c.options.reconnectPeriod = 2000; resolve(c); });
      c.once('error', () => { clearTimeout(t); try { c.end(true); } catch (e) { /* ignore */ } resolve(null); });
    });
  }
  async seal(msg) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(JSON.stringify(msg))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return out;
  }
  async unseal(buf) {
    try {
      const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      const m = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, this.key, b.slice(12))));
      return m && typeof m === 'object' ? m : null;
    } catch (e) { return null; }
  }

  got(st, now) {
    const old = this.peers.get(st.id);
    if (old && old.st === st) { return; }
    if (old && typeof st.n === 'number' && typeof old.st.n === 'number' && st.n < old.st.n && st.n > old.st.n - 1000) return; // older message
    const e = old || { look: null, lookKey: '' };
    e.st = st; e.at = now;
    if (st.look && typeof st.look === 'object') e.look = st.look;
    this.peers.set(st.id, e);
  }

  // my surfer, sent to everyone (called ~10 times a second)
  send(st) {
    if (!this.on) return;
    st.id = this.id;
    st.n = (this.n = (this.n || 0) + 1);
    if (this.room) this.room.presence({ st }).catch(() => {});
    if (this.mq && this.mq.connected) {
      // the relay only needs the look now and again
      const now = performance.now();
      const m = now - this.lastLook > 2000 ? st : { ...st, look: undefined };
      if (m.look) this.lastLook = now;
      this.seal(m).then((p) => { try { this.mq.publish(this.topic, p, { qos: 0 }); } catch (e) { /* ignore */ } });
    }
  }

  // everyone else currently in the room
  list() {
    const now = performance.now();
    for (const [id, p] of this.peers) if (now - p.at > TIMEOUT) this.peers.delete(id);
    return [...this.peers.values()];
  }

  stop() {
    if (this.mq) {
      const c = this.mq;
      if (this.key) this.seal({ id: this.id, bye: true }).then((p) => { try { c.publish(this.topic, p, { qos: 0 }); } catch (e) { /* ignore */ } setTimeout(() => { try { c.end(true); } catch (e) { /* ignore */ } }, 300); });
      else try { c.end(true); } catch (e) { /* ignore */ }
    }
    if (this.room) this.room.leave().catch(() => {});
    this.mq = null; this.room = null; this.on = false; this.how = []; this.peers.clear();
  }
}
