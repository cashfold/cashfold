import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { DELETED_FIELD, type FieldValue, type RecordState } from '../../sync/domain/merge';
import { id } from '../../testing/index';
import {
  decodeAccount, decodeCategory, decodeExchangeRate, decodeGroup, decodeLabel, decodeTransaction, deletedAtMs, isTombstoned, lastChanged,
} from './records';
import { ACCOUNT_FIELD, CATEGORY_FIELD, GROUP_FIELD, LABEL_FIELD, RATE_FIELD, TABLE, TXN_FIELD } from './tables';

const DEV = id(0xa);
const rec = (table: number, fields: Record<number, FieldValue>, over: { wall?: number; ctr?: number; sets?: RecordState['sets'] } = {}): RecordState => ({
  table, tableConflict: false, sets: over.sets ?? new Map(),
  fields: new Map(Object.entries(fields).map(([f, value]) => [Number(f), { hlc: { wallMs: over.wall ?? 1, ctr: over.ctr ?? 0 }, dev: DEV, opId: id(9), value }])),
});

const account = (over: Record<number, FieldValue> = {}) => rec(TABLE.account, {
  [ACCOUNT_FIELD.kind]: 1n, [ACCOUNT_FIELD.name]: 'Main', [ACCOUNT_FIELD.currency]: 'USD', [ACCOUNT_FIELD.openingBalanceMinor]: 5n,
  [ACCOUNT_FIELD.openingDate]: 20_260_101n, ...over,
});
const txn = (over: Record<number, FieldValue> = {}) => rec(TABLE.transaction, {
  [TXN_FIELD.accountId]: id(1), [TXN_FIELD.direction]: 1n, [TXN_FIELD.amountMinor]: -5n, [TXN_FIELD.currency]: 'USD',
  [TXN_FIELD.localDate]: 20_260_301n, ...over,
});

describe('decodeAccount', () => {
  it('reads a complete record with defaults for the optional fields', () => {
    expect(decodeAccount(id(1), account())).toMatchObject({
      id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 5n, openingDate: 20_260_101, includeInNetWorth: true,
      creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false, groupIds: [],
    });
  });

  it('returns nothing for a record of another table or with a bad required field', () => {
    expect(decodeAccount(id(1), rec(TABLE.tag, {}))).toBeUndefined();
    for (const bad of [
      { [ACCOUNT_FIELD.kind]: 99n }, { [ACCOUNT_FIELD.name]: 5n }, { [ACCOUNT_FIELD.currency]: 'ZZZ' }, { [ACCOUNT_FIELD.currency]: 5n },
      { [ACCOUNT_FIELD.openingBalanceMinor]: 'x' }, { [ACCOUNT_FIELD.openingDate]: 0n }, { [ACCOUNT_FIELD.creditLimitMinor]: 'x' },
    ]) expect(decodeAccount(id(1), account(bad))).toBeUndefined();
  });

  it('falls back for optional fields of the wrong type or size', () => {
    const a = decodeAccount(id(1), account({
      [ACCOUNT_FIELD.includeInNetWorth]: 'yes', [ACCOUNT_FIELD.color]: 2n ** 60n, [ACCOUNT_FIELD.sortOrder]: 'x', [ACCOUNT_FIELD.archived]: 1n,
      [ACCOUNT_FIELD.icon]: 5n,
    }));
    expect(a).toMatchObject({ includeInNetWorth: true, color: 0, sortOrder: 0, archived: false });
  });

  it('reads a credit limit and an icon when present', () => {
    expect(decodeAccount(id(1), account({ [ACCOUNT_FIELD.kind]: 3n, [ACCOUNT_FIELD.creditLimitMinor]: 900n, [ACCOUNT_FIELD.icon]: 'card' }))).toMatchObject({ kind: 'credit_card', creditLimitMinor: 900n, icon: 'card' });
  });
});

