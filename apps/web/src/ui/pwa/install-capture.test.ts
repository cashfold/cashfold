import { describe, expect, it, vi } from 'vitest';
import { createInstallCapture, type DeferredPrompt } from './install-capture';

function target() {
  const listeners = new Map<string, (event: unknown) => void>();
  return { addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, listener), fire: (type: string, event: unknown = {}) => listeners.get(type)?.(event) };
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): DeferredPrompt & { prompted: number; prevented: number } {
  const event = { prompted: 0, prevented: 0, preventDefault: () => void event.prevented++, prompt: async () => void event.prompted++, userChoice: Promise.resolve({ outcome }) };
  return event;
}

describe('capturing the browser install event', () => {
  it('keeps the event and stops the browser showing its own prompt, so nothing appears unasked', () => {
    const t = target();
    const capture = createInstallCapture(t);
    expect(capture.getSnapshot().promptEvent).toBe(false);
    const event = installEvent();
    t.fire('beforeinstallprompt', event);
    expect(event.prevented).toBe(1);
    expect(capture.getSnapshot().promptEvent).toBe(true);
    expect(event.prompted).toBe(0);
  });

  it('shows the browser prompt only when asked, and uses the event once', async () => {
    const t = target();
    const capture = createInstallCapture(t);
    const event = installEvent('accepted');
    t.fire('beforeinstallprompt', event);
    expect(await capture.prompt()).toBe('accepted');
    expect(event.prompted).toBe(1);
    expect(capture.getSnapshot()).toEqual({ promptEvent: false, installedInTab: true });
    expect(await capture.prompt()).toBe('unavailable');
    expect(event.prompted).toBe(1);
  });

  it('reports a decline, and lets a later event make the app promptable again', async () => {
    const t = target();
    const capture = createInstallCapture(t);
    t.fire('beforeinstallprompt', installEvent('dismissed'));
    expect(await capture.prompt()).toBe('dismissed');
    expect(capture.getSnapshot().promptEvent).toBe(false);
    t.fire('beforeinstallprompt', installEvent());
    expect(capture.getSnapshot().promptEvent).toBe(true);
  });

  it('notes that the app was installed from this tab, drops the event and says so once', () => {
    const t = target();
    const installed = vi.fn();
    const capture = createInstallCapture(t, { onInstalled: installed });
    t.fire('beforeinstallprompt', installEvent());
    t.fire('appinstalled');
    expect(capture.getSnapshot()).toEqual({ promptEvent: false, installedInTab: true });
    expect(installed).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers of each change, and stops after they unsubscribe', () => {
    const t = target();
    const capture = createInstallCapture(t);
    const listener = vi.fn();
    const stop = capture.subscribe(listener);
    t.fire('beforeinstallprompt', installEvent());
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    t.fire('appinstalled');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('gives the same snapshot object until something changes, as a store must', () => {
    const capture = createInstallCapture(target());
    expect(capture.getSnapshot()).toBe(capture.getSnapshot());
  });

  it('still counts as offered while the browser prompt is open, so the section does not vanish under the person', async () => {
    const t = target();
    const capture = createInstallCapture(t);
    let answer: (value: { outcome: 'accepted' | 'dismissed' }) => void = () => undefined;
    const event: DeferredPrompt = { preventDefault: () => undefined, prompt: async () => undefined, userChoice: new Promise((resolve) => (answer = resolve)) };
    t.fire('beforeinstallprompt', event);
    const done = capture.prompt();
    expect(capture.getSnapshot().promptEvent).toBe(true);
    answer({ outcome: 'dismissed' });
    expect(await done).toBe('dismissed');
    expect(capture.getSnapshot()).toEqual({ promptEvent: false, installedInTab: false });
  });
});
