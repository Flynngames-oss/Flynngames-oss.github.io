// Voltcoin mining worker: guesses nonces as fast as it can until a hash beats the target.
importScripts('sha256.js');
let job = null;

onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'stop') { job = null; return; }
  if (m.cmd === 'mine') {
    job = { id: m.id, seed: m.seed, target: self.VSHA.target(m.d), hash: self.VSHA.makeMiner(m.seed) };
    // each worker starts at a random number so they never repeat each other's guesses
    const start = String(1e11 + Math.floor(Math.random() * 8.9e11));
    job.digits = new Uint8Array(20);
    for (let i = 0; i < start.length; i++) job.digits[i] = start.charCodeAt(i);
    job.n = start.length;
    setTimeout(loop, 0);
  }
};

function loop() {
  const j = job;
  if (!j) return;
  const d = j.digits, n = j.n, hash = j.hash, target = j.target;
  const t0 = Date.now();
  let count = 0;
  while (Date.now() - t0 < 120) {
    for (let k = 0; k < 4000; k++) {
      const H = hash(d, n);
      const v = (H[0] >>> 0) * 1048576 + (H[1] >>> 12);
      count++;
      if (v < target) {
        const nonce = String.fromCharCode.apply(null, d.subarray(0, n));
        postMessage({ id: j.id, found: true, nonce, hash: self.VSHA.wordsToHex(H), count });
        job = null;
        return;
      }
      // add one to the nonce, like an odometer
      let i = n - 1;
      while (d[i] === 57) { d[i] = 48; i--; }
      d[i]++;
    }
  }
  const H = hash(d, n);
  postMessage({ id: j.id, count, sample: self.VSHA.wordsToHex(H), nonce: String.fromCharCode.apply(null, d.subarray(0, n)) });
  setTimeout(loop, 0);
}
