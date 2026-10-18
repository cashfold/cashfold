// WebAuthn with the PRF extension, for quick unlock (ARCH 5.2). The authenticator (Touch ID, Windows Hello, a phone) returns a
// secret that only it can compute for a given salt; that secret wraps a device key. The page does the ceremony because WebAuthn
// is unavailable in workers; the secret goes straight to the Core Worker and the page zeroes its copy.

/* eslint-disable @typescript-eslint/no-explicit-any -- the WebAuthn option and result objects are structural browser types */
export interface CredentialsLike {
  create(options: any): Promise<any>;
  get(options: any): Promise<any>;
}

interface Rng {
  bytes(length: number): Uint8Array;
}

export type CeremonyFailure = 'cancelled' | 'unsupported' | 'failed';

export async function platformAuthenticatorAvailable(env: { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } } = globalThis as never): Promise<boolean> {
  try {
    return (await env.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) === true;
  } catch {
    return false;
  }
}

const failure = (e: unknown): CeremonyFailure => ((e as Error)?.name === 'NotAllowedError' ? 'cancelled' : 'failed');

/** Creates a device-bound credential that supports PRF. Returns its id, or why it could not. */
export async function enrolDeviceCredential(
  credentials: CredentialsLike,
  { rpId, rng }: { rpId: string; rng: Rng },
): Promise<{ credentialId: Uint8Array } | CeremonyFailure> {
  try {
    const credential = await credentials.create({
      publicKey: {
        rp: { id: rpId, name: 'Cashfold' },
        user: { id: rng.bytes(16), name: 'cashfold-device', displayName: 'Cashfold on this device' },
        challenge: rng.bytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', userVerification: 'required' },
        extensions: { prf: {} },
      },
    });
    if (credential?.getClientExtensionResults?.()?.prf?.enabled !== true) return 'unsupported';
    return { credentialId: new Uint8Array(credential.rawId as ArrayBuffer).slice() };
  } catch (e) {
    return failure(e);
  }
}

/** Asks the authenticator for this enrolment's PRF secret (prompting for biometrics or PIN). The caller must zero the result. */
export async function readPrf(
  credentials: CredentialsLike,
  { credentialId, prfSalt, rpId, rng }: { credentialId: Uint8Array; prfSalt: Uint8Array; rpId: string; rng: Rng },
): Promise<Uint8Array | CeremonyFailure> {
  try {
    const assertion = await credentials.get({
      publicKey: {
        rpId,
        challenge: rng.bytes(32),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
    const first = assertion?.getClientExtensionResults?.()?.prf?.results?.first as ArrayBuffer | undefined;
    if (first === undefined || first.byteLength !== 32) return 'unsupported';
    return new Uint8Array(first).slice();
  } catch (e) {
    return failure(e);
  }
}
