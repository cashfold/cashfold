import { parseAmountText } from '../../shared-kernel/amount-text';
import { uuidV5, type Id } from '../../shared-kernel/id';
import { dayOf, localDate, monthOf, yearOf, type LocalDate } from '../../shared-kernel/local-date';
import { ok, err, type DomainError } from '../../shared-kernel/result';
import { parseCurrency } from '../../shared-kernel/currency';
import type { CommandDef } from '../../sync/application/buses';
import { DELETED_FIELD, type FieldValue, type SetDelta } from '../../sync/domain/merge';
import type { ClockPort } from '../../sync/ports/index';
import { checkEntryAllowed } from '../domain/account';
import { IMPORT_FIELD, TABLE, TXN_FIELD } from '../domain/tables';
import { labelFieldPatch, labelKey } from '../domain/label';
import { addMembers } from '../domain/sets';
import { transactionFieldPatch, validateTransactionEntry, type TxnDirection } from '../domain/transaction';
import { compareText, secondsOf } from '../domain/util';
import { loadAccount, loadLedger, noSets } from './context';
import { snapshotBase } from './fx-snapshot';
import type { Ledger } from './projections/ledger';

// Importing transactions from CSV (FR-090): read the file, map its columns, look at a preview with every problem named, then
// bring in the good rows as one batch that can be taken back whole. Nothing is guessed silently: a row that cannot be read is
// reported with its line number, and a row that looks like one already there is flagged.

export type Delimiter = ',' | ';' | '\t';

/** RFC 4180 reading: quoted cells with doubled quotes, line breaks inside quotes, CRLF or LF, a leading byte-order mark. */
export function parseCsv(input: string, delimiter?: Delimiter): { rows: string[][]; delimiter: Delimiter } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const chosen = delimiter ?? guessDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
      started = true;
    } else if (ch === chosen) {
      row.push(cell);
      cell = '';
      started = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (started || cell !== '') {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = '';
      started = false;
    } else {
      cell += ch;
      started = true;
    }
  }
  if (started || cell !== '') {
    row.push(cell);
    rows.push(row);
  }
  return { rows, delimiter: chosen };
}

function guessDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => firstLine.split(d).length - 1;
  const best = ([',', ';', '\t'] as const).reduce((a, b) => (count(b) > count(a) ? b : a));
  return count(best) === 0 ? ',' : best;
}

export type DateOrder = 'ymd' | 'dmy' | 'mdy';

export interface ColumnMapping {
  /** Zero-based columns. `signed` is one column holding a signed amount; or give `income` and `expense` as two columns. */
  readonly date: number;
  readonly time?: number;
  readonly signed?: number;
  readonly income?: number;
  readonly expense?: number;
  readonly currency?: number;
  /** A column holding "income", "expense" or "transfer" (or the person's words for them, see `typeWords`). */
  readonly type?: number;
  readonly category?: number;
  readonly payee?: number;
  readonly note?: number;
  readonly tags?: number;
}

export interface ImportOptions {
  readonly account: Id;
  readonly mapping: ColumnMapping;
  readonly dateOrder: DateOrder;
  readonly decimal: '.' | ',';
  readonly hasHeader: boolean;
  /** The currency of rows that have no currency column. Defaults to the account's. */
  readonly currency?: string;
  /** Characters between tags in one cell. */
  readonly tagSeparator?: string;
}

export type RowProblem =
  | 'bad_date' | 'bad_time' | 'bad_amount' | 'amount_zero' | 'both_income_and_expense' | 'no_amount' | 'wrong_currency' | 'transfer_row' | 'bad_type' | 'too_long'
  | 'before_opening' | 'account_not_allowed' | 'missing_cell';

export interface PreviewRow {
  /** The line in the file, counting from 1. */
  readonly line: number;
  readonly problem: RowProblem | undefined;
  readonly localDate?: LocalDate;
  readonly direction?: TxnDirection;
  readonly amountMinor?: bigint;
  readonly category?: string;
  readonly payee?: string;
  readonly note?: string;
  readonly tags?: readonly string[];
  readonly occurredUtcMs?: number;
  /** Matches a transaction already in the account, or an earlier row of this file. */
  readonly duplicate: boolean;
  /** The category column named something that is not a category here; the row comes in without one. */
  readonly categoryUnknown: boolean;
}

export interface ImportPreview {
  readonly rows: readonly PreviewRow[];
  readonly ok: number;
  readonly problems: number;
  readonly duplicates: number;
}

const NOON_MS = 12 * 60 * 60 * 1000;

