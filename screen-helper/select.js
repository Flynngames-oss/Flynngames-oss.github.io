// Injected into the page: drag a box to choose what to show Screen Helper. Esc cancels.
(() => new Promise((resolve) => {
  const old = document.getElementById('__screen_helper_select');
  if (old) old.remove();
  const o = document.createElement('div');
  o.id = '__screen_helper_select';
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(10,20,40,.25)';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #4f8cff;background:rgba(79,140,255,.12);box-shadow:0 0 0 9999px rgba(10,20,40,.35);display:none';
  const tip = document.createElement('div');
  tip.textContent = 'Drag a box around what you want help with · Esc to cancel';
  tip.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#101828;color:#fff;font:600 14px system-ui,sans-serif;padding:8px 14px;border-radius:99px';
  o.append(box, tip);
  document.documentElement.appendChild(o);
  let sx = 0, sy = 0, drag = false;
  const done = (r) => { o.remove(); removeEventListener('keydown', key, true); resolve(r); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
  addEventListener('keydown', key, true);
  o.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; box.style.display = 'block'; tip.style.display = 'none'; e.preventDefault(); });
  o.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - sx) + 'px', height: Math.abs(e.clientY - sy) + 'px' });
  });
  o.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    if (w < 8 || h < 8) { done(null); return; }
    done({ x, y, w, h, vw: innerWidth, vh: innerHeight });
  });
}))();
