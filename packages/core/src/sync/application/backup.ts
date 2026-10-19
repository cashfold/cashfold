import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import { baselineDrafts } from '../../sharing/application/history-scope';
import { SETTINGS_TABLE } from '../../sharing/domain/fold';
import type { ProjectionStore } from '../ports/index';
import type { SnapshotCodecPort } from './snapshot';
import type { OpDraft, WritePath } from './write-path';

// Encrypted backup and restore of one Fold (FR-091). A backup holds the Fold's merged state with every field's clock and every
// set member's tag, sealed under a passphrase or the Fold key. Restoring writes that state into a Fold as ordinary ops that keep
// those clocks and tags, so the result equals the original exactly, it syncs like anything else, and later edits merge as before.

export type BackupSecret =
  | { readonly kind: 'passphrase'; readonly passphrase: { use<T>(fn: (b: Uint8Array) => T): T; readonly length: number; wipe(): void } }
  | { readonly kind: 'foldKey'; readonly key: { use<T>(fn: (b: Uint8Array) => T): T; readonly length: number; wipe(): void }; readonly fold: Id };

export interface BackupCryptoPort {
  seal(plain: Uint8Array, secret: BackupSecret): Promise<Uint8Array>;
  /** Rejects with an Error named `AeadError` for a wrong secret or a changed file, `BackupError` for a file of another kind. */
  open(file: Uint8Array, secret: BackupSecret): Promise<Uint8Array>;
}

export type BackupError = DomainError<'wrong_secret' | 'not_a_backup' | 'not_empty' | 'corrupt'>;

const BATCH = 100;

export function createBackupService(deps: { projections: ProjectionStore; writePath: WritePath; codec: SnapshotCodecPort; crypto: BackupCryptoPort }) {
  const { projections, writePath, codec, crypto } = deps;
  return {
    /** The encrypted file for a Fold. */
    async create(fold: Id, secret: BackupSecret): Promise<Uint8Array> {
      const records = await projections.listRecords(fold);
      return crypto.seal(codec.encode({ baseline: new Map(), records }), secret);
    },

    /** Writes a backup's state into `into`, a Fold that holds nothing but its settings. Returns how many records came back. */
    async restore(file: Uint8Array, secret: BackupSecret, into: Id): Promise<Result<{ records: number }, BackupError>> {
      let plain: Uint8Array;
      try {
        plain = await crypto.open(file, secret);
      } catch (e) {
        const name = (e as { name?: string }).name;
        return name === 'AeadError' ? err('wrong_secret', 'That is not the passphrase or key this backup was made with') : err('not_a_backup', 'That file is not a backup of this kind');
      }
      let state;
      try {
        state = codec.decode(plain).records;
      } catch {
        return err('corrupt', 'The backup could not be read');
      }
      const existing = await projections.listRecords(into);
      if ([...existing.values()].some((s) => s.table !== SETTINGS_TABLE)) return err('not_empty', 'Restore into a new, empty Fold');
      const drafts: OpDraft[] = [];
      for (const [rec, s] of state) drafts.push(...baselineDrafts(into, rec, s));
      for (let i = 0; i < drafts.length; i += BATCH) {
        const written = await writePath.submitMany(drafts.slice(i, i + BATCH));
        if (!written.ok) return err('corrupt', `The backup could not be restored: ${written.error.code}`);
      }
      return ok({ records: state.size });
    },
  };
}
