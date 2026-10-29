// Sign-up's one new decision (spec 010): keep everything on this device, or register with a service.

/** A build with no default service starts on "keep everything on this device"; one with a default service starts as it always did. */
export function startsLocalOnly(defaultServer: string): boolean {
  return defaultServer.trim() === '';
}

/**
 * The address to hand to sign-up. Choosing to keep everything on this device sends none, whatever was typed before the choice; otherwise
 * the typed address goes through as it is, and an empty one is reported as invalid instead of quietly becoming a local-only account.
 */
export function serverToSend(localOnly: boolean, typed: string): string {
  return localOnly ? '' : typed;
}

/** Core treats an empty address as "no service", so the form must stop one that was not chosen on purpose before it gets there. */
export function missingAddress(localOnly: boolean, typed: string): boolean {
  return !localOnly && typed.trim() === '';
}
