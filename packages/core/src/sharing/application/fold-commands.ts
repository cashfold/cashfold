import { normaliseServerAddress } from '../../identity/domain/server-address';
import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError } from '../../shared-kernel/result';
import type { Role } from '../../shared-kernel/role';
import type { CommandDef } from '../../sync/application/buses';
import { foldSettingsPatch, settingsRecordId, validateFoldName, validateNewFold, type FoldError } from '../domain/fold';
import type { FoldDirectory, FoldKeyPort, FoldSummary } from '../ports/index';

type ExistsError = DomainError<'fold_exists'>;
type ConfirmError = DomainError<'confirmation_mismatch' | 'last_fold' | 'not_found'>;

/** Resolves this user's role in a Fold from the local directory (the membership log feeds the directory). */
export const roleResolver = (directory: FoldDirectory) => async (fold: Id): Promise<Role | undefined> => (await directory.get(fold))?.role;

export interface FoldDeletionSummary {
  readonly name: string;
  /** How many people lose the Fold. Shared Folds arrive with the sharing story; today it is only you. */
  readonly memberCount: number;
  readonly isLastFold: boolean;
}

/** What the confirmation dialog must say before a Fold is deleted (FR-022). */
export async function describeFoldDeletion(directory: FoldDirectory, fold: Id): Promise<FoldDeletionSummary | undefined> {
  const summary = await directory.get(fold);
  if (summary === undefined) return undefined;
  return { name: summary.name, memberCount: 1, isLastFold: (await directory.list()).length <= 1 };
}

export function createFoldCommands({ directory, foldKeys }: { directory: FoldDirectory; foldKeys: FoldKeyPort }) {
  const createFold: CommandDef<{ fold: Id; name: string; baseCurrency: string }, FoldSummary, FoldError | ExistsError> = {
    name: 'createFold',
    requires: null, // there is no membership to check before the Fold exists
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const valid = validateNewFold({ name: c.name, baseCurrency: c.baseCurrency });
      if (!valid.ok) return valid;
      if ((await directory.get(c.fold)) !== undefined) return err('fold_exists', 'A Fold with this id already exists');

      // The directory entry comes first: the Fold key row belongs to it. A new Fold always starts at epoch 1.
      const summary: FoldSummary = { id: c.fold, name: valid.value.name, baseCurrency: valid.value.baseCurrency, epoch: 1, role: 'owner' };
      try {
        await directory.add(summary);
        const epoch = await foldKeys.createFoldKey(c.fold);
        if (epoch !== summary.epoch) throw new Error('a new Fold must start at key epoch 1');
        const written = await ctx.submit([{ fold: c.fold, rec: settingsRecordId(c.fold), sets: new Map(), ...foldSettingsPatch(valid.value) }]);
        if (!written.ok) throw Object.assign(new Error(written.error.code), { result: written });
      } catch (e) {
        // Do not leave a key or an entry for a Fold that was never written.
        await directory.remove(c.fold);
        await foldKeys.dropFoldKeys(c.fold);
        const result = (e as { result?: { ok: false; error: DomainError } }).result;
        if (result !== undefined) return result as never;
        throw e;
      }
      return ok(summary);
    },
  };

  const renameFold: CommandDef<{ fold: Id; name: string }, string, FoldError> = {
    name: 'renameFold',
    requires: 'owner',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const name = validateFoldName(c.name);
      if (!name.ok) return name;
      await directory.rename(c.fold, name.value);
      const written = await ctx.submit([{ fold: c.fold, rec: settingsRecordId(c.fold), sets: new Map(), ...foldSettingsPatch({ name: name.value }) }]);
      if (!written.ok) return written as never;
      return ok(name.value);
    },
  };

  const deleteFold: CommandDef<{ fold: Id; confirmName: string }, true, ConfirmError> = {
    name: 'deleteFold',
    requires: 'owner',
    foldOf: (c) => c.fold,
    async handle(c) {
      const summary = await directory.get(c.fold);
      if (summary === undefined) return err('not_found', 'That Fold does not exist on this device');
      if (c.confirmName.trim() !== summary.name) return err('confirmation_mismatch', 'Type the Fold name exactly to confirm');
      if ((await directory.list()).length <= 1) return err('last_fold', 'You need at least one Fold');
      await directory.remove(c.fold);
      await foldKeys.dropFoldKeys(c.fold);
      return ok(true as const);
    },
  };

  /** Records where the Fold now lives, in its settings, signed like every other op (FR-100). Owners only. */
  const announceServer: CommandDef<{ fold: Id; server: string }, string, DomainError<'invalid_server'>> = {
    name: 'announceServer',
    requires: 'owner',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const server = normaliseServerAddress(c.server);
      if (!server.ok) return server;
      const written = await ctx.submit([{ fold: c.fold, rec: settingsRecordId(c.fold), sets: new Map(), ...foldSettingsPatch({ server: server.value }) }]);
      if (!written.ok) return written as never;
      return ok(server.value);
    },
  };

  return { createFold, renameFold, deleteFold, announceServer };
}
