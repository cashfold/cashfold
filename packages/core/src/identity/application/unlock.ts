import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { CredentialStorePort, Secret, SessionPort, SessionServices, UnlockCryptoPort } from '../ports/index';
import type { Session } from './lock';

export interface UnlockedSession {
  readonly accountId: string;
  readonly email: string;
  readonly server: string;
  readonly services: SessionServices;
}

export type UnlockError =
  | DomainError<'wrong_password' | 'no_account'>
  | (DomainError<'too_many_attempts'> & { readonly retryAfterMs: number });

export interface UnlockDeps {
  readonly unlockCrypto: UnlockCryptoPort;
  readonly credentials: CredentialStorePort;
  readonly sessionPort: SessionPort;
  readonly session: Session;
}

/**
 * Unlocks this device with the password (FR-006). Wrong guesses are slowed down on the device itself; while a delay is
 * running the password is not even tried. The answer to a wrong password never says which part was wrong.
 */
export function unlock({ unlockCrypto, credentials, sessionPort, session }: UnlockDeps) {
  return async function run({ password }: { password: Secret }): Promise<Result<UnlockedSession, UnlockError>> {
    const wait = session.unlockDelayMs();
    if (wait > 0) {
      password.wipe();
      return { ok: false, error: { code: 'too_many_attempts', message: 'Too many attempts. Wait before trying again.', retryAfterMs: wait } };
    }
    const stored = await credentials.load();
    if (stored === undefined) {
      password.wipe();
      return err('no_account', 'There is no account on this device');
    }

    const material = await unlockCrypto.unlock({ password, credentials: stored });
    password.wipe();
    if (material === 'wrong_password') {
      session.recordFailedUnlock();
      return err('wrong_password', 'That password is not right');
    }

    for (const secret of [material.sessionKey, material.deviceSigningKey, material.secretKey]) session.track(secret);
    try {
      const services = await sessionPort.start({ deviceId: stored.deviceId, sessionKey: material.sessionKey, deviceSigningKey: material.deviceSigningKey });
      session.recordSuccessfulUnlock();
      return ok({ accountId: stored.accountId, email: stored.email, server: stored.server, services });
    } catch (e) {
      await sessionPort.stop().catch(() => undefined);
      for (const secret of [material.sessionKey, material.deviceSigningKey, material.secretKey]) {
        session.release(secret);
        secret.wipe();
      }
      throw e;
    }
  };
}
