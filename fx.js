// fx.js - particles (dust, smoke, sparks, fire) and skid marks
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 2500) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.base = new Float32Array(max);
    this.col4 = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute vec4 color; attribute float size; varying vec4 vC; uniform float scale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p)*2.0; if(d>1.0) discard; float a=smoothstep(1.0,0.2,d)*vC.a; gl_FragColor=vec4(vC.rgb,a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    for (let k = 0; k < max; k++) this.size[k] = 0;
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, grav = 0) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = this.maxLife[k] = life; this.size[k] = this.base[k] = size; this.grow[k] = grow; this.grav[k] = grav;
    this.col4[k * 4] = r; this.col4[k * 4 + 1] = g; this.col4[k * 4 + 2] = b; this.col4[k * 4 + 3] = a;
  }
  update(dt) {
    const { pos, vel, life, maxLife, size, base, grow, grav, col, col4 } = this;
    for (let k = 0; k < this.max; k++) {
      if (life[k] <= 0) { size[k] = 0; continue; }
      life[k] -= dt;
      if (life[k] <= 0) { size[k] = 0; col[k * 4 + 3] = 0; continue; }
      const t = 1 - life[k] / maxLife[k];
      vel[k * 3 + 1] += grav[k] * dt;
      const drag = Math.exp(-dt * 1.5);
      vel[k * 3] *= drag; vel[k * 3 + 2] *= drag;
      pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      size[k] = base[k] * (1 + grow[k] * t);
      col[k * 4] = col4[k * 4]; col[k * 4 + 1] = col4[k * 4 + 1]; col[k * 4 + 2] = col4[k * 4 + 2];
      col[k * 4 + 3] = col4[k * 4 + 3] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

export class Skids {
  constructor(scene, maxSeg = 3000) {
    this.max = maxSeg; this.n = 0; this.i = 0;
    this.pos = new Float32Array(maxSeg * 4 * 3);
    const idx = new Uint32Array(maxSeg * 6);
    for (let s = 0; s < maxSeg; s++) {
      const v = s * 4; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], s * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = [null, null, null, null];
  }
  add(w, x, y, z, rx, rz) {      // rx,rz = half-width offset vector across the tyre
    const l = this.last[w];
    if (l) {
      const k = this.i * 12;
      const p = this.pos;
      p[k] = l[0] + l[3]; p[k + 1] = l[1]; p[k + 2] = l[2] + l[4];
      p[k + 3] = l[0] - l[3]; p[k + 4] = l[1]; p[k + 5] = l[2] - l[4];
      p[k + 6] = x + rx; p[k + 7] = y; p[k + 8] = z + rz;
      p[k + 9] = x - rx; p[k + 10] = y; p[k + 11] = z - rz;
      this.i = (this.i + 1) % this.max; this.n = Math.min(this.max, this.n + 1);
      this.geo.setDrawRange(0, this.n * 6);
      this.geo.attributes.position.needsUpdate = true;
    }
    this.last[w] = [x, y, z, rx, rz];
  }
  stop(w) { this.last[w] = null; }
}
