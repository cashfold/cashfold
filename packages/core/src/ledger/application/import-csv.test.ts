import { beforeEach, describe, expect, it } from 'vitest';
import { date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { createCategoryCommands } from './category-commands';
import { createImportCommands, importBatches, parseCsv, previewImport, type ColumnMapping, type ImportOptions } from './import-csv';

let h: LedgerHarness;
const imports = () => createImportCommands({ clock: { nowMs: () => h.clock.now } });
const mapping: ColumnMapping = { date: 0, signed: 1, category: 2, payee: 3, note: 4, tags: 5 };
const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({ account: id(1), mapping, dateOrder: 'ymd', decimal: '.', hasHeader: true, ...over });
const FILE = 'date,amount,category,payee,note,tags\n2026-02-01,-12.50,Food,Corner shop,Milk,weekly;home\n2026-02-02,2000.00,,Employer,Pay,\n2026-02-03,-3.20,Unknown thing,,Coffee,\n';

beforeEach(async () => {
  h = await ledgerHarness();
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
  await h.run(createCategoryCommands().createCategory, { fold: h.fold, id: id(60), direction: 'expense', parentId: null, name: 'Food' });
});

const ledger = () => h.ledger();

describe('CSV reading', () => {
  it('reads quotes, doubled quotes, line breaks inside quotes, CRLF, a byte-order mark and the delimiter used', () => {
    expect(parseCsv('﻿a,b\r\n"x,1","say ""hi"""\r\n"two\nlines",z\r\n').rows).toEqual([['a', 'b'], ['x,1', 'say "hi"'], ['two\nlines', 'z']]);
    expect(parseCsv('a;b;c\n1;2;3\n')).toEqual({ rows: [['a', 'b', 'c'], ['1', '2', '3']], delimiter: ';' });
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
    expect(parseCsv('a,b\n\n1,2\n').rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('a,,c\n').rows).toEqual([['a', '', 'c']]);
  });
});

describe('preview (FR-090)', () => {
  it('shows what would come in, exactly, with the category it found and the one it did not', async () => {
    const p = previewImport(await ledger(), parseCsv(FILE).rows, options());
    expect(p).toMatchObject({ ok: 3, problems: 0, duplicates: 0 });
    expect(p.rows[0]).toMatchObject({ line: 2, direction: 'expense', amountMinor: -1250n, localDate: date(2026, 2, 1), payee: 'Corner shop', tags: ['weekly', 'home'], categoryUnknown: false });
    expect(p.rows[1]).toMatchObject({ direction: 'income', amountMinor: 200_000n });
    expect(p.rows[2]).toMatchObject({ categoryUnknown: true });
  });

  it('reads two amount columns, other date orders, decimal commas and a type column', async () => {
    const rows = parseCsv('d;in;out;kind\n01.02.2026;;"1.234,56";expense\n03.02.2026;10,00;;income\n04.02.2026;5,00;;transfer\n05.02.2026;7,00;;wat\n', ';').rows;
    const p = previewImport(await ledger(), rows, options({ mapping: { date: 0, income: 1, expense: 2, type: 3 }, dateOrder: 'dmy', decimal: ',' }));
    expect(p.rows.map((r) => [r.line, r.problem ?? r.amountMinor])).toEqual([[2, -123_456n], [3, 1000n], [4, 'transfer_row'], [5, 'bad_type']]);
  });

  it('names every problem with its line and never guesses', async () => {
    const rows = parseCsv('date,amount\n2026-13-40,1.00\n2026-02-01,abc\n2026-02-01,1.234\n2026-02-01,0.00\n2025-12-31,1.00\n2026-02-01,\n,\n').rows;
    const p = previewImport(await ledger(), rows, options({ mapping: { date: 0, signed: 1 } }));
    expect(p.rows.map((r) => [r.line, r.problem])).toEqual([[2, 'bad_date'], [3, 'bad_amount'], [4, 'bad_amount'], [5, 'amount_zero'], [6, 'before_opening'], [7, 'no_amount']]);
    expect(p.problems).toBe(6);
  });

  it('refuses a row in another currency than the account', async () => {
    const rows = parseCsv('date,amount,cur\n2026-02-01,1.00,EUR\n2026-02-01,1.00,usd\n').rows;
    const p = previewImport(await ledger(), rows, options({ mapping: { date: 0, signed: 1, currency: 2 } }));
    expect(p.rows.map((r) => r.problem)).toEqual(['wrong_currency', undefined]);
  });

  it('flags a row that matches one already in the account, or an earlier row of the same file', async () => {
    await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'first.csv', table: parseCsv(FILE).rows, options: options() });
    const again = previewImport(await ledger(), parseCsv(FILE + '2026-02-01,-12.50,Food,x,Milk,\n').rows, options());
    expect(again.duplicates).toBe(4);
    const twice = previewImport(await ledger(), parseCsv('date,amount,note\n2026-03-01,-1.00,a\n2026-03-01,-1.00,A\n2026-03-01,-1.00,b\n').rows, options({ mapping: { date: 0, signed: 1, note: 2 } }));
    expect(twice.rows.map((r) => r.duplicate)).toEqual([false, true, false]);
  });

  it('previews 5,000 rows well inside five seconds (SC-014)', async () => {
    let text = 'date,amount,category,payee,note,tags\n';
    for (let i = 0; i < 5_000; i++) text += `2026-03-${String(1 + (i % 28)).padStart(2, '0')},-${(i % 90) + 1}.${String(i % 100).padStart(2, '0')},Food,Shop ${i % 50},Row ${i},t${i % 5}\n`;
    const started = performance.now();
    const p = previewImport(await ledger(), parseCsv(text).rows, options());
    expect(p.ok).toBe(5_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('import and undo as one batch', () => {
  it('imports the good rows, creating payees and tags once, matching the category, and recording the batch', async () => {
    const r = await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'bank.csv', table: parseCsv(FILE + '2026-02-04,bad,,,,\n').rows, options: options() });
    expect(r).toMatchObject({ ok: true, value: { imported: 3, skippedDuplicates: 0, problems: 1 } });
    const l = await ledger();
    const food = [...l.transactions.values()].find((t) => t.note === 'Milk')!;
    expect(food).toMatchObject({ amountMinor: -1250n, categoryId: id(60), importId: id(70), status: 'posted' });
    expect(food.tagIds).toHaveLength(2);
    expect([...l.payees.values()].map((p) => p.name).sort()).toEqual(['Corner shop', 'Employer']);
    expect([...l.tags.values()].map((t) => t.name).sort()).toEqual(['home', 'weekly']);
    expect([...l.transactions.values()].find((t) => t.note === 'Coffee')!.categoryId).toBeNull();
    expect(importBatches(await h.replica.projections.listRecords(h.fold))).toMatchObject([{ id: id(70), source: 'bank.csv', undone: false, count: 3 }]);
  });

  it('skips duplicates unless asked, and importing the same file twice is harmless', async () => {
    await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'a.csv', table: parseCsv(FILE).rows, options: options() });
    expect(await h.run(imports().importCsv, { fold: h.fold, batch: id(71), source: 'a.csv', table: parseCsv(FILE).rows, options: options() })).toMatchObject({ ok: false, error: { code: 'nothing_to_import' } });
    const forced = await h.run(imports().importCsv, { fold: h.fold, batch: id(71), source: 'a.csv', table: parseCsv(FILE).rows, options: options(), includeDuplicates: true });
    expect(forced).toMatchObject({ ok: true, value: { imported: 3 } });
    expect((await ledger()).transactions.size).toBe(6);
  });

  it('takes a whole batch back and nothing else, and only once', async () => {
    await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'a.csv', table: parseCsv(FILE).rows, options: options() });
    await h.run(imports().importCsv, { fold: h.fold, batch: id(71), source: 'b.csv', table: parseCsv('date,amount,category,payee,note,tags\n2026-03-01,-9.00,,,Other file,\n').rows, options: options() });
    await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(2), kind: 'cash', name: 'Cash', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1) });
    expect(await h.run(imports().undoImport, { fold: h.fold, batch: id(70) })).toMatchObject({ ok: true, value: { removed: 3 } });
    expect([...(await ledger()).transactions.values()].map((t) => t.note)).toEqual(['Other file']);
    expect(importBatches(await h.replica.projections.listRecords(h.fold)).find((b) => b.id === id(70))!.undone).toBe(true);
    expect(await h.run(imports().undoImport, { fold: h.fold, batch: id(70) })).toMatchObject({ ok: false, error: { code: 'already_undone' } });
    expect(await h.run(imports().undoImport, { fold: h.fold, batch: id(99) })).toMatchObject({ ok: false, error: { code: 'batch_not_found' } });
  });

  it('refuses an unknown account, an empty file and a viewer', async () => {
    expect(await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'a.csv', table: parseCsv(FILE).rows, options: options({ account: id(9) }) })).toMatchObject({ ok: false, error: { code: 'account_not_found' } });
    expect(await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'a.csv', table: parseCsv('date,amount\n').rows, options: options({ mapping: { date: 0, signed: 1 } }) })).toMatchObject({ ok: false, error: { code: 'nothing_to_import' } });
    h.setRole('viewer');
    expect((await h.run(imports().importCsv, { fold: h.fold, batch: id(70), source: 'a.csv', table: parseCsv(FILE).rows, options: options() })).ok).toBe(false);
  });
});
