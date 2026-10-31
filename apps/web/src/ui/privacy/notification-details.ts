import type { NotificationDetailChoice } from '../prefs/schema';

/**
 * Whether a notification may include the schedule's name and the day (spec 016, FR-021). `auto` means the person never chose: it follows the older
 * "show amounts" choice, so someone who allowed amounts before keeps details on and sees the switch turned on.
 */
export function effectiveNotificationDetails(choice: NotificationDetailChoice, amountsAllowed: boolean): boolean {
  return choice === 'on' || (choice === 'auto' && amountsAllowed);
}
