import type { Id } from '../shared-kernel/id';
import type { LocalDate } from '../shared-kernel/local-date';
import { localDate } from '../shared-kernel/local-date';
import { accountFieldPatch, type NewAccount } from '../ledger/domain/account';
import { categoryFieldPatch, type NewCategory } from '../ledger/domain/category';
import { exchangeRateFieldPatch, type NewExchangeRate } from '../ledger/domain/exchange-rate';
import { TABLE, TXN_FIELD } from '../ledger/domain/tables';
import { transactionFieldPatch, type TransactionFields } from '../ledger/domain/transaction';
import { DELETED_FIELD, applyOp, emptyFold, type FieldValue, type FoldState, type Op, type SetDelta } from '../sync/domain/merge';
import { id } from './world';

// Builds merged fold state directly from ops, without sealing or storage: for fast domain and property tests.

export const date = (y: number, m: number, d: number): LocalDate => {
  const r = localDate(y, m, d);
  if (!r.ok) throw new Error('bad test date');
  return r.value;
};

const noSets: ReadonlyMap<number, SetDelta> = new Map();

export class LedgerFixture {
  fold: FoldState = emptyFold();
  readonly ops: Op[] = [];
  private clock = 1;
  private next = 1000;

  nextId(): Id {
    return id(++this.next);
  }

  /** Applies a hand-built op. Every op gets a fresh, increasing clock unless one is given. */
  apply(rec: Id, table: number, fields: ReadonlyMap<number, FieldValue>, sets: ReadonlyMap<number, SetDelta> = noSets, wallMs?: number): Op {
    const op: Op = {
      id: this.nextId(), rec, dev: id(0xa), hlc: { wallMs: wallMs ?? ++this.clock, ctr: 0 }, table, fields, sets,
    };
    this.ops.push(op);
    this.fold = applyOp(this.fold, op);
    return op;
  }

  account(over: Partial<NewAccount> = {}, rec: Id = this.nextId()): Id {
    const full: NewAccount = {
      kind: 'checking', name: 'Main', currency: 'USD' as NewAccount['currency'], openingBalanceMinor: 0n, openingDate: date(2020, 1, 1),
      includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false, ...over,
    };
    this.apply(rec, TABLE.account, accountFieldPatch(full));
    return rec;
  }

  category(over: Partial<NewCategory> = {}, rec: Id = this.nextId()): Id {
    this.apply(rec, TABLE.category, categoryFieldPatch({ direction: 'expense', parentId: null, name: 'Food', ...over }));
    return rec;
  }

  /** A transaction whose base amount equals its amount unless `fields` says otherwise. */
  transaction(account: Id, fields: TransactionFields & { tagIds?: readonly Id[] }, rec: Id = this.nextId()): Id {
    const { tagIds, ...rest } = fields;
    const amountMinor = rest.amountMinor ?? -100n;
    const direction = rest.direction ?? (amountMinor < 0n ? 'expense' : 'income');
    const patch = transactionFieldPatch({
      currency: 'USD' as never, baseAmountMinor: amountMinor, baseCurrency: 'USD', fxRateId: null, fxBaseRateId: null, localDate: date(2026, 1, 15),
      occurredUtcMs: Date.UTC(2026, 0, 15, 12), tzOffsetMin: 0, status: 'posted', note: '', ...rest, accountId: account, amountMinor, direction,
    });
    const sets = tagIds === undefined ? noSets : new Map([[TXN_FIELD.tagIds, { add: tagIds, rem: [] } satisfies SetDelta]]);
    this.apply(rec, TABLE.transaction, patch, sets);
    return rec;
  }

  exchangeRate(rate: NewExchangeRate, rec: Id = this.nextId()): Id {
    this.apply(rec, TABLE.exchangeRate, exchangeRateFieldPatch(rate));
    return rec;
  }

  edit(rec: Id, table: number, fields: ReadonlyMap<number, FieldValue>): void {
    this.apply(rec, table, fields);
  }

  remove(rec: Id, table: number, wallMs?: number): void {
    this.apply(rec, table, new Map([[DELETED_FIELD, true]]), noSets, wallMs);
  }

  restore(rec: Id, table: number): void {
    this.apply(rec, table, new Map([[DELETED_FIELD, false]]));
  }
}
