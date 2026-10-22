// The dependency rules for the desktop shell and its contract package (spec 003, Constitution III): `desktop` and `web` never import each other,
// `platform` is a leaf, and the domain packages know neither the shell nor the contract package.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.js') });

// Real files, so the import resolver can find them.
const TARGET = {
  desktop: 'apps/desktop/vitest.config.ts',
  platform: 'packages/platform/src/index.ts',
  web: 'apps/web/src/adapters/logger.ts',
  core: 'packages/core/src/index.ts',
  crypto: 'packages/crypto/src/index.ts',
  protocol: 'packages/protocol/src/index.ts',
  server: 'apps/server/src/config.ts',
};
const PROBE = {
  desktop: 'apps/desktop/src/main/probe.ts',
  platform: 'packages/platform/src/probe.ts',
  web: 'apps/web/src/adapters/probe.ts',
  core: 'packages/core/src/probe.ts',
  crypto: 'packages/crypto/src/probe.ts',
  protocol: 'packages/protocol/src/probe.ts',
  server: 'apps/server/src/probe.ts',
};

async function boundaryErrors(from, to) {
  const filePath = join(root, PROBE[from]);
  const spec = `${[...Array(filePath.slice(root.length + 1).split('/').length - 1)].map(() => '..').join('/')}/${TARGET[to]}`;
  const [result] = await eslint.lintText(`import x from '${spec.replace(/\.ts$/, '')}';\nexport default x;\n`, { filePath });
  return result.messages.filter((m) => m.ruleId === 'boundaries/dependencies');
}

describe('desktop shell dependency rules', () => {
  const forbidden = [
    ['web', 'desktop'],
    ['desktop', 'web'],
    ['desktop', 'core'],
    ['desktop', 'crypto'],
    ['desktop', 'protocol'],
    ['desktop', 'server'],
    ['platform', 'web'],
    ['platform', 'desktop'],
    ['platform', 'core'],
    ['platform', 'crypto'],
    ['platform', 'protocol'],
    ['platform', 'server'],
    ['core', 'platform'],
    ['core', 'desktop'],
    ['crypto', 'platform'],
    ['crypto', 'desktop'],
    ['protocol', 'platform'],
    ['protocol', 'desktop'],
    ['server', 'platform'],
    ['server', 'desktop'],
  ];
  for (const [from, to] of forbidden) {
    it(`${from} may not import ${to}`, async () => {
      expect(await boundaryErrors(from, to)).not.toHaveLength(0);
    });
  }

  const allowed = [
    ['web', 'platform'],
    ['desktop', 'platform'],
  ];
  for (const [from, to] of allowed) {
    it(`${from} may import ${to}`, async () => {
      expect(await boundaryErrors(from, to)).toHaveLength(0);
    });
  }
});
