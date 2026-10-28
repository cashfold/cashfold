import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../ui/shell/routes';

// The web app manifest (spec 009, contracts/manifest.md): what the browser reads to install the app, name it, and offer shortcuts on its icon.

const pub = resolve(import.meta.dirname, '..', '..', 'public');
interface Icon { src: string; sizes: string; type: string; purpose?: string }
interface Shortcut { name: string; short_name?: string; url: string }
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown> & { icons: Icon[]; shortcuts: Shortcut[]; scope: string };

describe('the web app manifest', () => {
  it('names the app, gives it a stable identity and says how it opens', () => {
    expect(manifest['name']).toBe('Cashfold');
    expect(manifest['short_name']).toBe('Cashfold');
    expect(manifest['id']).toBe('/');
    expect(manifest['start_url']).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest['display']).toBe('standalone');
    expect(manifest['display_override']).toEqual(['standalone']);
    expect(manifest['lang']).toBe('en');
    expect(manifest['dir']).toBe('auto');
    expect(manifest['categories']).toEqual(['finance']);
    expect(typeof manifest['description']).toBe('string');
    expect((manifest['description'] as string).length).toBeGreaterThan(10);
  });

  it('has its icons, each a file that exists, and an adaptive one', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) expect(existsSync(join(pub, icon.src)), icon.src).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === undefined)).toBe(true);
  });

  it('offers a shortcut to a new transaction and to each main section, inside its scope', () => {
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/transactions/?new=expense', '/overview/', '/transactions/', '/accounts/', '/plan/', '/settings/']);
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.url.startsWith(manifest.scope), shortcut.url).toBe(true);
      expect(ROUTES.has(shortcut.url.split('?')[0]!), shortcut.url).toBe(true);
      expect(shortcut.name.length, shortcut.url).toBeGreaterThan(0);
    }
  });

  it('carries nothing a person owns in an address: no account, name or amount', () => {
    for (const shortcut of manifest.shortcuts) {
      const query = new URLSearchParams(shortcut.url.split('?')[1] ?? '');
      expect([...query.keys()].filter((k) => k !== 'new')).toEqual([]);
      expect(['', 'expense']).toContain(query.get('new') ?? '');
    }
  });

  it('points to no other origin', () => {
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/https?:\/\//);
  });
});
