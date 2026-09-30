/**
 * Resolves the storyboard against the recorded clips: where each clip's
 * frame 0 sits on the video clock, which finger events are on screen (tap
 * rings and click sounds), and every sound cue. The compose page and the
 * audio synth both read this one timeline, so picture and sound agree.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKETING } from './capture/director';
import type { FrameLog } from './capture/director';
import { BEAT_S, SCENES, TOTAL_BEATS, type Anchor, type Scene } from './storyboard';

export interface ClipInfo {
  fps: number;
  frames: number;
  log: FrameLog[];
}

export interface Placed {
  clip: string;
  /** Video time (s) at which the clip's frame 0 is shown. */
  t0: number;
  frames: number;
  fps: number;
}

export interface Cue {
  t: number;
  kind: 'whoosh' | 'click' | 'chime' | 'impact' | 'riser' | 'flash';
}

export interface Ring {
  /** Video time of the touch, where on the phone screen (CSS px), and which scene draws it. */
  t: number;
  x: number;
  y: number;
  scene: string;
  side?: 'left' | 'right';
}

export interface Timeline {
  duration: number;
  bpm: number;
  scenes: (Scene & { t: number; end: number; placed: Placed[] })[];
  cues: Cue[];
  rings: Ring[];
  /** Finger positions per clip frame, for the finger dot in card scenes. */
  fingers: Record<string, ({ x: number; y: number } | null)[]>;
  menus: { phone: { width: number; height: number }; taps: Record<string, { x: number; y: number; width: number; height: number }> } | null;
}

export function loadClip(name: string): ClipInfo {
  const f = join(MARKETING, 'out', 'clips', name, 'clip.json');
  if (!existsSync(f)) throw new Error(`clip ${name} is not recorded yet (npx tsx marketing/capture.ts ${name})`);
  const c = JSON.parse(readFileSync(f, 'utf8')) as ClipInfo;
  // A lift with no touch before it in the clip belongs to a tap made before recording started.
  let down = false;
  for (const e of c.log) {
    if (e.event === 'down') down = true;
    else if (e.event === 'up' && !down) delete e.event;
    else if (e.event === 'up') down = false;
  }
  return c;
}

function place(a: Anchor): Placed {
  const c = loadClip(a.clip);
  let frame: number;
  if ('frame' in a) frame = a.frame;
  else {
    const hits = c.log.filter((e) => e.event === a.event);
    const e = hits[a.nth - 1];
    if (!e) throw new Error(`${a.clip}: no ${a.event} #${a.nth} (has ${hits.length})`);
    frame = e.i;
  }
  return { clip: a.clip, t0: a.beat * BEAT_S - frame / c.fps, frames: c.frames, fps: c.fps };
}

export function buildTimeline(): Timeline {
  const cues: Cue[] = [];
  const rings: Ring[] = [];
  const fingers: Timeline['fingers'] = {};
  const menusFile = join(MARKETING, 'out', 'menus', 'menus.json');
  const menus = existsSync(menusFile) ? (JSON.parse(readFileSync(menusFile, 'utf8')) as Timeline['menus']) : null;

  const scenes = SCENES.map((s) => {
    const t = s.beat * BEAT_S;
    const end = (s.beat + s.beats) * BEAT_S;
    const placed: Placed[] = [];
    const L = s.layout;
    if (L.kind === 'card') placed.push(place(L.anchor));
    if (L.kind === 'pair') placed.push(place(L.left), place(L.right));

    // Transitions: a whoosh into every whip and wipe, a flash cue for flashes.
    if (s.enter === 'whip' || s.enter === 'wipe') cues.push({ t: t - 0.18, kind: 'whoosh' });
    if (s.enter === 'flash') cues.push({ t, kind: 'flash' });
    for (const h of s.hits ?? []) cues.push({ t: h.beat * BEAT_S, kind: h.kind });

    // Finger touches that are on screen in this scene: rings and clicks.
    for (const p of placed.slice(0, 1)) {
      const c = loadClip(p.clip);
      fingers[p.clip] = c.log.map((e) => e.finger);
      for (const e of c.log) {
        if (!e.event || !e.finger) continue;
        const tt = p.t0 + e.i / c.fps;
        if (tt < t || tt >= end) continue;
        cues.push({ t: tt, kind: 'click' });
        if (e.event === 'down') rings.push({ t: tt, x: e.finger.x, y: e.finger.y, scene: s.id });
      }
    }
    for (const p of placed.slice(1)) fingers[p.clip] = loadClip(p.clip).log.map((e) => e.finger);
    if (L.kind === 'phone' && menus) {
      for (const sc of L.screens) {
        if (!sc.tap) continue;
        const r = menus.taps[sc.tap.target];
        const tt = sc.tap.beat * BEAT_S;
        rings.push({ t: tt, x: r.x + r.width / 2, y: r.y + r.height / 2, scene: s.id });
        cues.push({ t: tt, kind: 'click' });
      }
    }
    return { ...s, t, end, placed };
  });

  cues.sort((a, b) => a.t - b.t);
  return { duration: TOTAL_BEATS * BEAT_S, bpm: 60 / BEAT_S, scenes, cues, rings, fingers, menus };
}
