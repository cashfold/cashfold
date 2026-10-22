import { defineConfig } from '@playwright/test';

// End-to-end tests of the desktop app, driven through Playwright's Electron support. By default they run the built app from source
// (`electron apps/desktop`, after `pnpm --filter @cashfold/desktop build`); with CASHFOLD_APP_EXECUTABLE set they run a packaged app
// (scripts/test-packaged.mjs). Each test gets its own user-data folder, so nothing leaks between tests or into a real profile.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
});
