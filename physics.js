// physics.js - soft-body (node & beam) vehicle physics. No dependencies, runs in browser or Node.
// A vehicle is a lattice of mass points (nodes) joined by springs (beams). Beams squashed or stretched
// past their yield strain permanently change length (dents); beams stretched too far snap.
// Wheels are single nodes with a tyre friction model, driven through an automatic gearbox.

export const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const WORLD_HALF = 195;

// ---------------------------------------------------------------- world
// ramps rise along +z. p = curve exponent (1 = straight), flat = extra plateau length after the top
export const RAMPS = [
  { x0: -5, x1: 5, z0: 30, z1: 46, h: 3, p: 1, flat: 0 },        // small kicker
  { x0: -9, x1: 9, z0: 70, z1: 94, h: 7.5, p: 1, flat: 0 },      // big jump
  { x0: 30, x1: 50, z0: 55, z1: 80, h: 5, p: 2.2, flat: 0 },     // steep curved kicker
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

// ---------------------------------------------------------------- vehicles
// ZS rear->front node z, XS half width, YS floor/top y, CZ cabin z, CX cabin half width, CY roof y
export const VEHICLES = {
  sedan: {
    name: 'Sedan', blurb: 'Balanced rear-wheel drive',
    ZS: [-2.0, -1.0, 0.9, 2.0], XS: 0.9, YS: [0.6, 1.1], CZ: [-0.4, 0.4], CX: 0.75, CY: 1.65,
    WX: 1.05, WZ: 1.35, WR: 0.35, mb: 55, mw: 50, ks: 45000, cs: 1500,
    torque: 190, final: 3.9, drive: 'rwd', grip: 1.15, drag: 0.02, brake: 4500, bed: false,
  },
  pickup: {
    name: 'Pickup', blurb: 'Heavy, tall, all-wheel drive',
    ZS: [-2.4, -1.2, 1.0, 2.5], XS: 1.0, YS: [0.78, 1.38], CZ: [0.0, 0.9], CX: 0.85, CY: 2.05,
    WX: 1.15, WZ: 1.65, WR: 0.43, mb: 80, mw: 70, ks: 80000, cs: 2600,
    torque: 330, final: 4.2, drive: 'awd', grip: 1.1, drag: 0.03, brake: 6500, bed: true,
  },
  coupe: {
    name: 'Coupe', blurb: 'Light, grippy and fast',
    ZS: [-1.9, -0.9, 0.8, 1.9], XS: 0.88, YS: [0.5, 0.9], CZ: [-0.3, 0.4], CX: 0.7, CY: 1.38,
    WX: 1.02, WZ: 1.25, WR: 0.33, mb: 40, mw: 40, ks: 55000, cs: 1500,
    torque: 175, final: 3.5, drive: 'rwd', grip: 1.3, drag: 0.014, brake: 4200, bed: false,
  },
};

const ni = (zi, xi, yi) => zi * 4 + xi * 2 + yi;
const ci = (zc, xi) => 16 + zc * 2 + xi;
const NBODY = 20, NN = 24;

// faces: 'paint' | 'glass' | 'dark'
function buildFaces(bed) {
  const F = [];
  const quad = (a, b, c, d, col) => F.push({ q: [a, b, c, d], col });
  quad(ni(0, 0, 0), ni(0, 1, 0), ni(0, 1, 1), ni(0, 0, 1), 'paint');
  quad(ni(3, 0, 0), ni(3, 1, 0), ni(3, 1, 1), ni(3, 0, 1), 'paint');
  for (let i = 0; i < 3; i++) {
    quad(ni(i, 0, 0), ni(i, 1, 0), ni(i + 1, 1, 0), ni(i + 1, 0, 0), 'dark');
    quad(ni(i, 0, 0), ni(i + 1, 0, 0), ni(i + 1, 0, 1), ni(i, 0, 1), 'paint');
    quad(ni(i, 1, 0), ni(i + 1, 1, 0), ni(i + 1, 1, 1), ni(i, 1, 1), 'paint');
  }
  quad(ni(0, 0, 1), ni(0, 1, 1), ni(1, 1, 1), ni(1, 0, 1), bed ? 'dark' : 'paint');
  quad(ni(2, 0, 1), ni(2, 1, 1), ni(3, 1, 1), ni(3, 0, 1), 'paint');
  quad(ni(1, 0, 1), ni(1, 1, 1), ci(0, 1), ci(0, 0), 'glass');
  quad(ci(1, 0), ci(1, 1), ni(2, 1, 1), ni(2, 0, 1), 'glass');
  quad(ci(0, 0), ci(0, 1), ci(1, 1), ci(1, 0), 'paint');
  for (let xi = 0; xi < 2; xi++) quad(ni(1, xi, 1), ci(0, xi), ci(1, xi), ni(2, xi, 1), 'glass');
  return F;
}
export const FACES = buildFaces(false);
export const FACES_BED = buildFaces(true);

// ---------------------------------------------------------------- tuning
const DT = 1 / 600;
const KB = 400000, CB = 3500;     // contact stiffness / damping for body points
const KG = 180000, CG = 2500;     // wheel-ground
const MU_BODY = 0.7;
const LAT = 4500;
const GEARS = [3.6, 2.2, 1.5, 1.1, 0.85], REV = 3.3;
const KBALL = 120000, CBALL = 1200;

export class Car {
  constructor(key = 'sedan') {
    const d = this.def = VEHICLES[key] || VEHICLES.sedan;
    this.key = key in VEHICLES ? key : 'sedan';
    this.faces = d.bed ? FACES_BED : FACES;
    this.WR = d.WR;
    this.NN = NN;
    const ZS = d.ZS, XS = [d.XS, -d.XS], YS = d.YS, CZ = d.CZ, CX = [d.CX, -d.CX], CY = d.CY;
    const lx = new Float64Array(NN), ly = new Float64Array(NN), lz = new Float64Array(NN);
    for (let zi = 0; zi < 4; zi++) for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) {
      const i = ni(zi, xi, yi); lx[i] = XS[xi]; ly[i] = YS[yi]; lz[i] = ZS[zi];
    }
    for (let zc = 0; zc < 2; zc++) for (let xi = 0; xi < 2; xi++) {
      const i = ci(zc, xi); lx[i] = CX[xi]; ly[i] = CY; lz[i] = CZ[zc];
    }
    // wheels: 20 FL, 21 FR, 22 RL, 23 RR
    this.wheels = [
      { i: 20, front: true, left: true }, { i: 21, front: true, left: false },
      { i: 22, front: false, left: true }, { i: 23, front: false, left: false },
    ];
    this.wheels.forEach((w) => {
      const i = w.i;
      lx[i] = w.left ? d.WX : -d.WX; ly[i] = d.WR; lz[i] = w.front ? d.WZ : -d.WZ;
      w.spin = 0; w.spinVel = 0; w.grounded = false; w.skid = 0; w.vlat = 0; w.alive = true; w.beams = [];
    });
    this.lx = lx; this.ly = ly; this.lz = lz;

    this.px = new Float64Array(NN); this.py = new Float64Array(NN); this.pz = new Float64Array(NN);
    this.vx = new Float64Array(NN); this.vy = new Float64Array(NN); this.vz = new Float64Array(NN);
    this.fx = new Float64Array(NN); this.fy = new Float64Array(NN); this.fz = new Float64Array(NN);
    this.m = new Float64Array(NN);
    for (let i = 0; i < NBODY; i++) this.m[i] = d.mb;
    for (const w of this.wheels) this.m[w.i] = d.mw;

    const kBody = d.mb * 1800, cBody = d.mb * 14;
    const thr = 0.8 * (ZS[3] - ZS[0]);
    const ba = [], bb = [], bk = [], bc = [], by = [], bbr = [], isBody = [];
    const add = (a, b, k, c, y, br, body) => { ba.push(a); bb.push(b); bk.push(k); bc.push(c); by.push(y); bbr.push(br); isBody.push(body); };
    for (let i = 0; i < NBODY; i++) for (let j = i + 1; j < NBODY; j++) {
      const dd = Math.hypot(lx[i] - lx[j], ly[i] - ly[j], lz[i] - lz[j]);
      if (dd < thr) add(i, j, kBody, cBody, (i >= 16 || j >= 16) ? 0.005 : 0.007, 0.25, 1);
    }
    for (const w of this.wheels) {
      const xi = w.left ? 0 : 1;
      const zis = w.front ? [2, 3] : [0, 1];
      for (const zi of zis) for (let yi = 0; yi < 2; yi++) {
        w.beams.push(ba.length); add(w.i, ni(zi, xi, yi), d.ks, d.cs, 0.2, 0.5, 0);
        w.beams.push(ba.length); add(w.i, ni(zi, 1 - xi, yi), d.ks, d.cs, 0.2, 0.5, 0);
      }
    }
    this.NB = ba.length;
    this.ba = Int32Array.from(ba); this.bb = Int32Array.from(bb);
    this.bk = Float64Array.from(bk); this.bc = Float64Array.from(bc);
    this.byield = Float64Array.from(by); this.bbreak = Float64Array.from(bbr);
    this.isBody = Uint8Array.from(isBody);
    this.bL00 = new Float64Array(this.NB); this.bL0 = new Float64Array(this.NB);
    for (let q = 0; q < this.NB; q++) {
      const a = ba[q], b = bb[q];
      this.bL00[q] = Math.hypot(lx[a] - lx[b], ly[a] - ly[b], lz[a] - lz[b]);
    }
    this.broken = new Uint8Array(this.NB);
    this.strain = new Float32Array(this.NB);

    // collision points: every body node plus the midpoint of every hull edge
    const cpA = [], cpB = [], cpT = [];
    for (let i = 0; i < NBODY; i++) { cpA.push(i); cpB.push(i); cpT.push(0); }
    const seen = new Set();
    for (const f of this.faces) for (let k = 0; k < 4; k++) {
      const a = f.q[k], b = f.q[(k + 1) % 4];
      const key2 = Math.min(a, b) * 100 + Math.max(a, b);
      if (seen.has(key2)) continue; seen.add(key2);
      for (const t of [0.25, 0.5, 0.75]) { cpA.push(a); cpB.push(b); cpT.push(t); }
    }
    this.cpA = Int32Array.from(cpA); this.cpB = Int32Array.from(cpB); this.cpT = Float64Array.from(cpT);
    this.NC = cpA.length;
    this.cpx = new Float64Array(this.NC); this.cpy = new Float64Array(this.NC); this.cpz = new Float64Array(this.NC);
    this.cvx = new Float64Array(this.NC); this.cvy = new Float64Array(this.NC); this.cvz = new Float64Array(this.NC);

    this.fwd = [0, 0, 1]; this.left = [1, 0, 0]; this.up = [0, 1, 0];
    this.com = [0, 0, 0]; this.vcom = [0, 0, 0];
    this.steerAngle = 0; this.acc = 0; this.plastic = 0; this.time = 0;
    this.gear = 1; this.rpm = 900; this.shiftT = 0; this.reverse = false; this.throttle = 0; this.braking = 0;
    this.airborne = false; this.bodyHit = false; this.groundedCount = 0;
    this.sparks = [];
    this.nodeDmg = new Float32Array(NN);
    this.nearObs = [];
    this._n = [0, 1, 0]; this._F = [0, 0, 0]; this._tl = 0;
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let top = -1e9;
    for (const [ox, oz] of [[0, 0], [1.5, 2.5], [-1.5, 2.5], [1.5, -2.5], [-1.5, -2.5]]) {
      top = Math.max(top, terrainHeight(x + ox * c + oz * s, z - ox * s + oz * c));
    }
    const y0 = top + 0.05;
    for (let i = 0; i < NN; i++) {
      this.px[i] = x + this.lx[i] * c + this.lz[i] * s;
      this.pz[i] = z - this.lx[i] * s + this.lz[i] * c;
      this.py[i] = y0 + this.ly[i];
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    this.bL0.set(this.bL00); this.broken.fill(0); this.strain.fill(0); this.nodeDmg.fill(0);
    this.steerAngle = 0; this.plastic = 0; this.acc = 0; this.gear = 1; this.rpm = 900; this.shiftT = 0;
    for (const w of this.wheels) { w.spin = 0; w.spinVel = 0; w.grounded = false; w.skid = 0; w.alive = true; }
    this.computeFrame();
  }

  computeFrame() {
    const { px, py, pz, vx, vy, vz, m } = this;
    let fx = 0, fy = 0, fz = 0, lx = 0, ly = 0, lz = 0;
    for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) {
      const f = ni(3, xi, yi), r = ni(0, xi, yi);
      fx += px[f] - px[r]; fy += py[f] - py[r]; fz += pz[f] - pz[r];
    }
    for (let zi = 0; zi < 4; zi++) for (let yi = 0; yi < 2; yi++) {
      const l = ni(zi, 0, yi), r = ni(zi, 1, yi);
      lx += px[l] - px[r]; ly += py[l] - py[r]; lz += pz[l] - pz[r];
    }
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    const dd = lx * fx + ly * fy + lz * fz; lx -= fx * dd; ly -= fy * dd; lz -= fz * dd;
    l = Math.hypot(lx, ly, lz) || 1; lx /= l; ly /= l; lz /= l;
    this.fwd[0] = fx; this.fwd[1] = fy; this.fwd[2] = fz;
    this.left[0] = lx; this.left[1] = ly; this.left[2] = lz;
    this.up[0] = fy * lz - fz * ly; this.up[1] = fz * lx - fx * lz; this.up[2] = fx * ly - fy * lx;
    let cx = 0, cy = 0, cz = 0, mx = 0, my = 0, mz = 0, mt = 0;
    for (let i = 0; i < NN; i++) {
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
      s += this.broken[q] ? 1 : Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q]; n++;
    }
    return Math.min(100, (s / n) * 450);
  }
  get brokenCount() { let c = 0; for (let q = 0; q < this.NB; q++) c += this.broken[q]; return c; }
  get gearLabel() { return this.reverse ? 'R' : (this.speed < 0.5 && !this.throttle ? 'N' : String(this.gear)); }

  // per-node dent amount 0..1 (for visual darkening)
  updateNodeDamage() {
    const acc = new Float32Array(NN), cnt = new Float32Array(NN);
    for (let q = 0; q < this.NB; q++) {
      if (!this.isBody[q]) continue;
      const v = this.broken[q] ? 0.1 : Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q];
      acc[this.ba[q]] += v; acc[this.bb[q]] += v; cnt[this.ba[q]]++; cnt[this.bb[q]]++;
    }
    for (let i = 0; i < NN; i++) this.nodeDmg[i] = cnt[i] ? Math.min(1, acc[i] / cnt[i] * 22) : 0;
    return this.nodeDmg;
  }

  // frame-level update: steering, gearbox, then fixed sub-steps
  advance(dt, inp) {
    const d = this.def;
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

    for (const b of OBSTACLES) {
      if (this.com[0] > b.min[0] && this.com[0] < b.max[0] && this.com[1] > b.min[1] && this.com[1] < b.max[1] && this.com[2] > b.min[2] && this.com[2] < b.max[2]) {
        const dx0 = this.com[0] - b.min[0], dx1 = b.max[0] - this.com[0], dz0 = this.com[2] - b.min[2], dz1 = b.max[2] - this.com[2];
        const m4 = Math.min(dx0, dx1, dz0, dz1);
        let nx = this.com[0], nz = this.com[2];
        if (m4 === dx0) nx = b.min[0] - 4; else if (m4 === dx1) nx = b.max[0] + 4; else if (m4 === dz0) nz = b.min[2] - 4; else nz = b.max[2] + 4;
        this.reset(nx, nz, this.yaw);
        break;
      }
    }
    this.braking = 0; this.bodyHit = false; this.sparks.length = 0;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 40) { this.step(inp); this.acc -= DT; n++; }
    if (this.acc > DT * 40) this.acc = 0;
    this.airborne = this.groundedCount === 0 && !this.bodyHit;
  }

  // sum of ground + box forces on a point, written to this._F. returns true if touching
  contact(x, y, z, vx, vy, vz, r, mass, mu, noTerrain, obs, k, c) {
    const F = this._F; F[0] = F[1] = F[2] = 0; this._tl = 0;
    k = k || KB; c = c || CB;
    let hit = false;
    const nrm = this._n;
    let pen = noTerrain ? -1 : terrainHeight(x, z) + r - y;
    if (pen > 0) {
      if (pen > 1.2) pen = 1.2;
      terrainNormal(x, z, nrm);
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
      } else { // inside: push out through nearest face
        const ds = [x - b.min[0], b.max[0] - x, y - b.min[1], b.max[1] - y, z - b.min[2], b.max[2] - z];
        // prefer leaving through the face we entered by: penalise faces whose outward normal points along our velocity
        const sc = [ds[0] + (vx < -1 ? 4 : 0), ds[1] + (vx > 1 ? 4 : 0), ds[2] + (vy < -1 ? 4 : 0), ds[3] + (vy > 1 ? 4 : 0), ds[4] + (vz < -1 ? 4 : 0), ds[5] + (vz > 1 ? 4 : 0)];
        let kk = 0; for (let i = 1; i < 6; i++) if (sc[i] < sc[kk]) kk = i;
        nx = ny = nz = 0;
        if (kk === 0) nx = -1; else if (kk === 1) nx = 1; else if (kk === 2) ny = -1; else if (kk === 3) ny = 1; else if (kk === 4) nz = -1; else nz = 1;
        p = Math.min(r + ds[kk], 0.6);
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
    const d = this.def, WR = this.WR;
    const dt = DT;
    for (let i = 0; i < NN; i++) {
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      const dr = d.drag * sp;
      fx[i] = -vx[i] * dr; fy[i] = -G * m[i] - vy[i] * dr; fz[i] = -vz[i] * dr;
    }

    // beams
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
      const st = e / L0, y = this.byield[q];
      this.strain[q] = st;
      if (st > y) {
        const dl = (e - y * L0) * 0.5; this.bL0[q] = L0 + dl; this.plastic += dl;
        if (st > this.bbreak[q]) this.broken[q] = 1;
      } else if (st < -y) {
        const dl = (-e - y * L0) * 0.5;
        if (L0 - dl > 0.3 * this.bL00[q]) { this.bL0[q] = L0 - dl; this.plastic += dl; }
      }
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
      const pen = terrainHeight(x, z) + WR - y;
      w.grounded = false; w.skid = 0;
      if (pen > 0) {
        terrainNormal(x, z, n);
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
        if (mag > cap) { const k = cap / mag; Fl *= k; Ft *= k; if (Fn > 600) w.skid = Math.min(1, (mag - cap) / cap + 0.5); }
        fx[i] += nx * Fn + tx * Fl + sx * Ft;
        fy[i] += ny * Fn + ty * Fl + sy * Ft;
        fz[i] += nz * Fn + tz * Fl + sz * Ft;
        w.spinVel = locked ? 0 : vlong / WR;
      }
      if (this.contact(x, y, z, vx[i], vy[i], vz[i], WR, m[i], MU_BODY, true, near)) {
        fx[i] += this._F[0]; fy[i] += this._F[1]; fz[i] += this._F[2];
        if (w.skid === 0 && this._tl > 3) w.skid = 0.3;
      }
      w.spin += w.spinVel * dt;
    }
    this.groundedCount = grounded;
    for (const w of this.wheels) { let alive = false; for (const q of w.beams) if (!this.broken[q]) { alive = true; break; } w.alive = alive; }

    // body collision points (ground, boxes)
    for (let c = 0; c < this.NC; c++) {
      const a = this.cpA[c], b = this.cpB[c], t = this.cpT[c];
      const x = px[a] + (px[b] - px[a]) * t, y = py[a] + (py[b] - py[a]) * t, z = pz[a] + (pz[b] - pz[a]) * t;
      const cvx = vx[a] + (vx[b] - vx[a]) * t, cvy = vy[a] + (vy[b] - vy[a]) * t, cvz = vz[a] + (vz[b] - vz[a]) * t;
      this.cpx[c] = x; this.cpy[c] = y; this.cpz[c] = z; this.cvx[c] = cvx; this.cvy[c] = cvy; this.cvz[c] = cvz;
      if (!this.contact(x, y, z, cvx, cvy, cvz, 0.16, d.mb, MU_BODY, false, near)) continue;
      const F = this._F;
      fx[a] += F[0] * (1 - t); fy[a] += F[1] * (1 - t); fz[a] += F[2] * (1 - t);
      if (t > 0) { fx[b] += F[0] * t; fy[b] += F[1] * t; fz[b] += F[2] * t; }
      this.bodyHit = true;
      if (this._tl > 4 && this.sparks.length < 24 && Math.random() < 0.03) this.sparks.push([x, y, z, this._tl]);
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
    const { fx, fy, fz } = this;
    const com = this.com;
    for (const b of BALLS) { b.fx = 0; b.fy = -G * b.m; b.fz = 0; }
    for (let a = 0; a < BALLS.length; a++) {
      const b = BALLS[a];
      // car vs ball
      if (Math.abs(b.x - com[0]) < 6 + b.r && Math.abs(b.z - com[2]) < 6 + b.r && Math.abs(b.y - com[1]) < 6 + b.r) {
        for (let c = 0; c < this.NC; c++) this.ballHit(b, this.cpx[c], this.cpy[c], this.cpz[c], this.cvx[c], this.cvy[c], this.cvz[c], 0.16, this.cpA[c], this.cpB[c], this.cpT[c]);
        for (const w of this.wheels) this.ballHit(b, this.px[w.i], this.py[w.i], this.pz[w.i], this.vx[w.i], this.vy[w.i], this.vz[w.i], this.WR, w.i, w.i, 0);
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

  ballHit(b, x, y, z, vx, vy, vz, rad, na, nb, t) {
    const dx = x - b.x, dy = y - b.y, dz = z - b.z, rr = rad + b.r;
    if (Math.abs(dx) > rr || Math.abs(dy) > rr || Math.abs(dz) > rr) return;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= rr || dist < 1e-6) return;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const rel = (vx - b.vx) * nx + (vy - b.vy) * ny + (vz - b.vz) * nz;
    const F = Math.max(0, KBALL * (rr - dist) - CBALL * rel);
    if (F <= 0) return;
    const { fx, fy, fz } = this;
    fx[na] += nx * F * (1 - t); fy[na] += ny * F * (1 - t); fz[na] += nz * F * (1 - t);
    if (t > 0) { fx[nb] += nx * F * t; fy[nb] += ny * F * t; fz[nb] += nz * F * t; }
    b.fx -= nx * F; b.fy -= ny * F; b.fz -= nz * F;
    this.bodyHit = this.bodyHit || rad < 0.2;
  }
}
