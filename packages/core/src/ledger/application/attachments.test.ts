import { attachmentKey, createAesGcm, createAttachmentCrypto, createHkdf, SecretBuf } from '@cashfold/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { attachmentOf, createAttachments, MAX_ATTACHMENT_BYTES, type AttachmentStorePort, type AttachmentTransportPort } from './attachments';
import { createTransactionCommands } from './transaction-commands';

const rng = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
const real = createAttachmentCrypto({ aead: createAesGcm(), rng });
const hkdf = createHkdf();
const idBytes = (i: Id) => Uint8Array.from({ length: 16 }, (_, k) => parseInt(i.replaceAll('-', '').slice(k * 2, k * 2 + 2), 16));
const foldKey = (epoch: number) => SecretBuf.from(new Uint8Array(32).fill(epoch));
const cryptoPort = {
  async seal(fold: Id, epoch: number, att: Id, plain: Uint8Array) {
    const key = await attachmentKey(hkdf, foldKey(epoch), idBytes(att));
    const sealed = await real.seal(key, idBytes(att), plain);
    // the nonce prefix travels in the first piece
    return sealed.frames.map((f, i) => (i === 0 ? Uint8Array.from([...sealed.prefix, ...f]) : f));
  },
  async open(fold: Id, epoch: number, att: Id, pieces: readonly Uint8Array[]) {
    const key = await attachmentKey(hkdf, foldKey(epoch), idBytes(att));
    return real.open(key, idBytes(att), { prefix: pieces[0]!.slice(0, 4), frames: pieces.map((p, i) => (i === 0 ? p.slice(4) : p)) });
  },
};

function memory() {
  const local = new Map<string, { bytes: Uint8Array; sent: boolean }>();
  const service = new Map<string, Uint8Array>();
  const key = (f: Id, a: Id, i: number) => `${f}/${a}/${i}`;
  const state = { up: true, quota: false };
  const store: AttachmentStorePort = {
    put: async (f, a, i, bytes, sent) => void local.set(key(f, a, i), { bytes, sent }),
    get: async (f, a, i) => local.get(key(f, a, i))?.bytes,
    pending: async () => [...local].filter(([, v]) => !v.sent).map(([k]) => { const [fold, attachment, index] = k.split('/'); return { fold: fold as Id, attachment: attachment as Id, index: Number(index) }; }),
    markSent: async (f, a, i) => void (local.get(key(f, a, i))!.sent = true),
    discard: async (f, a) => void [...local.keys()].filter((k) => k.startsWith(`${f}/${a}/`)).forEach((k) => local.delete(k)),
  };
  const transport: AttachmentTransportPort = {
    put: async (f, a, i, bytes) => (!state.up ? 'offline' : state.quota ? 'quota' : (service.set(key(f, a, i), bytes), 'ok')),
    get: async (f, a, i) => (!state.up ? 'offline' : (service.get(key(f, a, i)) ?? 'missing')),
  };
  return { local, service, state, store, transport };
}

let h: LedgerHarness;
let m: ReturnType<typeof memory>;
const attachments = () => createAttachments({ crypto: cryptoPort, store: m.store, transport: m.transport, epochOf: async () => 1 });
const TX = id(30);
const ATT = id(31);
const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);

beforeEach(async () => {
  h = await ledgerHarness();
  m = memory();
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
  const added = await h.run(createTransactionCommands({ clock: { nowMs: () => h.clock.now } }).addTransaction, {
    fold: h.fold, id: TX, accountId: id(1), direction: 'expense', amountMinor: -500n, currency: 'USD', occurredUtcMs: Date.UTC(2026, 1, 2, 12), tzOffsetMin: 0, note: 'Lunch',
  });
  expect(added.ok).toBe(true);
});

const meta = async () => attachmentOf(TX, await h.replica.projections.getRecord(h.fold, TX));
const attach = (over: Partial<{ id: Id; name: string; mime: string; bytes: Uint8Array }> = {}) =>
  h.run(attachments().attachFile, { fold: h.fold, transaction: TX, id: over.id ?? ATT, name: over.name ?? 'receipt.pdf', mime: over.mime ?? 'application/pdf', bytes: over.bytes ?? bytesOf(200_000) });

