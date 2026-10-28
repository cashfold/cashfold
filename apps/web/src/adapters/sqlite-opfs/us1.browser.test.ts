import { describe, expect, it } from 'vitest';
import type { ScenarioName, scenarios } from './test-scenarios';

type Result<K extends ScenarioName> = Awaited<ReturnType<(typeof scenarios)[K]>>;

async function run<K extends ScenarioName>(scenario: K): Promise<Result<K>> {
  const worker = new Worker(new URL('./test.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Result<K>>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent) => (ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error)));
      worker.onerror = (ev) => reject(new Error(ev.message));
      worker.postMessage({ scenario, ctx: { dir: `/us1-${Date.now().toString(36)}`, clear: true } });
    });
  } finally {
    worker.terminate();
  }
}

describe('user story 1 on the real encrypted database', () => {
  it('signs up offline, locks, and unlocks again with the same password', async () => {
    const r = await run('signUpAndUnlock');

    // sign-up
    expect(r.afterSignUp.secretKeyText).toMatch(/^C1-[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{11}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(r.afterSignUp.registration).toBe('pending'); // offline: queued, not lost
    expect(r.afterSignUp.accountState).toBe('draft');
    expect(r.afterSignUp.fold).toMatchObject({ name: 'Personal', baseCurrency: 'USD', role: 'owner', epoch: 1 });
    expect(r.afterSignUp.folds).toEqual(['Personal']);
    expect(r.afterSignUp.settingsName).toBe('Personal');
    expect(r.afterSignUp.opCount).toBe(1n);
    expect(r.afterSignUp.keyRows).toBe(1n);
    expect(r.afterSignUp.wrappedKeyLength).toBe(12 + 32 + 16); // the Fold key is wrapped, never stored plain
    expect(r.afterSignUp.storedRegistration).toBe('pending');
    expect(r.afterSignUp.storedEmail).toBe('alice@example.com');

    // nothing readable on disk in OPFS
    expect(r.afterSignUp.leaks).toEqual([]);

    // lock
    expect(r.afterLock).toEqual({ state: 'locked', covered: true, sessionOpen: false });

    // unlock
    expect(r.wrongPassword).toBe('wrong_password');
    expect(r.unlocked).toBe(true);
    expect(r.accountId).toBe(r.afterSignUp.secretKeyText.slice(3, 9));
    expect(r.reopenedFolds).toEqual(['Personal']);
    expect(r.reopenedSettings).toBe('Personal');
    expect(r.rebuild).toMatchObject({ opsReplayed: 1, failed: 0 }); // the op log opens and replays after a restart
    expect(r.lockedAgain).toBe('locked');
  });
});

describe('the Core Worker handlers the interface calls', () => {
  it('drives sign-up, Folds and auto-lock through plain RPC-shaped data', async () => {
    const r = await run('appHandlers');
    expect(r['statusFresh']).toEqual({ phase: 'no_account' });
    expect(r['foldsBeforeSignUp']).toBe('RpcError:locked');
    expect(r['weak']).toEqual({ ok: false, error: expect.objectContaining({ code: 'weak_password', violations: ['too_common'] }) });
    expect(r['created']).toEqual({ ok: true, keyShape: true, fold: 'Personal', leaksOtherSecrets: ['accountId', 'fold', 'registration', 'secretKeyText'] });
    expect(r['statusUnlocked']).toMatchObject({ phase: 'unlocked', email: 'a@example.com', registration: 'pending' });

    expect(r['createdWork']).toBe(true);
    expect(r['renamed']).toEqual({ ok: true, value: 'Day job' });
    expect(r['described']).toEqual({ name: 'Day job', memberCount: 1, isLastFold: false });
    expect(r['badConfirm']).toEqual({ ok: false, error: expect.objectContaining({ code: 'confirmation_mismatch' }) });
    expect(r['listBeforeDelete']).toEqual(['Personal', 'Day job']);
    expect(r['deleted']).toEqual({ ok: true, value: true });
    expect(r['lastFold']).toEqual({ ok: false, error: expect.objectContaining({ code: 'last_fold' }) });
    expect(r['listAfterDelete']).toEqual(['Personal']);

    expect(r['settingsDefault']).toEqual({ autoLockMinutes: 5, hiddenGraceSeconds: 60, quickUnlock: { enabled: false, maxIdleMinutes: 30 }, kitReminderDismissed: false, lastBackupAtMs: 0, backupNagDismissedAtMs: 0 });
    expect(r['settingsSet']).toMatchObject({ autoLockMinutes: 1, hiddenGraceSeconds: 5 });
    expect(Object.keys(r['settingsSet'] as object)).not.toContain('evil');
    expect(r['kitWrong']).toEqual({ ok: false, error: { code: 'wrong_password' } });
    expect(r['kitRight']).toEqual({ ok: true, sameKey: true, accountId: true });
    expect(r['coveredWhenHidden']).toBe(true);
    expect(r['coveredWhenVisible']).toBe(false);
    expect(r['afterPageHide']).toEqual({ announced: 1, calls: 'locked', statusAfter: expect.objectContaining({ phase: 'locked' }) });
  });
});

describe('a local-only account on the real encrypted database (spec 010)', () => {
  it('sends nothing to any service, stays local across lock, unlock and restart, and connects later without losing data', async () => {
    const r = await run('localOnly');
    expect(r['created']).toEqual({ ok: true, registration: 'local' });
    expect(r['accountCreated']).toBe(true);
    expect(r['afterSignUp']).toMatchObject({ status: { phase: 'unlocked', registration: 'local', server: '' }, sync: { available: true, registration: 'local' }, stored: { registration: 'local', server: '' } });
    expect(r['lockedStatus']).toMatchObject({ phase: 'locked', registration: 'local' });
    expect(r['unlocked']).toBe(true);
    expect(r['afterUnlock']).toMatchObject({ status: { phase: 'unlocked', registration: 'local' }, sync: { registration: 'local' } });
    expect(r['unlockedAfterRestart']).toBe(true);
    expect(r['afterRestart']).toMatchObject({ sync: { registration: 'local' } });
    expect(r['callsWhileLocal']).toEqual({ signIn: 0, register: 0, rates: 0 }); // FR-004, FR-011, SC-002

    expect(r['noAddress']).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_server' }) });
    expect(r['wrongPassword']).toEqual({ ok: false, error: expect.objectContaining({ code: 'wrong_password' }) });
    expect(r['unreachable']).toEqual({ ok: false, error: expect.objectContaining({ code: 'offline' }) });
    expect(r['stillLocal']).toEqual({ registration: 'local', server: '', accounts: true }); // FR-010
    expect(r['connected']).toMatchObject({ ok: true, value: { server: 'https://relay.example.com' } });
    expect(r['afterConnect']).toMatchObject({
      status: { registration: 'done', server: 'https://relay.example.com' }, sync: { registration: 'done' },
      stored: { registration: 'done', server: 'https://relay.example.com' }, registered: { discoverable: false, server: 'https://relay.example.com' },
    });
    expect(r['dataAfterConnect']).toEqual([['Checking', 100_000n]]); // FR-009
  });
});

describe('the local eraser on the real pool (spec 011)', () => {
  it('removes every file, leaves nothing readable in the slots, clears what belongs to the account, and keeps the lock policy', async () => {
    const r = await run('localErase');
    expect(r['filesBefore']).toBeGreaterThan(0);
    expect(r['slotsBefore']).toBeGreaterThan(0);
    expect(r['filesAfter']).toEqual([]);
    expect(r['slotsAfterWithContent']).toBe(0); // truncated to the header and zeroed: no stale ciphertext
    expect(r['credentials']).toBeUndefined();
    expect(r['quick']).toBeUndefined();
    expect(r['settings']).toMatchObject({ autoLockMinutes: 15, quickUnlock: { enabled: false, maxIdleMinutes: 90 }, lastBackupAtMs: 0, kitReminderDismissed: false });
    expect(r['again']).toEqual({ files: [], credentials: undefined });
  });
});

describe('signing out through the worker on the real database (spec 011)', () => {
  it('erases everything and nothing of the device, announces it once, and sends nothing for an account that is only here', async () => {
    const r = await run('signOut');
    expect(r['before']).toMatchObject({ credentials: true });
    expect((r['before'] as { files: number }).files).toBeGreaterThan(0);
    expect(r['signedOut']).toEqual({ ok: true, value: { deviceStillListed: false } });
    expect(r['tookMs']).toBeLessThan(2_000);
    expect(r['afterSignOut']).toMatchObject({
      files: [], credentials: undefined, quick: undefined, marked: false, siteContacted: { signIn: 0, register: 0 },
      settings: { autoLockMinutes: 15, lastBackupAtMs: 0, kitReminderDismissed: false },
    });
    expect((r['afterSignOut'] as { events: string[] }).events).toContain('SignedOut');
    expect((r['afterSignOut'] as { events: string[] }).events).not.toContain('DeviceRemoved');
    expect((r['afterSignOut'] as { lockedAnnounced: number }).lockedAnnounced).toBeGreaterThan(0); // the session locked, last
    expect(r['statusAfter']).toEqual({ phase: 'no_account' });
    expect(r['signOutWithNoAccount']).toEqual({ ok: false, error: expect.objectContaining({ code: 'no_account' }) });
  });

  it('erases an account on a service even when the service cannot be reached, and says the device may stay listed', async () => {
    const r = await run('signOut');
    expect(r['registeredCreated']).toBe(true);
    expect(r['pendingWhileOffline']).toHaveLength(1); // the sign-out warning counts unsent changes live, not as of the last finished round
    expect((r['pendingWhileOffline'] as number[])[0]).toBeGreaterThanOrEqual(1);
    expect(r['signedOutRegistered']).toEqual({ ok: true, value: { deviceStillListed: true } });
    expect(r['afterRegistered']).toMatchObject({ files: [], credentials: undefined, quick: undefined, marked: false });
  });

  it('lets the lock screen erase with the account\'s own email address, with no database open, and with nothing erased for another', async () => {
    const r = await run('signOut');
    expect(r['lockedStatus']).toBe('locked');
    expect(r['wrongEmail']).toEqual({ ok: false, error: expect.objectContaining({ code: 'wrong_email' }) });
    expect(r['afterWrongEmail']).toEqual({ files: true, credentials: true });
    expect(r['rightEmail']).toEqual({ ok: true, value: { deviceStillListed: false } });
    expect(r['afterRightEmail']).toMatchObject({ files: [], credentials: undefined, marked: false });
  });

  it('finishes a sign-out that was cut short on the very first call, whatever it is, and reports it once', async () => {
    const r = await run('signOut');
    expect(r['firstCallIsUnlock']).toEqual({ ok: false, error: expect.objectContaining({ code: 'no_account' }) });
    expect(r['afterFinish']).toMatchObject({ files: [], credentials: undefined, marked: false });
    expect(r['statusAfterFinish']).toEqual({ phase: 'no_account', finishedSignOut: true });
    expect(r['statusAgain']).toEqual({ phase: 'no_account' });
    expect(r['finishedAnnounced']).toBe(1);
  });
});