describe('decodeGroup, decodeCategory, decodeLabel', () => {
  it('decodes a group and rejects one without a name', () => {
    expect(decodeGroup(id(1), rec(TABLE.accountGroup, { [GROUP_FIELD.name]: 'Banks', [GROUP_FIELD.color]: 3n }))).toMatchObject({ name: 'Banks', color: 3, icon: null });
    expect(decodeGroup(id(1), rec(TABLE.accountGroup, {}))).toBeUndefined();
    expect(decodeGroup(id(1), rec(TABLE.tag, { [GROUP_FIELD.name]: 'x' }))).toBeUndefined();
  });

  it('decodes a category with its parent, and rejects bad shapes', () => {
    const ok = decodeCategory(id(1), rec(TABLE.category, { [CATEGORY_FIELD.direction]: 2n, [CATEGORY_FIELD.name]: 'Pay', [CATEGORY_FIELD.parentId]: id(2) }));
    expect(ok).toMatchObject({ direction: 'income', parentId: id(2), archived: false });
    expect(decodeCategory(id(1), rec(TABLE.category, { [CATEGORY_FIELD.direction]: 3n, [CATEGORY_FIELD.name]: 'x' }))).toBeUndefined();
    expect(decodeCategory(id(1), rec(TABLE.category, { [CATEGORY_FIELD.direction]: 1n }))).toBeUndefined();
    expect(decodeCategory(id(1), rec(TABLE.category, { [CATEGORY_FIELD.direction]: 1n, [CATEGORY_FIELD.name]: 'x', [CATEGORY_FIELD.parentId]: 5n }))).toBeUndefined();
    expect(decodeCategory(id(1), rec(TABLE.tag, {}))).toBeUndefined();
  });

  it('decodes payees and tags only from their own table', () => {
    const state = rec(TABLE.payee, { [LABEL_FIELD.name]: 'Cafe' });
    expect(decodeLabel(id(1), state, TABLE.payee)).toEqual({ id: id(1), name: 'Cafe', color: 0 });
    expect(decodeLabel(id(1), state, TABLE.tag)).toBeUndefined();
    expect(decodeLabel(id(1), rec(TABLE.payee, {}), TABLE.payee)).toBeUndefined();
  });
});

describe('decodeTransaction', () => {
  it('reads a minimal record and defaults the rest', () => {
    expect(decodeTransaction(id(2), txn())).toMatchObject({
      id: id(2), direction: 'expense', amountMinor: -5n, baseAmountMinor: -5n, baseCurrency: 'USD', status: 'posted', note: '', place: null,
      categoryId: null, payeeId: null, tagIds: [], isRefund: false, isPinned: false, origin: null, importId: null, attachmentRef: null,
    });
  });

  it('reads place, origin, refund and import fields', () => {
    const t = decodeTransaction(id(2), txn({
      [TXN_FIELD.placeName]: 'Cafe', [TXN_FIELD.latE7]: 5n, [TXN_FIELD.lonE7]: -6n, [TXN_FIELD.originScheduleId]: id(5), [TXN_FIELD.originN]: 3n,
      [TXN_FIELD.isRefund]: true, [TXN_FIELD.importId]: id(6), [TXN_FIELD.status]: 0n, [TXN_FIELD.baseAmountMinor]: -7n, [TXN_FIELD.baseCurrency]: 'EUR',
    }));
    expect(t).toMatchObject({ place: { name: 'Cafe', latE7: 5, lonE7: -6 }, origin: { scheduleId: id(5), n: 3 }, isRefund: true, importId: id(6), status: 'pending', baseAmountMinor: -7n, baseCurrency: 'EUR' });
  });

  it('drops a half-written place or origin instead of inventing one', () => {
    expect(decodeTransaction(id(2), txn({ [TXN_FIELD.placeName]: 'Cafe' }))?.place).toBeNull();
    expect(decodeTransaction(id(2), txn({ [TXN_FIELD.originScheduleId]: id(5) }))?.origin).toBeNull();
  });

  it('returns nothing when a required field is missing or malformed', () => {
    expect(decodeTransaction(id(2), rec(TABLE.tag, {}))).toBeUndefined();
    const bad: Array<Record<number, FieldValue>> = [
      { [TXN_FIELD.accountId]: null }, { [TXN_FIELD.accountId]: 5n }, { [TXN_FIELD.direction]: 7n }, { [TXN_FIELD.amountMinor]: 'x' },
      { [TXN_FIELD.currency]: 'ZZZ' }, { [TXN_FIELD.baseCurrency]: 'ZZZ' }, { [TXN_FIELD.baseCurrency]: 5n }, { [TXN_FIELD.baseAmountMinor]: 'x' }, { [TXN_FIELD.status]: 9n }, { [TXN_FIELD.localDate]: 0n },
    ];
    for (const b of bad) expect(decodeTransaction(id(2), txn(b)), JSON.stringify(Object.keys(b))).toBeUndefined();
  });
});

