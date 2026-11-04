// Smooth visual body shell for a car, generated from the same per-station profile the physics uses (pure maths, no three.js).
// The shell is skinned onto the soft-body panel nodes in shell.js, so it dents, tears and falls off with the physics.

// monotone cubic interpolation through (xs, ys)
export function pchip(xs, ys) {
  const n = xs.length, h = [], dl = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; dl[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : 2 * dl[i - 1] * dl[i] / (dl[i - 1] + dl[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

export function profileFns(d) {
  return { YF: pchip(d.Z, d.YF), YB: pchip(d.Z, d.YB), YR: pchip(d.Z, d.YR), WB: pchip(d.Z, d.WB), WT: pchip(d.Z, d.WT) };
}

function chaikin(pts, iters) {
  for (let it = 0; it < iters; it++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}

const lerp = (a, b, t) => a + (b - a) * t;

// right-half cross-section (x >= 0) at height profile z, as a polyline from the underbody centre up over the side to the top centre
export function section(d, f, z, bedW, zmin, zmax) {
  let yf = f.YF(z) - 0.1;
  const yb = f.YB(z), yr = f.YR(z), wb0 = f.WB(z), wt0 = f.WT(z);
  const de = Math.min(z - zmin, zmax - z), rd = 0.3;
  { const t = Math.max(0, 1 - de / 0.6), sm = t * t * (3 - 2 * t), lo = d.bed ? 0.33 : 0.3; if (yf > lo) yf -= (yf - lo) * sm; }   // bumpers reach lower than the floor pan
  let k = 1; if (de < rd) { const t = 1 - de / rd; k = 1 - 0.16 * (1 - Math.sqrt(Math.max(0, 1 - t * t))); }   // plan-view corner rounding at nose and tail
  const wb = wb0 * k * (d.look && d.look.shoulder ? 1 : 1), wt = wt0 * k, wf = Math.min(d.WF, wb0 - 0.03) * k;
  const crown = 0.035, ybed = yf + 0.26;
  const base = [[0, yf - 0.012], [wf * 0.92, yf - 0.006], [wb * 0.99, yf + (yb - yf) * 0.16], [wb * 1.002, yf + (yb - yf) * 0.58], [wb * 0.988, yb]];
  const norm = [[wt, yr - 0.012], [wt * 0.78, yr + crown * 0.45], [wt * 0.4, yr + crown * 0.85], [0, yr + crown], [0, yr + crown]];
  const bed = [[wb * 0.975, yr], [wb * 0.905, yr - 0.01], [wb * 0.905, ybed], [wb * 0.5, ybed], [0, ybed]];
  const tail = norm.map((p, i) => [lerp(p[0], bed[i][0], bedW), lerp(p[1], bed[i][1], bedW)]);
  return { R: chaikin(base.concat(tail), 2), wf, wb, yf, yb, yr };
}

// outside surface x at height y on a (right-half) section polyline
export function sideX(R, y) {
  for (let i = 0; i < R.length - 1; i++) {
    const a = R[i], b = R[i + 1];
    if (a[0] > 0.3 && ((a[1] <= y && y <= b[1]) || (b[1] <= y && y <= a[1])) && Math.abs(b[1] - a[1]) > 1e-6) return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1]));
  }
  return R[Math.min(R.length - 1, 12)][0];
}

export function buildShellGeometry(d) {
  const f = profileFns(d), Z = d.Z, zmin = Z[0], zmax = Z[Z.length - 1];
  const bedEnd = d.bed ? Z[3] + (Z[4] - Z[3]) * 0.1 : -1e9, bedStart = zmin + 0.14;
  const nz = Math.round((zmax - zmin) / 0.04) + 1;
  const pos = [], trim = [], idx = [];
  const secs = [];
  let L = 0, J = 0;
  for (let iz = 0; iz < nz; iz++) {
    const z = zmin + (zmax - zmin) * iz / (nz - 1);
    const bw = d.bed && z > zmin + 0.06 && z < bedEnd ? Math.min(1, (z - zmin - 0.06) / 0.1) * Math.min(1, (bedEnd - z) / 0.01 + 0.0) : 0;
    const sec = section(d, f, z, bw > 0 ? 1 : 0, zmin, zmax);
    secs.push({ z, sec });
    const R = sec.R; J = R.length; L = 2 * J - 2;
    for (let k = 0; k < J; k++) { pos.push(R[k][0], R[k][1], z); trim.push(0); }
    for (let k = J - 2; k >= 1; k--) { pos.push(-R[k][0], R[k][1], z); trim.push(0); }
  }
  const quads = [];
  for (let iz = 0; iz < nz - 1; iz++) for (let j = 0; j < L; j++) {
    const a = iz * L + j, b = iz * L + (j + 1) % L, c = (iz + 1) * L + j, e = (iz + 1) * L + (j + 1) % L;
    quads.push([a, b, e, c]);
  }
  // wheel arches: remove side-wall quads inside each arch circle, then add a dark liner and trim ring
  const arches = [];
  for (const [zc, sg] of [[d.axF, 1], [d.axF, -1], [d.axR, 1], [d.axR, -1]]) arches.push({ zc, yc: d.WR, sg, Ra: d.WR + (d.look && d.look.arch ? d.look.arch : 0.075) });
  const keep = [];
  for (const q of quads) {
    let cx = 0, cy = 0, cz = 0; for (const v of q) { cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2]; }
    cx /= 4; cy /= 4; cz /= 4;
    let cut = false;
    for (const a of arches) {
      if (cx * a.sg < 0.55) continue;
      const dz = cz - a.zc, dy = cy - a.yc;
      if (dz * dz + dy * dy < a.Ra * a.Ra || (cy < a.yc && Math.abs(dz) < a.Ra * 0.97)) { cut = true; break; }
    }
    if (!cut) keep.push(q);
  }
  for (const q of keep) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  // end caps (flat fascia and tail), rings shrinking towards the section centre
  const capRing = (iz, sgn) => {
    const base = iz * L, ring0 = [];
    let cy = 0; for (let j = 0; j < L; j++) cy += pos[(base + j) * 3 + 1]; cy /= L;
    const z0 = pos[base * 3 + 2];
    let prev = []; for (let j = 0; j < L; j++) prev.push(base + j);
    for (const s of [0.74, 0.46, 0.2, 0]) {
      const ring = [];
      if (s === 0) { const v = pos.length / 3; pos.push(0, cy, z0 + sgn * 0.045); trim.push(0); for (let j = 0; j < L; j++) ring.push(v); }
      else for (let j = 0; j < L; j++) {
        const v = pos.length / 3;
        pos.push(pos[(base + j) * 3] * s, cy + (pos[(base + j) * 3 + 1] - cy) * s, z0 + sgn * 0.045 * (1 - s * s)); trim.push(0); ring.push(v);
      }
      for (let j = 0; j < L; j++) {
        const a = prev[j], b = prev[(j + 1) % L], c = ring[(j + 1) % L], e = ring[j];
        if (sgn < 0) { idx.push(a, e, c); if (b !== a) idx.push(a, c, b); } else { idx.push(a, c, e); if (b !== a) idx.push(a, b, c); }
      }
      prev = ring;
    }
  };
  capRing(0, -1); capRing(nz - 1, 1);
  // arch liners (dark) and trim rings
  const secAt = (z) => { const t = (z - zmin) / (zmax - zmin) * (nz - 1); return secs[Math.max(0, Math.min(nz - 1, Math.round(t)))].sec; };
  const flare = d.look && d.look.flare ? d.look.flare : 0.04;
  for (const a of arches) {
    const N = 22, ringO = [], ringI = [], lipA = [], lipB = [];
    for (let k = 0; k <= N; k++) {
      const th = -0.18 * Math.PI + (1.36 * Math.PI) * k / N;          // from just below the axle at the rear, over the top, to just below the axle at the front
      const zz = a.zc - a.Ra * Math.cos(th), sec = secAt(zz), y = Math.max(a.yc + a.Ra * Math.sin(th), sec.yf + 0.03);
      const x0 = sideX(sec.R, Math.max(y, sec.yf + 0.04)) * a.sg;
      let v = pos.length / 3; pos.push(x0 - a.sg * 0.004, y, zz); trim.push(1); ringO.push(v);
      v = pos.length / 3; pos.push(x0 - a.sg * 0.34, y - 0.02, zz); trim.push(1); ringI.push(v);
      const yo = Math.max(a.yc + (a.Ra + flare) * Math.sin(th), sec.yf + 0.03), zo = a.zc - (a.Ra + flare) * Math.cos(th), xo = sideX(secAt(zo).R, Math.max(yo, sec.yf + 0.04)) * a.sg;
      v = pos.length / 3; pos.push(xo + a.sg * 0.006, yo, zo); trim.push(1); lipB.push(v);
      v = pos.length / 3; pos.push(x0 + a.sg * 0.006, y, zz); trim.push(1); lipA.push(v);
    }
    for (let k = 0; k < N; k++) {
      idx.push(ringO[k], ringI[k], ringI[k + 1], ringO[k], ringI[k + 1], ringO[k + 1]);
      idx.push(lipA[k], lipB[k], lipB[k + 1], lipA[k], lipB[k + 1], lipA[k + 1]);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), trim: new Float32Array(trim), zmin, zmax, L, J, nz };
}
