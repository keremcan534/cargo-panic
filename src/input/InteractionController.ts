/**
 * Pointer state machine for the game screen. Turns raw pointer events into
 * semantic commands on the GameSession and visual calls on the GameView.
 *
 * Two ways to move a package, one command path. Both end in exactly one
 * `session.move` or `session.toBelt` on a target the view resolved and the
 * player was shown (ghost + meter preview from `session.preview`), or in
 * nothing - so the way a package was moved can never change the rules.
 *
 * - DRAG: press on a movable package and move past DRAG_SLOP_PX (or hold for
 *   DRAG_HOLD_MS and move past DRAG_HOLD_SLOP_PX). Release commits the
 *   target last shown under the dragged package.
 * - TAP: press and release on a movable package without that movement
 *   selects it (`session.hold` only - the board does not change). With a
 *   selection, pressing anywhere else aims it at the target under the finger
 *   (`view.targetAt`) and shows that target while the finger is down;
 *   releasing over the same target commits it, releasing elsewhere does
 *   nothing and keeps the selection. A tap on the selected package, or on
 *   empty space, deselects; a tap on another package selects that one.
 *
 * Rules it enforces:
 *
 * - One active pointer. While a press, drag or aiming press is active every
 *   other pointer is ignored (it cannot pick, aim or commit); the active one
 *   is captured, and pointercancel, lostpointercapture, window blur, the page
 *   going hidden and a window resize / orientation change cancel it: the
 *   board does not change and a dragged package goes back. A selection
 *   survives a cancel; a view switch (setView / reset) clears it.
 * - The surface is the stable #game-root element, not the stage canvas, so a
 *   view switch only swaps the view (setView), never the listeners.
 * - Release commits exactly the target that was last shown, never a fresh
 *   hit-test: one `move` or one `toBelt`, or nothing.
 * - A refused target (reason from the rules) changes nothing; a dragged
 *   package goes back, a selected one stays selected.
 *
 * No three.js and no screen maths here: the view reports belt-or-slot targets.
 */

import { PACKAGE_SPECS } from '../game/levels/types';
import type { GameSession } from '../game/session';
import type { CargoLocation, TargetKind } from '../game/session/types';
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
  /** A press landed on a package (it may become a drag or a tap-select). */
  grabbed(cargoId: number): void;
  /** Net torque the target being aimed would leave, or null for no preview. */
  preview(net: number | null): void;
  /** The belt is (or is no longer) the target being shown. */
  beltHover(on: boolean): void;
  /** A target the rules refuse (the reason code; the UI words it). Nothing changed. */
  rejected(reason: PlaceRejection): void;
  /** A move was committed (`from` is where the package was); the controller re-syncs the board. */
  placed(cargoId: number, quiet: boolean, from: CargoLocation): void;
  /** The committed package touched down on its shelf. */
  landed(cargoId: number): void;
  /** A stowed package was committed back to the belt. */
  toBelt(cargoId: number): void;
  /** The tap selection changed (a package id, or null for none). */
  selected?(cargoId: number | null): void;
}

/** Event source the controller listens on (#game-root in the game: it outlives any canvas). */
export interface PointerSurface {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
}

type EventSource = Pick<PointerSurface, 'addEventListener' | 'removeEventListener'>;

export interface InteractionOptions {
  surface: PointerSurface;
  session: GameSession;
  view: GameView;
  hooks: InteractionHooks;
  /** Source of blur / resize / orientationchange; defaults to `window` when there is one. */
  blurTarget?: EventSource | null;
  /** Source of `visibilitychange` with a `visibilityState`; defaults to `document` when there is one. */
  visibilityTarget?: (EventSource & { readonly visibilityState?: string }) | null;
  /** Milliseconds clock for the hold-to-drag rule (tests inject one). */
  now?: () => number;
}

type Shown =
  | { kind: 'slot'; shelf: number; slot: number; ghost: TargetKind }
  | { kind: 'belt' };

