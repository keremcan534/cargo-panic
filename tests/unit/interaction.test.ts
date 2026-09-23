/**
 * The pointer state machine against a real GameSession and a fake view.
 * Pointer events are plain objects; the fake view reports whatever pick and
 * drop target a test sets, and records every call it gets.
 *
 * Drag and tap-select must end in the same session commands: every test that
 * commits checks the session, not just the calls the view got.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { LevelDef } from '../../src/game/levels/types';
import { GameSession, campaignStars } from '../../src/game/session';
import type { ShipmentSnapshot } from '../../src/game/session';
import { DRAG_HOLD_MS, InteractionController } from '../../src/input/InteractionController';
import type { InteractionHooks, PointerInput } from '../../src/input/InteractionController';
import type {
  BoardView,
  ClientPoint,
  DispatchCallbacks,
  DropTarget,
  GameView,
  PointerSample,
  ViewHighlight,
} from '../../src/render/GameView';
import type { TargetKind } from '../../src/game/session/types';

/** One 5-slot shelf; a heavy crate at the edge tips it (torque 10 > 4). */
const TIP: LevelDef = {
  id: 900,
  name: 'TEST TIP',
  objective: '',
  shelves: [{ slots: 5, maxWeight: 20 }],
  packages: ['heavy', 'standard', 'standard'],
  balanceTolerance: 4,
};

class FakeView implements GameView {
  readonly mode = '2d' as const;
  calls: string[] = [];
  pick: number | null = null;
  target: DropTarget | null = null;

  mount(_b: BoardView) {
    this.calls.push('mount');
  }
  sync(_b: BoardView) {
    this.calls.push('sync');
  }
  update(_dt: number) {}
  dispose() {}
  pickCargo(_p: PointerSample, candidates: readonly number[]) {
    this.calls.push(`pick:${candidates.join(',')}`);
    return this.pick !== null && candidates.includes(this.pick) ? this.pick : null;
  }
  beginDrag(id: number, p: PointerSample) {
    this.calls.push(`beginDrag:${id}:${p.touch ? 'touch' : 'mouse'}`);
  }
  moveDrag(p: PointerSample) {
    this.calls.push(`moveDrag:${p.clientX},${p.clientY}`);
  }
  dragTarget() {
    return this.target;
  }
  targetAt(_p: PointerSample, _slots: number) {
    return this.target;
  }
  endDrag() {
    this.calls.push('endDrag');
  }
  showGhost(t: { shelf: number; slot: number }, slots: number, kind: TargetKind) {
    this.calls.push(`ghost:${t.shelf}:${t.slot}:${slots}:${kind}`);
  }
  hideGhost() {
    this.calls.push('hideGhost');
  }
  setBeltHover(on: boolean) {
    this.calls.push(`belt:${on}`);
  }
  setSelected(id: number | null) {
    this.calls.push(`select:${id}`);
  }
  showHint(_id: number, _t: { shelf: number; slot: number }) {}
  clearHint() {}
  highlight(_h: ViewHighlight) {}
  cargoPlaced(id: number, t: { shelf: number; slot: number }, opts: { quiet: boolean; onLanded?: () => void }) {
    this.calls.push(`cargoPlaced:${id}:${t.shelf}:${t.slot}:${opts.quiet ? 'quiet' : 'loud'}`);
    opts.onLanded?.();
  }
  cargoToBelt(id: number) {
    this.calls.push(`cargoToBelt:${id}`);
  }
  cargoReturn(id: number) {
    this.calls.push(`cargoReturn:${id}`);
  }
  celebrate() {}
  dispatch(_cb?: DispatchCallbacks) {}
  failCollapse(_d: number) {}
  failOverload(_t: number, _d: number) {}
  failFragile(_id: number) {}
  clientPointOf(): ClientPoint | null {
    return null;
  }

  /** Calls matching a prefix, e.g. 'cargo' for every transition. */
  only(prefix: string) {
    return this.calls.filter((c) => c.startsWith(prefix));
  }
}

