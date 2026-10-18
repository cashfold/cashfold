import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import noNumberInMoney from './eslint-rules/no-number-in-money.js';

const root = dirname(fileURLToPath(import.meta.url));

const MONEY_FILES = [
  '**/money/**',
  '**/ledger/**',
  '**/budgeting/**',
  '**/scheduling/**',
  '**/sync/**/patch*',
  'packages/protocol/src/**/*amount*',
  'apps/web/src/ui/**/*amount*',
  'packages/core/src/shared-kernel/{money,fx,rate,amount-text}.ts',
];

const dis = (from, to, message) => ({
  from: { element: { type: from } },
  disallow: { to: { element: { types: { anyOf: to } } } },
  message,
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/out/**', '**/node_modules/**', '**/coverage/**', 'vectors/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared-kernel', pattern: 'packages/core/src/shared-kernel/**', partialMatch: false },
        { type: 'domain', pattern: 'packages/core/src/*/domain/**', capture: ['context'], partialMatch: false },
        { type: 'ports', pattern: 'packages/core/src/*/ports/**', capture: ['context'], partialMatch: false },
        { type: 'application', pattern: 'packages/core/src/*/application/**', capture: ['context'], partialMatch: false },
        { type: 'core-testing', pattern: 'packages/core/src/testing/**', partialMatch: false },
        { type: 'core', pattern: 'packages/core/src/**', partialMatch: false },
        { type: 'crypto', pattern: 'packages/crypto/src/**', partialMatch: false },
        { type: 'protocol', pattern: 'packages/protocol/src/**', partialMatch: false },
        { type: 'web', pattern: 'apps/web/**', partialMatch: false },
        { type: 'server', pattern: 'apps/server/**', partialMatch: false },
      ],
      'import/resolver': { typescript: { noWarnOnMultipleProjects: true, project: [join(root, 'packages/*/tsconfig.json'), join(root, 'apps/*/tsconfig.json')] } },
      'boundaries/include': ['packages/**', 'apps/**'],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            dis('domain', ['application', 'ports', 'crypto', 'protocol', 'web', 'server'], 'domain may import only shared-kernel'),
            dis('shared-kernel', ['domain', 'application', 'ports', 'crypto', 'protocol', 'web', 'server'], 'shared-kernel is a leaf'),
            dis('application', ['web', 'server', 'crypto', 'protocol'], 'application depends on ports, not on crypto/protocol/apps'),
            dis('ports', ['web', 'server', 'crypto', 'protocol'], 'ports are plain interfaces'),
            dis('crypto', ['core', 'domain', 'application', 'ports', 'shared-kernel', 'web', 'server'], 'crypto never imports core'),
            dis('protocol', ['core', 'domain', 'application', 'ports', 'shared-kernel', 'crypto', 'web', 'server'], 'protocol imports nothing in the workspace'),
            dis('server', ['core', 'domain', 'application', 'ports', 'shared-kernel'], 'apps/server never imports core'),
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/core/src/testing/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'next', 'next/*', '@nestjs/*', 'node:*'] }],
    },
  },
  {
    files: MONEY_FILES,
    ignores: ['**/*.test.ts'],
    plugins: { cashfold: { rules: { 'no-number-in-money': noNumberInMoney } } },
    rules: { 'cashfold/no-number-in-money': 'error' },
  },
);
