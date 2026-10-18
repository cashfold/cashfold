import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Adapter tests that need a real browser (OPFS, Web Workers, WASM). Run with: pnpm --filter @cashfold/web test:browser
export default defineConfig({
  optimizeDeps: { include: ['@aztec/sqlite3mc-wasm', '@cashfold/crypto'] },
  test: {
    name: 'web-browser',
    include: ['src/**/*.browser.test.ts'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
