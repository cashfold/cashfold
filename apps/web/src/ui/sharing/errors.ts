/** Every refusal sharing can give, each with a sentence of its own. */
export const SHARING_ERROR_CODES = [
  'offline', 'forbidden', 'conflict', 'not_found', 'rate_limited', 'rejected', 'empty_log', 'bad_genesis', 'chain_broken', 'bad_signature', 'not_authorised',
  'invalid_entry', 'already_member', 'not_a_member', 'last_owner', 'no_change', 'bad_epoch', 'device_exists', 'unknown_device', 'time_goes_back', 'no_identity',
  'unknown_fold', 'not_owner', 'fingerprint_not_confirmed', 'invalid_bundle', 'not_invited', 'invitation_expired', 'grant_invalid', 'log_invalid', 'no_key',
  'self_target', 'invalid_code', 'verification_required',
] as const;

const KNOWN: ReadonlySet<string> = new Set(SHARING_ERROR_CODES);

/** The message key for a code. A lookup that finds nothing and a code that is not one say so in their own words. */
export function sharingError(code: string, context?: 'lookup' | 'code' | 'invite'): string {
  if (context === 'lookup' && code === 'not_found') return 'sharing.error.lookup_not_found';
  return KNOWN.has(code) ? `sharing.error.${code}` : 'sharing.error.generic';
}
