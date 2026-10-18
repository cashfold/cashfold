// Small integer helpers for ledger code, where `Math.*` is off limits so that no float can sneak into a money path.

/** The largest of `values`, or `fallback` when there are none. */
export const maxOf = (values: readonly number[], fallback: number): number => values.reduce((m, v) => (v > m ? v : m), fallback);

/** Whole seconds in a non-negative millisecond instant. */
export const secondsOf = (ms: number): number => Number(BigInt(ms) / 1000n);
