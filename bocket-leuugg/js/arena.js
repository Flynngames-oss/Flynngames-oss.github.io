// The arena: a big rounded box (so the floor curves smoothly up into the walls and the walls curve
// into the ceiling) with a goal box cut into each end. Everything collides against one distance
// function, which makes wall driving, ceiling shots and bounces all come from the same maths.
// Units are metres. Floor is y = 0. Blue defends -Z, Red defends +Z.

export const W = 40;   // half width  (x)
export const H = 10;   // half height (y) -> ceiling at 20
export const L = 52;   // half length (z) -> end walls at +-52
export const R = 7;    // how round the edges are (the ramps)
export const GW = 9;   // goal half width
export const GH = 6.5; // goal height
export const GD = 9;   // goal depth
export const GR = 0.6; // goal box edge rounding
export const BALL_R = 0.93;

const GZ0 = L - R - 2, GZ1 = L + GD;
export const GOAL_CZ = (GZ0 + GZ1) / 2, GOAL_HZ = (GZ1 - GZ0) / 2;

function sdRoundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
  const m = Math.max(qx, qy, qz);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + (m < 0 ? m : 0) - r;
}

// negative inside the open arena
export function sdArena(x, y, z) { return sdRoundBox(x, y - H, z, W, H, L, R); }
// negative inside either goal box
export function sdGoal(x, y, z) { return sdRoundBox(x, y - GH / 2, Math.abs(z) - GOAL_CZ, GW, GH / 2, GOAL_HZ, GR); }

// distance to the nearest wall: > 0 in open air, < 0 inside a wall
export function free(x, y, z) {
  const a = sdArena(x, y, z), g = sdGoal(x, y, z);
  return -(a < g ? a : g);
}

// direction pointing away from the nearest wall (into the open)
export function normalAt(x, y, z, out) {
  const e = 0.02;
  const nx = free(x + e, y, z) - free(x - e, y, z);
  const ny = free(x, y + e, z) - free(x, y - e, z);
  const nz = free(x, y, z + e) - free(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

// march a ray until it touches a wall; returns the distance or -1
export function ray(ox, oy, oz, dx, dy, dz, maxT) {
  let t = 0;
  for (let i = 0; i < 20; i++) {
    const d = free(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < 0.002) return t;
    t += d;
    if (t > maxT) return -1;
  }
  return -1;
}

// boost pads: big ones give 100, small ones 12
export const PADS = [];
for (const [x, z] of [[-30, 0], [30, 0], [-29, -41], [29, -41], [-29, 41], [29, 41]]) PADS.push({ x, z, big: true });
for (const z of [-38, -26, -13, 13, 26, 38]) for (const x of [-20, 0, 20]) PADS.push({ x, z, big: false });
for (const [x, z] of [[-11, 0], [11, 0], [-5, -46], [5, -46], [-5, 46], [5, 46], [-34, -22], [34, -22], [-34, 22], [34, 22]]) PADS.push({ x, z, big: false });

// kickoff spots for blue (orange is mirrored). [x, z]
export const SPAWNS = [[0, -40], [-16, -31], [16, -31], [-6, -45]];
// where demolished cars come back
export const RESPAWNS = [[-8, -47], [8, -47], [-3, -48], [3, -48]];
