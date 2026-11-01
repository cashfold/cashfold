import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { LedgerContext } from '../ledger/LedgerProvider';
import { loadAmountExpression, parseMoney } from '../ledger/format';
import { AmountInput } from './AmountInput';

await loadAmountExpression();

// The money input with sums (spec 020): the result in the note under the field, the error in the same place, and a plain number as before.

const ledger = { parse: (text: string, currency: string) => parseMoney(text, currency, 'en'), mathReady: true } as never;
const render = (value: string, props: Partial<Parameters<typeof AmountInput>[0]> = {}) =>
  renderToStaticMarkup(
    <I18nProvider>
      <LedgerContext.Provider value={ledger}>
        <AmountInput label="Amount" currency="USD" value={value} onChange={() => undefined} {...props} />
      </LedgerContext.Provider>
    </I18nProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, '');

describe('AmountInput with sums', () => {
  it('shows the usual hint and no result for a plain number, and for an empty field', () => {
    for (const value of ['', '12.50', '-5']) {
      const out = render(value);
      expect(out, value).not.toContain('data-testid="amount-result"');
      expect(text(out), value).toContain('Up to 2 decimal places. Nothing is rounded.');
    }
  });

  it('shows the result of a valid sum in a polite live region, in place of the hint', () => {
    const out = render('12.50 + 3.20 * 2 + 4');
    expect(out).toMatch(/<span aria-live="polite" aria-atomic="true" data-testid="amount-result">= 22\.90 USD<\/span>/);
    expect(text(out)).not.toContain('Nothing is rounded');
    expect(out).toContain('value="12.50 + 3.20 * 2 + 4"');
  });

  it('shows the result rounded once, as the sum is worked out', () => {
    expect(text(render('10 / 3'))).toContain('= 3.33 USD');
    expect(text(render('10 / 3 * 3'))).toContain('= 10.00 USD');
    expect(text(render('0.1 + 0.2'))).toContain('= 0.30 USD');
  });

  it('shows an error for a sum that cannot be worked out, and marks the field invalid', () => {
    for (const [value, message] of [['12 +', 'cannot be worked out'], ['abc + 1', 'cannot be worked out'], ['5 / 0', 'cannot divide by zero'], ['92233720368547758.07 + 0.01', 'too large']] as const) {
      const out = render(value);
      expect(text(out), value).toContain(message);
      expect(out, value).toContain('aria-invalid');
      expect(out, value).not.toContain('data-testid="amount-result"');
    }
  });

  it('keeps today\'s errors for a plain number', () => {
    expect(text(render('1.239'))).toContain('USD has 2 decimal places');
    expect(text(render('abc'))).toContain('Enter the amount using digits');
  });

  it('asks for the full keyboard, so the operators can be typed, and shows a sum as the example', () => {
    expect(render('')).toContain('inputMode="text"');
    expect(render('')).toContain('placeholder="e.g. 12.50 or 12.50 + 3.20 × 2"');
  });

  it('takes an error from outside when the text itself is fine, and works with no currency (a disabled filter)', () => {
    expect(text(render('5', { error: 'Minimum is above maximum' }))).toContain('Minimum is above maximum');
    const none = render('', { currency: '', disabled: true, hint: 'Choose an account first' });
    expect(text(none)).toContain('Amount');
    expect(text(none)).not.toContain('()');
    expect(none).toContain('disabled');
  });
});