/** A press that started on a movable package: a tap until it moves enough to be a drag. */
interface CargoPress {
  kind: 'cargo';
  pointerId: number;
  cargoId: number;
  slots: number;
  /** Where and when the press started (the drag starts from here). */
  start: PointerSample;
  t0: number;
  dragging: boolean;
  /** The package was the selection when the press began: a tap on it deselects. */
  wasSelected: boolean;
  /**
   * Another package was selected when the press began. The session holds the
   * pressed one now (it holds one at a time); the old selection is dropped
   * once the press becomes a tap or a drag, and comes back if it is cancelled.
   */
  prevSelected: number | null;
}

/** A press elsewhere while a package is selected: aims the selection at the target under the finger. */
interface AimPress {
  kind: 'aim';
  pointerId: number;
  cargoId: number;
  slots: number;
  /** Latest pointer position; the target is re-resolved from it every frame (the rack leans). */
  last: PointerSample;
  /** A target was shown when the finger went down (a press on empty space deselects on release). */
  startedOnTarget: boolean;
}

type Press = CargoPress | AimPress;

/**
 * A press only becomes a drag that can aim at a target once the pointer has
 * travelled this far (CSS px). Without it a quick click or a still finger on
 * the live belt package could land it on the bottom shelf while the view was
 * still easing it off the belt - and it is what tells a tap from a drag.
 */
export const DRAG_SLOP_PX = 8;
/** A press held this long becomes a drag on a smaller movement (a slow, careful drag). */
export const DRAG_HOLD_MS = 180;
export const DRAG_HOLD_SLOP_PX = 4;

export class InteractionController {
  private readonly surface: PointerSurface;
  private readonly session: GameSession;
  private view: GameView;
  private readonly hooks: InteractionHooks;
  private readonly blurTarget: InteractionOptions['blurTarget'];
  private readonly visibilityTarget: InteractionOptions['visibilityTarget'];
  private readonly now: () => number;

  private press: Press | null = null;
  /** The tap-selected package (held in the session), or null. */
  private selectedId: number | null = null;
  /** What the player currently sees as the target; a release commits this. */
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
    this.visibilityTarget =
      opts.visibilityTarget !== undefined ? opts.visibilityTarget : typeof document !== 'undefined' ? document : null;
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** Package being pressed, dragged or aimed, else the selected one, else null. */
  get holding(): number | null {
    return this.press?.cargoId ?? this.selectedId;
  }

  /** The tap-selected package, or null. */
  get selection(): number | null {
    return this.selectedId;
  }

  /** A package is being dragged (not just pressed or selected). */
  get dragging(): boolean {
    return this.press?.kind === 'cargo' && this.press.dragging;
  }

