/* Tactical Upgrade Bay: the upgrade screen as a 3D inspection stage (a procedural rocket on a studio floor) beside an inspector
 * panel. Leaf view module: it is handed the game object (like the autopilot) and only calls its public methods
 * (upgradeCost, upgradeMax, buyUpgrade and the stat formulas in progress.js / lidar.js); it never imports game.js.
 * The 15 upgrade keys of game.upg map onto 6 physical assemblies, and every level changes that assembly's geometry.
 * Lifecycle: open() builds the scene, frame(dt) is driven by the game loop (which stops drawing its own scene meanwhile),
 * close() disposes every geometry and material it made. The WebGL renderer itself is created once and kept. */
import * as THREE from 'three';
import { RocketModel } from './rocketmodel.js';

const TAU = Math.PI * 2;
const pct = (v) => `${Math.round(v * 100)}%`;

/* ---------------------------------------------------------------------------------------------------------------------
   Hardware catalogue: assemblies (where on the rocket) and modules (one per upgrade key, with its stat readout)
   --------------------------------------------------------------------------------------------------------------------- */
const ASSEMBLIES = [
  { id: 'prop', name: 'PROPULSION BELL', tag: 'TAIL', keys: ['speed', 'boost'], focus: [-1.75, 0, 0], radius: 3.0,
    blurb: 'Exhaust bell, stator stages and plasma injection: top speed and boost.' },
  { id: 'ctrl', name: 'CONTROL SURFACES', tag: 'WINGS', keys: ['hull'], focus: [-1.1, 0, 0], radius: 3.1,
    blurb: 'Cruciform fins and the aft armour belt: how much a hit or scrape costs.' },
  { id: 'fuel', name: 'CRYO-FUEL SPINE', tag: 'MID-BODY', keys: ['fuel'], focus: [-0.15, 0, 0], radius: 3.0,
    blurb: 'Conformal saddle tanks along the spine: distance per tank.' },
  { id: 'ord', name: 'ORDNANCE POD', tag: 'VENTRAL / CORE', keys: ['gun', 'force'], focus: [0.75, -0.3, 0], radius: 3.0,
    blurb: 'Under-slung autocannon and the warhead collar: rounds carried and blast size.' },
  { id: 'lidar', name: 'LIDAR ARRAY', tag: 'DORSAL MAST', keys: ['lrange', 'lres', 'lfocus', 'lmem', 'ldeep'], focus: [0.3, 0.55, 0], radius: 3.0,
    blurb: 'The scanning mast that draws the map: range, density, focus, memory and deep scan.' },
  { id: 'seek', name: 'SEEKER NOSE', tag: 'NOSE CONE', keys: ['ltherm', 'tpen', 'ttrack', 'tmark'], focus: [1.95, 0, 0], radius: 2.6,
    blurb: 'Thermal optics and the lock-on seeker: what you can see, through what, and how long.' }
];
const ASM_OF = {};
for (const a of ASSEMBLIES) for (const k of a.keys) ASM_OF[k] = a.id;

