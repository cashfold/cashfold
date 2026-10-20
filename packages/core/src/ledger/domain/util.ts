// Small integer helpers for ledger code. The standard maths library is kept out of money paths so that no float can sneak in.

/** The largest of `values`, or `fallback` when there are none. */
export const maxOf = (values: readonly number[], fallback: number): number => values.reduce((m, v) => (v > m ? v : m), fallback);

/** The smallest of `values`, or `fallback` when there are none. */
export const minOf = (values: readonly number[], fallback: number): number => values.reduce((m, v) => (v < m ? v : m), fallback);

/** Whole seconds in a non-negative millisecond instant. */
export const secondsOf = (ms: number): number => Number(BigInt(ms) / 1000n);

/** `ceil(n / d)` for non-negative integers. */
export const ceilDiv = (n: number, d: number): number => Number((BigInt(n) + BigInt(d) - 1n) / BigInt(d));

/** Total order on text by code unit, the same on every device. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** -1, 0 or 1 for the sign of a difference that may not fit in a JavaScript number. */
export const signOf = (n: bigint): number => (n < 0n ? -1 : n > 0n ? 1 : 0);
