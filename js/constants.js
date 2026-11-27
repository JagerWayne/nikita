/* Game constants: grid, physics, balance numbers, cell types, speed modes and storage keys. No dependencies. */

export const GRID_SIZE = 64;
export const CELL_SIZE = 4.0;
export const WALL_H = 7.2;
export const FIXED_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 8;   // simulation steps allowed in one rendered frame (guards against a catch-up spiral)
export const SUBSTEPS = 4;
export const MISSILE_RADIUS = 0.42;
export const MAX_SALVO = 40;          // rockets issued at the start of a fresh sector
export const MAX_ROCKETS = 100;       // hard cap on rockets the player can hold (rewards stop here)
// Rocket rewards (balanced: rockets stay scarce). each = per kill / shutdown, all = bonus for wiping a category.
// Per-kill rocket payouts are retired (balance v2.3): rockets come from point packages, supply caches and medals.
export const REWARDS = {
  target: { each: 0, all: 0, label: 'PRIMARY TARGET',  allLabel: 'ALL PRIMARY TARGETS DESTROYED' },
  sentry: { each: 0, all: 0, label: 'SENTRY',          allLabel: 'ALL SENTRIES NEUTRALIZED' },
  laser:  { each: 0, all: 0, label: 'LASER GRID OFF',  allLabel: 'ALL LASER GRIDS OFFLINE' },
  turret: { each: 0, all: 0, label: 'CIWS TURRET',     allLabel: 'ALL CIWS TURRETS DESTROYED' },
  barrel: { each: 0, all: 0, label: 'FUEL BARREL',     allLabel: 'ALL FUEL BARRELS DETONATED' },
  grate:  { each: 0, all: 0, label: 'VENT GRATE',      allLabel: 'ALL VENT GRATES BREACHED' }
};
export const REWARD_BONUS = { directHit: 0, combo3: 0, combo5: 0, stealth: 0, rank: { PANTHER: 0, DOBERMAN: 0, HOUND: 0, FOXHOUND: 0 } };
export const REWARD_CAP_BASE = 12;            // rewards per sector are capped at BASE + PER_TIER * tier
export const REWARD_CAP_PER_TIER = 2;
export const CARRY_CAP = 20;                  // unspent rockets above the standard salvo that carry into the next sector
export const CACHE_ROCKETS = 5;               // supply cache found in a secret chamber (outside the sector cap)
// Hearing: sentries hear the rocket within a radius that grows with throttle
export const HEAR_MIN = 6;                    // radius at minimum speed
export const HEAR_RANGE = 40;                 // added at full throttle (curve: throttle^1.5)
export const HEAR_WALL_DAMP = 0.65;
export const LAUNCH_DROP_TIME = 0.3;          // seconds the rocket falls with cold thrusters after launch
export const LAUNCH_DROP_SPEED = 3.0;         // launch momentum before ignition
export const LAUNCH_GRAVITY = 9.0;
export const FLIP_TIME = 0.5;                 // flip-and-burn: seconds for the 180 degree backflip (thrusters cut)
export const BURN_TIME = 1.2;                 // after the flip the engine burns hard to reverse course
export const AIM_YAW_RATE = 1.1;              // rad/s of launch-angle adjustment at full stick
export const AIM_PITCH_RATE = 0.9;
export const AIM_PITCH_LIMIT = 1.2;           // about 69 degrees up or down
// Points. Kills score base points times a speed multiplier (slow impact x0.75 ... full speed x2).
// Every 100 points pays out a package of 10 rockets.
export const POINTS = {
  target: { each: 150, all: 150 },
  sentry: { each: 40,  all: 80 },
  laser:  { each: 35,  all: 80 },
  turret: { each: 60,  all: 100 },
  barrel: { each: 5,   all: 20 },
  grate:  { each: 10,  all: 20 }
};
export const POINTS_BONUS = { floor: 30, directHit: 50, combo3: 40, combo5: 120, stealth: 150, wall: 25, pickup: 20, medal: 60,
                       rank: { PANTHER: 0, DOBERMAN: 40, HOUND: 80, FOXHOUND: 160 } };
