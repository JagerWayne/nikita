/* The rocket model: a procedural Nikita airframe whose six assemblies change shape with the upgrade levels in game.upg.
 * Shared by the upgrade bay (js/hangar.js) and the rocket you fly (level.js initMissileMesh), so both always look the same.
 * Leaf module (three only). Model space: nose along +X, length about 4.8 units, body radius 0.32; the game scales and turns it.
 * Each instance owns its materials; dispose() frees them and every geometry. */
import * as THREE from 'three';

const TAU = Math.PI * 2;
export const BODY_R = 0.32, BODY_HALF = 1.5;
// assembly id -> the upgrade keys whose levels shape it
export const ASSEMBLY_KEYS = {
  prop: ['speed', 'boost'], ctrl: ['hull'], fuel: ['fuel'], ord: ['gun', 'force'],
  lidar: ['lrange', 'lres', 'lfocus', 'lmem', 'ldeep'], seek: ['ltherm', 'tpen', 'ttrack', 'tmark']
};
const IDS = Object.keys(ASSEMBLY_KEYS);

export class RocketModel {
  constructor(u) {
    const M = this.mats = {
      hull: new THREE.MeshStandardMaterial({ color: 0x8c979a, metalness: 0.75, roughness: 0.32 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x23292b, metalness: 0.6, roughness: 0.45 }),
      darkIn: new THREE.MeshStandardMaterial({ color: 0x23292b, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide }),   // open shells seen from inside
      tiIn: new THREE.MeshStandardMaterial({ color: 0xc9d2d4, metalness: 0.9, roughness: 0.22, side: THREE.DoubleSide }),
      ti: new THREE.MeshStandardMaterial({ color: 0xc9d2d4, metalness: 0.9, roughness: 0.22 }),
      green: new THREE.MeshStandardMaterial({ color: 0x0b2a1b, emissive: 0x00ff88, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.5 }),
      cyan: new THREE.MeshStandardMaterial({ color: 0x062a30, emissive: 0x00e5ff, emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.4 }),
      amber: new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffaa00, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 }),
      violet: new THREE.MeshStandardMaterial({ color: 0x1d0a2e, emissive: 0xb066ff, emissiveIntensity: 1.0, metalness: 0.3, roughness: 0.4 }),
      sapphire: new THREE.MeshStandardMaterial({ color: 0x0a2a5a, emissive: 0x2a7bff, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.15 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1a3550, emissive: 0xff7a1a, emissiveIntensity: 0.25, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.85 }),
      hazard: new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5, roughness: 0.6 })
    };
    const rk = this.group = new THREE.Group();
    rk.add(new THREE.Mesh(this.cyl(BODY_R, BODY_R, BODY_HALF * 2, 40), M.hull));
    for (const x of [-0.95, 0.55, 1.15]) { const s = new THREE.Mesh(this.torus(BODY_R + 0.004, 0.008, 40), M.dark); s.position.x = x; rk.add(s); }
    this.asm = {}; this._lv = {};
    for (const id of IDS) { const grp = new THREE.Group(); grp.name = id; rk.add(grp); this.asm[id] = grp; }
    if (u) for (const id of IDS) this.buildAssembly(id, u);
  }

  // Rebuild the assemblies whose levels changed since they were built; returns their ids (an empty array when none did)
  sync(u) {
    const changed = [];
    for (const id of IDS) { const ks = ASSEMBLY_KEYS[id]; for (let i = 0; i < ks.length; i++) if (this._lv[ks[i]] !== u[ks[i]]) { this.buildAssembly(id, u); changed.push(id); break; } }
    return changed;
  }

  // Model-space x of the nozzle exit (the exhaust bell grows with the max-speed upgrade)
  tailX(u) { return -BODY_HALF - (0.42 + 0.03 * ((u && u.speed) || 0)); }

  // geometry helpers: cylinders and cones along +X, tori around the X axis
  cyl(rTop, rBot, h, seg = 24, open = false) { const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open); g.rotateZ(-Math.PI / 2); return g; }
  torus(r, tube, seg = 32) { const g = new THREE.TorusGeometry(r, tube, 8, seg); g.rotateY(Math.PI / 2); return g; }
  part(grp, geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); grp.add(m); return m; }

  // Rebuild one assembly for the current upgrade levels (old geometry disposed first)
  buildAssembly(id, u) {
    const grp = this.asm && this.asm[id];
    if (!grp) return;
    this.disposeChildren(grp);
    const M = this.mats, A = grp.userData.anchor || (grp.userData.anchor = new THREE.Vector3());
    for (const k of ASSEMBLY_KEYS[id]) this._lv[k] = u[k];
    if (id === 'prop') {
      const L = 0.42 + 0.03 * u.speed, rb = 0.36 + 0.004 * u.speed, x0 = -BODY_HALF;
      this.part(grp, this.cyl(0.27, rb, L, 32, true), M.darkIn, x0 - L / 2);
      this.part(grp, this.cyl(0.18, rb - 0.03, L * 0.85, 28, true), M.hull, x0 - L * 0.52);
      const nStator = Math.floor(u.speed / 4);
      for (let i = 0; i < nStator; i++) this.part(grp, this.torus(0.2 + (rb - 0.2) * ((i + 1) / (nStator + 1)), 0.012, 28), M.ti, x0 - L * ((i + 1) / (nStator + 1)));
      const collarMat = u.boost > 0 ? M.cyan : M.dark;
      this.part(grp, this.torus(0.3, 0.03 + 0.002 * u.boost, 36), collarMat, x0 - 0.04);
      const nInj = u.boost > 0 ? Math.min(8, 3 + Math.floor(u.boost / 2)) : 0;
      for (let i = 0; i < nInj; i++) {
        const a = (i / nInj) * TAU, c = Math.cos(a), s = Math.sin(a);
        this.part(grp, new THREE.BoxGeometry(0.16 + 0.012 * u.boost, 0.05, 0.05), M.ti, x0 - 0.1, c * (BODY_R + 0.02), s * (BODY_R + 0.02));
        this.part(grp, new THREE.SphereGeometry(0.03, 10, 8), M.cyan, x0 - 0.18 - 0.006 * u.boost, c * (BODY_R + 0.02), s * (BODY_R + 0.02));
      }
      A.set(x0 - L * 0.55, (0.27 + rb) * 0.5 + 0.01, 0);
    } else if (id === 'ctrl') {
      const span = 0.55, chord = 0.55, th = 0.028 + 0.005 * u.hull, xc = -1.12;
      const fin = new THREE.BoxGeometry(chord, span, th);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2, m = this.part(grp, i === 0 ? fin : fin.clone(), u.hull >= 6 ? M.ti : M.hull, xc, Math.cos(a) * (BODY_R + span / 2), Math.sin(a) * (BODY_R + span / 2));
        m.rotation.x = a;
        if (u.hull >= 3) { const f = this.part(grp, new THREE.BoxGeometry(chord * 1.12, 0.07 + 0.006 * u.hull, th + 0.07), M.dark, xc, Math.cos(a) * (BODY_R + 0.03), Math.sin(a) * (BODY_R + 0.03)); f.rotation.x = a; }
      }
      for (let i = 0; i < u.hull; i++) this.part(grp, this.cyl(BODY_R + 0.016, BODY_R + 0.016, 0.045, 36), M.ti, -1.45 + i * 0.095);
      A.set(xc + 0.05, Math.cos(Math.PI / 4) * (BODY_R + span * 0.8), Math.sin(Math.PI / 4) * (BODY_R + span * 0.8));
    } else if (id === 'fuel') {
      const xc = -0.15;
      for (const zs of [1, -1]) this.part(grp, new THREE.BoxGeometry(1.2, 0.04, 0.03), M.dark, xc, 0, zs * (BODY_R + 0.01));
      if (u.fuel > 0) {
        const r = 0.1 + 0.004 * u.fuel, len = 0.6 + 0.07 * u.fuel;
        for (const zs of [1, -1]) {
          const tank = this.part(grp, new THREE.CapsuleGeometry(r, len, 6, 20), M.hull, xc, 0, zs * (BODY_R + r - 0.02));
          tank.rotation.z = Math.PI / 2;
          const fill = (len + r) * (u.fuel / 10);
          this.part(grp, new THREE.BoxGeometry(fill, 0.022, 0.03), M.green, xc - (len + r) / 2 + fill / 2, r * 0.75, zs * (BODY_R + r - 0.02));
        }
        A.set(xc, 0, BODY_R + 2 * r - 0.03);
      } else A.set(xc, 0, BODY_R + 0.025);
    } else if (id === 'ord') {
      const dy = -BODY_R - 0.11;
      this.part(grp, this.cyl(0.11, 0.11, 0.34, 20), M.dark, 0.45, dy);
      this.part(grp, new THREE.BoxGeometry(0.22, 0.12, 0.08), M.hull, 0.45, -BODY_R - 0.03);
      if (u.gun > 0) {
        const L = 0.45 + 0.035 * u.gun;
        for (const zs of [1, -1]) this.part(grp, this.cyl(0.022, 0.026, L, 12), M.ti, 0.62 + L / 2, dy - 0.02, zs * 0.05);
        this.part(grp, new THREE.BoxGeometry(0.3, 0.05, 0.05), M.amber, 0.3, -BODY_R - 0.06, 0.1);    // ammo feed chute
      } else this.part(grp, this.cyl(0.02, 0.024, 0.3, 12), M.ti, 0.77, dy - 0.02);
      this.part(grp, this.cyl(BODY_R + 0.012, BODY_R + 0.012, 0.06, 40), M.dark, 1.3);                // warhead collar base
      for (let i = 0; i < u.force; i++) this.part(grp, this.torus(BODY_R + 0.016, 0.014, 36), i % 2 ? M.hazard : M.amber, 1.2 + i * 0.026);   // hazard bands, amber / black
      A.set(0.45, dy - 0.11, 0);
    } else if (id === 'lidar') {
      const H = 0.22 + 0.055 * u.lrange, x = 0.35, y0 = BODY_R;
      this.part(grp, new THREE.BoxGeometry(0.22, 0.06, 0.16), M.dark, x, y0 + 0.02);
      this.part(grp, new THREE.CylinderGeometry(0.032, 0.04, H, 12), M.hull, x, y0 + 0.05 + H / 2);
      const hy = y0 + 0.05 + H + 0.04;
      this.part(grp, new THREE.BoxGeometry(0.2, 0.08, 0.1), M.dark, x + 0.03, hy);
      this.part(grp, this.cyl(0.035, 0.035, 0.05, 16), M.cyan, x + 0.155, hy);
      if (u.lfocus > 0) this.part(grp, this.cyl(0.045, 0.06 + 0.007 * u.lfocus, 0.06 + 0.018 * u.lfocus, 16, true), M.tiIn, x + 0.18 + (0.06 + 0.018 * u.lfocus) / 2, hy);
      if (u.lres > 0) this.part(grp, new THREE.BoxGeometry(1.25, 0.018, 0.05), M.dark, 0.25, y0 + 0.006);
      for (let i = 0; i < u.lres; i++) { const p = this.part(grp, new THREE.OctahedronGeometry(0.034), M.sapphire, -0.32 + i * 0.125, y0 + 0.04); p.rotation.y = i * 0.6; }
      const nFin = u.lmem > 0 ? Math.min(6, 1 + Math.floor(u.lmem / 2)) : 0;
      for (let i = 0; i < nFin; i++) {
        this.part(grp, new THREE.BoxGeometry(0.07, 0.1 + 0.01 * u.lmem, 0.012), M.hull, x - 0.2 - i * 0.09, y0 + 0.07);
        this.part(grp, new THREE.SphereGeometry(0.013, 8, 6), M.cyan, x - 0.2 - i * 0.09, y0 + 0.13 + 0.01 * u.lmem);
      }
      for (let i = 0; i < u.ldeep; i++) { const c = this.part(grp, new THREE.TorusGeometry(0.07 + 0.012 * i, 0.016 + 0.004 * i, 8, 24), M.violet, x, y0 + 0.08 + i * 0.05); c.rotation.x = Math.PI / 2; }
      A.set(x + 0.03, hy + 0.045, 0);
    } else if (id === 'seek') {
      const nl = 0.75, x0 = BODY_HALF, rAt = (x) => BODY_R * (1 - (x - x0) / nl);
      this.part(grp, new THREE.ConeGeometry(BODY_R, nl, 40).rotateZ(-Math.PI / 2), M.hull, x0 + nl / 2);
      const dr = 0.09 + 0.004 * u.ltherm;
      const dome = this.part(grp, new THREE.SphereGeometry(dr, 24, 16), M.glass, x0 + nl - 0.07);
      dome.material.emissiveIntensity = 0.25 + 0.07 * u.ltherm;
      const nRing = Math.floor(u.ltherm / 2);
      for (let i = 0; i < nRing; i++) { const xr = x0 + 0.12 + i * 0.09; this.part(grp, this.torus(rAt(xr) + 0.006, 0.011, 32), i % 2 ? M.amber : M.sapphire, xr); }
      for (let i = 0; i < u.tpen; i++) this.part(grp, this.torus(dr * (0.45 + 0.18 * i), 0.008, 24), M.cyan, x0 + nl - 0.07 + dr * 0.82 - i * 0.012);
      this.part(grp, this.torus(BODY_R + 0.02 + 0.006 * u.ttrack, 0.018 + 0.002 * u.ttrack, 40), M.dark, x0 + 0.02);
      const nVane = u.ttrack > 0 ? 2 * Math.ceil(u.ttrack / 3) : 0;
      for (let i = 0; i < nVane; i++) {
        const a = (i / nVane) * TAU + Math.PI / nVane, rr = BODY_R + 0.05 + 0.006 * u.ttrack;
        const v = this.part(grp, new THREE.BoxGeometry(0.1, 0.05 + 0.004 * u.ttrack, 0.012), M.ti, x0 + 0.02, Math.cos(a) * rr, Math.sin(a) * rr);
        v.rotation.x = a;
      }
      if (u.tmark > 0) {
        const len = 0.12 + 0.03 * u.tmark;
        for (const zs of [1, -1]) {
          const w = this.part(grp, new THREE.CylinderGeometry(0.006, 0.008, len, 6), M.ti, x0 - 0.08, BODY_R + len * 0.42, zs * 0.12);
          w.rotation.z = 0.5; w.rotation.x = zs * 0.25;
          this.part(grp, new THREE.SphereGeometry(0.014, 8, 6), M.amber, x0 - 0.08 - Math.sin(0.5) * len * 0.5, BODY_R + len * 0.85, zs * (0.12 + Math.sin(0.25) * len * 0.5));
        }
      }
      A.set(x0 + nl - 0.07 + dr * 0.7, dr * 0.5, 0);
    }
    grp.traverse((o) => { if (o.isMesh) o.userData.asm = id; });
  }

  // Parts share the materials in this.mats (disposed on close); only their geometry is per build
  disposeChildren(grp) {
    for (let i = grp.children.length - 1; i >= 0; i--) {
      const o = grp.children[i];
      grp.remove(o);
      o.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
    }
  }

  dispose() {
    const geos = new Set();
    this.group.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
    geos.forEach((g) => g.dispose());
    for (const k of Object.keys(this.mats)) this.mats[k].dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
