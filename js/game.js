/* NikitaGame: the game controller. Owns the constructor, the main loop, the fixed-step simulation and the sector flow; every other part of its behaviour lives in the mixin modules listed below. */
import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { Autopilot } from './autopilot.js';
import {
  CARRY_CAP, CRUISE_THROTTLE, DECOYS_PER_SECTOR, FIXED_DT, GRID_SIZE, GUN_CAP_MIN, HEAR_MIN, MAX_LEVELS,
  MAX_ROCKETS, MAX_SALVO, MAX_STEPS_PER_FRAME, POINTS_BONUS, POINTS_PER_PACKAGE, REWARD_BONUS
} from './constants.js';
import { _c1 } from './math.js';
import { createProceduralTextures } from './textures.js';
import { VFXSystem } from './vfx.js';
import { inputMethods } from './input.js';
import { levelMethods } from './level.js';
import { flightMethods } from './flight.js';
import { combatMethods } from './combat.js';
import { enemiesMethods } from './enemies.js';
import { lidarMethods } from './lidar.js';
import { progressMethods } from './progress.js';
import { uiMethods } from './ui.js';
import { hudMethods } from './hud.js';

export class NikitaGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.hudCanvas = document.getElementById('hud-canvas');
    this.hudCtx = this.hudCanvas.getContext('2d');
    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas.getContext('2d');

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010804);   // lidar screen: near-black green
    this.scene.fog = new THREE.FogExp2(0x010804, 0.0);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.15, 210);

    const amb = new THREE.AmbientLight(0x88bbaa, 0.65);
    this.scene.add(amb);
    const hemi = new THREE.HemisphereLight(0xd8ffee, 0x3b584e, 1.55);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.15);
    dir.position.set(28, 60, 22);
    this.scene.add(dir);

    this.lights = { amb, hemi, dir };
    this.headlamp = new THREE.PointLight(0xd8ffee, 5.0, 36, 1.4);
    this.headlamp.position.set(0, -100, 0);
    this.scene.add(this.headlamp);

    this.textures = createProceduralTextures();
    this.audio = new AudioEngine();
    this.vfx = new VFXSystem(this.scene);

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.wallTex, roughness: 0.48, metalness: 0.35,
      emissive: new THREE.Color(0x0c2c1f), emissiveIntensity: 0.72
    });
    this.floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.floorTex, roughness: 0.62, metalness: 0.2,
      emissive: new THREE.Color(0x071c15), emissiveIntensity: 0.45
    });
    this.runwayMat = new THREE.MeshStandardMaterial({
      map: this.textures.runwayTex, roughness: 0.52, metalness: 0.2,
      emissive: new THREE.Color(0x004d26), emissiveIntensity: 0.85
    });
    this.ceilMat = new THREE.MeshStandardMaterial({
      map: this.textures.ceilTex, roughness: 0.75, metalness: 0.15,
      emissive: new THREE.Color(0x0a1c22), emissiveIntensity: 0.55
    });
    this.hazardMat = new THREE.MeshStandardMaterial({ map: this.textures.hazardTex, roughness: 0.45, metalness: 0.3 });
    {
      // Procedural cracked-plate texture for destroyable walls
      const cc = document.createElement('canvas'); cc.width = 256; cc.height = 256;
      const cx = cc.getContext('2d');
      cx.fillStyle = '#2a1f1a'; cx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 40; i++) { cx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`; cx.fillRect(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 40, 2 + Math.random() * 6); }
      cx.strokeStyle = '#ff7a1a'; cx.shadowColor = '#ff5a00'; cx.shadowBlur = 10; cx.lineWidth = 4; cx.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        let x = 128 + (Math.random() - 0.5) * 60, y = 128 + (Math.random() - 0.5) * 60;
        cx.beginPath(); cx.moveTo(x, y);
        const ang = (k / 7) * Math.PI * 2 + Math.random() * 0.5;
        for (let seg = 0; seg < 6; seg++) { x += Math.cos(ang + (Math.random() - 0.5) * 1.0) * 24; y += Math.sin(ang + (Math.random() - 0.5) * 1.0) * 24; cx.lineTo(x, y); }
        cx.stroke();
      }
      cx.shadowBlur = 0; cx.fillStyle = '#ffaa00';
      for (let x = -256; x < 256; x += 32) { cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x + 16, 0); cx.lineTo(x + 16 + 14, 14); cx.lineTo(x + 14, 14); cx.fill(); }
      const tex = new THREE.CanvasTexture(cc); tex.colorSpace = THREE.SRGBColorSpace;
      this.crackMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.15, emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.6 });
    }

    this.maxSentries = 40;
    this.maxBarrels = 48;
    this.thermalMats = new Map();
    this._hit = new THREE.Vector3();
    this._hitCls = 1;
    this._hitSeg = -1;
    this.revealedSeg = new Set();
    this.thermalTime = { value: 0 };
    this.thermalRes = { value: 1 };
    this.initSentryInstancedMeshes();
    this.initBarrelInstancedMesh();
    this.sentryTorsoMesh.material = this.thermalMat(0.8);
    this.sentryHeadMesh.material = this.thermalMat(0.97);
    this.sentryGunMesh.material = this.thermalMat(0.5);
    this.barrelMesh.material = this.thermalMat(0.62);
    _c1.setRGB(0, 0, 0);
    for (let i = 0; i < this.maxSentries; i++) { this.sentryTorsoMesh.setColorAt(i, _c1); this.sentryHeadMesh.setColorAt(i, _c1); this.sentryGunMesh.setColorAt(i, _c1); }
    for (let i = 0; i < this.maxBarrels; i++) this.barrelMesh.setColorAt(i, _c1);
    this.initMissileMesh();
    this.initWireTether();
    this.initAmbientMotes();

    this.state = 'BRIEFING';
    this.level = 1;
    this.difficultyTier = 1;
    this.seedStr = this.generateRandomSeed();
    const briefSeedEl = document.getElementById('brief-seed');
    if (briefSeedEl) briefSeedEl.value = this.seedStr;
    this.customSeedEntered = false;
    this.grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.floors = [this.grid];
    this.nFloors = 1;
    this.floorRooms = [[]];
    this.ramps = [];
    this.rampAt = new Map();
    this.rampProtect = new Set();
    this.lifts = [];
    this.liftCells = new Set();
    this.atriums = [];
    this._ef = 0;
    this._hitRamp = -1;
    this.rooms = [];
    this.spawnPos = new THREE.Vector3();

    this.ammo = MAX_SALVO;
    this.fired = 0;
    this.resetRewards();
    this.breakables = [];
    this.pickups = [];
    this.secretHidden = new Set();
    this.power = { stealth: 0, freeBoost: 0, overcharge: false };
    this.noiseRadius = HEAR_MIN;
    this.secretsFound = 0;
    this.shortcutsOpened = 0;
    this.launchAim = { yaw: 0, pitch: 0 };
    this.upg = { speed: 0, fuel: 0, boost: 0, hull: 0, force: 0, lrange: 0, lres: 0, lfocus: 0, ltherm: 0, lmem: 0, ldeep: 0, tpen: 0, ttrack: 0, tmark: 0, gun: 0 };
    this.upgTab = 'rocket';
    this.initLidar();
    this.initGun();
    this.credits = 0;
    this.sectorBest = {};
    this.contLvl = 0;      // sector to resume with CONTINUE (0 = no save)
    this.contSeed = '';
    this.loadProgress();
    this.score = 0;
    this.sectorStartScore = 0;
    this.nextPackage = POINTS_PER_PACKAGE;
    this.ptsPending = [];
    this.blastMult = 1;
    this.gunAmmo = GUN_CAP_MIN;
    this.gunHeld = false;
    this.autoPlay = false;     // the autopilot keeps playing across rockets while this is on
    this.pilot = new Autopilot(this);   // the rewritten autopilot
    this.fuzeMode = 'prox';      // proximity fuze armed by default; the DET button toggles hold-to-detonate
    this.gunCool = 0;
    this.gunNoiseT = 0;
    this._gunMsgT = 0;
    this.decoys = DECOYS_PER_SECTOR;
    this.decoyObjs = [];
    this.modifier = null;
    this.stats = { maxThrottle: 0 };
    this.targets = [];
    this.barrels = [];
    this.sentries = [];
    this.lasers = [];
    this.turbines = [];
    this.grates = [];
    this.ecmZones = [];
    this.bulkheads = [];
    this.turrets = [];
    this.steamVents = [];
    this.pendingBlasts = [];

    this.alertsTriggered = 0;
    this.sentriesNeutralized = 0;
    this.missionTime = 0;

    this.missile = {
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      yawRate: 0,
      pitchRate: 0,
      drop: 0,
      flipping: false,
      flipUsed: false,
      flipT: 0,
      flipStart: 0,
      burnT: 0,
      throttle: CRUISE_THROTTLE,
      effThrottle: CRUISE_THROTTLE,
      baseSpeedMode: 2,
      activeSpeedMode: 2,
      currentSpeed: 16.0,
      fuel: 100,
      fuelOut: -1,
      fuelWarned: false,
      boost: 100,
      boostDepleted: false,
      hull: 100,
      signal: 100,
      exhaustTimer: 0,
      vortexTimer: 0,
      tetherTimer: 0,
      inECM: false,
      wallProximity: 0
    };

    // Camera defaults to Nose-Cam FPV
    this.camMode = 'FPV';
    this.cameraTrauma = 0;
    this.hitStopTimer = 0;
    this.respawnTimer = 0;
    this.killCamTimer = 0;
    this.killCamTarget = new THREE.Vector3();
    this.killCamAngle = 0;
    this.flashAlpha = 0;

    this.lockedEnemy = null;
    this.homingLocked = false;
    this.manualTargetLock = false;
    this.lastHighlightedRef = null;

    this.cfg = {
      infFuel: false,
      godMode: false,
      infBoost: false,
      xray: false,
      homing: false,
      autoLevel: true,
      invertPitch: false,
      showFps: false,
      brightness: 1.5,
      gyroSens: 1.0,
      mouseSens: 1.0,
      timeScale: 1.0,
      speedMult: 1.0,
      agilityMult: 1.0
    };

    this.keys = {};
    this.mouseYawDelta = 0;
    this.mousePitchDelta = 0;
    this.pointerLocked = false;
    this.radarOpen = true;
    this.overrideOpen = false;
    this.paused = false;
    this.portraitBlocked = false;
    this.hapticsEnabled = true;
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    // Gyroscope State (OFF by default)
    this.gyro = {
      enabled: false,
      calibrated: false,
      baseRoll: 0,
      basePitch: 0,
      yaw: 0,
      pitch: 0,
      motionBound: false
    };

    this.touchInput = {
      joyId: null,
      joyStartX: 0,
      joyStartY: 0,
      joyX: 0,
      joyY: 0,
      lookId: null,
      lookLastX: 0,
      lookLastY: 0,
      boost: false,
      crawl: false
    };

    this.fpsFrames = 0;
    this.fpsAccum = 0;
    this.fpsValue = 60;
    this.frameMs = 16.6;

    this.prefs = { lowSpec: false, lefty: false, btnScale: 1, btnOpacity: 0.92 };
    this._bestCand = { type: '', ref: null, aimY: 0 };
    this._bestScore = Infinity;
    this._isSolidFn = (x, z, y) => (y === undefined ? this.isGridSolid(x, z) : this.pointBlocked(x, y, z, 0.1));
    this._tracerHitFn = (hitPos) => {
      if (this.missile.active) this.detonateMissile(hitPos, 'SHOT DOWN BY HOSTILE FIRE!');
    };
    this.radarBase = null;
    this.radarDirty = true;
    this._radarTick = 0;
    const $ = (id) => document.getElementById(id);
    this.el = {
      speedLines: $('speed-lines'), ecmOverlay: $('ecm-overlay'), ecmBanner: $('ecm-banner'),
      flashOverlay: $('flash-overlay'), alertBanner: $('alert-banner'),
      btnLock: $('tbtn-lock'), hudPower: $('hud-power'),
      speedReadout: $('speed-readout'), valFuel: $('val-fuel'), fillFuel: $('fill-fuel'),
      valBoost: $('val-boost'), fillBoost: $('fill-boost'), valEff: $('val-eff'), fillEff: $('fill-eff'),
      valHull: $('val-hull'), fillHull: $('fill-hull'),
      valSignal: $('val-signal'), fillSignal: $('fill-signal')
    };

    this.bindEvents();
    this.loadPrefs();
    this.setupPlatformUI();
    this.applyResize();
    this.generateLevel(1, this.seedStr);

    this.lastTime = performance.now();
    this.accumulator = 0;
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ------------------------------------------------------------------------
     SEED, FULLSCREEN, GYROSCOPE & ORIENTATION HELPERS
     ------------------------------------------------------------------------ */
  generateRandomSeed() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  /* ------------------------------------------------------------------------
     MAIN FIXED-TIMESTEP SIMULATION TICK
     ------------------------------------------------------------------------ */
  stepSimulation(dt) {
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      return;
    }

    const effectiveDt = this.state === 'KILLCAM' ? dt * 0.25 : dt;

    if (this.state === 'PLAYING') {
      this.missionTime += dt;
    }

    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const pb = this.pendingBlasts[i];
      pb.delay -= effectiveDt;
      if (pb.delay <= 0) {
        this.pendingBlasts.splice(i, 1);
        this.pushFeed(pb.label, 'amber');
        this.blastMult = pb.mult || 1;
        this.triggerBlast(pb.pos, pb.radius, pb.power);
        this.checkSectorWon(pb.pos);
      }
    }

    this.updateFacilityObjects(effectiveDt);
    this.updatePickups(effectiveDt);
    this.autoPlayTick(effectiveDt);
    if (this.bullets) this.updateGun(effectiveDt);
    this.updateDecoys(effectiveDt);
    if (this.state === 'READY') this.updateReadyAim(effectiveDt);

    if (this.state === 'PLAYING' && this.missile.active) {
      this.updateMissile(effectiveDt);
    } else {
      this.audio.updateEngine(false, 2, 0, false);
    }

    this.updateSentries(effectiveDt);

    this.vfx.update(
      effectiveDt,
      this._isSolidFn,
      this._tracerHitFn,
      this.missile.pos,
      this.missile.active,
      this.cfg.godMode
    );

    if (this.state === 'RESPAWNING') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.enterReady(false);   // wait for the player to press FIRE
      }
    } else if (this.state === 'KILLCAM') {
      this.killCamTimer -= dt;
      this.killCamAngle += dt * 1.1;
      if (this.killCamTimer <= 0) {
        document.getElementById('killcam-banner').style.display = 'none';
        if (this.killCamFinal) {
          this.triggerSectorClear();
        } else {
          this.enterReady(false);   // wait for the player to press FIRE
        }
      }
    }

    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.65);
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 3.2);
    this.cStyle(this.el.flashOverlay, 'opacity', this.flashAlpha.toFixed(2));
  }

  /* ------------------------------------------------------------------------
     SECTOR CLEAR / MISSION FAILED / HUD HELPERS
     ------------------------------------------------------------------------ */
  triggerSectorClear() {
    this.state = 'CLEAR';
    this.lidarSnapshot();
    const used = this.fired;
    const tCount = this.targets.length;
    let rank = 'PANTHER';
    if (used <= tCount + 1 && this.alertsTriggered === 0) rank = 'FOXHOUND';
    else if (used <= tCount + 4 && this.alertsTriggered <= 3) rank = 'HOUND';
    else if (used <= Math.min(30, tCount * 2 + 8)) rank = 'DOBERMAN';

    // End-of-sector rocket rewards (carried into the next sector, up to MAX_ROCKETS)
    this.awardRockets(REWARD_BONUS.rank[rank], `RANK ${rank}`, 'bonus');
    this.awardPoints(POINTS_BONUS.rank[rank], `RANK ${rank}`, false);
    if (this.alertsTriggered === 0) { this.awardRockets(REWARD_BONUS.stealth, 'GHOST — NO ALERTS', 'bonus'); this.awardPoints(POINTS_BONUS.stealth, 'GHOST — NO ALERTS', false); }
    this.flushRewards();

    // Medals: optional challenges, +1 rocket each (outside the sector cap)
    const totalSecrets = this.breakables.filter((b) => b.kind === 'secret').length;
    const par = 45 + 14 * tCount;
    const medals = [
      { name: 'SHARPSHOOTER', ok: used <= tCount + 2 },
      { name: 'SILENT HUNTER', ok: this.stats.maxThrottle <= 0.6 },
      { name: `SPEEDRUN ${par}s`, ok: this.missionTime <= par }
    ];
    if (totalSecrets > 0) medals.push({ name: 'EXPLORER', ok: this.secretsFound >= totalSecrets });
    const medalCount = medals.filter((x) => x.ok).length;
    if (medalCount > 0) {
      const add = Math.max(0, Math.min(medalCount, MAX_ROCKETS - this.ammo));
      this.ammo += add;
      this.rewards.total += add;
      this.rewards.log.bonus = (this.rewards.log.bonus || 0) + add;
    }
    if (medalCount > 0) { this.awardPoints(POINTS_BONUS.medal * medalCount, `${medalCount} MEDAL${medalCount > 1 ? 'S' : ''}`, false); this.flushPoints(); }
    const medalText = medals.map((x) => (x.ok ? '★ ' : '☆ ') + x.name).join('  ·  ') + `   (+${medalCount})`;

    const isFinal = this.level >= MAX_LEVELS;
    document.getElementById('clear-title').textContent = isFinal ? 'CAMPAIGN COMPLETE' : 'SECTOR CLEAR';
    document.getElementById('clear-sector-sub').textContent = isFinal
      ? `ALL ${MAX_LEVELS} SECTORS NEUTRALIZED`
      : `SECTOR ${String(this.level).padStart(2, '0')} / ${MAX_LEVELS} NEUTRALIZED`;
    document.getElementById('btn-next-sector').textContent = isFinal ? 'NEW CAMPAIGN (SECTOR 01)' : 'DEPLOY NEXT SECTOR';
    document.getElementById('clear-rank').textContent = rank;
    document.getElementById('res-missiles').textContent = `${used} FIRED`;
    document.getElementById('res-medals').textContent = medalText;
    document.getElementById('res-points').textContent = `+${this.score - this.sectorStartScore}  (TOTAL ${this.score})`;
    document.getElementById('res-credits').textContent = String(this.credits);
    document.getElementById('res-rewards').textContent = `+${this.rewards.total}  (KILL REWARDS ${this.rewards.capUsed} / ${this.rewards.cap})`;
    const lg = this.rewards.log;
    const names = { target: 'TARGETS', sentry: 'SENTRIES', laser: 'LASERS', turret: 'TURRETS', grate: 'GRATES', bonus: 'BONUSES', cache: 'CACHES', points: 'POINT PACKAGES' };
    const detail = Object.keys(names).filter((k) => lg[k]).map((k) => `${names[k]} +${lg[k]}`).join(' · ');
    document.getElementById('res-rewards-detail').textContent = (detail || 'NO REWARDS EARNED') + `  |  RACK: ${this.ammo} / ${MAX_ROCKETS} (UP TO +${CARRY_CAP} CARRIES OVER)`;
    document.getElementById('res-alerts').textContent = String(this.alertsTriggered);
    document.getElementById('res-sentries').textContent = `${this.sentriesNeutralized} / ${this.sentries.length}`;
    document.getElementById('res-time').textContent = `${this.missionTime.toFixed(1)}s`;
    document.getElementById('clear-modal').style.display = 'flex';
    this.resetAllInputs();
    this.updateTouchControlsVisibility();
  }

  triggerMissionFailed(reason) {
    this.state = 'FAILED';
    this.lidarSnapshot();
    document.getElementById('fail-reason').textContent = reason;
    document.getElementById('fail-modal').style.display = 'flex';
    this.resetAllInputs();
    this.updateTouchControlsVisibility();
  }

  setPaused(flag) {
    if (this.state !== 'PLAYING' && this.state !== 'KILLCAM' && this.state !== 'RESPAWNING' && this.state !== 'READY') {
      this.paused = false;
      document.getElementById('pause-modal').style.display = 'none';
      return;
    }
    this.paused = Boolean(flag);
    this.resetAllInputs();
    document.getElementById('pause-modal').style.display = this.paused ? 'flex' : 'none';
    if (this.state === 'READY') document.getElementById('fire-btn').style.display = this.paused ? 'none' : 'block';
    if (this.paused) this.refreshMenuLabels();
    if (this.paused && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }
    this.updateTouchControlsVisibility();
  }

  /* ------------------------------------------------------------------------
     MAIN 60 FPS FIXED-TIMESTEP RENDER LOOP
     ------------------------------------------------------------------------ */
  loop(now) {
    if (this.stopped) return;
    requestAnimationFrame((t) => this.loop(t));
    const rawDt = Math.max(0, Math.min(0.05, (now - this.lastTime) * 0.001));   // never negative (the first rAF timestamp can be older than lastTime)
    this.lastTime = now;

    this.fpsFrames++;
    this.fpsAccum += rawDt;
    if (this.fpsAccum >= 0.4) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsAccum);
      this.frameMs = (this.fpsAccum / this.fpsFrames) * 1000;
      this.fpsFrames = 0;
      this.fpsAccum = 0;
      if (this.state === 'PLAYING' && !this.paused && !this.prefs.lowSpec && !this.lowFpsWarned) {
        this.lowFpsCount = this.fpsValue < 38 ? (this.lowFpsCount || 0) + 1 : 0;
        if (this.lowFpsCount >= 10) {
          this.lowFpsWarned = true;
          this.pushFeed('LOW FPS — TRY LOW-SPEC MODE IN MENU', 'amber');
        }
      }
      if (this.cfg.showFps) {
        const dc = this.renderer.info.render.calls;
        document.getElementById('fps-badge').textContent = `FPS: ${this.fpsValue} | ${this.frameMs.toFixed(1)}ms | DC: ${dc}`;
      }
    }

    if (this.paused || this.portraitBlocked) {
      this.audio.updateEngine(false, 2, 0, false);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.accumulator += rawDt * this.cfg.timeScale;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps++ < MAX_STEPS_PER_FRAME) {
      this.stepSimulation(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    if (this.accumulator >= FIXED_DT) this.accumulator = 0;   // step cap hit: drop the backlog instead of chasing it next frame

    this.updateCamera(rawDt);
    this.updateLidar(rawDt);
    this.renderer.render(this.scene, this.camera);
    this.renderHUDCanvas();
    this.renderSolitonRadar();
  }



  startSector(lvl, seed, carryOver = false) {
    this.contLvl = lvl; this.contSeed = String(seed || ''); this.saveProgress();
    document.getElementById('clear-modal').style.display = 'none';
    document.getElementById('fail-modal').style.display = 'none';
    document.getElementById('killcam-banner').style.display = 'none';
    document.getElementById('briefing-modal').style.display = 'none';
    document.getElementById('pause-modal').style.display = 'none';
    document.getElementById('hud-layer').style.display = 'block';
    this.paused = false;
    // score: a new campaign starts at 0; the next sector keeps it; a retry restores the sector's starting score
    if (this.state === 'BRIEFING' || (lvl === 1 && !carryOver && this.state === 'CLEAR')) { this.score = 0; this.sectorStartScore = 0; }
    else if (carryOver) this.sectorStartScore = this.score;
    else this.score = this.sectorStartScore;
    this.nextPackage = (Math.floor(this.score / POINTS_PER_PACKAGE) + 1) * POINTS_PER_PACKAGE;
    this.ptsPending = [];
    // Advancing from a cleared sector keeps up to CARRY_CAP unspent rockets above the standard salvo.
    this.ammo = carryOver ? MAX_SALVO + Math.min(CARRY_CAP, Math.max(0, this.ammo - MAX_SALVO)) : MAX_SALVO;
    this.radarOpen = true;
    document.getElementById('radar-container').style.display = 'block';
    document.getElementById('btn-hud-radar').classList.add('active');
    const activeSeed = seed || this.generateRandomSeed();
    const briefSeedEl = document.getElementById('brief-seed');
    const ovSeedEl = document.getElementById('ov-seed-input');
    if (briefSeedEl) briefSeedEl.value = activeSeed;
    if (ovSeedEl) ovSeedEl.value = activeSeed;
    this.resetAllInputs();
    this.generateLevel(lvl, activeSeed);
    this.enterReady();
    this.updateTouchControlsVisibility();
    if (this.difficultyTier > (this.lastStartedTier || 1)) {
      this.pushFeed(`DIFFICULTY UPGRADED — SECURITY TIER ${String(this.difficultyTier).padStart(2, '0')}`, 'red');
    }
    this.lastStartedTier = this.difficultyTier;
  }

  /* Resize events (window, visualViewport, orientation) arrive in bursts, e.g. while a phone's URL bar animates.
     They are coalesced into one resize per animation frame. */
  onResize() {
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => { this._resizeRaf = 0; this.applyResize(); });
  }

  /* Immediate resize. The canvases are only reallocated when the size or pixel ratio really changed. */
  applyResize() {
    if (this.stopped) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, (this.prefs && this.prefs.lowSpec) ? 1 : 2);
    if (w !== this._rw || h !== this._rh || dpr !== this._rdpr) {
      this._rw = w; this._rh = h; this._rdpr = dpr;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h);
      this.hudCanvas.width = Math.floor(w * dpr);
      this.hudCanvas.height = Math.floor(h * dpr);
      this.hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.checkOrientation();
  }
}

/* Mix the method groups into the class. Each group is a plain object of methods (no state of its own): everything is read from `this`. */
function mixin(target, ...groups) {
  for (const g of groups) {
    const d = Object.getOwnPropertyDescriptors(g);
    for (const k of Object.keys(d)) { if (Object.prototype.hasOwnProperty.call(target, k)) throw new Error('NikitaGame mixin clash: ' + k); d[k].enumerable = false; }
    Object.defineProperties(target, d);
  }
}
mixin(NikitaGame.prototype, inputMethods, levelMethods, flightMethods, combatMethods, enemiesMethods, lidarMethods, progressMethods, uiMethods, hudMethods);