  /** The target currently shown - what a release would commit - while a drag or an aiming press is active. */
  get aimed(): DropTarget | null {
    const s = this.shown;
    if (!this.press || !s) return null;
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
    s.addEventListener('lostpointercapture', this.onCancel);
    this.blurTarget?.addEventListener('blur', this.onBlur);
    this.blurTarget?.addEventListener('resize', this.onBlur);
    this.blurTarget?.addEventListener('orientationchange', this.onBlur);
    this.visibilityTarget?.addEventListener('visibilitychange', this.onVisibility);
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
    s.removeEventListener('lostpointercapture', this.onCancel);
    this.blurTarget?.removeEventListener('blur', this.onBlur);
    this.blurTarget?.removeEventListener('resize', this.onBlur);
    this.blurTarget?.removeEventListener('orientationchange', this.onBlur);
    this.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibility);
    const p = this.press;
    this.press = null;
    this.shown = null;
    this.selectedId = null;
    if (p) this.releaseCapture(p.pointerId);
  }

  private onDown = (e: Event) => this.down(e as unknown as PointerInput);
  private onMove = (e: Event) => this.move(e as unknown as PointerInput);
  private onUp = (e: Event) => this.up(e as unknown as PointerInput);
  /** pointercancel / lostpointercapture of the active pointer. Others are ignored. */
  private onCancel = (e: Event) => {
    if (this.press && (e as unknown as PointerInput).pointerId === this.press.pointerId) this.cancel();
  };
  /** Blur, resize, orientation change: the layout under the finger is no longer trusted. */
  private onBlur = () => this.cancel();
  private onVisibility = () => {
    if (this.visibilityTarget?.visibilityState === 'hidden') this.cancel();
  };

  /**
   * Points the controller at a new view (after a render-mode switch). A drag
   * still in hand is put back on the old view first and the selection is
   * cleared; the listeners stay.
   */
  setView(view: GameView) {
    if (view === this.view) return;
    this.reset();
    this.view = view;
  }

  // ==========================================================================
  // Pointer events
  // ==========================================================================

  down(e: PointerInput) {
    if (this.press) return; // one pointer at a time: a second finger never picks, aims or commits
    const s = this.session;
    if (s.phase !== 'play') return;
    this.syncSelection();
    const p = sample(e);
    const id = this.view.pickCargo(p, s.movable());

    if (id !== null) {
      const wasSelected = this.selectedId === id;
      // Pressing another package puts the selection aside (still shown) until the press is a tap or a drag.
      const prevSelected = wasSelected ? null : this.selectedId;
      if (prevSelected !== null) {
        this.selectedId = null;
        s.release(prevSelected);
      }
      if (!s.hold(id)) {
        if (prevSelected !== null) this.restoreSelection(prevSelected);
        return;
      }
      this.press = {
        kind: 'cargo',
        pointerId: e.pointerId,
        cargoId: id,
        slots: slotsOf(s, id),
        start: p,
        t0: this.now(),
        dragging: false,
        wasSelected,
        prevSelected,
      };
      this.shown = null;
      this.capture(e.pointerId);
      this.hooks.grabbed(id);
      return;
    }

    const sel = this.selectedId;
    if (sel === null) return;
    // With a selection, a press anywhere else aims it: the target shows while the finger is down.
    const aim: AimPress = {
      kind: 'aim',
      pointerId: e.pointerId,
      cargoId: sel,
      slots: slotsOf(s, sel),
      last: p,
      startedOnTarget: false,
    };
    this.press = aim;
    this.shown = null;
    this.capture(e.pointerId);
    this.aimAt(aim);
    aim.startedOnTarget = this.shown !== null;
  }

  move(e: PointerInput) {
    const pr = this.press;
    if (!pr || e.pointerId !== pr.pointerId) return;
    const p = sample(e);
    if (pr.kind === 'aim') {
      pr.last = p;
      this.aimAt(pr);
      return;
    }
    if (!pr.dragging) {
      const d = Math.hypot(p.clientX - pr.start.clientX, p.clientY - pr.start.clientY);
      const longPress = this.now() - pr.t0 >= DRAG_HOLD_MS;
      if (d <= DRAG_SLOP_PX && !(longPress && d > DRAG_HOLD_SLOP_PX)) return;
      this.beginDrag(pr);
    }
    this.view.moveDrag(p);
  }

  up(e: PointerInput) {
    const pr = this.press;
    if (!pr || e.pointerId !== pr.pointerId) return;
    const shown = this.shown;

    if (pr.kind === 'cargo') {
      this.endPress();
      if (pr.dragging) {
        this.view.endDrag();
        this.commit(pr.cargoId, shown, 'drag');
      } else {
        this.tapPackage(pr);
      }
      return;
    }

    // An aiming press: commit only if the finger lifts over the target it was shown.
    const at = this.view.targetAt(sample(e), pr.slots);
    this.endPress();
    if (shown && sameTarget(at, shown)) this.commit(pr.cargoId, shown, 'tap');
    else if (!shown && !pr.startedOnTarget && at === null) this.deselect(); // a tap on empty space
    // Released off the target it showed: nothing happens and the selection stays.
  }

  /**
   * Cancels the press in progress. Nothing changes in the session: a dragged
   * package goes back where the board says it is, a selection stays. Used
   * for pointercancel, lost capture, blur, the page going hidden, and when
   * pause or the cargo guide opens.
   */
  cancel() {
    const pr = this.press;
    if (!pr) return;
    this.endPress();
    if (pr.kind !== 'cargo') return;
    if (pr.dragging) {
      this.view.endDrag();
      this.session.release(pr.cargoId);
      this.view.cargoReturn(pr.cargoId);
    } else if (!pr.wasSelected) {
      this.session.release(pr.cargoId);
      if (pr.prevSelected !== null) this.restoreSelection(pr.prevSelected);
    }
  }

  /** Cancels any press and clears the selection (view switch, undo, hint, restart). */
  reset() {
    this.cancel();
    this.deselect();
  }

  /** Clears the tap selection, if any. The board is untouched. */
  deselect() {
    const id = this.selectedId;
    if (id === null) return;
    this.selectedId = null;
    this.session.release(id);
    this.view.setSelected(null);
    this.hooks.selected?.(null);
  }

  /**
   * The shipment ended while a package was pressed, dragged or selected.
   * Forget the pointer (its pointerup will be ignored) and the selection; the
   * view's outcome call settles the package.
   */
  abort() {
    const pr = this.press;
    this.press = null;
    this.shown = null;
    if (pr) this.releaseCapture(pr.pointerId);
    this.view.hideGhost();
    this.hooks.preview(null);
    this.setBelt(false);
    if (this.selectedId !== null || (pr?.kind === 'cargo' && pr.prevSelected !== null)) {
      this.selectedId = null;
      this.view.setSelected(null);
      this.hooks.selected?.(null);
    }
  }

  // ==========================================================================
  // Per frame
  // ==========================================================================

  /** Reads the view's target once (after view.update) and shows its preview. */
  update() {
    this.syncSelection();
    const pr = this.press;
    if (!pr) return;
    if (pr.kind === 'aim') {
      // The rack leans and settles under a still finger: keep the target honest.
      this.aimAt(pr);
      return;
    }
    // Until the press is a drag, nothing is aimed and a release changes nothing.
    if (!pr.dragging) return;
    this.show(pr.cargoId, pr.slots, this.view.dragTarget());
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private beginDrag(pr: CargoPress) {
    pr.dragging = true;
    if (this.selectedId === pr.cargoId || pr.prevSelected !== null) {
      // Dragging the selected package: it is in hand now, not selected. Dragging another: the selection goes.
      pr.prevSelected = null;
      this.selectedId = null;
      this.view.setSelected(null);
      this.hooks.selected?.(null);
    }
    this.view.beginDrag(pr.cargoId, pr.start);
  }

  /** Press and release on a package without dragging it. */
  private tapPackage(pr: CargoPress) {
    if (pr.wasSelected) {
      this.deselect();
      return;
    }
    // The session already holds it (input state only).
    this.selectedId = pr.cargoId;
    this.view.setSelected(pr.cargoId);
    this.hooks.selected?.(pr.cargoId);
  }

  private aimAt(pr: AimPress) {
    this.show(pr.cargoId, pr.slots, this.view.targetAt(pr.last, pr.slots));
  }

  /** Shows a target (ghost + meter preview, or the belt) and remembers it as what a release commits. */
  private show(id: number, slots: number, t: DropTarget | null) {
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
    const pv = this.session.preview(id, t.shelf, t.slot);
    if (pv.kind === 'bad' || !pv.evaluation) {
      this.shown = { kind: 'slot', ...target, ghost: 'bad' };
      this.view.showGhost(target, slots, 'bad');
      this.hooks.preview(null);
      return;
    }
    this.shown = { kind: 'slot', ...target, ghost: pv.kind };
    this.view.showGhost(target, slots, pv.kind);
    this.hooks.preview(pv.evaluation.net);
  }

  /** Ends the press: capture, ghost, preview and belt highlight go; the session is not touched. */
  private endPress() {
    const pr = this.press;
    this.press = null;
    this.shown = null;
    if (pr) this.releaseCapture(pr.pointerId);
    this.view.hideGhost();
    this.hooks.preview(null);
    this.setBelt(false);
  }

  /**
   * The one place a package is moved: the same session commands for a drag
   * and a tap. Only the look differs - a dragged package flies back when
   * nothing happens, a selected one simply stays selected (refused) or is
   * let go (no change).
   */
  private commit(id: number, shown: Shown | null, via: 'drag' | 'tap') {
    const s = this.session;
    const v = this.view;

    if (shown?.kind === 'slot') {
      const target = { shelf: shown.shelf, slot: shown.slot };
      const r = s.move(id, shown.shelf, shown.slot);
      if (r.ok && r.changed) {
        if (via === 'tap') this.dropSelection();
        v.cargoPlaced(id, target, { quiet: false, onLanded: () => this.hooks.landed(id) });
        this.hooks.placed(id, false, r.from);
        return;
      }
      if (!r.ok) {
        if (isPlaceRejection(r.rejection)) this.hooks.rejected(r.rejection);
        if (via === 'drag') v.cargoReturn(id);
        else if (!s.hold(id)) this.deselect(); // refused: the selection stays
        return;
      }
      // Its own slot: nothing changed.
      if (via === 'drag') v.cargoReturn(id);
      else this.deselect();
      return;
    }

    if (shown?.kind === 'belt' && s.locationOf(id)?.at === 'shelf') {
      const r = s.toBelt(id);
      if (r.ok && r.changed) {
        if (via === 'tap') this.dropSelection();
        v.cargoToBelt(id);
        this.hooks.toBelt(id);
        return;
      }
    }

    // A belt package sent to the belt, or no target: back where it was.
    s.release(id);
    if (via === 'drag') v.cargoReturn(id);
    else this.deselect();
  }

  /** The selected package was just moved by a command (which already let go of it). */
  private dropSelection() {
    if (this.selectedId === null) return;
    this.selectedId = null;
    this.view.setSelected(null);
    this.hooks.selected?.(null);
  }

  /**
   * Keeps the session's hold on the selection. Pausing lets go of whatever is
   * held; when play resumes the selection is held again - or dropped if the
   * package can no longer be picked up.
   */
  private syncSelection() {
    const id = this.selectedId;
    if (id === null) return;
    const s = this.session;
    if (s.phase !== 'play' || s.held === id) return;
    if (!s.hold(id)) this.deselect();
  }

  /** A press on another package came to nothing: the selection it put aside is back. */
  private restoreSelection(id: number) {
    this.selectedId = id;
    this.syncSelection();
  }

  private setBelt(on: boolean) {
    if (on === this.beltOn) return;
    this.beltOn = on;
    this.view.setBeltHover(on);
    this.hooks.beltHover(on);
  }

  private capture(pointerId: number) {
    try {
      this.surface.setPointerCapture?.(pointerId);
    } catch {
      /* synthetic or already-ended pointer: nothing to capture */
    }
  }

  /** Called after `press` is cleared, so a synchronous lostpointercapture finds nothing to cancel. */
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

function sameTarget(a: DropTarget | null, b: Shown): boolean {
  if (!a) return false;
  if (a.kind === 'belt' || b.kind === 'belt') return a.kind === b.kind;
  return a.shelf === b.shelf && a.slot === b.slot;
}

function isPlaceRejection(r: string): r is PlaceRejection {
  return r === 'locked' || r === 'occupied' || r === 'out-of-bounds' || r === 'priority-zone';
}
