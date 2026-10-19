import { newIdV4 } from '../../shared-kernel/id';
import type { Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { checkPassword, type PolicyViolation } from '../domain/password-policy';
import { normaliseEmail } from '../domain/user-account';
import { normaliseServerAddress } from '../domain/server-address';
import type { AccountSecrets, CredentialChangeCryptoPort, CredentialStorePort, RecoveryCryptoPort, RelayAuthPort, RelayLink, Secret } from '../ports/index';
import { checkKdfPolicy } from './kdf-policy';
import { asMap } from './relay-wire';
import { mapRelayError, type SignedIn, type SignInError, type SignInInput } from './sign-in';

// The Recovery Key (US9, FR-009): an optional second way back in when the password or the Secret Key is lost. It is made while
// signed in, shown once and kept by the person. The service holds only a second verifier and the key set's private keys wrapped
// under a key derived from it, so it can neither use nor open them. Recovering signs in with that credential, replaces the
// password and Secret Key with new ones in one step (the old ones stop working), and then signs this device in as a new device.

export interface SetRecoveryKeyDeps {
  readonly crypto: RecoveryCryptoPort;
  readonly verify: CredentialChangeCryptoPort;
  readonly relay: RelayAuthPort;
  readonly credentials: CredentialStorePort;
  /** The account's open keys, held by the unlocked session. */
  readonly account: () => AccountSecrets | undefined;
  readonly logger?: Logger;
}

export type SetRecoveryKeyError =
  | SignInError
  | DomainError<'no_account' | 'wrong_password' | 'not_registered' | 'locked'>;

class PolicyRefusal extends Error {}

/** Signs in to the account's service with the password, proving it afresh. Returns the open link. */
async function proveAgain(deps: { verify: CredentialChangeCryptoPort; relay: RelayAuthPort; credentials: CredentialStorePort }, password: Secret): Promise<
  Result<{ link: RelayLink; wipe: () => void }, SetRecoveryKeyError>
> {
  const stored = await deps.credentials.load();
  if (stored === undefined) {
    password.wipe();
    return err('no_account', 'There is no account on this device');
  }
  if (stored.registration !== 'done') {
    password.wipe();
    return err('not_registered', 'This account is not registered with a service yet');
  }
  const handle = await deps.verify.begin({ password, credentials: stored });
  if (handle === 'wrong_password') return err('wrong_password', 'That password is not right');
  let attempt;
  try {
    attempt = await deps.relay.signIn({
      server: stored.server, email: stored.email, deviceId: stored.deviceId,
      async deriveX(hello) {
        const policy = checkKdfPolicy(hello.kdf.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: hello.kdf.mKib, t: hello.kdf.t, p: hello.kdf.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: hello.kdf.iterations });
        if (!policy.ok) throw new PolicyRefusal();
        return handle.currentSrpX(hello);
      },
    });
  } catch (e) {
    handle.wipe();
    if (e instanceof PolicyRefusal) return { ok: false, error: mapRelayError('kdf_below_floor') };
    throw e;
  }
  if (!attempt.ok) {
    handle.wipe();
    return { ok: false, error: mapRelayError(attempt.kind) };
  }
  return ok({ link: attempt.link, wipe: () => { attempt.link.close(); handle.wipe(); } });
}

export function setRecoveryKey(deps: SetRecoveryKeyDeps) {
  return async function run(input: { readonly password: Secret }): Promise<Result<{ recoveryKeyText: string }, SetRecoveryKeyError>> {
    const account = deps.account();
    if (account === undefined) {
      input.password.wipe();
      return err('locked', 'Unlock the app first');
    }
    const proof = await proveAgain(deps, input.password);
    if (!proof.ok) return proof;
    try {
      const made = await deps.crypto.create({ account });
      const reply = await proof.value.link.request('PUT', '/accounts/me/recovery', {
        uuid: made.payload.uuid, auth_salt: made.payload.authSalt, srp_verifier: made.payload.srpVerifier, wrapped: made.payload.wrapped,
      });
      if (!reply.ok) return { ok: false, error: mapRelayError(reply.kind) };
      deps.logger?.info('recovery.set', {});
      return ok({ recoveryKeyText: made.recoveryKeyText });
    } finally {
      proof.value.wipe();
    }
  };
}

/** Removes the Recovery Key: the service forgets the credential, and the key printed or saved earlier no longer works. */
export function removeRecoveryKey(deps: Pick<SetRecoveryKeyDeps, 'verify' | 'relay' | 'credentials' | 'logger'>) {
  return async function run(input: { readonly password: Secret }): Promise<Result<true, SetRecoveryKeyError>> {
    const proof = await proveAgain(deps, input.password);
    if (!proof.ok) return proof;
    try {
      const reply = await proof.value.link.request('DELETE', '/accounts/me/recovery');
      if (!reply.ok) return { ok: false, error: mapRelayError(reply.kind) };
      deps.logger?.info('recovery.removed', {});
      return ok(true as const);
    } finally {
      proof.value.wipe();
    }
  };
}

// ---------------------------------------------------------------- recovering

export interface RecoverInput {
  readonly email: string;
  readonly server: string;
  /** The "R1-…" text, typed or pasted. */
  readonly recoveryKeyText: string;
  /** The new password. Consumed: wiped on every path. */
  readonly newPassword: Secret;
}

