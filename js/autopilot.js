/* Autopilot (explore, plan, fly, fire control). Reads and drives the game object it is given. */
import {
  AUTOPILOT_TUNING, CELL_SIZE, CELL_VOID, CRUISE_THROTTLE, GRID_SIZE, GUN_HITS, GUN_RATE, GUN_SPEED, MAX_FLOORS,
  MISSILE_RADIUS, WALL_H, XV, isWalkable
} from './constants.js';
import { BARREL_BLAST_RADIUS, BARREL_CHAIN_REACH, laserBeamsAt, sweepHalfSpan, turretRange } from './hazards.js';
import { gridToWorldX, gridToWorldZ, worldToGridX, worldToGridZ } from './math.js';

/* Tuning numbers live in AUTOPILOT_TUNING (js/constants.js); turret range and laser beam timing come from js/hazards.js,
   the same functions the game itself uses. The step path (sense, steer, fire) allocates nothing: it only fills structs made in the
   constructor and walks the game's arrays with indexed loops. Allocation happens when a route is planned (the plan itself) and in
   the once-a-second mission decision. */
const TUNE = AUTOPILOT_TUNING;
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp1 = (v) => (v > 1 ? 1 : (v < -1 ? -1 : v));
const lim = (a, b, r) => a + Math.max(-r, Math.min(r, b - a));          // move a toward b by at most r
const FIRE_SPEC = {                                                       // per contact kind: priority, range, hit radius, vertical window, bullets needed
  'CIWS': { ...TUNE.fire.CIWS, need: GUN_HITS.turret },
  'SENTRY': { ...TUNE.fire.SENTRY, need: GUN_HITS.sentry },
  'LASER BOX': { ...TUNE.fire['LASER BOX'], need: GUN_HITS.box },
  'BARREL': { ...TUNE.fire.BARREL, need: 1 }                              // barrels go up in one round
};
const LG_WHY = { 'FUEL BARREL': 'LAST GASP: FUEL BARREL', 'CIWS TURRET': 'LAST GASP: CIWS TURRET', 'SENTRY': 'LAST GASP: SENTRY', 'CRACKED WALL': 'LAST GASP: CRACKED WALL' };   // fixed strings: nothing built per step
const FIRE_TIER = { 'LASER BOX': 2, 'CIWS': 3, 'SENTRY': 3, 'BARREL': 4 };   // fire control ranks targets by mission tier

/* ==========================================================================
   AUTOPILOT (rewrite, v2.24+). Layers, each with one job:
     1. telemetry      (sense)     -> this.t: one snapshot of the flight state per frame      [step 1: done]
     2. world model    (map/tracks)-> explore map (game.xgrid) + contact tracks               [step 3]
     3. waypoints      (plan)      -> A* over explored tiles, smoothed legs with alt/speed    [step 2]
     4. guidance       (fly)       -> look-ahead pursuit, PD heading/altitude, braking speed  [step 2]
     5. fire control   (shoot)     -> bracketed contacts only, lead, bursts, lock-on runs     [step 3]
   plus a mission planner on top                                                              [step 4]
   ========================================================================== */
export class Autopilot {
  constructor(game) {
    this.g = game;
    this.t = null;                         // latest telemetry snapshot (this._T once a rocket flies, null otherwise)
    this.brakeMax = 6;                     // measured: strongest deceleration seen (m/s^2), starts conservative
    this.turnMax = 1.2;                    // measured: fastest yaw rate seen (rad/s)
    this._prevSpd = 0; this._accEma = 0; this._fanT = 0; this._fan = null;
    this.FAN = [-60, -30, 0, 30, 60];      // forward clearance fan (degrees off the nose)
    this.knownTurrets = new Set(); this.knownList = [];
    this.stuck = { t: 0, x: 0, y: 0, z: 0, yaw: 0 };
    this.blocked = new Map();              // route tiles kept out of plans for a while after a stall: tile -> game time it expires
    this._nudgeT = 0; this._nudgeYaw = 0; this._nudgeClimb = 0;   // clearance nudge after a stall
    this.lastGasp = false; this._lgT = 0; this._lgKind = ''; this._lgX = 0; this._lgY = 0; this._lgZ = 0; this._lgObj = null; this._lgBest = Infinity;   // last-gasp scoring run
    this.dash = false; this.dash2 = false; this.ramp = false; this.rampPitch = 0;  // shaft dash and ramp climb: flies without hover (flight.js reads it)
    this.dockHold = null;                  // holding over a fuel dock while it charges the rocket
    this.pulseFire = false;                // set when the last-gasp pulse should go off; flight.js detonates at the start of the next step
    // ---- everything below is allocated once and reused: the per-step path (sense, steer, fire) creates no objects ----
    this._fanRad = this.FAN.map((deg) => deg * Math.PI / 180);
    this._fanBuf = new Float64Array(this.FAN.length);
    this._P99 = { l: 99, r: 99, u: 99, d: 99 };
    this._contacts = []; this._cpool = [];                              // contacts of the current snapshot, and the pooled objects behind them
    this._T = {                                                          // the telemetry snapshot itself
      time: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0, hSpeed: 0, vSpeed: 0, acc: 0, yaw: 0, pitch: 0, yawRate: 0, heading: 0,
      floor: 0, node: -1, tileX: -1, tileZ: -1, agl: 0, ceil: 0, probe: { l: 0, r: 0, u: 0, d: 0 }, fan: this._fanBuf, fanW: 30,
      brakeMax: 0, turnMax: 0, stopDist: 0, fuel: 0, burn: 0, burnCruise: 0, cruise: 0, rangeSec: 0, rangeM: 0, rangeCruiseM: 0,
      hull: 0, ammo: 0, rockets: 0, hover: false, landed: false, contacts: this._contacts, threats: 0, mode: 'MANUAL', route: 0
    };
    this._w = { yaw: 0, climb: 0, speed: 0, homing: false };             // the command being built this step
    this._res = { yaw: 0, climb: 0, speed: 0, homing: false };           // the smoothed command handed to the flight code
    this._prevCmd = { yaw: 0, climb: 0, speed: 0 }; this._prevOn = false;
    this._carrot = { x: 0, z: 0, n: 0 };
    this._cmdS = { err: 0, carrot: this._carrot, v: 0, L: 0 }; this.cmd = null;
    this._shot = { kind: '', d: 0, lead: 0, latMiss: 0, vertMiss: 0, onTarget: false, clearShot: false, fire: false, lockFrames: 0 };
    this._av = { fx: 0, fz: 0, rx: 0, rz: 0, climbTo: 0, slow: 0, nudge: 0 };
    this._beams = [{ x1: 0, y1: 0, x2: 0, y2: 0 }, { x1: 0, y1: 0, x2: 0, y2: 0 }, { x1: 0, y1: 0, x2: 0, y2: 0 }];
    this._thr = []; this._thrN = 0;                                      // pooled threat records
    this.tracks = new Map(); this._tl = []; this._trackPool = [];        // fire-control tracks: lookup map, ordered list, free pool
    this._hzB = null; this._hz = null;                                   // hazard buffers (reused when the sector size is unchanged)
    this._S = null;                                                      // search scratch buffers (distances, parents, heap, queue)
    this._pickGoals = new Map();
    this._goalPick = (i) => this._pickGoals.has(i);
    this._brGoals = new Map(); this._goalBreach = (i) => this._brGoals.has(i);
    // mission ladder scratch (decide() reuses all of it): candidate, firing-spot goals, box list, barrel cluster
    this._cand = { obj: null, kind: '' };
    this._atkGoals = new Map(); this._atkKind = new Map(); this._goalAtk = (i) => this._atkGoals.has(i);
    this._boxList = []; this._boxReach = 8; this._boxHit = null; this._goalBox = (i) => this._isBoxSpot(i);
    this._clu = [];
    this.knownSentries = []; this.knownBarrels = []; this.knownBoxes = [];   // seen this sector (reset with the sector)
    this.pickObj = null; this.pickEnergy = false; this.turretIgnore = new Map();
    this.breachFire = false;               // set when the charge should go off; flight.js detonates at the start of the next step
  }

  // Free distance along a horizontal direction from the rocket (grid march, 0.5 m steps)
  clearAlong(x, y, z, yaw, max) {
    const g = this.g, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    for (let d = 0.5; d <= max; d += 0.5) if (g.isGridSolid(x + dx * d, z + dz * d, y)) return d - 0.5;
    return max;
  }

