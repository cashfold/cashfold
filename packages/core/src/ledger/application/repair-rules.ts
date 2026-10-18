import type { Id } from '../../shared-kernel/id';
import type { Finding, RepairRule } from '../../sync/application/repair';
import { isVisible, type FoldState } from '../../sync/domain/merge';
import { categoryTreeViolations, type CategoryNode } from '../domain/category';
import { resolveRates, type ExchangeRate } from '../domain/exchange-rate';
import {
  decodeAccount, decodeCategory, decodeExchangeRate, decodeGroup, decodeLabel, decodeTransaction, isTombstoned,
  type Transaction,
} from '../domain/records';
import { TABLE } from '../domain/tables';
import type { Account } from '../domain/account';

// Deterministic post-merge repair for the ledger (FR-078). Each rule reads merged state and reports; nothing here
// writes. Messages are i18n keys with no amounts, names or notes (FR-098).

function visibleOf<T>(state: FoldState, table: number, decode: (rec: Id, s: FoldState extends ReadonlyMap<Id, infer R> ? R : never) => T | undefined): Array<[Id, T]> {
  const out: Array<[Id, T]> = [];
  for (const [rec, s] of state) {
    if (s.table !== table || !isVisible(s)) continue;
    const v = decode(rec, s);
    if (v !== undefined) out.push([rec, v]);
  }
  return out;
}

const accountsOf = (state: FoldState): Map<Id, Account> => new Map(visibleOf(state, TABLE.account, decodeAccount));
const transactionsOf = (state: FoldState): Array<[Id, Transaction]> => visibleOf(state, TABLE.transaction, decodeTransaction);

/** The sign a transaction's direction demands, checked on merged values. */
export function signMatches(t: Pick<Transaction, 'direction' | 'amountMinor'>): boolean {
  return t.direction === 'expense' ? t.amountMinor < 0n : t.direction === 'income' ? t.amountMinor > 0n : t.amountMinor !== 0n;
}

const finding = (kind: string, ref: Id, effect: Finding['effect']): Finding => ({ kind, ref, messageKey: `attention.${kind}`, ...(effect !== undefined && { effect }) });

const orphanTransaction: RepairRule = {
  id: 'ledger.orphan_transaction',
  check(state) {
    const accounts = accountsOf(state);
    return transactionsOf(state).filter(([, t]) => !accounts.has(t.accountId)).map(([rec]) => finding('orphan_transaction', rec, 'hide'));
  },
};

const currencyMismatch: RepairRule = {
  id: 'ledger.currency_mismatch',
  check(state) {
    const accounts = accountsOf(state);
    return transactionsOf(state)
      .filter(([, t]) => accounts.get(t.accountId) !== undefined && accounts.get(t.accountId)!.currency !== t.currency)
      .map(([rec]) => finding('currency_mismatch', rec, 'exclude_from_balance'));
  },
};

const signMismatch: RepairRule = {
  id: 'ledger.sign_mismatch',
  check(state) {
    return transactionsOf(state).filter(([, t]) => !signMatches(t)).map(([rec]) => finding('sign_mismatch', rec, 'exclude_from_balance'));
  },
};

const categoryTree: RepairRule = {
  id: 'ledger.category_tree',
  check(state) {
    const nodes = new Map<Id, CategoryNode>(visibleOf(state, TABLE.category, decodeCategory));
    return [...categoryTreeViolations(nodes)].map(([rec, kind]) => finding(kind, rec, 'flag'));
  },
};

const duplicateRates: RepairRule = {
  id: 'ledger.duplicate_rate',
  check(state) {
    const rates: ExchangeRate[] = visibleOf(state, TABLE.exchangeRate, decodeExchangeRate).map(([, r]) => r);
    return resolveRates(rates).duplicates.map((r) => finding('duplicate_rate', r.id, 'flag'));
  },
};

/** A record of a ledger table whose required fields are missing or of the wrong type: ignored and reported. */
const malformed: RepairRule = {
  id: 'ledger.malformed_record',
  check(state) {
    const found: Finding[] = [];
    const decoders: Record<number, ((rec: Id, s: never) => unknown) | undefined> = {
      [TABLE.account]: decodeAccount, [TABLE.accountGroup]: decodeGroup, [TABLE.category]: decodeCategory,
      [TABLE.payee]: (rec, s) => decodeLabel(rec, s, TABLE.payee), [TABLE.tag]: (rec, s) => decodeLabel(rec, s, TABLE.tag),
      [TABLE.transaction]: decodeTransaction, [TABLE.exchangeRate]: decodeExchangeRate,
    };
    for (const [rec, s] of state) {
      const decode = decoders[s.table];
      if (decode === undefined || isTombstoned(s)) continue;
      if (decode(rec, s as never) === undefined) found.push(finding('malformed_record', rec, 'hide'));
    }
    return found;
  },
};

export const ledgerRepairRules: readonly RepairRule[] = [orphanTransaction, currencyMismatch, signMismatch, categoryTree, duplicateRates, malformed];
