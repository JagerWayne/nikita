/* Rocket flight for NikitaGame: per-frame missile physics, hover/landing, speed lever, camera and the autopilot glue. */
import {
  BURN_TIME, CELL_RAMP, CELL_SHAFT_LOW, CELL_SIZE, CRUISE_THROTTLE, FLIP_TIME, FUZE_RANGE, GRID_SIZE,
  HOVER_CLIMB, HOVER_SPEED_MAX, LAND_ARM_TIME, LAND_LEAN, LAND_PITCH, LAND_SINK, LAND_SPEED, LAND_TAKEOFF,
  LAUNCH_GRAVITY, LIFT_SPEED, MISSILE_RADIUS, POINTS_BONUS, PROBE_RANGE, SPEED_MIN, SUBSTEPS, TAKEOFF_HEIGHT,
  TAKEOFF_RISE, TAKEOFF_SPOOL, WALL_H, isShaft, isWalkable, CHASE_CAM
} from './constants.js';
import {
  PROBE_DIRS, _e1, _fwd, _profile, _profileCam, _v1, _v2, _v3, _v4, _v5, _v6, _v7, _v8, blendProfile,
  gridToWorldX, gridToWorldZ, worldToGridX, worldToGridZ, wrapPi
} from './math.js';

export const flightMethods = {

  // Distances from the rocket's hull to the nearest wall/floor/roof on each side (left, right, up, down), max PROBE_RANGE.
  updateProbes(m) {
    const P = m.probe || (m.probe = { l: PROBE_RANGE, r: PROBE_RANGE, u: PROBE_RANGE, d: PROBE_RANGE });
    const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);
    const side = (sx, sz) => {
      for (let d = 0.5; d <= PROBE_RANGE; d += 0.5) {
        if (this.isGridSolid(m.pos.x + sx * d, m.pos.z + sz * d, m.pos.y)) {
          // refine the last half step
          let lo = d - 0.5, hi = d;
          for (let i = 0; i < 4; i++) { const mid = (lo + hi) * 0.5; if (this.isGridSolid(m.pos.x + sx * mid, m.pos.z + sz * mid, m.pos.y)) hi = mid; else lo = mid; }
          return Math.max(0, hi - MISSILE_RADIUS);
        }
      }
      return PROBE_RANGE;
    };
    P.l = side(-rx, -rz);
    P.r = side(rx, rz);
    this.localSurf(m.pos.x, m.pos.y, m.pos.z);
    P.u = Math.min(PROBE_RANGE, Math.max(0, this._sc - m.pos.y - MISSILE_RADIUS));
    P.d = Math.min(PROBE_RANGE, Math.max(0, m.pos.y - this._sf - MISSILE_RADIUS));
  },

  // Extra flight physics: gusts, surface cushions, low-speed sag, acceleration pitch, and recoil/shock kicks (m.kickP / m.kickY
  // are visual-and-aim nudges that decay). Everything is small so steering stays predictable.
  applyRocketFX(m, dt, hasFuel) {
    const spd = m.vel.length();
    const sfw = Math.min(1, spd / Math.max(1, this.maxSpeed()));
    const t = this.gameClock;
    const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);
    const tight = m.wallProximity || 0;                      // 0 in open halls, up to 1 right beside a wall

    if (m.hover) this.applyHoverFX(m, dt, hasFuel, spd);

    // 1) buffeting: smooth gusts grow with speed and in tight passages
    if (hasFuel) {
      const gAmp = (0.25 + 1.6 * sfw + 1.4 * tight * sfw) * dt * (m.hover ? 0.25 : 1);
      const gx = Math.sin(t * 2.9 + 0.4) + 0.7 * Math.sin(t * 5.3 + 2.0);
      const gy = Math.sin(t * 3.7 + 1.1) + 0.7 * Math.sin(t * 6.1 + 0.3);
      m.vel.x += rx * gx * gAmp; m.vel.z += rz * gx * gAmp; m.vel.y += gy * gAmp * 0.6;
      m.kickY = (m.kickY || 0) + gx * 0.0012 * sfw;
    }

    // 2) air cushion: a fast rocket is pushed away from walls, floor and roof it flies close to
    const P = m.probe;
    if (P && spd > 5 && hasFuel && !m.hover) {
      const push = (d, lim) => (d < lim ? ((lim - d) / lim) * 3.2 * sfw * dt : 0);
      const l = push(P.l, 1.7), r = push(P.r, 1.7);
      m.vel.x += rx * (l - r); m.vel.z += rz * (l - r);
      m.vel.y += push(P.d, 1.4) * (m.landReq ? 0 : 1) - push(P.u, 1.4);
    }

    // 3) low-speed sag: below crawl speed the nose droops and the rocket sinks a little (not while landing)
    if (!m.landReq && !m.hover && spd < 9 && hasFuel) {
      const sag = 1 - spd / 9;
      m.vel.y -= sag * 1.6 * dt;
      m.kickP = (m.kickP || 0) - sag * 0.12 * dt;
    }

    // 4) acceleration pitch: speeding up lifts the nose, braking dips it
    const acc = (m.currentSpeed - (m._spd0 === undefined ? m.currentSpeed : m._spd0)) / Math.max(dt, 1e-3);
    m._spd0 = m.currentSpeed;
    let kickTarget = Math.max(-0.045, Math.min(0.045, acc * 0.003));
    if (m.hover) kickTarget = -Math.min(1, spd / HOVER_SPEED_MAX) * 0.07 - Math.max(-0.06, Math.min(0.06, acc * 0.02));   // like a helicopter: leans into the move

    // 4b) braking dip: a damped spring drives a visual nose pitch (m.brakeP, added to the model and the view but not to the
    //     flight path). Losing speed pushes the nose down, gaining it lifts the nose, impacts and hover braking add impulses.
    //     The spring overshoots a little, so the nose dips, bobs back up and settles.
    {
      const F = Math.max(-11, Math.min(3.5, acc * 0.075));
      m.brakeV = (m.brakeV || 0) + (F - 38 * (m.brakeP || 0) - 6.5 * (m.brakeV || 0)) * dt;
      m.brakeP = Math.max(-0.45, Math.min(0.22, (m.brakeP || 0) + m.brakeV * dt));
      if (F < -4 && !m.hover) this.cameraTrauma = Math.max(this.cameraTrauma, 0.06 + Math.min(0.2, -F * 0.02));   // hard braking rattles the view
    }

    // 6) hard turns at speed: g-forces rumble the view
    this.cameraTrauma = Math.max(this.cameraTrauma, Math.min(0.16, Math.abs(m.yawRate) * sfw * 0.12));

    // 7) running on fumes: below 14% fuel the engine coughs now and then (a dip in speed, a nose drop, a shudder)
    if (hasFuel && !this.cfg.infFuel && m.fuel < 14 && m.drop <= 0) {
      m._sput = (m._sput === undefined ? 1 : m._sput) - dt;
      if (m._sput <= 0) {
        m._sput = 1.3 + Math.random() * 2.2;
        m.currentSpeed *= 0.9;
        m.brakeV = (m.brakeV || 0) - 0.9;
        this.cameraTrauma = Math.max(this.cameraTrauma, 0.28);
        this.audio.playSputter();
      }
    }

    // 5) kicks relax toward the acceleration pitch / zero
    m.kickP = (m.kickP || 0) + (kickTarget - (m.kickP || 0)) * Math.min(1, dt * 5);
    m.kickY = (m.kickY || 0) * Math.exp(-dt * 6);
    m.kickP = Math.max(-0.18, Math.min(0.18, m.kickP));
    m.kickY = Math.max(-0.12, Math.min(0.12, m.kickY));
  },

  // Hover-only effects: breeze drift, thruster pulse, ground cushion, wall/roof wash with shake, sway
  applyHoverFX(m, dt, hasFuel, spd) {
    if (!hasFuel) return;
    const t = this.gameClock, P = m.probe;
    // a hovering rocket never sits perfectly still: a slow breeze drifts it and the thrusters pulse
    const wx = Math.sin(t * 0.63 + 1.7) + 0.6 * Math.sin(t * 1.37), wz = Math.sin(t * 0.51 + 0.2) + 0.6 * Math.sin(t * 1.19 + 2.3);
    m.vel.x += wx * 0.32 * dt; m.vel.z += wz * 0.32 * dt;
    m.vel.y += Math.sin(t * 2.3) * 0.35 * dt;
    m.roll += Math.sin(t * 1.4) * 0.0016 + Math.sin(t * 2.7 + 1) * 0.001;
    if (!P) return;
    // ground cushion: close to the floor the exhaust builds a pillow of air that slows a descent and lifts the nose
    if (P.d < 1.6) {
      const k = 1 - P.d / 1.6;
      if (m.vel.y < 0 && !m.landReq) m.vel.y *= Math.max(0, 1 - dt * 4.5 * k);
      m.vel.y += 0.7 * k * dt;
      this.cameraTrauma = Math.max(this.cameraTrauma, 0.05 + 0.1 * k);
      if (m.vel.y < -0.6 && k > 0.5) m.kickP = (m.kickP || 0) + 0.004;
    }
    // prop wash off walls and roof: pushes the rocket away and rattles the view
    const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);
    const wash = (d, ax, ay, az) => {
      if (d >= 1.5) return;
      const k = 1 - d / 1.5;
      m.vel.x += ax * 1.1 * k * dt; m.vel.y += ay * 1.1 * k * dt; m.vel.z += az * 1.1 * k * dt;
      this.cameraTrauma = Math.max(this.cameraTrauma, 0.04 + 0.1 * k);
    };
    wash(P.l, rx, 0, rz); wash(P.r, -rx, 0, -rz); wash(P.u, 0, -1, 0);
    // an idle hover sways side to side with the yaw spin
    m.kickY = (m.kickY || 0) + m.yawRate * 0.0006;
  },

  // Impulse from a shockwave or recoil; dir must be a unit vector pointing the way the rocket is shoved
  shoveRocket(dir, mag, pitchKick = 0, yawKick = 0) {
    const m = this.missile;
    m.vel.addScaledVector(dir, mag);
    m.kickP = (m.kickP || 0) + pitchKick;
    m.kickY = (m.kickY || 0) + yawKick;
  },

  // Proximity fuze test: armed, past the launch drop, within FUZE_RANGE of the point, and not behind a wall
  fuzeNear(p, x, y, z, dist, isPrimary) {
    const autoOk = !this.missile.auto || (isPrimary && this.pilot && this.pilot.active && this.pilot.mission === 'HUNT') ||   // the autopilot only blows up on a primary target it is hunting...
      Boolean(this.pilot && this.pilot.active && this.pilot.lastGasp);   // ...or on its last-gasp target when the fuel is nearly gone
    return this.fuzeMode !== 'det' && autoOk && dist < FUZE_RANGE && this.missile.drop <= 0 && this.los3(p.x, p.y, p.z, x, y, z);
  },

  /* ------------------------------------------------------------------------
     AUTO DISCOVERY: the rocket hovers its way around the facility until every reachable edge is outlined
     ------------------------------------------------------------------------ */
  navOk(i) {
    const GG = GRID_SIZE * GRID_SIZE, f = (i / GG) | 0;
    if (f < 0 || f >= this.nFloors) return false;
    const v = this.floors[f][i % GG];
    return isWalkable(v) || v === CELL_RAMP || (f === 0 && isShaft(v));
  },

  // The (floor, cell) node the rocket is in (or the nearest valid one above/below), or -1
  autoNode(m) {
    const GG = GRID_SIZE * GRID_SIZE, c = this.cellAt(m.pos.x, m.pos.z);
    if (c < 0) return -1;
    const f0 = this.floorOfY(m.pos.y);
    for (const f of [f0, f0 - 1, f0 + 1]) if (f >= 0 && f < this.nFloors && this.navOk(f * GG + c)) return f * GG + c;
    return -1;
  },

  autoNodeAlt(i) {
    const G = GRID_SIZE, GG = G * G, f = (i / GG) | 0, c = i % GG;
    if (f === 0 && isShaft(this.floors[0][c])) return (this.floors[0][c] - CELL_SHAFT_LOW) * WALL_H / 3 + WALL_H / 6;   // middle of the tunnel opening
    if (this.floors[f][c] === CELL_RAMP) {
      const r = this.ramps[this.rampAt.get(i)];
      if (r) return this.rampHeight(r, gridToWorldX(c % G), gridToWorldZ((c / G) | 0)) + 1.5;
    }
    return f * WALL_H + 2.0;
  },

  // Cells to keep away from: turbines, bulkheads, live laser grids, barrels and grates
  // (one buffer, refilled on every call: the caller keeps it as this._xHaz)
  autoBlocked() {
    const GG = GRID_SIZE * GRID_SIZE, n = GG * this.nFloors;
    let B = this._abBuf;
    if (!B || B.length !== n) B = this._abBuf = new Uint8Array(n); else B.fill(0);
    for (const t of this.turbines) this._discMark(B, t.pos.x, t.pos.z, 3.2, 0);
    for (const b of this.bulkheads) this._discMark(B, b.x, b.z, 3.0, 0);
    for (const g of this.grates) if (g.active) this._discMark(B, g.pos.x, g.pos.z, 2.2, 0);
    for (const b of this.barrels) if (b.active) this._discMark(B, b.pos.x, b.pos.z, 1.8, Math.min(this.nFloors - 1, Math.max(0, Math.floor(b.pos.y / WALL_H))));
    for (const l of this.lasers) {
      if (l.disabled) continue;
      for (let x = l.xMin - 1; x <= l.xMax + 1; x += CELL_SIZE * 0.5) this._discMark(B, x, l.z, 1.2, 0);
    }
    return B;
  },

  // mark every tile within r (+ half a cell) of (x, z) on floor f in layer B
  _discMark(B, x, z, r, f) {
    const G = GRID_SIZE, GG = G * G;
    const g0 = worldToGridX(x - r - 2), g1 = worldToGridX(x + r + 2), z0 = worldToGridZ(z - r - 2), z1 = worldToGridZ(z + r + 2);
    for (let gz = Math.max(0, z0); gz <= Math.min(G - 1, z1); gz++) for (let gx = Math.max(0, g0); gx <= Math.min(G - 1, g1); gx++) {
      if (Math.hypot(gridToWorldX(gx) - x, gridToWorldZ(gz) - z) < r + CELL_SIZE * 0.5) B[f * GG + gz * G + gx] = 1;
    }
  },

  // AUTO button: full autopilot. It scans, grabs useful pickups, guns down sentries / turrets / laser boxes / barrels / grates,
  // hunts the primary targets with the proximity fuze, adjusts its speed to the room it has, and relaunches by itself.
  // Press again (or move the stick) to take over.
  pressAuto() {
    const m = this.missile;
    if (this.autoPlay || m.auto) { this.autoPlay = false; this.autoStop('AUTOPILOT OFF'); return; }
    if (this.state === 'READY') { this.autoPlay = true; this._autoFireT = 0; this.pushFeed('AUTOPILOT ON — IT LAUNCHES THE ROCKET ITSELF', 'cyan'); return; }
    if (this.state !== 'PLAYING' || !m.active || m.drop > 0 || m.flipping || m.fuel <= 0) return;
    this.autoPlay = true;
    if (m.landed) { this.pressHover(); return; }          // lift off to a hover; the autopilot takes over once airborne
    this.autoEngage();
  },

  autoEngage() {
    const m = this.missile;
    if (m.fuel <= 0 || m.landed) return;
    if (!m.hover) this.pressHover();
    m.auto = true; m.landReq = false;
    this.pilot.engage();
    const known = this.xgrid ? this.xgrid.some((v) => v) : false;   // the explore map of this sector is remembered across rockets
    this.pushFeed(known ? `AUTOPILOT RESUMING — MAP REMEMBERED (SCAN ${this.scanPercent()}%) · HEADING FOR THE NEXT UNEXPLORED AREA` : `AUTOPILOT ON — SCAN ${this.scanPercent()}% · MOVE THE STICK TO TAKE OVER`, 'cyan');
  },


  autoStop(msg, keepPlay) {
    const m = this.missile;
    if (!keepPlay) this.autoPlay = false;
    this.gunHeld = false;
    if (this.pilot) this.pilot.active = false;
    if (m.dash) { m.dash = false; m.hover = true; }
    m.ramp = false;       // a dash ends in hover
    if (!m.auto) return;
    m.auto = false; m.autoSpeed = 0;
    if (msg) this.pushFeed(msg, 'amber');
  },

  // Runs every frame: keeps the autopilot going between rockets (launches the next one, re-engages after the launch drop)
  autoPlayTick(dt) {
    // the autopilot asked for its breaching charge last step: the warhead goes off here, before this step's flight update
    if (this.pilot && this.pilot.breachFire) {
      this.pilot.breachFire = false;
      const m = this.missile;
      if (this.state === 'PLAYING' && m.active && m.auto && m.drop <= 0) this.detonateMissile(m.pos, 'AUTOPILOT: BREACHING CHARGE');
    }
    if (this.pilot && this.pilot.pulseFire) {                  // last gasp: the fuel is nearly gone, the pulse converts what is left into a score
      this.pilot.pulseFire = false;
      const m = this.missile;
      if (this.state === 'PLAYING' && m.active && m.auto && m.drop <= 0) this.detonateMissile(m.pos, 'AUTOPILOT: LAST-GASP PULSE');
    }
    if (this.pilot) {
      this.pilot.sense(dt);                                    // flight telemetry, every frame
      if (this.cfg.apDebug) {
        this._apDbgT = (this._apDbgT || 0) - dt;
        if (this._apDbgT <= 0) { this._apDbgT = 0.2; const el = document.getElementById('ap-debug'); if (el) el.textContent = this.pilot.debugText(); }
      }
    }
    if (this.pilot && this.pilot.active && (this.pilot.done || this.pilot.noFrontier) && this.missile.auto) this.pilot.recheck(dt);
    if (!this.autoPlay) return;
    const m = this.missile, st = this.state;
    if (st === 'CLEAR' || st === 'FAILED' || st === 'BRIEFING') { this.autoPlay = false; return; }
    if (this.paused) return;
    if (st === 'READY') { this._autoFireT = (this._autoFireT || 0) + dt; if (this._autoFireT > 0.8) { this._autoFireT = 0; this.fireRocket(); } return; }
    this._autoFireT = 0;
    if (st === 'PLAYING' && m.active && m.drop <= 0 && !m.flipping && !m.auto && !m.landed && m.fuel > 0) {
      this._autoEngT = (this._autoEngT || 0) + dt;
      if (this._autoEngT > 0.25) { this._autoEngT = 0; this.autoEngage(); }
    }
  },

  // Free distance (in metres, up to 7) from a node's cell centre to the nearest wall: how "in the middle of a room" it is
  autoClearance(i) {
    const G = GRID_SIZE, GG = G * G, c = i % GG, f = (i / GG) | 0;
    const x0 = gridToWorldX(c % G), z0 = gridToWorldZ((c / G) | 0), y = f * WALL_H + 2.0;
    let best = 7;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 1; d < best; d += 1) if (this.isGridSolid(x0 + dx * d, z0 + dz * d, y)) { best = d; break; }
    }
    return best;
  },

  // Unexplored tiles left around a node (radius 4, same floor): worth a 360 scan only if there are several
  autoUnknownNear(i) {
    const G = GRID_SIZE, GG = G * G, X = this.xgrid, c = i % GG, f0 = i - c, x0 = c % G, z0 = (c / G) | 0;
    if (!X) return 99;
    let n = 0;
    for (let z = Math.max(0, z0 - 4); z <= Math.min(G - 1, z0 + 4); z++) for (let x = Math.max(0, x0 - 4); x <= Math.min(G - 1, x0 + 4); x++) if (!X[f0 + z * G + x] && this.navOk(f0 + z * G + x)) n++;
    return n;
  },

  // HOVER button: brake and hold position in the air. Stick up/down = altitude, left/right = rotate, lever = 0..4 m/s.
  // Landing: while hovering, hold the stick down onto a flat floor. On the ground the button lifts off into a hover.
  pressHover() {
    const m = this.missile;
    if (this.state !== 'PLAYING' || !m.active || m.drop > 0 || m.flipping) return;
    if (m.landed) {                                    // on the ground: lift off (or abort a lift-off in its spool-up)
      if (m.takeoffT >= 0) { m.takeoffT = -1; m.liftReq = false; this.pushFeed('LIFT-OFF ABORTED', 'amber'); }
      else if (m.fuel > 0) {
        m.hover = true; m.hoverSavedThr = Math.max(0.2, m.throttle || 0); this.setThrottle(0);
        m.takeoffT = 0; m.liftReq = true;
        this.audio.playSpeedShift(1); this.vibrate(20);
        this.pushFeed('ENGINE SPOOL-UP — LIFTING OFF TO HOVER', 'cyan');
      }
      return;
    }
    if (m.fuel <= 0) return;
    m.hover = !m.hover;
    if (!m.hover) this.autoStop('AUTOPILOT OFF');
    if (m.hover) {
      const spd = m.vel.length();
      m.hoverSavedThr = m.throttle;
      this.setThrottle(0);
      m.landReq = false;
      if (spd > 5) this.brakeFX(m, spd);              // going fast: air brakes, the nose dips forward
      this.pushFeed(spd > 5 ? 'AIR BRAKES — HOVER · STICK DOWN TO LAND' : 'HOVER — STICK UP/DOWN = ALTITUDE · DOWN ONTO THE FLOOR = LAND', 'cyan');
    } else {
      this.setThrottle(Math.max(0.2, m.hoverSavedThr || 0.2));
      this.pushFeed('HOVER OFF — FORWARD FLIGHT', 'amber');
    }
    this.audio.playSpeedShift(1);
    this.updateSpeedBadgeUI();
  },

  // Braking from speed into a hover: the nose dips forward (a springy pitch that overshoots and settles), retro jets flare
  // ahead of the nose, the view shudders and the field of view pulls in.
  brakeFX(m, spd) {
    const s = Math.min(1, spd / Math.max(12, this.maxSpeed() * 0.6));
    m.brakeV = (m.brakeV || 0) - (0.9 + 1.5 * s);                 // initial forward pitch impulse
    m.roll += (Math.random() < 0.5 ? -1 : 1) * 0.05 * s;
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.14 + 0.3 * s);
    this.audio.playBrake(s);
    this.vibrate(12 + Math.round(20 * s));
    _e1.set(m.pitch, m.yaw, 0, 'YXZ');
    _v6.copy(_fwd).applyEuler(_e1);
    for (let i = 0; i < 6 + Math.round(8 * s); i++) {            // retro-thruster puffs shot forward from the nose
      _v7.copy(m.pos).addScaledVector(_v6, 0.9);
      _v7.x += (Math.random() - 0.5) * 0.5; _v7.y += (Math.random() - 0.5) * 0.5; _v7.z += (Math.random() - 0.5) * 0.5;
      _v8.copy(_v6).multiplyScalar(5 + Math.random() * 9 * (0.4 + s));
      _v8.x += (Math.random() - 0.5) * 3; _v8.y += (Math.random() - 0.5) * 3; _v8.z += (Math.random() - 0.5) * 3;
      this.vfx.spawnParticle(_v7, _v8, 0.25, 0.9 + Math.random() * 0.8, 0.28 + Math.random() * 0.22, 0xffffff, 0x66ddff, 0x0a1c24, 0.1);
    }
  },

  // A bump against a wall, floor or roof: rebound, the nose is knocked away from the surface, sparks, shake, a thud.
  // n = unit normal pointing away from the surface, sp = speed into it, hard = a glancing deflection (bigger spin).
  bumpFX(m, n, sp, hard) {
    if (sp < 0.5 || this.gameClock - (m._bumpT === undefined ? -9 : m._bumpT) < 0.22) return;
    m._bumpT = this.gameClock;
    const k = Math.min(1, sp / (hard ? 14 : 6));
    const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);
    const side = -(n.x * rx + n.z * rz);                         // + = knocked to the left (wall on the right), - = to the right
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.1 + 0.32 * k);
    m.brakeV = (m.brakeV || 0) + n.y * (hard ? 2.4 : 1.5) * k;   // floor: nose up; roof: nose down
    m.kickY = (m.kickY || 0) + side * (hard ? 0.11 : 0.06) * k;
    m.roll += side * (hard ? 0.3 : 0.18) * k;
    m.yawRate += side * (hard ? 1.4 : 0.6) * k;                  // the hull is spun away from the wall
    this.vfx.spawnScrapeSparks(m.pos, n, Math.round((hard ? 8 : 3) + 9 * k));
    this.audio.playBump(k);
    this.vibrate(10 + Math.round(25 * k));
  },

  // Touchdown / lift-off dust: a ring of grey puffs blown out along the floor
  dustFX(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.5;
      _v7.set(x + Math.cos(a) * r, y + 0.12, z + Math.sin(a) * r);
      _v8.set(Math.cos(a) * (2.4 + Math.random() * 2.6) * power, 0.5 + Math.random() * 0.9, Math.sin(a) * (2.4 + Math.random() * 2.6) * power);
      this.vfx.spawnParticle(_v7, _v8, 0.3, 1.2 + Math.random() * 0.9, 0.55 + Math.random() * 0.4, 0xa8aca0, 0x6c7068, 0x1c201c, 0.25);
    }
  },

  updateMissile(dt) {
    const m = this.missile;

    // 1) Resolve 3-Tier Speed Mode (Lock out Overdrive until 100% recharged if depleted)
    if (this.cfg.infBoost) {
      m.boost = 100;
      m.boostDepleted = false;
    }
    const canBoost = !m.boostDepleted || this.cfg.infBoost;
    // Desktop keyboard overrides only (touch has just the analog lever): Shift/Space = full boost, Ctrl/C = brake
    const boostKeyHeld = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['Space']) && canBoost;
    const holdBoost = boostKeyHeld && m.boost > 0;
    const holdCrawl = Boolean(this.keys['ControlLeft'] || this.keys['ControlRight'] || this.keys['KeyC']);

    let effT = holdBoost ? 1 : (holdCrawl ? 0 : m.throttle);
    if (!canBoost && effT > CRUISE_THROTTLE) effT = CRUISE_THROTTLE;   // overdrive locked while recharging
    if (m.auto && m.dash) effT = Math.max(0, Math.min(1, ((m.autoSpeed || 0) - SPEED_MIN) / Math.max(1, this.maxSpeed() - SPEED_MIN)));   // dash flight (no hover): the lever follows the autopilot, not the manual lever
    if (m.hover && m.fuel <= 0) { m.hover = false; this.pushFeed('HOVER LOST — ENGINE OUT', 'red'); }
    m.effThrottle = m.hover ? 0.04 + effT * 0.08 : effT;     // a hovering rocket is quiet
    if (!m.hover && effT > this.stats.maxThrottle) this.stats.maxThrottle = effT;
    const desiredMode = m.hover ? 1 : this.modeForThrottle(effT);

    if (desiredMode !== m.activeSpeedMode) {
      m.activeSpeedMode = desiredMode;
      this.audio.playSpeedShift(desiredMode);
      this.updateSpeedBadgeUI();
    }

    const profile = blendProfile(m.hover ? 0 : effT, _profile);

    {
      // Fuel model: drag-like burn = base x (0.5 + 0.5 (v / v_cruise)^2), so cruise gives the most distance per tank;
      // turning costs extra, and the engine burns nothing while cold (launch drop), cut (flip) or out of fuel.
      // The model runs from the rocket's real velocity every step, manual or autonomous (m.auto): the HUD efficiency gauge and the
      // burn read-out follow it even with infinite fuel, where only the drain below is skipped.
      const vc = this.throttleSpeed(CRUISE_THROTTLE);
      const vr = m.vel.length() / Math.max(1, vc);
      const turn = Math.min(1, (Math.abs(m.yawRate) + Math.abs(m.pitchRate)) / 2.5);
      const burning = m.drop <= 0 && !m.flipping && m.fuel > 0;
      // efficiency: distance per fuel relative to the best possible (straight flight at cruise) = 1.0
      m.eff = burning ? (m.landed ? -2 : vr / (0.5 + 0.5 * vr * vr + 0.3 * turn)) : -1;
      m.fuelBurn = burning ? 2.4 * (0.5 + 0.5 * vr * vr + 0.3 * turn) * (this.modifier === 'LOW FUEL' ? 1.6 : 1) * this.fuelBurnMult() / (1 + 0.15 * (this.nFloors - 1)) * (m.hover ? 1.3 : 1) : 0;
    }
    if (!this.cfg.infFuel) {
      if (this.nFloors > 1) {
        // first visit to each upper floor in a sector pays a small scouting bonus
        const fNow = this.floorOfY(m.pos.y);
        if (fNow > 0 && !this.floorsReached.has(fNow)) { this.floorsReached.add(fNow); this.awardPoints(POINTS_BONUS.floor, `FLOOR ${fNow + 1} REACHED`, false); }
      }
      m.fuel = Math.max(0, m.fuel - dt * m.fuelBurn);
    } else {
      m.fuel = 100;
    }
    const hasFuel = m.fuel > 0;
    if (!this.cfg.infFuel) {
      if (m.fuel < 20 && !m.fuelWarned) { m.fuelWarned = true; this.pushFeed('FUEL LOW', 'amber'); }
      if (!hasFuel) {
        if (m.fuelOut < 0) { m.fuelOut = 0; this.pushFeed('FUEL EXHAUSTED — ENGINE OUT', 'red'); }
        m.fuelOut += dt;
        if (m.fuelOut > 2.5) { this.detonateMissile(m.pos.clone(), 'FUEL EXHAUSTED — WARHEAD SELF-DESTRUCT'); return; }
      }
    }

    // Boost capacitor drains in proportion to how far the lever is above cruise (full lever = 24%/s)
    let boostLoad = m.hover ? 0 : Math.max(0, (effT - CRUISE_THROTTLE) / (1 - CRUISE_THROTTLE));
    if (this.power.freeBoost > 0) { boostLoad = 0; m.boost = 100; this.power.freeBoost = Math.max(0, this.power.freeBoost - dt); }
    if (this.power.stealth > 0) this.power.stealth = Math.max(0, this.power.stealth - dt);
    if (boostLoad > 0 && !this.cfg.infBoost) {
      m.boost = Math.max(0, m.boost - dt * 24.0 * boostLoad * this.boostDrainMult());
      if (m.boost <= 0) {
        m.boost = 0;
        m.boostDepleted = true;
        if (m.throttle > CRUISE_THROTTLE) this.setThrottle(CRUISE_THROTTLE);
        this.pushFeed('BOOST EMPTY — RECHARGING TO 100%', 'red');
      }
    } else {
      m.boost = Math.min(100, m.boost + dt * 11.5 * this.boostRechargeMult());
      if (m.boostDepleted && m.boost >= 100) {
        m.boostDepleted = false;
        this.pushFeed('BOOST CAPACITOR READY [100%]', 'cyan');
      }
    }

    // ECM Jamming Field Check
    m.inECM = false;
    for (const ez of this.ecmZones) {
      if (m.pos.distanceTo(ez.pos) < ez.radius) {
        m.inECM = true;
        break;
      }
    }
    m.signal = m.inECM ? Math.max(22, m.signal - dt * 65) : Math.min(100, m.signal + dt * 45);
    this.cStyle(this.el.ecmOverlay, 'opacity', m.inECM ? (0.45 + Math.random() * 0.35).toFixed(2) : '0');
    this.cStyle(this.el.ecmBanner, 'display', m.inECM ? 'block' : 'none');

    // 2) Steering Inputs (Keyboard + Gyroscope + Virtual Analog Stick + Pointer-Lock/Drag Mouse)
    let yawInput = -this.touchInput.joyX + (this.gyro && this.gyro.enabled ? this.gyro.yaw : 0);
    let pitchInput = -this.touchInput.joyY + (this.gyro && this.gyro.enabled ? this.gyro.pitch : 0);
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  yawInput += 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) yawInput -= 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    pitchInput += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  pitchInput -= 1;
    yawInput = Math.max(-1, Math.min(1, yawInput));
    pitchInput = Math.max(-1, Math.min(1, pitchInput));
    if (this.cfg.invertPitch) pitchInput = -pitchInput;

    let mouseYaw = 0, mousePitch = 0;
    if (this.mouseYawDelta !== 0 || this.mousePitchDelta !== 0) {
      const mScale = 0.0022 * this.cfg.mouseSens;
      mouseYaw = -this.mouseYawDelta * mScale;
      mousePitch = (this.cfg.invertPitch ? 1 : -1) * this.mousePitchDelta * mScale;
      this.mouseYawDelta = 0;
      this.mousePitchDelta = 0;
    }

    // 15-Degree Auto-Seeker Highlight & Manual/Boost Lock Guidance
    // If locked target goes out of range (> MAX_LOCK_RANGE) or is destroyed, release lock & keep flying straight!
    if (this.manualTargetLock) {
      if (this.lockedEnemy && this.lockedEnemy.ref && this.lockedEnemy.ref.active) {
        const ePos = this.lockedEnemy.ref.pos;
        const dist = Math.hypot(ePos.x - m.pos.x, (ePos.y + this.lockedEnemy.aimY) - m.pos.y, ePos.z - m.pos.z);
        const inLOS = this.los3(m.pos.x, m.pos.y, m.pos.z, ePos.x, ePos.y + this.lockedEnemy.aimY, ePos.z);
        if (dist > this.lidarParams(true).lockRange || !inLOS) {
          this.manualTargetLock = false;
          this.homingLocked = false;
          this.lockedEnemy = null;
          this.lastHighlightedRef = null;
          this.pushFeed('TARGET OUT OF RANGE — HOLDING COURSE', 'amber');
        }
      } else {
        this.manualTargetLock = false;
        this.homingLocked = false;
        this.lockedEnemy = null;
        this.lastHighlightedRef = null;
      }
    }

    if (!this.manualTargetLock) {
      const candidate = this.findBestEnemyTarget();
      this.lockedEnemy = candidate;
      if (candidate && candidate.ref !== this.lastHighlightedRef) {
        this.lastHighlightedRef = candidate.ref;
        this.audio.playSonarPing(0.85);
      } else if (!candidate) {
        this.lastHighlightedRef = null;
      }

      if (boostKeyHeld && this.lockedEnemy && this.lockedEnemy.ref.active) {
        if (!this.homingLocked) {
          this.homingLocked = true;
          this.audio.playLockTone();
        }
      } else {
        this.homingLocked = false;
      }
    } else {
      this.homingLocked = Boolean(this.lockedEnemy && this.lockedEnemy.ref && this.lockedEnemy.ref.active);
    }

    if (this.homingLocked && this.lockedEnemy && this.lockedEnemy.ref.active) {
      const ePos = this.lockedEnemy.ref.pos;
      _v1.set(ePos.x - m.pos.x, (ePos.y + this.lockedEnemy.aimY) - m.pos.y, ePos.z - m.pos.z).normalize();
      const targetYaw = Math.atan2(-_v1.x, -_v1.z);
      let dYaw = targetYaw - m.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const targetPitch = Math.asin(Math.max(-0.92, Math.min(0.92, _v1.y)));
      const homeYaw = Math.max(-1.6, Math.min(1.6, dYaw * 4.2));
      const homePitch = Math.max(-1.4, Math.min(1.4, wrapPi(targetPitch - m.pitch) * 4.2));
      yawInput = homeYaw + yawInput * 0.25;
      pitchInput = homePitch + pitchInput * 0.25;
    }

    const lockBtnEl = this.el.btnLock;
    if (lockBtnEl) {
      lockBtnEl.classList.toggle('locked', this.manualTargetLock && this.homingLocked);
      lockBtnEl.classList.toggle('ready', !this.manualTargetLock && Boolean(this.lockedEnemy));
    }

    if (this.cfg.homing && !this.homingLocked) {
      let nearest = null, bestD = 1e9;
      for (const t of this.targets) {
        if (!t.active) continue;
        const d = t.pos.distanceTo(m.pos);
        if (d < bestD) { bestD = d; nearest = t; }
      }
      if (nearest) {
        _v1.subVectors(nearest.pos, m.pos).normalize();
        const targetYaw = Math.atan2(-_v1.x, -_v1.z);
        let dYaw = targetYaw - m.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        yawInput = Math.max(-1, Math.min(1, dYaw * 2.5));
        const targetPitch = Math.asin(Math.max(-0.9, Math.min(0.9, _v1.y)));
        pitchInput = Math.max(-1, Math.min(1, wrapPi(targetPitch - m.pitch) * 2.5));
      }
    }

    if (m.inECM) {
      yawInput += (Math.random() - 0.5) * 0.42;
      pitchInput += (Math.random() - 0.5) * 0.32;
    }

    if (m.drop > 0 || m.flipping) { yawInput = 0; pitchInput = 0; mouseYaw = 0; mousePitch = 0; }
    // hover: stick up / down climbs and descends, the nose stays level; left / right rotate on the spot
    m.hoverClimb = 0;
    if (m.auto) {
      const manual = Math.abs(this.touchInput.joyX) > 0.3 || Math.abs(this.touchInput.joyY) > 0.3 ||
        this.keys['KeyA'] || this.keys['KeyD'] || this.keys['KeyW'] || this.keys['KeyS'] ||
        this.keys['ArrowLeft'] || this.keys['ArrowRight'] || this.keys['ArrowUp'] || this.keys['ArrowDown'];
      if ((!m.hover && !m.dash) || m.landed || m.fuel <= 0) this.autoStop('AUTOPILOT STOPPED', m.fuel <= 0);   // an engine-out does not end the autopilot: it relaunches
      else if (manual) this.autoStop('AUTOPILOT OFF — MANUAL CONTROL');
      else {
        const a = this.pilot.done ? { yaw: 0, climb: 0, speed: 0 } : this.pilot.steer(dt);   // nothing left to do: hold position (it keeps re-checking)
        const wantDash = !this.pilot.done && this.pilot.dash && !a.homing;              // tunnel: hover off, fly on; hover back on when it ends
        if (wantDash !== Boolean(m.dash)) { m.dash = wantDash; m.hover = !wantDash; }
        m.ramp = wantDash && this.pilot.ramp;                                           // ramp climb: the nose follows the slope
        if (a.homing && this.homingLocked) { m.autoSpeed = a.speed; mouseYaw = 0; }    // lock-on run: the game's homing steers, the pilot sets the speed
        else {
        yawInput = a.yaw; pitchInput = a.climb; mouseYaw = 0; m.autoSpeed = a.speed;
        }
      }
    }
    if (m.dash) pitchInput = 0;                                                       // dash: the nose stays level (auto-level), hover is off
    if (m.hover && !m.landed) { m.hoverClimb = pitchInput; pitchInput = 0; mousePitch = 0; }
    const homingTurnBoost = this.homingLocked ? 1.65 : 1.0;
    const agility = 2.15 * profile.turnMult * this.cfg.agilityMult * homingTurnBoost * (m.hover ? 0.6 : 1) * (m.auto && this.pilot && this.pilot.scan ? 2.0 : 1);   // the autopilot's scan spin turns twice as fast
    const targetYawRate = yawInput * agility;
    const targetPitchRate = pitchInput * agility * 0.85;
    const rateResp = m.hover ? (yawInput !== 0 ? 6.0 : 3.2) : (yawInput !== 0 ? 15.0 : 12.5);   // hover: the spin builds up and coasts
    const pitchResp = pitchInput !== 0 ? 15.0 : 12.5;
    m.yawRate += (targetYawRate - m.yawRate) * Math.min(1, dt * rateResp);
    m.pitchRate += (targetPitchRate - m.pitchRate) * Math.min(1, dt * pitchResp);

    m.yaw += m.yawRate * dt + mouseYaw;
    m.pitch = wrapPi(m.pitch + m.pitchRate * dt + mousePitch);   // no pitch limit: loops are possible if there is room

    if (m.hover) m.pitch += (0 - m.pitch) * Math.min(1, dt * 3.5);
    else if (m.ramp) m.pitch += (this.pilot.rampPitch - m.pitch) * Math.min(1, dt * 4);   // autonomous ramp climb: pitch up the slope
    else if (this.cfg.autoLevel && hasFuel && pitchInput === 0 && Math.abs(mousePitch) < 0.0005 && !this.cfg.homing && !this.homingLocked && Math.abs(m.pitch) < 1.2) {
      m.pitch += (0 - m.pitch) * Math.min(1, dt * 1.85);
    }

    if (m.flipping) {
      m.flipT += dt;
      const k = Math.min(1, m.flipT / FLIP_TIME);
      const e = k * k * (3 - 2 * k);
      m.pitch = wrapPi(m.flipStart + Math.PI * e);
      m.pitchRate = 0;
      m.yawRate *= 0.85;
      if (k >= 1) {
        m.flipping = false;
        // Re-label the attitude as the equivalent upright one so the controls stay exactly the same:
        // (yaw, pitch) and (yaw + 180 deg, 180 deg - pitch) point the nose the same way. The body is
        // still belly-up for a moment (roll) and rolls itself upright.
        m.yaw = wrapPi(m.yaw + Math.PI);
        m.pitch = wrapPi(Math.PI - m.pitch);
        m.roll = Math.PI;
        m.burnT = BURN_TIME;
        this.audio.playSpeedShift(3);
        this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.35);
        this.pushFeed('BURN — REVERSING COURSE', 'cyan');
      }
    }

    const bankDrive = Math.max(-1, Math.min(1, (m.yawRate / Math.max(0.5, agility)) + mouseYaw * 16));
    const targetRoll = bankDrive * profile.rollMult;
    m.roll += (targetRoll - m.roll) * Math.min(1, dt * 9.0);

    // the rocket itself wobbles a little in flight: more with speed and steering, extra in the launch drop / engine out
    const wt = this.gameClock;
    const sfw = Math.min(1, m.vel.length() / this.maxSpeed());
    const steer = Math.min(1.5, Math.abs(m.yawRate) + Math.abs(m.pitchRate));
    const wamp = 0.0015 + 0.0035 * sfw + 0.006 * steer + (m.drop > 0 ? 0.01 : 0) + (m.fuelOut >= 0 ? 0.008 : 0);
    m.wobY = wamp * (Math.sin(wt * 9.1) + 0.6 * Math.sin(wt * 15.7 + 1.3)) + (m.kickY || 0);
    m.wobP = wamp * 0.8 * (Math.sin(wt * 10.3 + 0.7) + 0.6 * Math.sin(wt * 17.9 + 2.1)) + (m.kickP || 0);
    _e1.set(m.pitch + m.wobP, m.yaw + m.wobY, 0, 'YXZ');
    _v1.copy(_fwd).applyEuler(_e1).normalize();

    if (m.drop > 0) {
      // thrusters cold: keep launch momentum and fall under gravity
      m.drop -= dt;
      m.vel.y -= LAUNCH_GRAVITY * dt;
      if (m.pos.y < 0.8 && m.vel.y < 0) m.vel.y = 0;     // never drop into the floor of the launch bay
      if (m.drop <= 0) {
        // ignition
        this.audio.playSpeedShift(2);
        this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.3);
        this.pushFeed('THRUSTERS ENGAGED', 'amber');
      }
    } else if (m.flipping) {
      m.vel.multiplyScalar(Math.max(0, 1 - 0.35 * dt));      // tumbling with cold engine: coast with slight drag
    } else if (m.landed) {
      // on the ground: engine idles (still burning fuel); turn on the spot, tilt the nose up to aim
      m.landT = (m.landT || 0) + dt;
      m.vel.set(0, 0, 0);
      const baseY = (m.landY || 0) + MISSILE_RADIUS + 0.01;
      if (m.takeoffT >= 0) {
        // take-off: spool up (shaking), rise off the floor while levelling the fin, pitch up and pull away
        m.takeoffT += dt;
        const T = m.takeoffT;
        if (T < TAKEOFF_SPOOL) {
          if ((!m.liftReq && effT <= LAND_TAKEOFF) || !hasFuel) { m.takeoffT = -1; m.liftReq = false; this.pushFeed('LIFT-OFF ABORTED', 'amber'); }
          const sp = T / TAKEOFF_SPOOL;
          this.cameraTrauma = Math.max(this.cameraTrauma, 0.1 + 0.18 * sp);
          m._dustT = (m._dustT || 0) - dt;
          if (m._dustT <= 0) { m._dustT = 0.07; this.dustFX(m.pos.x, m.landY || 0, m.pos.z, 2, 0.5 + sp); }
          m.pos.y = baseY + 0.03 * sp * Math.sin(this.gameClock * 70);
          m.roll += (m.landRoll * (1 - sp * 0.5) - m.roll) * Math.min(1, dt * 10);
          m.currentSpeed = 0;
        } else {
          const u = Math.min(1, (T - TAKEOFF_SPOOL) / TAKEOFF_RISE), e = u * u * (3 - 2 * u);
          this.localSurf(m.pos.x, baseY, m.pos.z);
          const inShaft = this._sc - this._sf < WALL_H * 0.9;
          // never rise into a shaft's roof
          m.pos.y = baseY + Math.min(TAKEOFF_HEIGHT, Math.max(0, this._sc - MISSILE_RADIUS - 0.05 - baseY)) * e;
          m.roll += (0 - m.roll) * Math.min(1, dt * 8);
          const pLo = (inShaft || m.hover) ? 0 : 0.2, pHi = inShaft ? 0.04 : (m.hover ? 0.02 : 0.5);
          m.pitch += (Math.max(pLo, Math.min(pHi, m.pitch)) - m.pitch) * Math.min(1, dt * 5);
          this.cameraTrauma = Math.max(this.cameraTrauma, 0.2 * (1 - u));
          // start moving forward in the second half of the rise (a hover lift-off just rises)
          m.currentSpeed = m.hover ? 0 : SPEED_MIN * 0.75 * Math.max(0, (u - 0.45) / 0.55);
          if (m.currentSpeed > 0) {
            const nx = m.pos.x - Math.sin(m.yaw) * m.currentSpeed * dt, nz = m.pos.z - Math.cos(m.yaw) * m.currentSpeed * dt;
            if (!this.isGridSolid(nx, nz, m.pos.y)) { m.pos.x = nx; m.pos.z = nz; }
          }
          if (u >= 1) {
            m.landed = false; m.takeoffT = -1; m.liftReq = false;
            m.currentSpeed = m.hover ? 0 : SPEED_MIN * 0.75;
            _e1.set(m.pitch, m.yaw, 0, 'YXZ');
            m.vel.copy(_fwd).applyEuler(_e1).multiplyScalar(m.currentSpeed);
            this.audio.playSpeedShift(2);
            this.pushFeed(m.hover ? 'AIRBORNE — HOVERING' : 'AIRBORNE', 'cyan');
          }
        }
      } else if (m.liftArmed && effT > LAND_TAKEOFF && hasFuel) {
        m.takeoffT = 0;
        this.audio.playSpeedShift(1);
        this.vibrate(20);
        this.pushFeed('ENGINE SPOOL-UP — LIFTING OFF', 'cyan');
      } else {
        // settle: a couple of small hops, a nose dip, then lean over onto one fin
        if (effT <= LAND_TAKEOFF) m.liftArmed = true;       // the lever must come down once before it can lift off again
        const k = m.landT, imp = m.landImpact || 0.5;
        m.pos.y = baseY + 0.45 * Math.max(0.6, imp) * Math.exp(-k * 6) * Math.abs(Math.sin(k * 13));
        m.roll = m.landRoll * (1 - Math.exp(-k * 3.5)) + 0.16 * imp * Math.exp(-k * 4.5) * Math.sin(k * 17);
        m.wobP = (m.wobP || 0) - 0.16 * Math.max(0.6, imp) * Math.exp(-k * 5) * Math.abs(Math.sin(k * 9)) + 0.0025 * Math.sin(this.gameClock * 31);
        m.currentSpeed += (0 - m.currentSpeed) * Math.min(1, dt * 5.0);
        m.pitch = Math.max(-0.02, Math.min(0.7, m.pitch));
      }
    } else {
      const leverSpeed = m.hover ? (m.auto ? m.autoSpeed : effT * HOVER_SPEED_MAX) : this.throttleSpeed(effT);
      let targetSpeed = hasFuel ? (m.hover ? leverSpeed : leverSpeed * this.cfg.speedMult) : 9.5;
      if (m.landReq) {
        m.landReqT = (m.landReqT || 0) + dt;
        if (!hasFuel || m.landReqT > LAND_ARM_TIME) { m.landReq = false; this.pushFeed('LANDING CANCELLED', 'amber'); }
        else targetSpeed = 0;                        // VTOL landing: brake to a hover, then settle straight down
      }
      m.currentSpeed += (targetSpeed - m.currentSpeed) * Math.min(1, dt * (hasFuel ? (m.landReq ? 3.4 : 6.0) : 1.2));

      _v2.copy(_v1).multiplyScalar(m.currentSpeed);
      const gravDrop = hasFuel ? 0.35 : 7.5;
      _v2.y -= gravDrop * dt * (hasFuel ? 3.0 : 12.0);

      let inertia = profile.inertia;
      if (m.burnT > 0) { m.burnT -= dt; inertia *= 2.6; m.currentSpeed = Math.max(m.currentSpeed, 14); }
      if (m.hover) {
        // thrusters hold the rocket up: no gravity sag, vertical speed follows the stick (or the landing descent)
        _v2.y = m.landReq ? m.vel.y : m.hoverClimb * HOVER_CLIMB;
        inertia = 4.5;
      }
      m.vel.lerp(_v2, Math.min(1, dt * inertia));

      if (m.landReq) {
        // VTOL landing: level the nose, kill the forward speed, then sink at a rate that eases off near the floor
        m.pitch += (0 - m.pitch) * Math.min(1, dt * 2.0);
        this.localSurf(m.pos.x, m.pos.y, m.pos.z);
        if (this._gRamp || m.inLift) {
          m.landReq = false;
          this.pushFeed(this._gRamp ? 'LANDING CANCELLED — CANNOT LAND ON A RAMP' : 'LANDING CANCELLED — LIFT SHAFT', 'amber');
        } else {
          const alt = m.pos.y - MISSILE_RADIUS - this._sf;
          const settle = m.currentSpeed < 5 ? -Math.max(0.6, Math.min(3.0, alt * 1.15)) : 0;
          m.vel.y += (settle - m.vel.y) * Math.min(1, dt * 4.0);
        }
      }
    }

    if (m.drop <= 0 && !m.flipping && !m.landed) this.applyRocketFX(m, dt, hasFuel);
    else { m.kickP = (m.kickP || 0) * Math.exp(-dt * 6); m.kickY = (m.kickY || 0) * Math.exp(-dt * 6); m.brakeP = (m.brakeP || 0) * Math.exp(-dt * 6); m.brakeV = 0; }

    // 3) 4-Substep Swept Collision Pass
    const subDt = dt / SUBSTEPS;
    for (let step = 0; step < SUBSTEPS; step++) {
      if (!m.active || m.landed) break;
      _v3.copy(m.pos).addScaledVector(m.vel, subDt);
      if (this.lifts.length) {
        const lc = this.cellAt(_v3.x, _v3.z);
        if (lc >= 0 && this.liftCells.has(lc)) {
          // the lift holds the rocket: drift slows to a quarter, and the car moves floor to floor
          // (nose up = next floor up, nose down = next floor down, level = stop at this floor)
          _v3.x = m.pos.x + m.vel.x * subDt * 0.25;
          _v3.z = m.pos.z + m.vel.z * subDt * 0.25;
          const stop = (f) => f * WALL_H + 2.8;
          if (!m.inLift) {
            m.inLift = true;
            m.liftF = this.floorOfY(m.pos.y);
            this.pushFeed('LIFT — NOSE UP / DOWN TO CHANGE FLOOR, LEVEL TO STOP', 'cyan');
          }
          const at = Math.abs(m.pos.y - stop(m.liftF)) < 0.3;
          if (at && m.pitch > 0.2 && m.liftF < this.nFloors - 1) { m.liftF++; this.pushFeed(`LIFT ▲ FLOOR ${m.liftF + 1}`, 'cyan'); }
          else if (at && m.pitch < -0.2 && m.liftF > 0) { m.liftF--; this.pushFeed(`LIFT ▼ FLOOR ${m.liftF + 1}`, 'cyan'); }
          const ty = stop(m.liftF), dy = ty - m.pos.y, mv = LIFT_SPEED * subDt;
          _v3.y = m.pos.y + (Math.abs(dy) < mv ? dy : Math.sign(dy) * mv);
        } else m.inLift = false;
      }

      for (const t of this.targets) {
        if (!t.active) continue;
        const tDist = _v3.distanceTo(t.pos);
        if (tDist < t.radius + MISSILE_RADIUS) {
          m.pos.copy(_v3);
          this.detonateMissile(_v3, `DIRECT HIT: ${t.name}`, t, null);
          return;
        }
        // proximity fuze: close enough to a primary target (and not behind a wall) -> burst automatically
        if (this.fuzeNear(_v3, t.pos.x, t.pos.y, t.pos.z, tDist, true)) {
          m.pos.copy(_v3);
          this._proxBurst = true;
          this.detonateMissile(_v3, `PROXIMITY FUZE: ${t.name}`, t, null);
          this._proxBurst = false;
          return;
        }
      }

      if (!this.cfg.godMode) {
        for (const s of this.sentries) {
          if (!s.active) continue;
          const dx = _v3.x - s.pos.x;
          const dz = _v3.z - s.pos.z;
          const horizDistSq = dx * dx + dz * dz;
          if (horizDistSq < FUZE_RANGE * FUZE_RANGE && this.fuzeNear(_v3, s.pos.x, s.pos.y + 1.2, s.pos.z, Math.hypot(dx, _v3.y - (s.pos.y + 1.2), dz))) {
            m.pos.copy(_v3);
            this.detonateMissile(_v3, 'PROXIMITY FUZE: SENTRY');
            return;
          }
          if (horizDistSq <= (0.72 + MISSILE_RADIUS) * (0.72 + MISSILE_RADIUS) && _v3.y >= s.pos.y + 0.05 && _v3.y <= s.pos.y + 2.25) {
            m.pos.copy(_v3);
            this.hitStopTimer = 0.04;
            this.detonateMissile(_v3, 'DIRECT IMPACT — SENTRY NEUTRALIZED', null, s);
            return;
          }
        }

        for (const b of this.barrels) {
          if (!b.active) continue;
          if (_v3.distanceTo(b.pos) < 1.05 + MISSILE_RADIUS) {
            m.pos.copy(_v3);
            this.detonateMissile(_v3, 'DIRECT HIT: VOLATILE FUEL BARREL');
            return;
          }
        }

        for (const g of this.grates) {
          if (!g.active) continue;
          if (Math.abs(_v3.x - g.pos.x) < g.halfX + MISSILE_RADIUS &&
              Math.abs(_v3.y - g.pos.y) < g.halfY + MISSILE_RADIUS &&
              Math.abs(_v3.z - g.pos.z) < g.halfZ + MISSILE_RADIUS) {
            g.active = false;
            g.mesh.visible = false;
            this.blastMult = this.hitMultNow();
            this.rewardKill('grate', this.grates, (x) => !x.active);
            this.flushRewards();
            this.audio.playScrape();
            m.hull -= 24 * this.hullDmgMult();
            this.pushFeed('GRATE SHATTERED (-24% HULL)', 'cyan');
            if (m.hull <= 0) { this.detonateMissile(_v3, 'HULL BREACHED ON GRATE'); return; }
          }
        }

        for (let lIdx = 0; lIdx < this.lasers.length; lIdx++) {
          const l = this.lasers[lIdx];
          if (l.disabled) continue;

          if (l.relayActive && _v3.distanceTo(l.relayPos) < 0.72 + MISSILE_RADIUS) {
            // a direct hit on a laser control box detonates the warhead; the blast switches the grid off
            m.pos.copy(_v3);
            this.detonateMissile(_v3, 'DIRECT HIT: LASER BOX');
            return;
          }

          if (l.state !== 'ACTIVE') continue;
          for (let bIdx = 0; bIdx < l.beams.length; bIdx++) {
            const bm = l.beams[bIdx];
            const abx = bm.x2 - bm.x1;
            const aby = bm.y2 - bm.y1;
            const abz = bm.z2 - bm.z1;
            const lenSq = abx * abx + aby * aby + abz * abz;
            let tSeg = lenSq > 0.0001
              ? ((_v3.x - bm.x1) * abx + (_v3.y - bm.y1) * aby + (_v3.z - bm.z1) * abz) / lenSq
              : 0;
            if (tSeg < 0) tSeg = 0;
            else if (tSeg > 1) tSeg = 1;
            const dx = _v3.x - (bm.x1 + abx * tSeg);
            const dy = _v3.y - (bm.y1 + aby * tSeg);
            const dz = _v3.z - (bm.z1 + abz * tSeg);
            const hitRad = MISSILE_RADIUS + 0.12;
            if (dx * dx + dy * dy + dz * dz < hitRad * hitRad) {
              this.detonateMissile(_v3, 'INTERCEPTED BY LASER SECURITY GRID');
              return;
            }
          }
        }

        for (const tb of this.turbines) {
          if (Math.abs(_v3.z - tb.pos.z) >= 0.55) continue;
          const tdx = _v3.x - tb.pos.x;
          const tdy = _v3.y - tb.pos.y;
          if (Math.hypot(tdx, tdy) >= tb.radius) continue;
          const ca = Math.cos(tb.angle), sa = Math.sin(tb.angle);
          const lx = Math.abs(tdx * ca + tdy * sa);
          const ly = Math.abs(-tdx * sa + tdy * ca);
          const reach = 2.8 + MISSILE_RADIUS;
          const thick = 0.275 + MISSILE_RADIUS;
          if ((lx < reach && ly < thick) || (lx < thick && ly < reach)) {
            this.detonateMissile(_v3, 'DESTROYED BY EXHAUST TURBINE');
            return;
          }
        }

        for (const bh of this.bulkheads) {
          if (_v3.y < WALL_H && Math.abs(_v3.x - bh.x) < bh.halfX + MISSILE_RADIUS && Math.abs(_v3.z - bh.z) < bh.halfZ + MISSILE_RADIUS) {
            this.detonateMissile(_v3, 'IMPACT: ARMORED BULKHEAD');
            return;
          }
        }

        for (const tu of this.turrets) {
          if (!tu.active) continue;
          const tuD = _v3.distanceTo(tu.pos);
          if (tuD < 1.1) {
            this.detonateMissile(_v3, 'DIRECT HIT: CIWS TURRET');
            return;
          }
          if (this.fuzeNear(_v3, tu.pos.x, tu.pos.y - 0.6, tu.pos.z, tuD)) {
            this.detonateMissile(_v3, 'PROXIMITY FUZE: CIWS TURRET');
            return;
          }
        }

        let hitNormalX = 0, hitNormalY = 0, hitNormalZ = 0, hitSurface = false, hitRamp = null;
        {
          // local surfaces: a shaft's slab and lintel count as floor and roof once the rocket is inside its opening
          this.localSurf(_v3.x, m.pos.y, _v3.z);
          const gY = this._sf, gR = this._gRamp, cY = this._sc;
          if (_v3.y < gY + MISSILE_RADIUS) {
            _v3.y = gY + MISSILE_RADIUS; hitSurface = true;
            if (gR) { const sl = WALL_H / gR.len; hitNormalX = -gR.dx * sl; hitNormalZ = -gR.dz * sl; hitNormalY = 1; hitRamp = gR; }
            else {
              hitNormalY = 1;
              const slow = m.currentSpeed <= LAND_SPEED;
              const falling = m.vel.y < -LAND_SINK || m.pitch < -LAND_PITCH || !hasFuel;
              const wantLand = m.landReq || (m.hover && !m.auto && m.hoverClimb < -0.05 && !m.inLift);   // only the player lands (the autopilot never touches down)   // hovering with the stick held down = landing
              if (slow && !falling && m.drop <= 0 && !m.flipping && !wantLand) {
                // slow and gentle but not landing: skim along the floor without damage
                if (m.vel.y < 0) m.vel.y = 0;
                hitNormalY = 0;
                hitSurface = false;
              } else if (slow && !falling && m.drop <= 0 && !m.flipping) {
                // touchdown: settle on the floor
                m.landImpact = Math.min(1, Math.max(0.35, -m.vel.y / LAND_SINK + m.currentSpeed / LAND_SPEED * 0.5));
                m.pos.set(_v3.x, gY + MISSILE_RADIUS + 0.01, _v3.z);
                m.vel.set(0, 0, 0);
                m.pitch = Math.max(0, m.pitch);
                m.pitchRate = 0;
                m.landed = true; m.landReq = false; m.liftReq = false; m.hover = false;   // hover ends: the engine idles on the ground
                m.liftArmed = effT <= LAND_TAKEOFF;
                m.brakeV = (m.brakeV || 0) + 0.8 * m.landImpact;
                this.dustFX(m.pos.x, gY, m.pos.z, 12, 0.7 + m.landImpact);
                this.audio.playBump(0.5 + 0.4 * m.landImpact);
                m.landY = gY; m.landT = 0; m.takeoffT = -1;
                m.landRoll = (Math.random() < 0.5 ? -1 : 1) * LAND_LEAN;
                this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.22 * m.landImpact);
                this.audio.playScrape();
                this.vibrate(25);
                this.pushFeed('TOUCHDOWN — LANDED (HOVER BUTTON OR RAISE THE LEVER TO LIFT OFF)', 'cyan');
                break;
              }
              if (falling && m.drop <= 0) {
                m.pos.copy(_v3);
                this.detonateMissile(_v3, 'CRASHED INTO THE FLOOR');
                return;
              }
            }
          } else if (_v3.y > cY - MISSILE_RADIUS) { hitNormalY = -1; _v3.y = cY - MISSILE_RADIUS; hitSurface = true; }
        }
        if (hitRamp) {
          // ride up a gentle ramp: a shallow touch slides along it instead of scraping
          _v4.set(hitNormalX, hitNormalY, hitNormalZ).normalize();
          _v5.copy(m.vel).normalize();
          if (Math.abs(_v5.dot(_v4)) < 0.5) {
            const vn = m.vel.dot(_v4);
            if (vn < 0) m.vel.addScaledVector(_v4, -vn);
            const along = -Math.sin(m.yaw) * hitRamp.dx - Math.cos(m.yaw) * hitRamp.dz;
            m.pitch = Math.max(m.pitch, Math.atan((WALL_H / hitRamp.len) * along) + 0.03);
            hitSurface = false; hitNormalX = hitNormalY = hitNormalZ = 0;
          }
        }

        if (!hitSurface) {
          const hitX = this.isGridSolid(_v3.x + Math.sign(m.vel.x) * MISSILE_RADIUS, m.pos.z, _v3.y);
          const hitZ = this.isGridSolid(m.pos.x, _v3.z + Math.sign(m.vel.z) * MISSILE_RADIUS, _v3.y);
          const hitDiag = !hitX && !hitZ && this.isGridSolid(_v3.x + Math.sign(m.vel.x) * MISSILE_RADIUS, _v3.z + Math.sign(m.vel.z) * MISSILE_RADIUS, _v3.y);
          if (hitX || hitDiag) {
            hitNormalX = -Math.sign(m.vel.x || 1);
            _v3.x = m.pos.x;
            hitSurface = true;
          }
          if (hitZ || hitDiag) {
            hitNormalZ = -Math.sign(m.vel.z || 1);
            _v3.z = m.pos.z;
            hitSurface = true;
          }
        }

        if (hitSurface && m.hover && m.vel.length() < 5.5) {
          // hovering is slow enough to touch things gently: just stop pushing into the surface
          _v4.set(hitNormalX, hitNormalY, hitNormalZ).normalize();
          const vn = m.vel.dot(_v4);
          if (vn < 0) { m.vel.addScaledVector(_v4, -vn * 1.3); this.bumpFX(m, _v4, -vn, false); }   // stop, rebound a little, knock the nose away
          hitSurface = false;
        }
        if (hitSurface) {
          _v4.set(hitNormalX, hitNormalY, hitNormalZ).normalize();
          _v5.copy(m.vel).normalize();
          const impactCos = Math.abs(_v5.dot(_v4));
          if (impactCos < 0.56 && m.hull > 22) {
            const dotVN = m.vel.dot(_v4);
            this.bumpFX(m, _v4, Math.abs(dotVN), true);
            m.vel.addScaledVector(_v4, -1.85 * dotVN);
            const flatLen = Math.hypot(m.vel.x, m.vel.z);
            if (flatLen > 0.01) m.yaw = Math.atan2(-m.vel.x, -m.vel.z);
            m.pitch = Math.max(-1.0, Math.min(1.0, Math.atan2(m.vel.y, Math.max(0.01, flatLen))));
            m.hull = Math.max(0, m.hull - 22 * this.hullDmgMult());
            m.roll += (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.5);      // scrape: the hull is knocked into a roll
            m.kickP = (m.kickP || 0) + (Math.random() - 0.5) * 0.12;
            this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.28);
            this.audio.playScrape();
            this.pushFeed(`GLANCING DEFLECTION (-22% HULL)`, 'amber');
          } else {
            m.pos.copy(_v3);
            this.detonateMissile(_v3, 'HEAD-ON STRUCTURAL IMPACT');
            return;
          }
        }
      }

      m.pos.copy(_v3);
    }

    this.missileGroup.position.copy(m.pos);
    this.missileGroup.rotation.set(m.pitch + (m.brakeP || 0), m.yaw, m.roll, 'YXZ');
    this.headlamp.position.copy(m.pos);

    const engineOn = hasFuel && m.drop <= 0 && !m.flipping;


    let minWallDist = 8.0;
    const probeDirs = PROBE_DIRS;
    for (let i = 0; i < 4; i++) {
      for (let d = 1.0; d <= 6.0; d += 1.0) {
        if (this.isGridSolid(m.pos.x + probeDirs[i][0] * d, m.pos.z + probeDirs[i][1] * d)) {
          if (d < minWallDist) minWallDist = d;
          break;
        }
      }
    }
    m.wallProximity = Math.max(0, 1 - (minWallDist - 1.0) / 5.0);
    this.updateProbes(m);
    if (m.wallProximity > 0.25) {
      this.audio.sonarTimer -= dt;
      if (this.audio.sonarTimer <= 0) {
        this.audio.sonarTimer = 0.48 - m.wallProximity * 0.34;
        this.audio.playSonarPing(m.wallProximity);
      }
    }

    this.audio.updateEngine(true, m.activeSpeedMode, m.hover ? Math.min(0.6, Math.max(0.28, m.currentSpeed / this.maxSpeed()) + Math.abs(m.vel.y) * 0.06) : m.currentSpeed / this.maxSpeed(), engineOn);

    this.cStyle(this.el.speedLines, 'opacity', m.activeSpeedMode === 3 ? '0.85' : '0');
    if (m.activeSpeedMode === 3) {
      this.cameraTrauma = Math.max(this.cameraTrauma, 0.14);
    }
  },

  /* ------------------------------------------------------------------------
     CAMERA RIG (NOSE-CAM FPV DEFAULT, CHASE-CAM, ORBITAL KILL-CAM)
     ------------------------------------------------------------------------ */
  updateCamera(dt) {
    const m = this.missile;
    if (this.state === 'KILLCAM') {
      const rad = 9.5;
      this.camera.position.set(
        this.killCamTarget.x + Math.cos(this.killCamAngle) * rad,
        Math.min(WALL_H - 0.8, this.killCamTarget.y + 3.4),
        this.killCamTarget.z + Math.sin(this.killCamAngle) * rad
      );
      this.camera.lookAt(this.killCamTarget);
      this.camera.fov += (65 - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
      return;
    }

    if (this.state === 'READY') {
      this.camera.fov += (blendProfile(m.throttle, _profileCam).fov - this.camera.fov) * Math.min(1, dt * 7.5);
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.spawnPos);
      _e1.set(m.pitch, m.yaw, 0, 'YXZ');
      _v1.copy(_fwd).applyEuler(_e1);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.spawnPos.x + _v1.x, this.spawnPos.y + _v1.y, this.spawnPos.z + _v1.z);
      return;
    }

    if (this.state === 'BRIEFING') {
      const t = performance.now() * 0.0003;
      this.camera.position.set(this.spawnPos.x + Math.sin(t) * 3, 3.6, this.spawnPos.z + 4);
      this.camera.lookAt(this.spawnPos.x, 2.2, this.spawnPos.z - 22);
      return;
    }

    if (m.active) {
      const profile = blendProfile(m.effThrottle, _profileCam);
      this.camera.fov += (profile.fov + (m.brakeP || 0) * 16 - this.camera.fov) * Math.min(1, dt * 7.5);   // braking pulls the field of view in
      this.camera.updateProjectionMatrix();

      const rp = this.renderPose;   // interpolated between the last two fixed steps (see updateRenderPose)
      if (this.camChase) { this.updateChaseCam(dt, rp); }
      else {
      // nose camera, always upright (world-up), never banks or inverts
      this.missileGroup.visible = false;
      this.camera.position.copy(rp.pos);
      // the view is the rocket's nose: it shows the rocket's own wobble and banks gently with steering (max ~10°)
      _e1.set(rp.pitch, rp.yaw, 0, 'YXZ');
      _v1.copy(_fwd).applyEuler(_e1);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(rp.pos.x + _v1.x, rp.pos.y + _v1.y, rp.pos.z + _v1.z);
      this.camRoll = Math.max(-0.18, Math.min(0.18, rp.roll * 0.35));
      this.camera.rotateZ(this.camRoll);
      }
    }

    if (m.active && this.state === 'PLAYING') {      // main flame, smoke trail and wash dust (visual only)
      const burning = m.fuel > 0 && m.drop <= 0 && !m.landed && !m.flipping;
      const thr = burning ? 0.35 + 0.85 * Math.min(1, (m.currentSpeed || 0) / this.maxSpeed()) + (m.burnT > 0 ? 0.4 : 0) : 0;
      const now = performance.now();
      this.thrust.update(dt, burning && this.camChase, thr, m.activeSpeedMode, now);
      this.thrust.emit(dt, this.renderPose, m, thr, burning, this.camChase, now);
    }

    if (this.cameraTrauma > 0.001) {
      const shake = this.cameraTrauma * this.cameraTrauma * 0.42;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
  },

  /* Render interpolation. The simulation runs at a fixed 60 Hz; on 90/120/144 Hz screens most frames contain no new step,
     so the nose camera is drawn between the previous and the current step instead of standing still on one of them.
     Both functions only write this.prevPose / this.renderPose: the physics state (missile.pos, angles) is never changed. */
  snapshotRenderPose() {
    const m = this.missile, p = this.prevPose;
    p.pos.copy(m.pos);
    p.pitch = m.pitch + (m.wobP || 0) + (m.brakeP || 0);
    p.yaw = m.yaw + (m.wobY || 0);
    p.roll = m.roll;
  },

  updateRenderPose(alpha) {
    const m = this.missile, p = this.prevPose, r = this.renderPose;
    const pitch = m.pitch + (m.wobP || 0) + (m.brakeP || 0), yaw = m.yaw + (m.wobY || 0);
    const dPitch = wrapPi(pitch - p.pitch), dYaw = wrapPi(yaw - p.yaw), dRoll = wrapPi(m.roll - p.roll);
    // a launch, respawn or other teleport is not motion: show the new pose at once instead of sweeping across the map
    if (!m.active || p.pos.distanceToSquared(m.pos) > 6.25 || Math.abs(dPitch) > 1 || Math.abs(dYaw) > 1 || Math.abs(dRoll) > 1) alpha = 1;
    else alpha = alpha < 0 ? 0 : (alpha > 1 ? 1 : alpha);
    r.pos.lerpVectors(p.pos, m.pos, alpha);
    r.pitch = p.pitch + dPitch * alpha;
    r.yaw = p.yaw + dYaw * alpha;
    r.roll = p.roll + dRoll * alpha;
  },

  // Third-person chase camera (render path only: it reads the grid, never writes simulation state). Behind and above the
  // interpolated rocket, smoothed, pulled in before walls and kept between this floor's slab and ceiling. The rocket model and
  // its flame are drawn from the same interpolated pose.
  updateChaseCam(dt, rp) {
    const m = this.missile, C = CHASE_CAM, cam = this.camera;
    _e1.set(rp.pitch, rp.yaw, 0, 'YXZ'); _v7.copy(_fwd).applyEuler(_e1);                 // nose direction
    let free = C.dist;
    for (let d = 0.25; d <= C.dist; d += 0.25) {
      if (this.isGridSolid(rp.pos.x - _v7.x * d, rp.pos.z - _v7.z * d, rp.pos.y - _v7.y * d + C.up * d / C.dist)) { free = Math.max(C.min, d - C.wallGap); break; }
    }
    const f0 = Math.max(0, Math.min(this.nFloors - 1, this.floorOfY(rp.pos.y))) * WALL_H;
    _v8.set(rp.pos.x - _v7.x * free, rp.pos.y - _v7.y * free + C.up * free / C.dist, rp.pos.z - _v7.z * free);
    _v8.y = Math.max(f0 + 0.35, Math.min(f0 + WALL_H - 0.35, _v8.y));
    const P = this._chasePos;
    if (!this._chaseOk || P.distanceToSquared(_v8) > 64) { P.copy(_v8); this._chaseOk = true; }   // first frame or a jump: snap
    else P.lerp(_v8, 1 - Math.exp(-dt * C.lag));
    cam.position.copy(P);
    this._chaseLook.set(rp.pos.x + _v7.x * C.look, rp.pos.y + _v7.y * C.look, rp.pos.z + _v7.z * C.look);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._chaseLook);
    this.camRoll = 0;
    // the rocket itself, at the same interpolated pose, with a flame that follows thrust
    const G = this.missileGroup;
    G.visible = true; G.position.copy(rp.pos); G.rotation.set(rp.pitch, rp.yaw, rp.roll, 'YXZ');
    // hover RCS jets: only while hovering (the autopilot's hover included) and airborne; they hide when landed, dashing or out of fuel
    const hov = m.hover && !m.dash && m.fuel > 0 && m.drop <= 0 && !m.landed;
    this.rcs.update(dt, hov, m.hoverClimb || 0, m.yawRate || 0, m.vel.x * Math.cos(m.yaw) - m.vel.z * Math.sin(m.yaw), performance.now());
  },

  // C key / CAM button: nose camera <-> chase camera (saved with the other preferences)
  toggleCamView() {
    this.setPref('camChase', !this.camChase);
    this._chaseOk = false;
    this.pushFeed(this.camChase ? 'CAMERA: CHASE (3RD PERSON)' : 'CAMERA: NOSE', 'cyan');
  },

  throttleSpeed(t) { return SPEED_MIN + Math.max(0, Math.min(1, t)) * (this.maxSpeed() - SPEED_MIN); },

  modeForThrottle(t) { return t < 0.2 ? 1 : (t > 0.8 ? 3 : 2); },

  // Analog throttle: 0 = minimum speed, 1 = maximum. Mode (for FOV / fuel / boost drain) follows the lever.
  setThrottle(t) {
    if (this.state === 'READY') return;      // speed is locked at minimum until the rocket is launched
    const m = this.missile;
    t = Math.max(0, Math.min(1, t));
    if (t > CRUISE_THROTTLE && m.boostDepleted && !this.cfg.infBoost) {
      const now = performance.now();
      if (now - (this._lockMsgT || 0) > 2000) {
        this._lockMsgT = now;
        this.pushFeed('BOOST RECHARGING — SPEED CAPPED AT CRUISE', 'red');
      }
      t = CRUISE_THROTTLE;
    }
    m.throttle = t;
    if (!m.active) m.effThrottle = t;
    const mode = this.modeForThrottle(t);
    if (mode !== m.baseSpeedMode) {
      m.baseSpeedMode = mode;
      if (this.state === 'PLAYING') this.audio.playSpeedShift(mode);
    }
    this.updateSpeedBadgeUI();
  },

  vibrate(ms = 14) {
    if (this.hapticsEnabled && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (_) {}
    }
  },
};
