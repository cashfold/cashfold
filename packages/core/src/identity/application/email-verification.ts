import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { RelayLink } from '../ports/index';
import { asMap } from './relay-wire';

// Email confirmation and discoverability (FR-105, FR-106). The service may have verification switched off (a self-hosted
// service with no mail server); the client then says so, and invitations rely on identity checks made outside the app.

export type VerificationState =
  | { readonly kind: 'verified' }
  | { readonly kind: 'unverified' }
  /** The service has no mail configured. */
  | { readonly kind: 'disabled' };

export interface AccountStatus {
  readonly verification: VerificationState;
  readonly discoverable: boolean;
}

export type VerificationError = DomainError<'offline' | 'rate_limited' | 'invalid_token' | 'disabled' | 'already_verified' | 'service_error'>;

const MIN_TOKEN = 16;
const mapKind = (kind: string): VerificationError => {
  switch (kind) {
    case 'offline': return { code: 'offline', message: 'The service cannot be reached' };
    case 'rate_limited': return { code: 'rate_limited', message: 'Too many requests. Try again shortly.' };
    case 'bad_request': return { code: 'invalid_token', message: 'That code is not valid or has expired' };
    default: return { code: 'service_error', message: 'The service did not answer as expected' };
  }
};

/** Reads the token from a verification link (`…/verify/#token=…`), or accepts the bare token pasted from the email. */
export function parseVerificationToken(input: string): string | undefined {
  const text = input.trim();
  const fromFragment = /[#&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  const token = fromFragment ?? (/^[A-Za-z0-9_-]+$/.test(text) ? text : undefined);
  return token !== undefined && token.length >= MIN_TOKEN && token.length <= 128 ? token : undefined;
}

export function createEmailVerification(deps: {
  /** The signed-in session, or undefined while offline. */
  link: () => RelayLink | undefined;
  /** Public route: confirming a link needs no session (the link may be opened on any device). */
  confirm: (token: string) => Promise<{ ok: true } | { ok: false; kind: string }>;
}) {
  const withLink = async <T>(fn: (link: RelayLink) => Promise<Result<T, VerificationError>>): Promise<Result<T, VerificationError>> => {
    const link = deps.link();
    return link === undefined ? err('offline', mapKind('offline').message) : fn(link);
  };

  return {
    status: () =>
      withLink<AccountStatus>(async (link) => {
        const reply = await link.request('GET', '/accounts/me');
        if (!reply.ok) return { ok: false, error: mapKind(reply.kind) };
        const m = asMap(reply.body);
        const verified = m.get('email_verified') === true;
        const mode = m.get('verification');
        const verification: VerificationState = verified ? { kind: 'verified' } : mode === 'disabled' ? { kind: 'disabled' } : { kind: 'unverified' };
        return ok({ verification, discoverable: m.get('discoverable') !== false });
      }),

    /** Asks the service to send a new link. */
    request: () =>
      withLink(async (link) => {
        const reply = await link.request('POST', '/accounts/me/verification');
        if (reply.ok) return ok(true as const);
        if (reply.kind === 'conflict') return err('already_verified', 'This address is already confirmed');
        if (reply.kind === 'not_found') return err('disabled', 'This service does not send email');
        return { ok: false, error: mapKind(reply.kind) };
      }),

    /** Uses the one-time code from the email. */
    async submit(input: string): Promise<Result<true, VerificationError>> {
      const token = parseVerificationToken(input);
      if (token === undefined) return err('invalid_token', mapKind('bad_request').message);
      const r = await deps.confirm(token);
      return r.ok ? ok(true as const) : { ok: false, error: mapKind(r.kind) };
    },

    setDiscoverable: (discoverable: boolean) =>
      withLink(async (link) => {
        const reply = await link.request('PUT', '/accounts/me/discoverable', { discoverable });
        return reply.ok ? ok(true as const) : { ok: false, error: mapKind(reply.kind) };
      }),
  };
}
