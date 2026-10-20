import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { ERROR_KINDS, MESSAGES_EN, describeError, formatError, type AppError } from './catalogue';

const contract = readFileSync(resolve(import.meta.dirname, '../../../../../specs/001-secure-finance-core/contracts/core-api.md'), 'utf8');
const taxonomy = [...contract.slice(contract.indexOf('## Error taxonomy')).split('\n\n')[1]!.matchAll(/`([A-Z][A-Za-z]+)(?:\([^)]*\))?`/g)].map((m) => m[1]!);

describe('coverage of the error taxonomy in contracts/core-api.md', () => {
  it('the contract lists the errors the catalogue must cover', () => {
    expect(taxonomy.length).toBeGreaterThan(15);
  });

  it('has an entry for every error kind in the contract, and none that the contract does not know', () => {
    expect([...ERROR_KINDS].sort()).toEqual([...new Set(taxonomy)].sort());
  });

  it('every entry has a message in the English catalogue under its key', () => {
    for (const kind of ERROR_KINDS) expect(MESSAGES_EN[describeError({ kind } as AppError).key], kind).toBeTypeOf('string');
    expect(MESSAGES_EN[describeError({ kind: 'SomethingNew' } as never).key]).toBeTypeOf('string');
  });
});

describe('messages are plain language without content (FR-098)', () => {
  const all = Object.entries(MESSAGES_EN);

  it('are short, sentence-like and free of technical vocabulary', () => {
    for (const [key, message] of all) {
      expect(message.length, key).toBeLessThanOrEqual(360); // ICU source, longer than the text a person sees
      expect(message, key).toMatch(/^[A-Z]/);
      expect(message, key).toMatch(/[.!?]$/);
      expect(message, key).not.toMatch(/sqlite|stack|exception|undefined|\bnull\b|NaN|0x[0-9a-f]|AES|HKDF|Argon|HPKE|ed25519|x25519|\bCBOR\b|\bblob\b|\bnonce\b|\bAPI\b|HTTP|\b[45]\d\d\b|TypeError|RangeError/i);
    }
  });

  it('use only parameters that cannot carry names, notes, amounts or key material', () => {
    const allowed = new Set(['retryAfter', 'roleRequired', 'count', 'feature']);
    type Node = ReturnType<IntlMessageFormat['getAst']>[number];
    // Collects every argument name in the ICU message, including those nested in select/plural options.
    const names = (nodes: Node[]): string[] =>
      nodes.flatMap((node) => {
        const own = 'value' in node && typeof node.value === 'string' && node.type !== 0 ? [node.value] : [];
        const nested = 'options' in node ? Object.values(node.options).flatMap((o) => names(o.value)) : [];
        return [...own, ...nested];
      });
    for (const [key, message] of all) {
      const params = names(new IntlMessageFormat(message, 'en').getAst());
      for (const p of params) expect(allowed.has(p), `${key} uses {${p}}`).toBe(true);
    }
  });

  it('do not reveal whether an email exists or whether the password or the Secret Key was wrong (uniform sign-in failure)', () => {
    const msg = formatError({ kind: 'AuthFailed' });
    expect(msg).not.toMatch(/email|password|secret key|no account|not registered|incorrect password/i);
    expect(formatError({ kind: 'AuthFailed' })).toBe(msg);
  });
});

describe('describeError ignores everything except the error kind and a few validated parameters', () => {
  it('drops message text, amounts, names and any other property', () => {
    const hostile = { kind: 'InvalidAmount', message: 'Could not parse 12.50 USD for Alice', amount: 1250n, accountName: 'Savings', note: 'rent', stack: 'at x', secretKey: 'C1-AAAAAA' } as unknown as AppError;
    const text = formatError(hostile);
    expect(JSON.stringify(describeError(hostile))).not.toMatch(/12\.50|Alice|Savings|rent|stack|C1-/);
    expect(text).not.toMatch(/12|Alice|Savings|rent|C1-/);
  });

  it('validates parameters: retryAfter must be a non-negative safe integer, roles and features are closed sets', () => {
    expect(describeError({ kind: 'RateLimited', retryAfter: 30 }).params).toEqual({ retryAfter: 30 });
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 60, '30', null, undefined]) {
      expect(describeError({ kind: 'RateLimited', retryAfter: bad } as never).params, String(bad)).toEqual({});
    }
    expect(describeError({ kind: 'PermissionDenied', roleRequired: 'owner' }).params).toEqual({ roleRequired: 'owner' });
    expect(describeError({ kind: 'PermissionDenied', roleRequired: 'Bob the admin' } as never).params).toEqual({});
    expect(describeError({ kind: 'UnsupportedBrowser', feature: 'opfs' }).params).toEqual({ feature: 'opfs' });
    expect(describeError({ kind: 'UnsupportedBrowser', feature: 'my secret' } as never).params).toEqual({ feature: 'other' });
    expect(describeError({ kind: 'OwnsSharedFold', folds: ['a', 'b', 'c'] } as never).params).toEqual({ count: 3 });
  });

  it('formats the parameterised messages in plain words', () => {
    expect(formatError({ kind: 'RateLimited', retryAfter: 1 })).toMatch(/1 second\b/);
    expect(formatError({ kind: 'RateLimited', retryAfter: 45 })).toMatch(/45 seconds/);
    expect(formatError({ kind: 'PermissionDenied', roleRequired: 'editor' })).toMatch(/editor/);
    expect(formatError({ kind: 'OwnsSharedFold', folds: ['x'] } as never)).toMatch(/1 shared Fold\b/);
    expect(formatError({ kind: 'OwnsSharedFold', folds: ['x', 'y'] } as never)).toMatch(/2 shared Folds/);
    expect(formatError({ kind: 'UnsupportedBrowser', feature: 'opfs' })).toMatch(/private storage/);
  });

  it('falls back to a calm generic message for anything unknown, never echoing it', () => {
    const text = formatError({ kind: 'Boom: password=hunter2' } as never);
    expect(text).toBe(MESSAGES_EN['error.unknown']);
    expect(text).not.toContain('hunter2');
  });

  it('gives each kind a severity for styling and screen-reader roles', () => {
    expect(describeError({ kind: 'Offline' }).severity).toBe('info');
    expect(describeError({ kind: 'ServerTampering', kindDetail: 'x' } as never).severity).toBe('error');
    expect(describeError({ kind: 'Cancelled' }).severity).toBe('info');
  });
});
