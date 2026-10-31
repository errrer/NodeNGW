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

// ---------------------------------------------------------------- world
// ramps rise along +z. p = curve exponent (1 = straight), flat = extra plateau length after the top
export const RAMPS = [
  { x0: -5, x1: 5, z0: 30, z1: 46, h: 3, p: 1, flat: 0 },         // small kicker
  { x0: -9, x1: 9, z0: 70, z1: 94, h: 7.5, p: 1, flat: 0 },       // big jump
  { x0: 30, x1: 50, z0: 55, z1: 80, h: 5, p: 2.2, flat: 0 },      // steep curved kicker
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
export function resetBalls() {
  for (const b of BALLS) { b.x = b.home[0]; b.z = b.home[1]; b.y = terrainHeight(b.x, b.z) + b.r; b.vx = b.vy = b.vz = 0; }
}

// ---------------------------------------------------------------- vehicle topology
// 12 stations (rings) along the car, rear (0) -> front (11); 6 nodes per ring:
//   0 floor-L, 1 belt-L, 2 roof-L, 3 roof-R, 4 belt-R, 5 floor-R   (left = +x)
export const NSTA = 12, RING = 6, NR = NSTA * RING;
export const st = (s, k) => s * RING + k;
export const HUB = NR;                // 72..75: FL FR RL RR
export const ENG = NR + 4;            // 76
export const FUEL = NR + 5;           // 77
export const NCH = NR + 6;            // first panel node

// per-vehicle data. Arrays are per station (rear -> front).
export const VEHICLES = {
  sedan: {
    name: 'Sedan', blurb: 'Balanced rear-wheel drive',
    Z: [-2.25, -2.05, -1.65, -1.25, -0.85, -0.45, -0.05, 0.35, 0.75, 1.2, 1.7, 2.25],
    YF: [0.48, 0.44, 0.42, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.41, 0.43, 0.46],
    YB: [0.72, 0.78, 0.80, 0.82, 0.84, 0.84, 0.84, 0.84, 0.82, 0.80, 0.78, 0.66],
    YR: [0.85, 0.94, 0.98, 1.12, 1.42, 1.46, 1.45, 1.38, 0.98, 0.95, 0.92, 0.80],
    WB: [0.78, 0.84, 0.88, 0.88, 0.88, 0.88, 0.88, 0.88, 0.88, 0.87, 0.84, 0.78],
    WT: [0.68, 0.72, 0.75, 0.70, 0.66, 0.66, 0.66, 0.68, 0.78, 0.78, 0.76, 0.68],
    YS: [0.005, 0.0055, 0.007, 0.012, 0.015, 0.016, 0.015, 0.011, 0.008, 0.006, 0.0055, 0.005],
    WF: 0.72, WX: 1.0, WR: 0.35, axF: 1.45, axR: -1.35,
    EA: 4.0e5, mass: 1150, mEng: 140, mFuel: 45, mWheel: 35, pm: 1,
    rideF: 1.3, rideR: 1.5, travelUp: 0.11, travelDown: 0.13,
    torque: 190, final: 3.9, drive: 'rwd', grip: 1.15, drag: 0.02, brake: 4500, bed: false,
  },
  pickup: {
    name: 'Pickup', blurb: 'Heavy, tall, all-wheel drive',
    Z: [-2.6, -2.4, -1.9, -1.4, -0.95, -0.5, -0.05, 0.4, 0.85, 1.3, 1.85, 2.6],
    YF: [0.65, 0.63, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.63, 0.64, 0.66],
    YB: [1.0, 1.05, 1.08, 1.08, 1.25, 1.25, 1.25, 1.22, 1.18, 1.14, 1.08, 1.0],
    YR: [1.12, 1.15, 1.15, 1.15, 1.95, 2.0, 1.98, 1.9, 1.38, 1.34, 1.3, 1.2],
    WB: [0.92, 0.96, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 0.97, 0.94, 0.9],
    WT: [0.9, 0.92, 0.92, 0.92, 0.82, 0.8, 0.8, 0.82, 0.92, 0.92, 0.9, 0.85],
    YS: [0.006, 0.0065, 0.008, 0.013, 0.016, 0.017, 0.016, 0.012, 0.009, 0.007, 0.0065, 0.006],
    WF: 0.85, WX: 1.1, WR: 0.43, axF: 1.65, axR: -1.6,
    EA: 6.9e5, mass: 2100, mEng: 250, mFuel: 80, mWheel: 55, pm: 1.4,
    rideF: 1.2, rideR: 1.05, travelUp: 0.14, travelDown: 0.18,
    torque: 330, final: 4.2, drive: 'awd', grip: 1.1, drag: 0.03, brake: 6500, bed: true,
  },
  coupe: {
    name: 'Coupe', blurb: 'Light, grippy and fast',
    Z: [-2.0, -1.85, -1.5, -1.1, -0.7, -0.3, 0.1, 0.5, 0.9, 1.3, 1.7, 2.1],
    YF: [0.38, 0.36, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.36, 0.37, 0.38],
    YB: [0.62, 0.66, 0.68, 0.7, 0.72, 0.72, 0.72, 0.7, 0.68, 0.66, 0.62, 0.55],
    YR: [0.8, 0.88, 0.92, 1.1, 1.3, 1.35, 1.32, 1.22, 0.88, 0.84, 0.78, 0.7],
    WB: [0.74, 0.8, 0.82, 0.82, 0.82, 0.82, 0.82, 0.82, 0.82, 0.8, 0.76, 0.72],
    WT: [0.62, 0.68, 0.7, 0.66, 0.62, 0.6, 0.62, 0.66, 0.72, 0.72, 0.68, 0.6],
    YS: [0.0045, 0.005, 0.0065, 0.011, 0.014, 0.015, 0.014, 0.01, 0.0075, 0.0055, 0.005, 0.0045],
    WF: 0.68, WX: 0.96, WR: 0.33, axF: 1.3, axR: -1.2,
    EA: 3.7e5, mass: 1000, mEng: 120, mFuel: 40, mWheel: 30, pm: 0.85,
    rideF: 1.6, rideR: 1.8, travelUp: 0.09, travelDown: 0.11,
    torque: 175, final: 3.5, drive: 'rwd', grip: 1.3, drag: 0.014, brake: 4200, bed: false,
  },
};

// chassis skin faces: 'paint' | 'glass' | 'dark' (floor) | 'primer' (hidden under a panel)
function chassisFaces(bed) {
  const F = [];
  const q = (a, b, c, d, col) => F.push({ q: [a, b, c, d], col });
  for (let s = 0; s < NSTA - 1; s++) {
    for (let g = 0; g < 6; g++) {
      const a = g, b = (g + 1) % 6;
      let col = 'paint';
      if (g === 5) col = 'dark';
      else if (g === 0 || g === 4) col = 'primer';
      else if (g === 1 || g === 3) { if (s >= 3 && s <= 6) col = 'glass'; }
      else if (g === 2) {
        if (s === 2 || s === 3 || s === 7) col = 'glass';
        else if (s <= 1 || s >= 8) col = (bed && s <= 3) ? 'dark' : 'primer';
        if (bed && s <= 3 && s !== 3) col = 'dark';
      }
      q(st(s, a), st(s + 1, a), st(s + 1, b), st(s, b), col);
    }
  }
  q(st(0, 0), st(0, 5), st(0, 4), st(0, 1), 'paint'); q(st(0, 1), st(0, 4), st(0, 3), st(0, 2), 'paint');
  q(st(11, 0), st(11, 5), st(11, 4), st(11, 1), 'paint'); q(st(11, 1), st(11, 4), st(11, 3), st(11, 2), 'paint');
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
      w.spin = 0; w.spinVel = 0; w.grounded = false; w.skid = 0; w.vlat = 0; w.alive = true; w.beams = []; w.arms = [];
    }
    addNode(0, (YF[10] + YB[10]) / 2 + 0.05, (Z[9] + Z[10]) / 2, d.mEng);
    addNode(0, (YF[1] + YB[1]) / 2, (Z[1] + Z[2]) / 2, d.mFuel);

    // ---------------- panels: separate grids of nodes laid over the chassis skin
    const side = (s, h, sg, off) => {     // point on lower side, fraction h up from floor edge to belt line
      const p = ringPts(s), a = p[0], b = p[1];
      const x = a[0] + (b[0] - a[0]) * h, y = a[1] + (b[1] - a[1]) * h;
      const rx = b[0] - a[0], ry = b[1] - a[1], l = Math.hypot(rx, ry) || 1;
      return [sg * (x + ry / l * off), y - rx / l * off, Z[s]];
    };
    const top = (s, t, off) => {          // point on the top line between the two roof/shoulder nodes
      const p = ringPts(s), a = p[2], b = p[3];
      return [a[0] + (b[0] - a[0]) * t, a[1] + off, Z[s]];
    };
    const panelDefs = [];
    const addPanel = (name, rows, cols, posFn, o) => {
      const idx = [];
      for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) { const p = posFn(r, c); row.push(addNode(p[0], p[1], p[2], 1)); } idx.push(row); }
      panelDefs.push(Object.assign({ name, rows, cols, idx }, o));
    };
    const pm = d.pm;
    const DOOR_H = [0.3, 0.65, 1.0], FEND_H = [0.2, 0.6, 1.0];
    for (const sg of [1, -1]) {
      const L = sg > 0 ? 'L' : 'R';
      addPanel('door' + L, 3, 4, (r, c) => side(4 + c, DOOR_H[r], sg, 0.03), { mass: 16 * pm, att: (r, c) => (c === 3 ? 1.0 : c === 0 ? 0.65 : 0), yld: 0.012 });
      addPanel('fender' + L, 3, 3, (r, c) => side(8 + c, FEND_H[r], sg, 0.03), { mass: 5 * pm, att: (r, c) => (c === 0 || c === 2 ? 0.7 : 0), yld: 0.014 });
      addPanel('quarter' + L, 3, 3, (r, c) => side(1 + c, FEND_H[r], sg, 0.03), { mass: 5 * pm, att: (r, c) => (c === 0 || c === 2 ? 0.7 : 0), yld: 0.014 });
      addPanel('skirt' + L, 2, 6, (r, c) => side(3 + c, r === 0 ? 0 : 0.22, sg, 0.045), { mass: 3 * pm, att: (r, c) => (c === 0 || c === 5 ? 0.5 : (c === 2 || c === 3) && r === 0 ? 0.4 : 0), yld: 0.02 });
    }
    addPanel('hood', 3, 4, (r, c) => top(8 + c, r / 2, 0.03), { mass: 13 * pm, att: (r, c) => (c === 0 ? 1.0 : c === 3 ? 0.65 : r !== 1 ? 0.3 : 0), yld: 0.012 });
    if (!d.bed) addPanel('trunk', 3, 3, (r, c) => top(c, r / 2, 0.03), { mass: 9 * pm, att: (r, c) => (c === 2 ? 1.0 : c === 0 ? 0.65 : r !== 1 ? 0.3 : 0), yld: 0.012 });
    const bumper = (end, dir) => (r, c) => {
      const x = (c / 4 * 2 - 1) * (WB[end] * 0.98), u = Math.abs(x) / WB[end];
      return [x, YF[end] + (r === 0 ? 0.03 : 0.22), Z[end] + dir * (0.07 - 0.2 * u * u)];
    };
    addPanel('bumperR', 2, 5, bumper(0, -1), { mass: 11 * pm, att: (r, c) => (c === 0 || c === 4 ? 0.85 : c === 2 && r === 1 ? 0.6 : 0), yld: 0.02 });
    addPanel('bumperF', 2, 5, bumper(11, 1), { mass: 12 * pm, att: (r, c) => (c === 0 || c === 4 ? 0.85 : c === 2 && r === 1 ? 0.6 : 0), yld: 0.02 });

    const NN = this.NN = NX.length;
    let panelMass = 0;
    for (const p of panelDefs) { p.nodeMass = Math.max(2, p.mass / (p.rows * p.cols)); for (const r of p.idx) for (const i of r) { NM[i] = p.nodeMass; panelMass += p.nodeMass; } }
    const ringM = (d.mass - d.mEng - d.mFuel - 4 * d.mWheel - panelMass) / NR;
    for (let i = 0; i < NR; i++) NM[i] = ringM;
    NM[ENG] = d.mEng; NM[FUEL] = d.mFuel;
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
        w.arms.push(addW(w.i, st(s, nearK), 190, 0.1, 0.12, 0.4, 0, 3));
        w.arms.push(addW(w.i, st(s, farK), 190, 0.1, 0.12, 0.4, 0, 3));
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
    this.panels = [];
    const nearestRing = (i, n) => {
      const cand = [];
      for (let j = 0; j < NR; j++) cand.push([Math.hypot(lx[i] - lx[j], ly[i] - ly[j], lz[i] - lz[j]), j]);
      cand.sort((a, b) => a[0] - b[0]);
      return cand.slice(0, n).map((c) => c[1]);
    };
    const quads = [];
    for (const p of panelDefs) {
      const att = [], nodes = [];
      for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
        const i = p.idx[r][c]; nodes.push(i);
        const strength = p.att(r, c);
        if (strength > 0) {
          for (const j of nearestRing(i, strength >= 0.65 ? 3 : 2)) {
            att.push(addW(i, j, 140 * strength, 0.15, 0.03, 0.06 + 0.15 * strength, 0, 2));
          }
        }
        // grid beams to right / below / both diagonals
        if (c + 1 < p.cols) addW(i, p.idx[r][c + 1], 230, 0.12, p.yld, 0.5, 1, 1);
        if (r + 1 < p.rows) addW(i, p.idx[r + 1][c], 230, 0.12, p.yld, 0.5, 1, 1);
        if (r + 1 < p.rows && c + 1 < p.cols) {
          addW(i, p.idx[r + 1][c + 1], 200, 0.12, p.yld, 0.5, 1, 1);
          addW(p.idx[r][c + 1], p.idx[r + 1][c], 200, 0.12, p.yld, 0.5, 1, 1);
          quads.push({ q: [i, p.idx[r][c + 1], p.idx[r + 1][c + 1], p.idx[r + 1][c]], col: 'paint', panel: this.panels.length });
        }
      }
      this.panels.push({ name: p.name, nodes, attach: att, lost: false });
    }
    this.faces = chassisFaces(d.bed).concat(quads);

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
    this.sparks = []; this.breaks = []; this.lostParts = 0;
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
    for (const p of this.panels) p.lost = false;
    this.lostParts = 0; this.breaks.length = 0;
    this.steerAngle = 0; this.plastic = 0; this.acc = 0; this.gear = 1; this.rpm = 900; this.shiftT = 0;
    for (const w of this.wheels) { w.spin = 0; w.spinVel = 0; w.grounded = false; w.skid = 0; w.alive = true; }
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
    for (const p of this.panels) {
      let intact = 0; for (const q of p.attach) if (!this.broken[q]) intact++;
      p.lost = intact <= p.attach.length * 0.25;
      if (p.lost) out.push(p.name);
    }
    for (const w of this.wheels) if (!w.alive) out.push('wheel');
    let mounts = 0; for (let q = 0; q < this.NB; q++) if (this.bkind[q] === 5 && this.ba[q] === ENG && !this.broken[q]) mounts++;
    if (mounts <= 2) out.push('engine');
    this.lostParts = out.length;
    return out;
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
    for (const b of OBSTACLES) {   // safety net: if the centre of mass is ever inside a solid, pop out beside it
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
    const maxSteer = Math.max(0.1, 0.6 / (1 + sp * 0.06));
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

    this.braking = 0; this.bodyHit = false; this.sparks.length = 0; this.breaks.length = 0;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < MAX_STEPS) { this.step(inp); this.acc -= DT; n++; }
    if (this.acc > DT * MAX_STEPS) this.acc = 0;
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
        if ((kd === 2 && L < 0.6 * this.bL00[q]) || (kd === 1 && L < 0.22 * this.bL00[q])) {
          this.broken[q] = 1; if (this.breaks.length < 30) this.breaks.push([px[a], py[a], pz[a], kd]);
        }
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
    const fwd = this.fwd, vlongCar = this.forwardSpeed;

    // input -> drive / brake
    const up = +inp.up || 0, dn = +inp.down || 0;
    let thrust = 0, brake = 0;
    if (up > 0.02) { if (vlongCar < -1) brake = up; else thrust = up; }
    if (dn > 0.02) { if (vlongCar > 1) brake = Math.max(brake, dn); else thrust = -dn; }
    if (brake > this.braking) this.braking = brake;
    const ratio = thrust < 0 ? REV : GEARS[this.gear - 1];
    const tq = this.rpm > 7000 ? 0 : d.torque * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(this.rpm, 7500) / 7500));
    const nDriven = d.drive === 'awd' ? 4 : 2;
    const cut = this.shiftT > 0 ? 0.1 : 1;
    const driveF = Math.abs(thrust) * tq * ratio * d.final * 0.9 / WR / nDriven * cut;

    // wheels
    const n = this._n;
    let grounded = 0;
    for (const w of this.wheels) {
      const i = w.i;
      const x = px[i], y = py[i], z = pz[i];
      const pen = groundH(x, z) + WR - y;
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
        const maxF = d.grip * Fn;
        let Fl = 0;
        const rear = !w.front;
        const driven = d.drive === 'awd' || rear;
        if (driven && w.alive && thrust !== 0) {
          Fl = Math.sign(thrust) * driveF;
          if (thrust < 0) Fl *= Math.max(0, 1 - Math.abs(vlong) / 14);
        }
        if (brake) { const lim = d.brake * brake * (w.front ? 1.2 : 0.8); Fl -= clamp(vlong * 5000, -lim, lim); }
        const locked = rear && inp.hand;
        if (locked) Fl = -clamp(vlong * 5000, -maxF, maxF);
        if (!thrust && !brake && !locked) Fl -= clamp(vlong * 300, -300, 300);
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
    for (const w of this.wheels) { let intact = 0; for (const q of w.arms) if (!this.broken[q]) intact++; w.alive = intact >= 2; }

    // body collision points (ground, boxes). Light panel nodes get softer contacts so they stay stable.
    for (let c = 0; c < this.NC; c++) {
      const a = this.cpA[c], b = this.cpB[c], t = this.cpT[c];
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

    // balls
    this.stepBalls(near, dt);

    // integrate (semi-implicit Euler)
    let bad = false;
    for (let i = 0; i < NN; i++) {
      vx[i] += fx[i] / m[i] * dt; vy[i] += fy[i] / m[i] * dt; vz[i] += fz[i] / m[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (!(px[i] === px[i]) || !(py[i] === py[i]) || !(pz[i] === pz[i])) bad = true;
    }
    this.time += dt;
    if (bad) this.reset(0, 0, 0);
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
      if (Math.abs(b.x) > WORLD_HALF || Math.abs(b.z) > WORLD_HALF || b.y < -30 || !(b.x === b.x)) {
        b.x = b.home[0]; b.z = b.home[1]; b.y = terrainHeight(b.x, b.z) + b.r; b.vx = b.vy = b.vz = 0;
      }
    }
  }

  ballHit(b, x, y, z, vx, vy, vz, rad, na, nb, t, ks) {
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