export const MULT_SLOW = 0.75;
export const MULT_FAST = 2.0;
export const POINTS_PER_PACKAGE = 250;
export const PACKAGE_ROCKETS = 5;
// ---- LIDAR VIEW ----
export const LIDAR_CAP = 100000;              // max dots kept / drawn per sector
export const VOX = 0.8;                       // memory resolution: one dot per 0.8-unit cube of surface
export const VOX_N = Math.ceil((GRID_SIZE * CELL_SIZE) / VOX);   // voxels across the facility (x and z)
export const MAX_FLOORS = 3;                  // multi-floor sectors: 2 floors from tier 4, 3 from tier 7
export const VOX_Y = Math.ceil(WALL_H * MAX_FLOORS / VOX);
export const VOX_HALF = GRID_SIZE * CELL_SIZE * 0.5;
export const LIDAR_KEY_PREFIX = 'M';          // 'M' = multi-floor map format (older single-floor maps are ignored)
export const FLOOR_SEG = 1 << 16;             // edge ids: floor f adds f * FLOOR_SEG
export const FEAT_BASE = 1 << 25;             // edge ids at or above this are ramp outlines (8 per ramp)
export const RAMP_LEN = 6;
export const RIM_BASE = 1 << 26;              // edge ids at or above this: rims of floor openings (holes, atriums, lifts)
export const LIFT_BASE = 1 << 27;             // edge ids at or above this: lift shaft corner beams
export const LIFT_SPEED = 6.0;                // how fast a lift carries the rocket (units/s)                    // ramp length in cells (gentle: ~17 degrees)
// ---- LANDING ----
export const LAND_SPEED = 9.0;                // (minimum lever speed 7.5 + 1.5) at or below this speed a gentle touch on flat floor lands the rocket
export const LAND_SINK = 4.0;                 // falling faster than this onto the floor detonates
export const LAND_PITCH = 0.45;               // nose more than ~26 degrees down onto the floor detonates
export const LAND_TAKEOFF = 0.14;             // raise the lever past this to lift off again
export const TAKEOFF_SPOOL = 0.45;            // seconds the engine spools up on the ground before the rocket rises
export const TAKEOFF_RISE = 0.85;             // seconds to climb off the floor and pitch up
export const TAKEOFF_HEIGHT = 1.7;            // hover height reached before pulling away
export const LAND_ARM_TIME = 24;              // an armed landing request lapses after this many seconds
export const PROBE_RANGE = 12;               // collision markers read walls, floor and roof out to this distance
export const FUZE_RANGE = 5.0;                // proximity fuze: the warhead goes off this close (centre to centre) to a primary target with a clear line
export const HOVER_SPEED_MAX = 4.0;           // hover mode: the lever runs 0 to 4 m/s
export const HOVER_CLIMB = 2.6;               // hover mode: climb / descent speed at full stick
export const LAND_LEAN = 0.34;                // a landed rocket settles leaning onto one fin (~7 deg camera tilt)
// ---- ROCKET GUN ----
export const GUN_CAP_MIN = 50;                // rounds carried with no upgrade
export const GUN_CAP_MAX = 200;               // fully upgraded (20 steps of 7.5)
export const GUN_STEPS = 20;
export const GUN_RATE = 9;                    // rounds per second while held
export const GUN_SPEED = 120;                 // bullet speed (plus the rocket's own speed)
export const GUN_LIFE = 0.55;                 // seconds before a bullet fades (~70 units)
export const GUN_POOL = 48;
export const GUN_PICKUP = 30;                 // rounds in an ammo crate
export const GUN_NOISE = 16;                  // gunfire is heard at least this far
export const GUN_HITS = { sentry: 3, turret: 6, grate: 2, box: 2 };   // bullets needed; barrels go up in one
export const SWITCH_CONE_MULT = 3;            // laser control boxes can be locked within 3x the seeker cone...
export const SWITCH_CONE_MAX = 55;            // ...up to 55 degrees off the nose
export const SHAFT_REVEAL_R = 10;             // shaft interiors are outlined only within this distance of the rocket
export const SHAFT_SEG_BASE = 1 << 24;        // edge ids at or above this are shaft outlines (cyan)
export const SENTRY_VISION = 14;             // how far sentries can see the rocket (was 22.5)
export const HOSTILE_ACCURACY = 0.5;         // fraction of hostile shots (sentries + CIWS) aimed true; the rest are deliberate near-misses
export const DECOY_RADIUS = 34;               // how far a decoy's noise carries
export const DECOY_LIFE = 7;                  // seconds a decoy keeps making noise
export const DECOYS_PER_SECTOR = 2;
export const MODIFIER_INFO = {
  'BLACKOUT':       'SENSOR INTERFERENCE — LIDAR RANGE -40%',
  'LOW FUEL':       'FUEL BURNS 60% FASTER',
  'KEEN EARS':      'SENTRIES HEAR 50% FARTHER',
  'HEAVY SECURITY': '50% MORE SENTRIES'
};
export const MODIFIER_CAP_BONUS = 4;          // hazard pay: extra reward cap in a modified sector           // radius multiplier per wall-cell of thickness between sentry and rocket
export const MAX_LEVELS = 100;
export const LEVELS_PER_TIER = 5;
export const MAX_TIERS = MAX_LEVELS / LEVELS_PER_TIER;
export const MAX_TETHER_PTS = 140;
export const SEEKER_CONE_DEG = 15;
export const SEEKER_CONE_COS = Math.cos((SEEKER_CONE_DEG * Math.PI) / 180);
export const MAX_LOCK_RANGE = 68.0;

