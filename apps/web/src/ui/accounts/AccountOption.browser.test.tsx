import axe from 'axe-core';
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { CurrencyCode, Id } from '@cashfold/core';
import '../../app/globals.css';
import { Field, Label, Select } from '../kit';
import { AccountOptionView } from './AccountOption';

// The account option in a real browser: name and balance for every kind of account, the balance kept whole next to a long name on a narrow
// screen, no axe violations and the keyboard (FR-001, FR-004, FR-005, FR-006, FR-008; SC-004, SC-006).

const cur = (c: string) => c as CurrencyCode;
const id = (v: string) => v as Id;
const LONG = 'A savings account with a very long descriptive name that keeps going and going to fill the line';
const accounts = [
  { id: id('a1'), name: 'Checking', currency: cur('USD'), balanceMinor: 123456n },
  { id: id('a2'), name: 'Card', currency: cur('USD'), balanceMinor: -5000n },
  { id: id('a3'), name: 'Empty', currency: cur('EUR'), balanceMinor: 0n },
  { id: id('a4'), name: 'Złoty', currency: cur('PLN'), balanceMinor: 99n },
  { id: id('a5'), name: 'Huge', currency: cur('USD'), balanceMinor: null },
  { id: id('a6'), name: LONG, currency: cur('USD'), balanceMinor: 7_000_000n },
];

let root: Root | undefined;
let host: HTMLElement | undefined;

function Host({ onChoose }: { onChoose?: (id: string) => void }) {
  const [value, setValue] = useState('a1');
  return (
    <main style={{ width: 360 }}>
      <Field>
        <Label>Account</Label>
        <Select value={value} onChange={(v) => { setValue(v); onChoose?.(v); }}>
          {accounts.map((a) => <AccountOptionView key={a.id} account={a} locale="en" />)}
        </Select>
      </Field>
    </main>
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
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

const settle = () => new Promise((r) => setTimeout(r, 300));
const open = async (el: HTMLElement) => {
  el.querySelector<HTMLElement>('button')!.focus();
  await userEvent.keyboard(' ');
  await settle();
  return [...document.querySelectorAll<HTMLElement>('[role=option]')];
};

describe('the account option', () => {
  it('shows each name with its own balance, and the name alone when there is no balance', async () => {
    const options = await open(mount(<Host />));
    const text = options.map((o) => o.textContent);
    expect(text[0]).toBe('Checking1,234.56 USD');
    expect(text[1]).toBe('Card−50.00 USD');
    expect(text[2]).toBe('Empty0.00 EUR');
    expect(text[3]).toMatch(/^Złoty.*PLN$/);
    expect(text[4]).toBe('Huge');
    expect(text[5]).toMatch(/^A savings account.*70,000\.00 USD$/);
  });

  it('keeps the balance whole and shortens the name on a narrow screen', async () => {
    const options = await open(mount(<Host />));
    const long = options[5]!;
    const balance = long.querySelector<HTMLElement>('[data-testid=account-option-balance]')!;
    const label = long.querySelector<HTMLElement>('span.truncate')!;
    expect(balance.scrollWidth).toBeLessThanOrEqual(balance.clientWidth);
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    expect(balance.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('shows the chosen account, balance included, in the closed control', async () => {
    const el = mount(<Host />);
    expect(el.querySelector('button')!.textContent).toContain('1,234.56 USD');
  });

  it.each(['light', 'dark'] as const)('has no accessibility violations open, in the %s theme', async (theme) => {
    const el = mount(<Host />, theme);
    await open(el);
    const result = await axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  it('is chosen with the keyboard alone', async () => {
    const chosen: string[] = [];
    await open(mount(<Host onChoose={(id) => chosen.push(id)} />));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await settle();
    expect(chosen).toEqual(['a2']);
  });
});
