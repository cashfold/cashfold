import { COMMON_NUMERIC_RUNS, COMMON_PASSWORD_STEMS } from './common-passwords';

// FR-001: a password is accepted when it has at least 12 characters after normalisation and is not a common password.
// "Characters" are what a person sees: the trimmed password is composed (NFC after NFKC folding) and counted by code point.
// The same trimming is applied before key derivation (NFKD), so what is checked is what is used.

export const MIN_PASSWORD_LENGTH = 12;

export type PolicyViolation = 'too_short' | 'too_common';
export type Strength = { readonly score: 0 | 1 | 2 | 3 | 4; readonly feedback: readonly string[] };

export type PolicyResult =
  | { readonly ok: true; readonly strength: Strength }
  | { readonly ok: false; readonly violations: readonly PolicyViolation[]; readonly strength: Strength };

const STEMS = new Set(COMMON_PASSWORD_STEMS);
const NUMERIC = new Set(COMMON_NUMERIC_RUNS);
const MIN_STEM = 3;
const MAX_WORDS = 4;

const LEET: Readonly<Record<string, string>> = { '@': 'a', '4': 'a', '3': 'e', '0': 'o', '1': 'i', '$': 's', '5': 's', '7': 't' };

function fold(password: string): string {
  return password.trim().normalize('NFKC').normalize('NFC');
}

const codePoints = (s: string): string[] => Array.from(s);

/** True if `letters` is covered exactly by one to MAX_WORDS common stems. */
function coveredByStems(letters: string): boolean {
  if (letters.length < MIN_STEM) return false;
  const best = new Array<number>(letters.length + 1).fill(Infinity);
  best[0] = 0;
  for (let i = 0; i < letters.length; i++) {
    if (best[i] === Infinity) continue;
    for (let j = i + MIN_STEM; j <= Math.min(letters.length, i + 20); j++) {
      if (STEMS.has(letters.slice(i, j))) best[j] = Math.min(best[j]!, best[i]! + 1);
    }
  }
  return best[letters.length]! <= MAX_WORDS;
}

function isRepeatingUnit(s: string): boolean {
  const chars = codePoints(s);
  for (let period = 1; period <= 4; period++) {
    if (chars.length >= period * 3 && chars.every((c, i) => c === chars[i % period])) return true;
  }
  return false;
}

/** Ascending or descending runs (abcdef, 98765) covering most of the password. */
function isMostlyRun(s: string): boolean {
  const cps = codePoints(s).map((c) => c.codePointAt(0)!);
  if (cps.length < 6) return false;
  let longest = 1;
  for (const step of [1, -1]) {
    let run = 1;
    for (let i = 1; i < cps.length; i++) {
      run = cps[i]! - cps[i - 1]! === step ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
  }
  return longest >= cps.length * 0.7;
}

function isCommon(password: string): boolean {
  const s = fold(password).toLowerCase();
  if (s.length === 0) return false;
  if (isRepeatingUnit(s) || isMostlyRun(s)) return true;
  if (/^[0-9]+$/.test(s)) {
    const distinct = new Set(s).size;
    return NUMERIC.has(s) || distinct <= 3 || [...NUMERIC].some((n) => n.length >= 6 && s.includes(n)) || isMostlyRun(s);
  }
  const length = codePoints(s).length;
  // View A: the letters as typed. View B: padding stripped from both ends, then look-alikes undone (p@ssw0rd -> password).
  const stripped = s.replace(/^[\d\p{P}\p{S}\s]+|[\d\p{P}\p{S}\s]+$/gu, '');
  const views = [s, [...stripped].map((c) => LEET[c] ?? c).join('')];
  for (const view of views) {
    const letters = view.replace(/[^\p{L}]/gu, '');
    // Judge by stems when letters dominate, or when everything around them is a short run of digits and symbols
    // (admin1234567). A few stem-like letters buried in a long random string prove nothing.
    const mostlyLetters = codePoints(letters).length >= length * 0.5;
    if ((mostlyLetters || length - codePoints(letters).length <= 8) && coveredByStems(letters)) return true;
  }
  return false;
}

function charsetSize(s: string): number {
  let size = 0;
  if (/[a-z]/.test(s)) size += 26;
  if (/[A-Z]/.test(s)) size += 26;
  if (/[0-9]/.test(s)) size += 10;
  if (/[^a-zA-Z0-9\u0080-￿]/.test(s)) size += 33;
  if (/[\u0080-￿]/.test(s)) size += 100;
  return Math.max(size, 1);
}

/** A deliberately conservative estimate: repeated characters count half, and common passwords score zero. */
export function estimateStrength(password: string): Strength {
  const s = fold(password);
  const chars = codePoints(s);
  const feedback: string[] = [];
  if (chars.length < MIN_PASSWORD_LENGTH) feedback.push('password.feedback.too_short');
  const common = isCommon(password);
  if (common) feedback.push('password.feedback.too_common');

  const distinct = new Set(chars).size;
  const effective = distinct + 0.5 * (chars.length - distinct);
  const bits = effective * Math.log2(charsetSize(s));

  let score: 0 | 1 | 2 | 3 | 4 = bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (common) score = 0;
  else if (chars.length < MIN_PASSWORD_LENGTH && score > 1) score = 1;
  return { score, feedback };
}

export function checkPassword(password: string): PolicyResult {
  const violations: PolicyViolation[] = [];
  if (codePoints(fold(password)).length < MIN_PASSWORD_LENGTH) violations.push('too_short');
  if (isCommon(password)) violations.push('too_common');
  const strength = estimateStrength(password);
  return violations.length === 0 ? { ok: true, strength } : { ok: false, violations, strength };
}
