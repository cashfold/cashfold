import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import { id, setup } from '../../testing/index';
import { MAX_FUTURE_MS } from '../domain/hlc';
import type { FieldValue } from '../domain/merge';
import type { QuarantinedOp, SealedOp } from '../ports/index';
import { clockNotices, isBeyondClockWindow } from './clock-guard';

const NOW = 1_800_000_000_000;
const sealed = (n: number, wallMs: number, dev: Id = id(0xd1)): SealedOp => ({ fold: id(0xf0), op: id(n), rec: id(1), dev, seq: BigInt(n), hlc: { wallMs, ctr: 0 }, epoch: 1, schema: 1, blob: new Uint8Array(1), sig: new Uint8Array(64) });
const q = (n: number, wallMs: number, reason: QuarantinedOp['reason'] = 'clock_ahead'): QuarantinedOp => ({ sealed: sealed(n, wallMs), reason, atMs: NOW + n });

describe('clock guard (FR-079)', () => {
  it('treats an op stamped more than 24 hours ahead as beyond the window, and exactly 24 hours as inside it', () => {
    expect(isBeyondClockWindow(NOW + MAX_FUTURE_MS, NOW)).toBe(false);
    expect(isBeyondClockWindow(NOW + MAX_FUTURE_MS + 1, NOW)).toBe(true);
    expect(isBeyondClockWindow(NOW - 10 * MAX_FUTURE_MS, NOW)).toBe(false); // old ops are normal after a long offline spell
  });

  it('turns quarantined too-far-ahead ops into notices, newest first, and ignores other reasons', () => {
    const notices = clockNotices([q(1, NOW + 2 * 86_400_000), q(2, NOW + 3 * 86_400_000), q(3, NOW, 'bad_signature')], NOW);
    expect(notices.map((n) => n.op)).toEqual([id(2), id(1)]);
    expect(notices[0]).toMatchObject({ kind: 'clock_ahead', dev: id(0xd1), aheadByMs: 3 * 86_400_000, messageKey: 'attention.clock_ahead' });
  });

  it('measures how far ahead against the current time, so the notice can say when the clocks differ by days', () => {
    const [n] = clockNotices([q(1, NOW + 5 * 86_400_000)], NOW + 86_400_000);
    expect(n!.aheadByMs).toBe(4 * 86_400_000);
  });

  it('carries no ledger content', () => {
    const [n] = clockNotices([q(1, NOW + 2 * 86_400_000)], NOW);
    expect(Object.keys(n!).sort()).toEqual(['aheadByMs', 'atMs', 'dev', 'kind', 'messageKey', 'op']);
  });

  it('is what the write path actually does: an op from far in the future is quarantined, not applied', async () => {
    const w = await setup();
    const [a, b] = [await w.node(0), await w.node(1)];
    a.replica.setNow(NOW + 3 * 86_400_000);
    b.replica.setNow(NOW);
    await a.replica.writePath.submit({ fold: id(0xf0), rec: id(1), table: 6, fields: new Map<number, FieldValue>([[1, 'x']]), sets: new Map() });
    await a.client.syncFold(id(0xf0));
    const report = await b.client.syncFold(id(0xf0));
    expect(report).toMatchObject({ applied: 0, quarantined: 1 });
    const notices = clockNotices(await b.replica.oplog.listQuarantined(id(0xf0)), NOW);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.aheadByMs).toBeGreaterThan(MAX_FUTURE_MS);
  });
});
