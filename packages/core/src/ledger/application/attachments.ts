import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { CommandDef } from '../../sync/application/buses';
import { isVisible } from '../../sync/domain/merge';
import type { FieldValue } from '../../sync/domain/merge';
import type { ProjectionStore } from '../../sync/ports/index';
import { noSets } from './context';
import { decodeTransaction, type AttachmentInfo } from '../domain/records';
import { TABLE, TXN_FIELD } from '../domain/tables';

// Files attached to transactions (FR-030, FR-093). A file is cut into pieces, each sealed on its own under the Fold's key, so the
// service holds ciphertext it cannot read and a missing or changed piece is noticed when the file is opened. The pieces are kept on
// this device first, so adding a file works offline; they reach the service when it can be reached, and are fetched back on the
// first open on a device that does not have them.

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_NAME = 200;

export interface AttachmentCryptoPort {
  /** The sealed pieces of a file. Anything a piece needs to be opened again (such as its nonce prefix) is inside the pieces. */
  seal(fold: Id, epoch: number, attachment: Id, plain: Uint8Array): Promise<readonly Uint8Array[]>;
  /** Rejects when a piece is missing, extra, moved or changed. */
  open(fold: Id, epoch: number, attachment: Id, pieces: readonly Uint8Array[]): Promise<Uint8Array>;
}

/** This device's copy of the sealed pieces. */
export interface AttachmentStorePort {
  put(fold: Id, attachment: Id, index: number, bytes: Uint8Array, sent: boolean): Promise<void>;
  get(fold: Id, attachment: Id, index: number): Promise<Uint8Array | undefined>;
  /** Pieces made here that the service does not have yet, oldest first. */
  pending(): Promise<ReadonlyArray<{ readonly fold: Id; readonly attachment: Id; readonly index: number }>>;
  markSent(fold: Id, attachment: Id, index: number): Promise<void>;
  discard(fold: Id, attachment: Id): Promise<void>;
}

export interface AttachmentTransportPort {
  put(fold: Id, attachment: Id, index: number, bytes: Uint8Array): Promise<'ok' | 'offline' | 'quota' | 'failed'>;
  get(fold: Id, attachment: Id, index: number): Promise<Uint8Array | 'offline' | 'missing' | 'failed'>;
}

export type AttachmentError = DomainError<'not_found' | 'invalid_name' | 'too_large' | 'empty' | 'no_key' | 'offline' | 'unavailable' | 'damaged'>;

export interface OpenedAttachment {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export type AttachmentMeta = AttachmentInfo;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** The attachment of a transaction record: its id and what it is, or undefined when it has none or the details do not read as well-formed. */
export function attachmentOf(rec: Id, state: Parameters<typeof decodeTransaction>[1] | undefined): { id: Id; meta: AttachmentMeta } | undefined {
  if (state === undefined || !isVisible(state)) return undefined;
  const txn = decodeTransaction(rec, state);
  return txn?.attachmentRef != null && txn.attachment != null ? { id: txn.attachmentRef, meta: txn.attachment } : undefined;
}

export function createAttachments(deps: {
  crypto: AttachmentCryptoPort;
  store: AttachmentStorePort;
  transport: AttachmentTransportPort;
  /** The key epoch new files are sealed under, or undefined when this device holds no key for the Fold. */
  epochOf: (fold: Id) => Promise<number | undefined>;
}) {
  const { crypto, store, transport } = deps;

  /** Attaches a file to a transaction, replacing any it had. The pieces are sealed and kept here before anything is recorded. */
  const attachFile: CommandDef<
    { fold: Id; transaction: Id; id: Id; name: string; mime: string; bytes: Uint8Array },
    { id: Id; size: number; chunkCount: number },
    AttachmentError
  > = {
    name: 'attachFile',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const name = c.name.trim();
      if (Array.from(name).length < 1 || Array.from(name).length > MAX_NAME || /\p{Cc}|[\\/]/u.test(name)) return err('invalid_name', 'A file name has 1 to 200 characters and no slashes or line breaks');
      if (c.bytes.length === 0) return err('empty', 'That file is empty');
      if (c.bytes.length > MAX_ATTACHMENT_BYTES) return err('too_large', 'Attachments can be up to 25 MB');
      const txn = await ctx.reader.getRecord(c.fold, c.transaction);
      if (txn === undefined || txn.table !== TABLE.transaction || !isVisible(txn)) return err('not_found', 'That transaction does not exist');
      const epoch = await deps.epochOf(c.fold);
      if (epoch === undefined) return err('no_key', 'This device has no key for that Fold');

      const pieces = await crypto.seal(c.fold, epoch, c.id, c.bytes);
      for (let i = 0; i < pieces.length; i++) await store.put(c.fold, c.id, i, pieces[i]!, false);

      const mime = MIME.test(c.mime) && c.mime.length <= 100 ? c.mime.toLowerCase() : 'application/octet-stream';
      const written = await ctx.submit([{
        fold: c.fold, rec: c.transaction, table: TABLE.transaction, sets: noSets,
        fields: new Map<number, FieldValue>([
          [TXN_FIELD.attachmentRef, c.id], [TXN_FIELD.attachmentName, name], [TXN_FIELD.attachmentMime, mime], [TXN_FIELD.attachmentSize, BigInt(c.bytes.length)],
          [TXN_FIELD.attachmentChunks, BigInt(pieces.length)], [TXN_FIELD.attachmentEpoch, BigInt(epoch)],
        ]),
      }]);
      if (!written.ok) {
        await store.discard(c.fold, c.id);
        return written as never;
      }
      return ok({ id: c.id, size: c.bytes.length, chunkCount: pieces.length });
    },
  };

