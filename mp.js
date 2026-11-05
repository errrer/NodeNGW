// Peer-to-peer multiplayer (WebRTC via PeerJS). Every player simulates their own car; the others are shown as "ghosts":
// a Car rebuilt from the sender's node positions (so dents, torn panels and cracked glass show), skinned with the same Shell.
// Ghost nodes push on our nodes (Car.ghostForces), and the same happens on the other side, so cars collide.
import * as THREE from 'three';
import { Car } from './physics.js';
import { Shell } from './shell.js';

const SEND_HZ = 15, DELAY = 0.13, MAX_PLAYERS = 6, K = 2048;
const PEER_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const toBuf = (x) => (x instanceof ArrayBuffer ? x : x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function loadPeerLib() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PEER_SRC; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the networking library'));
    document.head.appendChild(s);
  });
}

export function createMP(ctx) {
  const { scene, camera, getCar, COLORS, makeWheel, crackTexture, toast } = ctx;
  const ghosts = new Map();           // peer id -> Ghost
  const conns = new Map();            // peer id -> DataConnection
  let peer = null, code = '', isHost = false, myId = '', seq = 0, sendAcc = 0, status = 'Not connected';
  let nameStr = ''; try { nameStr = localStorage.getItem('nodengw.name') || ''; } catch (e) { /* ignore */ }
  if (!nameStr) nameStr = 'Driver' + Math.floor(100 + Math.random() * 900);
  const listeners = [];
  const changed = () => { for (const f of listeners) f(); };

  // ------------------------------------------------------------ ghost car
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  class Ghost {
    constructor(id) {
      this.id = id; this.name = 'Player'; this.car = null; this.shell = null; this.wheels = []; this.snaps = []; this.key = ''; this.ci = -1;
      this.tag = document.createElement('div');
      Object.assign(this.tag.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', color: '#fff', font: '600 13px system-ui, sans-serif', textShadow: '0 1px 4px #000, 0 0 2px #000', whiteSpace: 'nowrap', zIndex: 5, display: 'none' });
      document.body.appendChild(this.tag);
    }
    ensure(key, ci) {
      if (this.car && this.key === key && this.ci === ci) return;
      this.disposeCar();
      const car = this.car = new Car(key); car.reset(0, 0, 0);
      this.shell = new Shell(car, COLORS[ci] || COLORS[0], crackTexture(), scene);
      this.wheels = car.wheels.map(() => makeWheel(car.def));
      this.dmg = new Float32Array(car.NN); this.key = key; this.ci = ci; this.snaps.length = 0;
      this.prevT = 0;
      for (const w of this.wheels) w.visible = false;
    }
    disposeCar() {
      if (this.shell) { this.shell.dispose(); this.shell = null; }
      for (const w of this.wheels) scene.remove(w);
      this.wheels = []; this.car = null; this.snaps.length = 0;
    }
    dispose() { this.disposeCar(); this.tag.remove(); }
    push(m, now) {
      this.name = m.n || this.name;
      this.ensure(m.k, m.c | 0);
      const s = { t: now, com: m.com, pos: new Int16Array(toBuf(m.p)), dmg: new Uint8Array(toBuf(m.d)), pg: new Uint8Array(toBuf(m.g)), pc: new Uint8Array(toBuf(m.x)), deb: new Float32Array(toBuf(m.b)), w: new Float32Array(toBuf(m.w)), fl: m.f | 0 };
      if (s.pos.length !== this.car.NN * 3) return;
      if (!this.snaps.length) {   // first sight of this player: if we spawned on top of each other, one of us moves aside
        const car = getCar(), dx = s.com[0] - car.com[0], dz = s.com[2] - car.com[2];
        if (Math.hypot(dx, dz) < 7 && myId > this.id) car.reset(car.com[0] + 8 * (1 + (conns.size > 1 ? Math.floor(Math.random() * 3) : 0)), car.com[2] + 3 * Math.floor(Math.random() * 3), car.yaw);
      }
      this.snaps.push(s); if (this.snaps.length > 8) this.snaps.shift();
    }
    update(now, dt) {
      const car = this.car; if (!car || !this.snaps.length) return;
      const rt = now - DELAY, S = this.snaps;
      let A = S[0], B = S[0];
      for (let i = 0; i < S.length; i++) { if (S[i].t <= rt) A = S[i]; if (S[i].t >= rt) { B = S[i]; break; } B = S[i]; }
      const a = B.t > A.t ? clamp((rt - A.t) / (B.t - A.t), 0, 1) : 1;
      const { px, py, pz, vx, vy, vz } = car, NN = car.NN, inv = 1 / Math.max(dt, 1e-3);
      const first = !this.prevT; this.prevT = now;
      for (let i = 0; i < NN; i++) {
        const x = (A.com[0] + A.pos[i * 3] / K) * (1 - a) + (B.com[0] + B.pos[i * 3] / K) * a;
        const y = (A.com[1] + A.pos[i * 3 + 1] / K) * (1 - a) + (B.com[1] + B.pos[i * 3 + 1] / K) * a;
        const z = (A.com[2] + A.pos[i * 3 + 2] / K) * (1 - a) + (B.com[2] + B.pos[i * 3 + 2] / K) * a;
        if (first) { vx[i] = vy[i] = vz[i] = 0; } else { vx[i] += ((x - px[i]) * inv - vx[i]) * 0.5; vy[i] += ((y - py[i]) * inv - vy[i]) * 0.5; vz[i] += ((z - pz[i]) * inv - vz[i]) * 0.5; }
        px[i] = x; py[i] = y; pz[i] = z;
      }
      car.computeFrame();
      // panels: gone / cracked / flying debris
      const nearer = a > 0.5 ? B : A;
      car.panels.forEach((p, i) => {
        const g = B.pg[i];
        if (g && !p.gone) {
          p.gone = true;
          if (!p.glass) {
            const n = p.nodes.length, local = new Float32Array(n * 3); let cx = 0, cy = 0, cz = 0;
            for (const k of p.nodes) { cx += px[k]; cy += py[k]; cz += pz[k]; } cx /= n; cy /= n; cz /= n;
            p.nodes.forEach((k, j) => { local[j * 3] = px[k] - cx; local[j * 3 + 1] = py[k] - cy; local[j * 3 + 2] = pz[k] - cz; });
            p.deb = { panel: p, pos: [cx, cy, cz], vel: [0, 0, 0], q: [0, 0, 0, 1], local, n };
          }
        } else if (!g && p.gone) { p.gone = false; p.deb = null; }
        p.crack = nearer.pc[i] / 255;
      });
      for (let o = 0; o + 7 < B.deb.length; o += 8) {
        const p = car.panels[B.deb[o] | 0]; if (!p || !p.deb) continue;
        p.deb.pos[0] = B.deb[o + 1]; p.deb.pos[1] = B.deb[o + 2]; p.deb.pos[2] = B.deb[o + 3];
        p.deb.q[0] = B.deb[o + 4]; p.deb.q[1] = B.deb[o + 5]; p.deb.q[2] = B.deb[o + 6]; p.deb.q[3] = B.deb[o + 7];
      }
      for (let i = 0; i < NN; i++) this.dmg[i] = nearer.dmg[i] / 255;
      car.steerAngle = B.w[0]; car.braking = B.fl & 1 ? 1 : 0; car.reverse = !!(B.fl & 2);
      car.wheels.forEach((w, k) => { w.spin = B.w[1 + k]; w.flat = B.w[5 + k]; w.detached = !!(B.w[9] & (1 << k)); });
      car.syncRender();
      this.shell.update(car, this.dmg, false);
      this.shell.setLights(B.fl & 4 ? 1 : 0, B.fl & 1 ? 1 : 0);
      // wheels
      const fwd = V(car.fwd), left = V(car.left), up = V(car.up), s = car.steerAngle, cs = Math.cos(s), sn = Math.sin(s);
      const fS = fwd.clone().multiplyScalar(cs).addScaledVector(left, sn), lS = left.clone().multiplyScalar(cs).addScaledVector(fwd, -sn);
      car.wheels.forEach((w, k) => {
        const g = this.wheels[k]; g.visible = true;
        g.position.set(px[w.i], py[w.i], pz[w.i]);
        if (w.detached) {
          if (Math.hypot(vx[w.i], vz[w.i]) > 0.3) w.hd = Math.atan2(vx[w.i], vz[w.i]);
          const h = w.hd === undefined ? 0 : w.hd;
          _m.makeBasis(new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(h), 0, Math.cos(h)));
        } else if (w.front) _m.makeBasis(lS, up, fS); else _m.makeBasis(left, up, fwd);
        g.quaternion.setFromRotationMatrix(_m);
        g.userData.spin.rotation.x = w.spin;
        g.scale.set(1, 1 - 0.18 * (w.flat || 0), 1);
      });
      // name tag
      const v = new THREE.Vector3(car.com[0], car.com[1] + 1.7, car.com[2]).project(camera);
      const dist = Math.hypot(car.com[0] - camera.position.x, car.com[1] - camera.position.y, car.com[2] - camera.position.z);
      if (v.z < 1 && dist < 250 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
        this.tag.style.display = 'block';
        this.tag.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * innerWidth) + 'px,' + ((-v.y * 0.5 + 0.5) * innerHeight) + 'px) translate(-50%,-100%)';
        this.tag.textContent = this.name + (dist > 15 ? '  ' + Math.round(dist) + ' m' : '');
      } else this.tag.style.display = 'none';
    }
  }

  // ------------------------------------------------------------ sending our car
  function pack() {
    const car = getCar(); if (!car) return null;
    const NN = car.NN, c = car.com, pos = new Int16Array(NN * 3), dmg = new Uint8Array(NN);
    for (let i = 0; i < NN; i++) {
      pos[i * 3] = clamp(Math.round((car.px[i] - c[0]) * K), -32767, 32767); pos[i * 3 + 1] = clamp(Math.round((car.py[i] - c[1]) * K), -32767, 32767); pos[i * 3 + 2] = clamp(Math.round((car.pz[i] - c[2]) * K), -32767, 32767);
      dmg[i] = Math.round(clamp(car.nodeDmg[i], 0, 1) * 255);
    }
    const np = car.panels.length, pg = new Uint8Array(np), pc = new Uint8Array(np);
    car.panels.forEach((p, i) => { pg[i] = p.gone ? 1 : 0; pc[i] = Math.round(clamp(p.crack, 0, 1) * 255); });
    const deb = []; for (const d of car.debris) { const i = car.panels.indexOf(d.panel); if (i >= 0) deb.push(i, d.pos[0], d.pos[1], d.pos[2], d.q[0], d.q[1], d.q[2], d.q[3]); }
    const w = new Float32Array(10); w[0] = car.steerAngle; let mask = 0;
    car.wheels.forEach((wh, k) => { w[1 + k] = wh.spin; w[5 + k] = wh.flat || 0; if (wh.detached) mask |= 1 << k; }); w[9] = mask;
    const fl = (car.braking > 0.1 ? 1 : 0) | (car.reverse ? 2 : 0) | (ctx.lightsOn() ? 4 : 0);
    return { t: 's', n: nameStr, k: car.key, c: ctx.getColor(), com: [c[0], c[1], c[2]], p: pos.buffer, d: dmg.buffer, g: pg.buffer, x: pc.buffer, b: new Float32Array(deb).buffer, w: w.buffer, f: fl, q: ++seq };
  }
  function broadcast(msg) { for (const c of conns.values()) if (c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }

  // ------------------------------------------------------------ connections
  function setupConn(conn) {
    conn.on('open', () => {
      if (conns.size >= MAX_PLAYERS - 1) { try { conn.send({ t: 'full' }); } catch (e) { /* ignore */ } setTimeout(() => conn.close(), 200); return; }
      conns.set(conn.peer, conn);
      if (!ghosts.has(conn.peer)) ghosts.set(conn.peer, new Ghost(conn.peer));
      conn.send({ t: 'h', n: nameStr });
      if (isHost) conn.send({ t: 'peers', list: [...conns.keys()].filter((k) => k !== conn.peer) });
      status = (isHost ? 'Hosting ' : 'In room ') + code + ' · ' + (conns.size + 1) + ' players';
      changed();
    });
    conn.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      const g = ghosts.get(conn.peer);
      if (m.t === 's') { if (g) g.push(m, performance.now() / 1000); }
      else if (m.t === 'h') { if (g) { const first = g.name === 'Player'; g.name = String(m.n || 'Player').slice(0, 16); if (first) toast(g.name + ' joined'); } changed(); }
      else if (m.t === 'peers') { for (const id of m.list || []) if (id !== myId && !conns.has(id)) setupConn(peer.connect(id, { reliable: true })); }
      else if (m.t === 'full') { toast('That room is full'); leave(); }
    });
    const gone = () => {
      if (conns.get(conn.peer) !== conn && conns.has(conn.peer)) return;
      conns.delete(conn.peer);
      const g = ghosts.get(conn.peer); if (g) { toast(g.name + ' left'); g.dispose(); ghosts.delete(conn.peer); }
      if (peer) status = (isHost ? 'Hosting ' : 'In room ') + code + ' · ' + (conns.size + 1) + ' players';
      changed();
    };
    conn.on('close', gone); conn.on('error', gone);
  }
  function newPeer(id) {
    return loadPeerLib().then(() => new Promise((res, rej) => {
      const o = Object.assign({ debug: 0 }, window.NODENGW_PEER || {});
      const p = id ? new window.Peer(id, o) : new window.Peer(o);
      p.on('open', () => res(p)); p.on('error', (e) => rej(e));
    }));
  }
  function hookPeer(p) {
    peer = p; myId = p.id;
    p.on('connection', (c) => setupConn(c));
    p.on('disconnected', () => { try { p.reconnect(); } catch (e) { /* ignore */ } });
    p.on('error', (e) => { toast('Network: ' + (e.type || e.message || 'error')); });
  }
  async function host() {
    leave(); status = 'Creating room…'; changed();
    for (let tries = 0; tries < 6; tries++) {
      code = ''; for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      try { const p = await newPeer('nodengw-' + code + '-h'); isHost = true; hookPeer(p); status = 'Hosting ' + code + ' · 1 player'; changed(); return; }
      catch (e) { if (e && e.type !== 'unavailable-id') { status = 'Could not connect (' + (e.type || e.message) + ')'; code = ''; changed(); return; } }
    }
    status = 'Could not create a room'; code = ''; changed();
  }
  async function join(c) {
    c = String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (c.length !== 4) { toast('Enter the 4-letter room code'); return; }
    leave(); status = 'Joining ' + c + '…'; changed();
    try {
      const p = await newPeer(null); isHost = false; code = c; hookPeer(p);
      const conn = p.connect('nodengw-' + c + '-h', { reliable: true });
      setupConn(conn);
      setTimeout(() => { if (!conns.size && peer === p) { status = 'No room ' + c + ' found'; leave(true); } }, 9000);
    } catch (e) { status = 'Could not connect (' + (e.type || e.message) + ')'; changed(); }
  }
  function leave(keepStatus) {
    for (const c of conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    conns.clear();
    for (const g of ghosts.values()) g.dispose();
    ghosts.clear();
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } peer = null; }
    code = ''; isHost = false; if (!keepStatus) status = 'Not connected';
    const car = getCar(); if (car) car.ghosts = [];
    changed();
  }

  // ------------------------------------------------------------ per-frame
  function update(dt) {
    const now = performance.now() / 1000;
    for (const g of ghosts.values()) g.update(now, dt);
    const car = getCar();
    if (car) car.ghosts = [...ghosts.values()].filter((g) => g.car && g.snaps.length);
    if (conns.size) {
      sendAcc += dt;
      if (sendAcc >= 1 / SEND_HZ) { sendAcc = 0; const m = pack(); if (m) broadcast(m); }
    }
  }

  // ------------------------------------------------------------ menu UI
  function buildUI(anchor) {
    const css = document.createElement('style');
    css.textContent = '#mp{display:flex;flex-direction:column;gap:8px}#mp .r{display:flex;gap:8px;flex-wrap:wrap;align-items:center}#mp input{background:#ffffff14;color:#fff;border:2px solid #ffffff22;border-radius:10px;padding:7px 12px;font:inherit;width:130px}#mp input.code{width:80px;text-transform:uppercase;letter-spacing:3px;text-align:center}#mp .st{font-size:13px;opacity:.85}#mp .pl{font-size:13px;opacity:.9}';
    document.head.appendChild(css);
    const h = document.createElement('h3'); h.textContent = 'Multiplayer';
    const box = document.createElement('div'); box.id = 'mp';
    box.innerHTML = '<div class="r"><input id="mpName" maxlength="16" placeholder="Your name"><button class="pill" id="mpHost">Host room</button></div>' +
      '<div class="r"><input id="mpCode" class="code" maxlength="4" placeholder="CODE"><button class="pill" id="mpJoin">Join</button><button class="pill" id="mpLeave">Leave</button></div>' +
      '<div class="st" id="mpStatus"></div><div class="pl" id="mpPlayers"></div>';
    anchor.parentNode.insertBefore(h, anchor); anchor.parentNode.insertBefore(box, anchor);
    const $ = (id) => document.getElementById(id);
    $('mpName').value = nameStr;
    $('mpName').oninput = (e) => { nameStr = e.target.value.trim().slice(0, 16) || nameStr; try { localStorage.setItem('nodengw.name', nameStr); } catch (er) { /* ignore */ } };
    $('mpName').onkeydown = $('mpCode').onkeydown = (e) => e.stopPropagation();
    $('mpName').onkeyup = $('mpCode').onkeyup = (e) => e.stopPropagation();
    $('mpHost').onclick = () => host();
    $('mpJoin').onclick = () => join($('mpCode').value);
    $('mpLeave').onclick = () => leave();
    const refresh = () => {
      $('mpStatus').textContent = status + (isHost && code ? ' — share this code with friends' : '');
      $('mpPlayers').textContent = peer ? 'Players: ' + nameStr + ' (you)' + [...ghosts.values()].map((g) => ', ' + g.name).join('') : '';
    };
    listeners.push(refresh); refresh();
    const params = new URLSearchParams(location.search), room = params.get('room');
    if (room) { $('mpCode').value = room.toUpperCase().slice(0, 4); status = 'Press Join to enter room ' + $('mpCode').value; refresh(); }
  }

  return { buildUI, update, host, join, leave, count: () => ghosts.size, info: () => [...ghosts.values()].map((g) => [g.name, g.key, g.ci, g.car && g.car.com.map((v) => +v.toFixed(1))]) };
}
