import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HELP_SHORTCUTS } from '@cashfold/platform';
import { checklistStatus } from '../firstrun/checklist-status';
import { createTranslator, ENGLISH } from '../i18n/i18n';
import { HelpContent } from './HelpDialog';

const t = createTranslator('en');
const open = checklistStatus({ folds: 1, accounts: 0, transactions: 0 });
const done = checklistStatus({ folds: 1, accounts: 1, transactions: 1 });
const render = (platform: 'darwin' | 'win32' | 'linux' | undefined, status = open) => renderToStaticMarkup(<HelpContent t={t} platform={platform} status={status} onShowCard={() => undefined} />);

describe('the shortcuts in the help dialog', () => {
  it('lists every shortcut by its plain name, written as a Mac writes it', () => {
    const html = render('darwin');
    for (const s of HELP_SHORTCUTS) expect(html, s.id).toContain(ENGLISH[`help.shortcut.${s.id}`]!.replace('&', '&amp;'));
    expect(html).toContain('⌘N');
    expect(html).toContain('⇧⌘I');
    expect(html).toContain('⌃⌘F');
  });

  it('writes them as Windows and Linux do', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const html = render(platform);
      expect(html).toContain('Ctrl+N');
      expect(html).toContain('Ctrl+Shift+I');
      expect(html).toContain('F11');
      expect(html).not.toContain('⌘');
    }
  });

  it('has the two groups and says only Lock works while locked', () => {
    const html = render('linux');
    expect(html).toContain(ENGLISH['help.shortcuts.app']);
    expect(html).toContain(ENGLISH['help.shortcuts.standard']);
    expect(html).toContain(ENGLISH['help.shortcuts.locked']);
  });

  it('reads each shortcut as its name with its keys spelled out', () => {
    const html = render('darwin');
    expect(html).toContain('Shift, Command, I');
    expect(html).toContain('<kbd');
  });

  it('is not shown in a browser, where the web app has none of these shortcuts', () => {
    const html = render(undefined);
    expect(html).not.toContain(ENGLISH['help.shortcuts.heading']);
    expect(html).not.toContain(ENGLISH['help.shortcuts.locked']);
    expect(html).not.toContain('<kbd');
  });
});

describe('getting started in the help dialog', () => {
  it('offers the button while steps are left, in the desktop app and in a browser', () => {
    for (const platform of ['darwin', undefined] as const) {
      const html = render(platform);
      expect(html).toContain(ENGLISH['help.start.show']);
      expect(html).not.toContain(ENGLISH['help.start.done']);
    }
  });

  it('says it is finished, with no button, when every step is done', () => {
    const html = render('darwin', done);
    expect(html).toContain(ENGLISH['help.start.done']);
    expect(html).not.toContain(ENGLISH['help.start.show']);
  });

  it('shows neither until the steps are known', () => {
    const html = render(undefined, checklistStatus(undefined));
    expect(html).not.toContain(ENGLISH['help.start.show']);
    expect(html).not.toContain(ENGLISH['help.start.done']);
  });
});