function parseDate(text: string, order: DateOrder): LocalDate | undefined {
  const m = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})\s*$/.exec(text);
  if (m === null) return undefined;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [y, mo, d] = order === 'ymd' ? [a, b, c] : order === 'dmy' ? [c, b, a] : [c, a, b];
  const year = y < 100 ? 2000 + y : y;
  const r = localDate(year, mo, d);
  return r.ok ? r.value : undefined;
}

function parseTime(text: string): number | undefined | 'bad' {
  if (text.trim() === '') return undefined;
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(text);
  if (m === null) return 'bad';
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  return h < 24 && mi < 60 && s < 60 ? ((h * 60 + mi) * 60 + s) * 1000 : 'bad';
}

const norm = (t: string): string => t.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

/** Turns the rows of a file into what would be imported, with every problem named. Pure: it reads the ledger and writes nothing. */
export function previewImport(ledger: Ledger, table: readonly (readonly string[])[], options: ImportOptions): ImportPreview {
  const account = ledger.accounts.get(options.account);
  const rows: PreviewRow[] = [];
  const m = options.mapping;
  const cell = (row: readonly string[], i: number | undefined): string | undefined => (i === undefined ? undefined : row[i]);
  const categoryByName = new Map<string, Id>();
  for (const c of ledger.categories.values()) {
    const parent = c.parentId === null ? undefined : ledger.categories.get(c.parentId);
    categoryByName.set(norm(parent === undefined ? c.name : `${parent.name} > ${c.name}`), c.id);
    if (!categoryByName.has(norm(c.name))) categoryByName.set(norm(c.name), c.id);
  }
  const seen = new Set<string>();
  const existing = new Set<string>();
  for (const t of ledger.transactions.values()) if (t.accountId === options.account) existing.add(`${t.localDate}|${t.amountMinor}|${norm(t.note)}`);
  const currencyText = options.currency ?? account?.currency;
  const sep = { decimal: options.decimal, group: options.decimal === '.' ? ',' : '.' } as const;
  const tagSeparator = options.tagSeparator ?? ';';

  table.forEach((raw, index) => {
    if (options.hasHeader && index === 0) return;
    const line = index + 1;
    const fail = (problem: RowProblem): void => void rows.push({ line, problem, duplicate: false, categoryUnknown: false });
    if (raw.every((c) => c.trim() === '')) return;
    if (account === undefined || currencyText === undefined) return fail('account_not_allowed');
    const dateText = cell(raw, m.date);
    if (dateText === undefined) return fail('missing_cell');
    const day = parseDate(dateText, options.dateOrder);
    if (day === undefined) return fail('bad_date');
    const time = parseTime(cell(raw, m.time) ?? '');
    if (time === 'bad') return fail('bad_time');

    const currency = parseCurrency((cell(raw, m.currency) ?? '').trim() === '' ? currencyText : (cell(raw, m.currency) ?? '').trim().toUpperCase());
    if (!currency.ok || currency.value !== account.currency) return fail('wrong_currency');

    let minor: bigint | undefined;
    const readAmount = (text: string | undefined): bigint | 'bad' | undefined => {
      if (text === undefined || text.trim() === '') return undefined;
      const r = parseAmountText(text.replace(/[\s ]/g, ''), currency.value, sep);
      return r.ok ? r.value.minor : 'bad';
    };
    if (m.signed !== undefined) {
      const v = readAmount(cell(raw, m.signed));
      if (v === 'bad') return fail('bad_amount');
      if (v === undefined) return fail('no_amount');
      minor = v;
    } else {
      const inc = readAmount(cell(raw, m.income));
      const exp = readAmount(cell(raw, m.expense));
      if (inc === 'bad' || exp === 'bad') return fail('bad_amount');
      if (inc !== undefined && inc !== 0n && exp !== undefined && exp !== 0n) return fail('both_income_and_expense');
      const v = inc !== undefined && inc !== 0n ? inc : exp !== undefined && exp !== 0n ? -(exp < 0n ? -exp : exp) : undefined;
      if (v === undefined) return fail(inc === undefined && exp === undefined ? 'no_amount' : 'amount_zero');
      minor = v;
    }
    if (minor === 0n) return fail('amount_zero');

    const typeText = norm(cell(raw, m.type) ?? '');
    if (typeText !== '') {
      if (typeText.startsWith('transfer')) return fail('transfer_row');
      if (typeText.startsWith('income') || typeText === 'in' || typeText === 'credit') minor = minor < 0n ? -minor : minor;
      else if (typeText.startsWith('expense') || typeText === 'out' || typeText === 'debit') minor = minor > 0n ? -minor : minor;
      else return fail('bad_type');
    }
    const direction: TxnDirection = minor < 0n ? 'expense' : 'income';

    const occurredUtcMs = Date.UTC(yearOf(day), monthOf(day) - 1, dayOf(day)) + (time ?? NOON_MS);
    const note = (cell(raw, m.note) ?? '').trim();
    if (Array.from(note).length > 2000) return fail('too_long');
    const allowed = checkEntryAllowed(account, direction, day);
    if (!allowed.ok) return fail(allowed.error.code === 'before_opening_date' ? 'before_opening' : 'account_not_allowed');

    const categoryName = (cell(raw, m.category) ?? '').trim();
    const categoryId = categoryName === '' ? undefined : categoryByName.get(norm(categoryName));
    const key = `${day}|${minor}|${norm(note)}`;
    const duplicate = existing.has(key) || seen.has(key);
    seen.add(key);
    rows.push({
      line, problem: undefined, localDate: day, direction, amountMinor: minor, occurredUtcMs, note,
      ...(categoryName !== '' && { category: categoryName }),
      ...((cell(raw, m.payee) ?? '').trim() !== '' && { payee: (cell(raw, m.payee) ?? '').trim() }),
      tags: (cell(raw, m.tags) ?? '').split(tagSeparator).map((t) => t.trim()).filter(Boolean).slice(0, 8),
      duplicate, categoryUnknown: categoryName !== '' && categoryId === undefined,
    });
  });
  return { rows, ok: rows.filter((r) => r.problem === undefined).length, problems: rows.filter((r) => r.problem !== undefined).length, duplicates: rows.filter((r) => r.duplicate).length };
}

