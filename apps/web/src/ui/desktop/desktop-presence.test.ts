import { describe, expect, it, vi } from 'vitest';
import { clearPresence, recentFoldsOf, sendPresence, waitingCount } from './desktop-presence';

describe('the count of waiting entries', () => {
  it('is how many there are, up to 999', () => {
    expect(waitingCount([])).toBe(0);
    expect(waitingCount(Array.from({ length: 3 }) as never)).toBe(3);
    expect(waitingCount(Array.from({ length: 1500 }) as never)).toBe(999);
  });
});

describe('the Folds sent to the shell for its menus', () => {
  const folds = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `Fold ${i}` }));

  it('are at most five, with the selected Fold first', () => {
    expect(recentFoldsOf(folds, 'f3').map((f) => f.id)).toEqual(['f3', 'f0', 'f1', 'f2', 'f4']);
    expect(recentFoldsOf(folds, undefined).map((f) => f.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
  });

  it('have names of at most 40 characters, and never an empty one', () => {
    const [long, empty] = recentFoldsOf([{ id: 'a', name: 'x'.repeat(90) }, { id: 'b', name: '' }], 'a');
    expect(long!.name).toHaveLength(40);
    expect(empty!.name).not.toBe('');
  });
});

describe('telling the shell', () => {
  it('sends the count and the Folds, and clears both with nothing', async () => {
    const bridge = { setBadge: vi.fn(async () => undefined), setRecentFolds: vi.fn(async () => undefined) };
    await sendPresence(bridge, 4, [{ id: 'f', name: 'Home' }]);
    expect(bridge.setBadge).toHaveBeenCalledWith(4);
    expect(bridge.setRecentFolds).toHaveBeenCalledWith([{ id: 'f', name: 'Home' }]);
    await clearPresence(bridge);
    expect(bridge.setBadge).toHaveBeenLastCalledWith(0);
    expect(bridge.setRecentFolds).toHaveBeenLastCalledWith([]);
  });

  it('does nothing in a browser, and survives a shell that refuses', async () => {
    await expect(sendPresence(undefined, 4, [])).resolves.toBeUndefined();
    const refusing = { setBadge: vi.fn(async () => { throw new Error('refused'); }), setRecentFolds: vi.fn(async () => { throw new Error('locked'); }) };
    await expect(clearPresence(refusing)).resolves.toBeUndefined();
  });
});
