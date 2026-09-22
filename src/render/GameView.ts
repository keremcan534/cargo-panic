/**
 * The contract between the gameplay controller and a renderer.
 *
 * A view draws a board it is handed and maps pointer positions to semantic
 * targets - a package id, a (shelf, slot), or "the belt" - and nothing more.
 * It never decides whether a move is legal: the controller asks the
 * GameSession, then tells the view what happened. Both the Three.js view and
 * the Canvas 2D view implement this, which is what guarantees they play by
 * the same rules.
 *
 * Views must not import from src/app or mutate game state.
 *
 * Call order the controller follows, every time:
 *   1. a session command (move / toBelt / undo ...)
 *   2. the matching transition call (cargoPlaced / cargoToBelt / cargoReturn)
 *   3. sync(board)
 * Per frame: view.update(dt), then dragTarget() once, then session.preview +
 * showGhost. On release the controller commits the target it last passed to
 * showGhost - never a fresh query - so what the player saw is what happens.
 */

import type { LevelDef } from '../game/levels/types';
import type { TargetKind } from '../game/session/types';
import type { BoardEval, Placement } from '../game/systems/BalanceSystem';

export type RenderMode = '2d' | '3d';

/** Read model a view draws from. Always derived from the GameSession. */
export interface BoardView {
  level: LevelDef;
  /** Belt order; index 0 is the live package. */
  queue: readonly number[];
  /** Committed placements. A package in the player's hand still appears here. */
  placements: readonly Placement[];
  evaluation: BoardEval;
  /**
   * Package in the player's hand (session.held), or null. It is drawn only in
   * hand - never at its slot or belt spot. The belt does NOT advance while the
   * live package is held (nothing is committed yet). For a stowed package, a
   * faint outline marks its committed slot, because the rack's tilt and load
   * labels still count it there.
   */
  held: number | null;
  /** The rack is past its balance tolerance (evaluation.status === 'danger'): lean + wobble. */
  wobble: boolean;
}

export interface PointerSample {
  clientX: number;
  clientY: number;
  /** Touch input floats the package above the finger so it stays visible. */
  touch: boolean;
}

/** Where a drop or tap would go, in rules terms. */
export type DropTarget = { kind: 'slot'; shelf: number; slot: number } | { kind: 'belt' };

export type ViewHighlight = { shelf: number } | { cargo: number } | null;

export type ClientPoint = { x: number; y: number };

export interface DispatchCallbacks {
  /** Fired as each package leaves, in departure order (for per-package sound). */
  onEach?: (cargoId: number, index: number) => void;
  onDone?: () => void;
}

export interface GameView {
  readonly mode: RenderMode;

  /** Builds everything for this board with every package already in place. */
  mount(board: BoardView): void;
  /**
   * Places every package that is not in hand and has no transition in flight
   * at its BoardView location - stowed ones in their slot, queue[0..2] on the
   * belt (live full size, next two dimmed at 0.86 scale / 0.62 opacity), the
   * rest hidden - then derives tilt, wobble, shelf labels, overload glow,
   * fragile cracks and crush columns. Moving a package this way (e.g. after
   * undo) is a short tween with a quiet landing. After dispatch() or any
   * fail*() the view ignores placements until the next mount.
   */
  sync(board: BoardView): void;
  /** Per-frame animation, including the dragged package's easing. Only the controller calls it. */
  update(dtMs: number): void;
  /** Releases every object, texture, listener, tween and timer the view created. */
  dispose(): void;

  // --- pointer -> semantic target (no legality checks) ----------------------

  /** Topmost of `candidates` under the pointer. */
  pickCargo(p: PointerSample, candidates: readonly number[]): number | null;
  beginDrag(cargoId: number, p: PointerSample): void;
  moveDrag(p: PointerSample): void;
  /**
   * Target under the dragged package, recomputed by update(): the belt when
   * the pointer is over the belt area in this view's projection, else the
   * slot under the package's on-screen position (via the shared hit-test in
   * render/layout.ts), else null.
   */
  dragTarget(): DropTarget | null;
  /** Target under a tapped point for a package `slots` wide (belt, slot or null). */
  targetAt(p: PointerSample, slots: number): DropTarget | null;
  /** Ends the drag visual. The controller follows with cargoPlaced / cargoToBelt / cargoReturn. */
  endDrag(): void;

  // --- feedback ---------------------------------------------------------------

  /** Outline of every cell a package `slots` wide would occupy at a slot target. */
  showGhost(target: { shelf: number; slot: number }, slots: number, kind: TargetKind): void;
  hideGhost(): void;
  /** Highlights the belt as a drop target (or not). */
  setBeltHover(on: boolean): void;
  /** Tap-to-select highlight on a package, or none. */
  setSelected(cargoId: number | null): void;
  showHint(cargoId: number, target: { shelf: number; slot: number }): void;
  clearHint(): void;
  /** Points at the shelf or package a message refers to (loss reason, tutorial). */
  highlight(h: ViewHighlight): void;

  // --- transitions, after the session has decided ----------------------------

  /** Animates a package into its committed slot. `onLanded` fires on touchdown. */
  cargoPlaced(cargoId: number, target: { shelf: number; slot: number }, opts: { quiet: boolean; onLanded?: () => void }): void;
  /** Animates a package from a shelf to the front of the belt. */
  cargoToBelt(cargoId: number): void;
  /** Animates a package back to wherever the board says it is (refused or cancelled drop). */
  cargoReturn(cargoId: number): void;

  // --- shipment outcome -------------------------------------------------------
  // Each of these first ends any active drag: the in-hand package snaps to its
  // committed location and takes part in the outcome (it spills, shatters or
  // ships with the rest). Afterwards endDrag / cargoPlaced / cargoToBelt /
  // cargoReturn are no-ops.

  celebrate(): void;
  /** Stowed cargo leaves the rack; the rack levels and its labels empty. */
  dispatch(cb?: DispatchCallbacks): void;
  failCollapse(direction: number): void;
  failOverload(tier: number, direction: number): void;
  failFragile(cargoId: number): void;

  /** Client-space centre of a package, a slot span or the belt, for overlays and tests. */
  clientPointOf(
    target: { cargo: number } | { shelf: number; slot: number; slots: number } | { belt: true },
  ): ClientPoint | null;
}

export type { LevelDef };
