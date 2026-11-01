import axe from 'axe-core';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../app/globals.css';
import { I18nProvider } from '../i18n/I18nProvider';
import { EyeIcon, Navbar, NavbarItem, NavbarLabel, NavbarSection, NavbarSpacer, PlusIcon, Sidebar, SidebarFooter, SidebarItem, SidebarLabel, SidebarSection } from '../kit';
import { PrivacySidebarItem, PrivacyTopbarItem } from './PrivacySwitch';
import { PrivacyContext } from './usePrivacy';

// The Privacy mode switch in a real browser (spec 017): no axe violations in either theme and state, the keyboard works and keeps focus, and a long
// translated label or a 320 px top bar does not overflow or overlap.

let root: Root | undefined;
let host: HTMLElement | undefined;

function mount(node: React.ReactNode, theme: 'light' | 'dark', width: number): HTMLElement {
  document.documentElement.dataset['theme'] = theme;
  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  document.documentElement.style.fontSize = '';
});

async function violations(scope: Element): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 250));
  const result = await axe.run(scope, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** The real provider with a real state, the way the app holds it. */
function Harness({ initial = false, children }: { initial?: boolean; children: React.ReactNode }) {
  const [on, setOn] = useState(initial);
  return (
    <I18nProvider>
      <PrivacyContext.Provider value={{ on, toggle: () => setOn((v) => !v), reveal: () => undefined }}>{children}</PrivacyContext.Provider>
    </I18nProvider>
  );
}

const sidebar = (long = false) => (
  <Sidebar aria-label="Navigation" style={{ width: 256 }}>
    <SidebarFooter>
      <SidebarSection>
        <PrivacySidebarItem />
        <SidebarItem data-testid="next">
          <EyeIcon data-slot="icon" aria-hidden="true" />
          <SidebarLabel>{long ? 'Довга назва наступного пункту навігації для перевірки' : 'Help'}</SidebarLabel>
        </SidebarItem>
      </SidebarSection>
    </SidebarFooter>
  </Sidebar>
);

const topbar = (
  <header>
    <Navbar>
      <NavbarLabel className="truncate font-semibold">A very long page title that has to truncate before it pushes the buttons</NavbarLabel>
      <NavbarSpacer />
      <NavbarSection>
        <PrivacyTopbarItem />
        <NavbarItem aria-label="Add" className="min-h-11 min-w-11 justify-center" data-testid="add"><PlusIcon aria-hidden="true" /></NavbarItem>
      </NavbarSection>
    </Navbar>
  </header>
);

describe('the sidebar item', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const initial of [false, true]) {
      it(`has no axe violations in ${theme}, with the mode ${initial ? 'on' : 'off'}`, async () => {
        const el = mount(<Harness initial={initial}><main>{sidebar()}</main></Harness>, theme, 256);
        expect(await violations(el)).toEqual([]);
      });
    }
  }

  it('is a switch named by its visible label, reached with Tab, toggled with Space, and keeps focus', async () => {
    const el = mount(<Harness><main>{sidebar()}</main></Harness>, 'light', 256);
    const control = el.querySelector<HTMLElement>('[data-testid="privacy-switch"]')!;
    expect(control.getAttribute('role')).toBe('switch');
    expect(control.getAttribute('aria-checked')).toBe('false');
    // The accessible name is the visible text of the row.
    const labelledby = control.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledby)!.textContent).toBe('Privacy mode');
    await userEvent.tab();
    expect(document.activeElement).toBe(control);
    await userEvent.keyboard(' ');
    expect(control.getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard(' ');
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(control);
  });

  it('is toggled by a press on its label too', async () => {
    const el = mount(<Harness><main>{sidebar()}</main></Harness>, 'light', 256);
    const control = el.querySelector<HTMLElement>('[data-testid="privacy-switch"]')!;
    await userEvent.click(el.querySelector<HTMLElement>('label')!);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps a long label inside the sidebar at a large text size, without overlapping the item below', async () => {
    document.documentElement.style.fontSize = '24px';
    const el = mount(<Harness initial><main>{sidebar(true)}</main></Harness>, 'light', 256);
    const control = el.querySelector<HTMLElement>('[data-testid="privacy-switch"]')!;
    const row = control.parentElement!;
    el.querySelector<HTMLElement>('label')!.textContent = 'Режим приватності, довгий переклад для перевірки';
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    const a = row.getBoundingClientRect();
    const b = el.querySelector<HTMLElement>('[data-testid="next"]')!.getBoundingClientRect();
    expect(a.bottom).toBeLessThanOrEqual(b.top + 0.5);
    expect(a.right).toBeLessThanOrEqual(el.getBoundingClientRect().right);
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(el.getBoundingClientRect().right);
  });

  it('turns its transitions off for people who ask for reduced motion', () => {
    const el = mount(<Harness><main>{sidebar()}</main></Harness>, 'light', 256);
    const control = el.querySelector<HTMLElement>('[data-testid="privacy-switch"]')!;
    expect(control.className).toContain('motion-reduce:transition-none');
    expect(control.firstElementChild!.className).toContain('motion-reduce:transition-none');
  });
});

describe('the top-bar button', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const initial of [false, true]) {
      it(`has no axe violations in ${theme}, with the mode ${initial ? 'on' : 'off'}`, async () => {
        const el = mount(<Harness initial={initial}>{topbar}</Harness>, theme, 320);
        expect(await violations(el)).toEqual([]);
      });
    }
  }

  it('is reached with Tab, toggles with Enter and Space, and keeps focus', async () => {
    const el = mount(<Harness>{topbar}</Harness>, 'light', 320);
    const control = el.querySelector<HTMLElement>('[data-testid="privacy-switch-topbar"]')!;
    await userEvent.tab();
    expect(document.activeElement).toBe(control);
    await userEvent.keyboard('{Enter}');
    expect(control.getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard(' ');
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(control);
  });

  it('fits a 320 px row with a long title: no sideways scroll, both buttons at least 44 px square and not overlapping', async () => {
    const el = mount(<Harness>{topbar}</Harness>, 'light', 320);
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    // The size classes are on the item's wrapper (the button sits inside it), the same as the Add button's.
    const privacy = el.querySelector<HTMLElement>('[data-testid="privacy-switch-topbar"]')!.parentElement!.getBoundingClientRect();
    const add = el.querySelector<HTMLElement>('[data-testid="add"]')!.parentElement!.getBoundingClientRect();
    for (const box of [privacy, add]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(privacy.right).toBeLessThanOrEqual(add.left + 0.5);
    expect(add.right).toBeLessThanOrEqual(el.getBoundingClientRect().right);
  });
});
