import { describe, expect, it, vi } from 'vitest';
import { openPalette, subscribePalette, togglePalette } from './palette-bus';

describe('the palette signal', () => {
  it('tells every subscribed host what was asked', () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribePalette(a);
    const stopB = subscribePalette(b);
    openPalette();
    togglePalette();
    expect(a.mock.calls).toEqual([['open'], ['toggle']]);
    expect(b.mock.calls).toEqual([['open'], ['toggle']]);
    stopA();
    stopB();
  });

  it('stops telling a host once it has unsubscribed, and does nothing with no host', () => {
    const listener = vi.fn();
    const stop = subscribePalette(listener);
    stop();
    openPalette();
    togglePalette();
    expect(listener).not.toHaveBeenCalled();
  });
});
