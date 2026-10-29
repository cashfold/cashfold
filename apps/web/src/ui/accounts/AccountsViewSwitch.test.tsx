import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/i18n';
import { AccountsViewSwitchView } from './AccountsViewSwitch';

const t = createTranslator('en');
const render = (value: 'group' | 'type') => renderToStaticMarkup(<AccountsViewSwitchView t={t} value={value} onChange={() => undefined} />);

describe('the view switch on the Accounts page', () => {
  it('is a radio group with a visible label, so a screen reader announces the choice', () => {
    const html = render('group');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="View"');
    expect(html).toMatch(/>View<\/span>/); // and the same word is written on the page
  });

  it('has the two options, By group and By type', () => {
    const html = render('group');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toContain('By group');
    expect(html).toContain('By type');
  });

  it('checks the current one', () => {
    for (const [value, other] of [['group', 'type'], ['type', 'group']] as const) {
      const html = render(value);
      expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`aria-checked="true"[^>]*>(?:(?!role="radio").)*?${value === 'group' ? 'By group' : 'By type'}`, 's'));
      expect(other).not.toBe(value);
    }
  });
});
