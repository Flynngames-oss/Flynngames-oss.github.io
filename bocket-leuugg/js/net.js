// Online play. Everyone in a room connects out to a public MQTT-over-WebSocket relay (the same way
// Bobbly Life and Fresh Tracks do it, so it works on school Chromebooks) and talks on a topic made
// from the room code. Messages are encrypted with a key made from the room code too.
// The host runs the match (ball, score, clock, bots, demos); each player drives their own car.
const enc = new TextEncoder(), dec = new TextDecoder();
export const rid = () => Math.random().toString(36).slice(2, 10);
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
const timeout = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.id = rid(); this.code = ''; this.on = false; this.mq = null; this.key = null; this.topic = '';
    this.onMessage = null; this.sent = 0;
  }

  async start(code, status = () => {}) {
    this.stop();
    this.code = code.toUpperCase();
    this.on = true;
    if (!crypto.subtle) { status('This browser can’t do secure online play.'); this.on = false; return false; }
    for (let i = 0; i < 40 && typeof window.mqtt === 'undefined'; i++) await timeout(200);
    if (typeof window.mqtt === 'undefined') { status('Couldn’t load the online library. Check your internet.'); this.on = false; return false; }
    const k = await crypto.subtle.digest('SHA-256', enc.encode('bocket-key:' + this.code));
    const t = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('bocket-topic:' + this.code)));
    this.key = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
    this.topic = 'bocketleuugg/v1/' + [...t.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const brokers = Array.isArray(window.BOCKET_BROKERS) ? window.BOCKET_BROKERS : BROKERS;
    for (let i = 0; i < brokers.length && this.on; i++) {
      status(`Connecting to the online server (${i + 1}/${brokers.length})…`);
      const c = await this.connect(brokers[i]);
      if (!c) continue;
      if (!this.on) { try { c.end(true); } catch (e) { /* ignore */ } return false; }
      this.mq = c;
      c.subscribe(this.topic, { qos: 0 });
      c.on('message', async (topic, payload) => {
        const m = await this.unseal(payload);
        if (!m || typeof m.id !== 'string' || m.id === this.id || typeof m.t !== 'string') return;
        if (this.onMessage) this.onMessage(m);
      });
      return true;
    }
    status('Couldn’t reach any online server. Try again in a bit.');
    this.on = false;
    return false;
  }

  connect(url) {
    return new Promise((resolve) => {
      let c;
      try { c = window.mqtt.connect(url, { clientId: 'bl_' + rid(), clean: true, connectTimeout: 9000, reconnectPeriod: 0, keepalive: 30 }); } catch (e) { resolve(null); return; }
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
  send(msg) {
    if (!this.on || !this.mq || !this.mq.connected) return;
    msg.id = this.id;
    this.sent++;
    this.seal(msg).then((p) => { try { this.mq.publish(this.topic, p, { qos: 0 }); } catch (e) { /* ignore */ } });
  }
  stop() {
    if (this.mq) {
      const c = this.mq;
      if (this.key) this.seal({ id: this.id, t: 'bye' }).then((p) => { try { c.publish(this.topic, p, { qos: 0 }); } catch (e) { /* ignore */ } setTimeout(() => { try { c.end(true); } catch (e) { /* ignore */ } }, 300); });
      else try { c.end(true); } catch (e) { /* ignore */ }
    }
    this.mq = null; this.on = false;
  }
}
