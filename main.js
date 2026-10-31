import * as THREE from 'three';
import { Car, VEHICLES, OBSTACLES, TREES, BALLS, RAMPS, terrainHeight, onRamp, resetBalls, WORLD_HALF, st as stn } from './physics.js';
import { Particles, Skids } from './fx.js';

// ------------------------------------------------------------ settings
const COLORS = [[0.72, 0.07, 0.1], [0.1, 0.3, 0.85], [0.95, 0.75, 0.1], [0.1, 0.6, 0.3], [0.9, 0.9, 0.92], [0.07, 0.07, 0.09], [0.95, 0.4, 0.05]];
const store = {
  get(k, d) { try { const v = localStorage.getItem('nodengw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('nodengw.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const settings = { vehicle: store.get('vehicle', 'sedan'), color: store.get('color', 0), time: store.get('time', 'day') };
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

// ------------------------------------------------------------ fx
const particles = new Particles(scene);
const skids = new Skids(scene);

// ------------------------------------------------------------ car visuals
let car, body, bodyGeo, bodyMat, triIdx, triKind, baseCol, wheelGroups = [], lines, lineGeo;
let headMeshes = [], tailMeshes = [], headLights = [];
const GLASS = [0.08, 0.13, 0.18], DARK = [0.06, 0.06, 0.07];
let showBeams = false;

function disposeCar() {
  if (!car) return;
  scene.remove(body); bodyGeo.dispose(); bodyMat.dispose();
  for (const g of wheelGroups) scene.remove(g);
  scene.remove(lines); lineGeo.dispose();
  for (const m of headMeshes.concat(tailMeshes)) scene.remove(m);
  for (const l of headLights) { scene.remove(l); scene.remove(l.target); }
}

function buildCar(key) {
  const prev = car ? [car.com[0], car.com[2], car.yaw] : [0, 0, 0];
  disposeCar();
  car = new Car(key);
  car.reset(prev[0], prev[1], prev[2]);
  settings.vehicle = key; store.set('vehicle', key);
  const paint = COLORS[settings.color] || COLORS[0];

  triIdx = []; triKind = []; baseCol = [];
  for (const f of car.faces) {
    const [a, b, c, d] = f.q;
    const col = f.col === 'paint' ? paint : f.col === 'glass' ? GLASS : DARK;
    for (const t of [[a, b, c], [a, c, d]]) for (const v of t) { triIdx.push(v); triKind.push(f.col === 'paint' ? 0 : f.col === 'glass' ? 1 : 2); baseCol.push(...col); }
  }
  bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triIdx.length * 3), 3));
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(baseCol), 3));
  bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.35, transparent: showBeams, opacity: showBeams ? 0.3 : 1 });
  body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true; body.frustumCulled = false;
  scene.add(body);

  const WR = car.WR;
  wheelGroups = car.wheels.map(() => {
    const g = new THREE.Group();
    const tg = new THREE.CylinderGeometry(WR, WR, 0.28, 24); tg.rotateZ(Math.PI / 2);
    const tyre = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0x151515 }));
    const rg = new THREE.CylinderGeometry(WR * 0.62, WR * 0.62, 0.3, 16); rg.rotateZ(Math.PI / 2);
    const rim = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.3 }));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.32, WR * 1.4, 0.07), new THREE.MeshLambertMaterial({ color: 0x444444 }));
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