const DEEP_TXT = ['OFF', 'CRACKED WALLS VISIBLE FROM AFAR', '+ SECRET CHAMBERS OUTLINED', '+ SHAFT INTERIORS AND POWER-UPS'];
const PEN_TXT = ['LINE OF SIGHT ONLY', 'SEES THROUGH 1 WALL', 'SEES THROUGH 2 WALLS', 'SEES THROUGH 3 WALLS'];
// stat(g, P): the readout at the game's current levels (P = g.lidarParams(true)). Same formulas the game uses.
const MODULES = {
  speed: { name: 'VORTEX RAMJET NOZZLE', stat: (g) => `${g.maxSpeed().toFixed(1)} m/s TOP SPEED · x${g.fullSpeedMult().toFixed(2)} POINTS AT FULL SPEED` },
  boost: { name: 'AFTERBURNER PLASMA INJECTORS', stat: (g) => `BOOST DRAIN -${pct(1 - g.boostDrainMult())} · RECHARGE +${pct(g.boostRechargeMult() - 1)}` },
  hull: { name: 'REACTIVE ABLATIVE PLATING', stat: (g) => `DAMAGE TAKEN -${pct(1 - g.hullDmgMult())}` },
  fuel: { name: 'CONFORMAL CRYO-CELL TANKS', stat: (g) => `FUEL BURN -${pct(1 - g.fuelBurnMult())}` },
  gun: { name: 'ROTARY AUTOCANNON DRUM', stat: (g) => `${g.gunCap()} ROUNDS` },
  force: { name: 'THERMOBARIC WARHEAD CORE', stat: (g) => `BLAST RADIUS ${g.blastRadiusBase().toFixed(1)} (+${pct(g.blastRadiusBase() / 8.2 - 1)}) · POWER x${(g.blastPowerBase() / 1.25).toFixed(2)}` },
  lrange: { name: 'LONG-BASELINE LASER EMITTER', stat: (g, P) => `LIDAR RANGE ${P.range.toFixed(1)} UNITS` },
  lres: { name: 'MULTI-BEAM PRISM MATRIX', stat: (g, P) => `${P.rays} RAYS · ${P.rows} ROWS · DOTS x${P.dot.toFixed(2)}` },
  lfocus: { name: 'GIMBALED APERTURE SHROUD', stat: (g, P) => `${Math.round(P.focus * 100)}% OF RAYS IN A ±${Math.round(P.coneDeg)}° FORWARD CONE` },
  lmem: { name: 'SOLID-STATE TELEMETRY CORE', stat: (g, P) => `GLOW ${P.glow.toFixed(1)}s · OLD DOTS ${Math.round(P.mem * 100)}% · ${P.keep} SECTORS KEPT` },
  ldeep: { name: 'SUB-SURFACE PENETRATOR ARRAY', stat: (g) => DEEP_TXT[g.upg.ldeep] || DEEP_TXT[3] },
  ltherm: { name: 'CRYO-COOLED IR OPTIC', stat: (g, P) => `ENEMIES + LASERS DETECTED TO ${P.thermal.toFixed(1)} UNITS` },
  tpen: { name: 'TERAHERTZ WALL-PIERCING LENS', stat: (g) => PEN_TXT[g.upg.tpen] || PEN_TXT[3] },
  ttrack: { name: 'GIMBALED SEEKER HEAD', stat: (g, P) => `SEEKER CONE ${P.seekerDeg}° · LOCK RANGE ${P.lockRange} UNITS` },
  tmark: { name: 'PERSISTENT BEACON ILLUMINATOR', stat: (g, P) => (P.mark > 0 ? `CONTACTS STAY MARKED ${P.mark.toFixed(1)}s AFTER LEAVING SIGHT` : 'OFF') }
};

/* camera limits and feel */
const CAM = { fov: 38, rMin: 2.2, rMax: 9, phiMin: 0.28, phiMax: 1.48, rotSpeed: 0.0075, damp: 4.5, frameRate: 5 };
const OVERVIEW = { focus: [0, 0, 0], radius: 6.2 };
const RING_Y = -1.0;

