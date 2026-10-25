import jsQR from 'jsqr';
import { describe, expect, it, vi } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/i18n';
import { addDeviceUrl, buildEmergencyKitHtml, copyWithAutoClear, qrMatrix, type KitLanguage } from './kit';

const english: KitLanguage = { t: createTranslator('en'), locale: 'en', dir: 'ltr' };
const polish: KitLanguage = { t: createTranslator('pl', { en: ENGLISH, pl: { 'kit.doc.title': 'Zestaw awaryjny Cashfold', 'kit.doc.password': 'Hasło główne', 'kit.doc.warning.strong': 'Nie przechowuj hasła razem z tą stroną.' } }), locale: 'pl', dir: 'ltr' };

const kit = {
  accountId: 'XRG88A', email: 'alice@example.com', server: 'https://relay.example.com',
  secretKeyText: 'C1-XRG88A-AEBAGBAFA2D-SSCJL-BNGA4-DSRCA', generatedOn: '2026-10-18',
};

/** Rasterises a module matrix and decodes it with an independent QR reader. */
function decode(matrix: boolean[][]): string | undefined {
  const scale = 4;
  const quiet = 4;
  const size = (matrix.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  return jsQR(data, size, size)?.data;
}

describe('add-device link (the QR payload)', () => {
  it('carries the email, server and Secret Key in the fragment, which browsers never send to a server', () => {
    const url = addDeviceUrl('https://app.example.org', kit);
    expect(url.startsWith('https://app.example.org/add#')).toBe(true);
    expect(url).not.toContain('?');
    const fragment = new URLSearchParams(url.split('#')[1]);
    expect(fragment.get('email')).toBe('alice@example.com');
    expect(fragment.get('server')).toBe('https://relay.example.com');
    expect(fragment.get('key')).toBe(kit.secretKeyText);
  });

  it('percent-encodes awkward characters', () => {
    const url = addDeviceUrl('https://app.example.org', { ...kit, email: 'a+b&c=d@example.com' });
    expect(new URLSearchParams(url.split('#')[1]).get('email')).toBe('a+b&c=d@example.com');
  });
});

describe('QR code', () => {
  it('decodes back to exactly the text it was made from', () => {
    for (const text of [addDeviceUrl('https://app.example.org', kit), 'short', 'x'.repeat(300)]) {
      expect(decode(qrMatrix(text))).toBe(text);
    }
  });

  it('is square and has the finder pattern in three corners', () => {
    const m = qrMatrix('hello');
    expect(m.every((row) => row.length === m.length)).toBe(true);
    for (const [r, c] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]] as const) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 3]![c + 3]).toBe(true);
      expect(m[r + 1]![c + 1]).toBe(false);
    }
  });
});

describe('Emergency Kit document', () => {
  const html = buildEmergencyKitHtml(kit, 'https://app.example.org', english);

  it('contains the account details and the Secret Key, with an empty field for the password', () => {
    for (const text of [kit.accountId, kit.email, kit.server, kit.secretKeyText, kit.generatedOn]) expect(html).toContain(text);
    expect(html).toMatch(/Master password[\s\S]{0,200}_{8,}/);
  });

  it('warns not to keep the password and the Secret Key together, and that nobody can recover lost credentials', () => {
    expect(html).toMatch(/do not (store|keep) (the|your) password (with|alongside|together)/i);
    expect(html).toMatch(/no one[^.]*cannot?[^.]*recover|cannot be recovered/i);
  });

  it('is a self-contained, inert document: no scripts, no external resources, no network', () => {
    expect(html).not.toMatch(/<script|<link|<iframe|<object|<embed|@import|url\(|\son\w+=|src=["']https?:|href=["']https?:/i);
    expect(html).toMatch(/<svg[\s\S]*<\/svg>/); // the QR is inline
  });

  it('escapes everything it is given', () => {
    const evil = buildEmergencyKitHtml({ ...kit, email: '"><script>alert(1)</script>@x.com', server: 'https://r.example.com/"><img src=x onerror=alert(1)>' }, 'https://app.example.org', english);
    expect(evil).not.toContain('<script>alert(1)');
    expect(evil).not.toMatch(/<img[^>]*onerror/i);
    expect(evil).toContain('&lt;script&gt;');
  });

  it('is written in the chosen language, and says so for screen readers and printers', () => {
    const pl = buildEmergencyKitHtml(kit, 'https://app.example.org', polish);
    expect(pl).toMatch(/<html lang="pl" dir="ltr">/);
    expect(pl).toContain('<title>Zestaw awaryjny Cashfold</title>');
    expect(pl).toContain('Hasło główne');
    expect(pl).toContain('Nie przechowuj hasła razem z tą stroną.');
    expect(pl).not.toContain('Master password');
    for (const text of [kit.accountId, kit.email, kit.secretKeyText]) expect(pl).toContain(text);
  });

  it('escapes translated text too', () => {
    const evil: KitLanguage = { ...english, t: createTranslator('en', { en: { ...ENGLISH, 'kit.doc.password': '<img src=x onerror=alert(1)>' } }) };
    expect(buildEmergencyKitHtml(kit, 'https://app.example.org', evil)).not.toMatch(/<img[^>]*onerror/i);
  });

  it('prints cleanly on paper: a print stylesheet and a language/direction declaration', () => {
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/@media print/);
  });
});

describe('copy with auto-clear (FR-016: clipboard copies need an explicit action and are cleared after 60 s)', () => {
  it('writes the text, then overwrites the clipboard after the delay', async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const clipboard = { writeText: async (t: string) => void written.push(t) };
    await copyWithAutoClear('SECRET', 60_000, clipboard);
    expect(written).toEqual(['SECRET']);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(written).toEqual(['SECRET']);
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual(['SECRET', '']);
    vi.useRealTimers();
  });

  it('reports failure without throwing when the clipboard is unavailable', async () => {
    expect(await copyWithAutoClear('x', 1000, undefined)).toBe(false);
    expect(await copyWithAutoClear('x', 1000, { writeText: async () => { throw new Error('denied'); } })).toBe(false);
  });

  it('only clears if nothing newer was copied by this helper in between', async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const clipboard = { writeText: async (t: string) => void written.push(t) };
    await copyWithAutoClear('FIRST', 60_000, clipboard);
    await vi.advanceTimersByTimeAsync(30_000);
    await copyWithAutoClear('SECOND', 60_000, clipboard);
    await vi.advanceTimersByTimeAsync(30_000); // the first timer fires now, but SECOND is on the clipboard
    expect(written).toEqual(['FIRST', 'SECOND']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(written).toEqual(['FIRST', 'SECOND', '']);
    vi.useRealTimers();
  });
});
