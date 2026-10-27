import { PRIMARY_SECTIONS } from '../shell/routes';
import type { FocusTarget } from './focus-request';

// What each action of the closed set (packages/platform ACTION_IDS) does in the page. The shell only says which one was chosen; the page, which owns
// the session and the screens, decides, and ignores whatever it should not do now. No action carries data.

export interface MenuActionDeps {
  readonly unlocked: boolean;
  openAdd(): void;
  lock(): void;
  navigate(href: string): void;
  focus(target: FocusTarget): void;
  /** Opens the Fold at this place in the list the page sent the shell (0 to 4). */
  openFold(index: number): void;
}

const SECTION_HREF = new Map(PRIMARY_SECTIONS.map((section) => [`go:${section.id}`, section.href]));

/** Does what the action asks. While locked only `lock` does anything; an id that is not one of these does nothing. */
export function performMenuAction(action: string, deps: MenuActionDeps): void {
  if (action === 'lock') return deps.lock();
  if (!deps.unlocked) return;
  const fold = /^open-fold:([0-4])$/.exec(action);
  if (fold !== null) return deps.openFold(Number(fold[1]));
  const section = SECTION_HREF.get(action);
  if (section !== undefined) return deps.navigate(section);
  switch (action) {
    case 'new-transaction':
      return deps.openAdd();
    case 'settings':
      return deps.navigate('/settings/');
    case 'search':
      deps.focus('transactions-search');
      return deps.navigate('/transactions/');
    case 'import':
      deps.focus('data-import');
      return deps.navigate('/settings/data/');
    case 'export':
      deps.focus('data-export');
      return deps.navigate('/settings/data/');
    default:
      return;
  }
}
