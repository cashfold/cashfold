'use client';

import type { BudgetRow, GoalRow } from '@cashfold/core';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignOutDialogLazy } from '../auth/SignOutDialogLazy';
import { useCore } from '../core/CoreProvider';
import { formatShortcut } from '../desktop/format-shortcut';
import { useDesktop } from '../desktop/useDesktop';
import { useI18n } from '../i18n/I18nProvider';
import { useLedger } from '../ledger/LedgerProvider';
import { usePrefs } from '../prefs/usePrefs';
import { HelpDialog } from '../shell/HelpDialog';
import { useAddSheet } from '../shell/add-context';
import { afterOverlaysLeave, subscribeOverlays } from '../shell/overlay-signal';
import { showGettingStartedCard } from '../shell/show-card';
import { useTheme } from '../theme/ThemeProvider';
import { CommandPalette } from './CommandPalette';
import { paletteHistory, type HistoryItem } from './history';
import { emptyQuerySections, usageOf } from './ranking';
import './actions';
import './builtin-commands';
import { accountEntries, budgetEntries, commandEntries, goalEntries } from './entities';
import type { PaletteEntry } from './entry';
import { isApplePlatform, isPaletteKey, otherDialogOpen, paletteShortcutText } from './palette-keys';
import { subscribePalette } from './palette-bus';
import { registry, type PaletteContext } from './registry';

const selectShowArchived = (p: { lists: { showArchivedAccounts: boolean } }): boolean => p.lists.showArchivedAccounts;

/**
 * Mounted in the unlocked shell only, so a locked app has no palette: nothing to open, no listener, no names. It owns the open state, listens for the key
 * in a browser (the desktop shell sends the `palette` action instead), reads budgets and goals while open, and hands the dialog its entries.
 */
export function PaletteHost() {
  const { t } = useI18n();
  const core = useCore();
  const ledger = useLedger();
  const router = useRouter();
  const { openAdd } = useAddSheet();
  const { resolved, setChoice } = useTheme();
  const desktop = useDesktop();
  const showArchived = usePrefs(selectShowArchived);

  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const [budgets, setBudgets] = useState<readonly BudgetRow[]>([]);
  const [goals, setGoals] = useState<readonly GoalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [history, setHistory] = useState<readonly HistoryItem[]>([]);

  const apple = useMemo(() => isApplePlatform(), []);
  const shortcut = desktop.platform === undefined ? paletteShortcutText(apple) : formatShortcut({ modifiers: ['primary'], key: 'K' }, desktop.platform).text;

  const close = useCallback(() => setOpen(false), []);
  const tryOpen = useCallback(() => {
    if (otherDialogOpen(document)) return;
    setHistory(paletteHistory.load());
    setOpen(true);
  }, []);

  // The signal from the desktop action; the browser's own key below.
  useEffect(
    () =>
      subscribePalette((request) => {
        if (request === 'toggle' && openRef.current) close();
        else if (!openRef.current) tryOpen();
      }),
    [close, tryOpen],
  );
  useEffect(() => {
    if (desktop.isDesktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteKey(event, apple)) return;
      event.preventDefault();
      if (openRef.current) close();
      else tryOpen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop.isDesktop, apple, close, tryOpen]);

  // Another desktop shortcut closes the palette first (spec 008, FR-017), and the cover closes it so no name is left under it.
  useEffect(() => (open ? subscribeOverlays(() => (openRef.current ? (close(), true) : false)) : undefined), [open, close]);
  useEffect(() => {
    if (core.covered) close();
  }, [core.covered, close]);

  // Budgets and goals are read when the palette opens, with the two queries the Plan screen uses, and let go of when it closes: the names are not kept.
  const latest = useRef(ledger);
  latest.current = ledger;
  const foldId = ledger.fold?.id;
  useEffect(() => {
    if (!open) {
      setBudgets([]);
      setGoals([]);
      return;
    }
    let live = true;
    setLoading(true);
    void Promise.all([
      latest.current.read<BudgetRow[]>('budgets.list').catch(() => [] as BudgetRow[]),
      latest.current.read<GoalRow[]>('goals.progress').catch(() => [] as GoalRow[]),
    ]).then(([b, g]) => {
      if (!live) return;
      setBudgets(b);
      setGoals(g);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [open, foldId]);

  const basics = ledger.basics;
  const accountCount = basics === undefined ? 0 : basics.accounts.filter((a) => !a.archived).length;
  const ctx = useMemo<PaletteContext>(
    () => ({
      navigate: (href) => router.push(href),
      openAdd: () => openAdd(),
      lock: () => void core.lock(),
      toggleTheme: () => setChoice(resolved === 'dark' ? 'light' : 'dark'),
      openSignOut: () => setSignOutOpen(true),
      openHelp: () => setHelpOpen(true),
      accounts: accountCount,
      foldId,
    }),
    [router, openAdd, core, setChoice, resolved, accountCount, foldId],
  );

  const entries = useMemo<PaletteEntry[]>(() => {
    if (!open) return [];
    return [
      ...commandEntries(registry.list(ctx), t),
      ...(basics === undefined ? [] : accountEntries(basics.accounts, basics.groups, showArchived)),
      ...budgetEntries(budgets),
      ...goalEntries(goals),
    ];
  }, [open, ctx, t, basics, showArchived, budgets, goals]);

  // The palette leaves the screen first, then the choice runs, so a dialog it opens is not fighting the palette's closing focus.
  const choose = useCallback(
    (entry: PaletteEntry) => {
      paletteHistory.record(entry.id);
      close();
      afterOverlaysLeave(() => entry.run(ctx));
    },
    [close, ctx],
  );

  const usage = useMemo(() => usageOf(history), [history]);
  const emptySections = useCallback(
    (all: readonly PaletteEntry[]) =>
      emptyQuerySections(all, history, { recent: t('palette.group.recent'), frequent: t('palette.group.frequent'), screen: t('palette.group.screen'), action: t('palette.group.action') }),
    [history, t],
  );

  return (
    <>
      <CommandPalette open={open} onClose={close} entries={entries} loadingMore={loading} usage={usage} emptySections={emptySections} shortcut={shortcut} onChoose={choose} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onShowCard={() => (setHelpOpen(false), showGettingStartedCard(router))} />
      {core.account === undefined ? null : (
        <SignOutDialogLazy open={signOutOpen} onClose={() => setSignOutOpen(false)} email={core.account.email} kind={core.account.registration === 'done' ? 'service' : 'local'} locked={false} />
      )}
    </>
  );
}
