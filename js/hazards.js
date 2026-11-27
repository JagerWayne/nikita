/* Shared hazard rules: the single definition of how CIWS turret range and laser beams behave over time.
 * The game (enemies.js moves the beams and decides when they hurt; level.js builds them) and the autopilot (autopilot.js
 * predicts beams from the game clock) both call these functions, so a prediction can never drift from the real thing.
 * Leaf module: imports constants only. */
import { WALL_H } from './constants.js';

/* CIWS turrets: how far a bolt reaches, by difficulty tier (1-based). */
export function turretRange(tier) { return 26 + Math.min(14, (tier - 1) * 0.7); }

/* PULSE_GATE: three fixed beams that cycle OFF -> ARMING -> ACTIVE. Only ACTIVE (cycle time >= PULSE_ARM_END) hurts. */
export const PULSE_BEAM_YS = [1.55, 3.55, 5.55];
export const PULSE_CYCLE = 3.6;
export const PULSE_OFF_END = 1.35;
export const PULSE_ARM_END = 2.10;
export function pulseCycleTime(l, T) { return (T * (0.75 + l.speed * 0.18) + l.phase) % PULSE_CYCLE; }

/* SWEEPER_H: one vertical beam sliding across the span. */
export const SWEEP_H_Y0 = 0.15;
export function sweepHalfSpan(l) { return Math.max(0.5, (l.xMax - l.xMin) * 0.5 - 0.35); }
export function sweeperHX(l, T) { return l.midX + Math.sin(T * l.speed + l.phase) * sweepHalfSpan(l); }

/* TWIN_SWEEP: two horizontal beams bobbing in opposite phase around fixed heights. */
export const TWIN_BASE_Y = [2.25, 4.95];
export function twinPhase(k) { return k * Math.PI; }
export function twinSweepY(l, k, T) {
  return Math.max(0.65, Math.min(WALL_H - 0.65, TWIN_BASE_Y[k] + Math.sin(T * l.speed + l.phase + twinPhase(k)) * 1.35));
}

/* Default grid (SWEEPER_V): one horizontal beam bobbing up and down. */
export function sweeperVY(l, T) { return Math.max(0.75, Math.min(WALL_H - 0.75, 3.6 + Math.sin(T * l.speed + l.phase) * 2.35)); }

/* The beams of laser grid `l` at game time T, as segments in the grid's plane (x along the grid, y up).
 * Writes into `out` (an array of at least 3 { x1, y1, x2, y2 } objects, reused by the caller) and returns how many are live.
 * A disabled grid and a pulse grid that is not ACTIVE have none. */
export function laserBeamsAt(l, T, out) {
  if (l.disabled) return 0;
  if (l.mode === 'PULSE_GATE') {
    if (pulseCycleTime(l, T) < PULSE_ARM_END) return 0;
    for (let k = 0; k < 3; k++) { const b = out[k]; b.x1 = l.xMin; b.y1 = PULSE_BEAM_YS[k]; b.x2 = l.xMax; b.y2 = PULSE_BEAM_YS[k]; }
    return 3;
  }
  if (l.mode === 'SWEEPER_H') {
    const b = out[0], bx = sweeperHX(l, T);
    b.x1 = bx; b.y1 = SWEEP_H_Y0; b.x2 = bx; b.y2 = WALL_H - SWEEP_H_Y0;
    return 1;
  }
  if (l.mode === 'TWIN_SWEEP') {
    for (let k = 0; k < 2; k++) { const b = out[k], y = twinSweepY(l, k, T); b.x1 = l.xMin; b.y1 = y; b.x2 = l.xMax; b.y2 = y; }
    return 2;
  }
  const b = out[0], y = sweeperVY(l, T);
  b.x1 = l.xMin; b.y1 = y; b.x2 = l.xMax; b.y2 = y;
  return 1;
}

/* Fuel barrels: blast radius when one goes up, and how far a blast reaches another barrel (chain reaction). */
export const BARREL_BLAST_RADIUS = 9.2;
export const BARREL_CHAIN_REACH = BARREL_BLAST_RADIUS + 1.2;
