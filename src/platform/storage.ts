/**
 * Key/value persistence behind one small interface, so the save code can run
 * against localStorage in the browser, an in-memory map in tests, and a native
 * store later without changing.
 *
 * Implementations throw on failure (quota, blocked storage). Callers decide
 * what a failure means; nothing here swallows errors silently.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

/**
 * The browser's localStorage, or null when it cannot be used at all (private
 * modes and blocked site data can throw on first access).
 */
export function browserStore(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = 'cargo-panic.probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => ls.setItem(k, v),
      remove: (k) => ls.removeItem(k),
    };
  } catch {
    return null;
  }
}