// ---------------------------------------------------------------- commit and undo

export type ImportError = DomainError<'account_not_found' | 'nothing_to_import' | 'rate_required' | 'batch_not_found' | 'already_undone' | 'too_many_rows'>;

export const MAX_IMPORT_ROWS = 20_000;
const BATCH = 200;

export function createImportCommands({ clock }: { clock: ClockPort }) {
  /**
   * Imports the good rows of a file as one batch. Rows flagged as duplicates are left out unless asked for. Payees and tags named
   * in the file are created once (their ids come from their names); a category that is not found leaves the row uncategorised.
   */
  const importCsv: CommandDef<
    { fold: Id; batch: Id; source: string; table: readonly (readonly string[])[]; options: ImportOptions; includeDuplicates?: boolean },
    { batch: Id; imported: number; skippedDuplicates: number; problems: number },
    ImportError
  > = {
    name: 'importCsv',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      if (c.table.length > MAX_IMPORT_ROWS) return err('too_many_rows', `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
      const account = await loadAccount(ctx, c.fold, c.options.account);
      if (!account.ok) return err('account_not_found', 'That account does not exist');
      const ledger = await loadLedger(ctx, c.fold);
      const preview = previewImport(ledger, c.table, c.options);
      const wanted = preview.rows.filter((r) => r.problem === undefined && (c.includeDuplicates === true || !r.duplicate));
      if (wanted.length === 0) return err('nothing_to_import', 'No row can be imported');

      const base = ledger.baseCurrency;
      const categoryByName = new Map<string, Id>();
      for (const cat of ledger.categories.values()) {
        const parent = cat.parentId === null ? undefined : ledger.categories.get(cat.parentId);
        categoryByName.set(norm(parent === undefined ? cat.name : `${parent.name} > ${cat.name}`), cat.id);
        if (!categoryByName.has(norm(cat.name))) categoryByName.set(norm(cat.name), cat.id);
      }
      const labelIds = (kind: 'payee' | 'tag', name: string): Id => {
        const existing = [...(kind === 'payee' ? ledger.payees : ledger.tags).values()].find((l) => labelKey(l.name) === labelKey(name));
        return existing?.id ?? uuidV5(c.fold, `import.${kind}.${labelKey(name)}`);
      };
      const created = new Map<Id, { table: number; name: string }>();
      const drafts: Array<Parameters<typeof ctx.submit>[0][number]> = [];

      for (const r of wanted) {
        const snapshot = base === undefined
          ? ok({ baseAmountMinor: r.amountMinor!, baseCurrency: account.value.currency, fxRateId: null, fxBaseRateId: null })
          : snapshotBase({ amount: { minor: r.amountMinor!, currency: account.value.currency }, baseCurrency: base, rates: ledger.rates, asOfUtcS: secondsOf(r.occurredUtcMs!) });
        if (!snapshot.ok) return err('rate_required', 'An exchange rate is needed for this currency');
        const entry = validateTransactionEntry({ direction: r.direction!, amountMinor: r.amountMinor!, currency: account.value.currency, occurredUtcMs: r.occurredUtcMs!, tzOffsetMin: 0, note: r.note ?? '' }, account.value);
        if (!entry.ok) continue; // the preview already named why; a row that cannot be a transaction is not imported
        const payeeId = r.payee === undefined ? null : labelIds('payee', r.payee);
        if (payeeId !== null && !ledger.payees.has(payeeId)) created.set(payeeId, { table: TABLE.payee, name: r.payee! });
        const tagIds = (r.tags ?? []).map((t) => labelIds('tag', t));
        (r.tags ?? []).forEach((t, i) => {
          if (!ledger.tags.has(tagIds[i]!)) created.set(tagIds[i]!, { table: TABLE.tag, name: t });
        });
        const categoryId = r.category === undefined ? null : (categoryByName.get(norm(r.category)) ?? null);
        const fields = transactionFieldPatch({
          ...entry.value, accountId: c.options.account, ...snapshot.value, categoryId, payeeId, attachmentRef: null, isRefund: false, isPinned: false, origin: null, importId: c.batch,
        });
        const sets: ReadonlyMap<number, SetDelta> = tagIds.length === 0 ? noSets : new Map([[TXN_FIELD.tagIds, addMembers(tagIds)]]);
        drafts.push({ fold: c.fold, rec: uuidV5(c.batch, `row.${r.line}`), table: TABLE.transaction, fields, sets });
      }

      const head = [
        { fold: c.fold, rec: c.batch, table: TABLE.importBatch, sets: noSets, fields: new Map<number, FieldValue>([[IMPORT_FIELD.source, c.source.slice(0, 200)], [IMPORT_FIELD.importedUtcMs, BigInt(clock.nowMs())], [IMPORT_FIELD.undone, false], [IMPORT_FIELD.count, BigInt(drafts.length)]]) },
        ...[...created].map(([rec, l]) => ({ fold: c.fold, rec, table: l.table, sets: noSets, fields: labelFieldPatch({ name: l.name, color: 0 }) })),
      ];
      const first = await ctx.submit(head);
      if (!first.ok) return first as never;
      for (let i = 0; i < drafts.length; i += BATCH) {
        const written = await ctx.submit(drafts.slice(i, i + BATCH));
        if (!written.ok) return written as never;
      }
      return ok({ batch: c.batch, imported: drafts.length, skippedDuplicates: preview.rows.filter((r) => r.problem === undefined && r.duplicate && c.includeDuplicates !== true).length, problems: preview.problems });
    },
  };

  /** Takes a whole import back: removes the transactions it made and nothing else. Payees and tags it created stay, as they are the person's now. */
  const undoImport: CommandDef<{ fold: Id; batch: Id }, { removed: number }, ImportError> = {
    name: 'undoImport',
    requires: 'editor',
    foldOf: (c) => c.fold,
    async handle(c, ctx) {
      const state = await ctx.reader.getRecord(c.fold, c.batch);
      if (state === undefined || state.table !== TABLE.importBatch) return err('batch_not_found', 'That import does not exist');
      if (state.fields.get(IMPORT_FIELD.undone)?.value === true) return err('already_undone', 'That import was already taken back');
      const ledger = await loadLedger(ctx, c.fold);
      const mine = [...ledger.transactions.values()].filter((t) => t.importId === c.batch);
      const tombstone = new Map([[DELETED_FIELD, true]]);
      for (let i = 0; i < mine.length; i += BATCH) {
        const written = await ctx.submit(mine.slice(i, i + BATCH).map((t) => ({ fold: c.fold, rec: t.id, table: TABLE.transaction, fields: tombstone, sets: noSets })));
        if (!written.ok) return written as never;
      }
      const marked = await ctx.submit([{ fold: c.fold, rec: c.batch, table: TABLE.importBatch, fields: new Map([[IMPORT_FIELD.undone, true]]), sets: noSets }]);
      if (!marked.ok) return marked as never;
      return ok({ removed: mine.length });
    },
  };

  return { importCsv, undoImport };
}

/** The import batches of a Fold, newest first. */
export function importBatches(records: ReadonlyMap<Id, { table: number; fields: ReadonlyMap<number, { value: unknown }> }>): Array<{ id: Id; source: string; importedUtcMs: number; undone: boolean; count: number }> {
  const out = [];
  for (const [id, s] of records) {
    if (s.table !== TABLE.importBatch) continue;
    out.push({
      id, source: String(s.fields.get(IMPORT_FIELD.source)?.value ?? ''), importedUtcMs: Number(s.fields.get(IMPORT_FIELD.importedUtcMs)?.value ?? 0n),
      undone: s.fields.get(IMPORT_FIELD.undone)?.value === true, count: Number(s.fields.get(IMPORT_FIELD.count)?.value ?? 0n),
    });
  }
  return out.sort((a, b) => b.importedUtcMs - a.importedUtcMs || compareText(a.id, b.id));
}
