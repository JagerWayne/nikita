/* Score, rewards, pickups, upgrades and save data for NikitaGame. */
import {
  AUTO_MEM_KEY, CACHE_ROCKETS, GUN_CAP_MAX, GUN_CAP_MIN, GUN_PICKUP, GUN_STEPS, MAX_LEVELS, MAX_ROCKETS,
  MODIFIER_CAP_BONUS, MULT_SLOW, PACKAGE_ROCKETS, POINTS, POINTS_BONUS, POINTS_PER_PACKAGE, REWARDS,
  REWARD_CAP_BASE, REWARD_CAP_PER_TIER, SAVE_KEY, SPEED_MAX, SPEED_MIN, SPEED_START_CAP, SPEED_STEP,
  UPG_MAX_LEVEL, XMAP_KEY
} from './constants.js';

export const progressMethods = {

  collectPickup(pk) {
    pk.active = false;
    pk.mesh.visible = false;
    const m = this.missile;
    this.audio.playTargetChime();
    this.awardPoints(POINTS_BONUS.pickup, 'POWER-UP', false);
    this.vfx.spawnRing(pk.pos, 3.2, 0.3, 0xffffff, 0, 0);
    this.popAmmoHUD();
    switch (pk.type) {
      case 'AMMO': {
        const cap = this.gunCap(), add = Math.max(0, Math.min(GUN_PICKUP, cap - this.gunAmmo));
        this.gunAmmo += add;
        this.pushFeed(add > 0 ? `AMMO CRATE: +${add} ROUNDS` : `AMMO CRATE — MAGAZINE FULL (${cap})`, 'amber');
        break;
      }
      case 'ROCKETS': {
        const add = Math.max(0, Math.min(CACHE_ROCKETS, MAX_ROCKETS - this.ammo));
        this.ammo += add;
        this.rewards.total += add;
        this.rewards.log.cache = (this.rewards.log.cache || 0) + add;
        this.pushFeed(add > 0 ? `SUPPLY CACHE: +${add} ROCKETS` : `SUPPLY CACHE — RACK FULL (${MAX_ROCKETS})`, 'amber');
        break;
      }
      case 'BOOST':
        m.boost = 100; m.boostDepleted = false; this.power.freeBoost = 8;
        this.pushFeed('POWER-UP: BOOST CELL — UNLIMITED BOOST 8s', 'cyan');
        break;
      case 'REPAIR':
        m.hull = 100; m.fuel = 100;
        this.pushFeed('POWER-UP: REPAIR KIT — HULL + FUEL RESTORED', 'cyan');
        break;
      case 'STEALTH':
        this.power.stealth = 12;
        this.pushFeed('POWER-UP: SILENT RUNNING 12s — QUIET ENGINE', 'cyan');
        break;
      case 'OVERCHARGE':
        this.power.overcharge = true;
        this.pushFeed('POWER-UP: OVERCHARGED WARHEAD — NEXT BLAST x1.6', 'red');
        break;
    }
    this.flushPoints();
    this.updateHUDText();
  },

  updatePickups(dt) {
    const t = this.gameClock;
    this.crackMat.emissiveIntensity = 0.62 + Math.sin(t * 3.2) * 0.22;
    const m = this.missile;
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      pk.mesh.position.y = pk.baseY + Math.sin(t * 2.2 + pk.phase) * 0.18;
      pk.core.rotation.y += dt * 2.4;
      pk.core.rotation.x += dt * 1.1;
      pk.ring.rotation.z += dt * 1.6;
      if (m.active && this.state === 'PLAYING' && pk.pos.distanceToSquared(m.pos) < pk.radius * pk.radius) this.collectPickup(pk);
    }
    // active power-up strip
    const pw = this.power;
    const parts = [];
    if (this.modifier) parts.push(`MOD: ${this.modifier}`);
    if (pw.freeBoost > 0) parts.push(`BOOST CELL ${Math.ceil(pw.freeBoost)}s`);
    if (pw.stealth > 0) parts.push(`SILENT ${Math.ceil(pw.stealth)}s`);
    if (pw.overcharge) parts.push('OVERCHARGE READY');
    this.cText(this.el.hudPower, parts.join('  ·  '));
  },

  /* ------------------------------------------------------------------------
     ROCKET REWARD SYSTEM
     ------------------------------------------------------------------------ */
  resetRewards() {
    this.rewards = { total: 0, capUsed: 0, cap: REWARD_CAP_BASE + REWARD_CAP_PER_TIER * (this.difficultyTier || 1) + (this.modifier ? MODIFIER_CAP_BONUS : 0), log: {}, flags: {}, pending: {} };
    this._blastHostiles = 0;
  },

  // Queue a reward; flushRewards() banks it and prints one aggregated feed line.
  awardRockets(n, label, key) {
    if (n <= 0 || this.state === 'BRIEFING' || this.state === 'FAILED') return;
    const r = this.rewards;
    const e = r.pending[label] || (r.pending[label] = { n: 0, count: 0, key });
    e.n += n;
    e.count++;
  },

  flushRewards() {
    this.flushPoints();
    const r = this.rewards;
    const labels = Object.keys(r.pending);
    if (labels.length === 0) return;
    // Pay out in order, limited by the per-sector cap and by the 100-rocket rack.
    let capLeft = Math.max(0, r.cap - r.capUsed);
    let rackLeft = Math.max(0, MAX_ROCKETS - this.ammo);
    let added = 0, denied = 0;
    const parts = [];
    for (const lb of labels) {
      const e = r.pending[lb];
      const give = Math.min(e.n, capLeft, rackLeft);
      denied += e.n - give;
      if (give > 0) {
        capLeft -= give; rackLeft -= give; added += give;
        r.log[e.key] = (r.log[e.key] || 0) + give;
        parts.push(e.count > 1 ? `${e.count}× ${lb}` : lb);
      }
    }
    r.pending = {};
    this.ammo += added;
    r.total += added;
    r.capUsed += added;
    if (added > 0) {
      this.pushFeed(`+${added} ROCKETS — ${parts.join(' · ')}`, 'cyan');
      this.audio.playTargetChime();
      this.popAmmoHUD();
    } else if (denied > 0) {
      this.pushFeed(capLeft <= 0 ? 'SECTOR REWARD CAP REACHED' : `ROCKET RACK FULL (${MAX_ROCKETS})`, 'amber');
    }
    this.updateHUDText();
  },

  /* ------------------------------------------------------------------------
     ROCKET UPGRADES (bought with credits; saved on the device)
     ------------------------------------------------------------------------ */
  loadProgress() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (d && typeof d === 'object') {
        this.credits = Math.max(0, Math.floor(d.credits || 0));
        this.contLvl = Math.max(0, Math.min(MAX_LEVELS, Math.floor(d.lvl || 0)));
        this.contSeed = typeof d.seed === 'string' ? d.seed.slice(0, 40) : '';
        if (d.best && typeof d.best === 'object') this.sectorBest = d.best;
        for (const k of Object.keys(this.upg)) this.upg[k] = Math.max(0, Math.min(this.upgradeMax(k), Math.floor((d.upg && d.upg[k]) || 0)));
      }
    } catch (_) {}
  },

  saveProgress() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ credits: this.credits, upg: this.upg, best: this.sectorBest, lvl: this.contLvl || 0, seed: this.contSeed || '' })); } catch (_) {}
  },

  maxSpeed() { return Math.min(SPEED_MAX, SPEED_START_CAP + SPEED_STEP * this.upg.speed); },
  fullSpeedMult() { return this.maxSpeed() / 10; },                       // 20 -> x2 ... 30 -> x3 points at full speed
  fuelBurnMult() { return 1 / (1 + 0.15 * this.upg.fuel); },
  gunCap() { return GUN_CAP_MIN + Math.round(((GUN_CAP_MAX - GUN_CAP_MIN) / GUN_STEPS) * (this.upg.gun || 0)); },
  boostDrainMult() { return 1 / (1 + 0.2 * this.upg.boost); },
  boostRechargeMult() { return 1 + 0.15 * this.upg.boost; },
  hullDmgMult() { return 1 / (1 + 0.12 * this.upg.hull); },
  blastRadiusBase() { return 8.2 * (1 + 0.06 * this.upg.force); },
  blastPowerBase() { return 1.25 * (1 + 0.04 * this.upg.force); },

  // Costs grow ~28% per level (15% per max-speed step): early levels are quick, the last ones are a goal.
  upgradeCost(key) {
    const l = this.upg[key];
    const r10 = (v) => Math.round(v / 10) * 10;
    if (key === 'speed') return r10(150 * Math.pow(1.15, l));
    if (key === 'gun') return r10(120 * Math.pow(1.15, l));
    if (key === 'ldeep' || key === 'tpen') return [600, 1200, 2400][l] || 2400;
    if (key[0] === 'l' || key[0] === 't') return r10(160 * Math.pow(1.28, l));
    return r10(200 * Math.pow(1.28, l));
  },

  upgradeMax(key) { return (key === 'speed' || key === 'gun') ? 20 : ((key === 'ldeep' || key === 'tpen') ? 3 : UPG_MAX_LEVEL); },

  buyUpgrade(key) {
    const max = this.upgradeMax(key);
    if (this.upg[key] >= max) return;
    const cost = this.upgradeCost(key);
    if (this.credits < cost) return;
    this.credits -= cost;
    this.upg[key]++;
    this.saveProgress();
    this.audio.unlock();
    this.audio.playTargetChime();
    this.vibrate(14);
    this.renderUpgrades();
  },

  // Erase the saved campaign (credits, upgrades, best scores, resume point, scan maps) but keep the settings; no reload.
  wipeSave() {
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(AUTO_MEM_KEY); localStorage.removeItem(XMAP_KEY); } catch (_) {}
    this.xgrid = null; this.xgridKey = null;
    this._autoMem = null;
    this.credits = 0; this.sectorBest = {}; this.contLvl = 0; this.contSeed = '';
    for (const k of Object.keys(this.upg)) this.upg[k] = 0;
    this.lidarKey = null;
    try { this.lidarMemory.clear(); } catch (_) {}
    return new Promise((res) => {
      try {
        const go = () => { const rq = indexedDB.deleteDatabase('nikita-lidar'); rq.onsuccess = res; rq.onerror = res; rq.onblocked = res; };
        if (this._idb) { const p = this._idb; this._idb = null; p.then((db) => { db.close(); go(); }).catch(go); } else go();   // forget the closed handle so the next save reopens (and recreates) the database
      } catch (_) { res(); }
      setTimeout(res, 1500);
    });
  },

  hitMultNow() {
    const cap = this.maxSpeed();
    const f = Math.max(0, Math.min(1, (this.missile.vel.length() - SPEED_MIN) / (cap - SPEED_MIN)));
    return MULT_SLOW + (this.fullSpeedMult() - MULT_SLOW) * f;
  },

  // Queue points; kills use the speed multiplier of the hit that caused them, bonuses are fixed.
  awardPoints(base, label, useMult) {
    if (base <= 0 || this.state === 'BRIEFING' || this.state === 'FAILED') return;
    const mult = useMult ? this.blastMult : 1;
    const pts = Math.round(base * mult);
    const lb = useMult ? `${label} ×${mult.toFixed(2)}` : label;
    const e = this.ptsPending.find((x) => x.label === lb);
    if (e) { e.pts += pts; e.count++; } else this.ptsPending.push({ label: lb, pts, count: 1 });
  },

  flushPoints() {
    if (this.ptsPending.length === 0) return;
    let total = 0;
    const parts = [];
    for (const e of this.ptsPending) { total += e.pts; parts.push(e.count > 1 ? `${e.count}× ${e.label}` : e.label); }
    this.ptsPending = [];
    this.score += total;
    // credits: every point earned is a credit, but a replayed sector only pays for beating its previous best
    const ck = this.lidarKey || 'none';
    const gainedNow = this.score - this.sectorStartScore;
    const best = this.sectorBest[ck] || 0;
    if (gainedNow > best) { this.credits += gainedNow - best; this.sectorBest[ck] = gainedNow; }
    const keys = Object.keys(this.sectorBest);
    if (keys.length > 300) delete this.sectorBest[keys[0]];
    this.saveProgress();
    this.pushFeed(`+${total} PTS — ${parts.join(' · ')}`, 'amber');
    while (this.score >= this.nextPackage) {
      this.nextPackage += POINTS_PER_PACKAGE;
      const add = Math.max(0, Math.min(PACKAGE_ROCKETS, MAX_ROCKETS - this.ammo));
      this.ammo += add;
      this.rewards.total += add;
      this.rewards.log.points = (this.rewards.log.points || 0) + add;
      this.pushFeed(add > 0 ? `POINT PACKAGE: +${add} ROCKETS` : `POINT PACKAGE — RACK FULL (${MAX_ROCKETS})`, 'cyan');
      this.audio.playTargetChime();
      this.popAmmoHUD();
    }
    this.updateHUDText();
  },

  rewardKill(key, list, isDone, isLiveHostile = false) {
    const def = REWARDS[key];
    this.awardRockets(def.each, def.label, key);
    this.awardPoints(POINTS[key].each, def.label, true);
    if (isLiveHostile) this._blastHostiles++;
    if (list.length > 0 && !this.rewards.flags[key] && list.every(isDone)) {
      this.rewards.flags[key] = true;
      this.awardRockets(def.all, def.allLabel, key);
      this.awardPoints(POINTS[key].all, def.allLabel, false);
    }
  },

  // Shut the game down completely: stop the loop, silence audio, release sensors/fullscreen/pointer, then close the
  // window. Browsers only let a page close itself in some cases (installed app, script-opened tab); where
  // it does not work, a "game closed" screen replaces the game.
  // Wipe credits, upgrades, every saved lidar map and preferences on this device, then restart fresh.
  deleteSavedData() {
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('nikita.prefs'); localStorage.removeItem(AUTO_MEM_KEY); localStorage.removeItem(XMAP_KEY); } catch (_) {}
    this.lidarKey = null;
    this.lidarMemory.clear();
    const done = () => location.reload();
    try {
      const go = () => { const rq = indexedDB.deleteDatabase('nikita-lidar'); rq.onsuccess = done; rq.onerror = done; rq.onblocked = done; };
      if (this._idb) { const p = this._idb; this._idb = null; p.then((db) => { db.close(); go(); }).catch(go); } else go();   // forget the closed handle so the next save reopens (and recreates) the database
    } catch (_) { done(); }
    setTimeout(done, 1500);
  },
};
