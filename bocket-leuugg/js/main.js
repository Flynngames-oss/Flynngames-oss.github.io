// Bocket Leuugg: car soccer with boost. Menus, matches (bots, split-screen, free play, online),
// kickoffs, goals, overtime, demos, cameras, HUD and the garage.
import * as THREE from 'three';
import { L, BALL_R, PADS, SPAWNS, RESPAWNS, free, normalAt } from './arena.js';
import { Car, Ball, stepCar, stepBall, carBall, carCar, demolish, packCar, packBall, unpackInto, blankInput, SUPERSONIC } from './physics.js';
import { Bot, predictBall, SKILLS } from './ai.js';
import { createScene, makeCar, makeBall, makeShadow, placeShadow, makeTag, buildPads, updatePads, Particles, syncCarMesh, TEAM_COLORS, TEAM_CSS, TEAM_NAMES, BODIES, TOPPERS, ACCENTS, WHEELS_COL, TRAILS, defaultLook } from './render.js';
import { ray } from './arena.js';
import { WHEELS, SUS_LEN } from './physics.js';
import { Net, randomCode } from './net.js';
import { readInput, pollPads, endFrame, tap, bindMouse, setupTouch, touch, padPressed } from './input.js';
import { unlock, sfx, engineUpdate, setMuted, muted } from './audio.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 120;
const V3 = THREE.Vector3;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (x) => Math.round(x * 100) / 100;
const now = () => performance.now();

// ---------- the world ----------
const canvas = $('game');
const { renderer, scene, arena } = createScene(canvas);
const cams = [new THREE.PerspectiveCamera(74, 1, 0.1, 900), new THREE.PerspectiveCamera(74, 1, 0.1, 900)];
cams[0].layers.enable(1); cams[0].layers.enable(3);
cams[1].layers.enable(1); cams[1].layers.enable(2);
const specCam = new THREE.PerspectiveCamera(60, 1, 0.1, 900); specCam.layers.enable(1); specCam.layers.enable(2); specCam.layers.enable(3);
const particles = new Particles(scene);
const padMeshes = buildPads(scene);
const ballMesh = makeBall(); scene.add(ballMesh);
const ballShadow = makeShadow(2.6, 0.6); scene.add(ballShadow);
const ballLight = new THREE.PointLight('#ffffff', 0, 8, 2); scene.add(ballLight);
bindMouse(canvas);
setupTouch(document.body);

// ---------- your car look ----------
function cleanLook(l) {
  const d = defaultLook();
  if (!l || typeof l !== 'object') return d;
  const n = (v, max) => (Number.isInteger(v) && v >= 0 && v < max ? v : 0);
  return {
    name: (typeof l.name === 'string' && l.name.trim() ? l.name.trim() : 'Player').slice(0, 16),
    body: n(l.body, BODIES.length), accent: n(l.accent, ACCENTS.length), wheels: n(l.wheels, WHEELS_COL.length),
    trail: n(l.trail, TRAILS.length), topper: n(l.topper, TOPPERS.length), shade: n(l.shade, 3),
  };
}
let look;
try { look = cleanLook(JSON.parse(localStorage.getItem('bocket.look'))); } catch (e) { look = defaultLook(); }
if (look.name === 'Player') look.name = 'Player' + Math.floor(100 + Math.random() * 900);
const saveLook = () => { try { localStorage.setItem('bocket.look', JSON.stringify(look)); } catch (e) { /* ignore */ } };
const BOT_NAMES = ['Sprocket', 'Turbo Tina', 'Dent', 'Wobbles', 'Gizmo', 'Nitro Nan', 'Bumper', 'Skid', 'Zoomer', 'Clunk', 'Fizz', 'Rusty', 'Pip', 'Torque'];
const botLook = () => ({ name: '', body: Math.floor(Math.random() * BODIES.length), accent: Math.floor(Math.random() * ACCENTS.length), wheels: Math.floor(Math.random() * WHEELS_COL.length), trail: Math.floor(Math.random() * TRAILS.length), topper: Math.random() < 0.5 ? 0 : Math.floor(Math.random() * TOPPERS.length), shade: Math.floor(Math.random() * 3) });
const QUICK = ['Nice shot! 🔥', 'Got it!', 'Need boost!', 'What a save! 🧤', 'Sorry! 😅', 'GG 🤝'];

const net = new Net();

