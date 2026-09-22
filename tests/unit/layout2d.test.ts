/**
 * 2D front-view geometry: every legal slot of every campaign level round-trips
 * through the hit-test, the lean is reversible, and the play block fits the
 * same screen band as the 3D framing on small, tall and wide screens.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { W3 } from '../../src/game/config';
import { LEVELS } from '../../src/game/levels/levels';
import {
  BELT_2D,
  cargoCentreY,
  dragTargetFromLocal,
  fromRackLocal,
  layout2d,
  nearestShelf,
  slotCentreX,
  tapTargetFromLocal,
  targetFromLocal,
  tiltFor,
  toRackLocal,
  toScreen,
  toWorld,
} from '../../src/render/canvas2d/layout2d';
import { FRAME_BAND } from '../../src/render/layout';

describe('hit-testing', () => {
  test('every slot centre of every campaign level maps back to itself', () => {
    let checked = 0;
    for (const level of LEVELS) {
      level.shelves.forEach((shelf, tier) => {
        for (const width of [1, 3]) {
          for (let slot = 0; slot + width <= shelf.slots; slot++) {
            const cx = slotCentreX(shelf.slots, slot, width);
            const cy = cargoCentreY(tier);
            for (const [dx, dy] of [
              [0, 0],
              [0.4, 0],
              [-0.4, 0],
              [0, 0.55],
              [0, -0.55],
            ]) {
              const hit = targetFromLocal(level, { x: cx + dx, y: cy + dy }, width);
              assert.deepEqual(hit, { shelf: tier, slot }, `L${level.id} t${tier} s${slot} w${width} d${dx},${dy}`);
              checked++;
            }
          }
        }
      });
    }
    assert.ok(checked > 1000);
  });

  test('points well outside the rack are not targets', () => {
    const level = LEVELS[0];
    assert.equal(nearestShelf(level, 0, -2), -1);
    assert.equal(nearestShelf(level, 9, cargoCentreY(0)), -1);
    assert.equal(targetFromLocal(level, { x: 0, y: 20 }, 1), null);
  });

  test('a long package is clamped to fit, never hangs off the shelf', () => {
    const level = LEVELS.find((l) => l.packages.includes('long'))!;
    const hit = targetFromLocal(level, { x: level.shelves[0].slots / 2 + 0.4, y: cargoCentreY(0) }, 3);
    assert.ok(hit);
    assert.ok(hit.slot + 3 <= level.shelves[hit.shelf].slots);
  });
});

describe('lean', () => {
  test('leans the same way as the 3D rack and clamps at the maximum', () => {
    assert.ok(tiltFor(3, 4) < 0, 'heavier right -> top leans right (clockwise)');
    assert.ok(tiltFor(-3, 4) > 0);
    assert.equal(tiltFor(100, 4), tiltFor(8, 4));
  });

  test('rack-local conversion is reversible', () => {
    for (const t of [-0.13, -0.02, 0, 0.05, 0.13]) {
      for (const p of [
        { x: 1.3, y: 2.2 },
        { x: -3.1, y: 0.4 },
      ]) {
        const back = toRackLocal(fromRackLocal(p, t), t);
        assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
      }
    }
  });

  test('a tilted rack still hit-tests the slot under the cargo', () => {
    const level = LEVELS[24];
    const tilt = tiltFor(level.balanceTolerance * 2, level.balanceTolerance);
    const tier = level.shelves.length - 1;
    const local = { x: slotCentreX(level.shelves[tier].slots, 1, 1), y: cargoCentreY(tier) };
    const world = fromRackLocal(local, tilt);
    assert.deepEqual(targetFromLocal(level, toRackLocal(world, tilt), 1), { shelf: tier, slot: 1 });
  });
});

describe('layout', () => {
  const screens: [string, number, number][] = [
    ['small phone', 360, 640],
    ['tall phone', 390, 844],
    ['long android', 412, 915],
    ['tablet', 820, 1180],
    ['desktop', 1280, 720],
  ];
  for (const [name, w, h] of screens) {
    test(`fits the play band on a ${name} (${w}x${h})`, () => {
      for (const [tiers, slots] of [
        [1, 5],
        [2, 7],
        [4, 7],
      ]) {
        const L = layout2d(w, h, tiers, slots);
        const top = toScreen(L, 0, L.rackTop).y;
        const bottom = toScreen(L, 0, BELT_2D.topY - BELT_2D.height).y;
        const left = toScreen(L, -L.halfWidth, 0).x;
        const right = toScreen(L, L.halfWidth, 0).x;
        assert.ok(top >= FRAME_BAND.top * h - 1, `${tiers}x${slots}: top ${top}`);
        assert.ok(Math.abs(bottom - FRAME_BAND.bottom * h) < 1, `${tiers}x${slots}: belt pinned`);
        assert.ok(left >= FRAME_BAND.side * w - 1 && right <= w - FRAME_BAND.side * w + 1);
        assert.ok(L.scale * W3.cargoH >= 20, 'packages stay a touchable size');
      }
    });
  }

  test('screen <-> world round-trips', () => {
    const L = layout2d(390, 844, 3, 7);
    const p = toWorld(L, ...(Object.values(toScreen(L, 1.25, 2.5)) as [number, number]));
    assert.ok(Math.abs(p.x - 1.25) < 1e-9 && Math.abs(p.y - 2.5) < 1e-9);
  });
});

describe('belt vs slot precedence', () => {
  test('a lifted package over any bottom-shelf slot resolves to that slot, never the belt', () => {
    for (const level of LEVELS) {
      const shelf = level.shelves[0];
      for (const width of [1, 3]) {
        for (let slot = 0; slot + width <= shelf.slots; slot++) {
          const centre = { x: slotCentreX(shelf.slots, slot, width), y: cargoCentreY(0) };
          const t = dragTargetFromLocal(level, centre, centre, width);
          assert.deepEqual(t, { kind: 'slot', shelf: 0, slot }, `L${level.id} s${slot} w${width}`);
        }
      }
    }
  });

  test('a package dragged down over the belt resolves to the belt', () => {
    const level = LEVELS[6];
    const onBelt = { x: -1, y: BELT_2D.topY + W3.cargoH / 2 };
    assert.deepEqual(dragTargetFromLocal(level, onBelt, onBelt, 1), { kind: 'belt' });
  });

  test('a tap on the belt band is the belt; a tap on a shelf is the slot', () => {
    const level = LEVELS[6];
    const belt = { x: 0, y: -0.4 };
    assert.deepEqual(tapTargetFromLocal(level, belt, belt, 1), { kind: 'belt' });
    const onShelf = { x: slotCentreX(level.shelves[0].slots, 2, 1), y: cargoCentreY(0) };
    assert.deepEqual(tapTargetFromLocal(level, onShelf, onShelf, 1), { kind: 'slot', shelf: 0, slot: 2 });
  });
});
