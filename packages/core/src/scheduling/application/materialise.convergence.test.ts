import { describe, expect, it } from 'vitest';
import { createCluster, createRng, date, id, type Cluster } from '../../testing/index';
import { createCommandBus, createEventBus } from '../../sync/application/buses';
import { createAccountCommands } from '../../ledger/application/account-commands';
import { buildLedger } from '../../ledger/application/projections/ledger';
import { LEDGER_GROUPS } from '../../ledger/domain/ledger-groups';
import { occurrence, occurrenceId, occurrencesUntil, type RecurrenceUnit } from '../domain/occurrence';
import { fromEpochMs, type LocalDate } from '../../shared-kernel/local-date';
import { createMaterialiser } from './materialise';
import { createScheduleCommands } from './schedule-commands';

// Three replicas that are offline across a due date each create the occurrences they see as due. Whatever order
// they sync in, there is exactly one record per occurrence (FR-064, SC-012).

const SCHEDULE = id(0x77);

/** Time passes for everyone before they meet again: a device never receives ops dated far beyond its own clock. */
async function meet(c: Cluster, nowOf: number[]): Promise<void> {
  const latest = Math.max(...nowOf);
  c.replicas.forEach((r) => r.setNow(latest));
  await c.settle();
}
const DAY_MS = 86_400_000;
const at = (d: LocalDate) => Date.UTC(Math.floor(d / 10_000), Math.floor(d / 100) % 100 - 1, d % 100, 9);

function buses(c: Cluster, nowOf: number[]) {
  return c.replicas.map((r, i) => {
    const clock = { nowMs: () => nowOf[i]! };
    const bus = createCommandBus({ writePath: r.writePath, projections: r.projections, events: createEventBus(), roleOf: async () => 'owner', isUnlocked: () => true });
    return { bus, clock, schedules: createScheduleCommands({ clock }), materialiser: createMaterialiser({ clock }), accounts: createAccountCommands() };
  });
}

async function seed(trial: { begin: LocalDate; unit: RecurrenceUnit; interval: number; end: LocalDate | null; confirm: boolean }, replicas = 3) {
  const c = await createCluster({ replicas, groups: LEDGER_GROUPS });
  const nowOf = c.replicas.map(() => at(trial.begin));
  c.replicas.forEach((r, i) => r.setNow(nowOf[i]!));
  const b = buses(c, nowOf);
  const first = b[0]!;
  await first.bus.execute(first.accounts.createAccountRecord, { fold: c.fold, id: id(1), kind: 'checking', name: 'Main', currency: 'USD', openingBalanceMinor: 0n, openingDate: date(2020, 1, 1) });
  const made = await first.bus.execute(first.schedules.createSchedule, {
    fold: c.fold, id: SCHEDULE, name: 'Rent', beginLocalDate: trial.begin, endLocalDate: trial.end, unit: trial.unit, interval: trial.interval,
    requiresConfirmation: trial.confirm, template: { kind: 'transaction', direction: 'expense', accountId: id(1), amountMinor: -50_000n, categoryId: null, payeeId: null, tagIds: [], note: '' },
  });
  if (!made.ok) throw new Error(`seed failed: ${made.error.code}`);
  await c.settle();
  return { c, b, nowOf };
}

