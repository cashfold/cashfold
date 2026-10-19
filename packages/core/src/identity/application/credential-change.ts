import type { Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { checkPassword, type PolicyViolation } from '../domain/password-policy';
import type { CredentialChangeCryptoPort, CredentialStorePort, RelayAuthPort, Secret } from '../ports/index';
import { checkKdfPolicy } from './kdf-policy';
import type { Session } from './lock';
import { mapRelayError, type SignInError } from './sign-in';
import { asMap } from './relay-wire';

// Changing the password or rotating the Secret Key (US9, FR-008). The key set is not regenerated: the same keys are sealed
// under new credentials, so Folds, grants and bundles stay valid. The service swaps verifier, salts, parameters and key set in
// one step and ends every other session, so no device is left half-way. Nothing local changes until the service has said yes.

export interface ChangeCredentialsInput {
  /** The current password. Consumed: wiped on every path. */
  readonly password: Secret;
  /** A new password. Consumed. Omit to keep the current one. */
  readonly newPassword?: Secret;
  readonly rotateSecretKey?: boolean;
}

export interface CredentialsChanged {
  /** Present when the Secret Key was rotated: show it once and offer a new Emergency Kit. */
  readonly secretKeyText?: string;
  /** The new SRP-x, tracked by the session. */
  readonly srpX: Secret;
  /** Other devices are signed out and must sign in again with the new credentials. */
  readonly otherDevicesSignedOut: true;
}

export type ChangeCredentialsError =
  | SignInError
  | DomainError<'no_account' | 'wrong_password' | 'nothing_to_change' | 'same_password' | 'offline' | 'service_error' | 'wrong_credentials' | 'kdf_below_floor' | 'device_removed' | 'not_registered'>
  | (DomainError<'weak_password'> & { readonly violations: readonly PolicyViolation[] })
  | (DomainError<'rate_limited'> & { readonly retryAfterS?: number });

export interface ChangeCredentialsDeps {
  readonly crypto: CredentialChangeCryptoPort;
  readonly relay: RelayAuthPort;
  readonly credentials: CredentialStorePort;
  readonly session: Session;
  readonly logger?: Logger;
}

class PolicyRefusal extends Error {}

export function changeCredentials(deps: ChangeCredentialsDeps) {
  const { crypto, relay, credentials, session, logger } = deps;

  return async function run(input: ChangeCredentialsInput): Promise<Result<CredentialsChanged, ChangeCredentialsError>> {
    const refuse = <E extends ChangeCredentialsError>(error: E): Result<never, E> => {
      input.password.wipe();
      input.newPassword?.wipe();
      return { ok: false, error };
    };
    const rotate = input.rotateSecretKey === true;
    if (input.newPassword === undefined && !rotate) return refuse({ code: 'nothing_to_change', message: 'Choose a new password or a new Secret Key' } as const);
    if (input.newPassword !== undefined) {
      const policy = checkPassword(input.newPassword.use((b) => new TextDecoder().decode(b)));
      if (!policy.ok) return refuse({ code: 'weak_password', message: 'Choose a longer, less common password', violations: policy.violations });
      if (input.password.use((a) => input.newPassword!.use((b) => a.length === b.length && a.every((x, i) => x === b[i])))) return refuse({ code: 'same_password', message: 'The new password is the same as the current one' } as const);
    }

    const stored = await credentials.load();
    if (stored === undefined) return refuse({ code: 'no_account', message: 'There is no account on this device' } as const);
    if (stored.registration !== 'done') return refuse({ code: 'not_registered', message: 'This account is not registered with a service yet' } as const);

    const handle = await crypto.begin({ password: input.password, credentials: stored });
    if (handle === 'wrong_password') {
      input.newPassword?.wipe();
      return err('wrong_password', 'That password is not right');
    }

    let link: Awaited<ReturnType<RelayAuthPort['signIn']>> | undefined;
    try {
      try {
        link = await relay.signIn({
          server: stored.server, email: stored.email, deviceId: stored.deviceId,
          async deriveX(hello) {
            const ok = checkKdfPolicy(hello.kdf.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: hello.kdf.mKib, t: hello.kdf.t, p: hello.kdf.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: hello.kdf.iterations });
            if (!ok.ok) throw new PolicyRefusal();
            return handle.currentSrpX(hello);
          },
        });
      } catch (e) {
        if (e instanceof PolicyRefusal) return err('kdf_below_floor', mapRelayError('kdf_below_floor').message);
        throw e;
      }
      if (!link.ok) return { ok: false, error: mapRelayError(link.kind) };

      const current = await link.link.request('GET', '/accounts/me/keyset');
      if (!current.ok) return { ok: false, error: mapRelayError(current.kind) };
      const keySet = asMap(current.body).get('keyset');
      if (!(keySet instanceof Uint8Array)) return err('service_error', mapRelayError('protocol').message);

      const prepared = await handle.prepare({ keySet, rotateSecretKey: rotate, ...(input.newPassword !== undefined && { newPassword: input.newPassword }) });
      const sent = await link.link.request('PUT', '/accounts/me/keyset', {
        auth_salt: prepared.rotation.authSalt,
        kdf: { kdf: 'argon2id', m_kib: BigInt(prepared.rotation.kdf.mKib), t: BigInt(prepared.rotation.kdf.t), p: BigInt(prepared.rotation.kdf.p), enc_salt: prepared.rotation.kdf.encSalt },
        srp_verifier: prepared.rotation.srpVerifier, keyset: prepared.rotation.keySet,
      });
      if (!sent.ok) {
        prepared.srpX.wipe();
        return { ok: false, error: mapRelayError(sent.kind) };
      }
      // The service has replaced everything; from here this device must follow, or it could no longer sign in.
      await credentials.save({ ...stored, sealed: prepared.sealed });
      session.track(prepared.srpX);
      logger?.info('credentials.changed', {});
      return ok({ ...(prepared.secretKeyText !== undefined && { secretKeyText: prepared.secretKeyText }), srpX: prepared.srpX, otherDevicesSignedOut: true });
    } finally {
      if (link?.ok) link.link.close();
      handle.wipe();
      input.newPassword?.wipe();
    }
  };
}
