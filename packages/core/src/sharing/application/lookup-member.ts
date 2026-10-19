import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { MembershipRemote, PublicKeyBundle, RemoteFailure, SharingCrypto } from '../ports/membership';
import { codeFromText, type InvitationCodePort } from './invitation-code';

// Finding the keys of the person to invite: by email address through the service (only for people who opted in, FR-106), or
// from the code they gave you. Either way the bundle must be signed by its own signing key, and the invitation still needs the
// fingerprint to be compared before it is sent.

export type LookupError = DomainError<RemoteFailure | 'invalid_bundle' | 'invalid_code'>;

export function createMemberLookup(deps: { remote: MembershipRemote; crypto: SharingCrypto; codes: InvitationCodePort }) {
  const checked = async (bundle: PublicKeyBundle): Promise<Result<PublicKeyBundle, LookupError>> =>
    (await deps.crypto.verifyBundle(bundle)) ? ok(bundle) : err('invalid_bundle', 'Those keys are not properly signed');

  return {
    /** An unknown address and an address that is not findable look the same, on purpose. */
    async byEmail(email: string): Promise<Result<PublicKeyBundle, LookupError>> {
      const found = await deps.remote.lookup(email.trim());
      if (!found.ok) return err(found.error.code, found.error.message);
      return checked(found.value);
    },

    async byCode(text: string): Promise<Result<PublicKeyBundle, LookupError>> {
      const bundle = deps.codes.decode(codeFromText(text));
      if (bundle === undefined) return err('invalid_code', 'That is not an invitation code');
      return checked(bundle);
    },
  };
}
