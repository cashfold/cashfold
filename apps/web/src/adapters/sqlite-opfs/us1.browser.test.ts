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

    expect(r['settingsDefault']).toEqual({ autoLockMinutes: 5, hiddenGraceSeconds: 60, quickUnlock: { enabled: false, maxIdleMinutes: 30 }, kitReminderDismissed: false });
    expect(r['settingsSet']).toMatchObject({ autoLockMinutes: 1, hiddenGraceSeconds: 5 });
    expect(Object.keys(r['settingsSet'] as object)).not.toContain('evil');
    expect(r['kitWrong']).toEqual({ ok: false, error: { code: 'wrong_password' } });
    expect(r['kitRight']).toEqual({ ok: true, sameKey: true, accountId: true });
    expect(r['coveredWhenHidden']).toBe(true);
    expect(r['coveredWhenVisible']).toBe(false);
    expect(r['afterPageHide']).toEqual({ announced: 1, calls: 'locked', statusAfter: expect.objectContaining({ phase: 'locked' }) });
  });
});
