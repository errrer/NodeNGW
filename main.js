import * as THREE from 'three';
import { Car, VEHICLES, OBSTACLES, TREES, BALLS, RAMPS, terrainHeight, onRamp, resetBalls, WATER, WORLD_HALF, st as stn, ENG, CORE as CORE_N, FUEL as FUEL_N } from './physics.js';
import { Particles, Skids } from './fx.js';
import { Shell } from './shell.js';

// ------------------------------------------------------------ settings
const COLORS = [[0.72, 0.07, 0.1], [0.1, 0.3, 0.85], [0.95, 0.75, 0.1], [0.1, 0.6, 0.3], [0.9, 0.9, 0.92], [0.07, 0.07, 0.09], [0.95, 0.4, 0.05], [0.62, 0.64, 0.68], [0.04, 0.5, 0.42]];
const COLOR_NAMES = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'orange', 'silver', 'teal'];
const store = {
  get(k, d) { try { const v = localStorage.getItem('nodengw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('nodengw.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const settings = { vehicle: store.get('vehicle', 'sedan'), color: store.get('color', 0), time: store.get('time', 'day'), quality: store.get('quality', 'high'), units: store.get('units', 'kmh') };
if (!VEHICLES[settings.vehicle]) settings.vehicle = 'sedan';
const best = store.get('best', { jump: 0, air: 0, speed: 0 });

// ------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd8f0, 110, 330);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 700);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdfeeff, 0x556644, 1.0);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sun.shadow.bias = -0.0004;
scene.add(hemi, sun, sun.target);

const QUALITY = { low: { pr: 1, shadow: false, map: 512 }, med: { pr: 1.5, shadow: true, map: 1024 }, high: { pr: 2, shadow: true, map: 2048 } };
function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.high; settings.quality = name in QUALITY ? name : 'high'; store.set('quality', settings.quality);
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q.shadow; sun.castShadow = q.shadow;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(q.map, q.map);
  scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
}
const speedVal = (ms) => ms * (settings.units === 'mph' ? 2.23694 : 3.6);

// sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, stars: { value: 0 } },
  vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float stars;
    float h(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
    void main(){ vec3 d=normalize(vP); float t=pow(clamp(d.y,0.0,1.0),0.55); vec3 c=mix(hor,top,t);
      float s=max(dot(d,normalize(sunDir)),0.0); c+=sunCol*(pow(s,400.0)*2.0+pow(s,12.0)*0.25);
      if(stars>0.0){ vec3 q=floor(d*220.0); float r=h(q); if(r>0.9965 && d.y>0.02) c+=vec3(1.0)*stars*(r-0.9965)*250.0; }
      gl_FragColor=vec4(c,1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
sky.renderOrder = -1; sky.frustumCulled = false;
scene.add(sky);

const TIMES = {
  day: { top: 0x3f7fd6, hor: 0xbcd8f0, fog: 0xbcd8f0, sunDir: [0.5, 0.7, 0.35], sunCol: 0xfff4e0, sunI: 2.4, hemiSky: 0xdfeeff, hemiGround: 0x556644, hemiI: 1.0, stars: 0, lights: false },
  sunset: { top: 0x2a3f7a, hor: 0xf0a070, fog: 0xdc9a80, sunDir: [0.9, 0.14, 0.3], sunCol: 0xff9050, sunI: 1.9, hemiSky: 0x8090c0, hemiGround: 0x504030, hemiI: 0.7, stars: 0, lights: false },
  night: { top: 0x02040a, hor: 0x0b1426, fog: 0x0b1426, sunDir: [-0.3, 0.55, 0.4], sunCol: 0x7a98d0, sunI: 0.5, hemiSky: 0x2a3a60, hemiGround: 0x101820, hemiI: 0.55, stars: 1, lights: true },
};
let sunDir = new THREE.Vector3(0.5, 0.7, 0.35), nightMode = false;
function applyTime(name) {
  const t = TIMES[name] || TIMES.day; settings.time = name in TIMES ? name : 'day'; store.set('time', settings.time);
  skyMat.uniforms.top.value.set(t.top); skyMat.uniforms.hor.value.set(t.hor);
  skyMat.uniforms.sunCol.value.set(t.sunCol); skyMat.uniforms.stars.value = t.stars;
  sunDir.set(...t.sunDir).normalize(); skyMat.uniforms.sunDir.value.copy(sunDir);
  scene.fog.color.set(t.fog);
  sun.color.set(t.sunCol); sun.intensity = t.sunI;
  hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround); hemi.intensity = t.hemiI;
  nightMode = t.lights;
}

// ------------------------------------------------------------ terrain
{
  const SIZE = WORLD_HALF * 2 + 10, SEG = 400;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const hs = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) hs[i] = terrainHeight(pos.getX(i), pos.getZ(i));
  for (let i = 0; i < pos.count; i++) pos.setY(i, hs[i]);
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    const k = Math.min(1, Math.max(0, (r - 125) / 40));
    const n = 0.9 + 0.1 * Math.sin(x * 0.7) * Math.sin(z * 0.6) + 0.05 * Math.sin(x * 0.13 + z * 0.17);
    let c = [0.5 * (1 - k) + 0.27 * k, 0.51 * (1 - k) + 0.44 * k, 0.53 * (1 - k) + 0.2 * k];
    const steep = 1 - nrm.getY(i);
    if (steep > 0.12 && k > 0.2) { const s = Math.min(1, (steep - 0.12) * 5); c = [c[0] * (1 - s) + 0.45 * s, c[1] * (1 - s) + 0.4 * s, c[2] * (1 - s) + 0.33 * s]; }
    { const dl = Math.hypot(x - WATER.x, z - WATER.z); if (dl < WATER.r + 1.5) { const s = Math.min(1, (WATER.r + 1.5 - dl) / 4); c = [c[0] * (1 - s) + 0.72 * s, c[1] * (1 - s) + 0.65 * s, c[2] * (1 - s) + 0.45 * s]; } }
    if (onRamp(x, z)) { const stripe = Math.floor(z / 2) % 2 === 0; c = stripe ? [0.92, 0.62, 0.12] : [0.28, 0.28, 0.3]; }
    col[i * 3] = c[0] * n; col[i * 3 + 1] = c[1] * n; col[i * 3 + 2] = c[2] * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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

// ------------------------------------------------------------ obstacles + trees + balls
function stripeTex(a, b, rx, ry) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d'); c.fillStyle = a; c.fillRect(0, 0, 64, 64); c.fillStyle = b;
  for (let i = -64; i < 128; i += 32) { c.beginPath(); c.moveTo(i, 64); c.lineTo(i + 16, 64); c.lineTo(i + 80, 0); c.lineTo(i + 64, 0); c.fill(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t;
}
const MAT = {
  wall: new THREE.MeshLambertMaterial({ color: 0xb0aaa0 }),
  pillar: new THREE.MeshLambertMaterial({ map: stripeTex('#e8b020', '#202020', 1, 4) }),
  crate: new THREE.MeshLambertMaterial({ color: 0x9a6a38 }),
  barrier: new THREE.MeshLambertMaterial({ map: stripeTex('#d8d8d8', '#c03030', 6, 1) }),
  tree: new THREE.MeshLambertMaterial({ color: 0x5a3a1e }),
  pole: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.6, roughness: 0.45 }),
  block: new THREE.MeshLambertMaterial({ color: 0x777b80 }),
  blade: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.9, roughness: 0.2 }),
};
for (const o of OBSTACLES) {
  if (o.kind === 'tree') continue;
  const w = o.max[0] - o.min[0], h = o.max[1] - o.min[1], d = o.max[2] - o.min[2];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT[o.kind] || MAT.wall);
  m.position.set(o.min[0] + w / 2, o.min[1] + h / 2, o.min[2] + d / 2);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
{
  const N = TREES.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 8), MAT.tree, N);
  const c1 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 3.2, 9), new THREE.MeshLambertMaterial({ color: 0x1f5a2a }), N);
  const c2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.2, 2.8, 9), new THREE.MeshLambertMaterial({ color: 0x286a32 }), N);
  const m = new THREE.Matrix4();
  TREES.forEach((t, i) => {
    const s = t.s;
    m.compose(new THREE.Vector3(t.x, t.y + 1.2 * s, t.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(t.x, t.y + 3.5 * s, t.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); c1.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(t.x, t.y + 5.1 * s, t.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); c2.setMatrixAt(i, m);
  });
  for (const x of [trunk, c1, c2]) { x.castShadow = true; scene.add(x); }
}
const BALL_COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#9b5de5', '#f15bb5', '#00bbf9', '#ffffff', '#ff7b00', '#3a86ff'];
const ballMeshes = BALLS.map((b) => {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 128, 64);
  c.fillStyle = BALL_COLORS[b.color % BALL_COLORS.length];
  for (let i = 0; i < 128; i += 32) c.fillRect(i, 0, 16, 64);
  const m = new THREE.Mesh(new THREE.SphereGeometry(b.r, 24, 16), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.5, metalness: 0.05 }));
  m.castShadow = true; scene.add(m); return m;
});

