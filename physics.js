// physics.js - BeamNG-style soft-body vehicle physics. No dependencies, runs in browser or Node.
//
// Each vehicle is ~200 mass points (nodes) joined by ~1100 springs (beams), simulated at 1500 Hz:
//   * a chassis of 12 cross-section rings x 6 nodes (stiff passenger cell, crumple zones front and rear)
//   * engine block and fuel tank on breakable mounts
//   * 4 wheel hubs on real suspension: two-point wishbone arms + a spring/damper strut with bump stops and droop limits
//   * 12 separate body panels (bumpers, hood, trunk, doors, fenders, quarter panels, skirts), each its own grid of
//     nodes, held on by breakable attachment beams, so they dent, flap, and rip off
// Beams yield plastically (permanent dents), harden as they crush, and snap when over-stretched.

export const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const WORLD_HALF = 195;
export const WATER = { x: 70, z: 95, r: 19, y: -0.8, rw: 12.6 };   // lake: a bowl in the terrain filled to y = -0.8

// ---------------------------------------------------------------- world
// ramps rise along +z. p = curve exponent (1 = straight), flat = extra plateau length after the top
export const RAMPS = [
  { x0: -5, x1: 5, z0: 30, z1: 46, h: 3, p: 1, flat: 0 },         // small kicker
  { x0: -9, x1: 9, z0: 70, z1: 94, h: 7.5, p: 1, flat: 0 },       // big jump
  { x0: 30, x1: 50, z0: 55, z1: 80, h: 5, p: 2.2, flat: 0 },      // steep curved kicker
  { x0: 100, x1: 118, z0: 20, z1: 45, h: 4.5, p: 1, flat: 0 },     // east kicker
  { x0: -12, x1: 12, z0: -140, z1: -100, h: 12, p: 1, flat: 30 }, // skyline ramp + plateau (drops off at z = -70)
];

export function onRamp(x, z) {
  for (const q of RAMPS) if (z >= q.z0 && z <= q.z1 + q.flat && x >= q.x0 && x <= q.x1) return true;
  return false;
}

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = smooth(130, 250, r) * (7 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 3 * Math.sin(x * 0.037) * Math.sin(z * 0.031 + 2));
  for (const q of RAMPS) {
    if (z >= q.z0 && z <= q.z1 + q.flat && x >= q.x0 && x <= q.x1) {
      const t = clamp((z - q.z0) / (q.z1 - q.z0), 0, 1);
      const ew = Math.max(1.5, q.h * 0.4), zEnd = q.z1 + q.flat;
      const side = smooth(q.x0, q.x0 + ew, x) * (1 - smooth(q.x1 - ew, q.x1, x));
      h = Math.max(h, q.h * Math.pow(t, q.p) * side * (1 - smooth(zEnd - 3, zEnd, z)));
    }
  }
  const dl = Math.hypot(x - WATER.x, z - WATER.z);       // lake bowl
  if (dl < WATER.r) h -= 3.2 * (0.5 + 0.5 * Math.cos(Math.PI * dl / WATER.r));
  const dm = Math.hypot(x + 45, z - 25);                 // round mound
  if (dm < 22) h += 6 * (0.5 + 0.5 * Math.cos(Math.PI * dm / 22));
  if (Math.abs(x) < 25) {                                // speed bumps
    for (let i = 0; i < 6; i++) {
      const dz = z - (-30 - 6 * i);
      if (Math.abs(dz) < 1.3) h += 0.2 * (0.5 + 0.5 * Math.cos(Math.PI * dz / 1.3));
    }
  }
  return h;
}

export function terrainNormal(x, z, o) {
  const e = 0.3;
  const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  o[0] = -dx / l; o[1] = 1 / l; o[2] = -dz / l;
}

