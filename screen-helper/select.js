// Injected into the page: drag a box to choose what to show Screen Helper. Esc cancels.
(() => new Promise((resolve) => {
  const old = document.getElementById('__screen_helper_select');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = '__screen_helper_select';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .o{position:fixed;inset:0;cursor:crosshair;background:rgba(8,12,28,.45);animation:f .15s ease-out}
    .b{position:fixed;display:none;border-radius:10px;box-shadow:0 0 0 9999px rgba(8,12,28,.5),0 0 0 2px #fff,0 0 0 4px #4f7dff,0 10px 40px rgba(79,125,255,.5);background:transparent}
    .s{position:absolute;right:6px;bottom:6px;background:#4f7dff;color:#fff;font:700 11px system-ui,sans-serif;padding:3px 7px;border-radius:6px}
    .t{position:fixed;top:18px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;background:rgba(15,20,36,.92);color:#fff;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.12)}
    .t i{width:10px;height:10px;border-radius:99px;background:linear-gradient(135deg,#8b5cf6,#4f7dff,#22d3ee)}
    kbd{background:rgba(255,255,255,.15);padding:1px 6px;border-radius:5px;font:600 12px system-ui}
    @keyframes f{from{opacity:0}}
  </style><div class="o"></div><div class="b"><span class="s"></span></div><div class="t"><i></i>Drag a box around what you need help with <kbd>Esc</kbd></div>`;
  const o = root.querySelector('.o'), box = root.querySelector('.b'), size = root.querySelector('.s'), tip = root.querySelector('.t');
  document.documentElement.appendChild(host);
  let sx = 0, sy = 0, drag = false;
  const done = (r) => { host.remove(); removeEventListener('keydown', key, true); resolve(r); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
  addEventListener('keydown', key, true);
  o.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; box.style.display = 'block'; o.style.background = 'transparent'; tip.style.display = 'none'; e.preventDefault(); });
  const move = (e) => {
    if (!drag) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    size.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  };
  o.addEventListener('mousemove', move); box.addEventListener('mousemove', move);
  const up = (e) => {
    if (!drag) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    if (w < 8 || h < 8) { done(null); return; }
    done({ x, y, w, h, vw: innerWidth, vh: innerHeight });
  };
  o.addEventListener('mouseup', up); box.addEventListener('mouseup', up);
}))();