export const CELL_WALL = 1;
export const CELL_FLOOR = 0;
export const CELL_RUNWAY = 2;
export const CELL_CRACKED = 3;   // destroyable wall: solid until a blast shatters it
export const CELL_SHAFT_LOW = 4;   // 4 / 5 / 6 = a shaft through the wall whose opening is the bottom / middle / top third
export const CELL_SHAFT_HIGH = 6;
export const CELL_RAMP = 7;      // a sloped ramp on the lower floor, rising one floor over RAMP_LEN cells
export const CELL_VOID = 8;      // no floor slab: the space above a ramp on the floor above
export const isWalkable = (v) => v === CELL_FLOOR || v === CELL_RUNWAY;
export const isShaft = (v) => v >= CELL_SHAFT_LOW && v <= CELL_SHAFT_HIGH;
export const isWallLike = (v) => v === CELL_WALL || v === CELL_CRACKED || isShaft(v);

export const SPEED_MIN = 7.5;    // throttle lever fully down
export const SPEED_MAX = 30.0;   // absolute ceiling the max-speed upgrade can reach
export const SPEED_START_CAP = 20.0;  // max speed before any upgrade (the lever's top end)
export const SPEED_STEP = 0.5;
export const CRUISE_THROTTLE = 0.378;
export const UPG_MAX_LEVEL = 10;
export const SAVE_KEY = 'nikita-save-v1';
export const AUTO_MEM_KEY = 'nikita.autoMem';   // the autopilot's explored-map memory per sector (older format)
export const XMAP_KEY = 'nikita.xmap';          // the plotted explore map per sector
// Explore map values: one cell per map tile, per floor, plotted only from what the lidar has actually revealed
export const XV = { UNK: 0, SOLID: 1, SH_TOP: 2, SH_MID: 3, SH_BOT: 4, OPEN: 5, RAMP: 6, HOLE: 7, HAZ: 8, ROUTE: 9, CRACK: 10 };

export const SPEED_MODES = {
  1: { name: '[1] CRAWL',     speed: 7.5,  fov: 62, turnMult: 1.38, fuelRate: 0.58, detectMult: 0.65, exhaustColor: 0xffaa33, exhaustScale: 0.22, exhaustCadence: 0.055, plumeXZ: 0.68, plumeY: 0.58, inertia: 13.5, rollMult: 0.42, badgeClass: 'tier-1' },
  2: { name: '[2] CRUISE',    speed: 16.0, fov: 75, turnMult: 1.00, fuelRate: 1.00, detectMult: 1.00, exhaustColor: 0xff6611, exhaustScale: 0.36, exhaustCadence: 0.028, plumeXZ: 0.95, plumeY: 1.05, inertia: 9.2, rollMult: 0.42, badgeClass: 'tier-2' },
  3: { name: '[3] OVERDRIVE', speed: 30.0, fov: 92, turnMult: 0.64, fuelRate: 1.72, detectMult: 1.15, exhaustColor: 0x33eeff, exhaustScale: 0.56, exhaustCadence: 0.014, plumeXZ: 1.38, plumeY: 1.95, inertia: 5.5, rollMult: 0.58, badgeClass: 'tier-3' }
};

