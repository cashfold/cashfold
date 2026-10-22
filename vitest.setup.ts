import fc from 'fast-check';
import { vi } from 'vitest';

// Default 100 runs locally, 1000 on CI. verbose logs the seed and counterexample path on failure.
fc.configureGlobal({
  numRuns: process.env['CI'] ? 1000 : Number(process.env['FAST_CHECK_NUM_RUNS'] ?? 100),
  verbose: 1,
});

if (process.env['CI']) vi.setConfig({ testTimeout: 60_000 });
