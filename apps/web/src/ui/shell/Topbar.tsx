'use client';

import { usePathname } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';
import { Navbar, NavbarItem, NavbarLabel, NavbarSection, NavbarSpacer, PlusIcon } from '../kit';
import { useAddSheet } from './add-context';
import { PRIMARY_SECTIONS, matchSection } from './routes';

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
        <NavbarItem onClick={() => openAdd()} aria-label={t('shell.add')} className="min-h-11 min-w-11 justify-center">
          <PlusIcon aria-hidden="true" />
        </NavbarItem>
      </NavbarSection>
    </Navbar>
  );
}
