import type { IncomingItem } from '@cashfold/platform';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keptWhileLocked, refusalKey, routeIncoming } from './incoming';

const bytes = new Uint8Array([1, 2, 3]);
const csv: IncomingItem = { kind: 'csv', name: 'bank.csv', bytes };
const backup: IncomingItem = { kind: 'backup', name: 'Household.cashfold-backup', bytes };
const addDevice = (extra: { email?: string; server?: string } = {}): IncomingItem => ({ kind: 'link', name: 'add-device', link: { screen: 'add-device', ...extra } });
const open = (target: 'overview' | 'transactions' | 'accounts' | 'plan' | 'settings'): IncomingItem => ({ kind: 'link', name: `open-${target}`, link: { screen: 'open', target } });

describe('a CSV file opened from outside', () => {
  it('opens the import panel with the file chosen, and imports nothing', () => {
    const effects = routeIncoming(csv, 'unlocked');
    expect(effects).toEqual([{ type: 'offer-csv', name: 'bank.csv', bytes }, { type: 'navigate', href: '/settings/data/' }]);
    expect(effects.map((e) => e.type)).not.toContain('import');
  });

  it('is not opened by a locked page', () => {
    expect(routeIncoming(csv, 'locked')).toEqual([{ type: 'message', key: 'desktop.incoming.unlockFirst' }]);
    expect(routeIncoming(csv, 'no_account')).toEqual([{ type: 'message', key: 'desktop.incoming.unlockFirst' }]);
  });
});

describe('a backup opened from outside', () => {
  it('opens the restore form with the file chosen, and restores nothing (the passphrase is asked there)', () => {
    expect(routeIncoming(backup, 'unlocked')).toEqual([{ type: 'offer-backup', name: 'Household.cashfold-backup', bytes }, { type: 'navigate', href: '/settings/data/' }]);
  });

  it('is not opened by a locked page', () => {
    expect(routeIncoming(backup, 'locked')).toEqual([{ type: 'message', key: 'desktop.incoming.unlockFirst' }]);
  });
});

describe('an add-device link', () => {
  it('opens the add-device screen with the email and the service address filled, and nothing else', () => {
    const effects = routeIncoming(addDevice({ email: 'a@b.example', server: 'https://relay.example.com' }), 'no_account');
    expect(effects).toEqual([{ type: 'prefill-add-device', email: 'a@b.example', server: 'https://relay.example.com' }, { type: 'navigate', href: '/add/' }]);
    expect(JSON.stringify(effects)).not.toMatch(/secret|password|key/i);
  });

  it('works with either field, or none', () => {
    expect(routeIncoming(addDevice(), 'no_account')[0]).toEqual({ type: 'prefill-add-device' });
    expect(routeIncoming(addDevice({ email: 'a@b.example' }), 'no_account')[0]).toEqual({ type: 'prefill-add-device', email: 'a@b.example' });
  });

  it('says that the app already has an account, and offers nothing destructive', () => {
    for (const phase of ['locked', 'unlocked'] as const) {
      expect(routeIncoming(addDevice({ email: 'a@b.example' }), phase)).toEqual([{ type: 'message', key: 'desktop.incoming.hasAccount' }]);
    }
  });
});

describe('an open link', () => {
  it.each([
    ['overview', '/overview/'],
    ['transactions', '/transactions/'],
    ['accounts', '/accounts/'],
    ['plan', '/plan/'],
    ['settings', '/settings/'],
  ] as const)('goes to %s when unlocked', (target, href) => {
    expect(routeIncoming(open(target), 'unlocked')).toEqual([{ type: 'navigate', href }]);
  });

  it('leads to sign-up when there is no account, and waits for the unlock when there is one', () => {
    expect(routeIncoming(open('plan'), 'no_account')).toEqual([{ type: 'navigate', href: '/sign-up/' }]);
    expect(routeIncoming(open('plan'), 'locked')).toEqual([{ type: 'wait' }]);
  });
});

