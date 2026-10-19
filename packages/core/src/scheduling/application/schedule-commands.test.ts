import { beforeEach, describe, expect, it } from 'vitest';
import { createRepair } from '../../sync/application/repair';
import { LedgerFixture, date, id, ledgerHarness, type LedgerHarness } from '../../testing/index';
import { createAccountCommands } from '../../ledger/application/account-commands';
import { TABLE } from '../../ledger/domain/tables';
import { occurrenceId } from '../domain/occurrence';
import { createMaterialiser } from './materialise';
import { buildSchedules } from './projected-balance';
import { schedulingRepairRules } from './repair-rules';
import { createScheduleCommands } from './schedule-commands';

let h: LedgerHarness;
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 9);
const clock = { nowMs: () => h.clock.now };
const schedules = () => createScheduleCommands({ clock });
const materialiser = () => createMaterialiser({ clock });
const SCH = id(0x50);

const rent = (over: Record<string, unknown> = {}) => ({
  fold: h.fold, id: SCH, name: 'Rent', beginLocalDate: date(2026, 1, 31), unit: 'month' as const, interval: 1,
  template: { kind: 'transaction' as const, direction: 'expense' as const, accountId: id(1), amountMinor: -50_000n, categoryId: null, payeeId: null, tagIds: [], note: 'Rent' },
  ...over,
});
const days = async () => [...(await h.ledger()).transactions.values()].sort((a, b) => a.localDate - b.localDate);
const advance = (y: number, m: number, d: number) => h.setNow(at(y, m, d));
const run = () => h.run(materialiser().materialiseDue, { fold: h.fold });

beforeEach(async () => {
  h = await ledgerHarness();
  advance(2026, 1, 1);
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 100_000n, openingDate: date(2020, 1, 1) });
  await h.run(createAccountCommands().createAccountRecord, { fold: h.fold, id: id(2), kind: 'savings', name: 'Savings', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
});

describe('creating schedules', () => {
  it('stores the pattern and the template, and defaults to no confirmation and no reminder', async () => {
    expect((await h.run(schedules().createSchedule, rent())).ok).toBe(true);
    const s = buildSchedules(await h.replica.projections.listRecords(h.fold)).get(SCH)!;
    expect(s).toMatchObject({ name: 'Rent', unit: 'month', interval: 1, requiresConfirmation: false, reminderMin: null, endLocalDate: null, completedUtcMs: null });
    expect(s.template).toMatchObject({ kind: 'transaction', amountMinor: -50_000n, accountId: id(1) });
  });

  it('stores a transfer template', async () => {
    const template = { kind: 'transfer' as const, fromAccountId: id(1), toAccountId: id(2), fromAmountMinor: 1_000n, toAmountMinor: 1_000n, note: '' };
    expect((await h.run(schedules().createSchedule, rent({ template }))).ok).toBe(true);
    expect(buildSchedules(await h.replica.projections.listRecords(h.fold)).get(SCH)!.template).toMatchObject({ kind: 'transfer', fromAmountMinor: 1_000n });
  });

  it.each([
    ['an interval below 1', { interval: 0 }, 'invalid_interval'],
    ['an end before the start', { endLocalDate: date(2026, 1, 1) }, 'invalid_end_date'],
    ['an empty name', { name: ' ' }, 'invalid_schedule_name'],
    ['a negative reminder', { reminderMin: -5 }, 'invalid_reminder'],
    ['an unknown unit', { unit: 'fortnight' }, 'invalid_unit'],
    ['an expense above zero', { template: { kind: 'transaction', direction: 'expense', accountId: id(1), amountMinor: 5n, categoryId: null, payeeId: null, tagIds: [], note: '' } }, 'invalid_template_amount'],
    ['a transfer to itself', { template: { kind: 'transfer', fromAccountId: id(1), toAccountId: id(1), fromAmountMinor: 5n, toAmountMinor: 5n, note: '' } }, 'same_account'],
    ['an account that does not exist', { template: { kind: 'transaction', direction: 'expense', accountId: id(9), amountMinor: -5n, categoryId: null, payeeId: null, tagIds: [], note: '' } }, 'not_found'],
  ])('refuses %s', async (_name, over, code) => {
    expect(await h.run(schedules().createSchedule, rent(over))).toMatchObject({ ok: false, error: { code } });
  });

  it('refuses an existing id and a viewer', async () => {
    await h.run(schedules().createSchedule, rent());
    expect(await h.run(schedules().createSchedule, rent())).toMatchObject({ ok: false, error: { code: 'schedule_exists' } });
    h.setRole('viewer');
    expect((await h.run(schedules().createSchedule, rent({ id: id(0x51) }))).ok).toBe(false);
  });
});

