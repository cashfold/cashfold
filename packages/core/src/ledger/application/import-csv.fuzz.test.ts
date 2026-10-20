import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { date, id, ledgerHarness } from '../../testing/index';
import { createAccountCommands } from './account-commands';
import { csvCell } from './export-csv';
import { parseCsv, previewImport, type ColumnMapping, type ImportOptions, type RowProblem } from './import-csv';
import type { Ledger } from './projections/ledger';

// Fuzzing the CSV importer (T191). A file is the one thing here that a person takes from somewhere else: it may be any bytes, any size,
// any encoding mistake. Reading it must always finish, never throw, and give back exactly what a writer put in.

let ledger: Ledger;
beforeAll(async () => {
  const h = await ledgerHarness();
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
  ledger = await h.ledger();
});

const PROBLEMS: ReadonlySet<RowProblem> = new Set(['bad_date', 'bad_time', 'bad_amount', 'amount_zero', 'both_income_and_expense', 'no_amount', 'wrong_currency', 'transfer_row', 'bad_type', 'too_long', 'before_opening', 'account_not_allowed', 'missing_cell']);
const mapping: ColumnMapping = { date: 0, signed: 1, category: 2, payee: 3, note: 4, tags: 5, currency: 6, type: 7 };
const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({ account: id(1), mapping, dateOrder: 'ymd', decimal: '.', hasHeader: false, ...over });

const nasty = fc.oneof(
  fc.string({ maxLength: 40 }), fc.string({ unit: 'binary', maxLength: 30 }),
  fc.constantFrom('', '"', '""', ',', ';', '\t', '\r', '\n', '\r\n', '﻿', '=1+1', '+SUM(A1)', '-1', '@x', "'", '\u0000', '‮', '9'.repeat(40), '1e999', '-0', '0.0000001', '2026-02-30', '31/12/2026', '2026-1-1'),
);

describe('CSV reading', () => {
  it('finishes on any text and returns rectangular-enough rows of strings', () => {
    fc.assert(fc.property(fc.array(nasty, { maxLength: 60 }).map((parts) => parts.join('')), (text) => {
      const { rows, delimiter } = parseCsv(text);
      expect([',', ';', '\t']).toContain(delimiter);
      for (const row of rows) for (const cell of row) expect(typeof cell).toBe('string');
      expect(parseCsv(text)).toEqual({ rows, delimiter }); // deterministic
    }), { numRuns: 1500 });
  });

  it('gives back exactly the cells a writer put in, whatever they hold', () => {
    const cell = fc.oneof(nasty, fc.string({ maxLength: 12 }));
    const table = fc.array(fc.array(cell, { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 12 });
    fc.assert(fc.property(table, fc.constantFrom(',', ';', '\t') as fc.Arbitrary<',' | ';' | '\t'>, fc.constantFrom('\n', '\r\n'), (rows, delimiter, eol) => {
      const quote = (c: string) => `"${c.replaceAll('"', '""')}"`;
      const text = rows.map((r) => r.map(quote).join(delimiter)).join(eol);
      const expected = rows.filter((r) => !(r.length === 1 && r[0] === '')); // a line with nothing on it is not a row
      expect(parseCsv(text, delimiter).rows).toEqual(expected);
    }), { numRuns: 800 });
  });

  it('what the exporter writes for a cell is read back as that cell, and a formula is only ever marked, never changed', () => {
    fc.assert(fc.property(nasty, (text) => {
      const written = csvCell(text);
      // (not the first cell of the file: a byte-order mark at the very start of a file is dropped on purpose)
      const [[, read]] = parseCsv(`x,${written}\n`, ',').rows as [[string, string]];
      expect(read === text || read === `'${text}`).toBe(true);
      if (read !== text) expect(/^[=+\-@\t\r]/.test(text)).toBe(true);
    }), { numRuns: 1500 });
  });

  it('reads a large file in a bounded time', () => {
    const line = '2026-03-01,-12.50,Food,"Shop, the ""big"" one",note,tag1;tag2,USD,expense\r\n';
    const started = performance.now();
    const { rows } = parseCsv(line.repeat(60_000));
    expect(rows).toHaveLength(60_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('CSV preview', () => {
  const row = fc.array(nasty, { minLength: 0, maxLength: 9 });

  it('turns any rows into a row-by-row answer with a known reason for each refusal, and never throws', () => {
    fc.assert(fc.property(fc.array(row, { maxLength: 20 }), fc.constantFrom('ymd', 'dmy', 'mdy') as fc.Arbitrary<'ymd' | 'dmy' | 'mdy'>, fc.constantFrom('.', ',') as fc.Arbitrary<'.' | ','>, fc.boolean(), (rows, dateOrder, decimal, hasHeader) => {
      const preview = previewImport(ledger, rows, options({ dateOrder, decimal, hasHeader }));
      expect(preview.rows.length).toBeLessThanOrEqual(rows.length);
      for (const r of preview.rows) {
        if (r.problem !== undefined) expect(PROBLEMS.has(r.problem), String(r.problem)).toBe(true);
        else {
          expect(typeof r.amountMinor).toBe('bigint');
          expect(r.amountMinor).not.toBe(0n);
          expect(r.localDate).toBeGreaterThan(0);
        }
      }
      expect(preview.ok + preview.problems).toBeGreaterThanOrEqual(0);
    }), { numRuns: 800 });
  });

  it('never turns a cell that is not an amount into one', () => {
    fc.assert(fc.property(fc.string({ maxLength: 30 }).filter((s) => !/^\s*[-+]?[\d.,\s]*\d[\d.,\s]*$/.test(s)), (text) => {
      const [r] = previewImport(ledger, [['2026-03-01', text, '', '', '', '', '', '']], options()).rows;
      expect(r?.problem === undefined && r?.amountMinor !== undefined && !/\d/.test(text)).toBe(false);
    }), { numRuns: 500 });
  });

  it('previews 5,000 hostile rows in a bounded time', () => {
    const rows = Array.from({ length: 5_000 }, (_, i) => [`2026-03-${String(1 + (i % 28)).padStart(2, '0')}`, i % 7 === 0 ? 'x' : `-${i % 90}.${String(i % 100).padStart(2, '0')}`, '', `p${i % 50}`, `n${i}`, '', '', '']);
    const started = performance.now();
    expect(previewImport(ledger, rows, options()).rows).toHaveLength(5_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
