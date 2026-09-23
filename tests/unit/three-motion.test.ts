/**
 * The 3D world's motion and outline rules, headless. three.js scene objects
 * work in node; the procedural canvas textures get a stand-in 2D context that
 * accepts every call (nothing is drawn or rendered here). A fake stage drives
 * the view's update and the shared tweens the way the frame loop does.
 *
 * - Reduced motion switched on mid-shipment stops the judder, glow and rim
 *   pulses already running (the 2D view reads it every frame; 3D restyles).
 * - A spotlit package that has faded out (a shattered fragile crate) shows no
 *   rim: with no box covering its middle it would be a solid gold block.
 * - The title rack sways only without reduced motion and follows a change at once.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as THREE from 'three';
import type { LevelDef } from '../../src/game/levels/types';
import { evaluate } from '../../src/game/systems/BalanceSystem';
import type { Placement } from '../../src/game/systems/BalanceSystem';
import type { BoardView } from '../../src/render/GameView';
import { Tweens } from '../../src/render/Tween';
import { menuBackdrop } from '../../src/render/three/backdrops';
import { ThreeGameView } from '../../src/render/three/ThreeGameView';
import type { ThreeStage } from '../../src/render/three/ThreeStage';
import type { Shelf3D } from '../../src/render/three/world/Shelf3D';

/** A 2D context that takes any call or property and draws nothing. */
function fakeContext(): unknown {
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 2 });
      return () => new Proxy({}, handler);
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  };
  return new Proxy({}, handler);
}

(globalThis as { document?: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeContext() }),
};

/** What the views and backdrops use of a ThreeStage. */
class FakeStage {
  tweens = new Tweens();
  scene = new THREE.Scene();
  reducedMotion = false;
  particles = { emit() {} };
  updaters = new Set<(dtMs: number) => void>();
  heroProbe: (() => unknown) | null = null;
  frame() {}
  shake() {}
  onRender(fn: (dtMs: number) => void) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }
  reportHero(probe: () => unknown) {
    this.heroProbe = probe;
    return () => {
      if (this.heroProbe === probe) this.heroProbe = null;
    };
  }
  get asStage() {
    return this as unknown as ThreeStage;
  }
}

/** A fragile crate under a heavy one (crushed) on a top shelf rated 4 (overloaded); a box on the belt. */
const LEVEL: LevelDef = {
  id: 950,
  name: 'TEST MOTION',
  objective: '',
  shelves: [
    { slots: 5, maxWeight: 20 },
    { slots: 5, maxWeight: 4 },
  ],
  packages: ['fragile', 'heavy', 'standard'],
  balanceTolerance: 20,
};
const PLACED: Placement[] = [
  { id: 0, type: 'fragile', shelf: 0, slot: 2 },
  { id: 1, type: 'heavy', shelf: 1, slot: 2 },
];

function mountView(stage: FakeStage) {
  const evaluation = evaluate(LEVEL, PLACED);
  assert.deepEqual([evaluation.crushed, evaluation.overloaded], [[0], [1]], 'the test board is crushed and overloaded');
  const board: BoardView = { level: LEVEL, queue: [2], placements: PLACED, evaluation, held: null, wobble: false };
  const view = new ThreeGameView(stage.asStage);
  view.mount(board);
  return view;
}

/** The box mesh of a package (it carries the cargo id; its first child is the rim shell). */
function bodyOf(stage: FakeStage, id: number): THREE.Mesh {
  let body: THREE.Mesh | null = null;
  stage.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.cargoId === id) body = o as THREE.Mesh;
  });
  assert.ok(body, `package ${id} is in the scene`);
  return body;
}

const rimOf = (stage: FakeStage, id: number) => bodyOf(stage, id).children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

/** Samples a value over ~0.6 s of view frames and says whether it moved. */
function moves(stage: FakeStage, view: ThreeGameView, read: () => number): boolean {
  const seen: number[] = [];
  for (let i = 0; i < 16; i++) {
    view.update(37);
    stage.tweens.update(37);
    seen.push(read());
  }
  return Math.max(...seen) - Math.min(...seen) > 1e-3;
}

