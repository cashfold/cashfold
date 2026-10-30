// What the palette remembers on this device (spec 015, data-model.md §4): which entries were opened or run, how often and when. Only an opaque entry id, a
// count and a time are kept, never a name, an amount or the text typed. One key, because the app holds one account per device; it is removed with the
// account's other page state (CoreProvider) and by the Settings control. A value that is not exactly what this file writes is dropped, never repaired.

export const HISTORY_KEY = 'cashfold.palette';
export const MAX_ITEMS = 24;
export const MAX_COUNT = 9999;
/** The stored value stays under this many characters. */
export const MAX_STORED_CHARS = 3000;

export interface HistoryItem {
  readonly id: string;
  /** How many times it was opened or run. */
  readonly n: number;
  /** When it was last used (milliseconds since the epoch). */
  readonly t: number;
}

const ID = /^[aegc]:[A-Za-z0-9._-]{1,64}$/;

function parse(raw: string | null): HistoryItem[] {
  if (raw === null || raw.length > MAX_STORED_CHARS) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const { v, items, ...extra } = value as Record<string, unknown>;
  if (v !== 1 || !Array.isArray(items) || items.length > MAX_ITEMS || Object.keys(extra).length > 0) return [];
  const seen = new Set<string>();
  const out: HistoryItem[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { id, n, t, ...more } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id) || Object.keys(more).length > 0) return [];
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_COUNT) return [];
    if (!Number.isSafeInteger(t) || (t as number) < 0) return [];
    seen.add(id);
    out.push({ id, n: n as number, t: t as number });
  }
  return out;
}

/** The items that stay when there are too many: the most used first, the most recently used among equals. */
function kept(items: readonly HistoryItem[]): HistoryItem[] {
  const ranked = [...items].sort((a, b) => b.n - a.n || b.t - a.t);
  let out = ranked.slice(0, MAX_ITEMS);
  while (out.length > 0 && JSON.stringify({ v: 1, items: out }).length > MAX_STORED_CHARS) out = out.slice(0, -1);
  return out;
}

export interface PaletteHistory {
  load(): HistoryItem[];
  record(entryId: string): void;
  clear(): void;
}

/** The history over a storage. Every storage call is guarded: with storage blocked the palette works, without a history. */
export function createHistory(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, now: () => number = Date.now): PaletteHistory {
  const guarded = <T>(run: (s: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) => T, fallback: T): T => {
    try {
      const s = storage();
      return s === undefined ? fallback : run(s);
    } catch {
      return fallback;
    }
  };
  const load = (): HistoryItem[] => guarded((s) => parse(s.getItem(HISTORY_KEY)), []);
  return {
    load,
    record(entryId) {
      if (!ID.test(entryId)) return;
      const items = load();
      const at = items.findIndex((item) => item.id === entryId);
      const next = at < 0 ? [...items, { id: entryId, n: 1, t: now() }] : items.map((item, i) => (i === at ? { id: item.id, n: Math.min(item.n + 1, MAX_COUNT), t: now() } : item));
      guarded((s) => s.setItem(HISTORY_KEY, JSON.stringify({ v: 1, items: kept(next) })), undefined);
    },
    clear() {
      guarded((s) => s.removeItem(HISTORY_KEY), undefined);
    },
  };
}

/** The app's history, over this device's local storage (absent while the page is prerendered). */
export const paletteHistory: PaletteHistory = createHistory(() => (typeof window === 'undefined' ? undefined : window.localStorage));
