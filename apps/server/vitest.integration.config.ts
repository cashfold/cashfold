import { defineConfig } from 'vitest/config';

// Integration tests start real PostgreSQL containers (Testcontainers) and need Docker. They are excluded from the default
// run: `pnpm --filter @cashfold/server test:integration`.
export default defineConfig({
  test: { include: ['test/**/*.int.test.ts'], testTimeout: 120_000, hookTimeout: 180_000, pool: 'forks', fileParallelism: false },
});