const water = new THREE.Mesh(new THREE.CircleGeometry(WATER.rw, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a78b8, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.1, depthWrite: false }));
water.position.set(WATER.x, WATER.y, WATER.z); scene.add(water);
const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x222222 })); rope.frustumCulled = false; scene.add(rope);
const ropeBall = BALLS.findIndex((b) => b.rope);

// ------------------------------------------------------------ fx
const particles = new Particles(scene);
const skids = new Skids(scene);

// ------------------------------------------------------------ car visuals
let car, body, bodyGeo, bodyMat, nodeKind, baseCol, wheelGroups = [], lines, lineGeo;
let shell = null, ribbons = [], details = [], faceRecs = [], bodyIdxAttr, glassIdxAttr, lastBroken = -1;
let engineMesh, engineNodes = [], glassMesh, tintMesh, glassGeo, glassPanels = [], frameMesh, frameBeams = [], interior = [];
let headMeshes = [], tailMeshes = [], headLights = [];
const GLASS = [0.08, 0.13, 0.18], DARK = [0.06, 0.06, 0.07], PRIMER = [0.14, 0.13, 0.13], CHROME = [0.62, 0.64, 0.67];
let showBeams = false;

function disposeCar() {
  if (!car) return;
  scene.remove(body); bodyGeo.dispose(); bodyMat.dispose();
  scene.remove(glassMesh); scene.remove(tintMesh); glassGeo.dispose();
  scene.remove(frameMesh); frameMesh.geometry.dispose();
  scene.remove(engineMesh); engineMesh.geometry.dispose();
  for (const it of interior) scene.remove(it.mesh);
  for (const dd of details) scene.remove(dd.mesh);
  if (shell) { shell.dispose(); shell = null; }
  for (const m of debrisMeshes) scene.remove(m);
  for (const g of wheelGroups) scene.remove(g);
  scene.remove(lines); lineGeo.dispose();
  for (const m of headMeshes.concat(tailMeshes)) scene.remove(m);
  for (const l of headLights) { scene.remove(l); scene.remove(l.target); }
}
const debrisMeshes = [];

let _crackTex;
function crackTexture() {
  if (_crackTex) return _crackTex;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(235,245,255,0.95)'; c.lineCap = 'round';
  let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let w = 0; w < 3; w++) {                        // a few impact points, each a star of cracks with a spider web around it
    const cx = S * (0.2 + 0.6 * R()), cy = S * (0.2 + 0.6 * R()), n = 9 + (R() * 6) | 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.3; let x = cx, y = cy, len = S * (0.25 + 0.5 * R());
      c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y);
      for (let s = 0; s < 6; s++) { const st = len / 6; x += Math.cos(a + (R() - 0.5) * 0.5) * st; y += Math.sin(a + (R() - 0.5) * 0.5) * st; c.lineTo(x, y); }
      c.stroke();
    }
    for (let r = 1; r <= 4; r++) {
      const rad = r * S * 0.07; c.lineWidth = 1; c.beginPath();
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, rr = rad * (0.85 + 0.3 * R()); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
    }
  }
  _crackTex = new THREE.CanvasTexture(cv); _crackTex.anisotropy = 4;
  return _crackTex;
}