describe('automatic and confirmed occurrences', () => {
  it('posts an occurrence on its due date, on the day, not before', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 15) }));
    advance(2026, 1, 14);
    expect(await run()).toMatchObject({ ok: true, value: { created: 0 } });
    advance(2026, 1, 15);
    expect(await run()).toMatchObject({ ok: true, value: { created: 1 } });
    const [t] = await days();
    expect(t).toMatchObject({ status: 'posted', amountMinor: -50_000n, localDate: date(2026, 1, 15), note: 'Rent', origin: { scheduleId: SCH, n: 0 } });
    expect(t!.id).toBe(occurrenceId(SCH, 0));
  });

  it('catches up every missed occurrence after a long absence, month ends included', async () => {
    await h.run(schedules().createSchedule, rent());
    advance(2026, 5, 2);
    expect(await run()).toMatchObject({ ok: true, value: { created: 4 } });
    expect((await days()).map((t) => t.localDate)).toEqual([date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]);
  });

  it('keeps a confirmation-required occurrence pending, out of posted balances, until it is confirmed', async () => {
    await h.run(schedules().createSchedule, rent({ requiresConfirmation: true, beginLocalDate: date(2026, 1, 10) }));
    advance(2026, 1, 10);
    await run();
    const balance = async () => (await h.ledger()).entriesByAccount.get(id(1))!.filter((e) => e.status === 'posted').reduce((s, e) => s + e.amountMinor, 100_000n);
    expect((await days())[0]).toMatchObject({ status: 'pending' });
    expect(await balance()).toBe(100_000n);
    expect(await h.run(materialiser().confirmOccurrence, { fold: h.fold, schedule: SCH, n: 0 })).toMatchObject({ ok: true });
    expect((await days())[0]).toMatchObject({ status: 'posted' });
    expect(await balance()).toBe(50_000n);
  });

  it('skipping keeps a void record so the occurrence is never made again', async () => {
    await h.run(schedules().createSchedule, rent({ requiresConfirmation: true, beginLocalDate: date(2026, 1, 10) }));
    advance(2026, 2, 20);
    await run();
    expect(await h.run(materialiser().skipOccurrence, { fold: h.fold, schedule: SCH, n: 1 })).toMatchObject({ ok: true });
    expect((await days()).map((t) => t.status)).toEqual(['pending', 'void']);
    expect(await run()).toMatchObject({ ok: true, value: { created: 0 } });
  });

  it('skipping an occurrence that is not due yet creates it void', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 3, 1) }));
    expect(await h.run(materialiser().skipOccurrence, { fold: h.fold, schedule: SCH, n: 0 })).toMatchObject({ ok: true });
    expect((await days())[0]).toMatchObject({ status: 'void', localDate: date(2026, 3, 1) });
    advance(2026, 3, 5);
    expect(await run()).toMatchObject({ ok: true, value: { created: 0 } });
  });

  it('creates a transfer that moves money between the accounts', async () => {
    const template = { kind: 'transfer' as const, fromAccountId: id(1), toAccountId: id(2), fromAmountMinor: 2_500n, toAmountMinor: 2_500n, note: 'Save' };
    await h.run(schedules().createSchedule, rent({ template, beginLocalDate: date(2026, 1, 5) }));
    advance(2026, 2, 6);
    expect(await run()).toMatchObject({ ok: true, value: { created: 2 } });
    const ledger = await h.ledger();
    expect([...ledger.transfers.values()].map((x) => [x.localDate, x.fromAmountMinor, x.status])).toEqual([[date(2026, 1, 5), 2_500n, 'posted'], [date(2026, 2, 5), 2_500n, 'posted']]);
    expect([...ledger.transfers.keys()].sort()).toEqual([occurrenceId(SCH, 0), occurrenceId(SCH, 1)].sort());
  });

  it('reports an occurrence it cannot make and tries again next time', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 10) }));
    await h.run(createAccountCommands().archiveAccount, { fold: h.fold, id: id(1), archived: true });
    advance(2026, 1, 11);
    expect(await run()).toMatchObject({ ok: true, value: { created: 0, failed: [{ scheduleId: SCH, n: 0, code: 'account_archived' }] } });
    await h.run(createAccountCommands().archiveAccount, { fold: h.fold, id: id(1), archived: false });
    expect(await run()).toMatchObject({ ok: true, value: { created: 1, failed: [] } });
  });
});

