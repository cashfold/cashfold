import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/i18n';
import { SignOutSectionView } from './SignOutSection';

const t = createTranslator('en');
const html = renderToStaticMarkup(<SignOutSectionView t={t} onOpen={() => undefined} />);

describe('the sign-out section in Settings (spec 011, FR-001)', () => {
  it('has its own heading, and a button that says what it does', () => {
    expect(html).toContain(ENGLISH['signout.title']);
    expect(html).toContain(`>${ENGLISH['signout.open']}<`);
  });

  it('says in one sentence that it is not Lock and not Delete', () => {
    expect(html).toContain(ENGLISH['signout.lede']);
    expect(ENGLISH['signout.lede']).toMatch(/Lock/);
    expect(ENGLISH['signout.lede']).toMatch(/Delete/);
  });
});
