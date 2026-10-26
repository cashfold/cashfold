import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SecretKeyScreen } from '../auth/SecretKeyScreen';
import { I18nProvider } from '../i18n/I18nProvider';
import { OneTimeSecret } from './OneTimeSecret';

// In the desktop app interface text cannot be selected (the shell's stylesheet), except what carries `data-selectable`. A value a person has to
// copy or read out must carry it, or it could not be.
const inI18n = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);

describe('values that stay selectable in the desktop app', () => {
  it('marks a Recovery Key or new Secret Key shown once', () => {
    const html = inI18n(<OneTimeSecret title="t" lede="l" warning="w" label="x" text="A3-KEY" testId="new-secret-key" fileName="f.txt" onDone={() => undefined} />);
    expect(html).toMatch(/<p[^>]*data-testid="new-secret-key"[^>]*data-selectable="true"|<p[^>]*data-selectable="true"[^>]*data-testid="new-secret-key"/);
  });

  it('marks the Secret Key shown at sign-up', () => {
    const created = { accountId: 'a', secretKeyText: 'A3-SECRET' } as never;
    const html = inI18n(<SecretKeyScreen created={created} email="a@b.c" server="https://x.test" onDone={async () => undefined} />);
    expect(html).toMatch(/data-testid="secret-key"[^>]*data-selectable="true"|data-selectable="true"[^>]*data-testid="secret-key"/);
  });
});
