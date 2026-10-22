'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { LedgerProvider, useLedger } from '../ledger/LedgerProvider';
import { ArrowsRightLeftIcon, AuthLayout, BanknotesIcon, InformationCircleIcon, Button, Cog6ToothIcon, FlagIcon, HomeIcon, LockClosedIcon, PlusIcon,
  Sidebar, SidebarBody, SidebarFooter, SidebarHeader, SidebarItem, SidebarLabel, SidebarLayout, SidebarSection, Badge } from '../kit';
import { prefsStore } from '../prefs/usePrefs';
import { SyncIndicator } from '../sync/SyncIndicator';
import { AddSheetHost } from '../transactions/AddSheetHost';
import { useScheduleInbox } from '../transactions/useScheduleInbox';
import { useAddSheet } from './add-context';
import { Topbar } from './Topbar';
import { OverlayHost } from './OverlayHost';
import { FoldSwitcher } from './FoldSwitcher';
import { PrivacyCover } from './PrivacyCover';
import { PRIMARY_SECTIONS, matchSection, type Section } from './routes';
import { StatusProvider } from './StatusProvider';
import { StorageNotice } from './StorageNotice';
import { UpdateNotice } from './UpdateNotice';

const ICONS: Record<Section['icon'], typeof HomeIcon> = {
  home: HomeIcon,
  transactions: ArrowsRightLeftIcon,
  accounts: BanknotesIcon,
  plan: FlagIcon,
  settings: Cog6ToothIcon,
};

/** The shell keeps one ledger for every screen, so a screen asks it to read again when the person arrives (another tab may have changed things). */
function RouteRefresh() {
  const ledger = useLedger();
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void ledger.refreshFolds();
    void ledger.reload();
  }, [path]);
  return null;
}

function SkipLink() {
  const { t } = useI18n();
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-(--primary) focus:px-3 focus:py-2 focus:text-(--on-primary)">
      {t('skip.main')}
    </a>
  );
}

function Banners() {
  const { t } = useI18n();
  const core = useCore();
  return (
    <>
      {core.removed ? (
        <p role="alert" className="mb-4 rounded-lg border border-(--border-strong) bg-(--surface) px-4 py-3">
          {t('removed.notice')} <Link className="underline" href="/add/">{t('removed.addAgain')}</Link>
        </p>
      ) : null}
      {core.storageFull ? (
        <p role="alert" data-testid="storage-full" className="mb-4 rounded-lg border border-(--border-strong) bg-(--surface) px-4 py-3">{t('storage.full')}</p>
      ) : null}
      <StorageNotice />
      <UpdateNotice />
    </>
  );
}

function NavigationSidebar() {
  const { t } = useI18n();
  const core = useCore();
  const path = usePathname();
  const { openAdd } = useAddSheet();
  const router = useRouter();
  const current = matchSection(path);
  const waiting = useScheduleInbox().length;
  return (
    <Sidebar aria-label={t('nav.label')}>
      <SidebarHeader>
        <Link href="/" className="rounded-lg px-2 py-1 text-lg font-semibold text-zinc-950 dark:text-white">{t('app.name')}</Link>
        <FoldSwitcher />
        <Button className="mt-3" onClick={() => openAdd()}>
          <PlusIcon data-slot="icon" aria-hidden="true" />
          {t('shell.add')}
        </Button>
      </SidebarHeader>
      <SidebarBody>
        <SidebarSection>
          {PRIMARY_SECTIONS.map((section) => {
            const Icon = ICONS[section.icon];
            return (
              <SidebarItem key={section.id} href={section.href} current={current === section.id}>
                <Icon data-slot="icon" aria-hidden="true" />
                <SidebarLabel>{t(section.labelKey)}</SidebarLabel>
                {section.id === 'transactions' && waiting > 0 ? <Badge color="primary">{waiting}<span className="sr-only"> {t('schedules.inbox.waiting')}</span></Badge> : null}
              </SidebarItem>
            );
          })}
        </SidebarSection>
      </SidebarBody>
      <SidebarFooter>
        <SyncIndicator />
        <SidebarSection className="mt-2">
          <SidebarItem onClick={() => { prefsStore.update((p) => ({ ...p, firstRun: { dismissed: false } })); router.push('/overview/'); }}>
            <InformationCircleIcon data-slot="icon" aria-hidden="true" />
            <SidebarLabel>{t('shell.help')}</SidebarLabel>
          </SidebarItem>
          <SidebarItem onClick={() => core.lock()}>
            <LockClosedIcon data-slot="icon" aria-hidden="true" />
            <SidebarLabel>{t('lock.button')}</SidebarLabel>
          </SidebarItem>
        </SidebarSection>
      </SidebarFooter>
    </Sidebar>
  );
}

/** The signed-in shell: persistent sidebar (a drawer on narrow screens), one `<main id="main">`, banners and the add sheet host. */
function UnlockedShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const core = useCore();
  return (
    <LedgerProvider>
      <StatusProvider>
        <AddSheetHost>
          <SidebarLayout navbar={<Topbar />} sidebar={<NavigationSidebar />} openLabel={t('shell.menu')} closeLabel={t('shell.closeMenu')} contentInert={core.covered}>
            <RouteRefresh />
            <Banners />
            {children}
          </SidebarLayout>
        </AddSheetHost>
      </StatusProvider>
    </LedgerProvider>
  );
}

/** Before sign-in there is no navigation: a plain header with the brand, then the page (sign-up, unlock, recover, add device). */
function PlainShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const core = useCore();
  return (
    <>
      <header className="flex items-center gap-x-6 border-b border-(--border-strong) bg-(--surface) px-4 py-3">
        <Link href="/" className="text-lg font-semibold">{t('app.name')}</Link>
      </header>
      <AuthLayout><div inert={core.covered}><Banners />{children}</div></AuthLayout>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const core = useCore();
  return (
    <>
      <SkipLink />
      <OverlayHost>{core.phase === 'unlocked' ? <UnlockedShell>{children}</UnlockedShell> : <PlainShell>{children}</PlainShell>}</OverlayHost>
      {core.covered ? <PrivacyCover /> : null}
    </>
  );
}
