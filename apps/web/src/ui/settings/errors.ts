/** Every refusal the account settings can give, each with a sentence of its own. */
export const ACCOUNT_ERROR_CODES = [
  'wrong_password', 'weak_password', 'same_password', 'nothing_to_change', 'offline', 'rate_limited', 'not_registered', 'sync_unavailable', 'service_error', 'wrong_credentials',
  'kdf_below_floor', 'device_removed', 'locked', 'no_account', 'invalid_server', 'invalid_email', 'email_taken', 'invite_required', 'registration_rejected', 'transfer_failed',
  'same_server', 'could_not_leave', 'owns_shared_fold', 'invalid_recovery_key', 'wrong_recovery_key', 'no_recovery_key', 'already_has_account', 'empty_passphrase',
  'wrong_secret', 'not_a_backup', 'corrupt', 'not_empty', 'account_not_found', 'nothing_to_import', 'too_many_rows', 'batch_not_found', 'already_undone', 'rate_required',
  'permission_denied', 'invalid_fold_name', 'unknown_currency',
] as const;

const KNOWN: ReadonlySet<string> = new Set(ACCOUNT_ERROR_CODES);

export interface AccountFailure {
  readonly code: string;
  readonly retryAfterMs?: number;
}

/** The message key for a code; a code that is not one says so in general words. */
export const accountErrorKey = (code: string): string => (KNOWN.has(code) ? `account.error.${code}` : 'account.error.generic');

/** A sentence for a failure, in the person's language. A password that is tried too often waits, and says for how long. */
export function accountErrorText(t: (key: string, values?: Record<string, string | number>) => string, error: AccountFailure): string {
  if (error.code === 'too_many_attempts') return t('unlock.error.too_many_attempts', { seconds: Math.ceil((error.retryAfterMs ?? 0) / 1000) });
  return t(accountErrorKey(error.code));
}

export type Reply<T> = { ok: true; value: T } | { ok: false; error: AccountFailure };
