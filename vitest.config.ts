import { defineConfig } from 'vitest/config';

// Coverage floors from the constitution's Quality Gates: domain and crypto >= 95%
// (lines and branches), application >= 85%.
export default defineConfig({
  test: {
    // Browser tests need a real browser: run them with `pnpm --filter @cashfold/web test:browser`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.browser.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing/**', '**/index.ts', '**/ports/**', '**/test-support.ts'],
      thresholds: {
        'packages/crypto/src/**': { lines: 95, branches: 95 },
        'packages/core/src/*/domain/**': { lines: 95, branches: 95 },
        'packages/core/src/*/application/**': { lines: 85, branches: 85 },
      },
    },
  },
});
