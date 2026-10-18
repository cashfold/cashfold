import { describe, expect, it } from 'vitest';
import { localDate } from '../../shared-kernel/local-date';
import { id } from '../../testing/index';
import { ACCOUNT_FIELD } from './tables';
import {
  accountFieldPatch, checkEntryAllowed, validateAccountUpdate, validateNewAccount, MAX_ACCOUNT_NAME,
  type NewAccountInput,
} from './account';

const date = (y: number, m: number, d: number) => {
  const r = localDate(y, m, d);
  if (!r.ok) throw new Error('bad test date');
  return r.value;
};

const base = (over: Partial<NewAccountInput> = {}): NewAccountInput => ({
  kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2026, 1, 1), ...over,
});

describe('Account: creation', () => {
  it('accepts every account kind', () => {
    for (const kind of ['checking', 'savings', 'credit_card', 'cash', 'goal', 'loan'] as const) {
      expect(validateNewAccount(base({ kind })).ok).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    const r = validateNewAccount(base({ kind: 'brokerage' as never }));
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_kind' } });
  });

  it('requires a name of 1 to 80 characters and trims it', () => {
    expect(validateNewAccount(base({ name: '   ' }))).toMatchObject({ ok: false, error: { code: 'invalid_account_name' } });
    expect(validateNewAccount(base({ name: '' }))).toMatchObject({ ok: false, error: { code: 'invalid_account_name' } });
    expect(validateNewAccount(base({ name: 'x'.repeat(MAX_ACCOUNT_NAME + 1) }))).toMatchObject({ ok: false, error: { code: 'invalid_account_name' } });
    expect(validateNewAccount(base({ name: 'line\nbreak' }))).toMatchObject({ ok: false, error: { code: 'invalid_account_name' } });
    const long = validateNewAccount(base({ name: 'é'.repeat(MAX_ACCOUNT_NAME) }));
    expect(long.ok).toBe(true);
    const trimmed = validateNewAccount(base({ name: '  Savings  ' }));
    expect(trimmed.ok && trimmed.value.name).toBe('Savings');
  });

  it('counts characters, not UTF-16 units, for the name limit', () => {
    expect(validateNewAccount(base({ name: '😀'.repeat(MAX_ACCOUNT_NAME) })).ok).toBe(true);
    expect(validateNewAccount(base({ name: '😀'.repeat(MAX_ACCOUNT_NAME + 1) })).ok).toBe(false);
  });

  it('rejects an unknown currency', () => {
    expect(validateNewAccount(base({ currency: 'XXZ' }))).toMatchObject({ ok: false, error: { code: 'unknown_currency' } });
  });

  it('keeps the opening balance exact and inside 64 bits', () => {
    const big = validateNewAccount(base({ openingBalanceMinor: 2n ** 62n }));
    expect(big.ok && big.value.openingBalanceMinor).toBe(2n ** 62n);
    expect(validateNewAccount(base({ openingBalanceMinor: 2n ** 63n }))).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
    expect(validateNewAccount(base({ openingBalanceMinor: -(2n ** 63n) - 1n }))).toMatchObject({ ok: false, error: { code: 'out_of_range' } });
  });

  it('allows a credit limit only on credit cards and loans, and never negative', () => {
    expect(validateNewAccount(base({ kind: 'credit_card', creditLimitMinor: 500_000n })).ok).toBe(true);
    expect(validateNewAccount(base({ kind: 'loan', creditLimitMinor: 1_000_000n })).ok).toBe(true);
    for (const kind of ['checking', 'savings', 'cash', 'goal'] as const) {
      expect(validateNewAccount(base({ kind, creditLimitMinor: 1n }))).toMatchObject({ ok: false, error: { code: 'credit_limit_not_allowed' } });
    }
    expect(validateNewAccount(base({ kind: 'credit_card', creditLimitMinor: -1n }))).toMatchObject({ ok: false, error: { code: 'invalid_credit_limit' } });
  });

  it('defaults to counting in net worth and to no credit limit', () => {
    const r = validateNewAccount(base());
    expect(r.ok && r.value).toMatchObject({ includeInNetWorth: true, creditLimitMinor: null, archived: false });
  });
});

describe('Account: update', () => {
  const account = (() => {
    const r = validateNewAccount(base({ kind: 'credit_card', creditLimitMinor: 100n }));
    if (!r.ok) throw new Error('fixture');
    return r.value;
  })();

  it('lets the currency change while the account has no entries', () => {
    const r = validateAccountUpdate(account, { currency: 'EUR' }, { hasEntries: false });
    expect(r.ok && r.value.currency).toBe('EUR');
  });

  it('locks the currency once any entry exists', () => {
    expect(validateAccountUpdate(account, { currency: 'EUR' }, { hasEntries: true })).toMatchObject({ ok: false, error: { code: 'currency_locked' } });
    // Restating the same currency is not a change.
    expect(validateAccountUpdate(account, { currency: 'USD' }, { hasEntries: true }).ok).toBe(true);
  });

  it('drops the credit limit rule violation when the kind changes to one without limits', () => {
    expect(validateAccountUpdate(account, { kind: 'checking' }, { hasEntries: false })).toMatchObject({ ok: false, error: { code: 'credit_limit_not_allowed' } });
    const ok = validateAccountUpdate(account, { kind: 'checking', creditLimitMinor: null }, { hasEntries: false });
    expect(ok.ok && ok.value.creditLimitMinor).toBeNull();
  });

  it('re-validates every changed field', () => {
    expect(validateAccountUpdate(account, { name: '' }, { hasEntries: false })).toMatchObject({ ok: false, error: { code: 'invalid_account_name' } });
  });
});

describe('Account: which entries it accepts', () => {
  const make = (over: Partial<NewAccountInput> & { archived?: boolean } = {}) => {
    const { archived, ...input } = over;
    const r = validateNewAccount(base(input));
    if (!r.ok) throw new Error('fixture');
    return { ...r.value, archived: archived ?? false };
  };
  const on = date(2026, 3, 1);

  it('accepts income, expense, adjustment and transfers on an ordinary account', () => {
    for (const entry of ['income', 'expense', 'adjustment', 'transfer_in', 'transfer_out'] as const) {
      expect(checkEntryAllowed(make(), entry, on).ok).toBe(true);
    }
  });

  it('refuses every new entry on an archived account', () => {
    for (const entry of ['income', 'expense', 'adjustment', 'transfer_in', 'transfer_out'] as const) {
      expect(checkEntryAllowed(make({ archived: true }), entry, on)).toMatchObject({ ok: false, error: { code: 'account_archived' } });
    }
  });

  it('lets a goal account take only transfers and adjustments', () => {
    const goal = make({ kind: 'goal' });
    expect(checkEntryAllowed(goal, 'transfer_in', on).ok).toBe(true);
    expect(checkEntryAllowed(goal, 'transfer_out', on).ok).toBe(true);
    expect(checkEntryAllowed(goal, 'adjustment', on).ok).toBe(true);
    expect(checkEntryAllowed(goal, 'income', on)).toMatchObject({ ok: false, error: { code: 'goal_entries_restricted' } });
    expect(checkEntryAllowed(goal, 'expense', on)).toMatchObject({ ok: false, error: { code: 'goal_entries_restricted' } });
  });

  it('rejects an entry dated before the opening date', () => {
    const account = make({ openingDate: date(2026, 3, 1) });
    expect(checkEntryAllowed(account, 'expense', date(2026, 2, 28))).toMatchObject({ ok: false, error: { code: 'before_opening_date' } });
    expect(checkEntryAllowed(account, 'expense', date(2026, 3, 1)).ok).toBe(true);
  });
});

describe('Account: record fields', () => {
  it('writes only the fields that are given', () => {
    const patch = accountFieldPatch({ name: 'Renamed' });
    expect([...patch.keys()]).toEqual([ACCOUNT_FIELD.name]);
  });

  it('encodes money as bigint and dates as integers', () => {
    const patch = accountFieldPatch({ openingBalanceMinor: 5n, openingDate: date(2026, 1, 2), archived: true });
    expect(patch.get(ACCOUNT_FIELD.openingBalanceMinor)).toBe(5n);
    expect(patch.get(ACCOUNT_FIELD.openingDate)).toBe(20_260_102n);
    expect(patch.get(ACCOUNT_FIELD.archived)).toBe(true);
  });

  it('is deterministic in its test ids', () => {
    expect(id(1)).not.toBe(id(2));
  });
});
