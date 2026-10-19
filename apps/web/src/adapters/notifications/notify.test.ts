import type { Reminder } from '@cashfold/core';
import { describe, expect, it, vi } from 'vitest';
import { showDueReminders, textFor, type NotifyDeps } from './notify';

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
    copy: { title: (n) => `Due: ${n}`, body: (d) => `On ${d}`, bodyWithAmount: (d, a) => `On ${d}: ${a}` },
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

  it('show each reminder once and remember it', async () => {
    const d = deps();
    expect(await showDueReminders([reminder('a'), reminder('b')], d)).toBe(2);
    expect(d.shown.map((s) => s.tag)).toEqual(['a', 'b']);
    expect(d.remembered).toEqual(['a', 'b']);
    const again = deps({ alreadyShown: () => new Set(['a', 'b']) });
    expect(await showDueReminders([reminder('a'), reminder('b'), reminder('c')], again)).toBe(1);
    expect(again.shown.map((s) => s.tag)).toEqual(['c']);
  });

  it('show and remember nothing without permission, so it can still be shown once permission is given', async () => {
    const show = vi.fn();
    const d = deps({ permission: () => 'denied', show });
    expect(await showDueReminders([reminder('a')], d)).toBe(0);
    expect(show).not.toHaveBeenCalled();
    expect(d.remembered).toEqual([]);
  });
});
