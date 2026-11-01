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
  it('is a switch named "Privacy mode", off, with the open eye', () => {
    const markup = render(<PrivacySidebarItem />, false);
    expect(text(markup)).toBe('Privacy mode');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('data-testid="privacy-switch"');
    expect(markup).toContain('<svg');
  });

  it('is on, with a different icon', () => {
    const off = render(<PrivacySidebarItem />, false);
    const on = render(<PrivacySidebarItem />, true);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    // The states differ by the switch's own state and by the icon, not by a colour class alone.
    expect(on.match(/<svg[^]*?<\/svg>/)![0]).not.toBe(off.match(/<svg[^]*?<\/svg>/)![0]);
  });

  it('is named by the visible label, and the icon is hidden from a reader', () => {
    const markup = render(<PrivacySidebarItem />, true);
    // The label is tied to the switch (for/id), so its name is the visible text; the browser test reads the real accessible name.
    const target = /<label[^>]*for="([^"]+)"[^>]*>Privacy mode</.exec(markup)![1]!;
    expect(markup).toContain(`id="${target}" role="switch"`);
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
