// First-person cockpits: live instruments drawn on canvases, plus controls that move.
//  - cars/trucks: speedo + rev counter cluster, turning steering wheel, centre screen
//  - e-bikes: TFT display on the bars
//  - biplane / jet: six-pack flight instruments, engine gauges, stick and throttle
//  - airliner: glass cockpit (PFD, nav display, engine display for each pilot), autopilot panel,
//    overhead panel, yokes, thrust levers, window frames
import * as THREE from 'three';
import { G, WATER_Y, clamp } from './state.js';
import { carModel, truckModel, bikeModel, M } from './models.js';
import { LOC } from './world.js';

let active = null;
export function updateCockpit(dt, player) {
  const v = player.vehicle, fp = G.cam && G.cam.fp;
  if (active && (active !== v || !fp)) { if (active.cockpit) active.cockpit.group.visible = false; active = null; }
  if (!v || !fp) return;
  if (v.cockpit === undefined || v.cockpit === null) v.cockpit = build(v);
  if (!v.cockpit) return;
  v.cockpit.group.visible = true; active = v;
  v.cockpit.update(dt);
}

// ---------------------------------------------------------------- helpers
const DEG = 180 / Math.PI;
function panel(w, h, cw, ch, draw) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  let acc = 1;
  return { m, redraw(dt, force) { acc += dt; if (acc < 0.05 && !force) return; acc = 0; draw(x, cw, ch); t.needsUpdate = true; } };
}
const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, metalness: 0.1 }, o));
function box(parent, material, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}
function rod(parent, material, a, b, r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), material);
  m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m); return m;
}
// face a panel back towards the pilot (-z) and lean it back by `tilt`
function facePilot(m, tilt) { m.rotation.order = 'YXZ'; m.rotation.set(-tilt, Math.PI, 0); return m; }

