'use client';

import { canTransition, labelKey, MAX_NOTE, MAX_TAGS, type TransactionRow, type TxnStatus } from '@cashfold/core';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useCore } from '../core/CoreProvider';
import { InputField, SelectField, TextareaField } from '../forms/Field';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Chip, Combobox, ComboboxCreate, ComboboxLabel, ComboboxOption, Description, Disclosure, Field, Label, Switch, SwitchField, SelectOption } from '../kit';
import { AttachmentField, type AttachmentChoice } from '../ledger/AttachmentField';
import { deviceOffsetAt, inputToMoment, momentToInput, nowInput } from '../ledger/dates';
import { decimalsOf, degreesFromDevice, formatDegrees, formatPlain, parseDegrees } from '../ledger/format';
import { useLedger } from '../ledger/LedgerProvider';
import { prefsStore, usePrefs } from '../prefs/usePrefs';
import { visibleFields, type FieldGroup } from '../prefs/visible-fields';
import { AmountInput } from './AmountInput';
import { isDirty } from './dirty';
import type { ModeReport } from './modes';
import { RatePrompt } from './RatePrompt';
import { orderCategories, recordRecents, pickDefaultAccount } from './recents';
import { includesLetters } from '../i18n/collation';
import { AccountOption } from '../accounts/AccountOption';

export type TxKind = 'expense' | 'income' | 'adjustment';
interface CategoryOption { id: string; label: string; recent: boolean }
const NO_CATEGORY: CategoryOption = { id: '', label: '', recent: false };

