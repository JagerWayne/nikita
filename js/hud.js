/* Canvas HUD and soliton radar rendering for NikitaGame. */
import {
  CELL_SIZE, DECOY_LIFE, GRID_SIZE, HOVER_SPEED_MAX, PROBE_RANGE, SENTRY_VISION, SPEED_MODES
} from './constants.js';
import { _v1, _v2 } from './math.js';

export const hudMethods = {

  /* ------------------------------------------------------------------------
     VECTOR HUD CANVAS (ARTIFICIAL HORIZON, COMPASS, 15° SEEKER, TARGET LOCKS)
     ------------------------------------------------------------------------ */
  renderHUDCanvas() {
    const ctx = this.hudCtx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (this.state !== 'PLAYING' && this.state !== 'KILLCAM' && this.state !== 'READY') return;

    const m = this.missile;
    const cx = w * 0.5;
    const cy = h * 0.5;

    const headingDeg = (((-m.yaw * 180 / Math.PI) % 360) + 360) % 360;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.72)';
    ctx.fillStyle = '#00ff88';
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'center';
    const tapeW = 240;
    ctx.beginPath();
    ctx.moveTo(cx - tapeW * 0.5, 30);
    ctx.lineTo(cx + tapeW * 0.5, 30);
    ctx.stroke();

    const dirs = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let deg = Math.floor(headingDeg - 45); deg <= headingDeg + 45; deg += 5) {
      const norm = ((deg % 360) + 360) % 360;
      if (norm % 15 !== 0) continue;
      const px = cx + (deg - headingDeg) * (tapeW / 90);
      if (px < cx - tapeW * 0.5 || px > cx + tapeW * 0.5) continue;
      const isMajor = norm % 45 === 0;
      ctx.beginPath();
      ctx.moveTo(px, 30);
      ctx.lineTo(px, isMajor ? 20 : 25);
      ctx.stroke();
      if (dirs[norm]) ctx.fillText(dirs[norm], px, 16);
    }
    ctx.fillStyle = '#ffaa00';
    ctx.fillText(`${String(Math.round(headingDeg)).padStart(3, '0')}°`, cx, 42);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(m.active ? (this.camRoll || 0) : 0);
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.36)';
    ctx.lineWidth = 1.2;
    const pitchPx = Math.asin(Math.sin(m.pitch)) * 220;   // elevation above the horizon (stays valid through loops)
    for (let deg = -30; deg <= 30; deg += 15) {
      const ly = pitchPx - (deg * Math.PI / 180) * 220;
      if (Math.abs(ly) > 130) continue;
      const barW = deg === 0 ? 95 : 46;
      ctx.beginPath();
      ctx.moveTo(-barW, ly); ctx.lineTo(-16, ly);
      ctx.moveTo(16, ly); ctx.lineTo(barW, ly);
      ctx.stroke();
    }
    ctx.restore();

    // 15-Degree Seeker Acquisition Cone Ring
    const coneRadiusPx = Math.max(46, Math.min(w, h) * 0.14);
    ctx.save();
    ctx.strokeStyle = this.homingLocked
      ? 'rgba(255, 51, 68, 0.72)'
      : (this.lockedEnemy ? 'rgba(0, 229, 255, 0.65)' : 'rgba(0, 255, 136, 0.24)');
    ctx.lineWidth = this.lockedEnemy ? 1.6 : 1.0;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, coneRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = this.lockedEnemy ? 'rgba(0, 229, 255, 0.75)' : 'rgba(0, 255, 136, 0.42)';
    ctx.font = '8.5px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.lidarParams(true).seekerDeg}° SEEKER`, cx, cy + coneRadiusPx + 11);
    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 255, 136, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.moveTo(cx - 24, cy); ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 24, cy);
    ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy - 10);
    ctx.stroke();

    // collision markers: distance from the hull to the wall (left, right), roof (up) and floor (down)
    if (m.active && m.probe && this.state === 'PLAYING') {
      const P = m.probe, gap = coneRadiusPx + 5;
      const col = (d) => d < 2.5 ? '#ff3344' : (d < 5.5 ? '#ffaa00' : '#00ff88');
      const mark = (d, ux, uy) => {
        if (d >= PROBE_RANGE - 0.05) return;
        const c = col(d), x0 = cx + ux * gap, y0 = cy + uy * gap;
        ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 - uy * 7, y0 + ux * 7); ctx.lineTo(x0 + uy * 7, y0 - ux * 7);   // bar across the ring
        ctx.moveTo(x0, y0); ctx.lineTo(x0 + ux * 7, y0 + uy * 7);
        ctx.stroke();
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.textAlign = ux < 0 ? 'right' : 'left';
        ctx.fillText(d.toFixed(1) + 'm', ux !== 0 ? x0 + ux * 11 : x0 + 10, ux !== 0 ? y0 + 4 : y0 + uy * 4 + 4);
      };
      ctx.save();
      mark(P.l, -1, 0); mark(P.r, 1, 0); mark(P.u, 0, -1); mark(P.d, 0, 1);
      ctx.restore();
    }

    if (m.wallProximity > 0.35) {
      ctx.strokeStyle = `rgba(255, 170, 0, ${m.wallProximity * 0.85})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 34, -0.5, 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 34, Math.PI - 0.5, Math.PI + 0.5);
      ctx.stroke();
    }

    const drawBrackets = (sx, sy, halfW, halfH, arm, color, lineW) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.moveTo(sx - halfW + arm, sy - halfH);
      ctx.lineTo(sx - halfW, sy - halfH);
      ctx.lineTo(sx - halfW, sy + halfH);
      ctx.lineTo(sx - halfW + arm, sy + halfH);
      ctx.moveTo(sx + halfW - arm, sy - halfH);
      ctx.lineTo(sx + halfW, sy - halfH);
      ctx.lineTo(sx + halfW, sy + halfH);
      ctx.lineTo(sx + halfW - arm, sy + halfH);
      ctx.stroke();
    };

    for (const t of this.targets) {
      if (!t.active) continue;
      if (this.lockedEnemy && this.lockedEnemy.ref === t) continue;
      const inLOS = m.active && this.los3(m.pos.x, m.pos.y, m.pos.z, t.pos.x, t.pos.y, t.pos.z);
      _v1.copy(t.pos).project(this.camera);
      const behind = _v1.z > 1;
      let sx = (_v1.x * 0.5 + 0.5) * w;
      let sy = (-_v1.y * 0.5 + 0.5) * h;
      if (behind) { sx = w - sx; sy = h - 32; }
      sx = Math.max(28, Math.min(w - 28, sx));
      sy = Math.max(56, Math.min(h - 28, sy));
      const dist = Math.round(t.pos.distanceTo(m.pos));

      ctx.save();
      if (inLOS && !behind) {
        drawBrackets(sx, sy, 18, 18, 7, '#ffaa00', 2.0);
        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`TGT-${t.id} ${dist}m`, sx, sy - 23);
      } else {
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.52)';
        ctx.lineWidth = 1.3;
        ctx.translate(sx, sy);
        ctx.beginPath();
        ctx.moveTo(0, -10); ctx.lineTo(10, 0); ctx.lineTo(0, 10); ctx.lineTo(-10, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 170, 0, 0.7)';
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`TGT-${t.id} ${dist}m`, 0, -15);
      }
      ctx.restore();
    }

    if (m.active) {
      const renderLOSBracket = (ref, label, aimY) => {
        if (!ref.active) return;
        if (this.lockedEnemy && this.lockedEnemy.ref === ref) return;
        if (!this.los3(m.pos.x, m.pos.y, m.pos.z, ref.pos.x, ref.pos.y, ref.pos.z)) return;
        _v2.set(ref.pos.x, ref.pos.y + aimY, ref.pos.z);
        const dist = Math.round(_v2.distanceTo(m.pos));
        if (dist > 95) return;
        _v1.copy(_v2).project(this.camera);
        if (_v1.z > 1) return;
        const sx = (_v1.x * 0.5 + 0.5) * w;
        const sy = (-_v1.y * 0.5 + 0.5) * h;
        if (sx < 10 || sx > w - 10 || sy < 10 || sy > h - 10) return;
        ctx.save();
        drawBrackets(sx, sy, 14, 16, 5, 'rgba(255, 95, 110, 0.78)', 1.5);
        ctx.fillStyle = 'rgba(255, 140, 150, 0.85)';
        ctx.font = '9px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${label} ${dist}m`, sx, sy + 26);
        ctx.restore();
      };

      // [ ] brackets only on what thermal currently sees
      for (let i = 0; i < this.sentries.length; i++) if (this.sentries[i].thermalVis) renderLOSBracket(this.sentries[i], 'SENTRY', 1.25);
      for (let i = 0; i < this.turrets.length; i++) if (this.turrets[i].mesh.userData._tv) renderLOSBracket(this.turrets[i], 'CIWS', 0);
      for (let i = 0; i < this.lasers.length; i++) { const l = this.lasers[i]; if (l.boxVis && l.lockRef.active) renderLOSBracket(l.lockRef, 'LASER BOX', 0); }

      // "?" = heard something / suspicious, "!" = alerted (shown through walls: you know when you are loud)
      for (let i = 0; i < this.sentries.length; i++) {
        const sn = this.sentries[i];
        if (!sn.active || (!sn.alerted && sn.invT <= 0 && sn.detectMeter <= 0.2)) continue;
        _v2.set(sn.pos.x, sn.pos.y + 2.7, sn.pos.z);
        if (_v2.distanceTo(m.pos) > 85) continue;
        _v1.copy(_v2).project(this.camera);
        if (_v1.z > 1) continue;
        const sx = (_v1.x * 0.5 + 0.5) * w;
        const sy = (-_v1.y * 0.5 + 0.5) * h;
        if (sx < 12 || sx > w - 12 || sy < 12 || sy > h - 12) continue;
        ctx.save();
        ctx.font = 'bold 22px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = sn.alerted ? '#ff3344' : '#ffaa00';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fillText(sn.alerted ? '!' : '?', sx, sy);
        ctx.restore();
      }

      // opened secret chambers: mark their power-ups
      for (let i = 0; i < this.pickups.length; i++) {
        const pk = this.pickups[i];
        if (!pk.active || pk.owner.active) continue;
        if (pk.owner.shaft ? pk.pos.distanceTo(m.pos) > 40 : !this.los3(m.pos.x, m.pos.y, m.pos.z, pk.pos.x, pk.pos.y, pk.pos.z)) continue;
        _v1.copy(pk.pos).project(this.camera);
        if (_v1.z > 1) continue;
        const sx = (_v1.x * 0.5 + 0.5) * w;
        const sy = (-_v1.y * 0.5 + 0.5) * h;
        if (sx < 10 || sx > w - 10 || sy < 10 || sy > h - 10) continue;
        ctx.save();
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${pk.type} ${Math.round(pk.pos.distanceTo(m.pos))}m`, sx, sy - 26);
        ctx.restore();
      }
    }

    // 15° Auto-Highlighted Candidate / Active Homing Lock Reticle
    if (m.active && this.lockedEnemy && this.lockedEnemy.ref && this.lockedEnemy.ref.active) {
      const eRef = this.lockedEnemy.ref;
      _v2.set(eRef.pos.x, eRef.pos.y + this.lockedEnemy.aimY, eRef.pos.z);
      const dist = Math.round(_v2.distanceTo(m.pos));
      _v1.copy(_v2).project(this.camera);
      const behind = _v1.z > 1;
      let sx = (_v1.x * 0.5 + 0.5) * w;
      let sy = (-_v1.y * 0.5 + 0.5) * h;
      if (behind) { sx = w - sx; sy = h - 32; }
      sx = Math.max(30, Math.min(w - 30, sx));
      sy = Math.max(58, Math.min(h - 30, sy));

      ctx.save();
      if (this.homingLocked) {
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.setLineDash([]);

        const pulse = 18 + Math.sin(performance.now() * 0.025) * 3;
        drawBrackets(sx, sy, pulse, pulse, 8, '#ff3344', 2.5);
        drawBrackets(sx, sy, pulse + 5, pulse + 5, 5, '#00e5ff', 1.3);

        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`[ LOCKED // ${this.lockedEnemy.type} ${dist}m ]`, sx, sy + pulse + 16);
      } else if (!behind) {
        const pulse = 16 + Math.sin(performance.now() * 0.014) * 2;
        drawBrackets(sx, sy, pulse, pulse + 2, 7, '#00ff88', 2.2);
        ctx.fillStyle = '#00ff88';
        ctx.font = 'bold 9.5px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`[15° ACQ] TAP LOCK: ${this.lockedEnemy.type} ${dist}m`, sx, sy + 28);
      }
      ctx.restore();
    }

    const E = this.el;
    this.cText(E.speedReadout, `${m.vel.length().toFixed(1)} u/s`);
    this.updateLandIndicator(m);
    this.fuelBurnAvg = (this.fuelBurnAvg || 2.4) + ((m.fuelBurn || 0) - (this.fuelBurnAvg || 2.4)) * 0.05;
    const fuelSecs = this.fuelBurnAvg > 0.05 ? Math.min(999, Math.round(m.fuel / this.fuelBurnAvg)) : 999;
    this.cText(E.valFuel, `${Math.round(m.fuel)}% ${fuelSecs < 999 ? fuelSecs + 's' : ''}`);
    this.cStyle(E.valFuel, 'color', fuelSecs < 8 ? '#ff3344' : (m.fuel < 20 ? '#ffaa00' : ''));
    this.cStyle(E.fillFuel, 'width', `${Math.round(m.fuel)}%`);
    const coasting = m.eff === undefined || m.eff < 0;
    if (this.effAvg === undefined) this.effAvg = 1;
    if (!coasting) this.effAvg += (m.eff - this.effAvg) * 0.08;
    const effPct = Math.round(Math.max(0, Math.min(1, this.effAvg)) * 100);
    this.cText(E.valEff, m.eff === -2 ? 'IDLE' : coasting ? 'COAST' : `${effPct >= 90 ? 'ECO' : (effPct >= 70 ? 'OK' : 'WASTE')} ${effPct}%`);
    this.cStyle(E.fillEff, 'width', `${coasting ? 0 : effPct}%`);
    this.cStyle(E.fillEff, 'background', effPct >= 90 ? '#00ff88' : (effPct >= 70 ? '#ffaa00' : '#ff3344'));
    if (m.boostDepleted) {
      this.cText(E.valBoost, `${Math.round(m.boost)}% RCHG`);
      this.cStyle(E.valBoost, 'color', '#ff3344');
      this.cStyle(E.fillBoost, 'background', '#ff3344');
    } else {
      this.cText(E.valBoost, `${Math.round(m.boost)}%`);
      this.cStyle(E.valBoost, 'color', '');
      this.cStyle(E.fillBoost, 'background', '#00e5ff');
    }
    this.cStyle(E.fillBoost, 'width', `${Math.round(m.boost)}%`);
    this.cText(E.valHull, `${Math.round(m.hull)}%`);
    this.cStyle(E.fillHull, 'width', `${Math.round(m.hull)}%`);
    this.cText(E.valSignal, `${Math.round(m.signal)}%`);
    this.cStyle(E.fillSignal, 'width', `${Math.round(m.signal)}%`);
  },

  /* ------------------------------------------------------------------------
     SIDE-MOUNTED SOLITON TOP-DOWN TACTICAL RADAR
     ------------------------------------------------------------------------ */
  renderSolitonRadar() {
    if (!this.radarOpen) return;
    if (this.state !== 'PLAYING' && this.state !== 'KILLCAM' && this.state !== 'RESPAWNING') return;
    this._radarTick = (this._radarTick + 1) | 0;
    if ((this._radarTick & 1) === 1) return; // ~30 fps is plenty for the minimap
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const scale = size / GRID_SIZE;

    this.drawXmapBase();                                               // the explore map is the map (floors stacked, route, autopilot legs)
    const curF = this._radarFloor = Math.max(0, Math.min(this.nFloors - 1, this.floorOfY(this.missile.pos.y)));
    const fa = (y) => { ctx.globalAlpha = this.floorOfY(y) === curF ? 1 : 0.3; };

    const toRX = (wx) => (wx / CELL_SIZE + GRID_SIZE * 0.5) * scale;
    const toRZ = (wz) => (wz / CELL_SIZE + GRID_SIZE * 0.5) * scale;

    for (const ez of this.ecmZones) {
      if (!ez.mesh.userData._tv) continue;
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(toRX(ez.pos.x), toRZ(ez.pos.z), (ez.radius / CELL_SIZE) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const l of this.lasers) {
      if (l.disabled || !l.thermalVis) continue;
      const lx1 = toRX(l.xMin), lx2 = toRX(l.xMax), lz = toRZ(l.z);
      ctx.save();
      if (l.state === 'ACTIVE') {
        ctx.strokeStyle = '#ff2244';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([]);
      } else if (l.state === 'ARMING') {
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
      } else {
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(lx1, lz);
      ctx.lineTo(lx2, lz);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255, 170, 0, 0.8)';
    for (const bh of this.bulkheads) {
      if (!bh.mesh.userData._tv) continue;
      ctx.fillRect(toRX(bh.x) - 2, toRZ(bh.z) - 4, 4, 8);
    }
    ctx.fillStyle = '#ff2244';
    for (const tu of this.turrets) {
      if (!tu.active || !tu.mesh.userData._tv) continue;
      fa(tu.pos.y - 2);
      const tx = toRX(tu.pos.x), tz = toRZ(tu.pos.z);
      ctx.beginPath();
      ctx.moveTo(tx, tz - 3.5); ctx.lineTo(tx + 3.5, tz + 3); ctx.lineTo(tx - 3.5, tz + 3);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#ff4433';
    for (const b of this.barrels) {
      if (!b.active || !b.thermalVis) continue;
      fa(b.pos.y);
      ctx.fillRect(toRX(b.pos.x) - 2, toRZ(b.pos.z) - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    for (const t of this.targets) {
      if (!t.active) continue;
      fa(t.pos.y);
      const rx = toRX(t.pos.x), rz = toRZ(t.pos.z);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(rx, rz - 5); ctx.lineTo(rx + 5, rz); ctx.lineTo(rx, rz + 5); ctx.lineTo(rx - 5, rz);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (const s of this.sentries) {
      if (!s.thermalVis && s.active) continue;
      fa(s.pos.y + 1);
      const rx = toRX(s.pos.x), rz = toRZ(s.pos.z);
      if (!s.active) {
        ctx.strokeStyle = 'rgba(140, 180, 160, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(rx - 3, rz - 3); ctx.lineTo(rx + 3, rz + 3);
        ctx.moveTo(rx + 3, rz - 3); ctx.lineTo(rx - 3, rz + 3);
        ctx.stroke();
        continue;
      }

      const coneRange = (SENTRY_VISION / CELL_SIZE) * scale;
      const ang = Math.atan2(-Math.cos(s.yaw), -Math.sin(s.yaw));
      ctx.fillStyle = s.alerted ? 'rgba(255, 40, 60, 0.38)' : (s.invT > 0 ? 'rgba(255, 170, 0, 0.3)' : 'rgba(0, 255, 136, 0.22)');
      ctx.beginPath();
      ctx.moveTo(rx, rz);
      ctx.arc(rx, rz, coneRange, ang - 0.54, ang + 0.54);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = s.alerted ? '#ff3344' : (s.invT > 0 ? '#ffaa00' : '#66ffaa');
      ctx.beginPath();
      ctx.arc(rx, rz, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    if (this.nFloors > 1) {
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#aaffdd';
      ctx.fillText(`FLOOR ${curF + 1}/${this.nFloors}`, 5, 13);
    }
    for (const d of this.decoyObjs) {
      ctx.strokeStyle = 'rgba(51, 221, 255, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(toRX(d.pos.x), toRZ(d.pos.z), 3 + ((DECOY_LIFE - d.t) % 1.2) * 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.missile.active) {
      // noise ring: how far sentries can hear the rocket right now
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 170, 0, ${0.3 + pulse * 0.3})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(toRX(this.missile.pos.x), toRZ(this.missile.pos.z), (this.noiseRadius / CELL_SIZE) * scale, 0, Math.PI * 2);
      ctx.stroke();
      // scan ranges: lidar (green) and thermal (red-orange)
      const LP = this.lidarParams();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.28)';
      ctx.beginPath(); ctx.arc(toRX(this.missile.pos.x), toRZ(this.missile.pos.z), (LP.range / CELL_SIZE) * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 80, 30, 0.6)';
      ctx.beginPath(); ctx.arc(toRX(this.missile.pos.x), toRZ(this.missile.pos.z), (LP.thermal / CELL_SIZE) * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    if (this.missile.active) {
      const mx = toRX(this.missile.pos.x);
      const mz = toRZ(this.missile.pos.z);
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(mx, mz, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx, mz);
      ctx.lineTo(mx - Math.sin(this.missile.yaw) * 10, mz - Math.cos(this.missile.yaw) * 10);
      ctx.stroke();
    }
  },

  updateSpeedBadgeUI() {
    const mode = this.missile.activeSpeedMode;
    const badge = document.getElementById('speed-tier-badge');
    const p = SPEED_MODES[mode];
    badge.textContent = p.name;
    badge.className = p.badgeClass;
    const pct = Math.round(this.missile.throttle * 100);
    const fill = document.getElementById('thr-fill');
    const thumb = document.getElementById('thr-thumb');
    const readout = document.getElementById('thr-readout');
    if (fill) fill.style.height = `${pct}%`;
    if (thumb) thumb.style.bottom = `calc(${pct}% - 8px)`;
    if (readout) readout.textContent = this.missile.hover ? `${(this.missile.throttle * HOVER_SPEED_MAX).toFixed(1)} m/s` : `${this.throttleSpeed(this.missile.throttle).toFixed(0)} m/s`;
  },

  // Landing indicator: shown when the rocket is slow enough to land and close to a flat floor.
  updateLandIndicator(m) {
    const el = this._landEl || (this._landEl = document.getElementById('hud-land'));
    if (!el) return;
    const txt = '', cls = '';
    this.cText(el, txt);
    if (el._cls !== cls) { el._cls = cls; el.className = cls; }
    this.cStyle(el, 'display', txt ? 'block' : 'none');
    const ab = this._autoBtn || (this._autoBtn = document.getElementById('tbtn-auto'));
    if (ab) { const on = Boolean(this.autoPlay && (this.state === 'PLAYING' || this.state === 'READY' || this.state === 'KILLCAM' || this.state === 'RESPAWNING')); if (ab._on !== on) { ab._on = on; ab.classList.toggle('on', on); } this.cText(ab, on ? 'AUTO\n' + (m.auto && this.pilot && this.pilot.active ? this.pilot.mission : 'ON') : 'AUTO'); }
    const hb = this._hoverBtn || (this._hoverBtn = document.getElementById('tbtn-hover'));
    if (hb) { const on = Boolean(m.active && m.hover && this.state === 'PLAYING'); if (hb._on !== on) { hb._on = on; hb.classList.toggle('on', on); } this.cText(hb, on ? 'HOVER\nON' : 'HOVER'); }
  },
};