// A classic round gauge. value mapped over [min,max] to angles a0..a1 (radians, 0 = up, clockwise)
function gauge(x, cx, cy, r, label, val, min, max, opt = {}) {
  const a0 = opt.a0 ?? -2.4, a1 = opt.a1 ?? 2.4;
  x.save(); x.translate(cx, cy);
  x.fillStyle = '#111316'; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#3a3d42'; x.lineWidth = r * 0.06; x.stroke();
  for (const [f, t, col] of opt.arcs || []) {
    x.strokeStyle = col; x.lineWidth = r * 0.07; x.beginPath();
    x.arc(0, 0, r * 0.84, a0 + (f - min) / (max - min) * (a1 - a0) - Math.PI / 2, a0 + (t - min) / (max - min) * (a1 - a0) - Math.PI / 2); x.stroke();
  }
  const n = opt.ticks ?? 10;
  x.strokeStyle = '#e8e8e8'; x.fillStyle = '#e8e8e8'; x.font = `600 ${r * 0.2}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    x.lineWidth = r * 0.035; x.beginPath(); x.moveTo(Math.sin(a) * r * 0.78, -Math.cos(a) * r * 0.78); x.lineTo(Math.sin(a) * r * 0.92, -Math.cos(a) * r * 0.92); x.stroke();
    if (opt.labels !== false && i % (opt.every ?? 2) === 0) x.fillText(Math.round(min + (max - min) * i / n / (opt.div ?? 1)), Math.sin(a) * r * 0.6, -Math.cos(a) * r * 0.6);
  }
  x.font = `700 ${r * 0.14}px Arial`; x.fillStyle = '#9aa0a8'; x.fillText(label, 0, r * 0.38);
  if (opt.digital != null) { x.fillStyle = '#e8e8e8'; x.font = `700 ${r * 0.2}px Arial`; x.fillText(opt.digital, 0, r * 0.62); }
  const a = a0 + (a1 - a0) * clamp((val - min) / (max - min), 0, 1);
  x.rotate(a); x.fillStyle = opt.needle || '#ffffff';
  x.beginPath(); x.moveTo(-r * 0.045, r * 0.12); x.lineTo(0, -r * 0.86); x.lineTo(r * 0.045, r * 0.12); x.fill();
  x.restore();
  x.fillStyle = '#2a2c30'; x.beginPath(); x.arc(cx, cy, r * 0.08, 0, Math.PI * 2); x.fill();
}
// Artificial horizon: pitch (deg, nose up +) and bank (deg, right +)
function horizon(x, cx, cy, r, pitch, bank, square = false) {
  x.save(); x.translate(cx, cy);
  x.beginPath(); if (square) x.rect(-r, -r, 2 * r, 2 * r); else x.arc(0, 0, r, 0, Math.PI * 2); x.clip();
  x.rotate(-bank / DEG);
  const ppd = r / 25, off = pitch * ppd;
  x.fillStyle = '#2f7fd0'; x.fillRect(-r * 3, -r * 3 + off, r * 6, r * 3);
  x.fillStyle = '#8a5a2a'; x.fillRect(-r * 3, off, r * 6, r * 3);
  x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(-r * 3, off); x.lineTo(r * 3, off); x.stroke();
  x.fillStyle = '#fff'; x.font = `600 ${r * 0.09}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let p = -30; p <= 30; p += 5) {
    if (!p) continue;
    const y = off - p * ppd, w = p % 10 ? r * 0.12 : r * 0.28;
    x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke();
    if (!(p % 10)) { x.fillText(Math.abs(p), -w - r * 0.1, y); x.fillText(Math.abs(p), w + r * 0.1, y); }
  }
  x.restore();
  // bank scale + aircraft symbol
  x.save(); x.translate(cx, cy);
  x.strokeStyle = '#fff'; x.lineWidth = 2;
  for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = b / DEG; x.beginPath(); x.moveTo(Math.sin(a) * r * 0.86, -Math.cos(a) * r * 0.86); x.lineTo(Math.sin(a) * r * (b % 30 ? 0.93 : 0.98), -Math.cos(a) * r * (b % 30 ? 0.93 : 0.98)); x.stroke(); }
  x.rotate(-bank / DEG); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, -r * 0.84); x.lineTo(-r * 0.05, -r * 0.74); x.lineTo(r * 0.05, -r * 0.74); x.fill();
  x.restore();
  x.strokeStyle = '#ffd21a'; x.lineWidth = r * 0.05; x.beginPath(); x.moveTo(cx - r * 0.55, cy); x.lineTo(cx - r * 0.18, cy); x.lineTo(cx - r * 0.1, cy + r * 0.08); x.moveTo(cx + r * 0.55, cy); x.lineTo(cx + r * 0.18, cy); x.lineTo(cx + r * 0.1, cy + r * 0.08); x.stroke();
  x.fillStyle = '#ffd21a'; x.fillRect(cx - r * 0.03, cy - r * 0.03, r * 0.06, r * 0.06);
}
function flightData(v) {
  return {
    kt: Math.abs(v.speed) * 1.944, ft: Math.max(0, (v.pos.y - WATER_Y)) * 3.281, vs: (v.vy || 0) * 196.85,
    hdg: ((-v.yaw * DEG) % 360 + 360) % 360, pitch: (v.fp || 0) * DEG, bank: (v.roll || 0) * DEG, thr: v.throttle || 0,
  };
}

// ---------------------------------------------------------------- builders
function build(v) {
  const t = v.type;
  const group = new THREE.Group(); group.visible = false;
  let upd = null;
  if (t.airliner) upd = airlinerCockpit(v, group);
  else if (t.plane) upd = smallPlaneCockpit(v, group);
  else if (t.isBike) upd = bikeCockpit(v, group);
  else if (v.carLike && !t.scooter) upd = carCockpit(v, group);
  if (!upd) return false;
  (t.isBike ? v.bikeGroup : v.body).add(group);
  return { group, update: upd };
}

