/* Autopilot (explore, plan, fly, fire control). Reads and drives the game object it is given. */
import {
  CELL_SIZE, CELL_VOID, CRUISE_THROTTLE, GRID_SIZE, GUN_HITS, GUN_RATE, GUN_SPEED, MISSILE_RADIUS, WALL_H, XV,
  isWalkable
} from './constants.js';
import { gridToWorldX, gridToWorldZ, worldToGridX, worldToGridZ } from './math.js';

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
    this.t = null;                         // latest telemetry snapshot
    this.brakeMax = 6;                     // measured: strongest deceleration seen (m/s^2), starts conservative
    this.turnMax = 1.2;                    // measured: fastest yaw rate seen (rad/s)
    this._prevSpd = 0; this._accEma = 0; this._fanT = 0; this._fan = null;
    this.FAN = [-60, -30, 0, 30, 60];      // forward clearance fan (degrees off the nose)
  }

  // Free distance along a horizontal direction from the rocket (grid march, 0.5 m steps)
  clearAlong(x, y, z, yaw, max) {
    const g = this.g, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    for (let d = 0.5; d <= max; d += 0.5) if (g.isGridSolid(x + dx * d, z + dz * d, y)) return d - 0.5;
    return max;
  }

  // ---- layer 1: telemetry. Called every frame while a rocket flies (manual or auto). ----
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
    const P = m.probe || { l: 99, r: 99, u: 99, d: 99 };
    this._fanT -= dt;
    if (this._fanT <= 0 || !this._fan) {
      this._fanT = 0.1;
      this._fan = this.FAN.map((deg) => this.clearAlong(m.pos.x, m.pos.y, m.pos.z, m.yaw + deg * Math.PI / 180, 30));
      { const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);             // straight ahead: centre and both hull edges (+/- 0.6 m)
        this._fanW = Math.min(this._fan[2], this.clearAlong(m.pos.x + rx * 0.6, m.pos.y, m.pos.z + rz * 0.6, m.yaw, 30), this.clearAlong(m.pos.x - rx * 0.6, m.pos.y, m.pos.z - rz * 0.6, m.yaw, 30)); }
    }
    // fuel: the game's own burn model (%/s) -> range left now and at cruise speed (the most economical)
    const vc = g.throttleSpeed(CRUISE_THROTTLE), vr = speed / Math.max(1, vc);
    const turn = Math.min(1, (Math.abs(m.yawRate) + Math.abs(m.pitchRate)) / 2.5);
    const burn = g.cfg.infFuel ? 0 : (m.fuelBurn || 0);
    const shape = 0.5 + 0.5 * vr * vr + 0.3 * turn;
    const burnCruise = burn > 0 ? burn / shape * 1.0 : 0;                 // same model at v = cruise, flying straight
    const rangeSec = burn > 0 ? m.fuel / burn : Infinity;
    // contacts: only what wears the [ ] brackets
    const contacts = [];
    const addC = (kind, obj, x, y, z, threat) => {
      const dx = x - m.pos.x, dy = y - m.pos.y, dz = z - m.pos.z, d = Math.hypot(dx, dy, dz);
      let brg = Math.atan2(-dx, -dz) - m.yaw; while (brg > Math.PI) brg -= Math.PI * 2; while (brg < -Math.PI) brg += Math.PI * 2;
      contacts.push({ kind, obj, x, y, z, d, brg, dy, threat });
    };
    for (const s of g.sentries) if (s.active && !s.dying && s.thermalVis) addC('SENTRY', s, s.pos.x, s.pos.y + 1.2, s.pos.z, !!s.alerted);
    for (const tu of g.turrets) if (tu.active && tu.mesh.userData._tv) addC('CIWS', tu, tu.pos.x, tu.pos.y, tu.pos.z, true);
    for (const l of g.lasers) if (l.boxVis && l.lockRef && l.lockRef.active) addC('LASER BOX', l, l.relayPos.x, l.relayPos.y, l.relayPos.z, false);
    contacts.sort((a, b) => a.d - b.d);
    for (const pk of g.pickups) if (pk.active && pk.mesh.userData._tv) pk._seen = true;
    if (this._ktKey !== g.lidarKey) { this.knownTurrets = new Set(); this._ktKey = g.lidarKey; }
    { const range = 26 + Math.min(14, (g.difficultyTier - 1) * 0.7);
      for (const tu of g.turrets) if (tu.active && !this.knownTurrets.has(tu) && (tu.mesh.userData._tv || (tu.pos.distanceTo(m.pos) < range && g.los3(tu.pos.x, tu.pos.y, tu.pos.z, m.pos.x, m.pos.y, m.pos.z)))) { this.knownTurrets.add(tu); this._hz = null; } }
    let node = -1;
    { const c0 = g.cellAt(m.pos.x, m.pos.z), f0 = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(m.pos.y))); if (c0 >= 0 && this.navOk2(f0 * GRID_SIZE * GRID_SIZE + c0)) node = f0 * GRID_SIZE * GRID_SIZE + c0; else node = g.autoNode(m); }
    this.t = {
      time: g.gameClock,
      x: m.pos.x, y: m.pos.y, z: m.pos.z, vx: v.x, vy: v.y, vz: v.z,
      speed, hSpeed, vSpeed: v.y, acc: this._accEma,
      yaw: m.yaw, pitch: m.pitch, yawRate: m.yawRate,
      heading: ((-m.yaw * 180 / Math.PI) % 360 + 360) % 360,
      floor: Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(m.pos.y))), node,
      tileX: node >= 0 ? (node % (GRID_SIZE * GRID_SIZE)) % GRID_SIZE : -1, tileZ: node >= 0 ? ((node % (GRID_SIZE * GRID_SIZE)) / GRID_SIZE) | 0 : -1,
      agl: m.pos.y - floorY - MISSILE_RADIUS, ceil: ceilY - m.pos.y - MISSILE_RADIUS,
      probe: { l: P.l, r: P.r, u: P.u, d: P.d }, fan: this._fan, fanW: this._fanW === undefined ? (this._fan ? this._fan[2] : 30) : this._fanW,
      brakeMax: this.brakeMax, turnMax: this.turnMax,
      stopDist: speed * speed / (2 * Math.max(1, this.brakeMax)),        // distance needed to stop from this speed
      fuel: m.fuel, burn, burnCruise, cruise: vc, rangeSec,
      rangeM: rangeSec === Infinity ? Infinity : rangeSec * speed,
      rangeCruiseM: burnCruise > 0 ? (m.fuel / burnCruise) * vc : Infinity,
      hull: m.hull, ammo: g.gunAmmo, rockets: g.ammo, hover: !!m.hover, landed: !!m.landed,
      contacts, threats: contacts.filter((c) => c.threat).length,
      mode: m.auto ? (this.mission || 'AUTO') : (g.autoPlay ? 'WAIT' : 'MANUAL'),
      route: g.xroute ? g.xroute.length : 0
    };
    return this.t;
  }


  // =====================================================================================================
  // STEP 2: waypoints (A* over explored tiles + string-pulled legs) and guidance (look-ahead pursuit)
  // =====================================================================================================
  engage() {
    this.active = true; this.done = false; this.plan = null; this.scan = null; this.replanT = 0; this.failN = 0; this.engagedAt = this.g.gameClock;
    this.tried = this.tried && this._triedKey === this.g.lidarKey ? this.tried : new Set(); this._triedKey = this.g.lidarKey;
    this.stuck = { t: 0, x: 0, z: 0 }; this.cmd = null; this.why = 'ENGAGED';
    this.gun = { ignore: new Set(), aimObj: null, aimT: 0, mode: 'EXPLORE', path: null, pi: 0 };
    this.fc = null; this.tracks = new Map(); this.boxWait = null; this.boxGoal = null; this.boxLaser = null;
    this.mission = 'EXPLORE'; this.noFrontier = false; this.pickNow = null; this._decT = 0; this.gate = null; this.engT = null; this._cmdPrev = null; this.exposed = false;
    if (this._tiKey !== this.g.lidarKey) { this.turretIgnore = new Map(); this._tiKey = this.g.lidarKey; }
    if (this._pkKey !== this.g.lidarKey) { this.pickTried = new Set(); this._pkKey = this.g.lidarKey; }
    if (this._boxKey !== this.g.lidarKey) { this.boxTried = new Set(); this._boxKey = this.g.lidarKey; }
  }

  flyable(v) { return v === XV.OPEN || v === XV.RAMP || v === XV.SH_TOP || v === XV.SH_MID || v === XV.SH_BOT || v === XV.HOLE || v === XV.HAZ; }

  // Hazard layers, refreshed every 2 s. hard: never route through (turbines, bulkheads, live laser grids);
  // soft: allowed at a cost (fuel barrels only explode when hit, grates are passable beside)
  hazards() {
    const g = this.g, now = g.gameClock;
    if (this._hz && now - this._hzT < 2) return this._hz;
    const G = GRID_SIZE, GG = G * G, hard = new Uint8Array(GG * g.nFloors), soft = new Uint8Array(GG * g.nFloors), gate = new Int16Array(GG * g.nFloors);
    const disc = (L, x, z, r, f) => {
      const g0 = worldToGridX(x - r - 2), g1 = worldToGridX(x + r + 2), z0 = worldToGridZ(z - r - 2), z1 = worldToGridZ(z + r + 2);
      for (let gz = Math.max(0, z0); gz <= Math.min(G - 1, z1); gz++) for (let gx = Math.max(0, g0); gx <= Math.min(G - 1, g1); gx++)
        if (Math.hypot(gridToWorldX(gx) - x, gridToWorldZ(gz) - z) < r + CELL_SIZE * 0.5) L[f * GG + gz * G + gx] = 1;
    };
    for (const tb of g.turbines) {                                       // a turbine is a thin fan: only the tiles its blades sweep
      const gz = worldToGridZ(tb.pos.z);
      for (let gx = 0; gx < G; gx++) if (Math.abs(gridToWorldX(gx) - tb.pos.x) < tb.radius + MISSILE_RADIUS + CELL_SIZE * 0.5 && gz >= 0 && gz < G) hard[gz * G + gx] = 1;
    }
    for (const b of g.bulkheads) disc(hard, b.x, b.z, 3.0, 0);
    g.lasers.forEach((l, li) => { if (l.disabled || l.mode === 'PULSE_GATE') return; const gz = worldToGridZ(l.z); /* 3-line grids: flown through at the gap height, no gate */ const blocked = this.gateBlock && (this.gateBlock.get(l) || 0) > now; for (let x = l.xMin; x <= l.xMax + 0.01; x += CELL_SIZE * 0.5) { const gx = worldToGridX(x); if (gx >= 0 && gx < G && gz >= 0 && gz < G) { if (blocked) hard[gz * G + gx] = 1; else gate[gz * G + gx] = li + 1; } } });   // laser grids: timed gates (a grid that would not open: avoided for a while)
    for (const tg of g.targets) if (tg.active) disc(hard, tg.pos.x, tg.pos.z, 0.3, Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(tg.pos.y))));   // primary targets: flying into one detonates the warhead
    for (const b of g.barrels) if (b.active) disc(soft, b.pos.x, b.pos.z, 0.6, Math.min(g.nFloors - 1, Math.max(0, Math.floor(b.pos.y / WALL_H))));
    for (const gr of g.grates) if (gr.active) disc(soft, gr.pos.x, gr.pos.z, 0.6, 0);
    // holes / atriums with a live CIWS turret overhead (within 12 m): climbing through means being shot from straight above,
    // where a level-nosed hover can neither aim the gun nor lock on. Routes go up the ramps instead.
    const noClimb = new Set();
    const live = g.turrets.filter((tu) => tu.active);
    if (live.length) for (const [i] of this.vlinks()) {
      const c = i % GG, x = gridToWorldX(c % G), z = gridToWorldZ((c / G) | 0);
      for (const tu of live) if (Math.hypot(tu.pos.x - x, tu.pos.z - z) < 12) { noClimb.add(i); break; }
    }
    const danger = new Uint8Array(GG * g.nFloors), X = g.xgrid;
    if (X && this.knownTurrets && this.knownTurrets.size) {
      const range = 26 + Math.min(14, (g.difficultyTier - 1) * 0.7), cr = Math.ceil(range / CELL_SIZE);
      for (const tu of this.knownTurrets) {
        if (!tu.active) continue;
        const tf = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(tu.pos.y))), tgx = worldToGridX(tu.pos.x), tgz = worldToGridZ(tu.pos.z);
        for (let f = Math.max(0, tf - 1); f <= Math.min(g.nFloors - 1, tf); f++) for (let gz = Math.max(0, tgz - cr); gz <= Math.min(G - 1, tgz + cr); gz++) for (let gx = Math.max(0, tgx - cr); gx <= Math.min(G - 1, tgx + cr); gx++) {
          const i = f * GG + gz * G + gx; if (!X[i] || danger[i]) continue;
          const x = gridToWorldX(gx), z = gridToWorldZ(gz), y = f * WALL_H + 2.2;
          if (Math.hypot(tu.pos.x - x, tu.pos.y - y, tu.pos.z - z) < range && g.los3(tu.pos.x, tu.pos.y, tu.pos.z, x, y, z)) danger[i] = 1;
        }
      }
    }
    this._hz = { hard, soft, gate, noClimb, danger }; this._hzT = now;
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
  vlinks() {
    const g = this.g;
    if (this._vl && this._vlFor === g.floors) return this._vl;
    const G = GRID_SIZE, GG = G * G, L = new Map();
    const add = (a, b) => { if (!L.has(a)) L.set(a, []); L.get(a).push(b); };
    for (let f = 1; f < g.nFloors; f++) for (let c = 0; c < GG; c++)
      if (g.floors[f][c] === CELL_VOID && isWalkable(g.floors[f - 1][c]) && !(g.liftCells && g.liftCells.has(c))) { add(f * GG + c, (f - 1) * GG + c); add((f - 1) * GG + c, f * GG + c); }
    this._vl = L; this._vlFor = g.floors;
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
    const g = this.g, t = this.t, fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw), rx = -fz, rz = fx;
    let climbTo = -Infinity, slow = Infinity, nudge = 0;
    const check = (x, y, z, rad, overTop) => {
      const dx = x - t.x, dz = z - t.z, f = dx * fx + dz * fz, s = dx * rx + dz * rz;
      if (f < -1 || f > 8 || Math.abs(s) > rad + 1.2) return;
      if (overTop !== null) climbTo = Math.max(climbTo, overTop);
      if (f < 4.5 && overTop !== null && t.y < overTop - 0.3) slow = Math.min(slow, 1.2);
      nudge += (s >= 0 ? 1 : -1) * (1 - Math.abs(s) / (rad + 1.2)) * (1 - Math.max(0, f) / 8);   // + = obstacle on the right: turn left
    };
    for (const b of g.barrels) if (b.active && Math.abs(b.pos.y - t.y) < 4) check(b.pos.x, b.pos.y, b.pos.z, 1.47, b.pos.y + 2.1);
    for (const s of g.sentries) if (s.active && !s.dying && Math.abs(s.pos.y - t.y) < 4) check(s.pos.x, s.pos.y, s.pos.z, 1.2, s.pos.y + 3.0);
    for (const tg of g.targets) {
      if (!tg.active || this.mission === 'HUNT') continue;
      const dx = tg.pos.x - t.x, dz = tg.pos.z - t.z, f = dx * fx + dz * fz, s = dx * rx + dz * rz, R = tg.radius + 1.8;
      if (f > -1 && f < 8 && Math.abs(s) < R) { slow = Math.min(slow, 2.5); nudge += (s >= 0 ? 2 : -2) * (1 - Math.abs(s) / R); }   // a primary target ahead: slow down and steer firmly round it
    }
    // laser planes: outside a timed gate crossing, never close in on an active beam plane (stop within 3 m when heading at it)
    if (!this.gate) for (const l of g.lasers) {                       // only a real crossing course: the path meets the plane within 3 m, inside the span, while unsafe
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
    if (this.mission !== 'HUNT') for (const tg of g.targets) {
      if (!tg.active) continue;
      const dx = tg.pos.x - t.x, dz = tg.pos.z - t.z, d = Math.hypot(dx, dz), f = dx * fx + dz * fz, s = dx * rx + dz * rz;
      if (d < 4.5 && f > 0 && Math.abs(s) < tg.radius + 0.9) { slow = 0; nudge += (s >= 0 ? 2.5 : -2.5); }   // only on a collision course
    }
    if (climbTo > -Infinity && this.nearAnyBeam()) climbTo = -Infinity;   // near laser beams the height is set by the crossing
    if (climbTo > -Infinity) { const yT = Math.min(t.y + t.ceil - 0.5, climbTo); out.climb = Math.max(out.climb, Math.max(-1, Math.min(1, 1.6 * (yT - t.y)))); }
    if (slow < Infinity) out.speed = Math.min(out.speed, slow);
    if (nudge) out.yaw = Math.max(-1, Math.min(1, out.yaw + 0.6 * nudge));
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
    const perF = []; let maxF = 1;
    for (let f = 0; f < g.nFloors; f++) { let n = 0; for (let k = f * GG; k < (f + 1) * GG; k++) if (X[k]) n++; perF.push(n); maxF = Math.max(maxF, n); }
    const nearWall = (i) => { const c = i % GG, x = c % G, z = (c / G) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= G || zz >= G) return true; const v = X[i + dz * G + dx]; if (v === XV.SOLID || v === XV.CRACK) return true; } return false; };
    const nearHaz = (i) => { const c = i % GG, x = c % G, z = (c / G) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, zz = z + dz; if (xx >= 0 && zz >= 0 && xx < G && zz < G && haz[i + dz * G + dx]) return true; } return false; };
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    // binary heap of [cost, node]
    const H = []; const push = (c, n) => { H.push([c, n]); let k = H.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (H[p][0] <= H[k][0]) break; [H[p], H[k]] = [H[k], H[p]]; k = p; } };
    const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === k) break; [H[m], H[k]] = [H[k], H[m]]; k = m; } } return top; };
    dist[start] = 0; push(0, start);
    let bestD = -1; const found = [];
    while (H.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      if (bestD >= 0 && d > bestD + 32) break;
      if (i !== start && unknownN(i) && !this.tried.has(i)) { found.push(i); if (bestD < 0) bestD = d; }
      const c = i % GG, x = c % G, z = (c / G) | 0, f0 = i - c;
      const step = (n, base) => { if (!ok(n)) return; if ((HZ.gate[n] || HZ.gate[i]) && (base > 1.2 || (HZ.gate[n] && HZ.gate[n] === HZ.gate[i]))) return; const nd = d + base + (nearWall(n) ? 0.35 : 0) + (nearHaz(n) ? 2.5 : 0) + (soft[n] ? 3 : 0) + (HZ.gate[n] ? 12 : 0) + (HZ.danger[n] ? 6 : 0); if (nd < dist[n]) { dist[n] = nd; prev[n] = i; push(nd, n); } };
      const L = x > 0, R = x < G - 1, U = z > 0, D = z < G - 1;
      if (L) step(i - 1, 1); if (R) step(i + 1, 1); if (U) step(i - G, 1); if (D) step(i + G, 1);
      if (L && U && ok(i - 1) && ok(i - G)) step(i - G - 1, 1.414); if (R && U && ok(i + 1) && ok(i - G)) step(i - G + 1, 1.414);
      if (L && D && ok(i - 1) && ok(i + G)) step(i + G - 1, 1.414); if (R && D && ok(i + 1) && ok(i + G)) step(i + G + 1, 1.414);
      const extra = this.links(i);
      if (extra) for (const n of extra) step(n, 2.5);
      if (f0 < 0) break;
    }
    if (!found.length) return null;
    let best = found[0], bestS = Infinity;
    for (const i of found) {
      const p = this.tileCenter(i);
      let a = Math.atan2(-(p.x - t.x), -(p.z - t.z)) - t.yaw; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      const fl = (i / GG) | 0, sc = dist[i] + Math.abs(a) * 2.5 - (perF[fl] < maxF * 0.35 ? 30 : (perF[fl] < maxF * 0.6 ? 10 : 0)) + (HZ.danger[i] ? 25 : 0);   // badly unexplored floors win; turret coverage loses
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
    const pts = tiles.map((i) => { const p = this.tileCenter(i); return { x: p.x, z: p.z, f: p.f, i, alt: g.autoNodeAlt(i), keep: X[i] === XV.SH_TOP || X[i] === XV.SH_MID || X[i] === XV.SH_BOT || X[i] === XV.RAMP, gate: this.hazards().gate[i] }; });
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
    const t = this.t, g = this.g;
    if (this.mission === 'HUNT') { this.newHuntPlan(); return; }
    if (this.mission === 'ENGAGE') {
      const E = this.engT;
      if (!E || !E.tu.active) { this.mission = 'EXPLORE'; this.engT = null; this.plan = null; return; }
      const tp = this.planTurret(t.node);
      if (!tp || tp.tu !== E.tu) { if (!tp) { this.turretIgnore.set(E.tu, t.time + 60); this.mission = 'EXPLORE'; this.engT = null; this.plan = null; return; } this.engT.tu = tp.tu; }
      if (!tp.tiles.length) { this.plan = null; this.engT.atSpot = true; this.why = 'ENGAGING CIWS'; return; }
      this.plan = { goal: tp.tiles[tp.tiles.length - 1], tiles: tp.tiles, wps: this.smooth(tp.tiles), k: 0, t0: t.time, alt0: t.y, turret: E.tu };
      g.xroute = tp.tiles.slice(); this.why = 'TO A FIRING SPOT (CIWS)'; return;
    }
    if (this.mission === 'PICKUP') { this.newPickupPlan(); return; }
    if (g.xgrid && t.node >= 0) { const v = g.xCellVal(t.floor, t.node % (GRID_SIZE * GRID_SIZE)); if (g.xgrid[t.node] !== v) { g.xgrid[t.node] = v; g.xgridDirty = true; } }
    if (t.node < 0) { this.plan = null; this.replanT = 0.5; this.why = 'NO POSITION FIX'; return; }   // between floors / over a hole: try again shortly
    const p = this.planFrontier(t.node);
    if (p) { this.failN = 0; this.noFrontier = false; }
    if (!p) {
      const lp = this.planLaserBox(t.node);                             // only live laser grids left in the way: shoot a switch box
      if (lp) {
        this.boxGoal = lp.laser; this.boxLaser = lp.laser;
        if (!lp.tiles.length) { this.boxWait = { t: 0 }; this.plan = null; this.why = 'SHOOTING A LASER SWITCH BOX'; return; }
        this.plan = { goal: lp.goal, tiles: lp.tiles, wps: this.smooth(lp.tiles), k: 0, t0: t.time, alt0: t.y, laser: lp.laser };
        g.xroute = lp.tiles.slice(); this.why = 'TO A LASER SWITCH BOX'; return;
      }
      const X = g.xgrid, GG = GRID_SIZE * GRID_SIZE, G = GRID_SIZE, i = t.node;
      const c = i % GG, x = c % G, z = (c / G) | 0;
      const unknownHere = X && ((x > 0 && !X[i - 1]) || (x < G - 1 && !X[i + 1]) || (z > 0 && !X[i - G]) || (z < G - 1 && !X[i + G]));
      if (unknownHere && !this.tried.has(i)) { this.startScan(i); return; }
      if (t.time - (this.engagedAt || 0) > 4) this.failN = (this.failN || 0) + 1;   // only call it explored after 3 failed plans in a row (never in the first seconds)
      if (this.failN < 3) { this.plan = null; this.replanT = 1.0; this.why = 'NO FRONTIER - RETRYING'; return; }
      this.plan = null; this.noFrontier = true; this.replanT = 3; this.why = 'NOTHING LEFT TO EXPLORE';
      if (!g.targets.some((x) => x.active)) this.done = true;          // nothing to explore and nothing to hunt
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


  // ---- laser grids as timed gates: predict every beam from the game clock (same formulas as the grid update) ----
  laserBeamsAt(l, T) {
    if (l.disabled) return [];
    if (l.mode === 'PULSE_GATE') {
      const tc = (T * (0.75 + l.speed * 0.18) + l.phase) % 3.6;
      if (tc < 2.10) return [];                                           // OFF or ARMING: harmless (only ACTIVE beams hit)
      return [1.55, 3.55, 5.55].map((y) => ({ x1: l.xMin, y1: y, x2: l.xMax, y2: y }));
    }
    if (l.mode === 'SWEEPER_H') {
      const half = Math.max(0.5, (l.xMax - l.xMin) * 0.5 - 0.35), bx = l.midX + Math.sin(T * l.speed + l.phase) * half;
      return [{ x1: bx, y1: 0.15, x2: bx, y2: WALL_H - 0.15 }];
    }
    if (l.mode === 'TWIN_SWEEP') {
      return [0, 1].map((k) => { const y = Math.max(0.65, Math.min(WALL_H - 0.65, (k ? 4.95 : 2.25) + Math.sin(T * l.speed + l.phase + k * Math.PI) * 1.35)); return { x1: l.xMin, y1: y, x2: l.xMax, y2: y }; });
    }
    const y = Math.max(0.75, Math.min(WALL_H - 0.75, 3.6 + Math.sin(T * l.speed + l.phase) * 2.35));
    return [{ x1: l.xMin, y1: y, x2: l.xMax, y2: y }];
  }

  // Will a rocket at (x, y) on the grid's plane stay clear of every beam from T0 to T1? (hit radius 0.54 m + 0.35 m margin)
  laserSafe(l, T0, T1, x, y) {
    const R = MISSILE_RADIUS + 0.12 + 0.35;
    let step = 0.02;                                                     // a fast sideways sweeper can move metres in 0.02 s: sample finely enough to never skip past
    if (l.mode === 'SWEEPER_H') step = Math.min(0.02, 0.5 * R / (Math.max(0.5, (l.xMax - l.xMin) * 0.5 - 0.35) * Math.abs(l.speed) + 1e-3));
    for (let T = T0; T <= T1 + 1e-9; T += step) {
      for (const b of this.laserBeamsAt(l, T)) {
        const ax = b.x2 - b.x1, ay = b.y2 - b.y1, L2 = ax * ax + ay * ay;
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
    const aim = dz > 3 ? { x: cx, z: l.z + G0.side * 1.5 } : { x: cx, z: l.z - G0.side * 6 };   // line up on the crossing point, then straight over
    let err = Math.atan2(-(aim.x - t.x), -(aim.z - t.z)) - t.yaw; while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
    let yaw = Math.max(-1, Math.min(1, 2.4 * err - 0.35 * t.yawRate));
    if (t.probe.l < 1.3) yaw -= 0.9 * (1.3 - t.probe.l) / 1.3;
    if (t.probe.r < 1.3) yaw += 0.9 * (1.3 - t.probe.r) / 1.3;
    yaw = Math.max(-1, Math.min(1, yaw));
    const climb = Math.max(-1, Math.min(1, 1.6 * (yc - t.y) - 0.3 * t.vSpeed));
    const a = Math.min(9, 0.5 * t.brakeMax), fanCap = t.fan ? Math.max(t.fan[2] > 3 ? 1.2 : 0, Math.sqrt(2 * a * Math.max(0, t.fanW - 1.8))) : 99;
    const vMax = Math.max(2, Math.min(6, t.cruise, fanCap));   // 6 m/s keeps the arrival-time estimate tight
    const ready = Math.abs(t.y - yc) < 0.35 && Math.abs(err) < 0.35;   // at the crossing height and pointing across
    // a speed is good when the rocket would meet the beam line inside a gap (lag: about 0.12 s per m/s of speed change)
    const xs = [t.x, cx];
    const good = (v) => {
      const T = t.time + Math.max(0, dz) / v + Math.abs(v - t.speed) * 0.12, y = ready ? t.y : yc;
      return xs.every((x) => this.laserSafe(l, T - 0.45, T + 1.2 / v + 0.45, x, y));
    };
    if (t.time - G0.t0 > 25) { (this.gateBlock || (this.gateBlock = new Map())).set(l, t.time + 30); this._hz = null; this.gate = null; this.plan = null; this.replanT = 0; this.why = 'LASER GATE: TRYING ANOTHER WAY'; return { yaw: 0, climb, speed: 0 }; }
    if (G0.phase === 'GO') {                                               // committed: hold the speed; a faster or slower one if the timing drifted
      if (good(G0.v)) { this.why = 'LASER GATE: CROSSING'; return { yaw, climb, speed: G0.v }; }
      for (let v = vMax; v >= 1.5; v -= 0.5) if (good(v)) { G0.v = v; this.why = 'LASER GATE: CROSSING'; return { yaw, climb, speed: v }; }
      if (dz > 1.2) { G0.phase = 'APPROACH'; this.why = 'LASER GATE: ABORT'; return { yaw, climb, speed: 0 }; }
      this.why = 'LASER GATE: CROSSING'; return { yaw, climb, speed: vMax };   // too late to stop: fastest way through
    }
    const stopAt = Math.sqrt(2 * a * Math.max(0, dz - 2.5));               // the speed that still stops 2.5 m short
    if (ready) {
      let best = null;                                                     // the safe speed nearest to the current one (smooth), preferring faster
      for (let v = vMax; v >= 1.5; v -= 0.5) if (good(v) && (best === null || Math.abs(v - t.speed) < Math.abs(best - t.speed) - 0.01)) best = v;
      if (best !== null) {
        if (dz < 2.2) { G0.phase = 'GO'; G0.v = best; }
        this.why = dz < 2.2 ? 'LASER GATE: CROSSING' : 'LASER GATE: TIMING THE GAP';
        return { yaw, climb, speed: best };
      }
    }
    this.why = dz < 2.8 ? 'LASER GATE: WAITING FOR A GAP' : 'LASER GATE: APPROACH';
    return { yaw, climb, speed: Math.min(vMax, ready ? stopAt : Math.min(stopAt, 1.5)) };
  }


  // A 3-line (pulse) grid close by: its beams are fixed at 1.55 / 3.55 / 5.55 m, so 2.55 m is safe anywhere, at any angle, any time.
  // Returns the crossing height to hold, or null.
  pulseHeight() {
    const g = this.g, t = this.t;
    if (t.floor !== 0) return null;
    for (const l of g.lasers) if (!l.disabled && l.mode === 'PULSE_GATE' && Math.abs(t.z - l.z) < 8 && t.x > l.xMin - 1.5 && t.x < l.xMax + 1.5) return Math.max(t.y - t.agl + 0.6, Math.min(t.y + t.ceil - 0.6, 2.55));
    return null;
  }
  nearAnyBeam() {
    const g = this.g, t = this.t;
    return g.lasers.some((l) => !l.disabled && Math.abs(t.z - l.z) < 8 && t.x > l.xMin - 1.5 && t.x < l.xMax + 1.5);
  }

  // Look-ahead point on the waypoint polyline, `L` metres ahead of the rocket's projection onto it
  carrot(L) {
    const t = this.t, P = this.plan, wps = P.wps;
    let px = t.x, pz = t.z, left = L;
    for (let n = P.k; n < wps.length; n++) {
      const w = wps[n], dx = w.x - px, dz = w.z - pz, d = Math.hypot(dx, dz);
      if (d >= left || n === wps.length - 1) { const k = d > 0 ? Math.min(1, left / d) : 0; return { x: px + dx * k, z: pz + dz * k, n }; }
      left -= d; px = w.x; pz = w.z;
    }
    const w = wps[wps.length - 1]; return { x: w.x, z: w.z, n: wps.length - 1 };
  }

  // One frame of the new autopilot -> { yaw, climb, speed } (stick units / m/s), same interface as before
  steer(dt) {
    const g = this.g, m = g.missile, t = this.t || this.sense(dt);
    if (!t) return { yaw: 0, climb: 0, speed: 0 };
    this._hazT = (this._hazT || 0) - dt;
    if (this._hazT <= 0) { this._hazT = 2; g.xHazRefresh(); }
    const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    let out = { yaw: 0, climb: 0, speed: 0 };
    // --- at a turret firing spot: face it, climb level with it, let fire control kill it (12 s at most)
    if (this.mission === 'ENGAGE' && this.engT && this.engT.atSpot) {
      const E = this.engT, tu = E.tu;
      E.spotT = (E.spotT || 0) + dt;
      if (!tu.active || E.spotT > 12) {
        if (tu.active) this.turretIgnore.set(tu, t.time + 60);
        g.pushFeed(tu.active ? 'AUTOPILOT: CIWS OUT OF REACH — MOVING ON' : 'AUTOPILOT: CIWS DESTROYED', tu.active ? 'amber' : 'cyan');
        this.engT = null; this.mission = 'EXPLORE'; this.plan = null; this.replanT = 0; this._hz = null;
      } else {
        const brg = wrap(Math.atan2(-(tu.pos.x - t.x), -(tu.pos.z - t.z)) - t.yaw);
        const yT = Math.min(t.y + t.ceil - 0.6, tu.pos.y);
        return this.fire(dt, { yaw: Math.max(-1, Math.min(1, 3 * brg - 0.35 * t.yawRate)), climb: Math.max(-1, Math.min(1, 1.6 * (yT - t.y))), speed: 0 });
      }
    }
    // --- at a laser switch box: face it until fire control has shot it (or 8 s)
    if (this.boxWait) {
      const L = this.boxLaser; this.boxWait.t += dt;
      if (!L || L.disabled || this.boxWait.t > 8) {
        if (L && !L.disabled) { (this.boxTried || (this.boxTried = new Set())).add(L); }
        this.boxWait = null; this.boxGoal = null; this.boxLaser = null; this._hz = null; this.replanT = 0; this.why = L && L.disabled ? 'LASER GRID DOWN' : 'SWITCH BOX NOT HIT';
      } else {
        const brg = wrap(Math.atan2(-(L.relayPos.x - t.x), -(L.relayPos.z - t.z)) - t.yaw);
        out = { yaw: Math.max(-1, Math.min(1, 3 * brg - 0.35 * t.yawRate)), climb: Math.max(-1, Math.min(1, 1.4 * (Math.min(t.y + t.ceil - 0.8, L.relayPos.y) - t.y))), speed: 0 };
        return this.fire(dt, out);
      }
    }
    // --- 360 scan where unexplored tiles are still around
    if (this.scan) {
      const S = this.scan; S.acc += Math.abs(wrap(t.yaw - S.last)); S.last = t.yaw; S.t += dt;
      out = { yaw: 1, climb: Math.max(-1, Math.min(1, (g.autoNodeAlt(t.node) - t.y) * 1.4)), speed: 0 };
      if (S.acc >= Math.PI * 2 + 0.1 || S.t > 10) { this.tried.add(S.goal); this.scan = null; this.replanT = 0; }
      return this.fire(dt, out);
    }
    // --- mission (once a second); a hunt that already sees its target goes straight into the lock-on run
    this._decT -= dt;
    if (this._decT <= 0) { this._decT = 1; if (!(this.huntBlockT > t.time)) this.decide(); }
    if (this.mission === 'HUNT') { const ht = this.huntTerminal(); if (ht) { this.cmd = null; return ht.homing ? ht : this.fire(dt, ht); } }
    // running out of fuel next to a primary target: the engine-out crash blast (8 m) would end the sector early. Keep clear.
    if (this.mission !== 'HUNT' && t.burn > 0 && t.rangeSec < 8) {
      let tg = null, td = 13;
      for (const x of g.targets) if (x.active) { const d = Math.hypot(x.pos.x - t.x, x.pos.z - t.z); if (d < td) { td = d; tg = x; } }
      if (tg) {
        let err = Math.atan2(-(t.x - tg.pos.x), -(t.z - tg.pos.z)) - t.yaw; while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
        const a = Math.min(9, 0.5 * t.brakeMax), v = Math.min(4, Math.max(0, Math.sqrt(2 * a * Math.max(0, (t.fanW || 30) - 1.8))));
        this.why = 'LOW FUEL - KEEPING CLEAR OF THE TARGET'; this.cmd = null;
        return this.fire(dt, { yaw: Math.max(-1, Math.min(1, 2.5 * err - 0.35 * t.yawRate)), climb: 0, speed: Math.abs(err) < 0.8 ? v : 0.5 });
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
        if (!stillFrontier && !this.plan.hunt && !this.plan.pickup && !this.plan.laser && !this.plan.turret) valid = false;   // the goal got explored on the way: pick the next one
        if (this.plan.pickup && !this.plan.pickup.active) valid = false;
        for (const i of this.plan.tiles) if (!this.flyable(X[i]) || (haz && haz[i])) { valid = false; break; }
      }
      this.replanT = 1.5;
      if (!valid) { this.newPlan(); if (this.done) return out; if (this.scan || !this.plan) return this.fire(dt, out); }
    }
    const P = this.plan, wps = P.wps;
    // --- progress along the legs: a waypoint is reached when close, or passed (beyond its perpendicular)
    while (P.k < wps.length) {
      const w = wps[P.k], d = Math.hypot(w.x - t.x, w.z - t.z);
      const nx = P.k + 1 < wps.length ? wps[P.k + 1] : null;
      const passed = nx && ((t.x - w.x) * (nx.x - w.x) + (t.z - w.z) * (nx.z - w.z)) > 0 && d < 3;
      if (w.vert && Math.abs(t.y - w.alt) > 0.9) break;            // over the hole: climb / descend first
      if (w.gate) {                                                    // a laser gate: never "reached" by being near it
        const L = g.lasers[w.gate - 1], nxw = wps[P.k + 1];
        if (!L || L.disabled || (nxw && Math.sign(t.z - L.z) === Math.sign(nxw.z - L.z) && Math.abs(t.z - L.z) > 1.6)) { P.k++; continue; }   // already across
        break;                                                         // still to cross: the gate logic takes it
      }
      if (d < 1.2 || passed) P.k++; else break;
    }
    if (P.k >= wps.length) {
      this.plan = null;
      if (P.laser) { this.boxWait = { t: 0 }; this.why = 'SHOOTING A LASER SWITCH BOX'; return this.fire(dt, { yaw: 0, climb: 0, speed: 0 }); }
      if (P.pickup) { this.pickTried.add(P.pickup); this.mission = 'EXPLORE'; this.replanT = 0; return this.fire(dt, { yaw: 0, climb: 0, speed: 0 }); }
      if (P.turret && this.engT) { this.engT.atSpot = true; this.why = 'ENGAGING CIWS'; return this.fire(dt, { yaw: 0, climb: 0, speed: 0 }); }
      if (P.hunt) { this.replanT = 0.5; this.why = 'HUNT: LOOKING FOR THE TARGET'; return this.fire(dt, { yaw: 0.6, climb: 0, speed: 0 }); }
      this.startScan(P.goal); return this.fire(dt, { yaw: 0, climb: 0, speed: 0 });
    }
    // --- stuck: under 0.8 m of progress in 3 s
    this.stuck.t += dt;
    if (this.stuck.t > 3) { if (Math.hypot(t.x - this.stuck.x, t.z - this.stuck.z) < 0.8) { this.tried.add(P.goal); this.plan = null; this.why = 'STUCK - NEW GOAL'; } this.stuck = { t: 0, x: t.x, z: t.z }; if (!this.plan) return out; }
    // --- laser grid ahead: timed crossing
    const gc = this.gateControl(dt);
    if (gc) { this.cmd = null; g.xroute = P.tiles; return this.fire(dt, gc); }
    // --- guidance: chase a look-ahead point; heading and altitude PD
    const L = Math.max(2.5, Math.min(9, 0.6 * t.speed + 2));
    const cp = this.carrot(L), w = wps[P.k];
    const err = wrap(Math.atan2(-(cp.x - t.x), -(cp.z - t.z)) - t.yaw);
    let yaw = (w.vert && Math.hypot(w.x - t.x, w.z - t.z) < 1.5) ? -0.35 * t.yawRate : 2.4 * err - 0.35 * t.yawRate;   // straight up / down a hole: keep the heading
    let altT = w.alt;
    if (!w.vert) {                                                     // rise / sink gradually along the leg (no early climb into a lintel)
      const pa = P.k > 0 ? wps[P.k - 1] : { x: P.x0 === undefined ? t.x : P.x0, z: P.z0 === undefined ? t.z : P.z0, alt: P.alt0 === undefined ? t.y : P.alt0 };
      if (P.x0 === undefined) { P.x0 = t.x; P.z0 = t.z; }
      const dTot = Math.hypot(w.x - pa.x, w.z - pa.z), dLeft = Math.hypot(w.x - t.x, w.z - t.z);
      const fr = dTot > 0.5 ? Math.max(0, Math.min(1, 1 - dLeft / dTot)) : 1;
      altT = pa.alt + (w.alt - pa.alt) * fr;
    }
    if (g.xgrid && t.node >= 0 && g.xgrid[t.node] === XV.RAMP) altT = g.autoNodeAlt(t.node);   // on a ramp: follow its slope
    altT = Math.max(t.y - t.agl + 0.9, Math.min(t.y + t.ceil - 0.9, altT));   // always inside the room
    const ph = this.pulseHeight(); if (ph !== null) altT = ph;                // a 3-line grid ahead: fly through at the gap height
    const climb = Math.max(-1, Math.min(1, 1.4 * (altT - t.y) - 0.25 * t.vSpeed));
    // --- speed: can we still slow to each coming waypoint's limit with our measured braking? also the free distance ahead
    const a = Math.min(9, 0.5 * t.brakeMax);
    let v = t.cruise, along = Math.hypot(w.x - t.x, w.z - t.z);
    for (let n = P.k; n < Math.min(wps.length, P.k + 4); n++) {
      if (n > P.k) along += Math.hypot(wps[n].x - wps[n - 1].x, wps[n].z - wps[n - 1].z);
      v = Math.min(v, Math.sqrt(wps[n].vmax * wps[n].vmax + 2 * a * Math.max(0, along - 0.8)));
    }
    if (t.fan) v = Math.min(v, Math.max(t.fan[2] > 3 ? 1.2 : 0, Math.sqrt(2 * a * Math.max(0, t.fanW - 1.8))));   // hull-wide clearance ahead; a clear centre line still allows a crawl
    v *= Math.max(0.15, Math.min(1, 1 - Math.abs(err) / 1.0));
    if (w.keep && Math.abs(altT - t.y) > 0.5 && Math.hypot(w.x - t.x, w.z - t.z) < 4) v = Math.min(v, 0.5);   // line up with a tunnel mouth first
    if (w.vert && Math.hypot(w.x - t.x, w.z - t.z) < 1.5) v = Math.min(v, 0.3);                               // floor change: go straight up / down
    if (ph !== null && Math.abs(t.y - ph) > 0.3) { const lz = g.lasers.filter((l) => l.mode === 'PULSE_GATE' && !l.disabled).reduce((a, l) => Math.min(a, Math.abs(t.z - l.z)), 99); if (lz < 3.5) v = Math.min(v, 0.8); }   // not at the gap height yet: ease in
    // --- safety: keep off the side walls
    if (t.probe.l < 1.3) yaw -= 0.9 * (1.3 - t.probe.l) / 1.3;       // wall on the left: turn right
    if (t.probe.r < 1.3) yaw += 0.9 * (1.3 - t.probe.r) / 1.3;
    { const gap = Math.min(t.probe.l, t.probe.r); if (gap < 1.3) v = Math.min(v, 1.5 + 5 * Math.max(0, gap - 0.4)); }   // close to a side wall: slow down
    out = this.avoid({ yaw: Math.max(-1, Math.min(1, yaw)), climb, speed: Math.max(0, v) });
    this.cmd = { err, carrot: cp, v, L };
    g.xroute = P.tiles;
    return this.fire(dt, out);
  }


  // =====================================================================================================
  // STEP 4: mission planner (explore -> pickups -> hunt) and lock-on warhead runs
  // =====================================================================================================
  // Generic route search to the nearest tile accepted by `isGoal` (same costs as the frontier search). Returns tiles or null.
  pathTo(start, isGoal, maxCost) {
    const g = this.g, X = g.xgrid, G = GRID_SIZE, GG = G * G, N = GG * g.nFloors;
    if (!X || start < 0) return null;
    if (g.navFor !== g.ramps) g.navLinksBuild();
    const HZ = this.hazards(), ok = (i) => this.flyable(X[i]) && this.navOk2(i) && !HZ.hard[i];
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), H = [];
    const push = (c, n) => { H.push([c, n]); let k = H.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (H[p][0] <= H[k][0]) break; [H[p], H[k]] = [H[k], H[p]]; k = p; } };
    const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === k) break; [H[m], H[k]] = [H[k], H[m]]; k = m; } } return top; };
    dist[start] = 0; push(0, start);
    while (H.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      if (maxCost && d > maxCost) return null;
      if (isGoal(i)) { const tiles = []; for (let k = i; k !== start && k >= 0; k = prev[k]) tiles.push(k); return tiles.reverse(); }
      const c = i % GG, x = c % G, z = (c / G) | 0;
      const step = (n, base) => { if (!ok(n)) return; if ((HZ.gate[n] || HZ.gate[i]) && (base > 1.2 || (HZ.gate[n] && HZ.gate[n] === HZ.gate[i]))) return; const nd = d + base + (HZ.soft[n] ? 3 : 0) + (HZ.gate[n] ? 12 : 0) + (HZ.danger[n] ? 6 : 0); if (nd < dist[n]) { dist[n] = nd; prev[n] = i; push(nd, n); } };
      if (x > 0) step(i - 1, 1); if (x < G - 1) step(i + 1, 1); if (z > 0) step(i - G, 1); if (z < G - 1) step(i + G, 1);
      if (x > 0 && z > 0 && ok(i - 1) && ok(i - G)) step(i - G - 1, 1.414); if (x < G - 1 && z > 0 && ok(i + 1) && ok(i - G)) step(i - G + 1, 1.414);
      if (x > 0 && z < G - 1 && ok(i - 1) && ok(i + G)) step(i + G - 1, 1.414); if (x < G - 1 && z < G - 1 && ok(i + 1) && ok(i + G)) step(i + G + 1, 1.414);
      const extra = this.links(i); if (extra) for (const n of extra) step(n, 2.5);
    }
    return null;
  }

  tileOf(pos) { const c = this.g.cellAt(pos.x, pos.z); if (c < 0) return -1; return Math.max(0, Math.min(this.g.nFloors - 1, this.g.floorOfY(pos.y))) * GRID_SIZE * GRID_SIZE + c; }

  // A useful pickup we have seen, close by (at most 18 tiles of route), or null
  bestPickup() {
    const g = this.g, t = this.t;
    if (!this.pickTried) this.pickTried = new Set();
    const want = (p) => p.active && p._seen && !this.pickTried.has(p) && (p.type === 'ROCKETS' || p.type === 'OVERCHARGE' ||
      (p.type === 'AMMO' && g.gunAmmo < g.gunCap() * 0.6) || (p.type === 'REPAIR' && (t.hull < 80 || t.fuel < 45)));
    const goals = new Map();
    for (const p of g.pickups) if (want(p)) { const i = this.tileOf(p.pos); if (i >= 0) goals.set(i, p); }
    if (!goals.size) return null;
    const tiles = this.pathTo(t.node, (i) => goals.has(i), 18);
    if (!tiles) return null;
    return { pick: goals.get(tiles.length ? tiles[tiles.length - 1] : t.node), tiles };
  }

  // Decide the mission once a second: hunting waits until nothing reachable is left to explore (or the scan reads 100%, or
  // rockets / hull are low); a seen, useful pickup close by is taken on the way; otherwise explore
  decide() {
    const g = this.g, t = this.t;
    const active = g.targets.filter((x) => x.active);
    const huntNow = active.length && (this.noFrontier || g.scanPercent() >= 100 || t.rockets <= 6 || t.hull < 30);
    let next = 'EXPLORE', pk = null, tp = null;
    if (huntNow) next = 'HUNT';
    else if (this.mission === 'ENGAGE' && this.engT && this.engT.tu.active && t.time - this.engT.t0 < 25) next = 'ENGAGE';
    else if ((tp = this.planTurret(t.node))) { next = 'ENGAGE'; this.engT = { tu: tp.tu, tiles: tp.tiles, t0: t.time }; }
    else if ((pk = this.bestPickup())) next = 'PICKUP';
    if (next !== this.mission || (next === 'PICKUP' && (!this.pickNow || this.pickNow.pick !== pk.pick))) {
      if (next !== this.mission) g.pushFeed(next === 'HUNT' ? 'AUTOPILOT: HUNTING THE PRIMARY TARGETS (LOCK-ON)' : (next === 'PICKUP' ? `AUTOPILOT: PICKING UP ${pk.pick.type}` : (next === 'ENGAGE' ? 'AUTOPILOT: ENGAGING A CIWS TURRET' : 'AUTOPILOT: EXPLORING')), 'cyan');
      this.mission = next; this.pickNow = pk; this.plan = null; this.scan = null; this.replanT = 0;
    }
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
    if (!tiles) { this.plan = null; this.why = 'NO ROUTE TO A TARGET YET'; this.mission = 'EXPLORE'; this.noFrontier = false; this.huntBlockT = t.time + 15; return; }
    if (!tiles.length) { this.plan = null; this.why = 'AT THE TARGET'; return; }
    this.plan = { goal: tiles[tiles.length - 1], tiles, wps: this.smooth(tiles), k: 0, t0: t.time, alt0: t.y, hunt: true };
    g.xroute = tiles.slice(); this.why = 'ROUTE TO A PRIMARY TARGET';
  }

  newPickupPlan() {
    const P = this.pickNow, t = this.t;
    if (!P || !P.pick.active) { this.mission = 'EXPLORE'; this.plan = null; return; }
    if (!P.tiles.length) { this.pickTried.add(P.pick); this.mission = 'EXPLORE'; this.plan = null; return; }
    this.plan = { goal: P.tiles[P.tiles.length - 1], tiles: P.tiles, wps: this.smooth(P.tiles), k: 0, t0: t.time, alt0: t.y, pickup: P.pick };
    this.g.xroute = P.tiles.slice(); this.why = 'ROUTE TO A PICKUP';
  }

  // Terminal phase of a hunt: once a primary target is in clear thermal sight and lock range, turn until it is inside the seeker
  // cone, lock on with the game's lock system and let homing fly the warhead into the proximity fuze. Returns flight commands or null.
  huntTerminal() {
    const g = this.g, t = this.t, m = g.missile, TP = g.lidarParams(true);
    let tg = null, td = Infinity;
    for (const x of g.targets) if (x.active) { const d = m.pos.distanceTo(x.pos); if (d < td) { td = d; tg = x; } }
    if (!tg || td > TP.lockRange || !tg.mesh.userData._tv || !g.los3(t.x, t.y, t.z, tg.pos.x, tg.pos.y, tg.pos.z)) return null;
    let brg = Math.atan2(-(tg.pos.x - t.x), -(tg.pos.z - t.z)) - t.yaw; while (brg > Math.PI) brg -= Math.PI * 2; while (brg < -Math.PI) brg += Math.PI * 2;
    const cone = TP.seekerDeg * Math.PI / 180 * 0.8;
    const climb = Math.max(-1, Math.min(1, 1.4 * (tg.pos.y - t.y)));
    if (!(g.manualTargetLock && g.lockedEnemy && g.lockedEnemy.ref === tg)) {
      if (Math.abs(brg) > cone) { this.why = 'HUNT: TURNING ONTO THE TARGET'; return { yaw: Math.max(-1, Math.min(1, 3 * brg - 0.35 * t.yawRate)), climb, speed: 0.5 }; }
      g.lockedEnemy = null; g.manualTargetLock = false;
      const cand = g.findBestEnemyTarget();
      if (cand && cand.ref === tg) g.toggleTargetLock(); else return { yaw: Math.max(-1, Math.min(1, 3 * brg)), climb, speed: 0.5 };
    }
    this.why = 'HUNT: LOCKED - WARHEAD RUN';
    return { yaw: 0, climb, speed: Math.min(t.cruise, Math.max(3, td)), homing: true };   // homing steers; the fuze fires at 5 units
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
  threats() {
    const g = this.g, t = this.t, out = [];
    const range = 26 + Math.min(14, (g.difficultyTier - 1) * 0.7);
    if (this.knownTurrets) for (const tu of this.knownTurrets) {
      if (!tu.active) continue;
      const d = Math.hypot(tu.pos.x - t.x, tu.pos.y - t.y, tu.pos.z - t.z);
      if (d < range && g.los3(tu.pos.x, tu.pos.y, tu.pos.z, t.x, t.y, t.z)) out.push({ kind: 'CIWS', obj: tu, x: tu.pos.x, y: tu.pos.y, z: tu.pos.z, d });
    }
    for (const s of g.sentries) {
      if (!s.active || s.dying || !s.alerted) continue;
      const d = Math.hypot(s.pos.x - t.x, s.pos.z - t.z);
      if (d < 16 && g.los3(s.pos.x, s.pos.y + 1.45, s.pos.z, t.x, t.y, t.z)) out.push({ kind: 'SENTRY', obj: s, x: s.pos.x, y: s.pos.y + 1.45, z: s.pos.z, d });
    }
    return out;
  }

  // Applied on top of the flight commands while exposed: keep moving (min 4.5 m/s unless a wall is close or we are lined up
  // and firing), weave the heading when flying straight at / away from a shooter, and bob the altitude (shooting: bob only).
  evade(out, firing) {
    const g = this.g, t = this.t, TH = this.threats();
    this.exposed = TH.length > 0;
    if (!this.exposed) { this._evT = 0; return out; }
    if (!this._evMsgT || t.time - this._evMsgT > 8) { this._evMsgT = t.time; g.pushFeed(`AUTOPILOT: UNDER FIRE (${TH[0].kind}) — EVADING`, 'amber'); }
    this._evT = (this._evT || 0) + 0.016;
    const ph = t.time;
    // vertical bob, inside the room's floor / ceiling margins (smaller while firing so the aim holds)
    const room = this.nearAnyBeam() ? 0 : Math.max(0, Math.min(t.agl - 0.9, t.ceil - 0.9));   // no bobbing near laser beams
    const amp = firing ? 0.35 : 0.9;
    if (room > 0.2) out.climb = Math.max(-1, Math.min(1, out.climb + amp * Math.min(1, room / 1.2) * Math.sin(ph * 4.4)));
    if (firing) return out;
    // heading weave when the nearest shooter is roughly ahead or behind (radial flight barely moves across its line of fire)
    const th = TH.reduce((a, b) => (a.d < b.d ? a : b));
    let brg = Math.atan2(-(th.x - t.x), -(th.z - t.z)) - t.yaw; while (brg > Math.PI) brg -= Math.PI * 2; while (brg < -Math.PI) brg += Math.PI * 2;
    const radial = Math.abs(brg) < 0.7 || Math.abs(brg) > Math.PI - 0.7;
    if (radial && Math.min(t.probe.l, t.probe.r) > 1.4) out.yaw = Math.max(-1, Math.min(1, out.yaw + 0.55 * Math.sin(ph * 5.6)));
    // never hover still under fire, unless a wall is close ahead
    const room2 = t.fanW === undefined ? 30 : t.fanW;
    const turning = this.cmd && Math.abs(this.cmd.err) > 0.6;
    const nearBeam = g.lasers.some((l) => !l.disabled && Math.abs(t.z - l.z) < 4 && t.x > l.xMin - 1 && t.x < l.xMax + 1);
    if (room2 > 4 && !this.scan && !turning && !nearBeam) out.speed = Math.max(out.speed, Math.min(4.5, Math.sqrt(2 * 6 * Math.max(0, room2 - 2.5))));
    return out;
  }

  // =====================================================================================================
  // TURRET ENGAGEMENT. CIWS turrets out-range thermal (about 30 m against 18 m) and hang from the ceiling. The gun fires level,
  // so they are fought from their own floor: a spot 9-15 m away with a clear line, at turret height just under the ceiling.
  // =====================================================================================================
  planTurret(start) {
    const g = this.g, t = this.t, G = GRID_SIZE, GG = G * G;
    if (!this.knownTurrets || !this.knownTurrets.size) return null;
    if (!this.turretIgnore) this.turretIgnore = new Map();
    let bestP = null;
    for (const tu of this.knownTurrets) {
      if (!tu.active || (this.turretIgnore.get(tu) || 0) > t.time) continue;
      const tf = Math.max(0, Math.min(g.nFloors - 1, g.floorOfY(tu.pos.y)));
      const goals = new Set();
      const cr = 4, tgx = worldToGridX(tu.pos.x), tgz = worldToGridZ(tu.pos.z);
      for (let gz = Math.max(0, tgz - cr); gz <= Math.min(G - 1, tgz + cr); gz++) for (let gx = Math.max(0, tgx - cr); gx <= Math.min(G - 1, tgx + cr); gx++) {
        const x = gridToWorldX(gx), z = gridToWorldZ(gz), d = Math.hypot(tu.pos.x - x, tu.pos.z - z);
        if (d < 9 || d > 15) continue;
        const i = tf * GG + gz * G + gx;
        if (g.los3(x, tu.pos.y - 0.3, z, tu.pos.x, tu.pos.y, tu.pos.z)) goals.add(i);
      }
      if (!goals.size) continue;
      const tiles = this.pathTo(start, (i) => goals.has(i), 30);
      if (tiles && (!bestP || tiles.length < bestP.tiles.length)) bestP = { tu, tiles };
    }
    return bestP;
  }

  // Fire control on top of the flight commands (step 3)
  fire(dt, out) {
    out = this.fireControl(dt, out);
    const hold = !!(this.gate || this.boxWait || this.scan || (this.engT && this.engT.atSpot));   // holding a position on purpose: bob only
    out = this.evade(out, !!(this.shot && this.shot.onTarget) || hold);
    return this.laserGuard(this.smoothCmd(dt, out));
  }

  // Last word on every command near a 3-line grid: hold the gap height firmly (also while braking hard),
  // and never move into the beam plane until that height is reached.
  laserGuard(out) {
    const g = this.g, t = this.t;
    if (out.homing || !t || t.floor !== 0) return out;
    const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
    for (const l of g.lasers) {
      if (l.disabled || l.mode !== 'PULSE_GATE') continue;
      const dz = t.z - l.z;
      if (Math.abs(dz) > 5 || t.x < l.xMin - 1.5 || t.x > l.xMax + 1.5) continue;
      const ph = Math.max(t.y - t.agl + 0.6, Math.min(t.y + t.ceil - 0.6, 2.55));
      out = { ...out, climb: Math.max(-1, Math.min(1, 2.2 * (ph - t.y) - 0.35 * t.vSpeed)) };
      if (Math.abs(t.y - ph) > 0.3 && Math.abs(dz) < 2.2 && Math.sign(dz) * fz < 0) out.speed = 0;   // heading into the plane off-height: wait for the climb
    }
    return out;
  }

  // Feel: rate-limit the stick and speed so the rocket flies smoothly instead of twitching between commands
  smoothCmd(dt, out) {
    if (this.gate) { this._cmdPrev = { yaw: out.yaw, climb: out.climb, speed: out.speed }; return out; }   // laser gates: exact, unsmoothed commands
    const p = this._cmdPrev || { yaw: 0, climb: 0, speed: out.speed };
    const lim = (a, b, r) => a + Math.max(-r * dt, Math.min(r * dt, b - a));
    const o = { yaw: lim(p.yaw, out.yaw, 5), climb: lim(p.climb, out.climb, 4), speed: out.speed < p.speed ? out.speed : lim(p.speed, out.speed, 9) };   // braking is never delayed
    if (out.homing) o.homing = true;
    this._cmdPrev = o;
    return o;
  }

  // =====================================================================================================
  // STEP 3: target acquisition and fire control (bracketed contacts only: sentries, CIWS turrets, laser switch boxes)
  // =====================================================================================================
  // Tracks: one per bracketed contact, with a smoothed velocity estimate and a lock that confirms after 6 frames in view
  updateTracks(dt) {
    const t = this.t, now = t.time;
    if (!this.tracks) this.tracks = new Map();
    for (const c of t.contacts) {
      let k = this.tracks.get(c.obj);
      if (!k) { k = { obj: c.obj, kind: c.kind, x: c.x, y: c.y, z: c.z, vx: 0, vz: 0, seen: 0, first: now }; this.tracks.set(c.obj, k); }
      const a = Math.min(1, dt * 6);
      if (dt > 0) { k.vx += ((c.x - k.x) / dt - k.vx) * a; k.vz += ((c.z - k.z) / dt - k.vz) * a; }
      k.x = c.x; k.y = c.y; k.z = c.z; k.d = c.d; k.threat = c.threat; k.last = now; k.seen++;
    }
    for (const [o, k] of this.tracks) if (now - k.last > 1.5 || (o.active === false) || (o.dying) || (k.kind === 'LASER BOX' && o.disabled)) this.tracks.delete(o);
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
  // Mutates `out` ({yaw, climb, speed}) while engaging.
  fireControl(dt, out) {
    const g = this.g, t = this.t, wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    this.updateTracks(dt);
    if (!this.ignoreUntil) this.ignoreUntil = new Map();
    const F = this.fc || (this.fc = { tgt: null, since: 0, burst: 0, pause: 0 });
    g.gunHeld = false; this.shot = null;
    if (g.gunAmmo <= 0 || g.missile.drop > 0) { F.tgt = null; return out; }
    const SPEC = { 'CIWS': { pri: 8, range: 30, hitR: 1.0, vert: 0.8, need: GUN_HITS.turret }, 'SENTRY': { pri: 5, range: 28, hitR: 0.7, vert: 0.95, need: GUN_HITS.sentry }, 'LASER BOX': { pri: 4, range: 36, hitR: 0.75, vert: 0.6, need: GUN_HITS.box } };
    // pick: confirmed locks only, in range, not given up; threats and blocking laser boxes first, then closest / most in front
    let best = null, bestS = -1e9;
    for (const k of this.tracks.values()) {
      const sp = SPEC[k.kind]; if (!sp || k.seen < 6 || k.d > sp.range) continue;
      if ((this.ignoreUntil.get(k.obj) || 0) > t.time) continue;
      if (k.kind !== 'CIWS' && !k.threat && g.gunAmmo <= 4) continue;           // keep a few rounds for threats
      let brg = wrap(Math.atan2(-(k.x - t.x), -(k.z - t.z)) - t.yaw);
      let pri = sp.pri + (k.kind === 'SENTRY' && k.threat ? 2 : 0) + (k.kind === 'LASER BOX' && this.boxGoal === k.obj ? 6 : 0);
      const sc = pri * 10 - k.d * 0.4 - Math.abs(brg) * 3 + (F.tgt === k ? 6 : 0);  // stick with the current target (no flip-flop)
      if (sc > bestS) { bestS = sc; best = k; }
    }
    if (!best) { F.tgt = null; return out; }
    if (F.tgt !== best) { F.tgt = best; F.since = t.time; F.burst = 0; F.pause = 0; }
    if (t.time - F.since > 6) { this.ignoreUntil.set(best.obj, t.time + 20); F.tgt = null; return out; }   // no kill in 6 s: give up for 20 s
    const sp = SPEC[best.kind];
    // lead: bullet time of flight at 120 m/s plus our own speed; aim at where a moving sentry will be
    const tof = best.d / (GUN_SPEED + t.speed);
    const ax = best.x + best.vx * tof, az = best.z + best.vz * tof;
    const yawErr = wrap(Math.atan2(-(ax - t.x), -(az - t.z)) - t.yaw);
    // altitude: the gun fires level from the nose, so match the target's hit height (within the room's floor / ceiling)
    const aimY = Math.max(t.y - t.agl + 1.0, Math.min(t.y + t.ceil - 0.8, best.y));
    // steer onto the lead point; slow right down while engaging
    out.yaw = Math.max(-1, Math.min(1, 3.0 * yawErr - 0.35 * t.yawRate));
    out.climb = Math.max(-1, Math.min(1, 1.6 * (aimY - t.y) - 0.25 * t.vSpeed));
    out.speed = Math.min(out.speed, 1.5);
    // predicted miss at the target: sideways (from the heading error) and vertical (level shot vs hit window)
    const latMiss = Math.abs(Math.sin(yawErr)) * best.d, vertMiss = Math.abs(t.y - best.y);
    const clearShot = g.los3(t.x, t.y, t.z, best.x, best.y, best.z) && !this.barrelInLine(best.x, best.y, best.z);
    const onTarget = latMiss < sp.hitR * 0.8 && vertMiss < sp.vert;
    // bursts: as many rounds as the target needs plus two, then a short pause to re-aim
    F.pause = Math.max(0, F.pause - dt);
    let fire = false;
    if (onTarget && clearShot && F.pause <= 0) { fire = true; F.burst += dt * GUN_RATE; if (F.burst >= sp.need + 2) { F.burst = 0; F.pause = 0.15; } }
    g.gunHeld = fire;
    this.shot = { kind: best.kind, d: best.d, lead: Math.hypot(ax - best.x, az - best.z), latMiss, vertMiss, onTarget, clearShot, fire, lockFrames: best.seen };
    return out;
  }

  // When live laser grids are all that blocks the rest of the map: go where thermal can see a grid's switch box (it gets its
  // brackets there) so fire control can shoot it. Returns a plan or null.
  planLaserBox(start) {
    const g = this.g, X = g.xgrid, G = GRID_SIZE, GG = G * G, P = g.lidarParams(), reach = Math.max(8, P.thermal * 0.8);
    const live = g.lasers.filter((l) => !l.disabled && l.relayActive && l.lockRef && l.lockRef.active && (this.boxTried || new Set()).has(l) === false);
    if (!live.length || !X) return null;
    // only grids we have already seen: some tile of their row is explored
    const seen = live.filter((l) => {                                 // a grid counts as seen once any tile along its beams is on the map
      for (let x = l.xMin; x <= l.xMax + 0.01; x += CELL_SIZE * 0.5) { const c = g.cellAt(x, l.z); if (c >= 0 && (X[c] || X[c + G] || X[c - G])) return true; }
      const c = g.cellAt(l.relayPos.x, l.relayPos.z); return c >= 0 && !!X[c];
    });
    if (!seen.length) return null;
    const HZ = this.hazards(), ok = (i) => this.flyable(X[i]) && this.navOk2(i) && !HZ.hard[i];
    const dist = new Int32Array(GG * g.nFloors).fill(-1), prev = new Int32Array(GG * g.nFloors).fill(-1), q = [start];
    dist[start] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % GG, f = (i / GG) | 0, p = this.tileCenter(i), y = f * WALL_H + 2.2;
      for (const l of seen) {
        const d = Math.hypot(l.relayPos.x - p.x, l.relayPos.z - p.z);
        if (f === 0 && d < reach && d > 3 && g.los3(p.x, y, p.z, l.relayPos.x, l.relayPos.y, l.relayPos.z)) {
          const tiles = []; for (let k = i; k !== start && k >= 0; k = prev[k]) tiles.push(k);
          return { goal: i, tiles: tiles.reverse(), laser: l };
        }
      }
      const x = c % G, z = (c / G) | 0, nb = [];
      if (x > 0) nb.push(i - 1); if (x < G - 1) nb.push(i + 1); if (z > 0) nb.push(i - G); if (z < G - 1) nb.push(i + G);
      const extra = this.links(i); if (extra) nb.push(...extra);
      for (const n of nb) if (dist[n] < 0 && ok(n)) { dist[n] = dist[i] + 1; prev[n] = i; q.push(n); }
    }
    return null;
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
      this.active ? `NEW PILOT [${this.mission}${this.noFrontier ? ' NO-FRONTIER' : ''}${this.exposed ? ' UNDER FIRE' : ''}]: ${this.why}${this.plan ? `  GOAL ${this.tileCenter(this.plan.goal).x.toFixed(0)},${this.tileCenter(this.plan.goal).z.toFixed(0)}  TILES ${this.plan.tiles.length}  LEG ${this.plan.k + 1}/${this.plan.wps.length}` : ''}${this.cmd ? `  ERR ${Math.round(this.cmd.err * 180 / Math.PI)}deg  VDES ${this.cmd.v.toFixed(1)}  LOOK ${this.cmd.L.toFixed(1)}m` : ''}${this.scan ? '  SCANNING' : ''}` : 'NEW PILOT: off (legacy autopilot)'
    ].join('\n');
  }
}