type Listener = (e: Event) => void;

class FakeSurface {
  listeners = new Map<string, Set<Listener>>();
  captured = new Set<number>();
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  emit(type: string, e: Partial<PointerInput> = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e as unknown as Event);
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

function recorder() {
  const log: string[] = [];
  const hooks: InteractionHooks = {
    grabbed: (id) => log.push(`grabbed:${id}`),
    preview: (net) => log.push(`preview:${net === null ? 'none' : net}`),
    beltHover: (on) => log.push(`beltHover:${on}`),
    rejected: (reason) => log.push(`rejected:${reason}`),
    placed: (id, quiet, from) => log.push(`placed:${id}:${quiet}:${from.at}`),
    landed: (id) => log.push(`landed:${id}`),
    toBelt: (id) => log.push(`toBelt:${id}`),
    selected: (id) => log.push(`selected:${id}`),
  };
  return { log, hooks };
}

const ptr = (pointerId: number, pointerType = 'mouse'): PointerInput => ({
  pointerId,
  clientX: 100 + pointerId,
  clientY: 200,
  pointerType,
});

/** A press that then travels past the drag slop, as every real drag does. */
function press(pointerId: number, pointerType = 'mouse') {
  ctl.down(ptr(pointerId, pointerType));
  ctl.move({ ...ptr(pointerId, pointerType), clientX: 100 + pointerId + 30 });
}

let session: GameSession;
let view: FakeView;
let surface: FakeSurface;
let blur: FakeSurface;
let doc: FakeSurface & { visibilityState: string };
let clock: { now: number };
let log: string[];
let ctl: InteractionController;

function board() {
  return JSON.stringify([session.placements, session.queue, session.evaluation]);
}

/** Picks `id`, aims at `target`, lets the controller show it, releases. */
function drag(id: number, target: DropTarget | null, pointerId = 1) {
  view.pick = id;
  press(pointerId);
  view.target = target;
  ctl.update();
  ctl.up(ptr(pointerId));
}

function setup(level: LevelDef = TIP, undoAllowance = 0) {
  session = new GameSession(level, { source: { mode: 'campaign', levelId: level.id }, undoAllowance });
  view = new FakeView();
  surface = new FakeSurface();
  blur = new FakeSurface();
  doc = Object.assign(new FakeSurface(), { visibilityState: 'visible' });
  clock = { now: 1000 };
  const r = recorder();
  log = r.log;
  ctl = new InteractionController({
    surface,
    session,
    view,
    hooks: r.hooks,
    blurTarget: blur,
    visibilityTarget: doc,
    now: () => clock.now,
  });
  ctl.attach();
}

beforeEach(() => setup());

describe('InteractionController', () => {
  test('picking a package up only holds it: board and belt are untouched', () => {
    const before = board();
    view.pick = 0;
    press(1, 'touch');
    assert.equal(session.held, 0);
    assert.equal(ctl.holding, 0);
    assert.equal(board(), before);
    assert.deepEqual(view.only('beginDrag'), ['beginDrag:0:touch']);
    assert.ok(surface.captured.has(1), 'the active pointer is captured');
    assert.deepEqual(log, ['grabbed:0']);
  });

  test('dragging the belt package onto a legal slot commits exactly one move', () => {
    view.pick = 0;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    assert.ok(view.calls.includes('ghost:0:2:1:ok'));
    assert.ok(log.includes('preview:0'));
    ctl.up(ptr(1));

    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
    assert.deepEqual(session.queue, [1, 2]);
    assert.equal(session.held, null);
    assert.equal(session.rejectedDrops, 0);
    // endDrag, then the one transition, then the controller is told to sync.
    const endAt = view.calls.indexOf('endDrag');
    const placedAt = view.calls.indexOf('cargoPlaced:0:0:2:loud');
    assert.ok(endAt >= 0 && placedAt > endAt);
    assert.deepEqual(view.only('cargo'), ['cargoPlaced:0:0:2:loud']);
    assert.deepEqual(
      log.filter((l) => l.startsWith('placed') || l.startsWith('landed')),
      ['landed:0', 'placed:0:false:belt'],
    );
    assert.equal(surface.captured.size, 0, 'capture released');
  });

  test('an illegal slot changes nothing, reports the reason and sends the package back', () => {
    session.move(0, 0, 2);
    const before = board();
    view.pick = 1;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    assert.ok(view.calls.includes('ghost:0:2:1:bad'));
    ctl.up(ptr(1));

    assert.equal(board(), before);
    assert.equal(session.held, null);
    assert.equal(session.rejectedDrops, 1, 'the refused drop is counted');
    assert.ok(log.includes('rejected:occupied'), 'the reason code goes to the UI, which words it');
    assert.deepEqual(view.only('cargo'), ['cargoReturn:1']);
  });

  test('a second pointer is ignored while a package is in hand', () => {
    view.pick = 0;
    press(1);
    press(2);
    ctl.move(ptr(2));
    ctl.up(ptr(2));
    assert.deepEqual(view.only('beginDrag'), ['beginDrag:0:mouse']);
    assert.equal(view.only('moveDrag').length, 1, 'only pointer 1 moved the package');
    assert.equal(view.only('pick').length, 1, 'the second finger never even hit-tests');
    assert.equal(session.held, 0, 'still in hand after the second finger lifts');
    assert.equal(view.only('cargo').length, 0);

    ctl.move({ ...ptr(1), clientX: 140 });
    assert.equal(view.only('moveDrag').length, 2);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    ctl.up(ptr(1));
    assert.deepEqual(session.placements.map((p) => p.id), [0]);
  });

  test('pointercancel mid-drag changes nothing and returns the package', () => {
    session.move(0, 0, 1);
    const before = board();
    view.pick = 0;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 3 };
    ctl.update();

    surface.emit('pointercancel', { pointerId: 7 });
    assert.equal(session.held, 0, 'a cancel for another pointer is ignored');

    surface.emit('pointercancel', { pointerId: 1 });
    assert.equal(board(), before);
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0']);
    assert.ok(view.calls.includes('endDrag'));
    assert.equal(surface.captured.size, 0);

    // The pointerup that follows the cancel does nothing.
    ctl.up(ptr(1));
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0']);
    assert.equal(board(), before);
  });

  test('losing pointer capture or window focus also puts the package back', () => {
    view.pick = 0;
    press(1);
    surface.emit('lostpointercapture', { pointerId: 1 });
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0']);

    press(2);
    blur.emit('blur');
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
    assert.deepEqual(session.queue, [0, 1, 2]);
  });

  test('holding the offending crate does not stop the hazard clock', () => {
    drag(0, { kind: 'slot', shelf: 0, slot: 4 });
    assert.equal(session.evaluation.status, 'danger');
    let r = session.advance(200);
    assert.equal(r.hazard.kind, 'balance');
    const left = r.hazard.remaining;

    view.pick = 0;
    press(3);
    view.target = null; // lifted clear of the rack
    ctl.update();
    assert.equal(session.held, 0);
    r = session.advance(300);
    assert.equal(r.hazard.kind, 'balance');
    assert.ok(r.hazard.remaining < left - 250, `clock kept draining (${left} -> ${r.hazard.remaining})`);
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 4 }]);

