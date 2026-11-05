// Visual car body: a smooth, high-resolution shell skinned onto the soft-body panel nodes, textured with hand-painted
// side / front / rear / top decals (windows, lamps, grille, door seams, stripes...). It dents, tears and falls off with the physics.
import * as THREE from 'three';
import { buildShellGeometry, profileFns } from './shell_geom.js';

const S = 1024, H = 2.4, WH = 1.2;
const DARK = '#0b0c0e', CHROME = '#c7ccd3', LENS = '#e6ecef', RED = '#9d1018', PLATE = '#ecebe4', GREY = '#2a2d31';

function proj(nx, ny, nz) { if (Math.abs(nx) > 0.55 && Math.abs(nx) >= Math.abs(ny)) return 0; if (ny > 0.42) return 3; return nz > 0 ? 1 : 2; }

// ------------------------------------------------------------------ painting
function paintCar(d) {
  const Z = d.Z, zmin = Z[0], zmax = Z[11], Z0 = zmin - 0.12, ZL = zmax - zmin + 0.24, f = profileFns(d), look = d.look || {};
  const zs = (s) => { const i = Math.max(0, Math.min(10, Math.floor(s))); return Z[i] + (Z[i + 1] - Z[i]) * (s - i); };
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cv = { side: mk(), front: mk(), rear: mk(), top: mk() }, g = {}, gm = { side: mk(), front: mk(), rear: mk(), top: mk() }, lm = { front: mk(), rear: mk() };
  for (const k in cv) g[k] = cv[k].getContext('2d');
  const gmc = {}; for (const k in gm) { gmc[k] = gm[k].getContext('2d'); gmc[k].fillStyle = '#000'; gmc[k].fillRect(0, 0, S, S); }
  const lmc = {}; for (const k in lm) { lmc[k] = lm[k].getContext('2d'); lmc[k].fillStyle = '#000'; lmc[k].fillRect(0, 0, S, S); }
  const sx = (z) => (z - Z0) / ZL * S, sy = (y) => (1 - y / H) * S, vx = (x) => (x / (2 * WH) + 0.5) * S, tz = (z) => (1 - (z - Z0) / ZL) * S;
  const pxm = S / ZL;                                   // pixels per metre along the side / top views
  const pxf = S / (2 * WH);                              // pixels per metre in the front / rear views
  const poly = (ctx, pts, fill, stroke, lw) => {
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
  };
  const rect = (ctx, x0, y0, x1, y1, fill) => { ctx.fillStyle = fill; ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); };
  const line = (ctx, x0, y0, x1, y1, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  const trimCol = look.trim === 'chrome' ? CHROME : DARK;
  const fourDoor = look.doors === 4;

  // ---------------------------------------------------------------- side view (z, y)
  {
    const c = g.side, m = gmc.side;
    const yb = (z) => f.YB(z) + 0.035, yt = (z) => f.YR(z) - 0.055;
    const zFt = look.winFront ? zs(look.winFront[0]) : zs(7.0), zFb = look.winFront ? zs(look.winFront[1]) : zs(8.1);
    const zRt = look.winRear ? zs(look.winRear[0]) : zs(4.0), zRb = look.winRear ? zs(look.winRear[1]) : zs(2.6);
    if (!look.noSideGlass) {
      const pts = [];
      for (let z = zFt; z >= zRt; z -= 0.04) pts.push([sx(z), sy(yt(z))]);
      pts.push([sx(zRt), sy(yt(zRt))]);
      for (let z = zRb; z <= zFb; z += 0.04) pts.push([sx(z), sy(yb(z))]);
      poly(c, pts, DARK, trimCol, 0.04 * pxm); poly(m, pts, '#fff');
      if (fourDoor) {                                       // B pillar
        const zb = look.bPillar !== undefined ? zs(look.bPillar) : zs(5.6);
        rect(c, sx(zb - 0.035), sy(yt(zb) + 0.06), sx(zb + 0.035), sy(yb(zb) - 0.02), DARK); rect(m, sx(zb - 0.035), sy(yt(zb) + 0.06), sx(zb + 0.035), sy(yb(zb) - 0.02), '#000');
      }
    } else if (look.frontWinOnly) {                         // panel van: just the cab door window
      const pts = [];
      for (let z = zFt; z >= zs(6.2); z -= 0.04) pts.push([sx(z), sy(yt(z))]);
      for (let z = zs(6.2); z <= zFb; z += 0.04) pts.push([sx(z), sy(yb(z))]);
      poly(c, pts, DARK, DARK, 0.04 * pxm); poly(m, pts, '#fff');
    }
    // door shut lines and handles
    const yS = Math.min(...Z.map((_, i) => d.YF[i])) + 0.02, zf = look.doorFront ? zs(look.doorFront) : zs(8.05), zr = look.doorRear ? zs(look.doorRear) : (fourDoor ? zs(3.35) : zs(4.6));
    const seam = 'rgba(8,8,10,0.85)', lw = 0.011 * pxm;
    const top = (z) => f.YB(z) + 0.02;
    for (const z of fourDoor ? [zf, zs(look.bPillar !== undefined ? look.bPillar : 5.6), zr] : [zf, zr]) line(c, sx(z), sy(top(z)), sx(z + (z === zf ? 0.04 : 0)), sy(yS + 0.2), seam, lw);
    line(c, sx(zf), sy(yS + 0.2), sx(zr), sy(yS + 0.2), seam, lw);
    const handleY = (z) => f.YB(z) - 0.1;
    const handles = fourDoor ? [zs(5.6) + 0.34, zs(5.6) - 0.34] : [zs(5.6) + 0.3];
    for (const z of handles) rect(c, sx(z - 0.07), sy(handleY(z)), sx(z + 0.07), sy(handleY(z) - 0.022), look.handle || CHROME);
    // sills / cladding
    if (look.sill) { const col = look.sill === 'chrome' ? CHROME : DARK; rect(c, sx(zs(2.4)), sy(yS - 0.02), sx(zs(8.9)), sy(yS + 0.075), col); }
    if (look.lowerBand) { const [ya, yb2] = look.lowerBand; rect(c, sx(zmin), sy(yb2), sx(zmax), sy(ya), look.lowerCol || '#3a3e43'); }
    if (look.sideStripe) { rect(c, sx(zs(1.5)), sy(look.sideStripe[0]), sx(zs(9.5)), sy(look.sideStripe[1]), look.sideStripeCol || '#f0f0f2'); }
    if (look.scoop) {                                       // side scoop behind the door (fastback muscle car)
      const z0 = zs(3.2), y0 = f.YB(z0) - 0.22;
      poly(c, [[sx(z0 - 0.3), sy(y0)], [sx(z0 + 0.12), sy(y0 + 0.05)], [sx(z0 + 0.12), sy(y0 - 0.14)], [sx(z0 - 0.3), sy(y0 - 0.1)]], DARK, CHROME, 0.01 * pxm);
    }
    if (look.sideVent) {                                    // gill behind the front wheel
      const z0 = zs(8.6), y0 = f.YB(z0) - 0.17;
      poly(c, [[sx(z0 - 0.06), sy(y0 + 0.05)], [sx(z0 + 0.14), sy(y0 + 0.02)], [sx(z0 + 0.14), sy(y0 - 0.08)], [sx(z0 - 0.06), sy(y0 - 0.04)]], DARK, CHROME, 0.008 * pxm);
    }
    if (look.beltLine) line(c, sx(zs(1.2)), sy(f.YB(zs(1.2)) - 0.005), sx(zs(10.4)), sy(f.YB(zs(10.4)) - 0.005), look.beltLine, 0.014 * pxm);
    if (look.markers !== false) { rect(c, sx(zmax - 0.02), sy(f.YB(zmax) - 0.08), sx(zmax - 0.1), sy(f.YB(zmax) - 0.12), '#d98a1c'); rect(c, sx(zmin + 0.02), sy(f.YB(zmin) - 0.08), sx(zmin + 0.1), sy(f.YB(zmin) - 0.12), '#9d1018'); }
  }

  // ---------------------------------------------------------------- front (x, y), shared helpers for front and rear
  const yTf = f.YR(zmax) + 0.02, yTr = f.YR(zmin) + 0.02, y0f = d.bed ? 0.33 : 0.3, wF = f.WB(zmax) * 0.84, wR = f.WB(zmin) * 0.84;
  const plate = (c, x, y, w, h) => { rect(c, vx(x - w / 2) - 3, tz0(y) - 3, vx(x + w / 2) + 3, tz0(y - h) + 3, '#1a1a1a'); rect(c, vx(x - w / 2), tz0(y), vx(x + w / 2), tz0(y - h), PLATE); };
  const tz0 = sy;
  const poly2 = (c, pts, fill, stroke, lw) => poly(c, pts.map((p) => [vx(p[0]), sy(p[1])]), fill, stroke, lw);
  const circ = (c, x, y, r, fill, stroke, lw) => { c.beginPath(); c.arc(vx(x), sy(y), r * pxf, 0, 7); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); } };
  const R2 = (c, x0, y0, x1, y1, fill) => rect(c, vx(x0), sy(y0), vx(x1), sy(y1), fill);
  const L2 = (c, x0, y0, x1, y1, col, lw) => line(c, vx(x0), sy(y0), vx(x1), sy(y1), col, lw);
  const headSlim = (c, m, sg, w, yT, h) => {
    const pts = [[0.5 * w, yT - 0.035], [0.97 * w, yT - 0.06], [0.99 * w, yT - 0.06 - h], [0.58 * w, yT - 0.035 - h * 0.8]].map(([x, y]) => [x * sg, y]);
    poly2(c, pts, LENS, '#202428', 3); poly2(m, pts, '#fff');
    circ(c, sg * 0.78 * w, yT - 0.07 - h * 0.4, h * 0.3, '#8f9ba3', '#3b4248', 2);
    L2(c, sg * 0.56 * w, yT - 0.05, sg * 0.97 * w, yT - 0.075, CHROME, 3);
  };
  const headRound = (c, m, sg, x, y, r, rim) => {
    circ(c, sg * x, y, r + 0.018, rim || CHROME); circ(c, sg * x, y, r, LENS, '#555c62', 2); circ(c, sg * x, y, r * 0.55, '#aab4bb', '#4b535a', 2);
    circ(m, sg * x, y, r, '#fff');
  };
  const frontFace = () => {
    const c = g.front, m = lmc.front, yT = yTf, w = wF, yb = y0f;
    const kind = look.face;
    // bumper valance colour band is painted in the car colour; trim pieces are drawn on top
    if (kind === 'intake') {
      for (const sg of [1, -1]) headSlim(c, m, sg, w, yT, 0.12);
      poly2(c, [[-0.5 * w, yT - 0.045], [0.5 * w, yT - 0.045], [0.46 * w, yT - 0.1], [-0.46 * w, yT - 0.1]], DARK, CHROME, 2);
      circ(c, 0, yT - 0.072, 0.03, CHROME, DARK, 2);
      poly2(c, [[-0.78 * w, yb + 0.08], [0.78 * w, yb + 0.08], [0.62 * w, yb + 0.21], [-0.62 * w, yb + 0.21]], DARK);
      for (let k = 0; k < 4; k++) L2(c, -0.7 * w + k * 0.0, yb + 0.1 + k * 0.03, 0.7 * w, yb + 0.1 + k * 0.03, '#2b2f34', 2);
      for (const sg of [1, -1]) poly2(c, [[sg * 0.82 * w, yb + 0.1], [sg * 0.96 * w, yb + 0.1], [sg * 0.96 * w, yb + 0.19], [sg * 0.84 * w, yb + 0.19]], DARK);
      plate(c, 0, yb + 0.33, 0.5, 0.11);
    } else if (kind === 'mouth') {
      for (const sg of [1, -1]) headSlim(c, m, sg, w, yT, 0.1);
      poly2(c, [[-0.8 * w, yb + 0.07], [0.8 * w, yb + 0.07], [0.7 * w, yb + 0.26], [-0.7 * w, yb + 0.26]], DARK, CHROME, 3);
      for (let k = -9; k <= 9; k++) L2(c, k * 0.07 * w, yb + 0.09, k * 0.062 * w, yb + 0.25, '#55595f', 2);
      for (let k = 0; k < 4; k++) L2(c, -0.78 * w, yb + 0.1 + k * 0.045, 0.78 * w, yb + 0.1 + k * 0.045, '#4a4e54', 2);
      R2(c, -0.85 * w, yb + 0.02, 0.85 * w, yb + 0.06, DARK);
      L2(c, -0.4 * w, yT - 0.12, 0.4 * w, yT - 0.12, DARK, 5);
      plate(c, 0, yb + 0.34, 0.5, 0.11);
    } else if (kind === 'bars') {
      const tall = (yT - yb) > 0.7;
      if (tall) {                                           // big-truck grille with bold bars and a bowtie badge
        const gt = yT - 0.12, gb = yT - 0.5;
        for (const sg of [1, -1]) {
          const pts = [[0.6 * w, yT - 0.05], [0.98 * w, yT - 0.08], [0.98 * w, yT - 0.24], [0.64 * w, yT - 0.2]].map(([x, y]) => [x * sg, y]);
          poly2(c, pts, LENS, '#1c1f22', 3); poly2(m, pts, '#fff'); poly2(c, [[sg * 0.66 * w, yT - 0.1], [sg * 0.94 * w, yT - 0.12], [sg * 0.94 * w, yT - 0.19], [sg * 0.68 * w, yT - 0.17]], '#aeb7be');
        }
        poly2(c, [[-0.58 * w, gt], [0.58 * w, gt], [0.58 * w, gb], [-0.58 * w, gb]], '#0d0e10', DARK, 3);
        for (let k = 0; k < 5; k++) R2(c, -0.55 * w, gt - 0.03 - k * 0.075, 0.55 * w, gt - 0.075 - k * 0.075, '#2f3338');
        for (let k = 0; k < 4; k++) R2(c, -0.55 * w, gt - 0.01 - k * 0.075 - 0.02, 0.55 * w, gt - 0.025 - k * 0.075 - 0.02, CHROME);
        R2(c, -0.1 * w, yT - 0.2, 0.1 * w, yT - 0.26, '#b9a16a');
        R2(c, -0.9 * w, yb + 0.02, 0.9 * w, yb + 0.3, '#14161a');
        poly2(c, [[-0.7 * w, yb + 0.1], [0.7 * w, yb + 0.1], [0.62 * w, yb + 0.22], [-0.62 * w, yb + 0.22]], '#050506');
        for (const sg of [1, -1]) { R2(c, sg * 0.74 * w, yb + 0.07, sg * 0.88 * w, yb + 0.14, '#d11b1b'); circ(c, sg * 0.5 * w, yb + 0.2, 0.025, LENS); }
        plate(c, 0, yb + 0.34, 0.5, 0.11);
      } else {                                               // classic round-lamp grille (muscle car)
        for (const sg of [1, -1]) headRound(c, m, sg, 0.74 * w, yT - 0.15, 0.085, CHROME);
        poly2(c, [[-0.5 * w, yT - 0.06], [0.5 * w, yT - 0.06], [0.5 * w, yT - 0.24], [-0.5 * w, yT - 0.24]], '#0e0f11', CHROME, 5);
        for (let k = -6; k <= 6; k++) L2(c, k * 0.075 * w, yT - 0.07, k * 0.075 * w, yT - 0.23, '#3a3e43', 2);
        for (let k = 0; k < 3; k++) L2(c, -0.5 * w, yT - 0.1 - k * 0.05, 0.5 * w, yT - 0.1 - k * 0.05, '#3a3e43', 2);
        circ(c, 0, yT - 0.15, 0.04, CHROME, DARK, 2);
        R2(c, -w, yb + 0.02, w, yb + 0.12, CHROME);          // chrome bumper
        R2(c, -0.4 * w, yb + 0.13, 0.4 * w, yb + 0.2, '#0d0e10');
        plate(c, 0, yb + 0.26, 0.46, 0.1);
      }
    } else if (kind === 'slots') {
      for (const sg of [1, -1]) headSlim(c, m, sg, w, yT, 0.15);
      poly2(c, [[-0.5 * w, yT - 0.06], [0.5 * w, yT - 0.06], [0.46 * w, yT - 0.34], [-0.46 * w, yT - 0.34]], '#101113', CHROME, 4);
      for (let k = -3; k <= 3; k++) R2(c, k * 0.13 * w - 0.02, yT - 0.09, k * 0.13 * w + 0.02, yT - 0.31, '#d9dde2');
      R2(c, -0.95 * w, yb + 0.02, 0.95 * w, yb + 0.26, '#15171a');
      poly2(c, [[-0.75 * w, yb + 0.1], [0.75 * w, yb + 0.1], [0.66 * w, yb + 0.2], [-0.66 * w, yb + 0.2]], '#050506', CHROME, 3);
      L2(c, -0.7 * w, yb + 0.05, 0.7 * w, yb + 0.05, CHROME, 5);
      plate(c, 0, yT - 0.42, 0.52, 0.12);
    } else if (kind === 'mini') {
      for (const sg of [1, -1]) headRound(c, m, sg, 0.68 * w, yT - 0.12, 0.115, CHROME);
      poly2(c, [[-0.4 * w, yT - 0.05], [0.4 * w, yT - 0.05], [0.4 * w, yT - 0.27], [-0.4 * w, yT - 0.27]], '#0c0d0f', CHROME, 6);
      for (let k = -6; k <= 6; k++) L2(c, k * 0.06 * w, yT - 0.06, k * 0.06 * w, yT - 0.26, '#2c3035', 2);
      L2(c, -0.4 * w, yT - 0.13, 0.4 * w, yT - 0.13, '#2c3035', 2);
      poly2(c, [[-0.6 * w, yb + 0.1], [0.6 * w, yb + 0.1], [0.6 * w, yb + 0.2], [-0.6 * w, yb + 0.2]], DARK);
      for (const sg of [1, -1]) { circ(c, sg * 0.66 * w, yb + 0.15, 0.055, LENS, CHROME, 4); circ(m, sg * 0.66 * w, yb + 0.15, 0.04, '#fff'); }
      plate(c, 0, yb + 0.3, 0.5, 0.11);
    }
  };
  frontFace();

  // ---------------------------------------------------------------- rear (x, y)
  {
    const c = g.rear, m = lmc.rear, yT = yTr, w = wR, yb = y0f, kind = look.rearKind || 'sedan';
    const tail = (sg) => { const pts = [[0.52 * w, yT - 0.08], [0.97 * w, yT - 0.06], [0.97 * w, yT - 0.2], [0.56 * w, yT - 0.2]].map(([x, y]) => [x * sg, y]); poly2(c, pts, RED, '#220407', 3); poly2(m, pts, '#fff'); };
    const lowT = (sg) => { const pts = [[0.55 * w, yb + 0.28], [0.95 * w, yb + 0.28], [0.95 * w, yb + 0.38], [0.57 * w, yb + 0.38]].map(([x, y]) => [x * sg, y]); poly2(c, pts, RED, '#220407', 3); poly2(m, pts, '#fff'); };
    if (kind === 'hatch') {                                    // near-vertical glass tailgate
      const yg0 = f.YB(zmin) + 0.05, yg1 = yT - 0.06, pts = [[-0.74 * f.WT(zmin), yg1], [0.74 * f.WT(zmin), yg1], [0.82 * f.WT(zmin), yg0], [-0.82 * f.WT(zmin), yg0]];
      poly2(c, pts, DARK, DARK, 10); poly2(gmc.rear, pts, '#fff');
      for (const sg of [1, -1]) { const p2 = [[0.84 * w, yg0 + 0.02], [0.99 * w, yg0 + 0.02], [0.99 * w, yg0 + 0.3], [0.88 * w, yg0 + 0.3]].map(([x, y]) => [x * sg, y]); poly2(c, p2, RED, '#220407', 3); poly2(m, p2, '#fff'); }
      plate(c, 0, yb + 0.37, 0.5, 0.11);
      L2(c, -0.14, yg0 - 0.05, 0.14, yg0 - 0.05, CHROME, 5);
    } else if (kind === 'wagon') {                             // SUV tailgate with a big window
      const yg0 = f.YB(zmin) + 0.1, yg1 = yT - 0.07;
      const pts = [[-0.8 * f.WT(zmin), yg1], [0.8 * f.WT(zmin), yg1], [0.86 * f.WT(zmin), yg0], [-0.86 * f.WT(zmin), yg0]];
      poly2(c, pts, DARK, DARK, 10); poly2(gmc.rear, pts, '#fff');
      for (const sg of [1, -1]) { const p2 = [[0.9 * w, yg0], [0.99 * w, yg0], [0.99 * w, yg0 + 0.42], [0.92 * w, yg0 + 0.42]].map(([x, y]) => [x * sg, y]); poly2(c, p2, RED, '#220407', 3); poly2(m, p2, '#fff'); }
      R2(c, -w, yb + 0.02, w, yb + 0.26, '#15171a');
      plate(c, 0, yb + 0.5, 0.5, 0.12);
    } else if (kind === 'van') {                               // split rear doors
      L2(c, 0, yb + 0.35, 0, yT - 0.05, 'rgba(8,8,10,0.9)', 5);
      for (const sg of [1, -1]) { const p2 = [[0.9 * w, yb + 0.35], [0.99 * w, yb + 0.35], [0.99 * w, yb + 1.0], [0.92 * w, yb + 1.0]].map(([x, y]) => [x * sg, y]); poly2(c, p2, RED, '#220407', 3); poly2(m, p2, '#fff'); }
      R2(c, -w, yb + 0.02, w, yb + 0.3, '#2c2f33');
      plate(c, 0, yb + 0.55, 0.52, 0.12);
      const yw = yT - 0.35; for (const sg of [1, -1]) { const p3 = [[sg * 0.08, yw], [sg * 0.82 * w, yw], [sg * 0.82 * w, yw - 0.55], [sg * 0.08, yw - 0.55]]; poly2(c, p3, DARK, DARK, 4); poly2(gmc.rear, p3, '#fff'); }
    } else if (kind === 'truck') {                             // tailgate, cab window above it
      for (const sg of [1, -1]) { const p2 = [[sg * 0.88 * w, d.YR[1] - 0.2], [sg * 0.99 * w, d.YR[1] - 0.2], [sg * 0.99 * w, d.YR[1] - 0.04], [sg * 0.9 * w, d.YR[1] - 0.04]]; poly2(c, p2, RED, '#220407', 3); poly2(m, p2, '#fff'); }
      R2(c, -w, yb + 0.02, w, yb + 0.26, '#15171a');
      R2(c, -0.5 * w, d.YR[1] - 0.2, 0.5 * w, d.YR[1] - 0.12, '#1c1f22');
      plate(c, 0, yb + 0.5, 0.5, 0.12);
      const gz = f.WT(zs(4.5)) * 0.78, yw0 = d.YR[1] + 0.16, yw1 = d.YR[5] - 0.14;     // cab rear window on the cab back wall
      const pts = [[-gz, yw1], [gz, yw1], [gz, yw0], [-gz, yw0]];
      poly2(c, pts, DARK, DARK, 12); poly2(gmc.rear, pts, '#fff');
    } else {                                                   // saloon / coupe
      tail(1); tail(-1);
      const sg2 = look.quadExhaust ? 2 : 1;
      if (look.rearBumperDark) R2(c, -w, yb + 0.02, w, yb + 0.22, '#15171a'); else for (const sg of [1, -1]) lowT(sg);
      plate(c, 0, yT - 0.3, 0.5, 0.11);
      L2(c, -0.12 * w, yT - 0.05, 0.12 * w, yT - 0.05, CHROME, 4);
      if (look.exhaust) for (const sg of [1, -1]) circ(c, sg * 0.62 * w, yb + 0.05, 0.04, '#222', CHROME, 3);
      if (look.tailBar) { L2(c, -0.52 * w, yT - 0.12, 0.52 * w, yT - 0.12, RED, 8); }
    }
  }

  // ---------------------------------------------------------------- top (x, z)
  {
    const c = g.top, m = gmc.top;
    // windshield
    const zA = zs(7.0), zB = zs(8.02), wsPts = [];
    for (let z = zA; z <= zB; z += 0.03) wsPts.push([vx(-f.WT(z) * 0.9), tz(z)]);
    for (let z = zB; z >= zA; z -= 0.03) wsPts.push([vx(f.WT(z) * 0.9), tz(z)]);
    wsPts.sort(() => 0);
    const left = [], right = [];
    for (let z = zA; z <= zB; z += 0.03) { left.push([vx(-f.WT(z) * 0.9 * (0.86 + 0.14 * ((z - zA) / (zB - zA)))), tz(z)]); right.push([vx(f.WT(z) * 0.9 * (0.86 + 0.14 * ((z - zA) / (zB - zA)))), tz(z)]); }
    const ws = left.concat(right.reverse());
    poly(c, ws, DARK, trimCol, 0.03 * pxf); poly(m, ws, '#fff');
    for (const sg of [-1, 1]) line(c, vx(sg * 0.02), tz(zB - 0.04), vx(sg * 0.5), tz(zA + 0.14), '#101214', 3);        // wipers
    // rear window (only on saloons and coupes; hatch / SUV / van have glass on the vertical tail)
    if (!look.rearOnTail) {
      const zr0 = look.winRear ? zs(look.winRear[1]) + 0.02 : zs(2.62), zr1 = zs(look.winRear ? look.winRear[0] : 4.0) - 0.0, pl = [], pr = [];
      for (let z = zr0; z <= zr1; z += 0.03) { const t = (z - zr0) / (zr1 - zr0); pl.push([vx(-f.WT(z) * (0.74 + 0.16 * t)), tz(z)]); pr.push([vx(f.WT(z) * (0.74 + 0.16 * t)), tz(z)]); }
      const rw = pl.concat(pr.reverse());
      poly(c, rw, DARK, trimCol, 0.03 * pxf); poly(m, rw, '#fff');
    }
    if (look.roof) { /* roof colour comes from the accent colour on the roof panel region */ }
    if (look.roofCol) {                                      // contrasting roof (Mini)
      const z0 = zs(4.0) + 0.02, z1 = zs(7.0) - 0.02;
      const pts = []; for (let z = z0; z <= z1; z += 0.04) pts.push([vx(-f.WT(z) * 1.2), tz(z)]); for (let z = z1; z >= z0; z -= 0.04) pts.push([vx(f.WT(z) * 1.2), tz(z)]);
      poly(c, pts, look.roofCol);
      // paint the roof strip down the sides too so there is no body-coloured edge
    }
    for (const sp of look.stripeSt || []) {                   // racing stripes
      const z0 = zs(sp[0]), z1 = zs(sp[1]);
      for (const sg of [-1, 1]) rect(c, vx(sg * (look.stripeX || 0.14) - 0.045), tz(z1), vx(sg * (look.stripeX || 0.14) + 0.045), tz(z0), look.stripeCol || '#f2f2f4');
    }
    if (look.hoodVents) for (const sg of [-1, 1]) poly(c, [[vx(sg * 0.18), tz(zs(10.3))], [vx(sg * 0.42), tz(zs(10.15))], [vx(sg * 0.42), tz(zs(9.4))], [vx(sg * 0.18), tz(zs(9.5))]], DARK, CHROME, 2);
    if (look.hoodBulge) { for (const sg of [-1, 1]) rect(c, vx(sg * 0.2 - 0.12), tz(zs(10.4)), vx(sg * 0.2 + 0.12), tz(zs(9.2)), 'rgba(0,0,0,0.0)'); }
    if (look.hoodSlot) rect(c, vx(-0.4), tz(zs(10.0)), vx(0.4), tz(zs(10.1)), DARK);
    for (const z of [zs(10.0)]) if (look.hoodShutLines !== false) { line(c, vx(-f.WT(z)), tz(z + 0.9), vx(f.WT(z)), tz(z + 0.9), 'rgba(8,8,10,0.0)', 1); }
    // hood and boot shut lines
    const hz0 = zs(8.1), hz1 = zmax - 0.08;
    line(c, vx(-f.WT(hz0)), tz(hz0), vx(f.WT(hz0)), tz(hz0), 'rgba(8,8,10,0.85)', 0.01 * pxm);
    line(c, vx(-f.WT(hz0) * 0.97), tz(hz0), vx(-f.WT(hz1) * 0.97), tz(hz1), 'rgba(8,8,10,0.85)', 0.01 * pxm);
    line(c, vx(f.WT(hz0) * 0.97), tz(hz0), vx(f.WT(hz1) * 0.97), tz(hz1), 'rgba(8,8,10,0.85)', 0.01 * pxm);
    if (!d.bed && !look.noBoot) {
      const bz0 = look.winRear ? zs(look.winRear[1]) - 0.02 : zs(2.58), bz1 = zmin + 0.08;
      line(c, vx(-f.WT(bz0) * 0.97), tz(bz0), vx(f.WT(bz0) * 0.97), tz(bz0), 'rgba(8,8,10,0.85)', 0.01 * pxm);
      line(c, vx(-f.WT(bz0) * 0.97), tz(bz0), vx(-f.WT(bz1) * 0.97), tz(bz1), 'rgba(8,8,10,0.85)', 0.01 * pxm);
      line(c, vx(f.WT(bz0) * 0.97), tz(bz0), vx(f.WT(bz1) * 0.97), tz(bz1), 'rgba(8,8,10,0.85)', 0.01 * pxm);
    }
  }
  return { cv, gm, lm, Z0, ZL };
}

