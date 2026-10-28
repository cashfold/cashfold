import { describe, expect, it, vi } from 'vitest';
import { id } from '../../testing/index';
import { createLogger, type LogEntry } from '../../shared-kernel/logger';
import type { CredentialStorePort, DeviceCredentials, LocalEraserPort, PendingEraseMarkerPort } from '../ports/index';
import { createSignOut } from './sign-out';

const ACCOUNT: DeviceCredentials = { deviceId: id(1), accountId: 'ABCDEF', email: 'Alice@Example.com', server: 'https://relay.example.com', registration: 'done', sealed: new Uint8Array([1]) };

function setup(o: { stored?: Partial<DeviceCredentials> | null; unlocked?: boolean; revoke?: () => Promise<boolean>; noRevoke?: boolean; eraseFailures?: number } = {}) {
  const calls: string[] = [];
  let marked = false;
  let eraseFailures = o.eraseFailures ?? 0;
  const stored: DeviceCredentials | undefined = o.stored === null ? undefined : { ...ACCOUNT, ...o.stored };
  const credentials: CredentialStorePort = { save: async () => undefined, load: async () => stored, clear: async () => undefined };
  const marker: PendingEraseMarkerPort = {
    set: async () => void (calls.push('marker.set'), (marked = true)),
    isSet: async () => marked,
    clear: async () => void (calls.push('marker.clear'), (marked = false)),
  };
  const eraser: LocalEraserPort = {
    eraseAll: async () => {
      calls.push('erase');
      if (eraseFailures > 0) {
        eraseFailures--;
        throw new Error('disk gone');
      }
    },
  };
  const revoke = o.noRevoke ? undefined : (o.revoke ?? (async () => true));
  // Timers that only fire when the test says so, so "does not answer" needs no real waiting.
  const pending: Array<() => void> = [];
  const timers = { set: (fn: () => void) => (pending.push(fn), pending.length), clear: () => undefined };
  const entries: LogEntry[] = [];
  const logger = createLogger({ sink: (e) => void entries.push(e) });
  const lock = vi.fn(async () => void calls.push('lock'));
  const signOut = createSignOut({
    marker, eraser, credentials, session: { lock }, isUnlocked: () => o.unlocked ?? true,
    closeDatabase: async () => void calls.push('close'), afterErase: () => void calls.push('afterErase'),
    ...(revoke === undefined ? {} : { revokeThisDevice: async () => (calls.push('revoke'), revoke()) }),
    timeLimitMs: 5_000, timers, logger,
  });
  return { signOut, calls, entries, lock, fireTimers: () => pending.splice(0).forEach((f) => f()), isMarked: () => marked };
}

describe('signing out of an unlocked account (spec 011)', () => {
  it('goes in this order, with the lock last because locking ends the worker', async () => {
    const s = setup();
    const r = await s.signOut.signOut();
    expect(r).toEqual({ ok: true, value: { deviceStillListed: false } });
    expect(s.calls).toEqual(['marker.set', 'revoke', 'close', 'erase', 'afterErase', 'marker.clear', 'lock']);
  });

  it.each([
    ['says no', async () => false],
    ['throws', async () => { throw new Error('network'); }],
  ])('still erases, and says the device may stay listed, when removing it from the service %s', async (_name, revoke) => {
    const s = setup({ revoke });
    expect(await s.signOut.signOut()).toEqual({ ok: true, value: { deviceStillListed: true } });
    expect(s.calls).toContain('erase');
  });

  it('does not wait for a service that does not answer', async () => {
    const s = setup({ revoke: () => new Promise<boolean>(() => undefined) });
    const done = s.signOut.signOut();
    await vi.waitFor(() => expect(s.calls).toContain('revoke'));
    s.fireTimers();
    expect(await done).toEqual({ ok: true, value: { deviceStillListed: true } });
    expect(s.calls).toContain('erase');
  });

  it('says the device may stay listed when there is no way to reach the service at all', async () => {
    const s = setup({ noRevoke: true });
    expect(await s.signOut.signOut()).toEqual({ ok: true, value: { deviceStillListed: true } });
  });

  it.each(['local', 'pending'] as const)('never contacts a service for an account that is %s, and has nothing listed', async (registration) => {
    const s = setup({ stored: { registration } });
    expect(await s.signOut.signOut()).toEqual({ ok: true, value: { deviceStillListed: false } });
    expect(s.calls).not.toContain('revoke');
  });

  it('leaves the service alone when asked, though the device then stays listed', async () => {
    const s = setup();
    expect(await s.signOut.signOut({ leaveService: false })).toEqual({ ok: true, value: { deviceStillListed: true } });
    expect(s.calls).not.toContain('revoke');
  });

  it('changes nothing when the app is locked, or when there is no account', async () => {
    const locked = setup({ unlocked: false });
    expect(await locked.signOut.signOut()).toEqual({ ok: false, error: expect.objectContaining({ code: 'locked' }) });
    expect(locked.calls).toEqual([]);
    const none = setup({ stored: null, unlocked: false });
    expect(await none.signOut.signOut()).toEqual({ ok: false, error: expect.objectContaining({ code: 'no_account' }) });
    expect(none.calls).toEqual([]);
  });
});