/** The expense/income form of the add sheet: five essential fields, everything else under "More details" (FR-008 to FR-011, FR-020). */
export function TransactionMode({ formId, kind, existing, accountId, report }: { formId: string; kind: TxKind; existing?: TransactionRow | undefined; accountId?: string | undefined; report: ModeReport }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const core = useCore();
  const prefs = usePrefs((p) => p);
  const basics = ledger.basics!;
  const foldId = ledger.fold?.id ?? '';
  const usable = basics.accounts.filter((a) => !a.archived || a.id === existing?.accountId);

  const initialWhen = existing === undefined ? nowInput() : momentToInput(existing.occurredUtcMs, existing.tzOffsetMin);
  const [accountIdState, setAccountId] = useState(existing?.accountId ?? accountId ?? pickDefaultAccount(prefs, foldId, usable) ?? '');
  const account = basics.accounts.find((a) => a.id === accountIdState);
  const currency = account?.currency ?? basics.baseCurrency ?? 'USD';
  const [amount, setAmount] = useState(existing === undefined ? '' : formatPlain(existing.direction === 'adjustment' ? existing.amountMinor : existing.amountMinor < 0n ? -existing.amountMinor : existing.amountMinor, existing.currency, locale));
  const [when, setWhen] = useState(initialWhen);
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const initialPayee = existing?.payeeId == null ? '' : basics.payees.find((p) => p.id === existing.payeeId)?.name ?? '';
  const [payeeName, setPayeeName] = useState(initialPayee);
  const [payeeText, setPayeeText] = useState('');
  const initialTags = (existing?.tagIds ?? []).map((id) => basics.tags.find((x) => x.id === id)?.name).filter((n): n is string => n !== undefined);
  const [tagNames, setTagNames] = useState<string[]>(initialTags);
  const [tagText, setTagText] = useState('');
  const [note, setNote] = useState(existing?.note ?? '');
  const [status, setStatus] = useState<TxnStatus>(existing?.status ?? 'posted');
  const [isRefund, setIsRefund] = useState(existing?.isRefund ?? false);
  const [isPinned, setIsPinned] = useState(existing?.isPinned ?? false);
  const [placeName, setPlaceName] = useState(existing?.place?.name ?? '');
  const [lat, setLat] = useState(existing?.place == null ? '' : formatDegrees(existing.place.latE7, locale));
  const [lon, setLon] = useState(existing?.place == null ? '' : formatDegrees(existing.place.lonE7, locale));
  const [locating, setLocating] = useState(false);
  const [attachment, setAttachment] = useState<AttachmentChoice>({ file: undefined, remove: false });
  const [error, setError] = useState<string | undefined>();
  const [needRate, setNeedRate] = useState<{ currency: string; asOfUtcS: number } | undefined>();
  const initialSnapshot = useRef({ accountIdState, amount, when, categoryId, payeeName, tagNames, note, status, isRefund, isPinned, placeName, lat, lon });

  // What the entry held when it opened decides which hidden fields show and whether the group starts open: it must not jump while typing.
  const initialValues = useMemo(() => ({
    'tx.kind': kind, 'tx.note': existing?.note ?? '', 'tx.payee': initialPayee, 'tx.tags': initialTags, 'tx.attachment': existing?.attachment ?? '',
    'tx.place': existing?.place?.name ?? '', 'tx.status': existing !== undefined && existing.status !== 'posted' ? existing.status : '', 'tx.refund': existing?.isRefund ?? false, 'tx.pin': existing?.isPinned ?? false,
  }), []);
  const layout = visibleFields('transaction', prefs, initialValues, existing === undefined ? 'new' : 'edit');
  const [moreOpen, setMoreOpen] = useState(layout.moreOpen);

  useEffect(() => {
    report.dirty(isDirty(initialSnapshot.current, { accountIdState, amount, when, categoryId, payeeName: payeeName || payeeText, tagNames: tagText ? [...tagNames, tagText] : tagNames, note, status, isRefund, isPinned, placeName, lat, lon }) || attachment.file !== undefined || attachment.remove);
  }, [accountIdState, amount, when, categoryId, payeeName, payeeText, tagNames, tagText, note, status, isRefund, isPinned, placeName, lat, lon, attachment, report]);

  const categories = useMemo(() => {
    const direction = kind === 'income' ? 'income' : 'expense';
    const all = basics.categories.filter((c) => c.direction === direction);
    const ordered = orderCategories(prefs.recents.categories[foldId] ?? [], all, existing?.categoryId);
    const nameOf = (c: { id: string; parentId: string | null; name: string }) => {
      const parent = c.parentId === null ? undefined : all.find((x) => x.id === c.parentId);
      return parent ? `${parent.name} › ${c.name}` : c.name;
    };
    const options: CategoryOption[] = ordered.recent.map((c) => ({ id: c.id, label: nameOf(c), recent: true }));
    for (const g of ordered.groups) {
      options.push({ id: g.root.id, label: g.root.name, recent: false });
      for (const c of g.children) options.push({ id: c.id, label: nameOf(c), recent: false });
    }
    return options;
  }, [basics.categories, kind, prefs.recents.categories, foldId, existing?.categoryId]);

  // A category belongs to one direction: switching between expense and income clears it.
  const firstKind = useRef(kind);
  useEffect(() => {
    if (firstKind.current !== kind) {
      firstKind.current = kind;
      setCategoryId('');
    }
  }, [kind]);

  async function labelId(method: 'ledger.createPayee' | 'ledger.createTag', list: readonly { id: string; name: string }[], name: string): Promise<string | undefined> {
    const found = list.find((l) => labelKey(l.name) === labelKey(name));
    if (found) return found.id;
    const created = await ledger.run<string>(method, { name: name.trim() });
    if (!created.ok) {
      setError(ledger.explain(created.error.code));
      return undefined;
    }
    return created.value;
  }

  function locate() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(formatDegrees(degreesFromDevice(position.coords.latitude), locale));
        setLon(formatDegrees(degreesFromDevice(position.coords.longitude), locale));
        setLocating(false);
      },
      () => {
        setError(t('ledger.tx.place.denied'));
        setLocating(false);
      },
      { maximumAge: 60_000, timeout: 15_000 },
    );
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(undefined);
    if (account === undefined) return setError(t('ledger.tx.error.account'));
    const parsed = ledger.parse(amount, currency);
    if (!parsed.ok) return setError(t(`ledger.amount.${parsed.error.code}`, { decimals: decimalsOf(currency), currency }));
    if (kind !== 'adjustment' && parsed.value <= 0n) return setError(t('ledger.tx.error.positive'));
    if (kind === 'adjustment' && parsed.value === 0n) return setError(t('ledger.tx.error.nonzero'));
    const signedMinor = kind === 'expense' ? -parsed.value : parsed.value;
    const tzOffsetMin = existing === undefined ? deviceOffsetAt(when) : existing.tzOffsetMin;
    const occurredUtcMs = inputToMoment(when, tzOffsetMin);
    if (occurredUtcMs === undefined) return setError(t('ledger.tx.error.when'));

    const names = tagText.trim() === '' ? tagNames : [...tagNames, tagText.trim()];
    if (names.length > MAX_TAGS) return setError(t('ledger.tx.error.tags', { max: MAX_TAGS }));
    let place: { name: string; latE7: number; lonE7: number } | null = null;
    if (placeName.trim() !== '' || lat.trim() !== '' || lon.trim() !== '') {
      const la = parseDegrees(lat, locale, 90);
      const lo = parseDegrees(lon, locale, 180);
      if (lat.trim() === '' || lon.trim() === '') return setError(t('ledger.tx.error.place'));
      if (!la.ok) return setError(t(`ledger.place.${la.error.code}`));
      if (!lo.ok) return setError(t(`ledger.place.${lo.error.code}`));
      place = { name: placeName.trim(), latE7: la.value, lonE7: lo.value };
    }
    const placeChanged = JSON.stringify(place) !== JSON.stringify(existing?.place ?? null);

    report.busy(true);
    try {
      let payeeId: string | null = null;
      const payee = (payeeName || payeeText).trim();
      if (payee !== '') {
        const id = await labelId('ledger.createPayee', basics.payees, payee);
        if (id === undefined) return;
        payeeId = id;
      }
      const tags: string[] = [];
      for (const name of names) {
        const id = await labelId('ledger.createTag', basics.tags, name);
        if (id === undefined) return;
        if (!tags.includes(id)) tags.push(id);
      }
      const common = { categoryId: kind === 'adjustment' || categoryId === '' ? null : categoryId, payeeId, tagIds: tags, note, place, status, isRefund: kind === 'income' && isRefund, isPinned };
      const result = existing === undefined
        ? await ledger.run('ledger.addTransaction', { accountId: accountIdState, direction: kind, amountMinor: signedMinor, currency, occurredUtcMs, tzOffsetMin, ...common })
        : await ledger.run('ledger.updateTransaction', {
          id: existing.id,
          changes: {
            ...common,
            ...(accountIdState !== existing.accountId && { accountId: accountIdState, currency }),
            ...(!placeChanged && { place: undefined }),
            ...(signedMinor !== existing.amountMinor && { amountMinor: signedMinor }),
            ...(when !== initialWhen && { occurredUtcMs, tzOffsetMin }),
          },
        });
      if (result.ok) {
        const id = existing?.id ?? (result.value as { id: string }).id;
        if (ledger.fold !== undefined && (attachment.file !== undefined || attachment.remove)) {
          const outcome = attachment.file !== undefined
            ? await core.call<{ ok: boolean }>('attachments.attach', { fold: ledger.fold.id, transaction: id, name: attachment.file.name, mime: attachment.file.type, bytes: new Uint8Array(await attachment.file.arrayBuffer()) })
            : await core.call<{ ok: boolean }>('attachments.remove', { fold: ledger.fold.id, transaction: id });
          await ledger.reload();
          if (!outcome.ok) return setError(t('ledger.attachment.error.saved'));
        }
        prefsStore.update((p) => ({ ...p, recents: recordRecents(p.recents, foldId, accountIdState, kind === 'adjustment' || categoryId === '' ? null : categoryId) }));
        return report.done('status.transactionSaved');
      }
      if (result.error.code === 'rate_required' && result.error.currency !== undefined) {
        setNeedRate({ currency: result.error.currency, asOfUtcS: Number(BigInt(occurredUtcMs) / 1000n) });
        report.rateMode(true);
        return;
      }
      setError(ledger.explain(result.error.code));
    } finally {
      report.busy(false);
    }
  }

  if (needRate) return <RatePrompt {...needRate} formId={formId} onSaved={() => { setNeedRate(undefined); report.rateMode(false); void submit(); }} />;

  const tagLimit = tagNames.length >= MAX_TAGS;
  const category = categories.find((c) => c.id === categoryId) ?? NO_CATEGORY;

  const render: Record<string, () => ReactNode> = {
    'tx.payee': () => (
      <Field key="payee">
        <Label>{t('ledger.tx.payee')}</Label>
        <ComboboxCreate options={basics.payees.map((p) => p.name)} value={payeeName === '' ? null : payeeName} onChange={(v) => { if (v !== null) { setPayeeName(v); setPayeeText(''); } }} onTextChange={(q) => { setPayeeText(q); if (q === '') setPayeeName(''); }} createLabel={(q) => t('ledger.add.create', { name: q })} toggleLabel={t('ledger.add.showOptions')} />
      </Field>
    ),
    'tx.tags': () => (
      <Field key="tags">
        <Label>{t('ledger.tx.tags', { max: MAX_TAGS })}</Label>
        {tagNames.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {tagNames.map((n) => <Chip key={n} label={n} removeLabel={t('ledger.add.removeTag', { name: n })} onRemove={() => setTagNames((cur) => cur.filter((x) => x !== n))} />)}
          </div>
        ) : null}
        {tagLimit ? <Description>{t('ledger.tx.error.tags', { max: MAX_TAGS })}</Description> : (
          <ComboboxCreate
            options={basics.tags.map((x) => x.name).filter((n) => !tagNames.includes(n))} value={null}
            onChange={(v) => { if (v) { setTagNames((cur) => (cur.some((c) => labelKey(c) === labelKey(v)) ? cur : [...cur, v])); setTagText(''); } }}
            onTextChange={setTagText} createLabel={(q) => t('ledger.add.create', { name: q })} toggleLabel={t('ledger.add.showOptions')}
          />
        )}
      </Field>
    ),
    'tx.note': () => <TextareaField key="note" label={t('ledger.tx.note')} rows={2} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />,
    'tx.attachment': () => <AttachmentField key="attachment" {...(existing && { existing })} choice={attachment} onChange={setAttachment} />,
    'tx.place': () => (
      <div key="place" className="space-y-3">
        <InputField label={t('ledger.tx.place.name')} value={placeName} onChange={(e) => setPlaceName(e.target.value)} maxLength={200} hint={t('ledger.tx.place.hint')} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" outline onClick={locate} disabled={locating || typeof navigator === 'undefined' || !('geolocation' in navigator)}>{locating ? t('ledger.tx.place.locating') : t('ledger.tx.place.use')}</Button>
          <Button type="button" plain onClick={() => { setPlaceName(''); setLat(''); setLon(''); }} disabled={placeName === '' && lat === '' && lon === ''}>{t('ledger.tx.place.clear')}</Button>
        </div>
        <Disclosure title={t('ledger.add.coordinates')} defaultOpen={lat !== '' || lon !== ''}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label={t('ledger.tx.place.lat')} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" autoComplete="off" />
            <InputField label={t('ledger.tx.place.lon')} value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" autoComplete="off" />
          </div>
        </Disclosure>
      </div>
    ),
    'tx.status': () => (
      <SelectField key="status" label={t('ledger.tx.status')} value={status} onChange={(v) => setStatus(v as TxnStatus)}>
        {(['pending', 'posted', 'void'] as const).filter((s) => existing === undefined || canTransition(existing.status, s)).map((s) => <SelectOption key={s} value={s}>{t(`ledger.status.${s}`)}</SelectOption>)}
      </SelectField>
    ),
    'tx.refund': () => (
      <SwitchField key="refund"><Label>{t('ledger.tx.refund')}</Label><Switch checked={isRefund} onChange={setIsRefund} /></SwitchField>
    ),
    'tx.pin': () => (
      <SwitchField key="pin"><Label>{t('ledger.tx.pin')}</Label><Switch checked={isPinned} onChange={setIsPinned} /></SwitchField>
    ),
  };
  const fieldsIn = (group: FieldGroup) => layout.fields.filter((f) => f.group === group && render[f.def.id]).map((f) => render[f.def.id]!());

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {existing?.lastChanged ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="last-changed">
          {t('ledger.tx.lastChanged', { when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(existing.lastChanged.atMs), device: existing.lastChanged.dev === basics.thisDevice ? t('ledger.tx.thisDevice') : t('ledger.tx.otherDevice') })}
        </p>
      ) : null}
      {kind === 'adjustment' ? <p className="font-medium">{t('ledger.kind.adjustment')}</p> : null}
      <AmountInput label={t('ledger.tx.amount')} currency={currency} value={amount} onChange={setAmount} autoFocus hint={kind === 'adjustment' ? t('ledger.tx.amount.signed') : undefined} />
      <SelectField label={t('ledger.tx.account')} value={accountIdState} onChange={setAccountId}>
        {usable.map((a) => <AccountOption key={a.id} account={a} />)}
      </SelectField>
      {kind === 'adjustment' ? null : (
        <Field>
          <Label>{t('ledger.tx.category')}</Label>
          <Combobox<CategoryOption | null>
            options={[NO_CATEGORY, ...categories]} value={category} onChange={(o) => setCategoryId(o?.id ?? '')}
            displayValue={(o) => (o === null || o.id === '' ? '' : o.label)} toggleLabel={t('ledger.add.showOptions')} placeholder={t('ledger.tx.noCategory')}
            filter={(o, q) => o !== null && includesLetters(o.label, q)}
          >
            {(o) => (
              <ComboboxOption value={o}>
                <ComboboxLabel>{o === null || o.id === '' ? t('ledger.tx.noCategory') : o.recent ? `${o.label} (${t('ledger.add.recent')})` : o.label}</ComboboxLabel>
              </ComboboxOption>
            )}
          </Combobox>
        </Field>
      )}
      <InputField label={t('ledger.tx.when')} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      {fieldsIn('main')}
      {layout.hasMore ? (
        <Disclosure
          title={t('ledger.add.more')} summary={t('ledger.add.moreSummary')} open={moreOpen}
          onOpenChange={(open) => { setMoreOpen(open); prefsStore.update((p) => (p.moreDetailsOpen === open ? p : { ...p, moreDetailsOpen: open })); }}
        >
          <div className="space-y-4">{fieldsIn('more')}</div>
        </Disclosure>
      ) : null}
      {error ? <p role="alert" className="text-(--danger)">{error}</p> : null}
    </form>
  );
}
