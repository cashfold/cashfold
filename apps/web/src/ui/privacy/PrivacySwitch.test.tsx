import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { PrivacySidebarItem, PrivacyTopbarItem } from './PrivacySwitch';
import { PrivacyContext, type PrivacyApi } from './usePrivacy';

const api = (on: boolean): PrivacyApi => ({ on, toggle: () => undefined, reveal: () => undefined });
const render = (node: React.ReactNode, on: boolean) =>
  renderToStaticMarkup(<I18nProvider><PrivacyContext.Provider value={api(on)}>{node}</PrivacyContext.Provider></I18nProvider>);
const text = (markup: string) => markup.replace(/<[^>]+>/g, '');

describe('the Privacy mode switch in the sidebar', () => {
  it('says the mode is off, with a pressed state of false and the open eye', () => {
    const markup = render(<PrivacySidebarItem />, false);
    expect(text(markup)).toBe('Privacy mode: off');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('data-testid="privacy-switch"');
    expect(markup).toContain('<svg');
  });

  it('says the mode is on, with a pressed state of true and a different icon', () => {
    const off = render(<PrivacySidebarItem />, false);
    const on = render(<PrivacySidebarItem />, true);
    expect(text(on)).toBe('Privacy mode: on');
    expect(on).toContain('aria-pressed="true"');
    // The states differ by words and by icon, not by a colour class alone.
    expect(on.match(/<svg[^]*<\/svg>/)![0]).not.toBe(off.match(/<svg[^]*<\/svg>/)![0]);
  });

  it('is named by its visible text, and the icon is hidden from a reader', () => {
    const markup = render(<PrivacySidebarItem />, true);
    expect(markup).not.toContain('aria-label');
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe('the Privacy mode button in the top bar', () => {
  it.each([[false, 'Privacy mode: off'], [true, 'Privacy mode: on']])('with the mode %s has no text and is named "%s"', (on, name) => {
    const markup = render(<PrivacyTopbarItem />, on);
    expect(text(markup)).toBe('');
    expect(markup).toContain(`aria-label="${name}"`);
    expect(markup).toContain(`aria-pressed="${on}"`);
    expect(markup).toContain('data-testid="privacy-switch-topbar"');
    expect(markup).toMatch(/\bmin-h-11\b/);
    expect(markup).toMatch(/\bmin-w-11\b/);
  });
});