// ----- cars and trucks
function carCockpit(v, g) {
  const t = v.type;
  let belt, dashZ, sx = 0.45;
  if (t.truck || t.van) { const tm = truckModel(v.typeId, t); belt = 1.75; dashZ = tm.cabZ0 + tm.cabL - 0.55; sx = 0.5; }
  else { const P = carModel(v.typeId).P; belt = P.belt + (P.raise || 0); dashZ = P.dashZ; }
  const trim = mat('#141518'), leather = mat('#1b1b1d', { roughness: 0.6 });
  // dash top + binnacle
  box(g, trim, 0, belt + 0.02, dashZ - 0.02, 1.8, 0.1, 0.5);
  box(g, trim, sx, belt + 0.12, dashZ - 0.08, 0.5, 0.14, 0.18);
  const cluster = panel(0.44, 0.17, 512, 200, (x, w, h) => {
    const kmh = Math.abs(v.speed) * 3.6, gear = v.speed < -0.3 ? 'R' : kmh < 1 ? 'N' : String(Math.min(6, 1 + Math.floor(kmh / 32)));
    const rpm = kmh < 1 ? 800 : 1200 + ((kmh % 32) / 32) * 4800;
    x.fillStyle = '#050608'; x.fillRect(0, 0, w, h);
    gauge(x, 100, 100, 92, 'km/h', kmh, 0, 260, { ticks: 13, every: 2, arcs: [], needle: '#ff4a2a' });
    gauge(x, 412, 100, 92, 'x1000 rpm', rpm / 1000, 0, 8, { ticks: 8, every: 1, arcs: [[6.5, 8, '#d02020']], needle: '#ff4a2a' });
    x.fillStyle = '#e8eef5'; x.font = '700 44px Arial'; x.textAlign = 'center'; x.fillText(Math.round(kmh), 256, 78);
    x.font = '600 18px Arial'; x.fillStyle = '#8fa0b0'; x.fillText('km/h', 256, 100);
    x.font = '800 40px Arial'; x.fillStyle = '#ffb020'; x.fillText(gear, 256, 150);
    x.fillStyle = v.damage > 80 ? '#ff3030' : '#2a2c30'; x.beginPath(); x.arc(215, 180, 8, 0, 7); x.fill();
    x.fillStyle = v.lostWheels ? '#ffb020' : '#2a2c30'; x.beginPath(); x.arc(297, 180, 8, 0, 7); x.fill();
  });
  facePilot(cluster.m, 0.25); cluster.m.position.set(sx, belt + 0.13, dashZ - 0.18); g.add(cluster.m);
  const screen = panel(0.3, 0.18, 320, 192, (x, w, h) => {
    x.fillStyle = '#0a0e14'; x.fillRect(0, 0, w, h);
    const d = new Date(), gt = (G.dayTime || 0) * 24;
    x.fillStyle = '#e8eef5'; x.font = '700 30px Arial'; x.textAlign = 'left';
    x.fillText(`${String(Math.floor(gt)).padStart(2, '0')}:${String(Math.floor((gt % 1) * 60)).padStart(2, '0')}`, 16, 40);
    x.font = '600 18px Arial'; x.fillStyle = '#8fb0d0'; x.fillText('BOBBLY FM 101.7', 16, 80);
    x.fillStyle = '#e8eef5'; x.fillText('Now playing: Lo-fi Drive', 16, 106);
    x.fillStyle = '#1f3a5a'; x.fillRect(16, 130, 288, 8); x.fillStyle = '#3fa7ff'; x.fillRect(16, 130, 288 * ((d.getSeconds() % 60) / 60), 8);
    x.fillStyle = '#8fa0b0'; x.fillText(`🧭 ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((-v.yaw * DEG) % 360 + 360) % 360) / 45) % 8]}`, 16, 170);
  });
  facePilot(screen.m, 0.35); screen.m.position.set(0, belt + 0.02, dashZ - 0.28); g.add(screen.m);
  box(g, trim, 0, belt - 0.15, dashZ - 0.25, 0.34, 0.3, 0.1, -0.35);
  // steering wheel on its column
  const wheel = new THREE.Group();
  wheel.position.set(sx, belt + 0.12, dashZ - 0.4); wheel.rotation.x = -0.45;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.028, 10, 32), leather); wheel.add(rim);
  const spin = new THREE.Group(); wheel.add(spin); spin.add(rim);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const s = box(spin, trim, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0, a === Math.PI ? 0.05 : 0.17, a === Math.PI ? 0.17 : 0.05, 0.03); s.rotation.z = 0; }
  box(spin, trim, 0, 0, 0.01, 0.1, 0.1, 0.05);
  rod(g, trim, [sx, belt - 0.02, dashZ - 0.18], [sx, belt + 0.1, dashZ - 0.38], 0.03);
  g.add(wheel);
  // gear selector + centre console
  box(g, trim, 0, belt - 0.45, dashZ - 0.7, 0.22, 0.25, 0.8);
  box(g, mat('#2a2c30'), 0, belt - 0.28, dashZ - 0.62, 0.05, 0.1, 0.05);
  // rear-view mirror
  box(g, trim, 0, belt + 0.72, dashZ - 0.28, 0.24, 0.07, 0.02);
  box(g, mat('#9fb4c4', { metalness: 0.9, roughness: 0.05 }), 0, belt + 0.72, dashZ - 0.29, 0.22, 0.055, 0.01);
  return (dt) => { cluster.redraw(dt); screen.redraw(dt); spin.rotation.z = -(v.steerA || 0) * 7; };
}