    // Still holding when the grace runs out: the shipment fails.
    for (let i = 0; i < 40 && !r.outcome; i++) r = session.advance(100);
    assert.equal(r.outcome?.result, 'failed');
    ctl.abort();
    const transitions = view.only('cargo').length;
    ctl.up(ptr(3));
    assert.equal(view.only('cargo').length, transitions, 'the pointerup after the outcome is ignored');
    assert.equal(ctl.holding, null);
  });

  test('release commits the target that was last shown, not a fresh hit-test', () => {
    view.pick = 0;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 1 };
    ctl.update();
    view.target = { kind: 'slot', shelf: 0, slot: 3 }; // moved, but no frame showed it yet
    ctl.up(ptr(1));
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 1 }]);
  });

  test('the belt: a stowed package goes back in one command, a belt package just returns', () => {
    session.move(0, 0, 2);
    drag(0, { kind: 'belt' });
    assert.deepEqual(session.queue, [0, 1, 2]);
    assert.equal(session.placements.length, 0);
    assert.deepEqual(view.only('cargo'), ['cargoToBelt:0']);
    assert.ok(log.includes('toBelt:0'));
    assert.ok(log.includes('beltHover:true') && log.includes('beltHover:false'));
    assert.ok(view.calls.includes('belt:true') && view.calls.includes('belt:false'));

    const before = board();
    drag(0, { kind: 'belt' });
    assert.equal(board(), before);
    assert.deepEqual(view.only('cargo'), ['cargoToBelt:0', 'cargoReturn:0']);
    assert.equal(session.held, null);
  });

  test('no target, or the package\'s own slot: nothing changes and it lands quietly', () => {
    session.move(0, 0, 2);
    const before = board();
    drag(0, null);
    drag(0, { kind: 'slot', shelf: 0, slot: 2 });
    assert.equal(board(), before);
    assert.equal(session.rejectedDrops, 0);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
    assert.equal(log.filter((l) => l.startsWith('placed')).length, 0);
  });

  test('a window resize or orientation change mid-drag puts the package back', () => {
    const before = board();
    view.pick = 0;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    blur.emit('resize');
    assert.equal(session.held, null);
    assert.equal(ctl.holding, null);
    ctl.up(ptr(1)); // the release after the resize commits nothing
    assert.equal(board(), before);

    press(2);
    blur.emit('orientationchange');
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
    assert.equal(board(), before);
  });

  test('setView: a drag on the old view is put back there, later input goes to the new view', () => {
    const before = board();
    view.pick = 0;
    press(1);
    const next = new FakeView();
    ctl.setView(next);
    assert.equal(session.held, null);
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0'], 'the old view settled its package');
    ctl.up(ptr(1));
    assert.equal(board(), before);
    assert.equal(surface.count() > 0, true, 'the listeners stay on the surface');

    // The same pointer surface now drives the new view.
    next.pick = 0;
    press(3);
    next.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    ctl.up(ptr(3));
    assert.deepEqual(next.only('cargoPlaced'), ['cargoPlaced:0:0:2:loud']);
    assert.equal(view.only('cargoPlaced').length, 0);
    assert.deepEqual(session.placements.map((p) => [p.id, p.shelf, p.slot]), [[0, 0, 2]]);
  });

  test('nothing can be picked up while paused, and detach removes every listener', () => {
    session.pause();
    view.pick = 0;
    press(1);
    assert.equal(view.only('beginDrag').length, 0);
    assert.equal(session.held, null);

    assert.ok(surface.count() > 0 && blur.count() > 0);
    ctl.detach();
    assert.equal(surface.count(), 0);
    assert.equal(blur.count(), 0);
  });
});

