/* Sector generation and world content for NikitaGame: scene meshes, level layout, floors, ramps, lifts, and the spawners for targets, hazards and pickups. */
import * as THREE from 'three';
import {
  CELL_CRACKED, CELL_FLOOR, CELL_RAMP, CELL_RUNWAY, CELL_SHAFT_LOW, CELL_SIZE, CELL_VOID, CELL_WALL,
  DECOYS_PER_SECTOR, GRID_SIZE, LEVELS_PER_TIER, LIDAR_KEY_PREFIX, LIFT_BASE, MAX_LEVELS, MAX_TETHER_PTS,
  MODIFIER_INFO, POINTS_BONUS, RAMP_LEN, RIM_BASE, SENTRY_VISION, WALL_H, isShaft, isWalkable, isWallLike
} from './constants.js';
import {
  PROBE_DIRS, _dummy, _v5, gridToWorldX, gridToWorldZ, hashSeedString, mulberry32, worldToGridX, worldToGridZ
} from './math.js';

export const levelMethods = {

  /* ------------------------------------------------------------------------
     INSTANCED SENTRY & BARREL SETUP
     ------------------------------------------------------------------------ */
  initSentryInstancedMeshes() {
    const torsoGeo = new THREE.BoxGeometry(0.92, 1.35, 0.56);
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x3b4d44, roughness: 0.7, metalness: 0.25 });
    this.sentryTorsoMesh = new THREE.InstancedMesh(torsoGeo, torsoMat, this.maxSentries);
    this.sentryTorsoMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sentryTorsoMesh.frustumCulled = false;
    this.scene.add(this.sentryTorsoMesh);

    const headGeo = new THREE.BoxGeometry(0.52, 0.52, 0.54);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xd4e2d8, emissive: 0x112218, roughness: 0.4 });
    this.sentryHeadMesh = new THREE.InstancedMesh(headGeo, headMat, this.maxSentries);
    this.sentryHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sentryHeadMesh.frustumCulled = false;
    this.scene.add(this.sentryHeadMesh);

    const gunGeo = new THREE.BoxGeometry(0.14, 0.18, 1.05);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x181c1e, metalness: 0.7, roughness: 0.35 });
    this.sentryGunMesh = new THREE.InstancedMesh(gunGeo, gunMat, this.maxSentries);
    this.sentryGunMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sentryGunMesh.frustumCulled = false;
    this.scene.add(this.sentryGunMesh);

    const coneLen = SENTRY_VISION;
    const coneRad = Math.tan(0.52) * coneLen;
    const coneGeo = new THREE.ConeGeometry(coneRad, coneLen, 16, 1, true);
    coneGeo.translate(0, -coneLen * 0.5, 0);
    coneGeo.rotateX(Math.PI * 0.5);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.sentryConeMesh = new THREE.InstancedMesh(coneGeo, coneMat, this.maxSentries);
    this.sentryConeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sentryConeMesh.frustumCulled = false;
    this.scene.add(this.sentryConeMesh);
  },

  initBarrelInstancedMesh() {
    const geo = new THREE.CylinderGeometry(0.58, 0.58, 1.65, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcc2222, emissive: 0x330505, roughness: 0.45, metalness: 0.4
    });
    this.barrelMesh = new THREE.InstancedMesh(geo, mat, this.maxBarrels);
    this.barrelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.barrelMesh.frustumCulled = false;
    this.scene.add(this.barrelMesh);
  },

  initMissileMesh() {
    this.missileGroup = new THREE.Group();

    const hullMat   = new THREE.MeshStandardMaterial({ color: 0xb8c7cf, metalness: 0.82, roughness: 0.24 });
    const darkMat   = new THREE.MeshStandardMaterial({ color: 0x222c32, metalness: 0.72, roughness: 0.38 });
    const redMat    = new THREE.MeshStandardMaterial({ color: 0xd92b2b, emissive: 0x2a0404, metalness: 0.45, roughness: 0.32 });
    const lensMat   = new THREE.MeshStandardMaterial({ color: 0x051814, emissive: 0x00ffaa, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.1 });
    const bandMat   = new THREE.MeshStandardMaterial({ map: this.textures.hazardTex, roughness: 0.4, metalness: 0.35 });
    const portMat   = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    const stbdMat   = new THREE.MeshBasicMaterial({ color: 0x00ff88 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 1.32, 14), hullMat);
    body.rotation.x = Math.PI * 0.5;
    this.missileGroup.add(body);

    const hazardRing = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.16, 14), bandMat);
    hazardRing.rotation.x = Math.PI * 0.5;
    hazardRing.position.z = -0.18;
    this.missileGroup.add(hazardRing);

    const rearCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.20, 0.22, 14), darkMat);
    rearCollar.rotation.x = Math.PI * 0.5;
    rearCollar.position.z = 0.48;
    this.missileGroup.add(rearCollar);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.44, 14), redMat);
    nose.rotation.x = -Math.PI * 0.5;
    nose.position.z = -0.88;
    this.missileGroup.add(nose);

    const seekerDome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), lensMat);
    seekerDome.position.z = -1.07;
    this.missileGroup.add(seekerDome);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 1.08), darkMat);
    spine.position.set(0, 0.20, 0.05);
    this.missileGroup.add(spine);

    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa });
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.09), this.beaconMat);
    beacon.position.set(0, 0.25, 0.24);
    this.missileGroup.add(beacon);

    const podGeo = new THREE.BoxGeometry(0.07, 0.09, 0.54);
    const leftPod = new THREE.Mesh(podGeo, darkMat);
    leftPod.position.set(-0.21, -0.02, 0.02);
    const rightPod = new THREE.Mesh(podGeo, darkMat);
    rightPod.position.set(0.21, -0.02, 0.02);
    this.missileGroup.add(leftPod, rightPod);

    const finGeo = new THREE.BoxGeometry(0.46, 0.035, 0.38);
    const finOffsets = [
      { x: -0.32, y: 0, rz: 0.0, mat: darkMat },
      { x:  0.32, y: 0, rz: 0.0, mat: darkMat },
      { x:  0, y:  0.32, rz: Math.PI * 0.5, mat: darkMat },
      { x:  0, y: -0.32, rz: Math.PI * 0.5, mat: darkMat }
    ];
    for (const f of finOffsets) {
      const fin = new THREE.Mesh(finGeo, f.mat);
      fin.position.set(f.x, f.y, 0.50);
      fin.rotation.z = f.rz;
      this.missileGroup.add(fin);
    }

    const tipGeo = new THREE.SphereGeometry(0.032, 6, 6);
    const portTip = new THREE.Mesh(tipGeo, portMat);
    portTip.position.set(-0.55, 0, 0.56);
    const stbdTip = new THREE.Mesh(tipGeo, stbdMat);
    stbdTip.position.set(0.55, 0, 0.56);
    this.missileGroup.add(portTip, stbdTip);

    const canardGeo = new THREE.BoxGeometry(0.24, 0.024, 0.14);
    this.canardH = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.024, 0.14), redMat);
    this.canardH.position.set(0, 0, -0.46);
    this.canardV = new THREE.Mesh(canardGeo, redMat);
    this.canardV.rotation.z = Math.PI * 0.5;
    this.canardV.position.set(0, 0, -0.46);
    this.missileGroup.add(this.canardH, this.canardV);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.24, 14, 1, true), darkMat);
    nozzle.rotation.x = Math.PI * 0.5;
    nozzle.position.z = 0.74;
    this.missileGroup.add(nozzle);

    this.thrusterMat = new THREE.MeshBasicMaterial({
      color: 0xff7722, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.88, depthWrite: false
    });
    this.thrusterCone = new THREE.Mesh(new THREE.ConeGeometry(0.19, 1.05, 12), this.thrusterMat);
    this.thrusterCone.rotation.x = Math.PI * 0.5;
    this.thrusterCone.position.z = 1.24;
    this.missileGroup.add(this.thrusterCone);

    this.thrusterCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffffdd, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false
    });
    this.thrusterCore = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.62, 10), this.thrusterCoreMat);
    this.thrusterCore.rotation.x = Math.PI * 0.5;
    this.thrusterCore.position.z = 1.02;
    this.missileGroup.add(this.thrusterCore);

    this.scene.add(this.missileGroup);
  },

  initWireTether() {
    this.tetherPositions = new Float32Array(MAX_TETHER_PTS * 3);
    this.tetherGeo = new THREE.BufferGeometry();
    this.tetherGeo.setAttribute('position', new THREE.BufferAttribute(this.tetherPositions, 3));
    this.tetherGeo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffaa, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending
    });
    this.tetherLine = new THREE.Line(this.tetherGeo, mat);
    this.tetherLine.frustumCulled = false;
    this.tetherLine.visible = false;
    this.scene.add(this.tetherLine);
    this.tetherCount = 0;
  },

  initAmbientMotes() {
    this.moteCount = 180;
    this.moteSpan = 34.0;
    this.motePositions = new Float32Array(this.moteCount * 3);
    for (let i = 0; i < this.moteCount; i++) {
      this.motePositions[i * 3]     = (Math.random() - 0.5) * this.moteSpan;
      this.motePositions[i * 3 + 1] = 0.3 + Math.random() * (WALL_H - 0.6);
      this.motePositions[i * 3 + 2] = (Math.random() - 0.5) * this.moteSpan;
    }
    this.moteGeo = new THREE.BufferGeometry();
    this.moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0x88ffd8, size: 0.14, transparent: true, opacity: 0.52,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.motePoints = new THREE.Points(this.moteGeo, moteMat);
    this.motePoints.frustumCulled = false;
    this.motePoints.visible = false;
    this.scene.add(this.motePoints);
  },

  updateAmbientMotes(centerPos, dt) {
    const half = this.moteSpan * 0.5;
    const pos = this.motePositions;
    for (let i = 0; i < this.moteCount; i++) {
      const idx = i * 3;
      pos[idx + 1] += Math.sin(i + performance.now() * 0.001) * 0.12 * dt;
      let dx = pos[idx] - centerPos.x;
      let dz = pos[idx + 2] - centerPos.z;
      if (dx > half) pos[idx] -= this.moteSpan;
      else if (dx < -half) pos[idx] += this.moteSpan;
      if (dz > half) pos[idx + 2] -= this.moteSpan;
      else if (dz < -half) pos[idx + 2] += this.moteSpan;
      if (pos[idx + 1] < 0.25) pos[idx + 1] = WALL_H - 0.35;
      else if (pos[idx + 1] > WALL_H - 0.25) pos[idx + 1] = 0.35;
    }
    this.moteGeo.attributes.position.needsUpdate = true;
  },

  resetTether(pos) {
    this.tetherCount = 1;
    this.tetherPositions[0] = pos.x;
    this.tetherPositions[1] = pos.y;
    this.tetherPositions[2] = pos.z;
    this.tetherGeo.setDrawRange(0, 1);
    this.tetherGeo.attributes.position.needsUpdate = true;
  },

  pushTetherPoint(pos) {
    if (this.tetherCount < MAX_TETHER_PTS) {
      const idx = this.tetherCount * 3;
      this.tetherPositions[idx] = pos.x;
      this.tetherPositions[idx + 1] = pos.y;
      this.tetherPositions[idx + 2] = pos.z;
      this.tetherCount++;
    } else {
      this.tetherPositions.copyWithin(0, 3);
      const idx = (MAX_TETHER_PTS - 1) * 3;
      this.tetherPositions[idx] = pos.x;
      this.tetherPositions[idx + 1] = pos.y;
      this.tetherPositions[idx + 2] = pos.z;
    }
    this.tetherGeo.setDrawRange(0, this.tetherCount);
    this.tetherGeo.attributes.position.needsUpdate = true;
  },

  /* ------------------------------------------------------------------------
     SEEDED 64x64 FACILITY GENERATOR (100 PROCEDURAL LEVELS, 20 DIFFICULTY TIERS)
     ------------------------------------------------------------------------ */
  generateLevel(levelIndex, seedStr) {
    this.level = Math.max(1, Math.min(MAX_LEVELS, Math.floor(levelIndex)));
    this.difficultyTier = Math.floor((this.level - 1) / LEVELS_PER_TIER) + 1;
    const tier = this.difficultyTier;
    this.seedStr = String(seedStr || '1998');
    const numericSeed = (hashSeedString(this.seedStr) ^ Math.imul(this.level, 2654435761)) >>> 0;
    const rng = mulberry32(numericSeed);
    // sector modifier: its own random stream so the layout is unaffected
    const modRng = mulberry32((numericSeed ^ 0xA5A5A5A5) >>> 0);
    const MODS = Object.keys(MODIFIER_INFO);
    this.modifier = (this.level >= 4 && modRng() < 0.55) ? MODS[Math.floor(modRng() * MODS.length)] : null;

    const sharedMats = new Set([this.wallMat, this.floorMat, this.runwayMat, this.ceilMat, this.hazardMat]);
    for (const tm of this.thermalMats.values()) sharedMats.add(tm);
    while (this.levelGroup.children.length > 0) {
      const ch = this.levelGroup.children[0];
      this.levelGroup.remove(ch);
      ch.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mt of mats) if (!sharedMats.has(mt)) mt.dispose();
        }
        if (o.isInstancedMesh) o.dispose();
      });
    }
    this.vfx.resetAll();
    this.gameClock = 0;
    this.radarDirty = true;
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
    this.breakables = [];
    this.pickups = [];
    this.decoyObjs = [];
    this.decoys = DECOYS_PER_SECTOR;
    this.stats = { maxThrottle: 0 };
    this.secretHidden = new Set();
    this.power = { stealth: 0, freeBoost: 0, overcharge: false };
    this.secretsFound = 0;
    this.shortcutsOpened = 0;
    this.floorsReached = new Set();
    this.rooms = [];
    this.grid.fill(CELL_WALL);

    const carveRect = (x0, z0, w, h, val = CELL_FLOOR) => {
      for (let z = z0; z < z0 + h; z++) {
        for (let x = x0; x < x0 + w; x++) {
          if (x > 1 && x < GRID_SIZE - 2 && z > 1 && z < GRID_SIZE - 2) {
            this.grid[z * GRID_SIZE + x] = val;
          }
        }
      }
    };

    const spawnRoom = { x: 29, z: 53, w: 7, h: 7, cx: 32, cz: 56, isSpawn: true };
    this.rooms.push(spawnRoom);
    carveRect(spawnRoom.x, spawnRoom.z, spawnRoom.w, spawnRoom.h, CELL_FLOOR);
    carveRect(31, 42, 3, 14, CELL_RUNWAY);
    const hubRoom = { x: 27, z: 36, w: 11, h: 7, cx: 32, cz: 39, isHub: true };
    this.rooms.push(hubRoom);
    carveRect(hubRoom.x, hubRoom.z, hubRoom.w, hubRoom.h, CELL_FLOOR);

    const desiredRooms = Math.min(18, 7 + Math.floor(tier * 0.6) + Math.floor(rng() * 3));
    for (let attempt = 0; attempt < 220 && this.rooms.length < desiredRooms; attempt++) {
      const w = 5 + Math.floor(rng() * (tier >= 10 ? 6 : 7));
      const h = 5 + Math.floor(rng() * (tier >= 10 ? 6 : 7));
      const x = 3 + Math.floor(rng() * (GRID_SIZE - w - 6));
      const z = 3 + Math.floor(rng() * (46 - h));
      let overlap = false;
      for (const r of this.rooms) {
        if (x < r.x + r.w + 2 && x + w + 2 > r.x && z < r.z + r.h + 2 && z + h + 2 > r.z) {
          overlap = true; break;
        }
      }
      if (!overlap) {
        const rm = { x, z, w, h, cx: Math.floor(x + w * 0.5), cz: Math.floor(z + h * 0.5) };
        this.rooms.push(rm);
        carveRect(x, z, w, h, CELL_FLOOR);
      }
    }

    const carveCorridor = (x1, z1, x2, z2, width = 3) => {
      const lo = -Math.floor((width - 1) / 2);
      const hi = Math.floor(width / 2);
      const dx = x2 >= x1 ? 1 : -1;
      for (let x = x1; x !== x2; x += dx) {
        for (let o = lo; o <= hi; o++) {
          const gz = z1 + o;
          if (x > 1 && x < GRID_SIZE - 2 && gz > 1 && gz < GRID_SIZE - 2) {
            if (this.grid[gz * GRID_SIZE + x] === CELL_WALL) this.grid[gz * GRID_SIZE + x] = CELL_FLOOR;
          }
        }
      }
      const dz = z2 >= z1 ? 1 : -1;
      for (let z = z1; z !== z2; z += dz) {
        for (let o = lo; o <= hi; o++) {
          const gx = x2 + o;
          if (gx > 1 && gx < GRID_SIZE - 2 && z > 1 && z < GRID_SIZE - 2) {
            if (this.grid[z * GRID_SIZE + gx] === CELL_WALL) this.grid[z * GRID_SIZE + gx] = CELL_FLOOR;
          }
        }
      }
    };

    const mainCorridorW = tier >= 12 ? 2 : 3;
    for (let i = 2; i < this.rooms.length; i++) {
      const curr = this.rooms[i];
      let best = this.rooms[1], bestD = 1e9;
      for (let j = 1; j < i; j++) {
        const d = Math.hypot(curr.cx - this.rooms[j].cx, curr.cz - this.rooms[j].cz);
        if (d < bestD) { bestD = d; best = this.rooms[j]; }
      }
      carveCorridor(curr.cx, curr.cz, best.cx, best.cz, mainCorridorW);
      if (rng() < Math.min(0.7, 0.35 + tier * 0.02) && i > 2) {
        const alt = this.rooms[1 + Math.floor(rng() * (i - 1))];
        carveCorridor(curr.cx, curr.cz, alt.cx, alt.cz, 2);
      }
    }

    this.placeBreakables(numericSeed, tier);
    this.placeShafts(numericSeed, tier);
    this.buildFloors(numericSeed, tier);

    let wallCount = 0, floorCount = 0, runwayCount = 0;
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const v = this.grid[z * GRID_SIZE + x];
        if (v === CELL_WALL) {
          let adjOpen = false;
          for (let dz = -1; dz <= 1 && !adjOpen; dz++) {
            for (let dx = -1; dx <= 1 && !adjOpen; dx++) {
              const nx = x + dx, nz = z + dz;
              if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
                if (this.grid[nz * GRID_SIZE + nx] !== CELL_WALL) adjOpen = true;
              }
            }
          }
          if (adjOpen) wallCount++;
        } else if (v === CELL_RUNWAY) {
          runwayCount++;
        } else {
          floorCount++;
        }
      }
    }

    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_H, CELL_SIZE);
    const floorGeo = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
    floorGeo.rotateX(-Math.PI * 0.5);
    const ceilGeo = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
    ceilGeo.rotateX(Math.PI * 0.5);

    const wallInst = new THREE.InstancedMesh(wallGeo, this.wallMat, Math.max(1, wallCount));
    const floorInst = new THREE.InstancedMesh(floorGeo, this.floorMat, Math.max(1, floorCount));
    const runwayInst = new THREE.InstancedMesh(floorGeo, this.runwayMat, Math.max(1, runwayCount));
    const ceilInst = new THREE.InstancedMesh(ceilGeo, this.ceilMat, Math.max(1, floorCount + runwayCount));

    let wi = 0, fi = 0, ri = 0, ci = 0;
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const v = this.grid[z * GRID_SIZE + x];
        const wx = gridToWorldX(x);
        const wz = gridToWorldZ(z);
        if (v === CELL_WALL) {
          let adjOpen = false;
          for (let dz = -1; dz <= 1 && !adjOpen; dz++) {
            for (let dx = -1; dx <= 1 && !adjOpen; dx++) {
              const nx = x + dx, nz = z + dz;
              if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
                if (this.grid[nz * GRID_SIZE + nx] !== CELL_WALL) adjOpen = true;
              }
            }
          }
          if (adjOpen) {
            _dummy.position.set(wx, WALL_H * 0.5, wz);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            wallInst.setMatrixAt(wi++, _dummy.matrix);
          }
        } else {
          _dummy.position.set(wx, 0, wz);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          if (v === CELL_RUNWAY) runwayInst.setMatrixAt(ri++, _dummy.matrix);
          else floorInst.setMatrixAt(fi++, _dummy.matrix);

          _dummy.position.set(wx, WALL_H, wz);
          _dummy.updateMatrix();
          ceilInst.setMatrixAt(ci++, _dummy.matrix);
        }
      }
    }
    [wallInst, floorInst, runwayInst, ceilInst].forEach((m) => {
      m.userData.structural = true;
      m.instanceMatrix.needsUpdate = true;
      m.matrixAutoUpdate = false;
      this.levelGroup.add(m);
    });

    // Overhead Industrial Ceiling Light Fixtures + Volumetric Light Shafts
    const lightFixtureSpots = [];
    for (let z = 4; z < GRID_SIZE - 4; z += 5) {
      for (let x = 4; x < GRID_SIZE - 4; x += 5) {
        const v = this.grid[z * GRID_SIZE + x];
        if (!isWallLike(v)) {
          lightFixtureSpots.push({ x: gridToWorldX(x), z: gridToWorldZ(z), isRunway: v === CELL_RUNWAY });
        }
      }
    }
    if (lightFixtureSpots.length > 0) {
      const fixGeo = new THREE.BoxGeometry(1.4, 0.16, 0.36);
      const fixMat = new THREE.MeshBasicMaterial({ color: 0x99ffee });
      const fixInst = new THREE.InstancedMesh(fixGeo, fixMat, lightFixtureSpots.length);
      fixInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      const shaftGeo = new THREE.ConeGeometry(2.1, WALL_H * 0.88, 12, 1, true);
      const shaftMat = new THREE.MeshBasicMaterial({
        color: 0x00ffaa, transparent: true, opacity: 0.045,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      const shaftInst = new THREE.InstancedMesh(shaftGeo, shaftMat, lightFixtureSpots.length);
      shaftInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      for (let i = 0; i < lightFixtureSpots.length; i++) {
        const sp = lightFixtureSpots[i];
        _dummy.position.set(sp.x, WALL_H - 0.09, sp.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        fixInst.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(sp.x, WALL_H * 0.52, sp.z);
        _dummy.scale.set(sp.isRunway ? 1.25 : 0.9, 1, sp.isRunway ? 1.25 : 0.9);
        _dummy.updateMatrix();
        shaftInst.setMatrixAt(i, _dummy.matrix);
      }
      fixInst.instanceMatrix.needsUpdate = true;
      shaftInst.instanceMatrix.needsUpdate = true;
      fixInst.matrixAutoUpdate = false;
      shaftInst.matrixAutoUpdate = false;
      fixInst.userData.structural = true;
      shaftInst.userData.structural = true;
      this.levelGroup.add(fixInst, shaftInst);
    }

    // Pressurized Coolant / Steam Vents in Rooms
    for (let i = 1; i < this.rooms.length; i += 2) {
      const rm = this.rooms[i];
      this.steamVents.push({
        pos: new THREE.Vector3(gridToWorldX(rm.x + 1), WALL_H - 0.3, gridToWorldZ(rm.z + 1)),
        timer: rng() * 2.5
      });
    }

    this.spawnPos.set(gridToWorldX(32), 2.3, gridToWorldZ(56));

    const candidateRooms = this.rooms.slice(2).sort((a, b) => {
      const da = Math.hypot(a.cx - 32, a.cz - 56);
      const db = Math.hypot(b.cx - 32, b.cz - 56);
      return db - da;
    });
    const targetNames = ['POWER TRANSFORMER', 'SECURITY MAINFRAME', 'BLAST DOOR GENERATOR', 'REACTOR CAPACITOR'];
    const targetCount = Math.min(12, tier);
    for (let i = 0; i < targetCount; i++) {
      const rm = candidateRooms[i % candidateRooms.length] || hubRoom;
      const ox = (i >= candidateRooms.length ? (rng() - 0.5) * 6 : 0);
      const oz = (i >= candidateRooms.length ? (rng() - 0.5) * 6 : 0);
      const tf = i % this.nFloors;
      if (tf > 0) {
        const up = this.pickFloorCell(tf, rng, i);
        this.spawnPrimaryTarget(gridToWorldX(up[0]), gridToWorldZ(up[1]), targetNames[i % targetNames.length], i, tf * WALL_H);
        continue;
      }
      const tx = gridToWorldX(rm.cx) + ox;
      const tz = gridToWorldZ(rm.cz) + oz;
      this.spawnPrimaryTarget(tx, tz, targetNames[i % targetNames.length], i);
    }

    const sentryCount = Math.min(this.maxSentries, Math.round((3 + tier * 2) * (this.modifier === 'HEAVY SECURITY' ? 1.5 : 1)));
    const patrolRooms = this.rooms.slice(1);
    for (let i = 0; i < sentryCount; i++) {
      const sf = i % this.nFloors;
      const fRooms = sf === 0 ? patrolRooms : this.liveRooms(sf);
      const rm = fRooms[Math.floor(i / this.nFloors) % fRooms.length];
      const sy = sf * WALL_H;
      const wps = [
        new THREE.Vector3(gridToWorldX(rm.x + 1), sy, gridToWorldZ(rm.z + 1)),
        new THREE.Vector3(gridToWorldX(rm.x + rm.w - 2), sy, gridToWorldZ(rm.z + 1)),
        new THREE.Vector3(gridToWorldX(rm.x + rm.w - 2), sy, gridToWorldZ(rm.z + rm.h - 2)),
        new THREE.Vector3(gridToWorldX(rm.x + 1), sy, gridToWorldZ(rm.z + rm.h - 2))
      ];
      const startIdx = Math.floor(rng() * wps.length);
      this.sentries.push({
        active: true,
        dying: false,
        deathTimer: 0,
        pos: wps[startIdx].clone(),
        vel: new THREE.Vector3(),
        rot: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        yaw: rng() * Math.PI * 2,
        waypoints: wps,
        floor: sf,
        wpIndex: (startIdx + 1) % wps.length,
        detectMeter: 0,
        alerted: false,
        alertTimer: 0,
        hearT: rng() * 0.2,
        decoyT: 0,
        decoyHeard: null,
        heardNow: false,
        heardLoud: 0,
        heardClose: false,
        invT: 0,
        invX: 0,
        invZ: 0,
        fireCooldown: 0.4,
        walkPhase: rng() * 6.28
      });
    }

    const barrelCount = Math.min(this.maxBarrels, 8 + tier * 2);
    for (let i = 0; i < barrelCount; i++) {
      const bf = i % this.nFloors;
      const bRooms = bf === 0 ? patrolRooms : this.liveRooms(bf);
      const rm = bRooms[Math.floor(rng() * bRooms.length)];
      let bgx = rm.x + 1 + Math.floor(rng() * Math.max(1, rm.w - 2));
      let bgz = rm.z + 1 + Math.floor(rng() * Math.max(1, rm.h - 2));
      if (!isWalkable(this.floors[bf][bgz * GRID_SIZE + bgx])) { bgx = rm.cx; bgz = rm.cz; }
      this.barrels.push({ active: true, pos: new THREE.Vector3(gridToWorldX(bgx), bf * WALL_H + 0.85, gridToWorldZ(bgz)) });
    }

    // gun: a full magazine each sector, and ammo crates spread over every floor
    this.gunAmmo = this.gunCap();
    {
      const ar = mulberry32((numericSeed ^ 0xA3301CE5) >>> 0);
      const crates = Math.min(12, 5 + Math.floor(tier / 3)) + 2 * (this.nFloors - 1);
      for (let i = 0; i < crates; i++) {
        const cf = i % this.nFloors;
        const cRooms = cf === 0 ? this.rooms.slice(1) : this.liveRooms(cf);
        for (let k = 0; k < 20; k++) {
          const rm = cRooms[Math.floor(ar() * cRooms.length)];
          const gx = rm.x + 1 + Math.floor(ar() * Math.max(1, rm.w - 2)), gz = rm.z + 1 + Math.floor(ar() * Math.max(1, rm.h - 2));
          if ((gx === rm.cx && gz === rm.cz) || !isWalkable(this.floors[cf][gz * GRID_SIZE + gx]) || this.liftCells.has(gz * GRID_SIZE + gx)) continue;
          this.spawnPickup(gridToWorldX(gx), gridToWorldZ(gz), 'AMMO', { active: false, crate: true }, cf * WALL_H + 1.6);
          break;
        }
      }
    }

    if (this.level >= 2) {
      const laserCount = Math.min(18, 1 + tier + (this.level >= 3 ? 1 : 0));
      const modesByTier = tier === 1
        ? ['SWEEPER_V', 'PULSE_GATE']
        : (tier === 2
          ? ['SWEEPER_V', 'PULSE_GATE', 'SWEEPER_H']
          : ['SWEEPER_V', 'PULSE_GATE', 'SWEEPER_H', 'TWIN_SWEEP']);

      for (let i = 0; i < laserCount; i++) {
        const rm = patrolRooms[(i + 1) % patrolRooms.length];
        const mode = modesByTier[(i + Math.floor(rng() * modesByTier.length)) % modesByTier.length];
        const laserSpeed = 1.15 + tier * 0.13 + rng() * 0.75;
        const phase = rng() * 6.28;

        const gz = Math.max(rm.z + 1, Math.min(rm.z + rm.h - 2, rm.cz + (i >= patrolRooms.length ? (rng() < 0.5 ? -1 : 1) : 0)));
        let gxLeft = rm.cx;
        while (gxLeft > 1 && isWalkable(this.grid[gz * GRID_SIZE + (gxLeft - 1)])) gxLeft--;
        let gxRight = rm.cx;
        while (gxRight < GRID_SIZE - 2 && isWalkable(this.grid[gz * GRID_SIZE + (gxRight + 1)])) gxRight++;

        const xMin = gridToWorldX(gxLeft) - CELL_SIZE * 0.48;
        const xMax = gridToWorldX(gxRight) + CELL_SIZE * 0.48;
        const lz = gridToWorldZ(gz);
        const relaySide = mulberry32((numericSeed + Math.imul(i + 1, 7919)) >>> 0)() < 0.5 ? 'L' : 'R';
        this.spawnLaserGrid(xMin, xMax, lz, mode, phase, laserSpeed, relaySide);
      }
    }

    if (tier >= 2) {
      const turbCount = Math.min(10, 1 + Math.floor(tier * 0.65));
      for (let i = 0; i < turbCount; i++) {
        const rm = patrolRooms[(i + 2) % patrolRooms.length];
        const rotSpd = 2.0 + tier * 0.22 + rng() * 1.4;
        this.spawnTurbine(gridToWorldX(rm.cx), 3.4, gridToWorldZ(rm.z + 1), rotSpd);
      }
    }

    if (tier >= 3) {
      const grateCount = Math.min(12, 2 + Math.floor(tier * 0.6));
      for (let i = 0; i < grateCount; i++) {
        const rm = patrolRooms[(i + 2) % patrolRooms.length];
        this.spawnDestructibleGrate(gridToWorldX(rm.cx), 2.6, gridToWorldZ(rm.z));
      }
    }

    // CIWS turrets hang from the ceiling over every atrium: they cover both floors of the hall
    for (const at of (tier >= 5 ? this.atriums.slice(0, tier >= 7 ? 9 : 1) : [])) {
      const cxg = at.x0 + Math.floor(at.w / 2), czg = at.z0 + Math.floor(at.h / 2);
      const top = this.ceilAt(at.f, czg * GRID_SIZE + cxg);
      this.spawnTurret(gridToWorldX(cxg), top - 1.15, gridToWorldZ(czg));
    }
    const hazardRooms = this.rooms.slice(2);
    if (hazardRooms.length > 0) {
      if (tier >= 4) {
        const ecmCount = Math.min(6, Math.floor(tier / 3));
        for (let i = 0; i < ecmCount; i++) {
          const rm = hazardRooms[(i * 2 + 1) % hazardRooms.length];
          this.spawnEcmZone(gridToWorldX(rm.cx), gridToWorldZ(rm.cz), 7.5 + rng() * 2.5);
        }
      }
      if (tier >= 6) {
        const turretCount = Math.min(8, Math.floor((tier - 2) / 2));
        for (let i = 0; i < turretCount; i++) {
          const rm = hazardRooms[(i * 3 + 2) % hazardRooms.length];
          const cx = (i % 2 === 0) ? rm.x + 1 : rm.x + rm.w - 2;
          const cz = (i % 4 < 2) ? rm.z + 1 : rm.z + rm.h - 2;
          this.spawnTurret(gridToWorldX(cx), WALL_H - 1.15, gridToWorldZ(cz));
        }
      }
      if (tier >= 7) {
        const bulkCount = Math.min(8, Math.floor((tier - 3) / 2));
        for (let i = 0; i < bulkCount; i++) {
          const rm = hazardRooms[(i * 2 + 3) % hazardRooms.length];
          this.spawnBulkhead(gridToWorldX(rm.cx), gridToWorldZ(rm.z + rm.h - 2), rng() * 6.28);
        }
      }
    }

    this.alertsTriggered = 0;
    this.sentriesNeutralized = 0;
    this.missionTime = 0;
    this.fired = 0;
    this.resetRewards();
    // sector modifier visuals
    const bo = this.modifier === 'BLACKOUT';
    this.lights.amb.intensity = 0.65 * (bo ? 0.3 : 1);
    this.lights.hemi.intensity = 1.55 * (bo ? 0.26 : 1);
    this.lights.dir.intensity = 1.15 * (bo ? 0.3 : 1);
    this.scene.fog.density = 0;
    this.headlamp.intensity = bo ? 9.0 : 5.0;
    this.syncSentryInstances();
    this.syncBarrelInstances();
    this.applyLidarLook();
    let open = 0;
    const GG = GRID_SIZE * GRID_SIZE;
    for (let i = 0; i < GG * this.nFloors; i++) if (this.cellCountsOpen(i)) open++;
    this.totalOpen = Math.max(1, open);
    this.lidarBegin(`${LIDAR_KEY_PREFIX}${this.level}:${this.seedStr}`);
    this.seenOpen = 0;
    for (let i = 0; i < GG * this.nFloors; i++) if (this.seenCells[i] && this.cellCountsOpen(i)) this.seenOpen++;
    if (this.nFloors > 1) this.pushFeed(`MULTI-LEVEL SECTOR: ${this.nFloors} FLOORS — RAMPS${this.lifts.length ? ', A LIFT' : ''} AND OPEN HALLS`, 'cyan');
    this.updateHUDText();
  },

  spawnPrimaryTarget(x, z, name, idx, yBase = 0) {
    const grp = new THREE.Group();
    grp.position.set(x, yBase, z);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 3.2, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x22333b, metalness: 0.7, roughness: 0.3 })
    );
    base.position.y = 1.6;
    grp.add(base);

    const hazardTrim = new THREE.Mesh(
      new THREE.BoxGeometry(2.74, 0.32, 2.74),
      this.hazardMat
    );
    hazardTrim.position.y = 0.25;
    grp.add(hazardTrim);

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: false })
    );
    core.position.y = 3.9;
    grp.add(core);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.1, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    ring.position.y = 3.9;
    ring.rotation.x = Math.PI * 0.5;
    grp.add(ring);

    const beaconBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 1.35, WALL_H - 0.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffaa00, transparent: true, opacity: 0.11,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    beaconBeam.position.y = (WALL_H - 0.2) * 0.5;
    grp.add(beaconBeam);

    const floorRing = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.45, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffaa00, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    floorRing.rotation.x = -Math.PI * 0.5;
    floorRing.position.y = 0.04;
    grp.add(floorRing);

    grp.userData.heat = 0.9;
    this.levelGroup.add(grp);
    this.targets.push({
      id: idx + 1, name, active: true,
      pos: new THREE.Vector3(x, yBase + 2.5, z),
      radius: 2.1, mesh: grp, core, ring, floorRing
    });
  },

  spawnLaserGrid(xMin, xMax, z, mode, phase, speed, relaySide = 'L') {
    const relayX = relaySide === 'R' ? xMax - 0.34 : xMin + 0.34;
    const spanX = Math.max(2.0, xMax - xMin);
    const midX = (xMin + xMax) * 0.5;

    const emitterMat = new THREE.MeshStandardMaterial({ color: 0x222e34, metalness: 0.78, roughness: 0.28 });
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xff1133 });

    const makeEmitter = (x, y, rotZ = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.z = rotZ;
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.54), emitterMat);
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.60, 0.60), this.hazardMat);
      collar.position.x = 0.16;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 10), lensMat);
      lens.rotation.z = Math.PI * 0.5;
      lens.position.x = 0.24;
      g.add(housing, collar, lens);
      g.userData.heat = 0.55;
      this.levelGroup.add(g);
      return g;
    };

    const makeBeamPair = (length, isVertical = false) => {
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffdddd, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false
      });
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff4411, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8, depthWrite: false
      });
      const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, length, 6), coreMat);
      const glowMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, length, 8), glowMat);
      if (!isVertical) {
        coreMesh.rotation.z = Math.PI * 0.5;
        glowMesh.rotation.z = Math.PI * 0.5;
      }
      this.levelGroup.add(coreMesh, glowMesh);
      return { coreMesh, glowMesh, coreMat, glowMat };
    };

    const relayGroup = new THREE.Group();
    relayGroup.position.set(relayX, 2.75, z + 0.68);
    const relayBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.88, 0.52),
      new THREE.MeshStandardMaterial({ color: 0x2b363c, metalness: 0.72, roughness: 0.3 })
    );
    const relayCoreMat = new THREE.MeshBasicMaterial({ color: 0xff5522 });
    const relayCore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.52, 0.26), relayCoreMat);
    relayCore.position.x = relaySide === 'R' ? -0.22 : 0.22;
    relayGroup.add(relayBody, relayCore);
    relayGroup.userData.heat = 0.72;
    this.levelGroup.add(relayGroup);

    const beams = [];
    const emitters = [];

    if (mode === 'SWEEPER_H') {
      const hLen = WALL_H - 0.3;
      const b = makeBeamPair(hLen, true);
      b.coreMesh.position.set(midX, WALL_H * 0.5, z);
      b.glowMesh.position.set(midX, WALL_H * 0.5, z);
      beams.push({
        x1: midX, y1: 0.15, z1: z,
        x2: midX, y2: WALL_H - 0.15, z2: z,
        ...b
      });
      emitters.push(makeEmitter(midX, 0.24, Math.PI * 0.5));
      emitters.push(makeEmitter(midX, WALL_H - 0.24, -Math.PI * 0.5));
    } else if (mode === 'TWIN_SWEEP') {
      for (let k = 0; k < 2; k++) {
        const startY = k === 0 ? 2.1 : 5.1;
        const b = makeBeamPair(spanX, false);
        b.coreMesh.position.set(midX, startY, z);
        b.glowMesh.position.set(midX, startY, z);
        beams.push({
          x1: xMin, y1: startY, z1: z,
          x2: xMax, y2: startY, z2: z,
          offsetPhase: k * Math.PI,
          ...b
        });
        emitters.push(makeEmitter(xMin + 0.18, startY, 0));
        emitters.push(makeEmitter(xMax - 0.18, startY, Math.PI));
      }
    } else if (mode === 'PULSE_GATE') {
      const heights = [1.55, 3.55, 5.55];
      for (let k = 0; k < heights.length; k++) {
        const hy = heights[k];
        const b = makeBeamPair(spanX, false);
        b.coreMesh.position.set(midX, hy, z);
        b.glowMesh.position.set(midX, hy, z);
        beams.push({
          x1: xMin, y1: hy, z1: z,
          x2: xMax, y2: hy, z2: z,
          ...b
        });
      }
      emitters.push(makeEmitter(xMin + 0.18, 3.55, 0));
      emitters.push(makeEmitter(xMax - 0.18, 3.55, Math.PI));
    } else {
      const b = makeBeamPair(spanX, false);
      b.coreMesh.position.set(midX, 3.5, z);
      b.glowMesh.position.set(midX, 3.5, z);
      beams.push({
        x1: xMin, y1: 3.5, z1: z,
        x2: xMax, y2: 3.5, z2: z,
        ...b
      });
      emitters.push(makeEmitter(xMin + 0.18, 3.5, 0));
      emitters.push(makeEmitter(xMax - 0.18, 3.5, Math.PI));
    }

    this.lasers.push({
      xMin, xMax, midX, z,
      mode,
      phase,
      speed,
      state: 'ACTIVE',
      disabled: false,
      relayActive: true,
      relaySide,
      relayPos: new THREE.Vector3(relayX, 2.75, z + 0.68),
      relayGroup,
      relayCoreMat,
      lensMat,
      emitters,
      beams
    });
    const L = this.lasers[this.lasers.length - 1];
    L.lockRef = { pos: L.relayPos, get active() { return L.relayActive && !L.disabled; } };
  },

  /* ------------------------------------------------------------------------
     DESTROYABLE WALLS: SHORTCUTS + SECRET CHAMBERS WITH POWER-UPS
     ------------------------------------------------------------------------ */

  /* ------------------------------------------------------------------------
     MULTI-FLOOR SECTORS: upper floors, ramps, and 3D solidity helpers.
     Floor f spans y = f*WALL_H .. (f+1)*WALL_H. Slabs between floors are open only above a ramp (CELL_VOID).
     ------------------------------------------------------------------------ */
  buildFloors(numericSeed, tier) {
    const G = GRID_SIZE;
    this.nFloors = tier >= 7 ? 3 : (tier >= 4 ? 2 : 1);
    this.floors = [this.grid];
    this.floorRooms = [this.rooms];
    this.ramps = [];
    this.rampAt = new Map();
    this.rampProtect = new Set();
    for (let f = 1; f < this.nFloors; f++) {
      const g = new Uint8Array(G * G).fill(CELL_WALL);
      this.floors.push(g);
      this.floorRooms.push(this.genUpperFloor(g, mulberry32((numericSeed ^ Math.imul(0x3D7A11B5, f)) >>> 0), tier));
    }
    for (let f = 0; f + 1 < this.nFloors; f++) {
      const rr = mulberry32((numericSeed ^ Math.imul(0x51ED27, f + 1)) >>> 0);
      for (let k = 0; k < 2; k++) this.placeRamp(f, rr);
    }
    this.lifts = [];
    this.liftCells = new Set();
    this.extraNeed = [];
    this.atriums = [];
    if (this.nFloors > 1) {
      const ro = mulberry32((numericSeed ^ 0x0A7B1E55) >>> 0);
      for (let f = 1; f < this.nFloors; f++) {
        this.placeAtrium(f, ro);
        const holes = 2 + Math.floor(ro() * 2);
        for (let k = 0; k < holes; k++) this.placeHole(f, ro);
      }
      this.placeLift(ro);
    }
    for (let f = 0; f < this.nFloors; f++) this.repairFloor(f);
  },

  genUpperFloor(g, rng, tier) {
    const G = GRID_SIZE, rooms = [];
    const carve = (x0, z0, w, h) => {
      for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) if (x > 1 && x < G - 2 && z > 1 && z < G - 2) g[z * G + x] = CELL_FLOOR;
    };
    const want = Math.min(14, 6 + Math.floor(tier * 0.35) + Math.floor(rng() * 3));
    for (let a = 0; a < 260 && rooms.length < want; a++) {
      const w = 5 + Math.floor(rng() * 6), h = 5 + Math.floor(rng() * 6);
      const x = 3 + Math.floor(rng() * (G - w - 6)), z = 3 + Math.floor(rng() * (G - h - 6));
      if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && z < r.z + r.h + 2 && z + h + 2 > r.z)) continue;
      const rm = { x, z, w, h, cx: Math.floor(x + w * 0.5), cz: Math.floor(z + h * 0.5) };
      rooms.push(rm);
      carve(x, z, w, h);
    }
    const corridor = (x1, z1, x2, z2, width) => {
      const lo = -Math.floor((width - 1) / 2), hi = Math.floor(width / 2);
      for (let x = x1; x !== x2; x += (x2 >= x1 ? 1 : -1)) for (let o = lo; o <= hi; o++) carve(x, z1 + o, 1, 1);
      for (let z = z1; z !== z2 + (z2 >= z1 ? 1 : -1); z += (z2 >= z1 ? 1 : -1)) for (let o = lo; o <= hi; o++) carve(x2 + o, z, 1, 1);
    };
    for (let i = 1; i < rooms.length; i++) {
      let best = rooms[0], bd = 1e9;
      for (let j = 0; j < i; j++) { const d = Math.hypot(rooms[i].cx - rooms[j].cx, rooms[i].cz - rooms[j].cz); if (d < bd) { bd = d; best = rooms[j]; } }
      corridor(rooms[i].cx, rooms[i].cz, best.cx, best.cz, tier >= 12 ? 2 : 3);
      if (i > 2 && rng() < 0.3) { const alt = rooms[Math.floor(rng() * i)]; corridor(rooms[i].cx, rooms[i].cz, alt.cx, alt.cz, 2); }
    }
    return rooms;
  },

  // A ramp: entrance cell (floor f) -> RAMP_LEN ramp cells -> exit cell on floor f+1. It runs in its own 1-cell tube.
  placeRamp(f, rng) {
    const G = GRID_SIZE, GG = G * G, lo = this.floors[f], up = this.floors[f + 1];
    const at = (g, x, z) => (x < 0 || z < 0 || x >= G || z >= G) ? -1 : g[z * G + x];
    const prot = (fl, x, z) => this.rampProtect.has(fl * GG + z * G + x);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = null, bestS = 1e9;
    for (let tries = 0; tries < 2500; tries++) {
      const ex = 3 + Math.floor(rng() * (G - 6)), ez = 3 + Math.floor(rng() * (G - 6));
      if (lo[ez * G + ex] !== CELL_FLOOR || prot(f, ex, ez)) continue;
      if (f === 0 && (ez > 44 || this.secretHidden.has(ez * G + ex))) continue;
      const [dx, dz] = dirs[Math.floor(rng() * 4)];
      const px = -dz, pz = dx;
      let score = 0, ok = true;
      for (let i = 0; i <= RAMP_LEN + 3 && ok; i++) {
        const cx = ex + dx * i, cz = ez + dz * i;
        if (cx < 3 || cz < 3 || cx > G - 4 || cz > G - 4) { ok = false; break; }
        if (i > RAMP_LEN + 1) {   // a straight run-out on the upper floor past the exit
          const u = at(up, cx, cz);
          if (prot(f + 1, cx, cz) || u === CELL_VOID || u === CELL_RAMP) ok = false;
          continue;
        }
        const tube = i >= 1 && i <= RAMP_LEN;
        const cells = tube ? [[cx, cz], [cx + px, cz + pz], [cx - px, cz - pz]] : [[cx, cz]];
        for (const [x, z] of cells) {
          if (i >= 1) {   // lower floor: the tube should be cut into rock
            const v = at(lo, x, z);
            if (prot(f, x, z) || (f === 0 && this.secretHidden.has(z * G + x)) || (v !== CELL_WALL && v !== CELL_FLOOR)) { ok = false; break; }
            if (v === CELL_FLOOR) score += 3;
          }
          const u = at(up, x, z);  // upper floor: void + walls over the tube, wall over the entrance, open exit
          if (prot(f + 1, x, z) || u === CELL_VOID || u === CELL_RAMP) { ok = false; break; }
          if (i <= RAMP_LEN && u !== CELL_WALL) score += 1;
        }
      }
      if (!ok) continue;
      for (const r of this.ramps) if (r.f === f && Math.hypot(r.ex - ex, r.ez - ez) < 16) score += 8;
      if (score < bestS) { bestS = score; best = { ex, ez, dx, dz, px, pz }; if (score === 0) break; }
    }
    if (!best) return;
    const { ex, ez, dx, dz, px, pz } = best, id = this.ramps.length;
    const P = (fl, x, z) => this.rampProtect.add(fl * GG + z * G + x);
    for (let i = 1; i <= RAMP_LEN; i++) {
      const cx = ex + dx * i, cz = ez + dz * i;
      lo[cz * G + cx] = CELL_RAMP; up[cz * G + cx] = CELL_VOID;
      this.rampAt.set(f * GG + cz * G + cx, id);
      P(f, cx, cz); P(f + 1, cx, cz);
      for (const sd of [1, -1]) {
        const sx = cx + px * sd, sz = cz + pz * sd;
        lo[sz * G + sx] = CELL_WALL; up[sz * G + sx] = CELL_WALL;
        P(f, sx, sz); P(f + 1, sx, sz);
      }
    }
    const nx = ex + dx * (RAMP_LEN + 1), nz = ez + dz * (RAMP_LEN + 1);
    lo[nz * G + nx] = CELL_WALL; P(f, nx, nz);
    up[ez * G + ex] = CELL_WALL; P(f + 1, ex, ez); P(f, ex, ez);
    up[nz * G + nx] = CELL_FLOOR; P(f + 1, nx, nz);
    for (let i = 1; i <= 2; i++) { const rx = nx + dx * i, rz = nz + dz * i; up[rz * G + rx] = CELL_FLOOR; P(f + 1, rx, rz); }
    this.ramps.push({ id, f, ex, ez, dx, dz, px, pz, nx, nz,
      sx: gridToWorldX(ex) + dx * CELL_SIZE * 0.5, sz: gridToWorldZ(ez) + dz * CELL_SIZE * 0.5, len: RAMP_LEN * CELL_SIZE });
  },

  // Make sure every room and ramp mouth on a floor can be reached; carve 1-cell connectors where a ramp cut a path.
  repairFloor(f) {
    const G = GRID_SIZE, GG = G * G, g = this.floors[f];
    // walking connectivity (sentries cannot cross openings); the rocket can always fly where they walk
    const pass = (v) => isWalkable(v) || (f === 0 && (v === CELL_CRACKED || isShaft(v)));
    const flood = () => {
      const seen = new Uint8Array(GG), st = [];
      const add = (x, z) => { const c = z * G + x; if (!seen[c] && pass(g[c])) { seen[c] = 1; st.push(c); } };
      if (f === 0) add(32, 56);
      for (const r of this.ramps) if (r.f === f - 1) add(r.nx, r.nz);
      while (st.length) {
        const c = st.pop(), x = c % G, z = (c / G) | 0;
        if (x > 0) add(x - 1, z); if (x < G - 1) add(x + 1, z); if (z > 0) add(x, z - 1); if (z < G - 1) add(x, z + 1);
      }
      return seen;
    };
    const need = [];
    for (const rm of this.floorRooms[f] || []) need.push([rm.cx, rm.cz]);
    for (const r of this.ramps) if (r.f === f) need.push([r.ex, r.ez]);
    for (const e of this.extraNeed || []) if (e[2] === f) need.push([e[0], e[1]]);
    for (let pass2 = 0; pass2 < need.length; pass2++) {
      const seen = flood();
      const miss = need.find(([x, z]) => isWalkable(g[z * G + x]) && !seen[z * G + x] && !(f === 0 && this.secretHidden.has(z * G + x)));
      if (!miss) return;
      // Dijkstra from the unreached cell to the reached area; carving rock costs more, turns cost a little
      const dist = new Float32Array(GG * 4).fill(1e9), prev = new Int32Array(GG * 4).fill(-1);
      const q = [];
      const s0 = miss[1] * G + miss[0];
      for (let d = 0; d < 4; d++) { dist[s0 * 4 + d] = 0; q.push([0, s0 * 4 + d]); }
      const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let goal = -1;
      while (q.length) {
        let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
        const [cd, st] = q[bi]; q[bi] = q[q.length - 1]; q.pop();
        if (cd > dist[st]) continue;
        const c = st >> 2, dir = st & 3;
        if (seen[c]) { goal = st; break; }
        const x = c % G, z = (c / G) | 0;
        for (let nd = 0; nd < 4; nd++) {
          const nx = x + D[nd][0], nz = z + D[nd][1];
          if (nx < 2 || nz < 2 || nx > G - 3 || nz > G - 3) continue;
          const n = nz * G + nx, v = g[n];
          if (this.rampProtect.has(f * GG + n) && !seen[n]) continue;
          if (v === CELL_VOID || v === CELL_RAMP) continue;
          const nc = cd + (pass(v) ? 1 : 3) + (nd !== dir ? 2 : 0), ns = n * 4 + nd;
          if (nc < dist[ns]) { dist[ns] = nc; prev[ns] = st; q.push([nc, ns]); }
        }
      }
      if (goal < 0) return;
      for (let st = goal; st >= 0; st = prev[st]) { const c = st >> 2; if (g[c] === CELL_WALL) g[c] = CELL_FLOOR; }
    }
  },


  // Can cell (x, z) on floor f become an opening (no slab) over open floor below?
  openable(f, x, z) {
    const G = GRID_SIZE, GG = G * G, c = z * G + x;
    if (x < 3 || z < 3 || x > G - 4 || z > G - 4) return false;
    if (this.rampProtect.has(f * GG + c) || this.rampProtect.has((f - 1) * GG + c)) return false;
    const below = this.floors[f - 1][c], here = this.floors[f][c];
    if (!isWalkable(below) || here === CELL_VOID || here === CELL_RAMP) return false;
    if (f - 1 === 0 && (this.secretHidden.has(c) || below === CELL_RUNWAY || z > 50)) return false;
    return true;
  },

  // Atrium: a room-sized opening over a room below, making one double-height hall.
  placeAtrium(f, rng) {
    const G = GRID_SIZE, below = this.floorRooms[f - 1] || [];
    const cand = below.filter((r) => !r.isSpawn && r.w >= 5 && r.h >= 5);
    for (let tries = 0; tries < 12 && cand.length; tries++) {
      const rm = cand[Math.floor(rng() * cand.length)];
      const w = Math.min(rm.w - 2, 3 + Math.floor(rng() * 3)), h = Math.min(rm.h - 2, 3 + Math.floor(rng() * 3));
      const x0 = rm.x + 1 + Math.floor(rng() * (rm.w - 1 - w)), z0 = rm.z + 1 + Math.floor(rng() * (rm.h - 1 - h));
      let ok = true;
      for (let z = z0; z < z0 + h && ok; z++) for (let x = x0; x < x0 + w && ok; x++) if (!this.openable(f, x, z)) ok = false;
      if (!ok) continue;
      let walk = 0;
      for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) { if (isWalkable(this.floors[f][z * G + x])) walk++; this.floors[f][z * G + x] = CELL_VOID; }
      this.atriums.push({ f, x0, z0, w, h });
      // keep a gallery: if the hall cut through rooms up here, the repair pass reconnects around it
      this.atrium = this.atrium || [];
      return;
    }
  },

  // Drop hole: a 1x1 or 1x2 opening in an upper floor over open floor below.
  placeHole(f, rng) {
    const G = GRID_SIZE, g = this.floors[f];
    for (let tries = 0; tries < 400; tries++) {
      const x = 3 + Math.floor(rng() * (G - 6)), z = 3 + Math.floor(rng() * (G - 6));
      if (!isWalkable(g[z * G + x]) || !this.openable(f, x, z)) continue;
      const long = rng() < 0.5, ax = rng() < 0.5;
      const x2 = x + (long && ax ? 1 : 0), z2 = z + (long && !ax ? 1 : 0);
      if (!isWalkable(g[z2 * G + x2]) || !this.openable(f, x2, z2)) continue;
      // keep holes off the immediate mouth of ramps and away from other openings
      let near = false;
      for (let dz = -2; dz <= 2 && !near; dz++) for (let dx = -2; dx <= 2 && !near; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nz >= 0 && nx < G && nz < G && (g[nz * G + nx] === CELL_VOID || this.rampProtect.has(f * G * G + nz * G + nx))) near = true;
      }
      if (near) continue;
      g[z * G + x] = CELL_VOID; g[z2 * G + x2] = CELL_VOID;
      return;
    }
  },

  // Lift: a 2x2 shaft open through every floor. Inside it the rocket is carried up (nose level or up) or down (nose down).
  placeLift(rng) {
    const G = GRID_SIZE, GG = G * G, NF = this.nFloors;
    const rooms = (this.floorRooms[0] || []).filter((r) => !r.isSpawn && r.w >= 5 && r.h >= 5);
    for (let tries = 0; tries < 60 && rooms.length; tries++) {
      const rm = rooms[Math.floor(rng() * rooms.length)];
      const x0 = rm.x + 1 + Math.floor(rng() * (rm.w - 3)), z0 = rm.z + 1 + Math.floor(rng() * (rm.h - 3));
      const cells = [[x0, z0], [x0 + 1, z0], [x0, z0 + 1], [x0 + 1, z0 + 1]];
      let ok = cells.every(([x, z]) => isWalkable(this.floors[0][z * G + x]) && !this.rampProtect.has(z * G + x) && !this.secretHidden.has(z * G + x) && z <= 50);
      for (let f = 1; f < NF && ok; f++) {
        for (const [x, z] of cells) {
          const v = this.floors[f][z * G + x];
          if (v === CELL_VOID || v === CELL_RAMP || this.rampProtect.has(f * GG + z * G + x)) ok = false;
        }
        // needs a wall-free ring cell to step out at this floor
        for (let dz = -1; dz <= 2 && ok; dz++) for (let dx = -1; dx <= 2; dx++) {
          const v = this.floors[f][(z0 + dz) * G + x0 + dx];
          if (v === CELL_VOID && !(dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1)) ok = false;
        }
      }
      if (!ok) continue;
      for (let f = 1; f < NF; f++) {
        for (const [x, z] of cells) { this.floors[f][z * G + x] = CELL_VOID; this.rampProtect.add(f * GG + z * G + x); }
        // open one landing cell next to the shaft on every upper floor and make sure it joins that floor
        const sides = [[x0 - 1, z0], [x0 + 2, z0 + 1], [x0, z0 - 1], [x0 + 1, z0 + 2]];
        let land = sides.find(([x, z]) => isWalkable(this.floors[f][z * G + x]));
        if (!land) { land = sides[Math.floor(rng() * 4)]; this.floors[f][land[1] * G + land[0]] = CELL_FLOOR; }
        this.extraNeed.push([land[0], land[1], f]);
      }
      for (const [x, z] of cells) { this.liftCells.add(z * G + x); this.rampProtect.add(z * G + x); }
      this.lifts.push({ x0, z0, cx: gridToWorldX(x0) + CELL_SIZE * 0.5, cz: gridToWorldZ(z0) + CELL_SIZE * 0.5 });
      return;
    }
  },

  // Rim of an opening: the edge between void cell c (floor F) and its neighbour on one side, where the slab ends.
  rimSeg(F, c, side) { return RIM_BASE + (F * GRID_SIZE * GRID_SIZE + c) * 4 + side; },

  validRim(seg) {
    const G = GRID_SIZE, GG = G * G, i = (seg - RIM_BASE) >> 2, side = (seg - RIM_BASE) & 3;
    const F = (i / GG) | 0, c = i % GG;
    if (F < 1 || F >= this.nFloors || this.floors[F][c] !== CELL_VOID) return false;
    const x = c % G, z = (c / G) | 0;
    const nx = x + (side === 0 ? -1 : side === 1 ? 1 : 0), nz = z + (side === 2 ? -1 : side === 3 ? 1 : 0);
    if (nx < 0 || nz < 0 || nx >= G || nz >= G) return false;
    const m = nz * G + nx;
    if (this.floors[F][m] === CELL_VOID) return false;
    return !(isWallLike(this.floors[F - 1][m]) && isWallLike(this.floors[F][m]));
  },

  addRimSeg(seg, birth) {
    const G = GRID_SIZE, GG = G * G, i = (seg - RIM_BASE) >> 2, side = (seg - RIM_BASE) & 3;
    const F = (i / GG) | 0, c = i % GG, gx = c % G, gz = (c / G) | 0;
    const x0 = (gx - G * 0.5) * CELL_SIZE, z0 = (gz - G * 0.5) * CELL_SIZE, y = F * WALL_H + 0.03;
    const A = [0, y, 0], B = [0, y, 0];
    if (side < 2) { const x = side === 0 ? x0 : x0 + CELL_SIZE; A[0] = B[0] = x; A[2] = z0; B[2] = z0 + CELL_SIZE; }
    else { const z = side === 2 ? z0 : z0 + CELL_SIZE; A[2] = B[2] = z; A[0] = x0; B[0] = x0 + CELL_SIZE; }
    this.pushSeg(seg, A, B, birth, 0);
  },

  // Lift beams: four vertical lines at the shaft's corners, top to bottom.
  addLiftSeg(seg, birth) {
    const id = (seg - LIFT_BASE) >> 2, k = (seg - LIFT_BASE) & 3, L = this.lifts[id];
    if (!L) return;
    const x = L.cx + (k & 1 ? 1 : -1) * (CELL_SIZE - 0.05), z = L.cz + (k & 2 ? 1 : -1) * (CELL_SIZE - 0.05);
    this.pushSeg(seg, [x, 0.03, z], [x, this.nFloors * WALL_H - 0.03, z], birth, 1);
  },

  pushSeg(seg, A, B, birth, kind) {
    const i = this.segCount++;
    this.segA.set(A, i * 3); this.segB.set(B, i * 3); this.segBirth[i] = birth; this.segKind[i] = kind;
    this.segSlot.set(seg, i);
    if (this.segDirtyMin < 0 || i < this.segDirtyMin) this.segDirtyMin = i;
    if (i > this.segDirtyMax) this.segDirtyMax = i;
  },

  // A slab hit near the edge of an opening reveals that rim.
  rimNear(h, gx, gz, F) {
    if (F < 1 || F >= this.nFloors) return -1;
    const G = GRID_SIZE, E = 0.45, g = this.floors[F];
    const lx = h.x - (gx - G * 0.5) * CELL_SIZE, lz = h.z - (gz - G * 0.5) * CELL_SIZE;
    if (g[gz * G + gx] === CELL_VOID) return -1;
    if (lx < E && gx > 0 && g[gz * G + gx - 1] === CELL_VOID) return this.rimSeg(F, gz * G + gx - 1, 1);
    if (lx > CELL_SIZE - E && gx < G - 1 && g[gz * G + gx + 1] === CELL_VOID) return this.rimSeg(F, gz * G + gx + 1, 0);
    if (lz < E && gz > 0 && g[(gz - 1) * G + gx] === CELL_VOID) return this.rimSeg(F, (gz - 1) * G + gx, 3);
    if (lz > CELL_SIZE - E && gz < G - 1 && g[(gz + 1) * G + gx] === CELL_VOID) return this.rimSeg(F, (gz + 1) * G + gx, 2);
    return -1;
  },

  revealLifts(o, P) {
    for (let i = 0; i < this.lifts.length; i++) {
      const L = this.lifts[i];
      if (this.revealedSeg.has(LIFT_BASE + i * 4)) continue;
      const d = Math.hypot(L.cx - o.x, L.cz - o.z);
      if (d > P.range) continue;
      const y = Math.max(0.5, Math.min(this.nFloors * WALL_H - 0.5, o.y));
      if (!this.los3(o.x, o.y, o.z, L.cx, y, L.cz)) continue;
      for (let k = 0; k < 4; k++) this.revealSeg(LIFT_BASE + i * 4 + k, this.lidarTime);
    }
  },

  liveRooms(f) {
    const G = GRID_SIZE, g = this.floors[f];
    const rs = (this.floorRooms[f] || []).filter((r) => isWalkable(g[r.cz * G + r.cx]));
    return rs.length ? rs : [{ x: 30, z: 30, w: 4, h: 4, cx: 32, cz: 32 }];
  },

  pickFloorCell(f, rng, i) {
    const G = GRID_SIZE, g = this.floors[f], rs = this.liveRooms(f);
    const sorted = rs.slice().sort((a, b) => Math.hypot(b.cx - 32, b.cz - 56) - Math.hypot(a.cx - 32, a.cz - 56));
    const rm = sorted[Math.floor(i / this.nFloors) % sorted.length];
    if (isWalkable(g[rm.cz * G + rm.cx])) return [rm.cx, rm.cz];
    for (let k = 0; k < 40; k++) {
      const x = rm.x + Math.floor(rng() * rm.w), z = rm.z + Math.floor(rng() * rm.h);
      if (isWalkable(g[z * G + x])) return [x, z];
    }
    return [rm.cx, rm.cz];
  },

  cellCountsOpen(i) {
    const GG = GRID_SIZE * GRID_SIZE, f = (i / GG) | 0, c = i % GG;
    if (f >= this.nFloors) return false;
    const v = this.floors[f][c];
    return !isWallLike(v) && v !== CELL_VOID && (f > 0 || !this.secretHidden.has(c));
  },

  floorOfY(y) {
    const f = Math.floor(y / WALL_H);
    return f < 0 ? 0 : (f >= this.nFloors ? this.nFloors - 1 : f);
  },

  cellAt(x, z) {
    const gx = worldToGridX(x), gz = worldToGridZ(z);
    return (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) ? -1 : gz * GRID_SIZE + gx;
  },

  rampHeight(r, x, z) {
    let u = ((x - r.sx) * r.dx + (z - r.sz) * r.dz) / r.len;
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    return (r.f + u) * WALL_H;
  },

  // Height of the surface under (x, z) seen from floor f (a void falls through to the ramp below). Sets _gRamp.
  groundAt(f, c, x, z) {
    this._gRamp = null;
    for (let k = f; k >= 0; k--) {
      const v = this.floors[k][c];
      if (v === CELL_RAMP) { this._gRamp = this.ramps[this.rampAt.get(k * GRID_SIZE * GRID_SIZE + c)]; return this.rampHeight(this._gRamp, x, z); }
      if (v !== CELL_VOID || k === 0) return k * WALL_H;
    }
    return 0;
  },

  ceilAt(f, c) {
    let k = f;
    while (k + 1 < this.nFloors && this.floors[k + 1][c] === CELL_VOID) k++;
    return (k + 1) * WALL_H;
  },

  // Floor and roof under/over (x, z) for a rocket at height y. Inside a shaft's opening they are the shaft's own
  // slab and lintel; elsewhere the facility floor/ceiling. Sets this._sf (floor y), this._sc (roof y), this._gRamp.
  localSurf(x, y, z) {
    const c = this.cellAt(x, z);
    this._gRamp = null; this._sf = 0; this._sc = WALL_H;
    if (c < 0) return;
    const f = this.floorOfY(y);
    if (f === 0) {
      const v = this.grid[c];
      if (isShaft(v)) {
        const lo = (v - CELL_SHAFT_LOW) * WALL_H / 3, hi = lo + WALL_H / 3;
        if (y >= lo && y <= hi) { this._sf = lo; this._sc = hi; return; }   // inside the opening: it is a flat tunnel
      }
    }
    this._sf = this.groundAt(f, c, x, z);
    this._sc = this.ceilAt(f, c);
  },

  placeBreakables(numericSeed, tier) {
    const rngW = mulberry32((numericSeed ^ 0x9E3779B1) >>> 0);   // own stream: leaves the rest of the level untouched
    const G = GRID_SIZE;
    const at = (x, z) => this.grid[z * G + x];
    const open = (x, z) => x >= 0 && z >= 0 && x < G && z < G && !isWallLike(at(x, z));
    const sp = this.rooms[0];
    const nearSpawn = (x, z) => x >= sp.x - 2 && x < sp.x + sp.w + 2 && z >= sp.z - 2 && z < sp.z + sp.h + 2;

    // path distance from the launch pad
    const dist = new Int16Array(G * G).fill(-1);
    const q = [32 + 56 * G];
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % G, z = (i / G) | 0;
      for (const [dx, dz] of PROBE_DIRS) {
        const nx = x + dx, nz = z + dz;
        if (open(nx, nz) && dist[nz * G + nx] < 0) { dist[nz * G + nx] = dist[i] + 1; q.push(nz * G + nx); }
      }
    }

    const placed = [];
    const farFromOthers = (x, z, d) => placed.every((b) => Math.hypot(b.gx - x, b.gz - z) >= d);

    // 1) Shortcuts: a hidden tunnel (up to 12 cells) through solid rock behind a cracked wall, joining two spots
    //    that are far apart by path. One blast on the cracked wall opens the whole tunnel.
    const cands = [];
    for (let z = 3; z < G - 3; z++) {
      for (let x = 3; x < G - 3; x++) {
        if (!open(x, z) || nearSpawn(x, z)) continue;
        for (const [dx, dz] of PROBE_DIRS) {
          const px = -dz, pz = dx;
          const cells = [];
          for (let k = 1; k <= 12; k++) {
            const cx = x + dx * k, cz = z + dz * k;
            if (cx < 3 || cz < 3 || cx > G - 4 || cz > G - 4) break;
            if (open(cx, cz)) {
              const a1 = dist[z * G + x], b1 = dist[cz * G + cx];
              const saving = Math.abs(a1 - b1) - k;
              if (cells.length >= 1 && a1 >= 0 && b1 >= 0 && saving >= 7) cands.push({ cells: cells.slice(), gap: saving + rngW() * 8 });
              break;
            }
            if (at(cx, cz) !== CELL_WALL || nearSpawn(cx, cz)) break;
            if (k >= 2 && (at(cx + px, cz + pz) !== CELL_WALL || at(cx - px, cz - pz) !== CELL_WALL)) break;
            cells.push([cx, cz]);
          }
        }
      }
    }
    cands.sort((p1, p2) => p2.gap - p1.gap);
    const nShort = Math.min(6, 1 + Math.floor(tier / 3));
    let nSh = 0;
    for (const c of cands) {
      if (nSh >= nShort) break;
      if (!c.cells.every(([cx, cz]) => at(cx, cz) === CELL_WALL && farFromOthers(cx, cz, 9))) continue;
      const [fx, fz] = c.cells[0];
      const tunnel = c.cells.slice(1).map(([cx, cz]) => cz * G + cx);
      this.grid[fz * G + fx] = CELL_CRACKED;
      for (const ci of tunnel) this.grid[ci] = CELL_FLOOR;
      placed.push({ gx: fx, gz: fz, kind: 'shortcut', chamber: tunnel, pickup: null });
      for (const [cx, cz] of c.cells.slice(1)) placed.push({ gx: cx, gz: cz, kind: 'tunnel-marker', chamber: [], pickup: null, marker: true });
      nSh++;
    }

    // 2) Secret chambers: a 1x2 sealed pocket behind a cracked wall, holding a power-up
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const secrets = [];
    for (let z = 4; z < G - 4; z++) {
      for (let x = 4; x < G - 4; x++) {
        if (at(x, z) !== CELL_FLOOR || nearSpawn(x, z)) continue;
        for (const [dx, dz] of dirs) {
          const cells = [1, 2, 3, 4].map((k) => [x + dx * k, z + dz * k]);
          if (cells.some(([cx, cz]) => cx < 3 || cz < 3 || cx > G - 4 || cz > G - 4)) continue;
          if (cells.some(([cx, cz]) => at(cx, cz) !== CELL_WALL)) continue;
          const px = -dz, pz = dx;
          let sealed = true;
          for (let k = 0; k < 3 && sealed; k++) {
            const [cx, cz] = cells[k];
            if (at(cx + px, cz + pz) !== CELL_WALL || at(cx - px, cz - pz) !== CELL_WALL) sealed = false;
          }
          if (sealed) secrets.push({ e: cells[0], p1: cells[1], p2: cells[2] });
        }
      }
    }
    for (let i = secrets.length - 1; i > 0; i--) { const j = Math.floor(rngW() * (i + 1)); [secrets[i], secrets[j]] = [secrets[j], secrets[i]]; }
    const nSecret = Math.min(5, 1 + Math.floor(tier / 2));
    const bag = ['ROCKETS', 'ROCKETS', 'ROCKETS', 'BOOST', 'BOOST', 'REPAIR', 'REPAIR', 'STEALTH', 'STEALTH', 'OVERCHARGE', 'OVERCHARGE'];
    let nS = 0;
    for (const sc of secrets) {
      if (nS >= nSecret) break;
      if (!farFromOthers(sc.e[0], sc.e[1], 10)) continue;
      if (at(sc.e[0], sc.e[1]) !== CELL_WALL || at(sc.p1[0], sc.p1[1]) !== CELL_WALL || at(sc.p2[0], sc.p2[1]) !== CELL_WALL) continue;
      this.grid[sc.e[1] * G + sc.e[0]] = CELL_CRACKED;
      this.grid[sc.p1[1] * G + sc.p1[0]] = CELL_FLOOR;
      this.grid[sc.p2[1] * G + sc.p2[0]] = CELL_FLOOR;
      placed.push({ gx: sc.e[0], gz: sc.e[1], kind: 'secret', chamber: [sc.p1[1] * G + sc.p1[0], sc.p2[1] * G + sc.p2[0]], pickup: bag[Math.floor(rngW() * bag.length)], p1: sc.p1, p2: sc.p2 });
      nS++;
    }

    // Commit to the grid and build the visuals
    const blockGeo = new THREE.BoxGeometry(CELL_SIZE * 0.985, WALL_H, CELL_SIZE * 0.985);
    for (const b of placed) {
      if (b.marker) continue;
      for (const ci of b.chamber) this.secretHidden.add(ci);
      const wx = gridToWorldX(b.gx), wz = gridToWorldZ(b.gz);
      const mesh = new THREE.Mesh(blockGeo, this.crackMat);
      mesh.position.set(wx, WALL_H * 0.5, wz);
      mesh.userData.structural = true;
      this.levelGroup.add(mesh);
      b.active = true;
      b.mesh = mesh;
      b.pos = new THREE.Vector3(wx, WALL_H * 0.5, wz);
      this.breakables.push(b);
      if (b.pickup) {
        const mx = (gridToWorldX(b.p1[0]) + gridToWorldX(b.p2[0])) * 0.5;
        const mz = (gridToWorldZ(b.p1[1]) + gridToWorldZ(b.p2[1])) * 0.5;
        this.spawnPickup(mx, mz, b.pickup, b);
      }
    }
  },

  // Shafts: 1-3 cell tunnels through a wall whose opening is only a third of the wall height (bottom, middle or
  // top). A power-up floats in the middle of each one. The rocket must be at the right height to fit.
  placeShafts(numericSeed, tier) {
    const rngS = mulberry32((numericSeed ^ 0x51ED270B) >>> 0);
    const G = GRID_SIZE;
    const at = (x, z) => this.grid[z * G + x];
    const open = (x, z) => x >= 0 && z >= 0 && x < G && z < G && !isWallLike(at(x, z));
    const sp = this.rooms[0];
    const nearSpawn = (x, z) => x >= sp.x - 2 && x < sp.x + sp.w + 2 && z >= sp.z - 2 && z < sp.z + sp.h + 2;

    const cands = [];
    for (let z = 3; z < G - 3; z++) {
      for (let x = 3; x < G - 3; x++) {
        if (!open(x, z) || nearSpawn(x, z)) continue;
        for (const [dx, dz] of PROBE_DIRS) {
          const px = -dz, pz = dx;
          const cells = [];
          for (let k = 1; k <= 6; k++) {
            const cx = x + dx * k, cz = z + dz * k;
            if (cx < 3 || cz < 3 || cx > G - 4 || cz > G - 4) break;
            if (open(cx, cz)) {
              if (cells.length >= 1) cands.push({ cells: cells.slice(), r: rngS() + cells.length * 0.04 });
              break;
            }
            if (at(cx, cz) !== CELL_WALL || nearSpawn(cx, cz)) break;
            if (at(cx + px, cz + pz) !== CELL_WALL || at(cx - px, cz - pz) !== CELL_WALL) break;
            cells.push([cx, cz]);
          }
        }
      }
    }
    cands.sort((a, b) => a.r - b.r);

    // Dead-end shafts (3 cells deep, sealed at the far end) fill the quota where no through-wall run exists:
    // fly in, grab the power-up, then flip and burn back out, or detonate at the end.
    const dead = [];
    for (let z = 4; z < G - 4; z++) {
      for (let x = 4; x < G - 4; x++) {
        if (!open(x, z) || nearSpawn(x, z)) continue;
        for (const [dx, dz] of PROBE_DIRS) {
          const px = -dz, pz = dx;
          const cells = [1, 2, 3].map((k) => [x + dx * k, z + dz * k]);
          const endc = [x + dx * 4, z + dz * 4];
          if ([...cells, endc].some(([cx, cz]) => cx < 3 || cz < 3 || cx > G - 4 || cz > G - 4 || at(cx, cz) !== CELL_WALL)) continue;
          if (cells.some(([cx, cz]) => at(cx + px, cz + pz) !== CELL_WALL || at(cx - px, cz - pz) !== CELL_WALL)) continue;
          dead.push({ cells, r: rngS() });
        }
      }
    }
    dead.sort((a, b) => a.r - b.r);
    const all = cands.concat(dead);

    const taken = this.breakables.map((b) => [b.gx, b.gz]);
    const nShaft = Math.min(8, 2 + Math.floor(tier / 2));
    const bag = ['ROCKETS', 'ROCKETS', 'ROCKETS', 'BOOST', 'BOOST', 'REPAIR', 'REPAIR', 'STEALTH', 'STEALTH', 'OVERCHARGE', 'OVERCHARGE'];
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x33ddff });
    let n = 0;
    for (const c of all) {
      if (n >= nShaft) break;
      if (!c.cells.every(([cx, cz]) => at(cx, cz) === CELL_WALL)) continue;
      const mid = c.cells[Math.floor(c.cells.length / 2)];
      if (taken.some(([tx, tz]) => Math.hypot(tx - mid[0], tz - mid[1]) < 7)) continue;
      taken.push(mid);
      const band = Math.floor(rngS() * 3);               // 0 bottom, 1 middle, 2 top third
      const lo = band * WALL_H / 3, hi = lo + WALL_H / 3;
      for (const [cx, cz] of c.cells) {
        this.grid[cz * G + cx] = CELL_SHAFT_LOW + band;
        const wx = gridToWorldX(cx), wz = gridToWorldZ(cz);
        if (lo > 0.01) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, lo, CELL_SIZE), this.wallMat);
          m.position.set(wx, lo * 0.5, wz);
          m.userData.structural = true;
          this.levelGroup.add(m);
        }
        if (hi < WALL_H - 0.01) {
          const h = WALL_H - hi;
          const m = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, h, CELL_SIZE), this.wallMat);
          m.position.set(wx, hi + h * 0.5, wz);
          m.userData.structural = true;
          this.levelGroup.add(m);
        }
        for (const ty of [lo + 0.05, hi - 0.05]) {          // glowing rails mark the opening
          const t = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * 0.98, 0.1, CELL_SIZE * 0.98), trimMat);
          t.position.set(wx, ty, wz);
          t.userData.structural = true;
          this.levelGroup.add(t);
        }
      }
      const px = gridToWorldX(mid[0]), pz = gridToWorldZ(mid[1]);
      this.spawnPickup(px, pz, bag[Math.floor(rngS() * bag.length)], { active: false, shaft: true }, (lo + hi) * 0.5, 1.8);
      n++;
    }
  },

  spawnPickup(x, z, type, owner, y = 1.7, radius = 2.3) {
    const COLORS = { AMMO: 0xffdd55, ROCKETS: 0xffaa00, BOOST: 0x00e5ff, REPAIR: 0x44ff88, STEALTH: 0xaa66ff, OVERCHARGE: 0xff3344 };
    const col = COLORS[type] || 0xffffff;
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: col }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI * 0.5;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10), new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    grp.add(core, ring, halo);
    grp.userData.noThermal = true;
    this.levelGroup.add(grp);
    this.pickups.push({ active: true, type, owner, baseY: y, radius, pos: new THREE.Vector3(x, y, z), mesh: grp, core, ring, phase: Math.random() * 6.28 });
  },

  breakWall(bw) {
    if (!bw.active) return;
    bw.active = false;
    bw.mesh.visible = false;
    this.grid[bw.gz * GRID_SIZE + bw.gx] = CELL_FLOOR;
    for (const ci of bw.chamber) this.secretHidden.delete(ci);
    this.forgetCell(bw.gx, bw.gz);
    this._edgeTotal = null;
    this.totalOpen += 1 + bw.chamber.length;
    this.radarDirty = true;
    this.awardPoints(POINTS_BONUS.wall, 'WALL BREACH', true);
    _v5.copy(bw.pos); _v5.y = 1.8;
    if (bw.kind === 'secret') {
      this.secretsFound++;
      this.pushFeed('SECRET CHAMBER BREACHED', 'cyan');
    } else {
      this.shortcutsOpened++;
      this.pushFeed('WALL BREACHED — SHORTCUT OPENED', 'cyan');
    }
  },

  // Thickness of wall (in cells) between two points: used to muffle sound.
  wallThickness(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return 0;
    const steps = Math.ceil(dist / 1.0);
    let solid = 0;
    for (let i = 1; i < steps; i++) {
      if (this.isGridSolid(ax + dx * i / steps, az + dz * i / steps)) solid++;
    }
    return (solid * (dist / steps)) / CELL_SIZE;
  },

  disableLaserGrid(laser, notify = true) {
    if (laser.disabled) return;
    laser.disabled = true;
    laser.relayActive = false;
    laser.state = 'OFF';
    laser.relayCoreMat.color.setHex(0x182022);
    laser.relayGroup.traverse((o) => { if (o.isMesh) o.material = this.thermalMat(0.12); });
    for (const e of laser.emitters) e.traverse((o) => { if (o.isMesh) o.material = this.thermalMat(0.12); });
    laser.lensMat.color.setHex(0x182628);
    for (let i = 0; i < laser.beams.length; i++) {
      laser.beams[i].coreMesh.visible = false;
      laser.beams[i].glowMesh.visible = false;
    }
    this.audio.playLaserDown();
    if (notify) this.pushFeed('LASER RELAY DESTROYED — GRID OFFLINE', 'cyan');
    this.rewardKill('laser', this.lasers, (x) => x.disabled);
  },

  spawnEcmZone(x, z, radius) {
    const grp = new THREE.Group();
    grp.position.set(x, 3.6, z);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0x00bbff, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    const lattice = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.995, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0x33ddff, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false
      })
    );
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.32, 3.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x223a44, metalness: 0.7, roughness: 0.35 })
    );
    pylon.position.y = -1.8;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: 0x33eeff }));
    grp.add(shell, lattice, pylon, beacon);
    grp.userData.heat = 0.4;
    this.levelGroup.add(grp);
    this.ecmZones.push({ pos: new THREE.Vector3(x, 3.6, z), radius, mesh: grp, arcTimer: 0 });
  },

  spawnTurret(x, y, z) {
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b363c, metalness: 0.78, roughness: 0.3 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 8), darkMat);
    stem.position.set(x, y + 0.6, z);
    stem.userData.heat = 0.45;
    this.levelGroup.add(stem);

    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 10), darkMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.1), new THREE.MeshStandardMaterial({ color: 0x14181a, metalness: 0.8, roughness: 0.3 }));
    barrel.position.z = 0.85;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    eye.position.set(0, 0.12, 0.5);
    grp.add(dome, barrel, eye);
    grp.userData.heat = 0.78;
    this.levelGroup.add(grp);
    this.turrets.push({ active: true, pos: new THREE.Vector3(x, y, z), mesh: grp, stem, fireCooldown: 1.0 });
  },

  spawnBulkhead(x, z, phase) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, WALL_H - 0.2, 4.4), this.hazardMat);
    mesh.position.set(x, WALL_H * 0.5, z);
    mesh.userData.heat = 0.3;
    this.levelGroup.add(mesh);
    this.bulkheads.push({ x, baseX: x, z, halfX: 0.7, halfZ: 2.2, phase, mesh });
  },

  spawnTurbine(x, y, z, rotSpeed) {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55666e, metalness: 0.8, roughness: 0.25 });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.55, 0.22), mat);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 5.6, 0.22), mat);
    grp.add(b1, b2);
    grp.userData.heat = 0.5;
    this.levelGroup.add(grp);
    this.turbines.push({ pos: new THREE.Vector3(x, y, z), radius: 2.9, angle: 0, rotSpeed, mesh: grp });
  },

  spawnDestructibleGrate(x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 3.8, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x607d8b, wireframe: true })
    );
    mesh.position.set(x, y, z);
    mesh.userData.heat = 0.25;
    this.levelGroup.add(mesh);
    this.grates.push({ active: true, pos: new THREE.Vector3(x, y, z), halfX: 1.9, halfY: 1.9, halfZ: 0.4, mesh });
  },
};
