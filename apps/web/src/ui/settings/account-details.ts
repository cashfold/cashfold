export interface AccountDetailsView {
  /** An account kept only on this device has no service address to show. */
  readonly showAddress: boolean;
  readonly registrationKey: string;
}

/** How Settings → Profile and security describes the account's service and registration (spec 010, FR-006a). */
export function accountDetailsView(account: { readonly server: string; readonly registration: 'pending' | 'done' | 'local' }): AccountDetailsView {
  if (account.registration === 'local') return { showAddress: false, registrationKey: 'sync.state.local_only' };
  return { showAddress: true, registrationKey: account.registration === 'done' ? 'settings.account.registered' : 'settings.account.pending' };
}