describe('drag slop', () => {
  test('a press that never moves aims at nothing; its release only selects', () => {
    const before = board();
    view.pick = 0;
    ctl.down(ptr(1));
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    assert.equal(ctl.aimed, null);
    assert.equal(view.only('beginDrag').length, 0, 'no drag visual for a press that has not moved');
    ctl.up(ptr(1));
    assert.equal(board(), before);
    assert.equal(session.rejectedDrops, 0);
    assert.equal(ctl.selection, 0, 'a tap selects');
    assert.equal(session.held, 0, 'selected = held (input state only)');
    assert.equal(view.only('cargo').length, 0);
  });

  test('held past DRAG_HOLD_MS, a smaller movement starts the drag', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    ctl.move({ ...ptr(1), clientX: 101 + 5 });
    assert.equal(ctl.dragging, false, '5 px right away is still a press');
    clock.now += DRAG_HOLD_MS;
    ctl.move({ ...ptr(1), clientX: 101 + 5 });
    assert.equal(ctl.dragging, true, '5 px after a held press is a slow drag');
    assert.deepEqual(view.only('beginDrag'), ['beginDrag:0:mouse']);
  });

  test('a small wobble under the slop is still not a drag', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    ctl.move({ ...ptr(1), clientX: 101 + 5, clientY: 203 });
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    assert.equal(ctl.aimed, null);
  });
});

