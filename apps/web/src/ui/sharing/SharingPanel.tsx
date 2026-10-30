'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCore } from '../core/CoreProvider';
import { Modal } from '../forms/Modal';

import { useI18n } from '../i18n/I18nProvider';
import { Fingerprint } from './Fingerprint';
import { InviteForm } from './InviteForm';
import { sharingError } from './errors';
import { Button, Select, SelectOption } from '../kit';

type Role = 'owner' | 'editor' | 'viewer';
type Outcome<T> = { ok: true; value: T } | { ok: false; error: { code: string } };

interface Member {
  account: string; role: Role; status: 'active' | 'removed' | 'left'; scope: 'full' | 'from_join'; fromEpoch: number; invitedBy: string; sinceMs: number;
  fingerprint: string[]; devices: Array<{ id: string; revoked: boolean }>; isMe: boolean;
}
interface Overview {
  shared: boolean; me: string | undefined; myRole: Role | undefined; myScope: 'full' | 'from_join' | undefined; epoch: number; server: string | null;
  members: Member[]; notices: Array<{ kind: 'full_history_invitation'; subject: string; by: string; atMs: number }>;
}
type Dialog = { kind: 'invite' } | { kind: 'remove'; member: Member } | { kind: 'leave' } | { kind: 'transfer'; member: Member } | { kind: 'fingerprint'; member: Member };