export class Hangar {
  constructor(game) {
    this.g = game;
    this.isOpen = false;
    this.renderer = null; this.gl = null;               // gl: true / false once creation was tried
    this.root = document.getElementById('upgrade-modal');
    this.stage = document.getElementById('hangar-stage');
    this.canvas = document.getElementById('hangar-canvas');
    this.svg = document.getElementById('hangar-pins');
    this.tabsEl = document.getElementById('hangar-tabs');
    this.asmEl = document.getElementById('hangar-assembly');
    this.modsEl = document.getElementById('hangar-modules');
    this.creditsEl = document.getElementById('upg-credits');
    this.sel = 'prop';
    this._lv = {};                                       // levels the 3D rocket was built for
    // scratch (the frame loop allocates nothing)
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._ndc = new THREE.Vector2();
    this._focus = new THREE.Vector3(); this._focusT = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    // orbit state (spherical around the focus point)
    this.theta = 0.75; this.phi = 1.12; this.radius = OVERVIEW.radius; this.radiusT = OVERVIEW.radius;
    this.vTheta = 0; this.vPhi = 0; this.idle = 0; this.time = 0;
    this.ptrs = new Map(); this.drag = null; this.pinch = 0;
    this.pulse = null;                                   // { group, t } while the install scan plays
    this.pins = [];
    // handlers bound once (added and removed on open / close)
    this._onResize = () => this.resize();
    this._onKey = (e) => { if (this.isOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.g.closeUpgrades(); } };
    this._onDown = (e) => this.pointerDown(e);
    this._onMove = (e) => this.pointerMove(e);
    this._onUp = (e) => this.pointerUp(e);
    this._onWheel = (e) => { e.preventDefault(); this.radiusT = Math.max(CAM.rMin, Math.min(CAM.rMax, this.radiusT * Math.exp(e.deltaY * 0.0012))); this.idle = 0; };
    if (this.canvas) {
      this.canvas.addEventListener('pointerdown', this._onDown);
      this.canvas.addEventListener('pointermove', this._onMove);
      this.canvas.addEventListener('pointerup', this._onUp);
      this.canvas.addEventListener('pointercancel', this._onUp);
      this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    }
    // the panel: one delegated click handler for tabs and INSTALL buttons
    const panel = document.getElementById('hangar-panel');
    if (panel) panel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.asm) this.select(b.dataset.asm, true);
      else if (b.dataset.key) this.g.buyUpgrade(b.dataset.key);   // buyUpgrade -> renderUpgrades -> refresh() rebuilds the part
    });
    if (this.svg) this.svg.addEventListener('click', (e) => { const p = e.target.closest('[data-asm]'); if (p) this.select(p.dataset.asm, true); });
  }

  /* ------------------------------------------------------------------ lifecycle ------------------------------------------------------------------ */
  open() {
    if (this.isOpen) { this.refresh(); return; }
    this.isOpen = true;
    this.ensureRenderer();
    if (this.gl) this.buildScene();
    if (this.gl) this.buildPins();
    this.renderTabs();
    this.select(this.sel, false);
    this._focus.set(OVERVIEW.focus[0], OVERVIEW.focus[1], OVERVIEW.focus[2]); this._focusT.copy(this._focus);
    this.radius = this.radiusT = OVERVIEW.radius; this.vTheta = this.vPhi = 0; this.idle = 0;
    window.addEventListener('resize', this._onResize);
    document.addEventListener('keydown', this._onKey, true);
    this.resize();
    this.refresh();
    if (this.root) this.root.classList.toggle('no-3d', !this.gl);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._onKey, true);
    this.ptrs.clear(); this.drag = null; this.pulse = null;
    this.disposeScene();
    if (this.svg) this.svg.textContent = '';
    this.pins.length = 0;
  }

  ensureRenderer() {
    if (this.gl !== null || !this.canvas) { if (!this.canvas) this.gl = false; return; }
    try {
      const prefs = this.g.prefs || {};
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !prefs.lowSpec, alpha: false, powerPreference: 'high-performance' });
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.setClearColor(0x030806, 1);
      this.gl = true;
    } catch (_) { this.gl = false; this.renderer = null; }   // no second WebGL context: the panel still works
  }

  /* --------------------------------------------------------------- scene building --------------------------------------------------------------- */
  buildScene() {
    const S = this.scene = new THREE.Scene();
    S.fog = new THREE.Fog(0x030806, 9, 22);
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.05, 60);
    this.mats = { pulse: new THREE.MeshBasicMaterial({ color: 0x66ffee, wireframe: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }) };   // install scan (disposed on close)
    // studio lighting: key, fill, two rims, soft sky
    const key = new THREE.DirectionalLight(0xfff1dd, 2.4); key.position.set(4, 5, 4);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.7); fill.position.set(-5, 2, 3);
    const rim = new THREE.DirectionalLight(0x00e5ff, 1.6); rim.position.set(-3, 3, -5);
    const rim2 = new THREE.DirectionalLight(0x00ff88, 0.8); rim2.position.set(4, 1, -4);
    S.add(key, fill, rim, rim2, new THREE.HemisphereLight(0x223a44, 0x020403, 0.6));
    // floor: dark plane, tactical grid, slow azimuth ring with ticks
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x040a08, metalness: 0.3, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = RING_Y - 0.002; S.add(floor);
    const grid = new THREE.GridHelper(24, 48, 0x00ff88, 0x0d3322);
    grid.position.y = RING_Y; grid.material.transparent = true; grid.material.opacity = 0.35; S.add(grid);
    const ring = this.ring = new THREE.Group(); ring.position.y = RING_Y + 0.004;
    const band = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.12, 128), new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    band.rotation.x = -Math.PI / 2; ring.add(band);
    const tick = [];
    for (let i = 0; i < 72; i++) { const a = (i / 72) * TAU, r0 = i % 6 === 0 ? 2.24 : 2.17; tick.push(Math.cos(a) * 2.12, 0, Math.sin(a) * 2.12, Math.cos(a) * r0, 0, Math.sin(a) * r0); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tick, 3));
    ring.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 })));
    S.add(ring);
    // the rocket: the same procedural model the game flies (js/rocketmodel.js)
    this.model = new RocketModel(this.g.upg);
    this.rocket = this.model.group; this.asm = this.model.asm; this._lv = this.model._lv;
    S.add(this.rocket);
  }

  buildAssembly(id) { if (this.model) this.model.buildAssembly(id, this.g.upg); }

  disposeScene() {
    if (!this.scene) return;
    const geos = new Set(), mats = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    });
    for (const m of Object.values(this.mats || {})) mats.add(m);
    if (this.model) for (const m of Object.values(this.model.mats)) mats.add(m);   // also the model's unused materials
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
    if (this.renderer) this.renderer.renderLists.dispose();
    this.scene = null; this.camera = null; this.rocket = null; this.ring = null; this.asm = null; this.mats = null; this.model = null; this._lv = {};
  }

  /* ------------------------------------------------------------------ the panel ------------------------------------------------------------------ */
  renderTabs() {
    if (!this.tabsEl) return;
    this.tabsEl.innerHTML = ASSEMBLIES.map((a, i) => `<button class="tac-btn hangar-tab" role="tab" data-asm="${a.id}"><b>${i + 1}</b> ${a.name}<small>${a.tag}</small></button>`).join('');
  }

  // Readout of `key` as if it were at level `lv` (the formulas read game.upg, so the level is swapped in for the call)
  statAt(key, lv) {
    const g = this.g, keep = g.upg[key];
    g.upg[key] = lv;
    const s = MODULES[key].stat(g, g.lidarParams(true));
    g.upg[key] = keep;
    return s;
  }

  // Panel content for the selected assembly, the credit balance, and any part whose level changed (rebuilt + scan pulse)
  refresh() {
    if (!this.isOpen) return;
    const g = this.g;
    if (this.creditsEl) this.creditsEl.textContent = String(g.credits);
    const a = ASSEMBLIES.find((x) => x.id === this.sel) || ASSEMBLIES[0];
    if (this.tabsEl) for (const b of this.tabsEl.children) b.classList.toggle('on', b.dataset.asm === a.id);
    if (this.asmEl) this.asmEl.innerHTML = `<div class="hangar-asm-name">${a.name} <span>${a.tag}</span></div><div class="hangar-asm-blurb">${a.blurb}</div>`;
    if (this.modsEl) {
      this.modsEl.innerHTML = a.keys.map((k) => {
        const lv = g.upg[k], max = g.upgradeMax(k), maxed = lv >= max, cost = maxed ? 0 : g.upgradeCost(k), can = !maxed && g.credits >= cost;
        const now = this.statAt(k, lv), next = maxed ? '' : this.statAt(k, lv + 1);
        return `<div class="hangar-card${maxed ? ' maxed' : ''}">
          <div class="hangar-card-head"><span class="hangar-card-name">${MODULES[k].name}</span><span class="hangar-card-lv">Lv ${lv} / ${max}</span></div>
          <div class="hangar-card-stat">${now}</div>
          ${maxed ? '<div class="hangar-card-next">FULLY UPGRADED</div>' : `<div class="hangar-card-next">NEXT: ${next}</div>`}
          <div class="hangar-bar"><i style="width:${(lv / max) * 100}%"></i></div>
          <div class="hangar-card-foot"><span class="hangar-cost">${maxed ? '' : cost + ' CR'}</span>
            <button class="tac-btn ${maxed ? '' : (can ? 'amber' : 'dim')}" data-key="${k}"${maxed || !can ? ' disabled' : ''}>${maxed ? 'MAXED' : 'INSTALL'}</button></div>
        </div>`;
      }).join('');
    }
    // a purchase changed a level: rebuild that assembly and play the scan over it
    for (const asm of ASSEMBLIES) {
      let changed = false;
      for (const k of asm.keys) if (this._lv[k] !== g.upg[k]) changed = true;
      if (changed && this.asm) { this.buildAssembly(asm.id); this.startPulse(asm.id); }
      else if (changed) for (const k of asm.keys) this._lv[k] = g.upg[k];
    }
    this.updatePinsState();
  }

  select(id, frame) {
    if (!ASSEMBLIES.some((a) => a.id === id)) return;
    this.sel = id;
    if (frame) { const a = ASSEMBLIES.find((x) => x.id === id); this._focusT.set(a.focus[0], a.focus[1], a.focus[2]); this.radiusT = a.radius; this.idle = 0; }
    this.refresh();
  }

  overview() { this._focusT.set(OVERVIEW.focus[0], OVERVIEW.focus[1], OVERVIEW.focus[2]); this.radiusT = OVERVIEW.radius; }

  /* --------------------------------------------------------------- callout pins --------------------------------------------------------------- */
  buildPins() {
    if (!this.svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    this.svg.textContent = '';
    this.pins.length = 0;
    for (const a of ASSEMBLIES) {
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'hangar-pin'); g.dataset.asm = a.id;
      const line = document.createElementNS(NS, 'line');
      const ret = document.createElementNS(NS, 'circle'); ret.setAttribute('r', '9'); ret.setAttribute('class', 'pin-ret');
      const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', '2.5'); dot.setAttribute('class', 'pin-dot');
      const hit = document.createElementNS(NS, 'circle'); hit.setAttribute('r', '13'); hit.setAttribute('class', 'pin-hit');
      const label = document.createElementNS(NS, 'text'); label.textContent = a.name; label.setAttribute('class', 'pin-label');
      g.append(line, ret, dot, label, hit);
      this.svg.appendChild(g);
      this.pins.push({ id: a.id, g, line, ret, dot, hit, label, x: -1, y: -1, lx: -1, ly: -1, side: 0, vis: true });
    }
    this.updatePinsState();
  }

  updatePinsState() { for (const p of this.pins) p.g.classList.toggle('on', p.id === this.sel); }

  // Project each assembly's anchor to the screen and move its reticle, label and leader line (DOM only touched when it moved)
  updatePins() {
    if (!this.pins.length || !this.camera) return;
    const w = this._w, h = this._h, v = this._v, c = this._v2;
    c.copy(this.rocket.position).project(this.camera);
    const cx = (c.x + 1) * 0.5 * w, cy = (1 - c.y) * 0.5 * h;
    for (let i = 0; i < this.pins.length; i++) {
      const p = this.pins[i], grp = this.asm[p.id];
      v.copy(grp.userData.anchor); this.rocket.localToWorld(v); v.project(this.camera);
      const vis = v.z < 1 && v.z > -1;
      if (vis !== p.vis) { p.vis = vis; p.g.style.display = vis ? '' : 'none'; }
      if (!vis) continue;
      const x = (v.x + 1) * 0.5 * w, y = (1 - v.y) * 0.5 * h;
      if (Math.abs(x - p.x) < 0.4 && Math.abs(y - p.y) < 0.4) continue;
      p.x = x; p.y = y;
      let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      let side = dx >= 0 ? 1 : -1;
      if (side > 0 && x + 54 > w - 130) side = -1; else if (side < 0 && x - 54 < 130) side = 1;   // labels never run off the stage
      const lx = Math.max(8, Math.min(w - 8, x + side * Math.max(30, Math.abs(dx) * 54))), ly = Math.max(16, Math.min(h - 10, y + dy * 40 - 14));
      p.line.setAttribute('x1', x.toFixed(1)); p.line.setAttribute('y1', y.toFixed(1));
      p.line.setAttribute('x2', lx.toFixed(1)); p.line.setAttribute('y2', ly.toFixed(1));
      const xs = x.toFixed(1), ys = y.toFixed(1);
      p.ret.setAttribute('cx', xs); p.ret.setAttribute('cy', ys); p.dot.setAttribute('cx', xs); p.dot.setAttribute('cy', ys); p.hit.setAttribute('cx', xs); p.hit.setAttribute('cy', ys);
      if (side !== p.side) { p.side = side; p.label.setAttribute('text-anchor', side > 0 ? 'start' : 'end'); }
      p.label.setAttribute('x', (lx + side * 4).toFixed(1)); p.label.setAttribute('y', (ly + 4).toFixed(1));
    }
  }

  /* ------------------------------------------------------------- input: orbit and pick ------------------------------------------------------------- */
  pointerDown(e) {
    if (!this.isOpen) return;
    this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 1) this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0 };
    if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); this.drag = null; }
    this.vTheta = this.vPhi = 0; this.idle = 0;
  }

  pointerMove(e) {
    if (!this.isOpen || !this.ptrs.has(e.pointerId)) return;
    const p = this.ptrs.get(e.pointerId); p.x = e.clientX; p.y = e.clientY;
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0) this.radiusT = Math.max(CAM.rMin, Math.min(CAM.rMax, this.radiusT * this.pinch / Math.max(1, d)));
      this.pinch = d; return;
    }
    const D = this.drag; if (!D) return;
    const dx = e.clientX - D.x, dy = e.clientY - D.y; D.x = e.clientX; D.y = e.clientY;
    D.moved += Math.abs(dx) + Math.abs(dy);
    this.theta -= dx * CAM.rotSpeed; this.phi = Math.max(CAM.phiMin, Math.min(CAM.phiMax, this.phi - dy * CAM.rotSpeed));
    this.vTheta = -dx * CAM.rotSpeed * 60; this.vPhi = -dy * CAM.rotSpeed * 60;   // flick: keeps turning and settles (inertia)
  }

  pointerUp(e) {
    const D = this.drag;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = 0;
    if (!D || e.type === 'pointercancel') { this.drag = null; return; }
    this.drag = null;
    if (D.moved < 6 && performance.now() - D.t < 450) { this.vTheta = this.vPhi = 0; this.pick(e.clientX, e.clientY); }
  }

  // A tap on the rocket selects the assembly under it; a tap on empty floor goes back to the overview
  pick(clientX, clientY) {
    if (!this.camera || !this.rocket) return;
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this._ndc, this.camera);
    const hit = this.ray.intersectObject(this.rocket, true).find((h) => h.object.userData.asm);
    if (hit) this.select(hit.object.userData.asm, true); else this.overview();
  }

  /* --------------------------------------------------------------- install pulse --------------------------------------------------------------- */
  startPulse(id) {
    const grp = this.asm && this.asm[id];
    if (!grp) return;
    if (this.pulse) this.endPulse();
    const ghosts = [];
    grp.traverse((o) => { if (o.isMesh && !o.userData.ghost) ghosts.push(o); });
    for (const o of ghosts) { const gm = new THREE.Mesh(o.geometry, this.mats.pulse); gm.userData.ghost = true; gm.scale.setScalar(1.04); o.add(gm); }
    this.pulse = { grp, t: 0 };
  }
  endPulse() {
    const P = this.pulse; this.pulse = null;
    if (!P) return;
    const rm = [];
    P.grp.traverse((o) => { if (o.userData.ghost) rm.push(o); });
    for (const o of rm) o.parent.remove(o);                  // ghosts share the part's geometry: nothing to dispose
    if (this.mats) this.mats.pulse.opacity = 0;
  }

  /* --------------------------------------------------------------- frame + resize --------------------------------------------------------------- */
  resize() {
    if (!this.stage) return;
    const r = this.stage.getBoundingClientRect();
    this._w = Math.max(1, Math.round(r.width)); this._h = Math.max(1, Math.round(r.height));
    if (this.svg) this.svg.setAttribute('viewBox', `0 0 ${this._w} ${this._h}`);
    for (const p of this.pins) { p.x = p.y = -1; }
    if (!this.renderer || !this.camera) return;
    const lowSpec = this.g.prefs && this.g.prefs.lowSpec;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowSpec ? 1 : 2));
    this.renderer.setSize(this._w, this._h, false);
    this.camera.aspect = this._w / this._h; this.camera.updateProjectionMatrix();
  }

  frame(dt) {
    if (!this.isOpen) return;
    if (!this.renderer || !this.scene) return;
    dt = Math.min(0.05, Math.max(0, dt));
    this.time += dt; this.idle += dt;
    // orbit inertia, gentle idle drift, framing lerps
    if (!this.drag) {
      this.theta += this.vTheta * dt; this.phi = Math.max(CAM.phiMin, Math.min(CAM.phiMax, this.phi + this.vPhi * dt));
      const k = Math.exp(-dt * CAM.damp); this.vTheta *= k; this.vPhi *= k;
      if (this.idle > 4 && this.ptrs.size === 0) this.theta += dt * 0.12;
    }
    const kf = 1 - Math.exp(-dt * CAM.frameRate);
    this._focus.lerp(this._focusT, kf);
    this.radius += (this.radiusT - this.radius) * kf;
    const sp = Math.sin(this.phi), cam = this.camera;
    cam.position.set(this._focus.x + this.radius * sp * Math.sin(this.theta), this._focus.y + this.radius * Math.cos(this.phi), this._focus.z + this.radius * sp * Math.cos(this.theta));
    cam.lookAt(this._focus);
    // studio motion: slow ring, a slight hover of the rocket
    this.ring.rotation.y += dt * 0.15;
    this.rocket.position.y = Math.sin(this.time * 1.3) * 0.03;
    this.rocket.rotation.x = Math.sin(this.time * 0.7) * 0.03;
    // install scan: a bright wireframe that fades out over the new part
    if (this.pulse) {
      this.pulse.t += dt;
      const f = this.pulse.t / 0.9;
      if (f >= 1) this.endPulse(); else this.mats.pulse.opacity = (1 - f) * (0.6 + 0.4 * Math.sin(this.pulse.t * 40));
    }
    this.renderer.render(this.scene, cam);
    this.updatePins();
  }
}
