import axe from 'axe-core';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import { I18nProvider } from '../i18n/I18nProvider';
import { loadAmountExpression, parseMoney } from '../ledger/format';
import { LedgerContext } from '../ledger/LedgerProvider';
import { AmountInput } from './AmountInput';

// The money input with sums in a real browser (spec 020): no axe violations in either theme or in a right-to-left layout, the result is announced
// in a live region, it replaces the hint without moving anything, and the sum stays in the field.

let root: Root | undefined;
let host: HTMLElement | undefined;

await loadAmountExpression();
const ledger = { parse: (text: string, currency: string) => parseMoney(text, currency, 'en'), mathReady: true } as never;

function Field({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <I18nProvider>
      <LedgerContext.Provider value={ledger}>
        <main>
          <AmountInput label="Amount" currency="USD" value={value} onChange={setValue} />
          <p data-testid="after">The next thing on the form</p>
        </main>
      </LedgerContext.Provider>
    </I18nProvider>
  );
}

function mount(initial: string, theme: 'light' | 'dark' = 'light', dir: 'ltr' | 'rtl' = 'ltr', width = 360): HTMLElement {
  document.documentElement.dataset['theme'] = theme;
  document.documentElement.dir = dir;
  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Field initial={initial} />));
  return host;
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  document.documentElement.dir = 'ltr';
});

async function violations(scope: Element): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 250));
  const result = await axe.run(scope, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input')!;
const after = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="after"]')!;

describe('the money input with sums', () => {
  for (const [theme, dir] of [['light', 'ltr'], ['dark', 'ltr'], ['light', 'rtl']] as const) {
    for (const [name, initial] of [['a plain number', '12.50'], ['a valid sum', '12.50 + 3.20 * 2 + 4'], ['an invalid sum', '12 +']] as const) {
      it(`has no axe violations for ${name} in ${theme} / ${dir}`, async () => {
        const el = mount(initial, theme, dir);
        expect(await violations(el)).toEqual([]);
      });
    }
  }

  it('shows the result as the sum is typed, in a polite live region, and keeps the sum in the field after leaving it', async () => {
    const el = mount('');
    await userEvent.click(input(el));
    await userEvent.keyboard('12.50 + 3.20 * 2 + 4');
    const result = el.querySelector<HTMLElement>('[data-testid="amount-result"]')!;
    expect(result.textContent).toBe('= 22.90 USD');
    expect(result.getAttribute('aria-live')).toBe('polite');
    await userEvent.tab();
    expect(input(el).value).toBe('12.50 + 3.20 * 2 + 4');
    expect(el.querySelector('[data-testid="amount-result"]')!.textContent).toBe('= 22.90 USD');
  });

  it('corrects one number inside a sum without losing the rest', async () => {
    const el = mount('12.50 + 3.20 * 2 + 4');
    await userEvent.click(input(el));
    await userEvent.keyboard('{Home}{Delete}{Delete}{Delete}{Delete}{Delete}15.00');
    expect(input(el).value).toBe('15.00 + 3.20 * 2 + 4');
    expect(el.querySelector('[data-testid="amount-result"]')!.textContent).toBe('= 25.40 USD');
  });

  it('replaces the hint without moving what is below it', async () => {
    const el = mount('');
    const before = after(el).getBoundingClientRect().top;
    await userEvent.click(input(el));
    await userEvent.keyboard('12.50 + 3');
    expect(el.querySelector('[data-testid="amount-result"]')).not.toBeNull();
    expect(Math.abs(after(el).getBoundingClientRect().top - before)).toBeLessThanOrEqual(1);
  });

  it('shows an error for a sum that cannot be worked out, then the result once it can', async () => {
    const el = mount('');
    await userEvent.click(input(el));
    await userEvent.keyboard('12 +');
    expect(el.textContent).toContain('cannot be worked out');
    expect(input(el).getAttribute('aria-invalid')).toBe('true');
    await userEvent.keyboard(' 3');
    expect(el.querySelector('[data-testid="amount-result"]')!.textContent).toBe('= 15.00 USD');
    expect(input(el).getAttribute('aria-invalid')).toBeNull();
  });

  it('is reached and used with the keyboard alone', async () => {
    const el = mount('');
    await userEvent.tab();
    expect(document.activeElement).toBe(input(el));
  });
});