// ----- e-bike TFT on the bars
function bikeCockpit(v, g) {
  const sc = v.type.bike.scale || 1, bm = bikeModel(sc);
  let battery = 100;
  const tft = panel(0.15, 0.095, 320, 200, (x, w, h) => {
    const kmh = Math.abs(v.speed) * 3.6;
    x.fillStyle = '#05070a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e8eef5'; x.font = '800 80px Arial'; x.textAlign = 'center'; x.fillText(Math.round(kmh), 160, 96);
    x.font = '600 20px Arial'; x.fillStyle = '#8fa0b0'; x.fillText('km/h', 160, 122);
    // power bar
    x.fillStyle = '#1a2230'; x.fillRect(20, 140, 280, 16);
    x.fillStyle = (v.thr || 0) > 0.8 ? '#ff5020' : '#20c0ff'; x.fillRect(20, 140, 280 * (v.thr || 0), 16);
    // battery
    x.strokeStyle = '#e8eef5'; x.lineWidth = 2; x.strokeRect(20, 20, 60, 24); x.fillStyle = battery > 20 ? '#40d060' : '#ff3030'; x.fillRect(22, 22, 56 * battery / 100, 20);
    x.fillStyle = '#e8eef5'; x.font = '600 18px Arial'; x.textAlign = 'left'; x.fillText(Math.round(battery) + '%', 86, 39);
    x.textAlign = 'right'; x.fillStyle = '#ffb020'; x.fillText('SPORT', 300, 39);
    if ((v.wheelie || 0) > 0.08) { x.textAlign = 'center'; x.fillStyle = (v.wheelie > (v.balance || 0.7)) ? '#ff3030' : '#40d060'; x.font = '700 22px Arial'; x.fillText(`WHEELIE ${Math.round(v.wheelie * DEG)}°`, 160, 186); }
  });
  const L = 1.0, rk = 0.42;
  tft.m.position.set(0, (bm.r / sc + L * Math.cos(rk) + 0.07) * sc, (1.3 - L * Math.sin(rk) - 0.02) * sc);
  facePilot(tft.m, 0.55);
  g.add(tft.m);
  box(g, mat('#141518'), 0, tft.m.position.y - 0.005, tft.m.position.z + 0.012, 0.17, 0.11, 0.02, 0.55);
  return (dt) => { battery = Math.max(0, battery - (v.thr || 0) * dt * 0.08); tft.redraw(dt); };
}

