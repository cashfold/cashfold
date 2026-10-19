'use client';

import { canTransition, labelKey, MAX_NOTE, MAX_TAGS, type Category, type TransactionRow, type TxnStatus } from '@cashfold/core';
import { useMemo, useState, type FormEvent } from 'react';
import { buttonClass, secondaryButtonClass, TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { AmountField } from './AmountField';
import { AttachmentField, type AttachmentChoice } from './AttachmentField';
import { useCore } from '../core/CoreProvider';
import { deviceOffsetAt, formatDateTime, inputToMoment, momentToInput, nowInput } from './dates';
import { decimalsOf, degreesFromDevice, formatDegrees, formatPlain, parseDegrees, parseRateText } from './format';
import { useLedger } from './LedgerProvider';

type Kind = 'expense' | 'income' | 'adjustment';

/** Expense or income entry, new or existing (adjustments are edited here but created from the account). */
export function TransactionForm({ existing, defaultAccountId, onDone }: { existing?: TransactionRow; defaultAccountId?: string; onDone: () => void }) {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const core = useCore();
  const [attachment, setAttachment] = useState<AttachmentChoice>({ file: undefined, remove: false });
  const basics = ledger.basics!;
  const usable = basics.accounts.filter((a) => !a.archived || a.id === existing?.accountId);
  const firstAccount = usable.find((a) => a.id === defaultAccountId) ?? usable.find((a) => a.kind !== 'goal') ?? usable[0];

  const initialAccount = existing?.accountId ?? firstAccount?.id ?? '';
  const initialWhen = existing === undefined ? nowInput() : momentToInput(existing.occurredUtcMs, existing.tzOffsetMin);
  const [kind, setKind] = useState<Kind>(existing?.direction ?? 'expense');
  const [accountId, setAccountId] = useState(initialAccount);
  const account = basics.accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? basics.baseCurrency ?? 'USD';
  const [amount, setAmount] = useState(existing === undefined ? '' : formatPlain(existing.direction === 'adjustment' ? existing.amountMinor : existing.amountMinor < 0n ? -existing.amountMinor : existing.amountMinor, existing.currency, locale));
  const [when, setWhen] = useState(initialWhen);
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [payeeName, setPayeeName] = useState(existing?.payeeId == null ? '' : basics.payees.find((p) => p.id === existing.payeeId)?.name ?? '');
  const [tagIds, setTagIds] = useState<readonly string[]>(existing?.tagIds ?? []);
  const [newTag, setNewTag] = useState('');
  const [note, setNote] = useState(existing?.note ?? '');
  const [status, setStatus] = useState<TxnStatus>(existing?.status ?? 'posted');
  const [isRefund, setIsRefund] = useState(existing?.isRefund ?? false);
  const [isPinned, setIsPinned] = useState(existing?.isPinned ?? false);
  const [placeName, setPlaceName] = useState(existing?.place?.name ?? '');
  const [lat, setLat] = useState(existing?.place == null ? '' : formatDegrees(existing.place.latE7, locale));
  const [lon, setLon] = useState(existing?.place == null ? '' : formatDegrees(existing.place.lonE7, locale));
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [needRate, setNeedRate] = useState<{ currency: string; asOfUtcS: number } | undefined>();
  const [rateText, setRateText] = useState('');
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => {
    const direction = kind === 'income' ? 'income' : 'expense';
    const all = basics.categories.filter((c) => c.direction === direction && (!c.archived || c.id === existing?.categoryId));
    const roots = all.filter((c) => c.parentId === null);
    return roots.map((root) => ({ root, children: all.filter((c) => c.parentId === root.id) }));
  }, [basics.categories, kind, existing?.categoryId]);

  const tagLimitReached = tagIds.length + (newTag.trim() === '' ? 0 : 1) > MAX_TAGS;

  /** The existing payee/tag with this name (ignoring case and accents), or a new one made now. */
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

  /** Asks the browser where this device is. The answer goes into the two fields and nowhere else. */
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

  async function submit(event: FormEvent) {
    event.preventDefault();
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

    setBusy(true);
    try {
      let payeeId: string | null = null;
      if (payeeName.trim() !== '') {
        const id = await labelId('ledger.createPayee', basics.payees, payeeName);
        if (id === undefined) return;
        payeeId = id;
      }
      const tags = [...tagIds];
      if (newTag.trim() !== '') {
        const id = await labelId('ledger.createTag', basics.tags, newTag);
        if (id === undefined) return;
        if (!tags.includes(id)) tags.push(id);
      }

      const common = { categoryId: kind === 'adjustment' || categoryId === '' ? null : categoryId, payeeId, tagIds: tags, note, place, status, isRefund: kind === 'income' && isRefund, isPinned };
      const result = existing === undefined
        ? await ledger.run('ledger.addTransaction', { accountId, direction: kind, amountMinor: signedMinor, currency, occurredUtcMs, tzOffsetMin, ...common })
        : await ledger.run('ledger.updateTransaction', {
          id: existing.id,
          changes: {
            ...common,
            ...(accountId !== existing.accountId && { accountId, currency }),
            ...(!placeChanged && { place: undefined }),
            ...(signedMinor !== existing.amountMinor && { amountMinor: signedMinor }),
            ...(when !== initialWhen && { occurredUtcMs, tzOffsetMin }),
          },
        });
      if (result.ok) {
        // The file goes on once the transaction exists. If that fails the transaction is still saved, and the person is told.
        const id = existing?.id ?? (result.value as { id: string }).id;
        if (ledger.fold !== undefined && (attachment.file !== undefined || attachment.remove)) {
          const outcome = attachment.file !== undefined
            ? await core.call<{ ok: boolean; error?: { code: string } }>('attachments.attach', { fold: ledger.fold.id, transaction: id, name: attachment.file.name, mime: attachment.file.type, bytes: new Uint8Array(await attachment.file.arrayBuffer()) })
            : await core.call<{ ok: boolean; error?: { code: string } }>('attachments.remove', { fold: ledger.fold.id, transaction: id });
          if (!outcome.ok) {
            await ledger.reload();
            return setError(t('ledger.attachment.error.saved'));
          }
          await ledger.reload();
        }
        return onDone();
      }
      if (result.error.code === 'rate_required' && result.error.currency !== undefined) {
        setNeedRate({ currency: result.error.currency, asOfUtcS: Number(BigInt(occurredUtcMs) / 1000n) });
        return;
      }
      setError(ledger.explain(result.error.code));
    } finally {
      setBusy(false);
    }
  }

  async function saveRate(event: FormEvent) {
    event.preventDefault();
    if (!needRate) return;
    const rate = parseRateText(rateText, locale);
    if (!rate.ok) return setError(t(`ledger.rate.${rate.error.code}`));
    const r = await ledger.run('ledger.setCustomRate', { quote: needRate.currency, asOfUtcS: needRate.asOfUtcS, rateE12: rate.value });
    if (!r.ok) return setError(ledger.explain(r.error.code));
    setNeedRate(undefined);
    setRateText('');
    setError(undefined);
    await submit(new Event('submit') as unknown as FormEvent);
  }

  if (needRate) {
    return (
      <form onSubmit={saveRate}>
        <p className="mt-3">{t('ledger.rate.explain', { currency: needRate.currency })}</p>
        <TextField label={t('ledger.rate.label', { currency: needRate.currency })} value={rateText} onChange={(e) => setRateText(e.target.value)} inputMode="decimal" autoComplete="off" required autoFocus hint={t('ledger.rate.hint')} />
        {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <button type="submit" className={buttonClass}>{t('ledger.rate.save')}</button>
          <button type="button" className={secondaryButtonClass} onClick={() => setNeedRate(undefined)}>{t('ledger.cancel')}</button>
        </div>
      </form>
    );
  }

  const selectClass = 'mt-1 block w-full rounded-ui border border-border-strong bg-bg px-3 py-2';
  return (
    <form onSubmit={submit}>
      {existing?.lastChanged ? (
        <p className="mt-3 text-sm text-muted" data-testid="last-changed">
          {t('ledger.tx.lastChanged', { when: formatDateTime(existing.lastChanged.atMs, locale), device: existing.lastChanged.dev === basics.thisDevice ? t('ledger.tx.thisDevice') : t('ledger.tx.otherDevice') })}
        </p>
      ) : null}

      {kind === 'adjustment' ? (
        <p className="mt-3 font-medium">{t('ledger.kind.adjustment')}</p>
      ) : (
        <fieldset className="mt-4">
          <legend className="font-medium">{t('ledger.tx.type')}</legend>
          <div className="mt-1 flex gap-4">
            {(['expense', 'income'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="tx-kind" value={k} checked={kind === k} onChange={() => { setKind(k); setCategoryId(''); }} />
                {t(`ledger.kind.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-4">
        <label htmlFor="tx-account" className="block font-medium">{t('ledger.tx.account')}</label>
        <select id="tx-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {usable.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </div>

      <AmountField label={t('ledger.tx.amount')} currency={currency} value={amount} onChange={setAmount} required hint={kind === 'adjustment' ? t('ledger.tx.amount.signed') : undefined} />
      <TextField label={t('ledger.tx.when')} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />

      {kind === 'adjustment' ? null : (
        <div className="mt-4">
          <label htmlFor="tx-category" className="block font-medium">{t('ledger.tx.category')}</label>
          <select id="tx-category" className={selectClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('ledger.tx.noCategory')}</option>
            {categories.map(({ root, children }: { root: Category; children: Category[] }) => (
              <optgroup key={root.id} label={root.name}>
                <option value={root.id}>{root.name}</option>
                {children.map((c) => <option key={c.id} value={c.id}>{root.name} › {c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      <TextField label={t('ledger.tx.payee')} value={payeeName} onChange={(e) => setPayeeName(e.target.value)} list="tx-payees" autoComplete="off" maxLength={80} />
      <datalist id="tx-payees">{basics.payees.map((p) => <option key={p.id} value={p.name} />)}</datalist>

      <fieldset className="mt-4">
        <legend className="font-medium">{t('ledger.tx.tags', { max: MAX_TAGS })}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {basics.tags.map((tag) => (
            <label key={tag.id} className="flex items-center gap-2">
              <input
                type="checkbox" checked={tagIds.includes(tag.id)}
                onChange={(e) => setTagIds((cur) => (e.target.checked ? [...cur, tag.id] : cur.filter((x) => x !== tag.id)))}
              />
              {tag.name}
            </label>
          ))}
        </div>
        <TextField label={t('ledger.tx.newTag')} value={newTag} onChange={(e) => setNewTag(e.target.value)} maxLength={80} error={tagLimitReached ? t('ledger.tx.error.tags', { max: MAX_TAGS }) : undefined} />
      </fieldset>

      <fieldset className="mt-4">
        <legend className="font-medium">{t('ledger.tx.place.title')}</legend>
        <p className="mt-1 text-sm text-muted">{t('ledger.tx.place.hint')}</p>
        <TextField label={t('ledger.tx.place.name')} value={placeName} onChange={(e) => setPlaceName(e.target.value)} maxLength={200} />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField label={t('ledger.tx.place.lat')} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" autoComplete="off" />
          <TextField label={t('ledger.tx.place.lon')} value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" autoComplete="off" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClass} onClick={locate} disabled={locating || typeof navigator === 'undefined' || !('geolocation' in navigator)}>
            {locating ? t('ledger.tx.place.locating') : t('ledger.tx.place.use')}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => { setPlaceName(''); setLat(''); setLon(''); }} disabled={placeName === '' && lat === '' && lon === ''}>{t('ledger.tx.place.clear')}</button>
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor="tx-note" className="block font-medium">{t('ledger.tx.note')}</label>
        <textarea id="tx-note" className={selectClass} rows={2} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="mt-4">
        <label htmlFor="tx-status" className="block font-medium">{t('ledger.tx.status')}</label>
        <select id="tx-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as TxnStatus)}>
          {(['pending', 'posted', 'void'] as const).filter((s) => existing === undefined || canTransition(existing.status, s)).map((s) => <option key={s} value={s}>{t(`ledger.status.${s}`)}</option>)}
        </select>
      </div>

      {kind === 'income' ? (
        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} />
          {t('ledger.tx.refund')}
        </label>
      ) : null}
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
        {t('ledger.tx.pin')}
      </label>

      {kind !== 'adjustment' ? <AttachmentField {...(existing && { existing })} choice={attachment} onChange={setAttachment} /> : null}

      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <button type="submit" className={buttonClass} disabled={busy || tagLimitReached}>{existing === undefined ? t('ledger.tx.add.submit') : t('ledger.save')}</button>
        <button type="button" className={secondaryButtonClass} onClick={onDone}>{t('ledger.cancel')}</button>
      </div>
    </form>
  );
}
