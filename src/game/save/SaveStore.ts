/**
 * Durable save with a backup, a checksum and loud failure.
 *
 * Layout in the key/value store:
 *   cargo-panic.save.v2         current save  { v: 2, sum, data }
 *   cargo-panic.save.v2.bak     the previous successful write (rotated on every write)
 *   cargo-panic.save.v1         legacy save, left untouched so an older build still reads it
 *   cargo-panic.save.v1.backup  copy of the v1 save taken at migration time
 *   cargo-panic.save.corrupt    an unreadable save, quarantined instead of overwritten
 *
 * Rules:
 * - Nothing is ever silently reset. Every recovery or failure produces a
 *   notice the UI must show.
 * - A save from a newer build is never overwritten: the game runs from memory
 *   and says progress will not be kept.
 * - Writes are coalesced within one task (queueMicrotask) and happen only at
 *   commit, reward and lifecycle boundaries - never per frame. `flush()`
 *   writes immediately; reward claims always flush.
 */

import type { KeyValueStore } from '../../platform/storage';
import { MemoryStore } from '../../platform/storage';
import { blankSave, CLAIMED_LIMIT, migrateV1, SAVE_VERSION, sanitizeV2 } from './schema';
import type { SaveData } from './schema';

export const SAVE_KEYS = {
  main: 'cargo-panic.save.v2',
  backup: 'cargo-panic.save.v2.bak',
  v1: 'cargo-panic.save.v1',
  v1Backup: 'cargo-panic.save.v1.backup',
  corrupt: 'cargo-panic.save.corrupt',
} as const;

export type LoadSource =
  | 'fresh'
  | 'v2'
  | 'migrated-v1'
  | 'recovered-backup'
  | 'recovered-v1'
  | 'unreadable'
  | 'newer-version'
  | 'no-storage';

/** Player-facing conditions. The UI maps each to a message. */
export type SaveNotice =
  | 'recovered-backup'
  | 'recovered-v1'
  | 'unreadable'
  | 'newer-version'
  | 'no-storage'
  | 'write-failed'
  | 'active-dropped';

export interface SaveStatus {
  /** False when progress is only held in memory. */
  persistent: boolean;
  /** The last write attempt failed (cleared by the next successful write). */
  writeFailed: boolean;
  source: LoadSource;
}

function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

type Parsed = { kind: 'ok'; data: SaveData; droppedActive: boolean } | { kind: 'newer' } | { kind: 'bad' };

function parseEnvelope(raw: string, totalLevels: number): Parsed {
  let env: unknown;
  try {
    env = JSON.parse(raw);
  } catch {
    return { kind: 'bad' };
  }
  if (typeof env !== 'object' || env === null) return { kind: 'bad' };
  const e = env as { v?: unknown; sum?: unknown; data?: unknown };
  if (typeof e.v === 'number' && e.v > SAVE_VERSION) return { kind: 'newer' };
  if (e.v !== SAVE_VERSION || typeof e.sum !== 'string') return { kind: 'bad' };
  if (checksum(JSON.stringify(e.data)) !== e.sum) return { kind: 'bad' };
  const s = sanitizeV2(e.data, totalLevels);
  return s ? { kind: 'ok', ...s } : { kind: 'bad' };
}

export class SaveStore {
  private store: KeyValueStore;
  private dataValue: SaveData = blankSave();
  private statusValue: SaveStatus = { persistent: true, writeFailed: false, source: 'fresh' };
  private readOnly = false;
  private scheduled = false;
  private lastWritten: string | null = null;
  private noticeQueue: SaveNotice[] = [];
  private listeners = new Set<(n: SaveNotice) => void>();

  constructor(
    store: KeyValueStore | null,
    private totalLevels: number,
  ) {
    if (store) {
      this.store = store;
    } else {
      this.store = new MemoryStore();
      this.statusValue = { persistent: false, writeFailed: false, source: 'no-storage' };
      this.readOnly = true;
      this.notify('no-storage');
    }
  }

  get data(): SaveData {
    return this.dataValue;
  }

  get status(): SaveStatus {
    return { ...this.statusValue };
  }

  /** Notices raised so far that nobody has consumed yet (load happens before the UI exists). */
  takeNotices(): SaveNotice[] {
    const n = this.noticeQueue;
    this.noticeQueue = [];
    return n;
  }

