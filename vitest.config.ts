import { defineConfig } from 'vitest/config';

// Coverage floors from the constitution's Quality Gates: domain and crypto >= 95%
// (lines and branches), application >= 85%.
export default defineConfig({
  // Component tests (apps/web) render JSX; tsconfig keeps `jsx: preserve` for Next.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    // Browser tests need a real browser: run them with `pnpm --filter @cashfold/web test:browser`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.browser.test.{ts,tsx}', 'e2e/**'],
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
