import { describe, expect, it } from 'vitest';
import { match } from './fuzzy';

const marked = (target: string, query: string): string | undefined => {
  const m = match(query, target);
  if (m === undefined) return undefined;
  let out = '';
  let at = 0;
  for (const [a, b] of m.ranges) {
    out += `${target.slice(at, a)}[${target.slice(a, b)}]`;
    at = b;
  }
  return out + target.slice(at);
};

describe('the palette matcher', () => {
  it('matches letters that are in order but not next to each other', () => {
    expect(marked('Checking', 'chk')).toBe('[Ch]ec[k]ing');
    expect(match('kch', 'Checking')).toBeUndefined();
  });

  it('ignores case and accents', () => {
    expect(marked('Café', 'cafe')).toBe('[Café]');
    expect(marked('CAFÉ', 'CaFe')).toBe('[CAFÉ]');
    expect(marked('zażółć', 'zazolc')).toBe('[zażółć]');
    expect(marked('Ідея', 'ід')).toBe('[Ід]ея');
    expect(marked('Йога', 'и')).toBe('[Й]ога');
    expect(marked('Łódź', 'lodz')).toBe('[Łódź]');
  });

  it('reports ranges in the original text and merges neighbours', () => {
    const m = match('gro', 'Groceries')!;
    expect(m.ranges).toEqual([[0, 3]]);
    expect(marked('Go to Settings', 'gos')).toBe('[Go] to [S]ettings');
  });

  it('keeps ranges correct across characters that are two code units long', () => {
    expect(marked('💰 Savings', 'sav')).toBe('💰 [Sav]ings');
  });

  it('ignores spaces in the query', () => {
    expect(marked('Add transaction', 'add tr')).toBe('[Add] [tr]ansaction');
  });

  it('ranks a prefix above a word start above scattered letters', () => {
    const prefix = match('sav', 'Savings')!.score;
    const word = match('sav', 'My savings')!.score;
    const scattered = match('sav', 'Cash and visa')!.score;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(scattered);
  });

  it('prefers a shorter target when the quality is equal', () => {
    expect(match('sav', 'Savings')!.score).toBeGreaterThan(match('sav', 'Savings and more')!.score);
  });

  it('matches everything with score 0 for an empty query, and nothing when the query is longer than the target', () => {
    expect(match('', 'Anything')).toEqual({ score: 0, ranges: [] });
    expect(match('   ', 'Anything')).toEqual({ score: 0, ranges: [] });
    expect(match('abcdef', 'abc')).toBeUndefined();
  });

  it('finds the best placement, not just the first', () => {
    // The first "a" and "b" are scattered inside one word; the pair that starts a word and sits together is the better match.
    expect(marked('xaxb ab', 'ab')).toBe('xaxb [ab]');
  });

  it('always scores a match above zero', () => {
    expect(match('z', 'a very long target with a z at the very end of it, far from the start of the text')!.score).toBeGreaterThan(0);
  });
});
