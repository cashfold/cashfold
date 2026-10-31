import axe from 'axe-core';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import { I18nProvider } from '../i18n/I18nProvider';
import { Amount, Stat } from '../kit';
import { clear, reveal, REVEAL_MS } from './reveal-store';
import { PrivacyContext, type PrivacyApi } from './usePrivacy';

// Masked and revealed amounts in a real browser (spec 016, US1): nothing readable while masked, one amount at a time on click, Enter, Space or a tap,
// hiding again by itself, focus kept, nothing nested inside something clickable, and no axe violations in either theme.

let root: Root | undefined;
let host: HTMLElement | undefined;

const api = (on: boolean): PrivacyApi => ({ on, toggle: () => undefined, reveal });

function Screen({ on = true }: { on?: boolean }) {
  const [clicks, setClicks] = useState(0);
  return (
    <PrivacyContext.Provider value={api(on)}>
      <I18nProvider>
        <main>
          <h1>Money</h1>
          <p data-testid="first"><Amount minor={123_456n} currency="USD" locale="en" tone="auto" showSign /></p>
          <p data-testid="second"><Amount minor={123_456n} currency="USD" locale="en" tone="auto" showSign /></p>
          <p data-testid="third"><Amount minor={-450n} currency="EUR" locale="en" /></p>
          <table>
            <caption>Months</caption>
            <thead><tr><th scope="col">Month</th><th scope="col">Net</th></tr></thead>
            <tbody><tr><th scope="row">2026-10</th><td data-testid="cell"><Amount minor={99_900n} currency="USD" locale="en" align="end" showSign /></td></tr></tbody>
          </table>
          <Stat label="Net worth" value={<Amount minor={5_000_000n} currency="USD" locale="en" />} />
          <a href="#row" data-testid="link" onClick={() => setClicks((n) => n + 1)}>
            <Amount minor={777n} currency="USD" locale="en" inert />
          </a>
          <output data-testid="clicks">{clicks}</output>
        </main>
      </I18nProvider>
    </PrivacyContext.Provider>
  );
}

