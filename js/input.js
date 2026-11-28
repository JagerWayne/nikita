/* Input, device and window plumbing for NikitaGame: keyboard, mouse, touch, gyro, fullscreen, orientation and input reset. Methods are mixed into NikitaGame.prototype by game.js. */
/* global nkConfirm, NIKITA_VERSION -- declared by the classic script js/pwa.js (global scope) */
import { CRUISE_THROTTLE, MAX_LEVELS } from './constants.js';

export const inputMethods = {

  requestGameFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) {
        try {
          const p = req.call(el);
          if (p && p.catch) p.catch(() => {});
        } catch (_) {}
      }
    }
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  },

  toggleGameFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (ex) {
        try { ex.call(document); } catch (_) {}
      }
    } else {
      this.requestGameFullscreen();
    }
  },

  recenterGyro() {
    this.gyro.calibrated = false;
    this.gyro.yaw = 0;
    this.gyro.pitch = 0;
    if (this.state === 'PLAYING') {
      this.pushFeed('GYROSCOPE NEUTRAL RE-CALIBRATED', 'cyan');
    }
  },

  setGyroEnabled(enable) {
    const want = Boolean(enable);
    const syncGyroUI = (active) => {
      this.gyro.enabled = active;
      this.gyro.calibrated = false;
      this.gyro.yaw = 0;
      this.gyro.pitch = 0;
      const hudBtn = document.getElementById('btn-hud-gyro');
      const recBtn = document.getElementById('btn-hud-recenter');
      const briefChk = document.getElementById('brief-gyro-enable');
      const pauseChk = document.getElementById('pause-gyro-toggle');
      if (hudBtn) {
        hudBtn.textContent = active ? 'GYRO: ON' : 'GYRO: OFF';
        hudBtn.classList.toggle('active', active);
      }
      if (recBtn) recBtn.style.display = active ? 'inline-flex' : 'none';
      if (briefChk) briefChk.checked = active;
      if (pauseChk) pauseChk.checked = active;
    };

    if (!want) {
      syncGyroUI(false);
      return;
    }
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      syncGyroUI(false);
      this.pushFeed('GYRO NOT SUPPORTED ON THIS DEVICE', 'red');
      return;
    }
    if (!window.isSecureContext) {
      this.pushFeed('GYRO NEEDS HTTPS — USE THE LIVE PAGE', 'red');
    }

    const activateListeners = () => {
      if (!this.gyro.motionBound) {
        this.gyro.motionBound = true;
        window.addEventListener('deviceorientation', (e) => this.onDeviceOrientation(e));
        window.addEventListener('devicemotion', (e) => this.onDeviceMotion(e));
      }
      syncGyroUI(true);
      this.gyro.gotEvent = false;
      clearTimeout(this._gyroTimer);
      this._gyroTimer = setTimeout(() => {
        if (this.gyro.enabled && !this.gyro.gotEvent) this.pushFeed('NO GYRO DATA — CHECK SENSOR PERMISSION / HTTPS', 'red');
      }, 1800);
      if (this.state === 'PLAYING') {
        this.pushFeed('GYROSCOPE TILT FLIGHT ACTIVE', 'cyan');
      }
    };

    if (typeof window.DeviceOrientationEvent !== 'undefined' && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      window.DeviceOrientationEvent.requestPermission()
        .then((res) => {
          if (res === 'granted') {
            activateListeners();
          } else {
            syncGyroUI(false);
            this.pushFeed('GYRO PERMISSION DENIED', 'red');
          }
        })
        .catch(() => {
          syncGyroUI(false);
        });
    } else {
      activateListeners();
    }
  },

  onDeviceOrientation(e) {
    if (!this.gyro.enabled) return;
    if (e.beta === null || e.gamma === null) return;
    this.gyro.gotEvent = true;
    const angle = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : 90);

    let rollDeg = 0;
    let pitchDeg = 0;
    if (angle === 90) {
      rollDeg = e.beta;
      pitchDeg = -e.gamma;
    } else if (angle === -90 || angle === 270) {
      rollDeg = -e.beta;
      pitchDeg = e.gamma;
    } else {
      rollDeg = e.gamma;
      pitchDeg = e.beta;
    }

    if (!this.gyro.calibrated) {
      this.gyro.baseRoll = rollDeg;
      this.gyro.basePitch = pitchDeg;
      this.gyro.calibrated = true;
      return;
    }

    const dRoll = rollDeg - this.gyro.baseRoll;
    const dPitch = pitchDeg - this.gyro.basePitch;
    const deadzone = 2.5;
    const maxTilt = 26.0 / Math.max(0.4, this.cfg.gyroSens);

    const applyCurve = (deg) => {
      if (Math.abs(deg) <= deadzone) return 0;
      const sign = Math.sign(deg);
      const norm = Math.min(1, (Math.abs(deg) - deadzone) / maxTilt);
      return sign * Math.pow(norm, 1.2);
    };

    const targetYaw = -applyCurve(dRoll);
    const targetPitch = -applyCurve(dPitch);
    this.gyro.yaw += (targetYaw - this.gyro.yaw) * 0.35;
    this.gyro.pitch += (targetPitch - this.gyro.pitch) * 0.35;
    this.gyro.hasOrientation = true;
  },

  onDeviceMotion(e) {
    if (!this.gyro.enabled || this.gyro.hasOrientation) return;
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    this.gyro.gotEvent = true;
    const angle = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : 90);

    const rollDeg = Math.atan2(angle === -90 || angle === 270 ? -g.y : g.y, Math.abs(g.z) + 1.5) * 57.2958;
    const pitchDeg = Math.atan2(g.z, Math.hypot(g.x, g.y)) * 57.2958;

    if (!this.gyro.calibrated) {
      this.gyro.baseRoll = rollDeg;
      this.gyro.basePitch = pitchDeg;
      this.gyro.calibrated = true;
      return;
    }

    const maxTilt = 22.0 / Math.max(0.4, this.cfg.gyroSens);
    const clampNorm = (v) => Math.max(-1, Math.min(1, v / maxTilt));
    this.gyro.yaw += (-clampNorm(rollDeg - this.gyro.baseRoll) - this.gyro.yaw) * 0.3;
    this.gyro.pitch += (clampNorm(pitchDeg - this.gyro.basePitch) - this.gyro.pitch) * 0.3;
  },

  resetAllInputs() {
    this.keys = {};
    this.mouseYawDelta = 0;
    this.mousePitchDelta = 0;
    this.touchInput.joyId = null;
    this.touchInput.joyX = 0;
    this.touchInput.joyY = 0;
    this.touchInput.lookId = null;
    this.touchInput.boost = false;
    this.touchInput.crawl = false;
    const gimbal = document.getElementById('joy-gimbal');
    const knob = document.getElementById('joy-knob');
    if (gimbal) {
      gimbal.classList.remove('engaged');
      gimbal.style.left = '';
      gimbal.style.top = '';
      gimbal.style.bottom = '';
    }
    if (knob) knob.style.transform = 'translate3d(0px, 0px, 0px)';
    ['tbtn-lock', 'tbtn-decoy', 'tbtn-detonate', 'tbtn-gun', 'tbtn-hover', 'tbtn-auto'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('pressed');
    });
    this.gunHeld = false;
  },

  updateTouchControlsVisibility() {
    const tc = document.getElementById('touch-controls');
    if (!tc) return;
    const show = (this.state === 'PLAYING' || this.state === 'RESPAWNING' || this.state === 'READY') &&
                 !this.paused && !this.portraitBlocked && !this.prefs.hideButtons;   // the touch HUD shows on every device; the player can hide the buttons
    tc.style.display = show ? 'block' : 'none';
  },

  checkOrientation() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobileViewport = this.isTouchDevice || Math.min(w, h) < 600;
    const isPortrait = h > w * 1.05;
    this.portraitBlocked = isMobileViewport && isPortrait;
    const rotOverlay = document.getElementById('rotate-overlay');
    if (rotOverlay) rotOverlay.style.display = this.portraitBlocked ? 'flex' : 'none';
    if (this.portraitBlocked) this.resetAllInputs();
    this.updateTouchControlsVisibility();
  },

  /* ------------------------------------------------------------------------
     INPUT & UI WIRING
     ------------------------------------------------------------------------ */
  // Full-screen map input: one pointer pans (a short still press is a tap = waypoint), two pointers pinch-zoom, the wheel zooms.
  bindFullMapEvents() {
    const cv = document.getElementById('map-canvas'), F = this.fmap;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pinchState = () => { const a = [...F.ptrs.values()]; return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, mx: (a[0].x + a[1].x) * 0.5, my: (a[0].y + a[1].y) * 0.5 }; };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      const p = pos(e);
      F.ptrs.set(e.pointerId, { x: p.x, y: p.y });
      if (F.ptrs.size === 1) F.tap = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), moved: false };
      else { F.tap = null; if (F.ptrs.size === 2) { const s = pinchState(); F.pinch = s.d; F.pz = F.zoom; F.pmx = s.mx; F.pmy = s.my; } }
    });
    cv.addEventListener('pointermove', (e) => {
      const q = F.ptrs.get(e.pointerId);
      if (!q) return;
      const p = pos(e);
      if (F.ptrs.size === 1) {
        if (F.tap && Math.hypot(p.x - F.tap.x, p.y - F.tap.y) > 6) F.tap.moved = true;
        if (!F.tap || F.tap.moved) this.fullMapPan(p.x - q.x, p.y - q.y);
        q.x = p.x; q.y = p.y;
      } else if (F.ptrs.size === 2) {
        q.x = p.x; q.y = p.y;
        const s = pinchState();
        this.fullMapPan(s.mx - F.pmx, s.my - F.pmy);
        this.fullMapZoomAt(s.mx, s.my, F.pz * s.d / F.pinch);
        F.pmx = s.mx; F.pmy = s.my;
      }
    });
    const up = (e) => {
      if (!F.ptrs.has(e.pointerId)) return;
      const q = F.ptrs.get(e.pointerId);
      const tap = F.tap && F.tap.id === e.pointerId && !F.tap.moved && e.type === 'pointerup' && performance.now() - F.tap.t < 700;
      F.ptrs.delete(e.pointerId);
      if (tap) this.fullMapTap(q.x, q.y);
      F.tap = null;
      if (F.ptrs.size === 1) { const r = [...F.ptrs.values()][0]; F.tap = { id: -1, x: r.x, y: r.y, t: 0, moved: true }; }   // the finger left over only pans
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      const p = pos(e);
      this.fullMapZoomAt(p.x, p.y, F.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    document.getElementById('map-close').addEventListener('click', () => this.closeFullMap());
    document.getElementById('map-wp-clear').addEventListener('click', () => this.clearWaypoint());
  },

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.onResize());
    }
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 80));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        try { this.lidarSnapshot(); } catch (_) {}                           // app sent to the background / closed: keep the explored map
        this.resetAllInputs();
        if (this.state === 'PLAYING' || this.state === 'KILLCAM' || this.state === 'READY' || this.state === 'RESPAWNING') this.setPaused(true);
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener('blur', () => {
      this.resetAllInputs();
      if (this.state === 'PLAYING' || this.state === 'KILLCAM' || this.state === 'READY' || this.state === 'RESPAWNING') this.setPaused(true);
    });

    // unlock() is idempotent and stays cheap, so these listeners are never removed: after an interruption
    // (phone call, OS audio takeover) the next tap brings the sound back.
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('touchend', unlockAudio, { passive: true });

    // Remember the last pointer type (mouse vs touch) and drop focus from toggles/buttons after use,
    // so keyboard flight controls keep working after touching a menu control.
    window.addEventListener('pointerdown', (e) => { this.lastPointerType = e.pointerType; }, { capture: true, passive: true });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.tagName === 'INPUT' && (t.type === 'checkbox' || t.type === 'range')) t.blur();
    });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.tagName === 'BUTTON') t.blur();
    });

    // Top HUD Action Buttons
    document.getElementById('btn-hud-gyro').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(14);
      this.setGyroEnabled(!this.gyro.enabled);
    });

    document.getElementById('btn-hud-recenter').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(12);
      this.recenterGyro();
    });

    document.getElementById('btn-hud-fullscrn').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(12);
      this.toggleGameFullscreen();
    });

    document.getElementById('btn-hud-cam').addEventListener('click', (e) => { this.toggleCamView(); e.currentTarget.blur(); });
    document.getElementById('btn-hud-radar').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(12);
      if (this.state === 'PLAYING' || this.state === 'KILLCAM') {
        this.radarOpen = !this.radarOpen;
        document.getElementById('radar-container').style.display = this.radarOpen ? 'block' : 'none';
        document.getElementById('btn-hud-radar').classList.toggle('active', this.radarOpen);
      }
    });

    document.getElementById('btn-hud-mute').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(10);
      const nextMute = !this.audio.muted;
      this.audio.setMuted(nextMute);
      document.getElementById('btn-hud-mute').textContent = nextMute ? 'SFX: OFF' : 'SFX: ON';
    });

    document.getElementById('btn-hud-pause').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(14);
      this.setPaused(!this.paused);
    });

    // Radar: tap to enlarge / shrink; hold 500 ms (without dragging) for the full-screen map
    const radarBox = document.getElementById('radar-container');
    let lp = null;
    const lpStop = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
    radarBox.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      lpStop();
      const me = lp = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false, moved: false, timer: 0 };
      me.timer = setTimeout(() => { me.fired = true; if (lp === me) lp = null; this.openFullMap(); }, 500);
    });
    radarBox.addEventListener('pointermove', (e) => {
      if (lp && e.pointerId === lp.id && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) { lp.moved = true; lpStop(); }
    });
    radarBox.addEventListener('pointerup', (e) => {
      if (!lp || e.pointerId !== lp.id) return;
      const tap = !lp.moved; lpStop();
      if (tap) radarBox.classList.toggle('big');
    });
    radarBox.addEventListener('pointercancel', lpStop);
    radarBox.addEventListener('pointerleave', lpStop);
    this.bindFullMapEvents();

    // Menu sheet extras (proxy the hidden HUD buttons so logic stays in one place)
    document.getElementById('btn-pause-radar').addEventListener('click', () => {
      document.getElementById('btn-hud-radar').click();
      this.refreshMenuLabels();
    });
    document.getElementById('btn-pause-mute').addEventListener('click', () => {
      document.getElementById('btn-hud-mute').click();
      this.refreshMenuLabels();
    });
    document.getElementById('pause-lowspec').addEventListener('change', (e) => this.setPref('lowSpec', e.target.checked));
    document.getElementById('pause-lefty').addEventListener('change', (e) => this.setPref('lefty', e.target.checked));
    document.getElementById('pause-hidebtns').addEventListener('change', (e) => this.setPref('hideButtons', e.target.checked));
    document.getElementById('pause-btnsize').addEventListener('change', (e) => this.setPref('btnScale', parseFloat(e.target.value)));
    document.getElementById('pause-btnopacity').addEventListener('input', (e) => this.setPref('btnOpacity', parseFloat(e.target.value)));

    // Pause Modal Controls
    document.getElementById('btn-pause-resume').addEventListener('click', () => {
      this.vibrate(12);
      this.setPaused(false);
    });
    document.getElementById('btn-pause-recenter').addEventListener('click', () => {
      this.vibrate(14);
      this.recenterGyro();
    });
    document.getElementById('btn-pause-fullscrn').addEventListener('click', () => {
      this.vibrate(12);
      this.toggleGameFullscreen();
    });
    document.getElementById('btn-pause-restart').addEventListener('click', () => {
      this.vibrate(16);
      this.setPaused(false);
      this.startSector(this.level, this.seedStr);
    });
    document.getElementById('pause-gyro-toggle').addEventListener('change', (e) => {
      this.setGyroEnabled(e.target.checked);
    });
    document.getElementById('pause-haptics').addEventListener('change', (e) => {
      this.hapticsEnabled = e.target.checked;
    });
    document.getElementById('pause-override-toggle').addEventListener('change', (e) => {
      this.overrideOpen = e.target.checked;
      document.getElementById('override-drawer').style.display = this.overrideOpen ? 'block' : 'none';
      if (this.overrideOpen) this.setPaused(false);
    });

    document.getElementById('fire-btn').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.fireRocket();
    });

    // Analog throttle lever (touch): drag anywhere on the track, bottom = min speed, top = max speed
    const stepSpeed = (delta) => {
      this.audio.unlock();
      this.setThrottle(this.missile.throttle + delta * 0.1);
    };
    this.stepSpeed = stepSpeed;
    const lever = document.getElementById('throttle-lever');
    const thrTrack = document.getElementById('thr-track');
    let leverPid = null;
    const leverFromEvent = (e) => {
      const r = thrTrack.getBoundingClientRect();
      this.setThrottle(1 - (e.clientY - r.top) / r.height);
    };
    lever.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.state === 'READY') return;
      this.audio.unlock();
      leverPid = e.pointerId;
      try { lever.setPointerCapture(e.pointerId); } catch (_) {}
      this.vibrate(8);
      leverFromEvent(e);
    });
    lever.addEventListener('pointermove', (e) => {
      if (e.pointerId !== leverPid) return;
      e.preventDefault();
      leverFromEvent(e);
    });
    const endLever = (e) => { if (e.pointerId === leverPid) leverPid = null; };
    lever.addEventListener('pointerup', endLever);
    lever.addEventListener('pointercancel', endLever);
    lever.addEventListener('lostpointercapture', endLever);

    // Floating Virtual Analog Flight Stick (Entire Left Half of Screen)
    const leftZone = document.getElementById('left-flight-zone');
    const joyGimbal = document.getElementById('joy-gimbal');
    const joyKnob = document.getElementById('joy-knob');
    const maxJoyRad = 48;

    const updateStick = (clientX, clientY) => {
      const dx = clientX - this.touchInput.joyStartX;
      const dy = clientY - this.touchInput.joyStartY;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(maxJoyRad, dist);
      const ang = Math.atan2(dy, dx);
      const kx = Math.cos(ang) * clamped;
      const ky = Math.sin(ang) * clamped;
      joyKnob.style.transform = `translate3d(${kx.toFixed(1)}px, ${ky.toFixed(1)}px, 0px)`;
      const norm = clamped / maxJoyRad;
      if (norm < 0.06) {
        this.touchInput.joyX = 0;
        this.touchInput.joyY = 0;
      } else {
        const scaled = Math.pow((norm - 0.06) / 0.94, 1.15);
        this.touchInput.joyX = Math.cos(ang) * scaled;
        this.touchInput.joyY = Math.sin(ang) * scaled;
      }
    };

    const releaseStick = (e) => {
      if (this.touchInput.joyId !== null && (!e || e.pointerId === this.touchInput.joyId)) {
        this.touchInput.joyId = null;
        this.touchInput.joyX = 0;
        this.touchInput.joyY = 0;
        joyGimbal.classList.remove('engaged');
        joyGimbal.style.left = '';
        joyGimbal.style.top = '';
        joyGimbal.style.bottom = '';
        joyKnob.style.transform = 'translate3d(0px, 0px, 0px)';
      }
    };

    leftZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.audio.unlock();
      if (this.touchInput.joyId !== null) return;
      this.touchInput.joyId = e.pointerId;
      this.touchInput.joyStartX = e.clientX;
      this.touchInput.joyStartY = e.clientY;
      joyGimbal.style.left = `${e.clientX}px`;
      joyGimbal.style.top = `${e.clientY}px`;
      joyGimbal.style.bottom = 'auto';
      joyGimbal.classList.add('engaged');
      leftZone.setPointerCapture(e.pointerId);
      updateStick(e.clientX, e.clientY);
      this.vibrate(8);
    });
    leftZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.touchInput.joyId) {
        e.preventDefault();
        updateStick(e.clientX, e.clientY);
      }
    });
    leftZone.addEventListener('pointerup', releaseStick);
    leftZone.addEventListener('pointercancel', releaseStick);
    leftZone.addEventListener('lostpointercapture', releaseStick);

    // Right-Half Fine-Aim Touch Drag Zone
    const rightAimZone = document.getElementById('right-aim-zone');
    rightAimZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();
      if ((this.state === 'PLAYING' || this.state === 'READY') && !this.paused && this.touchInput.lookId === null) {
        this.touchInput.lookId = e.pointerId;
        this.touchInput.lookLastX = e.clientX;
        this.touchInput.lookLastY = e.clientY;
        rightAimZone.setPointerCapture(e.pointerId);
      }
    });
    rightAimZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.touchInput.lookId && (this.state === 'PLAYING' || this.state === 'READY') && !this.paused) {
        e.preventDefault();
        const dx = e.clientX - this.touchInput.lookLastX;
        const dy = e.clientY - this.touchInput.lookLastY;
        this.touchInput.lookLastX = e.clientX;
        this.touchInput.lookLastY = e.clientY;
        this.mouseYawDelta += dx * 1.45;
        this.mousePitchDelta += dy * 1.45;
      }
    });
    const endRightAim = (e) => {
      if (e.pointerId === this.touchInput.lookId) {
        this.touchInput.lookId = null;
      }
    };
    rightAimZone.addEventListener('pointerup', endRightAim);
    rightAimZone.addEventListener('pointercancel', endRightAim);
    rightAimZone.addEventListener('lostpointercapture', endRightAim);

    // Right-Thumb Multi-Touch Combat Action Buttons
    const btnLock = document.getElementById('tbtn-lock');
    if (btnLock) {
      btnLock.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.audio.unlock();
        btnLock.classList.add('pressed');
        this.vibrate(14);
        this.toggleTargetLock();
      });
      const clearLockPress = () => btnLock.classList.remove('pressed');
      btnLock.addEventListener('pointerup', clearLockPress);
      btnLock.addEventListener('pointercancel', clearLockPress);
    }

    // (flip & burn removed in v2.10)

    const btnGun = document.getElementById('tbtn-gun');
    if (btnGun) {
      btnGun.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { btnGun.setPointerCapture(e.pointerId); } catch (_) {}
        this.gunHeld = true; btnGun.classList.add('pressed');
      });
      const gunUp = () => { this.gunHeld = false; btnGun.classList.remove('pressed'); };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => btnGun.addEventListener(ev, gunUp));
    }
    const btnAuto = document.getElementById('tbtn-auto');
    if (btnAuto) {
      btnAuto.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.audio.unlock();
        btnAuto.classList.add('pressed');
        this.pressAuto();
      });
      const autoUp = () => btnAuto.classList.remove('pressed');
      btnAuto.addEventListener('pointerup', autoUp);
      btnAuto.addEventListener('pointercancel', autoUp);
    }
    const btnHover = document.getElementById('tbtn-hover');
    if (btnHover) {
      btnHover.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.audio.unlock();
        btnHover.classList.add('pressed');
        this.pressHover();
      });
      const hoverUp = () => btnHover.classList.remove('pressed');
      btnHover.addEventListener('pointerup', hoverUp);
      btnHover.addEventListener('pointercancel', hoverUp);
    }
    const btnDecoy = document.getElementById('tbtn-decoy');
    btnDecoy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.audio.unlock();
      btnDecoy.classList.add('pressed');
      this.throwDecoy();
    });
    const clearDecoyPress = () => btnDecoy.classList.remove('pressed');
    btnDecoy.addEventListener('pointerup', clearDecoyPress);
    btnDecoy.addEventListener('pointercancel', clearDecoyPress);


    const btnDet = document.getElementById('tbtn-detonate');
    const DET_HOLD_MS = 400;
    const showDetMode = () => {
      const prox = this.fuzeMode !== 'det';
      btnDet.classList.toggle('det', !prox);
      this.cText(btnDet, prox ? 'PROX\nFUZE' : 'HOLD\nDETONATE');
    };
    this.showDetMode = showDetMode; showDetMode();
    let detPid = null, detStart = 0, detRaf = 0;
    const setHold = (v) => btnDet.style.setProperty('--hold', v.toFixed(3));
    const stopDet = () => {
      cancelAnimationFrame(detRaf);
      detPid = null;
      btnDet.classList.remove('pressed');
      setHold(0);
    };
    const tickDet = () => {
      if (detPid === null) return;
      if (this.paused) { stopDet(); return; }
      if (this.fuzeMode !== 'det') return;
      const p = Math.min(1, (performance.now() - detStart) / DET_HOLD_MS);
      setHold(p);
      if (p >= 1) {
        stopDet();
        this.vibrate(32);
        if (this.state === 'PLAYING' && this.missile.active) {
          this.detonateMissile(this.missile.pos, 'MANUAL WARHEAD DETONATION');
        }
        return;
      }
      detRaf = requestAnimationFrame(tickDet);
    };
    btnDet.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.audio.unlock();
      if (detPid !== null) return;
      detPid = e.pointerId;
      try { btnDet.setPointerCapture(e.pointerId); } catch (_) {}
      detStart = performance.now();
      btnDet.classList.add('pressed');
      this.vibrate(10);
      detRaf = requestAnimationFrame(tickDet);
    });
    const endDet = (e) => {
      if (detPid !== null && (!e || e.pointerId === detPid)) {
        const held = performance.now() - detStart;
        stopDet();
        if (held < DET_HOLD_MS) {
          // a tap switches between proximity fuze and hold-to-detonate
          this.fuzeMode = this.fuzeMode === 'det' ? 'prox' : 'det';
          showDetMode();
          this.vibrate(15);
          this.pushFeed(this.fuzeMode === 'det' ? 'DETONATE MODE — HOLD 0.4 s TO FIRE WARHEAD' : 'PROXIMITY FUZE ARMED', this.fuzeMode === 'det' ? 'red' : 'amber');
        }
      }
    };
    btnDet.addEventListener('pointerup', endDet);
    btnDet.addEventListener('pointercancel', endDet);
    btnDet.addEventListener('lostpointercapture', endDet);

    // Keyboard Controls
    window.addEventListener('keydown', (e) => {
      const kt = e.target;
      if (kt && kt.tagName === 'INPUT' && (kt.type === 'text' || kt.type === 'number')) return;
      this.audio.unlock();
      if (this.fmap.open) {                                              // the full-screen map owns the keyboard: Esc / M close it
        if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); this.closeFullMap(); }
        return;
      }
      if (e.code === 'KeyM' && !e.repeat && this.fullMapAllowed() && !this.paused) { e.preventDefault(); this.openFullMap(); return; }
      if (this.state === 'PLAYING' && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();   // keep a focused slider/button from reacting to flight keys
      this.keys[e.code] = true;

      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.state === 'PLAYING' || this.state === 'KILLCAM') {
          this.radarOpen = !this.radarOpen;
          document.getElementById('radar-container').style.display = this.radarOpen ? 'block' : 'none';
          document.getElementById('btn-hud-radar').classList.toggle('active', this.radarOpen);
        }
      }
      if (e.code === 'Backquote') {
        e.preventDefault();
        this.overrideOpen = !this.overrideOpen;
        document.getElementById('override-drawer').style.display = this.overrideOpen ? 'block' : 'none';
      }
      if (e.code === 'Digit1') this.setThrottle(0);
      if (e.code === 'Digit2') this.setThrottle(CRUISE_THROTTLE);
      if (e.code === 'Digit3') this.setThrottle(1);
      if (e.code === 'Minus' || e.code === 'BracketLeft') stepSpeed(-1);
      if (e.code === 'Equal' || e.code === 'BracketRight') stepSpeed(1);

      if (e.code === 'KeyQ' && this.state === 'PLAYING') this.throwDecoy();
      if (e.code === 'KeyH' && !e.repeat) this.pressHover();
      if (e.code === 'KeyB' && !e.repeat) { this.setPref('hideButtons', !this.prefs.hideButtons); this.pushFeed(this.prefs.hideButtons ? 'ON-SCREEN BUTTONS HIDDEN (B)' : 'ON-SCREEN BUTTONS SHOWN (B)', 'cyan'); }
      if (e.code === 'KeyC' && !e.repeat) this.toggleCamView();
      if (e.code === 'KeyV' && !e.repeat) this.pressAuto();
      if ((e.code === 'KeyL' || e.code === 'KeyF') && this.state === 'PLAYING') {
        this.toggleTargetLock();
      }
      if ((e.code === 'Enter' || e.code === 'Space') && this.state === 'READY') {
        e.preventDefault();
        this.fireRocket();
      }
      if (e.code === 'KeyR') {
        if (this.state === 'PLAYING' && this.missile.active) {
          this.detonateMissile(this.missile.pos, 'MANUAL WARHEAD DETONATION');
        } else if (this.state === 'FAILED') {
          this.startSector(this.level, this.seedStr);
        }
      }
    });

    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    window.addEventListener('wheel', (e) => {
      if (this.state !== 'PLAYING' || this.fmap.open) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      stepSpeed(dir);
    }, { passive: true });

    window.addEventListener('contextmenu', (e) => {
      if (this.state === 'PLAYING') {
        e.preventDefault();
      }
    });

    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if ((this.state === 'PLAYING' || this.state === 'READY') && !this.overrideOpen && !this.isTouchDevice && document.pointerLockElement !== this.canvas) {
        if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = (document.pointerLockElement === this.canvas);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked && !this.fmap.open && (this.state === 'PLAYING' || this.state === 'READY')) {
        this.mouseYawDelta += e.movementX;
        this.mousePitchDelta += e.movementY;
      }
    });

    // Briefing, Pause & Override Synced Invert Pitch
    const briefInvert = document.getElementById('brief-invert-pitch');
    const ovInvert = document.getElementById('ov-invert-pitch');
    const pauseInvert = document.getElementById('pause-invert-pitch');
    const syncInvert = (val) => {
      this.cfg.invertPitch = val;
      if (briefInvert) briefInvert.checked = val;
      if (ovInvert) ovInvert.checked = val;
      if (pauseInvert) pauseInvert.checked = val;
    };
    if (briefInvert) briefInvert.addEventListener('change', (e) => syncInvert(e.target.checked));
    if (ovInvert) ovInvert.addEventListener('change', (e) => syncInvert(e.target.checked));
    if (pauseInvert) pauseInvert.addEventListener('change', (e) => syncInvert(e.target.checked));

    const briefSeedEl = document.getElementById('brief-seed');
    if (briefSeedEl) {
      briefSeedEl.addEventListener('input', () => { this.customSeedEntered = true; });
    }

    document.getElementById('btn-exit').addEventListener('click', () => this.exitGame());
    const delBtn = document.getElementById('btn-delete-save');
    delBtn.addEventListener('click', async () => {
      const ok = await nkConfirm('DELETE SAVE DATA?', 'This erases your credits, upgrades, best scores, saved scan maps and settings on this device. It cannot be undone. The offline copy of the game is kept.', 'DELETE');
      if (ok) { delBtn.textContent = 'DELETING...'; this.deleteSavedData(); }
    });
    document.getElementById('btn-upgrades').addEventListener('click', () => this.openUpgrades());
    document.getElementById('btn-clear-upgrades').addEventListener('click', () => this.openUpgrades());
    document.getElementById('btn-fail-upgrades').addEventListener('click', () => this.openUpgrades());
    document.getElementById('btn-upg-back').addEventListener('click', () => this.closeUpgrades());
    // Exit to menu asks twice so a stray tap cannot throw away a sector
    const menuBtn = document.getElementById('btn-pause-menu');
    let menuArmed = 0;
    menuBtn.addEventListener('click', () => {
      if (menuArmed && performance.now() - menuArmed < 3000) { menuArmed = 0; menuBtn.textContent = 'EXIT TO MENU'; this.exitToMenu(); return; }
      menuArmed = performance.now();
      menuBtn.textContent = 'TAP AGAIN TO EXIT';
      setTimeout(() => { if (menuArmed && performance.now() - menuArmed >= 2900) { menuArmed = 0; menuBtn.textContent = 'EXIT TO MENU'; } }, 3100);
    });
    this.updateCreditLabels();

    // Title menu: NEW (wipes the old save) / CONTINUE (resumes from storage) / OPTIONS / EXIT
    const launch = async (lvl, seed, intro) => {
      this.audio.unlock();
      this.vibrate(18);
      const wantGyro = document.getElementById('brief-gyro-enable').checked;
      this.setGyroEnabled(wantGyro);
      this.requestGameFullscreen();
      document.getElementById('ov-seed-input').value = seed;
      document.getElementById('briefing-modal').style.display = 'none';
      if (intro) await this.playIntroCall();               // Meryl briefs the player on a new campaign
      document.getElementById('hud-layer').style.display = 'block';
      this.startSector(lvl, seed);
      try { history.pushState({ nk: 1 }, ''); } catch (_) {}   // the back button pauses instead of leaving the app
    };
    document.getElementById('btn-new').addEventListener('click', async () => {
      if (this.hasSave()) {
        const ok = await nkConfirm('START A NEW GAME?', 'Starting a new game deletes ALL your saved progress on this device: level reached, credits, upgrades, best scores, scan maps and the autopilot\'s explored map. You start again from sector 1. Your settings are kept. This cannot be undone.', 'START NEW');
        if (!ok) return;
      }
      await this.wipeSave();                       // everything: level, credits, upgrades, best scores, maps, autopilot memory
      const lvEl = document.getElementById('brief-level');
      if (lvEl) lvEl.value = '1';                  // a new game always starts at sector 1
      this.level = 1; this.score = 0; this.rewards = this.rewards || {};
      this.updateCreditLabels();
      const typedSeed = briefSeedEl ? briefSeedEl.value.trim() : '';
      launch(1, typedSeed || this.generateRandomSeed(), true);
    });
    document.getElementById('btn-continue').addEventListener('click', () => {
      if (!this.hasSave()) return;
      const typedSeed = briefSeedEl ? briefSeedEl.value.trim() : '';
      launch(this.contLvl || parseInt(document.getElementById('brief-level').value, 10) || 1, this.contSeed || typedSeed || this.generateRandomSeed());
    });
    document.getElementById('btn-options').addEventListener('click', () => this.showTitleView(true));
    document.getElementById('btn-replay-intro').addEventListener('click', () => { this.audio.unlock(); document.getElementById('briefing-modal').style.display = 'none'; this.playIntroCall().then(() => { document.getElementById('briefing-modal').style.display = 'flex'; }); });
    document.getElementById('btn-options-back').addEventListener('click', () => this.showTitleView(false));
    document.getElementById('title-menu').addEventListener('keydown', (e) => {   // arrow keys move through the menu
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...document.querySelectorAll('#title-menu button:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      e.preventDefault();
    });
    window.addEventListener('popstate', () => {          // Android back / browser back during play: pause, stay in the game
      if (this.state === 'PLAYING' || this.state === 'READY' || this.state === 'KILLCAM' || this.state === 'RESPAWNING') {
        this.setPaused(true);
        try { history.pushState({ nk: 1 }, ''); } catch (_) {}
      }
    });
    const ov = document.getElementById('opt-version'); if (ov) ov.textContent = NIKITA_VERSION;

    document.getElementById('btn-next-sector').addEventListener('click', () => {
      this.requestGameFullscreen();
      const nextLvl = this.level >= MAX_LEVELS ? 1 : this.level + 1;
      this.startSector(nextLvl, this.generateRandomSeed(), this.level < MAX_LEVELS);
    });
    document.getElementById('btn-replay-sector').addEventListener('click', () => {
      this.requestGameFullscreen();
      this.startSector(this.level, this.seedStr);
    });
    document.getElementById('btn-play-again').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(18);
      this.requestGameFullscreen();
      this.startSector(this.level, this.generateRandomSeed());
    });
    document.getElementById('btn-retry-sector').addEventListener('click', () => {
      this.audio.unlock();
      this.vibrate(18);
      this.requestGameFullscreen();
      this.startSector(this.level, this.seedStr);
    });

    // Override Drawer Controls
    document.getElementById('ov-close-btn').addEventListener('click', () => {
      this.overrideOpen = false;
      document.getElementById('override-drawer').style.display = 'none';
      const pauseOv = document.getElementById('pause-override-toggle');
      if (pauseOv) pauseOv.checked = false;
    });
    document.getElementById('ov-inf-fuel').addEventListener('change', (e) => this.cfg.infFuel = e.target.checked);
    document.getElementById('ov-apdebug').addEventListener('change', (e) => { this.cfg.apDebug = e.target.checked; const el = document.getElementById('ap-debug'); if (el) el.style.display = e.target.checked ? 'block' : 'none'; });
    document.getElementById('ov-god-mode').addEventListener('change', (e) => this.cfg.godMode = e.target.checked);
    document.getElementById('ov-inf-boost').addEventListener('change', (e) => this.cfg.infBoost = e.target.checked);
    document.getElementById('ov-homing').addEventListener('change', (e) => this.cfg.homing = e.target.checked);
    document.getElementById('ov-autolevel').addEventListener('change', (e) => this.cfg.autoLevel = e.target.checked);
    document.getElementById('ov-xray').addEventListener('change', (e) => {
      this.cfg.xray = e.target.checked;
      this.wallMat.wireframe = this.cfg.xray;
    });
    document.getElementById('ov-fps').addEventListener('change', (e) => {
      this.cfg.showFps = e.target.checked;
      document.getElementById('fps-badge').style.display = this.cfg.showFps ? 'block' : 'none';
    });

    document.getElementById('ov-brightness').addEventListener('input', (e) => {
      this.cfg.brightness = parseFloat(e.target.value);
      this.renderer.toneMappingExposure = this.cfg.brightness;
      document.getElementById('ov-brightness-val').textContent = `${this.cfg.brightness.toFixed(1)}x`;
    });
    document.getElementById('ov-gyrosens').addEventListener('input', (e) => {
      this.cfg.gyroSens = parseFloat(e.target.value);
      document.getElementById('ov-gyrosens-val').textContent = `${this.cfg.gyroSens.toFixed(1)}x`;
    });
    document.getElementById('ov-mousesens').addEventListener('input', (e) => {
      this.cfg.mouseSens = parseFloat(e.target.value);
      document.getElementById('ov-mousesens-val').textContent = `${this.cfg.mouseSens.toFixed(1)}x`;
    });
    document.getElementById('ov-timescale').addEventListener('input', (e) => {
      this.cfg.timeScale = parseFloat(e.target.value);
      document.getElementById('ov-timescale-val').textContent = `${this.cfg.timeScale.toFixed(1)}x`;
    });
    document.getElementById('ov-speed').addEventListener('input', (e) => {
      this.cfg.speedMult = parseFloat(e.target.value);
      document.getElementById('ov-speed-val').textContent = `${this.cfg.speedMult.toFixed(1)}x`;
    });
    document.getElementById('ov-agility').addEventListener('input', (e) => {
      this.cfg.agilityMult = parseFloat(e.target.value);
      document.getElementById('ov-agility-val').textContent = `${this.cfg.agilityMult.toFixed(1)}x`;
    });

    document.querySelectorAll('[data-warp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lvl = parseInt(btn.getAttribute('data-warp'), 10);
        this.startSector(lvl, this.seedStr);
      });
    });

    document.getElementById('ov-warp-go').addEventListener('click', () => {
      const val = parseInt(document.getElementById('ov-warp-input').value, 10) || 1;
      this.startSector(Math.max(1, Math.min(MAX_LEVELS, val)), this.seedStr);
    });

    document.getElementById('ov-seed-apply').addEventListener('click', () => {
      const s = document.getElementById('ov-seed-input').value.trim() || '1998';
      this.startSector(this.level, s);
    });
    document.getElementById('ov-seed-rand').addEventListener('click', () => {
      const r = this.generateRandomSeed();
      document.getElementById('ov-seed-input').value = r;
      this.startSector(this.level, r);
    });
  },
};
