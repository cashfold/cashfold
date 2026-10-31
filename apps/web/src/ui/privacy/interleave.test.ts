import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CATALOGS, createTranslator, loadCatalogue } from '../i18n/i18n';
import { interleaveMessage } from './interleave';

// Each part comes back wrapped in a keyed fragment: unwrap it to the words or to the node.
const names = (parts: readonly ReactNode[]): string[] =>
  parts.map((part) => {
    const child = isValidElement(part) ? (part.props as { children?: ReactNode }).children : part;
    return isValidElement(child) ? `<${(child.props as { name?: string }).name}>` : String(child);
  });
const node = (name: string): ReactNode => ({ type: 'span', props: { name }, key: null, ref: null, $$typeof: Symbol.for('react.transitional.element') }) as unknown as ReactNode;

describe('putting amounts into a translated sentence', () => {
  it('keeps the words and puts each node where its placeholder was (English)', () => {
    const t = createTranslator('en');
    expect(names(interleaveMessage(t, 'budgets.ratio', { spent: node('S'), limit: node('L') }))).toEqual(['<S>', ' of ', '<L>']);
    expect(names(interleaveMessage(t, 'schedules.transferAmount', { out: node('A'), into: node('B') }))).toEqual(['<A>', ' → ', '<B>']);
  });

  it.each(['uk', 'pl'])('works the same in %s', async (locale) => {
    const t = createTranslator(locale, { ...CATALOGS, [locale]: await loadCatalogue(locale) });
    const parts = names(interleaveMessage(t, 'budgets.ratio', { spent: node('S'), limit: node('L') }));
    expect(parts.filter((p) => p.startsWith('<'))).toEqual(['<S>', '<L>']);
    expect(parts.join('')).not.toMatch(/spent|limit|\u0001/);
  });

  it('keeps the order the language chooses, even when it swaps the placeholders', () => {
    const t = createTranslator('en', { en: { x: '{b} before {a}' } });
    expect(names(interleaveMessage(t, 'x', { a: node('A'), b: node('B') }))).toEqual(['<B>', ' before ', '<A>']);
  });

  it('leaves no placeholder token behind when a node is missing', () => {
    const t = createTranslator('en');
    const parts = interleaveMessage(t, 'budgets.ratio', { spent: node('S') });
    expect(names(parts).join('')).not.toContain('\u0001');
  });
});
