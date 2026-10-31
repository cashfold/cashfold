'use client';

import { HELP_SHORTCUTS, type HelpShortcut } from '@cashfold/platform';
import { useEffect, useId } from 'react';
import { useChecklistStatus, type ChecklistStatus } from '../firstrun/checklist-status';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Button, DescriptionDetails, DescriptionList, DescriptionTerm, Dialog, DialogActions, DialogBody, DialogTitle, Subheading, Text } from '../kit';
import { type DesktopPlatform } from '../desktop/desktop-store';
import { formatShortcut } from '../desktop/format-shortcut';
import { useDesktop } from '../desktop/useDesktop';
import { subscribeOverlays } from './overlay-signal';
import { isApplePlatform } from '../palette/palette-keys';

function ShortcutGroup({ title, shortcuts, platform, t }: { title: string; shortcuts: readonly HelpShortcut[]; platform: DesktopPlatform; t: Translate }) {
  const id = useId();
  const system = platform === 'darwin' ? 'mac' : 'other';
  return (
    <div className="mt-4">
      <Subheading level={4} id={id}>{title}</Subheading>
      <DescriptionList aria-labelledby={id} className="mt-1">
        {shortcuts.map((s) => {
          const written = formatShortcut(s.keys[system], platform);
          return (
            <div key={s.id} className="contents">
              <DescriptionTerm>{t(`help.shortcut.${s.id}`)}</DescriptionTerm>
              <DescriptionDetails>
                <kbd className="font-sans font-medium whitespace-nowrap" aria-label={written.spoken}>{written.text}</kbd>
              </DescriptionDetails>
            </div>
          );
        })}
      </DescriptionList>
    </div>
  );
}

/**
 * What the help dialog says. The keyboard shortcuts are shown only in the desktop app (`platform` is undefined in a browser); the getting-started part is
 * a button while steps are left and a plain line once they are all done.
 */
export function HelpContent({ t, platform, status, onShowCard, apple = false }: { t: Translate; platform: DesktopPlatform | undefined; status: ChecklistStatus; onShowCard: () => void; apple?: boolean }) {
  return (
    <>
      {platform === undefined ? (
        // In a browser the web app has two keyboard shortcuts: the command palette (spec 015, FR-021) and Privacy mode (spec 016, FR-010).
        <section aria-label={t('help.shortcuts.heading')}>
          <Subheading level={3}>{t('help.shortcuts.heading')}</Subheading>
          <ShortcutGroup title={t('help.shortcuts.app')} shortcuts={HELP_SHORTCUTS.filter((s) => s.action === 'palette' || s.action === 'privacy')} platform={apple ? 'darwin' : 'linux'} t={t} />
        </section>
      ) : (
        <section aria-label={t('help.shortcuts.heading')}>
          <Subheading level={3}>{t('help.shortcuts.heading')}</Subheading>
          <Text className="mt-1">{t('help.shortcuts.locked')}</Text>
          <ShortcutGroup title={t('help.shortcuts.app')} shortcuts={HELP_SHORTCUTS.filter((s) => s.group === 'app')} platform={platform} t={t} />
          <ShortcutGroup title={t('help.shortcuts.standard')} shortcuts={HELP_SHORTCUTS.filter((s) => s.group === 'standard')} platform={platform} t={t} />
        </section>
      )}
      {status.known ? (
        <section aria-label={t('help.start.heading')} className="mt-8">
          <Subheading level={3}>{t('help.start.heading')}</Subheading>
          {status.complete ? <Text className="mt-1">{t('help.start.done')}</Text> : <Button className="mt-2" onClick={onShowCard}>{t('help.start.show')}</Button>}
        </section>
      ) : null}
    </>
  );
}

/** Reads the platform and the getting-started status only while the dialog is on screen. */
function HelpBody({ onShowCard }: { onShowCard: () => void }) {
  const { t } = useI18n();
  const { platform } = useDesktop();
  const status = useChecklistStatus();
  return <HelpContent t={t} platform={platform} status={status} onShowCard={onShowCard} apple={isApplePlatform()} />;
}

/** The dialog the Help item opens. It closes with Escape or Close, and when a desktop shortcut arrives. */
export function HelpDialog({ open, onClose, onShowCard }: { open: boolean; onClose: () => void; onShowCard: () => void }) {
  const { t } = useI18n();
  useEffect(() => (open ? subscribeOverlays(onClose) : undefined), [open, onClose]);
  return (
    <Dialog open={open} onClose={onClose} size="lg" placement="sheet">
      <DialogTitle>{t('help.title')}</DialogTitle>
      <DialogBody>
        <HelpBody onShowCard={onShowCard} />
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>{t('help.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
