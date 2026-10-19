import { describe, expect, it } from 'vitest';
import { MESSAGES_EN } from '../errors/catalogue';
import { IMPORT_PROBLEMS } from '../data/problems';
import en from '../i18n/messages/en.json' with { type: 'json' };
import { ACCOUNT_ERROR_CODES, accountErrorKey, accountErrorText } from './errors';

const messages: Record<string, string> = { ...MESSAGES_EN, ...en };

describe('account refusals', () => {
  it('every code has a sentence of its own', () => {
    for (const code of ACCOUNT_ERROR_CODES) expect(messages[accountErrorKey(code)], code).toBeTruthy();
    expect(messages[accountErrorKey('something_new')]).toBe(messages['account.error.generic']);
  });

  it('a password tried too often waits, and says for how long', () => {
    const t = (key: string, values?: Record<string, string | number>) => `${key}:${JSON.stringify(values ?? {})}`;
    expect(accountErrorText(t, { code: 'too_many_attempts', retryAfterMs: 29_500 })).toBe('unlock.error.too_many_attempts:{"seconds":30}');
    expect(accountErrorText(t, { code: 'wrong_password' })).toBe('account.error.wrong_password:{}');
  });

  it('every reason a CSV row can be refused has a sentence', () => {
    for (const code of IMPORT_PROBLEMS) expect(messages[`data.import.problem.${code}`], code).toBeTruthy();
  });
});
