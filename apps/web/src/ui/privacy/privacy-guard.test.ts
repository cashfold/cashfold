import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Privacy mode's state must not outlive the unlocked shell (spec 016, FR-006, FR-022): the provider is mounted inside it and nowhere else, so a lock takes
// the provider, its listeners and every reveal with it. This reads the shell's source so that moving the mount fails here.

const ui = resolve(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(resolve(ui, file), 'utf8');

describe('where Privacy mode lives', () => {
  const shell = read('shell/AppShell.tsx');
  const unlocked = shell.slice(shell.indexOf('function UnlockedShell'), shell.indexOf('function PlainShell'));
  const plain = shell.slice(shell.indexOf('function PlainShell'));

  it('is provided inside the unlocked shell, once, and not before sign-in', () => {
    expect(unlocked).toContain('<PrivacyProvider>');
    expect(plain).not.toContain('PrivacyProvider');
    expect(shell.match(/<PrivacyProvider>/g)).toHaveLength(1);
  });

  it('wraps the ledger, so every screen that formats money is inside it', () => {
    expect(unlocked.indexOf('<PrivacyProvider>')).toBeLessThan(unlocked.indexOf('<LedgerProvider>'));
  });

  it('hides revealed amounts on navigation, on the cover, on blur, on a mode change and on unmount', () => {
    const provider = read('privacy/PrivacyProvider.tsx');
    expect(provider).toMatch(/usePathname/);
    expect(provider).toMatch(/if \(covered\) clear\(\)/);
    expect(provider).toMatch(/addEventListener\('blur'/);
    expect(provider).toMatch(/\[on\]/);
    expect(provider).toMatch(/removeEventListener\('blur'[^]*clear\(\)/);
  });

  it('keeps nothing in storage, a URL or a log', () => {
    for (const file of ['privacy/reveal-store.ts', 'privacy/PrivacyProvider.tsx', 'privacy/usePrivacy.ts']) {
      expect(read(file), file).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|history\.(push|replace)State/);
    }
  });
});

// The switch (spec 017): one control in the sidebar footer, a compact one in the narrow top bar, both loaded lazily, and the change said politely.
describe('where the Privacy mode switch lives', () => {
  const shell = read('shell/AppShell.tsx');
  const topbar = read('shell/Topbar.tsx');
  const plain = shell.slice(shell.indexOf('function PlainShell'));

  it('is imported lazily from the privacy chunk, not statically', () => {
    expect(shell).toMatch(/lazy\(\(\) => import\('\.\.\/privacy\/PrivacySwitch'\)/);
    expect(topbar).toMatch(/lazy\(\(\) => import\('\.\.\/privacy\/PrivacySwitch'\)/);
    expect(shell).not.toMatch(/^import .*PrivacySwitch/m);
    expect(topbar).not.toMatch(/^import .*PrivacySwitch/m);
  });

  it('is rendered once in the sidebar footer and not before sign-in', () => {
    expect(shell.match(/<PrivacySidebarItemLazy \/>/g)).toHaveLength(1);
    expect(plain).not.toContain('PrivacySidebarItem');
    const footer = shell.slice(shell.indexOf('<SidebarFooter>'));
    expect(footer.indexOf('<PrivacySidebarItemLazy')).toBeGreaterThan(-1);
    expect(footer.indexOf('<PrivacySidebarItemLazy')).toBeLessThan(footer.indexOf('<HelpItem'));
  });

  it('replaces the old indicator, which nothing refers to any more', () => {
    for (const file of ['shell/AppShell.tsx', 'shell/Topbar.tsx', 'privacy/PrivacyProvider.tsx']) expect(read(file), file).not.toContain('PrivacyIndicator');
  });

  it('is announced by the provider when the mode changes, and not when the shell first appears', () => {
    const provider = read('privacy/PrivacyProvider.tsx');
    expect(provider).toContain("'privacy.announce.on'");
    expect(provider).toContain("'privacy.announce.off'");
    expect(provider).toMatch(/if \(mounted\.current\) setAnnouncement/);
  });
});

