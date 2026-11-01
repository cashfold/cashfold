import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import type { FieldValue } from './sync/domain/merge';
import { createCluster, createRng } from './testing/index';
import { id } from './testing/world';

// Architecture fitness functions (Constitution III): the dependency rules are checked by tests, not by habit.

const coreRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(coreRoot, '../..');
const srcRoot = resolve(coreRoot, 'src');

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (name.endsWith('.ts')) yield path;
  }
}

const isTestSupport = (file: string) => /\.test\.ts$/.test(file) || relative(srcRoot, file).startsWith('testing');
const productionFiles = [...sourceFiles(srcRoot)].filter((f) => !isTestSupport(f));

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:import|export)\s[^'";]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]!);
}

describe('dependency boundaries are enforced by lint (and the lint can fail)', () => {
  const eslint = new ESLint({ cwd: repoRoot });

  it('the whole core package passes the boundary rules', async () => {
    const results = await eslint.lintFiles(['packages/core/src/**/*.ts']);
    const violations = results.flatMap((r) => r.messages.map((m) => `${relative(repoRoot, r.filePath)}: ${m.ruleId}: ${m.message}`));
    expect(violations).toEqual([]);
  });

  it.each([
    ['domain importing application', 'packages/core/src/sync/domain/x.ts', "import { createWritePath } from '../application/write-path';\nexport const a = createWritePath;\n"],
    ['domain importing a port', 'packages/core/src/sync/domain/x.ts', "import type { OpLogStore } from '../ports/index';\nexport type A = OpLogStore;\n"],
    ['core importing React', 'packages/core/src/sync/application/x.ts', "import 'react';\n"],
    ['core importing a Node module', 'packages/core/src/sync/application/x.ts', "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n"],
  ])('flags %s', async (_name, filePath, code) => {
    const [result] = await eslint.lintText(code, { filePath: resolve(repoRoot, filePath) });
    expect(result!.messages.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });
});

describe('core stays framework-free', () => {
  const forbidden = /^(react|react-dom|next|@nestjs\/|node:|fs$|path$|crypto$|os$|child_process$|http$|https$|net$|zlib$|stream$|buffer$)/;

  it('production code imports nothing from React, Next, Nest or Node', () => {
    const offenders = productionFiles.flatMap((f) => importsOf(f).filter((i) => forbidden.test(i)).map((i) => `${relative(srcRoot, f)} -> ${i}`));
    expect(offenders).toEqual([]);
  });

  it('production code does not depend on the crypto or protocol packages (it talks to ports)', () => {
    const offenders = productionFiles.flatMap((f) => importsOf(f).filter((i) => i.startsWith('@cashfold/')).map((i) => `${relative(srcRoot, f)} -> ${i}`));
    expect(offenders).toEqual([]);
  });

  it('is compiled without the DOM library, so browser globals are a type error', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(coreRoot, 'tsconfig.json'), 'utf8')) as { compilerOptions: { lib?: string[]; types?: string[] } };
    const base = JSON.parse(readFileSync(resolve(repoRoot, 'tsconfig.base.json'), 'utf8')) as { compilerOptions: { lib: string[] } };
    const libs = (tsconfig.compilerOptions.lib ?? base.compilerOptions.lib).map((l) => l.toLowerCase());
    expect(libs.some((l) => l.includes('dom') || l.includes('webworker'))).toBe(false);
    expect(tsconfig.compilerOptions.types ?? []).toEqual([]);
  });

  it('production code never touches window, document or localStorage', () => {
    const offenders = productionFiles.filter((f) => /\b(window|document|localStorage|sessionStorage|indexedDB)\b/.test(readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')));
    expect(offenders.map((f) => relative(srcRoot, f))).toEqual([]);
  });

  it('the testing support and the sum evaluator are separate subpath exports, never re-exported from the package root', () => {
    const pkg = JSON.parse(readFileSync(resolve(coreRoot, 'package.json'), 'utf8')) as { exports: Record<string, string> };
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './amount-expression', './testing']);
    const root = readFileSync(resolve(srcRoot, 'index.ts'), 'utf8');
    expect(root).not.toMatch(/testing/);
    // The evaluator is its own chunk in the web app (spec 020): only the tiny check `isAmountExpression` is in the root.
    expect(root).not.toMatch(/shared-kernel\/amount-expression'/);
  });
});

describe('event sourcing: replaying the op log into empty projections equals the live projections', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i', async (seed) => {
    const rng = createRng(seed);
    const cluster = await createCluster({ replicas: 3 });
    for (let step = 0; step < 25; step++) {
      const i = rng.int(3);
      if (rng.chance(0.65)) {
        await cluster.edit(i, { rec: id(0x200 + rng.int(3)), table: 6, fields: new Map<number, FieldValue>([[1 + rng.int(3), BigInt(rng.int(100))], [4, `n${rng.int(9)}`]]), sets: new Map() });
      } else {
        await cluster.sync(i, { rng, duplicates: rng.chance(0.5) });
      }
    }
    await cluster.settle();
    for (const replica of cluster.replicas) {
      const live = await replica.projections.listRecords(cluster.fold);
      const report = await replica.writePath.rebuild(cluster.fold);
      expect(report).toMatchObject({ ok: true, value: { failed: 0 } });
      expect(await replica.projections.listRecords(cluster.fold)).toEqual(live);
    }
  });
});
