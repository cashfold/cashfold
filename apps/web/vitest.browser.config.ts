import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Adapter tests that need a real browser (OPFS, Web Workers, WASM). Run with: pnpm --filter @cashfold/web test:browser
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  optimizeDeps: {
    // Workspace packages are linked source: never pre-bundle them, or edits and new exports go stale in the cache.
    exclude: ['@cashfold/core', '@cashfold/crypto', '@cashfold/protocol'],
    include: ['@cashfold/crypto > hash-wasm', '@cashfold/crypto > @noble/curves/ed25519.js', '@cashfold/crypto > @noble/hashes/hkdf.js', '@cashfold/crypto > @noble/hashes/sha2.js', '@cashfold/protocol > zod'],
  },
  test: {
    name: 'web-browser',
    include: ['src/**/*.browser.test.{ts,tsx}'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
