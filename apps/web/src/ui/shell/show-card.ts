import { prefsStore } from '../prefs/usePrefs';
import { dismissOverlays } from './overlay-signal';

/** Brings the Getting started card back, as Help used to, and leaves the dialog and, on a narrow window, the drawer. Shared by the Help item and the palette. */
export function showGettingStartedCard(router: { push(href: string): void }): void {
  prefsStore.update((p) => ({ ...p, firstRun: { dismissed: false } }));
  dismissOverlays();
  router.push('/overview/');
}
