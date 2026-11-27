/* Lidar scan, explored-map memory and its IndexedDB persistence for NikitaGame. */
import * as THREE from 'three';
import {
  CELL_CRACKED, CELL_RAMP, CELL_SHAFT_HIGH, CELL_SHAFT_LOW, CELL_SIZE, CELL_VOID, CELL_WALL, FEAT_BASE,
  FLOOR_SEG, GRID_SIZE, LIDAR_CAP, LIFT_BASE, MAX_FLOORS, RIM_BASE, SHAFT_REVEAL_R, SHAFT_SEG_BASE, VOX,
  VOX_HALF, VOX_N, VOX_Y, WALL_H, XMAP_KEY, FLOOR_DIM_VIS, XV, isShaft, isWalkable, isWallLike, LIDAR_MODE_COLORS
} from './constants.js';
import { PROBE_DIRS, _e1, _fwd, _v8, gridToWorldX, gridToWorldZ, worldToGridX, worldToGridZ } from './math.js';

export const lidarMethods = {

  /* ------------------------------------------------------------------------
     LIDAR VIEW: scanner, point cloud, per-sector memory, thermal entities
     ------------------------------------------------------------------------ */
  // Upgrade levels -> scan settings (the one place to tune the lidar)
  // Returns one of two reused objects (raw / adjusted for modifier, low-spec, throttle and ECM), refilled on every call, so this
  // can be called every step without allocating. Read what you need at once; do not keep the object.
  lidarParams(raw = false) {
    const u = this.upg;
    const p = raw ? (this._lpRaw || (this._lpRaw = {})) : (this._lpAdj || (this._lpAdj = {}));
    p.range = 32 + 4.8 * u.lrange;
    p.rays = Math.round(600 + 120 * u.lres);
    p.rows = 8 + Math.round(u.lres * 1.6);   // scan rows (laser lines) around the rocket
    p.dot = 1 + 0.06 * u.lres;               // dot size multiplier: a higher resolution also paints bigger, bolder dots (x1.0 to x1.6)
    p.focus = 0.3 + 0.04 * u.lfocus;
    p.coneDeg = 25 + 2 * u.lfocus;
    p.thermal = 18 + 4.2 * u.ltherm;
    p.pen = u.tpen;                          // walls thermal sees through (0-3)
    p.throughWall = u.tpen > 0;
    p.mark = 0.5 * u.tmark;                  // seconds a contact stays marked after it leaves sight
    p.seekerDeg = 15 + u.ttrack;
    p.lockRange = 68 + 4 * u.ttrack;
    p.glow = 2 + 0.4 * u.lmem;
    p.mem = 0.25 + 0.03 * u.lmem;
    p.keep = 3 + Math.round(0.7 * u.lmem);
    p.deep = u.ldeep;
    if (raw) return p;
    if (this.modifier === 'BLACKOUT') p.range *= 0.6;
    if (this.prefs && this.prefs.lowSpec) p.rays = Math.round(p.rays * 0.5);
    p.rays = Math.max(80, Math.round(p.rays * this.lidarThrottle * (this.missile.inECM ? 0.4 : 1)));
    return p;
  },

  thermalMat(heat, wire = false) {
    const h = Math.round(heat * 20) / 20;
    const key = h + (wire ? 'w' : '');
    let m = this.thermalMats.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      wireframe: wire,
      uniforms: { uHeat: { value: h }, uTime: this.thermalTime, uResY: this.thermalRes, uFade: { value: 1 } },
      vertexShader: `
        varying float vRim;
        varying float vFade;
        uniform float uFade;
        #include <common>
        void main() {
          #ifdef USE_INSTANCING_COLOR
            vFade = instanceColor.r;
          #else
            vFade = uFade;
          #endif
          #include <beginnormal_vertex>
          #include <defaultnormal_vertex>
          #include <begin_vertex>
          #include <project_vertex>
          vec3 n = normalize(transformedNormal);
          vec3 v = normalize(-mvPosition.xyz);
          vRim = 1.0 - abs(dot(n, v));
        }`,
      fragmentShader: `
        uniform float uHeat; uniform float uTime; uniform float uResY; varying float vRim; varying float vFade;
        vec3 pal(float t) {
          t = clamp(t, 0.0, 1.0);
          vec3 c = mix(vec3(0.12, 0.0, 0.06), vec3(0.8, 0.06, 0.02), smoothstep(0.0, 0.35, t));
          c = mix(c, vec3(1.0, 0.5, 0.0), smoothstep(0.3, 0.62, t));
          c = mix(c, vec3(1.0, 0.92, 0.3), smoothstep(0.58, 0.86, t));
          return mix(c, vec3(1.0), smoothstep(0.88, 1.0, t));
        }
        void main() {
          float t = uHeat * (1.0 - 0.6 * vRim) + 0.035 * sin(uTime * 7.0);
          float scan = 0.8 + 0.2 * step(0.5, fract(gl_FragCoord.y * 0.3333));           // thermal-camera scanlines
          float sy = gl_FragCoord.y / max(uResY, 1.0);
          float band = 1.0 - smoothstep(0.0, 0.04, abs(sy - fract(-uTime * 0.45)));     // scan band sweeping down the screen
          // heat signature fades/dissolves in: pixels appear in a noisy pattern as vFade rises
          float n = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          if (n > vFade) discard;
          gl_FragColor = vec4((pal(t * (0.55 + 0.45 * vFade) + band * 0.3) * scan + vec3(1.0, 0.85, 0.55) * band * 0.25) * (0.35 + 0.65 * vFade), 1.0);
        }`
    });
    this.thermalMats.set(key, m);
    return m;
  },

  // Hide the lit structure (collisions use the grid), turn everything else into thermal objects.
  applyLidarLook() {
    this.fadeSet = new Set();
    const G = this;
    const hook = this._fadeHook || (this._fadeHook = function (renderer, scene, camera, geometry, material) {
      const r = this.userData.fadeRoot;
      if (material.uniforms && material.uniforms.uFade) {
        material.uniforms.uFade.value = (r && r.userData.fade !== undefined ? r.userData.fade : 1) * G.floorVisAt(this.matrixWorld.elements[13]);
        material.uniformsNeedUpdate = true;
      }
    });
    for (const ch of this.levelGroup.children) {
      if (ch.userData.structural) { ch.visible = false; continue; }
      const beam = ch.isMesh && ch.material && ch.material.transparent;
      if (!beam) {                                     // everything thermal starts unseen and fades in when detected
        ch.userData.fade = 0;
        ch.userData._layerOn = false;
        ch.traverse((o) => o.layers.set(5));
      }
      if (ch.userData.noThermal) { ch.userData.fadeScale = true; continue; }
      const heat = ch.userData.heat !== undefined ? ch.userData.heat : 0.5;
      ch.traverse((o) => {
        if (o.isMesh && o.material && !o.material.transparent && !(o.material instanceof THREE.ShaderMaterial)) {
          o.material = this.thermalMat(heat, Boolean(o.material.wireframe));
        }
        if (o.isMesh) { o.userData.fadeRoot = ch; o.onBeforeRender = hook; }
      });
    }
  },

  // Fade heat signatures in (about 0.4 s) and out (0.25 s) instead of popping.
  updateFades(dt) {
    const step = (f, on) => Math.max(0, Math.min(1, f + (on ? dt * 2.5 : -dt * 4)));
    for (const obj of this.fadeSet) {
      const on = Boolean(obj.userData._tv);
      const f0 = obj.userData.fade === undefined ? 0 : obj.userData.fade;
      if (f0 === (on ? 1 : 0) && obj.userData._layerOn === (f0 > 0)) continue;
      const f = step(f0, on);
      obj.userData.fade = f;
      const vis = f > 0.001;
      if (vis !== obj.userData._layerOn) { obj.userData._layerOn = vis; obj.traverse((o) => o.layers.set(vis ? 0 : 5)); }
      if (obj.userData.fadeScale) obj.scale.setScalar(Math.max(0.001, f));
    }
    for (const l of this.lasers) {
      l.fade = step(l.fade === undefined ? 0 : l.fade, Boolean(l.thermalVis));
      for (const bm of l.beams) bm.coreMesh.scale.set(Math.max(0.001, l.fade), 1, Math.max(0.001, l.fade));
    }
    for (const sn of this.sentries) sn.fade = step(sn.fade === undefined ? 0 : sn.fade, Boolean(sn.thermalVis));
    for (const b of this.barrels) b.fade = step(b.fade === undefined ? 0 : b.fade, Boolean(b.thermalVis));
    this.syncBarrelInstances();
  },

  initLidar() {
    this.lidarThrottle = 1;
    this.lidarSlowT = 0;
    this.lidarFastT = 0;
    this.lidarSweep = 0;
    this.lidarTime = 0;
    this.lidarMemory = new Map();          // sector key -> { idx: Uint32Array, cls: Uint8Array }
    this.vox = new Uint8Array(VOX_N * VOX_N * VOX_Y);
    this.seenCells = new Uint8Array(GRID_SIZE * GRID_SIZE * MAX_FLOORS);
    this.seenOpen = 0;
    this.totalOpen = 1;
    this.lidarKey = null;
    this.floorVis = new Float32Array(MAX_FLOORS).fill(1);   // per-floor visibility (shader uniform uFV): active floor 1.0, the others FLOOR_DIM_VIS
    this._fvKey = null; this._fvN = 0;
    const pos = new Float32Array(LIDAR_CAP * 3);
    const info = new Float32Array(LIDAR_CAP * 2);
    this.lidarPos = pos;
    this.lidarInfo = info;
    this.slotVox = new Int32Array(LIDAR_CAP).fill(-1);
    this.lidarCount = 0;
    this.lidarHead = 0;
    this.lidarDirtyFrom = -1;
    this.lidarDirtyN = 0;
    const geo = new THREE.BufferGeometry();
    this.lidarPosAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.lidarInfoAttr = new THREE.BufferAttribute(info, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.lidarPosAttr);
    geo.setAttribute('aInfo', this.lidarInfoAttr);
    geo.setDrawRange(0, 0);
    this.lidarUniforms = {
      uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uGlow: { value: 2 }, uMem: { value: 0.25 },
      uRange: { value: 32 }, uSweep: { value: 0 }, uScale: { value: 1 }, uDot: { value: 1 }, uCrack: { value: 0 }, uPulse: { value: 0 },
      uFV: { value: new THREE.Vector3(1, 1, 1) }, uWallH: { value: WALL_H },
      uMode: { value: new THREE.Color(...LIDAR_MODE_COLORS.EXPLORE) }   // map dot colour: follows the autopilot's mission (updateLidar)
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.lidarUniforms,
      vertexShader: `
        attribute vec2 aInfo;
        uniform float uTime, uGlow, uMem, uRange, uSweep, uScale, uCrack, uPulse, uDot;
        uniform vec3 uOrigin, uMode, uFV; uniform float uWallH;
        varying vec3 vCol;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float age = uTime - aInfo.y;
          float fresh = exp(-max(age, 0.0) / uGlow);
          vec3 d = position - uOrigin;
          float dist = length(d);
          float near = 1.0 - smoothstep(uRange * 0.35, uRange * 1.25, dist);
          float ang = atan(d.z, d.x);
          float sw = abs(mod(ang - uSweep + 3.14159, 6.28318) - 3.14159);
          float sweep = (1.0 - smoothstep(0.0, 0.22, sw)) * near * 0.6;
          float wave = exp(-abs(dist - uPulse) * 1.1) * (1.0 - smoothstep(uRange, uRange * 1.3, uPulse));
          float b = max(uMem + 0.55 * near, fresh) + sweep + wave * 0.9;
          vec3 col = uMode;                                          // green exploring, orange fetching a pickup, red hunting
          if (aInfo.x > 1.5 && aInfo.x < 2.5) { col = vec3(1.0, 0.58, 0.1); b = max(b, uCrack); }
          else if (aInfo.x > 3.5) { col = mix(uMode, vec3(1.0), 0.68); b = max(b * 1.3, 0.62 + 0.4 * near); }
          else if (aInfo.x > 2.5) col = uMode;                       // shafts: same colour as the rest of the map
          vCol = col * b + mix(uMode, vec3(1.0), 0.5) * fresh * 0.45;
          float fl = floor(position.y / uWallH);                     // multi-floor: dots of the floors the rocket is not on are dimmed to uFV
          vCol *= fl < 0.5 ? uFV.x : (fl < 1.5 ? uFV.y : uFV.z);
          float edge = aInfo.x > 3.5 ? 1.25 : 1.0;
          gl_PointSize = clamp(uScale * uDot * edge * (26.0 + 18.0 * fresh) * (1.0 + 0.7 * wave) / max(0.5, -mv.z), 1.6 * edge * uDot, 8.5 * uDot);
        }`,
      fragmentShader: `
        varying vec3 vCol;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          if (dot(c, c) > 0.25) discard;
          gl_FragColor = vec4(vCol, 1.0);
        }`
    });
    // Edge lines: one instanced screen-space ribbon per revealed edge, breathing green
    const SEG_CAP = 40000;
    this.SEG_CAP = SEG_CAP;
    this.segA = new Float32Array(SEG_CAP * 3);
    this.segB = new Float32Array(SEG_CAP * 3);
    this.segBirth = new Float32Array(SEG_CAP);
    this.segKind = new Float32Array(SEG_CAP);
    this.segSlot = new Map();
    this.segCount = 0;
    this.segDirtyMin = -1; this.segDirtyMax = -1;
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
    lg.setIndex([0, 1, 2, 2, 1, 3]);
    this.segAAttr = new THREE.InstancedBufferAttribute(this.segA, 3).setUsage(THREE.DynamicDrawUsage);
    this.segBAttr = new THREE.InstancedBufferAttribute(this.segB, 3).setUsage(THREE.DynamicDrawUsage);
    this.segTAttr = new THREE.InstancedBufferAttribute(this.segBirth, 1).setUsage(THREE.DynamicDrawUsage);
    this.segKAttr = new THREE.InstancedBufferAttribute(this.segKind, 1).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('aKind', this.segKAttr);
    lg.setAttribute('aA', this.segAAttr);
    lg.setAttribute('aB', this.segBAttr);
    lg.setAttribute('aBirth', this.segTAttr);
    lg.instanceCount = 0;
    this.segGeo = lg;
    this.segUniforms = { uTime: this.lidarUniforms.uTime, uOrigin: this.lidarUniforms.uOrigin, uRange: this.lidarUniforms.uRange, uGlow: this.lidarUniforms.uGlow, uPulse: this.lidarUniforms.uPulse,
                         uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 3 }, uMode: this.lidarUniforms.uMode,
                         uFV: this.lidarUniforms.uFV, uWallH: this.lidarUniforms.uWallH };   // outlines share the dots' mission colour
    const lmat = new THREE.ShaderMaterial({
      uniforms: this.segUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aA; attribute vec3 aB; attribute float aBirth; attribute float aKind;
        varying float vK;
        uniform float uTime, uGlow, uRange, uWidth, uPulse, uWallH; uniform vec2 uRes; uniform vec3 uOrigin, uFV;
        varying float vB; varying float vEdge;
        void main() {
          vec4 va = modelViewMatrix * vec4(aA, 1.0);
          vec4 vb = modelViewMatrix * vec4(aB, 1.0);
          float nz = -0.2;
          if (va.z > nz && vb.z > nz) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vB = 0.0; vEdge = 0.0; return; }
          if (va.z > nz) va = mix(va, vb, (va.z - nz) / (va.z - vb.z));
          if (vb.z > nz) vb = mix(vb, va, (vb.z - nz) / (vb.z - va.z));
          vec4 ca = projectionMatrix * va, cb = projectionMatrix * vb;
          vec2 sa = ca.xy / ca.w, sb = cb.xy / cb.w;
          vec2 d = (sb - sa) * uRes;
          vec2 dir = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          vec4 c = mix(ca, cb, position.x);
          c.xy += nrm * position.y * uWidth / uRes * c.w;
          gl_Position = c;
          float fresh = exp(-max(uTime - aBirth, 0.0) / uGlow);
          float mid = length(mix(aA, aB, position.x) - uOrigin);
          float near = 1.0 - smoothstep(uRange * 0.4, uRange * 1.8, mid);
          float breath = 0.5 + 0.5 * sin(uTime * 2.3);
          float wave = exp(-abs(mid - uPulse) * 0.9) * (1.0 - smoothstep(uRange, uRange * 1.3, uPulse));
          vB = (0.3 + 0.7 * near) * (0.55 + 0.45 * breath) + fresh * 0.9 + wave * 1.1;
          float fl = floor(0.5 * (aA.y + aB.y) / uWallH);              // edges of dimmed floors fade with them
          vB *= fl < 0.5 ? uFV.x : (fl < 1.5 ? uFV.y : uFV.z);
          vEdge = position.y;
          vK = aKind;
        }`,
      fragmentShader: `
        varying float vB; varying float vEdge; varying float vK;
        uniform vec3 uMode;
        void main() {
          float core = 1.0 - abs(vEdge);
          vec3 col = uMode;                                          // wall and shaft edges: the mission colour (green / orange / red)
          gl_FragColor = vec4(col * vB * (0.35 + 0.65 * core), 1.0);
        }`
    });
    this.edgeLines = new THREE.Mesh(lg, lmat);
    this.edgeLines.frustumCulled = false;
    this.scene.add(this.edgeLines);

    this.lidarPoints = new THREE.Points(geo, mat);
    this.lidarPoints.frustumCulled = false;
    this.lidarGeo = geo;
    this.scene.add(this.lidarPoints);
  },

  voxIndexAt(x, y, z) {
    const ix = Math.floor((x + VOX_HALF) / VOX), iz = Math.floor((z + VOX_HALF) / VOX), iy = Math.floor(y / VOX);
    if (ix < 0 || iz < 0 || iy < 0 || ix >= VOX_N || iz >= VOX_N || iy >= VOX_Y) return -1;
    return ix + VOX_N * (iz + VOX_N * iy);
  },

  // Scan completion = every real edge in the sector (wall seams, corners, shaft outlines, ramps, opening rims, lift beams),
  // secret chambers included, has been outlined. Counted once per sector (and again after a wall is breached).
  edgeTotal() {
    if (this._edgeTotal) return this._edgeTotal;
    const G = GRID_SIZE, GG = G * G;
    let n = 0;
    const list = [];
    for (let fl = 0; fl < this.nFloors; fl++) {
      const grid = this.floors[fl];
      for (let c = 0; c < GG; c++) {
        const v = grid[c];
        if (v !== CELL_WALL && v !== CELL_CRACKED && !isShaft(v)) continue;
        for (let q = 0; q < 16; q++) { const id = fl * FLOOR_SEG + c * 16 + q; if (this.validSeg(id)) { n++; list.push(id); } }
      }
    }
    for (let c = 0; c < GG; c++) {
      if (!isShaft(this.grid[c])) continue;
      for (let k = 0; k < 20; k++) { const id = SHAFT_SEG_BASE + c * 32 + k; if (this.validSeg(id)) { n++; list.push(id); } }
    }
    for (let i = 0; i < this.ramps.length * 8; i++) list.push(FEAT_BASE + i);
    for (let i = 0; i < this.lifts.length * 4; i++) list.push(LIFT_BASE + i);
    n += this.ramps.length * 8 + this.lifts.length * 4;
    for (let F = 1; F < this.nFloors; F++) for (let c = 0; c < GG; c++) if (this.floors[F][c] === CELL_VOID) for (let side = 0; side < 4; side++) { const id = RIM_BASE + (F * GG + c) * 4 + side; if (this.validRim(id)) { n++; list.push(id); } }
    this.edgeList = list;
    return (this._edgeTotal = Math.max(1, n));
  },

  scanPercent() {
    const total = this.edgeTotal();
    const seen = Math.min(total, this.revealedSeg.size);
    return seen >= total ? 100 : Math.min(99, Math.floor((seen / total) * 100));
  },

  markSeen(x, z, y = 0) {
    const gx = worldToGridX(x), gz = worldToGridZ(z);
    if (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) return;
    const c = this.floorOfY(y) * GRID_SIZE * GRID_SIZE + gz * GRID_SIZE + gx;
    if (this.seenCells[c]) return;
    this.seenCells[c] = 1;
    if (this.cellCountsOpen(c)) this.seenOpen++;
    this.radarSoftDirty = true;
  },

  // Store one dot (deduplicated per voxel). birth < 0 = remembered from an earlier attempt (dim).
  addDot(x, y, z, cls, birth, fy) {
    const vi = this.voxIndexAt(x, y, z);
    if (vi < 0 || this.vox[vi]) return;
    this.vox[vi] = cls;
    const slot = this.lidarHead;
    const old = this.slotVox[slot];
    if (old >= 0) this.vox[old] = 0;                      // ring full: forget the oldest dot
    this.slotVox[slot] = vi;
    this.lidarPos[slot * 3] = x; this.lidarPos[slot * 3 + 1] = y; this.lidarPos[slot * 3 + 2] = z;
    this.lidarInfo[slot * 2] = cls; this.lidarInfo[slot * 2 + 1] = birth;
    if (this.lidarDirtyFrom < 0) { this.lidarDirtyFrom = slot; this.lidarDirtyN = 0; }
    this.lidarDirtyN++;
    this.lidarHead = (slot + 1) % LIDAR_CAP;
    if (this.lidarCount < LIDAR_CAP) this.lidarCount++;
    if (!this._noMark) this.markSeen(x, z, fy === undefined ? y : fy);
  },

  flushDots() {
    if (this.lidarDirtyFrom < 0) return;
    const from = this.lidarDirtyFrom, n = this.lidarDirtyN;
    const pa = this.lidarPosAttr, ia = this.lidarInfoAttr;
    // ranges accumulate until three.js uploads them (it clears them itself)
    if (n >= LIDAR_CAP) { pa.addUpdateRange(0, LIDAR_CAP * 3); ia.addUpdateRange(0, LIDAR_CAP * 2); }
    else if (from + n <= LIDAR_CAP) { pa.addUpdateRange(from * 3, n * 3); ia.addUpdateRange(from * 2, n * 2); }
    else {
      const a = LIDAR_CAP - from, b = n - a;
      pa.addUpdateRange(from * 3, a * 3); ia.addUpdateRange(from * 2, a * 2);
      pa.addUpdateRange(0, b * 3); ia.addUpdateRange(0, b * 2);
    }
    pa.needsUpdate = true; ia.needsUpdate = true;
    this.lidarGeo.setDrawRange(0, this.lidarCount);
    this.lidarDirtyFrom = -1;
    this.lidarDirtyN = 0;
  },

  clearDots() {
    this.revealedSeg.clear();
    this.segSlot.clear();
    this.segCount = 0;
    this.segGeo.instanceCount = 0;
    this.segDirtyMin = -1; this.segDirtyMax = -1;
    this.vox.fill(0);
    this.slotVox.fill(-1);
    this.seenCells.fill(0);
    this.seenOpen = 0;
    this.lidarCount = 0;
    this.lidarHead = 0;
    this.lidarDirtyFrom = -1;
    this.lidarDirtyN = 0;
    this.lidarGeo.setDrawRange(0, 0);
    this.radarSoftDirty = true;
  },

  // Remove remembered dots inside one grid cell (a cracked wall that has been shattered).
  forgetCell(gx, gz) {
    let changed = false;
    for (let s = 0; s < LIDAR_CAP; s++) {
      const vi = this.slotVox[s];
      if (vi <= -2) {
        if (-vi - 2 === gz * GRID_SIZE + gx) { this.slotVox[s] = -1; this.lidarPos[s * 3 + 1] = -1000; changed = true; }
        continue;
      }
      if (vi < 0) continue;
      const ix = vi % VOX_N, iz = Math.floor(vi / VOX_N) % VOX_N;
      const x = ix * VOX + VOX * 0.5 - VOX_HALF, z = iz * VOX + VOX * 0.5 - VOX_HALF;
      if (worldToGridX(x) === gx && worldToGridZ(z) === gz) {
        this.vox[vi] = 0;
        this.slotVox[s] = -1;
        this.lidarPos[s * 3 + 1] = -1000;
        changed = true;
      }
    }
    const cell = gz * GRID_SIZE + gx;
    for (const sg of [...this.revealedSeg]) {
      if ((sg >> 4) !== cell) continue;
      this.revealedSeg.delete(sg);
      const i = this.segSlot.get(sg);
      if (i !== undefined) {
        this.segSlot.delete(sg);
        this.segB[i * 3] = this.segA[i * 3]; this.segB[i * 3 + 1] = this.segA[i * 3 + 1]; this.segB[i * 3 + 2] = this.segA[i * 3 + 2];
        if (this.segDirtyMin < 0 || i < this.segDirtyMin) this.segDirtyMin = i;
        if (i > this.segDirtyMax) this.segDirtyMax = i;
      }
    }
    if (changed) {

      this.lidarPosAttr.addUpdateRange(0, LIDAR_CAP * 3);
      this.lidarPosAttr.needsUpdate = true;
    }
  },

  // Cast one ray through the grid in 3D. Per cell column: wall faces on entry, then shaft slabs, ramps,
  // floor/ceiling slabs (a ray passes a slab only where it is open above a ramp).
  // ---- explore map (XV values per tile per floor) ----
  // The value a tile gets once the lidar reaches it (from what is really there)
  xCellVal(f, c) {
    const v = this.floors[f][c];
    if (v === CELL_WALL) return XV.SOLID;
    if (v === CELL_CRACKED) return XV.CRACK;
    if (isShaft(v)) return v === CELL_SHAFT_LOW ? XV.SH_BOT : (v === CELL_SHAFT_HIGH ? XV.SH_TOP : XV.SH_MID);
    if (v === CELL_RAMP) return XV.RAMP;
    if (v === CELL_VOID || (this.liftCells && this.liftCells.has(c))) return XV.HOLE;
    if (this._xHaz && this._xHaz[f * GRID_SIZE * GRID_SIZE + c]) return XV.HAZ;
    return XV.OPEN;
  },

  // Tiles holding a live hazard (turbines, bulkheads, live laser grids, barrels, grates); refreshed every couple of seconds
  xHazRefresh() {
    const B = this.autoBlocked(), X = this.xgrid;
    this._xHaz = B;
    if (!X) return;
    for (let i = 0; i < X.length; i++) {
      if (X[i] === XV.OPEN && B[i]) { X[i] = XV.HAZ; this.xgridDirty = true; }
      else if (X[i] === XV.HAZ && !B[i]) { X[i] = XV.OPEN; this.xgridDirty = true; }
    }
  },

  // A new sector: load its plotted map from the device, or start empty
  xgridBegin(key) {
    const n = GRID_SIZE * GRID_SIZE * this.nFloors;
    this.xgrid = new Uint8Array(n); this.xgridKey = key; this.xgridDirty = true; this._xHaz = null; this.xroute = null;
    try {
      const all = JSON.parse(localStorage.getItem(XMAP_KEY) || '{}'), e = all[key + '|' + this.nFloors];
      if (e && typeof e === 'string') {
        const bin = atob(e);
        for (let i = 0; i < bin.length && i * 2 < n; i++) { const b = bin.charCodeAt(i); this.xgrid[i * 2] = b & 15; if (i * 2 + 1 < n) this.xgrid[i * 2 + 1] = b >> 4; }
      }
    } catch (_) {}
  },

  // Save it (two tiles per byte, the last 6 sectors kept)
  xgridSave() {
    if (!this.xgrid || !this.xgridKey) return;
    try {
      let bin = '';
      const X = this.xgrid;
      for (let i = 0; i < X.length; i += 2) bin += String.fromCharCode((X[i] & 15) | ((X[i + 1] || 0) << 4));
      const all = JSON.parse(localStorage.getItem(XMAP_KEY) || '{}'), k = this.xgridKey + '|' + this.nFloors;
      delete all[k]; all[k] = btoa(bin);
      const keys = Object.keys(all);
      while (keys.length > 6) delete all[keys.shift()];
      localStorage.setItem(XMAP_KEY, JSON.stringify(all));
    } catch (_) {}
  },

  // Debug: the map as text, one floor (0-9 as digits, 10 as X; the current route drawn as 9)
  xmapDump(f) {
    const G = GRID_SIZE, GG = G * G, X = this.xgrid;
    if (!X) return '';
    if (f === undefined) f = this.floorOfY(this.missile.pos.y);
    const route = new Set(this.xroute || []);
    let out = '';
    for (let z = 0; z < G; z++) {
      for (let x = 0; x < G; x++) { const i = f * GG + z * G + x; const v = route.has(i) ? XV.ROUTE : X[i]; out += v === 10 ? 'X' : String(v); }
      out += '\n';
    }
    return out;
  },

  // The map: the explore map drawn as the radar's base layer. Floors stacked: current floor 100%, others 5%.
  drawXmapBase() {
    const ctx = this.radarCtx, size = this.radarCanvas.width, G = GRID_SIZE, GG = G * G, sc = size / G, X = this.xgrid;
    const curF = Math.max(0, Math.min(this.nFloors - 1, this.floorOfY(this.missile.pos.y)));
    const COL = ['', '#5a6b63', '#7fe8ff', '#33c7e0', '#1f8fa8', '#14482f', '#3fd18a', '#c9a6ff', '#ff3344', '#ffdd55', '#ffaa00'];
    if (!this._xLayer) { this._xLayer = document.createElement('canvas'); this._xLayer.width = size; this._xLayer.height = size; }
    const now = performance.now();
    if (X && (this.xgridDirty || this._xLayerF !== curF) && now - (this._xLayerT || 0) > 250) {     // redraw the tiles only when the map changed
      this._xLayerT = now; this.xgridDirty = false; this._xLayerF = curF;
      const lc = this._xLayer.getContext('2d');
      lc.clearRect(0, 0, size, size);
      lc.fillStyle = '#020604'; lc.fillRect(0, 0, size, size);
      const order = [];
      for (let f = 0; f < this.nFloors; f++) if (f !== curF) order.push(f);
      order.push(curF);
      for (const f of order) {
        lc.globalAlpha = f === curF ? 1 : FLOOR_DIM_VIS;
        for (let i = 0; i < GG; i++) { const v = X[f * GG + i]; if (!v) continue; lc.fillStyle = COL[v]; lc.fillRect((i % G) * sc, ((i / G) | 0) * sc, sc, sc); }
      }
      lc.globalAlpha = 1;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this._xLayer, 0, 0);
    // the route (9) on the current floor
    if (this.xroute && this.xroute.length) {
      ctx.fillStyle = COL[XV.ROUTE];
      for (const i of this.xroute) { if (((i / GG) | 0) !== curF) continue; const c = i % GG; ctx.fillRect((c % G) * sc + sc * 0.2, ((c / G) | 0) * sc + sc * 0.2, sc * 0.6, sc * 0.6); }
    }
    // the new autopilot's smoothed legs (white) and look-ahead point (cyan)
    const PL = this.pilot && this.pilot.active && this.pilot.plan;
    if (PL) {
      const toX = (x) => (x / CELL_SIZE + G * 0.5) * sc, toZ = (z) => (z / CELL_SIZE + G * 0.5) * sc;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(toX(this.missile.pos.x), toZ(this.missile.pos.z));
      for (let n = PL.k; n < PL.wps.length; n++) ctx.lineTo(toX(PL.wps[n].x), toZ(PL.wps[n].z));
      ctx.stroke();
      const cmd = this.pilot.cmd;
      if (cmd && cmd.carrot) { ctx.fillStyle = '#00e5ff'; ctx.beginPath(); ctx.arc(toX(cmd.carrot.x), toZ(cmd.carrot.z), sc * 0.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.font = 'bold 13px monospace'; ctx.fillStyle = 'rgba(255,221,85,0.85)'; ctx.fillText('F' + (curF + 1) + '/' + this.nFloors, 6, 15);
  },

  castRay(ox, oy, oz, dx, dy, dz, range) {
    const G = GRID_SIZE, GG = G * G, H = WALL_H, NF = this.nFloors;
    let gx = worldToGridX(ox), gz = worldToGridZ(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const bx = (gx - G * 0.5 + (dx > 0 ? 1 : 0)) * CELL_SIZE, bz = (gz - G * 0.5 + (dz > 0 ? 1 : 0)) * CELL_SIZE;
    let tMaxX = Math.abs(dx) > 1e-6 ? (bx - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-6 ? (bz - oz) / dz : Infinity;
    const tDX = Math.abs(dx) > 1e-6 ? CELL_SIZE / Math.abs(dx) : Infinity;
    const tDZ = Math.abs(dz) > 1e-6 ? CELL_SIZE / Math.abs(dz) : Infinity;
    let tEnter = 0, faceX = true;
    for (let guard = 0; guard < 64; guard++) {
      if (gx < 0 || gz < 0 || gx >= G || gz >= G) return null;
      if (tEnter > range) return null;
      const c = gz * G + gx;
      const tExit = Math.min(tMaxX, tMaxZ), t1 = Math.min(tExit, range);
      const yE = oy + dy * tEnter;
      let fc = this.floorOfY(yE);
      const XG = this.xgrid;
      if (XG) {                                                           // plot every tile the ray reaches...
        const xi = fc * GG + c, xv = this.xCellVal(fc, c); if (XG[xi] !== xv) { XG[xi] = xv; this.xgridDirty = true; }
        // ...and the opening right above / below it (holes, atriums, the open space over a ramp), so floors connect on the map
        if (fc > 0 && this.floors[fc][c] === CELL_VOID) { const j = xi - GG, w = this.xCellVal(fc - 1, c); if (XG[j] !== w) { XG[j] = w; this.xgridDirty = true; } }
        if (fc + 1 < NF && this.floors[fc + 1][c] === CELL_VOID) { const j = xi + GG, w = this.xCellVal(fc + 1, c); if (XG[j] !== w) { XG[j] = w; this.xgridDirty = true; } }
      }
      if (tEnter > 0) {
        const v = this.floors[fc][c];
        if (v === CELL_WALL || v === CELL_CRACKED) {
          this._hit.set(ox + dx * tEnter, yE, oz + dz * tEnter);
          this._hitSeg = this.isEdgeWall(this._hit, gx, gz, faceX, faceX ? stepX : stepZ, fc);
          this._hitCls = v === CELL_CRACKED ? 2 : (this._hitSeg >= 0 ? 4 : 1);
          return this._hit;
        }
        if (isShaft(v)) {
          const lo = fc * H + (v - CELL_SHAFT_LOW) * H / 3, hi = lo + H / 3;
          if (yE < lo || yE > hi) {
            this._hit.set(ox + dx * tEnter, yE, oz + dz * tEnter);
            const face = faceX ? (stepX > 0 ? 1 : 0) : (stepZ > 0 ? 3 : 2);
            const yl = yE - fc * H, kk = yl < 0.4 ? 0 : (yl > H - 0.4 ? 1 : -1);
            this._hitSeg = kk >= 0 ? fc * FLOOR_SEG + (c * 4 + face) * 4 + kk : -1;
            this._hitShaft = c;
            this._hitCls = 3;
            return this._hit;
          }
        }
        if (v === CELL_RAMP) {
          const r = this.ramps[this.rampAt.get(fc * GG + c)];
          const hx = ox + dx * tEnter, hz = oz + dz * tEnter;
          if (r && yE < this.rampHeight(r, hx, hz)) {
            this._hit.set(hx, yE, hz);
            this._hitSeg = -1; this._hitCls = 1; this._hitRamp = r.id;
            return this._hit;
          }
        }
      }
      let ta = tEnter;
      for (let k = 0; k < 4; k++) {
        const v = this.floors[fc][c], fb = fc * H, ft = fb + H;
        let tHit = Infinity, kind = 0, tCross = Infinity, nf = fc, r = null;
        if (v === CELL_RAMP) {
          r = this.ramps[this.rampAt.get(fc * GG + c)];
          if (r) {
            const g0 = (oy + dy * ta) - this.rampHeight(r, ox + dx * ta, oz + dz * ta);
            const gs = dy - ((dx * r.dx + dz * r.dz) / r.len) * H;
            if (gs < -1e-9) { const tr = ta - g0 / gs; if (tr >= ta && tr <= t1) { tHit = tr; kind = 5; } }
          }
        } else if (isShaft(v)) {
          const lo = fb + (v - CELL_SHAFT_LOW) * H / 3, hi = lo + H / 3;
          let tb = Infinity;
          if (dy < -1e-6 && lo > fb + 0.01) tb = (lo - oy) / dy;
          else if (dy > 1e-6 && hi < ft - 0.01) tb = (hi - oy) / dy;
          if (tb >= ta && tb <= t1) { tHit = tb; kind = 3; }
        }
        if (dy < -1e-9) {
          const tp = (fb - oy) / dy;
          if (tp <= t1 && tp < tHit) {
            if (fc > 0 && v === CELL_VOID) { tCross = tp; nf = fc - 1; } else { tHit = tp; kind = 1; }
          }
        } else if (dy > 1e-9) {
          const tp = (ft - oy) / dy;
          if (tp <= t1 && tp < tHit) {
            if (fc + 1 < NF && this.floors[fc + 1][c] === CELL_VOID) { tCross = tp; nf = fc + 1; } else { tHit = tp; kind = 2; }
          }
        }
        if (tHit <= t1 && tHit <= tCross) {
          if (tHit >= range) return null;
          this._hit.set(ox + dx * tHit, oy + dy * tHit, oz + dz * tHit);
          if (kind === 5) { this._hitSeg = -1; this._hitCls = 1; this._hitRamp = r.id; }
          else if (kind === 3) { this._hitSeg = -1; this._hitShaft = c; this._hitCls = 3; }
          else {
            this._hitSeg = this.isEdgeFloor(this._hit, gx, gz, fc, kind === 1 ? 0 : 1);
            if (this._hitSeg < 0 && NF > 1) this._hitSeg = this.rimNear(this._hit, gx, gz, kind === 1 ? fc : fc + 1);
            this._hitCls = this._hitSeg >= 0 ? 4 : 1;
          }
          return this._hit;
        }
        if (tCross <= t1) { fc = nf; ta = tCross; continue; }
        break;
      }
      tEnter = tExit;
      if (tMaxX < tMaxZ) { gx += stepX; tMaxX += tDX; faceX = true; } else { gz += stepZ; tMaxZ += tDZ; faceX = false; }
    }
    return null;
  },

  // Edge detection for crisp outlines: wall/floor and wall/ceiling seams, and wall corners (inner and outer).
  cellSolid(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) return true;
    return isWallLike(this.floors[this._ef][gz * GRID_SIZE + gx]);
  },

  isEdgeWall(h, gx, gz, faceX, step, f = 0) {
    const E = 0.38;
    this._ef = f;
    const face = faceX ? (step > 0 ? 1 : 0) : (step > 0 ? 3 : 2);
    const id = (k) => f * FLOOR_SEG + ((gz * GRID_SIZE + gx) * 4 + face) * 4 + k;
    const hy = h.y - f * WALL_H;
    if (hy < E) return id(0);
    if (hy > WALL_H - E) return id(1);
    const along = faceX ? h.z - (gz - GRID_SIZE * 0.5) * CELL_SIZE : h.x - (gx - GRID_SIZE * 0.5) * CELL_SIZE;
    for (const side of [-1, 1]) {
      if (side < 0 ? along > E : along < CELL_SIZE - E) continue;
      if (this.isCornerEdge(gx, gz, face, side)) return id(side < 0 ? 2 : 3);
    }
    return -1;
  },

  // Is the vertical edge at one end of a wall face a real corner (the wall ends, or another wall meets it)?
  isCornerEdge(gx, gz, face, side) {
    const faceX = face < 2;
    const step = (face === 1 || face === 3) ? 1 : -1;          // direction the ray travelled into the wall
    const nx = faceX ? gx : gx + side, nz = faceX ? gz + side : gz;
    const fx = faceX ? gx - step : nx, fz = faceX ? nz : gz - step;
    // shaft cells continue a wall face (they are slabs), but a shaft in front is a hole, not an inner corner
    return !this.cellSolid(nx, nz) || this.cellFullWall(fx, fz);
  },

  cellFullWall(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) return true;
    const v = this.floors[this._ef][gz * GRID_SIZE + gx];
    return v === CELL_WALL || v === CELL_CRACKED;
  },

  // An edge is real only on a full wall whose face looks into open floor (never inside or on a shaft).
  validSeg(seg) {
    if (seg >= LIFT_BASE) return ((seg - LIFT_BASE) >> 2) < this.lifts.length;
    if (seg >= RIM_BASE) return this.validRim(seg);
    if (seg >= FEAT_BASE) return ((seg - FEAT_BASE) >> 3) < this.ramps.length;
    this._ef = 0;
    if (seg >= SHAFT_SEG_BASE) {
      const c = Math.floor((seg - SHAFT_SEG_BASE) / 32), k = (seg - SHAFT_SEG_BASE) % 32;
      if (c < 0 || c >= GRID_SIZE * GRID_SIZE || !isShaft(this.grid[c])) return false;
      if (k < 4) return true;
      return this.shaftFaceFramed(c % GRID_SIZE, Math.floor(c / GRID_SIZE), (k - 4) >> 2);
    }
    const fl = Math.floor(seg / FLOOR_SEG);
    if (fl >= this.nFloors) return false;
    this._ef = fl;
    const grid = this.floors[fl];
    seg = seg % FLOOR_SEG;
    const k = seg & 3, face = (seg >> 2) & 3, cell = seg >> 4;
    const gx = cell % GRID_SIZE, gz = Math.floor(cell / GRID_SIZE);
    if (isShaft(grid[cell]) && k < 2 && gx > 0 && gz > 0 && gx < GRID_SIZE - 1 && gz < GRID_SIZE - 1) {
      // a shaft's wall face: floor seam if there is a slab below the opening, ceiling seam if there is one above
      const band = grid[cell] - CELL_SHAFT_LOW;
      if (k === 0 ? band === 0 : band === 2) return false;
      const fx = face === 0 ? gx + 1 : (face === 1 ? gx - 1 : gx), fz = face === 2 ? gz + 1 : (face === 3 ? gz - 1 : gz);
      return !isWallLike(grid[fz * GRID_SIZE + fx]);
    }
    if (!this.cellFullWall(gx, gz) || gx <= 0 || gz <= 0 || gx >= GRID_SIZE - 1 || gz >= GRID_SIZE - 1) return false;
    const fx = face === 0 ? gx + 1 : (face === 1 ? gx - 1 : gx), fz = face === 2 ? gz + 1 : (face === 3 ? gz - 1 : gz);
    const fc = fz * GRID_SIZE + fx, fv = grid[fc];
    if (isWallLike(fv)) return false;
    if (k >= 2) return this.isCornerEdge(gx, gz, face, k === 2 ? -1 : 1);
    if (k === 0) return isWalkable(fv);                                                    // no floor seam along a ramp or a void
    return !(fl + 1 < this.nFloors && this.floors[fl + 1][fc] === CELL_VOID);              // no ceiling seam under an opening
  },

  isEdgeFloor(h, gx, gz, f = 0, k = 0) {
    const E = 0.38;
    this._ef = f;
    const lx = h.x - (gx - GRID_SIZE * 0.5) * CELL_SIZE, lz = h.z - (gz - GRID_SIZE * 0.5) * CELL_SIZE;
    const id = (cx, cz, face) => f * FLOOR_SEG + ((cz * GRID_SIZE + cx) * 4 + face) * 4 + k;
    if (lx < E && this.cellSolid(gx - 1, gz) && gx > 0) return id(gx - 1, gz, 0);   // (validSeg decides if it is real)
    if (lx > CELL_SIZE - E && this.cellSolid(gx + 1, gz) && gx < GRID_SIZE - 1) return id(gx + 1, gz, 1);
    if (lz < E && this.cellSolid(gx, gz - 1) && gz > 0) return id(gx, gz - 1, 2);
    if (lz > CELL_SIZE - E && this.cellSolid(gx, gz + 1) && gz < GRID_SIZE - 1) return id(gx, gz + 1, 3);
    return -1;
  },

  // Draw a whole edge (4 units) as a tight line of bright dots, once per edge.
  revealSeg(seg, birth) {
    if (seg < 0 || this.revealedSeg.has(seg) || !this.validSeg(seg)) return;
    this.revealedSeg.add(seg);
    if (this.segCount >= this.SEG_CAP) return;
    if (seg >= LIFT_BASE) { this.addLiftSeg(seg, birth); return; }
    if (seg >= RIM_BASE) { this.addRimSeg(seg, birth); return; }
    if (seg >= FEAT_BASE) { this.addRampSeg(seg, birth); return; }
    if (seg >= SHAFT_SEG_BASE) { this.addShaftSeg(seg, birth); return; }
    const fy = Math.floor(seg / FLOOR_SEG) * WALL_H;
    seg = seg % FLOOR_SEG;
    const k = seg & 3, face = (seg >> 2) & 3, cell = seg >> 4;
    const gx = cell % GRID_SIZE, gz = Math.floor(cell / GRID_SIZE);
    const x0 = (gx - GRID_SIZE * 0.5) * CELL_SIZE, z0 = (gz - GRID_SIZE * 0.5) * CELL_SIZE, off = 0.04;
    const px = face === 0 ? x0 + CELL_SIZE + off : (face === 1 ? x0 - off : 0);
    const pz = face === 2 ? z0 + CELL_SIZE + off : (face === 3 ? z0 - off : 0);
    const pt = (along, y, out) => { if (face < 2) { out[0] = px; out[1] = y; out[2] = z0 + along; } else { out[0] = x0 + along; out[1] = y; out[2] = pz; } };
    const A = [0, 0, 0], B = [0, 0, 0];
    if (k < 2) { const y = fy + (k === 0 ? 0.04 : WALL_H - 0.04); pt(0, y, A); pt(CELL_SIZE, y, B); }
    else { const along = k === 2 ? 0 : CELL_SIZE; pt(along, fy, A); pt(along, fy + WALL_H, B); }
    const i = this.segCount++;
    this.segA.set(A, i * 3); this.segB.set(B, i * 3); this.segBirth[i] = birth; this.segKind[i] = 0;
    this.segSlot.set(seg + fy / WALL_H * FLOOR_SEG, i);
    if (this.segDirtyMin < 0 || i < this.segDirtyMin) this.segDirtyMin = i;
    if (i > this.segDirtyMax) this.segDirtyMax = i;
  },

  // Ramp outline: the two side seams up the slope, its foot and top, and the lintel over its mouth.
  revealRamp(id, birth) {
    for (let k = 0; k < 3; k++) this.revealSeg(FEAT_BASE + id * 8 + k, birth);
  },

  addRampSeg(seg, birth) {
    const id = (seg - FEAT_BASE) >> 3, k = (seg - FEAT_BASE) & 7, r = this.ramps[id];
    if (!r) return;
    const hw = CELL_SIZE * 0.5 - 0.04, H = WALL_H, y0 = r.f * H + 0.04, y1 = (r.f + 1) * H + 0.04;
    const tx = r.sx + r.dx * r.len, tz = r.sz + r.dz * r.len;
    const A = [0, 0, 0], B = [0, 0, 0];
    if (k < 2) {
      const sd = k === 0 ? 1 : -1;
      A[0] = r.sx + r.px * hw * sd; A[1] = y0; A[2] = r.sz + r.pz * hw * sd;
      B[0] = tx + r.px * hw * sd; B[1] = y1; B[2] = tz + r.pz * hw * sd;
    } else {
      const cx = k === 3 ? tx : r.sx, cz = k === 3 ? tz : r.sz;
      const y = k === 2 ? y0 : (k === 3 ? y1 : (r.f + 1) * H - 0.04);
      A[0] = cx + r.px * hw; A[1] = y; A[2] = cz + r.pz * hw;
      B[0] = cx - r.px * hw; B[1] = y; B[2] = cz - r.pz * hw;
    }
    const i = this.segCount++;
    this.segA.set(A, i * 3); this.segB.set(B, i * 3); this.segBirth[i] = birth; this.segKind[i] = 0;
    this.segSlot.set(seg, i);
    if (this.segDirtyMin < 0 || i < this.segDirtyMin) this.segDirtyMin = i;
    if (i > this.segDirtyMax) this.segDirtyMax = i;
  },

  // Shaft outline: 4 lines along the tunnel's inside corners (k 0-3) and a rectangle around each opening (k 4+).
  revealShaftCell(c0, birth) {
    // outline a whole connected shaft (same opening height); kept for tools/tests, the scanner reveals cell by cell
    if (this.revealedSeg.has(SHAFT_SEG_BASE + c0 * 32)) return;
    const v0 = this.grid[c0], stack = [c0], seen = new Set([c0]);
    while (stack.length) {
      const c = stack.pop();
      this.revealShaftCellOnly(c, birth);
      const x = c % GRID_SIZE, z = Math.floor(c / GRID_SIZE);
      for (const [dx, dz] of PROBE_DIRS) {
        const n = (z + dz) * GRID_SIZE + (x + dx);
        if (x + dx < 0 || z + dz < 0 || x + dx >= GRID_SIZE || z + dz >= GRID_SIZE || seen.has(n) || this.grid[n] !== v0) continue;
        seen.add(n); stack.push(n);
      }
    }
  },

  // Shafts are mapped gradually: only the tunnel cells the scanner actually hits get their outline.
  // From further away only the opening's frame is drawn; the tunnel's inside is mapped up close, a cell at a time.
  revealShaftCellOnly(c, birth, near = true) {
    this._ef = 0;
    const gx = c % GRID_SIZE, gz = Math.floor(c / GRID_SIZE);
    if (near) for (let k = 0; k < 4; k++) this.revealSeg(SHAFT_SEG_BASE + c * 32 + k, birth);
    for (let f = 0; f < 4; f++) {
      if (!this.shaftFaceFramed(gx, gz, f)) continue;
      if (!near) {   // far: only real openings (open floor beyond), not dead-end caps deep inside
        const nx = gx + (f === 0 ? 1 : f === 1 ? -1 : 0), nz = gz + (f === 2 ? 1 : f === 3 ? -1 : 0);
        if (this.cellSolid(nx, nz)) continue;
      }
      for (let j = 0; j < 4; j++) this.revealSeg(SHAFT_SEG_BASE + c * 32 + 4 + f * 4 + j, birth);
    }
  },

  shaftAlongX(gx, gz) { return !this.cellFullWall(gx - 1, gz) || !this.cellFullWall(gx + 1, gz); },

  // A shaft face gets a rectangle if it is an opening (open floor beyond) or a dead end (rock beyond, along the tunnel).
  shaftFaceFramed(gx, gz, f) {
    const nx = gx + (f === 0 ? 1 : f === 1 ? -1 : 0), nz = gz + (f === 2 ? 1 : f === 3 ? -1 : 0);
    if (!this.cellSolid(nx, nz)) return true;
    return this.cellFullWall(nx, nz) && (f < 2) === this.shaftAlongX(gx, gz);
  },

  addShaftSeg(seg, birth) {
    const c = Math.floor((seg - SHAFT_SEG_BASE) / 32), k = (seg - SHAFT_SEG_BASE) % 32;
    const gx = c % GRID_SIZE, gz = Math.floor(c / GRID_SIZE), v = this.grid[c];
    const lo = (v - CELL_SHAFT_LOW) * WALL_H / 3, hi = lo + WALL_H / 3, e = 0.04, C = CELL_SIZE;
    const x0 = (gx - GRID_SIZE * 0.5) * C, z0 = (gz - GRID_SIZE * 0.5) * C;
    const yl = lo + e, yh = hi - e;
    // the tunnel runs along x when its x-neighbours are not solid rock
    const alongX = this.shaftAlongX(gx, gz);
    let A, B;
    if (k < 4) {
      const y = (k & 1) ? yh : yl, side = k < 2 ? e : C - e;
      if (alongX) { A = [x0, y, z0 + side]; B = [x0 + C, y, z0 + side]; }
      else { A = [x0 + side, y, z0]; B = [x0 + side, y, z0 + C]; }
    } else {
      const f = (k - 4) >> 2, j = (k - 4) & 3;
      const onX = f < 2;                                     // mouth plane perpendicular to x
      const nx = gx + (f === 0 ? 1 : f === 1 ? -1 : 0), nz = gz + (f === 2 ? 1 : f === 3 ? -1 : 0);
      const oe = this.cellSolid(nx, nz) ? -e : e;           // dead-end cap: inside the tunnel
      const plane = onX ? (f === 0 ? x0 + C + oe : x0 - oe) : (f === 2 ? z0 + C + oe : z0 - oe);
      const pt = (w, y) => onX ? [plane, y, z0 + w] : [x0 + w, y, plane];
      if (j === 0) { A = pt(e, yl); B = pt(C - e, yl); }
      else if (j === 1) { A = pt(e, yh); B = pt(C - e, yh); }
      else { const w = j === 2 ? e : C - e; A = pt(w, yl); B = pt(w, yh); }
    }
    const i = this.segCount++;
    this.segA.set(A, i * 3); this.segB.set(B, i * 3); this.segBirth[i] = birth; this.segKind[i] = 1;
    this.segSlot.set(seg, i);
    if (this.segDirtyMin < 0 || i < this.segDirtyMin) this.segDirtyMin = i;
    if (i > this.segDirtyMax) this.segDirtyMax = i;
  },

  flushSegs() {
    if (this.segDirtyMin < 0) return;
    const a = this.segDirtyMin, n = this.segDirtyMax - a + 1;
    for (const [attr, w] of [[this.segAAttr, 3], [this.segBAttr, 3], [this.segTAttr, 1], [this.segKAttr, 1]]) {

      attr.addUpdateRange(a * w, n * w);
      attr.needsUpdate = true;
    }
    this.segGeo.instanceCount = this.segCount;
    this.segDirtyMin = -1; this.segDirtyMax = -1;
  },

  addEdgeDot(x, y, z, cell, birth) {
    const slot = this.lidarHead;
    const old = this.slotVox[slot];
    if (old >= 0) this.vox[old] = 0;
    this.slotVox[slot] = -2 - cell;                      // negative: an edge dot belonging to this wall cell
    this.lidarPos[slot * 3] = x; this.lidarPos[slot * 3 + 1] = y; this.lidarPos[slot * 3 + 2] = z;
    this.lidarInfo[slot * 2] = 4; this.lidarInfo[slot * 2 + 1] = birth;
    if (this.lidarDirtyFrom < 0) { this.lidarDirtyFrom = slot; this.lidarDirtyN = 0; }
    this.lidarDirtyN++;
    this.lidarHead = (slot + 1) % LIDAR_CAP;
    if (this.lidarCount < LIDAR_CAP) this.lidarCount++;
  },

  lidarOrigin() {
    if (this.missile.active && (this.state === 'PLAYING' || this.state === 'RESPAWNING')) return this.missile.pos;
    if (this.state === 'KILLCAM') return this.killCamTarget;
    return this.camera.position;
  },

  // Multi-floor visibility (visual only: reads the rocket's height, writes the uniform and this.floorVis). The floor the rocket is on is drawn
  // at 1.0, every other floor at FLOOR_DIM_VIS; it eases over about a third of a second and snaps on a new sector. The same per-floor value
  // multiplies the thermal objects (onBeforeRender hook) and the barrel instances. No shared material is edited: thermal materials are
  // shared by heat, so the factor goes into the per-object uFade uniform at draw time.
  updateFloorVis(dt) {
    const FV = this.floorVis, nF = this.nFloors, cur = this.floorOfY(this.missile.pos.y);
    const snap = this._fvKey !== this.lidarKey || this._fvN !== nF;
    this._fvKey = this.lidarKey; this._fvN = nF;
    const k = snap ? 1 : 1 - Math.exp(-dt * 9);
    for (let f = 0; f < FV.length; f++) FV[f] += ((nF <= 1 || f === cur ? 1 : FLOOR_DIM_VIS) - FV[f]) * k;
    this.lidarUniforms.uFV.value.set(FV[0], FV[1], FV[2]);
  },

  // visibility of whatever hangs at height y (thermal objects, barrels)
  floorVisAt(y) {
    const FV = this.floorVis; if (!FV) return 1;
    const f = Math.floor((y + 0.3) / WALL_H);
    return FV[f < 0 ? 0 : (f > 2 ? 2 : f)];
  },

  // Per-frame visuals, at the display's refresh rate with the real frame time: shader uniforms, GPU uploads, fades, the HUD badge
  // and the frame-rate guard. Nothing here changes what the simulation can see: exploration is stepLidar() below.
  updateLidar(dt) {
    this.lidarTime += dt;
    this.thermalTime.value = this.lidarTime;
    const P = this.lidarParams();
    const U = this.lidarUniforms;
    const o = this.lidarOrigin();
    U.uTime.value = this.lidarTime;
    U.uOrigin.value.copy(o);
    U.uGlow.value = P.glow;
    U.uMem.value = P.mem;
    U.uRange.value = P.range;
    U.uCrack.value = P.deep >= 1 ? 0.9 : 0;
    U.uScale.value = Math.min(window.devicePixelRatio || 1, 2);
    U.uDot.value = P.dot;
    this.lidarSweep = (this.lidarSweep + dt * 4.2) % (Math.PI * 2);
    U.uSweep.value = this.lidarSweep;
    U.uPulse.value = ((this.lidarTime % 1.6) / 1.6) * P.range * 1.3;      // scanner wavefront expanding from the rocket
    this.thermalRes.value = this.segUniforms.uRes.value.y || 1;
    // dot colour follows what the autopilot is doing (fades over about half a second); manual flight stays green
    const pl = this.pilot, mode = pl && pl.active && this.missile.auto ? pl.mission : 'EXPLORE';
    const mc = LIDAR_MODE_COLORS[mode] || LIDAR_MODE_COLORS.EXPLORE, k = 1 - Math.exp(-dt * 4);
    const cm = U.uMode.value; cm.r += (mc[0] - cm.r) * k; cm.g += (mc[1] - cm.g) * k; cm.b += (mc[2] - cm.b) * k;

    this.updateFloorVis(dt);
    this.flushDots();
    this.flushSegs();
    if (this.fadeSet) this.updateFades(dt);
    this.renderer.getDrawingBufferSize(this.segUniforms.uRes.value);
    this.segUniforms.uWidth.value = 2.2 * Math.min(window.devicePixelRatio || 1, 2);

    // performance guard: drop the ray count if frames get slow, recover when fast again
    if (this.frameMs > 24) { this.lidarSlowT += dt; this.lidarFastT = 0; } else if (this.frameMs < 15) { this.lidarFastT += dt; this.lidarSlowT = 0; }
    if (this.lidarSlowT > 1.5) { this.lidarThrottle = Math.max(0.35, this.lidarThrottle * 0.8); this.lidarSlowT = 0; }
    if (this.lidarFastT > 3 && this.lidarThrottle < 1) { this.lidarThrottle = Math.min(1, this.lidarThrottle * 1.15); this.lidarFastT = 0; }

    const badge = document.getElementById('cam-mode-badge');
    if (badge) this.cText(badge, `LIDAR ${Math.round(P.range)}m · THERMAL ${Math.round(P.thermal)}m\nSCAN ${this.scanPercent()}%${this.lidarThrottle < 0.95 ? ' · AUTO-THROTTLED' : ''}`);
  },

  // Fixed-step exploration (called from stepSimulation at 60 Hz): the lidar rays that plot the explore map and the scan percentage,
  // the thermal contacts, and the hazard layer of the map. It runs on the simulation clock from the missile's own pose, never from
  // the camera or the frame time, so the autopilot (which reads all of this) flies a sector the same on a 60 Hz and a 144 Hz screen.
  stepLidar(dt) {
    const st = this.state, m = this.missile;
    const o = this.lidarSimOrigin();
    const P = this.lidarParams();
    const scanning = st === 'PLAYING' || st === 'READY' || st === 'BRIEFING';
    if (scanning) {
      this.markSeen(o.x, o.z, o.y);
      // the focus cone points where the nose points
      if (st === 'PLAYING') { _e1.set(m.pitch + (m.wobP || 0) + (m.brakeP || 0), m.yaw + (m.wobY || 0), 0, 'YXZ'); _v8.copy(_fwd).applyEuler(_e1); }
      else if (st === 'READY') { _e1.set(m.pitch, m.yaw, 0, 'YXZ'); _v8.copy(_fwd).applyEuler(_e1); }
      else _v8.set(0, -1.4, -26).normalize();                              // the briefing camera looks across the spawn area
      const fyaw = Math.atan2(_v8.x, _v8.z), fpitch = Math.asin(Math.max(-1, Math.min(1, _v8.y)));
      const cone = P.coneDeg * Math.PI / 180;
      const rows = P.rows;
      const ox = o.x, oy = Math.max(0.05, Math.min(this.nFloors * WALL_H - 0.05, o.y)), oz = o.z;
      const now = this.lidarTime;                                           // dot birth time for the shader (visual clock)
      for (let i = 0; i < P.rays; i++) {
        let yaw, pit;
        if (Math.random() < P.focus) {
          const r = Math.sqrt(Math.random()) * cone, a = Math.random() * Math.PI * 2;
          yaw = fyaw + Math.cos(a) * r;
          pit = fpitch + Math.sin(a) * r;
        } else {
          yaw = Math.random() * Math.PI * 2;
          const row = Math.floor(Math.random() * rows);
          pit = (-60 + (120 * (row + 0.5)) / rows) * Math.PI / 180 + (Math.random() - 0.5) * 0.01;
        }
        const cp = Math.cos(pit);
        this._hitRamp = -1;
        const h = this.castRay(ox, oy, oz, Math.sin(yaw) * cp, Math.sin(pit), Math.cos(yaw) * cp, P.range);
        if (h) { const c = this._hitCls; this.addDot(h.x, h.y, h.z, c === 4 ? 1 : c, now, h.y - Math.sin(pit) * 0.15); if (c === 4) this.revealSeg(this._hitSeg, now); else if (c === 3) this.revealShaftCellOnly(this._hitShaft, now, Math.hypot(h.x - ox, h.y - oy, h.z - oz) < SHAFT_REVEAL_R); if (this._hitRamp >= 0) this.revealRamp(this._hitRamp, now); }
      }
      if (P.deep >= 2) this.deepScanReveal(o, P);
      if (this.lifts.length) this.revealLifts(o, P);
    }
    this.lidarThermalT = (this.lidarThermalT || 0) - dt;
    if (this.lidarThermalT <= 0) { this.lidarThermalT = 0.05; this.updateThermal(o, P); }
    if (this.radarSoftDirty && (this._radarRebuildT = (this._radarRebuildT || 0) - dt) <= 0) { this._radarRebuildT = 0.25; this.radarSoftDirty = false; this.radarDirty = true; }
    // hazard layer of the explore map (turbines, bulkheads, live laser grids, barrels, grates): every 2 s of game time
    this._hazRefreshT = (this._hazRefreshT || 0) - dt;
    if (this._hazRefreshT <= 0) { this._hazRefreshT = 2; this.xHazRefresh(); }
  },

  // Where the simulation scans from: the rocket in flight, the kill-cam target, the spawn point while waiting to launch, the centre of
  // the briefing camera's orbit. (lidarOrigin() below is the on-screen one and follows the real camera.)
  lidarSimOrigin() {
    const m = this.missile, st = this.state;
    if (m.active && (st === 'PLAYING' || st === 'RESPAWNING')) return m.pos;
    if (st === 'KILLCAM') return this.killCamTarget;
    if (st === 'BRIEFING') return (this._briefO || (this._briefO = new THREE.Vector3())).set(this.spawnPos.x, 3.6, this.spawnPos.z + 4);
    return this.spawnPos;
  }
,

  // Deep scan 2-3: outline secret chambers (and shafts at 3) that lie within scan range, plus reveal their power-ups.
  deepScanReveal(o, P) {
    const G = GRID_SIZE;
    const outline = (gx, gz, lo, hi, cls) => {
      const x0 = (gx - G * 0.5) * CELL_SIZE, z0 = (gz - G * 0.5) * CELL_SIZE;
      for (let k = 0; k <= 5; k++) {
        const f = k / 5 * CELL_SIZE;
        for (const y of [lo + 0.1, hi - 0.1]) {
          this.addDot(x0 + f, y, z0 + 0.05, cls, -100); this.addDot(x0 + f, y, z0 + CELL_SIZE - 0.05, cls, -100);
          this.addDot(x0 + 0.05, y, z0 + f, cls, -100); this.addDot(x0 + CELL_SIZE - 0.05, y, z0 + f, cls, -100);
        }
      }
    };
    if (!this._deepDone) this._deepDone = new Set();
    for (const b of this.breakables) {
      if (b.kind !== 'secret' || !b.active) continue;
      for (const ci of b.chamber) {
        if (this._deepDone.has(ci)) continue;
        const gx = ci % G, gz = Math.floor(ci / G);
        if (Math.hypot(gridToWorldX(gx) - o.x, gridToWorldZ(gz) - o.z) > P.range) continue;
        this._deepDone.add(ci);
        outline(gx, gz, 0, WALL_H, 2);
      }
    }
    if (P.deep >= 3) {
      for (let c = 0; c < G * G; c++) {
        const v = this.grid[c];
        if (!isShaft(v) || this._deepDone.has(c)) continue;
        const gx = c % G, gz = Math.floor(c / G);
        if (Math.hypot(gridToWorldX(gx) - o.x, gridToWorldZ(gz) - o.z) > P.range) continue;
        this._deepDone.add(c);
        const lo = (v - CELL_SHAFT_LOW) * WALL_H / 3;
        outline(gx, gz, lo, lo + WALL_H / 3, 3);
      }
    }
  },

  // 3D line of sight that lets shaft openings through at the right height.
  los3(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(dist / 1.0));
    let pf = this.floorOfY(ay);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (i < steps && this.isGridSolid(x, z, y)) return false;
      if (this.nFloors > 1) {
        const f = this.floorOfY(y);
        if (f !== pf) { if (!this.slabOpen(x, z, Math.max(f, pf))) return false; pf = f; }
      }
    }
    return true;
  },

  setThermalVis(obj, on) {
    if (!obj) return;
    obj.userData._tv = on;            // logical visibility (targeting, radar) changes at once; the look fades
    this.fadeSet.add(obj);
  },

  // Thermal objects are only drawn within thermal range and with a clear line of sight (or through one wall at max level).
  updateThermal(o, P) {
    const R = P.thermal;
    const see = (x, y, z, extra = 0) => {
      const d = Math.hypot(x - o.x, y - o.y, z - o.z);
      if (d > R + extra) return false;
      if (this.los3(o.x, o.y, o.z, x, y, z)) return true;
      return P.pen > 0 && this.wallThickness3(o.x, o.y, o.z, x, y, z) <= P.pen * 1.05;
    };
    // heat mark: a contact stays visible for a moment after it leaves sight
    const mark = (obj, v) => {
      if (v) { obj._seenT = this.gameClock; return true; }
      return P.mark > 0 && this.gameClock - (obj._seenT === undefined ? -99 : obj._seenT) < P.mark;
    };
    for (const t of this.targets) this.setThermalVis(t.mesh, t.active && mark(t, see(t.pos.x, t.pos.y, t.pos.z, 2)));
    for (const tu of this.turrets) { const v = tu.active && mark(tu, see(tu.pos.x, tu.pos.y - 0.6, tu.pos.z)); this.setThermalVis(tu.mesh, v); this.setThermalVis(tu.stem, v); }
    for (const bh of this.bulkheads) this.setThermalVis(bh.mesh, see(bh.x, 3.6, bh.z, 2));
    for (const tb of this.turbines) this.setThermalVis(tb.mesh, see(tb.pos.x, tb.pos.y, tb.pos.z, 3));
    for (const g of this.grates) this.setThermalVis(g.mesh, g.active && see(g.pos.x, g.pos.y, g.pos.z, 2));
    for (const ez of this.ecmZones) this.setThermalVis(ez.mesh, see(ez.pos.x, ez.pos.y, ez.pos.z, ez.radius));
    for (const l of this.lasers) {
      const lx = Math.max(l.xMin, Math.min(l.xMax, o.x));
      const v = mark(l, see(lx, 3.5, l.z, 1) || see(l.relayPos.x, l.relayPos.y, l.relayPos.z));
      l.thermalVis = v;
      // the control box is bracketed (and can be locked / shot) only when thermal itself sees the box: inside thermal range with a
      // clear line (or through walls with penetration), like sentries and turrets. Seeing the beams alone is not enough.
      l.boxVis = Boolean(l.lockRef && l.lockRef.active && !l.disabled && see(l.relayPos.x, l.relayPos.y, l.relayPos.z));
      for (const e of l.emitters) this.setThermalVis(e, v);
      this.setThermalVis(l.relayGroup, v);
    }
    for (const pk of this.pickups) {
      let v = pk.active && see(pk.pos.x, pk.pos.y, pk.pos.z);
      const d = Math.hypot(pk.pos.x - o.x, pk.pos.z - o.z);
      if (pk.active && !v && d < P.range && ((P.deep >= 2 && !pk.owner.shaft) || (P.deep >= 3 && pk.owner.shaft))) v = true;
      this.setThermalVis(pk.mesh, v);
    }
    let newContact = false;
    for (const s of this.sentries) {
      const v = (s.active || s.dying) && mark(s, see(s.pos.x, s.pos.y + 1.4, s.pos.z));
      if (v && !s.thermalVis && s.active) newContact = true;
      s.thermalVis = v;
    }
    if (newContact && this.state === 'PLAYING' && this.lidarTime - (this._contactT || -9) > 2.5) {
      this._contactT = this.lidarTime;
      this.pushFeed('THERMAL CONTACT', 'red');
    }
    for (const b of this.barrels) b.thermalVis = b.active && see(b.pos.x, b.pos.y, b.pos.z);
  },

  // Map memory: snapshot the current sector's dots, keep the last few sectors in memory and on the device.
  lidarSnapshot() {
    if (!this.lidarKey || this.lidarCount === 0) return;
    const idx = [], cls = [];
    for (let s = 0; s < this.lidarCount; s++) { const vi = this.slotVox[s]; if (vi >= 0) { idx.push(vi); cls.push(this.vox[vi]); } }
    const rec = { idx: Uint32Array.from(idx), cls: Uint8Array.from(cls), seg: Uint32Array.from(this.revealedSeg), seen: this.seenCells.slice(), t: Date.now() };
    this.lidarMemory.delete(this.lidarKey);
    this.lidarMemory.set(this.lidarKey, rec);
    const keep = this.lidarParams(true).keep;
    while (this.lidarMemory.size > keep) this.lidarMemory.delete(this.lidarMemory.keys().next().value);
    this.idbPut(this.lidarKey, rec, keep);
    this.xgridSave();
  },

  lidarLoad(rec) {
    this._noMark = !!rec.seen;
    for (let i = 0; i < rec.idx.length; i++) {
      const vi = rec.idx[i];
      const ix = vi % VOX_N, iz = Math.floor(vi / VOX_N) % VOX_N, iy = Math.floor(vi / (VOX_N * VOX_N));
      const j = (vi * 2654435761) >>> 0;
      const jx = ((j & 255) / 255 - 0.5) * VOX * 0.7, jz = (((j >> 8) & 255) / 255 - 0.5) * VOX * 0.7, jy = (((j >> 16) & 255) / 255 - 0.5) * VOX * 0.7;
      this.addDot(ix * VOX + VOX * 0.5 - VOX_HALF + jx, Math.max(0.02, Math.min(this.nFloors * WALL_H - 0.02, iy * VOX + VOX * 0.5 + jy)), iz * VOX + VOX * 0.5 - VOX_HALF + jz, rec.cls[i] || 1, -1000);
    }
    this._noMark = false;
    if (rec.seen) {
      const n = Math.min(rec.seen.length, this.seenCells.length);
      for (let i = 0; i < n; i++) if (rec.seen[i] && !this.seenCells[i]) { this.seenCells[i] = 1; if (this.cellCountsOpen(i)) this.seenOpen++; }
      this.radarSoftDirty = true;
    }
    if (rec.seg) for (const sg of rec.seg) this.revealSeg(sg, -1000);
    this.flushSegs();
    this.flushDots();
  },

  // Called when a sector starts. Same sector + seed (retry / replay) keeps its map; otherwise load or start blank.
  lidarBegin(key) {
    this._edgeTotal = null;
    this._deepDone = new Set();
    if (key === this.lidarKey) return;
    this.lidarSnapshot();
    this.clearDots();
    this.lidarKey = key;
    this.xgridBegin(key);
    const mem = this.lidarMemory.get(key);
    if (mem) { this.lidarLoad(mem); return; }
    this.idbGet(key).then((rec) => { if (rec && this.lidarKey === key && rec.idx) this.lidarLoad({ idx: new Uint32Array(rec.idx), cls: new Uint8Array(rec.cls), seg: rec.seg ? new Uint32Array(rec.seg) : null, seen: rec.seen ? new Uint8Array(rec.seen) : null }); }).catch(() => {});
  },

  idbOpen() {
    if (!this._idb) {
      this._idb = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('nikita-lidar', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('maps', { keyPath: 'key' });
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    }
    return this._idb;
  },

  idbPut(key, rec, keep) {
    this.idbOpen().then((db) => {
      const tx = db.transaction('maps', 'readwrite');
      const st = tx.objectStore('maps');
      st.put({ key, t: rec.t, idx: rec.idx.buffer.slice(0), cls: rec.cls.buffer.slice(0), seg: rec.seg.buffer.slice(0), seen: rec.seen ? rec.seen.buffer.slice(0) : null });
      const all = st.getAll();
      all.onsuccess = () => {
        const list = (all.result || []).sort((a, b) => b.t - a.t);
        for (const r of list.slice(keep)) st.delete(r.key);
      };
    }).catch(() => {});
  },

  idbGet(key) {
    return this.idbOpen().then((db) => new Promise((res) => {
      const rq = db.transaction('maps', 'readonly').objectStore('maps').get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    }));
  },
};
