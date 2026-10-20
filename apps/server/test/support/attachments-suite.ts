import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { FOLD_CHUNK_QUOTA, MAX_CHUNK_BYTES, MAX_CHUNK_INDEX } from '../../src/modules/attachments/attachments.controller.js';
import type { Store } from '../../src/store/store.js';
import { register, signIn, startRelay, type Harness } from './relay-harness.js';

// Sealed attachment pieces on the service (FR-093): stored once, readable by members, writable by editors and owners, never opened.
export function describeAttachments(label: string, makeStore: () => Promise<Store>): void {
  describe(`Attachments: ${label}`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      while (open.length > 0) await open.pop()!.close();
    });
    const start = async (): Promise<Harness> => {
      const h = await startRelay(await makeStore(), { rateLimitScale: 1000 });
      open.push(h);
      return h;
    };
    const status = async (p: Promise<unknown>): Promise<number> => p.then(() => 200, (e: { status?: number }) => e.status ?? 0);
    const path = (fold: Buffer, att: Buffer, index: number | string) => `/folds/${fold.toString('base64url')}/attachments/${att.toString('base64url')}/chunks/${index}`;

    async function world() {
      const h = await start();
      const [alice, bob, eve] = [await register(h), await register(h), await register(h)];
      const a = (await signIn(h, alice)).session;
      const b = (await signIn(h, bob)).session;
      const e = (await signIn(h, eve)).session;
      const fold = randomBytes(16);
      await a.request('POST', '/folds', { fold });
      await h.relay.services.store.folds.addMember(fold, bob.accountId, 3, 1); // bob: viewer
      return { h, a, b, e, fold, att: randomBytes(16), store: h.relay.services.store };
    }

    it('stores a piece and gives it back byte for byte to any member', async () => {
      const { a, b, fold, att } = await world();
      const piece = randomBytes(65_552);
      expect((await a.request('PUT', path(fold, att, 0), piece)).status).toBe(204);
      expect(Buffer.from((await a.request('GET', path(fold, att, 0))).body as Uint8Array)).toEqual(piece);
      expect(Buffer.from((await b.request('GET', path(fold, att, 0))).body as Uint8Array)).toEqual(piece);
    });

    it('accepts the same piece again, refuses a different one at the same place, and answers 404 for a piece never stored', async () => {
      const { a, fold, att } = await world();
      const piece = randomBytes(100);
      await a.request('PUT', path(fold, att, 3), piece);
      expect(await status(a.request('PUT', path(fold, att, 3), piece))).toBe(200);
      expect(await status(a.request('PUT', path(fold, att, 3), randomBytes(100)))).toBe(409);
      expect(await status(a.request('GET', path(fold, att, 4)))).toBe(404);
    });

    it('lets only owners and editors write, and only members read', async () => {
      const { b, e, fold, att, a } = await world();
      await a.request('PUT', path(fold, att, 0), randomBytes(50));
      expect(await status(b.request('PUT', path(fold, att, 1), randomBytes(50)))).toBe(403); // a viewer
      expect(await status(e.request('PUT', path(fold, att, 1), randomBytes(50)))).toBe(403); // not a member
      expect(await status(e.request('GET', path(fold, att, 0)))).toBe(403);
    });

    it('refuses an empty or oversized piece, a bad index, a bad id', async () => {
      const { a, fold, att } = await world();
      expect(await status(a.request('PUT', path(fold, att, 0), new Uint8Array(0)))).toBe(400);
      expect(await status(a.request('PUT', path(fold, att, 0), randomBytes(MAX_CHUNK_BYTES + 1)))).toBe(400);
      expect(await status(a.request('PUT', path(fold, att, MAX_CHUNK_INDEX + 1), randomBytes(10)))).toBe(400);
      expect(await status(a.request('PUT', path(fold, att, 'x'), randomBytes(10)))).toBe(400);
      expect(await status(a.request('PUT', path(fold, att, -1), randomBytes(10)))).toBe(400);
      expect(await status(a.request('PUT', `/folds/${fold.toString('base64url')}/attachments/short/chunks/0`, randomBytes(10)))).toBe(400);
      expect(await status(a.request('PUT', path(fold, att, 0), 'not bytes'))).toBe(400);
    });

    it('stops a Fold at its quota but still accepts a piece it already holds', async () => {
      const { a, fold, att, store } = await world();
      const first = randomBytes(20);
      await a.request('PUT', path(fold, att, 0), first);
      // Fill the Fold straight through the store, then try one more through the relay.
      const filler = randomBytes(16);
      const real = store.attachments.chunkCount.bind(store.attachments);
      (store.attachments as { chunkCount: typeof real }).chunkCount = async () => FOLD_CHUNK_QUOTA;
      expect(await status(a.request('PUT', path(fold, filler, 0), randomBytes(20)))).toBe(413);
      expect(await status(a.request('PUT', path(fold, att, 0), first))).toBe(200);
      (store.attachments as { chunkCount: typeof real }).chunkCount = real;
      expect(await status(a.request('PUT', path(fold, filler, 0), randomBytes(20)))).toBe(200);
    });

    it('removes the pieces with the Fold', async () => {
      const { a, fold, att, store } = await world();
      await a.request('PUT', path(fold, att, 0), randomBytes(20));
      await store.folds.remove(fold);
      expect(await store.attachments.getChunk(fold, att, 0)).toBeUndefined();
    });
  });
}