  onNotice(fn: (n: SaveNotice) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  load(): LoadSource {
    if (this.statusValue.source === 'no-storage') return 'no-storage';
    let main: string | null;
    let backup: string | null;
    try {
      main = this.store.get(SAVE_KEYS.main);
      backup = this.store.get(SAVE_KEYS.backup);
    } catch {
      return this.fallBackToMemory();
    }

    if (main !== null) {
      const p = parseEnvelope(main, this.totalLevels);
      if (p.kind === 'ok') return this.accept(p.data, 'v2', main, p.droppedActive);
      if (p.kind === 'newer') {
        this.readOnly = true;
        this.statusValue = { persistent: false, writeFailed: false, source: 'newer-version' };
        this.notify('newer-version');
        return 'newer-version';
      }
      this.quarantine(main);
      return this.recover(backup);
    }

    if (backup !== null) return this.recover(backup);

    const v1raw = this.safeGet(SAVE_KEYS.v1);
    if (v1raw !== null) {
      const v1 = this.parseV1(v1raw);
      if (v1) return this.migrateFromV1(v1, 'migrated-v1');
      // An unreadable v1 is left where it is and copied aside; progress restarts, loudly.
      this.quarantine(v1raw);
      this.notify('unreadable');
      const src = this.accept(blankSave(), 'unreadable', null, false);
      this.flush();
      return src;
    }
    return this.accept(blankSave(), 'fresh', null, false);
  }

  private recover(backup: string | null): LoadSource {
    if (backup !== null) {
      const b = parseEnvelope(backup, this.totalLevels);
      if (b.kind === 'ok') {
        this.notify('recovered-backup');
        // lastWritten stays null so the flush rewrites the damaged main key.
        const src = this.accept(b.data, 'recovered-backup', null, b.droppedActive);
        this.flush();
        return src;
      }
    }
    const v1 = this.parseV1(this.safeGet(SAVE_KEYS.v1));
    if (v1) {
      this.notify('recovered-v1');
      return this.migrateFromV1(v1, 'recovered-v1');
    }
    this.notify('unreadable');
    const src = this.accept(blankSave(), 'unreadable', null, false);
    this.flush();
    return src;
  }

  private parseV1(raw: string | null): { raw: string; value: unknown } | null {
    if (raw === null) return null;
    try {
      return { raw, value: JSON.parse(raw) };
    } catch {
      return null;
    }
  }

  private migrateFromV1(v1: { raw: string; value: unknown }, source: 'migrated-v1' | 'recovered-v1'): LoadSource {
    try {
      if (this.store.get(SAVE_KEYS.v1Backup) === null) this.store.set(SAVE_KEYS.v1Backup, v1.raw);
    } catch {
      /* the v1 key itself is still intact */
    }
    this.accept(migrateV1(v1.value, this.totalLevels), source, null, false);
    this.flush();
    return source;
  }

  private accept(data: SaveData, source: LoadSource, raw: string | null, droppedActive: boolean): LoadSource {
    this.dataValue = data;
    this.lastWritten = raw;
    this.statusValue = { ...this.statusValue, source };
    if (droppedActive) this.notify('active-dropped');
    return source;
  }

  private quarantine(raw: string) {
    try {
      this.store.set(SAVE_KEYS.corrupt, raw);
    } catch {
      /* best effort; the original key is only overwritten after this */
    }
  }

  private safeGet(key: string): string | null {
    try {
      return this.store.get(key);
    } catch {
      return null;
    }
  }

  private fallBackToMemory(): LoadSource {
    this.readOnly = true;
    this.statusValue = { persistent: false, writeFailed: false, source: 'no-storage' };
    this.notify('no-storage');
    return 'no-storage';
  }

  // --------------------------------------------------------------------------
  // Writing
  // --------------------------------------------------------------------------

  /** Mutate the save; the write is coalesced with any others in this task. */
  update(fn: (d: SaveData) => void) {
    fn(this.dataValue);
    this.markDirty();
  }

  markDirty() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      if (this.scheduled) this.flush();
    });
  }

  /**
   * Grants a reward exactly once. `apply` runs only if `rewardId` has never
   * been claimed; the id and the effect are written in the same flush.
   */
  claim(rewardId: string, apply: (d: SaveData) => void): boolean {
    if (this.dataValue.claimed.includes(rewardId)) return false;
    apply(this.dataValue);
    this.dataValue.claimed.push(rewardId);
    if (this.dataValue.claimed.length > CLAIMED_LIMIT) {
      this.dataValue.claimed.splice(0, this.dataValue.claimed.length - CLAIMED_LIMIT);
    }
    this.flush();
    return true;
  }

  hasClaimed(rewardId: string): boolean {
    return this.dataValue.claimed.includes(rewardId);
  }

  /** Writes now. Returns false if the data could not be persisted. */
  flush(): boolean {
    this.scheduled = false;
    if (this.readOnly) return false;
    const body = JSON.stringify(this.dataValue);
    const payload = `{"v":${SAVE_VERSION},"sum":"${checksum(body)}","data":${body}}`;
    if (payload === this.lastWritten) return true;
    try {
      if (this.lastWritten !== null) this.store.set(SAVE_KEYS.backup, this.lastWritten);
      this.store.set(SAVE_KEYS.main, payload);
      this.lastWritten = payload;
      if (this.statusValue.writeFailed) this.statusValue = { ...this.statusValue, writeFailed: false };
      return true;
    } catch {
      if (!this.statusValue.writeFailed) {
        this.statusValue = { ...this.statusValue, writeFailed: true };
        this.notify('write-failed');
      }
      return false;
    }
  }

  private notify(n: SaveNotice) {
    this.noticeQueue.push(n);
    for (const fn of this.listeners) fn(n);
  }
}
