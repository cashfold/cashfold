import axe from 'axe-core';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import { I18nProvider } from '../i18n/I18nProvider';
import { CommandPalette, ANNOUNCE_DELAY_MS } from './CommandPalette';
import type { EntryType, PaletteEntry } from './entry';

// The palette in a real browser (spec 015, US1 and US4): the combobox and listbox contract, the keyboard, the announcements, focus in and out, and axe in
// both themes with two primary colours.

let root: Root | undefined;
let host: HTMLElement | undefined;

const entry = (id: string, title: string, type: EntryType = 'account', over: Partial<PaletteEntry> = {}): PaletteEntry => ({ id, type, title, keywords: [], run: () => undefined, ...over });
const ENTRIES = [
  entry('c:go-settings', 'Settings', 'screen', { keywords: ['preferences'] }),
  entry('c:lock-now', 'Lock now', 'action'),
  entry('a:1', 'Checking', 'account', { secondary: 'EUR' }),
  entry('a:2', 'Café', 'account', { secondary: 'Family · EUR' }),
  entry('e:1', 'Groceries', 'envelope', { secondary: 'EUR' }),
  entry('g:1', 'Holiday', 'goal'),
];

function Harness({ entries = ENTRIES, loadingMore = false, onChoose }: { entries?: readonly PaletteEntry[]; loadingMore?: boolean; onChoose: (e: PaletteEntry) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <main>
        <button type="button" id="opener" onClick={() => setOpen(true)}>Open</button>
        <CommandPalette open={open} onClose={() => setOpen(false)} entries={entries} loadingMore={loadingMore} shortcut="Ctrl+K" onChoose={(e) => { setOpen(false); onChoose(e); }} />
      </main>
    </I18nProvider>
  );
}

function mount(onChoose: (e: PaletteEntry) => void = () => undefined, props: { entries?: readonly PaletteEntry[]; loadingMore?: boolean } = {}, theme: 'light' | 'dark' = 'light') {
  document.documentElement.dataset['theme'] = theme;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Harness onChoose={onChoose} {...props} />));
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  delete document.documentElement.dataset['primary'];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opener = () => document.getElementById('opener')!;
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const selected = () => options().filter((o) => o.getAttribute('aria-selected') === 'true');
const status = () => document.querySelector('[role="status"]')!.textContent;
async function openPalette() {
  await userEvent.click(opener());
  await vi.waitFor(() => expect(input()).toBeTruthy());
}

describe('opening the palette', () => {
  it('opens with the field focused, named, with the shortcut in the placeholder', async () => {
    mount();
    await openPalette();
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).toContain('Ctrl+K');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Command palette');
  });

  it('groups the entries by type under headings, in a fixed order, each row with its type', async () => {
    mount();
    await openPalette();
    const groups = [...document.querySelectorAll('[role="group"]')].map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent);
    expect(groups).toEqual(['Screens', 'Actions', 'Accounts', 'Budgets', 'Goals']);
    expect(options()[2]!.textContent).toBe('Checking EUR Account');
  });

  it('follows the combobox contract: controls the listbox, names the highlighted option', async () => {
    mount();
    await openPalette();
    const list = document.querySelector('[role="listbox"]')!;
    expect(input().getAttribute('aria-controls')).toBe(list.id);
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    expect(selected()).toHaveLength(1);
  });
});

