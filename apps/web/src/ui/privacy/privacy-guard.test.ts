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
