import { describe, expect, it, vi } from 'vitest';
import { createBackgroundMode, type BackgroundWindowLike } from './background';

const fakeWindow = (over: Partial<BackgroundWindowLike> = {}) => ({
  hide: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  isMinimized: vi.fn(() => false),
  restore: vi.fn(),
  isDestroyed: vi.fn(() => false),
  ...over,
});

describe('closing the window', () => {
  it('when switched off, closes as it always did: not prevented, nothing hidden, and the app quits when no window is left (not on macOS)', () => {
    const mode = createBackgroundMode({ enabled: () => false });
    const event = { preventDefault: vi.fn() };
    const win = fakeWindow();
    expect(mode.handleClose(event, win)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
    expect(mode.quitWhenAllClosed('win32')).toBe(true);
    expect(mode.quitWhenAllClosed('linux')).toBe(true);
    expect(mode.quitWhenAllClosed('darwin')).toBe(false);
  });

  it('when switched on, hides the window instead of closing it, and keeps the app running everywhere', () => {
    const mode = createBackgroundMode({ enabled: () => true });
    const event = { preventDefault: vi.fn() };
    const win = fakeWindow();
    expect(mode.handleClose(event, win)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(win.hide).toHaveBeenCalledOnce();
    expect(mode.quitWhenAllClosed('win32')).toBe(false);
    expect(mode.quitWhenAllClosed('linux')).toBe(false);
  });

  it('follows the switch as it changes', () => {
    let on = false;
    const mode = createBackgroundMode({ enabled: () => on });
    expect(mode.keepsRunning()).toBe(false);
    on = true;
    expect(mode.keepsRunning()).toBe(true);
  });

  it('really closes once quitting has begun', () => {
    const mode = createBackgroundMode({ enabled: () => true });
    mode.markQuitting();
    const event = { preventDefault: vi.fn() };
    const win = fakeWindow();
    expect(mode.isQuitting()).toBe(true);
    expect(mode.handleClose(event, win)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
    expect(mode.quitWhenAllClosed('linux')).toBe(true);
  });
});

describe('bringing the window back', () => {
  const mode = createBackgroundMode({ enabled: () => true });

  it('shows and focuses a hidden window', () => {
    const win = fakeWindow();
    expect(mode.reveal(win)).toBe(true);
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(win.restore).not.toHaveBeenCalled();
  });

  it('restores a minimised window first', () => {
    const win = fakeWindow({ isMinimized: vi.fn(() => true) });
    mode.reveal(win);
    expect(win.restore).toHaveBeenCalledOnce();
  });

  it('says so when there is no window to bring back', () => {
    expect(mode.reveal(undefined)).toBe(false);
    expect(mode.reveal(fakeWindow({ isDestroyed: vi.fn(() => true) }))).toBe(false);
  });
});
