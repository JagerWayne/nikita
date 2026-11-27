/* Procedural Web Audio synthesizer: rocket motor, explosions, radio, alarms. The context is created on the first user gesture (unlock()). */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.brownBuffer = null;
    this.eng = null;
    this.engLevel = 0;
    this.initialized = false;
    this.muted = false;
    this.sonarTimer = 0;
  }

  /* Safe to call on every user gesture: the context is created once, afterwards each call only wakes it up if the
     browser (autoplay policy, tab switch, phone call) left it suspended or interrupted. */
  unlock() {
    if (this.initialized) { this.resume(); return; }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0.0 : 0.5;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const sr = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
    const w = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    // brown noise (integrated white noise): the deep, soft body of a rocket motor's rumble
    this.brownBuffer = this.ctx.createBuffer(1, sr * 4, sr);
    const br = this.brownBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < br.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; br[i] = last * 3.5; }

    this.buildEngine();

    try {
      const silentBuf = this.ctx.createBuffer(1, 1, 22050);
      const silentSrc = this.ctx.createBufferSource();
      silentSrc.buffer = silentBuf;
      silentSrc.connect(this.ctx.destination);
      silentSrc.start(0);
    } catch (_) {}

    this.initialized = true;
    this.resume();
  }

  resume() {
    const c = this.ctx;
    if (!c || c.state === 'running' || c.state === 'closed') return;
    try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (_) {}   // blocked until the next gesture: unlock() tries again
  }

  /* The page went to the background: silence everything, including the motor loops that only the (stopped) frame loop would fade. */
  suspend() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    try { const p = c.suspend(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  }

  // Rocket motor: four layers, all driven from updateEngine()
  //  rumble  - brown noise through a low-pass, amplitude-modulated at the combustion "chuff" rate
  //  roar    - white noise through a sweeping band-pass (the exhaust jet)
  //  hiss    - high-passed noise (supersonic edge, only at speed)
  //  chamber - low sines for the chamber resonance
  buildEngine() {
    const c = this.ctx;
    const loopSrc = (buf, rate, offset) => {
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
      src.start(0, offset);
      return src;
    };
    const E = {};
    E.rumbleF = c.createBiquadFilter(); E.rumbleF.type = 'lowpass'; E.rumbleF.frequency.value = 120; E.rumbleF.Q.value = 0.7;
    E.rumbleG = c.createGain(); E.rumbleG.gain.value = 0;
    E.amG = c.createGain(); E.amG.gain.value = 1;
    loopSrc(this.brownBuffer, 1, 0).connect(E.rumbleF);
    E.rumbleF.connect(E.amG); E.amG.connect(E.rumbleG); E.rumbleG.connect(this.master);
    E.lfo = c.createOscillator(); E.lfo.type = 'sine'; E.lfo.frequency.value = 20;
    E.lfoDepth = c.createGain(); E.lfoDepth.gain.value = 0.18;
    E.lfo.connect(E.lfoDepth); E.lfoDepth.connect(E.amG.gain); E.lfo.start();

    E.roarF = c.createBiquadFilter(); E.roarF.type = 'bandpass'; E.roarF.frequency.value = 700; E.roarF.Q.value = 0.6;
    E.roarLP = c.createBiquadFilter(); E.roarLP.type = 'lowpass'; E.roarLP.frequency.value = 3200;
    E.roarG = c.createGain(); E.roarG.gain.value = 0;
    loopSrc(this.noiseBuffer, 1, 0.31).connect(E.roarF);
    E.roarF.connect(E.roarLP); E.roarLP.connect(E.roarG); E.roarG.connect(this.master);

    E.hissF = c.createBiquadFilter(); E.hissF.type = 'highpass'; E.hissF.frequency.value = 3600;
    E.hissG = c.createGain(); E.hissG.gain.value = 0;
    loopSrc(this.noiseBuffer, 1.13, 0.77).connect(E.hissF);
    E.hissF.connect(E.hissG); E.hissG.connect(this.master);

    E.toneA = c.createOscillator(); E.toneA.type = 'sine'; E.toneA.frequency.value = 58;
    E.toneB = c.createOscillator(); E.toneB.type = 'sine'; E.toneB.frequency.value = 87;
    E.toneG = c.createGain(); E.toneG.gain.value = 0;
    E.toneA.connect(E.toneG); E.toneB.connect(E.toneG); E.toneG.connect(this.master);
    E.toneA.start(); E.toneB.start();
    this.eng = E;
  }

  setMuted(m) {
    this.muted = Boolean(m);
    if (this.initialized && this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0.0 : 0.5, this.ctx.currentTime, 0.03);
    }
  }

  updateEngine(active, speedMode, speedNorm, hasFuel) {
    if (!this.initialized || !this.eng) return;
    const E = this.eng, t = this.ctx.currentTime;
    if (!active || !hasFuel) {
      // motor shutting down: everything decays, the roar first
      this.engLevel *= 0.9;
      E.rumbleG.gain.setTargetAtTime(0, t, 0.25);
      E.roarG.gain.setTargetAtTime(0, t, 0.12);
      E.hissG.gain.setTargetAtTime(0, t, 0.1);
      E.toneG.gain.setTargetAtTime(0, t, 0.2);
      return;
    }
    // thrust level spools up and down slowly, like a real motor
    const L0 = Math.max(0, Math.min(1, speedNorm));
    this.engLevel += (L0 - this.engLevel) * 0.06;
    const L = this.engLevel;
    const crackle = 1 + (Math.random() - 0.5) * (0.22 + 0.3 * L);      // combustion roughness
    E.rumbleF.frequency.setTargetAtTime(95 + 320 * L, t, 0.12);
    E.rumbleG.gain.setTargetAtTime((0.16 + 0.30 * L) * crackle, t, 0.04);
    E.lfo.frequency.setTargetAtTime(15 + 24 * L, t, 0.2);
    E.lfoDepth.gain.setTargetAtTime(0.16 + 0.1 * L, t, 0.2);
    E.roarF.frequency.setTargetAtTime(420 + 2300 * L * L + 200 * L, t, 0.1);
    E.roarLP.frequency.setTargetAtTime(1800 + 3800 * L, t, 0.1);
    E.roarG.gain.setTargetAtTime((0.025 + 0.20 * Math.pow(L, 1.25)) * (1 + (Math.random() - 0.5) * 0.35), t, 0.03);
    E.hissG.gain.setTargetAtTime(0.045 * L * L * (speedMode === 3 ? 1.5 : 1), t, 0.1);
    E.toneA.frequency.setTargetAtTime(52 + 46 * L, t, 0.2);
    E.toneB.frequency.setTargetAtTime(78 + 70 * L, t, 0.2);
    E.toneG.gain.setTargetAtTime(0.025 + 0.035 * L, t, 0.2);
  }

  // Soft sine voice: attack ramp (no clicks), exponential release. Pitch can glide from f0 to f1.
  tone(f0, f1, start, dur, vol, attack = 0.012) {
    if (!this.initialized) return;
    const c = this.ctx, t = c.currentTime + start;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  playSpeedShift(tier) {
    const base = tier === 1 ? 300 : (tier === 2 ? 420 : 600);
    this.tone(base * 0.8, base, 0, 0.12, 0.045);
  }

  playLockTone() {
    this.tone(880, 880, 0, 0.07, 0.04);
    this.tone(1175, 1175, 0.06, 0.1, 0.04);
  }

  playSonarPing(proximity01) {
    this.tone(640 + proximity01 * 420, 0, 0, 0.14, 0.018 + proximity01 * 0.03, 0.01);
  }

  playAlertStinger() {
    this.tone(660, 0, 0, 0.18, 0.05);
    this.tone(830, 0, 0.12, 0.2, 0.05);
    this.tone(990, 0, 0.24, 0.3, 0.05);
  }

  playGunshot() {
    this.tone(520, 150, 0, 0.07, 0.045, 0.004);
    this.tone(260, 80, 0, 0.09, 0.03, 0.004);
  }

  playScrape() {
    this.tone(330, 130, 0, 0.2, 0.06, 0.006);
    this.tone(497, 190, 0, 0.17, 0.035, 0.006);
  }

  playExplosion(power = 1.0) {
    const dur = 0.7 + power * 0.5;
    this.tone(95, 26, 0, dur, Math.min(0.34, 0.2 * power), 0.01);
    this.tone(58, 22, 0.02, dur * 1.1, Math.min(0.26, 0.15 * power), 0.015);
    this.tone(190, 55, 0, dur * 0.55, Math.min(0.16, 0.09 * power), 0.008);
    this.tone(310, 90, 0.01, dur * 0.3, Math.min(0.08, 0.05 * power), 0.006);
  }

  playLaserArm() {
    this.tone(460, 900, 0, 0.2, 0.035, 0.02);
  }

  playLaserDown() {
    this.tone(700, 120, 0, 0.36, 0.045, 0.01);
  }

  playRing() {                                  // two-tone phone ring
    this.tone(880, 880, 0, 0.18, 0.05, 0.01); this.tone(660, 660, 0.22, 0.18, 0.05, 0.01);
  }
  playRadioBlip() {                             // squelch click + a short burst of static when a radio line opens or closes
    this.tone(1400, 900, 0, 0.07, 0.04, 0.004);
    if (!this.initialized) return;
    const c = this.ctx, t = c.currentTime + 0.02, src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    src.buffer = this.noiseBuffer; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.18);
  }
  playBrake(s = 1) {                            // air brakes: a falling whoosh of filtered noise over a dropping tone
    this.tone(240, 70, 0, 0.5, 0.025 + 0.03 * s, 0.02);
    if (!this.initialized) return;
    const c = this.ctx, t = c.currentTime + 0.01, src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    src.buffer = this.noiseBuffer; f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.55);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 + 0.08 * s, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.65);
  }
  playBump(k = 0.5) {                           // dull thud with a short click: the hull knocking a wall
    this.tone(150, 52, 0, 0.18, 0.05 + 0.07 * k, 0.004);
    if (!this.initialized) return;
    const c = this.ctx, t = c.currentTime + 0.005, src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    src.buffer = this.noiseBuffer; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03 + 0.06 * k, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.12);
  }
  playSputter() {                               // the engine coughing on its last fuel
    this.tone(110, 60, 0, 0.14, 0.045, 0.004); this.tone(95, 55, 0.17, 0.1, 0.03, 0.004);
  }
  playTargetChime() {
    [523.25, 659.25, 1046.5].forEach((f, i) => this.tone(f, f, i * 0.08, 0.4, 0.05, 0.015));
  }
}
