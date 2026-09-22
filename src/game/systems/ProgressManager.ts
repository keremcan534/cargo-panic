/**
 * The player's persistent progress and settings, as the rest of the game sees
 * them. Storage, versioning, backups and recovery live in game/save; this is
 * the gameplay-facing API on top.
 *
 * Loaded once at startup. A v1 save is migrated to v2 on first load (the v1
 * key is left untouched). Anything the player should know about - a recovered
 * or unreadable save, storage that cannot be written - is queued as a notice
 * for the UI (`takeSaveNotices` / `onSaveNotice`); nothing is reset silently.
 */

import { TOTAL_LEVELS } from '../levels/levels';
import { SaveStore } from '../save/SaveStore';
import type { SaveNotice, SaveStatus } from '../save/SaveStore';
import type {
  ActivePlay,
  EndlessRecord,
  LanguagePref,
  QualityPref,
  RenderModePref,
  SaveData,
  Settings,
  TutorialState,
} from '../save/schema';
import { RULESET_VERSION } from '../session/versions';
import { browserStore } from '../../platform/storage';

export type { EndlessRecord as EndlessStats, SaveNotice };

class Progress {
  private store: SaveStore;

  constructor() {
    this.store = new SaveStore(browserStore(), TOTAL_LEVELS);
    this.store.load();
  }

  private get d(): SaveData {
    return this.store.data;
  }

  // --- save health ------------------------------------------------------------

  get saveStatus(): SaveStatus {
    return this.store.status;
  }

  takeSaveNotices(): SaveNotice[] {
    return this.store.takeNotices();
  }

  onSaveNotice(fn: (n: SaveNotice) => void): () => void {
    return this.store.onNotice(fn);
  }

  /** Write immediately (lifecycle boundaries: page hidden, app backgrounded). */
  flush(): boolean {
    return this.store.flush();
  }

  // --- settings -----------------------------------------------------------------

  get settings(): Readonly<Settings> {
    return this.d.settings;
  }

  get soundOn() {
    return this.d.settings.sound;
  }

  get hapticsOn() {
    return this.d.settings.haptics;
  }

  setSound(on: boolean) {
    this.store.update((d) => (d.settings.sound = on));
  }

  setHaptics(on: boolean) {
    this.store.update((d) => (d.settings.haptics = on));
  }

  setRenderMode(mode: RenderModePref) {
    this.store.update((d) => (d.settings.renderMode = mode));
  }

  setQuality(q: QualityPref) {
    this.store.update((d) => (d.settings.quality = q));
  }

  /** null follows the system preference. */
  setReducedMotion(on: boolean | null) {
    this.store.update((d) => (d.settings.reducedMotion = on));
  }

  /** null follows the device language. */
  setLanguage(lang: LanguagePref | null) {
    this.store.update((d) => (d.settings.language = lang));
  }

  // --- campaign -------------------------------------------------------------------

  get unlocked() {
    return this.d.campaign.unlocked;
  }

  isUnlocked(levelId: number) {
    return levelId <= this.d.campaign.unlocked;
  }

  starsFor(levelId: number) {
    return this.d.campaign.stars[levelId] ?? 0;
  }

  bestBalanceFor(levelId: number): number | null {
    const v = this.d.campaign.bestBalance[levelId];
    return v === undefined ? null : v;
  }

  totalStars() {
    let n = 0;
    for (const v of Object.values(this.d.campaign.stars)) n += v;
    return n;
  }

  completedCount() {
    return Object.values(this.d.campaign.stars).filter((s) => s > 0).length;
  }

  /** Records a win and reports which personal records it beat. Stars never go down. */
  recordWin(
    levelId: number,
    stars: number,
    imbalance: number,
  ): { starsImproved: boolean; balanceImproved: boolean } {
    const c = this.d.campaign;
    const starsImproved = stars > this.starsFor(levelId);
    const prevBal = c.bestBalance[levelId];
    const balanceImproved = prevBal === undefined || imbalance < prevBal - 1e-9;
    this.store.update((d) => {
      if (starsImproved || d.campaign.stars[levelId] === undefined) {
        d.campaign.stars[levelId] = Math.max(stars, d.campaign.stars[levelId] ?? 0);
      }
      if (balanceImproved) d.campaign.bestBalance[levelId] = imbalance;
      if (levelId + 1 <= TOTAL_LEVELS && d.campaign.unlocked < levelId + 1) d.campaign.unlocked = levelId + 1;
    });
    this.store.flush();
    return { starsImproved, balanceImproved };
  }

  // --- endless ----------------------------------------------------------------------

  /** Records for the current ruleset. */
  get endless(): EndlessRecord {
    return this.d.endless[String(RULESET_VERSION)] ?? { bestScore: 0, bestWave: 0, runs: 0 };
  }

  /** Best record made under an older ruleset, shown separately as "previous rules". */
  get previousEndless(): { ruleset: number; record: EndlessRecord } | null {
    let best: { ruleset: number; record: EndlessRecord } | null = null;
    for (const [k, r] of Object.entries(this.d.endless)) {
      const v = Number(k);
      if (v >= RULESET_VERSION || r.runs === 0) continue;
      if (!best || v > best.ruleset) best = { ruleset: v, record: r };
    }
    return best;
  }

  /** Records a finished Endless run under the current ruleset. Returns true on a new high score. */
  recordRun(score: number, wave: number): boolean {
    const key = String(RULESET_VERSION);
    const improved = score > this.endless.bestScore;
    this.store.update((d) => {
      const e = d.endless[key] ?? { bestScore: 0, bestWave: 0, runs: 0 };
      e.runs++;
      if (score > e.bestScore) e.bestScore = score;
      if (wave > e.bestWave) e.bestWave = wave;
      d.endless[key] = e;
    });
    this.store.flush();
    return improved;
  }

  // --- tutorial ----------------------------------------------------------------------

  get tutorial(): Readonly<TutorialState> {
    return this.d.tutorial;
  }

  markTutorial(step: string) {
    if (this.d.tutorial.done.includes(step)) return;
    this.store.update((d) => d.tutorial.done.push(step));
  }

  setTutorialSkipped(skipped: boolean) {
    this.store.update((d) => {
      d.tutorial.skipped = skipped;
      if (!skipped) d.tutorial.done = [];
    });
  }

  markCargoSeen(type: string) {
    if (this.d.tutorial.seenCargo.includes(type)) return;
    this.store.update((d) => d.tutorial.seenCargo.push(type));
  }

  // --- active play and rewards -----------------------------------------------------------

  get active(): ActivePlay | null {
    return this.d.active;
  }

  /** Saves (or clears) the resumable game. Written at the next commit boundary. */
  setActive(a: ActivePlay | null) {
    this.store.update((d) => (d.active = a));
  }

  /** Grants a reward exactly once per id; the effect and the id are written together. */
  claim(rewardId: string, apply: (d: SaveData) => void): boolean {
    return this.store.claim(rewardId, apply);
  }

  hasClaimed(rewardId: string): boolean {
    return this.store.hasClaimed(rewardId);
  }
}

export const progress = new Progress();
