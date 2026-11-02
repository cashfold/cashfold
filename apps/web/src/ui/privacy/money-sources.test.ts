import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Privacy mode can only hide an amount that goes through the app's one money path (spec 016, research R8). This test reads the sources, like
// `ui/no-raw-controls.test.ts`, and fails when money is formatted somewhere new, so a screen added later cannot show a figure by accident.

const ui = resolve(import.meta.dirname, '..');
const src = resolve(ui, '..');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|browser\.test)\.(ts|tsx)$/.test(name)) yield path;
  }
}
const files = [...sources(src)];
const text = (file: string): string => readFileSync(file, 'utf8');
const rel = (file: string): string => relative(src, file);

/** The files allowed to turn a number into money text. `AmountInput` is a form field: it shows the real result of the sum being typed (forms always use real figures, spec 016 FR-012). */
const FORMATTERS: ReadonlySet<string> = new Set(['ui/ledger/format.ts', 'ui/ledger/LedgerProvider.tsx', 'ui/kit/amount.tsx', 'ui/desktop/ReminderService.tsx', 'ui/transactions/AmountInput.tsx']);

/**
 * `.money(` and `.signed(` calls (the ledger's strings) per file. A string cannot be revealed on its own, so new uses belong in an `<Amount>`. This table
 * can only go down: a file not listed here has none, and a higher count fails.
 */
const STRING_MONEY_CALLS: Readonly<Record<string, number>> = {};

describe('where money is turned into text', () => {
  it('finds the sources it is meant to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('formatMoney and formatSigned are used only by the formatters, the kit amount and the notification text', () => {
    const users = files.filter((f) => /\bformat(Money|Signed)\b/.test(text(f)) && !/^ui\/privacy\//.test(rel(f))).map(rel);
    expect(users.filter((f) => !FORMATTERS.has(f))).toEqual([]);
  });

  it('the ledger strings are used no more than before', () => {
    const counts: Record<string, number> = {};
    for (const file of files) {
      if (rel(file) === 'ui/ledger/LedgerProvider.tsx') continue;
      const n = (text(file).match(/\.(money|signed)\(/g) ?? []).length;
      if (n > 0) counts[rel(file)] = n;
    }
    for (const [file, n] of Object.entries(counts)) {
      expect(n, `${file} formats money with ledger.money or ledger.signed ${n} time(s); use <Amount> (or lower the table if you removed one)`).toBeLessThanOrEqual(STRING_MONEY_CALLS[file] ?? 0);
    }
  });

  it('a notification formats its amount with the real formatter, not the masked ledger string, so Privacy mode does not change it (spec 016, FR-017)', () => {
    const service = text(resolve(ui, 'desktop/ReminderService.tsx'));
    expect(service).toMatch(/formatAmount: \(minor, currency\) => formatMoney\(/);
    expect(service).not.toMatch(/ledger\.(money|signed)\(/);
  });

  it('no currency formatting through Intl anywhere', () => {
    const offenders = files.filter((f) => /style:\s*['"]currency['"]|currencyDisplay/.test(text(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the kit amount turns the figure into zeros before it draws it while masked (spec 018)', () => {
    const amount = text(resolve(ui, 'kit/amount.tsx'));
    const span = amount.slice(amount.indexOf('function AmountSpan'), amount.indexOf('function RevealableAmount'));
    const early = span.indexOf('if (masked)');
    expect(early).toBeGreaterThan(-1);
    const maskedBranch = span.slice(early, span.indexOf('return (', span.indexOf('return (', early) + 1));
    // The only place the formatted text is used in the masked branch is inside zeroed(...), and it is never rendered as text.
    expect(maskedBranch).toMatch(/zeroed\(figure\)/);
    expect(maskedBranch).not.toMatch(/\{text\}|\{figure\}/);
    // The revealing component never formats on its own.
    const revealing = amount.slice(amount.indexOf('function RevealableAmount'));
    expect(revealing).not.toMatch(/\bformat(Money|Signed)\(/);
  });

  it('forms and exports never use the masked ledger strings (spec 016, FR-012)', () => {
    const forms = ['ui/transactions/TransactionMode.tsx', 'ui/transactions/TransferMode.tsx', 'ui/accounts/AccountsScreen.tsx', 'ui/plan/GoalsView.tsx', 'ui/plan/BudgetsView.tsx', 'ui/plan/SchedulesView.tsx', 'ui/ledger/AmountField.tsx'];
    for (const form of forms) expect(text(resolve(src, form)), form).not.toMatch(/\.(money|signed)\(/);
  });
});
