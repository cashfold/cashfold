// The preference store (FR-051, R-UX-08): read once, write on change, follow other tabs through the `storage` event, and fall back to memory
// when localStorage is unavailable (private window, blocked site data, quota). Nothing here reaches the Core Worker, sync or export.
import { DEFAULT_PREFS, PREFS_KEY, parsePrefs, serializePrefs, type Prefs } from './schema';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PrefsStore {
  get(): Prefs;
  /** Applies a change and writes it. Returns nothing: a failed write leaves the new value in memory for this session. */
  update(change: (prev: Prefs) => Prefs): void;
  /** Clears the stored object and returns to the defaults ("Reset interface settings"). */
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createPrefsStore(storageOf: () => KeyValueStorage | undefined): PrefsStore {
  const listeners = new Set<() => void>();
  let current: Prefs | undefined;

  const storage = (): KeyValueStorage | undefined => {
    try {
      return storageOf();
    } catch {
      return undefined;
    }
  };
  const read = (): Prefs => {
    try {
      return parsePrefs(storage()?.getItem(PREFS_KEY));
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  };
  const emit = () => listeners.forEach((l) => l());
  // Another tab changed the preferences: take its value.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== PREFS_KEY) return;
    current = read();
    emit();
  };

  return {
    get() {
      current ??= read();
      return current;
    },
    update(change) {
      const next = change(this.get());
      if (next === current) return;
      current = next;
      try {
        storage()?.setItem(PREFS_KEY, serializePrefs(next));
      } catch {
        // Quota or blocked storage: the change lives in memory for this session. No error UI (data-model §1 Lifecycle).
      }
      emit();
    },
    reset() {
      current = structuredClone(DEFAULT_PREFS);
      try {
        storage()?.removeItem(PREFS_KEY);
      } catch {
        // Nothing to clear.
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
  };
}
