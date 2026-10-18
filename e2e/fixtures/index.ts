import AxeBuilder from '@axe-core/playwright';
import { expect, test as base } from '@playwright/test';
import { formatLeaks, scanForLeaks, startCapture, type Capture, type Seed } from './leak-scan.js';

export { formatLeaks, scanForLeaks, startCapture, type Capture, type Seed };

/** Test with blocking WCAG 2.2 AA axe assertions and a plaintext-leak scan. */
export const test = base.extend<{
  expectNoA11yViolations: () => Promise<void>;
  leakScan: { begin(): Capture; expectNoLeaks(seed: Seed, capture?: Capture): Promise<void> };
}>({
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
