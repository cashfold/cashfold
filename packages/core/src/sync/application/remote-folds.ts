import { idToBytes, type Id } from '../../shared-kernel/id';
import { asMap, idOfBytes } from '../../identity/application/relay-wire';
import type { AccountSecrets, FoldGrantPort, RelayLink } from '../../identity/ports/index';
import type { FoldDirectory } from '../../sharing/ports/index';

// Makes the service know every Fold this device holds (US4, T200): a Fold created while offline, before the account was
// registered, or on another device that has not synced yet. The service stores the owner's own grant of the first key with
// the Fold, which is how the account's other devices will get it. Safe to repeat: a Fold that already exists is left alone.

export interface EnsureFoldsResult {
  /** Folds the service now knows (new or already there). */
  readonly present: readonly Id[];
  /** Folds that could not be created, with the reason. They are tried again at the next connection. */
  readonly failed: readonly { readonly fold: Id; readonly kind: string }[];
}

export async function ensureRemoteFolds(args: {
  link: RelayLink;
  directory: FoldDirectory;
  grants: FoldGrantPort;
  account: AccountSecrets;
  accountId: string;
  publicKeys: { enc: Uint8Array; sig: Uint8Array };
}): Promise<{ ok: true; value: EnsureFoldsResult } | { ok: false; kind: string }> {
  const { link, directory, grants, account, accountId, publicKeys } = args;
  const listed = await link.request('GET', '/folds');
  if (!listed.ok) return { ok: false, kind: listed.kind };
  const known = new Set<Id>();
  for (const row of Array.isArray(listed.body) ? (listed.body as unknown[]) : []) {
    const fold = idOfBytes(asMap(row).get('fold'));
    if (fold !== undefined) known.add(fold);
  }

  const present: Id[] = [...known];
  const failed: { fold: Id; kind: string }[] = [];
  for (const summary of await directory.list()) {
    if (known.has(summary.id)) continue;
    if (summary.role !== 'owner') continue; // a Fold shared with this account is created by its owner, not here
    const [grant] = await grants.grantsFor({ fold: summary.id, account, accountId, publicKeys });
    if (grant === undefined) {
      failed.push({ fold: summary.id, kind: 'no_key' });
      continue;
    }
    const created = await link.request('POST', '/folds', { fold: idToBytes(summary.id), grant });
    if (created.ok || created.kind === 'conflict') present.push(summary.id);
    else failed.push({ fold: summary.id, kind: created.kind });
  }
  return { ok: true, value: { present, failed } };
}


