/* Shared scratch math (pre-allocated THREE objects), the seeded PRNG and grid/world conversions. Scratch objects are reused every frame: never keep a reference across calls. */
import * as THREE from 'three';
import { CELL_SIZE, CRUISE_THROTTLE, GRID_SIZE, SPEED_MODES } from './constants.js';

export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _v4 = new THREE.Vector3();
export const _v5 = new THREE.Vector3();
export const _v6 = new THREE.Vector3();
export const _v7 = new THREE.Vector3();
export const _v8 = new THREE.Vector3();
export const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
export const _c1 = new THREE.Color();
export const _c2 = new THREE.Color();
export const BLEND_KEYS = ['fov', 'turnMult', 'fuelRate', 'detectMult', 'exhaustScale', 'exhaustCadence', 'plumeXZ', 'plumeY', 'inertia', 'rollMult'];
// Continuous flight profile: interpolates crawl -> cruise -> overdrive by lever position, so every
// speed-dependent value (FOV, turning, fuel burn, detection, plume) changes smoothly, not in 3 steps.
export function blendProfile(t, out) {
  const lo = t <= CRUISE_THROTTLE;
  const a = SPEED_MODES[lo ? 1 : 2];
  const b = SPEED_MODES[lo ? 2 : 3];
  const k = lo ? t / CRUISE_THROTTLE : (t - CRUISE_THROTTLE) / (1 - CRUISE_THROTTLE);
  for (let i = 0; i < BLEND_KEYS.length; i++) {
    const key = BLEND_KEYS[i];
    out[key] = a[key] + (b[key] - a[key]) * k;
  }
  _c1.setHex(a.exhaustColor).lerp(_c2.setHex(b.exhaustColor), k);
  out.exhaustColor = _c1.getHex();
  return out;
}
export const _profile = {}, _profileCam = {}, _profileSent = {};
export const _dummy = new THREE.Object3D();
export const _up = new THREE.Vector3(0, 1, 0);
export const _fwd = new THREE.Vector3(0, 0, -1);
// Private scratch vectors for VFX spawners + a copy of the blast epicenter, so callers'
// vectors (often the shared _v3) can never be mutated mid-explosion.
export const _f1 = new THREE.Vector3();
export const _f2 = new THREE.Vector3();
export const _f3 = new THREE.Vector3();
export const _blast = new THREE.Vector3();
export const _aimR = new THREE.Vector3();
export const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
export const _aimU = new THREE.Vector3();
export const PROBE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeedString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '1998');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function gridToWorldX(gx) { return (gx - GRID_SIZE * 0.5 + 0.5) * CELL_SIZE; }
export function gridToWorldZ(gz) { return (gz - GRID_SIZE * 0.5 + 0.5) * CELL_SIZE; }
export function worldToGridX(wx) { return Math.floor(wx / CELL_SIZE + GRID_SIZE * 0.5); }
export function worldToGridZ(wz) { return Math.floor(wz / CELL_SIZE + GRID_SIZE * 0.5); }
