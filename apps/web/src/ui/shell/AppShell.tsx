'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { HelpDialog } from './HelpDialog';
import { dismissOverlays, subscribeOverlays } from './overlay-signal';
import { DesktopOnly } from '../desktop/lazy';
import { useDesktop } from '../desktop/useDesktop';
import { ReminderService } from '../desktop/ReminderService';
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

/** The Help item: opens the help dialog. The item renders its own dialog, so closing it returns focus here, in the sidebar and in the drawer alike. */
function HelpItem() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Brings the Getting started card back, as Help used to, and leaves the dialog and, on a narrow window, the drawer.
  const showCard = () => {
    prefsStore.update((p) => ({ ...p, firstRun: { dismissed: false } }));
    dismissOverlays();
    router.push('/overview/');
  };
  return (
    <>
      <SidebarItem onClick={() => setOpen(true)}>
        <InformationCircleIcon data-slot="icon" aria-hidden="true" />
        <SidebarLabel>{t('shell.help')}</SidebarLabel>
      </SidebarItem>
      <HelpDialog open={open} onClose={close} onShowCard={showCard} />
    </>
  );
}

function NavigationSidebar() {
  const { t } = useI18n();
  const { isDesktop } = useDesktop();
  const core = useCore();
  const path = usePathname();
  const { openAdd } = useAddSheet();
  const current = matchSection(path);
  const waiting = useScheduleInbox().length;
  return (
    <Sidebar aria-label={t('nav.label')}>
      <SidebarHeader>
        {/* The desktop window already carries the app's name (the title bar, the Dock, the taskbar), so the name here would only repeat it. */}
        {isDesktop ? null : <Link href="/" className="rounded-lg px-2 py-1 text-lg font-semibold text-zinc-950 dark:text-white">{t('app.name')}</Link>}
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
          <HelpItem />
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
          <SidebarLayout navbar={<Topbar />} sidebar={<NavigationSidebar />} openLabel={t('shell.menu')} closeLabel={t('shell.closeMenu')} contentInert={core.covered} subscribeDismiss={subscribeOverlays}>
            <RouteRefresh />
            <DesktopOnly load={() => import('../desktop/DesktopIdleLock')} />
            <DesktopOnly load={() => import('../desktop/DesktopActions')} />
            <DesktopOnly load={() => import('../desktop/DropTarget')} />
            <DesktopOnly load={() => import('../desktop/DesktopPresence')} />
            <ReminderService />
            <Banners />
            {children}
          </SidebarLayout>
        </AddSheetHost>
      </StatusProvider>
    </LedgerProvider>
  );
}

/** Before sign-in there is no navigation or header: just the page (sign-up, unlock, recover, add device) on the auth layout. */
function PlainShell({ children }: { children: ReactNode }) {
  const core = useCore();
  return (
    <AuthLayout><div inert={core.covered}><Banners />{children}</div></AuthLayout>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const core = useCore();
  return (
    <>
      <SkipLink />
      <DesktopOnly load={() => import('../desktop/DropGuard')} />
      <DesktopOnly load={() => import('../desktop/DesktopIncoming')} />
      <DesktopOnly load={() => import('../desktop/FrameBar')} />
      <DesktopOnly load={() => import('../desktop/FrameInsets')} />
      <OverlayHost>{core.phase === 'unlocked' ? <UnlockedShell>{children}</UnlockedShell> : <PlainShell>{children}</PlainShell>}</OverlayHost>
      {core.covered ? <PrivacyCover /> : null}
    </>
  );
}
