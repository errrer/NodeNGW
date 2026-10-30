import * as THREE from 'three';
import { Car, FACES, OBSTACLES, terrainHeight, WR, WORLD_HALF } from './physics.js';

// ------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb8e0);
scene.fog = new THREE.Fog(0x8fb8e0, 120, 320);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 600);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x556644, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// ------------------------------------------------------------ terrain
{
  const SIZE = WORLD_HALF * 2 + 10, SEG = 400;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainHeight(x, z);
    pos.setY(i, h);
    const r = Math.hypot(x, z), k = Math.min(1, Math.max(0, (r - 125) / 40));
    const n = 0.9 + 0.1 * Math.sin(x * 0.7) * Math.sin(z * 0.6);
    const c = [0.55 * (1 - k) + 0.3 * k, 0.55 * (1 - k) + 0.48 * k, 0.56 * (1 - k) + 0.25 * k];
    col[i * 3] = c[0] * n; col[i * 3 + 1] = c[1] * n; col[i * 3 + 2] = c[2] * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 128, 128);
  cx.strokeStyle = '#c4c4c4'; cx.lineWidth = 3; cx.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(SIZE / 10, SIZE / 10);
  tex.anisotropy = 8;
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex }));
  m.receiveShadow = true;
  scene.add(m);
}

// ------------------------------------------------------------ obstacles
const MAT = {
  wall: new THREE.MeshLambertMaterial({ color: 0xb0aaa0 }),
  pillar: new THREE.MeshLambertMaterial({ color: 0xe0a020 }),
  crate: new THREE.MeshLambertMaterial({ color: 0x9a6a38 }),
  barrier: new THREE.MeshLambertMaterial({ color: 0xcfcfcf }),
};
for (const o of OBSTACLES) {
  const w = o.max[0] - o.min[0], h = o.max[1] - o.min[1], d = o.max[2] - o.min[2];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT[o.kind] || MAT.wall);
  m.position.set(o.min[0] + w / 2, o.min[1] + h / 2, o.min[2] + d / 2);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

// ------------------------------------------------------------ car visuals
const car = new Car();

const triIdx = [], triCol = [];
for (const f of FACES) {
  const [a, b, c, d] = f.q;
  for (const t of [[a, b, c], [a, c, d]]) for (const v of t) { triIdx.push(v); triCol.push(...f.col); }
}
const bodyGeo = new THREE.BufferGeometry();
bodyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triIdx.length * 3), 3));
bodyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(triCol), 3));
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.3 });
const body = new THREE.Mesh(bodyGeo, bodyMat);
body.castShadow = true; body.frustumCulled = false;
scene.add(body);

const wheelGroups = car.wheels.map(() => {
  const g = new THREE.Group();
  const tg = new THREE.CylinderGeometry(WR, WR, 0.28, 24); tg.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0x151515 }));
  const rg = new THREE.CylinderGeometry(WR * 0.62, WR * 0.62, 0.3, 16); rg.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.3 }));
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.07), new THREE.MeshLambertMaterial({ color: 0x444444 }));
  const spoke2 = spoke.clone(); spoke2.rotation.x = Math.PI / 2;
  const spin = new THREE.Group(); spin.add(tyre, rim, spoke, spoke2);
  spin.traverse((o) => { o.castShadow = true; });
  g.add(spin); g.userData.spin = spin;
  scene.add(g);
  return g;
});

