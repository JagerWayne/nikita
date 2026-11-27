/* Pooled particle / light VFX system. */
import * as THREE from 'three';
import { SPEED_MODES } from './constants.js';
import { _c1, _dummy, _f1, _f2, _f3, _v1, hash01 } from './math.js';

export class VFXSystem {
  constructor(scene) {
    this.scene = scene;

    this.lightPool = [];
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.PointLight(0xffaa44, 0, 26, 2);
      pl.position.set(0, -100, 0);
      scene.add(pl);
      this.lightPool.push({ light: pl, life: 0, maxLife: 1, maxIntensity: 0 });
    }
    this.lightCursor = 0;

    this.maxParticles = 600;
    this.pCursor = 0;
    this.pData = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.pData.push({
        active: false, life: 0, maxLife: 1,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        startScale: 0.2, endScale: 1.5,
        cStart: new THREE.Color(), cMid: new THREE.Color(), cEnd: new THREE.Color(),
        rise: 0
      });
    }
    const pGeo = new THREE.IcosahedronGeometry(1, 1);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.86, depthWrite: false });
    this.pMesh = new THREE.InstancedMesh(pGeo, pMat, this.maxParticles);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    scene.add(this.pMesh);

    this.maxSparks = 420;
    this.sCursor = 0;
    this.sData = [];
    for (let i = 0; i < this.maxSparks; i++) {
      this.sData.push({
        active: false, life: 0, maxLife: 1,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        scale: 1, gravity: 18, color: new THREE.Color(0xffcc55)
      });
    }
    const sGeo = new THREE.BoxGeometry(0.08, 0.08, 0.65);
    const sMat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.sMesh = new THREE.InstancedMesh(sGeo, sMat, this.maxSparks);
    this.sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sMesh.frustumCulled = false;
    scene.add(this.sMesh);

    this.maxRings = 32;
    this.rCursor = 0;
    this.rData = [];
    for (let i = 0; i < this.maxRings; i++) {
      this.rData.push({
        active: false, life: 0, maxLife: 0.35,
        pos: new THREE.Vector3(), rotX: Math.PI * 0.5, rotZ: 0,
        maxScale: 9, color: new THREE.Color(0xffaa33)
      });
    }
    const rGeo = new THREE.RingGeometry(0.76, 1.0, 24);
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false
    });
    this.rMesh = new THREE.InstancedMesh(rGeo, rMat, this.maxRings);
    this.rMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rMesh.frustumCulled = false;
    scene.add(this.rMesh);

    this.maxSpheres = 32;
    this.bCursor = 0;
    this.bData = [];
    for (let i = 0; i < this.maxSpheres; i++) {
      this.bData.push({
        active: false, life: 0, maxLife: 0.25,
        pos: new THREE.Vector3(), startScale: 0.5, endScale: 4.5,
        color: new THREE.Color(0xffffcc)
      });
    }
    const bGeo = new THREE.SphereGeometry(1, 12, 10);
    const bMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false
    });
    this.bMesh = new THREE.InstancedMesh(bGeo, bMat, this.maxSpheres);
    this.bMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bMesh.frustumCulled = false;
    scene.add(this.bMesh);

    this.maxTracers = 128;
    this.tCursor = 0;
    this.tData = [];
    for (let i = 0; i < this.maxTracers; i++) {
      this.tData.push({
        active: false, life: 0,
        pos: new THREE.Vector3(), vel: new THREE.Vector3()
      });
    }
    const tGeo = new THREE.BoxGeometry(0.11, 0.11, 1.5);
    const tMat = new THREE.MeshBasicMaterial({ color: 0xff2233, blending: THREE.AdditiveBlending, transparent: true });
    this.tMesh = new THREE.InstancedMesh(tGeo, tMat, this.maxTracers);
    this.tMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tMesh.frustumCulled = false;
    scene.add(this.tMesh);

    this.resetAll();
  }

  resetAll() {
    _dummy.position.set(0, -500, 0);
    _dummy.scale.set(0.0001, 0.0001, 0.0001);
    _dummy.updateMatrix();
    for (let i = 0; i < this.maxParticles; i++) { this.pData[i].active = false; this.pMesh.setMatrixAt(i, _dummy.matrix); }
    for (let i = 0; i < this.maxSparks; i++)    { this.sData[i].active = false; this.sMesh.setMatrixAt(i, _dummy.matrix); }
    for (let i = 0; i < this.maxRings; i++)     { this.rData[i].active = false; this.rMesh.setMatrixAt(i, _dummy.matrix); }
    for (let i = 0; i < this.maxSpheres; i++)   { this.bData[i].active = false; this.bMesh.setMatrixAt(i, _dummy.matrix); }
    for (let i = 0; i < this.maxTracers; i++)   { this.tData[i].active = false; this.tMesh.setMatrixAt(i, _dummy.matrix); }
    this.pMesh.instanceMatrix.needsUpdate = true;
    this.sMesh.instanceMatrix.needsUpdate = true;
    this.rMesh.instanceMatrix.needsUpdate = true;
    this.bMesh.instanceMatrix.needsUpdate = true;
    this.tMesh.instanceMatrix.needsUpdate = true;
    for (const lp of this.lightPool) { lp.life = 0; lp.light.intensity = 0; }
  }

  spawnLightFlash(pos, colorHex, intensity, duration) {
    const slot = this.lightPool[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lightPool.length;
    slot.light.position.copy(pos);
    slot.light.color.setHex(colorHex);
    slot.light.intensity = intensity;
    slot.maxIntensity = intensity;
    slot.life = duration;
    slot.maxLife = duration;
  }

  spawnParticle(pos, vel, startScale, endScale, maxLife, cStart, cMid, cEnd, rise = 0.8) {
    const p = this.pData[this.pCursor];
    this.pCursor = (this.pCursor + 1) % this.maxParticles;
    p.active = true;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.startScale = startScale;
    p.endScale = endScale;
    p.cStart.setHex(cStart);
    p.cMid.setHex(cMid);
    p.cEnd.setHex(cEnd);
    p.rise = rise;
  }

  spawnSpark(pos, vel, maxLife, colorHex, scale = 1.0, gravity = 18.0) {
    const s = this.sData[this.sCursor];
    this.sCursor = (this.sCursor + 1) % this.maxSparks;
    s.active = true;
    s.life = maxLife;
    s.maxLife = maxLife;
    s.pos.copy(pos);
    s.vel.copy(vel);
    s.scale = scale;
    s.gravity = gravity;
    s.color.setHex(colorHex);
  }

  spawnRing(pos, maxScale, maxLife, colorHex, rotX = Math.PI * 0.5, rotZ = 0) {
    const r = this.rData[this.rCursor];
    this.rCursor = (this.rCursor + 1) % this.maxRings;
    r.active = true;
    r.life = maxLife;
    r.maxLife = maxLife;
    r.pos.copy(pos);
    r.maxScale = maxScale;
    r.rotX = rotX;
    r.rotZ = rotZ;
    r.color.setHex(colorHex);
  }

  spawnBlastSphere(pos, startScale, endScale, maxLife, colorHex) {
    const b = this.bData[this.bCursor];
    this.bCursor = (this.bCursor + 1) % this.maxSpheres;
    b.active = true;
    b.life = maxLife;
    b.maxLife = maxLife;
    b.pos.copy(pos);
    b.startScale = startScale;
    b.endScale = endScale;
    b.color.setHex(colorHex);
  }

  spawnTracer(pos, vel) {
    const t = this.tData[this.tCursor];
    this.tCursor = (this.tCursor + 1) % this.maxTracers;
    t.active = true;
    t.life = 1.8;
    t.pos.copy(pos);
    t.vel.copy(vel);
  }

  spawnExplosion(pos, radius = 6.5, power = 1.0) {
    this.spawnBlastSphere(pos, 0.6 * power, 3.2 * power, 0.08, 0xffffdd);
    this.spawnLightFlash(pos, 0xffbb55, 22 * power, 0.35);

    this.spawnRing(pos, radius * 1.45, 0.34, 0xffaa33, Math.PI * 0.5, 0);
    this.spawnRing(pos, radius * 1.15, 0.28, 0xffdd77, Math.PI * 0.15, Math.random() * 3.14);
    this.spawnBlastSphere(pos, 1.0 * power, radius * 0.72, 0.28, 0xff5511);

    const fireCount = Math.floor(18 * power);
    for (let i = 0; i < fireCount; i++) {
      _f1.set((Math.random() - 0.5) * 2, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 2).normalize();
      const spd = (2.5 + Math.random() * 8.5) * power;
      _f2.copy(_f1).multiplyScalar(spd);
      _f3.copy(pos).addScaledVector(_f1, Math.random() * 0.8);
      this.spawnParticle(_f3, _f2, 0.45 * power, (1.6 + Math.random() * 1.5) * power, 0.45 + Math.random() * 0.48, 0xffffcc, 0xff5511, 0x221a18, 2.4);
    }

    const sparkCount = Math.floor(28 * power);
    for (let i = 0; i < sparkCount; i++) {
      _f1.set((Math.random() - 0.5) * 2, Math.random() * 1.2 + 0.1, (Math.random() - 0.5) * 2).normalize();
      const spd = (10 + Math.random() * 22) * power;
      _f2.copy(_f1).multiplyScalar(spd);
      const col = Math.random() < 0.5 ? 0xffee77 : 0xff7722;
      this.spawnSpark(pos, _f2, 0.45 + Math.random() * 0.75, col, 0.8 + Math.random() * 0.9, 22);
    }
  }

  spawnScrapeSparks(pos, reflectDir, count = 14) {
    this.spawnLightFlash(pos, 0xffcc66, 6, 0.08);
    for (let i = 0; i < count; i++) {
      _f1.copy(reflectDir);
      _f1.x += (Math.random() - 0.5) * 0.85;
      _f1.y += (Math.random() - 0.3) * 0.85;
      _f1.z += (Math.random() - 0.5) * 0.85;
      _f1.normalize().multiplyScalar(8 + Math.random() * 14);
      this.spawnSpark(pos, _f1, 0.25 + Math.random() * 0.35, i % 2 === 0 ? 0xffffaa : 0xff9922, 0.65, 18);
    }
  }

  update(dt, checkGridSolid, onTracerHitMissile, missilePos, missileActive, godMode) {
    for (let i = 0; i < this.lightPool.length; i++) {
      const lp = this.lightPool[i];
      if (lp.life > 0) {
        lp.life -= dt;
        const frac = Math.max(0, lp.life / lp.maxLife);
        lp.light.intensity = lp.maxIntensity * frac * frac;
      } else if (lp.light.intensity !== 0) {
        lp.light.intensity = 0;
      }
    }

    let pDirty = false;
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.pData[i];
      if (!p.active) continue;
      pDirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.pMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const u = 1.0 - p.life / p.maxLife;
      p.vel.multiplyScalar(1 - dt * 2.2);
      p.vel.y += p.rise * dt;
      p.pos.addScaledVector(p.vel, dt);
      const sc = p.startScale + (p.endScale - p.startScale) * Math.pow(u, 0.65);
      _dummy.position.copy(p.pos);
      _dummy.rotation.set(u * 2.1, u * 1.7, 0);
      _dummy.scale.setScalar(sc * (1 - u * 0.25));
      _dummy.updateMatrix();
      this.pMesh.setMatrixAt(i, _dummy.matrix);

      if (u < 0.35) {
        _c1.copy(p.cStart).lerp(p.cMid, u / 0.35);
      } else {
        _c1.copy(p.cMid).lerp(p.cEnd, (u - 0.35) / 0.65);
      }
      this.pMesh.setColorAt(i, _c1);
    }
    if (pDirty) {
      this.pMesh.instanceMatrix.needsUpdate = true;
      if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
    }

    let sDirty = false;
    for (let i = 0; i < this.maxSparks; i++) {
      const s = this.sData[i];
      if (!s.active) continue;
      sDirty = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.sMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      s.vel.y -= s.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.08) {
        s.pos.y = 0.08;
        s.vel.y = Math.abs(s.vel.y) * 0.45;
        s.vel.x *= 0.72;
        s.vel.z *= 0.72;
      }
      const frac = s.life / s.maxLife;
      _dummy.position.copy(s.pos);
      _v1.copy(s.pos).add(s.vel);
      _dummy.lookAt(_v1);
      _dummy.scale.set(s.scale * frac, s.scale * frac, s.scale * (0.4 + frac));
      _dummy.updateMatrix();
      this.sMesh.setMatrixAt(i, _dummy.matrix);
      this.sMesh.setColorAt(i, s.color);
    }
    if (sDirty) {
      this.sMesh.instanceMatrix.needsUpdate = true;
      if (this.sMesh.instanceColor) this.sMesh.instanceColor.needsUpdate = true;
    }

    let rDirty = false;
    for (let i = 0; i < this.maxRings; i++) {
      const r = this.rData[i];
      if (!r.active) continue;
      rDirty = true;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.rMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const u = 1.0 - r.life / r.maxLife;
      const sc = 0.4 + r.maxScale * (1 - Math.pow(1 - u, 3));
      _dummy.position.copy(r.pos);
      _dummy.rotation.set(r.rotX, 0, r.rotZ);
      _dummy.scale.setScalar(sc);
      _dummy.updateMatrix();
      this.rMesh.setMatrixAt(i, _dummy.matrix);
      _c1.copy(r.color).multiplyScalar(1 - u);
      this.rMesh.setColorAt(i, _c1);
    }
    if (rDirty) {
      this.rMesh.instanceMatrix.needsUpdate = true;
      if (this.rMesh.instanceColor) this.rMesh.instanceColor.needsUpdate = true;
    }

    let bDirty = false;
    for (let i = 0; i < this.maxSpheres; i++) {
      const b = this.bData[i];
      if (!b.active) continue;
      bDirty = true;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.bMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      const u = 1.0 - b.life / b.maxLife;
      const sc = b.startScale + (b.endScale - b.startScale) * Math.pow(u, 0.5);
      _dummy.position.copy(b.pos);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(sc);
      _dummy.updateMatrix();
      this.bMesh.setMatrixAt(i, _dummy.matrix);
      _c1.copy(b.color).multiplyScalar(1 - u);
      this.bMesh.setColorAt(i, _c1);
    }
    if (bDirty) {
      this.bMesh.instanceMatrix.needsUpdate = true;
      if (this.bMesh.instanceColor) this.bMesh.instanceColor.needsUpdate = true;
    }

    let tDirty = false;
    for (let i = 0; i < this.maxTracers; i++) {
      const t = this.tData[i];
      if (!t.active) continue;
      tDirty = true;
      t.life -= dt;
      t.pos.addScaledVector(t.vel, dt);

      const hitWall = t.pos.y < 0.1 || checkGridSolid(t.pos.x, t.pos.z, t.pos.y);
      let hitMissile = false;
      if (missileActive && !godMode && t.pos.distanceToSquared(missilePos) < 0.95 * 0.95) {
        hitMissile = true;
      }

      if (t.life <= 0 || hitWall || hitMissile) {
        t.active = false;
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.tMesh.setMatrixAt(i, _dummy.matrix);
        if (hitMissile) onTracerHitMissile(t.pos);
        continue;
      }

      _dummy.position.copy(t.pos);
      _v1.copy(t.pos).add(t.vel);
      _dummy.lookAt(_v1);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.tMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (tDirty) {
      this.tMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/* Hover RCS thruster plumes on the flown rocket: four preallocated cones (two down jets under the airframe, a left and a right
   lateral jet at the nose) parented to the rocket group. Visual only: update() runs in the render path, allocates nothing and writes
   only these meshes. Down jets follow the climb demand, the lateral jets the yaw rate and sideways drift. */
export class RcsPlumes {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.visible = false;
    parent.add(this.group);
    const geo = new THREE.ConeGeometry(0.5, 1, 8, 1, true);
    geo.translate(0, 0.5, 0);                                  // base on the nozzle (y = 0), tip trailing along +y
    // x, y, z of the nozzle, then the rotation that points the plume away from the airframe, then base length / width
    const spec = [
      [0, -0.13, -0.4, Math.PI, 0, 0.55, 0.075], [0, -0.13, 0.4, Math.PI, 0, 0.55, 0.075],   // down jets (rocket forward is -z)
      [0.13, 0, -0.42, 0, -Math.PI / 2, 0.38, 0.055], [-0.13, 0, -0.42, 0, Math.PI / 2, 0.38, 0.055]   // right and left lateral jets
    ];
    this.jets = [];
    for (let i = 0; i < spec.length; i++) {
      const s = spec[i];
      const mat = new THREE.MeshBasicMaterial({ color: i < 2 ? 0x9fe8ff : 0xffd8a0, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s[0], s[1], s[2]);
      mesh.rotation.set(s[3], 0, s[4]);
      mesh.visible = false;
      this.group.add(mesh);
      this.jets.push({ mesh, mat, len: s[5], width: s[6], level: 0 });
    }
    this.geo = geo;
  }

  // on: hover is active and the rocket is airborne. climb: stick (-1..1, up positive). yawRate rad/s (left positive). side m/s (right positive).
  update(dt, on, climb, yawRate, side, time) {
    const k = 1 - Math.exp(-dt * 14), J = this.jets;
    const down = on ? (climb >= 0 ? Math.min(1, 0.28 + climb * 0.72) : Math.max(0.1, 0.28 + climb * 0.18)) : 0;   // hover holds the rocket up; more thrust to climb
    const right = on ? Math.min(1, Math.max(0, yawRate) * 0.9 + Math.max(0, side) * 0.4) : 0;                      // right jet pushes the nose / drift left
    const left = on ? Math.min(1, Math.max(0, -yawRate) * 0.9 + Math.max(0, -side) * 0.4) : 0;
    let any = false;
    for (let i = 0; i < J.length; i++) {
      const j = J[i], tgt = i < 2 ? down : (i === 2 ? right : left);
      j.level += (tgt - j.level) * k;
      if (j.level < 0.03) { j.mesh.visible = false; continue; }
      any = true;
      const flick = 1 + 0.12 * Math.sin(time * 0.05 + i * 1.7), l = j.level;
      j.mesh.visible = true;
      j.mesh.scale.set(j.width * (0.7 + 0.3 * l), j.len * (0.25 + 0.75 * l) * flick, j.width * (0.7 + 0.3 * l));
      j.mat.opacity = 0.25 + 0.65 * l;
    }
    this.group.visible = any;
  }

  dispose() {
    this.group.removeFromParent();
    for (let i = 0; i < this.jets.length; i++) this.jets[i].mat.dispose();
    this.geo.dispose();
  }
}

/* Main thruster: a three-layer flame on the rear nozzle (outer plasma cone, mid cone, white core) plus the exhaust smoke / heat trail and the
   floor and wall wash dust. Everything is preallocated: the cones are made once, smoke and dust are spawned into the VFX system's particle pool
   through scratch objects owned here, and the flicker comes from the visual clock and hash noise (never Math.random: the simulation's
   random stream is not touched). Render path only: update() and emit() read the rocket and write only these meshes and the particle pool. */
export class ThrusterFX {
  constructor(parent, vfx) {
    this.vfx = vfx; this.exitZ = 1.2; this.boost = 0; this.smokeAcc = 0; this.dustAcc = 0; this.sparkAcc = 0; this.n = 0;
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.c = new THREE.Color(); this.c2 = new THREE.Color();
    this.group = new THREE.Group(); this.group.visible = false; parent.add(this.group);
    const layer = (r, h, seg, col, op) => {
      const geo = new THREE.ConeGeometry(r, h, seg, 1, true);
      geo.translate(0, h * 0.5, 0);                       // base on the nozzle, tip trailing
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI * 0.5;                    // +y (the tip) -> +z (aft)
      this.group.add(mesh);
      return { mesh, mat, geo };
    };
    this.outer = layer(0.2, 1.3, 14, 0xff7a1a, 0.4);
    this.mid = layer(0.13, 0.95, 12, 0xffc060, 0.6);
    this.core = layer(0.065, 0.62, 10, 0xffffff, 0.95);
  }

  setExit(z) { this.exitZ = z; this.group.position.z = z; }

  // on: engine burning. thr: thrust level (about 0.35 idle .. 1.2 full). mode: speed mode 1..3 (3 = afterburner / boost). time: visual clock (ms).
  update(dt, on, thr, mode, time) {
    this.group.visible = on;
    if (!on) { this.boost = 0; return; }
    this.boost += ((mode === 3 ? 1 : 0) - this.boost) * Math.min(1, dt * 6);
    const b = this.boost, flick = 1 + 0.1 * Math.sin(time * 0.085) + 0.06 * Math.sin(time * 0.21 + 1.3) + 0.04 * Math.sin(time * 0.47 + 0.4);
    const len = (0.22 + 0.62 * thr) * (1 + 0.55 * b) * flick, wid = 0.6 + 0.3 * thr + 0.3 * b;
    this.outer.mesh.scale.set(wid, len, wid);
    this.mid.mesh.scale.set(wid * 0.9, len * 0.78, wid * 0.9);
    this.core.mesh.scale.set(wid * 0.8, len * 0.5 * (1 + 0.1 * Math.sin(time * 0.31)), wid * 0.8);
    // colour: deep orange at idle, bright amber at cruise, cyan-white plasma in the afterburner
    this.c.setHex(0xff6a12).lerp(this.c2.setHex(SPEED_MODES[2].exhaustColor), Math.min(1, thr * 1.2)).lerp(this.c2.setHex(0x3fd4ff), b);
    this.outer.mat.color.copy(this.c);
    this.mid.mat.color.setHex(0xffb347).lerp(this.c2.setHex(0x8fe6ff), b);
    this.core.mat.color.setHex(0xfff2d0).lerp(this.c2.setHex(0xffffff), b);
    const o = 0.5 + 0.3 * flick;                          // seen from behind the flame must not hide the rocket: kept translucent
    this.outer.mat.opacity = (0.22 + 0.2 * thr) * o; this.mid.mat.opacity = (0.35 + 0.2 * thr) * o; this.core.mat.opacity = 0.6 + 0.3 * b;
  }

  /* Smoke trail, floor / wall wash and damage sparks. rp: interpolated pose {pos, pitch, yaw, roll}; m: the missile state; thr as above. */
  emit(dt, rp, m, thr, burning, smoke, time) {
    const vfx = this.vfx, pos = this.p, vel = this.v, e = this.e;
    e.set(rp.pitch, rp.yaw, rp.roll, 'YXZ');
    const hurt = m.hull < 50 ? (50 - Math.max(0, m.hull)) / 50 : 0;               // 0 healthy .. 1 nearly destroyed
    if (burning && smoke) {
      this.smokeAcc += dt * (5 + 14 * thr + 10 * this.boost) * (1 + 1.2 * hurt);
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1; this.n++;
        pos.set((hash01(this.n * 1.7) - 0.5) * 0.05, (hash01(this.n * 2.3) - 0.5) * 0.05, this.exitZ + 0.1).applyEuler(e).add(rp.pos);
        vel.set((hash01(this.n * 3.1) - 0.5) * 0.6, (hash01(this.n * 4.7) - 0.5) * 0.6, 0.8 + 1.6 * thr).applyEuler(e).addScaledVector(m.vel, 0.88);   // mostly carried along: it fades before it reaches the chase camera
        // the camera chases from behind: the trail stays small and dark so it never fogs the view (a hot glow at birth, then soot)
        vfx.spawnParticle(pos, vel, 0.05 + 0.03 * thr, 0.18 + 0.2 * thr + 0.35 * hurt, 0.35 + 0.3 * thr + 0.5 * hurt,
          this.boost > 0.5 ? 0x3f8fb0 : 0x8a5a2a, hurt > 0.2 ? 0x141414 : 0x2e2e2e, 0x080808, 0.25 + 0.4 * hurt);
      }
      if (hurt > 0.2) {                                    // a damaged hull sheds sparks from the nozzle
        this.sparkAcc += dt * (3 + 9 * hurt);
        while (this.sparkAcc >= 1) {
          this.sparkAcc -= 1; this.n++;
          pos.set(0, 0, this.exitZ).applyEuler(e).add(rp.pos);
          vel.set((hash01(this.n * 5.3) - 0.5) * 5, (hash01(this.n * 6.1) - 0.2) * 4, 3 + 5 * hash01(this.n * 7.7)).applyEuler(e).addScaledVector(m.vel, 0.5);
          vfx.spawnSpark(pos, vel, 0.3 + 0.3 * hash01(this.n * 8.9), hash01(this.n * 9.7) < 0.5 ? 0xffee77 : 0xff7722, 0.6, 14);
        }
      }
    }
    // wash: dust kicked up from the floor under a low rocket, and from a close wall beside it (probe distances come from the flight step)
    const P = m.probe;
    if (P && m.drop <= 0) {
      const spd = m.vel.length(), push = 0.4 + 0.6 * Math.min(1, thr);
      const dF = P.d, kF = dF < 1.8 ? (1.8 - dF) / 1.8 : 0;                          // floor: 0 at 1.8 m .. 1 on the ground
      const side = P.l < P.r ? P.l : P.r, kW = side < 1.3 && spd > 1.5 ? (1.3 - side) / 1.3 : 0;
      this.dustAcc += dt * (kF * 9 * push + kW * 6);
      while (this.dustAcc >= 1) {
        this.dustAcc -= 1; this.n++;
        const a = hash01(this.n * 1.31) * Math.PI * 2;
        if (kF >= kW) {                                    // floor wash: a ring of dust rolling outward
          pos.set(rp.pos.x + Math.cos(a) * 0.3, rp.pos.y - dF - 0.35, rp.pos.z + Math.sin(a) * 0.3);
          vel.set(Math.cos(a) * (1.4 + 2.2 * push), 0.35, Math.sin(a) * (1.4 + 2.2 * push));
          vfx.spawnParticle(pos, vel, 0.05, 0.3, 0.45 + 0.25 * hash01(this.n * 2.9), 0x5c625a, 0x2c302c, 0x0a0b0a, 0.12);
        } else {                                           // wall wash: dust and a spark skimming along the wall
          e.set(0, rp.yaw, 0, 'YXZ');
          const sgn = P.l < P.r ? -1 : 1;
          pos.set(sgn * (side + 0.45), 0, 0).applyEuler(e).add(rp.pos);
          vel.set(-sgn * 0.5, (hash01(this.n * 3.7) - 0.4) * 0.8, 1.5).applyEuler(e).addScaledVector(m.vel, 0.4);
          vfx.spawnParticle(pos, vel, 0.04, 0.22, 0.35, 0x5c625a, 0x2c302c, 0x0a0b0a, 0.1);
          if (hash01(this.n * 4.9) < 0.18) vfx.spawnSpark(pos, vel, 0.25, 0xffcc77, 0.5, 16);
        }
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const L of [this.outer, this.mid, this.core]) { L.mat.dispose(); L.geo.dispose(); }
  }
}
