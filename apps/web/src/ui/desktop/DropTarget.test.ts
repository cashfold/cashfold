import { describe, expect, it, vi } from 'vitest';
import { handleDrop, type DropContext } from './drop-handler';
import { judgeDrop, MAX_CSV_BYTES, MAX_RECEIPT_BYTES } from './drop-rules';

const file = (name: string, size = 1_000, type = ''): File => ({ name, size, type }) as unknown as File;

function context(over: Partial<DropContext> = {}) {
  const calls: string[] = [];
  const ctx: DropContext = {
    unlocked: true,
    receiptSheetOpen: false,
    offerCsv: vi.fn((f) => void calls.push(`offer ${f.name}`)),
    openImport: vi.fn(() => void calls.push('open')),
    attachReceipt: vi.fn((f) => void calls.push(`attach ${f.name}`)),
    message: vi.fn((key) => void calls.push(`say ${key}`)),
    ...over,
  };
  return { ctx, calls };
}

describe('which files may be dropped', () => {
  it('takes a CSV by extension or type, up to 16 MiB', () => {
    expect(judgeDrop(file('bank.csv'), 'csv')).toEqual({ ok: true });
    expect(judgeDrop(file('BANK.CSV'), 'csv')).toEqual({ ok: true });
    expect(judgeDrop(file('export', 1, 'text/csv'), 'csv')).toEqual({ ok: true });
    expect(judgeDrop(file('bank.csv', MAX_CSV_BYTES), 'csv')).toEqual({ ok: true });
  });

  it('refuses another kind, an empty file, and one over its limit', () => {
    expect(judgeDrop(file('photo.png'), 'csv')).toEqual({ ok: false, reason: 'unsupported' });
    expect(judgeDrop(file('bank.csv', 0), 'csv')).toEqual({ ok: false, reason: 'empty' });
    expect(judgeDrop(file('bank.csv', MAX_CSV_BYTES + 1), 'csv')).toEqual({ ok: false, reason: 'too-large' });
    expect(judgeDrop(file('receipt.pdf', MAX_RECEIPT_BYTES + 1), 'receipt')).toEqual({ ok: false, reason: 'too-large' });
  });

  it('takes any kind of receipt within 25 MB', () => {
    expect(judgeDrop(file('receipt.jpg'), 'receipt')).toEqual({ ok: true });
    expect(judgeDrop(file('receipt', MAX_RECEIPT_BYTES), 'receipt')).toEqual({ ok: true });
  });
});

describe('what a drop does', () => {
  it('hands a CSV to the import panel and opens it', () => {
    const { ctx, calls } = context();
    handleDrop([file('bank.csv')], ctx);
    expect(calls).toEqual(['offer bank.csv', 'open']);
  });

  it('attaches the file as the receipt when the add sheet is open', () => {
    const { ctx, calls } = context({ receiptSheetOpen: true });
    handleDrop([file('receipt.jpg')], ctx);
    expect(calls).toEqual(['attach receipt.jpg']);
  });

  it('says why, and changes nothing, for an unsupported kind, an empty file, an oversized file', () => {
    for (const [dropped, key] of [
      [file('photo.png'), 'desktop.drop.unsupported'],
      [file('bank.csv', 0), 'desktop.drop.empty'],
      [file('bank.csv', MAX_CSV_BYTES + 1), 'desktop.drop.tooLarge'],
    ] as const) {
      const { ctx, calls } = context();
      handleDrop([dropped], ctx);
      expect(calls).toEqual([`say ${key}`]);
    }
  });

  it('says the limit that applies', () => {
    const { ctx } = context();
    handleDrop([file('bank.csv', MAX_CSV_BYTES + 1)], ctx);
    expect(ctx.message).toHaveBeenCalledWith('desktop.drop.tooLarge', { mb: '16' });
    const sheet = context({ receiptSheetOpen: true });
    handleDrop([file('receipt.pdf', MAX_RECEIPT_BYTES + 1)], sheet.ctx);
    expect(sheet.ctx.message).toHaveBeenCalledWith('desktop.drop.tooLarge', { mb: '25' });
  });

  it('ignores a drop while locked, with a message, and reads nothing', () => {
    const { ctx, calls } = context({ unlocked: false });
    handleDrop([file('bank.csv')], ctx);
    expect(calls).toEqual(['say desktop.drop.locked']);
  });

  it('takes one file at a time', () => {
    const { ctx, calls } = context();
    handleDrop([file('a.csv'), file('b.csv')], ctx);
    expect(calls).toEqual(['say desktop.drop.single']);
  });

  it('does nothing for a drop with no files (text dragged in)', () => {
    const { ctx, calls } = context();
    handleDrop([], ctx);
    expect(calls).toEqual([]);
  });
});
