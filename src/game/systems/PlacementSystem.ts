/**
 * Owns the authoritative board state - which package sits in which slot - and
 * answers the questions the drag handler needs to ask on every pointer move.
 */

import { CRUSH_WEIGHT } from '../config';
import { PACKAGE_SPECS } from '../levels/types';
import type { LevelDef, PackageType } from '../levels/types';
import { checkPlacement, evaluate, placementTorque } from './BalanceSystem';
import type { BoardEval, PlaceRejection, Placement } from './BalanceSystem';

export class PlacementSystem {
  private byId = new Map<number, Placement>();

  constructor(private level: LevelDef) {}

  get list(): Placement[] {
    return [...this.byId.values()];
  }

  get count(): number {
    return this.byId.size;
  }

  has(id: number) {
    return this.byId.has(id);
  }

  get(id: number) {
    return this.byId.get(id);
  }

  place(id: number, type: PackageType, shelf: number, slot: number) {
    // Frozen so a read-out handed to a view can never edit the board.
    this.byId.set(id, Object.freeze({ id, type, shelf, slot }));
  }

  remove(id: number) {
    this.byId.delete(id);
  }

  clear() {
    this.byId.clear();
  }

  check(type: PackageType, shelf: number, slot: number, ignoreId = -1): PlaceRejection | null {
    return checkPlacement(this.level, this.list, type, shelf, slot, ignoreId);
  }

  evaluate(): BoardEval {
    return evaluate(this.level, this.list);
  }

  /** Net torque the rack would show if this package landed here. */
  previewNet(type: PackageType, shelf: number, slot: number, ignoreId = -1): number {
    const others = this.list.filter((p) => p.id !== ignoreId);
    others.push({ id: -999, type, shelf, slot });
    return evaluate(this.level, others).net;
  }

  /** Full evaluation of the hypothetical board, used for crush previews. */
  previewEval(type: PackageType, shelf: number, slot: number, ignoreId = -1): BoardEval {
    const others = this.list.filter((p) => p.id !== ignoreId);
    others.push({ id: -999, type, shelf, slot });
    return evaluate(this.level, others);
  }

  /** Weight currently resting on each tier. */
  shelfWeights(): number[] {
    const out = new Array<number>(this.level.shelves.length).fill(0);
    for (const p of this.byId.values()) out[p.shelf] += PACKAGE_SPECS[p.type].weight;
    return out;
  }

  torqueOf(id: number): number {
    const p = this.byId.get(id);
    return p ? placementTorque(this.level, p) : 0;
  }

  /** True if this package is heavy enough to crush fragile cargo. */
  static isCrusher(type: PackageType) {
    return PACKAGE_SPECS[type].weight >= CRUSH_WEIGHT;
  }
}
