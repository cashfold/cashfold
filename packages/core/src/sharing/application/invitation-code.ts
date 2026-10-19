import type { PublicKeyBundle } from '../ports/membership';

// An invitation code is how someone without a lookup (a service with verification off, or an account that is not
// discoverable) hands over their public keys: a short text, a link or a QR code carrying their signed key bundle (FR-106).
// The crypto package turns a bundle into that text and back; this module only gives it a name the app can use.

export interface InvitationCodePort {
  encode(bundle: PublicKeyBundle): string;
  /** Undefined if the text is not a code. The bundle is not yet trusted: its signature is checked when it is used. */
  decode(text: string): PublicKeyBundle | undefined;
}

/** The link an invitee shares: opening it in the app fills the code in. */
export const invitationLink = (origin: string, code: string): string => `${origin.replace(/\/+$/, '')}/folds/?code=${encodeURIComponent(code)}`;

/** The code inside a pasted link or bare code. */
export function codeFromText(text: string): string {
  const trimmed = text.trim();
  const match = /[?&]code=([^&#\s]+)/.exec(trimmed);
  return match === null ? trimmed : decodeURIComponent(match[1]!);
}