function buildCar(key) {
  const prev = car ? [car.com[0], car.com[2], car.yaw] : [0, 0, 0];
  disposeCar();
  car = new Car(key);
  car.reset(prev[0], prev[1], prev[2]);
  settings.vehicle = key; store.set('vehicle', key);
  const paint = COLORS[settings.color] || COLORS[0];

  const NN = car.NN;
  nodeKind = new Uint8Array(NN); baseCol = new Float32Array(NN * 3);
  const bodyIdx = [], glassIdxArr = [];
  for (const f of car.faces) {
    const [a, b, c, d] = f.q;
    const col = f.col === 'paint' ? paint : f.col === 'accent' ? (car.def.look.roof || paint) : f.col === 'glass' ? GLASS : f.col === 'chrome' ? CHROME : DARK;
    for (const n of f.q) { baseCol.set(col, n * 3); nodeKind[n] = (f.col === 'paint' || f.col === 'accent') ? 0 : f.col === 'glass' ? 1 : 2; }
    (f.col === 'glass' ? glassIdxArr : bodyIdx).push(a, b, c, a, c, d);
  }
  bodyGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(NN * 3), 3);
  bodyGeo.setAttribute('position', posAttr);
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(baseCol), 3));
  const bq = new Map();
  for (let q = 0; q < car.NB; q++) bq.set(Math.min(car.ba[q], car.bb[q]) * 4096 + Math.max(car.ba[q], car.bb[q]), q);
  faceRecs = car.faces.map((f) => {
    const be = [];
    for (let k = 0; k < 4; k++) { const a = f.q[k], b = f.q[(k + 1) % 4], q = bq.get(Math.min(a, b) * 4096 + Math.max(a, b)); if (q !== undefined) be.push(q); }
    return { q: f.q, glass: f.col === 'glass', panel: f.panel, beams: be };
  });
  bodyIdxAttr = new THREE.BufferAttribute(new Uint32Array(bodyIdx.length), 1); bodyGeo.setIndex(bodyIdxAttr);
  lastBroken = -1;
  bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.38, metalness: 0.4, transparent: showBeams, opacity: showBeams ? 0.3 : 1 });
  body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true; body.frustumCulled = false;
  scene.add(body);

  // glass: tinted see-through panes + a crack overlay whose strength follows how strained each pane is
  glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', posAttr);
  const gUV = new Float32Array(NN * 2);
  glassPanels = car.panels.filter((p) => p.glass);
  for (const p of glassPanels) p.nodes.forEach((n, k) => { const r = Math.floor(k / p.cols), c = k % p.cols; gUV[n * 2] = c / (p.cols - 1); gUV[n * 2 + 1] = r / (p.rows - 1); });
  glassGeo.setAttribute('uv', new THREE.BufferAttribute(gUV, 2));
  glassGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NN * 4), 4));
  glassIdxAttr = new THREE.BufferAttribute(new Uint32Array(glassIdxArr.length), 1); glassGeo.setIndex(glassIdxAttr);
  tintMesh = new THREE.Mesh(glassGeo, new THREE.MeshPhongMaterial({ color: 0x1b2c3a, transparent: true, opacity: 0.55, specular: 0xffffff, shininess: 120, depthWrite: false, side: THREE.DoubleSide }));
  tintMesh.frustumCulled = false; tintMesh.renderOrder = 2;
  glassMesh = new THREE.Mesh(glassGeo, new THREE.MeshBasicMaterial({ map: crackTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  glassMesh.frustumCulled = false; glassMesh.renderOrder = 3;
  scene.add(tintMesh, glassMesh);

  // exposed frame: ring edges and rails as steel tubes (hidden under the panels until they come off)
  const bmap = new Map();
  for (let q = 0; q < car.NB; q++) bmap.set(Math.min(car.ba[q], car.bb[q]) * 4096 + Math.max(car.ba[q], car.bb[q]), q);
  frameBeams = [];
  const addFB = (a, b, w) => { const q = bmap.get(Math.min(a, b) * 4096 + Math.max(a, b)); if (q !== undefined) frameBeams.push({ a, b, q, w }); };
  for (let sIdx = 0; sIdx < 12; sIdx++) {
    for (let k = 0; k < 5; k++) addFB(stn(sIdx, k), stn(sIdx, k + 1), 0.035);
    if (sIdx < 11) for (let k = 0; k < 6; k++) addFB(stn(sIdx, k), stn(sIdx + 1, k), k === 0 || k === 5 ? 0.05 : 0.035);
  }
  frameMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.5 }), frameBeams.length);
  frameMesh.frustumCulled = false; frameMesh.castShadow = true; frameMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(frameMesh);

  // interior and mechanicals, anchored to the spine nodes so they move with the crumpling shell
  const d = car.def, Zs = d.Z, bx = (w, h, l, color, met) => new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: met || 0 }));
  interior = [];
  const nearSt = (z) => { let bs = 0, bd = 1e9; for (let i = 0; i < 12; i++) { const dd = Math.abs(Zs[i] - z); if (dd < bd) { bd = dd; bs = i; } } return bs; };
  const addIt = (mesh, x, y, z, tilt = 0, node = -1) => {
    const anchor = node >= 0 ? node : CORE_N + nearSt(z);
    const off = node >= 0 ? [0, 0, 0] : [x, y - car.ly[anchor], z - car.lz[anchor]];
    mesh.castShadow = false; mesh.frustumCulled = false; scene.add(mesh);
    interior.push({ mesh, anchor, off, tq: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt) });
  };
  const SEAT = 0x2b2b30, TRIM = 0x1b1b1f;
  const zf = Zs[5] - 0.1, zr = Zs[3] + 0.15, yf = d.YF[5] + 0.3, yr = d.YF[3] + 0.3;
  for (const sx of [0.36, -0.36]) {
    addIt(bx(0.46, 0.14, 0.5, SEAT), sx, yf, zf); addIt(bx(0.46, 0.55, 0.11, SEAT), sx, yf + 0.3, zf - 0.27, -0.15);
  }
  addIt(bx(1.3, 0.14, 0.45, SEAT), 0, yr, zr); addIt(bx(1.3, 0.5, 0.1, SEAT), 0, yr + 0.27, zr - 0.25, -0.15);
  const zd = Zs[7] + 0.2, yd = d.YB[7] - 0.03;
  addIt(bx(1.35, 0.24, 0.36, TRIM), 0, yd, zd);
  addIt(bx(1.3, 0.05, 0.3, 0x2a2a30), 0, yd + 0.14, zd - 0.02);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }));
  addIt(wheel, 0.36, yd + 0.02, zd - 0.28, -1.05);
  {   // deformable engine: sump, block, cam cover drawn from the 16 engine nodes
    const eg = new THREE.BufferGeometry(), E = car.engine, ids = [];
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3 / 4 * 3), 3));
    const colL = [[0.16, 0.17, 0.18], [0.3, 0.32, 0.34], [0.45, 0.47, 0.5], [0.55, 0.14, 0.1]], cols = new Float32Array(16 * 3);
    for (let L = 0; L < 4; L++) for (let c = 0; c < 4; c++) cols.set(colL[L], (L * 4 + c) * 3);
    for (let L = 0; L < 3; L++) for (let c = 0; c < 4; c++) { const a = L * 4 + c, b = L * 4 + (c + 1) % 4, a2 = a + 4, b2 = b + 4; ids.push(a, b, b2, a, b2, a2); }
    ids.push(0, 1, 2, 0, 2, 3, 12, 15, 14, 12, 14, 13);
    eg.setAttribute('color', new THREE.BufferAttribute(cols, 3)); eg.setIndex(ids);
    engineMesh = new THREE.Mesh(eg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }));
    engineMesh.frustumCulled = false; engineMesh.castShadow = true; engineNodes = [].concat(...E);
    scene.add(engineMesh);
  }
  addIt(bx(0.7, 0.2, 0.45, 0x2c2f31, 0.2), 0, 0, 0, 0, FUEL_N);
  addIt(bx(0.9, 0.38, 0.07, 0x1d1d20), 0, (d.YF[9] + d.YB[9]) / 2, Math.min(Zs[10] + 0.4, Zs[11] - 0.3));   // radiator, kept inside the nose
  addIt(bx(0.4, 0.14, 1.6, 0x4a4d50, 0.5), 0, d.YF[4] - 0.02, (Zs[3] + Zs[5]) / 2);

  const WR = car.WR;
  wheelGroups = car.wheels.map(() => {
    const g = new THREE.Group();
    const tw = car.def.tyreW || 0.26, rr = car.def.rim || 0.62;
    const tg = new THREE.CylinderGeometry(WR, WR, tw, 24); tg.rotateZ(Math.PI / 2);
    const tyre = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0x151515 }));
    const rg = new THREE.CylinderGeometry(WR * rr, WR * rr, tw + 0.02, 16); rg.rotateZ(Math.PI / 2);
    const rim = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.3 }));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.04, WR * 2 * rr * 0.95, 0.06), new THREE.MeshLambertMaterial({ color: 0x444444 }));
    const spoke2 = spoke.clone(); spoke2.rotation.x = Math.PI / 2;
    const spin = new THREE.Group(); spin.add(tyre, rim, spoke, spoke2);
    spin.traverse((o) => { o.castShadow = true; });
    g.add(spin); g.userData.spin = spin;
    scene.add(g);
    return g;
  });

  const lampG = new THREE.SphereGeometry(0.13, 10, 8);
  headMeshes = [0, 1].map(() => { const m = new THREE.Mesh(lampG, new THREE.MeshBasicMaterial({ color: 0xfff6d0 })); scene.add(m); return m; });
  tailMeshes = [0, 1].map(() => { const m = new THREE.Mesh(lampG, new THREE.MeshBasicMaterial({ color: 0x701010 })); scene.add(m); return m; });
  headMeshes.concat(tailMeshes).forEach((mm) => { mm.visible = false; });
  for (const dd of details) scene.remove(dd.mesh);
  details = [];
  {   // body details that ride on the panels (so they fall off with them)
    const pan = (name) => car.panels.find((p) => p.name === name);
    const addDet = (pname, r, c, off, mesh) => { const p = pan(pname); if (!p) return; mesh.frustumCulled = false; scene.add(mesh); details.push({ mesh, n: p.nodes[r * p.cols + c], off }); };
    const bxm = (w, h, l, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 }), plateMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.25 }), paintMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...paint), roughness: 0.38, metalness: 0.4 });
    const look = car.def.look || {}, W = car.def.WT[11], tall = car.def.YR[11] - car.def.YF[11] > 0.8;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.55 });
    const cyl = (r, l, mat) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 20).rotateX(Math.PI / 2), mat);
    const ring = (r, t, mat) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 24), mat);
    for (const sg of [1, -1]) {                         // headlamps
      const c = sg > 0 ? 0 : 4;
      if (look.lamp === 'round') {
        const mini = look.face === 'mini', R = mini ? 0.14 : 0.115, ox = mini ? 0.2 : 0.2, oy = mini ? -0.15 : -0.14;
        addDet('grille', 1, c, [sg * ox, oy, 0.035], cyl(R, 0.05, lampMat)); addDet('grille', 1, c, [sg * ox, oy, 0.055], ring(R, 0.022, chromeMat));
      } else {
        const h = tall ? 0.11 : 0.07;
        addDet('grille', 1, c, [sg * 0.27, -0.06, 0.03], bxm(0.34, h, 0.05, lampMat));
      }
    }
    addDet('tailPanel', 1, 0, [0.2, -0.08, -0.03], bxm(0.3, 0.12, 0.05, tailMeshes[1].material)); addDet('tailPanel', 1, 4, [-0.2, -0.08, -0.03], bxm(0.3, 0.12, 0.05, tailMeshes[0].material));
    addDet('grille', 0, 2, [0, 0.1, 0.045], bxm(0.5, 0.12, 0.012, plateMat)); addDet('tailPanel', 0, 2, [0, 0.1, -0.045], bxm(0.5, 0.12, 0.012, plateMat));
    {   // grille / face details per car
      const G = (r, c, off, mesh) => addDet('grille', r, c, off, mesh);
      const face = look.face;
      if (face === 'intake') {                         // slim upper grille, big black lower intake, badge
        G(1, 2, [0, -0.07, 0.03], bxm(W * 0.9, 0.05, 0.03, darkMat)); G(1, 2, [0, -0.07, 0.045], bxm(0.04, 0.04, 0.03, chromeMat)); G(1, 2, [0, -0.24, 0.03], bxm(W * 1.0, 0.1, 0.03, darkMat));
      } else if (face === 'mouth') {                   // wide sports-car mouth
        G(1, 2, [0, -0.2, 0.03], bxm(W * 1.2, 0.17, 0.03, darkMat));
        for (const y of [-0.16, -0.2, -0.24]) G(1, 2, [0, y, 0.045], bxm(W * 1.15, 0.012, 0.02, chromeMat));
      } else if (face === 'bars') {
        const n = tall ? 4 : 3, gap = tall ? 0.14 : 0.07, y0 = tall ? -0.12 : -0.08;
        for (let k = 0; k < n; k++) G(1, 2, [0, y0 - k * gap, 0.035], bxm(W * (tall ? 1.4 : 1.05), tall ? 0.07 : 0.025, 0.03, chromeMat));
        if (tall) G(1, 2, [0, y0 - gap * 1.5, 0.06], bxm(0.2, 0.07, 0.03, chromeMat));
      } else if (face === 'slots') {                   // seven vertical slots
        for (let k = -3; k <= 3; k++) G(1, 2, [k * W * 0.2, -0.22, 0.035], bxm(0.035, 0.24, 0.03, chromeMat));
        G(1, 2, [0, -0.08, 0.035], bxm(W * 1.3, 0.03, 0.03, chromeMat));
      } else if (face === 'mini') {                    // chrome-framed grille
        G(1, 2, [0, -0.08, 0.035], bxm(W * 0.9, 0.03, 0.03, chromeMat)); G(1, 2, [0, -0.3, 0.035], bxm(W * 0.9, 0.03, 0.03, chromeMat));
        for (const sg of [-1, 1]) G(1, 2, [sg * W * 0.45, -0.19, 0.035], bxm(0.03, 0.25, 0.03, chromeMat));
      }
    }
    for (const sd of ['L', 'R']) {
      const sg = sd === 'L' ? 1 : -1;
      addDet('door' + sd, 2, 4, [sg * 0.1, 0.1, 0.05], bxm(0.1, 0.1, 0.2, paintMat)); if (details.length) details[details.length - 1].keep = true;
      addDet('door' + sd, 2, 1, [sg * 0.03, -0.05, 0], bxm(0.025, 0.03, 0.14, chromeMat));
    }
  }

  for (const r of ribbons) scene.remove(r.mesh);
  ribbons = [];
  for (const pname of (car.def.look && car.def.look.stripes) || []) {   // racing stripes that follow the panel as it deforms
    const p = car.panels.find((q) => q.name === pname); if (!p) continue;
    for (const t of [0.4, 0.6]) {
      const geo = new THREE.BufferGeometry(), np = p.cols * 2, idx = [];
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(np * 3), 3));
      for (let c = 0; c + 1 < p.cols; c++) idx.push(c * 2, c * 2 + 1, c * 2 + 3, c * 2, c * 2 + 3, c * 2 + 2);
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf4f4f6, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      mesh.frustumCulled = false; scene.add(mesh); ribbons.push({ p, u0: t - 0.045, u1: t + 0.045, mesh });
    }
  }

  // the smooth textured shell replaces the blocky panel mesh; only the door mirrors stay as separate parts
  shell = new Shell(car, paint, crackTexture(), scene);
  body.visible = false; tintMesh.visible = false; glassMesh.visible = false;
  details = details.filter((dd) => { if (dd.keep) return true; scene.remove(dd.mesh); return false; });
  for (const r of ribbons) scene.remove(r.mesh);
  ribbons = [];

  headLights = [0, 1].map(() => {
    const l = new THREE.SpotLight(0xfff2d0, 0, 70, 0.55, 0.5, 1.2); scene.add(l); scene.add(l.target); return l;
  });

  lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(car.NB * 6), 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(car.NB * 6), 3));
  lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
  lines.frustumCulled = false; lines.visible = showBeams; lines.renderOrder = 10;
  scene.add(lines);
}

