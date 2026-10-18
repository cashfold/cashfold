import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Test with helpers for offline switching and blocking WCAG 2.2 AA axe assertions. */
export const test = base.extend<{ expectNoA11yViolations: () => Promise<void> }>({
  expectNoA11yViolations: async ({ page }, use) => {
    await use(async () => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  },
});

export { expect };