  // ---- layer 1: telemetry. Called every step while a rocket flies (manual or auto). Fills the one reused snapshot. ----
  sense(dt) {
    const g = this.g, m = g.missile;
    if (!m || !m.active || g.state !== 'PLAYING' || dt <= 0) { this.t = null; return null; }
    const v = m.vel, speed = v.length(), hSpeed = Math.hypot(v.x, v.z);
    // acceleration along the flight path (smoothed) and the measured braking / turning limits
    const acc = (speed - this._prevSpd) / dt; this._prevSpd = speed;
    this._accEma += (acc - this._accEma) * Math.min(1, dt * 8);
    if (m.drop <= 0 && !m.landed && this._accEma < -this.brakeMax && this._accEma > -60) this.brakeMax = -this._accEma;
    if (Math.abs(m.yawRate) > this.turnMax && Math.abs(m.yawRate) < 8) this.turnMax = Math.abs(m.yawRate);
    // surroundings: floor / ceiling at the rocket, side and vertical probes, forward fan (10 Hz)
    g.localSurf(m.pos.x, m.pos.y, m.pos.z);
    const floorY = g._sf, ceilY = g._sc;
    const P = m.probe || this._P99;
    this._fanT -= dt;
    if (this._fanT <= 0 || !this._fan) {
      this._fanT = TUNE.fanEvery;
      const F = this._fanBuf;
      for (let k = 0; k < F.length; k++) F[k] = this.clearAlong(m.pos.x, m.pos.y, m.pos.z, m.yaw + this._fanRad[k], 30);
      this._fan = F;
      { const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);             // straight ahead: centre and both hull edges (+/- 0.6 m)
        this._fanW = Math.min(F[2], this.clearAlong(m.pos.x + rx * 0.6, m.pos.y, m.pos.z + rz * 0.6, m.yaw, 30), this.clearAlong(m.pos.x - rx * 0.6, m.pos.y, m.pos.z - rz * 0.6, m.yaw, 30)); }
    }
    // fuel: the game's own burn model (%/s) -> range left now and at cruise speed (the most economical)
    const vc = g.throttleSpeed(CRUISE_THROTTLE), vr = speed / Math.max(1, vc);
    const turn = Math.min(1, (Math.abs(m.yawRate) + Math.abs(m.pitchRate)) / 2.5);
    const burn = g.cfg.infFuel ? 0 : (m.fuelBurn || 0);
    const shape = 0.5 + 0.5 * vr * vr + 0.3 * turn;
    const burnCruise = burn > 0 ? burn / shape * 1.0 : 0;                 // same model at v = cruise, flying straight
    const rangeSec = burn > 0 ? m.fuel / burn : Infinity;
    // contacts: only what wears the [ ] brackets
    const C = this._contacts; C.length = 0;
    for (let _i1 = 0, _a1 = g.sentries; _i1 < _a1.length; _i1++) { const s = _a1[_i1]; if (s.active && !s.dying && s.thermalVis) this._addC('SENTRY', s, s.pos.x, s.pos.y + 1.2, s.pos.z, !!s.alerted);
    }
    for (let _i2 = 0, _a2 = g.turrets; _i2 < _a2.length; _i2++) { const tu = _a2[_i2]; if (tu.active && tu.mesh.userData._tv) this._addC('CIWS', tu, tu.pos.x, tu.pos.y, tu.pos.z, true);
    }
    for (let _i3 = 0, _a3 = g.lasers; _i3 < _a3.length; _i3++) { const l = _a3[_i3]; if (l.boxVis && l.lockRef && l.lockRef.active) this._addC('LASER BOX', l, l.relayPos.x, l.relayPos.y, l.relayPos.z, false);
    }
    for (let i = 0; i < g.barrels.length; i++) { const b = g.barrels[i]; if (b.active && b.thermalVis) this._addC('BARREL', b, b.pos.x, b.pos.y, b.pos.z, false); }
    for (let i = 1; i < C.length; i++) { const c = C[i]; let j = i - 1; while (j >= 0 && C[j].d > c.d) { C[j + 1] = C[j]; j--; } C[j + 1] = c; }   // by distance (stable)
    let threatN = 0; for (let i = 0; i < C.length; i++) if (C[i].threat) threatN++;
    for (let _i4 = 0, _a4 = g.pickups; _i4 < _a4.length; _i4++) { const pk = _a4[_i4]; if (pk.active && pk.mesh.userData._tv) pk._seen = true;
    }
    if (this._ktKey !== g.lidarKey) { this.knownTurrets = new Set(); this.knownList = []; this.knownSentries.length = 0; this.knownBarrels.length = 0; this.knownBoxes.length = 0; this._ktKey = g.lidarKey; }
    for (let i = 0; i < g.sentries.length; i++) { const s = g.sentries[i]; if (s.thermalVis && s.active && !s._apKnown) { s._apKnown = true; this.knownSentries.push(s); } }
    for (let i = 0; i < g.barrels.length; i++) { const b = g.barrels[i]; if (b.thermalVis && b.active && !b._apKnown) { b._apKnown = true; this.knownBarrels.push(b); } }
    for (let i = 0; i < g.lasers.length; i++) { const l = g.lasers[i]; if (l.boxVis && !l._apKnown) { l._apKnown = true; this.knownBoxes.push(l); } }
    { const range = turretRange(g.difficultyTier);
      for (let _i5 = 0, _a5 = g.turrets; _i5 < _a5.length; _i5++) { const tu = _a5[_i5]; if (tu.active && !this.knownTurrets.has(tu) && (tu.mesh.userData._tv || (tu.pos.distanceTo(m.pos) < range && g.los3(tu.pos.x, tu.pos.y, tu.pos.z, m.pos.x, m.pos.y, m.pos.z)))) { this.knownTurrets.add(tu); this.knownList.push(tu); this._hz = null; }
} }
    let node = -1;
    { const c0 = g.cellAt(m.pos.x, m.pos.z), f0 = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(m.pos.y))); if (c0 >= 0 && this.navOk2(f0 * GRID_SIZE * GRID_SIZE + c0)) node = f0 * GRID_SIZE * GRID_SIZE + c0; else node = g.autoNode(m); }
    const t = this._T;
    t.time = g.gameClock;
    t.x = m.pos.x; t.y = m.pos.y; t.z = m.pos.z; t.vx = v.x; t.vy = v.y; t.vz = v.z;
    t.speed = speed; t.hSpeed = hSpeed; t.vSpeed = v.y; t.acc = this._accEma;
    t.yaw = m.yaw; t.pitch = m.pitch; t.yawRate = m.yawRate;
    t.heading = ((-m.yaw * 180 / Math.PI) % 360 + 360) % 360;
    t.floor = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(m.pos.y))); t.node = node;
    t.tileX = node >= 0 ? (node % (GRID_SIZE * GRID_SIZE)) % GRID_SIZE : -1; t.tileZ = node >= 0 ? ((node % (GRID_SIZE * GRID_SIZE)) / GRID_SIZE) | 0 : -1;
    t.agl = m.pos.y - floorY - MISSILE_RADIUS; t.ceil = ceilY - m.pos.y - MISSILE_RADIUS;
    t.probe.l = P.l; t.probe.r = P.r; t.probe.u = P.u; t.probe.d = P.d;
    t.fan = this._fanBuf; t.fanW = this._fanW === undefined ? this._fanBuf[2] : this._fanW;
    t.brakeMax = this.brakeMax; t.turnMax = this.turnMax;
    t.stopDist = speed * speed / (2 * Math.max(1, this.brakeMax));        // distance needed to stop from this speed
    t.fuel = m.fuel; t.burn = burn; t.burnCruise = burnCruise; t.cruise = vc; t.rangeSec = rangeSec;
    t.rangeM = rangeSec === Infinity ? Infinity : rangeSec * speed;
    t.rangeCruiseM = burnCruise > 0 ? (m.fuel / burnCruise) * vc : Infinity;
    t.hull = m.hull; t.ammo = g.gunAmmo; t.rockets = g.ammo; t.hover = !!m.hover; t.landed = !!m.landed;
    t.contacts = C; t.threats = threatN;
    t.mode = m.auto ? (this.mission || 'AUTO') : (g.autoPlay ? 'WAIT' : 'MANUAL');
    t.route = g.xroute ? g.xroute.length : 0;
    this.t = t;
    return t;
  }


  // =====================================================================================================
  // STEP 2: waypoints (A* over explored tiles + string-pulled legs) and guidance (look-ahead pursuit)
  // =====================================================================================================
  engage() {
    this.active = true; this.done = false; this.plan = null; this.scan = null; this.replanT = 0; this.failN = 0; this.engagedAt = this.g.gameClock;
    this.tried = this.tried && this._triedKey === this.g.lidarKey ? this.tried : new Set(); this._triedKey = this.g.lidarKey;
    this.stuck.t = 0; this.stuck.x = 0; this.stuck.y = 0; this.stuck.z = 0; this.stuck.yaw = 0; this.cmd = null; this.why = 'ENGAGED';
    this.dockHold = null; this.dash = false; this.dash2 = false; this._nudgeT = 0; this.lastGasp = false; this._lgObj = null; this._lgT = 0; this.pulseFire = false;
    if (this._blKey !== this.g.lidarKey) { this.blocked.clear(); this._blKey = this.g.lidarKey; }
    this.fc = null; this._clearTracks(); this.boxWait = null; this.boxGoal = null; this.boxLaser = null;
    this.mission = 'EXPLORE'; this.noFrontier = false; this.pickObj = null; this.pickEnergy = false; this._decT = 0; this.gate = null; this.engT = null; this._prevOn = false; this.exposed = false;
    if (this._tiKey !== this.g.lidarKey) { this.turretIgnore = new Map(); this._tiKey = this.g.lidarKey; }
    if (this._pkKey !== this.g.lidarKey) { this.pickTried = new Set(); this.pickStuck = new Map(); this._pkKey = this.g.lidarKey; }
    if (this._boxKey !== this.g.lidarKey) { this.boxTried = new Set(); this._boxKey = this.g.lidarKey; }
    if (this._brKey !== this.g.lidarKey) { this.breachTried = new Set(); this._brKey = this.g.lidarKey; }
    this.breachT = null; this.breachFire = false; if (this._hnKey !== this.g.lidarKey) { this.huntNoRoute = false; this._hnKey = this.g.lidarKey; }
  }

  flyable(v) { return v === XV.OPEN || v === XV.RAMP || v === XV.SH_TOP || v === XV.SH_MID || v === XV.SH_BOT || v === XV.HOLE || v === XV.HAZ; }

  // Hazard layers, refreshed every 2 s into buffers that are reused while the sector size stays the same.
  // hard: never route through (turbines, bulkheads, live laser grids);
  // soft: allowed at a cost (fuel barrels only explode when hit, grates are passable beside)
  hazards() {
    const g = this.g, now = g.gameClock;
    if (this._hz && now - this._hzT < TUNE.hazardEvery) return this._hz;
    const G = GRID_SIZE, GG = G * G, n = GG * g.nFloors;
    let B = this._hzB;
    if (!B || B.n !== n) {
      const hard = new Uint8Array(n), soft = new Uint8Array(n), gate = new Int16Array(n), danger = new Uint8Array(n), noClimb = new Set();
      B = this._hzB = { n, out: { hard, soft, gate, noClimb, danger } };
    } else { const o = B.out; o.hard.fill(0); o.soft.fill(0); o.gate.fill(0); o.danger.fill(0); o.noClimb.clear(); }
    const { hard, soft, gate, noClimb, danger } = B.out;
    for (let _i6 = 0, _a6 = g.turbines; _i6 < _a6.length; _i6++) { const tb = _a6[_i6]; // a turbine is a thin fan: only the tiles its blades sweep
      const gz = worldToGridZ(tb.pos.z);
      for (let gx = 0; gx < G; gx++) if (Math.abs(gridToWorldX(gx) - tb.pos.x) < tb.radius + MISSILE_RADIUS + CELL_SIZE * 0.5 && gz >= 0 && gz < G) hard[gz * G + gx] = 1;
    }
    for (let _i7 = 0, _a7 = g.bulkheads; _i7 < _a7.length; _i7++) { const b = _a7[_i7]; this._disc(hard, b.x, b.z, 3.0, 0);
    }
    if (this.blocked.size) this.blocked.forEach((until, i) => { if (until > now) { if (i < n) hard[i] = 1; } else this.blocked.delete(i); });   // tiles a stall was blamed on
    for (let li = 0; li < g.lasers.length; li++) {                       // laser grids: timed gates (a grid that would not open: avoided for a while)
      const l = g.lasers[li];
      if (l.disabled || l.mode === 'PULSE_GATE') continue;
      const gz = worldToGridZ(l.z);
      /* 3-line grids: flown through at the gap height, no gate */
      const blocked = this.gateBlock && (this.gateBlock.get(l) || 0) > now;
      for (let x = l.xMin; x <= l.xMax + 0.01; x += CELL_SIZE * 0.5) { const gx = worldToGridX(x); if (gx >= 0 && gx < G && gz >= 0 && gz < G) { if (blocked) hard[gz * G + gx] = 1; else gate[gz * G + gx] = li + 1; } }
    }
    for (let _i8 = 0, _a8 = g.targets; _i8 < _a8.length; _i8++) { const tg = _a8[_i8]; if (tg.active) this._disc(hard, tg.pos.x, tg.pos.z, 0.3, Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(tg.pos.y))));
}   // primary targets: flying into one detonates the warhead
    for (let _i9 = 0, _a9 = g.barrels; _i9 < _a9.length; _i9++) { const b = _a9[_i9]; if (b.active) this._disc(soft, b.pos.x, b.pos.z, 0.6, Math.min(g.nFloors - 1, Math.max(0, Math.floor(b.pos.y / WALL_H))));
    }
    for (let _i10 = 0, _a10 = g.grates; _i10 < _a10.length; _i10++) { const gr = _a10[_i10]; if (gr.active) this._disc(soft, gr.pos.x, gr.pos.z, 0.6, 0);
    }
    // holes / atriums with a live CIWS turret overhead (within 12 m): climbing through means being shot from straight above,
    // where a level-nosed hover can neither aim the gun nor lock on. Routes go up the ramps instead.
    let anyLive = false; for (let _i11 = 0, _a11 = g.turrets; _i11 < _a11.length; _i11++) { const tu = _a11[_i11]; if (tu.active) { anyLive = true; break; }
    }
    if (anyLive) {
      this.vlinks();
      const keys = this._vlKeys;
      for (let k = 0; k < keys.length; k++) {
        const i = keys[k], c = i % GG, x = gridToWorldX(c % G), z = gridToWorldZ((c / G) | 0);
        for (let _i12 = 0, _a12 = g.turrets; _i12 < _a12.length; _i12++) { const tu = _a12[_i12]; if (tu.active && Math.hypot(tu.pos.x - x, tu.pos.z - z) < 12) { noClimb.add(i); break; }
        }
      }
    }
    const X = g.xgrid;
    if (X && this.knownList.length) {
      const range = turretRange(g.difficultyTier), cr = Math.ceil(range / CELL_SIZE);
      for (let _i13 = 0, _a13 = this.knownList; _i13 < _a13.length; _i13++) { const tu = _a13[_i13]; if (!tu.active) continue;
        const tf = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(tu.pos.y))), tgx = worldToGridX(tu.pos.x), tgz = worldToGridZ(tu.pos.z);
        for (let f = Math.max(0, tf - 1); f <= Math.min(g.nFloors - 1, tf); f++) for (let gz = Math.max(0, tgz - cr); gz <= Math.min(G - 1, tgz + cr); gz++) for (let gx = Math.max(0, tgx - cr); gx <= Math.min(G - 1, tgx + cr); gx++) {
          const i = f * GG + gz * G + gx; if (!X[i] || danger[i]) continue;
          const x = gridToWorldX(gx), z = gridToWorldZ(gz), y = f * WALL_H + 2.2;
          if (Math.hypot(tu.pos.x - x, tu.pos.y - y, tu.pos.z - z) < range && g.los3(tu.pos.x, tu.pos.y, tu.pos.z, x, y, z)) danger[i] = 1;
        }
      }
    }
    this._hz = B.out; this._hzT = now;
    return this._hz;
  }

  tileCenter(i) {
    const G = GRID_SIZE, GG = G * G, c = i % GG;
    return { x: gridToWorldX(c % G), z: gridToWorldZ((c / G) | 0), f: (i / GG) | 0 };
  }


  // ---- multi-floor: drop holes and atriums (no slab) link a tile to the one below; the lift is avoided ----
  navOk2(i) {
    const g = this.g, GG = GRID_SIZE * GRID_SIZE, f = (i / GG) | 0, c = i % GG;
    if (f < 0 || f >= g.nFloors) return false;
    if (g.liftCells && g.liftCells.has(c)) return false;                 // the lift takes over the rocket's height: keep out
    return g.navOk(i) || (f > 0 && g.floors[f][c] === CELL_VOID && isWalkable(g.floors[f - 1][c]));
  }
  // ---- multi-floor: drop holes and atriums (no slab) link a tile to the one below; the lift is avoided ----
  vlinks() {
    const g = this.g;
    if (this._vl && this._vlFor === g.floors) return this._vl;
    const G = GRID_SIZE, GG = G * G, L = new Map();
    const add = (a, b) => { if (!L.has(a)) L.set(a, []); L.get(a).push(b); };
    for (let f = 1; f < g.nFloors; f++) for (let c = 0; c < GG; c++)
      if (g.floors[f][c] === CELL_VOID && isWalkable(g.floors[f - 1][c]) && !(g.liftCells && g.liftCells.has(c))) { add(f * GG + c, (f - 1) * GG + c); add((f - 1) * GG + c, f * GG + c); }
    this._vl = L; this._vlFor = g.floors; this._vlKeys = Int32Array.from(L.keys());
    return L;
  }
  links(i) {
    const a = this.g.navLinks && this.g.navLinks.get(i);
    let b = this.vlinks().get(i);
    const nc = this.hazards().noClimb;
    if (b && nc.size) { if (nc.has(i)) b = null; else { b = b.filter((j) => !nc.has(j)); if (!b.length) b = null; } }   // no climbing under a live turret
    return a && b ? a.concat(b) : (a || b);
  }

  // ---- obstacle avoidance: fuel barrels (blast on contact within 1.47 m), sentries and primary targets ahead ----
  // Climb over them where the room allows, wait until high enough, and steer aside.
  avoid(out) {
    const g = this.g, t = this.t, A = this._av;
    A.fx = -Math.sin(t.yaw); A.fz = -Math.cos(t.yaw); A.rx = -A.fz; A.rz = A.fx;
    A.climbTo = -Infinity; A.slow = Infinity; A.nudge = 0;
    const fx = A.fx, fz = A.fz, rx = A.rx, rz = A.rz;
    for (let _i14 = 0, _a14 = g.barrels; _i14 < _a14.length; _i14++) { const b = _a14[_i14]; if (b.active && Math.abs(b.pos.y - t.y) < 4) this._avCheck(b.pos.x, b.pos.z, 1.47, b.pos.y + 2.1);
    }
    for (let _i15 = 0, _a15 = g.sentries; _i15 < _a15.length; _i15++) { const s = _a15[_i15]; if (s.active && !s.dying && Math.abs(s.pos.y - t.y) < 4) this._avCheck(s.pos.x, s.pos.z, 1.2, s.pos.y + 3.0);
    }
    let climbTo = A.climbTo, slow = A.slow, nudge = A.nudge;
    for (let _i16 = 0, _a16 = g.targets; _i16 < _a16.length; _i16++) { const tg = _a16[_i16]; if (!tg.active || this.mission === 'HUNT') continue;
      const dx = tg.pos.x - t.x, dz = tg.pos.z - t.z, f = dx * fx + dz * fz, s = dx * rx + dz * rz, R = tg.radius + 1.8;
      if (f > -1 && f < 8 && Math.abs(s) < R) { slow = Math.min(slow, 2.5); nudge += (s >= 0 ? 2 : -2) * (1 - Math.abs(s) / R); }   // a primary target ahead: slow down and steer firmly round it
    }
    // laser planes: outside a timed gate crossing, never close in on an active beam plane (stop within 3 m when heading at it)
    if (!this.gate) for (let _i17 = 0, _a17 = g.lasers; _i17 < _a17.length; _i17++) { const l = _a17[_i17]; // only a real crossing course: the path meets the plane within 3 m, inside the span, while unsafe
      if (l.disabled) continue;
      const dz = t.z - l.z;
      if (Math.sign(dz) * fz >= -0.05) continue;                        // not heading toward the plane
      const wN = this.plan && this.plan.wps[this.plan.k];
      if (wN && Math.sign(wN.z - l.z) === Math.sign(dz) && Math.abs(wN.z - l.z) > 0.6 && t.speed < 4 && Math.abs(dz) > 1.6) continue;   // the route turns before the plane (it never crosses here)
      const along = Math.abs(dz) / Math.abs(fz);
      if (along > 3) continue;
      const xc = t.x + fx * along;
      if (xc < l.xMin - 0.5 || xc > l.xMax + 0.5) continue;
      const tc = along / Math.max(1, t.speed);
      if (!this.laserSafe(l, t.time, t.time + tc + 1.4 / Math.max(1.5, t.speed) + 0.4, xc, t.y)) slow = 0;   // the whole time the body spends in the beam plane
    }
    // primary targets: within 4.5 m and heading at one -> stop forward motion and turn away (their body is 2.1 m)
    if (this.mission !== 'HUNT') for (let _i18 = 0, _a18 = g.targets; _i18 < _a18.length; _i18++) { const tg = _a18[_i18]; if (!tg.active) continue;
      const dx = tg.pos.x - t.x, dz = tg.pos.z - t.z, d = Math.hypot(dx, dz), f = dx * fx + dz * fz, s = dx * rx + dz * rz;
      if (d < 4.5 && f > 0 && Math.abs(s) < tg.radius + 0.9) { slow = 0; nudge += (s >= 0 ? 2.5 : -2.5); }   // only on a collision course
    }
    if (climbTo > -Infinity && this.nearAnyBeam()) climbTo = -Infinity;   // near laser beams the height is set by the crossing
    if (climbTo > -Infinity) { const yT = Math.min(t.y + t.ceil - 0.5, climbTo); out.climb = Math.max(out.climb, clamp1(1.6 * (yT - t.y))); }
    if (slow < Infinity) out.speed = Math.min(out.speed, slow);
    if (nudge) out.yaw = clamp1(out.yaw + 0.6 * nudge);
    return out;
  }

  // Multi-goal A* (Dijkstra with a heap) from `start` to the frontier: explored, flyable tiles that touch unexplored ones.
  // Step costs: 1 straight, 1.41 diagonal (only when both side tiles are flyable), +0.35 next to a wall, +2.5 next to a hazard,
  // floor links (ramp ends) 2. Among the cheapest frontiers it prefers the one ahead of the nose.
  planFrontier(start) {
    const g = this.g, X = g.xgrid, G = GRID_SIZE, GG = G * G, N = GG * g.nFloors, t = this.t;
    if (!X || start < 0) return null;
    if (g.navFor !== g.ramps) g.navLinksBuild();
    const HZ = this.hazards(), haz = HZ.hard, soft = HZ.soft;
    const ok = (i) => this.flyable(X[i]) && this.navOk2(i) && !haz[i];
    const unknownN = (i) => {
      const c = i % GG, x = c % G, z = (c / G) | 0;
      if ((x > 0 && !X[i - 1]) || (x < G - 1 && !X[i + 1]) || (z > 0 && !X[i - G]) || (z < G - 1 && !X[i + G])) return true;
      const L = this.links(i); if (L) for (const j of L) if (!X[j]) return true;       // a ramp top / hole whose other end is still unknown
      return false;
    };
    // floors barely explored compared with the best-known floor get a bonus, so upper floors are not left for last
    const S = this._scratch(N), dist = S.dist, prev = S.prev, perF = S.perF; perF.length = 0; let maxF = 1;
    for (let f = 0; f < g.nFloors; f++) { let n = 0; for (let k = f * GG; k < (f + 1) * GG; k++) if (X[k]) n++; perF.push(n); maxF = Math.max(maxF, n); }
    const nearWall = (i) => { const c = i % GG, x = c % G, z = (c / G) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= G || zz >= G) return true; const v = X[i + dz * G + dx]; if (v === XV.SOLID || v === XV.CRACK) return true; } return false; };
    const nearHaz = (i) => { const c = i % GG, x = c % G, z = (c / G) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, zz = z + dz; if (xx >= 0 && zz >= 0 && xx < G && zz < G && haz[i + dz * G + dx]) return true; } return false; };
    dist.fill(Infinity, 0, N); prev.fill(-1, 0, N); S.hs = 0;
    dist[start] = 0; this._hpush(0, start);
    let bestD = -1; const found = S.found; found.length = 0;
    while (S.hs > 0) {
      const i = this._hpop(), d = S.pc;
      if (d > dist[i]) continue;
      if (bestD >= 0 && d > bestD + TUNE.frontierSlack) break;
      if (i !== start && unknownN(i) && !this.tried.has(i)) { found.push(i); if (bestD < 0) bestD = d; }
      const c = i % GG, x = c % G, z = (c / G) | 0, f0 = i - c;
      const step = (n, base) => { if (!ok(n)) return; if ((HZ.gate[n] || HZ.gate[i]) && (base > 1.2 || (HZ.gate[n] && HZ.gate[n] === HZ.gate[i]))) return; const nd = d + base + (nearWall(n) ? TUNE.costWall : 0) + (nearHaz(n) ? TUNE.costHazard : 0) + (soft[n] ? TUNE.costSoft : 0) + (HZ.gate[n] ? TUNE.costGate : 0) + (HZ.danger[n] ? TUNE.costDanger : 0); if (nd < dist[n]) { dist[n] = nd; prev[n] = i; this._hpush(nd, n); } };
      const L = x > 0, R = x < G - 1, U = z > 0, D = z < G - 1;
      if (L) step(i - 1, 1); if (R) step(i + 1, 1); if (U) step(i - G, 1); if (D) step(i + G, 1);
      if (L && U && ok(i - 1) && ok(i - G)) step(i - G - 1, TUNE.costDiag); if (R && U && ok(i + 1) && ok(i - G)) step(i - G + 1, TUNE.costDiag);
      if (L && D && ok(i - 1) && ok(i + G)) step(i + G - 1, TUNE.costDiag); if (R && D && ok(i + 1) && ok(i + G)) step(i + G + 1, TUNE.costDiag);
      const extra = this.links(i);
      if (extra) for (const n of extra) step(n, TUNE.costLink);
      if (f0 < 0) break;
    }
    if (!found.length) return null;
    let best = found[0], bestS = Infinity;
    for (const i of found) {
      const p = this.tileCenter(i);
      const a = wrapAngle(Math.atan2(-(p.x - t.x), -(p.z - t.z)) - t.yaw);
      const fl = (i / GG) | 0, sc = dist[i] + Math.abs(a) * TUNE.frontierBearing - (perF[fl] < maxF * 0.35 ? 30 : (perF[fl] < maxF * 0.6 ? 10 : 0)) + (HZ.danger[i] ? TUNE.frontierDanger : 0) - this._breachLure(i);   // badly unexplored floors win; turret coverage loses; a new opening wins
      if (sc < bestS) { bestS = sc; best = i; }
    }
    const tiles = [];
    for (let i = best; i !== start && i >= 0; i = prev[i]) tiles.push(i);
    tiles.reverse();
    return { goal: best, tiles };
  }

  // Is the straight segment a->b (same floor) clear: every sample over a flyable, hazard-free tile, with 0.55 m side clearance
  segClear(ax, az, bx, bz, f, y) {
    const g = this.g, X = g.xgrid, GG = GRID_SIZE * GRID_SIZE, haz = this.hazards().hard;
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.01) return true;
    const ux = (bx - ax) / len, uz = (bz - az) / len, px = -uz * 1.0, pz = ux * 1.0;   // 1 m side clearance: legs never hug a corner
    for (let d = 0; d <= len; d += 0.5) {
      const x = ax + ux * d, z = az + uz * d;
      const c = g.cellAt(x, z); if (c < 0) return false;
      const i = f * GG + c;
      if (!this.flyable(X[i]) || (haz && haz[i]) || this.hazards().gate[i]) return false;
      if (g.isGridSolid(x + px, z + pz, y) || g.isGridSolid(x - px, z - pz, y)) return false;
      for (const tg of g.targets) if (tg.active && Math.hypot(tg.pos.x - x, tg.pos.z - z) < tg.radius + 1.3) return false;   // a primary target's body
    }
    return true;
  }

  // Tiles -> waypoints: string-pulled straight legs. Floor changes and shaft tiles are always kept as waypoints.
  // Each waypoint carries a target altitude and a speed limit from the turn it makes.
  smooth(tiles) {
    const g = this.g, t = this.t, X = g.xgrid, GG = GRID_SIZE * GRID_SIZE;
    const pts = tiles.map((i) => { const p = this.tileCenter(i); return { x: p.x, z: p.z, f: p.f, i, alt: g.autoNodeAlt(i), keep: X[i] === XV.SH_TOP || X[i] === XV.SH_MID || X[i] === XV.SH_BOT || X[i] === XV.RAMP, shaft: X[i] === XV.SH_TOP || X[i] === XV.SH_MID || X[i] === XV.SH_BOT, gate: this.hazards().gate[i] }; });
    const wps = [];
    let ax = t.x, az = t.z, af = t.floor, k = 0;
    while (k < pts.length) {
      let j = k;
      while (j + 1 < pts.length && pts[j + 1].f === af && !pts[j].keep && !pts[j + 1].keep && !pts[j].gate && !pts[j + 1].gate && this.segClear(ax, az, pts[j + 1].x, pts[j + 1].z, af, t.y)) j++;
      if (pts[j].f !== af) pts[j].vert = true;                         // a floor change: reached only at the right height
      wps.push(pts[j]);
      ax = pts[j].x; az = pts[j].z; af = pts[j].f; k = j + 1;
    }
    const vc = t.cruise;
    for (let n = 0; n < wps.length; n++) {
      const w = wps[n];
      if (n === wps.length - 1) { w.vmax = 1.5; continue; }
      if (w.vert || (wps[n + 1] && wps[n + 1].vert)) { w.vmax = 1.0; continue; }
      const a = n === 0 ? { x: t.x, z: t.z } : wps[n - 1], b = wps[n + 1];
      const h1 = Math.atan2(w.x - a.x, w.z - a.z), h2 = Math.atan2(b.x - w.x, b.z - w.z);
      let th = Math.abs(h2 - h1); if (th > Math.PI) th = Math.PI * 2 - th;
      w.vmax = Math.max(2, Math.min(vc, 2 + 12 * Math.pow(1 - th / Math.PI, 3)));
      if (w.keep) w.vmax = Math.min(w.vmax, 3);
    }
    return wps;
  }

  newPlan() {
    const t = this.t, g = this.g, Mi = this.mission;
    if (Mi === 'HUNT') { this.newHuntPlan(); return; }
    if (Mi === 'ENGAGE' || Mi === 'CLEAR_BARREL') { this.newAttackPlan(); return; }
    if (Mi === 'LASER_SWITCH') { this.newLaserPlan(); return; }
    if (Mi === 'PICKUP') { this.newPickupPlan(); return; }
    if (Mi === 'BREACH') { this.newBreachPlan(); return; }
    if (g.xgrid && t.node >= 0) { const v = g.xCellVal(t.floor, t.node % (GRID_SIZE * GRID_SIZE)); if (g.xgrid[t.node] !== v) { g.xgrid[t.node] = v; g.xgridDirty = true; } }
    if (t.node < 0) { this.plan = null; this.replanT = 0.5; this.why = 'NO POSITION FIX'; return; }   // between floors / over a hole: try again shortly
    const p = this.planFrontier(t.node);
    if (p) { this.failN = 0; this.noFrontier = false; }
    if (!p) {
      const X = g.xgrid, GG = GRID_SIZE * GRID_SIZE, G = GRID_SIZE, i = t.node;
      const c = i % GG, x = c % G, z = (c / G) | 0;
      const unknownHere = X && ((x > 0 && !X[i - 1]) || (x < G - 1 && !X[i + 1]) || (z > 0 && !X[i - G]) || (z < G - 1 && !X[i + G]));
      if (unknownHere && !this.tried.has(i)) { this.startScan(i); return; }
      if (t.time - (this.engagedAt || 0) > 4) this.failN = (this.failN || 0) + 1;   // only call it explored after 3 failed plans in a row (never in the first seconds)
      if (this.failN < 3) { this.plan = null; this.replanT = 1.0; this.why = 'NO FRONTIER - RETRYING'; return; }
      this.plan = null; this.noFrontier = true; this.replanT = 3; this.why = 'NOTHING LEFT TO EXPLORE';
      this._decT = 0;                                                    // the ladder picks the next tier at once
      let any = false; for (let k = 0; k < g.targets.length; k++) if (g.targets[k].active) { any = true; break; }
      if (!any) this.done = true;                                        // nothing to explore and nothing to hunt
      return;
    }
    if (!p.tiles.length) { this.startScan(p.goal); return; }
    this.plan = { goal: p.goal, tiles: p.tiles, wps: this.smooth(p.tiles), k: 0, t0: t.time, alt0: t.y };
    g.xroute = p.tiles.slice();
    this.why = 'ROUTE TO FRONTIER';
  }

  startScan(goal) {
    this.plan = null;
    const n = this.t.node;
    if (n >= 0 && this.g.autoClearance(n) > 2 && this.g.autoUnknownNear(n) >= 6) { this.scan = { acc: 0, last: this.t.yaw, t: 0, goal }; this.why = 'SCAN 360'; }
    else { this.tried.add(goal); this.replanT = 0; this.why = 'NO SCAN NEEDED'; }
  }



  // Will a rocket at (x, y) on the grid's plane stay clear of every beam from T0 to T1? (hit radius 0.54 m + 0.35 m margin)
  // The beams come from js/hazards.js, the same functions the game moves the real beams with.
  laserSafe(l, T0, T1, x, y) {
    const R = MISSILE_RADIUS + 0.12 + 0.35, B = this._beams;
    let step = 0.02;                                                     // a fast sideways sweeper can move metres in 0.02 s: sample finely enough to never skip past
    if (l.mode === 'SWEEPER_H') step = Math.min(0.02, 0.5 * R / (sweepHalfSpan(l) * Math.abs(l.speed) + 1e-3));
    for (let tt = T0; tt <= T1 + 1e-9; tt += step) {
      const nb = laserBeamsAt(l, tt, B);
      for (let bi = 0; bi < nb; bi++) {
        const b = B[bi], ax = b.x2 - b.x1, ay = b.y2 - b.y1, L2 = ax * ax + ay * ay;
        let u = L2 > 1e-4 ? ((x - b.x1) * ax + (y - b.y1) * ay) / L2 : 0; u = Math.max(0, Math.min(1, u));
        if (Math.hypot(x - (b.x1 + ax * u), y - (b.y1 + ay * u)) < R) return false;
      }
    }
    return true;
  }

  // Crossing height for each kind of grid: pulse gates have fixed gaps, twin sweeps open around their middle
  gateAltitude(l) { return l.mode === 'PULSE_GATE' ? 2.55 : (l.mode === 'TWIN_SWEEP' ? 3.6 : 2.4); }

  // Moving-beam grid crossing (sweepers): no hold point and no waiting in front of the beams. Line up, match the crossing height,
  // and pick the approach speed that reaches the beam line inside a predicted gap (the beams follow the game clock exactly).
  // If no speed works yet, ease down to a stop 2.5 m short and keep re-checking; once inside 2 m it is committed.
  gateControl(dt) {
    const g = this.g, t = this.t, P = this.plan;
    if (!P || t.floor !== 0) { this.gate = null; return null; }
    if (!this.gate) {                                                    // a gate waypoint among the next ones, within 10 m of its beam line?
      for (let n = P.k; n < Math.min(P.wps.length, P.k + 2); n++) {
        const gi = P.wps[n].gate; if (!gi) continue;
        const l = g.lasers[gi - 1]; if (!l || l.disabled) continue;
        if (Math.abs(t.z - l.z) < 10) { this.gate = { l, wp: n, side: Math.sign(t.z - l.z) || 1, phase: 'APPROACH', t0: t.time }; break; }
      }
      if (!this.gate) return null;
    }
    const G0 = this.gate, l = G0.l, dz = (t.z - l.z) * G0.side;      // > 0: still before the line
    if (l.disabled || dz < -2.8) { this.gate = null; return null; }     // grid switched off, or crossed with the body well clear
    const yc = Math.max(t.y - t.agl + 0.9, Math.min(t.y + t.ceil - 0.9, this.gateAltitude(l)));
    const w = P.wps[Math.min(G0.wp, P.wps.length - 1)];
    const cx = Math.max(l.xMin + 0.6, Math.min(l.xMax - 0.6, w.x));
    const aimZ = dz > 3 ? l.z + G0.side * 1.5 : l.z - G0.side * 6;      // line up on the crossing point, then straight over
    const err = wrapAngle(Math.atan2(-(cx - t.x), -(aimZ - t.z)) - t.yaw);
    let yaw = clamp1(2.4 * err - 0.35 * t.yawRate);
    if (t.probe.l < 1.3) yaw -= 0.9 * (1.3 - t.probe.l) / 1.3;
    if (t.probe.r < 1.3) yaw += 0.9 * (1.3 - t.probe.r) / 1.3;
    yaw = clamp1(yaw);
    const climb = clamp1(1.6 * (yc - t.y) - 0.3 * t.vSpeed);
    const a = Math.min(TUNE.brakeCap, TUNE.brakeFrac * t.brakeMax), fanCap = t.fan ? Math.max(t.fan[2] > 3 ? TUNE.crawlSpeed : 0, Math.sqrt(2 * a * Math.max(0, t.fanW - TUNE.fanMargin))) : 99;
    const vMax = Math.max(2, Math.min(6, t.cruise, fanCap));   // 6 m/s keeps the arrival-time estimate tight
    const ready = Math.abs(t.y - yc) < 0.35 && Math.abs(err) < 0.35;   // at the crossing height and pointing across
    if (t.time - G0.t0 > TUNE.gateMax) { (this.gateBlock || (this.gateBlock = new Map())).set(l, t.time + TUNE.gateBlockFor); this._hz = null; this.gate = null; this.plan = null; this.replanT = 0; this.why = 'LASER GATE: TRYING ANOTHER WAY'; return this.mk(0, climb, 0); }
    if (G0.phase === 'GO') {                                               // committed: hold the speed; a faster or slower one if the timing drifted
      if (this._gateGood(l, dz, ready, yc, cx, G0.v)) { this.why = 'LASER GATE: CROSSING'; return this.mk(yaw, climb, G0.v); }
      for (let v = vMax; v >= 1.5; v -= 0.5) if (this._gateGood(l, dz, ready, yc, cx, v)) { G0.v = v; this.why = 'LASER GATE: CROSSING'; return this.mk(yaw, climb, v); }
      if (dz > 1.2) { G0.phase = 'APPROACH'; this.why = 'LASER GATE: ABORT'; return this.mk(yaw, climb, 0); }
      this.why = 'LASER GATE: CROSSING'; return this.mk(yaw, climb, vMax);   // too late to stop: fastest way through
    }
    const stopAt = Math.sqrt(2 * a * Math.max(0, dz - 2.5));               // the speed that still stops 2.5 m short
    if (ready) {
      let best = null;                                                     // the safe speed nearest to the current one (smooth), preferring faster
      for (let v = vMax; v >= 1.5; v -= 0.5) if (this._gateGood(l, dz, ready, yc, cx, v) && (best === null || Math.abs(v - t.speed) < Math.abs(best - t.speed) - 0.01)) best = v;
      if (best !== null) {
        if (dz < 2.2) { G0.phase = 'GO'; G0.v = best; }
        this.why = dz < 2.2 ? 'LASER GATE: CROSSING' : 'LASER GATE: TIMING THE GAP';
        return this.mk(yaw, climb, best);
      }
    }
    this.why = dz < 2.8 ? 'LASER GATE: WAITING FOR A GAP' : 'LASER GATE: APPROACH';
    return this.mk(yaw, climb, Math.min(vMax, ready ? stopAt : Math.min(stopAt, 1.5)));
  }


  // A 3-line (pulse) grid close by: its beams are fixed at 1.55 / 3.55 / 5.55 m, so 2.55 m is safe anywhere, at any angle, any time.
  // Returns the crossing height to hold, or null.
  pulseHeight() {
    const g = this.g, t = this.t;
    if (t.floor !== 0) return null;
    for (let _i19 = 0, _a19 = g.lasers; _i19 < _a19.length; _i19++) { const l = _a19[_i19]; if (!l.disabled && l.mode === 'PULSE_GATE' && Math.abs(t.z - l.z) < 8 && t.x > l.xMin - 1.5 && t.x < l.xMax + 1.5 && this._pulseInWay(l, t)) return Math.max(t.y - t.agl + 0.6, Math.min(t.y + t.ceil - 0.6, 2.55));
    }
    return null;
  }
  nearAnyBeam() { return this._beamNear(8, 1.5); }

  // Look-ahead point on the waypoint polyline, `L` metres ahead of the rocket's position (written into the reused this._carrot)
  carrot(L) {
    const t = this.t, P = this.plan, wps = P.wps, C = this._carrot;
    let px = t.x, pz = t.z, left = L;
    for (let n = P.k; n < wps.length; n++) {
      const w = wps[n], dx = w.x - px, dz = w.z - pz, d = Math.hypot(dx, dz);
      if (d >= left || n === wps.length - 1) { const k = d > 0 ? Math.min(1, left / d) : 0; C.x = px + dx * k; C.z = pz + dz * k; C.n = n; return C; }
      left -= d; px = w.x; pz = w.z;
    }
    const w = wps[wps.length - 1]; C.x = w.x; C.z = w.z; C.n = wps.length - 1; return C;
  }

  // One step of the autopilot -> { yaw, climb, speed } (stick units / m/s). The result is the reused this._res struct:
  // read it at once, do not keep it.
  steer(dt) {
    const g = this.g, m = g.missile, t = this.t || this.sense(dt);
    if (!t) return this.mk(0, 0, 0);
    let out = this.mk(0, 0, 0);
    this.ramp = false;
    this.dash = false;                      // set below when the guidance wants to fly on without hover (tunnels)
    // --- at a fuel dock: settle over the pad and hold until the tank is full (the dock charges a slow, hovering rocket)
    if (this.dockHold) {
      const H = this.dockHold, pk = H.pk; H.t += dt;
      this._holdStuck(t);
      if (!pk.active || t.fuel >= 99.5 || H.t > TUNE.dockHoldMax) {
        this.dockHold = null; this.mission = 'EXPLORE'; this.pickObj = null; this.pickEnergy = false; this.plan = null; this.replanT = 0; this._decT = 0;
        if (t.fuel < 99.5) this.pickTried.add(pk);              // charging never worked from here: do not come back to it at once
        g.pushFeed(t.fuel >= 99.5 ? 'AUTOPILOT: TANK FULL — RESUMING' : 'AUTOPILOT: DOCK NOT CHARGING — MOVING ON', 'cyan');
      } else {
        const dx = pk.pos.x - t.x, dz = pk.pos.z - t.z, d = Math.hypot(dx, dz), brg = wrapAngle(Math.atan2(-dx, -dz) - t.yaw);
        this.why = 'RECHARGING AT A FUEL DOCK';
        return this.fire(dt, this.mk(clamp1(3 * brg - TUNE.yawDamp * t.yawRate), clamp1(1.4 * (pk.pos.y - t.y) - TUNE.climbDamp * t.vSpeed), d > 0.5 && Math.abs(brg) < 0.6 ? Math.min(1.5, d * 1.2) : 0));
      }
    }
    // --- at a firing spot (turret, sentry or barrel): face it, match its height, let fire control kill it (12 s at most)
    if ((this.mission === 'ENGAGE' || this.mission === 'CLEAR_BARREL') && this.engT && this.engT.atSpot) {
      const E = this.engT, tu = E.tu, alive = this._alive(E.kind, tu);
      E.spotT = (E.spotT || 0) + dt;
      this._holdStuck(t);
      if (!alive || E.spotT > TUNE.spotMax) {
        if (alive) this.turretIgnore.set(tu, t.time + TUNE.turretIgnoreFor);
        g.pushFeed(alive ? 'AUTOPILOT: TARGET OUT OF REACH — MOVING ON' : 'AUTOPILOT: TARGET DESTROYED', alive ? 'amber' : 'cyan');
        this.engT = null; this.mission = 'EXPLORE'; this.plan = null; this.replanT = 0; this._hz = null; this._decT = 0;
      } else {
        const brg = wrapAngle(Math.atan2(-(tu.pos.x - t.x), -(tu.pos.z - t.z)) - t.yaw);
        const yT = Math.max(t.y - t.agl + TUNE.roomMargin, Math.min(t.y + t.ceil - 0.6, this._aimY(E.kind, tu)));
        return this.fire(dt, this.mk(clamp1(3 * brg - TUNE.yawDamp * t.yawRate), clamp1(1.6 * (yT - t.y)), 0));
      }
    }
    // --- at a cracked wall: face it, and once it is inside the blast's reach set the warhead off (the next rocket explores behind it)
    if (this.mission === 'BREACH' && this.breachT && this.breachT.atSpot) {
      const B = this.breachT, bw = B.bw;
      B.spotT = (B.spotT || 0) + dt;
      this._holdStuck(t);
      if (!bw.active || B.spotT > TUNE.breachSpotMax) {
        if (bw.active) this.breachTried.add(bw);
        this.breachT = null; this.mission = 'EXPLORE'; this.plan = null; this.replanT = 0;
      } else {
        const dx = bw.pos.x - t.x, dz = bw.pos.z - t.z, brg = wrapAngle(Math.atan2(-dx, -dz) - t.yaw);
        const reach = 0.6 * g.blastRadiusBase() + 2.4 - TUNE.breachReachMargin, d = Math.hypot(dx, bw.pos.y - t.y, dz);
        if (d <= reach && Math.abs(brg) < 0.6 && t.speed < 1.5) {
          this.breachTried.add(bw); this.breachFire = true; this.why = 'BREACH: CHARGE AWAY';
          return this.mk(0, 0, 0);
        }
        const yT = Math.max(t.y - t.agl + TUNE.roomMargin, Math.min(t.y + t.ceil - TUNE.roomMargin, bw.pos.y - 1.4));
        return this.fire(dt, this.mk(clamp1(3 * brg - TUNE.yawDamp * t.yawRate), clamp1(1.4 * (yT - t.y)), d > reach && Math.abs(brg) < 0.5 ? 1.0 : 0));
      }
    }
    // --- at a laser switch box: face it until fire control has shot it (or 8 s)
    if (this.boxWait) {
      const L = this.boxLaser; this.boxWait.t += dt;
      this._holdStuck(t);
      if (!L || L.disabled || this.boxWait.t > TUNE.boxWaitMax) {
        if (L && !L.disabled) { (this.boxTried || (this.boxTried = new Set())).add(L); }
        this.boxWait = null; this.boxGoal = null; this.boxLaser = null; this._hz = null; this.replanT = 0; this.why = L && L.disabled ? 'LASER GRID DOWN' : 'SWITCH BOX NOT HIT';
      } else {
        const brg = wrapAngle(Math.atan2(-(L.relayPos.x - t.x), -(L.relayPos.z - t.z)) - t.yaw);
        out = this.mk(clamp1(3 * brg - TUNE.yawDamp * t.yawRate), clamp1(1.4 * (Math.min(t.y + t.ceil - 0.8, L.relayPos.y) - t.y)), 0);
        return this.fire(dt, out);
      }
    }
    // --- 360 scan where unexplored tiles are still around
    if (this.scan) {
      const S = this.scan; S.acc += Math.abs(wrapAngle(t.yaw - S.last)); S.last = t.yaw; S.t += dt;
      this._holdStuck(t);
      out = this.mk(1, clamp1((g.autoNodeAlt(t.node) - t.y) * 1.4), 0);
      if (S.acc >= Math.PI * 2 + 0.1 || S.t > TUNE.scanMax) { this.tried.add(S.goal); this.scan = null; this.replanT = 0; }
      return this.fire(dt, out);
    }
    // --- mission (once a second); a hunt that already sees its target goes straight into the lock-on run
    this._decT -= dt;
    if (this._decT <= 0) { this._decT = TUNE.decideEvery; if (!(this.huntBlockT > t.time)) this.decide(); }
    if (this.mission === 'HUNT') { const ht = this.huntTerminal(); if (ht) { this.cmd = null; return ht.homing ? ht : this.fire(dt, ht); } }
    // nearly dry with no repair kit in reach: spend the last of the burn on a score (not while hunting: the primary target is the score)
    if (this.mission !== 'HUNT') { const lg = this.lastGaspSteer(dt, t); if (lg) { this.cmd = null; return this.fire(dt, lg); } }
    else if (this.lastGasp) this.lastGasp = false;
    // running out of fuel next to a primary target: the engine-out crash blast (8 m) would end the sector early. Keep clear.
    if (this.mission !== 'HUNT' && t.burn > 0 && t.rangeSec < 8) {
      let tg = null, td = 13;
      for (let _i20 = 0, _a20 = g.targets; _i20 < _a20.length; _i20++) { const x = _a20[_i20]; if (x.active) { const d = Math.hypot(x.pos.x - t.x, x.pos.z - t.z); if (d < td) { td = d; tg = x; } }
      }
      if (tg) {
        const err = wrapAngle(Math.atan2(-(t.x - tg.pos.x), -(t.z - tg.pos.z)) - t.yaw);
        const a = Math.min(TUNE.brakeCap, TUNE.brakeFrac * t.brakeMax), v = Math.min(4, Math.max(0, Math.sqrt(2 * a * Math.max(0, (t.fanW || 30) - TUNE.fanMargin))));
        this.why = 'LOW FUEL - KEEPING CLEAR OF THE TARGET'; this.cmd = null;
        return this.fire(dt, this.mk(clamp1(2.5 * err - TUNE.yawDamp * t.yawRate), 0, Math.abs(err) < 0.8 ? v : 0.5));
      }
    }
    if (this.mission !== 'HUNT' && g.manualTargetLock) { g.manualTargetLock = false; g.homingLocked = false; }
    // --- (re)plan: no plan, every 1.5 s if the route is no longer valid, or when stuck
    this.replanT -= dt;
    if (!this.plan || this.replanT <= 0) {
      let valid = !!this.plan;
      if (valid) {
        const X = g.xgrid, haz = this.hazards().hard;
        const gi = this.plan.goal, gc = gi % (GRID_SIZE * GRID_SIZE), G = GRID_SIZE, gx = gc % G, gz = (gc / G) | 0;
        const stillFrontier = (gx > 0 && !X[gi - 1]) || (gx < G - 1 && !X[gi + 1]) || (gz > 0 && !X[gi - G]) || (gz < G - 1 && !X[gi + G]);
        if (!stillFrontier && !this.plan.hunt && !this.plan.pickup && !this.plan.laser && !this.plan.attack && !this.plan.breach) valid = false;   // the goal got explored on the way: pick the next one
        if (this.plan.pickup && !this.plan.pickup.active) valid = false;
        for (let _i21 = 0, _a21 = this.plan.tiles; _i21 < _a21.length; _i21++) { const i = _a21[_i21]; if (!this.flyable(X[i]) || (haz && haz[i])) { valid = false; break; }
        }
      }
      this.replanT = TUNE.replanEvery;
      if (!valid) { this.newPlan(); if (this.done) return out; if (this.scan || !this.plan) return this.fire(dt, out); }
    }
    const P = this.plan, wps = P.wps;
    // --- progress along the legs: a waypoint is reached when close, or passed (beyond its perpendicular)
    while (P.k < wps.length) {
      const w = wps[P.k], d = Math.hypot(w.x - t.x, w.z - t.z);
      const nx = P.k + 1 < wps.length ? wps[P.k + 1] : null;
      const passed = nx && ((t.x - w.x) * (nx.x - w.x) + (t.z - w.z) * (nx.z - w.z)) > 0 && d < TUNE.wpPassRange;
      if (w.vert && Math.abs(t.y - w.alt) > TUNE.vertTol) break;   // over the hole: climb / descend first
      if (w.gate) {                                                    // a laser gate: never "reached" by being near it
        const L = g.lasers[w.gate - 1], nxw = wps[P.k + 1];
        if (!L || L.disabled || (nxw && Math.sign(t.z - L.z) === Math.sign(nxw.z - L.z) && Math.abs(t.z - L.z) > 1.6)) { P.k++; continue; }   // already across
        break;                                                         // still to cross: the gate logic takes it
      }
      if (d < TUNE.wpReach || passed) P.k++; else break;
    }
    if (P.k >= wps.length) {
      this.plan = null;
      if (P.laser) { this.boxWait = { t: 0 }; this.why = 'SHOOTING A LASER SWITCH BOX'; return this.fire(dt, this.mk(0, 0, 0)); }
      if (P.pickup && P.pickup.type === 'DOCK') { this.dockHold = { pk: P.pickup, t: 0 }; this.why = 'RECHARGING AT A FUEL DOCK'; return this.fire(dt, this.mk(0, 0, 0)); }
      if (P.pickup) { this.pickTried.add(P.pickup); this.mission = 'EXPLORE'; this.replanT = 0; return this.fire(dt, this.mk(0, 0, 0)); }
      if (P.attack && this.engT) { this.engT.atSpot = true; this.why = 'ENGAGING ' + this.engT.kind; return this.fire(dt, this.mk(0, 0, 0)); }
      if (P.breach && this.breachT) { this.breachT.atSpot = true; this.why = 'BREACH: PLACING THE CHARGE'; return this.fire(dt, this.mk(0, 0, 0)); }
      if (P.hunt) { this.replanT = 0.5; this.why = 'HUNT: LOOKING FOR THE TARGET'; return this.fire(dt, this.mk(0.6, 0, 0)); }
      this.startScan(P.goal); return this.fire(dt, this.mk(0, 0, 0));
    }
    // --- laser grid ahead: timed crossing. Waiting for a gap is holding a position on purpose, so it is never "stuck".
    const gc = this.gateControl(dt);
    if (gc) { this.cmd = null; g.xroute = P.tiles; this._holdStuck(t); return this.fire(dt, gc); }
    // --- stuck: under 0.8 m of progress (and no real turn) in 1.2 s. The tile ahead is blocked, the rocket is nudged toward the open side and a new route is planned.
    const SK = this.stuck; SK.t += dt;
    if (SK.t > TUNE.stuckAfter) {
      if (Math.hypot(t.x - SK.x, t.y - SK.y, t.z - SK.z) < TUNE.stuckMinMove && Math.abs(wrapAngle(t.yaw - SK.yaw)) < TUNE.stuckTurn) {
        this._onStuck(P, t); this.plan = null; this.why = 'STUCK - NEW GOAL';
      }
      this._holdStuck(t);
      if (!this.plan) return this.mk(0, 0, 0);
    }
    // --- guidance: chase a look-ahead point; heading and altitude PD
    const L = Math.max(TUNE.lookMin, Math.min(TUNE.lookMax, TUNE.lookPerSpeed * t.speed + TUNE.lookBase));
    const cp = this.carrot(L), w = wps[P.k];
    const err = wrapAngle(Math.atan2(-(cp.x - t.x), -(cp.z - t.z)) - t.yaw);
    let yaw = (w.vert && Math.hypot(w.x - t.x, w.z - t.z) < 1.5) ? -TUNE.yawDamp * t.yawRate : TUNE.yawGain * err - TUNE.yawDamp * t.yawRate;   // straight up / down a hole: keep the heading
    let altT = w.alt;
    if (!w.vert) {                                                     // rise / sink gradually along the leg (no early climb into a lintel)
      const paX = P.k > 0 ? wps[P.k - 1].x : (P.x0 === undefined ? t.x : P.x0), paZ = P.k > 0 ? wps[P.k - 1].z : (P.z0 === undefined ? t.z : P.z0), paAlt = P.k > 0 ? wps[P.k - 1].alt : (P.alt0 === undefined ? t.y : P.alt0);
      if (P.x0 === undefined) { P.x0 = t.x; P.z0 = t.z; }
      const dTot = Math.hypot(w.x - paX, w.z - paZ), dLeft = Math.hypot(w.x - t.x, w.z - t.z);
      const fr = dTot > 0.5 ? Math.max(0, Math.min(1, 1 - dLeft / dTot)) : 1;
      altT = paAlt + (w.alt - paAlt) * fr;
      if (w.shaft && dLeft < TUNE.shaftLineUp) altT = w.alt;      // a tunnel mouth in the wall: climb / sink to it before going in
    }
    if (g.xgrid && t.node >= 0 && g.xgrid[t.node] === XV.RAMP) altT = g.autoNodeAlt(t.node);   // on a ramp: follow its slope
    altT = Math.max(t.y - t.agl + TUNE.roomMargin, Math.min(t.y + t.ceil - TUNE.roomMargin, altT));   // always inside the room
    const ph = this.pulseHeight(); if (ph !== null) altT = ph;                // a 3-line grid ahead: fly through at the gap height
    const climb = clamp1(TUNE.climbGain * (altT - t.y) - TUNE.climbDamp * t.vSpeed);
    // --- speed: can we still slow to each coming waypoint's limit with our measured braking? also the free distance ahead
    const a = Math.min(TUNE.brakeCap, TUNE.brakeFrac * t.brakeMax);
    const dWp = Math.hypot(w.x - t.x, w.z - t.z);
    let v = this._straightSpeed(t, w, err, dWp, ph), along = dWp;
    for (let n = P.k; n < Math.min(wps.length, P.k + 4); n++) {
      if (n > P.k) along += Math.hypot(wps[n].x - wps[n - 1].x, wps[n].z - wps[n - 1].z);
      v = Math.min(v, Math.sqrt(wps[n].vmax * wps[n].vmax + 2 * a * Math.max(0, along - 0.8)));
    }
    if (t.fan) v = Math.min(v, Math.max(t.fan[2] > 3 ? TUNE.crawlSpeed : 0, Math.sqrt(2 * a * Math.max(0, t.fanW - TUNE.fanMargin))));   // hull-wide clearance ahead; a clear centre line still allows a crawl
    v *= Math.max(TUNE.turnSpeedFloor, Math.min(1, 1 - Math.abs(err) / 1.0));
    if (w.keep && Math.abs(altT - t.y) > 0.5 && Math.hypot(w.x - t.x, w.z - t.z) < TUNE.shaftLineUp) v = Math.min(v, 0.5);   // line up with a tunnel mouth first
    if (w.vert && Math.hypot(w.x - t.x, w.z - t.z) < 1.5) v = Math.min(v, 0.3);                               // floor change: go straight up / down
    if (ph !== null && Math.abs(t.y - ph) > 0.3) { let lz = 99; for (let _i22 = 0, _a22 = g.lasers; _i22 < _a22.length; _i22++) { const l = _a22[_i22]; if (l.mode === 'PULSE_GATE' && !l.disabled) lz = Math.min(lz, Math.abs(t.z - l.z));
} if (lz < 3.5) v = Math.min(v, 0.8); }   // not at the gap height yet: ease in
    // --- safety: keep off the side walls
    if (t.probe.l < TUNE.wallMargin) yaw -= TUNE.wallGain * (TUNE.wallMargin - t.probe.l) / TUNE.wallMargin;       // wall on the left: turn right
    if (t.probe.r < TUNE.wallMargin) yaw += TUNE.wallGain * (TUNE.wallMargin - t.probe.r) / TUNE.wallMargin;
    { const gap = Math.min(t.probe.l, t.probe.r); if (gap < TUNE.wallMargin) v = Math.min(v, TUNE.wallSlowBase + TUNE.wallSlowGain * Math.max(0, gap - TUNE.wallSlowGap)); }   // close to a side wall: slow down
    { // shaft dash: hover only gets the rocket to the tunnel's height; then it flies on without it, and stays off past the exit while the way is clear
      const was = this.dash2;
      this.dash = !!(w.shaft && !w.vert && t.fan && t.fanW >= TUNE.dashClear && Math.abs(err) < (was ? TUNE.dashHoldErr : TUNE.dashErr) && Math.abs(w.alt - t.y) < (was ? TUNE.dashHoldAlt : TUNE.dashAltTol)) ||
        !!(was && !w.vert && t.fan && t.fanW >= TUNE.dashClear && Math.abs(err) < TUNE.dashHoldErr && Math.abs(w.alt - t.y) < TUNE.dashAltTol && !this.gate && ph === null);
      // ramp climb: on an ascending ramp leg, lined up, hover goes off so the nose pitches up the slope and the thrust carries the rocket up it;
      // hover comes back as soon as the rocket is off the ramp or has levelled out at the top
      const onRamp = g.xgrid && t.node >= 0 && g.xgrid[t.node] === XV.RAMP, wasR = this.ramp;
      this.ramp = !!(onRamp && !w.vert && !this.gate && ph === null && w.alt - t.y > (wasR ? TUNE.rampLevelOut : TUNE.rampMinRise) && Math.abs(err) < (wasR ? TUNE.rampHoldErr : TUNE.rampErr));
      if (this.ramp) {
        this.dash = true; this.dash2 = true;
        this.rampPitch = Math.max(0, Math.min(TUNE.rampPitchMax, Math.atan(TUNE.rampSlope) + TUNE.rampPitchGain * (altT - t.y)));
        // the forward fan is useless on a slope (its level rays hit the incline): the speed is bounded by what is left of the ramp instead
        let left = dWp;
        for (let n = P.k; n + 1 < wps.length && g.xgrid[wps[n + 1].i] === XV.RAMP; n++) left += Math.hypot(wps[n + 1].x - wps[n].x, wps[n + 1].z - wps[n].z);
        v = Math.max(v, Math.min(TUNE.rampSpeed, Math.sqrt(2 * a * (left + TUNE.rampCoast))));
      }
      this.dash2 = this.dash;
      if (this.dash && !this.ramp) v = Math.max(v, Math.min(TUNE.dashSpeed, Math.sqrt(2 * a * Math.max(0, t.fanW - TUNE.fanMargin))));
    }
    out = this.avoid(this.mk(clamp1(yaw), climb, Math.max(0, v)));
    if (this._nudgeT > 0) {                                            // after a stall: a short push toward the open side and the roomier height
      this._nudgeT -= dt;
      out.yaw = clamp1(out.yaw + this._nudgeYaw); out.climb = clamp1(out.climb + this._nudgeClimb);
      out.speed = Math.max(out.speed, Math.min(TUNE.stuckNudgeSpeed, t.fan ? t.fan[2] * 0.3 : 0));
    }
    const C = this._cmdS; C.err = err; C.v = v; C.L = L; this.cmd = C;
    g.xroute = P.tiles;
    return this.fire(dt, out);
  }


  // Generic route search to the nearest tile accepted by `isGoal` (same costs as the frontier search). Returns tiles or null.
  // The distance / parent / heap buffers are the shared scratch; the search state lives in this._pX / this._pHZ (no closures).
  pathTo(start, isGoal, maxCost) {
    const goal = this.pathGoal(start, isGoal, maxCost);
    return goal < 0 ? null : this.tilesTo(goal, start);
  }

  tileOf(pos) { const c = this.g.cellAt(pos.x, pos.z); if (c < 0) return -1; return Math.max(0, Math.min(this.g.nFloors - 1, this.g.floorOfY(pos.y))) * GRID_SIZE * GRID_SIZE + c; }


  // =====================================================================================================
  // MISSION LADDER (once a second, game clock). Emergencies first, then a strict 7-tier order: the highest tier with a
  // reachable task wins; a running task keeps going while it is valid and nothing above it has work. No allocation here
  // while nothing changes: the searches return only a goal tile (pathGoal) and fill reused maps.
  //   emergency  rockets / hull nearly gone -> HUNT · fuel low -> fetch a seen repair kit (the keep-clear rule is in steer)
  //   1 EXPLORE       reachable frontier left and the scan is not complete
  //   2 LASER_SWITCH  a known live switch box (one in thermal sight right now goes first, even before tier 1)
  //   3 ENGAGE        known CIWS turrets and sentries, from a firing spot with a clear line
  //   4 CLEAR_BARREL  known fuel barrels, shot from outside the blast of their whole chain cluster
  //   5 PICKUP        useful pickups that were seen
  //   6 BREACH        seen cracked walls (only with a rocket reserve left for tier 7)
  //   7 HUNT          the primary targets
  // =====================================================================================================
  decide() {
    const g = this.g, t = this.t, cur = this.mission;
    let nActive = 0;
    for (let i = 0; i < g.targets.length; i++) if (g.targets[i].active) nActive++;
    // a wall was blown open (breach charge, barrel, warhead): there is new ground behind it, go and look
    const walls = (g.shortcutsOpened || 0) + (g.secretsFound || 0);
    if (walls !== this._wallsSeen) { if (this._wallsSeen !== undefined) { this.noFrontier = false; this.failN = 0; this.done = false; } this._wallsSeen = walls; }
    const scanDone = g.scanPercent() >= 100, C = this._cand;
    let next = 'EXPLORE', obj = null, kind = '', energy = false;
    if (nActive > 0 && (t.rockets <= TUNE.huntRocketFloor || t.hull < TUNE.huntHullFloor)) next = 'HUNT';                                  // emergency
    else if (cur === 'PICKUP' && this.pickEnergy && this.pickObj && this.pickObj.active && this.lowEnergy(t)) { next = 'PICKUP'; obj = this.pickObj; energy = true; }
    else if (this.lowEnergy(t) && this._findPickup(true)) { next = 'PICKUP'; obj = C.obj; energy = true; }                               // emergency: fuel
    else if (cur === 'LASER_SWITCH' && this._boxLive(this.boxLaser)) { next = cur; obj = this.boxLaser; }
    else if (this._findLaserBox(true, null) >= 0) { next = 'LASER_SWITCH'; obj = C.obj; }                                                 // tier 2: in sight now
    else if (!this.noFrontier && !scanDone) next = 'EXPLORE';                                                                              // tier 1
    else if (this._findLaserBox(false, null) >= 0) { next = 'LASER_SWITCH'; obj = C.obj; }                                                // tier 2
    else if (cur === 'ENGAGE' && this._attackValid()) { next = cur; obj = this.engT.tu; kind = this.engT.kind; }
    else if (this._findAttack('ENGAGE')) { next = 'ENGAGE'; obj = C.obj; kind = C.kind; }                                                  // tier 3
    else if (cur === 'CLEAR_BARREL' && this._attackValid()) { next = cur; obj = this.engT.tu; kind = 'BARREL'; }
    else if (this._findAttack('CLEAR_BARREL')) { next = 'CLEAR_BARREL'; obj = C.obj; kind = 'BARREL'; }                                    // tier 4
    else if (cur === 'PICKUP' && !this.pickEnergy && this.pickObj && this.pickObj.active && !this.pickTried.has(this.pickObj)) { next = cur; obj = this.pickObj; }
    else if (this._findPickup(false)) { next = 'PICKUP'; obj = C.obj; }                                                                    // tier 5
    else if (cur === 'BREACH' && this.breachT && this.breachT.bw.active && t.time - this.breachT.t0 < TUNE.breachMax) { next = cur; obj = this.breachT.bw; }
    else if (t.rockets >= TUNE.breachMinRockets && t.hull >= TUNE.huntHullFloor && this._findBreach()) { next = 'BREACH'; obj = C.obj; }  // tier 6
    else if (nActive > 0) next = 'HUNT';                                                                                                   // tier 7
    const prevObj = cur === 'PICKUP' ? this.pickObj : (cur === 'LASER_SWITCH' ? this.boxLaser : ((cur === 'ENGAGE' || cur === 'CLEAR_BARREL') && this.engT ? this.engT.tu : (cur === 'BREACH' && this.breachT ? this.breachT.bw : null)));
    if (next === cur && obj === prevObj) return;
    if (next !== cur || (next === 'PICKUP' && energy !== this.pickEnergy)) g.pushFeed(this._missionMsg(next, kind, obj, energy), 'cyan');
    if (next === 'PICKUP') { this.pickObj = obj; this.pickEnergy = energy; }
    else if (next === 'LASER_SWITCH') { this.boxLaser = obj; this.boxGoal = obj; this.boxWait = null; }
    else if (next === 'ENGAGE' || next === 'CLEAR_BARREL') this.engT = { tu: obj, kind, t0: t.time, atSpot: false, spotT: 0 };
    else if (next === 'BREACH') this.breachT = { bw: obj, t0: t.time, atSpot: false, spotT: 0 };
    if (next !== 'LASER_SWITCH' && cur === 'LASER_SWITCH') { this.boxGoal = null; this.boxLaser = null; this.boxWait = null; }
    if (next !== 'ENGAGE' && next !== 'CLEAR_BARREL') this.engT = null;
    this.mission = next; this.plan = null; this.scan = null; this.replanT = 0;
  }

  // Route to a tile next to the nearest primary target (its own tile is no-go)
  newHuntPlan() {
    const g = this.g, t = this.t, G = GRID_SIZE, GG = G * G;
    const goals = new Set();
    for (const tg of g.targets) {
      if (!tg.active) continue;
      const i = this.tileOf(tg.pos); if (i < 0) continue;
      const c = i % GG, x = c % G, z = (c / G) | 0, f0 = i - c;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { if (!dx && !dz) continue; const xx = x + dx, zz = z + dz; if (xx >= 0 && zz >= 0 && xx < G && zz < G) goals.add(f0 + zz * G + xx); }
    }
    const tiles = this.pathTo(t.node, (i) => goals.has(i));
    if (!tiles) { this.huntNoRoute = true; this.plan = null; this.why = 'NO ROUTE TO A TARGET YET'; this.mission = 'EXPLORE'; this.noFrontier = false; this.huntBlockT = t.time + 15; return; }
    if (!tiles.length) { this.plan = null; this.why = 'AT THE TARGET'; return; }
    this.huntNoRoute = false;
    this.plan = { goal: tiles[tiles.length - 1], tiles, wps: this.smooth(tiles), k: 0, t0: t.time, alt0: t.y, hunt: true };
    g.xroute = tiles.slice(); this.why = 'ROUTE TO A PRIMARY TARGET';
  }

  newPickupPlan() {
    const p = this.pickObj, t = this.t;
    if (!p || !p.active) { this.mission = 'EXPLORE'; this.plan = null; return; }
    if (t.node < 0) { this.plan = null; this.replanT = 0.5; this.why = 'NO POSITION FIX'; return; }
    // a fresh route from where the rocket is now
    const goal = this.tileOf(p.pos), goals = this._pickGoals;
    goals.clear(); if (goal >= 0) goals.set(goal, p);
    const tiles = goal >= 0 ? this.pathTo(t.node, this._goalPick) : null;
    if (!tiles) { this.pickTried.add(p); this.mission = 'EXPLORE'; this.plan = null; this.why = 'PICKUP OUT OF REACH'; return; }
    if (!tiles.length) { if (p.type === 'DOCK') { this.dockHold = { pk: p, t: 0 }; this.plan = null; return; } this.pickTried.add(p); this.mission = 'EXPLORE'; this.plan = null; return; }
    this.plan = { goal: tiles[tiles.length - 1], tiles, wps: this.smooth(tiles), k: 0, t0: t.time, alt0: t.y, pickup: p };
    this.g.xroute = tiles.slice(); this.why = 'ROUTE TO A PICKUP';
  }

  // Terminal phase of a hunt: once a primary target is in clear thermal sight and lock range, turn until it is inside the seeker
  // cone, lock on with the game's lock system and let homing fly the warhead into the proximity fuze. Returns flight commands or null.
  huntTerminal() {
    const g = this.g, t = this.t, m = g.missile, TP = g.lidarParams(true);
    let tg = null, td = Infinity;
    for (let _i26 = 0, _a26 = g.targets; _i26 < _a26.length; _i26++) { const x = _a26[_i26]; if (x.active) { const d = m.pos.distanceTo(x.pos); if (d < td) { td = d; tg = x; } }
    }
    if (!tg || td > TP.lockRange || !tg.mesh.userData._tv || !g.los3(t.x, t.y, t.z, tg.pos.x, tg.pos.y, tg.pos.z)) return null;
    const brg = wrapAngle(Math.atan2(-(tg.pos.x - t.x), -(tg.pos.z - t.z)) - t.yaw);
    const cone = TP.seekerDeg * Math.PI / 180 * 0.8;
    const climb = clamp1(1.4 * (tg.pos.y - t.y));
    if (!(g.manualTargetLock && g.lockedEnemy && g.lockedEnemy.ref === tg)) {
      if (Math.abs(brg) > cone) { this.why = 'HUNT: TURNING ONTO THE TARGET'; return this.mk(clamp1(3 * brg - TUNE.yawDamp * t.yawRate), climb, 0.5); }
      g.lockedEnemy = null; g.manualTargetLock = false;
      const cand = g.findBestEnemyTarget();
      if (cand && cand.ref === tg) g.toggleTargetLock(); else return this.mk(clamp1(3 * brg), climb, 0.5);
    }
    this.why = 'HUNT: LOCKED - WARHEAD RUN';
    const o = this.mk(0, climb, Math.min(t.cruise, Math.max(3, td))); o.homing = true;   // homing steers; the fuze fires at 5 units
    return o;
  }

  // ---- Last gasp. Under lastGaspSec of burn left and no repair kit in reach: run at the nearest known score (fuel barrel, CIWS turret,
  // sentry, cracked wall) and set the pulse off before the tank runs dry, instead of stalling mid-corridor. Targets whose blast would
  // reach a primary target are skipped (that would end the sector). Returns flight commands, or null when it does not apply.
  lastGaspSteer(dt, t) {
    const g = this.g, m = g.missile;
    if (!(t.burn > 0 && t.rangeSec < TUNE.lastGaspSec) || (this.mission === 'PICKUP' && this.pickEnergy)) { this.lastGasp = false; this._lgObj = null; return null; }
    this._lgT -= dt;
    if (this._lgT <= 0 || (this.lastGasp && !this._lgAlive())) {
      this._lgT = TUNE.lastGaspEvery;
      const was = this.lastGasp; this._lgPick(t);
      if (this.lastGasp && !was) g.pushFeed(`AUTOPILOT: FUEL NEARLY OUT — LAST RUN AT ${this._lgKind}`, 'amber');
    }
    if (!this.lastGasp) return null;
    const x = this._lgX, y = this._lgY, z = this._lgZ, dx = x - t.x, dy = y - t.y, dz = z - t.z, d = Math.hypot(dx, dy, dz);
    const brg = wrapAngle(Math.atan2(-dx, -dz) - t.yaw), wall = this._lgKind === 'CRACKED WALL';
    this.why = LG_WHY[this._lgKind];
    const reach = wall ? 0.6 * g.blastRadiusBase() + 2.4 - TUNE.breachReachMargin : TUNE.lastGaspPulse;
    if (d <= reach && (wall ? Math.abs(brg) < 0.8 : g.fuzeNear(m.pos, x, y, z, d, false))) { this.pulseFire = true; return this.mk(0, 0, 0); }
    const a = Math.min(TUNE.brakeCap, TUNE.brakeFrac * t.brakeMax);
    let v = TUNE.lastGaspSpeed;
    if (Math.abs(brg) > 1.0) v = 1.5; else if (Math.abs(brg) > 0.5) v = 3;      // turn onto it first, but do not stall
    else if (t.fan && t.fanW < d - 1) v = Math.min(v, Math.max(TUNE.crawlSpeed, Math.sqrt(2 * a * Math.max(0, t.fanW - TUNE.fanMargin))));   // a wall behind the target is no reason to slow down: the pulse goes off short of it
    const yT = Math.max(t.y - t.agl + TUNE.roomMargin, Math.min(t.y + t.ceil - TUNE.roomMargin, y));
    return this.mk(clamp1(3 * brg - TUNE.yawDamp * t.yawRate), clamp1(1.6 * (yT - t.y)), v);
  }

  _lgAlive() { const o = this._lgObj; return !!(o && o.active && !o.dying); }

  // nearest candidate within what the remaining burn can reach, with a clear line and clear of the primary targets' blast
  _lgPick(t) {
    const g = this.g, X = g.xgrid;
    this.lastGasp = false; this._lgObj = null;
    if (this._findPickup(true)) return;                                  // a repair kit is in reach: the mission ladder fetches it
    const reachM = t.rangeSec * TUNE.lastGaspReachSpeed + TUNE.lastGaspPulse, safe = g.blastRadiusBase() + TUNE.lastGaspPrimaryGap;
    this._lgBest = Infinity;
    for (let i = 0; i < this.knownBarrels.length; i++) { const b = this.knownBarrels[i]; if (b.active) this._lgTry('FUEL BARREL', b, b.pos.x, b.pos.y, b.pos.z, t, reachM, safe); }
    for (let i = 0; i < this.knownList.length; i++) { const tu = this.knownList[i]; if (tu.active) this._lgTry('CIWS TURRET', tu, tu.pos.x, tu.pos.y, tu.pos.z, t, reachM, safe); }
    for (let i = 0; i < this.knownSentries.length; i++) { const s = this.knownSentries[i]; if (s.active && !s.dying) this._lgTry('SENTRY', s, s.pos.x, s.pos.y + 1.2, s.pos.z, t, reachM, safe); }
    if (X && g.breakables) for (let i = 0; i < g.breakables.length; i++) { const bw = g.breakables[i]; if (bw.active && X[bw.gz * GRID_SIZE + bw.gx] === XV.CRACK) this._lgTry('CRACKED WALL', bw, bw.pos.x, bw.pos.y, bw.pos.z, t, reachM, safe); }
    this.lastGasp = this._lgObj !== null;
  }

  _lgTry(kind, obj, x, y, z, t, reachM, safe) {
    const g = this.g, dx = x - t.x, dy = y - t.y, dz = z - t.z, d = Math.hypot(dx, dy, dz);
    if (d >= this._lgBest || d > reachM) return;
    const turnT = Math.max(0, Math.abs(wrapAngle(Math.atan2(-dx, -dz) - t.yaw)) - 0.5) / TUNE.lastGaspTurnRate;   // time to swing onto it, then to cover the distance
    if (turnT + Math.max(0, d - TUNE.lastGaspPulse) / (TUNE.lastGaspSpeed * 0.7) > t.rangeSec) return;                // cannot get there before the fuel is gone
    for (let i = 0; i < g.targets.length; i++) { const tg = g.targets[i]; if (tg.active && Math.hypot(tg.pos.x - x, tg.pos.y - y, tg.pos.z - z) < safe) return; }
    const k = kind === 'CRACKED WALL' && d > 0 ? Math.max(0, d - 1.8) / d : 1;     // a wall is solid: look at the face, not its middle
    if (!g.los3(t.x, t.y, t.z, t.x + dx * k, t.y + dy * k, t.z + dz * k)) return;
    this._lgBest = d; this._lgObj = obj; this._lgKind = kind; this._lgX = x; this._lgY = y; this._lgZ = z;
  }

  // After a hand-over: look again every 5 s; if new frontier appeared (a grid went down, a door opened), take back control
  recheck(dt) {
    this._reT = (this._reT || 0) - dt;
    if (this._reT > 0 || !this.t || this.t.node < 0) return;
    this._reT = 5;
    const p = this.planFrontier(this.t.node);
    if (p && p.tiles.length) { this.done = false; this.noFrontier = false; this.failN = 0; if (this.mission === 'HUNT') this.mission = 'EXPLORE'; this.plan = null; this.replanT = 0; this.why = 'NEW FRONTIER - RESUMING'; }
  }


  // =====================================================================================================
  // THREATS AND EVASION. Enemy bolts are aimed at where the rocket is now (no lead), fly ~78 m/s and one hit is fatal,
  // so the answer is never to sit still while exposed and to keep moving across the line of fire.
  // =====================================================================================================
  // Fills the pooled this._thr records; returns how many threats there are
  threats() {
    const g = this.g, t = this.t; let n = 0;
    const range = turretRange(g.difficultyTier);
    for (let _i27 = 0, _a27 = this.knownList; _i27 < _a27.length; _i27++) { const tu = _a27[_i27]; if (!tu.active) continue;
      const d = Math.hypot(tu.pos.x - t.x, tu.pos.y - t.y, tu.pos.z - t.z);
      if (d < range && g.los3(tu.pos.x, tu.pos.y, tu.pos.z, t.x, t.y, t.z)) n = this._pushThreat(n, 'CIWS', tu, tu.pos.x, tu.pos.y, tu.pos.z, d);
    }
    for (let _i28 = 0, _a28 = g.sentries; _i28 < _a28.length; _i28++) { const s = _a28[_i28]; if (!s.active || s.dying || !s.alerted) continue;
      const d = Math.hypot(s.pos.x - t.x, s.pos.z - t.z);
      if (d < TUNE.sentryThreatRange && g.los3(s.pos.x, s.pos.y + 1.45, s.pos.z, t.x, t.y, t.z)) n = this._pushThreat(n, 'SENTRY', s, s.pos.x, s.pos.y + 1.45, s.pos.z, d);
    }
    this._thrN = n;
    return n;
  }

  // Applied on top of the flight commands while exposed: keep moving (min 4.5 m/s unless a wall is close or we are lined up
  // and firing), weave the heading when flying straight at / away from a shooter, and bob the altitude (shooting: bob only).
  evade(out, firing) {
    const g = this.g, t = this.t, nTh = this.threats(), TH = this._thr;
    this.exposed = nTh > 0;
    if (!this.exposed) return out;
    if (!this._evMsgT || t.time - this._evMsgT > 8) { this._evMsgT = t.time; g.pushFeed(`AUTOPILOT: UNDER FIRE (${TH[0].kind}) — EVADING`, 'amber'); }
    const ph = t.time;
    // vertical bob, inside the room's floor / ceiling margins (smaller while firing so the aim holds)
    const room = this.nearAnyBeam() ? 0 : Math.max(0, Math.min(t.agl - 0.9, t.ceil - 0.9));   // no bobbing near laser beams
    const amp = firing ? TUNE.evadeBobAmpFiring : TUNE.evadeBobAmp;
    if (room > 0.2) out.climb = clamp1(out.climb + amp * Math.min(1, room / 1.2) * Math.sin(ph * TUNE.evadeBobRate));
    if (firing) return out;
    // heading weave when the nearest shooter is roughly ahead or behind (radial flight barely moves across its line of fire)
    let th = TH[0]; for (let i = 1; i < nTh; i++) if (!(th.d < TH[i].d)) th = TH[i];
    const brg = wrapAngle(Math.atan2(-(th.x - t.x), -(th.z - t.z)) - t.yaw);
    const radial = Math.abs(brg) < 0.7 || Math.abs(brg) > Math.PI - 0.7;
    if (radial && Math.min(t.probe.l, t.probe.r) > 1.4) out.yaw = clamp1(out.yaw + TUNE.evadeWeaveAmp * Math.sin(ph * TUNE.evadeWeaveRate));
    // never hover still under fire, unless a wall is close ahead
    const room2 = t.fanW === undefined ? 30 : t.fanW;
    const turning = this.cmd && Math.abs(this.cmd.err) > 0.6;
    const nearBeam = this._beamNear(4, 1);
    if (room2 > 4 && !this.scan && !turning && !nearBeam) out.speed = Math.max(out.speed, Math.min(TUNE.evadeMinSpeed, Math.sqrt(2 * 6 * Math.max(0, room2 - 2.5))));
    return out;
  }


  // Fire control on top of the flight commands (step 3)
  fire(dt, out) {
    out = this.fireControl(dt, out);
    const hold = !!(this.gate || this.boxWait || this.scan || (this.engT && this.engT.atSpot));   // holding a position on purpose: bob only
    out = this.evade(out, !!(this.shot && this.shot.onTarget) || hold);
    return this.laserGuard(this.smoothCmd(dt, out));
  }

  // Last word on every command near a 3-line grid: hold the gap height firmly (also while braking hard),
  // and never move into the beam plane until that height is reached. Edits the smoothed command in place.
  laserGuard(out) {
    const g = this.g, t = this.t;
    if (out.homing || !t || t.floor !== 0) return out;
    const fz = -Math.cos(t.yaw);
    for (let _i30 = 0, _a30 = g.lasers; _i30 < _a30.length; _i30++) { const l = _a30[_i30]; if (l.disabled || l.mode !== 'PULSE_GATE') continue;
      const dz = t.z - l.z;
      if (Math.abs(dz) > 5 || t.x < l.xMin - 1.5 || t.x > l.xMax + 1.5 || !this._pulseInWay(l, t)) continue;
      const ph = Math.max(t.y - t.agl + 0.6, Math.min(t.y + t.ceil - 0.6, 2.55));
      out.climb = clamp1(2.2 * (ph - t.y) - 0.35 * t.vSpeed);
      if (Math.abs(t.y - ph) > 0.3 && Math.abs(dz) < 2.2 && Math.sign(dz) * fz < 0) out.speed = 0;   // heading into the plane off-height: wait for the climb
    }
    return out;
  }

  // Feel: rate-limit the stick and speed so the rocket flies smoothly instead of twitching between commands
  smoothCmd(dt, out) {
    const P = this._prevCmd;
    if (this.gate) { P.yaw = out.yaw; P.climb = out.climb; P.speed = out.speed; this._prevOn = true; return out; }   // laser gates: exact, unsmoothed commands
    if (!this._prevOn) { P.yaw = 0; P.climb = 0; P.speed = out.speed; }
    const o = this._res;
    o.yaw = lim(P.yaw, out.yaw, TUNE.yawSlew * dt); o.climb = lim(P.climb, out.climb, TUNE.climbSlew * dt);
    o.speed = out.speed < P.speed ? out.speed : lim(P.speed, out.speed, TUNE.accelSlew * dt);   // braking is never delayed
    o.homing = !!out.homing;
    P.yaw = o.yaw; P.climb = o.climb; P.speed = o.speed; this._prevOn = true;
    return o;
  }

  // =====================================================================================================
  // STEP 3: target acquisition and fire control (bracketed contacts only: sentries, CIWS turrets, laser switch boxes)
  // =====================================================================================================
  // Tracks: one per bracketed contact, with a smoothed velocity estimate and a lock that confirms after 6 frames in view.
  // Track objects are pooled; this._tl is the ordered list, this.tracks the lookup by contact object.
  updateTracks(dt) {
    const t = this.t, now = t.time, C = t.contacts, M = this.tracks, TL = this._tl;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      let k = M.get(c.obj);
      if (!k) {
        k = this._trackPool.pop() || {};
        k.obj = c.obj; k.kind = c.kind; k.x = c.x; k.y = c.y; k.z = c.z; k.vx = 0; k.vz = 0; k.seen = 0; k.first = now; k.d = c.d; k.threat = c.threat; k.last = now;
        M.set(c.obj, k); TL.push(k);
      }
      const a = Math.min(1, dt * TUNE.trackAlpha);
      if (dt > 0) { k.vx += ((c.x - k.x) / dt - k.vx) * a; k.vz += ((c.z - k.z) / dt - k.vz) * a; }
      k.x = c.x; k.y = c.y; k.z = c.z; k.d = c.d; k.threat = c.threat; k.last = now; k.seen++;
    }
    for (let i = 0; i < TL.length;) {
      const k = TL[i], o = k.obj;
      if (now - k.last > 1.5 || (o.active === false) || (o.dying) || (k.kind === 'LASER BOX' && o.disabled)) { this._dropTrack(i); } else i++;
    }
  }

  // Would a bullet fired now pass close to a fuel barrel that is near enough to us for its blast (9 m) to reach us?
  barrelInLine(tx, ty, tz) {
    const t = this.t, g = this.g, dx = tx - t.x, dy = ty - t.y, dz = tz - t.z, L = Math.hypot(dx, dy, dz) || 1;
    for (const b of g.barrels) {
      if (!b.active) continue;
      const bx = b.pos.x - t.x, by = b.pos.y - t.y, bz = b.pos.z - t.z;
      const along = (bx * dx + by * dy + bz * dz) / L;
      if (along < 0 || along > L + 1) continue;
      const off = Math.hypot(bx - dx / L * along, by - dy / L * along, bz - dz / L * along);
      if (off < 1.4 && Math.hypot(bx, by, bz) < 11.5) return true;
    }
    return false;
  }

  // Choose the target, compute the lead, steer onto it and pull the trigger only when the predicted miss is inside the hit area.
  // Targets are ranked by mission tier (laser box 2, turret / sentry 3, barrel 4), then the current goal, threats, distance and
  // bearing. A barrel is only shot as the CLEAR_BARREL goal, from where its whole chain cluster cannot reach the rocket.
  fireControl(dt, out) {
    const g = this.g, t = this.t;
    this.updateTracks(dt);
    if (!this.ignoreUntil) this.ignoreUntil = new Map();
    const F = this.fc || (this.fc = { tgt: null, since: 0, burst: 0, pause: 0 });
    g.gunHeld = false; this.shot = null;
    if (g.gunAmmo <= 0 || g.missile.drop > 0) { F.tgt = null; return out; }
    let best = null, bestS = -1e9;
    const TL = this._tl, goalObj = this.engT ? this.engT.tu : null;
    for (let i = 0; i < TL.length; i++) {
      const k = TL[i], sp = FIRE_SPEC[k.kind]; if (!sp || k.seen < TUNE.lockFramesMin || k.d > sp.range) continue;
      if ((this.ignoreUntil.get(k.obj) || 0) > t.time) continue;
      if (k.kind === 'BARREL') {
        if (this.mission !== 'CLEAR_BARREL' || goalObj !== k.obj) continue;
        this._barrelCluster(k.obj);
        if (!this._clusterClear(t.x, t.y, t.z, this._barrelSafeDist())) continue;
      } else if (k.kind !== 'CIWS' && !k.threat && g.gunAmmo <= TUNE.reserveRounds) continue;      // keep a few rounds for threats
      const brg = wrapAngle(Math.atan2(-(k.x - t.x), -(k.z - t.z)) - t.yaw);
      const goal = this.boxGoal === k.obj || goalObj === k.obj;
      const sc = (10 - FIRE_TIER[k.kind]) * 100 + (goal ? 50 : 0) + (k.threat ? 20 : 0) - k.d * 0.4 - Math.abs(brg) * 3 + (F.tgt === k ? 6 : 0);
      if (sc > bestS) { bestS = sc; best = k; }
    }
    if (!best) { F.tgt = null; return out; }
    if (F.tgt !== best) { F.tgt = best; F.since = t.time; F.burst = 0; F.pause = 0; }
    if (t.time - F.since > TUNE.giveUpAfter) { this.ignoreUntil.set(best.obj, t.time + TUNE.ignoreFor); F.tgt = null; return out; }   // no kill in 6 s: give up for 20 s
    const sp = FIRE_SPEC[best.kind];
    // lead: bullet time of flight at 120 m/s plus our own speed; aim at where a moving sentry will be
    const tof = best.d / (GUN_SPEED + t.speed);
    const ax = best.x + best.vx * tof, az = best.z + best.vz * tof;
    const yawErr = wrapAngle(Math.atan2(-(ax - t.x), -(az - t.z)) - t.yaw);
    // altitude: the gun fires level from the nose, so match the target's hit height (within the room's floor / ceiling)
    const aimY = Math.max(t.y - t.agl + 1.0, Math.min(t.y + t.ceil - 0.8, best.y));
    out.yaw = clamp1(TUNE.aimYawGain * yawErr - TUNE.yawDamp * t.yawRate);
    out.climb = clamp1(TUNE.aimClimbGain * (aimY - t.y) - TUNE.climbDamp * t.vSpeed);
    out.speed = Math.min(out.speed, TUNE.aimSpeedCap);
    // predicted miss: sideways (from the heading error) and vertical against the height we can actually reach
    const latMiss = Math.abs(Math.sin(yawErr)) * best.d, vertMiss = Math.abs(t.y - aimY);
    // strict direct line of sight: from the rocket to the predicted aim point AND to the contact itself, and no barrel in the way. A contact
    // seen only through a wall (thermal / penetration sensors, _tv) is never shot at.
    const aimPX = ax, aimPY = best.y, aimPZ = az;
    const clearShot = g.los3(t.x, t.y, t.z, aimPX, aimPY, aimPZ) && g.los3(t.x, t.y, t.z, best.x, best.y, best.z) && !this.barrelInLine(aimPX, aimPY, aimPZ);
    const onTarget = latMiss < sp.hitR * TUNE.hitFrac && vertMiss < sp.vert;
    F.pause = Math.max(0, F.pause - dt);
    let fire = false;
    if (onTarget && clearShot && F.pause <= 0) { fire = true; F.burst += dt * GUN_RATE; if (F.burst >= sp.need + TUNE.burstExtra) { F.burst = 0; F.pause = TUNE.burstPause; } }
    g.gunHeld = fire;
    const S = this._shot;
    S.kind = best.kind; S.d = best.d; S.lead = Math.hypot(ax - best.x, az - best.z); S.latMiss = latMiss; S.vertMiss = vertMiss;
    S.onTarget = onTarget; S.clearShot = clearShot; S.fire = fire; S.lockFrames = best.seen;
    this.shot = S;
    return out;
  }



  // Debug panel text (Dev Override: Autopilot Debug)
  debugText() {
    const t = this.t;
    if (!t) return 'AUTOPILOT DEBUG\nno rocket in flight';
    const f1 = (v) => (v === Infinity ? 'inf' : v.toFixed(1)), f0 = (v) => (v === Infinity ? 'inf' : Math.round(v));
    const c = t.contacts.slice(0, 3).map((k) => `${k.kind} ${f0(k.d)}m ${f0(k.brg * 180 / Math.PI)}deg${k.threat ? ' !' : ''}`).join(' | ') || '-';
    return [
      `AUTOPILOT DEBUG   ${t.mode}${t.hover ? ' HOVER' : ''}${t.landed ? ' LANDED' : ''}`,
      `POS ${f1(t.x)} ${f1(t.y)} ${f1(t.z)}  F${t.floor + 1} TILE ${t.tileX},${t.tileZ}`,
      `AGL ${f1(t.agl)}  CEIL ${f1(t.ceil)}  HDG ${f0(t.heading)}  PITCH ${f0(t.pitch * 180 / Math.PI)}`,
      `SPD ${f1(t.speed)} (H ${f1(t.hSpeed)} V ${f1(t.vSpeed)})  ACC ${f1(t.acc)}  YAWR ${f1(t.yawRate)}`,
      `BRAKE MAX ${f1(t.brakeMax)} m/s2  TURN MAX ${f1(t.turnMax)} rad/s  STOP ${f1(t.stopDist)} m`,
      `PROBE L ${f1(t.probe.l)} R ${f1(t.probe.r)} U ${f1(t.probe.u)} D ${f1(t.probe.d)}`,
      `FAN ${this.FAN.map((d, i) => `${d}:${f0(t.fan[i])}`).join(' ')}`,
      `FUEL ${f0(t.fuel)}%  BURN ${t.burn.toFixed(2)}%/s  RANGE ${f0(t.rangeSec)}s ${f0(t.rangeM)}m  @CRUISE ${f0(t.rangeCruiseM)}m`,
      `HULL ${f0(t.hull)}  AMMO ${t.ammo}  ROCKETS ${t.rockets}  ROUTE ${t.route}`,
      `CONTACTS ${t.contacts.length} (THREATS ${t.threats}): ${c}`,
      this.active && this.shot ? `FIRE: ${this.shot.kind} ${this.shot.d.toFixed(0)}m LOCK ${this.shot.lockFrames}f LEAD ${this.shot.lead.toFixed(1)}m MISS ${this.shot.latMiss.toFixed(2)}/${this.shot.vertMiss.toFixed(2)}${this.shot.onTarget ? ' ON' : ''}${this.shot.clearShot ? '' : ' BLOCKED'}${this.shot.fire ? ' FIRING' : ''}` : 'FIRE: no target',
      this.active ? `PILOT [${this.mission}${this.noFrontier ? ' NO-FRONTIER' : ''}${this.exposed ? ' UNDER FIRE' : ''}]: ${this.why}${this.plan ? `  GOAL ${this.tileCenter(this.plan.goal).x.toFixed(0)},${this.tileCenter(this.plan.goal).z.toFixed(0)}  TILES ${this.plan.tiles.length}  LEG ${this.plan.k + 1}/${this.plan.wps.length}` : ''}${this.cmd ? `  ERR ${Math.round(this.cmd.err * 180 / Math.PI)}deg  VDES ${this.cmd.v.toFixed(1)}  LOOK ${this.cmd.L.toFixed(1)}m` : ''}${this.scan ? '  SCANNING' : ''}` : 'PILOT: off'
    ].join('\n');
  }

  // Add one bracketed contact to this snapshot's list (pooled objects, no allocation once the pool has grown)
  _addC(kind, obj, x, y, z, threat) {
    const m = this.g.missile, C = this._contacts, n = C.length;
    const c = this._cpool[n] || (this._cpool[n] = { kind: '', obj: null, x: 0, y: 0, z: 0, d: 0, brg: 0, dy: 0, threat: false });
    const dx = x - m.pos.x, dy = y - m.pos.y, dz = z - m.pos.z;
    c.kind = kind; c.obj = obj; c.x = x; c.y = y; c.z = z; c.dy = dy; c.threat = threat;
    c.d = Math.hypot(dx, dy, dz);
    c.brg = wrapAngle(Math.atan2(-dx, -dz) - m.yaw);
    C.push(c);
  }

  // The pilot is holding a position on purpose (laser gate, scan, switch box, turret spot): that is not being stuck
  _holdStuck(t) { const S = this.stuck; S.t = 0; S.x = t.x; S.y = t.y; S.z = t.z; S.yaw = t.yaw; }

  // No progress on plan P: block the tile ahead for a while, set up the clearance nudge, drop what the plan was going for.
  // A pickup is given up after a few tries (a frontier tile at once, as before).
  _onStuck(P, t) {
    const tiles = P.tiles; let at = -1;
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === t.node) { at = i; break; }
    const ahead = at >= 0 ? at + 1 : Math.min(1, tiles.length - 1);
    if (ahead >= 0 && ahead < tiles.length - 1 && tiles[ahead] !== t.node) { this.blocked.set(tiles[ahead], t.time + TUNE.stuckBlockFor); this._hz = null; }   // never the goal itself (tried handles that)
    this._nudgeT = TUNE.stuckNudgeFor;
    this._nudgeYaw = (t.probe.l >= t.probe.r ? 1 : -1) * TUNE.stuckNudgeYaw;       // positive yaw turns left
    this._nudgeClimb = (t.ceil >= t.agl ? 1 : -1) * TUNE.stuckNudgeClimb;
    if (P.pickup) {
      const n = (this.pickStuck.get(P.pickup) || 0) + 1; this.pickStuck.set(P.pickup, n);
      if (n >= TUNE.pickupStuckMax) { this.pickTried.add(P.pickup); this.mission = 'EXPLORE'; this.pickObj = null; }
      return;
    }
    this.tried.add(P.goal);
  }

  // The reused command struct: every steer() result is written here
  mk(yaw, climb, speed) { const o = this._w; o.yaw = yaw; o.climb = climb; o.speed = speed; o.homing = false; return o; }

  // mark every tile within r (+ half a cell) of (x, z) on floor f in layer L
  _disc(L, x, z, r, f) {
    const G = GRID_SIZE, GG = G * G;
    const g0 = worldToGridX(x - r - 2), g1 = worldToGridX(x + r + 2), z0 = worldToGridZ(z - r - 2), z1 = worldToGridZ(z + r + 2);
    for (let gz = Math.max(0, z0); gz <= Math.min(G - 1, z1); gz++) for (let gx = Math.max(0, g0); gx <= Math.min(G - 1, g1); gx++)
      if (Math.hypot(gridToWorldX(gx) - x, gridToWorldZ(gz) - z) < r + CELL_SIZE * 0.5) L[f * GG + gz * G + gx] = 1;
  }

  // one obstacle ahead (barrel / sentry): accumulates into this._av (climb-over height, slow-down, sideways nudge)
  _avCheck(x, z, rad, overTop) {
    const A = this._av, t = this.t, dx = x - t.x, dz = z - t.z, f = dx * A.fx + dz * A.fz, s = dx * A.rx + dz * A.rz;
    if (f < -1 || f > 8 || Math.abs(s) > rad + 1.2) return;
    A.climbTo = Math.max(A.climbTo, overTop);
    if (f < 4.5 && t.y < overTop - 0.3) A.slow = Math.min(A.slow, 1.2);
    A.nudge += (s >= 0 ? 1 : -1) * (1 - Math.abs(s) / (rad + 1.2)) * (1 - Math.max(0, f) / 8);   // + = obstacle on the right: turn left
  }

  // ---- search scratch: distance / parent / heap / queue buffers allocated once for the largest sector and reused by every search ----
  _scratch(N) {
    let S = this._S;
    if (!S) {
      const cap = GRID_SIZE * GRID_SIZE * MAX_FLOORS;
      S = this._S = { cap, dist: new Float64Array(cap), prev: new Int32Array(cap), bdist: new Int32Array(cap), queue: new Int32Array(cap), hc: new Float64Array(cap * 10), hn: new Int32Array(cap * 10), hs: 0, pc: 0, found: [], perF: [] };
    }
    if (N > S.cap) throw new Error('autopilot: sector larger than the search buffers');
    return S;
  }

  // binary min-heap on (cost, node) in two parallel typed arrays (each directed edge is relaxed at most once: 10 * tiles is enough)
  _hpush(c, n) {
    const S = this._S, hc = S.hc, hn = S.hn; let k = S.hs++;
    while (k > 0) { const p = (k - 1) >> 1; if (hc[p] <= c) break; hc[k] = hc[p]; hn[k] = hn[p]; k = p; }
    hc[k] = c; hn[k] = n;
  }

  _hpop() {                                                              // returns the node; its cost is left in this._S.pc
    const S = this._S, hc = S.hc, hn = S.hn, topC = hc[0], topN = hn[0], last = --S.hs;
    if (last > 0) {
      const c = hc[last], n = hn[last]; let k = 0;
      for (;;) { const l = 2 * k + 1; if (l >= last) break; let m = l; const r = l + 1; if (r < last && hc[r] < hc[l]) m = r; if (hc[m] >= c) break; hc[k] = hc[m]; hn[k] = hn[m]; k = m; }
      hc[k] = c; hn[k] = n;
    }
    S.pc = topC;
    return topN;
  }

  // A speed is good when the rocket would meet the beam line inside a gap (lag: about 0.12 s per m/s of speed change)
  _gateGood(l, dz, ready, yc, cx, v) {
    const t = this.t, T = t.time + Math.max(0, dz) / v + Math.abs(v - t.speed) * 0.12, y = ready ? t.y : yc;
    return this.laserSafe(l, T - 0.45, T + 1.2 / v + 0.45, t.x, y) && this.laserSafe(l, T - 0.45, T + 1.2 / v + 0.45, cx, y);
  }

  // a live laser grid within `zr` metres of the rocket's line and `xm` beyond either end of its span
  _beamNear(zr, xm) {
    const lasers = this.g.lasers, t = this.t;
    for (let i = 0; i < lasers.length; i++) { const l = lasers[i]; if (!l.disabled && Math.abs(t.z - l.z) < zr && t.x > l.xMin - xm && t.x < l.xMax + xm) return true; }
    return false;
  }

  _okTile(i) { return this.flyable(this._pX[i]) && this.navOk2(i) && !this._pHZ.hard[i]; }

  _relax(i, d, n, base) {
    const HZ = this._pHZ;
    if (!this._okTile(n)) return;
    if ((HZ.gate[n] || HZ.gate[i]) && (base > 1.2 || (HZ.gate[n] && HZ.gate[n] === HZ.gate[i]))) return;
    const nd = d + base + (HZ.soft[n] ? TUNE.costSoft : 0) + (HZ.gate[n] ? TUNE.costGate : 0) + (HZ.danger[n] ? TUNE.costDanger : 0), S = this._S;
    if (nd < S.dist[n]) { S.dist[n] = nd; S.prev[n] = i; this._hpush(nd, n); }
  }

  // A useful pickup we have seen, close by (at most 18 tiles of route), or null
  _wantPickup(p) {
    const g = this.g, t = this.t;
    return p.active && p._seen && !this.pickTried.has(p) && (p.type === 'ROCKETS' || p.type === 'OVERCHARGE' ||
      (p.type === 'AMMO' && g.gunAmmo < g.gunCap() * 0.6) || (p.type === 'REPAIR' && t.hull < 80) || (p.type === 'DOCK' && p._seen && (t.fuel < 45 || this.lowEnergy(t))));
  }

  // Range left at cruise speed is under the safe exploration reserve (never true with infinite fuel: the range is Infinity)
  // Low on fuel: under the fixed reserve, or under what it takes to reach the nearest recharge dock that has been seen (straight line x 1.4 for the
  // route, x 1.8 for a safety margin). Docks are far apart on the big maps, so the fixed reserve alone would be too late.
  lowEnergy(t) {
    if (t.rangeCruiseM < TUNE.energyReserveM) return true;
    const P = this.g.pickups;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.type !== 'DOCK' || !p.active || !p._seen || (this.pickTried && this.pickTried.has(p))) continue;
      if (t.rangeCruiseM < Math.hypot(p.pos.x - t.x, p.pos.z - t.z) * 1.4 * TUNE.dockMargin + TUNE.energyReserveM * 0.5) return true;
    }
    return false;
  }

  // Base speed for this step: cruise, or faster on a wide-open straight (lined up, clear far ahead, room to stop, nothing to watch
  // out for). It only raises the starting point: the braking envelope to the coming waypoints and the clearance cap still apply.
  _straightSpeed(t, w, err, dWp, ph) {
    const vTop = this.g.throttleSpeed(TUNE.straightThrottle);
    if (vTop <= t.cruise || this.lowEnergy(t) || this.exposed || w.keep || w.vert || w.gate || ph !== null || Math.abs(err) > TUNE.straightMaxErr || this._beamNear(8, 1.5)) return t.cruise;
    const open = Math.min(t.fanW, dWp);
    if (t.stopDist + TUNE.straightStopMargin > open) return t.cruise;
    const k = Math.max(0, Math.min(1, (open - TUNE.straightOpenMin) / (TUNE.straightOpenFull - TUNE.straightOpenMin)));
    return t.cruise + (vTop - t.cruise) * k;
  }

  _pushThreat(n, kind, obj, x, y, z, d) {
    const o = this._thr[n] || (this._thr[n] = { kind: '', obj: null, x: 0, y: 0, z: 0, d: 0 });
    o.kind = kind; o.obj = obj; o.x = x; o.y = y; o.z = z; o.d = d;
    return n + 1;
  }

  _dropTrack(i) {
    const TL = this._tl, k = TL[i];
    this.tracks.delete(k.obj);
    if (this.fc && this.fc.tgt === k) this.fc.tgt = null;
    for (let j = i; j < TL.length - 1; j++) TL[j] = TL[j + 1];
    TL.pop(); k.obj = null; this._trackPool.push(k);
  }

  // Is a 3-line grid actually in the way: the rocket is inside its beam plane, or the route's next waypoints lie across it.
  // (Without a route, assume it is.) Only then is the gap height forced: a tunnel mouth next to a grid must stay reachable.
  _pulseInWay(l, t) {
    const dz = t.z - l.z;
    if (Math.abs(dz) < TUNE.pulsePlaneBand) return true;
    const P = this.plan;
    if (!P) return true;
    for (let n = P.k; n < Math.min(P.wps.length, P.k + 2); n++) { const w = P.wps[n]; if (Math.sign(w.z - l.z) !== Math.sign(dz) && w.x > l.xMin - 1.5 && w.x < l.xMax + 1.5) return true; }
    return false;
  }

  // Nearest cracked wall the map has shown (and not tried yet), with a route to an open tile beside it. Floor 0 only (where
  // breakable walls are). Returns { bw, tiles } or null.
  planBreach(start) {
    if (start < 0 || !this._fillBreachGoals()) return null;
    const end = this.pathGoal(start, this._goalBreach);
    if (end < 0) return null;
    return { bw: this._brGoals.get(end), tiles: this.tilesTo(end, start) };
  }

  newBreachPlan() {
    const g = this.g, t = this.t, B = this.breachT;
    if (!B || !B.bw.active) { this.mission = 'EXPLORE'; this.breachT = null; this.plan = null; return; }
    if (t.node < 0) { this.plan = null; this.replanT = 0.5; this.why = 'NO POSITION FIX'; return; }
    const bp = this.planBreach(t.node);                                     // a fresh route from here
    if (!bp) { this.breachTried.add(B.bw); this.mission = 'EXPLORE'; this.breachT = null; this.plan = null; this.why = 'BREACH: NO WAY TO THE WALL'; return; }
    B.bw = bp.bw;
    if (!bp.tiles.length) { this.plan = null; B.atSpot = true; this.why = 'BREACH: PLACING THE CHARGE'; return; }
    this.plan = { goal: bp.tiles[bp.tiles.length - 1], tiles: bp.tiles, wps: this.smooth(bp.tiles), k: 0, t0: t.time, alt0: t.y, breach: true };
    g.xroute = bp.tiles.slice(); this.why = 'BREACH: TO A CRACKED WALL';
  }

  // A frontier tile within 3 tiles of a wall blown open in the last few minutes is worth going to first
  _breachLure(i) {
    const g = this.g, w = g.lastBreachTile;
    if (w === undefined || w < 0 || g.gameClock - g.lastBreachT > TUNE.breachLureFor) return 0;
    const G = GRID_SIZE, c = i % (G * G);
    return Math.max(Math.abs((c % G) - (w % G)), Math.abs(((c / G) | 0) - ((w / G) | 0))) <= 3 ? TUNE.breachLure : 0;
  }

  _clearTracks() { while (this._tl.length) this._dropTrack(this._tl.length - 1); this.tracks.clear(); }

  _missionMsg(m, kind, obj, energy) {
    if (m === 'HUNT') return 'AUTOPILOT: HUNTING THE PRIMARY TARGETS (LOCK-ON)';
    if (m === 'PICKUP') return energy ? 'AUTOPILOT: FUEL LOW — HEADING FOR A RECHARGE DOCK' : `AUTOPILOT: PICKING UP ${obj.type}`;
    if (m === 'LASER_SWITCH') return 'AUTOPILOT: SHUTTING DOWN A LASER GRID';
    if (m === 'ENGAGE') return kind === 'SENTRY' ? 'AUTOPILOT: CLEARING A SENTRY' : 'AUTOPILOT: ENGAGING A CIWS TURRET';
    if (m === 'CLEAR_BARREL') return 'AUTOPILOT: DETONATING A FUEL BARREL FROM A SAFE RANGE';
    if (m === 'BREACH') return 'AUTOPILOT: BLASTING A CRACKED WALL OPEN';
    return 'AUTOPILOT: EXPLORING';
  }

  // ---- route searches. pathGoal runs the search and returns only the goal tile (or -1), leaving the parents in the scratch;
  //      tilesTo turns them into the route (the only allocation, made when a plan is built). pathTo = both.
  pathGoal(start, isGoal, maxCost) {
    const g = this.g, X = g.xgrid, G = GRID_SIZE, GG = G * G, N = GG * g.nFloors;
    if (!X || start < 0) return -1;
    if (g.navFor !== g.ramps) g.navLinksBuild();
    const HZ = this.hazards(), S = this._scratch(N), dist = S.dist, prev = S.prev;
    this._pX = X; this._pHZ = HZ;
    dist.fill(Infinity, 0, N); prev.fill(-1, 0, N); S.hs = 0;
    dist[start] = 0; this._hpush(0, start);
    while (S.hs > 0) {
      const i = this._hpop(), d = S.pc;
      if (d > dist[i]) continue;
      if (maxCost && d > maxCost) return -1;
      if (isGoal(i)) return i;
      const c = i % GG, x = c % G, z = (c / G) | 0;
      if (x > 0) this._relax(i, d, i - 1, 1); if (x < G - 1) this._relax(i, d, i + 1, 1); if (z > 0) this._relax(i, d, i - G, 1); if (z < G - 1) this._relax(i, d, i + G, 1);
      if (x > 0 && z > 0 && this._okTile(i - 1) && this._okTile(i - G)) this._relax(i, d, i - G - 1, TUNE.costDiag); if (x < G - 1 && z > 0 && this._okTile(i + 1) && this._okTile(i - G)) this._relax(i, d, i - G + 1, TUNE.costDiag);
      if (x > 0 && z < G - 1 && this._okTile(i - 1) && this._okTile(i + G)) this._relax(i, d, i + G - 1, TUNE.costDiag); if (x < G - 1 && z < G - 1 && this._okTile(i + 1) && this._okTile(i + G)) this._relax(i, d, i + G + 1, TUNE.costDiag);
      const extra = this.links(i);
      if (extra) for (let k = 0; k < extra.length; k++) this._relax(i, d, extra[k], TUNE.costLink);
    }
    return -1;
  }

  tilesTo(goal, start) {
    const prev = this._S.prev, tiles = [];
    for (let k = goal; k !== start && k >= 0; k = prev[k]) tiles.push(k);
    return tiles.reverse();
  }

  // ---- tier 5 (and the fuel emergency): a seen pickup worth fetching, nearest by route. Sets this._cand.obj.
  _findPickup(energyOnly) {
    const g = this.g, t = this.t;
    if (!this.pickTried) this.pickTried = new Set();
    const goals = this._pickGoals; goals.clear();
    for (let i = 0; i < g.pickups.length; i++) {
      const p = g.pickups[i];
      if (energyOnly ? !(p.type === 'DOCK' && p.active && p._seen && !this.pickTried.has(p)) : !this._wantPickup(p)) continue;
      const c = this.tileOf(p.pos); if (c >= 0 && !goals.has(c)) goals.set(c, p);
    }
    if (!goals.size) return false;
    const maxCost = energyOnly ? Math.min(TUNE.energyPickupMaxCost, TUNE.energyRangeShare * t.rangeCruiseM / CELL_SIZE) : TUNE.pickupMaxCost;
    if (!(maxCost > 0)) return false;
    const end = this.pathGoal(t.node, this._goalPick, maxCost);
    if (end < 0) return false;
    this._cand.obj = goals.get(end);
    return true;
  }

  // ---- tier 2: laser switch boxes. A goal tile is one (floor 0) from which thermal sees a candidate box.
  _boxLive(l) { return !!(l && !l.disabled && l.relayActive && l.lockRef && l.lockRef.active && !(this.boxTried && this.boxTried.has(l))); }

  _isBoxSpot(i) {
    if (i >= GRID_SIZE * GRID_SIZE) return false;
    const g = this.g, x = gridToWorldX(i % GRID_SIZE), z = gridToWorldZ((i / GRID_SIZE) | 0), L = this._boxList;
    for (let k = 0; k < L.length; k++) {
      const l = L[k], d = Math.hypot(l.relayPos.x - x, l.relayPos.z - z);
      if (d < this._boxReach && d > 3 && g.los3(x, 2.2, z, l.relayPos.x, l.relayPos.y, l.relayPos.z)) { this._boxHit = l; return true; }
    }
    return false;
  }

  // Route to a firing spot for a known live box (only boxes in sight right now when visibleOnly; only `only` when given).
  // Returns the goal tile or -1, and sets this._cand.obj to the box's grid.
  _findLaserBox(visibleOnly, only) {
    const g = this.g, t = this.t, L = this._boxList;
    L.length = 0;
    if (!this.boxTried) this.boxTried = new Set();
    if (only) { if (this._boxLive(only)) L.push(only); }
    else for (let k = 0; k < this.knownBoxes.length; k++) { const l = this.knownBoxes[k]; if (this._boxLive(l) && (!visibleOnly || l.boxVis)) L.push(l); }
    if (!L.length) return -1;
    this._boxReach = Math.max(8, g.lidarParams().thermal * 0.8);
    const end = this.pathGoal(t.node, this._goalBox, TUNE.laserMaxCost);
    if (end >= 0) this._cand.obj = this._boxHit;
    return end;
  }

  newLaserPlan() {
    const g = this.g, t = this.t, l = this.boxLaser;
    if (!this._boxLive(l)) { this.mission = 'EXPLORE'; this.boxGoal = this.boxLaser = null; this.plan = null; return; }
    if (t.node < 0) { this.plan = null; this.replanT = 0.5; this.why = 'NO POSITION FIX'; return; }
    const end = this._findLaserBox(false, l);
    if (end < 0) { this.boxTried.add(l); this.mission = 'EXPLORE'; this.boxGoal = this.boxLaser = null; this.plan = null; this.why = 'LASER SWITCH OUT OF REACH'; return; }
    const tiles = this.tilesTo(end, t.node);
    this.boxGoal = l;
    if (!tiles.length) { this.boxWait = { t: 0 }; this.plan = null; this.why = 'SHOOTING A LASER SWITCH BOX'; return; }
    this.plan = { goal: end, tiles, wps: this.smooth(tiles), k: 0, t0: t.time, alt0: t.y, laser: l };
    g.xroute = tiles.slice(); this.why = 'TO A LASER SWITCH BOX';
  }

  // ---- tiers 3 and 4: firing spots around turrets, sentries and barrels
  _aimY(kind, o) { return kind === 'SENTRY' ? o.pos.y + 1.2 : o.pos.y; }

  _alive(kind, o) { return kind === 'SENTRY' ? !!(o.active && !o.dying) : !!o.active; }

  _attackValid() {
    const E = this.engT;
    return !!(E && this._alive(E.kind, E.tu) && this.t.time - E.t0 < TUNE.engageMax && !((this.turretIgnore.get(E.tu) || 0) > this.t.time));
  }

  // a barrel's blast and everything it would chain into must not reach the rocket
  _barrelSafeDist() { return Math.max(BARREL_BLAST_RADIUS, this.g.blastRadiusBase()) + MISSILE_RADIUS + TUNE.barrelSafetyMargin; }

  _barrelCluster(b) {
    const B = this.g.barrels, C = this._clu;
    C.length = 0; C.push(b);
    for (let h = 0; h < C.length; h++) {
      const a = C[h];
      for (let k = 0; k < B.length; k++) {
        const o = B[k];
        if (!o.active || C.indexOf(o) >= 0) continue;
        if (o.pos.distanceTo(a.pos) <= BARREL_CHAIN_REACH) C.push(o);
      }
    }
  }

  _clusterClear(x, y, z, safe) {
    const C = this._clu;
    for (let k = 0; k < C.length; k++) { const p = C[k].pos; if (Math.hypot(p.x - x, p.y - y, p.z - z) < safe) return false; }
    return true;
  }

  // add the firing spots around target o to this._atkGoals (tile -> target): ring on its floor, clear line to its aim point
  _addAttackSpots(kind, o) {
    const g = this.g, G = GRID_SIZE, GG = G * G, goals = this._atkGoals;
    const tf = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(o.pos.y))), base = tf * WALL_H, aimY = this._aimY(kind, o);
    let dMin, dMax, safe = 0;
    if (kind === 'BARREL') {                                             // outside the chain's blast, but inside thermal range (or it cannot be seen to be shot)
      safe = this._barrelSafeDist(); dMin = safe; dMax = Math.min(safe + TUNE.barrelRing, g.lidarParams(true).thermal - TUNE.thermalMargin);
      if (dMax <= dMin) return;
      this._barrelCluster(o);
    }
    else if (kind === 'SENTRY') { dMin = TUNE.sentryRingMin; dMax = TUNE.sentryRingMax; }
    else { dMin = TUNE.turretRingMin; dMax = TUNE.turretRingMax; }
    if (kind === 'SENTRY') dMax = Math.min(dMax, g.lidarParams(true).thermal - TUNE.thermalMargin);   // a sentry is only shot while thermal sees it
    const fromY = kind === 'CIWS' ? o.pos.y - 0.3 : Math.max(base + 1.0, Math.min(base + WALL_H - 0.8, aimY));
    const cr = Math.ceil(dMax / CELL_SIZE), tgx = worldToGridX(o.pos.x), tgz = worldToGridZ(o.pos.z);
    for (let gz = Math.max(0, tgz - cr); gz <= Math.min(G - 1, tgz + cr); gz++) for (let gx = Math.max(0, tgx - cr); gx <= Math.min(G - 1, tgx + cr); gx++) {
      const x = gridToWorldX(gx), z = gridToWorldZ(gz), d = Math.hypot(o.pos.x - x, o.pos.z - z);
      if (d < dMin || d > dMax) continue;
      const i = tf * GG + gz * G + gx;
      if (goals.has(i)) continue;
      if (kind === 'BARREL' && !this._clusterClear(x, fromY, z, safe)) continue;
      if (g.los3(x, fromY, z, o.pos.x, aimY, o.pos.z)) { goals.set(i, o); this._atkKind.set(o, kind); }
    }
  }

  // Nearest reachable firing spot: tier 3 (turrets + sentries) or tier 4 (barrels). Sets this._cand.obj / .kind.
  _findAttack(tier) {
    const g = this.g, t = this.t, goals = this._atkGoals, ig = this.turretIgnore, now = t.time;
    goals.clear(); this._atkKind.clear();
    if (tier === 'ENGAGE') {
      for (let k = 0; k < this.knownList.length; k++) { const o = this.knownList[k]; if (o.active && !((ig.get(o) || 0) > now)) this._addAttackSpots('CIWS', o); }
      for (let k = 0; k < this.knownSentries.length; k++) { const o = this.knownSentries[k]; if (o.active && !o.dying && !((ig.get(o) || 0) > now)) this._addAttackSpots('SENTRY', o); }
    } else {
      if (g.gunAmmo <= TUNE.reserveRounds) return false;                 // rounds are kept for threats
      for (let k = 0; k < this.knownBarrels.length; k++) { const o = this.knownBarrels[k]; if (o.active && !((ig.get(o) || 0) > now)) this._addAttackSpots('BARREL', o); }
    }
    if (!goals.size) return false;
    const end = this.pathGoal(t.node, this._goalAtk, tier === 'ENGAGE' ? TUNE.engageMaxCost : TUNE.barrelMaxCost);
    if (end < 0) return false;
    const o = goals.get(end);
    this._cand.obj = o; this._cand.kind = this._atkKind.get(o);
    return true;
  }

  newAttackPlan() {
    const g = this.g, t = this.t, E = this.engT;
    if (!E || !this._alive(E.kind, E.tu)) { this.mission = 'EXPLORE'; this.engT = null; this.plan = null; return; }
    if (t.node < 0) { this.plan = null; this.replanT = 0.5; this.why = 'NO POSITION FIX'; return; }
    this._atkGoals.clear(); this._atkKind.clear(); this._addAttackSpots(E.kind, E.tu);
    const end = this._atkGoals.size ? this.pathGoal(t.node, this._goalAtk, E.kind === 'BARREL' ? TUNE.barrelMaxCost : TUNE.engageMaxCost) : -1;
    if (end < 0) { this.turretIgnore.set(E.tu, t.time + TUNE.turretIgnoreFor); this.mission = 'EXPLORE'; this.engT = null; this.plan = null; this.why = 'NO FIRING SPOT'; return; }
    const tiles = this.tilesTo(end, t.node);
    if (!tiles.length) { this.plan = null; E.atSpot = true; this.why = 'ENGAGING ' + E.kind; return; }
    this.plan = { goal: end, tiles, wps: this.smooth(tiles), k: 0, t0: t.time, alt0: t.y, attack: true };
    g.xroute = tiles.slice(); this.why = 'TO A FIRING SPOT (' + E.kind + ')';
  }

  // ---- tier 6: cracked walls the map has shown (floor 0), from an open tile beside them
  _fillBreachGoals() {
    const g = this.g, X = g.xgrid, G = GRID_SIZE, goals = this._brGoals;
    goals.clear();
    if (!X || !g.breakables) return 0;
    if (!this.breachTried) this.breachTried = new Set();
    for (let k = 0; k < g.breakables.length; k++) {
      const bw = g.breakables[k];
      if (!bw.active || this.breachTried.has(bw)) continue;
      const c = bw.gz * G + bw.gx;
      if (X[c] !== XV.CRACK) continue;                                     // only walls the lidar has shown as cracked
      if (bw.gx > 0 && this.flyable(X[c - 1]) && this.navOk2(c - 1)) goals.set(c - 1, bw);
      if (bw.gx < G - 1 && this.flyable(X[c + 1]) && this.navOk2(c + 1)) goals.set(c + 1, bw);
      if (bw.gz > 0 && this.flyable(X[c - G]) && this.navOk2(c - G)) goals.set(c - G, bw);
      if (bw.gz < G - 1 && this.flyable(X[c + G]) && this.navOk2(c + G)) goals.set(c + G, bw);
    }
    return goals.size;
  }

  _findBreach() {
    if (!this._fillBreachGoals()) return false;
    const end = this.pathGoal(this.t.node, this._goalBreach);
    if (end < 0) return false;
    this._cand.obj = this._brGoals.get(end);
    return true;
  }
}
