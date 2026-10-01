/**
 * The trailer's sound, synthesised from code: no samples. A 120 BPM track
 * (kick, snare, hats, bass, pad, a plucked arpeggio) that follows the
 * storyboard's sections, plus whooshes on transitions, clicks on every
 * finger touch, chimes on rewards and an impact when the rack falls - all
 * placed from the same timeline as the picture.
 *
 * Writes a 48 kHz stereo 32-bit float WAV; render.ts normalises it to the
 * loudness target with ffmpeg's loudnorm.
 */

import { writeFileSync } from 'node:fs';
import type { Timeline } from './timeline';

const SR = 48_000;

// --- small DSP kit -------------------------------------------------------------------

/** Seeded noise, so the file is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** A state-variable filter (TPT form); returns low/band/high for each sample. */
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  process(x: number, cutoff: number, q = 0.7) {
    const g = Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return { low: v2, band: v1, high: x - k * v1 - v2 };
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const saw = (ph: number) => 2 * (ph - Math.floor(ph + 0.5));

class Bus {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(readonly n: number) {
    this.l = new Float32Array(n);
    this.r = new Float32Array(n);
  }
  add(i: number, v: number, pan = 0) {
    if (i < 0 || i >= this.n) return;
    this.l[i] += v * Math.cos(((pan + 1) * Math.PI) / 4);
    this.r[i] += v * Math.sin(((pan + 1) * Math.PI) / 4);
  }
}

// --- instruments -----------------------------------------------------------------------

function kick(b: Bus, t: number, gain = 1) {
  const i0 = Math.round(t * SR);
  let ph = 0;
  for (let k = 0; k < SR * 0.45; k++) {
    const s = k / SR;
    const f = 45 + 110 * Math.exp(-s * 38);
    ph += f / SR;
    const env = Math.exp(-s * 7.5);
    const click = k < 90 ? (1 - k / 90) * 0.6 : 0;
    b.add(i0 + k, (Math.sin(2 * Math.PI * ph) * env + click) * 0.95 * gain);
  }
}

function snare(b: Bus, t: number, noise: () => number, gain = 1) {
  const i0 = Math.round(t * SR);
  const f = new SVF();
  for (let k = 0; k < SR * 0.25; k++) {
    const s = k / SR;
    const n = f.process(noise(), 1800, 0.6).high;
    const tone = Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s * 30);
    const v = (n * Math.exp(-s * 16) * 0.55 + tone * 0.4) * gain;
    b.add(i0 + k, v, -0.08);
  }
}

function hat(b: Bus, t: number, noise: () => number, open = false, gain = 1) {
  const i0 = Math.round(t * SR);
  const f = new SVF();
  const len = open ? 0.22 : 0.05;
  for (let k = 0; k < SR * len; k++) {
    const s = k / SR;
    const v = f.process(noise(), 8000, 0.8).high * Math.exp(-s * (open ? 14 : 70)) * 0.22 * gain;
    b.add(i0 + k, v, 0.25);
  }
}

function bassNote(b: Bus, t: number, dur: number, note: number, gain = 1) {
  const i0 = Math.round(t * SR);
  const f = new SVF();
  const hz = midi(note);
  let ph = 0;
  for (let k = 0; k < SR * (dur + 0.05); k++) {
    const s = k / SR;
    ph += hz / SR;
    const env = Math.min(1, s * 400) * (s < dur ? 1 : Math.max(0, 1 - (s - dur) / 0.05));
    const cut = 180 + 1400 * Math.exp(-s * 9);
    const v = f.process(saw(ph), cut, 1.1).low * 0.5 + Math.sin(2 * Math.PI * ph) * 0.45;
    b.add(i0 + k, v * env * 0.55 * gain);
  }
}

function padChord(b: Bus, t: number, dur: number, notes: number[], gain = 1) {
  const i0 = Math.round(t * SR);
  const voices = notes.flatMap((n, vi) =>
    [-0.09, 0, 0.1].map((det, j) => ({ hz: midi(n) * Math.pow(2, det / 12), ph: (vi * 0.37 + j * 0.21) % 1, pan: (j - 1) * 0.6, f: new SVF() })),
  );
  const rel = 0.6;
  for (let k = 0; k < SR * (dur + rel); k++) {
    const s = k / SR;
    const env = Math.min(1, s / 0.35) * (s < dur ? 1 : Math.max(0, 1 - (s - dur) / rel));
    const cut = 900 + 500 * Math.sin(2 * Math.PI * 0.25 * (t + s));
    for (const v of voices) {
      v.ph += v.hz / SR;
      const x = v.f.process(saw(v.ph), cut, 0.8).low;
      b.add(i0 + k, x * env * 0.05 * gain, v.pan);
    }
  }
}