const _m = new THREE.Matrix4();
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
let frameCount = 0;

function nodePos(i) { return new THREE.Vector3(car.px[i], car.py[i], car.pz[i]); }

const _d = new THREE.Object3D(), _qa = new THREE.Quaternion(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function updateDebrisMeshes() {
  // each detached panel is drawn by the main body mesh (positions come from its rigid body), nothing extra needed
}
function updateVisuals() {
  car.syncRender();
  if (shell) { shell.update(car, car.updateNodeDamage(), showBeams); shell.setLights((nightMode || lightsOn) ? 1 : 0, car.braking > 0.1 ? 1 : 0); }
  const bp = bodyGeo.attributes.position.array, NN = car.NN;
  for (let n = 0; n < NN; n++) { bp[n * 3] = car.rx[n]; bp[n * 3 + 1] = car.ry[n]; bp[n * 3 + 2] = car.rz[n]; }
  bodyGeo.attributes.position.needsUpdate = true;
  bodyGeo.computeVertexNormals();
  glassGeo.computeVertexNormals();

  if (frameCount % 3 === 0) {   // faces whose edges have been cut or torn disappear (sliced panels, ripped sheet metal)
    const bc = car.brokenCount;
    if (bc !== lastBroken) {
      lastBroken = bc;
      let nb = 0, ng = 0; const bi = bodyIdxAttr.array, gi = glassIdxAttr.array;
      for (const f of faceRecs) {
        if (!(f.panel !== undefined && car.panels[f.panel].gone)) { let cut = false; for (const q of f.beams) if (car.broken[q]) { cut = true; break; } if (cut) continue; }
        const [a, b, c, d] = f.q, arr = f.glass ? gi : bi; let o = f.glass ? ng : nb;
        arr[o++] = a; arr[o++] = b; arr[o++] = c; arr[o++] = a; arr[o++] = c; arr[o++] = d;
        if (f.glass) ng = o; else nb = o;
      }
      bodyGeo.setDrawRange(0, nb); glassGeo.setDrawRange(0, ng);
      bodyIdxAttr.needsUpdate = true; glassIdxAttr.needsUpdate = true;
    }
  }
  if (frameCount % 4 === 0) {   // dent colouring and glass cracks
    const nd = car.updateNodeDamage(), cc = bodyGeo.attributes.color.array;
    for (let n = 0; n < NN; n++) {
      if (nodeKind[n] === 1) continue;
      const dm = nd[n], s = Math.min(1, dm * 0.8), tr = 0.08;
      for (let c = 0; c < 3; c++) cc[n * 3 + c] = baseCol[n * 3 + c] * (1 - s) + tr * s;
    }
    bodyGeo.attributes.color.needsUpdate = true;
    const gc = glassGeo.attributes.color.array;
    for (const p of glassPanels) {
      const al = Math.min(1, Math.max(0, (p.crack - 0.08) * 1.5));
      for (const n of p.nodes) { gc[n * 4] = gc[n * 4 + 1] = gc[n * 4 + 2] = 1; gc[n * 4 + 3] = al; }
    }
    glassGeo.attributes.color.needsUpdate = true;
  }

  // steel frame
  frameBeams.forEach((f, i) => {
    if (car.broken[f.q] || (shell && !shell.anyGone)) { _d.scale.set(0, 0, 0); _d.updateMatrix(); frameMesh.setMatrixAt(i, _d.matrix); return; }
    _pa.set(car.px[f.a], car.py[f.a], car.pz[f.a]); _pb.set(car.px[f.b], car.py[f.b], car.pz[f.b]);
    _d.position.copy(_pa).add(_pb).multiplyScalar(0.5); _d.lookAt(_pb); _d.scale.set(f.w, f.w, _pa.distanceTo(_pb)); _d.updateMatrix();
    frameMesh.setMatrixAt(i, _d.matrix);
  });
  frameMesh.instanceMatrix.needsUpdate = true;
  {
    const ep = engineMesh.geometry.attributes.position.array;
    engineNodes.forEach((n, i) => { ep[i * 3] = car.px[n]; ep[i * 3 + 1] = car.py[n]; ep[i * 3 + 2] = car.pz[n]; });
    engineMesh.geometry.attributes.position.needsUpdate = true; engineMesh.geometry.computeVertexNormals();
  }
  {
    const L = V(car.left), U = V(car.up), F = V(car.fwd);
    _m.makeBasis(L, U, F); _qa.setFromRotationMatrix(_m);
    for (const dd of details) {
      const n = dd.n, x = car.rx[n], y = car.ry[n], z = car.rz[n];
      dd.mesh.visible = !(x === 0 && y === 0 && z === 0);
      dd.mesh.position.set(x, y, z).addScaledVector(L, dd.off[0]).addScaledVector(U, dd.off[1]).addScaledVector(F, dd.off[2]);
      dd.mesh.quaternion.copy(_qa);
    }
    for (const r of ribbons) {
      const p = r.p, n0 = p.nodes[0], pos = r.mesh.geometry.attributes.position, vis = !p.gone && !(car.rx[n0] === 0 && car.ry[n0] === 0 && car.rz[n0] === 0);
      r.mesh.visible = vis; if (!vis) continue;
      for (let c = 0; c < p.cols; c++) {
        for (let e = 0; e < 2; e++) {
          const rr = (e ? r.u1 : r.u0) * (p.rows - 1), r0 = Math.min(Math.floor(rr), p.rows - 2), f = rr - r0;
          const a = p.nodes[r0 * p.cols + c], b = p.nodes[(r0 + 1) * p.cols + c];
          pos.setXYZ(c * 2 + e, car.rx[a] + (car.rx[b] - car.rx[a]) * f + U.x * 0.012, car.ry[a] + (car.ry[b] - car.ry[a]) * f + U.y * 0.012, car.rz[a] + (car.rz[b] - car.rz[a]) * f + U.z * 0.012);
        }
      }
      pos.needsUpdate = true; r.mesh.geometry.computeVertexNormals();
    }
  }
  // interior / engine follow the shell
  {
    const L = V(car.left), U = V(car.up), F = V(car.fwd);
    _m.makeBasis(L, U, F); _qa.setFromRotationMatrix(_m);
    for (const it of interior) {
      const a = it.anchor;
      it.mesh.position.set(car.px[a], car.py[a], car.pz[a]).addScaledVector(L, it.off[0]).addScaledVector(U, it.off[1]).addScaledVector(F, it.off[2]);
      it.mesh.quaternion.copy(_qa).multiply(it.tq);
    }
  }

  const fwd = V(car.fwd), left = V(car.left), up = V(car.up);
  const s = car.steerAngle, cs = Math.cos(s), sn = Math.sin(s);
  const fS = fwd.clone().multiplyScalar(cs).addScaledVector(left, sn);
  const lS = left.clone().multiplyScalar(cs).addScaledVector(fwd, -sn);
  car.wheels.forEach((w, k) => {
    const g = wheelGroups[k];
    g.position.set(car.px[w.i], car.py[w.i], car.pz[w.i]);
    if (w.detached) {                       // a wheel that came off rolls on its own, pointing where it is travelling
      const vx = car.vx[w.i], vz = car.vz[w.i];
      if (Math.hypot(vx, vz) > 0.3) w.hd = Math.atan2(vx, vz);
      const h = w.hd === undefined ? car.yaw : w.hd;
      _m.makeBasis(new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(h), 0, Math.cos(h)));
    } else if (w.front) _m.makeBasis(lS, up, fS); else _m.makeBasis(left, up, fwd);
    g.quaternion.setFromRotationMatrix(_m);
    g.userData.spin.rotation.x = w.spin;
    const fl = w.flat || 0; g.scale.set(1, 1 - 0.18 * fl, 1);
  });

  // lamps follow the deforming bodywork
  for (let side = 0; side < 2; side++) {
    const h = nodePos(stn(11, side ? 4 : 1)).lerp(nodePos(stn(11, side ? 1 : 4)), 0.28).addScaledVector(up, 0.1).addScaledVector(fwd, 0.04);
    headMeshes[side].position.copy(h);
    headLights[side].position.copy(h);
    headLights[side].target.position.copy(h).addScaledVector(fwd, 12).addScaledVector(up, -1.2);
    const t = nodePos(stn(0, side ? 4 : 1)).lerp(nodePos(stn(0, side ? 1 : 4)), 0.28).addScaledVector(up, 0.08).addScaledVector(fwd, -0.04);
    tailMeshes[side].position.copy(t);
    const mat = tailMeshes[side].material;
    mat.color.set(car.braking > 0.1 ? 0xff2a2a : car.reverse ? 0xffffff : 0x701010);
    headLights[side].intensity = (nightMode || lightsOn) ? 60 : 0;
  }

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

// ------------------------------------------------------------ effects driven by physics
function updateFx(dt, inp) {
  const fwdL = car.left;
  car.wheels.forEach((w, k) => {
    const x = car.px[w.i], y = car.py[w.i] - car.WR, z = car.pz[w.i];
    const rim = Math.hypot(x, z) > 128;
    if (w.grounded && w.skid > 0.25) {
      const lx = fwdL[0] * 0.14, lz = fwdL[2] * 0.14;
      skids.add(k, x, y + 0.03, z, lx, lz);
      if (w.skid > 0.5 && Math.random() < dt * 25) particles.emit(x, y + 0.1, z, (Math.random() - 0.5) * 1.0, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 1.0, 0.9, 0.55, 2.5, 0.8, 0.8, 0.82, 0.22, 0.4);
    } else skids.stop(k);
    if (w.grounded && rim && car.speed > 8 && Math.random() < Math.min(1, dt * 15)) {
      particles.emit(x, y + 0.1, z, (Math.random() - 0.5) * 2, 0.7 + Math.random(), (Math.random() - 0.5) * 2, 1.2, 0.7, 3, 0.55, 0.45, 0.32, 0.35, 0.4);
    }
  });
  for (const s of car.sparks) {
    for (let i = 0; i < 5; i++) particles.emit(s[0], s[1], s[2], (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0.45, 0.12, -0.3, 1, 0.65, 0.2, 1, -14);
  }
  for (const e of car.lostEvents) {          // panels tearing off, glass shattering
    const [x, y, z, , isGlass, vx, vy, vz] = e, R = Math.random;
    if (isGlass) {
      for (let i = 0; i < 46; i++) particles.emit(x + (R() - 0.5) * 0.7, y + (R() - 0.5) * 0.4, z + (R() - 0.5) * 0.7, vx * 0.7 + (R() - 0.5) * 5, vy + R() * 3, vz * 0.7 + (R() - 0.5) * 5, 1.1 + R() * 0.8, 0.06 + R() * 0.05, -0.2, 0.75 + R() * 0.25, 0.9, 1, 1, -14);
      for (let i = 0; i < 5; i++) particles.emit(x, y, z, (R() - 0.5) * 2, R() * 1.2, (R() - 0.5) * 2, 0.9, 0.4, 2.5, 0.85, 0.92, 1, 0.25, 0.2);
      crunch(0.1);
    } else {
      for (let i = 0; i < 8; i++) particles.emit(x + (R() - 0.5) * 0.6, y, z + (R() - 0.5) * 0.6, vx * 0.4 + (R() - 0.5) * 3, 0.5 + R() * 2, vz * 0.4 + (R() - 0.5) * 3, 1.4, 0.7, 3, 0.55, 0.5, 0.45, 0.4, 0.3);
      for (let i = 0; i < 14; i++) particles.emit(x, y, z, (R() - 0.5) * 9, R() * 6, (R() - 0.5) * 9, 0.5, 0.1, -0.3, 1, 0.7, 0.25, 1, -14);
      crunch(0.12);
    }
  }
  if (car.plastic > 0.06) {                  // crumple dust cloud at the nose or tail, whichever is hurting
    const front = car.forwardSpeed >= 0 ? stn(11, 2) : stn(0, 2);
    for (let i = 0; i < 3; i++) particles.emit(car.px[front] + (Math.random() - 0.5) * 0.8, car.py[front] - 0.2, car.pz[front] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 3, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 3, 1.3, 0.6, 3.5, 0.6, 0.58, 0.55, 0.3, 0.3);
  }
  const dmg = car.damage;
  if (dmg > 12 && Math.random() < Math.min(1, dt * dmg * 0.5)) {   // coolant steam
    const p = nodePos(ENG).addScaledVector(V(car.up), 0.4);
    particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.5, 1.3 + Math.random(), (Math.random() - 0.5) * 0.5, 1.7, 0.4, 3.5, 0.93, 0.95, 0.97, 0.35, 0.3);
  }
  if (dmg > 25 && Math.random() < dt * 25) {                       // oil dripping out of the sump
    const p = nodePos(ENG);
    particles.emit(p.x + (Math.random() - 0.5) * 0.3, p.y - 0.25, p.z + (Math.random() - 0.5) * 0.3, car.vcom[0] * 0.5, 0, car.vcom[2] * 0.5, 0.7, 0.07, 0, 0.08, 0.06, 0.03, 0.9, -9);
  }
  if (dmg > 30 && Math.random() < Math.min(1, dt * (dmg - 20) * 0.6)) {
    const p = nodePos(ENG).addScaledVector(V(car.up), 0.55);
    particles.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 0.6, 1.8 + Math.random(), (Math.random() - 0.5) * 0.6, 2.2, 0.6, 4, 0.25, 0.25, 0.27, 0.5, 0.3);
  }
  if (dmg > 70 && Math.random() < dt * 40) {
    const p = nodePos(ENG).addScaledVector(V(car.up), 0.55);
    particles.emit(p.x, p.y + 0.15, p.z, (Math.random() - 0.5) * 0.8, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8, 0.7, 0.55, -0.4, 1, 0.5 + Math.random() * 0.3, 0.1, 0.8, 1.5);
  }
  for (let i = 0; i < car.breaks.length && i < 10; i++) {   // metal tearing off: sparks and a puff of dust
    const b = car.breaks[i];
    for (let k = 0; k < 3; k++) particles.emit(b[0], b[1], b[2], (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.5, 0.1, -0.3, 1, 0.7, 0.25, 1, -14);
    for (let k = 0; k < 6; k++) particles.emit(b[0], b[1], b[2], car.vcom[0] * 0.3 + (Math.random() - 0.5) * 7, Math.random() * 5, car.vcom[2] * 0.3 + (Math.random() - 0.5) * 7, 1.6 + Math.random(), 0.07 + Math.random() * 0.06, -0.2, 0.12, 0.12, 0.13, 1, -12);
    if (i % 2 === 0) particles.emit(b[0], b[1], b[2], (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 1.0, 0.5, 2.5, 0.6, 0.6, 0.6, 0.3, 0.3);
  }
  if (car.fire > 0 && !car.exploded || car.fire > 0) {            // burning fuel: flames and black smoke
    for (const n of [FUEL_N, ENG]) {
      const p = nodePos(n);
      if (Math.random() < dt * 60) particles.emit(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.1, p.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.8, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.8, 0.6, 0.5, -0.3, 1, 0.45 + Math.random() * 0.3, 0.08, 0.85, 1);
      if (Math.random() < dt * 30) particles.emit(p.x, p.y + 0.6, p.z, (Math.random() - 0.5) * 0.6, 2.5 + Math.random(), (Math.random() - 0.5) * 0.6, 3, 0.7, 4, 0.08, 0.08, 0.08, 0.55, 0.5);
    }
  }
  for (const e of car.explosions) {
    const R = Math.random;
    for (let i = 0; i < 90; i++) particles.emit(e[0], e[1], e[2], (R() - 0.5) * 16, R() * 12, (R() - 0.5) * 16, 0.6 + R() * 0.5, 0.9, 2, 1, 0.4 + R() * 0.4, 0.08, 0.9, -2);
    for (let i = 0; i < 40; i++) particles.emit(e[0], e[1], e[2], (R() - 0.5) * 8, 2 + R() * 6, (R() - 0.5) * 8, 3, 1.2, 5, 0.1, 0.1, 0.1, 0.6, 0.5);
    for (let i = 0; i < 40; i++) particles.emit(e[0], e[1], e[2], (R() - 0.5) * 25, R() * 14, (R() - 0.5) * 25, 1, 0.1, -0.3, 1, 0.75, 0.3, 1, -14);
    crunch(0.5);
  }
  if (car.inLake) {                                              // splashes where the car is in the water
    car.wheels.forEach((w) => {
      if (car.py[w.i] < WATER.y + 0.3 && car.py[w.i] > WATER.y - 0.8 && Math.hypot(car.vx[w.i], car.vz[w.i]) > 2 && Math.random() < dt * 40) {
        particles.emit(car.px[w.i], WATER.y + 0.05, car.pz[w.i], (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.9, 0.2, 1.5, 0.85, 0.93, 1, 0.6, -9);
      }
    });
  }
  car.wheels.forEach((w) => {                                    // bare rim scraping: sparks
    if ((w.flat || 0) > 0.6 && w.grounded && car.speed > 4 && Math.random() < dt * 30) particles.emit(car.px[w.i], car.py[w.i] - car.WR, car.pz[w.i], (Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.4, 0.08, -0.3, 1, 0.7, 0.2, 1, -12);
  });
  particles.update(dt);
}

// ------------------------------------------------------------ input
const keys = {};
const touch = { up: 0, down: 0, left: 0, right: 0, hand: 0 };
let camMode = 0, slow = false, paused = true;
let mouseCam = true, orbYaw = 0, orbPitch = 0.28, orbDist = 9, dragging = false, headSm = 0;

function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.opacity = 0; }, 1800);
}
function setMouseCam(on) {
  mouseCam = on; document.getElementById('btnMouse').classList.toggle('on', on);
  document.getElementById('btnMouse').textContent = 'Mouse cam: ' + (on ? 'ON' : 'OFF');
  renderer.domElement.style.cursor = on ? 'grab' : 'default';
  if (on) { orbYaw = 0; orbPitch = 0.28; toast('Mouse camera ON - drag to look around, scroll to zoom'); } else toast('Mouse camera OFF');
}
function setBeams(on) {
  showBeams = on; lines.visible = on; bodyMat.transparent = on; bodyMat.opacity = on ? 0.3 : 1; bodyMat.needsUpdate = true;
}
let lightsOn = false;
function upright() { car.recover(); toast('Flipped upright (damage kept)'); }
let hornNodes = null;
function hornOn() {
  if (!ac || hornNodes) return;
  const g = ac.createGain(); g.gain.value = 0.07; g.connect(ac.destination);
  hornNodes = [420, 525].map((f) => { const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(g); o.start(); return o; }); hornNodes.push(g);
}
function hornOff() { if (!hornNodes) return; hornNodes[0].stop(); hornNodes[1].stop(); hornNodes[2].disconnect(); hornNodes = null; }
function photo() {
  renderer.render(scene, camera);
  const a = document.createElement('a'); a.href = renderer.domElement.toDataURL('image/png'); a.download = 'nodengw-' + Date.now() + '.png'; a.click(); toast('Screenshot saved');
}
function respawn() { car.reset(car.com[0], car.com[2], car.yaw); }
function toStart() { car.reset(0, 0, 0); resetBalls(); }

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true; audioInit();
  if (e.code === 'Escape' || e.code === 'KeyP') { toggleMenu(); return; }
  if (paused) return;
  if (e.code === 'KeyR') respawn();
  if (e.code === 'KeyT') toStart();
  if (e.code === 'KeyC') { camMode = (camMode + 1) % 3; if (mouseCam) setMouseCam(false); }
  if (e.code === 'KeyM') setMouseCam(!mouseCam);
  if (e.code === 'KeyB') setBeams(!showBeams);
  if (e.code === 'KeyV') slow = !slow;
  if (e.code === 'KeyU') upright();
  if (e.code === 'KeyH') hornOn();
  if (e.code === 'KeyL') { lightsOn = !lightsOn; toast('Headlights ' + (lightsOn ? 'on' : 'auto')); }
  if (e.code === 'KeyK') photo();
  if (e.code === 'KeyN') applyTime(settings.time === 'day' ? 'sunset' : settings.time === 'sunset' ? 'night' : 'day');
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyH') hornOff(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const cvs = renderer.domElement;
let lastPX = 0, lastPY = 0;
cvs.addEventListener('pointerdown', (e) => { if (!mouseCam || paused) return; dragging = true; lastPX = e.clientX; lastPY = e.clientY; cvs.setPointerCapture(e.pointerId); cvs.style.cursor = 'grabbing'; });
cvs.addEventListener('pointermove', (e) => {
  if (!mouseCam || !dragging) return;
  const dx = e.clientX - lastPX, dy = e.clientY - lastPY; lastPX = e.clientX; lastPY = e.clientY;
  orbYaw -= dx * 0.006; orbPitch = Math.min(1.45, Math.max(-0.05, orbPitch + dy * 0.005));
});
const endDrag = (e) => { dragging = false; if (mouseCam) cvs.style.cursor = 'grab'; };
cvs.addEventListener('pointerup', endDrag); cvs.addEventListener('pointercancel', endDrag);
cvs.addEventListener('wheel', (e) => { if (!mouseCam) return; e.preventDefault(); orbDist = Math.min(40, Math.max(3, orbDist * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });

for (const b of document.querySelectorAll('[data-t]')) {
  const k = b.dataset.t;
  const on = (e) => { e.preventDefault(); touch[k] = 1; audioInit(); };
  const off = (e) => { e.preventDefault(); touch[k] = 0; };
  b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
}
document.getElementById('btnFix').onclick = () => { if (!paused) upright(); };
document.getElementById('btnPhoto').onclick = () => { if (!paused) photo(); };
document.getElementById('btnReset').onclick = () => { if (!paused) respawn(); };
document.getElementById('btnCam').onclick = () => { camMode = (camMode + 1) % 3; if (mouseCam) setMouseCam(false); };
document.getElementById('btnMouse').onclick = () => setMouseCam(!mouseCam);
document.getElementById('btnMenu').onclick = () => toggleMenu();

let padPrev = {};
function readInput() {
  const L = keys.KeyA || keys.ArrowLeft || touch.left, R = keys.KeyD || keys.ArrowRight || touch.right;
  const inp = {
    up: (keys.KeyW || keys.ArrowUp || touch.up) ? 1 : 0,
    down: (keys.KeyS || keys.ArrowDown || touch.down) ? 1 : 0,
    hand: !!(keys.Space || touch.hand),
    steer: (L ? 1 : 0) - (R ? 1 : 0),   // +1 = steer left
  };
  const gp = (navigator.getGamepads && navigator.getGamepads()[0]) || null;
  if (gp) {
    const ax = Math.abs(gp.axes[0]) > 0.12 ? gp.axes[0] : 0;
    if (ax) inp.steer = -ax;
    const gas = gp.buttons[7] ? gp.buttons[7].value : 0, brk = gp.buttons[6] ? gp.buttons[6].value : 0;
    if (gas > 0.05) inp.up = gas; if (brk > 0.05) inp.down = brk;
    if (gp.buttons[1] && gp.buttons[1].pressed) inp.hand = true;
    const edge = (i, fn) => { const p = gp.buttons[i] && gp.buttons[i].pressed; if (p && !padPrev[i]) fn(); padPrev[i] = p; };
    edge(3, respawn); edge(2, () => { camMode = (camMode + 1) % 3; }); edge(9, toggleMenu);
  }
  return inp;
}

// ------------------------------------------------------------ audio
let ac, eng1, eng2, engG, engF, noiseSrc, squealG, windG, noiseBuf;
function audioInit() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    engF = ac.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 800;
    engG = ac.createGain(); engG.gain.value = 0;
    eng1 = ac.createOscillator(); eng1.type = 'sawtooth';
    eng2 = ac.createOscillator(); eng2.type = 'square';
    const g2 = ac.createGain(); g2.gain.value = 0.35;
    eng1.connect(engF); eng2.connect(g2); g2.connect(engF); engF.connect(engG); engG.connect(ac.destination);
    eng1.start(); eng2.start();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseSrc = ac.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 6;
    squealG = ac.createGain(); squealG.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    windG = ac.createGain(); windG.gain.value = 0;
    noiseSrc.connect(bp); bp.connect(squealG); squealG.connect(ac.destination);
    noiseSrc.connect(lp); lp.connect(windG); windG.connect(ac.destination);
    noiseSrc.start();
  } catch (e) { ac = null; }
}
let lastCrunch = 0;
function crunch(v) {
  if (!ac || ac.currentTime - lastCrunch < 0.1) return; lastCrunch = ac.currentTime;
  const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = 300 + Math.min(2500, v * 9000);
  g.gain.setValueAtTime(Math.min(0.9, v * 8), ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start(0, Math.random(), 0.5);
}
function audioUpdate() {
  if (!ac) return;
  const t = ac.currentTime, f = car.rpm / 15;
  eng1.frequency.setTargetAtTime(f, t, 0.04); eng2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
  engF.frequency.setTargetAtTime(350 + car.throttle * 1700 + car.rpm * 0.25, t, 0.06);
  engG.gain.setTargetAtTime(paused ? 0 : 0.05 + car.throttle * 0.04, t, 0.08);
  let sk = 0; for (const w of car.wheels) sk = Math.max(sk, w.grounded ? w.skid : 0);
  squealG.gain.setTargetAtTime(paused ? 0 : sk * 0.07, t, 0.05);
  windG.gain.setTargetAtTime(paused ? 0 : Math.min(0.2, car.speed / 70 * 0.2), t, 0.15);
}

// ------------------------------------------------------------ HUD
const gauge = document.getElementById('gauge'), gctx = gauge.getContext('2d');
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
const miniBg = document.createElement('canvas'); miniBg.width = miniBg.height = mini.width;
(function drawMiniBg() {
  const c = miniBg.getContext('2d'), S = miniBg.width, im = c.createImageData(S, S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const x = (px / S) * WORLD_HALF * 2 - WORLD_HALF, z = WORLD_HALF - (py / S) * WORLD_HALF * 2;
    const h = terrainHeight(x, z), k = Math.min(1, Math.max(0, (Math.hypot(x, z) - 125) / 40));
    let r = 120 + h * 6, g = 124 + h * 6, b = 128 + h * 6;
    r = r * (1 - k) + 60 * k + h * 5 * k; g = g * (1 - k) + 110 * k + h * 5 * k; b = b * (1 - k) + 55 * k;
    if (onRamp(x, z)) { r = 235; g = 160; b = 40; }
    const o = (py * S + px) * 4; im.data[o] = r; im.data[o + 1] = g; im.data[o + 2] = b; im.data[o + 3] = 255;
  }
  c.putImageData(im, 0, 0);
  const mp = (x, z) => [(x + WORLD_HALF) / (WORLD_HALF * 2) * S, (WORLD_HALF - z) / (WORLD_HALF * 2) * S];
  for (const o of OBSTACLES) {
    if (o.kind === 'tree') { const [x, y] = mp((o.min[0] + o.max[0]) / 2, (o.min[2] + o.max[2]) / 2); c.fillStyle = '#1f5a2a'; c.fillRect(x - 1, y - 1, 2, 2); continue; }
    const [x0, y0] = mp(o.min[0], o.max[2]), [x1, y1] = mp(o.max[0], o.min[2]);
    c.fillStyle = o.kind === 'pillar' ? '#e8b020' : '#555'; c.fillRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
  }
})();

function drawGauge() {
  const S = gauge.width, c = gctx, cx = S / 2, cy = S / 2, R = S / 2 - 10;
  c.clearRect(0, 0, S, S);
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(cx, cy, R + 6, 0, 7); c.fill();
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5, kmh = speedVal(car.speed), vmax = settings.units === 'mph' ? 160 : 260;
  c.lineWidth = 8; c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(cx, cy, R - 6, a0, a0 + sweep); c.stroke();
  c.strokeStyle = '#4cc9f0'; c.beginPath(); c.arc(cx, cy, R - 6, a0, a0 + sweep * Math.min(1, kmh / vmax)); c.stroke();
  c.lineWidth = 5; const rp = Math.min(1, car.rpm / 7500);
  c.strokeStyle = rp > 0.85 ? '#ff4d4d' : '#ffd166'; c.beginPath(); c.arc(cx, cy, R - 20, a0, a0 + sweep * rp); c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'center';
  c.font = '700 40px system-ui'; c.fillText(Math.round(kmh), cx, cy + 6);
  c.font = '12px system-ui'; c.fillStyle = '#bbb'; c.fillText(settings.units === 'mph' ? 'mph' : 'km/h', cx, cy + 24);
  c.font = '700 26px system-ui'; c.fillStyle = '#ffd166'; c.fillText(car.gearLabel, cx, cy + 58);
  c.font = '11px system-ui'; c.fillStyle = '#bbb'; c.fillText(Math.round(car.rpm / 100) * 100 + ' rpm', cx, cy - 30);
}
function drawMini() {
  const S = mini.width; mctx.clearRect(0, 0, S, S);
  mctx.save(); mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 2, 0, 7); mctx.clip();
  mctx.drawImage(miniBg, 0, 0);
  const mp = (x, z) => [(x + WORLD_HALF) / (WORLD_HALF * 2) * S, (WORLD_HALF - z) / (WORLD_HALF * 2) * S];
  mctx.fillStyle = '#fff';
  for (const b of BALLS) { const [x, y] = mp(b.x, b.z); mctx.fillRect(x - 1, y - 1, 2, 2); }
  const [x, y] = mp(car.com[0], car.com[2]);
  mctx.translate(x, y); mctx.rotate(Math.atan2(car.fwd[0], car.fwd[2]));
  mctx.fillStyle = '#ff2d55'; mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(0, 3); mctx.lineTo(-5, 6); mctx.closePath(); mctx.fill();
  mctx.restore();
  mctx.strokeStyle = 'rgba(255,255,255,0.7)'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 2, 0, 7); mctx.stroke();
}

