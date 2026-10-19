import { createFoldCommands, idToBytes, type AccountSecrets, type FoldGrantPort, type Id, type MigrationFolds } from '@cashfold/core';
import type { OpenSession } from '../sqlite-opfs/web-session';
import { createRelayTransport } from './relay-ports';

// Moving to another service (FR-100), the web side: what it takes to put one Fold on the new service. The Fold is created there
// with the owner's own grants, and this device's ops are sent exactly as they were signed. A device can only send ops it
// wrote itself, so what other devices wrote reaches the new service when they sign in there and send it.

const BATCH = 200;

export type TransferSession = Pick<OpenSession, 'directory' | 'foldKeys' | 'commandBus' | 'membership' | 'oplog' | 'cursors'>;

export interface FoldTransferDeps {
  readonly session: () => TransferSession | undefined;
  readonly grants: FoldGrantPort;
  readonly identity: () => { readonly accountId: string; readonly account: AccountSecrets; readonly publicKeys: { enc: Uint8Array; sig: Uint8Array } } | undefined;
}

export function createFoldTransfer(deps: FoldTransferDeps): MigrationFolds {
  return {
    async list() {
      return (await deps.session()?.directory.list())?.map((f) => f.id) ?? [];
    },

    async announce(fold: Id, server: string) {
      const s = deps.session();
      if (s === undefined) return false;
      const commands = createFoldCommands({ directory: s.directory, foldKeys: s.foldKeys });
      return (await s.commandBus.execute(commands.announceServer, { fold, server })).ok;
    },

    async transfer(fold, to) {
      const s = deps.session();
      const me = deps.identity();
      if (s === undefined || me === undefined) return 'failed';
      const summary = await s.directory.get(fold);
      if (summary === undefined) return 'failed';
      // Anything with other people in it, or that is theirs, has signed entries only they can replay.
      const membership = await s.membership.state(fold);
      if (summary.role !== 'owner' || (membership.ok && membership.value.members.size > 1)) return 'shared';

      const [grant] = await deps.grants.grantsFor({ fold, account: me.account, accountId: me.accountId, publicKeys: me.publicKeys });
      if (grant === undefined) return 'failed';
      const created = await to.request('POST', '/folds', { fold: idToBytes(fold), grant });
      if (!created.ok && created.kind !== 'conflict') return created.kind === 'offline' ? 'offline' : 'failed';

      const own = (await s.oplog.list(fold)).filter((o) => o.origin === 'local').map((o) => o.sealed).sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
      const transport = createRelayTransport(to);
      try {
        for (let at = 0; at < own.length; at += BATCH) {
          const outcomes = await transport.push(fold, own.slice(at, at + BATCH));
          if (outcomes.some((o) => o.error !== undefined && o.error !== 'duplicate')) return 'failed';
        }
      } catch (e) {
        return (e as { kind?: string }).kind === 'offline' ? 'offline' : 'failed';
      }
      // The new service numbers everything afresh: start from its beginning and take back what it holds.
      await s.cursors.set(fold, { serverSeq: 0n, fromSnapshot: false });
      return 'ok';
    },
  };
}
