/**
 * Builds real v2 save payloads for browser tests, through the game's own
 * SaveStore (so the checksum and envelope match what the app writes).
 * Runs in the Playwright (Node) process; the result is seeded into
 * localStorage by an init script.
 */

import { TOTAL_LEVELS } from '../../../src/game/levels/levels';
import { SAVE_KEYS, SaveStore } from '../../../src/game/save/SaveStore';
import type { SaveData } from '../../../src/game/save/schema';
import { MemoryStore } from '../../../src/platform/storage';

export const SAVE_KEY = SAVE_KEYS.main;

/** A v2 save with `edit` applied (defaults: sound and vibration off, everything unlocked up to `unlocked`). */
export function v2Save(edit: (d: SaveData) => void = () => undefined, unlocked = TOTAL_LEVELS): string {
  const mem = new MemoryStore();
  const store = new SaveStore(mem, TOTAL_LEVELS);
  store.load();
  store.update((d) => {
    d.settings.sound = false;
    d.settings.haptics = false;
    d.campaign.unlocked = unlocked;
    edit(d);
  });
  store.flush();
  const raw = mem.get(SAVE_KEYS.main);
  if (!raw) throw new Error('SaveStore wrote nothing');
  return raw;
}

/** The `data` part of a stored v2 save. */
export function saveData(raw: string | null): SaveData | null {
  if (!raw) return null;
  return (JSON.parse(raw) as { data: SaveData }).data;
}