// ---------- HUD helpers ----------
let bannerTimer = 0;
function banner(big, small = '', ms = 1600, color = '#fff') {
  const b = $('banner');
  b.innerHTML = `<div class="big" style="color:${color}">${big}</div>${small ? `<div class="small">${small}</div>` : ''}`;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  b.classList.remove('hidden');
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
function feed(html) {
  const f = $('feed'); const d = document.createElement('div'); d.className = 'fi'; d.innerHTML = html; f.prepend(d);
  setTimeout(() => d.classList.add('out'), 4200); setTimeout(() => d.remove(), 4800);
  while (f.children.length > 5) f.lastChild.remove();
}
const carName = (c) => `<b style="color:${TEAM_CSS[c.team]}">${esc(c.name)}</b>`;
function fmtTime(t, ot) {
  const s = Math.max(0, Math.ceil(t - 1e-6));
  const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
  return (ot ? '+' : '') + m + ':' + ss;
}

// ---------- matches ----------
class Match {
  // cfg: { kind: 'bots'|'free'|'split'|'online'|'attract', role: 'offline'|'host'|'client', skill, minutes, mid, cars: [{name, team, look, bot, owner}] }
  constructor(cfg) {
    this.cfg = cfg; this.role = cfg.role; this.kind = cfg.kind; this.mid = cfg.mid || 0;
    this.ball = new Ball(); this.cars = []; this.bots = []; this.humans = [];
    this.score = [0, 0]; this.time = cfg.minutes ? cfg.minutes * 60 : 0; this.overtime = false;
    this.phase = 'countdown'; this.phaseT = 3; this.kickoff = true; this.frozen = true; this.kickoffId = 0;
    this.goalN = 0; this.lastGoal = null; this.lastTouch = -1; this.touchHist = [];
    this.pads = PADS.map(() => ({ t: 0, local: -1e9 }));
    this.preds = []; this.predT = 0; this.ended = false; this.pendingEnd = false; this.spawns = [];
    this.lastSnap = now(); this.lastLocalHit = -1e9; this.netT = 0; this.paused = false; this.shake = 0; this.flash = 0;
    this.started = now();
    this.group = new THREE.Group(); scene.add(this.group);
    let botN = Math.floor(Math.random() * BOT_NAMES.length);
    cfg.cars.forEach((e, i) => {
      const car = new Car(e.team);
      car.idx = i; car.look = cleanLook(e.look); car.bot = !!e.bot; car.owner = e.owner || null;
      car.name = e.bot ? (e.name || BOT_NAMES[botN++ % BOT_NAMES.length]) : car.look.name;
      if (e.name && !e.bot) car.name = String(e.name).slice(0, 16);
      car.stats = { goals: 0, touches: 0, demos: 0, saves: 0 };
      const mine = this.role === 'offline' ? !e.bot : e.owner === net.id;
      car.sim = this.role === 'client' ? mine : (e.bot || mine);
      car.lastHeard = now();
      car.mesh = makeCar(car.look, car.team); this.group.add(car.mesh);
      car.tag = makeTag(car.name, TEAM_CSS[car.team]); car.tag.layers.set(1); this.group.add(car.tag);
      car.shadow = makeShadow(1.7, 0.5); this.group.add(car.shadow);
      car.wasDemo = false;
      this.cars.push(car);
      if (car.sim && e.bot) this.bots.push(new Bot(car, cfg.skill));
      if (mine && !e.bot) {
        const k = this.humans.length;
        const split = cfg.kind === 'split';
        this.humans.push({ car, k, scheme: split ? (k === 0 ? 'p1' : 'p2') : 'all', pad: split ? k : 0, cam: cams[k], ballCam: true, dir: new V3(0, 0, 1), up: new V3(0, 1, 0), camPos: new V3() });
        car.tag.layers.set(2 + k);
      }
    });
    this.setupKickoff();
    if (this.role === 'client') this.kickoffId = -1; // the host's first update puts us on our spot
  }

  get auth() { return this.role !== 'client'; }

  setupKickoff() {
    this.ball.reset();
    this.phase = 'countdown'; this.phaseT = this.kind === 'free' ? 1 : 3; this.kickoff = true; this.frozen = true; this.kickoffId++;
    this.lastTouch = -1; this.touchHist = [];
    for (const team of [0, 1]) {
      const list = this.cars.filter((c) => c.team === team);
      let spots = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
      if (list.length === 1) spots = [Math.floor(Math.random() * 3)];
      list.forEach((c, k) => {
        const s = SPAWNS[spots[k % spots.length]];
        const extra = Math.floor(k / 4) * 3;
        const m = team === 0 ? 1 : -1;
        const x = s[0] * m + extra, z = s[1] * m - extra * m;
        const yaw = Math.atan2(-x, -z);
        c.place(x, 0.32, z, yaw); c.boost = 33;
        this.spawns[c.idx] = [r2(x), r2(z), r2(yaw)];
      });
    }
    for (const p of this.pads) p.t = 0;
    for (const h of this.humans) { h.dir.set(0, 0, h.car.team === 0 ? 1 : -1); h.up.set(0, 1, 0); }
    if (this.kind === 'free') { this.cars[0].place(0, 0.32, -20, 0); this.ball.pos.set(0, BALL_R + 0.02, 0); }
  }

  carAt(i) { return this.cars[i]; }

  respawn(c) {
    const s = RESPAWNS[Math.floor(Math.random() * RESPAWNS.length)];
    const m = c.team === 0 ? 1 : -1;
    c.place(s[0] * m, 0.32, s[1] * m, c.team === 0 ? 0 : Math.PI);
    c.boost = 33;
  }

  onDemo = (victim, attacker) => {
    if (!this.auth || this.phase === 'countdown') return;
    demolish(victim);
    attacker.stats.demos++;
    demoFx(victim, attacker);
  };

  scoreGoal(team) {
    this.score[team]++;
    this.phase = 'goal'; this.phaseT = this.kind === 'free' ? 2 : 3;
    // who scored: the last touch by the scoring team (an own goal counts for nobody)
    let by = -1, assist = -1;
    for (let i = this.touchHist.length - 1; i >= 0; i--) {
      const c = this.cars[this.touchHist[i]];
      if (!c) continue;
      if (by < 0) { if (c.team === team) by = c.idx; else break; } else if (c.team === team && c.idx !== by) { assist = c.idx; break; }
    }
    if (by >= 0) this.cars[by].stats.goals++;
    this.goalN++;
    this.lastGoal = { n: this.goalN, team, by, as: assist };
    goalFx(this, this.lastGoal);
    if (this.overtime) this.pendingEnd = true;
  }

  end() {
    this.phase = 'over'; this.frozen = true;
    if (!this.ended) { this.ended = true; showResults(this); }
  }

  tick(dt) {
    if (this.paused) return;
    const auth = this.auth;
    if (auth) {
      if (this.phase === 'countdown') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) { this.phase = 'play'; this.frozen = false; }
      } else if (this.phase === 'play') {
        if (this.kind !== 'free' && this.kind !== 'attract') {
          if (this.overtime) this.time += dt;
          else {
            this.time -= dt;
            // time's up once the ball touches the floor
            if (this.time <= 0) {
              this.time = 0;
              this.waitT = (this.waitT || 0) + dt;
              if (this.ball.pos.y < BALL_R + 0.3 || this.waitT > 4) {
                this.waitT = 0;
                if (this.score[0] === this.score[1]) { this.overtime = true; this.time = 0; this.setupKickoff(); overtimeFx(); }
                else this.end();
              }
            }
          }
        }
      } else if (this.phase === 'goal') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          if (this.pendingEnd) this.end();
          else if (this.kind === 'free') { this.ball.reset(); this.phase = 'play'; this.kickoff = false; }
          else if (this.kind === 'attract' && (this.score[0] + this.score[1]) >= 6) { this.score = [0, 0]; this.setupKickoff(); }
          else this.setupKickoff();
        }
      }
    }
    // bots
    if (this.bots.length) {
      this.predT -= dt;
      if (this.predT <= 0) { predictBall(this.ball, this.preds); this.predT = 0.1; }
      for (const b of this.bots) b.update(this, dt, this.preds);
    }
    // cars
    const frozen = this.frozen || this.phase === 'over';
    for (const c of this.cars) {
      if (c.sim) {
        c.events = 0;
        stepCar(c, dt, frozen);
        if (c.events && c.mesh && this.humans.some((h) => h.car === c)) sfx.jump();
        if (c.demo) { c.respawnT -= dt; if (c.respawnT <= 0) this.respawn(c); }
      } else this.followRemote(c, dt);
    }
    // ball
    const ballLive = this.phase === 'play' || (this.phase === 'goal' && this.phaseT > (this.kind === 'free' ? 1.9 : 2.9)) || (this.phase === 'over' && this.kind !== 'attract');
    if (this.phase === 'countdown') { this.ball.reset(); }
    else if (ballLive || this.phase === 'goal') {
      const bounce = stepBall(this.ball, dt);
      if (bounce > 4 && this.phase === 'play') sfx.bounce(bounce);
      if (this.phase === 'play' || this.phase === 'over') {
        for (const c of this.cars) {
          if (c.demo) continue;
          if (!auth && !c.sim) { carBall(c, this.ball, false); continue; }
          if (auth && !c.sim) continue; // that player tells us about their own hits
          const hit = carBall(c, this.ball, true);
          if (hit) this.touched(c, hit);
        }
      }
    }
    // cars bumping cars
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        if (!auth && !a.sim && !b.sim) continue;
        carCar(a, b, auth && !frozen ? this.onDemo : null);
      }
    }
    // boost pads
    for (let i = 0; i < PADS.length; i++) if (this.pads[i].t > 0) this.pads[i].t -= dt;
    for (const c of this.cars) {
      if (!c.sim || c.demo || c.boost >= 100) continue;
      for (let i = 0; i < PADS.length; i++) {
        const p = PADS[i], st = this.pads[i];
        if (st.t > 0) continue;
        const dx = c.pos.x - p.x, dz = c.pos.z - p.z, r = p.big ? 2.1 : 1.25;
        if (dx * dx + dz * dz < r * r && c.pos.y < (p.big ? 2.6 : 1.4)) {
          c.boost = Math.min(100, c.boost + (p.big ? 100 : 12));
          st.t = p.big ? 10 : 4; st.local = now();
          if (this.role === 'client') net.send({ t: 'p', mid: this.mid, i });
          if (this.humans.some((h) => h.car === c)) sfx.pad(p.big);
          if (p.big) particles.burst(p.x, 1, p.z, new THREE.Color('#ffc24a'), 25, 5, 0.6, 0.4);
        }
      }
    }
    // goals
    if (auth && this.phase === 'play' && Math.abs(this.ball.pos.z) > L + BALL_R) this.scoreGoal(this.ball.pos.z > 0 ? 0 : 1);
  }

  touched(c, power) {
    if (this.touchHist[this.touchHist.length - 1] !== c.idx) this.touchHist.push(c.idx);
    if (this.touchHist.length > 8) this.touchHist.shift();
    this.lastTouch = c.idx;
    if (this.kickoff) this.kickoff = false;
    c.stats.touches++;
    hitFx(this, c, power);
    if (this.role === 'client' && c.sim) {
      this.lastLocalHit = now();
      net.send({ t: 'h', mid: this.mid, i: c.idx, ball: packBall(this.ball) });
    }
  }

  // smooth a car someone else is driving towards where they told us it is
  followRemote(c, dt) {
    const n = c.net;
    if (!n) return;
    const age = Math.min(0.3, (now() - n.at) / 1000 + 0.05);
    const s = n.s;
    _tp.set(s[0] + s[7] * age, s[1] + s[8] * age, s[2] + s[9] * age);
    if (_tp.distanceToSquared(c.pos) > 36) c.pos.copy(_tp); else c.pos.lerp(_tp, Math.min(1, dt * 14));
    _tq.set(s[3], s[4], s[5], s[6]).normalize();
    c.q.slerp(_tq, Math.min(1, dt * 16));
    c.vel.set(s[7], s[8], s[9]); c.w.set(s[10], s[11], s[12]);
    c.in.steer = n.st || 0; c.boosting = !!n.b && !c.demo; c.boost = n.bo || 0;
    c.super = c.vel.length() >= SUPERSONIC;
  }

  destroy() {
    scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
const _tp = new V3(), _tq = new THREE.Quaternion();

// ---------- effects ----------
function hitFx(m, c, power) {
  if (m.kind === 'attract' && !m.humans.length) { if (power > 12) sfx.hit(power * 0.3); }
  else sfx.hit(power);
  const b = m.ball.pos;
  particles.burst(b.x, b.y, b.z, new THREE.Color('#ffffff'), Math.min(30, 4 + power), Math.min(9, 2 + power * 0.25), 0.35, 0.25);
  if (power > 18) m.shake = Math.max(m.shake, 0.15);
}
function demoFx(victim, attacker) {
  const p = victim.pos;
  particles.burst(p.x, p.y, p.z, new THREE.Color('#ff9a3c'), 80, 12, 1.0, 0.8);
  particles.burst(p.x, p.y, p.z, TEAM_COLORS[victim.team], 40, 8, 1.2, 0.6);
  if (match && match.kind !== 'attract') {
    sfx.demo();
    if (attacker) feed(`💥 ${carName(attacker)} demolished ${carName(victim)}`);
  }
}
function goalFx(m, g) {
  const b = m.ball.pos;
  const col = TEAM_COLORS[g.team];
  particles.burst(b.x, b.y, b.z, col, 260, 26, 1.8, 1.1);
  particles.burst(b.x, b.y, b.z, new THREE.Color('#ffffff'), 120, 18, 1.4, 0.7);
  particles.burst(b.x, b.y, b.z, new THREE.Color('#ffd23f'), 80, 22, 1.6, 0.8);
  // blast cars away from the ball
  for (const c of m.cars) {
    if (!c.sim || c.demo) continue;
    const d = c.pos.distanceTo(b);
    if (d < 14) c.vel.add(_tp.subVectors(c.pos, b).normalize().multiplyScalar((14 - d) * 1.4)).add(new V3(0, (14 - d) * 0.5, 0));
  }
  m.shake = 0.6; m.flash = 1; arena.uniforms.uFlashSide.value = b.z > 0 ? 1 : 0;
  if (m.kind === 'attract') return;
  sfx.goal();
  const scorer = g.by >= 0 ? m.cars[g.by] : null;
  const assist = g.as >= 0 ? m.cars[g.as] : null;
  const who = scorer ? `${esc(scorer.name)} scored!` : 'Own goal! 🙈';
  banner('GOAL!', who + (assist ? ` · assist ${esc(assist.name)}` : ''), 2800, TEAM_CSS[g.team]);
  feed(scorer ? `⚽ ${carName(scorer)} scored for ${TEAM_NAMES[g.team]}` : `⚽ Goal for ${TEAM_NAMES[g.team]}`);
}
function overtimeFx() { if (match && match.kind !== 'attract') banner('OVERTIME', 'Next goal wins!', 2500, '#ffd23f'); }

// ---------- online messages ----------
const lobby = { on: false, host: false, hostId: null, roster: new Map(), cfg: { size: 2, skill: 1, minutes: 5, fill: true }, started: false, mid: 0, cars: null, myTeam: -1, lastLb: 0, timer: 0 };

net.onMessage = (m) => {
  const t = now();
  // lobby
  if (m.t === 'hi' && lobby.host) {
    let e = lobby.roster.get(m.id);
    const team = m.team === 0 || m.team === 1 ? m.team : -1;
    if (!e) {
      const c0 = [...lobby.roster.values()].filter((x) => x.team === 0).length, c1 = lobby.roster.size - c0;
      e = { id: m.id, team: team >= 0 ? team : (c0 <= c1 ? 0 : 1) };
      lobby.roster.set(m.id, e);
      feed(`👋 ${esc(cleanLook(m.look).name)} joined the room`);
    }
    e.look = cleanLook(m.look); e.name = e.look.name; e.at = t;
    if (team >= 0) e.team = team;
    renderLobby();
    return;
  }
  if (m.t === 'lb' && !lobby.host && lobby.on) {
    if (lobby.hostId && lobby.hostId !== m.id && t - lobby.lastLb < 8000) return;
    lobby.hostId = m.id; lobby.lastLb = t;
    if (Array.isArray(m.roster)) lobby.roster = new Map(m.roster.map((r) => [r.id, r]));
    if (m.cfg) lobby.cfg = m.cfg;
    lobby.started = !!m.started;
    if (m.started && Array.isArray(m.cars) && m.cars.some((c) => c.owner === net.id) && (!match || match.mid !== m.mid)) {
      startOnline({ cars: m.cars, cfg: m.cfg, mid: m.mid });
    } else if (!m.started && match && match.role === 'client' && m.mid === match.mid && now() - match.started > 3000) {
      endMatchToLobby();
    }
    renderLobby();
    return;
  }
  if (m.t === 'go' && !lobby.host && lobby.on && m.id === lobby.hostId) {
    if (!match || match.mid !== m.mid) startOnline(m);
    return;
  }
  if (m.t === 'bye') {
    if (lobby.host && lobby.roster.has(m.id)) { const e = lobby.roster.get(m.id); feed(`👋 ${esc(e.name || 'Someone')} left`); lobby.roster.delete(m.id); renderLobby(); }
    if (!lobby.host && m.id === lobby.hostId) { hostGone(); }
    return;
  }
  if (!match || match.kind !== 'online' || m.mid !== match.mid) return;
  const mt = match;
  if (m.t === 'c') {
    const c = mt.cars[m.i];
    if (!c || c.owner !== m.id || c.sim || !Array.isArray(m.s) || m.s.length !== 13) return;
    c.net = { s: m.s, st: m.st, b: m.b, bo: m.bo, at: t }; c.lastHeard = t;
    if (mt.auth) { if (c.demo && !m.d && m.dn >= c.demoN) { c.demo = false; } }
    else c.demo = !!m.d;
    if (lobby.host) { const e = lobby.roster.get(m.id); if (e) e.at = t; }
  } else if (m.t === 's' && !mt.auth && m.id === lobby.hostId) {
    applySnap(mt, m);
  } else if (m.t === 'h') {
    const c = mt.cars[m.i];
    if (!c || c.owner !== m.id || !Array.isArray(m.ball)) return;
    if (!mt.auth && t - mt.lastLocalHit < 300) return;
    unpackInto(mt.ball, m.ball);
    mt.ball.pos.addScaledVector(mt.ball.vel, 0.05);
    if (mt.auth) { mt.touched(c, mt.ball.vel.length() * 0.5); }
    else sfx.hit(mt.ball.vel.length() * 0.5);
  } else if (m.t === 'p' && mt.auth) {
    const i = m.i | 0;
    if (PADS[i] && mt.pads[i].t <= 0) mt.pads[i].t = PADS[i].big ? 10 : 4;
  } else if (m.t === 'q') {
    const c = mt.cars[m.i];
    if (c && c.owner === m.id && QUICK[m.m | 0]) quickChat(c, m.m | 0, false);
  }
};

function buildSnap(m) {
  const cars = [];
  for (const c of m.cars) if (c.sim) cars.push([c.idx, packCar(c), r2(c.in.steer), c.boosting ? 1 : 0, Math.round(c.boost)]);
  const pads = [];
  m.pads.forEach((p, i) => { if (p.t > 0) pads.push([i, r2(p.t)]); });
  return {
    t: 's', mid: m.mid, ph: m.phase, pt: r2(m.phaseT), tm: r2(m.time), ot: m.overtime ? 1 : 0, sc: m.score, k: m.kickoffId, sp: m.spawns,
    kick: m.kickoff ? 1 : 0, ball: packBall(m.ball), cars, dm: m.cars.map((c) => (c.demo ? 1 : 0)), dn: m.cars.map((c) => c.demoN),
    pads, lg: m.lastGoal, st: m.cars.map((c) => [c.stats.goals, c.stats.touches, c.stats.demos]),
  };
}

function applySnap(mt, m) {
  const t = now();
  mt.lastSnap = t;
  const prev = mt.phase;
  mt.phase = m.ph; mt.phaseT = m.pt; mt.time = m.tm; mt.overtime = !!m.ot; mt.score = m.sc; mt.kickoff = !!m.kick; mt.frozen = m.ph === 'countdown';
  if (m.k !== mt.kickoffId && Array.isArray(m.sp)) {
    mt.kickoffId = m.k; mt.spawns = m.sp;
    for (const h of mt.humans) {
      const s = m.sp[h.car.idx];
      if (s) { h.car.place(s[0], 0.32, s[1], s[2]); h.car.boost = 33; h.dir.set(0, 0, h.car.team === 0 ? 1 : -1); }
    }
    if (prev === 'countdown' || mt.overtime) { /* nothing */ }
  }
  if (Array.isArray(m.cars)) {
    for (const e of m.cars) {
      const c = mt.cars[e[0]];
      if (!c || c.sim) continue;
      c.net = { s: e[1], st: e[2], b: e[3], bo: e[4], at: t, host: true };
    }
  }
  mt.cars.forEach((c, i) => {
    if (c.sim) {
      if (m.dn && m.dn[i] > c.demoN) { demolish(c); c.demoN = m.dn[i]; demoFx(c, null); feed(`💥 ${carName(c)} got demolished`); }
    } else if (c.net && c.net.host && m.dm) c.demo = !!m.dm[i];
  });
  if (m.st) m.st.forEach((s, i) => { const c = mt.cars[i]; if (c && Array.isArray(s)) { c.stats.goals = s[0]; c.stats.touches = s[1]; c.stats.demos = s[2]; } });
  // ball: trust our own touches for a moment, otherwise ease toward the host's ball
  if (Array.isArray(m.ball)) {
    _snapBall.pos.set(m.ball[0], m.ball[1], m.ball[2]); _snapBall.vel.set(m.ball[7], m.ball[8], m.ball[9]); _snapBall.w.set(m.ball[10], m.ball[11], m.ball[12]);
    if (m.ph !== 'play' || t - mt.lastLocalHit > 300) {
      _snapBall.pos.addScaledVector(_snapBall.vel, 0.08);
      const err = _snapBall.pos.distanceTo(mt.ball.pos);
      if (err > 5 || m.ph === 'countdown') { mt.ball.pos.copy(_snapBall.pos); mt.ball.vel.copy(_snapBall.vel); }
      else { mt.ball.pos.lerp(_snapBall.pos, 0.35); mt.ball.vel.lerp(_snapBall.vel, 0.6); }
      mt.ball.w.copy(_snapBall.w);
    }
  }
  const inactive = new Map(Array.isArray(m.pads) ? m.pads : []);
  mt.pads.forEach((p, i) => { if (t - p.local < 1200) return; p.t = inactive.get(i) || 0; });
  if (m.lg && m.lg.n !== mt.goalN) {
    mt.goalN = m.lg.n; mt.lastGoal = m.lg;
    if (m.ph === 'goal' && prev !== 'goal') goalFx(mt, m.lg);
  }
  if (m.ot && !mt.sawOT) { mt.sawOT = true; overtimeFx(); }
  if (m.ph === 'over' && !mt.ended) { mt.ended = true; showResults(mt); }
}
const _snapBall = new Ball();

function netTick(dt) {
  const t = now();
  // lobby heartbeats
  if (lobby.on) {
    if (t >= lobby.timer) {
      lobby.timer = t + (lobby.host ? 1000 : 1500);
      if (lobby.host) {
        for (const [id, e] of lobby.roster) if (id !== net.id && t - (e.at || 0) > 8000) { lobby.roster.delete(id); feed(`👋 ${esc(e.name || 'Someone')} left`); }
        net.send({ t: 'lb', roster: [...lobby.roster.values()].map((e) => ({ id: e.id, name: e.name, team: e.team })), cfg: lobby.cfg, started: lobby.started, mid: lobby.mid, cars: lobby.started ? lobby.cars : null });
        renderLobby();
      } else {
        net.send({ t: 'hi', name: look.name, look, team: lobby.myTeam });
        if (t - lobby.lastLb > 10000 && lobby.lastLb > 0) hostGone();
      }
    }
  }
  if (!match || match.kind !== 'online') return;
  if (t < match.netT) return;
  match.netT = Math.max(match.netT + 50, t - 50);
  if (match.auth) {
    net.send(buildSnap(match));
    // someone stopped talking: a bot takes their car
    for (const c of match.cars) {
      if (c.sim || c.bot) continue;
      if (t - c.lastHeard > 6000) {
        c.bot = true; c.sim = true; c.owner = null; c.demo = false; c.net = null;
        match.bots.push(new Bot(c, match.cfg.skill));
        feed(`🤖 ${carName(c)} lost connection, a bot took over`);
      }
    }
  } else {
    for (const h of match.humans) {
      const c = h.car;
      net.send({ t: 'c', mid: match.mid, i: c.idx, s: packCar(c), st: r2(c.in.steer), b: c.boosting ? 1 : 0, d: c.demo ? 1 : 0, dn: c.demoN, bo: Math.round(c.boost) });
    }
    if (t - match.lastSnap > 7000) hostGone();
  }
}

function quickChat(c, i, send) {
  feed(`💬 ${carName(c)}: ${esc(QUICK[i])}`);
  sfx.chat();
  if (send && match && match.kind === 'online') net.send({ t: 'q', mid: match.mid, i: c.idx, m: i });
}

// ---------- cameras ----------
const _cv = new V3(), _cu = new V3(), _cd = new V3(), _cl = new V3(), _cn = new V3();
const WORLD_UP = new V3(0, 1, 0);
function updateCamera(m, h, dt) {
  const c = h.car, cam = h.cam;
  const ball = m.ball.pos;
  if (c.demo) {
    cam.lookAt(c.pos);
    return;
  }
  const useBall = h.ballCam && m.phase !== 'goal' && !(m.kind === 'free' && false);
  if (useBall) {
    _cd.subVectors(ball, c.pos);
    if (_cd.lengthSq() < 0.01) _cd.set(0, 0, 1);
    _cd.normalize();
    _cd.y = Math.max(-0.2, Math.min(0.45, _cd.y));
    _cd.normalize();
    _cu.copy(WORLD_UP);
  } else {
    c.fwd(_cd);
    if (c.onGround) {
      c.up(_cu);
      if (_cu.y < -0.3) { _cu.copy(WORLD_UP); _cd.y = 0; }
    } else {
      _cu.copy(WORLD_UP);
      const vh = Math.hypot(c.vel.x, c.vel.z);
      if (vh > 4) _cd.set(c.vel.x, 0, c.vel.z); else _cd.y = 0;
      if (_cd.lengthSq() < 0.01) _cd.copy(h.dir);
    }
    _cd.normalize();
  }
  const kd = 1 - Math.exp(-(useBall ? 7 : 5) * dt), ku = 1 - Math.exp(-4 * dt);
  h.dir.lerp(_cd, kd).normalize();
  h.up.lerp(_cu, ku).normalize();
  const dist = 3.6, height = 1.35;
  _cv.copy(c.pos).addScaledVector(h.dir, -dist).addScaledVector(h.up, height);
  // stay inside the arena
  for (let i = 0; i < 3; i++) {
    const d = free(_cv.x, _cv.y, _cv.z);
    if (d > 0.5) break;
    normalAt(_cv.x, _cv.y, _cv.z, _cn);
    _cv.addScaledVector(_cn, 0.5 - d);
  }
  cam.position.copy(_cv);
  if (m.shake > 0) cam.position.add(new V3((Math.random() - 0.5) * m.shake, (Math.random() - 0.5) * m.shake, (Math.random() - 0.5) * m.shake));
  cam.up.copy(h.up);
  if (useBall) {
    _cl.copy(c.pos).addScaledVector(h.up, 0.8);
    _cd.subVectors(ball, _cl).normalize();
    _cl.addScaledVector(_cd, 5);
    _cl.addScaledVector(h.up, -0.6);
  } else _cl.copy(c.pos).addScaledVector(h.up, 0.75).addScaledVector(h.dir, 1.2);
  cam.lookAt(_cl);
  const fov = 74 + (c.super ? 5 : 0) + (c.boosting ? 2 : 0);
  cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
  cam.updateProjectionMatrix();
}

let specAng = 0;
function updateSpecCam(m, dt) {
  specAng += dt * 0.08;
  const b = m ? m.ball.pos : new V3();
  const tx = b.x * 0.5, tz = b.z * 0.6;
  _cv.set(tx + Math.sin(specAng) * 46, 26, tz + Math.cos(specAng) * 46);
  for (let i = 0; i < 3; i++) { const d = free(_cv.x, _cv.y, _cv.z); if (d > 2) break; normalAt(_cv.x, _cv.y, _cv.z, _cn); _cv.addScaledVector(_cn, 2 - d); }
  specCam.position.lerp(_cv, 1 - Math.exp(-2 * dt));
  if (m && m.shake > 0) specCam.position.add(new V3((Math.random() - 0.5) * m.shake, (Math.random() - 0.5) * m.shake, 0));
  _cl.set(b.x, Math.min(b.y, 6), b.z);
  specLook.lerp(_cl, 1 - Math.exp(-3 * dt));
  specCam.up.set(0, 1, 0);
  specCam.lookAt(specLook);
}
const specLook = new V3();

// ---------- syncing meshes ----------
const _f = new V3(), _u = new V3(), _hp = new V3(), _col = new THREE.Color();
function syncVisuals(m, dt) {
  for (const c of m.cars) {
    if (!c.sim && !c.demo) {
      // wheels for cars we're not simulating
      c.up(_u);
      for (let i = 0; i < 4; i++) {
        const w = WHEELS[i];
        _hp.set(w[0], w[1], w[2]).applyQuaternion(c.q).add(c.pos);
        const t = ray(_hp.x, _hp.y, _hp.z, -_u.x, -_u.y, -_u.z, SUS_LEN);
        c.wheelT[i] = t < 0 ? SUS_LEN : t;
      }
    }
    if (c.demo && !c.wasDemo && !c.sim) demoFx(c, null);
    c.wasDemo = c.demo;
    syncCarMesh(c.mesh, c, dt);
    c.tag.visible = !c.demo && m.kind !== 'attract' && m.kind !== 'free';
    c.tag.position.set(c.pos.x, c.pos.y + 1.3, c.pos.z);
    c.shadow.visible = !c.demo;
    if (!c.demo) placeShadow(c.shadow, c.pos.x, c.pos.y, c.pos.z, 1);
    if (c.demo) continue;
    // boost flames and supersonic streaks
    c.fwd(_f);
    if (c.boosting) {
      const tr = c.mesh.userData.trail;
      for (let k = 0; k < 3; k++) {
        particles.emit(c.pos.x - _f.x * 0.75 + (Math.random() - 0.5) * 0.15, c.pos.y - _f.y * 0.75 + (Math.random() - 0.5) * 0.15, c.pos.z - _f.z * 0.75 + (Math.random() - 0.5) * 0.15,
          -_f.x * 7 + c.vel.x * 0.4 + (Math.random() - 0.5), -_f.y * 7 + c.vel.y * 0.4 + (Math.random() - 0.5), -_f.z * 7 + c.vel.z * 0.4 + (Math.random() - 0.5),
          tr, 0.35 + Math.random() * 0.2, 0.32 + Math.random() * 0.2, -1);
      }
    }
    if (c.super) {
      c.up(_u);
      _col.set('#cfe8ff');
      for (const s of [-1, 1]) {
        particles.emit(c.pos.x - _f.x * 0.6 + s * 0.4 * _f.z - _u.x * 0.1, c.pos.y - _u.y * 0.1, c.pos.z - _f.z * 0.6 - s * 0.4 * _f.x - _u.z * 0.1, c.vel.x * 0.8, c.vel.y * 0.8, c.vel.z * 0.8, _col, 0.25, 0.18);
      }
    }
  }
  const b = m.ball;
  const hidden = m.phase === 'goal' && m.phaseT < (m.kind === 'free' ? 1.95 : 2.95);
  ballMesh.visible = !hidden;
  ballMesh.position.copy(b.pos); ballMesh.quaternion.copy(b.q);
  ballShadow.visible = !hidden;
  if (!hidden) placeShadow(ballShadow, b.pos.x, b.pos.y, b.pos.z, 1.3);
  ballLight.position.copy(b.pos); ballLight.intensity = hidden ? 0 : 2;
  updatePads(padMeshes, m.pads, now() / 1000);
  m.shake = Math.max(0, m.shake - dt * 1.2);
  m.flash = Math.max(0, m.flash - dt * 0.6);
  arena.uniforms.uFlash.value = m.flash;
}

// ---------- HUD ----------
let lastBeep = -1;
function updateHUD(m) {
  const show = m.kind !== 'attract';
  $('hud').classList.toggle('hidden', !show);
  if (!show) return;
  $('sB').textContent = m.score[0]; $('sR').textContent = m.score[1];
  $('clock').textContent = m.kind === 'free' ? 'FREE PLAY' : fmtTime(m.time, m.overtime);
  $('clock').classList.toggle('ot', m.overtime);
  $('scoreboard').classList.toggle('free', m.kind === 'free');
  // countdown
  if (m.phase === 'countdown' && m.kind !== 'free') {
    const n = Math.ceil(m.phaseT);
    if (n !== lastBeep && n > 0 && n <= 3) { lastBeep = n; banner(String(n), m.overtime ? 'Overtime: next goal wins' : '', 900); sfx.beep(false); }
  } else if (lastBeep > 0 && m.phase === 'play') { lastBeep = -1; if (m.kind !== 'free') { banner('GO!', '', 700, '#ffd23f'); sfx.beep(true); } }
  // boost meters
  const split = m.humans.length > 1;
  for (let k = 0; k < 2; k++) {
    const el = $('boost' + k), h = m.humans[k];
    el.classList.toggle('hidden', !h);
    el.classList.toggle('splitTop', split && k === 0);
    if (!h) continue;
    const v = Math.round(h.car.boost);
    el.style.setProperty('--p', v);
    el.style.setProperty('--c', TEAM_CSS[h.car.team]);
    el.querySelector('b').textContent = v;
    el.classList.toggle('sup', h.car.super);
  }
  $('demoMsg').classList.toggle('hidden', !(m.humans[0] && m.humans[0].car.demo));
  $('freeHelp').classList.toggle('hidden', m.kind !== 'free');
  $('splitLine').classList.toggle('hidden', !split);
}

// ---------- results ----------
function showResults(m) {
  if (m.kind === 'attract') return;
  const [b, r] = m.score;
  const win = b === r ? -1 : (b > r ? 0 : 1);
  const mine = m.humans[0] ? m.humans[0].car.team : -1;
  let title = win < 0 ? 'DRAW' : `${TEAM_NAMES[win].toUpperCase()} WINS!`;
  if (mine >= 0 && win >= 0 && m.humans.length === 1) title = win === mine ? 'YOU WIN! 🏆' : 'YOU LOST 😭';
  $('resTitle').textContent = title;
  $('resTitle').style.color = win >= 0 ? TEAM_CSS[win] : '#fff';
  $('resScore').innerHTML = `<span style="color:${TEAM_CSS[0]}">${b}</span> – <span style="color:${TEAM_CSS[1]}">${r}</span>`;
  const rows = [...m.cars].sort((x, y) => x.team - y.team || (y.stats.goals * 100 + y.stats.touches * 5 + y.stats.demos * 25) - (x.stats.goals * 100 + x.stats.touches * 5 + x.stats.demos * 25));
  $('resTable').innerHTML = '<tr><th>Player</th><th>Goals</th><th>Touches</th><th>Demos</th><th>Points</th></tr>' + rows.map((c) =>
    `<tr><td style="color:${TEAM_CSS[c.team]}">${esc(c.name)}${c.bot ? ' 🤖' : ''}</td><td>${c.stats.goals}</td><td>${c.stats.touches}</td><td>${c.stats.demos}</td><td>${c.stats.goals * 100 + c.stats.touches * 5 + c.stats.demos * 25}</td></tr>`).join('');
  $('resAgain').classList.toggle('hidden', m.kind === 'online' && !lobby.host);
  $('resAgain').textContent = m.kind === 'online' ? 'Back to Lobby' : 'Play Again';
  $('resWait').classList.toggle('hidden', !(m.kind === 'online' && !lobby.host));
  setTimeout(() => { show('results'); }, 1200);
  if (m.kind !== 'online' || lobby.host) sfx.whistle();
}

// ---------- screens ----------
const SCREENS = ['title', 'bots', 'split', 'online', 'lobby', 'garage', 'controls', 'pause', 'results'];
let screen = 'title';
function show(name) {
  screen = name;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  document.body.classList.toggle('inmenu', name !== null && name !== 'pause' && name !== 'results');
  if (name === 'garage') openGarage();
  if (name === 'online') { $('onName').value = look.name; }
}
function hideScreens() { screen = null; for (const s of SCREENS) $(s).classList.add('hidden'); document.body.classList.remove('inmenu'); }

let match = null;
function startMatch(cfg) {
  if (match) match.destroy();
  match = new Match(cfg);
  acc = 0; lastBeep = -1;
  if (cfg.kind !== 'attract') { hideScreens(); unlock(); if (cfg.kind === 'free') banner('FREE PLAY', 'R: reset ball · T: get a pass · Esc: menu', 3000); }
  $('feed').innerHTML = '';
}
function attract() {
  const cars = [];
  for (const team of [0, 1]) for (let i = 0; i < 2; i++) cars.push({ team, look: botLook(), bot: true });
  startMatch({ kind: 'attract', role: 'offline', skill: 2, minutes: 0, cars });
}
function quitToMenu() {
  if (lobby.on) leaveOnline();
  attract();
  show('title');
}

// buttons
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { unlock(); show(b.dataset.go); }));
function pick(groupId, onPick) {
  const g = $(groupId);
  g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (onPick) onPick(b.dataset.v);
  });
}
const val = (groupId) => { const b = $(groupId).querySelector('button.on'); return b ? b.dataset.v : null; };
for (const id of ['botSize', 'botSkill', 'botTime', 'spMode', 'spSize', 'spSkill', 'spTime']) pick(id);

