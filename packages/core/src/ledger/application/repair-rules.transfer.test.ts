import { describe, expect, it } from 'vitest';
import type { FieldValue } from '../../sync/domain/merge';
import { createRepair } from '../../sync/application/repair';
import { LedgerFixture, id } from '../../testing/index';
import { TABLE, TRANSFER_FIELD } from '../domain/tables';
import { accountBalance } from './balance';
import { buildLedger } from './projections/ledger';
import { ledgerRepairRules } from './repair-rules';

const run = (f: LedgerFixture) => createRepair(ledgerRepairRules).run(f.fold);
const kinds = (f: LedgerFixture) => run(f).findings.map((x) => `${x.kind}:${x.ref ?? ''}`);

describe('transfer repair rules', () => {
  it('finds nothing wrong in a healthy transfer', () => {
    const f = new LedgerFixture();
    const [a, b] = [f.account(), f.account()];
    f.transfer(a, b);
    expect(run(f).findings).toEqual([]);
  });

  it('hides and flags a transfer whose destination account was deleted on another device', () => {
    const f = new LedgerFixture();
    const [a, b] = [f.account({ openingBalanceMinor: 1_000n }), f.account()];
    const t = f.transfer(a, b, { from: 100n });
    f.remove(b, TABLE.account);
    const report = run(f);
    expect(report.findings).toEqual([{ kind: 'orphan_transfer', ref: t, messageKey: 'attention.orphan_transfer', effect: 'hide' }]);
    const ledger = buildLedger(f.fold, report);
    expect(ledger.transfers.has(t)).toBe(false);
    // the source account is not left short by half a transfer
    expect(accountBalance(ledger, a)).toEqual({ ok: true, value: 1_000n });
  });

  it('does the same when the source account is gone or never arrived', () => {
    const f = new LedgerFixture();
    const b = f.account();
    const t = f.transfer(id(404), b);
    expect(kinds(f)).toEqual([`orphan_transfer:${t}`]);
  });

  it('recovers when the account comes back, and ignores a deleted transfer', () => {
    const f = new LedgerFixture();
    const [a, b] = [f.account(), f.account()];
    const t = f.transfer(a, b);
    f.remove(b, TABLE.account);
    expect(kinds(f)).toEqual([`orphan_transfer:${t}`]);
    f.restore(b, TABLE.account);
    expect(kinds(f)).toEqual([]);
    f.remove(b, TABLE.account);
    f.remove(t, TABLE.transfer);
    expect(kinds(f)).toEqual([]);
  });

  it('excludes a transfer that breaks its own rules from balances and flags it', () => {
    const f = new LedgerFixture();
    const [a, b] = [f.account({ openingBalanceMinor: 500n }), f.account()];
    const same = f.transfer(a, a, { from: 10n });
    const zero = f.transfer(a, b, { from: 10n });
    f.edit(zero, TABLE.transfer, new Map<number, FieldValue>([[TRANSFER_FIELD.toAmountMinor, 0n], [TRANSFER_FIELD.fromAmountMinor, 10n], [TRANSFER_FIELD.fromAccountId, a], [TRANSFER_FIELD.toAccountId, b], [TRANSFER_FIELD.fxRateId, null]]));
    const mismatch = f.transfer(a, b, { from: 10n, to: 11n });
    expect(kinds(f).sort()).toEqual([`invalid_transfer:${mismatch}`, `invalid_transfer:${same}`, `invalid_transfer:${zero}`].sort());
    const ledger = buildLedger(f.fold, run(f));
    expect(accountBalance(ledger, a)).toEqual({ ok: true, value: 500n });
    expect(accountBalance(ledger, b)).toEqual({ ok: true, value: 0n });
  });

  it('reports a transfer record that cannot be read', () => {
    const f = new LedgerFixture();
    f.apply(id(77), TABLE.transfer, new Map([[TRANSFER_FIELD.note, 'x']]));
    expect(kinds(f)).toEqual([`malformed_record:${id(77)}`]);
  });
});