/* Autopilot tuning (js/autopilot.js). Times are seconds of game time, distances metres, gains are stick units per radian / metre.
   Change a number here and nowhere else. */
export const AUTOPILOT_TUNING = Object.freeze({
  // --- cadence
  decideEvery: 1,            // mission decision (explore / pickup / engage / hunt)
  replanEvery: 1.5,          // is the current route still valid
  hazardEvery: 2,            // hazard layers (turbines, bulkheads, laser grids, turret cover)
  fanEvery: 0.1,             // forward clearance fan
  // --- timers and give-ups
  stuckAfter: 3, stuckMinMove: 0.8,           // less than 0.8 m of progress in 3 s = stuck
  scanMax: 10, boxWaitMax: 8, spotMax: 12,    // 360 scan, shooting a switch box, fighting a turret from its spot
  engageMax: 25,                              // longest a turret engagement is kept as the mission
  gateMax: 25, gateBlockFor: 30,              // a laser gate that will not open: give up, avoid that grid for a while
  turretIgnoreFor: 60,                        // a turret that could not be killed is ignored for this long
  // --- guidance (heading and altitude PD, look-ahead pursuit)
  yawGain: 2.4, yawDamp: 0.35,                // yaw stick = gain * heading error - damp * yaw rate
  climbGain: 1.4, climbDamp: 0.25,            // climb stick = gain * altitude error - damp * vertical speed
  lookBase: 2, lookPerSpeed: 0.6, lookMin: 2.5, lookMax: 9,   // look-ahead distance = clamp(base + perSpeed * speed)
  wpReach: 1.2, wpPassRange: 3, vertTol: 0.9, // waypoint reached / passed, height tolerance at a floor change
  roomMargin: 0.9,                            // keep this far from floor and ceiling
  // --- speed and walls
  brakeFrac: 0.5, brakeCap: 9,                // planning deceleration = min(cap, frac * measured braking)
  fanMargin: 1.8, crawlSpeed: 1.2,            // stop this far short of the free distance ahead; slowest crawl with a clear centre line
  turnSpeedFloor: 0.15,                       // speed factor never drops below this while turning
  wallMargin: 1.3, wallGain: 0.9,             // side wall closer than this pushes the yaw away
  wallSlowBase: 1.5, wallSlowGain: 5, wallSlowGap: 0.4,   // speed cap beside a wall = base + gain * (gap - slowGap)
  // --- command smoothing (per second)
  yawSlew: 5, climbSlew: 4, accelSlew: 9,
  // --- route search costs (tiles)
  costDiag: 1.414, costWall: 0.35, costHazard: 2.5, costSoft: 3, costGate: 12, costDanger: 6, costLink: 2.5,
  frontierBearing: 2.5, frontierDanger: 25, frontierSlack: 32,
  pickupMaxCost: 18,                          // a pickup is only fetched if its route costs at most this
  // --- fire control
  aimYawGain: 3.0, aimClimbGain: 1.6, aimSpeedCap: 1.5,   // steer onto the lead point and slow right down
  hitFrac: 0.8,                               // fire when the predicted sideways miss is under this fraction of the hit radius
  lockFramesMin: 6, trackAlpha: 6,            // frames in view to confirm a track; velocity smoothing rate
  giveUpAfter: 6, ignoreFor: 20,              // no kill in 6 s: ignore that contact for 20 s
  reserveRounds: 4,                           // rounds kept for threats
  burstExtra: 2, burstPause: 0.15,            // rounds beyond the kill count per burst, pause between bursts
  fire: {                                     // per contact kind
    CIWS: { pri: 8, range: 30, hitR: 1.0, vert: 0.8 },
    SENTRY: { pri: 5, range: 28, hitR: 0.7, vert: 0.95 },
    'LASER BOX': { pri: 4, range: 36, hitR: 0.75, vert: 0.6 }
  },
  // --- threats and evasion
  sentryThreatRange: 16,
  evadeBobAmp: 0.9, evadeBobAmpFiring: 0.35, evadeBobRate: 4.4,    // altitude bob (stick units, rad/s)
  evadeWeaveAmp: 0.55, evadeWeaveRate: 5.6,                        // heading weave
  evadeMinSpeed: 4.5                                               // never sit still under fire
});