$('botStart').addEventListener('click', () => {
  const size = +val('botSize'), skill = +val('botSkill'), minutes = +val('botTime');
  const cars = [{ team: 0, look, owner: 'p0' }];
  for (let i = 1; i < size; i++) cars.push({ team: 0, look: botLook(), bot: true });
  for (let i = 0; i < size; i++) cars.push({ team: 1, look: botLook(), bot: true });
  startMatch({ kind: 'bots', role: 'offline', skill, minutes, cars });
});
$('freeStart').addEventListener('click', () => {
  startMatch({ kind: 'free', role: 'offline', skill: 1, minutes: 0, cars: [{ team: 0, look, owner: 'p0' }] });
});
$('spStart').addEventListener('click', () => {
  const coop = val('spMode') === 'coop', size = +val('spSize'), skill = +val('spSkill'), minutes = +val('spTime');
  const p2look = { ...botLook(), name: 'Player 2' };
  const cars = [{ team: 0, look, owner: 'p0' }, { team: coop ? 0 : 1, look: p2look, owner: 'p1' }];
  const n0 = coop ? 2 : 1, n1 = coop ? 0 : 1;
  const sz = Math.max(size, n0);
  for (let i = n0; i < sz; i++) cars.push({ team: 0, look: botLook(), bot: true });
  for (let i = n1; i < sz; i++) cars.push({ team: 1, look: botLook(), bot: true });
  // keep the two humans first so they get cameras 1 and 2
  startMatch({ kind: 'split', role: 'offline', skill, minutes, cars });
});
$('resAgain').addEventListener('click', () => {
  if (!match) return;
  if (match.kind === 'online') { backToLobbyHost(); return; }
  const cfg = match.cfg;
  startMatch({ ...cfg, cars: cfg.cars.map((c) => ({ ...c })) });
});
$('resMenu').addEventListener('click', quitToMenu);
$('pResume').addEventListener('click', () => { if (match) match.paused = false; hideScreens(); });
$('pQuit').addEventListener('click', quitToMenu);
$('pControls').addEventListener('click', () => { show('controls'); controlsBack = 'pause'; });
let controlsBack = 'title';
$('ctrlBack').addEventListener('click', () => { show(controlsBack); controlsBack = 'title'; });
$('muteBtn').addEventListener('click', () => { setMuted(!muted); $('muteBtn').textContent = muted ? '🔇' : '🔊'; });
$('muteBtn').textContent = muted ? '🔇' : '🔊';
$('pauseBtn').addEventListener('click', () => openPause());
function openPause() {
  if (!match || match.kind === 'attract' || screen === 'results') return;
  if (match.kind !== 'online') match.paused = true;
  $('pNote').textContent = match.kind === 'online' ? 'The match keeps going while you’re here!' : '';
  show('pause');
}

