'use strict';
/* ===== Real-time procedural sound engine (Web Audio API only) =====
 * No external audio files: every effect and the music loop are synthesized.
 */

const AudioEngine = {
  ctx: null,
  master: null,
  sfxGain: null,
  musicGain: null,
  enabled: true,
  sfxVol: 1,      // 0..1, user-set effects volume
  musicVol: 0.5,  // 0..1, user-set music volume
  VOL_KEY: 'scorched_reborn_vol_v1',
  _noiseBuf: null,
  _musicTimer: null,
  _step: 0,
  _nextStepTime: 0,
  _humOsc: null,
  _humRefs: 0,

  TEMPO: 112, // BPM

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) return;
    const AC = (typeof AudioContext !== 'undefined') ? AudioContext :
      (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVol;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol * 0.65;
    this.musicGain.connect(this.master);

    // 1 second of cached white noise, reused by every percussive sound.
    const len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  },

  setSfxVolume(v) {
    this.sfxVol = Utils.clamp(v, 0, 1);
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVol;
    this._persistVolumes();
  },

  setMusicVolume(v) {
    this.musicVol = Utils.clamp(v, 0, 1);
    if (this.musicGain) this.musicGain.gain.value = this.musicVol * 0.65;
    this._persistVolumes();
  },

  _persistVolumes() {
    try {
      localStorage.setItem(this.VOL_KEY, JSON.stringify({ sfx: this.sfxVol, music: this.musicVol }));
    } catch (e) { /* storage blocked */ }
  },

  loadVolumes() {
    try {
      const v = JSON.parse(localStorage.getItem(this.VOL_KEY));
      if (v) {
        if (typeof v.sfx === 'number') this.sfxVol = Utils.clamp(v.sfx, 0, 1);
        if (typeof v.music === 'number') this.musicVol = Utils.clamp(v.music, 0, 1);
      }
    } catch (e) { /* missing / corrupt */ }
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  /* ---------- building blocks ---------- */

  _noise({ dur = 0.3, type = 'bandpass', freq = 600, q = 1, gain = 0.5, f1 = null, at = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(freq, t0);
    if (f1 !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(flt).connect(g).connect(this.sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.05);
  },

  _tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, gain = 0.3, at = 0, dest = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(dest || this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  },

  /* ---------- sound effects ---------- */

  /** Decaying white noise through a bandpass filter; size 0..1 scales it. */
  explosion(size = 0.5) {
    if (!this.ctx || !this.enabled) return;
    const dur = 0.4 + size * 0.9;
    this._noise({ dur, type: 'bandpass', freq: 700 - size * 350, f1: 60, q: 0.7, gain: 0.6 + size * 0.4 });
    this._noise({ dur: dur * 0.6, type: 'lowpass', freq: 300, f1: 50, gain: 0.5 + size * 0.5 });
    if (size > 0.5) this._tone({ type: 'sine', f0: 90, f1: 28, dur: dur, gain: 0.7 }); // sub-bass thump
  },

  /** Turret launch: frequency-sweeping oscillator. */
  launch() {
    if (!this.ctx || !this.enabled) return;
    this._tone({ type: 'sawtooth', f0: 650, f1: 110, dur: 0.38, gain: 0.22 });
    this._noise({ dur: 0.25, type: 'highpass', freq: 1200, gain: 0.12 });
  },

  laser() {
    if (!this.ctx || !this.enabled) return;
    this._tone({ type: 'square', f0: 1900, f1: 240, dur: 0.32, gain: 0.16 });
    this._tone({ type: 'sine', f0: 2800, f1: 700, dur: 0.28, gain: 0.1 });
  },

  /** Orbital MASER lock-on: rising charge whine while the beam converges. */
  maserCharge() {
    if (!this.ctx || !this.enabled) return;
    this._tone({ type: 'sine', f0: 70, f1: 980, dur: 1.05, gain: 0.16 });
    this._tone({ type: 'sawtooth', f0: 140, f1: 1960, dur: 1.05, gain: 0.05 });
  },

  bounce() { this._tone({ type: 'triangle', f0: 340, f1: 150, dur: 0.1, gain: 0.18 }); },
  click()  { this._tone({ type: 'square', f0: 850, dur: 0.05, gain: 0.08 }); },
  error()  { this._tone({ type: 'square', f0: 170, f1: 90, dur: 0.22, gain: 0.18 }); },

  /** Shop purchase: major-third arpeggio pulses (C5 - E5 - G5). */
  purchase() {
    if (!this.ctx || !this.enabled) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => this._tone({ type: 'sine', f0: f, dur: 0.14, gain: 0.2, at: i * 0.07 }));
  },

  levelUp() {
    if (!this.ctx || !this.enabled) return;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((f, i) => this._tone({ type: 'triangle', f0: f, dur: 0.18, gain: 0.2, at: i * 0.09 }));
  },

  shieldOn() {
    this._tone({ type: 'sine', f0: 220, f1: 880, dur: 0.4, gain: 0.18 });
    this.humStart();
  },

  /** Shield hum: tremolo-modulated sine. Refcounted across active shields. */
  humStart() {
    this._humRefs++;
    if (!this.ctx || this._humOsc) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 112;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(this.sfxGain);
    osc.start(); lfo.start();
    this._humOsc = { osc, lfo, g };
  },

  humStop() {
    this._humRefs = Math.max(0, this._humRefs - 1);
    if (this._humRefs > 0 || !this._humOsc) return;
    const { osc, lfo, g } = this._humOsc;
    this._humOsc = null;
    if (this.ctx) {
      g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
      osc.stop(this.ctx.currentTime + 0.35);
      lfo.stop(this.ctx.currentTime + 0.35);
    }
  },

  humReset() { this._humRefs = 1; this.humStop(); },

  /* ---------- procedural synthwave music ---------- */

  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    this._step = 0;
    this._nextStepTime = this.ctx.currentTime + 0.1;
    this._musicTimer = setInterval(() => this._schedule(), 25);
  },

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  },

  _schedule() {
    const stepDur = 60 / this.TEMPO / 4; // 16th notes
    while (this._nextStepTime < this.ctx.currentTime + 0.12) {
      this._playStep(this._step % 32, this._nextStepTime);
      this._nextStepTime += stepDur;
      this._step++;
    }
  },

  // A-minor arpeggio bassline (A2 C3 E3 A3 ...), kick & snare synths.
  _BASS: [110, 130.81, 164.81, 220, 261.63, 220, 164.81, 130.81,
          110, 130.81, 164.81, 220, 246.94, 220, 164.81, 146.83,
          110, 130.81, 164.81, 220, 261.63, 220, 164.81, 130.81,
          87.31, 110, 130.81, 174.61, 220, 174.61, 130.81, 110],

  _playStep(s, t) {
    const at = t - this.ctx.currentTime;
    // Kick: sine sweep on every quarter note.
    if (s % 4 === 0) this._tone({ type: 'sine', f0: 150, f1: 38, dur: 0.22, gain: 0.55, at, dest: this.musicGain });
    // Snare: noise burst on the back beats.
    if (s % 8 === 4) {
      const t0 = t;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf; src.loop = true;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'bandpass'; flt.frequency.value = 1900; flt.Q.value = 0.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.3, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
      src.connect(flt).connect(g).connect(this.musicGain);
      src.start(t0); src.stop(t0 + 0.2);
    }
    // Hat: tiny high noise ticks on off-beats.
    if (s % 2 === 1) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf; src.loop = true;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'highpass'; flt.frequency.value = 7000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(flt).connect(g).connect(this.musicGain);
      src.start(t); src.stop(t + 0.06);
    }
    // Arpeggiated synth bass, low-passed sawtooth.
    const f = this._BASS[s];
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 750; flt.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.004, t + 0.12);
    osc.connect(flt).connect(g).connect(this.musicGain);
    osc.start(t); osc.stop(t + 0.14);
  },
};

AudioEngine.loadVolumes();
