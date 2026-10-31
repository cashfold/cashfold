'use client';

import { usePathname } from 'next/navigation';
import { lazy, Suspense } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Navbar, NavbarItem, NavbarLabel, NavbarSection, NavbarSpacer, PlusIcon } from '../kit';
import { useAddSheet } from './add-context';
import { PRIMARY_SECTIONS, matchSection } from './routes';

// The switch is in the privacy chunk, so it is not part of the JavaScript every page loads up front.
const PrivacyTopbarItemLazy = lazy(() => import('../privacy/PrivacySwitch').then((module) => ({ default: module.PrivacyTopbarItem })));

/** The bar for widths below `lg`: the menu button (from the layout), the page title and a persistent Add button (FR-003, FR-007). */
export function Topbar() {
  const { t } = useI18n();
  const { openAdd } = useAddSheet();
  const id = matchSection(usePathname() ?? '');
  const current = PRIMARY_SECTIONS.find((s) => s.id === id);
  return (
    <Navbar>
      {current ? <NavbarLabel className="truncate font-semibold">{t(current.labelKey)}</NavbarLabel> : null}
      <NavbarSpacer />
      <NavbarSection>
        <Suspense fallback={null}><PrivacyTopbarItemLazy /></Suspense>
        <NavbarItem onClick={() => openAdd()} aria-label={t('shell.add')} className="min-h-11 min-w-11 justify-center">
          <PlusIcon aria-hidden="true" />
        </NavbarItem>
      </NavbarSection>
    </Navbar>
  );
}
