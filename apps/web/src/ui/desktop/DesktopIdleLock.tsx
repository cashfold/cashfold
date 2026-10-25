'use client';

import { useEffect } from 'react';
import { useCore } from '../core/CoreProvider';
import { createIdleLock } from './idle-lock';

const CHECK_MS = 5_000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** Locks the desktop app when the person has not touched it for their idle time, whether the window is visible, hidden or minimised. */
export default function DesktopIdleLock() {
  const core = useCore();
  useEffect(() => {
    const idle = createIdleLock({
      now: Date.now,
      idleMinutes: async () => {
        const settings = await core.call<{ autoLockMinutes?: unknown }>('settings.get');
        return typeof settings.autoLockMinutes === 'number' ? settings.autoLockMinutes : undefined;
      },
      lock: () => core.lock(),
    });
    const onInput = () => idle.input();
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true });
    const timer = setInterval(() => void idle.check(), CHECK_MS);
    return () => {
      clearInterval(timer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput);
    };
  }, [core]);
  return null;
}
