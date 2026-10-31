import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, isRevealed, reveal, REVEAL_MS, subscribe } from './reveal-store';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clear();
  vi.useRealTimers();
});

describe('the reveal store', () => {
  it('shows one amount for five seconds and then hides it by itself', () => {
    expect(REVEAL_MS).toBe(5000);
    reveal('a');
    expect(isRevealed('a')).toBe(true);
    vi.advanceTimersByTime(REVEAL_MS - 1);
    expect(isRevealed('a')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isRevealed('a')).toBe(false);
  });

  it('never shows another amount when one is revealed', () => {
    reveal('a');
    expect(isRevealed('b')).toBe(false);
  });

  it('starts the time over when the same amount is revealed again', () => {
    reveal('a');
    vi.advanceTimersByTime(4000);
    reveal('a');
    vi.advanceTimersByTime(4000);
    expect(isRevealed('a')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(isRevealed('a')).toBe(false);
  });

  it('keeps a separate time for each amount', () => {
    reveal('a');
    vi.advanceTimersByTime(3000);
    reveal('b');
    vi.advanceTimersByTime(2000);
    expect(isRevealed('a')).toBe(false);
    expect(isRevealed('b')).toBe(true);
  });

  it('hides everything at once on clear, stops the timers, and tells subscribers once', () => {
    const listener = vi.fn();
    const stop = subscribe(listener);
    reveal('a');
    reveal('b');
    listener.mockClear();
    clear();
    expect(isRevealed('a')).toBe(false);
    expect(isRevealed('b')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REVEAL_MS * 2);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('says nothing when there was nothing to hide', () => {
    const listener = vi.fn();
    const stop = subscribe(listener);
    clear();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('stops telling a subscriber once it has unsubscribed', () => {
    const listener = vi.fn();
    subscribe(listener)();
    reveal('a');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('how many amounts are shown', () => {
  it('counts the revealed amounts', async () => {
    const { shownCount } = await import('./reveal-store');
    expect(shownCount()).toBe(0);
    reveal('a');
    reveal('b');
    expect(shownCount()).toBe(2);
    clear();
    expect(shownCount()).toBe(0);
  });
});
