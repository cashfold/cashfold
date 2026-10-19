import { describe, expect, it } from 'vitest';
import type { RelayLink, RelayReply } from '../ports/index';
import { createEmailVerification, parseVerificationToken } from './email-verification';

const TOKEN = 'Sy4l2X0-LEip7Qeu8irZ0x4lwm5ykvFb3E4rbKH-X1g';

describe('verification token', () => {
  it('is read from the link in the email or pasted bare', () => {
    expect(parseVerificationToken(`https://app.example.test/verify/#token=${TOKEN}`)).toBe(TOKEN);
    expect(parseVerificationToken(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(parseVerificationToken(`#a=1&token=${TOKEN}`)).toBe(TOKEN);
  });
  it.each(['', 'short', 'has spaces in it that is long enough to count', `${TOKEN}${TOKEN}${TOKEN}${TOKEN}`, 'https://x/verify/?token=' + TOKEN])('rejects %j', (text) => {
    expect(parseVerificationToken(text)).toBeUndefined();
  });
});

function setup(reply: (method: string, path: string, body?: unknown) => RelayReply, confirm: (t: string) => Promise<{ ok: true } | { ok: false; kind: string }> = async () => ({ ok: true }), signedOut = false) {
  const seen: Array<[string, string, unknown]> = [];
  const link: RelayLink = { freshProof: new Uint8Array(32), close: () => undefined, async request(m, p, b) { seen.push([m, p, b]); return reply(m, p, b); } };
  return { seen, v: createEmailVerification({ link: () => (signedOut ? undefined : link), confirm }) };
}
const me = (fields: Record<string, unknown>): RelayReply => ({ ok: true, status: 200, body: new Map(Object.entries(fields)) });

describe('email verification (FR-105, FR-106)', () => {
  it('reports verified, unverified and disabled', async () => {
    expect((await setup(() => me({ email_verified: true, verification: 'enabled', discoverable: true })).v.status())).toEqual({ ok: true, value: { verification: { kind: 'verified' }, discoverable: true } });
    expect((await setup(() => me({ email_verified: false, verification: 'enabled', discoverable: false })).v.status())).toEqual({ ok: true, value: { verification: { kind: 'unverified' }, discoverable: false } });
    expect((await setup(() => me({ email_verified: false, verification: 'disabled' })).v.status())).toMatchObject({ ok: true, value: { verification: { kind: 'disabled' } } });
  });

  it('asks for a new link, and tells apart "already confirmed" from "this service sends no email"', async () => {
    expect(await setup(() => ({ ok: true, status: 204, body: null })).v.request()).toEqual({ ok: true, value: true });
    expect(await setup(() => ({ ok: false, kind: 'conflict' })).v.request()).toMatchObject({ ok: false, error: { code: 'already_verified' } });
    expect(await setup(() => ({ ok: false, kind: 'not_found' })).v.request()).toMatchObject({ ok: false, error: { code: 'disabled' } });
    expect(await setup(() => ({ ok: false, kind: 'rate_limited' })).v.request()).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('submits the token without needing a session, and maps a refusal to "not valid or expired"', async () => {
    const used: string[] = [];
    const s = setup(() => ({ ok: false, kind: 'offline' }), async (t) => (used.push(t), { ok: true }), true);
    expect(await s.v.submit(`#token=${TOKEN}`)).toEqual({ ok: true, value: true });
    expect(used).toEqual([TOKEN]);
    expect(await s.v.submit('nope')).toMatchObject({ ok: false, error: { code: 'invalid_token' } });
    expect(used).toHaveLength(1);
    const refused = setup(() => ({ ok: true, status: 200, body: null }), async () => ({ ok: false, kind: 'bad_request' }));
    expect(await refused.v.submit(TOKEN)).toMatchObject({ ok: false, error: { code: 'invalid_token' } });
  });

  it('changes discoverability at any time and says offline without a session', async () => {
    const s = setup(() => ({ ok: true, status: 204, body: null }));
    expect(await s.v.setDiscoverable(false)).toEqual({ ok: true, value: true });
    expect(s.seen[0]).toEqual(['PUT', '/accounts/me/discoverable', { discoverable: false }]);
    const off = setup(() => me({}), undefined, true);
    expect(await off.v.setDiscoverable(true)).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(await off.v.status()).toMatchObject({ ok: false, error: { code: 'offline' } });
    expect(off.seen).toEqual([]);
  });
});
