import type { Reminder } from '@cashfold/core';

// Reminders (FR-062) are shown by the page while the app is open, from the schedules on this device. Nothing about
// them is sent anywhere. A notification can appear on a locked screen or on a shared screen, so by default it says only that something needs
// attention: no schedule name, no day, no amount, no count (spec 016). The person can switch on details (the schedule's name and the day) and,
// on top of that, amounts; both are device preferences, never synced.

export interface NotificationText {
  readonly title: string;
  readonly body: string;
}

export interface ReminderCopy {
  readonly title: (name: string) => string;
  readonly body: (date: string) => string;
  readonly bodyWithAmount: (date: string, amount: string) => string;
  /** What a notification says when details are off, and for several reminders that came due together (after an unlock, say), so a screen is not flooded. No count. */
  readonly generic: NotificationText;
}

export interface NotifyDeps {
  readonly permission: () => 'granted' | 'denied' | 'default' | 'unsupported';
  readonly show: (text: NotificationText & { tag: string }) => Promise<void> | void;
  readonly alreadyShown: () => ReadonlySet<string>;
  readonly remember: (keys: readonly string[]) => void;
  readonly copy: ReminderCopy;
  /** Whether a notification may name the schedule and the day. Off: it is the generic text. */
  readonly details: boolean;
  /** Whether it may also show the amount. Only meaningful while `details` is on. */
  readonly amounts: boolean;
  readonly formatDate: (date: Reminder['localDate']) => string;
  readonly formatAmount: (minor: bigint, currency: string) => string;
  /** The currency of an account, for the amount text. */
  readonly currencyOf: (account: string) => string | undefined;
}

export function textFor(r: Reminder, deps: Pick<NotifyDeps, 'copy' | 'details' | 'amounts' | 'formatDate' | 'formatAmount' | 'currencyOf'>): NotificationText {
  if (!deps.details) return deps.copy.generic;
  const when = deps.formatDate(r.localDate);
  const title = deps.copy.title(r.name);
  if (!deps.amounts) return { title, body: deps.copy.body(when) };
  const t = r.template;
  const account = t.kind === 'transaction' ? t.accountId : t.fromAccountId;
  const currency = deps.currencyOf(account);
  const minor = t.kind === 'transaction' ? (t.amountMinor < 0n ? -t.amountMinor : t.amountMinor) : t.fromAmountMinor;
  return currency === undefined ? { title, body: deps.copy.body(when) } : { title, body: deps.copy.bodyWithAmount(when, deps.formatAmount(minor, currency)) };
}

export const SUMMARY_TAG = 'reminders-summary';

/**
 * Shows each due reminder once. When several are fresh at once they become one summary notification, and a single one is shown as itself.
 * Returns how many reminders were covered; nothing is shown, or remembered, without permission.
 */
export async function showDueReminders(reminders: readonly Reminder[], deps: NotifyDeps): Promise<number> {
  if (deps.permission() !== 'granted') return 0;
  const seen = deps.alreadyShown();
  const fresh = reminders.filter((r) => !seen.has(r.key));
  if (fresh.length > 1) await deps.show({ ...deps.copy.generic, tag: SUMMARY_TAG });
  else for (const r of fresh) await deps.show({ ...textFor(r, deps), tag: r.key });
  if (fresh.length > 0) deps.remember(fresh.map((r) => r.key));
  return fresh.length;
}
