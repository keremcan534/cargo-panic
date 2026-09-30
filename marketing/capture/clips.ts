/**
 * The recorded clips: each one boots the real game from a prepared save,
 * plays it with real touch input on the virtual clock, and records frames
 * (JPEG, full phone screen) plus the finger's path. Handles of a few frames
 * are left at both ends for the edit.
 */

import { getLevel } from '../../src/game/levels/levels';
import { getWave } from '../../src/game/levels/generator';
import type { SaveData } from '../../src/game/save/schema';
import { buildSave, type Director, type Target } from './director';
import { campaignActive, campaignSolution, endlessActive, targetOf, waveSolution, type Move } from './setup';

export interface Clip {
  name: string;
  /** What the clip shows (for the storyboard and the README). */
  about: string;
  save: string;
  query?: string;
  /** Called with the game on the pause panel (resumed) or the menu. Records with d.startClip()/endClip(). */
  play: (d: Director) => Promise<void>;
  /** Portrait clips are phone screens; `wide` ones are recorded at a landscape viewport (feature graphic). */
  viewport?: { width: number; height: number };
}

/** CONTINUE from the menu, then RESUME on the "away" panel: the prepared board, playing. */
export async function resume(d: Director) {
  await d.waitFor('.menu [data-role="continue"]');
  await d.tapSelector('.menu [data-role="continue"]');
  await d.waitFor('[data-role="resume"]');
  await d.step(10); // the panel ignores taps while it opens
  await d.tapSelector('[data-role="resume"]');
  await d.until(async () => (await d.page.locator('.modal').count()) === 0, 120, 'pause panel closed');
  await d.step(20);
}

const levelMove = (levelId: number, m: Move): Target => targetOf(getLevel(levelId).packages, m);
const waveMove = (seed: number, wave: number, m: Move): Target => targetOf(getWave(seed, wave).level.packages, m);

function campaignSave(levelId: number, placed: Move[], edit: (s: SaveData) => void = () => undefined) {
  return buildSave((s) => {
    s.active = campaignActive(levelId, placed);
    edit(s);
  });
}

const L25 = campaignSolution(25);
const W = { seed: 12345, wave: 12 };
const W12 = waveSolution(W.seed, W.wave);