// ---------------------------------------------------------------------------
// Tap-select / tap-drop: the same commands and validator as a drag.
// ---------------------------------------------------------------------------

/** Tap (press + release, no movement) on package `id`. */
function tapPackage(id: number, pointerId = 1) {
  view.pick = id;
  ctl.down(ptr(pointerId));
  ctl.up(ptr(pointerId));
  view.pick = null;
}

/** With a selection: finger down on `target`, one frame, finger up there. */
function tapTarget(target: DropTarget | null, pointerId = 1) {
  view.pick = null;
  view.target = target;
  ctl.down(ptr(pointerId));
  ctl.update();
  ctl.up(ptr(pointerId));
}

/** Every package is on the belt or on a shelf - exactly once. */
function eachOnce() {
  const ids = [...session.queue, ...session.placements.map((p) => p.id)].sort();
  assert.deepEqual(ids, session.level.packages.map((_, i) => i));
}

describe('tap select', () => {
  test('selecting only holds the package: the board, belt and clocks do not change', () => {
    const before = JSON.stringify(session.snapshot());
    tapPackage(0);
    assert.equal(ctl.selection, 0);
    assert.equal(session.held, 0);
    assert.deepEqual(view.only('select'), ['select:0']);
    assert.ok(log.includes('selected:0'));
    assert.equal(JSON.stringify(session.snapshot()), before, 'snapshot identical (held is input state)');
  });

  test('tap a slot: the target shows while the finger is down, and exactly it is committed', () => {
    tapPackage(0);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.down(ptr(1));
    // Finger still down: the ghost and the meter preview are already up, nothing is committed.
    assert.deepEqual(ctl.aimed, { kind: 'slot', shelf: 0, slot: 2 });
    assert.ok(view.calls.includes('ghost:0:2:1:ok'));
    assert.ok(log.includes('preview:0'));
    assert.equal(session.placements.length, 0);
    ctl.update();
    ctl.up(ptr(1));

    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
    assert.deepEqual(session.queue, [1, 2]);
    assert.equal(session.held, null);
    assert.equal(ctl.selection, null);
    assert.deepEqual(view.only('cargo'), ['cargoPlaced:0:0:2:loud']);
    assert.ok(log.includes('placed:0:false:belt'));
    assert.equal(view.only('beginDrag').length, 0, 'a tap never starts a drag');
  });

  test('a tap commit is the same command a drag makes: identical session state', () => {
    drag(0, { kind: 'slot', shelf: 0, slot: 1 });
    const dragged = session.snapshot();
    setup();
    tapPackage(0);
    tapTarget({ kind: 'slot', shelf: 0, slot: 1 });
    assert.deepEqual(session.snapshot(), dragged);
  });

  test('the finger lifting over a different target than the one shown commits nothing', () => {
    tapPackage(0);
    view.target = { kind: 'slot', shelf: 0, slot: 1 };
    ctl.down(ptr(1));
    ctl.update();
    view.target = { kind: 'slot', shelf: 0, slot: 3 }; // under the finger at release, never shown
    ctl.up(ptr(1));
    assert.equal(session.placements.length, 0);
    assert.equal(ctl.selection, 0, 'still selected');
    assert.equal(session.held, 0);
  });

  test('sliding off every target before lifting commits nothing and keeps the selection', () => {
    tapPackage(0);
    view.target = { kind: 'slot', shelf: 0, slot: 1 };
    ctl.down(ptr(1));
    view.target = null;
    ctl.move({ ...ptr(1), clientY: 500 });
    assert.equal(ctl.aimed, null);
    ctl.up({ ...ptr(1), clientY: 500 });
    assert.equal(session.placements.length, 0);
    assert.equal(ctl.selection, 0);
  });

  test('a refused tap target: reason reported, nothing changes, selection kept, stars unaffected', () => {
    session.move(0, 0, 2);
    const before = board();
    tapPackage(1);
    tapTarget({ kind: 'slot', shelf: 0, slot: 2 });
    assert.ok(view.calls.includes('ghost:0:2:1:bad'));
    assert.ok(log.includes('rejected:occupied'));
    assert.equal(board(), before);
    assert.equal(ctl.selection, 1, 'the selection stays');
    assert.equal(session.held, 1);
    assert.equal(view.only('cargo').length, 0, 'nothing flies anywhere');
    assert.equal(session.rejectedDrops, 1, 'counted for analytics only');

    // Finish the shipment level: the refused tap does not cost a star (ruleset 2).
    tapTarget({ kind: 'slot', shelf: 0, slot: 0 });
    tapPackage(2);
    tapTarget({ kind: 'slot', shelf: 0, slot: 4 });
    // heavy@2 (0), standard@0 (-4), standard@4 (+4): dead level.
    let r = session.advance(16);
    for (let i = 0; i < 200 && !r.outcome; i++) r = session.advance(50);
    assert.equal(r.outcome?.result, 'won');
    assert.equal(r.outcome?.rejectedDrops, 1);
    assert.equal(campaignStars(r.outcome!), 3);
  });

  test('tap the selected package again, or empty space, to deselect; another package to switch', () => {
    tapPackage(0);
    tapPackage(0);
    assert.equal(ctl.selection, null);
    assert.equal(session.held, null);

    session.move(0, 0, 2);
    tapPackage(1);
    assert.equal(ctl.selection, 1);
    tapPackage(0); // a stowed package
    assert.equal(ctl.selection, 0);
    assert.equal(session.held, 0);

    tapTarget(null); // empty space
    assert.equal(ctl.selection, null);
    assert.equal(session.held, null);
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 2 }]);
  });

  test('a selected stowed package tapped onto the belt goes back in one command', () => {
    session.move(0, 0, 2);
    tapPackage(0);
    tapTarget({ kind: 'belt' });
    assert.deepEqual(session.queue, [0, 1, 2]);
    assert.equal(session.placements.length, 0);
    assert.deepEqual(view.only('cargo'), ['cargoToBelt:0']);
    assert.equal(ctl.selection, null);
    eachOnce();
  });

  test('a second finger cannot aim, commit or steal while the first aims the selection', () => {
    tapPackage(0);
    view.target = { kind: 'slot', shelf: 0, slot: 1 };
    ctl.down(ptr(1)); // aiming at slot 1
    ctl.update();
    // Finger 2 on another package, dragged and released.
    view.pick = 1;
    ctl.down(ptr(2));
    ctl.move({ ...ptr(2), clientX: 300 });
    ctl.up(ptr(2));
    view.pick = null;
    assert.equal(session.placements.length, 0, 'finger 2 committed nothing');
    assert.equal(ctl.selection, 0, 'finger 2 did not steal the selection');
    assert.deepEqual(ctl.aimed, { kind: 'slot', shelf: 0, slot: 1 });
    ctl.up(ptr(1));
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 1 }]);
  });

  test('a second finger cannot steal a package that is only pressed (not yet a drag)', () => {
    view.pick = 0;
    ctl.down(ptr(1));
    view.pick = 1;
    ctl.down(ptr(2));
    ctl.move({ ...ptr(2), clientX: 300 });
    ctl.up(ptr(2));
    assert.equal(session.held, 0);
    assert.equal(view.only('beginDrag').length, 0);
    view.pick = null;
    ctl.up(ptr(1));
    assert.equal(ctl.selection, 0, 'finger 1 still ends in its own tap');
  });

  test('pointercancel while aiming: nothing committed, the selection survives', () => {
    tapPackage(0);
    const before = board();
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.down(ptr(1));
    ctl.update();
    surface.emit('pointercancel', { pointerId: 1 });
    assert.equal(ctl.aimed, null);
    assert.ok(log.includes('preview:none'));
    ctl.up(ptr(1)); // the late pointerup does nothing
    assert.equal(board(), before);
    assert.equal(ctl.selection, 0);
    assert.equal(session.held, 0);
  });

  test('a cancelled press on another package keeps the selection (pointercancel, blur, pause)', () => {
    session.move(0, 0, 2);
    tapPackage(0); // the stowed crate
    const before = board();
    for (const cancel of [
      () => surface.emit('pointercancel', { pointerId: 2 }),
      () => blur.emit('blur'),
      () => ctl.cancel(), // what opening the pause panel or the cargo guide does
    ]) {
      view.pick = 1; // the live box
      ctl.down(ptr(2));
      assert.equal(session.held, 1, 'the pressed box is the one in hand');
      cancel();
      assert.equal(ctl.selection, 0, 'the selection survives the cancel');
      assert.equal(session.held, 0, 'and is held again');
      ctl.up(ptr(2)); // the late pointerup does nothing
      assert.equal(ctl.selection, 0);
    }
    assert.equal(view.only('select').join(), 'select:0', 'the selection look never went');
    assert.equal(log.filter((l) => l.startsWith('selected')).join(), 'selected:0');
    assert.equal(board(), before);

    // It still aims and commits.
    tapTarget({ kind: 'slot', shelf: 0, slot: 1 });
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 1 }]);
    eachOnce();
  });

  test('a press on another package that becomes a drag drops the selection first', () => {
    session.move(0, 0, 2);
    tapPackage(0);
    drag(1, { kind: 'slot', shelf: 0, slot: 1 });
    assert.equal(ctl.selection, null);
    assert.ok(view.calls.indexOf('select:null') < view.calls.indexOf('beginDrag:1:mouse'));
    assert.deepEqual(session.placements.map((p) => [p.id, p.slot]), [[0, 2], [1, 1]]);
    eachOnce();

    // The shipment ends mid-press on another package: the old selection's look goes too.
    tapPackage(0);
    view.pick = 2;
    ctl.down(ptr(3));
    ctl.abort();
    assert.equal(ctl.selection, null);
    assert.equal(view.only('select').slice(-1)[0], 'select:null', 'no selection look is left');
  });

  test('pause lets go of the selection in the rules; it is held again on resume', () => {
    tapPackage(0);
    session.pause();
    assert.equal(session.held, null);
    ctl.update();
    assert.equal(ctl.selection, 0, 'still selected on screen');
    session.resume();
    ctl.update();
    assert.equal(session.held, 0);
    tapTarget({ kind: 'slot', shelf: 0, slot: 2 });
    assert.equal(session.placements.length, 1);
  });

  test('a view switch clears the selection', () => {
    tapPackage(0);
    const next = new FakeView();
    ctl.setView(next);
    assert.equal(ctl.selection, null);
    assert.equal(session.held, null);
    assert.ok(view.calls.includes('select:null'), 'the old view dropped its selection look');
  });

  test('dragging the selected package turns it into a normal drag', () => {
    tapPackage(0);
    drag(0, { kind: 'slot', shelf: 0, slot: 3 });
    assert.deepEqual(session.placements, [{ id: 0, type: 'heavy', shelf: 0, slot: 3 }]);
    assert.equal(ctl.selection, null);
    assert.ok(view.calls.indexOf('select:null') < view.calls.indexOf('beginDrag:0:mouse'));
  });
});

