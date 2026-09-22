/**
 * Pointer state machine for the game screen. Turns raw pointer events into
 * semantic commands on the GameSession and visual calls on the GameView.
 *
 * A1 supports drag only (A3 adds tap-select / tap-drop on the same command
 * path). Rules it enforces:
 *
 * - One active pointer. While a package is in hand every other pointer is
 *   ignored; the active one is captured, and pointercancel, lostpointercapture
 *   and window blur put the package back where the board says it is.
 * - Picking up is `session.hold()` only - the board does not change.
 * - Release commits exactly the target that was last shown (ghost / belt
 *   highlight), never a fresh hit-test: one `move` or one `toBelt`, or nothing.
 *
 * No three.js and no screen maths here: the view reports belt-or-slot targets.
 */

import { PACKAGE_SPECS } from '../game/levels/types';
import type { GameSession } from '../game/session';
import type { TargetKind } from '../game/session/types';
import { rejectionMessage } from '../game/systems/BalanceSystem';
import type { PlaceRejection } from '../game/systems/BalanceSystem';
import type { DropTarget, GameView, PointerSample } from '../render/GameView';

/** The parts of a PointerEvent the controller reads. Plain objects work (tests). */
export interface PointerInput {
  pointerId: number;
  clientX: number;
  clientY: number;
  pointerType: string;
}

/** UI feedback for the game controller (DOM, audio, haptics). */
export interface InteractionHooks {
  /** A package was picked up (before the view starts the drag). */
  grabbed(cargoId: number): void;
  /** Net torque the drop being aimed would leave, or null for no preview. */
  preview(net: number | null): void;
  /** The pointer entered / left the belt drop area. */
  beltHover(on: boolean): void;
  /** A drop on a slot the rules refuse. The package is already on its way back. */
  rejected(reason: string): void;
  /** A move was committed; the controller re-syncs the board. */
  placed(cargoId: number, quiet: boolean): void;
  /** The committed package touched down on its shelf. */
  landed(cargoId: number): void;
  /** A stowed package was committed back to the belt. */
  toBelt(cargoId: number): void;
}

/** Event source the controller listens on (the stage canvas in the game). */
export interface PointerSurface {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
}

export interface InteractionOptions {
  surface: PointerSurface;
  session: GameSession;
  view: GameView;
  hooks: InteractionHooks;
  /** Blur source; defaults to `window` when there is one. */
  blurTarget?: Pick<PointerSurface, 'addEventListener' | 'removeEventListener'> | null;
}

type Shown =
  | { kind: 'slot'; shelf: number; slot: number; ghost: TargetKind; reason: string }
  | { kind: 'belt' };

interface Active {
  pointerId: number;
  cargoId: number;
  slots: number;
}

export class InteractionController {
  private readonly surface: PointerSurface;
  private readonly session: GameSession;
  private readonly view: GameView;
  private readonly hooks: InteractionHooks;
  private readonly blurTarget: InteractionOptions['blurTarget'];

  private active: Active | null = null;
  /** What the player currently sees as the drop target; release commits this. */
  private shown: Shown | null = null;
  private beltOn = false;
  private attached = false;

  constructor(opts: InteractionOptions) {
    this.surface = opts.surface;
    this.session = opts.session;
    this.view = opts.view;
    this.hooks = opts.hooks;
    this.blurTarget =
      opts.blurTarget !== undefined ? opts.blurTarget : typeof window !== 'undefined' ? window : null;
  }

  /** Package id in hand, or null. */
  get holding(): number | null {
    return this.active?.cargoId ?? null;
  }

  /** The target currently shown for the package in hand - what a release would commit. */
  get aimed(): DropTarget | null {
    const s = this.shown;
    if (!this.active || !s) return null;
    return s.kind === 'belt' ? { kind: 'belt' } : { kind: 'slot', shelf: s.shelf, slot: s.slot };
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    const s = this.surface;
    s.addEventListener('pointerdown', this.onDown);
    s.addEventListener('pointermove', this.onMove);
    s.addEventListener('pointerup', this.onUp);
    s.addEventListener('pointercancel', this.onCancel);
    s.addEventListener('lostpointercapture', this.onLost);
    this.blurTarget?.addEventListener('blur', this.onBlur);
  }

  /** Stops listening. Does not touch the session or the view (the screen is going away). */
  detach() {
    if (!this.attached) return;
    this.attached = false;
    const s = this.surface;
    s.removeEventListener('pointerdown', this.onDown);
    s.removeEventListener('pointermove', this.onMove);
    s.removeEventListener('pointerup', this.onUp);
    s.removeEventListener('pointercancel', this.onCancel);
    s.removeEventListener('lostpointercapture', this.onLost);
    this.blurTarget?.removeEventListener('blur', this.onBlur);
    const a = this.active;
    this.active = null;
    this.shown = null;
    if (a) this.releaseCapture(a.pointerId);
  }

  private onDown = (e: Event) => this.down(e as unknown as PointerInput);
  private onMove = (e: Event) => this.move(e as unknown as PointerInput);
  private onUp = (e: Event) => this.up(e as unknown as PointerInput);
  private onCancel = (e: Event) => {
    if (this.active && (e as unknown as PointerInput).pointerId === this.active.pointerId) this.cancel();
  };
  private onLost = (e: Event) => {
    if (this.active && (e as unknown as PointerInput).pointerId === this.active.pointerId) this.cancel();
  };
  private onBlur = () => this.cancel();

