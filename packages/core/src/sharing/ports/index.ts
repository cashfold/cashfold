import type { Id } from '../../shared-kernel/id';
import type { Role } from '../../shared-kernel/role';

export interface FoldSummary {
  readonly id: Id;
  readonly name: string;
  readonly baseCurrency: string;
  /** Current key epoch. */
  readonly epoch: number;
  /** This user's role in the Fold. */
  readonly role: Role;
}

/** The Folds known on this device. Backed by the `fold` table, so it shares the command transaction. */
export interface FoldDirectory {
  list(): Promise<readonly FoldSummary[]>;
  get(fold: Id): Promise<FoldSummary | undefined>;
  /** Inserts or replaces the entry. */
  add(fold: FoldSummary): Promise<void>;
  rename(fold: Id, name: string): Promise<void>;
  /** Removes the Fold and every piece of its local data: op log, projections, domain rows. */
  remove(fold: Id): Promise<void>;
}

export interface FoldKeyPort {
  /** Creates and stores the first Fold key (epoch 1) and makes it the current key. Returns the epoch. */
  createFoldKey(fold: Id): Promise<number>;
  /** Forgets every key of the Fold on this device. */
  dropFoldKeys(fold: Id): Promise<void>;
}

/** Stores a Fold key that arrived from outside (a grant from the service). The port takes ownership of `key`. */
export interface FoldKeyImportPort {
  importFoldKey(fold: Id, epoch: number, key: { readonly use: <T>(fn: (bytes: Uint8Array) => T) => T; wipe(): void }): Promise<void>;
  /** The epochs this device holds a key for, ascending. */
  epochs(fold: Id): Promise<readonly number[]>;
}

export * from './membership';
