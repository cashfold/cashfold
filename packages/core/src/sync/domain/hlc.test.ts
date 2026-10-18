import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id.js';
import { compareHlc, compareStamp, MAX_CTR, MAX_FUTURE_MS, MAX_WALL_MS, receive, tick, ZERO_HLC, type Hlc } from './hlc.js';

const H = (wallMs: number, ctr: number): Hlc => ({ wallMs, ctr });
const dev = (s: string) => s as Id;
const unwrap = (r: { ok: true; value: Hlc } | { ok: false; error: unknown }): Hlc => {
  if (!r.ok) throw new Error(`unexpected ${JSON.stringify(r.error)}`);
  return r.value;
};

describe('ordering', () => {
  it('orders by wall, then counter', () => {
    expect(compareHlc(H(1, 0), H(2, 0))).toBeLessThan(0);
    expect(compareHlc(H(2, 0), H(1, 9))).toBeGreaterThan(0);
    expect(compareHlc(H(5, 1), H(5, 2))).toBeLessThan(0);
    expect(compareHlc(H(5, 2), H(5, 2))).toBe(0);
  });

  it('breaks full ties by device id so two different stamps are never equal', () => {
    const a = { hlc: H(5, 2), dev: dev('00000000-0000-0000-0000-000000000001') };
    const b = { hlc: H(5, 2), dev: dev('00000000-0000-0000-0000-000000000002') };
    expect(compareStamp(a, b)).toBeLessThan(0);
    expect(compareStamp(b, a)).toBeGreaterThan(0);
    expect(compareStamp(a, a)).toBe(0);
    expect(compareStamp({ hlc: H(6, 0), dev: a.dev }, b)).toBeGreaterThan(0);
  });
});

describe('tick (local event)', () => {
  it('uses the physical clock when it is ahead and resets the counter', () => {
    expect(tick(H(100, 7), 200)).toEqual({ ok: true, value: H(200, 0) });
  });

  it('increments the counter when the physical clock has not advanced', () => {
    expect(tick(H(100, 7), 100)).toEqual({ ok: true, value: H(100, 8) });
    expect(tick(H(100, 7), 50)).toEqual({ ok: true, value: H(100, 8) }); // clock went backwards
  });

  it('advances wall time by 1 ms on counter overflow', () => {
    expect(tick(H(100, MAX_CTR), 100)).toEqual({ ok: true, value: H(101, 0) });
    expect(tick(H(100, MAX_CTR), 40)).toEqual({ ok: true, value: H(101, 0) });
  });

  it('refuses to exceed the u48 wall range', () => {
    expect(tick(H(MAX_WALL_MS, MAX_CTR), 0)).toEqual({ ok: false, error: expect.objectContaining({ code: 'clock_overflow' }) });
  });

  it('property: strictly monotonic whatever the physical clock does', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 2 ** 40 }), { minLength: 1, maxLength: 60 }), (nows) => {
        let clock = ZERO_HLC;
        for (const now of nows) {
          const next = unwrap(tick(clock, now));
          expect(compareHlc(next, clock)).toBeGreaterThan(0);
          expect(next.wallMs).toBeGreaterThanOrEqual(now);
          clock = next;
        }
      }),
    );
  });
});

describe('receive (remote event)', () => {
  it('takes the remote clock when it is ahead of local and physical time', () => {
    expect(receive(H(100, 3), H(200, 5), 150)).toEqual({ ok: true, value: H(200, 6) });
  });

  it('merges counters when local and remote walls tie at the maximum', () => {
    expect(receive(H(100, 3), H(100, 9), 50)).toEqual({ ok: true, value: H(100, 10) });
    expect(receive(H(100, 9), H(100, 3), 50)).toEqual({ ok: true, value: H(100, 10) });
  });

  it('continues the local counter when local is ahead', () => {
    expect(receive(H(300, 4), H(200, 99), 150)).toEqual({ ok: true, value: H(300, 5) });
  });

  it('resets the counter when physical time is ahead of both', () => {
    expect(receive(H(100, 3), H(120, 5), 500)).toEqual({ ok: true, value: H(500, 0) });
  });

  it('handles counter overflow by advancing wall time', () => {
    expect(receive(H(100, MAX_CTR), H(100, 1), 0)).toEqual({ ok: true, value: H(101, 0) });
    expect(receive(H(100, 1), H(100, MAX_CTR), 0)).toEqual({ ok: true, value: H(101, 0) });
  });

  it('rejects remote wall time more than 24 h ahead of now (boundary is inclusive)', () => {
    const now = 1_000_000_000_000;
    expect(receive(ZERO_HLC, H(now + MAX_FUTURE_MS, 0), now).ok).toBe(true);
    expect(receive(ZERO_HLC, H(now + MAX_FUTURE_MS + 1, 0), now)).toEqual({ ok: false, error: expect.objectContaining({ code: 'remote_too_far_ahead' }) });
  });

  it('property: result is strictly after both local and remote', () => {
    const hlc = fc.record({ wallMs: fc.integer({ min: 0, max: 2 ** 40 }), ctr: fc.integer({ min: 0, max: MAX_CTR }) });
    fc.assert(
      fc.property(hlc, hlc, fc.integer({ min: 0, max: 2 ** 40 }), (local, remote, now) => {
        const r = receive(local, remote, now);
        if (!r.ok) {
          expect(remote.wallMs).toBeGreaterThan(now + MAX_FUTURE_MS);
          return;
        }
        expect(compareHlc(r.value, local)).toBeGreaterThan(0);
        expect(compareHlc(r.value, remote)).toBeGreaterThan(0);
        expect(r.value.wallMs).toBeGreaterThanOrEqual(now);
      }),
    );
  });
});