// ---------- online screens ----------
function hostGone() {
  if (!lobby.on || lobby.host) return;
  feed('😢 The host left the room');
  leaveOnline();
  attract();
  show('online');
  $('onStatus').textContent = 'The host left the room.';
}
function leaveOnline() {
  net.stop();
  lobby.on = false; lobby.host = false; lobby.hostId = null; lobby.roster.clear(); lobby.started = false; lobby.lastLb = 0;
}
async function goOnline(code, host) {
  look.name = ($('onName').value || look.name).trim().slice(0, 16) || look.name; saveLook();
  $('onStatus').textContent = 'Connecting…';
  $('onHost').disabled = $('onJoin').disabled = true;
  const ok = await net.start(code, (s) => { $('onStatus').textContent = s; });
  $('onHost').disabled = $('onJoin').disabled = false;
  if (!ok) return;
  lobby.on = true; lobby.host = host; lobby.hostId = host ? net.id : null; lobby.roster.clear(); lobby.started = false; lobby.myTeam = -1; lobby.timer = 0; lobby.lastLb = host ? 0 : now();
  if (host) lobby.roster.set(net.id, { id: net.id, name: look.name, look, team: 0, at: now() });
  $('onStatus').textContent = '';
  show('lobby');
  renderLobby();
}
$('onHost').addEventListener('click', () => goOnline(randomCode(), true));
$('onJoin').addEventListener('click', () => {
  const code = $('onCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 3) { $('onStatus').textContent = 'Type the room code your friend sees.'; return; }
  goOnline(code, false);
});
$('lbLeave').addEventListener('click', () => { leaveOnline(); show('online'); });
$('lbBlue').addEventListener('click', () => setTeam(0));
$('lbRed').addEventListener('click', () => setTeam(1));
function setTeam(t) {
  if (lobby.host) { const e = lobby.roster.get(net.id); if (e) e.team = t; renderLobby(); }
  else { lobby.myTeam = t; net.send({ t: 'hi', name: look.name, look, team: t }); }
}
for (const id of ['lbSize', 'lbSkill', 'lbTime']) pick(id, () => {
  if (!lobby.host) return;
  lobby.cfg = { size: +val('lbSize'), skill: +val('lbSkill'), minutes: +val('lbTime'), fill: $('lbFill').checked };
});
$('lbFill').addEventListener('change', () => { lobby.cfg.fill = $('lbFill').checked; });
$('lbStart').addEventListener('click', () => {
  if (!lobby.host) return;
  const cfg = { ...lobby.cfg };
  const roster = [...lobby.roster.values()];
  const cars = [];
  const size = Math.max(cfg.size, ...[0, 1].map((t) => roster.filter((e) => e.team === t).length));
  for (const team of [0, 1]) {
    const hs = roster.filter((e) => e.team === team);
    for (const e of hs) cars.push({ team, look: e.id === net.id ? look : e.look, owner: e.id, name: e.id === net.id ? look.name : e.name });
    if (cfg.fill) for (let i = hs.length; i < size; i++) cars.push({ team, look: botLook(), bot: true, name: BOT_NAMES[(cars.length * 3 + i) % BOT_NAMES.length] });
  }
  if (!cars.some((c) => c.team === 0) || !cars.some((c) => c.team === 1)) { $('lbNote').textContent = 'Both teams need someone! Turn on “Fill with bots” or swap teams.'; return; }
  lobby.mid = Math.floor(Math.random() * 1e9); lobby.started = true; lobby.cars = cars;
  const msg = { t: 'go', cars, cfg, mid: lobby.mid };
  net.send(msg); setTimeout(() => net.send({ ...msg }), 300); setTimeout(() => net.send({ ...msg }), 900);
  startMatch({ kind: 'online', role: 'host', skill: cfg.skill, minutes: cfg.minutes, cars, mid: lobby.mid });
});
function startOnline(m) {
  const cfg = m.cfg || lobby.cfg;
  startMatch({ kind: 'online', role: 'client', skill: cfg.skill, minutes: cfg.minutes, cars: m.cars, mid: m.mid });
}
function backToLobbyHost() {
  lobby.started = false; lobby.cars = null;
  if (match) match.destroy();
  attract();
  show('lobby'); renderLobby();
}
function endMatchToLobby() {
  if (match) match.destroy();
  attract();
  show('lobby'); renderLobby();
}
function renderLobby() {
  if (screen !== 'lobby') return;
  $('lbCode').textContent = net.code;
  const roster = [...lobby.roster.values()];
  for (const team of [0, 1]) {
    $('lbT' + team).innerHTML = roster.filter((e) => e.team === team).map((e) => `<div class="pl">${e.id === lobby.hostId ? '👑 ' : ''}${esc(e.name || 'Player')}${e.id === net.id ? ' <i>(you)</i>' : ''}</div>`).join('') || '<div class="pl empty">nobody yet</div>';
  }
  document.querySelectorAll('.hostOnly').forEach((el) => el.classList.toggle('hidden', !lobby.host));
  $('lbGuest').classList.toggle('hidden', lobby.host);
  $('lbGuest').textContent = lobby.started ? 'A match is going on. You’ll be in the next one!' : (lobby.hostId ? 'Waiting for the host to start…' : 'Looking for the host…');
  if (!lobby.host) {
    const c = lobby.cfg;
    $('lbInfo').textContent = `${c.size}v${c.size} · ${SKILLS[c.skill] ? SKILLS[c.skill].name : ''} bots${c.fill ? '' : ' off'} · ${c.minutes} min`;
  } else $('lbInfo').textContent = 'Share the code with your friends. They pick “Join”.';
}

// ---------- garage ----------
const gScene = new THREE.Scene();
gScene.background = new THREE.Color('#0b1020');
gScene.add(new THREE.HemisphereLight('#cfe0ff', '#202838', 1.6));
const gSun = new THREE.DirectionalLight('#ffffff', 2.4); gSun.position.set(3, 5, 4); gScene.add(gSun);
const gRim = new THREE.DirectionalLight('#7aa8ff', 1.4); gRim.position.set(-4, 2, -3); gScene.add(gRim);
const gPlat = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.12, 48), new THREE.MeshStandardMaterial({ color: '#1b2236', metalness: 0.5, roughness: 0.4 }));
gPlat.position.y = -0.33; gScene.add(gPlat);
const gRing = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.02, 6, 64), new THREE.MeshBasicMaterial({ color: '#ffd23f' })); gRing.rotation.x = Math.PI / 2; gRing.position.y = -0.27; gScene.add(gRing);
const gCam = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
let gCar = null, gAng = 0.7, gTeam = 0, gDrag = null;
function rebuildGarageCar() {
  if (gCar) gScene.remove(gCar);
  gCar = makeCar(look, gTeam); gScene.add(gCar);
}
function openGarage() {
  $('gName').value = look.name;
  rebuildGarageCar();
  renderGarageOpts();
}
const GOPTS = [
  ['Body', 'body', BODIES], ['Paint shade', 'shade', ['Bright', 'Dark', 'Pastel']], ['Accent', 'accent', ACCENTS, true],
  ['Wheels', 'wheels', WHEELS_COL, true], ['Boost', 'trail', TRAILS, true], ['Topper', 'topper', TOPPERS],
];
function renderGarageOpts() {
  $('gOpts').innerHTML = GOPTS.map(([label, key, list, swatch]) => `<div class="gRow"><div class="gLab">${label}</div><div class="gList">${list.map((v, i) =>
    `<button class="${swatch ? 'sw' : 'chip'} ${look[key] === i ? 'on' : ''}" data-k="${key}" data-i="${i}" ${swatch ? `style="background:${v}"` : ''}>${swatch ? '' : esc(v)}</button>`).join('')}</div></div>`).join('');
}
$('gOpts').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  look[b.dataset.k] = +b.dataset.i; saveLook(); rebuildGarageCar(); renderGarageOpts();
});
$('gName').addEventListener('input', () => { look.name = $('gName').value.slice(0, 16) || 'Player'; saveLook(); });
$('gTeam').addEventListener('click', () => { gTeam = 1 - gTeam; $('gTeam').textContent = gTeam ? 'Preview: Red' : 'Preview: Blue'; rebuildGarageCar(); });
$('gRandom').addEventListener('click', () => { const n = look.name; look = { ...botLook(), name: n }; saveLook(); rebuildGarageCar(); renderGarageOpts(); });
$('gDone').addEventListener('click', () => { look.name = ($('gName').value || look.name).slice(0, 16); saveLook(); show('title'); });
canvas.addEventListener('pointerdown', (e) => { if (screen === 'garage') gDrag = e.clientX; });
addEventListener('pointermove', (e) => { if (gDrag !== null) { gAng -= (e.clientX - gDrag) * 0.01; gDrag = e.clientX; } });
addEventListener('pointerup', () => { gDrag = null; });

