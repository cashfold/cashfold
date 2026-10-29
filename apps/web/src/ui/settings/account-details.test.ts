import { describe, expect, it } from 'vitest';
import { accountDetailsView } from './account-details';

describe('the account details in Settings (FR-006a)', () => {
  it('shows no empty service address and no "Pending" for an account kept only on this device', () => {
    expect(accountDetailsView({ server: '', registration: 'local' })).toEqual({ showAddress: false, registrationKey: 'sync.state.local_only' });
  });

  it('is unchanged for an account waiting to register and for one that is registered', () => {
    expect(accountDetailsView({ server: 'https://relay.example.com', registration: 'pending' })).toEqual({ showAddress: true, registrationKey: 'settings.account.pending' });
    expect(accountDetailsView({ server: 'https://relay.example.com', registration: 'done' })).toEqual({ showAddress: true, registrationKey: 'settings.account.registered' });
  });
});
