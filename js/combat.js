/* Weapons and targeting for NikitaGame: launch, detonation and blast damage, the gun, seeker lock and the kill cam. */
import * as THREE from 'three';
import {
  AIM_PITCH_LIMIT, AIM_PITCH_RATE, AIM_YAW_RATE, CELL_CRACKED, CELL_RAMP, CELL_SHAFT_LOW, CELL_WALL, GRID_SIZE,
  GUN_HITS, GUN_LIFE, GUN_POOL, GUN_RATE, GUN_SPEED, LAUNCH_DROP_SPEED, LAUNCH_DROP_TIME, MISSILE_RADIUS,
  MODIFIER_INFO, POINTS_BONUS, REWARD_BONUS, SWITCH_CONE_MAX, SWITCH_CONE_MULT, WALL_H, isShaft
} from './constants.js';
import { BARREL_BLAST_RADIUS } from './hazards.js';
import { _blast, _dummy, _e1, _fwd, _v1, _v2, _v5, _v6, worldToGridX, worldToGridZ, wrapPi } from './math.js';

export const combatMethods = {

  // Called once per kill / shutdown. `isDone()` tells whether the whole category is now cleared.

  /* ------------------------------------------------------------------------
     ROCKET GUN: hold GUN to fire along the nose. Bullets wear down sentries,
     turrets, grates and laser switches, and set off fuel barrels. Primary
     targets are armoured: they need the warhead.
     ------------------------------------------------------------------------ */
  initGun() {
    this.bullets = [];
    for (let i = 0; i < GUN_POOL; i++) this.bullets.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 });
    const geo = new THREE.BoxGeometry(0.16, 0.16, 2.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bulletMesh = new THREE.InstancedMesh(geo, mat, GUN_POOL);
    this.bulletMesh.frustumCulled = false;
    this.bulletMesh.count = 0;
    this.scene.add(this.bulletMesh);
  },

  fireGunRound() {
    const m = this.missile;
    _e1.set(m.pitch, m.yaw, 0, 'YXZ');
    _v1.copy(_fwd).applyEuler(_e1).normalize();
    _v1.x += (Math.random() - 0.5) * 0.024; _v1.y += (Math.random() - 0.5) * 0.024; _v1.z += (Math.random() - 0.5) * 0.024;
    _v1.normalize();
    let b = this.bullets.find((x) => !x.active);
    if (!b) b = this.bullets[0];
    b.active = true;
    b.life = GUN_LIFE;
    b.pos.copy(m.pos).addScaledVector(_v1, 1.1);
    b.vel.copy(_v1).multiplyScalar(GUN_SPEED + (m.currentSpeed || 0));
    this.gunAmmo--;
    _v2.copy(_v1).negate();
    this.shoveRocket(_v2, m.hover ? 1.4 : 0.45, m.hover ? 0.03 : 0.014, (Math.random() - 0.5) * (m.hover ? 0.03 : 0.012));   // recoil: shoves the rocket back and kicks the nose
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.025);
    this.gunNoiseT = 0.35;
    if ((this.gunAmmo & 1) === 0) this.audio.playGunshot();
    const el = document.getElementById('hud-gun');
    if (el) el.textContent = `${this.gunAmmo} / ${this.gunCap()}`;
  },

  updateGun(dt) {
    const m = this.missile;
    this.gunCool -= dt;
    this.gunNoiseT = Math.max(0, this.gunNoiseT - dt);
    this._gunMsgT = Math.max(0, this._gunMsgT - dt);
    const held = this.gunHeld || this.keys.KeyE;
    if (held && this.state === 'PLAYING' && m.active && m.drop <= 0 && !this.paused) {
      if (this.gunAmmo <= 0) {
        if (this._gunMsgT <= 0) { this.pushFeed('GUN EMPTY — FIND AMMO CRATES', 'amber'); this._gunMsgT = 2.5; }
      } else {
        while (this.gunCool <= 0 && this.gunAmmo > 0) { this.fireGunRound(); this.gunCool += 1 / GUN_RATE; }
      }
    }
    if (this.gunCool < 0) this.gunCool = 0;
    let n = 0;
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.life -= dt;
      for (let k = 0; k < 4 && b.active; k++) {
        b.pos.addScaledVector(b.vel, dt / 4);
        if (this.pointBlocked(b.pos.x, b.pos.y, b.pos.z, 0)) { b.active = false; break; }
        if (this.gunHitAt(b.pos)) b.active = false;
      }
      if (b.life <= 0) b.active = false;
      if (!b.active) continue;
      _v2.copy(b.pos).add(b.vel);
      _dummy.position.copy(b.pos);
      _dummy.scale.set(1, 1, 1);
      _dummy.lookAt(_v2);
      _dummy.updateMatrix();
      this.bulletMesh.setMatrixAt(n++, _dummy.matrix);
    }
    this.bulletMesh.count = n;
    if (n) this.bulletMesh.instanceMatrix.needsUpdate = true;
    const btn = document.getElementById('tbtn-gun');
    if (btn) btn.style.opacity = this.gunAmmo > 0 ? '' : '0.4';
  },

  // Returns true if the bullet struck something (and is used up).
  gunHitAt(p) {
    const hitFx = (col) => this.vfx.spawnRing(p, 1.1, 0.12, col, 0, 0);
    const kill = () => { this.blastMult = this.hitMultNow(); };
    for (const s of this.sentries) {
      if (!s.active) continue;
      if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 0.75 && p.y > s.pos.y && p.y < s.pos.y + 2.3) {
        s.gunHp = (s.gunHp === undefined ? GUN_HITS.sentry : s.gunHp) - 1;
        hitFx(0xff6655);
        if (s.gunHp <= 0) { kill(); this.neutralizeSentry(s, p); this._blastHostiles = 0; this.flushRewards(); }
        else { s.detectMeter = 1; s.invX = this.missile.pos.x; s.invY = this.missile.pos.y; s.invZ = this.missile.pos.z; s.invT = 4; }
        return true;
      }
    }
    for (const tu of this.turrets) {
      if (!tu.active || p.distanceTo(tu.pos) > 1.0) continue;
      tu.gunHp = (tu.gunHp === undefined ? GUN_HITS.turret : tu.gunHp) - 1;
      hitFx(0xff6655);
      if (tu.gunHp <= 0) {
        kill(); tu.active = false; tu.mesh.visible = false; if (tu.stem) tu.stem.visible = false;
        this.vfx.spawnExplosion(tu.pos, 3.5, 0.6);
        this.pushFeed('CIWS TURRET SHOT DOWN', 'cyan');
        this.rewardKill('turret', this.turrets, (x) => !x.active, true);
        this._blastHostiles = 0; this.flushRewards(); this.updateHUDText();
      }
      return true;
    }
    for (const b of this.barrels) {
      if (!b.active || p.distanceTo(b.pos) > 0.95) continue;
      kill(); b.active = false;
      this.rewardKill('barrel', this.barrels, (x) => !x.active);
      this.pendingBlasts.push({ pos: b.pos.clone(), delay: 0.05, radius: 9.2, power: 1.4, label: 'FUEL BARREL SHOT', mult: this.blastMult });
      this.flushRewards(); this.syncBarrelInstances();
      return true;
    }
    for (const g of this.grates) {
      if (!g.active) continue;
      if (Math.abs(p.x - g.pos.x) < g.halfX + 0.1 && Math.abs(p.y - g.pos.y) < g.halfY + 0.1 && Math.abs(p.z - g.pos.z) < g.halfZ + 0.1) {
        g.gunHp = (g.gunHp === undefined ? GUN_HITS.grate : g.gunHp) - 1;
        hitFx(0xffcc66);
        if (g.gunHp <= 0) {
          kill(); g.active = false; g.mesh.visible = false;
          this.rewardKill('grate', this.grates, (x) => !x.active);
          this.pushFeed('VENTILATION GRATE SHOT OUT', 'cyan');
          this.flushRewards();
        }
        return true;
      }
    }
    for (const l of this.lasers) {
      if (l.disabled || !l.relayActive || p.distanceTo(l.relayPos) > 0.8) continue;
      l.gunHp = (l.gunHp === undefined ? GUN_HITS.box : l.gunHp) - 1;
      hitFx(0xffcc66);
      if (l.gunHp <= 0) { kill(); this.disableLaserGrid(l, true); this.flushRewards(); }
      return true;
    }
    for (const t of this.targets) {
      if (!t.active || p.distanceTo(t.pos) > t.radius) continue;
      hitFx(0xffaa00);
      if (this._gunMsgT <= 0) { this.pushFeed('PRIMARY TARGET ARMOURED — USE THE WARHEAD', 'amber'); this._gunMsgT = 2.5; }
      return true;
    }
    return false;
  },

  /* ------------------------------------------------------------------------
     LAUNCH / SALVO MANAGEMENT
     ------------------------------------------------------------------------ */
  // A fresh sector waits on the pad: the player sets the throttle, then taps FIRE.
  enterReady(first = true) {
    if (!first) {
      // between rockets: sector may be cleared, or the salvo spent
      document.getElementById('killcam-banner').style.display = 'none';
      if (this.targets.length > 0 && !this.targets.some((t) => t.active)) { this.triggerSectorClear(); return; }
      if (this.ammo <= 0) { this.triggerMissionFailed('All Nikita rockets expended before primary objectives were neutralized.'); return; }
    }
    const m = this.missile;
    m.active = false;
    m.pos.copy(this.spawnPos);
    m.yaw = 0; m.pitch = 0; m.roll = 0; m.drop = 0;
    m.flipping = false; m.flipUsed = false; m.burnT = 0;
    m.landed = false; m.takeoffT = -1; m.landReq = false; m.liftReq = false; m.hover = false; m.hoverClimb = 0; m.auto = false; m.autoSpeed = 0; m.probe = null; m.kickP = 0; m.kickY = 0; m._spd0 = undefined;
    this.updateFlipButton();
    this.launchAim.yaw = 0; this.launchAim.pitch = 0;
    this.missileGroup.visible = false;
    this.resetOverlays();
    this.state = 'READY';
    m.throttle = 0;
    m.effThrottle = 0;
    m.baseSpeedMode = this.modeForThrottle(0);
    m.activeSpeedMode = m.baseSpeedMode;
    this.resetTether(m.pos);
    this.updateSpeedBadgeUI();
    this.updateHUDText();
    document.getElementById('fire-btn').style.display = 'block';
    document.getElementById('throttle-lever').classList.add('disabled');
    this.updateTouchControlsVisibility();
    if (first && this.modifier) this.pushFeed(`SECTOR MODIFIER: ${this.modifier} — ${MODIFIER_INFO[this.modifier]}`, 'red');
    this.pushFeed(first ? 'NIKITA ARMED — AIM WITH THE STICK, THEN PRESS FIRE' : `ROCKET READY (${this.ammo} LEFT) — AIM, THEN PRESS FIRE`, 'cyan');
  },

  updateFlipButton() {
    const b = document.getElementById('tbtn-flip');   // the flip & burn button was removed; kept as a no-op
    if (!b) return;
    const used = this.missile.flipUsed;
    b.innerHTML = used ? 'FLIP<br/>USED' : 'FLIP &amp;<br/>BURN';
    b.style.opacity = used ? '0.4' : '';
  },

  // Flip and burn: two small attitude jets backflip the rocket 180 degrees (thrusters cut, momentum kept),
  // then the main engine burns hard in the new direction to reverse course. Once per rocket.
  startFlip() {
    const m = this.missile;
    if (this.state !== 'PLAYING' || !m.active || this.paused || m.flipUsed || m.flipping || m.drop > 0) return;
    m.flipping = true;
    m.flipUsed = true;
    m.flipT = 0;
    m.flipStart = m.pitch;
    if (!this.cfg.infFuel) m.fuel = Math.max(0, m.fuel - 3);     // attitude jets
    this.audio.playSpeedShift(1);
    this.vibrate(18);
    this.pushFeed('FLIP & BURN — ATTITUDE JETS FIRING', 'amber');
    this.updateFlipButton();
  },

  // While waiting on the pad the stick / keys / mouse / gyro adjust the launch angle.
  updateReadyAim(dt) {
    const m = this.missile;
    const a = this.launchAim;
    let yawIn = -this.touchInput.joyX + (this.gyro && this.gyro.enabled ? this.gyro.yaw : 0);
    let pitchIn = -this.touchInput.joyY + (this.gyro && this.gyro.enabled ? this.gyro.pitch : 0);
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  yawIn += 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) yawIn -= 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    pitchIn += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  pitchIn -= 1;
    yawIn = Math.max(-1, Math.min(1, yawIn));
    pitchIn = Math.max(-1, Math.min(1, pitchIn));
    if (this.cfg.invertPitch) pitchIn = -pitchIn;
    let mouseYaw = 0, mousePitch = 0;
    if (this.mouseYawDelta !== 0 || this.mousePitchDelta !== 0) {
      const mScale = 0.0022 * this.cfg.mouseSens;
      mouseYaw = -this.mouseYawDelta * mScale;
      mousePitch = (this.cfg.invertPitch ? 1 : -1) * this.mousePitchDelta * mScale;
      this.mouseYawDelta = 0;
      this.mousePitchDelta = 0;
    }
    a.yaw = wrapPi(a.yaw + yawIn * AIM_YAW_RATE * dt + mouseYaw);
    a.pitch = Math.max(-AIM_PITCH_LIMIT, Math.min(AIM_PITCH_LIMIT, a.pitch + pitchIn * AIM_PITCH_RATE * dt + mousePitch));
    m.yaw = a.yaw;
    m.pitch = a.pitch;
    const yd = Math.round(a.yaw * 57.2958), pd = Math.round(a.pitch * 57.2958);
    const small = this.fireSmall || (this.fireSmall = document.querySelector('#fire-btn small'));
    if (small) this.cText(small, `AIM  YAW ${yd > 0 ? '+' : ''}${yd}°  PITCH ${pd > 0 ? '+' : ''}${pd}°  ·  STICK TO AIM`);
  },

  fireRocket() {
    if (this.state !== 'READY' || this.paused) return;
    this.audio.unlock();
    this.vibrate(20);
    this.launchNextMissile();
    this.updateTouchControlsVisibility();
  },

  launchNextMissile() {
    try { this.lidarSnapshot(); } catch (_) {}                             // every respawn saves the lidar map and the explore map on the device
    if (this.targets.length > 0 && !this.targets.some(t => t.active)) {
      document.getElementById('killcam-banner').style.display = 'none';
      this.triggerSectorClear();
      return;
    }
    this.resetOverlays();
    document.getElementById('fire-btn').style.display = 'none';
    document.getElementById('throttle-lever').classList.remove('disabled');
    if (this.ammo <= 0) {
      this.triggerMissionFailed(`All Nikita rockets expended before primary objectives were neutralized.`);
      return;
    }
    const m = this.missile;
    this.fired++;
    m.active = true;
    m.pos.copy(this.spawnPos);
    m.yaw = this.launchAim.yaw;
    m.pitch = this.launchAim.pitch;
    m.roll = 0;
    m.yawRate = 0;
    m.pitchRate = 0;
    this.mouseYawDelta = 0;
    this.mousePitchDelta = 0;
    this.lockedEnemy = null;
    this.homingLocked = false;
    this.manualTargetLock = false;
    this.lastHighlightedRef = null;
    m.throttle = 0;           // every rocket starts with the lever at minimum speed
    m.effThrottle = 0;
    m.baseSpeedMode = this.modeForThrottle(m.throttle);
    m.activeSpeedMode = m.baseSpeedMode;
    // launched with cold thrusters: coast along the aim and fall for a moment before ignition
    m.currentSpeed = LAUNCH_DROP_SPEED;
    m.drop = LAUNCH_DROP_TIME;
    m.flipping = false; m.flipUsed = false; m.burnT = 0;
    m.landed = false; m.takeoffT = -1; m.landReq = false; m.liftReq = false; m.hover = false; m.hoverClimb = 0; m.auto = false; m.autoSpeed = 0; m.probe = null; m.kickP = 0; m.kickY = 0; m._spd0 = undefined;
    this.updateFlipButton();
    _e1.set(m.pitch, m.yaw, 0, 'YXZ');
    m.vel.copy(_fwd).applyEuler(_e1).multiplyScalar(LAUNCH_DROP_SPEED);
    m.fuel = 100;
    m.fuelOut = -1;
    m.fuelWarned = false;
    m.boost = 100;
    m.boostDepleted = false;
    m.hull = 100;
    m.signal = 100;
    m.inECM = false;
    m.wallProximity = 0;
    this.missileGroup.visible = false;    // nose camera only
    this.resetTether(m.pos);
    this.state = 'PLAYING';
    this.updateSpeedBadgeUI();
    this.updateHUDText();
    this.pushFeed(`NIKITA #${this.fired} LAUNCHED — WIRE LINK ACTIVE`, 'cyan');
  },

  /* ------------------------------------------------------------------------
     COLLISION HELPERS & DDA WALL-OCCLUSION RAYCAST
     ------------------------------------------------------------------------ */
  // wy is optional: when given, shaft cells are open between the heights of their opening (the rocket can fly through).
  isGridSolid(wx, wz, wy) {
    const gx = worldToGridX(wx);
    const gz = worldToGridZ(wz);
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return true;
    let v, base = 0;
    if (wy === undefined) v = this.grid[gz * GRID_SIZE + gx];
    else {
      const f = this.floorOfY(wy);
      v = this.floors[f][gz * GRID_SIZE + gx];
      base = f * WALL_H;
      if (v === CELL_RAMP) return wy < this.rampHeight(this.ramps[this.rampAt.get(f * GRID_SIZE * GRID_SIZE + gz * GRID_SIZE + gx)], wx, wz) - MISSILE_RADIUS * 0.5;
    }
    if (isShaft(v)) {
      if (wy === undefined) return true;
      const lo = base + (v - CELL_SHAFT_LOW) * WALL_H / 3;
      return wy < lo + MISSILE_RADIUS || wy > lo + WALL_H / 3 - MISSILE_RADIUS;
    }
    return v === CELL_WALL || v === CELL_CRACKED;
  },

  hasLineOfSight(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return true;
    const steps = Math.ceil(dist / 1.1);
    const sx = dx / steps;
    const sz = dz / steps;
    let cx = ax, cz = az;
    for (let i = 1; i < steps; i++) {
      cx += sx; cz += sz;
      if (this.isGridSolid(cx, cz)) return false;
    }
    return true;
  },

  /* ------------------------------------------------------------------------
     EXPLOSION, RADIAL BLAST, NPC NEUTRALIZATION & CHAIN REACTIONS
     ------------------------------------------------------------------------ */
  detonateMissile(impactPos, reason = 'WARHEAD DETONATED', directHitTarget = null, directHitSentry = null) {
    if (!this.missile.active) return;
    impactPos = _blast.copy(impactPos);
    this.missile.active = false;
    this.missileGroup.visible = false;
    this.resetOverlays();
    this.ammo = Math.max(0, this.ammo - 1);
    this.updateHUDText();

    this.blastMult = this.hitMultNow();      // speed at impact decides the kill multiplier
    const over = this.power.overcharge;
    this.power.overcharge = false;
    if (over) this.pushFeed('OVERCHARGED WARHEAD', 'red');
    this.triggerBlast(impactPos, this.blastRadiusBase() * (over ? 1.6 : 1), this.blastPowerBase() * (over ? 1.36 : 1), directHitTarget, directHitSentry);
    if (reason) this.pushFeed(reason, 'amber');

    const remaining = this.targets.filter(t => t.active).length;
    if (remaining === 0) {
      this.startKillCam(impactPos, true);
      return;
    }
    if (directHitTarget) {
      this.startKillCam(impactPos, false);
      return;
    }

    this.state = 'RESPAWNING';
    this.respawnTimer = 1.35;
  },

  resetOverlays() {
    this.cStyle(this.el.speedLines, 'opacity', '0');
    this.cStyle(this.el.ecmOverlay, 'opacity', '0');
    this.cStyle(this.el.ecmBanner, 'display', 'none');
    this.missile.inECM = false;
  },

  // Runs after every blast (including delayed chain reactions) in any live state, so a last
  // target killed by a barrel chain during respawn / kill-cam still clears the sector.
  checkSectorWon(pos) {
    if (this.state !== 'PLAYING' && this.state !== 'RESPAWNING' && this.state !== 'KILLCAM') return;
    if (this.targets.some(t => t.active)) return;
    if (this.state === 'KILLCAM') {
      this.killCamFinal = true;
      return;
    }
    this.missile.active = false;
    this.missileGroup.visible = false;
    this.resetOverlays();
    this.startKillCam(pos || this.missile.pos, true);
  },

  triggerBlast(epicenter, radius, power, directTarget = null, directSentry = null) {
    this.vfx.spawnExplosion(epicenter, radius, power);
    this.audio.playExplosion(power);
    this.vibrate(Math.min(70, Math.round(35 * power)));
    this.flashAlpha = Math.min(0.85, 0.48 * power);

    const camDist = this.camera.position.distanceTo(epicenter);
    const atten = Math.max(0.25, 1.0 - camDist / 48);
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.72 * power * atten);
    this._blastHostiles = 0;

    // Nikita itself: any blast that reaches the rocket (clear line, within radius) sets the warhead off
    const rk = this.missile;
    const rocketCaught = rk.active && this.state === 'PLAYING' &&
      rk.pos.distanceTo(epicenter) <= radius + MISSILE_RADIUS &&
      this.los3(epicenter.x, epicenter.y, epicenter.z, rk.pos.x, rk.pos.y, rk.pos.z);

    for (const t of this.targets) {
      if (!t.active) continue;
      const d = t.pos.distanceTo(epicenter);
      if (t === directTarget || (d <= radius + t.radius && this.los3(epicenter.x, epicenter.y, epicenter.z, t.pos.x, t.pos.y, t.pos.z))) {
        t.active = false;
        t.mesh.visible = false;
        this.vfx.spawnExplosion(t.pos, 10.5, 1.65);
        this.audio.playTargetChime();
        this.pushFeed(`PRIMARY TARGET DESTROYED: ${t.name}`, 'amber');
        this.rewardKill('target', this.targets, (x) => !x.active, true);
        if (t === directTarget && !this._proxBurst) { this.awardRockets(REWARD_BONUS.directHit, 'DIRECT HIT', 'bonus'); this.awardPoints(POINTS_BONUS.directHit, 'DIRECT HIT', false); }
      }
    }

    for (const s of this.sentries) {
      if (!s.active) continue;
      _v5.set(s.pos.x, s.pos.y + 1.2, s.pos.z);
      const d = _v5.distanceTo(epicenter);
      if (s === directSentry || (d <= radius && this.los3(epicenter.x, epicenter.y, epicenter.z, _v5.x, _v5.y, _v5.z))) {
        this.neutralizeSentry(s, epicenter);
      }
    }

    for (const b of this.barrels) {
      if (!b.active) continue;
      const d = b.pos.distanceTo(epicenter);
      if (d <= radius + 1.2 && this.los3(epicenter.x, epicenter.y, epicenter.z, b.pos.x, b.pos.y, b.pos.z)) {
        b.active = false;
        this.rewardKill('barrel', this.barrels, (x) => !x.active);
        this.pendingBlasts.push({ pos: b.pos.clone(), delay: 0.12 + Math.random() * 0.08, radius: BARREL_BLAST_RADIUS, power: 1.4, label: 'FUEL BARREL CHAIN REACTION', mult: this.blastMult });
      }
    }

    for (const g of this.grates) {
      if (!g.active) continue;
      if (g.pos.distanceTo(epicenter) <= radius + 1.5) {
        g.active = false;
        g.mesh.visible = false;
        this.rewardKill('grate', this.grates, (x) => !x.active);
        this.pushFeed('VENTILATION GRATE BREACHED', 'cyan');
      }
    }

    for (const l of this.lasers) {
      if (l.disabled || !l.relayActive) continue;
      if (l.relayPos.distanceTo(epicenter) <= radius + 1.2) {
        this.disableLaserGrid(l, true);
      }
    }

    for (const bw of this.breakables) {
      if (bw.active && bw.pos.distanceTo(epicenter) <= radius * 0.6 + 2.4) this.breakWall(bw);
    }

    for (const tu of this.turrets) {
      if (!tu.active) continue;
      if (tu.pos.distanceTo(epicenter) <= radius + 1.0) {
        tu.active = false;
        tu.mesh.visible = false;
        this.pushFeed('CIWS TURRET DESTROYED', 'cyan');
        this.rewardKill('turret', this.turrets, (x) => !x.active, true);
      }
    }

    if (this._blastHostiles >= 5) { this.awardRockets(REWARD_BONUS.combo5, `${this._blastHostiles}-KILL BLAST`, 'bonus'); this.awardPoints(POINTS_BONUS.combo5, `${this._blastHostiles}-KILL BLAST`, false); }
    else if (this._blastHostiles >= 3) { this.awardRockets(REWARD_BONUS.combo3, `${this._blastHostiles}-KILL BLAST`, 'bonus'); this.awardPoints(POINTS_BONUS.combo3, `${this._blastHostiles}-KILL BLAST`, false); }
    this._blastHostiles = 0;
    this.flushRewards();

    this.syncBarrelInstances();
    this.updateHUDText();

    // shockwave: a blast just outside the lethal radius still shoves the rocket away
    if (rk.active && !rocketCaught && this.state === 'PLAYING') {
      const dRk = rk.pos.distanceTo(epicenter);
      const reach = radius * 2.0;
      if (dRk > radius && dRk < reach) {
        const fall = 1 - (dRk - radius) / (reach - radius);
        const wall = this.los3(epicenter.x, epicenter.y, epicenter.z, rk.pos.x, rk.pos.y, rk.pos.z) ? 1 : 0.35;
        _v6.copy(rk.pos).sub(epicenter).normalize();
        this.shoveRocket(_v6, 9 * power * fall * wall, (Math.random() - 0.5) * 0.2 * fall, (Math.random() - 0.5) * 0.2 * fall);
        rk.roll += (Math.random() - 0.5) * 1.4 * fall;
        this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.4 * fall * wall);
        if (fall > 0.35) this.pushFeed('SHOCKWAVE', 'amber');
      }
    }

    if (rocketCaught && rk.active) this.detonateMissile(rk.pos.clone(), 'CAUGHT IN BLAST RADIUS');
  },

  neutralizeSentry(sentry, blastPos) {
    sentry.active = false;
    sentry.dying = true;
    sentry.deathTimer = 1.4;
    sentry.alerted = false;
    sentry.detectMeter = 0;
    _v6.set(sentry.pos.x - blastPos.x, 0, sentry.pos.z - blastPos.z);
    if (_v6.lengthSq() < 0.01) _v6.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _v6.normalize();
    sentry.vel.set(_v6.x * 14, 6.5, _v6.z * 14);
    sentry.angVel.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10);
    this.sentriesNeutralized++;
    this.pushFeed('SENTRY NEUTRALIZED', 'cyan');
    this.rewardKill('sentry', this.sentries, (x) => !x.active, true);
    this.updateHUDText();
  },

  startKillCam(targetPos, isFinalTarget) {
    this.state = 'KILLCAM';
    this.killCamTarget.copy(targetPos);
    this.killCamTimer = isFinalTarget ? 2.4 : 1.7;
    this.killCamAngle = this.missile.yaw + 0.7;
    this.killCamFinal = isFinalTarget;
    document.getElementById('killcam-banner').style.display = 'block';
  },

  /* ------------------------------------------------------------------------
     MISSILE 3-SPEED CONTROLLER, 15-DEGREE AUTO-SEEKER & LOCK SYSTEM
     ------------------------------------------------------------------------ */
  findBestEnemyTarget() {
    const m = this.missile;
    _e1.set(m.pitch, m.yaw, 0, 'YXZ');
    _v1.copy(_fwd).applyEuler(_e1).normalize();
    this._bestScore = Infinity;
    this._bestCand.ref = null;

    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (t.active && t.mesh.userData._tv) this._considerTarget('TARGET', t, t.pos.x, t.pos.y, t.pos.z, 0, m);
    }
    for (let i = 0; i < this.sentries.length; i++) {
      const s = this.sentries[i];
      if (s.active && s.thermalVis) this._considerTarget('SENTRY', s, s.pos.x, s.pos.y + 1.25, s.pos.z, 1.25, m);
    }
    for (let i = 0; i < this.turrets.length; i++) {
      const tu = this.turrets[i];
      if (tu.active && tu.mesh.userData._tv) this._considerTarget('CIWS', tu, tu.pos.x, tu.pos.y, tu.pos.z, 0, m);
    }
    for (let i = 0; i < this.lasers.length; i++) {
      const l = this.lasers[i];
      if (l.boxVis && l.lockRef.active) this._considerTarget('LASER BOX', l.lockRef, l.relayPos.x, l.relayPos.y, l.relayPos.z, 0, m, SWITCH_CONE_MULT);
    }
    // Returns a reused object (no per-call allocation); copy it if you need to keep it.
    return this._bestCand.ref ? this._bestCand : null;
  },

  // coneMult widens the acquisition cone (laser switches sit on side walls, rarely dead ahead)
  _considerTarget(type, ref, tx, ty, tz, aimY, m, coneMult = 1) {
    _v2.set(tx - m.pos.x, ty - m.pos.y, tz - m.pos.z);
    const dist = _v2.length();
    const TP = this.lidarParams(true);
    if (dist < 0.6 || dist > TP.lockRange) return;
    _v2.multiplyScalar(1 / dist);
    const dot = _v1.dot(_v2);
    // Strictly enforce 15-degree half-angle cone from rocket nose
    const coneDeg = Math.min(SWITCH_CONE_MAX, TP.seekerDeg * coneMult);
    if (dot < Math.cos(coneDeg * Math.PI / 180)) return;
    if (!this.los3(m.pos.x, m.pos.y, m.pos.z, tx, ty, tz)) return;
    const score = dist * 0.4 + (1.0 - dot) * 260.0;
    if (score < this._bestScore) {
      this._bestScore = score;
      const o = this._bestCand;
      o.type = type; o.ref = ref; o.aimY = aimY;
    }
  },

  toggleTargetLock() {
    if (!this.missile.active || this.state !== 'PLAYING') return;
    if (this.manualTargetLock && this.lockedEnemy) {
      this.manualTargetLock = false;
      this.homingLocked = false;
      this.pushFeed('TARGET LOCK RELEASED — HOLDING COURSE', 'amber');
      return;
    }
    const candidate = this.lockedEnemy || this.findBestEnemyTarget();
    if (candidate && candidate.ref && candidate.ref.active) {
      this.lockedEnemy = { type: candidate.type, ref: candidate.ref, aimY: candidate.aimY };
      this.manualTargetLock = true;
      this.homingLocked = true;
      this.audio.playLockTone();
      this.pushFeed(`LOCK ENGAGED: ${candidate.type}`, 'cyan');
    } else {
      this.pushFeed(`NO TARGET IN ${this.lidarParams(true).seekerDeg}° SEEKER CONE`, 'amber');
    }
  },
};
