import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY } from './schema';
import { createPrefsStore, type KeyValueStorage } from './store';

function memory(initial?: string): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[PREFS_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('prefs store', () => {
  it('writes nothing until something changes', () => {
    const storage = memory();
    const store = createPrefsStore(() => storage);
    expect(store.get()).toEqual(DEFAULT_PREFS);
    expect(storage.data.size).toBe(0);
  });

  it('writes a change, notifies subscribers and reads it back', () => {
    const storage = memory();
    const store = createPrefsStore(() => storage);
    const seen = vi.fn();
    store.subscribe(seen);
    store.update((p) => ({ ...p, theme: 'dark' }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(createPrefsStore(() => storage).get().theme).toBe('dark');
  });

  it('keeps working in memory when storage throws or is missing', () => {
    const throwing: KeyValueStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    for (const source of [() => throwing, () => undefined, () => { throw new Error('no access'); }]) {
      const store = createPrefsStore(source);
      expect(store.get()).toEqual(DEFAULT_PREFS);
      store.update((p) => ({ ...p, moreDetailsOpen: true }));
      expect(store.get().moreDetailsOpen).toBe(true);
      expect(() => store.reset()).not.toThrow();
      expect(store.get()).toEqual(DEFAULT_PREFS);
    }
  });

  it('does not overwrite a higher version until the person changes something', () => {
    const storage = memory('{"v":2,"theme":"dark"}');
    const store = createPrefsStore(() => storage);
    expect(store.get()).toEqual(DEFAULT_PREFS);
    expect(storage.data.get(PREFS_KEY)).toBe('{"v":2,"theme":"dark"}');
  });

  it('reset clears the stored key', () => {
    const storage = memory('{"v":1,"theme":"dark"}');
    const store = createPrefsStore(() => storage);
    store.reset();
    expect(storage.data.has(PREFS_KEY)).toBe(false);
    expect(store.get().theme).toBe('system');
  });
});
