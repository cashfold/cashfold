import { describe, expect, it, vi } from 'vitest';
import type { Secret } from '../ports/index';
import { createSession, type LockPolicy } from './lock';

function secret(fill = 1): Secret & { wiped: () => boolean } {
  let bytes: Uint8Array | null = new Uint8Array(32).fill(fill);
  return {
    get length() { return bytes?.length ?? 0; },
    get isWiped() { return bytes === null; },
    use: (fn) => { if (bytes === null) throw new Error('wiped'); return fn(bytes); },
    wipe: () => { bytes?.fill(0); bytes = null; },
    wiped: () => bytes === null,
  };
}

const policy: LockPolicy = { idleMs: 5 * 60_000, hiddenGraceMs: 60_000 };

function setup(over: Partial<{ closeDb: () => Promise<void>; terminate: () => void }> = {}) {
  let now = 1_000_000;
  const closeDb = over.closeDb ?? vi.fn(async () => undefined);
  const terminate = over.terminate ?? vi.fn();
  const timers: Array<{ at: number; fn: () => void }> = [];
  const session = createSession({
    closeDatabase: closeDb, terminateWorker: terminate, policy, nowMs: () => now,
  });
  return { session, closeDb, terminate, advance: (ms: number) => { now += ms; session.tick(); }, timers };
}

describe('lock() wipes every secret and ends the worker (FR-017)', () => {
  it('wipes all tracked secrets, closes the database and terminates the worker, in that order', async () => {
    const order: string[] = [];
    const { session } = setup({ closeDb: async () => void order.push('close'), terminate: () => void order.push('terminate') });
    const [a, b, c] = [secret(1), secret(2), secret(3)];
    for (const s of [a, b, c]) session.track(s);
    const origWipe = a.wipe.bind(a);
    a.wipe = () => (order.push('wipe'), origWipe());
    await session.lock();
    expect([a.isWiped, b.isWiped, c.isWiped]).toEqual([true, true, true]);
    expect(order).toEqual(['wipe', 'close', 'terminate']);
    expect(session.state()).toBe('locked');
  });

  it('still wipes everything and terminates if closing the database fails', async () => {
    const terminate = vi.fn();
    const { session } = setup({ closeDb: async () => { throw new Error('db busy'); }, terminate });
    const s = secret();
    session.track(s);
    await expect(session.lock()).resolves.toBeUndefined();
    expect(s.isWiped).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('keeps wiping after one wipe throws', async () => {
    const { session } = setup();
    const bad = secret();
    bad.wipe = () => { throw new Error('boom'); };
    const good = secret();
    session.track(bad);
    session.track(good);
    await session.lock();
    expect(good.isWiped).toBe(true);
  });

  it('is idempotent: locking twice runs the teardown once', async () => {
    const { session, closeDb, terminate } = setup();
    await Promise.all([session.lock(), session.lock()]);
    await session.lock();
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('wipes a secret tracked after locking straight away', async () => {
    const { session } = setup();
    await session.lock();
    const late = secret();
    session.track(late);
    expect(late.isWiped).toBe(true);
  });

  it('stops tracking a secret that was released early', async () => {
    const { session } = setup();
    const s = secret();
    session.track(s);
    session.release(s);
    s.wipe();
    await expect(session.lock()).resolves.toBeUndefined();
  });
});

describe('auto-lock (FR-007)', () => {
  it('locks after the idle timeout, and activity resets it', async () => {
    const { session, advance } = setup();
    advance(4 * 60_000);
    expect(session.state()).toBe('unlocked');
    session.activity();
    advance(4 * 60_000);
    expect(session.state()).toBe('unlocked');
    advance(2 * 60_000);
    await Promise.resolve();
    expect(session.state()).toBe('locked');
  });

  it('locks after the hidden-tab grace period, and coming back in time cancels it', async () => {
    const a = setup();
    a.session.visibility('hidden');
    a.advance(59_000);
    expect(a.session.state()).toBe('unlocked');
    a.session.visibility('visible');
    a.advance(120_000);
    expect(a.session.state()).toBe('unlocked');

    const b = setup();
    b.session.visibility('hidden');
    b.advance(61_000);
    await Promise.resolve();
    expect(b.session.state()).toBe('locked');
  });

  it('locks at once when the page is being discarded (pagehide)', async () => {
    const { session } = setup();
    session.pageHide();
    await Promise.resolve();
    expect(session.state()).toBe('locked');
  });

  it('covers the content as soon as the window is hidden or loses focus, before it locks', () => {
    const { session } = setup();
    expect(session.covered()).toBe(false);
    session.visibility('hidden');
    expect(session.covered()).toBe(true);
    session.visibility('visible');
    expect(session.covered()).toBe(false);
    session.focus(false);
    expect(session.covered()).toBe(true);
    session.focus(true);
    expect(session.covered()).toBe(false);
  });

  it('a locked session stays covered and ignores activity', async () => {
    const { session } = setup();
    await session.lock();
    session.activity();
    session.visibility('visible');
    expect(session.covered()).toBe(true);
    expect(session.state()).toBe('locked');
  });
});

describe('wrong-password back-off (FR-006)', () => {
  it('imposes an escalating delay after repeated failures and clears it on success', () => {
    const { session, advance } = setup();
    expect(session.unlockDelayMs()).toBe(0);
    for (let i = 0; i < 3; i++) session.recordFailedUnlock();
    expect(session.unlockDelayMs()).toBe(0); // the first few mistakes are free
    session.recordFailedUnlock();
    const first = session.unlockDelayMs();
    expect(first).toBeGreaterThan(0);
    session.recordFailedUnlock();
    expect(session.unlockDelayMs()).toBeGreaterThan(first);
    advance(10 * 60_000);
    expect(session.unlockDelayMs()).toBe(0);
    session.recordFailedUnlock();
    session.recordSuccessfulUnlock();
    expect(session.unlockDelayMs()).toBe(0);
  });

  it('caps the delay', () => {
    const { session } = setup();
    for (let i = 0; i < 60; i++) session.recordFailedUnlock();
    expect(session.unlockDelayMs()).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe('changing the policy on a running session', () => {
  it('applies the new idle timeout straight away', async () => {
    const { session, advance } = setup();
    session.setPolicy({ idleMs: 60_000, hiddenGraceMs: 60_000 });
    advance(61_000);
    await Promise.resolve();
    expect(session.state()).toBe('locked');
  });

  it('counts the idle time from the last activity, not from the change', async () => {
    const { session, advance } = setup();
    advance(4 * 60_000);
    session.setPolicy({ idleMs: 3 * 60_000, hiddenGraceMs: 60_000 });
    advance(1);
    await Promise.resolve();
    expect(session.state()).toBe('locked');
  });
});
