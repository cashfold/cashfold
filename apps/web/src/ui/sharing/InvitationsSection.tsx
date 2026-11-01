'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';

import { useI18n } from '../i18n/I18nProvider';
import { Fingerprint } from './Fingerprint';
import { sharingError } from './errors';
import { Button, Checkbox, CheckboxField, Label } from '../kit';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string } };

interface Invitation {
  fold: string;
  inviter: string;
  inviterFingerprint: string[];
  role: 'owner' | 'editor' | 'viewer';
  scope: 'full' | 'from_join';
  invitedAtMs: number;
  status: 'pending' | 'expired';
}

/** Invitations waiting for this account: who sent them, what they give, and a fingerprint to compare before accepting (FR-084, FR-102). */
export function InvitationsSection({ onChanged }: { onChanged: () => void }) {
  const { t, locale } = useI18n();
  const core = useCore();
  const [items, setItems] = useState<Invitation[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  const load = useCallback(async () => {
    const r = await core.call<Outcome<Invitation[]>>('sharing.invitations');
    if (r.ok) setItems(r.value);
  }, [core]);
  useEffect(() => {
    void load().catch(() => undefined);
    return core.subscribe((e) => {
      if (e.type === 'RemoteChanged' || e.type === 'SyncChanged') void load().catch(() => undefined);
    });
  }, [core, load]);

  async function act(method: 'sharing.accept' | 'sharing.decline', invitation: Invitation) {
    setError(undefined);
    setBusy(invitation.fold);
    try {
      const r = await core.call<Outcome<unknown>>(method, { fold: invitation.fold, inviterFingerprintConfirmed: confirmed[invitation.fold] === true });
      if (r.ok) {
        await load();
        onChanged();
      } else setError(t(sharingError(r.error.code)));
    } finally {
      setBusy(undefined);
    }
  }

  if (items.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="invitations-title">
      <h2 id="invitations-title" className="text-lg font-semibold">{t('sharing.invitations.title')}</h2>
      {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
      <ul className="mt-2 divide-y divide-zinc-950/10 rounded-xl border border-zinc-950/10 dark:divide-white/10 dark:border-white/10" aria-label={t('sharing.invitations.title')}>
        {items.map((i) => (
          <li key={i.fold} className="p-3" data-testid="invitation-row">
            <p>{t('sharing.invitations.from', { inviter: i.inviter, date: new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' }).format(new Date(i.invitedAtMs)) })}</p>
            <p className="mt-1" data-testid="invitation-terms">{t(`sharing.role.${i.role}.long`)} · {t(`sharing.scope.${i.scope}.short`)}</p>
            {i.scope === 'full' ? <p className="text-sm text-muted">{t('sharing.invitations.fullHistory')}</p> : <p className="text-sm text-muted">{t('sharing.invitations.fromJoin')}</p>}
            {i.status === 'expired' ? <p role="status" className="mt-2 text-danger">{t('sharing.invitations.expired')}</p> : (
              <>
                <h3 className="mt-3 font-medium">{t('sharing.invitations.fingerprint', { inviter: i.inviter })}</h3>
                <Fingerprint groups={i.inviterFingerprint} label={t('sharing.invitations.fingerprint', { inviter: i.inviter })} testId="inviter-fingerprint" />
                <CheckboxField className="mt-3"><Checkbox checked={confirmed[i.fold] === true} onChange={(checked) => setConfirmed({ ...confirmed, [i.fold]: checked })} /><Label>{t('sharing.invitations.confirm', { inviter: i.inviter })}</Label></CheckboxField>
              </>
            )}
            <div className="mt-3 flex gap-3">
              {i.status === 'pending' ? <Button type="button" disabled={busy === i.fold || confirmed[i.fold] !== true} onClick={() => void act('sharing.accept', i)}>{t('sharing.invitations.accept')}</Button> : null}
              <Button outline type="button" disabled={busy === i.fold} onClick={() => void act('sharing.decline', i)}>{t('sharing.invitations.decline')}</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