  // ==========================================================================
  // Pointer events
  // ==========================================================================

  down(e: PointerInput) {
    if (this.active) return; // one package, one pointer
    const s = this.session;
    if (s.phase !== 'play') return;
    const p = sample(e);
    const id = this.view.pickCargo(p, s.movable());
    if (id === null) return;
    if (!s.hold(id)) return;
    this.active = { pointerId: e.pointerId, cargoId: id, slots: slotsOf(s, id) };
    this.shown = null;
    try {
      this.surface.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic or already-ended pointer: nothing to capture */
    }
    this.hooks.grabbed(id);
    this.view.beginDrag(id, p);
  }

  move(e: PointerInput) {
    if (!this.active || e.pointerId !== this.active.pointerId) return;
    this.view.moveDrag(sample(e));
  }

  up(e: PointerInput) {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    const shown = this.shown;
    this.endHold();
    this.commit(a.cargoId, shown);
  }

  /**
   * Puts the package in hand back where the board says it is. Nothing changes
   * in the session. Used for pointercancel, lost capture, window blur, and
   * when pause or the cargo guide opens mid-drag.
   */
  cancel() {
    const a = this.active;
    if (!a) return;
    this.endHold();
    this.session.release(a.cargoId);
    this.view.cargoReturn(a.cargoId);
  }

  /**
   * The shipment ended while a package was in hand. Forget the pointer (its
   * pointerup will be ignored); the view's outcome call settles the package.
   */
  abort() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.shown = null;
    this.releaseCapture(a.pointerId);
    this.view.hideGhost();
    this.hooks.preview(null);
    this.setBelt(false);
  }

  // ==========================================================================
  // Per frame
  // ==========================================================================

  /** Reads the view's drag target once (after view.update) and shows its preview. */
  update() {
    const a = this.active;
    if (!a) return;
    const t = this.view.dragTarget();

    if (t?.kind === 'belt') {
      this.shown = { kind: 'belt' };
      this.view.hideGhost();
      this.hooks.preview(null);
      this.setBelt(true);
      return;
    }
    this.setBelt(false);

    if (!t) {
      this.shown = null;
      this.view.hideGhost();
      this.hooks.preview(null);
      return;
    }

    const target = { shelf: t.shelf, slot: t.slot };
    const pv = this.session.preview(a.cargoId, t.shelf, t.slot);
    if (pv.kind === 'bad' || !pv.evaluation) {
      const reason = pv.rejection ? rejectionMessage(pv.rejection) : '';
      this.shown = { kind: 'slot', ...target, ghost: 'bad', reason };
      this.view.showGhost(target, a.slots, 'bad');
      this.hooks.preview(null);
      return;
    }
    const reason = pv.willCrush ? 'CRUSHES FRAGILE CARGO' : pv.willOverload ? 'OVER LOAD LIMIT' : '';
    this.shown = { kind: 'slot', ...target, ghost: pv.kind, reason };
    this.view.showGhost(target, a.slots, pv.kind);
    this.hooks.preview(pv.evaluation.net);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private endHold() {
    const a = this.active;
    this.active = null;
    this.shown = null;
    if (a) this.releaseCapture(a.pointerId);
    this.view.endDrag();
    this.view.hideGhost();
    this.hooks.preview(null);
    this.setBelt(false);
  }

  private commit(id: number, shown: Shown | null) {
    const s = this.session;
    const v = this.view;

    if (shown?.kind === 'slot') {
      const target = { shelf: shown.shelf, slot: shown.slot };
      const r = s.move(id, shown.shelf, shown.slot);
      if (r.ok && r.changed) {
        v.cargoPlaced(id, target, { quiet: false, onLanded: () => this.hooks.landed(id) });
        this.hooks.placed(id, false);
        return;
      }
      if (!r.ok) {
        if (isPlaceRejection(r.rejection)) this.hooks.rejected(shown.reason || rejectionMessage(r.rejection));
        v.cargoReturn(id);
        return;
      }
      // Dropped back on its own slot: nothing changed, land quietly.
      v.cargoReturn(id);
      return;
    }

    if (shown?.kind === 'belt' && s.locationOf(id)?.at === 'shelf') {
      const r = s.toBelt(id);
      if (r.ok && r.changed) {
        v.cargoToBelt(id);
        this.hooks.toBelt(id);
        return;
      }
    }

    // A belt package dropped on the belt, or no target: back where it was.
    s.release(id);
    v.cargoReturn(id);
  }

  private setBelt(on: boolean) {
    if (on === this.beltOn) return;
    this.beltOn = on;
    this.view.setBeltHover(on);
    this.hooks.beltHover(on);
  }

  /** Called after `active` is cleared, so a synchronous lostpointercapture finds nothing to cancel. */
  private releaseCapture(pointerId: number) {
    try {
      if (this.surface.hasPointerCapture?.(pointerId) ?? true) this.surface.releasePointerCapture?.(pointerId);
    } catch {
      /* already released */
    }
  }
}

function sample(e: PointerInput): PointerSample {
  return { clientX: e.clientX, clientY: e.clientY, touch: e.pointerType === 'touch' };
}

function slotsOf(s: GameSession, id: number): number {
  return PACKAGE_SPECS[s.level.packages[id]].slots;
}

function isPlaceRejection(r: string): r is PlaceRejection {
  return r === 'locked' || r === 'occupied' || r === 'out-of-bounds' || r === 'priority-zone';
}