// jump / stats tracking
const el = (id) => document.getElementById(id);
const st = { air: false, t: 0, x: 0, z: 0, last: null, maxSpeed: 0 };
function trackStats(dt) {
  if (car.airborne) {
    if (!st.air) { st.air = true; st.t = 0; st.x = car.com[0]; st.z = car.com[2]; }
    st.t += dt;
  } else if (st.air) {
    st.air = false;
    if (st.t > 0.7) {
      const dist = Math.hypot(car.com[0] - st.x, car.com[2] - st.z);
      st.last = { air: st.t, dist };
      let nb = false;
      if (dist > best.jump) { best.jump = dist; nb = true; }
      if (st.t > best.air) { best.air = st.t; nb = true; }
      if (nb) { store.set('best', best); toast('New best jump: ' + dist.toFixed(0) + ' m!'); }
    }
  }
  st.maxSpeed = Math.max(st.maxSpeed, car.speed * 3.6);
  if (st.maxSpeed > best.speed) { best.speed = st.maxSpeed; store.set('best', best); }
  const dmg = car.damage;
  el('dmg').textContent = dmg.toFixed(0) + '%';
  el('dmgbar').style.width = dmg + '%';
  el('cost').textContent = '$' + Math.round(dmg * 85).toLocaleString();
  el('brk').textContent = car.brokenCount;
  if (frameCount % 10 === 0) {
    const l = car.partsLost(), nd = car.updateNodeDamage(), dented = [], cracked = [];
    for (const p of car.panels) {
      if (p.gone) continue;
      if (p.glass) { if (p.crack > 0.25) cracked.push(p.name); continue; }
      let a = 0; for (const i of p.nodes) a += nd[i]; if (a / p.nodes.length > 0.25) dented.push(p.name);
    }
    const span = (c, t, arr) => arr.length ? '<div style="color:' + c + '">' + t + ': ' + arr.join(', ') + '</div>' : '';
    el('lost').innerHTML = (l.length || dented.length || cracked.length) ? span('#ff6b6b', 'Lost', l) + span('#ffd166', 'Cracked', cracked) + span('#f4a261', 'Dented', dented) : 'All parts attached';
  }
  el('air').textContent = st.air ? 'AIR ' + st.t.toFixed(1) + 's' : (st.last ? 'Last jump ' + st.last.dist.toFixed(0) + ' m / ' + st.last.air.toFixed(1) + ' s' : 'Last jump -');
  el('best').textContent = 'Best jump ' + best.jump.toFixed(0) + ' m · top speed ' + speedVal(best.speed / 3.6).toFixed(0) + (settings.units === 'mph' ? ' mph' : ' km/h');
}