function pluck(b: Bus, t: number, note: number, pan: number, gain = 1) {
  const i0 = Math.round(t * SR);
  const f = new SVF();
  const hz = midi(note);
  let ph = 0;
  for (let k = 0; k < SR * 0.4; k++) {
    const s = k / SR;
    ph += hz / SR;
    const sq = (ph % 1 < 0.5 ? 1 : -1) * 0.6 + saw(ph) * 0.4;
    const v = f.process(sq, 600 + 3500 * Math.exp(-s * 18), 0.9).low * Math.exp(-s * 9) * 0.16 * gain;
    b.add(i0 + k, v, pan);
  }
}

// --- effects ---------------------------------------------------------------------------

function whoosh(b: Bus, t: number, noise: () => number) {
  const len = 0.55;
  const i0 = Math.round((t - len * 0.55) * SR);
  const f = new SVF();
  for (let k = 0; k < SR * len; k++) {
    const u = k / (SR * len);
    const env = Math.sin(Math.PI * Math.pow(u, 0.8)) ** 2;
    const cut = 400 * Math.pow(12, u < 0.6 ? u / 0.6 : 1 - (u - 0.6) / 0.4 * 0.5);
    const v = f.process(noise(), cut, 2.2).band * env * 0.9;
    b.add(i0 + k, v, -0.8 + 1.6 * u);
  }
}

function click(b: Bus, t: number) {
  const i0 = Math.round(t * SR);
  for (let k = 0; k < SR * 0.03; k++) {
    const s = k / SR;
    const v = (Math.sin(2 * Math.PI * 2600 * s) * 0.5 + Math.sin(2 * Math.PI * 1300 * s) * 0.5) * Math.exp(-s * 220) * 0.35;
    b.add(i0 + k, v, 0.1);
  }
}

function chime(b: Bus, t: number) {
  // A major arpeggio on bell tones (FM), up an octave from the track's key.
  [81, 85, 88, 93].forEach((n, j) => {
    const i0 = Math.round((t + j * 0.07) * SR);
    const hz = midi(n);
    for (let k = 0; k < SR * 1.6; k++) {
      const s = k / SR;
      const mod = Math.sin(2 * Math.PI * hz * 3.5 * s) * 2.2 * Math.exp(-s * 6);
      const v = Math.sin(2 * Math.PI * hz * s + mod) * Math.exp(-s * 3.2) * 0.11;
      b.add(i0 + k, v, -0.3 + j * 0.2);
    }
  });
}

function impact(b: Bus, t: number, noise: () => number) {
  const i0 = Math.round(t * SR);
  const f = new SVF();
  let ph = 0;
  for (let k = 0; k < SR * 1.4; k++) {
    const s = k / SR;
    ph += (38 + 60 * Math.exp(-s * 6)) / SR;
    const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-s * 2.6);
    const crash = f.process(noise(), 2500 * Math.exp(-s * 2) + 200, 0.7).low * Math.exp(-s * 5);
    b.add(i0 + k, boom * 0.9 + crash * 0.5);
  }
}

function riser(b: Bus, t: number, dur: number, noise: () => number) {
  const i0 = Math.round(t * SR);
  const f = new SVF();
  let ph = 0;
  for (let k = 0; k < SR * dur; k++) {
    const u = k / (SR * dur);
    ph += (180 * Math.pow(6, u)) / SR;
    const v = f.process(noise(), 300 * Math.pow(25, u), 3).band * 0.5 + Math.sin(2 * Math.PI * ph) * 0.08;
    b.add(i0 + k, v * u * u, 0.4 * Math.sin(u * 12));
  }
}

// --- arrangement ------------------------------------------------------------------------

/** Am - F - C - G, one chord per bar (root MIDI note and chord tones). */
const PROG = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [57, 60, 65] },
  { root: 48, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
];

