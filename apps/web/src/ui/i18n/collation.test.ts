import { describe, expect, it } from 'vitest';
import { includesLetters, sortedByName } from './collation';

const names = (list: readonly { name: string }[]) => list.map((x) => x.name);

describe('names in the order of the language', () => {
  it('Polish puts Ł, Ż and Ś where they belong, not after Z', () => {
    const input = ['Zakupy', 'Łódź', 'Lato', 'Żywność', 'Sklep', 'Świat', 'Zebra'].map((name) => ({ name }));
    expect(names(sortedByName(input, 'pl'))).toEqual(['Lato', 'Łódź', 'Sklep', 'Świat', 'Zakupy', 'Zebra', 'Żywność']);
    // the code-unit order core uses would have put Ł, Ś and Ż after Z
    expect(names([...input].sort((a, b) => (a.name < b.name ? -1 : 1)))).toEqual(['Lato', 'Sklep', 'Zakupy', 'Zebra', 'Łódź', 'Świat', 'Żywność']);
  });

  it('Ukrainian puts Ї and Є in the alphabet, not after Я', () => {
    const input = ['Яблука', 'Їжа', 'Іграшки', 'Єдність', 'Дім', 'Ґанок', 'Гроші'].map((name) => ({ name }));
    expect(names(sortedByName(input, 'uk'))).toEqual(['Гроші', 'Ґанок', 'Дім', 'Єдність', 'Іграшки', 'Їжа', 'Яблука']);
  });

  it('keeps the incoming order for names that compare equal, and numbers in their natural order', () => {
    const input = [{ name: 'Café', id: 1 }, { name: 'Café', id: 2 }];
    expect(sortedByName(input, 'pl').map((x) => x.id)).toEqual([1, 2]);
    expect(names(sortedByName(['Konto 10', 'Konto 2'].map((name) => ({ name })), 'pl'))).toEqual(['Konto 2', 'Konto 10']);
  });
});

describe('finding names', () => {
  it('finds without regard to case or accents', () => {
    expect(includesLetters('Łódź', 'lodz')).toBe(true);
    expect(includesLetters('Żywność', 'ZYW')).toBe(true);
    expect(includesLetters('Їжа та напої', 'ї')).toBe(true);
    expect(includesLetters('Їжа та напої', 'і')).toBe(true); // typed on a keyboard without the letter
    expect(includesLetters('Groceries', 'cer')).toBe(true);
    expect(includesLetters('Groceries', 'xyz')).toBe(false);
    expect(includesLetters('anything', '  ')).toBe(true);
  });
});
