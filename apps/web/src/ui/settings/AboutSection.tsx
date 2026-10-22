'use client';

import type { AboutInfo } from '@cashfold/platform';
import { useEffect, useState } from 'react';
import { getDesktopBridge } from '../../adapters/platform';
import { useI18n } from '../i18n/I18nProvider';
import { Button, DescriptionDetails, DescriptionList, DescriptionTerm, Link, Text } from '../kit';
import { UpdateControls } from './UpdateControls';

type View = { readonly kind: 'loading' } | { readonly kind: 'web' } | { readonly kind: 'desktop'; readonly info: AboutInfo } | { readonly kind: 'failed' };

/** The release version this web build belongs to; the same number names the desktop installers (one version for everything we ship). */
const WEB_VERSION = process.env['NEXT_PUBLIC_CASHFOLD_VERSION'] ?? '0.0.0';

/**
 * Settings → Advanced → About: which version is running. In the desktop app it also says what it runs on, where the data lives (with a button
 * that opens the folder), and where the source of this exact version is (FR-009, FR-026, FR-028; the AGPL asks us to offer the source).
 */
export function AboutSection() {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [revealFailed, setRevealFailed] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge === undefined) return setView({ kind: 'web' });
    let current = true;
    bridge.about().then(
      (info) => current && setView({ kind: 'desktop', info }),
      () => current && setView({ kind: 'failed' }),
    );
    return () => {
      current = false;
    };
  }, []);

  if (view.kind === 'loading') return null;
  return (
    <section aria-labelledby="about-heading" className="mt-10">
      <h2 id="about-heading" className="text-lg font-semibold">{t('settings.about.title')}</h2>
      <Text>{t('settings.about.when')}</Text>
      {view.kind === 'failed' ? <p role="status" className="mt-3 text-sm text-muted">{t('settings.about.unavailable')}</p> : null}
      {view.kind !== 'failed' ? (
        <DescriptionList className="mt-3">
          <DescriptionTerm>{t('settings.about.version')}</DescriptionTerm>
          <DescriptionDetails data-testid="about-version">{view.kind === 'desktop' ? view.info.version : WEB_VERSION}</DescriptionDetails>
          {view.kind === 'desktop' ? (
            <>
              <DescriptionTerm>{t('settings.about.build')}</DescriptionTerm>
              <DescriptionDetails className="break-all font-mono text-sm" data-testid="about-build">{view.info.buildId}</DescriptionDetails>
              <DescriptionTerm>{t('settings.about.engine')}</DescriptionTerm>
              <DescriptionDetails>{t('settings.about.engineValue', { electron: view.info.electron, chromium: view.info.chromium })}</DescriptionDetails>
              <DescriptionTerm>{t('settings.about.system')}</DescriptionTerm>
              <DescriptionDetails>{t('settings.about.systemValue', { os: t(`settings.about.os.${view.info.os}`), arch: view.info.arch })}</DescriptionDetails>
              <DescriptionTerm>{t('settings.about.installedAs')}</DescriptionTerm>
              <DescriptionDetails>{t(`settings.about.packaging.${view.info.packaging}`)}</DescriptionDetails>
              <DescriptionTerm>{t('settings.about.signature')}</DescriptionTerm>
              <DescriptionDetails>{view.info.signed ? t('settings.about.signature.signed') : t('settings.about.signature.unsigned')}</DescriptionDetails>
              <DescriptionTerm>{t('settings.about.dataFolder')}</DescriptionTerm>
              <DescriptionDetails>
                <span className="break-all" data-testid="about-data-path">{view.info.dataPath}</span>
                <span className="mt-2 block">
                  <Button
                    outline
                    type="button"
                    data-testid="about-show-folder"
                    onClick={() => {
                      setRevealFailed(false);
                      void getDesktopBridge()?.revealDataFolder().catch(() => setRevealFailed(true));
                    }}
                  >
                    {t('settings.about.showFolder')}
                  </Button>
                </span>
                <span role="status" className="mt-1 block text-sm text-muted">{revealFailed ? t('settings.about.revealFailed') : ''}</span>
                <span className="mt-1 block text-sm text-muted">{t('settings.about.dataHelp')}</span>
              </DescriptionDetails>
              <DescriptionTerm>{t('settings.about.source')}</DescriptionTerm>
              <DescriptionDetails>
                <Link href={view.info.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{t('settings.about.sourceLink')}</Link>
              </DescriptionDetails>
              <DescriptionTerm>{t('settings.about.licence')}</DescriptionTerm>
              <DescriptionDetails>{t('settings.about.licenceValue')}</DescriptionDetails>
            </>
          ) : null}
        </DescriptionList>
      ) : null}
      {view.kind === 'desktop' ? <UpdateControls info={view.info} /> : null}
    </section>
  );
}
