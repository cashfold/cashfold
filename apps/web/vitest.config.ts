import { defineConfig } from 'vitest/config';

// Unit tests that run in Node. Browser-only tests are *.browser.test.ts (see vitest.browser.config.ts).
export default defineConfig({
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'src/**/*.browser.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
  },
});
