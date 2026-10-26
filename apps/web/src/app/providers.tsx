'use client';

import { useEffect, type ReactNode } from 'react';
import { registerServiceWorker } from '../sw/register';
import { ErrorBoundary } from '../ui/errors/ErrorBoundary';
import { I18nProvider, useI18n } from '../ui/i18n/I18nProvider';
import { CoreProvider } from '../ui/core/CoreProvider';
import { DesktopSettingsProvider } from '../ui/desktop/DesktopSettingsProvider';
import { AppShell } from '../ui/shell/AppShell';
import { ThemeProvider } from '../ui/theme/ThemeProvider';
import { SupportGate } from '../ui/support/SupportGate';

function Inner({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <ErrorBoundary title={t('crash.title')} reload={t('crash.reload')}>
      <SupportGate>
        <AppShell>{children}</AppShell>
      </SupportGate>
    </ErrorBoundary>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    registerServiceWorker().catch(() => undefined);
  }, []);
  return (
    <ThemeProvider>
      <I18nProvider>
        <DesktopSettingsProvider>
          <CoreProvider>
            <Inner>{children}</Inner>
          </CoreProvider>
        </DesktopSettingsProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
