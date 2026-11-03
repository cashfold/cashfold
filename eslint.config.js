import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import noNumberInMoney from './eslint-rules/no-number-in-money.js';
import uiKit from './eslint-rules/ui-kit-boundaries.js';

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
  { ignores: ['**/dist/**', '**/.next/**', '**/out/**', '**/node_modules/**', '**/coverage/**', 'vectors/**', 'apps/web/public/sqlite3mc/**', 'apps/desktop/release/**'] },
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
        { type: 'platform', pattern: 'packages/platform/src/**', partialMatch: false },
        { type: 'web', pattern: 'apps/web/**', partialMatch: false },
        { type: 'desktop', pattern: 'apps/desktop/**', partialMatch: false },
        { type: 'server', pattern: 'apps/server/**', partialMatch: false },
      ],
      'import/resolver': { typescript: { noWarnOnMultipleProjects: true, project: [join(root, 'packages/*/tsconfig.json'), join(root, 'apps/*/tsconfig.json')] } },
      'boundaries/root-path': root,
      'boundaries/include': ['packages/**', 'apps/**'],
      // Tests may use real crypto and the test world; production code is held to the boundaries.
      'boundaries/ignore': ['**/*.test.ts', '**/testing/**'],
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
            // The desktop shell and its contract package (spec 003): the shell knows neither the web app nor the domain, the contract package
            // is a leaf, and nothing below the apps knows the shell.
            dis('platform', ['core', 'domain', 'application', 'ports', 'shared-kernel', 'crypto', 'protocol', 'web', 'server', 'desktop'], 'platform is a leaf: it imports nothing in the workspace'),
            dis('desktop', ['core', 'domain', 'application', 'ports', 'shared-kernel', 'crypto', 'protocol', 'web', 'server'], 'apps/desktop imports only platform (the shell knows nothing of the app or the domain)'),
            dis('web', ['desktop'], 'apps/web never imports apps/desktop'),
            ...['core', 'domain', 'application', 'ports', 'shared-kernel', 'crypto', 'protocol', 'server'].map((from) => dis(from, ['platform', 'desktop'], `${from} does not know the desktop shell or its contract`)),
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/core/src/testing/**'],
    rules: {
      // Cryptography stays in packages/crypto, behind its ports (constitution VIII): `core` gets it as a port, never from a library.
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'next', 'next/*', '@nestjs/*', 'node:*', '@noble/*', 'hash-wasm'] }],
    },
  },
  {
    // Cryptography lives in packages/crypto, behind narrow ports (constitution VIII, docs/ARCHITECTURE.md 5). Feature code asks a port for what it
    // needs; it does not reach for WebCrypto or a primitive library, because that is how a second, unreviewed implementation starts.
    files: ['apps/**/*.{ts,tsx}', 'packages/core/**/*.ts', 'packages/protocol/**/*.ts', 'packages/platform/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.browser.test.tsx', '**/testing/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='subtle']",
          message: 'WebCrypto (`crypto.subtle`) is used only inside packages/crypto: ask one of its ports (Aead, Kdf, Hpke, Signer, ...) instead.',
        },
      ],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/protocol/**/*.ts', 'packages/platform/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.browser.test.tsx', '**/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@noble/*', 'hash-wasm'], message: 'Cryptographic primitives are imported only inside packages/crypto: use its ports.' }] },
      ],
    },
  },
  {
    // The two uses outside the crypto package, neither of which handles a secret:
    //  - the offline worker hashes the public static files it caches, to check them against the published manifest (sw/core.ts);
    //  - the browser check before sign-in asks whether `crypto.subtle` exists, and never calls it (ui/support/detect.ts).
    files: ['apps/web/src/sw/core.ts', 'apps/web/src/ui/support/detect.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // The Core Worker and the offline worker run where `window` and `document` do not exist. The TypeScript project includes the DOM library (the
    // page code needs it), so a mistake compiles and fails only at run time, in the browser. These names are errors here instead. Only files
    // that run in a worker are listed: sw/register.ts and sw/update-state.ts run in the page, where `window` is right.
    files: ['apps/web/src/worker/**/*.ts', 'apps/web/src/sw/service-worker.ts', 'apps/web/src/sw/core.ts'],
    ignores: ['**/*.test.ts', '**/*.browser.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt'].map((name) => ({
          name,
          message: `\`${name}\` does not exist in a worker (apps/web/src/worker and the offline worker run outside the page). Do the page-side work in apps/web/src/ui and pass the result in a message.`,
        })),
      ],
    },
  },
  {
    files: MONEY_FILES,
    ignores: ['**/*.test.ts'],
    plugins: { cashfold: { rules: { 'no-number-in-money': noNumberInMoney } } },
    rules: { 'cashfold/no-number-in-money': 'error' },
  },
  {
    // The interface is built from the kit (R-UX-03): every screen uses its components, never the bare elements.
    files: ['apps/web/src/ui/**/*.tsx', 'apps/web/src/app/**/*.tsx'],
    ignores: ['apps/web/src/ui/kit/**', '**/*.test.tsx'],
    plugins: { 'ui-kit': { rules: uiKit } },
    rules: { 'ui-kit/no-headless-outside-kit': 'error', 'ui-kit/no-raw-controls': 'error', 'ui-kit/no-name-on-headless': 'error' },
  },
);
