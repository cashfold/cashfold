import { describe, expect, it } from 'vitest';
import { createHistory, HISTORY_KEY, MAX_COUNT, MAX_ITEMS, MAX_STORED_CHARS } from './history';

class FakeStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}
const make = () => {
  const storage = new FakeStorage();
  let clock = 1_000;
  const history = createHistory(() => storage, () => clock++);
  return { storage, history };
};
const id = (n: number) => `a:${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

describe('the palette history', () => {
  it('records an entry with a count of one and the time, and counts and dates a repeat', () => {
    const { history } = make();
    history.record('c:go-plan');
    history.record('a:1');
    history.record('c:go-plan');
    expect(history.load()).toEqual([{ id: 'c:go-plan', n: 2, t: 1002 }, { id: 'a:1', n: 1, t: 1001 }].sort((x, y) => x.id.localeCompare(y.id)).reverse());
  });

  it('keeps at most 24 entries, dropping the least used and then the oldest first', () => {
    const { history } = make();
    for (let i = 0; i < MAX_ITEMS; i++) history.record(id(i));
    history.record(id(0));
    history.record(id(0));
    history.record(id(99));
    const items = history.load();
    expect(items).toHaveLength(MAX_ITEMS);
    expect(items.some((item) => item.id === id(0) && item.n === 3)).toBe(true);
    expect(items.some((item) => item.id === id(99))).toBe(true);
    expect(items.some((item) => item.id === id(1))).toBe(false);
  });

  it('caps a count at 9999', () => {
    const { storage, history } = make();
    storage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, items: [{ id: 'c:help', n: MAX_COUNT, t: 5 }] }));
    history.record('c:help');
    expect(history.load()[0]!.n).toBe(MAX_COUNT);
  });

  it('keeps the stored value under its size cap', () => {
    const { storage, history } = make();
    for (let i = 0; i < 40; i++) history.record(id(i));
    expect((storage.getItem(HISTORY_KEY) ?? '').length).toBeLessThanOrEqual(MAX_STORED_CHARS);
  });

  it.each([
    ['not JSON', '{nope'],
    ['not an object', '[]'],
    ['another version', JSON.stringify({ v: 2, items: [] })],
    ['an extra field', JSON.stringify({ v: 1, items: [], name: 'x' })],
    ['an item with a name', JSON.stringify({ v: 1, items: [{ id: 'a:1', n: 1, t: 1, name: 'Checking' }] })],
    ['a bad id', JSON.stringify({ v: 1, items: [{ id: 'Checking account', n: 1, t: 1 }] })],
    ['a bad count', JSON.stringify({ v: 1, items: [{ id: 'a:1', n: 0, t: 1 }] })],
    ['a fractional count', JSON.stringify({ v: 1, items: [{ id: 'a:1', n: 1.5, t: 1 }] })],
    ['a bad time', JSON.stringify({ v: 1, items: [{ id: 'a:1', n: 1, t: -1 }] })],
    ['a repeated id', JSON.stringify({ v: 1, items: [{ id: 'a:1', n: 1, t: 1 }, { id: 'a:1', n: 2, t: 2 }] })],
    ['too many items', JSON.stringify({ v: 1, items: Array.from({ length: 25 }, (_, i) => ({ id: `a:${i}`, n: 1, t: 1 })) })],
    ['too long', JSON.stringify({ v: 1, items: [], pad: 'x'.repeat(MAX_STORED_CHARS) })],
  ])('discards %s as a whole and starts empty, never repairing it', (_name, raw) => {
    const { storage, history } = make();
    storage.setItem(HISTORY_KEY, raw);
    expect(history.load()).toEqual([]);
    history.record('c:help');
    expect(history.load()).toEqual([{ id: 'c:help', n: 1, t: 1000 }]);
  });

  it('refuses an entry id that is not one of the opaque kinds', () => {
    const { storage, history } = make();
    history.record('Checking account');
    history.record('a:1 2');
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('stores only ids, counts and times, never anything else', () => {
    const { storage, history } = make();
    history.record(id(1));
    history.record('c:help');
    const stored = JSON.parse(storage.getItem(HISTORY_KEY)!) as { v: number; items: Record<string, unknown>[] };
    expect(Object.keys(stored).sort()).toEqual(['items', 'v']);
    for (const item of stored.items) expect(Object.keys(item).sort()).toEqual(['id', 'n', 't']);
  });

  it('clears by removing the key', () => {
    const { storage, history } = make();
    history.record('c:help');
    history.clear();
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
    expect(history.load()).toEqual([]);
  });

  it('works without a history when storage is absent or throws', () => {
    const absent = createHistory(() => undefined);
    absent.record('c:help');
    absent.clear();
    expect(absent.load()).toEqual([]);
    const throwing = createHistory(() => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } }));
    expect(() => { throwing.record('c:help'); throwing.clear(); }).not.toThrow();
    expect(throwing.load()).toEqual([]);
  });
});
