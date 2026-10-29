import { lit, type Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { CredentialStorePort, LocalEraserPort, PendingEraseMarkerPort } from '../ports/index';
import type { Session } from './lock';

// Signing out (spec 011): the person leaves the account on this device so they can use another. This device's copy is erased; the account, its data
// and its other devices are not touched. The order matters, because locking ends the worker and an open database blocks the unlink:
//   mark → leave the service (best effort) → close the database → erase → announce → unmark → lock.
// The mark is written first and removed last, and every step is safe to repeat, so a sign-out that is cut short is finished on the next start
// (`finishPendingErase`) and a half-erased account is never shown. An account that exists only on this device has nowhere else to come back from,
// so the page makes the person confirm that; this module only does what it is told.

export interface SignOutDeps {
  readonly marker: PendingEraseMarkerPort;
  readonly eraser: LocalEraserPort;
  readonly credentials: CredentialStorePort;
  readonly session: Pick<Session, 'lock'>;
  /** Whether the app is unlocked, which is when a plain sign-out is allowed. */
  readonly isUnlocked: () => boolean;
  /** Closes the open database, if there is one. It must not end the worker, and must be safe to call twice. */
  readonly closeDatabase: () => Promise<void>;
  /** Told once the files are gone, before the mark is cleared and the session locked: the worker uses it to tell every tab. */
  readonly afterErase?: () => void;
  /** Removes this device from the account's device list on the service. True when it is done. Absent when there is no way to reach the service. */
  readonly revokeThisDevice?: () => Promise<boolean>;
  /** How long to wait for the service before giving up and erasing anyway. Needs `timers`; without them the service is simply waited for. */
  readonly timeLimitMs?: number;
  /** The host's timers, because `core` has none of its own. */
  readonly timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  readonly logger?: Logger;
}

export interface SignedOut {
  /** The account was registered with a service and this device could not be removed from its list, so it may stay listed there. */
  readonly deviceStillListed: boolean;
}

export type SignOutError = DomainError<'locked' | 'no_account' | 'wrong_email'>;

export interface SignOut {
  /** The unlocked app. */
  signOut(options?: { readonly leaveService?: boolean }): Promise<Result<SignedOut, SignOutError>>;
  /** From the lock screen: no password, only the account's own email address, typed. Contacts no service. */
  signOutLocked(input: { readonly email: string }): Promise<Result<SignedOut, SignOutError>>;
  /** At start, before anything else: finishes a sign-out that was cut short. True when there was one. */
  finishPendingErase(): Promise<boolean>;
}

const DEFAULT_LIMIT_MS = 5_000;
const normaliseEmail = (text: string): string => text.trim().toLowerCase();

export function createSignOut(deps: SignOutDeps): SignOut {
  const { marker, eraser, credentials, session, logger } = deps;

  /** Asks the service once and gives up after the time limit, whatever happens. */
  async function leaveService(): Promise<boolean> {
    const revoke = deps.revokeThisDevice;
    if (revoke === undefined) return false;
    const { timers } = deps;
    return new Promise<boolean>((resolve) => {
      const timer = timers?.set(() => resolve(false), deps.timeLimitMs ?? DEFAULT_LIMIT_MS);
      const stop = (): void => {
        if (timer !== undefined) timers?.clear(timer);
      };
      revoke().then(
        (done) => {
          stop();
          resolve(done);
        },
        () => {
          stop();
          resolve(false);
        },
      );
    });
  }

  /** The part that is safe to repeat. A failure leaves the mark set, so the next start does it again. */
  async function erase(): Promise<void> {
    await deps.closeDatabase().catch(() => undefined); // nothing open (the lock screen) or already closed is fine
    await eraser.eraseAll();
    deps.afterErase?.();
    await marker.clear();
  }

  return {
    async signOut(options) {
      const stored = await credentials.load();
      if (stored === undefined) return err('no_account', 'There is no account on this device');
      if (!deps.isUnlocked()) return err('locked', 'Unlock the app first');
      await marker.set();
      const registered = stored.registration === 'done';
      const removed = registered && options?.leaveService !== false ? await leaveService() : false;
      await erase();
      logger?.info('account.signed_out', { registration: lit(stored.registration), removed: lit(removed ? 'yes' : 'no') });
      await session.lock().catch(() => undefined); // last: it ends the worker
      return ok({ deviceStillListed: registered && !removed });
    },

    async signOutLocked(input) {
      const stored = await credentials.load();
      if (stored === undefined) return err('no_account', 'There is no account on this device');
      if (normaliseEmail(input.email) !== normaliseEmail(stored.email)) return err('wrong_email', 'That is not the email address of this account');
      await marker.set();
      await erase();
      logger?.info('account.signed_out', { registration: lit(stored.registration), removed: lit('no') });
      await session.lock().catch(() => undefined);
      return ok({ deviceStillListed: stored.registration === 'done' });
    },

    async finishPendingErase() {
      if (!(await marker.isSet())) return false;
      await erase();
      logger?.info('account.signed_out.finished', {});
      return true;
    },
  };
}
