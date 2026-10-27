import type { Reminder } from '@cashfold/core';
import { showDueReminders, type NotifyDeps } from '../../adapters/notifications/notify';

// Reminders used to be shown only while the Schedules screen was open. A desktop app that runs in the background, and a badge that counts what is
// waiting, need them on every screen, so they are checked here, once, by the unlocked shell (spec 006, research D7). Nothing leaves the device.

export const CHECK_EVERY_MS = 60_000;

export interface ReminderServiceDeps {
  /** True while there is an unlocked session. A locked app checks nothing and shows nothing. */
  readonly unlocked: () => boolean;
  readonly readReminders: () => Promise<readonly Reminder[]>;
  readonly notify: NotifyDeps;
  /** Calls `run` every `ms` until the returned function is called. */
  readonly every: (run: () => void, ms: number) => () => void;
}

export interface ReminderService {
  /** Checks now and then every minute. Returns a function that stops it. */
  start(): () => void;
}

export function createReminderService(deps: ReminderServiceDeps): ReminderService {
  return {
    start() {
      let live = true;
      const check = async (): Promise<void> => {
        if (!live || !deps.unlocked() || deps.notify.permission() !== 'granted') return;
        const due = await deps.readReminders().catch((): readonly Reminder[] => []);
        // The session may have locked while the read was under way.
        if (!live || !deps.unlocked()) return;
        await showDueReminders(due, deps.notify);
      };
      void check();
      const stop = deps.every(() => void check(), CHECK_EVERY_MS);
      return () => {
        live = false;
        stop();
      };
    },
  };
}