describe('attaching a file', () => {
  it('seals it in 64 KiB pieces kept here, records what it is, and points the transaction at it', async () => {
    expect(await attach()).toEqual({ ok: true, value: { id: ATT, size: 200_000, chunkCount: 4 } });
    expect([...m.local.keys()]).toHaveLength(4);
    expect(await meta()).toEqual({ id: ATT, meta: { name: 'receipt.pdf', mime: 'application/pdf', size: 200_000, chunkCount: 4, epoch: 1 } });
    expect((await h.ledger()).transactions.get(TX)?.attachmentRef).toBe(ATT);
    // what is kept is ciphertext
    const first = [...m.local.values()][0]!.bytes;
    expect(Buffer.from(first).includes(Buffer.from(bytesOf(40)))).toBe(false);
  });

  it('opens what was attached, exactly, from this device', async () => {
    const bytes = bytesOf(150_001);
    await attach({ bytes });
    const opened = await attachments().open(h.replica.projections, h.fold, TX);
    expect(opened.ok && opened.value.name).toBe('receipt.pdf');
    expect(opened.ok && Buffer.from(opened.value.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('replaces an earlier attachment', async () => {
    await attach();
    await attach({ id: id(32), name: 'newer.png', mime: 'image/png', bytes: bytesOf(10) });
    expect((await h.ledger()).transactions.get(TX)?.attachmentRef).toBe(id(32));
    expect(await meta()).toMatchObject({ id: id(32), meta: { name: 'newer.png', mime: 'image/png', size: 10 } });
  });

  it('is refused for a bad name, an empty or oversized file, an unknown transaction, a viewer, and leaves nothing behind', async () => {
    for (const [over, code] of [
      [{ name: '  ' }, 'invalid_name'], [{ name: 'a/b.pdf' }, 'invalid_name'], [{ name: 'x'.repeat(201) }, 'invalid_name'], [{ bytes: new Uint8Array(0) }, 'empty'], [{ bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }, 'too_large'],
    ] as const) expect(await attach(over), code).toMatchObject({ ok: false, error: { code } });
    expect(await h.run(attachments().attachFile, { fold: h.fold, transaction: id(99), id: ATT, name: 'a.pdf', mime: 'application/pdf', bytes: bytesOf(5) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    h.setRole('viewer');
    expect((await attach()).ok).toBe(false);
    expect(m.local.size).toBe(0);
    expect((await h.ledger()).transactions.get(TX)?.attachmentRef).toBeNull();
  });

  it('knows nothing of a mime type that is not one and keeps the file as plain data', async () => {
    await attach({ mime: 'not a type' });
    expect((await meta())?.meta.mime).toBe('application/octet-stream');
  });

  it('takes the file off a transaction', async () => {
    await attach();
    expect(await h.run(attachments().removeAttachment, { fold: h.fold, transaction: TX })).toEqual({ ok: true, value: true });
    expect((await h.ledger()).transactions.get(TX)?.attachmentRef).toBeNull();
    expect(await meta()).toBeUndefined();
    expect(await h.run(attachments().removeAttachment, { fold: h.fold, transaction: TX })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('sending and fetching the pieces', () => {
  it('sends what the service does not have, once, and stops at the first sign it is unreachable', async () => {
    await attach();
    m.state.up = false;
    expect(await attachments().upload()).toEqual({ sent: 0, failed: 0, offline: true });
    m.state.up = true;
    expect(await attachments().upload()).toEqual({ sent: 4, failed: 0, offline: false });
    expect(m.service.size).toBe(4);
    expect(await attachments().upload()).toEqual({ sent: 0, failed: 0, offline: false });
    m.state.quota = true;
    await attach({ id: id(33), bytes: bytesOf(5) });
    expect(await attachments().upload()).toEqual({ sent: 0, failed: 1, offline: false });
  });

  it('fetches the pieces it lacks from the service on the first open, keeps them, and opens offline afterwards', async () => {
    const bytes = bytesOf(130_000);
    await attach({ bytes });
    await attachments().upload();
    m.local.clear(); // another device: it has the record but none of the pieces
    m.state.up = false;
    expect(await attachments().open(h.replica.projections, h.fold, TX)).toMatchObject({ ok: false, error: { code: 'offline' } });
    m.state.up = true;
    const opened = await attachments().open(h.replica.projections, h.fold, TX);
    expect(opened.ok && Buffer.from(opened.value.bytes).equals(Buffer.from(bytes))).toBe(true);
    m.state.up = false;
    expect((await attachments().open(h.replica.projections, h.fold, TX)).ok).toBe(true);
  });

  it('reports a piece the service does not have, and refuses a file that was cut short, changed or reordered', async () => {
    await attach();
    await attachments().upload();
    m.local.clear();
    m.service.delete(`${h.fold}/${ATT}/2`);
    expect(await attachments().open(h.replica.projections, h.fold, TX)).toMatchObject({ ok: false, error: { code: 'unavailable' } });

    // a changed piece
    const keys = [...m.service.keys()];
    m.service.set(`${h.fold}/${ATT}/2`, m.service.get(keys[0]!)!);
    m.local.clear();
    expect(await attachments().open(h.replica.projections, h.fold, TX)).toMatchObject({ ok: false, error: { code: 'damaged' } });

    // the last piece cut off: the record says four, so a missing one is missing, and the last-piece marker catches a shorter file
    const piece = (n: number) => m.service.get(`${h.fold}/${ATT}/${n}`)!;
    m.service.set(`${h.fold}/${ATT}/1`, piece(0));
    m.service.set(`${h.fold}/${ATT}/2`, piece(0));
    m.local.clear();
    expect(await attachments().open(h.replica.projections, h.fold, TX)).toMatchObject({ ok: false, error: { code: 'damaged' } });
  });

  it('does not find an attachment on a transaction that has none', async () => {
    expect(await attachments().open(h.replica.projections, h.fold, TX)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