describe('3D reduced motion', () => {
  test('switched on mid-shipment, it stops the judder, glow and selection pulse already running; off, they return', () => {
    const stage = new FakeStage();
    const view = mountView(stage);
    view.setSelected(2);
    const topShelf = (view as unknown as { rack: { shelves: Shelf3D[] } }).rack.shelves[1];
    const judder = () => bodyOf(stage, 0).rotation.z;
    const glow = () => (topShelf as unknown as { glowMat: THREE.MeshBasicMaterial }).glowMat.opacity;
    const rim = () => rimOf(stage, 2).material.opacity;
    assert.ok(moves(stage, view, judder) && moves(stage, view, glow) && moves(stage, view, rim), 'all three pulse');

    stage.reducedMotion = true;
    assert.equal(moves(stage, view, judder), false, 'no judder');
    assert.equal(judder(), 0);
    assert.equal(moves(stage, view, glow), false, 'a steady glow');
    assert.equal(glow(), 0.45);
    assert.equal(moves(stage, view, rim), false, 'a steady rim');
    assert.equal(rim(), 0.95);
    assert.equal(rimOf(stage, 2).visible, true);

    stage.reducedMotion = false;
    assert.ok(moves(stage, view, judder) && moves(stage, view, glow) && moves(stage, view, rim), 'all three pulse again');
    view.dispose();
  });
});

describe('3D loss highlight', () => {
  test('a shattered, spotlit fragile crate leaves no solid rim; the crusher keeps its outline', () => {
    const stage = new FakeStage();
    const view = mountView(stage);
    view.failFragile(0);
    view.highlight({ cargo: 0, others: [1] });
    for (let i = 0; i < 10; i++) stage.tweens.update(40);
    assert.ok(bodyOf(stage, 0).visible, 'the faded crate is still in the scene');
    assert.equal(rimOf(stage, 0).visible, false, 'no rim where nothing covers its middle');
    assert.equal(rimOf(stage, 1).visible, true, 'the crusher is outlined');

    // Highlighted again later (a restyle): still no block.
    view.highlight({ cargo: 0, others: [1] });
    assert.equal(rimOf(stage, 0).visible, false);
    assert.equal(rimOf(stage, 1).visible, true);
    view.dispose();
  });
});

describe('3D title backdrop', () => {
  test('the hero rack sways only without reduced motion, and follows a change at once', () => {
    const stage = new FakeStage();
    stage.reducedMotion = true;
    const backdrop = menuBackdrop(stage.asStage);
    let rack: THREE.Object3D | null = null;
    stage.scene.traverse((o) => {
      if (!rack && o.userData.cargoId !== undefined && o.parent) rack = o.parent;
    });
    assert.ok(rack);
    const tilt = () => (rack as unknown as THREE.Object3D).rotation.z;
    const tilts = () => {
      const out: number[] = [];
      for (let i = 0; i < 12; i++) {
        for (const u of stage.updaters) u(270);
        stage.tweens.update(270);
        out.push(tilt());
      }
      return out;
    };

    assert.deepEqual(new Set(tilts()), new Set([0]), 'level and still');
    stage.reducedMotion = false;
    const swaying = tilts();
    assert.ok(Math.max(...swaying) - Math.min(...swaying) > 0.01, 'sways');
    assert.ok(swaying.every((z) => Math.abs(z) <= 0.02 + 1e-9), 'by at most 0.02 rad');
    stage.reducedMotion = true;
    assert.deepEqual(new Set(tilts()), new Set([0]), 'level again at once');

    backdrop.dispose();
    assert.equal(stage.updaters.size, 0, 'the per-frame hook goes with it');
    assert.equal(stage.heroProbe, null, 'and so does its test probe');
  });
});
