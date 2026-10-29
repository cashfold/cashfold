import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/i18n';
import { RelayNeededView } from './RelayNeeded';

const t = createTranslator('en');

describe('the notice that sharing needs a service (FR-007b)', () => {
  const html = renderToStaticMarkup(<RelayNeededView t={t} id="relay-needed" />);

  it('says so in one sentence and links to the Sync settings', () => {
    expect(html).toContain(ENGLISH['sharing.relayNeeded']);
    expect(html).toContain(ENGLISH['sharing.relayNeeded.link']);
    expect(html).toMatch(/href="\/settings\/sync\/?"/); // the app's trailing slash is added by the router
  });

  it('has an id the disabled controls can point at', () => {
    expect(html).toContain('id="relay-needed"');
  });
});
