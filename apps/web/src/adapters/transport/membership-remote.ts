import { err, foldRef, ok, type MembershipEntry, type MembershipRemote, type PublicKeyBundle, type RelayLink, type RemoteFailure } from '@cashfold/core';
import { decodeEntry, encodeEntry, type PlainLogEntry } from '@cashfold/crypto';
import { idFromBytes } from '@cashfold/core';

// The service's side of sharing over a signed-in session: the membership log, invitations, grants and key lookups. Everything
// the service returns is checked by the caller (the log from its first entry, bundles by their signatures, grants by theirs).

const KIND: Readonly<Record<string, RemoteFailure>> = {
  offline: 'offline', forbidden: 'forbidden', conflict: 'conflict', not_found: 'not_found', rate_limited: 'rate_limited', gone: 'forbidden', rejected: 'forbidden',
};
const failure = (kind: string, message = kind) => err(KIND[kind] ?? 'rejected', message);
const asMap = (v: unknown): ReadonlyMap<string, unknown> => (v instanceof Map ? (v as ReadonlyMap<string, unknown>) : new Map());

function bundleFrom(body: unknown): PublicKeyBundle | undefined {
  const m = asMap(body);
  const [accountId, encPk, sigPk, selfSig] = [m.get('account_id'), m.get('enc_pk'), m.get('sig_pk'), m.get('self_sig')];
  if (typeof accountId !== 'string' || !(encPk instanceof Uint8Array) || !(sigPk instanceof Uint8Array) || !(selfSig instanceof Uint8Array)) return undefined;
  return { accountId, encPk, sigPk, selfSig };
}

export function createWebMembershipRemote(link: () => RelayLink | undefined): MembershipRemote {
  async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const l = link();
    if (l === undefined) return { ok: false as const, kind: 'offline' as const };
    return l.request(method, path, body);
  }

  return {
    async folds() {
      const r = await call('GET', '/folds');
      if (!r.ok) return failure(r.kind);
      const out = [];
      for (const row of Array.isArray(r.body) ? (r.body as unknown[]) : []) {
        const fold = asMap(row).get('fold');
        if (fold instanceof Uint8Array && fold.length === 16) out.push(idFromBytes(fold));
      }
      return ok(out);
    },

    async fetchLog(fold, after) {
      const r = await call('GET', `/folds/${foldRef(fold)}/log?after=${after}`);
      if (!r.ok) return failure(r.kind);
      const m = asMap(r.body);
      const entries = m.get('entries');
      const head = m.get('head');
      if (!Array.isArray(entries) || typeof head !== 'bigint') return failure('rejected', 'unexpected answer');
      try {
        return ok({ entries: (entries as Uint8Array[]).map((e) => decodeEntry(e) as MembershipEntry), head: Number(head) });
      } catch {
        return failure('rejected', 'a log entry could not be read');
      }
    },

    async postLog(fold, entry: MembershipEntry, grants) {
      const r = await call('POST', `/folds/${foldRef(fold)}/log`, { entry: encodeEntry(entry as PlainLogEntry), grants: [...grants] });
      return r.ok ? ok(true as const) : failure(r.kind);
    },

    async invite(fold, entry: MembershipEntry, grants, notifyEmail) {
      const r = await call('POST', `/folds/${foldRef(fold)}/invitations`, { entry: encodeEntry(entry as PlainLogEntry), grants: [...grants], ...(notifyEmail !== undefined && { notify_email: notifyEmail }) });
      return r.ok ? ok(true as const) : failure(r.kind);
    },

    async fetchGrants(fold) {
      const r = await call('GET', `/folds/${foldRef(fold)}/grants?member=me`);
      if (!r.ok) return failure(r.kind);
      return ok((Array.isArray(r.body) ? r.body : []).filter((g): g is Uint8Array => g instanceof Uint8Array));
    },

    async lookup(email) {
      const r = await call('POST', '/accounts/lookup', { email });
      if (!r.ok) return failure(r.kind);
      const bundle = bundleFrom(r.body);
      return bundle === undefined ? failure('rejected', 'unexpected answer') : ok(bundle);
    },

    async publicKeys(account) {
      const r = await call('GET', `/accounts/${encodeURIComponent(account)}/public-keys`);
      if (!r.ok) return failure(r.kind);
      const bundle = bundleFrom(r.body);
      return bundle === undefined ? failure('rejected', 'unexpected answer') : ok(bundle);
    },
  };
}