export function synthesize(tl: Timeline, file: string) {
  const beat = 60 / tl.bpm;
  const dur = tl.duration + 1.5;
  const music = new Bus(Math.ceil(dur * SR));
  const sfx = new Bus(music.n);
  const duck = new Float32Array(music.n).fill(1);
  const noise = rng(7);
  const bars = Math.round(tl.duration / (beat * 4));

  // Sections, in beats (from the storyboard): the drop for the fall, the logo
  // hit, the full groove, the end card.
  const scene = (id: string) => tl.scenes.find((s) => s.id === id)!;
  const fallAt = scene('fall').beat + 1; // the impact
  const logoAt = scene('logo').beat;
  const endAt = scene('end').beat;

  const kickAt = (b: number, g = 1) => {
    kick(music, b * beat, g);
    const i0 = Math.round(b * beat * SR);
    for (let k = 0; k < SR * 0.2; k++) if (i0 + k < duck.length) duck[i0 + k] = Math.min(duck[i0 + k], 0.45 + 0.55 * (k / (SR * 0.2)));
  };

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4;
    const p = PROG[bar % 4];
    const inFall = b0 + 4 > fallAt && b0 < logoAt; // the fall's bar: drums drop at the impact
    const full = b0 >= logoAt + 4 && b0 < endAt;
    const intro = b0 < fallAt - 1;
    const end = b0 >= endAt;

    // Drums
    for (let q = 0; q < 4; q++) {
      const bt = b0 + q;
      if (inFall && bt >= fallAt) continue;
      if (end && q !== 0) continue;
      if (b0 === logoAt && q < 2) continue; // the logo hit rings out
      kickAt(bt, end ? 1.1 : 1);
      if ((intro || full) && (q === 1 || q === 3)) snare(music, bt * beat, noise, 0.9);
      if (!end) for (const h of [0.5, full ? 0.25 : -1, full ? 0.75 : -1]) if (h >= 0) hat(music, (bt + h) * beat, noise, false, h === 0.5 ? 1 : 0.6);
    }
    if (full && bar % 2 === 1) hat(music, (b0 + 3.5) * beat, noise, true, 0.8);
    // A snare roll into the end card.
    if (b0 + 4 === endAt) for (let k = 0; k < 8; k++) snare(music, (b0 + 2 + k * 0.25) * beat, noise, 0.35 + k * 0.08);

    // Bass: eighths on the root, syncopated in the full groove.
    {
      const steps = full ? [0, 0.75, 1.5, 2, 2.75, 3.5] : [0, 1, 2, 3];
      for (const st of steps) {
        const bt = b0 + st;
        if (inFall && bt >= fallAt) continue;
        if (end && st > 0) continue;
        bassNote(music, bt * beat, end ? beat * 4 : beat * 0.42, p.root + (st === 2.75 ? 12 : 0));
      }
    }
    // Pad from the logo on, and under the end card.
    if (b0 >= logoAt) padChord(music, b0 * beat, beat * 4, p.chord, end ? 1.4 : 1);
    // Plucked arpeggio over the montage and the Endless section.
    if (full && bar >= 8) {
      const arp = [...p.chord, p.chord[1] + 12];
      for (let k = 0; k < 8; k++) pluck(music, (b0 + k * 0.5) * beat, arp[k % 4] + 12, k % 2 ? 0.35 : -0.35);
    }
  }
  // The logo hit.
  kickAt(logoAt, 1.2);
  impact(music, logoAt * beat, noise);

  // Effects from the timeline.
  for (const c of tl.cues) {
    if (c.kind === 'whoosh') whoosh(sfx, c.t, noise);
    else if (c.kind === 'click') click(sfx, c.t);
    else if (c.kind === 'chime') chime(sfx, c.t);
    else if (c.kind === 'impact') impact(sfx, c.t, noise);
    else if (c.kind === 'riser') riser(sfx, c.t, (logoAt * beat) - c.t, noise);
    else if (c.kind === 'flash') whoosh(sfx, c.t + 0.1, noise);
  }

  // Mix: sidechain the music on the kick (gentle; the kick itself is in the music bus
  // but its own transient passes before the duck), soft clip, fade out.
  const fadeFrom = tl.duration - 0.2;
  const L = new Float32Array(music.n);
  const R = new Float32Array(music.n);
  for (let i = 0; i < music.n; i++) {
    const s = i / SR;
    const fade = s < fadeFrom ? 1 : Math.max(0, 1 - (s - fadeFrom) / 1.5);
    const d = 0.75 + 0.25 * duck[i];
    L[i] = Math.tanh((music.l[i] * d + sfx.l[i]) * 0.9) * fade;
    R[i] = Math.tanh((music.r[i] * d + sfx.r[i]) * 0.9) * fade;
  }
  writeFloatWav(file, L, R);
}

function writeFloatWav(file: string, L: Float32Array, R: Float32Array) {
  const n = L.length;
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) {
    data.writeFloatLE(L[i], i * 8);
    data.writeFloatLE(R[i], i * 8 + 4);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 8, 28);
  h.writeUInt16LE(8, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}
