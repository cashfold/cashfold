import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_KINDS } from '@cashfold/core';
import { MESSAGES_EN } from '../errors/catalogue';
import en from '../i18n/messages/en.json' with { type: 'json' };
import { SHARING_ERROR_CODES } from '../sharing/errors';
import { COLOR_COUNT } from './palette';

const messages: Record<string, string> = { ...MESSAGES_EN, ...en };
const here = import.meta.dirname;
const coreLedger = resolve(here, '../../../../../packages/core/src/ledger');
const coreSync = resolve(here, '../../../../../packages/core/src/sync');
const coreBudgeting = resolve(here, '../../../../../packages/core/src/budgeting');
const coreScheduling = resolve(here, '../../../../../packages/core/src/scheduling');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('the ledger screens only use words that exist', () => {
  // Every screen and component of the interface except the kit (its components take their words from props).
  const screens = [...sources(resolve(here, '..'))].filter((f) => f.endsWith('.tsx') && !f.includes('/ui/kit/'));

  it('finds the screens', () => {
    expect(screens.length).toBeGreaterThanOrEqual(8);
  });

  it('every literal translation key is in the English catalogue', () => {
    const missing: string[] = [];
    for (const file of screens) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*(['"])((?:(?!\1).)+)\1/g)) {
        if (messages[m[2]!] === undefined) missing.push(`${file.split('/').pop()}: ${m[2]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every computed key has a message for each value it can take', () => {
    const wanted = [
      ...[...ACCOUNT_KINDS, 'expense', 'income', 'adjustment'].map((k) => `ledger.kind.${k}`),
      ...['pending', 'posted', 'void'].map((s) => `ledger.status.${s}`),
      ...['invalid_format', 'too_many_decimals', 'out_of_range', 'unknown_currency'].map((c) => `ledger.amount.${c}`),
      ...['invalid_rate_text', 'too_precise'].map((c) => `ledger.rate.${c}`),
      ...['invalid_degrees', 'too_precise', 'out_of_bounds'].map((c) => `ledger.place.${c}`),
      ...['this_month', 'last_month', 'this_year', 'last_30', 'all_time', 'custom'].map((p) => `ledger.dash.period.${p}`),
      ...Array.from({ length: COLOR_COUNT }, (_, i) => `ledger.color.${i}`),
      ...['expense', 'income'].map((d) => `ledger.categories.${d}`),
      ...['day', 'week', 'month', 'year', 'custom'].map((u) => `budgets.unit.${u}`),
      ...['day', 'week', 'month', 'year'].flatMap((u) => [`schedules.unit.${u}`, `schedules.every.${u}`]),
      ...['none', '0', '60', '1440'].map((r) => `schedules.reminder.${r}`),
      ...['active', 'achieved', 'overdue'].map((x) => `goals.status.${x}`),
      ...['owner', 'editor', 'viewer'].flatMap((r) => [`sharing.role.${r}`, `sharing.role.${r}.long`]),
      ...['full', 'from_join'].map((x) => `sharing.scope.${x}.short`),
      ...SHARING_ERROR_CODES.map((c) => `sharing.error.${c}`),
      ...['none', 'carry_positive', 'carry_all'].map((r) => `budgets.rollover.${r}`),
      ...['spent', 'limit', 'available', 'ratio'].map((m) => `budgets.mode.${m}`),
      ...['payee', 'tag'].flatMap((x) => ['title', 'new', 'edit', 'empty'].map((s) => `ledger.${x}.${s}`)),
    ];
    expect(wanted.filter((k) => messages[k] === undefined)).toEqual([]);
  });

  it('every error the ledger can report has a sentence', () => {
    const codes = new Set<string>();
    const files = [...sources(coreLedger), ...sources(coreBudgeting), ...sources(coreScheduling), join(coreSync, 'application/write-path.ts'), join(coreSync, 'application/buses.ts'), join(coreSync, 'domain/hlc.ts'), join(coreSync, 'domain/merge.ts')];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\berr\(\s*'([a-z_]+)'/g)) codes.add(m[1]!);
      for (const m of text.matchAll(/code: '([a-z_]+)'/g)) codes.add(m[1]!);
      for (const m of text.matchAll(/DomainError<([^>]+)>/g)) for (const c of m[1]!.matchAll(/'([a-z_]+)'/g)) codes.add(c[1]!);
    }
    expect(codes.size).toBeGreaterThan(40);
    expect([...codes].filter((c) => messages[`ledger.error.${c}`] === undefined).sort()).toEqual([]);
  });

  it('every refusal sharing can give has a sentence in the sharing words', () => {
    const codes = new Set<string>();
    const core = resolve(here, '../../../../../packages/core/src/sharing');
    const mine = (f: string) => /membership-|lookup-member|history-scope|local-wipe|op-authorisation/.test(f);
    for (const file of [...sources(core)].filter(mine)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\berr\(\s*'([a-z_]+)'/g)) codes.add(m[1]!);
      for (const m of text.matchAll(/\bfail\(\s*'([a-z_]+)'/g)) codes.add(m[1]!);
      for (const m of text.matchAll(/DomainError<([^>]+)>/g)) for (const c of m[1]!.matchAll(/'([a-z_]+)'/g)) codes.add(c[1]!);
    }
    codes.delete('code'); // the type `LogError['code']`, not a code
    expect(codes.size).toBeGreaterThan(20);
    expect([...codes].filter((c) => messages[`sharing.error.${c}`] === undefined).sort()).toEqual([]);
  });

  it('every repair finding and every reason an op can be set aside has a message for Needs attention', () => {
    const rules = readFileSync(join(coreLedger, 'application/repair-rules.ts'), 'utf8') + readFileSync(join(coreBudgeting, 'application/repair-rules.ts'), 'utf8') + readFileSync(join(coreScheduling, 'application/repair-rules.ts'), 'utf8');
    const kinds = new Set([...rules.matchAll(/finding\('([a-z_]+)'/g)].map((m) => m[1]!));
    for (const k of ['category_orphan', 'category_depth', 'category_cycle', 'category_direction_mismatch']) kinds.add(k);
    const ports = readFileSync(join(coreSync, 'ports/index.ts'), 'utf8');
    const reasons = [...ports.slice(ports.indexOf('export type SealFailureKind'), ports.indexOf('export type SealFailureKind') + 140).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
      .concat([...ports.slice(ports.indexOf('export type QuarantineReason')).split(';')[0]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
    const wanted = [...[...kinds].map((k) => `attention.${k}`), ...new Set(reasons).values()].map((k) => (k.startsWith('attention.') ? k : `attention.quarantined.${k}`));
    expect(wanted.length).toBeGreaterThan(8);
    expect(wanted.filter((k) => messages[k] === undefined)).toEqual([]);
  });

  it('every ledger message is valid ICU', () => {
    const bad: string[] = [];
    for (const [key, text] of Object.entries(messages)) {
      if (!key.startsWith('ledger.') && !key.startsWith('attention.')) continue;
      try {
        new IntlMessageFormat(text, 'en');
      } catch {
        bad.push(key);
      }
    }
    expect(bad).toEqual([]);
  });
});
