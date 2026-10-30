'use client';

import type { ColumnMapping, ImportOptions, PreviewRow } from '@cashfold/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { importHandoff } from '../desktop/import-handoff';
import { useI18n } from '../i18n/I18nProvider';
import { formatDate } from '../ledger/dates';
import { useLedger } from '../ledger/LedgerProvider';
import { Button, Checkbox, CheckboxField, Label, Radio, RadioField, RadioGroup, Select, SelectOption } from '../kit';
import { AccountOption } from '../accounts/AccountOption';


interface Sample { delimiter: ',' | ';' | '\t'; rows: number; header: string[]; sample: string[][] }
interface Preview { rows: number; ok: number; problems: number; duplicates: number; shown: PreviewRow[] }
interface Batch { id: string; source: string; importedUtcMs: number; undone: boolean; count: number }
type Field = Exclude<keyof ColumnMapping, 'date'>;
const NONE = -1;

/** The CSV import wizard (FR-090): pick a file, say which column is which, see exactly what would come in, import it as one batch, take it back. */
export function CsvImportPanel() {
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | undefined>();
  const [source, setSource] = useState('');
  const [sample, setSample] = useState<Sample | undefined>();
  const [account, setAccount] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [dateOrder, setDateOrder] = useState<'ymd' | 'dmy' | 'mdy'>('ymd');
  const [decimal, setDecimal] = useState<'.' | ','>('.');
  const [amountStyle, setAmountStyle] = useState<'signed' | 'split'>('signed');
  const [columns, setColumns] = useState<Record<string, number>>({ date: NONE });
  const [preview, setPreview] = useState<Preview | undefined>();
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<{ batch: string; imported: number; skipped: number; problems: number } | undefined>();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);

  const accounts = ledger.basics?.accounts.filter((a) => !a.archived) ?? [];
  const chosen = accounts.find((a) => a.id === account) ?? accounts[0];

  const loadBatches = useCallback(async () => {
    try {
      setBatches(await ledger.read<Batch[]>('csv.batches'));
    } catch {
      setBatches([]);
    }
  }, [ledger]);
  useEffect(() => void loadBatches(), [loadBatches]);

  const mapping = (): ColumnMapping => {
    const m: { -readonly [K in keyof ColumnMapping]: ColumnMapping[K] } = { date: columns['date'] ?? NONE };
    const fields: Field[] = amountStyle === 'signed' ? ['signed'] : ['income', 'expense'];
    for (const f of [...fields, 'time', 'currency', 'type', 'category', 'payee', 'note', 'tags'] as Field[]) {
      const v = columns[f];
      if (v !== undefined && v !== NONE) m[f] = v;
    }
    return m;
  };
  const optionsFor = (): ImportOptions | undefined => (chosen === undefined ? undefined : { account: chosen.id as ImportOptions['account'], mapping: mapping(), dateOrder, decimal, hasHeader });
  const ready = chosen !== undefined && (columns['date'] ?? NONE) !== NONE && (amountStyle === 'signed' ? (columns['signed'] ?? NONE) !== NONE : (columns['income'] ?? NONE) !== NONE || (columns['expense'] ?? NONE) !== NONE);

  async function choose(dropped?: File) {
    setError(undefined);
    setPreview(undefined);
    setResult(undefined);
    const picked = dropped ?? file.current?.files?.[0];
    if (picked === undefined) return;
    if (dropped !== undefined && file.current) {
      // The file input shows the dropped file as chosen, as if it had been picked with the button.
      const transfer = new DataTransfer();
      transfer.items.add(dropped);
      file.current.files = transfer.files;
    }
    setBusy(true);
    try {
      const content = await picked.text();
      const reply = await ledger.read<Sample>('csv.preview', { text: content });
      setText(content);
      setSource(picked.name);
      setSample(reply);
      // A guess at the obvious columns from a header row saves most of the work.
      const guess: Record<string, number> = {};
      reply.header.forEach((h, i) => {
        const k = h.trim().toLowerCase();
        const set = (field: string, ...names: string[]) => names.includes(k) && guess[field] === undefined && (guess[field] = i);
        set('date', 'date', 'datum', 'fecha'); set('signed', 'amount', 'betrag', 'importe'); set('category', 'category'); set('payee', 'payee', 'merchant'); set('note', 'note', 'memo', 'description'); set('tags', 'tags'); set('currency', 'currency'); set('type', 'type');
      });
      setColumns({ date: NONE, ...guess });
    } catch {
      setError(t('data.import.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  // A CSV dropped on the window (desktop app) waits in the hand-off; taking it shows it as chosen, with its columns, and imports nothing.
  useEffect(() => {
    if (chosen === undefined) return;
    const take = (): void => {
      const dropped = importHandoff.take();
      if (dropped !== undefined) void choose(dropped);
    };
    take();
    return importHandoff.subscribe(take);
    // `choose` only reads state through the setters and the ledger.
  }, [chosen === undefined]);

  async function showPreview() {
    const options = optionsFor();
    if (text === undefined || options === undefined) return;
    setError(undefined);
    setBusy(true);
    try {
      setPreview(await ledger.read<Preview>('csv.preview', { text, options }));
      setIncludeDuplicates(false);
    } catch {
      setError(t('data.import.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    const options = optionsFor();
    if (text === undefined || options === undefined) return;
    setError(undefined);
    setBusy(true);
    try {
      const r = await ledger.run<{ batch: string; imported: number; skippedDuplicates: number; problems: number }>('csv.import', { text, source, options, includeDuplicates });
      if (r.ok) {
        setResult({ batch: r.value.batch, imported: r.value.imported, skipped: r.value.skippedDuplicates, problems: r.value.problems });
        setPreview(undefined);
        setText(undefined);
        setSample(undefined);
        if (file.current) file.current.value = '';
      } else setError(ledger.explain(r.error.code));
    } finally {
      setBusy(false);
    }
  }

  async function undo(batch: string) {
    const r = await ledger.run('csv.undo', { batch });
    if (r.ok) {
      if (result?.batch === batch) setResult(undefined);
      await loadBatches();
    } else setError(ledger.explain(r.error.code));
  }

  const columnSelect = (field: string, label: string) => (
    <label className="block" key={field}>
      <span className="mb-3 block font-medium">{label}</span>
      <Select value={columns[field] ?? NONE} onChange={(v) => setColumns({ ...columns, [field]: v })}>
        <SelectOption value={NONE}>{t('data.import.none')}</SelectOption>
        {(sample?.header ?? []).map((h, i) => <SelectOption key={i} value={i}>{hasHeader && h.trim() !== '' ? h : t('data.import.column', { n: i + 1 })}</SelectOption>)}
      </Select>
    </label>
  );

  return (
    <section aria-labelledby="import-heading" className="mt-8">
      <h2 id="import-heading" className="text-lg font-semibold">{t('data.import.title')}</h2>
      <p className="mt-1 text-muted">{t('data.import.lede')}</p>
      {accounts.length === 0 ? <p className="mt-3 text-muted">{t('data.import.noAccount')}</p> : (
        <div className="mt-4 max-w-2xl">
          <div>
            <label htmlFor="import-file" className="block font-medium">{t('data.import.file')}</label>
            <input id="import-file" ref={file} type="file" accept=".csv,text/csv,text/plain" className="mt-1 block w-full max-w-full" onChange={() => void choose()} />
          </div>

          {sample !== undefined ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-3 block font-medium">{t('data.import.account')}</span>
                <Select value={chosen?.id ?? ''} onChange={(v) => { setAccount(v); setPreview(undefined); }}>
                  {accounts.map((a) => <AccountOption key={a.id} account={a} />)}
                </Select>
              </label>
              <CheckboxField className="sm:col-span-2"><Checkbox checked={hasHeader} onChange={(checked) => setHasHeader(checked)} /><Label>{t('data.import.header')}</Label></CheckboxField>
              {columnSelect('date', t('data.import.date'))}
              <label className="block">
                <span className="mb-3 block font-medium">{t('data.import.dateOrder')}</span>
                <Select value={dateOrder} onChange={(v) => setDateOrder(v as typeof dateOrder)}>
                  <SelectOption value="ymd">{t('data.import.order.ymd')}</SelectOption>
                  <SelectOption value="dmy">{t('data.import.order.dmy')}</SelectOption>
                  <SelectOption value="mdy">{t('data.import.order.mdy')}</SelectOption>
                </Select>
              </label>
              <fieldset className="sm:col-span-2">
                <legend className="font-medium">{t('data.import.amounts')}</legend>
                <RadioGroup value={amountStyle} onChange={(v) => setAmountStyle(v as typeof amountStyle)} aria-label={t('data.import.amounts')} className="mt-1">
                  <RadioField><Radio value="signed" /><Label>{t('data.import.amounts.signed')}</Label></RadioField>
                  <RadioField><Radio value="split" /><Label>{t('data.import.amounts.split')}</Label></RadioField>
                </RadioGroup>
              </fieldset>
              {amountStyle === 'signed' ? columnSelect('signed', t('data.import.amount')) : (<>{columnSelect('income', t('data.import.income'))}{columnSelect('expense', t('data.import.expense'))}</>)}
              <label className="block">
                <span className="mb-3 block font-medium">{t('data.import.decimal')}</span>
                <Select value={decimal} onChange={(v) => setDecimal(v as typeof decimal)}>
                  <SelectOption value=".">{t('data.import.decimal.dot')}</SelectOption>
                  <SelectOption value=",">{t('data.import.decimal.comma')}</SelectOption>
                </Select>
              </label>
              {columnSelect('currency', t('data.import.currency'))}
              {columnSelect('type', t('data.import.type'))}
              {columnSelect('category', t('data.import.category'))}
              {columnSelect('payee', t('data.import.payee'))}
              {columnSelect('note', t('data.import.note'))}
              {columnSelect('tags', t('data.import.tags'))}
              <div className="sm:col-span-2">
                <Button type="button" disabled={!ready || busy} onClick={() => void showPreview()}>{t('data.import.preview')}</Button>
                {!ready ? <span className="ms-3 text-sm text-muted">{t('data.import.needColumns')}</span> : null}
              </div>
            </div>
          ) : null}

          {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}

          {preview !== undefined && chosen !== undefined ? (
            <div className="mt-6" data-testid="import-preview">
              <h3 className="font-semibold">{t('data.import.summary', { ok: preview.ok, problems: preview.problems, duplicates: preview.duplicates })}</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-start">
                  <caption className="sr-only">{t('data.import.table')}</caption>
                  <thead><tr><th scope="col" className="p-1 text-start">{t('data.import.col.line')}</th><th scope="col" className="p-1 text-start">{t('data.import.col.date')}</th><th scope="col" className="p-1 text-start">{t('data.import.col.amount')}</th><th scope="col" className="p-1 text-start">{t('data.import.col.what')}</th><th scope="col" className="p-1 text-start">{t('data.import.col.status')}</th></tr></thead>
                  <tbody>
                    {preview.shown.map((r) => (
                      <tr key={r.line} className="border-t border-border-strong">
                        <td className="p-1">{r.line}</td>
                        <td className="p-1">{r.localDate === undefined ? '' : formatDate(r.localDate, locale)}</td>
                        <td className="p-1" dir="ltr">{r.amountMinor === undefined ? '' : ledger.signed(r.amountMinor, chosen.currency)}</td>
                        <td className="p-1">{[r.payee, r.category, r.note].filter(Boolean).join(' · ')}</td>
                        <td className="p-1">{r.problem !== undefined ? <span className="text-danger">{t(`data.import.problem.${r.problem}`)}</span> : r.duplicate ? t('data.import.duplicate') : r.categoryUnknown ? t('data.import.noCategory') : t('data.import.okRow')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows > preview.shown.length ? <p className="mt-2 text-sm text-muted">{t('data.import.shown', { shown: preview.shown.length, total: preview.rows })}</p> : null}
              {preview.duplicates > 0 ? (
                <CheckboxField className="mt-3"><Checkbox checked={includeDuplicates} onChange={(checked) => setIncludeDuplicates(checked)} /><Label>{t('data.import.includeDuplicates', { count: preview.duplicates })}</Label></CheckboxField>
              ) : null}
              <div className="mt-4 flex gap-3">
                <Button type="button" disabled={busy || preview.ok - (includeDuplicates ? 0 : preview.duplicates) <= 0} onClick={() => void runImport()}>{t('data.import.submit')}</Button>
                <Button outline type="button" onClick={() => setPreview(undefined)}>{t('ledger.cancel')}</Button>
              </div>
            </div>
          ) : null}

          {result !== undefined ? (
            <div role="status" className="mt-4" data-testid="import-result">
              <p>{t('data.import.done', { imported: result.imported, skipped: result.skipped, problems: result.problems })}</p>
              <Button outline className="mt-2" type="button" onClick={() => void undo(result.batch)}>{t('data.import.undo')}</Button>
            </div>
          ) : null}
        </div>
      )}

      {batches.length > 0 ? (
        <div className="mt-6 max-w-2xl">
          <h3 className="font-semibold">{t('data.import.batches')}</h3>
          <ul className="mt-2 divide-y divide-border-strong">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{t('data.import.batch', { source: b.source, count: b.count, when: new Date(b.importedUtcMs).toLocaleDateString(locale) })}</span>
                {b.undone ? <span className="text-muted">{t('data.import.undone')}</span> : <Button outline type="button" onClick={() => void undo(b.id)}>{t('data.import.undo')}</Button>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

