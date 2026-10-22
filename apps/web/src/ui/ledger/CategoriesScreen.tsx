'use client';

import type { Category, Label, UsageCounts } from '@cashfold/core';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '../forms/Modal';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { LedgerFrame } from './LedgerFrame';
import { useLedger } from './LedgerProvider';
import { COLOR_COUNT, ICON_KEYS, colorFor, iconFor } from './palette';
import { Button, Tabs, Select } from '../kit';

type Direction = 'expense' | 'income';
type Dialog =
  | { kind: 'new'; direction: Direction; parentId: string | null }
  | { kind: 'edit'; category: Category }
  | { kind: 'merge'; category: Category }
  | { kind: 'delete'; category: Category }
  | { kind: 'label'; table: 'payee' | 'tag'; label?: Label }
  | { kind: 'mergeLabel'; table: 'payee' | 'tag'; label: Label }
  | { kind: 'deleteLabel'; table: 'payee' | 'tag'; label: Label };


/** Waits for the Fold's lists, then shows the screen: the body below can rely on them being there. */
export function CategoriesScreen() {
  const { basics } = useLedger();
  if (basics === undefined) return <LedgerFrame titleKey="page.categories.title">{null}</LedgerFrame>;
  return <CategoriesBody />;
}

function CategoriesBody() {
  const { t } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const [usage, setUsage] = useState<UsageCounts | undefined>();
  const [dialog, setDialog] = useState<Dialog | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [tab, setTab] = useState<'expense' | 'income' | 'tag' | 'payee'>('expense');

  useEffect(() => {
    let live = true;
    ledger.read<UsageCounts>('ledger.usage').then((u) => live && setUsage(u), () => undefined);
    return () => {
      live = false;
    };
  }, [ledger.version]);

  const count = (map: ReadonlyMap<string, number> | undefined, id: string) => map?.get(id as never) ?? 0;
  const close = () => setDialog(undefined);
  const fail = (code: string) => setMessage(ledger.explain(code));

  /** Renumbers siblings so a move works even when positions were equal. */
  async function move(siblings: readonly Category[], index: number, delta: -1 | 1) {
    const order = [...siblings];
    const other = index + delta;
    if (other < 0 || other >= order.length) return;
    [order[index], order[other]] = [order[other]!, order[index]!];
    for (const [position, c] of order.entries()) {
      if (c.sortOrder !== position) await ledger.run('ledger.updateCategory', { id: c.id, changes: { sortOrder: position } });
    }
  }

  async function toggleArchive(c: Category) {
    const r = await ledger.run('ledger.updateCategory', { id: c.id, changes: { archived: !c.archived } });
    if (!r.ok) fail(r.error.code);
  }

  return (
    <LedgerFrame titleKey="page.categories.title">
      <p className="mt-3 text-muted">{t('ledger.categories.lede')}</p>
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}

      <Tabs
        className="mt-6" label={t('ledger.categories.tabs')} value={tab} onChange={(v) => setTab(v as typeof tab)}
        items={[{ value: 'expense', label: t('ledger.kind.expense') }, { value: 'income', label: t('ledger.kind.income') }, { value: 'tag', label: t('ledger.tag.title') }, { value: 'payee', label: t('ledger.payee.title') }]}
      />

      {(['expense', 'income'] as const).filter((direction) => tab === direction).map((direction) => {
        const inDirection = basics.categories.filter((c) => c.direction === direction);
        const roots = inDirection.filter((c) => c.parentId === null);
        return (
          <section key={direction} className="mt-8" aria-labelledby={`cat-${direction}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={`cat-${direction}`} className="text-lg font-semibold">{t(`ledger.categories.${direction}`)}</h2>
              <Button type="button" onClick={() => setDialog({ kind: 'new', direction, parentId: null })}>{t('ledger.categories.add', { kind: t(`ledger.kind.${direction}`) })}</Button>
            </div>
            {roots.length === 0 ? <p className="mt-2 text-muted">{t('ledger.categories.empty')}</p> : null}
            <ul className="mt-2 space-y-3" aria-label={t(`ledger.categories.${direction}`)}>
              {roots.map((root, rootIndex) => {
                const children = inDirection.filter((c) => c.parentId === root.id);
                return (
                  <li key={root.id} className="rounded-ui border border-border-strong" data-testid="category-root">
                    <CategoryRow
                      c={root} used={count(usage?.categories, root.id)} onEdit={() => setDialog({ kind: 'edit', category: root })} onMerge={() => setDialog({ kind: 'merge', category: root })}
                      onDelete={() => setDialog({ kind: 'delete', category: root })} onArchive={() => void toggleArchive(root)} onUp={rootIndex === 0 ? undefined : () => void move(roots, rootIndex, -1)}
                      onDown={rootIndex === roots.length - 1 ? undefined : () => void move(roots, rootIndex, 1)}
                      onAddChild={() => setDialog({ kind: 'new', direction, parentId: root.id })}
                    />
                    {children.length > 0 ? (
                      <ul className="ms-6 border-t border-border-strong" aria-label={root.name}>
                        {children.map((child, i) => (
                          <li key={child.id} data-testid="category-child">
                            <CategoryRow
                              c={child} used={count(usage?.categories, child.id)} onEdit={() => setDialog({ kind: 'edit', category: child })} onMerge={() => setDialog({ kind: 'merge', category: child })}
                              onDelete={() => setDialog({ kind: 'delete', category: child })} onArchive={() => void toggleArchive(child)} onUp={i === 0 ? undefined : () => void move(children, i, -1)}
                              onDown={i === children.length - 1 ? undefined : () => void move(children, i, 1)}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {tab === 'payee' ? <LabelSection table="payee" labels={basics.payees} usage={usage?.payees} onNew={() => setDialog({ kind: 'label', table: 'payee' })} onEdit={(label) => setDialog({ kind: 'label', table: 'payee', label })} onMerge={(label) => setDialog({ kind: 'mergeLabel', table: 'payee', label })} onDelete={(label) => setDialog({ kind: 'deleteLabel', table: 'payee', label })} /> : null}
      {tab === 'tag' ? <LabelSection table="tag" labels={basics.tags} usage={usage?.tags} onNew={() => setDialog({ kind: 'label', table: 'tag' })} onEdit={(label) => setDialog({ kind: 'label', table: 'tag', label })} onMerge={(label) => setDialog({ kind: 'mergeLabel', table: 'tag', label })} onDelete={(label) => setDialog({ kind: 'deleteLabel', table: 'tag', label })} /> : null}

      <Modal open={dialog?.kind === 'new' || dialog?.kind === 'edit'} title={dialog?.kind === 'edit' ? t('ledger.categories.edit', { name: dialog.category.name }) : t('ledger.categories.new')} onClose={close}>
        {dialog?.kind === 'new' || dialog?.kind === 'edit' ? <CategoryForm key={dialog.kind === 'edit' ? dialog.category.id : 'new'} dialog={dialog} onDone={close} /> : null}
      </Modal>

      <Modal open={dialog?.kind === 'merge'} title={t('ledger.categories.merge.title', { name: dialog?.kind === 'merge' ? dialog.category.name : '' })} onClose={close}>
        {dialog?.kind === 'merge' ? <MergeCategory from={dialog.category} used={count(usage?.categories, dialog.category.id)} onDone={close} /> : null}
      </Modal>

      <Modal open={dialog?.kind === 'delete'} title={t('ledger.categories.delete.title', { name: dialog?.kind === 'delete' ? dialog.category.name : '' })} onClose={close}>
        {dialog?.kind === 'delete' ? (
          <div>
            <p className="mt-3">{count(usage?.categories, dialog.category.id) > 0 || basics.categories.some((c) => c.parentId === dialog.category.id) ? t('ledger.categories.delete.inUse') : t('ledger.categories.delete.consequence')}</p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button" 
                onClick={async () => {
                  const r = await ledger.run('ledger.deleteCategory', { id: dialog.category.id });
                  if (r.ok) close();
                  else {
                    close();
                    fail(r.error.code);
                  }
                }}
              >{t('ledger.delete')}</Button>
              <Button outline type="button" onClick={close}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === 'label'} title={dialog?.kind === 'label' ? t(dialog.label ? `ledger.${dialog.table}.edit` : `ledger.${dialog.table}.new`) : ''} onClose={close}>
        {dialog?.kind === 'label' ? <LabelForm key={dialog.label?.id ?? 'new'} table={dialog.table} {...(dialog.label && { label: dialog.label })} onDone={close} /> : null}
      </Modal>

      <Modal open={dialog?.kind === 'mergeLabel'} title={dialog?.kind === 'mergeLabel' ? t('ledger.label.merge.title', { name: dialog.label.name }) : ''} onClose={close}>
        {dialog?.kind === 'mergeLabel' ? <MergeLabel table={dialog.table} from={dialog.label} used={count(dialog.table === 'payee' ? usage?.payees : usage?.tags, dialog.label.id)} onDone={close} /> : null}
      </Modal>

      <Modal open={dialog?.kind === 'deleteLabel'} title={dialog?.kind === 'deleteLabel' ? t('ledger.label.delete.title', { name: dialog.label.name }) : ''} onClose={close}>
        {dialog?.kind === 'deleteLabel' ? (
          <div>
            <p className="mt-3">{t('ledger.label.delete.consequence', { count: count(dialog.table === 'payee' ? usage?.payees : usage?.tags, dialog.label.id) })}</p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button" 
                onClick={async () => {
                  const r = await ledger.run(dialog.table === 'payee' ? 'ledger.deletePayee' : 'ledger.deleteTag', { id: dialog.label.id });
                  close();
                  if (!r.ok) fail(r.error.code);
                }}
              >{t('ledger.delete')}</Button>
              <Button outline type="button" onClick={close}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </LedgerFrame>
  );
}

function CategoryRow({ c, used, onEdit, onMerge, onDelete, onArchive, onUp, onDown, onAddChild }: {
  c: Category; used: number; onEdit: () => void; onMerge: () => void; onDelete: () => void; onArchive: () => void;
  onUp: (() => void) | undefined; onDown: (() => void) | undefined; onAddChild?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-4 w-4 rounded-ui" style={{ background: colorFor(c.color) }} />
        <span aria-hidden="true">{iconFor(c.icon)}</span>
        <strong>{c.name}</strong>
        <span className="text-sm text-muted">{t('ledger.categories.used', { count: used })}</span>
        {c.archived ? <span className="rounded-ui border border-border-strong px-2 text-sm">{t('ledger.accounts.archived')}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button outline type="button" onClick={onUp} disabled={onUp === undefined} aria-label={t('ledger.accounts.moveUp', { name: c.name })}>↑</Button>
        <Button outline type="button" onClick={onDown} disabled={onDown === undefined} aria-label={t('ledger.accounts.moveDown', { name: c.name })}>↓</Button>
        {onAddChild ? <Button outline type="button" onClick={onAddChild} aria-label={t('ledger.categories.addChild', { name: c.name })}>{t('ledger.categories.sub')}</Button> : null}
        <Button outline type="button" onClick={onEdit} aria-label={`${t('ledger.edit')} ${c.name}`}>{t('ledger.edit')}</Button>
        <Button outline type="button" onClick={onMerge} aria-label={`${t('ledger.categories.merge')} ${c.name}`}>{t('ledger.categories.merge')}</Button>
        <Button outline type="button" onClick={onArchive} aria-label={`${c.archived ? t('ledger.accounts.unarchive') : t('ledger.accounts.archive')} ${c.name}`}>{c.archived ? t('ledger.accounts.unarchive') : t('ledger.accounts.archive')}</Button>
        <Button outline type="button" onClick={onDelete} aria-label={`${t('ledger.delete')} ${c.name}`}>{t('ledger.delete')}</Button>
      </div>
    </div>
  );
}

function CategoryForm({ dialog, onDone }: { dialog: Extract<Dialog, { kind: 'new' | 'edit' }>; onDone: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const basics = ledger.basics!;
  const editing = dialog.kind === 'edit' ? dialog.category : undefined;
  const direction: Direction = editing?.direction ?? (dialog as Extract<Dialog, { kind: 'new' }>).direction;
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? '');
  const [color, setColor] = useState(editing?.color ?? 0);
  const [parentId, setParentId] = useState<string>(editing?.parentId ?? (dialog.kind === 'new' ? dialog.parentId ?? '' : ''));
  const [error, setError] = useState<string | undefined>();
  const roots = basics.categories.filter((c) => c.direction === direction && c.parentId === null && c.id !== editing?.id);
  const hasChildren = editing !== undefined && basics.categories.some((c) => c.parentId === editing.id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (editing === undefined) {
      const r = await ledger.run('ledger.createCategory', { direction, parentId: parentId === '' ? null : parentId, name, icon: icon === '' ? null : icon, color });
      if (r.ok) onDone();
      else setError(ledger.explain(r.error.code));
      return;
    }
    const changes = { name, icon: icon === '' ? null : icon, color };
    const r = await ledger.run('ledger.updateCategory', { id: editing.id, changes });
    if (!r.ok) return setError(ledger.explain(r.error.code));
    if ((editing.parentId ?? '') !== parentId) {
      const moved = await ledger.run('ledger.moveCategory', { id: editing.id, parentId: parentId === '' ? null : parentId });
      if (!moved.ok) return setError(ledger.explain(moved.error.code));
    }
    onDone();
  }

  return (
    <form onSubmit={submit}>
      <TextField label={t('ledger.categories.form.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      <div className="mt-4">
        <label htmlFor="cat-parent" className="block font-medium">{t('ledger.categories.form.parent')}</label>
        <Select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={hasChildren}>
          <option value="">{t('ledger.categories.form.topLevel')}</option>
          {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </div>
      <div className="mt-4">
        <label htmlFor="cat-icon" className="block font-medium">{t('ledger.categories.form.icon')}</label>
        <Select id="cat-icon" value={icon} onChange={(e) => setIcon(e.target.value)}>
          <option value="">{t('ledger.categories.form.noIcon')}</option>
          {ICON_KEYS.map((k) => <option key={k} value={k}>{iconFor(k)} {t(`ledger.icon.${k}`)}</option>)}
        </Select>
      </div>
      <div className="mt-4">
        <label htmlFor="cat-color" className="block font-medium">{t('ledger.categories.form.color')}</label>
        <Select id="cat-color" value={color} onChange={(e) => setColor(Number(e.target.value))}>
          {Array.from({ length: COLOR_COUNT }, (_, i) => <option key={i} value={i}>{t(`ledger.color.${i}`)}</option>)}
        </Select>
        <span aria-hidden="true" className="mt-2 inline-block h-4 w-12 rounded-ui" style={{ background: colorFor(color) }} />
      </div>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" >{t('ledger.save')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}

function MergeCategory({ from, used, onDone }: { from: Category; used: number; onDone: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const targets = ledger.basics!.categories.filter((c) => c.direction === from.direction && c.id !== from.id);
  const [into, setInto] = useState('');
  const [error, setError] = useState<string | undefined>();
  const target = targets.find((c) => c.id === into);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const r = await ledger.run('ledger.mergeCategories', { from: from.id, into });
    if (r.ok) onDone();
    else setError(ledger.explain(r.error.code));
  }

  return (
    <form onSubmit={submit}>
      <p className="mt-3">{t('ledger.categories.merge.explain')}</p>
      <div className="mt-4">
        <label htmlFor="merge-into" className="block font-medium">{t('ledger.categories.merge.into')}</label>
        <Select id="merge-into" value={into} onChange={(e) => setInto(e.target.value)} required>
          <option value="" disabled>{t('ledger.categories.merge.choose')}</option>
          {targets.map((c) => <option key={c.id} value={c.id}>{c.parentId === null ? c.name : `${targets.find((p) => p.id === c.parentId)?.name ?? ''} › ${c.name}`}</option>)}
        </Select>
      </div>
      {target ? <p className="mt-3">{t('ledger.categories.merge.consequence', { count: used, from: from.name, into: target.name })}</p> : null}
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={into === ''}>{t('ledger.categories.merge.confirm')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}

function LabelSection({ table, labels, usage, onNew, onEdit, onMerge, onDelete }: {
  table: 'payee' | 'tag'; labels: readonly Label[]; usage: ReadonlyMap<string, number> | undefined;
  onNew: () => void; onEdit: (l: Label) => void; onMerge: (l: Label) => void; onDelete: (l: Label) => void;
}) {
  const { t } = useI18n();
  const titleId = `labels-${table}`;
  return (
    <section className="mt-10" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold">{t(`ledger.${table}.title`)}</h2>
        <Button type="button" onClick={onNew}>{t(`ledger.${table}.new`)}</Button>
      </div>
      {labels.length === 0 ? <p className="mt-2 text-muted">{t(`ledger.${table}.empty`)}</p> : null}
      <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong empty:hidden" aria-label={t(`ledger.${table}.title`)}>
        {labels.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid={`${table}-row`}>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-4 w-4 rounded-ui" style={{ background: colorFor(l.color) }} />
              <strong>{l.name}</strong>
              <span className="text-sm text-muted">{t('ledger.categories.used', { count: usage?.get(l.id as never) ?? 0 })}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button outline type="button" onClick={() => onEdit(l)} aria-label={`${t('ledger.edit')} ${l.name}`}>{t('ledger.edit')}</Button>
              <Button outline type="button" onClick={() => onMerge(l)} aria-label={`${t('ledger.categories.merge')} ${l.name}`}>{t('ledger.categories.merge')}</Button>
              <Button outline type="button" onClick={() => onDelete(l)} aria-label={`${t('ledger.delete')} ${l.name}`}>{t('ledger.delete')}</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LabelForm({ table, label, onDone }: { table: 'payee' | 'tag'; label?: Label; onDone: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(label?.color ?? 0);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const base = table === 'payee' ? 'Payee' : 'Tag';
    const r = label === undefined
      ? await ledger.run(`ledger.create${base}`, { name, color })
      : await ledger.run(`ledger.update${base}`, { id: label.id, name, color });
    if (r.ok) onDone();
    else setError(ledger.explain(r.error.code));
  }

  return (
    <form onSubmit={submit}>
      <TextField label={t('ledger.categories.form.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      <div className="mt-4">
        <label htmlFor="label-color" className="block font-medium">{t('ledger.categories.form.color')}</label>
        <Select id="label-color" value={color} onChange={(e) => setColor(Number(e.target.value))}>
          {Array.from({ length: COLOR_COUNT }, (_, i) => <option key={i} value={i}>{t(`ledger.color.${i}`)}</option>)}
        </Select>
      </div>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" >{t('ledger.save')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}

function MergeLabel({ table, from, used, onDone }: { table: 'payee' | 'tag'; from: Label; used: number; onDone: () => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const all = table === 'payee' ? ledger.basics!.payees : ledger.basics!.tags;
  const targets = useMemo(() => all.filter((l) => l.id !== from.id), [all, from.id]);
  const [into, setInto] = useState('');
  const [error, setError] = useState<string | undefined>();
  const target = targets.find((l) => l.id === into);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const r = await ledger.run(table === 'payee' ? 'ledger.mergePayees' : 'ledger.mergeTags', { from: from.id, into });
    if (r.ok) onDone();
    else setError(ledger.explain(r.error.code));
  }

  return (
    <form onSubmit={submit}>
      <p className="mt-3">{t('ledger.label.merge.explain')}</p>
      <div className="mt-4">
        <label htmlFor="merge-label-into" className="block font-medium">{t('ledger.categories.merge.into')}</label>
        <Select id="merge-label-into" value={into} onChange={(e) => setInto(e.target.value)} required>
          <option value="" disabled>{t('ledger.categories.merge.choose')}</option>
          {targets.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      {target ? <p className="mt-3">{t('ledger.categories.merge.consequence', { count: used, from: from.name, into: target.name })}</p> : null}
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="submit" disabled={into === ''}>{t('ledger.categories.merge.confirm')}</Button>
        <Button outline type="button" onClick={onDone}>{t('ledger.cancel')}</Button>
      </div>
    </form>
  );
}