describe('decodeExchangeRate', () => {
  const good = { [RATE_FIELD.quote]: 'EUR', [RATE_FIELD.asOfUtcS]: 100n, [RATE_FIELD.rateE12]: 5n, [RATE_FIELD.source]: 'custom' } as const;
  it('decodes a rate and rejects malformed ones', () => {
    expect(decodeExchangeRate(id(1), rec(TABLE.exchangeRate, good))).toEqual({ id: id(1), quote: 'EUR', asOfUtcS: 100, rateE12: 5n, source: 'custom' });
    for (const bad of [{ [RATE_FIELD.quote]: 5n }, { [RATE_FIELD.quote]: 'ZZZ' }, { [RATE_FIELD.asOfUtcS]: 'x' }, { [RATE_FIELD.rateE12]: 0n }, { [RATE_FIELD.rateE12]: 'x' }, { [RATE_FIELD.source]: 'guess' }]) {
      expect(decodeExchangeRate(id(1), rec(TABLE.exchangeRate, { ...good, ...bad }))).toBeUndefined();
    }
    expect(decodeExchangeRate(id(1), rec(TABLE.tag, good))).toBeUndefined();
  });
});

describe('tombstone and last change', () => {
  it('knows when a record was deleted and by which write', () => {
    expect(isTombstoned(rec(1, { [DELETED_FIELD]: true }))).toBe(true);
    expect(isTombstoned(rec(1, { [DELETED_FIELD]: false }))).toBe(false);
    expect(deletedAtMs(rec(1, { [DELETED_FIELD]: true }, { wall: 77 }))).toBe(77);
    expect(deletedAtMs(rec(1, { [DELETED_FIELD]: false }, { wall: 77 }))).toBeUndefined();
    expect(deletedAtMs(rec(1, { 1: 'x' }))).toBeUndefined();
  });

  it('reports the newest write, using the counter to break a tie in time', () => {
    expect(lastChanged(rec(1, {}))).toBeUndefined();
    const a: RecordState = { table: 1, tableConflict: false, sets: new Map(), fields: new Map([
      [1, { hlc: { wallMs: 10, ctr: 1 }, dev: id(1), opId: id(9), value: 'a' }],
      [2, { hlc: { wallMs: 10, ctr: 2 }, dev: id(2), opId: id(9), value: 'b' }],
      [3, { hlc: { wallMs: 9, ctr: 9 }, dev: id(3), opId: id(9), value: 'c' }],
    ]) };
    expect(lastChanged(a)).toEqual({ dev: id(2), atMs: 10 });
  });
});

describe('references typed as Id', () => {
  it('keeps ids as given', () => {
    const x: Id = id(5);
    expect(decodeTransaction(id(2), txn({ [TXN_FIELD.categoryId]: x }))?.categoryId).toBe(x);
  });
});

describe('a category record from before spec 019', () => {
  it('may carry the reserved icon field (4): it decodes, and the model has no icon', () => {
    const category = decodeCategory(id(1), rec(TABLE.category, {
      [CATEGORY_FIELD.direction]: 1n, [CATEGORY_FIELD.name]: 'Food', [CATEGORY_FIELD.icon]: 'utensils', [CATEGORY_FIELD.color]: 3n, [CATEGORY_FIELD.parentId]: null,
    }));
    expect(category).toMatchObject({ name: 'Food', color: 3, direction: 'expense', parentId: null });
    expect(category).not.toHaveProperty('icon');
  });
});