// beam debug view
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(car.NB * 6), 3));
lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(car.NB * 6), 3));
const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
lines.frustumCulled = false; lines.visible = false; lines.renderOrder = 10;
scene.add(lines);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function updateVisuals() {
  const bp = bodyGeo.attributes.position.array;
  for (let i = 0; i < triIdx.length; i++) {
    const n = triIdx[i];
    bp[i * 3] = car.px[n]; bp[i * 3 + 1] = car.py[n]; bp[i * 3 + 2] = car.pz[n];
  }
  bodyGeo.attributes.position.needsUpdate = true;
  bodyGeo.computeVertexNormals();

  const fwd = V(car.fwd), left = V(car.left), up = V(car.up);
  const s = car.steerAngle, cs = Math.cos(s), sn = Math.sin(s);
  const fS = fwd.clone().multiplyScalar(cs).addScaledVector(left, sn);
  const lS = left.clone().multiplyScalar(cs).addScaledVector(fwd, -sn);
  car.wheels.forEach((w, k) => {
    const g = wheelGroups[k];
    g.position.set(car.px[w.i], car.py[w.i], car.pz[w.i]);
    if (w.front) _m.makeBasis(lS, up, fS); else _m.makeBasis(left, up, fwd);
    g.quaternion.setFromRotationMatrix(_m);
    g.userData.spin.rotation.x = w.spin;
  });

  if (lines.visible) {
    const p = lineGeo.attributes.position.array, c = lineGeo.attributes.color.array;
    for (let q = 0; q < car.NB; q++) {
      const a = car.ba[q], b = car.bb[q], o = q * 6;
      if (car.broken[q]) { p.fill(0, o, o + 6); continue; }
      p[o] = car.px[a]; p[o + 1] = car.py[a]; p[o + 2] = car.pz[a];
      p[o + 3] = car.px[b]; p[o + 4] = car.py[b]; p[o + 5] = car.pz[b];
      const t = Math.min(1, Math.abs(car.strain[q]) * 20), dent = Math.min(1, Math.abs(car.bL0[q] - car.bL00[q]) / car.bL00[q] * 12);
      const r = Math.max(t, dent), g = 0.7 * (1 - r), bl = 1 - r;
      c[o] = c[o + 3] = 0.2 + 0.8 * r; c[o + 1] = c[o + 4] = g; c[o + 2] = c[o + 5] = bl;
    }
    lineGeo.attributes.position.needsUpdate = true; lineGeo.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------ input
const keys = {};
const touch = { up: 0, down: 0, left: 0, right: 0, hand: 0 };
let camMode = 0, slow = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true; audioInit();
  if (e.code === 'KeyR') car.reset(car.com[0], car.com[2], car.yaw);
  if (e.code === 'KeyT') car.reset(0, 0, 0);
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyB') { lines.visible = !lines.visible; bodyMat.transparent = lines.visible; bodyMat.opacity = lines.visible ? 0.3 : 1; bodyMat.needsUpdate = true; }
  if (e.code === 'KeyV') slow = !slow;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
for (const b of document.querySelectorAll('[data-t]')) {
  const k = b.dataset.t;
  const on = (e) => { e.preventDefault(); touch[k] = 1; audioInit(); };
  const off = (e) => { e.preventDefault(); touch[k] = 0; };
  b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
}
document.getElementById('btnReset').onclick = () => car.reset(car.com[0], car.com[2], car.yaw);
document.getElementById('btnCam').onclick = () => { camMode = (camMode + 1) % 3; };

function readInput() {
  const L = keys.KeyA || keys.ArrowLeft || touch.left, R = keys.KeyD || keys.ArrowRight || touch.right;
  return {
    up: !!(keys.KeyW || keys.ArrowUp || touch.up),
    down: !!(keys.KeyS || keys.ArrowDown || touch.down),
    hand: !!(keys.Space || touch.hand),
    steer: (L ? 1 : 0) - (R ? 1 : 0),   // +1 = steer left
  };
}

// ------------------------------------------------------------ audio (engine + crunch)
let ac, osc, og, noiseBuf;
function audioInit() {
  if (ac) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    osc = ac.createOscillator(); osc.type = 'sawtooth';
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    og = ac.createGain(); og.gain.value = 0.0;
    osc.connect(lp); lp.connect(og); og.connect(ac.destination); osc.start();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  } catch (e) { ac = null; }
}
let lastCrunch = 0;
function crunch(v) {
  if (!ac || ac.currentTime - lastCrunch < 0.12) return; lastCrunch = ac.currentTime;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = noiseBuf; g.gain.value = Math.min(0.5, v * 6);
  s.connect(g); g.connect(ac.destination); s.start();
}
function audioUpdate(inp) {
  if (!ac) return;
  const f = 45 + Math.abs(car.forwardSpeed) * 2.4 + (inp.up ? 30 : 0);
  osc.frequency.setTargetAtTime(Math.min(f, 260), ac.currentTime, 0.08);
  og.gain.setTargetAtTime(0.035 + (inp.up ? 0.03 : 0), ac.currentTime, 0.1);
}

// ------------------------------------------------------------ loop
const hud = { speed: document.getElementById('speed'), dmg: document.getElementById('dmg'), bar: document.getElementById('dmgbar'), brk: document.getElementById('brk') };
const camPos = new THREE.Vector3(0, 6, -12), camLook = new THREE.Vector3();
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  const inp = readInput();
  car.plastic = 0;
  car.advance(dt * (slow ? 0.2 : 1), inp);
  if (car.plastic > 0.01) crunch(car.plastic);
  audioUpdate(inp);

  const c = car.com;
  if (Math.abs(c[0]) > WORLD_HALF || Math.abs(c[2]) > WORLD_HALF || c[1] < -30) car.reset(0, 0, 0);

  updateVisuals();

  // camera
  const fwd = V(car.fwd), cc = V(c);
  const fl = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
  const k = 1 - Math.exp(-dt * 4);
  if (camMode === 0) {          // chase
    const target = cc.clone().addScaledVector(fl, -9).add(new THREE.Vector3(0, 3.6, 0));
    camPos.lerp(target, k);
    camPos.y = Math.max(camPos.y, terrainHeight(camPos.x, camPos.z) + 1);
    camera.position.copy(camPos);
    camLook.lerp(cc.clone().addScaledVector(fl, 4).add(new THREE.Vector3(0, 1, 0)), 1 - Math.exp(-dt * 8));
    camera.lookAt(camLook);
  } else if (camMode === 1) {   // bonnet / driver
    const p = new THREE.Vector3((car.px[18] + car.px[19]) / 2, (car.py[18] + car.py[19]) / 2 - 0.1, (car.pz[18] + car.pz[19]) / 2);
    camera.position.copy(p);
    camera.lookAt(p.clone().addScaledVector(fwd, 10));
    camPos.copy(p); camLook.copy(p);
  } else {                      // far / TV
    const target = cc.clone().add(new THREE.Vector3(18, 14, -18));
    camPos.lerp(target, 1 - Math.exp(-dt * 1.5));
    camera.position.copy(camPos);
    camera.lookAt(cc);
    camLook.copy(cc);
  }

  sun.position.set(c[0] + 50, c[1] + 80, c[2] + 30);
  sun.target.position.set(c[0], c[1], c[2]);

  const dmg = car.damage;
  hud.speed.textContent = Math.round(car.speed * 3.6);
  hud.dmg.textContent = dmg.toFixed(0) + '%';
  hud.bar.style.width = dmg + '%';
  hud.brk.textContent = car.brokenCount;

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