// ---------------------------------------------------------------------------
// Nothing vanishes or duplicates.
// ---------------------------------------------------------------------------

describe('no package is lost or duplicated', () => {
  test('pointercancel mid-drag duplicates nothing (belt and stowed packages)', () => {
    // A belt package, cancelled over a legal slot.
    view.pick = 0;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    surface.emit('pointercancel', { pointerId: 1 });
    assert.deepEqual(session.queue, [0, 1, 2]);
    assert.equal(session.placements.length, 0);
    eachOnce();

    // A stowed package, cancelled over the belt.
    session.move(0, 0, 2);
    const stowed = board();
    view.pick = 0;
    press(2);
    view.target = { kind: 'belt' };
    ctl.update();
    surface.emit('pointercancel', { pointerId: 2 });
    ctl.up(ptr(2));
    assert.equal(board(), stowed);
    assert.deepEqual(session.queue, [1, 2]);
    eachOnce();
    assert.deepEqual(view.only('cargo'), ['cargoReturn:0', 'cargoReturn:0']);
  });

  test('the page going hidden mid-drag cancels it', () => {
    view.pick = 0;
    press(1);
    view.target = { kind: 'slot', shelf: 0, slot: 2 };
    ctl.update();
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    assert.equal(ctl.holding, null);
    assert.equal(session.held, null);
    ctl.up(ptr(1));
    assert.equal(session.placements.length, 0);
    eachOnce();
  });
});

