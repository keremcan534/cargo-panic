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
import { HERO_GAP } from '../../src/render/hero';
import type { ScreenRect } from '../../src/render/Stage';
import { Tweens } from '../../src/render/Tween';
import { menuBackdrop } from '../../src/render/three/backdrops';
import { applyFraming, CAMERA_FOV } from '../../src/render/three/Framing';
import { ThreeGameView } from '../../src/render/three/ThreeGameView';
import type { FramingAdjust, ThreeStage } from '../../src/render/three/ThreeStage';
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

/** What the views and backdrops use of a ThreeStage, on a 360 x 640 screen. */
class FakeStage {
  tweens = new Tweens();
  scene = new THREE.Scene();
  reducedMotion = false;
  particles = { emit() {} };
  updaters = new Set<(dtMs: number) => void>();
  heroProbe: (() => ScreenRect | null) | null = null;
  viewSize = { width: 360, height: 640 };
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 360 / 640, 0.1, 120);
  private framing: { tiers: number; maxSlots: number; adjust?: FramingAdjust } = { tiers: 2, maxSlots: 5 };
  /** As ThreeStage.frame: a plain lens, the solved framing, then the caller's adjustment. */
  frame(tiers: number, maxSlots: number, adjust?: FramingAdjust) {
    this.framing = { tiers, maxSlots, adjust };
    this.camera.zoom = 1;
    this.camera.clearViewOffset();
    applyFraming(this.camera, this.viewSize.width / this.viewSize.height, tiers, maxSlots);
    adjust?.(this.camera);
  }
  reframe() {
    this.frame(this.framing.tiers, this.framing.maxSlots, this.framing.adjust);
  }
  shake() {}
  onRender(fn: (dtMs: number) => void) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }
  reportHero(probe: () => ScreenRect | null) {
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

  test('the hero rack is framed into the free band: left alone when it fits, else shrunk, else hidden', () => {
    const stage = new FakeStage();
    stage.reducedMotion = true; // upright, so its centre line is the screen's
    const backdrop = menuBackdrop(stage.asStage);
    const drawn = () => stage.heroProbe!();
    const close = (a: ScreenRect | null, b: ScreenRect, what: string) => {
      assert.ok(a, what);
      for (const k of ['x', 'y', 'w', 'h'] as const) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${what}: ${k} ${a[k]} vs ${b[k]}`);
    };
    const natural = drawn()!;
    assert.ok(natural.w > 300 && natural.h > 120, 'no band yet: the rack at its natural size');

    // A band with room around it (tall phones): the camera is not touched.
    backdrop.setHeroBand!({ top: natural.y - 40, bottom: natural.y + natural.h + 40 });
    close(drawn(), natural, 'room to spare');
    assert.equal(stage.camera.zoom, 1);

    // 360 x 640 without CONTINUE: the tagline ends at 216, the stars chip starts at 323.
    const band = { top: 216, bottom: 323 };
    backdrop.setHeroBand!(band);
    const r = drawn()!;
    assert.ok(r, 'still shown');
    assert.ok(r.y >= band.top + HERO_GAP - 1 && r.y + r.h <= band.bottom - HERO_GAP + 1, `inside the band: ${JSON.stringify(r)}`);
    assert.ok(r.h < natural.h * 0.75, 'smaller');
    assert.ok(Math.abs(r.x + r.w / 2 - (natural.x + natural.w / 2)) < 1, 'on the same centre line');

    // With CONTINUE the band is 43 px: too small to read the rack in, so it is not drawn.
    backdrop.setHeroBand!({ top: 216, bottom: 259 });
    assert.equal(drawn(), null);

    // Band gone (a resize re-frames the same way): back as it was.
    backdrop.setHeroBand!(null);
    close(drawn(), natural, 'no band again');
    assert.equal(stage.camera.zoom, 1);
    assert.ok(!stage.camera.view?.enabled, 'no view offset left behind');
    backdrop.dispose();
  });
});