describe('an erase that is cut short is finished, not abandoned (FR-013)', () => {
  it('keeps the marker and rethrows when the erase fails, then finishes it later, and only once', async () => {
    const s = setup({ eraseFailures: 1 });
    await expect(s.signOut.signOut()).rejects.toThrow('disk gone');
    expect(s.isMarked()).toBe(true);
    expect(s.calls).not.toContain('lock');
    expect(await s.signOut.finishPendingErase()).toBe(true);
    expect(s.isMarked()).toBe(false);
    expect(s.calls.filter((c) => c === 'erase')).toHaveLength(2);
    expect(await s.signOut.finishPendingErase()).toBe(false);
    expect(s.calls.filter((c) => c === 'erase')).toHaveLength(2);
  });

  it('does nothing at all when no sign-out was started', async () => {
    const s = setup();
    expect(await s.signOut.finishPendingErase()).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('announces the sign-out when it finishes one', async () => {
    const s = setup({ eraseFailures: 1 });
    await s.signOut.signOut().catch(() => undefined);
    await s.signOut.finishPendingErase();
    expect(s.calls.filter((c) => c === 'afterErase')).toHaveLength(1);
  });
});

describe('using a different account from the lock screen (FR-014)', () => {
  it('erases nothing, and does not even write the marker, for another address', async () => {
    const s = setup({ unlocked: false });
    expect(await s.signOut.signOutLocked({ email: 'bob@example.com' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'wrong_email' }) });
    expect(s.calls).toEqual([]);
  });

  it('erases for the right address, whatever its case and spacing, without asking any service', async () => {
    const s = setup({ unlocked: false });
    expect(await s.signOut.signOutLocked({ email: '  alice@example.COM ' })).toEqual({ ok: true, value: { deviceStillListed: true } });
    expect(s.calls).toEqual(['marker.set', 'close', 'erase', 'afterErase', 'marker.clear', 'lock']);
  });

  it('has nothing listed for an account that was never on a service', async () => {
    const s = setup({ unlocked: false, stored: { registration: 'local' } });
    expect(await s.signOut.signOutLocked({ email: 'alice@example.com' })).toEqual({ ok: true, value: { deviceStillListed: false } });
  });

  it('says so when there is no account', async () => {
    const s = setup({ unlocked: false, stored: null });
    expect(await s.signOut.signOutLocked({ email: 'alice@example.com' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'no_account' }) });
  });
});

describe('what a sign-out leaves in the log', () => {
  it('says that it happened and nothing about whom', async () => {
    const s = setup();
    await s.signOut.signOut();
    const out = JSON.stringify(s.entries);
    expect(s.entries.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/alice|example\.com|ABCDEF/i);
  });
});
