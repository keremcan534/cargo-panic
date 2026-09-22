/**
 * The contract between the gameplay controller and a renderer.
 *
 * A view draws a board it is handed and maps pointer positions to semantic
 * targets - a package id, or a (shelf, slot) - and nothing more. It never
 * decides whether a move is legal: the controller asks the GameSession, then
 * tells the view what happened. Both the Three.js view and the Canvas 2D view
 * implement this, which is what guarantees they play by the same rules.
 *
 * Views must not import from src/app or mutate game state.
 */

import type { LevelDef } from '../game/levels/types';
import type { SlotTarget, TargetKind } from '../game/session/types';
import type { BoardEval, Placement } from '../game/systems/BalanceSystem';

export type RenderMode = '2d' | '3d';

/** Read model a view draws from. Always derived from the GameSession. */
export interface BoardView {
  level: LevelDef;
  /** Belt order; index 0 is the live package. */
  queue: readonly number[];
  /** Committed placements. A package being dragged still appears here. */
  placements: readonly Placement[];
  evaluation: BoardEval;
  /** A hazard clock is draining (drives rack wobble / danger styling). */
  danger: boolean;
}

export interface PointerSample {
  clientX: number;
  clientY: number;
  /** Touch input floats the package above the finger so it stays visible. */
  touch: boolean;
}

export type ViewHighlight = { shelf: number } | { cargo: number } | null;

export type ClientPoint = { x: number; y: number };

export interface GameView {
  readonly mode: RenderMode;

  /** Builds everything for this board with every package already in place. */
  mount(board: BoardView): void;
  /** Re-derives board visuals: tilt, shelf loads, overload glow, cracks, crush columns, belt layout. */
  sync(board: BoardView): void;
  /** Per-frame animation. */
  update(dtMs: number): void;
  /** Releases every object, texture, listener and timer the view created. */
  dispose(): void;

  // --- pointer -> semantic target (no legality checks) ----------------------

  /** Topmost of `candidates` under the pointer. */
  pickCargo(p: PointerSample, candidates: readonly number[]): number | null;
  beginDrag(cargoId: number, p: PointerSample): void;
  moveDrag(p: PointerSample): void;
  /** Slot under the dragged package's current on-screen position, or null. */
  dragTarget(): SlotTarget | null;
  /** Slot under a tapped point for a package `slots` wide, or null. */
  targetAt(p: PointerSample, slots: number): SlotTarget | null;
  /** Ends the drag visual. The controller follows with cargoPlaced / cargoToBelt / cargoReturn. */
  endDrag(): void;

  // --- feedback ---------------------------------------------------------------

  /** Outline of the cells a package `slots` wide would occupy at `target`. */
  showGhost(target: SlotTarget, slots: number, kind: TargetKind): void;
  hideGhost(): void;
  /** Tap-to-select highlight on a package, or none. */
  setSelected(cargoId: number | null): void;
  showHint(cargoId: number, target: SlotTarget): void;
  clearHint(): void;
  /** Points at the shelf or package a message refers to (loss reason, tutorial). */
  highlight(h: ViewHighlight): void;

  // --- transitions, after the session has decided ----------------------------

  /** Animates a package into its committed slot. `onLanded` fires on touchdown. */
  cargoPlaced(cargoId: number, target: SlotTarget, opts: { quiet: boolean; onLanded?: () => void }): void;
  /** Animates a package from a shelf to the front of the belt. */
  cargoToBelt(cargoId: number): void;
  /** Animates a package back to wherever the board says it is (refused or cancelled drop). */
  cargoReturn(cargoId: number): void;

  // --- shipment outcome -------------------------------------------------------

  celebrate(): void;
  /** Stowed cargo leaves the rack (Endless wave cleared). */
  dispatch(): void;
  failCollapse(direction: number): void;
  failOverload(tier: number, direction: number): void;
  failFragile(cargoId: number): void;

  /** Client-space centre of a package or of a slot span, for overlays and tests. */
  clientPointOf(target: { cargo: number } | (SlotTarget & { slots: number })): ClientPoint | null;
}

export type { LevelDef };
