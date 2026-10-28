import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/i18n';
import { SignedOutChoicesView } from './SignedOutChoices';

const t = createTranslator('en');
const html = renderToStaticMarkup(<SignedOutChoicesView t={t} notice={undefined} onDismissNotice={() => undefined} />);

describe('the signed-out screen (spec 011, FR-010, FR-011)', () => {
  it('offers the three ways in, each to the screen that does it', () => {
    expect(html).toContain(ENGLISH['signedout.create']);
    expect(html).toContain(ENGLISH['signedout.signin']);
    expect(html).toContain(ENGLISH['signedout.recover']);
    expect(html).toMatch(/href="\/sign-up\/?"/);
    expect(html).toMatch(/href="\/add\/?"/);
    expect(html).toMatch(/href="\/recover\/?"/);
  });

  it('says that the person is signed out, as a heading below the page title', () => {
    expect(html).toContain(`<h2`);
    expect(html).toContain(ENGLISH['signedout.title']);
    expect(html).not.toContain('<h1');
  });

  it('names no account: no email address, no Fold, nothing of the previous account', () => {
    expect(html).not.toMatch(/@/);
  });
});

describe('the notice that this device may stay listed (spec 011, FR-009)', () => {
  it('shows it as a status when the sign-out could not remove the device from the service', () => {
    const shown = renderToStaticMarkup(<SignedOutChoicesView t={t} notice={{ deviceStillListed: true }} onDismissNotice={() => undefined} />);
    expect(shown).toContain(ENGLISH['signout.listed']);
    expect(shown).toContain('role="status"');
  });

  it('shows nothing extra when there is no notice, or when the device was removed from the list', () => {
    expect(renderToStaticMarkup(<SignedOutChoicesView t={t} notice={undefined} onDismissNotice={() => undefined} />)).not.toContain(ENGLISH['signout.listed']);
    expect(renderToStaticMarkup(<SignedOutChoicesView t={t} notice={{ deviceStillListed: false }} onDismissNotice={() => undefined} />)).not.toContain(ENGLISH['signout.listed']);
  });
});