export const CLIPS: Clip[] = [
  {
    name: 'hook-l25',
    about: 'Level 25 (3D): a heavy crate, then a box on the other side; the meter swings out and back',
    save: campaignSave(25, L25.slice(0, 4)),
    play: async (d) => {
      await resume(d);
      d.startClip('hook-l25');
      await d.step(6);
      await d.drag(L25[4].id, levelMove(25, L25[4]), 20, 6);
      await d.step(8);
      await d.drag(L25[5].id, levelMove(25, L25[5]), 20, 6);
      await d.step(20);
      d.endClip();
    },
  },
  {
    name: 'tip-fix-l4',
    about: 'Level 4 (3D): a heavy crate on the far right tips the rack (countdown), the second heavy crate on the far left fixes it',
    save: campaignSave(4, []),
    play: async (d) => {
      await resume(d);
      d.startClip('tip-fix-l4');
      await d.step(4);
      await d.drag(0, { shelf: 0, slot: 4, slots: 1 }, 18, 4);
      await d.step(24);
      await d.drag(1, { shelf: 0, slot: 0, slots: 1 }, 18, 4);
      await d.step(36);
      d.endClip();
    },
  },
  {
    name: 'collapse-l4',
    about: 'Level 4 (3D): the heavy crate stays on the far right until the countdown runs out; the rack falls',
    save: campaignSave(4, []),
    play: async (d) => {
      await resume(d);
      await d.drag(0, { shelf: 0, slot: 4, slots: 1 }, 14, 2);
      await d.step(45); // most of the 3 s countdown, off camera
      d.startClip('collapse-l4');
      await d.until(async () => (await d.page.locator('.modal .headline').count()) > 0, 240, 'loss panel');
      await d.step(30);
      d.endClip();
    },
  },
  {
    name: 'heavy-l14',
    about: 'Level 14 (3D): a heavy crate lands on the bottom shelf',
    save: campaignSave(14, campaignSolution(14).slice(0, 1)),
    play: async (d) => {
      await resume(d);
      const m = campaignSolution(14)[1];
      d.startClip('heavy-l14');
      await d.step(4);
      await d.drag(m.id, levelMove(14, m), 16, 4);
      await d.step(24);
      d.endClip();
    },
  },
  {
    name: 'fragile-l8',
    about: 'Level 8 (3D): a heavy crate straight above a fragile one - it cracks, then shatters',
    save: campaignSave(8, [{ id: 0, shelf: 0, slot: 2 }]),
    play: async (d) => {
      await resume(d);
      d.startClip('fragile-l8');
      await d.step(4);
      await d.drag(1, { shelf: 1, slot: 2, slots: 1 }, 16, 4);
      await d.until(async () => (await d.page.locator('.modal .headline').count()) > 0, 300, 'loss panel');
      await d.step(10);
      d.endClip();
    },
  },
  {
    name: 'long-l12',
    about: 'Level 12 (3D): a long package lights all three cells it will take, then the level is finished and cleared',
    save: campaignSave(12, []),
    play: async (d) => {
      await resume(d);
      const sol = campaignSolution(12);
      d.startClip('long-l12');
      await d.step(4);
      for (const m of sol) {
        await d.drag(m.id, levelMove(12, m), 20, 8);
        await d.step(6);
      }
      await d.until(async () => (await d.page.locator('.modal .stars').count()) > 0, 300, 'win panel');
      await d.step(60);
      d.endClip();
    },
  },
  {
    name: 'priority-l16',
    about: 'Level 16 (3D): a priority crate into the gold zone',
    save: campaignSave(16, []),
    play: async (d) => {
      await resume(d);
      const m = campaignSolution(16)[0];
      d.startClip('priority-l16');
      await d.step(4);
      await d.drag(m.id, levelMove(16, m), 18, 6);
      await d.step(24);
      d.endClip();
    },
  },
  {
    name: 'tap-l15',
    about: 'Level 15 (3D): tap a box to select it, finger down on a slot shows the target, lift to place',
    save: campaignSave(15, campaignSolution(15).slice(0, 2)),
    play: async (d) => {
      await resume(d);
      const m = campaignSolution(15)[2];
      d.startClip('tap-l15');
      await d.step(16);
      await d.tap(await d.pointOf({ cargo: m.id }), 3);
      await d.step(10);
      const t = levelMove(15, m);
      await d.down(await d.pointOf(t));
      await d.until(async () => (await d.aimed()) !== null, 30, 'tap target shown');
      await d.step(10);
      await d.up();
      await d.step(40);
      d.endClip();
    },
  },
  {
    name: 'endless-w12',
    about: 'Endless Shift, seed 12345 wave 12 (3D): the last box, SHIPMENT DISPATCHED with the score lines, then wave 13 is dealt',
    save: buildSave((s) => (s.active = endlessActive(W.seed, W.wave, W12.slice(0, W12.length - 1), 18450))),
    play: async (d) => {
      await resume(d);
      const m = W12[W12.length - 1];
      d.startClip('endless-w12');
      await d.step(4);
      await d.drag(m.id, waveMove(W.seed, W.wave, m), 18, 6);
      await d.until(async () => (await d.page.locator('.hud .title').innerText()) === 'WAVE 13', 600, 'wave 13');
      await d.step(30);
      d.endClip();
    },
  },
  ...(['3d', '2d'] as const).map<Clip>((mode) => ({
    name: `views-${mode}`,
    about: `Level 25 in ${mode.toUpperCase()}: the same board and the same move as the other view`,
    save: campaignSave(25, L25.slice(0, 6), (s) => (s.settings.renderMode = mode)),
    play: async (d) => {
      await resume(d);
      d.startClip(`views-${mode}`);
      await d.step(4);
      await d.drag(L25[6].id, levelMove(25, L25[6]), 20, 6);
      await d.step(30);
      d.endClip();
    },
  })),
];
