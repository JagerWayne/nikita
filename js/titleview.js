/* Title screen showcase: a slowly turning 3D copy of the player's current rocket (js/rocketmodel.js, with every installed upgrade) in a
   transparent viewport above the menu. Leaf module (three + rocketmodel only), handed the game object like the upgrade bay.
   Only one 3D view draws at a time: game.js asks wantsFrame() and, while the title is showing, draws this instead of the game scene;
   everything it built (scene, geometry, materials, renderer internals) is disposed as soon as the title leaves the screen
   (a new game, the upgrade bay), and built again, with the then-current upgrades, when it comes back. */
import * as THREE from 'three';
import { RocketModel } from './rocketmodel.js';

export class TitleView {
  constructor(game) {
    this.g = game;
    this.canvas = document.getElementById('title-canvas');
    this.briefing = document.getElementById('briefing-modal');
    this.titleEl = document.getElementById('title-view');
    this.renderer = null; this.scene = null; this.camera = null; this.model = null; this.pivot = null;
    this.active = false; this.gl = null; this.spin = 0; this.syncT = 0; this.w = 0; this.h = 0;
  }

  // Is the title on screen, with nothing else 3D open? (cheap: called every frame)
  visible() {
    const g = this.g, c = this.canvas;
    return !!(c && g.state === 'BRIEFING' && !g.hangar.isOpen && !document.hidden && this.briefing && this.briefing.style.display !== 'none' &&
      this.titleEl && this.titleEl.style.display !== 'none' && c.offsetWidth > 0);
  }

  // true while this view owns the screen's 3D drawing; builds / disposes on the edges
  wantsFrame() {
    const on = this.gl !== false && this.visible();
    if (on && !this.active) this.build();
    else if (!on && this.active) this.dispose();
    return this.active;
  }

  build() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !(this.g.prefs && this.g.prefs.lowSpec), alpha: true, powerPreference: 'low-power' });
    } catch (_) { this.gl = false; this.renderer = null; this.canvas.style.display = 'none'; const ic = document.getElementById('title-icon'); if (ic) ic.style.display = ''; return; }
    this.gl = true;
    const r = this.renderer;
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    const S = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
    this.camera.position.set(1.2, 1.15, 8.6); this.camera.lookAt(0, -0.05, 0);
    // studio rim lighting: warm key from the front, cyan and green rims from behind, soft fill
    const key = new THREE.DirectionalLight(0xfff1dd, 2.3); key.position.set(4, 4, 5);
    const rim = new THREE.DirectionalLight(0x00e5ff, 2.2); rim.position.set(-4, 2.5, -5);
    const rim2 = new THREE.DirectionalLight(0x00ff88, 1.4); rim2.position.set(5, 0.5, -4);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.6); fill.position.set(-5, 1, 4);
    S.add(key, rim, rim2, fill, new THREE.HemisphereLight(0x335566, 0x050a08, 0.7));
    this.pivot = new THREE.Group();
    this.model = new RocketModel(this.g.upg);                  // the saved upgrades (this.upg is loaded from nikita-save-v1)
    this.pivot.add(this.model.group);
    this.pivot.rotation.set(0, 0.6, -0.12);                    // a slight nose-up hero angle
    this.model.group.rotation.z = 0.2;
    S.add(this.pivot);
    this.active = true; this.w = this.h = 0; this.syncT = 0;
    this.resize();
  }

  resize() {
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h || (w === this.w && h === this.h)) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, (this.g.prefs && this.g.prefs.lowSpec) ? 1 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  frame(dt) {
    if (!this.active) return;
    this.resize();
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 0.5; this.model.sync(this.g.upg); }     // parts installed in the bay show at once
    this.spin += dt * 0.45;
    this.model.group.rotation.x = this.spin;                                    // roll about the long axis (the model's +X)
    this.pivot.rotation.y = 0.6 + Math.sin(this.spin * 0.5) * 0.12;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.active = false;
    if (this.scene) {
      const geos = new Set(), mats = new Set();
      this.scene.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      });
      if (this.model) for (const m of Object.values(this.model.mats)) mats.add(m);
      geos.forEach((x) => x.dispose()); mats.forEach((x) => x.dispose());
    }
    if (this.renderer) { this.renderer.renderLists.dispose(); this.renderer.dispose(); }
    this.renderer = null; this.scene = null; this.camera = null; this.model = null; this.pivot = null;
  }
}
