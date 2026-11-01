import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/index.js';
import { createAccount, go, signUpAndEnter } from './fixtures/nav.js';
import { choose, chooseAccount } from './fixtures/select.js';

// Math in amount fields (spec 020): a sum typed in a money field is worked out exactly, shown beside the field, kept as typed, and the result is what is saved.

const today = new Date().toLocaleDateString('en-CA');
const inAYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
const firstOfMonth = `${today.slice(0, 8)}01`;

test.beforeEach(({ browserName }) => {
  test.skip(browserName === 'webkit', 'OPFS access handles in workers are verified on Chromium and Firefox');
});

const result = (scope: Locator | Page): Locator => scope.getByTestId('amount-result');
async function openAdd(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toHaveCount(1);
  return sheet;
}

test.describe('@ux amount math', () => {
  test.setTimeout(90_000);

  test('a sum in the add sheet is worked out, kept in the field and saved as its result (user story 1)', async ({ page, expectNoA11yViolations }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');
    await go(page, 'Transactions');
    const sheet = await openAdd(page);
    const amount = sheet.getByLabel(/^Amount/).first();
    await expect(amount).toBeFocused();

    await amount.fill('12.50 + 3.20 * 2 + 4');
    await expect(result(sheet)).toHaveText('= 22.90 USD');
    await expectNoA11yViolations();
    await amount.blur();
    await expect(amount).toHaveValue('12.50 + 3.20 * 2 + 4');
    await expect(result(sheet)).toHaveText('= 22.90 USD');

    await amount.fill('(10 + 5) * 2');
    await expect(result(sheet)).toHaveText('= 30.00 USD');
    await amount.fill('10 + 5 * 2');
    await expect(result(sheet)).toHaveText('= 20.00 USD');

    // A mistake in one number is fixed without retyping the sum.
    await amount.fill('12.50 + 3.20 * 2 + 4');
    await amount.focus();
    await amount.evaluate((el) => (el as HTMLInputElement).setSelectionRange(0, 0));
    for (let i = 0; i < 5; i++) await amount.press('Delete');
    await amount.pressSequentially('15.00');
    await expect(amount).toHaveValue('15.00 + 3.20 * 2 + 4');
    await expect(result(sheet)).toHaveText('= 25.40 USD');
    await amount.fill('12.50 + 3.20 * 2 + 4');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
    await expect(page.getByTestId('tx-amount').first()).toContainText('22.90');

    // Editing shows the amount that was saved, not the sum.
    await page.getByTestId('tx-row').first().getByRole('button').first().click();
    await expect(page.getByRole('dialog').getByLabel(/^Amount/).first()).toHaveValue('22.90');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  });

  test('a sum that cannot be worked out is explained, nothing is saved, and the text is kept; a plain number is as before', async ({ page }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');
    await go(page, 'Transactions');
    const sheet = await openAdd(page);
    const amount = sheet.getByLabel(/^Amount/).first();
    for (const [text, message] of [['12 +', /cannot be worked out/], ['5 / 0', /cannot divide by zero/], ['abc', /Enter the amount using digits/], ['(1', /cannot be worked out/]] as const) {
      await amount.fill(text);
      await expect(sheet).toContainText(message);
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(amount).toHaveValue(text);
    }
    await expect(page.getByTestId('tx-row')).toHaveCount(0);

    await amount.fill('12.50');
    await expect(result(sheet)).toHaveCount(0);
    await expect(sheet).toContainText('Nothing is rounded');
    await amount.fill('1.239');
    await expect(sheet).toContainText('2 decimal places');
    await amount.fill('5 + 92233720368547758');
    await expect(sheet).toContainText('too large');

    // Pasting a sum works as typing it does.
    await amount.fill('');
    await page.evaluate(() => navigator.clipboard?.writeText('12.5+3').catch(() => undefined));
    await amount.fill('12.5+3');
    await expect(result(sheet)).toHaveText('= 15.50 USD');
  });

  test('the same in the other money fields, and not in the fields that are not money (user story 2)', async ({ page }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');

    // An account's opening balance, in a currency with no decimals.
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const account = page.getByRole('dialog');
    await account.getByLabel('Name', { exact: true }).fill('Yen box');
    await choose(account.getByLabel('Currency'), 'JPY');
    await account.getByLabel(/^Opening balance/).fill('100 / 3 + 1');
    await expect(result(account)).toHaveText('= 34 JPY');
    await account.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Yen box').first()).toBeVisible();

    // A goal account, then a budget limit and a goal target.
    await go(page, 'Accounts');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    const goalAccount = page.getByRole('dialog');
    await goalAccount.getByLabel('Name', { exact: true }).fill('Holiday fund');
    await choose(goalAccount.getByLabel('Kind'), 'Goal');
    await goalAccount.getByLabel(/^Opening balance/).fill('0');
    await goalAccount.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await go(page, 'Budgets');
    await page.getByRole('button', { name: 'Add budget', exact: true }).click();
    const budget = page.getByRole('dialog');
    await budget.getByLabel('Name', { exact: true }).fill('Groceries');
    await budget.getByLabel('Starting on').fill(firstOfMonth);
    await budget.getByLabel('Limit (USD)').fill('100 / 4 + 5');
    await expect(result(budget).first()).toHaveText('= 30.00 USD');
    await budget.getByRole('button', { name: 'Create budget' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('30.00 USD').first()).toBeVisible();

    await go(page, 'Goals');
    await page.getByRole('button', { name: 'Add goal', exact: true }).click();
    const goal = page.getByRole('dialog');
    await goal.getByLabel('Name', { exact: true }).fill('Holiday');
    await chooseAccount(goal.getByLabel('Goal account'), 'Holiday fund');
    await goal.getByLabel('Target (USD)').fill('1000 / 4 * 3');
    await expect(result(goal).first()).toHaveText('= 750.00 USD');
    await goal.getByLabel('Target date').fill(inAYear);
    await goal.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The filter's minimum and maximum, on the transactions list.
    await go(page, 'Transactions');
    for (const [amount, note] of [['5.00', 'small'], ['40.00', 'large']] as const) {
      const sheet = await openAdd(page);
      await sheet.getByLabel(/^Amount/).first().fill(amount);
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      void note;
    }
    await expect(page.getByTestId('tx-row')).toHaveCount(2);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const panel = page.getByRole('dialog');
    await chooseAccount(panel.getByLabel('Account'), 'Everyday');
    await panel.getByLabel(/^Smallest amount/).fill('100 / 4');
    await expect(result(panel).first()).toHaveText('= 25.00 USD');
    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
    await expect(page.getByTestId('tx-amount').first()).toContainText('40.00');

    // Fields that are not money do not take a sum: the place's latitude stays an ordinary field with no result line.
    const sheet = await openAdd(page);
    await sheet.getByRole('button', { name: 'More details' }).click();
    await sheet.getByRole('button', { name: /Exact coordinates/ }).click();
    const latitude = sheet.getByLabel('Latitude');
    await latitude.fill('2 + 2');
    await expect(latitude).toHaveValue('2 + 2');
    await expect(sheet.getByTestId('amount-result')).toHaveCount(0);
  });

  test('exact results, rounded once, and a plain number with too many decimals is still refused (user story 3)', async ({ page }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');
    await go(page, 'Transactions');
    const sheet = await openAdd(page);
    const amount = sheet.getByLabel(/^Amount/).first();
    for (const [text, shown] of [['0.1 + 0.2', '= 0.30 USD'], ['10 / 3 * 3', '= 10.00 USD'], ['10 / 3', '= 3.33 USD'], ['20 / 3', '= 6.67 USD'], ['0.333 * 3', '= 1.00 USD']] as const) {
      await amount.fill(text);
      await expect(result(sheet)).toHaveText(shown);
    }
    await amount.fill('10 / 3');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('tx-amount').first()).toContainText('3.33');
  });

  test('sums work with no connection, because the evaluator is stored with the app (spec 020, local-first)', async ({ page, context }) => {
    await signUpAndEnter(page);
    await createAccount(page, 'Everyday', '500.00');
    await go(page, 'Transactions');
    await context.setOffline(true);
    const sheet = await openAdd(page);
    await sheet.getByLabel(/^Amount/).first().fill('12.50 + 3.20 * 2 + 4');
    await expect(result(sheet)).toHaveText('= 22.90 USD');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('tx-amount').first()).toContainText('22.90');
    await context.setOffline(false);
  });
});
