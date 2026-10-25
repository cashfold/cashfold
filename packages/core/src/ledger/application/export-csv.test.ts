import { describe, expect, it } from 'vitest';
import { LedgerFixture, date } from '../../testing/index';
import { buildLedger } from './projections/ledger';
import { csvCell, CSV_COLUMNS, exportLedgerCsv } from './export-csv';

describe('CSV export (FR-092)', () => {
  it('writes a header and one row per transaction and transfer, oldest first, with exact decimal amounts', () => {
    const f = new LedgerFixture();
    const main = f.account({ name: 'Main' });
    const savings = f.account({ name: 'Savings, big' });
    const food = f.category({ name: 'Food' });
    const veg = f.category({ name: 'Veg', parentId: food });
    f.transaction(main, { amountMinor: -12_345n, categoryId: veg, localDate: date(2026, 2, 3), note: 'Market' });
    f.transaction(main, { amountMinor: 100_000n, direction: 'income', localDate: date(2026, 1, 1), note: 'Pay' });
    f.transfer(main, savings, { from: 5_000n, localDate: date(2026, 1, 15), note: 'Save' });
    const lines = exportLedgerCsv(buildLedger(f.fold)).trimEnd().split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('2026-01-01,Main,income,1000.00,USD,,,,Pay,posted,,,');
    expect(lines[2]).toBe('2026-01-15,Main,transfer,-50.00,USD,,,,Save,posted,"Savings, big",50.00,USD');
    expect(lines[3]).toBe('2026-02-03,Main,expense,-123.45,USD,Food > Veg,,,Market,posted,,,');
  });

  it('keeps fixed English column names and dot decimals whatever language the names are in (spec 004)', () => {
    const f = new LedgerFixture();
    const main = f.account({ name: 'Рахунок' });
    const food = f.category({ name: 'Їжа та напої' });
    f.transaction(main, { amountMinor: -123_456n, categoryId: food, localDate: date(2026, 2, 3), note: 'Zakupy w Łodzi' });
    const lines = exportLedgerCsv(buildLedger(f.fold)).trimEnd().split('\r\n');
    expect(lines[0]).toBe('date,account,type,amount,currency,category,payee,tags,note,status,to_account,to_amount,to_currency');
    expect(lines[1]).toBe('2026-02-03,Рахунок,expense,-1234.56,USD,Їжа та напої,,,Zakupy w Łodzi,posted,,,');
  });

  it('quotes cells that need it and marks text a spreadsheet would run as a formula', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    for (const danger of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx']) expect(csvCell(danger).startsWith("'")).toBe(true);
    expect(csvCell('-12.50', true)).toBe('-12.50');
  });

  it('is empty but for the header when there is nothing', () => {
    expect(exportLedgerCsv(buildLedger(new LedgerFixture().fold))).toBe(`${CSV_COLUMNS.join(',')}\r\n`);
  });

  it('keeps a note that looks like a formula safe in a full row', () => {
    const f = new LedgerFixture();
    const a = f.account({ name: 'A' });
    f.transaction(a, { amountMinor: -100n, note: '=HYPERLINK("http://x")' });
    expect(exportLedgerCsv(buildLedger(f.fold))).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});
