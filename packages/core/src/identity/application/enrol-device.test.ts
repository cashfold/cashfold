import { describe, expect, it } from 'vitest';
import { idToBytes, type Id } from '../../shared-kernel/id';
import { id } from '../../testing/index';
import type { AccountSecrets, DeviceLabelPort, RelayLink, RelayReply, Secret } from '../ports/index';
import { buildAddDeviceLink, createDeviceManager, MAX_DEVICE_LABEL, parseAddDeviceLink } from './enrol-device';

const KEY = 'C1-XRG88A-AEBAGBAFA2D-SSCJL-BNGA4-DSRCA';

describe('add-device link', () => {
  it('reads the address, service and Secret Key from a whole URL', () => {
    const url = `https://app.example/add/#email=${encodeURIComponent('a+b@example.com')}&server=${encodeURIComponent('https://relay.example.com')}&key=${KEY}`;
    expect(parseAddDeviceLink(url)).toEqual({ email: 'a+b@example.com', server: 'https://relay.example.com', secretKeyText: KEY });
  });

  it('reads a bare fragment, with or without the hash sign', () => {
    expect(parseAddDeviceLink(`#key=${KEY}`)).toEqual({ secretKeyText: KEY });
    expect(parseAddDeviceLink(`email=a%40b.co&key=${KEY}`)).toEqual({ email: 'a@b.co', secretKeyText: KEY });
  });

  it('ignores the query string, unknown names, repeated names and damaged parts', () => {
    expect(parseAddDeviceLink(`https://app.example/add/?key=${KEY}`)).toEqual({}); // the Secret Key is accepted from the fragment only
    expect(parseAddDeviceLink(`#password=hunter2&x=1&key=${KEY}&key=C1-OTHER`)).toEqual({ secretKeyText: KEY });
    expect(parseAddDeviceLink('#email=%E0%A4%A&key=')).toEqual({ secretKeyText: '' });
    expect(parseAddDeviceLink('')).toEqual({});
  });

  it('builds a link that parses back, with the Secret Key in the fragment only', () => {
    const link = buildAddDeviceLink('https://app.example/', { email: 'a@b.co', server: 'https://relay.example.com', secretKeyText: KEY });
    expect(link.split('#')[0]).toBe('https://app.example/add/');
    expect(link.split('#')[0]).not.toContain(KEY);
    expect(parseAddDeviceLink(link)).toEqual({ email: 'a@b.co', server: 'https://relay.example.com', secretKeyText: KEY });
  });
});

const secret = (): Secret => ({ length: 32, isWiped: false, use: (fn) => fn(new Uint8Array(32)), wipe: () => undefined });
const account: AccountSecrets = { encSk: secret(), sigSk: secret(), srpX: secret() };
const labels: DeviceLabelPort = {
  seal: async (label) => new TextEncoder().encode(`sealed:${label}`),
  open: async (ct) => (new TextDecoder().decode(ct).startsWith('sealed:') ? new TextDecoder().decode(ct).slice(7) : undefined),
};
const row = (dev: Id, over: Record<string, unknown> = {}) => new Map<string, unknown>([['dev_id', idToBytes(dev)], ['sig_pk', new Uint8Array(32)], ['created_at', 100n], ...Object.entries(over)]);

function manager(reply: (method: string, path: string, body?: unknown) => RelayReply, signedOut = false) {
  const seen: Array<[string, string, unknown]> = [];
  const link: RelayLink = { freshProof: new Uint8Array(32), close: () => undefined, async request(method, path, body) { seen.push([method, path, body]); return reply(method, path, body); } };
  return { seen, m: createDeviceManager({ link: () => (signedOut ? undefined : link), labels, account, thisDevice: id(1) }) };
}

describe('device manager (FR-010)', () => {
  it('lists devices oldest first, opens labels, marks this device and revoked ones', async () => {
    const { m } = manager(() => ({ ok: true, status: 200, body: [row(id(2), { created_at: 300n, label_ct: new TextEncoder().encode('sealed:Phone'), revoked_at: 400n }), row(id(1), { created_at: 100n }), new Map([['junk', 1n]])] }));
    const r = await m.list();
    expect(r.ok && r.value.map((d) => [d.id, d.label, d.thisDevice, d.revoked])).toEqual([[id(1), undefined, true, false], [id(2), 'Phone', false, true]]);
  });

  it('shows no label rather than garbage when a label does not open', async () => {
    const { m } = manager(() => ({ ok: true, status: 200, body: [row(id(2), { label_ct: new Uint8Array([1, 2, 3]) })] }));
    expect((await m.list()).ok && (await m.list() as { ok: true; value: Array<{ label?: string }> }).value[0]!.label).toBeUndefined();
  });

  it('renames with an encrypted label, clears with null, and refuses a long name', async () => {
    const { m, seen } = manager(() => ({ ok: true, status: 204, body: null }));
    expect(await m.rename(id(2), '  Kitchen tablet  ')).toEqual({ ok: true, value: true });
    expect(seen[0]![0]).toBe('PUT');
    expect(new TextDecoder().decode((seen[0]![2] as { label_ct: Uint8Array }).label_ct)).toBe('sealed:Kitchen tablet');
    await m.rename(id(2), '   ');
    expect(seen[1]![2]).toEqual({ label_ct: null });
    expect(await m.rename(id(2), 'x'.repeat(MAX_DEVICE_LABEL + 1))).toMatchObject({ ok: false, error: { code: 'invalid_label' } });
    expect(seen).toHaveLength(2);
  });

  it('revokes by id', async () => {
    const { m, seen } = manager(() => ({ ok: true, status: 204, body: null }));
    expect(await m.revoke(id(2))).toEqual({ ok: true, value: true });
    expect(seen[0]![0]).toBe('DELETE');
    expect(seen[0]![1]).toBe(`/devices/${Buffer.from(idToBytes(id(2))).toString('base64url')}`);
  });

  it.each([['offline', 'offline'], ['not_found', 'not_found'], ['forbidden', 'forbidden'], ['rate_limited', 'rate_limited'], ['protocol', 'service_error']] as const)('maps a %s answer to %s', async (kind, code) => {
    const { m } = manager(() => ({ ok: false, kind }));
    expect(await m.revoke(id(2))).toMatchObject({ ok: false, error: { code } });
    expect(await m.list()).toMatchObject({ ok: false, error: { code } });
  });

  it('says offline when there is no session, without trying', async () => {
    const { m, seen } = manager(() => ({ ok: true, status: 200, body: [] }), true);
    expect(await m.list()).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(seen).toEqual([]);
  });
});
