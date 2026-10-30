// physics.js - soft-body (node & beam) vehicle physics. No dependencies, runs in browser or Node.
// The car is a lattice of mass points (nodes) joined by springs (beams). Beams that are
// squashed or stretched past their yield strain permanently change length (dents), and beams
// stretched too far snap. Wheels are single nodes with a tyre friction model.

export const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const WORLD_HALF = 195;

// ---------------------------------------------------------------- world
export const RAMPS = [
  { x0: -5, x1: 5, z0: 30, z1: 46, h: 3 },    // small kicker
  { x0: -9, x1: 9, z0: 70, z1: 94, h: 7.5 },  // big jump
];

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = smooth(130, 250, r) * (7 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 3 * Math.sin(x * 0.037) * Math.sin(z * 0.031 + 2));
  for (const q of RAMPS) {
    if (z >= q.z0 && z <= q.z1 && x >= q.x0 && x <= q.x1) {
      const t = (z - q.z0) / (q.z1 - q.z0);
      const side = smooth(q.x0, q.x0 + 1.5, x) * (1 - smooth(q.x1 - 1.5, q.x1, x));
      h = Math.max(h, q.h * t * side);
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

// static boxes: min/max corners
export const OBSTACLES = [];
function box(x0, y0, z0, x1, y1, z1, kind) { OBSTACLES.push({ min: [x0, y0, z0], max: [x1, y1, z1], kind }); }
box(-25, -6, 130, 25, 4, 132, 'wall');                                       // crash wall past the big jump
for (let z = -40; z <= 40; z += 10) box(-22.5, -1, z - 0.5, -21.5, 4, z + 0.5, 'pillar'); // slalom pillars
for (let i = 0; i < 3; i++) box(20 + i * 1.3, 0, 15, 21.2 + i * 1.3, 1.2, 16.2, 'crate');   // crates
box(21.3, 1.2, 15, 22.5, 2.4, 16.2, 'crate');
box(-4, -1, -70, 4, 1.0, -68.5, 'barrier');                                  // low barrier

// ---------------------------------------------------------------- car definition
const ZS = [-2.0, -1.0, 0.9, 2.0];       // rear -> front
const XS = [0.9, -0.9];                  // left (+x), right (-x)
const YS = [0.6, 1.1];
const CZ = [-0.4, 0.4];
const CX = [0.75, -0.75];
const CY = 1.65;
export const WR = 0.35;                  // wheel radius
const WX = 1.05, WZ = 1.35;
const ni = (zi, xi, yi) => zi * 4 + xi * 2 + yi;
const ci = (zc, xi) => 16 + zc * 2 + xi;
const NBODY = 20, NN = 24;

const RED = [0.72, 0.07, 0.1], GLASS = [0.08, 0.13, 0.18], DARK = [0.06, 0.06, 0.07];
export const FACES = [];
function quad(a, b, c, d, col) { FACES.push({ q: [a, b, c, d], col }); }
quad(ni(0, 0, 0), ni(0, 1, 0), ni(0, 1, 1), ni(0, 0, 1), RED);       // rear
quad(ni(3, 0, 0), ni(3, 1, 0), ni(3, 1, 1), ni(3, 0, 1), RED);       // front
for (let i = 0; i < 3; i++) {
  quad(ni(i, 0, 0), ni(i, 1, 0), ni(i + 1, 1, 0), ni(i + 1, 0, 0), DARK);   // floor
  quad(ni(i, 0, 0), ni(i + 1, 0, 0), ni(i + 1, 0, 1), ni(i, 0, 1), RED);    // left side
  quad(ni(i, 1, 0), ni(i + 1, 1, 0), ni(i + 1, 1, 1), ni(i, 1, 1), RED);    // right side
}
quad(ni(0, 0, 1), ni(0, 1, 1), ni(1, 1, 1), ni(1, 0, 1), RED);       // boot
quad(ni(2, 0, 1), ni(2, 1, 1), ni(3, 1, 1), ni(3, 0, 1), RED);       // bonnet
quad(ni(1, 0, 1), ni(1, 1, 1), ci(0, 1), ci(0, 0), GLASS);           // rear window
quad(ci(1, 0), ci(1, 1), ni(2, 1, 1), ni(2, 0, 1), GLASS);           // windscreen
quad(ci(0, 0), ci(0, 1), ci(1, 1), ci(1, 0), RED);                   // roof
for (let xi = 0; xi < 2; xi++) quad(ni(1, xi, 1), ci(0, xi), ci(1, xi), ni(2, xi, 1), GLASS); // side windows

// ---------------------------------------------------------------- tuning
const DT = 1 / 600;
const KB = 400000, CB = 3500;     // contact stiffness / damping for body points
const KG = 180000, CG = 2500;     // wheel-ground
const MU_BODY = 0.7, MU_TYRE = 1.15;
const ENG = 4200, VMAX = 60, BRK = 4500, LAT = 4500;
const DRAG = 0.02;

export class Car {
  constructor() {
    this.NN = NN;
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
      lx[i] = w.left ? WX : -WX; ly[i] = WR; lz[i] = w.front ? WZ : -WZ;
      w.spin = 0; w.spinVel = 0; w.grounded = false;
    });
    this.lx = lx; this.ly = ly; this.lz = lz;

    this.px = new Float64Array(NN); this.py = new Float64Array(NN); this.pz = new Float64Array(NN);
    this.vx = new Float64Array(NN); this.vy = new Float64Array(NN); this.vz = new Float64Array(NN);
    this.fx = new Float64Array(NN); this.fy = new Float64Array(NN); this.fz = new Float64Array(NN);
    this.m = new Float64Array(NN);
    for (let i = 0; i < NBODY; i++) this.m[i] = 55;
    for (const w of this.wheels) this.m[w.i] = 50;

    // beams
    const ba = [], bb = [], bk = [], bc = [], by = [], bbr = [];
    const add = (a, b, k, c, y, br) => { ba.push(a); bb.push(b); bk.push(k); bc.push(c); by.push(y); bbr.push(br); };
    for (let i = 0; i < NBODY; i++) for (let j = i + 1; j < NBODY; j++) {
      const d = Math.hypot(lx[i] - lx[j], ly[i] - ly[j], lz[i] - lz[j]);
      if (d < 3.2) add(i, j, 200000, 1100, 0.02, 0.5);
    }
    for (const w of this.wheels) {
      const xi = w.left ? 0 : 1;
      const zis = w.front ? [2, 3] : [0, 1];
      for (const zi of zis) for (let yi = 0; yi < 2; yi++) {
        add(w.i, ni(zi, xi, yi), 45000, 1500, 0.35, 0.9);
        add(w.i, ni(zi, 1 - xi, yi), 45000, 1500, 0.35, 0.9);
      }
    }
    this.NB = ba.length;
    this.ba = Int32Array.from(ba); this.bb = Int32Array.from(bb);
    this.bk = Float64Array.from(bk); this.bc = Float64Array.from(bc);
    this.byield = Float64Array.from(by); this.bbreak = Float64Array.from(bbr);
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
    for (const f of FACES) for (let k = 0; k < 4; k++) {
      const a = f.q[k], b = f.q[(k + 1) % 4];
      const key = Math.min(a, b) * 100 + Math.max(a, b);
      if (seen.has(key)) continue; seen.add(key);
      cpA.push(a); cpB.push(b); cpT.push(0.5);
    }
    this.cpA = Int32Array.from(cpA); this.cpB = Int32Array.from(cpB); this.cpT = Float64Array.from(cpT);
    this.NC = cpA.length;

    this.fwd = [0, 0, 1]; this.left = [1, 0, 0]; this.up = [0, 1, 0];
    this.com = [0, 0, 0]; this.vcom = [0, 0, 0];
    this.steerAngle = 0; this.acc = 0; this.plastic = 0; this.time = 0;
    this._n = [0, 1, 0]; this._F = [0, 0, 0];
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
    this.bL0.set(this.bL00); this.broken.fill(0); this.strain.fill(0);
    this.steerAngle = 0; this.plastic = 0; this.acc = 0;
    for (const w of this.wheels) { w.spin = 0; w.spinVel = 0; w.grounded = false; }
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
    const d = lx * fx + ly * fy + lz * fz; lx -= fx * d; ly -= fy * d; lz -= fz * d;
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
      if (this.bk[q] !== 200000) continue;
      s += this.broken[q] ? 1 : Math.abs(this.bL0[q] - this.bL00[q]) / this.bL00[q]; n++;
    }
    return Math.min(100, (s / n) * 600);
  }
  get brokenCount() { let c = 0; for (let q = 0; q < this.NB; q++) c += this.broken[q]; return c; }

  // frame-level update: handles steering smoothing then fixed sub-steps
  advance(dt, inp) {
    const sp = Math.abs(this.forwardSpeed);
    const maxSteer = Math.max(0.1, 0.6 / (1 + sp * 0.06));
    const target = clamp(inp.steer, -1, 1) * maxSteer;
    const rate = 1.8 * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 40) { this.step(inp); this.acc -= DT; n++; }
    if (this.acc > DT * 40) this.acc = 0;
  }

  // sum of ground + box forces on a point, written to this._F. returns true if touching
  contact(x, y, z, vx, vy, vz, r, mass, mu, noTerrain) {
    const F = this._F; F[0] = F[1] = F[2] = 0;
    let hit = false;
    const nrm = this._n;
    const pen = noTerrain ? -1 : terrainHeight(x, z) + r - y;
    if (pen > 0) {
      terrainNormal(x, z, nrm);
      const ny = Math.max(nrm[1], 0.3);
      const vn = vx * nrm[0] + vy * nrm[1] + vz * nrm[2];
      const Fn = Math.max(0, KB * pen * ny - CB * vn);
      F[0] += nrm[0] * Fn; F[1] += nrm[1] * Fn; F[2] += nrm[2] * Fn;
      const tx = vx - nrm[0] * vn, ty = vy - nrm[1] * vn, tz = vz - nrm[2] * vn;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-4) {
        const fr = Math.min(mu * Fn, tl * mass / DT * 0.5);
        F[0] -= tx / tl * fr; F[1] -= ty / tl * fr; F[2] -= tz / tl * fr;
      }
      hit = true;
    }
    for (let o = 0; o < OBSTACLES.length; o++) {
      const b = OBSTACLES[o];
      if (x < b.min[0] - r || x > b.max[0] + r || y < b.min[1] - r || y > b.max[1] + r || z < b.min[2] - r || z > b.max[2] + r) continue;
      const cx = clamp(x, b.min[0], b.max[0]), cy = clamp(y, b.min[1], b.max[1]), cz = clamp(z, b.min[2], b.max[2]);
      let dx = x - cx, dy = y - cy, dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      let p, nx, ny, nz;
      if (d2 > 1e-12) {
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; nz = dz / d; p = r - d;
      } else { // inside: push out through nearest face
        const ds = [x - b.min[0], b.max[0] - x, y - b.min[1], b.max[1] - y, z - b.min[2], b.max[2] - z];
        let k = 0; for (let i = 1; i < 6; i++) if (ds[i] < ds[k]) k = i;
        nx = ny = nz = 0;
        if (k === 0) nx = -1; else if (k === 1) nx = 1; else if (k === 2) ny = -1; else if (k === 3) ny = 1; else if (k === 4) nz = -1; else nz = 1;
        p = r + ds[k];
      }
      const vn = vx * nx + vy * ny + vz * nz;
      const Fn = Math.max(0, KB * p - CB * vn);
      F[0] += nx * Fn; F[1] += ny * Fn; F[2] += nz * Fn;
      const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-4) {
        const fr = Math.min(0.4 * Fn, tl * mass / DT * 0.5);
        F[0] -= tx / tl * fr; F[1] -= ty / tl * fr; F[2] -= tz / tl * fr;
      }
      hit = true;
    }
    return hit;
  }

  step(inp) {
    const { px, py, pz, vx, vy, vz, fx, fy, fz, m } = this;
    const dt = DT;
    for (let i = 0; i < NN; i++) {
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      const d = DRAG * sp;
      fx[i] = -vx[i] * d; fy[i] = -G * m[i] - vy[i] * d; fz[i] = -vz[i] * d;
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
        const d = (e - y * L0) * 0.3; this.bL0[q] = L0 + d; this.plastic += d;
        if (st > this.bbreak[q]) this.broken[q] = 1;
      } else if (st < -y) {
        const d = (-e - y * L0) * 0.3;
        if (L0 - d > 0.45 * this.bL00[q]) { this.bL0[q] = L0 - d; this.plastic += d; }
      }
    }

    this.computeFrame();
    const fwd = this.fwd, vlongCar = this.forwardSpeed;

    // input -> drive / brake
    let thrust = 0, brake = 0;
    if (inp.up) { if (vlongCar < -1) brake = 1; else thrust = 1; }
    if (inp.down) { if (vlongCar > 1) brake = 1; else thrust = -1; }

    // wheels
    const n = this._n;
    for (const w of this.wheels) {
      const i = w.i;
      const x = px[i], y = py[i], z = pz[i];
      const h = terrainHeight(x, z);
      const pen = h + WR - y;
      w.grounded = false;
      if (pen > 0) {
        terrainNormal(x, z, n);
        const nx = n[0], ny = n[1], nz = n[2];
        const nyc = Math.max(ny, 0.3);
        const vn = vx[i] * nx + vy[i] * ny + vz[i] * nz;
        const Fn = Math.max(0, KG * pen * nyc - CG * vn);
        w.grounded = true;
        // tangent forward vector (steered for front wheels)
        let tx = fwd[0] - nx * (fwd[0] * nx + fwd[1] * ny + fwd[2] * nz);
        let ty = fwd[1] - ny * (fwd[0] * nx + fwd[1] * ny + fwd[2] * nz);
        let tz = fwd[2] - nz * (fwd[0] * nx + fwd[1] * ny + fwd[2] * nz);
        let tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        // n x t
        let sx = ny * tz - nz * ty, sy = nz * tx - nx * tz, sz = nx * ty - ny * tx;
        if (w.front) {
          const c = Math.cos(this.steerAngle), s = Math.sin(this.steerAngle);
          const ux = tx * c + sx * s, uy = ty * c + sy * s, uz = tz * c + sz * s;
          tx = ux; ty = uy; tz = uz;
          sx = ny * tz - nz * ty; sy = nz * tx - nx * tz; sz = nx * ty - ny * tx;
        }
        const vlong = vx[i] * tx + vy[i] * ty + vz[i] * tz;
        const vlat = vx[i] * sx + vy[i] * sy + vz[i] * sz;
        const maxF = MU_TYRE * Fn;
        let Fl = 0;
        const rear = !w.front;
        if (rear && thrust > 0) Fl += ENG * Math.max(0, 1 - vlong / VMAX);
        else if (rear && thrust < 0) Fl -= ENG * 0.5 * Math.max(0, 1 + vlong / 20);
        if (brake) Fl -= clamp(vlong * 5000, -BRK, BRK);
        const locked = rear && inp.hand;
        if (locked) Fl = -clamp(vlong * 5000, -maxF, maxF);
        if (!thrust && !brake && !locked) Fl -= clamp(vlong * 300, -300, 300);
        let Ft = -vlat * LAT * (locked ? 0.4 : 1);
        const mag = Math.hypot(Fl, Ft), cap = locked ? maxF * 0.7 : maxF;
        if (mag > cap) { const k = cap / mag; Fl *= k; Ft *= k; }
        fx[i] += nx * Fn + tx * Fl + sx * Ft;
        fy[i] += ny * Fn + ty * Fl + sy * Ft;
        fz[i] += nz * Fn + tz * Fl + sz * Ft;
        w.spinVel = locked ? 0 : vlong / WR;
      }
      // wheel vs boxes (treated as a sphere)
      if (this.contact(x, y, z, vx[i], vy[i], vz[i], WR, m[i], MU_BODY, true)) {
        fx[i] += this._F[0]; fy[i] += this._F[1]; fz[i] += this._F[2];
      }
      w.spin += w.spinVel * dt;
    }

    // body collision points (ground, boxes)
    for (let c = 0; c < this.NC; c++) {
      const a = this.cpA[c], b = this.cpB[c], t = this.cpT[c];
      const x = px[a] + (px[b] - px[a]) * t, y = py[a] + (py[b] - py[a]) * t, z = pz[a] + (pz[b] - pz[a]) * t;
      const cvx = vx[a] + (vx[b] - vx[a]) * t, cvy = vy[a] + (vy[b] - vy[a]) * t, cvz = vz[a] + (vz[b] - vz[a]) * t;
      if (!this.contact(x, y, z, cvx, cvy, cvz, 0.1, 55, MU_BODY)) continue;
      const F = this._F;
      fx[a] += F[0] * (1 - t); fy[a] += F[1] * (1 - t); fz[a] += F[2] * (1 - t);
      if (t > 0) { fx[b] += F[0] * t; fy[b] += F[1] * t; fz[b] += F[2] * t; }
    }

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
}
