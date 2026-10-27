import { describe, expect, it, vi } from 'vitest';
import { afterOverlaysLeave, dismissOverlays, subscribeOverlays } from './overlay-signal';

describe('dismissing the overlays', () => {
  it('tells everything that is listening, and stops after unsubscribing', () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeOverlays(a);
    subscribeOverlays(b)();
    dismissOverlays();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    stopA();
    dismissOverlays();
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe('dismissing the overlays and waiting for them to leave', () => {
  it('counts only the panels that were open', () => {
    const stopOpen = subscribeOverlays(() => true);
    const stopShut = subscribeOverlays(() => false);
    const stopSilent = subscribeOverlays(() => undefined);
    expect(dismissOverlays()).toBe(2);
    stopOpen();
    stopShut();
    stopSilent();
    expect(dismissOverlays()).toBe(0);
  });

  it('runs the action when nothing is leaving, and after the panels have left otherwise', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    let leaving = true;
    afterOverlaysLeave(run, () => leaving);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).not.toHaveBeenCalled();
    leaving = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledTimes(1);
    const now = vi.fn();
    afterOverlaysLeave(now, () => false);
    expect(now).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('gives up waiting after a second, so a stuck transition cannot swallow the shortcut', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    afterOverlaysLeave(run, () => true);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
