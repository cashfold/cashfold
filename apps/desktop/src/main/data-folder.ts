import { mkdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Before the app opens its data it makes sure it can save: a folder that cannot be written (read-only volume, wrong permissions) would let
// the app start and then lose the work of the session, so the app says so and stops instead. Running low on space is not a reason to stop
// (the data can still be read and most changes are tiny), so it is only logged; the web app reports a full store itself.

export const LOW_SPACE_BYTES = 50 * 1024 * 1024;

export type DataFolderStatus = { readonly kind: 'ok' } | { readonly kind: 'not-writable' } | { readonly kind: 'low-space'; readonly freeBytes: number };

export interface DataFolderDeps {
  mkdir(path: string): void;
  /** Writes a small file in the folder and removes it again; throws when that is not possible. */
  probe(path: string): void;
  freeBytes(path: string): number | undefined;
}

const defaults: DataFolderDeps = {
  mkdir: (path) => void mkdirSync(path, { recursive: true }),
  probe(path) {
    const file = join(path, `.write-test-${process.pid}`);
    writeFileSync(file, 'x');
    rmSync(file, { force: true });
  },
  freeBytes(path) {
    try {
      const stats = statfsSync(path);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return undefined;
    }
  },
};

export function checkDataFolder(userData: string, deps: DataFolderDeps = defaults): DataFolderStatus {
  try {
    deps.mkdir(userData);
    deps.probe(userData);
  } catch {
    return { kind: 'not-writable' };
  }
  const free = deps.freeBytes(userData);
  return free !== undefined && free < LOW_SPACE_BYTES ? { kind: 'low-space', freeBytes: free } : { kind: 'ok' };
}

/** The message for a problem that stops the app; nothing for the ones that do not. */
export function problemMessage(status: DataFolderStatus, userData: string): { title: string; detail: string } | undefined {
  if (status.kind !== 'not-writable') return undefined;
  return {
    title: 'Cashfold cannot save your data here',
    detail: `The folder that holds your data is not writable:\n\n${userData}\n\nYour data has not been changed. Check that the folder and its disk are not read-only and that you may write to them, then start Cashfold again.`,
  };
}