function mount(node: React.ReactNode, theme: 'light' | 'dark' = 'light'): HTMLElement {
  document.documentElement.dataset['theme'] = theme;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

afterEach(() => {
  clear();
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

const amountIn = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"] > span`)!;
const FIGURE = /\d[\d.,\s]*[.,]\d{2}\b|[+−]\d/;

describe('masked amounts', () => {
  it('show no figure, sign, direction or colour anywhere in the page, and keep the currency code', () => {
    mount(<Screen />);
    for (const id of ['first', 'second', 'third', 'cell']) {
      const el = amountIn(id);
      expect(el.textContent).toMatch(/^•••• [A-Z]{3}$/);
      expect(el.getAttribute('data-sign')).toBeNull();
      expect(el.className).not.toMatch(/success|danger/);
    }
    const everything = [...document.querySelectorAll('main *')].flatMap((e) => [e.textContent ?? '', ...[...e.attributes].map((a) => a.value)]).join(' ');
    expect(everything.replace(/2026-10/g, '')).not.toMatch(FIGURE);
  });

  it('are buttons named as hidden amounts, reachable by keyboard', async () => {
    mount(<Screen />);
    const first = amountIn('first');
    expect(first.getAttribute('role')).toBe('button');
    expect(first.getAttribute('aria-label')).toBe('Hidden amount, USD. Press to reveal.');
    expect(amountIn('third').getAttribute('aria-label')).toBe('Hidden amount, EUR. Press to reveal.');
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
  });

  it('keep the same width as the mask whatever the figure', () => {
    mount(<Screen />);
    expect(amountIn('first').getBoundingClientRect().width).toBe(amountIn('second').getBoundingClientRect().width);
  });

  it('keep a table cell and a line the same size when one is revealed (a typical figure), and stay on one line (SC-004)', async () => {
    mount(<Screen />);
    const cell = document.querySelector<HTMLElement>('[data-testid=cell]')!;
    const line = document.querySelector<HTMLElement>('[data-testid=first]')!;
    const before = { cellWidth: cell.getBoundingClientRect().width, lineHeight: line.getBoundingClientRect().height };
    await userEvent.click(amountIn('cell'));
    await userEvent.click(amountIn('first'));
    expect(amountIn('cell').textContent).toBe('+999.00 USD');
    expect(cell.getBoundingClientRect().width).toBe(before.cellWidth);
    expect(line.getBoundingClientRect().height).toBe(before.lineHeight);
  });

  it('look as before when the mode is off', () => {
    mount(<Screen on={false} />);
    expect(amountIn('first').textContent).toBe('+1,234.56 USD');
    expect(amountIn('first').getAttribute('role')).toBeNull();
    expect(amountIn('first').getAttribute('data-sign')).toBe('gain');
  });
});

describe('revealing one amount', () => {
  it('shows only the amount that was clicked, even when another has the same figure', async () => {
    mount(<Screen />);
    await userEvent.click(amountIn('first'));
    expect(amountIn('first').textContent).toBe('+1,234.56 USD');
    expect(amountIn('second').textContent).toBe('•••• USD');
    expect(amountIn('third').textContent).toBe('•••• EUR');
  });

  it.each([['Enter', '{Enter}'], ['Space', ' ']])('works with the %s key and keeps keyboard focus', async (_name, keys) => {
    mount(<Screen />);
    await userEvent.tab();
    const first = document.activeElement as HTMLElement;
    await userEvent.keyboard(keys);
    expect(first.textContent).toBe('+1,234.56 USD');
    expect(document.activeElement).toBe(first);
  });

  it('works with a touch tap', async () => {
    mount(<Screen />);
    const el = amountIn('third');
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    el.click();
    await vi.waitFor(() => expect(amountIn('third').textContent).toBe('−4.50 EUR'));
  });

  it('is read as the figure once shown, and a hidden amount again after it hides', async () => {
    mount(<Screen />);
    await userEvent.click(amountIn('first'));
    expect(amountIn('first').getAttribute('aria-label')).toBeNull();
    expect(amountIn('first').getAttribute('role')).toBeNull();
    clear();
    await vi.waitFor(() => expect(amountIn('first').getAttribute('aria-label')).toBe('Hidden amount, USD. Press to reveal.'));
  });

  it('hides again by itself after about five seconds, and focus stays where it was', async () => {
    expect(REVEAL_MS).toBeGreaterThanOrEqual(4000);
    expect(REVEAL_MS).toBeLessThanOrEqual(6000);
    mount(<Screen />);
    await userEvent.tab();
    const first = document.activeElement as HTMLElement;
    await userEvent.keyboard('{Enter}');
    expect(first.textContent).toBe('+1,234.56 USD');
    await vi.waitFor(() => expect(first.textContent).toBe('•••• USD'), { timeout: REVEAL_MS + 3000 });
    expect(document.activeElement).toBe(first);
  });

  it('hides everything at once when the store is cleared (navigation, leaving the window, lock)', async () => {
    mount(<Screen />);
    await userEvent.click(amountIn('first'));
    await userEvent.click(amountIn('third'));
    clear();
    await vi.waitFor(() => {
      expect(amountIn('first').textContent).toBe('•••• USD');
      expect(amountIn('third').textContent).toBe('•••• EUR');
    });
  });
});

describe('inside something clickable', () => {
  it('is plain text, not a second control, and a click reveals it without following the link', async () => {
    mount(<Screen />);
    const inner = amountIn('link');
    expect(inner.getAttribute('role')).toBeNull();
    expect(inner.getAttribute('tabindex')).toBeNull();
    await userEvent.click(inner);
    expect(inner.textContent).toBe('7.77 USD');
    expect(document.querySelector('[data-testid=clicks]')!.textContent).toBe('0');
  });
});

describe('accessibility', () => {
  const violations = async (): Promise<string[]> => {
    await new Promise((r) => setTimeout(r, 250));
    const result = await axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  };

  it.each(['light', 'dark'] as const)('has no axe violations in the %s theme, masked and with one amount shown', async (theme) => {
    mount(<Screen />, theme);
    expect(await violations()).toEqual([]);
    await userEvent.click(amountIn('first'));
    expect(await violations()).toEqual([]);
  });
});
