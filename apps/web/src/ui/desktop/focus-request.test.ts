import { describe, expect, it, vi } from 'vitest';
import { focusRequests } from './focus-request';

describe('a held focus request', () => {
  it('is taken once, by the target it was for', () => {
    focusRequests.request('data-import');
    expect(focusRequests.take('data-export')).toBe(false);
    expect(focusRequests.take('data-import')).toBe(true);
    expect(focusRequests.take('data-import')).toBe(false);
  });

  it('tells a screen that is already there', () => {
    const listener = vi.fn();
    const stop = focusRequests.subscribe(listener);
    focusRequests.request('transactions-search');
    expect(listener).toHaveBeenCalledOnce();
    stop();
    focusRequests.take('transactions-search');
  });
});
