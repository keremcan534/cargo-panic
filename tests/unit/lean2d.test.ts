/**
 * The 2D rack leans on its low-side foot (so it never sinks through the
 * floor), and hit-testing inverts exactly that transform: every slot of every
 * campaign rack, drawn at any lean, resolves back to itself.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_TILT_DEG } from '../../src/game/config';
import { LEVELS } from '../../src/game/levels/levels';
import { leanOffset, rackToWorld, worldToRack } from '../../src/render/canvas2d/lean2d';
import {
  cargoCentreY,
  dragTargetFromLocal,
  layout2d,
  slotCentreX,
  tiltFor,
  toScreen,
  toWorld,
} from '../../src/render/canvas2d/layout2d';

const DEG = Math.PI / 180;
const TILTS = [0, 2 * DEG, -2 * DEG, MAX_TILT_DEG * DEG, -MAX_TILT_DEG * DEG, 26 * DEG, -21 * DEG];

describe('lean pivot', () => {
  test('no lean is the identity', () => {
    assert.deepEqual(leanOffset(0, 3.8), { x: 0, y: 0 });
    assert.deepEqual(rackToWorld({ x: 1.5, y: 2 }, 0, 3.8), { x: 1.5, y: 2 });
  });

  test('the low-side foot stays on the floor and the rack never dips below it', () => {
    for (const hw of [2.83, 3.33, 3.83]) {
      for (const tilt of TILTS) {
        if (tilt === 0) continue;
        const low = tilt > 0 ? -hw : hw;
        const foot = rackToWorld({ x: low, y: 0 }, tilt, hw);
        assert.ok(Math.abs(foot.x - low) < 1e-9 && Math.abs(foot.y) < 1e-9, `foot moved at ${tilt}`);
        const other = rackToWorld({ x: -low, y: 0 }, tilt, hw);
        assert.ok(other.y > 0, 'the high foot lifts');
      }
    }
  });

  test('leans the same way as the shared tilt (heavier right -> top goes right)', () => {
    const tilt = tiltFor(6, 3);
    const top = rackToWorld({ x: 0, y: 5 }, tilt, 3.5);
    assert.ok(top.x > 0);
  });

  test('worldToRack inverts rackToWorld', () => {
    for (const tilt of TILTS) {
      for (const p of [
        { x: 1.3, y: 2.2 },
        { x: -3.1, y: 0.4 },
        { x: 0, y: 6 },
      ]) {
        const back = worldToRack(rackToWorld(p, tilt, 3.83), tilt, 3.83);
        assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
      }
    }
  });
});

describe('hit-testing through the lean', () => {
  const SCREENS: [number, number][] = [
    [360, 640],
    [412, 915],
    [1280, 720],
  ];
  for (const [w, h] of SCREENS) {
    test(`every slot drawn at any play lean resolves to itself (${w}x${h})`, () => {
      let checked = 0;
      for (const level of LEVELS) {
        const maxSlots = Math.max(...level.shelves.map((s) => s.slots));
        const L = layout2d(w, h, level.shelves.length, maxSlots);
        for (const tilt of TILTS.slice(0, 5)) {
          level.shelves.forEach((shelf, tier) => {
            for (const width of [1, 3]) {
              for (let slot = 0; slot + width <= shelf.slots; slot++) {
                const local = { x: slotCentreX(shelf.slots, slot, width), y: cargoCentreY(tier) };
                // Where it is drawn, through the screen and back, the way a pointer sample arrives.
                const world = rackToWorld(local, tilt, L.halfWidth);
                const px = toScreen(L, world.x, world.y);
                const pw = toWorld(L, px.x, px.y);
                const hit = dragTargetFromLocal(level, worldToRack(pw, tilt, L.halfWidth), pw, width);
                assert.deepEqual(hit, { kind: 'slot', shelf: tier, slot }, `L${level.id} t${tier} s${slot} w${width}`);
                checked++;
              }
            }
          });
        }
      }
      assert.ok(checked > 1000);
    });
  }
});
