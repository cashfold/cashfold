import { describe, expect, it } from 'vitest';
import { idToBytes, type Id } from '../../shared-kernel/id';
import type { AccountSecrets, FoldGrantPort, RelayLink, RelayReply, Secret } from '../../identity/ports/index';
import type { FoldDirectory, FoldSummary } from '../../sharing/ports/index';
import { id } from '../../testing/index';
import { ensureRemoteFolds } from './remote-folds';

const secret = (): Secret => ({ length: 32, isWiped: false, use: (fn) => fn(new Uint8Array(32)), wipe: () => undefined });
const account: AccountSecrets = { encSk: secret(), sigSk: secret(), srpX: secret() };
const keys = { enc: new Uint8Array(32), sig: new Uint8Array(32) };
const fold = (n: number, role: FoldSummary['role'] = 'owner'): FoldSummary => ({ id: id(n), name: `F${n}`, baseCurrency: 'USD', epoch: 1, role });

function run(local: FoldSummary[], remote: Id[], reply: (body: { fold: Uint8Array; grant: Uint8Array }) => RelayReply = () => ({ ok: true, status: 201, body: null }), grantOf: (f: Id) => Uint8Array | undefined = () => new Uint8Array([7])) {
  const posts: Array<{ fold: Uint8Array; grant: Uint8Array }> = [];
  const link: RelayLink = {
    freshProof: new Uint8Array(32), close: () => undefined,
    async request(method, path, body) {
      if (method === 'GET') return { ok: true, status: 200, body: remote.map((f) => new Map<string, unknown>([['fold', idToBytes(f)], ['head_seq', 0n]])) };
      posts.push(body as never);
      return reply(body as never);
    },
  };
  const directory = { list: async () => local } as unknown as FoldDirectory;
  const grants: FoldGrantPort = { grantsFor: async ({ fold: f }) => { const g = grantOf(f); return g === undefined ? [] : [g]; }, open: async () => [] };
  return { posts, result: ensureRemoteFolds({ link, directory, grants, account, accountId: 'ABCDEF', publicKeys: keys }) };
}

describe('ensureRemoteFolds (T200)', () => {
  it('creates, with the owner\'s grant, each Fold the service does not know', async () => {
    const { posts, result } = run([fold(1), fold(2), fold(3)], [id(2)]);
    const r = await result;
    expect(r).toMatchObject({ ok: true, value: { failed: [] } });
    expect(posts.map((p) => Buffer.from(p.fold).equals(Buffer.from(idToBytes(id(1)))) || Buffer.from(p.fold).equals(Buffer.from(idToBytes(id(3)))))).toEqual([true, true]);
    expect(posts.every((p) => p.grant.length === 1)).toBe(true);
    expect(r.ok && new Set(r.value.present)).toEqual(new Set([id(1), id(2), id(3)]));
  });

  it('does nothing when everything is already there, and is safe to repeat', async () => {
    const { posts, result } = run([fold(1)], [id(1)]);
    expect(await result).toMatchObject({ ok: true });
    expect(posts).toEqual([]);
  });

  it('treats "already exists" as success and reports other refusals per Fold without stopping', async () => {
    let n = 0;
    const { result } = run([fold(1), fold(2), fold(3)], [], () => (++n === 1 ? { ok: false, kind: 'conflict' } : n === 2 ? { ok: false, kind: 'offline' } : { ok: true, status: 201, body: null }));
    const r = await result;
    expect(r.ok && r.value.failed).toEqual([{ fold: id(2), kind: 'offline' }]);
    expect(r.ok && r.value.present).toContain(id(1));
    expect(r.ok && r.value.present).toContain(id(3));
  });

  it('does not create a Fold that is shared with this account, or one this device holds no key for', async () => {
    const { posts, result } = run([fold(1, 'editor'), fold(2)], [], undefined, (f) => (f === id(2) ? undefined : new Uint8Array([1])));
    const r = await result;
    expect(posts).toEqual([]);
    expect(r.ok && r.value.failed).toEqual([{ fold: id(2), kind: 'no_key' }]);
  });

  it('reports a service that cannot be asked', async () => {
    const link: RelayLink = { freshProof: new Uint8Array(32), close: () => undefined, request: async () => ({ ok: false, kind: 'offline' }) };
    const r = await ensureRemoteFolds({ link, directory: { list: async () => [fold(1)] } as unknown as FoldDirectory, grants: { grantsFor: async () => [], open: async () => [] }, account, accountId: 'A', publicKeys: keys });
    expect(r).toEqual({ ok: false, kind: 'offline' });
  });
});
