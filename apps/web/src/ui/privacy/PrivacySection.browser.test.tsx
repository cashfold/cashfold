import axe from 'axe-core';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import { I18nProvider } from '../i18n/I18nProvider';
import { PREFS_KEY } from '../prefs/schema';
import { prefsStore } from '../prefs/usePrefs';
import { PrivacySection } from './PrivacySection';
import { PrivacyContext } from './usePrivacy';

// Settings → Appearance → Privacy in a real browser (spec 016, US4): both switches off by default with plain descriptions, operable by keyboard, kept in the
// device preferences, and free of axe violations in both themes at narrow and wide widths.

let root: Root | undefined;
let host: HTMLElement | undefined;

function Harness() {
  const [on, setOn] = useState(prefsStore.get().privacyMode);
  return (
    <PrivacyContext.Provider value={{ on, toggle: () => { prefsStore.update((p) => ({ ...p, privacyMode: !p.privacyMode })); setOn((v) => !v); }, reveal: () => undefined }}>
      <I18nProvider>
        <main style={{ width: 360 }}><PrivacySection /></main>
      </I18nProvider>
    </PrivacyContext.Provider>
  );
}

function mount(theme: 'light' | 'dark' = 'light'): HTMLElement {
  document.documentElement.dataset['theme'] = theme;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Harness />));
  return host;
}

// The preferences store keeps what it read in memory, so each test starts it again from nothing.
const fresh = () => {
  prefsStore.reset();
  localStorage.removeItem(PREFS_KEY);
  localStorage.removeItem('cashfold.reminders.amounts');
};
beforeEach(fresh);
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  fresh();
});

const mode = () => document.querySelector<HTMLElement>('[data-testid=privacy-mode-switch]')!;
const details = () => document.querySelector<HTMLElement>('[data-testid=notify-details-switch]')!;
const amounts = () => document.querySelector<HTMLElement>('[data-testid=notify-amounts-switch]');
const stored = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { privacyMode?: boolean; notificationDetails?: string };

describe('the privacy section', () => {
  it('starts with both switches off and says what each covers and what it does not', () => {
    mount();
    expect(mode().getAttribute('aria-checked')).toBe('false');
    expect(details().getAttribute('aria-checked')).toBe('false');
    expect(amounts()).toBeNull();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Privacy mode');
    expect(text).toMatch(/Names, dates, notes and the window itself stay visible/);
    expect(text).toMatch(/Exports and the add and edit forms always use real figures/);
    expect(text).toMatch(/locked screen/);
  });

  it('turns Privacy mode on by keyboard and keeps it in the device preferences', async () => {
    mount();
    mode().focus();
    await userEvent.keyboard(' ');
    expect(mode().getAttribute('aria-checked')).toBe('true');
    expect(stored().privacyMode).toBe(true);
  });

  it('shows the amounts switch only while details are on, and remembers both choices', async () => {
    mount();
    await userEvent.click(details());
    expect(details().getAttribute('aria-checked')).toBe('true');
    expect(stored().notificationDetails).toBe('on');
    expect(amounts()).not.toBeNull();
    await userEvent.click(amounts()!);
    expect(localStorage.getItem('cashfold.reminders.amounts')).toBe('1');
    await userEvent.click(details());
    expect(stored().notificationDetails).toBe('off');
    expect(amounts()).toBeNull();
  });

  it('shows details as on, and amounts as on, for someone who allowed amounts before this feature (FR-021)', () => {
    localStorage.setItem('cashfold.reminders.amounts', '1');
    mount();
    expect(details().getAttribute('aria-checked')).toBe('true');
    expect(amounts()!.getAttribute('aria-checked')).toBe('true');
    expect(mode().getAttribute('aria-checked')).toBe('false');
  });

  it('lets an explicit choice win over the older flag', async () => {
    localStorage.setItem('cashfold.reminders.amounts', '1');
    mount();
    await userEvent.click(details());
    expect(details().getAttribute('aria-checked')).toBe('false');
    expect(stored().notificationDetails).toBe('off');
  });

  it.each(['light', 'dark'] as const)('has no accessibility violations in the %s theme, with the amounts switch shown or not', async (theme) => {
    mount(theme);
    const check = async () => {
      await new Promise((r) => setTimeout(r, 250));
      const result = await axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    };
    expect(await check()).toEqual([]);
    await userEvent.click(details());
    expect(await check()).toEqual([]);
  });

  it('does not scroll sideways at a narrow width', () => {
    mount();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    const section = document.querySelector('section')!;
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
  });
});

describe('the privacy section in the other languages and at larger text', () => {
  it.each(['uk', 'pl'] as const)('fits a narrow width without scrolling sideways in %s, with its own words', async (language) => {
    prefsStore.update((p) => ({ ...p, language }));
    mount();
    await new Promise((r) => setTimeout(r, 600));
    await userEvent.click(details());
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Privacy mode');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    const section = document.querySelector('section')!;
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
  });

  it('keeps its layout at a larger text size', () => {
    document.documentElement.style.fontSize = '24px';
    try {
      mount();
      const section = document.querySelector('section')!;
      expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
    } finally {
      document.documentElement.style.fontSize = '';
    }
  });
});

