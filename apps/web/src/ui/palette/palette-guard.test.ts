import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The palette must not exist while the app is locked (spec 015, FR-002, FR-018, FR-019): it is mounted inside the unlocked shell only, so a lock unmounts it with
// its query and results, and nothing is left to listen for the key. This test reads the shell's source so that moving the mount fails here, not in review.

const ui = resolve(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(resolve(ui, file), 'utf8');

describe('where the palette lives', () => {
  const shell = read('shell/AppShell.tsx');
  const unlocked = shell.slice(shell.indexOf('function UnlockedShell'), shell.indexOf('function PlainShell'));
  const plain = shell.slice(shell.indexOf('function PlainShell'));

  it('is mounted in the unlocked shell and nowhere else in the shell', () => {
    expect(unlocked).toContain('<PaletteHostLazy />');
    expect(plain).not.toContain('PaletteHost');
    expect(shell.match(/<PaletteHostLazy/g)).toHaveLength(1);
  });

  it('is loaded as its own chunk, so it is not part of the JavaScript every page loads up front', () => {
    expect(shell).toMatch(/lazy\(\(\) => import\('\.\.\/palette\/PaletteHost'\)/);
    expect(shell).not.toMatch(/^import .* from '\.\.\/palette\/PaletteHost'/m);
  });

  it('closes when the privacy cover shows, and when another desktop shortcut arrives', () => {
    const host = read('palette/PaletteHost.tsx');
    expect(host).toMatch(/core\.covered\)\s*close\(\)/);
    expect(host).toContain('subscribeOverlays');
  });

  it('refuses to open over another dialog', () => {
    const host = read('palette/PaletteHost.tsx');
    expect(host).toMatch(/if \(otherDialogOpen\(document\)\) return;/);
  });

  it('is told apart from other dialogs by its own marker', () => {
    expect(read('palette/CommandPalette.tsx')).toContain('data-palette=""');
  });

  it('is toggled by the desktop action without closing Help first', () => {
    const actions = read('desktop/DesktopActions.tsx');
    expect(actions).toMatch(/if \(action === 'palette' \|\| action === 'privacy'\) run\(\);\s*else if \(dismissOverlays\(\) > 0\)/);
  });
});

describe('what the palette keeps', () => {
  const files = ['palette/PaletteHost.tsx', 'palette/CommandPalette.tsx', 'palette/entities.ts', 'palette/search.ts', 'palette/fuzzy.ts'];

  it('never logs and never writes a title to storage (FR-020)', () => {
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/console\./);
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/);
    }
  });
});
