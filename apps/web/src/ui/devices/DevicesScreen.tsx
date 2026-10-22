'use client';

import type { DeviceInfo } from '@cashfold/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { TextField } from '../forms/TextField';
import { useI18n } from '../i18n/I18nProvider';
import { useSyncStatus, type SyncView } from '../sync/useSyncStatus';
import { Button } from '../kit';

type Listed = { ok: true; value: DeviceInfo[] } | { ok: false; error: { code: string } };

const ATTENTION_KEYS: Readonly<Record<string, string>> = {
  rejected_change: 'sync.attention.rejected_change',
  relay_gap: 'sync.attention.relay_gap',
};

export function DevicesScreen() {
  const { t, locale } = useI18n();
  const core = useCore();
  const { status, syncNow } = useSyncStatus();
  const [devices, setDevices] = useState<DeviceInfo[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [renaming, setRenaming] = useState<string | undefined>();
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const r = await core.call<Listed>('devices.list');
      if (r.ok) {
        setDevices(r.value);
        setProblem(undefined);
      } else setProblem(r.error.code === 'offline' ? t('devices.offline') : t('devices.error'));
    } catch {
      setProblem(t('devices.unavailable'));
    }
  }, [core, t]);

  useEffect(() => {
    void load();
  }, [load, status?.connection]);

  async function rename(id: string) {
    const r = await core.call<{ ok: boolean }>('devices.rename', { device: id, label });
    setRenaming(undefined);
    if (!r.ok) setProblem(t('devices.error'));
    await load();
  }

  async function revoke(id: string) {
    const r = await core.call<{ ok: boolean }>('devices.revoke', { device: id });
    setConfirm(undefined);
    if (!r.ok) setProblem(t('devices.error'));
    await load();
  }

  const date = (ms: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms));

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t('page.devices.title')}</h1>
      <SyncPanel status={status} onSyncNow={() => void syncNow()} />

      <section aria-labelledby="devices-heading" className="mt-8">
        <h2 id="devices-heading" className="text-lg font-semibold">{t('devices.list.title')}</h2>
        {problem ? <p role="alert" className="mt-2">{problem}</p> : null}
        {devices === undefined && !problem ? <p className="mt-2 text-muted">{t('loading')}</p> : null}
        <ul className="mt-3 grid gap-3">
          {(devices ?? []).map((d) => (
            <li key={d.id} className="rounded-ui border border-border-strong p-3">
              <p className="font-medium">
                {d.label ?? t('devices.unnamed')}
                {d.thisDevice ? <span className="ms-2 text-sm text-muted">({t('devices.thisDevice')})</span> : null}
                {d.revoked ? <span className="ms-2 text-sm text-muted">({t('devices.removed')})</span> : null}
              </p>
              <p className="text-sm text-muted">{t('devices.added', { date: date(d.createdAtMs) })}</p>
              {renaming === d.id ? (
                <form className="mt-2" onSubmit={(e) => (e.preventDefault(), void rename(d.id))}>
                  <TextField label={t('devices.rename.label')} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} autoFocus />
                  <div className="mt-3 flex gap-3">
                    <Button type="submit" >{t('devices.rename.save')}</Button>
                    <Button outline type="button" onClick={() => setRenaming(undefined)}>{t('devices.cancel')}</Button>
                  </div>
                </form>
              ) : confirm === d.id ? (
                <div className="mt-2" role="alertdialog" aria-label={t('devices.remove.confirmTitle')}>
                  <p>{d.thisDevice ? t('devices.remove.confirmThis') : t('devices.remove.confirm')}</p>
                  <div className="mt-3 flex gap-3">
                    <Button type="button" onClick={() => void revoke(d.id)}>{t('devices.remove.yes')}</Button>
                    <Button outline type="button" onClick={() => setConfirm(undefined)}>{t('devices.cancel')}</Button>
                  </div>
                </div>
              ) : !d.revoked ? (
                <div className="mt-2 flex gap-3">
                  <Button outline type="button" onClick={() => (setRenaming(d.id), setLabel(d.label ?? ''))}>{t('devices.rename')}</Button>
                  <Button outline type="button" onClick={() => setConfirm(d.id)}>{t('devices.remove')}</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="add-heading" className="mt-8">
        <h2 id="add-heading" className="text-lg font-semibold">{t('devices.add.title')}</h2>
        <p className="mt-1 text-muted">{t('devices.add.lede')}</p>
        <p className="mt-2"><Link className="underline" href="/settings/">{t('devices.add.link')}</Link></p>
      </section>

      {status && (status.attention.length > 0 || status.clock.length > 0) ? (
        <section aria-labelledby="attention-heading" className="mt-8">
          <h2 id="attention-heading" className="text-lg font-semibold">{t('sync.attention.title')}</h2>
          <ul className="mt-2 list-disc ps-6">
            {status.attention.map((a, i) => <li key={`${a.kind}-${a.ref ?? i}`}>{t(ATTENTION_KEYS[a.kind] ?? 'sync.attention.other')}</li>)}
            {status.clock.map((c) => <li key={c.op}>{t('sync.attention.clock_ahead', { days: Math.max(1, Math.round(c.aheadByMs / 86_400_000)) })}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SyncPanel({ status, onSyncNow }: { status: SyncView | undefined; onSyncNow: () => void }) {
  const { t, locale } = useI18n();
  if (status === undefined || !status.available) return null;
  const last = status.folds.map((f) => f.lastSyncedAtMs).filter((n): n is number => n !== undefined).sort((a, b) => b - a)[0];
  const pending = status.folds.reduce((n, f) => n + f.pendingOps, 0);
  return (
    <section aria-labelledby="sync-heading" className="mt-6">
      <h2 id="sync-heading" className="text-lg font-semibold">{t('sync.title')}</h2>
      <dl className="mt-2 grid max-w-md grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="font-medium">{t('sync.service')}</dt><dd className="break-all">{status.server ?? '—'}</dd>
        <dt className="font-medium">{t('sync.last')}</dt>
        <dd>{last === undefined ? t('sync.never') : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(last))}</dd>
        <dt className="font-medium">{t('sync.pending')}</dt><dd>{pending}</dd>
      </dl>
      {status.connection === 'needs_password' ? <p role="alert" className="mt-2">{t('sync.needsPassword')}</p> : null}
      {status.connection === 'not_registered' ? <p className="mt-2"><Link className="underline" href="/settings/">{t('sync.enableLink')}</Link></p> : null}
      <Button outline className="mt-3" type="button" onClick={onSyncNow} disabled={status.connection === 'not_registered'}>{t('sync.now')}</Button>
    </section>
  );
}
