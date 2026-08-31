/**
 * localStorage-backed save file. No backend, no account - if storage is
 * unavailable (private mode, blocked cookies) the game falls back to an
 * in-memory save so play is never interrupted.
 */

import { TOTAL_LEVELS } from '../levels/levels';

const KEY = 'cargo-panic.save.v1';

export interface EndlessStats {
  bestScore: number;
  bestWave: number;
  runs: number;
}

export interface SaveData {
  unlocked: number;
  /** levelId -> best star count (1-3). */
  stars: Record<number, number>;
  /** levelId -> lowest finishing imbalance achieved. */
  bestBalance: Record<number, number>;
  sound: boolean;
  haptics: boolean;
  endless: EndlessStats;
}

function blank(): SaveData {
  return {
    unlocked: 1,
    stars: {},
    bestBalance: {},
    sound: true,
    haptics: true,
    endless: { bestScore: 0, bestWave: 0, runs: 0 },
  };
}

class Progress {
  private data: SaveData = blank();
  private storageOk = true;

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        const d = blank();
        if (typeof parsed.unlocked === 'number') {
          d.unlocked = Math.min(Math.max(1, Math.floor(parsed.unlocked)), TOTAL_LEVELS);
        }
        if (parsed.stars && typeof parsed.stars === 'object') {
          for (const [k, v] of Object.entries(parsed.stars)) {
            const id = Number(k);
            if (id >= 1 && id <= TOTAL_LEVELS && typeof v === 'number') {
              d.stars[id] = Math.min(3, Math.max(0, Math.floor(v)));
            }
          }
        }
        if (parsed.bestBalance && typeof parsed.bestBalance === 'object') {
          for (const [k, v] of Object.entries(parsed.bestBalance)) {
            const id = Number(k);
            if (id >= 1 && id <= TOTAL_LEVELS && typeof v === 'number' && isFinite(v)) {
              d.bestBalance[id] = v;
            }
          }
        }
        if (typeof parsed.sound === 'boolean') d.sound = parsed.sound;
        if (typeof parsed.haptics === 'boolean') d.haptics = parsed.haptics;
        // Saves written before Endless mode existed simply lack this block.
        const e = parsed.endless;
        if (e && typeof e === 'object') {
          if (typeof e.bestScore === 'number' && isFinite(e.bestScore)) {
            d.endless.bestScore = Math.max(0, Math.floor(e.bestScore));
          }
          if (typeof e.bestWave === 'number' && isFinite(e.bestWave)) {
            d.endless.bestWave = Math.max(0, Math.floor(e.bestWave));
          }
          if (typeof e.runs === 'number' && isFinite(e.runs)) {
            d.endless.runs = Math.max(0, Math.floor(e.runs));
          }
        }
        this.data = d;
      }
    } catch {
      this.storageOk = false;
      this.data = blank();
    }
  }

  private save() {
    if (!this.storageOk) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      this.storageOk = false;
    }
  }

  get unlocked() {
    return this.data.unlocked;
  }

  get soundOn() {
    return this.data.sound;
  }

  get hapticsOn() {
    return this.data.haptics;
  }

  isUnlocked(levelId: number) {
    return levelId <= this.data.unlocked;
  }

  starsFor(levelId: number) {
    return this.data.stars[levelId] ?? 0;
  }

  bestBalanceFor(levelId: number): number | null {
    const v = this.data.bestBalance[levelId];
    return v === undefined ? null : v;
  }

  totalStars() {
    let n = 0;
    for (const id of Object.keys(this.data.stars)) n += this.data.stars[Number(id)];
    return n;
  }

  completedCount() {
    return Object.values(this.data.stars).filter((s) => s > 0).length;
  }

  /** Records a win and reports which personal records it beat. */
  recordWin(
    levelId: number,
    stars: number,
    imbalance: number,
  ): { starsImproved: boolean; balanceImproved: boolean } {
    const starsImproved = stars > this.starsFor(levelId);
    if (starsImproved || this.data.stars[levelId] === undefined) {
      this.data.stars[levelId] = Math.max(stars, this.starsFor(levelId));
    }

    const prevBal = this.data.bestBalance[levelId];
    const balanceImproved = prevBal === undefined || imbalance < prevBal - 1e-9;
    if (balanceImproved) this.data.bestBalance[levelId] = imbalance;

    if (levelId + 1 <= TOTAL_LEVELS && this.data.unlocked < levelId + 1) {
      this.data.unlocked = levelId + 1;
    }
    this.save();
    return { starsImproved, balanceImproved };
  }

  get endless(): EndlessStats {
    return this.data.endless;
  }

  /** Records a finished Endless run. Returns true on a new high score. */
  recordRun(score: number, wave: number): boolean {
    const e = this.data.endless;
    e.runs++;
    const improved = score > e.bestScore;
    if (improved) e.bestScore = score;
    if (wave > e.bestWave) e.bestWave = wave;
    this.save();
    return improved;
  }

  setSound(on: boolean) {
    this.data.sound = on;
    this.save();
  }

  setHaptics(on: boolean) {
    this.data.haptics = on;
    this.save();
  }

  resetAll() {
    this.data = blank();
    this.save();
  }
}

export const progress = new Progress();
