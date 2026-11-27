/* Menus, prefs, intro call, upgrade screen and HUD text helpers for NikitaGame. */
import { CRUISE_THROTTLE, MAX_LEVELS, MAX_ROCKETS, MAX_TIERS, SAVE_KEY } from './constants.js';

export const uiMethods = {

  // The upgrade screen is the 3D bay (js/hangar.js): it draws the modules, costs and levels; buyUpgrade() calls this after a purchase
  renderUpgrades() {
    if (this.hangar && this.hangar.isOpen) this.hangar.refresh();
    const c = document.getElementById('upg-credits');
    if (c) c.textContent = String(this.credits);
    this.updateCreditLabels();
  },

  updateCreditLabels() {
    const b = document.getElementById('btn-upgrades');
    if (b) b.textContent = `UPGRADES · ${this.credits} CR`;
    this.refreshTitleMenu();
  },

  // Is there anything saved on this device? (a sector to resume, credits, upgrades or best scores)
  hasSave() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d || typeof d !== 'object') return false;
      return (d.lvl > 0) || (d.credits > 0) || Object.keys(d.best || {}).length > 0 || Object.values(d.upg || {}).some((v) => v > 0);
    } catch (_) { return false; }
  },

  // CONTINUE is greyed out without a save; the default focus goes to CONTINUE when a save exists, otherwise NEW.
  refreshTitleMenu() {
    const cont = document.getElementById('btn-continue');
    if (!cont) return;
    const has = this.hasSave();
    cont.disabled = !has;
    const info = document.getElementById('continue-info');
    if (info) info.textContent = has ? ('Saved: sector ' + (this.contLvl || 1) + ' · ' + this.credits + ' credits') : 'No saved game on this device.';
    const tv = document.getElementById('title-view');
    if (tv && tv.style.display !== 'none' && this.state === 'BRIEFING') {
      const t = has ? cont : document.getElementById('btn-new');
      try { t.focus({ preventScroll: true }); } catch (_) {}
    }
  },

  showTitleView(optionsToo) {
    const tv = document.getElementById('title-view'), ov = document.getElementById('options-view');
    if (!tv || !ov) return;
    tv.style.display = optionsToo ? 'none' : '';
    ov.style.display = optionsToo ? 'block' : 'none';
    if (!optionsToo) this.refreshTitleMenu();
  },

  // Radio call from Meryl before a new campaign: asks the player to eliminate every target and destroy as much as possible.
  playIntroCall() {
    const root = document.getElementById('meryl-call');
    if (!root) return Promise.resolve();
    const lines = [
      'Nikita, this is Meryl. Good, the line is clean. Listen carefully, we do not have much time.',
      'There are a hundred sectors in that facility, and every one holds primary targets. Eliminate every single target. That is the mission.',
      'And while you are in there, destroy as much as you can: sentries, turrets, laser boxes, fuel barrels, vent grates, cracked walls. Everything that burns is points, and points are credits for your upgrades.',
      'Fly low and keep the speed down: they hear you coming. Watch your fuel, an empty tank ends the flight. I will be on the line the whole way. Good hunting, Nikita.'
    ];
    const ring = document.getElementById('mc-ring'), lineEl = document.getElementById('mc-line'), obj = document.getElementById('mc-obj');
    const nextBtn = document.getElementById('mc-next'), skipBtn = document.getElementById('mc-skip');
    return new Promise((resolve) => {
      let stage = 'ring', idx = -1, typing = 0, ringTimer = 0, pos = 0;
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stopTyping = () => { clearInterval(typing); typing = 0; root.classList.remove('talking'); };
      const finish = () => {
        stopTyping(); clearInterval(ringTimer);
        document.removeEventListener('keydown', onKey, true);
        root.style.display = 'none';
        try { this.audio.playRadioBlip(); } catch (_) {}
        resolve();
      };
      const type = (text) => {
        stopTyping(); pos = 0; lineEl.textContent = '';
        if (reduce) { lineEl.textContent = text; return; }
        root.classList.add('talking');
        typing = setInterval(() => {
          pos += 2; lineEl.textContent = text.slice(0, pos);
          if (pos >= text.length) stopTyping();
        }, 28);
      };
      const next = () => {
        if (stage === 'ring') {
          clearInterval(ringTimer); ring.style.display = 'none'; stage = 'talk'; idx = 0;
          try { this.audio.playRadioBlip(); } catch (_) {}
          nextBtn.textContent = 'NEXT'; type(lines[0]); return;
        }
        if (typing) { stopTyping(); lineEl.textContent = lines[idx]; return; }     // first tap completes the line
        if (idx < lines.length - 1) { idx++; try { this.audio.playRadioBlip(); } catch (_) {} type(lines[idx]); if (idx === lines.length - 1) { obj.style.display = 'block'; nextBtn.textContent = 'BEGIN MISSION'; } return; }
        finish();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); next(); }
      };
      ring.style.display = ''; lineEl.textContent = ''; obj.style.display = 'none'; nextBtn.textContent = 'ANSWER';
      root.style.display = 'flex';
      document.addEventListener('keydown', onKey, true);
      nextBtn.onclick = next; skipBtn.onclick = finish;
      try { this.audio.playRing(); } catch (_) {}
      ringTimer = setInterval(() => { try { this.audio.playRing(); } catch (_) {} }, 1500);
      try { nextBtn.focus({ preventScroll: true }); } catch (_) {}
    });
  },

  openUpgrades() {
    document.getElementById('upgrade-modal').style.display = 'flex';   // shown first: the bay sizes its stage from the layout
    if (this.hangar) this.hangar.open();
    this.renderUpgrades();
  },

  closeUpgrades() {
    document.getElementById('upgrade-modal').style.display = 'none';
    if (this.hangar) this.hangar.close();                              // frees every bay geometry and material
  },

  // Abandon the current sector and go back to the title screen (where upgrades can be bought).
  exitToMenu() {
    this.lidarSnapshot();
    this.paused = false;
    this.state = 'BRIEFING';
    this.missile.active = false;
    this.missileGroup.visible = false;
    this.closeUpgrades();
    for (const id of ['pause-modal', 'clear-modal', 'fail-modal', 'killcam-banner', 'fire-btn', 'hud-layer']) {
      const e = document.getElementById(id);
      if (e) e.style.display = 'none';
    }
    document.getElementById('briefing-modal').style.display = 'flex';
    this.showTitleView(false);
    const lv = document.getElementById('brief-level');
    if (lv) lv.value = String(this.level);
    this.resetOverlays();
    this.resetAllInputs();
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (_) {}
    this.updateCreditLabels();
    this.updateTouchControlsVisibility();
  },

  popAmmoHUD() {
    const el = document.getElementById('hud-ammo');
    if (!el) return;
    el.classList.remove('reward-pop');
    void el.offsetWidth;
    el.classList.add('reward-pop');
  },

  updateHUDText() {
    document.getElementById('hud-sector').textContent = `${String(this.level).padStart(2, '0')} / ${MAX_LEVELS}`;
    document.getElementById('hud-tier').textContent = `TIER ${String(this.difficultyTier).padStart(2, '0')} / ${MAX_TIERS}`;
    document.getElementById('hud-ammo').textContent = `${this.ammo} / ${MAX_ROCKETS}`;
    const gEl = document.getElementById('hud-gun');
    if (gEl) gEl.textContent = `${this.gunAmmo} / ${this.gunCap()}`;
    const ptsEl = document.getElementById('hud-pts');
    if (ptsEl) ptsEl.textContent = `${this.score} / ${this.nextPackage}`;
    const dBtn = document.getElementById('tbtn-decoy');
    if (dBtn) { dBtn.innerHTML = `DECOY<br/>x${this.decoys}`; dBtn.style.opacity = this.decoys > 0 ? '' : '0.4'; }
    const remT = this.targets.filter(t => t.active).length;
    document.getElementById('hud-targets').textContent = `${remT} / ${this.targets.length}`;
    const remS = this.sentries.filter(s => s.active).length;
    document.getElementById('hud-sentries').textContent = `${remS} / ${this.sentries.length}`;
    document.getElementById('hud-seed').textContent = this.seedStr;
    const warpInput = document.getElementById('ov-warp-input');
    if (warpInput) warpInput.value = String(this.level);
  },

  pushFeed(msg, tone = 'green') {
    const container = document.getElementById('hud-bottom-right');
    const el = document.createElement('div');
    el.className = `feed-item ${tone}`;
    el.textContent = msg;
    container.appendChild(el);
    while (container.children.length > 3) container.removeChild(container.firstChild);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3400);
  },

  exitGame() {
    this.saveProgress();
    this.stopped = true;
    this.paused = true;
    try { if (this.audio && this.audio.ctx) this.audio.ctx.close(); } catch (_) {}
    try { this.setGyroEnabled(false); } catch (_) {}
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (_) {}
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (_) {}
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) {}
    try { this.renderer.dispose(); if (this.renderer.forceContextLoss) this.renderer.forceContextLoss(); } catch (_) {}
    window.close();
    setTimeout(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#050a08;color:#00ff88;font:15px/1.6 monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;';
      box.innerHTML = '<div style="font-size:22px;letter-spacing:0.18em">GAME CLOSED</div>' +
        '<img src="icons/icon-192.png" width="72" height="72" alt="" style="border-radius:22%">' +
        '<div style="letter-spacing:.14em">THANKS FOR PLAYING</div>' +
        '<div style="opacity:.75;max-width:420px">Your progress is saved. You can now close this app (swipe it away or press Home). Nothing is running in the background.</div>' +
        '<button id="nk-relaunch" style="padding:12px 22px;font:bold 14px monospace;letter-spacing:0.14em;background:#00ff88;color:#02120a;border:0;border-radius:6px">BACK TO MENU</button>';
      document.body.appendChild(box);
      document.getElementById('nk-relaunch').onclick = () => location.reload();
    }, 250);
  },

  /* ---- cached DOM writes (skip identical values; avoids layout churn on phones) ---- */
  cText(el, v) { if (el._t !== v) { el._t = v; el.textContent = v; } },
  cStyle(el, prop, v) { const k = '_s_' + prop; if (el[k] !== v) { el[k] = v; el.style[prop] = v; } },

  /* ---- preferences: left-handed, button size/opacity, low-spec ---- */
  loadPrefs() {
    try {
      const raw = localStorage.getItem('nikita.prefs');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.lowSpec === 'boolean') this.prefs.lowSpec = p.lowSpec;
        if (typeof p.lefty === 'boolean') this.prefs.lefty = p.lefty;
        if (typeof p.btnScale === 'number') this.prefs.btnScale = Math.max(0.7, Math.min(1.3, p.btnScale));
        if (typeof p.btnOpacity === 'number') this.prefs.btnOpacity = Math.max(0.3, Math.min(1, p.btnOpacity));
      }
    } catch (_) {}
    this.applyPrefs();
  },

  applyPrefs() {
    const root = document.documentElement;
    root.style.setProperty('--btn-scale', String(this.prefs.btnScale));
    root.style.setProperty('--btn-opacity', String(this.prefs.btnOpacity));
    document.body.classList.toggle('lefty', this.prefs.lefty);
    document.body.classList.toggle('lowspec', this.prefs.lowSpec);
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    setChk('pause-lowspec', this.prefs.lowSpec);
    setChk('pause-lefty', this.prefs.lefty);
    const sz = document.getElementById('pause-btnsize');
    if (sz) sz.value = String(this.prefs.btnScale);
    const op = document.getElementById('pause-btnopacity');
    if (op) op.value = String(this.prefs.btnOpacity);
    this.onResize();
  },

  setPref(key, val) {
    this.prefs[key] = val;
    this.applyPrefs();
    try { localStorage.setItem('nikita.prefs', JSON.stringify(this.prefs)); } catch (_) {}
  },

  refreshMenuLabels() {
    const ps = document.getElementById('pause-sector'), pd = document.getElementById('pause-seed');   // the sector and seed being played
    if (ps) ps.textContent = `${this.level} / ${MAX_LEVELS}`;
    if (pd) pd.textContent = String(this.seedStr || '-');
    const r = document.getElementById('btn-pause-radar');
    if (r) r.textContent = `RADAR: ${this.radarOpen ? 'ON' : 'OFF'}`;
    const s = document.getElementById('btn-pause-mute');
    if (s) s.textContent = `SFX: ${this.audio.muted ? 'OFF' : 'ON'}`;
  },

  setupPlatformUI() {
    const root = document.documentElement;
    const hasFs = Boolean(root.requestFullscreen || root.webkitRequestFullscreen);
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!hasFs || standalone) {
      const b = document.getElementById('btn-pause-fullscrn');
      if (b) b.style.display = 'none';
    }
    if (isIOS && !standalone) {
      document.querySelectorAll('.ios-hint').forEach((el) => { el.style.display = 'block'; });
    }
  },

  setBaseSpeedMode(mode) {
    this.setThrottle(mode === 1 ? 0 : (mode === 3 ? 1 : CRUISE_THROTTLE));
  },
};
