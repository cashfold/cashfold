/**
 * A random token kept in sessionStorage, which a browser restart clears. Quick unlock is offered only to the browser session that
 * enrolled it, so after a restart the password is required (FR-006). Where storage is blocked there is no marker, so quick
 * unlock is simply never offered.
 */
export function sessionMarker(create = false): string | undefined {
  try {
    let marker = sessionStorage.getItem('cashfold.session') ?? undefined;
    if (marker === undefined && create) {
      marker = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('cashfold.session', marker);
    }
    return marker;
  } catch {
    return undefined;
  }
}
