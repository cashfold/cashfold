import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
// The signature code is shared with the release script that makes the signatures; the desktop bundle includes it through esbuild.
// @ts-expect-error a plain script module without types
import { verifyUpdate } from '../../../../scripts/lib/update-signature.mjs';

export interface VerifyDownloadOptions {
  /** The downloaded installer. */
  readonly file: string;
  /** The version being installed; it picks the release the signature is fetched from. */
  readonly version: string;
  /** The raw Ed25519 public keys (base64) the app trusts. */
  readonly publicKeys: readonly string[];
  /** SHA-512 of the file as the app itself reads it from disk, base64. */
  readonly hashFile: (file: string) => Promise<string>;
  /** Fetches a small text over https from the release. */
  readonly fetchText: (url: string) => Promise<string>;
  /** The pinned base of release downloads, e.g. https://github.com/<owner>/<repo>/releases/download */
  readonly signaturesFrom: string;
}

/**
 * Where the detached signature of an installer lives: next to it in the same release, at an address built here from the pinned repository,
 * the version and the file name. Nothing from the feed decides it.
 */
export function signatureUrl(base: string, version: string, fileName: string): string {
  if (fileName === '' || fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') throw new Error('unsafe file name');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('unsafe version');
  return `${base}/v${version}/${encodeURIComponent(fileName)}.sig`;
}

/**
 * Whether the installer's own name says it is this version: `Cashfold-<version>-<os>-<arch>.<ext>`. The signature covers the name but not
 * the version the feed announces, so without this check a feed could offer an old, genuinely signed installer as a new version.
 */
export function nameIsForVersion(fileName: string, version: string): boolean {
  const escaped = version.replace(/[.+]/g, '\\$&');
  return new RegExp(`^[^-/\\\\]+-${escaped}-(?:win|mac|linux)-[A-Za-z0-9_]+\\.[A-Za-z0-9.]+$`).test(fileName);
}

/**
 * True only when the project's signature on exactly these bytes can be fetched and checked. The hash is computed from the file on disk,
 * not taken from the feed, so the signature is tied to what would actually be installed. Any failure is "no".
 */
export async function verifyDownload(options: VerifyDownloadOptions): Promise<boolean> {
  try {
    const name = basename(options.file);
    if (!nameIsForVersion(name, options.version)) return false;
    const [hash, signature] = await Promise.all([options.hashFile(options.file), options.fetchText(signatureUrl(options.signaturesFrom, options.version, name))]);
    return (await verifyUpdate([...options.publicKeys], name, hash, signature.trim())) === true;
  } catch {
    return false;
  }
}

/** SHA-512 of a file as the update feed and the signature write it: base64. Streams, so a large installer is not held in memory. */
export function sha512OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')));
  });
}

const MAX_SIGNATURE_TEXT = 1024;

/**
 * Reads a short text from the release. Only https (or, in a test build, the one local feed it was given); redirects are followed because a
 * release asset is served from a download host, which is fine: what comes back is checked cryptographically, not by where it came from.
 */
export async function fetchSmallText(url: string, options: { readonly fetch?: typeof fetch; readonly allowHttpPrefix?: string; readonly timeoutMs?: number } = {}): Promise<string> {
  const allowed = url.startsWith('https://') || (options.allowHttpPrefix !== undefined && url.startsWith(options.allowHttpPrefix));
  if (!allowed) throw new Error('only https addresses are fetched');
  const response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 15_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_SIGNATURE_TEXT) throw new Error('the answer is too large to be a signature');
  return text;
}
