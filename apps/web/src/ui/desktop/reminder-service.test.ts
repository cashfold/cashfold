import type { Reminder } from '@cashfold/core';
import { describe, expect, it, vi } from 'vitest';
import type { NotifyDeps } from '../../adapters/notifications/notify';
import { CHECK_EVERY_MS, createReminderService } from './reminder-service';

const reminder = (key: string): Reminder => ({
  key, scheduleId: 's' as never, name: 'Rent', n: 0, localDate: 20_260_310 as never, fireAtMs: 0, requiresConfirmation: false,
  template: { kind: 'transaction', direction: 'expense', accountId: 'a' as never, amountMinor: -123_456n, categoryId: null, payeeId: null, tagIds: [], note: 'secret note' },
});

function setup(over: { unlocked?: () => boolean; permission?: NotifyDeps['permission']; reminders?: Reminder[]; showAmounts?: boolean } = {}) {
  const shown: Array<{ title: string; body: string; tag: string }> = [];
  const seen = new Set<string>();
  let tick: () => void = () => undefined;
  const stopTimer = vi.fn();
  const notify: NotifyDeps = {
    permission: over.permission ?? (() => 'granted'),
    show: (text) => void shown.push(text),
    alreadyShown: () => seen,
    remember: (keys) => keys.forEach((k) => seen.add(k)),
    copy: { title: (n) => `Due: ${n}`, body: (d) => `On ${d}`, bodyWithAmount: (d, a) => `On ${d}: ${a}`, many: (n) => ({ title: `${n} due`, body: 'Open the app' }) },
    showAmounts: over.showAmounts ?? false,
    formatDate: (d) => `D${d}`,
    formatAmount: (m, c) => `${m} ${c}`,
    currencyOf: () => 'USD',
  };
  const readReminders = vi.fn(async () => over.reminders ?? [reminder('a')]);
  const service = createReminderService({ unlocked: over.unlocked ?? (() => true), readReminders, notify, every: (run, ms) => ((tick = run), expect(ms).toBe(CHECK_EVERY_MS), stopTimer) });
  return { service, shown, readReminders, tick: () => tick(), stopTimer };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the reminder service', () => {
  it('shows a due reminder at start, and again only for a new one on each minute', async () => {
    const s = setup({ reminders: [reminder('a')] });
    s.service.start();
    await settle();
    expect(s.shown.map((x) => x.tag)).toEqual(['a']);
    s.tick();
    await settle();
    expect(s.shown).toHaveLength(1);
  });

  it('runs on whatever screen is open: it needs only the session, not the Schedules view', async () => {
    const s = setup();
    s.service.start();
    await settle();
    expect(s.readReminders).toHaveBeenCalled();
  });

  it('shows no amount unless the opt-in is on', async () => {
    const off = setup();
    off.service.start();
    await settle();
    expect(JSON.stringify(off.shown)).not.toMatch(/123456|secret/);
    const on = setup({ showAmounts: true });
    on.service.start();
    await settle();
    expect(on.shown[0]!.body).toBe('On D20260310: 123456 USD');
  });

  it('shows one summary when several came due while it was not looking (after an unlock), and one reminder as itself', async () => {
    const many = setup({ reminders: [reminder('a'), reminder('b'), reminder('c')] });
    many.service.start();
    await settle();
    expect(many.shown).toEqual([{ title: '3 due', body: 'Open the app', tag: 'reminders-summary' }]);
    const one = setup({ reminders: [reminder('a')] });
    one.service.start();
    await settle();
    expect(one.shown[0]!.title).toBe('Due: Rent');
  });

  it('does nothing while locked: it does not even read the reminders', async () => {
    const s = setup({ unlocked: () => false });
    s.service.start();
    await settle();
    s.tick();
    await settle();
    expect(s.readReminders).not.toHaveBeenCalled();
    expect(s.shown).toEqual([]);
  });

  it('shows nothing, and does not fail, without permission', async () => {
    const s = setup({ permission: () => 'denied' });
    s.service.start();
    await settle();
    expect(s.readReminders).not.toHaveBeenCalled();
    expect(s.shown).toEqual([]);
  });

  it('shows nothing when the session locked while the reminders were being read', async () => {
    let unlocked = true;
    const s = setup({ unlocked: () => unlocked });
    s.readReminders.mockImplementation(async () => {
      unlocked = false;
      return [reminder('a')];
    });
    s.service.start();
    await settle();
    expect(s.shown).toEqual([]);
  });

  it('survives a failed read, and stops for good when stopped', async () => {
    const s = setup();
    s.readReminders.mockRejectedValueOnce(new Error('worker gone'));
    const stop = s.service.start();
    await settle();
    expect(s.shown).toEqual([]);
    stop();
    expect(s.stopTimer).toHaveBeenCalled();
    s.tick();
    await settle();
    expect(s.readReminders).toHaveBeenCalledTimes(1);
  });
});
