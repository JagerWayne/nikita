/* Hostile systems for NikitaGame: sentries and their navigation, CIWS turrets, lasers, turbines, decoys and other facility objects. */
import * as THREE from 'three';
import {
  CELL_RAMP, CELL_SIZE, CELL_VOID, DECOY_LIFE, DECOY_RADIUS, GRID_SIZE, GUN_NOISE, HEAR_MIN, HEAR_RANGE,
  HEAR_WALL_DAMP, HOSTILE_ACCURACY, RAMP_LEN, SENTRY_VISION, WALL_H, isWalkable
} from './constants.js';
import {
  PULSE_ARM_END, PULSE_OFF_END, pulseCycleTime, sweeperHX, sweeperVY, turretRange, twinSweepY
} from './hazards.js';
import {
  _aimR, _aimU, _c1, _dummy, _profileSent, _up, _v1, _v2, _v7, _v8, blendProfile, gridToWorldX, gridToWorldZ
} from './math.js';

export const enemiesMethods = {

  // Is the slab at y = k*WALL_H (between floors k-1 and k) open at (x, z)? Only above a ramp.
  slabOpen(x, z, k) {
    if (k <= 0 || k >= this.nFloors) return false;
    const c = this.cellAt(x, z);
    return c >= 0 && this.floors[k][c] === CELL_VOID;
  },

  // Point solidity including floors, ceilings and ramps (pad = clearance from horizontal surfaces).
  pointBlocked(x, y, z, pad = 0) {
    const c = this.cellAt(x, z);
    if (c < 0) return true;
    if (this.isGridSolid(x, z, y)) return true;
    const f = this.floorOfY(y);
    return y < this.groundAt(f, c, x, z) + pad || y > this.ceilAt(f, c) - pad;
  },

  // Wall thickness in cells along a 3D segment; each closed slab crossed counts as half a cell.
  wallThickness3(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return 0;
    const steps = Math.ceil(dist / 1.0);
    let solid = 0, pf = this.floorOfY(ay), slabs = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (this.isGridSolid(x, z, y)) solid++;
      const f = this.floorOfY(y);
      if (f !== pf) { if (!this.slabOpen(x, z, Math.max(f, pf))) slabs++; pf = f; }
    }
    return (solid * (dist / steps)) / CELL_SIZE + slabs * 0.5;
  },


  // ---- sentry navigation across floors ----
  // What a sentry at (x, z) could stand on, near its current feet height: flat floor, a ramp, or the ramp under a void.
  sentrySupport(x, z, s) {
    const c = this.cellAt(x, z);
    if (c < 0) return null;
    const GG = GRID_SIZE * GRID_SIZE, y = s.groundY === undefined ? s.pos.y : s.groundY;
    let best = null, bd = 1.1;
    for (const f of [s.floor || 0, (s.floor || 0) + 1, (s.floor || 0) - 1]) {
      if (f < 0 || f >= this.nFloors) continue;
      const v = this.floors[f][c];
      let h = null, sf = f;
      if (isWalkable(v)) h = f * WALL_H;
      else if (v === CELL_RAMP) h = this.rampHeight(this.ramps[this.rampAt.get(f * GG + c)], x, z);
      else if (v === CELL_VOID && f > 0 && this.floors[f - 1][c] === CELL_RAMP) { sf = f - 1; h = this.rampHeight(this.ramps[this.rampAt.get(sf * GG + c)], x, z); }
      if (h === null) continue;
      const d = Math.abs(h - y);
      if (d < bd) { bd = d; best = { f: sf, y: h }; }
    }
    return best;
  },

  // Move a sentry to (nx, nz) if it can stand there; follows ramps and changes floor at the top / bottom.
  sentryStep(s, nx, nz) {
    const sp = this.sentrySupport(nx, nz, s);
    if (!sp) return false;
    s.pos.x = nx; s.pos.z = nz;
    s.groundY = sp.y; s.pos.y = sp.y;
    s.floor = sp.f;
    if (sp.y >= (sp.f + 1) * WALL_H - 0.01 && sp.f + 1 < this.nFloors) s.floor = sp.f + 1;
    return true;
  },

  navLinksBuild() {
    const G = GRID_SIZE, GG = G * G;
    this.navLinks = new Map();
    const link = (a, b) => { if (!this.navLinks.has(a)) this.navLinks.set(a, []); this.navLinks.get(a).push(b); };
    for (const r of this.ramps) {
      const top = r.f * GG + (r.ez + r.dz * RAMP_LEN) * G + (r.ex + r.dx * RAMP_LEN);
      const exit = (r.f + 1) * GG + r.nz * G + r.nx;
      link(top, exit); link(exit, top);
    }
    this.navFor = this.ramps;
  },

  // Breadth-first path over (floor, cell) nodes from the sentry to within one cell of the goal on floor gf.
  navPath(s, gf, tx, tz) {
    if (this.navFor !== this.ramps) this.navLinksBuild();
    const G = GRID_SIZE, GG = G * G, NF = this.nFloors;
    const sc = this.cellAt(s.pos.x, s.pos.z), gc = this.cellAt(tx, tz);
    if (sc < 0 || gc < 0) return null;
    const gx = gc % G, gz = (gc / G) | 0;
    const ok = (i) => { const v = this.floors[(i / GG) | 0][i % GG]; return isWalkable(v) || v === CELL_RAMP; };
    let sf = s.floor || 0;
    if (sf > 0 && this.floors[sf][sc] === CELL_VOID) sf--;
    const start = sf * GG + sc;
    const prev = new Int32Array(GG * NF).fill(-2);
    prev[start] = -1;
    const q = [start];
    let goal = -1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], f = (i / GG) | 0, c = i % GG, x = c % G, z = (c / G) | 0;
      if (f === gf && Math.abs(x - gx) <= 1 && Math.abs(z - gz) <= 1) { goal = i; break; }
      const nb = [];
      if (x > 0) nb.push(i - 1); if (x < G - 1) nb.push(i + 1); if (z > 0) nb.push(i - G); if (z < G - 1) nb.push(i + G);
      const extra = this.navLinks.get(i);
      if (extra) nb.push(...extra);
      for (const n of nb) if (prev[n] === -2 && ok(n)) { prev[n] = i; q.push(n); }
    }
    if (goal < 0) return null;
    const path = [];
    for (let i = goal; i !== start && i >= 0; i = prev[i]) path.push(i);
    return path.reverse();
  },

  // Walk toward (tx, ty, tz): straight on the same floor, along a ramp path to another floor. Returns distance left.
  sentryWalkTo(s, tx, ty, tz, spd, dt) {
    const G = GRID_SIZE, GG = G * G;
    const gf = this.floorOfY(ty);
    let wx = tx, wz = tz;
    const far = gf !== (s.floor || 0) || Math.hypot(tx - s.pos.x, tz - s.pos.z) > CELL_SIZE * 2;
    if (far) {
      s.pathT = (s.pathT || 0) - dt;
      if (!s.path || s.pathT <= 0 || s.pathGoalF !== gf) {
        s.path = this.navPath(s, gf, tx, tz);
        s.pathI = 0; s.pathT = 1.5; s.pathGoalF = gf;
      }
      if (s.path && s.pathI < s.path.length) {
        let n = s.path[s.pathI], c = n % GG;
        let cx = gridToWorldX(c % G), cz = gridToWorldZ((c / G) | 0);
        if (Math.hypot(cx - s.pos.x, cz - s.pos.z) < 0.8 && s.pathI < s.path.length - 1) {
          s.pathI++; n = s.path[s.pathI]; c = n % GG; cx = gridToWorldX(c % G); cz = gridToWorldZ((c / G) | 0);
        }
        wx = cx; wz = cz;
      } else if (gf !== (s.floor || 0)) { s.path = null; return 0; }
    }
    const dx = wx - s.pos.x, dz = wz - s.pos.z, dist = Math.hypot(dx, dz);
    if (dist > 0.3) {
      const st = Math.min(dist, spd * dt);
      if (this.sentryStep(s, s.pos.x + (dx / dist) * st, s.pos.z + (dz / dist) * st)) s.walkPhase += dt * 9.0;
      else if (!this.sentryStep(s, s.pos.x + Math.sign(dx) * st, s.pos.z)) this.sentryStep(s, s.pos.x, s.pos.z + Math.sign(dz) * st);
      let dYaw = Math.atan2(-dx, -dz) - s.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      s.yaw += dYaw * Math.min(1, dt * 6.0);
    }
    return gf === (s.floor || 0) ? Math.hypot(tx - s.pos.x, tz - s.pos.z) : dist + 99;
  },

  // Sentries walk only on flat floor of their own level (not onto ramps, voids, walls).
  sentryBlocked(x, z, s) {
    const c = this.cellAt(x, z);
    return c < 0 || !isWalkable(this.floors[s.floor || 0][c]);
  },

  // Aim a hostile shot. Only HOSTILE_ACCURACY of shots are aimed true; the rest pass 1.6-3.4 units wide,
  // clear of the rocket's 0.95 hit radius. Returns the unit direction in `out`.
  hostileAim(origin, target, out, jitter) {
    out.subVectors(target, origin);
    const dist = out.length() || 1;
    out.divideScalar(dist);
    if (Math.random() >= HOSTILE_ACCURACY) {
      _aimR.crossVectors(out, _up);
      if (_aimR.lengthSq() < 1e-6) _aimR.set(1, 0, 0);
      _aimR.normalize();
      _aimU.crossVectors(_aimR, out).normalize();
      const ang = Math.random() * Math.PI * 2;
      const off = 1.6 + Math.random() * 1.8;
      out.multiplyScalar(dist).addScaledVector(_aimR, Math.cos(ang) * off).addScaledVector(_aimU, Math.sin(ang) * off).normalize();
    } else if (jitter) {
      out.x += (Math.random() - 0.5) * 0.08;
      out.y += (Math.random() - 0.5) * 0.06;
      out.z += (Math.random() - 0.5) * 0.08;
      out.normalize();
    }
    return out;
  },

  throwDecoy() {
    const m = this.missile;
    if (this.state !== 'PLAYING' || !m.active || this.decoys <= 0 || this.paused) return;
    let x = m.pos.x, z = m.pos.z;
    const dx = -Math.sin(m.yaw), dz = -Math.cos(m.yaw);
    for (let i = 0; i < 9; i++) {
      if (this.isGridSolid(x + dx, z + dz, m.pos.y)) break;
      x += dx; z += dz;
    }
    const dc = this.cellAt(x, z);
    const dy0 = (dc >= 0 ? this.groundAt(this.floorOfY(m.pos.y), dc, x, z) : 0) + 0.7;
    this.decoys--;
    const grp = new THREE.Group();
    grp.position.set(x, dy0, z);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), new THREE.MeshBasicMaterial({ color: 0x33ddff }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: 0x33ddff, transparent: true, opacity: 0.7 }));
    ring.rotation.x = Math.PI * 0.5;
    grp.add(core, ring);
    this.levelGroup.add(grp);
    this.decoyObjs.push({ pos: new THREE.Vector3(x, dy0, z), t: DECOY_LIFE, mesh: grp, ring });
    this.audio.playTargetChime();
    this.vibrate(15);
    this.pushFeed(`DECOY DEPLOYED — ${this.decoys} LEFT`, 'cyan');
    this.updateHUDText();
  },

  updateDecoys(dt) {
    for (let i = this.decoyObjs.length - 1; i >= 0; i--) {
      const d = this.decoyObjs[i];
      d.t -= dt;
      const k = 1 + ((DECOY_LIFE - d.t) % 1.2) * 1.6;
      d.ring.scale.set(k, k, 1);
      d.ring.material.opacity = Math.max(0, 0.8 - ((DECOY_LIFE - d.t) % 1.2) * 0.65);
      if (d.t <= 0) {
        this.levelGroup.remove(d.mesh);
        d.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.decoyObjs.splice(i, 1);
      }
    }
  },

  updateFacilityObjects(dt) {
    this.gameClock += dt;
    const now = this.gameClock;
    for (const t of this.targets) {
      if (!t.active) continue;
      t.core.rotation.y += dt * 1.8;
      t.core.rotation.x += dt * 0.9;
      t.ring.rotation.z -= dt * 2.2;
      if (t.floorRing) {
        const s = 1.0 + Math.sin(now * 4.5 + t.id) * 0.08;
        t.floorRing.scale.set(s, s, 1);
      }
    }

    for (let i = 0; i < this.lasers.length; i++) {
      const l = this.lasers[i];
      if (l.disabled) continue;

      if (l.mode === 'PULSE_GATE') {
        const tCycle = pulseCycleTime(l, now);
        const prevState = l.state;
        if (tCycle < PULSE_OFF_END) l.state = 'OFF';
        else if (tCycle < PULSE_ARM_END) l.state = 'ARMING';
        else l.state = 'ACTIVE';

        if (l.state === 'ARMING' && prevState !== 'ARMING' && this.missile.active) {
          if (Math.hypot(this.missile.pos.x - l.midX, this.missile.pos.z - l.z) < 26) {
            this.audio.playLaserArm();
          }
        }

        if (l.state === 'OFF') {
          l.lensMat.color.setHex(0x1f4e52);
          l.relayCoreMat.color.setHex(0x00bb99);
          for (let bIdx = 0; bIdx < l.beams.length; bIdx++) {
            l.beams[bIdx].coreMesh.visible = false;
            l.beams[bIdx].glowMesh.visible = false;
          }
        } else if (l.state === 'ARMING') {
          const blink = Math.sin(now * 38) > 0;
          l.lensMat.color.setHex(0xffaa00);
          l.relayCoreMat.color.setHex(blink ? 0xffcc22 : 0x663300);
          for (let bIdx = 0; bIdx < l.beams.length; bIdx++) {
            const bm = l.beams[bIdx];
            bm.coreMesh.visible = true;
            bm.glowMesh.visible = blink;
            bm.coreMat.color.setHex(0xffcc44);
            bm.glowMat.color.setHex(0xff9900);
            bm.glowMat.opacity = 0.22;
            bm.glowMesh.scale.set(0.45 * (l.fade === undefined ? 1 : l.fade) + 0.001, 1, 0.45 * (l.fade === undefined ? 1 : l.fade) + 0.001);
          }
        } else {
          const pulse = 0.85 + 0.25 * Math.sin(now * 24 + l.phase);
          l.lensMat.color.setHex(0xff1133);
          l.relayCoreMat.color.setHex(0xff3322);
          for (let bIdx = 0; bIdx < l.beams.length; bIdx++) {
            const bm = l.beams[bIdx];
            bm.coreMesh.visible = true;
            bm.glowMesh.visible = true;
            bm.coreMat.color.setHex(0xffdddd);
            bm.glowMat.color.setHex(0xff1133);
            bm.glowMat.opacity = 0.76;
            bm.glowMesh.scale.set(pulse * (l.fade === undefined ? 1 : l.fade) + 0.001, 1, pulse * (l.fade === undefined ? 1 : l.fade) + 0.001);
          }
        }
      } else if (l.mode === 'SWEEPER_H') {
        l.state = 'ACTIVE';
        const bx = sweeperHX(l, now);
        const pulse = 0.88 + 0.22 * Math.sin(now * 22 + l.phase);
        const bm = l.beams[0];
        bm.x1 = bx; bm.x2 = bx;
        bm.coreMesh.position.x = bx;
        bm.glowMesh.position.x = bx;
        bm.glowMesh.scale.set(pulse * (l.fade === undefined ? 1 : l.fade) + 0.001, 1, pulse * (l.fade === undefined ? 1 : l.fade) + 0.001);
        if (l.emitters[0]) l.emitters[0].position.x = bx;
        if (l.emitters[1]) l.emitters[1].position.x = bx;
      } else if (l.mode === 'TWIN_SWEEP') {
        l.state = 'ACTIVE';
        const pulse = 0.88 + 0.22 * Math.sin(now * 22 + l.phase);
        for (let bIdx = 0; bIdx < l.beams.length; bIdx++) {
          const bm = l.beams[bIdx];
          const by = twinSweepY(l, bIdx, now);
          bm.y1 = by; bm.y2 = by;
          bm.coreMesh.position.y = by;
          bm.glowMesh.position.y = by;
          bm.glowMesh.scale.set(pulse * (l.fade === undefined ? 1 : l.fade) + 0.001, 1, pulse * (l.fade === undefined ? 1 : l.fade) + 0.001);
          if (l.emitters[bIdx * 2])     l.emitters[bIdx * 2].position.y = by;
          if (l.emitters[bIdx * 2 + 1]) l.emitters[bIdx * 2 + 1].position.y = by;
        }
      } else {
        l.state = 'ACTIVE';
        const by = sweeperVY(l, now);
        const pulse = 0.88 + 0.22 * Math.sin(now * 22 + l.phase);
        const bm = l.beams[0];
        bm.y1 = by; bm.y2 = by;
        bm.coreMesh.position.y = by;
        bm.glowMesh.position.y = by;
        bm.glowMesh.scale.set(pulse * (l.fade === undefined ? 1 : l.fade) + 0.001, 1, pulse * (l.fade === undefined ? 1 : l.fade) + 0.001);
        if (l.emitters[0]) l.emitters[0].position.y = by;
        if (l.emitters[1]) l.emitters[1].position.y = by;
      }
    }

    for (const tb of this.turbines) {
      tb.angle += dt * tb.rotSpeed;
      tb.mesh.rotation.z = tb.angle;
    }

    const bulkSpeed = 1.0 + (this.difficultyTier - 1) * 0.09;
    for (const bh of this.bulkheads) {
      bh.x = bh.baseX + Math.sin(now * bulkSpeed + bh.phase) * 3.4;
      bh.mesh.position.x = bh.x;
    }

    for (const ez of this.ecmZones) {
      ez.mesh.rotation.y += dt * 0.4;
      ez.arcTimer -= dt;
      if (ez.arcTimer <= 0) {
        ez.arcTimer = 0.12;
        _v1.set((Math.random() - 0.5) * ez.radius, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * ez.radius).add(ez.pos);
        _v2.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
        this.vfx.spawnSpark(_v1, _v2, 0.16, 0x00eeff, 0.9, 0);
      }
    }

    const ciwsRange = turretRange(this.difficultyTier);
    const ciwsCooldown = Math.max(0.18, 0.46 - (this.difficultyTier - 1) * 0.015);
    const ciwsBoltSpeed = 78 + (this.difficultyTier - 1) * 2.0;
    for (const tu of this.turrets) {
      if (!tu.active) continue;
      tu.fireCooldown -= dt;
      if (this.missile.active && tu.pos.distanceToSquared(this.missile.pos) < 900) tu.mesh.lookAt(this.missile.pos);
      if (this.missile.active && tu.fireCooldown <= 0) {
        const d = tu.pos.distanceTo(this.missile.pos);
        if (d < ciwsRange && this.los3(tu.pos.x, tu.pos.y, tu.pos.z, this.missile.pos.x, this.missile.pos.y, this.missile.pos.z)) {
          tu.fireCooldown = ciwsCooldown;
          this.hostileAim(tu.pos, this.missile.pos, _v1, false).multiplyScalar(ciwsBoltSpeed);
          this.vfx.spawnTracer(tu.pos, _v1);
          this.vfx.spawnLightFlash(tu.pos, 0xff3322, 5, 0.06);
          this.audio.playGunshot();
        }
      }
    }
  },

  /* ------------------------------------------------------------------------
     NPC SENTRY PATROL AI, VOLUMETRIC VISION CONES & COMBAT
     ------------------------------------------------------------------------ */
  updateSentries(dt) {
    let anyAlert = false;
    const m = this.missile;
    const speedProf = blendProfile(m.effThrottle, _profileSent);
    const tierOffset = this.difficultyTier - 1;
    const detectRate = 1.65 + tierOffset * 0.12;
    const sentryFireDelay = Math.max(0.16, 0.42 - tierOffset * 0.014);
    const sentryBoltSpeed = 74 + tierOffset * 2.0;
    const sentryPatrolSpeed = 3.0 + tierOffset * 0.2;

    // Hearing: the louder (faster) the rocket, the farther sentries hear it.
    let noiseR = HEAR_MIN + HEAR_RANGE * Math.pow(m.effThrottle, 1.5);
    if (this.power.stealth > 0) noiseR *= 0.3;
    if (this.modifier === 'KEEN EARS') noiseR *= 1.5;
    if (this.gunNoiseT > 0) noiseR = Math.max(noiseR, GUN_NOISE * (this.modifier === 'KEEN EARS' ? 1.5 : 1));
    this.noiseRadius = noiseR;
    const stealthDetect = this.power.stealth > 0 ? 0.5 : 1;
    const raiseAlert = (sn) => {
      if (!sn.alerted) {
        sn.alerted = true;
        this.alertsTriggered++;
        this.audio.playAlertStinger();
        this.pushFeed('! SENTRY ALERT — EVASIVE MANEUVERS !', 'red');
        // an alerted sentry radios nearby guards, who come to investigate
        for (const o of this.sentries) {
          if (o === sn || !o.active || o.alerted) continue;
          if (o.floor === sn.floor && Math.hypot(o.pos.x - sn.pos.x, o.pos.z - sn.pos.z) < 16) {
            o.invX = m.pos.x; o.invZ = m.pos.z; o.invY = m.pos.y; o.invT = 4.0;
            o.detectMeter = Math.max(o.detectMeter, 0.4);
          }
        }
      }
      sn.alertTimer = 3.2;
    };

    for (let i = 0; i < this.sentries.length; i++) {
      const s = this.sentries[i];

      if (s.dying) {
        s.deathTimer -= dt;
        s.vel.y -= 18 * dt;
        s.pos.addScaledVector(s.vel, dt);
        const gy = (s.groundY === undefined ? (s.floor || 0) * WALL_H : s.groundY) + 0.25;
        if (s.pos.y < gy) {
          s.pos.y = gy;
          s.vel.y *= -0.25;
          s.vel.x *= 0.7;
          s.vel.z *= 0.7;
        }
        s.rot.addScaledVector(s.angVel, dt);
        if (s.deathTimer <= 0) s.dying = false;
        continue;
      }

      if (!s.active) continue;

      let seesMissile = false;
      if (m.active && !this.cfg.godMode) {
        const dx = m.pos.x - s.pos.x;
        const dz = m.pos.z - s.pos.z;
        const dist = Math.hypot(dx, dz, m.pos.y - s.pos.y - 1.5);
        if (dist < SENTRY_VISION + 0.5) {
          const angleToMissile = Math.atan2(-dx, -dz);
          let diff = angleToMissile - s.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) < 0.56 && this.los3(s.pos.x, s.pos.y + 1.5, s.pos.z, m.pos.x, m.pos.y, m.pos.z)) {
            seesMissile = true;
          }
        }
      }

      // hearing (sampled about 5 times a second per sentry; walls muffle the sound)
      let heard = false;
      if (m.active && !this.cfg.godMode) {
        s.hearT -= dt;
        if (s.hearT <= 0) {
          s.hearT = 0.2;
          s.heardNow = false;
          const hd = Math.hypot(m.pos.x - s.pos.x, m.pos.y - s.pos.y - 1.5, m.pos.z - s.pos.z);
          if (hd < noiseR) {
            const effR = noiseR * Math.pow(HEAR_WALL_DAMP, this.wallThickness3(s.pos.x, s.pos.y + 1.5, s.pos.z, m.pos.x, m.pos.y, m.pos.z));
            if (hd < effR) { s.heardNow = true; s.heardLoud = 1 - hd / effR; s.heardClose = hd < effR * 0.6; }
          }
        }
        heard = s.heardNow;
      } else {
        s.heardNow = false;
      }

      if (seesMissile) {
        s.detectMeter = Math.min(1, s.detectMeter + dt * detectRate * speedProf.detectMult * stealthDetect);
        if (s.detectMeter >= 0.75) raiseAlert(s);
      } else if (heard) {
        s.invX = m.pos.x; s.invZ = m.pos.z; s.invY = m.pos.y;
        s.invT = this.floorOfY(m.pos.y) !== s.floor ? 20.0 : 4.0;
        if (!s.alerted) {
          if (s.detectMeter < 0.62) s.detectMeter = Math.min(0.62, s.detectMeter + dt * detectRate * 0.4 * (0.5 + s.heardLoud));
          if (m.effThrottle >= 0.85 && s.heardClose) { s.detectMeter = 1; raiseAlert(s); }
        } else {
          s.alertTimer = Math.max(s.alertTimer, 1.5);
        }
      } else {
        s.detectMeter = Math.max(0, s.detectMeter - dt * 0.65);
        if (s.alerted) {
          s.alertTimer -= dt;
          if (s.alertTimer <= 0) s.alerted = false;
        }
      }

      // decoys: a noise source that never raises an alert, but pulls sentries away
      if (this.decoyObjs.length && !s.alerted) {
        s.decoyT -= dt;
        if (s.decoyT <= 0) {
          s.decoyT = 0.25;
          s.decoyHeard = null;
          for (const d of this.decoyObjs) {
            const dd = Math.hypot(d.pos.x - s.pos.x, d.pos.y - s.pos.y - 1.5, d.pos.z - s.pos.z);
            if (dd < DECOY_RADIUS && dd < DECOY_RADIUS * Math.pow(HEAR_WALL_DAMP, this.wallThickness3(s.pos.x, s.pos.y + 1.5, s.pos.z, d.pos.x, d.pos.y, d.pos.z))) { s.decoyHeard = d; break; }
          }
        }
        if (s.decoyHeard && s.decoyHeard.t > 0 && !heard && !seesMissile) {
          s.invX = s.decoyHeard.pos.x; s.invZ = s.decoyHeard.pos.z; s.invY = s.decoyHeard.pos.y; s.invT = this.floorOfY(s.decoyHeard.pos.y) !== s.floor ? 20.0 : 5.0;
        }
      }

      if (s.alerted) {
        anyAlert = true;
        const targetYaw = Math.atan2(-(m.pos.x - s.pos.x), -(m.pos.z - s.pos.z));
        let dYaw = targetYaw - s.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        s.yaw += dYaw * Math.min(1, dt * 6.5);

        if (!seesMissile && m.active) {
          // lost sight: hunt where the rocket is heard / was last seen, taking ramps between floors
          if (s.invY === undefined || heard) { s.invX = m.pos.x; s.invY = m.pos.y; s.invZ = m.pos.z; }
          this.sentryWalkTo(s, s.invX, s.invY, s.invZ, sentryPatrolSpeed * 1.7, dt);
        }
        s.fireCooldown -= dt;
        if (seesMissile && s.fireCooldown <= 0 && m.active) {
          s.fireCooldown = sentryFireDelay;
          _v7.set(s.pos.x, s.pos.y + 1.45, s.pos.z);
          this.hostileAim(_v7, m.pos, _v8, true).multiplyScalar(sentryBoltSpeed);
          this.vfx.spawnTracer(_v7, _v8);
          this.vfx.spawnLightFlash(_v7, 0xff4422, 4.5, 0.05);
          this.audio.playGunshot();
        }
      } else if (s.invT > 0) {
        // investigating a noise: walk to where it was heard (up or down a ramp if needed), then look around
        s.invT -= dt;
        const left = this.sentryWalkTo(s, s.invX, s.invY === undefined ? s.pos.y + 1 : s.invY, s.invZ, sentryPatrolSpeed * 1.5, dt);
        if (left <= 1.5) s.yaw += dt * 1.6;
      } else if (s.waypoints[0] && this.floorOfY(s.waypoints[0].y + 0.5) !== (s.floor || 0)) {
        const wp0 = s.waypoints[s.wpIndex];
        this.sentryWalkTo(s, wp0.x, wp0.y + 0.5, wp0.z, sentryPatrolSpeed, dt);
      } else {
        const wp = s.waypoints[s.wpIndex];
        const dx = wp.x - s.pos.x;
        const dz = wp.z - s.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.7) {
          s.wpIndex = (s.wpIndex + 1) % s.waypoints.length;
        } else {
          const spd = sentryPatrolSpeed;
          const nx = s.pos.x + (dx / dist) * spd * dt;
          const nz = s.pos.z + (dz / dist) * spd * dt;
          if (!this.sentryBlocked(nx, nz, s) && this.sentryStep(s, nx, nz)) {
          } else {
            s.wpIndex = (s.wpIndex + 1) % s.waypoints.length;
          }
          const targetYaw = Math.atan2(-dx, -dz);
          let dYaw = targetYaw - s.yaw;
          while (dYaw > Math.PI) dYaw -= Math.PI * 2;
          while (dYaw < -Math.PI) dYaw += Math.PI * 2;
          s.yaw += dYaw * Math.min(1, dt * 5.0);
          s.walkPhase += dt * 7.5;
        }
      }
    }

    this.cStyle(this.el.alertBanner, 'display', anyAlert ? 'block' : 'none');
    this.syncSentryInstances();
  },

  syncSentryInstances() {
    for (let i = 0; i < this.maxSentries; i++) {
      const s = this.sentries[i];
      if (!s || (!s.active && !s.dying) || !(s.fade > 0.001)) {
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.sentryTorsoMesh.setMatrixAt(i, _dummy.matrix);
        this.sentryHeadMesh.setMatrixAt(i, _dummy.matrix);
        this.sentryGunMesh.setMatrixAt(i, _dummy.matrix);
        this.sentryConeMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      const bob = s.active ? Math.abs(Math.sin(s.walkPhase)) * 0.09 : 0;
      _dummy.position.set(s.pos.x, s.pos.y + 0.95 + bob, s.pos.z);
      _dummy.rotation.set(s.rot.x, s.yaw + s.rot.y, s.rot.z);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.sentryTorsoMesh.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(s.pos.x, s.pos.y + 1.88 + bob, s.pos.z);
      _dummy.updateMatrix();
      this.sentryHeadMesh.setMatrixAt(i, _dummy.matrix);

      _v1.set(0.32, 1.25 + bob, -0.42).applyAxisAngle(_up, s.yaw).add(s.pos);
      _dummy.position.copy(_v1);
      _dummy.updateMatrix();
      this.sentryGunMesh.setMatrixAt(i, _dummy.matrix);

      if (s.active) {
        _dummy.position.set(s.pos.x, s.pos.y + 1.55, s.pos.z);
        _dummy.rotation.set(0, s.yaw, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        this.sentryConeMesh.setMatrixAt(i, _dummy.matrix);
        _c1.setHex(s.alerted ? 0xff2233 : ((s.detectMeter > 0.15 || s.invT > 0) ? 0xffaa00 : 0x00ff88)).multiplyScalar(s.fade);
        this.sentryConeMesh.setColorAt(i, _c1);
        _c1.setRGB(s.fade, s.fade, s.fade);
        this.sentryTorsoMesh.setColorAt(i, _c1); this.sentryHeadMesh.setColorAt(i, _c1); this.sentryGunMesh.setColorAt(i, _c1);
      } else {
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
        _dummy.updateMatrix();
        this.sentryConeMesh.setMatrixAt(i, _dummy.matrix);
      }
    }
    this.sentryTorsoMesh.instanceMatrix.needsUpdate = true;
    this.sentryHeadMesh.instanceMatrix.needsUpdate = true;
    this.sentryGunMesh.instanceMatrix.needsUpdate = true;
    this.sentryConeMesh.instanceMatrix.needsUpdate = true;
    if (this.sentryConeMesh.instanceColor) this.sentryConeMesh.instanceColor.needsUpdate = true;
    for (const im of [this.sentryTorsoMesh, this.sentryHeadMesh, this.sentryGunMesh]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  },

  syncBarrelInstances() {
    for (let i = 0; i < this.maxBarrels; i++) {
      const b = this.barrels[i];
      if (b) { const bf = (b.fade || 0) * this.floorVisAt(b.pos.y); _c1.setRGB(bf, bf, bf); this.barrelMesh.setColorAt(i, _c1); }
      if (!b || !b.active || !(b.fade > 0.001)) {
        _dummy.position.set(0, -500, 0);
        _dummy.scale.set(0.0001, 0.0001, 0.0001);
      } else {
        _dummy.position.copy(b.pos);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
      }
      _dummy.updateMatrix();
      this.barrelMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.barrelMesh.instanceMatrix.needsUpdate = true;
    if (this.barrelMesh.instanceColor) this.barrelMesh.instanceColor.needsUpdate = true;
  },
};