function updateVisuals() {
  const bp = bodyGeo.attributes.position.array;
  for (let i = 0; i < triIdx.length; i++) {
    const n = triIdx[i];
    bp[i * 3] = car.px[n]; bp[i * 3 + 1] = car.py[n]; bp[i * 3 + 2] = car.pz[n];
  }
  bodyGeo.attributes.position.needsUpdate = true;
  bodyGeo.computeVertexNormals();

  if (frameCount % 6 === 0) {   // dent colouring: scorch paint, whiten cracked glass
    const nd = car.updateNodeDamage(), cc = bodyGeo.attributes.color.array;
    for (let i = 0; i < triIdx.length; i++) {
      const d = nd[triIdx[i]], kind = triKind[i];
      const tr = kind === 1 ? [0.75, 0.8, 0.85] : [0.08, 0.07, 0.07];
      const s = Math.min(1, d * (kind === 1 ? 1.2 : 0.8));
      for (let c = 0; c < 3; c++) cc[i * 3 + c] = baseCol[i * 3 + c] * (1 - s) + tr[c] * s;
    }
    bodyGeo.attributes.color.needsUpdate = true;
  }

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

  // lamps follow the deforming bodywork
  for (let side = 0; side < 2; side++) {
    const h = nodePos(stn(9, side ? 4 : 1)).lerp(nodePos(stn(9, side ? 1 : 4)), 0.28).addScaledVector(up, -0.02).addScaledVector(fwd, 0.04);
    headMeshes[side].position.copy(h);
    headLights[side].position.copy(h);
    headLights[side].target.position.copy(h).addScaledVector(fwd, 12).addScaledVector(up, -1.2);
    const t = nodePos(stn(0, side ? 4 : 1)).lerp(nodePos(stn(0, side ? 1 : 4)), 0.28).addScaledVector(up, 0.02).addScaledVector(fwd, -0.04);
    tailMeshes[side].position.copy(t);
    const mat = tailMeshes[side].material;
    mat.color.set(car.braking > 0.1 ? 0xff2a2a : car.reverse ? 0xffffff : 0x701010);
    headLights[side].intensity = nightMode ? 60 : 0;
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
  const dmg = car.damage;
  if (dmg > 30 && Math.random() < Math.min(1, dt * (dmg - 20) * 0.6)) {
    const p = nodePos(stn(8, 2)).lerp(nodePos(stn(8, 3)), 0.5);
    particles.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 0.6, 1.8 + Math.random(), (Math.random() - 0.5) * 0.6, 2.2, 0.6, 4, 0.25, 0.25, 0.27, 0.5, 0.3);
  }
  if (dmg > 70 && Math.random() < dt * 40) {
    const p = nodePos(stn(8, 2)).lerp(nodePos(stn(8, 3)), 0.5);
    particles.emit(p.x, p.y + 0.15, p.z, (Math.random() - 0.5) * 0.8, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8, 0.7, 0.55, -0.4, 1, 0.5 + Math.random() * 0.3, 0.1, 0.8, 1.5);
  }
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
  if (e.code === 'KeyN') applyTime(settings.time === 'day' ? 'sunset' : settings.time === 'sunset' ? 'night' : 'day');
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
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
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5, kmh = car.speed * 3.6, vmax = 260;
  c.lineWidth = 8; c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(cx, cy, R - 6, a0, a0 + sweep); c.stroke();
  c.strokeStyle = '#4cc9f0'; c.beginPath(); c.arc(cx, cy, R - 6, a0, a0 + sweep * Math.min(1, kmh / vmax)); c.stroke();
  c.lineWidth = 5; const rp = Math.min(1, car.rpm / 7500);
  c.strokeStyle = rp > 0.85 ? '#ff4d4d' : '#ffd166'; c.beginPath(); c.arc(cx, cy, R - 20, a0, a0 + sweep * rp); c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'center';
  c.font = '700 40px system-ui'; c.fillText(Math.round(kmh), cx, cy + 6);
  c.font = '12px system-ui'; c.fillStyle = '#bbb'; c.fillText('km/h', cx, cy + 24);
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
  el('air').textContent = st.air ? 'AIR ' + st.t.toFixed(1) + 's' : (st.last ? 'Last jump ' + st.last.dist.toFixed(0) + ' m / ' + st.last.air.toFixed(1) + ' s' : 'Last jump -');
  el('best').textContent = 'Best jump ' + best.jump.toFixed(0) + ' m · top speed ' + best.speed.toFixed(0) + ' km/h';
}

// ------------------------------------------------------------ menu
const menu = el('menu');
function buildMenu() {
  const vh = el('vehicles'); vh.innerHTML = '';
  for (const k of Object.keys(VEHICLES)) {
    const b = document.createElement('button'); b.className = 'card' + (settings.vehicle === k ? ' sel' : '');
    b.innerHTML = '<b>' + VEHICLES[k].name + '</b><small>' + VEHICLES[k].blurb + '</small>';
    b.onclick = () => { settings.vehicle = k; buildMenu(); }; vh.appendChild(b);
  }
  const ch = el('colors'); ch.innerHTML = '';
  COLORS.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'sw' + (settings.color === i ? ' sel' : '');
    b.style.background = 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')';
    b.onclick = () => { settings.color = i; buildMenu(); }; ch.appendChild(b);
  });
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

function updateCamera(dt) {
  const c = car.com, cc = V(c), fwd = V(car.fwd);
  const fl = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
  const k = 1 - Math.exp(-dt * 4);
  const heading = Math.atan2(fl.x, fl.z);
  if (!mouseCam && camMode === 1) {          // bonnet / driver
    const a1 = stn(5, 2), a2 = stn(5, 3), p = new THREE.Vector3((car.px[a1] + car.px[a2]) / 2, (car.py[a1] + car.py[a2]) / 2 - 0.18, (car.pz[a1] + car.pz[a2]) / 2);
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
buildCar(settings.vehicle); car._colorIdx = settings.color;
toggleMenu(true);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
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
