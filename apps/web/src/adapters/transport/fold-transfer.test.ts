import type { AccountSecrets, FoldGrantPort, FoldSummary, Id, RelayLink, RelayReply, SealedOp, StoredOp } from '@cashfold/core';
import { describe, expect, it } from 'vitest';
import { createFoldTransfer, type TransferSession } from './fold-transfer';

const FOLD = '00000000-0000-4000-8000-0000000000f1' as Id;
const secret = { length: 1, isWiped: false, use: <T>(fn: (b: Uint8Array) => T) => fn(new Uint8Array(1)), wipe: () => undefined };
const account: AccountSecrets = { encSk: secret, sigSk: secret, srpX: secret };
const identity = () => ({ accountId: 'ABCDEF', account, publicKeys: { enc: new Uint8Array(32), sig: new Uint8Array(32) } });
const sealed = (seq: number, dev = '00000000-0000-4000-8000-0000000000d1'): SealedOp => ({
  fold: FOLD, op: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}` as Id, rec: FOLD, dev: dev as Id, seq: BigInt(seq), hlc: { wallMs: 1, ctr: 0 }, epoch: 1, schema: 1, blob: new Uint8Array(10), sig: new Uint8Array(64),
});

function setup(o: { role?: FoldSummary['role']; members?: number; ops?: StoredOp[]; created?: RelayReply; pushError?: string; pushOffline?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; ops?: number | undefined }> = [];
  const cursor: Array<{ serverSeq: bigint; fromSnapshot: boolean }> = [];
  const link: RelayLink = {
    freshProof: new Uint8Array(32), close: () => undefined,
    async request(method, path, body) {
      if (method === 'POST' && path === '/folds') return o.created ?? { ok: true, status: 201, body: null };
      if (o.pushOffline) return { ok: false, kind: 'offline' };
      requests.push({ method, path, ops: Array.isArray(body) ? body.length : undefined });
      const rows = (Array.isArray(body) ? body : []).map(() => new Map<string, unknown>(o.pushError ? [['op', new Uint8Array(16)], ['error', o.pushError]] : [['op', new Uint8Array(16)], ['server_seq', 1n]]));
      return { ok: true, status: 200, body: rows };
    },
  };
  const session = {
    directory: { get: async () => ({ id: FOLD, name: 'A', baseCurrency: 'USD', epoch: 1, role: o.role ?? 'owner' }) as FoldSummary, list: async () => [{ id: FOLD }] },
    membership: { state: async () => ({ ok: true, value: { members: new Map(Array.from({ length: o.members ?? 1 }, (_, i) => [`M${i}`, {}])) } }) },
    oplog: { list: async () => o.ops ?? [] },
    cursors: { set: async (_f: Id, c: { serverSeq: bigint; fromSnapshot: boolean }) => void cursor.push(c) },
  } as unknown as TransferSession;
  const grants: FoldGrantPort = { grantsFor: async () => [new Uint8Array([1])], open: async () => [] };
  return { transfer: createFoldTransfer({ session: () => session, grants, identity }), link, requests, cursor };
}
const local = (n: number): StoredOp => ({ sealed: sealed(n), origin: 'local', pushed: true });
const remote = (n: number): StoredOp => ({ sealed: sealed(n, '00000000-0000-4000-8000-0000000000d2'), origin: 'remote', pushed: true });

describe('moving a Fold to another service', () => {
  it('creates the Fold with its grant and sends this device\'s ops in order, then starts its cursor over', async () => {
    const s = setup({ ops: [local(3), remote(1), local(1), local(2)] });
    expect(await s.transfer.transfer(FOLD, s.link)).toBe('ok');
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject({ path: expect.stringContaining('/ops'), ops: 3 }); // not the other device's op
    expect(s.cursor).toEqual([{ serverSeq: 0n, fromSnapshot: false }]);
  });

  it('sends large logs in batches', async () => {
    const s = setup({ ops: Array.from({ length: 450 }, (_, i) => local(i + 1)) });
    expect(await s.transfer.transfer(FOLD, s.link)).toBe('ok');
    expect(s.requests.map((r) => r.ops)).toEqual([200, 200, 50]);
  });

  it('leaves a shared Fold, or one it does not own, where it is', async () => {
    expect(await setup({ members: 2 }).transfer.transfer(FOLD, setup().link)).toBe('shared');
    expect(await setup({ role: 'editor' }).transfer.transfer(FOLD, setup().link)).toBe('shared');
  });

  it('accepts a Fold the service already has, and ops it already holds', async () => {
    const s = setup({ ops: [local(1)], created: { ok: false, kind: 'conflict' }, pushError: 'duplicate' });
    expect(await s.transfer.transfer(FOLD, s.link)).toBe('ok');
  });

  it('reports failures without moving the cursor', async () => {
    const refused = setup({ ops: [local(1)], pushError: 'bad_signature' });
    expect(await refused.transfer.transfer(FOLD, refused.link)).toBe('failed');
    expect(refused.cursor).toEqual([]);
    const offline = setup({ ops: [local(1)], pushOffline: true });
    expect(await offline.transfer.transfer(FOLD, offline.link)).toBe('offline');
    const forbidden = setup({ created: { ok: false, kind: 'forbidden' } });
    expect(await forbidden.transfer.transfer(FOLD, forbidden.link)).toBe('failed');
  });
});