export interface Recovered extends SignedIn {
  /** The new Secret Key, to show once and put in a new Emergency Kit: the old one no longer works. */
  readonly secretKeyText: string;
}

export type RecoverError =
  | SignInError
  | DomainError<'invalid_recovery_key' | 'wrong_recovery_key' | 'no_recovery_key'>
  | (DomainError<'weak_password'> & { readonly violations: readonly PolicyViolation[] });

export interface RecoverDeps {
  readonly crypto: RecoveryCryptoPort;
  readonly relay: RelayAuthPort;
  readonly credentials: CredentialStorePort;
  /** Signs this device in with the new credentials once the account has them (US4). */
  readonly signIn: (input: SignInInput) => Promise<Result<SignedIn, SignInError>>;
  readonly random: { bytes(length: number): Uint8Array };
  readonly logger?: Logger;
}

export function recoverAccount(deps: RecoverDeps) {
  const { crypto, relay, credentials, random, logger } = deps;

  return async function run(input: RecoverInput): Promise<Result<Recovered, RecoverError>> {
    const refuse = <E extends RecoverError>(error: E): Result<never, E> => {
      input.newPassword.wipe();
      return { ok: false, error };
    };
    const email = normaliseEmail(input.email);
    if (!email.ok) return refuse(email.error);
    const server = normaliseServerAddress(input.server);
    if (!server.ok) return refuse(server.error);
    const policy = checkPassword(input.newPassword.use((b) => new TextDecoder().decode(b)));
    if (!policy.ok) return refuse({ code: 'weak_password', message: 'Choose a longer, less common password', violations: policy.violations });
    if ((await credentials.load()) !== undefined) return refuse({ code: 'already_has_account', message: 'This device already has an account' } as const);

    const handle = await crypto.begin({ recoveryKeyText: input.recoveryKeyText, email: email.value });
    if (handle === 'invalid_recovery_key') return refuse({ code: 'invalid_recovery_key', message: 'That is not a valid Recovery Key' } as const);

    let link: RelayLink | undefined;
    let replaced: { secretKeyText: string } | undefined;
    try {
      let attempt;
      try {
        attempt = await relay.signIn({
          server: server.value, email: email.value, deviceId: newIdV4((n) => random.bytes(n)), credential: 'recovery',
          async deriveX(hello) {
            if (!checkKdfPolicy(hello.kdf.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: hello.kdf.mKib, t: hello.kdf.t, p: hello.kdf.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: hello.kdf.iterations }).ok) throw new PolicyRefusal();
            return handle.srpX(hello);
          },
        });
      } catch (e) {
        if (e instanceof PolicyRefusal) return refuse({ code: 'kdf_below_floor', message: mapRelayError('kdf_below_floor').message } as const);
        throw e;
      }
      // A wrong key, no key set up and an unknown address are all the same answer here, and the person is told the same thing.
      if (!attempt.ok) return refuse(attempt.kind === 'rejected' ? ({ code: 'wrong_recovery_key', message: 'The email address or the Recovery Key is not right' } as const) : mapRelayError(attempt.kind));
      link = attempt.link;

      const material = await link.request('GET', '/accounts/me/recovery');
      if (!material.ok) return refuse(material.kind === 'not_found' ? ({ code: 'no_recovery_key', message: 'No Recovery Key is set for this account' } as const) : mapRelayError(material.kind));
      const fields = asMap(material.body);
      const [uuid, wrapped, keySet] = [fields.get('uuid'), fields.get('wrapped'), fields.get('keyset')];
      if (!(uuid instanceof Uint8Array) || !(wrapped instanceof Uint8Array) || !(keySet instanceof Uint8Array)) return refuse(mapRelayError('protocol'));

      const restored = await handle.restore({ accountId: attempt.accountId, recovery: { uuid, wrapped }, keySet, newPassword: input.newPassword });
      if (restored === 'wrong_key') return refuse({ code: 'wrong_recovery_key', message: 'The email address or the Recovery Key is not right' } as const);
      const sent = await link.request('PUT', '/accounts/me/keyset', {
        auth_salt: restored.rotation.authSalt,
        kdf: { kdf: 'argon2id', m_kib: BigInt(restored.rotation.kdf.mKib), t: BigInt(restored.rotation.kdf.t), p: BigInt(restored.rotation.kdf.p), enc_salt: restored.rotation.kdf.encSalt },
        srp_verifier: restored.rotation.srpVerifier, keyset: restored.rotation.keySet,
      });
      if (!sent.ok) return refuse(mapRelayError(sent.kind));
      replaced = { secretKeyText: restored.secretKeyText };
    } finally {
      link?.close();
      handle.wipe();
    }

    // The account now has the new credentials; signing in with them enrols this device the ordinary way and wipes the password.
    const signedIn = await deps.signIn({ email: email.value, server: server.value, secretKeyText: replaced.secretKeyText, password: input.newPassword });
    if (!signedIn.ok) return signedIn;
    logger?.info('account.recovered', {});
    return ok({ ...signedIn.value, secretKeyText: replaced.secretKeyText });
  };
}