// ----- biplane / jet: analog six-pack
function smallPlaneCockpit(v, g) {
  const jet = v.type.name !== 'Biplane';
  const y = jet ? 1.96 : 1.9, z = jet ? 1.95 : 0.2, w = jet ? 0.6 : 0.82;
  const six = panel(w, w * 0.5, 1024, 512, (x, W, H) => {
    const d = flightData(v);
    x.fillStyle = '#26282c'; x.fillRect(0, 0, W, H);
    const r = 108;
    gauge(x, 130, 130, r, 'KNOTS', d.kt, 0, jet ? 200 : 120, { ticks: 10, arcs: [[jet ? 50 : 30, jet ? 160 : 90, '#2fa040'], [jet ? 160 : 90, jet ? 200 : 120, '#d0a020']] });
    horizon(x, 380, 130, r, d.pitch, d.bank);
    gauge(x, 630, 130, r, 'ALT x100ft', (d.ft / 100) % 10, 0, 10, { a0: 0, a1: Math.PI * 2 - 0.001, ticks: 10, every: 1, digital: Math.round(d.ft) + ' ft' });
    gauge(x, 130, 380, r, 'TURN', clamp(d.bank / 30, -1, 1), -1, 1, { a0: -1, a1: 1, ticks: 2, labels: false });
    // heading indicator
    x.save(); x.translate(380, 380); x.fillStyle = '#111316'; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
    x.rotate(-d.hdg / DEG); x.strokeStyle = '#e8e8e8'; x.fillStyle = '#e8e8e8'; x.font = '700 22px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 10) { x.save(); x.rotate(a / DEG); x.lineWidth = 2; x.beginPath(); x.moveTo(0, -r * 0.92); x.lineTo(0, -r * (a % 30 ? 0.84 : 0.78)); x.stroke(); if (!(a % 30)) x.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || a / 10, 0, -r * 0.62); x.restore(); }
    x.restore(); x.fillStyle = '#ffb020'; x.beginPath(); x.moveTo(380, 330); x.lineTo(368, 400); x.lineTo(392, 400); x.fill();
    gauge(x, 630, 380, r, 'VERT SPEED', clamp(d.vs, -2000, 2000), -2000, 2000, { a0: -2.6, a1: 2.6, ticks: 8, div: 100 });
    gauge(x, 870, 130, 90, 'RPM x100', 6 + d.thr * 22, 0, 30, { ticks: 6, arcs: [[24, 30, '#d02020']] });
    gauge(x, 870, 370, 90, 'FUEL', 0.8, 0, 1, { ticks: 4, labels: false });
    x.fillStyle = '#9aa0a8'; x.font = '700 22px Arial'; x.textAlign = 'center'; x.fillText(`THR ${Math.round(d.thr * 100)}%`, 870, 490);
    for (const [k, lab, px] of [['engine', 'ENG', 790], ['wingL', 'L WING', 870], ['wingR', 'R WING', 950]]) if (v.lost[k]) { x.fillStyle = '#ff3030'; x.fillText(lab, px, 470); }
  });
  facePilot(six.m, 0.35); six.m.position.set(0, y, z); g.add(six.m);
  box(g, mat('#1a1b1e'), 0, y, z + 0.03, w + 0.08, w * 0.5 + 0.08, 0.04, 0.35);
  box(g, mat('#1a1b1e'), 0, y + w * 0.25 + 0.06, z + 0.12, w + 0.1, 0.05, 0.25);
  // stick + throttle
  const seatZ = v.seats[0][2], seatY = v.seats[0][1];
  const stick = new THREE.Group(); stick.position.set(0, seatY + 0.3, seatZ + 0.45); g.add(stick);
  rod(stick, mat('#2a2c30'), [0, 0, 0], [0, 0.45, 0], 0.02); box(stick, mat('#111'), 0, 0.48, 0, 0.05, 0.1, 0.05);
  const thr = new THREE.Group(); thr.position.set(0.3, seatY + 0.55, seatZ + 0.2); g.add(thr);
  rod(thr, mat('#2a2c30'), [0, 0, 0], [0, 0.22, 0], 0.012); box(thr, mat('#202020'), 0, 0.24, 0, 0.06, 0.04, 0.04);
  return (dt) => {
    six.redraw(dt);
    const k = G.keys || {};
    stick.rotation.x = lerp(stick.rotation.x, (k.ArrowUp ? -0.3 : 0) + (k.ArrowDown ? 0.3 : 0), 0.2);
    stick.rotation.z = lerp(stick.rotation.z, (k.ArrowLeft ? 0.3 : 0) + (k.ArrowRight ? -0.3 : 0), 0.2);
    thr.rotation.x = 0.6 - (v.throttle || 0) * 1.1;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;

// ----- airliner glass cockpit
function airlinerCockpit(v, g) {
  const fy = 3.55;
  const dark = mat('#2c2f34'), grey = mat('#5a5f66'), frame = mat('#22252a');
  // main panel, glareshield, pedestal, floor, side consoles
  box(g, grey, 0, 2.95, 17.06, 2.9, 0.75, 0.08, 0.35);
  box(g, dark, 0, 3.26, 17.3, 2.95, 0.08, 0.5);
  box(g, grey, 0, 2.05, 16.45, 0.5, 0.75, 1.3);
  box(g, dark, 0, 1.72, 16.2, 3, 0.06, 2.6);
  for (const s of [-1, 1]) box(g, grey, s * 1.45, 2.55, 16.3, 0.3, 0.7, 2.2);
  // window frames: centre post, side posts, top frame, overhead
  for (const [x0, x1] of [[0, 0], [0.9, 0.82], [-0.9, -0.82]]) box(g, frame, (x0 + x1) / 2, 3.7, 17.15, 0.09, 0.9, 0.09, 0.4);
  for (const s of [-1, 1]) { box(g, frame, s * 1.38, 3.68, 16.9, 0.09, 1.0, 0.09, 0.2); box(g, frame, s * 1.55, 3.68, 16.15, 0.09, 1.0, 0.09); }
  box(g, frame, 0, 4.18, 16.9, 3.0, 0.12, 0.3, -0.35);
  box(g, grey, 0, 4.34, 16.15, 2.6, 0.12, 1.4, 0.2);
  for (const s of [-1, 1]) box(g, grey, s * 1.5, 4.15, 15.95, 0.5, 0.4, 2.4);
  box(g, dark, 0, 3.0, 15.2, 3.2, 2.6, 0.08);   // bulkhead behind the pilots
  // screens: PFD | ND | EICAS | ND | PFD
  const scr = panel(2.55, 0.46, 2560, 460, (x, W, H) => {
    const d = flightData(v);
    x.fillStyle = '#0a0b0d'; x.fillRect(0, 0, W, H);
    for (const off of [0, 2048]) pfd(x, off + 20, 10, 472, 440, d);
    for (const [off, mir] of [[512, false], [1536, true]]) nd(x, off + 10, 10, 492, 440, d, v, mir);
    eicas(x, 1034, 10, 492, 440, d, v);
  });
  facePilot(scr.m, 0.35); scr.m.position.set(0, 3.03, 16.96); g.add(scr.m);
  // autopilot (MCP) strip on the glareshield
  const mcp = panel(1.0, 0.077, 1300, 100, (x, W, H) => {
    const d = flightData(v);
    x.fillStyle = '#3a3e44'; x.fillRect(0, 0, W, H);
    x.font = '700 42px monospace'; x.textAlign = 'center';
    const cells = [['SPD', Math.round(d.kt)], ['HDG', String(Math.round(d.hdg)).padStart(3, '0')], ['ALT', Math.round(d.ft / 100) * 100], ['V/S', Math.round(d.vs / 100) * 100]];
    cells.forEach(([lab, val], i) => {
      const cx = 160 + i * 330;
      x.fillStyle = '#111'; x.fillRect(cx - 110, 36, 220, 56);
      x.fillStyle = '#ffb030'; x.fillText(val, cx, 80);
      x.fillStyle = '#e8e8e8'; x.font = '700 22px Arial'; x.fillText(lab, cx, 28); x.font = '700 42px monospace';
    });
  });
  facePilot(mcp.m, 0.1); mcp.m.position.set(0, 3.31, 17.05); g.add(mcp.m);
  // overhead panel: rows of switches and annunciators
  const ovh = panel(1.2, 0.9, 512, 384, (x, W, H) => {
    x.fillStyle = '#4a4f56'; x.fillRect(0, 0, W, H);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
      const on = (r * 7 + c * 3) % 5 === 0;
      x.fillStyle = '#222'; x.fillRect(12 + c * 41, 12 + r * 46, 30, 30);
      x.fillStyle = on ? (r % 3 ? '#3fdc6a' : '#ffb030') : '#6a6f76'; x.fillRect(16 + c * 41, 16 + r * 46, 22, 10);
      x.fillStyle = '#ddd'; x.fillRect(22 + c * 41, 30 + r * 46, 10, 8);
    }
  }, true);
  ovh.m.rotation.set(Math.PI / 2 - 0.2, 0, Math.PI); ovh.m.position.set(0, 4.27, 16.25); g.add(ovh.m); ovh.redraw(1, true);
  // yokes for both pilots
  const yokes = [];
  for (const s of [-1, 1]) {
    const col = new THREE.Group(); col.position.set(s * 0.55, 1.75, 16.95); g.add(col);
    rod(col, dark, [0, 0, 0], [0, 0.72, -0.08], 0.035);
    const yk = new THREE.Group(); yk.position.set(0, 0.74, -0.1); col.add(yk);
    box(yk, dark, 0, 0, 0, 0.36, 0.05, 0.05);
    for (const h of [-1, 1]) box(yk, mat('#111'), h * 0.17, 0.07, 0, 0.05, 0.16, 0.05);
    box(yk, mat('#8a0000'), 0, 0.01, -0.03, 0.08, 0.04, 0.01);
    yokes.push({ col, yk });
  }
  // thrust levers
  const levers = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group(); l.position.set(s * 0.07, 2.42, 16.7); g.add(l);
    rod(l, mat('#9aa0a6', { metalness: 0.8, roughness: 0.3 }), [0, 0, 0], [0, 0.26, 0], 0.012);
    box(l, mat('#111'), 0, 0.28, 0, 0.09, 0.04, 0.05);
    levers.push(l);
  }
  // pilot seats
  for (const s of [-1, 1]) { box(g, mat('#262a30'), s * 0.55, 2.2, 16.05, 0.55, 0.1, 0.55); box(g, mat('#262a30'), s * 0.55, 2.65, 15.8, 0.55, 0.8, 0.1, 0.12); rod(g, dark, [s * 0.55, 1.75, 16.05], [s * 0.55, 2.15, 16.05], 0.05); }
  return (dt) => {
    scr.redraw(dt); mcp.redraw(dt);
    const k = G.keys || {};
    for (const { col, yk } of yokes) {
      col.rotation.x = lerp(col.rotation.x, (k.ArrowUp ? -0.18 : 0) + (k.ArrowDown ? 0.14 : 0), 0.15);
      yk.rotation.z = lerp(yk.rotation.z, (k.ArrowLeft ? 0.6 : 0) + (k.ArrowRight ? -0.6 : 0), 0.15);
    }
    for (const l of levers) l.rotation.x = 0.5 - (v.throttle || 0) * 0.9;
  };
}
// Primary flight display: attitude, speed tape, altitude tape, heading
function pfd(x, X, Y, W, H, d) {
  x.save(); x.translate(X, Y);
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  horizon(x, W / 2, H * 0.45, H * 0.34, d.pitch, d.bank, true);
  const tape = (tx, val, step, fmtK, good) => {
    x.fillStyle = '#3a3d44'; x.fillRect(tx, 20, 70, H * 0.8);
    x.save(); x.beginPath(); x.rect(tx, 20, 70, H * 0.8); x.clip();
    x.fillStyle = '#fff'; x.font = '600 18px Arial'; x.textAlign = 'center';
    const cy = 20 + H * 0.4, pps = 3;
    for (let s = Math.floor((val - 70 * step / 10) / step) * step; s < val + 70 * step / 10; s += step) {
      const y = cy - (s - val) * pps * 10 / step;
      if (s >= 0) { x.fillText(Math.round(s * fmtK), tx + 35, y + 6); x.fillRect(tx + (good ? 62 : 0), y, 8, 2); }
    }
    x.restore();
    x.fillStyle = '#000'; x.fillRect(tx - 4, cy - 18, 78, 36); x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(tx - 4, cy - 18, 78, 36);
    x.fillStyle = '#fff'; x.font = '700 22px Arial'; x.fillText(Math.round(val * fmtK), tx + 35, cy + 8);
  };
  tape(8, d.kt, 10, 1, true);
  tape(W - 78, d.ft / 100, 1, 100, false);
  x.fillStyle = '#e040e0'; x.font = '700 16px Arial'; x.textAlign = 'center'; x.fillText('SPD', 43, 14); x.fillText('ALT', W - 43, 14);
  // heading band
  x.fillStyle = '#3a3d44'; x.fillRect(90, H - 52, W - 180, 44);
  x.save(); x.beginPath(); x.rect(90, H - 52, W - 180, 44); x.clip();
  x.fillStyle = '#fff'; x.font = '600 16px Arial';
  for (let h = Math.floor(d.hdg / 10) * 10 - 40; h <= d.hdg + 40; h += 10) { const px = W / 2 + (h - d.hdg) * 4; x.fillRect(px, H - 52, 2, 10); x.fillText(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), px, H - 22); }
  x.restore();
  x.fillStyle = '#ffd21a'; x.beginPath(); x.moveTo(W / 2, H - 54); x.lineTo(W / 2 - 8, H - 66); x.lineTo(W / 2 + 8, H - 66); x.fill();
  // vertical speed
  x.fillStyle = '#fff'; x.font = '600 16px Arial'; x.fillText(`V/S ${Math.round(d.vs / 50) * 50}`, W / 2, 16);
  x.restore();
}
// Navigation display: compass arc, heading, nearby airports
function nd(x, X, Y, W, H, d, v, mirror) {
  x.save(); x.translate(X, Y);
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.86, R = H * 0.72;
  x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, R, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
  x.fillStyle = '#fff'; x.font = '600 18px Arial'; x.textAlign = 'center';
  for (let a = 0; a < 360; a += 10) {
    const rel = ((a - d.hdg + 540) % 360) - 180;
    if (Math.abs(rel) > 60) continue;
    const ang = rel / DEG - Math.PI / 2;
    x.beginPath(); x.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); x.lineTo(cx + Math.cos(ang) * (R - (a % 30 ? 10 : 18)), cy + Math.sin(ang) * (R - (a % 30 ? 10 : 18))); x.stroke();
    if (!(a % 30)) x.fillText(String(a / 10).padStart(2, '0'), cx + Math.cos(ang) * (R - 34), cy + Math.sin(ang) * (R - 34) + 6);
  }
  x.strokeStyle = '#6a6f76'; x.setLineDash([6, 8]); x.beginPath(); x.arc(cx, cy, R / 2, Math.PI * 1.15, Math.PI * 1.85); x.stroke(); x.setLineDash([]);
  // airports within range (the arc covers 4 km)
  const scale = R / 4000;
  for (const a of LOC.airports || []) {
    const dx = a.x - v.pos.x, dz = a.z - v.pos.z;
    // rotate into heading-up frame: forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)
    const fwd = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw), right = -dx * Math.cos(v.yaw) + dz * Math.sin(v.yaw);
    const px = cx + right * scale, py = cy - fwd * scale;
    if (py < 0 || py > H || px < 0 || px > W) continue;
    x.strokeStyle = '#40e0ff'; x.beginPath(); x.arc(px, py, 7, 0, 7); x.stroke();
    x.fillStyle = '#40e0ff'; x.font = '600 14px Arial'; x.fillText(a.name.split(' ')[0].toUpperCase(), px, py - 12);
  }
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(cx, cy - 16); x.lineTo(cx - 10, cy + 10); x.lineTo(cx + 10, cy + 10); x.fill();
  x.fillStyle = '#40ff60'; x.font = '700 20px Arial'; x.textAlign = 'left'; x.fillText(`GS ${Math.round(d.kt)}`, 12, 26);
  x.textAlign = 'right'; x.fillText(`HDG ${String(Math.round(d.hdg)).padStart(3, '0')}°`, W - 12, 26);
  void mirror;
  x.restore();
}
// Engine display: N1 for both engines, fuel, gear, warnings
function eicas(x, X, Y, W, H, d, v) {
  x.save(); x.translate(X, Y);
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const L = v.lost || {};
  [['engL', 130], ['engR', 360]].forEach(([k, cx]) => {
    const dead = L[k];
    const n1 = dead ? 0 : 20 + d.thr * 78;
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(cx, 120, 80, Math.PI * 0.8, Math.PI * 2.2); x.stroke();
    x.strokeStyle = dead ? '#ff3030' : '#40ff60'; x.lineWidth = 6; x.beginPath(); x.arc(cx, 120, 80, Math.PI * 0.8, Math.PI * 0.8 + Math.PI * 1.4 * n1 / 110); x.stroke();
    x.fillStyle = dead ? '#ff3030' : '#fff'; x.font = '700 30px Arial'; x.textAlign = 'center'; x.fillText(dead ? 'FAIL' : n1.toFixed(1), cx, 132);
    x.font = '600 16px Arial'; x.fillStyle = '#9aa0a8'; x.fillText('N1', cx, 170);
  });
  x.fillStyle = '#40e0ff'; x.font = '600 20px Arial'; x.textAlign = 'left';
  x.fillText('FUEL  12.4 t', 24, 250);
  x.fillText(`THR   ${Math.round(d.thr * 100)}%`, 24, 280);
  x.fillStyle = v.onGround || d.ft < 1500 ? '#40ff60' : '#9aa0a8'; x.fillText(v.onGround || d.ft < 1500 ? 'GEAR  DOWN' : 'GEAR  UP', 24, 310);
  let y = 250;
  x.textAlign = 'right';
  const warn = [];
  for (const [k, lab] of [['wingL', 'L WING DAMAGE'], ['wingR', 'R WING DAMAGE'], ['engL', 'ENG 1 FIRE'], ['engR', 'ENG 2 FIRE'], ['tail', 'TAIL DAMAGE']]) if (L[k]) warn.push(lab);
  if (!v.onGround && d.vs < -2500 && d.ft < 2500) warn.push('PULL UP');
  if (v.onGround && Math.abs(v.speed) > (v.type.takeoff || 40)) warn.push('ROTATE');
  for (const w of warn) { x.fillStyle = w === 'ROTATE' ? '#40ff60' : '#ff3030'; x.fillText(w, W - 20, y); y += 30; }
  x.restore();
}