// ------------------------------------------------------------ menu
const menu = el('menu');
function buildMenu() {
  const vh = el('vehicles'); vh.innerHTML = '';
  for (const k of Object.keys(VEHICLES)) {
    const b = document.createElement('button'); b.className = 'card' + (settings.vehicle === k ? ' sel' : '');
    b.innerHTML = '<b>' + VEHICLES[k].name + '</b><small>' + VEHICLES[k].blurb + '</small>';
    b.onclick = () => { settings.vehicle = k; if (!store.get('colorTouched', false)) { const ci = COLOR_NAMES.indexOf(VEHICLES[k].look && VEHICLES[k].look.color); if (ci >= 0) settings.color = ci; } buildMenu(); }; vh.appendChild(b);
  }
  const ch = el('colors'); ch.innerHTML = '';
  COLORS.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'sw' + (settings.color === i ? ' sel' : '');
    b.style.background = 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')';
    b.onclick = () => { settings.color = i; store.set('colorTouched', true); buildMenu(); }; ch.appendChild(b);
  });
  const qh = el('quality'); qh.innerHTML = '';
  for (const k of ['low', 'med', 'high']) {
    const b = document.createElement('button'); b.className = 'pill' + (settings.quality === k ? ' sel' : ''); b.textContent = k[0].toUpperCase() + k.slice(1);
    b.onclick = () => { applyQuality(k); buildMenu(); }; qh.appendChild(b);
  }
  const uh = el('units'); uh.innerHTML = '';
  for (const k of ['kmh', 'mph']) {
    const b = document.createElement('button'); b.className = 'pill' + (settings.units === k ? ' sel' : ''); b.textContent = k === 'kmh' ? 'km/h' : 'mph';
    b.onclick = () => { settings.units = k; store.set('units', k); buildMenu(); }; uh.appendChild(b);
  }
  const th = el('times'); th.innerHTML = '';
  for (const k of Object.keys(TIMES)) {
    const b = document.createElement('button'); b.className = 'pill' + (settings.time === k ? ' sel' : ''); b.textContent = k[0].toUpperCase() + k.slice(1);
    b.onclick = () => { applyTime(k); buildMenu(); }; th.appendChild(b);
  }
}
function toggleMenu(forceOpen) {
  paused = forceOpen === undefined ? !paused : forceOpen;
  menu.style.display = paused ? 'flex' : 'none';
  if (paused) buildMenu();
  last = performance.now();
}
el('drive').onclick = () => {
  audioInit();
  store.set('color', settings.color);
  if (!car || car.key !== settings.vehicle || car._colorIdx !== settings.color) { buildCar(settings.vehicle); car._colorIdx = settings.color; }
  toggleMenu(false);
};

