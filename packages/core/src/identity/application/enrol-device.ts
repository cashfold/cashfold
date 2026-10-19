import type { Id } from '../../shared-kernel/id';
import { idFromBytes, idToBytes } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { AccountSecrets, DeviceLabelPort, RelayLink } from '../ports/index';
import { asMap, base64url } from './relay-wire';

// Adding a device (ARCH 6.6) and managing the account's devices (FR-010).
//
// The add-device link carries the address, the service and the Secret Key in the URL *fragment*, which browsers never send
// to a server. The page reads it once and removes it from the address bar and history. The Secret Key is never in the path
// or the query string, and the password is never in the link.

export interface AddDeviceLink {
  readonly email?: string;
  readonly server?: string;
  /** The "C1-…" Secret Key as the link carried it; the crypto layer decides whether it is valid. */
  readonly secretKeyText?: string;
}

const KEYS = ['email', 'server', 'key'] as const;

/** Reads `#email=…&server=…&key=C1-…` from a whole URL or from the fragment alone. Unknown or repeated parts are ignored. */
export function parseAddDeviceLink(input: string): AddDeviceLink {
  const hash = input.includes('#') ? input.slice(input.indexOf('#') + 1) : input.startsWith('?') ? '' : input;
  const found = new Map<string, string>();
  for (const part of hash.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq);
    if (!(KEYS as readonly string[]).includes(name) || found.has(name)) continue;
    try {
      found.set(name, decodeURIComponent(part.slice(eq + 1).replaceAll('+', ' ')));
    } catch {
      // A damaged part is simply not there.
    }
  }
  const email = found.get('email');
  const server = found.get('server');
  const key = found.get('key');
  return { ...(email !== undefined && { email }), ...(server !== undefined && { server }), ...(key !== undefined && { secretKeyText: key }) };
}

export function buildAddDeviceLink(origin: string, link: Required<AddDeviceLink>): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/add/#email=${encodeURIComponent(link.email)}&server=${encodeURIComponent(link.server)}&key=${encodeURIComponent(link.secretKeyText)}`;
}

// ---------------------------------------------------------------- the account's devices

export interface DeviceInfo {
  readonly id: Id;
  /** Undefined when no label was set or it could not be opened. */
  readonly label: string | undefined;
  readonly createdAtMs: number;
  readonly revoked: boolean;
  readonly thisDevice: boolean;
  readonly sigPk: Uint8Array;
}

export type DeviceError = DomainError<'offline' | 'not_found' | 'forbidden' | 'service_error' | 'invalid_label' | 'rate_limited'>;
export const MAX_DEVICE_LABEL = 60;

export interface DeviceManager {
  list(): Promise<Result<DeviceInfo[], DeviceError>>;
  rename(device: Id, label: string): Promise<Result<true, DeviceError>>;
  revoke(device: Id): Promise<Result<true, DeviceError>>;
}

const mapKind = (kind: string): DeviceError => {
  switch (kind) {
    case 'offline': return { code: 'offline', message: 'The service cannot be reached' };
    case 'not_found': return { code: 'not_found', message: 'That device is not on this account' };
    case 'forbidden': return { code: 'forbidden', message: 'This device may not do that' };
    case 'rate_limited': return { code: 'rate_limited', message: 'Too many requests. Try again shortly.' };
    default: return { code: 'service_error', message: 'The service did not answer as expected' };
  }
};

export function createDeviceManager(deps: {
  /** The signed-in session, or undefined while offline or signed out. */
  link: () => RelayLink | undefined;
  labels: DeviceLabelPort;
  account: AccountSecrets;
  thisDevice: Id;
}): DeviceManager {
  const { labels, account, thisDevice } = deps;
  const withLink = async <T>(fn: (link: RelayLink) => Promise<Result<T, DeviceError>>): Promise<Result<T, DeviceError>> => {
    const link = deps.link();
    return link === undefined ? err('offline', mapKind('offline').message) : fn(link);
  };

  return {
    list: () =>
      withLink(async (link) => {
        const reply = await link.request('GET', '/devices');
        if (!reply.ok) return { ok: false, error: mapKind(reply.kind) };
        if (!Array.isArray(reply.body)) return err('service_error', mapKind('protocol').message);
        const out: DeviceInfo[] = [];
        for (const row of reply.body as unknown[]) {
          const m = asMap(row);
          const devId = m.get('dev_id');
          const sigPk = m.get('sig_pk');
          if (!(devId instanceof Uint8Array) || devId.length !== 16 || !(sigPk instanceof Uint8Array)) continue;
          const ct = m.get('label_ct');
          const created = m.get('created_at');
          const id = idFromBytes(devId);
          out.push({
            id, sigPk, thisDevice: id === thisDevice, revoked: m.has('revoked_at'), createdAtMs: typeof created === 'bigint' ? Number(created) : 0,
            label: ct instanceof Uint8Array ? await labels.open(ct, account) : undefined,
          });
        }
        return ok(out.sort((a, b) => a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : 1)));
      }),

    rename: (device, label) =>
      withLink(async (link) => {
        const trimmed = label.trim();
        if (Array.from(trimmed).length > MAX_DEVICE_LABEL) return err('invalid_label', `A device name has at most ${MAX_DEVICE_LABEL} characters`);
        const sealed = trimmed === '' ? null : await labels.seal(trimmed, account);
        const reply = await link.request('PUT', `/devices/${base64url(idToBytes(device))}`, { label_ct: sealed });
        return reply.ok ? ok(true as const) : { ok: false, error: mapKind(reply.kind) };
      }),

    revoke: (device) =>
      withLink(async (link) => {
        const reply = await link.request('DELETE', `/devices/${base64url(idToBytes(device))}`);
        return reply.ok ? ok(true as const) : { ok: false, error: mapKind(reply.kind) };
      }),
  };
}
