import type { Id } from '../../shared-kernel/id';
import type { FoldDirectory, FoldKeyPort, MembershipStore } from '../ports/index';

// When the log shows that this account was removed from a Fold, or left it, this device forgets the Fold (FR-104, ARCH 7.7):
// its rows, op log, keys and the copy of its log. Data already seen or copied cannot be recalled, and the app says so.

export const FOLD_REMOVED = 'FoldRemoved';

export interface WipeDeps {
  readonly directory: FoldDirectory;
  readonly foldKeys: FoldKeyPort;
  readonly membership: MembershipStore;
  /** Anything else the platform keeps for a Fold (attachments, cached projections). */
  readonly also?: (fold: Id) => Promise<void>;
  /** Tells the app a Fold is gone from this device. */
  readonly announce?: (event: { readonly type: typeof FOLD_REMOVED; readonly fold: Id }) => void;
}

export function createFoldWiper(deps: WipeDeps): (fold: Id) => Promise<void> {
  return async (fold) => {
    // Keys first: even if removing the rows is interrupted, nothing left can be read.
    await deps.foldKeys.dropFoldKeys(fold);
    await deps.membership.clear(fold);
    await deps.also?.(fold);
    await deps.directory.remove(fold);
    deps.announce?.({ type: FOLD_REMOVED, fold });
  };
}