// ---------------------------------------------------------------------------
// Long packages only commit when every cell fits.
// ---------------------------------------------------------------------------

/** One 5-slot shelf with a box in the middle and a 3-slot long package. */
const LONG: LevelDef = {
  id: 901,
  name: 'TEST LONG',
  objective: '',
  shelves: [{ slots: 5, maxWeight: 30 }],
  packages: ['standard', 'long', 'standard'],
  balanceTolerance: 10,
};

describe('long packages', () => {
  test('a target that does not fully fit never commits - by drag or by tap', () => {
    setup(LONG);
    session.move(0, 0, 2);
    const before = board();
    for (const slot of [0, 1, 2, 3, -1]) {
      drag(1, { kind: 'slot', shelf: 0, slot });
      assert.ok(view.calls.includes(`ghost:0:${slot}:3:bad`), `slot ${slot} shows every cell as refused`);
      assert.equal(board(), before, `drag to slot ${slot} changed the board`);
      tapPackage(1);
      tapTarget({ kind: 'slot', shelf: 0, slot });
      assert.equal(board(), before, `tap on slot ${slot} changed the board`);
      assert.equal(ctl.selection, 1);
      ctl.deselect();
    }
    assert.deepEqual(
      log.filter((l) => l.startsWith('rejected')).map((l) => l.split(':')[1]),
      ['occupied', 'occupied', 'occupied', 'occupied', 'occupied', 'occupied', 'out-of-bounds', 'out-of-bounds', 'out-of-bounds', 'out-of-bounds'],
    );
    assert.equal(log.filter((l) => l.startsWith('placed')).length, 0);
    eachOnce();
  });
});