// ---------- keys that aren't driving ----------
function handleKeys(m) {
  if (tap('Escape') || tap('KeyP') || padPressed(0, 9)) {
    if (screen === 'pause') { $('pResume').click(); }
    else if (screen === null && m && m.kind !== 'attract') openPause();
    else if (['bots', 'split', 'online', 'controls', 'garage'].includes(screen)) show(screen === 'controls' ? controlsBack : 'title');
  }
  if (!m || screen !== null) return;
  if (m.kind === 'free' && m.humans[0]) {
    const c = m.humans[0].car;
    if (tap('KeyR') || padPressed(0, 8)) {
      const f = c.fwd(new V3()); f.y = 0; f.normalize();
      m.ball.pos.set(c.pos.x + f.x * 7, 3, c.pos.z + f.z * 7); m.ball.vel.set(0, 0, 0); m.ball.w.set(0, 0, 0);
      if (free(m.ball.pos.x, m.ball.pos.y, m.ball.pos.z) < BALL_R) m.ball.reset();
      m.phase = 'play';
    }
    if (tap('KeyT')) {
      // a pass rolling/lobbing towards you from somewhere random
      const a = Math.random() * Math.PI * 2;
      const p = new V3(c.pos.x + Math.cos(a) * 20, 2, c.pos.z + Math.sin(a) * 20);
      p.x = Math.max(-30, Math.min(30, p.x)); p.z = Math.max(-42, Math.min(42, p.z));
      m.ball.pos.copy(p);
      const d = new V3().subVectors(c.pos, p); const dist = d.length(); d.normalize();
      m.ball.vel.set(d.x * dist * 0.6, 6 + Math.random() * 5, d.z * dist * 0.6); m.ball.w.set(0, 0, 0);
      m.phase = 'play';
    }
  }
  // quick chat
  const ch = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
  for (let i = 0; i < ch.length; i++) if (tap(ch[i]) && m.humans[0] && m.kind !== 'free') quickChat(m.humans[0].car, i, true);
  for (let i = 0; i < 4; i++) if (padPressed(0, 12 + i) && m.humans[0] && m.kind !== 'free') quickChat(m.humans[0].car, i, true);
}

