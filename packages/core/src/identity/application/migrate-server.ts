import type { Id } from '../../shared-kernel/id';
import type { Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { normaliseServerAddress } from '../domain/server-address';
import type { CredentialStorePort, MigrationCryptoPort, RegistrationPort, RelayAuthPort, RelayLink, Secret } from '../ports/index';
import { checkKdfPolicy } from './kdf-policy';
import { asMap, idOfBytes } from './relay-wire';
import { mapRelayError, type SignInError } from './sign-in';

// Moving the account and its Folds to another service (US9, FR-100). The Secret Key and password do not change: the new
// service gets the same key set, salts and verifier. Every Fold is announced with a signed `set_server` setting, then its
// membership log, grants and whole op log are put on the new service exactly as they are (same devices, sequence numbers and
// clocks), so nothing is lost and nothing is re-signed. The old service is asked to delete its copy last, and only if the
// rest went through.

export interface MigrationFolds {
  list(): Promise<readonly Id[]>;
  /** Writes the signed `set_server` setting into the Fold so other members learn where it moved. */
  announce(fold: Id, server: string): Promise<boolean>;
  /**
   * Puts the Fold's membership log, grants and op log on the service `to` is signed in to. `shared` when other people belong
   * to the Fold (or it has a membership history): their signed entries can only be replayed by their own authors, so it stays
   * where it is until its members move it together.
   */
  transfer(fold: Id, to: RelayLink): Promise<'ok' | 'offline' | 'failed' | 'shared'>;
}

export interface MigrateInput {
  /** Consumed: wiped on every path. */
  readonly password: Secret;
  readonly server: string;
  readonly inviteCode?: string;
  /** Ask the old service to delete this account afterwards (default true). */
  readonly deleteOld?: boolean;
}

export interface Migrated {
  readonly server: string;
  /** Folds now on the new service. */
  readonly folds: number;
  /** Folds left on the old service because they are shared. While any remain the old account is not deleted. */
  readonly kept: readonly Id[];
  /** The account's other devices still set up on the old service. They must sign in again on the new one; until they have, the old account is kept. */
  readonly otherDevices: number;
  /** False when the old service kept its copy: offline, kept Folds, other devices, or the account owns a Fold others still share there. */
  readonly oldDeleted: boolean;
}

export type MigrateError =
  | SignInError
  | DomainError<'no_account' | 'wrong_password' | 'not_registered' | 'same_server' | 'email_taken' | 'invite_required' | 'registration_rejected' | 'transfer_failed'>;

export interface MigrateDeps {
  readonly crypto: MigrationCryptoPort;
  readonly relay: RelayAuthPort;
  readonly registration: RegistrationPort;
  readonly credentials: CredentialStorePort;
  readonly folds: MigrationFolds;
  readonly logger?: Logger;
}

class PolicyRefusal extends Error {}

export function migrateToServer(deps: MigrateDeps) {
  const { crypto, relay, registration, credentials, folds, logger } = deps;

  return async function run(input: MigrateInput): Promise<Result<Migrated, MigrateError>> {
    const server = normaliseServerAddress(input.server);
    if (!server.ok) {
      input.password.wipe();
      return err('invalid_server', server.error.message);
    }
    const stored = await credentials.load();
    if (stored === undefined) {
      input.password.wipe();
      return err('no_account', 'There is no account on this device');
    }
    if (stored.registration !== 'done') {
      input.password.wipe();
      return err('not_registered', 'This account is not registered with a service yet');
    }
    if (stored.server === server.value) {
      input.password.wipe();
      return err('same_server', 'The account is already on that service');
    }
    const handle = await crypto.begin({ password: input.password, credentials: stored });
    if (handle === 'wrong_password') return err('wrong_password', 'That password is not right');

    const links: RelayLink[] = [];
    const signIn = async (address: string): Promise<Result<RelayLink, SignInError>> => {
      let attempt;
      try {
        attempt = await relay.signIn({
          server: address, email: stored.email, deviceId: stored.deviceId,
          async deriveX(hello) {
            const policy = checkKdfPolicy(hello.kdf.kdf === 'argon2id' ? { kdf: 'argon2id', mKib: hello.kdf.mKib, t: hello.kdf.t, p: hello.kdf.p } : { kdf: 'pbkdf2-hmac-sha256', iterations: hello.kdf.iterations });
            if (!policy.ok) throw new PolicyRefusal();
            return handle.srpX(hello);
          },
        });
      } catch (e) {
        if (e instanceof PolicyRefusal) return { ok: false, error: mapRelayError('kdf_below_floor') };
        throw e;
      }
      if (!attempt.ok) return { ok: false, error: mapRelayError(attempt.kind) };
      links.push(attempt.link);
      return ok(attempt.link);
    };

    try {
      const old = await signIn(stored.server);
      if (!old.ok) return old;
      const current = await old.value.request('GET', '/accounts/me/keyset');
      if (!current.ok) return { ok: false, error: mapRelayError(current.kind) };
      const keySet = asMap(current.body).get('keyset');
      if (!(keySet instanceof Uint8Array)) return err('service_error', mapRelayError('protocol').message);
      const status = await old.value.request('GET', '/accounts/me');
      const discoverable = status.ok ? asMap(status.body).get('discoverable') !== false : true;

      const payload = await handle.registration({ keySet, email: stored.email, server: server.value, discoverable });
      const registered = await registration.register(payload, input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode });
      // A move that stopped half-way left the account on the new service already: the same credentials still sign in there,
      // so the move can simply carry on from where it was. Anyone else's account would not accept them.
      let resumed: Result<RelayLink, SignInError> | undefined;
      if (!registered.ok && registered.reason === 'email_taken') {
        resumed = await signIn(server.value);
        if (!resumed.ok) return err('email_taken', 'That email address is already registered with the new service');
      } else if (!registered.ok) {
        switch (registered.reason) {
          case 'offline': return { ok: false, error: mapRelayError('offline') };
          case 'email_taken': return err('email_taken', 'That email address is already registered with the new service');
          case 'invite_required': return err('invite_required', 'The new service needs an invitation code');
          case 'rate_limited': return { ok: false, error: { code: 'rate_limited', message: mapRelayError('rate_limited').message } };
          default: return err('registration_rejected', 'The new service did not accept the registration');
        }
      }

      const fresh = resumed ?? (await signIn(server.value));
      if (!fresh.ok) return fresh;
      const all = await folds.list();
      const kept: Id[] = [];
      for (const fold of all) {
        const moved = await folds.transfer(fold, fresh.value);
        if (moved === 'offline') return { ok: false, error: mapRelayError('offline') };
        if (moved === 'failed') return err('transfer_failed', 'A Fold could not be copied to the new service. Nothing was deleted.');
        if (moved === 'shared') {
          kept.push(fold);
          continue;
        }
        // Said last, so the new location is only recorded for a Fold that is really there.
        if (!(await folds.announce(fold, server.value))) return err('transfer_failed', 'Could not record the move in a Fold. Nothing was deleted.');
      }

      // Everything is on the new service: this device follows it. Past this point the move has happened.
      await credentials.save({ ...stored, server: server.value });

      // Deleting the old account tells every device still on it to erase itself (410), and unsent changes would go with them.
      const listed = await old.value.request('GET', '/devices');
      const otherDevices = listed.ok && Array.isArray(listed.body)
        ? (listed.body as unknown[]).filter((d) => {
            const m = asMap(d);
            const dev = m.get('dev_id');
            return !m.has('revoked_at') && !(dev instanceof Uint8Array && idOfBytes(dev) === stored.deviceId);
          }).length
        : 0;
      let oldDeleted = false;
      if (input.deleteOld !== false && kept.length === 0 && otherDevices === 0 && listed.ok) {
        const gone = await old.value.request('DELETE', '/accounts/me', { fresh_proof: old.value.freshProof, removal_entries: [] });
        oldDeleted = gone.ok || gone.kind === 'gone';
      }
      logger?.info('account.migrated', {});
      return ok({ server: server.value, folds: all.length - kept.length, kept, otherDevices, oldDeleted });
    } finally {
      for (const l of links) l.close();
      handle.wipe();
    }
  };
}
