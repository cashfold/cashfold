import { defineWorkspace } from 'vitest/config';

// Property tests: seed is logged on failure by fast-check; CI runs 1000 runs (FAST_CHECK_NUM_RUNS).

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'apps/web/vitest.config.ts',
  { test: { name: 'eslint-rules', include: ['eslint-rules/**/*.test.js'] } },
]);
