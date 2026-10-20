import { describe, expect, it } from 'vitest';
import type { ProjectionReader } from '../../sync/application/buses';
import { createEventBus } from '../../sync/application/buses';
import { LedgerFixture, id } from '../../testing/index';
import { createLedgerViews, PATCH_LIMIT } from './views';

const FOLD = id(0xf0);
const readerOf = (f: LedgerFixture, counter = { calls: 0 }): ProjectionReader => ({
  getRecord: async (_fold, rec) => f.fold.get(rec),
  listRecords: async () => (counter.calls++, f.fold),
});

describe('ledger views', () => {
  it('drops every cached Fold when invalidated without a Fold', async () => {
    const views = createLedgerViews(createEventBus());
    const counter = { calls: 0 };
    const reader = readerOf(new LedgerFixture(), counter);
    await views.get(FOLD, reader);
    await views.get(id(0xf1), reader);
    views.invalidate();
    await views.get(FOLD, reader);
    await views.get(id(0xf1), reader);
    expect(counter.calls).toBe(4);
  });

  const changed = (fold: typeof FOLD, rec: typeof FOLD) => [{ type: 'RecordChanged' as const, fold, rec, table: 1, changedFields: [], changedSets: [] }];

  it('on a change re-reads only the records that changed, for that Fold only, never the whole Fold again', async () => {
    const events = createEventBus();
    const views = createLedgerViews(events);
    const f = new LedgerFixture();
    const reads: string[] = [];
    const counter = { calls: 0 };
    const reader: ProjectionReader = { listRecords: async () => (counter.calls++, new Map(f.fold)), getRecord: async (_fold, rec) => (reads.push(rec), f.fold.get(rec)) };
    await views.get(FOLD, reader);
    events.publish(changed(id(0xf9), id(1))); // another Fold: nothing to do
    await views.get(FOLD, reader);
    expect(reads).toEqual([]);
    events.publish(changed(FOLD, id(1)));
    events.publish(changed(FOLD, id(2)));
    events.publish(changed(FOLD, id(1)));
    await views.get(FOLD, reader);
    expect(reads.sort()).toEqual([id(1), id(2)]);
    expect(counter.calls).toBe(1);
    await views.get(FOLD, reader); // and nothing more until the next change
    expect(reads).toHaveLength(2);
  });

  it('reads the whole Fold again, once, when more records changed than are worth reading one by one', async () => {
    const events = createEventBus();
    const views = createLedgerViews(events);
    const f = new LedgerFixture();
    const reads: string[] = [];
    const counter = { calls: 0 };
    const reader: ProjectionReader = { listRecords: async () => (counter.calls++, new Map(f.fold)), getRecord: async (_fold, rec) => (reads.push(rec), f.fold.get(rec)) };
    await views.get(FOLD, reader);
    for (let n = 0; n <= PATCH_LIMIT; n++) events.publish(changed(FOLD, id(1000 + n)));
    f.account({ name: 'Imported' }, id(1));
    await views.get(FOLD, reader);
    expect(counter.calls).toBe(2);
    expect(reads).toEqual([]);
    expect([...(await views.get(FOLD, reader)).ledger.accounts.values()].map((a) => a.name)).toEqual(['Imported']);
  });

  it('shows a record that was added, changed or removed since the view was built', async () => {
    const events = createEventBus();
    const views = createLedgerViews(events);
    const f = new LedgerFixture();
    const reader = readerOf(f);
    expect((await views.get(FOLD, reader)).ledger.accounts.size).toBe(0);
    f.account({ name: 'Main' }, id(1));
    events.publish(changed(FOLD, id(1)));
    expect([...(await views.get(FOLD, reader)).ledger.accounts.values()].map((a) => a.name)).toEqual(['Main']);
    (f.fold as unknown as Map<string, unknown>).delete(id(1));
    events.publish(changed(FOLD, id(1)));
    expect((await views.get(FOLD, reader)).ledger.accounts.size).toBe(0);
  });

  it('includes a change that arrived while the view was being built in the next one', async () => {
    const events = createEventBus();
    const views = createLedgerViews(events);
    const f = new LedgerFixture();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ProjectionReader = { getRecord: async (_fold, rec) => f.fold.get(rec), listRecords: async () => (await gate, new Map(f.fold)) };
    const first = views.get(FOLD, slow);
    f.account({ name: 'Late' }, id(1));
    events.publish(changed(FOLD, id(1)));
    release();
    await first;
    expect([...(await views.get(FOLD, slow)).ledger.accounts.values()].map((a) => a.name)).toEqual(['Late']);
  });

  it('starts over when told to, for one Fold or all', async () => {
    const views = createLedgerViews(createEventBus());
    const counter = { calls: 0 };
    const reader = readerOf(new LedgerFixture(), counter);
    await views.get(FOLD, reader);
    await views.get(id(0xf1), reader);
    views.invalidate(FOLD);
    await views.get(FOLD, reader);
    await views.get(id(0xf1), reader);
    expect(counter.calls).toBe(3);
  });

  it('does not cache a failed build', async () => {
    const views = createLedgerViews(createEventBus());
    let fail = true;
    const reader: ProjectionReader = {
      getRecord: async () => undefined,
      listRecords: async () => {
        if (fail) throw new Error('disk error');
        return new LedgerFixture().fold;
      },
    };
    await expect(views.get(FOLD, reader)).rejects.toThrow('disk error');
    fail = false;
    expect((await views.get(FOLD, reader)).ledger.accounts.size).toBe(0);
  });

  it('applies repair verdicts to what it serves', async () => {
    const f = new LedgerFixture();
    f.transaction(id(404), { amountMinor: -5n }, id(2));
    const view = await createLedgerViews(createEventBus()).get(FOLD, readerOf(f));
    expect(view.report.findings.map((x) => x.kind)).toEqual(['orphan_transaction']);
    expect(view.ledger.transactions.size).toBe(0);
  });
});
