import type { Reminder } from '@cashfold/core';
import { describe, expect, it, vi } from 'vitest';
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
    copy: { title: (n) => `Due: ${n}`, body: (d) => `On ${d}`, bodyWithAmount: (d, a) => `On ${d}: ${a}`, many: (n) => ({ title: `${n} due`, body: 'Open the app' }) },
    showAmounts: false, formatDate: (d) => `D${d}`, formatAmount: (m, c) => `${m} ${c}`, currencyOf: () => 'USD', ...over,
  };
}

describe('reminder notifications', () => {
  it('show the name and the day but no amount or note by default (lock screen privacy)', () => {
    const t = textFor(reminder('k'), deps());
    expect(t).toEqual({ title: 'Due: Rent', body: 'On D20260310' });
    expect(JSON.stringify(t)).not.toMatch(/123456|1234\.56|secret/);
  });

  it('show the amount, positive, only when allowed', () => {
    expect(textFor(reminder('k'), deps({ showAmounts: true })).body).toBe('On D20260310: 123456 USD');
    expect(textFor(reminder('k', { template: { kind: 'transfer', fromAccountId: 'a' as never, toAccountId: 'b' as never, fromAmountMinor: 500n, toAmountMinor: 450n, note: '' } }), deps({ showAmounts: true })).body).toBe('On D20260310: 500 USD');
  });

  it('fall back to no amount when the account is unknown', () => {
    expect(textFor(reminder('k'), deps({ showAmounts: true, currencyOf: () => undefined })).body).toBe('On D20260310');
  });

  it('show one reminder as itself, once, and remember it', async () => {
    const d = deps();
    expect(await showDueReminders([reminder('a')], d)).toBe(1);
    expect(d.shown).toEqual([{ title: 'Due: Rent', body: 'On D20260310', tag: 'a' }]);
    expect(d.remembered).toEqual(['a']);
    const again = deps({ alreadyShown: () => new Set(['a']) });
    expect(await showDueReminders([reminder('a'), reminder('c')], again)).toBe(1);
    expect(again.shown.map((s) => s.tag)).toEqual(['c']);
  });

  it('show several that came due together as one summary, and remember every one of them', async () => {
    const d = deps();
    expect(await showDueReminders([reminder('a'), reminder('b'), reminder('c')], d)).toBe(3);
    expect(d.shown).toEqual([{ title: '3 due', body: 'Open the app', tag: SUMMARY_TAG }]);
    expect(d.remembered).toEqual(['a', 'b', 'c']);
  });

  it('keep the 60-second cadence free of repeats: what was summarised is not shown again', async () => {
    const d = deps({ alreadyShown: () => new Set(['a', 'b', 'c']) });
    expect(await showDueReminders([reminder('a'), reminder('b'), reminder('c')], d)).toBe(0);
    expect(d.shown).toEqual([]);
  });

  it('put no amount or note in the summary', async () => {
    const d = deps({ showAmounts: true });
    await showDueReminders([reminder('a'), reminder('b')], d);
    expect(JSON.stringify(d.shown)).not.toMatch(/123456|secret/);
  });

  it('show and remember nothing without permission, so it can still be shown once permission is given', async () => {
    const show = vi.fn();
    const d = deps({ permission: () => 'denied', show });
    expect(await showDueReminders([reminder('a')], d)).toBe(0);
    expect(show).not.toHaveBeenCalled();
    expect(d.remembered).toEqual([]);
  });
});
