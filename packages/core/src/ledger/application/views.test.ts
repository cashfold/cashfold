import { describe, expect, it } from 'vitest';
import type { ProjectionReader } from '../../sync/application/buses';
import { createEventBus } from '../../sync/application/buses';
import { LedgerFixture, id } from '../../testing/index';
import { createLedgerViews } from './views';

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

  it('drops the cache on a domain event for that Fold only', async () => {
    const events = createEventBus();
    const views = createLedgerViews(events);
    const counter = { calls: 0 };
    const reader = readerOf(new LedgerFixture(), counter);
    await views.get(FOLD, reader);
    events.publish([{ type: 'RecordChanged', fold: id(0xf9), rec: id(1), table: 1, changedFields: [], changedSets: [] }]);
    await views.get(FOLD, reader);
    expect(counter.calls).toBe(1);
    events.publish([{ type: 'RecordChanged', fold: FOLD, rec: id(1), table: 1, changedFields: [], changedSets: [] }]);
    await views.get(FOLD, reader);
    expect(counter.calls).toBe(2);
  });

  it('does not keep a view that was built while a change arrived', async () => {
    const events = createEventBus();
    const views = createLedgerViews(events);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const counter = { calls: 0 };
    const slow: ProjectionReader = { getRecord: async () => undefined, listRecords: async () => (counter.calls++, await gate, new LedgerFixture().fold) };
    const first = views.get(FOLD, slow);
    events.publish([{ type: 'RecordChanged', fold: FOLD, rec: id(1), table: 1, changedFields: [], changedSets: [] }]);
    release();
    await first;
    await views.get(FOLD, slow);
    expect(counter.calls).toBe(2);
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