// ---------- the loop ----------
let acc = 0, last = now(), fpsT = 0, frames = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
}
addEventListener('resize', resize); resize();

function frame() {
  requestAnimationFrame(frame);
  const t = now();
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  pollPads();
  const m = match;
  handleKeys(m);
  if (m) {
    // read local players
    for (const h of m.humans) {
      const blocked = screen !== null && screen !== 'results' || m.phase === 'over';
      const camT = readInput(h.scheme, h.pad, h.car.in);
      if (blocked) Object.assign(h.car.in, blankInput());
      if (camT && !blocked) { h.ballCam = !h.ballCam; }
    }
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 10) { m.tick(STEP); acc -= STEP; n++; }
    if (n >= 10) acc = 0;
    netTick(dt);
    if (match !== m) return; // the match changed during a message
    syncVisuals(m, dt);
    particles.update(dt);
    updateHUD(m);
    const h0 = m.humans[0];
    engineUpdate(h0 ? h0.car.speed() : 0, h0 ? h0.car.in.throttle : 0, h0 ? h0.car.boosting : false, !!h0 && !h0.car.demo && screen === null);
    $('ballCamTag').textContent = h0 ? (h0.ballCam ? 'BALL CAM' : 'CAR CAM') : '';
  }
  // draw
  const W = renderer.domElement.width / renderer.getPixelRatio(), H = renderer.domElement.height / renderer.getPixelRatio();
  if (screen === 'garage') {
    gAng += dt * 0.25;
    gCam.position.set(Math.sin(gAng) * 3.6, 1.3, Math.cos(gAng) * 3.6);
    gCam.lookAt(0, 0, 0);
    const pw = W > 760 ? W * 0.55 : W;
    gCam.aspect = pw / H; gCam.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, pw, H); renderer.setScissor(0, 0, pw, H);
    renderer.render(gScene, gCam);
    renderer.setScissorTest(false);
    endFrame();
    return;
  }
  const ms = m && screen === null || (m && (screen === 'results' || screen === 'pause')) ? m : null;
  if (ms && ms.humans.length) {
    if (ms.humans.length === 1) {
      const h = ms.humans[0];
      updateCamera(ms, h, dt);
      h.cam.aspect = W / H; h.cam.updateProjectionMatrix();
      renderer.setViewport(0, 0, W, H);
      renderer.render(scene, h.cam);
    } else {
      renderer.setScissorTest(true);
      ms.humans.forEach((h, k) => {
        updateCamera(ms, h, dt);
        h.cam.aspect = W / (H / 2); h.cam.updateProjectionMatrix();
        const y = k === 0 ? H / 2 : 0;
        renderer.setViewport(0, y, W, H / 2); renderer.setScissor(0, y, W, H / 2);
        renderer.render(scene, h.cam);
      });
      renderer.setScissorTest(false);
    }
  } else {
    updateSpecCam(m, dt);
    specCam.aspect = W / H; specCam.updateProjectionMatrix();
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, specCam);
  }
  endFrame();
  frames++;
  if (t - fpsT > 1000) { window.__fps = frames * 1000 / (t - fpsT); frames = 0; fpsT = t; }
}

// When the tab is hidden the browser stops drawing frames. A host still has to run the match for
// everyone else, so a tiny worker keeps waking us up to step the game and send updates.
let hiddenLast = now();
try {
  const src = 'setInterval(() => postMessage(0), 33);';
  const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = () => {
    const t = now();
    const dt = Math.min(0.1, (t - hiddenLast) / 1000); hiddenLast = t;
    if (!document.hidden || !match || match.kind !== 'online') return;
    for (const h of match.humans) Object.assign(h.car.in, blankInput());
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 14) { match.tick(STEP); acc -= STEP; n++; }
    if (n >= 14) acc = 0;
    netTick(dt);
  };
} catch (e) { /* no workers: the match pauses while hidden */ }

// touch: show buttons once someone touches the screen
addEventListener('touchstart', () => { if (!touch.on) { touch.on = true; document.body.classList.add('touch'); } }, { passive: true });
// unlock audio on first input
addEventListener('pointerdown', unlock, { once: true });
addEventListener('keydown', unlock, { once: true });

attract();
show('title');
$('boot').classList.add('gone');
setTimeout(() => $('boot').remove(), 700);
requestAnimationFrame(frame);

// for testing from the console
window.__bocket = { get match() { return match; }, startMatch, look };