// fast bilinear height grid for the physics (the terrain function is too slow to call ~600 times per step)
const GS = 0.4, GN = 1001, GO = -200;
const HG = new Float32Array(GN * GN);
for (let j = 0; j < GN; j++) { const z = GO + j * GS; for (let i = 0; i < GN; i++) HG[j * GN + i] = terrainHeight(GO + i * GS, z); }
export function groundH(x, z) {
  let fx = (x - GO) / GS, fz = (z - GO) / GS;
  if (fx < 0) fx = 0; else if (fx > GN - 1.001) fx = GN - 1.001;
  if (fz < 0) fz = 0; else if (fz > GN - 1.001) fz = GN - 1.001;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * GN + i;
  const a = HG[k], b = HG[k + 1], c = HG[k + GN], d = HG[k + GN + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
function groundNormal(x, z, o) {
  const e = 0.4;
  const dx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
  const dz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  o[0] = -dx / l; o[1] = 1 / l; o[2] = -dz / l;
}

// static boxes
export const OBSTACLES = [];
function box(x0, y0, z0, x1, y1, z1, kind) { OBSTACLES.push({ min: [x0, y0, z0], max: [x1, y1, z1], kind }); }
box(-25, -6, 130, 25, 4, 132, 'wall');                                       // crash wall past the big jump
for (let z = -40; z <= 40; z += 10) box(-22.5, -1, z - 0.5, -21.5, 4, z + 0.5, 'pillar'); // slalom pillars
for (let i = 0; i < 3; i++) box(20 + i * 1.3, 0, 15, 21.2 + i * 1.3, 1.2, 16.2, 'crate');
box(21.3, 1.2, 15, 22.5, 2.4, 16.2, 'crate');
box(-4, -1, -70, 4, 1.0, -68.5, 'barrier');                                  // low barrier
box(-30, -6, -64, 30, 3, -62.5, 'wall');                                     // landing wall under the skyline drop

// more to hit: a pole field, a lone pole, crate pyramid, brick wall, jersey chicane, arch, big blocks
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) box(62 + i * 9 - 0.2, -1, -24 + j * 14 - 0.2, 62 + i * 9 + 0.2, 7, -24 + j * 14 + 0.2, 'pole');
box(-15.2, -1, 50 - 0.2, -14.8, 7, 50 + 0.2, 'pole');
box(0 - 0.2, -1, 112 - 0.2, 0.2, 7, 112 + 0.2, 'pole');
for (let lv = 0; lv < 3; lv++) for (let i = 0; i < 3 - lv; i++) box(40 + lv * 0.65 + i * 1.3, lv * 1.2, -45, 41.2 + lv * 0.65 + i * 1.3, lv * 1.2 + 1.2, -43.8, 'crate');
box(80, 0, -80, 81, 3, -50, 'wall');
for (let i = 0; i < 4; i++) box(-70 + i * 6, -1, -45 + (i % 2) * 5, -66 + i * 6, 0.9, -44 + (i % 2) * 5, 'barrier');
box(-95, -1, -6, -94, 4, 6, 'wall'); box(-86, -1, -6, -85, 4, 6, 'wall'); box(-95, 4, -6, -85, 5, 6, 'wall');
box(-60, -1, 60, -56, 3, 64, 'block'); box(-60, -1, 70, -56, 5, 74, 'block'); box(-50, -1, 80, -44, 2, 86, 'block');

// sharp steel blades: they slice through anything that hits them hard enough
box(58, -1, 40, 66, 3.5, 40.08, 'blade'); box(68, -1, 52, 76, 3.5, 52.08, 'blade'); box(100, -1, -12, 100.08, 3.5, -4, 'blade'); box(-35, -1, -90, -27, 3.5, -89.92, 'blade');

export const TREES = [];
{
  const R = rng(1337); let tries = 0;
  while (TREES.length < 90 && tries++ < 4000) {
    const x = (R() * 2 - 1) * 185, z = (R() * 2 - 1) * 185;
    if (Math.hypot(x, z) < 140 || onRamp(x, z)) continue;
    const y = terrainHeight(x, z), s = 0.8 + R() * 0.8;
    TREES.push({ x, y, z, s });
    box(x - 0.35 * s, y - 1, z - 0.35 * s, x + 0.35 * s, y + 6 * s, z + 0.35 * s, 'tree');
  }
}

// pushable balls
export const BALLS = [];
function ball(x, z, r, m, color) {
  BALLS.push({ x, y: terrainHeight(x, z) + r, z, vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0, r, m, color, home: [x, z] });
}
for (let i = 0; i < 8; i++) ball(10 + i * 2.6, 22, 0.9, 40, i);
for (let i = 0; i < 3; i++) ball(-10, 24 + i * 3.6, 1.5, 150, 8 + i);
// wrecking ball on a gantry: a heavy ball on a rope that swings across the road
box(8, -1, 109.5, 11, 17, 112.5, 'block'); box(49, -1, 109.5, 52, 17, 112.5, 'block'); box(8, 16, 109.5, 52, 17.6, 112.5, 'block');
{
  const len = 14.5, ang = 1.0, b = { x: 30 + len * Math.sin(ang), y: 16.2 - len * Math.cos(ang), z: 111, vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0, r: 1.4, m: 3000, color: 5, home: [30, 111] };
  b.rope = { ax: 30, ay: 16.2, az: 111, len }; b.start = [b.x, b.y, b.z];
  BALLS.push(b);
}
export function resetBalls() {
  for (const b of BALLS) {
    if (b.rope) { b.x = b.start[0]; b.y = b.start[1]; b.z = b.start[2]; } else { b.x = b.home[0]; b.z = b.home[1]; b.y = terrainHeight(b.x, b.z) + b.r; }
    b.vx = b.vy = b.vz = 0;
  }
}

// ---------------------------------------------------------------- vehicle topology
// 12 stations (rings) along the car, rear (0) -> front (11); 6 nodes per ring:
//   0 floor-L, 1 belt-L, 2 roof-L, 3 roof-R, 4 belt-R, 5 floor-R   (left = +x)
export const NSTA = 12, RING = 6, NR = NSTA * RING;
export const st = (s, k) => s * RING + k;
export const HUB = NR;                // 72..75: FL FR RL RR
export const ENG = NR + 4;            // 76
export const FUEL = NR + 5;           // 77
export const CORE = NR + 6;           // 78..89: one centre-line spine node per station (anchors for panels, stiffens the frame)
export const NCH = CORE + NSTA;       // first panel node

// per-vehicle data. Arrays are per station (rear -> front).
export const VEHICLES = {
  sedan: {
    name: 'Sedan', tyreW: 0.24, rim: 0.66, blurb: 'Balanced rear-wheel drive',
    Z: [-2.25, -2.05, -1.65, -1.25, -0.85, -0.45, -0.05, 0.35, 0.75, 1.2, 1.7, 2.25],
    YF: [0.48, 0.44, 0.42, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.41, 0.43, 0.46],
    YB: [0.72, 0.78, 0.80, 0.82, 0.84, 0.84, 0.84, 0.84, 0.82, 0.80, 0.78, 0.66],
    YR: [0.85, 0.94, 0.98, 1.12, 1.42, 1.46, 1.45, 1.38, 0.98, 0.95, 0.92, 0.80],
    WB: [0.78, 0.84, 0.88, 0.88, 0.88, 0.88, 0.88, 0.88, 0.88, 0.87, 0.84, 0.78],
    WT: [0.68, 0.72, 0.75, 0.70, 0.66, 0.66, 0.66, 0.68, 0.78, 0.78, 0.76, 0.68],
    YS: [0.005, 0.0055, 0.007, 0.012, 0.015, 0.016, 0.015, 0.011, 0.008, 0.006, 0.0055, 0.005],
    WF: 0.72, WX: 1.0, WR: 0.35, axF: 1.45, axR: -1.35,
    EA: 4.0e5, mass: 1150, mEng: 140, mFuel: 45, mWheel: 35, pm: 1,
    look: { bumper: 'paint', grille: 'paint', lamp: 'slim', face: 'intake', color: 'silver', doors: 4, trim: 'chrome', rearKind: 'sedan', sill: 'chrome', beltLine: 'rgba(255,255,255,0.18)' },
    rideF: 1.3, rideR: 1.5, travelUp: 0.11, travelDown: 0.13,
    torque: 190, final: 3.9, drive: 'rwd', grip: 1.15, drag: 0.02, brake: 4500, bed: false,
  },
  pickup: {
    name: 'Pickup', tyreW: 0.3, rim: 0.55, blurb: 'Heavy, tall, all-wheel drive',
    Z: [-2.6, -2.4, -1.9, -1.4, -0.95, -0.5, -0.05, 0.4, 0.85, 1.3, 1.85, 2.6],
    YF: [0.65, 0.63, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.63, 0.64, 0.66],
    YB: [1.0, 1.05, 1.08, 1.08, 1.25, 1.25, 1.25, 1.22, 1.2, 1.18, 1.14, 1.08],
    YR: [1.12, 1.15, 1.15, 1.15, 1.95, 2.0, 1.98, 1.9, 1.5, 1.46, 1.44, 1.4],
    WB: [0.92, 0.96, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 0.97, 0.94, 0.9],
    WT: [0.9, 0.92, 0.92, 0.92, 0.82, 0.8, 0.8, 0.82, 0.92, 0.92, 0.9, 0.85],
    YS: [0.006, 0.0065, 0.008, 0.013, 0.016, 0.017, 0.016, 0.012, 0.009, 0.007, 0.0065, 0.006],
    WF: 0.85, WX: 1.1, WR: 0.43, axF: 1.65, axR: -1.6,
    EA: 6.9e5, mass: 2100, mEng: 250, mFuel: 80, mWheel: 55, pm: 1.4,
    rideF: 1.2, rideR: 1.05, travelUp: 0.14, travelDown: 0.18,
    torque: 330, final: 4.2, drive: 'awd', grip: 1.1, drag: 0.03, brake: 6500, bed: true,
    look: { bumper: 'dark', grille: 'dark', lamp: 'slim', face: 'bars', color: 'green', doors: 4, rearKind: 'truck', rearOnTail: true, winRear: [4.05, 3.9], doorRear: 4.05, sill: 'dark', flare: 0.07, arch: 0.11, markers: false },
  },
  coupe: {
    name: 'Coupe', tyreW: 0.26, rim: 0.72, blurb: 'Light, grippy and fast',
    Z: [-2.0, -1.85, -1.5, -1.1, -0.7, -0.3, 0.1, 0.5, 0.9, 1.3, 1.7, 2.1],
    YF: [0.38, 0.36, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.36, 0.37, 0.38],
    YB: [0.62, 0.66, 0.68, 0.7, 0.72, 0.72, 0.72, 0.7, 0.68, 0.64, 0.6, 0.53],
    YR: [0.78, 0.86, 0.94, 1.06, 1.22, 1.27, 1.25, 1.16, 0.84, 0.8, 0.74, 0.64],
    WB: [0.78, 0.84, 0.86, 0.86, 0.86, 0.86, 0.86, 0.86, 0.86, 0.84, 0.8, 0.74],
    WT: [0.6, 0.66, 0.7, 0.64, 0.58, 0.56, 0.58, 0.62, 0.74, 0.74, 0.7, 0.62],
    YS: [0.0045, 0.005, 0.0065, 0.011, 0.014, 0.015, 0.014, 0.01, 0.0075, 0.0055, 0.005, 0.0045],
    WF: 0.68, WX: 0.96, WR: 0.33, axF: 1.3, axR: -1.2,
    EA: 3.7e5, mass: 1000, mEng: 120, mFuel: 40, mWheel: 30, pm: 0.85,
    rideF: 1.6, rideR: 1.8, travelUp: 0.09, travelDown: 0.11,
    torque: 175, final: 3.5, drive: 'rwd', grip: 1.3, drag: 0.014, brake: 4200, bed: false,
    look: { bumper: 'paint', grille: 'paint', lamp: 'slim', face: 'mouth', color: 'teal', doors: 2, rearKind: 'sedan', exhaust: true, sideVent: true, sill: 'dark', hoodVents: true, doorRear: 5.0, flare: 0.03, arch: 0.05 },
  },
};

// more cars, built from the same topology with different proportions
{
  const S = VEHICLES.sedan, P = VEHICLES.pickup, mk = (o) => Object.assign({}, S, o), sc = (a, k) => a.map((v) => v * k), add = (a, k) => a.map((v) => v + k);
  VEHICLES.hatch = mk({
    name: 'Hatchback', tyreW: 0.21, rim: 0.7, blurb: 'Small, front-wheel drive, agile',
    Z: sc(S.Z, 0.82), YB: add(S.YB, -0.02), YR: [1.24, 1.34, 1.4, 1.43, 1.45, 1.46, 1.45, 1.38, 0.98, 0.95, 0.92, 0.82], WB: sc(S.WB, 0.96), WT: sc(S.WT, 1.03),
    WF: 0.72, WX: 1.0, WR: 0.32, axF: 1.19, axR: -1.11, EA: 3.8e5, mass: 1050, mEng: 120, mFuel: 40, mWheel: 30, pm: 0.9,
    rideF: 1.45, rideR: 1.65, torque: 160, final: 4.1, drive: 'fwd', grip: 1.25, drag: 0.016, brake: 4200,
    look: { bumper: 'paint', grille: 'paint', lamp: 'slim', face: 'intake', color: 'blue', doors: 4, rearKind: 'hatch', rearOnTail: true, winRear: [1.5, 1.2], sill: 'dark' },
  });
  VEHICLES.suv = mk({
    name: 'SUV', tyreW: 0.29, rim: 0.58, blurb: 'Tall, tough, all-wheel drive',
    Z: sc(S.Z, 1.02), YF: add(S.YF, 0.14), YB: add(S.YB, 0.2), YR: [1.62, 1.76, 1.8, 1.82, 1.84, 1.84, 1.82, 1.7, 1.16, 1.1, 1.04, 0.92],
    WB: sc(S.WB, 1.05), WT: [0.9, 0.92, 0.94, 0.92, 0.9, 0.9, 0.9, 0.9, 0.92, 0.92, 0.9, 0.84], YS: P.YS,
    WF: 0.8, WX: 1.08, WR: 0.4, axF: 1.5, axR: -1.4, EA: 6.0e5, mass: 1950, mEng: 220, mFuel: 70, mWheel: 48, pm: 1.3,
    rideF: 1.25, rideR: 1.2, travelUp: 0.14, travelDown: 0.18, torque: 300, final: 4.0, drive: 'awd', grip: 1.1, drag: 0.03, brake: 6000,
    look: { bumper: 'dark', grille: 'dark', lamp: 'slim', face: 'slots', color: 'white', doors: 4, rearKind: 'wagon', rearOnTail: true, winRear: [1.5, 1.2], lowerBand: [0.3, 0.62], lowerCol: '#1d2024', flare: 0.07, arch: 0.1, sill: 'dark' },
  });
  VEHICLES.muscle = mk({
    name: 'Muscle', tyreW: 0.32, rim: 0.64, blurb: 'Long hood, huge torque, rear-wheel drive',
    Z: [-2.4, -2.2, -1.8, -1.4, -1.0, -0.6, -0.2, 0.2, 0.65, 1.2, 1.85, 2.55],
    YB: [0.74, 0.8, 0.82, 0.84, 0.86, 0.86, 0.86, 0.86, 0.84, 0.82, 0.8, 0.7], YR: [0.88, 0.96, 1.04, 1.16, 1.34, 1.38, 1.36, 1.28, 0.96, 0.93, 0.9, 0.84],
    WX: 1.02, axF: 1.55, axR: -1.5, EA: 4.5e5, mass: 1600, mEng: 230, mFuel: 55, mWheel: 40, pm: 1.05,
    torque: 420, final: 3.7, drive: 'rwd', grip: 1.05, drag: 0.024, brake: 4800,
    look: { bumper: 'chrome', grille: 'dark', lamp: 'round', face: 'bars', color: 'blue', doors: 2, trim: 'chrome', rearKind: 'sedan', exhaust: true, scoop: true, sill: 'chrome', doorRear: 4.9, stripeSt: [[8.15, 11.2], [0.1, 2.5]], stripeX: 0.16, stripeCol: '#f1f2f4', flare: 0.025, arch: 0.07 },
  });
  VEHICLES.van = mk({
    name: 'Van', tyreW: 0.27, rim: 0.55, blurb: 'Big box, slow, lots to break',
    Z: [-2.6, -2.35, -1.9, -1.4, -0.9, -0.4, 0.1, 0.55, 0.95, 1.35, 1.9, 2.4],
    YF: P.YF, YB: [1.1, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15, 1.1, 1.0, 0.95, 0.9, 0.85], YR: [2.1, 2.15, 2.15, 2.15, 2.15, 2.15, 2.1, 2.0, 1.42, 1.34, 1.24, 1.12],
    WB: sc(P.WB, 0.99), WT: [0.93, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.9, 0.9, 0.88, 0.84], YS: P.YS,
    WF: 0.85, WX: 1.1, WR: 0.4, axF: 1.6, axR: -1.7, EA: 6.5e5, mass: 2300, mEng: 200, mFuel: 75, mWheel: 50, pm: 1.5,
    rideF: 1.15, rideR: 1.0, travelUp: 0.14, travelDown: 0.18, torque: 290, final: 4.3, drive: 'rwd', grip: 1.05, drag: 0.04, brake: 6200,
    look: { bumper: 'dark', grille: 'paint', lamp: 'slim', face: 'bars', color: 'white', doors: 2, noSideGlass: true, frontWinOnly: true, rearKind: 'van', rearOnTail: true, lowerBand: [0.4, 0.82], lowerCol: '#3c4046', doorRear: 6.2, flare: 0.05, arch: 0.08, markers: false },
  });
  VEHICLES.mini = mk({
    name: 'Mini', tyreW: 0.18, rim: 0.62, blurb: 'Tiny and fragile, front-wheel drive',
    Z: sc(S.Z, 0.72), YB: add(S.YB, -0.05), YR: [1.06, 1.14, 1.2, 1.26, 1.3, 1.32, 1.3, 1.26, 0.98, 0.95, 0.92, 0.84], WB: sc(S.WB, 0.97), WT: [0.74, 0.78, 0.8, 0.78, 0.76, 0.76, 0.76, 0.78, 0.8, 0.8, 0.78, 0.72],
    WF: 0.68, WX: 0.94, WR: 0.28, axF: 1.04, axR: -0.97, EA: 2.8e5, mass: 750, mEng: 80, mFuel: 30, mWheel: 22, pm: 0.7,
    rideF: 1.5, rideR: 1.7, travelUp: 0.09, travelDown: 0.11, torque: 105, final: 4.3, drive: 'fwd', grip: 1.2, drag: 0.012, brake: 3600,
    look: { bumper: 'paint', grille: 'dark', lamp: 'round', face: 'mini', color: 'red', doors: 2, rearKind: 'hatch', rearOnTail: true, winRear: [4.0, 3.2], roofCol: '#eeeef1', stripeSt: [[8.2, 11.2]], stripeX: 0.1, stripeCol: '#eeeef1', doorRear: 4.4, flare: 0.05, arch: 0.07 },
  });
  for (const d of Object.values(VEHICLES)) d.WX = Math.max(...d.WB) - 0.14;   // tyres sit under the bodywork
}

// structural faces that stay when body panels come off: floor, end fascia, inner arch walls (bed floor for trucks)
function chassisFaces(bed) {
  const F = [];
  const q = (a, b, c, d, col) => F.push({ q: [a, b, c, d], col });
  for (let s = 0; s < NSTA - 1; s++) {
    q(st(s, 5), st(s + 1, 5), st(s + 1, 0), st(s, 0), 'dark');
    if (s < 3 || s >= 8) { q(st(s, 0), st(s + 1, 0), st(s + 1, 1), st(s, 1), 'dark'); q(st(s, 4), st(s + 1, 4), st(s + 1, 5), st(s, 5), 'dark'); }
    if (s < 3 || s >= 8) { q(st(s, 1), st(s + 1, 1), st(s + 1, 2), st(s, 2), 'dark'); q(st(s, 3), st(s + 1, 3), st(s + 1, 4), st(s, 4), 'dark'); }
    if (bed && s < 3) q(st(s, 2), st(s + 1, 2), st(s + 1, 3), st(s, 3), 'dark');
  }
  q(st(0, 0), st(0, 5), st(0, 4), st(0, 1), 'dark'); q(st(0, 1), st(0, 4), st(0, 3), st(0, 2), 'dark');
  q(st(11, 0), st(11, 5), st(11, 4), st(11, 1), 'dark'); q(st(11, 1), st(11, 4), st(11, 3), st(11, 2), 'dark');
  return F;
}

// ---------------------------------------------------------------- tuning
const DT = 1 / 1500;
const KB = 400000, CB = 3500;     // contact stiffness / damping for a heavy body point
const KG = 180000, CG = 2500;     // wheel-ground
const MU_BODY = 0.7;
const LAT = 4500;
const GEARS = [3.6, 2.2, 1.5, 1.1, 0.85], REV = 3.3;
const KBALL = 120000, CBALL = 1200;
const MAX_STEPS = 80;
const DMG_K = 900;                // damage % scale

export class Car {
  constructor(key = 'sedan') {
    const d = this.def = VEHICLES[key] || VEHICLES.sedan;
    this.key = key in VEHICLES ? key : 'sedan';
    this.WR = d.WR;
    const { Z, YF, YB, YR, WB, WT, YS } = d;

    // ---------------- nodes (rest positions, car-local)
    const NX = [], NY = [], NZ = [], NM = [];
    const addNode = (x, y, z, m) => { NX.push(x); NY.push(y); NZ.push(z); NM.push(m); return NX.length - 1; };
    const ringPts = (s) => [[Math.min(d.WF, WB[s] - 0.03), YF[s]], [WB[s], YB[s]], [WT[s], YR[s]], [-WT[s], YR[s]], [-WB[s], YB[s]], [-Math.min(d.WF, WB[s] - 0.03), YF[s]]];
    for (let s = 0; s < NSTA; s++) { const p = ringPts(s); for (let k = 0; k < RING; k++) addNode(p[k][0], p[k][1], Z[s], 1); }
    this.wheels = [
      { i: HUB, front: true, left: true }, { i: HUB + 1, front: true, left: false },
      { i: HUB + 2, front: false, left: true }, { i: HUB + 3, front: false, left: false },
    ];
    for (const w of this.wheels) {
      addNode(w.left ? d.WX : -d.WX, d.WR, w.front ? d.axF : d.axR, d.mWheel);
      w.spin = 0; w.spinVel = 0; w.grounded = false; w.skid = 0; w.vlat = 0; w.alive = true; w.detached = false; w.flat = 0; w.beams = []; w.arms = [];
    }
    addNode(0, (YF[10] + YB[10]) / 2 + 0.05, (Z[9] + Z[10]) / 2, d.mEng);
    addNode(0, (YF[1] + YB[1]) / 2, (Z[1] + Z[2]) / 2, d.mFuel);
    for (let s = 0; s < NSTA; s++) addNode(0, (YF[s] + YB[s]) / 2, Z[s], 1);

    // ---------------- panels: separate grids of nodes laid over the chassis skin
    const lerp = (a, b, t) => a + (b - a) * t;
    const rp = (sf) => {                  // ring cross-section at fractional station sf
      const s0 = Math.max(0, Math.min(NSTA - 2, Math.floor(sf))), t = sf - s0, A = ringPts(s0), B = ringPts(s0 + 1);
      return { p: A.map((a, k) => [lerp(a[0], B[k][0], t), lerp(a[1], B[k][1], t)]), z: lerp(Z[s0], Z[s0 + 1], t) };
    };
    const edgeAt = (sf, k0, k1, h, sg, off) => {   // point h along ring edge k0->k1, pushed out by off
      const { p, z } = rp(sf), a = p[k0], b = p[k1];
      const rx = b[0] - a[0], ry = b[1] - a[1], l = Math.hypot(rx, ry) || 1;
      return [sg * (a[0] + rx * h + ry / l * off), a[1] + ry * h - rx / l * off, z];
    };
    const topAt = (sf, t, off) => { const { p, z } = rp(sf), a = p[2], b = p[3]; return [lerp(a[0], b[0], t), a[1] + off, z]; };
    const panelDefs = [];
    const addPanel = (name, rows, cols, posFn, o) => {
      const idx = [];
      for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) { const p = posFn(r, c); row.push(addNode(p[0], p[1], p[2], 1)); } idx.push(row); }
      panelDefs.push(Object.assign({ name, rows, cols, idx }, o));
    };
    const pm = d.pm;
    const DOOR_H = [0.3, 0.65, 1.0], FEND_H = [0.2, 0.6, 1.0];
    const corners = (rows, cols, v) => (r, c) => ((r === 0 || r === rows - 1) && (c === 0 || c === cols - 1)) ? v : 0;
    const rim = (rows, cols, v) => (r, c) => (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) ? v : 0;
    for (const sg of [1, -1]) {
      const L = sg > 0 ? 'L' : 'R';
      // side panels span the whole body side (floor edge to beltline) and meet edge to edge, with no gaps between them
      const SH = [0, 0.5, 1.0];
      const span = (name, f0, f1, cols, mass, att, yld, extra) => addPanel(name + L, 3, cols, (r, c) => edgeAt(f0 + (f1 - f0) * c / (cols - 1), 0, 1, SH[r], sg, 0.03), Object.assign({ mass: mass * pm, att, yld }, extra));
      span('quarter', 0, 3.55, 5, 8, (r, c) => (c === 0 || c === 4 ? 0.7 : 0), 0.014);
      span('door', 3.55, 7.5, 5, 16, (r, c) => (c === 4 ? 1.0 : c === 0 ? 0.65 : 0), 0.012, { hinge: (r, c) => c === 4, latch: (r, c) => c === 0 });
      span('fender', 7.5, 11, 4, 8, (r, c) => (c === 0 || c === 3 ? 0.7 : 0), 0.014);
      const spanUp = (name, f0, f1, cols, mass, att) => addPanel(name + L, 2, cols, (r, c) => edgeAt(f0 + (f1 - f0) * c / (cols - 1), 1, 2, r, sg, 0.03), { mass: mass * pm, att, yld: 0.014 });
      spanUp('quarterTop', 0, 3.55, 5, 3, rim(2, 5, 0.6));
      spanUp('fenderTop', 7.5, 11, 4, 3, rim(2, 4, 0.6));
      addPanel('skirt' + L, 2, 6, (r, c) => edgeAt(3 + c, 0, 1, r === 0 ? 0 : 0.22, sg, 0.045), { mass: 3 * pm, att: (r, c) => (c === 0 || c === 5 ? 0.9 : (c === 2 || c === 3) && r === 0 ? 0.7 : 0), yld: 0.02 });
      addPanel('window' + L, 2, 5, (r, c) => edgeAt(3 + c, 1, 2, r, sg, 0.02), { mass: 4 * pm, att: rim(2, 5, 0.5), yld: 0.5, glass: true });
    }
    addPanel('hood', 3, 4, (r, c) => topAt(8 + c, r / 2, 0.03 + ((c === 1 || c === 2) ? 0.04 : 0)), { mass: 13 * pm, att: (r, c) => (c === 0 ? 1.0 : c === 3 ? 0.65 : r !== 1 ? 0.3 : 0), yld: 0.012, hinge: (r, c) => c === 0, latch: (r, c) => c === 3, lift: true });
    if (!d.bed) addPanel('trunk', 3, 3, (r, c) => topAt(c * 1.25, r / 2, 0.03 + (c === 1 ? 0.04 : 0)), { mass: 9 * pm, att: (r, c) => (c === 2 ? 1.0 : c === 0 ? 0.65 : r !== 1 ? 0.3 : 0), yld: 0.012, hinge: (r, c) => c === 2, latch: (r, c) => c === 0, lift: true });
    addPanel('roof', 3, 4, (r, c) => topAt(4 + c, r / 2, 0.03), { mass: 9 * pm, att: corners(3, 4, 0.9), yld: 0.012, col: d.look.roof ? 'accent' : undefined });
    addPanel('windshield', 3, 3, (r, c) => topAt(7 + c * 0.5, r / 2, 0.02), { mass: 9 * pm, att: rim(3, 3, 0.5), yld: 0.5, glass: true });
    const rg0 = d.bed ? 3 : 2.5;
    addPanel('rearGlass', 3, 3, (r, c) => topAt(rg0 + c * (4 - rg0) / 2, r / 2, 0.02), { mass: 7 * pm, att: rim(3, 3, 0.5), yld: 0.5, glass: true });
    const bumper = (end, dir) => (r, c) => {
      const x = (c / 4 * 2 - 1) * (WB[end] * 0.98), u = Math.abs(x) / WB[end];
      const bb = Math.min(YF[end] - 0.07, 0.4);
      return [x, bb + (r === 0 ? 0 : 0.22), Z[end] + dir * (0.07 - 0.2 * u * u)];
    };
    addPanel('bumperR', 2, 5, bumper(0, -1), { mass: 11 * pm, att: (r, c) => (c === 0 || c === 4 ? 0.85 : c === 2 && r === 1 ? 0.6 : 0), yld: 0.02, anchorSt: 2, col: d.look.bumper });
    addPanel('bumperF', 2, 5, bumper(11, 1), { mass: 12 * pm, att: (r, c) => (c === 0 || c === 4 ? 0.85 : c === 2 && r === 1 ? 0.6 : 0), yld: 0.02, anchorSt: 9, col: d.look.bumper });

    const fascia = (end, dir) => (r, c) => {
      const y = lerp(Math.min(YF[end] + 0.12, 0.58), Math.max(YR[end] - 0.07, YF[end] + 0.5), r);
      const t = Math.min(1, Math.max(0, (y - YB[end]) / Math.max(0.05, YR[end] - YB[end])));
      const hw = WB[end] + (WT[end] - WB[end]) * t - 0.01;             // follow the body outline: narrower above the beltline
      return [(c / 4 * 2 - 1) * hw, y, Z[end] + dir * 0.04];
    };
    addPanel('grille', 2, 5, fascia(11, 1), { mass: 4 * pm, att: rim(2, 5, 0.6), yld: 0.02, anchorSt: 10, col: d.look.grille === 'dark' ? 'dark' : undefined });
    addPanel('tailPanel', 2, 5, fascia(0, -1), { mass: 4 * pm, att: rim(2, 5, 0.6), yld: 0.02, anchorSt: 1 });
    addPanel('underbody', 3, 5, (r, c) => { const { p, z } = rp(2 + c * 2), a = p[5], b = p[0]; return [lerp(a[0], b[0], r / 2), lerp(a[1], b[1], r / 2) - 0.04, z]; }, { mass: 6 * pm, att: (r, c) => ((r === 0 || r === 2) && (c === 0 || c === 4 || c === 2)) ? 0.7 : 0, yld: 0.02, col: 'dark' });

    // deformable engine: 4 layers (sump, block base, block top, head) of 4 nodes each, linked by yielding beams
    const ex = 0, ey = (YF[10] + YB[10]) / 2 + 0.05, ez = (Z[9] + Z[10]) / 2;
    const ytop = Math.min(ey + 0.2, YR[10] - 0.1);
    const EYO = [-0.22, -0.1, 0.1, 0.2], EHX = [0.2, 0.32, 0.32, 0.25], EHZ = [0.2, 0.3, 0.3, 0.22], SX = [1, 1, -1, -1], SZ = [1, -1, -1, 1];
    const eng = [];
    for (let L = 0; L < 4; L++) { const row = []; for (let c = 0; c < 4; c++) row.push(addNode(ex + SX[c] * EHX[L], Math.min(ey + EYO[L], ytop), ez + SZ[c] * EHZ[L], 1)); eng.push(row); }
    this.engine = eng;

    const NN = this.NN = NX.length;
    let panelMass = 0;
    for (const p of panelDefs) { p.nodeMass = Math.max(1, p.mass / (p.rows * p.cols)); for (const r of p.idx) for (const i of r) panelMass += p.nodeMass; }
    {   // panels may weigh at most what is left after the frame nodes get a sensible minimum mass
      const room = d.mass - d.mEng - d.mFuel - 4 * d.mWheel - 2.2 * (NR + NSTA), f = Math.min(1, room / panelMass);
      panelMass = 0;
      for (const p of panelDefs) { p.nodeMass *= f; for (const r of p.idx) for (const i of r) { NM[i] = p.nodeMass; panelMass += p.nodeMass; } }
    }
    const ringM = (d.mass - d.mEng - d.mFuel - 4 * d.mWheel - panelMass) / (NR + NSTA);
    for (let i = 0; i < NR; i++) NM[i] = ringM;
    for (let s = 0; s < NSTA; s++) NM[CORE + s] = ringM;
    NM[ENG] = d.mEng * 0.25; NM[FUEL] = d.mFuel;
    for (const row of eng) for (const i of row) NM[i] = d.mEng * 0.75 / 16;
    this.nodeMass = ringM;
    const lx = this.lx = Float64Array.from(NX), ly = this.ly = Float64Array.from(NY), lz = this.lz = Float64Array.from(NZ);
    const m = this.m = Float64Array.from(NM);
    this.px = new Float64Array(NN); this.py = new Float64Array(NN); this.pz = new Float64Array(NN);
    this.vx = new Float64Array(NN); this.vy = new Float64Array(NN); this.vz = new Float64Array(NN);
    this.fx = new Float64Array(NN); this.fy = new Float64Array(NN); this.fz = new Float64Array(NN);

    // static weight distribution (sprung nodes only)
    let sm = 0, szm = 0;
    for (let i = 0; i < NN; i++) { if (i >= HUB && i < HUB + 4) continue; sm += m[i]; szm += m[i] * lz[i]; }
    const frontShare = clamp((szm / sm - d.axR) / (d.axF - d.axR), 0.3, 0.7);

    // ---------------- beams
    const ba = [], bb = [], bk = [], bc = [], by = [], bbr = [], isBody = [], bkind = [];
    const dist = (a, b) => Math.hypot(lx[a] - lx[b], ly[a] - ly[b], lz[a] - lz[b]);
    const add = (a, b, k, c, y, br, body, kind) => { ba.push(a); bb.push(b); bk.push(k); bc.push(c); by.push(y); bbr.push(br); isBody.push(body); bkind.push(kind); return ba.length - 1; };
    const meff = (a, b) => m[a] * m[b] / (m[a] + m[b]);
    const addW = (a, b, w, zeta, y, br, body, kind) => {   // beam sized by natural frequency w (rad/s)
      const me = meff(a, b), k = me * w * w;
      return add(a, b, k, 2 * zeta * Math.sqrt(k * me), y, br, body, kind);
    };
    const addBody = (a, b, kscale, ys) => {                // chassis beam sized by EA/L
      const L = dist(a, b), me = meff(a, b);
      const k = Math.min(d.EA * kscale / Math.max(L, 0.25), me * 450 * 450);
      add(a, b, k, 2 * 0.25 * Math.sqrt(k * me), ys, 0.6, 1, 0);
    };
    for (let s = 0; s < NSTA; s++) {                       // ring cross-bracing
      for (let i = 0; i < RING; i++) for (let j = i + 1; j < RING; j++) {
        const roof = (i === 2 || i === 3 || j === 2 || j === 3) ? 0.8 : 1;
        addBody(st(s, i), st(s, j), 1, YS[s] * roof);
      }
    }
    for (let s = 0; s < NSTA - 1; s++) {                   // between rings: straight + diagonals
      const ys = (YS[s] + YS[s + 1]) / 2;
      for (let i = 0; i < RING; i++) {
        addBody(st(s, i), st(s + 1, i), 1, ys);
        addBody(st(s, i), st(s + 1, (i + 1) % RING), 0.8, ys);
        addBody(st(s, i), st(s + 1, (i + RING - 1) % RING), 0.8, ys);
      }
    }
    for (let s = 0; s < NSTA - 2; s++) {                   // skip-one longitudinal rails
      const ys = (YS[s] + YS[s + 2]) / 2;
      for (let i = 0; i < RING; i++) addBody(st(s, i), st(s + 2, i), 0.6, ys);
    }
    for (let s = 0; s < NSTA; s++) {                       // centre-line spine: triangulates every ring and stiffens the whole frame
      for (let k = 0; k < RING; k++) addBody(CORE + s, st(s, k), 1, YS[s] * (k === 2 || k === 3 ? 0.8 : 1));
      if (s < NSTA - 1) addBody(CORE + s, CORE + s + 1, 1.2, (YS[s] + YS[s + 1]) / 2);
      if (s < NSTA - 2) addBody(CORE + s, CORE + s + 2, 0.6, (YS[s] + YS[s + 2]) / 2);
    }
    // engine and fuel tank on breakable mounts
    for (const s of [9, 10]) for (let i = 0; i < RING; i++) addW(ENG, st(s, i), 90, 0.2, 0.05, 0.5, 0, 5);
    for (const s of [1, 2]) for (let i = 0; i < RING; i++) addW(FUEL, st(s, i), 90, 0.2, 0.05, 0.5, 0, 5);

    // ---------------- suspension: wishbone arms + sprung strut with bump stops
    this.struts = [];
    const sprungM = sm;
    for (const w of this.wheels) {
      const az = w.front ? d.axF : d.axR;
      let s1 = 0; while (s1 < NSTA - 2 && Z[s1 + 1] < az) s1++;
      const s2 = s1 + 1;
      const nearK = w.left ? 0 : 5, farK = w.left ? 5 : 0;
      for (const s of [s1, s2]) {
        w.arms.push(addW(w.i, st(s, nearK), 190, 0.1, 0.12, 0.5, 0, 3));
        w.arms.push(addW(w.i, st(s, farK), 190, 0.1, 0.12, 0.5, 0, 3));
      }
      const topS = w.front ? s1 : s2;
      const top = st(topS, w.left ? 1 : 4);
      const Ls = dist(w.i, top);
      const load = (w.front ? frontShare : 1 - frontShare) * sprungM * G / 2;
      const mc = load / G, f = w.front ? d.rideF : d.rideR;
      const kS = mc * Math.pow(2 * Math.PI * f, 2), sag = load / kS;
      const q = add(w.i, top, 0, 0, 9, 9, 0, 4);
      w.strut = q;
      this.struts.push({ q, a: w.i, b: top, k: kS, cC: 2 * 0.3 * Math.sqrt(kS * mc), cR: 2 * 0.55 * Math.sqrt(kS * mc), L0: Ls + sag, minL: Ls - d.travelUp, maxL: Ls + d.travelDown, kb: 4e5 });
      w.beams = w.arms.concat([q]);
    }

    // ---------------- panel grids + breakable attachments
    this.panels = []; this.bumps = [];
    const nearestRing = (i, n) => {
      const cand = [];
      for (let j = 0; j < NR; j++) { const dj = Math.hypot(lx[i] - lx[j], ly[i] - ly[j], lz[i] - lz[j]); if (dj > 0.1) cand.push([dj, j]); }   // skip coincident nodes (zero-length mounts are unstable)
      cand.sort((a, b) => a[0] - b[0]);
      return cand.slice(0, n).map((c) => c[1]);
    };
    const quads = [];
    const nearestStation = (z) => { let bs = 0, bd = 1e9; for (let s = 0; s < NSTA; s++) { const dd = Math.abs(Z[s] - z); if (dd < bd) { bd = dd; bs = s; } } return bs; };
    const ancOf = (p, i) => CORE + (p.anchorSt !== undefined ? p.anchorSt : nearestStation(lz[i]));
    const ancMass = new Float64Array(NN);        // panel mass hanging off each spine node (limits backing stiffness so light spine nodes stay stable)
    for (const p of panelDefs) for (const r of p.idx) for (const i of r) ancMass[ancOf(p, i)] += m[i];
    for (const p of panelDefs) {
      const tang = [], back = [], nodes = [], grid = [], hingeTang = [], latchTang = [], relTang = [], relBack = [];
      for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
        const i = p.idx[r][c]; nodes.push(i);
        const isHinge = !!(p.hinge && p.hinge(r, c)), isLatch = !!(p.latch && p.latch(r, c));
        // soft backing spring to the centre-line spine: gives every panel node real support normal to the surface
        // (so panels can't sag like cloth), dents plastically, and snaps when the panel is pulled off
        const ac = ancOf(p, i), wb = Math.min(140, 200 * Math.sqrt(m[ac] / ancMass[ac]));
        const qb = addW(i, ac, wb, 1.0, 0.06, 0.15, 0, 2); back.push(qb); if (p.hinge && !isHinge) relBack.push(qb);
        // one-sided stand-off: the part may move away from the body but can never be pushed through it (no collision with other parts, just a floor)
        this.bumps.push({ a: i, b: ac, minL: 0.72 * Math.hypot(lx[i] - lx[ac], ly[i] - ly[ac], lz[i] - lz[ac]) });
        if (p.lift) this.bumps.push({ a: i, b: ENG, minL: 0.8 * Math.hypot(lx[i] - lx[ENG], ly[i] - ly[ENG], lz[i] - lz[ENG]) });
        const strength = p.att(r, c);
        if (strength > 0) {
          for (const j of nearestRing(i, strength >= 0.65 ? 3 : 2)) {
            const qt = addW(i, j, 140 * strength, 0.8, 0.03, 0.06 + 0.12 * strength, 0, 2); tang.push(qt);
            if (isHinge) hingeTang.push(qt); else if (isLatch) latchTang.push(qt); else relTang.push(qt);
          }
        }
        // grid beams to right / below / both diagonals (glass: stiffer, brittle, never yields - it cracks then shatters)
        const wg = p.glass ? 330 : 300, zg = 0.8, gk = p.glass ? 6 : 1, gy = p.yld;
        if (c + 1 < p.cols) grid.push(addW(i, p.idx[r][c + 1], wg, zg, gy, 0.5, 1, gk));
        if (r + 1 < p.rows) grid.push(addW(i, p.idx[r + 1][c], wg, zg, gy, 0.5, 1, gk));
        // bending beams (every second node) make the sheet a stiff plate instead of a cloth
        if (c + 2 < p.cols) grid.push(addW(i, p.idx[r][c + 2], wg * 0.55, zg, gy, 0.5, 1, gk));
        if (r + 2 < p.rows) grid.push(addW(i, p.idx[r + 2][c], wg * 0.55, zg, gy, 0.5, 1, gk));
        if (r + 1 < p.rows && c + 1 < p.cols) {
          grid.push(addW(i, p.idx[r + 1][c + 1], wg * 0.9, zg, gy, 0.5, 1, gk));
          grid.push(addW(p.idx[r][c + 1], p.idx[r + 1][c], wg * 0.9, zg, gy, 0.5, 1, gk));
          quads.push({ q: [i, p.idx[r][c + 1], p.idx[r + 1][c + 1], p.idx[r + 1][c]], col: p.glass ? 'glass' : (p.col || 'paint'), panel: this.panels.length });
        }
      }
      this.panels.push({ name: p.name, nodes, attach: back.concat(tang), tang, back, grid, glass: !!p.glass, rows: p.rows, cols: p.cols, gone: false, lost: false, crack: 0, deb: null, hingeTang, latchTang, relTang, relBack, hinged: !!p.hinge, released: false, lift: !!p.lift,
        buckle: p.lift ? { a: p.idx[1][0], b: p.idx[1][p.cols - 1], mids: p.idx.flatMap((row) => row.slice(1, p.cols - 1)), rest: Math.hypot(lx[p.idx[1][0]] - lx[p.idx[1][p.cols - 1]], ly[p.idx[1][0]] - ly[p.idx[1][p.cols - 1]], lz[p.idx[1][0]] - lz[p.idx[1][p.cols - 1]]) } : null });
    }
    // engine block beams: stiff cast iron that still yields and cracks when the frame is driven into it
    for (let L = 0; L < 4; L++) for (let c = 0; c < 4; c++) {
      addW(eng[L][c], eng[L][(c + 1) % 4], 330, 0.5, 0.012, 0.3, 1, 7);
      if (c < 2) addW(eng[L][c], eng[L][c + 2], 300, 0.5, 0.012, 0.3, 1, 7);
      if (L < 3) { addW(eng[L][c], eng[L + 1][c], 330, 0.5, 0.012, 0.3, 1, 7); addW(eng[L][c], eng[L + 1][(c + 1) % 4], 300, 0.5, 0.012, 0.3, 1, 7); addW(eng[L][c], eng[L + 1][(c + 3) % 4], 300, 0.5, 0.012, 0.3, 1, 7); }
    }
    for (const L of [1, 2]) for (let c = 0; c < 4; c++) {
      addW(ENG, eng[L][c], 250, 0.5, 0.02, 0.4, 0, 7);
      for (const j of nearestRing(eng[L][c], 2)) addW(eng[L][c], j, 150, 0.8, 0.03, 0.35, 0, 7);
    }
    this.faces = chassisFaces(d.bed).concat(quads);

    // numerical safety net: no node may carry more stiffness / damping than the 1500 Hz integrator can handle
    {
      const Sc = new Float64Array(NN), Sk = new Float64Array(NN);
      for (let q = 0; q < ba.length; q++) { Sc[ba[q]] += bc[q]; Sc[bb[q]] += bc[q]; Sk[ba[q]] += bk[q]; Sk[bb[q]] += bk[q]; }
      const dampF = (i) => Math.min(1, 0.8 / (DT * Sc[i] / m[i] + 1e-9)), stiffF = (i) => Math.min(1, Math.pow(0.55 / (DT * Math.sqrt(Sk[i] / m[i]) + 1e-9), 2));
      for (let q = 0; q < ba.length; q++) {
        if (bkind[q] === 4) continue;
        bk[q] *= Math.min(stiffF(ba[q]), stiffF(bb[q])); bc[q] *= Math.min(dampF(ba[q]), dampF(bb[q]));
      }
    }
    for (const bp of this.bumps) { const me = meff(bp.a, bp.b); bp.k = me * 300 * 300; bp.c = 2 * 0.7 * Math.sqrt(bp.k * me); }
    this.NB = ba.length;
    this.ba = Int32Array.from(ba); this.bb = Int32Array.from(bb);
    this.bk = Float64Array.from(bk); this.bc = Float64Array.from(bc);
    this.byield = Float64Array.from(by); this.byield0 = Float64Array.from(by); this.bbreak = Float64Array.from(bbr);
    this.isBody = Uint8Array.from(isBody); this.bkind = Uint8Array.from(bkind);
    this.bL00 = new Float64Array(this.NB); this.bL0 = new Float64Array(this.NB);
    for (let q = 0; q < this.NB; q++) this.bL00[q] = dist(ba[q], bb[q]);
    for (const sv of this.struts) this.bL0[sv.q] = this.bL00[sv.q];
    this.broken = new Uint8Array(this.NB);
    this.strain = new Float32Array(this.NB);

    // ---------------- collision points: ring nodes + hull edge points; panel nodes + face centres
    const cpA = [], cpB = [], cpT = [], cpS = [];
    const kcOf = (i) => Math.min(1, m[i] / 10);
    for (let i = 0; i < NR; i++) { cpA.push(i); cpB.push(i); cpT.push(0); cpS.push(kcOf(i)); }
    const seen = new Set();
    for (const f of this.faces) {
      if (f.panel !== undefined) continue;
      for (let k = 0; k < 4; k++) {
        const a = f.q[k], b = f.q[(k + 1) % 4];
        const key2 = Math.min(a, b) * 1000 + Math.max(a, b);
        if (seen.has(key2)) continue; seen.add(key2);
        cpA.push(a); cpB.push(b); cpT.push(0.5); cpS.push(kcOf(a));
      }
    }
    for (const p of this.panels) for (const i of p.nodes) { cpA.push(i); cpB.push(i); cpT.push(0); cpS.push(kcOf(i)); }
    for (let sI = 0; sI < NSTA; sI++) { cpA.push(CORE + sI); cpB.push(CORE + sI); cpT.push(0); cpS.push(kcOf(CORE + sI)); }   // spine: stops a pole poking into the cabin
    for (const row of eng) for (const i of row) { cpA.push(i); cpB.push(i); cpT.push(0); cpS.push(kcOf(i)); }
    for (const f of quads) { cpA.push(f.q[0]); cpB.push(f.q[2]); cpT.push(0.5); cpS.push(kcOf(f.q[0])); }
    this.cpA = Int32Array.from(cpA); this.cpB = Int32Array.from(cpB); this.cpT = Float64Array.from(cpT); this.cpS = Float64Array.from(cpS);
    this.NC = cpA.length;
    this.cpx = new Float64Array(this.NC); this.cpy = new Float64Array(this.NC); this.cpz = new Float64Array(this.NC);
    this.cvx = new Float64Array(this.NC); this.cvy = new Float64Array(this.NC); this.cvz = new Float64Array(this.NC);

    this.fwd = [0, 0, 1]; this.left = [1, 0, 0]; this.up = [0, 1, 0];
    this.com = [0, 0, 0]; this.vcom = [0, 0, 0];
    this.steerAngle = 0; this.acc = 0; this.plastic = 0; this.time = 0;
    this.gear = 1; this.rpm = 900; this.shiftT = 0; this.reverse = false; this.throttle = 0; this.braking = 0;
    this.airborne = false; this.bodyHit = false; this.groundedCount = 0;
    this.sparks = []; this.breaks = []; this.lostParts = 0; this.lostEvents = [];
    this.dead = new Uint8Array(NN); this.debris = [];
    this.fuel = 1; this.leak = false; this.fire = 0; this.fireT = 0; this.exploded = false; this.explosions = []; this.flooded = 0; this.engHealth = 1; this.inLake = false;
    this.buoy = new Float64Array(NN).fill(1.2);
    for (let k = 0; k < 4; k++) this.buoy[HUB + k] = 0.25;
    this.buoy[ENG] = 0.05; this.buoy[FUEL] = 0.3; for (const row of eng) for (const i of row) this.buoy[i] = 0.05;
    this.engBeams = []; for (let q = 0; q < this.NB; q++) if (this.bkind[q] === 7 && this.isBody[q]) this.engBeams.push(q);
    this.tankMounts = []; for (let q = 0; q < this.NB; q++) if (this.bkind[q] === 5 && this.ba[q] === FUEL) this.tankMounts.push(q);
    this.rx = new Float32Array(NN); this.ry = new Float32Array(NN); this.rz = new Float32Array(NN);
    this.nodeDmg = new Float32Array(NN);
    this.nearObs = [];
    this._n = [0, 1, 0]; this._F = [0, 0, 0]; this._tl = 0;
    this.reset(0, 0, 0);
    this.calibrateSprings();
  }

  // let the car settle on flat ground and trim each spring's free length so the car rests exactly at its design ride height
  calibrateSprings() {
    const idle = { up: 0, down: 0, steer: 0 };
    for (let it = 0; it < 3; it++) {
      this.reset(0, 0, 0);
      for (let i = 0; i < 90; i++) this.advance(1 / 60, idle);
      for (const sv of this.struts) {
        const L = Math.hypot(this.px[sv.a] - this.px[sv.b], this.py[sv.a] - this.py[sv.b], this.pz[sv.a] - this.pz[sv.b]);
        sv.L0 += this.bL00[sv.q] - L;
      }
    }
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw), NN = this.NN;
    let top = -1e9;
    for (const [ox, oz] of [[0, 0], [1.5, 2.5], [-1.5, 2.5], [1.5, -2.5], [-1.5, -2.5]]) {
      top = Math.max(top, terrainHeight(x + ox * c + oz * s, z - ox * s + oz * c));
    }
    const y0 = top + 0.01;
    for (let i = 0; i < NN; i++) {
      this.px[i] = x + this.lx[i] * c + this.lz[i] * s;
      this.pz[i] = z - this.lx[i] * s + this.lz[i] * c;
      this.py[i] = y0 + this.ly[i];
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    this.bL0.set(this.bL00); this.byield.set(this.byield0); this.broken.fill(0); this.strain.fill(0); this.nodeDmg.fill(0);
    for (const sv of this.struts) this.bL0[sv.q] = this.bL00[sv.q];
    for (const p of this.panels) { p.lost = false; p.gone = false; p.crack = 0; p.deb = null; p.released = false; p.popped = false; }
    this.debris.length = 0;
    this.dead.fill(0);
    this.lostParts = 0; this.breaks.length = 0; this.lostEvents.length = 0;
    this.fuel = 1; this.leak = false; this.fire = 0; this.fireT = 0; this.exploded = false; this.explosions.length = 0; this.flooded = 0; this.engHealth = 1;
    this.steerAngle = 0; this.plastic = 0; this.acc = 0; this.gear = 1; this.rpm = 900; this.shiftT = 0;
    for (const w of this.wheels) { w.spin = 0; w.spinVel = 0; w.grounded = false; w.skid = 0; w.alive = true; w.detached = false; w.flat = 0; }
    this.computeFrame();
  }

  // set the car back on its wheels without repairing it: rotate every node upright about the centre of mass
  recover() {
    this.computeFrame();
    const U = this.up, c = this.com;
    let kx = -U[2], ky = 0, kz = U[0], l = Math.hypot(kx, kz);
    let ang;
    if (l < 1e-6) { kx = this.fwd[0]; ky = this.fwd[1]; kz = this.fwd[2]; ang = U[1] < 0 ? Math.PI : 0; }
    else { kx /= l; kz /= l; ang = Math.atan2(l, U[1]); }
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < this.NN; i++) {
      if (this.dead[i]) continue;
      const vx = this.px[i] - c[0], vy = this.py[i] - c[1], vz = this.pz[i] - c[2];
      const dot = kx * vx + ky * vy + kz * vz;
      const cx = ky * vz - kz * vy, cy = kz * vx - kx * vz, cz = kx * vy - ky * vx;
      this.px[i] = c[0] + vx * ca + cx * sa + kx * dot * (1 - ca);
      this.py[i] = c[1] + vy * ca + cy * sa + ky * dot * (1 - ca);
      this.pz[i] = c[2] + vz * ca + cz * sa + kz * dot * (1 - ca);
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    let lift = 0;
    for (let i = 0; i < NR; i++) lift = Math.max(lift, groundH(this.px[i], this.pz[i]) + 0.3 - this.py[i]);
    for (const w of this.wheels) lift = Math.max(lift, groundH(this.px[w.i], this.pz[w.i]) + this.WR + 0.1 - this.py[w.i]);
    for (let i = 0; i < this.NN; i++) if (!this.dead[i]) this.py[i] += lift + 0.2;
    for (const w of this.wheels) if (w.detached) { /* loose wheels stay where they are */ }
    this.computeFrame();
  }

  computeFrame() {
    const { px, py, pz, vx, vy, vz, m } = this;
    let fx = 0, fy = 0, fz = 0, lx = 0, ly = 0, lz = 0;
    for (let k = 0; k < RING; k++) {
      for (let s = 8; s <= 10; s++) { const i = st(s, k); fx += px[i]; fy += py[i]; fz += pz[i]; }
      for (let s = 1; s <= 3; s++) { const i = st(s, k); fx -= px[i]; fy -= py[i]; fz -= pz[i]; }
    }
    for (let s = 3; s <= 8; s++) for (let k = 0; k < 3; k++) {
      const l = st(s, k), r = st(s, 5 - k);
      lx += px[l] - px[r]; ly += py[l] - py[r]; lz += pz[l] - pz[r];
    }
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    const dd = lx * fx + ly * fy + lz * fz; lx -= fx * dd; ly -= fy * dd; lz -= fz * dd;
    l = Math.hypot(lx, ly, lz) || 1; lx /= l; ly /= l; lz /= l;
    this.fwd[0] = fx; this.fwd[1] = fy; this.fwd[2] = fz;
    this.left[0] = lx; this.left[1] = ly; this.left[2] = lz;
    this.up[0] = fy * lz - fz * ly; this.up[1] = fz * lx - fx * lz; this.up[2] = fx * ly - fy * lx;
    let cx = 0, cy = 0, cz = 0, mx = 0, my = 0, mz = 0, mt = 0;
    for (let i = 0; i < this.NN; i++) {
      if (this.dead[i]) continue;
      cx += px[i] * m[i]; cy += py[i] * m[i]; cz += pz[i] * m[i];
      mx += vx[i] * m[i]; my += vy[i] * m[i]; mz += vz[i] * m[i]; mt += m[i];
    }
    this.com[0] = cx / mt; this.com[1] = cy / mt; this.com[2] = cz / mt;
    this.vcom[0] = mx / mt; this.vcom[1] = my / mt; this.vcom[2] = mz / mt;
  }

  get speed() { return Math.hypot(this.vcom[0], this.vcom[1], this.vcom[2]); }
  get forwardSpeed() { return this.vcom[0] * this.fwd[0] + this.vcom[1] * this.fwd[1] + this.vcom[2] * this.fwd[2]; }
  get yaw() { return Math.atan2(this.fwd[0], this.fwd[2]); }
  get damage() { // 0..100
    let s = 0, n = 0;
    for (let q = 0; q < this.NB; q++) {
      if (!this.isBody[q]) continue;
      s += this.broken[q] ? 0.5 : Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q]; n++;
    }
    return Math.min(100, (s / n) * DMG_K);
  }
  get brokenCount() { let c = 0; for (let q = 0; q < this.NB; q++) c += this.broken[q]; return c; }
  get gearLabel() { return this.reverse ? 'R' : (this.speed < 0.5 && !this.throttle ? 'N' : String(this.gear)); }

  // names of parts that have come off (panels with almost nothing left holding them, wheels, engine)
  partsLost() {
    const out = [];
    for (const p of this.panels) if (p.gone) out.push(p.name);
    for (const w of this.wheels) if (!w.alive) out.push('wheel');
    let mounts = 0; for (let q = 0; q < this.NB; q++) if (this.bkind[q] === 5 && this.ba[q] === ENG && !this.broken[q]) mounts++;
    if (mounts <= 2) out.push('engine');
    this.lostParts = out.length;
    return out;
  }

  // a panel that has lost its mounts falls away as a rigid piece of debris; glass cracks as it is strained, then shatters
  checkPanels() {
    for (const p of this.panels) {
      if (p.gone) continue;
      if (p.glass) {
        let mx = 0; for (const q of p.grid) { const a = Math.abs(this.strain[q]); if (a > mx) mx = a; }
        p.crack = Math.max(p.crack, Math.min(1, mx / 0.04));
      }
      let ti = 0, bi = 0;
      for (const q of p.tang) if (!this.broken[q]) ti++;
      for (const q of p.back) if (!this.broken[q]) bi++;
      if (p.glass) { if (p.crack >= 1 || ti <= p.tang.length * 0.2 || bi <= p.back.length * 0.2) this.dropPanel(p); }
      else if (p.hinged) {     // hood / trunk / doors: stay on their hinge when the latch fails, swing open, only fall off when the hinge goes
        let hi = 0, li = 0;
        for (const q of p.hingeTang) if (!this.broken[q]) hi++;
        for (const q of p.latchTang) if (!this.broken[q]) li++;
        if (hi <= p.hingeTang.length * 0.4) this.dropPanel(p);
        else if (!p.released && (li <= p.latchTang.length * 0.45 || p.popped)) {
          p.released = true;
          for (const q of p.relBack) this.broken[q] = 1;
          for (const q of p.relTang) this.broken[q] = 1;
          for (const q of p.latchTang) this.broken[q] = 1;
          const i0 = p.nodes[(p.nodes.length / 2) | 0];
          if (this.breaks.length < 30) this.breaks.push([this.px[i0], this.py[i0], this.pz[i0], 2]);
        }
      } else if ((p.tang.length && ti <= p.tang.length * 0.5) || bi <= p.back.length * 0.34) this.dropPanel(p);
    }
  }
  dropPanel(p) {
    p.gone = true;
    const { px, py, pz, vx, vy, vz, m } = this, nodes = p.nodes, n = nodes.length;
    let M = 0, cx = 0, cy = 0, cz = 0, mx = 0, my = 0, mz = 0;
    for (const i of nodes) { M += m[i]; cx += px[i] * m[i]; cy += py[i] * m[i]; cz += pz[i] * m[i]; mx += vx[i] * m[i]; my += vy[i] * m[i]; mz += vz[i] * m[i]; }
    cx /= M; cy /= M; cz /= M; mx /= M; my /= M; mz /= M;
    const local = new Float32Array(n * 3);
    let Lx = 0, Ly = 0, Lz = 0, Ir = 0;
    nodes.forEach((i, k) => {
      const rx = px[i] - cx, ry = py[i] - cy, rz = pz[i] - cz, ux = vx[i] - mx, uy = vy[i] - my, uz = vz[i] - mz;
      local[k * 3] = rx; local[k * 3 + 1] = ry; local[k * 3 + 2] = rz;
      Lx += m[i] * (ry * uz - rz * uy); Ly += m[i] * (rz * ux - rx * uz); Lz += m[i] * (rx * uy - ry * ux);
      Ir += m[i] * (rx * rx + ry * ry + rz * rz);
    });
    const I = Math.max(0.05, Ir * 0.7);
    if (!p.glass) {
      if (this.debris.length >= 18) { const o = this.debris.shift(); o.panel.deb = null; }
      const deb = { panel: p, pos: [cx, cy, cz], vel: [mx, my, mz], q: [0, 0, 0, 1], w: [Lx / I, Ly / I, Lz / I], local, I, m: M, n, still: 0, sleep: false };
      p.deb = deb; this.debris.push(deb);
    }
    for (const i of nodes) { this.dead[i] = 1; this.vx[i] = this.vy[i] = this.vz[i] = 0; }
    for (let q = 0; q < this.NB; q++) if (this.dead[this.ba[q]] || this.dead[this.bb[q]]) this.broken[q] = 1;
    if (this.lostEvents.length < 12) this.lostEvents.push([cx, cy, cz, p.name, p.glass ? 1 : 0, mx, my, mz]);
  }

  // rigid-body motion of detached panels (point contacts against ground and obstacles)
  stepDebris(near, dt) {
    const F = this._F;
    for (const d of this.debris) {
      if (d.sleep) continue;
      const [qx, qy, qz, qw] = d.q;
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
      const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
      const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
      const mp = d.m / d.n, kk = mp * 20000, cc = 2 * 0.5 * Math.sqrt(kk * mp);
      let Fx = -d.vel[0] * 0.6, Fy = -G * d.m - d.vel[1] * 0.6, Fz = -d.vel[2] * 0.6, Tx = 0, Ty = 0, Tz = 0;
      const [wx, wy, wz] = d.w;
      for (let k = 0; k < d.n; k++) {
        const lx = d.local[k * 3], ly = d.local[k * 3 + 1], lz = d.local[k * 3 + 2];
        const rx = r00 * lx + r01 * ly + r02 * lz, ry = r10 * lx + r11 * ly + r12 * lz, rz = r20 * lx + r21 * ly + r22 * lz;
        const pvx = d.vel[0] + wy * rz - wz * ry, pvy = d.vel[1] + wz * rx - wx * rz, pvz = d.vel[2] + wx * ry - wy * rx;
        if (this.contact(d.pos[0] + rx, d.pos[1] + ry, d.pos[2] + rz, pvx, pvy, pvz, 0.04, mp, 0.45, false, near, kk, cc, d.pos)) {
          Fx += F[0]; Fy += F[1]; Fz += F[2];
          Tx += ry * F[2] - rz * F[1]; Ty += rz * F[0] - rx * F[2]; Tz += rx * F[1] - ry * F[0];
          if (this._tl > 3 && this.sparks.length < 24 && Math.random() < 0.002) this.sparks.push([d.pos[0] + rx, d.pos[1] + ry, d.pos[2] + rz, this._tl]);
        }
      }
      d.vel[0] += Fx / d.m * dt; d.vel[1] += Fy / d.m * dt; d.vel[2] += Fz / d.m * dt;
      const dmp = 1 - 0.8 * dt;
      d.w[0] = (d.w[0] + Tx / d.I * dt) * dmp; d.w[1] = (d.w[1] + Ty / d.I * dt) * dmp; d.w[2] = (d.w[2] + Tz / d.I * dt) * dmp;
      d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt; d.pos[2] += d.vel[2] * dt;
      const hx = d.w[0] * dt * 0.5, hy = d.w[1] * dt * 0.5, hz = d.w[2] * dt * 0.5;
      const nx = qx + hx * qw + hy * qz - hz * qy, ny = qy + hy * qw + hz * qx - hx * qz, nz = qz + hz * qw + hx * qy - hy * qx, nw = qw - hx * qx - hy * qy - hz * qz;
      const l = Math.hypot(nx, ny, nz, nw) || 1; d.q[0] = nx / l; d.q[1] = ny / l; d.q[2] = nz / l; d.q[3] = nw / l;
      if (Math.hypot(d.vel[0], d.vel[1], d.vel[2]) < 0.08 && Math.hypot(d.w[0], d.w[1], d.w[2]) < 0.15) { if ((d.still += dt) > 1.5) d.sleep = true; } else d.still = 0;
      if (!(d.pos[0] === d.pos[0]) || d.pos[1] < -20) { d.sleep = true; d.panel.deb = null; }
    }
  }

  // world positions used for drawing (detached panels follow their rigid body, shattered glass collapses away)
  syncRender() {
    const { px, py, pz, rx, ry, rz } = this;
    for (let i = 0; i < this.NN; i++) { rx[i] = px[i]; ry[i] = py[i]; rz[i] = pz[i]; }
    for (const p of this.panels) {
      if (!p.gone) continue;
      const d = p.deb;
      if (!d) { for (const i of p.nodes) rx[i] = ry[i] = rz[i] = 0; continue; }
      const [qx, qy, qz, qw] = d.q;
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
      const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
      const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
      p.nodes.forEach((i, k) => {
        const lx = d.local[k * 3], ly = d.local[k * 3 + 1], lz = d.local[k * 3 + 2];
        rx[i] = d.pos[0] + r00 * lx + r01 * ly + r02 * lz; ry[i] = d.pos[1] + r10 * lx + r11 * ly + r12 * lz; rz[i] = d.pos[2] + r20 * lx + r21 * ly + r22 * lz;
      });
    }
  }

  // fuel leak, fire and explosion
  updateFire(dt) {
    if (!this.leak) { let b = 0, pl = 0; for (const q of this.tankMounts) { if (this.broken[q]) b++; else pl += Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q]; } if (b >= 1 || pl / this.tankMounts.length > 0.05 || this.engHealth < 0.4) this.leak = true; }
    if (this.leak && this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt * 0.01);
    const wet = this.inLake && this.py[FUEL] < WATER.y;
    if (this.fire === 0 && this.leak && this.fuel > 0.02 && !wet && (this.sparks.length > 0 || this.engHealth < 0.3) && Math.random() < dt * (this.sparks.length > 0 ? 2.5 : 0.4)) this.fire = 0.02;
    if (this.fire > 0) {
      if (wet || this.fuel <= 0) this.fire = Math.max(0, this.fire - dt * 0.4);
      else { this.fire = Math.min(1, this.fire + dt * 0.07); this.fuel = Math.max(0, this.fuel - dt * 0.015 * this.fire); }
      this.fireT = this.fire >= 1 ? this.fireT + dt : Math.max(0, this.fireT - dt);
      if (this.fireT > 6 && this.fuel > 0.25 && !this.exploded) this.explode();
    }
  }
  explode() {
    this.exploded = true; this.fire = 0.6; this.fuel = 0;
    const cx = this.px[FUEL], cy = this.py[FUEL], cz = this.pz[FUEL];
    this.explosions.push([cx, cy, cz]);
    for (let i = 0; i < this.NN; i++) {
      if (this.dead[i]) continue;
      const dx = this.px[i] - cx, dy = this.py[i] - cy, dz = this.pz[i] - cz, d = Math.hypot(dx, dy, dz) + 0.3, f = 16 / (1 + d * 0.6);
      this.vx[i] += dx / d * f; this.vy[i] += dy / d * f + 4; this.vz[i] += dz / d * f;
    }
    for (let q = 0; q < this.NB; q++) {
      const kd = this.bkind[q];
      if ((kd === 2 && Math.random() < 0.5) || ((kd === 1 || kd === 6) && Math.random() < 0.1) || (kd === 5 && Math.random() < 0.6) || (kd === 0 && Math.random() < 0.04)) this.broken[q] = 1;
    }
    for (const p of this.panels) if (!p.gone && Math.random() < (p.glass ? 1 : 0.7)) this.dropPanel(p);
  }

  // per-node dent amount 0..1 (for visual darkening)
  updateNodeDamage() {
    const NN = this.NN, acc = new Float32Array(NN), cnt = new Float32Array(NN);
    for (let q = 0; q < this.NB; q++) {
      if (!this.isBody[q]) continue;
      const v = this.broken[q] ? 0.3 : Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q];
      acc[this.ba[q]] += v; acc[this.bb[q]] += v; cnt[this.ba[q]]++; cnt[this.bb[q]]++;
    }
    for (let i = 0; i < NN; i++) this.nodeDmg[i] = cnt[i] ? Math.min(1, acc[i] / cnt[i] * 9) : 0;
    return this.nodeDmg;
  }

  // frame-level update: steering, gearbox, then fixed sub-steps
  advance(dt, inp) {
    const d = this.def;
    for (const b of OBSTACLES) {   // safety net (only for big solids; thin poles must be wrapped around, not teleported away from)
      if (b.max[0] - b.min[0] < 0.9 || b.max[2] - b.min[2] < 0.9) continue;
      if (this.com[0] > b.min[0] && this.com[0] < b.max[0] && this.com[1] > b.min[1] && this.com[1] < b.max[1] && this.com[2] > b.min[2] && this.com[2] < b.max[2]) {
        const dx0 = this.com[0] - b.min[0], dx1 = b.max[0] - this.com[0], dz0 = this.com[2] - b.min[2], dz1 = b.max[2] - this.com[2];
        const m4 = Math.min(dx0, dx1, dz0, dz1);
        let nx = this.com[0], nz = this.com[2];
        if (m4 === dx0) nx = b.min[0] - 4; else if (m4 === dx1) nx = b.max[0] + 4; else if (m4 === dz0) nz = b.min[2] - 4; else nz = b.max[2] + 4;
        this.reset(nx, nz, this.yaw);
        break;
      }
    }
    const fs = this.forwardSpeed, sp = Math.abs(fs);
    const up = +inp.up || 0, dn = +inp.down || 0;
    this.throttle = up > dn ? up : (this.reverse ? dn : 0);
    const maxSteer = Math.max(0.08, 0.6 / (1 + sp * 0.09));
    const target = clamp(inp.steer, -1, 1) * maxSteer;
    const rate = 1.8 * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);

    // gearbox
    this.reverse = dn > 0.02 && up < 0.02 && fs < 1.5;
    const ratio = this.reverse ? REV : GEARS[this.gear - 1];
    const raw = sp / this.WR * ratio * d.final * 60 / (2 * Math.PI);
    this.shiftT = Math.max(0, this.shiftT - dt);
    if (!this.reverse && this.shiftT <= 0) {
      if (raw > 6300 && this.gear < 5) { this.gear++; this.shiftT = 0.22; }
      else if (raw < 2300 && this.gear > 1) { this.gear--; this.shiftT = 0.12; }
    }
    const target_rpm = Math.max(raw, this.throttle > 0.05 ? 2000 + 3000 * this.throttle * (sp < 8 ? 1 : 0.2) : 900);
    this.rpm += (Math.min(target_rpm, 7200) - this.rpm) * Math.min(1, dt * 12);

    this.braking = 0; this.bodyHit = false; this.sparks.length = 0; this.breaks.length = 0; this.lostEvents.length = 0; this.explosions.length = 0;
    {   // engine condition, lake, flooding
      let pl = 0, br = 0; for (const q of this.engBeams) { if (this.broken[q]) br++; else pl += Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q]; }
      this.engHealth = Math.max(0, Math.min(1, 1 - pl / this.engBeams.length * 6 - br / this.engBeams.length * 2));
      const lx = this.com[0] - WATER.x, lz = this.com[2] - WATER.z;
      this.inLake = lx * lx + lz * lz < (WATER.rw + 8) * (WATER.rw + 8);
      const ex = this.px[ENG] - WATER.x, ez = this.pz[ENG] - WATER.z;
      if (this.inLake && this.py[ENG] < WATER.y && ex * ex + ez * ez < WATER.rw * WATER.rw) this.flooded = 6; else this.flooded = Math.max(0, this.flooded - dt);
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < MAX_STEPS) { this.step(inp); this.acc -= DT; n++; }
    if (this.acc > DT * MAX_STEPS) this.acc = 0;
    this.checkPanels();
    this.updateFire(dt);
    this.airborne = this.groundedCount === 0 && !this.bodyHit;
  }

  // sum of ground + box forces on a point, written to this._F. returns true if touching
  contact(x, y, z, vx, vy, vz, r, mass, mu, noTerrain, obs, k, c, ref) {
    const F = this._F; F[0] = F[1] = F[2] = 0; this._tl = 0;
    k = k || KB; c = c || CB;
    let hit = false;
    const nrm = this._n;
    let pen = noTerrain ? -1 : groundH(x, z) + r - y;
    if (pen > 0) {
      if (pen > 1.2) pen = 1.2;
      groundNormal(x, z, nrm);
      const ny = Math.max(nrm[1], 0.3);
      const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
      const Fn = Math.max(0, k * pen * ny - c * vn);
      F[0] += nrm[0] * Fn; F[1] += nrm[1] * Fn; F[2] += nrm[2] * Fn;
      const tx = vx - nrm[0] * vn, ty = vy - nrm[1] * vn, tz = vz - nrm[2] * vn;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-4) {
        const fr = Math.min(mu * Fn, tl * mass / DT * 0.5);
        F[0] -= tx / tl * fr; F[1] -= ty / tl * fr; F[2] -= tz / tl * fr;
        this._tl = Math.max(this._tl, tl);
      }
      hit = true;
    }
    for (let o = 0; o < obs.length; o++) {
      const b = obs[o];
      if (x < b.min[0] - r || x > b.max[0] + r || y < b.min[1] - r || y > b.max[1] + r || z < b.min[2] - r || z > b.max[2] + r) continue;
      const cx = clamp(x, b.min[0], b.max[0]), cy = clamp(y, b.min[1], b.max[1]), cz = clamp(z, b.min[2], b.max[2]);
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      let p, nx, ny, nz;
      if (d2 > 1e-12) {
        if (d2 >= r * r) continue;
        const dd = Math.sqrt(d2); nx = dx / dd; ny = dy / dd; nz = dz / dd; p = r - dd;
      } else { // inside: push out through the face we entered by
        const ds = [x - b.min[0], b.max[0] - x, y - b.min[1], b.max[1] - y, z - b.min[2], b.max[2] - z];
        // leave through the face on the same side as the car (ref), never out the far side of a thin wall
        let kk = 0, best = 1e9;
        for (let i = 0; i < 6; i++) {
          let sc = ds[i];
          if (ref) { const ax = i >> 1, sgn = (i & 1) ? 1 : -1; if ((ref[ax] - (b.min[ax] + b.max[ax]) * 0.5) * sgn < 0) sc += 3; }
          if (sc < best) { best = sc; kk = i; }
        }
        nx = ny = nz = 0;
        if (kk === 0) nx = -1; else if (kk === 1) nx = 1; else if (kk === 2) ny = -1; else if (kk === 3) ny = 1; else if (kk === 4) nz = -1; else nz = 1;
        p = Math.min(r + ds[kk], 0.3);
      }
      const vn = vx * nx + vy * ny + vz * nz;
      const Fn = Math.max(0, k * p - c * vn);
      F[0] += nx * Fn; F[1] += ny * Fn; F[2] += nz * Fn;
      const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-4) {
        const fr = Math.min(0.4 * Fn, tl * mass / DT * 0.5);
        F[0] -= tx / tl * fr; F[1] -= ty / tl * fr; F[2] -= tz / tl * fr;
        this._tl = Math.max(this._tl, tl);
      }
      hit = true;
    }
    return hit;
  }

  step(inp) {
    const { px, py, pz, vx, vy, vz, fx, fy, fz, m } = this;
    const d = this.def, WR = this.WR, NN = this.NN;
    const dt = DT;
    for (let i = 0; i < NN; i++) {
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      const dr = d.drag * sp * (m[i] / 50);
      fx[i] = -vx[i] * dr; fy[i] = -G * m[i] - vy[i] * dr; fz[i] = -vz[i] * dr;
    }

    if (this.inLake) {      // buoyancy and water drag on every node under the surface
      for (let i = 0; i < NN; i++) {
        if (this.dead[i] || py[i] >= WATER.y) continue;
        const dx = px[i] - WATER.x, dz = pz[i] - WATER.z;
        if (dx * dx + dz * dz > WATER.rw * WATER.rw) continue;
        const sub = Math.min(1, (WATER.y - py[i]) / 0.4), k = m[i] * 4 * sub;
        fy[i] += m[i] * G * this.buoy[i] * sub; fx[i] -= vx[i] * k; fy[i] -= vy[i] * k; fz[i] -= vz[i] * k;
      }
    }

    // beams: spring + damper, plastic yield with strain hardening, snapping
    for (let q = 0; q < this.NB; q++) {
      if (this.broken[q]) continue;
      const a = this.ba[q], b = this.bb[q];
      const dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-6) continue;
      const nx = dx / L, ny = dy / L, nz = dz / L;
      const rel = (vx[a] - vx[b]) * nx + (vy[a] - vy[b]) * ny + (vz[a] - vz[b]) * nz;
      const L0 = this.bL0[q];
      const e = L - L0;
      const F = this.bk[q] * e + this.bc[q] * rel;
      fx[a] -= F * nx; fy[a] -= F * ny; fz[a] -= F * nz;
      fx[b] += F * nx; fy[b] += F * ny; fz[b] += F * nz;
      const st0 = e / L0, y = this.byield[q];
      this.strain[q] = st0;
      if (st0 > y) {
        const dl = (e - y * L0) * 0.5; this.bL0[q] = L0 + dl; this.plastic += dl;
        this.byield[q] = Math.min(this.byield0[q] * 3.5, y + 0.3 * dl / this.bL00[q]);
        if (st0 > this.bbreak[q]) { this.broken[q] = 1; if (this.breaks.length < 30) this.breaks.push([px[a], py[a], pz[a], this.bkind[q]]); }
      } else if (st0 < -y) {
        const dl = (-e - y * L0) * 0.5;
        if (L0 - dl > 0.2 * this.bL00[q]) {
          this.bL0[q] = L0 - dl; this.plastic += dl;
          this.byield[q] = Math.min(this.byield0[q] * 3.5, y + 0.3 * dl / this.bL00[q]);
        }
        // attachments and panel sheet metal torn out when crushed flat
        const kd = this.bkind[q];
        if ((kd === 2 && L < 0.6 * this.bL00[q]) || (kd === 1 && L < 0.22 * this.bL00[q]) || (kd === 3 && L < 0.35 * this.bL00[q])) {
          this.broken[q] = 1; if (this.breaks.length < 30) this.breaks.push([px[a], py[a], pz[a], kd]);
        }
      }
    }

    // stand-off floors: parts can't be driven into the body / engine (one-sided, never a collision between parts)
    for (let k = 0; k < this.bumps.length; k++) {
      const bp = this.bumps[k], a = bp.a, b = bp.b;
      if (this.dead[a] || this.dead[b]) continue;
      const dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L >= bp.minL || L < 1e-6) continue;
      const nx = dx / L, ny = dy / L, nz = dz / L, rel = (vx[a] - vx[b]) * nx + (vy[a] - vy[b]) * ny + (vz[a] - vz[b]) * nz;
      const F = Math.max(0, bp.k * (bp.minL - L) - bp.c * rel);
      fx[a] += F * nx; fy[a] += F * ny; fz[a] += F * nz; fx[b] -= F * nx; fy[b] -= F * ny; fz[b] -= F * nz;
    }
    // a hood or trunk squeezed lengthwise buckles upward (never down into the engine bay) and pops its latch
    for (const p of this.panels) {
      const bk = p.buckle; if (!bk || p.gone) continue;
      const L = Math.hypot(px[bk.a] - px[bk.b], py[bk.a] - py[bk.b], pz[bk.a] - pz[bk.b]), comp = 1 - L / bk.rest;
      if (comp > 0.03) {
        if (comp > 0.1 && !p.released) p.popped = true;
        const f = Math.min(900, 4000 * (comp - 0.03)) / bk.mids.length, u = this.up;
        for (const i of bk.mids) { fx[i] += u[0] * f; fy[i] += u[1] * f; fz[i] += u[2] * f; }
      }
    }
    // air catches an unlatched hood or trunk lid and lifts it
    {
      const v2 = this.vcom[0] * this.vcom[0] + this.vcom[1] * this.vcom[1] + this.vcom[2] * this.vcom[2];
      if (v2 > 25) for (const p of this.panels) if (p.released && p.lift && !p.gone) {
        let pm = 0; for (const i of p.nodes) pm += m[i];
        const f = Math.min(0.25 * v2, 1.2 * pm * G) / p.nodes.length, u = this.up;
        for (const i of p.nodes) { fx[i] += u[0] * f; fy[i] += u[1] * f; fz[i] += u[2] * f; }
      }
      // a hood, boot lid or door hanging on its hinge is damped against the hinge so it swings instead of flailing
      for (const p of this.panels) if (p.released && p.hinged && !p.gone && p.hingeTang.length) {
        let hx = 0, hy = 0, hz = 0;
        const hn0 = p.nodes.length;
        for (const i of p.nodes) { hx += vx[i]; hy += vy[i]; hz += vz[i]; }
        hx /= hn0; hy /= hn0; hz /= hn0;
        for (const i of p.nodes) { const k = m[i] * 6; fx[i] -= k * (vx[i] - hx) * 0.5; fy[i] -= k * (vy[i] - hy) * 0.5; fz[i] -= k * (vz[i] - hz) * 0.5; }
      }
    }
    // suspension struts: progressive spring, bump-stops, different damping in compression and rebound
    for (const sv of this.struts) {
      if (this.broken[sv.q]) continue;
      const a = sv.a, b = sv.b;
      const dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-6) continue;
      const nx = dx / L, ny = dy / L, nz = dz / L;
      const rel = (vx[a] - vx[b]) * nx + (vy[a] - vy[b]) * ny + (vz[a] - vz[b]) * nz;
      let F = sv.k * (L - sv.L0) + (rel > 0 ? sv.cR : sv.cC) * rel;
      if (L < sv.minL) F -= sv.kb * (sv.minL - L);
      else if (L > sv.maxL) F += sv.kb * (L - sv.maxL);
      fx[a] -= F * nx; fy[a] -= F * ny; fz[a] -= F * nz;
      fx[b] += F * nx; fy[b] += F * ny; fz[b] += F * nz;
      if (L > sv.maxL * 1.8) { this.broken[sv.q] = 1; if (this.breaks.length < 30) this.breaks.push([px[a], py[a], pz[a], 4]); }
    }

    this.computeFrame();
    // nearby static obstacles
    const com = this.com, near = this.nearObs; near.length = 0;
    for (let o = 0; o < OBSTACLES.length; o++) {
      const b = OBSTACLES[o];
      if (com[0] > b.min[0] - 8 && com[0] < b.max[0] + 8 && com[2] > b.min[2] - 8 && com[2] < b.max[2] + 8 && com[1] > b.min[1] - 8 && com[1] < b.max[1] + 8) near.push(b);
    }
    this._sl = (this._sl || 0) + 1;
    if ((this._sl & 3) === 0 && near.length) { const spd = this.speed; if (spd > 4) for (const b of near) if (b.kind === 'pole' || b.kind === 'blade') this.slice(b, spd); }
    const fwd = this.fwd, vlongCar = this.forwardSpeed;

    // input -> drive / brake
    const up = +inp.up || 0, dn = +inp.down || 0;
    let thrust = 0, brake = 0;
    if (up > 0.02) { if (vlongCar < -1) brake = up; else thrust = up; }
    if (dn > 0.02) { if (vlongCar > 1) brake = Math.max(brake, dn); else thrust = -dn; }
    if (brake > this.braking) this.braking = brake;
    const ratio = thrust < 0 ? REV : GEARS[this.gear - 1];
    const tq = (this.rpm > 7000 || this.flooded > 0 || this.engHealth < 0.05) ? 0 : d.torque * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(this.rpm, 7500) / 7500)) * (0.25 + 0.75 * this.engHealth);
    const nDriven = d.drive === 'awd' ? 4 : 2;
    const cut = this.shiftT > 0 ? 0.1 : 1;
    const driveF = Math.abs(thrust) * tq * ratio * d.final * 0.9 / WR / nDriven * cut;

    // wheels
    const n = this._n;
    let grounded = 0;
    for (const w of this.wheels) {
      const i = w.i;
      const x = px[i], y = py[i], z = pz[i];
      if (w.detached) {      // wheel that has come off: a free rolling ball, no longer driven or steered
        w.grounded = false; w.skid = 0;
        if (this.contact(x, y, z, vx[i], vy[i], vz[i], WR, m[i], 0.03, false, near, KG, CG, this.com)) {
          fx[i] += this._F[0] - vx[i] * m[i] * 0.25; fy[i] += this._F[1]; fz[i] += this._F[2] - vz[i] * m[i] * 0.25;
        }
        w.spinVel = Math.hypot(vx[i], vz[i]) / WR; w.spin += w.spinVel * dt;
        continue;
      }
      for (let o = 0; o < near.length; o++) {      // sharp things puncture tyres
        const b = near[o]; if (b.kind !== 'blade' && b.kind !== 'pole') continue;
        const ddx = x - clamp(x, b.min[0], b.max[0]), ddy = y - clamp(y, b.min[1], b.max[1]), ddz = z - clamp(z, b.min[2], b.max[2]);
        if (ddx * ddx + ddy * ddy + ddz * ddz < (WR + 0.05) * (WR + 0.05) && this.speed > 4) w.flat = 1;
      }
      const WRe = WR * (1 - 0.22 * w.flat);
      const pen = groundH(x, z) + WRe - y;
      if (pen > 0.26 && w.flat < 1) w.flat = Math.min(1, w.flat + 0.5);     // rim strikes on a violent landing
      w.grounded = false; w.skid = 0;
      if (pen > 0) {
        groundNormal(x, z, n);
        const nx = n[0], ny = n[1], nz = n[2];
        const nyc = Math.max(ny, 0.3);
        const vn = vx[i] * nx + vy[i] * ny + vz[i] * nz;
        const Fn = Math.max(0, KG * pen * nyc - CG * vn);
        w.grounded = true; grounded++;
        const fn = fwd[0] * nx + fwd[1] * ny + fwd[2] * nz;
        let tx = fwd[0] - nx * fn, ty = fwd[1] - ny * fn, tz = fwd[2] - nz * fn;
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        let sx = ny * tz - nz * ty, sy = nz * tx - nx * tz, sz = nx * ty - ny * tx;
        if (w.front) {
          const c = Math.cos(this.steerAngle), s = Math.sin(this.steerAngle);
          const ux = tx * c + sx * s, uy = ty * c + sy * s, uz = tz * c + sz * s;
          tx = ux; ty = uy; tz = uz;
          sx = ny * tz - nz * ty; sy = nz * tx - nx * tz; sz = nx * ty - ny * tx;
        }
        const vlong = vx[i] * tx + vy[i] * ty + vz[i] * tz;
        const vlat = vx[i] * sx + vy[i] * sy + vz[i] * sz;
        w.vlat = vlat;
        const maxF = d.grip * Fn * (1 - 0.45 * w.flat);
        let Fl = 0;
        const rear = !w.front;
        const driven = d.drive === 'awd' || (d.drive === 'fwd' ? w.front : rear);
        if (driven && w.alive && thrust !== 0) {
          Fl = Math.sign(thrust) * driveF;
          if (thrust < 0) Fl *= Math.max(0, 1 - Math.abs(vlong) / 14);
        }
        if (brake) { const lim = d.brake * brake * (w.front ? 1.2 : 0.8); Fl -= clamp(vlong * 5000, -lim, lim); }
        const locked = rear && inp.hand;
        if (locked) Fl = -clamp(vlong * 5000, -maxF, maxF);
        if (!thrust && !brake && !locked) Fl -= clamp(vlong * 300, -300, 300);
        if (w.flat > 0) Fl -= clamp(vlong * 900 * w.flat, -2500, 2500);
        let Ft = -vlat * LAT * (locked ? 0.4 : 1);
        const mag = Math.hypot(Fl, Ft), cap = locked ? maxF * 0.7 : maxF;
        if (mag > cap) { const k = cap / mag; Fl *= k; Ft *= k; }
        // skid only on real slides, wheelspin or locked brakes (not ordinary cornering)
        const slide = Math.abs(vlat);
        if (Fn > 600) {
          if (slide > 4.0) w.skid = Math.min(1, (slide - 4.0) / 5 + 0.3);
          else if (locked && Math.abs(vlong) > 5) w.skid = 0.8;
          else if (driven && thrust > 0.85 && Math.abs(vlong) < 5 && mag > cap * 0.98) w.skid = 0.4;
          else if (brake > 0.9 && Math.abs(vlong) > 12 && mag > cap * 0.98) w.skid = 0.35;
        }
        fx[i] += nx * Fn + tx * Fl + sx * Ft;
        fy[i] += ny * Fn + ty * Fl + sy * Ft;
        fz[i] += nz * Fn + tz * Fl + sz * Ft;
        w.spinVel = locked ? 0 : vlong / WR;
      }
      if (this.contact(x, y, z, vx[i], vy[i], vz[i], WR, m[i], MU_BODY, true, near, 0, 0, this.com)) {
        fx[i] += this._F[0]; fy[i] += this._F[1]; fz[i] += this._F[2];
      }
      w.spin += w.spinVel * dt;
    }
    this.groundedCount = grounded;
    for (const w of this.wheels) {
      let intact = 0; for (const q of w.arms) if (!this.broken[q]) intact++;
      w.alive = intact >= 2 && !w.detached;
      if (!w.alive && !w.detached) {     // last mounts gone: the wheel falls off
        w.detached = true;
        for (const q of w.beams) this.broken[q] = 1;
        if (this.lostEvents.length < 12) this.lostEvents.push([px[w.i], py[w.i], pz[w.i], 'wheel', 0, vx[w.i], vy[w.i], vz[w.i]]);
      }
    }

    // body collision points (ground, boxes). Light panel nodes get softer contacts so they stay stable.
    for (let c = 0; c < this.NC; c++) {
      const a = this.cpA[c], b = this.cpB[c], t = this.cpT[c];
      if (this.dead[a] || this.dead[b]) { this.cpS[c] = this.cpS[c]; continue; }
      const x = px[a] + (px[b] - px[a]) * t, y = py[a] + (py[b] - py[a]) * t, z = pz[a] + (pz[b] - pz[a]) * t;
      const cvx = vx[a] + (vx[b] - vx[a]) * t, cvy = vy[a] + (vy[b] - vy[a]) * t, cvz = vz[a] + (vz[b] - vz[a]) * t;
      this.cpx[c] = x; this.cpy[c] = y; this.cpz[c] = z; this.cvx[c] = cvx; this.cvy[c] = cvy; this.cvz[c] = cvz;
      const ks = this.cpS[c];
      if (!this.contact(x, y, z, cvx, cvy, cvz, ks < 1 ? 0.06 : 0.12, m[a], MU_BODY, false, near, KB * ks, CB * ks, this.com)) continue;
      const F = this._F;
      fx[a] += F[0] * (1 - t); fy[a] += F[1] * (1 - t); fz[a] += F[2] * (1 - t);
      if (t > 0) { fx[b] += F[0] * t; fy[b] += F[1] * t; fz[b] += F[2] * t; }
      this.bodyHit = true;
      if (this._tl > 4 && this.sparks.length < 24 && Math.random() < 0.004) this.sparks.push([x, y, z, this._tl]);
    }

    this.stepDebris(near, dt);
    // balls
    this.stepBalls(near, dt);

    // integrate (semi-implicit Euler)
    let bad = false;
    for (let i = 0; i < NN; i++) {
      if (this.dead[i]) continue;
      vx[i] += fx[i] / m[i] * dt; vy[i] += fy[i] / m[i] * dt; vz[i] += fz[i] / m[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (!(px[i] === px[i]) || !(py[i] === py[i]) || !(pz[i] === pz[i])) bad = true;
    }
    this.time += dt;
    if (bad) this.reset(0, 0, 0);
  }

  // thin sharp obstacles (poles, blades) cut any beam that crosses them: panels at low speed, the frame and suspension when fast
  slice(b, spd) {
    const { px, py, pz } = this, e = 0.02;
    const lo = [b.min[0] - e, b.min[1] - e, b.min[2] - e], hi = [b.max[0] + e, b.max[1] + e, b.max[2] + e];
    for (let q = 0; q < this.NB; q++) {
      if (this.broken[q]) continue;
      const kd = this.bkind[q];
      if (kd === 4 || kd === 7) continue;
      if (spd < (kd === 0 ? 12 : (kd === 3 || kd === 5) ? 8 : 4)) continue;
      const a = this.ba[q], c = this.bb[q];
      const o = [px[a], py[a], pz[a]], d = [px[c] - px[a], py[c] - py[a], pz[c] - pz[a]];
      if (Math.max(o[0], o[0] + d[0]) < lo[0] || Math.min(o[0], o[0] + d[0]) > hi[0] || Math.max(o[1], o[1] + d[1]) < lo[1] || Math.min(o[1], o[1] + d[1]) > hi[1] || Math.max(o[2], o[2] + d[2]) < lo[2] || Math.min(o[2], o[2] + d[2]) > hi[2]) continue;
      let t0 = 0, t1 = 1, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) ok = false; }
        else { let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k]; if (ta > tb) { const t = ta; ta = tb; tb = t; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) ok = false; }
      }
      if (!ok) continue;
      this.broken[q] = 1;
      if (this.breaks.length < 30) this.breaks.push([o[0] + d[0] * (t0 + t1) / 2, o[1] + d[1] * (t0 + t1) / 2, o[2] + d[2] * (t0 + t1) / 2, 9]);
    }
  }

  stepBalls(near, dt) {
    const com = this.com;
    for (const b of BALLS) { b.fx = 0; b.fy = -G * b.m; b.fz = 0; }
    for (let a = 0; a < BALLS.length; a++) {
      const b = BALLS[a];
      // car vs ball
      if (Math.abs(b.x - com[0]) < 6 + b.r && Math.abs(b.z - com[2]) < 6 + b.r && Math.abs(b.y - com[1]) < 6 + b.r) {
        for (let c = 0; c < this.NC; c++) this.ballHit(b, this.cpx[c], this.cpy[c], this.cpz[c], this.cvx[c], this.cvy[c], this.cvz[c], 0.1, this.cpA[c], this.cpB[c], this.cpT[c], this.cpS[c]);
        for (const w of this.wheels) this.ballHit(b, this.px[w.i], this.py[w.i], this.pz[w.i], this.vx[w.i], this.vy[w.i], this.vz[w.i], this.WR, w.i, w.i, 0, 1);
      }
      // ball vs ball
      for (let o = a + 1; o < BALLS.length; o++) {
        const c = BALLS[o];
        const dx = c.x - b.x, dy = c.y - b.y, dz = c.z - b.z, rr = b.r + c.r;
        if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
        const dist = Math.hypot(dx, dy, dz);
        if (dist >= rr || dist < 1e-6) continue;
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const rel = (c.vx - b.vx) * nx + (c.vy - b.vy) * ny + (c.vz - b.vz) * nz;
        const k = Math.min(b.m, c.m) * 5000, cc = Math.min(b.m, c.m) * 40;
        const F = Math.max(0, k * (rr - dist) - cc * rel);
        b.fx -= nx * F; b.fy -= ny * F; b.fz -= nz * F; c.fx += nx * F; c.fy += ny * F; c.fz += nz * F;
      }
    }
    for (const b of BALLS) {
      if (this.contact(b.x, b.y, b.z, b.vx, b.vy, b.vz, b.r, b.m, 0.05, false, OBSTACLES, b.m * 5000, b.m * 50)) {
        b.fx += this._F[0]; b.fy += this._F[1]; b.fz += this._F[2];
      }
      b.fx -= b.vx * b.m * 0.03; b.fz -= b.vz * b.m * 0.03;
      b.vx += b.fx / b.m * dt; b.vy += b.fy / b.m * dt; b.vz += b.fz / b.m * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.rope) {
        const r = b.rope, dx = b.x - r.ax, dy = b.y - r.ay, dz = b.z - r.az, d = Math.hypot(dx, dy, dz);
        if (d > r.len) {
          const nx = dx / d, ny = dy / d, nz = dz / d;
          b.x = r.ax + nx * r.len; b.y = r.ay + ny * r.len; b.z = r.az + nz * r.len;
          const vn = b.vx * nx + b.vy * ny + b.vz * nz;
          if (vn > 0) { b.vx -= nx * vn; b.vy -= ny * vn; b.vz -= nz * vn; }
        }
        continue;
      }
      if (Math.abs(b.x) > WORLD_HALF || Math.abs(b.z) > WORLD_HALF || b.y < -30 || !(b.x === b.x)) {
        b.x = b.home[0]; b.z = b.home[1]; b.y = terrainHeight(b.x, b.z) + b.r; b.vx = b.vy = b.vz = 0;
      }
    }
  }

  ballHit(b, x, y, z, vx, vy, vz, rad, na, nb, t, ks) {
    if (this.dead[na]) return;
    const dx = x - b.x, dy = y - b.y, dz = z - b.z, rr = rad + b.r;
    if (Math.abs(dx) > rr || Math.abs(dy) > rr || Math.abs(dz) > rr) return;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= rr || dist < 1e-6) return;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const rel = (vx - b.vx) * nx + (vy - b.vy) * ny + (vz - b.vz) * nz;
    const F = Math.max(0, (KBALL * (rr - dist) - CBALL * rel) * 0.5 * ks);
    if (F <= 0) return;
    const { fx, fy, fz } = this;
    fx[na] += nx * F * (1 - t); fy[na] += ny * F * (1 - t); fz[na] += nz * F * (1 - t);
    if (t > 0) { fx[nb] += nx * F * t; fy[nb] += ny * F * t; fz[nb] += nz * F * t; }
    b.fx -= nx * F; b.fy -= ny * F; b.fz -= nz * F;
    this.bodyHit = this.bodyHit || rad < 0.2;
  }
}
