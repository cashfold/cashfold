import fc from 'fast-check';

// Default 100 runs locally, 1000 on CI. verbose logs the seed and counterexample path on failure.
fc.configureGlobal({
  numRuns: process.env['CI'] ? 1000 : Number(process.env['FAST_CHECK_NUM_RUNS'] ?? 100),
  verbose: 1,
});
