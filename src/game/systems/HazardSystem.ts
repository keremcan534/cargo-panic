/**
 * The grace-period clocks.
 *
 * Three things can fail a level - too much imbalance, an overloaded shelf, and
 * fragile cargo being crushed - and all three work the same way: while the
 * condition holds, a timer drains; the moment the player fixes it, the timer
 * refills. Nothing in Cargo Panic fails instantly.
 */

import { CRITICAL_RATIO, GRACE_MS } from '../config';
import type { LevelDef } from '../levels/types';
import type { BoardEval } from './BalanceSystem';

export type HazardKind = 'balance' | 'overload' | 'fragile';

export interface HazardState {
  /** The most urgent active hazard, or null when the rack is happy. */
  kind: HazardKind | null;
  /** Milliseconds left before this hazard fails the level. */
  remaining: number;
  /** Full duration of that grace period, for drawing the countdown bar. */
  total: number;
  /** Shelf tier for 'overload', package id for 'fragile', otherwise -1. */
  owner: number;
  /** 0 at the moment the hazard appears, 1 when the timer runs out. */
  urgency: number;
  /** True on the frame the timer hits zero. */
  expired: boolean;
}

const CLEAR: HazardState = {
  kind: null,
  remaining: 0,
  total: 1,
  owner: -1,
  urgency: 0,
  expired: false,
};

export class HazardSystem {
  private readonly grace: { balance: number; overload: number; fragile: number };
  private balance: number;
  private overload = new Map<number, number>();
  private fragile = new Map<number, number>();

  /**
   * `graceScale` shortens every countdown. Endless mode uses it to keep the
   * pressure rising once package count and tolerance have bottomed out.
   */
  constructor(
    private level: LevelDef,
    graceScale = 1,
  ) {
    const s = Math.max(0.3, Math.min(1, graceScale));
    this.grace = {
      balance: GRACE_MS.balance * s,
      overload: GRACE_MS.overload * s,
      fragile: GRACE_MS.fragile * s,
    };
    this.balance = this.grace.balance;
  }

  reset() {
    this.balance = this.grace.balance;
    this.overload.clear();
    this.fragile.clear();
  }

  /** Advances every clock and reports the one closest to failing. */
  update(ev: BoardEval, deltaMs: number): HazardState {
    const tol = this.level.balanceTolerance;

    // Imbalance well past the red line burns the clock twice as fast.
    if (ev.status === 'danger') {
      this.balance -= deltaMs * (ev.imbalance > tol * CRITICAL_RATIO ? 2 : 1);
    } else {
      this.balance = this.grace.balance;
    }

    for (let t = 0; t < this.level.shelves.length; t++) {
      if (ev.overloaded.includes(t)) {
        this.overload.set(t, (this.overload.get(t) ?? this.grace.overload) - deltaMs);
      } else {
        this.overload.delete(t);
      }
    }

    for (const id of [...this.fragile.keys()]) {
      if (!ev.crushed.includes(id)) this.fragile.delete(id);
    }
    for (const id of ev.crushed) {
      this.fragile.set(id, (this.fragile.get(id) ?? this.grace.fragile) - deltaMs);
    }

    let kind: HazardKind | null = null;
    let remaining = Infinity;
    let total = 1;
    let owner = -1;

    if (ev.status === 'danger') {
      kind = 'balance';
      remaining = this.balance;
      total = this.grace.balance;
    }
    for (const [tier, left] of this.overload) {
      if (left < remaining) {
        kind = 'overload';
        remaining = left;
        total = this.grace.overload;
        owner = tier;
      }
    }
    for (const [id, left] of this.fragile) {
      if (left < remaining) {
        kind = 'fragile';
        remaining = left;
        total = this.grace.fragile;
        owner = id;
      }
    }

    if (!kind) return CLEAR;

    return {
      kind,
      remaining,
      total,
      owner,
      urgency: Math.min(1, Math.max(0, 1 - remaining / total)),
      expired: remaining <= 0,
    };
  }
}
