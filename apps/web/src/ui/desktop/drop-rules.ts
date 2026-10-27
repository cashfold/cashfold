// What may be dropped on the window of the desktop app, and what is made of it (contracts/link-and-file-intake.md, "Dropped files"). Checked for
// kind and size before a byte is read.

export const MAX_CSV_BYTES = 16 * 1024 * 1024;
export const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;

export type DropTargetKind = 'csv' | 'receipt';
export type DropVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: 'unsupported' | 'too-large' | 'empty' };

interface FileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

const isCsv = (file: FileLike): boolean => /\.csv$/i.test(file.name) || file.type === 'text/csv';

/** Whether `file` is acceptable for `target`. A receipt may be any kind the attachment field takes (it takes any); a CSV must look like one. */
export function judgeDrop(file: FileLike, target: DropTargetKind): DropVerdict {
  if (target === 'csv' && !isCsv(file)) return { ok: false, reason: 'unsupported' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > (target === 'csv' ? MAX_CSV_BYTES : MAX_RECEIPT_BYTES)) return { ok: false, reason: 'too-large' };
  return { ok: true };
}
