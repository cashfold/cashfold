import { judgeDrop, MAX_CSV_BYTES, MAX_RECEIPT_BYTES } from './drop-rules';

// What happens to a file dropped on the window of the desktop app. Pure: the effects are handed in, so each rule is tested without a page.

export interface DropContext {
  readonly unlocked: boolean;
  /** The add sheet is open with its attachment field: a dropped file is the receipt. */
  readonly receiptSheetOpen: boolean;
  offerCsv(file: File): void;
  openImport(): void;
  attachReceipt(file: File): void;
  /** Tells the person why nothing happened. */
  message(key: string, params?: Record<string, string>): void;
}

const mb = (bytes: number): string => String(bytes / (1024 * 1024));

/** Handles the files of one drop. Several files are refused: one at a time, each reviewed. */
export function handleDrop(files: readonly File[], ctx: DropContext): void {
  if (!ctx.unlocked) return ctx.message('desktop.drop.locked');
  if (files.length === 0) return;
  if (files.length > 1) return ctx.message('desktop.drop.single');
  const file = files[0]!;
  const target = ctx.receiptSheetOpen ? 'receipt' : 'csv';
  const verdict = judgeDrop(file, target);
  if (!verdict.ok) {
    return verdict.reason === 'too-large'
      ? ctx.message('desktop.drop.tooLarge', { mb: mb(target === 'csv' ? MAX_CSV_BYTES : MAX_RECEIPT_BYTES) })
      : ctx.message(verdict.reason === 'empty' ? 'desktop.drop.empty' : 'desktop.drop.unsupported');
  }
  if (target === 'receipt') return ctx.attachReceipt(file);
  ctx.offerCsv(file);
  ctx.openImport();
}
