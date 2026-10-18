import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkPassword, estimateStrength, MIN_PASSWORD_LENGTH } from './password-policy';

// FR-001: at least 12 characters after normalisation, and not in a common-password list.

const violations = (pw: string) => {
  const r = checkPassword(pw);
  return r.ok ? [] : r.violations;
};

describe('minimum length (12 characters after normalisation)', () => {
  it('is 12', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('rejects anything shorter, however varied', () => {
    expect(violations('aB3$xY9!qZ')).toEqual(['too_short']);
    expect(violations('')).toContain('too_short');
    expect(violations('x7!Qm2#Lp9z')).toEqual(['too_short']); // 11 characters
  });

  it('accepts exactly 12 characters', () => {
    expect(checkPassword('x7!Qm2#Lp9zK').ok).toBe(true);
  });

  it('ignores surrounding whitespace, as the key derivation does', () => {
    expect(violations('   x7!Qm2#Lp9z   ')).toEqual(['too_short']);
    expect(checkPassword('  x7!Qm2#Lp9zK  ').ok).toBe(true);
  });

  it('counts what a person sees as characters: composed accents, emoji and CJK each count once', () => {
    expect(checkPassword('éééééééééééé').ok).toBe(false); // 12 but trivially repetitive
    expect(violations('Å-x7Qm2Lp9z')).toEqual(['too_short']); // "Å" typed as A + ring is one character: 11 in total
    expect(checkPassword('Å-x7Qm2Lp9zK!').ok).toBe(true);
    expect(violations('🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑')).toContain('too_short'); // 11
    expect(checkPassword('密码很长很长很长很长很长很长').ok).toBe(true);
  });

  it('normalises compatibility forms before counting (full-width letters are ordinary letters)', () => {
    const fullWidth = 'ａｂｃｄｅｆｇｈｉｊｋｌ'; // twelve full-width letters = "abcdefghijkl"
    expect(violations(fullWidth)).toContain('too_common'); // and then caught as a sequence
  });
});

describe('common passwords', () => {
  it.each([
    'password1234', 'Password1234', 'PASSWORD123456', 'qwertyuiop12', 'qwerty123456', '123456789012', '1234567890123',
    'iloveyou1234', 'letmein12345', 'welcome12345', 'admin1234567', 'monkey123456', 'dragon123456', 'sunshine1234',
    'p@ssw0rd1234', 'P@ssw0rd!!!!', 'passw0rd2024', 'Password!2024', 'passwordpassword', 'password-password',
    'aaaaaaaaaaaa', 'abcdefghijkl', 'abcabcabcabc', '111111111111', 'qazwsxedcrfv', '1q2w3e4r5t6y',
    'football2024!', 'baseball12345', 'trustno1trustno1', 'changeme1234', 'cashfold1234', 'masterpassword',
  ])('rejects %s', (pw) => {
    expect(violations(pw)).toContain('too_common');
  });

  it.each([
    'correct horse battery staple', 'x7!Qm2#Lp9zK', 'my cat Zorro eats tuna at 7pm', 'Tr0ub4dor&3-xylophone-gamma',
    'blue-lamp-ferry-nine-cobalt', 'ZyX9$wvU8#tsR7', 'The 2nd mug of coffee tastes best',
  ])('accepts %s', (pw) => {
    expect(checkPassword(pw)).toMatchObject({ ok: true });
  });

  it('is not fooled by case, leetspeak, padding digits or symbols', () => {
    for (const pw of ['PaSsWoRd1234', 'p4$$w0rd1234', 'password!!!!!!', '!!password9999', '__letmein__123']) expect(violations(pw), pw).toContain('too_common');
  });

  it('reports both problems when there are two', () => {
    expect(violations('password')).toEqual(['too_short', 'too_common']);
  });

  it('never rejects a long random-looking password as common (no false positives on high-entropy input)', () => {
    fc.assert(fc.property(fc.string({ minLength: 16, maxLength: 40, unit: fc.constantFrom(...'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%&') }), (pw) => {
      const r = checkPassword(pw);
      // A random string could in principle collide with a rule (a repeat or a run), but not for these lengths and alphabets.
      fc.pre(!/(.)\1{3}/.test(pw));
      expect(r.ok).toBe(true);
    }), { numRuns: 200 });
  });
});

describe('strength estimate (for the sign-up meter)', () => {
  it('orders weak below strong', () => {
    const s = (pw: string) => estimateStrength(pw).score;
    expect(s('aaaaaaaaaaaa')).toBe(0);
    expect(s('password1234')).toBeLessThanOrEqual(1);
    expect(s('x7!Qm2#Lp9zK')).toBeGreaterThanOrEqual(2);
    expect(s('correct horse battery staple')).toBeGreaterThanOrEqual(3);
    expect(s('ZyX9$wvU8#tsR7qP4!mN2@')).toBe(4);
  });

  it('never decreases when characters are appended to a password that is not common', () => {
    fc.assert(fc.property(fc.string({ minLength: 12, maxLength: 24 }), fc.string({ minLength: 1, maxLength: 8 }), (base, extra) => {
      fc.pre(!/(.)\1{2}/.test(base + extra));
      expect(estimateStrength(base + extra).score).toBeGreaterThanOrEqual(estimateStrength(base).score);
    }), { numRuns: 100 });
  });

  it('gives content-free feedback keys for the interface to translate', () => {
    expect(estimateStrength('short').feedback).toContain('password.feedback.too_short');
    expect(estimateStrength('password1234').feedback).toContain('password.feedback.too_common');
    expect(estimateStrength('x7!Qm2#Lp9zK').feedback).toEqual([]);
    for (const key of estimateStrength('aaa').feedback) expect(key).toMatch(/^password\.feedback\.[a-z_]+$/);
  });

  it('does not echo the password anywhere in its result', () => {
    expect(JSON.stringify(estimateStrength('SuperSecretValue-42'))).not.toContain('Secret');
    expect(JSON.stringify(checkPassword('SuperSecretValue-42'))).not.toContain('Secret');
  });
});
