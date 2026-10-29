import { expect, type Page } from '@playwright/test';

// What the app leaves on a device after a sign-out (spec 011, SC-003). It reads the origin's own storage the way the leak scan does, and reports what is
// still there that belongs to the account: a database slot with any content, a credentials or quick-unlock record, the pending-erase marker, the
// account-tied settings, the Fold-keyed preferences and the shown-reminders list.

export interface Residue {
  /** Files in the OPFS pool that hold any byte other than zero (an empty slot is a header of zeros, truncated). */
  readonly opfsWithContent: readonly string[];
  /** Files that could not be read because something still held them open. */
  readonly opfsHeld: readonly string[];
  readonly deviceKeys: readonly string[];
  readonly quickKeys: readonly string[];
  readonly settings: Record<string, unknown> | undefined;
  readonly prefs: { recents?: unknown; firstRun?: unknown } | undefined;
  readonly shownReminders: string | null;
}

export async function residue(page: Page): Promise<Residue> {
  return page.evaluate(async () => {
    const opfsWithContent: string[] = [];
    const opfsHeld: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${path}/${name}`);
        else {
          try {
            const bytes = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
            if (bytes.some((b) => b !== 0)) opfsWithContent.push(`${path}/${name}`);
          } catch {
            opfsHeld.push(`${path}/${name}`);
          }
        }
      }
    };
    await walk(await navigator.storage.getDirectory(), '');

    const db = await new Promise<IDBDatabase | undefined>((resolve) => {
      const open = indexedDB.open('cashfold-credentials', 3);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(undefined);
    });
    const keys = (store: string): Promise<string[]> =>
      new Promise((resolve) => {
        if (db === undefined || !db.objectStoreNames.contains(store)) return resolve([]);
        const request = db.transaction(store).objectStore(store).getAllKeys();
        request.onsuccess = () => resolve(request.result.map(String));
        request.onerror = () => resolve([]);
      });
    const settings = await new Promise<Record<string, unknown> | undefined>((resolve) => {
      if (db === undefined || !db.objectStoreNames.contains('settings')) return resolve(undefined);
      const request = db.transaction('settings').objectStore('settings').get('current');
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => resolve(undefined);
    });
    const result = { deviceKeys: await keys('device'), quickKeys: await keys('quick') };
    db?.close();

    const rawPrefs = localStorage.getItem('cashfold.ui');
    const prefs = rawPrefs === null ? undefined : (JSON.parse(rawPrefs) as { recents?: unknown; firstRun?: unknown });
    return { opfsWithContent, opfsHeld, ...result, settings, prefs: prefs && { recents: prefs.recents, firstRun: prefs.firstRun }, shownReminders: localStorage.getItem('cashfold.reminders.shown') };
  });
}

/** Asserts that nothing of the account is left, while what belongs to the device (the lock policy) may be. */
export async function expectNoResidue(page: Page): Promise<void> {
  const r = await residue(page);
  expect(r.opfsHeld, 'files still held open').toEqual([]);
  expect(r.opfsWithContent, 'files with content').toEqual([]);
  expect(r.deviceKeys, 'credentials and the pending-erase marker').toEqual([]);
  expect(r.quickKeys, 'quick unlock').toEqual([]);
  const settings = r.settings as { quickUnlock?: { enabled?: boolean }; kitReminderDismissed?: boolean; lastBackupAtMs?: number; backupNagDismissedAtMs?: number } | undefined;
  expect(settings?.quickUnlock?.enabled ?? false).toBe(false);
  expect(settings?.kitReminderDismissed ?? false).toBe(false);
  expect(settings?.lastBackupAtMs ?? 0).toBe(0);
  expect(settings?.backupNagDismissedAtMs ?? 0).toBe(0);
  expect(r.prefs?.recents ?? { account: {}, categories: {} }).toEqual({ account: {}, categories: {} });
  expect((r.prefs?.firstRun as { dismissed?: boolean } | undefined)?.dismissed ?? false).toBe(false);
  expect(r.shownReminders).toBeNull();
}