describe('searching', () => {
  it('narrows with letters that are not next to each other and highlights them without colour alone', async () => {
    mount();
    await openPalette();
    await userEvent.type(input(), 'chk');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Checking')]);
    const marks = [...options()[0]!.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['Ch', 'k']);
    expect(getComputedStyle(marks[0]!).textDecorationLine).toContain('underline');
  });

  it('ignores case and accents', async () => {
    mount();
    await openPalette();
    await userEvent.type(input(), 'CAFE');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Café')]);
  });

  it('finds a screen by a hidden keyword', async () => {
    mount();
    await openPalette();
    await userEvent.type(input(), 'prefer');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Settings')]);
  });

  it('says there are no results, and Enter then does nothing', async () => {
    const chosen = vi.fn();
    mount(chosen);
    await openPalette();
    await userEvent.type(input(), 'zzzz');
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain('No results');
    await userEvent.keyboard('{Enter}');
    expect(chosen).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('starts empty on every open', async () => {
    mount();
    await openPalette();
    await userEvent.type(input(), 'chk');
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await openPalette();
    expect(input().value).toBe('');
  });
});

describe('the keyboard', () => {
  it('moves with the arrows, wrapping at both ends, and Home and End jump', async () => {
    mount();
    await openPalette();
    const count = options().length;
    await userEvent.keyboard('{ArrowUp}');
    expect(options().indexOf(selected()[0]!)).toBe(count - 1);
    await userEvent.keyboard('{ArrowDown}');
    expect(options().indexOf(selected()[0]!)).toBe(0);
    await userEvent.keyboard('{End}');
    expect(options().indexOf(selected()[0]!)).toBe(count - 1);
    await userEvent.keyboard('{Home}');
    expect(options().indexOf(selected()[0]!)).toBe(0);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });

  it('runs the highlighted row with Enter and closes', async () => {
    const chosen = vi.fn();
    mount(chosen);
    await openPalette();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(chosen).toHaveBeenCalledTimes(1);
    expect(chosen.mock.calls[0]![0].id).toBe('a:1');
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it('acts on the row it shows after fast typing', async () => {
    const chosen = vi.fn();
    mount(chosen);
    await openPalette();
    await userEvent.type(input(), 'holi{Enter}');
    expect(chosen.mock.calls[0]![0].id).toBe('g:1');
  });

  it('closes with Escape and gives focus back to the control that opened it', async () => {
    mount();
    await openPalette();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(document.activeElement).toBe(opener());
  });

  it('keeps Tab inside the dialog and makes the page behind it unreachable', async () => {
    mount();
    await openPalette();
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
    }
    expect(document.getElementById('opener')!.closest('[inert],[aria-hidden="true"]')).toBeTruthy();
  });

  it('runs a row that is clicked', async () => {
    const chosen = vi.fn();
    mount(chosen);
    await openPalette();
    await userEvent.click(options().find((o) => o.textContent?.includes('Groceries'))!);
    expect(chosen.mock.calls[0]![0].id).toBe('e:1');
  });
});

describe('what a screen reader hears', () => {
  it('announces the number of results once typing settles, not on every key', async () => {
    mount();
    await openPalette();
    await userEvent.type(input(), 'c');
    expect(status()).toBe('');
    await vi.waitFor(() => expect(status()).toMatch(/^\d+ results?$/), { timeout: ANNOUNCE_DELAY_MS + 1500 });
    await userEvent.type(input(), 'hk');
    await vi.waitFor(() => expect(status()).toBe('1 result'), { timeout: ANNOUNCE_DELAY_MS + 1500 });
  });

  it('announces "No results" when nothing matches', async () => {
    mount();
    await openPalette();
    await userEvent.type(input(), 'zzzz');
    await vi.waitFor(() => expect(status()).toBe('No results'), { timeout: ANNOUNCE_DELAY_MS + 1500 });
  });

  it('says more results are loading while budgets and goals are read, and shows what it has', async () => {
    mount(undefined, { loadingMore: true });
    await openPalette();
    expect(options().length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('More results are loading');
    await vi.waitFor(() => expect(status()).toBe('More results are loading'), { timeout: ANNOUNCE_DELAY_MS + 1500 });
    expect(document.body.textContent).not.toContain('No results');
  });
});

describe('the list itself', () => {
  it('shows at most twenty rows and keeps the rest reachable by typing', async () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`a:${i}`, `Account ${i}`));
    mount(undefined, { entries: many });
    await openPalette();
    await userEvent.type(input(), 'account');
    expect(options()).toHaveLength(20);
    await userEvent.clear(input());
    await userEvent.type(input(), 'account 59');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('Account 59')]);
  });

  it('keeps the highlighted row when the list is rebuilt under the cursor', async () => {
    mount();
    await openPalette();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const before = selected()[0]!.id;
    root!.render(<Harness onChoose={() => undefined} entries={[...ENTRIES]} />);
    await sleep(50);
    expect(selected()).toHaveLength(1);
    expect(options().findIndex((o) => o.id === selected()[0]!.id)).toBe(options().findIndex((o) => o.id === before));
  });

  it('drops an entry that disappears while open, and the rest keeps working', async () => {
    mount();
    await openPalette();
    flushSync(() => root!.render(<Harness onChoose={() => undefined} entries={ENTRIES.filter((e) => e.id !== 'a:1')} />));
    await vi.waitFor(() => expect(options().some((o) => o.textContent?.includes('Checking'))).toBe(false));
    expect(selected()).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
});

async function violations(scope: Element): Promise<string[]> {
  await sleep(350); // transitions
  const result = await axe.run(scope, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('accessibility checks', () => {
  it.each([
    ['light', 'emerald'],
    ['dark', 'emerald'],
    ['light', 'violet'],
    ['dark', 'amber'],
  ] as const)('has no axe violations in %s with the %s primary colour, with and without a query', async (theme, primary) => {
    document.documentElement.dataset['primary'] = primary;
    mount(undefined, {}, theme);
    await openPalette();
    expect(await violations(document.body)).toEqual([]);
    await userEvent.type(input(), 'chk');
    expect(await violations(document.body)).toEqual([]);
    await userEvent.clear(input());
    await userEvent.type(input(), 'zzzz');
    expect(await violations(document.body)).toEqual([]);
  });
});
