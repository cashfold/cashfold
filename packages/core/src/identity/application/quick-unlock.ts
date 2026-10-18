import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { parseSettings } from '../domain/device-settings';
import { quickUnlockDecision, type QuickUnlockDecision, type QuickUnlockDenied } from '../domain/quick-unlock';
import type {
  CredentialStorePort, DeviceSettingsPort, QuickUnlockCryptoPort, QuickUnlockStorePort, Secret, SessionPort, StoredQuickUnlock,
} from '../ports/index';
import type { Session } from './lock';
import type { UnlockedSession } from './unlock';

export interface QuickUnlockDeps {
  readonly crypto: QuickUnlockCryptoPort;
  readonly store: QuickUnlockStorePort;
  readonly settings: DeviceSettingsPort;
  readonly credentials: CredentialStorePort;
  readonly sessionPort: SessionPort;
  readonly session: Session;
  readonly nowMs: () => number;
}

export type EnrolError = DomainError<'wrong_password' | 'no_account'> | (DomainError<'too_many_attempts'> & { readonly retryAfterMs: number });
export type QuickUnlockError =
  | DomainError<'failed' | 'no_account'>
  | (DomainError<'not_allowed'> & { readonly reason: QuickUnlockDenied });

export type QuickStatus = { readonly allowed: true; readonly credentialId: Uint8Array; readonly prfSalt: Uint8Array } | { readonly allowed: false; readonly reason: QuickUnlockDenied };

/**
 * Unlocking with the device's biometrics or PIN through a WebAuthn PRF secret (FR-006). The PRF output stands in for the
 * password only while `quickUnlockDecision` says so; every refusal falls back to the password.
 */
export function createQuickUnlock(deps: QuickUnlockDeps) {
  const { crypto, store, settings, credentials, sessionPort, session, nowMs } = deps;
  const zero = (bytes: Uint8Array) => bytes.fill(0);

  async function decision(sessionMarker: string | undefined): Promise<{ result: QuickUnlockDecision; record: StoredQuickUnlock | undefined }> {
    const record = await store.load();
    return { record, result: quickUnlockDecision({ settings: parseSettings(await settings.load()), record, nowMs: nowMs(), sessionMarker }) };
  }

  return {
    /** Whether quick unlock may be offered right now, and the credential to ask the authenticator for. */
    async status(sessionMarker: string | undefined): Promise<QuickStatus> {
      const { result, record } = await decision(sessionMarker);
      return result.allowed && record !== undefined ? { allowed: true, credentialId: record.credentialId, prfSalt: record.prfSalt } : { allowed: false, reason: result.allowed ? 'not_enrolled' : result.reason };
    },

    async enrol(args: { password: Secret; credentialId: Uint8Array; prfSalt: Uint8Array; prfOutput: Uint8Array; sessionMarker: string }): Promise<Result<true, EnrolError>> {
      try {
        const wait = session.unlockDelayMs();
        if (wait > 0) return { ok: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Wait before trying again.', retryAfterMs: wait } };
        const stored = await credentials.load();
        if (stored === undefined) return err('no_account', 'There is no account on this device');
        const blob = await crypto.enroll({ password: args.password, credentials: stored, prfOutput: args.prfOutput });
        if (blob === 'wrong_password') {
          session.recordFailedUnlock();
          return err('wrong_password', 'That password is not right');
        }
        session.recordSuccessfulUnlock();
        await store.save({ credentialId: args.credentialId, prfSalt: args.prfSalt, blob, lockedAtMs: nowMs(), sessionMarker: args.sessionMarker, failures: 0 });
        const current = parseSettings(await settings.load());
        await settings.save({ ...current, quickUnlock: { ...current.quickUnlock, enabled: true } });
        return ok(true);
      } finally {
        args.password.wipe();
        zero(args.prfOutput);
      }
    },

    async unlock(args: { prfOutput: Uint8Array; sessionMarker: string | undefined }): Promise<Result<UnlockedSession, QuickUnlockError>> {
      try {
        const { result, record } = await decision(args.sessionMarker);
        if (!result.allowed || record === undefined) {
          return { ok: false, error: { code: 'not_allowed', message: 'Use your password', reason: result.allowed ? 'not_enrolled' : result.reason } };
        }
        const stored = await credentials.load();
        if (stored === undefined) return err('no_account', 'There is no account on this device');

        const material = await crypto.unlock({ blob: record.blob, prfOutput: args.prfOutput, credentials: stored });
        if (material === 'failed') {
          await store.save({ ...record, failures: record.failures + 1 });
          return err('failed', 'Quick unlock did not work');
        }
        for (const secret of [material.sessionKey, material.deviceSigningKey, material.secretKey]) session.track(secret);
        try {
          const services = await sessionPort.start({ deviceId: stored.deviceId, sessionKey: material.sessionKey, deviceSigningKey: material.deviceSigningKey });
          await store.save({ ...record, failures: 0 });
          return ok({ accountId: stored.accountId, email: stored.email, server: stored.server, services });
        } catch (e) {
          await sessionPort.stop().catch(() => undefined);
          for (const secret of [material.sessionKey, material.deviceSigningKey, material.secretKey]) (session.release(secret), secret.wipe());
          throw e;
        }
      } finally {
        zero(args.prfOutput);
      }
    },

    /** Notes when the app locked: the inactivity period runs from here. */
    async markLocked(): Promise<void> {
      const record = await store.load();
      if (record !== undefined) await store.save({ ...record, lockedAtMs: nowMs() });
    },

    /** A successful password unlock clears the quick-unlock failure count. */
    async recordPasswordUnlock(): Promise<void> {
      const record = await store.load();
      if (record !== undefined && record.failures !== 0) await store.save({ ...record, failures: 0 });
    },

    async disable(): Promise<void> {
      await store.clear();
      const current = parseSettings(await settings.load());
      await settings.save({ ...current, quickUnlock: { ...current.quickUnlock, enabled: false } });
    },
  };
}