describe('three replicas offline across a due date', () => {
  it('create each occurrence once, with the id every device derives', async () => {
    const trial = { begin: date(2026, 1, 31), unit: 'month' as const, interval: 1, end: null, confirm: false };
    const { c, b, nowOf } = await seed(trial);
    for (const i of [0, 1, 2]) c.setOffline(i, true);
    nowOf[0] = at(date(2026, 4, 1)); // sees 31 Jan, 28 Feb, 31 Mar
    nowOf[1] = at(date(2026, 3, 15)); // sees 31 Jan, 28 Feb
    nowOf[2] = at(date(2026, 5, 31)); // sees through 31 May
    for (const i of [0, 1, 2]) {
      c.replicas[i]!.setNow(nowOf[i]!);
      await b[i]!.bus.execute(b[i]!.materialiser.materialiseDue, { fold: c.fold });
    }
    await meet(c, nowOf);
    for (const s of await c.states()) {
      const ledger = buildLedger(s);
      expect([...ledger.transactions.values()].map((t) => t.origin?.n).sort()).toEqual([0, 1, 2, 3, 4]);
      expect([...ledger.transactions.values()].map((t) => t.localDate).sort()).toEqual([date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30), date(2026, 5, 31)]);
      for (const t of ledger.transactions.values()) expect(t.id).toBe(occurrenceId(SCHEDULE, t.origin!.n));
    }
  });

  it('running again, here or after a sync, creates nothing more', async () => {
    const { c, b, nowOf } = await seed({ begin: date(2026, 1, 1), unit: 'week', interval: 1, end: null, confirm: false });
    nowOf[0] = at(date(2026, 2, 1));
    c.replicas[0]!.setNow(nowOf[0]!);
    const first = await b[0]!.bus.execute(b[0]!.materialiser.materialiseDue, { fold: c.fold });
    expect(first).toMatchObject({ ok: true, value: { created: 5, failed: [] } });
    expect(await b[0]!.bus.execute(b[0]!.materialiser.materialiseDue, { fold: c.fold })).toMatchObject({ ok: true, value: { created: 0 } });
    await meet(c, nowOf);
    nowOf[1] = at(date(2026, 2, 1));
    c.replicas[1]!.setNow(nowOf[1]!);
    expect(await b[1]!.bus.execute(b[1]!.materialiser.materialiseDue, { fold: c.fold })).toMatchObject({ ok: true, value: { created: 0 } });
  });

  it('does not bring back an occurrence the person deleted', async () => {
    const { c, b, nowOf } = await seed({ begin: date(2026, 1, 1), unit: 'day', interval: 10, end: null, confirm: false });
    nowOf[0] = at(date(2026, 1, 25));
    c.replicas[0]!.setNow(nowOf[0]!);
    await b[0]!.bus.execute(b[0]!.materialiser.materialiseDue, { fold: c.fold });
    const { createTransactionCommands } = await import('../../ledger/application/transaction-commands');
    const tx = createTransactionCommands({ clock: b[0]!.clock });
    await b[0]!.bus.execute(tx.deleteTransaction, { fold: c.fold, id: occurrenceId(SCHEDULE, 1) });
    expect(await b[0]!.bus.execute(b[0]!.materialiser.materialiseDue, { fold: c.fold })).toMatchObject({ ok: true, value: { created: 0 } });
    expect(buildLedger((await c.states())[0]!).transactions.has(occurrenceId(SCHEDULE, 1))).toBe(false);
  });

  it('holds over 500 random trials, including month-end and leap-day schedules', { timeout: 300_000 }, async () => {
    const rng = createRng(2026);
    const begins = [date(2024, 2, 29), date(2026, 1, 31), date(2026, 3, 30), date(2027, 12, 31), date(2026, 2, 28), date(2026, 6, 15), date(2028, 2, 29)];
    for (let trialNo = 0; trialNo < 500; trialNo++) {
      const unit = rng.pick<RecurrenceUnit>(['day', 'week', 'month', 'month', 'month', 'year']);
      const begin = rng.pick(begins);
      const interval = unit === 'day' ? 1 + rng.int(20) : 1 + rng.int(3);
      const trial = { begin, unit, interval, end: rng.chance(0.3) ? fromEpochMs(at(begin) + (60 + rng.int(900)) * DAY_MS, 0) : null, confirm: rng.chance(0.3) };
      const { c, b, nowOf } = await seed(trial);
      for (const i of [0, 1, 2]) c.setOffline(i, true);
      for (const i of [0, 1, 2]) nowOf[i] = at(begin) + rng.int(500) * DAY_MS;
      const rounds = 1 + rng.int(2);
      for (let round = 0; round < rounds; round++) {
        for (const i of rng.shuffle([0, 1, 2])) {
          if (round > 0) nowOf[i] = nowOf[i]! + rng.int(30) * DAY_MS;
          c.replicas[i]!.setNow(nowOf[i]!);
          await b[i]!.bus.execute(b[i]!.materialiser.materialiseDue, { fold: c.fold });
        }
      }
      await meet(c, nowOf);

      const wanted = new Set<number>();
      for (const now of nowOf) for (const n of occurrencesUntil(trial, fromEpochMs(now, 0), trial.end)) wanted.add(n);
      const ledgers = (await c.states()).map((s) => buildLedger(s));
      for (const ledger of ledgers) {
        const made = [...ledger.transactions.values()];
        const numbers = made.map((t) => t.origin!.n).sort((x, y) => x - y);
        expect(numbers, `trial ${trialNo}`).toEqual([...wanted].sort((x, y) => x - y));
        expect(new Set(made.map((t) => t.id)).size).toBe(made.length);
        for (const t of made) {
          expect(t.localDate).toBe(occurrence(trial, t.origin!.n));
          expect(t.status).toBe(trial.confirm ? 'pending' : 'posted');
        }
      }
      expect(ledgers[1]!.transactions).toEqual(ledgers[0]!.transactions);
      expect(ledgers[2]!.transactions).toEqual(ledgers[0]!.transactions);
    }
  });
});
