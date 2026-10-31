import type { Reminder } from '@cashfold/core';
import { describe, expect, it, vi } from 'vitest';
import { forgetShownReminders } from './browser';
import { showDueReminders, SUMMARY_TAG, textFor, type NotifyDeps } from './notify';

const reminder = (key: string, over: Partial<Reminder> = {}): Reminder => ({
  key, scheduleId: 's' as never, name: 'Rent', n: 0, localDate: 20_260_310 as never, fireAtMs: 0, requiresConfirmation: false,
  template: { kind: 'transaction', direction: 'expense', accountId: 'a' as never, amountMinor: -123_456n, categoryId: null, payeeId: null, tagIds: [], note: 'secret note' }, ...over,
});

function deps(over: Partial<NotifyDeps> = {}): NotifyDeps & { shown: Array<{ title: string; body: string; tag: string }>; remembered: string[] } {
  const shown: Array<{ title: string; body: string; tag: string }> = [];
  const remembered: string[] = [];
  const seen = new Set<string>();
  return {
    shown, remembered,
    permission: () => 'granted', show: (t) => void shown.push(t), alreadyShown: () => seen, remember: (k) => void remembered.push(...k),
    copy: { title: (n) => `Due: ${n}`, body: (d) => `On ${d}`, bodyWithAmount: (d, a) => `On ${d}: ${a}`, generic: { title: 'Cashfold has a reminder', body: 'Open Cashfold to see it.' } },
    details: false, amounts: false, formatDate: (d) => `D${d}`, formatAmount: (m, c) => `${m} ${c}`, currencyOf: () => 'USD', ...over,
  };
}

const GENERIC = { title: 'Cashfold has a reminder', body: 'Open Cashfold to see it.' };

describe('reminder notifications', () => {
  it('say only that something needs attention by default: no name, no day, no amount, no note (spec 016)', () => {
    const t = textFor(reminder('k'), deps());
    expect(t).toEqual(GENERIC);
    expect(JSON.stringify(t)).not.toMatch(/Rent|D2026|123456|1234\.56|secret/);
  });

  it('say the same for a transfer, and for an unknown account', () => {
    const transfer = reminder('k', { template: { kind: 'transfer', fromAccountId: 'a' as never, toAccountId: 'b' as never, fromAmountMinor: 500n, toAmountMinor: 450n, note: '' } });
    expect(textFor(transfer, deps())).toEqual(GENERIC);
    expect(textFor(reminder('k'), deps({ currencyOf: () => undefined }))).toEqual(GENERIC);
  });

  it('name the schedule and the day, and no amount or note, when details are on', () => {
    const t = textFor(reminder('k'), deps({ details: true }));
    expect(t).toEqual({ title: 'Due: Rent', body: 'On D20260310' });
    expect(JSON.stringify(t)).not.toMatch(/123456|1234\.56|secret/);
  });

  it('add the amount, positive, only when details and amounts are both on', () => {
    expect(textFor(reminder('k'), deps({ details: true, amounts: true })).body).toBe('On D20260310: 123456 USD');
    expect(textFor(reminder('k', { template: { kind: 'transfer', fromAccountId: 'a' as never, toAccountId: 'b' as never, fromAmountMinor: 500n, toAmountMinor: 450n, note: '' } }), deps({ details: true, amounts: true })).body).toBe('On D20260310: 500 USD');
  });

  it('never show an amount when details are off, even if amounts are on', () => {
    expect(textFor(reminder('k'), deps({ details: false, amounts: true }))).toEqual(GENERIC);
  });

  it('fall back to no amount when the account is unknown', () => {
    expect(textFor(reminder('k'), deps({ details: true, amounts: true, currencyOf: () => undefined })).body).toBe('On D20260310');
  });

  it('show one reminder generically by default, once, and remember it', async () => {
    const d = deps();
    expect(await showDueReminders([reminder('a')], d)).toBe(1);
    expect(d.shown).toEqual([{ ...GENERIC, tag: 'a' }]);
    expect(d.remembered).toEqual(['a']);
    const again = deps({ alreadyShown: () => new Set(['a']) });
    expect(await showDueReminders([reminder('a'), reminder('c')], again)).toBe(1);
    expect(again.shown.map((s) => s.tag)).toEqual(['c']);
  });

  it('show one reminder as itself when details are on', async () => {
    const d = deps({ details: true });
    await showDueReminders([reminder('a')], d);
    expect(d.shown).toEqual([{ title: 'Due: Rent', body: 'On D20260310', tag: 'a' }]);
  });

  it('show several that came due together as one generic summary with no count, whatever the settings, and remember every one of them', async () => {
    for (const settings of [{}, { details: true }, { details: true, amounts: true }]) {
      const d = deps(settings);
      expect(await showDueReminders([reminder('a'), reminder('b'), reminder('c')], d)).toBe(3);
      expect(d.shown).toEqual([{ ...GENERIC, tag: SUMMARY_TAG }]);
      expect(d.remembered).toEqual(['a', 'b', 'c']);
      expect(JSON.stringify(d.shown)).not.toMatch(/\b3\b|Rent|123456|secret/);
    }
  });

  it('keep the 60-second cadence free of repeats: what was summarised is not shown again', async () => {
    const d = deps({ alreadyShown: () => new Set(['a', 'b', 'c']) });
    expect(await showDueReminders([reminder('a'), reminder('b'), reminder('c')], d)).toBe(0);
    expect(d.shown).toEqual([]);
  });

  it('follow the language of the copy it is given', () => {
    const polish = { title: (n: string) => `Termin: ${n}`, body: (d: string) => `Na ${d}`, bodyWithAmount: (d: string, a: string) => `Na ${d}: ${a}`, generic: { title: 'Cashfold ma przypomnienie', body: 'Otwórz Cashfold, aby je zobaczyć.' } };
    expect(textFor(reminder('k'), deps({ copy: polish }))).toEqual(polish.generic);
    expect(textFor(reminder('k'), deps({ copy: polish, details: true })).title).toBe('Termin: Rent');
  });

  it('show and remember nothing without permission, so it can still be shown once permission is given', async () => {
    const show = vi.fn();
    const d = deps({ permission: () => 'denied', show });
    expect(await showDueReminders([reminder('a')], d)).toBe(0);
    expect(show).not.toHaveBeenCalled();
    expect(d.remembered).toEqual([]);
  });
});

describe('forgetting which reminders were shown (spec 011)', () => {
  const store = (initial: Record<string, string>) => {
    const data = new Map(Object.entries(initial));
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  };

  it('removes the list of shown reminders, which names reminders of the account that is gone', () => {
    const s = store({ 'cashfold.reminders.shown': '["a","b"]', 'cashfold.reminders.amounts': '1' });
    forgetShownReminders(s);
    expect(s.data.has('cashfold.reminders.shown')).toBe(false);
  });

  it('keeps the device choice to show amounts in reminders', () => {
    const s = store({ 'cashfold.reminders.shown': '[]', 'cashfold.reminders.amounts': '1' });
    forgetShownReminders(s);
    expect(s.getItem('cashfold.reminders.amounts')).toBe('1');
  });

  it('does nothing when there is nothing, and never throws when storage does', () => {
    expect(() => forgetShownReminders(store({}))).not.toThrow();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => forgetShownReminders(broken)).not.toThrow();
    expect(() => forgetShownReminders(undefined)).not.toThrow();
  });
});

