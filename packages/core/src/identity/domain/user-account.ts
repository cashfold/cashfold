import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';

export type AccountState = 'draft' | 'registered' | 'active';

/** The device-side view of the user's account. Secrets (password, Secret Key, keys) are never part of it. */
export interface UserAccount {
  readonly state: AccountState;
  /** Six-character non-secret id from the Secret Key. */
  readonly accountId: string;
  readonly email: string;
  /** Whether other users may find this account by email to invite it (FR-106). */
  readonly discoverable: boolean;
  /** The service address this account is bound to (FR-099). Empty for an account kept only on this device (spec 010). */
  readonly server: string;
  readonly emailVerified: boolean;
}

export type EmailError = DomainError<'invalid_email'>;
export type TransitionError = DomainError<'invalid_transition'>;

const MAX_LOCAL = 64;
const MAX_ADDRESS = 254;
const LOCAL = /^[^\s@]+$/u;
const LABEL = /^[^\s@.]+$/u;

/** Trims and lower-cases, then checks the shape of an address. Whether it can receive mail is for the service to find out. */
export function normaliseEmail(text: string): Result<string, EmailError> {
  const email = text.trim().toLowerCase();
  const fail = () => err('invalid_email', 'That does not look like an email address');
  if (email.length === 0 || email.length > MAX_ADDRESS) return fail();
  const parts = email.split('@');
  if (parts.length !== 2) return fail();
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || local.length > MAX_LOCAL || !LOCAL.test(local)) return fail();
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return fail();
  return ok(email);
}

export function newDraftAccount(input: Pick<UserAccount, 'accountId' | 'email' | 'discoverable' | 'server'>): UserAccount {
  return { state: 'draft', accountId: input.accountId, email: input.email, discoverable: input.discoverable, server: input.server, emailVerified: false };
}

const step = (from: AccountState, to: AccountState) => (account: UserAccount): Result<UserAccount, TransitionError> =>
  account.state === from ? ok({ ...account, state: to }) : err('invalid_transition', `An account cannot go from ${account.state} to ${to}`);

export const markRegistered = step('draft', 'registered');
export const activate = step('registered', 'active');
