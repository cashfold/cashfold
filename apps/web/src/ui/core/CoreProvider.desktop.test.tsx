import { describe, expect, it, vi } from 'vitest';
import { createSessionHandlers, type LockPolicyInput } from './lock-policy';

function setup(initial: LockPolicyInput) {
  let policy = initial;
  const deps = { policy: () => policy, setHidden: vi.fn(), setBlurred: vi.fn(), notify: vi.fn() };
  return { handlers: createSessionHandlers(deps), deps, set: (next: LockPolicyInput) => (policy = next) };
}

describe('in a browser', () => {
  it('covers and tells the worker on blur, and lifts the cover on focus', () => {
    const { handlers, deps } = setup({ isDesktop: false, hideOnBlur: false });
    handlers.onBlur();
    expect(deps.setBlurred).toHaveBeenLastCalledWith(true);
    expect(deps.notify).toHaveBeenLastCalledWith('session.focus', { focused: false });
    handlers.onFocus();
    expect(deps.setBlurred).toHaveBeenLastCalledWith(false);
    expect(deps.notify).toHaveBeenLastCalledWith('session.focus', { focused: true });
  });

  it('covers and tells the worker when the page is hidden', () => {
    const { handlers, deps } = setup({ isDesktop: false, hideOnBlur: false });
    handlers.onVisibility('hidden');
    expect(deps.setHidden).toHaveBeenLastCalledWith(true);
    expect(deps.notify).toHaveBeenLastCalledWith('session.visibility', { state: 'hidden' });
    handlers.onVisibility('visible');
    expect(deps.notify).toHaveBeenLastCalledWith('session.visibility', { state: 'visible' });
  });

  it('ignores the desktop preference', () => {
    const { handlers, deps } = setup({ isDesktop: false, hideOnBlur: true });
    handlers.onBlur();
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});

describe('in the desktop app with "hide on switch" off (the default)', () => {
  it('neither covers the content nor tells the worker when the window loses focus', () => {
    const { handlers, deps } = setup({ isDesktop: true, hideOnBlur: false });
    handlers.onBlur();
    expect(deps.setBlurred).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('does not touch the cover on focus either', () => {
    const { handlers, deps } = setup({ isDesktop: true, hideOnBlur: false });
    handlers.onFocus();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('still covers a hidden window from view, but does not start the worker hidden-window timer', () => {
    const { handlers, deps } = setup({ isDesktop: true, hideOnBlur: false });
    handlers.onVisibility('hidden');
    expect(deps.setHidden).toHaveBeenLastCalledWith(true);
    handlers.onVisibility('visible');
    expect(deps.setHidden).toHaveBeenLastCalledWith(false);
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe('in the desktop app with "hide on switch" on', () => {
  it('covers on blur and restores on focus, without a password', () => {
    const { handlers, deps } = setup({ isDesktop: true, hideOnBlur: true });
    handlers.onBlur();
    expect(deps.setBlurred).toHaveBeenLastCalledWith(true);
    expect(deps.notify).toHaveBeenLastCalledWith('session.focus', { focused: false });
    handlers.onFocus();
    expect(deps.setBlurred).toHaveBeenLastCalledWith(false);
    expect(deps.notify).toHaveBeenLastCalledWith('session.focus', { focused: true });
  });

  it('lifts the cover on focus even if the preference was switched off while blurred', () => {
    const { handlers, deps, set } = setup({ isDesktop: true, hideOnBlur: true });
    handlers.onBlur();
    set({ isDesktop: true, hideOnBlur: false });
    handlers.onFocus();
    expect(deps.setBlurred).toHaveBeenLastCalledWith(false);
  });
});
