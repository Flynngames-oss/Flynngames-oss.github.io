// Voltcoin - SHA-256 (the same hash Bitcoin uses), written so it runs fast in a mining loop.
// Works in the page, in the mining worker and in Node (for tests).
(function (root) {
  'use strict';
  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const IV = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Int32Array(64);

  // one compression round: state H (8 words) is updated with the 16 words in M
  function compress(H, M) {
    for (let i = 0; i < 16; i++) W[i] = M[i];
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }

  function hashBytes(bytes) {
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    const bits = len * 8;
    buf[total - 4] = (bits >>> 24) & 255; buf[total - 3] = (bits >>> 16) & 255; buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;
    buf[total - 5] = Math.floor(bits / 4294967296) & 255;
    const H = new Int32Array(IV), M = new Int32Array(16);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) { const j = off + i * 4; M[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]; }
      compress(H, M);
    }
    return H;
  }

  function wordsToHex(H) {
    let s = '';
    for (let i = 0; i < 8; i++) s += (H[i] >>> 0).toString(16).padStart(8, '0');
    return s;
  }

  const hex = (str) => wordsToHex(hashBytes(utf8(str)));

  // The proof-of-work rule used everywhere: a hash "wins" when its first 52 bits, read as a number,
  // are below 2^52 / difficulty. So difficulty = how many hashes it takes on average.
  const TWO52 = 4503599627370496;
  const target = (d) => Math.floor(TWO52 / Math.max(1, d));
  const top52 = (hexHash) => parseInt(hexHash.slice(0, 13), 16);
  const meets = (hexHash, d) => top52(hexHash) < target(d);

  // ---- fast miner: the seed is always 64 hex characters = exactly one SHA-256 block, so we hash it once
  // ("midstate") and then only hash the short nonce block for every guess.
  function makeMiner(seedHex) {
    const mid = new Int32Array(IV), M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = (seedHex.charCodeAt(i * 4) << 24) | (seedHex.charCodeAt(i * 4 + 1) << 16) | (seedHex.charCodeAt(i * 4 + 2) << 8) | seedHex.charCodeAt(i * 4 + 3);
    compress(mid, M);
    const H = new Int32Array(8), B = new Uint8Array(64), N = new Int32Array(16);
    // hash seed + nonceDigits (array of ASCII codes); returns H (words) - caller reads H[0], H[1]
    return function (digits, n) {
      B.fill(0);
      for (let i = 0; i < n; i++) B[i] = digits[i];
      B[n] = 0x80;
      const bits = (64 + n) * 8;
      B[62] = (bits >>> 8) & 255; B[63] = bits & 255;
      for (let i = 0; i < 16; i++) N[i] = (B[i * 4] << 24) | (B[i * 4 + 1] << 16) | (B[i * 4 + 2] << 8) | B[i * 4 + 3];
      H.set(mid);
      compress(H, N);
      return H;
    };
  }

  root.VSHA = { hex, hashBytes, wordsToHex, utf8, makeMiner, meets, target, top52, TWO52 };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.VSHA;
})(typeof self !== 'undefined' ? self : globalThis);
