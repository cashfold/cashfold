import type { Id } from '../../shared-kernel/id';
import { newIdV4 } from '../../shared-kernel/id';
import { lit, type Logger } from '../../shared-kernel/logger';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { createFoldCommands } from '../../sharing/application/fold-commands';
import type { FoldSummary } from '../../sharing/ports/index';
import { activate, markRegistered, newDraftAccount, normaliseEmail, type UserAccount } from '../domain/user-account';
import { checkPassword, type PolicyViolation } from '../domain/password-policy';
import { normaliseServerAddress } from '../domain/server-address';
import type { AccountCryptoPort, CredentialStorePort, RegistrationPort, Secret, SessionPort } from '../ports/index';
import type { Session } from './lock';

export interface CreateAccountInput {
  readonly email: string;
  /** Consumed: wiped on every path. */
  readonly password: Secret;
  readonly server: string;
  readonly discoverable: boolean;
  readonly foldName?: string;
  readonly baseCurrency?: string;
}

export interface NewAccount {
  /** Shown to the user once; core keeps no copy outside the sealed credentials. */
  readonly secretKeyText: string;
  readonly accountId: string;
  readonly account: UserAccount;
  readonly fold: FoldSummary;
  /** `pending` when the service could not be reached: sign-up still works offline and registers later. */
  readonly registration: 'done' | 'pending';
}

export type CreateAccountError =
  | DomainError<'invalid_email' | 'invalid_server' | 'email_taken' | 'registration_rejected' | 'invalid_fold_name' | 'unknown_currency'>
  | (DomainError<'weak_password'> & { readonly violations: readonly PolicyViolation[] });

export interface CreateAccountDeps {
  readonly crypto: AccountCryptoPort;
  readonly registration: RegistrationPort;
  readonly credentials: CredentialStorePort;
  readonly sessionPort: SessionPort;
  readonly session: Session;
  readonly random: { bytes(length: number): Uint8Array };
  readonly logger?: Logger;
}

export const DEFAULT_FOLD_NAME = 'Personal';
export const DEFAULT_BASE_CURRENCY = 'USD';

/**
 * Sign-up (US1). Everything is created and stored on this device first, so it works offline; registration with the
 * service comes last and, if it is refused for a reason that cannot be fixed later (the email is taken), the local
 * state is rolled back completely.
 */
export function createAccount(deps: CreateAccountDeps) {
  const { crypto, registration, credentials, sessionPort, session, random, logger } = deps;

  return async function run(input: CreateAccountInput): Promise<Result<NewAccount, CreateAccountError>> {
    const rejectEarly = <E extends CreateAccountError>(error: E): Result<never, E> => {
      input.password.wipe();
      return { ok: false, error };
    };

    const email = normaliseEmail(input.email);
    if (!email.ok) return rejectEarly(email.error);
    const server = normaliseServerAddress(input.server);
    if (!server.ok) return rejectEarly(server.error);
    const policy = checkPassword(input.password.use((b) => new TextDecoder().decode(b)));
    if (!policy.ok) return rejectEarly({ code: 'weak_password', message: 'Choose a longer, less common password', violations: policy.violations });

    const material = await crypto.createAccount({ email: email.value, password: input.password });
    input.password.wipe();
    session.track(material.sessionKey);
    session.track(material.deviceSigningKey);

    let foldId: Id | undefined;
    let services: Awaited<ReturnType<SessionPort['start']>> | undefined;
    const rollback = async (): Promise<void> => {
      if (services !== undefined && foldId !== undefined) {
        await services.directory.remove(foldId).catch(() => undefined);
        await services.foldKeys.dropFoldKeys(foldId).catch(() => undefined);
      }
      await credentials.clear().catch(() => undefined);
      await sessionPort.stop().catch(() => undefined);
      session.release(material.sessionKey);
      session.release(material.deviceSigningKey);
      material.sessionKey.wipe();
      material.deviceSigningKey.wipe();
    };

    try {
      services = await sessionPort.start({ deviceId: material.deviceId, sessionKey: material.sessionKey, deviceSigningKey: material.deviceSigningKey });
      await credentials.save({ ...material.credentials, email: email.value, server: server.value, registration: 'pending' });

      foldId = newIdV4((n) => random.bytes(n));
      const folds = createFoldCommands({ directory: services.directory, foldKeys: services.foldKeys });
      const created = await services.commandBus.execute(folds.createFold, {
        fold: foldId, name: input.foldName ?? DEFAULT_FOLD_NAME, baseCurrency: input.baseCurrency ?? DEFAULT_BASE_CURRENCY,
      });
      if (!created.ok) {
        foldId = undefined;
        await rollback();
        return created.error.code === 'invalid_fold_name' || created.error.code === 'unknown_currency'
          ? err(created.error.code, created.error.message)
          : err('registration_rejected', created.error.message);
      }

      const registered = await registration.register({
        ...material.registration, email: email.value, discoverable: input.discoverable, server: server.value,
      });
      let account = newDraftAccount({ accountId: material.accountId, email: email.value, discoverable: input.discoverable, server: server.value });
      let outcome: 'done' | 'pending' = 'pending';
      if (registered.ok) {
        const reg = markRegistered(account);
        const act = reg.ok ? activate(reg.value) : reg;
        if (act.ok) account = act.value;
        outcome = 'done';
        await credentials.save({ ...material.credentials, email: email.value, server: server.value, registration: 'done' });
      } else if (registered.reason === 'email_taken') {
        await rollback();
        return err('email_taken', 'That email address is already registered');
      } else if (registered.reason === 'rejected') {
        await rollback();
        return err('registration_rejected', 'The service did not accept the registration');
      }

      logger?.info('account.created', { registration: lit(outcome) });
      return ok({ secretKeyText: material.secretKeyText, accountId: material.accountId, account, fold: created.value, registration: outcome });
    } catch (e) {
      await rollback();
      throw e;
    }
  };
}
