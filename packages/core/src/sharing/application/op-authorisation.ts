import type { Id } from '../../shared-kernel/id';
import type { WireOp } from '../../sync/ports/index';
import { roleAt, type MembershipState } from '../domain/membership-log';
import type { MembershipLog } from './membership-log-service';
import type { OwnDevice } from '../ports/membership';

// Who may write (FR-085, ARCH 7.3). An op counts only if the device that signed it belonged to a member who held at least
// the editor role at the time the op says it was written. Every client decides this for itself from the verified log, so a
// service that relays a forged op, or an op from someone since removed, gets it set aside by every member.

export type OpVerdict = 'ok' | 'unauthorised' | 'unknown_signer';

export function createOpAuthoriser(deps: { log: MembershipLog; ownAccount: () => string | undefined; ownDevices: () => Promise<readonly OwnDevice[]> }) {
  return async function authorise(op: WireOp): Promise<OpVerdict> {
    const state = await deps.log.state(op.fold);
    // A Fold that was never shared has no log to consult: only this account's own devices write to it.
    if (!state.ok || state.value.length === 0) return 'ok';
    const s = state.value;

    const own = (await deps.ownDevices()).some((d) => d.id === op.dev);
    let account: string | undefined;
    if (own) account = deps.ownAccount();
    else {
      const cert = s.devices.get(op.dev);
      if (cert === undefined) return 'unknown_signer'; // the log may simply not have reached this device yet
      // A revoked device speaks only for the time before it was revoked.
      if (cert.revokedAtTs !== undefined && op.hlc.wallMs >= cert.revokedAtTs) return 'unauthorised';
      account = cert.account;
    }
    if (account === undefined) return 'unauthorised';
    const role = roleAt(s, account, op.hlc.wallMs);
    return role !== undefined && role <= 2 ? 'ok' : 'unauthorised';
  };
}

/** The key a device signs ops with, from the log: how a member's other people's devices become known (ARCH 7.1). */
export async function certifiedDeviceKey(log: MembershipLog, fold: Id, device: string): Promise<Uint8Array | undefined> {
  const s = await log.state(fold);
  return s.ok ? s.value.devices.get(device)?.sigPk : undefined;
}

/**
 * Whether the device that signed a snapshot may have made one. A snapshot stands in for the whole log below it, so only a member who sees the
 * whole history and has held at least the editor role can have written it: never a viewer, and never a member who joined with "from now on"
 * history (the service refuses their uploads, but a service that is not honest would not). A snapshot carries no time, so this cannot tell an
 * editor who has since been removed from a current one; it narrows who can forge a snapshot, it does not close that case.
 * `ownAccount` is given for one of this account's own devices, whose certificate may not be in the log.
 */
export function snapshotSignerAllowed(state: MembershipState, device: string, ownAccount?: string): boolean {
  const account = ownAccount ?? state.devices.get(device)?.account;
  const member = account === undefined ? undefined : state.members.get(account);
  return member !== undefined && member.scope === 'full' && member.roles.some((r) => r.role !== undefined && r.role <= 2);
}