// ------------------------------------------------------------ camera
setTimeout(() => setMouseCam(true), 0);
const camPos = new THREE.Vector3(0, 6, -12), camLook = new THREE.Vector3();

window.__shell = () => shell;
let shotCam = null; window.__shot = (p, t) => { shotCam = p ? { p, t } : null; };   // debug hook for screenshots
function updateCamera(dt) {
  if (shotCam) { const c0 = car.com; camera.position.set(c0[0] + shotCam.p[0], c0[1] + shotCam.p[1], c0[2] + shotCam.p[2]); camera.lookAt(c0[0] + shotCam.t[0], c0[1] + shotCam.t[1], c0[2] + shotCam.t[2]); return; }
  const c = car.com, cc = V(c), fwd = V(car.fwd);
  const fl = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
  const k = 1 - Math.exp(-dt * 4);
  const heading = Math.atan2(fl.x, fl.z);
  if (!mouseCam && camMode === 1) {          // bonnet / driver
    const a1 = stn(6, 2), a2 = stn(6, 3), p = new THREE.Vector3((car.px[a1] + car.px[a2]) / 2, (car.py[a1] + car.py[a2]) / 2 - 0.2, (car.pz[a1] + car.pz[a2]) / 2).addScaledVector(V(car.fwd), 0.25);
    camera.position.copy(p); camera.lookAt(p.clone().addScaledVector(fwd, 10));
    camPos.copy(p); camLook.copy(p); headSm = heading;
  } else if (mouseCam) {                     // free orbit with the mouse
    let dh = heading - headSm; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); headSm += dh * (1 - Math.exp(-dt * 3));
    const a = headSm + Math.PI + orbYaw, cp = Math.cos(orbPitch);
    const target = cc.clone().add(new THREE.Vector3(Math.sin(a) * cp, Math.sin(orbPitch), Math.cos(a) * cp).multiplyScalar(orbDist)).add(new THREE.Vector3(0, 0.8, 0));
    camPos.lerp(target, 1 - Math.exp(-dt * 12));
    camPos.y = Math.max(camPos.y, terrainHeight(camPos.x, camPos.z) + 0.6);
    camera.position.copy(camPos);
    camLook.lerp(cc.clone().add(new THREE.Vector3(0, 0.9, 0)), 1 - Math.exp(-dt * 12));
    camera.lookAt(camLook);
  } else if (camMode === 0) {                // chase
    headSm = heading;
    const dist = 8.5 + Math.min(4, car.speed * 0.06);
    const target = cc.clone().addScaledVector(fl, -dist).add(new THREE.Vector3(0, 3.4, 0));
    camPos.lerp(target, k);
    camPos.y = Math.max(camPos.y, terrainHeight(camPos.x, camPos.z) + 1);
    camera.position.copy(camPos);
    camLook.lerp(cc.clone().addScaledVector(fl, 4).add(new THREE.Vector3(0, 1, 0)), 1 - Math.exp(-dt * 8));
    camera.lookAt(camLook);
  } else {                                   // far / TV
    const target = cc.clone().add(new THREE.Vector3(18, 14, -18));
    camPos.lerp(target, 1 - Math.exp(-dt * 1.5));
    camera.position.copy(camPos); camera.lookAt(cc); camLook.copy(cc); headSm = heading;
  }
  particles.mat.uniforms.scale.value = renderer.getPixelRatio() * innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
}

