import type { Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { normaliseServerAddress } from '../domain/server-address';
import type { AccountSecrets, CredentialStorePort, RegisterExistingCryptoPort, RegistrationPort, Secret } from '../ports/index';

// Register a local-only account with a service on first sync (US4, T200, FR-004, FR-013, FR-099). A device that was set up
// offline, before sync existed, or with no service chosen at all (`registration: 'local'`, spec 010) holds everything but has told
// no service about it. The password is asked for again
// because the service needs a verifier and a key set, and both come from the password and the Secret Key together.
// Local data is untouched; what changes is the sealed credentials (which now also hold the account's keys) and the address.
// Putting the existing Folds and their ops on the service is the sync engine's job once this has succeeded.

export interface RegisterExistingInput {
  /** Consumed: wiped on every path. */
  readonly password: Secret;
  /** The service to register with; defaults to the one chosen at sign-up. */
  readonly server?: string;
  readonly inviteCode?: string;
  /** Whether others may find the account by its email address. Defaults to true, as it always was for an account that was only pending. */
  readonly discoverable?: boolean;
}

export type RegisterExistingError = DomainError<
  'no_account' | 'already_registered' | 'invalid_server' | 'wrong_password' | 'offline' | 'email_taken' | 'rejected' | 'invite_required' | 'rate_limited'
>;

export interface Registered {
  readonly account: AccountSecrets;
  readonly publicKeys: { readonly enc: Uint8Array; readonly sig: Uint8Array };
  readonly server: string;
}

export function registerExisting(deps: {
  crypto: RegisterExistingCryptoPort;
  registration: RegistrationPort;
  credentials: CredentialStorePort;
  logger?: Logger;
}) {
  const { crypto, registration, credentials, logger } = deps;

  return async function run(input: RegisterExistingInput): Promise<Result<Registered, RegisterExistingError>> {
    const refuse = <E extends RegisterExistingError>(error: E): Result<never, E> => {
      input.password.wipe();
      return { ok: false, error };
    };
    const stored = await credentials.load();
    if (stored === undefined) return refuse({ code: 'no_account', message: 'There is no account on this device' } as const);
    if (stored.registration === 'done') return refuse({ code: 'already_registered', message: 'This account is already registered' } as const);
    const server = normaliseServerAddress(input.server ?? stored.server);
    if (!server.ok) return refuse({ code: 'invalid_server', message: server.error.message } as const);

    const prepared = await crypto.prepare({ password: input.password, credentials: stored });
    input.password.wipe();
    if (prepared === 'wrong_password') return err('wrong_password', 'That password is not right');

    const wipeAccount = (): void => {
      for (const s of [prepared.account.encSk, prepared.account.sigSk, prepared.account.srpX]) s.wipe();
    };
    const result = await registration.register({ ...prepared.registration, email: stored.email, discoverable: input.discoverable ?? true, server: server.value }, input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode });
    if (!result.ok) {
      wipeAccount();
      switch (result.reason) {
        case 'offline': return err('offline', 'The service cannot be reached');
        case 'email_taken': return err('email_taken', 'That email address is already registered with this service');
        case 'invite_required': return err('invite_required', 'This service needs an invitation code');
        case 'rate_limited': return err('rate_limited', 'Too many attempts. Try again shortly.');
        default: return err('rejected', 'The service did not accept the registration');
      }
    }

    // The new sealed blob carries the account's keys; the address and the registered flag change with it.
    await credentials.save({ ...stored, server: server.value, registration: 'done', sealed: prepared.sealed });
    logger?.info('account.registered', {});
    return ok({ account: prepared.account, publicKeys: prepared.publicKeys, server: server.value });
  };
}