/** Who is in a Fold and what each may do; for an owner, inviting, changing roles and removing; for anyone, leaving (FR-083 to FR-089). */
export function SharingPanel({ fold, name, onClose, onLeft }: { fold: string; name: string; onClose: () => void; onLeft: () => void }) {
  const { t } = useI18n();
  const core = useCore();
  const [view, setView] = useState<Overview | undefined>();
  const [dialog, setDialog] = useState<Dialog | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setView(await core.call<Overview>('sharing.overview', { fold }));
  }, [core, fold]);

  useEffect(() => {
    void core.call('sharing.refresh', { fold }).catch(() => undefined).then(() => load()).catch(() => undefined);
    return core.subscribe((e) => {
      if (e.type === 'RemoteChanged' || e.type === 'SyncChanged') void load().catch(() => undefined);
    });
  }, [core, fold, load]);

  async function run(method: string, args: Record<string, unknown>, done?: () => void) {
    setMessage(undefined);
    setBusy(true);
    try {
      const r = await core.call<Outcome<unknown>>(method, { fold, ...args });
      if (!r.ok) return setMessage(t(sharingError(r.error.code)));
      await load();
      done?.();
    } finally {
      setBusy(false);
    }
  }

  if (view === undefined) return <p role="status" className="mt-3 text-muted">{t('loading')}</p>;
  const owner = view.myRole === 'owner';
  const active = view.members.filter((m) => m.status === 'active');

  return (
    <div>
      <p className="mt-2 text-muted">{t('sharing.panel.lede', { name })}</p>
      {message ? <p role="alert" className="mt-3 text-danger">{message}</p> : null}
      {notice ? <p role="status" className="mt-3">{notice}</p> : null}

      <h3 className="mt-4 font-medium">{t('sharing.members.title')}</h3>
      <ul className="mt-2 divide-y divide-border-strong rounded-ui border border-border-strong" aria-label={t('sharing.members.title')}>
        {active.map((m) => (
          <li key={m.account} className="p-3" data-testid="member-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>{m.account}</strong>{m.isMe ? <span className="ms-2 text-sm text-muted">{t('sharing.members.you')}</span> : null}
                <p className="text-sm text-muted">
                  {t(`sharing.role.${m.role}`)} · {t(`sharing.scope.${m.scope}.short`)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {owner && !m.isMe ? (
                  <>
                    <label className="sr-only" htmlFor={`role-${m.account}`}>{t('sharing.members.roleOf', { account: m.account })}</label>
                    <Select id={`role-${m.account}`} value={m.role} disabled={busy} onChange={(v) => void run('sharing.changeRole', { member: m.account, role: v })}>
                      <SelectOption value="owner">{t('sharing.role.owner')}</SelectOption>
                      <SelectOption value="editor">{t('sharing.role.editor')}</SelectOption>
                      <SelectOption value="viewer">{t('sharing.role.viewer')}</SelectOption>
                    </Select>
                    <Button outline type="button" onClick={() => setDialog({ kind: 'remove', member: m })} aria-label={`${t('sharing.members.remove')} ${m.account}`}>{t('sharing.members.remove')}</Button>
                    {m.role === 'owner' ? null : <Button outline type="button" onClick={() => setDialog({ kind: 'transfer', member: m })} aria-label={`${t('sharing.members.transfer')} ${m.account}`}>{t('sharing.members.transfer')}</Button>}
                  </>
                ) : null}
                <Button outline type="button" onClick={() => setDialog({ kind: 'fingerprint', member: m })} aria-label={`${t('sharing.members.fingerprint')} ${m.account}`}>{t('sharing.members.fingerprint')}</Button>
              </div>
            </div>
            {owner ? (
              <p className="mt-1 text-sm text-muted" data-testid="member-devices">
                {m.devices.length === 0 ? t('sharing.members.noDevices') : t('sharing.members.devices', { count: m.devices.filter((d) => !d.revoked).length })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {view.notices.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-medium">{t('sharing.notices.title')}</h3>
          <ul className="mt-1 list-disc ps-5 text-sm">
            {view.notices.map((n, i) => <li key={i} data-testid="notice-row">{t('sharing.notices.full', { by: n.by, subject: n.subject })}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {owner ? <Button type="button" onClick={() => setDialog({ kind: 'invite' })}>{t('sharing.invite.open')}</Button> : null}
        {view.myRole !== undefined ? <Button outline type="button" onClick={() => setDialog({ kind: 'leave' })}>{t('sharing.leave.open')}</Button> : null}
        <Button outline type="button" onClick={onClose}>{t('ledger.close')}</Button>
      </div>

      <Modal open={dialog?.kind === 'invite'} title={t('sharing.invite.title')} onClose={() => setDialog(undefined)}>
        {dialog?.kind === 'invite' ? <InviteForm fold={fold} onDone={() => { setDialog(undefined); void load(); }} /> : null}
      </Modal>

      <Modal open={dialog?.kind === 'fingerprint'} title={dialog?.kind === 'fingerprint' ? t('sharing.members.fingerprintOf', { account: dialog.member.account }) : ''} onClose={() => setDialog(undefined)}>
        {dialog?.kind === 'fingerprint' ? (
          <div>
            <p className="mt-2 text-sm text-muted">{t('sharing.members.fingerprint.hint')}</p>
            <div className="mt-2"><Fingerprint groups={dialog.member.fingerprint} label={t('sharing.members.fingerprintOf', { account: dialog.member.account })} /></div>
            <Button outline className="mt-4" type="button" onClick={() => setDialog(undefined)}>{t('ledger.close')}</Button>
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === 'remove'} title={t('sharing.remove.title')} onClose={() => setDialog(undefined)}>
        {dialog?.kind === 'remove' ? (
          <div>
            <p className="mt-3">{t('sharing.remove.explain', { account: dialog.member.account })}</p>
            <p className="mt-2 text-sm text-muted">{t('sharing.remove.limit')}</p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button"  disabled={busy}
                onClick={() => void run('sharing.remove', { member: dialog.member.account }, () => { setDialog(undefined); setNotice(t('sharing.remove.done', { account: dialog.member.account })); })}
              >{t('sharing.members.remove')}</Button>
              <Button outline type="button" onClick={() => setDialog(undefined)}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === 'transfer'} title={t('sharing.transfer.title')} onClose={() => setDialog(undefined)}>
        {dialog?.kind === 'transfer' ? (
          <div>
            <p className="mt-3">{t('sharing.transfer.explain', { account: dialog.member.account })}</p>
            <div className="mt-6 flex gap-3">
              <Button type="button" disabled={busy} onClick={() => void run('sharing.transfer', { to: dialog.member.account }, () => setDialog(undefined))}>{t('sharing.members.transfer')}</Button>
              <Button outline type="button" onClick={() => setDialog(undefined)}>{t('ledger.cancel')}</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === 'leave'} title={t('sharing.leave.title')} onClose={() => setDialog(undefined)}>
        {dialog?.kind === 'leave' ? <LeavePanel fold={fold} name={name} onDone={() => { setDialog(undefined); onLeft(); }} onCancel={() => setDialog(undefined)} /> : null}
      </Modal>
    </div>
  );
}

/** Leaving: an offer to keep a copy first, the plain statement of what stays with others, and the leave itself (FR-104). */
function LeavePanel({ fold, name, onDone, onCancel }: { fold: string; name: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const core = useCore();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function exportCopy() {
    const r = await core.call<Outcome<string>>('sharing.exportCsv', { fold });
    if (!r.ok) return setError(t(sharingError(r.error.code)));
    const url = URL.createObjectURL(new Blob([r.value], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, '-') || 'fold'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function leave() {
    setBusy(true);
    try {
      const r = await core.call<Outcome<true>>('sharing.leave', { fold });
      if (r.ok) onDone();
      else setError(t(sharingError(r.error.code)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mt-3">{t('sharing.leave.explain', { name })}</p>
      <p className="mt-2 text-sm text-muted">{t('sharing.leave.limit')}</p>
      <Button outline className="mt-3" type="button" onClick={() => void exportCopy()}>{t('sharing.leave.export')}</Button>
      {error ? <p role="alert" className="mt-3 text-danger">{error}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button type="button" disabled={busy} onClick={() => void leave()}>{t('sharing.leave.confirm')}</Button>
        <Button outline type="button" onClick={onCancel}>{t('ledger.cancel')}</Button>
      </div>
    </div>
  );
}