// ------------------------------------------------------------ loop
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
let last = performance.now();
applyTime(settings.time);
applyQuality(settings.quality);
buildCar(settings.vehicle); car._colorIdx = settings.color;
toggleMenu(true);

let fpsAvg = 60, lowFor = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused && dt > 0) {
    fpsAvg += (1 / Math.max(dt, 0.001) - fpsAvg) * 0.05;
    if (frameCount % 30 === 0) el('fps').textContent = Math.round(fpsAvg) + ' fps · ' + settings.quality;
    lowFor = fpsAvg < 28 ? lowFor + dt : 0;
    if (lowFor > 4 && settings.quality !== 'low') { applyQuality(settings.quality === 'high' ? 'med' : 'low'); toast('Slow frame rate: graphics set to ' + settings.quality); lowFor = 0; fpsAvg = 60; }
  }
  frameCount++;
  if (!paused) {
    const inp = readInput();
    car.plastic = 0;
    car.advance(dt * (slow ? 0.2 : 1), inp);
    if (car.plastic > 0.01) { crunch(car.plastic); }
    const c = car.com;
    if (Math.abs(c[0]) > WORLD_HALF || Math.abs(c[2]) > WORLD_HALF || c[1] < -30) car.reset(0, 0, 0);
    updateFx(dt * (slow ? 0.2 : 1), inp);
    trackStats(dt);
  }
  audioUpdate();

  updateVisuals();
  BALLS.forEach((b, i) => {
    const m = ballMeshes[i]; m.position.set(b.x, b.y, b.z);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01 && !paused) { _ax.set(b.vz, 0, -b.vx).normalize(); _q.setFromAxisAngle(_ax, sp * dt / b.r); m.quaternion.premultiply(_q); }
  });
  if (ropeBall >= 0) { const b = BALLS[ropeBall], r = b.rope, a = ropeGeo.attributes.position; a.setXYZ(0, r.ax, r.ay, r.az); a.setXYZ(1, b.x, b.y, b.z); a.needsUpdate = true; }
  updateCamera(dt);

  const c = car.com;
  sun.position.set(c[0] + sunDir.x * 100, c[1] + sunDir.y * 100, c[2] + sunDir.z * 100);
  sun.target.position.set(c[0], c[1], c[2]);
  sky.position.copy(camera.position);

  drawGauge(); drawMini();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
