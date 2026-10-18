import { describe, expect, it } from 'vitest';
import { ceilDiv, compareText, maxOf, secondsOf, signOf } from './util';

describe('integer helpers', () => {
  it('finds the largest value or the fallback', () => {
    expect(maxOf([3, 9, 2], -1)).toBe(9);
    expect(maxOf([], -1)).toBe(-1);
    expect(maxOf([-5], 0)).toBe(0);
  });

  it('turns milliseconds into whole seconds', () => {
    expect(secondsOf(1_999)).toBe(1);
    expect(secondsOf(2_000)).toBe(2);
  });

  it('divides rounding up', () => {
    expect(ceilDiv(1, 10)).toBe(1);
    expect(ceilDiv(10, 10)).toBe(1);
    expect(ceilDiv(11, 10)).toBe(2);
    expect(ceilDiv(0, 10)).toBe(0);
  });

  it('orders text the same way everywhere and bigints by sign', () => {
    expect([compareText('a', 'b'), compareText('b', 'a'), compareText('a', 'a')]).toEqual([-1, 1, 0]);
    expect([signOf(-(2n ** 70n)), signOf(0n), signOf(2n ** 70n)]).toEqual([-1, 0, 1]);
  });
});