describe('a refused item', () => {
  it('shows a message and changes nothing', () => {
    expect(routeIncoming({ kind: 'refused', reason: 'secret' }, 'unlocked')).toEqual([{ type: 'message', key: 'desktop.incoming.refused.secret' }]);
  });

  it.each([
    ['secret', 'desktop.incoming.refused.secret'],
    ['queue-full', 'desktop.incoming.refused.queueFull'],
    ['host', 'desktop.incoming.refused.link'],
    ['fragment', 'desktop.incoming.refused.link'],
    ['server', 'desktop.incoming.refused.link'],
    ['too-large', 'desktop.incoming.refused.too-large'],
    ['empty', 'desktop.incoming.refused.empty'],
    ['extension', 'desktop.incoming.refused.extension'],
    ['not-regular', 'desktop.incoming.refused.not-regular'],
    ['something-new', 'desktop.incoming.refused.generic'],
  ])('%s is said as %s', (reason, key) => expect(refusalKey(reason)).toBe(key));
});

describe('what a locked page keeps', () => {
  it('is the links only: file contents are never held by a locked page', () => {
    expect(keptWhileLocked([csv, open('plan'), backup, addDevice()])).toEqual([open('plan'), addDevice()]);
  });
});

describe('before the page knows whether there is an account', () => {
  it('keeps every item (but a refusal) for later, so a link is not mistaken for one that meets an account', () => {
    for (const item of [csv, backup, addDevice({ email: 'a@b.example' }), open('plan')]) expect(routeIncoming(item, 'loading')).toEqual([{ type: 'wait' }]);
    expect(routeIncoming({ kind: 'refused', reason: 'secret' }, 'loading')).toEqual([{ type: 'message', key: 'desktop.incoming.refused.secret' }]);
  });
});

// The browser walk cannot see the desktop-only screens, so the words they use are checked here: every message a refusal, an incoming item or a drop can
// show exists, in all three languages.
describe('the words of the desktop-only messages', () => {
  const catalogue = (language: string) => JSON.parse(readFileSync(join(__dirname, '..', 'i18n', 'messages', `${language}.json`), 'utf8')) as Record<string, string>;
  const reasons = ['secret', 'queue-full', 'too-long', 'scheme', 'host', 'fragment', 'user-info', 'port', 'parameter', 'repeated', 'email', 'server', 'control', 'encoding', 'target', 'empty', 'extension', 'not-regular', 'too-large', 'unreadable', 'name-too-long', 'something-new'];
  const keys = [
    ...reasons.map(refusalKey),
    'desktop.incoming.unlockFirst', 'desktop.incoming.hasAccount', 'desktop.incoming.more', 'desktop.incoming.next',
    'desktop.drop.unsupported', 'desktop.drop.tooLarge', 'desktop.drop.empty', 'desktop.drop.locked', 'desktop.drop.single',
    'settings.desktop.startAtLogin', 'settings.desktop.startAtLogin.description', 'settings.desktop.startAtLogin.failed',
    'settings.desktop.close.title', 'settings.desktop.close.quit', 'settings.desktop.close.background', 'settings.desktop.close.description', 'settings.desktop.close.unavailable', 'settings.desktop.reminders.note',
    'schedules.notify.message.many', 'schedules.notify.message.manyBody',
  ];

  it.each(['en', 'uk', 'pl'])('%s has every one of them, and none is empty', (language) => {
    const messages = catalogue(language);
    for (const key of new Set(keys)) expect(messages[key]?.trim(), `${language}: ${key}`).toBeTruthy();
  });

  it.each(['uk', 'pl'])('%s words them differently from English', (language) => {
    const english = catalogue('en');
    const messages = catalogue(language);
    for (const key of new Set(keys)) expect(messages[key], `${language}: ${key}`).not.toBe(english[key]);
  });
});

