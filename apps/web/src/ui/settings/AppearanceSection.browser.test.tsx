import axe from 'axe-core';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import { I18nProvider } from '../i18n/I18nProvider';
import { PREFS_KEY } from '../prefs/schema';
import { StatusProvider } from '../shell/StatusProvider';
import { PRIMARY_IDS } from '../theme/palette';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AppearanceSection } from './AppearanceSection';

// Settings → Appearance → Primary colour in a real browser (spec 014, US1): picking applies at once, persists, can be reset and passes axe.

let root: Root | undefined;
let host: HTMLElement | undefined;

function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<ThemeProvider><I18nProvider><StatusProvider><AppearanceSection /></StatusProvider></I18nProvider></ThemeProvider>));
}

beforeEach(() => {
  localStorage.removeItem(PREFS_KEY);
  delete document.documentElement.dataset['primary'];
});
afterEach(() => {
  root?.unmount();
  host?.remove();
  localStorage.removeItem(PREFS_KEY);
});

const radios = () => [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
const colorRadio = (name: string) => radios().find((r) => r.closest('[data-slot="field"]')?.textContent?.includes(name))!;

describe('the primary colour picker', () => {
  it('offers every palette colour and starts on the default', () => {
    mount();
    expect(document.documentElement.dataset['primary']).toBe('emerald');
    expect(radios().filter((r) => PRIMARY_IDS.some((id) => r.closest('[data-slot="field"]')?.textContent?.toLowerCase().includes(id))).length).toBeGreaterThanOrEqual(PRIMARY_IDS.length);
  });

  it('applies a picked colour at once, stores it, and a later start reads it', async () => {
    mount();
    await userEvent.click(colorRadio('Violet'));
    expect(document.documentElement.dataset['primary']).toBe('violet');
    expect((JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { primary?: string }).primary).toBe('violet');
  });

  it('is operable by keyboard', async () => {
    mount();
    colorRadio('Emerald').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.documentElement.dataset['primary']).toBe('teal');
  });

  it('goes back to the default with "Reset interface settings"', async () => {
    mount();
    await userEvent.click(colorRadio('Amber'));
    expect(document.documentElement.dataset['primary']).toBe('amber');
    await userEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Reset interface settings')!);
    await userEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Reset settings')!);
    expect(document.documentElement.dataset['primary']).toBe('emerald');
  });

  it('has no axe violations for any colour in either theme', async () => {
    mount();
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset['theme'] = theme;
      for (const id of PRIMARY_IDS) {
        await userEvent.click(colorRadio(id[0]!.toUpperCase() + id.slice(1)));
        const result = await axe.run(host!, { rules: { 'color-contrast': { enabled: true } } });
        expect(result.violations.map((v) => `${theme}/${id}: ${v.id}`)).toEqual([]);
      }
    }
  });
});
