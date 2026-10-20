import type { Id } from '../../shared-kernel/id';
import type { Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { CredentialChangeCryptoPort, CredentialStorePort, RelayAuthPort, Secret } from '../ports/index';
import { checkKdfPolicy } from './kdf-policy';
import { mapRelayError, type SignInError } from './sign-in';

// Deleting the account (US9, FR-101). The password is asked for again and a new sign-in proves it to the service, so a
// stolen unlocked device cannot do this alone. Folds that other people share and this account owns block the deletion until
// ownership is handed over or the Fold is deleted; Folds shared with this account as editor or viewer are left first. Once
// the service has deleted everything, this device erases all local data. Other devices learn of it from `410 Gone`.

export interface DeletableFold {
  readonly id: Id;
  readonly name: string;
  readonly role: 'owner' | 'editor' | 'viewer';
  /** Whether anyone besides this account is a member. */
  readonly shared: boolean;
}

export interface DeleteAccountFolds {
  list(): Promise<readonly DeletableFold[]>;
  /** Leaves a Fold shared with others (signed membership entry). True when it is done. */
  leave(fold: Id): Promise<boolean>;
}

export interface DeleteAccountInput {
  /** Consumed: wiped on every path. */
  readonly password: Secret;
}

export type DeleteAccountError =
  | SignInError
  | DomainError<'no_account' | 'wrong_password' | 'not_registered' | 'could_not_leave'>
  | (DomainError<'owns_shared_fold'> & { readonly folds: ReadonlyArray<{ readonly id: Id; readonly name: string }> });

export interface DeleteAccountDeps {
  readonly crypto: CredentialChangeCryptoPort;
  readonly relay: RelayAuthPort;
  readonly credentials: CredentialStorePort;
  readonly folds: DeleteAccountFolds;
  /** Erases everything this device holds: database, keys, credentials, settings. */
  readonly eraseLocal: () => Promise<void>;
  readonly logger?: Logger;
}

class PolicyRefusal extends Error {}

export function deleteAccount(deps: DeleteAccountDeps) {
  const { crypto, relay, credentials, folds, eraseLocal, logger } = deps;

  return async function run(input: DeleteAccountInput): Promise<Result<true, DeleteAccountError>> {
    const stored = await credentials.load();
    if (stored === undefined) {
      input.password.wipe();
      return err('no_account', 'There is no account on this device');
    }
    if (stored.registration !== 'done') {
      input.password.wipe();
      return err('not_registered', 'This account is not registered with a service');
    }
    const handle = await crypto.begin({ password: input.password, credentials: stored });
    if (handle === 'wrong_password') return err('wrong_password', 'That password is not right');

    let signedIn: Awaited<ReturnType<RelayAuthPort['signIn']>> | undefined;
    try {
      const all = await folds.list();
      const blocking = all.filter((f) => f.role === 'owner' && f.shared);
      if (blocking.length > 0) {
        return { ok: false, error: { code: 'owns_shared_fold', message: 'Hand over ownership of shared Folds, or delete them, first', folds: blocking.map((f) => ({ id: f.id, name: f.name })) } };
      }

      try {
        signedIn = await relay.signIn({
          server: stored.server, email: stored.email, deviceId: stored.deviceId,
          async deriveX(hello) {
            const policy = checkKdfPolicy(hello.kdf.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: hello.kdf.mKib, t: hello.kdf.t, p: hello.kdf.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: hello.kdf.iterations });
            if (!policy.ok) throw new PolicyRefusal();
            return handle.currentSrpX(hello);
          },
        });
      } catch (e) {
        if (e instanceof PolicyRefusal) return err('kdf_below_floor', mapRelayError('kdf_below_floor').message);
        throw e;
      }
      if (!signedIn.ok) {
        if (signedIn.kind === 'gone') return await finish();
        return { ok: false, error: mapRelayError(signedIn.kind) };
      }

      // Leave what is shared with others, so they are told this account is gone rather than left with a ghost member.
      for (const f of all.filter((x) => x.shared)) if (!(await folds.leave(f.id))) return err('could_not_leave', `Could not leave “${f.name}”. Try again when the service is reachable.`);

      const reply = await signedIn.link.request('DELETE', '/accounts/me', { fresh_proof: signedIn.link.freshProof, removal_entries: [] });
      if (!reply.ok) {
        if (reply.kind === 'gone') return await finish();
        // The service knows what this device does not (a member added since the last sync): same answer as the local check.
        if (reply.kind === 'conflict') return { ok: false, error: { code: 'owns_shared_fold', message: 'Hand over ownership of shared Folds, or delete them, first', folds: [] } };
        return { ok: false, error: mapRelayError(reply.kind) };
      }
      return await finish();
    } finally {
      if (signedIn?.ok) signedIn.link.close();
      handle.wipe();
    }

    async function finish(): Promise<Result<true, DeleteAccountError>> {
      await eraseLocal();
      logger?.info('account.deleted', {});
      return ok(true as const);
    }
  };
}

/**
 * Another device deleted the account: the service answers every request with `410 Gone`. This device erases itself too, so
 * no copy of the data outlives the account (FR-101). Safe to call more than once.
 */
export async function wipeAfterGone(deps: { eraseLocal: () => Promise<void>; logger?: Logger }): Promise<void> {
  await deps.eraseLocal();
  deps.logger?.info('account.gone', {});
}
