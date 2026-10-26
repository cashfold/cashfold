import type { Capabilities, DesktopSettings } from '@cashfold/platform';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesktopSettingsProvider } from '../desktop/DesktopSettingsProvider';
import { createDesktopStore } from '../desktop/desktop-store';
import { I18nProvider } from '../i18n/I18nProvider';
import { DesktopSection, DesktopSectionBody } from './DesktopSection';

const settings: DesktopSettings = { hideOnBlur: false, startAtLogin: false, closeBehavior: 'quit', theme: 'system' };
const capabilities: Capabilities = { platform: 'linux', lockEvents: ['suspend', 'idle-state'], badge: false, statusItem: false, jumpList: false, dockMenu: false, notifications: 'granted', translucency: 'unavailable', loginItem: true };
const inI18n = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);

describe('Settings → Desktop', () => {
  it('renders nothing in a browser, or before the page knows it is in the desktop app', () => {
    for (const isDesktop of [false, true]) {
      const store = createDesktopStore({ isDesktop: () => isDesktop, platform: () => 'linux', loadBridge: async () => undefined });
      expect(inI18n(<DesktopSettingsProvider store={store}><DesktopSection /></DesktopSettingsProvider>)).toBe('');
    }
  });

  it('shows the switch, off by default, and exactly the events this computer reports', () => {
    const html = inI18n(<DesktopSectionBody settings={settings} capabilities={capabilities} update={async () => undefined} />);
    expect(html).toContain('Hide the content when I switch to another window');
    expect(html).toMatch(/data-testid="desktop-hide-on-blur"[^>]*aria-checked="false"|aria-checked="false"[^>]*data-testid="desktop-hide-on-blur"/);
    expect(html).toContain('The computer going to sleep');
    expect(html).toContain('The system reporting that it is locked');
    expect(html).not.toContain('The screen being locked');
    expect(html).toContain('idle time');
  });

  it('shows the switch on when the preference is on', () => {
    const html = inI18n(<DesktopSectionBody settings={{ ...settings, hideOnBlur: true }} capabilities={capabilities} update={async () => undefined} />);
    expect(html).toMatch(/aria-checked="true"/);
  });
});
