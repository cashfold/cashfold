'use client';

import type { FoldSummary, Id, LedgerBasics } from '@cashfold/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCore } from '../core/CoreProvider';
import { useI18n } from '../i18n/I18nProvider';
import { sortedByName } from '../i18n/collation';
import { maskedMoney } from '../privacy/mask';
import { usePrivacy } from '../privacy/usePrivacy';
import { formatMoney, formatSigned, parseMoney } from './format';

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string; message?: string; currency?: string } };

export interface LedgerView {
  readonly folds: readonly FoldSummary[];
  readonly fold: FoldSummary | undefined;
  readonly selectFold: (id: string) => void;
  /** Accounts, categories, payees, tags and groups of the chosen Fold. Undefined until the first load. */
  readonly basics: (LedgerBasics & { thisDevice: string }) | undefined;
  /** Bumps after every change, so lists that load their own data know to ask again. */
  readonly version: number;
  readonly loading: boolean;
  readonly failed: boolean;
  /** Runs a ledger command on the chosen Fold, then refreshes. */
  readonly run: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<Outcome<T>>;
  /** Reads from the chosen Fold. Throws if the worker cannot answer. */
  readonly read: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
  readonly reload: () => Promise<void>;
  /** Reads the Fold list again (a Fold may have been created, restored or shared since). */
  readonly refreshFolds: () => Promise<void>;
  /** True after a Fold this account was taken out of disappeared from this device (FR-104); the Folds screen says so until it is dismissed. */
  readonly foldRemoved: boolean;
  readonly dismissFoldRemoved: () => void;
  readonly money: (minor: bigint, currency: string) => string;
  readonly signed: (minor: bigint, currency: string) => string;
  readonly parse: (text: string, currency: string) => ReturnType<typeof parseMoney>;
  /** A sentence for an error code, in the user's language. */
  readonly explain: (code: string) => string;
}

/** Commands whose effect shows in lists and totals but changes nothing that the next form is built from. */
const ENTRIES: ReadonlySet<string> = new Set([
  'ledger.addTransaction', 'ledger.updateTransaction', 'ledger.deleteTransaction', 'ledger.restoreTransaction',
  'ledger.addTransfer', 'ledger.updateTransfer', 'ledger.deleteTransfer', 'ledger.restoreTransfer',
]);

const Context = createContext<LedgerView | null>(null);

/** The ledger when there is one (the signed-in shell), or nothing (before sign-in). */
export function useOptionalLedger(): LedgerView | null {
  return useContext(Context);
}

export function useLedger(): LedgerView {
  const value = useContext(Context);
  if (value === null) throw new Error('useLedger must be used inside LedgerProvider');
  return value;
}

/** Holds the chosen Fold and its small, always-needed lists. Screens read the rest through `read`. */
export function LedgerProvider({ children }: { children: ReactNode }) {
  const core = useCore();
  const { t, locale } = useI18n();
  const { on: privacy } = usePrivacy();
  const [folds, setFolds] = useState<readonly FoldSummary[]>([]);
  const [foldId, setFoldId] = useState<string | undefined>();
  const [basics, setBasics] = useState<LedgerView['basics']>();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [foldRemoved, setFoldRemoved] = useState(false);

  const fold = useMemo(() => folds.find((f) => f.id === foldId) ?? folds[0], [folds, foldId]);

  const refreshFolds = useCallback(async () => {
    try {
      setFolds(await core.call<FoldSummary[]>('folds.list'));
    } catch {
      // The list stays as it was.
    }
  }, [core]);

  const reload = useCallback(async () => {
    if (fold === undefined) return;
    const result = await core.call<Outcome<NonNullable<LedgerView['basics']>>>('ledger.basics', { fold: fold.id });
    if (result.ok) setBasics(result.value);
    else setFailed(true);
    setVersion((n) => n + 1);
  }, [core, fold]);

  // Changes that arrive from other devices: the Fold list (a new Fold, a new name) and the open Fold's lists are asked again.
  useEffect(
    () =>
      core.subscribe((event) => {
        if (event.type === 'FoldRemoved') setFoldRemoved(true);
        if (event.type !== 'RemoteChanged' && event.type !== 'FoldRemoved') return;
        void core.call<FoldSummary[]>('folds.list').then(setFolds, () => undefined);
        void reload();
      }),
    [core, reload],
  );

  useEffect(() => {
    let live = true;
    core.call<FoldSummary[]>('folds.list').then(
      (list) => {
        if (!live) return;
        setFolds(list);
        if (list.length === 0) setLoading(false);
      },
      () => live && (setFailed(true), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [core]);

  useEffect(() => {
    if (fold === undefined) return;
    let live = true;
    setLoading(true);
    core.call<Outcome<NonNullable<LedgerView['basics']>>>('ledger.basics', { fold: fold.id }).then(
      (result) => {
        if (!live) return;
        if (result.ok) setBasics(result.value);
        else setFailed(true);
        setVersion((n) => n + 1);
        setLoading(false);
      },
      () => live && (setFailed(true), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [core, fold]);

  const run = useCallback(
    async <T,>(method: string, args: Record<string, unknown> = {}): Promise<Outcome<T>> => {
      if (fold === undefined) return { ok: false, error: { code: 'no_fold' } };
      const result = await core.call<Outcome<T>>(method, { fold: fold.id as Id, ...args });
      // The change is saved when the command answers. For entries the screens catch up when the view has been read again, which a person
      // should not wait for before the dialog closes (SC-008: adding a transaction takes 200 ms). Everything else (accounts, categories,
      // rates, ...) feeds the forms that come next, so it is read again before the answer is returned.
      if (result.ok) {
        if (ENTRIES.has(method)) void reload();
        else await reload();
      }
      return result;
    },
    [core, fold, reload],
  );

  const read = useCallback(
    async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (fold === undefined) throw new Error('no fold');
      const result = await core.call<Outcome<T>>(method, { fold: fold.id, ...args });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    },
    [core, fold],
  );

  const explain = useCallback(
    (code: string) => {
      const key = `ledger.error.${code}`;
      const text = t(key);
      return text === key ? t('ledger.error.generic') : text;
    },
    [t],
  );

  // Payees and tags come from core ordered by character code; what is shown follows the language (Ł after L, Ї after І).
  const shown = useMemo(() => (basics === undefined ? undefined : { ...basics, payees: sortedByName(basics.payees, locale), tags: sortedByName(basics.tags, locale) }), [basics, locale]);

  const value = useMemo<LedgerView>(
    () => ({
      folds, fold, selectFold: setFoldId, basics: shown, version, loading, failed, run, read, reload, refreshFolds, foldRemoved, dismissFoldRemoved: () => setFoldRemoved(false),
      // With Privacy mode on these give the same text with every digit a zero (spec 016, 018). Forms and exports use format.ts and the core, not these.
      money: (minor, currency) => (privacy ? maskedMoney(formatMoney(minor, currency, locale)) : formatMoney(minor, currency, locale)),
      signed: (minor, currency) => (privacy ? maskedMoney(formatSigned(minor, currency, locale)) : formatSigned(minor, currency, locale)),
      parse: (text, currency) => parseMoney(text, currency, locale),
      explain,
    }),
    [folds, fold, shown, version, loading, failed, run, read, reload, refreshFolds, foldRemoved, locale, explain, privacy],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
