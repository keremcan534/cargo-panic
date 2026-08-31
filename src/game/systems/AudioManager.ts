/**
 * Every sound in the game is synthesised at runtime with the Web Audio API.
 * No audio files ship, so there is nothing to download and nothing licensed.
 *
 * The context is created lazily on the first user gesture to satisfy browser
 * autoplay policy, and every call is a no-op when audio is unavailable.
 */

import { progress } from './ProgressManager';

type Osc = 'sine' | 'square' | 'sawtooth' | 'triangle';

interface ToneOpts {
  type?: Osc;
  gain?: number;
  attack?: number;
  release?: number;
  slideTo?: number;
  delay?: number;
  detune?: number;
}

interface NoiseOpts {
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqTo?: number;
  q?: number;
  delay?: number;
  attack?: number;
}

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private failed = false;

  get enabled() {
    return progress.soundOn && !this.failed;
  }

  /** Safe to call on every pointer down; only the first call does work. */
  unlock() {
    if (this.ctx || this.failed) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 1.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch {
      this.failed = true;
    }
  }

  setEnabled(on: boolean) {
    progress.setSound(on);
    if (on) this.unlock();
  }

  private now(delay = 0) {
    return (this.ctx as AudioContext).currentTime + delay;
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx || !this.master) return;
    const t = this.now(o.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t + dur);

    const peak = o.gain ?? 0.2;
    const atk = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + (o.release ?? 0));

    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + (o.release ?? 0) + 0.05);
  }

  private noise(dur: number, o: NoiseOpts = {}) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.now(o.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;

    const filt = this.ctx.createBiquadFilter();
    filt.type = o.filter ?? 'bandpass';
    filt.frequency.setValueAtTime(o.freq ?? 800, t);
    if (o.freqTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, o.freqTo), t + dur);
    filt.Q.value = o.q ?? 1;

    const g = this.ctx.createGain();
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // --- UI -------------------------------------------------------------------
  click() {
    this.tone(620, 0.05, { type: 'square', gain: 0.09 });
    this.tone(940, 0.05, { type: 'square', gain: 0.05, delay: 0.03 });
  }

  back() {
    this.tone(420, 0.07, { type: 'square', gain: 0.08, slideTo: 280 });
  }

  // --- gameplay -------------------------------------------------------------
  pickup() {
    this.tone(520, 0.06, { type: 'triangle', gain: 0.1, slideTo: 700 });
    this.noise(0.05, { freq: 2400, gain: 0.03, q: 0.8 });
  }

  /** Landing thud. Heavier cargo lands lower and louder. */
  place(weight: number) {
    const w = Math.max(1, weight);
    const base = 210 - Math.min(w, 6) * 20;
    this.tone(base, 0.13, { type: 'sine', gain: 0.16 + w * 0.02, slideTo: base * 0.55 });
    this.noise(0.09, { freq: 300 + w * 40, freqTo: 120, gain: 0.07 + w * 0.012, q: 0.7 });
  }

  placeHeavy() {
    this.tone(88, 0.26, { type: 'sine', gain: 0.34, slideTo: 46 });
    this.noise(0.2, { filter: 'lowpass', freq: 900, freqTo: 160, gain: 0.2, q: 0.6 });
    this.tone(150, 0.1, { type: 'triangle', gain: 0.1, delay: 0.02, slideTo: 90 });
  }

  placeFragile() {
    this.tone(1760, 0.16, { type: 'sine', gain: 0.1 });
    this.tone(2640, 0.13, { type: 'sine', gain: 0.06, delay: 0.02 });
    this.tone(3520, 0.1, { type: 'sine', gain: 0.035, delay: 0.05 });
    this.noise(0.07, { freq: 5200, gain: 0.035, q: 2 });
  }

  invalid() {
    this.tone(190, 0.11, { type: 'square', gain: 0.12, slideTo: 120 });
  }

  /** Rack timber protesting. Pitch rises as the situation gets worse. */
  creak(intensity: number) {
    const i = Math.min(1, Math.max(0, intensity));
    this.noise(0.42, {
      filter: 'bandpass',
      freq: 260 + i * 220,
      freqTo: 150 + i * 120,
      gain: 0.05 + i * 0.07,
      q: 7,
      attack: 0.1,
    });
    this.tone(70 + i * 30, 0.4, { type: 'sawtooth', gain: 0.018 + i * 0.02, slideTo: 55 });
  }

  warn(step: number) {
    const f = 720 + (step % 3) * 90;
    this.tone(f, 0.07, { type: 'square', gain: 0.1 });
  }

  crack() {
    this.noise(0.13, { freq: 3400, freqTo: 1400, gain: 0.16, q: 3 });
    this.tone(1300, 0.08, { type: 'square', gain: 0.05, slideTo: 700 });
  }

  shatter() {
    this.noise(0.42, { freq: 4200, freqTo: 900, gain: 0.24, q: 1.6 });
    for (let i = 0; i < 5; i++) {
      this.tone(1500 + Math.random() * 2400, 0.11, {
        type: 'sine',
        gain: 0.05,
        delay: 0.02 + i * 0.045,
      });
    }
  }

  collapse() {
    this.noise(0.85, { filter: 'lowpass', freq: 1500, freqTo: 90, gain: 0.4, q: 0.7 });
    this.tone(120, 0.55, { type: 'sawtooth', gain: 0.2, slideTo: 34 });
    for (let i = 0; i < 6; i++) {
      this.tone(90 + Math.random() * 130, 0.18, {
        type: 'sine',
        gain: 0.13,
        delay: 0.06 + i * 0.075,
        slideTo: 45,
      });
    }
    this.noise(0.3, { freq: 2600, freqTo: 800, gain: 0.1, q: 1, delay: 0.1 });
  }

  // --- results --------------------------------------------------------------
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.tone(n, 0.24, { type: 'triangle', gain: 0.17, delay: i * 0.09, release: 0.14 });
      this.tone(n * 2, 0.16, { type: 'sine', gain: 0.05, delay: i * 0.09 });
    });
  }

  star(index: number) {
    const f = [880, 1108, 1318][Math.min(index, 2)];
    this.tone(f, 0.2, { type: 'triangle', gain: 0.16, release: 0.1 });
    this.tone(f * 2, 0.14, { type: 'sine', gain: 0.05 });
  }

  fail() {
    this.tone(320, 0.3, { type: 'sawtooth', gain: 0.14, slideTo: 110 });
    this.tone(240, 0.42, { type: 'sine', gain: 0.1, delay: 0.1, slideTo: 80 });
  }
}

export const audio = new Audio();
