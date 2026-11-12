// Voltcoin game rewards. A Flynngames game calls  VoltEarn.add('bocket', 5, 'Goal')  and the USDF waits
// in this browser until the player opens Voltcoin and claims it. All the games share flynngames' storage,
// so the Voltcoin app can see it. The Voltcoin network caps game rewards at 100 USDF a day per wallet.
(function () {
  'use strict';
  const KEY = 'voltcoin:earn';
  window.VoltEarn = {
    add(game, usdf, why) {
      try {
        const amt = Math.round(Number(usdf) * 100);
        if (!(amt > 0) || !/^[a-z0-9-]{2,20}$/.test(game)) return;
        let q = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (!Array.isArray(q)) q = [];
        const last = q[q.length - 1];
        const now = Date.now();
        // bunch rewards from the same game together so the list stays short
        if (last && last.g === game && now - last.ts < 5 * 60000) { last.amt += amt; last.ts = now; last.why = String(why || '').slice(0, 40); }
        else q.push({ g: game, amt, why: String(why || '').slice(0, 40), ts: now });
        if (q.length > 100) q = q.slice(-100);
        localStorage.setItem(KEY, JSON.stringify(q));
      } catch (e) { /* storage blocked: no rewards, game still works */ }
    },
  };
})();
