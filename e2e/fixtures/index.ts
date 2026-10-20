import AxeBuilder from '@axe-core/playwright';
import { expect, test as base } from '@playwright/test';
import { formatLeaks, scanForLeaks, startCapture, type Capture, type Seed } from './leak-scan.js';

export { formatLeaks, scanForLeaks, startCapture, type Capture, type Seed };

/** Test with blocking WCAG 2.2 AA axe assertions and a plaintext-leak scan. */
export const test = base.extend<{
  cspGuard: void;
  expectNoA11yViolations: () => Promise<void>;
  leakScan: { begin(): Capture; expectNoLeaks(seed: Seed, capture?: Capture): Promise<void> };
}>({
  // Every page reports `securitypolicyviolation` events (a blocked inline style or script, a Trusted Types sink) and the test fails with the
  // directive and URL (FR-049, R-UX-03). The listener is installed before any page script runs, so a violation during hydration is seen too.
  cspGuard: [
    async ({ page }, use) => {
      const seen: string[] = [];
      await page.exposeFunction('__reportCspViolation', (line: string) => seen.push(line));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          const report = (window as unknown as { __reportCspViolation?: (line: string) => void }).__reportCspViolation;
          report?.(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'} on ${location.pathname} (${e.sourceFile || 'no source'}:${e.lineNumber})`);
        });
      });
      await use();
      expect(seen, 'Content-Security-Policy / Trusted Types violations').toEqual([]);
    },
    { auto: true },
  ],
  expectNoA11yViolations: async ({ page }, use) => {
    await use(async () => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations).toEqual([]);
    });
  },
  leakScan: async ({ page }, use) => {
    await use({
      begin: () => startCapture(page),
      async expectNoLeaks(seed, capture) {
        const leaks = await scanForLeaks(page, capture ? { seed, capture } : { seed });
        expect(leaks, formatLeaks(leaks)).toEqual([]);
      },
    });
  },
});

export { expect };
