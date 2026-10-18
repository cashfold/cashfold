import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

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
    command: 'pnpm --filter @cashfold/web build && pnpm dlx serve -l 3000 apps/web/out',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
