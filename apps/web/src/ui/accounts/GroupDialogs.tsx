'use client';

import { useEffect, useState } from 'react';
import type { BudgetRow, Id } from '@cashfold/core';
import { InputField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import type { Translate } from '../i18n/i18n';
import { Alert, Button, Sheet } from '../kit';
import { useLedger } from '../ledger/LedgerProvider';
import { budgetsUsingGroup, type BudgetUsingGroup } from './accounts-view';

/** The add-or-rename form: one name field, its reason when refused, and the two buttons. */
export function GroupFormView({ t, mode, name, error, busy = false, onChange, onSubmit, onCancel }: {
  t: Translate; mode: 'create' | 'rename'; name: string; error: string | undefined; busy?: boolean;
  onChange: (name: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="space-y-4">
      <InputField label={t('ledger.groups.name')} value={name} onChange={(e) => onChange(e.target.value)} required maxLength={80} autoFocus />
      {error ? <p role="alert" className="text-(--danger)">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button plain type="button" onClick={onCancel}>{t('ledger.cancel')}</Button>
        <Button type="submit" disabled={busy}>{mode === 'create' ? t('ledger.groups.add') : t('ledger.save')}</Button>
      </div>
    </form>
  );
}

/** What deleting a group does, in plain words: its accounts are kept, and the budgets limited to it are named. Cancel has the focus. */
export function GroupDeleteView({ t, name, accountCount, budgets, busy = false, onConfirm, onCancel }: {
  t: Translate; name: string; accountCount: number; budgets: readonly BudgetUsingGroup[]; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const keeps = budgets.filter((b) => !b.countsNothing).map((b) => b.name);
  const empty = budgets.filter((b) => b.countsNothing).map((b) => b.name);
  return (
    <div>
      <h2 className="text-base/6 font-semibold break-words">{t('ledger.groups.deleteTitle', { name })}</h2>
      <p className="mt-2">{accountCount === 0 ? t('ledger.groups.deleteNoAccounts') : t('ledger.groups.deleteAccounts', { count: accountCount })}</p>
      {keeps.length > 0 ? <p className="mt-2">{t('ledger.groups.deleteBudgets', { names: keeps.join(', ') })}</p> : null}
      {empty.length > 0 ? <p className="mt-2">{t('ledger.groups.deleteBudgetsEmpty', { names: empty.join(', ') })}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button plain autoFocus onClick={onCancel}>{t('ledger.cancel')}</Button>
        <Button color="danger" disabled={busy} onClick={onConfirm}>{t('ledger.groups.deleteConfirm')}</Button>
      </div>
    </div>
  );
}

/** The add and rename sheet: it writes through the worker and shows the reason from `ledger.explain` when the name is refused. */
export function GroupFormDialog({ group, onClose }: { group: { id: Id; name: string } | 'new'; onClose: (saved?: boolean) => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const [name, setName] = useState(group === 'new' ? '' : group.name);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = group === 'new' ? await ledger.run('ledger.createGroup', { name }) : await ledger.run('ledger.updateGroup', { id: group.id, name });
    setBusy(false);
    if (r.ok) onClose(true);
    else setError(ledger.explain(r.error.code));
  }

  return (
    <Sheet open onClose={() => onClose()} title={group === 'new' ? t('ledger.groups.add') : t('ledger.groups.rename')}>
      <GroupFormView t={t} mode={group === 'new' ? 'create' : 'rename'} name={name} error={error} busy={busy} onChange={setName} onSubmit={() => void submit()} onCancel={() => onClose()} />
    </Sheet>
  );
}

/** The delete confirmation: it reads the group's accounts from the basics and the budgets limited to it when it opens. */
export function GroupDeleteDialog({ group, onClose }: { group: { id: Id; name: string }; onClose: (deleted?: boolean) => void }) {
  const { t } = useI18n();
  const ledger = useLedger();
  const [budgets, setBudgets] = useState<BudgetUsingGroup[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const basics = ledger.basics;
  const liveGroupIds = (basics?.groups ?? []).map((g) => g.id);
  const accountCount = (basics?.accounts ?? []).filter((a) => a.groupIds.includes(group.id)).length;

  useEffect(() => {
    let current = true;
    ledger.read<BudgetRow[]>('budgets.list').then(
      (rows) => current && setBudgets(budgetsUsingGroup(rows, group.id, liveGroupIds)),
      () => current && setBudgets([]),
    );
    return () => { current = false; };
    // Read once when the confirmation opens; the group and its budgets do not change while it is open.
  }, []);

  async function confirm() {
    setBusy(true);
    const r = await ledger.run('ledger.deleteGroup', { id: group.id });
    setBusy(false);
    if (r.ok) onClose(true);
    else setFailure(ledger.explain(r.error.code));
  }

  return (
    <Alert open onClose={() => onClose()} aria-label={t('ledger.groups.deleteTitle', { name: group.name })}>
      {budgets === undefined ? <p role="status">{t('loading')}</p> : (
        <GroupDeleteView t={t} name={group.name} accountCount={accountCount} budgets={budgets} busy={busy} onConfirm={() => void confirm()} onCancel={() => onClose()} />
      )}
      {failure ? <p role="alert" className="mt-3 text-(--danger)">{failure}</p> : null}
    </Alert>
  );
}
