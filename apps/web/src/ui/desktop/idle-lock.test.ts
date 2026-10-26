import { describe, expect, it, vi } from 'vitest';
import { createIdleLock } from './idle-lock';

function setup(minutes: number | 'unreadable' | 'fail' = 5) {
  let clock = 1_000_000;
  const lock = vi.fn();
  const idleMinutes = vi.fn(async () => {
    if (minutes === 'fail') throw new Error('x');
    return minutes === 'unreadable' ? undefined : minutes;
  });
  const idle = createIdleLock({ now: () => clock, idleMinutes, lock });
  return { idle, lock, idleMinutes, advance: (ms: number) => (clock += ms) };
}

describe('the desktop idle lock', () => {
  it('does not lock while the person is within the idle time', async () => {
    const { idle, lock, advance } = setup(5);
    advance(4 * 60_000);
    await expect(idle.check()).resolves.toBe(false);
    expect(lock).not.toHaveBeenCalled();
  });

  it('locks once the idle time has passed without input, however long the window has been hidden', async () => {
    const { idle, lock, advance } = setup(1);
    advance(59_000);
    await idle.check();
    advance(2_000);
    await expect(idle.check()).resolves.toBe(true);
    expect(lock).toHaveBeenCalledOnce();
  });

  it('counts only input, and starts counting again after it', async () => {
    const { idle, lock, advance } = setup(1);
    advance(50_000);
    idle.input();
    advance(50_000);
    await expect(idle.check()).resolves.toBe(false);
    advance(11_000);
    await expect(idle.check()).resolves.toBe(true);
    expect(lock).toHaveBeenCalledOnce();
  });

  it('reads the setting again after it goes stale, so a change takes effect', async () => {
    let minutes = 60;
    let clock = 0;
    const lock = vi.fn();
    const idle = createIdleLock({ now: () => clock, idleMinutes: async () => minutes, lock, refreshMs: 30_000 });
    clock += 31_000;
    await idle.check();
    minutes = 1;
    clock += 31_000;
    await expect(idle.check()).resolves.toBe(true);
  });

  it('does not read the setting on every check', async () => {
    const { idle, idleMinutes, advance } = setup(60);
    for (let i = 0; i < 5; i++) {
      advance(5_000);
      await idle.check();
    }
    expect(idleMinutes).toHaveBeenCalledTimes(1);
  });

  it.each(['unreadable', 'fail', 0] as const)('never locks when the setting cannot be read or makes no sense (%s)', async (value) => {
    const { idle, lock, advance } = setup(value);
    advance(24 * 60 * 60_000);
    await expect(idle.check()).resolves.toBe(false);
    expect(lock).not.toHaveBeenCalled();
  });
});