// ---------------------------------------------------------------------------
// One undo per shipment, and it survives a snapshot round trip.
// ---------------------------------------------------------------------------

describe('undo through the controller', () => {
  test('one undo; a second is refused; the used undo survives snapshot / restore', () => {
    setup(TIP, 1);
    drag(0, { kind: 'slot', shelf: 0, slot: 2 });
    tapPackage(1);
    assert.equal(session.canUndo, false, 'no undo while a package is selected');
    ctl.reset();
    assert.equal(session.canUndo, true);
    assert.equal(session.undo(), true);
    assert.deepEqual(session.placements, []);
    assert.deepEqual(session.queue, [0, 1, 2]);
    drag(0, { kind: 'slot', shelf: 0, slot: 2 });
    assert.equal(session.canUndo, false);
    assert.equal(session.undo(), false, 'second undo refused');
    assert.deepEqual(session.assists, { hints: 0, undos: 1 });

    const restored = GameSession.restore(TIP, JSON.parse(JSON.stringify(session.snapshot())) as ShipmentSnapshot);
    restored.resume();
    assert.deepEqual(restored.assists, { hints: 0, undos: 1 });
    assert.equal(restored.undoLeft, 0, 'reopening does not renew the undo');
    restored.move(1, 0, 0);
    assert.equal(restored.undo(), false);
    assert.equal(restored.assists.undos, 1);
  });
});