// ------------------------------------------------------------------ textures
function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas); t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (srgb) { t.colorSpace = THREE.SRGBColorSpace; t.premultiplyAlpha = true; }
  return t;
}
function packMasks(gm) {                                  // four glass masks into one RGBA texture (side, front, rear, top)
  const out = document.createElement('canvas'); out.width = out.height = S;
  const c = out.getContext('2d'), img = c.createImageData(S, S), ch = ['side', 'front', 'rear', 'top'];
  const src = ch.map((k) => gm[k].getContext('2d').getImageData(0, 0, S, S).data);
  for (let i = 0; i < S * S; i++) for (let k = 0; k < 4; k++) img.data[i * 4 + k] = src[k][i * 4];
  return { data: img.data, canvas: (() => { const t = document.createElement('canvas'); t.width = t.height = S; t.getContext('2d').putImageData(img, 0, 0); return t; })() };
}
function packLamp(lm) {
  const t = document.createElement('canvas'); t.width = t.height = S; const c = t.getContext('2d'), img = c.createImageData(S, S);
  const a = lm.front.getContext('2d').getImageData(0, 0, S, S).data, b = lm.rear.getContext('2d').getImageData(0, 0, S, S).data;
  for (let i = 0; i < S * S; i++) { img.data[i * 4] = a[i * 4]; img.data[i * 4 + 1] = b[i * 4]; img.data[i * 4 + 3] = 255; }
  c.putImageData(img, 0, 0); return t;
}

