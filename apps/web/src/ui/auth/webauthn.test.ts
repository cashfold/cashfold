import { describe, expect, it } from 'vitest';
import { enrolDeviceCredential, platformAuthenticatorAvailable, readPrf, type CredentialsLike } from './webauthn';

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const rng = { bytes: (n: number) => bytes(n, 3) };

function fake(over: { prfEnabled?: boolean; prfResult?: ArrayBuffer | undefined; createError?: Error; getError?: Error } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the WebAuthn option objects are structural browser types
  const calls: { create?: any; get?: any } = {};
  const creds: CredentialsLike = {
    async create(options) {
      calls.create = options;
      if (over.createError) throw over.createError;
      return { rawId: bytes(16, 9).buffer, getClientExtensionResults: () => ({ prf: { enabled: over.prfEnabled ?? true } }) };
    },
    async get(options) {
      calls.get = options;
      if (over.getError) throw over.getError;
      return { getClientExtensionResults: () => ({ prf: over.prfResult === undefined && 'prfResult' in over ? {} : { results: { first: over.prfResult ?? bytes(32, 5).buffer } } }) };
    },
  };
  return { creds, calls };
}
const dom = (name: string) => Object.assign(new Error(name), { name });

describe('platformAuthenticatorAvailable', () => {
  it('is true only when the browser reports a user-verifying platform authenticator', async () => {
    expect(await platformAuthenticatorAvailable({ PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true } })).toBe(true);
    expect(await platformAuthenticatorAvailable({ PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => false } })).toBe(false);
    expect(await platformAuthenticatorAvailable({})).toBe(false);
    expect(await platformAuthenticatorAvailable({ PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => { throw new Error('x'); } } })).toBe(false);
  });
});

describe('enrolDeviceCredential', () => {
  it('asks for a platform credential with required user verification and the PRF extension', async () => {
    const { creds, calls } = fake();
    const result = await enrolDeviceCredential(creds, { rpId: 'app.example.org', rng });
    expect(result).toEqual({ credentialId: bytes(16, 9) });
    const pk = calls.create.publicKey;
    expect(pk.rp).toEqual({ id: 'app.example.org', name: 'Cashfold' });
    expect(pk.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'platform', userVerification: 'required' });
    expect(pk.extensions).toEqual({ prf: {} });
    expect(pk.challenge).toHaveLength(32);
    expect(pk.user.id).toHaveLength(16);
    expect(pk.pubKeyCredParams.map((p: { alg: number }) => p.alg)).toEqual([-7, -257]);
  });

  it('reports an authenticator without PRF support', async () => {
    expect(await enrolDeviceCredential(fake({ prfEnabled: false }).creds, { rpId: 'x', rng })).toBe('unsupported');
  });

  it('maps a dismissed prompt to cancelled, and other failures to failed', async () => {
    expect(await enrolDeviceCredential(fake({ createError: dom('NotAllowedError') }).creds, { rpId: 'x', rng })).toBe('cancelled');
    expect(await enrolDeviceCredential(fake({ createError: dom('SecurityError') }).creds, { rpId: 'x', rng })).toBe('failed');
  });
});

describe('readPrf', () => {
  it('evaluates the PRF with the stored salt for the stored credential and returns a private copy of 32 bytes', async () => {
    const { creds, calls } = fake({ prfResult: bytes(32, 5).buffer });
    const salt = bytes(32, 4);
    const out = await readPrf(creds, { credentialId: bytes(16, 9), prfSalt: salt, rpId: 'app.example.org', rng });
    expect(out).toEqual(bytes(32, 5));
    const pk = calls.get.publicKey;
    expect(pk.rpId).toBe('app.example.org');
    expect(pk.userVerification).toBe('required');
    expect(pk.allowCredentials).toEqual([{ type: 'public-key', id: bytes(16, 9) }]);
    expect(pk.extensions).toEqual({ prf: { eval: { first: salt } } });
  });

  it('reports a result that is missing or the wrong size as unsupported', async () => {
    expect(await readPrf(fake({ prfResult: undefined }).creds, { credentialId: bytes(1, 1), prfSalt: bytes(32, 1), rpId: 'x', rng })).toBe('unsupported');
    expect(await readPrf(fake({ prfResult: bytes(16, 1).buffer }).creds, { credentialId: bytes(1, 1), prfSalt: bytes(32, 1), rpId: 'x', rng })).toBe('unsupported');
  });

  it('maps a dismissed prompt to cancelled', async () => {
    expect(await readPrf(fake({ getError: dom('NotAllowedError') }).creds, { credentialId: bytes(1, 1), prfSalt: bytes(32, 1), rpId: 'x', rng })).toBe('cancelled');
  });
});
