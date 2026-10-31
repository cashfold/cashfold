'use client';

import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Dialog, DialogTitle, Input } from '../kit';
import { TYPE_ORDER, type EntryType, type PaletteEntry } from './entry';
import type { Match } from './fuzzy';
import { searchEntries, type Result } from './search';

// The palette itself (spec 015, contracts/ui-contract.md §5): a dialog holding one search field and a list, built as the ARIA combobox with a listbox.
// Focus never leaves the field; the arrow keys move `aria-activedescendant`. It knows nothing about where entries come from or what running one does.

/** How long typing must pause before the number of results is read out, so a screen reader does not talk over the person. */
export const ANNOUNCE_DELAY_MS = 300;

/** A heading and the rows under it. `key` is a type, or one of the empty-query sections. */
export interface Section {
  readonly key: string;
  readonly heading: string;
  readonly rows: readonly Result[];
}

const GROUP_HEADING: Readonly<Record<EntryType, string>> = {
  screen: 'palette.group.screen',
  action: 'palette.group.action',
  account: 'palette.group.account',
  envelope: 'palette.group.envelope',
  goal: 'palette.group.goal',
};

/** The matches grouped by type, the group with the best match first (a fixed order among equals), each group keeping the order of its matches. */
export function groupByType(results: readonly Result[], heading: (type: EntryType) => string): Section[] {
  const groups = new Map<EntryType, Result[]>();
  for (const result of results) {
    const rows = groups.get(result.entry.type) ?? [];
    rows.push(result);
    groups.set(result.entry.type, rows);
  }
  const best = (rows: readonly Result[]) => Math.max(...rows.map((r) => r.score));
  return [...groups.entries()]
    .sort(([a, rowsA], [b, rowsB]) => best(rowsB) - best(rowsA) || TYPE_ORDER[a] - TYPE_ORDER[b])
    .map(([type, rows]) => ({ key: type, heading: heading(type), rows }));
}

/** The title cut into plain and matched pieces, for highlighting without relying on colour. */
export function highlight(title: string, match: Match | undefined): { text: string; matched: boolean }[] {
  if (match === undefined || match.ranges.length === 0) return [{ text: title, matched: false }];
  const pieces: { text: string; matched: boolean }[] = [];
  let at = 0;
  for (const [start, end] of match.ranges) {
    if (start > at) pieces.push({ text: title.slice(at, start), matched: false });
    pieces.push({ text: title.slice(start, end), matched: true });
    at = end;
  }
  if (at < title.length) pieces.push({ text: title.slice(at), matched: false });
  return pieces;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly entries: readonly PaletteEntry[];
  /** Budgets and goals are still being read. */
  readonly loadingMore: boolean;
  /** Entry id to use count, for ordering equally good matches. */
  readonly usage?: ReadonlyMap<string, number>;
  /** What to show before anything is typed, instead of every entry. Absent means every entry. */
  readonly emptySections?: (entries: readonly PaletteEntry[]) => readonly Section[];
  /** The shortcut as the person's system writes it, for the placeholder. */
  readonly shortcut: string;
  readonly onChoose: (entry: PaletteEntry) => void;
}

export function CommandPalette({ open, onClose, entries, loadingMore, usage, emptySections, shortcut, onChoose }: CommandPaletteProps) {
  const { t } = useI18n();
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // A new open starts empty: the query is never kept.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const sections = useMemo<readonly Section[]>(() => {
    const typed = query.trim() !== '';
    if (!typed && emptySections !== undefined) return emptySections(entries);
    return groupByType(searchEntries(entries, query, usage), (type) => t(GROUP_HEADING[type]));
  }, [entries, query, usage, emptySections, t]);

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const optionId = (index: number) => `${id}-opt-${index}`;
  const current = rows[Math.min(active, Math.max(rows.length - 1, 0))];

  // The highlighted row is the first one again whenever the list changes under the cursor.
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(rows.length - 1, 0));
  }, [rows.length, active]);

  // The number of results is read out after typing settles (and "more are loading" while budgets and goals are read).
  useEffect(() => {
    if (!open) return;
    setAnnouncement('');
    const text = loadingMore ? t('palette.loadingMore') : rows.length === 0 ? t('palette.empty') : t('palette.count', { count: rows.length });
    const timer = setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, rows.length, loadingMore, t]);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    document.getElementById(optionId(Math.min(active, rows.length - 1)))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, rows.length]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0 && event.key !== 'Enter') return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => (index + 1) % rows.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => (index - 1 + rows.length) % rows.length);
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(rows.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        if (current !== undefined) onChoose(current.entry);
        return;
      default:
    }
  }

  let index = -1;
  return (
    <Dialog open={open} onClose={onClose} size="2xl" className="p-0!" data-palette="">
      <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
      <div className="p-3">
        <Input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current === undefined ? undefined : optionId(Math.min(active, rows.length - 1))}
          aria-label={t('palette.label')}
          placeholder={t('palette.placeholder', { shortcut })}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label={t('palette.results')} className="max-h-[min(24rem,60dvh)] overflow-y-auto border-t border-zinc-950/10 p-2 empty:hidden dark:border-white/10">
        {sections.map((section) => {
          const headingId = `${id}-h-${section.key}`;
          return (
            <div key={section.key} role="group" aria-labelledby={headingId}>
              <div id={headingId} role="presentation" className="px-2 pt-2 pb-1 text-xs font-semibold text-muted">{section.heading}</div>
              {section.rows.map((row) => {
                index += 1;
                const position = index;
                const selected = position === Math.min(active, rows.length - 1);
                const { entry } = row;
                return (
                  <div
                    key={`${section.key}:${entry.id}`}
                    id={optionId(position)}
                    role="option"
                    aria-selected={selected}
                    data-testid="palette-option"
                    onClick={() => onChoose(entry)}
                    onMouseMove={() => setActive(position)}
                    className={clsx(
                      'flex cursor-pointer items-baseline gap-3 rounded-lg border-s-2 px-2 py-2 text-sm text-zinc-950 dark:text-white',
                      selected ? 'border-(--primary) bg-zinc-950/5 dark:bg-white/10' : 'border-transparent',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {highlight(entry.title, row.title).map((piece, i) =>
                        piece.matched ? <mark key={i} className="bg-transparent font-semibold text-inherit underline underline-offset-2">{piece.text}</mark> : <span key={i}>{piece.text}</span>,
                      )}
                      {entry.secondary === undefined ? null : <span className="ms-2 text-muted"> {entry.secondary}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted"> {t(`palette.type.${entry.type}`)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {rows.length === 0 && !loadingMore ? <p className="border-t border-zinc-950/10 px-4 py-6 text-center text-sm text-muted dark:border-white/10">{t('palette.empty')}</p> : null}
      {loadingMore ? <p className="border-t border-zinc-950/10 px-4 py-2 text-xs text-muted dark:border-white/10">{t('palette.loadingMore')}</p> : null}
      <div role="status" className="sr-only">{announcement}</div>
    </Dialog>
  );
}
