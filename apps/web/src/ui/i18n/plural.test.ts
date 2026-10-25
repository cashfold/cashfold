import { describe, expect, it } from 'vitest';
import { argumentsOf } from './catalogue-check';
import { CATALOGS, createTranslator, ENGLISH, loadCatalogue } from './i18n';

// SC-003: a message with a count uses the right grammatical form in Ukrainian and Polish for 0, 1, 2, 5, 12, 22 and 100.

async function translator(locale: 'uk' | 'pl') {
  return createTranslator(locale, { ...CATALOGS, en: ENGLISH, [locale]: await loadCatalogue(locale) });
}

describe('plural forms from the real catalogues', () => {
  it('uk: scheduled entries waiting', async () => {
    const t = await translator('uk');
    const text = (count: number) => t('schedules.inbox.banner', { count });
    expect(text(0)).toBe('0 запланованих записів чекають на вас');
    expect(text(1)).toBe('1 запланований запис чекає на вас');
    expect(text(2)).toBe('2 заплановані записи чекають на вас');
    expect(text(5)).toBe('5 запланованих записів чекають на вас');
    expect(text(12)).toBe('12 запланованих записів чекають на вас');
    expect(text(21)).toBe('21 запланований запис чекає на вас');
    expect(text(22)).toBe('22 заплановані записи чекають на вас');
    expect(text(100)).toBe('100 запланованих записів чекають на вас');
  });

  it('pl: scheduled entries waiting', async () => {
    const t = await translator('pl');
    const text = (count: number) => t('schedules.inbox.banner', { count });
    expect(text(0)).toBe('0 zaplanowanych wpisów czeka na Ciebie');
    expect(text(1)).toBe('1 zaplanowany wpis czeka na Ciebie');
    expect(text(2)).toBe('2 zaplanowane wpisy czekają na Ciebie');
    expect(text(5)).toBe('5 zaplanowanych wpisów czeka na Ciebie');
    expect(text(12)).toBe('12 zaplanowanych wpisów czeka na Ciebie');
    expect(text(22)).toBe('22 zaplanowane wpisy czekają na Ciebie');
    expect(text(100)).toBe('100 zaplanowanych wpisów czeka na Ciebie');
  });

  it('uk and pl: transaction counts, with a special word for none', async () => {
    const uk = await translator('uk');
    const pl = await translator('pl');
    const ukText = (count: number) => uk('ledger.tx.count', { count });
    const plText = (count: number) => pl('ledger.tx.count', { count });
    expect([0, 1, 2, 5, 12, 22, 100].map(ukText)).toEqual(['Немає транзакцій', '1 транзакція', '2 транзакції', '5 транзакцій', '12 транзакцій', '22 транзакції', '100 транзакцій']);
    expect([0, 1, 2, 5, 12, 22, 100].map(plText)).toEqual(['Brak transakcji', '1 transakcja', '2 transakcje', '5 transakcji', '12 transakcji', '22 transakcje', '100 transakcji']);
  });

  it('uk and pl: days left, with the verb agreeing with the number', async () => {
    const uk = await translator('uk');
    const pl = await translator('pl');
    expect([1, 2, 5, 22].map((days) => uk('ledger.deleted.daysLeft', { days }))).toEqual(['Залишився 1 день', 'Залишилося 2 дні', 'Залишилося 5 днів', 'Залишилося 22 дні']);
    expect([1, 2, 5, 22].map((days) => pl('ledger.deleted.daysLeft', { days }))).toEqual(['Został 1 dzień', 'Zostały 2 dni', 'Zostało 5 dni', 'Zostały 22 dni']);
  });

  it('uk: the exact one-person sentence is not used for 21 members', async () => {
    const uk = await translator('uk');
    const text = (memberCount: number) => uk('folds.delete.consequence', { name: 'Дім', memberCount });
    expect(text(1)).toContain('Це бачите лише ви.');
    expect(text(21)).toContain('Доступ втратить 21 учасник.');
    expect(text(3)).toContain('Доступ втратять 3 учасники.');
    expect(text(7)).toContain('Доступ втратять 7 учасників.');
  });

  it('uk and pl: every count message gives text without a leftover brace for every tested count', async () => {
    for (const locale of ['uk', 'pl'] as const) {
      const t = await translator(locale);
      const catalogue = await loadCatalogue(locale);
      for (const [key, value] of Object.entries(catalogue)) {
        const { all, counts } = argumentsOf(value, locale);
        if (counts.size === 0) continue;
        for (const n of [0, 1, 2, 5, 12, 22, 100]) {
          const values = Object.fromEntries([...all].map((name) => [name, counts.has(name) ? n : 'X']));
          const text = t(key, values);
          expect(text, `${locale} ${key} ${n}`).not.toMatch(/[{}]/);
          expect(text, `${locale} ${key} ${n}`).not.toBe(key);
          expect(text, `${locale} ${key} ${n}`).not.toMatch(/#/);
        }
      }
    }
  });
});
