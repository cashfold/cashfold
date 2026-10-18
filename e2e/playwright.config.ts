import { defineConfig, devices } from '@playwright/test';

// The e2e server is built and served by this config on its own port, so a `next dev` on :3000 (no service worker, hot reload)
// can never be mistaken for the production build under test.
const port = Number(process.env['E2E_PORT'] ?? 3100);
const baseURL = process.env['E2E_BASE_URL'] ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Every spec also runs once under an RTL locale and asserts logical layout order.
    { name: 'rtl', use: { ...devices['Desktop Chrome'], locale: 'ar' } },
  ],
  // E2E_NO_SERVER=1 runs specs that serve their own pages (the leak-scan self-test) without building the app.
  webServer: process.env['E2E_NO_SERVER'] ? undefined : {
    command: `pnpm --filter @cashfold/web build && pnpm exec serve -l ${port} apps/web/out`,
    url: baseURL,
    // Reusing a running server is opt-in (E2E_REUSE=1): it must be a production build served from apps/web/out.
    reuseExistingServer: process.env['E2E_REUSE'] === '1',
    timeout: 180_000,
  },
});