// ------------------------------------------------------------------ the skinned shell
export class Shell {
  constructor(car, paint, crackTex, scene) {
    const d = this.d = car.def; this.car = car; this.scene = scene;
    const geo = buildShellGeometry(d);
    const P = paintCar(d), masks = packMasks(P.gm);
    this.Z0 = P.Z0; this.ZL = P.ZL; this.P = P;
    // rest normals
    const nv = geo.pos.length / 3, rn = new Float32Array(nv * 3);
    for (let i = 0; i < geo.idx.length; i += 3) {
      const a = geo.idx[i], b = geo.idx[i + 1], c = geo.idx[i + 2];
      const ux = geo.pos[b * 3] - geo.pos[a * 3], uy = geo.pos[b * 3 + 1] - geo.pos[a * 3 + 1], uz = geo.pos[b * 3 + 2] - geo.pos[a * 3 + 2];
      const vx = geo.pos[c * 3] - geo.pos[a * 3], vy = geo.pos[c * 3 + 1] - geo.pos[a * 3 + 1], vz = geo.pos[c * 3 + 2] - geo.pos[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { rn[v * 3] += nx; rn[v * 3 + 1] += ny; rn[v * 3 + 2] += nz; }
    }
    for (let v = 0; v < nv; v++) { const l = Math.hypot(rn[v * 3], rn[v * 3 + 1], rn[v * 3 + 2]) || 1; rn[v * 3] /= l; rn[v * 3 + 1] /= l; rn[v * 3 + 2] /= l; }
    // sign: make normals point away from the car's vertical centre line
    { let s = 0; for (let v = 0; v < nv; v += 7) { const x = geo.pos[v * 3], y = geo.pos[v * 3 + 1] - 0.7; if (Math.abs(x) > 0.5) s += rn[v * 3] * x > 0 ? 1 : -1; } if (s < 0) for (let k = 0; k < rn.length; k++) rn[k] = -rn[k]; }
    // classify triangles as glass using the painted masks
    const glassAt = (p, n, x, y, z) => {
      let u, v, ch;
      if (p === 0) { u = (z - P.Z0) / P.ZL; v = y / H; ch = 0; } else if (p === 1) { u = x / (2 * WH) + 0.5; v = y / H; ch = 1; } else if (p === 2) { u = x / (2 * WH) + 0.5; v = y / H; ch = 2; } else { u = x / (2 * WH) + 0.5; v = (z - P.Z0) / P.ZL; ch = 3; }
      const px = Math.max(0, Math.min(S - 1, Math.floor(u * S))), py = Math.max(0, Math.min(S - 1, Math.floor((1 - v) * S)));
      return masks.data[(py * S + px) * 4 + ch] > 128;
    };
    const bodyTris = [], glassTris = [];
    for (let i = 0; i < geo.idx.length; i += 3) {
      const a = geo.idx[i], b = geo.idx[i + 1], c = geo.idx[i + 2];
      const cx = (geo.pos[a * 3] + geo.pos[b * 3] + geo.pos[c * 3]) / 3, cy = (geo.pos[a * 3 + 1] + geo.pos[b * 3 + 1] + geo.pos[c * 3 + 1]) / 3, cz = (geo.pos[a * 3 + 2] + geo.pos[b * 3 + 2] + geo.pos[c * 3 + 2]) / 3;
      const nx = rn[a * 3] + rn[b * 3] + rn[c * 3], ny = rn[a * 3 + 1] + rn[b * 3 + 1] + rn[c * 3 + 1], nz = rn[a * 3 + 2] + rn[b * 3 + 2] + rn[c * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      const trimmed = geo.trim[a] > 0.5;
      (!trimmed && glassAt(proj(nx / l, ny / l, nz / l), 0, cx, cy, cz) ? glassTris : bodyTris).push(a, b, c);
    }
    // build the two meshes (glass gets its own vertices so it can be skinned to the glass panels)
    this.body = this.makePart(geo, rn, bodyTris, false);
    this.glass = this.makePart(geo, rn, glassTris, true);
    this.bindSkin(this.body, car, false); this.bindSkin(this.glass, car, true);

    const bedUni = d.bed ? new THREE.Vector4(geo.zmin + 0.12, Z4(d) + 0.06, 0.93 * d.WB[1], d.YR[1] - 0.02) : new THREE.Vector4(1e9, 1e9, 0, 0);
    this.uniforms = {
      uSide: { value: tex(P.cv.side, true) }, uFront: { value: tex(P.cv.front, true) }, uRear: { value: tex(P.cv.rear, true) }, uTop: { value: tex(P.cv.top, true) },
      uLamp: { value: tex(packLamp(P.lm), false) }, uZ0: { value: P.Z0 }, uZL: { value: P.ZL }, uH: { value: H }, uWH: { value: WH }, uBed: { value: bedUni },
      uHead: { value: 0 }, uTail: { value: 0.25 }, uPaint: { value: new THREE.Color(...paint) }, uRoof: { value: d.look && d.look.roof ? new THREE.Color(...d.look.roof) : null },
    };
    const mat = this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.45, side: THREE.DoubleSide });
    mat.color.setRGB(paint[0], paint[1], paint[2]);
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'attribute vec3 aRest; attribute vec3 aRestN; attribute float aTrim; attribute float aDmg;\nvarying vec3 vRest; varying vec3 vRestN; varying float vTrim; varying float vDmg;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRest = aRest; vRestN = aRestN; vTrim = aTrim; vDmg = aDmg;');
      sh.fragmentShader = 'uniform sampler2D uSide, uFront, uRear, uTop, uLamp; uniform float uZ0, uZL, uH, uWH, uHead, uTail; uniform vec4 uBed;\nvarying vec3 vRest; varying vec3 vRestN; varying float vTrim; varying float vDmg;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float lampH = 0.0, lampT = 0.0;
        {
          vec3 rn = normalize(vRestN); vec3 rp = vRest; vec4 t = vec4(0.0); vec2 uv;
          if (abs(rn.x) > 0.55 && abs(rn.x) >= abs(rn.y)) { t = texture2D(uSide, vec2((rp.z - uZ0) / uZL, rp.y / uH)); }
          else if (rn.y > 0.42) { t = texture2D(uTop, vec2(rp.x / (2.0 * uWH) + 0.5, (rp.z - uZ0) / uZL)); }
          else if (rn.z > 0.0) { uv = vec2(rp.x / (2.0 * uWH) + 0.5, rp.y / uH); t = texture2D(uFront, uv); lampH = texture2D(uLamp, uv).r; }
          else { uv = vec2(rp.x / (2.0 * uWH) + 0.5, rp.y / uH); t = texture2D(uRear, uv); lampT = texture2D(uLamp, uv).g; }
          diffuseColor.rgb = diffuseColor.rgb * (1.0 - t.a) + t.rgb;
          if (vTrim > 0.5 || rn.y < -0.4) diffuseColor.rgb = vec3(0.02);
          if (rp.z > uBed.x && rp.z < uBed.y && abs(rp.x) < uBed.z && rp.y < uBed.w && rn.y > -0.4) diffuseColor.rgb = vec3(0.035);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05), clamp(vDmg * 0.85, 0.0, 1.0));
        }`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += lampH * uHead * vec3(1.0, 0.95, 0.75) * 1.4 + lampT * uTail * vec3(0.95, 0.04, 0.03);`);
    };
    this.bodyMesh = new THREE.Mesh(this.body.geo, mat); this.bodyMesh.frustumCulled = false; this.bodyMesh.castShadow = true;
    const gmat = new THREE.MeshPhongMaterial({ color: 0x17262f, transparent: true, opacity: 0.5, specular: 0xffffff, shininess: 140, depthWrite: false, side: THREE.DoubleSide });
    this.glassMesh = new THREE.Mesh(this.glass.geo, gmat); this.glassMesh.frustumCulled = false; this.glassMesh.renderOrder = 2;
    const cmat = new THREE.MeshBasicMaterial({ map: crackTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.crackMesh = new THREE.Mesh(this.glass.geo, cmat); this.crackMesh.frustumCulled = false; this.crackMesh.renderOrder = 3;
    scene.add(this.bodyMesh, this.glassMesh, this.crackMesh);
    this.sig = ''; this.frame = 0; this.anyGone = false;
  }

  makePart(geo, rn, tris, isGlass) {
    const map = new Map(), pos = [], rest = [], nrm = [], trim = [], idx = [];
    for (const v of tris) {
      let k = map.get(v);
      if (k === undefined) { k = pos.length / 3; map.set(v, k); pos.push(geo.pos[v * 3], geo.pos[v * 3 + 1], geo.pos[v * 3 + 2]); rest.push(geo.pos[v * 3], geo.pos[v * 3 + 1], geo.pos[v * 3 + 2]); nrm.push(rn[v * 3], rn[v * 3 + 1], rn[v * 3 + 2]); trim.push(geo.trim[v]); }
      idx.push(k);
    }
    const g = new THREE.BufferGeometry(), n = pos.length / 3;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aRest', new THREE.BufferAttribute(new Float32Array(rest), 3));
    g.setAttribute('aRestN', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('aTrim', new THREE.BufferAttribute(new Float32Array(trim), 1));
    g.setAttribute('aDmg', new THREE.BufferAttribute(new Float32Array(n), 1));
    if (isGlass) {                                                       // crack overlay colours + planar uvs
      const col = new Float32Array(n * 4), uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], nx = nrm[i * 3], ny = nrm[i * 3 + 1];
        if (Math.abs(nx) > 0.55 && Math.abs(nx) >= Math.abs(ny)) { uv[i * 2] = z * 0.9; uv[i * 2 + 1] = y * 0.9; } else { uv[i * 2] = x * 0.9; uv[i * 2 + 1] = z * 0.9; }
        col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const full = new Uint32Array(idx);
    const index = new THREE.BufferAttribute(new Uint32Array(idx), 1); g.setIndex(index);
    return { geo: g, n, full, index, owner: new Int16Array(n), nodes: new Int16Array(n * 4), w: new Float32Array(n * 4), res: new Float32Array(n * 3), tri: full };
  }

  bindSkin(part, car, isGlass) {
    const lx = car.lx, ly = car.ly, lz = car.lz, panels = car.panels;
    this.pcount = panels.length;
    const cells = [];                                                    // every panel cell with its four rest corner positions
    panels.forEach((p, pi) => {
      if (!!p.glass !== isGlass) return;
      for (let r = 0; r + 1 < p.rows; r++) for (let c = 0; c + 1 < p.cols; c++) {
        const ids = [p.nodes[r * p.cols + c], p.nodes[r * p.cols + c + 1], p.nodes[(r + 1) * p.cols + c], p.nodes[(r + 1) * p.cols + c + 1]];
        let cx = 0, cy = 0, cz = 0; for (const i of ids) { cx += lx[i]; cy += ly[i]; cz += lz[i]; }
        cells.push({ pi, ids, cx: cx / 4, cy: cy / 4, cz: cz / 4 });
      }
    });
    const pos = part.geo.attributes.position.array, W = [0, 0, 0, 0];
    for (let v = 0; v < part.n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let best = 1e9, bc = cells[0];
      for (const c of cells) { const dd = (c.cx - x) ** 2 + (c.cy - y) ** 2 + (c.cz - z) ** 2; if (dd < best) { best = dd; bc = c; } }
      const [A, B, C, D] = bc.ids;
      let u = 0.5, t = 0.5;
      for (let it = 0; it < 5; it++) {                                   // fit the bilinear patch to the vertex
        const px = (1 - u) * (1 - t) * lx[A] + u * (1 - t) * lx[B] + (1 - u) * t * lx[C] + u * t * lx[D] - x;
        const py = (1 - u) * (1 - t) * ly[A] + u * (1 - t) * ly[B] + (1 - u) * t * ly[C] + u * t * ly[D] - y;
        const pz = (1 - u) * (1 - t) * lz[A] + u * (1 - t) * lz[B] + (1 - u) * t * lz[C] + u * t * lz[D] - z;
        const dux = (1 - t) * (lx[B] - lx[A]) + t * (lx[D] - lx[C]), duy = (1 - t) * (ly[B] - ly[A]) + t * (ly[D] - ly[C]), duz = (1 - t) * (lz[B] - lz[A]) + t * (lz[D] - lz[C]);
        const dtx = (1 - u) * (lx[C] - lx[A]) + u * (lx[D] - lx[B]), dty = (1 - u) * (ly[C] - ly[A]) + u * (ly[D] - ly[B]), dtz = (1 - u) * (lz[C] - lz[A]) + u * (lz[D] - lz[B]);
        const a11 = dux * dux + duy * duy + duz * duz + 1e-6, a12 = dux * dtx + duy * dty + duz * dtz, a22 = dtx * dtx + dty * dty + dtz * dtz + 1e-6;
        const b1 = -(dux * px + duy * py + duz * pz), b2 = -(dtx * px + dty * py + dtz * pz), det = a11 * a22 - a12 * a12 || 1e-9;
        u += (b1 * a22 - b2 * a12) / det * 0.8; t += (a11 * b2 - a12 * b1) / det * 0.8;
        u = Math.max(-0.3, Math.min(1.3, u)); t = Math.max(-0.3, Math.min(1.3, t));
      }
      W[0] = (1 - u) * (1 - t); W[1] = u * (1 - t); W[2] = (1 - u) * t; W[3] = u * t;
      let ax = 0, ay = 0, az = 0;
      for (let k = 0; k < 4; k++) { part.nodes[v * 4 + k] = bc.ids[k]; part.w[v * 4 + k] = W[k]; ax += W[k] * lx[bc.ids[k]]; ay += W[k] * ly[bc.ids[k]]; az += W[k] * lz[bc.ids[k]]; }
      part.res[v * 3] = x - ax; part.res[v * 3 + 1] = y - ay; part.res[v * 3 + 2] = z - az;
      part.owner[v] = bc.pi;
    }
  }

  skin(part, car) {
    const { rx, ry, rz } = car, L = car.left, U = car.up, F = car.fwd, pos = part.geo.attributes.position.array;
    for (let v = 0; v < part.n; v++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) { const n = part.nodes[v * 4 + k], w = part.w[v * 4 + k]; x += w * rx[n]; y += w * ry[n]; z += w * rz[n]; }
      const a = part.res[v * 3], b = part.res[v * 3 + 1], c = part.res[v * 3 + 2];
      pos[v * 3] = x + L[0] * a + U[0] * b + F[0] * c; pos[v * 3 + 1] = y + L[1] * a + U[1] * b + F[1] * c; pos[v * 3 + 2] = z + L[2] * a + U[2] * b + F[2] * c;
    }
    part.geo.attributes.position.needsUpdate = true;
  }

  // called every frame after car.syncRender()
  update(car, nd, showBeams) {
    this.frame++;
    // which panels are missing / flying loose decides which triangles are drawn
    let sig = '';
    const state = new Uint8Array(car.panels.length);
    car.panels.forEach((p, i) => { state[i] = p.gone ? (p.deb ? 1 : 2) : 0; sig += state[i]; });
    if (sig !== this.sig) {
      this.sig = sig; this.anyGone = /[12]/.test(sig);
      for (const part of [this.body, this.glass]) {
        const out = []; const t = part.full, o = part.owner;
        for (let i = 0; i < t.length; i += 3) {
          const a = o[t[i]], b = o[t[i + 1]], c = o[t[i + 2]], sa = state[a], sb = state[b], sc = state[c];
          if (sa === 2 || sb === 2 || sc === 2) continue;
          if ((sa === 1 || sb === 1 || sc === 1) && !(a === b && b === c)) continue;
          out.push(t[i], t[i + 1], t[i + 2]);
        }
        const arr = part.index.array;           // the GPU buffer cannot be resized, so rewrite the same array and shorten the draw range
        for (let k = 0; k < out.length; k++) arr[k] = out[k];
        part.index.needsUpdate = true; part.geo.setDrawRange(0, out.length);
      }
    }
    this.skin(this.body, car); this.skin(this.glass, car);
    this.body.geo.computeVertexNormals(); this.glass.geo.computeVertexNormals();
    if (nd && this.frame % 4 === 0) {
      const dm = this.body.geo.attributes.aDmg.array, pt = this.body;
      for (let v = 0; v < pt.n; v++) { let s = 0; for (let k = 0; k < 4; k++) s += pt.w[v * 4 + k] * nd[pt.nodes[v * 4 + k]]; dm[v] = s; }
      this.body.geo.attributes.aDmg.needsUpdate = true;
      const col = this.glass.geo.attributes.color.array, g = this.glass;
      for (let v = 0; v < g.n; v++) { const p = car.panels[g.owner[v]]; col[v * 4 + 3] = Math.min(1, Math.max(0, (p.crack - 0.08) * 1.5)); }
      this.glass.geo.attributes.color.needsUpdate = true;
    }
    this.mat.transparent = showBeams; this.mat.opacity = showBeams ? 0.3 : 1;
  }

  setLights(head, brake) { this.uniforms.uHead.value = head; this.uniforms.uTail.value = 0.2 + 0.8 * brake; }

  dispose() {
    for (const m of [this.bodyMesh, this.glassMesh, this.crackMesh]) { this.scene.remove(m); }
    this.body.geo.dispose(); this.glass.geo.dispose(); this.mat.dispose();
    for (const k of ['uSide', 'uFront', 'uRear', 'uTop', 'uLamp']) this.uniforms[k].value.dispose();
  }
}

function Z4(d) { return d.Z[3] + (d.Z[4] - d.Z[3]) * 0.1; }
