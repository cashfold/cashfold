'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { clear, reveal, shownCount, subscribe } from './reveal-store';
import { PrivacyContext, type PrivacyApi } from './usePrivacy';

const selectPrivacy = (p: { privacyMode: boolean }): boolean => p.privacyMode;

/**
 * Mounted in the unlocked shell only, so a lock removes it and everything it holds. It owns the one rule that decides when revealed amounts hide again:
 * on navigation, when the window is left, when the privacy cover shows, when the mode is switched, and when the shell goes away (spec 016, FR-006).
 * It also says, politely and once, that amounts were shown or hidden.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { covered } = useCore();
  const path = usePathname();
  const on = usePrefs(selectPrivacy);
  const [announcement, setAnnouncement] = useState('');

  // Navigation, leaving the window, the cover, switching the mode, and the shell going away (a lock) all hide everything again.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clear();
  }, [path]);
  useEffect(() => {
    if (covered) clear();
  }, [covered]);
  useEffect(() => {
    clear();
  }, [on]);
  useEffect(() => {
    const leave = () => clear();
    window.addEventListener('blur', leave);
    return () => {
      window.removeEventListener('blur', leave);
      clear();
    };
  }, []);

  // One message when the first amount is shown and one when the last is hidden, not one per amount.
  useEffect(() => {
    let showing = shownCount() > 0;
    return subscribe(() => {
      const now = shownCount() > 0;
      if (now === showing) return;
      showing = now;
      setAnnouncement(now ? t('privacy.announce.shown') : t('privacy.announce.hidden'));
    });
  }, [t]);

  const toggle = useCallback(() => {
    prefsStore.update((p) => ({ ...p, privacyMode: !p.privacyMode }));
    clear();
  }, []);
  const api = useMemo<PrivacyApi>(() => ({ on, toggle, reveal }), [on, toggle]);

  return (
    <PrivacyContext.Provider value={api}>
      {children}
      <div role="status" className="sr-only">{announcement}</div>
    </PrivacyContext.Provider>
  );
}
