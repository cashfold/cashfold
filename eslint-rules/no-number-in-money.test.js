import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rule from './no-number-in-money.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run('no-number-in-money', rule, {
  valid: [
    'const count = 3;',
    'const index: number = 0;',
    'const timeoutMs: number = 5000;',
    'const amount: bigint = 100n;',
    'interface Entry { amountMinor: bigint }',
    'const hex = 0xff;',
  ],
  invalid: [
    { code: 'const x = 1.5;', errors: [{ messageId: 'floatLiteral' }] },
    { code: 'const x = 1e3;', errors: [{ messageId: 'floatLiteral' }] },
    { code: 'parseFloat("1.2");', errors: [{ messageId: 'parseFloat' }] },
    { code: 'Number.parseFloat("1.2");', errors: [{ messageId: 'parseFloat' }] },
    { code: 'const y = Math.round(x);', errors: [{ messageId: 'math' }] },
    { code: 'function f(balance: number) {}', errors: [{ messageId: 'moneyNumber' }] },
    { code: 'interface E { totalMinor: number }', errors: [{ messageId: 'moneyNumber' }] },
    { code: 'class C { rate: number = 1 }', errors: [{ messageId: 'moneyNumber' }] },
    { code: 'const amount = 10;', errors: [{ messageId: 'moneyNumber' }] },
  ],
});
