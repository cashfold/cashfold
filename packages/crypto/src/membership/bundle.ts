import { decode, encode } from '@cashfold/protocol/cbor';
import type { SecretBuf } from '../secret-buf';
import type { Signer } from '../ports/index';

// A public key bundle is what one person gives another so they can be invited (ARCH 7.4): their account id and both public
// keys, signed by the signing key inside it. The signature proves the bundle was made by whoever holds that signing key and
// that the encryption key belongs with it; it does not prove who that is. The fingerprint comparison does that.

const LABEL = new TextEncoder().encode('cashfold.bundle.v1');

export interface PublicKeyBundleData {
  readonly accountId: string;
  readonly encPk: Uint8Array;
  readonly sigPk: Uint8Array;
  readonly selfSig: Uint8Array;
}

export function bundleSigningBytes(accountId: string, encPk: Uint8Array, sigPk: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(accountId);
  const out = new Uint8Array(LABEL.length + 2 + id.length + 64);
  out.set(LABEL);
  new DataView(out.buffer).setUint16(LABEL.length, id.length, false); // length-prefixed, so ids cannot run into the keys
  out.set(id, LABEL.length + 2);
  out.set(encPk, LABEL.length + 2 + id.length);
  out.set(sigPk, LABEL.length + 2 + id.length + 32);
  return out;
}

export async function signBundle(signer: Signer, args: { accountId: string; encPk: Uint8Array; sigSk: SecretBuf }): Promise<PublicKeyBundleData> {
  const sigPk = await signer.publicKey(args.sigSk);
  return { accountId: args.accountId, encPk: args.encPk, sigPk, selfSig: await signer.sign(args.sigSk, bundleSigningBytes(args.accountId, args.encPk, sigPk)) };
}

export async function verifyBundle(signer: Signer, bundle: PublicKeyBundleData): Promise<boolean> {
  if (bundle.encPk.length !== 32 || bundle.sigPk.length !== 32 || bundle.selfSig.length !== 64 || bundle.accountId.length === 0) return false;
  return signer.verify(bundle.sigPk, bundleSigningBytes(bundle.accountId, bundle.encPk, bundle.sigPk), bundle.selfSig);
}

// ---------------------------------------------------------------- invitation code


const CODE_PREFIX = 'cf-invite1:';
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The text a person hands over (or a QR code carries) so they can be invited without a lookup (FR-106). */
export function encodeInvitationCode(bundle: PublicKeyBundleData): string {
  return `${CODE_PREFIX}${b64(encode({ a: bundle.accountId, e: bundle.encPk, s: bundle.sigPk, g: bundle.selfSig } as never))}`;
}

/** The bundle inside a code, or undefined if the text is not one. The bundle's signature is not checked here. */
export function decodeInvitationCode(text: string): PublicKeyBundleData | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) return undefined;
  try {
    const m = decode(unb64(trimmed.slice(CODE_PREFIX.length)));
    if (!(m instanceof Map)) return undefined;
    const [a, e, s, g] = [m.get('a'), m.get('e'), m.get('s'), m.get('g')];
    if (typeof a !== 'string' || !(e instanceof Uint8Array) || !(s instanceof Uint8Array) || !(g instanceof Uint8Array) || m.size !== 4) return undefined;
    if (e.length !== 32 || s.length !== 32 || g.length !== 64 || a.length === 0 || a.length > 64) return undefined;
    return { accountId: a, encPk: e, sigPk: s, selfSig: g };
  } catch {
    return undefined;
  }
}
