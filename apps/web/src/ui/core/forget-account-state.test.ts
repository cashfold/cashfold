import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_KEY } from '../palette/history';
import { forgetAccountScopedState } from './CoreProvider';

// The command palette's history belongs to the account: it goes whenever the account leaves the device (sign-out, using a different account, removal) because
// all of those end in forgetAccountScopedState (spec 015, FR-011).

class FakeStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

afterEach(() => vi.unstubAllGlobals());

describe('what the page forgets when an account leaves the device', () => {
  it('removes the palette history, and leaves the device preferences alone', () => {
    const storage = new FakeStorage();
    storage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, items: [{ id: 'c:help', n: 2, t: 5 }] }));
    storage.setItem('cashfold.ui', JSON.stringify({ v: 1, theme: 'dark' }));
    vi.stubGlobal('window', { localStorage: storage });
    forgetAccountScopedState();
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
    expect(storage.getItem('cashfold.ui')).not.toBeNull();
  });

  it('does not fail when there is nothing stored', () => {
    vi.stubGlobal('window', { localStorage: new FakeStorage() });
    expect(() => forgetAccountScopedState()).not.toThrow();
  });
});