describe('editing and finishing (FR-065)', () => {
  it('an edit changes only occurrences not yet made', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 10) }));
    advance(2026, 2, 12);
    await run();
    const template = { kind: 'transaction' as const, direction: 'expense' as const, accountId: id(1), amountMinor: -60_000n, categoryId: null, payeeId: null, tagIds: [], note: 'Rent up' };
    expect(await h.run(schedules().updateSchedule, { fold: h.fold, id: SCH, template })).toMatchObject({ ok: true });
    advance(2026, 3, 12);
    await run();
    expect((await days()).map((t) => t.amountMinor)).toEqual([-50_000n, -50_000n, -60_000n]);
  });

  it('can change the end date, confirmation and reminder at any time', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 10) }));
    advance(2026, 2, 12);
    await run();
    expect(await h.run(schedules().updateSchedule, { fold: h.fold, id: SCH, changes: { endLocalDate: date(2026, 2, 28), requiresConfirmation: true, reminderMin: 60 } })).toMatchObject({ ok: true });
    advance(2026, 6, 1);
    await run();
    expect((await days()).length).toBe(2);
  });

  it('locks the pattern once occurrences exist, and allows it before', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 10) }));
    expect(await h.run(schedules().updateSchedule, { fold: h.fold, id: SCH, changes: { interval: 2 } })).toMatchObject({ ok: true });
    advance(2026, 1, 11);
    await run();
    expect(await h.run(schedules().updateSchedule, { fold: h.fold, id: SCH, changes: { interval: 3 } })).toMatchObject({ ok: false, error: { code: 'pattern_locked' } });
    expect(await h.run(schedules().updateSchedule, { fold: h.fold, id: SCH, changes: { name: 'Flat' } })).toMatchObject({ ok: true });
  });

  it('finishing stops new occurrences and keeps the ones made', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 10) }));
    advance(2026, 2, 12);
    await run();
    expect(await h.run(schedules().finishSchedule, { fold: h.fold, id: SCH })).toMatchObject({ ok: true });
    advance(2026, 6, 1);
    expect(await run()).toMatchObject({ ok: true, value: { created: 0 } });
    expect((await days()).length).toBe(2);
    expect(buildSchedules(await h.replica.projections.listRecords(h.fold)).get(SCH)!.completedUtcMs).toBe(at(2026, 2, 12));
    expect(await h.run(schedules().updateSchedule, { fold: h.fold, id: SCH, changes: { name: 'x' } })).toMatchObject({ ok: false, error: { code: 'already_completed' } });
    expect(await h.run(schedules().finishSchedule, { fold: h.fold, id: SCH })).toMatchObject({ ok: true });
  });

  it('deleting the schedule leaves its transactions', async () => {
    await h.run(schedules().createSchedule, rent({ beginLocalDate: date(2026, 1, 10) }));
    advance(2026, 1, 12);
    await run();
    expect(await h.run(schedules().deleteSchedule, { fold: h.fold, id: SCH })).toMatchObject({ ok: true });
    advance(2026, 6, 1);
    expect(await run()).toMatchObject({ ok: true, value: { created: 0 } });
    expect((await days()).length).toBe(1);
    expect(await h.run(schedules().deleteSchedule, { fold: h.fold, id: SCH })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('repair rules', () => {
  const run2 = (f: LedgerFixture) => createRepair(schedulingRepairRules).run(f.fold);

  it('flags a schedule whose account is gone, and hides a malformed one', () => {
    const f = new LedgerFixture();
    const a = f.account();
    const rec = f.nextId();
    f.apply(rec, TABLE.schedule, new Map([[1, 'Rent'], [2, 1n], [3, BigInt(date(2026, 1, 1))], [5, 3n], [6, 1n], [10, 1n], [11, a], [12, -100n]]));
    expect(run2(f).findings).toEqual([]);
    f.remove(a, TABLE.account);
    expect(run2(f).findings).toMatchObject([{ kind: 'schedule_invalid', ref: rec, effect: 'flag' }]);
    const bad = f.nextId();
    f.apply(bad, TABLE.schedule, new Map([[1, 'broken']]));
    expect(run2(f).hidden.has(bad)).toBe(true);
  });
});
