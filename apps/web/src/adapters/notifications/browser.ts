import type { NotificationText } from './notify';

// The browser side of reminders. Storage can be unavailable (private windows), so every access is guarded and the
// feature degrades to "no reminders" rather than failing.

const SHOWN_KEY = 'cashfold.reminders.shown';
const AMOUNTS_KEY = 'cashfold.reminders.amounts';
const KEEP = 500;

export function permission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return permission();
  }
}

export async function show(text: NotificationText & { tag: string }): Promise<void> {
  const options = { body: text.body, tag: text.tag, silent: false };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration !== undefined) return await registration.showNotification(text.title, options);
  } catch {
    // Fall through to the page's own notification.
  }
  new Notification(text.title, options);
}

export function shownKeys(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberShown(keys: readonly string[]): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...shownKeys(), ...keys].slice(-KEEP)));
  } catch {
    // Without storage a reminder may repeat on the next visit; that is better than none.
  }
}

export function amountsAllowed(): boolean {
  try {
    return localStorage.getItem(AMOUNTS_KEY) === '1';
  } catch {
    return false;
  }
}

export function allowAmounts(allowed: boolean): void {
  try {
    localStorage.setItem(AMOUNTS_KEY, allowed ? '1' : '0');
  } catch {
    // Not remembered; the safe default (no amounts) applies next time.
  }
}
