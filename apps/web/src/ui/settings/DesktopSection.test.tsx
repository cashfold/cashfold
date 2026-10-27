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

  it('offers to keep running in the background only where a tray or menu-bar item can bring the app back', () => {
    const withIcon = inI18n(<DesktopSectionBody settings={settings} capabilities={{ ...capabilities, statusItem: true }} update={async () => undefined} />);
    expect(withIcon).toContain('When I close the window');
    expect(withIcon).toContain('Keep Cashfold running in the background');
    expect(withIcon).toContain('data-testid="desktop-close-background"');
    const without = inI18n(<DesktopSectionBody settings={settings} capabilities={{ ...capabilities, statusItem: false }} update={async () => undefined} />);
    expect(without).not.toContain('Keep Cashfold running in the background');
    expect(without).toContain('data-testid="desktop-close-unavailable"');
  });

  it('says that reminders and the count need the app unlocked', () => {
    expect(inI18n(<DesktopSectionBody settings={settings} capabilities={capabilities} update={async () => undefined} />)).toContain('work only while Cashfold is unlocked');
  });

  it('offers start at login, off by default, where the system can do it', () => {
    const html = inI18n(<DesktopSectionBody settings={settings} capabilities={capabilities} update={async () => undefined} />);
    expect(html).toContain('Start Cashfold when I sign in');
    expect(html).toMatch(/data-testid="desktop-start-at-login"[^>]*aria-checked="false"|aria-checked="false"[^>]*data-testid="desktop-start-at-login"/);
    const without = inI18n(<DesktopSectionBody settings={settings} capabilities={{ ...capabilities, loginItem: false }} update={async () => undefined} />);
    expect(without).not.toContain('Start Cashfold when I sign in');
  });

  it('shows start at login on when it is chosen', () => {
    const html = inI18n(<DesktopSectionBody settings={{ ...settings, startAtLogin: true }} capabilities={capabilities} update={async () => undefined} />);
    expect(html).toMatch(/data-testid="desktop-start-at-login"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="desktop-start-at-login"/);
  });
});
