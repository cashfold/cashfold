import { createFetchSend, type FetchLike } from './relay-http';
import { encode } from '@cashfold/protocol/cbor';

// Confirming an email address is a public call: the link may be opened on any device, signed in or not.
export function createEmailConfirm(deps: { fetchImpl?: FetchLike } = {}) {
  return async (server: string, token: string): Promise<{ ok: true } | { ok: false; kind: string }> => {
    try {
      const res = await createFetchSend(server, deps.fetchImpl)({ method: 'POST', path: '/accounts/verify-email', headers: { 'content-type': 'application/cbor' }, body: encode({ token } as never) });
      if (res.status === 204 || res.status === 200) return { ok: true };
      return { ok: false, kind: res.status === 429 ? 'rate_limited' : res.status === 400 ? 'bad_request' : 'protocol' };
    } catch {
      return { ok: false, kind: 'offline' };
    }
  };
}