  /** Takes the file off a transaction. The record goes; the sealed pieces are not needed by anyone any more. */
  const removeAttachment: CommandDef<{ fold: Id; transaction: Id }, true, AttachmentError> = {
    name: 'removeAttachment',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const txn = await ctx.reader.getRecord(c.fold, c.transaction);
      if (txn === undefined || txn.table !== TABLE.transaction || !isVisible(txn)) return err('not_found', 'That transaction does not exist');
      if (typeof txn.fields.get(TXN_FIELD.attachmentRef)?.value !== 'string') return err('not_found', 'That transaction has no attachment');
      const cleared = new Map<number, FieldValue>([TXN_FIELD.attachmentRef, TXN_FIELD.attachmentName, TXN_FIELD.attachmentMime, TXN_FIELD.attachmentSize, TXN_FIELD.attachmentChunks, TXN_FIELD.attachmentEpoch].map((f) => [f, null]));
      const written = await ctx.submit([{ fold: c.fold, rec: c.transaction, table: TABLE.transaction, sets: noSets, fields: cleared }]);
      if (!written.ok) return written as never;
      return ok(true as const);
    },
  };

  /** Opens an attachment: the pieces held here, and any others fetched from the service, verified as a whole. */
  async function open(projections: Pick<ProjectionStore, 'getRecord'>, fold: Id, transaction: Id): Promise<Result<OpenedAttachment, AttachmentError>> {
    const found = attachmentOf(transaction, await projections.getRecord(fold, transaction));
    if (found === undefined) return err('not_found', 'That transaction has no attachment');
    const { id: attachment, meta } = found;
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      let piece = await store.get(fold, attachment, i);
      if (piece === undefined) {
        const fetched = await transport.get(fold, attachment, i);
        if (fetched === 'offline') return err('offline', 'The service cannot be reached, and this device does not have the whole file yet');
        if (fetched === 'missing' || fetched === 'failed') return err('unavailable', 'The file is not available from the service');
        piece = fetched;
        await store.put(fold, attachment, i, piece, true);
      }
      pieces.push(piece);
    }
    let bytes: Uint8Array;
    try {
      bytes = await crypto.open(fold, meta.epoch, attachment, pieces);
    } catch {
      return err('damaged', 'The file has been changed or cut short, and cannot be trusted');
    }
    if (bytes.length !== meta.size) return err('damaged', 'The file has been changed or cut short, and cannot be trusted');
    return ok({ name: meta.name, mime: meta.mime, bytes });
  }

  /** Sends the pieces made on this device that the service does not have. Stops at the first sign the service cannot be reached. */
  async function upload(): Promise<{ sent: number; failed: number; offline: boolean }> {
    let sent = 0;
    let failed = 0;
    for (const p of await store.pending()) {
      const bytes = await store.get(p.fold, p.attachment, p.index);
      if (bytes === undefined) continue;
      const result = await transport.put(p.fold, p.attachment, p.index, bytes);
      if (result === 'offline') return { sent, failed, offline: true };
      if (result === 'ok') {
        await store.markSent(p.fold, p.attachment, p.index);
        sent++;
      } else failed++;
    }
    return { sent, failed, offline: false };
  }

  return { attachFile, removeAttachment, open, upload };
}
